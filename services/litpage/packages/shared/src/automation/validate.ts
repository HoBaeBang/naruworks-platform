// Configuration checks shown while editing: the builder marks the failing
// step and keeps "Enable" / "Save" disabled; the server re-validates before saving and before running.
// Messages are en-US.
import type { BlockRecord, CollectionRecord, PropertySchema } from '../records.ts';
import { parse } from '../formula/parser.ts';
import { branchTypes, inferSource, type FormulaType, type TypeEnv } from '../formula/typecheck.ts';
import { recurrenceValid } from './recurrence.ts';
import { EDITABLE_PROPERTY_TYPES, LIMITS, TRIGGER_PROPERTY_TYPES, type AutomationAction, type AutomationTrigger, type PropertyEdit, type ValueRef } from './types.ts';

export interface ValidationIssue {
  stepId?: string;
  trigger?: boolean;
  message: string;
  /** longer hint shown in the step tooltip ("error tips") */
  tip?: string;
}

export interface ValidationLookups {
  surface: 'automation' | 'button_block' | 'button_property';
  /** schema of the data source the automation / button property belongs to */
  schema?: Record<string, PropertySchema>;
  collection(id: string): CollectionRecord | undefined;
  block(id: string): BlockRecord | undefined;
  webhooksAllowed?: boolean;
  /** the data source of the trigger page / clicked row: types `Trigger page.Property` in formulas */
  collectionId?: string;
}

export function validUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && !!u.hostname;
  } catch {
    return false;
  }
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,100}$/;
const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'content-type']);

function formulaProblem(src: string): string | null {
  if (!src.trim()) return 'The formula must return a value';
  if (src.length > LIMITS.formulaLength) return 'The formula could not be parsed';
  return parse(src).error ? 'The formula could not be parsed' : null;
}

/** Context keys a formula references ({{lit:context:…}} tokens: page, actor, step:<id>, var:<step>:<var> …). */
export function formulaContextKeys(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/\{\{lit:context:([^}]*)\}\}/g)) {
    try {
      out.push(decodeURIComponent(m[1]));
    } catch {
      out.push(m[1]);
    }
  }
  return out;
}

/** Formula types known while validating: outputs of earlier steps and their variables. */
interface TypeState {
  env: TypeEnv;
  steps: Map<string, FormulaType>;
  vars: Map<string, FormulaType>;
}

function typeState(look: ValidationLookups): TypeState {
  const st: TypeState = { env: { schema: look.schema ?? {} }, steps: new Map(), vars: new Map() };
  st.env = {
    schema: look.schema ?? {},
    collectionId: look.collectionId,
    getCollection: (id) => look.collection(id),
    contextType: (k) => {
      switch (k) {
        case 'page': return look.surface === 'button_block' ? undefined : ({ type: 'block', collection: look.collectionId } as FormulaType);
        case 'actor': case 'page_creator': return { type: 'person' };
        case 'now': case 'today': return { type: 'date' };
        default: break;
      }
      if (k.startsWith('step:')) return st.steps.get(k.slice(5));
      if (k.startsWith('var:')) return st.vars.get(k.slice(4));
      return undefined;
    },
  };
  return st;
}

/** Do the step / variable tokens of a formula point at earlier steps (never at the step being defined)? */
function contextRefsProblem(src: string, stepIds: Set<string>, st: TypeState | undefined): string | null {
  for (const k of formulaContextKeys(src)) {
    if (k.startsWith('step:') && !stepIds.has(k.slice(5))) return 'The referenced variable is unavailable';
    if (k.startsWith('var:')) {
      const [stepId] = k.slice(4).split(':');
      if (!stepIds.has(stepId) || (st && !st.vars.has(k.slice(4)))) return 'The referenced variable is unavailable';
    }
  }
  return null;
}

const known = (t: FormulaType | undefined): t is FormulaType => !!t && t.type !== 'unknown' && t.type !== 'expression';

/** Can a formula of type `t` fill a property of type `propType`? (unknown / empty() always pass) */
export function formulaFitsProperty(propType: string, t: FormulaType): boolean {
  if (!known(t) || t.type === 'undefined') return true;
  const el = t.type === 'array' ? (t.of as FormulaType | undefined) : undefined;
  const one = (x: string) => t.type === x;
  const oneOrList = (x: string) => one(x) || (t.type === 'array' && (!known(el) || el.type === 'undefined' || el.type === x));
  switch (propType) {
    case 'title': case 'text': return true;
    case 'url': case 'email': case 'phone_number': return one('text') || one('number');
    case 'file': return oneOrList('text');
    case 'number': return one('number');
    case 'checkbox': return one('checkbox');
    case 'date': return one('date');
    case 'select': case 'status': return one('text');
    case 'multi_select': return oneOrList('text');
    case 'person': return oneOrList('person');
    case 'relation': return oneOrList('block');
    default: return true;
  }
}

/** Type problems of a formula: "The formula has a type error" when its type can't fill the target
 *  property, "The formula must return a value" when the branches of a condition disagree (`""` for empty). */
function formulaTypeProblem(src: string, st: TypeState | undefined, propType?: string): string | null {
  if (!st) return null;
  let t: FormulaType;
  try {
    t = inferSource(src, st.env);
  } catch {
    return null;
  }
  if (t.type === 'unknown') {
    const branches = branchTypes(src, st.env)?.filter((b) => b.type !== 'undefined');
    if (branches && branches.length > 1 && branches.every(known) && new Set(branches.map((b) => JSON.stringify(b.type === 'array' ? { type: 'array', of: (b.of as FormulaType)?.type } : { type: b.type }))).size > 1) return 'The formula must return a value';
    return null;
  }
  if (propType && !formulaFitsProperty(propType, t)) return 'The formula has a type error';
  return null;
}

function refsProblem(refs: ValueRef[] | undefined, stepIds: Set<string>, st?: TypeState, propType?: string): string | null {
  for (const r of refs ?? []) {
    if (r.type === 'formula') {
      const p = formulaProblem(r.formula) ?? contextRefsProblem(r.formula, stepIds, st)
        // a formula that is the whole value of a typed property must return that type
        ?? formulaTypeProblem(r.formula, st, refs!.length === 1 ? propType : undefined);
      if (p) return p;
    }
    if ((r.type === 'step' || r.type === 'variable') && !stepIds.has(r.step)) return 'The referenced variable is unavailable';
    if (r.type === 'variable' && st && !st.vars.has(`${r.step}:${r.variable}`)) return 'The referenced variable is unavailable';
  }
  return null;
}

function editsProblems(edits: PropertyEdit[], schema: Record<string, PropertySchema> | undefined, stepIds: Set<string>, st?: TypeState): string | null {
  if (!edits.length) return 'Add a property or remove this step';
  for (const e of edits) {
    const prop = schema?.[e.property];
    if (!prop) return 'The property no longer exists';
    if (!EDITABLE_PROPERTY_TYPES.has(prop.type)) return 'This property type cannot be used here';
    const needsValue = e.op === 'add' || e.op === 'remove' || (e.op === 'set' && !['title', 'text', 'url', 'email', 'phone_number', 'checkbox'].includes(prop.type));
    if (needsValue && !e.values.length) return 'Add a property or remove this step';
    const p = refsProblem(e.values, stepIds, st, prop.type);
    if (p) return p;
  }
  return null;
}

export function validateTrigger(trigger: AutomationTrigger, schema: Record<string, PropertySchema> | undefined): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  if (trigger.type === 'event') {
    if (!trigger.events.length) out.push({ trigger: true, message: 'Add trigger' });
    for (const ev of trigger.events) {
      if (ev.type !== 'property_edited') continue;
      const prop = schema?.[ev.property];
      if (!prop) out.push({ trigger: true, message: 'The property no longer exists', tip: 'Fix any errors or delete this step to enable this automation' });
      else if (!TRIGGER_PROPERTY_TYPES.has(prop.type)) out.push({ trigger: true, message: 'This property type cannot be used here' });
    }
  } else if (trigger.type === 'recurrence' && !recurrenceValid(trigger.recurrence)) {
    out.push({ trigger: true, message: 'Missing required fields' });
  }
  return out;
}

/** Issues of the steps (in order); `surface` decides which actions are allowed. */
export function validateSteps(actions: AutomationAction[], trigger: AutomationTrigger, look: ValidationLookups): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const seen = new Set<string>();
  const st = typeState(look);
  let webhooks = 0;
  if (!actions.length && look.surface !== 'automation') out.push({ message: 'This button has no actions' });
  if (actions.length > LIMITS.steps) out.push({ message: 'Too many steps' });
  for (const a of actions) {
    const issue = (message: string, tip?: string) => out.push({ stepId: a.id, message, tip });
    switch (a.type) {
      case 'edit_property': {
        if (trigger.type === 'recurrence') issue('Choose a target', 'Change property can’t be used with a repeating trigger');
        const p = editsProblems(a.edits, look.schema, seen, st);
        if (p) issue(p, 'Fix any errors or delete this step to enable this automation');
        if (look.collectionId) st.steps.set(a.id, { type: 'block', collection: look.collectionId } as FormulaType);
        break;
      }
      case 'add_page': {
        if (!a.collection_id) { issue('Choose a database for the new page', 'Add destination or delete step to enable this automation'); break; }
        const col = look.collection(a.collection_id);
        if (!col) { issue('The database could not be found', 'Change destination or delete step to enable this automation'); break; }
        const host = look.block(col.parent_id);
        if (col.alive === false || host?.alive === false) { issue('The database is in the trash', 'Restore destination or delete step to enable this automation'); break; }
        if (a.template_id) {
          const tpl = look.block(a.template_id);
          if (!tpl || tpl.alive === false) issue('The selected template is in the trash', 'Restore template, select new template or delete step to enable this automation');
          else if (!(col.template_pages ?? []).includes(a.template_id)) issue('The page template is not valid');
        }
        if (a.edits.length) {
          const p = editsProblems(a.edits, col.schema, seen, st);
          if (p) issue(p);
        }
        st.steps.set(a.id, { type: 'block', collection: col.id } as FormulaType);
        break;
      }
      case 'edit_pages': {
        if (a.source) {
          if (!seen.has(a.source.step)) issue('The referenced variable is unavailable');
          if (!a.edits.length) issue('Add a property or remove this step');
          const src = st.steps.get(a.source.step);
          if (src) st.steps.set(a.id, src.type === 'array' ? src : ({ type: 'array', of: src } as FormulaType));
          break;
        }
        if (!a.collection_id) { issue('Choose a database for this step', 'Add destination or delete step to enable this automation'); break; }
        const col = look.collection(a.collection_id);
        if (!col) { issue('The database could not be found', 'Change destination or delete step to enable this automation'); break; }
        if (col.alive === false || look.block(col.parent_id)?.alive === false) { issue('The database is in the trash', 'Restore destination or delete step to enable this automation'); break; }
        for (const f of a.filter?.filters ?? []) {
          const leaf = f as { property?: string };
          if (leaf.property && !col.schema[leaf.property]) { issue('Filter contains a deleted property'); break; }
        }
        const p = editsProblems(a.edits, col.schema, seen, st);
        if (p) issue(p);
        st.steps.set(a.id, { type: 'array', of: { type: 'block', collection: col.id } } as FormulaType);
        break;
      }
      case 'notify': {
        if (a.target.type === 'users') {
          if (!a.target.user_ids.length && !(a.target.dynamic?.length)) issue('Choose at least one recipient', 'Add a recipient or delete step to enable this automation');
          if (a.target.user_ids.length > LIMITS.notifyUsers) issue('Choose at least one recipient', `Select up to ${LIMITS.notifyUsers} people`);
        } else if (!look.schema?.[a.target.property] || look.schema[a.target.property].type !== 'person') {
          issue('Missing target property', 'Choose another target property or remove this step');
        }
        if (!a.message.length) issue('Add a notification message', 'Add a message or delete step to enable this automation');
        const p = refsProblem(a.message, seen, st);
        if (p) issue(p);
        break;
      }
      case 'webhook': {
        webhooks++;
        if (look.webhooksAllowed === false) issue('Disabled in your workspace', 'Contact a workspace admin to modify this setting.');
        if (!validUrl(a.url)) issue('Enter a valid URL');
        if (a.headers.length > LIMITS.customHeaders) issue('Too many custom headers');
        else if (a.headers.some((h) => !HEADER_NAME.test(h.key) || FORBIDDEN_HEADERS.has(h.key.toLowerCase()) || /[\r\n]/.test(h.value) || h.value.length > 1000)) issue('Custom header field is invalid');
        if (webhooks > LIMITS.webhookActions) issue(`An automation can have up to ${LIMITS.webhookActions} webhook actions`);
        break;
      }
      case 'define_variables': {
        if (!a.variables.length) issue('The formula must return a value');
        for (const v of a.variables) {
          const p = formulaProblem(v.formula);
          if (p) { issue(p); break; }
          // variables of one action can't reference each other (this step isn't "seen" yet)
          const r = contextRefsProblem(v.formula, seen, st) ?? formulaTypeProblem(v.formula, st);
          if (r) { issue(r, r === 'The referenced variable is unavailable' ? 'Define each variable that another one uses in a separate action' : undefined); break; }
        }
        for (const v of a.variables) {
          let t: FormulaType = { type: 'unknown' };
          try { t = inferSource(v.formula, st.env); } catch { /* unknown */ }
          st.vars.set(`${a.id}:${v.id}`, t);
        }
        break;
      }
      case 'open':
        if (!a.target || (a.target.type === 'url' && !validUrl(a.target.url)) || (a.target.type === 'page' && !a.target.page_id)) issue('Open page, form, or link is missing a target');
        else if (a.target.type === 'step' && !seen.has(a.target.step)) issue('The referenced variable is unavailable');
        else if (a.target.type === 'page' && look.block(a.target.page_id)?.alive === false) issue('The selected block is in the trash');
        break;
      case 'confirm':
        break;
      case 'insert_blocks':
        if (look.surface !== 'button_block') issue('Unsupported settings');
        break;
      case 'agent':
        if (!a.message.trim()) issue('Update the message before saving');
        break;
      case 'mail':
        issue('Choose a sending account or remove this step');
        break;
      case 'slack':
        issue('Connect Slack before using this step');
        break;
    }
    seen.add(a.id);
  }
  return out;
}

export function validateAutomation(trigger: AutomationTrigger, actions: AutomationAction[], look: ValidationLookups): ValidationIssue[] {
  return [...(look.surface === 'automation' ? validateTrigger(trigger, look.schema) : []), ...validateSteps(actions, trigger, look)];
}

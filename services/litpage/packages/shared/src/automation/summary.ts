// Labels of the automation builder and the summary card caption ("When Status matches Done, change pages in Tasks").
import type { PropertySchema } from '../records.ts';
import { frequencyText } from './recurrence.ts';
import type { ActionType, AutomationAction, AutomationTrigger, ConditionOp, ContextKey, PropertyCondition, TriggerEvent } from './types.ts';

export interface ActionMeta {
  type: ActionType;
  /** menu label ("Add a page to…") */
  label: string;
  /** step card title without the trailing ellipsis */
  title: string;
  icon: string;
  description: string;
}

export const ACTION_META: Record<ActionType, ActionMeta> = {
  edit_property: { type: 'edit_property', label: 'Change property…', title: 'Change property', icon: 'sliders', description: 'Changes this page’s properties.' },
  insert_blocks: { type: 'insert_blocks', label: 'Add blocks', title: 'Add blocks', icon: 'duplicate', description: 'Adds text or blocks to this page.' },
  add_page: { type: 'add_page', label: 'Add a page to…', title: 'Add a page to', icon: 'plus', description: 'Creates a page in a database.' },
  edit_pages: { type: 'edit_pages', label: 'Change pages in…', title: 'Change pages in', icon: 'pencilLine', description: 'Changes selected database page properties.' },
  notify: { type: 'notify', label: 'Notify…', title: 'Notify', icon: 'bell', description: 'Sends an alert to one or more people in the workspace.' },
  mail: { type: 'mail', label: 'Send email…', title: 'Send email', icon: 'gmail', description: 'Sends an alert to one or more people in the workspace.' },
  webhook: { type: 'webhook', label: 'Send webhook', title: 'Send webhook', icon: 'curlyBraces', description: 'Makes a request to a custom URL.' },
  confirm: { type: 'confirm', label: 'Ask for confirmation', title: 'Ask for confirmation', icon: 'questionMarkCircle', description: 'Asks for confirmation before continuing.' },
  open: { type: 'open', label: 'Open page, form, or link', title: 'Open', icon: 'arrowDiagonalUpRight', description: 'Opens the selected page, form, or link.' },
  agent: { type: 'agent', label: 'Message an agent', title: 'Message an agent', icon: 'chatBubble', description: 'Starts an agent conversation with your message.' },
  slack: { type: 'slack', label: 'Notify in Slack…', title: 'Notify in Slack', icon: 'slack', description: 'Sends a Slack message to a person or channel.' },
  define_variables: { type: 'define_variables', label: 'Set variables', title: 'Set variables', icon: 'equalSquare', description: 'Creates values that later steps can reuse.' },
};

/** Action menu order per surface. */
export const ACTION_ORDER: Record<'automation' | 'button_block' | 'button_property', ActionType[]> = {
  automation: ['edit_property', 'add_page', 'edit_pages', 'notify', 'mail', 'webhook', 'slack', 'define_variables'],
  button_property: ['edit_property', 'add_page', 'edit_pages', 'notify', 'mail', 'webhook', 'confirm', 'open', 'agent', 'slack', 'define_variables'],
  button_block: ['insert_blocks', 'add_page', 'edit_pages', 'notify', 'mail', 'webhook', 'confirm', 'open', 'agent', 'slack', 'define_variables'],
};

/** Labels of context values ("@" values), per surface. */
export function contextLabel(key: ContextKey, surface: 'automation' | 'button'): string {
  switch (key) {
    case 'page': return surface === 'automation' ? 'Trigger page' : 'This page';
    case 'actor': return surface === 'automation' ? 'Whoever triggered' : 'Whoever clicked';
    case 'page_creator': return 'Page creator';
    case 'now': return 'Time triggered';
    case 'today': return 'Date triggered';
  }
}

export const CONDITION_LABELS: Record<ConditionOp, string> = {
  edited: 'is edited',
  cleared: 'is cleared',
  is: 'matches',
  is_not: 'does not match',
  contains: 'contains',
  does_not_contain: 'excludes',
  starts_with: 'starts with',
  ends_with: 'ends with',
  equals: '=',
  not_equals: '≠',
  greater_than: '>',
  less_than: '<',
  greater_than_or_equal_to: '≥',
  less_than_or_equal_to: '≤',
};

export interface NameLookups {
  user?(id: string): string;
  page?(id: string): string;
  collection?(id: string): string;
}

function quoteValues(prop: PropertySchema | undefined, cond: PropertyCondition, names: NameLookups): string {
  const vals = cond.values ?? [];
  if (prop?.type === 'checkbox') return vals[0] === 'unchecked' ? 'unchecked' : 'checked';
  const shown = vals.map((v) => (prop?.type === 'person' ? names.user?.(v) || 'Unknown' : prop?.type === 'relation' ? names.page?.(v) || 'Untitled' : v));
  return shown.join(', ');
}

/** "Status matches Done", "Tags includes Bug", "Done is checked", "Estimate > 3", "Assignee changed". */
export function conditionText(prop: PropertySchema | undefined, cond: PropertyCondition, names: NameLookups = {}): string {
  const name = prop?.name ?? 'Deleted property';
  if (!prop) return 'A deleted property changed';
  const vals = cond.values ?? [];
  if (cond.op === 'edited' || ((cond.op === 'is' || cond.op === 'contains') && !vals.length && prop.type !== 'checkbox')) return `${name} changed`;
  if (cond.op === 'cleared') return `${name} was cleared`;
  if (prop.type === 'checkbox') return `${name} is ${quoteValues(prop, cond, names)}`;
  const v = quoteValues(prop, cond, names);
  if ((prop.type === 'person' || prop.type === 'relation') && cond.op === 'contains') return vals.length > 1 ? `${name} includes one of ${v}` : `${name} includes ${v}`;
  if ((prop.type === 'person' || prop.type === 'relation') && cond.op === 'does_not_contain') return vals.length > 1 ? `${name} excludes all of ${v}` : `${name} excludes ${v}`;
  if (prop.type === 'status' && cond.op === 'is') return `${name} matches ${v}`;
  return `${name} ${CONDITION_LABELS[cond.op]} ${v}`;
}

export function triggerEventText(ev: TriggerEvent, schema: Record<string, PropertySchema>, names: NameLookups = {}): string {
  switch (ev.type) {
    case 'page_added': return 'Page added';
    case 'any_property_edited': return 'Any property changed';
    case 'property_edited': return conditionText(schema[ev.property], ev.condition, names);
  }
}

function lowerFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}

export function triggerText(trigger: AutomationTrigger, schema: Record<string, PropertySchema>, names: NameLookups = {}): string {
  if (trigger.type === 'button') return 'Button is clicked';
  if (trigger.type === 'recurrence') return `Every ${frequencyText(trigger.recurrence)}`;
  // event names read in lower case inside the sentence ("When page added, …"); property names keep their case
  const parts = trigger.events.map((e) => (e.type === 'property_edited' ? triggerEventText(e, schema, names) : lowerFirst(triggerEventText(e, schema, names))));
  return parts.join(trigger.mode === 'all' ? ' and ' : ' or ');
}

/** Lowercase summary of one action ("change pages in Tasks", "notify 2 people"). */
export function actionText(a: AutomationAction, ctx: { collectionId?: string; schema?: Record<string, PropertySchema> } & NameLookups = {}): string {
  switch (a.type) {
    case 'edit_property': {
      const names = a.edits.map((e) => ctx.schema?.[e.property]?.name).filter(Boolean);
      return names.length ? `edit ${names.join(', ')}` : 'change a property';
    }
    case 'add_page': return a.collection_id && a.collection_id === ctx.collectionId ? 'create a page here' : 'create a page elsewhere';
    case 'edit_pages':
      if (a.source) return 'change pages';
      return a.collection_id && a.collection_id === ctx.collectionId ? 'change pages here' : `change pages in ${(a.collection_id && ctx.collection?.(a.collection_id)) || 'another database'}`;
    case 'notify': {
      if (a.target.type === 'property') return `notify ${ctx.schema?.[a.target.property]?.name ?? 'a property'}`;
      const n = a.target.user_ids.length + (a.target.dynamic?.length ?? 0);
      if (n === 1 && a.target.user_ids[0]) return `notify ${ctx.user?.(a.target.user_ids[0]) || '1 person'}`;
      return n === 1 ? 'notify 1 person' : `notify ${n} people`;
    }
    case 'webhook': return 'post to a webhook';
    case 'define_variables': return `define ${a.variables.length} custom ${a.variables.length === 1 ? 'variable' : 'variables'}`;
    case 'confirm': return 'show a confirmation';
    case 'open': return 'open a page';
    case 'insert_blocks': return 'insert blocks';
    case 'agent': return 'send a message to an agent';
    case 'mail': return 'send an email';
    case 'slack': return 'send a Slack message';
  }
}

/** Summary card caption: "When {triggers}, {actions}" / "Every {frequency}, {actions}". */
export function automationCaption(trigger: AutomationTrigger, actions: AutomationAction[], ctx: { collectionId?: string; schema: Record<string, PropertySchema> } & NameLookups): string {
  const acts = actions.map((a) => actionText(a, ctx));
  const list = acts.length <= 1 ? acts.join('') : `${acts.slice(0, -1).join(', ')} and ${acts[acts.length - 1]}`;
  if (trigger.type === 'recurrence') return `Every ${frequencyText(trigger.recurrence)}, ${list || '…'}`;
  return `When ${triggerText(trigger, ctx.schema, ctx) || '…'}, ${list || '…'}`;
}

/** Default automation name: "{creatorName}’s automation". */
export function defaultAutomationName(creatorName: string | undefined): string {
  return creatorName ? `${creatorName}’s automation` : 'Automation';
}

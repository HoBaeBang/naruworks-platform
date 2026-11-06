// Step execution shared by the server automation engine and the client button runner. Data steps (Change property,
// Add a page to, Change pages in, Set variables, Add blocks) are *planned* into record operations against an
// overlay of the records they already changed, so later steps see earlier ones ("Page added in step 1") and the
// caller commits everything as one transaction (server: applyTransactions as the automation's creator; client:
// one undoable run() as the person who clicked; permissions are enforced by the transaction guard either way).
import { applyOperation, type Operation } from '../ops.ts';
import type { BlockRecord, CollectionRecord, PropertySchema, SelectOption } from '../records.ts';
import type { DateValue, RichText } from '../richtext.ts';
import {
  decodeStored, encodeCheckbox, encodeDate, encodeNumber, encodePeople, encodeRelation, encodeSelect, getPropertyValue, matchesFilter,
  splitMulti, type PropertyValue, type QueryContext,
} from '../database/index.ts';
import {
  addToDate, dateFromMs, datetimeFromMs, evaluateSource, plainText, type FValue, type FormulaContext,
} from '../formula/index.ts';
import { EDITABLE_PROPERTY_TYPES, LIMITS, type AutomationAction, type ContextKey, type PropertyEdit, type ValueRef } from './types.ts';
import { instantiateRichText } from './templateVars.ts';

export class AutomationError extends Error {
  stepId?: string;
  code: string;
  constructor(message: string, code = 'error', stepId?: string) {
    super(message);
    this.code = code;
    this.stepId = stepId;
  }
}

export interface RunContext {
  kind: 'automation' | 'button';
  /** base record access (the server filters by the run-as user's read access) */
  getRecord(table: string, id: string): any;
  /** alive, non-template rows of a data source */
  rowsOf(collectionId: string): BlockRecord[];
  /** Whoever triggered / Whoever clicked */
  actorId: string;
  /** identity changes are made as (automation creator / the person clicking) */
  runAsId: string;
  /** trigger page (automations) / page holding the button or the clicked row (buttons) */
  page?: BlockRecord;
  now: number;
  timeZone: string;
  spaceId: string;
  newId(): string;
}

export type Resolved =
  | { kind: 'text'; text: string; rich?: RichText }
  | { kind: 'number'; value: number }
  | { kind: 'checkbox'; value: boolean }
  | { kind: 'date'; date: DateValue }
  | { kind: 'user'; id: string }
  | { kind: 'page'; id: string }
  | { kind: 'option'; name: string };

const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

function key(table: string, id: string) {
  return `${table}:${id}`;
}

/** Plans the data steps of one run on top of an overlay of the records it changes. */
export class AutomationPlanner {
  readonly ctx: RunContext;
  ops: Operation[] = [];
  private overlay = new Map<string, any>();
  /** pages produced by steps: add page → the new page (single), change pages → the edited pages */
  readonly stepPages = new Map<string, { ids: string[]; single: boolean }>();
  readonly variables = new Map<string, FValue>();
  /** templates to instantiate into new pages after the ops are committed (content is copied server-side) */
  readonly templates: { rowId: string; templateId: string }[] = [];
  /** pages touched by the run (toast "Edited N pages" / "Created N pages") */
  readonly created: string[] = [];
  readonly edited = new Set<string>();

  constructor(ctx: RunContext) {
    this.ctx = ctx;
  }

  get<T = any>(table: string, id: string | undefined | null): T | undefined {
    if (!id) return undefined;
    const k = key(table, id);
    return (this.overlay.has(k) ? this.overlay.get(k) : this.ctx.getRecord(table, id)) as T | undefined;
  }

  rows(collectionId: string): BlockRecord[] {
    const seen = new Set<string>();
    const out: BlockRecord[] = [];
    for (const r of this.ctx.rowsOf(collectionId)) {
      const cur = this.get<BlockRecord>('block', r.id) ?? r;
      seen.add(r.id);
      if (cur.alive !== false && cur.parent_table === 'collection' && cur.parent_id === collectionId && !cur.is_template) out.push(cur);
    }
    for (const [k, v] of this.overlay) {
      if (!k.startsWith('block:')) continue;
      const b = v as BlockRecord;
      if (!b || seen.has(b.id) || b.alive === false || b.parent_table !== 'collection' || b.parent_id !== collectionId || b.is_template) continue;
      out.push(b);
    }
    return out;
  }

  push(op: Operation) {
    if (!op.pointer.spaceId) op.pointer.spaceId = this.ctx.spaceId;
    this.ops.push(op);
    const k = key(op.pointer.table, op.pointer.id);
    this.overlay.set(k, applyOperation(this.get(op.pointer.table, op.pointer.id), op));
  }

  private touch(blockId: string) {
    this.push({ pointer: { table: 'block', id: blockId, spaceId: this.ctx.spaceId }, path: [], command: 'update', args: { last_edited_time: this.ctx.now, last_edited_by_id: this.ctx.runAsId, last_edited_by_table: 'lit_user' } });
  }

  // ------------------------------------------------------------------ formulas & values

  formulaContext(excludeStep?: string): FormulaContext {
    return {
      getBlock: (id) => this.get('block', id),
      getCollection: (id) => this.get('collection', id),
      getUser: (id) => this.get('lit_user', id),
      timeZone: this.ctx.timeZone,
      now: this.ctx.now,
      contextValue: (k) => this.contextValue(k, excludeStep),
    };
  }

  contextValue(k: string, excludeStep?: string): FValue | undefined {
    const page = this.ctx.page ? this.get<BlockRecord>('block', this.ctx.page.id) ?? this.ctx.page : undefined;
    switch (k) {
      case 'page': return page ? { type: 'block', value: { table: 'block', id: page.id, spaceId: page.space_id } } : undefined;
      case 'actor': return { type: 'person', value: { table: 'lit_user', id: this.ctx.actorId } };
      case 'page_creator': return page?.created_by_id ? { type: 'person', value: { table: 'lit_user', id: page.created_by_id } } : undefined;
      case 'now': return { type: 'date', value: datetimeFromMs(this.ctx.now, this.ctx.timeZone) };
      case 'today': return { type: 'date', value: dateFromMs(this.ctx.now, this.ctx.timeZone) };
      default: break;
    }
    if (k.startsWith('step:')) {
      const s = this.stepPages.get(k.slice(5));
      if (!s) return undefined;
      const blocks: FValue[] = s.ids.map((id) => ({ type: 'block', value: { table: 'block', id } }));
      return s.single ? blocks[0] : { type: 'array', values: blocks };
    }
    if (k.startsWith('var:')) {
      const vk = k.slice(4);
      if (excludeStep && vk.startsWith(`${excludeStep}:`)) return undefined; // no references within one action
      return this.variables.get(vk);
    }
    return undefined;
  }

  evalFormula(src: string, excludeStep?: string): FValue {
    if (src.length > LIMITS.formulaLength) throw new AutomationError('The formula could not be parsed', 'formula');
    const page = this.ctx.page ? this.get<BlockRecord>('block', this.ctx.page.id) ?? this.ctx.page : null;
    const col = page?.parent_table === 'collection' ? this.get<CollectionRecord>('collection', page.parent_id) : undefined;
    const r = evaluateSource(src, page, col?.schema ?? {}, this.formulaContext(excludeStep));
    if (r.error) throw new AutomationError(r.error.kind === 'parse' ? 'The formula could not be parsed' : 'This action could not evaluate its formula', 'formula');
    return r.value;
  }

  private queryContext(): QueryContext {
    return { getRecord: (t, id) => this.get(t, id), rowsOf: (cid) => this.rows(cid), userId: this.ctx.actorId, now: this.ctx.now, cache: new Map() };
  }

  fromFValue(v: FValue): Resolved[] {
    switch (v.type) {
      case 'number': return Number.isFinite(v.value) ? [{ kind: 'number', value: v.value }] : [];
      case 'text': {
        const resolver = { timeZone: this.ctx.timeZone, pageTitle: (id: string) => plainText(this.get<BlockRecord>('block', id)?.properties?.title) || 'Untitled', userName: (id: string) => this.get<any>('lit_user', id)?.name ?? '' };
        return [{ kind: 'text', text: plainText(v.value, resolver), rich: v.value }];
      }
      case 'checkbox': return [{ kind: 'checkbox', value: v.value }];
      case 'date': return [{ kind: 'date', date: v.value }];
      case 'person': return [{ kind: 'user', id: v.value.id }];
      case 'block': return [{ kind: 'page', id: v.value.id }];
      case 'array': return v.values.flatMap((x) => this.fromFValue(x));
      default: return [];
    }
  }

  fromPropertyValue(pv: PropertyValue): Resolved[] {
    switch (pv.kind) {
      case 'text': return pv.text || pv.rich?.length ? [{ kind: 'text', text: pv.text, rich: pv.rich }] : [];
      case 'number': return pv.number === null ? [] : [{ kind: 'number', value: pv.number }];
      case 'checkbox': return [{ kind: 'checkbox', value: pv.checked }];
      case 'select': return pv.options.map((o) => ({ kind: 'option' as const, name: o.value }));
      case 'status': return pv.option ? [{ kind: 'option', name: pv.option.value }] : [];
      case 'date': {
        const d = pv.date;
        if (!d) return [];
        const raw: DateValue = d.raw ?? { type: d.hasTime ? (d.isRange ? 'datetimerange' : 'datetime') : d.isRange ? 'daterange' : 'date', start_date: d.start, ...(d.hasTime ? { start_time: d.startTime } : {}), ...(d.isRange ? { end_date: d.end, ...(d.hasTime ? { end_time: d.endTime } : {}) } : {}), ...(d.timeZone ? { time_zone: d.timeZone } : {}) };
        return [{ kind: 'date', date: raw }];
      }
      case 'person': return pv.ids.map((id) => ({ kind: 'user' as const, id }));
      case 'relation': return pv.ids.map((id) => ({ kind: 'page' as const, id }));
      case 'file': return pv.files.map((f) => ({ kind: 'text' as const, text: f.url || f.name }));
      case 'place': return pv.place ? [{ kind: 'text', text: String(pv.place.name ?? pv.place.address ?? '') }] : [];
      case 'array': return pv.items.flatMap((x) => this.fromPropertyValue(x));
      case 'error': throw new AutomationError('This action could not evaluate its formula', 'formula');
      default: return [];
    }
  }

  resolve(ref: ValueRef, excludeStep?: string): Resolved[] {
    switch (ref.type) {
      case 'text': return ref.text ? [{ kind: 'text', text: ref.text }] : [];
      case 'option': return [{ kind: 'option', name: ref.name }];
      case 'user': return [{ kind: 'user', id: ref.id }];
      case 'page': return [{ kind: 'page', id: ref.id }];
      case 'date': return [{ kind: 'date', date: ref.date }];
      case 'checkbox': return [{ kind: 'checkbox', value: ref.checked }];
      case 'relative_date': {
        const base = dateFromMs(this.ctx.now, this.ctx.timeZone);
        const unit = ref.unit === 'day' ? 'days' : ref.unit === 'week' ? 'weeks' : ref.unit === 'month' ? 'months' : 'years';
        return [{ kind: 'date', date: addToDate(base, ref.amount, unit, this.ctx.timeZone) }];
      }
      case 'context': {
        const v = this.contextValue(ref.key as ContextKey, excludeStep);
        if (!v) {
          if (ref.key === 'page') throw new AutomationError('Choose a target', 'missing_page');
          return [];
        }
        return this.fromFValue(v);
      }
      case 'property': {
        const page = this.ctx.page ? this.get<BlockRecord>('block', this.ctx.page.id) ?? this.ctx.page : undefined;
        if (!page) throw new AutomationError('Choose a target', 'missing_page');
        const col = page.parent_table === 'collection' ? this.get<CollectionRecord>('collection', page.parent_id) : undefined;
        if (!col?.schema[ref.property]) throw new AutomationError('The property no longer exists', 'deleted_property');
        return this.fromPropertyValue(getPropertyValue(page, ref.property, col.schema, this.queryContext()));
      }
      case 'step': {
        const s = this.stepPages.get(ref.step);
        if (!s) throw new AutomationError('The referenced variable is unavailable', 'missing_variable');
        return s.ids.map((id) => ({ kind: 'page' as const, id }));
      }
      case 'variable': {
        const v = this.contextValue(`var:${ref.step}:${ref.variable}`, excludeStep);
        if (!v) throw new AutomationError('The referenced variable is unavailable', 'missing_variable');
        return this.fromFValue(v);
      }
      case 'formula': return this.fromFValue(this.evalFormula(ref.formula, excludeStep));
      default: return [];
    }
  }

  resolveAll(refs: ValueRef[] | undefined, excludeStep?: string): Resolved[] {
    return (refs ?? []).flatMap((r) => this.resolve(r, excludeStep));
  }

  /** Rich text of resolved parts (titles, text properties, notification messages): mentions stay mentions. */
  richOf(parts: Resolved[]): RichText {
    const out: RichText = [];
    for (const p of parts) {
      switch (p.kind) {
        case 'text': if (p.rich?.length) out.push(...p.rich); else if (p.text) out.push([p.text]); break;
        case 'number': out.push([String(p.value)]); break;
        case 'checkbox': out.push([p.value ? 'true' : 'false']); break;
        case 'option': out.push([p.name]); break;
        case 'user': out.push(['‣', [['u', p.id]]]); break;
        case 'page': out.push(['‣', [['p', p.id]]]); break;
        case 'date': out.push(['‣', [['d', p.date]]]); break;
      }
    }
    // merge adjacent plain runs
    const merged: RichText = [];
    for (const d of out) {
      const prev = merged[merged.length - 1];
      if (prev && !prev[1] && !d[1]) merged[merged.length - 1] = [prev[0] + d[0]];
      else merged.push(d);
    }
    return merged;
  }

  plainOf(parts: Resolved[]): string {
    const resolver = { timeZone: this.ctx.timeZone, pageTitle: (id: string) => plainText(this.get<BlockRecord>('block', id)?.properties?.title) || 'Untitled', userName: (id: string) => this.get<any>('lit_user', id)?.name ?? '' };
    return plainText(this.richOf(parts), resolver);
  }

  // ------------------------------------------------------------------ property edits

  /** New stored value of `prop` after `edit` (resolved values), plus options to add to a select schema. */
  encodeEdit(prop: PropertySchema, edit: PropertyEdit, parts: Resolved[], current: RichText | undefined, spaceId: string): { raw: RichText | null; newOptions: SelectOption[] } {
    const newOptions: SelectOption[] = [];
    const t = prop.type;
    if (edit.op === 'clear') return { raw: t === 'checkbox' ? encodeCheckbox(false) : null, newOptions };
    const texts = () => parts.map((p) => (p.kind === 'text' ? p.text : p.kind === 'number' ? String(p.value) : p.kind === 'option' ? p.name : p.kind === 'checkbox' ? String(p.value) : '')).filter((s) => s !== '');
    switch (t) {
      case 'title':
      case 'text': {
        const rich = this.richOf(parts);
        return { raw: rich.length ? rich : null, newOptions };
      }
      case 'url':
      case 'email':
      case 'phone_number': {
        const s = this.plainOf(parts).trim();
        return { raw: s ? [[s]] : null, newOptions };
      }
      case 'number': {
        let n: number | null = null;
        for (const p of parts) {
          if (p.kind === 'number') { n = p.value; break; }
          if (p.kind === 'text') { const x = Number(p.text.replace(/,/g, '').trim()); if (p.text.trim() && Number.isFinite(x)) { n = x; break; } }
        }
        if (n === null && parts.length) throw new AutomationError(`Invalid value for ${prop.name}`, 'wrong_type');
        return { raw: encodeNumber(n) ?? null, newOptions };
      }
      case 'checkbox': {
        const cur = decodeStored(current, prop).kind === 'checkbox' && (decodeStored(current, prop) as { checked: boolean }).checked;
        if (edit.op === 'toggle') return { raw: encodeCheckbox(!cur), newOptions };
        const p = parts[0];
        const v = !p ? false : p.kind === 'checkbox' ? p.value : p.kind === 'number' ? p.value !== 0 : p.kind === 'text' ? /^(true|yes|checked|1)$/i.test(p.text.trim()) : true;
        return { raw: encodeCheckbox(v), newOptions };
      }
      case 'select':
      case 'status':
      case 'multi_select': {
        const names = texts().flatMap((s) => (t === 'multi_select' ? splitMulti(s) : [s.trim()])).filter(Boolean);
        for (const n of names) {
          if ((prop.options ?? []).some((o) => o.value === n) || newOptions.some((o) => o.value === n)) continue;
          if (t === 'status') throw new AutomationError(`“${n}” is not an option of ${prop.name}`, 'invalid_option');
          newOptions.push({ id: this.ctx.newId(), value: n, color: OPTION_COLORS[((prop.options?.length ?? 0) + newOptions.length) % OPTION_COLORS.length] });
        }
        if (t !== 'multi_select') return { raw: encodeSelect(names.slice(-1)) ?? null, newOptions };
        const cur = splitMulti(current ? current.map((d) => d[0]).join('') : '');
        return { raw: encodeSelect(combine(cur, names, edit.op)) ?? null, newOptions };
      }
      case 'person': {
        const ids = parts.filter((p) => p.kind === 'user').map((p) => (p as { id: string }).id);
        if (parts.length && !ids.length) throw new AutomationError(`Invalid value for ${prop.name}`, 'wrong_type');
        const cur = (decodeStored(current, prop) as { ids?: string[] }).ids ?? [];
        return { raw: encodePeople(combine(cur, ids, edit.op)) ?? null, newOptions };
      }
      case 'relation': {
        const ids = parts.filter((p) => p.kind === 'page').map((p) => (p as { id: string }).id);
        if (parts.length && !ids.length) throw new AutomationError(`Invalid value for ${prop.name}`, 'wrong_type');
        const cur = (decodeStored(current, prop) as { ids?: string[] }).ids ?? [];
        let next = combine(cur, ids, edit.op);
        if (prop.limit === 1 && next.length > 1) next = next.slice(-1);
        return { raw: encodeRelation(next, spaceId) ?? null, newOptions };
      }
      case 'date': {
        const p = parts.find((x) => x.kind === 'date') as { date: DateValue } | undefined;
        if (!p && parts.length) throw new AutomationError(`Invalid value for ${prop.name}`, 'wrong_type');
        return { raw: p ? encodeDate(p.date) ?? null : null, newOptions };
      }
      case 'file': {
        const urls = texts();
        const files: RichText = [];
        urls.forEach((u, i) => {
          if (i) files.push([',']);
          files.push([u, [['a', u]]]);
        });
        return { raw: files.length ? files : null, newOptions };
      }
      default:
        throw new AutomationError('This property type cannot be used here', 'invalid_property');
    }
  }

  /** Apply property edits to one page (ops + new select options). */
  applyEdits(pageId: string, edits: PropertyEdit[], stepId: string) {
    const page = this.get<BlockRecord>('block', pageId);
    if (!page || page.alive === false) throw new AutomationError('Choose a target', 'missing_page', stepId);
    const col = page.parent_table === 'collection' ? this.get<CollectionRecord>('collection', page.parent_id) : undefined;
    if (!col) throw new AutomationError('The database could not be found', 'missing_database', stepId);
    let changed = false;
    for (const edit of edits) {
      const prop = col.schema[edit.property];
      if (!prop) throw new AutomationError('The property no longer exists', 'deleted_property', stepId);
      if (!EDITABLE_PROPERTY_TYPES.has(prop.type)) throw new AutomationError('This property type cannot be used here', 'invalid_property', stepId);
      const parts = this.resolveAll(edit.values);
      const keyName = edit.property === 'title' || prop.type === 'title' ? 'title' : edit.property;
      const fresh = this.get<BlockRecord>('block', pageId)!;
      const { raw, newOptions } = this.encodeEdit(prop, edit, parts, fresh.properties?.[keyName] as RichText | undefined, page.space_id);
      if (newOptions.length) {
        const latest = this.get<CollectionRecord>('collection', col.id)!;
        this.push({ pointer: { table: 'collection', id: col.id, spaceId: col.space_id as string }, path: ['schema', edit.property, 'options'], command: 'set', args: [...(latest.schema[edit.property]?.options ?? []), ...newOptions] });
      }
      this.push({ pointer: { table: 'block', id: pageId, spaceId: page.space_id }, path: ['properties', keyName], command: 'set', args: raw ?? [] });
      changed = true;
    }
    if (changed) {
      this.touch(pageId);
      if (!this.created.includes(pageId)) this.edited.add(pageId);
    }
  }

  // ------------------------------------------------------------------ steps

  editProperty(step: Extract<AutomationAction, { type: 'edit_property' }>) {
    if (!this.ctx.page) throw new AutomationError('Choose a target', 'missing_page', step.id);
    if (!step.edits.length) throw new AutomationError('Add a property or remove this step', 'incomplete', step.id);
    this.applyEdits(this.ctx.page.id, step.edits, step.id);
    this.stepPages.set(step.id, { ids: [this.ctx.page.id], single: true });
  }

  addPage(step: Extract<AutomationAction, { type: 'add_page' }>): string {
    const col = this.get<CollectionRecord>('collection', step.collection_id);
    if (!step.collection_id) throw new AutomationError('Choose a database for the new page', 'missing_database', step.id);
    if (!col || col.alive === false) throw new AutomationError('The database could not be found', 'missing_database', step.id);
    const host = this.get<BlockRecord>('block', col.parent_id);
    if (!host || host.alive === false) throw new AutomationError('The database is in the trash', 'database_in_trash', step.id);
    let templateId = step.template_id ?? null;
    if (templateId) {
      const tpl = this.get<BlockRecord>('block', templateId);
      if (!tpl || tpl.alive === false) throw new AutomationError('The selected template is in the trash', 'template_in_trash', step.id);
      if (!(col.template_pages ?? []).includes(templateId)) throw new AutomationError('The page template is not valid', 'invalid_template', step.id);
    } else templateId = null;
    const id = this.ctx.newId();
    const spaceId = (col.space_id as string | undefined) ?? host.space_id ?? this.ctx.spaceId;
    const now = this.ctx.now;
    this.push({
      pointer: { table: 'block', id, spaceId }, path: [], command: 'set',
      args: {
        id, type: 'page', parent_id: col.id, parent_table: 'collection', space_id: spaceId, alive: true,
        created_time: now, created_by_id: this.ctx.runAsId, created_by_table: 'lit_user',
        last_edited_time: now, last_edited_by_id: this.ctx.runAsId, last_edited_by_table: 'lit_user',
      },
    });
    // unique IDs keep counting for pages created by automations
    for (const [pid, p] of Object.entries(col.schema)) {
      if (p.type !== 'auto_increment_id') continue;
      let max = 0;
      for (const r of this.rows(col.id)) {
        const n = Number(String((r.properties?.[pid] as RichText | undefined)?.[0]?.[0] ?? '').replace(/^\D+/, ''));
        if (Number.isFinite(n) && n > max) max = n;
      }
      this.push({ pointer: { table: 'block', id, spaceId }, path: ['properties', pid], command: 'set', args: [[String(max + 1)]] });
    }
    this.created.push(id);
    this.stepPages.set(step.id, { ids: [id], single: true });
    if (step.edits.length) this.applyEdits(id, step.edits, step.id);
    if (templateId) this.templates.push({ rowId: id, templateId });
    return id;
  }

  editPages(step: Extract<AutomationAction, { type: 'edit_pages' }>): string[] {
    let targets: string[];
    if (step.source) {
      const parts = step.source.type === 'step' ? this.resolve({ type: 'step', step: step.source.step }) : this.resolve({ type: 'variable', step: step.source.step, variable: step.source.variable });
      targets = parts.filter((p) => p.kind === 'page').map((p) => (p as { id: string }).id);
    } else {
      if (!step.collection_id) throw new AutomationError('Choose a database for this step', 'missing_database', step.id);
      const col = this.get<CollectionRecord>('collection', step.collection_id);
      if (!col || col.alive === false) throw new AutomationError('The database could not be found', 'missing_database', step.id);
      const qctx = this.queryContext();
      // the filter applies: only matching pages are edited
      const rows = this.rows(col.id).filter((r) => !step.filter || !step.filter.filters?.length || matchesFilter(r, step.filter, col.schema, qctx));
      targets = rows.map((r) => r.id);
    }
    if (targets.length > LIMITS.pagesPerAction) throw new AutomationError(this.ctx.kind === 'button' ? 'This button affects too many pages' : 'Automation impacts too many pages', 'too_many_pages', step.id);
    if (!step.edits.length) throw new AutomationError('Add a property or remove this step', 'incomplete', step.id);
    // pages the run can't open (rows restricted from the automation's creator, pages from a relation or a variable it
    // can't see) are left alone instead of failing — and pausing — the whole run
    targets = targets.filter((id) => { const b = this.get<BlockRecord>('block', id); return !!b && b.alive !== false; });
    for (const id of targets) this.applyEdits(id, step.edits, step.id);
    this.stepPages.set(step.id, { ids: targets, single: false });
    return targets;
  }

  defineVariables(step: Extract<AutomationAction, { type: 'define_variables' }>) {
    for (const v of step.variables.slice(0, LIMITS.variables)) {
      if (!v.formula.trim()) throw new AutomationError('The formula must return a value', 'formula', step.id);
      try {
        this.variables.set(`${step.id}:${v.id}`, this.evalFormula(v.formula, step.id));
      } catch (e) {
        if (e instanceof AutomationError) e.stepId = step.id;
        throw e;
      }
    }
  }

  /** Add blocks (button block): copies `templateIds` (the button's children) under `parentId`. */
  insertBlocks(step: Extract<AutomationAction, { type: 'insert_blocks' }>, button: BlockRecord) {
    const parent = this.get<BlockRecord>('block', button.parent_id);
    if (!parent || button.parent_table !== 'block') throw new AutomationError('The selected block is in the trash', 'block_in_trash', step.id);
    const tpl = (button.content ?? []).filter((id) => this.get<BlockRecord>('block', id)?.alive !== false);
    if (!tpl.length) return [];
    const spaceId = parent.space_id;
    const vars = { now: this.ctx.now, timeZone: this.ctx.timeZone, userId: this.ctx.actorId };
    const clone = (id: string, newParent: string): string | null => {
      const b = this.get<BlockRecord>('block', id);
      if (!b || b.alive === false) return null;
      const nid = this.ctx.newId();
      const { version: _v, applied_tx_ids: _a, content, id: _id, discussions: _d, ...rest } = b as any;
      void _v; void _a; void _id; void _d;
      const props: Record<string, RichText> = {};
      for (const [k, v] of Object.entries((b.properties ?? {}) as Record<string, RichText>)) props[k] = instantiateRichText(v, vars);
      this.push({
        pointer: { table: 'block', id: nid, spaceId }, path: [], command: 'set',
        args: { ...rest, id: nid, properties: props, parent_id: newParent, parent_table: 'block', space_id: spaceId, alive: true, content: [], created_time: this.ctx.now, created_by_id: this.ctx.runAsId, last_edited_time: this.ctx.now, last_edited_by_id: this.ctx.runAsId, copied_from: b.id },
      });
      for (const c of content ?? []) {
        const cid = clone(c, nid);
        if (cid) this.push({ pointer: { table: 'block', id: nid, spaceId }, path: ['content'], command: 'listAfter', args: { id: cid } });
      }
      return nid;
    };
    const out: string[] = [];
    // anchor: below/above the button, or the page's first/last block
    const siblings = (parent.content ?? []).filter((x) => x !== button.id || true);
    let after: string | undefined;
    let before: string | undefined;
    if (step.position === 'above') before = button.id;
    else if (step.position === 'top') before = siblings[0];
    else if (step.position === 'bottom') after = siblings[siblings.length - 1];
    else after = button.id;
    for (const id of tpl) {
      const nid = clone(id, parent.id);
      if (!nid) continue;
      if (before && !out.length) this.push({ pointer: { table: 'block', id: parent.id, spaceId }, path: ['content'], command: 'listBefore', args: { id: nid, before } });
      else this.push({ pointer: { table: 'block', id: parent.id, spaceId }, path: ['content'], command: 'listAfter', args: { id: nid, ...(out.length ? { after: out[out.length - 1] } : after ? { after } : {}) } });
      out.push(nid);
    }
    if (out.length) this.touch(parent.id);
    return out;
  }

  /** Rich message (Send notification) — mentions kept, formulas evaluated. */
  message(refs: ValueRef[]): RichText {
    return this.richOf(this.resolveAll(refs));
  }

  /** Users targeted by a Send notification step (≤ 20 people, or a Person property of the trigger page). */
  notifyTargets(step: Extract<AutomationAction, { type: 'notify' }>): string[] {
    const out: string[] = [];
    if (step.target.type === 'users') {
      out.push(...step.target.user_ids.slice(0, LIMITS.notifyUsers));
      for (const k of step.target.dynamic ?? []) for (const p of this.resolve({ type: 'context', key: k })) if (p.kind === 'user') out.push(p.id);
    } else {
      const page = this.ctx.page ? this.get<BlockRecord>('block', this.ctx.page.id) : undefined;
      if (!page) throw new AutomationError('Choose a target', 'missing_page', step.id);
      const col = page.parent_table === 'collection' ? this.get<CollectionRecord>('collection', page.parent_id) : undefined;
      const prop = col?.schema[step.target.property];
      if (!prop) throw new AutomationError('Choose another target property or remove this step', 'deleted_property', step.id);
      const v = getPropertyValue(page, step.target.property, col!.schema, this.queryContext());
      if (v.kind === 'person') out.push(...v.ids);
    }
    return [...new Set(out)].filter(Boolean);
  }
}

/** set (replace), add, remove, toggle for list values. */
export function combine(current: string[], values: string[], op: PropertyEdit['op']): string[] {
  switch (op) {
    case 'add': return [...new Set([...current, ...values])];
    case 'remove': return current.filter((x) => !values.includes(x));
    case 'toggle': {
      const out = current.filter((x) => !values.includes(x));
      for (const v of values) if (!current.includes(v)) out.push(v);
      return out;
    }
    case 'clear': return [];
    default: return [...new Set(values)];
  }
}

/** Run every data step of `actions` in order (skipping UI / side-effect steps) — server engine + tests. */
export function planDataSteps(planner: AutomationPlanner, actions: AutomationAction[], opts: { button?: BlockRecord } = {}) {
  for (const step of actions) {
    try {
      switch (step.type) {
        case 'edit_property': planner.editProperty(step); break;
        case 'add_page': planner.addPage(step); break;
        case 'edit_pages': planner.editPages(step); break;
        case 'define_variables': planner.defineVariables(step); break;
        case 'insert_blocks': if (opts.button) planner.insertBlocks(step, opts.button); break;
        default: break;
      }
    } catch (e) {
      if (e instanceof AutomationError && !e.stepId) e.stepId = step.id;
      throw e;
    }
  }
}

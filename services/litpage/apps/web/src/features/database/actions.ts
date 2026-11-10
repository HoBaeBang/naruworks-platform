// Database mutations — every change is a transaction of record operations (set/update/listAfter/…),

import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, PropertyType, SelectOption, ViewType } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { newId } from '@nc/shared/ids.ts';
import {
  defaultStatusSchema, encodeCheckbox, encodeDate, encodePeople, encodeRelation, encodeSelect, encodeText, encodeNumber, encodeValueAs,
  getPropertyValue, nextOptionColor, optionNamesFromValues, propertiesKeyFor, propertyTypeMeta, valuesFromFilters, combinedFilter,
  groupAssignment, manualOrder, type GroupResult, type PropertyFilterLeaf, type FilterGroup, type SortSpec, type GroupBy, type AggregationSpec,
  type SavedGroup, DEFAULT_COLUMN_WIDTH, DEFAULT_TITLE_WIDTH, pickBoardGroupProperty, defaultGroupBy, type StatusGroup,
  subitemConfigOf, childIdsOf, descendantIds, parentMap,
} from '@nc/shared/database/index.ts';
import { confirmDialog } from '../page/confirm.tsx';
import { records } from '../../lib/store/records.ts';
import { createBlockIn, deleteBlocksIn, getBlock, run, setProperty, touch } from '../../lib/blocks.ts';
import { transactions, type Tx } from '../../lib/store/transactions.ts';
import { api } from '../../lib/api.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useSession } from '../../lib/store/session.ts';
import { collectionRows, makeQueryContext } from './data.ts';
import { canWriteNewRowValue, collectionAccess } from './access.ts';
import { effectiveView, writePersonal } from './viewState.ts';

// ---------- ids ----------

const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&()*+-./:;<=>?@[]^_`{|}~';




export function nullify<T extends Record<string, unknown>>(patch: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) out[k] = v === undefined ? null : v;
  return out as T;
}

export function newPropertyId(schema?: Record<string, unknown>): string {
  for (;;) {
    let s = '';
    for (let i = 0; i < 4; i++) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
    if (s !== 'titl' && !schema?.[s]) return s;
  }
}

function col(id: string): CollectionRecord | undefined {
  return records.get<CollectionRecord>('collection', id);
}

function viewRec(id: string): CollectionViewRecord | undefined {
  return records.get<CollectionViewRecord>('collection_view', id);
}

// ---------- view property lists (table_properties / board_properties / …) ----------

export interface ViewPropEntry {
  property: string;
  visible: boolean;
  width?: number;
  wrap?: boolean;
  [k: string]: unknown;
}


export function viewProperties(view: CollectionViewRecord, schema: Record<string, PropertySchema>): ViewPropEntry[] {
  const key = propertiesKeyFor(view.type);
  const stored = ((view.format as any)?.[key] ?? []) as ViewPropEntry[];
  const out: ViewPropEntry[] = [];
  const seen = new Set<string>();
  for (const e of stored) {
    if (!e?.property || !schema[e.property] || seen.has(e.property)) continue;
    seen.add(e.property);
    out.push({ ...e });
  }
  for (const pid of Object.keys(schema)) {
    if (seen.has(pid)) continue;
    out.push({ property: pid, visible: pid === 'title' && view.type !== 'gallery' && view.type !== 'board' });
  }
  if (view.type === 'table' || view.type === 'list') {
    const t = out.find((e) => e.property === 'title');
    if (t) t.visible = true;
  }
  return out;
}

export function setViewProperties(tx: Tx, view: CollectionViewRecord, entries: ViewPropEntry[]) {
  tx.update('collection_view', view.id, ['format'], { [propertiesKeyFor(view.type)]: entries });
}

export function updateViewProperty(view: CollectionViewRecord, schema: Record<string, PropertySchema>, propId: string, patch: Partial<ViewPropEntry>, action = 'setViewPropertyFormat') {
  run(action, (tx) => {
    const entries = viewProperties(view, schema).map((e) => (e.property === propId ? { ...e, ...patch } : e));
    setViewProperties(tx, view, entries);
  });
}

export function setPropertyVisible(view: CollectionViewRecord, schema: Record<string, PropertySchema>, propId: string, visible: boolean) {
  updateViewProperty(view, schema, propId, { visible }, visible ? 'showProperty' : 'hideProperty');
}

export function setAllPropertiesVisible(view: CollectionViewRecord, schema: Record<string, PropertySchema>, visible: boolean) {
  run(visible ? 'showAllProperties' : 'hideAllProperties', (tx) => {
    const forced = view.type === 'table' || view.type === 'list';
    setViewProperties(tx, view, viewProperties(view, schema).map((e) => ({ ...e, visible: e.property === 'title' && forced ? true : visible })));
  });
}

export function moveViewProperty(view: CollectionViewRecord, schema: Record<string, PropertySchema>, propId: string, toIndex: number) {
  run('reorderProperties', (tx) => {
    const entries = viewProperties(view, schema);
    const from = entries.findIndex((e) => e.property === propId);
    if (from < 0) return;
    const [e] = entries.splice(from, 1);
    entries.splice(Math.max(0, Math.min(toIndex, entries.length)), 0, e);
    setViewProperties(tx, view, entries);
  });
}

// ---------- schema ----------

export function defaultPropertyName(type: string, schema: Record<string, PropertySchema>): string {
  const base = propertyTypeMeta(type).label;
  const names = new Set(Object.values(schema).map((p) => p.name));
  if (!names.has(base)) return base;
  for (let i = 1; ; i++) if (!names.has(`${base} ${i}`)) return `${base} ${i}`;
}


export function newPropertySchema(type: PropertyType, name: string): PropertySchema {
  const p: PropertySchema = { name, type };
  switch (type) {
    case 'select':
    case 'multi_select':
      p.options = [];
      break;
    case 'status': {
      const s = defaultStatusSchema();
      p.options = s.options;
      p.groups = s.groups;
      p.defaultOption = s.defaultOption;
      break;
    }
    case 'number':
      p.number_format = 'number';
      break;
    case 'formula':
      p.version = 'v2';
      p.formula2 = { code: [], result_type: { type: 'text' } };
      break;
    case 'relation':
      p.version = 'v2';
      p.autoRelate = { enabled: false };
      break;
    case 'rollup':
      p.target_property = 'title';
      p.aggregation = 'show_original';
      break;
    case 'auto_increment_id':
      p.prefix = '';
      break;
  }
  return p;
}


export function addProperty(collectionId: string, type: PropertyType, opts: { name?: string; view?: CollectionViewRecord; afterPropId?: string; beforePropId?: string; extra?: Partial<PropertySchema>; action?: string } = {}): string {
  const c = col(collectionId);
  if (!c) return '';
  if (Object.keys(c.schema).length >= 500) {
    
    useUI.getState().toast('This database has reached its property limit. Delete one before adding another.');
    return '';
  }
  const pid = newPropertyId(c.schema);
  const prop = { ...newPropertySchema(type, opts.name?.trim() || defaultPropertyName(type, c.schema)), ...(opts.extra ?? {}) };
  run(opts.action ?? 'addProperty', (tx) => {
    tx.set('collection', collectionId, ['schema', pid], prop);
    if (opts.view) {
      const schema = { ...c.schema, [pid]: prop };
      const entries = viewProperties(opts.view, c.schema).filter((e) => e.property !== pid);
      let idx = entries.length;
      if (opts.afterPropId) idx = entries.findIndex((e) => e.property === opts.afterPropId) + 1 || entries.length;
      if (opts.beforePropId) {
        const b = entries.findIndex((e) => e.property === opts.beforePropId);
        if (b >= 0) idx = b;
      }
      entries.splice(idx, 0, { property: pid, visible: true, ...(opts.view.type === 'table' ? { width: DEFAULT_COLUMN_WIDTH } : {}) });
      void schema;
      setViewProperties(tx, opts.view, entries);
    }
    if (type === 'auto_increment_id') assignIds(tx, c, pid);
  });
  return pid;
}


function assignIds(tx: Tx, c: CollectionRecord, pid: string) {
  const rows = collectionRows(c.id);
  rows.forEach((r, i) => tx.set('block', r.id, ['properties', pid], [[String(i + 1)]]));
}

export function updateProperty(collectionId: string, propId: string, patch: Partial<PropertySchema>, action = 'updateProperty') {
  run(action, (tx) => tx.update('collection', collectionId, ['schema', propId], nullify(patch as Record<string, unknown>)));
}

export function renameProperty(collectionId: string, propId: string, name: string) {
  run('renameProperty', (tx) => tx.update('collection', collectionId, ['schema', propId], { name }), { coalesceKey: `propname:${collectionId}:${propId}` });
}


export function deleteProperty(collectionId: string, propId: string) {
  const c = col(collectionId);
  if (!c || propId === 'title' || !c.schema[propId]) return;
  run('deleteProperty', (tx) => {
    tx.set('collection', collectionId, ['deleted_schema', propId], { ...c.schema[propId], deleted_time: Date.now() });
    tx.set('collection', collectionId, ['schema', propId], undefined);
  });
  useUI.getState().toast('Property deleted', { label: 'Undo', run: () => restoreProperty(collectionId, propId) });
}

export function restoreProperty(collectionId: string, propId: string) {
  const c = col(collectionId);
  const prop = (c?.deleted_schema as Record<string, PropertySchema> | undefined)?.[propId];
  if (!c || !prop) return;
  const { deleted_time: _d, ...rest } = prop as any;
  run('restoreProperty', (tx) => {
    tx.set('collection', collectionId, ['schema', propId], rest);
    tx.set('collection', collectionId, ['deleted_schema', propId], undefined);
  });
}


export function deleteIdProperty(collectionId: string, propId: string) {
  const c = col(collectionId);
  if (!c || !c.schema[propId]) return;
  run('deleteProperty', (tx) => tx.set('collection', collectionId, ['schema', propId], undefined));
  useUI.getState().toast('Property deleted');
}

export function permanentlyDeleteProperty(collectionId: string, propId: string) {
  run('permanentlyDeleteProperty', (tx) => tx.set('collection', collectionId, ['deleted_schema', propId], undefined));
}

export function duplicateProperty(collectionId: string, propId: string, view?: CollectionViewRecord): string {
  const c = col(collectionId);
  const prop = c?.schema[propId];
  if (!c || !prop || prop.type === 'title') return '';
  const pid = newPropertyId(c.schema);
  const names = new Set(Object.values(c.schema).map((p) => p.name));
  let name = `${prop.name} (1)`;
  for (let i = 2; names.has(name); i++) name = `${prop.name} (${i})`;
  const copy: PropertySchema = structuredClone({ ...prop, name });
  if (copy.options) copy.options = copy.options.map((o) => ({ ...o }));
  run('duplicateProperty', (tx) => {
    tx.set('collection', collectionId, ['schema', pid], copy);
    for (const r of collectionRows(collectionId)) {
      const v = r.properties?.[propId];
      if (v) tx.set('block', r.id, ['properties', pid], v);
    }
    if (view) {
      const entries = viewProperties(view, c.schema);
      const idx = entries.findIndex((e) => e.property === propId);
      const src = entries[idx];
      entries.splice(idx + 1, 0, { ...(src ?? {}), property: pid, visible: true });
      setViewProperties(tx, view, entries);
    }
  });
  return pid;
}


export function changePropertyType(collectionId: string, propId: string, type: PropertyType) {
  const c = col(collectionId);
  const prev = c?.schema[propId];
  if (!c || !prev || prev.type === type || propId === 'title') return;
  const ctx = makeQueryContext();
  const rows = collectionRows(collectionId);
  const values = rows.map((r) => getPropertyValue(r, propId, c.schema, ctx));
  const next: PropertySchema = { ...newPropertySchema(type, prev.name), ...(prev.icon ? { icon: prev.icon } : {}), ...(prev.description ? { description: prev.description } : {}) };
  if (type === 'select' || type === 'multi_select' || type === 'status') {
    const names = optionNamesFromValues(values, ctx);
    const prevOptions = (prev.options ?? []) as SelectOption[];
    const options: SelectOption[] = type === 'status' ? [...(next.options ?? [])] : [];
    for (const n of names) {
      if (options.some((o) => o.value.toLowerCase() === n.toLowerCase())) continue;
      const old = prevOptions.find((o) => o.value === n);
      options.push({ id: newId(), value: n, color: old?.color ?? nextOptionColor(options) });
    }
    if (type !== 'status') for (const o of prevOptions) if (!options.some((x) => x.value === o.value)) options.push({ ...o, id: newId() });
    next.options = options;
    if (type === 'status') {
      const groups = structuredClone(next.groups as StatusGroup[]);
      const known = new Set(groups.flatMap((g) => g.optionIds));
      for (const o of options) if (!known.has(o.id)) groups[0].optionIds.push(o.id);
      next.groups = groups;
    }
  }
  if (prev.type === 'number' && type === 'number') next.number_format = prev.number_format;
  run('changePropertyType', (tx) => {
    tx.set('collection', collectionId, ['schema', propId], next);
    const computed = propertyTypeMeta(type).computed || type === 'button';
    rows.forEach((r, i) => {
      const raw = computed ? undefined : encodeValueAs(values[i], next, ctx);
      tx.set('block', r.id, ['properties', propId], raw);
    });
    if (type === 'auto_increment_id') assignIds(tx, c, propId);
  });
}

// ---------- select / status options ----------

export function addOption(collectionId: string, propId: string, value: string, opts: { color?: string; groupId?: string; tx?: Tx } = {}): SelectOption | null {
  const c = col(collectionId);
  const prop = c?.schema[propId];
  if (!c || !prop) return null;
  const name = value.replace(prop.type === 'multi_select' ? /,/g : /$^/, ' ').trim();
  if (!name) return null;
  const existing = prop.options?.find((o) => o.value.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  const option: SelectOption = { id: newId(), value: name, color: opts.color ?? nextOptionColor(prop.options) };
  const apply = (tx: Tx) => {
    const latest = col(collectionId)!.schema[propId];
    tx.update('collection', collectionId, ['schema', propId], { options: [...(latest.options ?? []), option] });
    if (latest.type === 'status') {
      const groups = structuredClone((latest.groups ?? []) as StatusGroup[]);
      const g = groups.find((x) => x.id === opts.groupId) ?? groups[0];
      if (g) g.optionIds = [...(g.optionIds ?? []), option.id];
      tx.update('collection', collectionId, ['schema', propId], { groups });
    }
  };
  if (opts.tx) apply(opts.tx);
  else run('addSelectOption', apply);
  return option;
}


export function updateOption(collectionId: string, propId: string, optionId: string, patch: Partial<SelectOption>) {
  const c = col(collectionId);
  const prop = c?.schema[propId];
  const old = prop?.options?.find((o) => o.id === optionId);
  if (!c || !prop || !old) return;
  const newName = patch.value?.trim();
  if (patch.value !== undefined && !newName) return;
  const renamed = newName !== undefined && newName !== old.value;
  run(renamed ? 'renameSelectOption' : 'updateSelectOption', (tx) => {
    const options = (prop.options ?? []).map((o) => (o.id === optionId ? { ...o, ...patch, ...(newName ? { value: newName } : {}) } : o));
    const extra: Partial<PropertySchema> = { options };
    if (renamed && prop.type === 'status' && prop.defaultOption === old.value) extra.defaultOption = newName;
    tx.update('collection', collectionId, ['schema', propId], extra);
    if (renamed) rewriteOptionValues(tx, collectionId, prop, old.value, newName!);
  }, { coalesceKey: renamed ? `optname:${optionId}` : undefined });
}

function rewriteOptionValues(tx: Tx, collectionId: string, prop: PropertySchema, from: string, to: string | null) {
  const pid = Object.entries(col(collectionId)!.schema).find(([, p]) => p === prop)?.[0];
  if (!pid) return;
  for (const r of collectionRows(collectionId)) {
    const raw = r.properties?.[pid];
    if (!raw) continue;
    const names = String((raw as any[]).map((d) => d[0]).join('')).split(',').map((s) => s.trim()).filter(Boolean);
    if (!names.some((n) => n.toLowerCase() === from.toLowerCase())) continue;
    const next = names.flatMap((n) => (n.toLowerCase() === from.toLowerCase() ? (to ? [to] : []) : [n]));
    tx.set('block', r.id, ['properties', pid], encodeSelect(next));
  }
}

export function deleteOption(collectionId: string, propId: string, optionId: string) {
  const c = col(collectionId);
  const prop = c?.schema[propId];
  const old = prop?.options?.find((o) => o.id === optionId);
  if (!c || !prop || !old) return;
  run('removeSelectOption', (tx) => {
    const patch: Partial<PropertySchema> = { options: (prop.options ?? []).filter((o) => o.id !== optionId) };
    if (prop.type === 'status') {
      patch.groups = ((prop.groups ?? []) as StatusGroup[]).map((g) => ({ ...g, optionIds: (g.optionIds ?? []).filter((id) => id !== optionId) }));
      if (prop.defaultOption === old.value) patch.defaultOption = (patch.options as SelectOption[])[0]?.value;
    }
    tx.update('collection', collectionId, ['schema', propId], patch);
    rewriteOptionValues(tx, collectionId, prop, old.value, null);
  });
}

export function reorderOptions(collectionId: string, propId: string, orderedIds: string[], statusGroups?: StatusGroup[]) {
  const prop = col(collectionId)?.schema[propId];
  if (!prop) return;
  const byId = new Map((prop.options ?? []).map((o) => [o.id, o]));
  const options = orderedIds.map((id) => byId.get(id)).filter(Boolean) as SelectOption[];
  for (const o of prop.options ?? []) if (!options.includes(o)) options.push(o);
  run('reorderSelectOptions', (tx) => tx.update('collection', collectionId, ['schema', propId], statusGroups ? { options, groups: statusGroups } : { options }));
}

// ---------- values ----------

export function setValue(rowId: string, propId: string, value: RichText | undefined, opts?: { coalesce?: string; action?: string }) {
  run(opts?.action ?? 'setPropertyValue', (tx) => {
    if (propId === 'title') {
      tx.set('block', rowId, ['properties', 'title'], value ?? []);
      touch(tx, rowId);
    } else setProperty(tx, rowId, propId, value);
  }, { coalesceKey: opts?.coalesce });
}

export function setValues(rowIds: string[], propId: string, value: RichText | undefined) {
  run('bulkSetPropertyValue', (tx) => {
    for (const id of rowIds) setProperty(tx, id, propId, value);
  });
}


export function encodeAssignment(prop: PropertySchema, kind: string, value: any, spaceId?: string): RichText | undefined {
  switch (kind) {
    case 'clear': return undefined;
    case 'select': case 'status': return encodeSelect(Array.isArray(value) ? value.slice(0, 1) : [String(value)]);
    case 'multi_select': return encodeSelect(Array.isArray(value) ? value : [String(value)]);
    case 'checkbox': return encodeCheckbox(!!value);
    case 'person': return encodePeople(Array.isArray(value) ? value : [value]);
    case 'relation': return encodeRelation(Array.isArray(value) ? value : [value], spaceId);
    case 'number': return encodeNumber(Number(value));
    case 'date': return encodeDate({ type: 'date', start_date: String(value) });
    case 'text': return prop.type === 'number' ? encodeNumber(Number(value)) : encodeText(String(value));
    default: return undefined;
  }
}

// ---------- rows ----------

export interface CreateRowOptions {
  view?: CollectionViewRecord;
  
  after?: string;
  before?: string;
  title?: RichText;
  properties?: Record<string, RichText | undefined>;
  
  group?: GroupResult | null;
  groupProp?: string;
  subgroup?: GroupResult | null;
  subgroupProp?: string;
  
  position?: 'end' | 'start';
  
  templateId?: string | 'empty';
  action?: string;
  
  parentId?: string;
}

function nextAutoIds(c: CollectionRecord): Record<string, number> {
  const out: Record<string, number> = {};
  const rows = collectionRows(c.id);
  for (const [pid, p] of Object.entries(c.schema)) {
    if (p.type !== 'auto_increment_id') continue;
    let max = 0;
    for (const r of rows) {
      const n = Number(((r.properties?.[pid] as any)?.[0]?.[0] ?? '').replace(/^\D+/, ''));
      if (Number.isFinite(n) && n > max) max = n;
    }
    out[pid] = max + 1;
  }
  return out;
}


export function defaultTemplateId(c: CollectionRecord, view?: CollectionViewRecord): string | undefined {
  const v = (view?.format as any)?.collection_view_default_template;
  if (v === 'empty') return undefined;
  const id = v?.template_page_id ?? c.default_template_id;
  return id && (c.template_pages ?? []).includes(id) && getBlock(id)?.alive ? id : undefined;
}


export function createRow(collectionId: string, opts: CreateRowOptions = {}): string {
  const c = col(collectionId);
  if (!c) return '';
  const id = newId();
  const props: Record<string, RichText | undefined> = {};
  const ctx = makeQueryContext();
  if (opts.view) {
    const f = combinedFilter(effectiveView(opts.view));
    const inherited = f ? valuesFromFilters(f.filters, c.schema, ctx) : {};
    for (const [pid, a] of Object.entries(inherited)) {
      const prop = c.schema[pid];
      if (prop) props[pid] = encodeAssignment(prop, a.type, a.value, c.space_id);
    }
  }
  const assign = (g: GroupResult | null | undefined, pid: string | undefined) => {
    if (!g || !pid || !c.schema[pid]) return;
    const a = groupAssignment(g, c.schema[pid]);
    if (a) props[pid] = encodeAssignment(c.schema[pid], a.kind, a.value, c.space_id);
  };
  assign(opts.group, opts.groupProp);
  assign(opts.subgroup, opts.subgroupProp);
  Object.assign(props, opts.properties ?? {});
  // provisional ID numbers (the server assigns the final ones, never reusing a number — apps/server rowdefaults.ts)
  for (const [pid, n] of Object.entries(nextAutoIds(c))) props[pid] = [[String(n)]];
  // Person › Default: Created by (the server applies the same to rows created elsewhere)
  const me = useSession.getState().userId;
  for (const [pid, p] of Object.entries(c.schema)) {
    if (me && p.type === 'person' && p.default === 'created_by' && props[pid] === undefined) props[pid] = encodePeople([me]);
  }
  const sub = opts.parentId ? subitemConfigOf(c) : null;
  const parent = opts.parentId ? getBlock(opts.parentId) : undefined;
  if (sub && parent) props[sub.inverse] = encodeRelation([parent.id], c.space_id);
  // values from filters / groups / defaults stay off restricted properties the person can't edit (Property access)
  for (const pid of Object.keys(props)) if (!canWriteNewRowValue(collectionId, pid, props)) delete props[pid];
  const templateId = opts.templateId === 'empty' ? undefined : opts.templateId ?? defaultTemplateId(c, opts.view);
  // "Can also create pages" people can't touch views: they may only append their new page to the manual order
  const access = collectionAccess(collectionId);
  const canOrder = access.canEditContent;
  const appendOnly = !canOrder && access.canCreate;
  run(opts.action ?? 'createRow', (tx) => {
    const clean: Record<string, RichText> = {};
    for (const [k, v] of Object.entries(props)) if (v !== undefined) clean[k] = v;
    createBlockIn(tx, { id, type: 'page', parentId: collectionId, parentTable: 'collection', title: opts.title, properties: clean, list: null });
    if (sub && parent) setProperty(tx, parent.id, sub.property, encodeRelation([...childIdsOf(parent, sub), id], c.space_id));
    if (appendOnly && opts.view && opts.position === 'end') tx.listAfter('collection_view', opts.view.id, ['page_sort'], id);
    if (!canOrder) return;
    if (opts.view && (opts.after || opts.before)) insertIntoManualOrder(tx, opts.view, c, id, opts.after, opts.before);
    else if (opts.view && opts.position === 'end') tx.listAfter('collection_view', opts.view.id, ['page_sort'], id);
  });
  if (templateId) void applyTemplate(id, templateId);
  return id;
}

function insertIntoManualOrder(tx: Tx, view: CollectionViewRecord, c: CollectionRecord, id: string, after?: string, before?: string) {
  const current = currentOrder(view, c).filter((x) => x !== id);
  let idx = current.length;
  if (after) {
    const i = current.indexOf(after);
    if (i >= 0) idx = i + 1;
  } else if (before) {
    const i = current.indexOf(before);
    if (i >= 0) idx = i;
  }
  current.splice(idx, 0, id);
  tx.set('collection_view', view.id, ['page_sort'], current);
}

function currentOrder(view: CollectionViewRecord, c: CollectionRecord): string[] {
  return manualOrder(collectionRows(c.id), view.page_sort).map((r) => r.id);
}


export function moveRow(view: CollectionViewRecord, collectionId: string, rowId: string, target: { after?: string; before?: string }, extra?: (tx: Tx) => void) {
  const c = col(collectionId);
  if (!c) return;
  run('reorderRows', (tx) => {
    const order = currentOrder(view, c).filter((x) => x !== rowId);
    let idx = order.length;
    if (target.before) {
      const i = order.indexOf(target.before);
      if (i >= 0) idx = i;
    } else if (target.after) {
      const i = order.indexOf(target.after);
      if (i >= 0) idx = i + 1;
    }
    order.splice(idx, 0, rowId);
    tx.set('collection_view', view.id, ['page_sort'], order);
    extra?.(tx);
  });
}

export async function deleteRows(ids: string[]) {
  if (!ids.length) return;
  
  const first = getBlock(ids[0]);
  const c = first?.parent_table === 'collection' ? col(first.parent_id) : undefined;
  const cfg = subitemConfigOf(c);
  let all = ids;
  if (c && cfg) {
    const extra = descendantIds(ids, parentMap(collectionRows(c.id), cfg)).filter((id) => !ids.includes(id));
    if (extra.length) {
      const one = ids.length === 1;
      // menus close every overlay after onSelect: open the dialog on the next tick
      await new Promise((r) => setTimeout(r, 0));
      const ok = await confirmDialog({
        message: one ? 'Are you sure you want to move this item to Trash?' : 'Are you sure you want to move these items to Trash?',
        description: `This will also move ${extra.length} ${extra.length === 1 ? 'sub-item' : 'sub-items'} to Trash`,
        confirmLabel: 'Delete',
      });
      if (!ok) return;
      all = [...ids, ...extra];
    }
  }
  run('deleteRows', (tx) => deleteBlocksIn(tx, all));
  useUI.getState().toast(all.length === 1 ? 'Sent to trash' : `${all.length} entries sent to trash`);
}


export async function duplicateRows(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  try {
    const res = await api<{ rowIds: string[]; recordMap: any }>('duplicateDatabaseRows', { rowIds: ids });
    records.mergeRecordMap(res.recordMap);
    return res.rowIds;
  } catch (e) {
    console.error(e);
    useUI.getState().toast((e as Error).message || 'Couldn’t duplicate');
    return [];
  }
}



function savedToServer(): Promise<boolean> {
  return new Promise((resolve) => {
    if (transactions.pendingCount() === 0) return resolve(true);
    const off = transactions.onSaveState((st) => {
      if (st.pending > 0) return;
      off();
      resolve(!st.error);
    });
    void transactions.flush();
  });
}

export async function applyTemplate(rowId: string, templateId: string) {
  try {
    
    await savedToServer();
    const res = await api<{ recordMap?: any }>('applyDatabaseTemplate', { rowId, templateId });
    // our own realtime echo is skipped — the response carries the instantiated records
    records.mergeRecordMap(res?.recordMap);
  } catch (e) {
    console.error(e);
  }
}

// ---------- views ----------

export function updateViewFormat(viewId: string, patch: Record<string, unknown>, action = 'updateViewFormat', coalesceKey?: string) {
  run(action, (tx) => tx.update('collection_view', viewId, ['format'], nullify(patch)), { coalesceKey });
}

export function updateQuery2(viewId: string, patch: Record<string, unknown>, action = 'updateViewQuery') {
  const v = viewRec(viewId);
  run(action, (tx) => tx.set('collection_view', viewId, ['query2'], { ...(v?.query2 ?? {}), ...patch }));
}

export function renameView(viewId: string, name: string) {
  run('renameView', (tx) => tx.update('collection_view', viewId, [], { name }), { coalesceKey: `viewname:${viewId}` });
}

// filters (simple chips in format.property_filters, advanced in query2.filter)


// the person can't change) they stay personal until "Save for everyone"; lists are computed from the view as the
// person sees it, writes to the saved view start from the stored record.
export function addPropertyFilter(view: CollectionViewRecord, leaf: PropertyFilterLeaf): string {
  const id = newId();
  const list = [...(((effectiveView(view).format as any)?.property_filters ?? []) as any[]), { id, filter: leaf }];
  if (writePersonal(view, { propertyFilters: list })) return id;
  updateViewFormat(view.id, { property_filters: list }, 'addFilter');
  return id;
}

export function updatePropertyFilter(view: CollectionViewRecord, id: string, leaf: PropertyFilterLeaf) {
  const list = (((effectiveView(view).format as any)?.property_filters ?? []) as any[]).map((f) => (f.id === id ? { ...f, filter: leaf } : f));
  if (writePersonal(view, { propertyFilters: list })) return;
  updateViewFormat(view.id, { property_filters: list }, 'updateFilter', `filter:${id}`);
}

export function removePropertyFilter(view: CollectionViewRecord, id: string) {
  const list = (((effectiveView(view).format as any)?.property_filters ?? []) as any[]).filter((f) => f.id !== id);
  if (writePersonal(view, { propertyFilters: list })) return;
  updateViewFormat(view.id, { property_filters: list }, 'removeFilter');
}

export function setAdvancedFilter(view: CollectionViewRecord, filter: FilterGroup | undefined, coalesceKey?: string) {
  if (writePersonal(view, { filter: filter && filter.filters.length ? filter : null })) return;
  const rec = viewRec(view.id) ?? view;
  run('updateAdvancedFilter', (tx) => tx.set('collection_view', view.id, ['query2'], { ...(rec.query2 ?? {}), filter: filter && filter.filters.length ? filter : undefined }), { coalesceKey });
}

export function setSorts(view: CollectionViewRecord, sorts: SortSpec[]) {
  if (writePersonal(view, { sort: sorts })) return;
  const rec = viewRec(view.id) ?? view;
  run('updateSorts', (tx) => tx.set('collection_view', view.id, ['query2'], { ...(rec.query2 ?? {}), sort: sorts.length ? sorts : undefined }));
}


export function setGroupBy(view: CollectionViewRecord, gb: GroupBy | null, opts?: { sub?: boolean }) {
  run(gb ? 'setGroupBy' : 'removeGrouping', (tx) => {
    if (view.type === 'board' && !opts?.sub) {
      tx.update('collection_view', view.id, ['format'], { board_columns_by: gb ?? null, board_columns: [] });
      if (gb) tx.set('collection_view', view.id, ['query2'], { ...((viewRec(view.id) ?? view).query2 ?? {}), group_by: gb.property });
    } else {
      tx.update('collection_view', view.id, ['format'], { collection_group_by: gb ?? null, collection_groups: [] });
    }
  });
}

export function updateGroupBy(view: CollectionViewRecord, patch: Partial<GroupBy>, opts?: { sub?: boolean }) {
  const key = view.type === 'board' && !opts?.sub ? 'board_columns_by' : 'collection_group_by';
  const cur = (view.format as any)?.[key] as GroupBy | undefined;
  if (!cur) return;
  updateViewFormat(view.id, { [key]: { ...cur, ...patch } }, 'updateGroupBy');
}


export function setSavedGroups(view: CollectionViewRecord, groups: SavedGroup[], opts?: { sub?: boolean; action?: string }) {
  const key = view.type === 'board' && !opts?.sub ? 'board_columns' : 'collection_groups';
  const gbKey = view.type === 'board' && !opts?.sub ? 'board_columns_by' : 'collection_group_by';
  const gb = (view.format as any)?.[gbKey] as GroupBy | undefined;
  run(opts?.action ?? 'updateGroups', (tx) => {
    tx.update('collection_view', view.id, ['format'], { [key]: groups, ...(gb && gb.sort?.type !== 'manual' && opts?.action === 'reorderGroups' ? { [gbKey]: { ...gb, sort: { type: 'manual' } } } : {}) });
  });
}

export function setAggregation(view: CollectionViewRecord, propId: string, aggregator: string | AggregationSpec['aggregator'] | null) {
  const list = ((view.query2?.aggregations ?? []) as AggregationSpec[]).filter((a) => a.property !== propId);
  if (aggregator && aggregator !== 'none') list.push({ property: propId, aggregator: aggregator as any });
  updateQuery2(view.id, { aggregations: list }, 'setAggregation');
}


export function setGroupAggregation(view: CollectionViewRecord, spec: AggregationSpec | null) {
  if (view.type === 'board') {
    const rest = ((view.query2?.aggregations ?? []) as AggregationSpec[]).slice(1);
    updateQuery2(view.id, { aggregations: [spec ?? { aggregator: 'none' }, ...rest] }, 'setGroupAggregation');
  } else updateViewFormat(view.id, { collection_group_aggregation: spec ?? { aggregator: 'none' } }, 'setGroupAggregation');
}


export function defaultViewFormat(type: ViewType, schema: Record<string, PropertySchema>): { format: Record<string, unknown>; query2: Record<string, unknown>; schemaPatch?: Record<string, PropertySchema> } {
  const ids = Object.keys(schema);
  const titleFirst = ['title', ...ids.filter((x) => x !== 'title')];
  switch (type) {
    case 'table':
      return { format: { table_properties: titleFirst.map((p) => ({ property: p, visible: true, width: p === 'title' ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH })), table_wrap: true }, query2: {} };
    case 'board': {
      let gid = pickBoardGroupProperty(schema);
      let schemaPatch: Record<string, PropertySchema> | undefined;
      if (!gid) {
        gid = newPropertyId(schema);
        schemaPatch = { [gid]: newPropertySchema('status', defaultPropertyName('status', schema)) };
      }
      const prop = schemaPatch?.[gid] ?? schema[gid];
      return {
        format: {
          board_columns_by: { ...defaultGroupBy(prop, gid, { board: true }), hideEmptyGroups: false },
          board_properties: [...titleFirst, ...(schemaPatch ? [gid] : [])].map((p) => ({ property: p, visible: p === 'title' })),
          board_cover: { type: 'none' }, board_cover_size: 'medium', board_cover_aspect: 'cover', table_wrap: true,
        },
        query2: { group_by: gid, aggregations: [{ aggregator: 'count', enforceMaxAggregationLimit: true }] },
        schemaPatch,
      };
    }
    case 'gallery':
      return { format: { gallery_properties: titleFirst.map((p) => ({ property: p, visible: p === 'title' })), gallery_cover: { type: 'page_content_first' }, gallery_cover_size: 'medium', gallery_cover_aspect: 'cover' }, query2: {} };
    case 'list':
      // new list views show the title + "Last edited" properties (live: list_properties [{title},{<last_edited_time>}])
      return { format: { list_properties: titleFirst.map((p) => ({ property: p, visible: p === 'title' || schema[p]?.type === 'last_edited_time' })) }, query2: {} };
    default:
      return { format: { [`${type}_properties`]: titleFirst.map((p) => ({ property: p, visible: p === 'title' })) }, query2: {} };
  }
}

export const VIEW_DEFAULT_NAMES: Record<string, string> = {
  table: 'Table', board: 'Board', gallery: 'Gallery', list: 'List', calendar: 'Calendar', timeline: 'Timeline', feed: 'Feed', map: 'Map',
  chart: 'Chart', dashboard: 'Dashboard', form: 'Form',
};


export function createViewIn(tx: Tx, blockId: string, type: ViewType, collectionId: string, opts: { name?: string; id?: string; extraFormat?: Record<string, unknown>; extraQuery?: Record<string, unknown>; linkedCollection?: boolean; pageSort?: string[] } = {}): string {
  const c = col(collectionId);
  const schema = c?.schema ?? {};
  const id = opts.id ?? newId();
  const d = defaultViewFormat(type, schema);
  if (d.schemaPatch) for (const [pid, p] of Object.entries(d.schemaPatch)) tx.set('collection', collectionId, ['schema', pid], p);
  const format = { ...d.format, ...(opts.extraFormat ?? {}), ...(opts.linkedCollection ? { collection_pointer: { id: collectionId, table: 'collection', spaceId: tx.spaceId } } : {}) };
  tx.set('collection_view', id, [], {
    id, type, name: opts.name ?? VIEW_DEFAULT_NAMES[type] ?? 'View', format, query2: { ...d.query2, ...(opts.extraQuery ?? {}) },
    parent_id: blockId, parent_table: 'block', alive: true, space_id: tx.spaceId, page_sort: opts.pageSort ? [...opts.pageSort] : [],
  });
  return id;
}


export const viewCreationHooks: Partial<Record<string, (tx: Tx, viewId: string, collection: CollectionRecord) => void>> = {};

export function addView(block: BlockRecord, type: ViewType, opts: { name?: string; afterViewId?: string; collectionId?: string } = {}): string {
  const collectionId = opts.collectionId ?? block.collection_id ?? (block.format as any)?.collection_pointer?.id;
  if (!collectionId) return '';
  let id = '';
  // new views start without a manual page_sort, so rows list newest-first
  run('addView', (tx) => {
    id = createViewIn(tx, block.id, type, collectionId, { name: opts.name, linkedCollection: !!opts.collectionId && opts.collectionId !== block.collection_id });
    tx.listAfter('block', block.id, ['view_ids'], id, opts.afterViewId);
    const c = col(collectionId);
    if (c) viewCreationHooks[type]?.(tx, id, c);
  });
  return id;
}

export function duplicateView(block: BlockRecord, viewId: string): string {
  const v = viewRec(viewId);
  if (!v) return '';
  const id = newId();
  run('duplicateView', (tx) => {
    const { version: _v, ...rest } = v;
    tx.set('collection_view', id, [], { ...structuredClone(rest), id, name: `${v.name}`, parent_id: block.id });
    tx.listAfter('block', block.id, ['view_ids'], id, viewId);
  });
  return id;
}

export function deleteView(block: BlockRecord, viewId: string) {
  if ((block.view_ids ?? []).length <= 1) return;
  run('deleteView', (tx) => {
    tx.listRemove('block', block.id, ['view_ids'], viewId);
    tx.update('collection_view', viewId, [], { alive: false });
  });
}

export function reorderViews(block: BlockRecord, viewId: string, beforeId?: string) {
  run('reorderViews', (tx) => {
    if (beforeId) tx.listBefore('block', block.id, ['view_ids'], viewId, beforeId);
    else tx.listAfter('block', block.id, ['view_ids'], viewId);
  });
}


export function changeViewLayout(view: CollectionViewRecord, collectionId: string, type: ViewType) {
  const c = col(collectionId);
  if (!c || view.type === type) return;
  run('changeViewLayout', (tx) => {
    const d = defaultViewFormat(type, c.schema);
    if (d.schemaPatch) for (const [pid, p] of Object.entries(d.schemaPatch)) tx.set('collection', collectionId, ['schema', pid], p);
    const key = propertiesKeyFor(type);
    const keepProps = (view.format as any)?.[propertiesKeyFor(view.type)];
    const patch: Record<string, unknown> = { ...d.format };
    // keep the user's property order; visibility per layout default when switching to cards
    if (keepProps && (type === 'table' || type === 'list')) patch[key] = (keepProps as ViewPropEntry[]).map((e) => ({ ...e, visible: type === 'table' ? true : e.visible }));
    if ((view.format as any)?.[key]) delete patch[key];
    tx.update('collection_view', view.id, [], { type });
    tx.update('collection_view', view.id, ['format'], patch);
    const q2 = (viewRec(view.id) ?? view).query2; // the saved query (never a person's unsaved filters / sorts)
    tx.set('collection_view', view.id, ['query2'], { ...(q2 ?? {}), ...d.query2, aggregations: (d.query2 as any).aggregations ?? (view.type === 'board' ? [] : q2?.aggregations) });
    viewCreationHooks[type]?.(tx, view.id, c);
  });
}

// ---------- templates ----------

export function createTemplate(collectionId: string, title?: string): string {
  const id = newId();
  run('createTemplate', (tx) => {
    createBlockIn(tx, { id, type: 'page', parentId: collectionId, parentTable: 'collection', title: title ? [[title]] : [], list: null, extra: { is_template: true } });
    tx.listAfter('collection', collectionId, ['template_pages'], id);
  });
  return id;
}

export function deleteTemplate(collectionId: string, templateId: string) {
  run('deleteTemplate', (tx) => {
    tx.listRemove('collection', collectionId, ['template_pages'], templateId);
    tx.update('block', templateId, [], { alive: false });
  });
}

export function setDefaultTemplate(view: CollectionViewRecord | undefined, collectionId: string, templateId: string | 'empty' | null) {
  run('setDefaultTemplate', (tx) => {
    if (view) tx.update('collection_view', view.id, ['format'], { collection_view_default_template: templateId === null ? null : templateId === 'empty' ? 'empty' : { template_page_id: templateId } });
    else tx.update('collection', collectionId, [], { default_template_id: templateId && templateId !== 'empty' ? templateId : null });
  });
}

export async function duplicateTemplate(collectionId: string, templateId: string) {
  try {
    const res = await api<{ blockId: string }>('duplicateBlock', { blockId: templateId, parentId: collectionId, parentTable: 'collection' });
    run('duplicateTemplate', (tx) => tx.listAfter('collection', collectionId, ['template_pages'], res.blockId, templateId));
    return res.blockId;
  } catch (e) {
    console.error(e);
    return '';
  }
}

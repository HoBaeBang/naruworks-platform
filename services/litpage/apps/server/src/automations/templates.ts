// Database template instantiation (/003/004/005): copies a template page into a row of its data source —
// property values (template variables "Today / Now / Me" resolved for the person and time of duplication), icon and
// cover, and the whole content subtree: sub-pages with their content, inline databases (new data source with the
// template's rows) and linked database views (fresh view records; filters that point at the template page are
// re-pointed at the new page, so "Project contains <this template>" becomes "Project contains <new page>").
// Used by the applyDatabaseTemplate API, "Add page to … as <template>" (automations and buttons) and repeating
// templates.
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { instantiateProperties, type TemplateVarValues } from '@nc/shared/automation/index.ts';
import { childrenOf, getRecord } from '../db.ts';
import { applyTransactions, blockRole } from '../records.ts';
import { childBlocks } from '../tree.ts';

export class TemplateError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const MAX_OPS = 20_000;

export function userTimeZone(userId: string): string | undefined {
  const tz = getRecord<UserSettingsRecord>('user_settings', userId)?.settings?.time_zone;
  return typeof tz === 'string' && tz ? tz : undefined;
}

function replaceIds<T>(value: T, idMap: Map<string, string>): T {
  if (value === undefined || value === null || !idMap.size) return value;
  let s = JSON.stringify(value);
  for (const [from, to] of idMap) if (s.includes(from)) s = s.split(from).join(to);
  return JSON.parse(s) as T;
}

interface CopyState {
  ops: any[];
  spaceId: string;
  userId: string;
  now: number;
  vars: TemplateVarValues;
  /** template page id (and copied ids) → new ids, for filters / relations that reference them */
  idMap: Map<string, string>;
}

function push(st: CopyState, op: any) {
  if (st.ops.length >= MAX_OPS) throw new TemplateError('This template is too large', 413);
  st.ops.push(op);
}

/** Copy the views of a collection_view block (filters re-pointed through idMap). */
function copyViews(b: BlockRecord, newBlockId: string, st: CopyState, collectionMap: Map<string, string>): string[] {
  const out: string[] = [];
  for (const vid of b.view_ids ?? []) {
    const v = getRecord<CollectionViewRecord>('collection_view', vid);
    if (!v || v.alive === false || v.parent_id !== b.id) continue;
    const nid = newId();
    const { version: _v, applied_tx_ids: _a, ...rest } = v as any;
    let value = { ...rest, id: nid, parent_id: newBlockId, parent_table: 'block', space_id: st.spaceId };
    value = replaceIds(value, new Map([...st.idMap, ...collectionMap]));
    value.id = nid;
    push(st, { pointer: { table: 'collection_view', id: nid, spaceId: st.spaceId }, path: [], command: 'set', args: value });
    out.push(nid);
  }
  return out;
}

/** Copy one block (and its subtree) under `parentId`; returns the new id. */
function copyBlock(b: BlockRecord, parentId: string, parentTable: 'block' | 'collection', st: CopyState): string {
  const nid = newId();
  st.idMap.set(b.id, nid);
  const { version: _v, applied_tx_ids: _a, discussions: _d, permissions: _p, ...rest } = b as any;
  const value: any = {
    ...rest, id: nid, parent_id: parentId, parent_table: parentTable, space_id: st.spaceId, alive: true,
    properties: instantiateProperties(b.properties as Record<string, RichText> | undefined, st.vars),
    created_time: st.now, created_by_id: st.userId, created_by_table: 'lit_user', last_edited_time: st.now, last_edited_by_id: st.userId, copied_from: b.id,
  };
  delete value.is_template;
  const childIds: string[] = [];
  for (const c of childBlocks(b)) childIds.push(copyBlock(c, nid, 'block', st));
  value.content = childIds.length ? childIds : undefined;
  if (b.type === 'collection_view' || b.type === 'collection_view_page') {
    const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
    const collectionMap = new Map<string, string>();
    if (col && col.parent_id === b.id && col.alive !== false) {
      // inline database owned by the template: a new data source with copies of its rows
      const ncol = newId();
      collectionMap.set(col.id, ncol);
      const { version: _cv, applied_tx_ids: _ca, ...crest } = col as any;
      push(st, { pointer: { table: 'collection', id: ncol, spaceId: st.spaceId }, path: [], command: 'set', args: { ...crest, id: ncol, parent_id: nid, parent_table: 'block', space_id: st.spaceId, template_pages: [] } });
      for (const row of childrenOf<BlockRecord>('block', col.id)) {
        if (!row.alive || row.parent_table !== 'collection' || row.is_template) continue;
        copyBlock(row, ncol, 'collection', st);
      }
      value.collection_id = ncol;
      if (value.format?.collection_pointer?.id === col.id) value.format = { ...value.format, collection_pointer: { ...value.format.collection_pointer, id: ncol } };
    }
    value.view_ids = copyViews(b, nid, st, collectionMap);
  }
  push(st, { pointer: { table: 'block', id: nid, spaceId: st.spaceId }, path: [], command: 'set', args: value });
  return nid;
}

export interface TemplateOptions {
  /** template values replace values already on the row (Add page to … as template: "the template overrides") */
  override?: boolean;
  /** person who duplicated the page ("Me" variable); defaults to `userId` */
  actorId?: string;
  now?: number;
}

/** Operations that instantiate template `tpl` into `row` (both must be checked by the caller). */
export function templateOps(row: BlockRecord, tpl: BlockRecord, userId: string, opts: TemplateOptions = {}): any[] {
  const now = opts.now ?? Date.now();
  const actor = opts.actorId ?? userId;
  const st: CopyState = { ops: [], spaceId: row.space_id, userId, now, vars: { now, timeZone: userTimeZone(actor), userId: actor }, idMap: new Map([[tpl.id, row.id]]) };
  const tplProps = instantiateProperties(tpl.properties as Record<string, RichText> | undefined, st.vars);
  const props: Record<string, any> = { ...(row.properties ?? {}) };
  for (const [k, v] of Object.entries(tplProps)) {
    const cur = props[k] as RichText | undefined;
    const curEmpty = !cur || !cur.length || toPlainText(cur) === '';
    const tplEmpty = !v || !v.length || toPlainText(v) === '';
    if (curEmpty || (opts.override && !tplEmpty)) props[k] = v;
  }
  const content: string[] = [];
  for (const c of childBlocks(tpl)) content.push(copyBlock(c, row.id, 'block', st));
  // a relation of the template to itself ("this template") points at the new page
  const fixedProps = replaceIds(props, new Map([[tpl.id, row.id]]));
  const ops = st.ops;
  ops.push({ pointer: { table: 'block', id: row.id, spaceId: row.space_id }, path: ['properties'], command: 'set', args: fixedProps });
  if (tpl.format) {
    const { page_icon, page_cover, page_cover_position, page_full_width, page_small_text, page_font } = tpl.format as any;
    const fmt = Object.fromEntries(Object.entries({ page_icon, page_cover, page_cover_position, page_full_width, page_small_text, page_font }).filter(([, v]) => v !== undefined));
    const keep = opts.override ? {} : Object.fromEntries(Object.entries(row.format ?? {}).filter(([k]) => k in fmt));
    if (Object.keys(fmt).length) ops.push({ pointer: { table: 'block', id: row.id, spaceId: row.space_id }, path: ['format'], command: 'update', args: { ...fmt, ...keep } });
  }
  if (content.length) ops.push({ pointer: { table: 'block', id: row.id, spaceId: row.space_id }, path: ['content'], command: 'set', args: [...(row.content ?? []), ...content] });
  ops.push({ pointer: { table: 'block', id: row.id, spaceId: row.space_id }, path: [], command: 'update', args: { last_edited_time: now, last_edited_by_id: userId, copied_from: tpl.id } });
  return ops;
}

/** Is `tplId` a live template of the data source `row` belongs to (and readable by `userId`)? Only templates: an
 *  ordinary row of the database is no template (its values, including restricted ones, would be copied). */
export function templateOfRow(row: BlockRecord, tplId: string, userId: string): BlockRecord | null {
  const tpl = getRecord<BlockRecord>('block', tplId);
  if (!tpl || tpl.alive === false) return null;
  const col = row.parent_table === 'collection' ? getRecord<CollectionRecord>('collection', row.parent_id) : undefined;
  const ofThisDb = (tpl.parent_table === 'collection' && tpl.parent_id === row.parent_id && !!tpl.is_template) || !!col?.template_pages?.includes(tpl.id);
  if (!ofThisDb || blockRole(tpl.id, userId) === 'none') return null;
  return tpl;
}

/** Instantiate a template into an existing row as `userId` (permission-checked by the transaction guard). */
export function instantiateTemplate(rowId: string, templateId: string, userId: string, opts: TemplateOptions & { source?: string; clientId?: string } = {}) {
  const row = getRecord<BlockRecord>('block', rowId);
  if (!row || row.alive === false) throw new TemplateError('Not found', 404);
  const tpl = templateOfRow(row, templateId, userId);
  if (!tpl) throw new TemplateError('Not found', 404);
  const ops = templateOps(row, tpl, userId, opts);
  const changes = applyTransactions(userId, [{ id: newId(), spaceId: row.space_id, debug: { userAction: 'applyDatabaseTemplate' }, operations: ops }], opts.clientId, { source: opts.source });
  return { blockId: rowId, changes };
}

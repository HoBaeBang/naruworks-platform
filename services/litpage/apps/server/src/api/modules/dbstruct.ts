// Database structure endpoints : duplicate rows together with their sub-items , My Tasks across
// task databases (data contract for Home › My Tasks), sprint completion and unique ID lookup
// . Writes go through applyTransactions (same permission checks as client transactions).
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import {
  canEditDatabaseContent, childIdsOf, encodeRelation, parentMap, descendantIds, subitemConfigOf, isTaskDatabase, taskDatabaseInfo, planSprintCompletion,
  sprintInfoOf, sprintStatusOf, sprintDatesOf, dayIndex, getPropertyValue, type SprintSettings,
} from '@nc/shared/database/index.ts';
import { childrenOf, db as sqlite, getRecord, recordsInSpace } from '../../db.ts';
import { registerJobHandler, scheduleJob } from '../../scheduler.ts';
import { readableQueryContext } from '../../queryctx.ts';
import { applyTransactions, blockRole, RecordMapBuilder } from '../../records.ts';
import { childBlocks } from '../../tree.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { rowByUniqueId } from '../../rowdefaults.ts';
import { writableCopyValues } from '../../propaccess.ts';

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function rowsOf(collectionId: string): BlockRecord[] {
  return childrenOf<BlockRecord>('block', collectionId).filter((b) => b.parent_table === 'collection' && b.alive && !b.is_template);
}

type Op = { pointer: { table: string; id: string; spaceId: string }; path: string[]; command: string; args: unknown };

/** Copy a row's page content (nested blocks) under a new row id. */
function copyContent(parent: BlockRecord, newParentId: string, spaceId: string, uid: string, ops: Op[], budget: { n: number }): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (const b of childBlocks(parent)) {
    if (++budget.n > 20_000) throw new ApiError('These pages are too large to duplicate', 413);
    const nid = newId();
    const content = b.type === 'page' || b.type === 'collection_view_page' || b.type === 'collection_view' ? undefined : copyContent(b, nid, spaceId, uid, ops, budget);
    const { version: _v, applied_tx_ids: _a, permissions: _p, discussions: _d, ...rest } = b as any;
    if (b.type === 'collection_view' || b.type === 'collection_view_page') continue; // nested databases are not copied by row duplication
    ops.push({ pointer: { table: 'block', id: nid, spaceId }, path: [], command: 'set', args: { ...rest, id: nid, parent_id: newParentId, parent_table: 'block', content: content?.length ? content : undefined, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, copied_from: b.id } });
    out.push(nid);
  }
  return out;
}

export const handlers = {
  /**
   * Duplicate database rows; with sub-items on, every sub-item below them is duplicated too and the copies are linked to
   * each other (copy of a parent → copies of its sub-items). Copies land right after their originals in manual orders.
   */
  duplicateDatabaseRows(ctx: Ctx, { rowIds }: { rowIds: string[] }) {
    const uid = requireUser(ctx);
    const ids = (Array.isArray(rowIds) ? rowIds : []).filter((x) => typeof x === 'string').slice(0, 100);
    if (!ids.length) throw new ApiError('Nothing to duplicate', 400);
    const first = getRecord<BlockRecord>('block', ids[0]);
    if (!first || first.parent_table !== 'collection' || blockRole(first.id, uid) === 'none') throw new ApiError('Not found', 404);
    const col = getRecord<CollectionRecord>('collection', first.parent_id);
    if (!col) throw new ApiError('Not found', 404);
    const spaceId = first.space_id;
    const all = rowsOf(col.id);
    const cfg = subitemConfigOf(col);
    const requested = ids.map((id) => getRecord<BlockRecord>('block', id)).filter((r): r is BlockRecord => !!r && r.alive && r.parent_table === 'collection' && r.parent_id === col.id && blockRole(r.id, uid) !== 'none');
    if (!requested.length) throw new ApiError('Not found', 404);
    const parent = cfg ? parentMap(all, cfg) : new Map<string, string>();
    const requestedIds = new Set(requested.map((r) => r.id));
    // a requested row that sits below another requested row is copied as part of that subtree
    const roots = requested.filter((r) => {
      for (let p = parent.get(r.id), i = 0; p && i < 50; p = parent.get(p), i++) if (requestedIds.has(p)) return false;
      return true;
    });
    const toCopy = [...roots.map((r) => r.id), ...(cfg ? descendantIds(roots.map((r) => r.id), parent).filter((id) => blockRole(id, uid) !== 'none') : [])];
    const idMap = new Map(toCopy.map((id) => [id, newId()]));
    const ops: Op[] = [];
    const budget = { n: 0 };
    const now = Date.now();
    for (const oldId of toCopy) {
      const row = getRecord<BlockRecord>('block', oldId)!;
      const nid = idMap.get(oldId)!;
      const content = copyContent(row, nid, spaceId, uid, ops, budget);
      const { version: _v, applied_tx_ids: _a, permissions: _p, discussions: _d, ...rest } = row as any;
      // restricted values the duplicator couldn't see on the original or can't edit on a new page stay behind 
      const props: Record<string, unknown> = { ...(writableCopyValues(row, row.properties as Record<string, unknown> | undefined, uid) ?? {}) };
      const isRoot = roots.some((r) => r.id === oldId);
      if (isRoot) props.title = [[`${toPlainText(row.properties?.title) || 'Untitled'} (1)`]];
      if (cfg) {
        const kids = childIdsOf(row, cfg).filter((k) => idMap.has(k)).map((k) => idMap.get(k)!);
        if (kids.length) props[cfg.property] = encodeRelation(kids, spaceId);
        else delete props[cfg.property];
        const p = parent.get(oldId);
        if (p && idMap.has(p)) props[cfg.inverse] = encodeRelation([idMap.get(p)!], spaceId);
      }
      ops.push({ pointer: { table: 'block', id: nid, spaceId }, path: [], command: 'set', args: { ...rest, id: nid, properties: props, content: content.length ? content : undefined, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, copied_from: oldId } });
    }
    // copies of top-level rows that are sub-items themselves join their original parent's Sub-item list
    if (cfg) {
      for (const r of roots) {
        const p = parent.get(r.id);
        const pr = p ? getRecord<BlockRecord>('block', p) : undefined;
        if (!pr) continue;
        const kids = childIdsOf(pr, cfg);
        const at = kids.indexOf(r.id);
        kids.splice(at < 0 ? kids.length : at + 1, 0, idMap.get(r.id)!);
        ops.push({ pointer: { table: 'block', id: pr.id, spaceId }, path: ['properties', cfg.property], command: 'set', args: encodeRelation(kids, spaceId) });
      }
    }
    // manual orders: copies right after their originals
    const host = getRecord<BlockRecord>('block', col.parent_id);
    for (const vid of host?.view_ids ?? []) {
      const v = getRecord<CollectionViewRecord>('collection_view', vid);
      if (!v?.page_sort?.length || !canEditDatabaseContent(blockRole(v.parent_id, uid))) continue;
      const order = [...v.page_sort];
      let changed = false;
      for (const oldId of toCopy) {
        const i = order.indexOf(oldId);
        if (i < 0) continue;
        order.splice(i + 1, 0, idMap.get(oldId)!);
        changed = true;
      }
      if (changed) ops.push({ pointer: { table: 'collection_view', id: v.id, spaceId }, path: ['page_sort'], command: 'set', args: order });
    }
    const changes = applyTransactions(uid, [{ id: newId(), spaceId, debug: { userAction: 'duplicateDatabaseRows' }, operations: ops as never }]);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { rowIds: roots.map((r) => idMap.get(r.id)!), recordMap: rm.map };
  },

  /**
   * Home › My Tasks data : tasks assigned to the caller across the workspace's Tasks databases
   * (collection.format.app_config_uri = the tasks collection URI, Assignee role contains me), due date first.
   * Response: {databases:[{collectionId, blockId, name, statusProperty, assigneeProperty, dueProperty}], taskIds, recordMap}.
   */
  getMyTasks(ctx: Ctx, { spaceId, limit }: { spaceId: string; limit?: number }) {
    const uid = requireUser(ctx);
    const sid = String(spaceId ?? '');
    const max = Math.max(1, Math.min(500, Number(limit) || 200));
    const rm = new RecordMapBuilder(uid);
    const databases: { collectionId: string; blockId: string; name: string; statusProperty?: string; assigneeProperty?: string; dueProperty?: string }[] = [];
    const tasks: { row: BlockRecord; due: number }[] = [];
    const qctx = readableQueryContext(uid);
    for (const c of recordsInSpace<CollectionRecord>('collection', sid)) {
      if (c.alive === false || !isTaskDatabase(c) || blockRole(c.parent_id, uid) === 'none') continue;
      const info = taskDatabaseInfo(c)!;
      if (!info.assignee || databases.length >= 10) continue;
      databases.push({ collectionId: c.id, blockId: c.parent_id, name: toPlainText(c.name as never) || 'Untitled', statusProperty: info.status, assigneeProperty: info.assignee, dueProperty: info.due });
      rm.add('collection', c);
      rm.add('block', getRecord<BlockRecord>('block', c.parent_id));
      for (const row of rowsOf(c.id)) {
        const people = getPropertyValue(row, info.assignee, c.schema, qctx);
        if (people.kind !== 'person' || !people.ids.includes(uid) || blockRole(row.id, uid) === 'none') continue;
        const due = info.due ? getPropertyValue(row, info.due, c.schema, qctx) : null;
        tasks.push({ row, due: due?.kind === 'date' && due.date ? due.date.startMs : Number.POSITIVE_INFINITY });
      }
    }
    tasks.sort((a, b) => a.due - b.due || (b.row.last_edited_time ?? 0) - (a.row.last_edited_time ?? 0));
    for (const t of tasks.slice(0, max)) rm.add('block', t.row);
    return { databases, taskIds: tasks.slice(0, max).map((t) => t.row.id), recordMap: rm.map };
  },

  /** Complete the current sprint of a Tasks database (same plan as the Complete sprint button). */
  completeSprint(ctx: Ctx, { tasksCollectionId, incomplete, nextDates }: { tasksCollectionId: string; incomplete?: SprintSettings['incomplete_tasks']; nextDates?: { start: string; end: string } }) {
    const uid = requireUser(ctx);
    const tasks = getRecord<CollectionRecord>('collection', String(tasksCollectionId ?? ''));
    if (!tasks || blockRole(tasks.parent_id, uid) === 'none') throw new ApiError('Not found', 404);
    const changes = runSprintCompletion(uid, tasks, { incomplete, nextDates });
    if (!changes) throw new ApiError('There is no current sprint', 400);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { recordMap: rm.map };
  },

  /** An empty ID maps to the page with that Unique ID (ID URLs /<domain>/). Only pages the caller can open. */
  resolveUniqueId(ctx: Ctx, { uid: text, spaceId }: { uid: string; spaceId?: string }) {
    const me = requireUser(ctx);
    const m = /^([A-Za-z][A-Za-z0-9-]{0,9})-(\d{1,9})$/.exec(String(text ?? '').trim());
    if (!m) throw new ApiError('Not found', 404);
    const prefix = m[1].toUpperCase();
    const n = Number(m[2]);
    const candidates = sqlite.prepare(`SELECT data FROM records WHERE tbl = 'collection' AND alive = 1 AND data LIKE '%"auto_increment_id"%' LIMIT 2000`).all() as { data: string }[];
    const found: BlockRecord[] = [];
    for (const r of candidates) {
      const c = JSON.parse(r.data) as CollectionRecord;
      const idProp = Object.entries(c.schema ?? {}).find(([, p]) => p.type === 'auto_increment_id' && String(p.prefix ?? '').toUpperCase() === prefix)?.[0];
      if (!idProp) continue;
      const row = rowByUniqueId(c.id, idProp, n);
      if (row && blockRole(row.id, me) !== 'none') found.push(row);
    }
    if (!found.length) throw new ApiError('Not found', 404);
    // several databases may use the same prefix: prefer the requested workspace
    const best = found.find((b) => b.space_id === spaceId) ?? found[0];
    const rm = new RecordMapBuilder(me);
    rm.add('block', best);
    return { pageId: best.id, spaceId: best.space_id, recordMap: rm.map };
  },
};

function todayIso(now = Date.now()): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Apply planSprintCompletion as `uid` (permission checked by applyTransactions). */
function runSprintCompletion(uid: string, tasks: CollectionRecord, opts: { incomplete?: SprintSettings['incomplete_tasks']; nextDates?: { start: string; end: string } | null }) {
  const info = sprintInfoOf(tasks, (id) => getRecord<CollectionRecord>('collection', id));
  if (!info) return null;
  const plan = planSprintCompletion(info, { sprints: rowsOf(info.sprints.id), tasks: rowsOf(tasks.id) }, { incomplete: opts.incomplete ?? info.settings.incomplete_tasks, nextDates: opts.nextDates ?? null, today: todayIso(), newId });
  if (!plan.completedSprintId) return null;
  const spaceId = tasks.space_id;
  const now = Date.now();
  const ops: Op[] = [];
  for (const c of plan.creates) ops.push({ pointer: { table: 'block', id: c.id, spaceId }, path: [], command: 'set', args: { id: c.id, type: 'page', properties: c.properties, parent_id: info.sprints.id, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid } });
  for (const w of plan.writes) {
    ops.push({ pointer: { table: 'block', id: w.rowId, spaceId }, path: ['properties', w.propId], command: 'set', args: w.value });
    ops.push({ pointer: { table: 'block', id: w.rowId, spaceId }, path: [], command: 'update', args: { last_edited_time: now, last_edited_by_id: uid } });
  }
  return applyTransactions(uid, [{ id: newId(), spaceId, debug: { userAction: 'completeSprint' }, operations: ops as never }]);
}

// Automated sprints: an hourly check completes every sprint whose end date
// has passed, as the person who turned automation on (sprint_settings.automated_by — only ever the writer, for a Sprints
// database they can edit: dbaccess.ts). Re-checked here: that person must still edit both databases.
export function runAutomatedSprints(now = Date.now()) {
  const today = dayIndex(todayIso(now));
  for (const c of automatedSprintCollections()) {
    // one database failing (access lost, a refused write) never stops the others
    try {
      const info = sprintInfoOf(c, (id) => getRecord<CollectionRecord>('collection', id));
      const by = (c.format?.sprint_settings as { automated_by?: string } | undefined)?.automated_by;
      if (!info || !by) continue;
      if (!canEditDatabaseContent(blockRole(c.parent_id, by)) || !canEditDatabaseContent(blockRole(info.sprints.parent_id, by))) continue;
      const cur = rowsOf(info.sprints.id).find((r) => sprintStatusOf(r, info) === 'Current');
      const dates = sprintDatesOf(cur, info);
      if (dates && dayIndex(dates.end) < today) runSprintCompletion(by, c, {});
    } catch (e) {
      console.error('[sprints] automated completion failed', c.id, e);
    }
  }
}

registerJobHandler('sprints.tick', () => {
  try {
    runAutomatedSprints();
  } finally {
    scheduleJob('sprints.tick', 'sprints:tick', Date.now() + 3600_000, null);
  }
});

/** Tasks databases with "Automated sprints" on (cheap LIKE prefilter, then the real check). */
function automatedSprintCollections(): CollectionRecord[] {
  const rows = sqlite.prepare(`SELECT data FROM records WHERE tbl = 'collection' AND data LIKE '%"automated":true%' LIMIT 500`).all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as CollectionRecord).filter((c) => c.alive !== false && (c.format?.sprint_settings as { automated?: boolean } | undefined)?.automated === true);
}

scheduleJob('sprints.tick', 'sprints:tick', Date.now() + 60_000, null);

// Page-level endpoints: version history (list / preview / restore), idle snapshots, page analytics
// (views, viewers, editors) and the page "Updates" feed.
// `•••` → Version history, Updates & analytics.
import { newId } from '@nc/shared/ids.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, CommentRecord, DiscussionRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { isDatabaseLocked } from '@nc/shared/database/access.ts';
import { childrenOf, db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { getSnapshot, listSnapshots, serializePage, takeSnapshot, type DatabaseSnapshot } from '../../history.ts';
import { redactVersionData, restorableProperties } from '../../versionAccess.ts';
import { deletedSchemaOf } from '../../propaccess.ts';
import { pageViewsEnabled } from '../../policy.ts';
import { noteSearchClick } from '../../searchLog.ts';

type Handler = (ctx: Ctx, body: any) => any;

const PAGE_TYPES = new Set(['page', 'collection_view_page']);
const IDLE_SNAPSHOT_MS = 60 * 1000; // Version history 2.0 groups changes per minute ("Group by 1m");  says ≤2 min after the last edit
const MIN_SNAPSHOT_GAP_MS = 60 * 1000;

db.exec(`
CREATE TABLE IF NOT EXISTS page_views (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  space_id TEXT,
  user_id TEXT,
  time INTEGER NOT NULL,
  public INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_page_views_page ON page_views(page_id, time);
CREATE TABLE IF NOT EXISTS snapshot_bookmarks (
  snapshot_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  name TEXT,
  created_time INTEGER NOT NULL,
  PRIMARY KEY (snapshot_id, user_id)
);
`);

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function requirePage(pageId: string, userId: string | null, min: 'reader' | 'read_and_write' | 'editor' = 'reader'): BlockRecord {
  const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
  if (!page) throw new ApiError('Not found', 404);
  const role = blockRole(page.id, userId);
  if (!roleAtLeast(role, min)) throw new ApiError(role === 'none' ? 'Not found' : 'Not allowed', role === 'none' ? 404 : 403);
  return page;
}

/** Comparable content fingerprint of a serialized page (ignores versions/edit stamps); databases count with their
 *  properties, records' property values and views . */
function contentKey(data: { blocks: BlockRecord[]; databases?: Record<string, DatabaseSnapshot> }): string {
  const strip = (r: any) => {
    const { version: _v, last_edited_time: _t, last_edited_by_id: _u, last_edited_by_table: _ut, discussions: _d, applied_tx_ids: _a, ...rest } = r ?? {};
    return rest;
  };
  const dbs = Object.values(data.databases ?? {}).map((d) => ({
    blockId: d.blockId, collection: d.collection ? strip(d.collection) : null, views: d.views.map(strip),
    rows: (d.rows ?? []).map((r) => [r.id, r.properties ?? {}]),
  }));
  return JSON.stringify([data.blocks.map(strip), dbs]);
}

function latestSnapshotRow(pageId: string): { id: string; created_time: number; data: string } | undefined {
  return db.prepare('SELECT id, created_time, data FROM snapshots WHERE page_id = ? ORDER BY created_time DESC LIMIT 1').get(pageId) as any;
}

/** Snapshot the page unless its content equals the latest snapshot. Returns true if a snapshot was taken. */
export function snapshotIfChanged(pageId: string, authors: string[], now = Date.now()): boolean {
  const page = getRecord<BlockRecord>('block', pageId);
  if (!page) return false;
  const last = latestSnapshotRow(pageId);
  if (last) {
    try {
      if (contentKey(JSON.parse(last.data)) === contentKey(serializePage(pageId))) return false;
    } catch {
      /* corrupt row: take a fresh snapshot */
    }
  }
  takeSnapshot(pageId, authors.length ? authors : [page.last_edited_by_id ?? page.created_by_id], now);
  return true;
}

// Idle snapshots: the service records a version 2 minutes after the last edit (and every 10 minutes while
// editing — history.ts). Scans recent activity rows (history.ts coalesces one row per user/page/5min).
function idleSnapshotTick() {
  const now = Date.now();
  try {
    const rows = db.prepare(`SELECT page_id, MAX(COALESCE(json_extract(data, '$.last'), created_time)) AS last
                             FROM activity WHERE created_time > ? GROUP BY page_id`).all(now - 6 * 3600_000) as any[];
    for (const r of rows) {
      const last = Number(r.last) || 0;
      if (now - last > 3600_000) continue;
      const snap = latestSnapshotRow(r.page_id);
      if (snap && snap.created_time >= last) continue; // nothing new since the latest version
      // one version per minute while editing, and one after the editing stops
      if (now - last < IDLE_SNAPSHOT_MS && snap && now - snap.created_time < MIN_SNAPSHOT_GAP_MS) continue;
      if (now - last < IDLE_SNAPSHOT_MS && !snap) continue;
      const since = snap?.created_time ?? 0;
      const authors = (db.prepare('SELECT DISTINCT user_id FROM activity WHERE page_id = ? AND COALESCE(json_extract(data, \'$.last\'), created_time) > ?')
        .all(r.page_id, since) as any[]).map((x) => x.user_id).filter(Boolean);
      const block = getRecord<BlockRecord>('block', r.page_id);
      if (!block || !block.alive) continue;
      snapshotIfChanged(r.page_id, authors, now);
    }
  } catch (e) {
    console.error('[pages] idle snapshot failed', e);
  }
}
const timer = setInterval(idleSnapshotTick, 15_000);
(timer as any).unref?.();

function addUsers(rm: RecordMapBuilder, ids: Iterable<string | undefined | null>) {
  for (const id of ids) if (id) rm.add('lit_user', getRecord('lit_user', id), 'reader');
}

/** Restore a snapshot into the live page (page content + metadata; permissions/comments/location stay). */
function restoreOps(pageId: string, blocks: BlockRecord[], uid: string, now: number) {
  const ops: any[] = [];
  const current = getRecord<BlockRecord>('block', pageId)!;
  const snapIds = new Set(blocks.map((b) => b.id));
  const ptr = (id: string) => ({ table: 'block', id, spaceId: current.space_id });
  for (const b of blocks) {
    const { version: _v, ...rest } = b as any;
    if (b.id === pageId) {
      ops.push({
        pointer: ptr(b.id), path: [], command: 'set',
        args: {
          ...rest,
          // a database row page: restricted values the restorer can't edit (or see) keep today's value 
          ...(current.parent_table === 'collection' ? { properties: restorableProperties(current, (rest as any).properties, uid) } : {}),
          alive: current.alive,
          parent_id: current.parent_id, parent_table: current.parent_table,
          permissions: current.permissions, discussions: current.discussions,
          last_edited_time: now, last_edited_by_id: uid, last_edited_by_table: 'lit_user',
          // a full-page database keeps today's lock state 
          ...(current.type === 'collection_view_page' ? { format: { ...((rest as any).format ?? {}), block_locked: (current.format as any)?.block_locked, block_locked_by: (current.format as any)?.block_locked_by } } : {}),
        },
      });
      continue;
    }
    const live = getRecord<BlockRecord>('block', b.id);
    if (PAGE_TYPES.has(b.type)) {
      // nested pages keep their own content/history; only bring them back under this page (not ones restricted from
      // the restorer: they stay as they are)
      if (live && blockRole(live.id, uid) === 'none') continue;
      if (live) ops.push({ pointer: ptr(b.id), path: [], command: 'update', args: { alive: true, parent_id: b.parent_id, parent_table: b.parent_table } });
      else ops.push({ pointer: ptr(b.id), path: [], command: 'set', args: { ...rest, alive: true } });
      continue;
    }
    // a locked database block is left exactly as it is (its lock freezes it; the restore reports it unchanged)
    if (live && isDatabaseLocked(live) && (live.type === 'collection_view' || live.type === 'collection_view_page')) continue;
    // a database keeps today's lock: restoring a version never unlocks (or locks) it 
    const lock = (b.type === 'collection_view' || b.type === 'collection_view_page') && live
      ? { format: { ...((rest as any).format ?? {}), block_locked: (live.format as any)?.block_locked, block_locked_by: (live.format as any)?.block_locked_by } }
      : {};
    ops.push({
      pointer: ptr(b.id), path: [], command: 'set',
      args: { ...rest, alive: true, discussions: live?.discussions ?? (rest as any).discussions, ...lock },
    });
  }
  // blocks added after this version are removed (subpages go to Trash, as expected restore)
  const live = serializePage(pageId).blocks;
  for (const b of live) {
    if (b.id === pageId || snapIds.has(b.id)) continue;
    if (isDatabaseLocked(b) && (b.type === 'collection_view' || b.type === 'collection_view_page')) continue; // locked: stays
    if (PAGE_TYPES.has(b.type) && blockRole(b.id, uid) === 'none') continue; // a sub-page restricted from the restorer
    ops.push({
      pointer: ptr(b.id), path: [], command: 'update',
      args: PAGE_TYPES.has(b.type) ? { alive: false, deleted_time: now, deleted_by_id: uid } : { alive: false },
    });
  }
  return ops;
}

// ---------------------------------------------------------------- databases in a version 
// Restoring brings back a database's properties (data source: schema, name, icon, description), its records and their
// property values (records added since that the restorer can edit go to Trash, records deleted since come back) and
// its views — never the records' page content ("To restore database page content, restore an earlier version
// for each page"). Full access to the database is required and a locked database is left as it is; on a page with
// inline databases the person chooses "Also restore databases on this page". Linked databases (data source elsewhere)
// only get their views back.

type DatabaseRestoreStatus = 'restored' | 'unchanged' | 'removed' | 'views_only';

/** Can `uid` restore the data of database block `blockId` (full access, not locked)? */
function databaseRestoreProblem(blockId: string, uid: string): string | null {
  const block = getRecord<BlockRecord>('block', blockId);
  if (!block || block.alive === false) return null; // comes back with the page's blocks
  if (blockRole(block.id, uid) !== 'editor') return 'Full access is required to restore this database.';
  if (isDatabaseLocked(block)) return 'This database is locked. Unlock it to change its views and properties.';
  return null;
}

/** Operations that put database `d` back the way it was (data source, records, views). */
function databaseRestoreOps(d: DatabaseSnapshot, uid: string, now: number, viewsOnly: boolean, versionTime: number): any[] {
  const ops: any[] = [];
  const space = getRecord<BlockRecord>('block', d.blockId)?.space_id;
  const ptr = (table: string, id: string) => ({ table, id, spaceId: space });
  for (const v of d.views) {
    const { version: _v, ...rest } = v as any;
    ops.push({ pointer: ptr('collection_view', v.id), path: [], command: 'set', args: { ...rest, alive: true } });
  }
  if (viewsOnly || !d.owned || !d.collection) return ops;
  const live = getRecord<CollectionRecord>('collection', d.collection.id);
  const { version: _cv, ...col } = d.collection as any;
  // server-kept fields stay as they are now: page-level access rules, property access rules (restoring a
  // previous version keeps the current rules"), the sprint automation's owner; properties added since go to Deleted
  // properties (restorable) instead of vanishing with their values
  ops.push({ pointer: ptr('collection', d.collection.id), path: [], command: 'set', args: { ...col, ...(live ? keptCollectionFields(col, live, now) : {}), alive: true } });
  const snapRows = new Map((d.rows ?? []).map((r) => [r.id, r]));
  for (const r of d.rows ?? []) {
    const cur = getRecord<BlockRecord>('block', r.id);
    if (cur && cur.parent_id !== d.collection.id) continue; // moved to another database since: leave it there
    // values of properties the version didn't have yet stay (those properties become deleted ones, restorable)
    const kept = Object.fromEntries(Object.entries(cur?.properties ?? {}).filter(([k]) => !d.collection!.schema[k]));
    if (cur) ops.push({ pointer: ptr('block', r.id), path: [], command: 'update', args: { properties: { ...kept, ...(r.properties ?? {}) }, alive: true, last_edited_time: now, last_edited_by_id: uid } });
    else {
      const { version: _rv, ...row } = r as any;
      ops.push({ pointer: ptr('block', r.id), path: [], command: 'set', args: { ...row, alive: true, content: [] } });
    }
  }
  // records that weren't in this version (that the restorer can edit) go to Trash; a version that stored only the
  // first 1000 records can only tell records created after it
  const capped = (d.rows?.length ?? 0) >= 1000;
  for (const r of childrenOf<BlockRecord>('block', d.collection.id)) {
    if (r.parent_table !== 'collection' || !r.alive || r.is_template || snapRows.has(r.id)) continue;
    if (capped && (r.created_time ?? 0) <= versionTime) continue;
    if (!['editor', 'read_and_write'].includes(blockRole(r.id, uid))) continue;
    ops.push({ pointer: ptr('block', r.id), path: [], command: 'update', args: { alive: false, deleted_time: now, deleted_by_id: uid } });
  }
  return ops;
}

/** Fields of a restored data source that stay as they are today (see databaseRestoreOps). */
function keptCollectionFields(col: any, live: CollectionRecord, now: number): Record<string, unknown> {
  const liveDeleted = deletedSchemaOf(live) ?? {};
  const schema: Record<string, any> = {};
  for (const [pid, p] of Object.entries((col.schema ?? {}) as Record<string, any>)) {
    const cur = live.schema[pid] ?? liveDeleted[pid];
    if (!cur) { schema[pid] = p; continue; } // deleted for good since: comes back as the version had it
    const { property_permissions: _rule, ...rest } = p ?? {};
    schema[pid] = cur.property_permissions ? { ...rest, property_permissions: cur.property_permissions } : rest;
  }
  const deleted: Record<string, any> = {};
  for (const [pid, p] of Object.entries(liveDeleted)) if (p && !schema[pid]) deleted[pid] = p;
  for (const [pid, p] of Object.entries(live.schema)) if (!schema[pid]) deleted[pid] = { ...p, deleted_time: now };
  const liveSprints = (live.format as any)?.sprint_settings;
  const format = { ...(col.format ?? {}) };
  if (liveSprints) format.sprint_settings = liveSprints;
  else delete format.sprint_settings;
  return { permission_rules: (live as any).permission_rules, schema, deleted_schema: deleted, format };
}

/** What restoring `databases` does to each database (restore panel "Will be restored / unchanged / removed"). */
function databaseRestorePlan(pageId: string, databases: Record<string, DatabaseSnapshot>, uid: string, restoreInline: boolean) {
  const plan: { blockId: string; name: string; status: DatabaseRestoreStatus; reason?: string; owned: boolean; rows: number; inline: boolean }[] = [];
  for (const d of Object.values(databases)) {
    const inline = d.blockId !== pageId;
    const name = toPlainText((d.collection ?? getRecord<CollectionRecord>('collection', d.collectionId ?? ''))?.name) || 'Untitled';
    let status: DatabaseRestoreStatus = !d.owned ? 'views_only' : inline && !restoreInline ? 'unchanged' : 'restored';
    let reason: string | undefined;
    if (status === 'restored') {
      const problem = databaseRestoreProblem(d.blockId, uid);
      if (problem) { status = 'unchanged'; reason = problem; }
    }
    plan.push({ blockId: d.blockId, name, status, reason, owned: d.owned, rows: d.rows?.length ?? 0, inline });
  }
  // inline databases added after this version are taken off the page with the rest of the new blocks
  for (const b of serializePage(pageId).blocks) {
    if (b.type !== 'collection_view' || databases[b.id]) continue;
    const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
    plan.push({ blockId: b.id, name: toPlainText(col?.name) || 'Untitled', status: 'removed', owned: col?.parent_id === b.id, rows: 0, inline: true });
  }
  return plan;
}

/** Changes between two versions of a page for the Updates feed: page properties (title, icon, cover)
 *  and added / edited / removed blocks in document order (first 5 + count of the rest). */
function diffVersions(pageId: string, prev: BlockRecord[], next: BlockRecord[], touched: Set<string>) {
  const prevMap = new Map(prev.map((b) => [b.id, b]));
  const nextMap = new Map(next.map((b) => [b.id, b]));
  const props: { key: 'title' | 'icon' | 'cover'; before: unknown; after: unknown }[] = [];
  const p0 = prevMap.get(pageId);
  const p1 = nextMap.get(pageId);
  if (p0 && p1) {
    const t0 = toPlainText(p0.properties?.title);
    const t1 = toPlainText(p1.properties?.title);
    if (t0 !== t1) props.push({ key: 'title', before: t0, after: t1 });
    const f0 = (p0.format ?? {}) as any;
    const f1 = (p1.format ?? {}) as any;
    if ((f0.page_icon ?? null) !== (f1.page_icon ?? null)) props.push({ key: 'icon', before: f0.page_icon ?? null, after: f1.page_icon ?? null });
    if ((f0.page_cover ?? null) !== (f1.page_cover ?? null)) props.push({ key: 'cover', before: f0.page_cover ?? null, after: f1.page_cover ?? null });
  }
  const key = (b: BlockRecord) => JSON.stringify([b.type, b.properties ?? {}, (b.format as any)?.block_color ?? null, (b as any).checked ?? null]);
  const changes: { id: string; type: string; title: unknown; status: 'added' | 'edited' | 'removed'; before?: unknown }[] = [];
  for (const b of next) {
    if (b.id === pageId) continue;
    const old = prevMap.get(b.id);
    if (!old) changes.push({ id: b.id, type: b.type, title: b.properties?.title ?? [], status: 'added' });
    else if (key(old) !== key(b)) changes.push({ id: b.id, type: b.type, title: b.properties?.title ?? [], status: 'edited', before: old.properties?.title ?? [] });
  }
  for (const b of prev) {
    if (b.id === pageId || nextMap.has(b.id)) continue;
    changes.push({ id: b.id, type: b.type, title: b.properties?.title ?? [], status: 'removed' });
  }
  // without a usable "before" version (first session) fall back to the activity's touched blocks
  const relevant = prev.length ? changes : changes.filter((c) => touched.has(c.id));
  return { props, changes: relevant.slice(0, 5), moreChanges: Math.max(0, relevant.length - 5) };
}

/** Plain-text preview of a block for the Updates feed. */
function blockPreview(b: BlockRecord | undefined): { id: string; type: string; text: string; alive: boolean } | null {
  if (!b) return null;
  return { id: b.id, type: b.type, text: toPlainText(b.properties?.title).replace(/[‣⁍]/g, '').slice(0, 280), alive: b.alive };
}

export const handlers: Record<string, Handler> = {
  /** Version history sidebar: snapshots newest first; the first one may equal the live page ("Current version"). */
  getVersionHistory(ctx, { pageId, limit }) {
    const uid = requireUser(ctx);
    const page = requirePage(pageId, uid, 'read_and_write');
    if (!latestSnapshotRow(page.id)) takeSnapshot(page.id, [page.created_by_id ?? uid]);
    else {
      // the newest entry is always the live page ("Current version"): fold edits made since the latest
      // version into one now, credited to the people who made them
      const since = latestSnapshotRow(page.id)?.created_time ?? 0;
      const authors = (db.prepare('SELECT DISTINCT user_id FROM activity WHERE page_id = ? AND COALESCE(json_extract(data, \'$.last\'), created_time) > ?')
        .all(page.id, since) as any[]).map((x) => x.user_id).filter(Boolean);
      snapshotIfChanged(page.id, authors);
    }
    const snaps = listSnapshots(page.id, Math.min(Number(limit) || 200, 500));
    const live = contentKey(serializePage(page.id));
    const rm = new RecordMapBuilder(uid);
    const versions = snaps.map((s, i) => {
      let current = false;
      if (i === 0) {
        const row = getSnapshot(s.id);
        current = !!row && contentKey(row.data) === live;
      }
      addUsers(rm, s.authorIds);
      return { id: s.id, createdTime: s.createdTime, authorIds: s.authorIds, current };
    });
    const bookmarks: Record<string, string> = {};
    for (const b of db.prepare(`SELECT b.snapshot_id, b.name FROM snapshot_bookmarks b JOIN snapshots s ON s.id = b.snapshot_id WHERE s.page_id = ? AND b.user_id = ?`).all(page.id, uid) as any[]) {
      bookmarks[b.snapshot_id] = b.name || '';
    }
    return { versions, bookmarks, recordMap: rm.map };
  },

  /** "Bookmark this version" (name = null removes the bookmark). */
  bookmarkVersion(ctx, { snapshotId, name }) {
    const uid = requireUser(ctx);
    const snap = getSnapshot(String(snapshotId ?? ''));
    if (!snap) throw new ApiError('Not found', 404);
    requirePage(snap.pageId, uid, 'read_and_write');
    if (name === null || name === undefined || name === false) db.prepare('DELETE FROM snapshot_bookmarks WHERE snapshot_id = ? AND user_id = ?').run(snap.id, uid);
    else db.prepare('INSERT INTO snapshot_bookmarks (snapshot_id, user_id, name, created_time) VALUES (?, ?, ?, ?) ON CONFLICT(snapshot_id, user_id) DO UPDATE SET name = excluded.name').run(snap.id, uid, String(name).slice(0, 200), Date.now());
    return {};
  },

  /** Blocks of one version for the read-only preview. */
  getVersionPreview(ctx, { snapshotId }) {
    const uid = requireUser(ctx);
    const snap = getSnapshot(String(snapshotId ?? ''));
    if (!snap) throw new ApiError('Not found', 404);
    requirePage(snap.pageId, uid, 'read_and_write');
    const rm = new RecordMapBuilder(uid);
    addUsers(rm, snap.authorIds);
    // the version as this person may see the page today (versionAccess.ts): rows / values / properties / sub-pages
    // hidden from them stay out
    const data = redactVersionData(snap.pageId, snap.data ?? {}, uid);
    const blocks = (data.blocks ?? []) as BlockRecord[];
    for (const b of blocks) {
      for (const deco of Object.values(b.properties ?? {})) {
        for (const d of (deco as any[]) ?? []) {
          for (const a of d?.[1] ?? []) {
            if (a[0] === 'u') addUsers(rm, [a[1]]);
            if (a[0] === 'p') { const mb = getRecord<BlockRecord>('block', a[1]); if (mb && blockRole(mb.id, uid) !== 'none') rm.add('block', mb); }
          }
        }
      }
    }
    // blocks that differ from the previous version (outlined in the preview)
    const prev = db.prepare('SELECT id FROM snapshots WHERE page_id = ? AND created_time < ? ORDER BY created_time DESC LIMIT 1').get(snap.pageId, snap.createdTime) as { id: string } | undefined;
    const changedBlockIds: string[] = [];
    if (prev) {
      const before = new Map(((redactVersionData(snap.pageId, getSnapshot(prev.id)?.data ?? {}, uid).blocks ?? []) as BlockRecord[]).map((b) => [b.id, contentKey({ blocks: [b] })]));
      for (const b of blocks) if (before.get(b.id) !== contentKey({ blocks: [b] })) changedBlockIds.push(b.id);
    }
    // databases in this version : what a restore would do with each (no record data leaves the server)
    const databases = databaseRestorePlan(snap.pageId, (data.databases ?? {}) as Record<string, DatabaseSnapshot>, uid, true);
    return { id: snap.id, pageId: snap.pageId, createdTime: snap.createdTime, authorIds: snap.authorIds, blocks, changedBlockIds, databases, recordMap: rm.map };
  },

  /** "Restore this version": snapshot the current state first, then write the version back. `restoreDatabases`
   *  ("Also restore databases on this page") brings back inline databases' properties and records too . */
  restoreVersion(ctx, { snapshotId, restoreDatabases }) {
    const uid = requireUser(ctx);
    const snap = getSnapshot(String(snapshotId ?? ''));
    if (!snap) throw new ApiError('Not found', 404);
    const page = requirePage(snap.pageId, uid, 'read_and_write');
    if (!page.alive) throw new ApiError('Restore the page from Trash before restoring its snapshots.', 400);
    const databases = (snap.data?.databases ?? {}) as Record<string, DatabaseSnapshot>;
    // a full-page database version is its data: the service asks for full access ("Full access is required to restore this database.")
    if (page.type === 'collection_view_page' && databases[page.id]?.owned) {
      const problem = databaseRestoreProblem(page.id, uid);
      if (problem) throw new ApiError(problem, 403);
    }
    const now = Date.now();
    snapshotIfChanged(page.id, [uid], now - 1);
    // decided on today's state (access, locks) before anything changes
    const plan = databaseRestorePlan(page.id, databases, uid, restoreDatabases !== false);
    const ops = restoreOps(page.id, (snap.data?.blocks ?? []) as BlockRecord[], uid, now);
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: page.space_id, debug: { userAction: 'restoreVersion' }, operations: ops }], ctx.clientId, { userInitiated: true });
    // databases: each in its own transaction, so one the person can't restore leaves the rest of the restore intact
    let unchanged = 0;
    for (const item of plan) {
      const d = databases[item.blockId];
      if (!d || item.status === 'removed') continue;
      if (item.status === 'unchanged') {
        if (item.reason) unchanged++;
        continue;
      }
      try {
        const dbOps = databaseRestoreOps(d, uid, now, item.status === 'views_only', snap.createdTime);
        if (dbOps.length) changes.push(...applyTransactions(uid, [{ id: newId(), spaceId: page.space_id, debug: { userAction: 'restoreVersion.database' }, operations: dbOps }], ctx.clientId, { userInitiated: true }));
      } catch {
        unchanged++;
      }
    }
    takeSnapshot(page.id, [uid], now + 1);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { recordMap: rm.map, databasesUnchanged: unchanged };
  },

  /** Page view log (page analytics). Anonymous views of published pages pass `public: true`. */
  recordPageView(ctx, { pageId, public: isPublic }) {
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || blockRole(page.id, ctx.userId) === 'none') return { recorded: false };
    if (!pageViewsEnabled(page.space_id, ctx.userId)) return { recorded: false }; // Settings › General › Analytics
    noteSearchClick(ctx.userId, page.id); // Settings › Analytics › Search click-through
    // coalesce reloads: one view per user/page per 30 minutes
    const recent = db.prepare('SELECT id FROM page_views WHERE page_id = ? AND user_id IS ? AND time > ? LIMIT 1').get(page.id, ctx.userId, Date.now() - 30 * 60_000);
    if (!recent) db.prepare('INSERT INTO page_views (id, page_id, space_id, user_id, time, public) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), page.id, page.space_id, ctx.userId, Date.now(), isPublic ? 1 : 0);
    return { recorded: true };
  },

  /** Updates & analytics › Analytics: views graph (30 days), viewers, editors. */
  getPageStats(ctx, { pageId, days }) {
    const uid = requireUser(ctx);
    const page = requirePage(pageId, uid, 'reader');
    const span = Math.min(Math.max(Number(days) || 30, 7), 90);
    const dayMs = 86400_000;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const from = start.getTime() - (span - 1) * dayMs;
    const rows = db.prepare('SELECT user_id, time FROM page_views WHERE page_id = ? AND time >= ? ORDER BY time').all(page.id, from) as any[];
    const buckets = Array.from({ length: span }, (_, i) => ({ date: from + i * dayMs, total: 0, unique: new Set<string>() }));
    for (const r of rows) {
      const i = Math.floor((r.time - from) / dayMs);
      if (i < 0 || i >= span) continue;
      buckets[i].total++;
      buckets[i].unique.add(r.user_id ?? `anon:${r.time}`);
    }
    const all = db.prepare('SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS u FROM page_views WHERE page_id = ?').get(page.id) as any;
    // "Show your view history" (Allow / Don't allow) — hidden viewers are only listed to themselves
    // per page (Analytics › Show your view history) first, then Settings › Preferences › Show my view history
    const allowsHistory = (userId: string) => {
      const st = getRecord<any>('user_settings', userId)?.settings ?? {};
      const own = st.page_view_history_pages?.[page.id];
      if (own === 'allow' || own === 'deny') return own === 'allow';
      return (st.page_view_history ?? (st.view_history === false ? 'deny' : 'allow')) !== 'deny';
    };
    const viewers = (db.prepare('SELECT user_id, MAX(time) AS last, COUNT(*) AS n FROM page_views WHERE page_id = ? AND user_id IS NOT NULL GROUP BY user_id ORDER BY last DESC LIMIT 50').all(page.id) as any[])
      .filter((r) => r.user_id === uid || allowsHistory(r.user_id))
      .map((r) => ({ userId: r.user_id, lastViewed: r.last, views: r.n }));
    const editors = (db.prepare(`SELECT user_id, MAX(COALESCE(json_extract(data, '$.last'), created_time)) AS last FROM activity WHERE page_id = ?
                                 GROUP BY user_id ORDER BY last DESC LIMIT 20`).all(page.id) as any[])
      .map((r) => ({ userId: r.user_id, lastEdited: r.last }));
    const rm = new RecordMapBuilder(uid);
    addUsers(rm, [page.created_by_id, ...viewers.map((v) => v.userId), ...editors.map((e) => e.userId)]);
    return {
      days: buckets.map((b) => ({ date: b.date, total: b.total, unique: b.unique.size })),
      totalViews: all?.n ?? 0, uniqueViews: all?.u ?? 0,
      viewers, editors, createdBy: page.created_by_id, createdTime: page.created_time,
      showViewHistory: allowsHistory(uid),
      analyticsDisabled: !pageViewsEnabled(page.space_id, null),
      recordMap: rm.map,
    };
  },

  /** Updates & analytics › Updates: edits (activity log, with a diff between the surrounding versions)
   *  and comments on this page, newest first. */
  getPageUpdates(ctx, { pageId, limit }) {
    const uid = requireUser(ctx);
    const page = requirePage(pageId, uid, 'reader');
    const max = Math.min(Number(limit) || 60, 200);
    const items: any[] = [];
    const acts = db.prepare('SELECT * FROM activity WHERE page_id = ? ORDER BY created_time DESC LIMIT ?').all(page.id, max) as any[];
    // versions as this person may see the page (sub-pages restricted from them stay out, versionAccess.ts)
    const liveBlocks = redactVersionData(page.id, { blocks: serializePage(page.id).blocks }, uid).blocks as BlockRecord[];
    const snapCache = new Map<string, BlockRecord[]>();
    const snapBlocks = (id: string): BlockRecord[] => {
      if (!snapCache.has(id)) snapCache.set(id, (redactVersionData(page.id, { blocks: getSnapshot(id)?.data?.blocks ?? [] }, uid).blocks ?? []) as BlockRecord[]);
      return snapCache.get(id)!;
    };
    const before = db.prepare('SELECT id FROM snapshots WHERE page_id = ? AND created_time < ? ORDER BY created_time DESC LIMIT 1');
    const after = db.prepare('SELECT id FROM snapshots WHERE page_id = ? AND created_time >= ? ORDER BY created_time ASC LIMIT 1');
    acts.forEach((a, idx) => {
      const data = JSON.parse(a.data || '{}');
      const end = Number(data.last ?? a.created_time);
      const touchedTitle = (data.blocks ?? []).includes(page.id);
      const item: any = { id: a.id, kind: a.type === 'created' ? 'created' : 'edited', userId: a.user_id, time: end, startTime: a.created_time, touchedTitle };
      if (idx < 30) {
        const b0 = before.get(page.id, a.created_time) as { id: string } | undefined;
        const b1 = after.get(page.id, end) as { id: string } | undefined;
        const prev = b0 ? snapBlocks(b0.id) : [];
        const next = b1 ? snapBlocks(b1.id) : liveBlocks;
        Object.assign(item, diffVersions(page.id, prev, next, new Set<string>(data.blocks ?? [])));
        item.snapshotId = b1?.id ?? null;
      } else {
        // only blocks this person can open (database rows hidden by page-level access, restricted sub-pages)
        item.blocks = ((data.blocks ?? []) as string[]).filter((id) => id !== page.id)
          .map((id) => getRecord<BlockRecord>('block', id)).filter((b) => !!b && blockRole(b.id, uid) !== 'none')
          .map((b) => blockPreview(b)).filter((b: any) => !!b && !!b.text).slice(0, 4);
      }
      items.push(item);
    });
    // comments: discussions on the page and its (non-page) blocks
    const blocks = serializePage(page.id).blocks;
    const rm = new RecordMapBuilder(uid);
    for (const b of blocks) {
      if (b.id !== page.id && PAGE_TYPES.has(b.type)) continue;
      for (const did of b.discussions ?? []) {
        const d = getRecord<DiscussionRecord>('discussion', did);
        if (!d || d.alive === false) continue;
        rm.add('discussion', d);
        if (!rm.has('discussion', d.id)) continue; // a property-value thread hidden from this person 
        d.comments.forEach((cid, idx) => {
          const c = getRecord<CommentRecord>('comment', cid);
          if (!c || c.alive === false) return;
          rm.add('comment', c);
          items.push({
            id: `c:${c.id}`, kind: idx === 0 ? 'commented' : 'replied', userId: c.created_by_id, time: c.created_time,
            discussionId: d.id, commentId: c.id, blockId: b.id, resolved: d.resolved,
            context: toPlainText(d.context as any).slice(0, 200), text: toPlainText(c.text as any).slice(0, 400),
          });
        });
      }
    }
    items.sort((a, b) => b.time - a.time);
    addUsers(rm, items.map((i) => i.userId));
    addUsers(rm, [page.created_by_id]);
    return { items: items.slice(0, max), createdTime: page.created_time, createdBy: page.created_by_id, recordMap: rm.map };
  },
};

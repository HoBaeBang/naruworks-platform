// Page history (snapshots) and activity log ("Updates" panel, page history modal).
import type { Transaction } from '@nc/shared/ops.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { childrenOf, db, getRecord } from './db.ts';
import { pageIdOf } from './search.ts';
import type { AppliedChange } from './records.ts';
import { childBlocks } from './tree.ts';

const SNAPSHOT_INTERVAL_MS = 10 * 60 * 1000; // a new version at most every 10 minutes of editing
const pendingPages = new Map<string, { authors: Set<string>; since: number }>();

const lastSnap = db.prepare('SELECT created_time FROM snapshots WHERE page_id = ? ORDER BY created_time DESC LIMIT 1');
const insertSnap = db.prepare('INSERT INTO snapshots (id, page_id, space_id, created_time, author_ids, data) VALUES (?, ?, ?, ?, ?, ?)');
const insertActivity = db.prepare('INSERT INTO activity (id, space_id, page_id, block_id, user_id, type, created_time, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');

/**
 * A database as it was in a version: its views (as shown on this page) and — for databases this block owns —
 * the data source (properties, name, icon, description) and its records with their property values. Records' page
 * content is not part of it.
 */
export interface DatabaseSnapshot {
  blockId: string;
  collectionId: string | null;
  /** the data source lives in this block (else a linked database: only its views are this page's) */
  owned: boolean;
  views: CollectionViewRecord[];
  collection?: CollectionRecord;
  rows?: BlockRecord[];
}

const MAX_SNAPSHOT_ROWS = 1000;

/** Databases shown by `blocks` (the page itself when it is a full-page database, and inline / linked databases). */
function serializeDatabases(blocks: BlockRecord[]): Record<string, DatabaseSnapshot> {
  const out: Record<string, DatabaseSnapshot> = {};
  for (const b of blocks) {
    if (b.type !== 'collection_view_page' && b.type !== 'collection_view') continue;
    if (Object.keys(out).length >= 20) break;
    const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
    const owned = !!col && col.parent_id === b.id && col.parent_table === 'block';
    const views = (b.view_ids ?? []).map((id) => getRecord<CollectionViewRecord>('collection_view', id)).filter((v): v is CollectionViewRecord => !!v && v.alive !== false);
    const snap: DatabaseSnapshot = { blockId: b.id, collectionId: col?.id ?? null, owned, views };
    if (owned && col) {
      snap.collection = col;
      snap.rows = childrenOf<BlockRecord>('block', col.id)
        .filter((r) => r.parent_table === 'collection' && r.alive && !r.is_template)
        .sort((a, c) => (a.created_time ?? 0) - (c.created_time ?? 0))
        .slice(0, MAX_SNAPSHOT_ROWS)
        .map((r) => {
          const { content: _c, discussions: _d, ...row } = r as BlockRecord & Record<string, unknown>;
          return row as BlockRecord;
        });
    }
    out[b.id] = snap;
  }
  return out;
}

/** Serialize the page subtree (blocks only, not nested pages' content) plus the databases it shows. */
export function serializePage(pageId: string): { blocks: BlockRecord[]; databases?: Record<string, DatabaseSnapshot> } {
  const blocks: BlockRecord[] = [];
  const root = getRecord<BlockRecord>('block', pageId);
  if (!root) return { blocks };
  const queue = [root];
  while (queue.length) {
    const b = queue.shift()!;
    blocks.push(b);
    const isNestedPage = b.id !== pageId && (b.type === 'page' || b.type === 'collection_view_page');
    if (isNestedPage) continue;
    // only real children: ids listed in `content` that belong to another page are not part of this one
    for (const c of childBlocks(b)) queue.push(c);
    if (blocks.length > 50_000) break;
  }
  const databases = serializeDatabases(blocks.filter((b) => b.id === pageId || b.type === 'collection_view'));
  return Object.keys(databases).length ? { blocks, databases } : { blocks };
}

/** The page whose version history covers a record: a database record / data source / view counts for the page
 * showing that database (the full-page database itself, or the page holding an inline database). */
export function historyPageOf(table: string, record: { id: string; parent_id?: string; parent_table?: string }): string | null {
  let blockId: string | undefined;
  if (table === 'block' && record.parent_table === 'collection') blockId = getRecord<CollectionRecord>('collection', String(record.parent_id))?.parent_id;
  else if (table === 'collection' || table === 'collection_view') blockId = record.parent_table === 'block' ? record.parent_id : undefined;
  if (!blockId) return null;
  const host = getRecord<BlockRecord>('block', blockId);
  if (!host || (host.type !== 'collection_view_page' && host.type !== 'collection_view')) return null;
  return host.type === 'collection_view_page' ? host.id : pageIdOf(host);
}

/** Blocks of a stored snapshot that belong to its page: reachable from the root through children that point back
 * at their parent (snapshots written before the content checks may hold foreign blocks listed in `content`). */
export function snapshotBlocks(pageId: string, blocks: unknown): BlockRecord[] {
  const list = Array.isArray(blocks) ? (blocks as BlockRecord[]) : [];
  const byId = new Map(list.map((b) => [b.id, b]));
  const out: BlockRecord[] = [];
  const root = byId.get(pageId);
  if (!root) return out;
  const queue = [root];
  const seen = new Set<string>();
  while (queue.length) {
    const b = queue.shift()!;
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    out.push(b);
    for (const id of b.content ?? []) {
      const c = byId.get(id);
      if (c && c.parent_table === 'block' && c.parent_id === b.id) queue.push(c);
    }
  }
  return out;
}

export function maybeSnapshot(block: BlockRecord, userId: string, now: number) {
  // database records also count for the page showing their database
  const host = block.parent_table === 'collection' ? historyPageOf('block', block) : null;
  if (host && host !== block.id) notePending(host, userId, now);
  notePending(pageIdOf(block), userId, now);
}

function notePending(pageId: string, userId: string, now: number) {
  const p = pendingPages.get(pageId) ?? { authors: new Set(), since: now };
  p.authors.add(userId);
  pendingPages.set(pageId, p);
  const last = (lastSnap.get(pageId) as { created_time: number } | undefined)?.created_time ?? 0;
  if (now - last >= SNAPSHOT_INTERVAL_MS) takeSnapshot(pageId, [...p.authors], now);
}

export function takeSnapshot(pageId: string, authors: string[], now = Date.now()) {
  const page = getRecord<BlockRecord>('block', pageId);
  if (!page) return;
  insertSnap.run(newId(), pageId, page.space_id, now, JSON.stringify(authors), JSON.stringify(serializePage(pageId)));
  pendingPages.delete(pageId);
}

export function listSnapshots(pageId: string, limit = 100) {
  return db.prepare('SELECT id, created_time, author_ids FROM snapshots WHERE page_id = ? ORDER BY created_time DESC LIMIT ?')
    .all(pageId, limit)
    .map((r: any) => ({ id: r.id, createdTime: r.created_time, authorIds: JSON.parse(r.author_ids || '[]') }));
}

export function getSnapshot(id: string) {
  const r = db.prepare('SELECT * FROM snapshots WHERE id = ?').get(String(id)) as any;
  if (!r) return null;
  const data = JSON.parse(r.data);
  // callers only ever see the page's own subtree
  return { id: r.id, pageId: r.page_id, createdTime: r.created_time, authorIds: JSON.parse(r.author_ids || '[]'), data: { ...data, blocks: snapshotBlocks(r.page_id, data?.blocks) } };
}

export function recordActivity(userId: string, changes: AppliedChange[], transactions: Transaction[]) {
  const now = Date.now();
  const action = transactions[0]?.debug?.userAction ?? 'edit';
  const pages = new Map<string, { spaceId: string | null; blocks: string[] }>();
  for (const ch of changes) {
    // database records, data sources and views are history of the page that shows the database
    const host = ch.table === 'block' || ch.table === 'collection' || ch.table === 'collection_view' ? historyPageOf(ch.table, ch.record as never) : null;
    if (host) {
      const e = pages.get(host) ?? { spaceId: ch.spaceId, blocks: [] };
      if (ch.table === 'block') e.blocks.push(ch.record.id);
      pages.set(host, e);
    }
    if (ch.table !== 'block') continue;
    const b = ch.record as BlockRecord;
    const pageId = pageIdOf(b);
    const e = pages.get(pageId) ?? { spaceId: ch.spaceId, blocks: [] };
    e.blocks.push(b.id);
    pages.set(pageId, e);
  }
  for (const [pageId, e] of pages) {
    // coalesce: one activity row per user/page per 5 minutes
    const recent = db.prepare('SELECT id, data FROM activity WHERE page_id = ? AND user_id = ? AND created_time > ? ORDER BY created_time DESC LIMIT 1')
      .get(pageId, userId, now - 5 * 60 * 1000) as any;
    if (recent) {
      const data = JSON.parse(recent.data);
      data.blocks = [...new Set([...(data.blocks ?? []), ...e.blocks])].slice(0, 200);
      data.last = now;
      db.prepare('UPDATE activity SET data = ? WHERE id = ?').run(JSON.stringify(data), recent.id);
    } else {
      // a schema/view-only change has no block (node:sqlite refuses to bind undefined)
      insertActivity.run(newId(), e.spaceId ?? null, pageId, e.blocks[0] ?? null, userId, action.includes('create') ? 'created' : 'edited', now, JSON.stringify({ blocks: e.blocks, last: now }));
    }
  }
}

export function listActivity(pageId: string, limit = 50) {
  return db.prepare('SELECT * FROM activity WHERE page_id = ? ORDER BY created_time DESC LIMIT ?')
    .all(pageId, limit)
    .map((r: any) => ({ id: r.id, pageId: r.page_id, userId: r.user_id, type: r.type, createdTime: r.created_time, data: JSON.parse(r.data || '{}') }));
}

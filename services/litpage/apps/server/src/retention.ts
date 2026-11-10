// Settings › Security › Data retention and support access expiry.
// - "Retention for pages in Trash": pages that have been in Trash for 30 days are deleted for good on every plan;
// Enterprise workspaces choose the number
// (space.settings.trash_retention_days). Daily job, runRetention.
// - "Retention for deleted pages and AI chats": pages deleted from Trash are kept in `retained_pages` for 30 days on
// every plan (Enterprise: space.settings.purge_retention_days) — owners of Enterprise workspaces find them in Content
// search ("Retained pages") and can restore them — then purged for good. The numbers: @nc/shared/retention.ts.
// - Support access (workspace consent or a member's account toggle) turns itself off after 28 days.
// Jobs run on the persistent scheduler (scheduler.ts); tests call runRetention/expireSupportAccess directly.
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, SpaceRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { DEFAULT_RETENTION_DAYS, purgeRetentionDays, trashRetentionDays } from '@nc/shared/retention.ts';
import { db, getRecord, putRecord } from './db.ts';
import { childBlocks } from './tree.ts';
import { onCommit, recordRole } from './records.ts';
import { realtime } from './realtime.ts';
import { saveRecord } from './seed.ts';
import { audit, auditAccount } from './audit.ts';
import { registerJobHandler, scheduleJob } from './scheduler.ts';
import { indexBlock } from './search.ts';

const DAY = 86_400_000;
export const SUPPORT_ACCESS_DAYS = 28;
export const DEFAULT_TRASH_DAYS = DEFAULT_RETENTION_DAYS;
export { trashRetentionDays };

db.exec(`
CREATE TABLE IF NOT EXISTS retained_pages (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  title TEXT,
  deleted_time INTEGER NOT NULL,
  deleted_by_id TEXT,
  expires INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_retained_space ON retained_pages(space_id, deleted_time);
`);

function setting(space: SpaceRecord | undefined, key: string): unknown {
  return (space?.settings as Record<string, unknown> | undefined)?.[key];
}

/** Ids of a block's own subtree (children pointing back at their parent). */
export function subtreeIds(root: BlockRecord): string[] {
  const ids: string[] = [];
  const q: BlockRecord[] = [root];
  const seen = new Set<string>();
  while (q.length && ids.length < 50_000) {
    const cur = q.pop()!;
    if (seen.has(cur.id)) continue;
    seen.add(cur.id);
    ids.push(cur.id);
    for (const c of childBlocks(cur, { alive: false })) q.push(c);
  }
  return ids;
}

/**
 * Before a page leaves Trash for good: keep a copy for the workspace's "Retention for deleted pages" window (30 days,
 * or the Enterprise setting). Called by every permanent-delete path (handlers.deleteBlocksPermanently, admin content
 * search, the Trash retention job). Returns whether a copy was kept.
 */
export function retainBeforePurge(spaceId: string, page: BlockRecord, ids: string[], actorId: string | null): boolean {
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!space) return false;
  const days = purgeRetentionDays(space);
  const blocks = ids.map((id) => getRecord<BlockRecord>('block', id)).filter(Boolean);
  const now = Date.now();
  db.prepare('INSERT INTO retained_pages (id, space_id, page_id, title, deleted_time, deleted_by_id, expires, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), spaceId, page.id, toPlainText(page.properties?.title).slice(0, 300), now, actorId, now + days * DAY, JSON.stringify({ blocks }));
  return true;
}

/** Permanently delete a trashed page subtree (records + search index), keeping a retained copy when configured. */
export function purgePage(page: BlockRecord, actorId: string | null): number {
  const ids = subtreeIds(page);
  retainBeforePurge(page.space_id, page, ids, actorId);
  for (const id of ids) {
    db.prepare("DELETE FROM records WHERE tbl = 'block' AND id = ?").run(id);
    db.prepare('DELETE FROM search_index WHERE block_id = ?').run(id);
  }
  return ids.length;
}

export interface RetainedPage { id: string; pageId: string; title: string; deletedTime: number; deletedById: string | null; expires: number }

export function listRetained(spaceId: string, query = ''): RetainedPage[] {
  const q = query.trim().toLowerCase();
  return (db.prepare('SELECT id, page_id, title, deleted_time, deleted_by_id, expires FROM retained_pages WHERE space_id = ? AND expires > ? ORDER BY deleted_time DESC LIMIT 500').all(spaceId, Date.now()) as any[])
    .filter((r) => !q || String(r.title ?? '').toLowerCase().includes(q) || r.page_id === q)
    .map((r) => ({ id: r.id, pageId: r.page_id, title: r.title ?? '', deletedTime: r.deleted_time, deletedById: r.deleted_by_id, expires: r.expires }));
}

/** Put a retained page back (as a page in Trash at its old location; the caller restores it from there). */
export function restoreRetained(spaceId: string, retainedId: string): BlockRecord | null {
  const row = db.prepare('SELECT * FROM retained_pages WHERE id = ? AND space_id = ?').get(retainedId, spaceId) as any;
  if (!row) return null;
  const { blocks } = JSON.parse(row.data) as { blocks: BlockRecord[] };
  for (const b of blocks) {
    if (getRecord('block', b.id)) continue;
    putRecord('block', b);
    indexBlock(b);
  }
  db.prepare('DELETE FROM retained_pages WHERE id = ?').run(retainedId);
  return getRecord<BlockRecord>('block', row.page_id) ?? null;
}

/** Daily: Trash auto-deletion (every workspace) + retained-page purge (Enterprise). Returns counts (tests). */
export function runRetention(now = Date.now()): { trashed: number; purged: number } {
  let trashed = 0;
  const spaces = (db.prepare("SELECT data FROM records WHERE tbl = 'space'").all() as { data: string }[]).map((r) => JSON.parse(r.data) as SpaceRecord);
  for (const space of spaces) {
    if ((space as any).deleted_time) continue;
    const cutoff = now - trashRetentionDays(space) * DAY;
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 0 AND json_extract(data, '$.type') IN ('page', 'collection_view_page')
                             AND COALESCE(json_extract(data, '$.deleted_time'), last_edited_time) < ? LIMIT 1000`).all(space.id, cutoff) as { data: string }[];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      const parent = b.parent_table === 'block' ? getRecord<BlockRecord>('block', b.parent_id) : null;
      if (parent && parent.alive === false) continue; // deleted together with its trashed parent
      if (!getRecord('block', b.id)) continue;
      audit('page.permanently_deleted', { spaceId: space.id, actorId: null, targetId: b.id, data: { pageName: toPlainText(b.properties?.title).slice(0, 200), automatic: true } });
      purgePage(b, null);
      trashed++;
    }
  }
  const purged = Number(db.prepare('DELETE FROM retained_pages WHERE expires <= ?').run(now).changes ?? 0);
  return { trashed, purged };
}

/** Turn support access off once its 28 days are over (workspace consent and account toggles). */
export function expireSupportAccess(now = Date.now()): number {
  let n = 0;
  const cutoff = now - SUPPORT_ACCESS_DAYS * DAY;
  for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'space' AND json_extract(data, '$.settings.support_access') = 1`).all() as { data: string }[]) {
    const s = JSON.parse(r.data) as SpaceRecord;
    const since = Number(setting(s, 'support_access_granted_time') ?? 0);
    if (!since || since > cutoff) continue;
    const saved = saveRecord('space', { ...s, settings: { ...(s.settings ?? {}), support_access: false, support_access_granted_time: null } });
    realtime.broadcastChanges([{ table: 'space', record: saved, spaceId: s.id }] as any);
    audit('workspace_data_access_consent_revoked', { spaceId: s.id, actorId: null, targetId: s.id, data: { automatic: true } });
    n++;
  }
  for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'user_settings' AND json_extract(data, '$.settings.support_access') = 1`).all() as { data: string }[]) {
    const us = JSON.parse(r.data) as UserSettingsRecord;
    const since = Number((us.settings as any)?.support_access_granted_time ?? 0);
    if (!since || since > cutoff) continue;
    const saved = saveRecord('user_settings', { ...us, settings: { ...(us.settings ?? {}), support_access: false, support_access_granted_time: null } } as any);
    realtime.notifyUser(us.id, { type: 'records', records: [{ table: 'user_settings', id: us.id, version: saved.version, value: saved, role: recordRole('user_settings', saved, us.id) }] });
    auditAccount('revoked_support_access', us.id, { data: { automatic: true } });
    n++;
  }
  return n;
}

// account support access toggles (user_settings.settings.support_access) are audited and stamped when granted
onCommit((info) => {
  for (const ch of info.changes) {
    if (ch.table !== 'user_settings') continue;
    const before = info.prev.get(`user_settings:${ch.record.id}`) as UserSettingsRecord | undefined;
    const was = !!(before?.settings as any)?.support_access;
    const now = !!((ch.record as UserSettingsRecord).settings as any)?.support_access;
    if (was === now) continue;
    auditAccount(now ? 'allowed_support_access' : 'revoked_support_access', ch.record.id);
  }
});

registerJobHandler('w3set-retention', () => {
  runRetention();
  expireSupportAccess();
  scheduleJob('w3set-retention', 'w3set-retention:daily', Date.now() + DAY);
});
// first run a minute after start, then daily (upsert by key: restarts don't pile up jobs)
scheduleJob('w3set-retention', 'w3set-retention:daily', Date.now() + 60_000);

// Email digests: "Page updates" and "Workspace digest".
// - Page updates: when someone edits a page you created or turned notifications on for (Notify me), the page is
// queued for you; one email per workspace summarizes the queue after PAGE_UPDATES_DELAY (default 30 minutes, env
// NC_PAGE_UPDATES_DELAY_MS), only if Settings › Notifications › Page updates is on.
// - Workspace digest: a daily sweep (scheduler job `workspace-digest-sweep`, 09:00 UTC) emails members who have
// "Workspace digest" on and haven't had one for 7 days: most viewed and newly created pages they can open.
import { newId, pageSlug } from '@nc/shared/ids.ts';
import type { BlockRecord, FollowRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from './db.ts';
import { blockRole, onCommit, type CommitInfo } from './records.ts';
import { pageIdOf } from './search.ts';
import { getJob, registerJobHandler, scheduleJob } from './scheduler.ts';
import { appUrl, mailTemplates, sendMail } from './mail.ts';
import { emailPrefs } from './notify.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS page_update_queue (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  page_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_page_update_queue_user ON page_update_queue(user_id, space_id);
CREATE TABLE IF NOT EXISTS digest_log (
  user_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  sent_time INTEGER NOT NULL,
  PRIMARY KEY (user_id, space_id)
);
`);

export function pageUpdatesDelayMs(): number {
  const v = Number(process.env.NC_PAGE_UPDATES_DELAY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 30 * 60_000;
}

const PAGE_TYPES = new Set(['page', 'collection_view_page']);
const recentQueue = new Map<string, number>(); // `${user}:${page}:${actor}` → last queued (avoid a row per keystroke)

function titleOf(b: BlockRecord | undefined): string {
  return toPlainText(b?.properties?.title).replace(/[‣⁍]/g, '') || 'Untitled';
}

function nameOf(id: string): string {
  const u = getRecord<UserRecord>('lit_user', id);
  return u?.name || u?.email || 'Someone';
}

/** People who get "Page updates" for a page: its creator and everyone following it. */
function pageWatchers(page: BlockRecord): string[] {
  const out = new Set<string>();
  if (page.created_by_id) out.add(page.created_by_id);
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'follow' AND json_extract(data, '$.navigable_block_id') = ?`).all(page.id) as { data: string }[];
  for (const r of rows) {
    const f = JSON.parse(r.data) as FollowRecord;
    if (f.following === false) out.delete(f.user_id);
    else out.add(f.user_id);
  }
  return [...out];
}

const recentPage = new Map<string, number>(); // `${page}:${actor}` → last processed (typing commits every few ms)

export function queuePageUpdate(page: BlockRecord, actorId: string, now = Date.now()) {
  const pk = `${page.id}:${actorId}`;
  if ((recentPage.get(pk) ?? 0) > now - 60_000) return;
  recentPage.set(pk, now);
  if (recentPage.size > 5000) recentPage.clear();
  for (const uid of pageWatchers(page)) {
    if (uid === actorId) continue;
    const k = `${uid}:${page.id}:${actorId}`;
    if ((recentQueue.get(k) ?? 0) > now - 5 * 60_000) continue;
    recentQueue.set(k, now);
    if (recentQueue.size > 5000) recentQueue.clear();
    if (!emailPrefs(uid, page.space_id).pageUpdates || blockRole(page.id, uid) === 'none') continue;
    db.prepare('INSERT INTO page_update_queue (id, user_id, space_id, page_id, actor_id, time) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), uid, page.space_id, page.id, actorId, now);
    const key = `page-updates:${uid}:${page.space_id}`;
    if (!getJob(key)) scheduleJob('page-updates', key, now + pageUpdatesDelayMs(), { userId: uid, spaceId: page.space_id });
  }
}

export function sendPageUpdates(userId: string, spaceId: string): number {
  const rows = db.prepare('SELECT page_id, actor_id, time FROM page_update_queue WHERE user_id = ? AND space_id = ? ORDER BY time').all(userId, spaceId) as { page_id: string; actor_id: string; time: number }[];
  db.prepare('DELETE FROM page_update_queue WHERE user_id = ? AND space_id = ?').run(userId, spaceId);
  const user = getRecord<UserRecord>('lit_user', userId);
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!rows.length || !user?.email || !space || !emailPrefs(userId, spaceId).pageUpdates) return 0;
  const pages = new Map<string, { editors: Set<string>; count: number }>();
  for (const r of rows) {
    const e = pages.get(r.page_id) ?? { editors: new Set(), count: 0 };
    e.editors.add(r.actor_id);
    e.count++;
    pages.set(r.page_id, e);
  }
  const list: { title: string; url: string; editors: string[]; count: number }[] = [];
  for (const [pid, e] of pages) {
    const page = getRecord<BlockRecord>('block', pid);
    if (!page || page.alive === false || blockRole(pid, userId) === 'none') continue;
    list.push({ title: titleOf(page), url: appUrl(`/${space.domain}/${pageSlug(titleOf(page), pid)}`), editors: [...e.editors].map(nameOf), count: e.count });
  }
  if (!list.length) return 0;
  sendMail({ to: user.email, toUserId: userId, kind: 'page_updates', ...mailTemplates.pageUpdates({ workspace: space.name, pages: list.slice(0, 50) }), meta: { spaceId } });
  return list.length;
}

registerJobHandler('page-updates', (p: { userId?: string; spaceId?: string }) => {
  if (p?.userId && p.spaceId) sendPageUpdates(p.userId, p.spaceId);
});

onCommit((info: CommitInfo) => {
  const pages = new Map<string, BlockRecord>();
  for (const ch of info.changes) {
    if (ch.table !== 'block') continue;
    const b = ch.record as BlockRecord;
    const pid = PAGE_TYPES.has(b.type) ? b.id : pageIdOf(b);
    if (pages.has(pid)) continue;
    const page = pid === b.id ? b : getRecord<BlockRecord>('block', pid);
    if (page && page.alive !== false && PAGE_TYPES.has(page.type)) pages.set(pid, page);
  }
  const now = Date.now();
  for (const page of pages.values()) {
    try {
      // a brand-new page has nothing to report yet
      if (now - (page.created_time ?? 0) < 60_000 && page.created_by_id === info.userId) continue;
      queuePageUpdate(page, info.userId, now);
    } catch (e) {
      console.error('[digests] page update queue failed', e);
    }
  }
});

// ---------------------------------------------------------------- workspace digest
const DIGEST_INTERVAL = 7 * 86_400_000;

function nextSweepTime(now = Date.now()): number {
  const d = new Date(now);
  const at = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 9, 0);
  return at > now ? at : at + 86_400_000;
}

/** Digest for one member: most viewed pages of the last 7 days and new pages, both limited to what they can open. */
export function sendWorkspaceDigest(userId: string, spaceId: string, now = Date.now()): boolean {
  const user = getRecord<UserRecord>('lit_user', userId);
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!user?.email || !space || !emailPrefs(userId, spaceId).digest) return false;
  const since = now - DIGEST_INTERVAL;
  const popular: { title: string; url: string; views: number }[] = [];
  try {
    const rows = db.prepare('SELECT page_id, COUNT(*) AS n FROM page_views WHERE space_id = ? AND time >= ? GROUP BY page_id ORDER BY n DESC LIMIT 30').all(spaceId, since) as { page_id: string; n: number }[];
    for (const r of rows) {
      const page = getRecord<BlockRecord>('block', r.page_id);
      if (!page || page.alive === false || blockRole(page.id, userId) === 'none') continue;
      popular.push({ title: titleOf(page), url: appUrl(`/${space.domain}/${pageSlug(titleOf(page), page.id)}`), views: r.n });
      if (popular.length >= 5) break;
    }
  } catch {
    /* page_views table not created yet */
  }
  const created: { title: string; url: string; by: string }[] = [];
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND json_extract(data, '$.type') IN ('page', 'collection_view_page')
                           AND json_extract(data, '$.created_time') >= ? AND parent_table != 'collection' ORDER BY json_extract(data, '$.created_time') DESC LIMIT 60`).all(spaceId, since) as { data: string }[];
  for (const r of rows) {
    const page = JSON.parse(r.data) as BlockRecord;
    if (page.created_by_id === userId || blockRole(page.id, userId) === 'none') continue;
    created.push({ title: titleOf(page), url: appUrl(`/${space.domain}/${pageSlug(titleOf(page), page.id)}`), by: nameOf(page.created_by_id) });
    if (created.length >= 5) break;
  }
  if (!popular.length && !created.length) return false;
  sendMail({ to: user.email, toUserId: userId, kind: 'workspace_digest', ...mailTemplates.workspaceDigest({ workspace: space.name, url: appUrl(`/${space.domain}`), popular, created }), meta: { spaceId } });
  db.prepare('INSERT INTO digest_log (user_id, space_id, sent_time) VALUES (?, ?, ?) ON CONFLICT(user_id, space_id) DO UPDATE SET sent_time = excluded.sent_time').run(userId, spaceId, now);
  return true;
}

export function runDigestSweep(now = Date.now()): number {
  let sent = 0;
  const spaces = db.prepare(`SELECT data FROM records WHERE tbl = 'space'`).all() as { data: string }[];
  for (const r of spaces) {
    const space = JSON.parse(r.data) as SpaceRecord;
    if ((space as any).deleted_time) continue;
    for (const p of space.permissions ?? []) {
      if (p.type !== 'user_permission' || !p.user_id || p.role === 'none') continue;
      const last = (db.prepare('SELECT sent_time FROM digest_log WHERE user_id = ? AND space_id = ?').get(p.user_id, space.id) as { sent_time: number } | undefined)?.sent_time;
      // first digest a week after joining (or after the first sweep), then weekly
      if (last === undefined) {
        db.prepare('INSERT OR IGNORE INTO digest_log (user_id, space_id, sent_time) VALUES (?, ?, ?)').run(p.user_id, space.id, now);
        continue;
      }
      if (now - last < DIGEST_INTERVAL - 3600_000) continue;
      if (sendWorkspaceDigest(p.user_id, space.id, now)) sent++;
      else db.prepare('UPDATE digest_log SET sent_time = ? WHERE user_id = ? AND space_id = ?').run(now, p.user_id, space.id);
    }
  }
  return sent;
}

registerJobHandler('workspace-digest-sweep', () => {
  try {
    runDigestSweep();
  } finally {
    scheduleJob('workspace-digest-sweep', 'workspace-digest-sweep', nextSweepTime());
  }
});

if (!getJob('workspace-digest-sweep')) scheduleJob('workspace-digest-sweep', 'workspace-digest-sweep', nextSweepTime());

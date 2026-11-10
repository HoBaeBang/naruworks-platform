// Public demo sandboxes (NC_DEMO_MODE=1). "Try the demo" gives every visitor a temporary account and a workspace of
// their own with sample pages; a background job deletes sandboxes NC_DEMO_SANDBOX_HOURS after they were created.
// - Only users created here are sandboxes: `demo_sandboxes` lists them (created only in demo mode). Deletion also
//   requires the guest address, a workspace the guest created and no other member, so the cleanup can never reach a
//   normal account or the shared NC_BOOTSTRAP_* account.
// - Limits (demo.ts demoLimits): creations per client address, live sandboxes, records and uploaded files per sandbox.
import { randomBytes, randomInt } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { newId, pageSlug } from '@nc/shared/ids.ts';
import { TABLES, type SpaceRecord, type UserRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { DATA_DIR, db, getRecord, tx } from './db.ts';
import { createSession } from './auth.ts';
import { createUser, createWorkspace, saveRecord, seedDemoContent, type BlockSpec } from './seed.ts';
import { demoLimits, isDemoMode } from './demo.ts';
import { onBeforePersist, TransactionError } from './records.ts';
import { realtime } from './realtime.ts';
import { count, exemptIp, hit } from './ratelimit.ts';

export const SANDBOX_EMAIL = /^guest-[0-9a-f]{12}@demo\.invalid$/;
export const DEMO_BUSY_MESSAGE = 'The demo is busy. Try again in a few minutes.';
const CLEANUP_INTERVAL_MS = 5 * 60_000;
/** Run SQL statements without results (node:sqlite DatabaseSync). */
const runSql = (text: string) => db.exec(text);

export class DemoSandboxError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

let tableReady = false;
/** The sandbox list exists only on demo servers (normal installs never get the table). */
function ensureTable() {
  if (tableReady) return;
  runSql(`
CREATE TABLE IF NOT EXISTS demo_sandboxes (
  user_id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demo_sandboxes_space ON demo_sandboxes(space_id);
CREATE INDEX IF NOT EXISTS idx_demo_sandboxes_expires ON demo_sandboxes(expires);
`);
  tableReady = true;
}

export interface SandboxRow { user_id: string; space_id: string; created_time: number; expires: number }

export function sandboxOfUser(userId: string | null | undefined): SandboxRow | null {
  if (!userId || !isDemoMode()) return null;
  ensureTable();
  return (db.prepare('SELECT * FROM demo_sandboxes WHERE user_id = ?').get(userId) as SandboxRow | undefined) ?? null;
}

export function isSandboxSpace(spaceId: string | null | undefined): boolean {
  if (!spaceId || !isDemoMode()) return false;
  ensureTable();
  return !!db.prepare('SELECT 1 AS hit FROM demo_sandboxes WHERE space_id = ?').get(spaceId);
}

export function liveSandboxCount(): number {
  ensureTable();
  return Number((db.prepare('SELECT COUNT(*) AS n FROM demo_sandboxes').get() as { n: number }).n);
}

// ---------------------------------------------------------------- creation

const t = (s: string): RichText => [[s]];

function startHereContent(hours: number): BlockSpec[] {
  return [
    { type: 'text', title: t(`This workspace is yours alone. Nobody else can see it, and it is deleted ${hours} hours after it was created, so try anything you like.`) },
    { type: 'sub_header', title: t('Things to try') },
    { type: 'to_do', title: [['Type '], ['/', [['c']]], [' on an empty line to add a heading, a to-do list, a callout or a table.']] },
    { type: 'to_do', title: t('Open Roadmap in the sidebar and switch between its Board, Timeline and Chart views.') },
    { type: 'to_do', title: t('Open this page in a second browser tab and type in one of them: the other one updates live.') },
    { type: 'to_do', title: [['Open Settings ('], ['⌘/Ctrl + ,', [['c']]], [') and try dark mode or the Korean interface.']] },
    { type: 'to_do', title: t('Look around Projects, Meeting notes and Team wiki, then start a page of your own.') },
    { type: 'callout', title: t('AI is not connected in this demo. Everything else works like a self-hosted install.'), format: { page_icon: '💡', block_color: 'gray_background' } },
  ];
}

/** Client address limits: NC_DEMO_SANDBOXES_PER_IP_HOUR / _DAY (loopback is exempt outside production, like other per-IP limits). */
function allowedForIp(ip: string | undefined): boolean {
  if (exemptIp(ip)) return true;
  const { perIpHour, perIpDay } = demoLimits();
  if (count(`demo-sandbox:ip-day:${ip}`, 86_400_000) >= perIpDay) return false;
  if (!hit(`demo-sandbox:ip:${ip}`, perIpHour, 3_600_000)) return false;
  return hit(`demo-sandbox:ip-day:${ip}`, perIpDay, 86_400_000);
}

export interface CreatedSandbox { userId: string; spaceId: string; pageId: string; path: string; expires: number; token: string }

/**
 * Create a sandbox: guest user (onboarding done), "Litpage Demo" workspace with the sample pages, a session that ends
 * with the sandbox. `replaceUserId`: the caller's current sandbox ("Start over"), deleted once the address limit allows a new one.
 */
export function createSandbox(ip: string | undefined, replaceUserId?: string | null): CreatedSandbox {
  if (!isDemoMode()) throw new DemoSandboxError('Not found', 404);
  ensureTable();
  const limits = demoLimits();
  if (!allowedForIp(ip)) throw new DemoSandboxError('The demo was started many times from your network. Try again later.', 429);
  if (replaceUserId && sandboxOfUser(replaceUserId)) deleteSandbox(replaceUserId);
  if (liveSandboxCount() >= limits.maxSandboxes) {
    // full: expired sandboxes go first, live ones are never deleted early
    purgeExpiredSandboxes();
    if (liveSandboxCount() >= limits.maxSandboxes) throw new DemoSandboxError(DEMO_BUSY_MESSAGE, 429);
  }
  const now = Date.now();
  const expires = now + limits.sandboxHours * 3_600_000;
  const userId = newId();
  const email = `guest-${randomBytes(6).toString('hex')}@demo.invalid`;
  // listed first: a sandbox that fails halfway is still cleaned up later
  db.prepare('INSERT INTO demo_sandboxes (user_id, space_id, created_time, expires) VALUES (?, ?, ?, ?)').run(userId, '', now, expires);
  const user = createUser(userId, email, `Guest ${randomInt(1000, 10000)}`);
  saveRecord('lit_user', { ...user, onboarding_completed: true });
  const { space, spaceView } = createWorkspace(userId, 'Litpage Demo', '✨', {
    welcome: { title: 'Start here', icon: '👋', content: startHereContent(limits.sandboxHours) },
  });
  db.prepare('UPDATE demo_sandboxes SET space_id = ? WHERE user_id = ?').run(space.id, userId);
  const domain = `demo-${randomBytes(6).toString('hex')}`;
  saveRecord('space', { ...getRecord<SpaceRecord>('space', space.id)!, domain });
  seedDemoContent(space.id, userId);
  const pageId = spaceView.private_pages[0];
  const token = createSession(userId, expires);
  return { userId, spaceId: space.id, pageId, path: `/${domain}/${pageSlug('Start here', pageId)}`, expires, token };
}

// ---------------------------------------------------------------- quotas

/** Records counted against NC_DEMO_MAX_RECORDS: everything stored in the sandbox workspace. */
export function sandboxRecordCount(spaceId: string): number {
  return Number((db.prepare(`SELECT COUNT(*) AS n FROM records WHERE tbl IN (${TABLES.map(() => '?').join(',')}) AND space_id = ?`).get(...TABLES, spaceId) as { n: number }).n);
}

const recordExists = db.prepare('SELECT 1 AS hit FROM records WHERE tbl = ? AND id = ?');

/** Record quota on the transaction path and every server-side creator that writes through applyTransactions
 *  (templates, duplicate, import). Installed by app.ts; does nothing outside demo mode. */
export function installDemoSandboxHooks() {
  onBeforePersist((changed) => {
    if (!isDemoMode()) return;
    const created = new Map<string, number>();
    for (const ch of changed.values()) {
      if (!ch.spaceId || recordExists.get(ch.table, ch.record.id)) continue;
      created.set(ch.spaceId, (created.get(ch.spaceId) ?? 0) + 1);
    }
    const { maxRecords } = demoLimits();
    for (const [spaceId, n] of created) {
      if (!isSandboxSpace(spaceId)) continue;
      if (sandboxRecordCount(spaceId) + n > maxRecords) {
        throw new TransactionError(`This demo workspace is full: it holds at most ${maxRecords.toLocaleString('en-US')} blocks, rows and comments. Delete something or start over.`, 413);
      }
    }
  });
}

/** Why a sandbox user can't store another file of `bytes` (null = fine): NC_DEMO_MAX_UPLOAD_MB and NC_DEMO_MAX_FILES per sandbox. */
export function sandboxFileProblem(userId: string, bytes: number): string | null {
  if (!sandboxOfUser(userId)) return null;
  const { maxUploadBytes, maxFiles } = demoLimits();
  const used = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM files WHERE user_id = ? AND private = 0').get(userId) as { n: number; bytes: number };
  if (Number(used.n) >= maxFiles) return `This demo workspace holds at most ${maxFiles} files. Start over for a fresh one.`;
  if (Number(used.bytes) + bytes > maxUploadBytes) return `This demo workspace holds at most ${Math.round(maxUploadBytes / 1024 / 1024)} MB of files. Start over for a fresh one.`;
  return null;
}

// ---------------------------------------------------------------- deletion

const USER_COLUMNS = ['user_id', 'owner_id', 'actor_id', 'requester_id', 'created_by', 'to_user_id', 'granted_by', 'resolved_by', 'deleted_by_id', 'target_id'];
const EMAIL_COLUMNS = ['email', 'to_email'];
const REF_COLUMNS = ['page_id', 'block_id', 'collection_id', 'team_id', 'agent_id', 'automation_id', 'thread_id', 'turn_id', 'integration_id', 'webhook_id', 'file_id', 'snapshot_id', 'owner', 'target_id'];
const JOB_KEYS = ['userId', 'ownerId', 'spaceId', 'blockId', 'pageId', 'notificationId', 'fileId', 'agentId', 'automationId', 'id'];

interface TableInfo { name: string; cols: Set<string> }

/** Tables other than `records` / `changes` / the sandbox list (FTS shadow tables are reached through their virtual table). */
function otherTables(): TableInfo[] {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string | null }[];
  const virtual = rows.filter((r) => /^CREATE VIRTUAL TABLE/i.test(r.sql ?? '')).map((r) => r.name);
  return rows
    .filter((r) => !['records', 'changes', 'demo_sandboxes'].includes(r.name) && !virtual.some((v) => r.name.startsWith(`${v}_`)))
    .map((r) => ({ name: r.name, cols: new Set((db.prepare(`PRAGMA table_info("${r.name}")`).all() as { name: string }[]).map((c) => c.name)) }));
}

/** SQL condition selecting a table's rows that belong to the sandbox (ids in the temp.demo_purge_* tables). */
function sandboxCondition(info: TableInfo, email: string | null): { where: string; args: string[] } | null {
  const parts: string[] = [];
  const args: string[] = [];
  const inIds = (col: string) => `"${col}" IN (SELECT id FROM temp.demo_purge_ids)`;
  if (info.cols.has('space_id')) parts.push('space_id IN (SELECT id FROM temp.demo_purge_space)');
  for (const c of USER_COLUMNS) if (info.cols.has(c)) parts.push(`"${c}" IN (SELECT id FROM temp.demo_purge_user)`);
  if (email) for (const c of EMAIL_COLUMNS) if (info.cols.has(c)) { parts.push(`"${c}" = ?`); args.push(email); }
  // references by id: rows that belong to another workspace are never matched this way
  for (const c of REF_COLUMNS) if (info.cols.has(c)) parts.push(info.cols.has('space_id') ? `(space_id IS NULL AND ${inIds(c)})` : inIds(c));
  if (info.name === 'scheduled_jobs') for (const k of JOB_KEYS) parts.push(`(json_valid(payload) AND json_extract(payload, '$.${k}') IN (SELECT id FROM temp.demo_purge_ids))`);
  if (info.name === 'reminder_log') parts.push(`substr(key, 10, 36) IN (SELECT id FROM temp.demo_purge_ids)`);
  return parts.length ? { where: parts.join(' OR '), args } : null;
}

/** Why this listed sandbox must not be deleted (null = it is a sandbox in every respect). */
function deletionProblem(row: SandboxRow): string | null {
  const user = getRecord<UserRecord>('lit_user', row.user_id);
  const bootstrap = process.env.NC_BOOTSTRAP_EMAIL?.trim().toLowerCase();
  if (user && (!SANDBOX_EMAIL.test(String(user.email ?? '')) || (bootstrap && user.email === bootstrap))) return 'the user is not a demo guest';
  const space = row.space_id ? getRecord<SpaceRecord>('space', row.space_id) : undefined;
  if (space && space.created_by_id !== row.user_id) return 'the workspace was not created by the guest';
  if (space && (space.permissions ?? []).some((p) => p.user_id && p.user_id !== row.user_id && p.role !== 'none')) return 'the workspace has other members';
  return null;
}

/**
 * Delete one sandbox for good: the user, sessions, workspace, space views, teams, every record of the workspace,
 * everything keyed by them in other tables (search index, history, activity, notifications, jobs …) and uploaded files.
 * Returns false (and deletes nothing) outside demo mode or for anything that is not a sandbox.
 */
export function deleteSandbox(userId: string): boolean {
  if (!isDemoMode()) return false;
  ensureTable();
  const row = db.prepare('SELECT * FROM demo_sandboxes WHERE user_id = ?').get(userId) as SandboxRow | undefined;
  if (!row) return false;
  const problem = deletionProblem(row);
  if (problem) {
    // never delete data that may not be a sandbox's: stop tracking it instead
    console.warn(`[demo] kept listed sandbox ${row.user_id}: ${problem}`);
    db.prepare('DELETE FROM demo_sandboxes WHERE user_id = ?').run(row.user_id);
    return false;
  }
  const user = getRecord<UserRecord>('lit_user', row.user_id);
  const email = user?.email && SANDBOX_EMAIL.test(user.email) ? user.email : null;
  const space = row.space_id || null;
  const fileIds: string[] = [];
  runSql(`CREATE TEMP TABLE IF NOT EXISTS demo_purge_ids (id TEXT PRIMARY KEY);
          CREATE TEMP TABLE IF NOT EXISTS demo_purge_user (id TEXT);
          CREATE TEMP TABLE IF NOT EXISTS demo_purge_space (id TEXT);`);
  const clear = () => runSql('DELETE FROM temp.demo_purge_ids; DELETE FROM temp.demo_purge_user; DELETE FROM temp.demo_purge_space;');
  tx(() => {
    clear();
    db.prepare('INSERT INTO temp.demo_purge_user (id) VALUES (?)').run(row.user_id);
    if (space) db.prepare('INSERT INTO temp.demo_purge_space (id) VALUES (?)').run(space);
    const addIds = db.prepare('INSERT OR IGNORE INTO temp.demo_purge_ids (id) SELECT id FROM records WHERE tbl = ? AND space_id = ?');
    if (space) for (const tbl of TABLES) addIds.run(tbl, space);
    // an id the guest chose that also names something outside the sandbox is never used to delete by reference
    db.prepare(`DELETE FROM temp.demo_purge_ids WHERE id IN (SELECT r.id FROM records r JOIN temp.demo_purge_ids p ON r.id = p.id
                WHERE r.tbl IN (${TABLES.map(() => '?').join(',')}) AND (r.space_id IS NULL OR r.space_id != ?))`).run(...TABLES, space ?? '');
    db.prepare('DELETE FROM temp.demo_purge_ids WHERE id IN (SELECT id FROM files WHERE NOT (user_id IS ? OR space_id IS ?))').run(row.user_id, space ?? '');
    db.prepare('INSERT OR IGNORE INTO temp.demo_purge_ids (id) VALUES (?)').run(row.user_id);
    if (space) db.prepare('INSERT OR IGNORE INTO temp.demo_purge_ids (id) VALUES (?)').run(space);
    // the guest's own records outside the workspace (visits of template pages, notifications, follows)
    const own = db.prepare(`SELECT tbl, id, space_id FROM records WHERE tbl IN ('page_visit', 'notification', 'follow') AND json_extract(data, '$.user_id') = ?`).all(row.user_id) as { tbl: string; id: string; space_id: string | null }[];
    // rows of other tables that go: their ids join the set, so rows hanging off them (messages of a thread …) go too
    const tables = otherTables();
    for (let round = 0; round < 3; round++) {
      for (const info of tables) {
        if (!info.cols.has('id')) continue;
        const cond = sandboxCondition(info, email);
        if (cond) db.prepare(`INSERT OR IGNORE INTO temp.demo_purge_ids (id) SELECT id FROM "${info.name}" WHERE ${cond.where}`).run(...cond.args);
      }
    }
    const files = tables.find((x) => x.name === 'files');
    const fileCond = files && sandboxCondition(files, email);
    if (fileCond) for (const f of db.prepare(`SELECT id FROM files WHERE ${fileCond.where}`).all(...fileCond.args) as { id: string }[]) fileIds.push(f.id);
    for (const info of tables) {
      const cond = sandboxCondition(info, email);
      if (cond) db.prepare(`DELETE FROM "${info.name}" WHERE ${cond.where}`).run(...cond.args);
    }
    if (space) {
      const delSpace = db.prepare('DELETE FROM records WHERE tbl = ? AND space_id = ?');
      for (const tbl of TABLES) delSpace.run(tbl, space);
      db.prepare('DELETE FROM changes WHERE space_id = ?').run(space);
    }
    for (const r of own) {
      db.prepare('DELETE FROM records WHERE tbl = ? AND id = ?').run(r.tbl, r.id);
      db.prepare('DELETE FROM changes WHERE space_id IS ? AND tbl = ? AND id = ?').run(r.space_id, r.tbl, r.id);
    }
    for (const tbl of ['lit_user', 'user_root', 'user_settings']) {
      db.prepare('DELETE FROM records WHERE tbl = ? AND id = ?').run(tbl, row.user_id);
      db.prepare('DELETE FROM changes WHERE space_id IS NULL AND tbl = ? AND id = ?').run(tbl, row.user_id);
    }
    db.prepare('DELETE FROM demo_sandboxes WHERE user_id = ?').run(row.user_id);
    clear();
  });
  for (const id of fileIds) {
    if (/^[0-9a-f-]{36}$/i.test(id)) rmSync(join(DATA_DIR, 'files', id), { force: true });
  }
  realtime.endUserSessions(row.user_id);
  return true;
}

/** Delete every sandbox past its lifetime. Returns how many were deleted. */
export function purgeExpiredSandboxes(now = Date.now()): number {
  if (!isDemoMode()) return 0;
  ensureTable();
  let n = 0;
  for (const r of db.prepare('SELECT user_id FROM demo_sandboxes WHERE expires <= ? ORDER BY expires LIMIT 500').all(now) as { user_id: string }[]) {
    try {
      if (deleteSandbox(r.user_id)) n++;
    } catch (e) {
      console.error(`[demo] could not delete sandbox ${r.user_id}`, e);
    }
  }
  if (n) console.log(`[demo] deleted ${n} expired sandbox${n === 1 ? '' : 'es'}`);
  return n;
}

/** main.ts: clean up once at start and every few minutes. */
export function startDemoSandboxCleanup(): NodeJS.Timeout | undefined {
  if (!isDemoMode()) return undefined;
  purgeExpiredSandboxes();
  const timer = setInterval(() => purgeExpiredSandboxes(), CLEANUP_INTERVAL_MS);
  timer.unref();
  return timer;
}

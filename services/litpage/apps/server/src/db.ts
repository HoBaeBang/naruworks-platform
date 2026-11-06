// SQLite persistence (node:sqlite). Records are stored as JSON rows keyed by (table, id), mirroring
// the record model; a change log (lsn) lets clients resync after reconnecting.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { BaseRecord, Table } from '@nc/shared/records.ts';

export const DATA_DIR = process.env.NC_DATA_DIR ?? join(import.meta.dirname, '..', 'data');
mkdirSync(DATA_DIR, { recursive: true });
mkdirSync(join(DATA_DIR, 'files'), { recursive: true });

const DB_PATH = process.env.NC_DB ?? join(DATA_DIR, 'litpage.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS records (
  tbl TEXT NOT NULL,
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  space_id TEXT,
  parent_id TEXT,
  parent_table TEXT,
  alive INTEGER,
  last_edited_time INTEGER,
  data TEXT NOT NULL,
  PRIMARY KEY (tbl, id)
);
CREATE INDEX IF NOT EXISTS idx_records_parent ON records(tbl, parent_id);
CREATE INDEX IF NOT EXISTS idx_records_space ON records(tbl, space_id, last_edited_time);

CREATE TABLE IF NOT EXISTS changes (
  lsn INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  id TEXT NOT NULL,
  space_id TEXT,
  version INTEGER NOT NULL,
  time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_changes_space ON changes(space_id, lsn);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
  email TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  expires INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS passwords (
  user_id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  salt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  space_id TEXT,
  user_id TEXT,
  name TEXT,
  mime TEXT,
  size INTEGER,
  path TEXT,
  created_time INTEGER
);

CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  space_id TEXT,
  created_time INTEGER NOT NULL,
  author_ids TEXT,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_page ON snapshots(page_id, created_time);

CREATE TABLE IF NOT EXISTS activity (
  id TEXT PRIMARY KEY,
  space_id TEXT,
  page_id TEXT,
  block_id TEXT,
  user_id TEXT,
  type TEXT,
  created_time INTEGER,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_activity_page ON activity(page_id, created_time);
CREATE INDEX IF NOT EXISTS idx_activity_space ON activity(space_id, created_time);

-- transaction ids already applied (client retries after a lost response must not re-apply text splices)
CREATE TABLE IF NOT EXISTS applied_tx (
  id TEXT PRIMARY KEY,
  at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS search_index USING fts5(
  block_id UNINDEXED, page_id UNINDEXED, space_id UNINDEXED, kind UNINDEXED, text,
  tokenize = 'trigram'
);
`);

const stmt = {
  get: db.prepare('SELECT data FROM records WHERE tbl = ? AND id = ?'),
  put: db.prepare(`INSERT INTO records (tbl, id, version, space_id, parent_id, parent_table, alive, last_edited_time, data)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(tbl, id) DO UPDATE SET version=excluded.version, space_id=excluded.space_id, parent_id=excluded.parent_id,
      parent_table=excluded.parent_table, alive=excluded.alive, last_edited_time=excluded.last_edited_time, data=excluded.data`),
  change: db.prepare('INSERT INTO changes (tbl, id, space_id, version, time) VALUES (?, ?, ?, ?, ?)'),
  children: db.prepare('SELECT data FROM records WHERE tbl = ? AND parent_id = ?'),
  bySpace: db.prepare('SELECT data FROM records WHERE tbl = ? AND space_id = ?'),
};

export function getRecord<T extends BaseRecord = BaseRecord>(table: Table, id: string): T | undefined {
  const row = stmt.get.get(table, id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as T) : undefined;
}

export function getRecords<T extends BaseRecord = BaseRecord>(table: Table, ids: string[]): T[] {
  const out: T[] = [];
  for (const id of ids) {
    const r = getRecord<T>(table, id);
    if (r) out.push(r);
  }
  return out;
}

/** Persist a full record value (version must already be bumped by caller). Returns the change lsn. */
export function putRecord(table: Table, value: BaseRecord): number {
  const v = value as any;
  stmt.put.run(
    table, v.id, v.version ?? 0, v.space_id ?? (table === 'space' ? v.id : null), v.parent_id ?? null, v.parent_table ?? null,
    v.alive === false ? 0 : 1, v.last_edited_time ?? Date.now(), JSON.stringify(value),
  );
  const res = stmt.change.run(table, v.id, v.space_id ?? (table === 'space' ? v.id : null), v.version ?? 0, Date.now());
  return Number(res.lastInsertRowid);
}

export function childrenOf<T extends BaseRecord = BaseRecord>(table: Table, parentId: string): T[] {
  return (stmt.children.all(table, parentId) as { data: string }[]).map((r) => JSON.parse(r.data) as T);
}

export function recordsInSpace<T extends BaseRecord = BaseRecord>(table: Table, spaceId: string): T[] {
  return (stmt.bySpace.all(table, spaceId) as { data: string }[]).map((r) => JSON.parse(r.data) as T);
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function currentLsn(): number {
  const row = db.prepare('SELECT MAX(lsn) AS lsn FROM changes').get() as { lsn: number | null };
  return row.lsn ?? 0;
}

export function changesSince(spaceIds: string[], lsn: number, limit = 5000): { lsn: number; tbl: Table; id: string; version: number }[] {
  if (!spaceIds.length) return [];
  const q = db.prepare(`SELECT lsn, tbl, id, version FROM changes WHERE lsn > ? AND space_id IN (${spaceIds.map(() => '?').join(',')}) ORDER BY lsn LIMIT ?`);
  return q.all(lsn, ...spaceIds, limit) as any;
}

export function findUserIdByEmail(email: string): string | null {
  const row = db.prepare("SELECT id FROM records WHERE tbl = 'lit_user' AND json_extract(data, '$.email') = ?").get(email.toLowerCase()) as { id: string } | undefined;
  if (row) return row.id;
  // secondary emails (Settings › Account › Manage emails; table created by api/modules/account.ts) log in to the same account
  try {
    return (db.prepare('SELECT user_id FROM user_emails WHERE email = ?').get(email.toLowerCase()) as { user_id: string } | undefined)?.user_id ?? null;
  } catch {
    return null;
  }
}

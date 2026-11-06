// Server-owned values of database rows, set while a write is persisted (records.ts onBeforePersist):
// - Unique ID: every new row (or row moved into the data source) gets the next number of the ID
// property from a per-property counter that only grows — numbers are never reused, even when the last row is
// deleted, and concurrent creators can't collide (applyTransactions runs inside one SQLite write transaction).
// Clients show a provisional number; the applyChanges echo replaces it. Existing IDs can't be changed.
// - Person "Default: Created by": an empty Person property with that default gets the creator.
// - A property with an access rule deleted for good (gone from schema and deleted_schema) takes its values
// off the rows in the same write: no rule is left to mask them, and a new property with the same id must not show
// them again.
import type { BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { hasPropertyRule, schemaWithDeleted } from '@nc/shared/database/propertyAccess.ts';
import { db, getRecord } from './db.ts';
import { onBeforePersist, type AppliedChange } from './records.ts';

db.exec(`CREATE TABLE IF NOT EXISTS auto_increment_counters (
  collection_id TEXT NOT NULL,
  property_id TEXT NOT NULL,
  next INTEGER NOT NULL,
  PRIMARY KEY (collection_id, property_id)
)`);

const counterGet = db.prepare('SELECT next FROM auto_increment_counters WHERE collection_id = ? AND property_id = ?');
const counterSet = db.prepare(`INSERT INTO auto_increment_counters (collection_id, property_id, next) VALUES (?, ?, ?)
  ON CONFLICT(collection_id, property_id) DO UPDATE SET next = excluded.next`);
const rowsOf = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND parent_id = ? AND parent_table = 'collection'`);
const exists = db.prepare('SELECT 1 AS hit FROM records WHERE tbl = ? AND id = ?');

/** Number stored in an ID value ([["12"]] → 12). */
export function idNumber(v: unknown): number | null {
  const raw = Array.isArray(v) && Array.isArray(v[0]) ? String(v[0][0] ?? '') : '';
  const n = Number(raw.replace(/^\D+/, ''));
  return raw && Number.isInteger(n) && n > 0 ? n : null;
}

function highestExisting(collectionId: string, propId: string, changed: Map<string, AppliedChange>): number {
  let max = 0;
  for (const r of rowsOf.all(collectionId) as { data: string }[]) {
    const b = JSON.parse(r.data) as BlockRecord;
    if (changed.has(`block:${b.id}`)) continue;
    max = Math.max(max, idNumber(b.properties?.[propId]) ?? 0);
  }
  return max;
}

/** Reserve the next number (counter starts after the highest number in use). */
function reserve(collectionId: string, propId: string, changed: Map<string, AppliedChange>, floor = 0): number {
  const row = counterGet.get(collectionId, propId) as { next: number } | undefined;
  const n = Math.max(row?.next ?? highestExisting(collectionId, propId, changed) + 1, floor + 1);
  counterSet.run(collectionId, propId, n + 1);
  return n;
}

function raiseCounter(collectionId: string, propId: string, used: number, changed: Map<string, AppliedChange>) {
  const row = counterGet.get(collectionId, propId) as { next: number } | undefined;
  const next = row?.next ?? highestExisting(collectionId, propId, changed) + 1;
  if (used >= next) counterSet.run(collectionId, propId, used + 1);
  else if (!row) counterSet.run(collectionId, propId, next);
}

const personValue = (userId: string) => [['‣', [['u', userId]]]];

onBeforePersist((changed, userId) => {
  const collections = new Map<string, CollectionRecord | undefined>();
  const colOf = (id: string) => {
    if (!collections.has(id)) collections.set(id, (changed.get(`collection:${id}`)?.record as CollectionRecord | undefined) ?? getRecord<CollectionRecord>('collection', id));
    return collections.get(id);
  };
  const fresh: { b: BlockRecord; ids: [string, PropertySchema][] }[] = [];
  for (const ch of changed.values()) {
    if (ch.table !== 'block') continue;
    const b = ch.record as BlockRecord;
    if (b.parent_table !== 'collection' || b.alive === false) continue;
    const col = colOf(b.parent_id);
    if (!col?.schema) continue;
    const ids = Object.entries(col.schema).filter(([, p]) => p.type === 'auto_increment_id');
    const people = Object.entries(col.schema).filter(([, p]) => p.type === 'person' && (p as { default?: string }).default === 'created_by');
    if (!ids.length && !people.length) continue;
    const prev = exists.get('block', b.id) ? getRecord<BlockRecord>('block', b.id) : undefined;
    const isNew = !prev || prev.parent_id !== b.parent_id || prev.parent_table !== 'collection';
    if (isNew) {
      if (!b.is_template) for (const [pid, p] of people) {
        const v = b.properties?.[pid] as unknown[] | undefined;
        if (!v || !v.length) b.properties = { ...(b.properties ?? {}), [pid]: personValue(b.created_by_id ?? userId) as never };
        void p;
      }
      if (ids.length) fresh.push({ b, ids });
      continue;
    }
    // existing rows: an ID is kept as it is; a first number (ID property just added) raises the counter
    for (const [pid] of ids) {
      const before = prev?.properties?.[pid];
      const after = b.properties?.[pid];
      if (before !== undefined && idNumber(before) !== null) {
        if (JSON.stringify(before) !== JSON.stringify(after)) b.properties = { ...(b.properties ?? {}), [pid]: before };
      } else if (idNumber(after) !== null) {
        raiseCounter(b.parent_id, pid, idNumber(after)!, changed);
      }
    }
  }
  // new rows in creation order (templates don't take a number)
  fresh.sort((x, y) => (x.b.created_time ?? 0) - (y.b.created_time ?? 0));
  for (const { b, ids } of fresh) {
    for (const [pid] of ids) {
      if (b.is_template) {
        if (b.properties?.[pid] !== undefined) {
          const { [pid]: _drop, ...rest } = b.properties;
          b.properties = rest;
        }
        continue;
      }
      b.properties = { ...(b.properties ?? {}), [pid]: [[String(reserve(b.parent_id, pid, changed))]] as never };
    }
  }
});

onBeforePersist((changed) => {
  for (const ch of [...changed.values()]) {
    if (ch.table !== 'collection') continue;
    const prev = getRecord<CollectionRecord>('collection', ch.record.id);
    if (!prev) continue;
    const next = ch.record as CollectionRecord;
    const before = schemaWithDeleted(prev.schema, (prev as { deleted_schema?: unknown }).deleted_schema);
    const after = schemaWithDeleted(next.schema, (next as { deleted_schema?: unknown }).deleted_schema);
    const gone = Object.keys(before).filter((pid) => !after[pid] && hasPropertyRule(before[pid]));
    if (!gone.length) continue;
    for (const r of rowsOf.all(prev.id) as { data: string }[]) {
      const stored = JSON.parse(r.data) as BlockRecord;
      const key = `block:${stored.id}`;
      const cur = (changed.get(key)?.record as BlockRecord | undefined) ?? stored;
      if (cur.parent_table !== 'collection' || cur.parent_id !== prev.id || !gone.some((pid) => cur.properties?.[pid] !== undefined)) continue;
      const props = { ...(cur.properties ?? {}) } as Record<string, unknown>;
      for (const pid of gone) delete props[pid];
      changed.set(key, { table: 'block', record: { ...cur, properties: props } as BlockRecord, spaceId: cur.space_id ?? ch.spaceId });
    }
  }
});

/** Page of a data source by its ID number (ID URLs, searching for an ID). */
export function rowByUniqueId(collectionId: string, propId: string, n: number): BlockRecord | undefined {
  for (const r of rowsOf.all(collectionId) as { data: string }[]) {
    const b = JSON.parse(r.data) as BlockRecord;
    if (b.alive !== false && !b.is_template && idNumber(b.properties?.[propId]) === n) return b;
  }
  return undefined;
}

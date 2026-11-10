// Property access on the way out: values of properties a person can't see are removed from database rows,
// and properties with "No access" are removed from the data source schema, before records reach them (record maps and
// realtime pushes). Writes are checked in dbaccess.ts. Rules: packages/shared/src/database/propertyAccess.ts.
// Deleted properties (collection.deleted_schema) keep their rule: their values stay on the rows (so they can be
// restored) and are masked like live ones; values of properties deleted for good are never sent (a restricted one's
// values are also taken off the rows, rowdefaults.ts).
import type { BaseRecord, BlockRecord, CollectionRecord, Role, SpaceRecord, Table } from '@nc/shared/records.ts';
import {
  canEditPropertyValues, canSeePropertyValues, groupIdsOf, isEmptyPropertyValue, propertyRoleFor, redactRowProperties, redactSchema, restrictedPropertyIds,
  schemaWithDeleted, type PropertyRole,
} from '@nc/shared/database/propertyAccess.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { pageAccessRulesOf } from '@nc/shared/database/access.ts';
import { db, getRecord } from './db.ts';
import { blockRole, onCommit } from './records.ts';
import { automationForViewer } from './webhookSecrets.ts';

// rows of one collection are redacted many times per request: keep parsed collections / spaces while their version holds
const versionStmt = db.prepare('SELECT version FROM records WHERE tbl = ? AND id = ?');
interface Entry { version: number; rec: BaseRecord | undefined; restricted: boolean; known: Set<string> }
const cache = new Map<string, Entry>();

function cached<T extends BaseRecord>(table: 'collection' | 'space', id: string): { rec: T | undefined; restricted: boolean; known: Set<string> } {
  const key = `${table}:${id}`;
  const version = (versionStmt.get(table, id) as { version: number } | undefined)?.version ?? -1;
  const hit = cache.get(key);
  if (hit && hit.version === version) return hit as { rec: T | undefined; restricted: boolean; known: Set<string> };
  const rec = version < 0 ? undefined : getRecord<T>(table, id);
  const all = table === 'collection' && rec ? schemaWithDeleted((rec as unknown as CollectionRecord).schema, deletedSchemaOf(rec)) : {};
  const entry: Entry = { version, rec, restricted: restrictedPropertyIds(all).length > 0, known: new Set(Object.keys(all)) };
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  cache.set(key, entry);
  return entry as { rec: T | undefined; restricted: boolean; known: Set<string> };
}

/** collection.deleted_schema (deleted properties, restorable). */
export function deletedSchemaOf(c: unknown): Record<string, any> | undefined {
  const d = (c as { deleted_schema?: unknown } | undefined)?.deleted_schema;
  return d && typeof d === 'object' ? (d as Record<string, any>) : undefined;
}

// candidate rows a person may reach without access to their database: rows carrying their own sharing, and — with
// page-level rules — rows naming them (Person / Created by values); each candidate is then checked
const SHARED_ROW = '%"permissions":[{%';
const reachStmt = db.prepare(`SELECT id FROM records WHERE tbl = 'block' AND parent_id = ? AND alive = 1 AND (data LIKE ? OR data LIKE ?) LIMIT 200`);
// answers are kept until a row or the page-level rules of that data source change (or a minute passes): realtime
// pushes of a data source ask once per connected person without access to the database
const reach = new Map<string, { ok: boolean; at: number }>();
const REACH_TTL_MS = 60_000;
let reachHooked = false;

function hookReachInvalidation() {
  if (reachHooked) return;
  reachHooked = true;
  onCommit((info) => {
    const touched = new Set<string>();
    for (const ch of info.changes) {
      const r = ch.record as { id: string; parent_id?: string; parent_table?: string; permission_rules?: unknown };
      const prev = info.prev.get(`${ch.table}:${r.id}`) as { parent_id?: string; parent_table?: string; permission_rules?: unknown } | undefined;
      if (ch.table === 'block') {
        if (r.parent_table === 'collection' && r.parent_id) touched.add(r.parent_id);
        if (prev?.parent_table === 'collection' && prev.parent_id) touched.add(prev.parent_id);
      } else if (ch.table === 'collection' && JSON.stringify(prev?.permission_rules ?? null) !== JSON.stringify(r.permission_rules ?? null)) touched.add(r.id);
    }
    if (!touched.size) return;
    for (const k of reach.keys()) if (touched.has(k.slice(0, k.indexOf('|')))) reach.delete(k);
  });
}

/** Can `userId` open at least one row of data source `c` (whatever their access to the database)? */
function someRowReachable(c: { id: string; schema?: unknown; permission_rules?: unknown }, userId: string | null): boolean {
  hookReachInvalidation();
  const key = `${c.id}|${userId ?? ''}`;
  const hit = reach.get(key);
  if (hit && Date.now() - hit.at < REACH_TTL_MS) return hit.ok;
  const rules = pageAccessRulesOf(c as never).length > 0;
  const pattern = rules && userId && /^[\w-]{1,64}$/.test(userId) ? `%"${userId}"%` : SHARED_ROW;
  let ok = false;
  for (const r of reachStmt.all(c.id, pattern, SHARED_ROW) as { id: string }[]) {
    if (blockRole(r.id, userId) !== 'none') { ok = true; break; }
  }
  if (reach.size > 20_000) reach.clear();
  reach.set(key, { ok, at: Date.now() });
  return ok;
}

/**
 * Role on a data source: the role on its database block — or "Can view" for people who can open some of its rows
 * without access to the database (page-level access rules, a row page shared with them): they get the schema, redacted
 * like for viewers, so those row pages show their properties and linked views of the source load.
 */
export function collectionRole(c: { id: string; parent_id?: string; schema?: unknown; permission_rules?: unknown } | undefined, userId: string | null): Role {
  if (!c?.parent_id) return 'none';
  const role = blockRole(c.parent_id, userId);
  return role !== 'none' ? role : someRowReachable(c, userId) ? 'reader' : 'none';
}

/** Row values under keys no property (live or deleted) describes: left by a property deleted for good — never sent,
 * as no rule is left to mask them and nothing shows them. */
function hasOrphanValues(props: Record<string, unknown> | undefined, known: Set<string>): boolean {
  for (const k in props ?? {}) if (k !== 'title' && !known.has(k)) return true;
  return false;
}

function withoutOrphanValues(b: BlockRecord, known: Set<string>): BaseRecord {
  const props: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(b.properties ?? {})) if (k === 'title' || known.has(k)) props[k] = v;
  return { ...b, properties: props } as BaseRecord;
}

/** `rec` as `userId` may see it (`role` = their role on the record when the caller knows it). */
export function redactDatabaseRecord(table: Table, rec: BaseRecord, userId: string | null, role?: Role): BaseRecord {
  if (table === 'block') {
    const b = rec as BlockRecord;
    if (b.parent_table !== 'collection' || !b.properties) return rec;
    const { rec: col, restricted, known } = cached<CollectionRecord>('collection', b.parent_id);
    if (!col) return rec;
    if (!restricted) return hasOrphanValues(b.properties as Record<string, unknown>, known) ? withoutOrphanValues(b, known) : rec;
    const space = cached<SpaceRecord>('space', col.space_id ?? b.space_id).rec;
    return redactRowProperties(b, col.schema, {
      userId, databaseRole: blockRole(col.parent_id, userId), rowRole: role ?? blockRole(b.id, userId), groupIds: groupIdsOf(space, userId),
    }, { deleted: deletedSchemaOf(col), orphans: true }) as BaseRecord;
  }
  if (table === 'collection') {
    const c = rec as CollectionRecord;
    const deleted = deletedSchemaOf(c);
    if (!restrictedPropertyIds(c.schema).length && !restrictedPropertyIds(deleted).length) return rec;
    const space = cached<SpaceRecord>('space', c.space_id).rec;
    const ctx = { userId, databaseRole: role ?? collectionRole(c, userId), groupIds: groupIdsOf(space, userId) };
    const schema = redactSchema(c.schema, ctx);
    // a deleted "No access" property stays out of "Deleted properties" too (name and rule)
    const del = deleted ? redactSchema(deleted, ctx) : undefined;
    if (schema === c.schema && del === deleted) return rec;
    return { ...c, schema, ...(del !== deleted ? { deleted_schema: del } : {}) } as BaseRecord;
  }
  if (table === 'automation') {
    // people who can't edit the database see automations without webhook destinations / headers
    const col = getRecord<CollectionRecord>('collection', (rec as { parent_id?: string }).parent_id ?? '');
    return automationForViewer(rec, role ?? (col?.parent_id ? blockRole(col.parent_id, userId) : 'none'));
  }
  return rec;
}

/**
 * `userId`'s property role on the value of `propId` on database row `row` (live or deleted property, by its rule).
 * A property gone from both schemas counts as full access only. `roles` passes roles the caller already knows.
 */
export function rowValueRole(row: BlockRecord, propId: string, userId: string | null, roles: { databaseRole?: Role; rowRole?: Role } = {}): PropertyRole {
  if (row.parent_table !== 'collection') return 'editor';
  const { rec: col } = cached<CollectionRecord>('collection', row.parent_id);
  if (!col) return 'none';
  const all = schemaWithDeleted(col.schema, deletedSchemaOf(col));
  const databaseRole = roles.databaseRole ?? blockRole(col.parent_id, userId);
  if (!all[propId]) return roleAtLeast(databaseRole, 'editor') ? 'editor' : 'none';
  const space = cached<SpaceRecord>('space', col.space_id ?? row.space_id).rec;
  return propertyRoleFor(all[propId], { userId, databaseRole, rowRole: roles.rowRole ?? blockRole(row.id, userId), groupIds: groupIdsOf(space, userId), row, schema: all });
}

/** May `userId` see the value of `propId` on `row`? */
export function canSeeRowValue(row: BlockRecord, propId: string, userId: string | null, roles?: { databaseRole?: Role; rowRole?: Role }): boolean {
  return canSeePropertyValues(rowValueRole(row, propId, userId, roles));
}

/** May `userId` change the value of `propId` on `row` (property rule only — edit access to the row is checked apart)? */
export function canEditRowValue(row: BlockRecord, propId: string, userId: string | null, roles?: { databaseRole?: Role; rowRole?: Role }): boolean {
  return canEditPropertyValues(rowValueRole(row, propId, userId, roles));
}

/**
 * Values of a copy of row `source` (duplicate row / page, a template duplicated in place) as `userId` may write them into
 * the same data source: restricted values they couldn't see on the source, or can't edit on a page they create, are left
 * out (dbaccess.ts refuses new rows carrying them — whatever path writes them).
 */
export function writableCopyValues(source: BlockRecord, props: Record<string, unknown> | undefined, userId: string): Record<string, unknown> | undefined {
  if (!props || source.parent_table !== 'collection') return props;
  const { rec: col } = cached<CollectionRecord>('collection', source.parent_id);
  if (!col) return props;
  const all = schemaWithDeleted(col.schema, deletedSchemaOf(col));
  const ids = restrictedPropertyIds(all).filter((pid) => props[pid] !== undefined);
  if (!ids.length) return props;
  const databaseRole = blockRole(col.parent_id, userId);
  if (roleAtLeast(databaseRole, 'editor')) return props;
  const groupIds = groupIdsOf(cached<SpaceRecord>('space', col.space_id ?? source.space_id).rec, userId);
  const sourceRole = blockRole(source.id, userId);
  const copy = { ...source, properties: props, created_by_id: userId } as BlockRecord;
  let out: Record<string, unknown> | null = null;
  for (const pid of ids) {
    const seen = canSeePropertyValues(propertyRoleFor(all[pid], { userId, databaseRole, rowRole: sourceRole, groupIds, row: source, schema: all }));
    const editable = canEditPropertyValues(propertyRoleFor(all[pid], { userId, databaseRole, rowRole: 'editor', groupIds, row: copy, schema: all }));
    if (seen && editable) continue;
    out ??= { ...props };
    delete out[pid];
  }
  return out ?? props;
}

/**
 * Could `userId` create a row of data source `collectionId` carrying `props` (made by `createdBy`)? Restricted values need
 * edit access on the new page — the check dbaccess.ts makes on every write (forms pick who writes a response with it).
 */
export function canWriteNewRow(collectionId: string, props: Record<string, unknown> | undefined, userId: string, createdBy = userId): boolean {
  const { rec: col } = cached<CollectionRecord>('collection', collectionId);
  if (!col) return false;
  const all = schemaWithDeleted(col.schema, deletedSchemaOf(col));
  const ids = restrictedPropertyIds(all).filter((pid) => !isEmptyPropertyValue(props?.[pid]));
  if (!ids.length) return true;
  const databaseRole = blockRole(col.parent_id, userId);
  if (roleAtLeast(databaseRole, 'editor')) return true;
  const groupIds = groupIdsOf(cached<SpaceRecord>('space', col.space_id).rec, userId);
  const row = { properties: props ?? {}, created_by_id: createdBy } as unknown as BlockRecord;
  return ids.every((pid) => canEditPropertyValues(propertyRoleFor(all[pid], { userId, databaseRole, rowRole: 'editor', groupIds, row, schema: all })));
}

/**
 * Comment threads on a database property value (discussion.property_id) belong to that value: people who
 * can't see the value don't get the thread (record maps, realtime, comments sidebar, Inbox notifications).
 */
export function propertyThreadVisible(d: { parent_id?: string; property_id?: unknown } | undefined, userId: string | null): boolean {
  const pid = typeof d?.property_id === 'string' ? d.property_id : '';
  if (!pid || !d?.parent_id) return true;
  const row = getRecord<BlockRecord>('block', d.parent_id);
  if (!row || row.parent_table !== 'collection') return true;
  return canSeeRowValue(row, pid, userId);
}

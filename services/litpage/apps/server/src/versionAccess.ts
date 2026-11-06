// What a person may see and write back of a stored page version. A version holds the page's blocks
// and the databases it shows (history.ts: data source, up to 1,000 records with every property value, views), so it
// leaves the server only redacted for the caller, like today's page would be:
// - records they can't open now (page-level access rules, "Can only create", restricted rows) are left out; records
// deleted since are judged by today's rules on the version's values
// - values of properties they can't see are removed and "No access" properties drop out of the schema — by today's
// property access rules (restoring keeps the current rules), by the version's own rule for a property
// deleted for good since; a row page's own property values likewise
// - nested pages restricted from them are left out
// Restoring writes back only what the restorer may edit (restorableProperties); access rules always stay as they are.
import { effectiveRole } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, PropertySchema, Role, SpaceRecord } from '@nc/shared/records.ts';
import { groupIdsOf, redactRowProperties, redactSchema, schemaWithDeleted } from '@nc/shared/database/propertyAccess.ts';
import { getRecord } from './db.ts';
import { blockRole, lookup } from './records.ts';
import { canEditRowValue, deletedSchemaOf, redactDatabaseRecord } from './propaccess.ts';
import type { DatabaseSnapshot } from './history.ts';

type Rec = Record<string, any>;
const PAGE_TYPES = new Set(['page', 'collection_view_page']);

/** Role on a block of a version: today's role when the block still exists, else the version's block judged in place. */
function versionBlockRole(b: BlockRecord, userId: string, overlay: Map<string, BlockRecord> = new Map([[b.id, b]])): Role {
  if (getRecord<BlockRecord>('block', b.id)) return blockRole(b.id, userId);
  return effectiveRole({ ...lookup, block: (id) => overlay.get(id) ?? lookup.block(id) }, b.id, userId);
}

/** A version's property schema with today's access rules (a property deleted for good keeps the version's rule). */
function withLiveRules(schema: Record<string, PropertySchema> | undefined, live: CollectionRecord | undefined): Record<string, PropertySchema> {
  const out: Record<string, PropertySchema> = {};
  const now = live ? schemaWithDeleted(live.schema, deletedSchemaOf(live)) : {};
  for (const [pid, p] of Object.entries(schema ?? {})) {
    if (!p || typeof p !== 'object') continue;
    const cur = now[pid];
    if (!cur) { out[pid] = p; continue; }
    const { property_permissions: _old, ...rest } = p as PropertySchema & { property_permissions?: unknown };
    const rule = (cur as { property_permissions?: unknown }).property_permissions;
    out[pid] = (rule ? { ...rest, property_permissions: rule } : rest) as PropertySchema;
  }
  return out;
}

function redactDatabase(d: DatabaseSnapshot, pageId: string, userId: string): DatabaseSnapshot | null {
  const host = getRecord<BlockRecord>('block', d.blockId);
  const dbRole = host ? blockRole(host.id, userId) : blockRole(pageId, userId);
  if (dbRole === 'none') return null;
  if (!d.owned || !d.collection) return { ...d, rows: undefined };
  const live = getRecord<CollectionRecord>('collection', d.collection.id);
  const space = getRecord<SpaceRecord>('space', d.collection.space_id ?? host?.space_id ?? '');
  const groupIds = groupIdsOf(space, userId);
  const schema = withLiveRules(d.collection.schema, live);
  const deleted = withLiveRules(deletedSchemaOf(d.collection), live);
  const ctx = { userId, databaseRole: dbRole, groupIds };
  const collection = { ...d.collection, schema: redactSchema(schema, ctx), ...(deletedSchemaOf(d.collection) ? { deleted_schema: redactSchema(deleted, ctx) } : {}) } as CollectionRecord;
  // rows deleted since are judged under today's data source (its page-level rules) or the version's
  const colOverlay = live ?? d.collection;
  const rows: BlockRecord[] = [];
  for (const r of d.rows ?? []) {
    const cur = getRecord<BlockRecord>('block', r.id);
    const rowRole = cur
      ? blockRole(cur.id, userId)
      : effectiveRole({ ...lookup, block: (id) => (id === r.id ? r : lookup.block(id)), collection: (id) => (id === colOverlay.id ? colOverlay : lookup.collection(id)) }, r.id, userId);
    if (rowRole === 'none') continue;
    rows.push(redactRowProperties(r, schema, { ...ctx, rowRole }, { deleted, orphans: true }));
  }
  return { ...d, collection, rows };
}

/** `data` (a stored version of `pageId`) as `userId` may see it. */
export function redactVersionData<T extends { blocks?: unknown; databases?: unknown }>(pageId: string, data: T, userId: string): T {
  const blocks = (Array.isArray(data?.blocks) ? data.blocks : []) as BlockRecord[];
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const kept: BlockRecord[] = [];
  for (const b of blocks) {
    if (b.id === pageId) {
      // a database row page: its own property values follow property access like the live page
      kept.push(b.parent_table === 'collection' ? (redactDatabaseRecord('block', b, userId) as BlockRecord) : b);
      continue;
    }
    // nested pages restricted from this person (their sharing "unlinked" from this page) stay out
    if (PAGE_TYPES.has(b.type) && versionBlockRole(b, userId, byId) === 'none') continue;
    kept.push(b);
  }
  const keptIds = new Set(kept.map((b) => b.id));
  const out = kept.map((b) => (b.content?.some((id) => byId.has(id) && !keptIds.has(id)) ? { ...b, content: b.content.filter((id) => !byId.has(id) || keptIds.has(id)) } : b));
  const databases: Record<string, DatabaseSnapshot> = {};
  for (const [id, d] of Object.entries((data?.databases ?? {}) as Record<string, DatabaseSnapshot>)) {
    if (!keptIds.has(d.blockId) && d.blockId !== pageId) continue;
    const r = redactDatabase(d, pageId, userId);
    if (r) databases[id] = r;
  }
  return { ...data, blocks: out, ...(data?.databases ? { databases } : {}) };
}

/**
 * Property values a restore writes back to the live row page `live`: the version's values of properties `userId` may
 * edit, today's values of the others (restricted ones they can't edit, or can't even see).
 */
export function restorableProperties(live: BlockRecord, version: Rec | undefined, userId: string): Rec {
  if (live.parent_table !== 'collection') return version ?? {};
  const out: Rec = {};
  const roles = { databaseRole: dbRoleOfRow(live, userId), rowRole: blockRole(live.id, userId) };
  for (const k of new Set([...Object.keys(version ?? {}), ...Object.keys(live.properties ?? {})])) {
    const v = k === 'title' || canEditRowValue(live, k, userId, roles) ? version?.[k] : (live.properties as Rec | undefined)?.[k];
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function dbRoleOfRow(row: BlockRecord, userId: string): Role {
  const col = getRecord<CollectionRecord>('collection', row.parent_id);
  return col ? blockRole(col.parent_id, userId) : 'none';
}

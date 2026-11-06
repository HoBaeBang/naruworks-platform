// What an AI principal (a person using AI, or a Custom Agent's bot) may read from databases — the same rules
// record maps and realtime pushes apply (records.ts RecordMapBuilder → propaccess.ts):
//   - row visibility: a row the principal has no role on (page-level access rules, DB-PERM) doesn't exist for it
//   - property access : values of properties it can't see are removed from rows; "No access"
//     properties disappear from the schema
// Every AI read path (page / row serialization, inline database tables, query_database with its formulas and
// rollups, autofill context, comments on property values, version history, search snippets) goes through these.
import type { QueryContext } from '@nc/shared/database/types.ts';
import { canSeePropertyValues, groupIdsOf, propertyRoleFor, restrictedPropertyIds } from '@nc/shared/database/propertyAccess.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord } from '@nc/shared/records.ts';
import { childrenOf, getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { redactDatabaseRecord } from '../propaccess.ts';

/** A database row as `userId` may read it (null when the row is hidden from them). */
export function visibleRow(row: BlockRecord | undefined, userId: string | null): BlockRecord | null {
  if (!row || row.alive === false) return null;
  if (row.parent_table !== 'collection') return row;
  if (blockRole(row.id, userId) === 'none') return null;
  return redactDatabaseRecord('block', row, userId) as BlockRecord;
}

/** A data source as `userId` may read it ("No access" properties removed) — null when they can't open it. */
export function visibleCollection(col: CollectionRecord | undefined, userId: string | null): CollectionRecord | null {
  if (!col || col.alive === false || !col.parent_id || blockRole(col.parent_id, userId) === 'none') return null;
  return redactDatabaseRecord('collection', col, userId) as CollectionRecord;
}

/** Rows of a data source `userId` may see, redacted (templates and trashed rows excluded). */
export function visibleRows(collectionId: string, userId: string | null): BlockRecord[] {
  const out: BlockRecord[] = [];
  for (const b of childrenOf<BlockRecord>('block', collectionId)) {
    if (b.parent_table !== 'collection' || b.alive === false || b.is_template) continue;
    const r = visibleRow(b, userId);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Query context for AI reads: like queryctx.readableQueryContext, but rows are filtered by row access and redacted
 * before anything is computed from them — formulas and rollups never see values the principal can't.
 */
export function aiQueryContext(userId: string | null): QueryContext & { canRead(blockId: string | undefined): boolean } {
  const memo = new Map<string, BlockRecord[]>();
  const roles = new Map<string, boolean>();
  const canRead = (blockId: string | undefined) => {
    if (!blockId) return false;
    if (!roles.has(blockId)) roles.set(blockId, blockRole(blockId, userId) !== 'none');
    return roles.get(blockId)!;
  };
  return {
    canRead,
    getRecord: (table, id) => {
      const rec = getRecord(table as any, id) as any;
      if (!rec) return undefined;
      if (table === 'block') return canRead(rec.id) ? visibleRow(rec, userId) ?? undefined : undefined;
      if (table === 'collection') return visibleCollection(rec, userId) ?? undefined;
      if (table === 'collection_view') return canRead((rec as CollectionViewRecord).parent_id) ? rec : undefined;
      if (table === 'lit_user') return { id: rec.id, version: rec.version, name: rec.name, given_name: rec.given_name, family_name: rec.family_name, profile_photo: rec.profile_photo };
      return rec;
    },
    rowsOf: (cid) => {
      if (!memo.has(cid)) {
        const col = getRecord<CollectionRecord>('collection', cid);
        memo.set(cid, col && canRead(col.parent_id) ? visibleRows(cid, userId) : []);
      }
      return memo.get(cid)!;
    },
    userId: userId ?? undefined,
    now: Date.now(),
    cache: new Map(),
  };
}

/** Property ids whose values `userId` can't read on this row (empty when the database has no property rules). */
export function hiddenValueProps(row: BlockRecord, userId: string | null): Set<string> {
  const out = new Set<string>();
  if (row.parent_table !== 'collection') return out;
  const col = getRecord<CollectionRecord>('collection', row.parent_id);
  if (!col) return out;
  const restricted = restrictedPropertyIds(col.schema);
  if (!restricted.length) return out;
  const space = getRecord<SpaceRecord>('space', col.space_id ?? row.space_id);
  const ctx = { userId, databaseRole: blockRole(col.parent_id, userId), rowRole: blockRole(row.id, userId), groupIds: groupIdsOf(space, userId), row, schema: col.schema };
  for (const pid of restricted) if (!canSeePropertyValues(propertyRoleFor(col.schema[pid], ctx))) out.add(pid);
  return out;
}

/** A comment thread on a property value (discussion.property_id) the principal can't see the values of is hidden. */
export function discussionVisible(d: { parent_id: string; property_id?: unknown }, userId: string | null): boolean {
  const pid = typeof d.property_id === 'string' ? d.property_id : '';
  if (!pid) return true;
  const row = getRecord<BlockRecord>('block', d.parent_id);
  if (!row || row.parent_table !== 'collection') return true;
  return !hiddenValueProps(row, userId).has(pid);
}

/**
 * A search hit on a database row counts for an AI principal only when the term matches something it may read: the
 * index holds row property text, so a term found only in a property it can't see is no hit (and gives no snippet).
 */
export function hitVisible(hitBlockId: string, term: string, userId: string | null): boolean {
  const b = getRecord<BlockRecord>('block', hitBlockId);
  if (!b || b.parent_table !== 'collection') return true;
  const hidden = hiddenValueProps(b, userId);
  if (!hidden.size) return true;
  const props = (b.properties ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (Array.isArray(v) ? v.map((d) => (Array.isArray(d) ? String(d[0] ?? '') : '')).join('') : '').toLowerCase();
  const t = term.toLowerCase();
  const inVisible = Object.keys(props).some((pid) => !hidden.has(pid) && text(props[pid]).includes(t));
  if (inVisible) return true;
  return ![...hidden].some((pid) => text(props[pid]).includes(t));
}

/** Snippet text of a hit with the values of hidden properties blanked out. */
export function visibleHitText(hitBlockId: string, text: string, userId: string | null): string {
  const b = getRecord<BlockRecord>('block', hitBlockId);
  if (!b || b.parent_table !== 'collection') return text;
  const hidden = hiddenValueProps(b, userId);
  if (!hidden.size) return text;
  let out = text;
  for (const pid of hidden) {
    const v = (b.properties as Record<string, unknown> | undefined)?.[pid];
    const s = Array.isArray(v) ? v.map((d) => (Array.isArray(d) ? String(d[0] ?? '') : '')).join('') : '';
    if (s.trim()) out = out.split(s).join('');
  }
  return out;
}

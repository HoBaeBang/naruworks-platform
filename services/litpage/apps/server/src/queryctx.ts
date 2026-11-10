// Database query context for server-side reads on behalf of a user (queryRows, CSV export, page export).
// Relations, rollups and filters can name any data source id, so every lookup through the context is
// permission-checked like a direct read: records the user cannot see resolve to nothing.
import type { QueryContext } from '@nc/shared/database/types.ts';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { childrenOf, getRecord } from './db.ts';
import { blockRole } from './records.ts';
import { collectionRole, redactDatabaseRecord } from './propaccess.ts';

export function readableRows(collectionId: string): BlockRecord[] {
  return childrenOf<BlockRecord>('block', collectionId).filter((b) => b.parent_table === 'collection' && b.alive && !b.is_template);
}

export function readableQueryContext(userId: string | null): QueryContext & { canRead(blockId: string | undefined): boolean } {
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
      if (table === 'block') return canRead(rec.id) ? rec : undefined;
      if (table === 'collection' || table === 'collection_view') return canRead(rec.parent_id) ? rec : undefined;
      if (table === 'lit_user') return { id: rec.id, version: rec.version, name: rec.name, given_name: rec.given_name, family_name: rec.family_name, profile_photo: rec.profile_photo };
      return rec;
    },
    rowsOf: (cid) => {
      if (!memo.has(cid)) {
        const col = getRecord<CollectionRecord>('collection', cid);
        memo.set(cid, col && canRead(col.parent_id) ? readableRows(cid) : []);
      }
      return memo.get(cid)!;
    },
    userId: userId ?? undefined,
    now: Date.now(),
    cache: new Map(),
  };
}

/**
 * For messages built from a person's view (button / automation steps): their rows and values as viewerQueryContext gives
 * them, with data sources as stored — a step naming a property they can't see then resolves to nothing instead of
 * failing. Data sources never go into a message themselves; webhook bodies list the viewer's (redacted) schema.
 */
export function messageQueryContext(userId: string | null): ReturnType<typeof readableQueryContext> {
  const view = viewerQueryContext(userId);
  return {
    ...view,
    getRecord: (table, id) => (table === 'collection' ? (view.getRecord!(table, id) ? getRecord(table, id) : undefined) : view.getRecord!(table, id)),
  };
}

/**
 * The user's view of databases, like Litpage's record maps (propaccess.ts): rows they can't open (page-level
 * access rules, "Can only create") are left out and values of properties they can't see are removed, so filters, sorts,
 * groups, calculations, relations, rollups and formulas never read them. Use this for anything returned to the user.
 */
export function viewerQueryContext(userId: string | null): ReturnType<typeof readableQueryContext> {
  const base = readableQueryContext(userId);
  const rows = new Map<string, BlockRecord[]>();
  // people who reach some rows of a database only through page-level access rules get its (redacted) data source and
  // those rows, like in record maps (propaccess.ts collectionRole)
  const reach = new Map<string, boolean>();
  const reachable = (c: CollectionRecord | undefined) => {
    if (!c) return false;
    if (!reach.has(c.id)) reach.set(c.id, !base.canRead(c.parent_id) && collectionRole(c, userId) !== 'none');
    return reach.get(c.id)!;
  };
  return {
    ...base,
    getRecord: (table, id) => {
      let rec = base.getRecord!(table, id);
      if (!rec && table === 'collection' && reachable(getRecord<CollectionRecord>('collection', id))) rec = getRecord<CollectionRecord>('collection', id);
      return rec && (table === 'block' || table === 'collection') ? redactDatabaseRecord(table, rec, userId) : rec;
    },
    rowsOf: (cid) => {
      if (!rows.has(cid)) {
        const list = reachable(getRecord<CollectionRecord>('collection', cid)) ? readableRows(cid) : base.rowsOf!(cid);
        rows.set(cid, list.filter((r) => base.canRead(r.id)).map((r) => redactDatabaseRecord('block', r, userId) as BlockRecord));
      }
      return rows.get(cid)!;
    },
  };
}

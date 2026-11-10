// Relation helpers for the advanced database UI (DB-REL-*): rows of a related data source for the relation
// picker ("Link or create a page…") when that data source isn't loaded on the current page.
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { childrenOf, getRecord } from '../../db.ts';
import { RecordMapBuilder } from '../../records.ts';
import { collectionRole } from '../../propaccess.ts';
import { ApiError, type Ctx } from '../handlers.ts';

export const handlers = {
  /** Rows (+ the collection and its host block) of a data source the user can read — also through rows they reach by
   *  page-level access rules only (the redacted schema and those rows). */
  loadCollectionRows(ctx: Ctx, { collectionId, limit }: { collectionId: string; limit?: number }) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const c = getRecord<CollectionRecord>('collection', String(collectionId ?? ''));
    if (!c || c.alive === false || collectionRole(c, ctx.userId) === 'none') throw new ApiError('Not found', 404);
    const rm = new RecordMapBuilder(ctx.userId);
    rm.add('collection', c);
    rm.add('block', getRecord<BlockRecord>('block', c.parent_id));
    const rows = childrenOf<BlockRecord>('block', c.id).filter((b) => b.parent_table === 'collection' && b.alive && !b.is_template);
    rows.sort((a, b) => (a.created_time ?? 0) - (b.created_time ?? 0));
    const page = rows.slice(0, Math.min(Number(limit) || 1000, 5000));
    for (const r of page) rm.add('block', r);
    // rows hidden by page-level access aren't counted either 
    const hidden = page.filter((r) => !rm.has('block', r.id)).length;
    return { recordMap: rm.map, total: rows.length - hidden };
  },
};

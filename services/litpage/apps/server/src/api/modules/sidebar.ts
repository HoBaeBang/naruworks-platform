// Sidebar data: lazy outline children (expand a page row) and pages shared with the current user.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, SpaceViewRecord, UserRootRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

const OUTLINE_TYPES = new Set(['page', 'collection_view_page', 'collection_view']);

/** Target page of a "Link to page" block (type alias): the sidebar lists it under the page holding the link, like a
 *  sub-page (help "create-links-and-backlinks",  / ) — @mentions are not listed. */
function aliasTarget(b: BlockRecord): BlockRecord | undefined {
  if (b.type !== 'alias') return undefined;
  const id = (b.format as { alias_pointer?: { id?: string } } | undefined)?.alias_pointer?.id;
  const t = id ? getRecord<BlockRecord>('block', String(id)) : undefined;
  return t && t.alive && (t.type === 'page' || t.type === 'collection_view_page') ? t : undefined;
}

function addOutlineBlock(b: BlockRecord, rm: RecordMapBuilder) {
  rm.add('block', b);
  if (b.type === 'collection_view_page' || b.type === 'collection_view') {
    const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
    if (col) rm.add('collection', col);
    for (const vid of b.view_ids ?? []) rm.add('collection_view', getRecord<CollectionViewRecord>('collection_view', vid));
  }
}

function spaceViewOf(userId: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', userId);
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (sv?.space_id === spaceId) return sv;
  }
  return undefined;
}

export const handlers: Record<string, Handler> = {
  /** Direct outline children (pages / databases) of the given blocks, two levels deep so toggles know if a child has children. */
  getSidebarChildren(ctx, { blockIds }) {
    const uid = requireUser(ctx);
    const rm = new RecordMapBuilder(uid);
    const ids: string[] = Array.isArray(blockIds) ? blockIds.slice(0, 100).map(String) : [];
    for (const id of ids) {
      const b = getRecord<BlockRecord>('block', id);
      if (!b || blockRole(id, uid) === 'none') continue;
      addOutlineBlock(b, rm);
      for (const cid of b.content ?? []) {
        const c = getRecord<BlockRecord>('block', cid);
        if (!c || !c.alive) continue;
        // a link to a page: the alias block plus the page it shows (when readable — RecordMapBuilder checks)
        const target = aliasTarget(c);
        if (target) {
          rm.add('block', c);
          addOutlineBlock(target, rm);
        }
        if (!target && !OUTLINE_TYPES.has(c.type)) continue;
        const page = target ?? c;
        if (!target) addOutlineBlock(c, rm);
        for (const gid of page.type === 'page' ? page.content ?? [] : []) {
          const g = getRecord<BlockRecord>('block', gid);
          if (!g || !g.alive) continue;
          const gt = aliasTarget(g);
          if (gt) {
            rm.add('block', g);
            addOutlineBlock(gt, rm);
          } else if (OUTLINE_TYPES.has(g.type)) addOutlineBlock(g, rm);
        }
      }
    }
    return { recordMap: rm.map };
  },

  /** Top-level pages other people shared with me (explicit user permission) that aren't in my sidebar lists. */
  getSharedWithMe(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId));
    if (!space) return { pageIds: [], recordMap: {} };
    const sv = spaceViewOf(uid, space.id);
    const mine = new Set([...(sv?.private_pages ?? []), ...(space.pages ?? [])]);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND parent_table IN ('space', 'block')
                             AND data LIKE ? ORDER BY last_edited_time DESC LIMIT 200`).all(space.id, `%"user_id":"${uid}"%`) as { data: string }[];
    const rm = new RecordMapBuilder(uid);
    const pageIds: string[] = [];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      if (b.type !== 'page' && b.type !== 'collection_view_page') continue;
      if (mine.has(b.id) || b.created_by_id === uid) continue;
      if (!b.permissions?.some((p) => p.type === 'user_permission' && p.user_id === uid)) continue;
      // only the top-most shared ancestor appears in the sidebar
      if (b.parent_table === 'block') {
        const parent = getRecord<BlockRecord>('block', b.parent_id);
        if (parent && blockRole(parent.id, uid) !== 'none') continue;
      }
      if (blockRole(b.id, uid) === 'none') continue;
      addOutlineBlock(b, rm);
      pageIds.push(b.id);
    }
    return { pageIds, recordMap: rm.map };
  },
};

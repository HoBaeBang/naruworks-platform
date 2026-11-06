// Trash popover data (sidebar "Library, Trash, more…" › Trash): deleted top-level pages with filters
// Last changed by / In (ancestor page) / Teamspaces, plus the breadcrumb path shown under each row.
import type { BlockRecord, CollectionRecord, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

interface Crumb {
  id: string;
  table: 'block' | 'team';
  title: string;
}

/** Ancestors (outermost first) through blocks, collections (database rows) and teamspaces. */
function ancestry(b: BlockRecord): { crumbs: Crumb[]; teamId: string | null; ids: Set<string> } {
  const crumbs: Crumb[] = [];
  const ids = new Set<string>();
  let teamId: string | null = null;
  let cur: BlockRecord | undefined = b;
  for (let i = 0; i < 40 && cur; i++) {
    if (cur.parent_table === 'block') {
      cur = getRecord<BlockRecord>('block', cur.parent_id);
      if (!cur) break;
      ids.add(cur.id);
      if (cur.type === 'page' || cur.type === 'collection_view_page') crumbs.unshift({ id: cur.id, table: 'block', title: toPlainText(cur.properties?.title) });
      else if (cur.type === 'collection_view') {
        const col = cur.collection_id ? getRecord<CollectionRecord>('collection', cur.collection_id) : undefined;
        crumbs.unshift({ id: cur.id, table: 'block', title: toPlainText(col?.name) });
      }
    } else if (cur.parent_table === 'collection') {
      const col: CollectionRecord | undefined = getRecord<CollectionRecord>('collection', cur.parent_id);
      const dbBlock: BlockRecord | undefined = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
      if (!dbBlock) break;
      ids.add(dbBlock.id);
      crumbs.unshift({ id: dbBlock.id, table: 'block', title: toPlainText(col?.name) || toPlainText(dbBlock.properties?.title) });
      cur = dbBlock;
    } else if (cur.parent_table === 'team') {
      teamId = cur.parent_id;
      const team = getRecord<TeamRecord>('team', cur.parent_id);
      if (team) crumbs.unshift({ id: team.id, table: 'team', title: team.name });
      break;
    } else break;
  }
  return { crumbs, teamId, ids };
}

export const handlers: Record<string, Handler> = {
  /**
   * Deleted pages in a workspace (only the top-most deleted page of a deleted subtree).
   * body: { spaceId, query?, editedBy?: string[], ancestorId?: string, teamIds?: string[], limit? }
   */
  getTrashFiltered(ctx, { spaceId, query, editedBy, ancestorId, teamIds, limit }) {
    const uid = requireUser(ctx);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 0
                             AND json_extract(data, '$.type') IN ('page', 'collection_view_page')
                             ORDER BY last_edited_time DESC LIMIT 1000`).all(String(spaceId ?? '')) as { data: string }[];
    const rm = new RecordMapBuilder(uid);
    const q = String(query ?? '').trim().toLowerCase();
    const editors = Array.isArray(editedBy) ? new Set(editedBy.map(String)) : null;
    const teams = Array.isArray(teamIds) && teamIds.length ? new Set(teamIds.map(String)) : null;
    const pages: { id: string; path: Crumb[]; deletedTime?: number; canDelete: boolean }[] = [];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      const parent = b.parent_table === 'block' ? getRecord<BlockRecord>('block', b.parent_id) : null;
      if (parent && parent.alive === false) continue;
      // only pages the user can still access (having created a page once is not access to it)
      const role = blockRole(b.id, uid);
      if (role === 'none') continue;
      if (q && !toPlainText(b.properties?.title).toLowerCase().includes(q)) continue;
      if (editors && editors.size && !editors.has(b.last_edited_by_id) && !editors.has(String(b.deleted_by_id ?? ''))) continue;
      const anc = ancestry(b);
      if (ancestorId && !anc.ids.has(String(ancestorId))) continue;
      if (teams && (!anc.teamId || !teams.has(anc.teamId))) continue;
      rm.add('block', b, role);
      for (const c of anc.crumbs) {
        if (c.table === 'block') rm.add('block', getRecord<BlockRecord>('block', c.id));
        else rm.add('team', getRecord<TeamRecord>('team', c.id));
      }
      rm.add('lit_user', getRecord('lit_user', b.last_edited_by_id), 'reader');
      pages.push({
        id: b.id,
        path: anc.crumbs,
        deletedTime: b.deleted_time as number | undefined,
        canDelete: role === 'editor' || (role === 'read_and_write' && b.created_by_id === uid),
      });
      if (pages.length >= Math.min(Number(limit) || 200, 1000)) break;
    }
    return { pages, recordMap: rm.map };
  },
};

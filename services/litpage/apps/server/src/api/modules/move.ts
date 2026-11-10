// Move to another workspace: pages can't move between workspaces, so Litpage duplicates them
// ("Page will be duplicated, not moved" → "I understand, duplicate"). The copy keeps content, databases (schema, views,
// rows) and icons/covers; comments, sharing and page history stay behind, links/relations may break.
//   getMoveTargets { spaceId }   destinations in a workspace the user belongs to: Private, joined teamspaces
//   duplicateToSpace { blockIds, spaceId, parent: { kind: 'private' } | { kind: 'team', teamId } | { kind: 'page', pageId } }
// Rules: full access on every source page; a member of the destination workspace who can add pages there; the source
// workspace's "Disable duplicating pages to other workspaces" (policy.ts) applies; 50,000 blocks per hour per user
// ("You have reached the request limit. Try again later.").
import { newId } from '@nc/shared/ids.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, SpaceRecord, SpaceViewRecord, TeamRecord, UserRootRecord } from '@nc/shared/records.ts';
import { getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, TransactionError, applyTransactions, blockRole } from '../../records.ts';
import { assertWorkspacePolicy } from '../../policy.ts';
import { count, hit, RateLimitError } from '../../ratelimit.ts';
import { TreeCopier, assertCopyBudget } from '../../dbcopy.ts';

type Handler = (ctx: Ctx, body: any) => any;

const BLOCKS_PER_HOUR = 50_000;
const MAX_BLOCKS = 20_000;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function spaceViewOf(uid: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', uid);
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (sv && sv.space_id === spaceId && sv.parent_id === uid && sv.alive !== false) return sv;
  }
  return undefined;
}

/** Copies go through dbcopy.ts TreeCopier (like Duplicate): new data sources and re-pointed views, templates, rows
 *  and references between copies — and only what the person can see: rows a page-level rule hides from them and values
 *  of properties they can't see stay behind; comments, sharing, archive and verification state too. */
function copyTree(uid: string, spaceId: string, rows: boolean, src: BlockRecord, parentId: string, parentTable: string, extra: Record<string, unknown> = {}) {
  const copier = new TreeCopier(uid, spaceId, { rows, max: MAX_BLOCKS });
  let id: string;
  try {
    id = copier.block(src, parentId, parentTable, extra);
  } catch (e) {
    if (e instanceof TransactionError) throw new ApiError(e.message, e.status);
    throw e;
  }
  const records = [...copier.finish().values()];
  return { id, count: copier.count, records, ops: records.map((e) => ({ pointer: { table: e.table, id: e.record.id, spaceId }, path: [], command: 'set', args: e.record })) };
}

export const handlers: Record<string, Handler> = {
  /** Database ••• › Duplicate › "Duplicate with content" / "Duplicate without content" : a copy next to the
   *  original in the same place; without content keeps the properties, views and templates but no rows. */
  duplicateDatabase(ctx, { blockId, withContent }) {
    const uid = requireUser(ctx);
    const src = getRecord<BlockRecord>('block', String(blockId ?? ''));
    if (!src || !src.alive || blockRole(src.id, uid) === 'none') throw new ApiError('Not found', 404);
    if (src.type !== 'collection_view_page' && src.type !== 'collection_view') throw new ApiError('Not a database', 400);
    // the same parent must accept a new block from this user
    const parentOk = src.parent_table === 'block' ? roleAtLeast(blockRole(src.parent_id, uid), 'read_and_write')
      : src.parent_table === 'team' ? true : src.parent_table === 'space' ? isSpaceMember(getRecord<SpaceRecord>('space', src.space_id), uid) : false;
    if (!parentOk) throw new ApiError('You can’t add pages here', 403);
    const extra = src.parent_table === 'space' ? { permissions: src.permissions } : {};
    const copy = copyTree(uid, src.space_id, withContent !== false, src, src.parent_id, src.parent_table, extra);
    const nid = copy.id;
    try {
      assertCopyBudget(uid, copy.count); // same hourly budget as Duplicate
    } catch (e) {
      if (e instanceof TransactionError) throw new ApiError(e.message, e.status);
      throw e;
    }
    // "(1)" suffix on the copy's database name, like Duplicate
    const colOp = copy.ops.find((o) => o.pointer.table === 'collection' && o.args?.parent_id === nid);
    if (colOp) colOp.args.name = [[`${(colOp.args.name ?? []).map((d: any[]) => d[0]).join('') || 'Untitled'} (1)`]];
    const ops: any[] = copy.ops;
    if (src.parent_table === 'block') ops.push({ pointer: { table: 'block', id: src.parent_id, spaceId: src.space_id }, path: ['content'], command: 'listAfter', args: { id: nid, after: src.id } });
    else if (src.parent_table === 'team') ops.push({ pointer: { table: 'team', id: src.parent_id, spaceId: src.space_id }, path: ['team_pages'], command: 'listAfter', args: { id: nid, after: src.id } });
    else if (src.parent_table === 'space') {
      const sv = spaceViewOf(uid, src.space_id);
      if (sv?.private_pages?.includes(src.id)) ops.push({ pointer: { table: 'space_view', id: sv.id, spaceId: src.space_id }, path: ['private_pages'], command: 'listAfter', args: { id: nid, after: src.id } });
      else ops.push({ pointer: { table: 'space', id: src.space_id, spaceId: src.space_id }, path: ['pages'], command: 'listAfter', args: { id: nid, after: src.id } });
    }
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: src.space_id, debug: { userAction: 'duplicateDatabase' }, operations: ops } as any], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { blockId: nid, recordMap: rm.map };
  },

  getMoveTargets(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not a member of this workspace', 403);
    const sv = spaceViewOf(uid, space.id);
    const rm = new RecordMapBuilder(uid);
    rm.add('space', space);
    if (sv) rm.add('space_view', sv);
    const teams = (sv?.joined_teams ?? []).map((id) => getRecord<TeamRecord>('team', id)).filter((t): t is TeamRecord => !!t && t.space_id === space.id && t.alive !== false && !t.archived_by);
    for (const t of teams) rm.add('team', t);
    return { spaceId: space.id, teamIds: teams.map((t) => t.id), recordMap: rm.map };
  },

  duplicateToSpace(ctx, { blockIds, spaceId, parent }) {
    const uid = requireUser(ctx);
    const target = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!target || !isSpaceMember(target, uid)) throw new ApiError('You’re not a member of that workspace', 403);
    const ids = [...new Set((Array.isArray(blockIds) ? blockIds : []).map(String))].slice(0, 50);
    if (!ids.length) throw new ApiError('Nothing to duplicate', 400);
    const sources = ids.map((id) => getRecord<BlockRecord>('block', id));
    for (const s of sources) {
      if (!s || !s.alive || blockRole(s.id, uid) === 'none') throw new ApiError('Not found', 404);
      if (s.space_id === target.id) throw new ApiError('Use Move to within the same workspace', 400);
      // "You need full access to this page before moving it."
      if (blockRole(s.id, uid) !== 'editor') throw new ApiError('You need full access to this page before moving it.', 403);
      if (s.type !== 'page' && s.type !== 'collection_view_page') throw new ApiError('Only pages can be duplicated to another workspace', 400);
      // source workspace: Settings › Security › Disable duplicating pages to other workspaces
      try {
        assertWorkspacePolicy(s.space_id, 'duplicate_to_other_workspace', uid, { targetSpaceId: target.id, pageId: s.id });
      } catch {
        throw new ApiError('This workspace does not allow moving pages to another workspace.', 403);
      }
    }
    // destination
    let parentId = target.id;
    let parentTable: 'space' | 'team' | 'block' = 'space';
    const sv = spaceViewOf(uid, target.id);
    if (parent?.kind === 'team') {
      const team = getRecord<TeamRecord>('team', String(parent.teamId ?? ''));
      if (!team || team.space_id !== target.id || team.alive === false || team.archived_by) throw new ApiError('Teamspace not found', 404);
      const member = (team.membership ?? []).some((m) => m.user_id === uid);
      if (!member && (team.settings?.type ?? 'open') !== 'open') throw new ApiError('Join this team first', 403);
      parentId = team.id;
      parentTable = 'team';
    } else if (parent?.kind === 'page') {
      const p = getRecord<BlockRecord>('block', String(parent.pageId ?? ''));
      if (!p || p.space_id !== target.id || !p.alive || !roleAtLeast(blockRole(p.id, uid), 'read_and_write')) throw new ApiError('You can’t add pages there', 403);
      parentId = p.id;
      parentTable = 'block';
    } else if (!sv) throw new ApiError('Workspace view not found', 404);
    // : duplication budget per hour
    const roots: string[] = [];
    const ops: any[] = [];
    let copied = 0;
    for (const s of sources as BlockRecord[]) {
      const extra = parentTable === 'space' ? { permissions: [{ type: 'user_permission', role: 'editor', user_id: uid, added_timestamp: Date.now() }] } : {};
      const copy = copyTree(uid, target.id, true, s, parentId, parentTable, extra);
      roots.push(copy.id);
      ops.push(...copy.ops);
      copied += copy.count;
      if (copied > MAX_BLOCKS) throw new ApiError('This page is too large to duplicate', 413);
    }
    if (count(`dup-space:${uid}`, 3600_000) + copied > BLOCKS_PER_HOUR) throw new RateLimitError('You have reached the request limit. Try again later.');
    for (let i = 0; i < copied; i++) hit(`dup-space:${uid}`, BLOCKS_PER_HOUR, 3600_000);
    for (const id of roots) {
      if (parentTable === 'team') ops.push({ pointer: { table: 'team', id: parentId, spaceId: target.id }, path: ['team_pages'], command: 'listAfter', args: { id } });
      else if (parentTable === 'block') ops.push({ pointer: { table: 'block', id: parentId, spaceId: target.id }, path: ['content'], command: 'listAfter', args: { id } });
      else ops.push({ pointer: { table: 'space_view', id: sv!.id, spaceId: target.id }, path: ['private_pages'], command: 'listBefore', args: { id } });
    }
    const changes = applyTransactions(uid, [{ id: newId(), spaceId: target.id, debug: { userAction: 'duplicateToSpace' }, operations: ops } as any], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { blockIds: roots, spaceId: target.id, domain: target.domain, recordMap: rm.map };
  },
};

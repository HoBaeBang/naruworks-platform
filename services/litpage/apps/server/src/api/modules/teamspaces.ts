// Teamspace actions that span several people's records :
//  - createTeamFromPage ("Turn into teamspace"): a page in a teamspace becomes a new teamspace's first
//    page; everyone who already had access to it becomes a member .
//    Requires full access to the page and teamspace owner (or workspace owner/admin) rights on its teamspace.
// Members' sidebars (space_view.joined_teams) are updated server-side, like default teamspaces.
import { newId } from '@nc/shared/ids.ts';
import { isSpaceAdmin, isSpaceMember, teamAccessType, teamMembership } from '@nc/shared/permissions.ts';
import type { BaseRecord, BlockRecord, SpaceRecord, SpaceViewRecord, Table, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { applyTransactions, blockRole } from '../../records.ts';
import { saveRecord } from '../../seed.ts';
import { realtime } from '../../realtime.ts';
import { policyProblem } from '../../policy.ts';
import { spaceViewOf } from '../../notify.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

/** The teamspace a page lives in through page parents only (null for private pages and database rows). */
export function teamOfPage(page: BlockRecord): TeamRecord | null {
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 200 && cur; i++) {
    if (cur.parent_table === 'team') return getRecord<TeamRecord>('team', cur.parent_id) ?? null;
    if (cur.parent_table !== 'block') return null;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  return null;
}

export const handlers: Record<string, Handler> = {
  createTeamFromPage(ctx, { pageId }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || page.alive === false) throw new ApiError('Not found', 404);
    if (page.type !== 'page') throw new ApiError('Only pages can become teams.');
    if (blockRole(page.id, uid) !== 'editor') throw new ApiError('You need full access to this page.', 403);
    const team = teamOfPage(page);
    if (!team) throw new ApiError('Only pages in a team can become teams.');
    const space = getRecord<SpaceRecord>('space', page.space_id);
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    if (teamMembership(team, uid)?.role !== 'owner' && !isSpaceAdmin(space, uid)) throw new ApiError('Only team owners can turn pages into teams.', 403);
    const problem = policyProblem(space, 'create_teamspace', uid);
    if (problem) throw new ApiError(problem, 403);

    // members: workspace members who can open the page today
    const now = Date.now();
    const memberIds = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
    const membership: TeamRecord['membership'] = [{ user_id: uid, role: 'owner', added_time: now }];
    for (const m of memberIds.slice(0, 2000)) if (m !== uid && blockRole(page.id, m) !== 'none') membership.push({ user_id: m, role: 'member', added_time: now });

    const teamId = newId();
    const title = toPlainText(page.properties?.title).replace(/[‣⁍]/g, '').trim() || 'Untitled';
    const ops: any[] = [{
      pointer: { table: 'team', id: teamId, spaceId: space.id }, path: [], command: 'set',
      args: {
        id: teamId, space_id: space.id, name: title.slice(0, 100), description: '', icon: (page.format?.page_icon as string) ?? '', team_pages: [page.id],
        parent_id: space.id, parent_table: 'space', alive: true, membership, created_time: now, created_by_id: uid,
        settings: { type: teamAccessType(team) === 'private' ? 'private' : teamAccessType(team), default_page_role: (team.settings?.default_page_role as string) ?? 'editor' },
      },
    }];
    if (page.parent_table === 'team') ops.push({ pointer: { table: 'team', id: page.parent_id, spaceId: space.id }, path: ['team_pages'], command: 'listRemove', args: { id: page.id } });
    else ops.push({ pointer: { table: 'block', id: page.parent_id, spaceId: space.id }, path: ['content'], command: 'listRemove', args: { id: page.id } });
    ops.push({ pointer: { table: 'block', id: page.id, spaceId: space.id }, path: [], command: 'update', args: { parent_id: teamId, parent_table: 'team', last_edited_time: now, last_edited_by_id: uid } });
    const mine = spaceViewOf(uid, space.id);
    if (mine) ops.push({ pointer: { table: 'space_view', id: mine.id, spaceId: space.id }, path: ['joined_teams'], command: 'listAfter', args: { id: teamId } });
    applyTransactions(uid, [{ id: newId(), spaceId: space.id, debug: { userAction: 'createTeamFromPage' }, operations: ops }], ctx.clientId);

    // everyone else's sidebar gets the new teamspace
    const items: { table: Table; record: BaseRecord }[] = [];
    for (const m of membership) {
      if (m.user_id === uid) continue;
      const sv = spaceViewOf(m.user_id, space.id);
      if (sv && !(sv.joined_teams ?? []).includes(teamId)) items.push({ table: 'space_view', record: { ...sv, joined_teams: [...(sv.joined_teams ?? []), teamId] } as SpaceViewRecord });
    }
    const changes = items.map((it) => ({ table: it.table, record: saveRecord(it.table, it.record), spaceId: space.id }));
    if (changes.length) realtime.broadcastChanges(changes as any);
    return { teamId, members: membership.length };
  },
};

// Workspace membership requests from people who aren't members yet, and teamspace invite links :
//   -  "Allow guests to request to be a member" (space.settings.allow_guest_member_requests, default on): a
//     page guest asks from the guest banner ("Request membership to {workspace}" + reason) → requestWorkspaceMembership.
//   -  "Allow any user to request to be a workspace member" (allow_external_member_requests, default off):
//     people outside the workspace who open a teamspace invite link ask to join → requestMembershipByTeamInvite.
//   -  teamspace "Invite Link" (team.settings.invite_link_enabled, default on): the secret code lives on the
//     server (team_invite_links) and is only handed to people who can invite teamspace members (getTeamInviteLink /
//     resetTeamInviteLink); /team-invite/<code> shows the join page (getTeamInvite) → joinTeamByInviteLink.
// A request is a workspace member request (space.settings.member_requests, the list Settings › Requests shows)
// with requested_by = the person, self: true, via 'guest' | 'team_invite_link' (+ team_id). Workspace owners and
// membership admins get an Inbox item with Approve / Deny (rows.tsx) or approve in Settings › Requests; both go through
// resolveMemberRequest (workspace.ts), which calls memberRequestResolved below.
import { randomBytes } from 'node:crypto';
import { newId } from '@nc/shared/ids.ts';
import { isRestrictedMember, isSpaceAdmin, isSpaceMember, teamMembership } from '@nc/shared/permissions.ts';
import type { BaseRecord, NotificationRecord, SpaceRecord, SpaceViewRecord, Table, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../../db.ts';
import { saveRecord } from '../../seed.ts';
import { realtime } from '../../realtime.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';
import { policyProblem } from '../../policy.ts';
import { audit } from '../../audit.ts';
import { pushNotification, spaceViewOf, updateNotification } from '../../notify.ts';
import { RecordMapBuilder } from '../../records.ts';
import { ApiError, type Ctx } from '../handlers.ts';

type Handler = (ctx: Ctx, body: any) => any;

db.exec(`
CREATE TABLE IF NOT EXISTS team_invite_links (
  team_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_by TEXT,
  created_time INTEGER NOT NULL
);
`);

const MAX_MESSAGE = 500;
const MAX_APPROVERS = 20;

export interface MemberRequest {
  id: string;
  emails: string[];
  requested_by: string;
  created_time: number;
  via?: string;
  /** the person asked to be added themselves (guest banner, teamspace invite link) */
  self?: boolean;
  message?: string;
  /** teamspace invite link: join this teamspace once approved */
  team_id?: string;
}

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function emailOf(userId: string): string {
  return String(getRecord<UserRecord>('lit_user', userId)?.email ?? '').trim().toLowerCase();
}

/** Persist server-side record changes and broadcast them. */
function commit(items: { table: Table; record: BaseRecord }[]) {
  const changes = items.map((it) => {
    const saved = saveRecord(it.table, it.record);
    return { table: it.table, record: saved, spaceId: (saved as { space_id?: string }).space_id ?? (it.table === 'space' ? saved.id : null) };
  });
  realtime.broadcastChanges(changes as never);
  return changes;
}

/** A page guest: someone with access to a page of the workspace who isn't a member of it. */
export function isGuestOf(space: SpaceRecord, userId: string): boolean {
  if (isSpaceMember(space, userId)) return false;
  const id = userId.replace(/[^\w-]/g, '');
  return !!db.prepare(`SELECT 1 FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND data LIKE ? LIMIT 1`).get(space.id, `%"user_id":"${id}"%`);
}

function memberRequests(space: SpaceRecord): MemberRequest[] {
  return (((space.settings as { member_requests?: MemberRequest[] } | undefined)?.member_requests) ?? []).filter((r) => r && r.id);
}

function pendingSelfRequest(space: SpaceRecord, userId: string): MemberRequest | undefined {
  return memberRequests(space).find((r) => r.requested_by === userId && r.self);
}

function spaceAdmins(space: SpaceRecord): string[] {
  return (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && ((p.role as string) === 'owner' || (p.role as string) === 'membership_admin')).map((p) => p.user_id!);
}

/** File a self request ("requested to be added as a workspace member") and tell the workspace's admins. */
function fileSelfRequest(space: SpaceRecord, userId: string, opts: { via: 'guest' | 'team_invite_link'; message?: string; teamId?: string }): MemberRequest {
  const existing = pendingSelfRequest(space, userId);
  if (existing) return existing;
  const email = emailOf(userId);
  if (!email) throw new ApiError('Add an email address to your account first.');
  const req: MemberRequest = {
    id: newId(), emails: [email], requested_by: userId, created_time: Date.now(), via: opts.via, self: true,
    ...(opts.message ? { message: opts.message } : {}), ...(opts.teamId ? { team_id: opts.teamId } : {}),
  };
  const fresh = getRecord<SpaceRecord>('space', space.id) ?? space;
  commit([{ table: 'space', record: { ...fresh, settings: { ...(fresh.settings ?? {}), member_requests: [...memberRequests(fresh), req] } } as BaseRecord }]);
  for (const a of spaceAdmins(space).filter((x) => x !== userId).slice(0, MAX_APPROVERS)) {
    pushNotification({
      user_id: a, space_id: space.id, type: 'space_member_requested', actor_id: userId,
      activity: { kind: 'member', self: true, emails: req.emails, message: opts.message || undefined, request_id_ws: req.id, team_id: opts.teamId, status: 'pending' },
    });
  }
  return req;
}

function addToTeam(team: TeamRecord, userId: string) {
  const items: { table: Table; record: BaseRecord }[] = [];
  const fresh = getRecord<TeamRecord>('team', team.id) ?? team;
  if (!teamMembership(fresh, userId)) items.push({ table: 'team', record: { ...fresh, membership: [...(fresh.membership ?? []), { user_id: userId, role: 'member', added_time: Date.now() }] } });
  const sv = spaceViewOf(userId, team.space_id);
  if (sv && !(sv.joined_teams ?? []).includes(team.id)) items.push({ table: 'space_view', record: { ...sv, joined_teams: [...(sv.joined_teams ?? []), team.id] } as SpaceViewRecord });
  if (items.length) commit(items);
}

/**
 * Called by resolveMemberRequest (workspace.ts) after an admin approved or declined a member request: the admins'
 * Inbox items show "Approved by … on …", and an approved teamspace-invite request also joins that teamspace.
 */
export function memberRequestResolved(space: SpaceRecord, req: MemberRequest, approve: boolean, actorId: string, userIds: string[]) {
  const now = Date.now();
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.activity.request_id_ws') = ?`).all(req.id) as { data: string }[];
  for (const r of rows) {
    const n = JSON.parse(r.data) as NotificationRecord;
    updateNotification(n.id, { activity: { status: approve ? 'approved' : 'denied', resolved_by_id: actorId, resolved_time: now } });
  }
  if (!approve || !req.team_id) return;
  const team = getRecord<TeamRecord>('team', req.team_id);
  if (!team || team.alive === false || team.space_id !== space.id) return;
  for (const id of userIds) addToTeam(team, id);
}

// ---------------------------------------------------------------- teamspace invite links
function inviteCodeOf(teamId: string, create: string | null): string | null {
  const row = db.prepare('SELECT code FROM team_invite_links WHERE team_id = ?').get(teamId) as { code: string } | undefined;
  if (row || !create) return row?.code ?? null;
  const code = randomBytes(18).toString('base64url');
  db.prepare('INSERT INTO team_invite_links (team_id, code, created_by, created_time) VALUES (?, ?, ?, ?)').run(teamId, code, create, Date.now());
  return code;
}

function teamOfCode(code: unknown): TeamRecord | undefined {
  const c = String(code ?? '');
  if (!/^[\w-]{10,64}$/.test(c)) return undefined;
  const row = db.prepare('SELECT team_id FROM team_invite_links WHERE code = ?').get(c) as { team_id: string } | undefined;
  return row ? getRecord<TeamRecord>('team', row.team_id) : undefined;
}

/** "Only users who can invite members can see the invite link" (Teamspace settings › Security › Invite Link). */
export function canInviteToTeam(team: TeamRecord, space: SpaceRecord | undefined, userId: string): boolean {
  if (!space || !isSpaceMember(space, userId) || isRestrictedMember(space, userId)) return false;
  if (isSpaceAdmin(space, userId)) return true;
  const m = teamMembership(team, userId);
  if (!m) return false;
  if (m.role === 'owner') return true;
  const open = (team.settings?.type ?? 'open') === 'open';
  return open || (team.settings as Record<string, unknown> | undefined)?.invite_access !== 'owners';
}

const linkEnabled = (team: TeamRecord) => (team.settings as Record<string, unknown> | undefined)?.invite_link_enabled !== false;

type InviteState = 'invalid' | 'disabled' | 'member' | 'join' | 'request' | 'no_access';

function inviteState(team: TeamRecord | undefined, userId: string): { state: InviteState; space?: SpaceRecord; requested?: boolean } {
  if (!team || team.alive === false || team.archived_by) return { state: 'invalid' };
  const space = getRecord<SpaceRecord>('space', team.space_id);
  if (!space || (space as { deleted_time?: number }).deleted_time) return { state: 'invalid' };
  if (!linkEnabled(team)) return { state: 'disabled', space };
  if (teamMembership(team, userId)) return { state: 'member', space };
  if (isSpaceMember(space, userId)) {
    // restricted members only join teamspaces someone allowed to add them puts them in (Settings › Security)
    return { state: isRestrictedMember(space, userId) ? 'no_access' : 'join', space };
  }
  const action = isGuestOf(space, userId) ? 'guest_member_request' : 'external_member_request';
  if (policyProblem(space, action, userId)) return { state: 'no_access', space };
  return { state: 'request', space, requested: !!pendingSelfRequest(space, userId) };
}

export const handlers: Record<string, Handler> = {
  /** Guest banner state for a workspace: am I a guest there, may I ask to become a member, did I already ask? */
  getMembershipRequestState(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isGuestOf(space, uid)) return { guest: false };
    return {
      guest: true, workspaceName: space.name ?? '', workspaceIcon: space.icon ?? '',
      canRequest: !policyProblem(space, 'guest_member_request', uid),
      requested: !!pendingSelfRequest(space, uid),
    };
  },

  /** : a page guest asks the workspace's admins to be added as a member. */
  requestWorkspaceMembership(ctx, { spaceId, message }) {
    const uid = requireUser(ctx);
    if (!hit(`member-request:user:${uid}`, 10, 3600_000)) throw new RateLimitError();
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space) throw new ApiError('Not found', 404);
    if (isSpaceMember(space, uid)) return { requested: false, member: true };
    if (!isGuestOf(space, uid)) throw new ApiError('Not found', 404);
    const problem = policyProblem(space, 'guest_member_request', uid);
    if (problem) throw new ApiError(problem, 403);
    const req = fileSelfRequest(space, uid, { via: 'guest', message: String(message ?? '').trim().slice(0, MAX_MESSAGE) });
    return { requested: true, requestId: req.id };
  },

  /** Members › Copy invite link: the teamspace's invite link (created on first use) for people who can invite. */
  getTeamInviteLink(ctx, { teamId }) {
    const uid = requireUser(ctx);
    const team = getRecord<TeamRecord>('team', String(teamId ?? ''));
    const space = team ? getRecord<SpaceRecord>('space', team.space_id) : undefined;
    if (!team || team.alive === false || !space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    if (!canInviteToTeam(team, space, uid)) throw new ApiError('Only people who can invite members can see the invite link.', 403);
    if (!linkEnabled(team)) return { enabled: false, code: null, path: null };
    const code = inviteCodeOf(team.id, uid)!;
    return { enabled: true, code, path: `/team-invite/${code}` };
  },

  /** Generate a new invite link; the old one stops working (teamspace owners and workspace admins). */
  resetTeamInviteLink(ctx, { teamId }) {
    const uid = requireUser(ctx);
    const team = getRecord<TeamRecord>('team', String(teamId ?? ''));
    const space = team ? getRecord<SpaceRecord>('space', team.space_id) : undefined;
    if (!team || !space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
  if (teamMembership(team, uid)?.role !== 'owner' && !isSpaceAdmin(space, uid)) throw new ApiError('Only team owners can reset the invite link.', 403);
    db.prepare('DELETE FROM team_invite_links WHERE team_id = ?').run(team.id);
    const code = inviteCodeOf(team.id, uid)!;
    audit('invite_link_reset', { spaceId: space.id, actorId: uid, targetId: team.id, data: { teamId: team.id } });
    return { enabled: linkEnabled(team), code, path: `/team-invite/${code}` };
  },

  /** /team-invite/<code>: what the person opening the link sees (join, request membership, or why not). */
  getTeamInvite(ctx, { code }) {
    const uid = requireUser(ctx);
    if (!hit(`team-invite:user:${uid}`, 120, 3600_000)) throw new RateLimitError();
    const team = teamOfCode(code);
    const { state, space, requested } = inviteState(team, uid);
    if (state === 'invalid' || state === 'disabled' || !team || !space) return { state };
    const memberCount = (team.membership ?? []).length;
    return {
      state, requested: !!requested,
      team: { id: team.id, name: team.name ?? '', icon: team.icon ?? '', type: team.settings?.type ?? 'open', memberCount },
      space: { id: space.id, name: space.name ?? '', icon: space.icon ?? '', domain: space.domain },
    };
  },

  /** "Join teamspace" from an invite link (workspace members). */
  joinTeamByInviteLink(ctx, { code }) {
    const uid = requireUser(ctx);
    const team = teamOfCode(code);
    const { state, space } = inviteState(team, uid);
    if (!team || !space || state === 'invalid') throw new ApiError('That invite link is invalid. Ask a workspace admin for a new one.', 404);
    if (state === 'disabled') throw new ApiError('That invite link is disabled. Ask an administrator to invite you directly.', 403);
  if (state !== 'join' && state !== 'member') throw new ApiError('You cannot join this team with this link.', 403);
    if (state === 'join') {
      addToTeam(team, uid);
      audit('member_joined_team', { spaceId: space.id, actorId: uid, targetId: uid, teamId: team.id, data: { teamName: team.name ?? '', teamRole: 'member', via: 'team_invite_link' } });
    }
    const rm = new RecordMapBuilder(uid);
    rm.add('team', getRecord<TeamRecord>('team', team.id));
    const sv = spaceViewOf(uid, space.id);
    if (sv) rm.add('space_view', sv, 'editor');
    return { teamId: team.id, spaceId: space.id, domain: space.domain, recordMap: rm.map };
  },

  /** : someone outside the workspace (or a guest) with a teamspace invite link asks to become a member. */
  requestMembershipByTeamInvite(ctx, { code, message }) {
    const uid = requireUser(ctx);
    if (!hit(`member-request:user:${uid}`, 10, 3600_000)) throw new RateLimitError();
    const team = teamOfCode(code);
    const { state, space } = inviteState(team, uid);
    if (!team || !space || state === 'invalid') throw new ApiError('That invite link is invalid. Ask a workspace admin for a new one.', 404);
    if (state === 'disabled') throw new ApiError('That invite link is disabled. Ask an administrator to invite you directly.', 403);
    if (state === 'member' || state === 'join') return { requested: false, member: true };
    if (state !== 'request') throw new ApiError('Workspace owners have turned off membership requests.', 403);
    const req = fileSelfRequest(space, uid, { via: 'team_invite_link', teamId: team.id, message: String(message ?? '').trim().slice(0, MAX_MESSAGE) });
    return { requested: true, requestId: req.id };
  },
};

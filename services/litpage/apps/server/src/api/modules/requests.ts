// Access requests :  "Request access" from the no-access screen,  "Request edit access" for
// people who can only view/comment,  non-member requests (Settings › Security › "Allow non-members to
// request page access", space.settings.allow_access_requests),  approve/deny in the Inbox, and 
// "Request" to join a closed teamspace (teamspace owners approve).
//
// A request is a row in `access_requests`; approvers get an Inbox item (`access_requested` / `team_join_requested`)
// whose activity carries the request id and status. Resolving updates every approver's item ("Approved by … on …")
// and notifies the requester (`access_granted` / `team_join_approved`). Page access is granted as an explicit
// user permission on the page through applyTransactions as the approver, so the usual sharing rules (full access,
// workspace guest policy) apply to approvals too.
import { newId } from '@nc/shared/ids.ts';
import { isRestrictedMember, isSpaceAdmin, isSpaceMember, roleAtLeast, teamJoinMode, teamMembership } from '@nc/shared/permissions.ts';
import type { BaseRecord, BlockRecord, NotificationRecord, Permission, Role, SpaceRecord, SpaceViewRecord, Table, TeamRecord } from '@nc/shared/records.ts';
import { db, findUserIdByEmail, getRecord } from '../../db.ts';
import { createUser, saveRecord } from '../../seed.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { realtime } from '../../realtime.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';
import { policyProblem, restrictedPageAddProblem } from '../../policy.ts';
import { pushNotification, spaceViewOf, updateNotification } from '../../notify.ts';
import { blockAncestors } from './sharing.ts';

type Handler = (ctx: Ctx, body: any) => any;

db.exec(`
CREATE TABLE IF NOT EXISTS access_requests (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  target_id TEXT NOT NULL,
  space_id TEXT,
  requester_id TEXT NOT NULL,
  message TEXT,
  role TEXT,
  status TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  resolved_by TEXT,
  resolved_time INTEGER
);
CREATE INDEX IF NOT EXISTS idx_access_requests_target ON access_requests(target_id, status);
CREATE INDEX IF NOT EXISTS idx_access_requests_requester ON access_requests(requester_id, kind, target_id);
`);
// v2: extra request data (guest invite emails)
if (!(db.prepare('PRAGMA table_info(access_requests)').all() as { name: string }[]).some((c) => c.name === 'data')) {
  db.exec('ALTER TABLE access_requests ADD COLUMN data TEXT');
}

export type RequestKind = 'page_access' | 'page_edit' | 'team_join' | 'guest_invite';
export type RequestStatus = 'pending' | 'approved' | 'denied';

export interface AccessRequest {
  id: string;
  kind: RequestKind;
  targetId: string;
  spaceId: string | null;
  requesterId: string;
  message: string;
  role: string | null;
  status: RequestStatus;
  createdTime: number;
  resolvedBy: string | null;
  resolvedTime: number | null;
  data?: { emails?: string[]; restricted?: boolean } | null;
}

const PAGE_ROLES = new Set(['editor', 'read_and_write', 'comment_only', 'reader']);
const MAX_MESSAGE = 1000;
const MAX_APPROVERS = 20;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function rowToRequest(r: any): AccessRequest {
  return {
    id: r.id, kind: r.kind, targetId: r.target_id, spaceId: r.space_id, requesterId: r.requester_id, message: r.message ?? '', role: r.role,
    status: r.status, createdTime: r.created_time, resolvedBy: r.resolved_by, resolvedTime: r.resolved_time,
    data: r.data ? (JSON.parse(r.data) as AccessRequest['data']) : null,
  };
}

export function getRequest(id: string): AccessRequest | null {
  const r = db.prepare('SELECT * FROM access_requests WHERE id = ?').get(String(id ?? ''));
  return r ? rowToRequest(r) : null;
}

export function pendingRequest(kind: RequestKind, targetId: string, requesterId: string): AccessRequest | null {
  const r = db.prepare("SELECT * FROM access_requests WHERE kind = ? AND target_id = ? AND requester_id = ? AND status = 'pending' ORDER BY created_time DESC LIMIT 1")
    .get(kind, targetId, requesterId);
  return r ? rowToRequest(r) : null;
}

function createRequest(r: Omit<AccessRequest, 'id' | 'status' | 'createdTime' | 'resolvedBy' | 'resolvedTime'>): AccessRequest {
  const req: AccessRequest = { ...r, id: newId(), status: 'pending', createdTime: Date.now(), resolvedBy: null, resolvedTime: null };
  db.prepare('INSERT INTO access_requests (id, kind, target_id, space_id, requester_id, message, role, status, created_time, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.id, req.kind, req.targetId, req.spaceId, req.requesterId, req.message, req.role, req.status, req.createdTime, req.data ? JSON.stringify(req.data) : null);
  return req;
}

function setStatus(id: string, status: RequestStatus, by: string, role: string | null) {
  db.prepare('UPDATE access_requests SET status = ?, resolved_by = ?, resolved_time = ?, role = COALESCE(?, role) WHERE id = ?').run(status, by, Date.now(), role, id);
}

/** Inbox items that carry this request (one per approver). */
function requestNotifications(requestId: string): NotificationRecord[] {
  return (db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.activity.request_id') = ?`).all(requestId) as { data: string }[])
    .map((r) => JSON.parse(r.data) as NotificationRecord);
}

function markResolved(req: AccessRequest, status: RequestStatus, by: string, role: string | null) {
  const now = Date.now();
  for (const n of requestNotifications(req.id)) {
    updateNotification(n.id, { activity: { status, resolved_by_id: by, resolved_time: now, granted_role: role } });
  }
}

/** Persist server-side record changes and broadcast them (memberships the requester can't write themselves). */
function commit(items: { table: Table; record: BaseRecord }[]) {
  const changes = items.map((it) => {
    const saved = saveRecord(it.table, it.record);
    return { table: it.table, record: saved, spaceId: (saved as any).space_id ?? (it.table === 'space' ? saved.id : null) };
  });
  realtime.broadcastChanges(changes as any);
  return changes;
}

// ---------------------------------------------------------------- pages
/** People who can approve page access: explicit full-access holders on the page or its ancestors, teamspace owners,
 *  the page creator (when they still have full access), else workspace owners with full access. */
export function pageApprovers(page: BlockRecord, requesterId: string): string[] {
  const out = new Set<string>();
  const chain = [page, ...blockAncestors(page)];
  for (const b of chain) for (const p of b.permissions ?? []) if (p.type === 'user_permission' && p.user_id && p.role === 'editor') out.add(p.user_id);
  const root = chain[chain.length - 1];
  if (root?.parent_table === 'team') {
    for (const m of getRecord<TeamRecord>('team', root.parent_id)?.membership ?? []) if (m.role === 'owner') out.add(m.user_id);
  }
  if (page.created_by_id) out.add(page.created_by_id);
  const ok = (u: string) => u !== requesterId && !!getRecord('lit_user', u) && blockRole(page.id, u) === 'editor';
  let list = [...out].filter(ok);
  if (!list.length) {
    const space = getRecord<SpaceRecord>('space', page.space_id);
    list = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && ((p.role as string) === 'owner' || (p.role as string) === 'membership_admin')).map((p) => p.user_id!).filter(ok);
  }
  return list.slice(0, MAX_APPROVERS);
}

function pageTitleOf(b: BlockRecord): string {
  const t = b.properties?.title;
  return Array.isArray(t) ? t.map((d) => (typeof d?.[0] === 'string' ? d[0] : '')).join('').replace(/[‣⁍]/g, '') : '';
}

/** What the current user can do about a page they opened (no-access screen, read-only banner, Share menu). */
function pageAccessState(uid: string | null, pageId: string) {
  const page = getRecord<BlockRecord>('block', pageId);
  if (!page) return { state: 'missing' as const };
  const role = blockRole(page.id, uid);
  const space = getRecord<SpaceRecord>('space', page.space_id);
  const member = !!uid && isSpaceMember(space, uid);
  if (role !== 'none') {
    const canAskEdit = !!uid && page.alive !== false && (role === 'reader' || role === 'comment_only' || role === ('content_only_editor' as Role));
    return {
      state: 'ok' as const, role, inTrash: page.alive === false,
      canRequestEdit: canAskEdit && pageApprovers(page, uid!).length > 0,
      editRequested: !!uid && !!pendingRequest('page_edit', page.id, uid),
    };
  }
  const allowed = member || !policyProblem(space, 'access_request', uid);
  return {
    state: 'no_access' as const,
    inTrash: page.alive === false,
    loggedIn: !!uid,
    isMember: member,
    // the workspace name only for its members (others learn nothing about where the page lives)
    workspaceName: member ? space?.name ?? null : null,
    canRequest: !!uid && page.alive !== false && allowed && pageApprovers(page, uid!).length > 0,
    requestsDisabled: !!uid && !allowed,
    requested: !!uid && !!pendingRequest('page_access', page.id, uid),
  };
}

function resolvePage(req: AccessRequest, uid: string, approve: boolean, roleIn: unknown, ctx: Ctx) {
  const page = getRecord<BlockRecord>('block', req.targetId);
  if (!page) throw new ApiError('Not found', 404);
  if (blockRole(page.id, uid) !== 'editor') throw new ApiError('Only people with full access can respond to this request.', 403);
  if (!approve) {
    setStatus(req.id, 'denied', uid, null);
    markResolved(req, 'denied', uid, null);
    return { status: 'denied' as const, role: null };
  }
  const fallback: Role = req.kind === 'page_edit' ? 'read_and_write' : 'reader';
  const role = (PAGE_ROLES.has(String(roleIn)) ? roleIn : fallback) as Role;
  const current = blockRole(page.id, req.requesterId);
  if (current !== role) {
    const perms: Permission[] = (page.permissions ?? []).filter((p) => !(p.type === 'user_permission' && p.user_id === req.requesterId));
    perms.push({ type: 'user_permission', role, user_id: req.requesterId, added_timestamp: Date.now() });
    // as the approver: full access + the workspace's guest policy are checked like any Share-menu change
    applyTransactions(uid, [{
      id: newId(), spaceId: page.space_id, debug: { userAction: 'approveAccessRequest' },
      operations: [{ pointer: { table: 'block', id: page.id, spaceId: page.space_id }, path: ['permissions'], command: 'set', args: perms }],
    }], ctx.clientId);
  }
  setStatus(req.id, 'approved', uid, role);
  markResolved(req, 'approved', uid, role);
  pushNotification({
    user_id: req.requesterId, space_id: page.space_id, type: 'access_granted', navigable_block_id: page.id, actor_id: uid,
    activity: { page_id: page.id, role, kind: req.kind, request_id_resolved: req.id },
  });
  return { status: 'approved' as const, role };
}

// ---------------------------------------------------------------- teamspaces
function teamOwners(team: TeamRecord): string[] {
  const owners = (team.membership ?? []).filter((m) => m.role === 'owner').map((m) => m.user_id);
  if (owners.length) return owners;
  const space = getRecord<SpaceRecord>('space', team.space_id);
  return (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && ((p.role as string) === 'owner' || (p.role as string) === 'membership_admin')).map((p) => p.user_id!);
}

function canManageTeam(team: TeamRecord, uid: string): boolean {
  const space = getRecord<SpaceRecord>('space', team.space_id);
  return teamMembership(team, uid)?.role === 'owner' || isSpaceAdmin(space, uid);
}

function resolveTeam(req: AccessRequest, uid: string, approve: boolean) {
  const team = getRecord<TeamRecord>('team', req.targetId);
  if (!team || team.alive === false) throw new ApiError('Teamspace not found', 404);
  if (!canManageTeam(team, uid)) throw new ApiError('Only team owners can respond to this request.', 403);
  if (!approve) {
    setStatus(req.id, 'denied', uid, null);
    markResolved(req, 'denied', uid, null);
    return { status: 'denied' as const };
  }
  const space = getRecord<SpaceRecord>('space', team.space_id);
  if (!isSpaceMember(space, req.requesterId)) throw new ApiError('This person is no longer a member of the workspace.');
  const items: { table: Table; record: BaseRecord }[] = [];
  if (!teamMembership(team, req.requesterId)) {
    items.push({ table: 'team', record: { ...team, membership: [...(team.membership ?? []), { user_id: req.requesterId, role: 'member', added_time: Date.now() }] } });
  }
  const sv = spaceViewOf(req.requesterId, team.space_id);
  if (sv && !(sv.joined_teams ?? []).includes(team.id)) items.push({ table: 'space_view', record: { ...sv, joined_teams: [...(sv.joined_teams ?? []), team.id] } as SpaceViewRecord });
  if (items.length) commit(items);
  setStatus(req.id, 'approved', uid, 'member');
  markResolved(req, 'approved', uid, 'member');
  pushNotification({
    user_id: req.requesterId, space_id: team.space_id, type: 'team_join_approved', actor_id: uid,
    activity: { team_id: team.id, kind: 'team_join', request_id_resolved: req.id },
  });
  return { status: 'approved' as const };
}

// ---------------------------------------------------------------- guest invite requests 
function spaceAdmins(space: SpaceRecord): string[] {
  return (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && ((p.role as string) === 'owner' || (p.role as string) === 'membership_admin')).map((p) => p.user_id!);
}

function resolveGuestInvite(req: AccessRequest, uid: string, approve: boolean, roleIn: unknown) {
  const page = getRecord<BlockRecord>('block', req.targetId);
  const space = page ? getRecord<SpaceRecord>('space', page.space_id) : undefined;
  if (!page || !space) throw new ApiError('Not found', 404);
  if (!isSpaceAdmin(space, uid)) throw new ApiError('Only workspace owners can respond to this request.', 403);
  const emails = req.data?.emails ?? [];
  const role = (PAGE_ROLES.has(String(roleIn)) ? roleIn : req.role ?? 'reader') as Role;
  if (approve) {
    // workspace owners may always invite guests: the permission is written server-side (the owner may not have
    // access to the page itself), on behalf of the requester who still needs full access to it
    if (blockRole(page.id, req.requesterId) !== 'editor') throw new ApiError('The requester no longer has full access to this page.');
    const ids: string[] = [];
    for (const e of emails) {
      let id = findUserIdByEmail(e);
      if (!id) {
        id = newId();
        createUser(id, e);
      }
      ids.push(id);
    }
    const fresh = getRecord<BlockRecord>('block', page.id)!;
    const now = Date.now();
    const perms = (fresh.permissions ?? []).filter((p) => !(p.type === 'user_permission' && p.user_id && ids.includes(p.user_id)));
    for (const id of ids) perms.push({ type: 'user_permission', role, user_id: id, added_timestamp: now });
    commit([{ table: 'block', record: { ...fresh, permissions: perms, last_edited_time: now } as BaseRecord }]);
    for (const id of ids) {
      pushNotification({ user_id: id, space_id: page.space_id, type: 'invite', navigable_block_id: page.id, actor_id: req.requesterId, activity: { page_id: page.id, role, title: pageTitleOf(page) } });
    }
  }
  const status: RequestStatus = approve ? 'approved' : 'denied';
  setStatus(req.id, status, uid, approve ? role : null);
  markResolved(req, status, uid, approve ? role : null);
  pushNotification({
    user_id: req.requesterId, space_id: page.space_id, type: 'access_granted', navigable_block_id: page.id, actor_id: uid,
    activity: { page_id: page.id, kind: 'guest_invite', status, for_emails: emails, role, request_id_resolved: req.id, ...(req.data?.restricted ? { restricted: true } : {}) },
  });
  return { status, role: approve ? role : null };
}

export const handlers: Record<string, Handler> = {
  /** Members ask workspace owners to invite guests when Settings › Security only allows guest invites by request. */
  requestGuestInvite(ctx, { pageId, emails, role, message }) {
    const uid = requireUser(ctx);
    if (!hit(`guest-request:user:${uid}`, 30, 3600_000)) throw new RateLimitError();
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || page.alive === false) throw new ApiError('Not found', 404);
    if (blockRole(page.id, uid) !== 'editor') throw new ApiError('Only people with full access can add others.', 403);
    const space = getRecord<SpaceRecord>('space', page.space_id);
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    const problem = policyProblem(space, 'request_guest', uid);
    if (problem) throw new ApiError(problem, 403);
    const list = [...new Set((Array.isArray(emails) ? emails : []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e) && e.length <= 254))].slice(0, 20);
    if (!list.length) throw new ApiError('Enter an email address to invite.');
    const r = PAGE_ROLES.has(String(role)) ? String(role) : 'reader';
    const req = createRequest({ kind: 'guest_invite', targetId: page.id, spaceId: space.id, requesterId: uid, message: String(message ?? '').trim().slice(0, MAX_MESSAGE), role: r, data: { emails: list } });
    for (const a of spaceAdmins(space).filter((x) => x !== uid).slice(0, MAX_APPROVERS)) {
      pushNotification({
        user_id: a, space_id: space.id, type: 'access_requested', navigable_block_id: page.id, actor_id: uid,
        activity: { page_id: page.id, request_id: req.id, kind: 'guest_invite', for_emails: list, requested_role: r, status: 'pending', message: req.message || undefined },
      });
    }
    return { requested: true, requestId: req.id };
  },

  /**
   *  : Security › "Who can add restricted members to pages" = Any member with admin approval — a
   * member who shares a page with restricted members asks the workspace owners instead (the toast "Requested access
   * for …", Settings › Requests "Allow {email} to view page"). Same request type as guest invites (data.restricted);
   * owners approve in their Inbox or Settings › Requests (decideAccessRequest writes the page permission).
   */
  requestRestrictedMemberAccess(ctx, { pageId, userIds, role, message }) {
    const uid = requireUser(ctx);
    if (!hit(`guest-request:user:${uid}`, 30, 3600_000)) throw new RateLimitError();
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || page.alive === false) throw new ApiError('Not found', 404);
    if (blockRole(page.id, uid) !== 'editor') throw new ApiError('Only people with full access can add others.', 403);
    const space = getRecord<SpaceRecord>('space', page.space_id);
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    const problem = restrictedPageAddProblem(space, uid);
    if (!problem) return { requested: false, allowed: true };
    if (!/workspace owner must approve/.test(problem)) throw new ApiError(problem, 403);
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].filter((id) => isRestrictedMember(space, id)).slice(0, 20);
    const emails = ids.map((id) => String(getRecord<{ id: string; version: number; email?: string }>('lit_user', id)?.email ?? '').toLowerCase()).filter(Boolean);
    if (!emails.length) throw new ApiError('Choose a restricted member to request access for.');
    const r = PAGE_ROLES.has(String(role)) ? String(role) : 'reader';
    const req = createRequest({ kind: 'guest_invite', targetId: page.id, spaceId: space.id, requesterId: uid, message: String(message ?? '').trim().slice(0, MAX_MESSAGE), role: r, data: { emails, restricted: true } });
    for (const a of spaceAdmins(space).filter((x) => x !== uid).slice(0, MAX_APPROVERS)) {
      pushNotification({
        user_id: a, space_id: space.id, type: 'access_requested', navigable_block_id: page.id, actor_id: uid,
        activity: { page_id: page.id, request_id: req.id, kind: 'guest_invite', restricted: true, for_emails: emails, requested_role: r, status: 'pending', message: req.message || undefined },
      });
    }
    return { requested: true, requestId: req.id };
  },

  /** No-access screen / read-only banner state for a page id (works without a session: "Log in to request"). */
  getPageAccessState(ctx, { pageId }) {
    const id = String(pageId ?? '');
    if (!/^[\w-]{1,64}$/.test(id)) return { state: 'missing' };
    return pageAccessState(ctx.userId, id);
  },

  /** "Request access" (no access) or "Request edit access" (can view / can comment). */
  requestPageAccess(ctx, { pageId, message, kind }) {
    const uid = requireUser(ctx);
    if (!hit(`access-request:user:${uid}`, 30, 3600_000)) throw new RateLimitError();
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || page.alive === false) throw new ApiError('Not found', 404);
    const role = blockRole(page.id, uid);
    const wantEdit = kind === 'edit' || kind === 'page_edit';
    let reqKind: RequestKind;
    if (role === 'none') reqKind = 'page_access';
    else if (wantEdit && !roleAtLeast(role, 'read_and_write')) reqKind = 'page_edit';
    else throw new ApiError('You already have access to this page.');
    const space = getRecord<SpaceRecord>('space', page.space_id);
    const member = isSpaceMember(space, uid);
    if (reqKind === 'page_access' && !member) {
      const problem = policyProblem(space, 'access_request', uid);
      if (problem) throw new ApiError('People outside this workspace cannot request page access right now.', 403);
    }
    const existing = pendingRequest(reqKind, page.id, uid);
    if (existing) return { requested: true, requestId: existing.id, already: true };
    const approvers = pageApprovers(page, uid);
    if (!approvers.length) throw new ApiError('No one can approve this request right now.', 403);
    const req = createRequest({
      kind: reqKind, targetId: page.id, spaceId: page.space_id, requesterId: uid, message: String(message ?? '').trim().slice(0, MAX_MESSAGE),
      role: reqKind === 'page_edit' ? 'read_and_write' : 'reader',
    });
    for (const a of approvers) {
      pushNotification({
        user_id: a, space_id: page.space_id, type: 'access_requested', navigable_block_id: page.id, actor_id: uid,
        activity: {
          page_id: page.id, request_id: req.id, kind: reqKind, message: req.message || undefined, external: !member, status: 'pending',
          requested_role: req.role, title: pageTitleOf(page),
        },
      });
    }
    return { requested: true, requestId: req.id };
  },

  /** Inbox "Approve" (with the chosen role) / "Change" / "Deny" for page and teamspace requests. */
  decideAccessRequest(ctx, { requestId, approve, role }) {
    const uid = requireUser(ctx);
    const req = getRequest(String(requestId ?? ''));
    if (!req) throw new ApiError('Request not found', 404);
    if (req.status !== 'pending') {
      // an already-resolved request can still be changed to another role by someone with full access ("Change")
      if ((req.kind === 'page_access' || req.kind === 'page_edit') && approve && req.status === 'approved' && role && role !== req.role) {
        return { ...resolvePage({ ...req, status: 'pending' }, uid, true, role, ctx), requestId: req.id };
      }
      return { status: req.status, role: req.role, requestId: req.id, already: true };
    }
    const res = req.kind === 'team_join' ? resolveTeam(req, uid, !!approve) : req.kind === 'guest_invite' ? resolveGuestInvite(req, uid, !!approve, role) : resolvePage(req, uid, !!approve, role, ctx);
    return { ...res, requestId: req.id };
  },

  /** Teamspace browse: "Request" to join a closed teamspace (owners approve in their Inbox). */
  requestJoinTeam(ctx, { teamId, message }) {
    const uid = requireUser(ctx);
    if (!hit(`team-request:user:${uid}`, 30, 3600_000)) throw new RateLimitError();
    const team = getRecord<TeamRecord>('team', String(teamId ?? ''));
    const space = team ? getRecord<SpaceRecord>('space', team.space_id) : undefined;
    const mode = teamJoinMode(team, space, uid);
    if (!team || mode === 'none') throw new ApiError('Teamspace not found', 404);
    if (mode === 'member') return { requested: false, member: true };
    if (mode === 'join') throw new ApiError('Anyone can join this team. Use Join.');
    const existing = pendingRequest('team_join', team.id, uid);
    if (existing) return { requested: true, requestId: existing.id, already: true };
    const req = createRequest({ kind: 'team_join', targetId: team.id, spaceId: team.space_id, requesterId: uid, message: String(message ?? '').trim().slice(0, MAX_MESSAGE), role: 'member' });
    for (const o of teamOwners(team).filter((x) => x !== uid).slice(0, MAX_APPROVERS)) {
      pushNotification({
        user_id: o, space_id: team.space_id, type: 'team_join_requested', actor_id: uid,
        activity: { team_id: team.id, request_id: req.id, kind: 'team_join', message: req.message || undefined, status: 'pending' },
      });
    }
    return { requested: true, requestId: req.id };
  },

  /** Settings › Requests (admins): pending guest-invite requests of the workspace . Resolve with
   *  decideAccessRequest {requestId, approve, role?}. */
  getWorkspaceRequests(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isSpaceAdmin(space, uid)) throw new ApiError('Only workspace owners and membership admins can see requests.', 403);
    const rows = (db.prepare("SELECT * FROM access_requests WHERE space_id = ? AND kind = 'guest_invite' AND status = 'pending' ORDER BY created_time DESC LIMIT 200").all(space.id) as any[]).map(rowToRequest);
    const rm = new RecordMapBuilder(uid);
    for (const r of rows) {
      rm.add('lit_user', getRecord('lit_user', r.requesterId), 'reader');
      const page = getRecord<BlockRecord>('block', r.targetId);
      if (page) rm.add('block', page); // only when the admin can open it
    }
    return {
      requests: rows.map((r) => ({ id: r.id, kind: r.kind, pageId: r.targetId, requesterId: r.requesterId, emails: r.data?.emails ?? [], role: r.role, message: r.message, createdTime: r.createdTime, restricted: !!r.data?.restricted })),
      recordMap: rm.map,
    };
  },

  /** Pending requests I sent in a workspace (teamspaces → "Requested", pages → "Requested access"). */
  getMyAccessRequests(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const rows = db.prepare("SELECT * FROM access_requests WHERE requester_id = ? AND space_id = ? AND status = 'pending' ORDER BY created_time DESC LIMIT 200")
      .all(uid, String(spaceId ?? '')) as any[];
    const list = rows.map(rowToRequest);
    return {
      teamIds: list.filter((r) => r.kind === 'team_join').map((r) => r.targetId),
      pageIds: list.filter((r) => r.kind !== 'team_join').map((r) => r.targetId),
    };
  },

  /** Request details for an Inbox item (requester's current access, so the item can say "already has access"). */
  getAccessRequest(ctx, { requestId }) {
    const uid = requireUser(ctx);
    const req = getRequest(String(requestId ?? ''));
    if (!req) throw new ApiError('Request not found', 404);
    const rm = new RecordMapBuilder(uid);
    if (req.kind === 'team_join') {
      const team = getRecord<TeamRecord>('team', req.targetId);
      if (!team || !canManageTeam(team, uid)) throw new ApiError('Request not found', 404);
      rm.add('team', team);
      rm.add('lit_user', getRecord('lit_user', req.requesterId), 'reader');
      return { request: req, requesterRole: teamMembership(team, req.requesterId) ? 'member' : 'none', recordMap: rm.map };
    }
    const page = getRecord<BlockRecord>('block', req.targetId);
    if (!page || blockRole(page.id, uid) !== 'editor') throw new ApiError('Request not found', 404);
    rm.add('lit_user', getRecord('lit_user', req.requesterId), 'reader');
    return { request: req, requesterRole: blockRole(page.id, req.requesterId), recordMap: rm.map };
  },
};

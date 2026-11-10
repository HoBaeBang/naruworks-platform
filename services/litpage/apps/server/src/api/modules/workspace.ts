// Settings (account & workspace) endpoints that need server-side validation: sessions ("Log out of all
// devices"), workspace domain / members / roles / invite link / leave / delete, custom emoji, guests.
// Regular preference writes (user_settings, space_view, admin space settings) go through applyChanges.
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@nc/shared/ids.ts';
import { isSpaceAdmin, isSpaceMember, publicLinksOff } from '@nc/shared/permissions.ts';
import type { BaseRecord, BlockRecord, SpaceRecord, SpaceViewRecord, Table, TeamRecord, UserRootRecord } from '@nc/shared/records.ts';
import { db, findUserIdByEmail, getRecord } from '../../db.ts';
import { ApiError, handlers as coreHandlers, type Ctx } from '../handlers.ts';
import { memberRequestResolved, type MemberRequest } from './membership.ts';
import { RecordMapBuilder, blockRole, lookup } from '../../records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { formConfigOf } from '@nc/shared/form/index.ts';
import { addMember, saveRecord } from '../../seed.ts';
import { realtime } from '../../realtime.ts';
import { audit } from '../../audit.ts';
import { assertWorkspacePolicy } from '../../policy.ts';
import { registerJobHandler, scheduleJob } from '../../scheduler.ts';
import { notifyWorkspaceRequest, notifyWorkspaceRequestResolved } from '../../notify.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';

type Handler = (ctx: Ctx, body: any) => any;

function inviteMembers(ctx: Ctx, body: unknown) {
  return coreHandlers.inviteMembers(ctx, body);
}

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function sessionId(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24);
}

function spaceOrThrow(spaceId: unknown): SpaceRecord {
  const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
  if (!space) throw new ApiError('Workspace could not be found', 404);
  return space;
}

function requireAdmin(space: SpaceRecord, uid: string) {
  if (!isSpaceAdmin(space, uid)) throw new ApiError('Only workspace owners and membership admins can do this.', 403);
}

function roleOf(space: SpaceRecord, uid: string): string {
  return (space.permissions ?? []).find((p) => p.type === 'user_permission' && p.user_id === uid)?.role ?? 'none';
}

function owners(space: SpaceRecord): string[] {
  return (space.permissions ?? []).filter((p) => p.type === 'user_permission' && (p.role as string) === 'owner' && p.user_id).map((p) => p.user_id!);
}

/** Persist (version bump) + realtime broadcast + add to the response recordMap. */
export function commitRecords(uid: string, items: { table: Table; record: BaseRecord }[]) {
  return commit(uid, items);
}

function commit(uid: string, items: { table: Table; record: BaseRecord }[]) {
  const rm = new RecordMapBuilder(uid);
  const changes: { table: Table; record: BaseRecord; spaceId: string | null }[] = [];
  for (const it of items) {
    const saved = saveRecord(it.table, it.record);
    const spaceId = (saved as any).space_id ?? (it.table === 'space' ? saved.id : null);
    changes.push({ table: it.table, record: saved, spaceId });
    rm.add(it.table, saved);
  }
  realtime.broadcastChanges(changes as any);
  return rm.map;
}

/** The page or one of its ancestors is published to the web as a site (Share › Publish), not just "anyone with the link". */
function isPublishedSitePage(page: BlockRecord): boolean {
  let cur: BlockRecord | undefined = page;
  for (let i = 0; cur && i < 200; i++) {
    const p = (cur.permissions ?? []).find((x) => x.type === 'public_permission' && x.role !== 'none');
    if (p) return !!p.published && !(p.expiry_time && p.expiry_time < Date.now());
    if (cur.parent_table !== 'block') return false;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  return false;
}

function spaceViewOf(userId: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', userId);
  for (const id of root?.space_views ?? []) {
    const sv = getRecord<SpaceViewRecord>('space_view', id);
    if (sv?.space_id === spaceId) return sv;
  }
  return undefined;
}

/** Remove a user from a workspace: permission, space_view (dead), teamspace memberships. */
export function detachMember(space: SpaceRecord, userId: string): { table: Table; record: BaseRecord }[] {
  const out: { table: Table; record: BaseRecord }[] = [];
  out.push({ table: 'space', record: { ...space, permissions: (space.permissions ?? []).filter((p) => !(p.type === 'user_permission' && p.user_id === userId)) } });
  const sv = spaceViewOf(userId, space.id);
  if (sv) out.push({ table: 'space_view', record: { ...sv, alive: false } });
  const root = getRecord<UserRootRecord>('user_root', userId);
  if (root && sv) out.push({ table: 'user_root', record: { ...root, space_views: (root.space_views ?? []).filter((id) => id !== sv.id), left_spaces: [...(root.left_spaces ?? []), space.id] } });
  const teams = db.prepare(`SELECT data FROM records WHERE tbl = 'team' AND space_id = ?`).all(space.id) as { data: string }[];
  for (const r of teams) {
    const team = JSON.parse(r.data) as TeamRecord;
    if (team.membership?.some((m) => m.user_id === userId)) out.push({ table: 'team', record: { ...team, membership: team.membership.filter((m) => m.user_id !== userId) } });
  }
  return out;
}

/** Delete a workspace: every member is detached (sidebars, teamspaces) and the space is marked deleted. */
export function deleteWorkspace(space: SpaceRecord, uid: string) {
  const members = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id).map((p) => p.user_id!);
  let current = space;
  for (const m of members) {
    const items = detachMember(current, m);
    const sp = items.find((i) => i.table === 'space');
    if (sp) current = sp.record as SpaceRecord;
    commit(uid, items.filter((i) => i.table !== 'space'));
  }
  commit(uid, [{ table: 'space', record: { ...current, permissions: [], deleted_time: Date.now(), deleted_by_id: uid } as SpaceRecord }]);
}

/** Consumer email providers can't be allowed domains (anyone could join). */
const PUBLIC_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'qq.com', '163.com']);

/** A (former) member's top-level private pages in a workspace: only they had access. */
function privatePagesOf(spaceId: string, userId: string): BlockRecord[] {
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND parent_table = 'space' AND alive = 1 AND data LIKE ?`).all(spaceId, `%"user_id":"${userId.replace(/[^\w-]/g, '')}"%`) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as BlockRecord)
    .filter((b) => (b.type === 'page' || b.type === 'collection_view_page') && (b.permissions ?? []).length > 0
      && (b.permissions ?? []).every((p) => p.type === 'user_permission' && p.user_id === userId));
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/;
const EMOJI_NAME_RE = /^[\p{L}\p{N}_-]{1,48}$/u;

export const handlers: Record<string, Handler> = {
  // ---------------- sessions / devices ----------------
  getMySessions(ctx) {
    const uid = requireUser(ctx);
    const rows = db.prepare('SELECT token, created_time, expires FROM sessions WHERE user_id = ? AND expires > ? ORDER BY created_time DESC').all(uid, Date.now()) as { token: string; created_time: number; expires: number }[];
    return {
      sessions: rows.map((r) => ({ id: sessionId(r.token), createdTime: r.created_time, current: r.token === ctx.token })),
    };
  },
  /** "Log out of all devices": ends every other session of this user (the current one remains active). */
  logoutOtherSessions(ctx) {
    const uid = requireUser(ctx);
    const res = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(uid, ctx.token ?? '');
    return { count: Number(res.changes ?? 0) };
  },
  revokeSession(ctx, { id }) {
    const uid = requireUser(ctx);
    const rows = db.prepare('SELECT token FROM sessions WHERE user_id = ?').all(uid) as { token: string }[];
    const hit = rows.find((r) => sessionId(r.token) === String(id));
    if (!hit) throw new ApiError('Session not found', 404);
    if (hit.token === ctx.token) throw new ApiError('Use “Log out” to end the current session.');
    db.prepare('DELETE FROM sessions WHERE token = ?').run(hit.token);
    return {};
  },

  // ---------------- workspace general ----------------
  checkSpaceDomain(ctx, { domain, spaceId }) {
    requireUser(ctx);
    const d = String(domain ?? '').trim().toLowerCase();
    if (!DOMAIN_RE.test(d)) return { available: false, reason: 'invalid' };
    const row = db.prepare(`SELECT id FROM records WHERE tbl = 'space' AND json_extract(data, '$.domain') = ?`).get(d) as { id: string } | undefined;
    return { available: !row || row.id === spaceId, reason: row && row.id !== spaceId ? 'taken' : undefined };
  },
  setSpaceDomain(ctx, { spaceId, domain }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    // a workspace setting (also the Sites domain): owners only, like the name and icon (policy.ts)
    if (roleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can change the domain', 403);
    const d = String(domain ?? '').trim().toLowerCase();
    if (!DOMAIN_RE.test(d)) throw new ApiError('Domains can only contain lowercase letters, numbers and hyphens.');
    const row = db.prepare(`SELECT id FROM records WHERE tbl = 'space' AND json_extract(data, '$.domain') = ?`).get(d) as { id: string } | undefined;
    if (row && row.id !== space.id) throw new ApiError('This domain is already taken.');
    if (d !== space.domain) audit('workspace_domain_changed', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { oldValue: space.domain, newValue: d } });
    return { recordMap: commit(uid, [{ table: 'space', record: { ...space, domain: d } }]) };
  },
  leaveSpace(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (!isSpaceMember(space, uid)) throw new ApiError('You are not a member of this workspace.', 403);
    const os = owners(space);
    if (os.length === 1 && os[0] === uid && (space.permissions ?? []).filter((p) => p.type === 'user_permission').length > 1) {
      throw new ApiError('Make someone else a workspace owner before leaving.');
    }
    audit('member_left', { spaceId: space.id, actorId: uid, targetId: uid, ip: ctx.ip });
    commit(uid, detachMember(space, uid));
    return {};
  },
  deleteWorkspace(ctx, { spaceId, confirmName }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (roleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can delete a workspace.', 403);
    if (String(confirmName ?? '').trim() !== space.name.trim()) throw new ApiError('Workspace name does not match.');
    deleteWorkspace(space, uid);
    return {};
  },

  // ---------------- people ----------------
  setMemberRole(ctx, { spaceId, userId, role }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const r = String(role);
    if (!['owner', 'membership_admin', 'editor', 'restricted_member'].includes(r)) throw new ApiError('Unknown role');
    // Restricted members (only what's shared with them) are an Enterprise feature
    if (r === 'restricted_member' && space.plan_type !== 'enterprise') throw new ApiError('Upgrade your plan to add restricted members', 403);
    // membership admins can't create or demote owners
    if (roleOf(space, uid) !== 'owner' && (r === 'owner' || roleOf(space, String(userId)) === 'owner')) throw new ApiError('Only workspace owners can change owner roles.', 403);
    const os = owners(space);
    if (os.length === 1 && os[0] === userId && r !== 'owner') throw new ApiError('A workspace needs at least one owner.');
    const permissions = (space.permissions ?? []).map((p) => (p.type === 'user_permission' && p.user_id === userId ? { ...p, role: r as any } : p));
    const oldRole = roleOf(space, String(userId));
    if (oldRole !== r) audit('member_role_updated', { spaceId: space.id, actorId: uid, targetId: String(userId), ip: ctx.ip, data: { oldRole, newRole: r } });
    return { recordMap: commit(uid, [{ table: 'space', record: { ...space, permissions } }]) };
  },
  removeMember(ctx, { spaceId, userId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const target = String(userId);
    if (roleOf(space, uid) !== 'owner' && roleOf(space, target) === 'owner') throw new ApiError('Only workspace owners can remove owners.', 403);
    const os = owners(space);
    if (os.length === 1 && os[0] === target) throw new ApiError('A workspace needs at least one owner.');
    audit('member_removed', { spaceId: space.id, actorId: uid, targetId: target, ip: ctx.ip, data: { oldRole: roleOf(space, target) } });
    return { recordMap: commit(uid, detachMember(space, target)) };
  },
  resetInviteLink(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const code = randomBytes(15).toString('base64url');
    audit('invite_link_reset', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip });
    return { code, recordMap: commit(uid, [{ table: 'space', record: { ...space, invite_link_code: code } }]) };
  },
  setInviteLinkEnabled(ctx, { spaceId, enabled }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const settings = { ...(space.settings ?? {}), invite_link_enabled: !!enabled };
    if ((space.settings as any)?.invite_link_enabled !== false !== !!enabled) audit('invite_link_toggled', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { enabled: !!enabled } });
    return { recordMap: commit(uid, [{ table: 'space', record: { ...space, settings, invite_link_code: space.invite_link_code || randomBytes(15).toString('base64url') } }]) };
  },
  joinSpaceByInviteLink(ctx, { code }) {
    const uid = requireUser(ctx);
    const row = db.prepare(`SELECT data FROM records WHERE tbl = 'space' AND json_extract(data, '$.invite_link_code') = ?`).get(String(code ?? '')) as { data: string } | undefined;
    if (!row) throw new ApiError('This invite link is invalid or has been reset.', 404);
    const space = JSON.parse(row.data) as SpaceRecord;
    if ((space.settings as any)?.invite_link_enabled === false) throw new ApiError('This invite link has been disabled.', 403);
    if (!isSpaceMember(space, uid)) {
      addMember(space.id, uid, 'editor');
      audit('member_joined', { spaceId: space.id, actorId: uid, targetId: uid, ip: ctx.ip, data: { via: 'invite_link' } });
    }
    return { spaceId: space.id, domain: space.domain };
  },
  /** Users that have page access in this workspace without being members (Settings › People › Guests: workspace
   *  owners and membership admins, who invite and remove guests). Only pages the caller can open are listed. */
  getWorkspaceGuests(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const members = new Set((space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role !== 'none').map((p) => p.user_id));
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND data LIKE '%"user_permission"%'`).all(space.id) as { data: string }[];
    const guests = new Map<string, Set<string>>();
    const rm = new RecordMapBuilder(uid);
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      for (const p of b.permissions ?? []) {
        if (p.type !== 'user_permission' || !p.user_id || members.has(p.user_id) || p.role === 'none') continue;
        if (!guests.has(p.user_id)) guests.set(p.user_id, new Set());
        // a member's private page shared with a guest stays private: neither its id nor its record are listed
        if (blockRole(b.id, uid) === 'none') continue;
        guests.get(p.user_id)!.add(b.id);
        rm.add('block', b);
      }
    }
    for (const id of guests.keys()) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    return { guests: [...guests.entries()].map(([userId, pages]) => ({ userId, pageIds: [...pages] })), recordMap: rm.map };
  },

  // ---------------- teamspaces ----------------
  /** Settings › Teamspaces › Default teamspaces: newly-default teamspaces are joined by every current member
   *  (new members join them through addMember). */
  setDefaultTeams(ctx, { spaceId, teamIds }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const ids = [...new Set((Array.isArray(teamIds) ? teamIds : []).map(String))];
    const teams = ids.map((id) => getRecord<TeamRecord>('team', id)).filter((tm): tm is TeamRecord => !!tm && tm.space_id === space.id && tm.alive !== false && !tm.archived_by);
    if (!teams.length) throw new ApiError('Select at least one default team');
    const before = new Set(space.default_team_ids ?? []);
    const members = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
    const items: { table: Table; record: BaseRecord }[] = [{ table: 'space', record: { ...space, default_team_ids: teams.map((tm) => tm.id) } }];
    const views = new Map<string, SpaceViewRecord>();
    const now = Date.now();
    for (const team of teams) {
      if (before.has(team.id)) continue;
      const have = new Set((team.membership ?? []).map((m) => m.user_id));
      const membership = [...(team.membership ?? []), ...members.filter((m) => !have.has(m)).map((m) => ({ user_id: m, role: 'member' as const, added_time: now }))];
      items.push({ table: 'team', record: { ...team, membership, settings: { ...(team.settings ?? {}), type: 'open' } } });
      for (const m of members) {
        const sv = views.get(m) ?? spaceViewOf(m, space.id);
        if (sv && !(sv.joined_teams ?? []).includes(team.id)) views.set(m, { ...sv, joined_teams: [...(sv.joined_teams ?? []), team.id] });
      }
    }
    for (const sv of views.values()) items.push({ table: 'space_view', record: sv });
    return { recordMap: commit(uid, items) };
  },

  // ---------------- requests (Settings › Requests; members ask, admins approve) ----------------
  requestMembers(ctx, { spaceId, emails }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (!isSpaceMember(space, uid)) throw new ApiError('Not a member', 403);
    assertWorkspacePolicy(space, 'member_request', uid);
    const list = [...new Set((Array.isArray(emails) ? emails : []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))];
    if (!list.length) throw new ApiError('Enter at least one valid email address.');
    const req = { id: newId(), emails: list, requested_by: uid, created_time: Date.now() };
    const settings = { ...(space.settings ?? {}), member_requests: [...(((space.settings as any)?.member_requests ?? []) as unknown[]), req] };
    const recordMap = commit(uid, [{ table: 'space', record: { ...space, settings } }]);
    notifyWorkspaceRequest({ spaceId: space.id, requesterId: uid, kind: 'member', emails: list, requestId: req.id });
    return { request: req, recordMap };
  },
  resolveMemberRequest(ctx, { spaceId, requestId, approve }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const reqs = ((space.settings as any)?.member_requests ?? []) as MemberRequest[];
    const req = reqs.find((r) => r.id === requestId);
    if (!req) throw new ApiError('Request not found', 404);
    let userIds: string[] = [];
    if (approve) userIds = (inviteMembers(ctx, { spaceId: space.id, emails: req.emails, role: 'editor' }) as { userIds: string[] }).userIds;
    // : admins' Inbox items show the outcome; teamspace-invite requests also join that teamspace
    memberRequestResolved(space, req, !!approve, uid, userIds);
    for (const email of req.emails) audit('membership_request_resolved', { spaceId: space.id, actorId: uid, ip: ctx.ip, data: { email, status: approve ? 'approved' : 'declined' } });
    const fresh = getRecord<SpaceRecord>('space', space.id) ?? space;
    const settings = { ...(fresh.settings ?? {}), member_requests: reqs.filter((r) => r.id !== requestId) };
    const rm = new RecordMapBuilder(uid);
    rm.map = commit(uid, [{ table: 'space', record: { ...fresh, settings } }]);
    for (const id of userIds) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    if (req.requested_by) notifyWorkspaceRequestResolved({ spaceId: space.id, requesterId: req.requested_by, actorId: uid, kind: 'member', status: approve ? 'approved' : 'denied', emails: req.emails, self: !!req.self, spaceName: space.name ?? '' });
    return { userIds, recordMap: rm.map };
  },
  requestUpgrade(ctx, { spaceId, plan, note }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (!isSpaceMember(space, uid)) throw new ApiError('Not a member', 403);
    if ((space.settings as any)?.allow_upgrade_requests === false) throw new ApiError('Workspace owners have turned off upgrade requests.', 403);
    const p = String(plan ?? '');
    if (!['plus', 'business', 'enterprise', 'lit_ai'].includes(p)) throw new ApiError('Unknown plan');
    const list = ((space.settings as any)?.upgrade_requests ?? []) as { plan: string; requested_by: string }[];
    if (list.some((r) => r.plan === p && r.requested_by === uid)) throw new ApiError('You already requested this upgrade.');
    const req = { id: newId(), plan: p, note: String(note ?? '').slice(0, 500), requested_by: uid, created_time: Date.now() };
    const settings = { ...(space.settings ?? {}), upgrade_requests: [...list, req] };
    const recordMap = commit(uid, [{ table: 'space', record: { ...space, settings } }]);
    notifyWorkspaceRequest({ spaceId: space.id, requesterId: uid, kind: 'upgrade', plan: p, message: req.note, requestId: req.id });
    return { request: req, recordMap };
  },
  /** Simulated billing: owners switch plan tiers locally (no payment), clearing matching upgrade requests. */
  changePlan(ctx, { spaceId, plan }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (roleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can change the plan.', 403);
    const p = String(plan ?? '');
    if (!['free', 'plus', 'business', 'enterprise'].includes(p)) throw new ApiError('Unknown plan');
    const reqs = ((space.settings as any)?.upgrade_requests ?? []) as { plan: string; requested_by?: string }[];
    // a request is met once the workspace has that plan or a higher one; AI comes with Business and Enterprise
    const rank: Record<string, number> = { free: 0, plus: 1, business: 2, enterprise: 3 };
    const met = (r: { plan: string }) => (r.plan === 'lit_ai' ? rank[p] >= rank.business : (rank[r.plan] ?? 99) <= rank[p]);
    const settings = { ...(space.settings ?? {}), upgrade_requests: reqs.filter((r) => !met(r)), plan_changed_time: Date.now() };
    const recordMap = commit(uid, [{ table: 'space', record: { ...space, plan_type: p as SpaceRecord['plan_type'], settings } }]);
    for (const r of reqs) {
      if (met(r) && r.requested_by) notifyWorkspaceRequestResolved({ spaceId: space.id, requesterId: r.requested_by, actorId: uid, kind: 'upgrade', status: 'approved', plan: r.plan });
    }
    return { recordMap };
  },

  /** Settings › Public pages tiles: pages shared publicly (Share › Publish = Sites, General access link = Anyone with the link). */
  getPublicPages(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (!isSpaceMember(space, uid)) throw new ApiError('Not a member', 403);
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND data LIKE '%"public_permission"%'`).all(space.id) as { data: string }[];
    const rm = new RecordMapBuilder(uid);
    const pages: { blockId: string; kind: 'site' | 'link' | 'form'; published_time?: number; published_by_id?: string; viewId?: string; title?: string }[] = [];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      const p = (b.permissions ?? []).find((x) => x.type === 'public_permission' && x.role !== 'none');
      if (!p || (p.expiry_time && p.expiry_time < Date.now())) continue;
      // publishing switched off for the workspace or the page's teamspace: the link is down
      if (publicLinksOff(lookup, space, b)) continue;
      pages.push({ blockId: b.id, kind: p.published ? 'site' : 'link', published_time: p.published_time ?? p.added_timestamp ?? (b as any).last_edited_time, published_by_id: p.published_by_id ?? (b as any).created_by_id });
      rm.add('block', b);
      const by = p.published_by_id ?? (b as any).created_by_id;
      if (by) rm.add('lit_user', getRecord('lit_user', by), 'reader');
    }
    // Public forms (form views shared with "Anyone on the web with link")
    if (!space.disable_public_access) {
      const views = db.prepare(`SELECT data FROM records WHERE tbl = 'collection_view' AND space_id = ? AND alive = 1 AND data LIKE '%"form_config"%'`).all(space.id) as { data: string }[];
      for (const r of views) {
        const v = JSON.parse(r.data) as any;
        const form = v.type === 'form' ? formConfigOf(v.format) : undefined;
        if (!form || form.permission !== 'public') continue;
        const host = getRecord<BlockRecord>('block', v.parent_id);
        if (!host || !host.alive || blockRole(host.id, uid) === 'none') continue;
        const title = String((form as any).title ?? '').trim() || toPlainText(v.name) || toPlainText(host.properties?.title);
        pages.push({ blockId: host.id, kind: 'form', viewId: v.id, title, published_time: v.last_edited_time ?? host.last_edited_time, published_by_id: (form as any).ownerId ?? host.created_by_id });
        rm.add('block', host);
        const by = (form as any).ownerId ?? host.created_by_id;
        if (by) rm.add('lit_user', getRecord('lit_user', by), 'reader');
      }
    }
    pages.sort((a, b) => (b.published_time ?? 0) - (a.published_time ?? 0));
    return { pages, recordMap: rm.map };
  },

  /** Sites domain root (/site/<domain>, Settings › Public pages › Domains › Homepage): the
   *  workspace's homepage when it is a live published page. Works without a session, like a public site. */
  getSiteHome(_ctx, { domain }) {
    const d = String(domain ?? '').trim().toLowerCase().replace(/\.litpage\.site$/, '');
    const row = /^[a-z0-9-]{1,63}$/.test(d) ? db.prepare(`SELECT data FROM records WHERE tbl = 'space' AND json_extract(data, '$.domain') = ?`).get(d) as { data: string } | undefined : undefined;
    const space = row ? JSON.parse(row.data) as SpaceRecord : undefined;
    if (!space || (space as any).deleted_time || space.disable_public_access) throw new ApiError('Not found', 404);
    const homeId = (space.settings as any)?.public_home_page as string | undefined;
    const page = homeId ? getRecord<BlockRecord>('block', homeId) : undefined;
    if (!page || !page.alive || page.space_id !== space.id || !isPublishedSitePage(page) || blockRole(page.id, null) === 'none') throw new ApiError('Not found', 404);
    return { pageId: page.id, title: toPlainText(page.properties?.title) };
  },

  /** People › Guests › Remove from workspace: drops the guest's page permissions in this workspace. */
  removeGuest(ctx, { spaceId, userId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    const target = String(userId ?? '');
    if (isSpaceMember(space, target)) throw new ApiError('This person is a workspace member.');
    const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND data LIKE ?`).all(space.id, `%${target}%`) as { data: string }[];
    const items: { table: Table; record: BaseRecord }[] = [];
    for (const r of rows) {
      const b = JSON.parse(r.data) as BlockRecord;
      const perms = b.permissions ?? [];
      const next = perms.filter((p) => !(p.type === 'user_permission' && p.user_id === target));
      if (next.length !== perms.length) items.push({ table: 'block', record: { ...b, permissions: next } });
    }
    if (items.length) audit('guest_removed', { spaceId: space.id, actorId: uid, targetId: target, ip: ctx.ip });
    return { count: items.length, recordMap: commit(uid, items) };
  },

  // ---------------- General › Allowed domains (people with these email domains join on sign-up) ----------------
  setAllowedEmailDomains(ctx, { spaceId, domains }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (roleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can change allowed email domains.', 403);
    const list = [...new Set((Array.isArray(domains) ? domains : []).map((d) => String(d).trim().toLowerCase().replace(/^@/, '')))].filter(Boolean).slice(0, 50);
    // only domains that members of this workspace already use 
    const memberDomains = new Set((space.permissions ?? []).filter((p) => p.user_id && p.role !== 'none')
      .map((p) => String(getRecord<any>('lit_user', p.user_id!)?.email ?? '').split('@')[1]).filter(Boolean));
    for (const d of list) {
      if (!/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) throw new ApiError(`“${d}” is not a valid domain.`);
      if (PUBLIC_EMAIL_DOMAINS.has(d)) throw new ApiError('That domain is not allowed');
      if (!memberDomains.has(d)) throw new ApiError(`Add a domain that a member of this workspace uses (“${d}” isn’t one).`);
    }
    const before = new Set<string>(((space.settings as any)?.allowed_email_domains ?? []) as string[]);
    for (const d of list) if (!before.has(d)) audit('allowed_email_domain_added', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { addedValue: d } });
    for (const d of before) if (!list.includes(d)) audit('allowed_email_domain_removed', { spaceId: space.id, actorId: uid, targetId: space.id, ip: ctx.ip, data: { removedValue: d } });
    const settings = { ...(space.settings ?? {}), allowed_email_domains: list };
    return { domains: list, recordMap: commit(uid, [{ table: 'space', record: { ...space, settings } }]) };
  },

  // ---------------- People › Add members: who an email belongs to ----------------
  /** Preferences › Profile discoverability : an invite shows the invitee's name and photo only
   *  when they allow it (user_settings.settings.profile_discoverable, default on); otherwise just the email — the
   *  answer doesn't reveal whether the address has an account. */
  lookupInvitees(ctx, { spaceId, emails }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (!isSpaceMember(space, uid)) throw new ApiError('Not a member', 403);
    if (!hit(`invitee-lookup:user:${uid}`, 120, 10 * 60_000)) throw new RateLimitError();
    const list = [...new Set((Array.isArray(emails) ? emails : []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 20);
    return {
      invitees: list.map((email) => {
        const id = findUserIdByEmail(email);
        if (!id) return { email };
        const prefs = (getRecord<any>('user_settings', id)?.settings ?? {}) as Record<string, unknown>;
        if (prefs.profile_discoverable === false) return { email };
        const u = getRecord<any>('lit_user', id);
        return { email, name: u?.name || undefined, profilePhoto: u?.profile_photo || undefined };
      }),
    };
  },

  // ---------------- guests → members (People › Guests › Upgrade, Suggestions) ----------------
  upgradeGuests(ctx, { spaceId, userIds, role }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    requireAdmin(space, uid);
    // "Upgrade to restricted member" (Enterprise) keeps them limited to what's shared with them
    const r = role === 'restricted_member' ? 'restricted_member' : 'editor';
    if (r === 'restricted_member' && space.plan_type !== 'enterprise') throw new ApiError('Upgrade your plan to add restricted members', 403);
    const ids = [...new Set((Array.isArray(userIds) ? userIds : []).map(String))].slice(0, 100);
    const added: string[] = [];
    for (const id of ids) {
      if (!getRecord('lit_user', id) || isSpaceMember(getRecord<SpaceRecord>('space', space.id), id)) continue;
      addMember(space.id, id, r);
      audit('member_invited', { spaceId: space.id, actorId: uid, targetId: id, ip: ctx.ip, data: { newRole: r, fromGuest: true } });
      added.push(id);
    }
    const rm = new RecordMapBuilder(uid);
    rm.add('space', getRecord<SpaceRecord>('space', space.id));
    for (const id of added) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    return { userIds: added, recordMap: rm.map };
  },

  // ---------------- groups (People › Groups; "Allow all members to create groups", group owners) ----------------
  createGroup(ctx, { spaceId, name, memberIds }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (!isSpaceMember(space, uid)) throw new ApiError('Not a member', 403);
    if ((space.settings as any)?.restrict_group_creation && !isSpaceAdmin(space, uid)) throw new ApiError('Only workspace owners or membership admins can add a permission group.', 403);
    const n = String(name ?? '').trim().slice(0, 100);
    if (!n) throw new ApiError('Give the group a name.');
    const members = new Set((space.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => p.user_id!));
    const list = ((space.settings as any)?.groups ?? []) as any[];
    const group = { id: newId(), name: n, member_ids: (Array.isArray(memberIds) ? memberIds : []).map(String).filter((id) => members.has(id)), owner_ids: [uid], created_time: Date.now(), created_by_id: uid };
    const settings = { ...(space.settings ?? {}), groups: [...list, group] };
    audit('workspace.group.created', { spaceId: space.id, actorId: uid, targetId: group.id, ip: ctx.ip, data: { groupName: n } });
    return { group, recordMap: commit(uid, [{ table: 'space', record: { ...space, settings } }]) };
  },
  /** Rename / members / owners. Workspace admins and the group's owners (Make group owner). */
  updateGroup(ctx, { spaceId, groupId, name, memberIds, ownerIds }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    const list = ((space.settings as any)?.groups ?? []) as { id: string; name: string; member_ids: string[]; owner_ids?: string[]; created_by_id?: string }[];
    const g = list.find((x) => x.id === groupId);
    if (!g) throw new ApiError('Group not found', 404);
    const groupOwner = (g.owner_ids ?? (g.created_by_id ? [g.created_by_id] : [])).includes(uid);
    if (!isSpaceAdmin(space, uid) && !groupOwner) throw new ApiError('Only group owners and workspace admins can manage this group.', 403);
    const members = new Set((space.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => p.user_id!));
    const next = { ...g };
    if (name !== undefined) {
      const n = String(name).trim().slice(0, 100);
      if (!n) throw new ApiError('Give the group a name.');
      next.name = n;
    }
    if (Array.isArray(memberIds)) next.member_ids = [...new Set(memberIds.map(String))].filter((id) => members.has(id));
    if (Array.isArray(ownerIds)) next.owner_ids = [...new Set(ownerIds.map(String))].filter((id) => members.has(id) && next.member_ids.includes(id) || id === uid);
    const settings = { ...(space.settings ?? {}), groups: list.map((x) => (x.id === g.id ? next : x)) };
    return { group: next, recordMap: commit(uid, [{ table: 'space', record: { ...space, settings } }]) };
  },
  deleteGroup(ctx, { spaceId, groupId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    const list = ((space.settings as any)?.groups ?? []) as { id: string; owner_ids?: string[]; created_by_id?: string }[];
    const g = list.find((x) => x.id === groupId);
    if (!g) throw new ApiError('Group not found', 404);
    if (!isSpaceAdmin(space, uid) && !(g.owner_ids ?? (g.created_by_id ? [g.created_by_id] : [])).includes(uid)) throw new ApiError('Only group owners and workspace admins can delete this group.', 403);
    const settings = { ...(space.settings ?? {}), groups: list.filter((x) => x.id !== groupId) };
    return { recordMap: commit(uid, [{ table: 'space', record: { ...space, settings } }]) };
  },

  // ---------------- temporary members (Add members › Temporary member, Edit expiration date) ----------------
  setMemberExpiration(ctx, { spaceId, userId, expiry }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (roleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can manage temporary members.', 403);
    const target = String(userId ?? '');
    if (roleOf(space, target) === 'owner') throw new ApiError('Workspace owners can’t be temporary members.');
    const ms = expiry === null ? null : Number(expiry);
    if (ms !== null && (!Number.isFinite(ms) || ms <= Date.now() || ms > Date.now() + 366 * 86_400_000)) throw new ApiError('Choose an expiration date within the next year.');
    let found = false;
    const permissions = (space.permissions ?? []).map((p) => {
      if (p.type !== 'user_permission' || p.user_id !== target || p.role === 'none') return p;
      found = true;
      const { expires_at: _old, ...rest } = p as any;
      return ms === null ? rest : { ...rest, expires_at: ms };
    });
    if (!found) throw new ApiError('Not a member', 404);
    const old = (space.permissions ?? []).find((p) => p.user_id === target) as any;
    audit('workspace.member.expiry.updated', { spaceId: space.id, actorId: uid, targetId: target, ip: ctx.ip, data: { oldDate: old?.expires_at ?? null, newDate: ms } });
    return { recordMap: commit(uid, [{ table: 'space', record: { ...space, permissions } }]) };
  },

  // ---------------- People › Recently left (Enterprise): transfer a former member's private pages ----------------
  getRecentlyLeft(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (roleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can transfer content.', 403);
    const since = Date.now() - 30 * 86_400_000;
    const rows = db.prepare(`SELECT target_id, actor_id, event, MAX(time) AS time FROM audit_log WHERE space_id = ? AND event IN ('member_removed', 'member_left') AND time > ? GROUP BY target_id`).all(space.id, since) as { target_id: string; time: number }[];
    const rm = new RecordMapBuilder(uid);
    const people = rows
      .filter((r) => r.target_id && !isSpaceMember(space, r.target_id))
      .map((r) => {
        const pages = privatePagesOf(space.id, r.target_id);
        rm.add('lit_user', getRecord('lit_user', r.target_id), 'reader');
        return { userId: r.target_id, leftTime: r.time, privatePages: pages.length };
      })
      .filter((p) => p.privatePages > 0);
    return { people, recordMap: rm.map };
  },
  transferPrivatePages(ctx, { spaceId, fromUserId, toUserId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (roleOf(space, uid) !== 'owner') throw new ApiError('Only workspace owners can transfer content.', 403);
    const from = String(fromUserId ?? '');
    const to = String(toUserId ?? '');
    if (isSpaceMember(space, from)) throw new ApiError('This person is still a member of the workspace.');
    if (!isSpaceMember(space, to)) throw new ApiError('Pages can only be transferred to a workspace member.');
    const pages = privatePagesOf(space.id, from);
    const sv = spaceViewOf(to, space.id);
    if (!sv) throw new ApiError('Workspace could not be found', 404);
    const items: { table: Table; record: BaseRecord }[] = pages.map((b) => ({
      table: 'block' as Table,
      record: { ...b, permissions: [{ type: 'user_permission', role: 'editor', user_id: to, added_timestamp: Date.now() }] } as BlockRecord,
    }));
    items.push({ table: 'space_view', record: { ...sv, private_pages: [...pages.map((b) => b.id).filter((id) => !(sv.private_pages ?? []).includes(id)), ...(sv.private_pages ?? [])] } });
    for (const b of pages) audit('page_permission_updated', { spaceId: space.id, actorId: uid, targetId: b.id, ip: ctx.ip, data: { pageName: '', kind: 'user_permission', userId: to, oldRole: 'none', newRole: 'editor', transferredFrom: from, withAdminPerms: true } });
    commit(uid, items);
    return { count: pages.length };
  },

  // ---------------- custom emoji (any member may add; creator or admin may remove) ----------------
  addCustomEmoji(ctx, { spaceId, name, url }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    if (!isSpaceMember(space, uid)) throw new ApiError('Not a member', 403);
    if ((space.settings as any)?.emoji_admin_only && !isSpaceAdmin(space, uid)) throw new ApiError('Only workspace owners can add custom emojis.', 403);
    const n = String(name ?? '').trim().toLowerCase().replace(/\s+/g, '-');
    if (!EMOJI_NAME_RE.test(n)) throw new ApiError('Emoji names can only contain letters, numbers, dashes and underscores.');
    const list = ((space.settings as any)?.custom_emojis ?? []) as { id: string; name: string }[];
    if (list.some((e) => e.name === n)) throw new ApiError(`An emoji named “${n}” already exists.`);
    if (!/^(\/files\/|https?:\/\/|data:image\/)/.test(String(url ?? ''))) throw new ApiError('Upload an image first.');
    const emoji = { id: newId(), name: n, url: String(url), created_by_id: uid, created_time: Date.now() };
    const settings = { ...(space.settings ?? {}), custom_emojis: [emoji, ...list] };
    audit('workspace.custom_emoji.created', { spaceId: space.id, actorId: uid, targetId: emoji.id, ip: ctx.ip, data: { name: n } });
    return { emoji, recordMap: commit(uid, [{ table: 'space', record: { ...space, settings } }]) };
  },
  editCustomEmoji(ctx, { spaceId, emojiId, name, url }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    const list = ((space.settings as any)?.custom_emojis ?? []) as { id: string; name: string; url: string; created_by_id: string }[];
    const e = list.find((x) => x.id === emojiId);
    if (!e) throw new ApiError('Emoji not found', 404);
    if (e.created_by_id !== uid && !isSpaceAdmin(space, uid)) throw new ApiError('You cannot change this emoji', 403);
    const n = String(name ?? e.name).trim().toLowerCase().replace(/\s+/g, '-');
    if (!EMOJI_NAME_RE.test(n)) throw new ApiError('Emoji names can only contain letters, numbers, dashes and underscores.');
    if (list.some((x) => x.name === n && x.id !== e.id)) throw new ApiError('That name is already in use');
    const u = String(url ?? e.url);
    if (!/^(\/files\/|https?:\/\/|data:image\/)/.test(u)) throw new ApiError('Upload an image first.');
    const settings = { ...(space.settings ?? {}), custom_emojis: list.map((x) => (x.id === e.id ? { ...x, name: n, url: u } : x)) };
    audit('workspace.custom_emoji.updated', { spaceId: space.id, actorId: uid, targetId: e.id, ip: ctx.ip, data: { name: n } });
    return { recordMap: commit(uid, [{ table: 'space', record: { ...space, settings } }]) };
  },
  removeCustomEmoji(ctx, { spaceId, emojiId }) {
    const uid = requireUser(ctx);
    const space = spaceOrThrow(spaceId);
    const list = ((space.settings as any)?.custom_emojis ?? []) as { id: string; created_by_id: string }[];
    const e = list.find((x) => x.id === emojiId);
    if (!e) throw new ApiError('Emoji not found', 404);
    if (e.created_by_id !== uid && !isSpaceAdmin(space, uid)) throw new ApiError('Only the person who added this emoji or a workspace owner can remove it.', 403);
    const settings = { ...(space.settings ?? {}), custom_emojis: list.filter((x) => x.id !== emojiId) };
    audit('workspace.custom_emoji.deleted', { spaceId: space.id, actorId: uid, targetId: e.id, ip: ctx.ip });
    return { recordMap: commit(uid, [{ table: 'space', record: { ...space, settings } }]) };
  },
};

/** Temporary members (People › Add members › Temporary member) lose access when their expiration date passes. */
export function expireTemporaryMembers(now = Date.now()): number {
  let n = 0;
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'space' AND data LIKE '%"expires_at"%'`).all() as { data: string }[];
  for (const r of rows) {
    let space = JSON.parse(r.data) as SpaceRecord;
    for (const p of [...(space.permissions ?? [])] as any[]) {
      if (p.type !== 'user_permission' || !p.user_id || typeof p.expires_at !== 'number' || p.expires_at > now) continue;
      const items = detachMember(space, p.user_id);
      commit(p.user_id, items);
      audit('member_removed', { spaceId: space.id, actorId: null, targetId: p.user_id, data: { reason: 'temporary_member_expired' } });
      space = (items.find((i) => i.table === 'space')?.record as SpaceRecord) ?? space;
      n++;
    }
  }
  return n;
}

registerJobHandler('w3set-temp-members', () => {
  expireTemporaryMembers();
  scheduleJob('w3set-temp-members', 'w3set-temp-members:hourly', Date.now() + 3600_000);
});
scheduleJob('w3set-temp-members', 'w3set-temp-members:hourly', Date.now() + 5 * 60_000);

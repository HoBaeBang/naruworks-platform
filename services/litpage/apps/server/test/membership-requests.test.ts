// Membership requests and teamspace invite links: guests ask to become members, people
// outside the workspace ask through a teamspace invite link, the invite link itself (who sees it, toggle,
// reset, join) and the approval path through resolveMemberRequest (member + teamspace, Inbox items resolved).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-membership-test-'));
process.env.NC_SCHEDULER = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

const space = () => db.getRecord<any>('space', ids.space)!;
const team = () => db.getRecord<any>('team', ids.team)!;
function setSpaceSettings(patch: Record<string, unknown>) {
  const s = space();
  db.putRecord('space', { ...s, settings: { ...(s.settings ?? {}), ...patch } });
}
function setTeamSettings(patch: Record<string, unknown>) {
  const tm = team();
  db.putRecord('team', { ...tm, settings: { ...(tm.settings ?? {}), ...patch } });
}
function notificationsOf(userId: string, type: string): any[] {
  return (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ? AND json_extract(data, '$.type') = ?`).all(userId, type) as { data: string }[]).map((r) => JSON.parse(r.data));
}
const codeOf = (path: string) => path.split('/').pop()!;

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'bob', 'carl', 'gina', 'olly', 'hugo']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@member.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  db.putRecord('space', { ...space(), plan_type: 'plus' });
  seed.addMember(ids.space, ids.bob, 'editor');
  seed.addMember(ids.space, ids.carl, 'editor');
  seed.createWorkspace(ids.olly, 'Olly home');
  seed.createWorkspace(ids.hugo, 'Hugo home');
  // a closed teamspace: Alice owns it, Bob is a member, only owners invite
  ids.team = newId();
  const now = Date.now();
  db.putRecord('team', {
    id: ids.team, version: 1, space_id: ids.space, name: 'Design', alive: true, created_time: now, team_pages: [],
    membership: [{ user_id: ids.alice, role: 'owner', added_time: now }, { user_id: ids.bob, role: 'member', added_time: now }],
    settings: { type: 'closed', invite_access: 'owners' },
  } as any);
  // Gina is a page guest: a page of the workspace is shared with her
  ids.page = newId();
  db.putRecord('block', {
    id: ids.page, version: 1, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true,
    properties: { title: [['Shared with Gina']] }, permissions: [{ type: 'user_permission', role: 'reader', user_id: ids.gina }],
    created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
});

describe('teamspace invite link', () => {
  it('only people who can invite members get the link', async () => {
    const r = await call(ids.alice, 'getTeamInviteLink', { teamId: ids.team });
    expect(r.enabled).toBe(true);
    expect(r.path).toMatch(/^\/team-invite\/[\w-]{10,}$/);
    ids.code = codeOf(r.path);
    expect(await status(() => call(ids.bob, 'getTeamInviteLink', { teamId: ids.team }))).toBe(403); // owners-only invites
    expect(await status(() => call(ids.olly, 'getTeamInviteLink', { teamId: ids.team }))).toBe(404);
    setTeamSettings({ invite_access: 'members' });
    expect((await call(ids.bob, 'getTeamInviteLink', { teamId: ids.team })).path).toBe(r.path);
    setTeamSettings({ invite_access: 'owners' });
  });

  it('a workspace member joins the teamspace from the link', async () => {
    const info = await call(ids.carl, 'getTeamInvite', { code: ids.code });
    expect(info.state).toBe('join');
    expect(info.team.name).toBe('Design');
    const res = await call(ids.carl, 'joinTeamByInviteLink', { code: ids.code });
    expect(res.teamId).toBe(ids.team);
    expect(team().membership.some((m: any) => m.user_id === ids.carl && m.role === 'member')).toBe(true);
    const sv = (db.db.prepare(`SELECT data FROM records WHERE tbl = 'space_view' AND json_extract(data, '$.parent_id') = ? AND json_extract(data, '$.space_id') = ?`).get(ids.carl, ids.space) as { data: string });
    expect(JSON.parse(sv.data).joined_teams).toContain(ids.team);
    expect((await call(ids.carl, 'getTeamInvite', { code: ids.code })).state).toBe('member');
  });

  it('turned off: the link stops working; unknown codes are invalid', async () => {
    setTeamSettings({ invite_link_enabled: false });
    expect((await call(ids.hugo, 'getTeamInvite', { code: ids.code })).state).toBe('disabled');
    expect(await status(() => call(ids.carl, 'joinTeamByInviteLink', { code: ids.code }))).toBe(403);
    expect((await call(ids.alice, 'getTeamInviteLink', { teamId: ids.team })).enabled).toBe(false);
    setTeamSettings({ invite_link_enabled: true });
    expect((await call(ids.hugo, 'getTeamInvite', { code: 'not-a-real-code-123' })).state).toBe('invalid');
  });

  it('reset: owners only, the old link becomes invalid', async () => {
    expect(await status(() => call(ids.bob, 'resetTeamInviteLink', { teamId: ids.team }))).toBe(403);
    const r = await call(ids.alice, 'resetTeamInviteLink', { teamId: ids.team });
    expect(codeOf(r.path)).not.toBe(ids.code);
    expect((await call(ids.hugo, 'getTeamInvite', { code: ids.code })).state).toBe('invalid');
    ids.code = codeOf(r.path);
  });
});

describe('membership requests from outside and from guests', () => {
  it('outsiders can only ask when Security allows it; the request reaches the admins once', async () => {
    expect((await call(ids.olly, 'getTeamInvite', { code: ids.code })).state).toBe('no_access');
    expect(await status(() => call(ids.olly, 'requestMembershipByTeamInvite', { code: ids.code }))).toBe(403);
    setSpaceSettings({ allow_external_member_requests: true });
    const info = await call(ids.olly, 'getTeamInvite', { code: ids.code });
    expect(info.state).toBe('request');
    expect(info.requested).toBe(false);
    const r1 = await call(ids.olly, 'requestMembershipByTeamInvite', { code: ids.code, message: 'Joining the design crew' });
    const r2 = await call(ids.olly, 'requestMembershipByTeamInvite', { code: ids.code });
    expect(r2.requestId).toBe(r1.requestId);
    const req = space().settings.member_requests.find((x: any) => x.id === r1.requestId);
    expect(req).toMatchObject({ self: true, via: 'team_invite_link', team_id: ids.team, emails: ['olly@member.test'], requested_by: ids.olly });
    const inbox = notificationsOf(ids.alice, 'space_member_requested').filter((n) => n.activity?.request_id_ws === r1.requestId);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].activity).toMatchObject({ self: true, status: 'pending', message: 'Joining the design crew' });
    expect((await call(ids.olly, 'getTeamInvite', { code: ids.code })).requested).toBe(true);
    ids.ollyRequest = r1.requestId;
  });

  it('only admins approve; approval makes the person a member of the workspace and the teamspace', async () => {
    expect(await status(() => call(ids.bob, 'resolveMemberRequest', { spaceId: ids.space, requestId: ids.ollyRequest, approve: true }))).toBe(403);
    await call(ids.alice, 'resolveMemberRequest', { spaceId: ids.space, requestId: ids.ollyRequest, approve: true });
    expect(space().permissions.some((p: any) => p.user_id === ids.olly && p.role === 'editor')).toBe(true);
    expect(team().membership.some((m: any) => m.user_id === ids.olly)).toBe(true);
    expect(space().settings.member_requests.some((x: any) => x.id === ids.ollyRequest)).toBe(false);
    const inbox = notificationsOf(ids.alice, 'space_member_requested').find((n) => n.activity?.request_id_ws === ids.ollyRequest);
    expect(inbox.activity).toMatchObject({ status: 'approved', resolved_by_id: ids.alice });
    const back = notificationsOf(ids.olly, 'access_granted').find((n) => n.activity?.kind === 'member_request');
    expect(back.activity).toMatchObject({ status: 'approved', self: true, space_name: 'Acme' });
  });

  it('guests ask from the guest banner; strangers and members can not', async () => {
    const st = await call(ids.gina, 'getMembershipRequestState', { spaceId: ids.space });
    expect(st).toMatchObject({ guest: true, workspaceName: 'Acme', canRequest: true, requested: false });
    expect((await call(ids.hugo, 'getMembershipRequestState', { spaceId: ids.space })).guest).toBe(false);
    expect(await status(() => call(ids.hugo, 'requestWorkspaceMembership', { spaceId: ids.space }))).toBe(404);
    expect((await call(ids.bob, 'requestWorkspaceMembership', { spaceId: ids.space })).member).toBe(true);
    setSpaceSettings({ allow_guest_member_requests: false });
    expect((await call(ids.gina, 'getMembershipRequestState', { spaceId: ids.space })).canRequest).toBe(false);
    expect(await status(() => call(ids.gina, 'requestWorkspaceMembership', { spaceId: ids.space }))).toBe(403);
    setSpaceSettings({ allow_guest_member_requests: true });
    const r = await call(ids.gina, 'requestWorkspaceMembership', { spaceId: ids.space, message: 'I work here now' });
    expect(r.requested).toBe(true);
    expect((await call(ids.gina, 'getMembershipRequestState', { spaceId: ids.space })).requested).toBe(true);
    await call(ids.alice, 'resolveMemberRequest', { spaceId: ids.space, requestId: r.requestId, approve: false });
    expect(space().permissions.some((p: any) => p.user_id === ids.gina)).toBe(false);
    const inbox = notificationsOf(ids.alice, 'space_member_requested').find((n) => n.activity?.request_id_ws === r.requestId);
    expect(inbox.activity.status).toBe('denied');
  });
});

describe('restricted members on pages', () => {
  it('"Any member with admin approval": members request access for restricted members, owners approve', async () => {
    db.putRecord('space', { ...space(), plan_type: 'enterprise' });
    const seed = await import('../src/seed.ts');
    ids.rita = newId();
    seed.createUser(ids.rita, 'rita@member.test', 'Rita');
    seed.addMember(ids.space, ids.rita, 'restricted_member');
    // Bob (member) owns a page and wants to share it with Rita
    ids.bobPage = newId();
    const now = Date.now();
    db.putRecord('block', {
      id: ids.bobPage, version: 1, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true,
      properties: { title: [['Bob plans']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.bob }], created_time: now, created_by_id: ids.bob, last_edited_time: now,
    } as any);
    const sharing = await call(ids.bob, 'getPageSharing', { pageId: ids.bobPage });
    expect(sharing.restrictedIds).toContain(ids.rita);
    expect(sharing.restrictedAddProblem).toMatch(/workspace owner must approve/);
    expect(await status(() => call(ids.bob, 'invitePagePermissions', { pageId: ids.bobPage, userIds: [ids.rita], role: 'reader' }))).toBe(403);
    expect(await status(() => call(ids.bob, 'requestRestrictedMemberAccess', { pageId: ids.bobPage, userIds: [ids.carl], role: 'reader' }))).toBe(400);
    const r = await call(ids.bob, 'requestRestrictedMemberAccess', { pageId: ids.bobPage, userIds: [ids.rita], role: 'reader' });
    expect(r.requested).toBe(true);
    const inbox = notificationsOf(ids.alice, 'access_requested').find((n) => n.activity?.request_id === r.requestId);
    expect(inbox.activity).toMatchObject({ restricted: true, for_emails: ['rita@member.test'], kind: 'guest_invite' });
    const list = await call(ids.alice, 'getWorkspaceRequests', { spaceId: ids.space });
    expect(list.requests.find((x: any) => x.id === r.requestId)?.restricted).toBe(true);
    expect(await status(() => call(ids.bob, 'decideAccessRequest', { requestId: r.requestId, approve: true }))).toBe(403);
    await call(ids.alice, 'decideAccessRequest', { requestId: r.requestId, approve: true });
    const page = db.getRecord<any>('block', ids.bobPage)!;
    expect(page.permissions.some((p: any) => p.user_id === ids.rita && p.role === 'reader')).toBe(true);
    // "Any member": no request needed
    setSpaceSettings({ restricted_members_pages: 'member' });
    expect((await call(ids.bob, 'requestRestrictedMemberAccess', { pageId: ids.bobPage, userIds: [ids.rita] })).allowed).toBe(true);
  });
});

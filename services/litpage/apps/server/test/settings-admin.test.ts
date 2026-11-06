// Settings › security / account / admin: workspace policy enforcement per toggle (policy.ts + authz.ts
// hooks), two-step authentication (TOTP, backup codes, login step), password rules, secondary emails, account
// deletion safeguards, and the audit log / analytics / content search authorization (owners of Enterprise workspaces).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-settings-admin-test-'));
delete process.env.NC_DEV_LOGIN_CODES;

// password hashing (scrypt) is slow when the whole suite runs in parallel
vi.setConfig({ testTimeout: 30_000 });

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let records: typeof import('../src/records.ts');
let mfa: typeof import('../src/mfa.ts');
let policy: typeof import('../src/policy.ts');
let mail: typeof import('../src/mail.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const cookies: string[] = [];
const ctx = (userId: string | null, extra: Record<string, unknown> = {}) => ({ userId, ip: '127.0.0.1', setCookie: (c: string) => cookies.push(c), ...extra });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function tx(user: string, operations: any[], spaceId = ids.space) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
}

function page(id: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}, spaceId = ids.space, user = ids.owner) {
  const now = Date.now();
  return {
    id, version: 1, type: 'page', properties: { title: [[`Page ${id.slice(0, 4)}`]] }, parent_id: parentId, parent_table: parentTable, space_id: spaceId,
    alive: true, created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user, ...extra,
  };
}

function setSpace(patch: Record<string, unknown>, settings?: Record<string, unknown>) {
  const s = db.getRecord<any>('space', ids.space)!;
  db.putRecord('space', { ...s, ...patch, settings: { ...(s.settings ?? {}), ...(settings ?? {}) } });
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts'); // merges api/modules handlers (account, admin, workspace…)
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  records = await import('../src/records.ts');
  mfa = await import('../src/mfa.ts');
  policy = await import('../src/policy.ts');
  mail = await import('../src/mail.ts');

  for (const n of ['owner', 'admin', 'member', 'guest', 'outsider', 'solo']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@set.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  ids.team = w.team.id;
  ids.ownerPrivate = w.spaceView.private_pages[0];
  seed.addMember(ids.space, ids.admin, 'membership_admin');
  seed.addMember(ids.space, ids.member, 'editor');
  const other = seed.createWorkspace(ids.outsider, 'Other');
  ids.otherSpace = other.space.id;
  const solo = seed.createWorkspace(ids.solo, 'Solo');
  ids.soloSpace = solo.space.id;

  // a page shared with the member (full access) inside the workspace section
  ids.shared = newId();
  db.putRecord('block', page(ids.shared, ids.space, 'space', {
    permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.member }],
  }) as any);
});

describe('TOTP (RFC 4226 / 6238)', () => {
  it('matches the RFC 4226 HOTP test vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, i) => expect(mfa.hotp(secret, i)).toBe(code));
  });
  it('round-trips base32 and accepts ±1 step only once per step', () => {
    const secret = mfa.base32Encode(Buffer.from('12345678901234567890'));
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(mfa.base32Decode(secret).toString()).toBe('12345678901234567890');
    // RFC 6238 SHA-1 vector: T = 59 s → 94287082 (8 digits) → last 6 digits
    expect(mfa.totp(secret, 59_000)).toBe('287082');
    const now = 1_700_000_000_000;
    const code = mfa.totp(secret, now);
    expect(mfa.matchTotp(secret, code, 0, now)).toBe(mfa.totpStep(now));
    expect(mfa.matchTotp(secret, code, 0, now + 30_000)).toBe(mfa.totpStep(now)); // previous step still OK
    expect(mfa.matchTotp(secret, code, 0, now + 90_000)).toBeNull(); // too old
    expect(mfa.matchTotp(secret, code, mfa.totpStep(now), now)).toBeNull(); // replay of a used step
    expect(mfa.matchTotp(secret, '12345', 0, now)).toBeNull();
  });
});

describe('password rules and changes', () => {
  it('enforces Litpage password rules and requires the current password to change it', async () => {
    expect(policy.passwordProblem('short1')).toMatch(/longer/);
    expect(policy.passwordProblem('aaaaaaaa1')).toMatch(/4 different/);
    expect(policy.passwordProblem('abcdefgh')).toMatch(/letters and numbers/);
    expect(policy.passwordProblem('correct horse battery')).toBeNull(); // 15+ characters: no mix needed
    expect(await status(() => call(ids.member, 'changePassword', { password: 'abcdefgh' }))).toBe(400);
    expect(await status(() => call(ids.member, 'changePassword', { password: 'Secret123' }))).toBe(200);
    expect(await status(() => call(ids.member, 'changePassword', { password: 'Other4567' }))).toBe(401); // no current password
    expect(await status(() => call(ids.member, 'changePassword', { password: 'Other4567', currentPassword: 'wrong' }))).toBe(401);
    expect(await status(() => call(ids.member, 'changePassword', { password: 'Other4567', currentPassword: 'Secret123' }))).toBe(200);
    expect(await status(() => call(ids.member, 'removePassword', { currentPassword: 'nope' }))).toBe(401);
    expect(await status(() => call(ids.member, 'removePassword', { currentPassword: 'Other4567' }))).toBe(200);
    expect((await call(ids.member, 'hasPassword')).hasPassword).toBe(false);
  });
});

describe('two-step authentication', () => {
  let secret = '';
  let backup: string[] = [];
  it('needs a password, then enrolls an authenticator and returns 6 backup codes once', async () => {
    expect(await status(() => call(ids.admin, 'startTotpEnrollment'))).toBe(400);
    await call(ids.admin, 'changePassword', { password: 'Admin12345' });
    const start = await call(ids.admin, 'startTotpEnrollment');
    expect(start.uri).toMatch(/^otpauth:\/\/totp\/Litpage%3Aadmin%40set\.test\?secret=/);
    secret = start.secret;
    expect(await status(() => call(ids.admin, 'completeTotpEnrollment', { enrollmentId: start.enrollmentId, name: 'Phone', code: '000000' }))).toBe(400);
    expect(await status(() => call(ids.admin, 'completeTotpEnrollment', { enrollmentId: start.enrollmentId, name: '', code: mfa.totp(secret) }))).toBe(400);
    const done = await call(ids.admin, 'completeTotpEnrollment', { enrollmentId: start.enrollmentId, name: 'Phone', code: mfa.totp(secret) });
    expect(done.backupCodes).toHaveLength(6);
    backup = done.backupCodes;
    const sec = await call(ids.admin, 'getAccountSecurity');
    expect(sec.mfa.enabled).toBe(true);
    expect(sec.mfa.factors.map((f: any) => f.name)).toEqual(['Phone']);
    expect(sec.mfa.backupCodesRemaining).toBe(6);
    // a second authenticator needs a code from the first one
    expect(await status(() => call(ids.admin, 'startTotpEnrollment', { code: '111111' }))).toBe(401);
  });
  it('asks for a code at login: no session until loginWithMfa succeeds; codes are single-use', async () => {
    cookies.length = 0;
    const first = await call(null, 'signInWithEmail', { email: 'admin@set.test', password: 'Admin12345' });
    expect(first.mfaRequired).toBe(true);
    expect(first.factors.map((f: any) => f.name)).toEqual(['Phone']);
    expect(cookies.some((c) => c.startsWith('lit_session=') && !c.startsWith('lit_session=;'))).toBe(false);
    expect(await status(() => call(null, 'loginWithMfa', { mfaToken: first.mfaToken, code: '000000' }))).toBe(401);
    expect(await status(() => call(null, 'loginWithMfa', { mfaToken: 'bogus', code: '000000' }))).toBe(400);
    const ok = await call(null, 'loginWithMfa', { mfaToken: first.mfaToken, code: backup[0] });
    expect(ok.userId).toBe(ids.admin);
    expect(ok.backupCodesRemaining).toBe(5);
    expect(cookies.some((c) => /^lit_session=[0-9a-f]{64};/.test(c))).toBe(true);
    // the same backup code can't be used again; the challenge token is single-use too
    const second = await call(null, 'signInWithEmail', { email: 'admin@set.test', password: 'Admin12345' });
    expect(await status(() => call(null, 'loginWithMfa', { mfaToken: second.mfaToken, code: backup[0], method: 'backup' }))).toBe(401);
    expect(await status(() => call(null, 'loginWithMfa', { mfaToken: first.mfaToken, code: backup[1] }))).toBe(400);
    // five wrong codes lock the challenge
    const third = await call(null, 'signInWithEmail', { email: 'admin@set.test', password: 'Admin12345' });
    for (let i = 0; i < 5; i++) await status(() => call(null, 'loginWithMfa', { mfaToken: third.mfaToken, code: '000000' }));
    expect(await status(() => call(null, 'loginWithMfa', { mfaToken: third.mfaToken, code: backup[2] }))).toBe(429);
  });
  it('turning 2FA off needs a code; deleting the last authenticator turns it off', async () => {
    expect(await status(() => call(ids.admin, 'disableMfa', { code: '000000' }))).toBe(401);
    const factors = (await call(ids.admin, 'getAccountSecurity')).mfa.factors;
    const res = await call(ids.admin, 'deleteMfaFactor', { factorId: factors[0].id, code: backup[3], method: 'backup' });
    expect(res.enabled).toBe(false);
    expect((await call(ids.admin, 'getAccountSecurity')).mfa.backupCodesRemaining).toBe(0);
    const login = await call(null, 'signInWithEmail', { email: 'admin@set.test', password: 'Admin12345' });
    expect(login.mfaRequired).toBeUndefined();
  });
});

describe('secondary emails', () => {
  it('verifies, logs in to the same account, makes primary and refuses addresses of other accounts', async () => {
    expect(await status(() => call(ids.member, 'addSecondaryEmail', { email: 'owner@set.test' }))).toBe(400);
    await call(ids.member, 'addSecondaryEmail', { email: 'alias@set.test' });
    const msg = mail.listMail({ to: 'alias@set.test' })[0];
    const code = /\b(\d{6})\b/.exec(msg.text)![1];
    expect(await status(() => call(ids.member, 'verifySecondaryEmail', { email: 'alias@set.test', code: '000000' }))).toBe(401);
    const res = await call(ids.member, 'verifySecondaryEmail', { email: 'alias@set.test', code });
    expect(res.emails.map((e: any) => e.email)).toEqual(['member@set.test', 'alias@set.test']);
    expect(db.findUserIdByEmail('alias@set.test')).toBe(ids.member);
    await call(ids.member, 'makeEmailPrimary', { email: 'alias@set.test' });
    expect(db.getRecord<any>('lit_user', ids.member)!.email).toBe('alias@set.test');
    expect(db.findUserIdByEmail('member@set.test')).toBe(ids.member);
    await call(ids.member, 'makeEmailPrimary', { email: 'member@set.test' });
    await call(ids.member, 'removeSecondaryEmail', { email: 'alias@set.test' });
    expect(db.findUserIdByEmail('alias@set.test')).toBeNull();
  });
});

describe('workspace security policy (server-enforced)', () => {
  it('Disable publishing: no new public links / sites, existing links stop working', async () => {
    const pub = [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.member }, { type: 'public_permission', role: 'reader' }];
    setSpace({ disable_public_access: true });
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'block', id: ids.shared }, path: ['permissions'], command: 'set', args: pub }]))).toBe(403);
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'block', id: ids.shared }, path: ['permissions'], command: 'set', args: pub }]))).toBe(403);
    setSpace({ disable_public_access: false });
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'block', id: ids.shared }, path: ['permissions'], command: 'set', args: pub }]))).toBe(200);
    expect(records.blockRole(ids.shared, null)).toBe('reader');
    setSpace({ disable_public_access: true });
    expect(records.blockRole(ids.shared, null)).toBe('none');
    // narrowing access is still allowed while publishing is disabled
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'block', id: ids.shared }, path: ['permissions'], command: 'set', args: pub.slice(0, 2) }]))).toBe(200);
    setSpace({ disable_public_access: false });
  });
  it('Allow members to invite guests (off): members can’t add non-members, owners still can', async () => {
    setSpace({ disable_guests: true });
    expect(await status(() => call(ids.member, 'invitePagePermissions', { pageId: ids.shared, emails: ['guest@set.test'], role: 'reader' }))).toBe(403);
    expect(await status(() => call(ids.owner, 'invitePagePermissions', { pageId: ids.shared, emails: ['guest@set.test'], role: 'reader' }))).toBe(200);
    // adding a workspace member is not a guest invite
    expect(await status(() => call(ids.member, 'invitePagePermissions', { pageId: ids.shared, userIds: [ids.admin], role: 'reader' }))).toBe(200);
    setSpace({ disable_guests: false });
    expect(await status(() => call(ids.member, 'invitePagePermissions', { pageId: ids.shared, emails: ['guest2@set.test'], role: 'reader' }))).toBe(200);
  });
  it('Restrict team creation to workspace owners', async () => {
    const team = (id: string, user: string) => ({
      id, space_id: ids.space, name: 'New team', team_pages: [], parent_id: ids.space, parent_table: 'space', alive: true,
      membership: [{ user_id: user, role: 'owner', added_time: Date.now() }], settings: { type: 'open' }, created_time: Date.now(), created_by_id: user,
    });
    setSpace({}, { limit_team_creation: true });
    const t1 = newId();
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'team', id: t1 }, path: [], command: 'set', args: team(t1, ids.member) }]))).toBe(403);
    expect(await status(() => tx(ids.admin, [{ pointer: { table: 'team', id: t1 }, path: [], command: 'set', args: team(t1, ids.admin) }]))).toBe(403);
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'team', id: t1 }, path: [], command: 'set', args: team(t1, ids.owner) }]))).toBe(200);
    setSpace({}, { limit_team_creation: false });
    const t2 = newId();
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'team', id: t2 }, path: [], command: 'set', args: team(t2, ids.member) }]))).toBe(200);
  });
  it('Disable export: members can’t export, owners can', async () => {
    setSpace({ disable_export: true });
    expect(await status(() => call(ids.member, 'startPageExport', { blockId: ids.shared, format: 'markdown' }))).toBe(403);
    expect(await status(() => call(ids.owner, 'startPageExport', { blockId: ids.shared, format: 'markdown' }))).toBe(200);
    setSpace({ disable_export: false });
    expect(await status(() => call(ids.member, 'startPageExport', { blockId: ids.shared, format: 'markdown' }))).toBe(200);
  });
  it('Block page copies to other workspaces', async () => {
    seed.addMember(ids.otherSpace, ids.member, 'editor');
    setSpace({}, { disable_move_to_space: true });
    expect(await status(() => call(ids.member, 'duplicateBlock', { blockId: ids.shared, parentId: ids.otherSpace, parentTable: 'space' }))).toBe(403);
    // duplicating inside the same workspace is fine
    expect(await status(() => call(ids.member, 'duplicateBlock', { blockId: ids.shared }))).toBe(200);
    setSpace({}, { disable_move_to_space: false });
    expect(await status(() => call(ids.member, 'duplicateBlock', { blockId: ids.shared, parentId: ids.otherSpace, parentTable: 'space' }))).toBe(200);
  });
  it('Save and display page view analytics (off): views are not stored', async () => {
    setSpace({}, { page_view_analytics: false });
    expect((await call(ids.member, 'recordPageView', { pageId: ids.shared })).recorded).toBe(false);
    expect((await call(ids.member, 'getPageStats', { pageId: ids.shared })).analyticsDisabled).toBe(true);
    setSpace({}, { page_view_analytics: true });
    expect((await call(ids.member, 'recordPageView', { pageId: ids.shared })).recorded).toBe(true);
  });
  it('member requests follow "Allow members to request to add other members"', async () => {
    setSpace({}, { allow_member_requests: false });
    expect(await status(() => call(ids.member, 'requestMembers', { spaceId: ids.space, emails: ['new@set.test'] }))).toBe(403);
    setSpace({}, { allow_member_requests: true });
    expect(await status(() => call(ids.member, 'requestMembers', { spaceId: ids.space, emails: ['new@set.test'] }))).toBe(200);
  });
  it('Keep members from editing the Workspace section', async () => {
    const top = newId();
    const mk = (user: string) => [
      { pointer: { table: 'block', id: top }, path: [], command: 'set', args: page(top, ids.space, 'space', {}, ids.space, user) },
      { pointer: { table: 'space', id: ids.space }, path: ['pages'], command: 'listAfter', args: { id: top } },
    ];
    setSpace({}, { disable_space_page_edits: true });
    expect(await status(() => tx(ids.member, mk(ids.member)))).toBe(403);
    expect(await status(() => tx(ids.admin, mk(ids.admin)))).toBe(200);
    setSpace({}, { disable_space_page_edits: false });
    const top2 = newId();
    expect(await status(() => tx(ids.member, [
      { pointer: { table: 'block', id: top2 }, path: [], command: 'set', args: page(top2, ids.space, 'space', {}, ids.space, ids.member) },
      { pointer: { table: 'space', id: ids.space }, path: ['pages'], command: 'listAfter', args: { id: top2 } },
    ]))).toBe(200);
  });
  it('teamspace permissions: who can invite members, who can edit the sidebar, overriding workspace security', async () => {
    const team = newId();
    seed.saveRecord('team', {
      id: team, version: 0, space_id: ids.space, name: 'Closed team', team_pages: [], parent_id: ids.space, parent_table: 'space', alive: true,
      membership: [{ user_id: ids.owner, role: 'owner', added_time: Date.now() }, { user_id: ids.member, role: 'member', added_time: Date.now() }],
      settings: { type: 'closed', default_page_role: 'editor', invite_access: 'owners' }, created_time: Date.now(), created_by_id: ids.owner,
    } as any);
    const cur = () => db.getRecord<any>('team', team)!;
    const add = (user: string) => tx(user, [{ pointer: { table: 'team', id: team }, path: ['membership'], command: 'set', args: [...cur().membership, { user_id: ids.admin, role: 'member', added_time: Date.now() }] }]);
    expect(await status(() => add(ids.member))).toBe(403);
    db.putRecord('team', { ...cur(), settings: { ...cur().settings, invite_access: 'members' } });
    expect(await status(() => add(ids.member))).toBe(200);
    // members can't promote themselves or remove owners
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'team', id: team }, path: ['membership'], command: 'set', args: cur().membership.map((m: any) => ({ ...m, role: 'owner' })) }]))).toBe(403);
    // sidebar editing
    const p1 = newId();
    db.putRecord('block', page(p1, team, 'team') as any);
    db.putRecord('team', { ...cur(), settings: { ...cur().settings, sidebar_edit: 'owners' } });
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'team', id: team }, path: ['team_pages'], command: 'listAfter', args: { id: p1 } }]))).toBe(403);
    db.putRecord('team', { ...cur(), settings: { ...cur().settings, sidebar_edit: 'members' } });
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'team', id: team }, path: ['team_pages'], command: 'listAfter', args: { id: p1 } }]))).toBe(200);
    // overriding the workspace's Disable export for this teamspace needs a workspace owner
    setSpace({ disable_export: true });
    db.putRecord('team', { ...cur(), membership: [...cur().membership.filter((m: any) => m.user_id !== ids.admin), { user_id: ids.admin, role: 'owner', added_time: Date.now() }] });
    expect(await status(() => tx(ids.admin, [{ pointer: { table: 'team', id: team }, path: ['settings'], command: 'update', args: { disable_export: false } }]))).toBe(403);
    expect(await status(() => call(ids.member, 'startPageExport', { blockId: p1, format: 'markdown' }))).toBe(403);
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'team', id: team }, path: ['settings'], command: 'update', args: { disable_export: false } }]))).toBe(200);
    expect(await status(() => call(ids.member, 'startPageExport', { blockId: p1, format: 'markdown' }))).toBe(200);
    setSpace({ disable_export: false });
  });
  it('settings writes stay admin-only', async () => {
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'space', id: ids.space }, path: ['settings'], command: 'update', args: { limit_team_creation: true } }]))).toBe(403);
    expect(await status(() => tx(ids.member, [{ pointer: { table: 'space', id: ids.space }, path: [], command: 'update', args: { disable_export: true } }]))).toBe(403);
    // membership admins manage members and groups only (owner-only workspace settings, policy.ts)
    expect(await status(() => tx(ids.admin, [{ pointer: { table: 'space', id: ids.space }, path: ['settings'], command: 'update', args: { limit_team_creation: true } }]))).toBe(403);
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'space', id: ids.space }, path: ['settings'], command: 'update', args: { limit_team_creation: true } }]))).toBe(200);
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'space', id: ids.space }, path: ['settings'], command: 'update', args: { limit_team_creation: false } }]))).toBe(200);
  });
});

describe('audit log, analytics and content search authorization', () => {
  it('only owners of Enterprise workspaces can read the audit log', async () => {
    expect(await status(() => call(ids.member, 'getAuditLog', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.admin, 'getAuditLog', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.outsider, 'getAuditLog', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.owner, 'getAuditLog', { spaceId: ids.space }))).toBe(403); // Plus plan
    await call(ids.owner, 'changePlan', { spaceId: ids.space, plan: 'enterprise' });
    // security toggles flipped through the settings UI path (transactions) are audited
    for (const v of [true, false]) {
      await tx(ids.owner, [{ pointer: { table: 'space', id: ids.space }, path: [], command: 'update', args: { disable_export: v, disable_public_access: v } }]);
    }
    const log = await call(ids.owner, 'getAuditLog', { spaceId: ids.space, limit: 200 });
    const events = new Set(log.entries.map((e: any) => e.event));
    for (const ev of ['team_created', 'page_permission_updated', 'page_shared_to_web', 'export_toggled', 'public_page_sharing_toggled', 'team_creation_admins_setting_toggled', 'password_set', 'mfa_totp_toggled', 'login']) {
      expect(events.has(ev), ev).toBe(true);
    }
    // nothing from other workspaces
    expect(log.entries.every((e: any) => !e.data?.spaceId || e.data.spaceId === ids.space)).toBe(true);
    expect(await status(() => call(ids.member, 'getAuditLog', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.owner, 'getAuditLog', { spaceId: ids.otherSpace }))).toBe(403);
  });
  it('filters by event, person and request, and exports CSV', async () => {
    const pw = await call(ids.owner, 'getAuditLog', { spaceId: ids.space, events: ['password_set'] });
    expect(pw.entries.length).toBeGreaterThan(0);
    expect(pw.entries.every((e: any) => e.event === 'password_set')).toBe(true);
    const byMember = await call(ids.owner, 'getAuditLog', { spaceId: ids.space, actorIds: [ids.member] });
    expect(byMember.entries.every((e: any) => e.actorId === ids.member)).toBe(true);
    const small = await call(ids.owner, 'getAuditLog', { spaceId: ids.space, limit: 2 });
    expect(small.entries).toHaveLength(2);
    const next = await call(ids.owner, 'getAuditLog', { spaceId: ids.space, limit: 2, cursor: small.nextCursor });
    expect(next.entries[0].id).not.toBe(small.entries[0].id);
    const exp = await call(ids.owner, 'downloadAuditLog', { spaceId: ids.space });
    expect(exp.url).toMatch(/^\/files\//);
    expect(exp.count).toBeGreaterThan(0);
    expect(await status(() => call(ids.member, 'downloadAuditLog', { spaceId: ids.space }))).toBe(403);
    const after = await call(ids.owner, 'getAuditLog', { spaceId: ids.space, events: ['audit_log_exported'] });
    expect(after.entries).toHaveLength(1);
  });
  it('analytics: owners see every tab, members only Content (pages they can open)', async () => {
    expect(await status(() => call(ids.member, 'getWorkspaceAnalytics', { spaceId: ids.space, tab: 'members' }))).toBe(403);
    const content = await call(ids.member, 'getWorkspaceAnalytics', { spaceId: ids.space, tab: 'content' });
    expect(content.pages.some((p: any) => p.pageId === ids.ownerPrivate)).toBe(false);
    expect(content.pages.some((p: any) => p.pageId === ids.shared)).toBe(true);
    const membersTab = await call(ids.owner, 'getWorkspaceAnalytics', { spaceId: ids.space, tab: 'members' });
    expect(membersTab.members.find((m: any) => m.userId === ids.member).pageViews).toBeGreaterThan(0);
    // opting out of view history hides a member's views
    db.putRecord('user_settings', { ...db.getRecord<any>('user_settings', ids.member)!, settings: { page_view_history: 'deny' } });
    const hidden = await call(ids.owner, 'getWorkspaceAnalytics', { spaceId: ids.space, tab: 'members' });
    expect(hidden.members.find((m: any) => m.userId === ids.member)).toMatchObject({ optedOut: true, pageViews: null });
    const overview = await call(ids.owner, 'getWorkspaceAnalytics', { spaceId: ids.space, tab: 'overview' });
    expect(overview.totals.members).toBe(3);
  });
  it('content search: owner-only, finds private pages, restores and permanently deletes trashed pages', async () => {
    expect(await status(() => call(ids.member, 'searchContentAsAdmin', { spaceId: ids.space }))).toBe(403);
    const all = await call(ids.owner, 'searchContentAsAdmin', { spaceId: ids.space });
    expect(all.rows.some((r: any) => r.pageId === ids.shared)).toBe(true);
    // a member's private page is visible to the owner's content search (titles only)
    const mine = newId();
    db.putRecord('block', page(mine, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.member }], properties: { title: [['Member diary']] } }, ids.space, ids.member) as any);
    const found = await call(ids.owner, 'searchContentAsAdmin', { spaceId: ids.space, query: mine });
    expect(found.rows[0]).toMatchObject({ pageId: mine, audience: 'private', title: 'Member diary' });
    // trash → restore to original location → trash again → permanent delete
    await tx(ids.member, [{ pointer: { table: 'block', id: mine }, path: [], command: 'update', args: { alive: false } }]);
    const trash = await call(ids.owner, 'searchContentAsAdmin', { spaceId: ids.space, status: 'trash' });
    expect(trash.rows.some((r: any) => r.pageId === mine)).toBe(true);
    await call(ids.owner, 'adminRestorePage', { spaceId: ids.space, pageId: mine });
    expect(db.getRecord<any>('block', mine)!.alive).toBe(true);
    expect(await status(() => call(ids.owner, 'adminDeletePagePermanently', { spaceId: ids.space, pageId: mine }))).toBe(400);
    await tx(ids.member, [{ pointer: { table: 'block', id: mine }, path: [], command: 'update', args: { alive: false } }]);
    await call(ids.owner, 'adminDeletePagePermanently', { spaceId: ids.space, pageId: mine });
    expect(db.getRecord('block', mine)).toBeUndefined();
  });
});

describe('data retention and support access expiry', () => {
  it('Trash auto-deletion keeps a retained copy that owners can restore', async () => {
    const retention = await import('../src/retention.ts');
    setSpace({ plan_type: 'enterprise' }, { trash_retention_days: 1, purge_retention_days: 30 });
    const old = newId();
    db.putRecord('block', page(old, ids.space, 'space', {
      alive: false, deleted_time: Date.now() - 2 * 86_400_000, properties: { title: [['Old trash']] },
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }],
    }) as any);
    const fresh = newId();
    db.putRecord('block', page(fresh, ids.space, 'space', { alive: false, deleted_time: Date.now() - 3_600_000, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }] }) as any);
    const res = retention.runRetention();
    expect(res.trashed).toBeGreaterThanOrEqual(1);
    expect(db.getRecord('block', old)).toBeUndefined();
    expect(db.getRecord('block', fresh)).toBeTruthy(); // still inside the window
    const retained = await call(ids.owner, 'searchContentAsAdmin', { spaceId: ids.space, status: 'retained' });
    const row = retained.rows.find((r: any) => r.pageId === old);
    expect(row).toMatchObject({ title: 'Old trash', retained: true });
    expect(await status(() => call(ids.member, 'adminRestoreRetained', { spaceId: ids.space, retainedId: row.retainedId }))).toBe(403);
    await call(ids.owner, 'adminRestoreRetained', { spaceId: ids.space, retainedId: row.retainedId });
    expect(db.getRecord<any>('block', old)!.alive).toBe(true);
    setSpace({}, { trash_retention_days: null, purge_retention_days: null });
  });
  it('every plan empties Trash after 30 days (the Enterprise setting only changes the number)', async () => {
    const retention = await import('../src/retention.ts');
    const solo = db.getRecord<any>('space', ids.soloSpace)!;
    expect(solo.plan_type).not.toBe('enterprise');
    expect(retention.trashRetentionDays(solo)).toBe(30);
    const mk = (days: number) => {
      const id = newId();
      db.putRecord('block', page(id, ids.soloSpace, 'space', { alive: false, deleted_time: Date.now() - days * 86_400_000, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.solo }] }, ids.soloSpace, ids.solo) as any);
      return id;
    };
    const month = mk(31);
    const week = mk(7);
    // a custom value on a non-Enterprise workspace is ignored
    db.putRecord('space', { ...solo, settings: { ...(solo.settings ?? {}), trash_retention_days: 3 } });
    retention.runRetention();
    expect(db.getRecord('block', month)).toBeUndefined();
    expect(db.getRecord('block', week)).toBeTruthy();
    db.putRecord('space', solo);
  });
  it('workspace and account support access switch off after 28 days', async () => {
    const retention = await import('../src/retention.ts');
    setSpace({}, { support_access: true, support_access_granted_time: Date.now() - 29 * 86_400_000 });
    const us = db.getRecord<any>('user_settings', ids.member)!;
    db.putRecord('user_settings', { ...us, settings: { ...(us.settings ?? {}), support_access: true, support_access_granted_time: Date.now() - 86_400_000 } });
    expect(retention.expireSupportAccess()).toBe(1);
    expect((db.getRecord<any>('space', ids.space)!.settings as any).support_access).toBe(false);
    expect(db.getRecord<any>('user_settings', ids.member)!.settings.support_access).toBe(true); // granted yesterday
  });
});

describe('people: guests, groups, temporary members, recently left', () => {
  it('upgrades guests to members (admins only)', async () => {
    const g = newId();
    seed.createUser(g, 'guesty@set.test', 'Guesty');
    expect(await status(() => call(ids.member, 'upgradeGuests', { spaceId: ids.space, userIds: [g] }))).toBe(403);
    const res = await call(ids.owner, 'upgradeGuests', { spaceId: ids.space, userIds: [g] });
    expect(res.userIds).toEqual([g]);
    expect(db.getRecord<any>('space', ids.space)!.permissions.some((p: any) => p.user_id === g && p.role === 'editor')).toBe(true);
    await call(ids.owner, 'removeMember', { spaceId: ids.space, userId: g });
  });
  it('groups: members create when allowed, group owners manage, others can’t', async () => {
    setSpace({}, { restrict_group_creation: true });
    expect(await status(() => call(ids.member, 'createGroup', { spaceId: ids.space, name: 'Design' }))).toBe(403);
    setSpace({}, { restrict_group_creation: false });
    const { group } = await call(ids.member, 'createGroup', { spaceId: ids.space, name: 'Design', memberIds: [ids.member, ids.outsider] });
    expect(group.member_ids).toEqual([ids.member]); // non-members are dropped
    expect(await status(() => call(ids.admin, 'updateGroup', { spaceId: ids.space, groupId: group.id, name: 'Admins rename' }))).toBe(200); // membership admin
    const other = newId();
    seed.createUser(other, 'other@set.test', 'Other');
    seed.addMember(ids.space, other, 'editor');
    expect(await status(() => call(other, 'updateGroup', { spaceId: ids.space, groupId: group.id, name: 'Hijack' }))).toBe(403);
    await call(ids.member, 'updateGroup', { spaceId: ids.space, groupId: group.id, memberIds: [ids.member, other], ownerIds: [ids.member, other] });
    expect(await status(() => call(other, 'updateGroup', { spaceId: ids.space, groupId: group.id, name: 'Now mine too' }))).toBe(200);
    expect(await status(() => call(other, 'deleteGroup', { spaceId: ids.space, groupId: group.id }))).toBe(200);
    await call(ids.owner, 'removeMember', { spaceId: ids.space, userId: other });
  });
  it('temporary members expire; recently-left members’ private pages can be transferred', async () => {
    const temp = newId();
    seed.createUser(temp, 'temp@set.test', 'Temp');
    seed.addMember(ids.space, temp, 'editor');
    expect(await status(() => call(ids.admin, 'setMemberExpiration', { spaceId: ids.space, userId: temp, expiry: Date.now() + 86_400_000 }))).toBe(403);
    await call(ids.owner, 'setMemberExpiration', { spaceId: ids.space, userId: temp, expiry: Date.now() + 86_400_000 });
    const ws = await import('../src/api/modules/workspace.ts');
    expect(ws.expireTemporaryMembers(Date.now())).toBe(0);
    // a private page of the temporary member, then the membership runs out
    const priv = newId();
    db.putRecord('block', page(priv, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: temp }] }, ids.space, temp) as any);
    expect(ws.expireTemporaryMembers(Date.now() + 2 * 86_400_000)).toBe(1);
    expect(db.getRecord<any>('space', ids.space)!.permissions.some((p: any) => p.user_id === temp)).toBe(false);
    const left = await call(ids.owner, 'getRecentlyLeft', { spaceId: ids.space });
    expect(left.people.find((p: any) => p.userId === temp)).toMatchObject({ privatePages: 1 });
    expect(await status(() => call(ids.member, 'transferPrivatePages', { spaceId: ids.space, fromUserId: temp, toUserId: ids.member }))).toBe(403);
    await call(ids.owner, 'transferPrivatePages', { spaceId: ids.space, fromUserId: temp, toUserId: ids.member });
    expect(records.blockRole(priv, ids.member)).toBe('editor');
    expect(records.blockRole(priv, temp)).toBe('none');
  });
});

describe('restricted members (Enterprise)', () => {
  it('see only what is shared with them; owners decide who adds them to teamspaces and pages', async () => {
    const perms = await import('@nc/shared/permissions.ts');
    const rid = newId();
    seed.createUser(rid, 'restricted@set.test', 'Restricted');
    seed.addMember(ids.space, rid, 'editor');
    // Enterprise only
    const plan = db.getRecord<any>('space', ids.space)!.plan_type;
    setSpace({ plan_type: 'business' });
    expect(await status(() => call(ids.owner, 'setMemberRole', { spaceId: ids.space, userId: rid, role: 'restricted_member' }))).toBe(403);
    setSpace({ plan_type: 'enterprise' });
    await call(ids.owner, 'setMemberRole', { spaceId: ids.space, userId: rid, role: 'restricted_member' });
    const space = () => db.getRecord<any>('space', ids.space)!;
    expect(perms.isSpaceMember(space(), rid)).toBe(true);
    expect(perms.isRestrictedMember(space(), rid)).toBe(true);

    // workspace-level page (no explicit permissions) and an "Everyone at workspace" page: members yes, restricted no
    const wsPage = newId();
    db.putRecord('block', page(wsPage, ids.space, 'space') as any);
    const everyone = newId();
    db.putRecord('block', page(everyone, ids.space, 'space', { permissions: [{ type: 'space_permission', role: 'read_and_write' }] }) as any);
    expect(records.blockRole(wsPage, ids.member)).toBe('editor');
    expect(records.blockRole(wsPage, rid)).toBe('none');
    expect(records.blockRole(everyone, ids.member)).toBe('read_and_write');
    expect(records.blockRole(everyone, rid)).toBe('none');

    // open teamspace they're not in: hidden, no join, no access
    const team = () => db.getRecord<any>('team', ids.team)!;
    db.putRecord('team', { ...team(), membership: team().membership.filter((m: any) => m.user_id !== rid) }); // addMember joins default teamspaces
    const tp = newId();
    db.putRecord('block', page(tp, ids.team, 'team') as any);
    expect(perms.teamVisibleTo(team(), space(), rid)).toBe(false);
    expect(perms.teamJoinMode(team(), space(), rid)).toBe('none');
    expect(records.blockRole(tp, rid)).toBe('none');
    // can't create teamspaces
    expect(policy.policyProblem(space(), 'create_teamspace', rid)).toBeTruthy();

    // Who can add restricted members to Teamspaces (default: workspace and teamspace owners)
    db.putRecord('team', { ...team(), membership: [...team().membership.filter((m: any) => m.user_id !== ids.member), { user_id: ids.member, role: 'member', added_time: Date.now() }], settings: { ...(team().settings ?? {}), invite_access: 'members', type: 'open' } });
    const addTo = (user: string, role = 'member') => tx(user, [{ pointer: { table: 'team', id: ids.team }, path: ['membership'], command: 'set', args: [...team().membership, { user_id: rid, role, added_time: Date.now() }] }]);
    expect(await status(() => addTo(ids.member))).toBe(403);
    expect(await status(() => addTo(ids.owner, 'owner'))).toBe(403); // never teamspace owners
    setSpace({}, { restricted_members_teamspaces: 'member' });
    expect(await status(() => addTo(ids.member))).toBe(200);
    expect(records.blockRole(tp, rid)).toBe('editor');
    expect(perms.teamVisibleTo(team(), space(), rid)).toBe(true);

    // Who can add restricted members to pages (default: any member with admin approval)
    const shareWith = (user: string, pageId: string) => tx(user, [{ pointer: { table: 'block', id: pageId }, path: ['permissions'], command: 'set', args: [...(db.getRecord<any>('block', pageId)!.permissions ?? []).filter((x: any) => x.user_id !== rid), { type: 'user_permission', role: 'reader', user_id: rid }] }]);
    expect(await status(() => shareWith(ids.member, ids.shared))).toBe(403);
    setSpace({}, { restricted_members_pages: 'space_owner' });
    expect(await status(() => shareWith(ids.member, ids.shared))).toBe(403);
    setSpace({}, { restricted_members_pages: 'member' });
    expect(await status(() => shareWith(ids.member, ids.shared))).toBe(200);
    expect(records.blockRole(ids.shared, rid)).toBe('reader');

    // guests can be upgraded straight to restricted members
    const g = newId();
    seed.createUser(g, 'guestie@set.test', 'Guestie');
    await call(ids.owner, 'upgradeGuests', { spaceId: ids.space, userIds: [g], role: 'restricted_member' });
    expect(perms.isRestrictedMember(space(), g)).toBe(true);

    await call(ids.owner, 'removeMember', { spaceId: ids.space, userId: rid });
    await call(ids.owner, 'removeMember', { spaceId: ids.space, userId: g });
    setSpace({ plan_type: plan }, { restricted_members_pages: null, restricted_members_teamspaces: null });
  });
});

describe('approved email domains', () => {
  it('owners add member domains; new sign-ups on them join automatically', async () => {
    expect(await status(() => call(ids.admin, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['set.test'] }))).toBe(403);
    expect(await status(() => call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['gmail.com'] }))).toBe(400);
    expect(await status(() => call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['elsewhere.org'] }))).toBe(400);
    await call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['set.test'] });
    const { autoJoinAllowedDomains } = await import('../src/domainJoin.ts');
    const fresh = newId();
    seed.createUser(fresh, 'newbie@set.test', 'Newbie');
    expect(autoJoinAllowedDomains(fresh, 'newbie@set.test')).toContain(ids.space);
    expect(db.getRecord<any>('space', ids.space)!.permissions.some((p: any) => p.user_id === fresh && p.role === 'editor')).toBe(true);
    await call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: [] });
    await call(ids.owner, 'removeMember', { spaceId: ids.space, userId: fresh });
  });

  it('"Request to join" files a member self request admins approve; "No access" does nothing', async () => {
    const { autoJoinAllowedDomains } = await import('../src/domainJoin.ts');
    await call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['set.test'] });
    setSpace({}, { allowed_email_domain_join: 'request' });
    const asker = newId();
    seed.createUser(asker, 'asker@set.test', 'Asker');
    expect(autoJoinAllowedDomains(asker, 'asker@set.test')).toEqual([]);
    const s1 = db.getRecord<any>('space', ids.space)!;
    expect(s1.permissions.some((p: any) => p.user_id === asker)).toBe(false);
    const req = (s1.settings.member_requests ?? []).find((r: any) => r.requested_by === asker);
    expect(req).toMatchObject({ emails: ['asker@set.test'], via: 'allowed_email_domain' });
    // admins get an Inbox item (notify.ts)
    const notes = db.db.prepare("SELECT data FROM records WHERE tbl = 'notification' AND data LIKE ?").all(`%${req.id}%`) as any[];
    expect(notes.length).toBeGreaterThan(0);
    await call(ids.owner, 'resolveMemberRequest', { spaceId: ids.space, requestId: req.id, approve: true });
    expect(db.getRecord<any>('space', ids.space)!.permissions.some((p: any) => p.user_id === asker && p.role === 'editor')).toBe(true);
    await call(ids.owner, 'removeMember', { spaceId: ids.space, userId: asker });

    setSpace({}, { allowed_email_domain_join: 'none' });
    const nobody = newId();
    seed.createUser(nobody, 'nobody@set.test', 'Nobody');
    expect(autoJoinAllowedDomains(nobody, 'nobody@set.test')).toEqual([]);
    const s2 = db.getRecord<any>('space', ids.space)!;
    expect(s2.permissions.some((p: any) => p.user_id === nobody)).toBe(false);
    expect((s2.settings.member_requests ?? []).some((r: any) => r.requested_by === nobody)).toBe(false);
    setSpace({}, { allowed_email_domain_join: 'auto' });
    await call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: [] });
  });
});

describe('profile discoverability', () => {
  it('invites show a name and photo only for people who allow it, without revealing who has an account', async () => {
    const r1 = await call(ids.owner, 'lookupInvitees', { spaceId: ids.space, emails: ['outsider@set.test', 'nobody-here@set.test'] });
    expect(r1.invitees).toEqual([{ email: 'outsider@set.test', name: 'Outsider' }, { email: 'nobody-here@set.test' }]);
    db.putRecord('user_settings', { id: ids.outsider, version: 1, settings: { ...(db.getRecord<any>('user_settings', ids.outsider)?.settings ?? {}), profile_discoverable: false } } as any);
    const r2 = await call(ids.owner, 'lookupInvitees', { spaceId: ids.space, emails: ['outsider@set.test'] });
    expect(r2.invitees).toEqual([{ email: 'outsider@set.test' }]);
    expect(await status(() => call(ids.outsider, 'lookupInvitees', { spaceId: ids.space, emails: ['owner@set.test'] }))).toBe(403);
    db.putRecord('user_settings', { id: ids.outsider, version: 2, settings: { profile_discoverable: true } } as any);
  });
});

describe('connections (Settings › Connections › Manage)', () => {
  it('only workspace owners list and remove members’ connections; custom MCP toggles are audited', async () => {
    db.db.exec(`CREATE TABLE IF NOT EXISTS ai_mcp_connections (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, space_id TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
      token TEXT, tools TEXT NOT NULL DEFAULT '[]', disabled_tools TEXT NOT NULL DEFAULT '[]', enabled INTEGER NOT NULL DEFAULT 1, created_time INTEGER NOT NULL, checked_time INTEGER, error TEXT)`);
    const cid = newId();
    db.db.prepare('INSERT INTO ai_mcp_connections (id, user_id, space_id, name, url, token, created_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(cid, ids.member, ids.space, 'Tracker', 'https://mcp.example.test/mcp', 'secret-token', Date.now());
    expect(await status(() => call(ids.member, 'getWorkspaceConnections', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.admin, 'getWorkspaceConnections', { spaceId: ids.space }))).toBe(403);
    const list = await call(ids.owner, 'getWorkspaceConnections', { spaceId: ids.space });
    expect(list.connections).toEqual([expect.objectContaining({ id: cid, userId: ids.member, name: 'Tracker', host: 'mcp.example.test' })]);
    expect(JSON.stringify(list)).not.toContain('secret-token');
    expect(await status(() => call(ids.member, 'removeWorkspaceConnection', { spaceId: ids.space, connectionId: cid }))).toBe(403);
    expect(await status(() => call(ids.outsider, 'removeWorkspaceConnection', { spaceId: ids.otherSpace, connectionId: cid }))).toBe(404);
    await call(ids.owner, 'removeWorkspaceConnection', { spaceId: ids.space, connectionId: cid });
    expect((await call(ids.owner, 'getWorkspaceConnections', { spaceId: ids.space })).connections).toEqual([]);

    // Enable custom MCP servers (space.settings.ai_custom_mcp) through a transaction → audit event
    setSpace({ plan_type: 'enterprise' });
    const s = db.getRecord<any>('space', ids.space)!;
    await tx(ids.owner, [{ pointer: { table: 'space', id: ids.space, spaceId: ids.space }, path: ['settings'], command: 'update', args: { ai_custom_mcp: false } }]);
    expect(db.getRecord<any>('space', ids.space)!.settings.ai_custom_mcp).toBe(false);
    const log = await call(ids.owner, 'getAuditLog', { spaceId: ids.space, events: ['workspace.settings.allow_custom_mcp_servers_setting_updated'] });
    expect(log.entries[0]).toMatchObject({ event: 'workspace.settings.allow_custom_mcp_servers_setting_updated', data: { value: false } });
    await tx(ids.owner, [{ pointer: { table: 'space', id: ids.space, spaceId: ids.space }, path: ['settings'], command: 'update', args: { ai_custom_mcp: true } }]);
    setSpace({ plan_type: s.plan_type });
  });
});

describe('passkeys (WebAuthn)', () => {
  // minimal CBOR encoder for test vectors (authenticator side)
  function cbor(v: any): Buffer {
    const head = (major: number, n: number) => {
      if (n < 24) return Buffer.from([(major << 5) | n]);
      if (n < 256) return Buffer.from([(major << 5) | 24, n]);
      if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
      const b = Buffer.alloc(5);
      b[0] = (major << 5) | 26;
      b.writeUInt32BE(n, 1);
      return b;
    };
    if (typeof v === 'number') return v >= 0 ? head(0, v) : head(1, -1 - v);
    if (typeof v === 'string') { const b = Buffer.from(v); return Buffer.concat([head(3, b.length), b]); }
    if (v instanceof Uint8Array) return Buffer.concat([head(2, v.length), Buffer.from(v)]);
    const entries: [any, any][] = v instanceof Map ? [...v] : Object.entries(v);
    return Buffer.concat([head(5, entries.length), ...entries.flatMap(([k, x]) => [cbor(k), cbor(x)])]);
  }
  const ORIGIN = 'http://localhost:5451';
  it('registers a passkey and signs in with it; replays, other sites and cloned counters are refused', async () => {
    const { generateKeyPairSync, createHash, sign, randomBytes } = await import('node:crypto');
    const sha = (b: Buffer | string) => createHash('sha256').update(b).digest();
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = publicKey.export({ format: 'jwk' }) as { x: string; y: string };
    const cose = new Map<any, any>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]);
    const credId = randomBytes(32);
    const user = ids.member;
    const pctx = (u: string | null, origin = ORIGIN) => ({ userId: u, ip: '10.9.8.7', origin, userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0', setCookie: (c: string) => cookies.push(c) });

    // 127.0.0.1 can't be an RP ID
    expect(await status(() => H.passkeyRegistrationOptions(pctx(user, 'http://127.0.0.1:5451'), {}))).toBe(400);
    const opts = H.passkeyRegistrationOptions(pctx(user), {});
    expect(opts.publicKey.rp.id).toBe('localhost');
    expect(opts.publicKey.authenticatorSelection.residentKey).toBe('required');
    const authData = Buffer.concat([sha('localhost'), Buffer.from([0x45]), Buffer.from([0, 0, 0, 0]), Buffer.alloc(16), Buffer.from([0, 32]), credId, cbor(cose)]);
    const regClient = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts.publicKey.challenge, origin: ORIGIN }));
    const credential = { id: credId.toString('base64url'), rawId: credId.toString('base64url'), type: 'public-key', response: { clientDataJSON: regClient.toString('base64url'), attestationObject: cbor({ fmt: 'none', attStmt: new Map(), authData }).toString('base64url'), transports: ['internal'] } };
    // another user can't complete my registration
    expect(await status(() => H.registerPasskey(pctx(ids.admin), { challengeId: opts.challengeId, credential }))).toBe(400);
    const opts2 = H.passkeyRegistrationOptions(pctx(user), {});
    const client2 = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: opts2.publicKey.challenge, origin: ORIGIN }));
    const reg = H.registerPasskey(pctx(user), { challengeId: opts2.challengeId, credential: { ...credential, response: { ...credential.response, clientDataJSON: client2.toString('base64url') } } });
    expect(reg.passkey).toMatchObject({ id: credId.toString('base64url'), name: 'Chrome on macOS' });
    expect(H.getPasskeys(pctx(user), {}).passkeys).toHaveLength(1);

    const assertion = (challenge: string, count: number, origin = ORIGIN, key = privateKey) => {
      const ad = Buffer.concat([sha('localhost'), Buffer.from([0x05]), Buffer.from([0, 0, 0, count])]);
      const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin }));
      const signature = sign('sha256', Buffer.concat([ad, sha(cd)]), key);
      return { id: credId.toString('base64url'), rawId: credId.toString('base64url'), type: 'public-key', response: { clientDataJSON: cd.toString('base64url'), authenticatorData: ad.toString('base64url'), signature: signature.toString('base64url'), userHandle: Buffer.from(user).toString('base64url') } };
    };
    const l1 = H.passkeyLoginOptions(pctx(null), {});
    expect(l1.publicKey.rpId).toBe('localhost');
    const before = cookies.length;
    const res = H.loginWithPasskey(pctx(null), { challengeId: l1.challengeId, credential: assertion(l1.publicKey.challenge, 1) });
    expect(res.userId).toBe(user);
    expect(cookies.length).toBe(before + 1); // session cookie
    // the challenge is single-use
    expect(await status(() => H.loginWithPasskey(pctx(null), { challengeId: l1.challengeId, credential: assertion(l1.publicKey.challenge, 2) }))).toBe(400);
    // signed for another origin
    const l2 = H.passkeyLoginOptions(pctx(null), {});
    expect(await status(() => H.loginWithPasskey(pctx(null), { challengeId: l2.challengeId, credential: assertion(l2.publicKey.challenge, 2, 'http://evil.localhost:5451') }))).toBe(400);
    // a counter that doesn't grow (cloned authenticator)
    const l3 = H.passkeyLoginOptions(pctx(null), {});
    expect(await status(() => H.loginWithPasskey(pctx(null), { challengeId: l3.challengeId, credential: assertion(l3.publicKey.challenge, 1) }))).toBe(401);
    // a different key
    const other = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const l4 = H.passkeyLoginOptions(pctx(null), {});
    expect(await status(() => H.loginWithPasskey(pctx(null), { challengeId: l4.challengeId, credential: assertion(l4.publicKey.challenge, 5, ORIGIN, other) }))).toBe(401);
    // rename, delete → the passkey no longer signs in
    H.updatePasskeyName(pctx(user), { id: credId.toString('base64url'), name: 'Work laptop' });
    expect(H.getPasskeys(pctx(user), {}).passkeys[0].name).toBe('Work laptop');
    expect(await status(() => H.deletePasskey(pctx(ids.admin), { id: credId.toString('base64url') }))).toBe(404);
    H.deletePasskey(pctx(user), { id: credId.toString('base64url') });
    const l5 = H.passkeyLoginOptions(pctx(null), {});
    expect(await status(() => H.loginWithPasskey(pctx(null), { challengeId: l5.challengeId, credential: assertion(l5.publicKey.challenge, 6) }))).toBe(401);
  });
});

describe('account deletion', () => {
  it('removing the password also turns 2FA off', async () => {
    await call(ids.outsider, 'changePassword', { password: 'Outside123' });
    const start = await call(ids.outsider, 'startTotpEnrollment');
    await call(ids.outsider, 'completeTotpEnrollment', { enrollmentId: start.enrollmentId, name: 'Key', code: mfa.totp(start.secret) });
    expect(mfa.mfaEnabled(ids.outsider)).toBe(true);
    expect(await status(() => call(ids.outsider, 'removePassword', { currentPassword: 'nope' }))).toBe(401);
    await call(ids.outsider, 'removePassword', { currentPassword: 'Outside123' });
    expect(mfa.mfaEnabled(ids.outsider)).toBe(false);
    expect((await call(ids.outsider, 'hasPassword')).hasPassword).toBe(false);
  });
  it('needs the email, and explicit confirmation for workspaces with other members that will be deleted', async () => {
    const preview = await call(ids.owner, 'getAccountDeletionPreview');
    expect(preview.toDelete.find((s: any) => s.id === ids.space)).toMatchObject({ otherMembers: 2 });
    expect(await status(() => call(ids.owner, 'deleteAccount', { email: 'owner@set.test' }))).toBe(409);
    expect(await status(() => call(ids.solo, 'deleteAccount', { email: 'wrong@set.test' }))).toBe(400);
    const soloPreview = await call(ids.solo, 'getAccountDeletionPreview');
    expect(soloPreview.toDelete.map((s: any) => s.id)).toEqual([ids.soloSpace]);
    await call(ids.solo, 'deleteAccount', { email: 'solo@set.test' });
    expect(db.getRecord<any>('space', ids.soloSpace)!.deleted_time).toBeTruthy();
    const u = db.getRecord<any>('lit_user', ids.solo)!;
    expect(u.email).toBe('');
    expect(u.name).toBe('Deleted user');
    expect(db.findUserIdByEmail('solo@set.test')).toBeNull();
    expect(db.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(ids.solo)).toMatchObject({ n: 0 });
  });
});

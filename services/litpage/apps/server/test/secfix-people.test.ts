// Regression tests: Settings › People › Guests (owners / membership admins only, pages the caller can open)
// and joining through allowed email domains (join mode enforced by getJoinableWorkspaces / joinWorkspace).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-people-test-'));
delete process.env.NC_DEV_LOGIN_CODES;
vi.setConfig({ testTimeout: 30_000 });

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, ip: '127.0.0.1', setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function page(id: string, permissions: any[]) {
  const now = Date.now();
  return { id, version: 1, type: 'page', properties: { title: [['P']] }, parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, permissions, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner };
}
const setSettings = (patch: Record<string, unknown>) => {
  const s = db.getRecord<any>('space', ids.space)!;
  db.putRecord('space', { ...s, settings: { ...(s.settings ?? {}), ...patch } });
};
const isMember = (uid: string) => (db.getRecord<any>('space', ids.space)!.permissions ?? []).some((p: any) => p.user_id === uid && p.role !== 'none');

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  for (const n of ['owner', 'admin', 'member', 'restricted', 'guest', 'auto', 'asker', 'blocked']) {
    ids[n] = newId();
    seed.createUser(ids[n], ['auto', 'asker', 'blocked', 'owner'].includes(n) ? `${n}@corp.test` : `${n}@people.test`, n);
  }
  const w = seed.createWorkspace(ids.owner, 'Corp');
  ids.space = w.space.id;
  seed.addMember(ids.space, ids.admin, 'membership_admin');
  seed.addMember(ids.space, ids.member, 'editor');
  seed.addMember(ids.space, ids.restricted, 'restricted_member');
  // a page the owner shares with the guest, and the member's private page shared with the guest
  ids.shared = newId();
  db.putRecord('block', page(ids.shared, [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'reader', user_id: ids.guest }]) as any);
  ids.memberPrivate = newId();
  db.putRecord('block', page(ids.memberPrivate, [{ type: 'user_permission', role: 'editor', user_id: ids.member }, { type: 'user_permission', role: 'reader', user_id: ids.guest }]) as any);
});

describe('Settings › People › Guests', () => {
  it('is for workspace owners and membership admins', async () => {
    expect(await status(() => call(ids.member, 'getWorkspaceGuests', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.restricted, 'getWorkspaceGuests', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.guest, 'getWorkspaceGuests', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.admin, 'getWorkspaceGuests', { spaceId: ids.space }))).toBe(200);
  });
  it('lists only pages the caller can open', async () => {
    const res = await call(ids.owner, 'getWorkspaceGuests', { spaceId: ids.space });
    const g = res.guests.find((x: any) => x.userId === ids.guest);
    expect(g.pageIds).toEqual([ids.shared]);
    expect(res.recordMap.block?.[ids.memberPrivate]).toBeUndefined();
    expect(JSON.stringify(res)).not.toContain(ids.memberPrivate);
  });
});

describe('joining through allowed email domains follows the join mode', () => {
  beforeAll(async () => {
    await call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['corp.test'] });
  });
  const listed = async (uid: string) => (await call(uid, 'getJoinableWorkspaces')).spaces.find((s: any) => s.id === ids.space);

  it('Join automatically: listed with Join, joining makes a member', async () => {
    setSettings({ allowed_email_domain_join: 'auto' });
    expect((await listed(ids.auto)).joinMode).toBe('auto');
    const r = await call(ids.auto, 'joinWorkspace', { spaceId: ids.space });
    expect(r.requested).toBe(false);
    expect(isMember(ids.auto)).toBe(true);
  });

  it('Request to join: joining files one member request instead', async () => {
    setSettings({ allowed_email_domain_join: 'request' });
    expect(await listed(ids.asker)).toMatchObject({ joinMode: 'request', requested: false });
    expect((await call(ids.asker, 'joinWorkspace', { spaceId: ids.space })).requested).toBe(true);
    expect(await call(ids.asker, 'joinWorkspace', { spaceId: ids.space })).toMatchObject({ requested: true });
    expect(isMember(ids.asker)).toBe(false);
    const reqs = (db.getRecord<any>('space', ids.space)!.settings.member_requests ?? []).filter((r: any) => r.emails.includes('asker@corp.test'));
    expect(reqs.length).toBe(1);
    expect(await listed(ids.asker)).toMatchObject({ requested: true });
  });

  it('No access: not listed, and joining directly is refused', async () => {
    setSettings({ allowed_email_domain_join: 'none' });
    expect(await listed(ids.blocked)).toBeUndefined();
    expect(await status(() => call(ids.blocked, 'joinWorkspace', { spaceId: ids.space }))).toBe(403);
    expect(isMember(ids.blocked)).toBe(false);
    // and other domains never could
    expect(await status(() => call(ids.guest, 'joinWorkspace', { spaceId: ids.space }))).toBe(403);
  });
});

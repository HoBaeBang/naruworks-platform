// Regression tests: workspace policy on records created by a transaction and the
// owner / membership-admin split for workspace settings written through client transactions (space.settings).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-policy-test-'));
delete process.env.NC_DEV_LOGIN_CODES;
vi.setConfig({ testTimeout: 30_000 });

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let records: typeof import('../src/records.ts');
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

function tx(user: string, operations: any[], spaceId = ids.space) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
}

function page(id: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}, user = ids.owner) {
  const now = Date.now();
  return {
    id, version: 1, type: 'page', properties: { title: [[`Page ${id.slice(0, 4)}`]] }, parent_id: parentId, parent_table: parentTable, space_id: ids.space,
    alive: true, created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user, ...extra,
  };
}

function setSpace(patch: Record<string, unknown>, settings?: Record<string, unknown>) {
  const s = db.getRecord<any>('space', ids.space)!;
  db.putRecord('space', { ...s, ...patch, settings: { ...(s.settings ?? {}), ...(settings ?? {}) } });
}

/** A new sub-page of `parent` (created by `user`) with the given sharing, plus the parent's content pointer. */
function newSubPage(user: string, parent: string, permissions?: any[]) {
  const id = newId();
  return {
    id,
    ops: [
      { pointer: { table: 'block', id }, path: [], command: 'set', args: page(id, parent, 'block', permissions ? { permissions } : {}, user) },
      { pointer: { table: 'block', id: parent }, path: ['content'], command: 'listAfter', args: { id } },
    ],
  };
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  records = await import('../src/records.ts');

  for (const n of ['owner', 'admin', 'member', 'guest', 'restricted']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@secfix.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  ids.team = w.team.id;
  seed.addMember(ids.space, ids.admin, 'membership_admin');
  seed.addMember(ids.space, ids.member, 'editor');
  seed.addMember(ids.space, ids.restricted, 'restricted_member');
  setSpace({ plan_type: 'enterprise' });

  // a workspace page the member can edit
  ids.shared = newId();
  db.putRecord('block', page(ids.shared, ids.space, 'space', {
    permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.member }, { type: 'user_permission', role: 'editor', user_id: ids.admin }],
  }) as any);
});

describe('sharing written by transactions that create records (SET-SEC-006/009/010/013)', () => {
  it('a new page that already shares itself with a guest needs the guest-invite policy', async () => {
    setSpace({ disable_guests: true });
    const guestGrant = [{ type: 'user_permission', role: 'reader', user_id: ids.guest }];
    const a = newSubPage(ids.member, ids.shared, guestGrant);
    expect(await status(() => tx(ids.member, a.ops))).toBe(403);
    expect(db.getRecord('block', a.id)).toBeUndefined();
    expect(records.blockRole(ids.shared, ids.guest)).toBe('none');
    // later ops of the same call on the new page are checked too
    const b = newSubPage(ids.member, ids.shared);
    expect(await status(() => tx(ids.member, [...b.ops, { pointer: { table: 'block', id: b.id }, path: ['permissions'], command: 'set', args: guestGrant }]))).toBe(403);
    expect(await status(() => tx(ids.member, [...b.ops, { pointer: { table: 'block', id: b.id }, path: [], command: 'update', args: { permissions: guestGrant } }]))).toBe(403);
    // the Share menu path for an existing page says the same
    expect(await status(() => call(ids.member, 'invitePagePermissions', { pageId: ids.shared, emails: ['guest@secfix.test'], role: 'reader' }))).toBe(403);
    // owners may still invite guests; members may again once the policy allows it
    const c = newSubPage(ids.owner, ids.shared, guestGrant);
    expect(await status(() => tx(ids.owner, c.ops))).toBe(200);
    expect(records.blockRole(c.id, ids.guest)).toBe('reader');
    setSpace({ disable_guests: false });
    const d = newSubPage(ids.member, ids.shared, guestGrant);
    expect(await status(() => tx(ids.member, d.ops))).toBe(200);
  });

  it('a new page shared to the web needs publishing to be allowed', async () => {
    setSpace({ disable_public_access: true });
    const pub = [{ type: 'public_permission', role: 'reader' }];
    const a = newSubPage(ids.member, ids.shared, pub);
    expect(await status(() => tx(ids.member, a.ops))).toBe(403);
    const b = newSubPage(ids.owner, ids.shared, pub);
    expect(await status(() => tx(ids.owner, b.ops))).toBe(403); // nobody publishes while it is disabled
    setSpace({ disable_public_access: false });
    expect(await status(() => tx(ids.member, newSubPage(ids.member, ids.shared, pub).ops))).toBe(200);
  });

  it('a new public form view needs publishing to be allowed', async () => {
    const host = newId();
    const view = newId();
    const ops = [
      { pointer: { table: 'block', id: host }, path: [], command: 'set', args: { ...page(host, ids.shared, 'block', {}, ids.member), type: 'collection_view', view_ids: [view] } },
      { pointer: { table: 'block', id: ids.shared }, path: ['content'], command: 'listAfter', args: { id: host } },
      { pointer: { table: 'collection_view', id: view }, path: [], command: 'set', args: { id: view, version: 1, type: 'form', name: 'Form', parent_id: host, parent_table: 'block', alive: true, format: { form_config: { permission: 'public' } } } },
    ];
    setSpace({ disable_public_access: true });
    expect(await status(() => tx(ids.member, ops))).toBe(403);
    setSpace({ disable_public_access: false });
    expect(await status(() => tx(ids.member, ops))).toBe(200);
  });

  it('a new page shared with a restricted member follows "Who can add restricted members to pages"', async () => {
    const grant = [{ type: 'user_permission', role: 'reader', user_id: ids.restricted }];
    // default: any member with admin approval → members can't, workspace admins can
    expect(await status(() => tx(ids.member, newSubPage(ids.member, ids.shared, grant).ops))).toBe(403);
    const ok = newSubPage(ids.admin, ids.shared, grant);
    expect(await status(() => tx(ids.admin, ok.ops))).toBe(200);
    expect(records.blockRole(ok.id, ids.restricted)).toBe('reader');
    setSpace({}, { restricted_members_pages: 'member' });
    expect(await status(() => tx(ids.member, newSubPage(ids.member, ids.shared, grant).ops))).toBe(200);
    setSpace({}, { restricted_members_pages: null });
  });

  it('the creator of a private page is never a new guest or restricted member', async () => {
    const mine = (user: string) => {
      const id = newId();
      const sv = db.getRecord<any>('user_root', user)!.space_views.map((v: string) => db.getRecord<any>('space_view', v)).find((v: any) => v?.space_id === ids.space);
      return [
        { pointer: { table: 'block', id }, path: [], command: 'set', args: page(id, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: user }] }, user) },
        { pointer: { table: 'space_view', id: sv.id }, path: ['private_pages'], command: 'listAfter', args: { id } },
      ];
    };
    setSpace({ disable_guests: true });
    expect(await status(() => tx(ids.restricted, mine(ids.restricted)))).toBe(200);
    expect(await status(() => tx(ids.member, mine(ids.member)))).toBe(200);
    setSpace({ disable_guests: false });
  });

  it('a new teamspace can’t relax the workspace’s security settings unless an owner creates it', async () => {
    setSpace({ disable_export: true });
    const team = (user: string) => {
      const id = newId();
      return [{
        pointer: { table: 'team', id }, path: [], command: 'set', args: {
          id, space_id: ids.space, name: 'Loose', team_pages: [], parent_id: ids.space, parent_table: 'space', alive: true,
          membership: [{ user_id: user, role: 'owner', added_time: Date.now() }], settings: { type: 'open', disable_export: false }, created_time: Date.now(), created_by_id: user,
        },
      }];
    };
    expect(await status(() => tx(ids.member, team(ids.member)))).toBe(403);
    expect(await status(() => tx(ids.owner, team(ids.owner)))).toBe(200);
    setSpace({ disable_export: false });
  });

  it('server-built copies keep working (duplicating a page shared with a guest while guests are off)', async () => {
    const top = newId();
    db.putRecord('block', page(top, ids.space, 'space', {
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.member }, { type: 'user_permission', role: 'reader', user_id: ids.guest }],
    }) as any);
    setSpace({ disable_guests: true });
    expect(await status(() => call(ids.member, 'duplicateBlock', { blockId: top }))).toBe(200);
    setSpace({ disable_guests: false });
  });
});

describe('workspace settings written through transactions: owners vs membership admins', () => {
  const settingsTx = (user: string, patch: Record<string, unknown>) => tx(user, [{ pointer: { table: 'space', id: ids.space }, path: ['settings'], command: 'update', args: patch }]);
  const fieldsTx = (user: string, patch: Record<string, unknown>) => tx(user, [{ pointer: { table: 'space', id: ids.space }, path: [], command: 'update', args: patch }]);

  it('endpoint-only keys can’t be written by anyone (allowed email domains, groups, requests, emoji …)', async () => {
    for (const user of [ids.owner, ids.admin, ids.member]) {
      expect(await status(() => settingsTx(user, { allowed_email_domains: ['gmail.com'] }))).toBe(403);
      expect(await status(() => settingsTx(user, { groups: [{ id: 'g', name: 'G', member_ids: [ids.guest] }] }))).toBe(403);
      expect(await status(() => settingsTx(user, { member_requests: [] }))).toBe(403);
      expect(await status(() => settingsTx(user, { custom_emojis: [{ id: 'e', name: 'x', url: 'https://evil.test/x.png' }] }))).toBe(403);
      expect(await status(() => settingsTx(user, { invite_link_enabled: true }))).toBe(403);
    }
    expect((db.getRecord<any>('space', ids.space)!.settings ?? {}).allowed_email_domains).toBeUndefined();
    // the dedicated endpoint stays owner-only
    expect(await status(() => call(ids.admin, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['secfix.test'] }))).toBe(403);
    expect(await status(() => call(ids.owner, 'setAllowedEmailDomains', { spaceId: ids.space, domains: ['secfix.test'] }))).toBe(200);
    // replacing the whole settings object can't drop endpoint-owned keys either
    const s = db.getRecord<any>('space', ids.space)!.settings;
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'space', id: ids.space }, path: ['settings'], command: 'set', args: { page_view_analytics: false } }]))).toBe(403);
    expect(db.getRecord<any>('space', ids.space)!.settings).toEqual(s);
  });

  it('membership admins change membership settings only; owners change the rest', async () => {
    // owner-only workspace settings (security, general, teamspaces, identity, AI …)
    for (const patch of [{ limit_team_creation: true }, { allow_external_member_requests: true }, { restricted_members_pages: 'member' }, { trash_retention_days: 1 }, { allowed_email_domain_join: 'auto' }, { saml: { enabled: true } }, { ai_enabled: false }, { sidebar_presets: { presets: [] } }]) {
      expect(await status(() => settingsTx(ids.admin, patch))).toBe(403);
      expect(await status(() => settingsTx(ids.member, patch))).toBe(403);
    }
    for (const patch of [{ disable_export: true }, { disable_guests: true }, { disable_public_access: true }, { name: 'Pwned' }, { icon: '🔥' }]) {
      expect(await status(() => fieldsTx(ids.admin, patch))).toBe(403);
    }
    expect(db.getRecord<any>('space', ids.space)!.name).toBe('Acme');
    expect(await status(() => settingsTx(ids.owner, { limit_team_creation: true, ai_enabled: false }))).toBe(200);
    expect(await status(() => settingsTx(ids.owner, { limit_team_creation: false, ai_enabled: true }))).toBe(200);
    expect(await status(() => fieldsTx(ids.owner, { disable_export: true }))).toBe(200);
    expect(await status(() => fieldsTx(ids.owner, { disable_export: false }))).toBe(200);
    // membership: group creation policy and default teamspaces
    expect(await status(() => settingsTx(ids.admin, { restrict_group_creation: true }))).toBe(200);
    expect(await status(() => settingsTx(ids.member, { restrict_group_creation: false }))).toBe(403);
    expect(await status(() => settingsTx(ids.admin, { restrict_group_creation: false }))).toBe(200);
    expect(await status(() => tx(ids.admin, [{ pointer: { table: 'space', id: ids.space }, path: ['default_team_ids'], command: 'listAfter', args: { id: ids.team } }]))).toBe(200);
    // a mixed write is refused as a whole
    expect(await status(() => settingsTx(ids.admin, { restrict_group_creation: true, limit_team_creation: true }))).toBe(403);
    expect(db.getRecord<any>('space', ids.space)!.settings?.restrict_group_creation).toBe(false);
    // members still add workspace pages
    const top = newId();
    expect(await status(() => tx(ids.member, [
      { pointer: { table: 'block', id: top }, path: [], command: 'set', args: page(top, ids.space, 'space', {}, ids.member) },
      { pointer: { table: 'space', id: ids.space }, path: ['pages'], command: 'listAfter', args: { id: top } },
    ]))).toBe(200);
  });

  it('the workspace domain is owner-only like the name ("Only workspace owners can update the domain")', async () => {
    expect(await status(() => call(ids.admin, 'setSpaceDomain', { spaceId: ids.space, domain: 'acme-admin' }))).toBe(403);
    expect(await status(() => call(ids.owner, 'setSpaceDomain', { spaceId: ids.space, domain: 'acme-owner' }))).toBe(200);
  });
});

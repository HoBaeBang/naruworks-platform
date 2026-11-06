// Custom Agents authorization (items 10–13).
// 10 — "Transfer ownership" only hands over agents nobody holds Full access to any more (their owners left), and only
// workspace owners do it; "Pages it can access" shows titles of pages an admin can't open only to Enterprise
// owners (what Content search shows them)
// 11 — only current full members hold a role on an agent: people who left keep nothing (no chat, no run, no
// settings), and guests / restricted members can't be invited
// 12 — adding a page from the page's Share menu (or "Invite agent to page?") needs Can edit on the agent, so a
// viewer can neither change the agent's access nor stop it with a page none of its editors can open
// 13 — property access is capped by the agent's editors too: someone excluded from a property can't read it through
// an agent they edit
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-agents-test-'));
process.env.NC_SCHEDULER = '0';
process.env.NC_AGENT_TRIGGER_WINDOW_MS = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

let db: typeof import('../src/db.ts');
let model: typeof import('../src/agents/model.ts');
let access: typeof import('../src/agents/access.ts');
let runs: typeof import('../src/agents/runs.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string, name: string, body: any = {}) => H[name](ctx(user), body);
async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function env(userId: string) {
  return {
    userId, spaceId: ids.space, threadId: null, turnId: `t-${Math.random().toString(36).slice(2)}`, currentPageId: null,
    approvalMode: 'skip_all', memories: false, cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept',
  } as any;
}
const tool = (userId: string, name: string, input: Record<string, unknown>) => registry.runTool(env(userId), name, input, `s-${Math.random().toString(36).slice(2)}`);

function page(title: string, permissions: any[]) {
  const id = newId();
  const now = Date.now();
  db.putRecord('block', { id, version: 1, type: 'page', properties: { title: [[title]] }, content: [], parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, permissions, created_time: now, created_by_id: ids.A, last_edited_time: now } as any);
  return id;
}

function mkAgent(name: string, by: string, permissions?: any[]) {
  return model.createAgent({ spaceId: ids.space, userId: by, config: { name } as any, published: true, permissions });
}

function setSpace(patch: Record<string, unknown>) {
  db.putRecord('space', { ...db.getRecord<any>('space', ids.space), ...patch });
}

function removeMember(userId: string) {
  const sp = db.getRecord<any>('space', ids.space);
  db.putRecord('space', { ...sp, permissions: sp.permissions.filter((p: any) => p.user_id !== userId) });
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  model = await import('../src/agents/model.ts');
  access = await import('../src/agents/access.ts');
  runs = await import('../src/agents/runs.ts');
  registry = await import('../src/ai/tools/registry.ts');
  await import('../src/api/modules/agents.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['A', 'B', 'C', 'M', 'R', 'L', 'X', 'Y', 'G', 'O']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n.toLowerCase()}@aisec-agents.test`, `User ${n}`);
  }
  ids.space = seed.createWorkspace(ids.A, 'Agent Sec').space.id;
  for (const n of ['B', 'C', 'L', 'X', 'Y']) seed.addMember(ids.space, ids[n], 'member');
  seed.addMember(ids.space, ids.M, 'membership_admin');
  seed.addMember(ids.space, ids.R, 'restricted_member');
  seed.createWorkspace(ids.O, 'Elsewhere');
  setSpace({ plan_type: 'business' });
  ids.cPrivate = page('C private payroll notes', [{ type: 'user_permission', role: 'editor', user_id: ids.C }]);
  ids.shared = page('Shared plan', [{ type: 'space_permission', role: 'read_and_write' }]);
  ids.guestPage = page('Guest page', [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'reader', user_id: ids.G }]);
});

describe('ownership transfer and admin views (item 10)', () => {
  it('an agent that still has an owner can’t be taken over, not even by a workspace owner for themselves', async () => {
    const theirs = mkAgent('B’s agent', ids.B);
    expect(await status(() => call(ids.A, 'transferAgentOwnership', { agentId: theirs.id, userId: ids.A }))).toBe(400);
    expect(await status(() => call(ids.A, 'transferAgentOwnership', { agentId: theirs.id, userId: ids.C }))).toBe(400);
    expect(model.agentRole(model.getAgent(theirs.id)!, ids.A)).toBe('none');
    const list = await call(ids.A, 'adminListAgents', { spaceId: ids.space });
    expect(list.agents.find((x: any) => x.id === theirs.id)).toMatchObject({ ownerless: false });
  });

  it('an agent whose owner left goes to a full member — by a workspace owner only', async () => {
    const left = mkAgent('L’s agent', ids.L);
    removeMember(ids.L);
    expect(model.isOwnerless(model.getAgent(left.id)!)).toBe(true);
    expect((await call(ids.A, 'adminListAgents', { spaceId: ids.space })).agents.find((x: any) => x.id === left.id)).toMatchObject({ ownerless: true });
    expect(await status(() => call(ids.M, 'transferAgentOwnership', { agentId: left.id, userId: ids.M }))).toBe(403);
    expect(await status(() => call(ids.M, 'adminOrphanedAgents', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.A, 'transferAgentOwnership', { agentId: left.id, userId: ids.R }))).toBe(400);
    expect(await status(() => call(ids.A, 'transferAgentOwnership', { agentId: left.id, userId: ids.G }))).toBe(400);
    expect((await call(ids.A, 'adminOrphanedAgents', { spaceId: ids.space })).agents.map((x: any) => x.id)).toContain(left.id);
    await call(ids.A, 'transferAgentOwnership', { agentId: left.id, userId: ids.C });
    expect(model.agentRole(model.getAgent(left.id)!, ids.C)).toBe('editor');
    expect(await status(() => call(ids.A, 'transferAgentOwnership', { agentId: left.id, userId: ids.A }))).toBe(400);
  });

  it('“Pages it can access” hides titles of pages the admin can’t open, except from Enterprise owners', async () => {
    const a = mkAgent('C’s helper', ids.C);
    model.saveAgentRecord({ ...model.getAgent(a.id)!, data: { ...model.getAgent(a.id)!.data, grants: [{ block_id: ids.cPrivate, role: 'reader' }, { block_id: ids.shared, role: 'reader' }] } });
    const r = await call(ids.A, 'adminAgentResources', { agentId: a.id });
    expect(r.grants.map((g: any) => g.title)).toEqual(['Private page', 'Shared plan']);
    // membership admins don't manage agents at all (workspace settings are owner-only, item 27)
    expect(await status(() => call(ids.M, 'adminAgentResources', { agentId: a.id }))).toBe(403);
    setSpace({ plan_type: 'enterprise' });
    try {
      expect((await call(ids.A, 'adminAgentResources', { agentId: a.id })).grants.map((g: any) => g.title)).toContain('C private payroll notes');
      expect(await status(() => call(ids.M, 'adminAgentResources', { agentId: a.id }))).toBe(403);
    } finally {
      setSpace({ plan_type: 'business' });
    }
  });
});

describe('membership (item 11)', () => {
  it('people who left keep no role: no chat, no run, no settings', async () => {
    const S = newId();
    (await import('../src/seed.ts')).createUser(S, 's@aisec-agents.test', 'User S');
    (await import('../src/seed.ts')).addMember(ids.space, S, 'member');
    const a = mkAgent('Team bot', ids.A, [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'read_and_write', user_id: S }]);
    expect(model.agentRole(a, S)).toBe('read_and_write');
    removeMember(S);
    expect(model.agentRole(model.getAgent(a.id)!, S)).toBe('none');
    expect(() => runs.prepareAgentChat({ userId: S, agentId: a.id, text: 'hi' })).toThrow();
    expect(await status(() => call(S, 'runAgent', { agentId: a.id }))).toBe(404);
    expect(await status(() => call(S, 'updateAgentDraft', { agentId: a.id, patch: { name: 'Hijacked' } }))).toBe(404);
    expect(model.agentPeople(model.getAgent(a.id)!, 'read_and_write')).not.toContain(S);
  });

  it('guests, other workspaces’ people and restricted members can’t be invited', async () => {
    const a = mkAgent('Invite test', ids.A);
    const base = [{ type: 'user_permission', role: 'editor', user_id: ids.A }];
    expect(await status(() => call(ids.A, 'setAgentPermissions', { agentId: a.id, permissions: [...base, { type: 'user_permission', role: 'read_and_write', user_id: ids.G }] }))).toBe(400);
    expect(await status(() => call(ids.A, 'setAgentPermissions', { agentId: a.id, permissions: [...base, { type: 'user_permission', role: 'editor', user_id: ids.O }] }))).toBe(400);
    expect(await status(() => call(ids.A, 'setAgentPermissions', { agentId: a.id, permissions: [...base, { type: 'user_permission', role: 'reader', user_id: ids.R }] }))).toBe(400);
    expect((model.getAgent(a.id)!.permissions ?? []).map((p: any) => p.user_id)).toEqual([ids.A]);
    // a restricted member with an old explicit entry has nothing either
    const legacy = mkAgent('Legacy', ids.A, [...base, { type: 'user_permission', role: 'read_and_write', user_id: ids.R }]);
    expect(model.agentRole(legacy, ids.R)).toBe('none');
  });
});

describe('Share menu grants (item 12)', () => {
  it('need Can edit on the agent; a viewer can’t change its access or break it', async () => {
    const a = mkAgent('Shared bot', ids.A, [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'reader', user_id: ids.C }, { type: 'user_permission', role: 'read_and_write', user_id: ids.B }]);
    // C (Can view and interact) owns a private page no editor of the agent can open
    expect(await status(() => call(ids.C, 'grantAgentPageAccess', { agentId: a.id, pageId: ids.cPrivate, role: 'reader' }))).toBe(403);
    expect(model.getAgent(a.id)!.data.grants).toEqual([]);
    expect(access.editorAccessCheck(model.getAgent(a.id)!).ok).toBe(true);
    const pageAgents = await call(ids.C, 'getPageAgents', { pageId: ids.cPrivate });
    expect(pageAgents.available.map((x: any) => x.agentId)).not.toContain(a.id);
    expect(await call(ids.C, 'checkAgentMention', { agentId: a.id, pageId: ids.cPrivate })).toMatchObject({ canGrant: false, canEdit: false });
    // B (Can edit) adds a page they can edit: Can view only (more than view needs Full access)
    const mention = await call(ids.B, 'checkAgentMention', { agentId: a.id, pageId: ids.shared });
    expect(mention).toMatchObject({ canGrant: true, canEdit: true, grantRole: 'reader' });
    await call(ids.B, 'grantAgentPageAccess', { agentId: a.id, pageId: ids.shared, role: 'reader' });
    expect(model.getAgent(a.id)!.data.grants.map((g: any) => g.block_id)).toEqual([ids.shared]);
    expect(access.editorAccessCheck(model.getAgent(a.id)!).ok).toBe(true);
  });
});

describe('property access cap (item 13)', () => {
  it('an agent sees a property only when one of its editors may', async () => {
    const dbId = newId();
    const col = newId();
    const view = newId();
    const now = Date.now();
    db.putRecord('block', {
      id: dbId, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: col, view_ids: [view],
      permissions: [{ type: 'user_permission', role: 'read_and_write', user_id: ids.X }, { type: 'user_permission', role: 'read_and_write', user_id: ids.Y }], created_time: now,
    } as any);
    db.putRecord('collection', {
      id: col, version: 1, parent_id: dbId, parent_table: 'block', space_id: ids.space, alive: true, name: [['Staff']],
      schema: { title: { name: 'Name', type: 'title' }, bonus: { name: 'Bonus', type: 'text', property_permissions: { default_access: 'reader', overrides: [{ type: 'user_permission', user_id: ids.X, role: 'none' }] } } },
    } as any);
    db.putRecord('collection_view', { id: view, version: 1, type: 'table', parent_id: dbId, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
    db.putRecord('block', { id: newId(), version: 1, type: 'page', parent_id: col, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Kim']], bonus: [['bonus-ocelot-5000']] }, created_time: now } as any);
    // X (excluded from Bonus) is the agent's only editor
    const a = mkAgent('Staff bot', ids.X);
    model.saveAgentRecord({ ...model.getAgent(a.id)!, data: { ...model.getAgent(a.id)!.data, grants: [{ block_id: dbId, role: 'reader' }] } });
    const viaX = await tool(a.bot_id, 'query_database', { database_id: dbId });
    expect(viaX.isError).toBeFalsy();
    expect(viaX.content).toContain('Kim');
    expect(viaX.content).not.toContain('bonus-ocelot-5000');
    expect(viaX.content).not.toContain('Bonus');
    // with Y (who may see Bonus) as an editor too, the agent can
    const cur = model.getAgent(a.id)!;
    model.saveAgentRecord({ ...cur, permissions: [...(cur.permissions ?? []), { type: 'user_permission', role: 'read_and_write', user_id: ids.Y }] });
    expect((await tool(a.bot_id, 'query_database', { database_id: dbId })).content).toContain('bonus-ocelot-5000');
  });
});

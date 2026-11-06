// items 21 + 27: workspace settings are for workspace owners (policy.ts: membership admins manage
// members, groups and default teamspaces only). In the AI / agents / MCP / developer area that covers: AI usage and
// "Disconnect all" custom MCP connections, workspace shared MCPs, the MCP connection list / Disconnect all users /
// MCP clients (and a membership admin's own client gets no owner exemption or auto-approval), everyone's shared AI
// chats, Settings › AI service › Agents, and managing other people's API connections. Shared AI chats are workspace-wide
// content: restricted members can't open them.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-owner-split-test-'));
process.env.NC_SCHEDULER = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

let db: typeof import('../src/db.ts');
let nmcp: typeof import('../src/ai/litMcp.ts');
let threads: typeof import('../src/ai/threads.ts');
let model: typeof import('../src/agents/model.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let newId: () => string;
const ids = {} as Record<string, string>;
const call = async (user: string, name: string, body: any = {}) => H[name]({ userId: user, setCookie: () => {} }, body);
async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}
const rpc = (token: string, method: string, params: Record<string, unknown> = {}) => nmcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 1, method, params });
const initialize = (token: string, name: string) => rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } });
function setSpace(patch: Record<string, unknown>, settings: Record<string, unknown> = {}) {
  const s = db.getRecord<any>('space', ids.space);
  db.putRecord('space', { ...s, ...patch, settings: { ...(s.settings ?? {}), ...settings } });
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  nmcp = await import('../src/ai/litMcp.ts');
  threads = await import('../src/ai/threads.ts');
  model = await import('../src/agents/model.ts');
  await import('../src/api/modules/ai.ts');
  await import('../src/api/modules/agents.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['owner', 'madmin', 'member', 'restricted']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@aisec-owner.test`, n);
  }
  ids.space = seed.createWorkspace(ids.owner, 'Split').space.id;
  seed.addMember(ids.space, ids.madmin, 'membership_admin');
  seed.addMember(ids.space, ids.member, 'member');
  seed.addMember(ids.space, ids.restricted, 'restricted_member');
  setSpace({ plan_type: 'enterprise' });
});

describe('AI and MCP workspace controls are owner-only (item 27)', () => {
  it('membership admins can’t use them; owners can', async () => {
    const S = ids.space;
    expect(await status(() => call(ids.madmin, 'aiUsage', { spaceId: S }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'aiDisconnectAllConnections', { spaceId: S }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'mcpCreatePreset', { spaceId: S, name: 'X', url: 'https://mcp.litpage.dev/mcp' }))).toBe(403);
    expect((await call(ids.madmin, 'mcpListPresets', { spaceId: S })).canManage).toBe(false);
    expect(await status(() => call(ids.madmin, 'mcpListTokens', { spaceId: S, all: true }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'mcpRevokeAll', { spaceId: S }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'mcpListClients', { spaceId: S }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'mcpSetClientRestriction', { spaceId: S, restricted: true }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'mcpApproveClients', { spaceId: S, keys: ['cursor'] }))).toBe(403);
    const memberToken = nmcp.createToken(ids.member, S, 'm');
    expect(await status(() => call(ids.madmin, 'mcpRevokeToken', { tokenId: memberToken.info.id }))).toBe(403);
    // owners
    expect(await status(() => call(ids.owner, 'aiUsage', { spaceId: S }))).toBe(200);
    expect((await call(ids.owner, 'mcpListPresets', { spaceId: S })).canManage).toBe(true);
    expect(await status(() => call(ids.owner, 'mcpListTokens', { spaceId: S, all: true }))).toBe(200);
    expect(await status(() => call(ids.owner, 'mcpRevokeToken', { tokenId: memberToken.info.id }))).toBe(200);
  });

  it('a membership admin’s client gets no owner exemption or auto-approval', async () => {
    const t = nmcp.createToken(ids.madmin, ids.space, 'admin bot').token;
    await initialize(t, 'Cursor');
    expect(nmcp.clientPolicy(db.getRecord<any>('space', ids.space)).approved.map((a) => a.key)).not.toContain('cursor');
    setSpace({}, { mcp_clients_restricted: true });
    try {
      expect(((await rpc(t, 'tools/list')).body as any).error).toMatchObject({ code: -32003 });
      const o = nmcp.createToken(ids.owner, ids.space, 'owner bot').token;
      await initialize(o, 'Cursor');
      expect(((await rpc(o, 'tools/list')).body as any).result).toBeTruthy();
    } finally {
      setSpace({}, { mcp_clients_restricted: false, mcp_clients_approved: [] });
    }
  });
});

describe('agent admin controls are owner-only (item 27)', () => {
  it('membership admins can’t list, disable, join or reshare agents', async () => {
    const a = model.createAgent({ spaceId: ids.space, userId: ids.member, config: { name: 'Members bot' } as any, published: true });
    expect(await status(() => call(ids.madmin, 'adminListAgents', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'adminAgentAnalytics', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'adminAgentResources', { agentId: a.id }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'adminJoinAgent', { agentId: a.id }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'setAgentEnabled', { agentId: a.id, enabled: false }))).not.toBe(200);
    expect(await status(() => call(ids.madmin, 'setAgentPermissions', { agentId: a.id, permissions: [{ type: 'user_permission', user_id: ids.madmin, role: 'editor' }] }))).not.toBe(200);
    expect(model.agentRole(model.getAgent(a.id)!, ids.madmin)).toBe('none');
    expect(model.getAgent(a.id)!.status).toBe('active');
    // the owner can
    expect(await status(() => call(ids.owner, 'adminListAgents', { spaceId: ids.space }))).toBe(200);
    expect(await status(() => call(ids.owner, 'setAgentEnabled', { agentId: a.id, enabled: false }))).toBe(200);
  });
});

describe('API connections (item 27)', () => {
  it('only the connection’s owner and workspace owners manage it', async () => {
    const c = await call(ids.member, 'devCreateConnection', { spaceId: ids.space, name: 'Member sync' });
    expect(await status(() => call(ids.madmin, 'devUpdateConnection', { connectionId: c.connection.id, name: 'Renamed' }))).toBe(403);
    expect(await status(() => call(ids.madmin, 'devDeleteConnection', { connectionId: c.connection.id }))).toBe(403);
    expect((await call(ids.madmin, 'devListConnections', { spaceId: ids.space })).admin).toBe(false);
    expect(await status(() => call(ids.owner, 'devUpdateConnection', { connectionId: c.connection.id, name: 'Renamed' }))).toBe(200);
  });
});

describe('shared AI chats (items 21 + 27)', () => {
  it('restricted members can’t open them; only owners list everyone’s', async () => {
    const t = threads.createThread(ids.member, ids.space, 'Launch notes chat');
    threads.setShared(t.id, true);
    expect(await status(() => call(ids.owner, 'aiGetThread', { threadId: t.id }))).toBe(200);
    expect(await status(() => call(ids.restricted, 'aiGetThread', { threadId: t.id }))).toBe(404);
    expect((await call(ids.owner, 'aiSharedThreads', { spaceId: ids.space })).threads.map((x: any) => x.id)).toContain(t.id);
    expect((await call(ids.madmin, 'aiSharedThreads', { spaceId: ids.space })).threads.map((x: any) => x.id)).not.toContain(t.id);
  });
});

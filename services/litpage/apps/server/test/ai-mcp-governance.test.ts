// MCP governance and shared MCP servers against a temporary workspace:
// - MCP clients: tokens remember the client that connected (catalog or self-reported name),
// "Approved MCP clients only" blocks other clients (owners' clients are approved automatically), owners approve /
// rename / remove clients and disconnect one member or everyone, members can't manage them; audit log rows.
// - Memory sync: lit-get-memories / lit-save-memory read and append the person's memories.
// - Workspace shared MCPs: owners add presets; members connect with their own token — even with custom MCP
// servers turned off — and a Custom Agent can use a preset too.
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-mcp-governance-test-'));
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';
process.env.NC_SCHEDULER = '0';

let db: typeof import('../src/db.ts');
let records: typeof import('../src/records.ts');
let nmcp: typeof import('../src/ai/litMcp.ts');
let mcp: typeof import('../src/ai/mcp.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let newId: () => string;
let A = '';
let B = '';
let spaceId = '';

const ctx = (userId: string) => ({ userId, setCookie: () => {} });
const call = async (user: string, name: string, body: any = {}) => H[name](ctx(user), body);
async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}
const rpc = (token: string, method: string, params: Record<string, unknown> = {}, id = 1) => nmcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id, method, params });
const initialize = (token: string, name: string) => rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } });
const setSpaceSettings = (patch: Record<string, unknown>) => records.applyTransactions(A, [{ id: newId(), spaceId, operations: [{ pointer: { table: 'space', id: spaceId, spaceId }, path: ['settings'], command: 'update', args: patch }] }], undefined, { client: true });
const auditEvents = (event: string) => db.db.prepare('SELECT * FROM audit_log WHERE space_id = ? AND event = ?').all(spaceId, event) as any[];

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  const seed = await import('../src/seed.ts');
  db = await import('../src/db.ts');
  records = await import('../src/records.ts');
  nmcp = await import('../src/ai/litMcp.ts');
  mcp = await import('../src/ai/mcp.ts');
  await import('../src/api/modules/ai.ts');
  await import('../src/api/modules/agents.ts');
  A = newId();
  B = newId();
  seed.createUser(A, 'owner@mcp.dev', 'Olive Owner');
  seed.createUser(B, 'member@mcp.dev', 'Max Member');
  spaceId = seed.createWorkspace(A, 'MCP Lab').space.id;
  seed.addMember(spaceId, B, 'member');
});

describe('MCP clients: approved list, visibility, disconnect', () => {
  it('tokens remember their client; approved-only blocks other clients until an owner approves them', async () => {
    const owner = nmcp.createToken(A, spaceId, 'Desk').token;
    const member = nmcp.createToken(B, spaceId, 'IDE').token;
    const member2 = nmcp.createToken(B, spaceId, 'Bot').token;
    await initialize(owner, 'Claude Desktop');
    await initialize(member, 'Cursor');
    await initialize(member2, 'acme-internal-bot');
    // the owner's client was approved automatically; first connections are audited
    expect(nmcp.clientPolicy(db.getRecord<any>('space', spaceId)).approved.map((a) => a.key)).toEqual(['claude']);
    expect(auditEvents('workspace_mcp_server_connected')).toHaveLength(3);
    const list = await call(A, 'mcpListClients', { spaceId });
    expect(list.clients.find((c: any) => c.key === 'cursor')).toMatchObject({ name: 'Cursor', known: true, approved: false, members: 1 });
    expect(list.clients.find((c: any) => c.key === 'custom:acme-internal-bot')).toMatchObject({ name: 'acme-internal-bot', known: false });
    expect(list.catalog.some((c: any) => c.key === 'perplexity')).toBe(true);
    // members can't manage clients
    expect(await status(() => call(B, 'mcpListClients', { spaceId }))).toBe(403);
    expect(await status(() => call(B, 'mcpSetClientRestriction', { spaceId, restricted: true }))).toBe(403);
    // approved only: Cursor is blocked, the owner's Claude keeps working
    await call(A, 'mcpSetClientRestriction', { spaceId, restricted: true });
    const blocked = await rpc(member, 'tools/call', { name: 'lit-get-self', arguments: {} });
    expect((blocked.body as any).error).toMatchObject({ code: -32003 });
    expect((await rpc(owner, 'tools/call', { name: 'lit-get-self', arguments: {} })).body).toMatchObject({ result: expect.any(Object) });
    expect(auditEvents('workspace_mcp_allowlist_enabled')).toHaveLength(1);
    // approve Cursor → works
    await call(A, 'mcpApproveClients', { spaceId, keys: ['cursor', 'not-a-client'] });
    expect((await rpc(member, 'tools/call', { name: 'lit-get-self', arguments: {} })).body).toMatchObject({ result: expect.any(Object) });
    expect(auditEvents('workspace_mcp_client_added_to_allowlist').map((r) => JSON.parse(r.data).client)).toEqual(['Claude', 'Cursor']);
    // rename the unknown client, approve it under its new name, then remove Cursor again
    await call(A, 'mcpRenameClient', { spaceId, key: 'custom:acme-internal-bot', name: 'Acme Assistant' });
    const renamed = (await call(A, 'mcpListClients', { spaceId })).clients.find((c: any) => c.key === 'custom:acme-internal-bot');
    expect(renamed).toMatchObject({ name: 'Acme Assistant', renamed: true, blocked: true });
    await call(A, 'mcpRemoveApprovedClient', { spaceId, key: 'cursor' });
    expect((await rpc(member, 'tools/list')).body).toMatchObject({ error: { code: -32003 } });
  });

  it('owners see who connected a client and disconnect one member or everyone', async () => {
    const t2 = nmcp.createToken(A, spaceId, 'Second').token;
    await initialize(t2, 'Cursor');
    const members = (await call(A, 'mcpClientMembers', { spaceId, key: 'cursor' })).members;
    expect(members.map((m: any) => m.name).sort()).toEqual(['Max Member', 'Olive Owner']);
    expect((await call(A, 'mcpDisconnectClient', { spaceId, key: 'cursor', memberId: B })).revoked).toBe(1);
    expect((await call(A, 'mcpClientMembers', { spaceId, key: 'cursor' })).members.map((m: any) => m.name)).toEqual(['Olive Owner']);
    expect((await call(A, 'mcpDisconnectClient', { spaceId, key: 'cursor' })).revoked).toBe(1);
    expect((await rpc(t2, 'tools/list')).status).toBe(401);
    await call(A, 'mcpSetClientRestriction', { spaceId, restricted: false });
  });
});

describe('memory sync over Litpage MCP', () => {
  it('saves and reads the person’s memories; off when Memories are off', async () => {
    const token = nmcp.createToken(B, spaceId, 'Agent').token;
    await initialize(token, 'Claude Code');
    const tools = ((await rpc(token, 'tools/list')).body as any).result.tools.map((t: any) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['lit-get-memories', 'lit-save-memory']));
    expect(((await rpc(token, 'tools/call', { name: 'lit-get-memories', arguments: {} })).body as any).result.content[0].text).toBe('No memories yet.');
    const saved = (await rpc(token, 'tools/call', { name: 'lit-save-memory', arguments: { memory: 'I prefer weekly summaries on Mondays' } })).body as any;
    expect(saved.result.isError).toBeFalsy();
    const got = ((await rpc(token, 'tools/call', { name: 'lit-get-memories', arguments: {} })).body as any).result.content[0].text;
    expect(got).toContain('weekly summaries on Mondays');
    // Olive can't read Max's memories through her own token
    const own = nmcp.createToken(A, spaceId, 'Mine').token;
    await initialize(own, 'Claude Desktop');
    expect(((await rpc(own, 'tools/call', { name: 'lit-get-memories', arguments: {} })).body as any).result.content[0].text).not.toContain('Mondays');
    setSpaceSettings({ ai_memories: false });
    try {
      expect(((await rpc(token, 'tools/list')).body as any).result.tools.map((t: any) => t.name)).not.toContain('lit-save-memory');
      expect(((await rpc(token, 'tools/call', { name: 'lit-save-memory', arguments: { memory: 'x' } })).body as any).result.isError).toBe(true);
    } finally {
      setSpaceSettings({ ai_memories: true });
    }
  });
});

describe('workspace shared MCPs', () => {
  let server: Server;
  let url = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        if (req.headers.authorization !== 'Bearer member-token') {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'unauthorized' }));
          return;
        }
        const m = JSON.parse(body || '{}');
        if (!('id' in m)) {
          res.writeHead(202);
          res.end();
          return;
        }
        const result = m.method === 'initialize'
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'warehouse', version: '1' } }
          : m.method === 'tools/list' ? { tools: [{ name: 'run_query', description: 'Run SQL', inputSchema: { type: 'object' } }] } : {};
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('owners share a server; members connect with their own token even when custom servers are off', async () => {
    expect(await status(() => call(B, 'mcpCreatePreset', { spaceId, name: 'Warehouse', url, auth: 'token' }))).toBe(403);
    const { preset } = await call(A, 'mcpCreatePreset', { spaceId, name: 'Warehouse', description: 'Query the data warehouse', url, auth: 'token' });
    expect((await call(B, 'mcpListPresets', { spaceId })).presets).toEqual([expect.objectContaining({ id: preset.id, name: 'Warehouse', auth: 'token' })]);
    setSpaceSettings({ ai_custom_mcp: false });
    try {
      // a custom server is refused, the shared one isn't — but it needs the member's own token
      await expect(mcp.addConnection(B, spaceId, { name: 'Other', url, token: 'member-token' })).resolves.toBeTruthy();
      mcp.removeConnection(B, mcp.listConnections(B, spaceId)[0].id);
      await expect(mcp.addConnection(B, spaceId, { presetId: preset.id })).rejects.toThrow(/paste your access token/);
      const c = await mcp.addConnection(B, spaceId, { presetId: preset.id, token: 'member-token' });
      expect(c).toMatchObject({ name: 'Warehouse', presetId: preset.id, hasToken: true });
      expect(mcp.chatMcpTools(B, spaceId, null).defs).toHaveLength(1);
      // a URL that is not the preset's stays blocked
      await expect(mcp.addConnection(B, spaceId, { name: 'Elsewhere', url: url.replace('/mcp', '/other'), token: 'member-token' })).rejects.toThrow(/are off in this workspace/);
      // a Custom Agent can connect the shared server too ("Workspace Managed")
      const sp = db.getRecord<any>('space', spaceId);
      db.putRecord('space', { ...sp, plan_type: 'business' });
      const { agentId } = await call(A, 'createAgent', { spaceId });
      const detail = await call(A, 'addAgentConnection', { agentId, presetId: preset.id, token: 'member-token' });
      expect(detail.connections).toEqual([expect.objectContaining({ name: 'Warehouse', workspaceManaged: true })]);
      // removing the preset: the URL is no longer approved
      await call(A, 'mcpDeletePreset', { spaceId, presetId: preset.id });
      expect(mcp.chatMcpTools(B, spaceId, null).defs).toHaveLength(0);
      expect(auditEvents('workspace.settings.mcp_server_added_to_allowlist')).toHaveLength(1);
      expect(auditEvents('workspace.settings.mcp_server_removed_from_allowlist')).toHaveLength(1);
    } finally {
      setSpaceSettings({ ai_custom_mcp: true });
    }
  });
});

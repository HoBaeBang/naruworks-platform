// Public API and MCP (items 14–18).
// 14 — GET /v1/comments leaves out threads on property values the token can't see (and they can't be replied to)
// 15 — a personal access token (a MCP token) on /v1 follows "Allow MCP" and "Approved MCP clients only"
// 16 — MCP tools (and every agent tool call) stay in the token's / chat's workspace
// 18 — Settings › MCP › Disable a client revokes the person's tokens connected with it
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-public-mcp-test-'));
process.env.NC_SCHEDULER = '0';

let app: typeof import('../src/app.ts')['app'];
let db: typeof import('../src/db.ts');
let nmcp: typeof import('../src/ai/litMcp.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let newId: () => string;
const ids = {} as Record<string, string>;
const now = Date.now();

const call = async (user: string, name: string, body: any = {}) => H[name]({ userId: user, setCookie: () => {} }, body);
async function api(token: string, method: string, path: string, body?: unknown) {
  const res = await app.request(`/v1${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'lit-version': '2026-10-01' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
}
const rpc = (token: string, method: string, params: Record<string, unknown> = {}) => nmcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 1, method, params });
const initialize = (token: string, name: string) => rpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name, version: '1' } });
const toolCall = async (token: string, name: string, args: Record<string, unknown>) => ((await rpc(token, 'tools/call', { name, arguments: args })).body as any).result as { content: { text: string }[]; isError?: boolean };
function setSettings(spaceId: string, patch: Record<string, unknown>) {
  const s = db.getRecord<any>('space', spaceId);
  db.putRecord('space', { ...s, settings: { ...(s.settings ?? {}), ...patch } });
}
function put(rec: Record<string, unknown>, table = 'block') {
  db.putRecord(table as any, { version: 1, alive: true, created_time: now, created_by_id: ids.owner, last_edited_time: now, ...rec } as any);
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  app = (await import('../src/app.ts')).app;
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  nmcp = await import('../src/ai/litMcp.ts');
  registry = await import('../src/ai/tools/registry.ts');
  await import('../src/api/modules/ai.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['owner', 'member']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@aisec-public.test`, n);
  }
  ids.space = seed.createWorkspace(ids.owner, 'Main').space.id;
  seed.addMember(ids.space, ids.member, 'member');
  // another workspace the member belongs to, with MCP off
  ids.other = seed.createWorkspace(ids.owner, 'Other').space.id;
  seed.addMember(ids.other, ids.member, 'member');
  setSettings(ids.other, { lit_mcp_enabled: false, ai_enabled: false });
  ids.otherPage = newId();
  put({ id: ids.otherPage, type: 'page', parent_id: ids.other, parent_table: 'space', space_id: ids.other, properties: { title: [['Other workspace secret-gecko']] }, permissions: [{ type: 'space_permission', role: 'editor' }] });
  // a database the member can edit; "Pay" is a No access property for them, with a comment thread on its value
  ids.db = newId();
  ids.col = newId();
  ids.row = newId();
  put({ id: ids.db, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, collection_id: ids.col, view_ids: [], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'read_and_write', user_id: ids.member }] });
  put({ id: ids.col, parent_id: ids.db, parent_table: 'block', space_id: ids.space, name: [['People']], schema: { title: { name: 'Name', type: 'title' }, pay: { name: 'Pay', type: 'text', property_permissions: { default_access: 'none', overrides: [] } } } }, 'collection');
  ids.payThread = newId();
  ids.pageThread = newId();
  const c1 = newId();
  const c2 = newId();
  put({ id: ids.row, type: 'page', parent_id: ids.col, parent_table: 'collection', space_id: ids.space, properties: { title: [['Ada']], pay: [['900k']] }, discussions: [ids.payThread, ids.pageThread] });
  put({ id: ids.payThread, parent_id: ids.row, parent_table: 'block', space_id: ids.space, property_id: 'pay', resolved: false, comments: [c1] }, 'discussion');
  put({ id: c1, parent_id: ids.payThread, parent_table: 'discussion', space_id: ids.space, text: [['raise to 950k-narwhal']] }, 'comment');
  put({ id: ids.pageThread, parent_id: ids.row, parent_table: 'block', space_id: ids.space, resolved: false, comments: [c2], type: 'page' }, 'discussion');
  put({ id: c2, parent_id: ids.pageThread, parent_table: 'discussion', space_id: ids.space, text: [['welcome aboard']] }, 'comment');
});

describe('GET /v1/comments (item 14)', () => {
  it('leaves out threads on property values the token can’t see', async () => {
    const memberPat = nmcp.createToken(ids.member, ids.space, 'cli').token;
    const r = await api(memberPat, 'GET', `/comments?block_id=${ids.row}`);
    expect(r.status).toBe(200);
    const text = JSON.stringify(r.json);
    expect(text).toContain('welcome aboard');
    expect(text).not.toContain('narwhal');
    const reply = await api(memberPat, 'POST', '/comments', { discussion_id: ids.payThread, rich_text: [{ text: { content: 'me too' } }] });
    expect(reply.status).toBe(404);
    const ownerPat = nmcp.createToken(ids.owner, ids.space, 'cli').token;
    expect(JSON.stringify((await api(ownerPat, 'GET', `/comments?block_id=${ids.row}`)).json)).toContain('narwhal');
  });
});

describe('personal access tokens on /v1 (item 15)', () => {
  it('follow "Allow Litpage MCP" and "Approved MCP clients only"', async () => {
    const pat = nmcp.createToken(ids.member, ids.space, 'scripts').token;
    expect((await api(pat, 'GET', '/users/me')).status).toBe(200);
    setSettings(ids.space, { lit_mcp_enabled: false });
    const off = await api(pat, 'GET', '/users/me');
    expect(off.status).toBe(403);
    expect(off.json.message).toMatch(/Litpage MCP is turned off/);
    setSettings(ids.space, { lit_mcp_enabled: true });
    // approved clients only: an unapproved (or unidentified) client's token stops; the owner's keeps working
    await initialize(pat, 'Cursor');
    setSettings(ids.space, { mcp_clients_restricted: true });
    try {
      expect((await api(pat, 'GET', '/users/me')).status).toBe(403);
      const ownerPat = nmcp.createToken(ids.owner, ids.space, 'owner').token;
      expect((await api(ownerPat, 'GET', '/users/me')).status).toBe(200);
      setSettings(ids.space, { mcp_clients_approved: [{ key: 'cursor', name: 'Cursor', approved_by: ids.owner, approved_time: now }] });
      expect((await api(pat, 'GET', '/users/me')).status).toBe(200);
    } finally {
      setSettings(ids.space, { mcp_clients_restricted: false, mcp_clients_approved: [] });
    }
  });
});

describe('workspace scope (item 16)', () => {
  it('Litpage MCP tools only reach the token’s workspace', async () => {
    const pat = nmcp.createToken(ids.member, ids.space, 'mcp').token;
    await initialize(pat, 'Claude');
    const fetched = await toolCall(pat, 'lit-fetch', { id: ids.otherPage });
    expect(fetched.isError).toBe(true);
    expect(fetched.content[0].text).not.toContain('secret-gecko');
    const upd = await toolCall(pat, 'lit-update-page', { page_id: ids.otherPage, command: 'update_properties', title: 'Hijacked' });
    expect(upd.isError).toBe(true);
    const created = await toolCall(pat, 'lit-create-pages', { parent: { type: 'page', id: ids.otherPage }, pages: [{ title: 'Planted' }] });
    expect(created.isError).toBe(true);
    expect(JSON.stringify(db.getRecord<any>('block', ids.otherPage).properties)).toContain('secret-gecko');
    expect(db.getRecord<any>('block', ids.otherPage).content ?? []).toHaveLength(0);
    // the same holds for any agent tool call (chat, Custom Agents): another workspace's page is "not found"
    const env = { userId: ids.member, spaceId: ids.space, threadId: null, turnId: 't', currentPageId: null, approvalMode: 'skip_all', memories: false, cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept' } as any;
    const read = await registry.runTool(env, 'read_page', { page_id: ids.otherPage }, 's1');
    expect(read.isError).toBe(true);
    // the page's own workspace is unaffected by the scope of another call
    const own = await registry.runTool({ ...env, spaceId: ids.other }, 'read_page', { page_id: ids.otherPage }, 's2');
    expect(own.content).toContain('secret-gecko');
  });
});

describe('Disable an MCP client (item 18)', () => {
  it('revokes my tokens connected with it, nobody else’s', async () => {
    const mine = nmcp.createToken(ids.member, ids.space, 'cursor').token;
    const other = nmcp.createToken(ids.member, ids.space, 'claude').token;
    const owners = nmcp.createToken(ids.owner, ids.space, 'owner cursor').token;
    await initialize(mine, 'Cursor');
    await initialize(other, 'Claude Desktop');
    await initialize(owners, 'Cursor');
    expect((await rpc(mine, 'tools/list')).status).toBe(200);
    const r = await call(ids.member, 'mcpDisableMyClient', { spaceId: ids.space, client: { id: 'cursor', name: 'Cursor' } });
    expect(r.revoked).toBe(2); // this one and the earlier Cursor token (item 15)
    expect((await rpc(mine, 'tools/list')).status).toBe(401);
    expect((await rpc(other, 'tools/list')).status).toBe(200);
    expect((await rpc(owners, 'tools/list')).status).toBe(200);
  });
});

// AI service workspace plumbing against a real (temporary) SQLite workspace:
// - AI Autofill "On page update": a row edit schedules a refill that runs as the editing user through an ordinary
// transaction; autofill's own writes and edits of the autofill property itself don't retrigger it; a workspace
// with AI service turned off is left alone.
// - Custom MCP connections: HTTPS only, workspace switch + URL allowlist, token checked against the server
// (a local JSON-RPC server), per-user isolation, and the MCP tools a chat offers (run client-side).
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-workspace-test-'));
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';
process.env.NC_AI_AUTOFILL_DEBOUNCE_MS = '20';
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
/** Fake Claude client answering every request with `answer(params)`. */
function fake(answer: (params: any) => string, seen: any[] = []) {
  return {
    seen,
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(params);
          const text = answer(params);
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
              yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
            },
            finalMessage: async () => ({ model: 'claude-haiku-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }),
          };
        }) as any,
      },
    },
  };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let db: typeof import('../src/db.ts');
let records: typeof import('../src/records.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let auto: typeof import('../src/ai/autofillAuto.ts');
let mcp: typeof import('../src/ai/mcp.ts');
let newId: () => string;
let A = '';
let B = '';
let C = '';
let spaceId = '';
let otherSpace = '';

const block = (id: string) => db.getRecord<any>('block', id);
const tx = (userId: string, ops: any[], action = 'test.edit') => records.applyTransactions(userId, [{ id: newId(), spaceId, debug: { userAction: action }, operations: ops }], undefined, { client: true });
const setTitle = (userId: string, id: string, t: string) => tx(userId, [{ pointer: { table: 'block', id, spaceId }, path: ['properties', 'title'], command: 'set', args: [[t]] }]);
const setSpaceSettings = (patch: Record<string, unknown>) => tx(A, [{ pointer: { table: 'space', id: spaceId, spaceId }, path: ['settings'], command: 'update', args: patch }], 'test.settings');

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  const seed = await import('../src/seed.ts');
  db = await import('../src/db.ts');
  records = await import('../src/records.ts');
  registry = await import('../src/ai/tools/registry.ts');
  auto = await import('../src/ai/autofillAuto.ts');
  mcp = await import('../src/ai/mcp.ts');
  A = newId();
  B = newId();
  C = newId();
  seed.createUser(A, 'ada@ws.dev', 'Ada');
  seed.createUser(B, 'bo@ws.dev', 'Bo');
  seed.createUser(C, 'cy@ws.dev', 'Cy');
  spaceId = seed.createWorkspace(A, 'Workspace Lab').space.id;
  seed.addMember(spaceId, B, 'member');
  otherSpace = seed.createWorkspace(C, 'Elsewhere').space.id;
  auto.installAutofillHook();
});

describe('AI Autofill — On page update', () => {
  let dbId = '';
  let rowId = '';
  let sumPid = '';
  let colId = '';
  let basePerms: any[] = [];
  const calls: any[] = [];

  beforeAll(async () => {
    const env = {
      userId: A, spaceId, threadId: 't', turnId: 'turn-autofill', currentPageId: null, approvalMode: 'skip_all', memories: true,
      cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept',
    } as any;
    const r = await registry.runTool(env, 'create_database', {
      title: 'Deals', properties: [{ name: 'Name', type: 'title' }, { name: 'Summary', type: 'text' }],
      rows: [{ Name: 'Acme expansion' }],
    }, 's1');
    expect(r.isError).toBeFalsy();
    dbId = /database_id: ([0-9a-f-]{36})/.exec(r.content)![1];
    colId = block(dbId).collection_id;
    const col = db.getRecord<any>('collection', colId);
    sumPid = Object.keys(col.schema).find((k) => col.schema[k].name === 'Summary')!;
    const q = await registry.runTool(env, 'query_database', { database_id: dbId }, 's2');
    rowId = /\| ([0-9a-f-]{36}) \| Acme expansion/.exec(q.content)![1];
    expect(rowId).toBeTruthy();
    // share the database with Bo as an editor
    tx(A, [{ pointer: { table: 'block', id: dbId, spaceId }, path: ['permissions'], command: 'set', args: [...(block(dbId).permissions ?? []), { type: 'user_permission', role: 'editor', user_id: B }] }]);
    basePerms = block(dbId).permissions;
    tx(A, [{ pointer: { table: 'collection', id: colId, spaceId }, path: ['schema', sumPid, 'ai_autofill'], command: 'set', args: { kind: 'summary', auto_update: true } }], 'aiAutofill.configure');
    auto.setAutofillClientForTests(fake((p) => {
      const user = JSON.stringify(p.messages);
      return `Summary of ${/Title: ([^\\]+?)\\n/.exec(user)?.[1] ?? 'row'}`;
    }, calls) as any);
  });
  afterAll(() => auto.setAutofillClientForTests(undefined));

  it('refills after a member edits the row', async () => {
    setTitle(B, rowId, 'Acme renewal');
    await sleep(150);
    expect(block(rowId).properties[sumPid]).toEqual([['Summary of Acme renewal']]);
    expect(calls.length).toBe(1);
    expect(JSON.stringify(calls[0].system)).toContain('You fill in one property value');
  });

  it('runs as the editing user: no refill once that user lost access', async () => {
    setTitle(B, rowId, 'Acme secret');
    // revoke Bo before the debounced refill runs
    tx(A, [{ pointer: { table: 'block', id: dbId, spaceId }, path: ['permissions'], command: 'set', args: basePerms.filter((p: any) => p.user_id !== B) }]);
    await sleep(150);
    expect(calls.length).toBe(1);
    expect(block(rowId).properties[sumPid]).toEqual([['Summary of Acme renewal']]);
    tx(A, [{ pointer: { table: 'block', id: dbId, spaceId }, path: ['permissions'], command: 'set', args: basePerms }]);
    await sleep(100);
  });

  it('does not retrigger on its own write or on edits of the autofill property', async () => {
    await sleep(100);
    expect(calls.length).toBe(1);
    tx(A, [{ pointer: { table: 'block', id: rowId, spaceId }, path: ['properties', sumPid], command: 'set', args: [['Hand-written']] }]);
    await sleep(120);
    expect(calls.length).toBe(1);
    expect(block(rowId).properties[sumPid]).toEqual([['Hand-written']]);
  });

  it('debounces bursts of edits into one refill', async () => {
    setTitle(A, rowId, 'Acme a');
    setTitle(A, rowId, 'Acme b');
    setTitle(A, rowId, 'Acme final');
    await sleep(150);
    expect(calls.length).toBe(2);
    expect(block(rowId).properties[sumPid]).toEqual([['Summary of Acme final']]);
  });

  it('stays off when Litpage AI is disabled for the workspace or the autofill is removed', async () => {
    setSpaceSettings({ ai_enabled: false });
    setTitle(A, rowId, 'Acme disabled');
    await sleep(120);
    expect(calls.length).toBe(2);
    expect(block(rowId).properties[sumPid]).toEqual([['Summary of Acme final']]);
    setSpaceSettings({ ai_enabled: true });
    tx(A, [{ pointer: { table: 'collection', id: colId, spaceId }, path: ['schema', sumPid, 'ai_autofill'], command: 'set', args: null }], 'aiAutofill.delete');
    setTitle(A, rowId, 'Acme removed');
    await sleep(120);
    expect(calls.length).toBe(2);
  });
});

describe('suggested edits by the agent', () => {
  let pageId = '';
  let blockId = '';
  const envFor = (userId: string, turnId: string) => ({
    userId, spaceId, threadId: 't-suggest', turnId, currentPageId: null, approvalMode: 'skip_all', memories: true,
    cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept',
  } as any);
  beforeAll(async () => {
    const seed = await import('../src/seed.ts');
    const p = seed.createPage({
      spaceId, userId: A, parentId: spaceId, parentTable: 'space', title: 'Launch memo', content: [{ type: 'text', title: [['We ship on Friday after QA.']] }],
      permissions: [{ type: 'user_permission', role: 'editor', user_id: A }, { type: 'user_permission', role: 'comment_only', user_id: B }],
    });
    pageId = p.id;
    blockId = block(pageId).content[0];
  });

  it('a commenter cannot edit directly but can suggest; the suggestion is theirs and Undo removes it', async () => {
    const direct = await registry.runTool(envFor(B, 'turn-direct'), 'update_page', { page_id: pageId, command: 'replace_content_range', selection_with_ellipsis: 'Friday', new_str: 'Monday' }, 'x1');
    expect(direct.isError).toBe(true);
    const r = await registry.runTool(envFor(B, 'turn-suggest'), 'update_page', { page_id: pageId, command: 'replace_content_range', selection_with_ellipsis: 'Friday', new_str: 'Monday', suggest: true }, 'x2');
    expect(r.isError).toBeFalsy();
    const title = block(blockId).properties.title as any[];
    const removed = title.find((d) => d[0] === 'Friday');
    const added = title.find((d) => d[0] === 'Monday');
    expect(removed?.[1]?.[0]?.[0]).toBe('sr');
    expect(added?.[1]?.[0]?.[0]).toBe('si');
    const did = added[1][0][1];
    expect(removed[1][0][1]).toBe(did);
    const d = db.getRecord<any>('discussion', did);
    expect(d).toMatchObject({ type: 'suggestion', created_by_id: B, parent_id: blockId, alive: true });
    expect(block(blockId).discussions).toContain(did);
    const changes = await import('../src/ai/changes.ts');
    const u = changes.undoTurn(B, 'turn-suggest');
    expect(u.reverted).toBeGreaterThan(0);
    expect(block(blockId).properties.title).toEqual([['We ship on Friday after QA.']]);
    expect(db.getRecord<any>('discussion', did).alive).toBe(false);
  });

  it('rejects ranges across blocks, unknown text and readers', async () => {
    const miss = await registry.runTool(envFor(A, 'turn-miss'), 'update_page', { page_id: pageId, command: 'replace_content_range', selection_with_ellipsis: 'Tuesday', new_str: 'x', suggest: true }, 'x3');
    expect(miss.isError).toBe(true);
    const wrong = await registry.runTool(envFor(A, 'turn-wrong'), 'update_page', { page_id: pageId, command: 'append_content', new_str: 'x', suggest: true }, 'x4');
    expect(wrong.isError).toBe(true);
    expect(wrong.content).toMatch(/replace_content_range/);
    const reader = await registry.runTool(envFor(C, 'turn-reader'), 'update_page', { page_id: pageId, command: 'replace_content_range', selection_with_ellipsis: 'Friday', new_str: 'Monday', suggest: true }, 'x5');
    expect(reader.isError).toBe(true);
  });
});

describe('custom MCP connections', () => {
  let server: Server;
  let url = '';
  const seenAuth: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; });
      req.on('end', () => {
        seenAuth.push(String(req.headers.authorization ?? ''));
        if (req.headers.authorization !== 'Bearer good-token') {
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
          ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'unit', version: '1' } }
          : m.method === 'tools/list'
            ? { tools: [{ name: 'get_weather', description: 'Weather', inputSchema: { type: 'object' } }, { name: 'delete_everything', description: 'Danger', inputSchema: { type: 'object' } }] }
            : {};
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('requires HTTPS (loopback http only in development)', async () => {
    await expect(mcp.addConnection(A, spaceId, { name: 'Plain', url: 'http://example.com/mcp' })).rejects.toThrow(/must use HTTPS/);
    await expect(mcp.addConnection(A, spaceId, { name: 'Bad', url: 'not a url' })).rejects.toThrow();
  });

  it('checks the token against the server and lists its tools', async () => {
    await expect(mcp.addConnection(A, spaceId, { name: 'Weather', url, token: 'wrong' })).rejects.toThrow(/Connection failed/);
    const c = await mcp.addConnection(A, spaceId, { name: 'Weather', url, token: 'good-token' });
    expect(c.name).toBe('Weather');
    expect(c.tools.map((t: any) => t.name)).toEqual(['get_weather', 'delete_everything']);
    expect(JSON.stringify(c)).not.toContain('good-token');
    expect(seenAuth).toContain('Bearer good-token');
  });

  it('keeps connections per user and offers only the owner’s enabled tools to their chats', async () => {
    const [c] = mcp.listConnections(A, spaceId);
    expect(mcp.listConnections(B, spaceId)).toHaveLength(0);
    expect(mcp.listConnections(C, otherSpace)).toHaveLength(0);
    mcp.updateConnection(A, c.id, { disabledTools: ['delete_everything'] });
    const p = mcp.chatMcpTools(A, spaceId, [c.id]);
    expect([...p.map.values()].map((t) => t.tool.name)).toEqual(['get_weather']);
    expect(p.defs[0].name).toBe(mcp.mcpToolName(c.id, 'get_weather'));
    expect(JSON.stringify(p.defs)).not.toContain('good-token');
    expect(mcp.chatMcpTools(B, spaceId, [c.id]).defs).toHaveLength(0);
    expect(() => mcp.updateConnection(B, c.id, { enabled: false })).toThrow(/doesn’t exist/);
  });

  it('follows the workspace switch and URL allowlist', async () => {
    setSpaceSettings({ ai_custom_mcp: false });
    await expect(mcp.addConnection(A, spaceId, { name: 'Again', url, token: 'good-token' })).rejects.toThrow(/are off in this workspace/);
    expect(mcp.chatMcpTools(A, spaceId, null).defs).toHaveLength(0);
    setSpaceSettings({ ai_custom_mcp: true, ai_mcp_allowlist: ['https://mcp.litpage.dev/*'] });
    await expect(mcp.addConnection(A, spaceId, { name: 'Again', url, token: 'good-token' })).rejects.toThrow(/is not approved for this workspace/);
    expect(mcp.chatMcpTools(A, spaceId, null).defs).toHaveLength(0);
    setSpaceSettings({ ai_mcp_allowlist: [] });
    expect(mcp.chatMcpTools(A, spaceId, null).defs).toHaveLength(1);
  });
});

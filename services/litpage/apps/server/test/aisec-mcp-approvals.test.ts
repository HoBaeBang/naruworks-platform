// item 7: a chat's MCP connections run through the Agent's own tool loop, so the approval mode applies to
// connected apps ("Always ask" asks before using connected apps, "Review for me" before risky actions).
// Nothing is handed to the API's MCP connector (no mcp_servers), read-only tools never
// ask, write tools ask in Always ask and Review for me, destructive ones are flagged, Skip all approvals runs them, a
// declined call never reaches the MCP server, Research offers read-only tools only, and the workspace switch applies.
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-mcp-test-'));
process.env.NC_SCHEDULER = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fake(turns: { events?: any[]; final: any }[], seen: any[] = []) {
  let i = 0;
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const t = turns[Math.min(i++, turns.length - 1)];
          return {
            async *[Symbol.asyncIterator]() { for (const e of t.events ?? []) yield e; },
            finalMessage: async () => t.final,
          };
        }) as any,
      },
    },
  };
}
const say = (text: string) => ({
  events: [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
  final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage },
});
const callTool = (name: string, input: Record<string, unknown>, id = `tu_${Math.random().toString(36).slice(2, 9)}`) => ({
  events: [{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } }],
  final: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage },
});

let db: typeof import('../src/db.ts');
let svc: typeof import('../src/ai/service.ts');
let mcp: typeof import('../src/ai/mcp.ts');
let approvals: typeof import('../src/ai/approvals.ts');
let newId: () => string;
let A = '';
let spaceId = '';
let conn = '';
let server: Server;
const calls: { name: string; arguments: unknown }[] = [];

function setSpaceSettings(patch: Record<string, unknown>) {
  const s = db.getRecord<any>('space', spaceId);
  db.putRecord('space', { ...s, settings: { ...(s.settings ?? {}), ...patch } });
}

async function turn(text: string, opts: { approvalMode?: string; mode?: string; tool?: string; input?: Record<string, unknown>; answer?: 'accept' | 'decline' }) {
  const seen: any[] = [];
  const asked: any[] = [];
  const prep = svc.prepareChatTurn({ userId: A, spaceId, text, approvalMode: opts.approvalMode ?? 'review_for_me', ...(opts.mode ? { mode: opts.mode } : {}) } as any);
  const res = await svc.executeChatTurn(prep, {
    step: (s) => {
      if (s.status === 'waiting' && s.approval) {
        asked.push(s);
        setTimeout(() => approvals.decideApproval(A, s.approval!.id, opts.answer ?? 'decline'), 5);
      }
    },
  }, undefined, fake([...(opts.tool ? [callTool(mcp.mcpToolName(conn, opts.tool), opts.input ?? {})] : []), say('Done.'), say('t')], seen) as any);
  return { res, seen, asked, step: res.message?.data.steps?.find((s) => s.tool === 'mcp') };
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  db = await import('../src/db.ts');
  svc = await import('../src/ai/service.ts');
  mcp = await import('../src/ai/mcp.ts');
  approvals = await import('../src/ai/approvals.ts');
  const seed = await import('../src/seed.ts');
  A = newId();
  seed.createUser(A, 'a@aisec-mcp.test', 'Ada');
  spaceId = seed.createWorkspace(A, 'MCP').space.id;
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const m = JSON.parse(body || '{}');
      if (!('id' in m)) {
        res.writeHead(202);
        res.end();
        return;
      }
      let result: unknown = {};
      if (m.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'unit', version: '1' } };
      else if (m.method === 'tools/list') {
        result = {
          tools: [
            { name: 'get_weather', description: 'Weather', inputSchema: { type: 'object', properties: { city: { type: 'string' } } }, annotations: { readOnlyHint: true } },
            { name: 'delete_everything', description: 'Danger', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
            { name: 'post_message', description: 'Posts a message', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
          ],
        };
      } else if (m.method === 'tools/call') {
        calls.push(m.params);
        result = { content: [{ type: 'text', text: `ran ${m.params.name}` }] };
      }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  conn = (await mcp.addConnection(A, spaceId, { name: 'Ops', url })).id;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('chat MCP tools run through the approval step', () => {
  it('are client tools: no MCP connector, disabled tools left out', async () => {
    mcp.updateConnection(A, conn, { disabledTools: ['post_message'] });
    const { seen } = await turn('hi', {});
    expect(seen[0].mcp_servers).toBeUndefined();
    expect(String(seen[0].betas ?? '')).not.toContain('mcp-client');
    const names = seen[0].tools.map((t: any) => t.name);
    expect(names).toContain(mcp.mcpToolName(conn, 'get_weather'));
    expect(names).toContain(mcp.mcpToolName(conn, 'delete_everything'));
    expect(names).not.toContain(mcp.mcpToolName(conn, 'post_message'));
    mcp.updateConnection(A, conn, { disabledTools: [] });
  });

  it('read-only tools run without asking, even in Always ask', async () => {
    const before = calls.length;
    const r = await turn('weather?', { approvalMode: 'always_ask', tool: 'get_weather', input: { city: 'Seoul' } });
    expect(r.asked).toHaveLength(0);
    expect(calls.length).toBe(before + 1);
    expect(r.step).toMatchObject({ status: 'done', label: 'Ran MCP tool: get_weather' });
  });

  it('Review for me asks before a destructive or writing tool; a rejected call never reaches the server', async () => {
    const before = calls.length;
    const del = await turn('delete it', { tool: 'delete_everything', answer: 'decline' });
    expect(del.asked).toHaveLength(1);
    expect(del.asked[0].approval).toMatchObject({ title: 'Run delete_everything', danger: true });
    expect(del.step?.status).toBe('declined');
    const post = await turn('post it', { tool: 'post_message', input: { text: 'hello' }, answer: 'decline' });
    expect(post.asked).toHaveLength(1);
    expect(calls.length).toBe(before);
    const ok = await turn('post it', { tool: 'post_message', input: { text: 'hello' }, answer: 'accept' });
    expect(ok.step?.status).toBe('done');
    expect(calls.at(-1)).toMatchObject({ name: 'post_message', arguments: { text: 'hello' } });
  });

  it('Always ask asks for writes; Skip all approvals runs them', async () => {
    const asked = await turn('post', { approvalMode: 'always_ask', tool: 'post_message', answer: 'decline' });
    expect(asked.asked).toHaveLength(1);
    const before = calls.length;
    const skip = await turn('delete', { approvalMode: 'skip_all', tool: 'delete_everything' });
    expect(skip.asked).toHaveLength(0);
    expect(calls.length).toBe(before + 1);
  });

  it('Research offers read-only MCP tools only; the workspace switch turns them off', async () => {
    const { seen } = await turn('research', { mode: 'research' });
    const names = seen[0].tools.map((t: any) => t.name);
    expect(names).toContain(mcp.mcpToolName(conn, 'get_weather'));
    expect(names).not.toContain(mcp.mcpToolName(conn, 'delete_everything'));
    setSpaceSettings({ ai_custom_mcp: false });
    const off = await turn('hi', {});
    expect(off.seen[0].tools.map((t: any) => t.name).some((n: string) => n.startsWith('mcp_'))).toBe(false);
    // a tool name from an earlier turn is refused once the connection isn't offered
    const before = calls.length;
    const stale = await turn('delete', { approvalMode: 'skip_all', tool: 'delete_everything' });
    expect(calls.length).toBe(before);
    expect(stale.res.status).toBe('complete');
    setSpaceSettings({ ai_custom_mcp: true });
  });
});

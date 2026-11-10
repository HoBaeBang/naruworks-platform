// AI Agent tools against a real (temporary) SQLite workspace: every executor acts as a given user through
// applyTransactions (permission checks), changes are logged and undoable (conflicts skipped, newest first),
// approvals gate writes, databases / rows / comments / memory work, the chat turn records steps and changes,
// and the MCP server runs the same tools behind per-user tokens.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-agent-test-'));
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

type Ev = Record<string, any>;
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function fake(turns: { events?: Ev[]; final: Ev }[], seen: any[] = []) {
  let i = 0;
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const t = turns[Math.min(i++, turns.length - 1)];
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of t.events ?? []) yield e;
            },
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
const callTool = (name: string, input: Record<string, unknown>, id = `tu_${name}_${Math.random().toString(36).slice(2, 7)}`) => ({
  events: [{ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id, name, input: {} } }],
  final: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage },
});

let db: typeof import('../src/db.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let changes: typeof import('../src/ai/changes.ts');
let edit: typeof import('../src/ai/edit.ts');
let svc: typeof import('../src/ai/service.ts');
let mcp: typeof import('../src/ai/litMcp.ts');
let approvals: typeof import('../src/ai/approvals.ts');
let A = '';
let B = '';
let spaceId = '';
let svA = '';
let privatePage = '';
let sharedReadOnly = '';
let sharedEditable = '';

function env(userId: string, over: Partial<import('../src/ai/tools/types.ts').AgentEnv> = {}) {
  const steps: any[] = [];
  const e: import('../src/ai/tools/types.ts').AgentEnv & { steps: any[] } = {
    userId, spaceId, threadId: 'thread-' + userId, turnId: `turn-${Math.random().toString(36).slice(2)}`, currentPageId: null,
    approvalMode: 'skip_all', memories: true, cite: () => 1, step: (s) => steps.push(s), touched: () => {}, approve: async () => 'accept', steps, ...over,
  } as any;
  return e;
}

const block = (id: string) => db.getRecord<any>('block', id);
const title = (id: string) => (block(id)?.properties?.title ?? []).map((d: any) => d[0]).join('');

beforeAll(async () => {
  const { newId } = await import('@nc/shared/ids.ts');
  const seed = await import('../src/seed.ts');
  db = await import('../src/db.ts');
  registry = await import('../src/ai/tools/registry.ts');
  changes = await import('../src/ai/changes.ts');
  edit = await import('../src/ai/edit.ts');
  svc = await import('../src/ai/service.ts');
  mcp = await import('../src/ai/litMcp.ts');
  approvals = await import('../src/ai/approvals.ts');
  A = newId();
  B = newId();
  seed.createUser(A, 'ada@agent.dev', 'Ada');
  seed.createUser(B, 'bo@agent.dev', 'Bo');
  const w = seed.createWorkspace(A, 'Agent Lab');
  spaceId = w.space.id;
  svA = w.spaceView.id;
  privatePage = w.spaceView.private_pages[0];
  seed.addMember(spaceId, B, 'member');
  const mk = (t: string, perms: any[]) => seed.createPage({ spaceId, userId: A, parentId: spaceId, parentTable: 'space', title: t, content: [{ type: 'text', title: [[`Body of ${t}`]] }], permissions: perms }).id;
  sharedReadOnly = mk('Read only for Bo', [{ type: 'user_permission', role: 'editor', user_id: A }, { type: 'user_permission', role: 'reader', user_id: B }]);
  sharedEditable = mk('Shared plan', [{ type: 'user_permission', role: 'editor', user_id: A }, { type: 'user_permission', role: 'read_and_write', user_id: B }]);
});

describe('page tools act as the user', () => {
  it('create_pages in private pages, then Undo removes them', async () => {
    const e = env(A);
    const r = await registry.runTool(e, 'create_pages', { pages: [{ title: 'Launch plan', icon: '🚀', content: '## Goals\n\n- Ship **v2**\n- [ ] Write docs' }] }, 's1');
    expect(r.isError).toBeFalsy();
    const id = /page_id: ([0-9a-f-]{36})/.exec(r.content)![1];
    expect(title(id)).toBe('Launch plan');
    expect(block(id).format.page_icon).toBe('🚀');
    const kids = block(id).content.map((k: string) => block(k));
    expect(kids.map((k: any) => k.type)).toEqual(['sub_header', 'bulleted_list', 'to_do']);
    expect(kids[1].properties.title).toEqual([['Ship '], ['v2', [['b']]]]);
    expect(db.getRecord<any>('space_view', svA).private_pages[0]).toBe(id);
    expect(e.steps.at(-1)).toMatchObject({ status: 'done', label: 'Added 1 page' });
    const undo = changes.undoTurn(A, e.turnId);
    expect(undo.conflicts).toBe(0);
    expect(block(id).alive).toBe(false);
    expect(db.getRecord<any>('space_view', svA).private_pages).not.toContain(id);
    expect(() => changes.undoTurn(A, e.turnId)).toThrow(/already reverted/);
  });

  it('cannot read or edit pages the user cannot access', async () => {
    const e = env(B);
    const read = await registry.runTool(e, 'read_page', { page_id: privatePage }, 's');
    expect(read.isError).toBe(true);
    const upd = await registry.runTool(e, 'update_page', { page_id: privatePage, command: 'append_content', new_str: 'hacked' }, 's');
    expect(upd.isError).toBe(true);
    expect(upd.content).toMatch(/doesn’t exist or the user can’t access it/);
    const ro = await registry.runTool(e, 'update_page', { page_id: sharedReadOnly, command: 'update_properties', title: 'Renamed' }, 's');
    expect(ro.isError).toBe(true);
    expect(ro.content).toMatch(/can only view/);
    expect(title(sharedReadOnly)).toBe('Read only for Bo');
    const del = await registry.runTool(e, 'delete_pages', { page_ids: [sharedReadOnly] }, 's');
    expect(del.isError).toBe(true);
    expect(block(sharedReadOnly).alive).toBe(true);
    // creating under a page the user can only read is refused too
    const sub = await registry.runTool(e, 'create_pages', { parent: { type: 'page', id: sharedReadOnly }, pages: [{ title: 'x' }] }, 's');
    expect(sub.isError).toBe(true);
    // and the lower layer refuses a forged operation outright
    expect(() => changes.applyAgentOps({ userId: B, spaceId, turnId: 't', threadId: null }, 'forged', [
      { pointer: { table: 'block', id: sharedReadOnly, spaceId }, path: ['properties', 'title'], command: 'set', args: [['pwned']] },
    ], [])).toThrow(/permission/);
    expect(title(sharedReadOnly)).toBe('Read only for Bo');
  });

  it('a member with edit access can edit a shared page (targeted edits by text selection)', async () => {
    const e = env(B);
    await registry.runTool(e, 'update_page', { page_id: sharedEditable, command: 'append_content', new_str: '## Risks\n\n- Budget\n- Timeline' }, 'a');
    const md = () => edit.pageUnits(sharedEditable, B).map((u) => u.markdown).join('\n');
    expect(md()).toContain('## Risks');
    const ins = await registry.runTool(e, 'update_page', { page_id: sharedEditable, command: 'insert_content_after', selection_with_ellipsis: '- Budget', new_str: '- Hiring' }, 'b');
    expect(ins.isError).toBeFalsy();
    expect(md()).toMatch(/- Budget\n- Hiring\n- Timeline/);
    const rep = await registry.runTool(e, 'update_page', { page_id: sharedEditable, command: 'replace_content_range', selection_with_ellipsis: '## Risks...Timeline', new_str: '## Risks (updated)\n\n- None' }, 'c');
    expect(rep.isError).toBeFalsy();
    expect(md()).toContain('## Risks (updated)');
    expect(md()).not.toContain('Hiring');
    const amb = await registry.runTool(e, 'update_page', { page_id: sharedEditable, command: 'insert_content_after', selection_with_ellipsis: 'zzz not there', new_str: 'x' }, 'd');
    expect(amb.isError).toBe(true);
    expect(amb.content).toMatch(/Couldn’t find/);
  });
});

describe('Undo', () => {
  it('skips values edited after the agent and must go newest first', async () => {
    const e1 = env(A, { threadId: 'undo-thread' });
    await registry.runTool(e1, 'update_page', { page_id: sharedEditable, command: 'update_properties', title: 'Agent title' }, 'u1');
    const e2 = env(A, { threadId: 'undo-thread' });
    await new Promise((r) => setTimeout(r, 5));
    await registry.runTool(e2, 'update_page', { page_id: sharedEditable, command: 'append_content', new_str: 'Later paragraph' }, 'u2');
    expect(() => changes.undoTurn(A, e1.turnId)).toThrow(/latest change/);
    expect(changes.undoTurn(A, e2.turnId).reverted).toBeGreaterThan(0);
    expect(edit.pageUnits(sharedEditable, A).map((u) => u.markdown).join('\n')).not.toContain('Later paragraph');
    // someone renames the page after the agent: undo keeps their title
    const { applyTransactions } = await import('../src/records.ts');
    applyTransactions(B, [{ id: 'manual-rename', spaceId, operations: [{ pointer: { table: 'block', id: sharedEditable, spaceId }, path: ['properties', 'title'], command: 'set', args: [['Bo’s title']] }] }], undefined, { client: true });
    const r = changes.undoTurn(A, e1.turnId);
    expect(r.conflicts).toBe(1);
    expect(title(sharedEditable)).toBe('Bo’s title');
    expect(() => changes.undoTurn(B, e1.turnId)).toThrow();
  });
});

describe('approvals', () => {
  it('a declined change leaves the workspace untouched; risks follow the approval mode', async () => {
    const before = block(sharedEditable).content.length;
    const e = env(A, { approvalMode: 'always_ask', approve: async () => 'decline' });
    const r = await registry.runTool(e, 'update_page', { page_id: sharedEditable, command: 'append_content', new_str: 'Should not appear' }, 'p');
    expect(r.content).toMatch(/rejected/);
    expect(block(sharedEditable).content.length).toBe(before);
    expect(e.steps.at(-1)).toMatchObject({ status: 'declined', label: 'Update page' });
    expect(svc.needsApproval('review_for_me', 'edit')).toBe(false);
    expect(svc.needsApproval('review_for_me', 'destructive')).toBe(true);
    expect(svc.needsApproval('always_ask', 'edit')).toBe(true);
    expect(svc.needsApproval('skip_all', 'destructive')).toBe(false);
    expect(svc.needsApproval('skip_all', 'plan')).toBe(true);
  });

  it('pending approvals are answered only by their user and decline on abort', async () => {
    const ac = new AbortController();
    const w = approvals.waitForApproval(A, 't', ac.signal);
    expect(approvals.decideApproval(B, w.id, 'accept')).toBe(false);
    expect(approvals.decideApproval(A, w.id, 'accept')).toBe(true);
    expect(await w.decision).toBe('accept');
    const w2 = approvals.waitForApproval(A, 't', ac.signal);
    ac.abort();
    expect(await w2.decision).toBe('decline');
  });
});

describe('databases', () => {
  it('creates a database, adds rows with new select options, queries and updates it', async () => {
    const e = env(A);
    const r = await registry.runTool(e, 'create_database', {
      title: 'Tasks', properties: [{ name: 'Name', type: 'title' }, { name: 'Status', type: 'select', options: ['Todo', 'Done'] }, { name: 'Due', type: 'date' }, { name: 'Points', type: 'number' }],
      views: [{ type: 'table' }, { type: 'board', group_by: 'Status' }], rows: [{ Name: 'Spec', Status: 'Todo', Points: 3 }],
    }, 'd1');
    expect(r.isError).toBeFalsy();
    const dbId = /database_id: ([0-9a-f-]{36})/.exec(r.content)![1];
    expect(block(dbId).type).toBe('collection_view_page');
    expect(block(dbId).view_ids).toHaveLength(2);
    const add = await registry.runTool(e, 'create_pages', { parent: { type: 'database', id: dbId }, pages: [{ title: 'QA', properties: { Status: 'Blocked', Due: '2026-10-24', Points: 5 } }] }, 'd2');
    expect(add.isError).toBeFalsy();
    const col = db.getRecord<any>('collection', block(dbId).collection_id);
    const status = Object.values<any>(col.schema).find((p) => p.name === 'Status');
    expect(status.options.map((o: any) => o.value)).toEqual(['Todo', 'Done', 'Blocked']);
    const q = await registry.runTool(e, 'query_database', { database_id: dbId, filters: [{ property: 'Status', operator: 'equals', value: 'blocked' }] }, 'd3');
    expect(q.content).toContain('| QA |');
    expect(q.content).not.toContain('| Spec |');
    const rowId = /\| ([0-9a-f-]{36}) \| QA/.exec(q.content)![1];
    const bad = await registry.runTool(e, 'update_page', { page_id: rowId, command: 'update_properties', properties: { Nope: 1 } }, 'd4');
    expect(bad.isError).toBe(true);
    expect(bad.content).toMatch(/Unknown property “Nope”/);
    const upd = await registry.runTool(e, 'update_database', { database_id: dbId, add_properties: [{ name: 'Owner', type: 'person' }], rename_properties: [{ from: 'Points', to: 'Estimate' }] }, 'd5');
    expect(upd.isError).toBeFalsy();
    const col2 = db.getRecord<any>('collection', block(dbId).collection_id);
    expect(Object.values<any>(col2.schema).map((p) => p.name)).toEqual(expect.arrayContaining(['Owner', 'Estimate']));
    const own = await registry.runTool(e, 'update_page', { page_id: rowId, command: 'update_properties', properties: { Owner: 'Bo', Estimate: 8 } }, 'd6');
    expect(own.isError).toBeFalsy();
    const ownerPid = Object.keys(col2.schema).find((k) => col2.schema[k].name === 'Owner')!;
    expect(block(rowId).properties[ownerPid]).toEqual([['‣', [['u', B]]]]);
  });
});

describe('comments, inbox, memory, skills', () => {
  it('comments with mentions, then memory and skill pages', async () => {
    const e = env(A);
    const c = await registry.runTool(e, 'add_comment', { page_id: sharedEditable, text: 'Looks good @Bo' }, 'c1');
    expect(c.isError).toBeFalsy();
    const d = db.getRecord<any>('discussion', block(sharedEditable).discussions.at(-1));
    const comment = db.getRecord<any>('comment', d.comments[0]);
    expect(comment.text).toEqual([['Looks good '], ['‣', [['u', B]]]]);
    const read = await registry.runTool(env(B), 'read_comments', { page_id: sharedEditable }, 'c2');
    expect(read.content).toContain('Ada');
    const mem = await registry.runTool(e, 'update_memory', { memory: 'Prefers tables for comparisons.' }, 'm1');
    expect(mem.isError).toBeFalsy();
    const settings = db.getRecord<any>('user_settings', A)?.settings;
    expect(settings.ai_instructions_page).toBeTruthy();
    expect(edit.pageUnits(settings.ai_instructions_page, A).map((u) => u.markdown).join('\n')).toContain('Prefers tables');
    const off = await registry.runTool(env(A, { memories: false }), 'update_memory', { memory: 'x' }, 'm2');
    expect(off.isError).toBe(true);
    const sk = await registry.runTool(e, 'create_skill', { title: 'Weekly recap', description: 'Use for Friday recaps', instructions: '1. List what shipped\n2. List what slipped' }, 'k1');
    expect(sk.isError).toBeFalsy();
    const skills = await import('../src/ai/skills.ts');
    const list = skills.listSkills(A, spaceId);
    const mine = list.enabled.find((s) => s.name === 'Weekly recap')!;
    expect(mine.description).toBe('Use for Friday recaps');
    expect(mine.instructions).toContain('List what shipped');
    expect(skills.automaticSkills(A, spaceId).map((s) => s.name)).toContain('Weekly recap');
    // Bo can't see Ada's private skill page
    expect(skills.listSkills(B, spaceId).discover.find((s) => s.name === 'Weekly recap')).toBeUndefined();
    const use = await registry.runTool(e, 'use_skill', { skill_id: mine.id }, 'k2');
    expect(use.content).toContain('List what slipped');
  });

  it('read-only modes refuse write tools', async () => {
    const r = await registry.runTool(env(A), 'create_pages', { pages: [{ title: 'x' }] }, 'r', new Set(['search_workspace', 'read_page']));
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/isn’t available/);
  });
});

describe('chat turn', () => {
  it('runs write tools, persists steps and the changes for Undo', async () => {
    const prep = svc.prepareChatTurn({ userId: A, spaceId, text: 'Create a page called Roadmap', approvalMode: 'review_for_me' } as any);
    const stepsSeen: any[] = [];
    const changed: any[] = [];
    const res = await svc.executeChatTurn(prep, { step: (s) => stepsSeen.push(s), changes: (c) => changed.push(c) }, undefined, fake([
      callTool('create_pages', { pages: [{ title: 'Roadmap', content: '- Q1' }] }),
      say('Created the **Roadmap** page.'),
      say('Roadmap page'),
    ]) as any);
    expect(res.status).toBe('complete');
    expect(res.message!.data.changed).toBe(true);
    expect(res.message!.data.steps!.map((s) => s.label)).toEqual(['Added 1 page']);
    expect(changed.at(-1).pages[0]).toMatchObject({ title: 'Roadmap', action: 'created' });
    expect(res.title).toBe('Roadmap page');
    const turn = changes.turnChanges(res.message!.id)!;
    expect(turn.pages[0].title).toBe('Roadmap');
    changes.undoTurn(A, res.message!.id);
    expect(block(turn.pages[0].pageId).alive).toBe(false);
  });

  it('Always ask waits for the user and applies the change after Continue', async () => {
    const prep = svc.prepareChatTurn({ userId: A, spaceId, text: 'Add a page', approvalMode: 'always_ask' } as any);
    const run = svc.executeChatTurn(prep, {
      step: (s) => {
        if (s.status === 'waiting' && s.approval) setTimeout(() => approvals.decideApproval(A, s.approval!.id, 'accept'), 5);
      },
    }, undefined, fake([callTool('create_pages', { pages: [{ title: 'Approved page' }] }), say('Done.'), say('t')]) as any);
    const res = await run;
    const created = res.message!.data.steps!.find((s) => s.tool === 'create_pages')!;
    expect(created.status).toBe('done');
    expect(changes.turnChanges(res.message!.id)!.pages[0].title).toBe('Approved page');
  });

  it('Ask mode sends read-only tools', async () => {
    const seen: any[] = [];
    const prep = svc.prepareChatTurn({ userId: A, spaceId, text: 'What is here?', mode: 'ask' } as any);
    await svc.executeChatTurn(prep, {}, undefined, fake([say('Nothing much.'), say('t')], seen) as any);
    const names = seen[0].tools.map((t: any) => t.name);
    expect(names).toContain('search_workspace');
    expect(names).not.toContain('create_pages');
    expect(seen[0].system[1].text).toMatch(/Ask mode is on/);
  });
});

describe('Litpage MCP server', () => {
  it('authenticates tokens and runs tools as the token user', async () => {
    const { token } = mcp.createToken(B, spaceId, 'Claude Desktop');
    expect((await mcp.handleMcpHttp(undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' })).status).toBe(401);
    const init = await mcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(init.status).toBe(200);
    expect((init.body as any).result.serverInfo.name).toBe('Litpage MCP');
    expect((await mcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await mcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const names = (list.body as any).result.tools.map((t: any) => t.name);
    expect(names).toEqual(expect.arrayContaining(['lit-search', 'lit-fetch', 'lit-create-pages', 'lit-update-page']));
    // Bo can't fetch Ada's private page through MCP either
    const denied = await mcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lit-fetch', arguments: { id: privatePage } } });
    expect((denied.body as any).result.isError).toBe(true);
    const ok = await mcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'lit-fetch', arguments: { id: sharedReadOnly } } });
    expect((ok.body as any).result.content[0].text).toContain('Body of Read only for Bo');
    const write = await mcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'lit-update-page', arguments: { page_id: sharedReadOnly, command: 'update_properties', title: 'x' } } });
    expect((write.body as any).result.isError).toBe(true);
    const tokens = mcp.listTokens(B, spaceId);
    expect(tokens).toHaveLength(1);
    expect(JSON.stringify(tokens)).not.toContain(token);
    expect(() => mcp.listTokens(B, spaceId, true)).toThrow(/owners/);
    expect(mcp.revokeAll(A, spaceId)).toBe(1);
    expect((await mcp.handleMcpHttp(`Bearer ${token}`, { jsonrpc: '2.0', id: 6, method: 'tools/list' })).status).toBe(401);
  });
});

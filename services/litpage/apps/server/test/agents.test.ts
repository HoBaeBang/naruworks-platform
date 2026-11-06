// Custom Agents against a real temporary workspace: the agent acts as its own principal (its bot user) and
// reaches exactly what it was granted — never the creator's or the caller's access; granting needs the
// granter's own access; runs execute through the AI tool loop as the bot (edits attributed to the agent),
// triggers fire from commits / schedules / mentions without re-triggering themselves (loop guard), runs pause on
// limits, and the API enforces sharing levels.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-agents-test-'));
process.env.NC_SCHEDULER = '0';
process.env.NC_AGENT_TRIGGER_WINDOW_MS = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

type Ev = Record<string, any>;
const usage = { input_tokens: 1200, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function fake(turns: { events?: Ev[]; final: Ev }[], seen: any[] = []) {
  let i = 0;
  return {
    seen,
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const t = turns[Math.min(i++, turns.length - 1)];
          return { async *[Symbol.asyncIterator]() { for (const e of t.events ?? []) yield e; }, finalMessage: async () => t.final };
        }) as any,
      },
    },
  };
}
const say = (text: string) => ({
  events: [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 }],
  final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage },
});
const callTool = (name: string, input: Record<string, unknown>) => {
  const id = `tu_${name}_${Math.random().toString(36).slice(2, 7)}`;
  return { final: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }], usage } };
};

let db: typeof import('../src/db.ts');
let records: typeof import('../src/records.ts');
let model: typeof import('../src/agents/model.ts');
let access: typeof import('../src/agents/access.ts');
let runs: typeof import('../src/agents/runs.ts');
let triggers: typeof import('../src/agents/triggers.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let scheduler: typeof import('../src/scheduler.ts');
let prompts: typeof import('../src/ai/prompts.ts');
let context: typeof import('../src/ai/context.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let newId: () => string;
let indexBlock: (b: any) => void;

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
const block = (id: string) => db.getRecord<any>('block', id);
const titleOf = (id: string) => (block(id)?.properties?.title ?? []).map((d: any) => d[0]).join('');

function env(userId: string, over: Record<string, unknown> = {}) {
  return {
    userId, spaceId: ids.space, threadId: null, turnId: `t-${Math.random().toString(36).slice(2)}`, currentPageId: null,
    approvalMode: 'skip_all', memories: false, cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept', ...over,
  } as any;
}
const tool = (userId: string, name: string, input: Record<string, unknown>) => registry.runTool(env(userId), name, input, `s-${Math.random().toString(36).slice(2)}`);

function page(title: string, parentId: string, parentTable: string, permissions?: any[], extra: Record<string, unknown> = {}) {
  const id = newId();
  const now = Date.now();
  const rec = {
    id, version: 1, type: 'page', properties: { title: [[title]] }, content: [], format: {}, parent_id: parentId, parent_table: parentTable, space_id: extra.space_id ?? ids.space, alive: true,
    created_time: now, created_by_id: ids.A, created_by_table: 'lit_user', last_edited_time: now, last_edited_by_id: ids.A, ...(permissions ? { permissions } : {}), ...extra,
  } as any;
  db.putRecord('block', rec);
  if (parentTable === 'block') {
    const p = block(parentId);
    db.putRecord('block', { ...p, content: [...(p.content ?? []), id] });
  }
  indexBlock(rec);
  return id;
}

function mkAgent(name: string, config: Record<string, unknown> = {}, opts: { by?: string; published?: boolean; permissions?: any[] } = {}) {
  return model.createAgent({ spaceId: ids.space, userId: opts.by ?? ids.A, config: { name, ...config } as any, published: opts.published ?? true, permissions: opts.permissions });
}

function setGrants(agentId: string, grants: any[], extra: Record<string, unknown> = {}) {
  const a = model.getAgent(agentId)!;
  return model.saveAgentRecord({ ...a, data: { ...a.data, grants, ...extra } });
}

function lookup() {
  return { block: (id: string) => db.getRecord<any>('block', id), space: (id: string) => db.getRecord<any>('space', id), team: (id: string) => db.getRecord<any>('team', id), collection: (id: string) => db.getRecord<any>('collection', id) };
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  records = await import('../src/records.ts');
  model = await import('../src/agents/model.ts');
  access = await import('../src/agents/access.ts');
  runs = await import('../src/agents/runs.ts');
  triggers = await import('../src/agents/triggers.ts');
  registry = await import('../src/ai/tools/registry.ts');
  scheduler = await import('../src/scheduler.ts');
  prompts = await import('../src/ai/prompts.ts');
  context = await import('../src/ai/context.ts');
  await import('../src/api/modules/agents.ts');
  indexBlock = (await import('../src/search.ts')).indexBlock as any;
  const seed = await import('../src/seed.ts');
  for (const n of ['A', 'B', 'C', 'D', 'G']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n.toLowerCase()}@agents.test`, `User ${n}`);
  }
  const w = seed.createWorkspace(ids.A, 'Agent Corp');
  ids.space = w.space.id;
  ids.team = w.team.id;
  ids.teamHome = w.team.team_pages[0];
  seed.addMember(ids.space, ids.B, 'member');
  seed.addMember(ids.space, ids.C, 'member');
  const sp = db.getRecord<any>('space', ids.space);
  db.putRecord('space', { ...sp, plan_type: 'business', settings: { ...sp.settings, groups: [{ id: 'grp1', name: 'Design', member_ids: [ids.C] }] } });
  const w2 = seed.createWorkspace(ids.D, 'Other Co');
  ids.space2 = w2.space.id;
  ids.foreign = page('Foreign page', ids.space2, 'space', [{ type: 'user_permission', role: 'editor', user_id: ids.D }], { space_id: ids.space2 });

  ids.shared = page('Launch plan', ids.space, 'space', [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'reader', user_id: ids.B }]);
  ids.child = page('Launch checklist', ids.shared, 'block');
  ids.unlinked = page('Restricted notes', ids.shared, 'block', [{ type: 'user_permission', role: 'editor', user_id: ids.A }], { permissions_unlinked: true });
  ids.private = page('Diary of A', ids.space, 'space', [{ type: 'user_permission', role: 'editor', user_id: ids.A }]);
  ids.everyone = page('Company handbook', ids.space, 'space', [{ type: 'space_permission', role: 'read_and_write' }]);
  ids.cPrivate = page('C private notes', ids.space, 'space', [{ type: 'user_permission', role: 'editor', user_id: ids.C }]);
  // a database A owns, B can edit
  ids.db = newId();
  ids.col = newId();
  ids.view = newId();
  const now = Date.now();
  db.putRecord('block', {
    id: ids.db, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: ids.col, view_ids: [ids.view],
    permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'read_and_write', user_id: ids.B }],
    created_time: now, created_by_id: ids.A, last_edited_time: now,
  } as any);
  db.putRecord('collection', { id: ids.col, version: 1, parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, name: [['Tasks']], schema: { title: { name: 'Name', type: 'title' }, st: { name: 'Status', type: 'text' } } } as any);
  db.putRecord('collection_view', { id: ids.view, version: 1, type: 'table', parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
});

afterEach(async () => {
  await runs.drainRuns();
  runs.setAgentClient(undefined);
});

describe('the agent is its own principal', () => {
  it('reaches only its grants — not the creator’s pages, not other workspaces', () => {
    const a = mkAgent('Planner', { grants: [{ block_id: ids.shared, role: 'read_and_write' }, { block_id: ids.foreign, role: 'editor' }] });
    expect(model.isBotId(a.bot_id)).toBe(true);
    expect(records.blockRole(ids.shared, a.bot_id)).toBe('read_and_write');
    expect(records.blockRole(ids.child, a.bot_id)).toBe('read_and_write');
    // the creator's own private page, a restricted (unlinked) sub-page, a database: nothing
    expect(records.blockRole(ids.private, a.bot_id)).toBe('none');
    expect(records.blockRole(ids.unlinked, a.bot_id)).toBe('none');
    expect(records.blockRole(ids.db, a.bot_id)).toBe('none');
    expect(records.blockRole(ids.everyone, a.bot_id)).toBe('none');
    // a grant pointing into another workspace grants nothing
    expect(records.blockRole(ids.foreign, a.bot_id)).toBe('none');
    // the bot is no workspace member and has no login
    expect(model.agentRole(a, a.bot_id)).toBe('none');
    expect(db.findUserIdByEmail?.('')).toBeFalsy();
    expect(db.getRecord<any>('lit_user', a.bot_id).name).toBe('Planner');
    expect(db.getRecord<any>('lit_user', a.bot_id).email).toBeUndefined();
  });

  it('"Pages shared with everyone" is read-only access to workspace-wide pages only', () => {
    const a = mkAgent('Reader', { workspace_access: 'reader' });
    expect(records.blockRole(ids.everyone, a.bot_id)).toBe('reader');
    expect(records.blockRole(ids.teamHome, a.bot_id)).toBe('reader');
    expect(records.blockRole(ids.private, a.bot_id)).toBe('none');
    expect(records.blockRole(ids.shared, a.bot_id)).toBe('none');
  });

  it('tools act with the agent’s access and attribute edits to it', async () => {
    const a = mkAgent('Writer', { grants: [{ block_id: ids.shared, role: 'read_and_write' }, { block_id: ids.everyone, role: 'reader' }] });
    expect((await tool(a.bot_id, 'read_page', { page_id: ids.private })).isError).toBe(true);
    expect((await tool(a.bot_id, 'read_page', { page_id: ids.unlinked })).isError).toBe(true);
    const readable = await tool(a.bot_id, 'read_page', { page_id: ids.child });
    expect(readable.isError).toBeFalsy();
    const found = await tool(a.bot_id, 'search_workspace', { query: 'Diary' });
    expect(found.content).toMatch(/No pages matched/);
    const edit = await tool(a.bot_id, 'update_page', { page_id: ids.shared, command: 'append_content', new_str: 'Agent wrote this' });
    expect(edit.isError).toBeFalsy();
    expect(block(ids.shared).last_edited_by_id).toBe(a.bot_id);
    const lastKid = block(block(ids.shared).content.at(-1));
    expect(lastKid.created_by_id).toBe(a.bot_id);
    const created = await tool(a.bot_id, 'create_pages', { parent: { type: 'page', id: ids.shared }, pages: [{ title: 'Agent page' }] });
    expect(created.isError).toBeFalsy();
    const newPage = /page_id: ([0-9a-f-]{36})/.exec(created.content)![1];
    expect(block(newPage).created_by_id).toBe(a.bot_id);
    // view-only grant: no edits; no private pages of its own; nothing outside the grants
    expect((await tool(a.bot_id, 'update_page', { page_id: ids.everyone, command: 'append_content', new_str: 'x' })).isError).toBe(true);
    expect((await tool(a.bot_id, 'create_pages', { pages: [{ title: 'Private?' }] })).isError).toBe(true);
    expect((await tool(a.bot_id, 'create_pages', { parent: { type: 'teamspace', id: ids.team }, pages: [{ title: 'Team?' }] })).isError).toBe(true);
    expect((await tool(a.bot_id, 'delete_pages', { page_ids: [ids.private] })).isError).toBe(true);
    // a forged transaction as the bot is refused by the write guard itself
    expect(() => records.applyTransactions(a.bot_id, [{ id: newId(), spaceId: ids.space, operations: [{ pointer: { table: 'block', id: ids.private, spaceId: ids.space }, path: ['properties', 'title'], command: 'set', args: [['pwned']] }] } as any], undefined, { client: true })).toThrow(/Permission denied/);
    expect(titleOf(ids.private)).toBe('Diary of A');
  });

  it('the agent’s instructions page: the agent and its editors edit it, viewers read, others nothing', async () => {
    const a = mkAgent('Notes', {}, { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'reader', user_id: ids.B }] });
    const pid = a.data.instructions_page_id!;
    expect(records.blockRole(pid, a.bot_id)).toBe('editor');
    expect(records.blockRole(pid, ids.A)).toBe('editor');
    expect(records.blockRole(pid, ids.B)).toBe('reader');
    expect(records.blockRole(pid, ids.C)).toBe('none');
    const other = mkAgent('Other');
    expect(records.blockRole(pid, other.bot_id)).toBe('none');
  });

  it('sharing levels: groups and "Everyone at" count for members; guests never chat', () => {
    const a = mkAgent('Shared', {}, {
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'group_permission', role: 'read_and_write', group_id: 'grp1' }, { type: 'user_permission', role: 'reader', user_id: ids.G }],
    });
    expect(model.agentRole(a, ids.A)).toBe('editor');
    expect(model.agentRole(a, ids.C)).toBe('read_and_write');
    expect(model.agentRole(a, ids.B)).toBe('none');
    expect(model.agentRole(a, ids.G)).toBe('none');
    const everyone = model.saveAgentRecord({ ...a, permissions: [...a.permissions, { type: 'space_permission', role: 'reader' }] });
    expect(model.agentRole(everyone, ids.B)).toBe('reader');
    expect(model.agentRole(everyone, ids.D)).toBe('none');
  });
});

describe('granting needs the granter’s own access', () => {
  it('view needs view, more needs Full access, never more than you have', () => {
    expect(access.grantProblem(ids.B, ids.space, ids.shared, 'reader')).toBeNull();
    expect(access.grantProblem(ids.B, ids.space, ids.shared, 'read_and_write')).toMatch(/can only share access you already have/);
    expect(access.grantProblem(ids.B, ids.space, ids.db, 'read_and_write')).toMatch(/Full access is required/);
    expect(access.grantProblem(ids.B, ids.space, ids.private, 'reader')).toMatch(/doesn’t exist/);
    expect(access.grantProblem(ids.A, ids.space, ids.db, 'editor')).toBeNull();
    expect(access.grantProblem(ids.A, ids.space, ids.foreign, 'reader')).toMatch(/doesn’t exist/);
  });

  it('the API applies it to drafts and saves; someone else’s grants survive a save', async () => {
    const { agentId } = await call(ids.A, 'createAgent', { spaceId: ids.space, name: 'Team bot' });
    await call(ids.A, 'setAgentPermissions', { agentId, permissions: [{ type: 'user_permission', user_id: ids.A, role: 'editor' }, { type: 'user_permission', user_id: ids.B, role: 'read_and_write' }] });
    // B can't hand out A's private page, nor more than view on a page B only views
    expect(await status(() => call(ids.B, 'updateAgentDraft', { agentId, patch: { grants: [{ block_id: ids.private, role: 'reader' }] } }))).toBe(403);
    expect(await status(() => call(ids.B, 'updateAgentDraft', { agentId, patch: { grants: [{ block_id: ids.shared, role: 'read_and_write' }] } }))).toBe(403);
    const ok = await call(ids.B, 'updateAgentDraft', { agentId, patch: { grants: [{ block_id: ids.shared, role: 'reader' }] } });
    expect(ok.grants.map((g: any) => g.blockId)).toEqual([ids.shared]);
    await call(ids.B, 'saveAgent', { agentId });
    expect(model.getAgent(agentId)!.data.grants).toHaveLength(1);
    // A adds the private page; B can't save that, A can — and B's later saves keep it
    await call(ids.A, 'updateAgentDraft', { agentId, patch: { grants: [...model.getAgent(agentId)!.draft?.grants ?? model.getAgent(agentId)!.data.grants, { block_id: ids.private, role: 'reader' }] } });
    expect(await status(() => call(ids.B, 'saveAgent', { agentId }))).toBe(403);
    await call(ids.A, 'saveAgent', { agentId });
    expect(records.blockRole(ids.private, model.getAgent(agentId)!.bot_id)).toBe('reader');
    await call(ids.B, 'updateAgentDraft', { agentId, patch: { description: 'Helps the team' } });
    await call(ids.B, 'saveAgent', { agentId });
    expect(model.getAgent(agentId)!.data.grants.map((g) => g.block_id)).toContain(ids.private);
    // viewers can't edit settings at all; outsiders don't see the agent
    expect(await status(() => call(ids.C, 'updateAgentDraft', { agentId, patch: { name: 'x' } }))).toBe(404);
  });

  it('a page’s Full access holder removes an agent from it without access to the agent', async () => {
    const a = mkAgent('Remover target', { grants: [{ block_id: ids.everyone, role: 'reader' }] }, { by: ids.C, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.C }] });
    expect(model.agentRole(a, ids.A)).toBe('none');
    // B (only "Can edit" through Everyone) may not remove it
    expect(await status(() => call(ids.B, 'revokeAgentPageAccess', { pageId: ids.everyone, agentId: a.id }))).toBe(403);
    // make A Full access on the page, then remove
    db.putRecord('block', { ...block(ids.everyone), permissions: [{ type: 'space_permission', role: 'read_and_write' }, { type: 'user_permission', role: 'editor', user_id: ids.A }] });
    await call(ids.A, 'revokeAgentPageAccess', { pageId: ids.everyone, agentId: a.id });
    const after = model.getAgent(a.id)!;
    expect(after.data.grants).toHaveLength(0);
    expect(after.revoked?.[0]).toMatchObject({ block_id: ids.everyone, by: ids.A });
    expect(records.blockRole(ids.everyone, a.bot_id)).toBe('none');
  });
});

describe('runs act as the agent', () => {
  it('a manual run edits granted pages as the agent and is logged in the Activity', async () => {
    const a = mkAgent('Run bot', { grants: [{ block_id: ids.shared, role: 'read_and_write' }] });
    runs.setAgentClient(fake([callTool('create_pages', { parent: { type: 'page', id: ids.shared }, pages: [{ title: 'Weekly report' }] }), say('Created the weekly report.')]) as any);
    const { run } = await call(ids.A, 'runAgent', { agentId: a.id });
    await runs.drainRuns();
    const done = runs.getRun(run.id)!;
    expect(done.status).toBe('success');
    expect(done.changes).toBeGreaterThan(0);
    expect(done.credits).toBeGreaterThan(0);
    const created = block(ids.shared).content.map((id: string) => block(id)).find((b: any) => titleOf(b.id) === 'Weekly report');
    expect(created.created_by_id).toBe(a.bot_id);
    const activity = await call(ids.A, 'getAgentRuns', { agentId: a.id });
    expect(activity.runs[0]).toMatchObject({ id: run.id, status: 'success', kind: 'manual' });
    const detail = await call(ids.A, 'getAgentRun', { runId: run.id });
    expect(detail.messages.at(-1).text).toBe('Created the weekly report.');
    expect(detail.messages.at(-1).steps.some((s: any) => s.label === 'Added 1 page')).toBe(true);
  });

  it('without an API key the run fails with the connect-a-key message', async () => {
    const a = mkAgent('Keyless');
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const run = runs.enqueueRun({ agent: a, kind: 'manual', label: 'Run agent', actorId: ids.A });
      await runs.drainRuns();
      expect(runs.getRun(run.id)).toMatchObject({ status: 'failed', error: 'Connect an AI provider to use Litpage AI' });
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });

  it('every granted resource needs an editor who can open it', async () => {
    const a = mkAgent('Orphan access');
    // a grant only C can open (written directly — the API would refuse it)
    setGrants(a.id, [{ block_id: ids.cPrivate, role: 'reader' }]);
    runs.setAgentClient(fake([say('should not run')]) as any);
    const run = runs.enqueueRun({ agent: model.getAgent(a.id)!, kind: 'manual', label: 'Run agent', actorId: ids.A });
    await runs.drainRuns();
    expect(runs.getRun(run.id)!.status).toBe('failed');
    expect(runs.getRun(run.id)!.error).toMatch(/agent can reach resources its editors cannot\. Grant an editor access to C private notes/);
  });
});

describe('triggers and the loop guard', () => {
  it('a page added to a database starts a run; the agent’s own edits don’t re-trigger it', async () => {
    const a = mkAgent('Triage', {
      grants: [{ block_id: ids.db, role: 'read_and_write' }],
      triggers: [{ id: 't1', type: 'lit.page_created', enabled: true, collection_id: ids.col }, { id: 't2', type: 'lit.page_updated', enabled: true, collection_id: ids.col }],
    });
    // the run edits the new row (a property update in the watched database)
    const seen: any[] = [];
    runs.setAgentClient(fake([{ final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'placeholder' }], usage } }], seen) as any);
    const rowId = newId();
    const now = Date.now();
    let toolCalled = false;
    runs.setAgentClient({
      beta: {
        messages: {
          stream: ((params: any) => {
            seen.push(params);
            const last = params.messages.at(-1);
            const hasResult = Array.isArray(last?.content) && last.content.some((b: any) => b.type === 'tool_result');
            const t = !hasResult && !toolCalled
              ? (toolCalled = true, callTool('update_page', { page_id: rowId, command: 'update_properties', properties: { Status: 'Triaged' } }))
              : say('Triaged the new task.');
            return { async *[Symbol.asyncIterator]() { for (const e of (t as any).events ?? []) yield e; }, finalMessage: async () => t.final };
          }) as any,
        },
      },
    } as any);
    records.applyTransactions(ids.A, [{ id: newId(), spaceId: ids.space, operations: [{ pointer: { table: 'block', id: rowId, spaceId: ids.space }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: ids.col, parent_table: 'collection', alive: true, space_id: ids.space, properties: { title: [['Bug: login fails']] }, created_time: now, created_by_id: ids.A, last_edited_time: now } }] } as any], undefined, { client: true });
    triggers.flushTriggers();
    await runs.drainRuns();
    triggers.flushTriggers();
    await runs.drainRuns();
    const list = runs.listRuns(a.id, {});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: 'trigger', triggerType: 'lit.page_created', status: 'success', pageId: rowId });
    expect(block(rowId).properties.st).toEqual([['Triaged']]);
    expect(block(rowId).last_edited_by_id).toBe(a.bot_id);
    // the trigger block told the model what happened
    expect(JSON.stringify(seen[0].messages)).toContain('A page was added to the database');
    // a person editing the row does trigger "Property updated"
    runs.setAgentClient(fake([say('No action needed — status already set.')]) as any);
    records.applyTransactions(ids.B, [{ id: newId(), spaceId: ids.space, operations: [{ pointer: { table: 'block', id: rowId, spaceId: ids.space }, path: ['properties', 'st'], command: 'set', args: [['Done']] }] } as any], undefined, { client: true });
    triggers.flushTriggers();
    await runs.drainRuns();
    const after = runs.listRuns(a.id, {});
    expect(after).toHaveLength(2);
    expect(after[0]).toMatchObject({ triggerType: 'lit.page_updated', status: 'skipped', actorId: ids.B });
  });

  it('an @mention in a comment starts a run that replies in the thread', async () => {
    const a = mkAgent('Helper', { grants: [{ block_id: ids.shared, role: 'read_and_write' }], triggers: [{ id: 'm', type: 'lit.agent_mentioned', enabled: true }] });
    const did = newId();
    const cid = newId();
    const now = Date.now();
    let discussionSeen = '';
    runs.setAgentClient({
      beta: {
        messages: {
          stream: ((params: any) => {
            const text = JSON.stringify(params.messages);
            const m = /discussion_id: ([0-9a-f-]{36})/.exec(text);
            const hasResult = Array.isArray(params.messages.at(-1)?.content) && params.messages.at(-1).content.some((b: any) => b.type === 'tool_result');
            if (m) discussionSeen = m[1];
            const t = hasResult ? say('Replied.') : callTool('add_comment', { page_id: ids.shared, discussion_id: m?.[1], text: 'On it — here is the summary.' });
            return { async *[Symbol.asyncIterator]() { for (const e of (t as any).events ?? []) yield e; }, finalMessage: async () => t.final };
          }) as any,
        },
      },
    } as any);
    records.applyTransactions(ids.A, [{
      id: newId(), spaceId: ids.space, operations: [
        { pointer: { table: 'discussion', id: did, spaceId: ids.space }, path: [], command: 'set', args: { id: did, parent_id: ids.shared, parent_table: 'block', resolved: false, comments: [], space_id: ids.space, alive: true, type: 'page', created_by_id: ids.A, created_time: now } },
        { pointer: { table: 'block', id: ids.shared, spaceId: ids.space }, path: ['discussions'], command: 'listAfter', args: { id: did } },
        { pointer: { table: 'comment', id: cid, spaceId: ids.space }, path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: [['‣', [['u', a.bot_id]]], [' please summarize']], created_by_id: ids.A, created_time: now, last_edited_time: now, alive: true, space_id: ids.space } },
        { pointer: { table: 'discussion', id: did, spaceId: ids.space }, path: ['comments'], command: 'listAfter', args: { id: cid } },
      ],
    } as any], undefined, { client: true });
    triggers.flushTriggers();
    await runs.drainRuns();
    expect(discussionSeen).toBe(did);
    const d = db.getRecord<any>('discussion', did);
    expect(d.comments).toHaveLength(2);
    expect(db.getRecord<any>('comment', d.comments[1]).created_by_id).toBe(a.bot_id);
    expect(runs.listRuns(a.id, {})[0]).toMatchObject({ triggerType: 'lit.agent_mentioned', status: 'success' });
  });

  it('mentions fire wherever the @ menu puts them: database Text properties, table cells, edited comments — not Person values', async () => {
    // a database with a Text and a Person property the agent can reach
    const dbId = newId();
    const colId = newId();
    const now = Date.now();
    db.putRecord('block', { id: dbId, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: colId, view_ids: [], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }], created_time: now, created_by_id: ids.A } as any);
    db.putRecord('collection', { id: colId, version: 1, parent_id: dbId, parent_table: 'block', space_id: ids.space, alive: true, name: [['Requests']], schema: { title: { name: 'Name', type: 'title' }, nts: { name: 'Notes', type: 'text' }, own: { name: 'Owner', type: 'person' } } } as any);
    const rowId = newId();
    db.putRecord('block', { id: rowId, version: 1, type: 'page', parent_id: colId, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Fix the login page']] }, content: [], created_time: now, created_by_id: ids.A } as any);
    const docId = page('Specs', ids.space, 'space', [{ type: 'user_permission', role: 'editor', user_id: ids.A }]);
    const a = mkAgent('Mention bot', { grants: [{ block_id: dbId, role: 'read_and_write' }, { block_id: docId, role: 'read_and_write' }], triggers: [{ id: 'mm', type: 'lit.agent_mentioned', enabled: true }] });
    const seen: any[] = [];
    runs.setAgentClient(fake([say('Noted.')], seen) as any);
    const mention = (text: string) => [['‣', [['u', a.bot_id]]], [` ${text}`]];
    const apply = async (user: string, operations: any[]) => {
      records.applyTransactions(user, [{ id: newId(), spaceId: ids.space, operations }] as any, undefined, { client: true });
      triggers.flushTriggers();
      await runs.drainRuns();
    };
    const mentionRuns = () => runs.listRuns(a.id, {}).filter((r) => r.triggerType === 'lit.agent_mentioned');

    // database Text property
    await apply(ids.A, [{ pointer: { table: 'block', id: rowId, spaceId: ids.space }, path: ['properties', 'nts'], command: 'set', args: mention('please estimate this') }]);
    expect(mentionRuns()).toHaveLength(1);
    expect(mentionRuns()[0]).toMatchObject({ status: 'success', pageId: rowId, actorId: ids.A });
    expect(JSON.stringify(seen.at(-1).messages)).toContain('mentioned you in the “Notes” property of “Fix the login page”');
    // editing the same text again (the mention was already there) doesn't re-trigger
    await apply(ids.A, [{ pointer: { table: 'block', id: rowId, spaceId: ids.space }, path: ['properties', 'nts'], command: 'set', args: mention('please estimate this today') }]);
    expect(mentionRuns()).toHaveLength(1);
    // a Person property holding the agent isn't a mention
    await apply(ids.A, [{ pointer: { table: 'block', id: rowId, spaceId: ids.space }, path: ['properties', 'own'], command: 'set', args: [['‣', [['u', a.bot_id]]]] }]);
    expect(mentionRuns()).toHaveLength(1);

    // a simple table cell on a page
    const tableId = newId();
    const trId = newId();
    await apply(ids.A, [
      { pointer: { table: 'block', id: tableId, spaceId: ids.space }, path: [], command: 'set', args: { id: tableId, version: 1, type: 'table', format: { table_block_column_order: ['c1', 'c2'] }, content: [trId], parent_id: docId, parent_table: 'block', space_id: ids.space, alive: true, created_time: now, created_by_id: ids.A } },
      { pointer: { table: 'block', id: trId, spaceId: ids.space }, path: [], command: 'set', args: { id: trId, version: 1, type: 'table_row', properties: { c1: [['Owner']], c2: mention('can you fill this in?') }, parent_id: tableId, parent_table: 'block', space_id: ids.space, alive: true, created_time: now, created_by_id: ids.A } },
      { pointer: { table: 'block', id: docId, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: tableId } },
    ]);
    expect(mentionRuns()).toHaveLength(2);
    expect(mentionRuns()[0]).toMatchObject({ pageId: docId });
    expect(JSON.stringify(seen.at(-1).messages)).toContain('can you fill this in?');

    // a comment edited to add the mention
    const did = newId();
    const cid = newId();
    await apply(ids.A, [
      { pointer: { table: 'discussion', id: did, spaceId: ids.space }, path: [], command: 'set', args: { id: did, parent_id: docId, parent_table: 'block', resolved: false, comments: [cid], space_id: ids.space, alive: true, type: 'page', created_by_id: ids.A, created_time: now } },
      { pointer: { table: 'comment', id: cid, spaceId: ids.space }, path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: [['Looks good']], created_by_id: ids.A, created_time: now, alive: true, space_id: ids.space } },
      { pointer: { table: 'block', id: docId, spaceId: ids.space }, path: ['discussions'], command: 'listAfter', args: { id: did } },
    ]);
    expect(mentionRuns()).toHaveLength(2);
    await apply(ids.A, [{ pointer: { table: 'comment', id: cid, spaceId: ids.space }, path: ['text'], command: 'set', args: [['Looks good — ']].concat(mention('double-check the numbers') as any) }]);
    expect(mentionRuns()).toHaveLength(3);
    expect(JSON.stringify(seen.at(-1).messages)).toContain(`discussion_id: ${did}`);

    // loop guard: the agent's own write that mentions itself starts nothing
    await apply(a.bot_id, [{ pointer: { table: 'block', id: rowId, spaceId: ids.space }, path: ['properties', 'nts'], command: 'set', args: mention('note to self') }]);
    expect(mentionRuns()).toHaveLength(3);

    // permission guard: a row the agent can't open → a blocked run, the model never sees it
    const otherDb = newId();
    const otherCol = newId();
    const otherRow = newId();
    db.putRecord('block', { id: otherDb, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: otherCol, view_ids: [], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }], created_time: now, created_by_id: ids.A } as any);
    db.putRecord('collection', { id: otherCol, version: 1, parent_id: otherDb, parent_table: 'block', space_id: ids.space, alive: true, name: [['Salaries']], schema: { title: { name: 'Name', type: 'title' }, nts: { name: 'Notes', type: 'text' } } } as any);
    db.putRecord('block', { id: otherRow, version: 1, type: 'page', parent_id: otherCol, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Comp band L5']] }, content: [], created_time: now, created_by_id: ids.A } as any);
    const calls = seen.length;
    await apply(ids.A, [{ pointer: { table: 'block', id: otherRow, spaceId: ids.space }, path: ['properties', 'nts'], command: 'set', args: mention('what do you think?') }]);
    expect(mentionRuns()[0]).toMatchObject({ pageId: otherRow, status: 'failed' });
    expect(seen.length).toBe(calls);
  });

  it('a mention on a page the agent can’t open is blocked; “Invite agent to page?” › Invite answers it once', async () => {
    const pageId = page('Planning doc', ids.space, 'space', [{ type: 'user_permission', role: 'editor', user_id: ids.A }]);
    const a = mkAgent('Late helper', { triggers: [{ id: 'm2', type: 'lit.agent_mentioned', enabled: true }] });
    const seen: any[] = [];
    runs.setAgentClient(fake([say('Here to help.')], seen) as any);
    const bid = newId();
    records.applyTransactions(ids.A, [{
      id: newId(), spaceId: ids.space, operations: [
        { pointer: { table: 'block', id: bid, spaceId: ids.space }, path: [], command: 'set', args: { id: bid, version: 1, type: 'text', properties: { title: [['‣', [['u', a.bot_id]]], [' can you plan this?']] }, parent_id: pageId, parent_table: 'block', space_id: ids.space, alive: true, created_time: Date.now(), created_by_id: ids.A } },
        { pointer: { table: 'block', id: pageId, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: bid } },
      ],
    } as any], undefined, { client: true });
    triggers.flushTriggers();
    await runs.drainRuns();
    const blocked = runs.listRuns(a.id, {})[0];
    expect(blocked).toMatchObject({ triggerType: 'lit.agent_mentioned', status: 'failed' });
    expect(seen).toHaveLength(0);
    // the Activity never shows what the agent couldn't read
    expect(JSON.stringify(await call(ids.A, 'getAgentRuns', { agentId: a.id }))).not.toContain('can you plan this');
    // Invite → the mention is answered, once
    const r = await call(ids.A, 'grantAgentPageAccess', { agentId: a.id, pageId, role: 'read_and_write' });
    expect(r.retriedRuns).toBe(1);
    await runs.drainRuns();
    expect(runs.listRuns(a.id, {})[0]).toMatchObject({ triggerType: 'lit.agent_mentioned', status: 'success', parentRunId: blocked.id, actorId: ids.A });
    expect(JSON.stringify(seen[0].messages)).toContain('can you plan this');
    expect((await call(ids.A, 'grantAgentPageAccess', { agentId: a.id, pageId, role: 'read_and_write' })).retriedRuns).toBe(0);
  });

  it('schedules run on time through the persistent scheduler', async () => {
    const a = mkAgent('Daily', { triggers: [{ id: 'r', type: 'recurrence', enabled: true, recurrence: { frequency: 'day', interval: 1, start: '2026-01-01', time: '09:00', time_zone: 'UTC' } }] });
    triggers.syncAgentSchedules(model.getAgent(a.id)!);
    const jobs = scheduler.listJobs(`agent-recur:${a.id}:`);
    expect(jobs).toHaveLength(1);
    runs.setAgentClient(fake([say('No action needed today.')]) as any);
    await scheduler.runDueJobs(jobs[0].runAt + 1);
    await runs.drainRuns();
    expect(runs.listRuns(a.id, {})[0]).toMatchObject({ kind: 'trigger', triggerType: 'recurrence', status: 'skipped' });
    expect(scheduler.listJobs(`agent-recur:${a.id}:`)[0].runAt).toBeGreaterThan(jobs[0].runAt);
    // disabling the agent cancels the schedule
    await call(ids.A, 'setAgentEnabled', { agentId: a.id, enabled: false });
    expect(scheduler.listJobs(`agent-recur:${a.id}:`)).toHaveLength(0);
  });

  it('Meeting note summarized is fired by the meeting-notes feature', async () => {
    const a = mkAgent('Recapper', { grants: [{ block_id: ids.shared, role: 'reader' }], triggers: [{ id: 'mn', type: 'lit.meeting_note_summarized', enabled: true }] });
    runs.setAgentClient(fake([say('Recap posted.')]) as any);
    const queued = triggers.fireMeetingNoteSummarized(ids.child, ids.A);
    expect(queued).toHaveLength(1);
    await runs.drainRuns();
    expect(runs.getRun(queued[0])!.status).toBe('success');
    // no access to the note → not fired
    expect(triggers.fireMeetingNoteSummarized(ids.private, ids.A).filter((id) => runs.getRun(id)!.agentId === a.id)).toHaveLength(0);
  });

  it('too many runs pause the agent; Resume releases the held runs', async () => {
    process.env.NC_AGENT_RUNS_PER_HOUR = '2';
    try {
      const a = mkAgent('Busy');
      runs.setAgentClient(fake([say('No action needed.')]) as any);
      for (let i = 0; i < 3; i++) runs.enqueueRun({ agent: model.getAgent(a.id)!, kind: 'trigger', label: 'Page added', actorId: ids.A });
      await runs.drainRuns();
      const third = runs.enqueueRun({ agent: model.getAgent(a.id)!, kind: 'trigger', label: 'Page added', actorId: ids.A });
      expect(model.getAgent(a.id)!.status).toBe('paused');
      expect(model.getAgent(a.id)!.paused_reason).toBe('run_limit');
      expect(runs.getRun(third.id)!.held).toBe(true);
      await call(ids.A, 'resumeAgent', { agentId: a.id });
      await runs.drainRuns();
      expect(runs.getRun(third.id)!.status).toBe('skipped');
    } finally {
      delete process.env.NC_AGENT_RUNS_PER_HOUR;
    }
  });
});

describe('connections between agents and approvals', () => {
  it('a sub-agent works with its own access and returns its answer', async () => {
    const sub = mkAgent('Researcher', { grants: [{ block_id: ids.everyone, role: 'reader' }] });
    const main = mkAgent('Lead', { sub_agents: [sub.id] });
    const seen: any[] = [];
    runs.setAgentClient(fake([callTool('call_agent', { agent_id: sub.id, task: 'Read the handbook' }), say('The handbook says hello.'), say('Done: the researcher read it.')], seen) as any);
    const run = runs.enqueueRun({ agent: main, kind: 'manual', label: 'Run agent', actorId: ids.A });
    await runs.drainRuns();
    expect(runs.getRun(run.id)!.status).toBe('success');
    const child = runs.listRuns(sub.id, {})[0];
    expect(child).toMatchObject({ kind: 'sub_agent', status: 'success', parentRunId: run.id });
    expect(child.chain).toEqual([main.id]);
    expect(JSON.stringify(seen[2].messages)).toContain('The handbook says hello.');
    // the sub-agent can't call back up the chain
    const loop = mkAgent('Looper', { sub_agents: [main.id] });
    const back = model.saveAgentRecord({ ...model.getAgent(main.id)!, data: { ...model.getAgent(main.id)!.data, sub_agents: [loop.id] } });
    runs.setAgentClient(fake([callTool('call_agent', { agent_id: loop.id, task: 'x' }), callTool('call_agent', { agent_id: back.id, task: 'y' }), say('refused'), say('ok')]) as any);
    const r2 = runs.enqueueRun({ agent: back, kind: 'manual', label: 'Run agent', actorId: ids.A });
    await runs.drainRuns();
    expect(runs.getRun(r2.id)!.status).toBe('success');
    expect(runs.listRuns(main.id, { kinds: ['sub_agent'] })).toHaveLength(0);
  });

  it('a triggered run that needs a new web page waits for review; Allow re-runs with it', async () => {
    const a = mkAgent('Browser', { web_access: true });
    runs.setAgentClient(fake([callTool('request_url_access', { url: 'https://example.org/report', reason: 'Read the report' }), say('Waiting for approval to open https://example.org/report.')]) as any);
    const run = runs.enqueueRun({ agent: a, kind: 'trigger', label: 'Page added', actorId: ids.A });
    await runs.drainRuns();
    const r = runs.getRun(run.id)!;
    expect(r.status).toBe('needs_review');
    expect(r.review).toMatchObject({ kind: 'url', host: 'example.org' });
    runs.setAgentClient(fake([say('Read it.')]) as any);
    const res = await call(ids.A, 'resolveAgentReview', { runId: run.id, decision: 'allow' });
    await runs.drainRuns();
    const rerun = runs.getRun(res.run.id)!;
    expect(rerun.payload.allowedHosts).toContain('example.org');
    expect(rerun.status).toBe('success');
  });
});

describe('API guards', () => {
  it('Custom Agents need Business; creation policy limits who creates', async () => {
    const sp = db.getRecord<any>('space', ids.space);
    db.putRecord('space', { ...sp, plan_type: 'plus' });
    expect(await status(() => call(ids.A, 'createAgent', { spaceId: ids.space }))).toBe(403);
    db.putRecord('space', { ...sp, plan_type: 'business', settings: { ...sp.settings, agent_creation: 'owners' } });
    expect(await status(() => call(ids.B, 'createAgent', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.A, 'createAgent', { spaceId: ids.space }))).toBe(200);
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space), settings: { ...sp.settings, agent_creation: 'all' } });
    expect(await status(() => call(ids.G, 'createAgent', { spaceId: ids.space }))).toBe(403);
  });

  it('duplicates keep only what the duplicator can access', async () => {
    const a = mkAgent('Original', { grants: [{ block_id: ids.shared, role: 'read_and_write' }, { block_id: ids.private, role: 'reader' }] }, {
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'reader', user_id: ids.B }],
    });
    const r = await call(ids.B, 'copyAgent', { agentId: a.id });
    const copy = model.getAgent(r.agentId)!;
    expect(copy.data.name).toBe('Original (1)');
    // B may give "Can view" on Launch plan (B views it) but not edit, and nothing of A's diary
    expect(copy.data.grants).toEqual([]);
    expect(model.agentRole(copy, ids.B)).toBe('editor');
    expect(model.agentRole(copy, ids.A)).toBe('none');
  });

  it('sharing keeps a Full access owner; only Full access shares', async () => {
    const a = mkAgent('Keeper', {}, { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'read_and_write', user_id: ids.B }] });
    expect(await status(() => call(ids.B, 'setAgentPermissions', { agentId: a.id, permissions: [{ type: 'user_permission', user_id: ids.B, role: 'editor' }] }))).toBe(403);
    expect(await status(() => call(ids.A, 'setAgentPermissions', { agentId: a.id, permissions: [{ type: 'user_permission', user_id: ids.B, role: 'reader' }] }))).toBe(400);
  });
});

describe('prompts', () => {
  it('group mentions read as @<group name>', () => {
    const md = prompts.richTextToMarkdown([['Ping '], ['‣', [['g', 'grp1', ids.space]]], [' about it']], context.mdSource(ids.A));
    expect(md).toBe('Ping @Design about it');
  });
});

describe('page Share menu, admin controls, embeds (AGT-007.2, AGT-011.4, AGT-012, AGT-018–020)', () => {
  const tx = (user: string, operations: any[]) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });

  it('Agent access settings: “Only people with Full access” — set by Full access only, inherited by sub-pages', async () => {
    const policyOp = (v: string | null) => ({ pointer: { table: 'block', id: ids.shared, spaceId: ids.space }, path: ['format', 'agent_access_policy'], command: 'set', args: v });
    const helper = mkAgent('Helper');
    // B can view Launch plan: by default B may give an agent "Can view"
    expect(access.grantProblem(ids.B, ids.space, ids.shared, 'reader')).toBeNull();
    // B (view only) can't change the setting; A (Full access) can
    expect(await status(() => tx(ids.B, [policyOp('full_access')]))).not.toBe(200);
    expect(block(ids.shared).format?.agent_access_policy).toBeUndefined();
    await tx(ids.A, [policyOp('full_access')]);
    expect(block(ids.shared).format?.agent_access_policy).toBe('full_access');
    expect(access.grantProblem(ids.B, ids.space, ids.shared, 'reader')).toMatch(/Only people with Full access/);
    expect(access.grantProblem(ids.B, ids.space, ids.child, 'reader')).toMatch(/Only people with Full access/);
    expect(access.grantProblem(ids.A, ids.space, ids.child, 'editor')).toBeNull();
    // the Share menu path applies it too (B can edit the agent, which adding a page needs)
    await call(ids.A, 'setAgentPermissions', { agentId: helper.id, permissions: [{ type: 'user_permission', user_id: ids.A, role: 'editor' }, { type: 'user_permission', user_id: ids.B, role: 'read_and_write' }] });
    expect(await status(() => call(ids.B, 'grantAgentPageAccess', { agentId: helper.id, pageId: ids.shared, role: 'reader' }))).toBe(403);
    await tx(ids.A, [policyOp(null)]);
    expect(await status(() => call(ids.B, 'grantAgentPageAccess', { agentId: helper.id, pageId: ids.shared, role: 'reader' }))).toBe(200);
    expect(model.getAgent(helper.id)!.data.grants.map((g) => g.block_id)).toContain(ids.shared);
  });

  it('getPageAgents lists who reaches a page (direct, inherited, workspace); mention checks explain the outcome', async () => {
    const direct = mkAgent('Direct', { grants: [{ block_id: ids.shared, role: 'reader' }] });
    const wide = mkAgent('Wide', { workspace_access: 'reader', triggers: [{ id: 'm1', type: 'lit.agent_mentioned', enabled: true }] });
    const onShared = (await call(ids.A, 'getPageAgents', { pageId: ids.shared })).agents;
    expect(onShared.find((x: any) => x.agentId === direct.id)).toMatchObject({ direct: true, role: 'reader' });
    const onChild = (await call(ids.A, 'getPageAgents', { pageId: ids.child })).agents;
    expect(onChild.find((x: any) => x.agentId === direct.id)).toMatchObject({ direct: false });
    const onEveryone = (await call(ids.A, 'getPageAgents', { pageId: ids.everyone })).agents;
    expect(onEveryone.find((x: any) => x.agentId === wide.id)).toMatchObject({ viaWorkspace: true });
    // C can't open Launch plan: no answer at all
    expect(await status(() => call(ids.C, 'getPageAgents', { pageId: ids.shared }))).toBe(404);
    // mention checks: Direct doesn't listen to mentions; Wide can't reach A's diary but A may invite it
    expect(await call(ids.A, 'checkAgentMention', { agentId: direct.id, pageId: ids.shared })).toMatchObject({ listens: false, reachable: true, disabled: false });
    expect(await call(ids.A, 'checkAgentMention', { agentId: wide.id, pageId: ids.private })).toMatchObject({ listens: true, reachable: false, canGrant: true });
  });

  it('admins: list every agent, disable one they can’t open (editors can’t re-enable), transfer ownership', async () => {
    const theirs = mkAgent('Their agent', {}, { by: ids.B, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.B }] });
    expect(await status(() => call(ids.B, 'adminListAgents', { spaceId: ids.space }))).toBe(403);
    const list = await call(ids.A, 'adminListAgents', { spaceId: ids.space });
    expect(list.agents.find((x: any) => x.id === theirs.id)).toMatchObject({ myRole: 'none', status: 'active' });
    expect(list.models.find((m: any) => m.id === 'claude-fable-5')).toMatchObject({ adminEnable: true });
    expect(list.groups).toEqual([{ id: 'grp1', name: 'Design', memberCount: 1 }]);
    // A can't open it, but disables it as a workspace owner
    expect(await status(() => call(ids.A, 'getAgentRuns', { agentId: theirs.id }))).toBe(403);
    expect(await status(() => call(ids.C, 'getAgentRuns', { agentId: theirs.id }))).toBe(404);
    await call(ids.A, 'setAgentEnabled', { agentId: theirs.id, enabled: false });
    expect(model.getAgent(theirs.id)).toMatchObject({ status: 'disabled', paused_reason: 'disabled_by_admin' });
    expect(await status(() => call(ids.B, 'setAgentEnabled', { agentId: theirs.id, enabled: true }))).toBe(403);
    // B still owns it: no transfer (only agents whose owners left); members can't transfer at all
    expect(await status(() => call(ids.A, 'transferAgentOwnership', { agentId: theirs.id, userId: ids.C }))).toBe(400);
    expect(model.agentRole(model.getAgent(theirs.id)!, ids.C)).toBe('none');
    expect(await status(() => call(ids.B, 'transferAgentOwnership', { agentId: theirs.id, userId: ids.B }))).toBe(403);
    // removing an agent's page access without access to the agent is Enterprise-only
    setGrants(theirs.id, [{ block_id: ids.everyone, role: 'reader' }]);
    expect(await status(() => call(ids.A, 'adminRevokeAgentResource', { agentId: theirs.id, blockId: ids.everyone }))).toBe(403);
    const sp = db.getRecord<any>('space', ids.space);
    db.putRecord('space', { ...sp, plan_type: 'enterprise' });
    try {
      await call(ids.A, 'adminRevokeAgentResource', { agentId: theirs.id, blockId: ids.everyone });
      expect(model.getAgent(theirs.id)!.data.grants).toEqual([]);
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.space), plan_type: 'business' });
    }
  });

  it('allowed models for Custom Agents: new agents start on the default; a restricted model runs on the default', async () => {
    const sp = db.getRecord<any>('space', ids.space);
    db.putRecord('space', { ...sp, settings: { ...sp.settings, ai_agent_allowed_models: ['claude-sonnet-5-5'], ai_agent_default_model: 'claude-sonnet-5-5' } });
    try {
      const fresh = mkAgent('Fresh');
      expect(fresh.data.model).toBe('claude-sonnet-5-5');
      const pinned = mkAgent('Pinned', { model: 'claude-opus-5-5' });
      const detail = await call(ids.A, 'getAgent', { agentId: pinned.id });
      expect(detail.models.find((m: any) => m.id === 'claude-opus-5-5').allowed).toBe(false);
      expect(detail.models.some((m: any) => m.id === 'claude-fable-5')).toBe(false);
      const seen: any[] = [];
      runs.setAgentClient(fake([say('No action needed.')], seen) as any);
      runs.enqueueRun({ agent: pinned, kind: 'manual', label: 'Run agent', actorId: ids.A });
      await runs.drainRuns();
      expect(seen[0].model).toBe('claude-sonnet-5-5');
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.space), settings: sp.settings });
    }
  });

  it('an embedded chat tells the agent where it is, and the agent reads the page only with its own access', () => {
    const a = mkAgent('Embedded', { grants: [{ block_id: ids.shared, role: 'reader' }] });
    const onGranted = runs.prepareAgentChat({ userId: ids.A, agentId: a.id, text: 'What is this page about?', pageId: ids.shared });
    expect(onGranted.userMessage.data.meta).toContain(`page_id: ${ids.shared}`);
    const onDiary = runs.prepareAgentChat({ userId: ids.A, agentId: a.id, text: 'Summarize this', pageId: ids.private });
    expect(onDiary.userMessage.data.meta).toContain('a page you can’t open');
    expect(onDiary.userMessage.data.meta).not.toContain(ids.private);
    // someone who can't open the page learns nothing about it either
    const fromB = runs.prepareAgentChat({ userId: ids.A, agentId: a.id, text: 'Hi', pageId: ids.cPrivate });
    expect(fromB.userMessage.data.meta).not.toContain('embedded');
  });

  it('AI Meeting Notes summaries start “Meeting note summarized” runs with the summary', async () => {
    const a = mkAgent('Follow-ups', { grants: [{ block_id: ids.shared, role: 'reader' }], triggers: [{ id: 'mn2', type: 'lit.meeting_note_summarized', enabled: true }] });
    const seen: any[] = [];
    runs.setAgentClient(fake([say('Posted the follow-ups.')], seen) as any);
    const { emitMeetingSummarized } = await import('../src/meetings/events.ts');
    emitMeetingSummarized({ spaceId: ids.space, blockId: ids.child, pageId: ids.child, userId: ids.A, title: 'Weekly sync', summaryMarkdown: '## Action items\n- Ship it', transcript: '' });
    await runs.drainRuns();
    const run = runs.listRuns(a.id, {})[0];
    expect(run).toMatchObject({ kind: 'trigger', triggerType: 'lit.meeting_note_summarized', status: 'success' });
    expect(JSON.stringify(seen.at(-1).messages)).toContain('Ship it');
  });

  it('editing an agent’s instructions page is audited for the agent', async () => {
    const a = mkAgent('Audited');
    const pageId = a.data.instructions_page_id!;
    await tx(ids.A, [{ pointer: { table: 'block', id: pageId, spaceId: ids.space }, path: ['properties', 'title'], command: 'set', args: [['Rules v2']] }]);
    const rows = db.db.prepare("SELECT event, target_id, actor_id FROM audit_log WHERE event = 'custom_agent_instructions_page_edited' AND target_id = ?").all(a.id) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBe(ids.A);
  });
});

describe('Enterprise controls', () => {
  it('Content search “Shared with” an agent lists the pages it can access', async () => {
    const a = mkAgent('Indexer', { grants: [{ block_id: ids.shared, role: 'reader' }] });
    const sp = db.getRecord<any>('space', ids.space);
    db.putRecord('space', { ...sp, plan_type: 'enterprise' });
    try {
      const got = (await call(ids.A, 'searchContentAsAdmin', { spaceId: ids.space, sharedWithAgent: a.id, limit: 200 })).rows.map((r: any) => r.pageId);
      expect(got).toEqual(expect.arrayContaining([ids.shared, ids.child]));
      expect(got).not.toContain(ids.private);
      expect(got).not.toContain(ids.unlinked);
      expect(got).not.toContain(ids.everyone);
      // with "Pages shared with everyone" on, workspace-wide pages are included too
      setGrants(a.id, [{ block_id: ids.shared, role: 'reader' }], { workspace_access: 'reader' });
      expect((await call(ids.A, 'searchContentAsAdmin', { spaceId: ids.space, sharedWithAgent: a.id })).rows.map((r: any) => r.pageId)).toContain(ids.everyone);
      // an unknown agent matches nothing; members can't use content search
      expect((await call(ids.A, 'searchContentAsAdmin', { spaceId: ids.space, sharedWithAgent: newId() })).rows).toEqual([]);
      expect(await status(() => call(ids.B, 'searchContentAsAdmin', { spaceId: ids.space, sharedWithAgent: a.id }))).toBe(403);
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.space), plan_type: sp.plan_type });
    }
  });

  it('Analytics › AI lists the most and least used agents', async () => {
    const busy = mkAgent('Busy bee');
    const idle = mkAgent('Idle helper');
    runs.setAgentClient(fake([say('Done.')]) as any);
    runs.enqueueRun({ agent: busy, kind: 'manual', label: 'Run agent', actorId: ids.A });
    runs.enqueueRun({ agent: busy, kind: 'manual', label: 'Run agent', actorId: ids.B });
    await runs.drainRuns();
    const an = await call(ids.A, 'adminAgentAnalytics', { spaceId: ids.space, days: 30 });
    expect(an.agents.find((x: any) => x.id === busy.id)).toMatchObject({ runs: 2, chats: 0, people: 2 });
    expect(an.agents.find((x: any) => x.id === idle.id)).toMatchObject({ runs: 0, chats: 0, people: 0 });
    expect(an.agents.findIndex((x: any) => x.id === busy.id)).toBeLessThan(an.agents.findIndex((x: any) => x.id === idle.id));
    expect(an.totals.used).toBeGreaterThanOrEqual(1);
    expect(await status(() => call(ids.B, 'adminAgentAnalytics', { spaceId: ids.space, days: 30 }))).toBe(403);
    // the members table of Analytics › AI lists people only (an agent's triggered runs aren't a member's AI actions)
    const sp = db.getRecord<any>('space', ids.space);
    db.putRecord('space', { ...sp, plan_type: 'enterprise' });
    try {
      const ai = await call(ids.A, 'getWorkspaceAnalytics', { spaceId: ids.space, tab: 'ai', days: 30 });
      expect(ai.topUsers.some((u: any) => u.userId === busy.bot_id)).toBe(false);
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.space), plan_type: sp.plan_type });
    }
  });

  it('agents of people who left show up for transfer (Recently left, AGT-020.4)', async () => {
    const seed = await import('../src/seed.ts');
    const L = newId();
    seed.createUser(L, 'l@agents.test', 'Leaver');
    seed.addMember(ids.space, L, 'member');
    const theirs = mkAgent('Leaver’s agent', {}, { by: L, permissions: [{ type: 'user_permission', role: 'editor', user_id: L }] });
    expect((await call(ids.A, 'adminOrphanedAgents', { spaceId: ids.space })).agents.map((x: any) => x.id)).not.toContain(theirs.id);
    const sp = db.getRecord<any>('space', ids.space);
    db.putRecord('space', { ...sp, permissions: sp.permissions.filter((p: any) => p.user_id !== L) });
    const left = (await call(ids.A, 'adminOrphanedAgents', { spaceId: ids.space, userId: L })).agents;
    expect(left).toEqual([expect.objectContaining({ id: theirs.id, ownerName: 'Leaver' })]);
    expect(await status(() => call(ids.B, 'adminOrphanedAgents', { spaceId: ids.space }))).toBe(403);
    await call(ids.A, 'transferAgentOwnership', { agentId: theirs.id, userId: ids.C });
    expect((await call(ids.A, 'adminOrphanedAgents', { spaceId: ids.space })).agents.map((x: any) => x.id)).not.toContain(theirs.id);
  });
});

describe('agents without an owner', () => {
  it('keep running for 7 days after the last Full access person left, then are disabled until someone owns them', async () => {
    const seed = await import('../src/seed.ts');
    const { audit } = await import('../src/audit.ts');
    const L = newId();
    seed.createUser(L, 'l2@agents.test', 'Leaver Two');
    seed.addMember(ids.space, L, 'member');
    const a = mkAgent('Orphan watch', {}, { by: L, permissions: [{ type: 'user_permission', role: 'editor', user_id: L }, { type: 'user_permission', role: 'read_and_write', user_id: ids.B }] });
    expect(model.orphanState(model.getAgent(a.id)!)).toBeNull();
    const sp = db.getRecord<any>('space', ids.space);
    db.putRecord('space', { ...sp, permissions: sp.permissions.filter((p: any) => p.user_id !== L) });
    const DAY = 86_400_000;
    // L left 3 days ago: still running, and the agent page counts down
    audit('member_left', { spaceId: ids.space, actorId: L, targetId: L, time: Date.now() - 3 * DAY });
    const detail = await call(ids.B, 'getAgent', { agentId: a.id });
    expect(detail.orphan).toMatchObject({ daysRemaining: 4 });
    runs.setAgentClient(fake([say('Done.')]) as any);
    runs.enqueueRun({ agent: model.getAgent(a.id)!, kind: 'manual', label: 'Run agent', actorId: ids.B });
    await runs.drainRuns();
    expect(runs.listRuns(a.id, {})[0].status).not.toBe('failed');
    // 8 days ago: the next run is refused and the agent is disabled ("No owner"); re-enabling needs an owner first
    audit('member_removed', { spaceId: ids.space, actorId: ids.A, targetId: L, time: Date.now() - 8 * DAY });
    db.db.prepare("DELETE FROM audit_log WHERE target_id = ? AND event = 'member_left'").run(L);
    runs.enqueueRun({ agent: model.getAgent(a.id)!, kind: 'manual', label: 'Run agent', actorId: ids.B });
    await runs.drainRuns();
    expect(runs.listRuns(a.id, {})[0]).toMatchObject({ status: 'failed', error: expect.stringContaining('no one has full access') });
    expect(model.getAgent(a.id)).toMatchObject({ status: 'disabled', paused_reason: 'orphaned' });
    expect(await status(() => call(ids.A, 'setAgentEnabled', { agentId: a.id, enabled: true }))).toBe(400);
    expect((await call(ids.A, 'adminOrphanedAgents', { spaceId: ids.space })).agents.find((x: any) => x.id === a.id)).toMatchObject({ status: 'disabled' });
    // a workspace owner transfers it: owned again, running again
    await call(ids.A, 'transferAgentOwnership', { agentId: a.id, userId: ids.C });
    expect(model.getAgent(a.id)).toMatchObject({ status: 'active' });
    expect(model.orphanState(model.getAgent(a.id)!)).toBeNull();
    expect((await call(ids.C, 'getAgent', { agentId: a.id })).orphan).toBeNull();
  });
});

describe('the creator cap', () => {
  it('an agent never does more on a page than its editors can — even after one of them loses access', async () => {
    const pageId = page('Cap test', ids.space, 'space', [{ type: 'user_permission', role: 'editor', user_id: ids.A }]);
    const a = mkAgent('Capped', { grants: [{ block_id: pageId, role: 'read_and_write' }] });
    expect(records.blockRole(pageId, a.bot_id)).toBe('read_and_write');
    // A (the agent's only editor) is reduced to view access: the agent can only view too
    const p = block(pageId);
    db.putRecord('block', { ...p, permissions: [{ type: 'user_permission', role: 'reader', user_id: ids.A }, { type: 'user_permission', role: 'editor', user_id: ids.C }] });
    await new Promise((r) => setTimeout(r, 2100));
    expect(records.blockRole(pageId, a.bot_id)).toBe('reader');
    expect((await tool(a.bot_id, 'update_page', { page_id: pageId, command: 'update_properties', title: 'Renamed by agent' })).isError).toBe(true);
    // no editor can open it anymore: nothing (and runs are blocked by the editor access check)
    db.putRecord('block', { ...block(pageId), permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.C }] });
    await new Promise((r) => setTimeout(r, 2100));
    expect(records.blockRole(pageId, a.bot_id)).toBe('none');
    expect(access.editorAccessCheck(model.getAgent(a.id)!).ok).toBe(false);
  });
});

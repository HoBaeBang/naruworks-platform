// item 28: Custom Agent triggers respect the agent's own property and row access (capped by its editors). A
// comment — or an @mention — inside a thread on a database property value the agent can't see doesn't start a run (its
// text never reaches the agent), and "property updated" triggers ignore (and don't name) properties it can't see.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-agent-triggers-test-'));
process.env.NC_SCHEDULER = '0';
process.env.NC_AGENT_TRIGGER_WINDOW_MS = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const okClient = {
  beta: {
    messages: {
      stream: (() => ({
        async *[Symbol.asyncIterator]() { yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }; yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Noted.' } }; },
        finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Noted.' }], usage }),
      })) as any,
    },
  },
};

let db: typeof import('../src/db.ts');
let records: typeof import('../src/records.ts');
let model: typeof import('../src/agents/model.ts');
let runs: typeof import('../src/agents/runs.ts');
let triggers: typeof import('../src/agents/triggers.ts');
let newId: () => string;
const ids = {} as Record<string, string>;
const now = Date.now();

function comment(userId: string, parentId: string, text: unknown[], propertyId?: string) {
  const did = newId();
  const cid = newId();
  records.applyTransactions(userId, [{
    id: newId(), spaceId: ids.space, operations: [
      { pointer: { table: 'discussion', id: did, spaceId: ids.space }, path: [], command: 'set', args: { id: did, parent_id: parentId, parent_table: 'block', resolved: false, comments: [], space_id: ids.space, alive: true, type: propertyId ? 'default' : 'page', created_by_id: userId, created_time: now, ...(propertyId ? { property_id: propertyId } : {}) } },
      { pointer: { table: 'block', id: parentId, spaceId: ids.space }, path: ['discussions'], command: 'listAfter', args: { id: did } },
      { pointer: { table: 'comment', id: cid, spaceId: ids.space }, path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text, created_by_id: userId, created_time: now, last_edited_time: now, alive: true, space_id: ids.space } },
      { pointer: { table: 'discussion', id: did, spaceId: ids.space }, path: ['comments'], command: 'listAfter', args: { id: cid } },
    ],
  } as any], undefined, { client: true });
}

async function settle() {
  triggers.flushTriggers();
  await runs.drainRuns();
}
const runsOf = (agentId: string, type: string) => runs.listRuns(agentId, {}).filter((r) => r.triggerType === type);
const factsOf = (agentId: string, type: string) => JSON.stringify(runsOf(agentId, type).map((r) => r.payload));

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  await import('../src/api/modules/agents.ts');
  db = await import('../src/db.ts');
  records = await import('../src/records.ts');
  model = await import('../src/agents/model.ts');
  runs = await import('../src/agents/runs.ts');
  triggers = await import('../src/agents/triggers.ts');
  runs.setAgentClient(okClient as any);
  const seed = await import('../src/seed.ts');
  for (const n of ['A', 'X']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n.toLowerCase()}@aisec-agent-triggers.test`, `User ${n}`);
  }
  ids.space = seed.createWorkspace(ids.A, 'Triggers').space.id;
  seed.addMember(ids.space, ids.X, 'member');
  db.putRecord('space', { ...db.getRecord<any>('space', ids.space), plan_type: 'business' });
  // Staff: X can edit it but "Bonus" is No access for X (X is the agent's only editor)
  ids.db = newId();
  ids.col = newId();
  ids.row = newId();
  db.putRecord('block', { id: ids.db, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: ids.col, view_ids: [], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'read_and_write', user_id: ids.X }], created_time: now } as any);
  db.putRecord('collection', {
    id: ids.col, version: 1, parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, name: [['Staff']],
    schema: { title: { name: 'Name', type: 'title' }, bonus: { name: 'Bonus', type: 'text', property_permissions: { default_access: 'reader', overrides: [{ type: 'user_permission', user_id: ids.X, role: 'none' }] } } },
  } as any);
  db.putRecord('block', { id: ids.row, version: 1, type: 'page', parent_id: ids.col, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Kim']], bonus: [['bonus-tapir']] }, created_time: now } as any);
  const agent = model.createAgent({
    spaceId: ids.space, userId: ids.X, published: true,
    config: {
      name: 'Staff watcher', grants: [{ block_id: ids.db, role: 'read_and_write' }],
      triggers: [
        { id: 'c', type: 'lit.comment_added', enabled: true, page_id: ids.db },
        { id: 'm', type: 'lit.agent_mentioned', enabled: true },
        { id: 'u', type: 'lit.page_updated', enabled: true, collection_id: ids.col },
      ],
    } as any,
  });
  ids.agent = agent.id;
  ids.bot = agent.bot_id;
});

describe('agent triggers on values the agent can’t see (item 28)', () => {
  it('a comment on a hidden property value starts no run; one on the page does', async () => {
    comment(ids.A, ids.row, [['Bonus approved: walrus-950']], 'bonus');
    await settle();
    expect(runsOf(ids.agent, 'lit.comment_added')).toHaveLength(0);
    comment(ids.A, ids.row, [['Welcome aboard']]);
    await settle();
    expect(runsOf(ids.agent, 'lit.comment_added')).toHaveLength(1);
    expect(factsOf(ids.agent, 'lit.comment_added')).toContain('Welcome aboard');
    expect(factsOf(ids.agent, 'lit.comment_added')).not.toContain('walrus-950');
  });

  it('an @mention inside a hidden property-value thread stays there', async () => {
    comment(ids.A, ids.row, [['‣', [['u', ids.bot]]], [' raise to narwhal-990?']], 'bonus');
    await settle();
    expect(factsOf(ids.agent, 'lit.agent_mentioned')).not.toContain('narwhal-990');
    expect(runsOf(ids.agent, 'lit.agent_mentioned')).toHaveLength(0);
  });

  it('"property updated" ignores and doesn’t name properties the agent can’t see', async () => {
    const op = (path: string[], args: unknown) => ({ pointer: { table: 'block', id: ids.row, spaceId: ids.space }, path, command: 'set', args });
    records.applyTransactions(ids.A, [{ id: newId(), spaceId: ids.space, operations: [op(['properties', 'bonus'], [['bonus-yak']])] } as any], undefined, { client: true });
    await settle();
    expect(runsOf(ids.agent, 'lit.page_updated')).toHaveLength(0);
    records.applyTransactions(ids.A, [{ id: newId(), spaceId: ids.space, operations: [op(['properties', 'title'], [['Kim Lee']]), op(['properties', 'bonus'], [['bonus-okapi']])] } as any], undefined, { client: true });
    await settle();
    expect(runsOf(ids.agent, 'lit.page_updated')).toHaveLength(1);
    expect(factsOf(ids.agent, 'lit.page_updated')).toContain('Properties updated (Name)');
    expect(factsOf(ids.agent, 'lit.page_updated')).not.toContain('Bonus');
  });
});

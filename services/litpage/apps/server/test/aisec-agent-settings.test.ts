// item 19: Custom Agent settings the server used to ignore.
// - Model › Fallback behavior when the model has an outage: "Use a backup model" runs on another allowed model, "Wait
// until available" retries, "Fail in case of outage" fails
// - Advanced › Model override access: a model picked for one chat is used for it only while the agent allows it
// - Advanced › Share conversations across users: read_agent_history shows everyone's conversations only when it is on
// - the Activity CSV export can't carry spreadsheet formulas
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-agent-settings-test-'));
process.env.NC_SCHEDULER = '0';
process.env.NC_AGENT_TRIGGER_WINDOW_MS = '0';
process.env.NC_AGENT_OUTAGE_RETRY_MS = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
type Turn = { throw?: Error; events?: any[]; final?: any };
function fake(turns: Turn[], seen: any[] = []) {
  let i = 0;
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const t = turns[Math.min(i++, turns.length - 1)];
          if (t.throw) throw t.throw;
          return { async *[Symbol.asyncIterator]() { for (const e of t.events ?? []) yield e; }, finalMessage: async () => t.final };
        }) as any,
      },
    },
  };
}
const say = (text: string): Turn => ({
  events: [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }, { type: 'content_block_stop', index: 0 }],
  final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage },
});
const callTool = (name: string, input: Record<string, unknown>): Turn => ({ final: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 8)}`, name, input }], usage } });

let model: typeof import('../src/agents/model.ts');
let runs: typeof import('../src/agents/runs.ts');
let db: typeof import('../src/db.ts');
let AiError: typeof import('../src/ai/client.ts')['AiError'];
let newId: () => string;
const ids = {} as Record<string, string>;

function mkAgent(name: string, config: Record<string, unknown>, by = ids.A) {
  return model.createAgent({ spaceId: ids.space, userId: by, config: { name, ...config } as any, published: true, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }, { type: 'user_permission', role: 'reader', user_id: ids.B }, { type: 'user_permission', role: 'reader', user_id: ids.C }] });
}
async function chat(agentId: string, userId: string, text: string, turns: Turn[], extra: Record<string, unknown> = {}) {
  const seen: any[] = [];
  const prep = runs.prepareAgentChat({ userId, agentId, text, ...extra });
  const out = await runs.executeAgentChat(prep, {}, undefined, fake(turns, seen) as any);
  return { out, seen, prep };
}
const overloaded = () => new AiError('overloaded', 'Litpage AI is busy right now. Try again in a moment.', 529);

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  await import('../src/api/modules/agents.ts');
  model = await import('../src/agents/model.ts');
  runs = await import('../src/agents/runs.ts');
  db = await import('../src/db.ts');
  ({ AiError } = await import('../src/ai/client.ts'));
  const seed = await import('../src/seed.ts');
  for (const n of ['A', 'B', 'C']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n.toLowerCase()}@aisec-agent-settings.test`, `User ${n}`);
  }
  ids.space = seed.createWorkspace(ids.A, 'Settings').space.id;
  seed.addMember(ids.space, ids.B, 'member');
  seed.addMember(ids.space, ids.C, 'member');
  db.putRecord('space', { ...db.getRecord<any>('space', ids.space), plan_type: 'business' });
});

describe('Fallback behavior on an outage', () => {
  it('Use a backup model: the run continues on another model', async () => {
    const a = mkAgent('Backup bot', { model: 'claude-opus-5-5', fallback: 'auto' });
    const r = await chat(a.id, ids.A, 'hello', [{ throw: overloaded() }, say('Served by the backup.')]);
    expect(r.out.status).toBe('success');
    expect(r.seen.map((p) => p.model)).toEqual(['claude-opus-5-5', expect.not.stringMatching(/^claude-opus-5-5$/)]);
  });

  it('Wait until available: retried on the same model', async () => {
    const a = mkAgent('Patient bot', { model: 'claude-opus-5-5', fallback: 'wait' });
    const r = await chat(a.id, ids.A, 'hello', [{ throw: overloaded() }, { throw: overloaded() }, say('Back now.')]);
    expect(r.out.status).toBe('success');
    expect(r.seen.map((p) => p.model)).toEqual(['claude-opus-5-5', 'claude-opus-5-5', 'claude-opus-5-5']);
  });

  it('Fail in case of outage: the run fails', async () => {
    const a = mkAgent('Strict bot', { model: 'claude-opus-5-5', fallback: 'none' });
    const r = await chat(a.id, ids.A, 'hello', [{ throw: overloaded() }, say('never')]);
    expect(r.out.status).toBe('failed');
    expect(r.seen).toHaveLength(1);
  });
});

describe('Model override access', () => {
  it('a chat’s own model is used only while the agent allows it', async () => {
    const a = mkAgent('Model bot', { model: 'claude-haiku-5-5' });
    const picked = await chat(a.id, ids.B, 'use sonnet', [say('ok')], { model: 'claude-sonnet-5-5' });
    expect(picked.seen[0].model).toBe('claude-sonnet-5-5');
    // the chat keeps it
    const again = await chat(a.id, ids.B, 'again', [say('ok')], { threadId: picked.prep.thread.id });
    expect(again.seen[0].model).toBe('claude-sonnet-5-5');
    // turned off: the agent's model, whatever the chat asked for
    const cur = model.getAgent(a.id)!;
    model.saveAgentRecord({ ...cur, data: { ...cur.data, allow_model_override: false } });
    const off = await chat(a.id, ids.B, 'once more', [say('ok')], { threadId: picked.prep.thread.id, model: 'claude-sonnet-5-5' });
    expect(off.seen[0].model).toBe('claude-haiku-5-5');
  });
});

describe('Share conversations across users', () => {
  it('read_agent_history shows other people’s conversations only when shared', async () => {
    const a = mkAgent('Memory bot', {});
    await chat(a.id, ids.B, 'B secret: the vault code is aardvark-42', [say('Noted, B.')]);
    const history = async () => {
      const r = await chat(a.id, ids.C, 'what did people ask you?', [callTool('read_agent_history', {}), say('done')]);
      const results = r.seen[1].messages.at(-1).content.filter((b: any) => b.type === 'tool_result');
      return String(results[0]?.content ?? '');
    };
    const off = await history();
    expect(off).not.toContain('aardvark-42');
    const cur = model.getAgent(a.id)!;
    model.saveAgentRecord({ ...cur, data: { ...cur.data, share_chat_history: true } });
    const on = await history();
    expect(on).toContain('aardvark-42');
    expect(on).toContain('Chat with User B');
  });
});

describe('Activity CSV export', () => {
  it('neutralizes spreadsheet formulas', async () => {
    const a = mkAgent('CSV bot', {});
    await chat(a.id, ids.A, '=HYPERLINK("https://evil.example","click")', [say('ok')]);
    const csv = runs.runsCsv(a.id, 0);
    expect(csv).toContain(`"'=HYPERLINK(""https://evil.example"",""click"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});

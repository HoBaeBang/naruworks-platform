// Regression test: the ∑ formula assistant of a button block (no data source) — the request names the
// button, the server checks edit access to it (no more 404 for every request) and the model is told there are no
// page properties. The model is a fake client — no network; the key is a dummy that is never used.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-formula-ai-test-'));
const savedKey = process.env.ANTHROPIC_API_KEY;

let mod: typeof import('../src/api/modules/formulaAi.ts');
let db: typeof import('../src/db.ts');
const ids = {} as Record<string, string>;

function fake(text: string, seen: any[]) {
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const events = [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }];
          return {
            async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
            finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 } }),
          };
        }) as any,
      },
    },
  };
}

beforeAll(async () => {
  const { newId } = await import('@nc/shared/ids.ts');
  const seed = await import('../src/seed.ts');
  db = await import('../src/db.ts');
  mod = await import('../src/api/modules/formulaAi.ts');
  for (const n of ['owner', 'viewer', 'stranger']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@fx-button.test`, n);
  }
  const { spaceView } = seed.createWorkspace(ids.owner, 'Buttons');
  seed.createWorkspace(ids.stranger, 'Elsewhere');
  const page = spaceView.private_pages[0];
  const now = Date.now();
  ids.button = newId();
  db.putRecord('block', { id: ids.button, version: 1, type: 'button', parent_id: page, parent_table: 'block', space_id: spaceView.space_id, alive: true, properties: { title: [['Log time']] }, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner } as any);
  const p = db.getRecord<any>('block', page)!;
  db.putRecord('block', { ...p, content: [...(p.content ?? []), ids.button], permissions: [...(p.permissions ?? []), { type: 'user_permission', role: 'reader', user_id: ids.viewer }] });
  process.env.ANTHROPIC_API_KEY = 'dummy-key-never-used';
});

afterAll(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

const ask = (userId: string, body: any) => mod.handlers.aiFormula({ userId, setCookie: () => {} } as any, body);

describe('formula assistant for button blocks', () => {
  it('accepts the button instead of a data source, for people who can edit it', async () => {
    // reaches the request checks (an empty prompt is refused before any model call) instead of "Not found"
    await expect(ask(ids.owner, { blockId: ids.button, prompt: '' })).rejects.toThrow('Tell Litpage AI what to write.');
    await expect(ask(ids.viewer, { blockId: ids.button, prompt: 'now' })).rejects.toThrow('Not found');
    await expect(ask(ids.stranger, { blockId: ids.button, prompt: 'now' })).rejects.toThrow('Not found');
    await expect(ask(ids.owner, { prompt: 'now' })).rejects.toThrow('Not found');
  });

  it('tells the model the formula has no page properties', async () => {
    const seen: any[] = [];
    const r = await mod.runFormulaAssistant({ userId: ids.owner, prompt: 'the time now', context: [{ label: 'Time triggered', type: 'date' }] }, fake('{"formula": "now()", "explanation": "The current time."}', seen) as any);
    expect(r.formula).toBe('now()');
    const msg = seen[0].messages[0].content[0].text as string;
    expect(msg).toContain('button on a page, not in a database');
    expect(msg).not.toContain('<database>');
    expect(msg).toContain('ctx("Time triggered") (date)');
  });
});

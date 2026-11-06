// Formula assistant: the "connect a key" state, the request the model gets (schema, related
// databases, current formula + error, automation values) and the repair round for a formula that doesn't parse.
// The model is a fake client — no network.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-formula-ai-test-'));
delete process.env.ANTHROPIC_API_KEY;

const usage = { input_tokens: 10, output_tokens: 5 };
function fake(texts: string[], seen: any[] = []) {
  let i = 0;
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const text = texts[Math.min(i++, texts.length - 1)];
          const events = [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }];
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of events) yield e;
            },
            finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }),
          };
        }) as any,
      },
    },
  };
}

let mod: typeof import('../src/api/modules/formulaAi.ts');
let db: typeof import('../src/db.ts');
let userId = '';
let col: any;

beforeAll(async () => {
  const { newId } = await import('@nc/shared/ids.ts');
  const seed = await import('../src/seed.ts');
  db = await import('../src/db.ts');
  mod = await import('../src/api/modules/formulaAi.ts');
  userId = newId();
  seed.createUser(userId, 'fx@test.dev', 'Fay');
  const { spaceView } = seed.createWorkspace(userId, 'Formula Lab');
  const page = spaceView.private_pages[0];
  const now = Date.now();
  const block = newId();
  const projects = newId();
  const projBlock = newId();
  db.putRecord('block', { id: projBlock, version: 1, type: 'collection_view_page', collection_id: projects, view_ids: [], parent_id: page, parent_table: 'block', space_id: spaceView.space_id, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId } as any);
  db.putRecord('collection', { id: projects, version: 1, parent_id: projBlock, parent_table: 'block', space_id: spaceView.space_id, alive: true, name: [['Projects']], schema: { title: { name: 'Project', type: 'title' }, lead: { name: 'Lead', type: 'person' } } } as any);
  db.putRecord('block', { id: block, version: 1, type: 'collection_view_page', collection_id: 'colfx', view_ids: [], parent_id: page, parent_table: 'block', space_id: spaceView.space_id, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId } as any);
  col = {
    id: 'colfx', version: 1, parent_id: block, parent_table: 'block', space_id: spaceView.space_id, alive: true, name: [['Tasks']],
    schema: {
      title: { name: 'Name', type: 'title' }, due: { name: 'Due', type: 'date' },
      st: { name: 'Status', type: 'status', options: [{ id: 'a', value: 'Done', color: 'green' }] },
      proj: { name: 'Project', type: 'relation', collection_id: projects },
    },
  };
  db.putRecord('collection', col);
});

describe('formula assistant', () => {
  it('needs a key (connect-a-key state)', async () => {
    await expect(mod.handlers.aiFormula({ userId, setCookie: () => {} } as any, { collectionId: 'colfx', prompt: 'days until due' })).rejects.toThrow('Connect an AI provider to use Litpage AI');
  });

  it('sends the schema, related databases, formula, error and automation values; returns formula + explanation', async () => {
    const seen: any[] = [];
    const client = fake(['```json\n{"formula": "dateBetween(prop(\\"Due\\"), today(), \\"days\\")", "explanation": "Days from today until Due."}\n```'], seen);
    const r = await mod.runFormulaAssistant({ userId, collection: col, prompt: 'days until due', formula: 'prop("Due")', error: 'Type mismatch', context: [{ label: 'Trigger page', type: 'page' }] }, client as any);
    expect(r.formula).toBe('dateBetween(prop("Due"), today(), "days")');
    expect(r.explanation).toBe('Days from today until Due.');
    const msg = seen[0].messages[0].content[0].text as string;
    expect(msg).toContain('- Due (date)');
    expect(msg).toContain('- Status (status: Done)');
    expect(msg).toContain('Related database "Projects" (through "Project")');
    expect(msg).toContain('- Lead (person)');
    expect(msg).toContain('<current_formula>\nprop("Due")');
    expect(msg).toContain('<current_error>Type mismatch</current_error>');
    expect(msg).toContain('ctx("Trigger page") (page)');
    expect(seen[0].system[0].text).toContain('Use empty() for "no value"');
  });

  it('repairs a formula that does not parse', async () => {
    const seen: any[] = [];
    const client = fake(['{"formula": "if(prop(\\"Done\\"), \\"yes\\"", "explanation": "x"}', '{"formula": "if(prop(\\"Done\\"), \\"yes\\", \\"no\\")", "explanation": "Yes when done."}'], seen);
    const r = await mod.runFormulaAssistant({ userId, collection: col, prompt: 'yes when done' }, client as any);
    expect(r.repaired).toBe(true);
    expect(r.formula).toBe('if(prop("Done"), "yes", "no")');
    expect(seen).toHaveLength(2);
    expect(seen[1].messages.at(-1).content[0].text).toContain('does not parse');
  });

  it('parses prose answers', () => {
    expect(mod.parseAssistantAnswer('This formula adds one day.')).toEqual({ formula: '', explanation: 'This formula adds one day.' });
  });

  it('stores feedback', () => {
    expect(mod.handlers.aiFormulaFeedback({ userId } as any, { rating: 'negative', comment: 'wrong unit', prompt: 'p', formula: 'f' })).toEqual({ ok: true });
    const row = db.db.prepare('SELECT rating, comment FROM ai_formula_feedback WHERE user_id = ?').get(userId) as any;
    expect(row).toEqual({ rating: 'negative', comment: 'wrong unit' });
  });
});

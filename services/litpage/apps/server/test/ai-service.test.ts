// Integration test of AI service orchestration against a real (temporary) SQLite workspace with a fake
// Claude client: context serialization from blocks, thread persistence, the search_workspace tool,
// citations, retry, autofill and the missing-key error.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-test-'));
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

let svc: typeof import('../src/ai/service.ts');
let threads: typeof import('../src/ai/threads.ts');
let userId = '';
let spaceId = '';
let pageId = '';

beforeAll(async () => {
  const { newId } = await import('@nc/shared/ids.ts');
  const seed = await import('../src/seed.ts');
  const db = await import('../src/db.ts');
  svc = await import('../src/ai/service.ts');
  threads = await import('../src/ai/threads.ts');
  userId = newId();
  seed.createUser(userId, 'ai@test.dev', 'Ada');
  const { space, spaceView } = seed.createWorkspace(userId, 'AI Lab');
  spaceId = space.id;
  pageId = spaceView.private_pages[0];
  // a database with one row for autofill
  const { indexBlock } = await import('../src/search.ts');
  const now = Date.now();
  const dbBlock = { id: 'db1', version: 1, type: 'collection_view', collection_id: 'col1', view_ids: [], parent_id: pageId, parent_table: 'block', space_id: spaceId, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId };
  db.putRecord('block', dbBlock as any);
  db.putRecord('collection', { id: 'col1', version: 1, parent_id: 'db1', parent_table: 'block', alive: true, space_id: spaceId, schema: { title: { name: 'Name', type: 'title' }, size: { name: 'Size', type: 'select', options: [{ id: 'o1', value: 'Small', color: 'gray' }, { id: 'o2', value: 'Large', color: 'red' }] }, sum: { name: 'Summary', type: 'text' } } } as any);
  const row = { id: 'row1', version: 1, type: 'page', properties: { title: [['Acme expansion deal']] }, parent_id: 'col1', parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId };
  db.putRecord('block', row as any);
  indexBlock(row as any);
});

describe('chat orchestration', () => {
  it('attaches the current page, persists the turn and resolves search citations', async () => {
    const prep = svc.prepareChatTurn({ userId, spaceId, text: 'What does Welcome to Litpage say about shortcuts?', pageId });
    expect(prep.thread.title).toBe('What does Welcome to Litpage say about shortcuts?');
    const ctx = prep.userMessage!.data.contexts!;
    expect(ctx).toHaveLength(1);
    expect(ctx[0]).toMatchObject({ kind: 'page', pageId, title: 'Welcome to Litpage' });
    expect(ctx[0].markdown).toContain('# Welcome to Litpage');
    expect(ctx[0].markdown).toContain('▸ More shortcuts and ideas');

    const seen: any[] = [];
    const sources: any[] = [];
    const client = fake([
      { final: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'search_workspace', input: { query: 'Acme expansion' } }], usage } },
      say('The Acme deal is in your tracker [1].'),
    ], seen);
    const res = await svc.executeChatTurn(prep, { sources: (s) => sources.push(s) }, undefined, client as any);
    expect(res.status).toBe('complete');
    expect(res.message!.data.text).toBe('The Acme deal is in your tracker [1].');
    expect(res.message!.data.sources).toEqual([{ n: 1, pageId: 'row1', title: 'Acme expansion deal' }]);
    expect(sources.at(-1)).toEqual([{ n: 1, pageId: 'row1', title: 'Acme expansion deal' }]);
    const toolResult = seen[1].messages.at(-1).content[0];
    expect(toolResult.content).toContain('[1] Acme expansion deal (page_id: row1)');

    // second turn on the same unchanged page: the page is not re-sent, history is replayed verbatim
    const prep2 = svc.prepareChatTurn({ userId, spaceId, threadId: prep.thread.id, text: 'Thanks', pageId });
    expect(prep2.userMessage!.data.contexts).toEqual([]);
    const seen2: any[] = [];
    await svc.executeChatTurn(prep2, {}, undefined, fake([say('You are welcome.')], seen2) as any);
    const msgs = seen2[0].messages;
    expect(msgs.map((m: any) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[0].content[0].text).toContain('<page id="' + pageId + '" title="Welcome to Litpage">');
    expect(msgs[1].content).toBe('The Acme deal is in your tracker [1].');

    // retry replaces the last answer
    const prep3 = svc.prepareChatTurn({ userId, spaceId, threadId: prep.thread.id, retry: true });
    expect(prep3.userMessage).toBeNull();
    await svc.executeChatTurn(prep3, {}, undefined, fake([say('Glad to help!')]) as any);
    const stored = threads.listMessages(prep.thread.id);
    expect(stored.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(stored.at(-1)!.data.text).toBe('Glad to help!');
  });

  it('retrieve: numbers workspace search results as sources up front', () => {
    const prep = svc.prepareChatTurn({ userId, spaceId, text: 'Acme expansion', retrieve: true });
    expect(prep.sources).toEqual([{ n: 1, pageId: 'row1', title: 'Acme expansion deal' }]);
    expect(prep.userMessage!.data.contexts![0]).toMatchObject({ kind: 'source', n: 1, pageId: 'row1' });
  });

  it('rejects other users and unknown threads', () => {
    expect(() => svc.prepareChatTurn({ userId: 'someone-else', spaceId, text: 'hi' })).toThrow(/access/);
    expect(() => svc.prepareChatTurn({ userId, spaceId, threadId: 'nope', text: 'hi' })).toThrow(/doesn’t exist/);
  });

  it('records refusals and errors as message status', async () => {
    const prep = svc.prepareChatTurn({ userId, spaceId, text: 'x' });
    const res = await svc.executeChatTurn(prep, {}, undefined, fake([{ final: { model: 'm', stop_reason: 'refusal', content: [], usage } }]) as any);
    expect(res.status).toBe('refused');
    const prep2 = svc.prepareChatTurn({ userId, spaceId, threadId: prep.thread.id, text: 'y' });
    const broken = { beta: { messages: { stream: () => { throw new Error('boom sk-ant-test-0000000000'); } } } };
    const res2 = await svc.executeChatTurn(prep2, {}, undefined, broken as any);
    expect(res2.status).toBe('error');
    expect(res2.error!.message).not.toContain('sk-ant');
  });
});

describe('Settings → Litpage AI personalization', () => {
  it('chat and Q&A follow the instructions page and the personalized name', async () => {
    const db = await import('../src/db.ts');
    const now = Date.now();
    const base = { version: 1, space_id: spaceId, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId };
    db.putRecord('block', { ...base, id: 'instr', type: 'page', properties: { title: [['AI instructions']] }, content: ['instr-1'], parent_id: spaceId, parent_table: 'space', permissions: [{ role: 'editor', type: 'user_permission', user_id: userId }] } as any);
    db.putRecord('block', { ...base, id: 'instr-1', type: 'bulleted_list', properties: { title: [['Always answer in Korean.']] }, parent_id: 'instr', parent_table: 'block' } as any);
    const prev = db.getRecord<any>('user_settings', userId);
    db.putRecord('user_settings', { ...(prev ?? { id: userId, version: 1 }), settings: { ...(prev?.settings ?? {}), ai_name: 'Nori', ai_instructions_page: 'instr' } } as any);
    try {
      const prep = svc.prepareChatTurn({ userId, spaceId, text: 'hello' });
      const seen: any[] = [];
      await svc.executeChatTurn(prep, {}, undefined, fake([say('안녕하세요')], seen) as any);
      const sys = seen[0].system as any[];
      expect(sys[0].cache_control).toEqual({ type: 'ephemeral' });
      expect(sys[1].text).toContain('The user has named you "Nori".');
      expect(sys[1].text).toContain('<user_instructions>\n- Always answer in Korean.\n</user_instructions>');
      expect(sys[1].text).not.toContain('# AI instructions');

      const qaSeen: any[] = [];
      await svc.runQuery({ userId, spaceId, query: 'toggles' }, fake([say('ok')], qaSeen) as any);
      expect(qaSeen[0].system[1].text).toContain('Always answer in Korean.');

      // an instructions page the user can no longer read is ignored
      db.putRecord('block', { ...db.getRecord<any>('block', 'instr'), alive: false } as any);
      const seen2: any[] = [];
      await svc.executeChatTurn(svc.prepareChatTurn({ userId, spaceId, text: 'again' }), {}, undefined, fake([say('ok')], seen2) as any);
      expect(seen2[0].system[1].text).not.toContain('user_instructions');
    } finally {
      db.putRecord('user_settings', (prev ?? { id: userId, version: 1, settings: {} }) as any);
    }
  });
});

describe('writer, block, autofill', () => {
  it('writer reads the page as context', () => {
    const req = svc.prepareWriter({ userId, pageId, skill: 'Summarize' });
    const content = req.messages[0].content as any[];
    expect(content[0].text).toContain('Welcome to Litpage');
    expect(content.at(-1).text).toContain('Summarize the page');
  });

  it('autofill picks a select option and encodes the value', async () => {
    const r = await svc.runAutofill({ userId, rowId: 'row1', propId: 'size', kind: 'custom', prompt: 'Deal size' }, fake([say('Large')]) as any);
    expect(r).toEqual({ text: 'Large', value: [['Large']] });
    await expect(svc.runAutofill({ userId, rowId: 'row1', propId: 'nope', kind: 'summary' }, fake([say('x')]) as any)).rejects.toThrow(/Unknown property/);
  });

  it('missing key → 400 with the connect message', () => {
    const key = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      let err: any;
      try {
        svc.prepareChatTurn({ userId, spaceId, text: 'hi' });
      } catch (e) {
        err = e;
      }
      expect(err?.status).toBe(400);
      expect(err?.message).toBe('Connect an AI provider to use Litpage AI');
    } finally {
      process.env.ANTHROPIC_API_KEY = key;
    }
  });
});

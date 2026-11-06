// Unit tests for AI service prompt assembly, page serialization and the streaming tool loop.
// Run: pnpm --filter @nc/server test
import { describe, expect, it } from 'vitest';
import {
  autofillValue, buildAutofillRequest, buildBlockRequest, buildChatRequest, buildQaRequest, buildWriterRequest, chatTitleFrom,
  CHAT_SYSTEM, cleanPersonaName, extractSearchTerms, pageToMarkdown, personaSystemText, QA_SYSTEM, resolveSkill, rowToMarkdown,
  validateToolInput, WRITER_SYSTEM,
  type MdBlock, type MdSource, type StoredMessage,
} from '../src/ai/prompts.ts';
import { runStream, type ClaudeLike } from '../src/ai/client.ts';

// ---------------------------------------------------------------------------------------------
// fixtures

function source(blocks: MdBlock[], extra?: Partial<MdSource>): MdSource {
  const map = new Map(blocks.map((b) => [b.id, b]));
  return {
    block: (id) => map.get(id),
    pageTitle: (id) => {
      const b = map.get(id);
      return b ? String((b.properties?.title as any)?.[0]?.[0] ?? '') : '';
    },
    userName: (id) => (id === 'u1' ? 'Ada Lovelace' : ''),
    ...extra,
  };
}

const page: MdBlock[] = [
  { id: 'p', type: 'page', properties: { title: [['Launch plan']] }, content: ['h1', 't1', 'b1', 'n1', 'n2', 'td', 'code', 'tbl', 'm', 'child', 'q'] },
  { id: 'h1', type: 'header', properties: { title: [['Goals']] } },
  { id: 't1', type: 'text', properties: { title: [['Ship '], ['v2', [['b']]], [' by Friday, see '], ['docs', [['a', 'https://docs.litpage.dev']]], ['.']] } },
  { id: 'b1', type: 'bulleted_list', properties: { title: [['Parent']] }, content: ['b2'] },
  { id: 'b2', type: 'bulleted_list', properties: { title: [['Nested']] } },
  { id: 'n1', type: 'numbered_list', properties: { title: [['First']] } },
  { id: 'n2', type: 'numbered_list', properties: { title: [['Second']] } },
  { id: 'td', type: 'to_do', properties: { title: [['Write tests']], checked: [['Yes']] } },
  { id: 'code', type: 'code', properties: { title: [['const x = 1;']], language: [['TypeScript']] } },
  { id: 'tbl', type: 'table', format: { table_block_column_order: ['a', 'b'] }, content: ['r1', 'r2'] },
  { id: 'r1', type: 'table_row', properties: { a: [['Name']], b: [['Owner']] } },
  { id: 'r2', type: 'table_row', properties: { a: [['API']], b: [['‣', [['u', 'u1']]]] } },
  { id: 'm', type: 'text', properties: { title: [['Ask '], ['‣', [['u', 'u1']]], [' about '], ['‣', [['p', 'child']]]] } },
  { id: 'child', type: 'page', properties: { title: [['Spec']] }, content: ['secret'] },
  { id: 'secret', type: 'text', properties: { title: [['child page body is not expanded']] } },
  { id: 'q', type: 'quote', properties: { title: [['Stay curious']] } },
];

// ---------------------------------------------------------------------------------------------

describe('pageToMarkdown', () => {
  it('serializes blocks, inline marks and mentions', () => {
    const r = pageToMarkdown('p', source(page));
    expect(r.title).toBe('Launch plan');
    expect(r.truncated).toBe(false);
    const md = r.markdown;
    expect(md.startsWith('# Launch plan')).toBe(true);
    expect(md).toContain('# Goals');
    expect(md).toContain('Ship **v2** by Friday, see [docs](https://docs.litpage.dev).');
    expect(md).toContain('- Parent\n  - Nested');
    expect(md).toContain('1. First\n2. Second');
    expect(md).toContain('- [x] Write tests');
    expect(md).toContain('```typescript\nconst x = 1;\n```');
    expect(md).toContain('| Name | Owner |\n| --- | --- |\n| API | @Ada Lovelace |');
    expect(md).toContain('Ask @Ada Lovelace about @Spec');
    expect(md).toContain('[Page: Spec] (page_id: child)');
    expect(md).not.toContain('child page body');
    expect(md).toContain('> Stay curious');
  });

  it('truncates at a line boundary and reports it', () => {
    const r = pageToMarkdown('p', source(page), { maxChars: 60 });
    expect(r.truncated).toBe(true);
    expect(r.markdown.length).toBeLessThanOrEqual(60);
    expect(r.totalChars).toBeGreaterThan(60);
  });

  it('skips given subtrees (AI block output is not fed back)', () => {
    const r = pageToMarkdown('p', source(page), { skip: new Set(['code', 'q']) });
    expect(r.markdown).not.toContain('const x');
    expect(r.markdown).not.toContain('Stay curious');
  });

  it('renders inline databases as a table of rows', () => {
    const blocks: MdBlock[] = [
      { id: 'p', type: 'page', properties: { title: [['Tracker']] }, content: ['db'] },
      { id: 'db', type: 'collection_view', collection_id: 'c' },
    ];
    const src = source(blocks, {
      collection: () => ({
        name: 'Tasks',
        schema: { title: { name: 'Name', type: 'title' }, s: { name: 'Status', type: 'select' }, d: { name: 'Done', type: 'checkbox' } },
        rows: [{ id: 'row1', type: 'page', properties: { title: [['Fix bug']], s: [['In progress']], d: [['Yes']] } }],
      }),
    });
    const md = pageToMarkdown('p', src).markdown;
    expect(md).toContain('[Database: Tasks]');
    expect(md).toContain('| Name | Status | Done |');
    expect(md).toContain('| Fix bug | In progress | Yes |');
  });

  it('serializes a database row with its properties', () => {
    const row: MdBlock = { id: 'row', type: 'page', properties: { title: [['Acme deal']], amt: [['1200']], tags: [['B2B,Enterprise']] }, content: ['body'] };
    const src = source([row, { id: 'body', type: 'text', properties: { title: [['Signed in March.']] } }]);
    const md = rowToMarkdown(row, { title: { name: 'Name', type: 'title' }, amt: { name: 'Amount', type: 'number' }, tags: { name: 'Tags', type: 'multi_select' }, sum: { name: 'Summary', type: 'text' } }, src, { skipProp: 'sum' });
    expect(md).toContain('Title: Acme deal');
    expect(md).toContain('Amount: 1200');
    expect(md).toContain('Tags: B2B, Enterprise');
    expect(md).toContain('Signed in March.');
    expect(md).not.toContain('Summary:');
  });
});

describe('prompt assembly', () => {
  const ctx = { pageId: 'p', title: 'Launch plan', markdown: '# Launch plan\n\nShip v2.', truncated: false };

  it('writer: frozen system prompt, cached page context first, task last', () => {
    const req = buildWriterRequest({ skill: 'improve', selection: 'we ship it friday', page: ctx });
    expect(req.system).toEqual([{ type: 'text', text: WRITER_SYSTEM, cache_control: { type: 'ephemeral' } }]);
    expect(req.effort).toBe('low');
    const content = req.messages[0].content as any[];
    expect(content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(content[0].text).toContain('<page id="p" title="Launch plan">');
    expect(content[1].text).toContain('<selection>\nwe ship it friday\n</selection>');
    expect(content[1].text).toContain('Task: Improve the writing of the selected text');
    expect(content[1].cache_control).toBeUndefined();
    // the system prompt never contains request data (prompt caching)
    expect(WRITER_SYSTEM).not.toContain('Launch plan');
  });

  it('writer: translate / tone / topic skills', () => {
    const t = buildWriterRequest({ skill: 'translate', language: 'Korean', selection: 'Hello' });
    expect((t.messages[0].content as any[]).at(-1).text).toContain('into Korean');
    const tone = buildWriterRequest({ skill: 'tone', tone: 'Friendly', selection: 'Hi' });
    expect((tone.messages[0].content as any[]).at(-1).text).toContain('friendly tone');
    const b = buildWriterRequest({ skill: 'brainstorm', prompt: 'team offsite' });
    expect((b.messages[0].content as any[]).at(-1).text).toContain('Brainstorm ideas about: team offsite');
    const cont = buildWriterRequest({ skill: 'continue', before: 'Once upon a time' });
    expect((cont.messages[0].content as any[]).at(-1).text).toContain('<text_before_cursor>\nOnce upon a time');
    const refine = buildWriterRequest({ skill: 'shorter', previous: 'Long draft', selection: 'x' });
    expect((refine.messages[0].content as any[]).at(-1).text).toContain('<previous_ai_output>\nLong draft');
  });

  it('chat: replays context snapshots verbatim and ends with the user turn', () => {
    const history: StoredMessage[] = [
      { role: 'user', text: 'Summarize this', contexts: [{ kind: 'page', ...ctx }] },
      { role: 'assistant', text: 'It is about v2.', status: 'complete' },
      { role: 'user', text: 'And risks?' },
      { role: 'assistant', text: 'Partial', status: 'stopped' },
      { role: 'user', text: 'Go on' },
    ];
    const req = buildChatRequest(history);
    expect(req.system[0].text).toBe(CHAT_SYSTEM);
    expect(req.autoCache).toBe(true);
    expect(req.effort).toBe('medium');
    const names = req.tools?.map((t) => (t as any).name) ?? [];
    expect(names).toEqual(expect.arrayContaining(['search_workspace', 'read_page', 'create_pages', 'update_page', 'create_database', 'delete_pages']));
    expect(names).not.toContain('propose_plan');
    expect((req.tools as any[]).every((t) => t.eager_input_streaming === true)).toBe(true);
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
    const first = req.messages[0].content as any[];
    expect(first[0].text).toBe('<page id="p" title="Launch plan">\n# Launch plan\n\nShip v2.\n</page>');
    expect(first[1].text).toBe('Summarize this');
    expect(req.messages[3].content).toBe('Partial\n\n[Response stopped by the user.]');
    // identical history → identical request bytes (cache prefix stability)
    expect(JSON.stringify(buildChatRequest(history))).toBe(JSON.stringify(req));
  });

  it('chat: drops a trailing assistant turn and empty answers', () => {
    const req = buildChatRequest([
      { role: 'user', text: 'hi' },
      { role: 'assistant', text: '', status: 'error' },
      { role: 'user', text: 'again' },
      { role: 'assistant', text: 'done' },
    ]);
    expect(req.messages.map((m) => m.role)).toEqual(['user', 'user']);
  });

  it('chat: retrieved sources are numbered for citations', () => {
    const req = buildChatRequest([{ role: 'user', text: 'Who owns the API?', contexts: [{ kind: 'source', n: 3, pageId: 'x', title: 'Owners "list"', markdown: 'API: Ada', truncated: true }] }]);
    const text = (req.messages[0].content as any[])[0].text as string;
    expect(text).toContain('<source n="3" id="x" title="Owners &quot;list&quot;">\nAPI: Ada\n[Content truncated.]\n</source>');
    expect(text).toContain('Cite sources as [n].');
  });

  it('qa: sources + question, or an explicit no-results note', () => {
    const q = buildQaRequest('Who owns the API?', [{ kind: 'source', n: 1, pageId: 'x', title: 'Owners', markdown: 'API: Ada', truncated: false }]);
    expect((q.messages[0].content as any[])[0].text).toContain('<source n="1"');
    expect((q.messages[0].content as any[]).at(-1).text).toBe('Question: Who owns the API?');
    const none = buildQaRequest('x', []);
    expect((none.messages[0].content as any[])[0].text).toContain('did not find any pages');
  });

  it('chat / qa: Settings → Litpage AI name and instructions follow the cached system prompt', () => {
    const persona = { name: 'Nori', instructions: '- Answer in Korean.\n- Use tables for comparisons.' };
    const req = buildChatRequest([{ role: 'user', text: 'hi' }], persona);
    expect(req.system).toHaveLength(2);
    expect(req.system[0]).toEqual({ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } });
    expect(req.system[1].cache_control).toBeUndefined();
    expect(req.system[1].text).toContain('The user has named you "Nori".');
    expect(req.system[1].text).toContain('<user_instructions>\n- Answer in Korean.\n- Use tables for comparisons.\n</user_instructions>');
    const qa = buildQaRequest('x', [], { instructions: 'Be brief.', instructionsTruncated: true });
    expect(qa.system[0].text).toBe(QA_SYSTEM);
    expect(qa.system[1].text).toContain('Be brief.\n[Instructions truncated.]');
    // no personalization → the frozen system prompt alone (identical bytes)
    expect(buildChatRequest([{ role: 'user', text: 'hi' }], null).system).toEqual(buildChatRequest([{ role: 'user', text: 'hi' }]).system);
    expect(personaSystemText({ name: 'Litpage AI' })).toBeNull();
    expect(personaSystemText({ name: '  ', instructions: '  ' })).toBeNull();
    expect(cleanPersonaName('  "Sam"\n<b>  ')).toBe('Sam b');
    expect(cleanPersonaName('x'.repeat(80))).toHaveLength(40);
  });

  it('autofill: options and type hints', () => {
    const req = buildAutofillRequest({ kind: 'custom', prompt: 'Classify the deal size', propertyName: 'Size', propertyType: 'select', options: ['Small', 'Large'], row: 'Title: Acme' });
    const task = (req.messages[0].content as any[]).at(-1).text as string;
    expect(task).toContain('Choose exactly one of these options: "Small", "Large".');
    expect(task).toContain('Instructions: Classify the deal size');
    expect(req.effort).toBe('low');
    const tr = buildAutofillRequest({ kind: 'translation', language: 'Japanese', propertyName: 'JA', propertyType: 'text', row: 'Title: Hello' });
    expect((tr.messages[0].content as any[]).at(-1).text).toContain('into Japanese');
  });

  it('ai block: output types', () => {
    const r = buildBlockRequest('page_summary', '', { ...ctx });
    expect((r.messages[0].content as any[]).at(-1).text).toBe('Instructions: Create a summary about this page.');
    const k = buildBlockRequest('key_points', 'max 3', null);
    expect((k.messages[0].content as any[]).length).toBe(1);
    expect((k.messages[0].content as any[])[0].text).toContain('Pull out key points from this page');
  });
});

describe('helpers', () => {
  it('autofillValue encodes property values', () => {
    expect(autofillValue('"Large"', 'select', ['Small', 'Large'])).toEqual({ text: 'Large', value: [['Large']] });
    expect(autofillValue('large deal', 'select', ['Small', 'Large']).text).toBe('Large');
    expect(autofillValue('b2b, Enterprise\n- b2b', 'multi_select', ['B2B', 'Enterprise'])).toEqual({ text: 'B2B, Enterprise', value: [['B2B,Enterprise']] });
    expect(autofillValue('Yes.', 'checkbox')).toEqual({ text: 'Yes', value: [['Yes']] });
    expect(autofillValue('About 1,200 units', 'number')).toEqual({ text: '1200', value: [['1200']] });
    expect(autofillValue('**Short** summary', 'text')).toEqual({ text: 'Short summary', value: [['Short summary']] });
    expect(autofillValue('', 'text')).toEqual({ text: '', value: [] });
  });

  it('extractSearchTerms drops stopwords and Korean particles', () => {
    expect(extractSearchTerms('What did we decide about the pricing page?')).toEqual(expect.arrayContaining(['decide', 'pricing', 'page']));
    expect(extractSearchTerms('What did we decide about the pricing page?')).not.toContain('what');
    const ko = extractSearchTerms('회의록에서 출시 일정을 알려줘');
    expect(ko).toEqual(expect.arrayContaining(['회의록', '출시', '일정']));
    expect(ko).not.toContain('알려줘');
  });

  it('resolveSkill maps menu labels', () => {
    expect(resolveSkill('Fix spelling & grammar')).toBe('proofread');
    expect(resolveSkill('Improve writing')).toBe('improve');
    expect(resolveSkill('summarize')).toBe('summarize');
    expect(resolveSkill('nope')).toBeNull();
  });

  it('validateToolInput', () => {
    expect(validateToolInput('search_workspace', { query: ' roadmap ' })).toEqual({ ok: true, value: { query: 'roadmap' } });
    expect(validateToolInput('read_page', { page_id: '' }).ok).toBe(false);
    expect(validateToolInput('read_page', { page_id: 'x', extra: 1 }).ok).toBe(false);
    expect(validateToolInput('search_workspace', 'oops').ok).toBe(false);
  });

  it('chatTitleFrom', () => {
    expect(chatTitleFrom('  Summarize\nthe page  ')).toBe('Summarize the page');
    expect(chatTitleFrom('x'.repeat(80)).endsWith('…')).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// streaming runner with a fake client

type Ev = Record<string, any>;

function fakeClient(turns: { events: Ev[]; final: Ev }[], seen: any[]): ClaudeLike {
  let i = 0;
  return {
    beta: {
      messages: {
        stream: ((params: any, opts: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const turn = turns[i++];
          const signal: AbortSignal | undefined = opts?.signal;
          return {
            async *[Symbol.asyncIterator]() {
              for (const e of turn.events) {
                if (signal?.aborted) {
                  const { APIUserAbortError } = await import('@anthropic-ai/sdk');
                  throw new APIUserAbortError();
                }
                await new Promise((r) => setTimeout(r, 1));
                yield e;
              }
            },
            finalMessage: async () => turn.final,
          };
        }) as any,
      },
    },
  };
}

const text = (t: string) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } });
const start = (block: Ev) => ({ type: 'content_block_start', index: 0, content_block: block });
const usage = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

describe('runStream', () => {
  it('streams text with adaptive thinking, effort, caching and the default fallback', async () => {
    const seen: any[] = [];
    const deltas: string[] = [];
    let thinking = 0;
    const client = fakeClient([{ events: [start({ type: 'thinking', thinking: '' }), start({ type: 'text', text: '' }), text('Hello'), text(' world')], final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Hello world' }], usage } }], seen);
    const req = buildWriterRequest({ skill: 'improve', selection: 'x' });
    const r = await runStream(req, { onText: (d) => deltas.push(d), onThinking: () => thinking++ }, { client });
    expect(r.text).toBe('Hello world');
    expect(deltas.join('')).toBe('Hello world');
    expect(thinking).toBe(1);
    expect(seen[0].model).toBe('claude-opus-5-5');
    expect(seen[0].thinking).toEqual({ type: 'adaptive' });
    expect(seen[0].output_config).toEqual({ effort: 'low' });
    expect(seen[0].fallbacks).toBe('default');
    expect(seen[0].betas).toEqual(['server-side-fallback-2026-07-01']);
    expect(seen[0].temperature).toBeUndefined();
    expect(seen[0].cache_control).toBeUndefined();
  });

  it('runs client tools and passes the assistant turn back unchanged', async () => {
    const seen: any[] = [];
    const assistantTurn = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tu1', name: 'search_workspace', input: { query: 'roadmap' } },
    ];
    const client = fakeClient([
      { events: [start({ type: 'thinking', thinking: '' }), start({ type: 'tool_use', id: 'tu1', name: 'search_workspace', input: {} })], final: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: assistantTurn, usage } },
      { events: [start({ type: 'text', text: '' }), text('Found it [1].')], final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Found it [1].' }], usage } },
    ], seen);
    const calls: any[] = [];
    const r = await runStream(buildChatRequest([{ role: 'user', text: 'Where is the roadmap?' }]), {}, {
      client,
      executeTool: async (name, input) => {
        calls.push([name, input]);
        return { content: '[1] Roadmap (page_id: r)' };
      },
    });
    expect(calls).toEqual([['search_workspace', { query: 'roadmap' }]]);
    expect(r.text).toBe('Found it [1].');
    expect(r.usage.input).toBe(20);
    expect(seen[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(seen[0].tool_choice).toEqual({ type: 'auto' });
    const second = seen[1].messages;
    expect(second.at(-2)).toEqual({ role: 'assistant', content: assistantTurn });
    expect(second.at(-1)).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '[1] Roadmap (page_id: r)' }] });
  });

  it('reports invalid tool input as an error result instead of running it', async () => {
    const seen: any[] = [];
    const client = fakeClient([
      { events: [], final: { model: 'm', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't', name: 'read_page', input: { page: 'x' } }], usage } },
      { events: [text('ok')], final: { model: 'm', stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }], usage } },
    ], seen);
    let ran = false;
    await runStream(buildChatRequest([{ role: 'user', text: 'q' }]), {}, { client, executeTool: async () => { ran = true; return { content: '' }; } });
    expect(ran).toBe(false);
    expect(seen[1].messages.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't', is_error: true });
  });

  it('discards output when the chain refuses', async () => {
    const client = fakeClient([{ events: [text('partial')], final: { model: 'm', stop_reason: 'refusal', content: [{ type: 'text', text: 'partial' }], usage } }], []);
    const r = await runStream(buildWriterRequest({ skill: 'custom', prompt: 'x' }), {}, { client });
    expect(r.refused).toBe(true);
    expect(r.text).toBe('');
  });

  it('stops on abort and keeps the partial text', async () => {
    const ac = new AbortController();
    const client = fakeClient([{ events: [text('one '), text('two '), text('three')], final: { model: 'm', stop_reason: 'end_turn', content: [], usage } }], []);
    const r = await runStream(buildWriterRequest({ skill: 'custom', prompt: 'x' }), { onText: (d) => { if (d === 'one ') ac.abort(); } }, { client, signal: ac.signal });
    expect(r.aborted).toBe(true);
    expect(r.text).toBe('one');
  });
});

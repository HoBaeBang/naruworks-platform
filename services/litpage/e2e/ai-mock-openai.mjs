// Mock OpenAI Responses API (POST /v1/responses).

// Each request is translated to the Anthropic Messages shape and answered by the same canned scenarios as
// e2e/ai-mock-anthropic.mjs (its exported plan()); answers stream back in the wire format the real endpoint uses:
// Keepalive and metadata events, reasoning items with encrypted content, function calls with call_id (arguments streamed),
// web_search_call items + url_citation annotations after the "([site](url))" link, response.completed with usage incl.
// cached tokens and an empty output list, then "data: [DONE]".
// Like the real endpoint it insists on: Bearer test-key, stream:true, store:false, non-empty instructions, known
// top-level parameters only, no item ids in input (store is false), every function_call_output answering an earlier
// function_call, valid function tool names, a known model (unknown → in-stream error event).
// Extra triggers: "[[refusal]]" → a refusal content part, "[[incomplete]]" → response.incomplete (max_output_tokens).
// GET /__requests returns the recorded request bodies; DELETE /__requests clears them (mock only).
// Usage: node e2e/ai-mock-openai.mjs [port]
import { createServer } from 'node:http';
import { plan } from './ai-mock-anthropic.mjs';

const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 3022);
const requests = [];
let seq = 0;

export const MOCK_MODELS = [
  { slug: 'gpt-mock-astra', display_name: 'GPT-Mock-Astra', description: 'Frontier intelligence for the most demanding work.', visibility: 'list', priority: 1, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }, { effort: 'xhigh' }], input_modalities: ['text', 'image'], context_window: 272000 },
  { slug: 'gpt-mock-sol', display_name: 'GPT-Mock-Sol', description: 'Latest workhorse model for coding and everyday work.', visibility: 'list', priority: 2, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }, { effort: 'high' }], input_modalities: ['text', 'image'], context_window: 500000 },
  { slug: 'gpt-mock-luna', display_name: 'GPT-Mock-Luna', description: 'Fast and affordable model for easier tasks.', visibility: 'list', priority: 3, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }], input_modalities: ['text', 'image'], context_window: 272000 },
  { slug: 'gpt-mock-classic', display_name: 'GPT-Mock-Classic', description: 'Older generation workhorse model.', visibility: 'list', priority: 4, supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }], input_modalities: ['text'], context_window: 128000 },
  { slug: 'gpt-mock-hidden', display_name: 'GPT-Mock-Hidden', description: 'Internal helper model.', visibility: 'hide', priority: 9, supported_reasoning_levels: [{ effort: 'medium' }], input_modalities: ['text'], context_window: 128000 },
];
const ALLOWED_PARAMS = new Set(['model', 'instructions', 'input', 'stream', 'store', 'reasoning', 'tools', 'tool_choice', 'parallel_tool_calls', 'include', 'prompt_cache_key', 'text', 'service_tier']);

function dataUrl(u) {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(String(u ?? ''));
  return m ? { media_type: m[1], data: m[2] } : null;
}

/** Responses request body → Anthropic Messages body (what plan() reads). */
function toAnthropic(body) {
  const messages = [];
  const push = (role, blocks) => {
    const last = messages[messages.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: [...blocks] });
  };
  for (const it of body.input ?? []) {
    if (it.type === 'message' && it.role === 'user') {
      const blocks = (it.content ?? []).map((c) => {
        if (c.type === 'input_text') return { type: 'text', text: c.text };
        if (c.type === 'input_image') {
          const d = dataUrl(c.image_url);
          return d ? { type: 'image', source: { type: 'base64', ...d } } : { type: 'image', source: { type: 'url', url: c.image_url } };
        }
        if (c.type === 'input_file') return { type: 'document', title: c.filename, source: { type: 'base64', ...(dataUrl(c.file_data) ?? { media_type: 'application/pdf', data: '' }) } };
        return null;
      }).filter(Boolean);
      // a user message after tool results starts a new user turn
      const last = messages[messages.length - 1];
      if (last?.role === 'user' && last.content.some((b) => b.type === 'tool_result')) messages.push({ role: 'user', content: blocks });
      else push('user', blocks);
    } else if (it.type === 'message' && it.role === 'assistant') {
      push('assistant', (it.content ?? []).filter((c) => c.type === 'output_text').map((c) => ({ type: 'text', text: c.text })));
    } else if (it.type === 'function_call') {
      let input = {};
      try { input = JSON.parse(it.arguments || '{}'); } catch { input = {}; }
      push('assistant', [{ type: 'tool_use', id: it.call_id, name: it.name, input }]);
    } else if (it.type === 'function_call_output') {
      push('user', [{ type: 'tool_result', tool_use_id: it.call_id, content: String(it.output ?? ''), is_error: /^Error:/.test(String(it.output ?? '')) }]);
    }
    // reasoning / web_search_call items carry no text the canned scenarios need
  }
  const tools = (body.tools ?? []).map((t) => (t.type === 'function' ? { name: t.name, description: t.description, input_schema: t.parameters }
    : t.type === 'web_search' ? { type: 'web_search_20250305', name: 'web_search' } : null)).filter(Boolean);
  return { model: body.model, system: [{ type: 'text', text: String(body.instructions ?? '') }], messages, tools, output_config: { effort: body.reasoning?.effort } };
}

/** What the real endpoint refuses (null when the request is acceptable). */
function invalid(body) {
  if (body.stream !== true) return 'Stream must be set to true';
  if (body.store !== false) return 'Store must be set to false';
  if (typeof body.instructions !== 'string' || !body.instructions.trim()) return 'Instructions are required';
  for (const k of Object.keys(body)) if (!ALLOWED_PARAMS.has(k)) return `Unsupported parameter: ${k}`;
  if (!Array.isArray(body.input)) return 'Input must be a list';
  const calls = new Set();
  for (const it of body.input) {
    if (it.id) return `Item with id '${it.id}' not found. Items are not persisted when \`store\` is set to false. Try again with \`store\` set to true, or remove this item from your input.`;
    if (it.type === 'function_call') calls.add(it.call_id);
    if (it.type === 'function_call_output' && !calls.has(it.call_id)) return `No tool call found for function call output with call_id ${it.call_id}.`;
    if (it.type === 'reasoning' && !it.encrypted_content) return 'Reasoning items need encrypted_content when store is false';
  }
  for (const t of body.tools ?? []) {
    if (t.type === 'function' && (!/^[A-Za-z0-9_-]{1,64}$/.test(t.name ?? '') || typeof t.parameters !== 'object')) return `Invalid function tool: ${t.name}`;
    if (t.type !== 'function' && t.type !== 'web_search') return `Unsupported tool type: ${t.type}`;
  }
  return null;
}

function chunks(text, n) {
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

const server = createServer(async (req, res) => {
  const url = req.url ?? '';
  if (url.startsWith('/__requests')) {
    if (req.method === 'DELETE') requests.length = 0;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ requests }));
    return;
  }
  const authed = req.headers.authorization === 'Bearer test-key';
  if (req.method === 'GET' && /\/models(\?|$)/.test(url)) {
    if (!authed) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error', code: 'invalid_api_key' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ models: MOCK_MODELS, object: 'list', data: [] }));
    return;
  }
  if (req.method !== 'POST' || !/\/responses$/.test(url.split('?')[0])) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Not Found' }));
    return;
  }
  let raw = '';
  for await (const c of req) raw += c;
  let body;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ detail: 'Invalid JSON' }));
    return;
  }
  const n = ++seq;
  requests.push({ n, path: url, body });
  if (requests.length > 200) requests.shift();
  if (process.env.MOCK_LOG) console.log('[mock-openai]', body.model, body.reasoning?.effort, (body.tools ?? []).length, 'tools');
  const rid = { 'x-request-id': `req_mock_${n}` };
  if (!authed) {
    res.writeHead(401, { 'content-type': 'application/json', ...rid });
    res.end(JSON.stringify({ error: { message: 'Invalid API key', type: 'authentication_error', code: 'invalid_api_key' } }));
    return;
  }
  const bad = invalid(body);
  if (bad) {
    res.writeHead(400, { 'content-type': 'application/json', ...rid });
    res.end(JSON.stringify({ detail: bad }));
    return;
  }
  const anth = toAnthropic(body);
  const q = (() => {
    for (let i = anth.messages.length - 1; i >= 0; i--) {
      const m = anth.messages[i];
      const texts = m.role === 'user' ? m.content.filter((b) => b.type === 'text') : [];
      if (texts.length) return texts[texts.length - 1].text;
    }
    return '';
  })();
  const p = /\[\[refusal\]\]/.test(q) ? { refusal: 'I can’t help with that.' } : /\[\[incomplete\]\]/.test(q) ? { text: 'This answer was cut', incomplete: true } : await plan(anth);
  if (p.error === 429) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0', 'x-request-id': 'req_mock_429' });
    res.end(JSON.stringify({ error: { type: 'rate_limit_exceeded', message: 'Rate limit reached for requests' } }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', ...rid });
  let closed = false;
  req.on('close', () => { closed = true; });
  res.on('close', () => { closed = true; });
  let sn = 0;
  const send = (data) => { if (!closed) res.write(`event: ${data.type}\ndata: ${JSON.stringify({ ...data, ...(data.type.startsWith('response.') ? { sequence_number: sn++ } : {}) })}\n\n`); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const model = body.model;
  const respId = `resp_mock_${n}`;
  send({ type: 'openai.keepalive' });
  send({ type: 'openai.rate_limits', plan_type: 'pro', rate_limits: { allowed: true, limit_reached: false } });
  send({ type: 'openai.response.metadata', headers: { 'x-openai-turn-state': 'mock' } });
  if (!MOCK_MODELS.some((m) => m.slug === model)) {
    send({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: `The '${model}' model is not supported by the configured endpoint.` } });
    res.end();
    return;
  }
  if (p.error === 400) {
    send({ type: 'error', status: 400, error: { type: 'invalid_request_error', message: p.message ?? 'Bad request' } });
    res.end();
    return;
  }
  const head = { id: respId, object: 'response', model, status: 'in_progress', output: [], store: false };
  send({ type: 'response.created', response: head });
  send({ type: 'response.in_progress', response: head });
  let oi = 0;
  // reasoning first (encrypted, replayed by the provider without its id)
  await wait(60);
  send({ type: 'response.output_item.added', output_index: oi, item: { id: `rs_${n}`, type: 'reasoning', summary: [] } });
  send({ type: 'response.output_item.done', output_index: oi, item: { id: `rs_${n}`, type: 'reasoning', summary: [], encrypted_content: `enc-mock-${n}` } });
  oi++;
  const message = async (parts, slow) => {
    const id = `msg_${n}_${oi}`;
    const i = oi++;
    let text = '';
    const annotations = [];
    send({ type: 'response.output_item.added', output_index: i, item: { id, type: 'message', status: 'in_progress', content: [], phase: 'final_answer', role: 'assistant' } });
    send({ type: 'response.content_part.added', output_index: i, content_index: 0, item_id: id, part: { type: 'output_text', annotations: [], logprobs: [], text: '' } });
    for (const part of parts) {
      if (typeof part === 'string') {
        for (const c of chunks(part, slow ? 16 : 14)) {
          if (closed) return false;
          send({ type: 'response.output_text.delta', output_index: i, content_index: 0, item_id: id, delta: c, logprobs: [] });
          text += c;
          await wait(slow ? 45 : 12);
        }
      } else {
        // a citation: the link is streamed as one delta, its annotation right after (as the real endpoint does)
        const link = `([${part.site}](${part.url}))`;
        const start = [...text].length;
        send({ type: 'response.output_text.delta', output_index: i, content_index: 0, item_id: id, delta: link, logprobs: [] });
        text += link;
        const annotation = { type: 'url_citation', start_index: start, end_index: start + [...link].length, url: part.url, title: part.title };
        annotations.push(annotation);
        send({ type: 'response.output_text.annotation.added', output_index: i, content_index: 0, item_id: id, annotation_index: annotations.length - 1, annotation });
      }
    }
    send({ type: 'response.output_text.done', output_index: i, content_index: 0, item_id: id, text, logprobs: [] });
    send({ type: 'response.content_part.done', output_index: i, content_index: 0, item_id: id, part: { type: 'output_text', annotations, text } });
    send({ type: 'response.output_item.done', output_index: i, item: { id, type: 'message', status: 'completed', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', annotations, text }] } });
    return true;
  };
  const usage = { input_tokens: 420, input_tokens_details: { cached_tokens: 128, cache_write_tokens: 0 }, output_tokens: 64, output_tokens_details: { reasoning_tokens: 8 } };
  const finish = (type = 'response.completed', extra = {}) => {
    send({ type: 'response.metadata', response_id: respId, metadata: {} });
    send({ type: 'responsesapi.websocket_timing', timing_metrics: {} });
    send({ type, response: { ...head, status: type === 'response.completed' ? 'completed' : 'incomplete', output: [], usage, ...extra } });
    if (!closed) res.write('data: [DONE]\n\n');
    res.end();
  };

  if (p.tool) {
    const id = `fc_${n}_${oi}`;
    const callId = `call_${n}_${Math.random().toString(36).slice(2, 8)}`;
    const args = JSON.stringify(p.tool.input ?? {});
    send({ type: 'response.output_item.added', output_index: oi, item: { id, type: 'function_call', call_id: callId, name: p.tool.name, arguments: '', status: 'in_progress' } });
    for (const c of chunks(args, 9)) {
      send({ type: 'response.function_call_arguments.delta', output_index: oi, item_id: id, delta: c });
      await wait(4);
    }
    send({ type: 'response.function_call_arguments.done', output_index: oi, item_id: id, arguments: args });
    send({ type: 'response.output_item.done', output_index: oi, item: { id, type: 'function_call', call_id: callId, name: p.tool.name, arguments: args, status: 'completed' } });
    oi++;
    finish();
    return;
  }
  if (p.refusal) {
    const id = `msg_${n}_${oi}`;
    send({ type: 'response.output_item.added', output_index: oi, item: { id, type: 'message', status: 'in_progress', content: [], role: 'assistant' } });
    send({ type: 'response.content_part.added', output_index: oi, content_index: 0, item_id: id, part: { type: 'refusal', refusal: '' } });
    send({ type: 'response.refusal.delta', output_index: oi, content_index: 0, item_id: id, delta: p.refusal });
    send({ type: 'response.refusal.done', output_index: oi, content_index: 0, item_id: id, refusal: p.refusal });
    send({ type: 'response.output_item.done', output_index: oi, item: { id, type: 'message', status: 'completed', role: 'assistant', content: [{ type: 'refusal', refusal: p.refusal }] } });
    finish();
    return;
  }
  if (p.web) {
    const id = `ws_${n}_${oi}`;
    const i = oi++;
    send({ type: 'response.output_item.added', output_index: i, item: { id, type: 'web_search_call', status: 'in_progress' } });
    send({ type: 'response.web_search_call.in_progress', output_index: i, item_id: id });
    send({ type: 'response.web_search_call.searching', output_index: i, item_id: id });
    await wait(80);
    send({ type: 'response.web_search_call.completed', output_index: i, item_id: id });
    send({ type: 'response.output_item.done', output_index: i, item: { id, type: 'web_search_call', status: 'completed', action: { type: 'search', query: p.web.query, queries: [p.web.query], sources: [{ type: 'url', url: p.web.url }, { type: 'url', url: 'https://example.org/background' }] } } });
    if (!(await message([`According to recent coverage, ${p.web.text} `, { site: new URL(p.web.url).hostname, url: `${p.web.url}?utm_source=openai`, title: p.web.title }]))) return;
    finish();
    return;
  }
  if (!(await message([p.text ?? ''], p.slow))) return;
  if (p.incomplete) finish('response.incomplete', { incomplete_details: { reason: 'max_output_tokens' } });
  else finish();
});

server.listen(port, '127.0.0.1', () => console.log(`[mock-openai] listening on http://127.0.0.1:${port}`));

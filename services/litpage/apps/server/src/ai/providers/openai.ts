// OpenAI Responses provider (POST {OPENAI_BASE_URL}/responses, SSE). It implements the ClaudeLike surface runStream uses.
// client.beta.messages.stream(params, { signal }) → async iterable of Anthropic stream events + finalMessage —
// by translating the request and the events (responses.ts). web_fetch runs here through safefetch.ts (webFetch.ts):
// when the model only asked to open pages, the pages are read and the conversation continues within the same
// stream; when it also called client tools, the read pages travel with the turn runStream sends back.
// The key is only ever sent in the Authorization header; error texts and logs are scrubbed.
import type { ClaudeLike } from './anthropic.ts';
import { scrub, type OpenAIConfig } from './config.ts';
import { abortError, AiError, ProviderError } from './errors.ts';
import { buildResponsesRequest, ResponsesTranslator, type PendingFetch, type ResponsesRequest } from './responses.ts';
import { readSse } from './sse.ts';
import { fetchWebPage, type WebFetcher } from './webFetch.ts';

type Json = Record<string, any>;

export interface OpenAIDeps {
  /** test seam (default: global fetch) */
  fetch?: typeof fetch;
  /** test seam (default: safefetch-based reader) */
  webFetch?: WebFetcher;
  /** model traits from the cached /models list */
  modelTraits?: (model: string) => { images?: boolean; efforts?: string[] } | undefined;
  /** delays before each retry of a failed request (ms) */
  retryDelays?: number[];
  /** abort when the stream is silent this long (ms) */
  idleMs?: number;
}

const DEFAULT_RETRIES = [700, 2_000];
const MAX_FETCH_ROUNDS = 8;
const IGNORED = /^(openai\.|responsesapi\.|response\.metadata$|keepalive)/;

let warned = new Set<string>();

function warnOnce(what: string) {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(`[ai] openai: ${what}`);
}

/** Reset one-time warnings (tests). */
export function resetOpenAIWarnings() {
  warned = new Set();
}

function requestIdOf(h: Headers | undefined): string | undefined {
  if (!h) return undefined;
  for (const k of ['x-request-id', 'request-id', 'x-oai-request-id', 'openai-request-id', 'cf-ray']) {
    const v = h.get(k);
    if (v) return v.slice(0, 120);
  }
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(abortError());
    }, { once: true });
  });
}

/** Provider error payload ({ error: { type, code, message } } / { detail }) → ProviderError with a neutral message. */
export function openaiError(status: number | undefined, payload: unknown, meta: { requestId?: string; model?: string } = {}): ProviderError {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Json;
  const e = (p.error && typeof p.error === 'object' ? p.error : p) as Json;
  const type = String(e.type ?? e.code ?? p.code ?? '');
  const code = String(e.code ?? '');
  const raw = typeof e.message === 'string' ? e.message : typeof p.detail === 'string' ? p.detail : typeof p.message === 'string' ? p.message : typeof payload === 'string' ? payload : '';
  const detail = scrub(raw).replace(/\s+/g, ' ').trim().slice(0, 300);
  const st = status ?? (Number(p.status) || undefined);
  const extra = { httpStatus: st, requestId: meta.requestId, detail };
  const model = meta.model ? `"${meta.model}"` : 'configured';
  if (st === 401 || /authentication|invalid_api_key|unauthorized/i.test(type)) {
    return new ProviderError('invalid_key', 'The AI provider rejected the API key. Check OPENAI_API_KEY on the server and restart it.', 400, extra);
  }
  if (st === 403 || /permission/i.test(type)) return new ProviderError('permission', 'This API key isn’t allowed to use the configured model.', 403, extra);
  if (/usage_limit/i.test(`${type} ${code}`)) return new ProviderError('rate_limited', 'The AI provider’s usage limit was reached. Try again later.', 429, extra);
  if (st === 429 || /rate_limit/i.test(`${type} ${code}`)) return new ProviderError('rate_limited', 'Litpage AI is receiving too many requests. Try again in a moment.', 429, extra);
  if (st === 404 || /model/i.test(detail) && /not (supported|found|available)|does not exist|unknown model|unsupported model/i.test(detail)) {
    return new ProviderError('not_found', `The model ${model} isn’t available from the AI provider.`, 400, extra);
  }
  if (/context_length|context window|too long|maximum context/i.test(`${code} ${detail}`)) {
    return new ProviderError('bad_request', 'This conversation is too long for the model. Start a new chat or attach less content.', 400, extra);
  }
  if (st === 400 || st === 413 || st === 422 || /invalid_request/i.test(type)) {
    return new ProviderError('bad_request', `Litpage AI couldn’t process this request. ${detail}`.trim(), 400, extra);
  }
  if ((st && st >= 500) || /server_error|overloaded|unavailable/i.test(`${type} ${code}`)) {
    return new ProviderError('overloaded', 'Litpage AI is temporarily unavailable. Try again in a moment.', 503, extra);
  }
  return new ProviderError('unknown', 'Something went wrong with Litpage AI. Try again.', 502, extra);
}

const retryable = (e: ProviderError) => e.retryAfterMs !== Infinity && (e.code === 'overloaded' || e.code === 'network' || (e.code === 'rate_limited' && !/usage limit/.test(e.message)));

class OpenAIMessageStream {
  private cfg: OpenAIConfig;
  private params: Json;
  private signal?: AbortSignal;
  private deps: OpenAIDeps;
  private gen: AsyncGenerator<Json> | null = null;
  private final: Json | null = null;
  private failure: unknown = null;

  constructor(cfg: OpenAIConfig, params: Json, signal: AbortSignal | undefined, deps: OpenAIDeps) {
    this.cfg = cfg;
    this.params = params;
    this.signal = signal;
    this.deps = deps;
  }

  [Symbol.asyncIterator](): AsyncGenerator<Json> {
    if (!this.gen) this.gen = this.run();
    return this.gen;
  }

  async finalMessage(): Promise<Json> {
    if (!this.final && !this.failure) {
      const it = this[Symbol.asyncIterator]();
      try {
        while (!(await it.next()).done) { /* drain */ }
      } catch (e) {
        this.failure ??= e;
      }
    }
    if (this.failure) throw this.failure;
    return this.final!;
  }

  private async *run(): AsyncGenerator<Json> {
    try {
      const model = String(this.params.model ?? '');
      const traits = this.deps.modelTraits?.(model);
      const req = buildResponsesRequest(this.params, { model, images: traits?.images, efforts: traits?.efforts });
      if (Array.isArray(this.params.mcp_servers) && this.params.mcp_servers.length) warnOnce('MCP connector servers are not supported; MCP tools must run as client tools');
      const tr = new ResponsesTranslator(req.names, { citations: !!req.webSearch, webFetch: !!req.webFetch, knownUrls: req.knownUrls });
      let input = req.body.input as Json[];
      let fetches = 0;
      for (let round = 0; ; round++) {
        yield* this.respond({ ...req.body, input }, tr, model);
        const pending = tr.takeFetches();
        for (const call of pending) {
          const result = fetches++ < (req.webFetch?.maxUses ?? 0) ? await this.readPage(call, req) : { url: urlOf(call), error: 'max_uses_exceeded' };
          if (this.signal?.aborted) throw abortError();
          yield* tr.fetchResult(call, result);
        }
        if (!pending.length || tr.hasToolUse() || round + 1 >= MAX_FETCH_ROUNDS) break;
        input = [...input, ...tr.roundInput()];
      }
      const fin = tr.finalMessage();
      yield { type: 'message_delta', delta: { stop_reason: fin.stop_reason, stop_sequence: null }, usage: { output_tokens: fin.usage.output_tokens } };
      yield { type: 'message_stop' };
      this.final = fin;
    } catch (e) {
      this.failure = this.signal?.aborted && !(e instanceof AiError && e.code === 'aborted') ? abortError() : e;
      throw this.failure;
    }
  }

  private async readPage(call: PendingFetch, req: ResponsesRequest) {
    const url = urlOf(call);
    const reader = this.deps.webFetch ?? fetchWebPage;
    return reader({ url, allowedDomains: req.webFetch?.allowedDomains, blockedDomains: req.webFetch?.blockedDomains, knownUrls: req.knownUrls, maxChars: req.webFetch?.maxChars ?? 80_000 }, this.signal);
  }

  /** One API response (with retries while nothing has been emitted), streamed as Anthropic events. */
  private async *respond(body: Json, tr: ResponsesTranslator, model: string): AsyncGenerator<Json> {
    const delays = this.deps.retryDelays ?? DEFAULT_RETRIES;
    for (let attempt = 0; ; attempt++) {
      tr.beginResponse();
      try {
        yield* this.attempt(body, tr, model);
        return;
      } catch (e) {
        if (this.signal?.aborted) throw abortError();
        const canRetry = e instanceof ProviderError && retryable(e) && !tr.emittedThisRound && attempt < delays.length;
        if (!canRetry) throw e;
        tr.resetResponse();
        await sleep(e.retryAfterMs ?? delays[attempt], this.signal);
      }
    }
  }

  private async *attempt(body: Json, tr: ResponsesTranslator, model: string): AsyncGenerator<Json> {
    const ac = new AbortController();
    const onAbort = () => ac.abort();
    this.signal?.addEventListener('abort', onAbort, { once: true });
    const idleMs = this.deps.idleMs ?? (Number(process.env.NC_AI_IDLE_TIMEOUT_MS) || 180_000);
    let idle = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        idle = true;
        ac.abort();
      }, idleMs);
    };
    let requestId: string | undefined;
    try {
      arm();
      let res: Response;
      try {
        res = await (this.deps.fetch ?? fetch)(`${this.cfg.baseUrl}/responses`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.cfg.apiKey}`, 'content-type': 'application/json', accept: 'text/event-stream' },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
      } catch (e) {
        if (this.signal?.aborted) throw abortError();
        if (idle) throw new ProviderError('overloaded', 'Litpage AI took too long to respond. Try again.', 504, { detail: 'idle timeout' });
        throw new ProviderError('network', 'Couldn’t reach the AI provider. Check the server’s network connection.', 502, { detail: scrub(String((e as Error)?.cause ?? (e as Error)?.message ?? e)).slice(0, 200) });
      }
      requestId = requestIdOf(res.headers);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        let payload: unknown = text;
        try {
          payload = JSON.parse(text);
        } catch {
          /* plain text */
        }
        const err = openaiError(res.status, payload, { requestId, model });
        const ra = Number(res.headers.get('retry-after'));
        if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra <= 4 ? ra * 1000 : Infinity;
        throw err;
      }
      if (!res.body) throw new ProviderError('unknown', 'Something went wrong with Litpage AI. Try again.', 502, { requestId, detail: 'empty response body' });
      let ended = false;
      for await (const ev of readSse(timed(res.body as unknown as AsyncIterable<Uint8Array>, arm))) {
        if (!ev.data || ev.data === '[DONE]') continue;
        let data: Json;
        try {
          data = JSON.parse(ev.data);
        } catch {
          continue;
        }
        const type = String(data.type ?? ev.event ?? '');
        if (!type || IGNORED.test(type)) continue;
        if (type === 'error') throw openaiError(Number(data.status) || undefined, data, { requestId: requestId ?? tr.id, model });
        if (type === 'response.failed') throw openaiError(undefined, data.response?.error ?? data.response ?? data, { requestId: requestId ?? data.response?.id, model });
        for (const out of tr.handle(type, data)) yield out;
        if (type === 'response.completed' || type === 'response.incomplete' || type === 'response.cancelled') ended = true;
      }
      if (!ended) {
        if (this.signal?.aborted) throw abortError();
        if (idle) throw new ProviderError('overloaded', 'Litpage AI took too long to respond. Try again.', 504, { requestId, detail: 'idle timeout' });
        throw new ProviderError('overloaded', 'The AI provider closed the connection early. Try again.', 502, { requestId, detail: 'stream ended before response.completed' });
      }
    } catch (e) {
      if (this.signal?.aborted) throw abortError();
      if (idle && !(e instanceof ProviderError)) throw new ProviderError('overloaded', 'Litpage AI took too long to respond. Try again.', 504, { requestId, detail: 'idle timeout' });
      if (e instanceof AiError) throw e;
      throw new ProviderError('network', 'Couldn’t reach the AI provider. Check the server’s network connection.', 502, { requestId, detail: scrub(String((e as Error)?.message ?? e)).slice(0, 200) });
    } finally {
      clearTimeout(timer);
      this.signal?.removeEventListener('abort', onAbort);
    }
  }
}

async function* timed(body: AsyncIterable<Uint8Array>, onChunk: () => void): AsyncGenerator<Uint8Array> {
  for await (const chunk of body) {
    onChunk();
    yield chunk;
  }
}

function urlOf(call: PendingFetch): string {
  try {
    const v = JSON.parse(call.arguments || '{}');
    return typeof v?.url === 'string' ? v.url : '';
  } catch {
    return '';
  }
}

/** A ClaudeLike client for an OpenAI Responses endpoint. */
export function openaiClient(cfg: OpenAIConfig, deps: OpenAIDeps = {}): ClaudeLike {
  const stream = (params: Json, opts?: { signal?: AbortSignal }) => new OpenAIMessageStream(cfg, params, opts?.signal, deps);
  return { beta: { messages: { stream: stream as unknown as ClaudeLike['beta']['messages']['stream'] } } };
}

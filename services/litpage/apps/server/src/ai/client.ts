// Model access for AI: provider selection (providers/config.ts — openai's OpenAI Responses API or the
// Anthropic Claude API; keys read per request, never logged), error mapping to user-facing messages, and a streaming
// runner with a client-side tool loop. The runner speaks the Anthropic Messages streaming surface (ClaudeLike); the
// openai provider adapts to it (providers/openai.ts), so every caller works unchanged on either provider.
import type {
  BetaContentBlockParam, BetaMessage, BetaMessageParam, BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { validateToolInput, type ModelRequest } from './prompts.ts';
import { AiError, ProviderError, type AiErrorCode } from './providers/errors.ts';
import { anthropicKey, openaiConfig, providerConfigured, providerId, scrub } from './providers/config.ts';
import {
  anthropicClient, anthropicErrorMeta, APIUserAbortError, BadRequestError, cleanApiMessage, mapAnthropicError, type ClaudeLike,
} from './providers/anthropic.ts';
import { openaiClient } from './providers/openai.ts';
import { DEFAULT_MODEL, modelConfigurationError, modelInfo, requestModel } from './models.ts';

export { AiError, ProviderError, scrub, type AiErrorCode, type ClaudeLike };

export const NO_KEY_MESSAGE = 'Connect an AI provider to use Litpage AI';

/** Server-side refusal fallback ("default" routes by refusal category). Anthropic only. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
let fallbacksSupported = true;

/** A model provider is configured (openai or Anthropic — see providers/config.ts). */
export function aiConfigured(): boolean {
  return providerConfigured();
}

export function requireConfigured() {
  if (!aiConfigured()) throw new AiError('no_key', NO_KEY_MESSAGE, 400);
}

let openaiCached: { key: string; client: ClaudeLike } | null = null;

/** The active provider's client (Anthropic SDK, or the openai adapter with the same surface). */
export function getClient(): ClaudeLike {
  const p = providerId();
  if (p === 'openai') {
    const modelError = modelConfigurationError();
    if (modelError) throw new AiError('bad_request', modelError, 400);
    const cfg = openaiConfig();
    if (cfg) {
      const key = `${cfg.baseUrl}\n${cfg.apiKey}`;
      if (!openaiCached || openaiCached.key !== key) {
        openaiCached = { key, client: openaiClient(cfg, { modelTraits: (id) => { const m = modelInfo(id); return m ? { images: m.images, efforts: m.efforts } : undefined; } }) };
      }
      return openaiCached.client;
    }
  } else if (p === 'anthropic') {
    const key = anthropicKey();
    if (key) return anthropicClient(key);
  }
  throw new AiError('no_key', NO_KEY_MESSAGE, 400);
}

export function mapError(e: unknown): AiError {
  if (e instanceof AiError) return e;
  const sdk = mapAnthropicError(e, DEFAULT_MODEL);
  if (sdk) return sdk;
  if ((e as any)?.name === 'AbortError') return new AiError('aborted', 'Stopped.', 499);
  return new AiError('unknown', 'Something went wrong with Litpage AI. Try again.', 500);
}

export function logAiError(where: string, e: unknown) {
  const err = mapError(e);
  if (err.code === 'aborted') return;
  const meta = e instanceof ProviderError ? { status: e.httpStatus, requestId: e.requestId, sdk: false } : anthropicErrorMeta(e);
  const detail = e instanceof ProviderError ? (e.detail ?? '') : e instanceof Error && !meta.sdk && !(e instanceof AiError) ? scrub(e.message).slice(0, 300) : '';
  console.error(`[ai] ${where} failed: ${err.code}${meta.status ? ` status=${meta.status}` : ''}${meta.requestId ? ` request_id=${meta.requestId}` : ''}${detail ? ` ${scrub(detail)}` : ''}`);
}

// ---------------------------------------------------------------------------------------------

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** A citation the API attached to generated text (web search / web fetch results). */
export interface WebCitation {
  url: string;
  title: string;
}

export interface StreamCallbacks {
  /** a thinking block started (Opus 5.5 always thinks; display is omitted so it has no text) */
  onThinking?: () => void;
  onText?: (delta: string) => void;
  /** a client tool call is about to run */
  onTool?: (name: string, input: Record<string, unknown>) => void;
  /** a server tool (web_search / web_fetch) was called; `input` is its parsed input */
  onServerTool?: (e: { id: string; name: string; input: Record<string, unknown> }) => void;
  /** a server tool result arrived (search results / fetched page, or an error code) */
  onServerResult?: (e: { toolUseId: string; type: string; results: WebCitation[]; error?: string }) => void;
  /** an MCP connector tool call / result (Claude API MCP connector) */
  onMcpTool?: (e: { id: string; name: string; server: string; input: unknown }) => void;
  onMcpResult?: (e: { toolUseId: string; isError: boolean; text: string }) => void;
  /** number a web citation; the runner appends " [n]" after the cited text block */
  cite?: (c: WebCitation) => number;
}

export type ToolExecutor = (name: string, input: Record<string, unknown>, id: string) => Promise<{ content: string; isError?: boolean }>;

export interface RunOptions {
  signal?: AbortSignal;
  client?: ClaudeLike;
  executeTool?: ToolExecutor;
  maxToolRounds?: number;
}

export interface RunResult {
  text: string;
  stopReason: string | null;
  /** the request (or the whole fallback chain) was declined by safety classifiers */
  refused: boolean;
  aborted: boolean;
  usage: Usage;
  model: string;
}

function addUsage(u: Usage, m: BetaMessage | undefined) {
  if (!m?.usage) return;
  u.input += m.usage.input_tokens ?? 0;
  u.output += m.usage.output_tokens ?? 0;
  u.cacheRead += m.usage.cache_read_input_tokens ?? 0;
  u.cacheWrite += m.usage.cache_creation_input_tokens ?? 0;
}

interface OpenBlock {
  type: string;
  id?: string;
  name?: string;
  server?: string;
  json: string;
  citations: WebCitation[];
}

function parseJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s || '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function webResults(block: any): { results: WebCitation[]; error?: string } {
  const c = block?.content;
  if (Array.isArray(c)) return { results: c.filter((r: any) => r?.url).map((r: any) => ({ url: String(r.url), title: String(r.title ?? r.url) })) };
  if (c?.type === 'web_fetch_result') return { results: [{ url: String(c.url), title: String(c.content?.title ?? c.url) }] };
  if (c?.error_code) return { results: [], error: String(c.error_code) };
  return { results: [] };
}

/**
 * Stream one model turn (with a client tool loop when `req.tools` is set and an executor is given).
 * Text deltas are forwarded as they arrive; the final concatenated text is returned. Aborting the
 * signal stops generation and returns what was produced so far (`aborted: true`). Server tools (web search /
 * fetch) run on the provider side (openai: hosted web search + a provider-run page reader): their calls are reported
 * through callbacks and a `pause_turn` (server loop limit) is resumed automatically. Requests without an explicit
 * model follow Auto (models.ts requestModel: the default model, or the fast model for quick one-shot tasks).
 */
export async function runStream(req: ModelRequest, cb: StreamCallbacks = {}, opts: RunOptions = {}): Promise<RunResult> {
  const client = opts.client ?? getClient();
  const messages: BetaMessageParam[] = [...req.messages];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const maxRounds = opts.maxToolRounds ?? 6;
  const reqModel = requestModel(req);
  const useFallback = fallbacksSupported && (req.fallback ?? true);
  let text = '';
  let model = reqModel;
  let continuations = 0;
  for (let round = 0; ; round++) {
    const clientTools = req.tools && opts.executeTool ? req.tools : undefined;
    const allTools = [...(clientTools ?? []), ...(req.serverTools ?? [])];
    const betas = [...(useFallback ? [FALLBACK_BETA] : []), ...(req.betas ?? [])];
    const params = {
      model: reqModel,
      max_tokens: req.maxTokens,
      system: req.system,
      messages,
      ...(allTools.length ? { tools: allTools, tool_choice: { type: 'auto' as const } } : {}),
      ...(req.mcpServers?.length ? { mcp_servers: req.mcpServers } : {}),
      thinking: { type: 'adaptive' as const },
      output_config: { effort: req.effort },
      ...(req.autoCache ? { cache_control: { type: 'ephemeral' as const } } : {}),
      ...(betas.length ? { betas } : {}),
      ...(useFallback ? { fallbacks: 'default' as const } : {}),
    };
    let final: BetaMessage | undefined;
    let roundText = '';
    let needSep = !!text;
    const open = new Map<number, OpenBlock>();
    const emit = (s: string) => {
      roundText += s;
      cb.onText?.(s);
    };
    try {
      const stream = client.beta.messages.stream(params as any, { signal: opts.signal });
      for await (const ev of stream as AsyncIterable<any>) {
        if (ev.type === 'content_block_start') {
          const b = ev.content_block;
          const t = b.type;
          if (t === 'thinking' || t === 'redacted_thinking') cb.onThinking?.();
          else if (t === 'text') {
            const prev = text + roundText;
            // separate text produced before and after a tool call; consecutive text blocks (the API splits cited
            // passages into their own blocks) continue the same paragraph
            if (needSep && prev && !prev.endsWith('\n\n')) emit(prev.endsWith('\n') ? '\n' : '\n\n');
            needSep = false;
            open.set(ev.index, { type: 'text', json: '', citations: [] });
          } else if (t !== 'thinking' && t !== 'redacted_thinking') {
            needSep = true;
          }
          if (t === 'server_tool_use') {
            open.set(ev.index, { type: t, id: b.id, name: b.name, json: '', citations: [] });
          } else if (t === 'mcp_tool_use') {
            open.set(ev.index, { type: t, id: b.id, name: b.name, server: b.server_name, json: '', citations: [] });
            if (b.input && Object.keys(b.input).length) cb.onMcpTool?.({ id: b.id, name: b.name, server: b.server_name, input: b.input });
          } else if (t === 'web_search_tool_result' || t === 'web_fetch_tool_result') {
            const r = webResults(b);
            cb.onServerResult?.({ toolUseId: b.tool_use_id, type: t, ...r });
          } else if (t === 'mcp_tool_result') {
            const content = Array.isArray(b.content) ? b.content.map((x: any) => x?.text ?? '').join('\n') : String(b.content ?? '');
            cb.onMcpResult?.({ toolUseId: b.tool_use_id, isError: !!b.is_error, text: content });
          }
        } else if (ev.type === 'content_block_delta') {
          const d = ev.delta;
          if (d.type === 'text_delta') emit(d.text);
          else if (d.type === 'input_json_delta') {
            const o = open.get(ev.index);
            if (o) o.json += d.partial_json ?? '';
          } else if (d.type === 'citations_delta') {
            const o = open.get(ev.index);
            const c = d.citation;
            if (o && c?.url) o.citations.push({ url: String(c.url), title: String(c.title ?? c.url) });
          }
        } else if (ev.type === 'content_block_stop') {
          const o = open.get(ev.index);
          open.delete(ev.index);
          if (!o) continue;
          if (o.type === 'server_tool_use') cb.onServerTool?.({ id: o.id!, name: o.name!, input: parseJson(o.json) });
          else if (o.type === 'mcp_tool_use' && o.json) cb.onMcpTool?.({ id: o.id!, name: o.name!, server: o.server!, input: parseJson(o.json) });
          else if (o.type === 'text' && o.citations.length && cb.cite) {
            const ns = [...new Set(o.citations.map((c) => cb.cite!(c)))];
            emit(ns.map((n) => `[${n}]`).join(''));
          }
        }
      }
      final = await stream.finalMessage();
    } catch (e) {
      if (e instanceof APIUserAbortError || opts.signal?.aborted) {
        return { text: (text + roundText).trim(), stopReason: 'aborted', refused: false, aborted: true, usage, model };
      }
      if (fallbacksSupported && e instanceof BadRequestError && /fallback|anthropic-beta/i.test(cleanApiMessage(e)) && !/mcp/i.test(cleanApiMessage(e))) {
        // an endpoint/proxy without server-side fallback support: retry this round without it
        fallbacksSupported = false;
        console.warn('[ai] server-side fallbacks unavailable; continuing without them');
        if (!roundText) {
          round--;
          continue;
        }
      }
      throw e;
    }
    addUsage(usage, final);
    model = final.model || model;
    if (final.stop_reason === 'refusal') {
      // a mid-stream decline keeps partial output in `content`; discard it rather than treat it as an answer
      return { text: '', stopReason: 'refusal', refused: true, aborted: false, usage, model };
    }
    text += roundText;
    if (final.stop_reason === 'pause_turn' && continuations < 5) {
      // the API's server-tool loop hit its limit: send the turn back unchanged and let it resume
      continuations++;
      messages.push({ role: 'assistant', content: final.content as unknown as BetaContentBlockParam[] });
      round--;
      continue;
    }
    const toolUses = final.content.filter((b): b is Extract<BetaMessage['content'][number], { type: 'tool_use' }> => b.type === 'tool_use');
    if ((final.stop_reason === 'tool_use' || final.stop_reason === 'max_tokens') && toolUses.length && clientTools && opts.executeTool && round < maxRounds) {
      const results: BetaToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        if (final.stop_reason === 'max_tokens') {
          // eager input streaming: an input cut off at the output limit can parse as a valid partial object
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Your tool input was cut off at the output limit. Split the work into smaller calls.', is_error: true });
          continue;
        }
        const v = validateToolInput(tu.name, tu.input);
        if (!v.ok) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Invalid input: ${v.error}`, is_error: true });
          continue;
        }
        cb.onTool?.(tu.name, v.value);
        try {
          const r = await opts.executeTool(tu.name, v.value, tu.id);
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: r.content, ...(r.isError ? { is_error: true } : {}) });
        } catch (err) {
          results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Tool failed: ${scrub(String((err as Error)?.message ?? err)).slice(0, 200)}`, is_error: true });
        }
        if (opts.signal?.aborted) return { text: text.trim(), stopReason: 'aborted', refused: false, aborted: true, usage, model };
      }
      // pass the assistant turn back unchanged (thinking blocks included) within this request loop
      messages.push({ role: 'assistant', content: final.content as unknown as BetaContentBlockParam[] });
      messages.push({ role: 'user', content: results });
      continue;
    }
    return { text: text.trim(), stopReason: final.stop_reason, refused: false, aborted: false, usage, model };
  }
}

export function describeUsage(u: Usage): string {
  return `in=${u.input} out=${u.output} cache_read=${u.cacheRead} cache_write=${u.cacheWrite}`;
}

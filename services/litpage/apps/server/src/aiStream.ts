// AI streaming endpoint: POST /api/ai/stream (Server-Sent Events), and MCP server endpoint
// POST /api/mcp (JSON-RPC, see ai/litMcp.ts).
// Body: { kind: 'chat' | 'writer' | 'block', ...params }. Validation errors (including the missing
// API key: 400 "Connect an AI provider to use Litpage AI") are plain JSON responses before
// the stream opens. Stream events:
//   meta    { threadId?, userMessageId?, title?, truncated[], turnId? }
//   status  { phase: 'thinking'|'searching'|'reading'|'writing', detail? }
//   sources { sources: [{ n, pageId, title, url? }] }
//   step    { id, tool, status: 'running'|'waiting'|'done'|'error'|'declined', label, detail?, refs?, approval?, mcp? }
//   changes { turnId, pages: [{ pageId, title, action }] }
//   delta   { text }
//   done    { status: 'complete'|'stopped'|'error'|'refused', text, message?, error?, title? }
// Closing the connection (client "Stop") aborts generation (pending approvals are declined); partial chat
// answers are kept as "stopped".
import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { parseCookies, userForToken } from './auth.ts';
import { aiConfigured, mapError, NO_KEY_MESSAGE } from './ai/client.ts';
import {
  executeChatTurn, executeSimple, parseChatParams, prepareAiBlock, prepareChatTurn, prepareWriter, type TurnEvents,
} from './ai/service.ts';
import { handleMcpHttp } from './ai/litMcp.ts';
import { executeAgentChat, prepareAgentChat } from './agents/runs.ts';
import { installAutofillHook } from './ai/autofillAuto.ts';
import { messageJson } from './api/modules/ai.ts';
import { AI_RATE_MESSAGE, aiAllowed } from './ratelimit.ts';
import { DEMO_MESSAGE, isDemoMode } from './demo.ts';

export function registerAiRoutes(app: Hono) {
  installAutofillHook();

  app.post('/api/ai/stream', async (c) => {
    if (isDemoMode()) return c.json({ name: 'PermissionError', message: DEMO_MESSAGE }, 403);
    const userId = userForToken(parseCookies(c.req.header('cookie')).lit_session);
    if (!userId) return c.json({ name: 'UnauthorizedError', message: 'Unauthorized' }, 401);
    if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ name: 'ValidationError', message: 'Expected application/json' }, 415);
    if (Number(c.req.header('content-length') ?? 0) > 2 * 1024 * 1024) return c.json({ name: 'ValidationError', message: 'Request is too large' }, 413);
    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ name: 'ValidationError', message: 'Invalid JSON' }, 400);
    }
    if (!aiConfigured()) return c.json({ name: 'AiNotConfigured', code: 'no_key', message: NO_KEY_MESSAGE }, 400);
    if (!aiAllowed(userId)) return c.json({ name: 'AiError', code: 'rate_limited', message: AI_RATE_MESSAGE }, 429);

    type Job = (ev: TurnEvents, signal: AbortSignal) => Promise<Record<string, unknown>>;
    let job: Job;
    let meta: Record<string, unknown> = {};
    try {
      const kind = String(body?.kind ?? '');
      if (kind === 'chat') {
        const prep = prepareChatTurn(parseChatParams(userId, { ...body, clientId: c.req.header('x-lit-client-id') }));
        meta = { threadId: prep.thread.id, title: prep.thread.title, userMessageId: prep.userMessage?.id ?? null, truncated: prep.truncated };
        job = async (ev, signal) => {
          const r = await executeChatTurn(prep, ev, signal);
          return { status: r.status, text: r.message?.data.text ?? '', message: r.message ? messageJson(r.message) : null, error: r.error ?? null, threadId: r.threadId, title: r.title ?? null };
        };
      } else if (kind === 'agent') {
        // a chat with a Custom Agent (runs as the agent's bot, agents/runs.ts)
        const prep = prepareAgentChat({
          userId, agentId: String(body?.agentId ?? ''), threadId: typeof body?.threadId === 'string' ? body.threadId : null, text: typeof body?.text === 'string' ? body.text.slice(0, 100_000) : '',
          approvalMode: typeof body?.approvalMode === 'string' ? body.approvalMode : undefined, pageId: typeof body?.pageId === 'string' ? body.pageId : null,
          model: typeof body?.model === 'string' ? body.model : undefined,
        });
        meta = { threadId: prep.thread.id, title: prep.thread.title, userMessageId: prep.userMessage.id, truncated: [], runId: prep.run.id };
        job = async (ev, signal) => {
          const r = await executeAgentChat(prep, ev, signal);
          return { status: r.message?.data.status ?? (r.status === 'failed' ? 'error' : 'complete'), text: r.text, message: r.message ? messageJson(r.message) : null, error: r.error ?? null, threadId: r.threadId, runId: r.run.id };
        };
      } else if (kind === 'writer') {
        const req = prepareWriter({ ...body, userId });
        job = async (ev, signal) => ({ ...(await executeSimple('writer', req, ev, signal)) });
      } else if (kind === 'block') {
        const req = prepareAiBlock({ userId, blockId: String(body?.blockId ?? ''), prompt: body?.prompt, output: body?.output, mentions: body?.mentions, search: !!body?.search, sources: typeof body?.sources === 'string' ? body.sources : undefined });
        job = async (ev, signal) => ({ ...(await executeSimple('block', req, ev, signal)) });
      } else {
        return c.json({ name: 'ValidationError', message: `Unknown AI request kind "${kind}"` }, 400);
      }
    } catch (e) {
      const err = mapError(e);
      return c.json({ name: 'AiError', code: err.code, message: err.message }, (err.status === 499 ? 400 : err.status) as any);
    }

    return streamSSE(c, async (stream) => {
      const ac = new AbortController();
      const abort = () => ac.abort();
      c.req.raw.signal?.addEventListener('abort', abort);
      stream.onAbort(abort);
      const send = (event: string, data: unknown) => (stream.aborted ? Promise.resolve() : stream.writeSSE({ event, data: JSON.stringify(data) }).catch(() => {}));
      // keep idle connections (long thinking, waiting for an approval) alive through proxies
      const ping = setInterval(() => void send('ping', {}), 15_000);
      try {
        await send('meta', meta);
        const result = await job(
          {
            status: (s) => void send('status', s),
            sources: (sources) => void send('sources', { sources }),
            text: (text) => void send('delta', { text }),
            step: (s) => void send('step', s),
            changes: (ch) => void send('changes', ch),
          },
          ac.signal,
        );
        await send('done', result);
      } finally {
        clearInterval(ping);
        c.req.raw.signal?.removeEventListener('abort', abort);
      }
    }, async (err, stream) => {
      const e = mapError(err);
      await stream.writeSSE({ event: 'done', data: JSON.stringify({ status: 'error', text: '', error: { code: e.code, message: e.message } }) }).catch(() => {});
    });
  });

  // MCP server (Streamable HTTP, JSON responses). /mcp is the conventional path; /api/mcp is reachable through
  // the web dev server's /api proxy too.
  const mcp = async (c: any) => {
    if (isDemoMode()) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32003, message: DEMO_MESSAGE } }, 403);
    if (c.req.method !== 'POST') return c.body(null, 405, { allow: 'POST' });
    if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Expected application/json' } }, 415);
    if (Number(c.req.header('content-length') ?? 0) > 1024 * 1024) return c.json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request is too large' } }, 413);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    }
    const r = await handleMcpHttp(c.req.header('authorization'), body, c.req.header('mcp-session-id'));
    if (r.body === undefined) return c.body(null, r.status as any, r.headers);
    return c.json(r.body, r.status as any, r.headers);
  };
  app.all('/api/mcp', mcp);
  app.all('/mcp', mcp);
}

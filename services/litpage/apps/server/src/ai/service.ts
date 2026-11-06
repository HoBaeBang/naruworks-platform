// AI request orchestration shared by the JSON API (api/modules/ai.ts) and the SSE route
// (aiStream.ts). Each surface has a synchronous prepare step (validation, permissions, context,
// persistence of the user turn; throws AiError → HTTP error) and an async execute step (model call).
//
// Chat turns run Agent: the tool registry (tools/registry.ts) acts as the user, write tools ask for approval
// according to the approval mode, every change is logged for Undo (changes.ts), web search / fetch run as Anthropic-side
// tools, the tools of the user's MCP connections run here (client tools, so the approval mode applies to them too), and
// progress streams as agent steps.
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import {
  AiError, describeUsage, logAiError, mapError, requireConfigured, runStream, type ClaudeLike, type RunResult,
} from './client.ts';
import { aiPersona, blockTitle, canRead, isMember, mdSource, pageIdOf, readPage, rowForAutofill, searchPages } from './context.ts';
import {
  autofillValue, buildAutofillRequest, buildBlockRequest, buildChatRequest, buildQaRequest, buildWriterRequest, chatTitleFrom,
  LANGUAGES, MAX_CONTEXT_CHARS, MAX_PAGE_CHARS, modeTools, resolveSkill, rowToMarkdown, TONES, buildTitleRequest,
  type AiBlockOutput, type AutofillKind, type ChatMode, type ModelRequest, type PageContext, type StoredContext, type StoredMessage,
} from './prompts.ts';
import {
  addMessage, contentHash, createThread, deleteMessage, getThread, listMessages, markRead, sentPageHashes, setAutoTitle, setThreadModel, sourceKey,
  threadSources, type Message, type MessageData, type SourceRef, type StoredStep, type Thread,
} from './threads.ts';
import { effectiveApprovalMode, userAiPrefs, workspaceAiPolicy, type ApprovalMode } from './aiPolicy.ts';
import { autoEffort, capabilities, modelLabel, resolveModel, webToolDefs, type TaskKind } from './models.ts';
import { waitForApproval } from './approvals.ts';
import { turnChanges, type TouchedPage } from './changes.ts';
import { fileResolver, prepareAttachments } from './attachments.ts';
import { chatMcpTools, runChatMcpTool } from './mcp.ts';
import { automaticSkills, skillById } from './skills.ts';
import { runTool } from './tools/registry.ts';
import { toolParams } from './tools/defs.ts';
import type { AgentEnv, ApprovalRequest, StepEvent, StepRef } from './tools/types.ts';

export interface TurnEvents {
  status?: (s: { phase: 'thinking' | 'searching' | 'reading' | 'writing'; detail?: string }) => void;
  sources?: (sources: SourceRef[]) => void;
  text?: (delta: string) => void;
  /** agent step (tool progress, approvals) */
  step?: (s: StepEvent) => void;
  /** the turn changed the workspace (Changes made card) */
  changes?: (c: { turnId: string; pages: TouchedPage[] }) => void;
}

const DEBUG = !!process.env.NC_AI_DEBUG;

function str(v: unknown, max = 100_000): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function ids(v: unknown, max = 20): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length <= 64))].slice(0, max) : [];
}

function wrapEvents(ev: TurnEvents) {
  let writing = false;
  return {
    onThinking: () => ev.status?.({ phase: 'thinking' }),
    onText: (d: string) => {
      if (!writing && d.trim()) {
        writing = true;
        ev.status?.({ phase: 'writing' });
      }
      ev.text?.(d);
    },
  };
}

/** Workspace members only, with AI enabled in workspace settings. */
export function assertAiAllowed(spaceId: string, userId: string) {
  if (!spaceId || !isMember(spaceId, userId)) throw new AiError('forbidden', 'You cannot access this workspace.', 403);
  if (!workspaceAiPolicy(spaceId).enabled) throw new AiError('forbidden', 'Litpage AI is turned off in this workspace.', 403);
}

// ---------------------------------------------------------------------------------------------
// Chat

export interface ChatParams {
  userId: string;
  spaceId: string;
  threadId?: string | null;
  text?: string;
  /** current page attached as context ("Current page" chip) */
  pageId?: string | null;
  /** @-mentioned pages */
  mentions?: string[];
  /** @-mentioned people / teamspaces */
  people?: string[];
  teamspaces?: string[];
  /** regenerate the answer to the last user message */
  retry?: boolean;
  /** "Search or ask": retrieve top workspace pages for the question up front (numbered sources) */
  retrieve?: boolean;
  /** Mode: default (agent) · ask (no edits) · plan · research */
  mode?: ChatMode;
  approvalMode?: string;
  /** "auto" or a model id */
  model?: string;
  /** Web (search + fetch) for this turn */
  web?: boolean;
  /** MCP connection ids enabled for this turn (undefined = all enabled connections) */
  connections?: string[] | null;
  /** uploaded files ({url|id, name}) */
  attachments?: unknown[];
  /** skills invoked with "/" */
  skills?: string[];
  /** the requesting client (agent edits are broadcast to every client, including this one) */
  clientId?: string;
  /** "All sources" menu: all sources, workspace only, web only, or one page / teamspace */
  scope?: { kind: 'all' | 'workspace' | 'web' | 'page' | 'teamspace'; id?: string } | null;
}

export interface PreparedChat {
  thread: Thread;
  messages: Message[];
  userMessage: Message | null;
  sources: SourceRef[];
  truncated: string[];
  params: ChatParams;
}

const MODES = new Set<ChatMode>(['default', 'ask', 'plan', 'research']);

export function parseChatParams(userId: string, body: any): ChatParams {
  return {
    userId,
    spaceId: str(body?.spaceId, 64),
    threadId: body?.threadId ? str(body.threadId, 64) : null,
    text: str(body?.text),
    pageId: body?.pageId ? str(body.pageId, 64) : null,
    mentions: ids(body?.mentions),
    people: ids(body?.people),
    teamspaces: ids(body?.teamspaces, 5),
    retry: !!body?.retry,
    retrieve: !!body?.retrieve,
    mode: MODES.has(body?.mode) ? body.mode : 'default',
    approvalMode: typeof body?.approvalMode === 'string' ? body.approvalMode : undefined,
    model: typeof body?.model === 'string' ? body.model.slice(0, 64) : undefined,
    web: body?.web === true,
    connections: Array.isArray(body?.connections) ? ids(body.connections, 20) : null,
    attachments: Array.isArray(body?.attachments) ? body.attachments.slice(0, 6) : [],
    skills: ids(body?.skills, 5),
    clientId: typeof body?.clientId === 'string' ? body.clientId.slice(0, 100) : undefined,
    scope: parseScope(body?.scope),
  };
}

function parseScope(v: any): ChatParams['scope'] {
  if (!v || typeof v !== 'object') return null;
  const kind = ['all', 'workspace', 'web', 'page', 'teamspace'].includes(v.kind) ? v.kind : null;
  if (!kind || kind === 'all') return null;
  if ((kind === 'page' || kind === 'teamspace') && (typeof v.id !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(v.id))) return null;
  return { kind, ...(kind === 'page' || kind === 'teamspace' ? { id: v.id } : {}) };
}

/** The chat's chosen source, when the person may use it (a page they can open, a teamspace they can see). */
function scopeOf(p: ChatParams): { kind: 'workspace' | 'web' | 'page' | 'teamspace'; id?: string; title?: string } | null {
  const sc = p.scope;
  if (!sc || sc.kind === 'all') return null;
  if (sc.kind === 'page') {
    const b = sc.id ? getRecord<BlockRecord>('block', sc.id) : undefined;
    if (!b || b.alive === false || b.space_id !== p.spaceId || blockRole(b.id, p.userId) === 'none') return null;
    return { kind: 'page', id: b.id, title: blockTitle(b) || 'Untitled' };
  }
  if (sc.kind === 'teamspace') {
    const t = sc.id ? getRecord<TeamRecord>('team', sc.id) : undefined;
    if (!t || t.alive === false || t.space_id !== p.spaceId) return null;
    if ((t.settings?.type ?? 'open') === 'private' && !(t.membership ?? []).some((m) => m.user_id === p.userId)) return null;
    return { kind: 'teamspace', id: t.id, title: t.name };
  }
  return { kind: sc.kind };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Facts stored with the user turn: today, the user, mentioned people / teamspaces. */
function turnMeta(p: ChatParams): { meta: string; people: { userId: string; name: string }[]; teamspaces: { teamId: string; name: string }[] } {
  const now = new Date();
  const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const me = getRecord<UserRecord>('lit_user', p.userId);
  const lines = [`Current date: ${ymd} (${WEEKDAYS[now.getDay()]})`, `User: ${me?.name || me?.email || 'Unknown'} (user_id: ${p.userId})`];
  const people = (p.people ?? []).map((id) => getRecord<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u)
    .filter((u) => isMember(p.spaceId, u.id)).map((u) => ({ userId: u.id, name: u.name || u.email || 'Unknown' }));
  if (people.length) lines.push(`Mentioned people: ${people.map((u) => `${u.name} (user_id: ${u.userId})`).join(', ')}`);
  const teamspaces = (p.teamspaces ?? []).map((id) => getRecord<TeamRecord>('team', id)).filter((t): t is TeamRecord => !!t && t.alive !== false && t.space_id === p.spaceId)
    .filter((t) => (t.settings?.type ?? 'open') !== 'private' || (t.membership ?? []).some((m) => m.user_id === p.userId))
    .map((t) => ({ teamId: t.id, name: t.name }));
  if (teamspaces.length) lines.push(`Focus on these teams (pass teamspace_id to search_workspace): ${teamspaces.map((t) => `${t.name} (teamspace_id: ${t.teamId})`).join(', ')}`);
  const sc = scopeOf(p);
  if (sc?.kind === 'page') lines.push(`Sources: the user limited this question to the page “${sc.title}” (page_id: ${sc.id}) and its sub-pages — workspace search only looks there.`);
  else if (sc?.kind === 'teamspace') lines.push(`Sources: the user limited this question to the team “${sc.title}”. Workspace search stays there.`);
  else if (sc?.kind === 'workspace') lines.push('Sources: Litpage workspace only (no web, no connected apps).');
  else if (sc?.kind === 'web') lines.push('Sources: the web only — answer from web search, not from the workspace.');
  return { meta: lines.join('\n'), people, teamspaces };
}

export function prepareChatTurn(p: ChatParams): PreparedChat {
  requireConfigured();
  assertAiAllowed(p.spaceId, p.userId);
  let thread = p.threadId ? getThread(p.threadId, p.userId) : null;
  if (p.threadId && !thread) throw new AiError('not_found', 'This chat doesn’t exist or was deleted.', 404);
  // chats with a custom agent continue through the agent (agents/runs.ts), never as the default chat agent
  if (thread?.agentId) throw new AiError('bad_request', 'This chat belongs to a custom agent.', 400);
  const text = (p.text ?? '').trim();
  if (!p.retry && !text && !(p.attachments ?? []).length) throw new AiError('bad_request', 'Type a message to send.', 400);
  const files = p.retry ? [] : prepareAttachments(p.userId, p.attachments);
  if (!thread) thread = createThread(p.userId, p.spaceId, chatTitleFrom(text || files[0]?.title || ''), p.pageId ?? null);
  let messages = listMessages(thread.id);
  const truncated: string[] = [];
  let userMessage: Message | null = null;

  if (p.retry) {
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') {
      deleteMessage(last.id);
      messages = messages.slice(0, -1);
    }
    if (!messages.length || messages[messages.length - 1].role !== 'user') throw new AiError('bad_request', 'There is nothing to retry.', 400);
  } else {
    const sent = sentPageHashes(messages);
    const contexts: StoredContext[] = [...files];
    const mentionMeta: { pageId: string; title: string }[] = [];
    let budget = MAX_CONTEXT_CHARS;
    // "@" runs an enabled skill, like "/" in the editor.
    const mentionedSkills = (p.mentions ?? []).filter((id) => !!skillById(id, p.userId, p.spaceId)?.enabled);
    const pageIds = [...new Set([p.pageId, ...(p.mentions ?? [])].filter((x): x is string => !!x && !mentionedSkills.includes(x)))];
    for (const id of pageIds) {
      const pc = readPage(id, p.userId, { maxChars: Math.max(2_000, Math.min(MAX_PAGE_CHARS, budget)) });
      if (!pc) continue;
      if (p.mentions?.includes(id)) mentionMeta.push({ pageId: id, title: pc.title });
      if (pc.truncated) truncated.push(pc.title);
      // pages already sent unchanged earlier in this chat are not repeated (append-only transcript)
      if (sent.get(`page:${id}`) === contentHash(pc.markdown)) continue;
      contexts.push({ kind: 'page', pageId: id, title: pc.title, markdown: pc.markdown, truncated: pc.truncated });
      budget -= pc.markdown.length;
      if (budget <= 0) break;
    }
    if (p.retrieve) {
      const known = threadSources(messages);
      let next = Math.max(0, ...[...known.values()].map((s) => s.n)) + 1;
      for (const r of searchPages(p.spaceId, p.userId, text, 6)) {
        if (budget <= 0) break;
        const pc = readPage(r.pageId, p.userId, { maxChars: 12_000 });
        if (!pc) continue;
        const n = known.get(sourceKey({ pageId: r.pageId }))?.n ?? next++;
        contexts.push({ kind: 'source', pageId: r.pageId, title: pc.title, markdown: pc.markdown, truncated: pc.truncated, n, ...(r.blockId ? { blockId: r.blockId } : {}) });
        budget -= pc.markdown.length;
      }
    }
    const skills: { id: string; name: string }[] = [];
    for (const sid of [...new Set([...(p.skills ?? []), ...mentionedSkills])]) {
      const s = skillById(sid, p.userId, p.spaceId);
      if (!s || !s.enabled) continue;
      contexts.push({ kind: 'skill', pageId: s.id, title: s.name, markdown: s.instructions.slice(0, 20_000), truncated: s.instructions.length > 20_000 });
      skills.push({ id: s.id, name: s.name });
      if (mentionedSkills.includes(sid)) mentionMeta.push({ pageId: s.id, title: s.name });
    }
    const meta = turnMeta(p);
    userMessage = addMessage(thread.id, 'user', {
      text, contexts, mentions: mentionMeta, pageId: p.pageId ?? null, meta: meta.meta, people: meta.people, teamspaces: meta.teamspaces,
      attachments: files.map((f) => ({ id: f.pageId, name: f.title, mime: f.mime ?? '', size: f.size ?? 0 })), skills, mode: p.mode, web: p.web || undefined,
    } as MessageData);
    messages = [...messages, userMessage];
  }
  if (p.model && p.model !== thread.model) {
    setThreadModel(thread.id, p.model);
    thread = { ...thread, model: p.model };
  }
  const last = messages[messages.length - 1];
  const sources = (last.data.contexts ?? []).filter((c) => c.kind === 'source').map((c) => ({ n: c.n ?? 0, pageId: c.pageId, title: c.title, ...(c.blockId ? { blockId: c.blockId } : {}) }));
  return { thread, messages, userMessage, sources, truncated, params: p };
}

export interface ChatResult {
  threadId: string;
  message: Message | null;
  status: NonNullable<MessageData['status']>;
  error?: { code: string; message: string };
  title?: string;
}

/** Approval required for this risk in this mode ("Always ask" = every change; "Review for me" = unsafe ones). */
export function needsApproval(mode: ApprovalMode, risk: ApprovalRequest['risk']): boolean {
  if (risk === 'plan') return true;
  if (mode === 'always_ask') return true;
  if (mode === 'skip_all') return false;
  return risk === 'destructive' || risk === 'share';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export async function executeChatTurn(prep: PreparedChat, ev: TurnEvents = {}, signal?: AbortSignal, client?: ClaudeLike): Promise<ChatResult> {
  const { thread, messages, params: p } = prep;
  const turnId = newId();
  const registry = threadSources(messages);
  const turnSources = new Map<string, SourceRef>(prep.sources.map((s) => [sourceKey(s), s]));
  let nextN = Math.max(0, ...[...registry.values()].map((s) => s.n)) + 1;
  const cite = (ref: StepRef): number => {
    const key = sourceKey({ pageId: ref.pageId, url: ref.url });
    const existing = turnSources.get(key) ?? registry.get(key);
    // a later search hit can tell where in an already-cited page the match is
    const r: SourceRef = existing
      ? (!existing.blockId && ref.blockId ? { ...existing, blockId: ref.blockId } : existing)
      : { n: nextN++, pageId: ref.pageId ?? '', title: ref.title, ...(ref.url ? { url: ref.url } : {}), ...(ref.blockId ? { blockId: ref.blockId } : {}) };
    registry.set(key, r);
    turnSources.set(key, r);
    ev.sources?.([...turnSources.values()]);
    return r.n;
  };
  if (turnSources.size) ev.sources?.([...turnSources.values()]);

  const policy = workspaceAiPolicy(p.spaceId);
  const prefs = userAiPrefs(p.userId);
  const approvalMode = effectiveApprovalMode(p.approvalMode ?? prefs.approvalMode, policy);
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const mode: ChatMode = MODES.has(p.mode as ChatMode) ? (p.mode as ChatMode) : ((lastUser?.data.mode as ChatMode | undefined) ?? 'default');
  const choice = p.model ?? thread.model ?? prefs.model;
  const { model, choice: honored } = resolveModel(choice, policy.allowedModels, { fableEnabled: policy.fable });
  const kind: TaskKind = mode === 'research' ? 'research' : mode === 'plan' ? 'plan' : 'chat';
  const effort = honored === 'auto' ? autoEffort(kind, lastUser?.data.text ?? '') : mode === 'research' || mode === 'plan' ? 'high' : 'medium';

  // ---- steps (persisted with the answer) and the agent environment
  const steps = new Map<string, StoredStep>();
  const emitStep = (s: StepEvent) => {
    const prev = steps.get(s.id);
    const next: StoredStep = { ...(prev ?? {}), ...s } as StoredStep;
    if (s.status !== 'waiting') delete next.approval;
    steps.set(s.id, next);
    ev.step?.(s);
  };
  const touchedPages: TouchedPage[] = [];
  const env: AgentEnv = {
    userId: p.userId,
    spaceId: p.spaceId,
    threadId: thread.id,
    turnId,
    currentPageId: p.pageId ?? thread.pageId,
    approvalMode,
    clientId: p.clientId,
    memories: policy.memories,
    searchScope: (() => {
      const sc = scopeOf(p);
      return sc?.kind === 'page' ? { pageId: sc.id } : sc?.kind === 'teamspace' ? { teamId: sc.id } : undefined;
    })(),
    cite,
    step: emitStep,
    touched: (pages) => {
      touchedPages.push(...pages);
      ev.changes?.({ turnId, pages: touchedPages });
    },
    approve: async (req) => {
      if (!needsApproval(approvalMode, req.risk)) return 'accept';
      const wait = waitForApproval(p.userId, thread.id, signal);
      const cur = steps.get(req.stepId);
      emitStep({ id: req.stepId, tool: req.tool, status: 'waiting', label: 'Awaiting your approval', detail: cur?.detail, refs: cur?.refs, approval: { id: wait.id, ...req.payload } });
      return wait.decision;
    },
  };
  const allowed = new Set(modeTools(mode));
  const scope = scopeOf(p);
  // "Web" as the only source: no workspace search
  if (scope?.kind === 'web') allowed.delete('search_workspace');
  // the person's MCP connections (not in Ask mode, nor when the sources are workspace only / one page / one teamspace / the
  // web only; Research reads only): their tools are client tools this server runs, so approvals apply (.x)
  const litOnly = scope?.kind === 'workspace' || scope?.kind === 'page' || scope?.kind === 'teamspace';
  const mcpTools = mode !== 'ask' && !litOnly && scope?.kind !== 'web' ? chatMcpTools(p.userId, p.spaceId, p.connections ?? null, { readOnly: mode === 'research' }) : null;
  const executeTool = async (name: string, input: Record<string, unknown>, id: string) => {
    const mcpTool = mcpTools?.map.get(name);
    if (mcpTool) return runChatMcpTool(env, mcpTool, input, id);
    if (name === 'search_workspace') ev.status?.({ phase: 'searching', detail: String(input.query ?? '') });
    else if (name === 'read_page') ev.status?.({ phase: 'reading', detail: blockTitle(getRecord<BlockRecord>('block', String(input.page_id ?? ''))) || undefined });
    return runTool(env, name, input, id, allowed);
  };

  // ---- request
  const history: StoredMessage[] = messages.map((m) => ({ role: m.role, text: m.data.text, contexts: m.data.contexts, status: m.data.status === 'stopped' ? 'stopped' : undefined, meta: m.data.meta }));
  const persona = aiPersona(p.userId);
  const skills = mode === 'ask' ? [] : automaticSkills(p.userId, p.spaceId);
  const req: ModelRequest = buildChatRequest(history, skills.length ? { ...(persona ?? {}), skills } : persona, {
    mode, resolveFile: fileResolver(p.userId), effort,
    // "Web" as the only source: the workspace search tool isn't offered
    ...(scope?.kind === 'web' ? { tools: toolParams(modeTools(mode).filter((n) => n !== 'search_workspace')) } : {}),
  });
  req.model = model;
  req.fallback = capabilities(model).fallback;
  if (mcpTools?.defs.length) req.tools = [...(req.tools ?? []), ...mcpTools.defs.map((d) => ({ ...d, eager_input_streaming: true }) as never)];
  // sources: workspace only / one page / one teamspace -> no web, no connected apps; Web only -> web on
  const webOn = (scope?.kind === 'web' || ((p.web ?? false) && !litOnly)) && policy.webSearch;
  const serverTools: Record<string, unknown>[] = webOn ? webToolDefs(model, { fetch: !policy.webConfirm }) : [];
  if (serverTools.length) req.serverTools = serverTools;

  const serverCalls = new Map<string, { name: string; detail: string }>();
  let result: RunResult | null = null;
  let error: AiError | null = null;
  try {
    result = await runStream(req, {
      ...wrapEvents(ev),
      cite: (c) => cite({ url: c.url, title: c.title }),
      onServerTool: (e) => {
        const query = typeof e.input.query === 'string' ? e.input.query : '';
        const url = typeof e.input.url === 'string' ? e.input.url : '';
        serverCalls.set(e.id, { name: e.name, detail: query || hostOf(url) });
        if (e.name === 'web_search') {
          ev.status?.({ phase: 'searching', detail: query });
          emitStep({ id: e.id, tool: 'web_search', status: 'running', label: 'Searching', detail: query });
        } else {
          emitStep({ id: e.id, tool: 'web_fetch', status: 'running', label: 'Viewing', detail: hostOf(url) });
        }
      },
      onServerResult: (e) => {
        const call = serverCalls.get(e.toolUseId);
        const refs = e.results.slice(0, 10).map((r) => ({ url: r.url, title: r.title }));
        if (e.error) emitStep({ id: e.toolUseId, tool: call?.name ?? 'web_search', status: 'error', label: call?.name === 'web_fetch' ? 'Viewing' : 'Searching', detail: call?.detail, error: e.error });
        else if (e.type === 'web_fetch_tool_result') emitStep({ id: e.toolUseId, tool: 'web_fetch', status: 'done', label: `Viewed ${hostOf(refs[0]?.url ?? call?.detail ?? '')}`, refs });
        else emitStep({ id: e.toolUseId, tool: 'web_search', status: 'done', label: 'Searched', detail: call?.detail, refs });
      },
    }, { signal, executeTool, client, maxToolRounds: mode === 'research' ? 30 : 24 });
    if (DEBUG) console.log(`[ai] chat ${model} ${describeUsage(result.usage)}`);
  } catch (e) {
    error = mapError(e);
    logAiError('chat', e);
  }
  const changed = !!turnChanges(turnId);
  const stepList = [...steps.values()].map((s) => (s.status === 'waiting' || s.status === 'running' ? { ...s, status: 'error', error: s.error ?? 'Stopped' } : s));
  let data: MessageData;
  const common = { steps: stepList.length ? stepList : undefined, changed: changed || undefined, mode, modelChoice: honored } as Partial<MessageData>;
  if (error) data = { text: '', status: 'error', error: { code: error.code, message: error.message }, sources: [...turnSources.values()], ...common };
  else if (result!.refused) data = { text: '', status: 'refused', error: { code: 'refusal', message: 'Litpage AI can’t help with that request.' }, ...common };
  else data = { text: result!.text, status: result!.aborted ? 'stopped' : 'complete', sources: [...turnSources.values()], model: result!.model, ...common };
  const message = addMessage(thread.id, 'assistant', data, turnId);
  let title: string | undefined;
  if (!signal?.aborted) {
    markRead(thread.id);
    // AI summary title for a new chat (first answer, never after a manual rename)
    if (data.status === 'complete' && thread.autoTitle && messages.filter((m) => m.role === 'user').length === 1) {
      title = await generateTitle(lastUser?.data.text ?? '', data.text, client).catch(() => undefined);
      if (title) setAutoTitle(thread.id, title);
    }
  }
  return { threadId: thread.id, message, status: data.status!, error: data.error, title };
}

/** Short chat title from the first exchange (AI summary title). Empty on any failure. */
async function generateTitle(question: string, answer: string, client?: ClaudeLike): Promise<string | undefined> {
  if (!question.trim()) return undefined;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const r = await runStream(buildTitleRequest(question, answer), {}, { signal: ac.signal, client });
    const t = r.text.replace(/^["“”'#*\s]+|["“”'.*\s]+$/g, '').replace(/\s+/g, ' ').trim();
    return t && t.length <= 80 && !r.refused ? t : undefined;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Inline writer ("Ask AI" in pages)

export interface WriterParams {
  userId: string;
  pageId?: string | null;
  skill?: string;
  prompt?: string;
  selection?: string;
  before?: string;
  language?: string;
  tone?: string;
  previous?: string;
  /** a user skill (page id) to run on the selection */
  skillId?: string;
  /** @-mentioned pages used as reference ("Write in the style of @…") */
  mentions?: string[];
  spaceId?: string;
}

export function prepareWriter(p: WriterParams): ModelRequest {
  requireConfigured();
  let skill = resolveSkill(p.skill) ?? 'custom';
  let prompt = p.prompt?.slice(0, 20_000);
  let page: PageContext | undefined;
  if (p.pageId) {
    if (!canRead(p.pageId, p.userId)) throw new AiError('forbidden', 'You don’t have access to this page.', 403);
    page = readPage(p.pageId, p.userId, { maxChars: 60_000 }) ?? undefined;
    const sid = getRecord<BlockRecord>('block', p.pageId)?.space_id;
    if (sid && !workspaceAiPolicy(sid).enabled) throw new AiError('forbidden', 'Litpage AI is turned off in this workspace.', 403);
  } else if (p.spaceId) {
    assertAiAllowed(p.spaceId, p.userId);
  } else {
    throw new AiError('bad_request', 'Open a page to use Litpage AI.', 400);
  }
  if (p.skillId) {
    const spaceId = (p.pageId ? getRecord<BlockRecord>('block', p.pageId)?.space_id : undefined) ?? p.spaceId ?? '';
    const s = skillById(p.skillId, p.userId, spaceId);
    if (!s) throw new AiError('not_found', 'That skill doesn’t exist or isn’t enabled.', 404);
    skill = 'custom';
    prompt = `Follow these skill instructions (“${s.name}”) on ${p.selection?.trim() ? 'the selected text' : 'the page'}${prompt?.trim() ? `, and this request: ${prompt.trim()}` : ''}:\n\n${s.instructions}`;
  }
  if (skill === 'custom' && !prompt?.trim()) throw new AiError('bad_request', 'Tell Litpage AI what to write.', 400);
  const references = (p.mentions ?? []).slice(0, 5).map((id) => readPage(id, p.userId, { maxChars: 20_000 })).filter((x): x is PageContext => !!x);
  const language = LANGUAGES.find((l) => l.toLowerCase() === p.language?.trim().toLowerCase()) ?? (p.language?.trim().slice(0, 40) || undefined);
  const tone = TONES.find((t) => t.toLowerCase() === p.tone?.trim().toLowerCase()) ?? (p.tone?.trim().slice(0, 40) || undefined);
  return buildWriterRequest({
    skill,
    prompt,
    selection: p.selection?.slice(0, 100_000),
    before: p.before?.slice(-4_000),
    previous: p.previous?.slice(0, 100_000),
    language,
    tone,
    page,
    references,
  });
}

export interface SimpleResult {
  text: string;
  status: 'complete' | 'stopped' | 'error' | 'refused';
  error?: { code: string; message: string };
}

/** Run a single-turn request (writer, AI block, Q&A) and report errors as data. */
export async function executeSimple(where: string, req: ModelRequest, ev: TurnEvents = {}, signal?: AbortSignal, client?: ClaudeLike): Promise<SimpleResult> {
  try {
    const r = await runStream(req, wrapEvents(ev), { signal, client });
    if (DEBUG) console.log(`[ai] ${where} ${describeUsage(r.usage)}`);
    if (r.refused) return { text: '', status: 'refused', error: { code: 'refusal', message: 'Litpage AI can’t help with that request.' } };
    return { text: r.text, status: r.aborted ? 'stopped' : 'complete' };
  } catch (e) {
    const err = mapError(e);
    logAiError(where, e);
    return { text: '', status: 'error', error: { code: err.code, message: err.message } };
  }
}

// ---------------------------------------------------------------------------------------------
// AI block

export function prepareAiBlock(p: { userId: string; blockId: string; prompt?: string; output?: string; mentions?: string[]; search?: boolean; sources?: string }): ModelRequest {
  requireConfigured();
  const b = getRecord<BlockRecord>('block', p.blockId);
  if (!b || b.alive === false) throw new AiError('not_found', 'This AI block no longer exists.', 404);
  if (!canRead(p.blockId, p.userId)) throw new AiError('forbidden', 'You don’t have permission to generate this block.', 403);
  if (!workspaceAiPolicy(b.space_id).enabled) throw new AiError('forbidden', 'Litpage AI is turned off in this workspace.', 403);
  const fmt = (b.format ?? {}) as Record<string, unknown>;
  const output = (['custom', 'page_summary', 'key_points', 'action_items'].includes(String(p.output ?? fmt.ai_output)) ? String(p.output ?? fmt.ai_output) : 'custom') as AiBlockOutput;
  const prompt = String(p.prompt ?? fmt.ai_prompt ?? '').slice(0, 20_000);
  if (output === 'custom' && !prompt.trim()) throw new AiError('bad_request', 'Describe the content that should be generated.', 400);
  const pageId = pageIdOf(p.blockId);
  // "Using information from": Current page (default) · Specified pages only · Workspace search
  const sourceMode = String(p.sources ?? fmt.ai_sources ?? 'page');
  const page = sourceMode === 'specified' ? null : pageId ? readPage(pageId, p.userId, { maxChars: MAX_PAGE_CHARS, skip: new Set([p.blockId]) }) : null;
  const mentioned = (Array.isArray(p.mentions) ? p.mentions.filter((x): x is string => typeof x === 'string') : (Array.isArray(fmt.ai_mentions) ? (fmt.ai_mentions as string[]) : []))
    .slice(0, 10)
    .map((id) => readPage(id, p.userId, { maxChars: 30_000 }))
    .filter((x): x is PageContext => !!x);
  if (sourceMode === 'search' || p.search) {
    // workspace search on the instructions (or the page title) adds the top readable pages as references
    const q = prompt.trim() || (pageId ? blockTitle(getRecord<BlockRecord>('block', pageId)) : '');
    for (const r of q ? searchPages(b.space_id, p.userId, q, 4) : []) {
      if (r.pageId === pageId || mentioned.some((m) => m.pageId === r.pageId)) continue;
      const pc = readPage(r.pageId, p.userId, { maxChars: 12_000 });
      if (pc) mentioned.push(pc);
    }
  }
  return buildBlockRequest(output, prompt, page, mentioned);
}

// ---------------------------------------------------------------------------------------------
// Database AI Autofill

export interface AutofillParams {
  userId: string;
  rowId: string;
  propId: string;
  kind: AutofillKind;
  prompt?: string;
  language?: string;
}

export async function runAutofill(p: AutofillParams, client?: ClaudeLike): Promise<{ text: string; value: unknown[] }> {
  requireConfigured();
  const r = rowForAutofill(p.rowId, p.userId);
  if (!r) throw new AiError('not_found', 'That database row doesn’t exist or you can’t access it.', 404);
  if (!workspaceAiPolicy(r.row.space_id).enabled) throw new AiError('forbidden', 'Litpage AI is turned off in this workspace.', 403);
  const prop = r.col.schema[p.propId];
  if (!prop) throw new AiError('bad_request', 'Unknown property.', 400);
  const kind: AutofillKind = ['summary', 'keywords', 'translation', 'custom'].includes(p.kind) ? p.kind : 'custom';
  if (kind === 'custom' && !p.prompt?.trim()) throw new AiError('bad_request', 'Add instructions for the custom autofill.', 400);
  const options = ['select', 'multi_select', 'status'].includes(prop.type) ? (prop.options ?? []).map((o) => o.value) : undefined;
  const row = rowToMarkdown(r.row as any, r.col.schema, mdSource(p.userId), { skipProp: p.propId, maxChars: 60_000 });
  const req = buildAutofillRequest({
    kind, propertyName: prop.name, propertyType: prop.type, prompt: p.prompt?.slice(0, 4_000), language: p.language?.slice(0, 40), options, row,
  });
  const res = await runStream(req, {}, { client });
  if (res.refused) throw new AiError('refusal', 'Litpage AI can’t help with that request.', 400);
  return autofillValue(res.text, prop.type, options);
}

// ---------------------------------------------------------------------------------------------
// Workspace Q&A (single call; used by the JSON API — the chat's "Search or ask" uses retrieve)

export async function runQuery(p: { userId: string; spaceId: string; query: string }, client?: ClaudeLike): Promise<{ answer: string; sources: SourceRef[] }> {
  requireConfigured();
  assertAiAllowed(p.spaceId, p.userId);
  if (!p.query.trim()) throw new AiError('bad_request', 'Ask a question first.', 400);
  const ctx: StoredContext[] = [];
  let n = 1;
  for (const r of searchPages(p.spaceId, p.userId, p.query, 6)) {
    const pc = readPage(r.pageId, p.userId, { maxChars: 12_000 });
    if (pc) ctx.push({ kind: 'source', pageId: pc.pageId, title: pc.title, markdown: pc.markdown, truncated: pc.truncated, n: n++ });
  }
  const res = await runStream(buildQaRequest(p.query, ctx, aiPersona(p.userId)), {}, { client });
  if (res.refused) throw new AiError('refusal', 'Litpage AI can’t help with that request.', 400);
  return { answer: res.text, sources: ctx.map((c) => ({ n: c.n!, pageId: c.pageId, title: c.title })) };
}

export { mapError, modelLabel };


import { create } from 'zustand';
import { api, clientId } from '../../lib/api.ts';
import { useSession } from '../../lib/store/session.ts';
import { openPage } from '../../lib/router.ts';
import { createSseParser } from './sse.ts';


export const NO_KEY_MESSAGE = 'Connect an AI provider to use Litpage AI';

export interface AiModelOption {
  id: string;
  name: string;
  version: string;
  group: 'recommended' | 'other';
  beta: boolean;
  description: string;
  
  allowed: boolean;
}

export interface AiPolicy {
  enabled: boolean;
  webSearch: boolean;
  webConfirm: boolean;
  skipApprovals: boolean;
  customMcp: boolean;
  memories: boolean;
  litMcp: boolean;
  mcpSkills: boolean;
  localSkills: boolean;
}

export interface AiStatus {
  
  configured: boolean | null;
  model: string;
  modelLabel: string;
  
  models: AiModelOption[];
  
  autoModel: string;
  policy: AiPolicy;
  prefs: { web: boolean; approvalMode: ApprovalMode; model: string };
  maxAttachments: number;
  refresh: () => Promise<void>;
  
  markUnconfigured: () => void;
}

export type ApprovalMode = 'always_ask' | 'review_for_me' | 'skip_all';
export type ChatMode = 'default' | 'ask' | 'plan' | 'research';

let inflight: Promise<void> | null = null;

const DEFAULT_POLICY: AiPolicy = { enabled: true, webSearch: true, webConfirm: false, skipApprovals: true, customMcp: true, memories: true, litMcp: true, mcpSkills: true, localSkills: true };


export function policyFromSpaceSettings(settings: Record<string, unknown> | null | undefined): AiPolicy {
  const s = settings ?? {};
  const b = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    enabled: b(s.ai_enabled, true), webSearch: b(s.ai_web_search, true), webConfirm: b(s.ai_web_confirm, false), skipApprovals: b(s.ai_skip_approvals, true),
    customMcp: b(s.ai_custom_mcp, true), memories: b(s.ai_memories, true), litMcp: b(s.lit_mcp_enabled, true), mcpSkills: b(s.ai_mcp_skills, true),
    localSkills: b(s.ai_local_skills, true),
  };
}

let refreshAgain = false;

export const useAiStatus = create<AiStatus>((set) => ({
  configured: null,
  model: 'claude-opus-5-5',
  modelLabel: 'Opus 5.5',
  models: [],
  autoModel: 'Opus 5.5',
  policy: DEFAULT_POLICY,
  prefs: { web: false, approvalMode: 'review_for_me', model: 'auto' },
  maxAttachments: 5,
  refresh: () => {
    // a refresh asked for while one is in flight runs again afterwards (the first may predate a settings change)
    if (inflight) {
      refreshAgain = true;
      return inflight;
    }
    inflight = api('aiStatus', { spaceId: useSession.getState().spaceId })
      .then((r) => set({
        configured: !!r.configured, model: r.model, modelLabel: r.modelLabel, models: r.models ?? [], autoModel: r.autoModel ?? r.modelLabel,
        policy: { ...DEFAULT_POLICY, ...(r.policy ?? {}) }, prefs: { ...{ web: false, approvalMode: 'review_for_me', model: 'auto' }, ...(r.prefs ?? {}) }, maxAttachments: r.limits?.attachments ?? 5,
      }))
      .catch(() => {})
      .finally(() => {
        inflight = null;
        if (refreshAgain) {
          refreshAgain = false;
          void useAiStatus.getState().refresh();
        }
      });
    return inflight;
  },
  markUnconfigured: () => set({ configured: false }),
}));

export function ensureAiStatus() {
  const s = useAiStatus.getState();
  if (s.configured === null) void s.refresh();
}

export class AiRequestError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isNoKeyError(e: unknown): boolean {
  return (e as any)?.code === 'no_key' || (e as Error)?.message === NO_KEY_MESSAGE;
}

export interface SourceRef {
  n: number;
  pageId: string;
  title: string;
  
  url?: string;
  
  blockId?: string;
}


export function openSource(ref: SourceRef) {
  if (ref.url) {
    if (/^https?:/i.test(ref.url)) window.open(ref.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (!ref.pageId) return;
  if (!ref.blockId) {
    openPage(ref.pageId);
    return;
  }
  // the page scrolls to the cited block and flashes it (already open → just scroll)
  const { pageId, blockId } = ref;
  void import('../editor/blockLinks.ts').then((m) => m.openBlockLink(pageId, blockId)).catch(() => openPage(pageId, { blockId }));
}

export interface StepRef {
  pageId?: string;
  url?: string;
  title: string;
}


export interface ApprovalPayload {
  id: string;
  title: string;
  description?: string;
  markdown?: string;
  removed?: string[];
  properties?: { name: string; value: string }[];
  pages?: StepRef[];
  plan?: { title: string; steps: string[] };
  confirmLabel?: string;
  danger?: boolean;
}


export interface AgentStep {
  id: string;
  tool: string;
  status: 'running' | 'waiting' | 'done' | 'error' | 'declined';
  label: string;
  detail?: string;
  refs?: StepRef[];
  approval?: ApprovalPayload;
  error?: string;
  mcp?: { server: string; tool: string; input?: string; output?: string };
}

export interface TouchedPage {
  pageId: string;
  title: string;
  action: 'created' | 'updated' | 'deleted' | 'moved' | 'commented' | 'restored';
  database?: boolean;
}

export interface TurnChanges {
  pages: TouchedPage[];
  undone: boolean;
}

export interface AiStatusEvent {
  phase: 'thinking' | 'searching' | 'reading' | 'writing';
  detail?: string;
}

export interface DoneEvent {
  status: 'complete' | 'stopped' | 'error' | 'refused';
  text: string;
  error?: { code: string; message: string } | null;
  message?: ChatMessage | null;
  threadId?: string;
  
  title?: string | null;
}

export interface StreamHandlers {
  onMeta?: (m: { threadId?: string; title?: string; userMessageId?: string | null; truncated?: string[] }) => void;
  onStatus?: (s: AiStatusEvent) => void;
  onSources?: (s: SourceRef[]) => void;
  onDelta?: (text: string) => void;
  onStep?: (s: AgentStep) => void;
  onChanges?: (c: { turnId: string; pages: TouchedPage[] }) => void;
}


export async function streamAi(body: Record<string, unknown>, h: StreamHandlers, signal?: AbortSignal): Promise<DoneEvent> {
  let text = '';
  let done: DoneEvent | null = null;
  let res: Response;
  try {
    res = await fetch('/api/ai/stream', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lit-client-id': clientId, accept: 'text/event-stream' },
      body: JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return { status: 'stopped', text: '' };
    throw new AiRequestError(0, 'network', 'Couldn’t connect to Litpage AI. Check your connection.');
  }
  if (!res.ok) {
    let j: any = {};
    try {
      j = await res.json();
    } catch {
      
    }
    const err = new AiRequestError(res.status, j?.code ?? (j?.message === NO_KEY_MESSAGE ? 'no_key' : 'error'), j?.message ?? res.statusText);
    if (isNoKeyError(err)) useAiStatus.getState().markUnconfigured();
    throw err;
  }
  const parser = createSseParser(({ event, data }) => {
    let d: any = {};
    try {
      d = data ? JSON.parse(data) : {};
    } catch {
      return;
    }
    if (event === 'meta') h.onMeta?.(d);
    else if (event === 'status') h.onStatus?.(d);
    else if (event === 'sources') h.onSources?.(d.sources ?? []);
    else if (event === 'step') h.onStep?.(d);
    else if (event === 'changes') h.onChanges?.(d);
    else if (event === 'delta') {
      text += d.text ?? '';
      h.onDelta?.(d.text ?? '');
    } else if (event === 'done') done = d;
  });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  try {
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      parser.push(dec.decode(value, { stream: true }));
    }
    parser.end();
  } catch (e) {
    if (signal?.aborted) return { status: 'stopped', text };
    return { status: 'error', text, error: { code: 'network', message: 'The connection to Litpage AI was interrupted.' } };
  }
  if (signal?.aborted && !done) return { status: 'stopped', text };
  return done ?? { status: 'error', text, error: { code: 'network', message: 'Litpage AI ended before completing the task.' } };
}

// ---------------------------------------------------------------------------------------------
// Chat threads

export interface ChatThread {
  id: string;
  title: string;
  pageId: string | null;
  updatedTime: number;
  createdTime: number;
  pinned?: boolean;
  
  unread?: boolean;
  
  model?: string | null;
  
  shared?: boolean;
  icon?: string | null;
  
  readOnly?: boolean;
  ownerName?: string;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  createdTime: number;
  text: string;
  status: 'complete' | 'stopped' | 'error' | 'refused' | 'streaming';
  error?: { code: string; message: string } | null;
  sources: SourceRef[];
  mentions: { pageId: string; title: string }[];
  pageId: string | null;
  contexts?: { kind: 'page' | 'source'; pageId: string; title: string; truncated?: boolean; n?: number }[];
  steps?: AgentStep[];
  changes?: TurnChanges | null;
  feedback?: { rating: 'positive' | 'negative'; comment?: string } | null;
  attachments?: Attachment[];
  skills?: { id: string; name: string }[];
  people?: { userId: string; name: string }[];
  teamspaces?: { teamId: string; name: string }[];
  mode?: ChatMode;
  model?: string | null;
  web?: boolean;
}

interface ThreadsState {
  threads: ChatThread[];
  loadedFor: string | null;
  load: (spaceId: string) => Promise<void>;
  upsert: (t: Partial<ChatThread> & { id: string }) => void;
  remove: (id: string) => void;
}

export const useChatThreads = create<ThreadsState>((set, get) => ({
  threads: [],
  loadedFor: null,
  async load(spaceId) {
    try {
      const r = await api('aiListThreads', { spaceId });
      set({ threads: r.threads, loadedFor: spaceId });
    } catch {
      
    }
  },
  upsert(t) {
    const cur = get().threads;
    const i = cur.findIndex((x) => x.id === t.id);
    const now = Date.now();
    const next = i >= 0 ? { ...cur[i], ...t, updatedTime: t.updatedTime ?? now } : ({ title: '', pageId: null, createdTime: now, updatedTime: now, ...t } as ChatThread);
    // updates that keep the time (pin, icon, read state) keep the position too
    if (i >= 0 && t.updatedTime === cur[i].updatedTime) set({ threads: cur.map((x) => (x.id === t.id ? next : x)) });
    else set({ threads: [next, ...cur.filter((x) => x.id !== t.id)] });
  },
  remove(id) {
    set({ threads: get().threads.filter((t) => t.id !== id) });
  },
}));

export async function deleteChat(threadId: string) {
  useChatThreads.getState().remove(threadId);
  await api('aiDeleteThread', { threadId }).catch(() => {});
}

export async function renameChat(threadId: string, title: string) {
  useChatThreads.getState().upsert({ id: threadId, title });
  await api('aiRenameThread', { threadId, title }).catch(() => {});
}

export async function pinChat(threadId: string, pinned: boolean) {
  const cur = useChatThreads.getState().threads.find((t) => t.id === threadId);
  if (cur) useChatThreads.getState().upsert({ id: threadId, pinned, updatedTime: cur.updatedTime });
  await api('aiPinThread', { threadId, pinned }).catch(() => {});
}

export async function setChatIcon(threadId: string, icon: string | null) {
  const cur = useChatThreads.getState().threads.find((t) => t.id === threadId);
  if (cur) useChatThreads.getState().upsert({ id: threadId, icon, updatedTime: cur.updatedTime });
  await api('aiSetThreadIcon', { threadId, icon }).catch(() => {});
}


export const SHARED_CHATS_EVENT = 'nc:ai-shared-chats';

export async function shareChat(threadId: string, shared: boolean) {
  const cur = useChatThreads.getState().threads.find((t) => t.id === threadId);
  if (cur) useChatThreads.getState().upsert({ id: threadId, shared, updatedTime: cur.updatedTime });
  await api('aiShareThread', { threadId, shared });
  window.dispatchEvent(new Event(SHARED_CHATS_EVENT));
}

export function markChatRead(threadId: string) {
  const cur = useChatThreads.getState().threads.find((t) => t.id === threadId);
  if (cur?.unread) useChatThreads.getState().upsert({ id: threadId, unread: false, updatedTime: cur.updatedTime });
}


export async function answerApproval(approvalId: string, decision: 'accept' | 'decline') {
  await api('aiApprove', { approvalId, decision });
}

export async function undoAgentChanges(messageId: string): Promise<{ reverted: number; conflicts: number; changes: TurnChanges | null }> {
  return api('aiUndoChanges', { messageId });
}

export async function sendFeedback(messageId: string, rating: 'positive' | 'negative' | null, comment?: string) {
  return api('aiFeedback', { messageId, rating, comment });
}

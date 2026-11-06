// Custom Agent runs: every chat turn and every triggered run is a run row
// (Activity, Insights) with its transcript in an AI thread (agent_id set). Runs execute through the AI tool
// loop (ai/client.ts runStream + ai/tools) acting as the agent's bot principal — writes go through applyTransactions
// with the agent's own permissions and are tagged source "agent:<runId>" so the agent's edits never re-trigger it.
//
// Background runs (triggers, schedules, Run, sub-agents) are queued: one at a time per agent, NC_AGENT_CONCURRENCY
// (default 3) at once, NC_AGENT_RUNS_PER_HOUR (default 60) triggered runs per agent per hour — beyond that the agent
// pauses ("run limit") and further runs wait until someone resumes it. Five failed triggered runs in a row pause it
// too. Without a configured provider a run fails with "Connect an AI provider to use Litpage AI" (the Activity shows it).
import { newId } from '@nc/shared/ids.ts';
import type { NotificationRecord, SpaceRecord, UserRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import {
  type AgentConfig, type AgentRecord, type AgentTrigger, type PausedReason, type RunKind, type RunStatus,
} from '@nc/shared/agents.ts';
import { db, getRecord } from '../db.ts';
import { pushNotification } from '../notify.ts';
import { audit } from '../audit.ts';
import { AiError, aiConfigured, describeUsage, logAiError, mapError, NO_KEY_MESSAGE, runStream, type ClaudeLike, type RunResult } from '../ai/client.ts';
import { blockTitle, canRead, mdSource } from '../ai/context.ts';
import { blockRole } from '../records.ts';
import { buildChatRequest, pageToMarkdown, type StoredMessage } from '../ai/prompts.ts';
import { addMessage, createThread, listMessages, markRead, setAutoTitle, setThreadModel, threadById, type Message, type MessageData, type SourceRef, type StoredStep, type Thread } from '../ai/threads.ts';
import { effectiveApprovalMode, userAiPrefs, workspaceAiPolicy, type ApprovalMode } from '../ai/aiPolicy.ts';
import { autoEffort, capabilities, offeredModels, resolveModel, webToolDefs } from '../ai/models.ts';
import { waitForApproval } from '../ai/approvals.ts';
import { turnChanges, type TouchedPage } from '../ai/changes.ts';
import { toolParams } from '../ai/tools/defs.ts';
import { runTool } from '../ai/tools/registry.ts';
import type { AgentEnv, ApprovalRequest, StepEvent, StepRef } from '../ai/tools/types.ts';
import type { TurnEvents } from '../ai/service.ts';
import { blockLabel, editorAccessCheck } from './access.ts';
import { agentModelPolicy, agentPeople, agentRole, agentsAvailable, getAgent, orphanState, patchAgent } from './model.ts';
import { agentSystem } from './prompts.ts';
import { triggerBlock, isNoAction } from './prompts.ts';
import { agentMcpTools, agentToolNames, callKey, runAgentTool, type PendingReview, type RunToolContext } from './tools.ts';
import { DEMO_MESSAGE, isDemoMode } from '../demo.ts';

/** Message shown when an agent is paused because no editor can access it. */
export const ORPHANED_MESSAGE = 'This agent is paused because no one has full access. Grant full access to someone in Share settings, then try again.';

db.exec(`
CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  thread_id TEXT,
  kind TEXT NOT NULL,
  trigger_id TEXT,
  trigger_type TEXT,
  trigger_label TEXT,
  actor_id TEXT,
  page_id TEXT,
  status TEXT NOT NULL,
  held INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  created_time INTEGER NOT NULL,
  started_time INTEGER,
  ended_time INTEGER,
  model TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  credits REAL NOT NULL DEFAULT 0,
  tools TEXT,
  changes INTEGER NOT NULL DEFAULT 0,
  payload TEXT,
  result TEXT,
  chain TEXT,
  feedback TEXT,
  review TEXT,
  parent_run_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_agent ON agent_runs(agent_id, created_time);
CREATE INDEX IF NOT EXISTS idx_agent_runs_space ON agent_runs(space_id, created_time);
CREATE INDEX IF NOT EXISTS idx_agent_runs_thread ON agent_runs(thread_id);
`);

export interface RunRow {
  id: string;
  agentId: string;
  spaceId: string;
  threadId: string | null;
  kind: RunKind;
  triggerId: string | null;
  triggerType: string | null;
  triggerLabel: string;
  actorId: string | null;
  pageId: string | null;
  status: RunStatus;
  held: boolean;
  error: string | null;
  createdTime: number;
  startedTime: number | null;
  endedTime: number | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  credits: number;
  tools: string[];
  changes: number;
  payload: RunPayload;
  result: string | null;
  chain: string[];
  feedback: { rating: 'positive' | 'negative'; comment?: string; userId: string; time: number } | null;
  review: (PendingReview & { decided?: 'allow' | 'deny'; decidedBy?: string }) | null;
  parentRunId: string | null;
}

/** What the run is about: the model's trigger facts and, for chats, the message. */
export interface RunPayload {
  text?: string;
  facts?: string[];
  instructions?: string;
  /** calls approved for a re-run (Needs review → Allow) */
  approvedCalls?: string[];
  /** extra hosts allowed for a re-run */
  allowedHosts?: string[];
  [k: string]: unknown;
}

const json = <T>(s: unknown, fallback: T): T => {
  if (typeof s !== 'string' || !s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

const toRun = (r: any): RunRow => ({
  id: r.id, agentId: r.agent_id, spaceId: r.space_id, threadId: r.thread_id ?? null, kind: r.kind, triggerId: r.trigger_id ?? null, triggerType: r.trigger_type ?? null,
  triggerLabel: r.trigger_label ?? '', actorId: r.actor_id ?? null, pageId: r.page_id ?? null, status: r.status, held: !!r.held, error: r.error ?? null,
  createdTime: r.created_time, startedTime: r.started_time ?? null, endedTime: r.ended_time ?? null, model: r.model ?? null, inputTokens: r.input_tokens ?? 0,
  outputTokens: r.output_tokens ?? 0, credits: r.credits ?? 0, tools: json(r.tools, []), changes: r.changes ?? 0, payload: json(r.payload, {}), result: r.result ?? null,
  chain: json(r.chain, []), feedback: json(r.feedback, null), review: json(r.review, null), parentRunId: r.parent_run_id ?? null,
});

export function getRun(id: string): RunRow | null {
  const r = db.prepare('SELECT * FROM agent_runs WHERE id = ?').get(String(id));
  return r ? toRun(r) : null;
}

function updateRun(id: string, patch: Partial<Record<string, unknown>>) {
  const keys = Object.keys(patch);
  if (!keys.length) return;
  db.prepare(`UPDATE agent_runs SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => {
    const v = patch[k];
    return v !== null && typeof v === 'object' ? JSON.stringify(v) : (v as any) ?? null;
  }), id);
}

export interface NewRun {
  agent: AgentRecord;
  kind: RunKind;
  label: string;
  trigger?: AgentTrigger | null;
  actorId?: string | null;
  pageId?: string | null;
  payload?: RunPayload;
  chain?: string[];
  threadId?: string | null;
  parentRunId?: string | null;
  status?: RunStatus;
  held?: boolean;
}

export function insertRun(n: NewRun): RunRow {
  const id = newId();
  db.prepare(`INSERT INTO agent_runs (id, agent_id, space_id, thread_id, kind, trigger_id, trigger_type, trigger_label, actor_id, page_id, status, held, created_time, payload, chain, parent_run_id)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, n.agent.id, n.agent.space_id, n.threadId ?? null, n.kind, n.trigger?.id ?? null, n.trigger?.type ?? (n.kind === 'manual' ? 'manual' : n.kind === 'chat' ? 'chat' : null),
      n.label.slice(0, 300), n.actorId ?? null, n.pageId ?? null, n.status ?? 'pending', n.held ? 1 : 0, Date.now(), JSON.stringify(n.payload ?? {}), JSON.stringify(n.chain ?? []), n.parentRunId ?? null);
  return getRun(id)!;
}

// ---------------------------------------------------------------- credits

/** credits of a run: weighted tokens (output and cache writes cost more, cache reads less) per 1,000. */
export function creditsFor(u: { input: number; output: number; cacheRead: number; cacheWrite: number }): number {
  const weighted = u.input + u.cacheWrite * 1.25 + u.cacheRead * 0.1 + u.output * 5;
  return weighted > 0 ? Math.max(1, Math.round(weighted / 1000)) : 0;
}

function monthStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function monthlyCredits(agentId: string, now = Date.now()): number {
  return Number((db.prepare('SELECT SUM(credits) AS c FROM agent_runs WHERE agent_id = ? AND created_time >= ?').get(agentId, monthStart(now)) as { c: number | null }).c ?? 0);
}

// ---------------------------------------------------------------- pausing

export function pauseAgent(agent: AgentRecord, reason: PausedReason, message?: string) {
  const cur = getAgent(agent.id) ?? agent;
  if (cur.status === 'paused' && cur.paused_reason === reason) return cur;
  const next = patchAgent(agent.id, { status: reason === 'disabled_by_admin' || reason === 'disabled_by_editor' || reason === 'orphaned' ? 'disabled' : 'paused', paused_reason: reason, paused_time: Date.now() });
  notifyOwners(cur, 'paused', message ?? '');
  return next;
}

function notifyOwners(agent: AgentRecord, kind: 'paused' | 'failed' | 'review', message: string, pageId?: string | null) {
  const owners = agentPeople(agent, 'editor', 50);
  for (const uid of owners) {
    pushNotification({
      user_id: uid, space_id: agent.space_id, type: 'automation' as NotificationRecord['type'], actor_id: agent.bot_id,
      ...(pageId ? { navigable_block_id: pageId } : agent.data.instructions_page_id ? { navigable_block_id: agent.data.instructions_page_id } : {}),
      activity: kind === 'paused'
        ? { kind: 'paused', agent_id: agent.id, automation_name: agent.data.name, ...(message ? { message } : {}) }
        : { kind: 'message', agent_id: agent.id, automation_name: agent.data.name, subject: kind === 'review' ? `${agent.data.name} is awaiting your review` : `${agent.data.name} run failed`, message },
    });
  }
}

// ---------------------------------------------------------------- queue

const MAX_CONCURRENT = () => Math.max(1, Number(process.env.NC_AGENT_CONCURRENCY) || 3);
const RUNS_PER_HOUR = () => Math.max(1, Number(process.env.NC_AGENT_RUNS_PER_HOUR) || 60);
const queue: string[] = [];
const active = new Map<string, { agentId: string; controller: AbortController; done: Promise<void> }>();
let testClient: ClaudeLike | undefined;
let pumpScheduled = false;

/** Tests inject the fake Claude client used by background runs. */
export function setAgentClient(client: ClaudeLike | undefined) {
  testClient = client;
}

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  setImmediate(() => {
    pumpScheduled = false;
    pump();
  });
}

function pump() {
  for (let i = 0; i < queue.length && active.size < MAX_CONCURRENT(); ) {
    const id = queue[i];
    const run = getRun(id);
    if (!run || run.status !== 'pending' || run.held) {
      queue.splice(i, 1);
      continue;
    }
    if ([...active.values()].some((a) => a.agentId === run.agentId)) {
      i++;
      continue;
    }
    queue.splice(i, 1);
    const controller = new AbortController();
    const done = executeRun(run.id, { signal: controller.signal }).then(() => undefined, (e) => console.error('[agents] run failed', run.id, e)).finally(() => {
      active.delete(run.id);
      schedulePump();
    });
    active.set(run.id, { agentId: run.agentId, controller, done });
  }
}

function enqueue(runId: string) {
  if (!queue.includes(runId)) queue.push(runId);
  schedulePump();
}

/** Wait until every queued / running background run is finished (tests, shutdown). */
export async function drainRuns(timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (!queue.length && !active.size && !pumpScheduled) return;
    if (Date.now() - t0 > timeoutMs) throw new Error('agent runs did not finish');
    if (active.size) await Promise.race([...active.values()].map((a) => a.done));
    else await new Promise((r) => setImmediate(r));
  }
}

/** Stop a running run (Activity "Stop", "Stop all runs"). */
export function stopRun(runId: string): boolean {
  const a = active.get(runId);
  if (a) {
    a.controller.abort();
    return true;
  }
  const run = getRun(runId);
  if (run && run.status === 'pending') {
    updateRun(runId, { status: 'stopped', ended_time: Date.now(), error: 'Stopped' });
    return true;
  }
  return false;
}

export function activeRunIds(agentId: string): string[] {
  return [...active.entries()].filter(([, a]) => a.agentId === agentId).map(([id]) => id);
}

/** Queue a background run (trigger, schedule, Run, sub-agent). Returns the run, which may be held while paused. */
export function enqueueRun(n: NewRun): RunRow {
  const agent = getAgent(n.agent.id) ?? n.agent;
  const triggered = n.kind === 'trigger';
  if (triggered) {
    const lastHour = Number((db.prepare("SELECT COUNT(*) AS c FROM agent_runs WHERE agent_id = ? AND kind = 'trigger' AND created_time > ?").get(agent.id, Date.now() - 3600_000) as { c: number }).c);
    if (lastHour >= RUNS_PER_HOUR() && agent.status === 'active') {
      pauseAgent(agent, 'run_limit', `We paused it after ${lastHour} runs to avoid unnecessary activity`);
    }
  }
  const fresh = getAgent(agent.id) ?? agent;
  const held = fresh.status !== 'active' && n.kind !== 'sub_agent';
  const run = insertRun({ ...n, agent: fresh, status: 'pending', held });
  if (!held) enqueue(run.id);
  return run;
}

/** Re-queue held runs after the agent is resumed / re-enabled. */
export function releaseHeldRuns(agentId: string): number {
  const ids = (db.prepare("SELECT id FROM agent_runs WHERE agent_id = ? AND status = 'pending' AND held = 1 ORDER BY created_time").all(agentId) as { id: string }[]).map((r) => r.id);
  for (const id of ids) {
    updateRun(id, { held: 0 });
    enqueue(id);
  }
  return ids.length;
}

export function heldRunCount(agentId: string): number {
  return Number((db.prepare("SELECT COUNT(*) AS c FROM agent_runs WHERE agent_id = ? AND status = 'pending' AND held = 1").get(agentId) as { c: number }).c);
}

// runs interrupted by a restart fail; pending ones are picked up again
setTimeout(() => {
  try {
    db.prepare("UPDATE agent_runs SET status = 'failed', error = 'Interrupted (the server restarted)', ended_time = ? WHERE status = 'running'").run(Date.now());
    for (const r of db.prepare("SELECT id FROM agent_runs WHERE status = 'pending' AND held = 0 ORDER BY created_time").all() as { id: string }[]) enqueue(r.id);
  } catch (e) {
    console.error('[agents] run recovery failed', e);
  }
}, 2000).unref?.();

// ---------------------------------------------------------------- execution

export interface ExecuteOptions {
  signal?: AbortSignal;
  client?: ClaudeLike;
  events?: TurnEvents;
}

export interface RunOutcome {
  run: RunRow;
  message: Message | null;
  text: string;
  status: RunStatus;
  error?: { code: string; message: string };
  threadId: string | null;
  title?: string;
}

function userName(id: string | null | undefined): string {
  if (!id) return '';
  const u = getRecord<UserRecord>('lit_user', id);
  return u?.name || u?.email || '';
}

function userTimeZone(userId: string | null | undefined): string | undefined {
  if (!userId) return undefined;
  const s = (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
  return typeof s.time_zone === 'string' && s.time_zone ? s.time_zone : undefined;
}

/** Instructions page Markdown read with the agent's own access (its page is readable to it). */
export function readInstructions(agent: AgentRecord, cfg: AgentConfig = agent.data): { markdown: string; truncated: boolean } {
  const id = cfg.instructions_page_id;
  const page = id ? getRecord('block', id) : undefined;
  if (!id || !page || (page as { alive?: boolean }).alive === false) return { markdown: '', truncated: false };
  const r = pageToMarkdown(id, mdSource(agent.bot_id), { maxChars: 30_000, includeTitle: false });
  return { markdown: r.markdown, truncated: r.truncated };
}

/** Why a run can't start (null = ok). Failing checks end the run with that message (Activity shows it). */
function preflight(agent: AgentRecord | undefined, run: RunRow): { status: RunStatus; error: string; code?: string; pause?: PausedReason } | null {
  if (isDemoMode()) return { status: 'failed', error: DEMO_MESSAGE, code: 'demo' };
  if (!agent || agent.alive === false) return { status: 'failed', error: 'This agent was moved to Trash.' };
  if (run.payload.blocked) return { status: 'failed', error: 'The run stopped because this agent cannot open a page or database it needs.' };
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  if (!agentsAvailable(space)) return { status: 'failed', error: 'Upgrade to Business to use this agent', code: 'plan' };
  if (agent.status === 'disabled') return { status: 'failed', error: agent.paused_reason === 'disabled_by_admin' ? 'A workspace owner has paused this agent' : 'This agent is currently paused' };
  if (agent.status === 'paused' && run.kind !== 'chat' && run.kind !== 'sub_agent') return { status: 'failed', error: 'This agent is paused' };
  if (!workspaceAiPolicy(agent.space_id).enabled) return { status: 'failed', error: 'Litpage AI is turned off in this workspace.' };
  if (!aiConfigured()) return { status: 'failed', error: NO_KEY_MESSAGE, code: 'no_key' };
  const orphan = orphanState(agent);
  if (orphan && Date.now() >= orphan.disableTime) return { status: 'failed', error: ORPHANED_MESSAGE, code: 'orphaned', pause: 'orphaned' };
  const access = editorAccessCheck(agent);
  if (!access.ok) return { status: 'failed', error: access.message ?? 'This agent can’t run right now.' };
  if (typeof agent.credit_limit === 'number' && agent.credit_limit >= 0 && monthlyCredits(agent.id) >= agent.credit_limit) {
    return { status: 'failed', error: 'This custom agent has used its monthly allowance. Request more credits to continue.', pause: 'credit_limit' };
  }
  return null;
}

/** Background run (queued): trigger / schedule / manual / sub-agent. */
export async function executeRun(runId: string, opts: ExecuteOptions = {}): Promise<RunOutcome> {
  const run = getRun(runId)!;
  const agent = getAgent(run.agentId);
  updateRun(runId, { status: 'running', started_time: Date.now() });
  const problem = preflight(agent, run);
  if (problem) {
    updateRun(runId, { status: problem.status, error: problem.error, ended_time: Date.now() });
    if (agent && problem.pause) pauseAgent(agent, problem.pause, problem.error);
    if (agent && run.kind === 'trigger') noteFailure(agent, problem.error, run.pageId);
    return { run: getRun(runId)!, message: null, text: '', status: problem.status, error: { code: problem.code ?? 'failed', message: problem.error }, threadId: run.threadId };
  }
  return runModel(agent!, run, { ...opts, client: opts.client ?? testClient, interactive: false });
}

export interface ChatPrep {
  agent: AgentRecord;
  run: RunRow;
  thread: Thread;
  userId: string;
  approvalMode: ApprovalMode;
  userMessage: Message;
}

/** Validate and record a chat turn with an agent (synchronous: errors become HTTP errors before the stream opens). */
export function prepareAgentChat(p: { userId: string; agentId: string; threadId?: string | null; text?: string; approvalMode?: string; pageId?: string | null; clientId?: string; model?: unknown }): ChatPrep {
  const agent = getAgent(p.agentId);
  if (!agent || agent.alive === false) throw new AiError('not_found', 'We couldn’t find that agent', 404);
  const role = agentRole(agent, p.userId);
  if (role === 'none') throw new AiError('forbidden', 'You don’t have permission to use this agent', 403);
  if (!agentsAvailable(getRecord<SpaceRecord>('space', agent.space_id))) throw new AiError('forbidden', 'Upgrade to Business to use this agent', 403);
  if (!workspaceAiPolicy(agent.space_id).enabled) throw new AiError('forbidden', 'Litpage AI is turned off in this workspace.', 403);
  if (!aiConfigured()) throw new AiError('no_key', NO_KEY_MESSAGE, 400);
  if (agent.status === 'disabled') throw new AiError('forbidden', 'Chat is unavailable while this agent is paused', 403);
  if (agent.status === 'paused' && agent.paused_reason === 'credit_limit') throw new AiError('forbidden', 'This custom agent has used its monthly allowance. Request more credits to continue.', 403);
  if (!agent.published && role === 'reader') throw new AiError('forbidden', 'Publish your agent before chatting with it.', 403);
  const access = editorAccessCheck(agent);
  if (!access.ok) throw new AiError('forbidden', access.message ?? 'This agent can’t run right now.', 403);
  const text = (p.text ?? '').trim();
  if (!text) throw new AiError('bad_request', 'Type a message to send.', 400);
  let thread: Thread | null = null;
  if (p.threadId) {
    thread = threadById(p.threadId);
    if (!thread || thread.agentId !== agent.id || thread.userId !== p.userId) throw new AiError('not_found', 'This chat doesn’t exist or was deleted.', 404);
  }
  if (!thread) thread = createThread(p.userId, agent.space_id, text.replace(/\s+/g, ' ').slice(0, 80), p.pageId ?? null, agent.id);
  // Advanced › Allow model override: a model picked in this chat's model menu stays with the chat (runModel uses it)
  if (typeof p.model === 'string' && /^[\w.-]{1,64}$/.test(p.model) && agent.data.allow_model_override !== false && p.model !== thread.model) {
    setThreadModel(thread.id, p.model);
    thread = { ...thread, model: p.model };
  }
  const prefs = userAiPrefs(p.userId);
  const approvalMode = effectiveApprovalMode(p.approvalMode ?? prefs.approvalMode, workspaceAiPolicy(agent.space_id));
  const run = insertRun({ agent, kind: 'chat', label: 'Chat', actorId: p.userId, pageId: p.pageId ?? null, payload: { text }, threadId: thread.id, status: 'running' });
  // a chat embedded in a page : the agent learns where it is, and reads the page only with its own access
  const facts: string[] = [];
  if (p.pageId && blockRole(p.pageId, p.userId) !== 'none') {
    facts.push(canRead(p.pageId, agent.bot_id)
      ? `This chat is embedded on the page “${blockLabel(p.pageId)}” (page_id: ${p.pageId}). Read it with read_page when the question is about it.`
      : 'This chat is embedded on a page you can’t open. If the question needs it, ask an editor to add the page under Tools and access.');
  }
  const userMessage = addMessage(thread.id, 'user', { text, pageId: p.pageId ?? null, meta: triggerBlock({ kind: 'chat', label: `Chat with ${userName(p.userId) || 'a teammate'}`, actorName: userName(p.userId), facts, timeZone: userTimeZone(p.userId) }) } as MessageData);
  updateRun(run.id, { started_time: Date.now() });
  return { agent, run: getRun(run.id)!, thread, userId: p.userId, approvalMode, userMessage };
}

export async function executeAgentChat(prep: ChatPrep, ev: TurnEvents = {}, signal?: AbortSignal, client?: ClaudeLike): Promise<RunOutcome> {
  return runModel(prep.agent, prep.run, { events: ev, signal, client: client ?? testClient, interactive: true, thread: prep.thread, approvalMode: prep.approvalMode, userId: prep.userId });
}

function noteFailure(agent: AgentRecord, error: string, pageId?: string | null) {
  // five failed triggered runs in a row pause the agent ("This agent was paused after repeated errors")
  const last = db.prepare("SELECT status FROM agent_runs WHERE agent_id = ? AND kind = 'trigger' AND status IN ('success', 'skipped', 'failed') ORDER BY created_time DESC LIMIT 5").all(agent.id) as { status: string }[];
  if (last.length >= 5 && last.every((r) => r.status === 'failed')) {
    pauseAgent(agent, 'failure_limit', 'Check the agent settings, then resume it to retry the failed runs');
    return;
  }
  const key = `agent-fail:${agent.id}`;
  const recent = db.prepare("SELECT 1 AS hit FROM agent_runs WHERE agent_id = ? AND status = 'failed' AND ended_time > ? AND kind = 'trigger' LIMIT 2").all(agent.id, Date.now() - 3600_000) as unknown[];
  // one failure notice an hour per agent
  if (recent.length <= 1 && !failNoticeAt.has(key)) {
    failNoticeAt.set(key, Date.now());
    setTimeout(() => failNoticeAt.delete(key), 3600_000).unref?.();
    notifyOwners(agent, 'failed', error, pageId);
  }
}
const failNoticeAt = new Map<string, number>();

interface ModelOptions extends ExecuteOptions {
  interactive: boolean;
  thread?: Thread;
  approvalMode?: ApprovalMode;
  /** the person chatting (interactive runs) */
  userId?: string;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function hostsIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/[^\s<>()"'\]]+/g)) {
    const h = hostOf(m[0]);
    if (h) out.add(h);
  }
  return [...out];
}

/** "Use a backup model": another model the agent may use while its own is unavailable (null = none). */
function backupModel(current: string, allowed: string[], fable: boolean): string | null {
  return offeredModels(fable).find((m) => m.id !== current && !m.adminEnable && (!allowed.length || allowed.includes(m.id)))?.id ?? null;
}

/** "Wait until available" retries of a run whose model is unavailable (overloaded): 4 tries, backing off. */
const OUTAGE_RETRIES = 3;
function outageDelayMs(): number {
  const v = Number(process.env.NC_AGENT_OUTAGE_RETRY_MS);
  return Number.isFinite(v) && v >= 0 ? v : 5000;
}

/** The model loop of one run (chat or background) as the agent's bot. Never throws. */
async function runModel(agent: AgentRecord, run: RunRow, opts: ModelOptions): Promise<RunOutcome> {
  const started = Date.now();
  const cfg = agent.data;
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  const policy = workspaceAiPolicy(agent.space_id);
  const actorId = opts.userId ?? run.actorId;
  const role = actorId ? agentRole(agent, actorId) : 'none';
  const canConfigure = opts.interactive && (role === 'editor' || role === 'read_and_write');
  const setup = opts.interactive && !agent.published && canConfigure;
  // ---- thread
  let thread = opts.thread ?? (run.threadId ? threadById(run.threadId) : null);
  if (!thread) {
    const page = run.pageId ? blockTitle(getRecord('block', run.pageId) as any) : '';
    thread = createThread(agent.bot_id, agent.space_id, `${run.triggerLabel}${page ? ` · ${page}` : ''}`.slice(0, 120), run.pageId, agent.id);
    updateRun(run.id, { thread_id: thread.id });
    const trig = cfg.triggers.find((t) => t.id === run.triggerId);
    addMessage(thread.id, 'user', {
      text: run.payload.text?.trim() || `Run for the trigger “${run.triggerLabel}”.`,
      pageId: run.pageId,
      meta: triggerBlock({ kind: run.kind, label: run.triggerLabel, facts: run.payload.facts, instructions: run.payload.instructions ?? trig?.instructions, actorName: userName(run.actorId), timeZone: userTimeZone(run.actorId) ?? userTimeZone(agent.created_by_id) }),
    } as MessageData);
  }
  const messages = listMessages(thread.id);
  const turnId = newId();
  // ---- model: the agent's own, or the model picked for this chat when the agent allows it (Advanced › Allow model
  // override); the workspace's allowed models for Custom Agents apply either way
  const mp = agentModelPolicy(space);
  const wanted = run.kind === 'chat' && cfg.allow_model_override !== false && thread.model ? thread.model : cfg.model;
  const choice = mp.allowed.length && wanted !== 'auto' && !mp.allowed.includes(wanted) ? mp.defaultModel : wanted;
  const { model } = resolveModel(choice, mp.allowed.length ? mp.allowed : policy.allowedModels, { fableEnabled: mp.fable || policy.fable });
  const effort = autoEffort('chat', run.payload.text ?? '');
  // ---- tools
  const webOn = cfg.web_access && policy.webSearch;
  const instructions = readInstructions(agent, cfg);
  const promptText = [instructions.markdown, run.payload.text ?? '', ...(run.payload.facts ?? []), run.payload.instructions ?? ''].join('\n');
  const allowedHosts = new Set<string>([...(policy.webConfirm ? [] : cfg.trusted_urls ?? []), ...hostsIn(promptText), ...(run.payload.allowedHosts ?? [])]);
  const allowAll = !!cfg.allow_all_urls && !policy.webConfirm;
  const mcp = agentMcpTools(agent, cfg);
  const names = agentToolNames(cfg, { canConfigure, web: webOn });
  const subAgents = cfg.sub_agents.map((id) => getAgent(id)).filter((a): a is AgentRecord => !!a && a.alive !== false && a.space_id === agent.space_id)
    .map((a) => ({ id: a.id, name: a.data.name, description: a.data.description }));
  const history: StoredMessage[] = messages.map((m) => ({ role: m.role, text: m.data.text, contexts: m.data.contexts, status: m.data.status === 'stopped' ? 'stopped' : undefined, meta: m.data.meta }));
  const req = buildChatRequest(history, null, { tools: [...toolParams(names), ...mcp.defs.map((d) => ({ ...d, eager_input_streaming: true }) as any)], effort });
  req.system = agentSystem({
    name: cfg.name, description: cfg.description, instructions: instructions.markdown, instructionsTruncated: instructions.truncated, instructionsPageId: cfg.instructions_page_id,
    workspaceName: space?.name, subAgents, canConfigure, setup, trustedHosts: webOn ? (allowAll ? ['*'] : [...allowedHosts]) : undefined,
  });
  req.model = model;
  req.fallback = capabilities(model).fallback;
  // Model › Fallback behavior when the model has an outage (below): "Use a backup model" runs on another allowed model,
  // "Wait until available" retries with backoff, "Fail in case of outage" fails the run
  const fallbackMode = cfg.fallback ?? 'auto';
  const allowedModels = mp.allowed.length ? mp.allowed : policy.allowedModels;
  const buildWeb = () => {
    if (!webOn) return [];
    const defs = webToolDefs(model, { fetch: true });
    return defs.map((d) => {
      if (d.name === 'web_search' && cfg.web_domains?.length) return { ...d, allowed_domains: cfg.web_domains };
      if (d.name === 'web_fetch' && !allowAll) return allowedHosts.size ? { ...d, allowed_domains: [...allowedHosts] } : null;
      return d;
    }).filter((d): d is Record<string, unknown> => !!d);
  };
  req.serverTools = buildWeb();
  if (!req.serverTools.length) delete req.serverTools;

  // ---- environment (the agent's bot acts; steps and approvals as in Agent)
  const steps = new Map<string, StoredStep>();
  const ev = opts.events ?? {};
  const emitStep = (s: StepEvent) => {
    const prev = steps.get(s.id);
    const next: StoredStep = { ...(prev ?? {}), ...s } as StoredStep;
    if (s.status !== 'waiting') delete next.approval;
    steps.set(s.id, next);
    ev.step?.(s);
  };
  const sources = new Map<string, SourceRef>();
  let nextN = 1;
  const cite = (ref: StepRef): number => {
    const key = ref.url ? `url:${ref.url}` : `page:${ref.pageId}`;
    const hit = sources.get(key);
    if (hit) return hit.n;
    const r: SourceRef = { n: nextN++, pageId: ref.pageId ?? '', title: ref.title, ...(ref.url ? { url: ref.url } : {}), ...(ref.blockId ? { blockId: ref.blockId } : {}) };
    sources.set(key, r);
    ev.sources?.([...sources.values()]);
    return r.n;
  };
  const touched: TouchedPage[] = [];
  const toolsUsed = new Set<string>();
  const approvalMode: ApprovalMode = opts.interactive ? (cfg.skip_approvals && policy.skipApprovals ? 'skip_all' : opts.approvalMode ?? 'review_for_me') : 'skip_all';
  const env: AgentEnv = {
    userId: agent.bot_id,
    spaceId: agent.space_id,
    threadId: thread.id,
    turnId,
    currentPageId: run.pageId,
    approvalMode,
    memories: false,
    source: `agent:${run.id}`,
    cite,
    step: emitStep,
    touched: (pages) => {
      touched.push(...pages);
      ev.changes?.({ turnId, pages: touched });
    },
    approve: async (r: ApprovalRequest) => {
      if (!opts.interactive) return 'accept';
      const needs = r.risk === 'plan' || approvalMode === 'always_ask' || (approvalMode === 'review_for_me' && (r.risk === 'destructive' || r.risk === 'share')) || r.tool === 'mcp' || r.tool === 'request_url_access';
      if (!needs || !actorId) return 'accept';
      const wait = waitForApproval(actorId, thread!.id, opts.signal);
      const cur = steps.get(r.stepId);
      emitStep({ id: r.stepId, tool: r.tool, status: 'waiting', label: 'Awaiting your approval', detail: cur?.detail, refs: cur?.refs, approval: { id: wait.id, ...r.payload } });
      return wait.decision;
    },
  };
  const ctx: RunToolContext = {
    agent, runId: run.id, kind: run.kind, interactive: opts.interactive, actorId: actorId ?? null, canConfigure, chain: run.chain, allowedHosts, allowAllUrls: allowAll,
    mcp: mcp.map, approvedCalls: new Set(run.payload.approvedCalls ?? []), review: null, notificationsSent: 0,
    callSubAgent: (id, task) => runSubAgent(agent, run, id, task, opts),
    onHostsChanged: () => {
      req.serverTools = buildWeb();
    },
  };
  const allowed = new Set(names);
  const executeTool = async (name: string, input: Record<string, unknown>, id: string) => {
    toolsUsed.add(name.startsWith('mcp_') ? 'mcp' : name);
    const own = await runAgentTool(ctx, env, name, input as Record<string, any>, id);
    if (own) return own;
    return runTool(env, name, input, id, allowed);
  };

  // ---- run
  let result: RunResult | null = null;
  let error: AiError | null = null;
  for (let attempt = 0; ; attempt++) {
    try {
      result = await runStream(req, {
        onThinking: () => ev.status?.({ phase: 'thinking' }),
        onText: (d) => ev.text?.(d),
        cite: (c) => cite({ url: c.url, title: c.title }),
        onServerTool: (e) => {
          const q = typeof e.input.query === 'string' ? e.input.query : '';
          const url = typeof e.input.url === 'string' ? e.input.url : '';
          toolsUsed.add(e.name);
          emitStep({ id: e.id, tool: e.name, status: 'running', label: e.name === 'web_search' ? 'Searching' : 'Viewing', detail: q || hostOf(url) || url });
        },
        onServerResult: (e) => {
          const refs = e.results.slice(0, 10).map((r) => ({ url: r.url, title: r.title }));
          const name = e.type === 'web_fetch_tool_result' ? 'web_fetch' : 'web_search';
          if (e.error) emitStep({ id: e.toolUseId, tool: name, status: 'error', label: name === 'web_fetch' ? 'Viewing' : 'Searching', error: e.error });
          else emitStep({ id: e.toolUseId, tool: name, status: 'done', label: name === 'web_fetch' ? `Viewed ${hostOf(refs[0]?.url ?? '') ?? ''}` : 'Searched', refs });
        },
      }, { signal: opts.signal, executeTool, client: opts.client, maxToolRounds: 24 });
      break;
    } catch (e) {
      const err = mapError(e);
      // the model is unavailable and the run hasn't done anything yet: the agent's fallback behavior decides
      const outage = err.code === 'overloaded' && !steps.size && !touched.length && !opts.signal?.aborted;
      if (outage && fallbackMode === 'wait' && attempt < OUTAGE_RETRIES) {
        await new Promise((r) => setTimeout(r, outageDelayMs() * 2 ** attempt));
        continue;
      }
      const backup: string | null = outage && fallbackMode === 'auto' && req.model === model ? backupModel(model, allowedModels, mp.fable || policy.fable) : null;
      if (backup) {
        req.model = backup;
        req.fallback = capabilities(backup).fallback;
        continue;
      }
      error = err;
      logAiError('agent', e);
      break;
    }
  }
  // ---- persist the answer
  const changed = !!turnChanges(turnId);
  const stepList = [...steps.values()].map((s) => (s.status === 'running' || (s.status === 'waiting' && !ctx.review) ? { ...s, status: 'error', error: s.error ?? 'Stopped' } : s));
  const text = result?.text ?? '';
  let status: RunStatus;
  if (error) status = error.code === 'aborted' ? 'stopped' : 'failed';
  else if (result!.refused) status = 'failed';
  else if (result!.aborted) status = 'stopped';
  else if (ctx.review) status = 'needs_review';
  else if (run.kind !== 'chat' && !changed && isNoAction(text)) status = 'skipped';
  else status = 'success';
  const data: MessageData = error
    ? { text: '', status: 'error', error: { code: error.code, message: error.message }, steps: stepList.length ? stepList : undefined, changed: changed || undefined, sources: [...sources.values()] } as MessageData
    : result!.refused
      ? { text: '', status: 'refused', error: { code: 'refusal', message: 'Litpage AI can’t help with that request.' }, steps: stepList.length ? stepList : undefined } as MessageData
      : { text, status: result!.aborted ? 'stopped' : 'complete', sources: [...sources.values()], model: result!.model, steps: stepList.length ? stepList : undefined, changed: changed || undefined } as MessageData;
  const message = addMessage(thread.id, 'assistant', data, turnId);
  if (opts.interactive) markRead(thread.id);
  if (thread.autoTitle && run.kind === 'chat' && messages.filter((m) => m.role === 'user').length === 1 && text) setAutoTitle(thread.id, (run.payload.text ?? '').replace(/\s+/g, ' ').slice(0, 80));
  const usage = result?.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const credits = creditsFor(usage);
  updateRun(run.id, {
    status, error: error?.message ?? (result?.refused ? 'Litpage AI can’t help with that request.' : status === 'stopped' ? 'Stopped' : null), ended_time: Date.now(), model: result?.model ?? model,
    input_tokens: usage.input + usage.cacheRead + usage.cacheWrite, output_tokens: usage.output, credits, tools: [...toolsUsed], changes: touched.length,
    result: (text || '').slice(0, 4000), review: ctx.review,
  });
  if (process.env.NC_AI_DEBUG) console.log(`[agents] run ${run.id} ${status} ${describeUsage(usage)} ${Date.now() - started}ms`);
  // audit log: run activity, when, what changed, who set it off
  if (run.kind !== 'chat' || touched.length) {
    audit(status === 'failed' ? 'custom_agent_run_failed' : 'custom_agent_run_completed', {
      spaceId: agent.space_id, actorId: agent.bot_id, targetId: agent.id,
      data: { agent_name: cfg.name, trigger: run.triggerLabel, status, changes: touched.slice(0, 20).map((p) => `${p.action} ${p.title}`), triggered_by: run.actorId, triggered_by_name: userName(run.actorId) },
    });
  }
  const fresh = getAgent(agent.id) ?? agent;
  patchAgent(agent.id, { last_run_time: Date.now() });
  if (status === 'failed' && run.kind === 'trigger') noteFailure(fresh, error?.message ?? 'The run failed', run.pageId);
  if (status === 'needs_review' && ctx.review) notifyOwners(fresh, 'review', `${ctx.review.label}. Open the agent’s Activity to allow or deny it.`, run.pageId);
  return {
    run: getRun(run.id)!, message, text, status, threadId: thread.id,
    ...(error ? { error: { code: error.code, message: error.message } } : result?.refused ? { error: { code: 'refusal', message: 'Litpage AI can’t help with that request.' } } : {}),
  };
}

/** call_agent: a nested run of another agent (its own access, instructions, model) — returns its answer. */
async function runSubAgent(caller: AgentRecord, parent: RunRow, agentId: string, task: string, opts: ModelOptions): Promise<string> {
  const sub = getAgent(agentId);
  if (!sub) return 'That agent no longer exists.';
  const run = insertRun({
    agent: sub, kind: 'sub_agent', label: `Called by ${caller.data.name}`, actorId: parent.actorId, pageId: parent.pageId, payload: { text: task, facts: [`Requested by the agent “${caller.data.name}”.`] },
    chain: [...parent.chain, caller.id], parentRunId: parent.id, status: 'running',
  });
  const problem = preflight(sub, run);
  if (problem) {
    updateRun(run.id, { status: problem.status, error: problem.error, ended_time: Date.now() });
    return `The agent couldn’t run: ${problem.error}`;
  }
  updateRun(run.id, { started_time: Date.now() });
  const out = await runModel(sub, getRun(run.id)!, { client: opts.client, signal: opts.signal, interactive: false });
  if (out.status === 'failed') return `The agent failed: ${out.error?.message ?? out.run.error ?? 'unknown error'}`;
  return out.text;
}

// ---------------------------------------------------------------- Activity / Insights queries

export interface RunListFilter {
  status?: 'all' | 'failed' | 'success' | 'in_progress' | 'pending' | 'needs_review';
  /** only this person's chats (people without Full access see their own chats + the agent's runs when shared) */
  userId?: string;
  kinds?: RunKind[];
  since?: number;
  until?: number;
  limit?: number;
  before?: number;
}

export function listRuns(agentId: string, f: RunListFilter = {}): RunRow[] {
  const where = ['agent_id = ?'];
  const args: unknown[] = [agentId];
  if (f.status === 'failed') where.push("status = 'failed'");
  else if (f.status === 'success') where.push("status IN ('success', 'skipped')");
  else if (f.status === 'in_progress') where.push("status = 'running'");
  else if (f.status === 'pending') where.push("status = 'pending'");
  else if (f.status === 'needs_review') where.push("status = 'needs_review'");
  if (f.userId) {
    where.push("(kind != 'chat' OR actor_id = ?)");
    args.push(f.userId);
  }
  if (f.kinds?.length) {
    where.push(`kind IN (${f.kinds.map(() => '?').join(',')})`);
    args.push(...f.kinds);
  }
  if (f.since) {
    where.push('created_time >= ?');
    args.push(f.since);
  }
  if (f.until) {
    where.push('created_time < ?');
    args.push(f.until);
  }
  if (f.before) {
    where.push('created_time < ?');
    args.push(f.before);
  }
  const limit = Math.max(1, Math.min(500, f.limit ?? 50));
  return (db.prepare(`SELECT * FROM agent_runs WHERE ${where.join(' AND ')} ORDER BY created_time DESC LIMIT ${limit}`).all(...(args as any[])) as any[]).map(toRun);
}

export function setRunFeedback(runId: string, userId: string, rating: 'positive' | 'negative' | null, comment?: string) {
  updateRun(runId, { feedback: rating ? { rating, ...(comment ? { comment: comment.slice(0, 2000) } : {}), userId, time: Date.now() } : null });
}

export function setRunReview(runId: string, review: RunRow['review']) {
  updateRun(runId, { review });
}

export function setRunStatus(runId: string, status: RunStatus, error?: string | null) {
  updateRun(runId, { status, ...(error !== undefined ? { error } : {}), ended_time: Date.now() });
}

export interface Insights {
  totalRuns: number;
  byStatus: Record<string, number>;
  byTrigger: { label: string; count: number }[];
  totalCredits: number;
  avgCredits: number;
  activeUsers: number;
  completionRate: number;
  days: { day: string; runs: number; credits: number; failed: number; success: number; users: number }[];
}

export function insights(agentId: string, since: number, until = Date.now()): Insights {
  const rows = (db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? AND created_time >= ? AND created_time < ? ORDER BY created_time').all(agentId, since, until) as any[]).map(toRun);
  const byStatus: Record<string, number> = {};
  const byTrigger = new Map<string, number>();
  const users = new Set<string>();
  const days = new Map<string, { day: string; runs: number; credits: number; failed: number; success: number; users: Set<string> }>();
  for (let t = since; t < until; t += 86_400_000) {
    const day = new Date(t).toISOString().slice(0, 10);
    days.set(day, { day, runs: 0, credits: 0, failed: 0, success: 0, users: new Set() });
  }
  let credits = 0;
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    const label = r.kind === 'chat' ? 'Chat' : r.kind === 'manual' ? 'Manual' : r.kind === 'sub_agent' ? 'Agent' : r.triggerLabel || 'Trigger';
    byTrigger.set(label, (byTrigger.get(label) ?? 0) + 1);
    if (r.actorId) users.add(r.actorId);
    credits += r.credits;
    const day = new Date(r.createdTime).toISOString().slice(0, 10);
    const d = days.get(day) ?? { day, runs: 0, credits: 0, failed: 0, success: 0, users: new Set<string>() };
    d.runs++;
    d.credits += r.credits;
    if (r.status === 'failed') d.failed++;
    if (r.status === 'success' || r.status === 'skipped') d.success++;
    if (r.actorId) d.users.add(r.actorId);
    days.set(day, d);
  }
  const completed = rows.filter((r) => ['success', 'skipped', 'failed'].includes(r.status));
  return {
    totalRuns: rows.length,
    byStatus,
    byTrigger: [...byTrigger.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    totalCredits: Math.round(credits),
    avgCredits: rows.length ? Math.round((credits / rows.length) * 10) / 10 : 0,
    activeUsers: users.size,
    completionRate: completed.length ? Math.round((completed.filter((r) => r.status !== 'failed').length / completed.length) * 1000) / 10 : 0,
    days: [...days.values()].sort((a, b) => a.day.localeCompare(b.day)).map((d) => ({ day: d.day, runs: d.runs, credits: Math.round(d.credits), failed: d.failed, success: d.success, users: d.users.size })),
  };
}

/** Settings › Analytics › AI › Custom Agents: runs, chats, people and credits of every agent in a period. */
export function spaceAgentUsage(spaceId: string, since: number): Map<string, { runs: number; chats: number; failed: number; credits: number; users: Set<string> }> {
  const rows = db.prepare('SELECT agent_id, kind, status, actor_id, credits FROM agent_runs WHERE space_id = ? AND created_time >= ?').all(spaceId, since) as { agent_id: string; kind: string; status: string; actor_id: string | null; credits: number }[];
  const out = new Map<string, { runs: number; chats: number; failed: number; credits: number; users: Set<string> }>();
  for (const r of rows) {
    const u = out.get(r.agent_id) ?? { runs: 0, chats: 0, failed: 0, credits: 0, users: new Set<string>() };
    if (r.kind === 'chat') u.chats++;
    else u.runs++;
    if (r.status === 'failed') u.failed++;
    u.credits += r.credits || 0;
    if (r.actor_id) u.users.add(r.actor_id);
    out.set(r.agent_id, u);
  }
  return out;
}

/** All chats of a period as CSV rows (Insights › Export CSV: most recent 300). */
export function runsCsv(agentId: string, since: number, until = Date.now()): string {
  const rows = (db.prepare('SELECT * FROM agent_runs WHERE agent_id = ? AND created_time >= ? AND created_time < ? ORDER BY created_time DESC LIMIT 300').all(agentId, since, until) as any[]).map(toRun);
  const esc = (v: unknown) => {
    let s = String(v ?? '');
    // spreadsheet formula injection: a cell starting with = + - @ (or tab / CR) stays text in Excel / Sheets
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['Title', 'Status', 'Trigger', 'Users', 'Credits', 'Runs', 'Created', 'Last updated', 'Models', 'Tools used', 'Error'];
  const lines = [header.join(',')];
  for (const r of rows) {
    const title = r.kind === 'chat' ? (r.payload.text ?? '').slice(0, 120) : r.triggerLabel;
    lines.push([
      title, r.status, r.kind === 'chat' ? 'Chat' : r.triggerLabel, userName(r.actorId), r.credits, 1, new Date(r.createdTime).toISOString(), new Date(r.endedTime ?? r.createdTime).toISOString(), r.model ?? '', r.tools.join(' '), r.error ?? '',
    ].map(esc).join(','));
  }
  return lines.join('\n');
}

export { callKey };

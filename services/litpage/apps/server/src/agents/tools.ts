// Tools available only to Custom Agents, in addition to the standard AI tools:
//   call_agent            hand work to another agent  and use what it returns
//   send_notification     Inbox notification to workspace members ("{agent} sent you a message")
//   request_url_access    ask before opening a web page that wasn't in the request 
//   update_agent_settings change the agent's own settings as a draft (setup chat, instruction iteration — )
//   mcp_*                 the agent's MCP connections, called client-side so "Always ask" can stop a write 
//   read_agent_history    the agent's earlier chats and runs — everyone's with Advanced › "Share chat history across
//                         users" on, else only those of the person it is working for 
// Executors get a RunToolContext with the run (agent, who is chatting, interactive or not) next to the AgentEnv.
import { newId } from '@nc/shared/ids.ts';
import type { NotificationRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import {
  cleanConfig, cleanTrigger, GRANT_ROLES, triggerRowTitle, type AgentConfig, type AgentRecord, type AgentTrigger, type GrantRole, type McpToolMode, type RunKind,
} from '@nc/shared/agents.ts';
import { db, getRecord } from '../db.ts';
import { pushNotification } from '../notify.ts';
import { hit } from '../ratelimit.ts';
import { AiError } from '../ai/client.ts';
import { canRead, searchPages } from '../ai/context.ts';
import { normalizeId, resolvePeople } from '../ai/edit.ts';
import { callMcpTool, connectionTools, type McpTool } from '../ai/mcp.ts';
import { registerDynamicTools, registerToolDefs, type ToolDef } from '../ai/tools/defs.ts';
import { runTool } from '../ai/tools/registry.ts';
import type { AgentEnv, ToolOutput } from '../ai/tools/types.ts';
import { blockLabel, grantProblem } from './access.ts';
import { agentRole, getAgent, patchAgent, workingConfig } from './model.ts';

const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: 'string', description, ...extra });

export const AGENT_TOOL_DEFS: ToolDef[] = [
  {
    name: 'call_agent',
    access: 'write',
    description: 'Hand a task to another custom agent you can reach (listed in your instructions context) and receive its answer. Include everything it needs in `task`; it works with its own access and instructions.',
    input_schema: { type: 'object', properties: { agent_id: str('The agent id.'), task: str('What the agent should do and what to return.') }, required: ['agent_id', 'task'], additionalProperties: false },
  },
  {
    name: 'send_notification',
    access: 'write',
    description: 'Send an Inbox notification to people in the workspace ("<your name> sent you a message"). Use it to report results or ask someone to act. People can be user ids, names or emails.',
    input_schema: {
      type: 'object',
      properties: {
        people: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20, description: 'User ids, names or emails.' },
        message: str('The message (plain text, up to 2000 characters).'),
        page_id: str('A page the notification links to (you must be able to open it).'),
      },
      required: ['people', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_agent_history',
    access: 'read',
    description: 'Read your earlier conversations and runs, newest first: what people asked you (or what triggered you) and what you answered. Use it to recall earlier work. Unless your chat history is shared across users, you only see conversations with the person you are working for now.',
    input_schema: { type: 'object', properties: { query: str('Only entries containing these words.'), limit: { type: 'integer', minimum: 1, maximum: 20 } }, additionalProperties: false },
  },
  {
    name: 'request_url_access',
    access: 'write',
    description: 'Ask for permission to open a web page whose address was not in the request or your instructions. Call it before opening such a URL; continue only when it is allowed.',
    input_schema: { type: 'object', properties: { url: str('The URL to open.'), reason: str('Why you need it.') }, required: ['url'], additionalProperties: false },
  },
  {
    name: 'update_agent_settings',
    access: 'write',
    description: 'Change your own settings as a draft the person chatting with you reviews and saves: name, description, icon, instructions (Markdown — replaces your instructions page), triggers, model, web access, and access to Litpage pages / databases.',
    input_schema: {
      type: 'object',
      properties: {
        name: str('Your new name.'),
        description: str('One sentence: what you do.'),
        icon: str('An emoji icon.'),
        instructions: str('Your full instructions as Markdown (replaces the current ones).'),
        add_triggers: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['schedule', 'page_added', 'property_updated', 'page_removed', 'comment_added', 'mentioned'] },
              frequency: { type: 'string', enum: ['hour', 'day', 'week', 'month', 'year'], description: 'schedule: how often.' },
              interval: { type: 'integer', minimum: 1, maximum: 100 },
              weekdays: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'schedule (week): 0 = Sunday … 6 = Saturday.' },
              time: str('schedule: HH:MM (24h).'),
              database_id: str('Database to watch (page_added / property_updated / page_removed).'),
              page_id: str('Page to watch (comment_added).'),
              instructions: str('Extra instructions for runs of this trigger.'),
            },
            required: ['type'],
            additionalProperties: false,
          },
        },
        remove_triggers: { type: 'array', items: { type: 'string' }, maxItems: 20, description: 'Trigger ids to remove.' },
        model: str('"auto" or a model id.'),
        web_access: { type: 'boolean' },
        grant_access: {
          type: 'array',
          maxItems: 20,
          items: {
            type: 'object',
            properties: { page: str('A page / database id, or its title to search for.'), role: { type: 'string', enum: ['reader', 'comment_only', 'read_and_write', 'editor'] } },
            required: ['page'],
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
  },
];
registerToolDefs(AGENT_TOOL_DEFS);
registerDynamicTools((name) => /^mcp_[0-9a-f]{8}_/.test(name));

// ---------------------------------------------------------------- run context

export interface PendingReview {
  kind: 'url' | 'tool';
  url?: string;
  host?: string;
  connectionId?: string;
  tool?: string;
  input?: Record<string, unknown>;
  reason?: string;
  label: string;
}

export interface RunToolContext {
  agent: AgentRecord;
  runId: string;
  kind: RunKind;
  /** a person is watching (chat): approvals are asked in the chat */
  interactive: boolean;
  /** who chats with / started the agent */
  actorId: string | null;
  /** the person may change the agent's settings (Can edit / Full access) */
  canConfigure: boolean;
  /** agents up the call chain (loop guard) */
  chain: string[];
  /** web hosts the run may open (mutated when a URL is approved in chat) */
  allowedHosts: Set<string>;
  allowAllUrls: boolean;
  /** generated MCP tool name → connection + tool */
  mcp: Map<string, { connectionId: string; connectionName: string; tool: McpTool; mode: McpToolMode }>;
  /** calls already approved for this run (re-runs after "Allow") */
  approvedCalls: Set<string>;
  /** a triggered run hit something that needs a person: the run ends as "Needs review" */
  review: PendingReview | null;
  notificationsSent: number;
  /** run a sub-agent and return its final text */
  callSubAgent: (agentId: string, task: string) => Promise<string>;
  /** web fetch allowlist changed (rebuild the server tool) */
  onHostsChanged?: () => void;
}

export function callKey(connectionId: string, tool: string, input: unknown): string {
  return `${connectionId}:${tool}:${JSON.stringify(input ?? {})}`;
}

// ---------------------------------------------------------------- MCP tools of an agent

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** The agent's MCP tools as client tool definitions (enabled connections, enabled tools). */
export function agentMcpTools(agent: AgentRecord, cfg: AgentConfig): { defs: { name: string; description: string; input_schema: Record<string, unknown> }[]; map: RunToolContext['mcp'] } {
  const map: RunToolContext['mcp'] = new Map();
  const defs: { name: string; description: string; input_schema: Record<string, unknown> }[] = [];
  for (const c of connectionTools(agent.bot_id, agent.space_id)) {
    if (!c.enabled) continue;
    const modes = cfg.mcp_tool_modes?.[c.id] ?? {};
    for (const t of c.tools) {
      if (c.disabledTools.includes(t.name)) continue;
      const name = `mcp_${c.id.replace(/-/g, '').slice(0, 8)}_${slug(t.name)}`.slice(0, 64);
      if (map.has(name)) continue;
      const mode: McpToolMode = modes[t.name] ?? (t.readOnly ? 'auto' : 'ask');
      map.set(name, { connectionId: c.id, connectionName: c.name, tool: t, mode });
      const schema = t.inputSchema && (t.inputSchema as { type?: string }).type === 'object' ? t.inputSchema : { type: 'object', properties: {} };
      defs.push({ name, description: `${c.name} › ${t.name}${t.description ? `: ${t.description}` : ''}`.slice(0, 1000), input_schema: schema });
    }
  }
  return { defs, map };
}

// ---------------------------------------------------------------- executors

function trim(s: unknown, n: number): string {
  return typeof s === 'string' ? s.trim().slice(0, n) : '';
}

async function callAgent(ctx: RunToolContext, env: AgentEnv, input: Record<string, any>, stepId: string): Promise<ToolOutput> {
  const id = normalizeId(input.agent_id);
  const cfg = ctx.agent.data;
  const sub = getAgent(id);
  if (!sub || sub.alive === false || !cfg.sub_agents.includes(id) || sub.space_id !== ctx.agent.space_id) return { content: 'That agent isn’t connected to you. Use one of the agents listed in your instructions.', isError: true };
  if (ctx.chain.includes(id) || id === ctx.agent.id) return { content: 'That agent is already working on this task (it called you), so it can’t be called again.', isError: true };
  if (ctx.chain.length >= 3) return { content: 'Too many agents are already involved in this task; finish it yourself.', isError: true };
  env.step({ id: stepId, tool: 'call_agent', status: 'running', label: 'Asking agent', detail: sub.data.name });
  const text = await ctx.callSubAgent(id, String(input.task).slice(0, 20_000));
  env.step({ id: stepId, tool: 'call_agent', status: 'done', label: 'Asked agent', detail: sub.data.name });
  return { content: `${sub.data.name} answered:\n\n${text || '(no answer)'}` };
}

async function sendNotification(ctx: RunToolContext, env: AgentEnv, input: Record<string, any>, stepId: string): Promise<ToolOutput> {
  const message = trim(input.message, 2000);
  if (!message) return { content: 'The message is empty.', isError: true };
  if (ctx.notificationsSent >= 20 || !hit(`agent-notify:${ctx.agent.id}`, 200, 3600_000)) return { content: 'Too many notifications sent. Try again later.', isError: true };
  const pageId = input.page_id ? normalizeId(input.page_id) : '';
  if (pageId && !canRead(pageId, env.userId)) return { content: 'You can’t open that page, so it can’t be linked.', isError: true };
  const space = getRecord<SpaceRecord>('space', ctx.agent.space_id);
  const raw = (input.people as string[]).map(String);
  const { ids, unknown } = resolvePeople(ctx.agent.space_id, raw);
  const members = new Set((space?.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => p.user_id!));
  const targets = [...new Set(ids)].filter((u) => members.has(u));
  if (!targets.length) return { content: `No workspace members matched ${unknown.join(', ') || 'those people'}.`, isError: true };
  env.step({ id: stepId, tool: 'send_notification', status: 'running', label: 'Sending an update', detail: `${targets.length} ${targets.length === 1 ? 'person' : 'people'}` });
  let sent = 0;
  for (const uid of targets) {
    // a linked page only for people who can open it
    const link = pageId && canRead(pageId, uid) ? pageId : undefined;
    pushNotification({
      user_id: uid, space_id: ctx.agent.space_id, type: 'automation' as NotificationRecord['type'], actor_id: ctx.agent.bot_id, ...(link ? { navigable_block_id: link } : {}),
      activity: { kind: 'message', agent_id: ctx.agent.id, automation_name: ctx.agent.data.name, message, ...(link ? { page_id: link } : {}) },
    });
    sent++;
  }
  ctx.notificationsSent += sent;
  env.step({ id: stepId, tool: 'send_notification', status: 'done', label: 'Update sent', detail: `${sent} ${sent === 1 ? 'person' : 'people'}` });
  return { content: `Notified ${sent} ${sent === 1 ? 'person' : 'people'}.${unknown.length ? ` Not found: ${unknown.join(', ')}.` : ''}` };
}

function hostOf(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

async function requestUrlAccess(ctx: RunToolContext, env: AgentEnv, input: Record<string, any>, stepId: string): Promise<ToolOutput> {
  const url = trim(input.url, 2000);
  const host = hostOf(url);
  if (!host) return { content: 'That isn’t a web address.', isError: true };
  if (ctx.allowAllUrls || ctx.allowedHosts.has(host)) return { content: `You may open ${host}.` };
  const reason = trim(input.reason, 500);
  if (!ctx.interactive) {
    ctx.review = { kind: 'url', url, host, reason, label: `Open ${host}` };
    env.step({ id: stepId, tool: 'request_url_access', status: 'waiting', label: 'Awaiting your approval', detail: host });
    return { content: `Opening ${host} needs approval, and nobody is here to give it now. Stop working on anything that needs this page, finish what you can, and end your reply by saying you are waiting for approval to open ${url}.` };
  }
  const decision = await env.approve({ tool: 'request_url_access', stepId, risk: 'share', payload: { title: `Allow ${ctx.agent.data.name} to open ${host}?`, description: reason || url, confirmLabel: 'Allow', danger: false } });
  if (decision !== 'accept') {
    env.step({ id: stepId, tool: 'request_url_access', status: 'declined', label: 'Open web page', detail: host });
    return { content: `Opening ${host} was not allowed. Don't open it.` };
  }
  ctx.allowedHosts.add(host);
  ctx.onHostsChanged?.();
  env.step({ id: stepId, tool: 'request_url_access', status: 'done', label: 'Allowed', detail: host });
  return { content: `You may open ${url} now.` };
}

async function mcpTool(ctx: RunToolContext, env: AgentEnv, name: string, input: Record<string, any>, stepId: string): Promise<ToolOutput> {
  const m = ctx.mcp.get(name);
  if (!m) return { content: `The tool ${name} isn’t available.`, isError: true };
  const label = `${m.connectionName}: ${m.tool.name}`;
  const inputText = JSON.stringify(input ?? {}, null, 2).slice(0, 4000);
  env.step({ id: stepId, tool: 'mcp', status: 'running', label: 'Running tool', detail: label, mcp: { server: m.connectionName, tool: m.tool.name, input: inputText } });
  const key = callKey(m.connectionId, m.tool.name, input);
  if (m.mode === 'ask' && !ctx.approvedCalls.has(key)) {
    if (!ctx.interactive) {
      ctx.review = { kind: 'tool', connectionId: m.connectionId, tool: m.tool.name, input, label: `Run ${m.tool.name} (${m.connectionName})` };
      env.step({ id: stepId, tool: 'mcp', status: 'waiting', label: 'Awaiting your approval', detail: label, mcp: { server: m.connectionName, tool: m.tool.name, input: inputText } });
      return { content: `${m.tool.name} needs approval before it runs, and nobody is here to give it now. Don't retry; finish what you can and say you are waiting for approval to run ${m.tool.name}.` };
    }
    const decision = await env.approve({ tool: 'mcp', stepId, risk: 'edit', payload: { title: `Run ${m.tool.name}?`, description: `${m.connectionName}${m.tool.destructive ? ' (can delete or replace data)' : ''}`, markdown: '```json\n' + inputText + '\n```', confirmLabel: 'Run', danger: !!m.tool.destructive } });
    if (decision !== 'accept') {
      env.step({ id: stepId, tool: 'mcp', status: 'declined', label: 'Run tool', detail: label, mcp: { server: m.connectionName, tool: m.tool.name, input: inputText } });
      return { content: 'The person declined running this tool. Don’t retry it.' };
    }
  }
  const r = await callMcpTool(ctx.agent.bot_id, m.connectionId, m.tool.name, input);
  const mcp = { server: m.connectionName, tool: m.tool.name, input: inputText, output: r.text.slice(0, 4000) };
  if (r.isError) env.step({ id: stepId, tool: 'mcp', status: 'error', label: 'Running tool', detail: label, error: r.text.slice(0, 300) || 'The MCP tool failed.', mcp });
  else env.step({ id: stepId, tool: 'mcp', status: 'done', label: `Ran MCP tool: ${m.tool.name}`, detail: m.connectionName, mcp });
  return { content: r.text, isError: r.isError };
}

// ---------------------------------------------------------------- update_agent_settings (setup chat)

const TRIGGER_KIND: Record<string, AgentTrigger['type']> = {
  schedule: 'recurrence', page_added: 'lit.page_created', property_updated: 'lit.page_updated', page_removed: 'lit.page_deleted',
  comment_added: 'lit.comment_added', mentioned: 'lit.agent_mentioned',
};

function ymdIn(tz: string, now = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

async function updateAgentSettings(ctx: RunToolContext, env: AgentEnv, input: Record<string, any>, stepId: string): Promise<ToolOutput> {
  const actor = ctx.actorId;
  const agent = getAgent(ctx.agent.id);
  if (!agent || !actor || !ctx.canConfigure || !['editor', 'read_and_write'].includes(agentRole(agent, actor))) {
    return { content: 'The person chatting with you can’t edit your settings, so nothing was changed.', isError: true };
  }
  env.step({ id: stepId, tool: 'update_agent_settings', status: 'running', label: 'Updating settings', detail: agent.data.name });
  const cur = workingConfig(agent);
  const next: AgentConfig = JSON.parse(JSON.stringify(cur));
  const notes: string[] = [];
  if (typeof input.name === 'string' && input.name.trim()) { next.name = input.name.trim().slice(0, 100); notes.push(`name “${next.name}”`); }
  if (typeof input.description === 'string') { next.description = input.description.trim().slice(0, 500) || undefined; notes.push('description'); }
  if (typeof input.icon === 'string' && input.icon.trim()) { next.icon = input.icon.trim().slice(0, 16); notes.push('icon'); }
  if (typeof input.model === 'string' && input.model.trim()) { next.model = input.model.trim().slice(0, 64); notes.push('model'); }
  if (typeof input.web_access === 'boolean') { next.web_access = input.web_access; notes.push(input.web_access ? 'web access on' : 'web access off'); }
  const tz = (() => {
    const s = (getRecord<{ id: string; version: number; settings?: Record<string, unknown> }>('user_settings', actor)?.settings ?? {}) as Record<string, unknown>;
    return typeof s.time_zone === 'string' && s.time_zone ? s.time_zone : 'UTC';
  })();
  for (const raw of (Array.isArray(input.add_triggers) ? input.add_triggers : []) as Record<string, any>[]) {
    const type = TRIGGER_KIND[raw.type];
    if (!type) continue;
    const t: Record<string, unknown> = { id: `trg_${newId().slice(0, 8)}`, type, enabled: true, ...(typeof raw.instructions === 'string' ? { instructions: raw.instructions } : {}) };
    if (type === 'recurrence') {
      t.recurrence = { frequency: raw.frequency ?? 'day', interval: raw.interval ?? 1, weekdays: raw.weekdays, time: typeof raw.time === 'string' ? raw.time : '09:00', start: ymdIn(tz), time_zone: tz };
    } else if (type === 'lit.comment_added') {
      if (raw.page_id) t.page_id = normalizeId(raw.page_id);
    } else if (type !== 'lit.agent_mentioned') {
      const dbId = raw.database_id ? normalizeId(raw.database_id) : '';
      const block = dbId ? getRecord<any>('block', dbId) : undefined;
      const collectionId = block?.collection_id ?? (getRecord<any>('collection', dbId) ? dbId : '');
      if (!collectionId) { notes.push(`skipped a ${raw.type} trigger (no database)`); continue; }
      t.collection_id = collectionId;
    }
    const clean = cleanTrigger(t);
    if (clean) { next.triggers.push(clean); notes.push(`trigger “${triggerRowTitle(clean)}”`); }
  }
  if (Array.isArray(input.remove_triggers)) {
    const drop = new Set(input.remove_triggers.map(String));
    const before = next.triggers.length;
    next.triggers = next.triggers.filter((t) => !drop.has(t.id));
    if (next.triggers.length !== before) notes.push(`removed ${before - next.triggers.length} trigger(s)`);
  }
  const denied: string[] = [];
  for (const g of (Array.isArray(input.grant_access) ? input.grant_access : []) as { page: string; role?: GrantRole }[]) {
    const role: GrantRole = GRANT_ROLES.includes(g.role as GrantRole) ? (g.role as GrantRole) : 'reader';
    let id = normalizeId(g.page);
    if (!getRecord('block', id)) id = searchPages(agent.space_id, actor, String(g.page), 1)[0]?.pageId ?? '';
    if (!id) { denied.push(`“${g.page}” (not found)`); continue; }
    const problem = grantProblem(actor, agent.space_id, id, role);
    if (problem) { denied.push(`${blockLabel(id)} (${problem})`); continue; }
    next.grants = [...next.grants.filter((x) => x.block_id !== id), { block_id: id, role, added_by: actor, added_time: Date.now() }];
    notes.push(`access to ${blockLabel(id)}`);
  }
  let instructionsNote = '';
  if (typeof input.instructions === 'string' && cur.instructions_page_id) {
    // the instructions page is the agent's own: written as the agent (Undo-able from the chat)
    const r = await runTool(env, 'update_page', { page_id: cur.instructions_page_id, command: 'replace_content', new_str: input.instructions.slice(0, 50_000) }, `${stepId}-instr`);
    instructionsNote = r.isError ? ` Instructions not changed: ${r.content}` : ' Instructions updated.';
  }
  const cleaned = cleanConfig(next);
  patchAgent(agent.id, { draft: cleaned, draft_edited_by_id: actor, draft_edited_time: Date.now() });
  env.step({ id: stepId, tool: 'update_agent_settings', status: 'done', label: 'Updated settings', detail: notes.length ? notes.slice(0, 4).join(', ') : agent.data.name });
  return {
    content: `${notes.length ? `Draft updated: ${notes.join('; ')}.` : 'No settings changed.'}${instructionsNote}${denied.length ? ` Couldn’t add access to: ${denied.join('; ')} — the person needs that access themselves (more than view needs Full access).` : ''} The person reviews the draft and clicks Save to apply it.`,
  };
}

// ---------------------------------------------------------------- read_agent_history (Advanced › Share chat history)

async function readAgentHistory(ctx: RunToolContext, env: AgentEnv, input: Record<string, any>, stepId: string): Promise<ToolOutput> {
  const shared = !!ctx.agent.data.share_chat_history;
  env.step({ id: stepId, tool: 'read_agent_history', status: 'running', label: 'Viewing', detail: 'Earlier conversations' });
  // off: each person's conversations stay separate — only the current person's (none for runs nobody started)
  if (!shared && !ctx.actorId) {
    env.step({ id: stepId, tool: 'read_agent_history', status: 'done', label: 'Viewed', detail: 'Earlier conversations' });
    return { content: 'Your chat history isn’t shared across users, and nobody started this run, so there are no earlier conversations you can read.' };
  }
  const q = trim(input.query, 200).toLowerCase();
  const limit = Math.min(20, Math.max(1, Number(input.limit) || 10));
  const rows = db.prepare(`SELECT created_time, kind, trigger_label, actor_id, payload, result FROM agent_runs WHERE agent_id = ? AND id != ? AND status IN ('success', 'skipped', 'needs_review') AND result IS NOT NULL${shared ? '' : ' AND actor_id = ?'} ORDER BY created_time DESC LIMIT 300`)
    .all(...[ctx.agent.id, ctx.runId, ...(shared ? [] : [ctx.actorId!])]) as { created_time: number; kind: string; trigger_label: string | null; actor_id: string | null; payload: string | null; result: string | null }[];
  const out: string[] = [];
  for (const r of rows) {
    let asked = '';
    try {
      asked = String((JSON.parse(r.payload ?? '{}') as { text?: unknown }).text ?? '');
    } catch {
      /* no payload */
    }
    const answer = String(r.result ?? '');
    if (q && !`${asked}\n${answer}`.toLowerCase().includes(q)) continue;
    const who = r.actor_id ? getRecord<UserRecord>('lit_user', r.actor_id)?.name || 'Someone' : '';
    const what = r.kind === 'chat' ? `Chat with ${who || 'someone'}` : `${r.trigger_label || 'Run'}${who ? ` (started by ${who})` : ''}`;
    out.push(`- ${new Date(r.created_time).toISOString().slice(0, 16).replace('T', ' ')} · ${what}\n  Asked: ${asked.replace(/\s+/g, ' ').slice(0, 300) || '(trigger)'}\n  Answered: ${answer.replace(/\s+/g, ' ').slice(0, 600)}`);
    if (out.length >= limit) break;
  }
  env.step({ id: stepId, tool: 'read_agent_history', status: 'done', label: 'Viewed', detail: `${out.length} earlier ${out.length === 1 ? 'conversation' : 'conversations'}` });
  return { content: out.length ? out.join('\n') : 'No earlier conversations matched.' };
}

/** Run an agent-only tool; null when `name` is a regular AI tool (the caller runs it through ai/tools). */
export async function runAgentTool(ctx: RunToolContext, env: AgentEnv, name: string, input: Record<string, any>, stepId: string): Promise<ToolOutput | null> {
  try {
    if (name === 'call_agent') return await callAgent(ctx, env, input, stepId);
    if (name === 'send_notification') return await sendNotification(ctx, env, input, stepId);
    if (name === 'request_url_access') return await requestUrlAccess(ctx, env, input, stepId);
    if (name === 'update_agent_settings') return await updateAgentSettings(ctx, env, input, stepId);
    if (name === 'read_agent_history') return await readAgentHistory(ctx, env, input, stepId);
    if (ctx.mcp.has(name)) return await mcpTool(ctx, env, name, input, stepId);
    return null;
  } catch (e) {
    const message = e instanceof AiError ? e.message : `Tool failed: ${String((e as Error)?.message ?? e).slice(0, 300)}`;
    env.step({ id: stepId, tool: name.startsWith('mcp_') ? 'mcp' : name, status: 'error', label: 'Error', error: message });
    return { content: message, isError: true };
  }
}

/** Tools an agent run offers, including agent-only tools enabled by its configuration. */
export function agentToolNames(cfg: AgentConfig, opts: { canConfigure: boolean; web: boolean }): string[] {
  const names = ['search_workspace', 'read_page', 'query_database', 'read_comments', 'view_version_history', 'create_pages', 'update_page', 'delete_pages', 'move_pages', 'create_database', 'update_database', 'add_comment', 'send_notification', 'read_agent_history'];
  if (cfg.people_directory) names.push('list_people');
  if (cfg.sub_agents.length) names.push('call_agent');
  if (opts.web) names.push('request_url_access');
  if (opts.canConfigure) names.push('update_agent_settings');
  return names;
}

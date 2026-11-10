// Custom Agents: the agent record ("workflow" table), its configuration and the
// pure helpers both the server and the web client use — config sanitizing, labels, trigger titles, the change list
// shown as "N unsaved edits" / in Version history, and the agent permission levels.

// An agent is its own principal: it acts as a bot user (lit_user id = bot_id) that can only reach the pages and
// databases granted to it in Tools and access (grants) — never through the creator's or the caller's access.
import type { Permission, Role, SpaceRecord } from './records.ts';
import type { Recurrence } from './automation/types.ts';
import { recurrenceLabel } from './automation/recurrence.ts';
import { groupIdsOf, isRestrictedMember, isSpaceMember } from './permissions.ts';

/** Agent sharing levels: Full access, Can edit, View and use. */
export type AgentRole = 'editor' | 'read_and_write' | 'reader';
export const AGENT_ROLES: AgentRole[] = ['editor', 'read_and_write', 'reader'];

export const AGENT_ROLE_LABEL: Record<AgentRole, string> = {
  editor: 'Full access',
  read_and_write: 'Can edit',
  reader: 'View and use',
};

export const AGENT_ROLE_CAPTION: Record<AgentRole, string> = {
  editor: 'Manage settings, use, receive alerts, and share the agent',
  read_and_write: 'Manage settings and use the agent',
  reader: 'View settings and use the agent where available',
};

/** Access an agent can be given to a page or database (Tools and access). */
export type GrantRole = 'editor' | 'read_and_write' | 'comment_only' | 'reader';
export const GRANT_ROLES: GrantRole[] = ['editor', 'read_and_write', 'comment_only', 'reader'];
export const GRANT_ROLE_LABEL: Record<GrantRole, string> = {
  editor: 'Full access',
  read_and_write: 'Can edit',
  comment_only: 'Can comment',
  reader: 'Can view',
};

export interface AgentGrant {
  /** page or database (collection_view_page / inline database block) */
  block_id: string;
  role: GrantRole;
  added_by?: string;
  added_time?: number;
}

/** Someone removed the agent from a page's Share menu. */
export interface AgentRevocation {
  block_id: string;
  by: string;
  time: number;
}

export type TriggerType =
  | 'recurrence'
  | 'lit.page_created'
  | 'lit.page_updated'
  | 'lit.page_deleted'
  | 'lit.comment_added'
  | 'lit.agent_mentioned'
  | 'lit.meeting_note_summarized';

export const TRIGGER_TYPES: TriggerType[] = [
  'recurrence', 'lit.page_created', 'lit.page_updated', 'lit.page_deleted', 'lit.comment_added', 'lit.agent_mentioned', 'lit.meeting_note_summarized',
];

export interface AgentTrigger {
  id: string;
  type: TriggerType;
  enabled: boolean;
  /** Scheduled run */
  recurrence?: Recurrence;
  /** database triggers / meeting notes: the data source watched */
  collection_id?: string;
  /** "Any page in selected view" */
  view_id?: string;
  /** Property updated: watched property ids (empty = any property) */
  properties?: string[];
  /** "Trigger when page content edited" */
  content_edited?: boolean;
  /** Comment trigger: the page (or database) watched; empty = any page the agent can access */
  page_id?: string;
  /** "Wait for edits to finish" */
  wait_for_edits?: boolean;
  /** extra instructions for runs of this trigger */
  instructions?: string;
  /** "Run only for:" Anyone (empty) or these people */
  user_filter?: string[];
}

/** One MCP tool's run mode: Run automatically, Always ask, Always allow. */
export type McpToolMode = 'auto' | 'ask' | 'allow';

export interface AgentConfig {
  name: string;
  icon?: string;
  description?: string;
  /** the agent's instructions page (a page whose parent is the agent) */
  instructions_page_id?: string;
  triggers: AgentTrigger[];
  /** 'auto' or a model id */
  model: string;
  /** Fallback behavior: Use a backup model · Wait until available · Fail in case of outage */
  fallback?: 'auto' | 'wait' | 'none';
  /** pages / databases the agent can use */
  grants: AgentGrant[];
  /** "Pages shared with everyone in {workspace}" — at most Can view */
  workspace_access: 'none' | 'reader';
  /** Web access (search + open pages) */
  web_access: boolean;
  /** restrict web search to these domains (empty = any) */
  web_domains?: string[];
  /** URLs the agent may open without asking (allowlist hostnames); 'all' = Allow every URL */
  trusted_urls?: string[];
  allow_all_urls?: boolean;
  /** other Custom Agents this agent may hand work to */
  sub_agents: string[];
  /** People Directory connection (list workspace members) */
  people_directory: boolean;
  /** MCP tool run modes by connection id → tool name */
  mcp_tool_modes?: Record<string, Record<string, McpToolMode>>;
  /** Advanced */
  skip_approvals?: boolean;
  allow_model_override?: boolean;
  share_chat_history?: boolean;
}

export type AgentStatus = 'active' | 'disabled' | 'paused';

export type PausedReason =
  | 'disabled_by_admin' | 'disabled_by_editor' | 'run_limit' | 'failure_limit' | 'credit_limit' | 'needs_review' | 'no_editors' | 'orphaned' | 'plan';

export const PAUSED_REASON_LABEL: Record<PausedReason, string> = {
  disabled_by_admin: 'Turned off by the workspace owner',
  disabled_by_editor: 'Turned off by an editor',
  run_limit: 'Paused after reaching its run limit',
  failure_limit: 'Paused after several failed runs',
  credit_limit: 'This agent reached its monthly allowance',
  needs_review: 'Needs review',
  no_editors: 'Turned off because no one can edit this agent',
  orphaned: 'Turned off because no one has full access to this agent',
  plan: 'Upgrade your plan to run this agent',
};

/** The agent record (table "workflow"). Written only by the server (api/modules/agents.ts). */
export interface AgentRecord {
  id: string;
  version: number;
  space_id: string;
  parent_id: string;
  parent_table: 'space';
  alive: boolean;
  created_by_id: string;
  created_time: number;
  last_edited_by_id?: string;
  last_edited_time?: number;
  /** who can use / edit the agent: user_permission / group_permission / space_permission with AgentRole roles */
  permissions: Permission[];
  /** the agent's own principal (a lit_user record with { bot: true }) */
  bot_id: string;
  /** live (saved) configuration */
  data: AgentConfig;
  /** unsaved edits (null = none) */
  draft?: AgentConfig | null;
  draft_edited_by_id?: string;
  draft_edited_time?: number;
  /** saved at least once (an unsaved new agent doesn't run on triggers) */
  published: boolean;
  status: AgentStatus;
  paused_reason?: PausedReason;
  paused_time?: number;
  /** owner for credits / ownership transfer */
  owner_id?: string;
  /** when nobody in the workspace had Full access any more and the departure time wasn't known */
  orphaned_since?: number;
  /** monthly credit limit (null = none) */
  credit_limit?: number | null;
  last_run_time?: number;
  revoked?: AgentRevocation[];
  /** moved to Trash */
  deleted_time?: number;
  deleted_by_id?: string;
  /** created from a template (id) */
  template_id?: string;
  [key: string]: unknown;
}

export type RunStatus = 'pending' | 'running' | 'success' | 'skipped' | 'failed' | 'needs_review' | 'stopped';

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  pending: 'Pending',
  running: 'Running',
  success: 'Successful',
  skipped: 'No action',
  failed: 'Failed',
  needs_review: 'Needs review',
  stopped: 'Stopped',
};

export type RunKind = 'chat' | 'trigger' | 'manual' | 'sub_agent';

// ---------------------------------------------------------------- sanitizing

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);

/** An agent nobody in the workspace has Full access to is disabled this long after its last owner left. */
export const ORPHAN_GRACE_MS = 7 * 86_400_000;

export const LIMITS = {
  triggers: 20,
  grants: 200,
  subAgents: 10,
  domains: 50,
  name: 100,
  description: 500,
  triggerInstructions: 4000,
};

function cleanRecurrence(v: any): Recurrence | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const freq = ['hour', 'day', 'week', 'month', 'year'].includes(v.frequency) ? v.frequency : null;
  if (!freq || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.start ?? ''))) return undefined;
  const r: Recurrence = {
    frequency: freq,
    interval: Math.max(1, Math.min(1000, Math.trunc(Number(v.interval) || 1))),
    start: String(v.start),
    time_zone: str(v.time_zone, 64) || 'UTC',
  };
  if (Array.isArray(v.weekdays)) r.weekdays = [...new Set(v.weekdays.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))] as number[];
  if (v.month_day === 'last' || (Number.isInteger(v.month_day) && v.month_day >= 1 && v.month_day <= 31)) r.month_day = v.month_day;
  if (Number.isInteger(v.month) && v.month >= 1 && v.month <= 12) r.month = v.month;
  if (typeof v.time === 'string' && /^\d{1,2}:\d{2}$/.test(v.time)) r.time = v.time;
  if (v.end && typeof v.end === 'object') {
    if (v.end.type === 'count' && Number.isInteger(v.end.count) && v.end.count >= 1) r.end = { type: 'count', count: Math.min(100_000, v.end.count) };
    else if (v.end.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(v.end.date))) r.end = { type: 'date', date: String(v.end.date) };
  }
  return r;
}

export function cleanTrigger(v: any): AgentTrigger | null {
  if (!v || typeof v !== 'object' || !TRIGGER_TYPES.includes(v.type)) return null;
  const t: AgentTrigger = { id: isId(v.id) ? v.id : `trg_${Math.random().toString(36).slice(2, 10)}`, type: v.type, enabled: v.enabled !== false };
  if (t.type === 'recurrence') {
    const r = cleanRecurrence(v.recurrence);
    if (r) t.recurrence = r;
  }
  if (isId(v.collection_id)) t.collection_id = v.collection_id;
  if (isId(v.view_id)) t.view_id = v.view_id;
  if (Array.isArray(v.properties)) t.properties = v.properties.filter(isId).slice(0, 50);
  if (v.content_edited === true) t.content_edited = true;
  if (isId(v.page_id)) t.page_id = v.page_id;
  if (v.wait_for_edits === false) t.wait_for_edits = false;
  if (typeof v.instructions === 'string' && v.instructions.trim()) t.instructions = v.instructions.slice(0, LIMITS.triggerInstructions);
  if (Array.isArray(v.user_filter)) t.user_filter = v.user_filter.filter(isId).slice(0, 50);
  return t;
}

function cleanHost(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  let s = v.trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '');
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s) && s.length <= 253 ? s : null;
}

/** Domain list entry check: null when valid, else the message. */
export function domainProblem(v: string, existing: string[] = []): string | null {
  if (!v.trim()) return 'Enter a domain';
  if (/\*/.test(v)) return 'Wildcard domains are not supported. Enter a domain.';
  const h = cleanHost(v);
  if (!h) return 'Use a valid domain such as arxiv.org.';
  if (existing.includes(h)) return 'That domain is already on the list';
  return null;
}

export function normalizeHost(v: string): string | null {
  return cleanHost(v);
}

const GRANT_SET = new Set<string>(GRANT_ROLES);

/** Shape-check an agent configuration (anything unknown is dropped; ids are not resolved here). */
export function cleanConfig(v: any, base?: AgentConfig): AgentConfig {
  const b = base ?? defaultConfig();
  const o = v && typeof v === 'object' ? v : {};
  const pick = <K extends keyof AgentConfig>(k: K): unknown => (k in o ? o[k] : b[k]);
  const grantsIn = Array.isArray(pick('grants')) ? (pick('grants') as any[]) : [];
  const seen = new Set<string>();
  const grants: AgentGrant[] = [];
  for (const g of grantsIn.slice(0, LIMITS.grants)) {
    if (!g || !isId(g.block_id) || !GRANT_SET.has(g.role) || seen.has(g.block_id)) continue;
    seen.add(g.block_id);
    grants.push({ block_id: g.block_id, role: g.role, ...(isId(g.added_by) ? { added_by: g.added_by } : {}), ...(Number.isFinite(g.added_time) ? { added_time: Number(g.added_time) } : {}) });
  }
  const triggers = (Array.isArray(pick('triggers')) ? (pick('triggers') as any[]) : []).slice(0, LIMITS.triggers).map(cleanTrigger).filter((t): t is AgentTrigger => !!t);
  const hosts = (list: unknown) => [...new Set((Array.isArray(list) ? list : []).map(cleanHost).filter((h): h is string => !!h))].slice(0, LIMITS.domains);
  const modes: Record<string, Record<string, McpToolMode>> = {};
  const rawModes = pick('mcp_tool_modes');
  if (rawModes && typeof rawModes === 'object') {
    for (const [cid, tools] of Object.entries(rawModes as Record<string, unknown>).slice(0, 20)) {
      if (!isId(cid) || !tools || typeof tools !== 'object') continue;
      const m: Record<string, McpToolMode> = {};
      for (const [name, mode] of Object.entries(tools as Record<string, unknown>).slice(0, 200)) {
        if (typeof name === 'string' && name.length <= 128 && (mode === 'auto' || mode === 'ask' || mode === 'allow')) m[name] = mode;
      }
      modes[cid] = m;
    }
  }
  const fallback = pick('fallback');
  return {
    name: str(pick('name'), LIMITS.name).trim() || 'New agent',
    icon: str(pick('icon'), 400) || undefined,
    description: str(pick('description'), LIMITS.description) || undefined,
    instructions_page_id: isId(pick('instructions_page_id')) ? (pick('instructions_page_id') as string) : undefined,
    triggers,
    model: str(pick('model'), 64) || 'auto',
    fallback: fallback === 'wait' || fallback === 'none' ? fallback : 'auto',
    grants,
    workspace_access: pick('workspace_access') === 'reader' ? 'reader' : 'none',
    web_access: pick('web_access') === true,
    web_domains: hosts(pick('web_domains')),
    trusted_urls: hosts(pick('trusted_urls')),
    allow_all_urls: pick('allow_all_urls') === true,
    sub_agents: [...new Set((Array.isArray(pick('sub_agents')) ? (pick('sub_agents') as unknown[]) : []).filter(isId))].slice(0, LIMITS.subAgents) as string[],
    people_directory: pick('people_directory') === true,
    mcp_tool_modes: modes,
    skip_approvals: pick('skip_approvals') === true,
    allow_model_override: pick('allow_model_override') !== false,
    share_chat_history: pick('share_chat_history') === true,
  };
}

export function defaultConfig(name = 'New agent'): AgentConfig {
  return {
    name, triggers: [], model: 'auto', fallback: 'auto', grants: [], workspace_access: 'none', web_access: false, web_domains: [], trusted_urls: [],
    allow_all_urls: false, sub_agents: [], people_directory: false, mcp_tool_modes: {}, skip_approvals: false, allow_model_override: true, share_chat_history: false,
  };
}

// ---------------------------------------------------------------- labels

export function triggerTypeLabel(type: TriggerType): string {
  switch (type) {
    case 'recurrence': return 'Scheduled run';
    case 'lit.page_created': return 'A page enters the database';
    case 'lit.page_updated': return 'A database property changes';
    case 'lit.page_deleted': return 'A page leaves the database';
    case 'lit.comment_added': return 'A comment is added';
    case 'lit.agent_mentioned': return 'The agent is mentioned';
    case 'lit.meeting_note_summarized': return 'A meeting note is summarized';
  }
}

/** Trigger row title: "Page added", "Daily at 9:00 AM" … */
export function triggerRowTitle(t: AgentTrigger): string {
  switch (t.type) {
    case 'recurrence': return t.recurrence ? recurrenceLabel(t.recurrence) : 'Scheduled run';
    case 'lit.page_created': return 'Page added';
    case 'lit.page_updated': return 'Property changed';
    case 'lit.page_deleted': return 'Page removed';
    case 'lit.comment_added': return 'Comment added';
    case 'lit.agent_mentioned': return 'Agent mentioned';
    case 'lit.meeting_note_summarized': return 'Meeting note ready';
  }
}

export function triggerNeedsDatabase(type: TriggerType): boolean {
  return type === 'lit.page_created' || type === 'lit.page_updated' || type === 'lit.page_deleted' || type === 'lit.meeting_note_summarized';
}

// ---------------------------------------------------------------- change list (unsaved edits / version history)

export interface ConfigChange {
  /** stable kind for counting and icons */
  kind: string;
  label: string;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** What changed from `prev` to `next`, as change list phrases. */
export function configChanges(prev: AgentConfig | null | undefined, next: AgentConfig, names: { block?: (id: string) => string; agent?: (id: string) => string } = {}): ConfigChange[] {
  const out: ConfigChange[] = [];
  const p = prev ?? defaultConfig(next.name);
  if (p.name !== next.name) out.push({ kind: 'name', label: 'Updated name' });
  if ((p.icon ?? '') !== (next.icon ?? '')) out.push({ kind: 'icon', label: 'Updated icon' });
  if ((p.description ?? '') !== (next.description ?? '')) out.push({ kind: 'description', label: 'Updated description' });
  if ((p.instructions_page_id ?? '') !== (next.instructions_page_id ?? '')) out.push({ kind: 'instructions', label: 'Updated instructions' });
  if (p.model !== next.model) out.push({ kind: 'model', label: 'Updated model' });
  if ((p.fallback ?? 'auto') !== (next.fallback ?? 'auto')) out.push({ kind: 'fallback', label: 'Backup behavior updated' });
  const pt = new Map(p.triggers.map((t) => [t.id, t]));
  const nt = new Map(next.triggers.map((t) => [t.id, t]));
  for (const t of next.triggers) {
    const before = pt.get(t.id);
    if (!before) out.push({ kind: 'trigger', label: `Trigger added: ${triggerRowTitle(t)}` });
    else if (!same({ ...before, enabled: true }, { ...t, enabled: true })) out.push({ kind: 'trigger', label: (before.instructions ?? '') !== (t.instructions ?? '') && same({ ...before, instructions: '', enabled: true }, { ...t, instructions: '', enabled: true }) ? `Instructions changed for ${triggerRowTitle(t)}` : `Trigger changed: ${triggerRowTitle(t)}` });
    else if (before.enabled !== t.enabled) out.push({ kind: 'trigger', label: `${t.enabled ? 'Enabled' : 'Disabled'} trigger: ${triggerRowTitle(t)}` });
  }
  for (const t of p.triggers) if (!nt.has(t.id)) out.push({ kind: 'trigger', label: `Trigger removed: ${triggerRowTitle(t)}` });
  const pg = new Map(p.grants.map((g) => [g.block_id, g.role]));
  const ng = new Map(next.grants.map((g) => [g.block_id, g.role]));
  const entity = (id: string) => names.block?.(id) || 'workspace page';
  for (const [id, role] of ng) {
    if (pg.get(id) !== role) out.push({ kind: 'permission', label: `Updated permission: ${GRANT_ROLE_LABEL[role].replace(/^Can /, '').replace('Full access', 'full').toLowerCase()} access to ${entity(id)}` });
  }
  for (const id of pg.keys()) if (!ng.has(id)) out.push({ kind: 'permission', label: `Updated permission: removed access to ${entity(id)}` });
  if (p.workspace_access !== next.workspace_access) out.push({ kind: 'permission', label: next.workspace_access === 'reader' ? 'Updated permission: view access to public workspace pages' : 'Updated permission: removed access to public workspace pages' });
  if (p.web_access !== next.web_access) out.push({ kind: 'web', label: next.web_access ? 'Web access enabled' : 'Web access disabled' });
  if (!same(p.web_domains, next.web_domains) || !same(p.trusted_urls, next.trusted_urls) || !!p.allow_all_urls !== !!next.allow_all_urls) out.push({ kind: 'urls', label: 'Trusted links updated' });
  const ps = new Set(p.sub_agents);
  const ns = new Set(next.sub_agents);
  for (const id of next.sub_agents) if (!ps.has(id)) out.push({ kind: 'connection', label: `Connection added: ${names.agent?.(id) || 'agent'}` });
  for (const id of p.sub_agents) if (!ns.has(id)) out.push({ kind: 'connection', label: `Connection removed: ${names.agent?.(id) || 'agent'}` });
  if (p.people_directory !== next.people_directory) out.push({ kind: 'connection', label: next.people_directory ? 'People Directory connected' : 'People Directory disconnected' });
  if (!same(p.mcp_tool_modes, next.mcp_tool_modes)) out.push({ kind: 'connection', label: 'Tool connection updated' });
  if (!!p.skip_approvals !== !!next.skip_approvals || (p.allow_model_override ?? true) !== (next.allow_model_override ?? true)) out.push({ kind: 'advanced', label: 'Advanced settings updated' });
  if (!!p.share_chat_history !== !!next.share_chat_history) out.push({ kind: 'advanced', label: 'Agent conversation access updated' });
  return out;
}

/** Agent page URL (/agent/<id>). */
export function agentPath(agentId: string): string {
  return `/agent/${agentId.replace(/-/g, '')}`;
}

/** Highest of two agent roles ('none' below all). */
export function maxAgentRole(a: AgentRole | 'none', b: AgentRole | 'none'): AgentRole | 'none' {
  const rank = { none: 0, reader: 1, read_and_write: 2, editor: 3 } as const;
  return rank[a] >= rank[b] ? a : b;
}

export function agentRoleAtLeast(role: AgentRole | 'none' | undefined, min: AgentRole): boolean {
  const rank = { none: 0, reader: 1, read_and_write: 2, editor: 3 } as const;
  return rank[role ?? 'none'] >= rank[min];
}

/** Grant role as a block role (the bot principal's role on granted pages). */
export function grantBlockRole(r: GrantRole): Role {
  return r;
}

/**
 * A person's sharing level on an agent: explicit people, permission groups and "Everyone at <workspace>".
 * Only current full members of the agent's workspace have one: guests and restricted members can't be invited to Custom
 * Agents nor chat with them, and an explicit entry of someone who left the workspace (or became a guest / restricted
 * member) gives nothing.
 */
export function agentRoleFor(agent: { permissions?: Permission[] } | undefined, space: SpaceRecord | undefined, userId: string | null | undefined): AgentRole | 'none' {
  if (!agent || !userId) return 'none';
  if (!isFullMember(space, userId)) return 'none';
  const groups = agent.permissions?.some((p) => p?.type === 'group_permission') ? groupIdsOf(space, userId) : null;
  let role: AgentRole | 'none' = 'none';
  for (const p of agent.permissions ?? []) {
    if (!p || !AGENT_ROLES.includes(p.role as AgentRole)) continue;
    const r = p.role as AgentRole;
    if (p.type === 'user_permission' && p.user_id === userId) role = maxAgentRole(role, r);
    else if (p.type === 'group_permission' && groups && p.group_id && groups.has(p.group_id)) role = maxAgentRole(role, r);
    else if (p.type === 'space_permission') role = maxAgentRole(role, r);
  }
  return role;
}

/** A current member of the workspace who isn't a restricted member (who agents can be shared with). */
export function isFullMember(space: SpaceRecord | undefined, userId: string | null | undefined): boolean {
  return !!userId && isSpaceMember(space, userId) && !isRestrictedMember(space, userId);
}

/** Agent role as a record role (recordMap entries). */
export function agentRecordRole(role: AgentRole | 'none'): Role {
  return role;
}

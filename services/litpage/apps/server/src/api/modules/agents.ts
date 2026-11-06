// Custom Agents API (AGT-*): POST /api/rpc/<name>. Agent records ("workflow") are written only here — every endpoint
// checks the caller's sharing level on the agent (Full access / Can edit / Can view and interact) or their
// workspace role (Settings › AI › Agents), validates input, and grants page access only within the caller's
// own access . Chats stream through /api/ai/stream {kind: 'agent'} (aiStream.ts).
import { newId } from '@nc/shared/ids.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { isSpaceOwner } from '../../policy.ts';
import type { BlockRecord, CollectionRecord, Permission, SpaceRecord, UserRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import {
  AGENT_ROLES, agentRoleAtLeast, cleanConfig, GRANT_ROLES, isFullMember, triggerNeedsDatabase, triggerRowTitle, type AgentConfig, type AgentRecord, type AgentRole, type GrantRole,
  type McpToolMode,
} from '@nc/shared/agents.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../../db.ts';
import { blockRole, RecordMapBuilder } from '../../records.ts';
import { audit } from '../../audit.ts';
import { hit } from '../../ratelimit.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { AiError, aiConfigured } from '../../ai/client.ts';
import { searchPages } from '../../ai/context.ts';
import { MODELS, modelLabel, offeredModels } from '../../ai/models.ts';
import { workspaceAiPolicy } from '../../ai/aiPolicy.ts';
import { addConnection, connectionTools, refreshConnection, removeConnection, removeOwnerConnections, updateConnection } from '../../ai/mcp.ts';
import { agentThreadsOf, getMessage, listMessages, threadById } from '../../ai/threads.ts';
import { turnChanges, undoTurn } from '../../ai/changes.ts';
import { agentBlockRole, blockLabel, editorAccessCheck, grantProblem, isShareable, pageAgents } from '../../agents/access.ts';
import {
  agentModelPolicy, agentRole, agentsAvailable, agentsFor, agentsInSpace, changesBetween, createAgent, createInstructionsPage, creationPolicy, creationProblem, getAgent,
  getVersion, isAgentAdmin, isBotId, isOwnerless, listVersions, orphanState, noteVisit, patchAgent, recordVersion, retireBlock, saveAgentRecord, setFavorite, userAgentState, workingConfig,
} from '../../agents/model.ts';
import {
  activeRunIds, enqueueRun, getRun, heldRunCount, insights, listRuns, monthlyCredits, releaseHeldRuns, runsCsv, setRunFeedback, setRunReview, setRunStatus, stopRun,
  type RunRow,
} from '../../agents/runs.ts';
import { ORPHANED_MESSAGE, readInstructions, spaceAgentUsage } from '../../agents/runs.ts';
import { installAgentTriggers, nextRunOf, retryBlockedMentions, syncAgentSchedules } from '../../agents/triggers.ts';
import { AGENT_TEMPLATES, TEMPLATE_CATEGORIES, templateById, templateTriggers } from '../../agents/templates.ts';
import { callKey } from '../../agents/tools.ts';

installAgentTriggers();

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);
const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');

function fail(e: unknown): never {
  if (e instanceof ApiError) throw e;
  if (e instanceof AiError) throw new ApiError(e.message, e.status);
  throw e;
}

/** The agent and the caller's role; 404 when they can't open it (403 for workspace admins: no-access page). */
function agentFor(userId: string, agentId: unknown, min: AgentRole = 'reader', opts: { deleted?: boolean } = {}): { agent: AgentRecord; role: AgentRole } {
  if (!isId(agentId)) throw new ApiError('We couldn’t find that agent', 404);
  const agent = getAgent(agentId);
  if (!agent || (agent.alive === false && !opts.deleted)) throw new ApiError('We couldn’t find that agent', 404);
  const role = agentRole(agent, userId);
  if (role === 'none') throw new ApiError(isAgentAdmin(agent.space_id, userId) ? 'You don’t have permission to use this agent' : 'We couldn’t find that agent', isAgentAdmin(agent.space_id, userId) ? 403 : 404);
  if (!agentRoleAtLeast(role, min)) {
    throw new ApiError(min === 'editor' ? 'You need Full access to this agent to do that' : 'You need edit access to this agent to do that', 403);
  }
  return { agent, role };
}

/** A workspace owner (not a membership admin): Settings › AI › Agents is workspace settings.
 *  Membership admins manage members, groups and default teamspaces only. */
function isOwner(space: SpaceRecord | undefined, userId: string): boolean {
  return isSpaceOwner(space, userId);
}

function member(spaceId: unknown, userId: string): SpaceRecord {
  const space = isId(spaceId) ? getRecord<SpaceRecord>('space', spaceId) : undefined;
  if (!space || !isSpaceMember(space, userId)) throw new ApiError('Not allowed', 403);
  return space;
}

function userName(id: string | null | undefined): string {
  if (!id) return '';
  const u = getRecord<UserRecord>('lit_user', id);
  return u?.name || u?.email || '';
}

function timeZoneOf(userId: string): string {
  const s = (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
  return typeof s.time_zone === 'string' && s.time_zone ? s.time_zone : 'UTC';
}

function todayIn(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

/** Records the client needs for an agent: the agent, its bot user, its instructions page. */
function agentRecordMap(userId: string, agents: AgentRecord[]): RecordMapBuilder {
  const rm = new RecordMapBuilder(userId);
  for (const a of agents) {
    rm.add('workflow', a as any);
    rm.add('lit_user', getRecord('lit_user', a.bot_id));
    const page = a.data.instructions_page_id ? getRecord<BlockRecord>('block', a.data.instructions_page_id) : undefined;
    if (page) rm.add('block', page);
    if (a.draft?.instructions_page_id && a.draft.instructions_page_id !== page?.id) rm.add('block', getRecord('block', a.draft.instructions_page_id));
  }
  return rm;
}

function summary(a: AgentRecord, userId: string, state?: Map<string, { favorite: number | null; visited: number | null }>) {
  const s = state?.get(a.id);
  return {
    id: a.id, name: a.data.name, icon: a.data.icon ?? null, description: a.data.description ?? null, botId: a.bot_id, role: agentRole(a, userId), status: a.status,
    pausedReason: a.paused_reason ?? null, published: a.published, hasDraft: !!a.draft, createdBy: a.created_by_id, createdTime: a.created_time, lastRunTime: a.last_run_time ?? null,
    favorite: !!s?.favorite, visited: s?.visited ?? null, alive: a.alive !== false, triggers: a.data.triggers.filter((t) => t.enabled).length,
    // Library › Agents "Connections" filter
    connections: [
      ...(a.data.grants.length || a.data.workspace_access === 'reader' ? ['litpage'] : []),
      ...(a.data.web_access ? ['web'] : []),
      ...(connectionTools(a.bot_id, a.space_id).length ? ['mcp'] : []),
      ...(a.data.sub_agents.length ? ['agents'] : []),
      ...(a.data.people_directory ? ['people'] : []),
    ],
  };
}

function auditAgent(event: string, a: AgentRecord, actorId: string, data: Record<string, unknown> = {}) {
  audit(event, { spaceId: a.space_id, actorId, targetId: a.id, data: { agent_name: a.data.name, ...data } });
}

// ---------------------------------------------------------------- grants

interface GrantCheck {
  ok: boolean;
  denied: { blockId: string; title: string; reason: string }[];
}

/** New or raised grants in `next` compared with `prev`, validated against `userId` . */
function checkNewGrants(userId: string, spaceId: string, prev: AgentConfig | null, next: AgentConfig): GrantCheck {
  const before = new Map((prev?.grants ?? []).map((g) => [g.block_id, g.role]));
  const rank: Record<GrantRole, number> = { reader: 1, comment_only: 2, read_and_write: 3, editor: 4 };
  const denied: GrantCheck['denied'] = [];
  for (const g of next.grants) {
    const old = before.get(g.block_id);
    if (old && rank[old] >= rank[g.role]) continue;
    const problem = grantProblem(userId, spaceId, g.block_id, g.role);
    if (problem) denied.push({ blockId: g.block_id, title: blockLabel(g.block_id), reason: problem });
  }
  return { ok: !denied.length, denied };
}

/** Triggers must use resources the agent can reach (workflow.agent.settings.grantAccessBeforeSave). */
function triggerAccessProblems(agent: AgentRecord, cfg: AgentConfig): string[] {
  const probe = { ...agent, version: -1, data: cfg } as AgentRecord;
  const out: string[] = [];
  for (const t of cfg.triggers) {
    if (!t.enabled) continue;
    let blockId: string | undefined;
    if (triggerNeedsDatabase(t.type) && t.collection_id) blockId = getRecord<CollectionRecord>('collection', t.collection_id)?.parent_id;
    else if (t.type === 'lit.comment_added' && t.page_id) blockId = t.page_id;
    if (triggerNeedsDatabase(t.type) && t.type !== 'lit.meeting_note_summarized' && !t.collection_id) { out.push(`${triggerRowTitle(t)}: choose a database`); continue; }
    if (!blockId) continue;
    const lookup = { block: (id: string) => getRecord<BlockRecord>('block', id), space: (id: string) => getRecord('space', id) as any, team: (id: string) => getRecord('team', id) as any, collection: (id: string) => getRecord<CollectionRecord>('collection', id) };
    if (agentBlockRole(lookup, probe, blockId) === 'none') out.push(`${triggerRowTitle(t)}: ${blockLabel(blockId)}`);
  }
  return out;
}

/** Grants shown in Tools and access: title, type, whether the caller can open it, missing / revoked state. */
function grantRows(agent: AgentRecord, cfg: AgentConfig, userId: string) {
  return cfg.grants.map((g) => {
    const b = getRecord<BlockRecord>('block', g.block_id);
    const revoked = agent.revoked?.find((r) => r.block_id === g.block_id);
    return {
      blockId: g.block_id, role: g.role, title: b ? blockLabel(g.block_id) : 'Deleted page', icon: (b?.format?.page_icon as string | undefined) ?? null,
      database: b?.type === 'collection_view_page' || b?.type === 'collection_view', missing: !b || b.alive === false, canOpen: !!b && blockRole(g.block_id, userId) !== 'none',
      addedBy: g.added_by ?? null, revoked: revoked ? { by: revoked.by, byName: userName(revoked.by), time: revoked.time } : null,
    };
  });
}

function sharingRows(agent: AgentRecord) {
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  const groups = ((space?.settings as { groups?: { id: string; name?: string; member_ids?: string[] }[] } | undefined)?.groups ?? []);
  return (agent.permissions ?? []).map((p) => {
    if (p.type === 'user_permission') {
      const u = getRecord<UserRecord>('lit_user', p.user_id ?? '');
      return { type: p.type, userId: p.user_id, name: u?.name || u?.email || 'Unknown user', email: u?.email ?? null, role: p.role, guest: !isSpaceMember(space, p.user_id ?? '') };
    }
    if (p.type === 'group_permission') {
      const g = groups.find((x) => x.id === p.group_id);
      return { type: p.type, groupId: p.group_id, name: g?.name || 'Group', memberCount: g?.member_ids?.length ?? 0, role: p.role };
    }
    return { type: p.type, name: `Everyone at ${space?.name ?? 'workspace'}`, role: p.role };
  });
}

/** Security warnings before sharing : private pages, workspace-wide access, connections. */
function sharingWarnings(agent: AgentRecord) {
  const privatePages: string[] = [];
  for (const g of agent.data.grants) {
    const b = getRecord<BlockRecord>('block', g.block_id);
    let cur = b;
    for (let i = 0; i < 100 && cur; i++) {
      if (cur.parent_table === 'space') {
        if (cur.permissions?.length && !cur.permissions.some((p) => p.type === 'space_permission')) privatePages.push(blockLabel(g.block_id));
        break;
      }
      if (cur.parent_table !== 'block') break;
      cur = getRecord<BlockRecord>('block', cur.parent_id);
    }
  }
  const conns = connectionTools(agent.bot_id, agent.space_id).map((c) => c.name);
  return { privatePages: [...new Set(privatePages)], workspaceAccess: agent.data.workspace_access === 'reader', connections: conns, web: agent.data.web_access };
}

function versionJson(v: ReturnType<typeof listVersions>[number]) {
  return { id: v.id, createdTime: v.createdTime, createdBy: v.createdBy, createdByName: v.createdBy ? userName(v.createdBy) : '', changes: v.changes, name: v.config.name };
}

function runJson(r: RunRow, viewerId: string) {
  return {
    id: r.id, kind: r.kind, status: r.status, triggerLabel: r.triggerLabel, triggerType: r.triggerType, actorId: r.actorId, actorName: userName(r.actorId), pageId: r.pageId,
    pageTitle: r.pageId && blockRole(r.pageId, viewerId) !== 'none' ? blockLabel(r.pageId) : null, error: r.error, createdTime: r.createdTime, startedTime: r.startedTime,
    endedTime: r.endedTime, model: r.model ? modelLabel(r.model) : null, credits: r.credits, tools: r.tools, changes: r.changes, result: r.result, threadId: r.threadId,
    feedback: r.feedback ? { rating: r.feedback.rating, comment: r.feedback.comment ?? null } : null, review: r.review, held: r.held, text: r.kind === 'chat' ? (r.payload.text ?? '').slice(0, 300) : null,
  };
}

/** What a person may see in the Activity: Full access / Can edit everything, others their own chats. */
function canSeeRun(role: AgentRole, r: RunRow, userId: string): boolean {
  if (role === 'editor' || role === 'read_and_write') return true;
  return r.kind === 'chat' && r.actorId === userId;
}

function modelsFor(space: SpaceRecord | undefined) {
  const mp = agentModelPolicy(space);
  const policy = workspaceAiPolicy(space?.id);
  return offeredModels(mp.fable || policy.fable).map((m) => ({
    id: m.id, name: m.name, version: m.version, group: m.group, beta: !!m.beta, description: m.description, allowed: !mp.allowed.length || mp.allowed.includes(m.id),
  }));
}

function agentDetail(agent: AgentRecord, userId: string) {
  const cfg = workingConfig(agent);
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  const role = agentRole(agent, userId);
  const subAgents = cfg.sub_agents.map((id) => getAgent(id)).filter((a): a is AgentRecord => !!a).map((a) => ({ id: a.id, name: a.data.name, icon: a.data.icon ?? null, canOpen: agentRole(a, userId) !== 'none', alive: a.alive !== false }));
  const conns = connectionTools(agent.bot_id, agent.space_id).map((c) => ({
    id: c.id, name: c.name, url: c.url, enabled: c.enabled, addedBy: c.addedBy, addedByName: userName(c.addedBy), mine: c.addedBy === userId, workspaceManaged: !!c.presetId,
    error: c.error, checkedTime: c.checkedTime,
    tools: c.tools.map((t) => ({ name: t.name, description: t.description ?? '', readOnly: !!t.readOnly, destructive: !!t.destructive, openWorld: !!t.openWorld, enabled: !c.disabledTools.includes(t.name), mode: cfg.mcp_tool_modes?.[c.id]?.[t.name] ?? (t.readOnly ? 'auto' : 'ask') })),
  }));
  const access = role === 'editor' || role === 'read_and_write' ? editorAccessCheck(agent) : { ok: true };
  return {
    agent: summary(agent, userId, userAgentState(userId)),
    role,
    config: cfg,
    live: agent.data,
    changes: agent.draft ? changesBetween(agent.data, agent.draft) : [],
    grants: grantRows(agent, cfg, userId),
    subAgents,
    connections: conns,
    nextRuns: Object.fromEntries(cfg.triggers.map((t) => [t.id, nextRunOf(t)?.label ?? null])),
    triggerTargets: Object.fromEntries(cfg.triggers.filter((t) => t.collection_id || t.page_id).map((t) => {
      const blockId = t.collection_id ? getRecord<CollectionRecord>('collection', t.collection_id)?.parent_id : t.page_id;
      return [t.id, blockId ? { blockId, title: blockLabel(blockId), canOpen: blockRole(blockId, userId) !== 'none' } : null];
    })),
    sharing: sharingRows(agent),
    warnings: sharingWarnings(agent),
    models: modelsFor(space),
    defaultModel: agentModelPolicy(space).defaultModel,
    available: agentsAvailable(space),
    aiEnabled: workspaceAiPolicy(agent.space_id).enabled,
    webAllowed: workspaceAiPolicy(agent.space_id).webSearch,
    webConfirm: workspaceAiPolicy(agent.space_id).webConfirm,
    configured: aiConfigured(),
    accessProblem: access.ok ? null : (access as { message?: string }).message ?? null,
    heldRuns: heldRunCount(agent.id),
    activeRuns: activeRunIds(agent.id).length,
    credits: { used: Math.round(monthlyCredits(agent.id)), limit: agent.credit_limit ?? null, owner: agent.owner_id ?? null, ownerName: userName(agent.owner_id) },
    instructionsPageId: cfg.instructions_page_id ?? null,
    isAdmin: isAgentAdmin(agent.space_id, userId),
    // nobody in the workspace has Full access: disabled after the grace period (workflows.orphanedAgentBanner)
    orphan: orphanInfo(agent),
  };
}

function orphanInfo(agent: AgentRecord): { daysRemaining: number; disableTime: number } | null {
  const o = orphanState(agent);
  return o ? { daysRemaining: Math.max(0, Math.ceil((o.disableTime - Date.now()) / 86_400_000)), disableTime: o.disableTime } : null;
}

function snapshotInstructions(agent: AgentRecord): string | null {
  try {
    return readInstructions(agent).markdown || null;
  } catch {
    return null;
  }
}

/** Apply a saved configuration: record, version, schedules, audit. */
function publish(agent: AgentRecord, cfg: AgentConfig, userId: string, opts: { label?: string } = {}): AgentRecord {
  const changes = changesBetween(agent.published ? agent.data : null, cfg);
  const saved = saveAgentRecord({ ...agent, data: cfg, draft: null, published: true, last_edited_by_id: userId, last_edited_time: Date.now() });
  recordVersion(saved, userId, opts.label ? [{ kind: 'restore', label: opts.label }, ...changes] : changes, snapshotInstructions(saved));
  syncAgentSchedules(saved);
  if (changes.some((c) => c.kind === 'permission')) auditAgent('custom_agent_lit_access_updated', saved, userId, { changes: changes.filter((c) => c.kind === 'permission').map((c) => c.label) });
  if (agent.data.web_access !== cfg.web_access) auditAgent(cfg.web_access ? 'custom_agent_web_access_added' : 'custom_agent_web_access_removed', saved, userId);
  if (agent.data.model !== cfg.model) auditAgent('custom_agent_model_updated', saved, userId, { model: cfg.model });
  for (const c of changes.filter((x) => x.kind === 'trigger')) {
    auditAgent(/^Added/.test(c.label) ? 'custom_agent_trigger_added' : /^Removed/.test(c.label) ? 'custom_agent_trigger_removed' : 'custom_agent_trigger_updated', saved, userId, { change: c.label });
  }
  auditAgent(agent.published ? 'custom_agent_updated' : 'custom_agent_published', saved, userId, { changes: changes.map((c) => c.label).slice(0, 20) });
  return saved;
}

// ---------------------------------------------------------------- handlers

export const handlers: Record<string, Handler> = {
  /** Sidebar Agents section / Library › Agents: agents shared with me (+ templates, creation rights). */
  getAgents(ctx, body) {
    const userId = requireUser(ctx);
    const space = member(body?.spaceId, userId);
    const state = userAgentState(userId);
    const list = agentsFor(space.id, userId, { includeDeleted: !!body?.includeDeleted });
    const rm = agentRecordMap(userId, list);
    return {
      agents: list.map((a) => summary(a, userId, state)),
      recordMap: rm.map,
      available: agentsAvailable(space),
      canCreate: !creationProblem(space.id, userId),
      createProblem: creationProblem(space.id, userId),
      isAdmin: isOwner(space, userId),
    };
  },

  listAgentTemplates() {
    return {
      categories: TEMPLATE_CATEGORIES,
      templates: AGENT_TEMPLATES.map((t) => ({ id: t.id, title: t.title, description: t.description, icon: t.icon, categories: t.categories, badge: t.badge ?? null })),
    };
  },

  /** One agent with everything its page shows (Settings, Tools and access, Share, Credits). */
  getAgent(ctx, body) {
    const userId = requireUser(ctx);
    if (!isId(body?.agentId)) throw new ApiError('We couldn’t find that agent', 404);
    const agent = getAgent(body.agentId);
    if (!agent) throw new ApiError('We couldn’t find that agent', 404);
    const role = agentRole(agent, userId);
    if (role === 'none') {
      // workflowNoAccess: owners and trigger count for workspace owners (they can change the permissions)
      if (isAgentAdmin(agent.space_id, userId)) {
        const owners = (agent.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role === 'editor').map((p) => ({ id: p.user_id, name: userName(p.user_id) }));
        return { noAccess: true, admin: true, name: agent.data.name, icon: agent.data.icon ?? null, owners, triggerCount: agent.data.triggers.length, status: agent.status, agentId: agent.id, spaceId: agent.space_id };
      }
      throw new ApiError('We couldn’t find that agent', 404);
    }
    noteVisit(userId, agent.id);
    const rm = agentRecordMap(userId, [agent, ...agent.data.sub_agents.map((id) => getAgent(id)).filter((a): a is AgentRecord => !!a && agentRole(a, userId) !== 'none')]);
    for (const g of workingConfig(agent).grants) if (blockRole(g.block_id, userId) !== 'none') rm.add('block', getRecord('block', g.block_id));
    return { ...agentDetail(agent, userId), recordMap: rm.map };
  },

  /** + New agent: blank, from a template, or from a description (the setup chat continues with it). */
  createAgent(ctx, body) {
    const userId = requireUser(ctx);
    const space = member(body?.spaceId, userId);
    const problem = creationProblem(space.id, userId);
    if (problem) throw new ApiError(problem, 403);
    if (!hit(`agent-create:${userId}`, 30, 3600_000)) throw new ApiError('Too many agents created. Try again later.', 429);
    const template = templateById(str(body?.templateId, 64));
    const tz = timeZoneOf(userId);
    const config: Partial<AgentConfig> = template
      ? { name: template.title, icon: template.icon, description: template.description, triggers: templateTriggers(template, tz, todayIn(tz)), web_access: !!template.web, people_directory: !!template.people }
      : { name: str(body?.name, 100).trim() || 'New agent', ...(str(body?.icon, 16) ? { icon: str(body.icon, 16) } : {}) };
    const agent = createAgent({ spaceId: space.id, userId, config, instructions: template?.instructions ?? '', templateId: template?.id });
    auditAgent('custom_agent_created', agent, userId, template ? { template: template.title } : {});
    return { agentId: agent.id, recordMap: agentRecordMap(userId, [agent]).map };
  },

  /** Settings edits (unsaved draft): shape-checked, new page access validated against the editor right away. */
  updateAgentDraft(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    const patch = body?.patch && typeof body.patch === 'object' ? body.patch : {};
    if ('instructions_page_id' in patch) delete patch.instructions_page_id;
    const cur = workingConfig(agent);
    const next = cleanConfig({ ...cur, ...patch });
    next.instructions_page_id = cur.instructions_page_id;
    // grants added by this person record who added them
    const before = new Map(cur.grants.map((g) => [g.block_id, g]));
    next.grants = next.grants.map((g) => (before.has(g.block_id) && before.get(g.block_id)!.role === g.role ? before.get(g.block_id)! : { ...g, added_by: userId, added_time: Date.now() }));
    for (const g of next.grants) if (!isShareable(getRecord<BlockRecord>('block', g.block_id)) && !before.has(g.block_id)) throw new ApiError('Only pages and databases can be shared with an agent.', 400);
    const check = checkNewGrants(userId, agent.space_id, cur, next);
    if (!check.ok) throw new ApiError(check.denied[0].reason, 403);
    // sub-agents: agents of this workspace the editor can use, never itself
    next.sub_agents = next.sub_agents.filter((id) => id !== agent.id && (() => { const s = getAgent(id); return !!s && s.space_id === agent.space_id && agentRole(s, userId) !== 'none'; })());
    // models must be offered in this workspace
    const space = getRecord<SpaceRecord>('space', agent.space_id);
    if (next.model !== 'auto' && !modelsFor(space).some((m) => m.id === next.model && m.allowed)) throw new ApiError('This model isn’t available in this workspace.', 400);
    if (next.web_access && !workspaceAiPolicy(agent.space_id).webSearch && !cur.web_access) throw new ApiError('Web browsing is disabled by your workspace admin.', 403);
    if (next.skip_approvals && !workspaceAiPolicy(agent.space_id).skipApprovals) next.skip_approvals = false;
    const saved = patchAgent(agent.id, { draft: next, draft_edited_by_id: userId, draft_edited_time: Date.now() })!;
    return { ...agentDetail(saved, userId), recordMap: agentRecordMap(userId, [saved]).map };
  },

  /** Save (publish the draft): the agent runs with it from now on. */
  saveAgent(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    const cfg = workingConfig(agent);
    const check = checkNewGrants(userId, agent.space_id, agent.published ? agent.data : { ...agent.data, grants: [] }, cfg);
    if (!check.ok) {
      throw new ApiError(`You don’t have permission to grant this agent access to these pages: ${check.denied.map((d) => d.title).join(', ')}. Remove these page permissions from the agent, or ask someone with permission to grant access to save it.`, 403);
    }
    const problems = triggerAccessProblems(agent, cfg);
    if (problems.length) throw new ApiError(`To save, grant your agent access to resources mentioned in its instructions or used by its triggers (${problems.join('; ')}).`, 400);
    const saved = publish(agent, cfg, userId);
    return { ...agentDetail(saved, userId), recordMap: agentRecordMap(userId, [saved]).map };
  },

  discardAgentDraft(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    const saved = patchAgent(agent.id, { draft: null })!;
    return { ...agentDetail(saved, userId), recordMap: agentRecordMap(userId, [saved]).map };
  },

  /** ••• › Duplicate : a private, unsaved copy with what the person can access. */
  copyAgent(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'reader');
    const problem = creationProblem(agent.space_id, userId);
    if (problem) throw new ApiError(problem, 403);
    const src = agent.data;
    const grants = src.grants.filter((g) => !grantProblem(userId, agent.space_id, g.block_id, g.role)).map((g) => ({ ...g, added_by: userId, added_time: Date.now() }));
    const probe = { ...agent, version: -1, data: { ...src, grants } } as AgentRecord;
    const triggers = src.triggers.filter((t) => !triggerAccessProblems(probe, { ...src, grants, triggers: [t] }).length);
    // "{Original agent name} (1)", "(2)" …
    const taken = new Set(agentsInSpace(agent.space_id).map((a) => a.data.name));
    let n = 1;
    while (taken.has(`${src.name} (${n})`)) n++;
    const copy = createAgent({
      spaceId: agent.space_id, userId,
      config: { ...src, name: `${src.name} (${n})`, grants, triggers, sub_agents: src.sub_agents.filter((id) => agentRole(getAgent(id), userId) !== 'none'), mcp_tool_modes: {} },
      instructions: readInstructions(agent).markdown,
    });
    auditAgent('custom_agent_created', copy, userId, { duplicated_from: agent.id });
    return { agentId: copy.id, recordMap: agentRecordMap(userId, [copy]).map, dropped: { grants: src.grants.length - grants.length, triggers: src.triggers.length - triggers.length } };
  },

  /** ••• › Move to Trash (Full access). */
  deleteAgent(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'editor');
    const saved = saveAgentRecord({ ...agent, alive: false, deleted_time: Date.now(), deleted_by_id: userId });
    syncAgentSchedules(saved);
    for (const id of activeRunIds(agent.id)) stopRun(id);
    auditAgent('custom_agent_deleted', saved, userId);
    return { ok: true, recordMap: agentRecordMap(userId, [saved]).map };
  },

  restoreAgent(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'editor', { deleted: true });
    const saved = saveAgentRecord({ ...agent, alive: true, deleted_time: undefined, deleted_by_id: undefined });
    syncAgentSchedules(saved);
    return { ok: true, recordMap: agentRecordMap(userId, [saved]).map };
  },

  permanentlyDeleteAgent(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'editor', { deleted: true });
    if (agent.alive !== false) throw new ApiError('Move the agent to Trash first.', 400);
    removeOwnerConnections(agent.bot_id);
    const saved = saveAgentRecord({ ...agent, permanently_deleted: true, permissions: agent.permissions, data: { ...agent.data, grants: [], triggers: [] }, draft: null });
    syncAgentSchedules(saved);
    return { ok: true };
  },

  // -------------------------------------------------------------- sharing 

  getAgentSharing(ctx, body) {
    const userId = requireUser(ctx);
    const { agent, role } = agentFor(userId, body?.agentId, 'reader');
    const space = getRecord<SpaceRecord>('space', agent.space_id);
    const groups = ((space?.settings as { groups?: { id: string; name?: string; member_ids?: string[] }[] } | undefined)?.groups ?? []).map((g) => ({ id: g.id, name: g.name ?? 'Group', memberCount: g.member_ids?.length ?? 0 }));
    const rm = new RecordMapBuilder(userId);
    for (const p of agent.permissions ?? []) if (p.user_id) rm.add('lit_user', getRecord('lit_user', p.user_id));
    return { sharing: sharingRows(agent), role, groups, warnings: sharingWarnings(agent), recordMap: rm.map };
  },

  /** Share (Full access; workspace owners on Enterprise without access too): people, groups, Everyone at. */
  setAgentPermissions(ctx, body) {
    const userId = requireUser(ctx);
    if (!isId(body?.agentId)) throw new ApiError('We couldn’t find that agent', 404);
    const agent = getAgent(body.agentId);
    if (!agent || agent.alive === false) throw new ApiError('We couldn’t find that agent', 404);
    const role = agentRole(agent, userId);
    const space = getRecord<SpaceRecord>('space', agent.space_id)!;
    const adminOverride = isOwner(space, userId) && space.plan_type === 'enterprise';
    if (role !== 'editor' && !adminOverride) throw new ApiError(role === 'none' ? 'We couldn’t find that agent' : 'You need Full access to this agent to share it', role === 'none' ? 404 : 403);
    const list = Array.isArray(body?.permissions) ? body.permissions.slice(0, 200) : null;
    if (!list) throw new ApiError('Invalid permissions', 400);
    const groups = new Set(((space.settings as { groups?: { id: string }[] } | undefined)?.groups ?? []).map((g) => g.id));
    const out: Permission[] = [];
    const seen = new Set<string>();
    for (const p of list) {
      if (!p || !AGENT_ROLES.includes(p.role)) continue;
      if (p.type === 'user_permission' && isId(p.user_id) && getRecord('lit_user', p.user_id)) {
        if (seen.has(`u:${p.user_id}`)) continue;
        seen.add(`u:${p.user_id}`);
        // only people of this workspace: guests (and people of other workspaces) and restricted members can't be invited
        if (!isFullMember(space, p.user_id)) {
          throw new ApiError(isSpaceMember(space, p.user_id) ? 'Restricted members cannot join custom agents' : 'Guests cannot join custom agents', 400);
        }
        out.push({ type: 'user_permission', user_id: p.user_id, role: p.role, added_timestamp: Date.now() });
      } else if (p.type === 'group_permission' && isId(p.group_id) && groups.has(p.group_id)) {
        if (seen.has(`g:${p.group_id}`)) continue;
        seen.add(`g:${p.group_id}`);
        out.push({ type: 'group_permission', group_id: p.group_id, role: p.role });
      } else if (p.type === 'space_permission') {
        if (seen.has('space')) continue;
        seen.add('space');
        out.push({ type: 'space_permission', role: p.role });
      }
    }
    // an agent keeps at least one person with Full access (else it would be orphaned)
    if (!out.some((p) => p.role === 'editor' && (p.type !== 'user_permission' || isFullMember(space, p.user_id ?? '')))) throw new ApiError('An agent needs at least one person with Full access', 400);
    const saved = saveAgentRecord({ ...agent, permissions: out, ...(agent.paused_reason === 'orphaned' || agent.paused_reason === 'no_editors' ? { status: 'active', paused_reason: undefined } : {}), orphaned_since: undefined });
    auditAgent('custom_agent_permission_updated', saved, userId, { entries: out.length });
    return { sharing: sharingRows(saved), recordMap: agentRecordMap(userId, [saved]).map };
  },

  // -------------------------------------------------------------- runs

  /** Run / Run agent: a manual run now . */
  runAgent(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'reader');
    if (!agent.published) throw new ApiError('Save the agent before it can run', 400);
    if (!hit(`agent-run:${userId}`, 30, 60_000)) throw new ApiError('Too many runs. Try again in a minute.', 429);
    const text = str(body?.text, 4000).trim();
    const run = enqueueRun({ agent, kind: 'manual', label: 'Run agent', actorId: userId, pageId: isId(body?.pageId) && blockRole(body.pageId, userId) !== 'none' ? body.pageId : null, payload: { text: text || 'Run now: do your work as your instructions describe.', facts: ['Started manually with Run agent.'] } });
    return { run: runJson(run, userId) };
  },

  getAgentRuns(ctx, body) {
    const userId = requireUser(ctx);
    const { agent, role } = agentFor(userId, body?.agentId, 'reader');
    const status = ['failed', 'success', 'in_progress', 'pending', 'needs_review'].includes(body?.status) ? body.status : 'all';
    const rows = listRuns(agent.id, { status, limit: Math.min(200, Number(body?.limit) || 50), before: Number(body?.before) || undefined, ...(role === 'editor' || role === 'read_and_write' ? {} : { userId }) })
      .filter((r) => canSeeRun(role, r, userId));
    return { runs: rows.map((r) => runJson(r, userId)), role };
  },

  /** One run with its transcript (steps, changes) — Activity › run details . */
  getAgentRun(ctx, body) {
    const userId = requireUser(ctx);
    const run = isId(body?.runId) ? getRun(body.runId) : null;
    if (!run) throw new ApiError('Not found', 404);
    const { role } = agentFor(userId, run.agentId, 'reader');
    if (!canSeeRun(role, run, userId)) throw new ApiError('Not found', 404);
    const thread = run.threadId ? threadById(run.threadId) : null;
    const messages = thread ? listMessages(thread.id) : [];
    return {
      run: runJson(run, userId),
      messages: messages.map((m) => ({
        id: m.id, role: m.role, createdTime: m.createdTime, text: m.data.text, status: m.data.status ?? 'complete', error: m.data.error ?? null, steps: m.data.steps ?? [],
        sources: m.data.sources ?? [], changes: m.role === 'assistant' && m.data.changed ? turnChanges(m.id) : null, meta: m.role === 'user' ? m.data.meta ?? null : null,
      })),
    };
  },

  stopAgentRun(ctx, body) {
    const userId = requireUser(ctx);
    const run = isId(body?.runId) ? getRun(body.runId) : null;
    if (!run) throw new ApiError('Not found', 404);
    const { role } = agentFor(userId, run.agentId, 'reader');
    if (!(role === 'editor' || role === 'read_and_write' || run.actorId === userId)) throw new ApiError('Not allowed', 403);
    return { stopped: stopRun(run.id) };
  },

  stopAllAgentRuns(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    let n = 0;
    for (const id of activeRunIds(agent.id)) if (stopRun(id)) n++;
    for (const r of listRuns(agent.id, { status: 'pending', limit: 500 })) if (stopRun(r.id)) n++;
    return { stopped: n };
  },

  agentRunFeedback(ctx, body) {
    const userId = requireUser(ctx);
    const run = isId(body?.runId) ? getRun(body.runId) : null;
    if (!run) throw new ApiError('Not found', 404);
    const { role } = agentFor(userId, run.agentId, 'reader');
    if (!canSeeRun(role, run, userId)) throw new ApiError('Not found', 404);
    const rating = body?.rating === 'positive' || body?.rating === 'negative' ? body.rating : null;
    setRunFeedback(run.id, userId, rating, str(body?.comment, 2000) || undefined);
    return { ok: true };
  },

  /** Needs review → Allow / Deny (URL approval , "Always ask" tools ). Allow re-runs with it. */
  resolveAgentReview(ctx, body) {
    const userId = requireUser(ctx);
    const run = isId(body?.runId) ? getRun(body.runId) : null;
    if (!run || run.status !== 'needs_review' || !run.review || run.review.decided) throw new ApiError('This request is no longer waiting for review.', 409);
    const { agent } = agentFor(userId, run.agentId, 'read_and_write');
    const allow = body?.decision === 'allow';
    setRunReview(run.id, { ...run.review, decided: allow ? 'allow' : 'deny', decidedBy: userId });
    if (!allow) {
      setRunStatus(run.id, 'failed', 'Declined');
      return { ok: true };
    }
    setRunStatus(run.id, 'success', null);
    const payload = { ...run.payload };
    if (run.review.kind === 'url' && run.review.host) payload.allowedHosts = [...new Set([...(payload.allowedHosts ?? []), run.review.host])];
    if (run.review.kind === 'tool' && run.review.connectionId && run.review.tool) payload.approvedCalls = [...new Set([...(payload.approvedCalls ?? []), callKey(run.review.connectionId, run.review.tool, run.review.input ?? {})])];
    const trigger = agent.data.triggers.find((t) => t.id === run.triggerId) ?? null;
    const next = enqueueRun({ agent, kind: run.kind === 'chat' ? 'manual' : run.kind, label: run.triggerLabel, trigger, actorId: run.actorId, pageId: run.pageId, payload, chain: run.chain, parentRunId: run.id });
    return { ok: true, run: runJson(next, userId) };
  },

  /** Resume a paused agent (run limit, repeated errors, credit limit) and its held runs. */
  resumeAgent(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    if (agent.status === 'disabled' && agent.paused_reason === 'disabled_by_admin' && !isAgentAdmin(agent.space_id, userId)) throw new ApiError('A workspace owner has paused this agent', 403);
    const saved = patchAgent(agent.id, { status: 'active', paused_reason: undefined, paused_time: undefined })!;
    syncAgentSchedules(saved);
    const resumed = body?.retry === false ? 0 : releaseHeldRuns(agent.id);
    return { ok: true, resumed, recordMap: agentRecordMap(userId, [saved]).map };
  },

  /** Disable (editors: "Disabled by an editor"; workspace owners: "Disabled by workspace owner"). */
  setAgentEnabled(ctx, body) {
    const userId = requireUser(ctx);
    if (!isId(body?.agentId)) throw new ApiError('We couldn’t find that agent', 404);
    const agent = getAgent(body.agentId);
    if (!agent || agent.alive === false) throw new ApiError('We couldn’t find that agent', 404);
    const admin = isAgentAdmin(agent.space_id, userId);
    const role = agentRole(agent, userId);
    if (!admin && !agentRoleAtLeast(role, 'read_and_write')) throw new ApiError(role === 'none' ? 'We couldn’t find that agent' : 'Not allowed', role === 'none' ? 404 : 403);
    const enable = body?.enabled === true;
    if (enable && agent.paused_reason === 'disabled_by_admin' && !admin && body?.allowEditorsToResume !== true) throw new ApiError('A workspace owner has paused this agent', 403);
    const orphan = enable ? orphanState(agent) : null;
    if (orphan && Date.now() >= orphan.disableTime) throw new ApiError(ORPHANED_MESSAGE, 400);
    const saved = patchAgent(agent.id, enable ? { status: 'active', paused_reason: undefined, paused_time: undefined } : { status: 'disabled', paused_reason: admin && !agentRoleAtLeast(role, 'read_and_write') ? 'disabled_by_admin' : 'disabled_by_editor', paused_time: Date.now() })!;
    syncAgentSchedules(saved);
    if (!enable) for (const id of activeRunIds(agent.id)) stopRun(id);
    else releaseHeldRuns(agent.id);
    auditAgent(enable ? 'custom_agent_enabled' : 'custom_agent_disabled', saved, userId);
    return { ok: true, status: saved.status, recordMap: agentRole(saved, userId) !== 'none' ? agentRecordMap(userId, [saved]).map : {} };
  },

  /** My chats with an agent ("Recent chats"), newest first. */
  getAgentChats(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'reader');
    return { chats: agentThreadsOf(agent.id, userId, 50).map((t) => ({ id: t.id, title: t.title, updatedTime: t.updatedTime, unread: t.updatedTime > t.lastReadTime + 500 })) };
  },

  /** Undo a chat turn's changes ("Changes made" → Undo): the agent made them, so the agent reverts them. */
  agentUndoChanges(ctx, body) {
    const userId = requireUser(ctx);
    const msg = isId(body?.messageId) ? getMessage(body.messageId) : null;
    const thread = msg ? threadById(msg.threadId) : null;
    if (!msg || !thread || !thread.agentId || thread.userId !== userId) throw new ApiError('There are no changes to undo.', 404);
    const agent = getAgent(thread.agentId);
    if (!agent || agentRole(agent, userId) === 'none') throw new ApiError('There are no changes to undo.', 404);
    try {
      const r = undoTurn(agent.bot_id, msg.id);
      return { ...r, changes: turnChanges(msg.id) };
    } catch (e) {
      fail(e);
    }
  },

  // -------------------------------------------------------------- Insights 

  getAgentInsights(ctx, body) {
    const userId = requireUser(ctx);
    const { agent, role } = agentFor(userId, body?.agentId, 'reader');
    if (role !== 'editor' && role !== 'read_and_write') throw new ApiError('You need edit access to this agent to view insights', 403);
    const days = [7, 30, 90].includes(Number(body?.days)) ? Number(body.days) : 30;
    const since = Date.now() - days * 86_400_000;
    const data = insights(agent.id, since);
    const chats = listRuns(agent.id, { since, limit: 100 }).map((r) => runJson(r, userId));
    return { ...data, period: days, chats };
  },

  exportAgentRunsCsv(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'editor');
    if (!agentsAvailable(getRecord<SpaceRecord>('space', agent.space_id))) throw new ApiError('Upgrade to Business to export runs', 403);
    const days = [7, 30, 90].includes(Number(body?.days)) ? Number(body.days) : 30;
    const slug = agent.data.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agent';
    return { filename: `${slug}-chats-${new Date().toISOString().slice(0, 10)}.csv`, csv: runsCsv(agent.id, Date.now() - days * 86_400_000) };
  },

  // -------------------------------------------------------------- versions 

  getAgentVersions(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'reader');
    return { versions: listVersions(agent.id).map(versionJson) };
  },

  restoreAgentVersion(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    const v = isId(body?.versionId) ? getVersion(body.versionId) : null;
    if (!v || v.agentId !== agent.id) throw new ApiError('Version not found', 404);
    const cfg = cleanConfig({ ...v.config, instructions_page_id: agent.data.instructions_page_id });
    const check = checkNewGrants(userId, agent.space_id, agent.data, cfg);
    if (!check.ok) throw new ApiError(`You can’t restore this version: you don’t have access to grant ${check.denied.map((d) => d.title).join(', ')}.`, 403);
    // the instructions page gets the version's instructions back
    if (v.instructions !== null && agent.data.instructions_page_id) {
      const page = createInstructionsPage(agent.id, agent.space_id, userId, v.instructions);
      cfg.instructions_page_id = page;
      retireBlock(agent.data.instructions_page_id);
    }
    const saved = publish(agent, cfg, userId, { label: `Restored version from ${new Date(v.createdTime).toISOString().slice(0, 16).replace('T', ' ')}` });
    return { ...agentDetail(saved, userId), recordMap: agentRecordMap(userId, [saved]).map };
  },

  // -------------------------------------------------------------- per-person state

  setAgentFavorite(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'reader');
    setFavorite(userId, agent.id, body?.favorite !== false);
    return { ok: true };
  },

  // -------------------------------------------------------------- Tools and access helpers 

  /** Pages / databases the person can add to an agent, with the most access they may grant. */
  searchAgentResources(ctx, body) {
    const userId = requireUser(ctx);
    const space = member(body?.spaceId, userId);
    const q = str(body?.query, 200).trim();
    const kind = body?.kind === 'database' ? 'database' : body?.kind === 'page' ? 'page' : 'any';
    const out: { blockId: string; title: string; icon: string | null; database: boolean; collectionId: string | null; maxRole: GrantRole }[] = [];
    const push = (b: BlockRecord | undefined) => {
      if (!b || !isShareable(b) || out.some((x) => x.blockId === b.id)) return;
      const database = b.type === 'collection_view_page' || b.type === 'collection_view';
      if ((kind === 'database' && !database) || (kind === 'page' && database)) return;
      const mine = blockRole(b.id, userId);
      if (mine === 'none') return;
      const maxRole: GrantRole = mine === 'editor' ? 'editor' : 'reader';
      out.push({ blockId: b.id, title: blockLabel(b.id), icon: (b.format?.page_icon as string | undefined) ?? null, database, collectionId: database ? b.collection_id ?? null : null, maxRole });
    };
    if (q) {
      for (const r of searchPages(space.id, userId, q, 20)) push(getRecord<BlockRecord>('block', r.pageId));
      // databases by name
      for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'collection' AND space_id = ? AND alive = 1 LIMIT 500`).all(space.id) as { data: string }[]) {
        const c = JSON.parse(r.data) as CollectionRecord;
        if (toPlainText(c.name).toLowerCase().includes(q.toLowerCase())) push(getRecord<BlockRecord>('block', c.parent_id));
        if (out.length >= 30) break;
      }
    } else {
      // recently visited pages first (page_visit records)
      const rows = db.prepare(`SELECT json_extract(data, '$.parent_id') AS pid FROM records WHERE tbl = 'page_visit' AND space_id = ? AND json_extract(data, '$.user_id') = ?
                               ORDER BY json_extract(data, '$.visited_at') DESC LIMIT 40`).all(space.id, userId) as { pid: string }[];
      for (const r of rows) push(getRecord<BlockRecord>('block', r.pid));
    }
    return { results: out.slice(0, 30) };
  },

  /** Page Share menu › Agents : agents that can reach this page. */
  getPageAgents(ctx, body) {
    const userId = requireUser(ctx);
    if (!isId(body?.pageId) || blockRole(body.pageId, userId) === 'none') throw new ApiError('Not found', 404);
    const page = getRecord<BlockRecord>('block', body.pageId)!;
    const space = getRecord<SpaceRecord>('space', page.space_id);
    const list = pageAgents(page.id, userId);
    // adding a page to an agent's Tools and access is a settings change: Can edit on the agent 
    const canAdd = agentsFor(page.space_id, userId).filter((a) => !list.some((x) => x.agentId === a.id) && agentRoleAtLeast(agentRole(a, userId), 'read_and_write'))
      .map((a) => ({ agentId: a.id, name: a.data.name, icon: a.data.icon ?? null }));
    return { agents: list, available: agentsAvailable(space) ? canAdd : [], myRole: blockRole(page.id, userId) };
  },

  /**
   * Share › add an agent like a person: the page joins the agent's Tools and access right away. That changes the agent's
   * live configuration, so it takes what the request asks for: Can edit on the agent, and the page access the grant needs.
   * granter is then one of the agent's editors who can open the page, so the grant can't trip the editor access check
   *  and stop the agent.
   */
  grantAgentPageAccess(ctx, body) {
    const userId = requireUser(ctx);
    const { agent, role: mine } = agentFor(userId, body?.agentId, 'reader');
    if (!agentRoleAtLeast(mine, 'read_and_write')) throw new ApiError('Ask the agent owner to grant it access to this page.', 403);
    if (!isId(body?.pageId)) throw new ApiError('Not found', 404);
    const role: GrantRole = GRANT_ROLES.includes(body?.role) ? body.role : 'reader';
    const problem = grantProblem(userId, agent.space_id, body.pageId, role);
    if (problem) throw new ApiError(problem === 'You can only share access you already have.' ? 'Agent access cannot exceed your own access level.' : problem, 403);
    const add = (cfg: AgentConfig): AgentConfig => ({ ...cfg, grants: [...cfg.grants.filter((g) => g.block_id !== body.pageId), { block_id: body.pageId, role, added_by: userId, added_time: Date.now() }] });
    const next = { ...agent, data: add(agent.data), draft: agent.draft ? add(agent.draft) : agent.draft, revoked: (agent.revoked ?? []).filter((r) => r.block_id !== body.pageId) };
    // never a resource none of the agent's editors can open (that would stop every run and chat)
    if (editorAccessCheck(next).orphanedResources?.some((o) => o.blockId === body.pageId)) throw new ApiError('None of this agent’s editors can open this page.', 403);
    const saved = saveAgentRecord(next);
    recordVersion(saved, userId, changesBetween(agent.data, saved.data), null);
    auditAgent('custom_agent_lit_access_updated', saved, userId, { page: blockLabel(body.pageId), role });
    // "Invite agent to page?" › Invite: the mention that couldn't reach the agent is answered now
    const retried = retryBlockedMentions(saved.id, body.pageId);
    return { agents: pageAgents(body.pageId, userId), retriedRuns: retried.length };
  },

  /** Share › Agents › ✕ : anyone with Full access to the page may remove an agent, even without agent access. */
  revokeAgentPageAccess(ctx, body) {
    const userId = requireUser(ctx);
    if (!isId(body?.pageId) || !isId(body?.agentId)) throw new ApiError('Not found', 404);
    const agent = getAgent(body.agentId);
    const page = getRecord<BlockRecord>('block', body.pageId);
    if (!agent || !page || page.space_id !== agent.space_id) throw new ApiError('Not found', 404);
    if (blockRole(page.id, userId) !== 'editor') throw new ApiError('You need full access to this page to remove an agent', 403);
    if (!agent.data.grants.some((g) => g.block_id === page.id) && !agent.draft?.grants.some((g) => g.block_id === page.id)) throw new ApiError('This agent’s access comes from a parent page or workspace setting', 400);
    const drop = (cfg: AgentConfig): AgentConfig => ({ ...cfg, grants: cfg.grants.filter((g) => g.block_id !== page.id) });
    const saved = saveAgentRecord({ ...agent, data: drop(agent.data), draft: agent.draft ? drop(agent.draft) : agent.draft, revoked: [...(agent.revoked ?? []).filter((r) => r.block_id !== page.id), { block_id: page.id, by: userId, time: Date.now() }] });
    recordVersion(saved, userId, changesBetween(agent.data, saved.data), null);
    auditAgent('custom_agent_lit_access_updated', saved, userId, { page: blockLabel(page.id), removed: true });
    return { agents: pageAgents(page.id, userId) };
  },

  /** @mention check: may this agent work on that page, and does it listen to mentions? */
  checkAgentMention(ctx, body) {
    const userId = requireUser(ctx);
    const agent = isId(body?.agentId) ? getAgent(body.agentId) : undefined;
    if (!agent || agent.alive === false || agentRole(agent, userId) === 'none') throw new ApiError('Not found', 404);
    const pageId = isId(body?.pageId) ? body.pageId : '';
    const reachable = !!pageId && pageAgents(pageId, userId).some((a) => a.agentId === agent.id);
    return {
      disabled: agent.status !== 'active' || !agent.published,
      listens: agent.data.triggers.some((t) => t.enabled && t.type === 'lit.agent_mentioned'),
      reachable,
      canGrant: !!pageId && agentRoleAtLeast(agentRole(agent, userId), 'read_and_write') && !grantProblem(userId, agent.space_id, pageId, 'reader'),
      // Invite gives Can edit when the person has Full access to the page, else Can view 
      grantRole: pageId && !grantProblem(userId, agent.space_id, pageId, 'read_and_write') ? 'read_and_write' : 'reader',
      canEdit: agentRoleAtLeast(agentRole(agent, userId), 'read_and_write'),
    };
  },

  // -------------------------------------------------------------- MCP connections 

  async addAgentConnection(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    try {
      const c = await addConnection(agent.bot_id, agent.space_id, { name: body?.name, url: body?.url, token: body?.token, presetId: body?.presetId }, userId);
      auditAgent('custom_agent_mcp_server_connected', agent, userId, { name: c.name });
      const saved = getAgent(agent.id)!;
      return { connection: c, ...agentDetail(saved, userId) };
    } catch (e) {
      fail(e);
    }
  },

  async refreshAgentConnection(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    const c = connectionTools(agent.bot_id, agent.space_id).find((x) => x.id === body?.connectionId);
    if (!c) throw new ApiError('That connection doesn’t exist.', 404);
    if (c.addedBy && c.addedBy !== userId) throw new ApiError('Only the person who connected this integration can re-authenticate it.', 403);
    try {
      await refreshConnection(agent.bot_id, c.id);
    } catch (e) {
      fail(e);
    }
    return agentDetail(getAgent(agent.id)!, userId);
  },

  /** Tool switches and run modes: only the person who connected it . */
  updateAgentConnection(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    const c = connectionTools(agent.bot_id, agent.space_id).find((x) => x.id === body?.connectionId);
    if (!c) throw new ApiError('That connection doesn’t exist.', 404);
    if (c.addedBy && c.addedBy !== userId) throw new ApiError('Only the person who connected this integration can change its tools.', 403);
    try {
      updateConnection(agent.bot_id, c.id, { enabled: body?.enabled, disabledTools: body?.disabledTools });
    } catch (e) {
      fail(e);
    }
    if (body?.toolModes && typeof body.toolModes === 'object') {
      const modes: Record<string, McpToolMode> = {};
      for (const [k, v] of Object.entries(body.toolModes as Record<string, unknown>).slice(0, 200)) if (v === 'auto' || v === 'ask' || v === 'allow') modes[k] = v;
      const apply = (cfg: AgentConfig): AgentConfig => ({ ...cfg, mcp_tool_modes: { ...(cfg.mcp_tool_modes ?? {}), [c.id]: { ...(cfg.mcp_tool_modes?.[c.id] ?? {}), ...modes } } });
      // tool modes are part of the configuration (saved right away: the connection's owner decides them)
      saveAgentRecord({ ...agent, data: apply(agent.data), draft: agent.draft ? apply(agent.draft) : agent.draft });
    }
    return agentDetail(getAgent(agent.id)!, userId);
  },

  removeAgentConnection(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'read_and_write');
    const c = connectionTools(agent.bot_id, agent.space_id).find((x) => x.id === body?.connectionId);
    if (!c) throw new ApiError('That connection doesn’t exist.', 404);
    removeConnection(agent.bot_id, c.id);
    const strip = (cfg: AgentConfig): AgentConfig => {
      const { [c.id]: _gone, ...rest } = cfg.mcp_tool_modes ?? {};
      return { ...cfg, mcp_tool_modes: rest };
    };
    saveAgentRecord({ ...agent, data: strip(agent.data), draft: agent.draft ? strip(agent.draft) : agent.draft });
    auditAgent('custom_agent_mcp_server_disconnected', agent, userId, { name: c.name });
    return agentDetail(getAgent(agent.id)!, userId);
  },

  // -------------------------------------------------------------- credits

  setAgentCreditLimit(ctx, body) {
    const userId = requireUser(ctx);
    const { agent } = agentFor(userId, body?.agentId, 'editor');
    const v = body?.limit === null || body?.limit === '' ? null : Number(body?.limit);
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 1_000_000)) throw new ApiError('Enter a whole number of 0 or more', 400);
    const saved = patchAgent(agent.id, { credit_limit: v, ...(v === null || v > monthlyCredits(agent.id) ? (agent.paused_reason === 'credit_limit' ? { status: 'active', paused_reason: undefined } : {}) : {}) })!;
    auditAgent(v === null ? 'custom_agent_credit_limit_removed' : 'custom_agent_credit_limit_set', saved, userId, v === null ? {} : { limit: v });
    if (saved.status === 'active') releaseHeldRuns(agent.id);
    return { credits: { used: Math.round(monthlyCredits(agent.id)), limit: saved.credit_limit ?? null }, recordMap: agentRecordMap(userId, [saved]).map };
  },

  // -------------------------------------------------------------- admin (Settings › AI › Agents, –020)

  adminListAgents(ctx, body) {
    const userId = requireUser(ctx);
    const space = member(body?.spaceId, userId);
    if (!isOwner(space, userId)) throw new ApiError('Only workspace owners can see all agents', 403);
    const q = str(body?.query, 200).trim().toLowerCase();
    const all = agentsInSpace(space.id, { includeDeleted: true }).filter((a) => !a.permanently_deleted).filter((a) => !q || a.data.name.toLowerCase().includes(q));
    const members = new Set((space.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => p.user_id!));
    return {
      agents: all.map((a) => ({
        id: a.id, name: a.data.name, icon: a.data.icon ?? null, status: a.alive === false ? 'deleted' : a.status, pausedReason: a.paused_reason ?? null,
        createdBy: a.created_by_id, createdByName: userName(a.created_by_id), owner: a.owner_id ?? null, ownerName: userName(a.owner_id),
        ownerLeft: !!a.owner_id && !members.has(a.owner_id), lastRunTime: a.last_run_time ?? null, model: a.data.model === 'auto' ? 'Auto' : modelLabel(a.data.model),
        connections: connectionTools(a.bot_id, a.space_id).length + a.data.sub_agents.length + (a.data.people_directory ? 1 : 0), credits: Math.round(monthlyCredits(a.id)),
        triggers: a.data.triggers.length, myRole: agentRole(a, userId), resources: a.data.grants.length + (a.data.workspace_access === 'reader' ? 1 : 0),
        // nobody holds Full access any more: the only agents "Transfer ownership" applies to 
        ownerless: a.alive !== false && isOwnerless(a),
      })),
      policy: creationPolicy(space),
      enterprise: space.plan_type === 'enterprise',
      available: agentsAvailable(space),
      // Settings › AI › Agents: every model (Claude Fable 5 only once turned on is offered to agents)
      models: MODELS.map((m) => ({ id: m.id, name: m.name, version: m.version, adminEnable: !!m.adminEnable })),
      modelPolicy: agentModelPolicy(space),
      groups: ((space.settings as { groups?: { id: string; name?: string; member_ids?: string[] }[] } | undefined)?.groups ?? []).map((g) => ({ id: g.id, name: g.name ?? 'Group', memberCount: g.member_ids?.length ?? 0 })),
    };
  },

  /**
   * Admins: the pages an agent can reach (Content search › Shared with an agent). Titles of pages the admin
   * can't open are shown only to workspace owners on Enterprise (what Content search shows them); other admins see
   * "Private page".
   */
  adminAgentResources(ctx, body) {
    const userId = requireUser(ctx);
    const agent = isId(body?.agentId) ? getAgent(body.agentId) : undefined;
    if (!agent || !isAgentAdmin(agent.space_id, userId)) throw new ApiError('Not allowed', 403);
    const space = getRecord<SpaceRecord>('space', agent.space_id);
    const contentSearch = space?.plan_type === 'enterprise' && isOwner(space, userId);
    return {
      grants: agent.data.grants.map((g) => ({ blockId: g.block_id, role: g.role, title: contentSearch || blockRole(g.block_id, userId) !== 'none' ? blockLabel(g.block_id) : 'Private page', addedBy: userName(g.added_by) })),
      workspaceAccess: agent.data.workspace_access === 'reader',
      web: agent.data.web_access,
    };
  },

  /** Admins (Enterprise): remove an agent's access to a page without access to the agent. */
  adminRevokeAgentResource(ctx, body) {
    const userId = requireUser(ctx);
    const agent = isId(body?.agentId) ? getAgent(body.agentId) : undefined;
    const space = agent ? getRecord<SpaceRecord>('space', agent.space_id) : undefined;
    if (!agent || !space || !isOwner(space, userId) || space.plan_type !== 'enterprise') throw new ApiError('Not allowed', 403);
    const drop = (cfg: AgentConfig): AgentConfig => ({ ...cfg, grants: cfg.grants.filter((g) => g.block_id !== body?.blockId), ...(body?.blockId === 'workspace' ? { workspace_access: 'none' as const } : {}) });
    const saved = saveAgentRecord({ ...agent, data: drop(agent.data), draft: agent.draft ? drop(agent.draft) : agent.draft });
    recordVersion(saved, userId, changesBetween(agent.data, saved.data), null);
    auditAgent('custom_agent_lit_access_updated', saved, userId, { admin: true });
    return { ok: true };
  },

  /**
   * Workspace owners: hand an agent whose owners left to a new owner (Recently left); they get Full access.
   * Only agents nobody holds Full access to any more: an agent that has an owner is changed through its Share menu (and,
   * without access to it, only by Enterprise owners — "Change permissions").
   */
  transferAgentOwnership(ctx, body) {
    const userId = requireUser(ctx);
    const agent = isId(body?.agentId) ? getAgent(body.agentId) : undefined;
    const space = agent ? getRecord<SpaceRecord>('space', agent.space_id) : undefined;
    if (!agent || agent.alive === false || !space || !isOwner(space, userId)) throw new ApiError('Not allowed', 403);
    if (!isOwnerless(agent)) throw new ApiError('This agent still has an owner. Only agents whose owners left the workspace can be transferred.', 400);
    if (!isId(body?.userId) || !isFullMember(space, body.userId)) throw new ApiError('No matching members', 400);
    const perms = (agent.permissions ?? []).filter((p) => !(p.type === 'user_permission' && p.user_id === body.userId));
    perms.push({ type: 'user_permission', user_id: body.userId, role: 'editor', added_timestamp: Date.now() });
    const saved = saveAgentRecord({ ...agent, owner_id: body.userId, permissions: perms, ...(agent.paused_reason === 'orphaned' || agent.paused_reason === 'no_editors' ? { status: 'active', paused_reason: undefined } : {}), orphaned_since: undefined });
    syncAgentSchedules(saved);
    auditAgent('custom_agent_permission_updated', saved, userId, { owner: userName(body.userId) });
    return { ok: true, ownerName: userName(body.userId) };
  },

  /** Agents of departed members (Settings › People › Recently left) that need a new owner (workspace owners). */
  adminOrphanedAgents(ctx, body) {
    const userId = requireUser(ctx);
    const space = member(body?.spaceId, userId);
    if (!isOwner(space, userId)) throw new ApiError('Not allowed', 403);
    const fromUser = isId(body?.userId) ? body.userId : null;
    const list = agentsInSpace(space.id).filter((a) => {
      const owners = (a.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role === 'editor').map((p) => p.user_id!);
      return (fromUser ? owners.includes(fromUser) || a.owner_id === fromUser : true) && isOwnerless(a);
    });
    return { agents: list.map((a) => ({ id: a.id, name: a.data.name, icon: a.data.icon ?? null, owner: a.owner_id ?? null, ownerName: userName(a.owner_id), disableTime: orphanState(a)?.disableTime ?? null, status: a.status })) };
  },

  /**
   * Settings › Analytics › AI › Custom Agents : the most and least used agents of the period — runs (triggers,
   * manual, sub-agent calls), chats, people who used them, credits; agents nobody used come last. Owners only.
   */
  adminAgentAnalytics(ctx, body) {
    const userId = requireUser(ctx);
    const space = member(body?.spaceId, userId);
    if (!isOwner(space, userId)) throw new ApiError('Not allowed', 403);
    const days = Math.min(Math.max(Math.round(Number(body?.days) || 28), 1), 366);
    const usage = spaceAgentUsage(space.id, Date.now() - days * 86_400_000);
    const agents = agentsInSpace(space.id).map((a) => {
      const u = usage.get(a.id);
      return {
        id: a.id, name: a.data.name, icon: a.data.icon ?? null, status: a.status, ownerName: userName(a.owner_id ?? a.created_by_id),
        runs: u?.runs ?? 0, chats: u?.chats ?? 0, failed: u?.failed ?? 0, people: u ? [...u.users].filter((x) => !isBotId(x)).length : 0,
        credits: Math.round(u?.credits ?? 0), lastRunTime: a.last_run_time ?? null,
      };
    }).sort((x, y) => (y.runs + y.chats) - (x.runs + x.chats) || (y.lastRunTime ?? 0) - (x.lastRunTime ?? 0));
    const used = agents.filter((a) => a.runs + a.chats > 0);
    return { days, agents, totals: { agents: agents.length, used: used.length, runs: used.reduce((n, a) => n + a.runs, 0), chats: used.reduce((n, a) => n + a.chats, 0), credits: used.reduce((n, a) => n + a.credits, 0) } };
  },

  /** No-access page for workspace owners: give yourself access (Enterprise lets owners change any agent's sharing). */
  adminJoinAgent(ctx, body) {
    const userId = requireUser(ctx);
    const agent = isId(body?.agentId) ? getAgent(body.agentId) : undefined;
    const space = agent ? getRecord<SpaceRecord>('space', agent.space_id) : undefined;
    if (!agent || !space || !isOwner(space, userId) || space.plan_type !== 'enterprise') throw new ApiError('Not allowed', 403);
    const perms = (agent.permissions ?? []).filter((p) => !(p.type === 'user_permission' && p.user_id === userId));
    perms.push({ type: 'user_permission', user_id: userId, role: 'editor', added_timestamp: Date.now() });
    const saved = saveAgentRecord({ ...agent, permissions: perms });
    auditAgent('custom_agent_permission_updated', saved, userId, { admin_joined: true });
    return { ok: true };
  },
};

export { newId };

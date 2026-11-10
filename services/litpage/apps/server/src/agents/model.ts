// Custom Agents storage (AGT-*): agent records (table "workflow"), the agent's own principal (a bot lit_user
// record { bot: { workflow_id } } — never a login, no email), its instructions page (a page whose parent is the
// agent, parent_table 'workflow'), saved versions, per-user favorites / recent visits and the workspace policies
// (who can create agents, models). Records are written only here and broadcast like any record change; clients
// read them through recordMaps (records.ts recordRole 'workflow' = the person's sharing level).
import { newId } from '@nc/shared/ids.ts';
import { applyOperation, type Operation } from '@nc/shared/ops.ts';
import { isSpaceAdmin, isSpaceMember, isRestrictedMember, groupIdsOf } from '@nc/shared/permissions.ts';
import type { BaseRecord, BlockRecord, Permission, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import {
  ORPHAN_GRACE_MS, agentRoleFor, cleanConfig, configChanges, defaultConfig, isFullMember, type AgentConfig, type AgentRecord, type AgentRole, type ConfigChange,
} from '@nc/shared/agents.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord, putRecord } from '../db.ts';
import { isSpaceOwner } from '../policy.ts';
import { realtime } from '../realtime.ts';
import { indexBlock } from '../search.ts';
import { OpsBuilder } from '../content/spec.ts';
import { markdownToSpecs } from '../ai/edit.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  created_by TEXT,
  config TEXT NOT NULL,
  changes TEXT NOT NULL,
  instructions TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_versions ON agent_versions(agent_id, created_time);
CREATE TABLE IF NOT EXISTS agent_user_state (
  user_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  favorite_time INTEGER,
  visited_time INTEGER,
  PRIMARY KEY (user_id, agent_id)
);
`);

// ---------------------------------------------------------------- bot principals

let bots: Map<string, string> | null = null; // bot user id → agent id

function botMap(): Map<string, string> {
  if (!bots) {
    bots = new Map();
    for (const r of db.prepare(`SELECT id, json_extract(data, '$.bot.workflow_id') AS wid FROM records WHERE tbl = 'lit_user' AND json_extract(data, '$.bot.workflow_id') IS NOT NULL`).all() as { id: string; wid: string }[]) {
      bots.set(r.id, r.wid);
    }
  }
  return bots;
}

/** Is this user id a Custom Agent's bot (and not a person)? Cheap: an in-memory set. */
export function isBotId(id: string | null | undefined): boolean {
  return !!id && botMap().has(id);
}

export function agentIdOfBot(botId: string): string | undefined {
  return botMap().get(botId);
}

export function agentByBot(botId: string): AgentRecord | undefined {
  const id = agentIdOfBot(botId);
  return id ? getAgent(id) : undefined;
}

function botUserValue(agent: AgentRecord): UserRecord {
  const cfg = agent.data;
  const icon = cfg.icon && /^(https?:\/\/|\/files\/)/.test(cfg.icon) ? cfg.icon : undefined;
  return {
    id: agent.bot_id, version: 0, email: '', name: cfg.name || 'Agent', given_name: cfg.name || 'Agent', created_time: agent.created_time,
    ...(icon ? { profile_photo: icon } : {}), bot: { workflow_id: agent.id, space_id: agent.space_id, icon: cfg.icon ?? null },
  } as unknown as UserRecord;
}

/** Keep the bot's user record (name / icon shown for the agent's edits, comments and mentions) in sync. */
export function syncBotUser(agent: AgentRecord) {
  const prev = getRecord<UserRecord>('lit_user', agent.bot_id);
  const next = { ...botUserValue(agent), version: (prev?.version ?? 0) + 1 } as UserRecord;
  const p = prev as unknown as Record<string, unknown> | undefined;
  if (p && p.name === next.name && JSON.stringify(p.bot) === JSON.stringify((next as unknown as Record<string, unknown>).bot) && p.profile_photo === next.profile_photo) return;
  // the email column stays empty: a bot can never log in (email lookups skip it)
  delete (next as unknown as Record<string, unknown>).email;
  putRecord('lit_user', next);
  botMap().set(agent.bot_id, agent.id);
}

// ---------------------------------------------------------------- records

export function getAgent(id: string | null | undefined): AgentRecord | undefined {
  return id ? getRecord<AgentRecord>('workflow', id) : undefined;
}

export function agentsInSpace(spaceId: string, opts: { includeDeleted?: boolean } = {}): AgentRecord[] {
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'workflow' AND space_id = ?`).all(spaceId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as AgentRecord).filter((a) => opts.includeDeleted || a.alive !== false);
}

/** Persist an agent record (version bump) and push it to everyone it is shared with. */
export function saveAgentRecord(a: AgentRecord): AgentRecord {
  const prev = getAgent(a.id);
  const next = { ...a, version: (prev?.version ?? 0) + 1 } as AgentRecord;
  putRecord('workflow', next as unknown as BaseRecord);
  realtime.broadcastChanges([{ table: 'workflow', record: next as unknown as BaseRecord, spaceId: next.space_id }]);
  if (!prev || prev.data.name !== next.data.name || prev.data.icon !== next.data.icon) syncBotUser(next);
  return next;
}

export function patchAgent(id: string, patch: Partial<AgentRecord> | ((a: AgentRecord) => Partial<AgentRecord>)): AgentRecord | null {
  const cur = getAgent(id);
  if (!cur) return null;
  const p = typeof patch === 'function' ? patch(cur) : patch;
  return saveAgentRecord({ ...cur, ...p } as AgentRecord);
}

/**
 * : an agent nobody in the workspace has Full access to — its Full access people all left (a group or
 * "Everyone at" with Full access keeps it owned). `since` = when the last of them left (audit log), else when this was
 * first noticed; it stops running ORPHAN_GRACE_MS later ("Disabled because nobody has Full access to this agent").
 */
export function orphanState(agent: AgentRecord, now = Date.now()): { since: number; disableTime: number } | null {
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  if (!space || agent.alive === false) return null;
  const perms = agent.permissions ?? [];
  const owners = perms.filter((p) => p.type === 'user_permission' && p.role === 'editor' && p.user_id).map((p) => p.user_id!);
  // owned while someone who still holds Full access is a full member (agentRoleFor: people who left, guests and
  // restricted members hold no role on agents)
  const owned = perms.some((p) => p.type !== 'user_permission' && p.role === 'editor') || owners.some((u) => isFullMember(space, u));
  if (owned) {
    if (agent.orphaned_since) patchAgent(agent.id, { orphaned_since: undefined });
    return null;
  }
  let since: number | null = null;
  if (owners.length) {
    try {
      const row = db.prepare(`SELECT MAX(time) AS time FROM audit_log WHERE space_id = ? AND event IN ('member_removed', 'member_left') AND target_id IN (${owners.map(() => '?').join(',')})`)
        .get(space.id, ...owners) as { time: number | null } | undefined;
      since = row?.time ?? null;
    } catch {
      since = null; // no audit log table yet
    }
  }
  if (since === null) {
    since = agent.orphaned_since ?? now;
    if (!agent.orphaned_since) patchAgent(agent.id, { orphaned_since: since });
  }
  return { since, disableTime: since + ORPHAN_GRACE_MS };
}

/** Nobody can manage the agent any more: no full member holds Full access (directly, through a group or "Everyone at")
 *  — what "Transfer ownership" is for . */
export function isOwnerless(agent: AgentRecord): boolean {
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  const perms = agent.permissions ?? [];
  return !perms.some((p) => p.type !== 'user_permission' && p.role === 'editor')
    && !perms.some((p) => p.type === 'user_permission' && p.role === 'editor' && isFullMember(space, p.user_id));
}

export function agentRole(agent: AgentRecord | undefined, userId: string | null | undefined): AgentRole | 'none' {
  if (!agent) return 'none';
  return agentRoleFor(agent, getRecord<SpaceRecord>('space', agent.space_id), userId);
}

/** People (workspace members) whose sharing level is at least `min` — groups and "Everyone at" expanded. */
export function agentPeople(agent: AgentRecord, min: 'editor' | 'read_and_write' | 'reader' = 'read_and_write', cap = 500): string[] {
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  const rank = { reader: 1, read_and_write: 2, editor: 3 } as Record<string, number>;
  const ok = (r: string) => (rank[r] ?? 0) >= rank[min];
  const members = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
  const out = new Set<string>();
  for (const p of agent.permissions ?? []) {
    if (!ok(p.role)) continue;
    if (p.type === 'user_permission' && p.user_id) {
      out.add(p.user_id);
    } else if (p.type === 'group_permission' && p.group_id) {
      for (const uid of members) if (groupIdsOf(space, uid).has(p.group_id)) out.add(uid);
    } else if (p.type === 'space_permission') {
      for (const uid of members) if (!isRestrictedMember(space, uid)) out.add(uid);
    }
    if (out.size >= cap) break;
  }
  // only current members keep an agent alive (people who left the workspace don't count)
  return [...out].filter((uid) => isSpaceMember(space, uid) && agentRoleFor(agent, space, uid) !== 'none').slice(0, cap);
}

/** Workspace owners (Settings › AI › Agents: disable, change permissions, transfer ownership). Membership admins
 *  manage members only, not agents. */
export function isAgentAdmin(spaceId: string, userId: string | null | undefined): boolean {
  return !!userId && isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId);
}

/** The configuration a person sees in Settings: their unsaved edits when there are any. */
export function workingConfig(a: AgentRecord): AgentConfig {
  return a.draft ?? a.data;
}

// ---------------------------------------------------------------- plan / policy

/** Custom Agents are a Business / Enterprise feature ; on Free / Plus every agent is off . */
export function agentsAvailable(space: SpaceRecord | undefined): boolean {
  return !!space && (space.plan_type === 'business' || space.plan_type === 'enterprise');
}

export type CreationPolicy = 'all' | 'owners' | 'owners_groups' | 'disabled';

export function creationPolicy(space: SpaceRecord | undefined): { policy: CreationPolicy; groups: string[] } {
  const s = (space?.settings ?? {}) as Record<string, unknown>;
  const p = s.agent_creation;
  const policy: CreationPolicy = p === 'owners' || p === 'owners_groups' || p === 'disabled' ? p : 'all';
  const groups = Array.isArray(s.agent_creation_groups) ? (s.agent_creation_groups as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 100) : [];
  return { policy, groups };
}

/** Why `userId` may not create agents in this workspace (null = allowed).  + guests/restricted . */
export function creationProblem(spaceId: string, userId: string): string | null {
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!space || !isSpaceMember(space, userId)) return 'Guests can’t create agents';
  if (isRestrictedMember(space, userId)) return 'Restricted members can’t create agents';
  if (!agentsAvailable(space)) return 'Upgrade to Business to use custom agents';
  const { policy, groups } = creationPolicy(space);
  if (policy === 'all') return null;
  if (policy === 'disabled') return 'Agent creation is currently disabled in this workspace';
  if (isSpaceAdmin(space, userId)) return null;
  if (policy === 'owners_groups') {
    const mine = groupIdsOf(space, userId);
    if (groups.some((g) => mine.has(g))) return null;
  }
  return 'Only workspace owners can create agents in this workspace';
}

/** Settings › AI › Allowed models for Custom Agents (empty = all) and the default model for new agents. */
export function agentModelPolicy(space: SpaceRecord | undefined): { allowed: string[]; defaultModel: string; fable: boolean } {
  const s = (space?.settings ?? {}) as Record<string, unknown>;
  const allowed = Array.isArray(s.ai_agent_allowed_models) ? (s.ai_agent_allowed_models as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  const defaultModel = typeof s.ai_agent_default_model === 'string' && s.ai_agent_default_model ? s.ai_agent_default_model : 'auto';
  return { allowed, defaultModel, fable: s.ai_fable_enabled === true };
}

// ---------------------------------------------------------------- creation

/** Records written by the server directly (agent-owned pages): set ops → records, persisted and broadcast. */
export function persistCreated(ops: Operation[], spaceId: string) {
  const values = new Map<string, { table: 'block' | 'collection' | 'collection_view'; rec: BaseRecord }>();
  for (const op of ops) {
    const key = `${op.pointer.table}:${op.pointer.id}`;
    const before = values.get(key)?.rec ?? getRecord(op.pointer.table, op.pointer.id);
    const after = applyOperation(before, op);
    if (after) values.set(key, { table: op.pointer.table as 'block', rec: after });
  }
  const changes = [];
  for (const { table, rec } of values.values()) {
    const prev = getRecord(table, rec.id);
    const next = { ...rec, version: (prev?.version ?? 0) + 1, space_id: (rec as any).space_id ?? spaceId } as BaseRecord;
    putRecord(table, next);
    if (table === 'block') indexBlock(next as BlockRecord);
    changes.push({ table, record: next, spaceId });
  }
  realtime.broadcastChanges(changes);
}

/** Retire an agent-owned page (an instructions page replaced by a restored version). */
export function retireBlock(id: string) {
  const b = getRecord<BlockRecord>('block', id);
  if (!b || b.alive === false) return;
  const next = { ...b, alive: false, version: (b.version ?? 0) + 1 } as BlockRecord;
  putRecord('block', next);
  indexBlock(next);
  realtime.broadcastChanges([{ table: 'block', record: next, spaceId: next.space_id }]);
}

/** A new instructions page for an agent (parent = the agent; people get the agent's sharing levels on it). */
export function createInstructionsPage(agentId: string, spaceId: string, userId: string, markdown: string, title = 'Instructions'): string {
  const b = new OpsBuilder(spaceId, userId);
  const children = markdownToSpecs(markdown.trim() ? markdown : '');
  const id = b.block({ type: 'page', text: title, children }, agentId, 'workflow' as any);
  persistCreated(b.ops, spaceId);
  return id;
}

export interface CreateAgentInput {
  spaceId: string;
  userId: string;
  config?: Partial<AgentConfig>;
  instructions?: string;
  templateId?: string;
  /** created already saved (duplicates of saved agents, templates applied by the server) */
  published?: boolean;
  permissions?: Permission[];
}

export function createAgent(input: CreateAgentInput): AgentRecord {
  const now = Date.now();
  const id = newId();
  const botId = newId();
  const policy = agentModelPolicy(getRecord<SpaceRecord>('space', input.spaceId));
  const base = cleanConfig({ ...defaultConfig(), model: policy.defaultModel, ...(input.config ?? {}) });
  const agent: AgentRecord = {
    id, version: 0, space_id: input.spaceId, parent_id: input.spaceId, parent_table: 'space', alive: true,
    created_by_id: input.userId, created_time: now, last_edited_by_id: input.userId, last_edited_time: now,
    permissions: input.permissions ?? [{ type: 'user_permission', role: 'editor', user_id: input.userId, added_timestamp: now }],
    bot_id: botId, data: base, draft: null, published: !!input.published, status: 'active', owner_id: input.userId,
    ...(input.templateId ? { template_id: input.templateId } : {}),
  };
  // the bot exists before anything can reference it
  botMap().set(botId, id);
  const pageId = createInstructionsPage(id, input.spaceId, input.userId, input.instructions ?? '');
  agent.data = { ...agent.data, instructions_page_id: pageId };
  const saved = saveAgentRecord(agent);
  syncBotUser(saved);
  return saved;
}

// ---------------------------------------------------------------- versions 

export interface AgentVersion {
  id: string;
  agentId: string;
  createdTime: number;
  createdBy: string | null;
  config: AgentConfig;
  changes: ConfigChange[];
  instructions: string | null;
}

const toVersion = (r: any): AgentVersion => ({
  id: r.id, agentId: r.agent_id, createdTime: r.created_time, createdBy: r.created_by ?? null, config: JSON.parse(r.config), changes: JSON.parse(r.changes), instructions: r.instructions ?? null,
});

export function recordVersion(agent: AgentRecord, userId: string | null, changes: ConfigChange[], instructions: string | null): AgentVersion {
  const id = newId();
  const now = Date.now();
  db.prepare('INSERT INTO agent_versions (id, agent_id, created_time, created_by, config, changes, instructions) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, agent.id, now, userId, JSON.stringify(agent.data), JSON.stringify(changes), instructions);
  // keep the last 200 versions
  db.prepare('DELETE FROM agent_versions WHERE agent_id = ? AND created_time < (SELECT MIN(created_time) FROM (SELECT created_time FROM agent_versions WHERE agent_id = ? ORDER BY created_time DESC LIMIT 200))').run(agent.id, agent.id);
  return { id, agentId: agent.id, createdTime: now, createdBy: userId, config: agent.data, changes, instructions };
}

export function listVersions(agentId: string, limit = 100): AgentVersion[] {
  return (db.prepare('SELECT * FROM agent_versions WHERE agent_id = ? ORDER BY created_time DESC LIMIT ?').all(agentId, Math.max(1, Math.min(200, limit))) as any[]).map(toVersion);
}

export function getVersion(id: string): AgentVersion | null {
  const r = db.prepare('SELECT * FROM agent_versions WHERE id = ?').get(String(id)) as any;
  return r ? toVersion(r) : null;
}

/** Labels for a change list (names of granted pages and connected agents). */
export function changesBetween(prev: AgentConfig | null | undefined, next: AgentConfig): ConfigChange[] {
  return configChanges(prev, next, {
    block: (id) => {
      const b = getRecord<BlockRecord>('block', id);
      if (!b) return '';
      if ((b.type === 'collection_view_page' || b.type === 'collection_view') && b.collection_id) {
        const name = toPlainText((getRecord<any>('collection', b.collection_id) as { name?: any } | undefined)?.name);
        if (name) return name;
      }
      return toPlainText(b.properties?.title) || 'Untitled';
    },
    agent: (id) => getAgent(id)?.data.name ?? 'agent',
  });
}

// ---------------------------------------------------------------- per-person state (favorites, recent visits)

export function setFavorite(userId: string, agentId: string, on: boolean) {
  db.prepare(`INSERT INTO agent_user_state (user_id, agent_id, favorite_time) VALUES (?, ?, ?)
              ON CONFLICT(user_id, agent_id) DO UPDATE SET favorite_time = excluded.favorite_time`).run(userId, agentId, on ? Date.now() : null);
}

export function noteVisit(userId: string, agentId: string) {
  db.prepare(`INSERT INTO agent_user_state (user_id, agent_id, visited_time) VALUES (?, ?, ?)
              ON CONFLICT(user_id, agent_id) DO UPDATE SET visited_time = excluded.visited_time`).run(userId, agentId, Date.now());
}

export function userAgentState(userId: string): Map<string, { favorite: number | null; visited: number | null }> {
  const out = new Map<string, { favorite: number | null; visited: number | null }>();
  for (const r of db.prepare('SELECT agent_id, favorite_time, visited_time FROM agent_user_state WHERE user_id = ?').all(userId) as any[]) {
    out.set(r.agent_id, { favorite: r.favorite_time ?? null, visited: r.visited_time ?? null });
  }
  return out;
}

/** Agents a person can use in a workspace (shared with them), newest activity first. */
export function agentsFor(spaceId: string, userId: string, opts: { includeDeleted?: boolean } = {}): AgentRecord[] {
  return agentsInSpace(spaceId, opts).filter((a) => agentRole(a, userId) !== 'none');
}

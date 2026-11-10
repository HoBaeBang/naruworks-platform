// Custom Agent permissions, enforced on the server:
//   - an agent acts as its own principal (its bot user): effectiveRole(…, botId) is answered here — the agent reaches
//     exactly the pages / databases granted in Tools and access (with the granted level, inherited by sub-pages and
//     database rows like any share), "Pages shared with everyone in <workspace>" at most Can view when that is on,
//     and its own instructions page. Never the creator's or the caller's access; other workspaces never.
//   - instructions pages (parent = the agent) give people the agent's sharing level: Full access / Can edit → edit,
//     Can view and interact → view.
//   - granting: you can't grant more access than you have, and more than Can view needs Full access .
//   - editor access check : every granted resource needs at least one agent editor who can open it, and
//     the agent's role on a block never exceeds the best role its editors have there (the creator cap) — database rows
//     included (page-level access rules are part of the editors' roles) and, through property access, every property:
//     the agent sees / edits a property at most like the best of its editors would .
import { effectiveRole, maxRole, registerPrincipalResolver, registerRoleExtension, roleAtLeast, teamAccessType, type PermissionLookup } from '@nc/shared/permissions.ts';
import { groupIdsOf, propertyRoleFor, registerPropertyRoleCap, type PropertyRole } from '@nc/shared/database/propertyAccess.ts';
import type { BlockRecord, CollectionRecord, Role, SpaceRecord } from '@nc/shared/records.ts';
import type { AgentRecord, GrantRole } from '@nc/shared/agents.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { agentByBot, agentPeople, agentRole, agentsInSpace, getAgent, isBotId } from './model.ts';

const PAGE_TYPES = new Set(['page', 'collection_view_page', 'collection_view']);

/** grants of an agent's live configuration as a map (cached per record version) */
const grantCache = new Map<string, { version: number; map: Map<string, GrantRole> }>();
function grantsOf(agent: AgentRecord): Map<string, GrantRole> {
  const hit = grantCache.get(agent.id);
  if (hit && hit.version === agent.version) return hit.map;
  const map = new Map(agent.data.grants.map((g) => [g.block_id, g.role] as const));
  grantCache.set(agent.id, { version: agent.version, map });
  if (grantCache.size > 5000) grantCache.clear();
  return map;
}

/**
 * The agent's role on block `id` (`lookup` = the caller's view of records, e.g. TxGuard's in-call state).
 * Walks the parent chain like effectiveRole: grants on an ancestor apply below it, a page whose sharing was unlinked
 * from its parent stops the inheritance.
 */
export function agentBlockRole(lookup: PermissionLookup, agent: AgentRecord, id: string): Role {
  if (agent.alive === false) return 'none';
  const grants = grantsOf(agent);
  let role: Role = 'none';
  let everyone = false;
  let cur = lookup.block(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id) && seen.size < 2000) {
    seen.add(cur.id);
    if (cur.space_id !== agent.space_id) return 'none';
    const g = grants.get(cur.id);
    if (g) role = maxRole(role, g);
    if (cur.permissions?.some((p) => p?.type === 'space_permission' && p.role !== 'none')) everyone = true;
    const pt = cur.parent_table as string;
    if (pt === 'workflow') {
      // instructions pages: the agent's own is fully editable by it ("memory"), other agents' are not reachable
      if (cur.parent_id === agent.id) role = maxRole(role, 'editor');
      break;
    }
    if ((cur as { permissions_unlinked?: boolean }).permissions_unlinked) break;
    if (pt === 'space') {
      // legacy workspace-level pages (no explicit sharing) are shared with every member
      if (!cur.permissions?.length) everyone = true;
      break;
    }
    if (pt === 'team') {
      const t = lookup.team(cur.parent_id);
      if (t && t.alive !== false && !t.archived_by && teamAccessType(t) === 'open' && (t.settings?.workspace_page_role ?? 'read_and_write') !== 'none') everyone = true;
      break;
    }
    if (pt === 'collection' || pt === 'block') {
      const parentId = pt === 'collection' ? lookup.collection(cur.parent_id)?.parent_id : cur.parent_id;
      cur = parentId ? lookup.block(parentId) : undefined;
      continue;
    }
    break;
  }
  if (everyone && agent.data.workspace_access === 'reader') role = maxRole(role, 'reader');
  return role;
}

/**
 * The most the agent's editors (people with Full access / Can edit on the agent) may do on block `id`: an agent never
 * acts beyond the people who manage it, even when one of them loses access after granting (cached briefly — role
 * checks run for every block an agent reads or writes).
 */
const capCache = new Map<string, { at: number; role: Role }>();
export function editorCap(lookup: PermissionLookup, agent: AgentRecord, id: string): Role {
  const key = `${agent.id}:${agent.version}:${id}`;
  const hit = capCache.get(key);
  if (hit && Date.now() - hit.at < 2000) return hit.role;
  let cap: Role = 'none';
  for (const uid of agentPeople(agent, 'read_and_write', 50)) {
    cap = maxRole(cap, effectiveRole(lookup, id, uid));
    if (cap === 'editor') break;
  }
  if (capCache.size > 5000) capCache.clear();
  capCache.set(key, { at: Date.now(), role: cap });
  return cap;
}

registerPrincipalResolver((lookup, id, principalId) => {
  if (!isBotId(principalId)) return null;
  const agent = agentByBot(principalId);
  if (!agent) return 'none';
  const role = agentBlockRole(lookup, agent, id);
  if (role === 'none') return role;
  // grants, capped by what the agent's editors can do there
  const cap = editorCap(lookup, agent, id);
  return roleAtLeast(cap, role) ? role : cap;
});

// Property access  gets the same cap: someone excluded from a property by a per-person or group rule can't
// read it (or write it) through an agent they edit. The editors are judged with the agent's database / row roles
// (already capped by theirs), their own exceptions and groups.
const PROP_RANK: Record<string, number> = { none: 0, schema_only: 0.5, reader: 1, comment_only: 2, content_only_editor: 2.5, read_and_write: 3, editor: 4 };
// the editors and their groups, cached briefly (a query reads many rows × properties)
const editorsCache = new Map<string, { at: number; editors: { id: string; groups: string[] }[] }>();
function editorsOf(agent: AgentRecord): { id: string; groups: string[] }[] {
  const key = `${agent.id}:${agent.version}`;
  const hit = editorsCache.get(key);
  if (hit && Date.now() - hit.at < 2000) return hit.editors;
  const space = getRecord<SpaceRecord>('space', agent.space_id);
  const editors = agentPeople(agent, 'read_and_write', 50).map((id) => ({ id, groups: groupIdsOf(space, id) }));
  if (editorsCache.size > 2000) editorsCache.clear();
  editorsCache.set(key, { at: Date.now(), editors });
  return editors;
}
registerPropertyRoleCap((prop, ctx, role) => {
  const id = ctx.userId;
  if (!id || role === 'none' || !isBotId(id)) return role;
  const agent = agentByBot(id);
  if (!agent) return 'none';
  let cap: PropertyRole = 'none';
  for (const e of editorsOf(agent)) {
    const r = propertyRoleFor(prop, { ...ctx, userId: e.id, groupIds: e.groups });
    if ((PROP_RANK[r] ?? 0) > (PROP_RANK[cap] ?? 0)) cap = r;
    if ((PROP_RANK[cap] ?? 0) >= (PROP_RANK[role] ?? 0)) break;
  }
  return cap;
});

/** The agent whose instructions page holds this block (walks up to a parent_table 'workflow' root). */
export function instructionsAgentOf(lookup: PermissionLookup, id: string): AgentRecord | undefined {
  let cur = lookup.block(id);
  for (let i = 0; i < 64 && cur; i++) {
    const pt = cur.parent_table as string;
    if (pt === 'workflow') return getAgent(cur.parent_id);
    if (pt !== 'block') return undefined;
    cur = lookup.block(cur.parent_id);
  }
  return undefined;
}

registerRoleExtension((lookup, id, userId, role) => {
  // only blocks nobody shared otherwise: instructions pages have no other source of access
  if (role !== 'none' || !userId) return role;
  const agent = instructionsAgentOf(lookup, id);
  if (!agent || agent.alive === false) return role;
  const r = agentRole(agent, userId);
  return r === 'none' ? role : r === 'reader' ? 'reader' : r === 'read_and_write' ? 'read_and_write' : 'editor';
});

// ---------------------------------------------------------------- granting 

export function isShareable(b: BlockRecord | undefined): boolean {
  return !!b && b.alive !== false && PAGE_TYPES.has(b.type) && b.parent_table !== ('workflow' as BlockRecord['parent_table']);
}

/** Why `userId` may not give an agent `role` on `blockId` (null = allowed). */
export function grantProblem(userId: string, spaceId: string, blockId: string, role: GrantRole): string | null {
  const b = getRecord<BlockRecord>('block', blockId);
  if (!b || b.alive === false || b.space_id !== spaceId) return 'This page doesn’t exist or you can’t access it.';
  if (!isShareable(b)) return 'Only pages and databases can be shared with an agent.';
  const mine = blockRole(blockId, userId);
  if (mine === 'none') return 'This page doesn’t exist or you can’t access it.';
  if (!roleAtLeast(mine, role)) return 'You can only share access you already have.';
  if (role !== 'reader' && !roleAtLeast(mine, 'editor')) return 'Full access is required to share with a custom agent.';
  // Share › Advanced › Agent access settings: "Only people with Full access" (on the page or an ancestor)
  if (mine !== 'editor' && agentAccessPolicy(b) === 'full_access') return 'Only people with Full access can give agents access to this page';
  return null;
}

/** The nearest "Who can grant agents access" setting up the page tree ('anyone' when none is set). */
export function agentAccessPolicy(b: BlockRecord): 'anyone' | 'full_access' {
  let cur: BlockRecord | undefined = b;
  for (let i = 0; i < 100 && cur; i++) {
    const p = cur.format?.agent_access_policy;
    if (p === 'full_access' || p === 'anyone') return p;
    if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const c = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = c ? getRecord<BlockRecord>('block', c.parent_id) : undefined;
    } else break;
  }
  return 'anyone';
}

export function blockLabel(id: string): string {
  const b = getRecord<BlockRecord>('block', id);
  if (!b) return 'Untitled';
  if ((b.type === 'collection_view_page' || b.type === 'collection_view') && b.collection_id) {
    const name = toPlainText(getRecord<CollectionRecord>('collection', b.collection_id)?.name);
    if (name) return name;
  }
  return toPlainText(b.properties?.title).replace(/[‣⁍]/g, '').trim() || 'Untitled';
}

// ---------------------------------------------------------------- editor access check 

export interface AccessCheck {
  ok: boolean;
  /** "To use this agent, you need to grant at least one person access to edit it." */
  noEditors?: boolean;
  /** granted resources none of the agent's editors can open */
  orphanedResources?: { blockId: string; title: string }[];
  message?: string;
}

export function editorAccessCheck(agent: AgentRecord): AccessCheck {
  const editors = agentPeople(agent, 'read_and_write', 300);
  if (!editors.length) {
    return { ok: false, noEditors: true, message: 'This agent needs at least one editor before it can run. Add one in its Share settings, then try again.' };
  }
  const orphaned: { blockId: string; title: string }[] = [];
  for (const g of agent.data.grants) {
    const b = getRecord<BlockRecord>('block', g.block_id);
    if (!b || b.alive === false) continue;
    if (!editors.some((uid) => blockRole(g.block_id, uid) !== 'none')) orphaned.push({ blockId: g.block_id, title: blockLabel(g.block_id) });
  }
  if (orphaned.length) {
    return {
      ok: false, orphanedResources: orphaned,
      message: `This agent can reach resources its editors cannot. Grant an editor access to ${orphaned.map((o) => o.title).join(', ')} and try again.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- page Share menu 

export interface PageAgentAccess {
  agentId: string;
  name: string;
  icon?: string;
  role: Role;
  /** granted on this page itself (removable here) vs inherited from a parent page */
  direct: boolean;
  /** inherited through "Pages shared with everyone" */
  viaWorkspace: boolean;
  /** the viewer can open the agent */
  canOpen: boolean;
}

/** records as stored (outside a transaction) */
const storeLookup: PermissionLookup = {
  block: (id) => getRecord<BlockRecord>('block', id),
  space: (id) => getRecord('space', id) as any,
  team: (id) => getRecord('team', id) as any,
  collection: (id) => getRecord<CollectionRecord>('collection', id),
};

/**
 * Settings › Content search › "Shared with" an agent : the agent's access to a page — its grants (inherited
 * like any share) and "Pages shared with everyone" when that is on. 'none' for another workspace's or a deleted agent.
 */
export function agentPageRole(agentId: string, pageId: string, spaceId: string): Role {
  const agent = getAgent(agentId);
  if (!agent || agent.space_id !== spaceId) return 'none';
  return agentBlockRole(storeLookup, agent, pageId);
}

/** Agents that can reach a page (its Share menu "Agents" section). */
export function pageAgents(pageId: string, viewerId: string): PageAgentAccess[] {
  const page = getRecord<BlockRecord>('block', pageId);
  if (!page) return [];
  const lookup = storeLookup;
  const out: PageAgentAccess[] = [];
  for (const a of agentsInSpace(page.space_id)) {
    const role = agentBlockRole(lookup, a, pageId);
    if (role === 'none') continue;
    const direct = a.data.grants.some((g) => g.block_id === pageId);
    // reachable only through "Pages shared with everyone" (not removable from this page's Share menu)
    const viaWorkspace = a.data.workspace_access === 'reader' && agentBlockRole(lookup, { ...a, version: -1, data: { ...a.data, workspace_access: 'none' } }, pageId) === 'none';
    out.push({ agentId: a.id, name: a.data.name, icon: a.data.icon, role, direct, viaWorkspace, canOpen: agentRole(a, viewerId) !== 'none' });
  }
  return out;
}

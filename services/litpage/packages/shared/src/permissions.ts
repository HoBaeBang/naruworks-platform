// Effective role resolution: walk block parents until explicit permissions or the space/team.
import type { BlockRecord, Permission, Role, SpaceRecord, TeamRecord } from './records.ts';

// content_only_editor = databases' "Can edit content" (rows editable, views/schema not; see database/access.ts)
const RANK: Record<string, number> = { none: 0, reader: 1, comment_only: 2, content_only_editor: 2.5, read_and_write: 3, editor: 4, membership_admin: 5, owner: 6 };

export function maxRole(a: string, b: string): Role {
  return ((RANK[a] ?? 0) >= (RANK[b] ?? 0) ? a : b) as Role;
}

export function roleAtLeast(role: string | undefined, min: Role): boolean {
  return (RANK[role ?? 'none'] ?? 0) >= (RANK[min] ?? 0);
}

export interface PermissionLookup {
  block(id: string): BlockRecord | undefined;
  space(id: string): SpaceRecord | undefined;
  team(id: string): TeamRecord | undefined;
  collection(id: string): { parent_id: string } | undefined;
}

export function spaceRoleFor(space: SpaceRecord | undefined, userId: string): Role {
  if (!space) return 'none';
  let role: Role = 'none';
  for (const p of space.permissions ?? []) {
    if (p.type === 'user_permission' && p.user_id === userId) {
      const r = p.role === ('owner' as Role) || p.role === ('membership_admin' as Role) ? 'editor' : p.role;
      role = maxRole(role, r);
    }
  }
  return role;
}

export function isSpaceMember(space: SpaceRecord | undefined, userId: string): boolean {
  return !!space?.permissions?.some((p) => p.type === 'user_permission' && p.user_id === userId && p.role !== 'none');
}

export function isSpaceAdmin(space: SpaceRecord | undefined, userId: string): boolean {
  return !!space?.permissions?.some((p) => p.type === 'user_permission' && p.user_id === userId && ((p.role as string) === 'owner' || (p.role as string) === 'membership_admin'));
}

/**
 * Restricted member (Settings › People, Enterprise; space user_permission role 'restricted_member'): a member who only
 * sees what is shared with them — no "Everyone at workspace" access, no access to or browsing of teamspaces they
 * aren't in, no workspace-level pages (spaceRoleFor gives them 'none').
 */
export function isRestrictedMember(space: SpaceRecord | undefined, userId: string | null | undefined): boolean {
  return !!userId && !!space?.permissions?.some((p) => p.type === 'user_permission' && p.user_id === userId && (p.role as string) === 'restricted_member');
}

// ---------------------------------------------------------------- teamspaces
// Access levels (Teamspace settings › Permissions):
// open — every workspace member sees the teamspace and can join it; non-members get the
// "everyone else in workspace" role on its pages (settings.workspace_page_role, default Can edit)
// closed — every workspace member sees the teamspace, but only members see its content; others ask to join
// ("Request" → teamspace owners approve in their Inbox)
// private — only members (and workspace owners/admins, for management) know it exists
// Teamspace owners always have full access to the teamspace's pages; members get settings.default_page_role.
export type TeamAccess = 'open' | 'closed' | 'private';
const PAGE_ROLES = new Set<string>(['editor', 'read_and_write', 'comment_only', 'reader', 'none']);

export function teamAccessType(team: Pick<TeamRecord, 'settings'> | undefined): TeamAccess {
  const t = team?.settings?.type;
  return t === 'closed' || t === 'private' ? t : 'open';
}

export function teamMembership(team: Pick<TeamRecord, 'membership'> | undefined, userId: string | null | undefined) {
  return userId ? team?.membership?.find((m) => m?.user_id === userId) : undefined;
}

/** Role a user gets on the top-level pages of a teamspace through the teamspace itself (explicit page sharing aside). */
export function teamPageRole(team: TeamRecord | undefined, userId: string | null | undefined, spaceMember: boolean): Role {
  if (!team || !userId) return 'none';
  const m = teamMembership(team, userId);
  if (m) {
    if (m.role === 'owner') return 'editor';
    const r = team.settings?.default_page_role as string | undefined;
    return (r && PAGE_ROLES.has(r) ? r : 'editor') as Role;
  }
  if (!spaceMember || team.archived_by || teamAccessType(team) !== 'open') return 'none';
  const r = team.settings?.workspace_page_role as string | undefined;
  return (r && PAGE_ROLES.has(r) ? r : 'read_and_write') as Role;
}

/** Whether a workspace member sees a teamspace at all (browse lists, sidebar, settings). */
export function teamVisibleTo(team: TeamRecord | undefined, space: SpaceRecord | undefined, userId: string | null | undefined): boolean {
  if (!team || !userId || team.alive === false || !isSpaceMember(space, userId)) return false;
  if (teamMembership(team, userId)) return true;
  if (isRestrictedMember(space, userId)) return false; // restricted members only see their own teamspaces
  return teamAccessType(team) !== 'private' || isSpaceAdmin(space, userId);
}

/** "Join" (open teamspaces) vs "Request" (closed) vs nothing (private, archived, already a member). */
export function teamJoinMode(team: TeamRecord | undefined, space: SpaceRecord | undefined, userId: string | null | undefined): 'member' | 'join' | 'request' | 'none' {
  if (!team || !userId || !isSpaceMember(space, userId) || team.alive === false) return 'none';
  if (teamMembership(team, userId)) return 'member';
  if (team.archived_by || isRestrictedMember(space, userId)) return 'none';
  const a = teamAccessType(team);
  return a === 'open' ? 'join' : a === 'closed' ? 'request' : 'none';
}

/** Permission groups (Settings › People › Groups, space.settings.groups) the user belongs to. */
export function groupIdsOf(space: SpaceRecord | undefined, userId: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const groups = (space?.settings as { groups?: { id?: string; member_ids?: string[] }[] } | undefined)?.groups;
  if (!userId || !Array.isArray(groups)) return out;
  for (const g of groups) if (g && typeof g.id === 'string' && Array.isArray(g.member_ids) && g.member_ids.includes(userId)) out.add(g.id);
  return out;
}

function rolesFrom(perms: Permission[] | undefined, userId: string, member: boolean, publicOk: boolean, groups?: Set<string>, teamOf?: (id: string) => TeamRecord | undefined, fullMember = member): Role | null {
  if (!Array.isArray(perms) || perms.length === 0) return null;
  let role: Role = 'none';
  let explicit = false;
  for (const p of perms) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'user_permission' && userId && p.user_id === userId) { role = maxRole(role, p.role as Role); explicit = true; }
    // group sharing: members of the group — only while they are members of the page's workspace
    else if (p.type === 'group_permission' && member && p.group_id && groups?.has(p.group_id)) { role = maxRole(role, p.role as Role); explicit = true; }
    // a teamspace's members (written when a page stops inheriting from a teamspace)
    else if (p.type === 'team_permission' && member && p.team_id && teamOf && teamMembership(teamOf(p.team_id), userId)) { role = maxRole(role, p.role as Role); explicit = true; }
    // "Everyone at <workspace>": full members only (not restricted members)
    else if (p.type === 'space_permission' && fullMember) { role = maxRole(role, p.role as Role); explicit = true; }
    else if (p.type === 'public_permission' && publicOk) {
      // "Link expires" (Share / Publish settings): an expired web link grants nothing
      if (p.expiry_time && p.expiry_time < Date.now()) continue;
      // a web link never grants full access (sharing changes) to arbitrary visitors: at most "can edit"
      role = maxRole(role, (RANK[p.role] ?? 0) > RANK.read_and_write ? 'read_and_write' : (p.role as Role));
      explicit = true;
    }
  }
  return explicit ? role : null;
}

/**
 * Whether web links of a page are switched off: its teamspace disables publishing (Teamspace settings › Security), or
 * the workspace does and the teamspace doesn't explicitly allow it (a workspace owner's override).
 */
export function publicLinksOff(lookup: PermissionLookup, space: SpaceRecord | undefined, start: BlockRecord | undefined): boolean {
  let team: TeamRecord | undefined;
  let cur = start;
  for (let i = 0; cur && i < 200; i++) {
    if (cur.parent_table === 'team') {
      team = lookup.team(cur.parent_id);
      break;
    }
    if (cur.parent_table === 'block') cur = lookup.block(cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const c = lookup.collection(cur.parent_id);
      cur = c ? lookup.block(c.parent_id) : undefined;
    } else break;
  }
  const flag = (team?.settings as Record<string, unknown> | undefined)?.disable_public_access;
  if (flag === true) return true;
  return !!space?.disable_public_access && flag !== false;
}

/**
 * Effective role of `userId` on block `id`.
 * - explicit permissions on any ancestor are unioned (sharing is inherited and added down the tree), except below a
 * page whose sharing was "unlinked" from its parent (block.permissions_unlinked) to restrict it
 * - private pages (parent space, user_permission only) are visible only to listed users
 * - workspace-level pages fall back to the member's space role; team pages to team membership
 */
export function effectiveRole(lookup: PermissionLookup, id: string, userId: string | null): Role {
  // principals that aren't people (Custom Agent bots) resolve their role from their own grants only
  // (several kinds may register: Custom Agent bots, API connection bots — the first non-null answer wins)
  if (userId) {
    for (const resolve of principalResolvers) {
      const principal = resolve(lookup, id, userId);
      if (principal !== null) return principal;
    }
  }
  let role: Role = 'none';
  let cur = lookup.block(id);
  const seen = new Set<string>();
  let linksOff: boolean | undefined; // resolved the first time a web link is met
  while (cur && !seen.has(cur.id) && seen.size < 2000) {
    seen.add(cur.id);
    const space = lookup.space(cur.space_id);
    const member = !!userId && isSpaceMember(space, userId);
    const full = member && !isRestrictedMember(space, userId);
    // Settings › Security (workspace or teamspace) › "Disable publishing sites, forms, and public links": web links grant nothing
    if (linksOff === undefined && cur.permissions?.some((p) => p?.type === 'public_permission')) linksOff = publicLinksOff(lookup, space, cur);
    const r = rolesFrom(cur.permissions, userId ?? '', member, !linksOff, member && cur.permissions?.some((p) => p?.type === 'group_permission') ? groupIdsOf(space, userId) : undefined, (tid) => lookup.team(tid), full);
    if (r) role = maxRole(role, r);
    // "unlinked" pages (restricted below their parent) don't inherit: their own list is complete
    if ((cur as { permissions_unlinked?: boolean }).permissions_unlinked) break;
    if (cur.parent_table === 'space') {
      if (!cur.permissions?.length && userId && member) role = maxRole(role, spaceRoleFor(space, userId));
      break;
    }
    if (cur.parent_table === 'team') {
      // closed / private teamspaces: only members (and people the page is shared with explicitly) see content
      role = maxRole(role, teamPageRole(lookup.team(cur.parent_id), userId, full));
      break;
    }
    if (cur.parent_table === 'collection' || cur.parent_table === 'block') {
      // rows inherit from the database block; collection's parent is the collection_view block
      const parentId = cur.parent_table === 'collection' ? lookup.collection(cur.parent_id)?.parent_id : cur.parent_id;
      cur = parentId ? lookup.block(parentId) : undefined;
      continue;
    }
    break;
  }
  for (const ext of roleExtensions) role = ext(lookup, id, userId, role);
  return role;
}

/** Extra grants on top of the inherited role (database page-level access rules, "Can edit content" on rows,
 * "Can create" — packages/shared/src/database/access.ts). Extensions may only raise the role. */
export type RoleExtension = (lookup: PermissionLookup, id: string, userId: string | null, role: Role) => Role;
const roleExtensions: RoleExtension[] = [];
export function registerRoleExtension(fn: RoleExtension) {
  if (!roleExtensions.includes(fn)) roleExtensions.push(fn);
}

/** Role of a non-person principal (a Custom Agent's bot user) on a block, or null when `principalId` is a person. */
export type PrincipalResolver = (lookup: PermissionLookup, id: string, principalId: string) => Role | null;
const principalResolvers: PrincipalResolver[] = [];
export function registerPrincipalResolver(fn: PrincipalResolver) {
  if (!principalResolvers.includes(fn)) principalResolvers.push(fn);
}

// Workspace policies chosen in Settings (Security, Teamspaces, General › Analytics, Connections) and enforced on the
// server. Every guarded path calls policyProblem / assertWorkspacePolicy, so a toggle can't be bypassed by calling
// the API directly; the web client reads the same flags (features/settings/spaceSettings.ts) to disable menu items.
//
// Where the flags live:
// space.disable_public_access Security › Disable publishing sites, forms, and public links
// space.disable_export Security › Disable export
// space.disable_guests Members & guests › Allow members to invite guests to pages (off = true)
// space.settings.disable_move_to_space Security › Disable duplicating pages to other workspaces
// space.settings.allow_guest_invite_requests Members & guests › Allow members to request to invite guests
// space.settings.allow_access_requests Security › Allow non-members to request page access (default on)
// space.settings.allow_member_requests / allow_external_member_requests / allow_guest_member_requests
// space.settings.limit_team_creation Teamspaces › Limit teamspace creation to only workspace owners
// space.settings.restrict_group_creation Security › only owners / membership admins create groups
// space.settings.page_view_analytics General › Analytics › Save and display page view analytics (default on)
// space.settings.disallow_webhook_automation_action Connections › Manage › Allow webhooks in automations (off = true)
// team.settings.disable_public_access / disable_export / disable_guests Teamspace settings › Security (stricter only)
// space.settings.restricted_members_teamspaces Security › Who can add restricted members to Teamspaces
// ('space_owner' | 'space_owner_and_team_owner' (default) | 'member')
// space.settings.restricted_members_pages Security › Who can add restricted members to pages
// ('space_owner' | 'member_with_admin_approval' (default) | 'member')
import { isRestrictedMember, isSpaceAdmin, isSpaceMember } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, Permission, SpaceRecord, TeamRecord } from '@nc/shared/records.ts';
import { db, getRecord } from './db.ts';

export type PolicyAction =
  | 'export'
  | 'publish'
  | 'duplicate_to_other_workspace'
  | 'invite_guest'
  | 'request_guest'
  | 'access_request'
  | 'member_request'
  | 'external_member_request'
  | 'guest_member_request'
  | 'create_teamspace'
  | 'create_group'
  | 'page_view_analytics'
  | 'webhook';

/** Thrown by assertWorkspacePolicy; app.ts maps `status` to the HTTP response (403 PermissionError). */
export class PolicyError extends Error {
  status = 403;
}

export function spaceSetting<T>(space: SpaceRecord | undefined, key: string, fallback: T): T {
  const v = (space?.settings as Record<string, unknown> | undefined)?.[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

export function spaceRoleOf(space: SpaceRecord | undefined, userId: string | null | undefined): string {
  if (!space || !userId) return 'none';
  return (space.permissions ?? []).find((p) => p.type === 'user_permission' && p.user_id === userId)?.role ?? 'none';
}

export function isSpaceOwner(space: SpaceRecord | undefined, userId: string | null | undefined): boolean {
  return spaceRoleOf(space, userId) === 'owner';
}

export interface WorkspacePolicy {
  publishDisabled: boolean;
  exportDisabled: boolean;
  duplicateToOtherWorkspaceDisabled: boolean;
  guestsDisabled: boolean;
  guestInviteRequests: boolean;
  accessRequests: boolean;
  memberRequests: boolean;
  externalMemberRequests: boolean;
  guestMemberRequests: boolean;
  teamCreationOwnersOnly: boolean;
  groupCreationAdminsOnly: boolean;
  pageViewAnalytics: boolean;
  webhooksAllowed: boolean;
}

export function workspacePolicy(space: SpaceRecord | undefined): WorkspacePolicy {
  return {
    publishDisabled: !!space?.disable_public_access,
    exportDisabled: !!space?.disable_export,
    duplicateToOtherWorkspaceDisabled: !!spaceSetting(space, 'disable_move_to_space', false),
    guestsDisabled: !!space?.disable_guests,
    guestInviteRequests: !!spaceSetting(space, 'allow_guest_invite_requests', false),
    accessRequests: spaceSetting<boolean>(space, 'allow_access_requests', true) !== false,
    memberRequests: spaceSetting<boolean>(space, 'allow_member_requests', true) !== false,
    externalMemberRequests: !!spaceSetting(space, 'allow_external_member_requests', false),
    guestMemberRequests: spaceSetting<boolean>(space, 'allow_guest_member_requests', true) !== false,
    teamCreationOwnersOnly: !!spaceSetting(space, 'limit_team_creation', false),
    groupCreationAdminsOnly: !!spaceSetting(space, 'restrict_group_creation', false),
    pageViewAnalytics: spaceSetting<boolean>(space, 'page_view_analytics', true) !== false,
    webhooksAllowed: !spaceSetting(space, 'disallow_webhook_automation_action', false),
  };
}

/** The teamspace a page lives in (walking up through parent pages and databases), if any. */
export function teamOfBlock(blockId: string | undefined | null, lookup: (table: 'block' | 'collection' | 'team', id: string) => any = (t, id) => getRecord(t, id)): TeamRecord | undefined {
  let cur: BlockRecord | undefined = blockId ? lookup('block', blockId) : undefined;
  for (let i = 0; i < 200 && cur; i++) {
    if (cur.parent_table === 'team') return lookup('team', cur.parent_id) as TeamRecord | undefined;
    if (cur.parent_table === 'block') cur = lookup('block', cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const col = lookup('collection', cur.parent_id) as CollectionRecord | undefined;
      cur = col ? lookup('block', col.parent_id) : undefined;
    } else return undefined;
  }
  return undefined;
}

function teamFlag(team: TeamRecord | undefined, key: string): boolean {
  return !!(team?.settings as Record<string, unknown> | undefined)?.[key];
}

/** Teamspace override of a workspace restriction: true = stricter, false = explicitly allowed, undefined = inherit. */
function teamOverride(team: TeamRecord | undefined, key: string): boolean | undefined {
  const v = (team?.settings as Record<string, unknown> | undefined)?.[key];
  return typeof v === 'boolean' ? v : undefined;
}

export interface PolicyOptions {
  /** page the action applies to (teamspace overrides) */
  pageId?: string;
  teamId?: string;
  /** destination workspace of a copy/move */
  targetSpaceId?: string;
  /** record lookup used inside a running transaction (authz TxGuard) */
  lookup?: (table: 'block' | 'collection' | 'team', id: string) => any;
}

/**
 * Why `userId` may not perform `action` in `space` (the policy explanation), or null when allowed.
 * Owners retain export and guest-invite abilities; everything else applies to everyone.
 */
export function policyProblem(space: SpaceRecord | undefined, action: PolicyAction, userId: string | null, opts: PolicyOptions = {}): string | null {
  if (!space) return null;
  const p = workspacePolicy(space);
  const team = opts.teamId ? (opts.lookup ?? ((t, id) => getRecord(t, id)))('team', opts.teamId) as TeamRecord | undefined : teamOfBlock(opts.pageId, opts.lookup);
  const admin = !!userId && isSpaceAdmin(space, userId);
  switch (action) {
    case 'export':
      // "Export is disabled by the workspace owner." — owners and membership admins can still export
      if (teamFlag(team, 'disable_export') && !admin) return 'Export is disabled for this team.';
      if (p.exportDisabled && teamOverride(team, 'disable_export') !== false && !admin) return 'Workspace exports are turned off.';
      return null;
    case 'publish':
      if (teamFlag(team, 'disable_public_access')) return 'Publishing is disabled in this team';
      if (p.publishDisabled && teamOverride(team, 'disable_public_access') !== false) return 'Public publishing is turned off in this workspace';
      return null;
    case 'duplicate_to_other_workspace':
      if (opts.targetSpaceId && opts.targetSpaceId === space.id) return null;
      return p.duplicateToOtherWorkspaceDisabled ? 'Moving pages to another workspace is disabled here' : null;
    case 'invite_guest':
      if (isSpaceOwner(space, userId)) return null;
      if (teamFlag(team, 'disable_guests')) return 'Members cannot invite guests to pages in this team. Ask an admin to send the invitation.';
      if (!p.guestsDisabled || teamOverride(team, 'disable_guests') === false) return null;
      return p.guestInviteRequests ? 'Guests must request an invitation' : 'Members cannot invite guests to pages here. Ask an admin to send the invitation.';
    case 'request_guest':
      return p.guestsDisabled && p.guestInviteRequests ? null : 'Guest invitation requests are currently disabled.';
    case 'access_request':
      return p.accessRequests ? null : 'Workspace owners have turned off page access requests.';
    case 'member_request':
      return p.memberRequests ? null : 'Workspace owners have turned off member requests.';
    case 'external_member_request':
      return p.externalMemberRequests ? null : 'Workspace owners have turned off membership requests.';
    case 'guest_member_request':
      return p.guestMemberRequests ? null : 'Workspace owners have turned off membership requests from guests.';
    case 'create_teamspace':
      if (isRestrictedMember(space, userId)) return 'You cannot create teams in this workspace.';
      return p.teamCreationOwnersOnly && !isSpaceOwner(space, userId) ? 'You cannot create teams in this workspace.' : null;
    case 'create_group':
      return p.groupCreationAdminsOnly && !admin ? 'Only workspace owners and membership admins can create groups.' : null;
    case 'page_view_analytics':
      return p.pageViewAnalytics ? null : 'Page view analytics are turned off for this workspace.';
    case 'webhook':
      return p.webhooksAllowed ? null : 'Webhooks in automations are turned off for this workspace.';
    default:
      return null;
  }
}

/** Throw a 403 PolicyError when the workspace policy forbids the action. Accepts a space record or id. */
export function assertWorkspacePolicy(spaceOrId: SpaceRecord | string | undefined | null, action: PolicyAction, userId: string | null, opts: PolicyOptions = {}): void {
  const space = typeof spaceOrId === 'string' ? getRecord<SpaceRecord>('space', spaceOrId) : spaceOrId ?? undefined;
  const problem = policyProblem(space, action, userId, opts);
  if (problem) throw new PolicyError(problem);
}

const PUBLIC_KEYS = ['role', 'published', 'allow_duplicate', 'allow_search_engine_indexing', 'expiry_time'] as const;

function publicSig(p: Permission | undefined): string {
  if (!p) return '';
  return PUBLIC_KEYS.map((k) => JSON.stringify((p as any)[k] ?? null)).join('|');
}

/**
 * Sharing changes on a page (block.permissions) checked against the workspace policy: new or widened public access
 * (publishing / "Anyone with the link") and new guests (people who aren't workspace members). Narrowing or removing
 * access is always allowed. Used by the transaction guard (authz.ts), so it covers the Share menu, API and AI paths.
 */
export function permissionChangeProblem(
  space: SpaceRecord | undefined, userId: string, pageId: string, before: Permission[] | undefined, after: Permission[] | undefined,
  lookup?: PolicyOptions['lookup'],
): string | null {
  if (!space || !Array.isArray(after)) return null;
  const prevPublic = (before ?? []).filter((p) => p?.type === 'public_permission' && p.role !== 'none');
  const nextPublic = after.filter((p) => p?.type === 'public_permission' && p.role !== 'none');
  const widened = nextPublic.some((p) => {
    const same = prevPublic.find((q) => !!q.published === !!p.published);
    return !same || publicSig(same) !== publicSig(p);
  });
  if (widened) {
    const problem = policyProblem(space, 'publish', userId, { pageId, lookup });
    if (problem) return problem;
  }
  const members = new Set((space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!));
  const had = new Set((before ?? []).filter((p) => p?.type === 'user_permission' && p.role !== 'none').map((p) => p.user_id));
  const newGuests = after.filter((p) => p?.type === 'user_permission' && p.role !== 'none' && p.user_id && !members.has(p.user_id) && !had.has(p.user_id)).map((p) => p.user_id!);
  if (newGuests.length) {
    const problem = policyProblem(space, 'invite_guest', userId, { pageId, lookup }) ?? freeGuestLimitProblem(space, newGuests);
    if (problem) return problem;
  }
  // Security › Who can add restricted members to pages (Enterprise)
  const newRestricted = after.some((p) => p?.type === 'user_permission' && p.role !== 'none' && p.user_id && !had.has(p.user_id) && isRestrictedMember(space, p.user_id));
  if (newRestricted) return restrictedPageAddProblem(space, userId);
  return null;
}

/** Free plan: at most FREE_GUEST_LIMIT guests in a workspace. */
export const FREE_GUEST_LIMIT = 10;

/** Distinct guests (people with page access who aren't members) of a workspace. */
export function workspaceGuests(spaceId: string, members: Set<string | undefined>): Set<string> {
  const out = new Set<string>();
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND data LIKE '%"user_permission"%' LIMIT 20000`).all(spaceId) as { data: string }[];
  for (const r of rows) {
    for (const p of (JSON.parse(r.data) as BlockRecord).permissions ?? []) {
      if (p.type === 'user_permission' && p.user_id && p.role !== 'none' && !members.has(p.user_id)) out.add(p.user_id);
    }
  }
  return out;
}

/** Adding `newGuests` would take a Free workspace past its guest limit: the message, or null. Checked for every
 * permission write (transaction guard), so direct writes and approved access requests count like Share › Invite. */
export function freeGuestLimitProblem(space: SpaceRecord | undefined, newGuests: string[]): string | null {
  if (!space || space.plan_type !== 'free' || !newGuests.length) return null;
  const members = new Set((space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role !== 'none').map((p) => p.user_id));
  const total = new Set([...workspaceGuests(space.id, members), ...newGuests]).size;
  return total > FREE_GUEST_LIMIT ? `Sharing would exceed this workspace’s guest limit (${FREE_GUEST_LIMIT} on the Free plan).` : null;
}

/** "Who can add restricted members to pages": Workspace owners / Any member with admin approval / Any member. */
export function restrictedPageAddProblem(space: SpaceRecord, userId: string): string | null {
  const who = spaceSetting<string>(space, 'restricted_members_pages', 'member_with_admin_approval');
  if (who === 'member') return null;
  if (who === 'space_owner') return isSpaceOwner(space, userId) ? null : 'Only workspace owners may add restricted members to pages.';
  return isSpaceAdmin(space, userId) ? null : 'A workspace owner must approve this restricted member first';
}

/**
 * Teamspace membership changes involving restricted members: they can't be teamspace owners, and "Who can add
 * restricted members to Teamspaces" decides who may add them (Workspace owners / Workspace and Teamspace owners /
 * Any member). `before` is undefined for a new teamspace (its creator owns it).
 */
export function restrictedTeamAddProblem(space: SpaceRecord | undefined, before: TeamRecord | undefined, after: TeamRecord, userId: string): string | null {
  if (!space) return null;
  const prev = new Map((before?.membership ?? []).map((m) => [m?.user_id, m?.role]));
  const changed = (after.membership ?? []).filter((m) => m && isRestrictedMember(space, m.user_id) && prev.get(m.user_id) !== m.role);
  if (!changed.length) return null;
  if (changed.some((m) => m.role === 'owner')) return 'Restricted members cannot own a team.';
  const added = changed.filter((m) => !prev.has(m.user_id));
  if (!added.length) return null;
  const who = spaceSetting<string>(space, 'restricted_members_teamspaces', 'space_owner_and_team_owner');
  if (who === 'member' || isSpaceOwner(space, userId)) return null;
  const teamOwner = before ? (before.membership ?? []).some((m) => m.user_id === userId && m.role === 'owner') : true;
  if (who === 'space_owner_and_team_owner' && teamOwner) return null;
  return 'You cannot add restricted members to this team.';
}

interface GuardLike {
  readonly userId: string;
  get(table: any, id: string | undefined | null): any;
}

/**
 * Transaction-guard hook (authz.ts, updates of existing records): publishing / new guests on block.permissions and
 * forms switched to "Anyone on the web with link" (collection_view.format.form_config.permission = 'public').
 */
export function policyUpdateProblem(g: GuardLike, table: string, before: any, after: any, keys: Set<string>): string | null {
  const lookup = (t: 'block' | 'collection' | 'team', id: string) => g.get(t, id);
  if (table === 'team' && keys.has('settings')) {
    const problem = teamOverrideProblem(g.get('space', after.space_id), before, after, g.userId);
    if (problem) return problem;
  }
  // Security › Prevent members from editing the Workspace section: top-level Workspace pages (space.pages)
  if (table === 'space' && keys.has('pages') && spaceSetting(after, 'disable_space_page_edits', false) && !isSpaceAdmin(after, g.userId)) {
    return 'Workspace owners have prevented members from editing the Workspace section.';
  }
  if (table === 'block' && keys.has('permissions')) {
    return permissionChangeProblem(g.get('space', after.space_id), g.userId, after.id, before?.permissions, after?.permissions, lookup);
  }
  if (table === 'collection_view' && keys.has('format')) {
    const was = before?.format?.form_config?.permission === 'public';
    const now = after?.format?.form_config?.permission === 'public';
    if (now && !was) {
      const host: BlockRecord | undefined = g.get('block', after.parent_id);
      return policyProblem(g.get('space', host?.space_id ?? after.space_id), 'publish', g.userId, { pageId: host?.id, lookup });
    }
  }
  return null;
}

/**
 * Transaction-guard hook (client transactions, records created in the call, final in-call state): sharing written on a
 * new page (or by later ops of the same call) — a page that already grants a guest, a restricted member or the web
 * access — and new form views shared to the web pass the same checks as the same change on an existing record. The
 * actor's own entry (the creator of a private page) is never a new guest.
 */
export function createdSharingProblem(g: GuardLike, table: string, rec: any): string | null {
  const lookup = (t: 'block' | 'collection' | 'team', id: string) => g.get(t, id);
  if (table === 'block' && Array.isArray(rec?.permissions) && rec.permissions.length) {
    const granted = (rec.permissions as Permission[]).filter((p) => !(p?.type === 'user_permission' && p.user_id === g.userId));
    return permissionChangeProblem(g.get('space', rec.space_id), g.userId, rec.id, [], granted, lookup);
  }
  if (table === 'collection_view' && rec?.format?.form_config?.permission === 'public') {
    const host: BlockRecord | undefined = g.get('block', rec.parent_id);
    return policyProblem(g.get('space', host?.space_id ?? rec.space_id), 'publish', g.userId, { pageId: host?.id, lookup });
  }
  return null;
}

/** Transaction-guard hook (records created in the call): copies of pages from a workspace that disallows
 * duplicating pages to other workspaces ("Duplicate to" / "Move to" / duplicating a published page) — also data sources
 * copied with their rows (a new collection's copied_from, dbcopy.ts persist hook). */
export function copyPolicyProblem(g: GuardLike, table: string, rec: any): string | null {
  if ((table !== 'block' && table !== 'collection') || typeof rec?.copied_from !== 'string' || !rec.space_id) return null;
  const src: BlockRecord | CollectionRecord | undefined = g.get(table, rec.copied_from);
  if (!src || !src.space_id || src.space_id === rec.space_id) return null;
  return policyProblem(g.get('space', src.space_id), 'duplicate_to_other_workspace', g.userId, { targetSpaceId: rec.space_id });
}

// ---------------------------------------------------------------------------------------------- workspace settings
// Settings switches write the space record through client transactions (web features/settings/spaceSettings.ts).
// Workspace roles: owners change workspace settings and invite members; membership admins add and remove members of
// the workspace and its groups but have no other workspace settings. So owners change any setting; membership admins
// only the membership keys below; members none.

/** space.settings keys only server endpoints write (they validate, notify and audit): never a client transaction. */
export const SERVER_SPACE_SETTINGS = new Set([
  'allowed_email_domains', // setAllowedEmailDomains (owners; domains members use, no public email providers)
  'member_requests', // requestMembers / resolveMemberRequest / allowed-domain join requests
  'upgrade_requests', // requestUpgrade / changePlan
  'plan_changed_time', // changePlan
  'groups', // createGroup / updateGroup / deleteGroup (members only, group owners)
  'custom_emojis', // addCustomEmoji / editCustomEmoji / removeCustomEmoji
  'invite_link_enabled', // setInviteLinkEnabled
  'mcp_clients_restricted', 'mcp_clients_approved', 'mcp_client_names', // MCP client policy (audited)
  'template_gallery', // seed.ts
]);
/** space.settings keys membership admins may change too (People › Groups › "Allow all members to create groups"). */
export const MEMBERSHIP_SPACE_SETTINGS = new Set(['restrict_group_creation']);
/** Top-level space fields membership admins may change too (Default teamspaces: every member joins them). */
export const MEMBERSHIP_SPACE_FIELDS = new Set(['default_team_ids']);

function stable(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(o[k])}`).join(',')}}`;
}

/** Keys of space.settings whose value differs between two versions of a workspace. */
export function changedSpaceSettings(before: SpaceRecord | undefined, after: SpaceRecord | undefined): string[] {
  const b = (before?.settings ?? {}) as Record<string, unknown>;
  const a = (after?.settings ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => stable(b[k]) !== stable(a[k]));
}

/**
 * Transaction-guard rule for a client write of top-level space fields (`keys`, server-owned fields and `pages` already
 * handled by authz.ts): owners change any workspace setting except the endpoint-only ones; membership admins only the
 * membership keys; everyone else nothing. Returns the reason, or null.
 */
export function spaceSettingsProblem(before: SpaceRecord, after: SpaceRecord, keys: Set<string>, userId: string): string | null {
  const owner = isSpaceOwner(before, userId);
  const admin = isSpaceAdmin(before, userId);
  if (!admin) return 'Only workspace owners and admins can change workspace settings';
  for (const k of keys) {
    if (k === 'pages') continue;
    if (k !== 'settings') {
      if (!owner && !MEMBERSHIP_SPACE_FIELDS.has(k)) return 'Only workspace owners can change workspace settings';
      continue;
    }
    for (const s of changedSpaceSettings(before, after)) {
      if (SERVER_SPACE_SETTINGS.has(s)) return 'Use the workspace settings API for this change';
      if (!owner && !MEMBERSHIP_SPACE_SETTINGS.has(s)) return 'Only workspace owners can change workspace settings';
    }
  }
  return null;
}

/**
 * Password rules (Settings › Account › Password): at least 8 characters with 4+ different characters;
 * 8–14 characters must mix letters and numbers (15+ characters are exempt). Returns the message, or null.
 */
export function passwordProblem(pw: string): string | null {
  const p = String(pw ?? '');
  if (p.length < 8) return 'Choose a longer password.';
  if (p.length > 256) return 'Password is too long.';
  if (new Set(p).size < 4) return 'Please use at least 4 different characters.';
  if (p.length < 15 && !(/\p{L}/u.test(p) && /\d/.test(p))) return 'Passwords under 15 characters must include both letters and numbers.';
  return null;
}

/** General › Analytics › "Save and display page view analytics": off = page views are neither stored nor shown. */
export function pageViewsEnabled(spaceId: string | undefined | null, userId: string | null): boolean {
  if (!spaceId) return true;
  return !policyProblem(getRecord<SpaceRecord>('space', spaceId), 'page_view_analytics', userId);
}

// ---------------------------------------------------------------------------------------------- teamspace settings
// Teamspace settings › Permissions: team.settings.invite_access 'members' | 'owners' ("Who can invite or
// remove teamspace members"; Open teamspaces are always 'members') and team.settings.sidebar_edit 'members' | 'owners'
// ("Who can edit teamspace sidebar"). Owners and workspace admins are handled before these checks (authz.ts).

/** A non-owner teamspace member adding/removing other members (not owners, no role changes). */
export function memberInviteAllowed(before: TeamRecord, after: TeamRecord, userId: string): boolean {
  const inTeam = (before.membership ?? []).some((m) => m.user_id === userId);
  const type = before.settings?.type ?? 'open';
  const access = (before.settings as Record<string, unknown> | undefined)?.invite_access === 'owners' && type !== 'open' ? 'owners' : 'members';
  if (!inTeam || access === 'owners') return false;
  const prev = new Map((before.membership ?? []).map((m) => [m.user_id, m.role]));
  const next = new Map((after.membership ?? []).map((m) => [m?.user_id, m?.role]));
  const space = getRecord<SpaceRecord>('space', before.space_id);
  const members = new Set((space?.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => p.user_id!));
  for (const [id, role] of next) {
    if (!id || !members.has(id)) return false;
    if (!prev.has(id) && role !== 'member') return false;
    if (prev.has(id) && prev.get(id) !== role) return false;
  }
  for (const [id, role] of prev) if (!next.has(id) && role === 'owner') return false;
  return true;
}

/** "Who can edit teamspace sidebar": owners only, or members whose default page access lets them edit. */
export function teamSidebarProblem(team: TeamRecord, userId: string): string | null {
  const s = (team.settings ?? {}) as Record<string, unknown>;
  const isOwner = (team.membership ?? []).some((m) => m.user_id === userId && m.role === 'owner');
  if (isOwner) return null;
  if (s.sidebar_edit === 'owners') return 'Only team owners can edit the team sidebar';
  const role = String(s.default_page_role ?? 'editor');
  if (role === 'comment_only' || role === 'reader') return 'Only team owners can edit the team sidebar';
  return null;
}

/** Teamspace › Security: relaxing a workspace-wide restriction for one teamspace needs a workspace owner. */
export function teamOverrideProblem(space: SpaceRecord | undefined, before: TeamRecord, after: TeamRecord, userId: string): string | null {
  if (!space) return null;
  const ws: Record<string, boolean> = { disable_public_access: !!space.disable_public_access, disable_export: !!space.disable_export, disable_guests: !!space.disable_guests };
  for (const key of Object.keys(ws)) {
    const was = (before.settings as Record<string, unknown> | undefined)?.[key];
    const now = (after.settings as Record<string, unknown> | undefined)?.[key];
    if (was === now) continue;
    if (ws[key] && now === false && !isSpaceOwner(space, userId)) return 'Only workspace owners can override workspace security settings for a team.';
  }
  return null;
}

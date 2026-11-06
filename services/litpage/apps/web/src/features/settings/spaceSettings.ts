// Workspace-level settings writes. Admin-only fields (name, icon, space.settings.*, security flags) go through
// transactions (the server's tx check allows space writes for owners / membership admins); mutations that touch
// other users' records or need validation (domain, roles, leave/delete, custom emoji) go through
// api/modules/workspace.ts and merge the returned recordMap.
import type { SpaceRecord } from '@nc/shared/records.ts';
import { isSpaceAdmin } from '@nc/shared/permissions.ts';
import { api } from '../../lib/api.ts';
import { useCurrentSpace } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { t } from '../shell/i18n.ts';

export type PlanType = SpaceRecord['plan_type'];

export function saveSpace(spaceId: string, patch: Partial<SpaceRecord>) {
  transactions.run(spaceId, 'updateSpace', (tx) => tx.update('space', spaceId, [], patch), { skipHistory: true });
}

export function saveSpaceSettings(spaceId: string, patch: Record<string, unknown>) {
  const space = records.get<SpaceRecord>('space', spaceId);
  transactions.run(spaceId, 'updateSpaceSettings', (tx) => {
    if (!space?.settings) tx.set('space', spaceId, ['settings'], patch);
    else tx.update('space', spaceId, ['settings'], patch);
  }, { skipHistory: true });
}

export function spaceSetting<T>(space: SpaceRecord | undefined, key: string, fallback: T): T {
  const v = space?.settings?.[key];
  return (v === undefined || v === null ? fallback : v) as T;
}

/** Server-validated workspace mutation; merges the returned recordMap into the store right away. */
export async function spaceApi<T extends Record<string, any> = Record<string, any>>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await api<T>(name, body);
  if (res && (res as any).recordMap) records.mergeRecordMap((res as any).recordMap);
  return res;
}

export function spaceRoleOf(space: SpaceRecord | undefined, userId: string | null | undefined): string {
  if (!space || !userId) return 'none';
  return (space.permissions ?? []).find((p) => p.type === 'user_permission' && p.user_id === userId)?.role ?? 'none';
}

/** Current workspace + the viewer's standing in it. */
export function useSpaceAccess() {
  const space = useCurrentSpace();
  const uid = useSession((s) => s.userId) ?? '';
  const role = spaceRoleOf(space, uid);
  return { space, uid, role, admin: isSpaceAdmin(space, uid), owner: role === 'owner', plan: (space?.plan_type ?? 'plus') as PlanType };
}

export const PLAN_RANK: Record<PlanType, number> = { free: 0, plus: 1, business: 2, enterprise: 3 };

export function planAtLeast(plan: PlanType, min: PlanType): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[min];
}

// ---------------------------------------------------------------------------------------------- workspace policy
// Client mirror of apps/server/src/policy.ts (the server enforces; the UI disables items and explains why in a tooltip).

export interface WorkspacePolicy {
  publishDisabled: boolean;
  exportDisabled: boolean;
  duplicateToOtherWorkspaceDisabled: boolean;
  guestsDisabled: boolean;
  guestInviteRequests: boolean;
  accessRequests: boolean;
  memberRequests: boolean;
  teamCreationOwnersOnly: boolean;
  groupCreationAdminsOnly: boolean;
  pageViewAnalytics: boolean;
  webhooksAllowed: boolean;
}

export function workspacePolicy(space: SpaceRecord | undefined): WorkspacePolicy {
  const s = (space?.settings ?? {}) as Record<string, unknown>;
  return {
    publishDisabled: !!space?.disable_public_access,
    exportDisabled: !!space?.disable_export,
    duplicateToOtherWorkspaceDisabled: !!s.disable_move_to_space,
    guestsDisabled: !!space?.disable_guests,
    guestInviteRequests: !!s.allow_guest_invite_requests,
    accessRequests: s.allow_access_requests !== false,
    memberRequests: s.allow_member_requests !== false,
    teamCreationOwnersOnly: !!s.limit_team_creation,
    groupCreationAdminsOnly: !!s.restrict_group_creation,
    pageViewAnalytics: s.page_view_analytics !== false,
    webhooksAllowed: !s.disallow_webhook_automation_action,
  };
}

/** Settings › Teamspaces › Limit teamspace creation to only workspace owners. */
export function canCreateTeamspace(space: SpaceRecord | undefined, userId: string | null | undefined): boolean {
  if (spaceRoleOf(space, userId) === 'restricted_member') return false; // restricted members only join teamspaces they're added to
  return !workspacePolicy(space).teamCreationOwnersOnly || spaceRoleOf(space, userId) === 'owner';
}

/** Security › Disable export: owners and membership admins can still export. */
export function canExport(space: SpaceRecord | undefined, userId: string | null | undefined): boolean {
  return !workspacePolicy(space).exportDisabled || isSpaceAdmin(space, userId ?? '');
}

/** "30 days" / "1 year" for data retention periods (Settings › Security › Data retention, the Trash footer). */
export function retentionDurationLabel(days: number): string {
  if (days >= 365 && days % 365 === 0) return t('lp.settings.n_plural_one_other', '{n, plural, one {# year} other {# years}}', { n: days / 365 });
  return t('lp.settings.n_plural_one_other_7f1a', '{n, plural, one {# day} other {# days}}', { n: days });
}

/** Tooltips for items a workspace policy turns off. */
export const policyTooltip = {
  export: () => t('lp.settings.the_workspace_owner_has_disabled_exports', 'The workspace owner has disabled exports.'),
  publish: () => t('lp.settings.this_workspace_doesn_t_allow_publishing', 'This workspace doesn’t allow publishing'),
  moveToSpace: () => t('lp.settings.moving_pages_to_another_workspace_is', 'Moving pages to another workspace is disabled here'),
  createTeamspace: () => t('lp.settings.you_cannot_create_teams_in_this', 'You cannot create teams in this workspace.'),
  inviteGuests: () => t('lp.settings.members_cannot_invite_guests_to_pages', 'Members cannot invite guests to pages here. Ask an admin to send the invitation.'),
  ownersOnly: () => t('lp.settings.this_setting_is_limited_to_workspace', 'This setting is limited to workspace owners'),
};

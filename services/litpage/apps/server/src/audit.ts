// Workspace audit log (Settings › Audit log, SET-AUD): auditable events recorded server-side, read only by workspace
// owners (api/modules/admin.ts). Event ids and categories follow the audit log catalog
// the client renders the descriptions.
//
// Sources:
//   - every committed transaction (records.ts onCommit): page / teamspace / workspace-setting / group / profile /
//     database / form / comment changes are derived from the before → after values;
//   - explicit audit calls in API handlers for what isn't a record change: logins, passwords, 2-step verification,
//     invites, role changes, removals, invite links, exports, audit-log exports, content search…
// Account events (login, password, …) belong to no workspace: they are stored once (space_id NULL) and shown in the
// audit log of every workspace the actor belongs to.
import { newId } from '@nc/shared/ids.ts';
import type { BaseRecord, BlockRecord, CollectionRecord, CollectionViewRecord, Permission, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from './db.ts';
import { memberSpaceIds, onCommit, type CommitInfo } from './records.ts';
import { pageIdOf } from './search.ts';
import { teamOfBlock } from './policy.ts';

export type AuditCategory = 'page' | 'workspace' | 'account' | 'team' | 'form' | 'collection';

/** Event id → category (the Event filter groups). */
export const AUDIT_EVENTS: Record<string, AuditCategory> = {
  // Page
  page_created: 'page', page_edited: 'page', 'page.properties_edited': 'page', page_deleted: 'page', page_restored: 'page',
  'page.permanently_deleted': 'page', page_moved: 'page', page_permission_updated: 'page', page_shared_to_web: 'page',
  page_exported: 'page', 'page.lock_updated': 'page', 'page.archived': 'page', 'page.unarchived': 'page', file_uploaded: 'page', 'page.discussion.comment.created': 'page',
  'page.discussion.comment.updated': 'page', 'page.discussion.comment.deleted': 'page',
  automation_created: 'page', automation_edited: 'page', // database automations 
  // Workspace
  member_invited: 'workspace', member_joined: 'workspace', member_left: 'workspace', member_removed: 'workspace', member_role_updated: 'workspace',
  guest_removed: 'workspace', invite_link_toggled: 'workspace', invite_link_reset: 'workspace', membership_request_resolved: 'workspace',
  workspace_name_changed: 'workspace', workspace_icon_changed: 'workspace', workspace_domain_changed: 'workspace', workspace_exported: 'workspace',
  export_toggled: 'workspace', disable_guests_toggled: 'workspace', public_page_sharing_toggled: 'workspace',
  pages_to_other_workspaces_toggled: 'workspace', page_access_requests_toggled: 'workspace', membership_requests_toggled: 'workspace',
  external_membership_requests_toggled: 'workspace', guest_membership_requests_toggled: 'workspace',
  team_creation_admins_setting_toggled: 'workspace', workspace_sidebar_editing_toggled: 'workspace',
  'workspace.settings.permission_group_creation_policy_updated': 'workspace', 'workspace.settings.disallow_webhook_automation_action_toggled': 'workspace',
  'workspace.settings.allow_custom_mcp_servers_setting_updated': 'workspace',
  disable_people_directory_toggled: 'workspace', disable_people_hover_card_toggled: 'workspace',
  allowed_email_domain_added: 'workspace', allowed_email_domain_removed: 'workspace', public_page_set: 'workspace', public_page_cleared: 'workspace',
  'workspace.group.created': 'workspace', 'workspace.group.deleted': 'workspace', 'workspace.group.renamed': 'workspace',
  member_added_to_group: 'workspace', member_removed_from_group: 'workspace', 'workspace.group.member.role.updated': 'workspace',
  'workspace.custom_emoji.created': 'workspace', 'workspace.custom_emoji.updated': 'workspace', 'workspace.custom_emoji.deleted': 'workspace',
  'workspace.member.expiry.updated': 'workspace', workspace_data_access_consent_granted: 'workspace', workspace_data_access_consent_revoked: 'workspace',
  'workspace.public_domain.created': 'workspace', 'workspace.public_domain.updated': 'workspace', 'workspace.public_domain.deleted': 'workspace',
  audit_log_exported: 'workspace', content_analytics_exported: 'workspace', user_analytics_exported: 'workspace',
  admin_content_search_queried: 'workspace', admin_content_search_exported: 'workspace', workspace_search_performed: 'workspace',
  // Custom Agents : configuration and run activity
  custom_agent_created: 'workspace', custom_agent_updated: 'workspace', custom_agent_published: 'workspace', custom_agent_deleted: 'workspace',
  custom_agent_restored: 'workspace', custom_agent_enabled: 'workspace', custom_agent_disabled: 'workspace', custom_agent_permission_updated: 'workspace',
  custom_agent_lit_access_updated: 'workspace', custom_agent_web_access_added: 'workspace', custom_agent_web_access_removed: 'workspace',
  custom_agent_model_updated: 'workspace', custom_agent_trigger_added: 'workspace', custom_agent_trigger_removed: 'workspace', custom_agent_trigger_updated: 'workspace',
  custom_agent_mcp_server_connected: 'workspace', custom_agent_mcp_server_disconnected: 'workspace', custom_agent_credit_limit_set: 'workspace',
  custom_agent_credit_limit_removed: 'workspace', custom_agent_triggered: 'workspace', custom_agent_run_completed: 'workspace', custom_agent_run_failed: 'workspace',
  custom_agent_instructions_page_edited: 'workspace',
  workspace_mcp_server_connected: 'workspace', workspace_mcp_allowlist_enabled: 'workspace', workspace_mcp_allowlist_disabled: 'workspace',
  workspace_mcp_client_added_to_allowlist: 'workspace', workspace_mcp_client_removed_from_allowlist: 'workspace', workspace_mcp_client_renamed: 'workspace',
  'workspace.settings.mcp_server_added_to_allowlist': 'workspace', 'workspace.settings.mcp_server_removed_from_allowlist': 'workspace',
  // API connections and AI Meeting Notes consent 
  'integration.created': 'workspace', 'integration.deleted': 'workspace', 'integration.permission.updated': 'workspace',
  'integration.settings.updated': 'workspace', 'integration.secret_reset': 'workspace', meeting_notes_consent_confirmed: 'workspace',
  // Account
  login: 'account', logout: 'account', password_set: 'account', password_changed: 'account', password_cleared: 'account',
  mfa_totp_toggled: 'account', mfa_backup_code_toggled: 'account', email_changed: 'account', picture_changed: 'account',
  preferred_name_changed: 'account', user_deleted: 'account', allowed_support_access: 'account', revoked_support_access: 'account',
  'user.settings.alias_added': 'account', 'user.settings.alias_removed': 'account', 'user.settings.alias_made_primary': 'account',
  'personal_access_token.issued': 'account', 'personal_access_token.revoked': 'account',
  // Teamspace
  team_created: 'team', team_archived: 'team', team_restored: 'team', team_name_changed: 'team', team_description_changed: 'team',
  team_icon_changed: 'team', team_privacy_type_changed: 'team', team_default_toggled: 'team', member_added_to_team: 'team',
  member_removed_from_team: 'team', member_joined_team: 'team', member_left_team: 'team', member_team_role_updated: 'team',
  team_member_default_permission_updated: 'team', team_workspace_default_permission_updated: 'team', team_invite_access_changed: 'team',
  team_sidebar_editing_toggled: 'team', team_export_toggled: 'team', team_public_page_sharing_toggled: 'team', team_guests_toggled: 'team',
  // Form
  'workspace.form.created': 'form', 'workspace.form.content.updated': 'form', 'workspace.form_response.created': 'form',
  // Data source
  collection_created: 'collection', 'database.schema_edited': 'collection', collection_deleted: 'collection', collection_restored: 'collection',
};

db.exec(`
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  space_id TEXT,
  time INTEGER NOT NULL,
  actor_id TEXT,
  event TEXT NOT NULL,
  category TEXT NOT NULL,
  target_id TEXT,
  team_id TEXT,
  ip TEXT,
  request_id TEXT,
  data TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_space_time ON audit_log(space_id, time);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_log(actor_id, time);
`);

const ins = db.prepare('INSERT INTO audit_log (id, space_id, time, actor_id, event, category, target_id, team_id, ip, request_id, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const recentSame = db.prepare('SELECT id, time, data FROM audit_log WHERE actor_id IS ? AND time > ? AND event = ? AND target_id IS ? ORDER BY time DESC LIMIT 1');
const bump = db.prepare('UPDATE audit_log SET time = ?, data = ? WHERE id = ?');

export interface AuditInput {
  spaceId?: string | null;
  actorId?: string | null;
  targetId?: string | null;
  teamId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  data?: Record<string, unknown>;
  time?: number;
  /** merge into the latest identical event (same actor, target) within this many ms instead of a new row */
  coalesceMs?: number;
}

/** Record one audit event. Never throws (auditing must not break the action it describes). */
export function audit(event: string, input: AuditInput = {}): void {
  try {
    const category = AUDIT_EVENTS[event];
    if (!category) return;
    const time = input.time ?? Date.now();
    const data = input.data ?? {};
    if (input.coalesceMs) {
      const prev = recentSame.get(input.actorId ?? null, time - input.coalesceMs, event, input.targetId ?? null) as { id: string; time: number; data: string } | undefined;
      if (prev) {
        let merged: Record<string, unknown> = {};
        try { merged = JSON.parse(prev.data || '{}'); } catch { /* keep empty */ }
        const props = new Set([...(Array.isArray(merged.properties) ? merged.properties as string[] : []), ...(Array.isArray(data.properties) ? data.properties as string[] : [])]);
        const next = { ...merged, ...data, ...(props.size ? { properties: [...props].slice(0, 20) } : {}) };
        // typing bursts: rewrite the row at most once a minute unless something new (a property) shows up
        if (time - prev.time >= 60_000 || JSON.stringify(next) !== JSON.stringify(merged)) bump.run(time, JSON.stringify(next), prev.id);
        return;
      }
    }
    ins.run(newId(), input.spaceId ?? null, time, input.actorId ?? null, event, category, input.targetId ?? null, input.teamId ?? null,
      input.ip ? String(input.ip).slice(0, 64) : null, input.requestId ?? null, JSON.stringify(data));
  } catch (e) {
    console.error('[audit] failed to record', event, e);
  }
}

/** Account events (login, password, 2FA, profile…): one row in the log of every workspace the user belongs to now. */
export function auditAccount(event: string, userId: string, input: Omit<AuditInput, 'spaceId' | 'actorId'> = {}) {
  const spaces = memberSpaceIds(userId);
  const requestId = input.requestId ?? `${userId}:${input.time ?? Date.now()}:${event}`;
  for (const spaceId of spaces.length ? spaces : [null]) audit(event, { ...input, requestId, spaceId, actorId: userId, targetId: input.targetId ?? userId });
}

// ---------------------------------------------------------------------------------------------- derived events

const PAGE_TYPES = new Set(['page', 'collection_view_page']);
const EDIT_COALESCE_MS = 10 * 60_000;

function title(b: BlockRecord | undefined): string {
  if (!b) return '';
  if (b.type === 'collection_view_page' && b.collection_id) {
    const name = toPlainText((getRecord<CollectionRecord>('collection', b.collection_id)?.name ?? []) as any);
    if (name) return name.slice(0, 200);
  }
  return toPlainText(b.properties?.title).slice(0, 200);
}

export type PageAudience = 'private' | 'shared_internally' | 'shared_to_workspace' | 'shared_externally' | 'shared_to_web';

/**
 * Who the page is shared with (the "Page audience" / content search Audience): published to web > shared
 * externally (guests) > shared to workspace (everyone, through workspace access or an open teamspace) > shared
 * internally (other members) > private (one member).
 */
export function pageAudience(page: BlockRecord | undefined, space: SpaceRecord | undefined): PageAudience {
  const members = new Set((space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role !== 'none').map((p) => p.user_id));
  const people = new Set<string>();
  let external = false;
  let workspace = false;
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 60 && cur; i++) {
    for (const p of cur.permissions ?? []) {
      if (p.role === 'none') continue;
      if (p.type === 'public_permission' && (!p.expiry_time || p.expiry_time > Date.now()) && !space?.disable_public_access) return 'shared_to_web';
      if (p.type === 'space_permission') workspace = true;
      if (p.type === 'user_permission' && p.user_id) {
        if (!members.has(p.user_id)) external = true;
        else people.add(p.user_id);
      }
    }
    if (cur.parent_table === 'team') {
      const team = getRecord<TeamRecord>('team', cur.parent_id);
      for (const m of team?.membership ?? []) people.add(m.user_id);
      const type = team?.settings?.type ?? 'open';
      if (type === 'open' && ((team?.settings as any)?.workspace_page_role ?? 'read_and_write') !== 'none') workspace = true;
      break;
    }
    if (cur.parent_table === 'space') {
      if (!cur.permissions?.length) workspace = true;
      break;
    }
    if (cur.parent_table === 'collection') {
      const col = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
    } else cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  if (external) return 'shared_externally';
  if (workspace) return 'shared_to_workspace';
  return people.size > 1 ? 'shared_internally' : 'private';
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function roleChanges(before: Permission[] | undefined, after: Permission[] | undefined) {
  const key = (p: Permission) => `${p.type}:${p.user_id ?? ''}:${(p as any).group_id ?? ''}:${p.type === 'public_permission' ? (p.published ? 'site' : 'link') : ''}`;
  const prev = new Map((before ?? []).map((p) => [key(p), p]));
  const next = new Map((after ?? []).map((p) => [key(p), p]));
  const out: { type: string; userId?: string; oldRole: string; newRole: string; published?: boolean }[] = [];
  for (const k of new Set([...prev.keys(), ...next.keys()])) {
    const a = prev.get(k);
    const b = next.get(k);
    const oldRole = a?.role ?? 'none';
    const newRole = b?.role ?? 'none';
    if (oldRole === newRole && same(a, b)) continue;
    const p = (b ?? a)!;
    out.push({ type: p.type, userId: p.user_id, oldRole, newRole, published: !!p.published });
  }
  return out;
}

const SETTING_TOGGLES: [string, string, (s: SpaceRecord) => unknown][] = [
  ['export_toggled', 'disable_export', (s) => !!s.disable_export],
  ['disable_guests_toggled', 'disable_guests', (s) => !!s.disable_guests],
  ['public_page_sharing_toggled', 'disable_public_access', (s) => !!s.disable_public_access],
  ['pages_to_other_workspaces_toggled', 'disable_move_to_space', (s) => !!(s.settings as any)?.disable_move_to_space],
  ['page_access_requests_toggled', 'allow_access_requests', (s) => (s.settings as any)?.allow_access_requests !== false],
  ['membership_requests_toggled', 'allow_member_requests', (s) => (s.settings as any)?.allow_member_requests !== false],
  ['external_membership_requests_toggled', 'allow_external_member_requests', (s) => !!(s.settings as any)?.allow_external_member_requests],
  ['guest_membership_requests_toggled', 'allow_guest_member_requests', (s) => (s.settings as any)?.allow_guest_member_requests !== false],
  ['team_creation_admins_setting_toggled', 'limit_team_creation', (s) => !!(s.settings as any)?.limit_team_creation],
  ['workspace_sidebar_editing_toggled', 'disable_space_page_edits', (s) => !(s.settings as any)?.disable_space_page_edits],
  ['workspace.settings.permission_group_creation_policy_updated', 'restrict_group_creation', (s) => !!(s.settings as any)?.restrict_group_creation],
  ['workspace.settings.disallow_webhook_automation_action_toggled', 'disallow_webhook_automation_action', (s) => !!(s.settings as any)?.disallow_webhook_automation_action],
  ['workspace.settings.allow_custom_mcp_servers_setting_updated', 'ai_custom_mcp', (s) => (s.settings as any)?.ai_custom_mcp !== false],
  ['disable_people_directory_toggled', 'people_profiles_enabled', (s) => (s.settings as any)?.people_profiles_enabled !== false],
  ['disable_people_hover_card_toggled', 'hover_cards_enabled', (s) => (s.settings as any)?.hover_cards_enabled !== false],
];

function spaceEvents(actor: string, before: SpaceRecord, after: SpaceRecord, base: AuditInput) {
  const sid = after.id;
  if (before.name !== after.name) audit('workspace_name_changed', { ...base, spaceId: sid, targetId: sid, data: { oldValue: before.name, newValue: after.name } });
  if ((before.icon ?? '') !== (after.icon ?? '')) audit('workspace_icon_changed', { ...base, spaceId: sid, targetId: sid });
  for (const [event, key, read] of SETTING_TOGGLES) {
    const a = read(before);
    const b = read(after);
    if (a !== b) audit(event, { ...base, spaceId: sid, targetId: sid, data: { setting: key, value: b } });
  }
  if ((before.settings as any)?.support_access !== (after.settings as any)?.support_access) {
    audit((after.settings as any)?.support_access ? 'workspace_data_access_consent_granted' : 'workspace_data_access_consent_revoked', { ...base, spaceId: sid, targetId: sid });
  }
  const hb = (before.settings as any)?.public_home_page ?? null;
  const ha = (after.settings as any)?.public_home_page ?? null;
  if (hb !== ha) {
    audit(ha ? 'public_page_set' : 'public_page_cleared', { ...base, spaceId: sid, targetId: ha ?? hb, data: { newPage: ha ? title(getRecord<BlockRecord>('block', ha)) : null, oldPage: hb ? title(getRecord<BlockRecord>('block', hb)) : null } });
  }
  const db0 = new Set<string>((before.settings as any)?.allowed_email_domains ?? []);
  const db1 = new Set<string>((after.settings as any)?.allowed_email_domains ?? []);
  for (const d of db1) if (!db0.has(d)) audit('allowed_email_domain_added', { ...base, spaceId: sid, targetId: sid, data: { addedValue: d } });
  for (const d of db0) if (!db1.has(d)) audit('allowed_email_domain_removed', { ...base, spaceId: sid, targetId: sid, data: { removedValue: d } });
  // groups (People › Groups live in space.settings.groups)
  type G = { id: string; name: string; member_ids: string[]; owner_ids?: string[] };
  const g0 = new Map<string, G>(((before.settings as any)?.groups ?? []).map((g: G) => [g.id, g]));
  const g1 = new Map<string, G>(((after.settings as any)?.groups ?? []).map((g: G) => [g.id, g]));
  for (const [id, g] of g1) {
    const prev = g0.get(id);
    if (!prev) {
      audit('workspace.group.created', { ...base, spaceId: sid, targetId: id, data: { groupName: g.name } });
      for (const m of g.member_ids ?? []) audit('member_added_to_group', { ...base, spaceId: sid, targetId: m, data: { groupName: g.name, groupId: id } });
      continue;
    }
    if (prev.name !== g.name) audit('workspace.group.renamed', { ...base, spaceId: sid, targetId: id, data: { oldGroupName: prev.name, newGroupName: g.name } });
    const m0 = new Set(prev.member_ids ?? []);
    const m1 = new Set(g.member_ids ?? []);
    for (const m of m1) if (!m0.has(m)) audit('member_added_to_group', { ...base, spaceId: sid, targetId: m, data: { groupName: g.name, groupId: id } });
    for (const m of m0) if (!m1.has(m)) audit('member_removed_from_group', { ...base, spaceId: sid, targetId: m, data: { groupName: g.name, groupId: id } });
    const o0 = new Set(prev.owner_ids ?? []);
    const o1 = new Set(g.owner_ids ?? []);
    for (const m of new Set([...o0, ...o1])) {
      if (o0.has(m) !== o1.has(m)) audit('workspace.group.member.role.updated', { ...base, spaceId: sid, targetId: m, data: { groupName: g.name, oldRole: o0.has(m) ? 'owner' : 'member', newRole: o1.has(m) ? 'owner' : 'member' } });
    }
  }
  for (const [id, g] of g0) if (!g1.has(id)) audit('workspace.group.deleted', { ...base, spaceId: sid, targetId: id, data: { groupName: g.name } });
  // default teamspaces
  const d0 = new Set(before.default_team_ids ?? []);
  const d1 = new Set(after.default_team_ids ?? []);
  for (const id of new Set([...d0, ...d1])) {
    if (d0.has(id) !== d1.has(id)) audit('team_default_toggled', { ...base, spaceId: sid, targetId: id, teamId: id, data: { teamName: getRecord<TeamRecord>('team', id)?.name ?? '', value: d1.has(id) } });
  }
  void actor;
}

const TEAM_SETTING_TOGGLES: [string, string][] = [
  ['team_export_toggled', 'disable_export'],
  ['team_public_page_sharing_toggled', 'disable_public_access'],
  ['team_guests_toggled', 'disable_guests'],
];

function teamEvents(actor: string, before: TeamRecord | undefined, after: TeamRecord, base: AuditInput) {
  const t = { ...base, spaceId: after.space_id, teamId: after.id, targetId: after.id };
  const teamName = after.name;
  if (!before) {
    audit('team_created', { ...t, data: { teamName } });
    return;
  }
  if (!before.archived_by && after.archived_by) audit('team_archived', { ...t, data: { teamName } });
  if (before.archived_by && !after.archived_by) audit('team_restored', { ...t, data: { teamName } });
  if (before.name !== after.name) audit('team_name_changed', { ...t, data: { oldTeamName: before.name, newTeamName: after.name, teamName } });
  if ((before.description ?? '') !== (after.description ?? '')) audit('team_description_changed', { ...t, data: { teamName } });
  if ((before.icon ?? '') !== (after.icon ?? '')) audit('team_icon_changed', { ...t, data: { teamName } });
  const tb = before.settings?.type ?? 'open';
  const ta = after.settings?.type ?? 'open';
  if (tb !== ta) audit('team_privacy_type_changed', { ...t, data: { teamName, oldType: tb, newType: ta } });
  const rb = before.settings?.default_page_role ?? 'editor';
  const ra = after.settings?.default_page_role ?? 'editor';
  if (rb !== ra) audit('team_member_default_permission_updated', { ...t, data: { teamName, oldRole: rb, newRole: ra } });
  const wb = (before.settings as any)?.workspace_page_role ?? 'read_and_write';
  const wa = (after.settings as any)?.workspace_page_role ?? 'read_and_write';
  if (wb !== wa) audit('team_workspace_default_permission_updated', { ...t, data: { teamName, oldRole: wb, newRole: wa } });
  const ib = (before.settings as any)?.invite_access ?? 'members';
  const ia = (after.settings as any)?.invite_access ?? 'members';
  if (ib !== ia) audit('team_invite_access_changed', { ...t, data: { teamName, newType: ia } });
  const sb = (before.settings as any)?.sidebar_edit ?? 'members';
  const sa = (after.settings as any)?.sidebar_edit ?? 'members';
  if (sb !== sa) audit('team_sidebar_editing_toggled', { ...t, data: { teamName, value: sa } });
  for (const [event, key] of TEAM_SETTING_TOGGLES) {
    const a = !!(before.settings as any)?.[key];
    const b = !!(after.settings as any)?.[key];
    if (a !== b) audit(event, { ...t, data: { teamName, setting: key, value: b } });
  }
  const m0 = new Map((before.membership ?? []).map((m) => [m.user_id, m.role]));
  const m1 = new Map((after.membership ?? []).map((m) => [m.user_id, m.role]));
  for (const [uid, role] of m1) {
    if (!m0.has(uid)) audit(uid === actor ? 'member_joined_team' : 'member_added_to_team', { ...t, targetId: uid, data: { teamName, teamRole: role } });
    else if (m0.get(uid) !== role) audit('member_team_role_updated', { ...t, targetId: uid, data: { teamName, oldTeamRole: m0.get(uid), newTeamRole: role } });
  }
  for (const uid of m0.keys()) if (!m1.has(uid)) audit(uid === actor ? 'member_left_team' : 'member_removed_from_team', { ...t, targetId: uid, data: { teamName } });
}

function userEvents(before: UserRecord | undefined, after: UserRecord, base: AuditInput) {
  if (!before || (after as any).deleted_time) return;
  const b = { ip: base.ip, time: base.time };
  if ((before.name ?? '') !== (after.name ?? '')) auditAccount('preferred_name_changed', after.id, { ...b, data: { oldValue: before.name ?? '', newValue: after.name ?? '' } });
  if ((before.profile_photo ?? '') !== (after.profile_photo ?? '')) auditAccount('picture_changed', after.id, b);
}

function blockEvents(actor: string, before: BlockRecord | undefined, after: BlockRecord, base: AuditInput, editedPages: Set<string>) {
  const isPage = PAGE_TYPES.has(after.type);
  const spaceId = after.space_id;
  if (!spaceId) return;
  const pageId = isPage ? after.id : pageIdOf(after);
  const page = isPage ? after : getRecord<BlockRecord>('block', pageId);
  const pageTeam = teamOfBlock(pageId);
  const p = { ...base, spaceId, targetId: pageId, teamId: pageTeam?.id ?? null };
  const pageName = title(page);
  if (isPage) {
    if (!before) {
      if (after.alive !== false && !after.is_template) {
        const parent = after.parent_table === 'block' ? getRecord<BlockRecord>('block', after.parent_id) : undefined;
        audit('page_created', { ...p, data: { pageName, where: after.parent_table, parentPageName: parent ? title(parent) : undefined, teamName: pageTeam?.name } });
      }
      return;
    }
    if (before.alive !== false && after.alive === false) audit('page_deleted', { ...p, data: { pageName } });
    else if (before.alive === false && after.alive !== false) audit('page_restored', { ...p, data: { pageName } });
    else if (after.alive !== false && (before.parent_id !== after.parent_id || before.parent_table !== after.parent_table)) {
      const oldParent = before.parent_table === 'block' ? title(getRecord<BlockRecord>('block', before.parent_id)) : before.parent_table === 'team' ? getRecord<TeamRecord>('team', before.parent_id)?.name : null;
      const newParent = after.parent_table === 'block' ? title(getRecord<BlockRecord>('block', after.parent_id)) : after.parent_table === 'team' ? getRecord<TeamRecord>('team', after.parent_id)?.name : null;
      audit('page_moved', { ...p, data: { pageName, oldParent, newParent } });
    }
    if (!same(before.permissions, after.permissions)) {
      for (const ch of roleChanges(before.permissions, after.permissions)) {
        if (ch.type === 'public_permission') audit('page_shared_to_web', { ...p, data: { pageName, enabled: ch.newRole !== 'none', newRole: ch.newRole, published: ch.published } });
        else audit('page_permission_updated', { ...p, data: { pageName, kind: ch.type, userId: ch.userId, oldRole: ch.oldRole, newRole: ch.newRole } });
      }
    }
    if (!!(before.format as any)?.block_locked !== !!(after.format as any)?.block_locked) audit('page.lock_updated', { ...p, data: { pageName, locked: !!(after.format as any)?.block_locked } });
    // Page archive: block.archived_time on the archived page
    if (!(before as any).archived_time !== !(after as any).archived_time) audit((after as any).archived_time ? 'page.archived' : 'page.unarchived', { ...p, data: { pageName } });
    // database row properties → "Page properties edited" (coalesced per page and editor)
    if (after.parent_table === 'collection') {
      const props = Object.keys({ ...(before.properties ?? {}), ...(after.properties ?? {}) }).filter((k) => k !== 'title' && !same(before.properties?.[k], after.properties?.[k]));
      if (props.length) {
        const col = getRecord<CollectionRecord>('collection', after.parent_id);
        const names = props.map((k) => toPlainText([[(col?.schema as any)?.[k]?.name ?? k]] as any)).slice(0, 10);
        audit('page.properties_edited', { ...p, data: { pageName, properties: names }, coalesceMs: EDIT_COALESCE_MS });
      }
    }
  }
  if (after.alive === false && before?.alive === false) return;
  if (!before && !isPage) {
    if (after.type === 'collection_view' || after.type === 'collection_view_page') return;
  }
  // content edits → "Page edited" once per page/editor per 10 minutes (edit bursts are coalesced too)
  if (!editedPages.has(pageId) && page && page.alive !== false) {
    const changed = !before || ['properties', 'content', 'format', 'type'].some((k) => !same((before as any)[k], (after as any)[k]));
    if (changed && !(isPage && !before)) {
      editedPages.add(pageId);
      audit('page_edited', { ...p, data: { pageName }, coalesceMs: EDIT_COALESCE_MS });
    }
  }
}

function collectionEvents(before: CollectionRecord | undefined, after: CollectionRecord, base: AuditInput) {
  const host = getRecord<BlockRecord>('block', after.parent_id);
  const spaceId = after.space_id ?? host?.space_id;
  if (!spaceId) return;
  const t = { ...base, spaceId, targetId: after.id, teamId: teamOfBlock(after.parent_id)?.id ?? null, data: { name: toPlainText((after.name ?? []) as any) } };
  if (!before) audit('collection_created', t);
  else if (!same(before.schema, after.schema)) audit('database.schema_edited', { ...t, coalesceMs: EDIT_COALESCE_MS });
  if (before && (before as any).alive !== false && (after as any).alive === false) audit('collection_deleted', t);
  else if (before && (before as any).alive === false && (after as any).alive !== false) audit('collection_restored', t);
}

function viewEvents(before: CollectionViewRecord | undefined, after: CollectionViewRecord, base: AuditInput) {
  if (after.type !== 'form') return;
  const host = getRecord<BlockRecord>('block', after.parent_id);
  const spaceId = (after as any).space_id ?? host?.space_id;
  if (!spaceId) return;
  const t = { ...base, spaceId, targetId: after.id, teamId: teamOfBlock(after.parent_id)?.id ?? null, data: { name: after.name ?? '' } };
  if (!before) audit('workspace.form.created', t);
  else if (!same(before.format, after.format)) audit('workspace.form.content.updated', { ...t, coalesceMs: EDIT_COALESCE_MS });
}

function discussionEvents(table: string, before: any, after: any, base: AuditInput) {
  if (table !== 'comment') return;
  const d = getRecord<any>('discussion', after.parent_id);
  const block = d ? getRecord<BlockRecord>('block', d.parent_id) : undefined;
  if (!block) return;
  const pageId = PAGE_TYPES.has(block.type) ? block.id : pageIdOf(block);
  const pageName = title(getRecord<BlockRecord>('block', pageId));
  const t = { ...base, spaceId: block.space_id, targetId: pageId, teamId: teamOfBlock(pageId)?.id ?? null, data: { pageName } };
  if (!before) audit('page.discussion.comment.created', t);
  else if (before.alive !== false && after.alive === false) audit('page.discussion.comment.deleted', t);
  else if (!same(before.text, after.text)) audit('page.discussion.comment.updated', t);
}

/** Derive audit events from one committed transaction batch (records.ts onCommit). */
export function auditCommit(info: CommitInfo) {
  const now = Date.now();
  const base: AuditInput = { actorId: info.userId, requestId: `${info.userId}:${now}`, time: now };
  const editedPages = new Set<string>();
  for (const ch of info.changes) {
    const before = info.prev.get(`${ch.table}:${ch.record.id}`) as BaseRecord | undefined;
    switch (ch.table) {
      case 'block':
        blockEvents(info.userId, before as BlockRecord | undefined, ch.record as BlockRecord, base, editedPages);
        break;
      case 'space':
        if (before) spaceEvents(info.userId, before as SpaceRecord, ch.record as SpaceRecord, base);
        break;
      case 'team':
        teamEvents(info.userId, before as TeamRecord | undefined, ch.record as TeamRecord, base);
        break;
      case 'lit_user':
        userEvents(before as UserRecord | undefined, ch.record as UserRecord, base);
        break;
      case 'collection':
        collectionEvents(before as CollectionRecord | undefined, ch.record as CollectionRecord, base);
        break;
      case 'collection_view':
        viewEvents(before as CollectionViewRecord | undefined, ch.record as CollectionViewRecord, base);
        break;
      case 'comment':
        discussionEvents(ch.table, before, ch.record, base);
        break;
      default:
        break;
    }
  }
}

onCommit((info) => auditCommit(info));

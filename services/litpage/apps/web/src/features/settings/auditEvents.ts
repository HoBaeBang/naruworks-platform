// Audit log event catalog for Settings › Audit log: the event ids grouped by category, the Event filter labels
// and the row descriptions. The server records these ids (apps/server/src/audit.ts AUDIT_EVENTS).
import type { TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { records } from '../../lib/store/records.ts';
import { t } from '../shell/i18n.ts';

export type AuditCategory = 'page' | 'workspace' | 'account' | 'team' | 'form' | 'collection';

export interface AuditEntry {
  id: string;
  time: number;
  actorId: string | null;
  event: string;
  category: AuditCategory;
  targetId: string | null;
  teamId: string | null;
  ip: string | null;
  requestId: string | null;
  data: Record<string, any>;
  audience?: string;
  pageName?: string;
}

export function categoryLabel(c: AuditCategory): string {
  switch (c) {
    case 'page': return t('lp.settings.page', 'Page');
    case 'workspace': return t('lp.settings.workspace', 'Workspace');
    case 'account': return t('lp.settings.account', 'Account');
    case 'team': return t('lp.settings.team', 'Team');
    case 'form': return t('lp.settings.form', 'Form');
    default: return t('lp.settings.data_source', 'Data source');
  }
}

/** Event filter: category → [event id, label]. Categories without recorded features (Workers, Custom agents) are omitted. */
export function auditEventCatalog(): { category: AuditCategory; events: [string, string][] }[] {
  return [
    {
      category: 'page',
      events: [
        ['page_created', t('lp.settings.page_created', 'Page created')],
        ['page_edited', t('lp.settings.page_edited', 'Page edited')],
        ['page.properties_edited', t('lp.settings.page_properties_changed', 'Page properties changed')],
        ['page_deleted', t('lp.settings.page_trashed', 'Page trashed')],
        ['page_restored', t('lp.settings.page_restored', 'Page restored')],
        ['page.permanently_deleted', t('lp.settings.page_permanently_removed', 'Page permanently removed')],
        ['page_moved', t('lp.settings.page_moved', 'Page moved')],
        ['page_permission_updated', t('lp.settings.page_permissions_changed', 'Page permissions changed')],
        ['page_shared_to_web', t('lp.settings.page_shared_on_the_web', 'Page shared on the web')],
        ['page_exported', t('lp.settings.page_exported', 'Page exported')],
        ['file_uploaded', t('lp.settings.file_uploaded', 'File uploaded')],
        ['page.lock_updated', t('lp.settings.page_locked_or_unlocked', 'Page locked or unlocked')],
        ['page.archived', t('lp.settings.page_archived', 'Page archived')],
        ['page.unarchived', t('lp.settings.page_unarchived', 'Page unarchived')],
        ['page.discussion.comment.created', t('lp.settings.comment_added', 'Comment added')],
        ['page.discussion.comment.updated', t('lp.settings.comment_updated', 'Comment updated')],
        ['page.discussion.comment.deleted', t('lp.settings.comment_deleted', 'Comment deleted')],
        ['automation_created', t('lp.settings.automation_created', 'Automation created')],
        ['automation_edited', t('lp.settings.automation_edited', 'Automation edited')],
      ],
    },
    {
      category: 'workspace',
      events: [
        ['member_invited', t('lp.settings.member_invited', 'Member invited')],
        ['member_joined', t('lp.settings.member_joined', 'Member joined')],
        ['member_left', t('lp.settings.member_left', 'Member left')],
        ['member_removed', t('lp.settings.member_removed', 'Member removed')],
        ['member_role_updated', t('lp.settings.member_role_changed', 'Member role changed')],
        ['guest_removed', t('lp.settings.guest_removed', 'Guest removed')],
        ['membership_request_resolved', t('lp.settings.membership_request_handled', 'Membership request handled')],
        ['invite_link_toggled', t('lp.settings.invite_link_switched', 'Invite link switched')],
        ['invite_link_reset', t('lp.settings.invite_link_was_reset', 'Invite link was reset')],
        ['workspace_name_changed', t('lp.settings.workspace_name_updated', 'Workspace name updated')],
        ['workspace_icon_changed', t('lp.settings.workspace_icon_updated', 'Workspace icon updated')],
        ['workspace_domain_changed', t('lp.settings.workspace_domain_updated', 'Workspace domain updated')],
        ['workspace_exported', t('lp.settings.exported_workspace_content', 'Exported workspace content')],
        ['export_toggled', t('lp.settings.export_toggled', 'Export toggled')],
        ['disable_guests_toggled', t('lp.settings.guest_access_switched', 'Guest access switched')],
        ['public_page_sharing_toggled', t('lp.settings.web_sharing_for_pages_turned_on', 'Web sharing for pages turned on/off')],
        ['pages_to_other_workspaces_toggled', t('lp.settings.cross_workspace_page_moves_turned_on', 'Cross-workspace page moves turned on/off')],
        ['page_access_requests_toggled', t('lp.settings.access_requests_for_pages_turned_on', 'Access requests for pages turned on/off')],
        ['membership_requests_toggled', t('lp.settings.membership_requests_switched', 'Membership requests switched')],
        ['external_membership_requests_toggled', t('lp.settings.external_requests_to_join_turned_on', 'External requests to join turned on/off')],
        ['guest_membership_requests_toggled', t('lp.settings.guest_requests_to_join_turned_on', 'Guest requests to join turned on/off')],
        ['team_creation_admins_setting_toggled', t('lp.settings.team_creation_setting_switched', 'Team creation setting switched')],
        ['workspace_sidebar_editing_toggled', t('lp.settings.workspace_section_editing_turned_on_off', 'Workspace section editing turned on/off')],
        ['workspace.settings.permission_group_creation_policy_updated', t('lp.settings.changed_who_can_create_groups', 'Changed who can create groups')],
        ['workspace.settings.disallow_webhook_automation_action_toggled', t('lp.settings.ability_to_use_the_send_webhook', 'Ability to use the “Send webhook” automation action switched')],
        ['workspace.settings.allow_custom_mcp_servers_setting_updated', t('lp.settings.changed_the_custom_mcp_server_policy', 'Changed the custom MCP server policy')],
        ['disable_people_directory_toggled', t('lp.settings.people_directory_switched', 'People directory switched')],
        ['disable_people_hover_card_toggled', t('lp.settings.people_cards_switched', 'People cards switched')],
        ['allowed_email_domain_added', t('lp.settings.email_domain_added_to_allowed_list', 'Email domain added to allowed list')],
        ['allowed_email_domain_removed', t('lp.settings.email_domain_no_longer_allowed', 'Email domain no longer allowed')],
        ['public_page_set', t('lp.settings.public_homepage_selected', 'Public homepage selected')],
        ['public_page_cleared', t('lp.settings.public_homepage_link_removed', 'Public homepage link removed')],
        ['workspace.group.created', t('lp.settings.group_created', 'Group created')],
        ['workspace.group.deleted', t('lp.settings.group_deleted', 'Group deleted')],
        ['workspace.group.renamed', t('lp.settings.group_renamed', 'Group renamed')],
        ['member_added_to_group', t('lp.settings.group_membership_granted', 'Group membership granted')],
        ['member_removed_from_group', t('lp.settings.group_membership_revoked', 'Group membership revoked')],
        ['workspace.group.member.role.updated', t('lp.settings.role_changed_within_a_group', 'Role changed within a group')],
        ['workspace.custom_emoji.created', t('lp.settings.created_custom_emoji', 'Created custom emoji')],
        ['workspace.custom_emoji.updated', t('lp.settings.custom_emoji_changed', 'Custom emoji changed')],
        ['workspace.custom_emoji.deleted', t('lp.settings.deleted_custom_emoji', 'Deleted custom emoji')],
        ['workspace_data_access_consent_granted', t('lp.settings.approved_access_to_workspace_data', 'Approved access to workspace data')],
        ['workspace_data_access_consent_revoked', t('lp.settings.withdrew_approval_to_access_workspace_da', 'Withdrew approval to access workspace data')],
        ['audit_log_exported', t('lp.settings.audit_log_exported', 'Audit log downloaded')],
        ['content_analytics_exported', t('lp.settings.content_analytics_exported', 'Content insights downloaded')],
        ['user_analytics_exported', t('lp.settings.user_analytics_exported', 'User insights downloaded')],
        ['admin_content_search_queried', t('lp.settings.content_search_performed', 'Content search performed')],
        ['admin_content_search_exported', t('lp.settings.content_search_exported', 'Content search exported')],
        // Custom Agents
        ['custom_agent_created', t('lp.settings.created_custom_agent', 'Created custom agent')],
        ['custom_agent_updated', t('lp.settings.updated_custom_agent', 'Updated custom agent')],
        ['custom_agent_published', t('lp.settings.published_custom_agent', 'Published custom agent')],
        ['custom_agent_deleted', t('lp.settings.deleted_custom_agent', 'Deleted custom agent')],
        ['custom_agent_restored', t('lp.settings.restored_custom_agent', 'Restored custom agent')],
        ['custom_agent_enabled', t('lp.settings.enabled_custom_agent', 'Enabled custom agent')],
        ['custom_agent_disabled', t('lp.settings.disabled_custom_agent', 'Disabled custom agent')],
        ['custom_agent_permission_updated', t('lp.settings.custom_agent_permissions_changed', 'Custom agent permissions changed')],
        ['custom_agent_lit_access_updated', t('lp.settings.changed_what_a_custom_agent_can', 'Changed what a custom agent can reach in Litpage')],
        ['custom_agent_web_access_added', t('lp.settings.added_web_access_for_custom_agent', 'Added web access for custom agent')],
        ['custom_agent_web_access_removed', t('lp.settings.removed_web_access_for_custom_agent', 'Removed web access for custom agent')],
        ['custom_agent_model_updated', t('lp.settings.switched_a_custom_agent_s_model', 'Switched a custom agent’s model')],
        ['custom_agent_trigger_added', t('lp.settings.new_trigger_on_a_custom_agent', 'New trigger on a custom agent')],
        ['custom_agent_trigger_removed', t('lp.settings.trigger_deleted_from_a_custom_agent', 'Trigger deleted from a custom agent')],
        ['custom_agent_trigger_updated', t('lp.settings.trigger_edited_on_a_custom_agent', 'Trigger edited on a custom agent')],
        ['custom_agent_mcp_server_connected', t('lp.settings.mcp_server_linked_to_a_custom', 'MCP server linked to a custom agent')],
        ['custom_agent_mcp_server_disconnected', t('lp.settings.mcp_server_unlinked_from_a_custom', 'MCP server unlinked from a custom agent')],
        ['custom_agent_credit_limit_set', t('lp.settings.credit_limit_placed_on_a_custom', 'Credit limit placed on a custom agent')],
        ['custom_agent_credit_limit_removed', t('lp.settings.credit_limit_lifted_from_a_custom', 'Credit limit lifted from a custom agent')],
        ['custom_agent_triggered', t('lp.settings.ran_custom_agent', 'Ran custom agent')],
        ['custom_agent_run_completed', t('lp.settings.custom_agent_finished_running', 'Custom agent finished running')],
        ['custom_agent_run_failed', t('lp.settings.custom_agent_run_hit_an_error', 'Custom agent run hit an error')],
        ['custom_agent_instructions_page_edited', t('lp.settings.instructions_page_edited_for_a_custom', 'Instructions page edited for a custom agent')],
        // Litpage MCP clients
        ['workspace_mcp_server_connected', t('lp.settings.connected_mcp_server', 'Connected MCP server')],
        ['workspace_mcp_allowlist_enabled', t('lp.settings.turned_on_mcp_allowlist', 'Turned on MCP allowlist')],
        ['workspace_mcp_allowlist_disabled', t('lp.settings.turned_off_mcp_allowlist', 'Turned off MCP allowlist')],
        ['workspace_mcp_client_added_to_allowlist', t('lp.settings.allowlisted_an_mcp_client', 'Allowlisted an MCP client')],
        ['workspace_mcp_client_removed_from_allowlist', t('lp.settings.took_an_mcp_client_off_the', 'Took an MCP client off the allowlist')],
        ['workspace_mcp_client_renamed', t('lp.settings.mcp_client_renamed', 'MCP client renamed')],
        // API connections + AI Meeting Notes consent
        ['integration.created', t('lp.settings.workspace_integration_installed', 'Workspace integration installed')],
        ['integration.deleted', t('lp.settings.workspace_integration_uninstalled', 'Workspace integration uninstalled')],
        ['integration.permission.updated', t('lp.settings.integration_capabilities_updated', 'Integration capabilities updated')],
        ['integration.settings.updated', t('lp.settings.integration_settings_changed', 'Integration settings updated')],
        ['integration.secret_reset', t('lp.settings.integration_token_refreshed', 'Integration token refreshed')],
        ['meeting_notes_consent_confirmed', t('lp.settings.consent_given_for_ai_meeting_notes', 'Consent given for AI meeting notes')],
      ],
    },
    {
      category: 'account',
      events: [
        ['login', t('lp.settings.login', 'Login')],
        ['logout', t('lp.settings.logout', 'Logout')],
        ['password_set', t('lp.settings.password_set', 'Password set')],
        ['password_changed', t('lp.settings.password_changed', 'Password changed')],
        ['password_cleared', t('lp.settings.password_cleared', 'Password cleared')],
        ['mfa_totp_toggled', t('lp.settings.mfa_totp_switched', 'MFA TOTP switched')],
        ['mfa_backup_code_toggled', t('lp.settings.mfa_backup_codes_turned_on_off', 'MFA backup codes turned on/off')],
        ['email_changed', t('lp.settings.email_changed', 'Email changed')],
        ['picture_changed', t('lp.settings.picture_changed', 'Picture changed')],
        ['preferred_name_changed', t('lp.settings.name_changed', 'Name changed')],
        ['user_deleted', t('lp.settings.user_deleted', 'User deleted')],
        ['user.settings.alias_added', t('lp.settings.added_user_alias', 'Added user alias')],
        ['user.settings.alias_removed', t('lp.settings.removed_user_alias', 'Removed user alias')],
        ['user.settings.alias_made_primary', t('lp.settings.user_alias_set_as_primary', 'User alias set as primary')],
      ],
    },
    {
      category: 'team',
      events: [
        ['team_created', t('lp.settings.team_created', 'Team created')],
        ['team_archived', t('lp.settings.team_archived', 'Team archived')],
        ['team_restored', t('lp.settings.team_restored', 'Team restored')],
        ['team_name_changed', t('lp.settings.team_name_changed', 'Team name changed')],
        ['team_description_changed', t('lp.settings.team_description_changed', 'Team description changed')],
        ['team_icon_changed', t('lp.settings.team_icon_changed', 'Team icon changed')],
        ['team_privacy_type_changed', t('lp.settings.changed_a_team_s_privacy_type', 'Changed a team’s privacy type')],
        ['team_default_toggled', t('lp.settings.team_default_switched', 'Team default switched')],
        ['member_added_to_team', t('lp.settings.team_membership_granted', 'Team membership granted')],
        ['member_removed_from_team', t('lp.settings.team_membership_revoked', 'Team membership revoked')],
        ['member_joined_team', t('lp.settings.member_joined_team', 'Member joined team')],
        ['member_left_team', t('lp.settings.member_left_team', 'Member left team')],
        ['member_team_role_updated', t('lp.settings.member_team_role_changed', 'Member team role changed')],
        ['team_member_default_permission_updated', t('lp.settings.team_members_default_permission_changed', 'Team members default permission changed')],
        ['team_workspace_default_permission_updated', t('lp.settings.workspace_wide_default_page_permission_c', 'Workspace-wide default page permission changed')],
        ['team_invite_access_changed', t('lp.settings.changed_who_can_invite_to_a', 'Changed who can invite to a team')],
        ['team_sidebar_editing_toggled', t('lp.settings.team_sidebar_editing_switched', 'Team sidebar editing switched')],
        ['team_export_toggled', t('lp.settings.team_export_switched', 'Team export switched')],
        ['team_public_page_sharing_toggled', t('lp.settings.team_public_page_sharing_switched', 'Team public page sharing switched')],
        ['team_guests_toggled', t('lp.settings.team_guest_access_switched', 'Team guest access switched')],
      ],
    },
    {
      category: 'form',
      events: [
        ['workspace.form.created', t('lp.settings.form_created', 'Form created')],
        ['workspace.form.content.updated', t('lp.settings.form_edited', 'Form edited')],
        ['workspace.form_response.created', t('lp.settings.created_form_response', 'Created form response')],
      ],
    },
    {
      category: 'collection',
      events: [
        ['collection_created', t('lp.settings.created_data_source', 'Created data source')],
        ['database.schema_edited', t('lp.settings.database_schema_changed', 'Database schema changed')],
        ['collection_deleted', t('lp.settings.data_source_trashed', 'Data source trashed')],
        ['collection_restored', t('lp.settings.data_source_recovered', 'Data source recovered')],
      ],
    },
  ];
}

export function eventLabel(id: string): string {
  for (const c of auditEventCatalog()) {
    const hit = c.events.find(([e]) => e === id);
    if (hit) return hit[1];
  }
  return id;
}

// ---------------------------------------------------------------------------------------------- descriptions

function user(id: string | null | undefined): UserRecord | undefined {
  return id ? records.get<UserRecord>('lit_user', id) : undefined;
}

export function nameAndEmail(id: string | null | undefined): string {
  const u = user(id);
  if (!u) return t('lp.settings.unknown', 'Unknown');
  return u.email && u.name ? `${u.name} (${u.email})` : u.name || u.email || t('lp.settings.unknown', 'Unknown');
}

function spaceRole(r: string | undefined): string {
  switch (r) {
    case 'owner': return t('lp.settings.workspace_owner', 'workspace owner');
    case 'membership_admin': return t('lp.settings.membership_admin', 'membership admin');
    case 'none': return t('lp.settings.no_access', 'no access');
    case 'guest': return t('lp.settings.guest', 'guest');
    default: return t('lp.settings.member', 'member');
  }
}

function pageRole(r: string | undefined): string {
  switch (r) {
    case 'editor': return t('lp.settings.full_access', 'Full access');
    case 'read_and_write': return t('lp.settings.can_edit', 'Can edit');
    case 'content_only_editor': return t('lp.settings.can_edit_the_content', 'Can edit the content');
    case 'comment_only': return t('lp.settings.can_comment', 'Can comment');
    case 'reader': return t('lp.settings.can_view', 'Can view');
    default: return t('lp.settings.none', 'None');
  }
}

function teamRole(r: string | undefined): string {
  return r === 'owner' ? t('lp.settings.team_owner', 'team owner') : t('lp.settings.team_member', 'team member');
}

function privacy(v: string | undefined): string {
  switch (v) {
    case 'closed': return t('lp.settings.closed', 'Closed');
    case 'private': return t('lp.settings.private', 'Private');
    case 'default': return t('lp.settings.default', 'Default');
    default: return t('lp.settings.open', 'Open');
  }
}

function toggled(enabledNow: boolean, setting: string): string {
  return enabledNow
    ? t('lp.settings.enabled', 'Enabled {workspaceSetting}', { workspaceSetting: setting })
    : t('lp.settings.disabled', 'Disabled {workspaceSetting}', { workspaceSetting: setting });
}

function enabledWord(v: boolean): string {
  return v ? t('lp.settings.enabled_df17', 'Enabled') : t('lp.settings.disabled_f4f4', 'Disabled');
}

/** One-line description of an audit event for the Audit log table. */
export function describeAuditEvent(e: AuditEntry): string {
  const d = e.data ?? {};
  const pageName = e.pageName || d.pageName || t('lp.settings.an_unnamed_page', 'an unnamed page');
  const teamName = d.teamName || records.get<TeamRecord>('team', e.teamId ?? e.targetId)?.name || t('lp.settings.a_private_team', 'a private team');
  const target = nameAndEmail(e.targetId);
  const sudo = d.withAdminPerms ? t('lp.settings.using_administrator_privileges', ' using administrator privileges') : '';
  switch (e.event) {
    case 'page_created':
      if (d.where === 'block' && d.parentPageName) return t('lp.settings.added_a_subpage_to', 'Added a subpage to {parentPageName}', { parentPageName: d.parentPageName });
      if (d.where === 'team') return t('lp.settings.added_a_page_in', 'Added a page in {teamName}', { teamName });
      if (d.where === 'space') return t('lp.settings.created_a_page_marked_private', 'Created a page marked private');
      return t('lp.settings.created_a_new_page', 'Created a new page');
    case 'page_edited': return t('lp.settings.edited', 'Edited {pageName}', { pageName });
    case 'page.properties_edited': {
      const props = (d.properties ?? []) as string[];
      return props.length > 1
        ? t('lp.settings.changed_properties_on', 'Changed properties {properties} on {pageName}', { properties: props.join(', '), pageName })
        : t('lp.settings.changed_property_on', 'Changed property {properties} on {pageName}', { properties: props[0] ?? '', pageName });
    }
    case 'page_deleted': return t('lp.settings.sent_to_trash', 'Sent {pageName} to Trash', { pageName });
    case 'page_restored': return t('lp.settings.brought_back_withadminperms_select_true', 'Brought back {pageName}{withAdminPerms, select, true { using administrator privileges} other {}}', { pageName, withAdminPerms: d.withAdminPerms ? 'true' : 'false' });
    case 'page.permanently_deleted': return t('lp.settings.permanently_deleted_from_trash_withadmin', 'Permanently deleted {pageName} from Trash{withAdminPerms, select, true { using administrator privileges} other {}}', { pageName, withAdminPerms: d.withAdminPerms ? 'true' : 'false' });
    case 'page_moved':
      return t('lp.settings.relocated_insudomode_select_true_other', 'Relocated {pageName}{oldParentMessage}{newParentMessage}{inSudoMode, select, true { using administrator privileges} other {}}', {
        pageName,
        oldParentMessage: d.oldParent ? t('lp.settings.from', ' from {oldParentName}', { oldParentName: d.oldParent }) : '',
        newParentMessage: d.newParent ? t('lp.settings.to', ' to {newParentName}', { newParentName: d.newParent }) : '',
        inSudoMode: d.withAdminPerms ? 'true' : 'false',
      });
    case 'page_permission_updated': {
      const vars = { pageName, oldRole: pageRole(d.oldRole), newRole: pageRole(d.newRole), memberNameAndEmail: nameAndEmail(d.userId), guestNameAndEmail: nameAndEmail(d.userId), teamName, inSudoMode: d.withAdminPerms ? 'true' : 'false' };
      if (d.kind === 'space_permission') return t('lp.settings.changed_workspace_wide_access_to_from', 'Changed workspace-wide access to {pageName} from {oldRole} to {newRole}{inSudoMode, select, true { using admin rights} other {}}', vars);
      return t('lp.settings.changed_s_access_to_from_to', 'Changed {memberNameAndEmail}’s access to {pageName} from {oldRole} to {newRole}{inSudoMode, select, true { using admin rights} other {}}', vars);
    }
    case 'page_shared_to_web':
      return d.enabled
        ? t('lp.settings.shared_on_the_web_insudomode_select', 'Shared {pageName} on the web{inSudoMode, select, true { using administrator privileges} other {}} with {newRole} permissions', { pageName, newRole: pageRole(d.newRole), inSudoMode: d.withAdminPerms ? 'true' : 'false' })
        : t('lp.settings.stopped_sharing_on_the_web_insudomode', 'Stopped sharing {pageName} on the web{inSudoMode, select, true { using administrator privileges} other {}}', { pageName, inSudoMode: d.withAdminPerms ? 'true' : 'false' });
    case 'page_exported': return t('lp.settings.exported', 'Exported {pageName}', { pageName });
    case 'page.lock_updated': return d.locked ? t('lp.settings.locked', 'Locked {pageName}', { pageName }) : t('lp.settings.unlocked', 'Unlocked {pageName}', { pageName });
    case 'page.archived': return t('lp.settings.archived', 'Archived {pageName}', { pageName });
    case 'page.unarchived': return t('lp.settings.unarchived', 'Unarchived {pageName}', { pageName });
    case 'page.discussion.comment.created': return t('lp.settings.commented_on', 'Commented on {pageName}', { pageName });
    case 'page.discussion.comment.updated': return t('lp.settings.changed_comment_on', 'Changed comment on {pageName}', { pageName });
    case 'page.discussion.comment.deleted': return t('lp.settings.removed_comment_from', 'Removed comment from {pageName}', { pageName });
    case 'automation_created': return t('lp.settings.created_automation_in', 'Created automation {automationName} in {pageName}', { automationName: d.name || '', pageName });
    case 'automation_edited':
      return d.deleted
        ? t('lp.settings.deleted_automation_in', 'Deleted automation {automationName} in {pageName}', { automationName: d.name || '', pageName })
        : t('lp.settings.edited_automation_in', 'Edited automation {automationName} in {pageName}', { automationName: d.name || '', pageName });
    case 'member_invited': return t('lp.settings.sent_a_workspace_invite_with_the', 'Sent {memberNameAndEmail} a workspace invite with the {newRole} role', { memberNameAndEmail: target, newRole: spaceRole(d.newRole) });
    case 'member_joined': return t('lp.settings.entered_the_workspace', 'Entered the workspace');
    case 'member_left': return t('lp.settings.exited_the_workspace', 'Exited the workspace');
    case 'member_removed': return t('lp.settings.revoked_workspace_membership_for', 'Revoked workspace membership for {memberNameAndEmail}', { memberNameAndEmail: target });
    case 'member_role_updated': return t('lp.settings.changed_from_to', 'Changed {memberNameAndEmail} from {oldRole} to {newRole}', { memberNameAndEmail: target, oldRole: spaceRole(d.oldRole), newRole: spaceRole(d.newRole) });
    case 'guest_removed': return t('lp.settings.removed_workspace_guest', 'Removed workspace guest {guestNameAndEmail}', { guestNameAndEmail: target });
    case 'membership_request_resolved':
      return t('lp.settings.the_request_to_make_a_workspace', '{status} the request to make {email} a workspace member', {
        status: d.status === 'approved' ? t('lp.settings.approved', 'Approved') : t('lp.settings.declined', 'Declined'),
        email: d.email ?? '',
      });
    case 'invite_link_toggled': return d.enabled ? t('lp.settings.invite_link_enabled', 'Invite link enabled') : t('lp.settings.invite_link_disabled', 'Invite link disabled');
    case 'invite_link_reset': return t('lp.settings.invite_link_reset', 'Invitation link reset');
    case 'workspace_name_changed': return t('lp.settings.renamed_workspace_from_to', 'Renamed workspace from “{oldValue}” to “{newValue}”', { oldValue: d.oldValue ?? '', newValue: d.newValue ?? '' });
    case 'workspace_icon_changed': return t('lp.settings.updated_workspace_icon', 'Updated workspace icon');
    case 'workspace_domain_changed': return t('lp.settings.set_a_new_workspace_domain_replacing', 'Set a new workspace domain, “{newValue}”, replacing {oldValue}', { oldValue: d.oldValue ? `“${d.oldValue}”` : '', newValue: d.newValue ?? '' });
    case 'workspace_exported': return t('lp.settings.ran_a_full_workspace_export', 'Ran a full workspace export');
    case 'export_toggled': return toggled(!d.value, t('lp.settings.export', 'export'));
    case 'disable_guests_toggled': return toggled(!d.value, t('lp.settings.guests', 'guests'));
    case 'public_page_sharing_toggled': return toggled(!d.value, t('lp.settings.public_page_sharing_by_members', 'public page sharing by members'));
    case 'pages_to_other_workspaces_toggled': return toggled(!d.value, t('lp.settings.copying_or_moving_pages_into_another', 'copying or moving pages into another workspace'));
    case 'page_access_requests_toggled': return toggled(!!d.value, t('lp.settings.non_members_asking_for_page_access', 'non-members asking for page access'));
    case 'workspace_sidebar_editing_toggled': return toggled(!!d.value, t('lp.settings.edits_to_the_workspace_section_by', 'edits to the Workspace section by members'));
    case 'membership_requests_toggled': return t('lp.settings.member_requests_to_add_new_members', '{enabled} member requests to add new members', { enabled: enabledWord(!!d.value) });
    case 'external_membership_requests_toggled': return t('lp.settings.external_user_requests_to_join_the', '{enabled} external user requests to join the workspace as members', { enabled: enabledWord(!!d.value) });
    case 'guest_membership_requests_toggled': return t('lp.settings.page_guest_requests_to_join_the', '{enabled} page guest requests to join the workspace as members', { enabled: enabledWord(!!d.value) });
    case 'team_creation_admins_setting_toggled':
      return d.value ? t('lp.settings.disabled_members_from_creating_teams', 'Disabled members from creating teams') : t('lp.settings.enabled_members_to_create_teams', 'Enabled members to create teams');
    case 'workspace.settings.permission_group_creation_policy_updated':
      return t('lp.settings.group_creation_by_members', '{enabledOrDisabled} group creation by members', { enabledOrDisabled: enabledWord(!d.value) });
    case 'workspace.settings.allow_custom_mcp_servers_setting_updated':
      return t('lp.settings.enabled_select_true_other', '{enabled, select, true {Personal MCP servers enabled} other {Personal MCP servers disabled}}', { enabled: d.value ? 'true' : 'false' });
    case 'workspace.settings.disallow_webhook_automation_action_toggled':
      return d.value ? t('lp.settings.disabled_the_send_webhook_automation_act', 'Disabled the “Send webhook” automation action') : t('lp.settings.enabled_the_send_webhook_automation_acti', 'Enabled the “Send webhook” automation action');
    case 'disable_people_directory_toggled': return t('lp.settings.visibility_of_the_people_directory', '{enabledOrDisabled} visibility of the people directory', { enabledOrDisabled: enabledWord(!!d.value) });
    case 'disable_people_hover_card_toggled': return t('lp.settings.hover_cards_for_people', '{enabledOrDisabled} hover cards for people', { enabledOrDisabled: enabledWord(!!d.value) });
    case 'allowed_email_domain_added': return t('lp.settings.added_to_the_allowed_email_domains', 'Added “{addedValue}” to the allowed email domains', { addedValue: d.addedValue ?? '' });
    case 'allowed_email_domain_removed': return t('lp.settings.is_no_longer_an_allowed_email', '“{removedValue}” is no longer an allowed email domain', { removedValue: d.removedValue ?? '' });
    case 'public_page_set': return t('lp.settings.became_the_public_homepage', '“{newPage}” became the public homepage', { newPage: d.newPage ?? '' });
    case 'public_page_cleared': return t('lp.settings.cleared_the_public_home_page', 'Cleared the public home page');
    case 'workspace.group.created': return t('lp.settings.created_group', 'Created “{groupName}” group', { groupName: d.groupName ?? '' });
    case 'workspace.group.deleted': return t('lp.settings.deleted_group', 'Deleted {groupName} group', { groupName: `“${d.groupName ?? ''}”` });
    case 'workspace.group.renamed': return t('lp.settings.renamed_group_from_to', 'Renamed group from {oldGroupName} to {newGroupName}', { oldGroupName: `“${d.oldGroupName ?? ''}”`, newGroupName: `“${d.newGroupName ?? ''}”` });
    case 'member_added_to_group': return t('lp.settings.added_to', 'Added {memberNameAndEmail} to {groupName}', { memberNameAndEmail: target, groupName: d.groupName ?? '' });
    case 'member_removed_from_group': return t('lp.settings.removed_from', 'Removed {memberNameAndEmail} from {groupName}', { memberNameAndEmail: target, groupName: d.groupName ?? '' });
    case 'workspace.group.member.role.updated':
      return t('lp.settings.switched_from_to_within_group', 'Switched {memberNameAndEmail} from {oldRole} to {newRole} within group {groupName}', {
        memberNameAndEmail: target, groupName: d.groupName ?? '',
        oldRole: d.oldRole === 'owner' ? t('lp.settings.owner', 'Owner') : t('lp.settings.member_6853', 'Member'),
        newRole: d.newRole === 'owner' ? t('lp.settings.owner', 'Owner') : t('lp.settings.member_6853', 'Member'),
      });
    case 'workspace.custom_emoji.created': return t('lp.settings.added_custom_emoji', 'Added custom emoji :{name}:', { name: d.name ?? '' });
    case 'workspace.custom_emoji.updated': return t('lp.settings.edited_custom_emoji', 'Edited custom emoji :{name}:', { name: d.name ?? '' });
    case 'workspace.custom_emoji.deleted': return t('lp.settings.deleted_a_custom_emoji', 'Deleted a custom emoji');
    case 'workspace_data_access_consent_granted': return t('lp.settings.approved_access_to_workspace_data', 'Approved access to workspace data');
    case 'workspace_data_access_consent_revoked': return t('lp.settings.withdrew_approval_to_access_workspace_da', 'Withdrew approval to access workspace data');
    case 'audit_log_exported': return t('lp.settings.ran_an_audit_log_export_covering', 'Ran an audit log export covering the past {duration} days', { duration: d.duration ?? 365 });
    case 'content_analytics_exported': return t('lp.settings.content_analytics_exported', 'Content insights downloaded');
    case 'user_analytics_exported': return t('lp.settings.user_analytics_exported', 'User insights downloaded');
    case 'admin_content_search_queried':
      return d.searchCriteria
        ? t('lp.settings.searched_content_using_these_criteria', 'Searched content using these criteria: {searchCriteria}', { searchCriteria: `“${d.searchCriteria}”` })
        : t('lp.settings.searched_content_without_any_filters', 'Searched content without any filters');
    case 'admin_content_search_exported':
      return d.searchCriteria
        ? t('lp.settings.exported_content_search_results_with_the', 'Exported content search results with these criteria: {searchCriteria}', { searchCriteria: `“${d.searchCriteria}”` })
        : t('lp.settings.exported_content_search_results_without', 'Exported content search results without filters');
    case 'login': {
      const method = d.authType === 'password' ? t('lp.settings.password', 'password') : d.authType === 'mfa' ? t('lp.settings.password_and_two_factor_authentication', 'password and two-factor authentication') : t('lp.settings.temporary_passcode', 'temporary passcode');
      return t('lp.settings.logged_in_to_via', 'Logged in to {platform} via {loginMethod}', { platform: t('lp.settings.on', 'on {platform}', { platform: 'web' }), loginMethod: method });
    }
    case 'logout': return t('lp.settings.logged_out', 'Logged out');
    case 'password_set': return t('lp.settings.added_a_password_for_signing_in', 'Added a password for signing in');
    case 'password_changed': return t('lp.settings.changed_the_login_password', 'Changed the login password');
    case 'password_cleared': return t('lp.settings.cleared_the_login_password', 'Cleared the login password');
    case 'mfa_totp_toggled': return t('lp.settings.totp_mfa', '{enabled} TOTP MFA', { enabled: enabledWord(!!d.enabled) });
    case 'mfa_backup_code_toggled': return t('lp.settings.mfa_backup_codes', '{enabled} MFA backup codes', { enabled: enabledWord(!!d.enabled) });
    case 'email_changed': return t('lp.settings.replaced_email_with', 'Replaced email {oldEmail} with {newEmail}', { oldEmail: d.oldEmail ?? '', newEmail: d.newEmail ?? '' });
    case 'picture_changed': return t('lp.settings.updated_profile_picture', 'Updated profile picture');
    case 'preferred_name_changed':
      if (!d.oldValue) return t('lp.settings.name_set_to', 'Name set to “{newValue}”', { newValue: d.newValue ?? '' });
      if (!d.newValue) return t('lp.settings.removed_name', 'Removed name “{oldValue}”', { oldValue: d.oldValue });
      return t('lp.settings.renamed_from_to', 'Renamed from “{oldValue}” to “{newValue}”', { oldValue: d.oldValue, newValue: d.newValue });
    case 'user_deleted': return t('lp.settings.user_deleted', 'User deleted');
    case 'user.settings.alias_added': return t('lp.settings.added_alias', 'Added alias “{alias}”', { alias: d.email ?? '' });
    case 'user.settings.alias_removed': return t('lp.settings.removed_alias', 'Removed alias “{alias}”', { alias: d.email ?? '' });
    case 'user.settings.alias_made_primary': return t('lp.settings.set_alias_as_primary', 'Set alias “{alias}” as primary', { alias: d.email ?? '' });
    case 'team_created': return t('lp.settings.created', 'Created {teamName}', { teamName });
    case 'team_archived': return t('lp.settings.archived_3550', 'Archived {teamName}', { teamName });
    case 'team_restored': return t('lp.settings.restored', 'Restored {teamName}', { teamName });
    case 'team_name_changed': return t('lp.settings.changed_team_name', 'Changed team name {oldTeamNameToNewTeamName}', { oldTeamNameToNewTeamName: t('lp.settings.from_to', 'from “{oldTeamName}” to “{newTeamName}”', { oldTeamName: d.oldTeamName ?? '', newTeamName: d.newTeamName ?? '' }) });
    case 'team_description_changed': return t('lp.settings.changed_the_description_of', 'Changed the description of {teamName}', { teamName });
    case 'team_icon_changed': return t('lp.settings.changed_the_icon_of', 'Changed the icon of {teamName}', { teamName });
    case 'team_privacy_type_changed': return t('lp.settings.set_s_privacy_to_was', 'Set {teamName}’s privacy to {newType} (was {oldType})', { teamName, oldType: privacy(d.oldType), newType: privacy(d.newType) });
    case 'team_default_toggled':
      return d.value
        ? t('lp.settings.made_a_default_team_so_every', 'Made {teamName} a default team, so every workspace member joins it automatically', { teamName })
        : t('lp.settings.is_no_longer_a_default_team', '{teamName} is no longer a default team, so workspace members won’t join it automatically', { teamName });
    case 'member_added_to_team': return t('lp.settings.invited_to_join_as', 'Invited {memberNameAndEmail} to join {teamName} as {teamRole}', { memberNameAndEmail: target, teamName, teamRole: teamRole(d.teamRole) });
    case 'member_removed_from_team': return t('lp.settings.removed_from_9ad8', 'Removed {memberNameAndEmail} from {teamName}', { memberNameAndEmail: target, teamName });
    case 'member_joined_team': return t('lp.settings.joined_as', 'Joined {teamName} as {teamRole}', { teamName, teamRole: teamRole(d.teamRole) });
    case 'member_left_team': return t('lp.settings.left', 'Left {teamName}', { teamName });
    case 'member_team_role_updated': return t('lp.settings.in_went_from_to', 'In {teamName}, {memberNameAndEmail} went from {oldTeamRole} to {newTeamRole}', { memberNameAndEmail: target, teamName, oldTeamRole: teamRole(d.oldTeamRole), newTeamRole: teamRole(d.newTeamRole) });
    case 'team_member_default_permission_updated': return t('lp.settings.set_as_the_default_page_access', 'Set {newRole} as the default page access for {teamName} members (was {oldRole})', { teamName, oldRole: pageRole(d.oldRole), newRole: pageRole(d.newRole) });
    case 'team_workspace_default_permission_updated': return t('lp.settings.set_as_the_default_page_access_52cd', 'Set {newRole} as the default page access to {teamName} for the rest of the workspace (was {oldRole})', { teamName, oldRole: pageRole(d.oldRole), newRole: pageRole(d.newRole) });
    case 'team_invite_access_changed':
      return t('lp.settings.set_s_invite_permission_to', 'Set {teamName}’s invite permission to {newType}', {
        teamName, newType: d.newType === 'owners' ? t('lp.settings.only_team_owners', 'only team owners') : t('lp.settings.any_team_member', 'any team member'),
      });
    case 'team_sidebar_editing_toggled':
      return d.value === 'owners'
        ? t('lp.settings.locked_the_sidebar_section_against_membe', 'Locked the {teamName} sidebar section against member edits', { teamName })
        : t('lp.settings.opened_the_sidebar_section_to_member', 'Opened the {teamName} sidebar section to member edits', { teamName });
    case 'team_export_toggled': return d.value ? t('lp.settings.export_disabled_for', 'Export disabled for {teamName}', { teamName }) : t('lp.settings.export_enabled_for', 'Export enabled for {teamName}', { teamName });
    case 'team_public_page_sharing_toggled': return d.value ? t('lp.settings.blocked_public_sharing_of_pages_by', 'Blocked public sharing of {teamName} pages by members', { teamName }) : t('lp.settings.enabled_members_to_publicly_share_pages', 'Enabled members to publicly share pages under {teamName}', { teamName });
    case 'team_guests_toggled': return d.value ? t('lp.settings.turned_off_guests_for', 'Turned off guests for {teamName}', { teamName }) : t('lp.settings.turned_on_guests_for', 'Turned on guests for {teamName}', { teamName });
    case 'workspace.form.created': return t('lp.settings.created_form', 'Created form “{name}”', { name: d.name || t('lp.settings.untitled', 'Untitled') });
    case 'workspace.form.content.updated': return t('lp.settings.edited_form', 'Edited form “{name}”', { name: d.name || t('lp.settings.untitled', 'Untitled') });
    case 'workspace.form_response.created': return t('lp.settings.submitted_a_response_to_a_form', 'Submitted a response to a form');
    case 'collection_created': return t('lp.settings.created_data_source_1add', 'Created data source “{name}”', { name: d.name || t('lp.settings.untitled_database', 'Untitled database') });
    case 'database.schema_edited': return t('lp.settings.updated_the_database_schema_for', 'Updated the database schema for “{collectionName}”', { collectionName: d.name || t('lp.settings.untitled_database', 'Untitled database') });
    case 'collection_deleted': return t('lp.settings.moved_data_source_to_trash', 'Sent data source “{name}” to Trash', { name: d.name || '' });
    case 'collection_restored': return t('lp.settings.restored_data_source_from_trash', 'Brought data source “{name}” back from Trash', { name: d.name || '' });
    case 'file_uploaded': return d.pageName !== undefined
      ? t('lp.settings.uploaded_to', 'Uploaded {fileName} to {pageName}', { fileName: String(d.fileName ?? ''), pageName: String(d.pageName || t('lp.settings.untitled', 'Untitled')) })
      : t('lp.settings.file_uploaded', 'File uploaded');
    default:
      // Custom Agents: "<event>: <agent name>"
      if (e.event.startsWith('custom_agent_') && d.agent_name) return `${eventLabel(e.event)}: ${d.agent_name}${d.triggered_by_name ? ` · ${d.triggered_by_name}` : ''}${sudo}`;
      // Litpage MCP clients (workspace_mcp_* events)
      if (e.event === 'workspace_mcp_server_connected') return `${d.client ? t('lp.settings.opened_a_litpage_mcp_connection', '{displayName} opened a Litpage MCP connection', { displayName: String(d.client) }) : t('lp.settings.mcp_server_connection_from_an_unnamed', 'MCP server connection from an unnamed client')}${sudo}`;
      if (e.event === 'workspace_mcp_allowlist_enabled') return `${t('lp.settings.mcp_allowlist_enabled', 'MCP allowlist enabled')}${sudo}`;
      if (e.event === 'workspace_mcp_allowlist_disabled') return `${t('lp.settings.mcp_allowlist_disabled', 'MCP allowlist disabled')}${sudo}`;
      if (e.event === 'workspace_mcp_client_added_to_allowlist') return `${t('lp.settings.allowlisted_the_mcp_client', 'Allowlisted the MCP client “{clientDisplayName}”', { clientDisplayName: String(d.client ?? '') })}${sudo}`;
      if (e.event === 'workspace_mcp_client_removed_from_allowlist') return `${t('lp.settings.took_the_mcp_client_off_the', 'Took the MCP client “{clientDisplayName}” off the allowlist', { clientDisplayName: String(d.client ?? '') })}${sudo}`;
      if (e.event === 'workspace_mcp_client_renamed') return `${t('lp.settings.renamed_mcp_client_to', 'Renamed MCP client to “{name}”', { name: String(d.client ?? '') })}${sudo}`;
      // API connections: "<event>: “<connection name>”"
      if (e.event.startsWith('integration.') && d.integrationName) return `${eventLabel(e.event)}: “${d.integrationName}”${sudo}`;
      return `${eventLabel(e.event)}${sudo}`;
  }
}

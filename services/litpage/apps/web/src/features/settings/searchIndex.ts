// "Search settings" index: setting names and descriptions with their location ("Workspace / General").
// Picking a result opens the section (and its tab), scrolls to the row (Row id → data-setting) and flashes it.
// Admin-only sections are dropped by SettingsModal for people who can't open them.
import { create } from 'zustand';
import { t } from '../shell/i18n.ts';

export interface SettingsHit {
  section: string;
  /** Row id (data-setting) to scroll to and highlight */
  id?: string;
  /** sub-tab inside the section (Security: general | members | retention; People: members | guests | groups …) */
  tab?: string;
  label: string;
  description?: string;
  keywords?: string[];
  /** only workspace owners can see the row (e.g. Connections › Manage) */
  owner?: boolean;
}

/** One-shot focus request consumed by the section that owns the row. */
export const useSettingsFocus = create<{ id?: string; tab?: string; section?: string; nonce: number; focus: (h: Partial<SettingsHit>) => void }>((set) => ({
  nonce: 0,
  focus: (h) => set((s) => ({ id: h.id, tab: h.tab, section: h.section, nonce: s.nonce + 1 })),
}));

export function settingsIndex(): SettingsHit[] {
  return [
    // Account
    { section: 'account', id: 'preferred-name', label: t('lp.settings.preferred_name', 'Preferred name'), keywords: ['profile', 'name', 'photo'] },
    { section: 'account', id: 'emails', label: t('lp.settings.manage_emails', 'Manage emails'), keywords: ['email', 'secondary', 'alias'] },
    { section: 'account', id: 'passkeys', label: t('lp.settings.passkeys', 'Passkeys') },
    { section: 'account', id: 'two-step', label: t('lp.settings.two_step_verification', 'Two-step verification'), keywords: ['2-step verification', 'mfa', 'authenticator', 'backup codes', 'two-step'] },
    { section: 'account', id: 'password', label: t('lp.settings.password_8be3', 'Password'), keywords: ['change password', 'remove password'] },
    { section: 'account', id: 'support-access', label: t('lp.settings.support_access', 'Support access') },
    { section: 'account', id: 'delete-account', label: t('lp.settings.delete_account', 'Delete account') },
    { section: 'account', id: 'logout-all', label: t('lp.settings.sign_out_everywhere', 'Sign out everywhere'), keywords: ['devices', 'sessions'] },
    // Preferences
    { section: 'preferences', id: 'theme', label: t('lp.settings.theme', 'Theme'), keywords: ['dark mode', 'light', 'appearance'] },
    { section: 'preferences', id: 'contrast', label: t('lp.settings.high_contrast', 'High contrast'), description: t('lp.settings.boost_contrast_for_easier_reading', 'Boost contrast for easier reading') },
    { section: 'preferences', id: 'enter', label: t('lp.settings.enter_key_inserts_a_line_break', 'Enter key inserts a line break') },
    { section: 'preferences', id: 'language', label: t('lp.settings.language', 'Language') },
    { section: 'preferences', id: 'number-format', label: t('lp.settings.number_format', 'Number format') },
    { section: 'preferences', id: 'text-direction', label: t('lp.settings.keep_text_direction_controls_visible', 'Keep text direction controls visible'), keywords: ['rtl', 'right-to-left text'] },
    { section: 'preferences', id: 'week-start', label: t('lp.settings.begin_weeks_on_monday', 'Begin weeks on Monday'), keywords: ['calendar'] },
    { section: 'preferences', id: 'date-format', label: t('lp.settings.date_format', 'Date format') },
    { section: 'preferences', id: 'tz-auto', label: t('lp.settings.set_the_time_zone_from_your', 'Set the time zone from your location automatically') },
    { section: 'preferences', id: 'time-zone', label: t('lp.settings.time_zone', 'Time zone') },
    { section: 'preferences', id: 'desktop-links', label: t('lp.settings.use_the_desktop_app_for_links', 'Use the desktop app for links') },
    { section: 'preferences', id: 'start-page', label: t('lp.settings.open_at_startup', 'Open at startup'), keywords: ['start page', 'home'] },
    { section: 'preferences', id: 'cookies', label: t('lp.settings.cookie_settings', 'Cookie settings') },
    { section: 'preferences', id: 'view-history', label: t('lp.settings.share_my_page_views', 'Share my page views'), keywords: ['analytics', 'privacy'] },
    { section: 'preferences', id: 'discoverability', label: t('lp.settings.profile_discoverability', 'Profile discoverability') },
    // Notifications
    { section: 'notifications', label: t('lp.settings.notifications', 'Notifications'), keywords: ['email notifications', 'slack', 'digest', 'push'] },
    { section: 'mail-calendar', label: t('lp.settings.mail_calendar', 'Mail & Calendar'), keywords: ['calendar', 'gmail'] },
    // Workspace › General
    { section: 'general', id: 'workspace-name', label: t('lp.settings.workspace_name', 'Workspace name') },
    { section: 'general', id: 'workspace-icon', label: t('lp.settings.icon', 'Icon') },
    { section: 'general', id: 'allowed-email-domains', label: t('lp.settings.allowed_domains', 'Allowed domains'), keywords: ['trusted domain', 'auto join', t('lp.settings.allowed_email_domains', 'Verified email domains'), t('lp.settings.email_allowlist', 'Email allowlist')] },
    { section: 'general', id: 'allowed-email-domains-join', label: t('lp.settings.let_teammates_from_approved_email_domain', 'Let teammates from approved email domains join as members'), keywords: ['join automatically', 'ask to join'] },
    { section: 'general', id: 'show-lit-apps', label: t('lp.settings.sidebar_shortcuts_to_other_litpage_apps', 'Sidebar shortcuts to other Litpage apps') },
    { section: 'general', id: 'export-content', label: t('lp.settings.export_everything_in_the_workspace', 'Export everything in the workspace'), keywords: ['export', 'backup', 'pdf'] },
    { section: 'general', id: 'export-members', label: t('lp.settings.download_member_list_as_csv', 'Download member list as CSV'), keywords: ['members csv', 'guests csv', t('lp.settings.download_the_member_list', 'Download the member list'), t('lp.settings.member_list_in_csv', 'Member list in CSV')] },
    { section: 'general', id: 'page-view-analytics', label: t('lp.settings.save_page_views_and_show_analytics', 'Save page views and show analytics') },
    { section: 'general', id: 'leave-workspace', label: t('lp.settings.leave_workspace', 'Leave workspace') },
    { section: 'general', id: 'delete-workspace', label: t('lp.settings.delete_workspace', 'Delete workspace') },
    // People
    { section: 'members', tab: 'members', label: t('lp.settings.manage_members', 'Manage members'), keywords: ['members', 'roles', 'owner', 'membership admin', 'invite link', 'users'] },
    { section: 'members', tab: 'guests', label: t('lp.settings.manage_guests', 'Manage guests'), keywords: ['guests', 'upgrade guest'] },
    { section: 'members', tab: 'groups', label: t('lp.settings.manage_groups', 'Manage groups'), keywords: ['groups'] },
    { section: 'members', id: 'people-directory', label: t('lp.settings.people_directory', 'People directory'), keywords: ['profiles'] },
    { section: 'members', id: 'hover-cards', label: t('lp.settings.hover_cards', 'Hover cards') },
    { section: 'members', tab: 'groups', id: 'group-creation', label: t('lp.settings.any_member_can_create_groups', 'Any member can create groups') },
    // Teamspaces
    { section: 'teamspaces', id: 'default-teamspaces', label: t('lp.settings.default_teams', 'Default teams') },
    { section: 'teamspaces', id: 'limit-team-creation', label: t('lp.settings.only_workspace_owners_can_create_teams', 'Only workspace owners can create teams') },
    // Sidebar
    { section: 'sidebar', label: t('lp.settings.sidebar_presets', 'Sidebar presets'), keywords: ['preset', 'tabs', 'default tab'] },
    // Security
    { section: 'security', tab: 'general', id: 'disable-public-access', label: t('lp.settings.turn_off_public_links_forms_and', 'Turn off public links, forms, and site publishing'), keywords: ['publish', 'public link'] },
    { section: 'security', tab: 'general', id: 'disable-move-to-space', label: t('lp.settings.prevent_copying_pages_to_other_workspace', 'Prevent copying pages to other workspaces') },
    { section: 'security', tab: 'general', id: 'disable-export', label: t('lp.settings.disable_export', 'Disable export') },
    { section: 'security', tab: 'general', id: 'allow-access-requests', label: t('lp.settings.let_non_members_request_access_with', 'Let non-members request access with the link') },
    { section: 'security', tab: 'general', id: 'disable-space-page-edits', label: t('lp.settings.lock_the_workspace_section_so_members', 'Lock the Workspace section so members can’t edit it') },
    { section: 'security', tab: 'general', id: 'workspace-support-access', label: t('lp.settings.let_support_access_this_workspace', 'Let support access this workspace') },
    { section: 'security', tab: 'members', id: 'allow-guests', label: t('lp.settings.members_can_share_pages_with_guests', 'Members can share pages with guests'), keywords: ['disable guests'] },
    { section: 'security', tab: 'members', id: 'guest-invite-requests', label: t('lp.settings.let_members_ask_to_invite_guests', 'Let members ask to invite guests') },
    { section: 'security', tab: 'members', id: 'member-requests', label: t('lp.settings.let_members_ask_to_add_other', 'Let members ask to add other members') },
    { section: 'security', tab: 'members', id: 'external-member-requests', label: t('lp.settings.let_anyone_ask_to_become_a', 'Let anyone ask to become a workspace member') },
    { section: 'security', tab: 'members', id: 'guest-member-requests', label: t('lp.settings.let_guests_ask_to_become_members', 'Let guests ask to become members') },
    { section: 'security', tab: 'retention', id: 'trash-retention', label: t('lp.settings.how_long_pages_stay_in_trash', 'How long pages stay in Trash'), keywords: ['data retention', 'trash'] },
    { section: 'security', tab: 'retention', id: 'purge-retention', label: t('lp.settings.how_long_deleted_pages_and_ai', 'How long deleted pages and AI chats are kept') },
    // Identity
    { section: 'identity', label: t('lp.settings.verified_domains', 'Verified domains'), keywords: ['saml', 'sso', 'scim'] },
    // Analytics / audit / content search
    { section: 'analytics', label: t('lp.settings.analytics', 'Analytics'), keywords: ['workspace analytics', 'page views', 'members activity', 'search terms'] },
    { section: 'audit-log', label: t('lp.settings.audit_log', 'Audit log'), keywords: ['events', 'security log', 'export audit'] },
    { section: 'content-search', label: t('lp.settings.content_search', 'Content search'), keywords: ['find pages', 'retained pages'] },
    // Features
    { section: 'import', label: t('lp.settings.import', 'Import'), keywords: ['csv', 'markdown', 'word', 'excel', 'html', 'zip'] },
    { section: 'lit-ai', label: t('lp.settings.litpage_ai', 'Litpage AI'), keywords: ['ai', 'instructions', 'personalize', 'web search', 'models', 'agents'] },
    { section: 'meeting-notes', label: t('lp.settings.meeting_notes', 'Meeting notes'), keywords: ['transcript', 'consent'] },
    { section: 'connections', label: t('lp.settings.connections', 'Connections'), keywords: ['integrations', 'webhooks', 'custom mcp', 'access tokens'] },
    { section: 'connections', tab: 'manage', id: 'all-connections', owner: true, label: t('lp.settings.all_connections', 'All connections'), description: t('lp.settings.apps_that_workspace_members_have_connect', 'Apps that workspace members have connected') },
    { section: 'connections', tab: 'manage', id: 'all-personal-access-tokens', owner: true, label: t('lp.settings.every_personal_access_token', 'Every personal access token'), keywords: ['pat', 'tokens'] },
    { section: 'connections', tab: 'manage', id: 'allow-webhook-actions', owner: true, label: t('lp.settings.allow_automations_to_run_webhook_actions', 'Allow automations to run webhook actions'), keywords: ['webhook', 'send webhook', 'automations'] },
    { section: 'connections', tab: 'manage', id: 'custom-mcp-servers', owner: true, label: t('lp.settings.turn_on_custom_mcp_servers', 'Turn on custom MCP servers'), keywords: ['mcp'] },
    { section: 'lit-mcp', label: t('lp.settings.litpage_mcp', 'Litpage MCP') },
    { section: 'public-pages', label: t('lp.settings.public_pages', 'Public pages'), keywords: ['sites', 'domains', 'forms', 'homepage'] },
    { section: 'emoji', id: 'emoji-admin-only', label: t('lp.settings.emoji', 'Emoji'), keywords: ['custom emoji'] },
    { section: 'developers', id: 'developer-mode', label: t('lp.settings.turn_on_developer_features', 'Turn on developer features'), keywords: ['developer mode', 'api', 'token'] },
    { section: 'developers', id: 'new-token', label: t('lp.settings.generate_your_own_api_access_token', 'Generate your own API access token') },
    // Access & billing
    { section: 'requests', label: t('lp.settings.requests', 'Requests') },
    { section: 'billing', label: t('lp.settings.billing', 'Billing'), keywords: ['invoice', 'payment'] },
    { section: 'plans', label: t('lp.settings.explore_plans', 'Explore plans'), keywords: ['upgrade', 'enterprise', 'business'] },
  ];
}

/** Exact-word-ish matching on name, description and aliases. */
export function searchSettings(query: string, allowed: (section: string) => boolean, owner = true): SettingsHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return settingsIndex()
    .filter((h) => allowed(h.section) && (!h.owner || owner))
    .filter((h) => [h.label, h.description ?? '', ...(h.keywords ?? [])].some((s) => s.toLowerCase().includes(q)))
    .slice(0, 12);
}

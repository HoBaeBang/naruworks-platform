// Settings modal ("Settings & members"): left nav (Search settings + Account / Workspace / Features /
// Access & billing groups) and the selected section. Search settings matches tab names and individual settings
// (searchIndex.ts: result location "Workspace / General", picking one scrolls to the row and flashes it).
// Admin-only sections (Teamspaces, Security, Identity, Requests, Billing) are shown to workspace admins only.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { isSpaceAdmin } from '@nc/shared/permissions.ts';
import { Icon } from '../../components/Icon.tsx';
import { useUI } from '../../lib/store/ui.ts';
import { useCurrentSpace, useCurrentUser } from '../../lib/hooks.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { UserAvatar } from './ui.tsx';
import { searchSettings, useSettingsFocus, type SettingsHit } from './searchIndex.ts';
import './icons.ts';
import './settings.css';
import { AccountSection } from './sections/account.tsx';
import { PreferencesSection } from './sections/preferences.tsx';
import { NotificationsSection, MailCalendarSection } from './sections/notifications.tsx';
import { GeneralSection, TeamspacesSection, SecuritySection, IdentitySection, RequestsSection } from './sections/workspace.tsx';
import { PeopleSection } from './sections/people.tsx';
import { ImportSection, LitAISection, MeetingNotesSection, LitMcpSection, VerifiedPagesSection, PublicPagesSection, DeveloperSection } from './sections/features.tsx';
import { ConnectionsSection } from './sections/connections.tsx';
import { EmojiSection } from './sections/emoji.tsx';
import { PlansSection, BillingSection } from './sections/plans.tsx';
import { AnalyticsSection, AuditLogSection, ContentSearchSection } from './sections/admin.tsx';
import { SidebarPresetsSection } from './sections/sidebarPresets.tsx';

export type SettingsKey =
  | 'account' | 'preferences' | 'notifications' | 'mail-calendar'
  | 'general' | 'members' | 'teamspaces' | 'sidebar' | 'security' | 'identity' | 'analytics' | 'audit-log' | 'content-search' | 'import'
  | 'lit-ai' | 'meeting-notes' | 'connections' | 'lit-mcp' | 'verified-pages' | 'public-pages' | 'emoji' | 'developers'
  | 'requests' | 'billing' | 'plans';

interface NavItem {
  key: SettingsKey;
  label: string;
  icon: string | 'avatar';
  admin?: boolean;
  /** visible to workspace owners only (admin tools and workspace settings: membership admins only manage members
   *  and groups, and have no access to the other workspace settings) */
  owner?: boolean;
  /** members see it on Enterprise workspaces (Analytics › Content) */
  enterpriseMembers?: boolean;
  badge?: string;
  /** extra words matched by "Search settings" (setting labels inside the section) */
  keywords: string[];
}

function navGroups(): { title: string; items: NavItem[] }[] {
  return [
    {
      title: t('lp.settings.account', 'Account'),
      items: [
        { key: 'account', label: '', icon: 'avatar', keywords: ['account', 'profile', 'name', 'photo', 'email', 'password', 'passkey', 'two-factor', 'devices', 'log out', 'close account', 'support access', 'user id'] },
        { key: 'preferences', label: t('lp.settings.preferences', 'Preferences'), icon: 'sliders', keywords: ['theme', 'dark', 'light', 'appearance', 'contrast', 'language', 'number format', 'date format', 'time zone', 'week starts monday', 'launch at startup', 'start page', 'cookie', 'view history', 'desktop app', 'enter'] },
        { key: 'notifications', label: t('lp.settings.notifications', 'Notifications'), icon: 'bell', keywords: ['email', 'slack', 'discord', 'teams', 'digest', 'meeting'] },
        { key: 'mail-calendar', label: t('lp.settings.mail_calendar', 'Mail & Calendar'), icon: 'envelope', keywords: ['mail', 'calendar', 'email'] },
      ],
    },
    {
      title: t('lp.settings.workspace', 'Workspace'),
      items: [
        { key: 'general', label: t('lp.settings.general', 'General'), icon: 'gear', keywords: ['workspace name', 'icon', 'domain', 'leave workspace', 'delete workspace', 'export', 'workspace id', 'sidebar'] },
        { key: 'members', label: t('lp.settings.people', 'People'), icon: 'people', keywords: ['members', 'guests', 'groups', 'invite', 'role', 'owner', 'admin'] },
        { key: 'teamspaces', label: t('lp.settings.teams', 'Teams'), icon: 'teamspace', owner: true, keywords: ['default teamspaces', 'teamspace'] },
        { key: 'sidebar', label: t('lp.settings.sidebar', 'Sidebar'), icon: 'sidebarPreset', owner: true, keywords: ['sidebar presets', 'preset', 'tabs'] },
        { key: 'import', label: t('lp.settings.import', 'Import'), icon: 'arrowLineDown', keywords: ['csv', 'markdown', 'html', 'zip', 'pdf', 'evernote', 'confluence', 'asana', 'trello', 'word', 'excel'] },
      ],
    },
    {
      title: t('lp.settings.admin', 'Admin'),
      items: [
        { key: 'security', label: t('lp.settings.security', 'Security'), icon: 'shield', owner: true, keywords: ['publishing', 'export', 'guests', 'support access', 'data retention'] },
        { key: 'identity', label: t('lp.settings.identity', 'Identity'), icon: 'idCard', owner: true, keywords: ['saml', 'sso', 'scim', 'domains'] },
        { key: 'analytics', label: t('lp.settings.analytics', 'Analytics'), icon: 'chartLine', admin: true, enterpriseMembers: true, keywords: ['workspace analytics', 'page views', 'search'] },
        { key: 'audit-log', label: t('lp.settings.audit_log', 'Audit log'), icon: 'auditLog', owner: true, keywords: ['audit', 'events', 'log'] },
        { key: 'content-search', label: t('lp.settings.content_search', 'Content search'), icon: 'contentSearch', owner: true, keywords: ['content search', 'retained pages'] },
      ],
    },
    {
      title: t('lp.settings.features', 'Features'),
      items: [
        { key: 'lit-ai', label: t('lp.settings.litpage_ai', 'Litpage AI'), icon: 'aiFace', keywords: ['ai', 'personalize', 'instructions', 'connectors', 'skills'] },
        { key: 'meeting-notes', label: t('lp.settings.meeting_notes', 'Meeting notes'), icon: 'paperMicrophone', badge: t('lp.settings.new', 'New'), keywords: ['transcript', 'consent', 'audio', 'meeting'] },
        { key: 'connections', label: t('lp.settings.connections', 'Connections'), icon: 'squareGrid2X2', keywords: ['slack', 'google', 'github', 'jira', 'integrations'] },
        { key: 'lit-mcp', label: t('lp.settings.litpage_mcp', 'Litpage MCP'), icon: 'integration', keywords: ['mcp', 'chatgpt', 'claude', 'cursor'] },
        { key: 'verified-pages', label: t('lp.settings.verified_pages', 'Verified pages'), icon: 'badgeCheck', keywords: ['verify'] },
        { key: 'public-pages', label: t('lp.settings.public_pages', 'Public pages'), icon: 'globe', keywords: ['sites', 'forms', 'domains', 'publish'] },
        { key: 'emoji', label: t('lp.settings.emoji', 'Emoji'), icon: 'emojiFace', keywords: ['custom emoji'] },
        { key: 'developers', label: t('lp.settings.developer', 'Developer'), icon: 'curlyBraces', keywords: ['token', 'api', 'developer mode'] },
      ],
    },
    {
      title: t('lp.settings.access_billing', 'Access & billing'),
      items: [
        { key: 'requests', label: t('lp.settings.requests', 'Requests'), icon: 'inboxArrowDown', admin: true, keywords: ['upgrade requests'] },
        { key: 'billing', label: t('lp.settings.billing', 'Billing'), icon: 'creditCard', owner: true, keywords: ['invoice', 'payment'] },
        { key: 'plans', label: t('lp.settings.explore_plans', 'Explore plans'), icon: 'map', keywords: ['plan', 'upgrade', 'plus', 'business', 'enterprise'] },
      ],
    },
  ];
}

const ADMIN_FALLBACK: Partial<Record<SettingsKey, SettingsKey>> = {
  teamspaces: 'general', sidebar: 'general', security: 'general', identity: 'general', analytics: 'general', 'audit-log': 'general', 'content-search': 'general',
  requests: 'plans', billing: 'plans',
};

export interface NavAccess { admin: boolean; owner: boolean; enterprise: boolean }

function visible(it: NavItem, a: NavAccess): boolean {
  if (it.owner) return a.owner;
  if (it.admin) return a.admin || (!!it.enterpriseMembers && a.enterprise);
  return true;
}

export function normalizeSettingsKey(raw: string, access: boolean | NavAccess): SettingsKey {
  const a: NavAccess = typeof access === 'boolean' ? { admin: access, owner: access, enterprise: false } : access;
  const alias: Record<string, SettingsKey> = {
    people: 'members', 'my-account': 'account', developer: 'developers', ai: 'lit-ai', mcp: 'lit-mcp', sites: 'public-pages', upgrade: 'plans',
    audit: 'audit-log', auditlog: 'audit-log', 'workspace-analytics': 'analytics', 'admin-content-search': 'content-search',
  };
  const k = (alias[raw] ?? raw) as SettingsKey;
  const item = navGroups().flatMap((g) => g.items).find((i) => i.key === k);
  if (!item) return 'account';
  if (!visible(item, a)) return ADMIN_FALLBACK[k] ?? 'account';
  return k;
}

/** "Workspace / General" location of a section for search results. */
function sectionLocation(key: string, userName: string): string {
  for (const g of navGroups()) {
    const it = g.items.find((i) => i.key === key);
    if (it) return `${g.title} / ${it.key === 'account' ? userName : it.label}`;
  }
  return '';
}

export function SettingsModal() {
  const raw = useUI((s) => s.settingsSection);
  const space = useCurrentSpace();
  const uid = useSession((s) => s.userId) ?? '';
  const user = useCurrentUser();
  const admin = isSpaceAdmin(space, uid);
  const access: NavAccess = { admin, owner: (space?.permissions ?? []).some((p) => p.user_id === uid && (p.role as string) === 'owner'), enterprise: space?.plan_type === 'enterprise' };
  const section = normalizeSettingsKey(raw, access);
  const [query, setQuery] = useState('');
  const focus = useSettingsFocus();
  const scroller = useRef<HTMLDivElement>(null);
  const close = () => useUI.getState().set({ settingsOpen: false });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('.lit-overlay-container .nc-overlay') || document.querySelector('.nc-set-dialog-layer')) return;
      e.preventDefault();
      close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [section]);

  // a picked search result: scroll the row into view once the section has rendered, then flash it
  useEffect(() => {
    if (!focus.id || focus.section !== section) return;
    let tries = 0;
    const tick = () => {
      const el = scroller.current?.querySelector<HTMLElement>(`[data-setting="${CSS.escape(focus.id!)}"]`);
      if (!el) {
        if (++tries < 20) setTimeout(tick, 50);
        return;
      }
      el.scrollIntoView({ block: 'center' });
      el.classList.remove('nc-set-flash');
      void el.offsetWidth;
      el.classList.add('nc-set-flash');
      setTimeout(() => el.classList.remove('nc-set-flash'), 1800);
    };
    setTimeout(tick, 30);
  }, [focus.nonce, section]); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return navGroups()
      .map((g) => ({
        ...g,
        items: g.items.filter((it) => visible(it, access) && (!q || (it.key === 'account' ? (user?.name ?? '') : it.label).toLowerCase().includes(q) || it.keywords.some((k) => k.includes(q)))),
      }))
      .filter((g) => g.items.length);
  }, [query, access.admin, access.owner, access.enterprise, user?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const hits = useMemo(() => {
    const keys = new Set(navGroups().flatMap((g) => g.items.filter((it) => visible(it, access)).map((it) => it.key as string)));
    return searchSettings(query, (s) => keys.has(s), access.owner);
  }, [query, access.admin, access.owner, access.enterprise]); // eslint-disable-line react-hooks/exhaustive-deps

  const openHit = (h: SettingsHit) => {
    useUI.getState().set({ settingsSection: h.section });
    useSettingsFocus.getState().focus(h);
  };

  let body: ReactNode;
  switch (section) {
    case 'account': body = <AccountSection />; break;
    case 'preferences': body = <PreferencesSection />; break;
    case 'notifications': body = <NotificationsSection />; break;
    case 'mail-calendar': body = <MailCalendarSection />; break;
    case 'general': body = <GeneralSection />; break;
    case 'members': body = <PeopleSection />; break;
    case 'teamspaces': body = <TeamspacesSection />; break;
    case 'sidebar': body = <SidebarPresetsSection />; break;
    case 'analytics': body = <AnalyticsSection />; break;
    case 'audit-log': body = <AuditLogSection />; break;
    case 'content-search': body = <ContentSearchSection />; break;
    case 'security': body = <SecuritySection />; break;
    case 'identity': body = <IdentitySection />; break;
    case 'import': body = <ImportSection />; break;
    case 'lit-ai': body = <LitAISection />; break;
    case 'meeting-notes': body = <MeetingNotesSection />; break;
    case 'connections': body = <ConnectionsSection />; break;
    case 'lit-mcp': body = <LitMcpSection />; break;
    case 'verified-pages': body = <VerifiedPagesSection />; break;
    case 'public-pages': body = <PublicPagesSection />; break;
    case 'emoji': body = <EmojiSection />; break;
    case 'developers': body = <DeveloperSection />; break;
    case 'requests': body = <RequestsSection />; break;
    case 'billing': body = <BillingSection />; break;
    case 'plans': body = <PlansSection />; break;
  }

  return createPortal(
    <div className="lit-space-settings">
      <div role="presentation" className="lit-modal-underlay" onMouseDown={close} />
      <div aria-modal="true" role="dialog" className="lit-dialog nc-set-dialog" tabIndex={-1} aria-label={t('lp.settings.settings_members', 'Settings & members')}>
        <div className="nc-set-nav">
          <div className="nc-set-nav-search">
            <div className="nc-set-search-box">
              <div className="nc-set-search-icon"><Icon name="magnifyingGlassSmall" size={16} /></div>
              <input
                aria-label={t('lp.settings.search_settings', 'Search settings')}
                placeholder={t('lp.settings.search_settings', 'Search settings')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return;
                  if (groups[0]?.items[0]) useUI.getState().set({ settingsSection: groups[0].items[0].key });
                  else if (hits[0]) openHit(hits[0]);
                }}
              />
            </div>
          </div>
          <div className="nc-set-nav-list" role="tablist" aria-orientation="vertical">
            {groups.map((g) => (
              <div key={g.title} className="nc-set-nav-group">
                <div className="nc-set-nav-group-title">{g.title}</div>
                {g.items.map((it) => (
                  <div
                    key={it.key}
                    role="tab"
                    aria-selected={section === it.key}
                    data-settings-key={it.key}
                    className={`nc-set-tab ${section === it.key ? 'selected' : ''}`}
                    onClick={() => useUI.getState().set({ settingsSection: it.key })}
                  >
                    <div className="nc-set-tab-main">
                      <div className="nc-set-tab-icon">{it.icon === 'avatar' ? <UserAvatar user={user} size={20} /> : <Icon name={it.icon} size={20} />}</div>
                      <div className="nc-set-tab-label">{it.key === 'account' ? user?.name || user?.email : it.label}</div>
                    </div>
                    {it.badge && <span className="nc-set-badge">{it.badge}</span>}
                  </div>
                ))}
              </div>
            ))}
            {hits.length > 0 && (
              <div className="nc-set-nav-group nc-set-nav-hits">
                <div className="nc-set-nav-group-title">{t('lp.settings.settings', 'Settings')}</div>
                {hits.map((h, i) => (
                  <div key={`${h.section}:${h.id ?? h.tab ?? ''}:${i}`} role="button" tabIndex={0} className="nc-set-hit" onClick={() => openHit(h)} onKeyDown={(e) => { if (e.key === 'Enter') openHit(h); }}>
                    <div className="nc-set-hit-label">{h.label}</div>
                    <div className="nc-set-hit-loc">{sectionLocation(h.section, user?.name || user?.email || '')}</div>
                  </div>
                ))}
              </div>
            )}
            {!groups.length && !hits.length && <div className="nc-set-nav-empty">{t('lp.settings.no_results', 'No results')}</div>}
          </div>
        </div>
        <div role="tabpanel" className="nc-set-panel">
          {/* no .lit-scroller: the settings panel draws no 15px custom scrollbar gutter (no thumb, controls reach the panel edge) */}
          <div ref={scroller} className="nc-set-scroller">{body}</div>
        </div>
        <div className="nc-set-close-wrap">
          <div role="button" aria-label={t('lp.settings.close', 'Close')} className="nc-set-close" onClick={close}>
            <Icon name="close" size={16} />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

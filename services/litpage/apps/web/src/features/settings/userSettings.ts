// Persisted user preferences (user_settings.settings) — read/write helpers and the hook that applies them to
// the running UI (theme, high contrast, locale). Exports used elsewhere: useApplyUserSettings (Workspace),
// savePreferredTheme (⌘⇧L shortcut, onboarding). Start page key `start_page` is read by Workspace.openStartPage.
import { useEffect } from 'react';
import type { SpaceViewRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import type { Theme } from '../../lib/store/ui.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useUserSettings } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { currentSpaceView, useSession } from '../../lib/store/session.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { getLocale, setLocale } from '../shell/i18n.ts';
import './contrast.css';
import { PilcrowRight } from 'lucide-react';
import { registerIcons } from '../../components/Icon.tsx';

registerIcons({ textDirection: PilcrowRight });

export type StartPage = 'last_visited' | 'top_page' | 'library' | 'lit_ai';
export type DateFormat = 'full' | 'short' | 'mdy' | 'dmy' | 'ymd' | 'relative';
export type NumberFormat = 'default' | 'comma_dot' | 'dot_comma';
export type Contrast = 'system' | 'standard' | 'high';

export interface UserPrefs {
  preferred_theme?: Theme;
  high_contrast?: Contrast;
  enter_new_line?: boolean;
  locale?: string;
  number_format?: NumberFormat;
  text_direction_controls?: boolean;
  start_day_of_week?: 0 | 1;
  date_format?: DateFormat;
  time_zone_auto?: boolean;
  time_zone?: string;
  open_links_desktop?: boolean;
  start_page?: StartPage;
  cookie_consent?: Record<string, boolean>;
  /** legacy boolean (before the key matched the server); see page_view_history */
  view_history?: boolean;
  /** Privacy › Show my view history — read by the server's page analytics (pages.ts) */
  page_view_history?: 'allow' | 'deny';
  profile_discoverable?: boolean;
  support_access?: boolean;
  /** when support access was granted (the server turns it off after 28 days, retention.ts) */
  support_access_granted_time?: number | null;
  notify_meeting_join?: boolean;
  notify_meeting_transcribed?: boolean;
  notify_meeting_summarized?: boolean;
  email_activity?: boolean;
  email_always?: boolean;
  email_page_updates?: boolean;
  email_workspace_digest?: boolean;
  meeting_auto_share?: boolean;
  meeting_auto_consent?: boolean;
  meeting_default_db?: string;
  developer_mode?: boolean;
  ai_instructions?: string;
  ai_instructions_page?: string | null;
  ai_name?: string;
  [k: string]: unknown;
}

const DEMO_DISPLAY_PREFS = new Set(['locale', 'preferred_theme', 'high_contrast', 'enter_new_line', 'number_format', 'text_direction_controls', 'start_day_of_week', 'date_format', 'time_zone_auto', 'time_zone', 'open_links_desktop', 'start_page']);
const demoPrefKey = (key: string) => `nc:demo-pref:${key}`;
function demoLocalPrefs(): UserPrefs {
  const out: UserPrefs = {};
  const legacyKeys: Record<string, string> = { locale: 'nc:locale', preferred_theme: 'nc:theme' };
  for (const key of DEMO_DISPLAY_PREFS) {
    try {
      const raw = localStorage.getItem(demoPrefKey(key)) ?? (legacyKeys[key] ? localStorage.getItem(legacyKeys[key]) : null);
      if (raw !== null) out[key] = JSON.parse(raw);
    } catch {
      try {
        const raw = legacyKeys[key] ? localStorage.getItem(legacyKeys[key]) : null;
        if (raw !== null) out[key] = raw;
      } catch {
        /* ignore unavailable or invalid local preferences */
      }
    }
  }
  return out;
}

export const PREF_DEFAULTS: Required<Pick<UserPrefs,
  'preferred_theme' | 'high_contrast' | 'enter_new_line' | 'number_format' | 'text_direction_controls' | 'start_day_of_week' | 'date_format' |
  'time_zone_auto' | 'open_links_desktop' | 'start_page' | 'view_history' | 'profile_discoverable' | 'support_access' | 'notify_meeting_join' |
  'notify_meeting_transcribed' | 'notify_meeting_summarized' | 'email_activity' | 'email_always' | 'email_page_updates' | 'email_workspace_digest' |
  'meeting_auto_share' | 'meeting_auto_consent' | 'developer_mode'>> = {
  preferred_theme: 'system',
  high_contrast: 'system',
  enter_new_line: false,
  number_format: 'default',
  text_direction_controls: false,
  start_day_of_week: 0,
  date_format: 'relative',
  time_zone_auto: true,
  open_links_desktop: false,
  start_page: 'last_visited',
  view_history: true,
  profile_discoverable: true,
  support_access: false,
  notify_meeting_join: false,
  notify_meeting_transcribed: true,
  notify_meeting_summarized: false,
  email_activity: true,
  email_always: false,
  email_page_updates: true,
  email_workspace_digest: true,
  meeting_auto_share: false,
  meeting_auto_consent: true,
  developer_mode: false,
};

function uid(): string {
  return useSession.getState().userId ?? '';
}

export function getUserPrefs(): UserPrefs {
  const server = (records.get<UserSettingsRecord>('user_settings', uid())?.settings ?? {}) as UserPrefs;
  return useSession.getState().demoMode.enabled ? { ...server, ...demoLocalPrefs() } : server;
}

export function usePrefs(): UserPrefs {
  const settings = useUserSettings()?.settings ?? {};
  return useSession.getState().demoMode.enabled ? { ...(settings as UserPrefs), ...demoLocalPrefs() } : settings as UserPrefs;
}

export function prefValue<K extends keyof typeof PREF_DEFAULTS>(p: UserPrefs, key: K): (typeof PREF_DEFAULTS)[K] {
  const v = p[key];
  return (v === undefined || v === null ? PREF_DEFAULTS[key] : v) as (typeof PREF_DEFAULTS)[K];
}

/** Persist preference fields to user_settings.settings (a transaction, outside the undo history). */
export function savePrefs(patch: Partial<UserPrefs>) {
  const id = uid();
  if (!id) return;
  const serverPatch: Partial<UserPrefs> = {};
  const demo = useSession.getState().demoMode.enabled;
  for (const [key, value] of Object.entries(patch)) {
    if (demo && DEMO_DISPLAY_PREFS.has(key)) {
      try { localStorage.setItem(demoPrefKey(key), JSON.stringify(value)); } catch { /* ignore */ }
    } else (serverPatch as any)[key] = value;
  }
  if (!Object.keys(serverPatch).length) return;
  const exists = !!records.get<UserSettingsRecord>('user_settings', id);
  transactions.run('', 'updateUserSettings', (tx) => {
    if (!exists) tx.set('user_settings', id, [], { id, settings: serverPatch });
    else tx.update('user_settings', id, ['settings'], serverPatch);
  }, { skipHistory: true });
}

export function savePref<K extends keyof UserPrefs>(key: K, value: UserPrefs[K]) {
  savePrefs({ [key]: value } as Partial<UserPrefs>);
}

/** Per-workspace notification toggles live on the user's space_view (notify_email / notify_desktop / notify_mobile). */
export function saveSpaceViewFields(patch: Partial<SpaceViewRecord>) {
  const sv = currentSpaceView();
  if (!sv) return;
  transactions.run(sv.space_id, 'updateSpaceView', (tx) => tx.update('space_view', sv.id, [], patch), { skipHistory: true });
}

export function saveSpaceViewSetting(key: string, value: unknown) {
  const sv = currentSpaceView();
  if (!sv) return;
  transactions.run(sv.space_id, 'updateSpaceViewSettings', (tx) => tx.update('space_view', sv.id, ['settings'], { [key]: value }), { skipHistory: true });
}

/** Change the appearance (light/dark/system) and persist it to user_settings. */
export function savePreferredTheme(theme: Theme) {
  useUI.getState().setTheme(theme);
  savePref('preferred_theme', theme);
}

/** Switch UI language: persist first (so the reloaded app reads it), then reload. */
export async function saveLocale(locale: string) {
  savePref('locale', locale);
  await transactions.flush();
  setLocale(locale, { reload: true });
}

/** Appearance › High contrast: marks the root with data-contrast="high" (tokens in contrast.css). */
export function applyContrast(c: Contrast | undefined) {
  const high = c === 'high' || (c === 'system' && window.matchMedia?.('(prefers-contrast: more)').matches);
  document.documentElement.classList.toggle('lit-high-contrast', !!high);
  if (high) document.documentElement.setAttribute('data-contrast', 'high');
  else document.documentElement.removeAttribute('data-contrast');
}

/** Privacy › Show my view history (the switch is on unless the account opted out). */
export function viewHistoryAllowed(p: UserPrefs): boolean {
  if (p.page_view_history) return p.page_view_history !== 'deny';
  return p.view_history !== false;
}

/** Preferences › Start week on Monday — every calendar grid and date picker starts its weeks on this day. */
export function weekStartDay(): 0 | 1 {
  return getUserPrefs().start_day_of_week === 1 ? 1 : 0;
}

const WEEKDAYS_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Two-letter weekday headers in the user's week order (Su…Sa or Mo…Su). */
export function weekdayHeaders(): string[] {
  const s = weekStartDay();
  return [...WEEKDAYS_SHORT.slice(s), ...WEEKDAYS_SHORT.slice(0, s)];
}

/** Language & time › Time zone: the device zone while "Set time zone automatically" is on, else the chosen zone. */
export function effectiveTimeZone(p: UserPrefs = getUserPrefs()): string {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (p.time_zone_auto !== false) return device;
  return typeof p.time_zone === 'string' && p.time_zone ? p.time_zone : device;
}

const RELOAD_GUARD = 'nc:localeReloaded';

/** Called once by Workspace: syncs user_settings → UI (theme, contrast, locale). */
export function useApplyUserSettings() {
  const settings = useUserSettings();
  const demo = useSession((s) => s.demoMode.enabled);
  const prefs = demo ? getUserPrefs() : (settings?.settings ?? {}) as UserPrefs;
  const theme = prefs.preferred_theme;
  const locale = prefs.locale;
  const contrast = prefs.high_contrast;

  // theme: the device keeps its own choice ("on this device"); a fresh device adopts the account preference
  useEffect(() => {
    if (!theme) return;
    let local: string | null = null;
    try {
      local = localStorage.getItem('nc:theme');
    } catch {
      /* ignore */
    }
    if (!local && useUI.getState().theme !== theme) useUI.getState().setTheme(theme);
  }, [theme, demo]);

  useEffect(() => {
    applyContrast(contrast ?? 'system');
    if ((contrast ?? 'system') !== 'system') return;
    const mq = window.matchMedia?.('(prefers-contrast: more)');
    const on = () => applyContrast('system');
    mq?.addEventListener?.('change', on);
    return () => mq?.removeEventListener?.('change', on);
  }, [contrast, demo]);

  // Show my view history: older clients saved a boolean the server never read — carry an opt-out over once
  const legacyOptOut = prefs.view_history === false && !prefs.page_view_history;
  useEffect(() => {
    if (legacyOptOut) savePrefs({ page_view_history: 'deny' });
  }, [legacyOptOut]);

  // deep links: /<domain>?target=billing | imports | ai | developer | notifications | mcp | connected_apps …
  useEffect(() => {
    openSettingsFromUrl();
  }, []);

  // language: follow the account setting (once per tab session to avoid reload loops)
  useEffect(() => {
    if (!locale) return;
    const normalized = locale === 'ko-KR' ? 'ko-KR' : 'en-US';
    if (normalized === getLocale()) return;
    try {
      if (sessionStorage.getItem(RELOAD_GUARD) === normalized) return;
      sessionStorage.setItem(RELOAD_GUARD, normalized);
    } catch {
      /* ignore */
    }
    setLocale(normalized, { reload: true });
  }, [locale, demo]);
}

/** `?target=` deep links → settings sections (the param is removed after opening). */
const TARGETS: Record<string, string> = {
  billing: 'billing', plans: 'plans', upgrade: 'plans', imports: 'import', import: 'import', ai: 'lit-ai', lit_ai: 'lit-ai',
  developer: 'developers', developers: 'developers', notifications: 'notifications', mcp: 'lit-mcp', 'integrations_mcp.settings': 'lit-mcp',
  connected_apps: 'connections', connections: 'connections', integrations: 'connections', members: 'members', people: 'members',
  security: 'security', identity: 'identity', general: 'general', account: 'account', preferences: 'preferences', emoji: 'emoji',
  sites: 'public-pages', public_pages: 'public-pages', teamspaces: 'teamspaces', audit_log: 'audit-log', analytics: 'analytics',
  content_search: 'content-search', sidebar: 'sidebar', requests: 'requests', meeting_notes: 'meeting-notes', mail_calendar: 'mail-calendar',
};

export function openSettingsFromUrl() {
  let url: URL;
  try {
    url = new URL(location.href);
  } catch {
    return;
  }
  const target = url.searchParams.get('target');
  if (!target) return;
  const section = TARGETS[target];
  if (!section) return;
  url.searchParams.delete('target');
  history.replaceState(history.state, '', url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : '') + url.hash);
  useUI.getState().openSettings(section);
}

/** Block menu "Text direction" item: always with Preferences › Always show text direction controls, and for RTL languages. */
export function showTextDirectionControls(): boolean {
  const p = getUserPrefs();
  return !!p.text_direction_controls || /^(ar|he|fa|ur)\b/.test(String(p.locale ?? getLocale()));
}

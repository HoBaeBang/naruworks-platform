import { HELP_URL } from '@nc/shared/brand.ts';
// Settings › Preferences: Appearance (theme, high
// contrast), Input options, Language & time (language, number format, text direction, week start, date format,
// time zone), Desktop app (open links, open on start), Privacy (cookies, view history, discoverability).
import { useMemo, useState } from 'react';
import { openMenu } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { useUI, type Theme } from '../../../lib/store/ui.ts';
import { t, getLocale } from '../../shell/i18n.ts';
import { Badge, Button, Dropdown, Group, Row, SectionPage, Switch, msg, rich, openSubDialog, type Option } from '../ui.tsx';
import {
  applyContrast, prefValue, saveLocale, savePref, savePrefs, savePreferredTheme, usePrefs, viewHistoryAllowed, type Contrast, type DateFormat, type NumberFormat,
  type StartPage,
} from '../userSettings.ts';

/** Languages offered by the language picker (native name, English name). The UI itself is translated into en-US and ko-KR. */
export const LANGUAGES: { id: string; native: string; english: string }[] = [
  { id: 'ar-SA', native: 'العربية', english: 'Arabic' },
  { id: 'da-DK', native: 'Dansk', english: 'Danish' },
  { id: 'nl-NL', native: 'Nederlands', english: 'Dutch' },
  { id: 'en-GB', native: 'English (UK)', english: 'English (UK)' },
  { id: 'en-US', native: 'English (US)', english: 'English (US)' },
  { id: 'fi-FI', native: 'Suomi', english: 'Finnish' },
  { id: 'fr-FR', native: 'Français (France)', english: 'French (France)' },
  { id: 'de-DE', native: 'Deutsch', english: 'German' },
  { id: 'he-IL', native: 'עברית', english: 'Hebrew' },
  { id: 'id-ID', native: 'Bahasa Indonesia', english: 'Indonesian' },
  { id: 'it-IT', native: 'Italiano', english: 'Italian' },
  { id: 'ja-JP', native: '日本語', english: 'Japanese' },
  { id: 'ko-KR', native: '한국어', english: 'Korean' },
  { id: 'nb-NO', native: 'Norsk', english: 'Norwegian' },
  { id: 'pt-BR', native: 'Português (Brasil)', english: 'Portuguese (Brazil)' },
  { id: 'zh-CN', native: '简体中文', english: 'Simplified Chinese' },
  { id: 'es-LA', native: 'Español (Latinoamérica)', english: 'Spanish (Latin American)' },
  { id: 'es-ES', native: 'Español (España)', english: 'Spanish (Spain)' },
  { id: 'sv-SE', native: 'Svenska', english: 'Swedish' },
  { id: 'th-TH', native: 'ภาษาไทย', english: 'Thai' },
  { id: 'zh-TW', native: '繁體中文', english: 'Traditional Chinese' },
  { id: 'vi-VN', native: 'Tiếng Việt', english: 'Vietnamese' },
];

function dateSamples(): Record<DateFormat, string> {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return {
    full: `@${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
    short: `@${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    mdy: `@${mm}/${dd}/${d.getFullYear()}`,
    dmy: `@${dd}/${mm}/${d.getFullYear()}`,
    ymd: `@${d.getFullYear()}/${mm}/${dd}`,
    relative: `@${t('lp.settings.today', 'Today')}`,
  };
}

function gmtOffset(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const off = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off);
    if (!m) return '(GMT+0:00)';
    return `(GMT${m[1]}${Number(m[2])}:${m[3] ?? '00'})`;
  } catch {
    return '(GMT)';
  }
}

export function tzLabel(tz: string): string {
  const city = tz.split('/').pop()?.replace(/_/g, ' ') ?? tz;
  return `${gmtOffset(tz)} ${city}`;
}

function allTimeZones(): string[] {
  const anyIntl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  try {
    return anyIntl.supportedValuesOf?.('timeZone') ?? ['UTC', 'Asia/Seoul', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'America/Los_Angeles'];
  } catch {
    return ['UTC', 'Asia/Seoul'];
  }
}

function TimeZoneButton({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (tz: string) => void }) {
  const zones = useMemo(allTimeZones, []);
  return (
    <div
      role="button"
      aria-haspopup="dialog"
      aria-disabled={disabled || undefined}
      className="nc-set-btn nc-set-dropdown"
      onClick={(e) => {
        if (disabled) return;
        openMenu(e.currentTarget as HTMLElement, {
          width: 300,
          maxHeight: 360,
          search: t('lp.settings.search_time_zones', 'Search time zones…'),
          sections: [{ items: zones.map((z) => ({ label: tzLabel(z), text: `${z} ${tzLabel(z)}`, checked: z === value, onSelect: () => onChange(z) })) }],
        }, { placement: 'bottom-end' });
      }}
    >
      <span>{tzLabel(value)}</span>
      <span className="chev"><Icon name="arrowChevronSingleDownSmall" size={14} /></span>
    </div>
  );
}

export function PreferencesSection() {
  const prefs = usePrefs();
  const theme = useUI((s) => s.theme);
  const localeId = (prefs.locale as string | undefined) ?? getLocale();
  const tzAuto = prefValue(prefs, 'time_zone_auto');
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const tz = tzAuto ? deviceTz : ((prefs.time_zone as string | undefined) ?? deviceTz);
  const samples = dateSamples();
  const themeOpts: Option<Theme>[] = [
    { value: 'system', label: t('lp.settings.follow_system_setting', 'Follow system setting') },
    { value: 'light', label: t('lp.settings.light', 'Light') },
    { value: 'dark', label: t('lp.settings.dark', 'Dark') },
  ];
  const contrastOpts: Option<Contrast>[] = [
    { value: 'system', label: t('lp.settings.follow_system_setting', 'Follow system setting') },
    { value: 'standard', label: t('lp.settings.standard_contrast', 'Standard contrast') },
    { value: 'high', label: t('lp.settings.high_contrast', 'High contrast') },
  ];
  const numberOpts: Option<NumberFormat>[] = [
    { value: 'default', label: t('lp.settings.default', 'Default') },
    { value: 'comma_dot', label: t('lp.settings.1_000_000_00', '1,000,000.00') },
    { value: 'dot_comma', label: t('lp.settings.1_000_000_00_bfa5', '1.000.000,00') },
  ];
  const dateOpts: Option<DateFormat>[] = [
    { value: 'full', label: t('lp.settings.full_date', 'Full date'), description: samples.full },
    { value: 'short', label: t('lp.settings.short_date', 'Short date'), description: samples.short },
    { value: 'mdy', label: t('lp.settings.month_day_year', 'Month, day, year'), description: samples.mdy },
    { value: 'dmy', label: t('lp.settings.day_month_year', 'Day, month, year'), description: samples.dmy },
    { value: 'ymd', label: t('lp.settings.year_month_day', 'Year, month, day'), description: samples.ymd },
    { value: 'relative', label: t('lp.settings.relative', 'Relative'), description: samples.relative },
  ];
  const startOpts: Option<StartPage>[] = [
    { value: 'last_visited', label: t('lp.settings.last_opened_page', 'Last opened page') },
    { value: 'top_page', label: t('lp.settings.first_sidebar_page', 'First sidebar page') },
    { value: 'library', label: t('lp.settings.library', 'Library') },
    { value: 'lit_ai', label: t('lp.settings.litpage_ai', 'Litpage AI') },
  ];
  const langOpts: Option[] = LANGUAGES.map((l) => ({ value: l.id, label: l.native, description: l.english }));
  const curLang = LANGUAGES.find((l) => l.id === localeId) ?? LANGUAGES.find((l) => l.id === 'en-US')!;

  return (
    <SectionPage title={t('lp.settings.preferences', 'Preferences')} subtitle={t('lp.settings.set_how_litpage_looks_and_works', 'Set how Litpage looks and works')}>
      <Group title={t('lp.settings.appearance', 'Appearance')}>
        <Row
          id="theme"
          label={t('lp.settings.theme', 'Theme')}
          description={t('lp.settings.set_litpage_s_appearance_for_this', 'Set Litpage’s appearance for this device')}
          control={<Dropdown label="Theme" value={theme} options={themeOpts} onChange={(v) => savePreferredTheme(v)} />}
        />
        <Row
          id="contrast"
          label={t('lp.settings.high_contrast', 'High contrast')}
          badge={<Badge tone="gray">{t('lp.settings.beta', 'Beta')}</Badge>}
          description={t('lp.settings.boost_contrast_for_easier_reading', 'Boost contrast for easier reading')}
          control={<Dropdown label="High contrast" value={prefValue(prefs, 'high_contrast')} options={contrastOpts} onChange={(v) => { savePref('high_contrast', v); applyContrast(v); }} />}
        />
      </Group>

      <Group title={t('lp.settings.input_options', 'Input options')}>
        <Row
          id="enter"
          label={t('lp.settings.enter_key_inserts_a_line_break', 'Enter key inserts a line break')}
          description={rich(msg('lp.settings.in_chat_comments_and_similar_text', 'In chat, comments, and similar text boxes, <bold>Cmd</bold>/<bold>Ctrl</bold> + <bold>Enter</bold> sends your message.'), {}, { bold: (c) => <strong>{c}</strong> })}
          control={<Switch label="Press Enter for a new line" checked={prefValue(prefs, 'enter_new_line')} onChange={(v) => savePref('enter_new_line', v)} />}
        />
      </Group>

      <Group title={t('lp.settings.language_time', 'Language & time')}>
        <Row
          id="language"
          label={t('lp.settings.language', 'Language')}
          description={t('lp.settings.select_the_language_for_litpage', 'Select the language for Litpage')}
          control={
            <Dropdown
              label="Language"
              value={curLang.id}
              options={langOpts}
              width={260}
              maxHeight={420}
              renderLabel={() => curLang.native}
              onChange={(v) => { if (v !== curLang.id) void saveLocale(v); }}
            />
          }
        />
        <Row
          id="number-format"
          label={t('lp.settings.number_format', 'Number format')}
          description={t('lp.settings.choose_number_and_currency_formats_by', 'Choose number and currency formats. By default, Litpage follows your language.')}
          control={<Dropdown label="Number format" value={prefValue(prefs, 'number_format')} options={numberOpts} onChange={(v) => savePref('number_format', v)} />}
        />
        <Row
          id="text-direction"
          label={t('lp.settings.keep_text_direction_controls_visible', 'Keep text direction controls visible')}
          description={t('lp.settings.let_the_editor_offer_left_to', 'Let the editor offer left-to-right or right-to-left text direction, whatever your language')}
          control={<Switch label="Keep direction controls visible" checked={prefValue(prefs, 'text_direction_controls')} onChange={(v) => savePref('text_direction_controls', v)} />}
        />
        <Row
          id="week-start"
          label={t('lp.settings.begin_weeks_on_monday', 'Begin weeks on Monday')}
          description={t('lp.settings.this_changes_how_calendars_are_shown', 'This changes how calendars are shown in Litpage')}
          control={<Switch label="Begin weeks on Monday" checked={prefValue(prefs, 'start_day_of_week') === 1} onChange={(v) => savePref('start_day_of_week', v ? 1 : 0)} />}
        />
        <Row
          id="date-format"
          label={t('lp.settings.date_format', 'Date format')}
          description={t('lp.settings.choose_how_new_date_mentions_are', 'Choose how new @date mentions are formatted by default')}
          control={<Dropdown label="Date format" value={prefValue(prefs, 'date_format')} options={dateOpts} onChange={(v) => savePref('date_format', v)} />}
        />
        <Row
          id="tz-auto"
          label={t('lp.settings.set_the_time_zone_from_your', 'Set the time zone from your location automatically')}
          description={t('lp.settings.reminders_notifications_and_emails_use_y', 'Reminders, notifications, and emails use your time zone')}
          control={<Switch label="Set time zone automatically" checked={tzAuto} onChange={(v) => { savePref('time_zone_auto', v); if (!v && !prefs.time_zone) savePref('time_zone', deviceTz); }} />}
        />
        <Row
          id="time-zone"
          label={t('lp.settings.time_zone', 'Time zone')}
          description={t('lp.settings.set_the_time_zone_you_re', 'Set the time zone you’re in')}
          control={<TimeZoneButton value={tz} disabled={tzAuto} onChange={(z) => savePref('time_zone', z)} />}
        />
      </Group>

      <Group title={t('lp.settings.desktop_app', 'Desktop app')}>
        <Row
          id="desktop-links"
          label={t('lp.settings.use_the_desktop_app_for_links', 'Use the desktop app for links')}
          description={rich(
            msg('lp.settings.open_litpage_links_in_the_desktop', 'Open Litpage links in the desktop app. This is automatic when the <desktopAppLink>{platform} app</desktopAppLink> is installed.'),
            { platform: /Mac/.test(navigator.platform) ? 'macOS' : 'Windows' },
            { desktopAppLink: (c) => HELP_URL ? <a href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c },
          )}
          control={<Switch label="Open links in the desktop app" checked={prefValue(prefs, 'open_links_desktop')} onChange={(v) => savePref('open_links_desktop', v)} />}
        />
        <Row
          id="desktop-browser"
          label=""
          description={rich(
            msg('lp.settings.to_use_your_browser_for_links', 'To use your browser for links instead, open the desktop app’s <bold>Settings</bold> and enable <bold>Open Litpage links in browser</bold>.'),
            {},
            { bold: (c) => <strong>{c}</strong> },
          )}
          control={HELP_URL ? <Button onClick={() => window.open(HELP_URL!, '_blank')}>{t('lp.settings.launch_desktop_app', 'Launch desktop app')}</Button> : null}
        />
        <Row
          id="start-page"
          label={t('lp.settings.open_at_startup', 'Open at startup')}
          description={t('lp.settings.choose_the_page_that_opens_when', 'Choose the page that opens when Litpage starts or you change workspaces')}
          control={<Dropdown label="Launch on startup" value={prefValue(prefs, 'start_page')} options={startOpts} onChange={(v) => savePref('start_page', v)} />}
        />
      </Group>

      <Group title={t('lp.settings.privacy', 'Privacy')}>
        <Row
          id="cookies"
          label={t('lp.settings.cookie_settings', 'Cookie settings')}
          description={rich(msg('lp.settings.read_the_cookie_notice_for_details', 'Read the <cookielink>Cookie Notice</cookielink> for details'), {}, {
            cookielink: (c) => HELP_URL ? <a href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
          })}
          control={
            <div role="button" aria-haspopup="dialog" className="nc-set-btn nc-set-dropdown" onClick={() => openCookieDialog()}>
              <span>{t('lp.settings.customize', 'Customize')}</span>
              <span className="chev"><Icon name="arrowChevronSingleDownSmall" size={14} /></span>
            </div>
          }
        />
        <Row
          id="view-history"
          label={t('lp.settings.share_my_page_views', 'Share my page views')}
          description={rich(msg('lp.settings.your_page_views_are_visible_to', 'Your page views are visible to people who have edit or full access. <inlinelink>Learn more</inlinelink>'), {}, {
            inlinelink: (c) => HELP_URL ? <a href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
          })}
          control={<Switch label="Show my page history" checked={viewHistoryAllowed(prefs)} onChange={(v) => savePrefs({ page_view_history: v ? 'allow' : 'deny', view_history: v })} />}
        />
        <Row
          id="discoverability"
          label={t('lp.settings.profile_discoverability', 'Profile discoverability')}
          description={rich(msg('lp.settings.when_someone_who_knows_your_email', 'When someone who knows your email invites you to a workspace, they’ll see your Litpage name and profile photo. <inlinelink>Learn more</inlinelink>'), {}, {
            inlinelink: (c) => HELP_URL ? <a href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
          })}
          control={<Switch label="Profile discoverability" checked={prefValue(prefs, 'profile_discoverable')} onChange={(v) => savePref('profile_discoverable', v)} />}
        />
      </Group>
    </SectionPage>
  );
}

function openCookieDialog() {
  openSubDialog((close) => <CookieDialog close={close} />);
}

function CookieDialog({ close }: { close: () => void }) {
  const prefs = usePrefs();
  const saved = (prefs.cookie_consent ?? {}) as Record<string, boolean>;
  const [state, setState] = useState<Record<string, boolean>>({ preferences: saved.preferences ?? true, analytics: saved.analytics ?? true, targeting: saved.targeting ?? false });
  const rows: { key: string; title: string; caption: string; locked?: boolean }[] = [
    { key: 'necessary', title: t('lp.settings.strictly_necessary', 'Strictly necessary'), caption: t('lp.settings.always_on_since_the_site_can', 'Always on, since the site can’t work without these.'), locked: true },
    { key: 'preferences', title: t('lp.settings.functional', 'Functional'), caption: t('lp.settings.helps_remember_your_choices_and_enable', 'Helps remember your choices and enable extra features.') },
    { key: 'analytics', title: t('lp.settings.analytics', 'Analytics'), caption: t('lp.settings.helps_us_understand_usage_and_improve', 'Helps us understand usage and improve your experience.') },
    { key: 'targeting', title: t('lp.settings.marketing', 'Marketing'), caption: t('lp.settings.used_to_show_relevant_ads', 'Used to show relevant ads.') },
  ];
  const save = (next: Record<string, boolean>) => {
    savePref('cookie_consent', { necessary: true, ...next });
    close();
  };
  return (
    <>
      <h3>{t('lp.settings.customize_cookies', 'Customize cookies')}</h3>
      {rows.map((r) => (
        <Row
          key={r.key}
          label={r.title}
          description={r.caption}
          control={<Switch label={r.title} checked={r.locked ? true : !!state[r.key]} disabled={r.locked} onChange={(v) => setState({ ...state, [r.key]: v })} />}
        />
      ))}
      <div className="actions">
        <Button variant="primary" onClick={() => save(state)}>{t('lp.settings.done', 'Done')}</Button>
        <Button onClick={() => save({ preferences: true, analytics: true, targeting: true })}>{t('lp.settings.accept_all', 'Accept all')}</Button>
        <Button onClick={() => save({ preferences: false, analytics: false, targeting: false })}>{t('lp.settings.reject_all', 'Reject all')}</Button>
      </div>
    </>
  );
}

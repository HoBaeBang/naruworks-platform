import { HELP_URL } from '@nc/shared/brand.ts';
// Settings › Admin: Analytics, Audit log and Content search, Enterprise tools for
// workspace owners (Analytics › Content is open to every member of an Enterprise workspace). Data comes from
// apps/server/src/api/modules/admin.ts (owner/plan checks on the server).
import { useEffect, useState, type ReactNode } from 'react';
import type { TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { openPage, pageUrl } from '../../../lib/router.ts';
import { useTableVersion } from '../../../lib/hooks.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { getLocale, t } from '../../shell/i18n.ts';
import { Button, Dropdown, Pills, SectionPage, UserAvatar, confirmDialog, msg, openSubDialog, rich } from '../ui.tsx';
import { savePref, usePrefs } from '../userSettings.ts';
import { retentionDurationLabel, spaceSetting, useSpaceAccess } from '../spaceSettings.ts';
import { purgeRetentionDays, trashRetentionDays } from '@nc/shared/retention.ts';
import { auditEventCatalog, categoryLabel, describeAuditEvent, eventLabel, nameAndEmail, type AuditCategory, type AuditEntry } from '../auditEvents.ts';
import { requestUpgrade } from './features.tsx';
import { AgentAnalytics, SharedWithAgentFilter } from '../../agents/AgentsAdmin.tsx';
import '../admin.css';

const DAY = 86_400_000;

function toastError(e: unknown) {
  useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
}

function userOf(id: string | null | undefined): UserRecord | undefined {
  return id ? records.get<UserRecord>('lit_user', id) : undefined;
}

function displayName(id: string | null | undefined): string {
  const u = userOf(id);
  return u?.name || u?.email || t('lp.settings.unknown', 'Unknown');
}

function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms));
}

function fmtDay(ms: number | null | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms));
}

function download(url: string, filename?: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename ?? '';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Enterprise upsell card shown in place of an admin tool (owners upgrade, members request). */
function EnterpriseUpsell({ title, description, points }: { title: string; description: string; points?: string[] }) {
  const { space, owner } = useSpaceAccess();
  return (
    <div className="nc-set-ent-upsell">
      <div className="ttl">{title}</div>
      <div className="desc">{description}</div>
      {points && (
        <ul>
          {points.map((p) => <li key={p}><Icon name="checkmarkFillSmall" size={14} />{p}</li>)}
        </ul>
      )}
      <div className="actions">
        {owner
          ? <Button variant="primary" onClick={() => useUI.getState().set({ settingsSection: 'plans' })}>{t('lp.settings.upgrade_to_enterprise', 'Upgrade to Enterprise')}</Button>
          : <Button variant="primary" onClick={() => space && void requestUpgrade(space.id, 'enterprise')}>{t('lp.settings.request_upgrade', 'Request upgrade')}</Button>}
        {HELP_URL && <Button onClick={() => window.open(HELP_URL!, '_blank', 'noopener')}>{t('lp.settings.learn_more', 'Learn more')}</Button>}
      </div>
    </div>
  );
}

/** Small SVG line/bar chart: one series of {date, value}. */
function TrendChart({ points, kind = 'line', label }: { points: { date: number; value: number }[]; kind?: 'line' | 'bar'; label: string }) {
  const W = 760;
  const H = 160;
  const pad = { l: 32, r: 8, t: 10, b: 22 };
  const max = Math.max(1, ...points.map((p) => p.value));
  const step = points.length > 1 ? (W - pad.l - pad.r) / (points.length - 1) : 0;
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const x = (i: number) => pad.l + i * step;
  const ticks = [...new Set([0, Math.round(max / 2), max])]; // max 1 → [0, 1] (no duplicate tick)
  const every = Math.max(1, Math.ceil(points.length / 6));
  if (!points.some((p) => p.value > 0)) return <div className="nc-set-chart-empty">{t('lp.settings.there_isn_t_enough_data_to', 'There isn’t enough data to show a graph')}</div>;
  return (
    <svg className="nc-set-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="none">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={pad.l - 6} y={y(v) + 4} className="tick" textAnchor="end">{v}</text>
        </g>
      ))}
      {kind === 'line' ? (
        <polyline className="line" fill="none" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(' ')} />
      ) : points.map((p, i) => {
        const w = Math.max(2, step * 0.6 || 12);
        return <rect key={p.date} className="bar" x={x(i) - w / 2} y={y(p.value)} width={w} height={H - pad.b - y(p.value)}><title>{`${fmtDay(p.date)}: ${p.value}`}</title></rect>;
      })}
      {kind === 'line' && points.map((p, i) => <circle key={p.date} className="dot" cx={x(i)} cy={y(p.value)} r={p.value ? 2.5 : 0}><title>{`${fmtDay(p.date)}: ${p.value}`}</title></circle>)}
      {points.map((p, i) => (i % every === 0 ? <text key={`l${p.date}`} x={x(i)} y={H - 6} className="tick" textAnchor="middle">{new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric' }).format(new Date(p.date))}</text> : null))}
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------- Analytics

type AnalyticsTab = 'overview' | 'members' | 'content' | 'ai' | 'search';

const RANGE_OPTIONS = () => [
  { value: '7', label: t('lp.settings.last_7_days', 'Last 7 Days') },
  { value: '28', label: t('lp.settings.last_28_days', 'Last 28 Days') },
  { value: '90', label: t('lp.settings.last_90_days', 'Last 90 Days') },
  { value: '365', label: t('lp.settings.last_365_days', 'Last 365 Days') },
];

function lowerRange(days: number): string {
  switch (days) {
    case 7: return t('lp.settings.last_7_days_7252', 'last 7 days');
    case 90: return t('lp.settings.last_90_days_b8a5', 'last 90 days');
    case 365: return t('lp.settings.last_365_days_9e64', 'last 365 days');
    default: return t('lp.settings.last_28_days_766c', 'last 28 days');
  }
}

export function AnalyticsSection() {
  const { space, admin, owner, plan } = useSpaceAccess();
  const memberOnly = !owner;
  const [tab, setTab] = useState<AnalyticsTab>(memberOnly ? 'content' : 'overview');
  const [days, setDays] = useState(28);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<'views' | 'uniqueViewers' | 'lastEdited'>('views');
  const [busy, setBusy] = useState(false);
  useTableVersion(['lit_user', 'team']);
  const enterprise = plan === 'enterprise';
  const disabled = space ? spaceSetting<boolean>(space, 'page_view_analytics', true) === false : false;

  useEffect(() => {
    if (!space?.id || !enterprise) return;
    let off = false;
    setData(null);
    setErr('');
    const h = setTimeout(() => {
      api<any>('getWorkspaceAnalytics', { spaceId: space.id, tab, days, query: tab === 'content' ? query : undefined, sort })
        .then((r) => { if (off) return; records.mergeRecordMap(r.recordMap); setData(r); })
        .catch((e) => { if (!off) setErr((e as Error).message); });
    }, tab === 'content' ? 200 : 0);
    return () => { off = true; clearTimeout(h); };
  }, [space?.id, tab, days, query, sort, enterprise]);

  if (!space) return null;
  const header = (
    <SectionPage wide title={t('lp.settings.analytics', 'Analytics')} subtitle={t('lp.settings.view_workspace_activity_and_feature_use', 'View workspace activity and feature use')} />
  );
  if (!enterprise) {
    return (
      <div className="nc-set-column wide">
        {header}
        <EnterpriseUpsell
          title={t('lp.settings.track_litpage_and_ai_use', 'Track Litpage and AI use')}
          description={t('lp.settings.upgrade_to_enterprise_to_see_workspace', 'Upgrade to Enterprise to see workspace engagement, adoption patterns, and AI usage')}
          points={[
            t('lp.settings.workspace_adoption_data', 'Workspace adoption data'),
            t('lp.settings.content_engagement_over_time', 'Content engagement over time'),
            t('lp.settings.insights_by_page', 'Insights by page'),
            t('lp.settings.search_insights', 'Search insights'),
            t('lp.settings.ai_adoption_overview', 'AI adoption overview'),
          ]}
        />
      </div>
    );
  }
  const exportCsv = async () => {
    setBusy(true);
    try {
      const r = await api<{ url: string; filename: string }>('exportWorkspaceAnalytics', { spaceId: space.id, tab, days, query });
      download(r.url, r.filename);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const tabs: { value: AnalyticsTab; label: string }[] = memberOnly
    ? [{ value: 'content', label: t('lp.settings.content', 'Content') }]
    : [
      { value: 'overview', label: t('lp.settings.overview', 'Overview') },
      { value: 'members', label: t('lp.settings.members', 'Members') },
      { value: 'content', label: t('lp.settings.content', 'Content') },
      { value: 'ai', label: t('lp.settings.ai', 'AI') },
      { value: 'search', label: t('lp.settings.search', 'Search') },
    ];
  return (
    <div className="nc-set-column wide nc-set-analytics">
      {header}
      <div className="nc-set-toolbar wrap">
        <Pills value={tab} onChange={setTab} items={tabs} />
        <div style={{ flex: 1 }} />
        <span className="nc-set-muted">{t('lp.settings.activity_shown_for', 'Activity shown for')}</span>
        <Dropdown width={200} label={t('lp.settings.activity_shown_for', 'Activity shown for')} value={String(days)} options={RANGE_OPTIONS()} onChange={(v) => setDays(Number(v))} />
        {(tab === 'members' || tab === 'content') && (
          <Button icon="download" disabled={busy} onClick={() => void exportCsv()}>{t('lp.settings.export_to_csv', 'Download CSV')}</Button>
        )}
      </div>
      {disabled && (tab === 'overview' || tab === 'members' || tab === 'content') && (
        <div className="nc-set-ent-upsell plain">
          <div className="ttl">{t('lp.settings.analytics_are_turned_off', 'Analytics are turned off')}</div>
          <div className="desc">{t('lp.settings.an_admin_has_turned_off_page', 'An admin has turned off page view recording for {name}. Page views aren’t recorded while it’s off.', { name: space.name })}</div>
          {admin && <div><Button onClick={() => useUI.getState().set({ settingsSection: 'general' })}>{t('lp.settings.settings', 'Settings')}</Button></div>}
        </div>
      )}
      {err && <div className="nc-set-empty">{err}</div>}
      {!err && !data && <div className="nc-set-empty">{t('lp.settings.loading', 'Loading…')}</div>}
      {!err && data && data.tab === tab && (
        <>
          {tab === 'overview' && <AnalyticsOverview data={data} days={days} />}
          {tab === 'members' && <AnalyticsMembers data={data} />}
          {tab === 'content' && <AnalyticsContent data={data} query={query} setQuery={setQuery} sort={sort} setSort={setSort} />}
          {tab === 'ai' && <AnalyticsAi data={data} days={days} />}
          {tab === 'search' && <AnalyticsSearch data={data} />}
        </>
      )}
    </div>
  );
}

function changeByline(cur: number, prev: number, days: number): string {
  const key = `last_${days === 365 ? 365 : days === 90 ? 90 : days === 7 ? 7 : 28}_days`;
  if (!prev || cur === prev) {
    if (!prev && cur) return t('lp.settings.up_members_compared_with_the_prior', 'Up {changeValue} members compared with the prior {numberOfDays} days', { changeValue: cur, numberOfDays: days });
    return t(`workspaceAnalytics.overview.userEngagement.summaryByline.${key}.none`, `No changes in previous ${days} days`);
  }
  const pct = Math.round((Math.abs(cur - prev) / prev) * 100);
  return cur > prev
    ? t(`workspaceAnalytics.overview.userEngagement.summaryByline.${key}.positive`, `{changeInPercentage}% more than previous ${days} days`, { changeInPercentage: pct })
    : t(`workspaceAnalytics.overview.userEngagement.summaryByline.${key}.negative`, `{changeInPercentage}% less than previous ${days} days`, { changeInPercentage: pct });
}

function RankList({ title, rows }: { title: string; rows: { key: string; icon: ReactNode; label: string; caption: string; onClick?: () => void }[] }) {
  return (
    <div className="nc-set-rank">
      <div className="ttl">{title}</div>
      {!rows.length && <div className="none">—</div>}
      {rows.map((r) => (
        <div key={r.key} className={`row ${r.onClick ? 'clickable' : ''}`} role={r.onClick ? 'button' : undefined} onClick={r.onClick}>
          {r.icon}
          <span className="label nc-ellipsis">{r.label}</span>
          <span className="cap">{r.caption}</span>
        </div>
      ))}
    </div>
  );
}

function AnalyticsOverview({ data, days }: { data: any; days: number }) {
  const tot = data.totals ?? {};
  return (
    <>
      <div className="nc-set-cards2">
        <div className="nc-set-statcard" data-card="user-engagement">
          <div className="hdr">{t('lp.settings.user_engagement', 'User engagement')}</div>
          <div className="big">{t('lp.settings.active_members', '{activeMembersCount} active members', { activeMembersCount: tot.activeMembers ?? 0 })}</div>
          <div className="sub">{changeByline(tot.activeMembers ?? 0, tot.previousActiveMembers ?? 0, days)}</div>
          {(tot.activeGuests ?? 0) > 0 && <div className="sub">{t('lp.settings.active_guests', '{activeGuestsCount} active guests', { activeGuestsCount: tot.activeGuests })}</div>}
          <RankList
            title={t('lp.settings.leading_viewers', 'Leading viewers')}
            rows={(data.topViewers ?? []).map((u: any) => ({ key: u.userId, icon: <UserAvatar user={userOf(u.userId)} size={20} />, label: displayName(u.userId), caption: t('lp.settings.views', '{pageViews} views', { pageViews: u.count }) }))}
          />
          <RankList
            title={t('lp.settings.leading_editors', 'Leading editors')}
            rows={(data.topEditors ?? []).map((u: any) => ({ key: u.userId, icon: <UserAvatar user={userOf(u.userId)} size={20} />, label: displayName(u.userId), caption: t('lp.settings.edits', '{pageEdits} edits', { pageEdits: u.count }) }))}
          />
          <RankList
            title={t('lp.settings.most_active_teams', 'Most active teams')}
            rows={(data.topTeams ?? []).map((tm: any) => ({ key: tm.teamId, icon: <Icon name="teamspace" size={18} />, label: records.get<TeamRecord>('team', tm.teamId)?.name || t('lp.settings.untitled', 'Untitled'), caption: t('lp.settings.views', '{pageViews} views', { pageViews: tm.views }) }))}
          />
        </div>
        <div className="nc-set-statcard" data-card="content-engagement">
          <div className="hdr">{t('lp.settings.content_engagement', 'Content engagement')}</div>
          <div className="big">{t('lp.settings.total_views', '{pageViews} total views', { pageViews: tot.pageViews ?? 0 })}</div>
          <div className="sub">{t('lp.settings.uniquepageviews_plural_one_distinct_page', '{uniquePageViews, plural, one {{uniquePageViews} distinct page opened} other {{uniquePageViews} distinct pages opened}}', { uniquePageViews: tot.uniquePagesViewed ?? 0 })}</div>
          <div className="sub">{t('lp.settings.pages_created', '{pagesCreated} pages created', { pagesCreated: tot.pagesCreated ?? 0 })} · {t('lp.settings.edits', '{pageEdits} edits', { pageEdits: tot.pageEdits ?? 0 })}</div>
          <RankList
            title={t('lp.settings.popular_pages', 'Popular pages')}
            rows={(data.topPages ?? []).map((p: any) => ({
              key: p.pageId, icon: <Icon name="page" size={16} />, label: p.title || t('lp.settings.untitled', 'Untitled'),
              caption: t('lp.settings.views', '{pageViews} views', { pageViews: p.views }),
              onClick: p.canOpen ? () => { useUI.getState().set({ settingsOpen: false }); openPage(p.pageId); } : undefined,
            }))}
          />
        </div>
      </div>
      <div className="nc-set-chartcard">
        <div className="hdr">{t('lp.settings.active_member_trend', 'Active member trend')}</div>
        <div className="sub">{t('lp.settings.viewed_a_page_during', 'Viewed a page during {dateRange}', { dateRange: lowerRange(days) })}</div>
        <TrendChart label={t('lp.settings.active_member_trend', 'Active member trend')} points={(data.activeSeries ?? []).map((p: any) => ({ date: p.date, value: p.active }))} />
      </div>
    </>
  );
}

function SortHead({ label, active, onClick, tooltip }: { label: string; active: boolean; onClick?: () => void; tooltip?: string }) {
  return (
    <span className={`sort ${active ? 'active' : ''}`} role={onClick ? 'button' : undefined} onClick={onClick} data-tooltip={tooltip}>
      {label}
      {active && <Icon name="arrowStraightDownFill" size={12} />}
    </span>
  );
}

function AnalyticsMembers({ data }: { data: any }) {
  const [sort, setSort] = useState<'pageViews' | 'pageEdits' | 'lastActive' | 'user'>('pageViews');
  const rows = [...(data.members ?? [])].sort((a: any, b: any) => (sort === 'user' ? displayName(a.userId).localeCompare(displayName(b.userId)) : (b[sort] ?? -1) - (a[sort] ?? -1)));
  if (!rows.length) return <div className="nc-set-empty">{t('lp.settings.no_matching_members', 'No matching members')}</div>;
  return (
    <table className="nc-set-table nc-set-atable">
      <thead>
        <tr>
          <th style={{ width: '40%' }}><SortHead label={t('lp.settings.user', 'User')} active={sort === 'user'} onClick={() => setSort('user')} /></th>
          <th><SortHead label={t('lp.settings.page_views', 'Page views')} active={sort === 'pageViews'} onClick={() => setSort('pageViews')} tooltip={t('lp.settings.total_page_views_by_this_user', 'Total page views by this user across all workspace pages')} /></th>
          <th><SortHead label={t('lp.settings.page_edits', 'Page edits')} active={sort === 'pageEdits'} onClick={() => setSort('pageEdits')} tooltip={t('lp.settings.total_page_edits_by_this_user', 'Total page edits by this user across all workspace pages')} /></th>
          <th><SortHead label={t('lp.settings.last_active_b566', 'Last active')} active={sort === 'lastActive'} onClick={() => setSort('lastActive')} tooltip={t('lp.settings.last_active_means_the_user_visited', 'Last active means the user visited a page in this workspace')} /></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((m: any) => (
          <tr key={m.userId} data-user-id={m.userId}>
            <td className="primary">
              <span className="nc-set-user">
                <UserAvatar user={userOf(m.userId)} size={22} />
                <span className="nc-ellipsis">{displayName(m.userId)}</span>
                {m.optedOut && <span className="nc-set-optout" data-tooltip={t('lp.settings.this_user_turned_off_page_view', 'This user turned off page view tracking')}><Icon name="eyeOff" size={14} /></span>}
              </span>
            </td>
            <td>{m.optedOut ? '—' : m.pageViews}</td>
            <td>{m.pageEdits}</td>
            <td>{fmtDay(m.lastActive)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AnalyticsContent({ data, query, setQuery, sort, setSort }: { data: any; query: string; setQuery: (v: string) => void; sort: string; setSort: (v: any) => void }) {
  return (
    <>
      <div className="nc-set-input nc-set-search-inline" style={{ maxWidth: 320 }}>
        <Icon name="magnifyingGlassSmall" size={16} />
        <input aria-label={t('lp.settings.search_pages', 'Search pages')} placeholder={t('lp.settings.search_pages', 'Search pages')} value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {!(data.pages ?? []).length ? (
        <div className="nc-set-empty">
          {t('lp.settings.no_matching_pages', 'No pages match')}
          <div className="nc-set-muted">{t('lp.settings.no_pages_match_the_current_search', 'No pages match the current search')}</div>
        </div>
      ) : (
        <table className="nc-set-table nc-set-atable">
          <thead>
            <tr>
              <th style={{ width: '38%' }}>{t('lp.settings.page', 'Page')}</th>
              <th><SortHead label={t('lp.settings.all_views', 'All views')} active={sort === 'views'} onClick={() => setSort('views')} tooltip={t('lp.settings.times_users_viewed_this_page', 'Times users viewed this page')} /></th>
              <th><SortHead label={t('lp.settings.unique_views', 'Unique views')} active={sort === 'uniqueViewers'} onClick={() => setSort('uniqueViewers')} tooltip={t('lp.settings.users_who_viewed_this_page_during', 'Users who viewed this page during the selected period')} /></th>
              <th>{t('lp.settings.created_by_5d73', 'Created by')}</th>
              <th><SortHead label={t('lp.settings.last_edited', 'Last edited')} active={sort === 'lastEdited'} onClick={() => setSort('lastEdited')} /></th>
            </tr>
          </thead>
          <tbody>
            {data.pages.map((p: any) => (
              <tr key={p.pageId} className="clickable" onClick={() => { useUI.getState().set({ settingsOpen: false }); openPage(p.pageId); }}>
                <td className="primary"><span className="nc-set-user"><Icon name="page" size={16} /><span className="nc-ellipsis">{p.title || t('lp.settings.untitled', 'Untitled')}</span></span></td>
                <td>{p.views}</td>
                <td>{p.uniqueViewers}</td>
                <td><span className="nc-set-user"><UserAvatar user={userOf(p.createdBy)} size={18} /><span className="nc-ellipsis">{displayName(p.createdBy)}</span></span></td>
                <td>{fmtDay(p.lastEditedTime)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

function AnalyticsAi({ data, days }: { data: any; days: number }) {
  const tot = data.totals ?? {};
  return (
    <>
      <div className="nc-set-cards4">
        <div className="nc-set-statcard small"><div className="hdr">{t('lp.settings.active_ai_users', 'Active AI users')}</div><div className="big">{tot.activeAiMembers ?? 0}</div></div>
        <div className="nc-set-statcard small"><div className="hdr" data-tooltip={t('lp.settings.out_of_all_active_members_the', 'Out of all active members, the share who’ve used AI in this workspace')}>{t('lp.settings.ai_utilization', 'AI utilization')}</div><div className="big">{Math.round((tot.utilization ?? 0) * 100)}%</div></div>
        <div className="nc-set-statcard small"><div className="hdr">{t('lp.settings.total_ai_actions_taken', 'Total AI actions taken')}</div><div className="big">{tot.aiActions ?? 0}</div></div>
        <div className="nc-set-statcard small"><div className="hdr">{t('lp.settings.ai_actions_per_member_on_average', 'AI actions per member, on average')}</div><div className="big">{(tot.actionsPerUser ?? 0).toFixed(1)}</div></div>
      </div>
      <div className="nc-set-chartcard">
        <div className="hdr">{t('lp.settings.ai_actions', 'AI actions')}</div>
        <div className="sub">{t('lp.settings.ai_actions_during', 'AI actions during {lookbackPeriod}', { lookbackPeriod: lowerRange(days) })}</div>
        <TrendChart kind="bar" label={t('lp.settings.ai_actions', 'AI actions')} points={(data.series ?? []).map((p: any) => ({ date: p.date, value: p.actions }))} />
      </div>
      <div className="nc-set-chartcard">
        <div className="hdr">{t('lp.settings.every_workspace_member', 'Every workspace member')}</div>
        <div className="sub">{t('lp.settings.ai_usage_attributed_to_each_member', 'AI usage attributed to each member')}</div>
        {!(data.topUsers ?? []).length ? <div className="nc-set-empty">{t('lp.settings.no_matching_users', 'No matching users')}</div> : (
          <table className="nc-set-table nc-set-atable">
            <thead><tr><th style={{ width: '60%' }}>{t('lp.settings.user', 'User')}</th><th>{t('lp.settings.ai_actions', 'AI actions')}</th></tr></thead>
            <tbody>
              {data.topUsers.map((u: any) => (
                <tr key={u.userId}><td className="primary"><span className="nc-set-user"><UserAvatar user={userOf(u.userId)} size={20} />{displayName(u.userId)}</span></td><td>{u.actions}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <AgentAnalytics days={days} />
    </>
  );
}

function AnalyticsSearch({ data }: { data: any }) {
  const rows = data.queries ?? [];
  if (!rows.length) {
    return (
      <div className="nc-set-empty">
        {t('lp.settings.nothing_to_show_for_this_workspace', 'Nothing to show for this workspace over the past 90 days')}
        <div className="nc-set-muted">{t('lp.settings.search_terms_appear_here_once_at', 'Search terms appear here once at least two people have searched them twice. {count} searches were recorded.', { count: data.totalSearches ?? 0 })}</div>
      </div>
    );
  }
  return (
    <table className="nc-set-table nc-set-atable">
      <thead>
        <tr>
          <th style={{ width: '46%' }}>{t('lp.settings.query', 'Query')}</th>
          <th data-tooltip={t('lp.settings.times_workspace_users_searched_for_this', 'Times workspace users searched for this query')}>{t('lp.settings.searches', 'Searches')}</th>
          <th data-tooltip={t('lp.settings.workspace_users_who_searched_for_this', 'Workspace users who searched for this query')}>{t('lp.settings.unique_searches', 'Unique searches')}</th>
          <th data-tooltip={t('lp.settings.share_of_searches_that_opened_a', 'Share of searches that opened a page from this query’s results')}>{t('lp.settings.rate_of_clicks', 'Rate of clicks')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((q: any) => (
          <tr key={q.query}><td className="primary">{q.query}</td><td>{q.searches}</td><td>{q.uniqueSearches}</td><td>{Math.round(q.clickThroughRate * 100)}%</td></tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------------------------- Audit log

interface AuditFilters { from?: number; to?: number; dateLabel?: string; actorIds: string[]; events: string[]; teamId?: string; requestId?: string; relatedText?: string }

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function AuditLogSection() {
  const { space, owner, plan } = useSpaceAccess();
  const [filters, setFilters] = useState<AuditFilters>({ actorIds: [], events: [] });
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [err, setErr] = useState('');
  const [cursors, setCursors] = useState<({ time: number; id: string } | null)[]>([null]);
  const [next, setNext] = useState<{ time: number; id: string } | null>(null);
  const [actors, setActors] = useState<{ userId: string; removed: boolean }[]>([]);
  useTableVersion(['lit_user', 'team']);
  const enterprise = plan === 'enterprise';
  const cursor = cursors[cursors.length - 1];

  useEffect(() => {
    if (!space?.id || !enterprise || !owner) return;
    let off = false;
    setEntries(null);
    setErr('');
    api<any>('getAuditLog', { spaceId: space.id, from: filters.from, to: filters.to, actorIds: filters.actorIds, events: filters.events, teamId: filters.teamId, requestId: filters.requestId, cursor, limit: 50 })
      .then((r) => { if (off) return; records.mergeRecordMap(r.recordMap); setEntries(r.entries); setNext(r.nextCursor); })
      .catch((e) => { if (!off) setErr((e as Error).message || t('lp.settings.couldn_t_load_audit_logs', 'Couldn’t load audit logs')); });
    return () => { off = true; };
  }, [space?.id, enterprise, owner, filters, cursor]);

  useEffect(() => {
    if (!space?.id || !enterprise || !owner) return;
    void api<any>('getAuditLogActors', { spaceId: space.id }).then((r) => { records.mergeRecordMap(r.recordMap); setActors(r.actors); }).catch(() => {});
  }, [space?.id, enterprise, owner]);

  if (!space) return null;
  const header = <SectionPage wide title={t('lp.settings.audit_log', 'Audit log')} subtitle={t('lp.settings.see_a_record_of_workspace_activity', 'See a record of workspace activity and export it')} />;
  if (!enterprise) {
    return (
      <div className="nc-set-column wide">
        {header}
        <EnterpriseUpsell
          title={t('lp.settings.track_every_change_in_your_workspace', 'Track every change in your workspace')}
          description={t('lp.settings.upgrade_to_the_enterprise_plan_to', 'Upgrade to the Enterprise plan to view and export a log of page, workspace, account and team events.')}
          points={[categoryLabel('page'), categoryLabel('workspace'), categoryLabel('account'), categoryLabel('team')]}
        />
      </div>
    );
  }
  const update = (patch: Partial<AuditFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setCursors([null]);
  };
  const teams = records.all<TeamRecord>('team').filter((tm) => tm.space_id === space.id && tm.alive !== false);
  const totalEvents = auditEventCatalog().reduce((n, c) => n + c.events.length, 0);

  const dateMenu = (anchor: HTMLElement) => {
    const today = startOfToday();
    const pick = (from: number | undefined, to: number | undefined, label?: string) => update({ from, to, dateLabel: label });
    openMenu(anchor, {
      width: 240,
      sections: [
        {
          items: [
            { label: t('lp.settings.today', 'Today'), onSelect: () => pick(today, undefined, t('lp.settings.today', 'Today')) },
            { label: t('lp.settings.yesterday', 'Yesterday'), onSelect: () => pick(today - DAY, today - 1, t('lp.settings.yesterday', 'Yesterday')) },
            { label: t('lp.settings.last_7_days_df83', 'Last 7 days'), onSelect: () => pick(today - 6 * DAY, undefined, t('lp.settings.last_7_days_df83', 'Last 7 days')) },
            { label: t('lp.settings.last_30_days', 'Last 30 days'), onSelect: () => pick(today - 29 * DAY, undefined, t('lp.settings.last_30_days', 'Last 30 days')) },
          ],
        },
        {
          items: [
            { label: t('lp.settings.custom_range', 'Custom range'), icon: 'calendarRange', onSelect: () => { openSubDialog((close) => <DateRangeBody close={close} initial={filters} onApply={(from, to) => pick(from, to, `${fmtDay(from)} – ${fmtDay(to)}`)} />); } },
            ...(filters.from || filters.to ? [{ label: t('lp.settings.clear', 'Clear'), icon: 'xMarkSmall', onSelect: () => pick(undefined, undefined) }] : []),
          ],
        },
      ],
    }, { placement: 'bottom-start' });
  };
  const personMenu = (anchor: HTMLElement) => {
    const sel = new Set(filters.actorIds);
    openMenu(anchor, {
      width: 300,
      maxHeight: 360,
      search: t('lp.settings.search_user', 'Search user...'),
      sections: [{
        title: t('lp.settings.select_users', 'Select users'),
        items: actors.map((a) => ({
          label: displayName(a.userId), text: `${displayName(a.userId)} ${userOf(a.userId)?.email ?? ''}`, icon: <UserAvatar user={userOf(a.userId)} size={20} />,
          description: (userOf(a.userId) as { bot?: unknown } | undefined)?.bot ? t('lp.settings.agent', 'Agent') : a.removed ? t('lp.settings.removed', 'Removed') : undefined,
          checked: sel.has(a.userId),
          onSelect: () => { update({ actorIds: sel.has(a.userId) ? filters.actorIds.filter((x) => x !== a.userId) : [...filters.actorIds, a.userId] }); },
        })),
      }],
    }, { placement: 'bottom-start' });
  };
  const eventMenu = (anchor: HTMLElement) => {
    openSubDialog((close) => <EventFilterBody close={close} selected={filters.events} onApply={(events) => update({ events })} />);
    void anchor;
  };
  const teamMenu = (anchor: HTMLElement) => {
    openMenu(anchor, {
      width: 260,
      search: t('lp.settings.search_teams_07a1', 'Search teams…'),
      sections: [{
        items: [
          ...teams.map((tm) => ({ label: tm.name || t('lp.settings.untitled', 'Untitled'), text: tm.name, icon: 'teamspace', description: tm.archived_by ? t('lp.settings.archived_eddc', 'Archived') : undefined, checked: filters.teamId === tm.id, onSelect: () => update({ teamId: filters.teamId === tm.id ? undefined : tm.id }) })),
        ],
      }],
    }, { placement: 'bottom-start' });
  };
  const exportMenu = (anchor: HTMLElement) => {
    const run = async (days: number | null) => {
      const today = startOfToday();
      const from = days ? today - (days - 1) * DAY : filters.from;
      const to = days ? undefined : filters.to;
      const ok = await confirmDialog({
        title: t('lp.settings.export_f3e4', 'Export'),
        description: days === 365
          ? t('lp.settings.export_a_one_year_csv_you', 'Export a one-year CSV? You can’t start another export while this one runs in the background.')
          : t('lp.settings.export_audit_logs_from_through_the', 'Export audit logs from {startDate} through {endDate}? The export uses the current filters. You can’t start another export while this one runs in the background.', { startDate: fmtDay(from ?? today - 364 * DAY), endDate: fmtDay(to ?? Date.now()) }),
        confirmLabel: t('lp.settings.export_f3e4', 'Export'),
      });
      if (!ok) return;
      try {
        const r = await api<{ url: string; filename: string }>('downloadAuditLog', { spaceId: space.id, from, to, actorIds: filters.actorIds, events: filters.events, teamId: filters.teamId });
        download(r.url, r.filename);
      } catch (e) {
        toastError(e);
      }
    };
    openMenu(anchor, {
      width: 220,
      sections: [{
        items: [
          { label: t('lp.settings.last_30_days', 'Last 30 days'), onSelect: () => void run(30) },
          { label: t('lp.settings.last_60_days', 'Last 60 days'), onSelect: () => void run(60) },
          { label: t('lp.settings.last_90_days_c328', 'Last 90 days'), onSelect: () => void run(90) },
          { label: t('lp.settings.last_1_year', 'Last 1 year'), onSelect: () => void run(365) },
          { label: t('lp.settings.export_a_custom_range', 'Export a custom range'), onSelect: () => void run(null) },
        ],
      }],
    }, { placement: 'bottom-end' });
  };
  const pill = (label: ReactNode, active: boolean, onClick: (el: HTMLElement) => void, testId: string) => (
    <div role="button" tabIndex={0} data-filter={testId} className={`nc-set-fpill ${active ? 'active' : ''}`} onClick={(e) => onClick(e.currentTarget)}>
      {label}
      <Icon name="arrowChevronSingleDownSmall" size={12} />
    </div>
  );
  return (
    <div className="nc-set-column wide nc-set-audit">
      {header}
      <div className="nc-set-toolbar wrap">
        {pill(filters.dateLabel ? <><b>{t('lp.settings.date', 'Date')}</b>: {filters.dateLabel}</> : t('lp.settings.date', 'Date'), !!filters.dateLabel, dateMenu, 'date')}
        {pill(filters.actorIds.length ? <><b>{t('lp.settings.person', 'Person')}</b>: {filters.actorIds.map(displayName).join(', ')}</> : t('lp.settings.person', 'Person'), filters.actorIds.length > 0, personMenu, 'person')}
        {pill(filters.events.length ? <><b>{t('lp.settings.event', 'Event')}</b>: {t('lp.settings.of_selected', '{totalNumSelected} of {totalNumEvents} selected', { totalNumSelected: filters.events.length, totalNumEvents: totalEvents })}</> : t('lp.settings.event', 'Event'), filters.events.length > 0, eventMenu, 'event')}
        {pill(filters.teamId ? <><b>{t('lp.settings.team', 'Team')}</b>: {records.get<TeamRecord>('team', filters.teamId)?.name}</> : t('lp.settings.team', 'Team'), !!filters.teamId, teamMenu, 'teamspace')}
        {filters.requestId && (
          <div className="nc-set-fpill active">
            {filters.relatedText ? t('lp.settings.related_to', 'Related to: {text}', { text: filters.relatedText.slice(0, 40) }) : t('lp.settings.related', 'Related')}
            <span role="button" aria-label={t('lp.settings.clear_the_related_request_filter', 'Clear the related request filter')} onClick={() => update({ requestId: undefined, relatedText: undefined })}><Icon name="xMarkSmall" size={12} /></span>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <span data-tooltip={t('lp.settings.select_to_export_the_audit_log', 'Select to export the audit log as CSV')}>
          <Button icon="download" onClick={(e) => exportMenu(e.currentTarget)}>{t('lp.settings.export_f3e4', 'Export')}</Button>
        </span>
      </div>
      {err && <div className="nc-set-empty">{err}</div>}
      {!err && entries === null && <div className="nc-set-empty">{t('lp.settings.loading', 'Loading…')}</div>}
      {!err && entries && !entries.length && (
        <div className="nc-set-empty">
          {t('lp.settings.no_results', 'No results')}
          <div className="nc-set-muted">{t('lp.settings.try_different_filters_logs_can_take', 'Try different filters. Logs can take a little while to appear.')}</div>
        </div>
      )}
      {!err && entries && entries.length > 0 && (
        <table className="nc-set-table nc-set-atable nc-set-audit-table">
          <thead>
            <tr>
              <th style={{ width: '24%' }}>{t('lp.settings.user', 'User')}</th>
              <th>{t('lp.settings.event', 'Event')}</th>
              <th style={{ width: '22%' }}>{t('lp.settings.timestamp', 'Timestamp')}</th>
              <th style={{ width: 64 }} />
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const desc = describeAuditEvent(e);
              const removed = !!e.actorId && !(space.permissions ?? []).some((p) => p.user_id === e.actorId && p.role !== 'none');
              return (
                <tr key={e.id} data-event={e.event}>
                  <td className="primary">
                    <span className="nc-set-user">
                      <UserAvatar user={userOf(e.actorId)} size={22} />
                      <span className="nc-ellipsis">{displayName(e.actorId)}</span>
                      {removed && <span className="nc-set-badge gray">{t('lp.settings.removed', 'Removed')}</span>}
                    </span>
                  </td>
                  <td className="primary">
                    <div className="nc-set-audit-ev" data-tooltip={e.audience ? t('lp.settings.page_audience', 'Page audience: {audience}', { audience: audienceWord(e.audience) }) : undefined}>
                      <span className="cat">{eventLabel(e.event)}</span>
                      <span className="desc">{desc}</span>
                    </div>
                  </td>
                  <td>
                    <span data-tooltip={`${t('lp.settings.utc', 'UTC: {time}', { time: new Date(e.time).toISOString().replace('T', ' ').slice(0, 19) })}${e.ip ? ` · ${t('lp.settings.ip_address', 'IP address: {ip}', { ip: e.ip })}` : ''}`}>{fmtDateTime(e.time)}</span>
                  </td>
                  <td>
                    <span className="nc-set-row-acts">
                      {e.requestId && (
                        <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.related_to_0af0', 'Related to')} data-tooltip={t('lp.settings.related_to_0af0', 'Related to')} onClick={() => update({ requestId: e.requestId!, relatedText: desc })}>
                          <Icon name="magnifyingGlassSmall" size={14} />
                        </span>
                      )}
                      <span
                        role="button"
                        className="nc-set-icon-btn"
                        aria-label={t('lp.settings.copy_row', 'Copy row')}
                        data-tooltip={t('lp.settings.copy_row', 'Copy row')}
                        onClick={() => {
                          void navigator.clipboard?.writeText([new Date(e.time).toISOString(), nameAndEmail(e.actorId), eventLabel(e.event), desc, e.ip ?? ''].join('\t'));
                          useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete'));
                        }}
                      >
                        <Icon name="copySmall" size={14} />
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {!err && entries && (cursors.length > 1 || next) && (
        <div className="nc-set-pager">
          <Button disabled={cursors.length <= 1} onClick={() => setCursors((c) => c.slice(0, -1))}>{t('lp.settings.previous', 'Previous')}</Button>
          <Button disabled={!next} onClick={() => next && setCursors((c) => [...c, next])}>{t('lp.settings.next', 'Next')}</Button>
        </div>
      )}
      <div className="nc-set-muted small">{t('lp.settings.the_audit_log_keeps_one_year', 'The audit log keeps one year of events.')}</div>
    </div>
  );
}

function audienceWord(a: string | undefined): string {
  switch (a) {
    case 'shared_to_web': return t('lp.settings.shared_on_the_web', 'Shared on the web');
    case 'shared_externally': return t('lp.settings.shared_externally', 'shared externally');
    case 'shared_internally':
    case 'shared_to_workspace': return t('lp.settings.shared_internally', 'shared internally');
    default: return t('lp.settings.private_e807', 'private');
  }
}

function DateRangeBody({ close, initial, onApply }: { close: () => void; initial: AuditFilters; onApply: (from: number, to: number) => void }) {
  const iso = (ms: number | undefined) => (ms ? new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 10) : '');
  const [from, setFrom] = useState(iso(initial.from) || iso(startOfToday() - 6 * DAY));
  const [to, setTo] = useState(iso(initial.to) || iso(Date.now()));
  const floor = startOfToday() - 364 * DAY;
  const f = from ? new Date(`${from}T00:00:00`).getTime() : NaN;
  const tt = to ? new Date(`${to}T23:59:59`).getTime() : NaN;
  const bad = !Number.isFinite(f) || !Number.isFinite(tt) || f > tt;
  return (
    <>
      <h3>{t('lp.settings.custom_range', 'Custom range')}</h3>
      <div className="nc-set-daterange">
        <label className="nc-set-label">{t('lp.settings.starting', 'Starting')}<div className="nc-set-input"><input type="date" value={from} min={iso(floor)} onChange={(e) => setFrom(e.target.value)} /></div></label>
        <label className="nc-set-label">{t('lp.settings.ending', 'Ending')}<div className="nc-set-input"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></label>
      </div>
      {f < floor && <div className="error">{t('lp.settings.the_audit_log_keeps_one_year', 'The audit log keeps one year of events.')}</div>}
      <div className="actions">
        <Button variant="primary" disabled={bad} onClick={() => { onApply(Math.max(f, floor), tt); close(); }}>{t('lp.settings.apply', 'Apply')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

function EventFilterBody({ close, selected, onApply }: { close: () => void; selected: string[]; onApply: (events: string[]) => void }) {
  const [sel, setSel] = useState(new Set(selected));
  const [q, setQ] = useState('');
  const cats = auditEventCatalog();
  const total = cats.reduce((n, c) => n + c.events.length, 0);
  const toggle = (ids: string[], on: boolean) => setSel((s) => {
    const n = new Set(s);
    for (const id of ids) (on ? n.add(id) : n.delete(id));
    return n;
  });
  return (
    <div className="nc-set-eventfilter">
      <h3>{t('lp.settings.event', 'Event')}</h3>
      <div className="nc-set-input"><input autoFocus placeholder={t('lp.settings.search_here', 'Search here...')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="list">
        {cats.map((c) => {
          const evs = c.events.filter(([, label]) => !q || label.toLowerCase().includes(q.toLowerCase()));
          if (!evs.length) return null;
          const all = evs.every(([id]) => sel.has(id));
          return (
            <div key={c.category} className="cat">
              <label className="cat-head"><input type="checkbox" checked={all} onChange={(e) => toggle(evs.map(([id]) => id), e.target.checked)} />{categoryLabel(c.category as AuditCategory)}<span className="n">{evs.length}</span></label>
              {evs.map(([id, label]) => (
                <label key={id} className="ev"><input type="checkbox" checked={sel.has(id)} onChange={(e) => toggle([id], e.target.checked)} />{label}</label>
              ))}
            </div>
          );
        })}
      </div>
      <div className="nc-set-muted small">{sel.size ? t('lp.settings.of_selected', '{totalNumSelected} of {totalNumEvents} selected', { totalNumSelected: sel.size, totalNumEvents: total }) : t('lp.settings.events', '({totalNum} events)', { totalNum: total })}</div>
      <div className="actions">
        <Button variant="primary" onClick={() => { onApply([...sel]); close(); }}>{t('lp.settings.apply', 'Apply')}</Button>
        <Button onClick={() => setSel(new Set())}>{t('lp.settings.clear', 'Clear')}</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Content search

interface ContentRow {
  pageId: string; title: string; icon: string; type: string;
  location: { kind: string; label: string; teamId?: string; ownerId?: string };
  audience: string; createdBy: string; createdTime: number; lastEditedBy: string; lastEditedTime: number; inTrash: boolean; people: number;
  /** Retained pages (deleted from Trash, kept for Settings › Security › Data retention): restored by retainedId */
  retained?: boolean; retainedId?: string; retainedUntil?: number;
}

function audienceLabel(a: string): string {
  switch (a) {
    case 'shared_to_web': return t('lp.settings.published_on_the_web', 'Published on the web');
    case 'shared_externally': return t('lp.settings.shared_externally_e5c9', 'Shared externally');
    case 'shared_to_workspace': return t('lp.settings.shared_with_the_workspace', 'Shared with the workspace');
    case 'shared_internally': return t('lp.settings.shared_internally_11b3', 'Shared internally');
    default: return t('lp.settings.private', 'Private');
  }
}

const AUDIENCES = ['private', 'shared_internally', 'shared_to_workspace', 'shared_externally', 'shared_to_web'] as const;

export function ContentSearchSection() {
  const { space, plan } = useSpaceAccess();
  const prefs = usePrefs();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'active' | 'trash' | 'retained' | 'all'>('active');
  const [audience, setAudience] = useState<string[]>([]);
  const [createdBy, setCreatedBy] = useState<string[]>([]);
  const [sharedWithAgent, setSharedWithAgent] = useState<string | null>(null);
  const [rows, setRows] = useState<ContentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState('');
  const [nonce, setNonce] = useState(0);
  useTableVersion(['lit_user']);
  const enterprise = plan === 'enterprise';
  const acknowledged = !!prefs.content_search_ack;

  useEffect(() => {
    if (!space?.id || !enterprise || !acknowledged) return;
    let off = false;
    setRows(null);
    setErr('');
    api<any>('searchContentAsAdmin', { spaceId: space.id, query, status, audience, createdBy, sharedWithAgent: sharedWithAgent ?? undefined, limit: 200 })
      .then((r) => { if (off) return; records.mergeRecordMap(r.recordMap); setRows(r.rows); setTotal(r.total); })
      .catch((e) => { if (!off) setErr((e as Error).message); });
    return () => { off = true; };
  }, [space?.id, enterprise, acknowledged, query, status, audience, createdBy, sharedWithAgent, nonce]);

  if (!space) return null;
  const header = <SectionPage wide title={t('lp.settings.content_search', 'Content search')} subtitle={t('lp.settings.search_across_your_workspace', 'Search across your workspace')} />;
  if (!enterprise) {
    return (
      <div className="nc-set-column wide">
        {header}
        <EnterpriseUpsell title={t('lp.settings.find_any_page_in_your_workspace', 'Find any page in your workspace')} description={t('lp.settings.upgrade_to_the_enterprise_plan_to_0dd0', 'Upgrade to the Enterprise plan to search every page in the workspace — including private pages and pages in Trash — and manage their access.')} />
      </div>
    );
  }
  if (!acknowledged) {
    return (
      <div className="nc-set-column wide">
        {header}
        <div className="nc-set-ent-upsell plain" data-testid="content-search-ack">
          <div className="ttl">{t('lp.settings.before_you_use_this_feature', 'Before you use this feature')}</div>
          <div className="desc">{t('lp.settings.workspace_owners_can_use_content_search', 'Workspace owners can use content search to find pages they can’t access, including other members’ private pages.')}</div>
          <div className="desc">{t('lp.settings.ask_your_company_s_legal_team', 'Ask your company’s legal team for guidance on using this feature. Anything done here shows up in the audit log.')}</div>
          <div className="actions">
            <Button variant="primary" onClick={() => savePref('content_search_ack', true)}>{t('lp.settings.acknowledge', 'Acknowledge')}</Button>
            {HELP_URL && <Button onClick={() => window.open(HELP_URL!, '_blank', 'noopener')}>{t('lp.settings.learn_more', 'Learn more')}</Button>}
          </div>
        </div>
      </div>
    );
  }
  const members = (space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
  const audienceMenu = (anchor: HTMLElement) => openMenu(anchor, {
    width: 300,
    sections: [{
      title: t('lp.settings.audience', 'Audience'),
      items: AUDIENCES.map((a) => ({
        label: audienceLabel(a),
        description: ({
          private: t('lp.settings.pages_accessible_to_only_one_workspace', 'Pages accessible to only one workspace member.'),
          shared_internally: t('lp.settings.pages_other_people_in_the_workspace', 'Pages other people in the workspace can access.'),
          shared_to_workspace: t('lp.settings.pages_the_whole_workspace_can_open', 'Pages the whole workspace can open, whether shared directly or inherited from a parent. Link-only access doesn’t count.'),
          shared_externally: t('lp.settings.pages_guests_or_connections_can_access', 'Pages guests or connections can access.'),
          shared_to_web: t('lp.settings.pages_anyone_can_view_on_the', 'Pages anyone can view on the web.'),
        } as Record<string, string>)[a],
        checked: audience.includes(a),
        onSelect: () => { setAudience((l) => (l.includes(a) ? l.filter((x) => x !== a) : [...l, a])); },
      })),
    }],
  }, { placement: 'bottom-start' });
  const statusMenu = (anchor: HTMLElement) => openMenu(anchor, {
    width: 300,
    sections: [{
      title: t('lp.settings.page_status', 'Page status'),
      items: [
        { label: t('lp.settings.active_pages', 'Active pages'), checked: status === 'active', onSelect: () => setStatus('active') },
        { label: t('lp.settings.in_trash', 'In Trash'), description: t('lp.settings.after_a_page_stays_in_trash', 'After a page stays in Trash for {duration}, it’s deleted automatically', { duration: retentionDurationLabel(trashRetentionDays(space)) }), checked: status === 'trash', onSelect: () => setStatus('trash') },
        { label: t('lp.settings.retained_pages', 'Retained pages'), description: t('lp.settings.deleted_pages_remain_for_after_leaving', 'Deleted pages remain for {duration} after leaving Trash', { duration: retentionDurationLabel(purgeRetentionDays(space)) }), checked: status === 'retained', onSelect: () => setStatus('retained') },
        { label: t('lp.settings.all_pages', 'All pages'), checked: status === 'all', onSelect: () => setStatus('all') },
      ],
    }],
  }, { placement: 'bottom-start' });
  const creatorMenu = (anchor: HTMLElement) => openMenu(anchor, {
    width: 300,
    maxHeight: 360,
    search: t('lp.settings.search_for_people', 'Search for people…'),
    sections: [{
      items: members.map((id) => ({
        label: displayName(id), text: `${displayName(id)} ${userOf(id)?.email ?? ''}`, icon: <UserAvatar user={userOf(id)} size={20} />,
        description: t('lp.settings.member_6853', 'Member'),
        checked: createdBy.includes(id),
        onSelect: () => { setCreatedBy((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id])); },
      })),
    }],
  }, { placement: 'bottom-start' });
  const statusPill = status === 'active'
    ? t('lp.settings.active_pages', 'Active pages')
    : status === 'trash' || status === 'retained'
      ? t('lp.settings.trashselected_select_true_other_only', '{trashSelected, select, true {Trash items} other {Kept pages}} only', { trashSelected: status === 'trash' ? 'true' : 'false' })
      : t('lp.settings.all_pages', 'All pages');
  const exportCsv = async () => {
    try {
      const r = await api<{ url: string; filename: string }>('adminContentSearchExport', { spaceId: space.id, query, status, audience, createdBy, sharedWithAgent: sharedWithAgent ?? undefined });
      download(r.url, r.filename);
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <div className="nc-set-column wide nc-set-csearch">
      {header}
      <div className="nc-set-row-desc">
        {rich(msg('lp.settings.search_every_page_in_including_private', 'Search every page in <b>{workspaceName}</b>, including private and retained pages. Filter by sharing settings such as public or externally shared pages.'), { workspaceName: space.name }, { b: (c) => <strong>{c}</strong> })}
      </div>
      <form className="nc-set-toolbar" onSubmit={(e) => { e.preventDefault(); setQuery(input.trim()); }}>
        <div className="nc-set-input nc-set-search-inline" style={{ flex: 1 }}>
          <Icon name="magnifyingGlassSmall" size={16} />
          <input aria-label={t('lp.settings.look_up_pages_by_title_content', 'Look up pages by title, content, or ID')} placeholder={t('lp.settings.look_up_pages_by_title_content', 'Look up pages by title, content, or ID')} value={input} onChange={(e) => setInput(e.target.value)} />
        </div>
        <button type="submit" className="nc-set-btn primary">{t('lp.settings.search', 'Search')}</button>
      </form>
      <div className="nc-set-toolbar wrap">
        <div role="button" tabIndex={0} data-filter="status" className={`nc-set-fpill ${status !== 'active' ? 'active' : ''}`} onClick={(e) => statusMenu(e.currentTarget)}>{statusPill}<Icon name="arrowChevronSingleDownSmall" size={12} /></div>
        <div role="button" tabIndex={0} data-filter="audience" className={`nc-set-fpill ${audience.length ? 'active' : ''}`} onClick={(e) => audienceMenu(e.currentTarget)}>
          {audience.length ? <><b>{t('lp.settings.audience', 'Audience')}</b>: {audience.map(audienceLabel).join(', ')}</> : t('lp.settings.audience', 'Audience')}
          <Icon name="arrowChevronSingleDownSmall" size={12} />
        </div>
        <div role="button" tabIndex={0} data-filter="created-by" className={`nc-set-fpill ${createdBy.length ? 'active' : ''}`} onClick={(e) => creatorMenu(e.currentTarget)}>
          {createdBy.length ? <><b>{t('lp.settings.created_by_5d73', 'Created by')}</b>: {createdBy.map(displayName).join(', ')}</> : t('lp.settings.created_by_5d73', 'Created by')}
          <Icon name="arrowChevronSingleDownSmall" size={12} />
        </div>
        <SharedWithAgentFilter spaceId={space.id} value={sharedWithAgent} onChange={setSharedWithAgent} onRefresh={() => setNonce((n) => n + 1)} />
        <div style={{ flex: 1 }} />
        <span data-tooltip={rows && rows.length ? undefined : t('lp.settings.nothing_to_export', 'Nothing to export')}>
          <Button icon="download" disabled={!rows?.length} onClick={() => void exportCsv()}>{t('lp.settings.export_to_csv', 'Download CSV')}</Button>
        </span>
      </div>
      {err && (
        <div className="nc-set-empty">
          {t('lp.settings.an_error_occurred', 'An error occurred')}
          <div className="nc-set-muted">{err}</div>
          <Button onClick={() => setNonce((n) => n + 1)}>{t('lp.settings.retry', 'Retry')}</Button>
        </div>
      )}
      {!err && rows === null && <div className="nc-set-empty">{t('lp.settings.loading', 'Loading…')}</div>}
      {!err && rows && !rows.length && <div className="nc-set-empty">{t('lp.settings.no_pages_match_your_search', 'No pages match your search.')}</div>}
      {!err && rows && rows.length > 0 && (
        <>
          <table className="nc-set-table nc-set-atable nc-set-cs-table">
            <thead>
              <tr>
                <th style={{ width: '28%' }}>{t('lp.settings.page', 'Page')}</th>
                <th>{t('lp.settings.location', 'Location')}</th>
                <th>{t('lp.settings.audience', 'Audience')}</th>
                <th>{t('lp.settings.shared_with', 'Shared with')}</th>
                <th>{t('lp.settings.created_by_5d73', 'Created by')}</th>
                <th>{t('lp.settings.last_edit_on', 'Last edit on')}</th>
                <th>{t('lp.settings.page_status', 'Page status')}</th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.retainedId ?? r.pageId} data-page-id={r.pageId}>
                  <td className="primary"><span className="nc-set-user"><span className="nc-set-cs-icon">{r.icon && !/^(https?:|\/files\/)/.test(r.icon) ? r.icon : <Icon name="page" size={16} />}</span><span className="nc-ellipsis">{r.title || t('lp.settings.untitled', 'Untitled')}</span></span></td>
                  <td><span className="nc-ellipsis" title={r.location.label}>{r.location.kind === 'private' ? t('lp.settings.private', 'Private') : r.location.label}</span></td>
                  <td>{audienceLabel(r.audience)}</td>
                  <td>{r.people ? t('lp.settings.nummembers_plural_one_other', '{numMembers, plural, one {# workspace member} other {# workspace members}}', { numMembers: r.people }) : r.audience === 'shared_to_workspace' ? t('lp.settings.workspace_members', 'Workspace members') : <span data-tooltip={t('lp.settings.this_page_isn_t_shared_with', 'This page isn’t shared with any person, group, or team.')}>{t('lp.settings.nobody', 'Nobody')}</span>}</td>
                  <td><span className="nc-set-user"><UserAvatar user={userOf(r.createdBy)} size={18} /><span className="nc-ellipsis">{displayName(r.createdBy)}</span></span></td>
                  <td><span data-tooltip={r.retained
                    ? (r.lastEditedBy ? t('lp.settings.removed_it_from_trash_on', '{name} removed it from Trash on {time}', { name: displayName(r.lastEditedBy), time: fmtDateTime(r.lastEditedTime) }) : t('lp.settings.removed_from_trash_automatically_on', 'Removed from Trash automatically on {time}', { time: fmtDateTime(r.lastEditedTime) }))
                    : t('lp.settings.last_changed_by_on', 'Last changed by {name} on {time}', { name: displayName(r.lastEditedBy), time: fmtDateTime(r.lastEditedTime) })}>{fmtDay(r.lastEditedTime)}</span></td>
                  <td>{r.retained
                    ? <span className="nc-set-badge gray" data-tooltip={r.retainedUntil ? `${t('lp.settings.retained_until', 'Retained until')} ${fmtDay(r.retainedUntil)}` : undefined}>{t('lp.settings.retained', 'Retained')}</span>
                    : r.inTrash ? <span className="nc-set-badge yellow">{t('lp.settings.in_trash', 'In Trash')}</span> : t('lp.settings.active', 'Active')}</td>
                  <td><span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.more_actions', 'More actions')} onClick={(e) => contentRowMenu(e.currentTarget, r, space.id, () => setNonce((n) => n + 1))}><Icon name="ellipsisSmall" size={16} /></span></td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > rows.length && <div className="nc-set-muted small">{t('lp.settings.showing_of_pages_refine_your_search', 'Showing {shown} of {total} pages. Refine your search to see more.', { shown: rows.length, total })}</div>}
        </>
      )}
    </div>
  );
}

function contentRowMenu(anchor: HTMLElement, r: ContentRow, spaceId: string, refresh: () => void) {
  const act = async (name: string, body: Record<string, unknown>, done?: string) => {
    try {
      await api(name, { spaceId, pageId: r.pageId, ...body });
      if (done) useUI.getState().toast(done);
      refresh();
    } catch (e) {
      toastError(e);
    }
  };
  // a retained page isn't a page in the workspace until it is restored: only the restore actions apply
  const items: MenuItemDef[] = r.retained ? [] : [
    { label: t('lp.settings.copy_page_link', 'Copy page link'), icon: 'link', onSelect: () => { void navigator.clipboard?.writeText(location.origin + pageUrl(r.pageId)); useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete')); } },
    { label: t('lp.settings.open_in_a_new_tab', 'Open in a new tab'), icon: 'arrowDiagonalUpRightSmall', onSelect: () => { window.open(pageUrl(r.pageId), '_blank', 'noopener'); } },
    { label: t('lp.settings.change_permissions', 'Change permissions'), icon: 'people', onSelect: () => { openSubDialog((close) => <PermissionsBody close={close} spaceId={spaceId} pageId={r.pageId} onChanged={refresh} />); } },
  ];
  // pages in Trash and retained pages (deleted from Trash) come back to where they were, or to my Private pages
  const restore = (to: 'original' | 'private', done: string) => (r.retained
    ? act('adminRestoreRetained', { retainedId: r.retainedId, to }, done)
    : act('adminRestorePage', { to }, done));
  const trash: MenuItemDef[] = r.inTrash || r.retained ? [
    { label: t('lp.settings.put_back_where_it_was', 'Put back where it was'), icon: 'arrowTurnUpLeft', onSelect: () => void restore('original', t('lp.settings.page_restored', 'Page restored')) },
  ] : [];
  const more: MenuItemDef[] = [
    ...((r.inTrash || r.retained) && r.type === 'page' && r.location.kind !== 'database' ? [{ label: t('lp.settings.put_back_in_private_pages', 'Put back in Private pages'), icon: 'lock', onSelect: () => void restore('private', t('lp.settings.moved_to_your_private_pages', 'Moved to your Private pages')) }] : []),
    ...(r.inTrash ? [{
      label: t('lp.settings.remove_from_trash', 'Remove from Trash'), icon: 'trashSmall', danger: true,
      onSelect: () => {
        void confirmDialog({ title: t('lp.settings.permanently_delete_this_page', 'Permanently delete this page?'), description: t('lp.settings.you_can_t_view_or_restore', 'You can’t view or restore it.'), confirmLabel: t('lp.settings.permanently_delete', 'Permanently delete'), danger: true })
          .then((ok) => { if (ok) void act('adminDeletePagePermanently', {}, t('lp.settings.page_deleted_permanently', 'Page deleted permanently')); });
      },
    }] : []),
  ];
  openMenu(anchor, { width: 260, sections: [...(items.length ? [{ items }] : []), ...(trash.length ? [{ items: trash }] : []), ...(more.length ? [{ items: more }] : [])] }, { placement: 'bottom-end' });
}

function roleName(r: string): string {
  switch (r) {
    case 'editor': return t('lp.settings.full_access', 'Full access');
    case 'read_and_write': return t('lp.settings.can_edit', 'Can edit');
    case 'comment_only': return t('lp.settings.can_comment', 'Can comment');
    case 'reader': return t('lp.settings.can_view', 'Can view');
    default: return t('lp.settings.none', 'None');
  }
}

/** Change permissions: the page's own sharing entries, each revocable with administrator privileges. */
function PermissionsBody({ close, spaceId, pageId, onChanged }: { close: () => void; spaceId: string; pageId: string; onChanged: () => void }) {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  const load = () => api<any>('adminGetPagePermissions', { spaceId, pageId }).then((r) => { records.mergeRecordMap(r.recordMap); setData(r); }).catch((e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const remove = async (index: number) => {
    try {
      await api('adminRemovePagePermission', { spaceId, pageId, index });
      onChanged();
      void load();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const who = (e: any) => {
    if (e.type === 'public_permission') return e.published ? t('lp.settings.shared_on_the_web', 'Shared on the web') : t('lp.settings.anyone_who_has_the_link', 'Anyone who has the link');
    if (e.type === 'space_permission') return t('lp.settings.workspace_members', 'Workspace members');
    return `${displayName(e.userId)}${e.guest ? ` · ${t('lp.settings.guest_face', 'Guest')}` : ''}`;
  };
  return (
    <div className="nc-set-perms">
      <h3>{t('lp.settings.change_permissions', 'Change permissions')}</h3>
      {data && <div className="desc">{data.title || t('lp.settings.untitled', 'Untitled')} · {audienceLabel(data.audience)}</div>}
      {err && <div className="error">{err}</div>}
      {!data && !err && <div className="desc">{t('lp.settings.loading', 'Loading…')}</div>}
      {data && (
        <div className="list">
          {!data.entries.length && <div className="desc">{t('lp.settings.this_page_inherits_its_permissions_from', 'This page inherits its permissions from its parent.')}</div>}
          {data.entries.map((e: any) => (
            <div key={e.index} className="row">
              {e.userId ? <UserAvatar user={userOf(e.userId)} size={22} /> : <Icon name={e.type === 'public_permission' ? 'globe' : 'people'} size={18} />}
              <span className="who nc-ellipsis">{who(e)}</span>
              <span className="role">{roleName(e.role)}</span>
              <Button small variant="ghost" onClick={() => void remove(e.index)}>{t('lp.settings.remove', 'Remove')}</Button>
            </div>
          ))}
        </div>
      )}
      <div className="actions">
        <Button onClick={close}>{t('lp.settings.close', 'Close')}</Button>
      </div>
    </div>
  );
}

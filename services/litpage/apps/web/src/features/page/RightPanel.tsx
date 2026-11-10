import { HELP_URL } from '@nc/shared/brand.ts';
// Right-side page panel (div.lit-update-sidebar, 385px, full height): "All discussions" (topbar 💬 →
// See all) and Updates & analytics. The panel is a sibling of the frame: the frame shrinks, and the page's
// topbar actions (translate, Share, comments, favorite, •••) move into the panel header next to the »
// collapse button.
// Version history opens as a full-screen modal (VersionHistory.tsx); the legacy 'history' id maps to it.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BlockRecord, UserRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useSession } from '../../lib/store/session.ts';
import { useLocation } from '../../lib/router.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { run } from '../../lib/blocks.ts';
import { formatDateTime } from '../../lib/format.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { useBlock, useCurrentSpaceView, useRecord } from '../../lib/hooks.ts';
import { CommentsSidebar, focusDiscussion, RichTextView, TopbarCommentsButton } from '../comments/comments.tsx';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { TopbarFacepile } from '../presence/Facepile.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';
import { openVersionHistory } from './VersionHistory.tsx';
import { ShareButton } from './ShareMenu.tsx';
import { TranslatePill } from './TranslatePill.tsx';
import { openPageMenu } from './PageMenu.tsx';
import { pageTitle, toggleFavorite } from './pageActions.ts';
import './panels.css';

const PANEL_W = 385;
const PANEL_W_KEY = 'nc:rightPanelWidth';

function readWidth(): number {
  try {
    return Number(localStorage.getItem(PANEL_W_KEY)) || PANEL_W;
  } catch {
    return PANEL_W;
  }
}

/** "Resize with the arrow keys": 12px hit area on the panel's left edge, full height. */
function PanelResizer({ width, setWidth }: { width: number; setWidth: (w: number) => void }) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize with the arrow keys"
      tabIndex={0}
      className="nc-right-panel-resizer"
      onPointerDown={(e) => {
        e.preventDefault();
        const move = (ev: PointerEvent) => setWidth(window.innerWidth - ev.clientX);
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => setWidth(PANEL_W)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          setWidth(width + (e.key === 'ArrowLeft' ? 16 : -16));
        } else if (e.key === 'Home') {
          e.preventDefault();
          setWidth(PANEL_W);
        }
      }}
    />
  );
}

export function RightPanel() {
  const panel = useUI((s) => s.rightPanel);
  const [width, setWidthState] = useState(readWidth);
  const setWidth = (w: number) => {
    const next = Math.round(Math.max(320, Math.min(w, Math.max(320, window.innerWidth - 480))));
    setWidthState(next);
    try {
      localStorage.setItem(PANEL_W_KEY, String(next));
    } catch {
      /* storage unavailable */
    }
  };
  const { route, peek } = useLocation();
  const pageId = peek?.pageId ?? (route.name === 'page' ? route.pageId : null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    setHost(document.querySelector<HTMLElement>('.lit-cursor-listener'));
  }, []);
  useEffect(() => {
    if (panel === 'history' && pageId) {
      useUI.getState().set({ rightPanel: null });
      openVersionHistory(pageId);
    }
  }, [panel, pageId]);
  // (Esc does not close the docked panel: it stays until » "Close panel")
  if (!pageId || panel === 'history' || panel === 'ai' || !panel) return null;
  const close = () => useUI.getState().set({ rightPanel: null });
  const body = (
    <aside
      className="nc-right-panel lit-update-sidebar"
      role="complementary"
      aria-label={panel === 'comments' ? t('lp.page.page_comments', 'Page comments') : t('lp.page.analytics_and_page_activity', 'Analytics and page activity')}
      style={width !== PANEL_W ? { width, flexBasis: width } : undefined}
    >
      <PanelResizer width={width} setWidth={setWidth} />
      <PanelTopbar pageId={pageId} close={close} />
      {panel === 'comments' ? (
        <div className="lit-scroller vertical nc-right-panel-body flush">
          <CommentsSidebar pageId={pageId} />
        </div>
      ) : (
        <UpdatesAndAnalytics pageId={pageId} />
      )}
    </aside>
  );
  return host ? createPortal(body, host) : body;
}

/** Panel header: » (close) + the page's topbar actions. */
function PanelTopbar({ pageId, close }: { pageId: string; close: () => void }) {
  const sv = useCurrentSpaceView();
  const moreRef = useRef<HTMLDivElement>(null);
  const fav = !!sv?.bookmarked_pages?.includes(pageId);
  return (
    <header className="nc-right-panel-topbar">
      <div role="button" className="nc-topbar-icon-btn nc-right-panel-close" aria-label={t('lp.page.close_panel', 'Close panel')} data-tooltip={t('lp.page.close_panel', 'Close panel')} onClick={close}>
        <Icon name="arrowChevronDoubleRight" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
      </div>
      <div className="actions">
        <TranslatePill pageId={pageId} compact />
        <TopbarFacepile pageId={pageId} />
        <ShareButton pageId={pageId} />
        <TopbarCommentsButton pageId={pageId} />
        <div role="button" aria-label="Favorite" className="nc-topbar-icon-btn lit-topbar-favorite-button" data-tooltip={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(pageId)}>
          <Icon name="star" size={18} style={{ color: fav ? '#78350f' : 'var(--lp-icon-primary)', fill: fav ? '#78350f' : 'none' }} />
        </div>
        <div ref={moreRef} role="button" aria-label="Actions" className="nc-topbar-icon-btn lit-topbar-more-button" data-tooltip="Style, export, and more…" onClick={() => moreRef.current && openPageMenu(pageId, moreRef.current)}>
          <Icon name="ellipsis" size={22} style={{ color: 'var(--lp-icon-primary)' }} />
        </div>
      </div>
    </header>
  );
}

const TAB_KEY = 'nc:updatesPanelTab';

/** Last tab picked in Updates & analytics, remembered on this device. */
function readTab(): 'updates' | 'analytics' {
  try {
    return localStorage.getItem(TAB_KEY) === 'analytics' ? 'analytics' : 'updates';
  } catch {
    return 'updates';
  }
}

function UpdatesAndAnalytics({ pageId }: { pageId: string }) {
  const [tab, setTabState] = useState<'updates' | 'analytics'>(readTab);
  const setTab = (k: 'updates' | 'analytics') => {
    setTabState(k);
    try {
      localStorage.setItem(TAB_KEY, k);
    } catch {
      /* storage unavailable */
    }
  };
  return (
    <>
      <div className="nc-panel-tabs" role="tablist">
        {(['updates', 'analytics'] as const).map((k) => (
          <div key={k} role="tab" aria-selected={tab === k} className={`nc-panel-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>
            {k === 'updates' ? t('lp.page.updates', 'Updates') : t('lp.page.analytics', 'Analytics')}
          </div>
        ))}
      </div>
      <div className="lit-scroller vertical nc-right-panel-body">
        {tab === 'updates' ? <Updates pageId={pageId} /> : <Analytics pageId={pageId} />}
      </div>
      {tab === 'analytics' && (
        <div className="nc-panel-footer">
          {HELP_URL && <a className="nc-panel-learn" href={HELP_URL} target="_blank" rel="noreferrer">
            <Icon name="help" size={16} />
            <span>{t('lp.page.learn_more', 'Learn more')}</span>
          </a>}
        </div>
      )}
    </>
  );
}

/** "14 seconds ago", "7 minutes ago", "1 hour ago", "3 days ago", then the date. */
export function longAgo(ms: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  if (s < 5) return 'Just now';
  if (s < 60) return plural(s, 'second');
  const m = Math.floor(s / 60);
  if (m < 60) return plural(m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return plural(h, 'hour');
  const d = Math.floor(h / 24);
  if (d < 30) return plural(d, 'day');
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------------------------
// Updates

interface BlockChange { id: string; type: string; title: RichText; status: 'added' | 'edited' | 'removed'; before?: RichText }
interface UpdateItem {
  id: string;
  kind: 'created' | 'edited' | 'commented' | 'replied';
  userId: string;
  time: number;
  snapshotId?: string | null;
  props?: { key: 'title' | 'icon' | 'cover'; before: unknown; after: unknown }[];
  changes?: BlockChange[];
  moreChanges?: number;
  blocks?: { id: string; type: string; text: string; alive: boolean }[];
  touchedTitle?: boolean;
  discussionId?: string;
  context?: string;
  text?: string;
  resolved?: boolean;
}

function Updates({ pageId }: { pageId: string }) {
  const [items, setItems] = useState<UpdateItem[] | null>(null);
  const page = useBlock(pageId);
  const version = page?.last_edited_time;
  useEffect(() => {
    let alive = true;
    const load = () => void api('getPageUpdates', { pageId }).then((r) => {
      if (!alive) return;
      records.mergeRecordMap(r.recordMap);
      setItems(r.items);
    }).catch(() => alive && setItems([]));
    const timer = setTimeout(load, items ? 1200 : 0); // let the edit land in a version first
    return () => { alive = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, version]);
  if (!items) return <div className="nc-panel-empty" />;
  if (!items.length) {
    return (
      <div className="nc-panel-empty">
        <div className="title">{t('lp.page.no_recent_updates', 'No recent updates')}</div>
        <div className="sub">{t('lp.page.you_ll_see_every_edit_to', 'You’ll see every edit to this page here.')}</div>
      </div>
    );
  }
  return (
    <div className="nc-updates">
      {items.map((it) => <UpdateCard key={it.id} pageId={pageId} item={it} />)}
    </div>
  );
}

function UpdateCard({ pageId, item: it }: { pageId: string; item: UpdateItem }) {
  const me = useSession((s) => s.userId);
  const u = useRecord<UserRecord>('lit_user', it.userId);
  const page = useBlock(pageId);
  const who = it.userId === me ? 'You' : userName(u);
  const verb = it.kind === 'created' ? 'created' : it.kind === 'edited' ? 'edited' : it.kind === 'commented' ? 'commented in' : 'replied in';
  const comment = it.kind === 'commented' || it.kind === 'replied';
  return (
    <div className={`nc-update ${comment ? 'clickable' : ''}`} onClick={() => comment && it.discussionId && focusDiscussion(it.discussionId, true)}>
      <UserAvatar userId={it.userId} size={24} style={{ marginTop: 2 }} />
      <div className="main">
        <div className="line1">
          <span>{who} {verb}</span>
          <span className="page"><PageIcon block={page} size={18} /><b className="nc-ellipsis">{pageTitle(page)}</b></span>
        </div>
        <div className="when" title={formatDateTime(it.time)}>{longAgo(it.time)}</div>
        {!comment && <UpdateDiff pageId={pageId} item={it} />}
        {comment && (
          <div className="nc-update-comment">
            {it.context && (
              <div className="ctx"><div className="bar" /><div className="nc-ellipsis">{it.context}</div></div>
            )}
            <div className="txt">{it.text}</div>
            {it.resolved && <div className="resolved">{t('lp.page.resolved', 'Resolved')}</div>}
          </div>
        )}
      </div>
      {!comment && (
        <div role="button" className="nc-icon-btn small history" aria-label={t('lp.page.view_in_version_history', 'View in version history')} data-tooltip={t('lp.page.view_in_version_history', 'View in version history')}
          onClick={(e) => { e.stopPropagation(); openVersionHistory(pageId, { snapshotId: it.snapshotId }); }}>
          <Icon name="clock" size={16} />
        </div>
      )}
    </div>
  );
}

const PROP_LABEL: Record<string, [string, string]> = {
  title: ['Title', 'text'],
  icon: ['Page icon', 'emojiFace'],
  cover: ['Cover', 'image'],
};

function iconValue(v: unknown): ReactNode {
  if (!v || typeof v !== 'string') return <PageIcon size={20} />;
  return <PageIcon icon={v} size={20} />;
}

function UpdateDiff({ pageId, item: it }: { pageId: string; item: UpdateItem }) {
  const props = it.props ?? [];
  const changes = it.changes ?? [];
  if (!props.length && !changes.length) {
    // older rows without a version diff: plain previews of the touched blocks
    if (!it.blocks?.length) return null;
    return (
      <div className="nc-update-diff">
        {it.blocks.map((b) => <div key={b.id} className={`nc-update-block ${b.alive ? 'added' : 'removed'}`}>{b.text}</div>)}
      </div>
    );
  }
  return (
    <div className="nc-update-diff">
      {props.map((p) => (
        <div key={p.key} className="nc-update-prop">
          <div className="label"><Icon name={PROP_LABEL[p.key][1]} size={16} /><span>{PROP_LABEL[p.key][0]}</span></div>
          <div className="change">
            {p.key === 'icon' ? (
              <>{iconValue(p.before)}<Icon name="chevronRight" size={14} style={{ color: 'var(--lp-icon-tertiary)' }} />{iconValue(p.after)}</>
            ) : p.key === 'cover' ? (
              <>{p.before ? <img className="cover" src={String(p.before)} alt="" /> : <span className="none">Empty</span>}<Icon name="chevronRight" size={14} style={{ color: 'var(--lp-icon-tertiary)' }} />{p.after ? <img className="cover" src={String(p.after)} alt="" /> : <span className="none">Empty</span>}</>
            ) : (
              <><span className="removed-text">{String(p.before || 'Untitled')}</span><Icon name="chevronRight" size={14} style={{ color: 'var(--lp-icon-tertiary)' }} /><span className="added-text">{String(p.after || 'Untitled')}</span></>
            )}
          </div>
        </div>
      ))}
      {changes.map((c) => <ChangedBlock key={c.id} change={c} />)}
      {(it.moreChanges ?? 0) > 0 && (
        <div role="button" className="nc-update-more" onClick={(e) => { e.stopPropagation(); openVersionHistory(pageId, { snapshotId: it.snapshotId }); }}>
          {t('lp.page.view_more', 'View {count} more', { count: it.moreChanges })}
        </div>
      )}
    </div>
  );
}

function ChangedBlock({ change: c }: { change: BlockChange }) {
  const linked = c.type === 'page' || c.type === 'collection_view_page' ? records.get<BlockRecord>('block', c.id) : undefined;
  const prefix =
    c.type === 'bulleted_list' ? <span className="bullet">•</span>
      : c.type === 'numbered_list' ? <span className="bullet">1.</span>
        : c.type === 'to_do' ? <Icon name="checkbox" size={14} />
          : c.type === 'page' || c.type === 'collection_view_page' ? <PageIcon block={linked} size={18} />
            : null;
  return (
    <div className={`nc-update-block ${c.status} type-${c.type}`}>
      {prefix}
      {c.type === 'divider' ? <hr /> : <RichTextView value={c.title} className="text" />}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Analytics

interface AnalyticsData {
  days: { date: number; total: number; unique: number }[];
  totalViews: number;
  uniqueViews: number;
  viewers: { userId: string; lastViewed: number; views: number }[];
  editors: { userId: string; lastEdited: number }[];
  createdBy: string;
  createdTime: number;
  showViewHistory?: boolean;
  /** Settings › General › "Save and display page view analytics" is off for the workspace */
  analyticsDisabled?: boolean;
}

const RANGES: [number, string][] = [[7, 'Last 7 Days'], [28, 'Last 28 Days'], [90, 'Last 90 Days']];

function Analytics({ pageId }: { pageId: string }) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [span, setSpan] = useState(28);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let alive = true;
    void api('getPageStats', { pageId, days: span }).then((r) => {
      if (!alive) return;
      records.mergeRecordMap(r.recordMap);
      setData(r);
    }).catch(() => alive && setData(null));
    return () => { alive = false; };
  }, [pageId, span, nonce]);
  if (!data) return <div className="nc-panel-empty" />;
  const me = useSession.getState().userId;
  const rangeLabel = RANGES.find(([d]) => d === span)?.[1] ?? `Last ${span} Days`;
  // "Page editors can see your view history for this page": a per-page choice; Settings › Preferences ›
  // "Show my view history" stays the default for every other page
  const setHistory = (allow: boolean) => {
    const settings = records.get<any>('user_settings', me);
    if (!settings || !me) return;
    const pages = { ...((settings.settings?.page_view_history_pages ?? {}) as Record<string, string>), [pageId]: allow ? 'allow' : 'deny' };
    run('Analytics.viewHistory', (tx) => tx.update('user_settings', me, ['settings'], { page_view_history_pages: pages }));
    setTimeout(() => setNonce((n) => n + 1), 400);
  };
  if (data.analyticsDisabled) {
    const spaceName = records.get<any>('space', records.get<any>('block', pageId)?.space_id)?.name as string | undefined;
    return (
      <div className="nc-analytics">
        <div className="nc-panel-empty small" data-testid="analytics-disabled">
          <div className="title">{t('lp.page.page_views_aren_t_being_tracked', 'Page views aren’t being tracked')}</div>
          <div className="sub">
            {spaceName ? t('lp.page.page_views_and_analytics_are_off', 'Page views and analytics are off for every page in {name}', { name: spaceName }) : t('lp.page.page_views_and_analytics_are_off_5158', 'Page views and analytics are off for every page in your space')}{' '}
            {HELP_URL && (<a href={HELP_URL} target="_blank" rel="noreferrer">{t('lp.page.learn_more', 'Learn more')}</a>)}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="nc-analytics">
      <div className="nc-analytics-head">
        <div className="title">
          <span>{t('lp.page.views', 'Views')}</span>
          <span className="muted">{t('lp.page.total', '({totalViews} total)', { totalViews: data.days.reduce((n, d) => n + d.total, 0) })}</span>
        </div>
        <div role="button" className="nc-analytics-range" onClick={(e) => openMenu(e.currentTarget, { width: 200, sections: [{ items: RANGES.map(([d, label]) => ({ label, checked: d === span, onSelect: () => setSpan(d) })) }] }, { placement: 'bottom-end' })}>
          <Icon name="calendar" size={12} />
          <span>{rangeLabel}</span>
          <Icon name="chevronDownNarrow" size={14} />
        </div>
      </div>
      <ViewsChart days={data.days} createdTime={data.createdTime} />
      {data.totalViews === 0 && (
        <div className="nc-panel-empty small">
          <div className="title">{t('lp.page.no_analytics_so_far', 'No analytics so far')}</div>
          <div className="sub">{t('lp.page.page_view_data_may_take_a', 'Page view data may take a while to appear.')}</div>
        </div>
      )}
      <div className="nc-analytics-section">{t('lp.page.viewers', 'Viewers')}</div>
      <div className="nc-analytics-card">
        <div className="text">
          <div className="t">{t('lp.page.make_your_page_views_visible', 'Make your page views visible')}</div>
          <div className="d">
            {t('lp.page.page_editors_can_see_your_view', 'Page editors can see your view history for this page.')}{' '}
            {HELP_URL && (<a href={HELP_URL} target="_blank" rel="noreferrer">{t('lp.page.learn_more', 'Learn more')}</a>)}
          </div>
        </div>
        <div role="button" className="nc-dialog-btn outline small nc-analytics-allow"
          onClick={(e) => openMenu(e.currentTarget, { width: 180, sections: [{ items: [
            { label: 'Allow', checked: data.showViewHistory !== false, onSelect: () => setHistory(true) },
            { label: "Don't allow", checked: data.showViewHistory === false, onSelect: () => setHistory(false) },
          ] }] }, { placement: 'bottom-end' })}>
          <span>{data.showViewHistory === false ? "Don't allow" : 'Allow'}</span>
          <Icon name="chevronDown" size={12} />
        </div>
      </div>
      {data.viewers.map((v) => (
        <div key={v.userId} className="nc-analytics-person">
          <UserAvatar userId={v.userId} size={24} />
          <span className="name nc-ellipsis">{userName(records.get<UserRecord>('lit_user', v.userId))}</span>
          <span className="when">{longAgo(v.lastViewed)}</span>
        </div>
      ))}
      <div className="nc-analytics-section">{t('lp.page.editors', 'Editors')}</div>
      <div className="nc-analytics-label">{t('lp.page.created_by', 'Created by')}</div>
      <div className="nc-analytics-person">
        <UserAvatar userId={data.createdBy} size={24} />
        <span className="name nc-ellipsis">{userName(records.get<UserRecord>('lit_user', data.createdBy))}</span>
        <span className="when">{longAgo(data.createdTime)}</span>
      </div>
      {data.editors.length > 0 && <div className="nc-analytics-label">{t('lp.page.last_edited_by', 'Edited most recently by')}</div>}
      {data.editors.map((e) => (
        <div key={e.userId} className="nc-analytics-person">
          <UserAvatar userId={e.userId} size={24} />
          <span className="name nc-ellipsis">{userName(records.get<UserRecord>('lit_user', e.userId))}</span>
          <span className="when">{longAgo(e.lastEdited)}</span>
        </div>
      ))}
    </div>
  );
}

/** Daily views since the page existed within the range: y-axis 25.5px in from the left,
 *  x-axis ending 23px before the right edge, 143px plot whose top tick sits 19px under the header row, 10px ticks
 *  (value labels left of the axis, date labels under it), --lp-border-accent axis lines. A single day draws a 1px bar at
 *  the plot's center (a one-day domain has no width); more days get bars (unique views at the bottom). */
function ViewsChart({ days, createdTime }: { days: AnalyticsData['days']; createdTime: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(352);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setW(Math.max(160, el.clientWidth));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dayStart = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const shown = days.filter((d) => d.date >= dayStart(createdTime));
  const series = shown.length ? shown : days.slice(-1);
  const max = Math.max(1, ...series.map((d) => d.total));
  const step = max <= 4 ? 1 : Math.ceil(max / 4);
  const ticks: number[] = [];
  for (let v = step; v <= max; v += step) ticks.push(v);
  const topV = ticks[ticks.length - 1] ?? 1;
  const H = 187;
  const plotTop = 19;
  const plotH = 143;
  const axisY = plotTop + plotH;
  const left = 25.5;
  const right = W - 23;
  const single = series.length === 1;
  const slot = (right - left) / series.length;
  const bw = single ? 1 : Math.max(2, Math.min(10, slot * 0.5));
  const xOf = (i: number) => (single ? (left + right) / 2 : left + slot * (i + 0.5));
  const y = (v: number) => axisY - (v / topV) * plotH;
  const fmt = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const labelIdx = series.length <= 7 ? series.map((_, i) => i) : [0, Math.floor(series.length / 2), series.length - 1];
  const h = hover !== null ? series[hover] : null;
  return (
    <div className="nc-analytics-chart" ref={boxRef}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="Page views" onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <text x={left - 13} y={y(v) + 4} textAnchor="end" className="tick">{v}</text>
            <line x1={left - 10.5} x2={left} y1={y(v)} y2={y(v)} className="axis" />
          </g>
        ))}
        <line x1={left} x2={left} y1={plotTop} y2={axisY} className="axis" />
        <line x1={left} x2={right} y1={axisY} y2={axisY} className="axis" />
        {series.map((d, i) => {
          const cx = xOf(i);
          const uniq = Math.min(d.unique, d.total);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)}>
              <rect x={single ? left : cx - slot / 2} y={0} width={single ? right - left : slot} height={axisY} fill="transparent" />
              {d.total > uniq && <rect x={cx - bw / 2} y={y(d.total)} width={bw} height={y(uniq) - y(d.total)} className="bar total" />}
              {uniq > 0 && <rect x={cx - bw / 2} y={y(uniq)} width={bw} height={axisY - y(uniq)} className="bar unique" />}
            </g>
          );
        })}
        {labelIdx.map((i) => (
          <g key={i}>
            <line x1={xOf(i)} x2={xOf(i)} y1={axisY + 0.5} y2={axisY + 10} className="axis" />
            <text x={xOf(i)} y={axisY + 21} textAnchor="middle" className="label">{fmt(series[i].date)}</text>
          </g>
        ))}
      </svg>
      {h && (
        <div className="nc-analytics-tip">
          {fmt(h.date)} · {t('lp.page.views_plural_one_other_views_overall', '{views, plural, one {1 view overall} other {{views} views overall}}', { views: h.total })} · {t('lp.page.uniqueviews_plural_one_other_unique_view', '{uniqueViews, plural, one {1 distinct view} other {{uniqueViews} distinct views}}', { uniqueViews: h.unique })}
        </div>
      )}
    </div>
  );
}

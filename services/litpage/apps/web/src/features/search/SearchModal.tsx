// Quick Find (⌘K / ⌘P / sidebar "Search or ask").
// Window 1006×700 at top 9vh, radius 20, translucent bg (--lp-popover-translucent-bg) + blur(40px), no dimmed backdrop.
// Grid: header (input + pane/filter toggles) · filter bar · [results 600px | highlight pane 406px] · footer.
// Empty query → recent pages grouped Today / Yesterday / Past week / Past 30 days; query → "Search results (N)".
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { getLocation, navigate, openPage, pageUrl, spaceDomain } from '../../lib/router.ts';
import { quickNavRows, renderSpecialRow } from './quickNav.tsx';
import { ancestorsOf } from '../../lib/blocks.ts';
import { useTableVersion } from '../../lib/hooks.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { pageTitle } from '../page/pageActions.ts';
import { getLocale, t } from '../shell/i18n.ts';
import { HighlightPane } from './HighlightPane.tsx';
import {
  contentStatusLabel, contentStatusMenuDef, dateKindLabel, dateMenuDef, dateRangeLabel, openAddFilterMenu, openCreatedByMenu, openInPageMenu,
  openSearchSettingsMenu, openSortMenu, sortLabel, teamMenuDef, useCreatedByLabel, useInLabel,
} from './filterMenus.tsx';
import { hasActiveFilters, toServerFilters, useSearchState } from './searchState.ts';
import { openMenu } from '../../components/Menu.tsx';
import './icons.tsx';
import './search.css';
import { VerifiedBadge } from '../page/verification.tsx';

interface Row {
  id: string;
  navigate: { pageId: string; blockId?: string };
  /** quick-nav keyword rows ("settings", "inbox", …) and people results */
  kind?: 'action' | 'person';
  action?: { label: string; icon: string; run: () => void };
  userId?: string;
  visitedAt?: number;
  result?: { createdBy?: string; lastEditedTime?: number; isDatabase?: boolean; titleMatch?: boolean; highlight?: { text?: string }; archived?: boolean; verification?: 'verified' | 'expired' };
}

type Bucket = 'today' | 'yesterday' | 'pastWeek' | 'past30' | 'older';

function bucketOf(ts: number, now = new Date()): Bucket {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const d0 = start.getTime();
  if (ts >= d0) return 'today';
  if (ts >= d0 - 86_400_000) return 'yesterday';
  if (ts >= d0 - 7 * 86_400_000) return 'pastWeek';
  if (ts >= d0 - 30 * 86_400_000) return 'past30';
  return 'older';
}

function bucketLabel(b: Bucket) {
  switch (b) {
    case 'today':
      return t('lp.search.today', 'Today');
    case 'yesterday':
      return t('lp.search.yesterday', 'Yesterday');
    case 'pastWeek':
      return t('lp.search.past_week', 'Past week');
    case 'past30':
      return t('lp.search.past_30_days', 'Past 30 days');
    default:
      return t('lp.search.older', 'Older');
  }
}

/** "41m ago" / "Just now" / "Oct 13" (en) — "41분 전" / "방금" / "10월 13일" (ko). */
export function relativeTime(ts: number): string {
  const ko = getLocale() === 'ko-KR';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return ko ? '지금' : 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return ko ? `${m}분 전` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return ko ? `${h}시간 전` : `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return ko ? `${d}일 전` : `${d}d ago`;
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Query terms like the server's: "quoted text" is one exact term, other words are terms of their own. */
function queryTerms(query: string): string[] {
  const out: string[] = [];
  const re = /["“”]([^"“”]*)["“”]?|([^\s"“”]+)/g;
  for (let m = re.exec(query); m; m = re.exec(query)) {
    const term = (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (term && !out.includes(term)) out.push(term);
  }
  return out;
}

function highlight(text: string, query: string, cls: string): ReactNode {
  const q = query.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const quoted = /["“”]/.test(q);
  const needles = !quoted && lower.includes(q.toLowerCase()) ? [q.toLowerCase()] : queryTerms(q).filter((w) => w.length >= 2 || /[^\x00-\x7f]/.test(w));
  if (!needles.length) return text;
  const marks: [number, number][] = [];
  for (const n of needles) {
    let i = lower.indexOf(n);
    while (i >= 0) {
      marks.push([i, i + n.length]);
      i = lower.indexOf(n, i + n.length);
    }
  }
  if (!marks.length) return text;
  marks.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let pos = 0;
  marks.forEach(([s, e], k) => {
    if (s < pos) return;
    if (s > pos) out.push(text.slice(pos, s));
    out.push(<span key={k} className={cls}>{text.slice(s, e)}</span>);
    pos = e;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}

function pathOf(id: string): string[] {
  const titles = ancestorsOf(id).map((a) => pageTitle(a) || t('lp.search.untitled', 'Untitled'));
  return titles.length > 3 ? [titles[0], '...', ...titles.slice(-2)] : titles;
}

// session memory: reopening Quick Find brings back the last query
export function SearchModal() {
  const spaceId = useSession((s) => s.spaceId);
  const space = records.get<SpaceRecord>('space', spaceId);
  const { query, filters, sort, showPane, showFilters } = useSearchState();
  const setQuery = useSearchState((s) => s.setQuery);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [mode, setMode] = useState<'recent' | 'results'>('recent');
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const keyNav = useRef(false);
  useTableVersion(['block']);
  const close = () => useUI.getState().set({ searchOpen: false });
  const filtering = hasActiveFilters(filters);
  const currentPageId = getLocation().route.name === 'page' ? (getLocation().route as { pageId: string }).pageId : null;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    let alive = true;
    const searching = !!query.trim() || filtering;
    setLoading(true);
    const tm = setTimeout(async () => {
      try {
        if (!searching) {
          const res = await api('listRecentPages', { spaceId, limit: 50 });
          if (!alive) return;
          records.mergeRecordMap(res.recordMap);
          setRows(res.pages.map((p: { id: string; visitedAt: number }) => ({ id: p.id, navigate: { pageId: p.id }, visitedAt: p.visitedAt })));
          setTotal(res.pages.length);
          setMode('recent');
        } else {
          const [res, people] = await Promise.all([
            api('searchWorkspace', {
              query, spaceId, limit: 60, filters: toServerFilters(filters), source: 'quick_find',
              sort: { field: sort.field, direction: sort.direction },
            }),
            query.trim() && !filtering ? api('searchPeople', { spaceId, query: query.trim(), limit: 5 }).catch(() => null) : Promise.resolve(null),
          ]);
          if (!alive) return;
          records.mergeRecordMap(res.recordMap);
          if (people) records.mergeRecordMap(people.recordMap);
          const pageRows: Row[] = res.results.map((r: Row['result'] & { id: string; navigate?: Row['navigate'] }) => ({ id: r.id, navigate: r.navigate ?? { pageId: r.id }, result: r }));
          const actionRows = filtering ? [] : quickNavRows(query);
          const personRows: Row[] = (people?.userIds ?? []).map((uid: string) => ({ id: `person:${uid}`, kind: 'person' as const, userId: uid, navigate: { pageId: '' } }));
          // top result "Search every source with AI" → Litpage AI research chat (nc:ai-search)
          const aiRows: Row[] = query.trim() ? [{ id: 'action:ai', kind: 'action' as const, navigate: { pageId: '' }, action: { label: t('lp.search.search_every_source_with_ai', 'Search every source with AI'), icon: 'aiFace', run: () => window.dispatchEvent(new CustomEvent('nc:ai-search', { detail: { query: query.trim(), research: true } })) } } as Row] : [];
          setRows([...aiRows, ...actionRows, ...pageRows, ...personRows]);
          setTotal(res.total ?? res.results.length);
          setMode('results');
          // the AI row is offered on top; Enter still opens the first page / shortcut like before
          setActive(aiRows.length && (actionRows.length || pageRows.length) ? 1 : 0);
          return;
        }
        setActive(0);
      } catch {
        /* keep previous rows */
      } finally {
        if (alive) setLoading(false);
      }
    }, searching ? 150 : 0);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, spaceId, JSON.stringify(filters), sort.field, sort.direction]);

  // Escape closes (menus opened from the window handle their own Escape first)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.lit-overlay-container .nc-overlay')) {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!keyNav.current) return;
    keyNav.current = false;
    listRef.current?.querySelector('[role=option][aria-selected=true]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const open = (r: Row, newTab = false) => {
    if (r.kind === 'action') {
      close();
      r.action?.run();
      return;
    }
    if (r.kind === 'person') {
      close();
      navigate(`/${spaceDomain(spaceId)}/people/${r.userId}`);
      return;
    }
    if (newTab) {
      window.open(pageUrl(r.navigate.pageId, { blockId: r.navigate.blockId }), '_blank');
      return;
    }
    close();
    openPage(r.navigate.pageId, { blockId: r.navigate.blockId });
  };

  const groups = useMemo(() => {
    if (mode !== 'recent') return null;
    const out: { bucket: Bucket; rows: { row: Row; index: number }[] }[] = [];
    rows.forEach((row, index) => {
      const b = bucketOf(row.visitedAt ?? 0);
      const g = out[out.length - 1];
      if (g && g.bucket === b) g.rows.push({ row, index });
      else out.push({ bucket: b, rows: [{ row, index }] });
    });
    return out;
  }, [rows, mode]);

  const activeRow = rows[active];
  const placeholder = t('lp.search.ask_anything_or_search', 'Ask anything or search {spaceName}…', { spaceName: space?.name ?? '' });

  const renderRow = (row: Row, index: number) => {
    if (row.kind) return renderSpecialRow(row, index === active, () => { if (index !== active) setActive(index); }, (e) => open(row, e.metaKey || e.ctrlKey));
    const b = records.get<BlockRecord>('block', row.id);
    if (!b) return null;
    const title = pageTitle(b) || t('lp.search.untitled', 'Untitled');
    const path = pathOf(row.id);
    const isActive = index === active;
    const common = {
      role: 'option',
      'aria-selected': isActive,
      className: `notranslate search-query-result-item nc-qf-row ${row.result ? 'result' : 'recent'} ${isActive ? 'active' : ''}`,
      onMouseMove: () => { if (index !== active) setActive(index); },
    } as const;
    const icon = (
      <div className="nc-qf-row-icon">
        <PageIcon block={b} size={20} />
      </div>
    );
    const enter = (
      <div className="nc-qf-row-end">
        <span className="nc-qf-enter" style={{ visibility: 'hidden' }}><Icon name="arrowTurnDownLeftSmall" size={14} /></span>
      </div>
    );
    if (!row.result) {
      return (
        <a key={row.id} href={pageUrl(row.id)} className="nc-qf-link" onClick={(e) => { e.preventDefault(); open(row, e.metaKey || e.ctrlKey); }}>
          <div {...common}>
            <div className="nc-qf-row-inner">
              {icon}
              <div className="nc-qf-row-main">
                <div className="nc-qf-title-line">
                  <div className="nc-qf-title notranslate">{title}</div>
                  {path.length > 0 && <span className="nc-qf-dash">—</span>}
                  {path.length > 0 && <div className="nc-qf-inline-path notranslate">{path.join(' / ')}</div>}
                </div>
              </div>
              {enter}
            </div>
          </div>
        </a>
      );
    }
    const author = row.result.createdBy ? records.get<UserRecord>('lit_user', row.result.createdBy) : undefined;
    const meta: ReactNode[] = [];
    if (path.length) meta.push(<span key="p" className="nc-qf-meta-path">{highlight(path.join(' / '), query, 'nc-qf-path-match')}</span>);
    if (author) meta.push(<span key="a">{author.name || author.email}</span>);
    if (row.result.lastEditedTime) meta.push(<span key="e">{t('lp.search.edited', 'Edited {time}', { time: relativeTime(row.result.lastEditedTime) })}</span>);
    return (
      <a key={row.id} href={pageUrl(row.navigate.pageId)} className="nc-qf-link" onClick={(e) => { e.preventDefault(); open(row, e.metaKey || e.ctrlKey); }}>
        <div {...common}>
          <div className="nc-qf-row-inner">
            {icon}
            <div className="nc-qf-row-main">
              <div className="nc-qf-title-line">
                <div className="nc-qf-title notranslate">{highlight(title, query, 'nc-qf-title-match')}</div>
                {row.result.verification === 'verified' && <VerifiedBadge size={14} />}
                {row.id === currentPageId && <div className="nc-qf-badge">{t('lp.search.current_page', 'Current Page')}</div>}
                {row.result.archived && <div className="nc-qf-badge">{t('lp.search.archived', 'Archived')}</div>}
                {row.result.isDatabase && <div className="nc-qf-badge">{t('lp.search.database', 'Database')}</div>}
              </div>
              <div className="nc-qf-meta">
                {meta.flatMap((m, i) => (i ? [<span key={`d${i}`}>•</span>, m] : [m]))}
              </div>
            </div>
            {enter}
          </div>
        </div>
      </a>
    );
  };

  return createPortal(
    <div className="nc-qf-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div role="dialog" aria-label={t('lp.search.search_litpage', 'Search Litpage')} className="lit-dialog nc-qf-dialog" style={{ width: showPane ? 1006 : 600 }}>
        <div className="search-snapshot-container nc-qf-grid">
          <div className="nc-qf-header">
            <div className="nc-qf-input-wrap">
              <Icon name="magnifyingGlass" size={22} className="nc-qf-search-icon" />
              <input
                ref={inputRef}
                role="combobox"
                aria-expanded
                className="nc-qf-input"
                placeholder={placeholder}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    keyNav.current = true;
                    setActive((a) => Math.min(rows.length - 1, a + 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    keyNav.current = true;
                    setActive((a) => Math.max(0, a - 1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (activeRow) open(activeRow, e.metaKey || e.ctrlKey);
                  }
                }}
              />
            </div>
            <div className="nc-qf-header-actions">
              <div
                role="button"
                aria-label={showPane ? t('lp.search.hide_highlights_pane', 'Hide highlights pane') : t('lp.search.show_highlights_pane', 'Show highlights pane')}
                data-tooltip={showPane ? t('lp.search.hide_highlights_pane', 'Hide highlights pane') : t('lp.search.show_highlights_pane', 'Show highlights pane')}
                className={`nc-qf-round-btn ${showPane ? 'on' : ''}`}
                onClick={() => useSearchState.getState().setSetting({ showPane: !showPane })}
              >
                <Icon name="sidebarRight" size={22} />
              </div>
              <div
                role="button"
                aria-label={showFilters ? t('lp.search.hide_filters', 'Hide filters') : t('lp.search.show_filters', 'Show filters')}
                data-tooltip={showFilters ? t('lp.search.hide_filters', 'Hide filters') : t('lp.search.show_filters', 'Show filters')}
                className={`nc-qf-round-btn ${showFilters ? 'on' : ''}`}
                style={{ marginInlineStart: 4 }}
                onClick={() => useSearchState.getState().setSetting({ showFilters: !showFilters })}
              >
                <Icon name="filterCircle" size={22} />
              </div>
            </div>
          </div>
          <div className="nc-qf-filterbar-wrap" style={{ maxHeight: showFilters ? 48 : 0, opacity: showFilters ? 1 : 0, pointerEvents: showFilters ? 'auto' : 'none' }}>
            <FilterBar />
          </div>
          {/* the pane sits level with the first row in the recent list (34px down) but with the list top for results */}
          <div className={`nc-qf-content ${mode === 'results' ? 'results' : ''}`}>
            <div className="nc-qf-list-wrap">
              <div ref={listRef} className="lit-scroller vertical nc-qf-list" style={{ width: showPane ? 600 : '100%' }}>
                <div role="listbox" className="nc-qf-listbox">
                  {mode === 'recent' && groups?.map((g) => (
                    <div key={g.bucket} className="nc-qf-group">
                      <div className="nc-qf-group-title"><div className="nc-qf-group-label">{bucketLabel(g.bucket)}</div></div>
                      {g.rows.map(({ row, index }) => renderRow(row, index))}
                    </div>
                  ))}
                  {mode === 'results' && rows[0]?.id === 'action:ai' && <div className="nc-qf-group nc-qf-ai" data-testid="search-ai-row">{renderRow(rows[0], 0)}</div>}
                  {mode === 'results' && rows.some((r) => r.kind === 'action' && r.id !== 'action:ai') && (
                    <div className="nc-qf-group nc-qf-jump">
                      <div className="nc-qf-group-title"><div className="nc-qf-group-label">{t('lp.search.jump_to', 'Jump to')}</div></div>
                      {rows.map((row, i) => (row.kind === 'action' && row.id !== 'action:ai' ? renderRow(row, i) : null))}
                    </div>
                  )}
                  {mode === 'results' && (
                    <div className="nc-qf-group">
                      <div className="nc-qf-group-title">
                        <div className="nc-qf-group-label">
                          {total ? t('lp.search.search_results', 'Search results ({count})', { count: total }) : t('lp.search.search_results_0144', 'Search results')}
                        </div>
                        <div style={{ marginInlineStart: 'auto' }}>
                          <button className="nc-qf-sort" onClick={(e) => openSortMenu(e.currentTarget)}>
                            {sortLabel(sort)}
                            <Icon name="arrowChevronSingleDownSmall" size={14} />
                          </button>
                        </div>
                      </div>
                      {rows.map((row, i) => (row.kind ? null : renderRow(row, i)))}
                      {!rows.some((r) => !r.kind) && !loading && <div className="nc-qf-empty">{t('lp.search.no_matches', 'No matches')}</div>}
                    </div>
                  )}
                  {mode === 'results' && rows.some((r) => r.kind === 'person') && (
                    <div className="nc-qf-group nc-qf-people">
                      <div className="nc-qf-group-title"><div className="nc-qf-group-label">{t('lp.search.people', 'People')}</div></div>
                      {rows.map((row, i) => (row.kind === 'person' ? renderRow(row, i) : null))}
                    </div>
                  )}
                </div>
              </div>
            </div>
            {showPane && <HighlightPane pageId={activeRow && !activeRow.kind ? activeRow.id : null} onOpenNewTab={(id) => window.open(pageUrl(id), '_blank')} />}
          </div>
          <div className="nc-qf-footer">
            <ul className="nc-qf-hints">
              <li>
                <span className="nc-qf-keys"><Icon name="commandSmall" size={12} /><Icon name="arrowTurnDownLeftSmall" size={12} /></span>
                {t('lp.search.open_in_a_new_tab', 'Open in a new tab')}
              </li>
            </ul>
            <div className="nc-qf-footer-right">
              <div className="nc-qf-feedback" style={{ visibility: mode === 'results' ? 'visible' : 'hidden' }}>
                <div role="button" className="nc-qf-small-btn" aria-label={t('lp.search.this_search_was_helpful', 'This search was helpful')} data-tooltip={t('lp.search.this_search_was_helpful', 'This search was helpful')} onClick={() => useUI.getState().toast(t('lp.search.thanks_for_your_feedback', 'Thanks for your feedback!'))}>
                  <Icon name="handThumbsUpSmall" size={16} />
                </div>
                <div role="button" className="nc-qf-small-btn" aria-label={t('lp.search.this_search_wasn_t_helpful', 'This search wasn’t helpful')} data-tooltip={t('lp.search.this_search_wasn_t_helpful', 'This search wasn’t helpful')} onClick={() => useUI.getState().toast(t('lp.search.thanks_for_your_feedback', 'Thanks for your feedback!'))}>
                  <Icon name="handThumbsDownSmall" size={16} />
                </div>
              </div>
              <div role="button" className="nc-qf-small-btn" aria-label={t('lp.search.search_settings', 'Search settings')} data-tooltip={t('lp.search.search_settings', 'Search settings')} onClick={(e) => openSearchSettingsMenu(e.currentTarget)}>
                <Icon name="slidersSmall" size={16} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The chip glyphs are 20px tall with cropped viewBoxes (width auto): keep their widths. */
const CHIP_ICON_WIDTH: Record<string, number> = { textFormat: 16.56, person: 12.64, pageEmpty: 11.75 };

function Chip({ icon, label, active, chevron, onClick, title }: { icon: string; label: ReactNode; active?: boolean; chevron?: boolean; onClick: (el: HTMLElement) => void; title?: string }) {
  return (
    <div className="nc-qf-chip-wrap">
      <div role="button" title={title} className={`nc-qf-chip ${active ? 'active' : ''}`} onClick={(e) => onClick(e.currentTarget as HTMLElement)}>
        <span className="nc-qf-chip-icon" style={{ width: CHIP_ICON_WIDTH[icon] ?? 20 }}><Icon name={icon} size={18} /></span>
        <span className="nc-qf-chip-label">{label}</span>
        {chevron && <span className="nc-qf-chip-chev"><Icon name="arrowChevronSingleDownSmall" size={16} /></span>}
      </div>
    </div>
  );
}

function FilterBar() {
  const filters = useSearchState((s) => s.filters);
  const setFilters = useSearchState((s) => s.setFilters);
  const createdBy = useCreatedByLabel();
  const inLabel = useInLabel();
  const teams = filters.teamIds.map((id) => (records.get('team', id) as { name?: string } | undefined)?.name).filter(Boolean);
  return (
    <div role="toolbar" aria-label={t('lp.search.search_filters', 'Search filters')} className="lit-scroller horizontal nc-qf-filterbar">
      <div className="nc-qf-chips">
        <Chip icon="textFormat" label={t('lp.search.title_only', 'Title only')} active={filters.titleOnly} onClick={() => setFilters({ titleOnly: !filters.titleOnly })} />
        <Chip icon="person" label={createdBy} active={filters.createdBy.length > 0} chevron onClick={(el) => openCreatedByMenu(el)} />
        <Chip icon="pageEmpty" label={inLabel} active={!!filters.inPage} chevron onClick={(el) => openInPageMenu(el)} />
        {filters.added.includes('date') && (
          <Chip
            icon="calendar"
            label={filters.date ? `${dateKindLabel(filters.date.kind)}: ${dateRangeLabel(filters.date.range)}` : t('lp.search.date', 'Date')}
            active={!!filters.date}
            chevron
            onClick={(el) => openMenu(el, dateMenuDef(), { placement: 'bottom-start' })}
          />
        )}
        {filters.added.includes('teamspace') && (
          <Chip
            icon="building"
            label={teams.length ? `${t('lp.search.team', 'Team')}: ${teams.join(', ')}` : t('lp.search.team', 'Team')}
            active={filters.teamIds.length > 0}
            chevron
            onClick={(el) => openMenu(el, teamMenuDef(), { placement: 'bottom-start' })}
          />
        )}
        {filters.added.includes('contentStatus') && (
          <Chip
            icon="checkBadge"
            label={filters.contentStatus === 'all' ? t('lp.search.content_status', 'Content status') : contentStatusLabel(filters.contentStatus)}
            active={filters.contentStatus !== 'all'}
            chevron
            onClick={(el) => openMenu(el, contentStatusMenuDef(), { placement: 'bottom-start' })}
          />
        )}
      </div>
      <div role="button" className="nc-qf-add-filter" onClick={(e) => openAddFilterMenu(e.currentTarget)}>
        <span className="nc-qf-chip-chev" style={{ width: 9.2 }}><Icon name="plusSmall" size={14} /></span>
        {t('lp.search.filter', 'Filter')}
      </div>
    </div>
  );
}

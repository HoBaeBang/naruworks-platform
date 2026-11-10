// Library (/<domain>/library/<tab>): full-page library with tabbed views and table controls.
// h1 "Library" + per-tab primary button, pill tabs (Teamspaces / Recents / Favorites / Shared / Private /
// AI meeting notes / Skills) with "N more" overflow, Filter, Sort, Search, and Settings tools, table views,
// filter bar, right "View settings" panel, empty states for AI notes and Skills.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { useCurrentSpaceView } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, spaceDomain, useLocation } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { currentSpaceView } from '../../lib/store/session.ts';
import { DEFAULT_LIMIT, SECTION_LIMITS, findSection, layoutOf, updateLayout, type SectionType } from '../shell/sidebar/model.ts';
import { newPage, pageTitle } from '../page/pageActions.ts';
import { openCreateTeamspaceDialog } from '../shell/teamspaces.tsx';
import { createMeetingNote } from '../shell/sidebar/menus.tsx';
import { t } from '../shell/i18n.ts';
import './icons.tsx';
import './home.css';
import {
  COL_ICON, LIB_TABS, TAB_ICON, availableColumns, colLabel, filterActive, isLibTab, lastLibraryTab, matchesFilter, rememberLibraryTab,
  sortRows, tabLabel, useLibraryView, useLibraryViews, type LibTab, type PageTab,
} from './library/model.ts';
import { filterSummary, isTabWithTable, openFilterEditor, openFilterMenu, openPropertyVisibilityMenu, openSortMenu, pendingFilterEditor } from './library/menus.tsx';
import { useLibraryRows } from './library/data.ts';
import { LibraryTable } from './library/LibraryTable.tsx';
import { TeamspacesTab } from './library/TeamspacesTab.tsx';
import { createNewSkill, SkillsTab } from '../ai/SkillsLibrary.tsx';
import { AgentDirectory } from '../agents/AgentDirectory.tsx';
import { openNewAgentModal } from '../agents/NewAgentModal.tsx';

export function LibraryPage() {
  const { route } = useLocation();
  const spaceId = useSession((s) => s.spaceId);
  const domain = spaceDomain(spaceId);
  const routeTab = route.name === 'library' ? route.tab : undefined;
  const tab: LibTab = isLibTab(routeTab) ? routeTab : lastLibraryTab();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(97);
  const pageRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The View settings panel hangs below the sticky view bar.
  useLayoutEffect(() => {
    if (!settingsOpen) return;
    const page = pageRef.current;
    const sc = scrollRef.current;
    if (!page || !sc) return;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const bar = sc.querySelector('.nc-lib-viewbar') as HTMLElement | null;
        if (!bar) return;
        setPanelTop(Math.round(bar.getBoundingClientRect().bottom - page.getBoundingClientRect().top));
      });
    };
    update();
    sc.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      sc.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [settingsOpen, tab]);

  useEffect(() => {
    rememberLibraryTab(tab);
    if (!isLibTab(routeTab)) navigate(`/${domain}/library/${tab}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, routeTab, domain]);

  useEffect(() => {
    document.title = `${t('lp.home.library', 'Library')} | Litpage`;
  }, []);

  const goTab = (next: LibTab) => {
    if (next === tab) return;
    navigate(`/${domain}/library/${next}`);
  };

  const primary = (() => {
    switch (tab) {
      case 'teamspaces':
        return { label: t('lp.home.new_team', 'New team'), run: () => openCreateTeamspaceDialog() };
      case 'meetings':
        return { label: t('lp.home.start_ai_meeting_notes', 'Start AI meeting notes'), run: () => createMeetingNote() };
      case 'skills':
        return { label: t('lp.home.new_skill', 'New skill'), run: () => void createNewSkill() };
      case 'agents':
        return { label: t('lp.home.new_agent', 'New agent'), run: () => void openNewAgentModal() };
      default:
        return { label: t('lp.home.new_page', 'New page'), run: () => newPage({ kind: 'private' }) };
    }
  })();

  return (
    <div className="nc-lib-page" data-library-tab={tab} ref={pageRef}>
      <div className="lit-scroller vertical nc-lib-scroll" ref={scrollRef}>
        <div className="nc-lib-headline">
          <h1 className="nc-lib-h1">{t('lp.home.library', 'Library')}</h1>
          <div role="button" className="nc-lib-primary" onClick={primary.run}>{primary.label}</div>
        </div>
        <ViewBar
          tab={tab}
          onTab={goTab}
          searchOpen={searchOpen}
          setSearchOpen={(v) => {
            setSearchOpen(v);
            if (!v) setQuery('');
          }}
          query={query}
          setQuery={setQuery}
          settingsOpen={settingsOpen}
          toggleSettings={() => setSettingsOpen((v) => !v)}
        />
        {isTabWithTable(tab) && <FilterBar tab={tab} />}
        <div className="nc-lib-main" style={{ marginInlineEnd: settingsOpen && tab !== 'skills' && tab !== 'agents' ? 290 : 0 }}>
          <TabBody tab={tab} query={query} />
        </div>
      </div>
      {settingsOpen && tab !== 'skills' && tab !== 'agents' && <SettingsPanel tab={tab} top={panelTop} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

// ---------------- view bar (tabs + tools) ----------------
function ViewBar({ tab, onTab, searchOpen, setSearchOpen, query, setQuery, settingsOpen, toggleSettings }: {
  tab: LibTab;
  onTab: (t: LibTab) => void;
  searchOpen: boolean;
  setSearchOpen: (v: boolean) => void;
  query: string;
  setQuery: (v: string) => void;
  settingsOpen: boolean;
  toggleSettings: () => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(LIB_TABS.length);
  const view = useLibraryView(tab);
  const hasTable = isTabWithTable(tab);

  useLayoutEffect(() => {
    const el = listRef.current;
    const m = measureRef.current;
    if (!el || !m) return;
    const compute = () => {
      const widths = [...m.children].map((c) => (c as HTMLElement).offsetWidth + 1);
      const avail = el.clientWidth;
      const total = widths.reduce((a, b) => a + b, 0);
      if (total <= avail) {
        setFit(LIB_TABS.length);
        return;
      }
      const moreW = 96;
      let used = 0;
      let n = 0;
      for (const wdt of widths) {
        if (used + wdt + moreW > avail) break;
        used += wdt;
        n++;
      }
      setFit(Math.max(1, n));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [searchOpen, hasTable, view.sort]);

  let shown = LIB_TABS.slice(0, fit);
  if (!shown.includes(tab)) shown = [...shown.slice(0, Math.max(0, fit - 1)), tab];
  const hidden = LIB_TABS.filter((x) => !shown.includes(x));

  const tabEl = (x: LibTab, measure = false) => (
    <div
      key={x}
      role="tab"
      aria-selected={!measure && x === tab}
      aria-haspopup="dialog"
      className={`lit-collection-view-tab nc-lib-tab ${!measure && x === tab ? 'selected' : ''}`}
      onClick={measure ? undefined : (e) => (x === tab ? openLibrarySectionMenu(x, e.currentTarget as HTMLElement) : onTab(x))}
    >
      <Icon name={TAB_ICON[x]} size={20} />
      <span className="nc-lib-tab-label">{tabLabel(x)}</span>
    </div>
  );

  return (
    <div className="nc-lib-viewbar">
      <div className="nc-lib-viewbar-inner">
        <div role="tablist" className="nc-lib-tabs" ref={listRef}>
          {shown.map((x) => tabEl(x))}
          {hidden.length > 0 && (
            <div
              role="button"
              className="nc-lib-tab nc-lib-more"
              onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                width: 220,
                sections: [{ items: hidden.map((x) => ({ label: tabLabel(x), icon: TAB_ICON[x], onSelect: () => onTab(x) })) }],
              })}
            >
              {t('lp.home.more', '{moreCount} more', { moreCount: hidden.length })}
            </div>
          )}
        </div>
        <div className="nc-lib-measure" ref={measureRef} aria-hidden>
          {LIB_TABS.map((x) => tabEl(x, true))}
        </div>
        <div className="nc-lib-tools">
          {tab !== 'teamspaces' && tab !== 'agents' && (
            <div
              role="button"
              aria-label={t('lp.home.filter', 'Filter')}
              className={`nc-lib-tool ${hasTable && view.filters.length ? 'active' : ''}`}
              data-tooltip={t('lp.home.filter', 'Filter')}
              onClick={(e) => {
                if (hasTable) openFilterMenu(tab, e.currentTarget as HTMLElement);
                else useUI.getState().toast(t('lp.home.there_is_nothing_to_filter_yet', 'There is nothing to filter yet'));
              }}
            >
              <Icon name="filterSmall" size={16} />
            </div>
          )}
          {hasTable && view.sort && (
            <div role="button" aria-label={t('lp.home.sort', 'Sort')} className="nc-lib-tool active" data-tooltip={t('lp.home.sort', 'Sort')} onClick={(e) => openSortMenu(tab, e.currentTarget as HTMLElement)}>
              <Icon name="arrowUpDown" size={16} />
            </div>
          )}
          {searchOpen ? (
            <div className="nc-lib-search">
              <Icon name="magnifyingGlassSmall" size={16} />
              <input
                autoFocus
                value={query}
                placeholder={t('lp.home.type_to_search', 'Search by typing…')}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setSearchOpen(false); }}
                onBlur={() => { if (!query) setSearchOpen(false); }}
              />
            </div>
          ) : (
            <div role="button" aria-label={t('lp.home.search', 'Search')} className="nc-lib-tool" data-tooltip={t('lp.home.search', 'Search')} onClick={() => setSearchOpen(true)}>
              <Icon name="magnifyingGlassSmall" size={16} />
            </div>
          )}
          {tab !== 'skills' && tab !== 'agents' && (
            <div role="button" aria-label={t('lp.home.settings', 'Settings')} className={`nc-lib-tool ${settingsOpen ? 'pressed' : ''}`} data-tooltip={t('lp.home.settings', 'Settings')} onClick={toggleSettings}>
              <Icon name="slidersSmall" size={16} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- filter bar ----------------
function FilterBar({ tab }: { tab: PageTab }) {
  const view = useLibraryView(tab);
  const pillRefs = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    const id = pendingFilterEditor.id;
    if (!id) return;
    const el = pillRefs.current.get(id);
    if (el) {
      pendingFilterEditor.id = null;
      openFilterEditor(tab, id, el);
    }
  }, [view.filters, tab]);
  if (!view.filters.length) return null;
  return (
    <div className="nc-lib-filterbar">
      {view.filters.map((f) => {
        const summary = filterSummary(f);
        return (
          <div
            key={f.id}
            ref={(el) => { if (el) pillRefs.current.set(f.id, el); else pillRefs.current.delete(f.id); }}
            role="button"
            className={`nc-lib-pill ${filterActive(f) ? 'active' : ''}`}
            onClick={(e) => openFilterEditor(tab, f.id, e.currentTarget as HTMLElement)}
          >
            <Icon name={COL_ICON[f.col]} size={14} />
            <span className="nc-ellipsis">{summary ? `${colLabel(f.col)}: ${summary}` : colLabel(f.col)}</span>
            <Icon name="chevronDown" size={12} />
          </div>
        );
      })}
      <div role="button" className="nc-lib-addfilter" onClick={(e) => openFilterMenu(tab, e.currentTarget as HTMLElement)}>
        <Icon name="plus" size={14} />
        <span>{t('lp.home.add_filter', 'Add filter')}</span>
      </div>
    </div>
  );
}

// ---------------- body ----------------
function TabBody({ tab, query }: { tab: LibTab; query: string }) {
  if (tab === 'teamspaces') return <TeamspacesBody query={query} />;
  if (tab === 'skills') return <SkillsEmpty />;
  if (tab === 'agents') return <AgentDirectory query={query} />;
  return <PageTabBody tab={tab} query={query} />;
}

function TeamspacesBody({ query }: { query: string }) {
  const view = useLibraryView('teamspaces');
  return <TeamspacesTab query={query} includeArchived={!!view.includeArchived} />;
}

function PageTabBody({ tab, query }: { tab: PageTab; query: string }) {
  const view = useLibraryView(tab);
  const sv = useCurrentSpaceView();
  const { rows, loaded } = useLibraryRows(tab);
  const columns = useMemo(() => {
    const avail = availableColumns(tab);
    const v = view.visible.filter((c) => avail.includes(c));
    return v.includes('title') ? ['title' as const, ...v.filter((c) => c !== 'title')] : ['title' as const, ...v];
  }, [view.visible, tab]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = rows.filter((r) => {
      const b = records.get<BlockRecord>('block', r.id);
      if (!b) return false;
      if (q && !pageTitle(b).toLowerCase().includes(q)) return false;
      return view.filters.every((f) => matchesFilter(b, r, f, sv));
    });
    return sortRows(filtered, view.sort, sv);
  }, [rows, query, view.filters, view.sort, sv]);

  if (tab === 'meetings' && loaded && rows.length === 0) return <MeetingNotesEmpty />;
  return (
    <LibraryTable
      tab={tab}
      view={view}
      rows={shown}
      columns={columns}
      empty={loaded && shown.length === 0
        ? (query || view.filters.length ? t('lp.home.no_results', 'No results') : t('lp.home.no_matching_pages', 'No pages match'))
        : undefined}
    />
  );
}

export function MeetingNotesEmpty() {
  return (
    <div className="nc-lib-empty">
      <div className="nc-lib-empty-icon"><Icon name="libPaperMic" size={32} /></div>
      <div className="nc-lib-empty-text">{t('lp.home.every_ai_meeting_note_you_have', 'Every AI meeting note you have, plus notes tied to meetings you joined, lives here so following up is easy.')}</div>
      <div role="button" className="nc-lib-primary small" onClick={() => createMeetingNote()}>{t('lp.home.start_ai_meeting_notes', 'Start AI meeting notes')}</div>
    </div>
  );
}

function SkillsEmpty() {
  const view = useLibraryView('skills');
  const seg = view.skillsTab ?? 'enabled';
  const set = (v: 'enabled' | 'discover') => useLibraryViews.getState().update('skills', (x) => { x.skillsTab = v; });
  // the skills list itself lives in features/ai: enabled / discover skills, New skill, Enable for me
  return <SkillsTab seg={seg} setSeg={set} />;
}

export function SkillsEmptyState() {
  const view = useLibraryView('skills');
  const seg = view.skillsTab ?? 'enabled';
  const set = (v: 'enabled' | 'discover') => useLibraryViews.getState().update('skills', (x) => { x.skillsTab = v; });
  return (
    <div className="nc-lib-skills">
      <div className="nc-lib-seg" role="tablist" aria-label={t('lp.home.skills_library_sections', 'Skill library sections')}>
        <div role="tab" aria-selected={seg === 'enabled'} className={`nc-lib-seg-item ${seg === 'enabled' ? 'selected' : ''}`} onClick={() => set('enabled')}>
          {t('lp.home.enabled_for_me', 'Enabled for my account')}
        </div>
        <div role="tab" aria-selected={seg === 'discover'} className={`nc-lib-seg-item ${seg === 'discover' ? 'selected' : ''}`} onClick={() => set('discover')}>
          {t('lp.home.discover', 'Discover')}
        </div>
      </div>
      <div className="nc-lib-empty skills">
        <div className="nc-lib-empty-icon"><Icon name="libPaperSkill" size={32} /></div>
        <div className="nc-lib-empty-text">
          {seg === 'enabled'
            ? t('lp.home.type_in_chat_to_run_an', 'Type ‘/’ in chat to run an enabled skill, or let Agent apply skills on its own when they fit. To get started, create your first skill or browse ones others have made in the Discover tab.')
            : t('lp.home.when_teammates_create_skills_in_your', 'When teammates create skills in your workspace, you’ll see them here.')}
        </div>
        {seg === 'enabled' && (
          <div role="button" className="nc-lib-linkbtn" onClick={() => useUI.getState().toast(t('lp.home.this_workspace_can_t_use_skills', 'This workspace can’t use skills.'))}>
            <Icon name="plus" size={16} />
            <span>{t('lp.home.new_skill', 'New skill')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------- settings panel ----------------
function SettingsPanel({ tab, top, onClose }: { tab: LibTab; top: number; onClose: () => void }) {
  const view = useLibraryView(tab);
  const hasTable = isTabWithTable(tab);
  const visibleCount = hasTable ? view.visible.filter((c) => availableColumns(tab as PageTab).includes(c)).length : 0;
  return (
    <aside className="lit-view-settings-sidebar nc-lib-settings" style={{ top }}>
      <div className="nc-lib-settings-head">
        <div className="nc-lib-settings-title">{t('lp.home.view_settings', 'View settings')}</div>
        <div role="button" aria-label={t('lp.home.close', 'Close')} className="nc-lib-settings-close" onClick={onClose}>
          <Icon name="xMarkSmall" size={14} />
        </div>
      </div>
      <div className="nc-lib-settings-body">
        {hasTable && (
          <>
            <div role="menuitem" className="nc-menu-item" onClick={(e) => openPropertyVisibilityMenu(tab as PageTab, e.currentTarget as HTMLElement)}>
              <div className="nc-menu-item-inner">
                <div className="nc-menu-icon"><Icon name="eye" size={20} /></div>
                <div className="nc-menu-label">{t('lp.home.property_visibility', 'Property visibility')}</div>
                <span className="nc-lib-settings-value">{visibleCount}</span>
                <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />
              </div>
            </div>
            <div role="menuitem" className="nc-menu-item" onClick={(e) => openFilterMenu(tab as PageTab, e.currentTarget as HTMLElement)}>
              <div className="nc-menu-item-inner">
                <div className="nc-menu-icon"><Icon name="filter" size={20} /></div>
                <div className="nc-menu-label">{t('lp.home.filter', 'Filter')}</div>
                {view.filters.length > 0 && <span className="nc-lib-settings-value">{view.filters.length}</span>}
                <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />
              </div>
            </div>
          </>
        )}
        {tab === 'teamspaces' && (
          <div role="menuitemcheckbox" aria-checked={!!view.includeArchived} className="nc-menu-item" onClick={() => useLibraryViews.getState().update('teamspaces', (v) => { v.includeArchived = !v.includeArchived; })}>
            <div className="nc-menu-item-inner">
              <div className="nc-menu-icon"><Icon name="archiveBox" size={20} /></div>
              <div className="nc-menu-label">{t('lp.home.include_archived_pages', 'Show archived pages')}</div>
               {/* The enabled state is shown with a trailing checkmark. */}
              {view.includeArchived && <Icon name="check" size={16} style={{ color: 'var(--lp-icon-primary)' }} />}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

// ---------------- Library tab ↔ sidebar section ----------------
const TAB_SECTION: Partial<Record<LibTab, SectionType>> = {
  teamspaces: 'teamspaces', recents: 'recents', favorites: 'favorites', shared: 'shared', private: 'private', meetings: 'ai_meeting_notes', agents: 'agents',
};

/** Clicking the selected tab: "Add section to sidebar" / "Hide sidebar" and how many items the section shows. */
function openLibrarySectionMenu(tab: LibTab, anchor: HTMLElement) {
  const type = TAB_SECTION[tab];
  if (!type) return;
  const layout = layoutOf(currentSpaceView());
  const hit = layout.tabs.flatMap((tb) => tb.sections.map((sec) => ({ tb, sec }))).find((x) => x.sec.type === type);
  const items: MenuItemDef[] = hit
    ? [
      {
        label: t('lp.home.show', 'Show'), icon: 'listBullet',
        right: <span className="nc-menu-value">{(hit.sec.limit ?? DEFAULT_LIMIT[type] ?? 5)}</span>,
        submenu: () => ({
          width: 160,
          sections: [{
            items: SECTION_LIMITS.map((n) => ({
              label: t('lp.home.items', '{count} items', { count: n }), checked: (hit.sec.limit ?? DEFAULT_LIMIT[type] ?? 5) === n,
              onSelect: () => updateLayout((l) => { const f = findSection(l, hit.sec.id); if (f) f.tab.sections[f.index].limit = n; }),
            })),
          }],
        }),
      },
      {
        label: t('lp.home.remove_from_sidebar', 'Hide from sidebar'), icon: 'eyeOff',
        onSelect: () => updateLayout((l) => { const f = findSection(l, hit.sec.id); if (f) f.tab.sections.splice(f.index, 1); }),
      },
    ]
    : [{
      label: t('lp.home.add_section_to_sidebar', 'Add section to sidebar'), icon: 'plus',
      onSelect: () => updateLayout((l) => { l.tabs[0]?.sections.push({ id: `sec-${type}-${Date.now().toString(36)}`, type, limit: DEFAULT_LIMIT[type] ?? 5 }); }),
    }];
  openMenu(anchor, { width: 240, sections: [{ items }] }, { placement: 'bottom-start' });
}

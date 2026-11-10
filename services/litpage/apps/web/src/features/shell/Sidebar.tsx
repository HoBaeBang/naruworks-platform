import { HELP_URL } from '@nc/shared/brand.ts';
// Sidebar (nav.lit-sidebar-container), tabbed layout: header (close / inbox / New…), "Search or ask",
// Home·Chat·Meetings tabs, per-tab shortcuts + sections, "Customize sidebar", footer (workspace switcher, help, apps).
// Behaviour: close/peek/reopen, resize 270–600 with arrow keys, section collapse, customize mode.
import { useEffect, useRef, useState } from 'react';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { useCurrentSpace, useCurrentUser } from '../../lib/hooks.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, openPage, pageUrl, spaceDomain, useLocation } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay } from '../../components/overlay.tsx';
import { PageIcon } from './PageIcon.tsx';
import { t, tParts } from './i18n.ts';
import './sidebar/icons.tsx';
import {
  getActiveTabId, setActiveTabId, updateLayout, useActiveTabId, useSidebarLayout, useSidebarMode, type SidebarShortcut, type SidebarTab,
} from './sidebar/model.ts';
import { SHORTCUT_ICON, TAB_ICON, shortcutLabel, tabName } from './sidebar/labels.ts';
import { newPageShortcutLabel, runNewPageShortcut } from './sidebar/newPagePreview.tsx';
import { SectionView, useSidebarDataLoader } from './sidebar/Sections.tsx';
import { useShownSidebarLayout } from '../developer/SidebarSection.tsx';
import { useAiSidebarLayout } from '../ai/sidebarAi.ts';
import { CustomizeTabBody, DoneButton } from './sidebar/Customize.tsx';
import {
  addTab, createMeetingNote, createPrivateDatabase, openAppsMenu, openHelpMenu, openMyTasks, openNewMenu, openShortcutMenu, openTabMenu,
  switchWorkspace, useHasUnseenRelease, userSpaces,
} from './sidebar/menus.tsx';
import { openWorkspaceMenu } from './sidebar/WorkspaceMenu.tsx';
import { pageTitle } from '../page/pageActions.ts';
import { records } from '../../lib/store/records.ts';
import './sidebar.css';

export { PageTreeItem } from './sidebar/PageTree.tsx';

export const SIDEBAR_MIN = 270;
export const SIDEBAR_MAX = 600;
export const MOBILE_BREAKPOINT = 600;

function useIsMobile() {
  const [m, setM] = useState(() => window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const on = () => setM(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return m;
}

export function Sidebar() {
  const open = useUI((s) => s.sidebarOpen);
  const width = useUI((s) => s.sidebarWidth);
  const peek = useUI((s) => s.sidebarPeek);
  const [resizing, setResizing] = useState(false);
  const mobile = useIsMobile();
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useSidebarDataLoader();

  // phones: the docked sidebar becomes an overlay drawer that starts closed
  useEffect(() => {
    if (mobile && useUI.getState().sidebarOpen) useUI.getState().set({ sidebarOpen: false });
  }, [mobile]);

  const docked = open && !mobile;
  const floating = !docked && (peek || (mobile && open));
  const w = Math.min(width, mobile ? window.innerWidth - 48 : SIDEBAR_MAX);

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    let moved = false;
    setResizing(true);
    const onMove = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 2) moved = true;
      if (moved) useUI.getState().setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, ev.clientX)));
    };
    const onUp = () => {
      setResizing(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) useUI.getState().setSidebarOpen(false); // click on the resizer closes the sidebar
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <>
      {mobile && open && <div className="nc-sb-mobile-backdrop" onClick={() => useUI.getState().setSidebarOpen(false)} />}
      <nav
        className={`lit-sidebar-container ${docked ? 'open' : 'closed'} ${floating ? 'peek' : ''} ${resizing ? 'resizing' : ''} ${mobile ? 'mobile' : ''}`}
        aria-label={t('lp.shell.sidebar', 'Sidebar')}
        style={{ width: docked ? w : 0 }}
      >
        <div style={{ height: '100%' }}>
          <div className="nc-sb-anchor">
            <div
              className="lit-sidebar"
              style={{
                width: w,
                opacity: docked || floating ? 1 : 0,
                transform: docked || (mobile && open) ? 'translateX(0) translateY(0)' : floating ? 'translateX(0) translateY(59px)' : `translateX(-${w - 20}px) translateY(59px)`,
                height: docked || (mobile && open) ? '100%' : 'calc(100% - 91px)',
              }}
              onMouseEnter={() => { if (leaveTimer.current) clearTimeout(leaveTimer.current); }}
              onMouseLeave={() => {
                if (!peek) return;
                leaveTimer.current = setTimeout(() => {
                  if (!document.querySelector('.lit-overlay-container .nc-overlay')) useUI.getState().set({ sidebarPeek: false });
                }, 250);
              }}
            >
              <div className="nc-sb-floating-bg" />
              <div className="nc-sb-frame">
                <div className="nc-sb-column">
                  <SidebarHeader />
                  <SidebarBody />
                  <SidebarFooter />
                </div>
              </div>
            </div>
          </div>
        </div>
        {docked && <Resizer onPointerDown={startResize} width={w} />}
      </nav>
    </>
  );
}

function Resizer({ onPointerDown, width }: { onPointerDown: (e: React.PointerEvent) => void; width: number }) {
  const [tip, setTip] = useState<{ y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pct = Math.round(((width - SIDEBAR_MIN) / (SIDEBAR_MAX - SIDEBAR_MIN)) * 100);
  return (
    <div className="nc-sb-resizer-wrap">
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t('lp.shell.press_the_left_or_right_arrow', 'Press the left or right arrow key to resize')}
        className="nc-sb-resizer"
        onPointerDown={onPointerDown}
        onMouseMove={(e) => {
          const y = e.clientY;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setTip({ y }), 400);
        }}
        onMouseLeave={() => {
          if (timer.current) clearTimeout(timer.current);
          setTip(null);
        }}
        onKeyDown={(e) => {
          const ui = useUI.getState();
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            ui.setSidebarWidth(Math.min(SIDEBAR_MAX, ui.sidebarWidth + 10));
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            ui.setSidebarWidth(Math.max(SIDEBAR_MIN, ui.sidebarWidth - 10));
          }
        }}
      />
      {tip && (
        <div className="nc-sb-resize-tip" style={{ left: width + 10, top: tip.y - 22 }}>
          <div>{tParts('lp.shell.close_use_or_click', 'Close <invertedcolor>Use {keyboardShortcut} or click</invertedcolor>', { keyboardShortcut: '⌘\\' }).map((p, i) => p.tag ? <span key={i}>{p.text}</span> : <b key={i}>{p.text}</b>)}</div>
          <div>{tParts('lp.shell.resize_drag_to_adjust', 'Resize <invertedcolor>Drag to adjust</invertedcolor>').map((p, i) => p.tag ? <span key={i}>{p.text}</span> : <b key={i}>{p.text}</b>)}</div>
        </div>
      )}
    </div>
  );
}

// ---------------- header ----------------
function SidebarHeader() {
  const open = useUI((s) => s.sidebarOpen);
  const inboxOpen = useUI((s) => s.inboxOpen);
  const newRef = useRef<HTMLDivElement>(null);
  return (
    <div className="nc-sb-top">
      <div className="nc-sb-header">
        <div className="nc-sb-header-left">
          <div
            role="button"
            aria-label={open ? t('lp.shell.close_sidebar', 'Close sidebar') : t('lp.shell.keep_the_sidebar_open', 'Keep the sidebar open')}
            className="nc-btn icon-only nc-sb-close"
            data-tooltip={open ? t('lp.shell.close_sidebar', 'Close sidebar') : t('lp.shell.keep_the_sidebar_open', 'Keep the sidebar open')}
            data-tooltip-sub="⌘\"
            onClick={() => useUI.getState().setSidebarOpen(!open)}
          >
            <Icon name="sidebarLeft" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
          </div>
        </div>
        <div className="nc-sb-header-actions">
          <div style={{ position: 'relative', display: 'flex', flexShrink: 0 }}>
            <div
              role="button"
              aria-label={t('lp.shell.inbox', 'Inbox')}
              className={`nc-btn icon-only nc-sb-header-btn ${inboxOpen ? 'pressed' : ''}`}
              data-tooltip={t('lp.shell.inbox', 'Inbox')}
              data-tooltip-sub="⌘⌥U"
              onClick={() => useUI.getState().set({ inboxOpen: !useUI.getState().inboxOpen })}
            >
              <Icon name="inbox" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
            <InboxBadge />
          </div>
          <div
            ref={newRef}
            role="button"
            aria-label={t('lp.shell.new_page', 'New page')}
            aria-haspopup="dialog"
            aria-expanded="false"
            className="nc-btn icon-only nc-sb-header-btn"
            data-tooltip={t('lp.shell.new', 'New…')}
            onClick={() => newRef.current && openNewMenu(newRef.current)}
          >
            <Icon name="compose" size={20} style={{ color: 'var(--lp-text-secondary)' }} />
          </div>
        </div>
      </div>
      <div className="nc-sb-search-wrap">
        <div
          role="button"
          aria-label={t('lp.shell.search_or_ask_here', 'Search or ask here')}
          className="nc-sb-search"
          onClick={() => {
            useUI.getState().set({ searchOpen: true, searchMode: 'search' });
            if (window.innerWidth < MOBILE_BREAKPOINT) useUI.getState().setSidebarOpen(false);
          }}
        >
          <span className="nc-ellipsis">{t('lp.shell.search_or_ask_here', 'Search or ask here')}</span>
          <span style={{ flexShrink: 0, marginInlineStart: 'auto' }}>
            <div className="nc-sb-kbd"><span>⌘K</span></div>
          </span>
        </div>
      </div>
    </div>
  );
}

export function InboxBadge({ variant = 'red' }: { variant?: 'red' | 'gray' }) {
  const count = useUI((s) => (s as unknown as { inboxUnread?: number }).inboxUnread) ?? 0;
  if (!count) return null;
  return <div className={`nc-sb-badge ${variant}`}><span>{count > 99 ? '99+' : count}</span></div>;
}

// ---------------- tabs + body ----------------
function SidebarBody() {
  // developer mode adds the Developer section, a hidden / turned-off Meetings tab disappears
  const layout = useAiSidebarLayout(useShownSidebarLayout(useSidebarLayout()));
  const activeId = useActiveTabId(layout);
  const customizing = useSidebarMode((s) => s.customizing);
  const tab = layout.tabs.find((x) => x.id === activeId) ?? layout.tabs[0];

  // ⌃1…⌃6 switch sidebar tabs (tooltips "Chat ⌃2", "Meetings ⌃3"); ⌃⇧1…9 switch workspaces
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && /^Digit[1-9]$/.test(e.code)) {
        const list = userSpaces();
        const target = list[Number(e.code.slice(5)) - 1];
        if (target) {
          e.preventDefault();
          switchWorkspace(target.space.id);
        }
        return;
      }
      if (!e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= layout.tabs.length) {
        e.preventDefault();
        setActiveTabId(layout.tabs[n - 1].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [layout.tabs]);

  return (
    <>
      <SidebarTabs layout={layout} activeId={tab?.id ?? 'home'} customizing={customizing} />
      <div className="nc-sb-panel-wrap">
        <div role="tabpanel" className="nc-sb-tabpanel">
          <div className="lit-scroller vertical nc-sb-scroller">
            <div className="nc-sb-content">
              {tab && (customizing ? <CustomizeTabBody tab={tab} /> : <TabContent tab={tab} />)}
              {!customizing && (
                <div className="nc-sb-bottom">
                  <div role="button" aria-label={t('lp.shell.customize_sidebar', 'Customize sidebar')} className="nc-sb-row nc-sb-muted" onClick={() => useSidebarMode.getState().set(true)}>
                    <div className="nc-sb-row-inner">
                      <div className="nc-sb-row-icon"><Icon name="sliders" size={22} /></div>
                      <div className="nc-sb-row-label">{t('lp.shell.customize_sidebar', 'Customize sidebar')}</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        {customizing && <DoneButton />}
      </div>
    </>
  );
}

function SidebarTabs({ layout, activeId, customizing }: { layout: ReturnType<typeof useSidebarLayout>; activeId: string; customizing: boolean }) {
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <div className="nc-sb-tabs-wrap">
      <div className="nc-sb-tabs-row">
        <div role="tablist" aria-label={t('lp.shell.sidebar_navigation', 'Sidebar navigation')} className="nc-sb-tabs">
          {layout.tabs.map((tab, i) => {
            const selected = tab.id === activeId;
            const name = tabName(tab);
            const showLabel = selected && !layout.hideTabNames;
            return (
              <div
                key={tab.id}
                role="tab"
                aria-label={name}
                aria-selected={selected}
                className={`nc-sb-tab ${selected ? 'selected' : ''} ${showLabel ? 'labeled' : ''}`}
                data-tooltip={selected ? undefined : name}
                data-tooltip-sub={selected ? undefined : `⌃${i + 1}`}
                onClick={(e) => {
                  if (selected) openTabMenu(tab.id, e.currentTarget as HTMLElement, () => setRenaming(tab.id));
                  else setActiveTabId(tab.id);
                }}
              >
                <span className="nc-sb-tab-iconwrap">
                  <span className="nc-sb-tab-icon"><Icon name={TAB_ICON[tab.icon]} size={20} /></span>
                </span>
                <span className={`nc-sb-tab-label ${showLabel || renaming === tab.id ? 'open' : ''}`}>
                  <span className="nc-sb-tab-label-inner">
                    {renaming === tab.id ? (
                      <TabRename tab={tab} onDone={() => setRenaming(null)} />
                    ) : (
                      <span className="nc-sb-tab-text">{name}</span>
                    )}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        {customizing && (
          <div role="button" aria-label={t('lp.shell.add_tab', 'Add tab')} className="nc-sb-tab add" data-tooltip={t('lp.shell.add_tab', 'Add tab')} onClick={(e) => addTab(e.currentTarget as HTMLElement)}>
            <Icon name="plusSmall" size={16} />
          </div>
        )}
      </div>
    </div>
  );
}

function TabRename({ tab, onDone }: { tab: SidebarTab; onDone: () => void }) {
  const [v, setV] = useState(tabName(tab));
  const commit = () => {
    const name = v.trim();
    updateLayout((l) => {
      const tb = l.tabs.find((x) => x.id === tab.id);
      if (tb) tb.name = name || undefined;
    });
    onDone();
  };
  return (
    <input
      className="nc-sb-tab-rename"
      autoFocus
      value={v}
      placeholder={t('lp.shell.tab_name', 'Tab name')}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        else if (e.key === 'Escape') onDone();
      }}
      onBlur={commit}
    />
  );
}

function TabContent({ tab }: { tab: SidebarTab }) {
  return (
    <>
      {tab.shortcuts.length > 0 && (
        <div className="nc-sb-shortcuts">
          {tab.shortcuts.map((s) => <ShortcutRow key={s.id} shortcut={s} />)}
        </div>
      )}
      <div className="nc-sb-sections">
        {tab.sections.map((s) => <SectionView key={s.id} section={s} />)}
      </div>
    </>
  );
}

function runShortcut(s: SidebarShortcut) {
  const domain = spaceDomain(useSession.getState().spaceId);
  switch (s.type) {
    case 'new_chat':
      return navigate(`/${domain}/chat`);
    case 'library':
      return navigate(`/${domain}/library`);
    case 'new_meeting_note':
      return createMeetingNote();
    case 'new_page':
      // preview mode with the "Add to ▾" location dropdown (newPagePreview.tsx)
      return void runNewPageShortcut(s);
    case 'new_database':
      return createPrivateDatabase();
    case 'page':
      return s.pageId ? openPage(s.pageId) : undefined;
    case 'chat_thread':
      return navigate(`/${domain}/chat`);
    case 'settings':
      return useUI.getState().openSettings();
    case 'meeting_notes':
      return navigate(`/${domain}/library/meetings`);
    case 'skills':
      return navigate(`/${domain}/library/skills`);
    case 'my_tasks':
      return openMyTasks();
    case 'lit_calendar':
      return HELP_URL ? window.open(HELP_URL!, '_blank') : undefined;
    case 'marketplace':
      return navigate(`/${domain}/marketplace`);
  }
}

function ShortcutRow({ shortcut }: { shortcut: SidebarShortcut }) {
  const { route } = useLocation();
  const active =
    (shortcut.type === 'library' && route.name === 'library') ||
    (shortcut.type === 'new_chat' && route.name === 'chat') ||
    (shortcut.type === 'page' && route.name === 'page' && route.pageId === shortcut.pageId);
  const page = shortcut.type === 'page' && shortcut.pageId ? records.get('block', shortcut.pageId) : undefined;
  const label = page ? pageTitle(page) || t('lp.shell.untitled', 'Untitled') : shortcut.type === 'new_page' ? newPageShortcutLabel(shortcut) : shortcutLabel(shortcut.type);
  return (
    <div className="nc-sb-shortcut">
      <div className="nc-sb-shortcut-main">
        <div
          role="button"
          aria-label={label}
          className={`nc-sb-row ${active ? 'active' : ''}`}
          onClick={(e) => {
            if (page && (e.metaKey || e.ctrlKey)) window.open(pageUrl(page.id), '_blank');
            else runShortcut(shortcut);
          }}
        >
          <div className="nc-sb-row-inner">
            <div className="nc-sb-row-icon">
              {page ? <PageIcon block={page} size={20} /> : <Icon name={SHORTCUT_ICON[shortcut.type]} size={22} />}
            </div>
            <div className="nc-sb-row-label">{label}</div>
          </div>
        </div>
      </div>
      <div className="nc-sb-shortcut-actions">
        <div
          role="button"
          aria-label={t('lp.shell.open_the_shortcut_menu', 'Open the shortcut menu')}
          className="nc-sb-mini-btn lit-sidebar-page-menu"
          onClick={(e) => {
            e.stopPropagation();
            openShortcutMenu(shortcut.id, e.currentTarget as HTMLElement);
          }}
        >
          <Icon name="ellipsisSmall" size={16} />
        </div>
      </div>
    </div>
  );
}

// ---------------- footer ----------------
function SidebarFooter() {
  const space = useCurrentSpace();
  const user = useCurrentUser();
  const ref = useRef<HTMLDivElement>(null);
  const helpRef = useRef<HTMLDivElement>(null);
  const appsRef = useRef<HTMLDivElement>(null);
  const unseenRelease = useHasUnseenRelease();
  // "Help, contact, more…"; the badged label + blue dot only while a release is unseen
  const helpLabel = unseenRelease
    ? t('lp.shell.get_help_see_updates_reach_us', 'Get help, see updates, reach us, and more…')
    : t('lp.shell.help_contact_and_more', 'Help, contact, and more…');
  void user;
  return (
    <div className="nc-sb-footer">
      <div style={{ flex: '1 1 0%', minWidth: 0 }}>
        <div
          ref={ref}
          role="button"
          aria-haspopup="dialog"
          aria-expanded="false"
          className="lit-sidebar-switcher nc-sb-switcher"
          onClick={() => ref.current && openWorkspaceMenu(ref.current)}
        >
          <div className="nc-sb-switcher-inner">
            <div className="nc-sb-switcher-icon">
              <WorkspaceIcon space={space} size={22} />
            </div>
            <div className="nc-sb-switcher-name notranslate">
              <span className="nc-ellipsis">{space?.name ?? 'Workspace'}</span>
              <Icon name="arrowChevronSingleDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
          </div>
        </div>
      </div>
      <div style={{ position: 'relative', display: 'flex' }}>
        <div
          ref={helpRef}
          role="button"
          aria-label={helpLabel}
          aria-haspopup="dialog"
          aria-expanded="false"
          className="nc-btn icon-only nc-sb-footer-btn"
          data-tooltip={helpLabel}
          onClick={() => helpRef.current && openHelpMenu(helpRef.current)}
        >
          <Icon name="questionMarkCircle" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
        {unseenRelease && <div role="img" aria-label={t('lp.shell.new_6403', 'New')} className="nc-sb-new-dot" />}
      </div>
      <div
        ref={appsRef}
        role="button"
        aria-label={t('lp.shell.library_trash_and_more', 'Library, Trash, and more…')}
        aria-haspopup="menu"
        aria-expanded="false"
        className="nc-btn icon-only nc-sb-footer-btn"
        data-tooltip={t('lp.shell.library_trash_and_more', 'Library, Trash, and more…')}
        onClick={() => appsRef.current && openAppsMenu(appsRef.current)}
      >
        <Icon name="circleGrid2X2" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
      </div>
    </div>
  );
}

export function WorkspaceIcon({ space, size = 20 }: { space?: SpaceRecord; size?: number }) {
  const icon = space?.icon;
  if (icon && /^(https?:|\/files\/|data:)/.test(icon)) {
    return <img src={icon} alt="" style={{ width: size * 0.89, height: size * 0.89, borderRadius: 4, objectFit: 'cover', display: 'block' }} />;
  }
  if (icon) return <span style={{ fontSize: size * 0.8, lineHeight: 1, width: size, textAlign: 'center', fontFamily: '"Apple Color Emoji","Segoe UI Emoji",NotoColorEmoji,"Noto Color Emoji"' }}>{icon}</span>;
  return (
    <span className="nc-ws-letter" style={{ width: size, height: size, fontSize: size * 0.55 }}>
      {(space?.name ?? 'W').slice(0, 1).toUpperCase()}
    </span>
  );
}

export function useCurrentUserName() {
  const u = useCurrentUser();
  return u?.name || u?.email || '';
}

/** Legacy simple row (kept for other modules). */
export function SidebarRow({ icon, label, onClick, active }: { icon: React.ReactNode; label: React.ReactNode; onClick?: () => void; active?: boolean }) {
  return (
    <div role="button" className={`nc-sb-row ${active ? 'active' : ''}`} onClick={onClick}>
      <div className="nc-sb-row-inner">
        <div className="nc-sb-row-icon">{icon}</div>
        <div className="nc-sb-row-label">{label}</div>
      </div>
    </div>
  );
}

export { getActiveTabId, openOverlay };

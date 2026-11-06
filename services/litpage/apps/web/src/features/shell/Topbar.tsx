// Topbar (div.lit-topbar): breadcrumb + location pill, presence avatars, "Edited …", Share,
// copy link, favorite and the page ••• menu.
import { useRef } from 'react';
import type { BlockRecord, CollectionRecord, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { isArchivedRecord } from '@nc/shared/archive.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { useBlock, useCurrentSpaceView, useRecord, useTableVersion } from '../../lib/hooks.ts';
import { ancestorsOf } from '../../lib/blocks.ts';
import { navigate, openPage, pageUrl, spaceDomain, useLocation } from '../../lib/router.ts';
import { useUI } from '../../lib/store/ui.ts';
import { currentSpaceView, useSession } from '../../lib/store/session.ts';
import { Icon } from '../../components/Icon.tsx';
import { MenuIcon, openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { useOverlays } from '../../components/overlay.tsx';
import { aliasTargetId, isOutlineChild } from './sidebar/PageTree.tsx';
import { records } from '../../lib/store/records.ts';
import { api } from '../../lib/api.ts';
import { openMoveToDialog } from '../page/MoveTo.tsx';
import { PageIcon } from './PageIcon.tsx';
import { copyPageLink, pageTitle, toggleFavorite } from '../page/pageActions.ts';
import { openPageMenu } from '../page/PageMenu.tsx';
import { ShareButton } from '../page/ShareMenu.tsx';
import { TranslatePill } from '../page/TranslatePill.tsx';
import { PageLockIndicator } from '../page/PageLock.tsx';
import { ArchivedMark } from '../page/archive.tsx';
import { SuggestingPill, TopbarCommentsButton } from '../comments/comments.tsx';
import { TopbarFacepile } from '../presence/Facepile.tsx';
import { relativeEdited } from '../../lib/format.ts';
import { t } from './i18n.ts';
import { InboxBadge } from './Sidebar.tsx';
import { AgentCrumbs, AgentTopbarActions } from '../agents/AgentPage.tsx';

export function Topbar({ pageId, routeName }: { pageId: string | null; routeName: string }) {
  const typing = useUI((s) => s.typing);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  return (
    <div className="lit-topbar" style={{ opacity: typing ? 0 : 1 }}>
      <div className="nc-topbar-inner">
        {!sidebarOpen && <OpenSidebarButton />}
        <div className="lit-topbar-breadcrumb-region">{pageId && <Breadcrumb pageId={pageId} />}{!pageId && <RouteTitle name={routeName} />}</div>
        {pageId && <TopbarActions pageId={pageId} />}
        {!pageId && routeName === 'marketplace' && <MarketplaceActions />}
        {!pageId && routeName === 'agent' && <AgentTopbarActions />}
      </div>
    </div>
  );
}

/** Closed sidebar: "☰" button (24×24 @12,10 + inbox count) — hover shows the floating sidebar, click locks it open. */
function OpenSidebarButton() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div
      role="button"
      className="nc-btn icon-only secondary nc-topbar-sidebar-btn"
      aria-label={t('lp.shell.keep_the_sidebar_open', 'Keep the sidebar open')}
      // tooltip with the ⌘\ shortcut to the right of the button, top-aligned ([42,10])
      data-tooltip={t('lp.shell.keep_the_sidebar_open', 'Keep the sidebar open')}
      data-tooltip-sub="⌘\"
      data-tooltip-side="right-start"
      onMouseEnter={() => {
        if (timer.current) clearTimeout(timer.current);
        useUI.getState().set({ sidebarPeek: true });
      }}
      onMouseLeave={() => {
        timer.current = setTimeout(() => {
          if (!document.querySelector('.lit-sidebar:hover') && !document.querySelector('.lit-overlay-container .nc-overlay')) useUI.getState().set({ sidebarPeek: false });
        }, 300);
      }}
      onClick={() => useUI.getState().setSidebarOpen(true)}
    >
      <Icon name="menu" size={20} style={{ color: 'var(--lp-icon-secondary)' }} />
      <InboxBadge variant="gray" />
    </div>
  );
}

/** Non-page routes: Library / Chat / Meetings have an empty topbar; Marketplace shows "Marketplace / <tab>" + actions. */
function RouteTitle({ name }: { name: string }) {
  const { route } = useLocation();
  if (name === 'people') return <PeopleCrumbs userId={route.name === 'people' ? route.userId : undefined} />;
  if (name === 'agent') return <AgentCrumbs />;
  if (name === 'tasks') {
    return (
      <div className="nc-breadcrumb notranslate">
        <div role="button" className="nc-crumb">
          <Icon name="checkboxChecked" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
          <span className="nc-ellipsis" style={{ marginInlineStart: 6 }}>{t('lp.shell.my_tasks', 'My Tasks')}</span>
        </div>
      </div>
    );
  }
  if (name !== 'marketplace') return null;
  const tab = route.name === 'marketplace' ? route.tab : undefined;
  const tabLabel = tab ? MARKETPLACE_TABS[tab]?.() : undefined;
  const domain = spaceDomain(useSession.getState().spaceId);
  return (
    <div className="nc-breadcrumb notranslate">
      <div role="button" className="nc-crumb" onClick={() => navigate(`/${domain}/marketplace`)}>
        <Icon name="templates" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
        <span className="nc-ellipsis" style={{ marginInlineStart: 6 }}>{t('lp.shell.marketplace', 'Marketplace')}</span>
      </div>
      {tabLabel && (
        <>
          <span className="nc-crumb-sep">/</span>
          <div role="button" className="nc-crumb">
            <span className="nc-ellipsis">{tabLabel}</span>
          </div>
        </>
      )}
    </div>
  );
}

const MARKETPLACE_TABS: Record<string, () => string> = {
  templates: () => t('lp.shell.templates', 'Templates'),
  agents: () => t('lp.shell.agents', 'Agents'),
  consultants: () => t('lp.shell.consultants', 'Consultants'),
  skills: () => t('lp.shell.skills', 'Skills'),
  connections: () => t('lp.shell.connections', 'Connections'),
};

function MarketplaceActions() {
  return (
    <div className="lit-topbar-action-buttons">
      {[
        ['search', t('lp.shell.search', 'Search')],
        ['personCircle', t('lp.shell.my_profile', 'My profile')],
        ['checkmarkSquare', t('lp.shell.purchased', 'Purchased')],
      ].map(([icon, label]) => (
        <div key={label} role="button" className="nc-btn" style={{ fontWeight: 500, gap: 6 }} onClick={() => window.dispatchEvent(new CustomEvent('nc:marketplace-action', { detail: { action: icon } }))}>
          <Icon name={icon} size={18} style={{ color: 'var(--lp-icon-primary)' }} />
          {label}
        </div>
      ))}
    </div>
  );
}

function Breadcrumb({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  useTableVersion(['block', 'collection']);
  const sv = useCurrentSpaceView();
  if (!page) return null;
  const chain = ancestorsOf(pageId);
  const shown = chain.length > 3 ? [chain[0], null, ...chain.slice(-2)] : chain;
  const isPrivate = page.parent_table === 'space' ? !!sv?.private_pages?.includes(pageId) : chain[0] ? !!sv?.private_pages?.includes(chain[0].id) : false;
  return (
    <div className="shadow-cursor-breadcrumb nc-breadcrumb notranslate">
      {shown.map((b, i) => (
        <span key={b?.id ?? `gap-${i}`} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
          {b ? <Crumb block={b} /> : (
            <span
              role="button"
              aria-label={t('lp.shell.show_hidden_pages', 'Show hidden pages')}
              className="nc-crumb-gap"
              onClick={(e) => openHiddenCrumbs(e.currentTarget as HTMLElement, chain.slice(1, -2))}
            >...</span>
          )}
          <span className="nc-crumb-sep">/</span>
        </span>
      ))}
      <Crumb block={page} current />
      {/* 🗄 after an archived page's name; renders nothing otherwise */}
      <ArchivedMark pageId={pageId} />
      <PageLockIndicator pageId={pageId} />
      {isPrivate && (
        <div
          role="button"
          aria-label={t('lp.shell.page_location', 'Page location')}
          className="nc-crumb nc-crumb-location"
          onClick={(e) => openMoveToDialog([pageId], e.currentTarget as HTMLElement)}
        >
          {/* lockFill 16, "Private" in tertiary text with margin-inline 4/5, chevron 11 */}
          <Icon name="lockFill" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />
          <span style={{ color: 'var(--lp-text-tertiary)', margin: '0 5px 0 4px' }}>Private</span>
          <Icon name="arrowChevronSingleDownFill" size={11} style={{ color: 'var(--lp-icon-tertiary)' }} />
        </div>
      )}
    </div>
  );
}

function Crumb({ block, current }: { block: BlockRecord; current?: boolean }) {
  const title = pageTitle(block) || 'New page';
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div
      role="button"
      className="nc-crumb"
      data-crumb-id={block.id}
      // the current page's title goes back to the top of the page
      onClick={() => (current ? scrollPageToTop(block.id) : openPage(block.id))}
      onMouseEnter={(e) => {
        const el = e.currentTarget as HTMLElement;
        if (timer.current) clearTimeout(timer.current);
        // the breadcrumb browser opens after a short rest on the item (100ms)
        timer.current = setTimeout(() => openSiblingsPopover(el, block), 100);
      }}
      onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); }}
    >
      {block.format?.page_icon && <PageIcon block={block} size={18} />}
      <div className="nc-ellipsis" style={{ maxWidth: 240, marginInlineStart: block.format?.page_icon ? 6 : 0 }}>{title}</div>
    </div>
  );
}

function TopbarActions({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  const sv = useCurrentSpaceView();
  const moreRef = useRef<HTMLDivElement>(null);
  const editor = useRecord('lit_user', page?.last_edited_by_id) as any;
  if (!page) return null;
  const fav = !!sv?.bookmarked_pages?.includes(pageId);
  return (
    <div className="lit-topbar-action-buttons">
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <div className="nc-topbar-edited" data-tooltip={editor?.name ? `Edited by ${editor.name}` : undefined}>{relativeEdited(page.last_edited_time)}</div>
        <TranslatePill pageId={pageId} />
        <TopbarFacepile pageId={pageId} />
        <SuggestingPill pageId={pageId} />
        <ShareButton pageId={pageId} />
        <div role="button" aria-label="Copy link" className="nc-topbar-icon-btn" data-tooltip="Copy link" onClick={() => copyPageLink(pageId)}>
          <Icon name="link" size={18} style={{ color: 'var(--lp-icon-primary)' }} />
        </div>
        <TopbarCommentsButton pageId={pageId} />
        <div role="button" aria-label="Favorite" className="nc-topbar-icon-btn lit-topbar-favorite-button" data-tooltip={fav ? 'Remove from saved pages' : 'Save this page'} onClick={() => toggleFavorite(pageId)}>
          <Icon name="star" size={18} style={{ color: fav ? '#78350f' : 'var(--lp-icon-primary)', fill: fav ? '#78350f' : 'none' }} />
        </div>
        <div ref={moreRef} role="button" aria-label="Actions" className="nc-topbar-icon-btn lit-topbar-more-button" data-tooltip="Style, export, and more…" onClick={() => moreRef.current && openPageMenu(pageId, moreRef.current)}>
          <Icon name="ellipsis" size={22} style={{ color: 'var(--lp-icon-primary)' }} />
        </div>
      </div>
    </div>
  );
}

export { pageUrl };

/** People Directory / profile breadcrumb: "People Directory / <name>". */
function PeopleCrumbs({ userId }: { userId?: string }) {
  const u = useRecord<UserRecord>('lit_user', userId);
  const domain = spaceDomain(useSession.getState().spaceId);
  return (
    <div className="nc-breadcrumb notranslate">
      <div role="button" className="nc-crumb" onClick={() => navigate(`/${domain}/people`)}>
        <Icon name="users" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
        <span className="nc-ellipsis" style={{ marginInlineStart: 6 }}>{t('lp.shell.people_directory', 'People Directory')}</span>
      </div>
      {userId && (
        <>
          <span className="nc-crumb-sep">/</span>
          <div role="button" className="nc-crumb"><span className="nc-ellipsis">{u?.name || u?.email || ''}</span></div>
        </>
      )}
    </div>
  );
}

// ---------------- breadcrumb: "..." hidden pages and sibling pages on hover ----------------
function crumbItem(b: BlockRecord): MenuItemDef {
  return {
    label: pageTitle(b) || t('lp.shell.untitled', 'Untitled'),
    icon: <PageIcon block={b} size={18} />,
    onSelect: () => openPage(b.id),
  };
}

function openHiddenCrumbs(anchor: HTMLElement, hidden: BlockRecord[]) {
  if (!hidden.length) return;
  openMenu(anchor, { width: 240, sections: [{ items: hidden.map(crumbItem) }] }, { placement: 'bottom-start' });
}

/** Breadcrumb › the current page's title: smooth-scroll the page back to its top. */
export function scrollPageToTop(pageId: string) {
  const el = document.querySelector<HTMLElement>(`.lit-frame .nc-page-scroller[data-page-id="${pageId}"]`) ?? document.querySelector<HTMLElement>('.lit-frame .nc-page-scroller');
  el?.scrollTo({ top: 0, behavior: 'smooth' });
}

type SiblingSection = { ids: string[]; label?: 'private' | 'shared' | { collectionName: string }; databaseId?: string };

const readablePage = (id: string) => {
  const b = records.get<BlockRecord>('block', id);
  return !!b && b.alive !== false && !isArchivedRecord(b) && (b.type === 'page' || b.type === 'collection_view_page');
};

/** Pages next to `block`: the outline children of its parent page (sub-pages, databases, linked pages), the
 *  teamspace's top-level pages, the other rows of its database ("Other pages in {name}"), or the Private / Shared
 *  pages of the sidebar for top-level pages. */
function siblingsOf(block: BlockRecord): SiblingSection {
  if (block.parent_table === 'block') {
    const parent = records.get<BlockRecord>('block', block.parent_id);
    const ids: string[] = [];
    for (const id of parent?.content ?? []) {
      const c = records.get<BlockRecord>('block', id);
      if (!isOutlineChild(c) || c!.type === 'collection_view') continue;
      const pid = aliasTargetId(c) ?? id;
      if (!ids.includes(pid)) ids.push(pid);
    }
    return { ids };
  }
  if (block.parent_table === 'team') return { ids: (records.get<TeamRecord>('team', block.parent_id)?.team_pages ?? []).filter(readablePage) };
  if (block.parent_table === 'collection') {
    const col = records.get<CollectionRecord>('collection', block.parent_id);
    const ids = records.all<BlockRecord>('block')
      .filter((b) => b.parent_table === 'collection' && b.parent_id === block.parent_id && b.alive !== false && !b.is_template && !isArchivedRecord(b))
      .sort((a, b) => (a.created_time ?? 0) - (b.created_time ?? 0))
      .map((b) => b.id);
    const name = toPlainText(col?.name) || t('lp.shell.new_database', 'New database');
    return { ids, label: { collectionName: name }, databaseId: col?.parent_id };
  }
  if (block.parent_table === 'space') {
    const sv = currentSpaceView() as { private_pages?: string[] } | undefined;
    if (sv?.private_pages?.includes(block.id)) return { ids: sv.private_pages.filter(readablePage), label: 'private' };
    const space = records.get<SpaceRecord>('space', block.space_id);
    if (space?.pages?.includes(block.id)) return { ids: space.pages.filter(readablePage) };
    return { ids: [block.id], label: 'shared' };
  }
  return { ids: [] };
}

function sectionLabel(label: SiblingSection['label']): string | undefined {
  if (!label) return undefined;
  if (label === 'private') return t('lp.shell.private', 'Private');
  if (label === 'shared') return t('lp.shell.shared', 'Shared');
  return t('lp.shell.more_pages_in', 'More pages in {name}', { name: label.collectionName });
}

/** Shows 5 pages (the hovered one among them) and "{n} more" when more than one would be hidden. */
const VISIBLE_SIBLINGS = 5;

let siblings: { close: () => void; anchor: HTMLElement; overlayId: number; stop: () => void } | null = null;

function closeSiblings() {
  const s = siblings;
  siblings = null;
  s?.stop();
  s?.close();
}

function openSiblingsPopover(anchor: HTMLElement, block: BlockRecord, showAll = false) {
  if (!anchor.isConnected || (!showAll && !anchor.matches(':hover'))) return;
  if (siblings?.anchor === anchor && !showAll) return;
  const show = () => {
    if (!anchor.isConnected || (!showAll && !anchor.matches(':hover'))) return;
    const sec = siblingsOf(block);
    const all = sec.ids.filter((id) => records.get<BlockRecord>('block', id));
    if (!all.includes(block.id)) all.unshift(block.id);
    if (all.length < 2 && !sec.label) return;
    const hidden = all.length > VISIBLE_SIBLINGS + 1 && !showAll;
    let visible = hidden ? all.slice(0, VISIBLE_SIBLINGS) : all;
    if (hidden && !visible.includes(block.id)) visible = [block.id, ...all.filter((id) => id !== block.id).slice(0, VISIBLE_SIBLINGS - 1)];
    const items: MenuItemDef[] = visible.map((id) => {
      const b = records.get<BlockRecord>('block', id)!;
      return { ...crumbItem(b), id: `crumb:${id}`, render: id === block.id ? () => <CurrentCrumbRow block={b} /> : undefined, onSelect: () => { closeSiblings(); if (id !== block.id) openPage(id); } };
    });
    if (hidden) {
      items.push({
        id: 'crumb:more', label: <span className="nc-crumb-more">{t('lp.shell.more', '{extraPages} more', { extraPages: all.length - VISIBLE_SIBLINGS })}</span>,
        onSelect: () => { closeSiblings(); openSiblingsPopover(anchor, block, true); return false; },
      });
    }
    if (sec.databaseId) {
      const dbId = sec.databaseId;
      items.push({ id: 'crumb:db', label: <span className="nc-crumb-more">{t('lp.shell.more_pages', 'More pages')}</span>, onSelect: () => { closeSiblings(); openPage(dbId); } });
    }
    closeSiblings();
    const title = sectionLabel(sec.label);
    const close = openMenu(anchor, { width: 240, className: 'nc-crumb-popup', initialActive: -1, sections: [{ title, items }] }, {
      placement: 'bottom-start', backdrop: 'none', onClose: () => { if (siblings?.anchor === anchor) { siblings.stop(); siblings = null; } },
    });
    const stack = useOverlays.getState().stack;
    const overlayId = stack[stack.length - 1]?.id ?? 0;
    // close 200ms after the pointer leaves both the crumb and the popup
    let timer: ReturnType<typeof setTimeout> | null = null;
    const inside = (el: Element | null, x: number, y: number) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 6 && y <= r.bottom + 6;
    };
    const onMove = (e: PointerEvent) => {
      const pop = document.querySelector(`[data-overlay-id="${overlayId}"]`);
      if (inside(anchor, e.clientX, e.clientY) || inside(pop, e.clientX, e.clientY)) {
        if (timer) { clearTimeout(timer); timer = null; }
      } else if (!timer) timer = setTimeout(() => { if (siblings?.overlayId === overlayId) closeSiblings(); }, 200);
    };
    document.addEventListener('pointermove', onMove);
    siblings = { close, anchor, overlayId, stop: () => { document.removeEventListener('pointermove', onMove); if (timer) clearTimeout(timer); } };
  };
  if (block.parent_table === 'block') void api('getSidebarChildren', { blockIds: [block.parent_id] }).then((r) => { records.mergeRecordMap(r.recordMap); show(); }).catch(show);
  else if (block.parent_table === 'collection') void api('loadCollectionRows', { collectionId: block.parent_id, limit: 50 }).then((r) => { records.mergeRecordMap(r.recordMap); show(); }).catch(show);
  else show();
}

/** The hovered page in its own list: highlighted as the current item. */
function CurrentCrumbRow({ block }: { block: BlockRecord }) {
  return (
    <div className="nc-menu-item-inner nc-mi nc-crumb-current">
      <MenuIcon icon={<PageIcon block={block} size={18} />} />
      <div className="nc-menu-label"><div className="nc-ellipsis">{pageTitle(block) || t('lp.shell.untitled', 'Untitled')}</div></div>
    </div>
  );
}

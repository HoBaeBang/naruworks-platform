// Side peek / center peek (?p=<id>&pm=s|c). Peek topbar:
// Close (»), Open in full page, Switch peek mode (Side peek / Center peek / Full page / New tab), and on the
// right Share + page ••• menu. The chosen mode becomes the source view's "Open pages in" (rememberPeekMode).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { useCurrentSpaceView, useTableVersion } from '../../lib/hooks.ts';
import { copyPageLink, toggleFavorite } from './pageActions.ts';
import { closePeek, openPage, openPeek, pageUrl } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { records } from '../../lib/store/records.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { t } from '../shell/i18n.ts';
import { PageView } from './PageView.tsx';
import { usePageLoader } from './usePageLoader.ts';
import { ShareButton } from './ShareMenu.tsx';
import { openPageMenu } from './PageMenu.tsx';
import { peekOrder, peekShortcut, peekShortcutDirection, peekSourceViewId } from '../database/peekNav.ts';
import { databaseAccessOf } from '../database/access.ts';
import { updateViewFormat } from '../database/actions.ts';
// new pages from the sidebar's New page shortcut open here in preview mode with "Add to ▾"
import { PreviewAddTo } from '../shell/sidebar/newPagePreview.tsx';

type Mode = 'side_peek' | 'center_peek' | 'full_page';

/**
 * "Switch peek mode" on a database page: the choice becomes the source view's "Open pages in" (View
 * settings › Layout, collection_view.format.collection_peek_mode) when this person may change that view, so the next
 * pages of that view open the same way. Pages that weren't opened from a view keep no preference.
 */
function rememberPeekMode(pageId: string, mode: Mode) {
  const viewId = peekSourceViewId(pageId);
  const view = viewId ? records.get<CollectionViewRecord>('collection_view', viewId) : undefined;
  if (!view || (view.format as Record<string, unknown> | undefined)?.collection_peek_mode === mode) return;
  if (!databaseAccessOf(records.get<BlockRecord>('block', view.parent_id), records.role('block', view.parent_id)).canEditStructure) return;
  updateViewFormat(view.id, { collection_peek_mode: mode }, 'setOpenPagesIn');
}

export function PeekPanel({ pageId, mode }: { pageId: string; mode: 'side_peek' | 'center_peek' }) {
  const state = usePageLoader(pageId);
  const moreRef = useRef<HTMLDivElement>(null);
  const nav = usePeekNav(pageId, mode);
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.lit-overlay-container .nc-overlay') && !(document.activeElement as HTMLElement)?.isContentEditable) closePeek();
      // peekUp / peekDown: Ctrl+Shift+K / Ctrl+Shift+J on macOS, Alt+K / Alt+J elsewhere
      const dir = peekShortcutDirection(e);
      if (dir && nav.go(dir)) e.preventDefault();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [nav]);
  const switchMode = (anchor: HTMLElement) => openMenu(anchor, {
    width: 220,
    sections: [
      { items: [
        { label: t('lp.page.side_preview', 'Side preview'), icon: 'peekSide', checked: mode === 'side_peek', onSelect: () => { rememberPeekMode(pageId, 'side_peek'); openPeek(pageId, 'side_peek'); } },
        { label: t('lp.page.center_preview', 'Center preview'), icon: 'peekCenter', checked: mode === 'center_peek', onSelect: () => { rememberPeekMode(pageId, 'center_peek'); openPeek(pageId, 'center_peek'); } },
        { label: t('lp.page.full_page', 'Full page'), icon: 'peekFull', onSelect: () => { rememberPeekMode(pageId, 'full_page'); openPage(pageId); } },
      ] },
      { items: [{ label: t('lp.page.new_tab', 'New tab'), icon: 'tabs', onSelect: () => window.open(pageUrl(pageId), '_blank') }] },
    ],
  }, { placement: 'bottom-start' });
  const toolbar = (
    <div className="nc-peek-toolbar lit-peek-topbar">
      <div role="button" className="nc-btn icon-only" aria-label={t('lp.page.close', 'Close')} data-tooltip={t('lp.page.close', 'Close')} data-tooltip-sub="Esc" onClick={closePeek}>
        <Icon name="arrowChevronDoubleRight" size={18} />
      </div>
      <div role="button" className="nc-btn icon-only" aria-label={t('lp.page.open_as_a_full_page', 'Open as a full page')} data-tooltip={t('lp.page.open_as_a_full_page', 'Open as a full page')} onClick={() => openPage(pageId)}>
        <Icon name="openAsPage" size={16} />
      </div>
      <div role="button" className="nc-btn icon-only" aria-label={t('lp.page.change_preview_mode', 'Change preview mode')} data-tooltip={t('lp.page.change_preview_mode', 'Change preview mode')} onClick={(e) => switchMode(e.currentTarget)}>
        <Icon name={mode === 'side_peek' ? 'peekSide' : 'peekCenter'} size={16} />
      </div>
      {nav.rows && <PeekNavButtons nav={nav} className="nc-btn icon-only" size={18} />}
      <PreviewAddTo pageId={pageId} />
      <div className="spacer" />
      <ShareButton pageId={pageId} />
      <div ref={moreRef} role="button" className="nc-btn icon-only" aria-label="Actions" data-tooltip="Style, export, and more…" onClick={() => moreRef.current && openPageMenu(pageId, moreRef.current)}>
        <Icon name="ellipsis" size={20} />
      </div>
    </div>
  );
  if (mode === 'center_peek') {
    return (
      <div className="nc-center-peek-layer" onMouseDown={(e) => { if (e.target === e.currentTarget) closePeek(); }}>
        <div className="nc-center-peek">{toolbar}<PageView pageId={pageId} state={state} inPeek /></div>
      </div>
    );
  }
  return (
    <SidePeekFrame>
      <SidePeekHeader pageId={pageId} mode={mode} onSwitch={switchMode} nav={nav} />
      <PageView pageId={pageId} state={state} inPeek />
    </SidePeekFrame>
  );
}

const PEEK_WIDTH_KEY = 'nc:sidePeekWidth';
const readPeekWidth = () => { try { const v = Number(localStorage.getItem(PEEK_WIDTH_KEY)); return v > 0 ? v : null; } catch { return null; } };

/** The docked side peek with a resize handle on its left edge (role=separator "Resize with the arrow keys",
 *  12px wide over the edge). Without a stored width it takes half the window. */
function SidePeekFrame({ children }: { children: ReactNode }) {
  const [width, setWidth] = useState<number | null>(readPeekWidth);
  const clamp = (w: number) => Math.round(Math.min(Math.max(w, 380), Math.max(380, window.innerWidth - 360)));
  const save = (w: number) => { setWidth(w); try { localStorage.setItem(PEEK_WIDTH_KEY, String(w)); } catch { /* storage unavailable */ } };
  const frameRef = useRef<HTMLDivElement>(null);
  const current = () => frameRef.current?.getBoundingClientRect().width ?? window.innerWidth / 2;
  return (
    <div ref={frameRef} className="nc-side-peek lit-peek-renderer" role="region" aria-label="Side Peek" style={width ? { flexBasis: width } : undefined}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize with the arrow keys"
        tabIndex={0}
        className="nc-peek-resize"
        onPointerDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = current();
          const move = (ev: PointerEvent) => setWidth(clamp(startW + (startX - ev.clientX)));
          const up = (ev: PointerEvent) => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); save(clamp(startW + (startX - ev.clientX))); };
          addEventListener('pointermove', move);
          addEventListener('pointerup', up);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          save(clamp(current() + (e.key === 'ArrowLeft' ? 20 : -20)));
        }}
      />
      {children}
    </div>
  );
}

/** Side peek header (.peek-top-hover-area): Close (») and Open in full
 *  page; the peek-mode switch and previous/next page show on hover; Share, Copy link, Favorite and Actions right. */
function SidePeekHeader({ pageId, mode, onSwitch, nav }: { pageId: string; mode: Mode; onSwitch: (anchor: HTMLElement) => void; nav: PeekNav }) {
  const moreRef = useRef<HTMLDivElement>(null);
  const sv = useCurrentSpaceView();
  const fav = !!sv?.bookmarked_pages?.includes(pageId);
  return (
    <div className="nc-peek-toolbar lit-peek-topbar peek-top-hover-area">
      <div className="nc-peek-left">
        <div role="button" className="nc-peek-btn lit-peek-close" aria-label={t('lp.page.close', 'Close')} data-tooltip={t('lp.page.close', 'Close')} data-tooltip-sub="Esc" onClick={closePeek}>
          <Icon name="arrowChevronDoubleRight" size={20} />
        </div>
        <a role="link" className="nc-peek-btn" aria-label={t('lp.page.open_as_a_full_page', 'Open as a full page')} data-tooltip={t('lp.page.open_as_a_full_page', 'Open as a full page')} href={pageUrl(pageId)} onClick={(e) => { e.preventDefault(); openPage(pageId); }}>
          <Icon name="arrowExpandDiagonalSmall" size={16} />
        </a>
        <div className="nc-peek-hover">
          <div className="nc-peek-sep" />
          <div role="button" className="nc-peek-btn" aria-label={t('lp.page.change_preview_mode', 'Change preview mode')} data-tooltip={t('lp.page.change_preview_mode', 'Change preview mode')} onClick={(e) => onSwitch(e.currentTarget)}>
            <Icon name={mode === 'side_peek' ? 'peekSide' : 'peekCenter'} size={20} />
          </div>
        </div>
        {nav.rows && (
          <div className="nc-peek-hover">
            <div className="nc-peek-sep" />
            <PeekNavButtons nav={nav} className="nc-peek-btn" size={20} />
          </div>
        )}
        <PreviewAddTo pageId={pageId} />
      </div>
      <div className="spacer" />
      {/* the frame's topbar actions, re-hosted: Share / Copy link / Favorite / Actions */}
      <div className="nc-peek-right lit-topbar">
        <ShareButton pageId={pageId} />
        <div role="button" aria-label="Copy link" className="nc-topbar-icon-btn" data-tooltip="Copy link" onClick={() => copyPageLink(pageId)}>
          <Icon name="dbLink" size={20} style={{ color: 'var(--lp-icon-primary)' }} />
        </div>
        <div role="button" aria-label="Favorite" className="nc-topbar-icon-btn lit-topbar-favorite-button" data-tooltip={fav ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavorite(pageId)}>
          <Icon name="star" size={18} style={{ color: fav ? '#78350f' : 'var(--lp-icon-primary)', fill: fav ? '#78350f' : 'none' }} />
        </div>
        <div ref={moreRef} role="button" aria-label="Actions" className="nc-topbar-icon-btn lit-topbar-more-button" data-tooltip="Style, export, and more…" onClick={() => moreRef.current && openPageMenu(pageId, moreRef.current)}>
          <Icon name="ellipsis" size={22} style={{ color: 'var(--lp-icon-primary)' }} />
        </div>
      </div>
    </div>
  );
}

interface PeekNav {
  /** rows of the database view the page was opened from (null: not a database page) */
  rows: string[] | null;
  at: number;
  go: (dir: -1 | 1) => boolean;
}

/** Previous / next page of a database row peek: the source view's order (database/peekNav.ts). */
function usePeekNav(pageId: string, mode: 'side_peek' | 'center_peek'): PeekNav {
  const v = useTableVersion(['block', 'collection', 'collection_view']);
  return useMemo(() => {
    const ids = peekOrder(pageId);
    const at = ids.indexOf(pageId);
    return {
      rows: ids.length ? ids : null,
      at,
      go: (dir: -1 | 1) => {
        const next = at >= 0 ? ids[at + dir] : undefined;
        if (!next) return false;
        openPeek(next, mode);
        return true;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, mode, v]);
}

/** ↑ "Previous page" / ↓ "Next page" with the shortcut on a second tooltip line. */
function PeekNavButtons({ nav, className, size }: { nav: PeekNav; className: string; size: number }) {
  const rows = nav.rows ?? [];
  const prev = nav.at > 0;
  const next = nav.at >= 0 && nav.at < rows.length - 1;
  return (
    <>
      <div role="button" aria-disabled={!prev || undefined} className={`${className} nc-peek-nav-up ${prev ? '' : 'disabled'}`} aria-label={t('lp.page.previous_page', 'Previous page')} data-tooltip={t('lp.page.previous_page', 'Previous page')} data-tooltip-sub={peekShortcut(-1)} onClick={() => nav.go(-1)}>
        <Icon name="chevronUp" size={size} />
      </div>
      <div role="button" aria-disabled={!next || undefined} className={`${className} nc-peek-nav-down ${next ? '' : 'disabled'}`} aria-label={t('lp.page.next_page', 'Next page')} data-tooltip={t('lp.page.next_page', 'Next page')} data-tooltip-sub={peekShortcut(1)} onClick={() => nav.go(1)}>
        <Icon name="chevronDown" size={size} />
      </div>
    </>
  );
}

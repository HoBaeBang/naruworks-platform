// Link UI:
// - ⌘K / toolbar link: 330px dialog centered under the selection: "Paste a link or find pages" + Recents / pages,
// a typed URL shows one option "<url> · Web page link". The selected text keeps a gray "pending" highlight.
// - mouse hover (400ms): pill under the link — globe · URL · Copy link · Edit (caret-driven link menu, /074,
// is release-notes-only and not reproduced)
// - Edit: "Page or URL" + "Link title" inputs and "Remove link".
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { addAnnotation, annotationValue, deleteRange, insertRich, length, removeAnnotation, slice, annotationsOf, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import type { BlockRecord } from '@nc/shared/records.ts';
import { safeHref } from '@nc/shared/url.ts';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { MenuSectionTitle } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { pageUrl, parseLocation, openPage } from '../../../lib/router.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { commitText } from '../textHandlers.ts';
import { rectsForRange } from '../richTextDom.ts';
import { useEditor } from '../editorState.ts';
import { valueOf, restoreRange, type TextRange } from './format.ts';
import { breadcrumbOf, pageOrNull, usePageSearch } from './pageSearch.ts';
import { freezeTextMenu, useTextMenu } from './TextActionMenu.tsx';

/** Text range shown with a gray highlight while a popup acts on it. */
export const useDecor = create<{ pending: TextRange | null }>(() => ({ pending: null }));

export function looksLikeUrl(s: string): boolean {
  const t = s.trim();
  if (!t || /\s/.test(t)) return false;
  return /^(https?:\/\/|mailto:|tel:)/i.test(t) || /^www\./i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/\S*)?$/i.test(t);
}

export function normalizeUrl(s: string): string {
  const t = s.trim();
  if (!t) return t;
  if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('/') || t.startsWith('#')) return t;
  return `https://${t}`;
}

/** Page id for an in-app link (e.g. "/acme/My-page-<id>"), or null. */
export function internalPageId(href: string): string | null {
  try {
    const u = new URL(href, location.origin);
    if (u.origin !== location.origin) return null;
    const loc = parseLocation(u.pathname, u.search, u.hash);
    return loc.route.name === 'page' ? loc.route.pageId : null;
  } catch {
    return null;
  }
}

/** Follow a link token: in-app pages navigate, everything else opens in a new tab. */
export function followLink(href: string, newTab = false) {
  const pid = internalPageId(href);
  if (pid && !newTab) openPage(pid);
  else {
    // link targets are user data: never open javascript:/data: URLs
    const safe = safeHref(href);
    if (safe) window.open(safe, '_blank', 'noopener,noreferrer');
  }
}

function rangeRect(r: TextRange): DOMRect {
  const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${r.blockId}"][data-property="${r.property}"]`);
  if (!leaf) return new DOMRect(window.innerWidth / 2, 120, 0, 0);
  const rects = rectsForRange(leaf, r.start, r.end).filter((x) => x.width > 0);
  if (!rects.length) return leaf.getBoundingClientRect();
  const left = Math.min(...rects.map((x) => x.left));
  const right = Math.max(...rects.map((x) => x.right));
  const top = Math.min(...rects.map((x) => x.top));
  const bottom = Math.max(...rects.map((x) => x.bottom));
  return new DOMRect(left, top, right - left, bottom - top);
}

function setLink(r: TextRange, href: string | null, action = 'LinkMenu.handleLinkSelection') {
  let next = removeAnnotation(valueOf(r.blockId, r.property), r.start, r.end, 'a');
  if (href) next = addAnnotation(next, r.start, r.end, ['a', href]);
  commitText(r.blockId, r.property, next, r.end, { coalesce: false, action });
}

// ------------------------------------------------------------------------------------------------
// ⌘K popup
export function openLinkPopup(r: TextRange, opts?: { onClose?: () => void }) {
  const existing = annotationValue(valueOf(r.blockId, r.property), r.start, r.end, 'a') as string | undefined;
  if (existing) {
    openLinkEdit(r, existing, opts);
    return;
  }
  useDecor.setState({ pending: r });
  // Keep the selection card above the selection while the popup sits below it, and keep the page
  // scroller is locked (no thumb) — link-popup
  const tm = useTextMenu.getState();
  const showing = !!tm.range && tm.range.blockId === r.blockId && tm.range.property === r.property && tm.range.start === r.start && tm.range.end === r.end;
  const release = showing ? freezeTextMenu() : null;
  if (showing) useTextMenu.setState({ above: true });
  document.body.classList.add('nc-scroll-locked');
  openOverlay((close) => <LinkPopup r={r} close={close} />, {
    anchor: rangeRect(r),
    placement: 'bottom',
    offset: 8,
    onClose: () => {
      useDecor.setState({ pending: null });
      document.body.classList.remove('nc-scroll-locked');
      if (showing) useTextMenu.setState({ above: false });
      release?.();
      opts?.onClose?.();
    },
  });
}

interface Option {
  key: string;
  icon: React.ReactNode;
  title: string;
  sub?: string;
  run: () => void;
}

function LinkPopup({ r, close }: { r: TextRange; close: () => void }) {
  const [q, setQ] = useState('');
  const isUrl = looksLikeUrl(q);
  const hits = usePageSearch(isUrl ? '' : q, { limit: q ? 8 : 5 });
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [q]);
  const done = (href: string) => {
    close();
    setLink(r, href);
    restoreRange({ ...r, start: r.end, end: r.end });
  };
  const options: Option[] = useMemo(() => {
    const out: Option[] = [];
    if (isUrl) out.push({ key: 'url', icon: <Icon name="globe" size={20} />, title: q.trim(), sub: 'Web page link', run: () => done(normalizeUrl(q)) });
    if (!isUrl) {
      for (const id of hits.ids) {
        const b = pageOrNull(id) as BlockRecord | undefined;
        out.push({ key: id, icon: <PageIcon block={b} size={20} />, title: pageTitle(b) || 'New page', sub: breadcrumbOf(id) || undefined, run: () => done(pageUrl(id)) });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, isUrl, hits.ids.join(',')]);
  return (
    <PopoverSurface width={330} maxHeight="70vh" className="nc-link-popup">
      {/* Section padding 4, row padding 4/8, and margin-top 6 place the 28px field 14px from the top and 12px from the sides; “Recents” is the next 4px-padded section. */}
      <div style={{ padding: '14px 12px 8px' }}>
        <div className="nc-link-input focused">
          <input
            autoFocus
            placeholder="Paste a link or find pages"
            value={q}
            role="combobox"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                const o = options[active];
                if (o) o.run();
                else if (q.trim()) done(normalizeUrl(q));
              }
            }}
          />
        </div>
      </div>
      {options.length > 0 && (
        <div className="lit-scroller vertical nc-menu-scroll" role="listbox">
          <div className="nc-menu-section">
            {!q && <MenuSectionTitle>Recents</MenuSectionTitle>}
            {q && !isUrl && <MenuSectionTitle>Page link</MenuSectionTitle>}
            {options.map((o, i) => (
              <div key={o.key} role="option" aria-selected={i === active} className={`nc-menu-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={o.run}>
                <div className={`nc-menu-item-inner nc-mi${o.sub ? ' has-desc' : ''}`}>
                  <div className="nc-menu-icon">{o.icon}</div>
                  <div className="nc-menu-label">
                    <div className="nc-ellipsis">{o.title}</div>
                    {o.sub && <div className="nc-menu-desc nc-ellipsis">{o.sub}</div>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PopoverSurface>
  );
}

// ------------------------------------------------------------------------------------------------
// Edit popup ("Page or URL" / "Link title" / Remove link)

/** Full extent of the link run(s) around [start,end) carrying the same href. */
export function linkExtent(value: RichText, pos: number, href?: string): { start: number; end: number; href: string } | null {
  let p = 0;
  const runs: { s: number; e: number; href?: string }[] = [];
  for (const d of value) {
    const a = annotationsOf(d).find((x) => x[0] === 'a') as Extract<Annotation, ['a', string]> | undefined;
    runs.push({ s: p, e: p + d[0].length, href: a?.[1] });
    p += d[0].length;
  }
  const i = runs.findIndex((x) => x.href && pos >= x.s && pos < x.e && (!href || x.href === href));
  const j = i >= 0 ? i : runs.findIndex((x) => x.href && pos > x.s && pos <= x.e && (!href || x.href === href));
  if (j < 0) return null;
  const h = runs[j].href!;
  let s = j;
  let e = j;
  while (s > 0 && runs[s - 1].href === h) s--;
  while (e < runs.length - 1 && runs[e + 1].href === h) e++;
  return { start: runs[s].s, end: runs[e].e, href: h };
}

export function openLinkEdit(r: TextRange, href: string, opts?: { onClose?: () => void }) {
  useDecor.setState({ pending: r });
  openOverlay((close) => <LinkEdit r={r} href={href} close={close} />, {
    anchor: rangeRect(r),
    placement: 'bottom',
    offset: 8,
    onClose: () => {
      useDecor.setState({ pending: null });
      opts?.onClose?.();
    },
  });
}

function LinkEdit({ r, href, close }: { r: TextRange; href: string; close: () => void }) {
  const value = valueOf(r.blockId, r.property);
  const initialTitle = slice(value, r.start, r.end).map((d) => d[0]).join('');
  const [url, setUrl] = useState(href);
  const [title, setTitle] = useState(initialTitle);
  const titleRef = useRef<HTMLInputElement>(null);
  const urlIsPage = !looksLikeUrl(url) && url.trim() !== '' && !url.startsWith('/');
  const hits = usePageSearch(urlIsPage ? url : '', { limit: 6 });
  useEffect(() => {
    titleRef.current?.focus();
    titleRef.current?.select();
  }, []);
  const apply = (nextHref?: string) => {
    const h = normalizeUrl(nextHref ?? url);
    const t = title;
    close();
    const cur = valueOf(r.blockId, r.property);
    let next = cur;
    let end = r.end;
    if (t && t !== initialTitle) {
      const anns = (slice(cur, r.start, r.end)[0]?.[1] ?? []).filter((a) => a[0] !== 'a');
      next = deleteRange(next, r.start, r.end);
      next = insertRich(next, r.start, [anns.length ? [t, anns] : [t]]);
      end = r.start + t.length;
    }
    next = removeAnnotation(next, r.start, end, 'a');
    if (h) next = addAnnotation(next, r.start, end, ['a', h]);
    commitText(r.blockId, r.property, next, end, { coalesce: false, action: 'LinkMenu.handleLinkEdit' });
    restoreRange({ ...r, start: end, end });
  };
  const remove = () => {
    close();
    setLink(r, null, 'LinkMenu.handleRemoveLink');
    restoreRange(r);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      apply();
    }
  };
  return (
    <PopoverSurface width={330} className="nc-link-edit">
      <div className="nc-link-edit-section">
        <div className="nc-menu-section-title" style={{ margin: '6px 0 4px', padding: 0 }}>Page or URL</div>
        <div className="nc-link-input">
          <input placeholder="Edit link or find pages" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={onKey} />
        </div>
        {urlIsPage && hits.ids.length > 0 && (
          <div className="nc-link-edit-results">
            {hits.ids.map((id) => {
              const b = pageOrNull(id) as BlockRecord | undefined;
              return (
                <div key={id} className="nc-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => apply(pageUrl(id))}>
                  <div className="nc-menu-item-inner"><div className="nc-menu-icon"><PageIcon block={b} size={20} /></div><div className="nc-menu-label nc-ellipsis">{pageTitle(b) || 'New page'}</div></div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="nc-link-edit-section" style={{ paddingBottom: 8 }}>
        <div className="nc-menu-section-title" style={{ margin: '6px 0 4px', padding: 0 }}>Link title</div>
        <div className="nc-link-input focused">
          <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={onKey} />
        </div>
      </div>
      <div className="nc-menu-section" style={{ borderTop: '1px solid var(--lp-border-secondary)' }}>
        <div role="option" className="nc-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={remove}>
          <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="trash" size={20} /></div><div className="nc-menu-label">Remove link</div></div>
        </div>
      </div>
    </PopoverSurface>
  );
}

// ------------------------------------------------------------------------------------------------
// Hover pill

export interface LinkHover {
  blockId: string;
  property: string;
  start: number;
  end: number;
  href: string;
  rect: DOMRect;
  /** shown because the caret moved onto the link with the arrow keys: Enter opens it, ⌘/ focuses the pill */
  keyboard?: boolean;
}

/** Caret moved with ←/→: show the link pill while the caret is inside a link, hide it when it leaves. */
export function syncKeyboardLinkPill(blockId: string, property: string, caret: number | null) {
  const cur = useLinkHover.getState().hover;
  if (caret === null) {
    if (cur?.keyboard) useLinkHover.setState({ hover: null });
    return;
  }
  const value = valueOf(blockId, property);
  const href = annotationValue(value, caret, caret, 'a') as string | undefined;
  const ext = href ? linkExtent(value, caret, href) : null;
  if (!ext || caret <= ext.start || caret >= ext.end) {
    if (cur?.keyboard) useLinkHover.setState({ hover: null });
    return;
  }
  if (cur && cur.blockId === blockId && cur.start === ext.start && cur.end === ext.end) return;
  const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${blockId}"][data-property="${property}"]`);
  const rects = leaf ? rectsForRange(leaf, ext.start, ext.end) : [];
  if (!rects.length) return;
  useLinkHover.setState({ hover: { blockId, property, start: ext.start, end: ext.end, href: ext.href, rect: rects[rects.length - 1], keyboard: true } });
}

/** ⌘/ with the caret on a link: keyboard focus moves into the link pill. */
export function focusLinkPill(): boolean {
  const h = useLinkHover.getState().hover;
  if (!h) return false;
  const el = document.querySelector<HTMLElement>('.nc-link-pill .nc-link-pill-url');
  el?.focus();
  return !!el;
}

export const useLinkHover = create<{ hover: LinkHover | null }>(() => ({ hover: null }));

export function LinkHoverPill() {
  const hover = useLinkHover((s) => s.hover);
  const slash = useEditor((s) => s.slash);
  if (!hover || slash) return null;
  const pid = internalPageId(hover.href);
  const label = pid ? pageTitle(pageOrNull(pid)) || hover.href : hover.href;
  return (
    <div
      className="nc-link-pill"
      role="dialog"
      style={{ position: 'fixed', left: hover.rect.left, top: hover.rect.bottom + 6, zIndex: 998 }}
      onMouseEnter={() => cancelHide()}
      onMouseLeave={() => scheduleHide()}
      onMouseDown={(e) => e.preventDefault()}
    >
      <span className="nc-link-pill-icon"><Icon name={pid ? 'page' : 'globeSmall'} size={14} /></span>
      <div
        className="nc-link-pill-url"
        role="link"
        tabIndex={0}
        onClick={() => followLink(hover.href)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); followLink(hover.href, e.metaKey || e.ctrlKey); }
          else if (e.key === 'Escape') { e.preventDefault(); const h = hover; useLinkHover.setState({ hover: null }); useEditor.getState().requestFocus(h.blockId, h.end, { property: h.property }); }
        }}
      >
        {label}
      </div>
      <div
        role="button"
        aria-label="Copy link"
        className="nc-link-pill-btn icon"
        data-tooltip="Copy link"
        onClick={() => {
          void navigator.clipboard?.writeText(pid ? new URL(hover.href, location.origin).href : hover.href);
          useUI.getState().toast('Link copied');
        }}
      >
        <Icon name="docOnDoc" size={16} />
      </div>
      <div
        role="button"
        className="nc-link-pill-btn"
        onClick={() => {
          const h = hover;
          useLinkHover.setState({ hover: null });
          openLinkEdit({ blockId: h.blockId, property: h.property, start: h.start, end: h.end }, h.href);
        }}
      >
        Edit
      </div>
    </div>
  );
}

let hideTimer: ReturnType<typeof setTimeout> | null = null;
let showTimer: ReturnType<typeof setTimeout> | null = null;
function cancelHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = null;
}
function scheduleHide() {
  cancelHide();
  hideTimer = setTimeout(() => useLinkHover.setState({ hover: null }), 250);
}

/** Hover tracking for link tokens inside editor leaves (installed by the inline layer). */
export function installLinkHover(): () => void {
  const over = (e: MouseEvent) => {
    const a = (e.target as HTMLElement)?.closest?.('a.lit-link-token') as HTMLAnchorElement | null;
    if (!a) {
      if (useLinkHover.getState().hover && !(e.target as HTMLElement)?.closest?.('.nc-link-pill')) scheduleHide();
      if (showTimer) clearTimeout(showTimer);
      return;
    }
    const leaf = a.closest<HTMLElement>('[data-content-editable-leaf]');
    if (!leaf) return;
    cancelHide();
    if (showTimer) clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      const blockId = leaf.dataset.blockId!;
      const property = leaf.dataset.property ?? 'title';
      const href = a.getAttribute('href') ?? '';
      const idx = Number(a.dataset.tokenIndex ?? -1);
      const value = valueOf(blockId, property);
      let pos = 0;
      for (let i = 0; i < idx && i < value.length; i++) pos += value[i][0].length;
      const ext = linkExtent(value, pos, href);
      if (!ext) return;
      useLinkHover.setState({ hover: { blockId, property, start: ext.start, end: ext.end, href, rect: a.getBoundingClientRect() } });
    }, 400);
  };
  const down = (e: MouseEvent) => {
    if ((e.target as HTMLElement)?.closest?.('.nc-link-pill')) return;
    if (showTimer) clearTimeout(showTimer);
    useLinkHover.setState({ hover: null });
  };
  document.addEventListener('mouseover', over);
  document.addEventListener('mousedown', down, true);
  return () => {
    document.removeEventListener('mouseover', over);
    document.removeEventListener('mousedown', down, true);
  };
}

/** Paste of a URL over a selection links the selected text. */
export function linkSelectionWithUrl(r: TextRange, url: string) {
  setLink(r, normalizeUrl(url), 'paste');
  restoreRange({ ...r, start: r.end, end: r.end });
}

export function replaceWithLinkedText(r: TextRange, text: string, href: string) {
  let next = deleteRange(valueOf(r.blockId, r.property), r.start, r.end);
  next = insertRich(next, r.start, [[text, [['a', href]]]]);
  commitText(r.blockId, r.property, next, r.start + length([[text]]), { coalesce: false, action: 'paste' });
}

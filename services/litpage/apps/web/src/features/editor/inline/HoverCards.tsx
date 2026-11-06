// Inline atom interactions inside editor leaves:
// - page mention: hover card with a cover band, icon, tertiary text, and a two-line title clamp; click → open page
// (⌘/Ctrl+click → new tab); a block mention opens
// its page scrolled to the block
// - link mention: hover preview (site, title, description, URL) with Copy link / Reload mention / Change to preview
// Click opens the link in a new tab
// - group mention: hover lists up to 10 of the group’s members; the full list is in Settings › People › Groups
// - date mention: click → date picker; inline equation: click → equation editor; link: click → open
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { BlockRecord } from '@nc/shared/records.ts';
import { openPage, pageUrl } from '../../../lib/router.ts';
import { ancestorsOf } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { valueOf } from './format.ts';
import { openDateMentionEditor } from './DatePicker.tsx';
import { openEquationEditor } from './EquationEditor.tsx';
import { followLink } from './LinkPopups.tsx';
import type { LinkMentionValue } from '@nc/shared/richtext.ts';
import type { UserRecord } from '@nc/shared/records.ts';
import { groupOf } from '../atoms.ts';
import { Avatar } from './MentionMenus.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { useUI } from '../../../lib/store/ui.ts';

interface PageHover {
  pageId: string;
  rect: DOMRect;
}

const usePageHover = create<{ hover: PageHover | null }>(() => ({ hover: null }));

export function PageMentionCard() {
  const hover = usePageHover((s) => s.hover);
  const [, force] = useState(0);
  useEffect(() => records.subscribeAll(() => force((x) => x + 1)), []);
  if (!hover) return null;
  const page = records.get<BlockRecord>('block', hover.pageId);
  const parent = ancestorsOf(hover.pageId).slice(-1)[0];
  return (
    <div
      role="dialog"
      className="nc-page-hover-card"
      style={{ position: 'fixed', left: hover.rect.left, top: hover.rect.bottom + 6, zIndex: 998 }}
      onMouseEnter={cancel}
      onMouseLeave={hideSoon}
      onClick={() => { usePageHover.setState({ hover: null }); openPage(hover.pageId); }}
    >
      <div style={{ height: 36 }} />
      <div className="nc-page-hover-icon"><PageIcon block={page} size={26} /></div>
      <div className="nc-page-hover-body">
        {parent && <div className="nc-page-hover-parent nc-ellipsis">{pageTitle(parent) || 'Untitled'}</div>}
        <div className="nc-page-hover-title">{page ? pageTitle(page) || 'New page' : 'No access'}</div>
        <div style={{ height: 24 }} />
      </div>
    </div>
  );
}

interface LinkMentionHover {
  blockId: string;
  property: string;
  offset: number;
  value: LinkMentionValue;
  rect: DOMRect;
  editable: boolean;
}

const useLinkMentionHover = create<{ hover: LinkMentionHover | null }>(() => ({ hover: null }));

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, '');
  } catch {
    return href;
  }
}

export function LinkMentionCard() {
  const hover = useLinkMentionHover((s) => s.hover);
  if (!hover) return null;
  const v = hover.value;
  const host = hostOf(v.href);
  const close = () => useLinkMentionHover.setState({ hover: null });
  const range = { blockId: hover.blockId, property: hover.property, start: hover.offset, end: hover.offset + 1 };
  return (
    <div
      role="dialog"
      className="nc-lm-hover-card"
      style={{ position: 'fixed', left: hover.rect.left, top: hover.rect.bottom + 6, zIndex: 998 }}
      onMouseEnter={cancelLm}
      onMouseLeave={hideLmSoon}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="nc-lm-hover-main" role="link" tabIndex={-1} onClick={() => { close(); followLink(v.href, true); }}>
        <div className="nc-lm-hover-site">
          {v.icon_url ? <img src={v.icon_url} alt="" /> : <Icon name="globeSmall" size={14} />}
          <span className="nc-ellipsis">{v.provider || host}</span>
        </div>
        <div className="nc-lm-hover-title">{v.title || host}</div>
        {v.description && <div className="nc-lm-hover-desc">{v.description}</div>}
        <div className="nc-lm-hover-url nc-ellipsis">{v.href}</div>
      </div>
      <div className="nc-lm-hover-actions">
        <div role="button" className="nc-lm-hover-btn" aria-label="Copy link" onClick={() => { void navigator.clipboard?.writeText(v.href); useUI.getState().toast('Link copied'); close(); }}>
          <Icon name="docOnDoc" size={14} />Copy link
        </div>
        {hover.editable && (
          <div role="button" className="nc-lm-hover-btn" aria-label="Reload mention" onClick={() => { close(); void import('./PasteMenu.tsx').then((m) => m.refreshLinkMention(range.blockId, range.property, range.start, v.href)); }}>
            <Icon name="refresh" size={14} />Reload mention
          </div>
        )}
        {hover.editable && (
          <div role="button" className="nc-lm-hover-btn" aria-label="Change to preview" onClick={() => { close(); void import('./PasteMenu.tsx').then((m) => m.replaceRangeWithBlock(range, 'bookmark', undefined, v.href)); }}>
            <Icon name="bookmark" size={14} />Change to preview
          </div>
        )}
      </div>
    </div>
  );
}

const useGroupHover = create<{ hover: { groupId: string; spaceId?: string; rect: DOMRect } | null }>(() => ({ hover: null }));

export function GroupMentionCard() {
  const hover = useGroupHover((s) => s.hover);
  if (!hover) return null;
  const g = groupOf(hover.groupId, hover.spaceId);
  const members = (g?.member_ids ?? []).map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u);
  const n = g?.member_ids?.length ?? 0;
  return (
    <div role="dialog" className="nc-group-hover-card" style={{ position: 'fixed', left: hover.rect.left, top: hover.rect.bottom + 6, zIndex: 998 }} onMouseEnter={cancelGroup} onMouseLeave={hideGroupSoon}>
      <div className="nc-group-hover-head">
        <div className="nc-group-hover-name nc-ellipsis">{g?.name || 'Deleted group'}</div>
        <div className="nc-group-hover-count">{n === 1 ? '1 member' : `${n} members`}</div>
      </div>
      {members.slice(0, 10).map((u) => (
        <div key={u.id} className="nc-group-hover-member"><Avatar user={u} size={20} /><span className="nc-ellipsis">{u.name || u.email}</span></div>
      ))}
      {n > 10 && <div className="nc-group-hover-more">{`+${n - 10} more`}</div>}
    </div>
  );
}

let groupShowT: ReturnType<typeof setTimeout> | null = null;
let groupHideT: ReturnType<typeof setTimeout> | null = null;
function cancelGroup() {
  if (groupHideT) clearTimeout(groupHideT);
  groupHideT = null;
}
function hideGroupSoon() {
  cancelGroup();
  groupHideT = setTimeout(() => useGroupHover.setState({ hover: null }), 250);
}

let lmShowT: ReturnType<typeof setTimeout> | null = null;
let lmHideT: ReturnType<typeof setTimeout> | null = null;
function cancelLm() {
  if (lmHideT) clearTimeout(lmHideT);
  lmHideT = null;
}
function hideLmSoon() {
  cancelLm();
  lmHideT = setTimeout(() => useLinkMentionHover.setState({ hover: null }), 250);
}

let showT: ReturnType<typeof setTimeout> | null = null;
let hideT: ReturnType<typeof setTimeout> | null = null;
function cancel() {
  if (hideT) clearTimeout(hideT);
  hideT = null;
}
function hideSoon() {
  cancel();
  hideT = setTimeout(() => usePageHover.setState({ hover: null }), 200);
}

/** Character offset of the decoration with token index `i`. */
function offsetOfToken(blockId: string, property: string, i: number): number {
  const v = valueOf(blockId, property);
  let pos = 0;
  for (let k = 0; k < i && k < v.length; k++) pos += v[k][0].length;
  return pos;
}

export function installAtomInteractions(): () => void {
  const over = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    // link mention preview
    const lm = t?.closest?.('.lit-link-mention-token') as HTMLElement | null;
    const lmLeaf = lm?.closest<HTMLElement>('[data-content-editable-leaf]');
    if (lm && lmLeaf) {
      cancelLm();
      if (lmShowT) clearTimeout(lmShowT);
      lmShowT = setTimeout(() => {
        const blockId = lmLeaf.dataset.blockId!;
        const property = lmLeaf.dataset.property ?? 'title';
        const idx = Number(lm.dataset.tokenIndex ?? -1);
        const value = valueOf(blockId, property)[idx]?.[1]?.find((a) => a[0] === 'lm')?.[1] as LinkMentionValue | undefined;
        if (!value || !lm.isConnected) return;
        useLinkMentionHover.setState({ hover: { blockId, property, offset: offsetOfToken(blockId, property, idx), value, rect: lm.getBoundingClientRect(), editable: lmLeaf.isContentEditable } });
      }, 450);
    } else {
      if (lmShowT) clearTimeout(lmShowT);
      if (useLinkMentionHover.getState().hover && !t?.closest?.('.nc-lm-hover-card')) hideLmSoon();
    }
    // group mention member preview
    const gm = t?.closest?.('.lit-group-mention-token') as HTMLElement | null;
    if (gm?.dataset.groupId) {
      cancelGroup();
      if (groupShowT) clearTimeout(groupShowT);
      groupShowT = setTimeout(() => {
        if (gm.isConnected) useGroupHover.setState({ hover: { groupId: gm.dataset.groupId!, spaceId: gm.dataset.spaceId, rect: gm.getBoundingClientRect() } });
      }, 450);
    } else {
      if (groupShowT) clearTimeout(groupShowT);
      if (useGroupHover.getState().hover && !t?.closest?.('.nc-group-hover-card')) hideGroupSoon();
    }
    const m = t?.closest?.('.lit-page-mention-token') as HTMLElement | null;
    if (!m) {
      if (showT) clearTimeout(showT);
      if (usePageHover.getState().hover && !t?.closest?.('.nc-page-hover-card')) hideSoon();
      return;
    }
    cancel();
    if (showT) clearTimeout(showT);
    const pageId = m.dataset.pageId;
    if (!pageId) return;
    showT = setTimeout(() => usePageHover.setState({ hover: { pageId, rect: m.getBoundingClientRect() } }), 450);
  };
  let downAt: { x: number; y: number } | null = null;
  const down = (e: MouseEvent) => {
    downAt = { x: e.clientX, y: e.clientY };
    if (showT) clearTimeout(showT);
    const t = e.target as HTMLElement;
    if (!t?.closest?.('.nc-page-hover-card')) usePageHover.setState({ hover: null });
    if (lmShowT) clearTimeout(lmShowT);
    if (!t?.closest?.('.nc-lm-hover-card')) useLinkMentionHover.setState({ hover: null });
    if (groupShowT) clearTimeout(groupShowT);
    if (!t?.closest?.('.nc-group-hover-card')) useGroupHover.setState({ hover: null });
    // keep the caret where it is when clicking atoms/links (they act like buttons)
    const atom = t?.closest?.('[data-atom="1"], a.lit-link-token') as HTMLElement | null;
    if (atom && atom.closest('[data-content-editable-leaf]') && e.button === 0 && !e.shiftKey) e.preventDefault();
  };
  const click = (e: MouseEvent) => {
    if (e.button !== 0 || e.shiftKey) return;
    if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 4) return; // drag-selection
    const t = e.target as HTMLElement;
    const leaf = t?.closest?.('[data-content-editable-leaf]') as HTMLElement | null;
    if (!leaf) return;
    const blockId = leaf.dataset.blockId!;
    const property = leaf.dataset.property ?? 'title';
    const page = t.closest('.lit-page-mention-token') as HTMLElement | null;
    if (page?.dataset.pageId) {
      e.preventDefault();
      const blockId = page.dataset.scrollTo; // block mention: open its page scrolled to the block
      if (e.metaKey || e.ctrlKey) window.open(pageUrl(page.dataset.pageId, { blockId }), '_blank');
      else if (blockId) void import('../blockLinks.ts').then((m) => m.openBlockLink(page.dataset.pageId!, blockId));
      else openPage(page.dataset.pageId);
      return;
    }
    const date = t.closest('.lit-date-mention-token') as HTMLElement | null;
    if (date && leaf.isContentEditable) {
      e.preventDefault();
      openDateMentionEditor(blockId, property, offsetOfToken(blockId, property, Number(date.dataset.tokenIndex)), date);
      return;
    }
    const eq = t.closest('.lit-text-equation-token') as HTMLElement | null;
    if (eq && leaf.isContentEditable) {
      e.preventDefault();
      openEquationEditor(blockId, property, offsetOfToken(blockId, property, Number(eq.dataset.tokenIndex)));
      return;
    }
    const link = t.closest('a.lit-link-token') as HTMLAnchorElement | null;
    if (link) {
      e.preventDefault();
      followLink(link.getAttribute('href') ?? '', e.metaKey || e.ctrlKey);
      return;
    }
    const lm = t.closest('.lit-link-mention-token') as HTMLElement | null;
    if (lm?.dataset.href) {
      e.preventDefault();
      followLink(lm.dataset.href, true);
    }
  };
  document.addEventListener('mouseover', over);
  document.addEventListener('mousedown', down, true);
  document.addEventListener('click', click, true);
  return () => {
    document.removeEventListener('mouseover', over);
    document.removeEventListener('mousedown', down, true);
    document.removeEventListener('click', click, true);
  };
}

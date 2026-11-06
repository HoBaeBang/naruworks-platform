// Page-level editor behaviors around the block tree:
// - hover gutter: "+" (add below, ⌥ add above) and ⋮⋮ (drag / click → block menu), positioned beside the block
// (+ at block.x-52, handle at block.x-28, 24px tall, aligned to the first line)
// - block selection (Esc / Shift+Arrow / ⌘A×2 / Shift+click / ⌘⇧click / dragging a text selection out of its block):
// Delete, Enter, arrows, Shift+arrows, ⌘C/⌘X/⌘V/⌘D, ⌘⇧↑↓, Tab, ⌘/
// - drag & drop of blocks with a 4px blue drop indicator (before/after, into columns at the sides), files dropped
// OS upload into image/file blocks
// - rectangle (marquee) selection starting in the page margin
// - text-selection copy/cut (rich HTML + internal JSON + Markdown) and the inline UI layer (text action menu …)
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Plus } from 'lucide-react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { deleteRange, length } from '@nc/shared/richtext.ts';
import { TEXT_BLOCKS, canHaveChildren } from '@nc/shared/blocks.ts';
import { newId } from '@nc/shared/ids.ts';
import { Icon } from '../../components/Icon.tsx';
import { getBlock, moveBlocksIn, run, createBlockIn, indentIn, outdentIn } from '../../lib/blocks.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { records } from '../../lib/store/records.ts';
import { useEditor } from './editorState.ts';
import { openBlockMenu } from './BlockMenu.tsx';
import { deleteBlocks, duplicateBlocks, insertAfter, moveBlockUpDown, pageIdOfBlock, setOpen } from './commands.ts';
import { modifyBlock } from './modify.ts';
import { suggestingIn, suggestReplace } from '../comments/suggestEdits.ts';
import { copyBlocks, copyTextRange, insertFiles, pasteAfterBlocks } from './clipboard.ts';
import { openSlashMenu } from './SlashMenu.tsx';
import { commitText } from './textHandlers.ts';
import { getSelectionOffsets } from './richTextDom.ts';
import { overlayCount } from '../../components/overlay.tsx';
import { InlineLayer } from './inline/InlineLayer.tsx';
import { openTextMenuAtPoint } from './inline/TextActionMenu.tsx';
import { valueOf } from './inline/format.ts';
import { useBlockLinkScroll } from './blockLinks.ts';
import { clearSidebarDrop, externalBlockDropTargets, moveBlocksToPage, sidebarPageAt, type ExternalBlockDrop } from './dragToSidebar.ts';

interface Gutter {
  blockId: string;
  top: number;
  left: number;
  height: number;
}

function blockEls(root: ParentNode): HTMLElement[] {
  // database rows / cards (inside a collection view body) are records of the data source, not page blocks
  return Array.from(root.querySelectorAll<HTMLElement>('.lit-page-content .lit-selectable[data-block-id]')).filter((el) => !el.parentElement?.closest('.lit-collection-view-body'));
}

/** Selectable blocks in document order (columns are containers, not selectable). */
function selectableIds(root: ParentNode): string[] {
  return blockEls(root)
    .map((el) => el.dataset.blockId!)
    .filter((id) => {
      const t = getBlock(id)?.type;
      return t && t !== 'column' && t !== 'column_list';
    });
}

/** Keep only top-most ids (children of a selected block are implied). */
function topMost(ids: string[]): string[] {
  const set = new Set(ids);
  return ids.filter((id) => {
    let cur = getBlock(id);
    for (let i = 0; i < 50 && cur && cur.parent_table === 'block'; i++) {
      if (set.has(cur.parent_id)) return false;
      cur = getBlock(cur.parent_id);
    }
    return true;
  });
}

/** Blocks between a and b (inclusive) in document order, as top-most ids. */
function rangeBetween(root: ParentNode, a: string, b: string): string[] {
  const all = selectableIds(root);
  let i = all.indexOf(a);
  let j = all.indexOf(b);
  if (i < 0 || j < 0) return [b];
  if (i > j) [i, j] = [j, i];
  return topMost(all.slice(i, j + 1));
}

/** First line height of a block (to center the handle on it). */
function firstLineBox(el: HTMLElement): { top: number; height: number } {
  const r = el.getBoundingClientRect();
  const leaf = el.querySelector<HTMLElement>('[data-content-editable-leaf]');
  if (leaf && leaf.closest('.lit-selectable') === el) {
    const lr = leaf.getBoundingClientRect();
    const lh = parseFloat(getComputedStyle(leaf).lineHeight) || 24;
    const pad = parseFloat(getComputedStyle(leaf).paddingTop) || 0;
    return { top: lr.top + pad + lh / 2 - 12, height: 24 };
  }
  // blocks shorter than the handle (divider: 13px) center it on the block
  if (r.height < 24) return { top: r.top + (r.height - 24) / 2, height: 24 };
  const pad = parseFloat(getComputedStyle(el).getPropertyValue('--nc-pad-top')) || 0;
  return { top: r.top + pad, height: 24 };
}

/** Horizontal extent in which a block shows its gutter: the block plus the gutter column on its left.er at x=1372, no handle). */
const GUTTER_LEFT = 60;
const GUTTER_RIGHT = 20;
/** Drag & drop: pointer this far right of a block's start (below it) nests the dragged blocks inside it. */
const NEST_DROP_X = 48;
const NEST_INDENT = 26;

// test hook for e2e/editor-*.mjs (dev builds only)
if (import.meta.env.DEV) (window as any).__ncEditor = { records, useEditor, transactions };

// undo/redo put the caret back where the edit happened
transactions.onSelectionRestore = (sel) => {
  if (!sel?.blockId) return;
  const b = getBlock(sel.blockId);
  if (!b || b.alive === false) return;
  if (!TEXT_BLOCKS.has(b.type) && b.type !== 'page') {
    useEditor.getState().selectBlocks([sel.blockId], sel.blockId);
    return;
  }
  const len = length((b.properties as any)?.[sel.property ?? 'title']);
  useEditor.getState().requestFocus(sel.blockId, Math.min(sel.offset ?? len, len), { property: sel.property ?? 'title', end: sel.end !== undefined ? Math.min(sel.end, len) : undefined });
};

function leafOf(n: Node | null): HTMLElement | null {
  const el = n ? (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement) : null;
  return (el?.closest('[data-content-editable-leaf="true"]') as HTMLElement | null) ?? null;
}

export function EditorSurface({ pageId, readOnly, children, scroller }: { pageId: string; readOnly: boolean; children: ReactNode; scroller: RefObject<HTMLDivElement | null> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  useBlockLinkScroll(pageId); // "#<block id>" in the URL → scroll to that block (Copy block URL, block mentions)
  const [gutter, setGutter] = useState<Gutter | null>(null);
  const [drop, setDrop] = useState<{ top: number; left: number; width: number; vertical?: boolean; height?: number } | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [blockSelecting, setBlockSelecting] = useState(false);
  const selected = useEditor((s) => s.selectedBlocks);
  const menuFor = useEditor((s) => s.blockMenuFor ?? null);
  const dragging = useRef<{ ids: string[]; target: null | { id: string; where: 'before' | 'after' | 'left' | 'right' | 'inside' | 'page' }; external?: ExternalBlockDrop | null } | null>(null);
  void pageId;

  // hover gutter tracking
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (readOnly || dragging.current || marquee || blockSelecting) return;
    const root = rootRef.current;
    if (!root) return;
    const els = blockEls(root);
    let best: HTMLElement | null = null;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (e.clientY >= r.top && e.clientY <= r.bottom && e.clientX >= r.left - GUTTER_LEFT && e.clientX <= r.right + GUTTER_RIGHT) {
        // deepest matching block wins
        if (!best || best.contains(el)) best = el;
      }
    }
    if (!best) {
      // pointer over the title, the margins or between blocks: no stale handle (the gutter itself counts as inside)
      if ((e.target as HTMLElement).closest?.('.nc-block-gutter')) return;
      setGutter((g) => (g ? null : g));
      if (useEditor.getState().hoverBlock) useEditor.setState({ hoverBlock: null });
      return;
    }
    // pointer left of a block nested in a container that reserves that space (callout icon column, marked
    // data-gutter-host by the block module): target the container so the gutter doesn't cover its icon
    if (e.clientX < best.getBoundingClientRect().left) {
      const host = best.parentElement?.closest('[data-gutter-host]')?.closest('.lit-selectable[data-block-id]') as HTMLElement | null | undefined;
      if (host) best = host;
    }
    const id = best.dataset.blockId!;
    const b = getBlock(id);
    if (!b || b.type === 'column' || b.type === 'column_list' || b.type === 'table_row') return;
    const box = firstLineBox(best);
    const rr = root.getBoundingClientRect();
    const r = best.getBoundingClientRect();
    setGutter({ blockId: id, top: box.top - rr.top, left: r.left - rr.left, height: box.height });
    useEditor.setState({ hoverBlock: id });
  }, [readOnly, marquee, blockSelecting]);

  // block selection keyboard + clipboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useEditor.getState();
      // keys already handled by a leaf (e.g. Esc / ⌘D / Shift+↑ that just created the block selection)
      if (e.defaultPrevented || !s.selectedBlocks.length || overlayCount() > 0) return;
      if (document.activeElement && ((document.activeElement as HTMLElement).isContentEditable || ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName))) return;
      const root = rootRef.current;
      if (!root || !s.selectedBlocks.every((id) => root.querySelector(`[data-block-id="${id}"]`))) return;
      const ids = s.selectedBlocks;
      const mod = e.metaKey || e.ctrlKey;
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        deleteBlocks(ids);
      } else if (e.key === 'Escape') {
        s.clearBlockSelection();
      } else if (e.key === 'Enter' && mod) {
        // ⌘Enter — modify the block: check, open/close, open page, full screen, edit equation 
        e.preventDefault();
        if (ids.length === 1) modifyBlock(ids[0]);
        else for (const id of ids) if (getBlock(id)?.type === 'to_do') modifyBlock(id);
      } else if (e.key === ' ' && !mod && ids.length === 1 && getBlock(ids[0])?.type === 'image') {
        // Space opens / closes a selected image in full screen 
        e.preventDefault();
        void import('./blocks/media.block.tsx').then((m) => m.openFullScreen(ids[0]));
      } else if (mod && e.altKey && e.code === 'KeyP') {
        e.preventDefault();
        void import('./slashItems.ts').then((m) => m.presentFrom(ids[0]));
      } else if (e.altKey && e.shiftKey && !mod && e.code === 'KeyL') {
        e.preventDefault();
        void import('../page/pageActions.ts').then((p) => p.copyPageLink(pageIdOfBlock(ids[0]) ?? ids[0], ids[0]));
      } else if (e.key === 'Enter' && !mod) {
        e.preventDefault();
        const b = getBlock(ids[0]);
        if (b && TEXT_BLOCKS.has(b.type)) s.requestFocus(ids[0], 'end');
        else if (b && (b.type === 'page' || b.type === 'collection_view_page')) void import('../../lib/router.ts').then((r) => r.openPage(b.id));
        else s.clearBlockSelection();
      } else if (mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        moveBlockUpDown(ids[0], e.key === 'ArrowUp' ? -1 : 1, ids);
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const all = selectableIds(root);
        const back = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
        const anchor = s.selectionAnchor ?? ids[0];
        if (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
          // extend/shrink anchor: the moving end is the one opposite the anchor
          const anchorIdx = all.indexOf(anchor);
          const firstIdx = all.indexOf(ids[0]);
          const lastIdx = all.indexOf(ids[ids.length - 1]);
          let focusIdx = anchorIdx === firstIdx ? lastIdx : firstIdx;
          if (focusIdx < 0) focusIdx = anchorIdx;
          // skip descendants of the current focus when extending downward
          let j = focusIdx + (back ? -1 : 1);
          while (j >= 0 && j < all.length && !back && root.querySelector(`[data-block-id="${all[focusIdx]}"]`)?.contains(root.querySelector(`[data-block-id="${all[j]}"]`))) j++;
          j = Math.max(0, Math.min(all.length - 1, j));
          useEditor.setState({ selectedBlocks: rangeBetween(root, anchor, all[j]) });
        } else {
          const focusId = back ? ids[0] : ids[ids.length - 1];
          let j = all.indexOf(focusId) + (back ? -1 : 1);
          if (!back) while (j < all.length && root.querySelector(`[data-block-id="${focusId}"]`)?.contains(root.querySelector(`[data-block-id="${all[j]}"]`))) j++;
          j = Math.max(0, Math.min(all.length - 1, j));
          s.selectBlocks([all[j]], all[j]);
        }
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        const top = Array.from(root.querySelectorAll<HTMLElement>('.lit-page-content > .nc-block-list > .lit-selectable')).map((el) => el.dataset.blockId!);
        s.selectBlocks(top, top[0]);
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        const nids = duplicateBlocks(ids);
        s.selectBlocks(nids, nids[0]);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        run(e.shiftKey ? 'Text.handleUntab' : 'Text.handleTab', (tx) => {
          for (const id of e.shiftKey ? [...ids].reverse() : ids) (e.shiftKey ? outdentIn : indentIn)(tx, id);
        });
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) transactions.redo();
        else transactions.undo();
      } else if (mod && e.key === '/') {
        e.preventDefault();
        const el = document.querySelector(`[data-block-id="${ids[0]}"]`) as HTMLElement | null;
        if (el) openBlockMenu(ids, el.getBoundingClientRect());
      } else if (e.key.length === 1 && !mod && !e.altKey && ids.length === 1) {
        // typing on a selected text block starts editing at the end
        const b = getBlock(ids[0]);
        if (b && TEXT_BLOCKS.has(b.type)) s.requestFocus(ids[0], 'end');
      }
    };
    const inThisSurface = () => {
      const root = rootRef.current;
      const ids = useEditor.getState().selectedBlocks;
      return !!root && ids.length > 0 && ids.every((id) => root.querySelector(`[data-block-id="${id}"]`));
    };
    const onCopy = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (useEditor.getState().selectedBlocks.length && !active?.isContentEditable) {
        if (inThisSurface()) copyBlocks(useEditor.getState().selectedBlocks, e);
        return;
      }
      // text selection inside one leaf of this surface → rich copy
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const leaf = leafOf(sel.anchorNode);
      if (!leaf || leaf !== leafOf(sel.focusNode) || !rootRef.current?.contains(leaf)) return;
      const off = getSelectionOffsets(leaf);
      if (!off || off.start === off.end) return;
      copyTextRange(leaf.dataset.blockId!, leaf.dataset.property ?? 'title', off.start, off.end, e);
    };
    const onCut = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      if (useEditor.getState().selectedBlocks.length && !active?.isContentEditable) {
        if (!inThisSurface() || readOnly) return;
        const ids = useEditor.getState().selectedBlocks;
        copyBlocks(ids, e);
        deleteBlocks(ids);
        return;
      }
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) return;
      const leaf = leafOf(sel.anchorNode);
      if (!leaf || leaf !== leafOf(sel.focusNode) || !rootRef.current?.contains(leaf) || !leaf.isContentEditable) return;
      const off = getSelectionOffsets(leaf);
      if (!off || off.start === off.end) return;
      const blockId = leaf.dataset.blockId!;
      const property = leaf.dataset.property ?? 'title';
      copyTextRange(blockId, property, off.start, off.end, e);
      if (property === 'title' && suggestingIn(blockId)) {
        // cutting while suggesting suggests the deletion
        suggestReplace(blockId, valueOf(blockId, property), off.start, off.end, '');
        return;
      }
      commitText(blockId, property, deleteRange(valueOf(blockId, property), off.start, off.end), off.start, { coalesce: false, action: 'cut' });
      useEditor.getState().requestFocus(blockId, off.start, { property });
    };
    const onPaste = (e: ClipboardEvent) => {
      // a leaf already handled this paste (pasting blocks into an empty block selects them before the event gets here)
      if (e.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      if (!useEditor.getState().selectedBlocks.length || active?.isContentEditable || ['INPUT', 'TEXTAREA'].includes(active?.tagName ?? '')) return;
      if (!inThisSurface() || readOnly || !e.clipboardData) return;
      e.preventDefault();
      pasteAfterBlocks(useEditor.getState().selectedBlocks, e.clipboardData);
    };
    const onDown = (e: MouseEvent) => {
      const s = useEditor.getState();
      const t = e.target as HTMLElement;
      if (t.closest('.lit-overlay-container, .lit-text-action-menu')) return;
      // right button: the context menu (onContextMenu) decides what gets selected
      if (e.button === 2) return;
      const root = rootRef.current;
      const blockEl = root && root.contains(t) ? (t.closest('.lit-selectable[data-block-id]') as HTMLElement | null) : null;
      const clickedId = blockEl?.dataset.blockId;
      // Shift+click: select every block current block (caret or selection anchor) to the clicked one 
      if (e.shiftKey && root && clickedId && !readOnly) {
        const from = s.selectedBlocks.length ? (s.selectionAnchor ?? s.selectedBlocks[0]) : s.focused?.blockId;
        if (from && from !== clickedId && root.querySelector(`[data-block-id="${from}"]`) && getBlock(from)?.type !== 'page') {
          e.preventDefault();
          const ids = rangeBetween(root, from, clickedId);
          (document.activeElement as HTMLElement | null)?.blur?.();
          window.getSelection()?.removeAllRanges();
          useEditor.setState({ selectedBlocks: ids, selectionAnchor: from, focused: null });
          return;
        }
      }
      // ⌘⇧click (Win: Alt+Shift+click) toggles a block in the selection 
      if (root && clickedId && e.shiftKey && (e.metaKey || e.altKey) && !readOnly) {
        e.preventDefault();
        const cur = s.selectedBlocks;
        const next = cur.includes(clickedId) ? cur.filter((x) => x !== clickedId) : topMost([...cur, clickedId]);
        useEditor.setState({ selectedBlocks: next, selectionAnchor: next[0] ?? null });
        return;
      }
      if (!s.selectedBlocks.length) return;
      s.clearBlockSelection();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    window.addEventListener('paste', onPaste);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('mousedown', onDown, true);
    };
  }, [readOnly]);

  // a leaf taking the focus (click, programmatic text selection) ends a block selection; otherwise an
  // Esc-made block selection would linger under a later text selection / ⌘K popup
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onFocusIn = (e: FocusEvent) => {
      if (!(e.target as HTMLElement | null)?.closest?.('[data-content-editable-leaf]')) return;
      const s = useEditor.getState();
      if (s.selectedBlocks.length && !s.blockMenuFor) s.clearBlockSelection();
    };
    root.addEventListener('focusin', onFocusIn);
    return () => root.removeEventListener('focusin', onFocusIn);
  }, []);

  // dragging a text selection out of its block switches to block selection
  const onMouseDownCapture = (e: React.MouseEvent) => {
    if (readOnly || e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
    const t = e.target as HTMLElement;
    const leaf = t.closest('[data-content-editable-leaf]') as HTMLElement | null;
    const startBlock = leaf?.closest('.lit-selectable[data-block-id]') as HTMLElement | null;
    const root = rootRef.current;
    if (!leaf || !startBlock || !root || !root.contains(startBlock) || t.closest('[data-atom="1"], a.lit-link-token')) return;
    const startId = startBlock.dataset.blockId!;
    const startRect = () => startBlock.getBoundingClientRect();
    let active = false;
    const onMove = (ev: MouseEvent) => {
      const r = startRect();
      const outside = ev.clientY < r.top - 2 || ev.clientY > r.bottom + 2;
      if (!active && !outside) return;
      if (!active) {
        active = true;
        setBlockSelecting(true);
      }
      // block under the pointer (deepest), in document order
      let target: string | null = null;
      for (const el of blockEls(root)) {
        const br = el.getBoundingClientRect();
        if (ev.clientY >= br.top && ev.clientY <= br.bottom) {
          const id = el.dataset.blockId!;
          const ty = getBlock(id)?.type;
          if (ty === 'column' || ty === 'column_list') continue;
          target = id;
        }
      }
      if (!target) {
        const all = selectableIds(root);
        const first = root.querySelector(`[data-block-id="${all[0]}"]`)?.getBoundingClientRect();
        target = first && ev.clientY < first.top ? all[0] : all[all.length - 1];
      }
      if (!active) return;
      if (target === startId && !outside) {
        useEditor.setState({ selectedBlocks: [] });
        return;
      }
      window.getSelection()?.removeAllRanges();
      if (document.activeElement === leaf) leaf.blur();
      const ids = rangeBetween(root, startId, target ?? startId);
      useEditor.setState({ selectedBlocks: ids, selectionAnchor: startId, focused: null });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (active) setBlockSelecting(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // drag & drop
  const startDrag = (e: React.PointerEvent, blockId: string) => {
    if (e.button !== 0) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const sel = useEditor.getState().selectedBlocks;
    const ids = sel.includes(blockId) ? sel : [blockId];
    let ghost: HTMLDivElement | null = null;
    const root = rootRef.current!;
    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        started = true;
        dragging.current = { ids, target: null };
        useEditor.getState().selectBlocks(ids);
        useEditor.setState({ dragging: ids });
        ghost = document.createElement('div');
        ghost.className = 'nc-drag-ghost';
        const src = document.querySelector(`[data-block-id="${ids[0]}"]`);
        if (src) ghost.appendChild(src.cloneNode(true));
        document.body.appendChild(ghost);
      }
      if (ghost) {
        ghost.style.left = `${ev.clientX + 8}px`;
        ghost.style.top = `${ev.clientY + 8}px`;
      }
      // registered drop targets, including database views that take pages as items
      dragging.current!.external = null;
      for (const f of externalBlockDropTargets) {
        const ext = f(ev.clientX, ev.clientY, ids);
        if (!ext) continue;
        dragging.current!.external = ext;
        dragging.current!.target = null;
        setDrop(null);
        return;
      }
      // over a page in the sidebar → the blocks move into that page 
      const sbPage = sidebarPageAt(ev.clientX, ev.clientY, ids);
      if (sbPage !== null) {
        dragging.current!.target = sbPage ? { id: sbPage, where: 'page' } : null;
        setDrop(null);
        return;
      }
      // auto-scroll near edges
      const sc = scroller.current;
      if (sc) {
        const sr = sc.getBoundingClientRect();
        if (ev.clientY < sr.top + 50) sc.scrollTop -= 12;
        else if (ev.clientY > sr.bottom - 50) sc.scrollTop += 12;
      }
      const els = blockEls(root).filter((el) => !ids.some((id) => el.dataset.blockId === id || el.closest(`[data-block-id="${id}"]`)));
      let best: { el: HTMLElement; where: 'before' | 'after' | 'left' | 'right' | 'inside' } | null = null;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (ev.clientY < r.top || ev.clientY > r.bottom) continue;
        const b = getBlock(el.dataset.blockId!);
        if (!b || b.type === 'column_list' || b.type === 'column') continue;
        if (best && !best.el.contains(el)) continue;
        let where: 'before' | 'after' | 'left' | 'right' | 'inside' = ev.clientY < r.top + r.height / 2 ? 'before' : 'after';
        // just outside the right edge means a new column; dropping 25px inside only reorders
        if (ev.clientX < r.left - 4 && b.parent_table === 'block') where = 'left';
        else if (ev.clientX > r.right + 2 && b.parent_table === 'block') where = 'right';
        // below a block and well to the right of its start means nested inside it
        else if (where === 'after' && ev.clientX > r.left + NEST_DROP_X && canHaveChildren(b.type, !!b.format?.toggleable) && !b.content?.length) where = 'inside';
        best = { el, where };
      }
      const rr = root.getBoundingClientRect();
      if (best) {
        const r = best.el.getBoundingClientRect();
        dragging.current!.target = { id: best.el.dataset.blockId!, where: best.where };
        if (best.where === 'left' || best.where === 'right') setDrop({ top: r.top - rr.top, left: (best.where === 'left' ? r.left - 8 : r.right + 4) - rr.left, width: 4, vertical: true, height: Math.min(r.height, 40) });
        else if (best.where === 'inside') setDrop({ top: r.bottom - rr.top - 2, left: r.left - rr.left + NEST_INDENT, width: r.width - NEST_INDENT });
        else setDrop({ top: (best.where === 'before' ? r.top : r.bottom) - rr.top - 2, left: r.left - rr.left, width: r.width });
      } else {
        dragging.current!.target = null;
        setDrop(null);
      }
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      ghost?.remove();
      setDrop(null);
      clearSidebarDrop();
      useEditor.setState({ dragging: null });
      const d = dragging.current;
      dragging.current = null;
      if (!started) {
        // click on the handle opens the block menu
        const el = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null;
        const handle = (e.target as HTMLElement).closest('.nc-block-handle') as HTMLElement | null;
        openBlockMenu(ids, (handle ?? el)!.getBoundingClientRect());
        return;
      }
      if (d?.external) {
        d.external.drop(ev.altKey ? duplicateBlocks(d.ids) : d.ids);
        return;
      }
      if (!d?.target) return;
      if (d.target.where === 'page') {
        moveBlocksToPage(ev.altKey ? duplicateBlocks(d.ids) : d.ids, d.target.id);
        return;
      }
      const where = d.target.where;
      // ⌥-drag duplicates 
      if (ev.altKey) {
        const copies = duplicateBlocks(d.ids);
        dropBlocks(copies, d.target.id, where);
        useEditor.getState().selectBlocks(copies, copies[0]);
        return;
      }
      dropBlocks(d.ids, d.target.id, where);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // marquee selection page margins
  const onPointerDownSurface = (e: React.PointerEvent) => {
    if (readOnly || e.button !== 0) return;
    const t = e.target as HTMLElement;
    if (t.closest('[data-content-editable-leaf], [role=button], a, input, .nc-block-gutter, .lit-overlay-container, .nc-page-header, img, video, iframe')) return;
    if (t.closest('.lit-selectable') && !t.classList.contains('layout')) return;
    const root = rootRef.current!;
    const rr = root.getBoundingClientRect();
    const x0 = e.clientX - rr.left;
    const y0 = e.clientY - rr.top;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const x1 = ev.clientX - rr.left;
      const y1 = ev.clientY - rr.top;
      if (!moved && Math.hypot(x1 - x0, y1 - y0) < 5) return;
      moved = true;
      setMarquee({ x0, y0, x1, y1 });
      const top = Math.min(e.clientY, ev.clientY);
      const bottom = Math.max(e.clientY, ev.clientY);
      const left = Math.min(e.clientX, ev.clientX);
      const right = Math.max(e.clientX, ev.clientX);
      const hits = blockEls(root)
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.bottom > top && r.top < bottom && r.right > left && r.left < right;
        })
        .map((el) => el.dataset.blockId!)
        .filter((id) => {
          const b = getBlock(id);
          return b && b.type !== 'column' && b.type !== 'column_list';
        });
      const top_ = topMost(hits);
      useEditor.setState({ selectedBlocks: top_, selectionAnchor: top_[0] ?? null });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setMarquee(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // files dragged in OS
  const fileDropTarget = (ev: React.DragEvent): { id: string; where: 'before' | 'after' } | null => {
    const root = rootRef.current;
    if (!root) return null;
    let best: { id: string; where: 'before' | 'after' } | null = null;
    for (const el of blockEls(root)) {
      const r = el.getBoundingClientRect();
      const t = getBlock(el.dataset.blockId)?.type;
      if (t === 'column' || t === 'column_list') continue;
      if (ev.clientY >= r.top && ev.clientY <= r.bottom) best = { id: el.dataset.blockId!, where: ev.clientY < r.top + r.height / 2 ? 'before' : 'after' };
    }
    return best;
  };
  const onDragOver = (ev: React.DragEvent) => {
    if (readOnly || !Array.from(ev.dataTransfer.types).includes('Files')) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    const root = rootRef.current!;
    const tgt = fileDropTarget(ev);
    if (!tgt) {
      setDrop(null);
      return;
    }
    const el = root.querySelector(`[data-block-id="${tgt.id}"]`) as HTMLElement;
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    setDrop({ top: (tgt.where === 'before' ? r.top : r.bottom) - rr.top - 2, left: r.left - rr.left, width: r.width });
  };
  const onDrop = (ev: React.DragEvent) => {
    if (readOnly || !ev.dataTransfer.files?.length) return;
    ev.preventDefault();
    setDrop(null);
    const files = Array.from(ev.dataTransfer.files);
    const tgt = fileDropTarget(ev);
    if (tgt) {
      const b = getBlock(tgt.id) as BlockRecord;
      let after: string | null = tgt.id;
      if (tgt.where === 'before') {
        // insert before: the previous sibling (or a fresh placeholder) is the anchor
        const sibs = (getBlock(b.parent_id)?.content ?? []) as string[];
        const i = sibs.indexOf(tgt.id);
        after = i > 0 ? sibs[i - 1] : null;
        if (!after) {
          const pid = newId();
          run('dropFiles', (tx) => { createBlockIn(tx, { id: pid, type: 'text', parentId: b.parent_id, parentTable: b.parent_table as any, before: tgt.id }); });
          after = pid;
        }
      }
      void insertFiles(files, after, { id: b.parent_id, table: b.parent_table });
    } else {
      const page = getBlock(pageId);
      const last = page?.content?.[page.content.length - 1] ?? null;
      void insertFiles(files, last, { id: pageId, table: 'block' });
    }
  };

  // Right-click on text selects the word under the pointer (or keeps the
  // selection containing it) and shows the text action menu, also when the block was block-selected; the empty area
  // of a text block keeps the browser's menu. Blocks without text under the pointer (images, dividers, embeds…) open
  // the block action menu at the pointer. Widgets with their own menus (table cells, database rows) handle
  // the event first.
  const onContextMenu = (e: React.MouseEvent) => {
    if (readOnly || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.closest('input, textarea, .lit-overlay-container, .nc-page-header, .lit-collection-view-body, [data-native-context-menu]')) return;
    const root = rootRef.current;
    if (!root) return;
    const leaf = t.closest<HTMLElement>('[data-content-editable-leaf="true"]');
    if (leaf && root.contains(leaf)) {
      if (openTextMenuAtPoint(leaf, e.clientX, e.clientY)) e.preventDefault();
      return;
    }
    let el = t.closest<HTMLElement>('.lit-selectable[data-block-id]');
    while (el) {
      const ty = getBlock(el.dataset.blockId)?.type;
      if (ty && ty !== 'column' && ty !== 'column_list' && ty !== 'table_row') break;
      el = el.parentElement?.closest<HTMLElement>('.lit-selectable[data-block-id]') ?? null;
    }
    if (!el || !root.contains(el)) return;
    const b = getBlock(el.dataset.blockId);
    // text blocks: only their text opens a menu (the empty area right of the text keeps the native one)
    if (!b || TEXT_BLOCKS.has(b.type)) return;
    e.preventDefault();
    const sel = useEditor.getState().selectedBlocks;
    const ids = sel.length > 1 && sel.includes(b.id) ? sel : [b.id];
    openBlockMenu(ids, new DOMRect(e.clientX, e.clientY, 0, 0), { atPointer: true });
  };

  const plusClick = (e: React.MouseEvent, blockId: string) => {
    const b = getBlock(blockId);
    if (!b) return;
    const above = e.altKey;
    let id = '';
    run('addBlockFromGutter', (tx) => {
      id = createBlockIn(tx, { id: newId(), type: 'text', parentId: b.parent_id, parentTable: b.parent_table as any, ...(above ? { before: blockId } : { after: blockId }), title: [['/']] });
    });
    useEditor.getState().requestFocus(id, 1);
    setTimeout(() => openSlashMenu(id, 'title', 0, '/'), 30);
  };

  return (
    <div
      ref={rootRef}
      className={`whenContentEditable nc-editor-surface ${blockSelecting ? 'nc-block-selecting' : ''}`}
      role="group"
      onMouseMove={onMouseMove}
      onMouseLeave={() => {
        // the block menu’s backdrop takes the pointer, keep that block’s handles visible while it is open
        if (dragging.current || useEditor.getState().blockMenuFor) return;
        setGutter(null);
        useEditor.setState({ hoverBlock: null });
      }}
      onPointerDown={onPointerDownSurface}
      onMouseDownCapture={onMouseDownCapture}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDrop(null); }}
      onDrop={onDrop}
    >
      {children}
      {gutter && !readOnly && (!selected.length || menuFor === gutter.blockId) && (
        // DOM order handle → "+"; row-reverse keeps "+" on the left
        <div className="nc-block-gutter" style={{ top: gutter.top, left: gutter.left - 52 }}>
          <div role="button" className={`nc-block-handle nc-gutter-btn ${menuFor === gutter.blockId ? 'pressed' : ''}`} aria-label="Drag to reposition, click for options" data-tooltip="Drag to reposition" data-tooltip-sub="Click or ⌘/ to open menu" onPointerDown={(e) => { e.preventDefault(); startDrag(e, gutter.blockId); }}>
            <Icon name="dragHandle" size={14} />
          </div>
          <div role="button" className="lit-block-add-button nc-gutter-btn" aria-label="Click to insert below. Option-click inserts above" data-tooltip="Click to insert below" data-tooltip-sub="Option-click inserts above" onMouseDown={(e) => e.preventDefault()} onClick={(e) => plusClick(e, gutter.blockId)}>
            <Plus size={16} aria-hidden className="nc-gutter-plus" />
          </div>
        </div>
      )}
      {drop && <div className="nc-drop-indicator" style={drop.vertical ? { top: drop.top, left: drop.left, width: 4, height: drop.height } : { top: drop.top, left: drop.left, width: drop.width, height: 4 }} />}
      {marquee && (
        <div className="nc-marquee" style={{ left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0) }} />
      )}
      <InlineLayer readOnly={readOnly} />
    </div>
  );
}

/** Drop dragged blocks before/after a target, or beside it to create/extend columns. */
export function dropBlocks(ids: string[], targetId: string, where: 'before' | 'after' | 'left' | 'right' | 'inside') {
  const target = getBlock(targetId);
  if (!target || ids.includes(targetId)) return;
  if (where === 'before' || where === 'after') {
    run('dragBlocks', (tx) => {
      moveBlocksIn(tx, ids, { parentId: target.parent_id, parentTable: target.parent_table as any, ...(where === 'before' ? { before: targetId } : { after: targetId }) });
    });
    return;
  }
  if (where === 'inside') {
    run('dragBlocksInside', (tx) => moveBlocksIn(tx, ids, { parentId: targetId, parentTable: 'block', first: true }));
    if (target.type === 'toggle' || target.format?.toggleable) setOpen(targetId, true);
    return;
  }
  // side drop → columns
  const parent = getBlock(target.parent_id);
  run('dragBlocksToColumn', (tx) => {
    if (parent?.type === 'column') {
      // extend existing column list with a new column next to the target's column
      const list = getBlock(parent.parent_id);
      if (!list) return;
      const colId = newId();
      createBlockIn(tx, { id: colId, type: 'column', parentId: list.id, parentTable: 'block', ...(where === 'left' ? { before: parent.id } : { after: parent.id }) });
      moveBlocksIn(tx, ids, { parentId: colId, parentTable: 'block' });
      const n = (list.content?.length ?? 1) + 1;
      for (const c of [...(list.content ?? []), colId]) tx.update('block', c, ['format'], { column_ratio: 1 / n });
      return;
    }
    const listId = newId();
    const colA = newId();
    const colB = newId();
    createBlockIn(tx, { id: listId, type: 'column_list', parentId: target.parent_id, parentTable: target.parent_table as any, after: targetId });
    createBlockIn(tx, { id: colA, type: 'column', parentId: listId, parentTable: 'block', format: { column_ratio: 0.5 } });
    createBlockIn(tx, { id: colB, type: 'column', parentId: listId, parentTable: 'block', format: { column_ratio: 0.5 } });
    const [first, second] = where === 'left' ? [colA, colB] : [colB, colA];
    moveBlocksIn(tx, ids, { parentId: first, parentTable: 'block' });
    moveBlocksIn(tx, [targetId], { parentId: second, parentTable: 'block' });
  });
}

export { insertAfter };
export type { BlockRecord };

// Shared pieces for non-text blocks: captions, gray placeholders ("Add an image file" …), the hover action
// bar, resize handles, and clipboard, toast, and download helpers.
// (placeholder 704×49 r10 rgba(124, 45, 18, 0.03) pad 12/36/12/12; caption 14px/19.6px texSec pad 6/0/6/2;
// resize pills 6×48 / 48×6 rgba(0, 0, 0, 0.6) + 1px rgba(255,255,255,.9) r20).
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { BlockRecord } from '@nc/shared/records.ts';
import { length, toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { run, setFormat } from '../../../lib/blocks.ts';
import { useBlock } from '../../../lib/hooks.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { RichTextEditable } from '../RichTextEditable.tsx';
import { commitText } from '../textHandlers.ts';
import { insertAfter, neighborLeaf } from '../commands.ts';
import { useEditor } from '../editorState.ts';
import './blocks.css';

/* ---------------------------------------------------------------- helpers */

export function toast(message: string, action?: { label: string; run: () => void }) {
  useUI.getState().toast(message, action);
}

export async function copyText(text: string, message = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    }
    ta.remove();
  }
  if (message) toast(message);
}

export function downloadUrl(url: string, name?: string) {
  // block sources are user data: downloads accept http(s)/relative/blob/data URLs, never javascript:
  if (/^[\u0000- ]*(javascript|vbscript):/i.test(url.replace(/[\t\n\r]/g, ''))) return;
  const a = document.createElement('a');
  a.href = url;
  a.download = name ?? '';
  a.rel = 'noopener';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function fileSizeLabel(bytes: number | undefined): string {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1).replace(/\.0$/, '')}GB`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function normalizeUrl(u: string): string {
  const s = u.trim();
  if (!s) return s;
  if (/^(https?:|data:|blob:|mailto:)/i.test(s) || s.startsWith('/')) return s;
  return `https://${s}`;
}

export function isValidUrl(u: string): boolean {
  try {
    const url = new URL(normalizeUrl(u), location.href);
    return /^(https?:|data:|blob:)$/.test(url.protocol) && (url.protocol !== 'https:' && url.protocol !== 'http:' ? true : url.hostname.includes('.') || url.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname));
  } catch {
    return false;
  }
}

/** Media/source URL of a block: format.display_source (iframe/media src) → properties.source → properties.link. */
export function sourceOf(b: BlockRecord | undefined): string | undefined {
  if (!b) return undefined;
  const d = b.format?.display_source as string | undefined;
  if (d) return d;
  const s = toPlainText(b.properties?.source as RichText | undefined);
  if (s) return s;
  const l = toPlainText((b.properties as any)?.link as RichText | undefined);
  return l || undefined;
}

/** The URL the user entered (properties.source / link), as opposed to the resolved iframe src. */
export function originalSourceOf(b: BlockRecord | undefined): string | undefined {
  if (!b) return undefined;
  return toPlainText(b.properties?.source as RichText | undefined) || toPlainText((b.properties as any)?.link) || (b.format?.display_source as string | undefined) || undefined;
}

export function fileNameOf(b: BlockRecord): string {
  const t = toPlainText(b.properties?.title as RichText | undefined);
  if (t) return t;
  const src = originalSourceOf(b) ?? '';
  try {
    return decodeURIComponent(new URL(src, location.href).pathname.split('/').pop() || '') || src;
  } catch {
    return src.split('/').pop() || 'File';
  }
}

/** Width of the editable column a block lives in (page content, column, toggle children …). */
export function containerWidthOf(blockId: string): number {
  const el = document.querySelector(`[data-block-id="${blockId}"]`) as HTMLElement | null;
  const list = el?.parentElement;
  return list?.getBoundingClientRect().width || 720;
}

/* ---------------------------------------------------------------- captions */

interface CaptionState {
  shown: Record<string, boolean>;
  show: (blockId: string) => void;
  hide: (blockId: string) => void;
}

export const useCaptions = create<CaptionState>((set, get) => ({
  shown: {},
  show: (blockId) => set({ shown: { ...get().shown, [blockId]: true } }),
  hide: (blockId) => {
    const next = { ...get().shown };
    delete next[blockId];
    set({ shown: next });
  },
}));

/** “Caption” action (⌘⌥M): reveal the caption under the block and focus it. */
export function showCaption(blockId: string) {
  useCaptions.getState().show(blockId);
  setTimeout(() => useEditor.getState().requestFocus(blockId, 'end', { property: 'caption' }), 30);
}

export function hasCaption(b: BlockRecord): boolean {
  return length(b.properties?.caption as RichText | undefined) > 0;
}

/** Caption under media/code blocks (contenteditable rich text in properties.caption). */
export function Caption({ block, readOnly, className }: { block: BlockRecord; readOnly: boolean; className?: string }) {
  const value = (block.properties?.caption as RichText | undefined) ?? [];
  const shown = useCaptions((s) => !!s.shown[block.id]);
  if (!shown && !value.length) return null;
  if (readOnly && !value.length) return null;
  return (
    <div className={`nc-caption-wrap ${className ?? ''}`}>
      <RichTextEditable
        blockId={block.id}
        property="caption"
        value={value}
        readOnly={readOnly}
        className="lit-caption nc-caption"
        placeholder="Write a caption…"
        placeholderAlways={shown && !value.length}
        onChange={(next, info) => commitText(block.id, 'caption', next, info.caret)}
        onBlur={() => {
          if (!length((block.properties?.caption as RichText | undefined) ?? [])) setTimeout(() => {
            const f = useEditor.getState().focused;
            if (!(f?.blockId === block.id && f.property === 'caption')) useCaptions.getState().hide(block.id);
          }, 0);
        }}
        onKeyDown={(e, api) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            // Enter in a caption continues writing in a new text block below the media block
            e.preventDefault();
            insertAfter(block.id, 'text');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            useEditor.getState().selectBlocks([block.id], block.id);
          } else if (e.key === 'ArrowDown' && api.atEnd()) {
            const next = neighborLeaf(block.id, 1, 'caption');
            if (next) {
              e.preventDefault();
              useEditor.getState().requestFocus(next.dataset.blockId!, 0, { property: next.dataset.property ?? 'title' });
            }
          }
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- placeholder */

// The slash menu dispatches `nc:open-block-placeholder` right after creating a block, possibly before the new
// block's component has mounted its listener; remember the request so the component can pick it up on mount.
const pendingOpen = new Set<string>();
{
  const w = window as any;
  if (w.__ncPendingOpen) window.removeEventListener('nc:open-block-placeholder', w.__ncPendingOpen);
  w.__ncPendingOpen = (e: Event) => {
    const id = (e as CustomEvent).detail?.blockId as string | undefined;
    if (id) {
      pendingOpen.add(id);
      setTimeout(() => pendingOpen.delete(id), 3000);
    }
  };
  window.addEventListener('nc:open-block-placeholder', w.__ncPendingOpen);
}

/** True (once) when an open request for `blockId` is pending. */
export function consumePendingOpen(blockId: string): boolean {
  return pendingOpen.delete(blockId);
}

/** Ask the block's placeholder/config UI to open (works before the block has rendered). */
export function requestPlaceholderOpen(blockId: string) {
  window.dispatchEvent(new CustomEvent('nc:open-block-placeholder', { detail: { blockId } }));
}

export interface PlaceholderHandle {
  el: HTMLDivElement | null;
}

/** Gray "Add an image file" row shown by empty media/embed/equation blocks; opens its picker on click * and when the slash menu dispatches `nc:open-block-placeholder` for this block. */
export const BlockPlaceholder = forwardRef<PlaceholderHandle, { block: BlockRecord; readOnly: boolean; icon: string | ReactNode; label: ReactNode; onOpen: (anchor: HTMLElement) => void; className?: string }>(
  function BlockPlaceholder({ block, readOnly, icon, label, onOpen, className }, ref) {
    const elRef = useRef<HTMLDivElement>(null);
    const openRef = useRef(onOpen);
    openRef.current = onOpen;
    useImperativeHandle(ref, () => ({ get el() { return elRef.current; } }), []);
    useEffect(() => {
      const open = () => requestAnimationFrame(() => elRef.current && openRef.current(elRef.current));
      if (!readOnly && consumePendingOpen(block.id)) open();
      const on = (e: Event) => {
        if ((e as CustomEvent).detail?.blockId !== block.id || readOnly) return;
        pendingOpen.delete(block.id);
        // wait for layout so the popover anchors under the freshly rendered row
        open();
      };
      window.addEventListener('nc:open-block-placeholder', on);
      return () => window.removeEventListener('nc:open-block-placeholder', on);
    }, [block.id, readOnly]);
    return (
      <div
        ref={elRef}
        role="button"
        tabIndex={-1}
        className={`nc-blk-placeholder ${className ?? ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => !readOnly && elRef.current && onOpen(elRef.current)}
      >
        <div className="nc-blk-placeholder-icon">{typeof icon === 'string' ? <Icon name={icon} size={25} strokeWidth={1.5} /> : icon}</div>
        <div className="nc-blk-placeholder-label">{label}</div>
      </div>
    );
  },
);

/* ---------------------------------------------------------------- action bar */

export function ActionBar({ children, className, visible }: { children: ReactNode; className?: string; visible?: boolean }) {
  return (
    <div className={`nc-blk-actionbar ${visible ? 'visible' : ''} ${className ?? ''}`} role="toolbar" onMouseDown={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

export function ActionButton({ icon, label, tooltip, onClick, active, children, className }: { icon?: string; label?: string; tooltip?: string; onClick: (e: React.MouseEvent<HTMLDivElement>) => void; active?: boolean; children?: ReactNode; className?: string }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={label ?? tooltip}
      data-tooltip={tooltip}
      className={`nc-blk-action ${active ? 'active' : ''} ${children ? 'with-text' : ''} ${className ?? ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </div>
  );
}

export function ActionDivider() {
  return <div className="nc-blk-action-divider" />;
}

/* ---------------------------------------------------------------- resizing */

type Side = 'left' | 'right' | 'bottom';

/** Pointer-drag resize for media frames. Width is symmetric for centered blocks. */
export function useResize(opts: { blockId: string; frame: React.RefObject<HTMLElement | null>; align: 'left' | 'center' | 'right'; minWidth?: number; minHeight?: number; aspect?: number | null; onHeight?: boolean }) {
  const [live, setLive] = useState<{ w?: number; h?: number } | null>(null);
  const start = (e: React.PointerEvent, side: Side) => {
    e.preventDefault();
    e.stopPropagation();
    const el = opts.frame.current;
    if (!el) return;
    const r0 = el.getBoundingClientRect();
    const maxW = el.parentElement?.getBoundingClientRect().width ?? r0.width;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let w = r0.width;
    let h = r0.height;
    document.body.style.cursor = side === 'bottom' ? 'row-resize' : 'col-resize';
    const onMove = (ev: PointerEvent) => {
      if (side === 'bottom') {
        h = Math.max(opts.minHeight ?? 80, r0.height + (ev.clientY - y0));
        setLive({ h });
      } else {
        const dx = (ev.clientX - x0) * (side === 'left' ? -1 : 1) * (opts.align === 'center' ? 2 : 1);
        w = Math.max(opts.minWidth ?? 80, Math.min(maxW, r0.width + dx));
        setLive({ w, h: opts.aspect ? w * opts.aspect : undefined });
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.cursor = '';
      setLive(null);
      if (side === 'bottom') {
        if (Math.abs(h - r0.height) > 1) run('resizeBlockHeight', (tx) => setFormat(tx, opts.blockId, { block_height: Math.round(h) }));
      } else if (Math.abs(w - r0.width) > 1) {
        const full = w >= maxW - 1;
        run('resizeBlock', (tx) => setFormat(tx, opts.blockId, { block_width: Math.round(w), block_page_width: full ? true : undefined, block_full_width: undefined, block_preserve_scale: true }));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  return { live, start };
}

export function ResizeHandles({ onStart, height }: { onStart: (e: React.PointerEvent, side: Side) => void; height?: boolean }) {
  return (
    <>
      <div className="nc-resize-handle left" onPointerDown={(e) => onStart(e, 'left')}><div className="pill" /></div>
      <div className="nc-resize-handle right" onPointerDown={(e) => onStart(e, 'right')}><div className="pill" /></div>
      {height && <div className="nc-resize-handle bottom" onPointerDown={(e) => onStart(e, 'bottom')}><div className="pill" /></div>}
    </>
  );
}

/* ---------------------------------------------------------------- misc UI */

/** Toggle switch (menu rows such as "Header row"). */
export function Switch({ on }: { on: boolean }) {
  return <span className={`nc-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on}><span /></span>;
}

/** Switch bound to a block record, so it updates while the menu stays open. */
export function LiveSwitch({ blockId, get }: { blockId: string; get: (b: BlockRecord) => boolean }) {
  const b = useBlock(blockId);
  return <Switch on={!!b && get(b)} />;
}

/** Full-screen media viewer ("Expand"). */
export function openLightbox(render: () => ReactNode) {
  return openOverlay((close) => (
    <div className="nc-lightbox" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="nc-lightbox-close" role="button" aria-label="Close" onClick={close}><Icon name="close" size={20} /></div>
      <div className="nc-lightbox-body">{render()}</div>
    </div>
  ), { backdrop: 'dim', placement: 'center', className: 'nc-lightbox-overlay' });
}

export function useStableId(prefix: string) {
  return useMemo(() => `${prefix}-${Math.random().toString(36).slice(2, 9)}`, [prefix]);
}

export function blockElement(blockId: string): HTMLElement | null {
  return document.querySelector(`.lit-page-content [data-block-id="${blockId}"]`) ?? document.querySelector(`[data-block-id="${blockId}"]`);
}

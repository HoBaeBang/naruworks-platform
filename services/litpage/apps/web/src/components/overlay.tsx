
// rect or point, with viewport flipping, click-outside/Escape dismissal and nesting (submenus).
import { create } from 'zustand';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './overlay.css';

export type Anchor = HTMLElement | DOMRect | { x: number; y: number; width?: number; height?: number };

export type Placement = 'bottom-start' | 'bottom-end' | 'bottom' | 'top-start' | 'top' | 'top-end' | 'right-start' | 'left-start' | 'right' | 'left' | 'center' | 'middle';

export interface OverlayOptions {
  anchor?: Anchor;
  placement?: Placement;
  offset?: number;
  backdrop?: 'transparent' | 'dim' | 'none';
  onClose?: () => void;
  width?: number;
  closeOnEscape?: boolean;
  
  noFocus?: boolean;
  className?: string;
  
  parent?: number;
  zIndex?: number;
}

interface OverlayEntry {
  id: number;
  render: (close: () => void) => ReactNode;
  opts: OverlayOptions;
}

interface OverlayState {
  stack: OverlayEntry[];
  open: (render: OverlayEntry['render'], opts?: OverlayOptions) => number;
  close: (id: number) => void;
  closeAll: () => void;
}

let seq = 1;

export const useOverlays = create<OverlayState>((set, get) => ({
  stack: [],
  open(render, opts = {}) {
    const id = seq++;
    set({ stack: [...get().stack, { id, render, opts }] });
    return id;
  },
  close(id) {
    const stack = get().stack;
    const toClose = new Set<number>([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const e of stack) if (e.opts.parent && toClose.has(e.opts.parent) && !toClose.has(e.id)) { toClose.add(e.id); changed = true; }
    }
    const closing = stack.filter((e) => toClose.has(e.id));
    set({ stack: stack.filter((e) => !toClose.has(e.id)) });
    for (const e of closing.reverse()) e.opts.onClose?.();
  },
  closeAll() {
    const stack = get().stack;
    set({ stack: [] });
    for (const e of [...stack].reverse()) e.opts.onClose?.();
  },
}));

export function openOverlay(render: (close: () => void) => ReactNode, opts?: OverlayOptions): () => void {
  const id = useOverlays.getState().open(render, opts);
  return () => useOverlays.getState().close(id);
}

export function overlayCount() {
  return useOverlays.getState().stack.length;
}

function anchorRect(a: Anchor | undefined): DOMRect {
  if (!a) return new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
  if (a instanceof HTMLElement) {
    
    
    
    const r = a.getBoundingClientRect();
    return new DOMRect(r.left, r.top, a.offsetWidth || r.width, a.offsetHeight || r.height);
  }
  // Rect anchors (text ranges, measured boxes) use whole-pixel sizes for consistent popup placement.
  
  if (a instanceof DOMRect) return new DOMRect(a.x, a.y, Math.round(a.width), Math.round(a.height));
  return new DOMRect(a.x, a.y, Math.round(a.width ?? 0), Math.round(a.height ?? 0));
}

function position(rect: DOMRect, size: { w: number; h: number }, placement: Placement, offset: number) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const m = 12;
  let x = rect.left;
  let y = rect.bottom + offset;
  const [side, align] = placement.split('-') as [string, string | undefined];
  if (placement === 'center') {
    return { x: Math.max(m, (vw - size.w) / 2), y: Math.max(m, Math.min(vh * 0.2, (vh - size.h) / 2)) };
  }
  if (placement === 'middle') {
    return { x: Math.max(m, (vw - size.w) / 2), y: Math.max(m, (vh - size.h) / 2) };
  }
  if (side === 'bottom' || side === 'top') {
    x = align === 'end' ? rect.right - size.w : align === 'start' ? rect.left : rect.left + rect.width / 2 - size.w / 2;
    y = side === 'bottom' ? rect.bottom + offset : rect.top - offset - size.h;
    if (side === 'bottom' && y + size.h > vh - m && rect.top - offset - size.h > m) y = rect.top - offset - size.h;
    if (side === 'top' && y < m && rect.bottom + offset + size.h < vh - m) y = rect.bottom + offset;
  } else {
    y = align === 'start' ? rect.top - 4 : rect.top + rect.height / 2 - size.h / 2;
    x = side === 'right' ? rect.right + offset : rect.left - offset - size.w;
    if (side === 'right' && x + size.w > vw - m) x = rect.left - offset - size.w;
    if (side === 'left' && x < m) x = rect.right + offset;
  }
  x = Math.max(m, Math.min(x, vw - size.w - m));
  y = Math.max(m, Math.min(y, vh - size.h - m));
  return { x, y };
}

function OverlayItem({ entry, top }: { entry: OverlayEntry; top: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const close = () => useOverlays.getState().close(entry.id);
  const { opts } = entry;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const place = () => {
      // layout size (offset*), not getBoundingClientRect: the nc-pop-in scale(0.97) animation would shrink it and
      // push top-placed popovers ~3% too low
      let w = el.offsetWidth || el.getBoundingClientRect().width;
      let h = el.offsetHeight || el.getBoundingClientRect().height;
      // offset* are rounded to whole px; the computed size keeps the fraction (e.g. a 40vh-tall list = 341.2px), so a
      
      const cs = getComputedStyle(el);
      const fw = parseFloat(cs.width), fh = parseFloat(cs.height);
      if (Math.abs(fw - w) < 1) w = fw;
      if (Math.abs(fh - h) < 1) h = fh;
      setPos(position(anchorRect(opts.anchor), { w, h }, opts.placement ?? 'bottom-start', opts.offset ?? 4));
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(el);
    window.addEventListener('resize', place);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', place);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!top || opts.closeOnEscape === false) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);

  const style: CSSProperties = {
    position: 'fixed',
    left: pos?.x ?? -9999,
    top: pos?.y ?? -9999,
    width: opts.width,
    pointerEvents: 'auto',
    zIndex: opts.zIndex,
  };
  return (
    <>
      {opts.backdrop !== 'none' && (
        <div
          className={`nc-overlay-backdrop ${opts.backdrop === 'dim' ? 'dim' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            close();
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            close();
          }}
        />
      )}
      <div ref={ref} style={style} className={`nc-overlay ${opts.className ?? ''}`} data-overlay-id={entry.id}>
        {entry.render(close)}
      </div>
    </>
  );
}

export function OverlayRoot() {
  const stack = useOverlays((s) => s.stack);
  return (
    <div className="lit-overlay-container lit-default-overlay-container">
      {stack.map((e, i) => (
        <OverlayItem key={e.id} entry={e} top={i === stack.length - 1} />
      ))}
    </div>
  );
}


export function PopoverSurface({ children, width, maxHeight = '70vh', style, className }: { children: ReactNode; width?: number | string; maxHeight?: string | number; style?: CSSProperties; className?: string }) {
  return (
    <div className={`nc-popover ${className ?? ''}`} role="dialog" style={{ width, maxHeight, ...style }}>
      {children}
    </div>
  );
}

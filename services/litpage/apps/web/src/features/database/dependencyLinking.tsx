// Timeline "drag to connect": with Dependencies on, hovering a bar shows a connector at its end; dragging
// it onto another item adds that item to this one's "Blocking" relation (the "Blocked by" side follows through the
// two-way relation sync), so the arrow appears and date shifting applies.
import { useEffect, useRef, useState } from 'react';
import { relationIdsOf } from '@nc/shared/relation/index.ts';
import type { BlockRecord } from '@nc/shared/records.ts';
import { getBlock } from '../../lib/blocks.ts';
import { setRelationValue } from './advanced/relations.ts';

export interface LinkLine { x1: number; y1: number; x2: number; y2: number; sourceId: string; targetId: string | null }

/** Add `targetId` to `sourceId`'s Blocking relation (no self links, no duplicates). */
export function addBlockingLink(sourceId: string, targetId: string, blockingProp: string): boolean {
  if (sourceId === targetId) return false;
  const src = getBlock(sourceId);
  if (!src) return false;
  const cur = relationIdsOf(src.properties?.[blockingProp] as never);
  if (cur.includes(targetId)) return false;
  setRelationValue(sourceId, blockingProp, [...cur, targetId], { action: 'addDependency' });
  return true;
}

/* * Pointer handling for connector drags inside the timeline canvas. `rows` are the rendered items in order; * `rowTop` = y of the first row inside the canvas; `rowHeight` per row.
*/
export function useDependencyLinking(opts: { blockingProp: string | undefined; rows: { row: BlockRecord }[]; rowTop: number; rowHeight: number }) {
  const [line, setLine] = useState<LinkLine | null>(null);
  const state = useRef<{ canvas: DOMRect; sourceId: string; x1: number; y1: number } | null>(null);
  const latest = useRef(opts);
  latest.current = opts;

  useEffect(() => {
    if (!line) return;
    const move = (e: PointerEvent) => {
      const s = state.current;
      if (!s) return;
      const x2 = e.clientX - s.canvas.left;
      const y2 = e.clientY - s.canvas.top;
      const idx = Math.floor((y2 - latest.current.rowTop) / latest.current.rowHeight);
      const target = latest.current.rows[idx]?.row.id ?? null;
      setLine({ x1: s.x1, y1: s.y1, x2, y2: y2 - latest.current.rowTop, sourceId: s.sourceId, targetId: target && target !== s.sourceId ? target : null });
    };
    const up = () => {
      const s = state.current;
      const l = lineRef.current;
      state.current = null;
      setLine(null);
      const prop = latest.current.blockingProp;
      if (!s || !l?.targetId || !prop) return;
      addBlockingLink(s.sourceId, l.targetId, prop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [!!line]); // eslint-disable-line react-hooks/exhaustive-deps

  const lineRef = useRef<LinkLine | null>(null);
  lineRef.current = line;

  /** Start dragging from the connector of `sourceId` (x1/y1 in canvas coordinates, y1 relative to the rows). */
  const start = (e: React.PointerEvent, sourceId: string) => {
    if (!opts.blockingProp) return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = (e.currentTarget as HTMLElement).closest('.nc-tl-canvas')?.getBoundingClientRect();
    if (!canvas) return;
    const dot = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x1 = dot.left + dot.width / 2 - canvas.left;
    const y1 = dot.top + dot.height / 2 - canvas.top - opts.rowTop;
    state.current = { canvas, sourceId, x1, y1 };
    setLine({ x1, y1, x2: x1, y2: y1, sourceId, targetId: null });
  };

  return { line, start };
}

// Decorations drawn under/after leaf text without touching the contenteditable DOM:
// - the active trigger "/query", "@query", "[[query" gets a temporary-input look
// (background + 5.5px outline of --lp-gray-bg-primary-transparent) and a ghost completion after it in --lp-text-tertiary
// ("/Type to search", "@Today")
// - a "pending" range (link popup open) keeps a gray highlight while focus is in the popup.
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { length } from '@nc/shared/richtext.ts';
import { useBlock } from '../../../lib/hooks.ts';
import { rectsForRange } from '../richTextDom.ts';
import { useEditor } from '../editorState.ts';
import { useTriggerUI } from './trigger.ts';
import { useDecor } from './LinkPopups.tsx';
import { valueOf } from './format.ts';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function leafFor(blockId: string, property: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${blockId}"][data-property="${property}"]`);
}

function useRangeBoxes(blockId: string | undefined, property: string, start: number, end: number, tick: unknown) {
  const [state, setState] = useState<{ host: HTMLElement; boxes: Box[]; font: React.CSSProperties } | null>(null);
  useLayoutEffect(() => {
    if (!blockId) {
      setState(null);
      return;
    }
    let raf = requestAnimationFrame(function measure() {
      const leaf = leafFor(blockId, property);
      const host = (leaf?.closest('.lit-page-content') as HTMLElement | null) ?? null;
      if (!leaf || !host) {
        setState(null);
        return;
      }
      const hr = host.getBoundingClientRect();
      const rects = rectsForRange(leaf, start, end).filter((r) => r.width > 0 || r.height > 0);
      const cs = getComputedStyle(leaf);
      const font: React.CSSProperties = { fontSize: cs.fontSize, fontWeight: cs.fontWeight as any, fontFamily: cs.fontFamily, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing };
      let boxes = rects.map((r) => ({ left: r.left - hr.left, top: r.top - hr.top, width: r.width, height: r.height }));
      if (!boxes.length && start === end) {
        // empty range (e.g. caret right after the trigger was deleted): use the caret position
        const lr = leaf.getBoundingClientRect();
        boxes = [{ left: lr.left - hr.left, top: lr.top - hr.top + parseFloat(cs.paddingTop || '0'), width: 0, height: parseFloat(cs.lineHeight) || 24 }];
      }
      setState({ host, boxes, font });
      raf = 0;
    });
    return () => { if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId, property, start, end, tick]);
  return state;
}

function TriggerToken() {
  const slash = useEditor((s) => s.slash);
  const ghost = useTriggerUI((s) => s.ghost);
  const block = useBlock(slash?.blockId);
  const value = slash ? valueOf(slash.blockId, slash.property) : [];
  const end = slash ? Math.min(slash.start + slash.trigger.length + slash.query.length, length(value)) : 0;
  const m = useRangeBoxes(slash?.blockId, slash?.property ?? 'title', slash?.start ?? 0, end, block);
  const ghostRef = useRef<HTMLSpanElement>(null);
  const [ghostW, setGhostW] = useState(0);
  useLayoutEffect(() => {
    setGhostW(ghostRef.current?.offsetWidth ?? 0);
  }, [ghost, m]);
  if (!slash || !m || !m.boxes.length || slash.trigger === ':') return null;
  const last = m.boxes[m.boxes.length - 1];
  return createPortal(
    <>
      {m.boxes.map((b, i) => (
        <div
          key={i}
          className="lit-temporary-input nc-trigger-box"
          style={{ left: b.left, top: b.top, width: b.width + (i === m.boxes.length - 1 ? ghostW : 0), height: b.height }}
        />
      ))}
      {ghost && (
        <span ref={ghostRef} className="nc-trigger-ghost" style={{ ...m.font, left: last.left + last.width, top: last.top, height: last.height, lineHeight: `${last.height}px` }}>
          {ghost}
        </span>
      )}
    </>,
    m.host,
  );
}

function PendingRange() {
  const pending = useDecor((s) => s.pending);
  const block = useBlock(pending?.blockId);
  const m = useRangeBoxes(pending?.blockId, pending?.property ?? 'title', pending?.start ?? 0, pending?.end ?? 0, block);
  if (!pending || !m) return null;
  // Pending highlight covers the whole line box, 24px for body text, not just the glyph box
  const lh = parseFloat(String(m.font.lineHeight)) || 0;
  return createPortal(
    <>
      {m.boxes.map((b, i) => {
        const h = lh > b.height ? lh : b.height;
        return <div key={i} className="nc-pending-range" style={{ left: b.left, top: b.top - (h - b.height) / 2, width: b.width, height: h }} />;
      })}
    </>,
    m.host,
  );
}

export function TriggerDecor() {
  return (
    <>
      <TriggerToken />
      <PendingRange />
    </>
  );
}

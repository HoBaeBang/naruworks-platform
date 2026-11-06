// Presentation mode (•••  → More → Present, ⌘⌥P, ⋮⋮ / slash "Present from here"): the page becomes full-screen
// slides — a title slide (icon + title), then one slide per run of top-level blocks between dividers; empty blocks are
// dropped, comments hidden, toggles start closed and open with a click. Arrow keys / on-screen arrows navigate, Esc or
// × exits. The editor dispatches `nc:present` {pageId, blockId}; this module takes it (detail.handled = true).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { length, toPlainText } from '@nc/shared/richtext.ts';
import { openOverlay } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { getBlock } from '../../lib/blocks.ts';
import { getLocation } from '../../lib/router.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { StaticBlockList } from './StaticBlocks.tsx';
import './present.css';

function slidesOf(pageId: string): string[][] {
  const page = getBlock(pageId);
  const slides: string[][] = [];
  let cur: string[] = [];
  for (const id of page?.content ?? []) {
    const b = getBlock(id);
    if (!b || !b.alive) continue;
    if (b.type === 'divider') {
      if (cur.length) slides.push(cur);
      cur = [];
      continue;
    }
    const empty = b.type === 'text' && length(b.properties?.title) === 0 && !b.content?.length;
    if (!empty) cur.push(id);
  }
  if (cur.length) slides.push(cur);
  return slides;
}

/** The top-level block of `pageId` holding `blockId` (a block inside a toggle, column, callout … starts its slide). */
function topLevelOf(pageId: string, blockId: string): string | null {
  let cur = getBlock(blockId);
  for (let i = 0; cur && i < 100; i++) {
    if (cur.parent_table !== 'block') return null;
    if (cur.parent_id === pageId) return cur.id;
    cur = getBlock(cur.parent_id);
  }
  return null;
}

/** Slide (1-based; 0 = title slide) "Present from here" starts on: the one holding the block, or for a divider / an
 *  empty block (not shown) the next one. */
function slideIndexFor(pageId: string, slides: string[][], blockId: string | undefined): number {
  const top = blockId ? topLevelOf(pageId, blockId) : null;
  if (!top) return 0;
  const hit = slides.findIndex((sl) => sl.includes(top));
  if (hit >= 0) return hit + 1;
  const order = getBlock(pageId)?.content ?? [];
  const at = order.indexOf(top);
  const next = slides.findIndex((sl) => order.indexOf(sl[0]) > at);
  return next >= 0 ? next + 1 : 0;
}

let presenting = false;

export function startPresentation(pageId: string, fromBlockId?: string) {
  // one presentation at a time (repeated ⌘⌥P / menu clicks don't stack overlays)
  if (!getBlock(pageId) || presenting) return;
  presenting = true;
  openOverlay((close) => <Presentation pageId={pageId} close={close} fromBlockId={fromBlockId} />, {
    placement: 'center', backdrop: 'none', className: 'nc-present-overlay', closeOnEscape: true, onClose: () => { presenting = false; },
  });
  void document.documentElement.requestFullscreen?.().catch(() => {});
}

function Presentation({ pageId, close, fromBlockId }: { pageId: string; close: () => void; fromBlockId?: string }) {
  const page = getBlock(pageId) as BlockRecord;
  const slides = slidesOf(pageId);
  const startIdx = slideIndexFor(pageId, slides, fromBlockId);
  const [i, setI] = useState(startIdx);
  const total = slides.length + 1;
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / 1280, window.innerHeight / 720));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) { e.preventDefault(); setI((x) => Math.min(total - 1, x + 1)); }
      if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    };
    // leaving full screen ends the presentation — but only a real exit: headless / denied requests enter and leave
    // immediately, which must not close the slides right away
    let enteredAt = 0;
    const onFs = () => {
      if (document.fullscreenElement) enteredAt = Date.now();
      else if (enteredAt && Date.now() - enteredAt > 600) close();
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    };
  }, [total, close]);
  return (
    <div className="nc-present" role="dialog" aria-label="Presentation">
      <div className="nc-present-stage" ref={stageRef} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
        {i === 0 ? (
          <div className="nc-present-title-slide">
            {page.format?.page_icon && <PageIcon block={page} size={96} />}
            <h1>{toPlainText(page.properties?.title) || 'Untitled'}</h1>
          </div>
        ) : (
          <div className="nc-present-slide lit-page-content">
            <StaticBlockList key={i} ids={slides[i - 1] ?? []} get={(id) => getBlock(id)} togglesClosed />
          </div>
        )}
      </div>
      <div className="nc-present-controls">
        <div role="button" aria-label="Previous slide" className={`nc-icon-btn ${i === 0 ? 'disabled' : ''}`} onClick={() => setI((x) => Math.max(0, x - 1))}><Icon name="chevronLeft" size={18} /></div>
        <span className="count">{i + 1} / {total}</span>
        <div role="button" aria-label="Next slide" className={`nc-icon-btn ${i === total - 1 ? 'disabled' : ''}`} onClick={() => setI((x) => Math.min(total - 1, x + 1))}><Icon name="chevronRight" size={18} /></div>
        <div role="button" aria-label="Exit presentation" className="nc-icon-btn" onClick={close}><Icon name="close" size={18} /></div>
      </div>
    </div>
  );
}

window.addEventListener('nc:present', ((e: CustomEvent) => {
  const d = (e.detail ?? {}) as { pageId?: string; blockId?: string; handled?: boolean };
  if (!d.pageId) return;
  d.handled = true;
  startPresentation(d.pageId, d.blockId);
}) as EventListener);

// ⌘⌥P / Ctrl+Alt+P anywhere on a page (the editor handles it first when a block has focus: "Present from here")
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || !(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey || e.code !== 'KeyP') return;
  const { route } = getLocation();
  if (route.name !== 'page') return;
  e.preventDefault();
  startPresentation(route.pageId);
});

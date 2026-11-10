// Floating contents list: in .layout-margin-right (sticky),
// a 56px column of 2px dashes (16px for H1, 12px + 4px inset for deeper), gap 12px, the current heading in
// --lp-navigation-active-indicator and others in --lp-gray-bg-tertiary-transparent; hovering expands to the heading list. Shown with ≥2
// headings (not nested under other blocks); hidden via ••• → Appearance & layout → Contents list.
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { HEADING_TYPES } from '@nc/shared/blocks.ts';
import { useBlock, useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';

function headingsOf(page: BlockRecord | undefined): BlockRecord[] {
  const out: BlockRecord[] = [];
  const walk = (ids: string[] | undefined) => {
    for (const id of ids ?? []) {
      const b = records.get<BlockRecord>('block', id);
      if (!b || !b.alive) continue;
      if (HEADING_TYPES.has(b.type)) out.push(b);
      else if (b.type === 'column_list' || b.type === 'column') walk(b.content);
    }
  };
  walk(page?.content);
  return out;
}

const RANK: Record<string, number> = { header: 0, sub_header: 1, sub_sub_header: 2, header_4: 3 };
/** Level relative to the highest heading on the page (a page starting at H2 indents H3 by one step). */
const relLevel = (t: string, min: number) => Math.min(3, Math.max(0, (RANK[t] ?? 2) - min));

export function TableOfContentsRail({ pageId, scroller }: { pageId: string; scroller: RefObject<HTMLDivElement | null> }) {
  const page = useBlock(pageId);
  useTableVersion(['block']);
  const [hover, setHover] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [top, setTop] = useState(350);
  const [height, setHeight] = useState(600);
  const railRef = useRef<HTMLDivElement>(null);
  const headings = headingsOf(page);
  const ids = headings.map((h) => h.id).join(',');
  const minRank = Math.min(...headings.map((h) => RANK[h.type] ?? 2));
  const level = (t: string) => relLevel(t, minRank);

  useLayoutEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const update = () => {
      const sr = sc.getBoundingClientRect();
      setHeight(sc.clientHeight);
      const title = sc.querySelector('.nc-page-title');
      const titleTop = title ? title.getBoundingClientRect().top - sr.top : 350;
      // first dash 130px below the frame top whatever the scroll position
      setTop(Math.max(130, Math.min(titleTop, sc.clientHeight - 120)));
      let cur: string | null = null;
      for (const id of ids.split(',')) {
        if (!id) continue;
        const el = sc.querySelector(`[data-block-id="${id}"]`);
        if (el && el.getBoundingClientRect().top - sr.top < sc.clientHeight * 0.3) cur = id;
      }
      setActive(cur ?? ids.split(',')[0] ?? null);
    };
    update();
    sc.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      sc.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [scroller, ids]);

  useEffect(() => {
    if (!hover) return;
    const el = railRef.current?.querySelector('.nc-toc-item.active');
    el?.scrollIntoView({ block: 'nearest' });
  }, [hover]);

  if (headings.length < 2) return null;
  const go = (id: string) => {
    const sc = scroller.current;
    const el = sc?.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
    if (!sc || !el) return;
    sc.scrollTo({ top: sc.scrollTop + el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 80, behavior: 'smooth' });
  };
  return (
    <div className="layout-margin-right nc-toc-margin">
      <div className="hide-scrollbar ignore-scrolling-container lit-floating-table-of-contents" style={{ height }}>
        <div
          ref={railRef}
          className={`nc-toc ${hover ? 'open' : ''}`}
          style={{ top }}
          onMouseEnter={() => setHover(true)}
          onMouseLeave={() => setHover(false)}
        >
          {hover ? (
            <div className="nc-toc-panel" role="navigation" aria-label="Contents list">
              <div className="nc-toc-panel-list">
              {headings.map((h) => (
                <div
                  key={h.id}
                  role="button"
                  className={`nc-toc-item ${active === h.id ? 'active' : ''}`}
                  style={{ paddingInlineStart: 10 + 12 * level(h.type) }}
                  onClick={() => go(h.id)}
                >
                  {toPlainText(h.properties?.title) || 'Untitled'}
                </div>
              ))}
              </div>
            </div>
          ) : (
            <div className="nc-toc-dashes">
              {headings.map((h) => (
                <div key={h.id} className="nc-toc-dash-wrap">
                  <div className={`nc-toc-dash level-${level(h.type)} ${active === h.id ? 'active' : ''}`} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

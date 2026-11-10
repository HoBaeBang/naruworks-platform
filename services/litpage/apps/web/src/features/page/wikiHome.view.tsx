// Wiki "Home" view (collection_view type 'page'): the wiki page's own blocks, edited like any page,
// shown as the first tab of a wiki next to "All pages" / "Pages I manage". Auto-registered (*.view.tsx).
import { useLayoutEffect, useRef } from 'react';
import { BlockList } from '../editor/Block.tsx';
import { EditorSurface } from '../editor/EditorSurface.tsx';
import { appendToPage } from '../editor/commands.ts';
import { useBlock } from '../../lib/hooks.ts';
import { registerView, type ViewProps } from '../database/viewRegistry.ts';

function WikiHomeView({ block, readOnly }: ViewProps) {
  const live = useBlock(block.id) ?? block;
  const host = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    scroller.current = (host.current?.closest('.nc-page-scroller') as HTMLDivElement | null) ?? null;
  }, []);
  return (
    <div ref={host} className={`nc-wiki-home ${live.format?.page_full_width ? 'full' : ''}`} data-wiki-home={block.id}>
      <EditorSurface pageId={block.id} readOnly={readOnly} scroller={scroller}>
        <div className="lit-page-content">
          <BlockList parentId={block.id} ids={live.content} depth={0} readOnly={readOnly} />
          {!readOnly && <div className="nc-click-to-append" onMouseDown={(e) => { e.preventDefault(); appendToPage(block.id); }} />}
        </div>
      </EditorSurface>
    </div>
  );
}

registerView('page', WikiHomeView);

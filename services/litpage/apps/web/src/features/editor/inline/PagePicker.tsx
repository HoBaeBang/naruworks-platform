// Small page picker popover (search input + page results) for "Turn into › Page in" and "Add a page in…".
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { breadcrumbOf, pageOrNull, usePageSearch } from './pageSearch.ts';

export interface PagePickerOpts {
  placeholder?: string;
  exclude?: string[];
  onPick: (pageId: string) => void;
  onClose?: () => void;
}

export function openPagePicker(anchor: Anchor, opts: PagePickerOpts) {
  return openOverlay((close) => <PagePicker {...opts} close={close} />, { anchor, placement: 'bottom-start', offset: 6, onClose: opts.onClose });
}

function PagePicker({ placeholder, exclude, onPick, close }: PagePickerOpts & { close: () => void }) {
  const [q, setQ] = useState('');
  const hits = usePageSearch(q, { limit: 12, exclude });
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [q]);
  const pick = (id: string) => {
    close();
    onPick(id);
  };
  return (
    <PopoverSurface width={330} maxHeight="40vh" className="nc-page-picker">
      <div className="nc-menu-search">
        <div className="nc-input focused">
          <input
            autoFocus
            placeholder={placeholder ?? 'Find a page…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.ids.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing && hits.ids[active]) { e.preventDefault(); pick(hits.ids[active]); }
            }}
          />
        </div>
      </div>
      <div className="lit-scroller vertical nc-menu-scroll" role="listbox">
        <div className="nc-menu-section">
          <div className="nc-menu-section-title">{q ? 'Pages' : 'Recents'}</div>
          {hits.ids.map((id, i) => {
            const b = pageOrNull(id) as BlockRecord | undefined;
            const crumb = breadcrumbOf(id);
            return (
              <div key={id} role="option" aria-selected={i === active} className={`nc-menu-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(id)}>
                <div className="nc-menu-item-inner">
                  <div className="nc-menu-icon"><PageIcon block={b} size={20} /></div>
                  <div className="nc-menu-label">
                    <div className="nc-ellipsis">{pageTitle(b) || 'New page'}</div>
                    {crumb && <div className="nc-menu-desc nc-ellipsis">{crumb}</div>}
                  </div>
                </div>
              </div>
            );
          })}
          {!hits.loading && !hits.ids.length && <div className="nc-menu-empty">No results</div>}
        </div>
      </div>
    </PopoverSurface>
  );
}

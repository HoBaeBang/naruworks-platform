// Searchable page picker (connection › Content access › Add pages): title search through api('searchWorkspace') with results
// as you type. Only pages you can open are returned by the server.
import { useEffect, useState } from 'react';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';

function titleOf(b: BlockRecord | undefined): string {
  if (!b) return '';
  if ((b.type === 'collection_view_page' || b.type === 'collection_view') && b.collection_id) {
    const n = toPlainText(records.get<CollectionRecord>('collection', b.collection_id)?.name);
    if (n) return n;
  }
  return toPlainText(b.properties?.title) || t('lp.developer.untitled', 'Untitled');
}

function Picker({ close, onPick }: { close: () => void; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => {
      void api<{ results?: { id: string }[]; recordMap?: any }>('searchWorkspace', { query: q, spaceId: useSession.getState().spaceId, limit: 20, filters: { titleOnly: true } })
        .then((r) => {
          if (!live) return;
          if (r.recordMap) records.mergeRecordMap(r.recordMap);
          setIds((r.results ?? []).map((x) => x.id).filter((id) => {
            const b = records.get<BlockRecord>('block', id);
            return !!b && (b.type === 'page' || b.type === 'collection_view_page' || b.type === 'collection_view');
          }));
          setActive(0);
        })
        .catch(() => live && setIds([]));
    }, 120);
    return () => { live = false; clearTimeout(h); };
  }, [q]);
  const pick = (id: string) => { close(); onPick(id); };
  return (
    <PopoverSurface width={320} maxHeight={380}>
      <div style={{ padding: 8 }}>
        <input
          className="nc-dev-input"
          autoFocus
          placeholder={t('lp.developer.find_a_page', 'Find a page…')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, ids.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && ids[active]) { e.preventDefault(); pick(ids[active]); }
            else if (e.key === 'Escape') close();
          }}
        />
      </div>
      <div role="listbox" style={{ padding: '0 4px 6px' }}>
        {ids.map((id, i) => {
          const b = records.get<BlockRecord>('block', id);
          return (
            <div key={id} role="option" aria-selected={i === active} className={`nc-menu-item ${i === active ? 'active' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 8px', borderRadius: 6, cursor: 'pointer', background: i === active ? 'var(--lp-bg-interactive-transparent)' : undefined }} onMouseEnter={() => setActive(i)} onClick={() => pick(id)}>
              {b && <PageIcon block={b} size={18} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 14 }}>{titleOf(b)}</span>
            </div>
          );
        })}
        {!ids.length && <div style={{ padding: '6px 10px', fontSize: 13, color: 'var(--lp-text-tertiary)' }}>{t('lp.developer.no_results', 'No results')}</div>}
      </div>
    </PopoverSurface>
  );
}

export function pickPage(anchor: HTMLElement, onPick: (pageId: string) => void) {
  openOverlay((close) => <Picker close={close} onPick={onPick} />, { anchor, placement: 'bottom-end', offset: 4 });
}

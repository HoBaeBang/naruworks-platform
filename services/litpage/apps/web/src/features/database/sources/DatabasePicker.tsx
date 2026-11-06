// Destination pickers for data sources: "Move data source to…" (a database you can edit;) and the
// "Moving data source …" choice (dataSourceMoveToConfirmationModal: move with its views / move the data source only).
import { useState, type ReactNode } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { records } from '../../../lib/store/records.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { useDataSourceSearch } from '../chrome/LinkedSourcePicker.tsx';

function Picker({ title, exclude, onPick, close }: { title: string; exclude: string[]; onPick: (b: BlockRecord) => void; close: () => void }) {
  const [q, setQ] = useState('');
  const results = useDataSourceSearch(q);
  const blocks: BlockRecord[] = [];
  for (const r of results) {
    const b = records.get<BlockRecord>('block', r.blockId);
    if (!b || exclude.includes(b.id) || blocks.some((x) => x.id === b.id)) continue;
    if (!roleAtLeast(records.role('block', b.id), 'read_and_write') || (b.format as { block_locked?: boolean } | undefined)?.block_locked) continue;
    blocks.push(b);
  }
  return (
    <PopoverSurface width={320} className="nc-linked-picker" maxHeight="min(420px, 60vh)">
      <div className="nc-vs-header"><span className="nc-vs-title">{title}</span></div>
      <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Find a table…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-menu-scroll">
        <div className="nc-menu-section">
          {blocks.map((b) => {
            const title = results.find((r) => r.blockId === b.id)?.name ?? 'Untitled';
            return (
              <div key={b.id} role="menuitem" className="nc-menu-item nc-link-source-row" onClick={() => { close(); onPick(b); }}>
                <div className="nc-menu-item-inner">
                  <span className="nc-link-source-icon">{b.format?.page_icon ? <PageIcon block={b} size={20} /> : <Icon name="collection" size={20} />}</span>
                  <div className="nc-menu-label"><div className="nc-ellipsis">{title}</div></div>
                </div>
              </div>
            );
          })}
          {!blocks.length && <div className="nc-menu-empty">No results</div>}
        </div>
      </div>
    </PopoverSurface>
  );
}

export function openDatabasePicker(anchor: Anchor, opts: { title: string; exclude?: string[]; onPick: (b: BlockRecord) => void }) {
  return openOverlay((close) => <Picker title={opts.title} exclude={opts.exclude ?? []} onPick={opts.onPick} close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

/** A centered dialog with several actions + Cancel; resolves with the chosen key, or null when dismissed. */
export function choiceDialog<K extends string>(opts: { message: ReactNode; description?: ReactNode; choices: { key: K; label: string; primary?: boolean }[]; width?: number }): Promise<K | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: K | null, close: () => void) => {
      if (done) return;
      done = true;
      resolve(v);
      close();
    };
    openOverlay((close) => (
      <div className="nc-confirm" role="alertdialog" style={{ width: opts.width ?? 340 }}>
        <div className="nc-confirm-message">{opts.message}</div>
        {opts.description && <div className="nc-confirm-description">{opts.description}</div>}
        <div className="nc-confirm-buttons">
          {opts.choices.map((c, i) => (
            <button key={c.key} autoFocus={i === 0} className={`nc-dialog-btn ${c.primary ? 'primary' : 'outline'}`} onClick={() => finish(c.key, close)}>{c.label}</button>
          ))}
          <button className="nc-dialog-btn outline" onClick={() => finish(null, close)}>Cancel</button>
        </div>
      </div>
    ), { placement: 'center', backdrop: 'dim', onClose: () => { if (!done) { done = true; resolve(null); } } });
  });
}

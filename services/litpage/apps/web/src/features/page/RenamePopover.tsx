// Inline rename popover used by the sidebar (icon button + title input).
import { useState } from 'react';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { getBlock, run, setTitle, setFormat } from '../../lib/blocks.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { openIconPicker } from './IconPicker.tsx';

export function openRenamePopover(pageId: string, anchor: HTMLElement) {
  openOverlay((close) => <Rename pageId={pageId} close={close} />, { anchor, placement: 'bottom-start', offset: 2 });
}

function Rename({ pageId, close }: { pageId: string; close: () => void }) {
  const page = getBlock(pageId);
  const [v, setV] = useState(toPlainText(page?.properties?.title));
  return (
    <PopoverSurface width={360}>
      <div style={{ display: 'flex', gap: 6, padding: 6, alignItems: 'center' }}>
        <div role="button" className="nc-btn icon-only outline" onClick={(e) => openIconPicker(e.currentTarget, { current: page?.format?.page_icon as string, onPick: (val) => run('setIcon', (tx) => setFormat(tx, pageId, { page_icon: val ?? null } as any)) })}>
          <PageIcon block={page} size={18} />
        </div>
        <div className="nc-input" style={{ flex: 1 }}>
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { run('rename', (tx) => setTitle(tx, pageId, v ? [[v]] : [])); close(); } }} />
        </div>
      </div>
    </PopoverSurface>
  );
}

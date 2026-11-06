// Library multi-select actions: with rows checked, a bar above the table offers Move to (teamspace or
// page, one transaction), Edit icon (same icon on every selected page), Remove favorites (Favorites tab) and
// Delete (Trash, undoable toast); Esc / × clears the selection.
import { useEffect } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { Icon } from '../../../components/Icon.tsx';
import { records } from '../../../lib/store/records.ts';
import { currentSpaceView } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { deleteBlocksIn, run, setFormat } from '../../../lib/blocks.ts';
import { openMoveToDialog } from '../../page/MoveTo.tsx';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { restorePage } from '../../page/pageActions.ts';
import { t } from '../../shell/i18n.ts';
import type { PageTab } from './model.ts';

export function BulkBar({ tab, ids, onClear, onSelectAll }: { tab: PageTab; ids: string[]; onClear: () => void; onSelectAll: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.lit-overlay-container .nc-overlay')) onClear();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClear]);
  const pages = ids.map((id) => records.get<BlockRecord>('block', id)).filter(Boolean) as BlockRecord[];
  const editable = pages.filter((b) => ['editor', 'read_and_write'].includes(records.role('block', b.id)));
  const sv = currentSpaceView();

  const del = () => {
    const list = editable.map((b) => b.id);
    if (!list.length) return;
    run('deletePages', (tx) => {
      deleteBlocksIn(tx, list);
      for (const id of list) if (sv?.bookmarked_pages?.includes(id)) tx.listRemove('space_view', sv.id, ['bookmarked_pages'], id);
    });
    onClear();
    useUI.getState().toast(t('lp.home.moved_count_plural_one_other_to', 'Moved {count, plural, one {# page} other {# pages}} to Trash', { count: list.length }), {
      label: t('lp.home.undo', 'Undo'),
      run: () => { for (const id of list) restorePage(id); },
    });
  };
  const unfavorite = () => {
    if (!sv) return;
    run('removeFromFavorites', (tx) => { for (const id of ids) if (sv.bookmarked_pages?.includes(id)) tx.listRemove('space_view', sv.id, ['bookmarked_pages'], id); });
    onClear();
  };
  const editIcon = (anchor: HTMLElement) => openIconPicker(anchor, {
    current: undefined,
    onPick: (v) => run(v ? 'setPageIcon' : 'removePageIcon', (tx) => { for (const b of editable) setFormat(tx, b.id, { page_icon: v ?? null } as any); }),
  });
  return (
    <div className="nc-lib-bulkbar" role="toolbar" aria-label={t('lp.home.selection', 'Selection')}>
      <div className="nc-lib-bulk-count" role="button" onClick={onSelectAll} data-tooltip={t('lp.home.select_all', 'Select all')}>
        {t('lp.home.selected', '{count} selected', { count: ids.length })}
      </div>
      <div className="nc-lib-bulk-sep" />
      <div role="button" className="nc-lib-bulk-btn" aria-disabled={!editable.length} onClick={(e) => editable.length && openMoveToDialog(editable.map((b) => b.id), e.currentTarget as HTMLElement)}>
        <Icon name="arrowTurnUpRight" size={16} />{t('lp.home.move_to', 'Move to')}
      </div>
      <div role="button" className="nc-lib-bulk-btn" aria-disabled={!editable.length} onClick={(e) => editable.length && editIcon(e.currentTarget as HTMLElement)}>
        <Icon name="emojiFace" size={16} />{t('lp.home.edit_icon', 'Edit icon')}
      </div>
      {tab === 'favorites' && (
        <div role="button" className="nc-lib-bulk-btn" onClick={unfavorite}>
          <Icon name="star" size={16} />{t('lp.home.remove_from_favorites', 'Unfavorite')}
        </div>
      )}
      <div role="button" className="nc-lib-bulk-btn danger" aria-disabled={!editable.length} onClick={del}>
        <Icon name="trash" size={16} />{t('lp.home.delete', 'Delete')}
      </div>
      <div role="button" className="nc-lib-bulk-close" aria-label={t('lp.home.clear_selection', 'Clear selection')} onClick={onClear}>
        <Icon name="close" size={16} />
      </div>
    </div>
  );
}

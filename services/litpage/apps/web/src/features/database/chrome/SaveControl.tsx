// "Store for everyone" / "Reset": shown while a person's
// filters or sorts differ from the saved view (viewState.ts). Filter bar: gray "Reset" + orange "Store for everyone"
// split button (More storage options › Store as a new layout / Combine with advanced filter); people who can't change the view
// only get "Reset" with "Changes to filters & sorts in this layout are only visible to you.". View settings Filter /
// Sort pages: "{n} filters differ from the shared view" / "Your sort differs from the shared view",
// Store for everyone, Reset filters / Reset sorts, and the same extra options.
import type { ReactNode } from 'react';
import type { CollectionViewRecord } from '@nc/shared/records.ts';
import { records } from '../../../lib/store/records.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import {
  canSaveForEveryone, changedFilterCount, dirtyKind, mergeIntoAdvancedFilter, resetPersonal, saveAsNewView, saveForEveryone, tempStateOf, useViewTempVersion,
  type SaveScope,
} from '../viewState.ts';
import '../dbv.css';

const ONLY_YOU = 'Changes to filters & sorts in this layout are only visible to you.';

function selectView(viewId: string) {
  const v = records.get<CollectionViewRecord>('collection_view', viewId);
  if (v) window.dispatchEvent(new CustomEvent('nc:select-view', { detail: { blockId: v.parent_id, viewId } }));
}

/** Extra save options (More storage options / More options). */
function extraItems(view: CollectionViewRecord, scope: SaveScope, onDone?: () => void): MenuItemDef[] {
  const items: MenuItemDef[] = [];
  if (canSaveForEveryone(view)) {
    items.push({ id: 'new', label: 'Store as a new layout', icon: 'plus', onSelect: () => { const id = saveAsNewView(view.id); if (id) selectView(id); onDone?.(); } });
  }
  const t = tempStateOf(view.id);
  if (scope !== 'sorts' && (t?.propertyFilters?.length ?? 0) > 0) {
    items.push({ id: 'merge', label: 'Combine with advanced filter', icon: 'filter', description: 'Group rules with an advanced filter and combine AND/OR conditions.', onSelect: () => { mergeIntoAdvancedFilter(view.id); onDone?.(); } });
  }
  return items;
}

/** Right end of the filter bar. */
export function FilterBarSaveControl({ view }: { view: CollectionViewRecord }) {
  useViewTempVersion();
  if (!dirtyKind(view)) return null;
  const reset = (
    <div role="button" className="nc-save-reset" onClick={() => resetPersonal(view.id)}>Reset</div>
  );
  if (!canSaveForEveryone(view)) {
    return <div className="nc-save-control" data-tooltip={ONLY_YOU}>{reset}</div>;
  }
  const extra = extraItems(view, 'all');
  return (
    <div className="nc-save-control">
      {reset}
      <div className={`nc-save-everyone ${extra.length ? 'split' : ''}`}>
        <div role="button" className="nc-save-everyone-main" onClick={() => saveForEveryone(view.id)}>Store for everyone</div>
        {extra.length > 0 && (
          <div role="button" className="nc-save-everyone-more" aria-label="More storage options" onClick={(e) => openMenu(e.currentTarget, { width: 250, sections: [{ items: extraItems(view, 'all') }] }, { placement: 'bottom-end' })}>
            <Icon name="arrowChevronSingleDownSmall" size={14} />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ icon, label, tone, onClick }: { icon: string; label: ReactNode; tone?: 'orange' | 'gray'; onClick: (e: React.MouseEvent<HTMLDivElement>) => void }) {
  return (
    <div role="menuitem" className={`nc-menu-item nc-vs-row nc-save-row ${tone ?? ''}`} onClick={onClick} onMouseDown={(e) => e.preventDefault()}>
      <div className="nc-menu-item-inner">
        <div className="nc-menu-icon"><Icon name={icon} size={20} /></div>
        <div className="nc-menu-label">{label}</div>
      </div>
    </div>
  );
}

/** View settings › Filter / Sort pages (contexts SettingsFilters / SettingsSort). */
export function SettingsSaveControl({ view, scope }: { view: CollectionViewRecord; scope: 'filters' | 'sorts' }) {
  useViewTempVersion();
  const kind = dirtyKind(view);
  if (!kind || (kind !== 'both' && kind !== scope)) return null;
  const canSave = canSaveForEveryone(view);
  const n = scope === 'filters' ? changedFilterCount(view) : 0;
  const caption = scope === 'filters'
    ? `${n} ${n === 1 ? 'filter differs' : 'filters differ'} from the shared view`
    : 'Your sort differs from the shared view';
  const extra = canSave ? extraItems(view, scope) : [];
  return (
    <div className="nc-menu-section nc-save-settings">
      {canSave ? <div className="nc-save-caption">{caption}</div> : <div className="nc-save-caption">{ONLY_YOU}</div>}
      {canSave && <Row icon="check" tone="orange" label="Store for everyone" onClick={() => saveForEveryone(view.id, scope)} />}
      <Row icon="undo" tone="gray" label={scope === 'filters' ? 'Reset filters' : 'Reset sorts'} onClick={() => resetPersonal(view.id, scope)} />
      {extra.map((it) => <Row key={it.id} icon={String(it.icon ?? 'plus')} tone="gray" label={it.label} onClick={() => it.onSelect?.()} />)}
    </div>
  );
}

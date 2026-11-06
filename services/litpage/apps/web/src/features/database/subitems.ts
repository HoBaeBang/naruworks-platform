// Sub-items on the client (…009): turn on / off, per-view display & filter options, nested-row expansion
// state (per view, remembered on this device), "New sub-item".
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { subitemConfigOf, type SubitemDisplayMode, type SubitemFilterScope } from '@nc/shared/database/index.ts';
import { records } from '../../lib/store/records.ts';
import { run } from '../../lib/blocks.ts';
import { createRow, newPropertyId, nullify, updateViewFormat } from './actions.ts';
import { isTaskDatabase } from './taskdb.ts';

/** Words of a database’s items: “item” or “task” in a Tasks database. */
export function itemNoun(collection: CollectionRecord | undefined): { item: string; items: string } {
  return isTaskDatabase(collection) ? { item: 'task', items: 'tasks' } : { item: 'item', items: 'items' };
}

/* * "Turn on sub-items": an existing self relation (its two-way counterpart becomes the parent side) or a new pair * "Sub-item" / "Parent item" (Parent limited to 1 page). Views keep their settings (default: nested in toggle).
*/
export function turnOnSubitems(collection: CollectionRecord, opts: { relation?: string; name?: string } = {}): string {
  let sub = opts.relation;
  const noun = itemNoun(collection).item;
  run('subitems.turnOn', (tx) => {
    const pointer = { id: collection.id, table: 'collection', spaceId: collection.space_id };
    if (sub && collection.schema[sub]?.type === 'relation') {
      const p = collection.schema[sub];
      let inverse = p.property as string | undefined;
      if (!inverse || inverse === sub || !collection.schema[inverse]) {
        // a one-way (or symmetric) self relation gets a parent counterpart
        inverse = newPropertyId(collection.schema);
        tx.set('collection', collection.id, ['schema', inverse], { name: `Parent ${noun}`, type: 'relation', collection_id: collection.id, collection_pointer: pointer, property: sub, version: 'v2', limit: 1, autoRelate: { enabled: false } } as PropertySchema);
        tx.update('collection', collection.id, ['schema', sub], { property: inverse });
      }
    } else {
      sub = newPropertyId(collection.schema);
      const inverse = newPropertyId({ ...collection.schema, [sub]: true });
      tx.set('collection', collection.id, ['schema', sub], { name: opts.name?.trim() || `Sub-${noun}`, type: 'relation', collection_id: collection.id, collection_pointer: pointer, property: inverse, version: 'v2', autoRelate: { enabled: false } } as PropertySchema);
      tx.set('collection', collection.id, ['schema', inverse], { name: `Parent ${noun}`, type: 'relation', collection_id: collection.id, collection_pointer: pointer, property: sub, version: 'v2', limit: 1, autoRelate: { enabled: false } } as PropertySchema);
    }
    tx.update('collection', collection.id, ['format'], { subitem_property: sub });
  });
  return sub ?? '';
}

/** "Turn off sub-items" for the data source ("Remove properties" deletes the relation pair, restorable). */
export function turnOffSubitems(collection: CollectionRecord, removeProperties: boolean) {
  const cfg = subitemConfigOf(collection);
  run('subitems.turnOff', (tx) => {
    tx.update('collection', collection.id, ['format'], nullify({ subitem_property: undefined }));
    if (removeProperties && cfg) {
      for (const pid of [cfg.property, cfg.inverse]) {
        const p = collection.schema[pid];
        if (!p) continue;
        tx.set('collection', collection.id, ['deleted_schema', pid], { ...p, deleted_time: Date.now() });
        tx.set('collection', collection.id, ['schema', pid], undefined);
      }
    }
  });
}

export function setSubitemDisplayMode(view: CollectionViewRecord, mode: SubitemDisplayMode) {
  updateViewFormat(view.id, { subitem_display_mode: mode }, 'subitems.setDisplayMode');
}

export function setSubitemFilterScope(view: CollectionViewRecord, scope: SubitemFilterScope) {
  updateViewFormat(view.id, { subitem_filter_scope: scope }, 'subitems.setFilterScope');
}

/** Switch which relation nests sub-items (Advanced settings › Property). */
export function setSubitemProperty(collection: CollectionRecord, relation: string) {
  turnOnSubitems(collection, { relation });
}

// ------------------------------------------------------------------ expansion state (per view, this device)

const KEY = 'nc:subitemsExpanded';

function load(): Record<string, string[]> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

interface ExpansionState {
  open: Record<string, string[]>;
  toggle: (viewId: string, rowId: string, open?: boolean) => void;
}

export const useSubitemExpansion = create<ExpansionState>((set, get) => ({
  open: load(),
  toggle: (viewId, rowId, open) => {
    const cur = new Set(get().open[viewId] ?? []);
    const next = open ?? !cur.has(rowId);
    if (next) cur.add(rowId);
    else cur.delete(rowId);
    const all = { ...get().open, [viewId]: [...cur].slice(-500) };
    set({ open: all });
    try {
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  },
}));

export function useIsExpanded(viewId: string): (rowId: string) => boolean {
  const ids = useSubitemExpansion((s) => s.open[viewId]);
  const set = new Set(ids ?? []);
  return (rowId) => set.has(rowId);
}

/** "New sub-item" under `parent` (expanded so the new row shows), returns the new row id. */
export function addSubitem(parent: BlockRecord, view: CollectionViewRecord | undefined, opts: { title?: string } = {}): string {
  const c = parent.parent_table === 'collection' ? records.get<CollectionRecord>('collection', parent.parent_id) : undefined;
  if (!c || !subitemConfigOf(c)) return '';
  if (view) useSubitemExpansion.getState().toggle(view.id, parent.id, true);
  return createRow(c.id, { view, parentId: parent.id, position: 'end', title: opts.title ? [[opts.title]] : undefined, action: 'subitems.add' });
}

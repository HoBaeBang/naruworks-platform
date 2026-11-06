// Previous / next page in a peek: the peek header's ↑ / ↓ buttons and Ctrl+Shift+K / Ctrl+Shift+J
// (Windows / Linux: Alt+K / Alt+J) walk the rows in the order of the view the page was opened from — its filters,
// sorts, groups and search — (peekRenderer: disabled on the first / last record of that list).
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { runQuery } from '@nc/shared/database/index.ts';
import { records } from '../../lib/store/records.ts';
import { collectionRows, makeQueryContext } from './data.ts';
import { effectiveView } from './viewState.ts';

interface PeekSource {
  viewId: string;
  collectionId: string;
  search: string;
}

let source: PeekSource | null = null;

/** Remember the view a row was opened from (DatabaseView.openRow). */
export function setPeekSource(s: PeekSource | null) {
  source = s;
}

/** The view a peeked page was opened from (its database's rows only): where "Switch peek mode" saves "Open pages in". */
export function peekSourceViewId(pageId: string): string | null {
  const page = records.get<BlockRecord>('block', pageId);
  if (!source || !page || page.parent_table !== 'collection' || page.parent_id !== source.collectionId) return null;
  const view = records.get<CollectionViewRecord>('collection_view', source.viewId);
  return view && view.alive !== false ? view.id : null;
}

/** Row ids around `pageId`: the source view's visible order, else the data source's rows in creation order. */
export function peekOrder(pageId: string): string[] {
  const page = records.get<BlockRecord>('block', pageId);
  if (!page || page.parent_table !== 'collection') return [];
  const collection = records.get<CollectionRecord>('collection', page.parent_id);
  if (!collection) return [];
  const raw = source && source.collectionId === collection.id ? records.get<CollectionViewRecord>('collection_view', source.viewId) : undefined;
  if (raw && raw.alive !== false) {
    const res = runQuery(collectionRows(collection.id), collection, effectiveView(raw), makeQueryContext(), { search: source!.search });
    const ids = res.groups ? res.groups.filter((g) => !g.hidden).flatMap((g) => g.rows.map((r) => r.id)) : res.rows.map((r) => r.id);
    if (ids.includes(pageId)) return ids;
  }
  return collectionRows(collection.id).map((b) => b.id);
}

/** The platform shortcut of the peek arrows. */
export function peekShortcut(dir: -1 | 1): string {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  return mac ? `⌃⇧${dir < 0 ? 'K' : 'J'}` : `Alt+${dir < 0 ? 'K' : 'J'}`;
}

/** Is this keydown the peek previous (-1) / next (1) shortcut? */
export function peekShortcutDirection(e: KeyboardEvent): -1 | 1 | 0 {
  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
  const hit = mac ? e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey : e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
  if (!hit) return 0;
  if (e.code === 'KeyK') return -1;
  if (e.code === 'KeyJ') return 1;
  return 0;
}

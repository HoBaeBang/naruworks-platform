// Duplicate a database block: on a database that owns
// its data, ⋮⋮ › Duplicate opens "Duplicate with content" (⌘D) / "Duplicate without content". The copy gets its own
// data source(s) — properties, name, description, icon — and copies of every view (tabs and dashboard widgets)
// re-pointed at them, written in the editor's duplicate transaction (cloneHooks in features/editor/commands.ts), so it is
// placed and undone any block. The server adds the source's rows (with their content, "with content" only) and
// its templates to that same write (apps/server/src/dbcopy.ts, marker nc_copy). Linked views keep their source.
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { records } from '../../lib/store/records.ts';
import { cloneHooks, duplicateBlocks } from '../editor/commands.ts';

const UUID_RE = /"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/g;

/** Copy of `value` with every id in `map` replaced (pointers, relation targets, dashboard widget ids). */
function remap<T>(value: T, map: Map<string, string>): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value).replace(UUID_RE, (m, id: string) => {
    const n = map.get(id);
    return n ? `"${n}"` : m;
  })) as T;
}

/** Views living under a database block: its tabs and dashboard widgets. */
export function viewsOfBlock(b: BlockRecord): CollectionViewRecord[] {
  const out = new Map<string, CollectionViewRecord>();
  for (const id of b.view_ids ?? []) {
    const v = records.get<CollectionViewRecord>('collection_view', id);
    if (v && v.alive !== false) out.set(v.id, v);
  }
  for (const v of records.all<CollectionViewRecord>('collection_view')) {
    if (v.parent_id === b.id && v.alive !== false && !out.has(v.id)) out.set(v.id, v);
  }
  return [...out.values()];
}

/** Data sources the block owns (its collection + view sources living under it); linked sources are not owned. */
export function ownedCollections(b: BlockRecord): CollectionRecord[] {
  const ids = new Set<string>();
  if (b.collection_id) ids.add(b.collection_id);
  for (const v of viewsOfBlock(b)) {
    const pid = (v.format as { collection_pointer?: { id?: string } } | undefined)?.collection_pointer?.id;
    if (pid) ids.add(pid);
  }
  return [...ids].map((id) => records.get<CollectionRecord>('collection', id)).filter((c): c is CollectionRecord => !!c && c.alive !== false && c.parent_id === b.id);
}

let mode: 'with_content' | 'schema_only' = 'with_content';

function cloneDatabase(tx: { set: (table: string, id: string, path: string[], args: unknown) => unknown }, b: BlockRecord, nid: string): Record<string, unknown> {
  const owned = ownedCollections(b);
  const views = viewsOfBlock(b);
  const map = new Map<string, string>();
  for (const c of owned) map.set(c.id, newId());
  for (const v of views) map.set(v.id, newId());
  for (const c of owned) {
    const { version: _v, applied_tx_ids: _a, ...rest } = c as CollectionRecord & { applied_tx_ids?: unknown };
    const id = map.get(c.id)!;
    tx.set('collection', id, [], { ...remap(rest, map), id, parent_id: nid, parent_table: 'block', alive: true, template_pages: [], copied_from: c.id, nc_copy: mode });
  }
  for (const v of views) {
    const { version: _v, applied_tx_ids: _a, ...rest } = v as CollectionViewRecord & { applied_tx_ids?: unknown };
    const id = map.get(v.id)!;
    // page_sort keeps the source rows; the server re-points it at the copied rows (or drops it without content)
    tx.set('collection_view', id, [], { ...remap(rest, map), id, parent_id: nid, parent_table: 'block', alive: true });
  }
  return {
    ...(b.collection_id ? { collection_id: map.get(b.collection_id) ?? b.collection_id } : {}),
    view_ids: (b.view_ids ?? []).filter((id) => map.has(id)).map((id) => map.get(id)!),
    ...(b.format ? { format: remap(b.format, map) } : {}),
  };
}

cloneHooks.set('collection_view', cloneDatabase as never);
cloneHooks.set('collection_view_page', cloneDatabase as never);

/** "Duplicate with content" / "Duplicate without content" of one database block; returns the copy's id. */
export function duplicateDatabaseBlock(blockId: string, withContent: boolean): string | undefined {
  mode = withContent ? 'with_content' : 'schema_only';
  try {
    return duplicateBlocks([blockId])[0];
  } finally {
    mode = 'with_content';
  }
}

/** The block owns data (not just a linked view): Duplicate offers with / without content. */
export function ownsData(b: BlockRecord | undefined): boolean {
  return !!b && (b.type === 'collection_view' || b.type === 'collection_view_page') && ownedCollections(b).length > 0;
}

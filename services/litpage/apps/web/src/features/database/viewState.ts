// Personal filters and sorts:
// filter and sort edits first go to a per-person temporary state of the view, kept in the browser
// collectionViewTemporaryState2:<viewId>). On a database only you can see — and whose views you can change — the
// edit is saved for everyone right away (applyTemporaryStateIfPrivate). Anywhere else it stays yours: the filter bar
// shows Reset + "Save for everyone" (people who can't change the view — Can view / comment / edit content, locked
// databases — only get Reset: "Changes to filters & sorts in this view are only visible to you.").
import { useSyncExternalStore } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import type { FilterGroup, FilterNode, PropertyFilterLeaf, SortSpec } from '@nc/shared/database/index.ts';
import { newId } from '@nc/shared/ids.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { run } from '../../lib/blocks.ts';
import { databaseAccessOf } from './access.ts';

export interface PropertyFilterEntry {
  id: string;
  filter: PropertyFilterLeaf;
}

/** A view's unsaved filters / sorts. A key is present only when it differs from the saved view. */
export interface TempState {
  propertyFilters?: PropertyFilterEntry[];
  /** advanced filter; null = none */
  filter?: FilterGroup | null;
  sort?: SortSpec[];
}

const KEY = (viewId: string) => `nc:viewTemp:${useSession.getState().userId ?? 'anon'}:${viewId}`;
const states = new Map<string, TempState | null>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  for (const fn of listeners) fn();
}

function load(viewId: string): TempState | undefined {
  if (!states.has(viewId)) {
    let v: TempState | null = null;
    try {
      const raw = localStorage.getItem(KEY(viewId));
      if (raw) v = JSON.parse(raw) as TempState;
    } catch {
      v = null;
    }
    states.set(viewId, v && typeof v === 'object' ? v : null);
  }
  return states.get(viewId) ?? undefined;
}

function store(viewId: string, v: TempState | undefined) {
  const clean = v && Object.keys(v).length ? v : undefined;
  states.set(viewId, clean ?? null);
  try {
    if (clean) localStorage.setItem(KEY(viewId), JSON.stringify(clean));
    else localStorage.removeItem(KEY(viewId));
  } catch {
    /* storage unavailable: keeps working for this session */
  }
  emit();
}

/** Re-render on any personal filter / sort change. */
export function useViewTempVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

export function tempStateOf(viewId: string | undefined): TempState | undefined {
  return viewId ? load(viewId) : undefined;
}

const eq = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const savedFilters = (v: CollectionViewRecord) => (((v.format as Record<string, unknown> | undefined)?.property_filters ?? []) as PropertyFilterEntry[]);
const savedAdvanced = (v: CollectionViewRecord) => {
  const f = v.query2?.filter as FilterGroup | undefined;
  return f && Array.isArray(f.filters) && f.filters.length ? f : null;
};
const savedSorts = (v: CollectionViewRecord) => ((v.query2?.sort ?? []) as SortSpec[]);

/** The temporary state without the keys that equal the saved view. */
function pruned(view: CollectionViewRecord, t: TempState | undefined): TempState | undefined {
  if (!t) return undefined;
  const out: TempState = {};
  if (t.propertyFilters && !eq(t.propertyFilters, savedFilters(view))) out.propertyFilters = t.propertyFilters;
  if (t.filter !== undefined && !eq(t.filter && t.filter.filters?.length ? t.filter : null, savedAdvanced(view))) out.filter = t.filter && t.filter.filters?.length ? t.filter : null;
  if (t.sort && !eq(t.sort, savedSorts(view))) out.sort = t.sort;
  return Object.keys(out).length ? out : undefined;
}

const MARK = Symbol('effectiveView');
const cache = new WeakMap<CollectionViewRecord, { t: TempState; out: CollectionViewRecord }>();

/** The view as this person sees it: saved settings + their unsaved filters / sorts. Referentially stable. */
export function effectiveView<T extends CollectionViewRecord | undefined>(view: T): T {
  if (!view || (view as unknown as Record<symbol, boolean>)[MARK]) return view;
  const t = load(view.id);
  if (!t) return view;
  const hit = cache.get(view);
  if (hit && hit.t === t) return hit.out as T;
  const format = t.propertyFilters ? { ...(view.format ?? {}), property_filters: t.propertyFilters } : view.format;
  const query2 = { ...(view.query2 ?? {}) } as Record<string, unknown>;
  if (t.filter !== undefined) query2.filter = t.filter ?? undefined;
  if (t.sort) query2.sort = t.sort.length ? t.sort : undefined;
  const out = { ...view, format, query2 } as CollectionViewRecord;
  Object.defineProperty(out, MARK, { value: true });
  cache.set(view, { t, out });
  return out as T;
}

/** Hook form: re-renders when the person's filters / sorts for the view change. */
export function useEffectiveView<T extends CollectionViewRecord | undefined>(view: T): T {
  useViewTempVersion();
  return effectiveView(view);
}

/** The view as this person sees it, AND extra filter rules (dashboard global filters) — not saved anywhere. */
export function withExtraFilters<T extends CollectionViewRecord>(view: T, nodes: FilterNode[]): T {
  const eff = effectiveView(view);
  if (!nodes.length) return eff;
  const q = { ...(eff.query2 ?? {}) } as Record<string, unknown>;
  const own = q.filter as FilterGroup | undefined;
  q.filter = { operator: 'and', filters: [...(own?.filters?.length ? [own] : []), ...nodes] } satisfies FilterGroup;
  const out = { ...eff, query2: q } as T;
  Object.defineProperty(out, MARK, { value: true });
  return out;
}

// ---------------------------------------------------------------- dashboards: View mode vs Edit mode 

const dashModes = new Map<string, 'view' | 'edit'>();

/** A dashboard's mode in this tab (undefined = not chosen yet → View mode). */
export function dashboardMode(dashboardViewId: string): 'view' | 'edit' | undefined {
  return dashModes.get(dashboardViewId);
}

export function setDashboardMode(dashboardViewId: string, mode: 'view' | 'edit') {
  if (dashModes.get(dashboardViewId) === mode) return;
  dashModes.set(dashboardViewId, mode);
  emit();
}

export function useDashboardMode(dashboardViewId: string): 'view' | 'edit' | undefined {
  useViewTempVersion();
  return dashModes.get(dashboardViewId);
}

/** The dashboard a view belongs to (the dashboard view itself, or a widget's dashboard_view_id). */
function dashboardOf(view: CollectionViewRecord): string | undefined {
  if (view.type === 'dashboard') return view.id;
  return (view.format as { dashboard_view_id?: string } | undefined)?.dashboard_view_id;
}

// ---------------------------------------------------------------- who saves what

function me(): string | null {
  return useSession.getState().userId ?? null;
}

/** Only the current person can reach this database (no teamspace, workspace, link or other person's access on the * database or above it — 's permission-path check). */
export function isPrivateDatabase(blockId: string | undefined): boolean {
  const uid = me();
  if (!uid || !blockId) return false;
  let cur = records.get<BlockRecord>('block', blockId);
  for (let i = 0; i < 80 && cur; i++) {
    if ((cur.permissions ?? []).some((p) => p.role !== 'none' && !(p.type === 'user_permission' && p.user_id === uid))) return false;
    if (cur.parent_table === 'team') return false;
    if (cur.parent_table === 'space') return (cur.permissions ?? []).some((p) => p.type === 'user_permission' && p.user_id === uid && p.role !== 'none');
    if (cur.parent_table === 'collection') {
      const c = records.get<CollectionRecord>('collection', cur.parent_id);
      cur = c ? records.get<BlockRecord>('block', c.parent_id) : undefined;
      continue;
    }
    cur = records.get<BlockRecord>('block', cur.parent_id);
  }
  return false;
}

/** The person may change the view for everyone ("Save for everyone" / settings saved directly). */
export function canSaveForEveryone(view: CollectionViewRecord | undefined): boolean {
  if (!view) return false;
  const block = records.get<BlockRecord>('block', view.parent_id);
  return !!block && databaseAccessOf(block, records.role('block', block.id)).canEditStructure;
}

/** Filter / sort edits of this view stay personal (shared database, or the person can't change the view). */
export function personalMode(view: CollectionViewRecord | undefined): boolean {
  if (!view) return false;
  // dashboards: in View mode filters / sorts (global and in widgets) are yours until "Save for
  // everybody"; in Edit mode editors change the dashboard for everyone
  const dash = dashboardOf(view);
  if (dash) return (dashModes.get(dash) ?? 'view') === 'view' || !canSaveForEveryone(view);
  if (!canSaveForEveryone(view)) return true;
  return !isPrivateDatabase(view.parent_id);
}

/** Route a filter / sort edit: returns true when it was kept as a personal (unsaved) change. */
export function writePersonal(view: CollectionViewRecord, patch: TempState): boolean {
  if (!personalMode(view)) {
    // saving for everyone: drop the personal copy of what is being saved
    const t = load(view.id);
    if (t) {
      const next = { ...t };
      if (patch.propertyFilters) delete next.propertyFilters;
      if (patch.filter !== undefined) delete next.filter;
      if (patch.sort) delete next.sort;
      store(view.id, Object.keys(next).length ? next : undefined);
    }
    return false;
  }
  const saved = records.get<CollectionViewRecord>('collection_view', view.id) ?? view;
  store(view.id, pruned(saved, { ...(load(view.id) ?? {}), ...patch }));
  return true;
}

/** Unsaved filter / sort changes of the view ("both" / "filters" / "sorts"). */
export function dirtyKind(view: CollectionViewRecord | undefined): 'both' | 'filters' | 'sorts' | undefined {
  if (!view) return undefined;
  const saved = records.get<CollectionViewRecord>('collection_view', view.id) ?? view;
  const t = pruned(saved, load(view.id));
  if (!t) return undefined;
  const f = !!t.propertyFilters || t.filter !== undefined;
  const s = !!t.sort;
  return f && s ? 'both' : f ? 'filters' : s ? 'sorts' : undefined;
}

/** How many filters differ from the saved view ("{count} filters differ from the shared view"). */
export function changedFilterCount(view: CollectionViewRecord): number {
  const saved = records.get<CollectionViewRecord>('collection_view', view.id) ?? view;
  const t = pruned(saved, load(view.id));
  if (!t) return 0;
  let n = 0;
  if (t.propertyFilters) {
    const before = new Map(savedFilters(saved).map((f) => [f.id, JSON.stringify(f.filter)]));
    const after = new Map(t.propertyFilters.map((f) => [f.id, JSON.stringify(f.filter)]));
    for (const [id, v] of after) if (before.get(id) !== v) n++;
    for (const id of before.keys()) if (!after.has(id)) n++;
  }
  if (t.filter !== undefined) n++;
  return Math.max(n, t.propertyFilters || t.filter !== undefined ? 1 : 0);
}

export type SaveScope = 'all' | 'filters' | 'sorts';

/** Reset: drop the personal filters / sorts (all, or just filters / sorts from the settings pages). */
export function resetPersonal(viewId: string, scope: SaveScope = 'all') {
  const t = load(viewId);
  if (!t) return;
  if (scope === 'all') return store(viewId, undefined);
  const next = { ...t };
  if (scope === 'filters') {
    delete next.propertyFilters;
    delete next.filter;
  } else delete next.sort;
  store(viewId, next);
}

/** "Save for everyone": write the personal filters / sorts to the view (one undoable step). */
export function saveForEveryone(viewId: string, scope: SaveScope = 'all') {
  const view = records.get<CollectionViewRecord>('collection_view', viewId);
  const t = view ? pruned(view, load(viewId)) : undefined;
  if (!view || !t) return resetPersonal(viewId, scope);
  const filters = scope !== 'sorts';
  const sorts = scope !== 'filters';
  run('CollectionSettingsSaveControl.handleSaveInCurrentViewClick', (tx) => {
    if (filters && t.propertyFilters) tx.update('collection_view', viewId, ['format'], { property_filters: t.propertyFilters });
    const q = { ...(view.query2 ?? {}) } as Record<string, unknown>;
    let touched = false;
    if (filters && t.filter !== undefined) {
      q.filter = t.filter ?? undefined;
      touched = true;
    }
    if (sorts && t.sort) {
      q.sort = t.sort.length ? t.sort : undefined;
      touched = true;
    }
    if (touched) tx.set('collection_view', viewId, ['query2'], q);
  });
  resetPersonal(viewId, scope);
  useUI.getState().toast('Everyone can now see the saved changes.');
}

/** "Save as new view": a copy of the view with the personal filters / sorts; the original view is reset. */
export function saveAsNewView(viewId: string): string | undefined {
  const view = records.get<CollectionViewRecord>('collection_view', viewId);
  const block = view ? records.get<BlockRecord>('block', view.parent_id) : undefined;
  if (!view || !block) return undefined;
  const eff = effectiveView(view);
  const id = newId();
  run('CollectionSettingsSaveControl.handleSaveAsNewViewClick', (tx) => {
    const { version: _v, ...rest } = eff as CollectionViewRecord & { version?: number };
    tx.set('collection_view', id, [], { ...structuredClone(rest), id, name: copyName(view.name || ''), parent_id: block.id, parent_table: 'block' });
    tx.listAfter('block', block.id, ['view_ids'], id, viewId);
  });
  resetPersonal(viewId);
  return id;
}

/** "Merge into advanced filter": the personal filter chips become rules of the advanced filter (still personal). */
export function mergeIntoAdvancedFilter(viewId: string) {
  const view = records.get<CollectionViewRecord>('collection_view', viewId);
  if (!view) return;
  const eff = effectiveView(view);
  const chips = savedFilters(eff);
  if (!chips.length) return;
  const adv = savedAdvanced(eff) ?? { operator: 'and' as const, filters: [] };
  const merged: FilterGroup = { ...adv, filters: [...adv.filters, ...chips.map((c) => c.filter)] };
  store(viewId, pruned(view, { ...(load(viewId) ?? {}), propertyFilters: [], filter: merged }));
}

/** copy name: "Table" → "Table (1)", "Table (1)" → "Table (2)". */
export function copyName(name: string): string {
  const m = name.trimEnd().match(/^(.*?)\s*\((\d+)\)$/);
  if (m && Number(m[2]) > 0) return `${m[1] ? `${m[1]} ` : ''}(${Number(m[2]) + 1})`;
  return `${name.trimEnd() ? `${name.trimEnd()} ` : ''}(1)`;
}

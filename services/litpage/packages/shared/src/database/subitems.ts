// Sub-items: a self relation pair on the data source — collection.format.subitem_property
// is the "Sub-item" relation (children), its two-way counterpart (schema[subitem_property].property) is "Parent item"
// (limit 1). The parent relation is the source of truth for the tree; both sides are kept in sync by planRelationChange.
// Per view: format.subitem_display_mode 'show' (Nested in toggle / Card property) | 'flattened' | 'disabled' and
// format.subitem_filter_scope 'parents' | 'parents_and_subitems' | 'subitems'.
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '../records.ts';

export type SubitemDisplayMode = 'show' | 'flattened' | 'disabled';
export type SubitemFilterScope = 'parents' | 'parents_and_subitems' | 'subitems';

export interface SubitemConfig {
  /** "Sub-item" relation (children) */
  property: string;
  /** "Parent item" relation (parent, limit 1) */
  inverse: string;
}

/** Nesting deeper than this is refused. */
export const SUBITEM_MAX_DEPTH = 10;

/** Sub-items config of a data source, when the feature is on and its relation pair is intact. */
export function subitemConfigOf(collection: Pick<CollectionRecord, 'schema' | 'id'> & { format?: Record<string, unknown> } | undefined): SubitemConfig | null {
  const pid = collection?.format?.subitem_property as string | undefined;
  if (!collection || !pid) return null;
  const p = collection.schema?.[pid] as PropertySchema | undefined;
  if (!p || p.type !== 'relation') return null;
  const target = (p.collection_pointer as { id?: string } | undefined)?.id ?? p.collection_id;
  if (target !== collection.id) return null;
  const inverse = p.property as string | undefined;
  if (!inverse || inverse === pid || collection.schema[inverse]?.type !== 'relation') return null;
  return { property: pid, inverse };
}

/** View types whose sub-items nest in toggles (others show them as a card property). */
export function nestsSubitems(viewType: string | undefined): boolean {
  return viewType === 'table' || viewType === 'list' || viewType === 'timeline';
}

export interface SubitemViewSettings extends SubitemConfig {
  mode: Exclude<SubitemDisplayMode, 'disabled'>;
  scope: SubitemFilterScope;
}

/** Effective sub-item settings of a view (null = sub-items off for the data source or disabled in this view). */
export function subitemSettingsOf(view: Pick<CollectionViewRecord, 'type' | 'format'> | undefined, collection: Parameters<typeof subitemConfigOf>[0]): SubitemViewSettings | null {
  const cfg = subitemConfigOf(collection);
  if (!cfg || !view) return null;
  const f = (view.format ?? {}) as Record<string, unknown>;
  const stored = f.subitem_display_mode as SubitemDisplayMode | undefined;
  const mode: SubitemDisplayMode = stored ?? (view.type === 'chart' ? 'flattened' : 'show');
  if (mode === 'disabled') return null;
  let scope = (f.subitem_filter_scope as SubitemFilterScope | undefined) ?? (view.type === 'chart' ? 'parents_and_subitems' : 'parents');
  // boards / calendars / galleries only support "Parents only" while sub-items are shown on cards
  if (mode === 'show' && !nestsSubitems(view.type)) scope = 'parents';
  return { ...cfg, mode, scope };
}

function relIds(row: BlockRecord | undefined, propId: string): string[] {
  const out: string[] = [];
  for (const d of (row?.properties?.[propId] ?? []) as unknown[]) {
    const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as unknown[]) : [];
    for (const a of anns) if (Array.isArray(a) && a[0] === 'p' && typeof a[1] === 'string') out.push(a[1]);
  }
  return out;
}

/** Parent id of a row (first id of the Parent item relation). */
export function parentIdOf(row: BlockRecord | undefined, cfg: SubitemConfig): string | undefined {
  return relIds(row, cfg.inverse).find((id) => id !== row?.id);
}

/** Stored sub-item ids of a row (Sub-item relation). */
export function childIdsOf(row: BlockRecord | undefined, cfg: SubitemConfig): string[] {
  return relIds(row, cfg.property).filter((id) => id !== row?.id);
}

/** Parent lookup over a set of rows, ignoring missing parents and cycles (rows in a cycle become roots). */
export function parentMap(rows: BlockRecord[], cfg: SubitemConfig): Map<string, string> {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const parent = new Map<string, string>();
  for (const r of rows) {
    const p = parentIdOf(r, cfg);
    if (p && byId.has(p)) parent.set(r.id, p);
  }
  // break cycles: walk up from every row; a row that reaches itself loses its parent link
  for (const r of rows) {
    const seen = new Set<string>([r.id]);
    let cur = parent.get(r.id);
    for (let i = 0; cur && i <= rows.length; i++) {
      if (seen.has(cur)) {
        parent.delete(r.id);
        break;
      }
      seen.add(cur);
      cur = parent.get(cur);
    }
  }
  return parent;
}

/** All descendant ids of `rootIds` (depth-first, cycle safe) given parent links. */
export function descendantIds(rootIds: string[], parent: Map<string, string>): string[] {
  const children = new Map<string, string[]>();
  for (const [c, p] of parent) children.set(p, [...(children.get(p) ?? []), c]);
  const out: string[] = [];
  const seen = new Set(rootIds);
  const stack = [...rootIds];
  while (stack.length) {
    const id = stack.pop()!;
    for (const c of children.get(id) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      out.push(c);
      stack.push(c);
    }
  }
  return out;
}

export interface SubitemQueryResult extends SubitemViewSettings {
  /** visible children of each row in display order (nested mode) */
  children: Record<string, BlockRecord[]>;
  /** number of sub-items each row has (all, ignoring filters) — flattened indicator and card property */
  counts: Record<string, number>;
  /** rows shown only to keep the tree together (they don't match the filters themselves) */
  context: string[];
  /** nesting depth of every row placed in the tree (roots 0) */
  depth: Record<string, number>;
}

/**
 * Arrange a view's rows by sub-items. `ordered` = every alive row in display order (sorts / manual order applied),
 * `matches(row)` = the row passes the view's filters and search. Returns the top-level rows and the tree.
 */
export function arrangeSubitems(ordered: BlockRecord[], matches: (row: BlockRecord) => boolean, settings: SubitemViewSettings): { rows: BlockRecord[]; result: SubitemQueryResult } {
  const parent = parentMap(ordered, settings);
  const kids = new Map<string, BlockRecord[]>();
  for (const r of ordered) {
    const p = parent.get(r.id);
    if (p) kids.set(p, [...(kids.get(p) ?? []), r]);
  }
  const counts: Record<string, number> = {};
  for (const [p, list] of kids) counts[p] = list.length;
  const ok = new Map<string, boolean>();
  const isMatch = (r: BlockRecord) => {
    let v = ok.get(r.id);
    if (v === undefined) ok.set(r.id, (v = matches(r)));
    return v;
  };
  // a row "has a match below" when one of its descendants matches
  const below = new Map<string, boolean>();
  const hasMatchBelow = (id: string, guard = 0): boolean => {
    const hit = below.get(id);
    if (hit !== undefined) return hit;
    below.set(id, false);
    const v = guard < 64 && (kids.get(id) ?? []).some((c) => isMatch(c) || hasMatchBelow(c.id, guard + 1));
    below.set(id, v);
    return v;
  };
  const isRoot = (r: BlockRecord) => !parent.has(r.id);
  const base = { ...settings, children: {} as Record<string, BlockRecord[]>, counts, context: [] as string[], depth: {} as Record<string, number> };

  if (settings.mode === 'flattened') {
    const rows = ordered.filter((r) => isMatch(r) && (settings.scope === 'parents' ? isRoot(r) : settings.scope === 'subitems' ? !isRoot(r) : true));
    for (const r of rows) base.depth[r.id] = 0;
    return { rows, result: base };
  }

  // nested ("Nested in toggle" / card property)
  const context = new Set<string>();
  let roots: BlockRecord[];
  let childFilter: (c: BlockRecord) => boolean;
  if (settings.scope === 'parents') {
    roots = ordered.filter((r) => isRoot(r) && isMatch(r));
    childFilter = () => true;
  } else if (settings.scope === 'subitems') {
    roots = ordered.filter((r) => isRoot(r) && hasMatchBelow(r.id));
    for (const r of roots) if (!isMatch(r)) context.add(r.id);
    childFilter = (c) => isMatch(c) || hasMatchBelow(c.id);
  } else {
    roots = ordered.filter((r) => isRoot(r) && (isMatch(r) || hasMatchBelow(r.id)));
    childFilter = (c) => isMatch(c) || hasMatchBelow(c.id);
  }
  const visit = (r: BlockRecord, depth: number) => {
    base.depth[r.id] = depth;
    if (settings.scope !== 'parents' && !isMatch(r)) context.add(r.id);
    const list = (kids.get(r.id) ?? []).filter(childFilter);
    if (list.length) base.children[r.id] = list;
    if (depth < SUBITEM_MAX_DEPTH + 1) for (const c of list) visit(c, depth + 1);
  };
  for (const r of roots) visit(r, 0);
  base.context = [...context];
  return { rows: roots, result: base };
}

// ------------------------------------------------------------------ integrity (server validation, client guards)

/**
 * Problem with making `parentId` the parent of `childId` (null = fine). `parentOf(id)` returns the current parent
 * link; `heightOf(id)` the depth of the subtree under a row (0 = leaf).
 */
export function subitemLinkProblem(childId: string, parentId: string, parentOf: (id: string) => string | undefined, heightOf: (id: string) => number): string | null {
  if (childId === parentId) return 'An item cannot contain itself.';
  let depth = 1;
  const seen = new Set<string>();
  for (let cur: string | undefined = parentId; cur; cur = parentOf(cur)) {
    if (cur === childId) return 'This would make a cycle. An item cannot sit beneath one of its descendants.';
    if (seen.has(cur)) break;
    seen.add(cur);
    depth++;
    if (depth > SUBITEM_MAX_DEPTH + 1) break;
  }
  if (depth - 1 + heightOf(childId) >= SUBITEM_MAX_DEPTH + 1) return `Sub-items support at most ${SUBITEM_MAX_DEPTH} nested levels. Remove a level and try again.`;
  return null;
}

// Dependencies: collection.format.collection_default_arrows_by = the "Blocking" relation
// (the items this item blocks — timeline arrows point from an item to the items it blocks); its two-way counterpart is
// "Blocked by". collection.format.dependency_date_shifting_config = {mode, avoid_weekends, date_property,
// end_date_property?}: mode 'consume_gap' = "Move items when dates overlap", 'preserve_gap' =
// "Shift & maintain time between items", absent = "Keep dates unchanged automatically".
import type { BlockRecord, CollectionRecord, PropertySchema } from '../records.ts';
import type { DateValue, RichText } from '../richtext.ts';

export type DateShiftMode = 'consume_gap' | 'preserve_gap';

export interface DependencyConfig {
  /** "Blocking" relation: ids of the items this item blocks */
  blocking: string;
  /** "Blocked by" relation (two-way counterpart), when present */
  blockedBy?: string;
  mode?: DateShiftMode;
  avoidWeekends: boolean;
  /** date property used for shifting ("Shift using") */
  dateProperty?: string;
  /** separate end date property */
  endDateProperty?: string;
}

export const DATE_SHIFT_MODES: { id: DateShiftMode | 'none'; label: string }[] = [
  { id: 'consume_gap', label: 'Move items when dates overlap' },
  { id: 'preserve_gap', label: 'Move items while keeping the gap' },
  { id: 'none', label: 'Keep dates unchanged automatically' },
];

export function dependencyConfigOf(collection: Pick<CollectionRecord, 'schema' | 'id'> & { format?: Record<string, unknown> } | undefined): DependencyConfig | null {
  const pid = collection?.format?.collection_default_arrows_by as string | undefined;
  if (!collection || !pid) return null;
  const p = collection.schema?.[pid] as PropertySchema | undefined;
  if (!p || p.type !== 'relation') return null;
  const inverse = p.property as string | undefined;
  const cfg = (collection.format?.dependency_date_shifting_config ?? {}) as { mode?: string; avoid_weekends?: boolean; date_property?: string; end_date_property?: string };
  const isDate = (id: string | undefined) => !!id && collection.schema[id]?.type === 'date';
  return {
    blocking: pid,
    blockedBy: inverse && inverse !== pid && collection.schema[inverse]?.type === 'relation' ? inverse : undefined,
    mode: cfg.mode === 'consume_gap' || cfg.mode === 'preserve_gap' ? cfg.mode : undefined,
    avoidWeekends: !!cfg.avoid_weekends,
    dateProperty: isDate(cfg.date_property) ? cfg.date_property : undefined,
    endDateProperty: isDate(cfg.end_date_property) ? cfg.end_date_property : undefined,
  };
}

// ------------------------------------------------------------------ day arithmetic (calendar days, zone free)

export function dayIndex(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, (m || 1) - 1, d || 1) / 864e5);
}

export function dayString(index: number): string {
  return new Date(index * 864e5).toISOString().slice(0, 10);
}

export function isWeekendDay(index: number): boolean {
  const wd = new Date(index * 864e5).getUTCDay();
  return wd === 0 || wd === 6;
}

/** An item's dates in whole days (inclusive end) plus the raw values to rewrite. */
export interface ItemDates {
  start: number;
  end: number;
  value: DateValue;
  endValue?: DateValue;
}

function dateAtom(raw: RichText | undefined): DateValue | undefined {
  for (const d of raw ?? []) {
    const anns = Array.isArray(d?.[1]) ? (d[1] as unknown[]) : [];
    for (const a of anns) if (Array.isArray(a) && a[0] === 'd' && a[1] && typeof a[1] === 'object') return a[1] as DateValue;
  }
  return undefined;
}

export function itemDatesOf(row: Pick<BlockRecord, 'properties'> | undefined, cfg: Pick<DependencyConfig, 'dateProperty' | 'endDateProperty'>): ItemDates | null {
  if (!row || !cfg.dateProperty) return null;
  const v = dateAtom(row.properties?.[cfg.dateProperty] as RichText | undefined);
  if (!v?.start_date) return null;
  const start = dayIndex(v.start_date);
  if (cfg.endDateProperty) {
    const e = dateAtom(row.properties?.[cfg.endDateProperty] as RichText | undefined);
    const end = e?.start_date ? Math.max(start, dayIndex(e.start_date)) : start;
    return { start, end, value: v, endValue: e };
  }
  return { start, end: v.end_date ? Math.max(start, dayIndex(v.end_date)) : start, value: v };
}

/** Move an item by `days` (times, zones and formats kept). */
export function shiftItemDates(d: ItemDates, days: number): ItemDates {
  const mv = (v: DateValue): DateValue => ({ ...v, start_date: dayString(dayIndex(v.start_date) + days), ...(v.end_date ? { end_date: dayString(dayIndex(v.end_date) + days) } : {}) });
  return { start: d.start + days, end: d.end + days, value: mv(d.value), endValue: d.endValue ? mv(d.endValue) : undefined };
}

function relIds(row: Pick<BlockRecord, 'properties' | 'id'> | undefined, propId: string): string[] {
  const out: string[] = [];
  for (const d of (row?.properties?.[propId] ?? []) as unknown[]) {
    const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as unknown[]) : [];
    for (const a of anns) if (Array.isArray(a) && a[0] === 'p' && typeof a[1] === 'string' && a[1] !== row?.id) out.push(a[1]);
  }
  return out;
}

/** Ids of the items `row` blocks (its Blocking relation, plus rows that list it under Blocked by). */
export function blockedItemsOf(row: Pick<BlockRecord, 'properties' | 'id'>, cfg: DependencyConfig, rows?: Iterable<Pick<BlockRecord, 'properties' | 'id'>>): string[] {
  const ids = new Set(relIds(row, cfg.blocking));
  if (cfg.blockedBy && rows) for (const r of rows) if (relIds(r, cfg.blockedBy).includes(row.id)) ids.add(r.id);
  return [...ids];
}

export interface DateShift {
  rowId: string;
  dates: ItemDates;
}

/**
 * Plan automatic date shifts after `changedRowId` moved from `before` to `after`.
 * consume_gap: a blocked item that now starts on or before its blocker's end moves to the day after it (gaps can grow).
 * preserve_gap: blocked items move by the same number of days as the blocker's end (both directions).
 * Shifts cascade along Blocking chains; avoid weekends moves shifted items until neither end is on a weekend.
 */
export function planDependencyShifts(opts: {
  changedRowId: string;
  before: ItemDates | null;
  after: ItemDates | null;
  config: DependencyConfig;
  getRow: (id: string) => Pick<BlockRecord, 'properties' | 'id' | 'alive'> | undefined;
  allRows?: Iterable<Pick<BlockRecord, 'properties' | 'id'>>;
}): DateShift[] {
  const { config: cfg } = opts;
  if (!cfg.mode || !cfg.dateProperty || !opts.after) return [];
  const out = new Map<string, ItemDates>();
  const old = new Map<string, ItemDates | null>([[opts.changedRowId, opts.before]]);
  const now = new Map<string, ItemDates>([[opts.changedRowId, opts.after]]);
  const queue = [opts.changedRowId];
  const all = opts.allRows ? [...opts.allRows] : undefined;
  let budget = 2000;
  while (queue.length && budget-- > 0) {
    const id = queue.shift()!;
    const cur = now.get(id);
    const prev = old.get(id) ?? null;
    const row = opts.getRow(id);
    if (!cur || !row) continue;
    for (const tid of blockedItemsOf(row, cfg, all)) {
      if (tid === opts.changedRowId) continue;
      const target = opts.getRow(tid);
      if (!target || target.alive === false) continue;
      const tDates = now.get(tid) ?? itemDatesOf(target, cfg);
      if (!tDates) continue;
      let delta = 0;
      if (cfg.mode === 'consume_gap') {
        if (cur.end >= tDates.start) delta = cur.end + 1 - tDates.start;
      } else if (prev) {
        delta = cur.end - prev.end;
      }
      if (!delta) continue;
      let next = shiftItemDates(tDates, delta);
      if (cfg.avoidWeekends) for (let i = 0; i < 7 && (isWeekendDay(next.start) || isWeekendDay(next.end)); i++) next = shiftItemDates(next, 1);
      if (next.start === tDates.start && next.end === tDates.end) continue;
      if (!old.has(tid)) old.set(tid, tDates);
      now.set(tid, next);
      out.set(tid, next);
      queue.push(tid);
    }
  }
  return [...out].map(([rowId, dates]) => ({ rowId, dates }));
}

/** Property writes for a shift: the date property (and the separate end property). */
export function shiftWrites(shift: DateShift, cfg: DependencyConfig): { propId: string; value: RichText }[] {
  const enc = (v: DateValue) => [['‣', [['d', v]]]] as unknown as RichText;
  const out = [{ propId: cfg.dateProperty!, value: enc(shift.dates.value) }];
  if (cfg.endDateProperty && shift.dates.endValue) out.push({ propId: cfg.endDateProperty, value: enc(shift.dates.endValue) });
  return out;
}

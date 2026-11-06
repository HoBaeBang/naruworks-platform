// Timeline view. Zoom configs define snap units, axis units, and placeholder durations.
// Axis labels use h:mm a, h a, weekday plus day, day, or month formats, with secondary
// labels for long dates, month and year, or year. Timeline rows support a table, relation arrows,
// a now line, and an add-row control.
// format: timeline_preference{zoomLevel, centerTimestamp}, timeline_show_table, timeline_table_properties,
// timeline_properties, timeline_arrows_by{property}; query2: timeline_by, timeline_by_end.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { relationIdsOf } from '@nc/shared/relation/index.ts';
import { DT, monthName, weekdayName, zoneOrSystem, type DateUnit, type LitDate } from '@nc/shared/formula/index.ts';
import { registerLayoutSettings, registerView, type LayoutSettingsProps, type ViewProps } from '../../viewRegistry.ts';
import { Icon } from '../../../../components/Icon.tsx';
import { openMenu } from '../../../../components/Menu.tsx';
import { run, setProperty } from '../../../../lib/blocks.ts';
import { useUI } from '../../../../lib/store/ui.ts';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { PropertyCell, PropertyIcon } from '../../properties/PropertyCell.tsx';
import { addProperty, viewCreationHooks } from '../../actions.ts';
import { newPropId, startOfWeekSetting, titleOf, userTimeZone } from '../../advanced/index.ts';
import { turnOnDependencies } from '../../dependencies.ts';
import { useDependencyLinking } from '../../dependencyLinking.tsx';
import { conditionalBg, useConditionalColors } from '../../data.ts';
import { CalcFooter } from '../table/TableView.view.tsx';
import { encodeAssignment, moveRow } from '../../actions.ts';
import { groupAssignment, type GroupResult } from '@nc/shared/database/index.ts';
import type { Tx } from '../../../../lib/store/transactions.ts';
import { GroupHeader, useCollapsedGroups } from '../../chrome/Groups.tsx';
import { SubitemCount, SubitemToggle, subitemInfoFor, type SubitemRowInfo } from '../../subitemsUi.tsx';
import { useIsExpanded } from '../../subitems.ts';
import { getCollection } from '../../advanced/context.ts';
import {
  SettingsRow, SettingsToggle, dateByProperty, dateProperties, datePropertyItems, dateValue, pickMenu, rowDayRange, setFormat, setQuery2, useViewKit,
  visibleProperties, type DayRange,
} from '../../advanced/viewKit.tsx';
import '../calendar/calendar.css';
import './timeline.css';

export type ZoomLevel = 'hours' | 'day' | 'week' | 'bi_week' | 'month' | 'quarter' | 'year' | '5_years';
type Unit = 'fifteen_minutes' | 'hour' | 'day' | 'week' | 'month' | 'year';

interface ZoomConfig {
  snap: 'fifteen_minutes' | 'day';
  primary: Unit;
  secondary: 'day' | 'month' | 'year';
  msPerPixel: number;
  /** range_start: label centered on the tick; range_middle: label spans the unit */
  align: 'start' | 'middle';
  divider?: Unit;
  weekends: boolean;
  /** Active range: day labels of hovered or dragged items are emphasized. */
  highlight: boolean;
  placeholder: Partial<Record<DateUnit, number>>;
}

export const ZOOMS: Record<ZoomLevel, ZoomConfig> = {
  hours: { snap: 'fifteen_minutes', primary: 'fifteen_minutes', secondary: 'day', msPerPixel: 12342.857142857143, align: 'start', divider: 'fifteen_minutes', weekends: false, highlight: false, placeholder: { hours: 1 } },
  day: { snap: 'fifteen_minutes', primary: 'hour', secondary: 'day', msPerPixel: 69120, align: 'start', divider: 'hour', weekends: false, highlight: false, placeholder: { hours: 3 } },
  week: { snap: 'day', primary: 'day', secondary: 'month', msPerPixel: 48e4, align: 'middle', divider: 'day', weekends: true, highlight: true, placeholder: { days: 1 } },
  bi_week: { snap: 'day', primary: 'day', secondary: 'month', msPerPixel: 108e4, align: 'middle', weekends: true, highlight: true, placeholder: { days: 3 } },
  month: { snap: 'day', primary: 'day', secondary: 'month', msPerPixel: 216e4, align: 'middle', weekends: true, highlight: true, placeholder: { days: 5 } },
  quarter: { snap: 'day', primary: 'week', secondary: 'month', msPerPixel: 72e5, align: 'start', divider: 'month', weekends: false, highlight: false, placeholder: { weeks: 2 } },
  year: { snap: 'day', primary: 'week', secondary: 'month', msPerPixel: 1728e4, align: 'start', divider: 'month', weekends: false, highlight: false, placeholder: { weeks: 4 } },
  '5_years': { snap: 'day', primary: 'month', secondary: 'year', msPerPixel: 864e5, align: 'start', divider: 'month', weekends: false, highlight: false, placeholder: { weeks: 20 } },
};

export const ZOOM_LABEL: Record<ZoomLevel, string> = { hours: 'Hours', day: 'Day', week: 'Week', bi_week: 'Bi-week', month: 'Month', quarter: 'Quarter', year: 'Year', '5_years': '5 Years' };
const ZOOM_ORDER: ZoomLevel[] = ['hours', 'day', 'week', 'bi_week', 'month', 'quarter', 'year', '5_years'];
const ROW = 36;
const HEAD = 68;
const DAY = 864e5;
const NARROW_WEEKDAY = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Start of a display unit in the user's zone (weeks honour the "start week on Monday" setting). */
function unitStart(d: DT, unit: Unit): DT {
  switch (unit) {
    case 'fifteen_minutes': return d.startOf('hour').plus({ minutes: Math.floor(d.minute / 15) * 15 });
    case 'hour': return d.startOf('hour');
    case 'day': return d.startOf('day');
    case 'week': {
      const day = d.startOf('day');
      return day.plus({ days: -(startOfWeekSetting() === 1 ? day.weekday - 1 : day.weekday % 7) });
    }
    case 'month': return d.startOf('month');
    case 'year': return d.startOf('year');
  }
}

function unitNext(d: DT, unit: Unit): DT {
  switch (unit) {
    case 'fifteen_minutes': return d.plus({ minutes: 15 });
    case 'hour': return d.plus({ hours: 1 });
    case 'day': return d.plus({ days: 1 });
    case 'week': return d.plus({ weeks: 1 });
    case 'month': return d.plus({ months: 1 });
    case 'year': return d.plus({ years: 1 });
  }
}

interface Label { lighter?: string; darker?: string; single?: string; lighterFirst?: boolean }

/** Primary axis label: "h:mm a", "h a", weekday plus day, day, or month. */
function primaryLabel(d: DT, unit: Unit, zoom: ZoomLevel): Label {
  const h12 = d.hour % 12 || 12;
  const ap = d.hour < 12 ? 'AM' : 'PM';
  switch (unit) {
    case 'fifteen_minutes': return { darker: `${h12}:${String(d.minute).padStart(2, '0')}`, lighter: ap };
    case 'hour': return { darker: String(h12), lighter: ap };
    case 'day':
    case 'week':
      if (zoom === 'week' || zoom === 'bi_week') return { lighter: NARROW_WEEKDAY[d.weekday - 1], darker: String(d.day), lighterFirst: true };
      return { single: String(d.day) };
    case 'month': return { single: String(d.month) };
    default: return { single: String(d.year) };
  }
}

/** Sticky header title: day → "October 20, 2026", month → "October 2026", year → "2026". */
function secondaryTitle(ms: number, unit: ZoomConfig['secondary'], tz: string): string {
  const d = new DT(ms, zoneOrSystem(tz));
  if (unit === 'day') return `${monthName(d.month)} ${d.day}, ${d.year}`;
  if (unit === 'year') return String(d.year);
  return `${monthName(d.month)} ${d.year}`;
}

/** In-canvas secondary labels at each unit start (peek out between the sticky title and the controls). */
function secondaryShort(d: DT, unit: ZoomConfig['secondary']): string {
  if (unit === 'day') return `${weekdayName(d.weekday, 'short')} ${monthName(d.month, true)} ${d.day}`;
  if (unit === 'year') return String(d.year);
  return monthName(d.month);
}

interface Item {
  row: BlockRecord;
  range: DayRange | null;
  startMs: number;
  endMs: number;
}

/** A rendered timeline row: an item (with its sub-item nesting) or a group header (Group by). */
type VRow =
  | { kind: 'item'; item: Item; group: GroupResult | null; info: SubitemRowInfo | null; count: number; context: boolean }
  | { kind: 'group'; group: GroupResult };

/** Stand-in for group header rows in the dependency-linking row list (no item to connect to). */
const NO_ROW = { id: '' } as BlockRecord;

/** Dropping a row into another group gives it that group's value (like the board / grouped table). */
function assignGroupInTx(tx: Tx, rowId: string, propId: string, collection: CollectionRecord, group: GroupResult) {
  const prop = collection.schema[propId];
  if (!prop) return;
  const a = groupAssignment(group, prop);
  if (!a) return;
  tx.set('block', rowId, ['properties', propId], encodeAssignment(prop, a.kind, a.value, collection.space_id));
}

interface Drag {
  rowId: string;
  mode: 'move' | 'left' | 'right';
  x0: number;
  startMs: number;
  endMs: number;
  dStart: number;
  dEnd: number;
  moved: boolean;
}

function NoDate({ onAdd, readOnly }: { onAdd: () => void; readOnly: boolean }) {
  return (
    <div className="nc-cal-nodate">
      <div className="nc-cal-nodate-title">No date field</div>
      {readOnly ? <div>Timeline layouts need a date field to display entries.</div> : <div><span role="link" className="nc-cal-link" onClick={onAdd}>Add a date field</span> to this table to display a timeline layout.</div>}
    </div>
  );
}

function tableColumns(view: CollectionViewRecord, schema: Record<string, PropertySchema>): { property: string; width: number }[] {
  const saved = (view.format as Record<string, any> | undefined)?.timeline_table_properties as { property: string; visible?: boolean; width?: number }[] | undefined;
  const list = saved?.length ? saved : [{ property: 'title', visible: true, width: 280 }];
  const cols = list.filter((p) => p.visible !== false && schema[p.property]).map((p) => ({ property: p.property, width: p.width ?? (p.property === 'title' ? 280 : 160) }));
  return cols.length ? cols : [{ property: 'title', width: 280 }];
}

function LabelView({ l, accent }: { l: Label; accent?: boolean }): ReactNode {
  if (l.single !== undefined) return <span className={accent ? 'darker' : 'single'}>{l.single}</span>;
  const lighter = <span key="l" className="lighter" style={l.lighterFirst ? { paddingInlineEnd: 3 } : { paddingInlineStart: 3 }}>{l.lighter}</span>;
  const darker = <span key="d" className={accent ? 'accent' : 'darker'}>{l.darker}</span>;
  return l.lighterFirst ? <>{lighter}{darker}</> : <>{darker}{lighter}</>;
}

function TimelineView(props: ViewProps) {
  const kit = useViewKit(props);
  const { view, collection, readOnly } = kit;
  const schema = collection.schema;
  const fmt = (view.format ?? {}) as Record<string, any>;
  const zoom: ZoomLevel = ZOOMS[fmt.timeline_preference?.zoomLevel as ZoomLevel] ? fmt.timeline_preference.zoomLevel : 'month';
  const z = ZOOMS[zoom];
  const tz = userTimeZone();
  const zone = zoneOrSystem(tz);
  const byProp = dateByProperty(view, schema, 'timeline_by');
  const endProp = dateByProperty(view, schema, 'timeline_by_end');
  const showTable = fmt.timeline_show_table === true;
  const arrowsBy = fmt.timeline_arrows_by?.property as string | undefined;
  const showIcon = fmt.show_page_icon !== false;
  const bleed = kit.db?.bleed ?? { left: 0, right: 0 };
  const scrollRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<{ rowId: string; ms: number } | null>(null);
  const [hoverItem, setHoverItem] = useState<string | null>(null);
  const initialCenter = typeof fmt.timeline_preference?.centerTimestamp === 'number' ? fmt.timeline_preference.centerTimestamp : Date.now();
  const [anchor, setAnchor] = useState<number>(initialCenter);
  const visibleCenter = useRef<number>(initialCenter);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportW, setViewportW] = useState(800);
  const editable = !readOnly && !!byProp && schema[byProp]?.type === 'date' && (!endProp || schema[endProp]?.type === 'date');
  // Layout › Load limit: the first N items, then "Load more" adds the next N
  const limitFmt = fmt.inline_collection_first_load_limit as { type?: string; limit?: number } | undefined;
  const firstLimit = limitFmt?.type === 'load_limit' && Number(limitFmt.limit) > 0 ? Number(limitFmt.limit) : 50;
  const [loadLimit, setLoadLimit] = useState(firstLimit);
  useEffect(() => setLoadLimit(firstLimit), [firstLimit, view.id]);
  // Group by  → group header rows; sub-items "Nested in toggle"  → expanded children
  // follow their parent (flattened list: a count next to parents)
  const sub = kit.result.subitems;
  const isOpen = useIsExpanded(view.id);
  const collapsedGroups = useCollapsedGroups(view.id);
  const groups = kit.result.groups?.filter((g) => !g.hidden);
  const hasMore = groups ? groups.some((g) => !collapsedGroups.has(g.id) && g.rows.length > loadLimit) : kit.rows.length > loadLimit;
  // View settings › Conditional color tints the bars 
  const colorsOf = useConditionalColors(view, collection);
  // table rows drag up / down to reorder the items 
  const [dragRow, setDragRow] = useState<{ id: string; over: string | null; before: boolean; group: string | null } | null>(null);

  const toItem = (row: BlockRecord): Item => {
    const range = byProp ? rowDayRange(row, byProp, endProp) : null;
    if (!range) return { row, range: null, startMs: 0, endMs: 0 };
    const startMs = range.timed ? range.startMs : new DT(range.startMs, zone).startOf('day').ts;
    const endMs = range.timed ? Math.max(range.endMs, range.startMs + 15 * 60000) : new DT(range.endMs, zone).startOf('day').plus({ days: 1 }).ts;
    return { row, range, startMs, endMs };
  };
  const vrows: VRow[] = [];
  {
    const push = (row: BlockRecord, group: GroupResult | null) => {
      const info = subitemInfoFor(row, sub?.depth[row.id] ?? 0, sub, view, isOpen);
      vrows.push({ kind: 'item', item: toItem(row), group, info, count: sub?.mode === 'flattened' ? sub.counts[row.id] ?? 0 : 0, context: !!sub?.context.includes(row.id) });
      if (info?.open) for (const c of sub!.children[row.id] ?? []) push(c, group);
    };
    if (groups) {
      for (const g of groups) {
        vrows.push({ kind: 'group', group: g });
        if (!collapsedGroups.has(g.id)) for (const r of g.rows.slice(0, loadLimit)) push(r, g);
      }
    } else for (const r of kit.rows.slice(0, loadLimit)) push(r, null);
  }
  // Dependencies: drag a bar's connector onto another item to add a "Blocking" link 
  const link = useDependencyLinking({ blockingProp: editable && arrowsBy && schema[arrowsBy]?.type === 'relation' ? arrowsBy : undefined, rows: vrows.map((v) => (v.kind === 'item' ? v.item : { row: NO_ROW })), rowTop: HEAD, rowHeight: ROW });

  // rendered window: anchor ± 4800px, re-anchored when scrolling near an edge (infinite scroll)
  const spanMs = 4800 * z.msPerPixel;
  const originMs = useMemo(() => unitStart(new DT(anchor - spanMs, zone), z.primary === 'fifteen_minutes' || z.primary === 'hour' ? 'day' : z.primary).ts, [anchor, spanMs, zone, z.primary]);
  const endMs = anchor + spanMs;
  const width = Math.ceil((endMs - originMs) / z.msPerPixel);
  const x = (ms: number) => (ms - originMs) / z.msPerPixel;
  const msAt = (px: number) => originMs + px * z.msPerPixel;

  const axis = useMemo(() => {
    const out: { ms: number; next: number; d: DT }[] = [];
    let d = unitStart(new DT(originMs, zone), z.primary);
    for (let guard = 0; d.ts < endMs && guard < 4000; guard++) {
      const n = unitNext(d, z.primary);
      out.push({ ms: d.ts, next: n.ts, d });
      d = n;
    }
    return out;
  }, [originMs, endMs, zone, z.primary]);

  const secondary = useMemo(() => {
    const out: { ms: number; label: string }[] = [];
    let d = unitStart(new DT(originMs, zone), z.secondary);
    for (let guard = 0; d.ts < endMs && guard < 2000; guard++) {
      out.push({ ms: d.ts, label: secondaryShort(d, z.secondary) });
      d = unitNext(d, z.secondary);
    }
    return out;
  }, [originMs, endMs, zone, z.secondary]);

  const weekends = useMemo(() => {
    if (!z.weekends) return [];
    const out: { ms: number; end: number }[] = [];
    let d = new DT(originMs, zone).startOf('day');
    for (let guard = 0; d.ts < endMs && guard < 2000; guard++) {
      if (d.weekday === 6) out.push({ ms: d.ts, end: d.plus({ days: 2 }).ts });
      d = d.plus({ days: 1 });
    }
    return out;
  }, [originMs, endMs, zone, z.weekends]);

  const dividers = useMemo(() => {
    if (!z.divider) return [];
    const out: number[] = [];
    let d = unitStart(new DT(originMs, zone), z.divider);
    for (let guard = 0; d.ts < endMs && guard < 4000; guard++) {
      out.push(d.ts);
      d = unitNext(d, z.divider);
    }
    return out;
  }, [originMs, endMs, zone, z.divider]);

  // keep the visible center fixed across re-anchoring, zoom changes and table toggling
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewportW(el.clientWidth);
    el.scrollLeft = Math.max(0, x(visibleCenter.current) - el.clientWidth / 2);
    setScrollLeft(el.scrollLeft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originMs, zoom, showTable]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [byProp]);

  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setScrollLeft(el.scrollLeft);
    const c = msAt(el.scrollLeft + el.clientWidth / 2);
    visibleCenter.current = c;
    if (el.scrollLeft < el.clientWidth * 0.75 || el.scrollLeft + el.clientWidth * 1.75 > el.scrollWidth) setAnchor(c);
    if (persistTimer.current) clearTimeout(persistTimer.current);
    if (!readOnly) {
      persistTimer.current = setTimeout(() => {
        const saved = fmt.timeline_preference?.centerTimestamp ?? 0;
        if (Math.abs(c - saved) > 300 * z.msPerPixel) setFormat(view, { timeline_preference: { zoomLevel: zoom, centerTimestamp: Math.round(c) } }, 'timeline.scroll');
      }, 1500);
    }
  };

  const scrollToMs = (ms: number, smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    if (ms - spanMs * 0.6 < originMs || ms + spanMs * 0.6 > endMs) {
      visibleCenter.current = ms;
      setAnchor(ms);
      return;
    }
    el.scrollTo({ left: Math.max(0, x(ms) - el.clientWidth / 2), behavior: smooth ? 'smooth' : 'auto' });
  };

  const setZoom = (zl: ZoomLevel) => {
    const c = visibleCenter.current;
    setAnchor(c);
    setFormat(view, { timeline_preference: { zoomLevel: zl, centerTimestamp: Math.round(c) } }, 'timeline.setZoomLevel');
  };

  const step = (dir: -1 | 1) => {
    const d = new DT(visibleCenter.current, zone);
    const next = z.secondary === 'day' ? d.plus({ days: dir }) : z.secondary === 'year' ? d.plus({ years: dir }) : d.plus({ months: dir });
    scrollToMs(next.ts);
  };

  const addDateProperty = () => {
    const pid = addProperty(collection.id, 'date', { name: 'Date', view });
    if (pid) setQuery2(view, { timeline_by: pid });
  };

  if (!byProp) return <div className="nc-tl" style={{ marginInlineStart: bleed.left, marginInlineEnd: bleed.right }}><NoDate onAdd={addDateProperty} readOnly={readOnly} /></div>;

  const snapUnitMs = z.snap === 'day' ? DAY : 15 * 60000;
  const snap = (ms: number) => (z.snap === 'day' ? new DT(ms, zone).startOf('day').ts : Math.floor(ms / snapUnitMs) * snapUnitMs);

  /** Persist a [start, end) instant range (end exclusive for whole days) into the date property/properties. */
  const writeRange = (row: BlockRecord, range: DayRange | null, sMs: number, eMs: number) => {
    const timed = z.snap === 'fifteen_minutes' || !!range?.timed;
    const zoneName = range?.value.time_zone ?? tz;
    const z2 = zoneOrSystem(zoneName);
    const s = new DT(sMs, z2);
    const eIncl = new DT(timed ? eMs : new DT(eMs, zone).plus({ days: -1 }).ts, z2);
    const sd = s.toISODate();
    const ed = eIncl.ts < s.ts ? sd : eIncl.toISODate();
    run('timeline.updateDates', (tx) => {
      if (endProp) {
        setProperty(tx, row.id, byProp, dateValue(timed ? { type: 'datetime', start_date: sd, start_time: s.toHHmm(), time_zone: zoneName } : { type: 'date', start_date: sd }));
        setProperty(tx, row.id, endProp, dateValue(timed ? { type: 'datetime', start_date: ed, start_time: eIncl.toHHmm(), time_zone: zoneName } : { type: 'date', start_date: ed }));
        return;
      }
      let v: LitDate;
      if (timed) v = eMs - sMs <= 0 ? { type: 'datetime', start_date: sd, start_time: s.toHHmm(), time_zone: zoneName } : { type: 'datetimerange', start_date: sd, start_time: s.toHHmm(), end_date: ed, end_time: eIncl.toHHmm(), time_zone: zoneName };
      else v = sd === ed ? { type: 'date', start_date: sd } : { type: 'daterange', start_date: sd, end_date: ed };
      setProperty(tx, row.id, byProp, dateValue(v));
    });
  };

  const beginDrag = (e: React.PointerEvent, it: Item, mode: Drag['mode']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!editable) return;
    e.preventDefault();
    const st: Drag = { rowId: it.row.id, mode, x0: e.clientX, startMs: it.startMs, endMs: it.endMs, dStart: 0, dEnd: 0, moved: false };
    setDrag(st);
    const move = (ev: PointerEvent) => {
      const d = Math.round(((ev.clientX - st.x0) * z.msPerPixel) / snapUnitMs) * snapUnitMs;
      st.moved = st.moved || Math.abs(ev.clientX - st.x0) > 3;
      if (mode === 'move') { st.dStart = d; st.dEnd = d; }
      else if (mode === 'left') { st.dStart = Math.min(d, st.endMs - st.startMs - snapUnitMs); st.dEnd = 0; }
      else { st.dEnd = Math.max(d, st.startMs - st.endMs + snapUnitMs); st.dStart = 0; }
      setDrag({ ...st });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setDrag(null);
      if (!st.moved) {
        if (mode === 'move') kit.openRow(it.row.id);
        return;
      }
      if (st.dStart || st.dEnd) writeRange(it.row, it.range, st.startMs + st.dStart, st.endMs + st.dEnd);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const rowPointerMove = (e: React.PointerEvent<HTMLDivElement>, it: Item) => {
    if (!editable || it.range || drag) return;
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const ms = snap(msAt(e.clientX - rect.left + el.scrollLeft));
    if (!hover || hover.rowId !== it.row.id || hover.ms !== ms) setHover({ rowId: it.row.id, ms });
  };

  const placeholderEnd = (ms: number) => new DT(ms, zone).plus(z.placeholder).ts;

  const adjust = (it: Item): Item => (drag && drag.rowId === it.row.id ? { ...it, startMs: drag.startMs + drag.dStart, endMs: drag.endMs + drag.dEnd } : it);
  const shownRows: VRow[] = vrows.map((v) => (v.kind === 'item' ? { ...v, item: adjust(v.item) } : v));
  const shown = shownRows.flatMap((v) => (v.kind === 'item' ? [v.item] : []));
  const itemAt = (i: number): Item | undefined => { const v = shownRows[i]; return v?.kind === 'item' ? v.item : undefined; };
  const visibleProps = visibleProperties(view, schema);
  const nowMs = Date.now();
  const nowX = x(nowMs);
  const rowIndex = new Map(shownRows.flatMap((v, i) => (v.kind === 'item' ? [[v.item.row.id, i] as const] : [])));
  const rowKey = (v: VRow) => (v.kind === 'group' ? `g:${v.group.id}` : `${v.group?.id ?? ''}:${v.item.row.id}`);
  const groupHeader = (g: GroupResult) => (
    <GroupHeader group={g} view={view} collection={collection} readOnly={readOnly} collapsed={collapsedGroups.has(g.id)} onToggle={() => collapsedGroups.toggle(g.id)} onAdd={() => { kit.db?.addRow({ group: g, position: 'end', open: true }); }} />
  );
  const rowsH = shownRows.length * ROW + (readOnly ? 0 : ROW) + (hasMore ? ROW : 0);
  // the table's calculation row  sits under the add row
  const totalH = HEAD + rowsH + 4 + (showTable ? 36 : 0);
  const viewL = scrollLeft;
  const viewR = scrollLeft + viewportW;
  const cols = showTable ? tableColumns(view, schema) : [];
  const tableW = cols.reduce((a, c) => a + c.width, 0);
  const active = (() => {
    const id = drag?.rowId ?? hoverItem;
    const it = id ? shown.find((s) => s.row.id === id) : undefined;
    if (it?.range) return { s: it.startMs, e: it.endMs };
    if (hover) return { s: hover.ms, e: placeholderEnd(hover.ms) };
    return null;
  })();

  // The "now" label widens slightly; regular labels it overlaps are hidden.
  const unitW = (t: { ms: number; next: number }) => (t.next - t.ms) / z.msPerPixel;
  const nowT = z.primary === 'fifteen_minutes' || z.primary === 'hour' ? new DT(nowMs, zone).startOf('minute') : new DT(nowMs, zone).startOf('day');
  const nowUnit = unitStart(nowT, z.primary);
  const nowU = (unitNext(nowUnit, z.primary).ts - nowUnit.ts) / z.msPerPixel;
  const nowLeft = (z.align === 'start' ? x(nowT.ts) - nowU / 2 : x(nowT.ts)) - 4;
  const nowW = nowU + 8;
  const nowL = primaryLabel(nowT, z.primary, zoom);
  const nowText = nowL.single ?? (nowL.lighterFirst ? `${nowL.lighter} ${nowL.darker}` : `${nowL.darker} ${nowL.lighter}`);

  const zoomMenu = (e: React.MouseEvent<HTMLElement>) => openMenu(e.currentTarget, {
    width: 180,
    sections: [{ items: ZOOM_ORDER.map((zl) => ({ id: zl, label: ZOOM_LABEL[zl], checked: zl === zoom, onSelect: () => setZoom(zl) })) }],
  }, { placement: 'bottom-end' });

  const toggleTable = (v: boolean) => setFormat(view, { timeline_show_table: v, ...(v && !fmt.timeline_table_properties ? { timeline_table_properties: [{ property: 'title', visible: true, width: 280 }] } : {}) }, v ? 'TimelineControlBar.handleShowTableClick' : 'TimelineControlBar.handleHideTableClick');

  return (
    <div className="nc-tl" data-zoom={zoom} style={{ marginInlineStart: bleed.left, marginInlineEnd: bleed.right }}>
      <div className="nc-tl-frame" style={{ height: totalH + 1 }}>
        {showTable && (
          <div className="nc-tl-table" style={{ width: tableW }}>
            <div className="nc-tl-table-top">
              <div role="button" className="nc-tl-iconbtn" aria-label="Hide table" data-tooltip="Hide table" onClick={() => toggleTable(false)}><Icon name="arrowChevronDoubleLeft" size={16} /></div>
            </div>
            <div className="nc-tl-table-head">
              {cols.map((c) => (
                <div key={c.property} className="nc-tl-th" style={{ width: c.width }}>
                  <PropertyIcon prop={schema[c.property]} size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
                  <span>{schema[c.property]?.name}</span>
                </div>
              ))}
            </div>
            {shownRows.map((v) => {
              if (v.kind === 'group') return <div key={rowKey(v)} className="nc-tl-tr nc-tl-group-tr">{groupHeader(v.group)}</div>;
              const it = v.item;
              return (
              <div
                key={rowKey(v)}
                className={`nc-tl-tr ${hoverItem === it.row.id ? 'hover' : ''} ${v.context ? 'nc-subitem-context' : ''} ${dragRow?.over === it.row.id ? (dragRow.before ? 'drop-before' : 'drop-after') : ''}`}
                data-row-id={it.row.id}
                draggable={!readOnly}
                onDragStart={(e) => { setDragRow({ id: it.row.id, over: null, before: true, group: v.group?.id ?? null }); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', it.row.id); }}
                onDragOver={(e) => { if (!dragRow) return; e.preventDefault(); const r = e.currentTarget.getBoundingClientRect(); setDragRow({ ...dragRow, over: it.row.id, before: e.clientY < r.top + r.height / 2 }); }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragRow && dragRow.id !== it.row.id) {
                    const gb = kit.result.groupBy;
                    const into = v.group;
                    moveRow(view, collection.id, dragRow.id, dragRow.before ? { before: it.row.id } : { after: it.row.id }, gb && into && into.id !== dragRow.group ? (tx) => assignGroupInTx(tx, dragRow.id, gb.property, collection, into) : undefined);
                  }
                  setDragRow(null);
                }}
                onDragEnd={() => setDragRow(null)}
                onPointerEnter={() => setHoverItem(it.row.id)}
                onPointerLeave={() => setHoverItem(null)}
              >
                {cols.map((c) => (
                  <div key={c.property} className="nc-tl-td" style={{ width: c.width }}>
                    {c.property === 'title'
                      ? (
                        <span className="nc-tl-title-wrap">
                          {v.info && <SubitemToggle info={v.info} />}
                          <span role="link" className="nc-tl-title-cell" onClick={() => kit.openRow(it.row.id)}>{showIcon && <PageIcon block={it.row} size={18} fallback="page" />}<span className="nc-tl-title-text">{titleOf(it.row) || 'Untitled'}</span></span>
                          {v.count > 0 && <SubitemCount count={v.count} />}
                        </span>
                      )
                      : <PropertyCell row={it.row} schema={schema} propId={c.property} readOnly={readOnly} view={view} />}
                  </div>
                ))}
              </div>
              );
            })}
            {hasMore && <div className="nc-tl-tr nc-tl-load-more-spacer" />}
            {!readOnly && <div className="nc-tl-tr nc-tl-load-more-spacer" />}
            <CalcFooter columns={cols.map((c) => ({ property: c.property, prop: schema[c.property], w: c.width }))} view={view} collection={collection} rows={kit.rows} readOnly={readOnly} always />
          </div>
        )}
        <div className="nc-tl-main">
          <div className="nc-tl-scroll lit-scroller horizontal" ref={scrollRef} onScroll={onScroll}>
            <div className="lit-timeline-view nc-tl-canvas" style={{ width, height: totalH }}>
              <div className="nc-tl-bg">
                {weekends.map((w) => <div key={w.ms} className="nc-tl-weekend" style={{ insetInlineStart: x(w.ms), width: x(w.end) - x(w.ms) }} />)}
                {dividers.map((ms) => <div key={ms} className="nc-tl-divider" style={{ insetInlineStart: x(ms) }} />)}
                <div className="nc-tl-nowline" style={{ insetInlineStart: Math.floor(nowX) }} />
              </div>
              <div className="nc-tl-axis">
                <div className="nc-tl-secondary">
                  {secondary.map((s) => <div key={s.ms} className="nc-tl-sec-label" style={{ insetInlineStart: x(s.ms) }}>{s.label}</div>)}
                </div>
                <div className="nc-tl-primary">
                  {axis.map((t) => {
                    const w = unitW(t);
                    const left = z.align === 'middle' ? x(t.ms) : x(t.ms) - w / 2;
                    // The "now" label replaces any label it overlaps.
                    if (Math.abs(left + w / 2 - (nowLeft + nowW / 2)) < Math.max(w, nowW) / 2 + (z.align === 'middle' ? -4 : 2)) return null;
                    const inRange = !!active && z.highlight && t.ms >= active.s && t.ms < active.e;
                    return (
                      <div key={t.ms} className={`nc-tl-tick ${inRange ? 'active' : ''}`} style={{ insetInlineStart: left, width: w }} data-tooltip={z.primary === 'day' ? weekdayName(t.d.weekday) : undefined}>
                        <div className="nc-tl-tick-label"><LabelView l={primaryLabel(t.d, z.primary, zoom)} accent={inRange} /></div>
                      </div>
                    );
                  })}
                  <div className="nc-tl-tick now" style={{ insetInlineStart: nowLeft, width: nowW }}>
                    <div className="nc-tl-tick-label"><div className="nc-tl-now"><div className="nc-tl-now-circle" /><span>{nowText}</span></div></div>
                  </div>
                </div>
                <div className="nc-tl-nowdot" style={{ insetInlineStart: Math.floor(nowX) - 3 }} />
              </div>
              <div className="nc-tl-rows" style={{ top: HEAD }}>
                {shownRows.map((v) => {
                  if (v.kind === 'group') return <div key={rowKey(v)} className="lit-timeline-item-row nc-tl-row nc-tl-group-row">{!showTable && <div className="nc-tl-group-sticky">{groupHeader(v.group)}</div>}</div>;
                  const it = v.item;
                  const has = !!it.range;
                  const left = has ? x(it.startMs) + 2 : 0;
                  const w = has ? Math.max(10, x(it.endMs) - x(it.startMs) - 3) : 0;
                  const title = titleOf(it.row) || 'Untitled';
                  const ghost = !has && hover?.rowId === it.row.id ? { left: x(hover.ms) + 2, w: Math.max(10, x(placeholderEnd(hover.ms)) - x(hover.ms) - 3), ms: hover.ms } : null;
                  return (
                    <div
                      key={rowKey(v)}
                      className={`lit-timeline-item-row nc-tl-row ${hoverItem === it.row.id ? 'hover' : ''} ${v.context ? 'nc-subitem-context' : ''}`}
                      onPointerMove={(e) => rowPointerMove(e, it)}
                      onPointerEnter={() => setHoverItem(it.row.id)}
                      onPointerLeave={() => { setHoverItem(null); if (hover?.rowId === it.row.id) setHover(null); }}
                      onClick={() => { if (ghost) { writeRange(it.row, null, ghost.ms, placeholderEnd(ghost.ms)); setHover(null); } }}
                    >
                      {has && (
                        <div className={`lit-selectable lit-page-block lit-timeline-item nc-tl-item ${drag?.rowId === it.row.id ? 'dragging' : ''}`} data-block-id={it.row.id} style={{ insetInlineStart: left, width: w }}>
                          <a role="link" className="nc-tl-bar" data-testid="timeline-item-bar" style={colorsOf(it.row)?.row ? { background: conditionalBg(colorsOf(it.row)?.row) } : undefined} onPointerDown={(e) => beginDrag(e, it, 'move')} onClick={(e) => { e.preventDefault(); if (!editable) kit.openRow(it.row.id); }} />
                          {editable && <div className="lit-timeline-item-resizer-left nc-tl-resizer left" onPointerDown={(e) => beginDrag(e, it, 'left')} />}
                          {editable && <div className="lit-timeline-item-resizer-right nc-tl-resizer right" onPointerDown={(e) => beginDrag(e, it, 'right')} />}
                          {editable && arrowsBy && schema[arrowsBy] && <div className="nc-tl-connector" role="button" aria-label="Drag to add a dependency" data-testid="timeline-connector" onPointerDown={(e) => link.start(e, it.row.id)} />}
                        </div>
                      )}
                      {has && (
                        <div className="nc-tl-props-wrap">
                          <div className="lit-timeline-item-properties nc-tl-props" style={{ insetInlineStart: left }}>
                            {!showTable && v.info && v.info.count > 0 && <span className="nc-tl-subitem-toggle"><SubitemToggle info={{ ...v.info, depth: 0 }} /></span>}
                            {showIcon && <PageIcon block={it.row} size={16} fallback={null} className="nc-tl-item-icon" />}
                            <div className="nc-tl-item-title notranslate">{title}</div>
                            {!showTable && v.count > 0 && <SubitemCount count={v.count} />}
                            {visibleProps.map((pid) => <div key={pid} className="nc-tl-item-prop"><PropertyCell row={it.row} schema={schema} propId={pid} readOnly mode="card" noEdit /></div>)}
                          </div>
                        </div>
                      )}
                      {ghost && <div className="nc-tl-ghost" style={{ insetInlineStart: ghost.left, width: ghost.w }}><span>{title}</span></div>}
                    </div>
                  );
                })}
                {hasMore && (
                  <div className="lit-timeline-item-row nc-tl-row nc-tl-addrow">
                    <div role="button" className="nc-tl-add nc-tl-load-more" onClick={() => setLoadLimit((n) => n + firstLimit)}>
                      <Icon name="arrowDown" size={16} color="var(--lp-icon-tertiary)" /><span>Load more</span>
                    </div>
                  </div>
                )}
                {!readOnly && (
                  <div className="lit-timeline-item-row nc-tl-row nc-tl-addrow">
                    <div role="button" data-timeline-add-row-indicator="true" className="nc-tl-add" onClick={() => kit.addRow(undefined, { open: true })}>
                      <Icon name="plus" size={16} color="var(--lp-icon-tertiary)" /><span>New</span>
                    </div>
                  </div>
                )}
              </div>
              {arrowsBy && schema[arrowsBy] && (
                <svg className="nc-tl-arrows" width={width} height={rowsH} style={{ top: HEAD }} aria-hidden>
                  <defs><marker id={`nc-tl-ah-${view.id}`} markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0.5 L7,4 L0,7.5 z" fill="var(--lp-icon-tertiary)" /></marker></defs>
                  {link.line && <path d={`M${link.line.x1},${link.line.y1} L${link.line.x2},${link.line.y2}`} className={`nc-tl-arrow linking ${link.line.targetId ? 'has-target' : ''}`} markerEnd={`url(#nc-tl-ah-${view.id})`} />}
                  {shown.flatMap((it) => {
                    // timeline_arrows_by selects the relation used for blocking arrows: point this item's end to each item it blocks.
                    const bi = rowIndex.get(it.row.id)!;
                    const blocker = it;
                    return relationIdsOf(it.row.properties?.[arrowsBy] as never).flatMap((tid) => {
                      const to = rowIndex.get(tid);
                      const target = to !== undefined ? itemAt(to) : undefined;
                      if (!blocker.range || to === undefined || !target?.range) return [];
                      const bid = blocker.row.id;
                      const x1 = x(blocker.endMs) - 1;
                      const y1 = bi! * ROW + ROW / 2;
                      const x2 = x(target.startMs) + 2;
                      const y2 = to * ROW + ROW / 2;
                      const late = x2 < x1 + 16;
                      const d = late ? `M${x1},${y1} H${x1 + 8} V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2 - 3}` : `M${x1},${y1} H${(x1 + x2) / 2} V${y2} H${x2 - 3}`;
                      return [<path key={`${bid}-${tid}`} d={d} className={`nc-tl-arrow ${late ? 'late' : ''}`} markerEnd={`url(#nc-tl-ah-${view.id})`} />];
                    });
                  })}
                </svg>
              )}
            </div>
          </div>
          <div className="nc-tl-head-left">
            {!showTable && !readOnly && <div role="button" className="nc-tl-iconbtn" aria-label="Show table" data-tooltip="Show table" onClick={() => toggleTable(true)}><Icon name="arrowChevronDoubleRight" size={16} /></div>}
            <span className="nc-tl-title" style={{ paddingInlineStart: !showTable && !readOnly ? 0 : 16 }}>{secondaryTitle(msAt(scrollLeft + 8), z.secondary, tz)}</span>
            <div className="nc-tl-fade left" />
          </div>
          <div className="nc-tl-head-right">
            <div className="nc-tl-fade right" />
            <div className="nc-tl-controls">
              <div role="button" className="nc-tl-manage" onClick={() => useUI.getState().toast('Calendar sync is not available')}><Icon name="calendar" size={16} /><span>Manage in Calendar</span></div>
              <div role="button" className="nc-tl-zoom" aria-haspopup="dialog" onClick={zoomMenu}>{ZOOM_LABEL[zoom]}<Icon name="chevronDown" size={14} /></div>
            </div>
            <div role="button" className="nc-tl-nav" aria-label="Previous" onClick={() => step(-1)} style={{ marginInlineStart: 4 }}><Icon name="chevronLeft" size={16} /></div>
            <div role="button" className="nc-tl-today" onClick={() => scrollToMs(Date.now())}>Today</div>
            <div role="button" className="nc-tl-nav" aria-label="Next" onClick={() => step(1)}><Icon name="chevronRight" size={16} /></div>
          </div>
          <div className="nc-tl-offscreen-layer" style={{ top: HEAD }}>
            {shownRows.map((v, i) => {
              if (v.kind !== 'item' || !v.item.range) return null;
              const it = v.item;
              const side = x(it.endMs) < viewL + 4 ? 'left' : x(it.startMs) > viewR - 4 ? 'right' : null;
              if (!side) return null;
              return (
                <div key={rowKey(v)} role="button" className={`nc-tl-offscreen ${side}`} style={{ top: i * ROW + 9 }} aria-label={side === 'left' ? 'Scroll left to item' : 'Scroll right to item'} onClick={() => scrollToMs(side === 'left' ? it.startMs : it.endMs)}>
                  <Icon name={side === 'left' ? 'arrowLeft' : 'arrowRight'} size={12} color="var(--lp-bg-primary)" />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

registerView('timeline', TimelineView);

// ---------- layout settings (Group timeline by / Use separate start and end dates / Show table / Dependencies) ----------

function TimelineLayoutSettings({ view, collection, readOnly }: LayoutSettingsProps) {
  const schema = collection.schema;
  const fmt = (view.format ?? {}) as Record<string, any>;
  const by = dateByProperty(view, schema, 'timeline_by');
  const end = dateByProperty(view, schema, 'timeline_by_end');
  const separate = !!end;
  const arrows = fmt.timeline_arrows_by?.property as string | undefined;
  const selfRelations = Object.entries(schema).filter(([, p]) => p.type === 'relation' && p.collection_id === collection.id);
  const pick = (key: 'timeline_by' | 'timeline_by_end') => (e: React.MouseEvent<HTMLDivElement>) => pickMenu(e.currentTarget, datePropertyItems(schema, key === 'timeline_by' ? by : end, (id) => setQuery2(view, { [key]: id }, 'timeline.setDateProperty')));
  return (
    <>
      {separate ? (
        <>
          <SettingsRow label="Start date" value={by ? schema[by]?.name : 'None'} disabled={readOnly} onClick={pick('timeline_by')} />
          <SettingsRow label="End date" value={end ? schema[end]?.name : 'None'} disabled={readOnly} onClick={pick('timeline_by_end')} />
        </>
      ) : (
        <SettingsRow label="Group timeline by" value={by ? schema[by]?.name : 'None'} disabled={readOnly} onClick={pick('timeline_by')} />
      )}
      <SettingsToggle label="Use separate start and end dates" on={separate} disabled={readOnly} onChange={(v) => {
        if (!v) return setQuery2(view, { timeline_by_end: undefined }, 'timeline.separateDates');
        const other = dateProperties(schema).find(([id, p]) => id !== by && p.type === 'date')?.[0];
        if (other) return setQuery2(view, { timeline_by_end: other }, 'timeline.separateDates');
        const pid = addProperty(collection.id, 'date', { name: 'End date', view });
        if (pid) setQuery2(view, { timeline_by_end: pid }, 'timeline.separateDates');
      }} />
      <SettingsToggle label="Show table" on={fmt.timeline_show_table === true} disabled={readOnly} onChange={(v) => setFormat(view, { timeline_show_table: v, ...(v && !fmt.timeline_table_properties ? { timeline_table_properties: [{ property: 'title', visible: true, width: 280 }] } : {}) })} />
      {fmt.timeline_show_table === true && (
        <SettingsRow label="Table properties" value={`${tableColumns(view, schema).length} shown`} disabled={readOnly} onClick={(e) => {
          const cur = (fmt.timeline_table_properties as { property: string; visible?: boolean; width?: number }[] | undefined) ?? [{ property: 'title', visible: true, width: 280 }];
          const ids = ['title', ...Object.keys(schema).filter((k) => k !== 'title')];
          pickMenu(e.currentTarget, ids.filter((id) => schema[id]).map((id) => {
            const entry = cur.find((c) => c.property === id);
            const on = !!entry && entry.visible !== false;
            return {
              id, label: schema[id].name, icon: <PropertyIcon prop={schema[id]} size={16} />, checked: on, disabled: id === 'title',
              onSelect: () => {
                const next = cur.filter((c) => c.property !== id);
                if (!on) next.push({ property: id, visible: true, width: entry?.width ?? 160 });
                setFormat(view, { timeline_table_properties: next.length ? next : [{ property: 'title', visible: true, width: 280 }] });
              },
            };
          }), 260, 'Find a field…');
        }} />
      )}
      <SettingsRow label="Dependencies" value={arrows && schema[arrows] ? schema[arrows].name : 'Off'} disabled={readOnly} onClick={(e) => pickMenu(e.currentTarget, [
        { id: 'off', label: 'Off', checked: !arrows, onSelect: () => setFormat(view, { timeline_arrows_by: undefined }) },
        ...selfRelations.map(([id, p]) => ({ id, label: p.name, icon: 'relation', checked: arrows === id, onSelect: () => setFormat(view, { timeline_arrows_by: { property: id } }) })),
        {
          id: 'create', label: 'Create “Blocked by” and “Blocking”', icon: 'plus', onSelect: () => {
            // turns on the Dependencies feature: "Blocking" (arrows) ↔ "Blocked by", default date shifting
            const pid = turnOnDependencies(getCollection(collection.id) ?? collection, { view });
            if (pid && getCollection(collection.id)?.schema[pid]) setFormat(view, { timeline_arrows_by: { property: pid } });
          },
        },
      ], 280)} />
    </>
  );
}

registerLayoutSettings('timeline', TimelineLayoutSettings);

/** New timeline views: query2.timeline_by = first date property (creates "Date" when missing), month zoom centered on now. */
viewCreationHooks.timeline = (tx, viewId, collection: CollectionRecord) => {
  let pid = dateProperties(collection.schema)[0]?.[0];
  if (!pid) {
    pid = newPropId(collection.schema);
    tx.set('collection', collection.id, ['schema', pid], { name: 'Date', type: 'date' } as PropertySchema);
  }
  tx.update('collection_view', viewId, ['query2'], { timeline_by: pid, aggregations: [] });
  tx.update('collection_view', viewId, ['format'], {
    timeline_preference: { zoomLevel: 'month', centerTimestamp: Date.now() },
    timeline_show_table: false,
    timeline_table_properties: [{ property: 'title', visible: true, width: 280 }],
  });
};

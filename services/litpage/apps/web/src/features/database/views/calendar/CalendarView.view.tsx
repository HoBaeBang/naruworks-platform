// Calendar view. Layout 
// header 42px (month title 14px/600, "Manage in Calendar", ‹ Today ›), weekday row 24px (12px tertiary),
// week rows 124px with 1px var(--lp-border-primary) grid, weekends var(--lp-bg-secondary), day number top-right (today = red
// circle), items 34px tall lanes from top 30px (padding 3px 6px, card var(--lp-calendar-item-background) + shadow, title 14px/600).
// Behaviors: month/week ranges (format.calendar_view_range), Show weekends, query2.calendar_by, drag to move,
// edge handles to resize, "+" on day hover to add, "N more" overflow, center peek on open.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord, PropertySchema } from '@nc/shared/records.ts';
import { monthName, weekdayName } from '@nc/shared/formula/index.ts';
import { registerLayoutSettings, registerView, type LayoutSettingsProps, type ViewProps } from '../../viewRegistry.ts';
import { Icon } from '../../../../components/Icon.tsx';
import { useUI } from '../../../../lib/store/ui.ts';
import { PropertyCell } from '../../properties/PropertyCell.tsx';
import { addProperty, viewCreationHooks, viewProperties } from '../../actions.ts';
import { newPropId, startOfWeekSetting } from '../../advanced/index.ts';
import {
  SettingsRow, SettingsToggle, datePropertyItems, pickMenu, setFormat,
  dateByProperty, dateProperties, dateValue, dayNum, isoOfDay, rowDayRange, setQuery2, shiftRowDate, todayNum, useViewKit, visibleProperties, weekdayOf, type DayRange,
} from '../../advanced/viewKit.tsx';
import { NO_DATE_DRAG_TYPE, setRowDay } from './NoDate.tsx';
import { conditionalBg, useConditionalColors } from '../../data.ts';
import { childIdsOf } from '@nc/shared/database/index.ts';
import { openMenu } from '../../../../components/Menu.tsx';
import { records } from '../../../../lib/store/records.ts';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { titleOf } from '../../advanced/context.ts';
import './calendar.css';

const ROW_HEIGHT = 124;
const LANE = 34;
const TOP = 30;
const MAX_LANES = 3;

interface Placed {
  row: BlockRecord;
  range: DayRange;
  startCol: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

function monthStart(n: number): number {
  const iso = isoOfDay(n);
  return dayNum(`${iso.slice(0, 8)}01`);
}

function addMonths(n: number, k: number): number {
  const [y, m] = isoOfDay(n).split('-').map(Number);
  const t = (y * 12 + (m - 1)) + k;
  const yy = Math.floor(t / 12);
  const mm = t - yy * 12 + 1;
  return dayNum(`${yy}-${String(mm).padStart(2, '0')}-01`);
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function layoutWeek(items: { row: BlockRecord; range: DayRange }[], weekStart: number, days: number[]): Placed[] {
  const colOf = new Map(days.map((d, i) => [d, i]));
  const weekEnd = weekStart + 6;
  const segs = items
    .filter((it) => it.range.start <= weekEnd && it.range.end >= weekStart)
    .map((it) => {
      const s = Math.max(it.range.start, weekStart);
      const e = Math.min(it.range.end, weekEnd);
      // clip to visible columns (hidden weekends)
      let sc = -1;
      let ec = -1;
      for (let d = s; d <= e; d++) if (colOf.has(d)) { if (sc < 0) sc = colOf.get(d)!; ec = colOf.get(d)!; }
      return { ...it, sc, ec };
    })
    .filter((x) => x.sc >= 0)
    .sort((a, b) => a.sc - b.sc || (b.ec - b.sc) - (a.ec - a.sc) || a.range.startMs - b.range.startMs || (a.row.created_time ?? 0) - (b.row.created_time ?? 0));
  const lanes: number[][] = [];
  return segs.map((s) => {
    let lane = 0;
    for (;; lane++) {
      const used = lanes[lane] ?? (lanes[lane] = []);
      if (!used.some((c) => c >= s.sc && c <= s.ec)) {
        for (let c = s.sc; c <= s.ec; c++) used.push(c);
        break;
      }
    }
    return { row: s.row, range: s.range, startCol: s.sc, span: s.ec - s.sc + 1, lane, continuesBefore: s.range.start < weekStart, continuesAfter: s.range.end > weekEnd };
  });
}

function NoDateProperty({ onAdd, readOnly }: { onAdd: () => void; readOnly: boolean }) {
  return (
    <div className="nc-cal-nodate">
      <div className="nc-cal-nodate-title">No date field</div>
      {readOnly ? <div>Calendar layouts need a date field to display entries.</div> : <div><span role="link" className="nc-cal-link" onClick={onAdd}>Add a date field</span> to this table to display a calendar layout.</div>}
    </div>
  );
}

interface DragState {
  rowId: string;
  mode: 'move' | 'left' | 'right';
  originDay: number;
  range: DayRange;
  deltaStart: number;
  deltaEnd: number;
  moved: boolean;
  x0: number;
  y0: number;
}

function CalendarView(props: ViewProps) {
  const kit = useViewKit(props);
  const { view, collection, readOnly } = kit;
  const schema = collection.schema;
  const dateProp = dateByProperty(view, schema, 'calendar_by');
  const fmt = (view.format ?? {}) as Record<string, unknown>;
  const range = (fmt.calendar_view_range as string) === 'week' ? 'week' : 'month';
  const showWeekends = fmt.calendar_show_weekends !== false;
  const weekStartDay = startOfWeekSetting();
  const today = todayNum();
  // the last viewed range comes back: remembered per view in this browser
  const [anchor, setAnchorState] = useState(() => readAnchor(view.id, range) ?? (range === 'week' ? today : monthStart(today)));
  const setAnchor = (n: number) => {
    setAnchorState(n);
    writeAnchor(view.id, range, n);
  };
// scrolling down past the month appends the next months: infinite scroll forward only
  const [extraMonths, setExtraMonths] = useState(0);
  const [visibleMonth, setVisibleMonth] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [drag, setDrag] = useState<DragState | null>(null);
  // a page dragged out of "No date (N)" onto a day 
  const [dropDay, setDropDay] = useState<number | null>(null);
  // View settings › Conditional color tints the cards 
  const colorsOf = useConditionalColors(view, collection);
  const gridRef = useRef<HTMLDivElement>(null);
  const editable = !readOnly && !!dateProp && schema[dateProp]?.type === 'date';
  // calendar content sits 8px inside the page column (lit-calendar-view padding-inline 104px in a 96px bleed)
  const bleed = kit.db?.bleed ?? { left: 0, right: 0 };
  const padStyle = { paddingInlineStart: bleed.left ? bleed.left + 8 : 0, paddingInlineEnd: bleed.right ? bleed.right + 8 : 0 };

  const firstRange = useRef(true);
  useEffect(() => {
    if (firstRange.current) { firstRange.current = false; return; }
    setAnchor(range === 'week' ? today : monthStart(today));
    setExtraMonths(0);
  }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || range !== 'month') return;
    // the observer's first report is the initial layout, not a scroll: only scrolling further appends a month
    let initial = true;
    const io = new IntersectionObserver((entries) => {
      if (initial) { initial = false; return; }
      if (entries.some((en) => en.isIntersecting)) setExtraMonths((n) => (n < 24 ? n + 1 : n));
    }, { rootMargin: '0px 0px 120px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [range, anchor, !!dateProp]); // eslint-disable-line react-hooks/exhaustive-deps
  // the header names the month at the top of the calendar while scrolling through appended months
  useEffect(() => {
    if (range !== 'month' || !extraMonths) { setVisibleMonth(null); return; }
    const grid = gridRef.current;
    const scroller = grid?.closest('.lit-scroller.vertical, .nc-page-scroller') as HTMLElement | null;
    if (!grid || !scroller) return;
    const update = () => {
      const top = Math.max(scroller.getBoundingClientRect().top, grid.getBoundingClientRect().top) + 40;
      const week = [...grid.querySelectorAll<HTMLElement>('.nc-cal-week')].find((w) => w.getBoundingClientRect().bottom > top);
      const mid = week?.dataset.mid;
      setVisibleMonth(mid ?? null);
    };
    update();
    scroller.addEventListener('scroll', update, { passive: true });
    return () => scroller.removeEventListener('scroll', update);
  }, [range, extraMonths, anchor]);

  const weeks = useMemo(() => {
    if (range === 'week') {
      const s = anchor - ((weekdayOf(anchor) - weekStartDay + 7) % 7);
      return [s];
    }
    const first = anchor;
    const start = first - ((weekdayOf(first) - weekStartDay + 7) % 7);
    const next = addMonths(first, 1 + extraMonths);
    const out: number[] = [];
    for (let w = start; w < next; w += 7) out.push(w);
    return out;
  }, [anchor, range, weekStartDay, extraMonths]);

  const items = useMemo(() => {
    if (!dateProp) return [];
    return kit.rows.flatMap((r) => {
      const rr = rowDayRange(r, dateProp);
      return rr ? [{ row: r, range: rr }] : [];
    });
  }, [kit.rows, dateProp]);

  const shown = drag ? items.map((it) => (it.row.id === drag.rowId ? { ...it, range: { ...it.range, start: drag.range.start + drag.deltaStart, end: drag.range.end + drag.deltaEnd } } : it)) : items;
  const visibleProps = visibleProperties(view, schema);
// “Wrap entry titles” stores calendar_properties[title].wrap on the title entry
  const wrapTitles = ((fmt.calendar_properties as { property: string; wrap?: boolean }[] | undefined) ?? []).some((e) => e.property === 'title' && e.wrap === true);
  // sub-items "Card property": parents show "N sub-items" (a list of them on click)
  const sub = kit.result.subitems;
  const cardSubitems = sub?.mode === 'show' && items.some((it) => (sub.counts[it.row.id] ?? 0) > 0);
  const lane = LANE + visibleProps.length * 20 + (wrapTitles ? 20 : 0) + (cardSubitems ? 20 : 0);
  const openSubitems = (anchor: HTMLElement, row: BlockRecord) => {
    const kids = sub ? childIdsOf(row, sub).map((id) => records.get<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && b.alive !== false) : [];
    openMenu(anchor, { width: 240, sections: [{ items: kids.map((k) => ({ id: k.id, label: titleOf(k) || 'Untitled', icon: <PageIcon block={k} size={16} fallback="page" />, onSelect: () => kit.openRow(k.id) })) }] }, { placement: 'bottom-start' });
  };

  const addDateProperty = () => {
    const pid = addProperty(collection.id, 'date', { name: 'Date', view });
    if (pid) setQuery2(view, { calendar_by: pid });
  };

  if (!dateProp) return <div className="nc-cal" style={padStyle}><NoDateProperty onAdd={addDateProperty} readOnly={readOnly} /></div>;

  const monthTitle = (() => {
    const iso = visibleMonth ? `${visibleMonth}-01` : isoOfDay(range === 'week' ? weeks[0] + 3 : anchor);
    const [y, m] = iso.split('-').map(Number);
    return `${monthName(m)} ${y}`;
  })();

  const dayColumns = (weekStart: number) => {
    const out: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = weekStart + i;
      const wd = weekdayOf(d);
      if (!showWeekends && (wd === 0 || wd === 6)) continue;
      out.push(d);
    }
    return out;
  };
  const headerDays = dayColumns(weeks[0]);
  const ncols = headerDays.length;

  const dayAtPoint = (x: number, y: number): number | null => {
    const grid = gridRef.current;
    if (!grid) return null;
    const rows = Array.from(grid.querySelectorAll<HTMLElement>('.nc-cal-week'));
    for (let wi = 0; wi < rows.length; wi++) {
      const r = rows[wi].getBoundingClientRect();
      if (y >= r.top && y < r.bottom || (wi === rows.length - 1 && y >= r.bottom) || (wi === 0 && y < r.top)) {
        const col = Math.max(0, Math.min(ncols - 1, Math.floor(((x - r.left) / r.width) * ncols)));
        return dayColumns(weeks[wi])[col] ?? null;
      }
    }
    return null;
  };

  const startDrag = (e: React.PointerEvent, it: Placed, mode: DragState['mode']) => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    const day = dayAtPoint(e.clientX, e.clientY) ?? it.range.start;
    const st: DragState = { rowId: it.row.id, mode, originDay: day, range: it.range, deltaStart: 0, deltaEnd: 0, moved: false, x0: e.clientX, y0: e.clientY };
    setDrag(st);
    const move = (ev: PointerEvent) => {
      const d = dayAtPoint(ev.clientX, ev.clientY);
      if (d === null) return;
      const delta = d - st.originDay;
      st.moved = st.moved || Math.abs(ev.clientX - st.x0) + Math.abs(ev.clientY - st.y0) > 4;
      if (mode === 'move') { st.deltaStart = delta; st.deltaEnd = delta; }
      else if (mode === 'left') { st.deltaStart = Math.min(delta, st.range.end - st.range.start); st.deltaEnd = 0; }
      else { st.deltaEnd = Math.max(delta, st.range.start - st.range.end); st.deltaStart = 0; }
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
      if (st.deltaStart || st.deltaEnd) shiftRowDate(it.row, dateProp, st.range, st.range.start + st.deltaStart, st.range.end + st.deltaEnd);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const addOn = (day: number) => {
    const p = schema[dateProp];
    if (!p || p.type !== 'date') return;
    kit.addRow({ [dateProp]: dateValue({ type: 'date', start_date: isoOfDay(day) }) }, { open: true });
  };

  const goto = (dir: -1 | 0 | 1) => {
    if (dir === 0) setAnchor(range === 'week' ? today : monthStart(today));
    else setAnchor(range === 'week' ? anchor + 7 * dir : addMonths(visibleMonth ? dayNum(`${visibleMonth}-01`) : anchor, dir));
    setExpanded({});
    setExtraMonths(0);
  };

  const currentMonth = visibleMonth ?? isoOfDay(anchor).slice(0, 7);

  return (
    <div className="nc-cal lit-calendar-view" data-range={range} style={padStyle}>
      <div className="nc-cal-header">
        <div className="nc-cal-title">{monthTitle}</div>
        <div style={{ flex: 1 }} />
        <div role="button" className="nc-cal-manage" data-tooltip="Calendar sync is not available" onClick={() => useUI.getState().toast('Calendar sync is not available')}>
          <Icon name="calendar" size={16} />
          <span>Manage in Calendar</span>
        </div>
        <div role="button" className="nc-cal-nav" aria-label={range === 'week' ? 'Previous Week' : 'Previous Month'} onClick={() => goto(-1)}><Icon name="chevronLeft" size={20} color="var(--lp-icon-secondary)" /></div>
        <div role="button" className="nc-cal-today" onClick={() => goto(0)}>Today</div>
        <div role="button" className="nc-cal-nav" aria-label={range === 'week' ? 'Next Week' : 'Next Month'} onClick={() => goto(1)}><Icon name="chevronRight" size={20} color="var(--lp-icon-secondary)" /></div>
      </div>
      <div className="nc-cal-days lit-calendar-header-days">
        {headerDays.map((d) => <div key={d}>{weekdayName(weekdayOf(d) === 0 ? 7 : weekdayOf(d), 'short')}</div>)}
      </div>
      <div className="nc-cal-grid" ref={gridRef}>
        {weeks.map((ws) => {
          const cols = dayColumns(ws);
          const placed = layoutWeek(shown, ws, cols);
          const laneCount = placed.reduce((m, p) => Math.max(m, p.lane + 1), 0);
          const isWeek = range === 'week';
          const limit = isWeek || expanded[ws] ? Infinity : MAX_LANES;
          const visible = placed.filter((p) => p.lane < limit);
          const hiddenByDay = new Map<number, number>();
          for (const p of placed) if (p.lane >= limit) for (let c = p.startCol; c < p.startCol + p.span; c++) hiddenByDay.set(c, (hiddenByDay.get(c) ?? 0) + 1);
          const lanesShown = Math.min(laneCount, limit);
          const height = isWeek ? Math.max(560, TOP + laneCount * lane + 40) : Math.max(ROW_HEIGHT, TOP + lanesShown * lane + (hiddenByDay.size ? 26 : 8));
          return (
            <div key={ws} className="nc-cal-week" data-mid={isoOfDay(ws + 6).slice(0, 7)} style={{ height }}>
              {cols.map((d) => {
                const wd = weekdayOf(d);
                const iso = isoOfDay(d);
                const inMonth = isWeek || iso.slice(0, 7) === currentMonth;
                const first = iso.endsWith('-01');
                const hidden = hiddenByDay.get(cols.indexOf(d)) ?? 0;
                return (
                  <div
                    key={d}
                    className={`nc-cal-day ${wd === 0 || wd === 6 ? 'weekend' : ''} ${dropDay === d ? 'nc-drop-target' : ''}`}
                    data-day={iso}
                    onDoubleClick={() => !readOnly && addOn(d)}
                    onDragOver={(e) => { if (editable && e.dataTransfer.types.includes(NO_DATE_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (dropDay !== d) setDropDay(d); } }}
                    onDragLeave={() => { if (dropDay === d) setDropDay(null); }}
                    onDrop={(e) => { const id = e.dataTransfer.getData(NO_DATE_DRAG_TYPE); setDropDay(null); if (id && editable) { e.preventDefault(); setRowDay(id, view, collection, d); } }}
                  >
                    {!readOnly && (
                      <div role="button" className="nc-cal-add" aria-label="Create an item" data-tooltip="Create an item" onClick={() => addOn(d)}><Icon name="plus" size={14} /></div>
                    )}
                    <div className={`nc-cal-num lit-calendar-view-day ${inMonth ? '' : 'outside'} ${d === today ? 'today' : ''}`} data-testid={d === today ? 'today-day-number' : undefined}>
                      {first && d !== today ? `${monthName(Number(iso.slice(5, 7)), true)} 1` : Number(iso.slice(8))}
                    </div>
                    {hidden > 0 && (
                      <div role="button" className="nc-cal-more" style={{ top: TOP + lanesShown * lane }} onClick={() => setExpanded((x) => ({ ...x, [ws]: true }))}>{hidden} more</div>
                    )}
                  </div>
                );
              })}
              <div className="nc-cal-items">
                {visible.map((p) => {
                  const timed = p.range.timed;
                  const startLbl = timed ? timeLabel(p.range.startMs) : '';
                  const endLbl = timed && p.range.endMs !== p.range.startMs ? timeLabel(p.range.endMs) : '';
                  return (
                    <div
                      key={p.row.id}
                      className={`nc-cal-item lit-selectable lit-page-block lit-collection-item ${drag?.rowId === p.row.id && drag.moved ? 'dragging' : ''}`}
                      data-block-id={p.row.id}
                      style={{ width: `calc(${(p.span * 100) / ncols}%)`, left: `calc(${(p.startCol * 100) / ncols}%)`, top: TOP + p.lane * lane, height: lane }}
                    >
                      <div
                        role="link"
                        className={`nc-cal-card ${p.continuesBefore ? 'cont-before' : ''} ${p.continuesAfter ? 'cont-after' : ''}`}
                        style={colorsOf(p.row)?.row ? { background: conditionalBg(colorsOf(p.row)?.row) } : undefined}
                        onPointerDown={(e) => (editable ? startDrag(e, p, 'move') : undefined)}
                        onClick={() => { if (!editable) kit.openRow(p.row.id); }}
                      >
                        <div className={`nc-cal-card-title ${wrapTitles ? 'wrap' : ''}`}>
                          {startLbl && <div className="nc-cal-time">{startLbl}{endLbl && <span> → {endLbl}</span>}</div>}
                          <div className="nc-cal-card-name notranslate">{(p.row.properties?.title ?? []).map((x) => x[0]).join('') || 'Untitled'}</div>
                        </div>
                        {visibleProps.length > 0 && (
                          <div className="nc-cal-card-props">
                            {visibleProps.map((pid) => <PropertyCell key={pid} row={p.row} schema={schema} propId={pid} readOnly mode="card" noEdit />)}
                          </div>
                        )}
                        {cardSubitems && (sub!.counts[p.row.id] ?? 0) > 0 && (
                          <div role="button" className="nc-cal-card-subitems" data-testid="calendar-subitems" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); openSubitems(e.currentTarget, p.row); }}>
                            <Icon name="triangleRight" size={10} />
                            <span>{`${sub!.counts[p.row.id]} ${sub!.counts[p.row.id] === 1 ? 'sub-item' : 'sub-items'}`}</span>
                          </div>
                        )}
                        {editable && <div className="nc-cal-handle left lit-calendar-item-drag-handle-left" onPointerDown={(e) => startDrag(e, p, 'left')} />}
                        {editable && <div className="nc-cal-handle right lit-calendar-item-drag-handle-right" onPointerDown={(e) => startDrag(e, p, 'right')} />}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {range === 'month' && <div ref={sentinelRef} className="nc-cal-sentinel" aria-hidden />}
    </div>
  );
}

const ANCHOR_KEY = (viewId: string, range: string) => `nc:calendarAnchor:${viewId}:${range}`;
function readAnchor(viewId: string, range: string): number | null {
  try {
    const v = Number(localStorage.getItem(ANCHOR_KEY(viewId, range)));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}
function writeAnchor(viewId: string, range: string, n: number) {
  try {
    localStorage.setItem(ANCHOR_KEY(viewId, range), String(n));
  } catch {
    /* storage unavailable */
  }
}

registerView('calendar', CalendarView);

/** Layout page rows: Group calendar by, Display calendar as, and Show weekends. */
function CalendarLayoutSettings({ view, collection, readOnly }: LayoutSettingsProps) {
  const schema = collection.schema;
  const fmt = (view.format ?? {}) as Record<string, unknown>;
  const by = dateByProperty(view, schema, 'calendar_by');
  const range = fmt.calendar_view_range === 'week' ? 'week' : 'month';
  return (
    <>
      <SettingsRow label="Group calendar by" value={by ? schema[by]?.name : 'None'} disabled={readOnly} onClick={(e) => pickMenu(e.currentTarget, datePropertyItems(schema, by, (id) => setQuery2(view, { calendar_by: id }, 'calendar.setDateProperty')))} />
      <SettingsRow label="Display calendar as" value={range === 'week' ? 'Week' : 'Month'} disabled={readOnly} onClick={(e) => pickMenu(e.currentTarget, [
        { id: 'month', label: 'Month', checked: range === 'month', onSelect: () => setFormat(view, { calendar_view_range: 'month' }) },
        { id: 'week', label: 'Week', checked: range === 'week', onSelect: () => setFormat(view, { calendar_view_range: 'week' }) },
      ])} />
      <SettingsToggle label="Show weekends" on={fmt.calendar_show_weekends !== false} disabled={readOnly} onChange={(v) => setFormat(view, { calendar_show_weekends: v })} />
      <SettingsToggle label="Wrap entry titles" on={viewProperties(view, schema).some((e) => e.property === 'title' && (e as { wrap?: boolean }).wrap === true)} disabled={readOnly} onChange={(v) => {
        const entries = viewProperties(view, schema);
        const next = entries.some((e) => e.property === 'title') ? entries.map((e) => (e.property === 'title' ? { ...e, wrap: v } : e)) : [{ property: 'title', visible: true, wrap: v }, ...entries];
        setFormat(view, { calendar_properties: next }, 'calendar.wrapPageTitles');
      }} />
    </>
  );
}

registerLayoutSettings('calendar', CalendarLayoutSettings);

/** New calendar views get query2.calendar_by (first date property; creates "Date" when missing) —. */
viewCreationHooks.calendar = (tx, viewId, collection) => {
  let pid = dateProperties(collection.schema)[0]?.[0];
  if (!pid) {
    pid = newPropId(collection.schema);
    tx.set('collection', collection.id, ['schema', pid], { name: 'Date', type: 'date' } as PropertySchema);
  }
  tx.update('collection_view', viewId, ['query2'], { calendar_by: pid, aggregations: [] });
};



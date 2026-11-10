// Shared plumbing for the advanced views (calendar, timeline, chart, map, feed, dashboard, form):
// rows through the core query engine (filters/sorts/search), row opening/creation via the database context,
// view format/query2 updates, date helpers working in calendar days ("day numbers" = days since 1970-01-01).
import { useMemo, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { dateInterval, hasTime, propertyFValue, type LitDate } from '@nc/shared/formula/index.ts';
import { useDatabaseContext, type PeekMode } from '../DatabaseContext.tsx';
import { useViewQuery } from '../data.ts';
import { createRow, updateViewFormat, updateQuery2, viewProperties } from '../actions.ts';
import { openPeek, openPage } from '../../../lib/router.ts';
import { run, setProperty } from '../../../lib/blocks.ts';
import { formulaContext, userTimeZone } from './context.ts';
import type { ViewProps } from '../viewRegistry.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { Toggle as CoreToggle } from '../properties/editors/DatePicker.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';

export const DEFAULT_PEEK: Record<string, PeekMode> = { calendar: 'center_peek', feed: 'center_peek', map: 'center_peek', gallery: 'center_peek' };

export function useViewKit({ block, view, collection, readOnly }: ViewProps) {
  const db = useDatabaseContext();
  const result = useViewQuery(collection, view, { search: db?.search ?? '' });
  const peek: PeekMode = ((view.format as Record<string, unknown>)?.collection_peek_mode as PeekMode | undefined) ?? db?.peekMode ?? DEFAULT_PEEK[view.type] ?? 'side_peek';
  const openRow = (id: string, mode?: PeekMode) => {
    if (db && !mode) return db.openRow(id);
    const m = mode ?? peek;
    if (m === 'full_page') openPage(id);
    else openPeek(id, m);
  };
  const addRow = (props?: Record<string, RichText | undefined>, opts?: { open?: boolean; title?: RichText }) => {
    const id = createRow(collection.id, { view, properties: props, title: opts?.title, action: 'collectionView.addRow' });
    if (id && opts?.open) openRow(id);
    return id;
  };
  return { block, view, collection, readOnly, rows: result.rows, result, openRow, addRow, peek, db };
}

export function setFormat(view: CollectionViewRecord, patch: Record<string, unknown>, action?: string) {
  updateViewFormat(view.id, patch, action);
}

export function setQuery2(view: CollectionViewRecord, patch: Record<string, unknown>, action?: string) {
  updateQuery2(view.id, patch, action);
}

/** Visible card properties of a view (calendar_properties / timeline_properties / feed_properties), title excluded. */
export function visibleProperties(view: CollectionViewRecord, schema: Record<string, PropertySchema>): string[] {
  try {
    return viewProperties(view, schema).filter((e) => e.visible && e.property !== 'title' && schema[e.property]).map((e) => e.property);
  } catch {
    return [];
  }
}

export const DATE_PROPERTY_TYPES = new Set(['date', 'created_time', 'last_edited_time']);

/** Date-like properties usable for "Show calendar/timeline by" (date, created/edited time, date formulas). */
export function dateProperties(schema: Record<string, PropertySchema>): [string, PropertySchema][] {
  return Object.entries(schema).filter(([, p]) => DATE_PROPERTY_TYPES.has(p.type) || (p.type === 'formula' && (p as { formula2?: { result_type?: { type?: string } } }).formula2?.result_type?.type === 'date'));
}

/** The date-by property of a view: query2[key] when valid, else the first date property. */
export function dateByProperty(view: CollectionViewRecord, schema: Record<string, PropertySchema>, key: 'calendar_by' | 'timeline_by' | 'timeline_by_end'): string | undefined {
  const id = (view.query2 as Record<string, unknown> | undefined)?.[key] as string | undefined;
  if (id && schema[id]) return id;
  if (key === 'timeline_by_end') return undefined;
  return dateProperties(schema)[0]?.[0];
}

/** Day number (days since 1970-01-01) of a YYYY-MM-DD string. */
export function dayNum(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

export function isoOfDay(n: number): string {
  const d = new Date(n * 864e5);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function todayNum(): number {
  const tz = userTimeZone();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return dayNum(parts);
}

/** Weekday of a day number: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(n: number): number {
  return (((n + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export interface DayRange {
  start: number;
  end: number;
  /** start/end instants (ms) for timed items */
  startMs: number;
  endMs: number;
  timed: boolean;
  value: LitDate;
}

/** Calendar-day span of a row's date (start/end in the date's own zone or the user zone). */
export function rowDayRange(row: BlockRecord, propId: string, endPropId?: string): DayRange | null {
  const ctx = formulaContext();
  const v = propertyFValue(row, propId, ctx);
  if (v.type !== 'date') return null;
  const tz = ctx.timeZone;
  const iv = dateInterval(v.value, tz);
  if (!iv.start.isValid) return null;
  let endDt = iv.end ?? iv.start;
  if (endPropId) {
    const e = propertyFValue(row, endPropId, ctx);
    if (e.type === 'date') {
      const ei = dateInterval(e.value, tz);
      if (ei.start.isValid && ei.start.ts >= iv.start.ts) endDt = ei.end ?? ei.start;
    }
  }
  return { start: dayNum(iv.start.toISODate()), end: Math.max(dayNum(iv.start.toISODate()), dayNum(endDt.toISODate())), startMs: iv.start.ts, endMs: endDt.ts, timed: hasTime(v.value), value: v.value };
}

/** Encode a date property value. */
export function dateValue(d: LitDate): RichText {
  return [['‣', [['d', d] as unknown as ['d', never]]]] as unknown as RichText;
}

/** Move/resize a row's date by whole days, keeping times and the range shape (calendar/timeline drag). */
export function shiftRowDate(row: BlockRecord, propId: string, range: DayRange, newStart: number, newEnd: number, endPropId?: string) {
  const v = range.value;
  const startIso = isoOfDay(newStart);
  const endIso = isoOfDay(newEnd);
  run('collectionView.moveDate', (tx) => {
    if (endPropId) {
      const s: LitDate = v.type === 'datetime' || v.type === 'datetimerange' ? { type: 'datetime', start_date: startIso, start_time: v.start_time, time_zone: v.time_zone } : { type: 'date', start_date: startIso };
      setProperty(tx, row.id, propId, dateValue(s));
      const endV = row.properties?.[endPropId];
      const timed = !!endV && JSON.stringify(endV).includes('start_time');
      setProperty(tx, row.id, endPropId, dateValue(timed ? { ...(s as LitDate), type: 'datetime', start_date: endIso } : { type: 'date', start_date: endIso }));
      return;
    }
    let next: LitDate;
    if (newEnd > newStart || v.type === 'daterange' || v.type === 'datetimerange') {
      next = v.type === 'datetime' || v.type === 'datetimerange'
        ? { type: 'datetimerange', start_date: startIso, start_time: v.start_time, end_date: endIso, end_time: v.end_time ?? v.start_time, time_zone: v.time_zone }
        : { type: 'daterange', start_date: startIso, end_date: endIso };
      if (newEnd === newStart && v.type === 'daterange') next = { type: 'date', start_date: startIso };
    } else {
      next = v.type === 'datetime' ? { ...v, start_date: startIso } : { type: 'date', start_date: startIso };
    }
    setProperty(tx, row.id, propId, dateValue(next));
  });
}

export function useMemoRows<T>(fn: () => T, deps: unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(fn, deps);
}

export type { CollectionRecord };

// ---------- view settings rows (same markup as the core "Layout" page rows) ----------

export function overlayParentOf(el: Element | null): number | undefined {
  const o = el?.closest('[data-overlay-id]') as HTMLElement | null;
  return o ? Number(o.dataset.overlayId) : undefined;
}

export function SettingsRow({ icon, label, value, onClick, chevron = true, right, disabled }: {
  icon?: string | ReactNode; label: ReactNode; value?: ReactNode; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; chevron?: boolean; right?: ReactNode; disabled?: boolean;
}) {
  return (
    <div role="menuitem" aria-disabled={disabled || undefined} className={`nc-menu-item nc-vs-row ${disabled ? 'disabled' : ''}`} onClick={disabled ? undefined : onClick} onMouseDown={(e) => e.preventDefault()}>
      <div className="nc-menu-item-inner">
        {icon && <div className="nc-menu-icon">{typeof icon === 'string' ? <Icon name={icon} size={20} /> : icon}</div>}
        <div className="nc-menu-label">{label}</div>
        {value !== undefined && value !== null && <span className="nc-menu-value">{value}</span>}
        {right}
        {chevron && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />}
      </div>
    </div>
  );
}

export function SettingsToggle({ label, on, onChange, disabled }: { label: ReactNode; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return <SettingsRow label={label} chevron={false} disabled={disabled} right={<CoreToggle on={on} onChange={onChange} disabled={disabled} />} onClick={() => onChange(!on)} />;
}

/** Wrap menu items so choosing one closes only this menu (Menu closes every overlay unless onSelect returns false),
 *  keeping the settings panel / popover that opened it on screen. Applies to submenu items too. */
export function stayOpen(items: MenuItemDef[], close: () => void): MenuItemDef[] {
  return items.map((it) => ({
    ...it,
    onSelect: it.onSelect ? () => { it.onSelect!(); close(); return false; } : undefined,
    submenu: it.submenu ? () => { const def = it.submenu!(); return { ...def, sections: def.sections.map((sec) => ({ ...sec, items: stayOpen(sec.items, close) })) }; } : undefined,
  }));
}

/** Picker menu anchored at a settings row (bottom-end like the core's view settings pickers); the parent panel stays open. */
export function pickMenu(anchor: HTMLElement, items: MenuItemDef[], width = 250, search?: string) {
  let closeMenu: () => void = () => undefined;
  closeMenu = openMenu(anchor, { width, search, sections: [{ items: stayOpen(items, () => closeMenu()) }] }, { placement: 'bottom-end', offset: 2, parent: overlayParentOf(anchor), backdrop: 'transparent' });
  return closeMenu;
}

/** openMenu variant for menus opened from inside a panel: selecting an item keeps the panel open. */
export function openNestedMenu(anchor: HTMLElement, def: Parameters<typeof openMenu>[1], opts?: Parameters<typeof openMenu>[2]) {
  let closeMenu: () => void = () => undefined;
  closeMenu = openMenu(anchor, { ...def, sections: def.sections.map((sec) => ({ ...sec, items: stayOpen(sec.items, () => closeMenu()) })) }, { parent: overlayParentOf(anchor), backdrop: 'transparent', ...(opts ?? {}) });
  return closeMenu;
}

/** Menu items for picking a date-like property ("Show calendar by" / "Show timeline by"). */
export function datePropertyItems(schema: Record<string, PropertySchema>, current: string | undefined, onPick: (id: string) => void, opts?: { onlyEditable?: boolean }): MenuItemDef[] {
  const list = dateProperties(schema).filter(([, p]) => !opts?.onlyEditable || p.type === 'date');
  if (!list.length) return [{ label: 'No date properties', disabled: true }];
  return list.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === current, onSelect: () => onPick(id) }));
}

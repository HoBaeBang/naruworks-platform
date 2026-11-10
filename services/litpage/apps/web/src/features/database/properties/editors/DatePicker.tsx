import { HELP_URL } from '@nc/shared/brand.ts';
// Date picker popover (date property cells, filters): start/end inputs, month calendar with range
// highlighting, End date / Include time toggles, Date format & timezone, Remind, Clear.
// Value shape: ["‣",[["d",{type,start_date,start_time?,end_date?,end_time?,time_zone?,date_format?,time_format?,reminder?}]]].
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import type { DateValue } from '@nc/shared/richtext.ts';
import {
  DATE_FORMATS, REMINDER_OPTIONS_DATE, REMINDER_OPTIONS_DATETIME, TIME_FORMATS, addMonths, encodeDate, formatDay, formatTime, getPropertyValue,
  monthLabel, msToYmd, parseDateInput, parseTimeInput, rangeToDateValue, startOfMonth, startOfWeek, timeFormatId, ymdToMs, addDays,
} from '@nc/shared/database/index.ts';
import { records } from '../../../../lib/store/records.ts';
import { getBlock } from '../../../../lib/blocks.ts';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { openMenu, type MenuItemDef } from '../../../../components/Menu.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { setValue, setValues } from '../../actions.ts';
import { makeQueryContext } from '../../data.ts';
import type { CellEditorOptions } from '../editorRegistry.ts';
import { openNestedMenu } from '../../menus.ts';
import { effectiveTimeZone, weekdayHeaders, weekStartDay } from '../../../settings/userSettings.ts';
import { TemplateDateOptions, isTemplateVariableDate } from '../../templates/templateVars.tsx';

/** Decorative: the toggle mirrors the state of the menu row it sits in; “Show page icon” has no role of its own. */
export function Toggle({ on, onChange, disabled, decorative }: { on: boolean; onChange?: (v: boolean) => void; disabled?: boolean; decorative?: boolean }) {
  return (
    <span
      role={decorative ? undefined : 'switch'}
      aria-checked={decorative ? undefined : on}
      className={`nc-db-toggle ${on ? 'on' : ''} ${disabled ? 'disabled' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange?.(!on);
      }}
    >
      <span className="nc-db-toggle-knob" />
    </span>
  );
}

export function reminderLabel(r: DateValue['reminder'] | { unit: string; value?: number; time?: string } | undefined, hasTime: boolean): string {
  if (!r || r.unit === 'none') return 'None';
  const t = (r as any).time ? formatTime(ymdToMs('2000-01-01', (r as any).time)) : '';
  const v = (r as any).value ?? 0;
  if (r.unit === 'minute' && v === 0) return 'At time of event';
  if (r.unit === 'minute') return `${v} minute${v === 1 ? '' : 's'} before`;
  if (r.unit === 'hour') return `${v} hour${v === 1 ? '' : 's'} before`;
  if (r.unit === 'day' && v === 0) return `On day of event${t ? ` (${t})` : ''}`;
  const unit = r.unit === 'day' ? 'day' : r.unit === 'week' ? 'week' : r.unit === 'month' ? 'month' : 'year';
  void hasTime;
  return `${v} ${unit}${v === 1 ? '' : 's'} before${t ? ` (${t})` : ''}`;
}

interface PickerState {
  start: string | null;
  end: string | null;
  startTime: string;
  endTime: string;
  endOn: boolean;
  timeOn: boolean;
  dateFormat?: string;
  timeFormat?: string;
  timeZone?: string;
  reminder?: any;
}

function toState(v: DateValue | null | undefined): PickerState {
  return {
    start: v?.start_date ?? null,
    end: v?.end_date ?? null,
    startTime: v?.start_time ?? '09:00',
    endTime: v?.end_time ?? v?.start_time ?? '09:00',
    endOn: !!v?.end_date,
    timeOn: !!v?.start_time,
    dateFormat: v?.date_format,
    timeFormat: v?.time_format,
    timeZone: v?.time_zone,
    reminder: v?.reminder,
  };
}

function toValue(s: PickerState): DateValue | null {
  if (!s.start) return null;
  const extra: Partial<DateValue> = {};
  if (s.dateFormat) extra.date_format = s.dateFormat;
  if (s.timeFormat) extra.time_format = s.timeFormat;
  if (s.reminder && s.reminder.unit !== 'none') extra.reminder = s.reminder;
  return rangeToDateValue(
    { start: s.start, startTime: s.timeOn ? s.startTime : undefined, end: s.endOn ? s.end ?? s.start : undefined, endTime: s.endOn && s.timeOn ? s.endTime : undefined, timeZone: s.timeOn ? s.timeZone ?? effectiveTimeZone() : undefined },
    extra,
  );
}

export interface DatePickerProps {
  value: DateValue | null | undefined;
  onChange: (v: DateValue | null) => void;
  close?: () => void;
  /** property-level formats used for display */
  prop?: PropertySchema;
  /** filters: no end date / time / reminder controls */
  simple?: boolean;
}

export function DatePicker({ value, onChange, prop, simple }: DatePickerProps) {
  const [s, setS] = useState<PickerState>(() => toState(value));
  const [field, setField] = useState<'start' | 'end'>('start');
  const [month, setMonth] = useState(() => startOfMonth(s.start ? ymdToMs(s.start) : Date.now()));
  const first = useRef(true);
  const df = s.dateFormat ?? (prop?.date_format as string | undefined);
  const tf = s.timeFormat ?? (prop?.time_format as string | undefined);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    onChange(toValue(s));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);

  const update = (patch: Partial<PickerState>) => setS((cur) => ({ ...cur, ...patch }));

  const pick = (ymd: string, shift = false) => {
    // Shift+click a day: it becomes the end date (End date turns on) — 
    if (shift && s.start && !s.endOn) {
      if (ymd < s.start) update({ endOn: true, start: ymd, end: s.start });
      else update({ endOn: true, end: ymd });
      setField('start');
      return;
    }
    if (s.endOn) {
      if (field === 'start' || !s.start) {
        const end = s.end && s.end >= ymd ? s.end : ymd;
        update({ start: ymd, end });
        setField('end');
      } else {
        if (ymd < s.start) update({ start: ymd, end: s.start });
        else update({ end: ymd });
        setField('start');
      }
    } else update({ start: ymd, end: null });
  };

  const today = msToYmd(Date.now());
  const days = useMemo(() => {
    const first = startOfWeek(month, weekStartDay()); // Settings › Start week on Monday
    return Array.from({ length: 42 }, (_, i) => addDays(first, i));
  }, [month]);
  const inMonth = (ms: number) => new Date(ms).getMonth() === new Date(month).getMonth();
  const lo = s.start;
  const hi = s.endOn ? s.end ?? s.start : s.start;

  const dateInput = (which: 'start' | 'end') => {
    const ymd = which === 'start' ? s.start : s.end;
    const time = which === 'start' ? s.startTime : s.endTime;
    return (
      <DateTextInput
        key={`${which}:${ymd}:${s.timeOn}:${time}:${df}:${tf}`}
        active={field === which}
        onFocus={() => setField(which)}
        dateText={ymd ? formatDay(ymdToMs(ymd), df && df !== 'relative' ? df : 'MMM DD, YYYY') : ''}
        timeText={s.timeOn ? formatTime(ymdToMs('2000-01-01', time), tf && tf !== ' ' ? tf : 'h:mm A') : null}
        onDate={(txt) => {
          const d = parseDateInput(txt, Date.now(), df);
          if (!d) return;
          if (which === 'start') update({ start: d, end: s.end && s.end < d ? d : s.end });
          else update({ end: d < (s.start ?? d) ? s.start : d });
          setMonth(startOfMonth(ymdToMs(d)));
        }}
        onTime={(txt) => {
          const t = parseTimeInput(txt);
          if (t) update(which === 'start' ? { startTime: t } : { endTime: t });
        }}
      />
    );
  };

  const zone = s.timeZone ?? effectiveTimeZone();
  const dateFormatMenu = (anchor: HTMLElement) => openNestedMenu(anchor, {
    width: 250,
    sections: [{ items: DATE_FORMATS.map((f) => ({ id: f.id, label: f.label, checked: (df ?? 'll') === f.id, onSelect: () => update({ dateFormat: f.id }) })) }],
  }, { placement: 'right-start', backdrop: 'transparent' });
  const timeFormatMenu = (anchor: HTMLElement) => openNestedMenu(anchor, {
    width: 250,
    sections: [{ items: TIME_FORMATS.filter((f) => f.id !== 'hidden').map((f) => ({ id: f.id, label: f.label, checked: timeFormatId(tf) === f.id, onSelect: () => update({ timeFormat: f.stored }) })) }],
  }, { placement: 'right-start', backdrop: 'transparent' });
  const timezoneMenu = (anchor: HTMLElement) => {
    const zones = (Intl as any).supportedValuesOf ? ((Intl as any).supportedValuesOf('timeZone') as string[]) : ['UTC'];
    const city = (z: string) => z.split('/').pop()!.replace(/_/g, ' ');
    openNestedMenu(anchor, {
      width: 342,
      search: 'Search for a timezone…',
      maxHeight: 'min(70vh, 600px)',
      sections: [
        { title: 'Current timezone', items: [{ id: `cur:${zone}`, label: city(zone), text: `${city(zone)} ${zone}`, description: gmtOffset(zone, 'long'), checked: true, onSelect: () => update({ timeZone: zone }) }] },
        { title: 'Select a timezone', items: zones.filter((z) => z !== zone).map((z) => ({ id: z, label: city(z), text: `${city(z)} ${z}`, description: gmtOffset(z, 'long'), onSelect: () => update({ timeZone: z, timeOn: true }) })) },
      ],
    }, { placement: 'right-start', backdrop: 'transparent' });
  };

  const remindMenu = (anchor: HTMLElement) => {
    const opts = (s.timeOn ? REMINDER_OPTIONS_DATETIME : REMINDER_OPTIONS_DATE) as readonly any[];
    openNestedMenu(anchor, {
      width: 250,
      sections: [{ items: opts.map((o, i) => ({ id: String(i), label: reminderLabel(o, s.timeOn), checked: JSON.stringify(o) === JSON.stringify(s.reminder ?? { unit: 'none' }), onSelect: () => update({ reminder: o.unit === 'none' ? undefined : o }) })) }],
    }, { placement: 'right-start', backdrop: 'transparent' });
  };

  const fmtLabel = DATE_FORMATS.find((f) => f.id === (df ?? 'll'))?.label ?? 'Full date';
  const tfLabel = TIME_FORMATS.find((f) => f.id === timeFormatId(tf))?.label ?? '12 hour';
  return (
    <div className="nc-date-picker">
      <div className={`nc-date-inputs ${s.endOn && !simple ? 'range' : ''}`}>
        {dateInput('start')}
        {s.endOn && !simple && dateInput('end')}
      </div>
      <div className="nc-date-calendar">
        <div className="nc-date-month">
          <span className="nc-date-month-label">{monthLabel(month, true)}</span>
          <div className="nc-date-month-nav">
            <span role="button" className="nc-date-today" onClick={() => setMonth(startOfMonth(Date.now()))}>{s.timeOn && !simple ? 'Now' : 'Today'}</span>
            <span role="button" className="nc-date-nav" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevronLeft" size={16} /></span>
            <span role="button" className="nc-date-nav" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><Icon name="chevronRight" size={16} /></span>
          </div>
        </div>
        <div className="nc-date-weekdays">
          {weekdayHeaders().map((d) => <span key={d}>{d}</span>)}
        </div>
        <div className="nc-date-grid">
          {days.map((ms) => {
            const ymd = msToYmd(ms);
            const sel = !!lo && (ymd === lo || ymd === hi);
            const between = !!lo && !!hi && ymd > lo && ymd < hi;
            const cls = ['nc-date-day', inMonth(ms) ? '' : 'other', ymd === today ? 'today' : '', sel ? 'selected' : '', between ? 'between' : '', s.endOn && ymd === lo && hi !== lo ? 'range-start' : '', s.endOn && ymd === hi && hi !== lo ? 'range-end' : ''].filter(Boolean).join(' ');
            return (
              <span key={ymd} role="button" className={cls} onClick={(e) => pick(ymd, e.shiftKey)}>
                {new Date(ms).getDate()}
              </span>
            );
          })}
        </div>
      </div>
      {!simple && (
        <div className="nc-date-options">
          <Row label="End date" right={<Toggle on={s.endOn} onChange={(v) => { update({ endOn: v, end: v ? s.end ?? s.start : null }); setField(v ? 'end' : 'start'); }} />} onClick={() => { update({ endOn: !s.endOn, end: !s.endOn ? s.end ?? s.start : null }); }} />
          <Row label="Date format" right={<span className="nc-menu-value">{fmtLabel}</span>} chevron onClick={(e) => dateFormatMenu(e.currentTarget)} />
          <Row label="Include time" right={<Toggle on={s.timeOn} onChange={(v) => update({ timeOn: v })} />} onClick={() => update({ timeOn: !s.timeOn })} />
          {s.timeOn && <Row label="Time format" right={<span className="nc-menu-value">{tfLabel}</span>} chevron onClick={(e) => timeFormatMenu(e.currentTarget)} />}
          {s.timeOn && <Row label="Timezone" right={<span className="nc-menu-value">{gmtOffset(zone, 'short')}</span>} chevron onClick={(e) => timezoneMenu(e.currentTarget)} />}
          <Row label="Remind" right={<span className="nc-menu-value">{reminderLabel(s.reminder, s.timeOn)}</span>} chevron onClick={(e) => remindMenu(e.currentTarget)} />
        </div>
      )}
      <div className="nc-date-footer">
        <div role="button" className="nc-menu-item nc-date-row" onMouseDown={(e) => e.preventDefault()} onClick={() => setS({ ...toState(null), endOn: false })}>
          <div className="nc-menu-item-inner"><div className="nc-menu-label">Clear</div></div>
        </div>
      </div>
      {!simple && (
        <div className="nc-date-footer">
          {HELP_URL && <a className="nc-menu-item nc-date-row nc-date-learn" href={HELP_URL} target="_blank" rel="noopener noreferrer" onMouseDown={(e) => e.preventDefault()}>
            <div className="nc-menu-item-inner">
              <div className="nc-menu-icon"><Icon name="questionMarkCircle" size={20} style={{ color: 'var(--lp-icon-secondary)' }} /></div>
              <div className="nc-menu-label">Explore reminders</div>
            </div>
          </a>}
        </div>
      )}
    </div>
  );
}

/** "GMT+9" (short) / "GMT+9:00" (long) for an IANA zone. */
function gmtOffset(zone: string, style: 'short' | 'long'): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: style === 'short' ? 'shortOffset' : 'longOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value;
    return part ?? 'GMT';
  } catch {
    return 'GMT';
  }
}

function Row({ label, right, chevron, onClick }: { label: string; right?: ReactNode; chevron?: boolean; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void }) {
  return (
    <div role="button" className="nc-menu-item nc-date-row" onClick={onClick} onMouseDown={(e) => e.preventDefault()}>
      <div className="nc-menu-item-inner">
        <div className="nc-menu-label">{label}</div>
        {right}
        {chevron && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />}
      </div>
    </div>
  );
}

function DateTextInput({ dateText, timeText, onDate, onTime, active, onFocus }: { dateText: string; timeText: string | null; onDate: (t: string) => void; onTime: (t: string) => void; active: boolean; onFocus: () => void }) {
  const [d, setD] = useState(dateText);
  const [t, setT] = useState(timeText ?? '');
  return (
    <div className={`nc-date-input ${active ? 'active' : ''}`} onMouseDown={onFocus}>
      <input
        value={d}
        placeholder="Date"
        onFocus={onFocus}
        onChange={(e) => setD(e.target.value)}
        onBlur={() => d !== dateText && onDate(d)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onDate(d);
          }
        }}
      />
      {timeText !== null && (
        <input
          className="nc-date-time"
          value={t}
          onFocus={onFocus}
          onChange={(e) => setT(e.target.value)}
          onBlur={() => t !== timeText && onTime(t)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              onTime(t);
            }
          }}
        />
      )}
    </div>
  );
}

export function openDatePickerPopover(anchor: HTMLElement | DOMRect, props: Omit<DatePickerProps, 'close'>, opts?: { onClose?: () => void; placement?: 'bottom-start' | 'right-start'; offset?: number; parent?: number }) {
  return openOverlay((close) => (
    <PopoverSurface width={248} className="nc-date-popover" maxHeight="calc(100vh - 24px)">
      <DatePicker {...props} close={close} />
    </PopoverSurface>
  ), { anchor, placement: opts?.placement ?? 'bottom-start', offset: opts?.offset ?? 4, onClose: opts?.onClose, parent: opts?.parent });
}

export function openDateEditor(anchor: HTMLElement, opts: CellEditorOptions): () => void {
  const c = records.get<CollectionRecord>('collection', opts.collectionId);
  const prop = c?.schema[opts.propId];
  const row = getBlock(opts.rowIds[0]);
  if (!c || !prop || !row) return () => {};
  const v = getPropertyValue(row, opts.propId, c.schema, makeQueryContext());
  const raw = v.kind === 'date' ? v.date?.raw ?? null : null;
  const rect = anchor.getBoundingClientRect();
  const write = (next: DateValue | null) => {
    const enc = encodeDate(next);
    if (opts.rowIds.length > 1) setValues(opts.rowIds, opts.propId, enc);
    else setValue(opts.rowIds[0], opts.propId, enc, { coalesce: `date:${opts.rowIds[0]}:${opts.propId}` });
  };
  // database templates: "Today / Now — when duplicated" template variables above the picker 
  if (row.is_template) {
    return openOverlay((close) => (
      <PopoverSurface width={248} className="nc-date-popover" maxHeight="calc(100vh - 24px)">
        <TemplateDateOptions value={raw} onPick={(d) => { write(d); close(); }} />
        <DatePicker value={isTemplateVariableDate(raw) ? null : raw} prop={prop} onChange={write} close={close} />
      </PopoverSurface>
    ), { anchor: new DOMRect(rect.left, rect.bottom, rect.width, 0), placement: 'bottom-start', offset: 0, onClose: opts.onClose });
  }
  // opens the date picker under the cell (not over it the text/select editors)
  return openDatePickerPopover(new DOMRect(rect.left, rect.bottom, rect.width, 0), {
    value: raw,
    prop,
    onChange: write,
  }, { onClose: opts.onClose, offset: 0 });
}

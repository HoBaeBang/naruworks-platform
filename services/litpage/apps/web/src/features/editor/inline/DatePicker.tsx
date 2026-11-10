import { HELP_URL } from '@nc/shared/brand.ts';
// Date picker popover for date mentions:
// date input · "Oct 2026 Today ‹ ›" · Su..Sa grid (32px cells, 28px r6 day buttons, selected = blue, today = red dot)
// · End date (switch) · Date format ▸ · Include time (switch) · Remind ▸ · Clear · Reminder help.
// The calendar body (DateCalendar) is generic so database date properties can reuse it.
import { useEffect, useRef, useState } from 'react';
import { annotationsOf, deleteRange, MENTION_CHAR, type Annotation, type DateValue, type RichText } from '@nc/shared/richtext.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { run, setTitle, setProperty } from '../../../lib/blocks.ts';
import { useEditor } from '../editorState.ts';
import { valueOf } from './format.ts';
import { weekdayHeaders, weekStartDay } from '../../settings/userSettings.ts';
import {
  addDays, DATE_FORMATS, dateFormatLabel, formatMedium, formatTime, isoDate, parseIso, parseNaturalDate, reminderLabel, reminderOptions, startOfDay,
} from './dates.ts';

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`nc-dp-switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <div className="nc-dp-switch-knob" />
    </div>
  );
}

export interface DateCalendarProps {
  value: DateValue;
  onChange: (v: DateValue) => void;
  onClear?: () => void;
  showReminder?: boolean;
}

function parseTimeInput(s: string): string | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*$/i.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (ap?.startsWith('p') && h < 12) h += 12;
  if (ap?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function DateCalendar({ value, onChange, onClear, showReminder = true }: DateCalendarProps) {
  const start = parseIso(value.start_date);
  const [month, setMonth] = useState(() => new Date(start.getFullYear(), start.getMonth(), 1));
  const hasEnd = value.type === 'daterange' || value.type === 'datetimerange';
  const hasTime = value.type === 'datetime' || value.type === 'datetimerange';
  const [startText, setStartText] = useState(formatMedium(start));
  const [endText, setEndText] = useState(value.end_date ? formatMedium(parseIso(value.end_date)) : '');
  const [editing, setEditing] = useState<'start' | 'end'>('start');
  const startRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // The picker opens with the date text selected in the input
    startRef.current?.focus({ preventScroll: true });
    startRef.current?.select();
  }, []);
  useEffect(() => setStartText(formatMedium(parseIso(value.start_date))), [value.start_date]);
  useEffect(() => setEndText(value.end_date ? formatMedium(parseIso(value.end_date)) : ''), [value.end_date]);

  const typeOf = (end: boolean, time: boolean): DateValue['type'] => (end ? (time ? 'datetimerange' : 'daterange') : time ? 'datetime' : 'date');
  const pickDay = (d: Date, shift: boolean) => {
    const iso = isoDate(d);
    if (hasEnd && (editing === 'end' || shift)) {
      if (iso < value.start_date) onChange({ ...value, start_date: iso, end_date: value.start_date });
      else onChange({ ...value, end_date: iso });
      setEditing('start');
      return;
    }
    if (shift && !hasEnd) {
      // Shift+click adds an end date 
      onChange({ ...value, type: typeOf(true, hasTime), ...(iso < value.start_date ? { start_date: iso, end_date: value.start_date } : { end_date: iso }) });
      return;
    }
    onChange({ ...value, start_date: iso, ...(hasEnd && value.end_date && value.end_date < iso ? { end_date: iso } : {}) });
    if (hasEnd) setEditing('end');
  };
  const commitText = (which: 'start' | 'end', text: string) => {
    const p = parseNaturalDate(text);
    if (!p) return;
    if (which === 'start') onChange({ ...value, start_date: p.value.start_date });
    else onChange({ ...value, end_date: p.value.start_date });
    setMonth(new Date(parseIso(p.value.start_date).getFullYear(), parseIso(p.value.start_date).getMonth(), 1));
  };
  const today = startOfDay(new Date());
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(first, -((first.getDay() - weekStartDay() + 7) % 7)); // Settings › Start week on Monday
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const sel = (d: Date) => isoDate(d) === value.start_date || (hasEnd && isoDate(d) === value.end_date);
  const inRange = (d: Date) => hasEnd && !!value.end_date && isoDate(d) > value.start_date && isoDate(d) < value.end_date;

  return (
    <div className="nc-dp">
      <div className="nc-dp-inputs">
        <div className={`nc-dp-input ${editing === 'start' ? 'focused' : ''}`}>
          <input
            ref={startRef}
            value={startText}
            size={1}
            onFocus={() => setEditing('start')}
            onChange={(e) => setStartText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText('start', startText); } }}
            onBlur={() => commitText('start', startText)}
          />
          {hasTime && (
            <TimeInput value={value.start_time ?? '09:00'} onChange={(t) => onChange({ ...value, start_time: t })} />
          )}
        </div>
        {hasEnd && (
          <div className={`nc-dp-input ${editing === 'end' ? 'focused' : ''}`}>
            <input
              value={endText}
              size={1}
              placeholder="End date"
              onFocus={() => setEditing('end')}
              onChange={(e) => setEndText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitText('end', endText); } }}
              onBlur={() => endText && commitText('end', endText)}
            />
            {hasTime && <TimeInput value={value.end_time ?? '09:00'} onChange={(t) => onChange({ ...value, end_time: t })} />}
          </div>
        )}
      </div>
      <div className="nc-dp-cal">
        <div className="nc-dp-caption">
          <div className="nc-dp-label">{month.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}</div>
          <div className="nc-dp-nav">
            <div role="button" className="nc-dp-today" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</div>
            <div role="button" aria-label="Previous month" className="nc-dp-arrow" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><Icon name="chevronLeft" size={16} /></div>
            <div role="button" aria-label="Next month" className="nc-dp-arrow" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><Icon name="chevronRight" size={16} /></div>
          </div>
        </div>
        <table className="nc-dp-table" role="grid">
          <thead>
            <tr>{weekdayHeaders().map((d) => <th key={d} scope="col">{d}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: 6 }, (_, w) => (
              <tr key={w}>
                {days.slice(w * 7, w * 7 + 7).map((d) => {
                  const outside = d.getMonth() !== month.getMonth();
                  const isToday = d.getTime() === today.getTime();
                  return (
                    <td key={d.toISOString()} className={`nc-dp-cell ${inRange(d) ? 'in-range' : ''}`}>
                      <button
                        type="button"
                        name="day"
                        className={`nc-dp-day ${outside ? 'outside' : ''} ${sel(d) ? 'selected' : ''} ${isToday ? 'today' : ''}`}
                        aria-label={d.toDateString()}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => pickDay(d, e.shiftKey)}
                      >
                        {d.getDate()}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="nc-dp-options">
        <div className="nc-dp-row" role="button" onClick={() => onChange(hasEnd ? { ...value, type: typeOf(false, hasTime), end_date: undefined, end_time: undefined } : { ...value, type: typeOf(true, hasTime), end_date: value.start_date })}>
          <span>End date</span>
          <Switch on={hasEnd} onChange={(v) => onChange(v ? { ...value, type: typeOf(true, hasTime), end_date: value.start_date } : { ...value, type: typeOf(false, hasTime), end_date: undefined, end_time: undefined })} />
        </div>
        <div
          className="nc-dp-row"
          role="button"
          aria-haspopup="dialog"
          onClick={(e) => {
            let closeSub = () => {};
            closeSub = openMenu(e.currentTarget, {
              width: 220,
              sections: [{ items: DATE_FORMATS.map((f) => ({ label: f.label, checked: (value.date_format ?? 'relative') === f.value, onSelect: () => { onChange({ ...value, date_format: f.value }); closeSub(); return false; } })) }],
            }, { placement: 'right-start', offset: 4 });
          }}
        >
          <span>Date format</span>
          <span className="nc-dp-row-value">{dateFormatLabel(value.date_format)}<Icon name="arrowChevronSingleRightSmall" size={16} /></span>
        </div>
        <div className="nc-dp-row" role="button" onClick={() => onChange(hasTime ? { ...value, type: typeOf(hasEnd, false), start_time: undefined, end_time: undefined } : { ...value, type: typeOf(hasEnd, true), start_time: '09:00', ...(hasEnd ? { end_time: '09:00' } : {}) })}>
          <span>Include time</span>
          <Switch on={hasTime} onChange={(v) => onChange(v ? { ...value, type: typeOf(hasEnd, true), start_time: '09:00' } : { ...value, type: typeOf(hasEnd, false), start_time: undefined, end_time: undefined })} />
        </div>
        {showReminder && (
          <div
            className="nc-dp-row"
            role="button"
            aria-haspopup="dialog"
            onClick={(e) => {
              let closeSub = () => {};
              closeSub = openMenu(e.currentTarget, {
                width: 240,
                sections: [{ items: reminderOptions(hasTime).map((o) => ({ label: o.label, checked: o.value ? reminderLabel(value) === o.label : !value.reminder, onSelect: () => { onChange({ ...value, reminder: o.value ?? undefined }); closeSub(); return false; } })) }],
              }, { placement: 'right-start', offset: 4 });
            }}
          >
            <span>Remind</span>
            <span className="nc-dp-row-value">{reminderLabel(value)}<Icon name="arrowChevronSingleRightSmall" size={16} /></span>
          </div>
        )}
      </div>
      {onClear && (
        <div className="nc-dp-options">
          <div className="nc-dp-row" role="button" onClick={onClear}><span>Clear</span></div>
        </div>
      )}
      {showReminder && (
        <div className="nc-dp-options">
          {HELP_URL && <a className="nc-dp-row nc-dp-help" href={HELP_URL} target="_blank" rel="noopener noreferrer">
            <Icon name="questionMarkCircle" size={16} />
            <span>Reminder help</span>
          </a>}
        </div>
      )}
    </div>
  );
}

function TimeInput({ value, onChange }: { value: string; onChange: (t: string) => void }) {
  const [text, setText] = useState(formatTime(value));
  useEffect(() => setText(formatTime(value)), [value]);
  const commit = () => {
    const t = parseTimeInput(text);
    if (t) onChange(t);
    else setText(formatTime(value));
  };
  return (
    <input
      className="nc-dp-time"
      value={text}
      size={1}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
      onBlur={commit}
    />
  );
}

// ---- date mention editing ------------------------------------------------------------------------

function dateAt(value: RichText, offset: number): { index: number; date: DateValue; anns: Annotation[] } | null {
  let pos = 0;
  for (let i = 0; i < value.length; i++) {
    const d = value[i];
    if (pos === offset && d[0] === MENTION_CHAR) {
      const anns = annotationsOf(d);
      const a = anns.find((x) => x[0] === 'd');
      if (a) return { index: i, date: a[1] as DateValue, anns };
    }
    pos += d[0].length;
  }
  return null;
}

function write(blockId: string, property: string, next: RichText, action: string) {
  run(action, (tx) => (property === 'title' ? setTitle(tx, blockId, next) : setProperty(tx, blockId, property, next)), { coalesceKey: `date:${blockId}` });
}

export function openDateMentionEditor(blockId: string, property: string, offset: number, anchor: HTMLElement | DOMRect) {
  const v = valueOf(blockId, property);
  if (!dateAt(v, offset)) return;
  openOverlay((close) => <DateMentionEditor blockId={blockId} property={property} offset={offset} close={close} />, {
    anchor,
    placement: 'bottom-start',
    offset: 4,
    onClose: () => useEditor.getState().requestFocus(blockId, offset + 1, { property }),
  });
}

function DateMentionEditor({ blockId, property, offset, close }: { blockId: string; property: string; offset: number; close: () => void }) {
  const [date, setDate] = useState(() => dateAt(valueOf(blockId, property), offset)?.date);
  if (!date) return null;
  const update = (next: DateValue) => {
    const clean: DateValue = Object.fromEntries(Object.entries(next).filter(([, x]) => x !== undefined)) as DateValue;
    setDate(clean);
    const v = valueOf(blockId, property);
    const at = dateAt(v, offset);
    if (!at) return;
    const arr = v.slice();
    arr[at.index] = [MENTION_CHAR, at.anns.map((a) => (a[0] === 'd' ? (['d', clean] as Annotation) : a))];
    write(blockId, property, arr, 'LuxonDatePropertyMenu.handleChange');
  };
  return (
    <div role="dialog" className="nc-popover" style={{ width: 248 }}>
      <DateCalendar
        value={date}
        onChange={update}
        onClear={() => {
          close();
          write(blockId, property, deleteRange(valueOf(blockId, property), offset, offset + 1), 'LuxonDatePropertyMenu.handleClear');
        }}
      />
    </div>
  );
}

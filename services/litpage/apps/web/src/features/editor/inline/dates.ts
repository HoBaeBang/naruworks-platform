// Date mention helpers: display formatting, including relative values, and reminder labels
// and a small natural-language parser for the "@" menu ("tomorrow", "next friday 3pm", "10/25", "remind me …").
import type { DateValue } from '@nc/shared/richtext.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function parseIso(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function dayDiff(d: Date, from = new Date()): number {
  return Math.round((startOfDay(d).getTime() - startOfDay(from).getTime()) / 86400000);
}

/** “Oct 20, 2026” date input and default mention display. */
export function formatMedium(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatTime(t: string | undefined, fmt?: string): string {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  if (fmt === 'H:mm') return `${h}:${String(m).padStart(2, '0')}`;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}:${String(m).padStart(2, '0')} ${ampm}`;
}

/** Display label of a date for a given date format. */
export function formatDateOnly(dateStr: string, format: string | undefined): string {
  const d = parseIso(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  switch (format) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${d.getFullYear()}`;
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${d.getFullYear()}`;
    case 'YYYY/MM/DD':
      return `${d.getFullYear()}/${mm}/${dd}`;
    case 'll':
    case 'MMM D, YYYY':
    case 'MMM DD, YYYY':
      return formatMedium(d);
    case 'MMM d':
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    case 'full':
    case 'MMMM D, YYYY':
      return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
    case 'relative':
    case undefined:
    default: {
      const diff = dayDiff(d);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      if (diff < 0 && diff > -7) return `Last ${WEEKDAYS[d.getDay()]}`;
      if (diff > 1 && diff < 7) return `Next ${WEEKDAYS[d.getDay()]}`;
      return formatMedium(d);
    }
  }
}

/** Text shown inside a date mention token ("Today", "Tomorrow 9:00 AM", "Oct 20, 2026 → Oct 22, 2026"). */
export function formatDateValue(v: DateValue): string {
  const fmt = v.date_format ?? 'relative';
  let s = formatDateOnly(v.start_date, fmt);
  if (v.start_time && (v.type === 'datetime' || v.type === 'datetimerange')) s += ` ${formatTime(v.start_time, v.time_format)}`;
  if (v.end_date && (v.type === 'daterange' || v.type === 'datetimerange')) {
    let e = formatDateOnly(v.end_date, fmt);
    if (v.end_time && v.type === 'datetimerange') e += ` ${formatTime(v.end_time, v.time_format)}`;
    s += ` → ${e}`;
  }
  return s;
}

/** When the reminder fires (ms), or null. */
export function reminderTime(v: DateValue): number | null {
  const r = v.reminder;
  if (!r || (r as any).unit === 'none') return null;
  const base = parseIso(v.start_date);
  if (v.start_time) {
    const [h, m] = v.start_time.split(':').map(Number);
    base.setHours(h, m, 0, 0);
  }
  const t = new Date(base);
  if (r.unit === 'minute') t.setMinutes(t.getMinutes() - r.value);
  else if (r.unit === 'hour') t.setHours(t.getHours() - r.value);
  else {
    if (r.unit === 'day') t.setDate(t.getDate() - r.value);
    else if (r.unit === 'week') t.setDate(t.getDate() - 7 * r.value);
    if (r.time) {
      const [h, m] = r.time.split(':').map(Number);
      t.setHours(h, m, 0, 0);
    }
  }
  return t.getTime();
}

/** Reminder menu options for a date with or without time. */
export function reminderOptions(withTime: boolean): { label: string; value: DateValue['reminder'] | null }[] {
  if (!withTime) {
    return [
      { label: 'None', value: null },
      { label: 'On day of event (9:00 AM)', value: { unit: 'day', value: 0, time: '09:00' } },
      { label: '1 day before (9:00 AM)', value: { unit: 'day', value: 1, time: '09:00' } },
      { label: '2 days before (9:00 AM)', value: { unit: 'day', value: 2, time: '09:00' } },
      { label: '1 week before (9:00 AM)', value: { unit: 'week', value: 1, time: '09:00' } },
    ];
  }
  return [
    { label: 'None', value: null },
    { label: 'When the event starts', value: { unit: 'minute', value: 0 } },
    { label: '5 minutes before', value: { unit: 'minute', value: 5 } },
    { label: '10 minutes before', value: { unit: 'minute', value: 10 } },
    { label: '15 minutes before', value: { unit: 'minute', value: 15 } },
    { label: '30 minutes before', value: { unit: 'minute', value: 30 } },
    { label: '1 hour before', value: { unit: 'hour', value: 1 } },
    { label: '2 hours before', value: { unit: 'hour', value: 2 } },
    { label: '1 day before (9:00 AM)', value: { unit: 'day', value: 1, time: '09:00' } },
    { label: '2 days before (9:00 AM)', value: { unit: 'day', value: 2, time: '09:00' } },
  ];
}

export function reminderLabel(v: DateValue): string {
  const r = v.reminder;
  if (!r) return 'None';
  const opts = reminderOptions(!!v.start_time);
  const hit = opts.find((o) => o.value && o.value.unit === r.unit && o.value.value === r.value);
  return hit?.label ?? 'Custom';
}

export const DATE_FORMATS: { label: string; value: string }[] = [
  { label: 'Full date', value: 'full' },
  { label: 'Short date', value: 'MMM d' },
  { label: 'Month, day, year', value: 'MM/DD/YYYY' },
  { label: 'Day, month, year', value: 'DD/MM/YYYY' },
  { label: 'Year, month, day', value: 'YYYY/MM/DD' },
  { label: 'Relative', value: 'relative' },
];

export function dateFormatLabel(f: string | undefined): string {
  return DATE_FORMATS.find((x) => x.value === (f ?? 'relative'))?.label ?? 'Relative';
}

/** Relative captions such as "3 days from now" and "Yesterday". */
export function timeCaption(d: Date): string {
  const diff = dayDiff(d);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const abs = Math.abs(diff);
  const unit = abs >= 365 ? ['year', Math.round(abs / 365)] : abs >= 30 ? ['month', Math.round(abs / 30)] : abs >= 14 ? ['week', Math.round(abs / 7)] : ['day', abs];
  const n = unit[1] as number;
  const word = `${n} ${unit[0]}${n === 1 ? '' : 's'}`;
  return diff > 0 ? `${word} from now` : `${word} ago`;
}

export interface ParsedDate {
  value: DateValue;
  label: string;
  remind: boolean;
}

const WD = WEEKDAYS.map((w) => w.toLowerCase());

function parseTime(s: string): { h: number; m: number } | null {
  const m = /^(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/i.exec(s.trim());
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3]?.toLowerCase();
  if (!ap && !m[2]) return null; // bare numbers are not times
  if (ap?.startsWith('p') && h < 12) h += 12;
  if (ap?.startsWith('a') && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, m: min };
}

function parseDatePart(s: string, now: Date): Date | null {
  const t = s.trim().toLowerCase();
  if (!t || t === 'today' || t === 'now') return startOfDay(now);
  if (t === 'tomorrow' || t === 'tmr' || t === 'tom') return addDays(now, 1);
  if (t === 'yesterday') return addDays(now, -1);
  let m = /^(next|last|this)?\s*(sun|mon|tue|wed|thu|fri|sat)[a-z]*$/.exec(t);
  if (m) {
    const target = WD.findIndex((w) => w.startsWith(m![2]));
    const cur = now.getDay();
    const upcoming = (target - cur + 7) % 7 || 7;
    if (m[1] === 'last') return addDays(now, -((cur - target + 7) % 7 || 7));
    if (m[1] === 'this') return addDays(now, (target - cur + 7) % 7);
    // "next friday" = the friday of next week when this week's friday is still ahead
    if (m[1] === 'next') return addDays(now, upcoming <= 6 - cur ? upcoming + 7 : upcoming);
    return addDays(now, upcoming);
  }
  m = /^in\s+(\d+)\s*(day|week|month|year)s?$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    const d = startOfDay(now);
    if (m[2] === 'day') return addDays(d, n);
    if (m[2] === 'week') return addDays(d, 7 * n);
    if (m[2] === 'month') return new Date(d.getFullYear(), d.getMonth() + n, d.getDate());
    return new Date(d.getFullYear() + n, d.getMonth(), d.getDate());
  }
  m = /^(\d+)\s*(day|week|month)s?\s+ago$/.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (m[2] === 'day') return addDays(now, -n);
    if (m[2] === 'week') return addDays(now, -7 * n);
    return new Date(now.getFullYear(), now.getMonth() - n, now.getDate());
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(t);
  if (m) {
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : now.getFullYear();
    return new Date(y, Number(m[1]) - 1, Number(m[2]));
  }
  m = /^([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?$/.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![1].slice(0, 3)));
    if (mi >= 0) return new Date(m[3] ? Number(m[3]) : now.getFullYear(), mi, Number(m[2]));
  }
  m = /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?(?:,?\s+(\d{4}))?$/.exec(t);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![2].slice(0, 3)));
    if (mi >= 0) return new Date(m[3] ? Number(m[3]) : now.getFullYear(), mi, Number(m[1]));
  }
  return null;
}

/** Parse what "@" in the mention menu. Returns null when the query is not a date. */
export function parseNaturalDate(query: string, now = new Date()): ParsedDate | null {
  let q = query.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!q) return null;
  let remind = false;
  const r = /^remind(?:\s+me)?(?:\s+(.*))?$/.exec(q);
  if (r) {
    remind = true;
    q = (r[1] ?? '').trim();
    if (!q) return null;
  }
  // split a trailing time ("tomorrow 3pm", "friday at 10:30")
  let time: { h: number; m: number } | null = null;
  const tm = /^(.*?)(?:\s+(?:at\s+)?)?(\d{1,2}(?::\d{2})?\s*(?:am|pm|a|p)?)$/.exec(q);
  if (tm && tm[1] !== undefined) {
    const t = parseTime(tm[2]);
    if (t && (tm[1].trim() || /[ap:]/.test(tm[2]))) {
      time = t;
      q = tm[1].trim();
    }
  }
  const d = parseDatePart(q, now);
  if (!d || Number.isNaN(d.getTime())) return null;
  const value: DateValue = { type: time ? 'datetime' : 'date', start_date: isoDate(d), date_format: 'relative' };
  if (time) value.start_time = `${String(time.h).padStart(2, '0')}:${String(time.m).padStart(2, '0')}`;
  if (remind) value.reminder = time ? { unit: 'minute', value: 0 } : { unit: 'day', value: 0, time: '09:00' };
  return { value, label: formatDateValue(value), remind };
}

export { WEEKDAYS, MONTHS };

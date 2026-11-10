// Date helpers for database values: local-day arithmetic, date formats (date_format / time_format),
// relative filter values and relative date-group buckets. All "days" are local calendar days.
import type { DateValue } from '../richtext.ts';
import type { DateRange } from './types.ts';

export const DAY_MS = 86_400_000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = MONTHS.map((m) => m.slice(0, 3));
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 'YYYY-MM-DD' → local midnight ms (invalid → NaN). */
export function ymdToMs(ymd: string, time?: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd ?? '');
  if (!m) return NaN;
  let hh = 0;
  let mm = 0;
  const t = /^(\d{1,2}):(\d{2})/.exec(time ?? '');
  if (t) {
    hh = Number(t[1]);
    mm = Number(t[2]);
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm).getTime();
}

export function msToYmd(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function msToHm(ms: number): string {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
}

export function addMonths(ms: number, n: number): number {
  const d = new Date(ms);
  const target = new Date(d.getFullYear(), d.getMonth() + n, 1, d.getHours(), d.getMinutes());
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return target.getTime();
}

export function addYears(ms: number, n: number): number {
  return addMonths(ms, n * 12);
}

export function addUnits(ms: number, unit: 'day' | 'week' | 'month' | 'year', n: number): number {
  if (unit === 'day') return addDays(ms, n);
  if (unit === 'week') return addDays(ms, 7 * n);
  if (unit === 'month') return addMonths(ms, n);
  return addYears(ms, n);
}

export function startOfWeek(ms: number, weekStart: 0 | 1 = 0): number {
  const d = new Date(startOfDay(ms));
  const diff = (d.getDay() - weekStart + 7) % 7;
  return addDays(d.getTime(), -diff);
}

export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function startOfYear(ms: number): number {
  return new Date(new Date(ms).getFullYear(), 0, 1).getTime();
}

/** [start, endExclusive) of the unit containing ms. */
export function unitRange(ms: number, unit: 'day' | 'week' | 'month' | 'year', weekStart: 0 | 1 = 0): [number, number] {
  switch (unit) {
    case 'day': {
      const s = startOfDay(ms);
      return [s, addDays(s, 1)];
    }
    case 'week': {
      const s = startOfWeek(ms, weekStart);
      return [s, addDays(s, 7)];
    }
    case 'month': {
      const s = startOfMonth(ms);
      return [s, addMonths(s, 1)];
    }
    default: {
      const s = startOfYear(ms);
      return [s, addYears(s, 1)];
    }
  }
}

export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS);
}

/** DateValue (stored in a ["d", …] annotation) → normalized range. */
export function dateValueToRange(v: DateValue | undefined | null): DateRange | null {
  if (!v || !v.start_date) return null;
  const hasTime = v.type === 'datetime' || v.type === 'datetimerange' || !!v.start_time;
  const isRange = v.type === 'daterange' || v.type === 'datetimerange' || !!v.end_date;
  const startMs = ymdToMs(v.start_date, hasTime ? v.start_time : undefined);
  if (Number.isNaN(startMs)) return null;
  const end = isRange ? v.end_date ?? v.start_date : undefined;
  const endMs = end ? ymdToMs(end, hasTime ? v.end_time ?? v.start_time : undefined) : undefined;
  return {
    start: v.start_date, startTime: hasTime ? v.start_time : undefined, end, endTime: isRange && hasTime ? v.end_time : undefined,
    timeZone: v.time_zone, startMs, endMs, hasTime, isRange, raw: v,
  };
}

/** Timestamp (created/edited time) → range with time. */
export function msToRange(ms: number): DateRange {
  return { start: msToYmd(ms), startTime: msToHm(ms), startMs: ms, hasTime: true, isRange: false };
}

export function rangeToDateValue(r: { start: string; startTime?: string; end?: string; endTime?: string; timeZone?: string }, extra?: Partial<DateValue>): DateValue {
  const hasTime = !!r.startTime;
  const isRange = !!r.end;
  const v: DateValue = {
    type: isRange ? (hasTime ? 'datetimerange' : 'daterange') : hasTime ? 'datetime' : 'date',
    start_date: r.start,
    ...(hasTime ? { start_time: r.startTime } : {}),
    ...(isRange ? { end_date: r.end } : {}),
    ...(isRange && hasTime ? { end_time: r.endTime ?? r.startTime } : {}),
    ...(hasTime && r.timeZone ? { time_zone: r.timeZone } : {}),
    ...(extra ?? {}),
  };
  return v;
}

// ---------- formatting ---------

export function formatTime(ms: number, timeFormat?: string): string {
  if (timeFormat === ' ') return '';
  const d = new Date(ms);
  const h = d.getHours();
  const m = d.getMinutes();
  if (timeFormat === 'H:mm') return `${h}:${pad2(m)}`;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  if (timeFormat === 'A h:mm') return `${ampm} ${h12}:${pad2(m)}`;
  return `${h12}:${pad2(m)} ${ampm}`;
}

export function formatDay(ms: number, dateFormat?: string, now: number = Date.now()): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const mo = d.getMonth();
  const day = d.getDate();
  switch (dateFormat) {
    case 'MMM d':
      return `${MONTHS_SHORT[mo]} ${day}`;
    case 'MM/DD/YYYY':
      return `${pad2(mo + 1)}/${pad2(day)}/${y}`;
    case 'DD/MM/YYYY':
      return `${pad2(day)}/${pad2(mo + 1)}/${y}`;
    case 'YYYY/MM/DD':
      return `${y}/${pad2(mo + 1)}/${pad2(day)}`;
    case 'MMM DD, YYYY':
      return `${MONTHS_SHORT[mo]} ${pad2(day)}, ${y}`;
    case 'relative': {
      const diff = dayDiff(ms, now);
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff === -1) return 'Yesterday';
      if (diff < 0 && diff >= -6) return `Last ${WEEKDAYS[d.getDay()]}`;
      if (diff > 0 && diff <= 6) return `Next ${WEEKDAYS[d.getDay()]}`;
      return `${MONTHS[mo]} ${day}, ${y}`;
    }
    default:
      return `${MONTHS[mo]} ${day}, ${y}`;
  }
}

/** Display text for a date value: "October 20, 2026 4:00 PM → October 24, 2026 6:00 PM". */
export function formatDateRange(r: DateRange | null | undefined, opts?: { dateFormat?: string; timeFormat?: string; now?: number }): string {
  if (!r) return '';
  const df = opts?.dateFormat ?? r.raw?.date_format;
  const tf = opts?.timeFormat ?? r.raw?.time_format;
  const part = (ms: number, withTime: boolean) => {
    const day = formatDay(ms, df, opts?.now);
    const t = withTime ? formatTime(ms, tf) : '';
    return t ? `${day} ${t}` : day;
  };
  const start = part(r.startMs, r.hasTime);
  if (!r.isRange || r.endMs === undefined) return start;
  return `${start} → ${part(r.endMs, r.hasTime)}`;
}

export function formatTimestamp(ms: number, opts?: { dateFormat?: string; timeFormat?: string; now?: number }): string {
  const day = formatDay(ms, opts?.dateFormat, opts?.now);
  const t = formatTime(ms, opts?.timeFormat);
  return t ? `${day} ${t}` : day;
}

export function monthLabel(ms: number, short = false): string {
  const d = new Date(ms);
  return `${(short ? MONTHS_SHORT : MONTHS)[d.getMonth()]} ${d.getFullYear()}`;
}

export function monthShort(i: number): string {
  return MONTHS_SHORT[i];
}

export function monthName(i: number): string {
  return MONTHS[i];
}

export function weekdayName(i: number): string {
  return WEEKDAYS[i];
}

/** Human duration for date_range calculations. */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  const days = Math.round(abs / DAY_MS);
  if (abs < 3_600_000) return plural(Math.round(abs / 60_000), 'minute');
  if (abs < DAY_MS) return plural(Math.round(abs / 3_600_000), 'hour');
  if (days < 31) return plural(days, 'day');
  if (days < 365) return plural(Math.round(days / 30.4375), 'month');
  return plural(Math.round(days / 365.25), 'year');
}

// ---------- relative filter values ---------

/** Single relative date ("today", "one_week_ago", …) → local midnight ms. */
export function relativeDay(value: string, now: number): number | null {
  const today = startOfDay(now);
  switch (value) {
    case 'today': return today;
    case 'tomorrow': return addDays(today, 1);
    case 'yesterday': return addDays(today, -1);
    case 'one_week_ago': return addDays(today, -7);
    case 'one_week_from_now': return addDays(today, 7);
    case 'one_month_ago': return addMonths(today, -1);
    case 'one_month_from_now': return addMonths(today, 1);
    default: return null;
  }
}

/** Relative range filter value → [startMs, endExclusiveMs) in local days. */
export function relativeRange(
  v: { value?: any; unit?: 'day' | 'week' | 'month' | 'year'; direction?: 'past' | 'future'; count?: number },
  now: number,
  weekStart: 0 | 1 = 0,
): [number, number] | null {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const preset: Record<string, { value: string; unit: 'day' | 'week' | 'month' | 'year'; direction?: 'past' | 'future'; count?: number }> = {
    this_week: { value: 'surrounding', unit: 'week' },
    the_past_week: { value: 'custom', direction: 'past', count: 1, unit: 'week' },
    the_past_month: { value: 'custom', direction: 'past', count: 1, unit: 'month' },
    the_past_year: { value: 'custom', direction: 'past', count: 1, unit: 'year' },
    the_next_week: { value: 'custom', direction: 'future', count: 1, unit: 'week' },
    the_next_month: { value: 'custom', direction: 'future', count: 1, unit: 'month' },
    the_next_year: { value: 'custom', direction: 'future', count: 1, unit: 'year' },
    past_week: { value: 'custom', direction: 'past', count: 1, unit: 'week' },
    past_month: { value: 'custom', direction: 'past', count: 1, unit: 'month' },
    past_year: { value: 'custom', direction: 'past', count: 1, unit: 'year' },
    next_week: { value: 'custom', direction: 'future', count: 1, unit: 'week' },
    next_month: { value: 'custom', direction: 'future', count: 1, unit: 'month' },
    next_year: { value: 'custom', direction: 'future', count: 1, unit: 'year' },
  };
  const spec = typeof v.value === 'string' && preset[v.value] ? preset[v.value] : { value: v.value, unit: v.unit ?? 'week', direction: v.direction, count: v.count };
  if (spec.value === 'surrounding') return unitRange(now, spec.unit, weekStart);
  if (spec.value === 'custom') {
    const n = spec.count ?? 1;
    if (spec.direction === 'future') return [today, addDays(addUnits(today, spec.unit, n), 1)];
    return [addUnits(today, spec.unit, -n), tomorrow];
  }
  const single = typeof spec.value === 'string' ? relativeDay(spec.value, now) : null;
  if (single !== null) return [single, addDays(single, 1)];
  return null;
}

/** Relative date-group bucket for a day (date group-by "Relative"). */
export function relativeBucket(ms: number, now: number): { type: string; range?: { type: 'daterange'; start_date: string; end_date: string } } {
  const diff = dayDiff(ms, now);
  if (diff === 0) return { type: 'today' };
  if (diff === 1) return { type: 'tomorrow' };
  if (diff === -1) return { type: 'yesterday' };
  if (diff > 1 && diff <= 7) return { type: 'next_7_days' };
  if (diff < -1 && diff >= -7) return { type: 'last_7_days' };
  if (diff > 7 && diff <= 30) return { type: 'next_30_days' };
  if (diff < -7 && diff >= -30) return { type: 'last_30_days' };
  const s = startOfMonth(ms);
  const e = addDays(addMonths(s, 1), -1);
  return { type: 'month', range: { type: 'daterange', start_date: msToYmd(s), end_date: msToYmd(e) } };
}

export const RELATIVE_BUCKET_LABELS: Record<string, string> = {
  today: 'Today', tomorrow: 'Tomorrow', yesterday: 'Yesterday', next_7_days: 'Next 7 days', last_7_days: 'Last 7 days',
  next_30_days: 'Next 30 days', last_30_days: 'Last 30 days',
};

/** Sort rank of relative buckets in ascending time. */
export function relativeBucketRank(b: { type: string; range?: { start_date: string } }, now: number): number {
  const fixed: Record<string, number> = { last_30_days: -20, last_7_days: -4, yesterday: -1, today: 0, tomorrow: 1, next_7_days: 4, next_30_days: 20 };
  if (b.type in fixed) return fixed[b.type];
  if (b.range) {
    const ms = ymdToMs(b.range.start_date);
    return dayDiff(ms, now);
  }
  return 0;
}

export function weekLabel(startMs: number): string {
  const end = addDays(startMs, 6);
  const s = new Date(startMs);
  const e = new Date(end);
  if (s.getFullYear() !== e.getFullYear()) return `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()} ${s.getFullYear()} – ${MONTHS_SHORT[e.getMonth()]} ${e.getDate()} ${e.getFullYear()}`;
  if (s.getMonth() !== e.getMonth()) return `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()} – ${MONTHS_SHORT[e.getMonth()]} ${e.getDate()} ${s.getFullYear()}`;
  return `${MONTHS_SHORT[s.getMonth()]} ${s.getDate()} – ${e.getDate()} ${s.getFullYear()}`;
}

const KO_RELATIVE: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3, 어제: -1, 그제: -2, 그저께: -2 };

/** Korean input: "2026년 10월 20일", "10월 20일", "2026. 10. 20.", "오늘" / "내일" / "어제" … */
function parseKoreanDate(s: string, now: number): string | null {
  const compact = s.replace(/\s+/g, '');
  if (compact in KO_RELATIVE) return msToYmd(addDays(startOfDay(now), KO_RELATIVE[compact]));
  let m = /^(?:(\d{2,4})년)?(\d{1,2})월(\d{1,2})일?(?:\([월화수목금토일]\))?$/.exec(compact);
  if (m) {
    const y = m[1] ? Number(m[1].length === 2 ? `20${m[1]}` : m[1]) : new Date(now).getFullYear();
    return valid(y, Number(m[2]), Number(m[3]));
  }
  m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})\.?$/.exec(compact);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

/** Parse loose user input ("Oct 20, 2026", "2026-10-20", "10/20/2026", "today", "2026년 10월 20일") → YYYY-MM-DD. */
export function parseDateInput(text: string, now: number = Date.now(), dateFormat?: string): string | null {
  const s = text.trim().toLowerCase();
  if (!s) return null;
  const rel = relativeDay(s.replace(/\s+/g, '_'), now);
  if (rel !== null) return msToYmd(rel);
  const ko = /[가-힣]|^\d{4}\.\s*\d/.test(s) ? parseKoreanDate(s, now) : null;
  if (ko) return ko;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  if (m) return valid(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return dateFormat === 'DD/MM/YYYY' ? valid(Number(m[3]), b, a) : valid(Number(m[3]), a, b);
  }
  m = /^([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/.exec(s);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![1].slice(0, 3)));
    if (mi >= 0) return valid(m[3] ? Number(m[3]) : new Date(now).getFullYear(), mi + 1, Number(m[2]));
  }
  m = /^(\d{1,2})\s+([a-z]{3,})\.?,?\s*(\d{4})?$/.exec(s);
  if (m) {
    const mi = MONTHS.findIndex((x) => x.toLowerCase().startsWith(m![2].slice(0, 3)));
    if (mi >= 0) return valid(m[3] ? Number(m[3]) : new Date(now).getFullYear(), mi + 1, Number(m[1]));
  }
  return null;
}

function valid(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, mo - 1, d);
  if (dt.getMonth() !== mo - 1) return null;
  return `${y}-${pad2(mo)}-${pad2(d)}`;
}

/** Parse "4:00 PM", "16:00", "4pm" → HH:mm. */
export function parseTimeInput(text: string): string | null {
  const s = text.trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === 'pm' && h < 12) h += 12;
  if (m[3] === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${pad2(h)}:${pad2(min)}`;
}

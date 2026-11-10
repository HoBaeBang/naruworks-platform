// "Every…" recurrence (automation trigger, repeating database templates): next-occurrence
// computation in the configured time zone, presets and human labels.
import { DT, zoneOrSystem, ordinalSuffix } from '../formula/dates.ts';
import type { Recurrence } from './types.ts';

export type RecurrencePreset = 'day' | 'weekday' | 'week' | 'two_weeks' | 'month' | 'three_months' | 'six_months' | 'year';

export const RECURRENCE_PRESETS: { id: RecurrencePreset; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'weekday', label: 'Weekday' },
  { id: 'week', label: 'Week' },
  { id: 'two_weeks', label: '2 Weeks' },
  { id: 'month', label: 'Month' },
  { id: 'three_months', label: '3 Months' },
  { id: 'six_months', label: '6 Months' },
  { id: 'year', label: 'Year' },
];

export const FREQUENCY_LABELS: Record<Recurrence['frequency'], [string, string]> = {
  hour: ['Hour', 'Hours'],
  day: ['Day', 'Days'],
  week: ['Week', 'Weeks'],
  month: ['Month', 'Months'],
  year: ['Year', 'Years'],
};

export const WEEKDAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function todayIn(tz: string, now: number): DT {
  return new DT(now, zoneOrSystem(tz));
}

/** A preset recurrence starting today (default "At" time 9:00). */
export function presetRecurrence(id: RecurrencePreset, now = Date.now(), timeZone?: string, time: string | undefined = '09:00'): Recurrence {
  const tz = zoneOrSystem(timeZone).name;
  const d = todayIn(tz, now);
  const start = d.toISODate();
  const wd = d.weekday % 7; // DT weekday 1=Mon..7=Sun → 0=Sun
  const base = { start, time, time_zone: tz, end: { type: 'never' as const } };
  switch (id) {
    case 'day': return { ...base, frequency: 'day', interval: 1 };
    case 'weekday': return { ...base, frequency: 'week', interval: 1, weekdays: [1, 2, 3, 4, 5] };
    case 'week': return { ...base, frequency: 'week', interval: 1, weekdays: [wd] };
    case 'two_weeks': return { ...base, frequency: 'week', interval: 2, weekdays: [wd] };
    case 'month': return { ...base, frequency: 'month', interval: 1, month_day: d.day };
    case 'three_months': return { ...base, frequency: 'month', interval: 3, month_day: d.day };
    case 'six_months': return { ...base, frequency: 'month', interval: 6, month_day: d.day };
    case 'year': return { ...base, frequency: 'year', interval: 1, month: d.month, month_day: d.day };
  }
}

/** The preset a recurrence corresponds to (template "Duplicate every…" menu check marks). */
export function presetOf(r: Recurrence | null | undefined): RecurrencePreset | null {
  if (!r) return null;
  const wds = [...(r.weekdays ?? [])].sort().join(',');
  if (r.frequency === 'day' && r.interval === 1) return 'day';
  if (r.frequency === 'week' && r.interval === 1 && wds === '1,2,3,4,5') return 'weekday';
  if (r.frequency === 'week' && (r.weekdays?.length ?? 0) <= 1) return r.interval === 1 ? 'week' : r.interval === 2 ? 'two_weeks' : null;
  if (r.frequency === 'month' && typeof r.month_day !== 'string') return r.interval === 1 ? 'month' : r.interval === 3 ? 'three_months' : r.interval === 6 ? 'six_months' : null;
  if (r.frequency === 'year' && r.interval === 1) return 'year';
  return null;
}

function parseYmd(s: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? '');
  return m ? { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) } : null;
}

function parseTime(t: string | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? '');
  // "Around midnight" (12–3AM): runs at 00:00
  return m ? { hour: Math.min(23, Number(m[1])), minute: Math.min(59, Number(m[2])) } : { hour: 0, minute: 0 };
}

function daysIn(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Is the recurrence configuration complete? ("Missing required fields") */
export function recurrenceValid(r: Recurrence | null | undefined): boolean {
  if (!r) return false;
  if (!['hour', 'day', 'week', 'month', 'year'].includes(r.frequency)) return false;
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 1000) return false;
  if (!parseYmd(r.start)) return false;
  if (r.frequency === 'week' && r.weekdays && r.weekdays.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return false;
  if (r.time && !/^\d{1,2}:\d{2}$/.test(r.time)) return false;
  if (r.end?.type === 'count' && (!Number.isInteger(r.end.count) || r.end.count < 1)) return false;
  if (r.end?.type === 'date' && !parseYmd(r.end.date)) return false;
  return true;
}

/**
 * First occurrence strictly after `after` (epoch ms), or null when the recurrence has ended (end date passed;
 * the run-count end is checked by the caller with `runs`).
 */
export function nextOccurrence(r: Recurrence, after: number, runs = 0): number | null {
  if (!recurrenceValid(r)) return null;
  if (r.end?.type === 'count' && runs >= r.end.count) return null;
  const zone = zoneOrSystem(r.time_zone);
  const start = parseYmd(r.start)!;
  const { hour, minute } = parseTime(r.time);
  const endDate = r.end?.type === 'date' ? parseYmd(r.end.date) : null;
  const endMs = endDate ? DT.fromWall({ ...endDate, hour: 23, minute: 59, second: 59, millisecond: 999 }, zone).ts : Infinity;
  const at = (y: number, m: number, d: number, h = hour, mi = minute) => DT.fromWall({ year: y, month: m, day: d, hour: h, minute: mi, second: 0, millisecond: 0 }, zone);
  const startAt = at(start.year, start.month, start.day);
  const ok = (dt: DT) => dt.ts > after && dt.ts >= startAt.ts - (r.frequency === 'hour' ? 0 : 0);
  const n = Math.max(1, r.interval);
  const limit = 5000;
  switch (r.frequency) {
    case 'hour': {
      const step = n * 3600_000;
      const base = startAt.ts;
      const k = after < base ? 0 : Math.floor((after - base) / step) + 1;
      const ts = base + k * step;
      return ts <= endMs ? ts : null;
    }
    case 'day': {
      // jump close to `after` first (days are not always 24h across DST, so walk from a near estimate)
      let k = after > startAt.ts ? Math.max(0, Math.floor((after - startAt.ts) / (n * 86_400_000)) - 1) : 0;
      for (let i = 0; i < limit; i++, k++) {
        const dt = startAt.plus({ days: k * n });
        if (dt.ts > endMs) return null;
        if (ok(dt)) return dt.ts;
      }
      return null;
    }
    case 'week': {
      const days = (r.weekdays?.length ? [...r.weekdays] : [startAt.weekday % 7]).sort((a, b) => a - b);
      // week of the start date, beginning Sunday
      const startDow = startAt.weekday % 7;
      const week0 = at(start.year, start.month, start.day).plus({ days: -startDow });
      let w = after > week0.ts ? Math.max(0, Math.floor((after - week0.ts) / (7 * 86_400_000 * n)) - 1) : 0;
      for (let i = 0; i < limit; i++, w++) {
        const ws = week0.plus({ days: w * 7 * n });
        if (ws.ts > endMs) return null;
        for (const d of days) {
          const dt = ws.plus({ days: d });
          if (dt.ts < startAt.ts) continue;
          if (dt.ts > endMs) return null;
          if (ok(dt)) return dt.ts;
        }
      }
      return null;
    }
    case 'month': {
      const dayOf = (y: number, m: number) => (r.month_day === 'last' ? daysIn(y, m) : Math.min(r.month_day ?? start.day, daysIn(y, m)));
      let k = 0;
      if (after > startAt.ts) {
        const a = new DT(after, zone);
        const months = (a.year - start.year) * 12 + (a.month - start.month);
        k = Math.max(0, Math.floor(months / n) - 1);
      }
      for (let i = 0; i < limit; i++, k++) {
        const total = start.month - 1 + k * n;
        const y = start.year + Math.floor(total / 12);
        const m = (total % 12) + 1;
        const dt = at(y, m, dayOf(y, m));
        if (dt.ts > endMs) return null;
        if (dt.ts >= startAt.ts && ok(dt)) return dt.ts;
      }
      return null;
    }
    case 'year': {
      const month = r.month ?? start.month;
      let k = 0;
      if (after > startAt.ts) k = Math.max(0, Math.floor((new DT(after, zone).year - start.year) / n) - 1);
      for (let i = 0; i < limit; i++, k++) {
        const y = start.year + k * n;
        const d = r.month_day === 'last' ? daysIn(y, month) : Math.min(r.month_day ?? start.day, daysIn(y, month));
        const dt = at(y, month, d);
        if (dt.ts > endMs) return null;
        if (dt.ts >= startAt.ts && ok(dt)) return dt.ts;
      }
      return null;
    }
  }
  return null;
}

function timeLabel(t: string | undefined): string {
  if (!t) return 'around midnight';
  const { hour, minute } = parseTime(t);
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, '0')} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "Every day at 9:00 AM", "Every 2 weeks on Mon, Wed at 9:00 AM", "Every weekday Mon – Fri …", "Every month on the 15th". */
export function recurrenceLabel(r: Recurrence | null | undefined, opts: { withTime?: boolean } = {}): string {
  if (!r) return '';
  const n = Math.max(1, r.interval);
  const at = opts.withTime === false ? '' : ` at ${timeLabel(r.time)}`;
  const wds = [...(r.weekdays ?? [])].sort((a, b) => a - b);
  let s: string;
  switch (r.frequency) {
    case 'hour': s = n === 1 ? 'Every hour' : `Runs every ${n} hours`; return s;
    case 'day': s = n === 1 ? 'Every day' : `Runs every ${n} days`; break;
    case 'week':
      if (n === 1 && wds.join(',') === '1,2,3,4,5') s = 'Every weekday Mon – Fri';
      else if (n === 1 && wds.join(',') === '0,6') s = 'Every weekend day';
      else if (wds.length) s = n === 1 ? `Every week on ${wds.map((d) => (wds.length === 1 ? WEEKDAY_LONG[d] : WEEKDAY_SHORT[d])).join(', ')}` : `Runs every ${n} weeks on ${wds.map((d) => WEEKDAY_SHORT[d]).join(', ')}`;
      else s = n === 1 ? 'Every week' : `Runs every ${n} weeks`;
      break;
    case 'month': {
      const day = r.month_day === 'last' ? 'the last day' : `the ${ordinalSuffix(Number(r.month_day ?? parseYmd(r.start)?.day ?? 1))}`;
      s = n === 1 ? `Every month on ${day}` : `Every ${n} months on ${day}`;
      break;
    }
    case 'year': {
      const ymd = parseYmd(r.start);
      const month = MONTHS[(r.month ?? ymd?.month ?? 1) - 1];
      const day = r.month_day === 'last' ? 'last day' : String(r.month_day ?? ymd?.day ?? 1);
      s = n === 1 ? `Every year on ${month} ${day}` : `Every ${n} years on ${month} ${day}`;
      break;
    }
    default: s = '';
  }
  return s + at;
}

/** Short cadence for the "Every {frequency}" trigger card: "day", "2 weeks", "weekday" … */
export function frequencyText(r: Recurrence | null | undefined): string {
  if (!r) return '…';
  const p = presetOf(r);
  if (p === 'weekday') return 'weekday';
  const n = Math.max(1, r.interval);
  const [one, many] = FREQUENCY_LABELS[r.frequency];
  return n === 1 ? one.toLowerCase() : `Every ${n} ${many.toLowerCase()}`;
}

/** "Duplicate daily" / "Duplicate weekly" … (template picker caption) */
export function duplicateCaption(r: Recurrence | null | undefined): string {
  if (!r) return '';
  switch (r.frequency) {
    case 'hour': return 'Duplicate hourly';
    case 'day': return 'Duplicate daily';
    case 'week': return 'Duplicate weekly';
    case 'month': return 'Duplicate monthly';
    case 'year': return 'Duplicate yearly';
  }
}

export function formatOccurrence(ms: number, timeZone?: string): string {
  const d = new DT(ms, zoneOrSystem(timeZone));
  const h12 = d.hour % 12 === 0 ? 12 : d.hour % 12;
  return `${MONTHS[d.month - 1].slice(0, 3)} ${d.day}, ${d.year} at ${h12}:${String(d.minute).padStart(2, '0')} ${d.hour < 12 ? 'AM' : 'PM'}`;
}

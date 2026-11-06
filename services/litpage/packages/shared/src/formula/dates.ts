// Date values + timezone-aware calendar arithmetic (the luxon subset the formula engine needs),
// implemented on Intl so the shared package stays dependency-free.
import type { DateValue } from '../richtext.ts';

export type LitDate = DateValue;
export type DateUnit = 'years' | 'quarters' | 'months' | 'weeks' | 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds';
export const DATE_UNITS: DateUnit[] = ['years', 'quarters', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'];
const TIME_UNITS = new Set<DateUnit>(['hours', 'minutes', 'seconds', 'milliseconds']);
const UNIT_MS: Record<string, number> = { hours: 3600000, minutes: 60000, seconds: 1000, milliseconds: 1 };
// luxon "casual" conversion used for fractional calendar units
const CASUAL_MS: Record<string, number> = { years: 365 * 864e5, quarters: 91 * 864e5, months: 30 * 864e5, weeks: 7 * 864e5, days: 864e5 };

// ---------------------------------------------------------------- zones
export type Zone = { kind: 'iana'; name: string } | { kind: 'fixed'; offset: number; name: string };

const zoneCache = new Map<string, Zone | null>();

export function systemZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** IANA name ("Asia/Seoul"), "UTC", or fixed offsets ("UTC+1", "GMT-05:30", "+09:00"). */
export function parseZone(name: string | undefined | null): Zone | null {
  if (!name) return null;
  const cached = zoneCache.get(name);
  if (cached !== undefined) return cached;
  let z: Zone | null = null;
  const trimmed = name.trim();
  if (/^(utc|gmt|z|etc\/utc|etc\/gmt)$/i.test(trimmed)) z = { kind: 'fixed', offset: 0, name: 'UTC' };
  else {
    const m = /^(?:UTC|GMT)?\s*([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(trimmed);
    if (m) {
      const off = (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
      z = { kind: 'fixed', offset: off, name: `UTC${m[1]}${Number(m[2])}${m[3] && m[3] !== '00' ? ':' + m[3] : ''}` };
    } else {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: trimmed });
        z = { kind: 'iana', name: trimmed };
      } catch {
        z = null;
      }
    }
  }
  zoneCache.set(name, z);
  return z;
}

export function zoneOrSystem(name?: string | null): Zone {
  return parseZone(name) ?? parseZone(systemZoneName()) ?? { kind: 'fixed', offset: 0, name: 'UTC' };
}

const partsFmt = new Map<string, Intl.DateTimeFormat>();
function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = partsFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', era: 'short',
    });
    partsFmt.set(tz, f);
  }
  return f;
}

export interface Wall {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export function utcFromWall(w: Wall): number {
  const d = new Date(0);
  d.setUTCFullYear(w.year, w.month - 1, w.day);
  d.setUTCHours(w.hour, w.minute, w.second, w.millisecond);
  return d.getTime();
}

function wallFromUtc(ms: number): Wall {
  const d = new Date(ms);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes(), second: d.getUTCSeconds(), millisecond: d.getUTCMilliseconds() };
}

/** Offset of `zone` from UTC at instant `ts`, in minutes (positive east of UTC). */
export function offsetMinutes(ts: number, zone: Zone): number {
  if (zone.kind === 'fixed') return zone.offset;
  if (!Number.isFinite(ts)) return 0;
  const parts = formatterFor(zone.name).formatToParts(new Date(ts));
  let y = 1970, mo = 1, d = 1, h = 0, mi = 0, s = 0, bc = false;
  for (const p of parts) {
    switch (p.type) {
      case 'year': y = Number(p.value); break;
      case 'month': mo = Number(p.value); break;
      case 'day': d = Number(p.value); break;
      case 'hour': h = Number(p.value) % 24; break;
      case 'minute': mi = Number(p.value); break;
      case 'second': s = Number(p.value); break;
      case 'era': bc = /^B/i.test(p.value); break;
    }
  }
  if (bc) y = 1 - y;
  const asUtc = utcFromWall({ year: y, month: mo, day: d, hour: h, minute: mi, second: s, millisecond: 0 });
  const floorSec = ts - (((ts % 1000) + 1000) % 1000);
  return Math.round((asUtc - floorSec) / 60000);
}

/** luxon fixOffset: wall clock -> instant, resolving DST gaps/overlaps like luxon does. */
function fixOffset(localTs: number, o: number, zone: Zone): number {
  let guess = localTs - o * 60000;
  const o2 = offsetMinutes(guess, zone);
  if (o === o2) return guess;
  guess -= (o2 - o) * 60000;
  const o3 = offsetMinutes(guess, zone);
  if (o2 === o3) return guess;
  return localTs - Math.min(o2, o3) * 60000;
}

export function daysInMonth(year: number, month: number): number {
  const ym = year * 12 + (month - 1);
  const y = Math.floor(ym / 12);
  const m = ym - y * 12 + 1;
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
}

function isoWeek(y: number, m: number, d: number): { week: number; weekYear: number } {
  const t = Date.UTC(y, m - 1, d);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon=0
  const thursday = new Date(t - dow * 864e5 + 3 * 864e5);
  const wy = thursday.getUTCFullYear();
  const jan4 = Date.UTC(wy, 0, 4);
  const jan4dow = (new Date(jan4).getUTCDay() + 6) % 7;
  const week1Monday = jan4 - jan4dow * 864e5;
  return { week: Math.floor((thursday.getTime() - 3 * 864e5 - week1Monday) / (7 * 864e5)) + 1, weekYear: wy };
}

/** Minimal luxon-like DateTime: an instant + a zone, exposing wall-clock fields in that zone. */
export class DT {
  readonly ts: number;
  readonly zone: Zone;
  private w?: Wall & { weekday: number };
  constructor(ts: number, zone: Zone) {
    this.ts = ts;
    this.zone = zone;
  }
  static fromWall(w: Wall, zone: Zone): DT {
    const local = utcFromWall(w);
    return new DT(fixOffset(local, offsetMinutes(local, zone), zone), zone);
  }
  static now(zone: Zone): DT {
    return new DT(Date.now(), zone);
  }
  get isValid() {
    return Number.isFinite(this.ts);
  }
  get wall(): Wall & { weekday: number } {
    if (!this.w) {
      const off = offsetMinutes(this.ts, this.zone);
      const w = wallFromUtc(this.ts + off * 60000);
      const wd = new Date(utcFromWall({ ...w, hour: 12, minute: 0, second: 0, millisecond: 0 })).getUTCDay();
      this.w = { ...w, weekday: wd === 0 ? 7 : wd };
    }
    return this.w;
  }
  get year() { return this.wall.year; }
  get month() { return this.wall.month; }
  get day() { return this.wall.day; }
  get hour() { return this.wall.hour; }
  get minute() { return this.wall.minute; }
  get second() { return this.wall.second; }
  get millisecond() { return this.wall.millisecond; }
  /** 1 = Monday … 7 = Sunday (luxon/ISO) */
  get weekday() { return this.wall.weekday; }
  get quarter() { return Math.ceil(this.month / 3); }
  get ordinal() {
    const w = this.wall;
    return Math.round((Date.UTC(w.year, w.month - 1, w.day) - Date.UTC(w.year, 0, 1)) / 864e5) + 1;
  }
  get weekNumber() { return isoWeek(this.year, this.month, this.day).week; }
  get weekYear() { return isoWeek(this.year, this.month, this.day).weekYear; }
  get offset() { return offsetMinutes(this.ts, this.zone); }
  setZone(zone: Zone): DT {
    return new DT(this.ts, zone);
  }
  set(fields: Partial<Wall>): DT {
    return DT.fromWall({ ...this.wall, ...fields }, this.zone);
  }
  startOf(unit: 'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second'): DT {
    const w = { ...this.wall };
    switch (unit) {
      case 'year': w.month = 1; // fallthrough
      case 'quarter': if (unit === 'quarter') w.month = (this.quarter - 1) * 3 + 1; // fallthrough
      case 'month': w.day = 1; // fallthrough
      case 'day': w.hour = 0; // fallthrough
      case 'hour': w.minute = 0; // fallthrough
      case 'minute': w.second = 0; // fallthrough
      case 'second': w.millisecond = 0; break;
      case 'week': {
        const d = DT.fromWall({ ...w, hour: 0, minute: 0, second: 0, millisecond: 0 }, this.zone);
        return d.plus({ days: -(this.weekday - 1) });
      }
    }
    return DT.fromWall(w, this.zone);
  }
  endOf(unit: 'day' | 'month' | 'year'): DT {
    const start = this.startOf(unit);
    const next = unit === 'day' ? start.plus({ days: 1 }) : unit === 'month' ? start.plus({ months: 1 }) : start.plus({ years: 1 });
    return new DT(next.ts - 1, this.zone);
  }
  /** luxon DateTime#plus semantics: calendar units shift wall-clock (clamping the day), fractions and time units add milliseconds. */
  plus(dur: Partial<Record<DateUnit, number>>): DT {
    const n = (k: DateUnit) => dur[k] ?? 0;
    const tr = (k: DateUnit) => Math.trunc(n(k));
    const w = this.wall;
    let year = w.year + tr('years');
    let month = w.month + tr('months') + tr('quarters') * 3;
    const ym = year * 12 + (month - 1);
    year = Math.floor(ym / 12);
    month = ym - year * 12 + 1;
    const day = Math.min(w.day, daysInMonth(year, month)) + tr('days') + tr('weeks') * 7;
    const local = utcFromWall({ year, month, day, hour: w.hour, minute: w.minute, second: w.second, millisecond: w.millisecond });
    let ts = fixOffset(local, this.offset, this.zone);
    let extra = 0;
    for (const k of ['years', 'quarters', 'months', 'weeks', 'days'] as DateUnit[]) extra += (n(k) - tr(k)) * CASUAL_MS[k];
    extra += n('hours') * 3600000 + n('minutes') * 60000 + n('seconds') * 1000 + n('milliseconds');
    if (extra) ts += extra;
    return new DT(Math.round(ts), this.zone);
  }
  minus(dur: Partial<Record<DateUnit, number>>): DT {
    const neg: Partial<Record<DateUnit, number>> = {};
    for (const [k, v] of Object.entries(dur)) neg[k as DateUnit] = -(v as number);
    return this.plus(neg);
  }
  /** this - other, expressed in `unit` (luxon DateTime#diff(other, unit).get(unit), fractional). */
  diff(other: DT, unit: DateUnit): number {
    if (other.ts > this.ts) return -diffLater(this, other, unit);
    return diffLater(other, this, unit);
  }
  valueOf() {
    return this.ts;
  }
  toISODate(): string {
    const w = this.wall;
    return `${pad(w.year, 4)}-${pad(w.month, 2)}-${pad(w.day, 2)}`;
  }
  toHHmm(): string {
    return `${pad(this.hour, 2)}:${pad(this.minute, 2)}`;
  }
}

function pad(n: number, len: number): string {
  const s = String(Math.abs(n)).padStart(len, '0');
  return n < 0 ? '-' + s : s;
}

function dayDiff(a: DT, b: DT): number {
  const ua = Date.UTC(a.year, a.month - 1, a.day);
  const ub = Date.UTC(b.year, b.month - 1, b.day);
  return Math.floor((ub - ua) / 864e5);
}

/** luxon diff for a single unit where earlier <= later. */
function diffLater(earlier: DT, later: DT, unit: DateUnit): number {
  if (TIME_UNITS.has(unit)) return (later.ts - earlier.ts) / UNIT_MS[unit];
  const differ = (a: DT, b: DT): number => {
    switch (unit) {
      case 'years': return b.year - a.year;
      case 'quarters': return b.quarter - a.quarter + (b.year - a.year) * 4;
      case 'months': return b.month - a.month + (b.year - a.year) * 12;
      case 'weeks': { const d = dayDiff(a, b); return (d - (d % 7)) / 7; }
      default: return dayDiff(a, b);
    }
  };
  let n = differ(earlier, later);
  let highWater = earlier.plus({ [unit]: n });
  let cursor: DT;
  if (highWater.ts > later.ts) {
    n--;
    cursor = earlier.plus({ [unit]: n });
    if (cursor.ts > later.ts) {
      highWater = cursor;
      n--;
      cursor = earlier.plus({ [unit]: n });
    }
  } else cursor = highWater;
  const remaining = later.ts - cursor.ts;
  if (highWater.ts < later.ts || highWater === cursor) highWater = cursor.plus({ [unit]: 1 });
  if (highWater.ts !== cursor.ts && remaining) n += remaining / (highWater.ts - cursor.ts);
  return n;
}

// ---------------------------------------------------------------- date values
function parseYmd(s: string | undefined): { year: number; month: number; day: number } | null {
  const m = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})$/.exec(s ?? '');
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function parseHm(s: string | undefined): { hour: number; minute: number } {
  const m = /^(\d{1,2}):(\d{2})/.exec(s ?? '');
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : { hour: 0, minute: 0 };
}

function dtOf(date: string | undefined, time: string | undefined, zone: Zone): DT {
  const ymd = parseYmd(date);
  if (!ymd) return new DT(NaN, zone);
  const hm = time ? parseHm(time) : { hour: 0, minute: 0 };
  return DT.fromWall({ ...ymd, ...hm, second: 0, millisecond: 0 }, zone);
}

/** date value -> {start, end?} DateTimes. Date-only values are midnight in `tz`; datetimes use their own time_zone. */
export function dateInterval(v: LitDate, tz?: string | null): { start: DT; end?: DT } {
  const user = zoneOrSystem(tz);
  switch (v.type) {
    case 'datetime': {
      const z = parseZone(v.time_zone) ?? user;
      return { start: dtOf(v.start_date, v.start_time, z) };
    }
    case 'datetimerange': {
      const z = parseZone(v.time_zone) ?? user;
      return { start: dtOf(v.start_date, v.start_time, z), end: dtOf(v.end_date ?? v.start_date, v.end_time ?? v.start_time, z) };
    }
    case 'daterange':
      return { start: dtOf(v.start_date, undefined, user), end: dtOf(v.end_date ?? v.start_date, undefined, user) };
    default:
      return { start: dtOf(v.start_date, undefined, user) };
  }
}

/** Start instant in ms. */
export function dateStartMs(v: LitDate, tz?: string | null): number {
  return dateInterval(v, tz).start.ts;
}

export function dateEndMs(v: LitDate, tz?: string | null): number {
  const i = dateInterval(v, tz);
  return (i.end ?? i.start).ts;
}

export function isRange(v: LitDate): boolean {
  return v.type === 'daterange' || v.type === 'datetimerange';
}

export function hasTime(v: LitDate): boolean {
  return v.type === 'datetime' || v.type === 'datetimerange';
}

/** Persisted datetime for an instant in a zone (minute precision). */
export function datetimeFromMs(ms: number, tz?: string | null): LitDate {
  const zone = zoneOrSystem(tz);
  const d = new DT(ms, zone);
  return { type: 'datetime', start_date: d.toISODate(), start_time: d.toHHmm(), time_zone: zone.name };
}

/** Persisted date-only value for an instant in a zone. */
export function dateFromMs(ms: number, tz?: string | null): LitDate {
  const d = new DT(ms, zoneOrSystem(tz));
  return { type: 'date', start_date: d.toISODate() };
}

export function nowValue(tz?: string | null, nowMs = Date.now()): LitDate {
  return datetimeFromMs(nowMs, tz);
}

export function todayValue(tz?: string | null, nowMs = Date.now()): LitDate {
  return dateFromMs(nowMs, tz);
}

/** dateStart(): first point of a range */
export function rangeStart(v: LitDate): LitDate {
  if (v.type === 'daterange') return { type: 'date', start_date: v.start_date };
  if (v.type === 'datetimerange') return { type: 'datetime', start_date: v.start_date, start_time: v.start_time, time_zone: v.time_zone };
  return v;
}

/** dateEnd(): last point of a range */
export function rangeEnd(v: LitDate): LitDate {
  if (v.type === 'daterange') return { type: 'date', start_date: v.end_date ?? v.start_date };
  if (v.type === 'datetimerange') return { type: 'datetime', start_date: v.end_date ?? v.start_date, start_time: v.end_time ?? v.start_time, time_zone: v.time_zone };
  return v;
}

/** date equality: same type and same set fields. */
export function sameDate(a: LitDate, b: LitDate): boolean {
  return a.type === b.type && a.start_date === b.start_date && (a.start_time ?? '') === (b.start_time ?? '') && (a.end_date ?? '') === (b.end_date ?? '') && (a.end_time ?? '') === (b.end_time ?? '') && (!a.time_zone || !b.time_zone || a.time_zone === b.time_zone);
}

export function compareDates(a: LitDate, b: LitDate, tz?: string | null): number {
  const x = dateStartMs(a, tz);
  const y = dateStartMs(b, tz);
  return x > y ? 1 : x < y ? -1 : 0;
}

/** dateRange(start, end) (formula library) */
export function makeRange(a: LitDate, b: LitDate, tz?: string | null): LitDate {
  if (a.start_time !== undefined || b.start_time !== undefined) {
    return {
      type: 'datetimerange',
      start_date: a.start_date,
      start_time: a.start_time ?? '00:00',
      end_date: b.end_date ?? b.start_date,
      end_time: b.end_time ?? b.start_time ?? '23:59',
      time_zone: a.time_zone || b.time_zone || zoneOrSystem(tz).name,
    };
  }
  return { type: 'daterange', start_date: a.start_date, end_date: b.end_date ?? b.start_date };
}

/** Normalize a unit argument: append "s", validate case-insensitively. */
export function normalizeUnit(raw: string): DateUnit | null {
  let u = raw.trim();
  if (u.at(-1) !== 's') u += 's';
  const l = u.toLowerCase() as DateUnit;
  return DATE_UNITS.includes(l) ? l : null;
}

/** dateAdd/dateSubtract */
export function addToDate(v: LitDate, amount: number, unit: DateUnit, userTz?: string | null): LitDate {
  const tzName = hasTime(v) ? v.time_zone || zoneOrSystem(userTz).name : zoneOrSystem(userTz).name;
  const start = dateInterval(v, tzName).start;
  const res = start.plus({ [unit]: amount });
  const timeUnit = TIME_UNITS.has(unit);
  if ((v.type === 'date' || v.type === 'daterange') && !timeUnit) return dateFromMs(res.ts, tzName);
  return datetimeFromMs(res.ts, tzName);
}

/** dateBetween(a, b, unit) = trunc(a - b in unit) */
export function dateBetween(a: LitDate, b: LitDate, unit: DateUnit, userTz?: string | null): number {
  const x = dateInterval(a, userTz).start;
  const y = dateInterval(b, userTz).start;
  const d = Math.trunc(x.diff(y, unit));
  return d === 0 ? 0 : d; // avoid -0
}

/** Convert datetimes into the user zone so date-part accessors read user-local fields. */
export function toZone(v: LitDate, tz: string): LitDate {
  if (v.type === 'date' || v.type === 'daterange') return v;
  const i = dateInterval(v, tz);
  const z = zoneOrSystem(tz);
  const s = i.start.setZone(z);
  const out: LitDate = { type: 'datetime', start_date: s.toISODate(), start_time: s.toHHmm(), time_zone: z.name };
  if (v.type === 'datetimerange' && i.end) {
    const e = i.end.setZone(z);
    return { ...out, type: 'datetimerange', end_date: e.toISODate(), end_time: e.toHHmm() };
  }
  return out;
}

/** Date part accessors (minute/hour/day/date/week/month/year) read the start in the user zone. */
export function datePart(v: LitDate, part: 'minute' | 'hour' | 'weekday' | 'day' | 'week' | 'month' | 'year', userTz?: string | null): number {
  const tz = zoneOrSystem(userTz).name;
  const d = dateInterval(rangeStart(toZone(v, tz)), tz).start;
  switch (part) {
    case 'minute': return d.minute;
    case 'hour': return d.hour;
    case 'weekday': return d.weekday;
    case 'day': return d.day;
    case 'week': return d.weekNumber;
    case 'month': return d.month;
    default: return d.year;
  }
}

/** parseDate: ISO 8601 text -> date (midnight) or datetime in the user zone. */
export function parseISODate(text: string, userTz?: string | null): LitDate | undefined {
  const s = text.trim();
  if (/^\d{1,2}:\d{2}/.test(s) || /\d{2}-\d{4}/.test(s)) return undefined;
  const m = /^([+-]?\d{4,6})(?:-(\d{2})(?:-(\d{2}))?)?(?:[T ](\d{2})(?::?(\d{2})(?::?(\d{2})(?:[.,](\d{1,9}))?)?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i.exec(s);
  if (!m) return undefined;
  const year = Number(m[1]);
  const month = m[2] ? Number(m[2]) : 1;
  const day = m[3] ? Number(m[3]) : 1;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return undefined;
  const hour = m[4] ? Number(m[4]) : 0;
  const minute = m[5] ? Number(m[5]) : 0;
  const second = m[6] ? Number(m[6]) : 0;
  const ms = m[7] ? Math.round(Number('0.' + m[7]) * 1000) : 0;
  if (hour > 24 || minute > 59 || second > 59) return undefined;
  const user = zoneOrSystem(userTz);
  let dt: DT;
  if (m[8]) {
    const off = /^z$/i.test(m[8]) ? 0 : (m[8][0] === '-' ? -1 : 1) * (Number(m[8].slice(1, 3)) * 60 + Number(m[8].replace(':', '').slice(3, 5) || 0));
    const instant = utcFromWall({ year, month, day, hour, minute, second, millisecond: ms }) - off * 60000;
    dt = new DT(instant, user);
  } else dt = DT.fromWall({ year, month, day, hour, minute, second, millisecond: ms }, user);
  if (!dt.isValid) return undefined;
  if (dt.ts === dt.startOf('day').ts) return { type: 'date', start_date: dt.toISODate() };
  return { type: 'datetime', start_date: dt.toISODate(), start_time: dt.toHHmm(), time_zone: user.name };
}

// ---------------------------------------------------------------- formatting
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function monthName(m: number, short = false): string {
  const n = MONTHS[(m - 1 + 12) % 12];
  return short ? n.slice(0, 3) : n;
}

export function weekdayName(isoWeekday: number, style: 'long' | 'short' | 'min' = 'long'): string {
  const n = WEEKDAYS[(isoWeekday - 1 + 7) % 7];
  return style === 'long' ? n : style === 'short' ? n.slice(0, 3) : n.slice(0, 2);
}

export function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function hour12(h: number) {
  const x = h % 12;
  return x === 0 ? 12 : x;
}

function offsetString(mins: number, colon: boolean): string {
  const sign = mins < 0 ? '-' : '+';
  const a = Math.abs(mins);
  return `${sign}${pad(Math.floor(a / 60), 2)}${colon ? ':' : ''}${pad(a % 60, 2)}`;
}

/** US locale week number (moment "w") for en. */
function localeWeek(d: DT): number {
  // week containing Jan 1 is week 1; weeks start Sunday
  const jan1 = DT.fromWall({ year: d.year, month: 1, day: 1, hour: 0, minute: 0, second: 0, millisecond: 0 }, d.zone);
  const jan1Dow = jan1.weekday % 7; // Sun=0
  const day0 = d.ordinal - 1;
  return Math.floor((day0 + jan1Dow) / 7) + 1;
}

const MOMENT_TOKENS = /(\[[^[]*\])|(\\)?([Hh]mm(ss)?|Mo|MM?M?M?|Do|DDDo|DD?D?D?|ddd?d?|do?|w[o|w]?|W[o|W]?|Qo?|N{1,5}|YYYYYY|YYYYY|YYYY|YY|y{2,4}|yo?|gg(ggg?)?|GG(GGG?)?|e|E|a|A|hh?|HH?|kk?|mm?|ss?|S{1,9}|x|X|zz?|ZZ?|LTS|LT|LL?L?L?|l{1,4}|.)/g;

function zoneAbbr(d: DT): string {
  if (d.zone.kind === 'fixed') return d.zone.offset === 0 ? 'UTC' : `GMT${offsetString(d.zone.offset, false).replace(/^([+-])0?(\d+)00$/, '$1$2')}`;
  try {
    const p = new Intl.DateTimeFormat('en-US', { timeZone: d.zone.name, timeZoneName: 'short' }).formatToParts(new Date(d.ts)).find((x) => x.type === 'timeZoneName');
    return p?.value ?? d.zone.name;
  } catch {
    return d.zone.name;
  }
}

/** formatDate(date, format) with moment-style tokens (mapped onto luxon-style tokens). */
export function formatMoment(d: DT, fmt: string): string {
  if (!d.isValid) return '';
  let out = '';
  const tokens = fmt.match(MOMENT_TOKENS) ?? [];
  for (const t of tokens) {
    if (/^\[.*\]$/.test(t)) { out += t.slice(1, -1); continue; }
    switch (t) {
      case 'YYYY': out += pad(d.year, 4); break;
      case 'YY': out += pad(d.year % 100, 2); break;
      case 'Y': out += String(d.year); break;
      case 'YYYYYY': out += `+${String(d.year).padStart(6, '0')}`; break;
      case 'Q': out += String(d.quarter); break;
      case 'Qo': out += ordinalSuffix(d.quarter); break;
      case 'M': out += String(d.month); break;
      case 'Mo': out += ordinalSuffix(d.month); break;
      case 'MM': out += pad(d.month, 2); break;
      case 'MMM': out += monthName(d.month, true); break;
      case 'MMMM': out += monthName(d.month); break;
      case 'D': out += String(d.day); break;
      case 'Do': out += ordinalSuffix(d.day); break;
      case 'DD': out += pad(d.day, 2); break;
      case 'DDD': out += String(d.ordinal); break;
      case 'DDDo': out += ordinalSuffix(d.ordinal); break;
      case 'DDDD': out += pad(d.ordinal, 3); break;
      case 'd': case 'e': out += String(d.weekday % 7); break;
      case 'do': out += ordinalSuffix(d.weekday % 7); break;
      case 'dd': out += weekdayName(d.weekday, 'min'); break;
      case 'ddd': out += weekdayName(d.weekday, 'short'); break;
      case 'dddd': out += weekdayName(d.weekday); break;
      case 'E': out += String(d.weekday); break;
      case 'w': out += String(localeWeek(d)); break;
      case 'wo': out += ordinalSuffix(localeWeek(d)); break;
      case 'ww': out += pad(localeWeek(d), 2); break;
      case 'W': out += String(d.weekNumber); break;
      case 'Wo': out += ordinalSuffix(d.weekNumber); break;
      case 'WW': out += pad(d.weekNumber, 2); break;
      case 'gg': case 'GG': out += pad(d.weekYear % 100, 2); break;
      case 'gggg': case 'GGGG': out += pad(d.weekYear, 4); break;
      case 'A': out += d.hour < 12 ? 'AM' : 'PM'; break;
      case 'a': out += d.hour < 12 ? 'am' : 'pm'; break;
      case 'H': out += String(d.hour); break;
      case 'HH': out += pad(d.hour, 2); break;
      case 'h': out += String(hour12(d.hour)); break;
      case 'hh': out += pad(hour12(d.hour), 2); break;
      case 'k': out += d.hour === 0 ? '24' : String(d.hour); break;
      case 'kk': out += d.hour === 0 ? '24' : pad(d.hour, 2); break;
      case 'm': out += String(d.minute); break;
      case 'mm': out += pad(d.minute, 2); break;
      case 's': out += String(d.second); break;
      case 'ss': out += pad(d.second, 2); break;
      case 'S': out += String(Math.floor(d.millisecond / 100)); break;
      case 'SS': out += pad(Math.floor(d.millisecond / 10), 2); break;
      case 'SSS': out += pad(d.millisecond, 3); break;
      case 'Z': out += offsetString(d.offset, true); break;
      case 'ZZ': out += offsetString(d.offset, false); break;
      case 'z': case 'zz': out += zoneAbbr(d); break;
      case 'X': out += String(Math.floor(d.ts / 1000)); break;
      case 'x': out += String(d.ts); break;
      case 'LT': out += formatMoment(d, 'h:mm A'); break;
      case 'LTS': out += formatMoment(d, 'h:mm:ss A'); break;
      case 'L': out += formatMoment(d, 'MM/DD/YYYY'); break;
      case 'l': out += formatMoment(d, 'M/D/YYYY'); break;
      case 'LL': out += formatMoment(d, 'MMMM D, YYYY'); break;
      case 'll': out += formatMoment(d, 'MMM D, YYYY'); break;
      case 'LLL': out += formatMoment(d, 'MMMM D, YYYY h:mm A'); break;
      case 'lll': out += formatMoment(d, 'MMM D, YYYY h:mm A'); break;
      case 'LLLL': out += formatMoment(d, 'dddd, MMMM D, YYYY h:mm A'); break;
      case 'llll': out += formatMoment(d, 'ddd, MMM D, YYYY h:mm A'); break;
      default:
        if (/^S{4,9}$/.test(t)) out += pad(d.millisecond, 3);
        else out += t.replace(/\\/g, '');
    }
  }
  return out;
}

/** Date display formats stored on date properties. */
export const DATE_FORMATS = ['ll', 'MMM d', 'MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY/MM/DD', 'MMM DD, YYYY', 'relative'] as const;

function formatDay(d: DT, dateFormat: string | undefined, now: DT): string {
  switch (dateFormat) {
    case 'MMM d': return d.year === now.year ? `${monthName(d.month, true)} ${d.day}` : `${monthName(d.month, true)} ${d.day}, ${d.year}`;
    case 'MM/DD/YYYY': return formatMoment(d, 'MM/DD/YYYY');
    case 'DD/MM/YYYY': return formatMoment(d, 'DD/MM/YYYY');
    case 'YYYY/MM/DD': return formatMoment(d, 'YYYY/MM/DD');
    case 'MMM DD, YYYY': return formatMoment(d, 'MMM DD, YYYY');
    case 'relative': {
      const days = Math.round((Date.UTC(d.year, d.month - 1, d.day) - Date.UTC(now.year, now.month - 1, now.day)) / 864e5);
      if (days === 0) return 'Today';
      if (days === 1) return 'Tomorrow';
      if (days === -1) return 'Yesterday';
      if (days > 1 && days < 7) return weekdayName(d.weekday);
      if (days < -1 && days > -7) return `Last ${weekdayName(d.weekday)}`;
      return formatMoment(d, 'MMMM D, YYYY');
    }
    default: return formatMoment(d, 'MMMM D, YYYY');
  }
}

function formatTime(d: DT, timeFormat: string | undefined): string {
  if (timeFormat === ' ' || timeFormat === 'hidden') return '';
  if (timeFormat === 'H:mm') return formatMoment(d, 'H:mm');
  if (timeFormat === 'A h:mm') return formatMoment(d, 'A h:mm');
  return formatMoment(d, 'h:mm A');
}

/** Human display of a date value ("October 20, 2026 5:55 PM → 6:30 PM"). */
export function formatLitDate(v: LitDate, opts?: { dateFormat?: string; timeFormat?: string; tz?: string | null; nowMs?: number }): string {
  const iv = dateInterval(v, opts?.tz);
  if (!iv.start.isValid) return '';
  const now = new DT(opts?.nowMs ?? Date.now(), iv.start.zone);
  const one = (d: DT, withTime: boolean) => {
    const day = formatDay(d, opts?.dateFormat, now);
    const time = withTime ? formatTime(d, opts?.timeFormat) : '';
    return time ? `${day} ${time}` : day;
  };
  const timed = hasTime(v);
  if (!iv.end) return one(iv.start, timed);
  if (timed && iv.start.toISODate() === iv.end.toISODate()) {
    const t = formatTime(iv.end, opts?.timeFormat);
    return t ? `${one(iv.start, true)} → ${t}` : one(iv.start, true);
  }
  return `${one(iv.start, timed)} → ${one(iv.end, timed)}`;
}

/** Inclusive list of ISO day strings between two instants' wall dates (for calendar/timeline layout). */
export function isoDayOf(ms: number, tz?: string | null): string {
  return new DT(ms, zoneOrSystem(tz)).toISODate();
}

// Reminders.
// A reminder is a date annotation with `reminder` ({unit, value, time?}) in a block's rich text (@remind in page
// text) or in a database row's Date property. Every committed transaction re-syncs the reminders of the blocks it
// touched (records.ts onCommit): new or changed reminders get a scheduler job at their fire time, removed ones (or
// deleted blocks) lose theirs. Jobs are persisted (scheduler.ts), so reminders survive restarts.
//
// Time: the date's own time_zone if set, else the reminder owner's time zone (Settings › Preferences), so
// "9:00 AM" fires at 9:00 where the person is. "On day of event (9:00 AM)" / "1 day before (9:00 AM)" use the wall
// clock of that day; minute/hour offsets are absolute before the event.
// Who is notified: in page text, the people @mentioned in the same block (if they can see the page) — otherwise the
// person who set the reminder; database date reminders always notify the person who set them.
import { createHash } from 'node:crypto';
import type { BlockRecord, CollectionRecord, UserRecord } from '@nc/shared/records.ts';
import { toReadableText, type Annotation, type DateValue, type RichText } from '@nc/shared/richtext.ts';
import { db, getRecord } from './db.ts';
import { blockRole, onCommit, type CommitInfo } from './records.ts';
import { pageIdOf } from './search.ts';
import { cancelJob, getJob, listJobs, registerJobHandler, scheduleJob } from './scheduler.ts';
import { effectiveTimeZone, pushNotification } from './notify.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS reminder_log (
  key TEXT NOT NULL,
  fire_at INTEGER NOT NULL,
  fired_time INTEGER NOT NULL,
  PRIMARY KEY (key, fire_at)
);
`);

export interface FoundReminder {
  key: string;
  prop: string;
  date: DateValue;
}

const UNITS = new Set(['minute', 'hour', 'day', 'week']);
const PAST_GRACE_MS = 60_000;

type Reminder = NonNullable<DateValue['reminder']>;

function validReminder(r: unknown): r is Reminder {
  return !!r && typeof r === 'object' && UNITS.has(String((r as { unit?: string }).unit));
}

/** Date values with a reminder; `fallback` = the Date property's default notification (database columns). */
function dateAnnotations(rt: unknown, fallback?: Reminder): DateValue[] {
  const out: DateValue[] = [];
  if (!Array.isArray(rt)) return out;
  for (const d of rt as RichText) {
    const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as Annotation[]) : [];
    for (const a of anns) {
      if (a?.[0] !== 'd' || !a[1] || typeof a[1] !== 'object') continue;
      const v = a[1] as DateValue;
      if (typeof v.start_date !== 'string') continue;
      const own = v.reminder as unknown;
      if (validReminder(own)) out.push(v);
      else if (fallback && (own === undefined || own === null)) out.push({ ...v, reminder: fallback });
    }
  }
  return out;
}

/** Default reminders of a database's Date properties (Edit property › Notifications), by property id. */
function defaultReminders(block: BlockRecord): Record<string, Reminder> {
  if (block.parent_table !== 'collection') return {};
  const col = getRecord<CollectionRecord>('collection', block.parent_id);
  const out: Record<string, Reminder> = {};
  for (const [id, p] of Object.entries(col?.schema ?? {})) if (p?.type === 'date' && validReminder(p.default_reminder)) out[id] = p.default_reminder as Reminder;
  return out;
}

/** Reminders currently set in a block (all rich-text properties: title for text blocks, Date cells for rows). */
export function remindersIn(block: BlockRecord | undefined): FoundReminder[] {
  if (!block?.properties) return [];
  const out = new Map<string, FoundReminder>();
  const defaults = defaultReminders(block);
  for (const [prop, value] of Object.entries(block.properties)) {
    for (const date of dateAnnotations(value, defaults[prop])) {
      const sig = JSON.stringify([prop, date.start_date, date.start_time ?? null, date.time_zone ?? null, date.reminder!.unit, date.reminder!.value ?? 0, date.reminder!.time ?? null]);
      const key = `reminder:${block.id}:${createHash('sha1').update(sig).digest('hex').slice(0, 16)}`;
      out.set(key, { key, prop, date });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------- time zones
/** Offset (ms) of `tz` at instant `t`: wall clock in tz minus UTC. */
function tzOffset(t: number, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return wall - Math.floor(t / 1000) * 1000;
}

/** UTC instant of a wall-clock time in an IANA zone (DST gaps resolve forward, overlaps to the first instant). */
export function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  let zone = tz;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    zone = 'UTC';
  }
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let guess = naive - tzOffset(naive, zone);
  // second pass: the offset at the guessed instant (handles DST changes between naive and real time)
  guess = naive - tzOffset(guess, zone);
  return guess;
}

function parseDate(s: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function parseTime(s: string | undefined): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h < 24 && mi < 60 ? [h, mi] : null;
}

/** When a reminder fires (ms since epoch), or null for a malformed date. */
export function reminderFireTime(v: DateValue, ownerTz: string): number | null {
  const r = v.reminder;
  const ymd = parseDate(v.start_date);
  if (!r || !ymd) return null;
  const tz = v.time_zone || r.defaultTimeZone || ownerTz;
  const value = Math.max(0, Math.min(Number(r.value) || 0, 10_000));
  if (r.unit === 'minute' || r.unit === 'hour') {
    const hm = parseTime(v.start_time) ?? [0, 0];
    const event = zonedTimeToUtc(ymd[0], ymd[1], ymd[2], hm[0], hm[1], tz);
    return event - value * (r.unit === 'minute' ? 60_000 : 3_600_000);
  }
  // day / week: that many days before, at the reminder's wall-clock time (default 9:00 AM)
  const days = r.unit === 'week' ? value * 7 : value;
  const day = new Date(Date.UTC(ymd[0], ymd[1] - 1, ymd[2] - days));
  const hm = parseTime(r.time) ?? parseTime(v.start_time) ?? [9, 0];
  return zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hm[0], hm[1], tz);
}

const fired = db.prepare('SELECT 1 FROM reminder_log WHERE key = ? AND fire_at = ?');
const markFired = db.prepare('INSERT OR IGNORE INTO reminder_log (key, fire_at, fired_time) VALUES (?, ?, ?)');

interface ReminderPayload {
  blockId: string;
  key: string;
  ownerId: string;
  fireAt: number;
}

/** Re-sync the scheduler jobs of one block after it changed. `actorId` becomes the owner of new/changed reminders. */
export function syncBlockReminders(block: BlockRecord | undefined, prev: BlockRecord | undefined, actorId: string, now = Date.now()) {
  const id = block?.id ?? prev?.id;
  if (!id) return;
  const current = block && block.alive !== false ? remindersIn(block) : [];
  const keys = new Set(current.map((r) => r.key));
  // removed (or block deleted): drop their jobs
  for (const r of remindersIn(prev)) if (!keys.has(r.key)) cancelJob(r.key);
  if (block?.alive === false) for (const j of listJobs(`reminder:${id}:`)) cancelJob(j.key);
  for (const r of current) {
    const existing = getJob(r.key);
    const owner = (existing?.payload as ReminderPayload | undefined)?.ownerId ?? actorId;
    const fireAt = reminderFireTime(r.date, effectiveTimeZone(owner));
    if (fireAt == null) continue;
    if (existing && existing.runAt === fireAt) continue;
    if (fired.get(r.key, fireAt)) continue; // already delivered
    if (fireAt < now - PAST_GRACE_MS) {
      if (existing) cancelJob(r.key);
      continue; // a reminder set in the past shows red and never fires
    }
    scheduleJob('reminder', r.key, fireAt, { blockId: id, key: r.key, ownerId: owner, fireAt } satisfies ReminderPayload);
  }
}

function mentionedUsers(rt: unknown): string[] {
  const out = new Set<string>();
  if (!Array.isArray(rt)) return [];
  for (const d of rt as RichText) for (const a of (Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as Annotation[]) : [])) if (a?.[0] === 'u' && a[1]) out.add(String(a[1]));
  return [...out];
}

function readable(rt: unknown, max = 300): string {
  return toReadableText(rt as RichText | undefined, (a) => {
    if (a[0] === 'u') return `@${getRecord<UserRecord>('lit_user', String(a[1]))?.name || 'Unknown user'}`;
    if (a[0] === 'p') return toReadableText(getRecord<BlockRecord>('block', String(a[1]))?.properties?.title as RichText | undefined) || 'Untitled';
    if (a[0] === 'd') return dateText(a[1] as DateValue);
    return '';
  }).slice(0, max);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function dateText(v: DateValue | undefined): string {
  const ymd = v ? parseDate(v.start_date) : null;
  if (!v || !ymd) return '';
  let s = `${MONTHS[ymd[1] - 1]} ${ymd[2]}, ${ymd[0]}`;
  const hm = parseTime(v.start_time);
  if (hm) s += ` ${hm[0] % 12 === 0 ? 12 : hm[0] % 12}:${String(hm[1]).padStart(2, '0')} ${hm[0] >= 12 ? 'PM' : 'AM'}`;
  return s;
}

/** The page (or row) a block lives on, unless it or any ancestor page is in Trash. */
function livePageOf(block: BlockRecord): BlockRecord | undefined {
  let cur: BlockRecord | undefined = block;
  for (let i = 0; i < 60 && cur; i++) {
    if (cur.alive === false) return undefined;
    if (cur.parent_table !== 'block') break;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  return getRecord<BlockRecord>('block', pageIdOf(block));
}

export function fireReminder(p: ReminderPayload): number {
  const block = getRecord<BlockRecord>('block', p.blockId);
  if (!block || block.alive === false) return 0;
  const r = remindersIn(block).find((x) => x.key === p.key);
  if (!r) return 0;
  const page = livePageOf(block);
  if (!page) return 0;
  markFired.run(p.key, p.fireAt, Date.now());
  const isRow = block.parent_table === 'collection';
  const owner = getRecord<UserRecord>('lit_user', p.ownerId) ? p.ownerId : block.last_edited_by_id;
  // @mention + @remind in the same block reminds those people (page text only)
  let recipients = isRow ? [] : mentionedUsers(block.properties?.[r.prop]).filter((u) => getRecord('lit_user', u));
  if (!recipients.length) recipients = [owner];
  let propName: string | undefined;
  if (isRow) {
    const col = getRecord<CollectionRecord>('collection', block.parent_id);
    propName = col?.schema?.[r.prop]?.name;
  }
  let n = 0;
  for (const uid of new Set(recipients)) {
    if (!uid || blockRole(block.id, uid) === 'none') continue;
    pushNotification({
      user_id: uid, space_id: block.space_id, type: 'reminder', navigable_block_id: block.id, actor_id: owner,
      activity: {
        page_id: page.id, kind: 'reminder', reminder_key: p.key, property: r.prop, property_name: propName,
        text: isRow ? undefined : readable(block.properties?.[r.prop]), date: r.date, date_text: dateText(r.date),
      },
    });
    n++;
  }
  return n;
}

registerJobHandler('reminder', (payload: ReminderPayload) => {
  if (payload?.blockId && payload.key) fireReminder(payload);
});

/** A Date property's default notification changed: re-sync every row of that database. */
function syncCollectionDefaults(col: CollectionRecord, prev: CollectionRecord | undefined, actorId: string, now: number) {
  const sig = (c: CollectionRecord | undefined) => JSON.stringify(Object.entries(c?.schema ?? {}).filter(([, p]) => p?.type === 'date' && p.default_reminder).map(([k, p]) => [k, p.default_reminder]));
  if (sig(col) === sig(prev)) return;
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND parent_id = ? AND alive = 1 LIMIT 5000`).all(col.id) as { data: string }[];
  for (const r of rows) {
    const row = JSON.parse(r.data) as BlockRecord;
    if (row.parent_table !== 'collection') continue;
    const current = new Set(remindersIn(row).map((x) => x.key));
    for (const j of listJobs(`reminder:${row.id}:`)) if (!current.has(j.key)) cancelJob(j.key);
    syncBlockReminders(row, undefined, actorId, now);
  }
}

onCommit((info: CommitInfo) => {
  const now = Date.now();
  for (const ch of info.changes) {
    if (ch.table === 'collection') {
      try {
        syncCollectionDefaults(ch.record as CollectionRecord, info.prev.get(`collection:${ch.record.id}`) as CollectionRecord | undefined, info.userId, now);
      } catch (e) {
        console.error('[reminders] database sync failed', e);
      }
      continue;
    }
    if (ch.table !== 'block') continue;
    const b = ch.record as BlockRecord;
    const prev = info.prev.get(`block:${b.id}`) as BlockRecord | undefined;
    // cheap filter: only blocks that hold (or held) a reminder
    const has = (x: BlockRecord | undefined) => !!x?.properties && JSON.stringify(x.properties).includes('"reminder"');
    const rowDefaults = b.parent_table === 'collection' && Object.keys(defaultReminders(b)).length > 0;
    if (!has(b) && !has(prev) && !rowDefaults) continue;
    try {
      syncBlockReminders(b, prev, info.userId, now);
    } catch (e) {
      console.error('[reminders] sync failed', e);
    }
  }
});

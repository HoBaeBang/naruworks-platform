// AI Meeting Notes block on the server: block structure, transcription state machine, transcript storage,
// usage limits, transcript / audio deletion.
//
// Record shape (section ids in format.transcription_{notes,summary,transcript}_id, state in transcription_state):
// meeting_notes block properties.title = meeting title; content = [summary, notes, transcript] section blocks
// format.transcription_state = { state, transcriber_id, session_id, started_time, stopped_time, elapsed_ms, language,
// error?, transcript_deleted?, audio? }
// format.meeting_instructions = 'auto' | built-in key | instructions page id; format.meeting_language = 'auto' | code
// section blocks: type 'text' without a title, format.meeting_section 'summary' | 'notes' | 'transcript'
// notes → the person's own blocks (editable)
// summary → AI service's summary (editable; citations are links "#mtg-cite-<transcript line id>")
// transcript → one 'text' block per speaker run: format.meeting_speaker / meeting_speaker_id / meeting_start_ms /
// meeting_end_ms (ms since the recording started)
// Every write is an ordinary transaction as the acting person (permission checks, realtime, history). Only someone who
// can edit the page transcribes; one person transcribes at a time ("{name} is transcribing").
import { newId } from '@nc/shared/ids.ts';
import { op as mk, type Operation } from '@nc/shared/ops.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../db.ts';
import { applyTransactions, blockRole } from '../records.ts';
import { audit } from '../audit.ts';
import { pageIdOf } from '../search.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS meeting_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
`);

export const MEETING_TYPES = new Set(['meeting_notes', 'transcription']);
export type Section = 'summary' | 'notes' | 'transcript';
export const SECTIONS: Section[] = ['summary', 'notes', 'transcript'];
const SECTION_KEY: Record<Section, string> = { summary: 'transcription_summary_id', notes: 'transcription_notes_id', transcript: 'transcription_transcript_id' };

export type MeetingStateName = 'notes_ready' | 'transcribing' | 'paused' | 'summarizing' | 'summary_ready' | 'transcript_ready' | 'error';

export interface MeetingState {
  state: MeetingStateName;
  transcriber_id?: string;
  session_id?: string;
  started_time?: number;
  stopped_time?: number;
  /** recording time so far (ms), across pauses */
  elapsed_ms?: number;
  /** when the current run of recording (since start / resume) began */
  resumed_time?: number;
  language?: string;
  error?: { code: string; message: string; time: number };
  transcript_deleted?: { time: number; by: 'user' | 'policy' };
  audio?: { file_id: string; name: string; mime: string; size: number; status: 'uploaded' | 'transcribing' | 'failed' | 'deleted'; time: number };
  summary_time?: number;
  /** what Start / Resume replace — put back when the browser can't capture anything (cancelTranscription) */
  before?: { state: MeetingStateName; transcriber_id?: string; started_time?: number; stopped_time?: number; elapsed_ms?: number };
}

export class MeetingError extends Error {
  status: number;
  code: string;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

/** Default 10 hours of transcription per person per day. */
export function dailyLimitMs(): number {
  const v = Number(process.env.NC_MEETING_DAILY_LIMIT_MS);
  return Number.isFinite(v) && v > 0 ? v : 10 * 3600_000;
}

function today(t = Date.now()): string {
  return new Date(t).toISOString().slice(0, 10);
}

export function usedTodayMs(userId: string): number {
  return (db.prepare('SELECT ms FROM meeting_usage WHERE user_id = ? AND day = ?').get(userId, today()) as { ms: number } | undefined)?.ms ?? 0;
}

function addUsage(userId: string, ms: number) {
  if (ms <= 0) return;
  db.prepare('INSERT INTO meeting_usage (user_id, day, ms) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET ms = ms + excluded.ms').run(userId, today(), Math.round(ms));
}

/** ms until the daily allowance resets (UTC midnight). */
export function msUntilReset(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime();
}

export function spaceSetting<T>(space: SpaceRecord | undefined, key: string, fallback: T): T {
  const v = (space?.settings as Record<string, unknown> | undefined)?.[key];
  return v === undefined || v === null ? fallback : (v as T);
}

/** Settings › Meeting notes › Enable Meeting notes for workspace (default on). */
export function meetingsEnabled(spaceId: string): boolean {
  return spaceSetting<boolean>(getRecord<SpaceRecord>('space', spaceId), 'meeting_notes_enabled', true) !== false;
}

export function meetingBlock(blockId: unknown): BlockRecord {
  const b = getRecord<BlockRecord>('block', String(blockId ?? ''));
  if (!b || b.alive === false || !MEETING_TYPES.has(b.type)) throw new MeetingError('not_found', 'This meeting note no longer exists.', 404);
  return b;
}

export function stateOf(b: BlockRecord): MeetingState {
  const s = (b.format as Record<string, unknown> | undefined)?.transcription_state as MeetingState | undefined;
  return s && typeof s === 'object' && typeof s.state === 'string' ? s : { state: 'notes_ready' };
}

export function sectionId(b: BlockRecord, s: Section): string | undefined {
  const v = (b.format as Record<string, unknown> | undefined)?.[SECTION_KEY[s]];
  return typeof v === 'string' ? v : undefined;
}

export function canRead(b: BlockRecord, userId: string): boolean {
  return blockRole(b.id, userId) !== 'none';
}

/** Transcribing, summarizing and deleting need edit access to the page. */
export function assertCanEdit(b: BlockRecord, userId: string) {
  if (!canRead(b, userId)) throw new MeetingError('not_found', 'This meeting note no longer exists.', 404);
  if (!roleAtLeast(blockRole(b.id, userId), 'read_and_write')) throw new MeetingError('forbidden', 'You do not have access to transcribe this recording', 403);
}

export function assertEnabled(b: BlockRecord) {
  if (!meetingsEnabled(b.space_id)) throw new MeetingError('disabled', 'AI meeting notes are unavailable in this workspace', 403);
}

/** Blocks inside a template page can't be transcribed. */
export function assertNotTemplate(b: BlockRecord) {
  let cur: BlockRecord | undefined = b;
  for (let i = 0; i < 100 && cur; i++) {
    if (cur.is_template) throw new MeetingError('template', 'You cannot start transcription inside a template', 400);
    if (cur.parent_table !== 'block') break;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
}

export function apply(userId: string, b: BlockRecord, ops: Operation[], action: string, source = 'meeting_notes') {
  if (!ops.length) return [];
  try {
    return applyTransactions(userId, [{ id: newId(), spaceId: b.space_id, debug: { userAction: `meetingNotes.${action}` }, operations: ops }], undefined, { client: true, source });
  } catch (e) {
    const status = (e as { status?: number })?.status ?? 400;
    throw new MeetingError(status === 403 ? 'forbidden' : 'bad_request', status === 403 ? 'You do not have access to transcribe this recording' : 'The meeting note couldn’t be updated.', status);
  }
}

const ptr = (b: { id: string; space_id: string }) => ({ table: 'block' as const, id: b.id, spaceId: b.space_id });

function meta(userId: string, spaceId: string, now: number) {
  return {
    space_id: spaceId, alive: true, created_time: now, created_by_id: userId, created_by_table: 'lit_user',
    last_edited_time: now, last_edited_by_id: userId, last_edited_by_table: 'lit_user',
  };
}

/**
 * Make sure the block has its three sections (idempotent; requests are serialized so two clients can't create two sets).
 * Legacy blocks whose notes were direct children keep them: they move into the Notes section.
 */
export function ensureStructure(b0: BlockRecord, userId: string): BlockRecord {
  const b = getRecord<BlockRecord>('block', b0.id) ?? b0;
  const missing = SECTIONS.filter((s) => {
    const id = sectionId(b, s);
    const rec = id ? getRecord<BlockRecord>('block', id) : undefined;
    return !rec || rec.parent_id !== b.id;
  });
  if (!missing.length) return b;
  if (!roleAtLeast(blockRole(b.id, userId), 'read_and_write')) return b;
  const now = Date.now();
  const ops: Operation[] = [];
  const fmt: Record<string, string> = {};
  const legacy = (b.content ?? []).filter((id) => {
    const c = getRecord<BlockRecord>('block', id);
    return !!c && c.alive !== false && !(c.format as Record<string, unknown> | undefined)?.meeting_section;
  });
  for (const s of missing) {
    const id = newId();
    fmt[SECTION_KEY[s]] = id;
    const children = s === 'notes' ? legacy : [];
    ops.push(mk.set({ table: 'block', id, spaceId: b.space_id }, [], {
      // untitled: the block draws the section (tab); exports and the API label it from format.meeting_section
      id, type: 'text', format: { meeting_section: s }, parent_id: b.id, parent_table: 'block',
      ...(children.length ? { content: children } : {}), ...meta(userId, b.space_id, now),
    }));
    for (const c of children) {
      ops.push(mk.listRemove(ptr(b), ['content'], c));
      ops.push(mk.update({ table: 'block', id: c, spaceId: b.space_id }, [], { parent_id: id, parent_table: 'block' }));
    }
  }
  // section order: Summary, Notes, Transcript (after anything else that is still a direct child)
  for (const s of SECTIONS) {
    const id = fmt[SECTION_KEY[s]];
    if (id) ops.push(mk.listAfter(ptr(b), ['content'], id));
  }
  ops.push(mk.update(ptr(b), ['format'], fmt));
  apply(userId, b, ops, 'ensureStructure');
  return getRecord<BlockRecord>('block', b.id)!;
}

function setState(userId: string, b: BlockRecord, next: MeetingState, extra: Operation[] = [], action = 'state') {
  apply(userId, b, [...extra, mk.update(ptr(b), ['format'], { transcription_state: next })], action);
}

function speakerLabel(userId: string): string {
  const u = getRecord<UserRecord>('lit_user', userId);
  const name = (u?.name || u?.email || 'Someone').trim();
  return `${name}’s microphone`;
}

/** "Start transcribing" (also used by Resume): this person becomes the transcriber. */
export function startTranscription(blockId: unknown, userId: string, opts: { language?: unknown; consent?: unknown; resume?: boolean } = {}) {
  let b = meetingBlock(blockId);
  assertEnabled(b);
  assertCanEdit(b, userId);
  assertNotTemplate(b);
  if (opts.consent !== true) throw new MeetingError('consent', 'By starting, you confirm that everyone being transcribed has agreed.', 400);
  const st = stateOf(b);
  if ((st.state === 'transcribing') && st.transcriber_id && st.transcriber_id !== userId) {
    const who = getRecord<UserRecord>('lit_user', st.transcriber_id)?.name || 'Someone';
    throw new MeetingError('busy', `${who} is currently transcribing this meeting`, 409);
  }
  if (usedTodayMs(userId) >= dailyLimitMs()) {
    throw new MeetingError('rate_limited', 'You have used all of today’s transcription time', 429);
  }
  b = ensureStructure(b, userId);
  const now = Date.now();
  const lang = typeof opts.language === 'string' && /^[a-zA-Z-]{2,12}$/.test(opts.language) ? opts.language : st.language;
  const resuming = opts.resume || st.state === 'paused' || ((st.elapsed_ms ?? 0) > 0 && st.state !== 'notes_ready');
  const next: MeetingState = {
    ...st, state: 'transcribing', transcriber_id: userId, session_id: newId(), resumed_time: now,
    started_time: resuming && st.started_time ? st.started_time : now, elapsed_ms: resuming ? st.elapsed_ms ?? 0 : 0,
    ...(lang ? { language: lang } : {}), error: undefined,
    before: st.state === 'transcribing' && st.before ? st.before : { state: st.state, transcriber_id: st.transcriber_id, started_time: st.started_time, stopped_time: st.stopped_time, elapsed_ms: st.elapsed_ms },
  };
  delete next.stopped_time;
  setState(userId, b, next, [], resuming ? 'resume' : 'start');
  const page = pageIdOf(b);
  audit('meeting_notes_consent_confirmed', { spaceId: b.space_id, actorId: userId, targetId: page, data: { blockId: b.id } });
  return { block: getRecord<BlockRecord>('block', b.id)!, sessionId: next.session_id!, usedMs: usedTodayMs(userId), limitMs: dailyLimitMs() };
}

function assertSession(b: BlockRecord, userId: string, sessionId: unknown): MeetingState {
  const st = stateOf(b);
  if (st.state !== 'transcribing' || st.transcriber_id !== userId || st.session_id !== sessionId) {
    throw new MeetingError('stale_session', 'This transcription session has ended.', 409);
  }
  return st;
}

export interface SegmentInput {
  text: string;
  /** ms since the recording started (client clock) */
  startMs?: number;
  endMs?: number;
  speaker?: string;
}

const MAX_RUN_CHARS = 1200;
const RUN_GAP_MS = 120_000;

/** Final speech results → transcript lines (speaker runs: consecutive text of one speaker joins one line). */
export function appendSegments(blockId: unknown, userId: string, sessionId: unknown, raw: unknown) {
  const b = meetingBlock(blockId);
  assertEnabled(b);
  assertCanEdit(b, userId);
  const st = assertSession(b, userId, sessionId);
  const segments: SegmentInput[] = (Array.isArray(raw) ? raw : []).slice(0, 50).map((s) => ({
    text: String((s as SegmentInput)?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000),
    startMs: Number.isFinite((s as SegmentInput)?.startMs) ? Math.max(0, Number((s as SegmentInput).startMs)) : undefined,
    endMs: Number.isFinite((s as SegmentInput)?.endMs) ? Math.max(0, Number((s as SegmentInput).endMs)) : undefined,
    speaker: typeof (s as SegmentInput)?.speaker === 'string' && (s as SegmentInput).speaker!.trim() ? (s as SegmentInput).speaker!.trim().slice(0, 80) : undefined,
  })).filter((s) => s.text);
  const now = Date.now();
  // usage: wall clock since the last append / resume (bounded), charged even for silence
  const since = Math.min(Math.max(0, now - (st.resumed_time ?? now)), 5 * 60_000);
  addUsage(userId, since);
  const elapsed = (st.elapsed_ms ?? 0) + since;
  const over = usedTodayMs(userId) >= dailyLimitMs();
  const tid = sectionId(b, 'transcript');
  const transcript = tid ? getRecord<BlockRecord>('block', tid) : undefined;
  const ops: Operation[] = [];
  if (transcript && segments.length) {
    const defaultSpeaker = speakerLabel(userId);
    const lastId = (transcript.content ?? []).filter((id) => getRecord<BlockRecord>('block', id)?.alive !== false).slice(-1)[0];
    let last = lastId ? getRecord<BlockRecord>('block', lastId) : undefined;
    let lastText = last ? ((last.properties?.title ?? []) as RichText).map((d) => d[0]).join('') : '';
    let pendingNew: { id: string; speaker: string; start: number; end: number; text: string } | null = null;
    const flushNew = () => {
      if (!pendingNew) return;
      ops.push(mk.set({ table: 'block', id: pendingNew.id, spaceId: b.space_id }, [], {
        id: pendingNew.id, type: 'text', properties: { title: [[pendingNew.text]] },
        format: { meeting_speaker: pendingNew.speaker, meeting_speaker_id: userId, meeting_start_ms: pendingNew.start, meeting_end_ms: pendingNew.end },
        parent_id: transcript.id, parent_table: 'block', ...meta(userId, b.space_id, now),
      }));
      ops.push(mk.listAfter({ table: 'block', id: transcript.id, spaceId: b.space_id }, ['content'], pendingNew.id));
      pendingNew = null;
    };
    for (const s of segments) {
      const speaker = s.speaker ?? defaultSpeaker;
      const start = s.startMs ?? elapsed;
      const end = s.endMs ?? start;
      if (pendingNew && pendingNew.speaker === speaker && pendingNew.text.length + s.text.length < MAX_RUN_CHARS) {
        pendingNew.text = `${pendingNew.text} ${s.text}`;
        pendingNew.end = end;
        continue;
      }
      const lf = (last?.format ?? {}) as Record<string, unknown>;
      if (!pendingNew && last && lf.meeting_speaker === speaker && lastText.length + s.text.length < MAX_RUN_CHARS && start - Number(lf.meeting_end_ms ?? 0) < RUN_GAP_MS) {
        lastText = `${lastText} ${s.text}`;
        ops.push(mk.set(ptr(last), ['properties', 'title'], [[lastText]]));
        ops.push(mk.update(ptr(last), ['format'], { meeting_end_ms: end }));
        last = { ...last, format: { ...lf, meeting_end_ms: end } } as BlockRecord;
        continue;
      }
      flushNew();
      pendingNew = { id: newId(), speaker, start, end, text: s.text };
      last = undefined;
    }
    flushNew();
  }
  const next: MeetingState = { ...st, elapsed_ms: elapsed, resumed_time: now };
  if (over) {
    next.state = 'paused';
    next.error = { code: 'rate_limited', message: 'You have used all of today’s transcription time', time: now };
  }
  setState(userId, b, next, ops, 'appendTranscript');
  if (over) throw new MeetingError('rate_limited', 'You have used all of today’s transcription time', 429);
  return { block: getRecord<BlockRecord>('block', b.id)!, usedMs: usedTodayMs(userId), limitMs: dailyLimitMs() };
}

export function pauseTranscription(blockId: unknown, userId: string, sessionId: unknown) {
  const b = meetingBlock(blockId);
  assertCanEdit(b, userId);
  const st = assertSession(b, userId, sessionId);
  const now = Date.now();
  const since = Math.min(Math.max(0, now - (st.resumed_time ?? now)), 5 * 60_000);
  addUsage(userId, since);
  setState(userId, b, { ...st, state: 'paused', elapsed_ms: (st.elapsed_ms ?? 0) + since, resumed_time: undefined }, [], 'pause');
  return { block: getRecord<BlockRecord>('block', b.id)! };
}

/** The browser couldn't capture anything right after Start / Resume (microphone blocked or missing, language not
 * supported): the start is undone instead of leaving an empty paused session. When lines did arrive in this run it
 * behaves like Pause. Not charged against the daily limit when nothing was captured. */
export function cancelTranscription(blockId: unknown, userId: string, sessionId: unknown): BlockRecord {
  const b = meetingBlock(blockId);
  assertCanEdit(b, userId);
  const st = assertSession(b, userId, sessionId);
  const prev = st.before;
  if (!prev || (st.elapsed_ms ?? 0) > (prev.elapsed_ms ?? 0)) return pauseTranscription(blockId, userId, sessionId).block;
  const next: MeetingState = {
    ...st, state: prev.state === 'transcribing' ? 'paused' : prev.state, transcriber_id: prev.transcriber_id, started_time: prev.started_time,
    stopped_time: prev.stopped_time, elapsed_ms: prev.elapsed_ms, session_id: undefined, resumed_time: undefined, before: undefined,
  };
  setState(userId, b, next, [], 'cancel');
  return getRecord<BlockRecord>('block', b.id)!;
}

/** Stop: recording ends; the summary follows (summary.ts). Anyone who can edit may stop a paused note. */
export function stopTranscription(blockId: unknown, userId: string, sessionId: unknown): BlockRecord {
  const b = meetingBlock(blockId);
  assertCanEdit(b, userId);
  const st = stateOf(b);
  // the transcriber stops from any tab (after a reload the browser session is gone); others wait for them
  if (st.state === 'transcribing') {
    if (st.transcriber_id !== userId) throw new MeetingError('busy', `${getRecord<UserRecord>('lit_user', st.transcriber_id ?? '')?.name || 'Someone'} is currently transcribing this meeting`, 409);
    void sessionId;
  } else if (st.state !== 'paused') throw new MeetingError('not_recording', 'This meeting isn’t being transcribed.', 409);
  const now = Date.now();
  const since = st.state === 'transcribing' ? Math.min(Math.max(0, now - (st.resumed_time ?? now)), 5 * 60_000) : 0;
  addUsage(st.transcriber_id ?? userId, since);
  setState(userId, b, { ...st, state: 'transcript_ready', stopped_time: now, elapsed_ms: (st.elapsed_ms ?? 0) + since, resumed_time: undefined, session_id: undefined, error: undefined }, [], 'stop');
  return getRecord<BlockRecord>('block', b.id)!;
}

/** Transcript lines (alive, in order) of a meeting block. */
export function transcriptRuns(b: BlockRecord): BlockRecord[] {
  const tid = sectionId(b, 'transcript');
  const t = tid ? getRecord<BlockRecord>('block', tid) : undefined;
  return (t?.content ?? []).map((id) => getRecord<BlockRecord>('block', id)).filter((x): x is BlockRecord => !!x && x.alive !== false && x.parent_id === t!.id);
}

export function transcriptText(b: BlockRecord): string {
  return transcriptRuns(b).map((r) => ((r.properties?.title ?? []) as RichText).map((d) => d[0]).join('')).join('\n');
}

/** Version history entries (any page of the workspace — the meeting may have moved) that hold lines of this transcript. */
function snapshotsWithTranscript(b: BlockRecord, transcriptId: string): string[] {
  const out: string[] = [];
  const rows = db.prepare('SELECT id, data FROM snapshots WHERE space_id = ? AND data LIKE ?').all(b.space_id, `%"${transcriptId}"%`) as { id: string; data: string }[];
  for (const r of rows) {
    try {
      const blocks = (JSON.parse(r.data)?.blocks ?? []) as { parent_id?: string }[];
      if (blocks.some((x) => x?.parent_id === transcriptId)) out.push(r.id);
    } catch {
      /* unreadable entry: left alone */
    }
  }
  return out;
}

/**
 * "Delete transcript": the lines go for good (text cleared, not just moved out of the page) and so do the version history
 * entries that hold them; entries from before the
 * transcript existed stay. Wiping history is a page-owner action: Full access (the retention policy runs as the
 * workspace). Nothing happens without a transcript.
 */
export function deleteTranscript(blockId: unknown, userId: string, by: 'user' | 'policy' = 'user'): BlockRecord {
  const b = meetingBlock(blockId);
  if (by === 'user') {
    assertCanEdit(b, userId);
    if (!roleAtLeast(blockRole(b.id, userId), 'editor')) throw new MeetingError('forbidden', 'You need full access to this page to delete its transcript.', 403);
  }
  const st = stateOf(b);
  if (st.state === 'transcribing') throw new MeetingError('busy', 'Stop transcribing before deleting the transcript.', 409);
  const tid = sectionId(b, 'transcript');
  const runs = transcriptRuns(b);
  if (!tid || (!runs.length && !snapshotsWithTranscript(b, tid).length)) throw new MeetingError('no_transcript', 'This meeting note has no transcript.', 400);
  const now = Date.now();
  const ops: Operation[] = [];
  for (const r of runs) {
    ops.push(mk.listRemove({ table: 'block', id: tid, spaceId: b.space_id }, ['content'], r.id));
    ops.push(mk.update(ptr(r), [], { alive: false, deleted_time: now, deleted_by_id: userId, properties: { title: [] } }));
  }
  const next: MeetingState = { ...st, transcript_deleted: { time: now, by } };
  setState(userId, b, next, ops, 'deleteTranscript');
  // then the version history entries holding the transcript
  const del = db.prepare('DELETE FROM snapshots WHERE id = ?');
  for (const id of snapshotsWithTranscript(b, tid)) del.run(id);
  return getRecord<BlockRecord>('block', b.id)!;
}

export function isMember(spaceId: string, userId: string): boolean {
  return isSpaceMember(getRecord<SpaceRecord>('space', spaceId), userId);
}

export function recordState(userId: string, b: BlockRecord, patch: Partial<MeetingState>, action: string, extra: Operation[] = []) {
  setState(userId, b, { ...stateOf(b), ...patch }, extra, action);
}

/** Segments from an uploaded recording (speech-to-text provider) → transcript lines, replacing the earlier ones. */
export function importSegments(blockId: string, userId: string, raw: SegmentInput[]) {
  const b = meetingBlock(blockId);
  assertCanEdit(b, userId);
  const tid = sectionId(b, 'transcript');
  if (!tid) throw new MeetingError('bad_request', 'This meeting note has no transcript section.', 400);
  const now = Date.now();
  const ops: Operation[] = [];
  for (const r of transcriptRuns(b)) {
    ops.push(mk.listRemove({ table: 'block', id: tid, spaceId: b.space_id }, ['content'], r.id));
    ops.push(mk.update(ptr(r), [], { alive: false, deleted_time: now, deleted_by_id: userId }));
  }
  let prev: string | undefined;
  for (const s of raw.slice(0, 5000)) {
    const text = String(s?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000);
    if (!text) continue;
    const id = newId();
    const start = Math.max(0, Number(s.startMs) || 0);
    ops.push(mk.set({ table: 'block', id, spaceId: b.space_id }, [], {
      id, type: 'text', properties: { title: [[text]] },
      format: { meeting_speaker: (typeof s.speaker === 'string' && s.speaker.trim()) ? s.speaker.trim().slice(0, 80) : 'Speaker 1', meeting_start_ms: start, meeting_end_ms: Math.max(start, Number(s.endMs) || start) },
      parent_id: tid, parent_table: 'block', ...meta(userId, b.space_id, now),
    }));
    ops.push(mk.listAfter({ table: 'block', id: tid, spaceId: b.space_id }, ['content'], id, prev));
    prev = id;
  }
  apply(userId, b, ops, 'importTranscript');
}

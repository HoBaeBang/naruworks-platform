// Uploaded meeting audio and transcript retention.
// - "Upload audio": AAC, M4A, MP3 or WAV (not video) uploaded through /api/upload, then transcribed by a
// speech-to-text provider. Providers plug in with registerSttProvider; this build ships none and never calls an
// outside service, so without one the block shows the "This recording couldn’t be transcribed." state.
// - Audio is processing material, not content: deleted after a successful transcription, kept at most 3 days after
// a failure, or right away with "Delete audio".
// - Automatic transcript deletion (Enterprise, Settings › Meeting notes): a daily job deletes transcripts older than
// the chosen number of days ("Transcript was deleted … according to your workspace’s automatic transcript deletion
// policy").
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { db, getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { fileRow } from '../content/files.ts';
import { registerJobHandler, scheduleJob, getJob, cancelJob } from '../scheduler.ts';
import {
  MeetingError, assertCanEdit, assertEnabled, assertNotTemplate, deleteTranscript, ensureStructure, importSegments, meetingBlock, recordState, spaceSetting,
  stateOf, transcriptRuns, type SegmentInput,
} from './model.ts';

export interface SttProvider {
  id: string;
  label: string;
  /** audio bytes → timed segments (speaker labels when the provider separates speakers) */
  transcribe(input: { data: Buffer; mime: string; name: string; language?: string }): Promise<{ segments: SegmentInput[] }>;
}

const providers = new Map<string, SttProvider>();

export function registerSttProvider(p: SttProvider) {
  providers.set(p.id, p);
}

/** NC_STT_PROVIDER picks a registered provider; none is configured by default. */
export function sttProvider(): SttProvider | null {
  const id = process.env.NC_STT_PROVIDER?.trim();
  if (id) return providers.get(id) ?? null;
  return providers.size === 1 ? [...providers.values()][0] : null;
}

export const AUDIO_TYPES: Record<string, string> = {
  'audio/aac': 'AAC', 'audio/x-aac': 'AAC', 'audio/mp4': 'M4A', 'audio/m4a': 'M4A', 'audio/x-m4a': 'M4A', 'audio/mpeg': 'MP3', 'audio/mp3': 'MP3',
  'audio/wav': 'WAV', 'audio/x-wav': 'WAV', 'audio/wave': 'WAV', 'audio/vnd.wave': 'WAV',
};
const EXT_TYPES: Record<string, string> = { aac: 'audio/aac', m4a: 'audio/mp4', mp3: 'audio/mpeg', wav: 'audio/wav' };
export const ALLOWED_LABEL = 'AAC, M4A, MP3 or WAV';
const KEEP_FAILED_MS = 3 * 86_400_000;

function audioMime(name: string, mime: string): string | null {
  if (AUDIO_TYPES[mime]) return mime;
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
  return EXT_TYPES[ext] ?? null;
}

function removeFile(fileId: string) {
  const row = fileRow(fileId);
  if (!row) return;
  try {
    if (existsSync(row.path)) unlinkSync(row.path);
  } catch {
    /* already gone */
  }
  db.prepare('DELETE FROM files WHERE id = ?').run(fileId);
  db.prepare('DELETE FROM meeting_audio WHERE file_id = ?').run(fileId);
}

// Which uploads are a meeting's audio: written by uploadAudio (the uploader's own file, checked there) for that block.
// The block's transcription_state is client-writable — any editor can put any file id in it — so reading, transcribing
// and deleting audio go by this record, never by the id in the state alone.
db.exec(`
CREATE TABLE IF NOT EXISTS meeting_audio (
  file_id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_time INTEGER NOT NULL
);
`);

/** Is `fileId` an upload made as this meeting block's audio? */
function isBlockAudio(blockId: string, fileId: string | undefined): boolean {
  return !!fileId && !!db.prepare('SELECT 1 AS hit FROM meeting_audio WHERE file_id = ? AND block_id = ?').get(fileId, blockId);
}

/** Delete the block's own audio upload (and its expiry job); ids that aren't this block's uploads are left alone. */
function removeBlockAudio(blockId: string, fileId: string | undefined) {
  if (!fileId || !isBlockAudio(blockId, fileId)) return;
  removeFile(fileId);
  cancelJob(`meeting-audio:${fileId}`);
}

/** Attach an uploaded audio file and transcribe it (or record why it can't be). */
export async function uploadAudio(blockId: unknown, userId: string, fileId: unknown) {
  let b = meetingBlock(blockId);
  assertEnabled(b);
  assertCanEdit(b, userId);
  assertNotTemplate(b);
  const st = stateOf(b);
  if (st.state === 'transcribing' || st.state === 'summarizing') throw new MeetingError('busy', 'Stop transcribing before uploading audio.', 409);
  const row = fileRow(String(fileId ?? ''));
  if (!row || row.user_id !== userId) throw new MeetingError('upload', 'The audio upload failed. Select the file again and retry.', 400);
  const mime = audioMime(row.name, row.mime);
  if (!mime) {
    removeFile(row.id);
    throw new MeetingError('unsupported', `Choose an ${ALLOWED_LABEL} audio file.`, 400);
  }
  b = ensureStructure(b, userId);
  const now = Date.now();
  // replaces an earlier upload of this block (only one that was uploaded as its audio)
  if (st.audio?.file_id && st.audio.file_id !== row.id) removeBlockAudio(b.id, st.audio.file_id);
  db.prepare('INSERT OR REPLACE INTO meeting_audio (file_id, block_id, user_id, created_time) VALUES (?, ?, ?, ?)').run(row.id, b.id, userId, now);
  recordState(userId, b, {
    state: 'transcript_ready', error: undefined,
    audio: { file_id: row.id, name: row.name, mime, size: row.size, status: 'transcribing', time: now },
  }, 'uploadAudio');
  scheduleJob('meeting-audio-expire', `meeting-audio:${row.id}`, now + KEEP_FAILED_MS, { blockId: b.id, fileId: row.id });
  return transcribeUploaded(b.id, userId);
}

export async function transcribeUploaded(blockId: string, userId: string): Promise<{ status: 'complete' | 'error'; error?: string }> {
  const b = meetingBlock(blockId);
  const st = stateOf(b);
  const audio = st.audio;
  if (!audio || audio.status === 'deleted') throw new MeetingError('no_audio', 'Audio recovery is unavailable. The local recording may have expired.', 400);
  const provider = sttProvider();
  const fail = (message: string, code = 'transcribe') => {
    recordState(userId, meetingBlock(blockId), { state: 'error', error: { code, message, time: Date.now() }, audio: { ...audio, status: 'failed' } }, 'transcribeFailed');
    return { status: 'error' as const, error: message };
  };
  if (!provider) return fail('This recording could not be transcribed.', 'stt_unavailable');
  // only a file uploaded as this block's audio (not whatever id the state names)
  const row = isBlockAudio(blockId, audio.file_id) ? fileRow(audio.file_id) : undefined;
  if (!row || !existsSync(row.path)) return fail('Audio recovery is unavailable. The local recording may have expired.', 'audio_missing');
  try {
    const out = await provider.transcribe({ data: readFileSync(row.path), mime: audio.mime, name: audio.name, language: st.language });
    importSegments(blockId, userId, out.segments);
    removeBlockAudio(blockId, audio.file_id);
    recordState(userId, meetingBlock(blockId), { state: 'transcript_ready', error: undefined, audio: { ...audio, status: 'deleted' } }, 'transcribed');
    return { status: 'complete' };
  } catch (e) {
    console.error('[meetings] transcription failed', e);
    return fail('Transcription failed. Try again.');
  }
}

/** "Delete audio": the uploaded file goes now (transcript and timestamps stay). */
export function deleteAudio(blockId: unknown, userId: string) {
  const b = meetingBlock(blockId);
  assertCanEdit(b, userId);
  const audio = stateOf(b).audio;
  if (!audio || audio.status === 'deleted') return b;
  // any editor of the meeting may delete its audio — the file uploaded as this block's audio, nothing else
  removeBlockAudio(b.id, audio.file_id);
  recordState(userId, b, { audio: { ...audio, status: 'deleted' } }, 'deleteAudio');
  return getRecord<BlockRecord>('block', b.id)!;
}

registerJobHandler('meeting-audio-expire', (payload: { blockId?: string; fileId?: string }) => {
  if (!payload?.fileId) return;
  removeFile(payload.fileId);
  const b = payload.blockId ? getRecord<BlockRecord>('block', payload.blockId) : undefined;
  const audio = b ? stateOf(b).audio : undefined;
  if (b && audio?.file_id === payload.fileId) {
    const actor = actorFor(b);
    if (actor) recordState(actor, b, { audio: { ...audio, status: 'deleted' } }, 'audioExpired');
  }
});

// ---------------------------------------------------------------- automatic transcript deletion

/** Someone allowed to write the block for maintenance (its creator if they still can, else a workspace owner). */
function actorFor(b: BlockRecord): string | null {
  if (b.created_by_id && roleAtLeast(blockRole(b.id, b.created_by_id), 'read_and_write')) return b.created_by_id;
  const space = getRecord<SpaceRecord>('space', b.space_id);
  for (const p of space?.permissions ?? []) {
    if (p.user_id && (p.role as string) === 'owner' && roleAtLeast(blockRole(b.id, p.user_id), 'read_and_write')) return p.user_id;
  }
  return null;
}

/** Delete transcripts older than each Enterprise workspace's retention (returns how many were deleted). */
export function runTranscriptRetention(now = Date.now()): number {
  let n = 0;
  const rows = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND alive = 1 AND json_extract(data, '$.type') IN ('meeting_notes', 'transcription')`).all() as { data: string }[];
  const policies = new Map<string, number | null>();
  for (const r of rows) {
    const b = JSON.parse(r.data) as BlockRecord;
    if (!policies.has(b.space_id)) {
      const space = getRecord<SpaceRecord>('space', b.space_id);
      const days = Number(spaceSetting(space, 'meeting_transcript_deletion', 'never'));
      policies.set(b.space_id, space?.plan_type === 'enterprise' && Number.isFinite(days) && days > 0 ? days : null);
    }
    const days = policies.get(b.space_id);
    if (!days) continue;
    const st = stateOf(b);
    if (st.transcript_deleted || st.state === 'transcribing' || st.state === 'paused') continue;
    const ended = st.stopped_time ?? b.created_time;
    if (now - ended < days * 86_400_000) continue;
    if (!transcriptRuns(b).length) continue;
    const actor = actorFor(b);
    if (!actor) continue;
    try {
      deleteTranscript(b.id, actor, 'policy');
      n++;
    } catch (e) {
      console.error('[meetings] retention failed for', b.id, e);
    }
  }
  return n;
}

registerJobHandler('meeting-retention', () => {
  runTranscriptRetention();
  scheduleJob('meeting-retention', 'meeting-retention', Date.now() + 86_400_000);
});
if (!getJob('meeting-retention')) scheduleJob('meeting-retention', 'meeting-retention', Date.now() + 5 * 60_000);

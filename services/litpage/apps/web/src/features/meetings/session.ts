// Live transcription session of one AI Meeting Notes block: consent, the
// server session (meetingStart / Resume / Append / Pause / Stop), the browser recognizer (speech.ts) and the optional
// local audio copy. One session per block per tab; it keeps running when the person navigates to another page (the
// recording pill brings them back). Final results are batched to the server, which turns them into
// transcript lines (speaker runs) for everyone with access.
import { create } from 'zustand';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { api, ApiError } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { LiveRecognizer, languageTag, speechSupported, type FinalResult, type SpeechErrorCode } from './speech.ts';
import { consentPlays, playConsent } from './consent.ts';
import { startLocalRecording } from './localAudio.ts';

export type LiveStatus = 'idle' | 'starting' | 'recording' | 'pausing' | 'paused' | 'stopping';

export interface LiveState {
  status: LiveStatus;
  interim: string;
  /** recorded ms at the last start / resume and the local clock then */
  baseMs: number;
  since: number;
  error: { code: string; message: string } | null;
}

interface LiveStore {
  blocks: Record<string, LiveState>;
  patch(blockId: string, p: Partial<LiveState>): void;
}

const IDLE: LiveState = { status: 'idle', interim: '', baseMs: 0, since: 0, error: null };

export const useLive = create<LiveStore>((set) => ({
  blocks: {},
  patch: (blockId, p) => set((s) => ({ blocks: { ...s.blocks, [blockId]: { ...(s.blocks[blockId] ?? IDLE), ...p } } })),
}));

export function useLiveState(blockId: string): LiveState {
  return useLive((s) => s.blocks[blockId] ?? IDLE);
}

export function liveState(blockId: string): LiveState {
  return useLive.getState().blocks[blockId] ?? IDLE;
}

export interface MeetingStateValue {
  state?: string;
  transcriber_id?: string;
  session_id?: string;
  started_time?: number;
  stopped_time?: number;
  elapsed_ms?: number;
  language?: string;
  error?: { code: string; message: string; time: number };
  transcript_deleted?: { time: number; by: 'user' | 'policy' };
  audio?: { file_id: string; name: string; status: string; size: number; time: number };
}

export function meetingState(b: BlockRecord | undefined): MeetingStateValue {
  const s = (b?.format as Record<string, unknown> | undefined)?.transcription_state as MeetingStateValue | undefined;
  return s && typeof s === 'object' ? s : { state: 'notes_ready' };
}

const SPEECH_ERRORS: Record<SpeechErrorCode, () => string> = {
  unsupported: () => t('lp.meetings.live_transcription_isn_t_supported_in', 'Live transcription isn’t supported in this browser. Use Chrome, Edge or Safari, or upload audio instead.'),
  permission: () => t('lp.meetings.microphone_permission_is_missing_allow_m', 'Microphone permission is missing. Allow microphone access in system settings'),
  no_microphone: () => t('lp.meetings.litpage_can_t_find_a_microphone', 'Litpage can’t find a microphone. Check your system settings to connect one'),
  network: () => t('lp.meetings.dictation_didn_t_work_try_again', 'Dictation didn’t work. Try again.'),
  language: () => t('lp.meetings.this_language_isn_t_supported_for', 'This language isn’t supported for live transcription in this browser. Pick another language.'),
  failed: () => t('lp.meetings.dictation_didn_t_work_try_again', 'Dictation didn’t work. Try again.'),
};

export function limitMessage(): string {
  return t('lp.meetings.you_have_used_all_of_today', 'You have used all of today’s transcription time');
}

class Controller {
  readonly blockId: string;
  sessionId = '';
  private rec: LiveRecognizer | null = null;
  private queue: FinalResult[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private stopLocal: (() => void) | null = null;
  /** final results heard since the last start / resume */
  private captured = 0;

  constructor(blockId: string) {
    this.blockId = blockId;
  }

  private get block(): BlockRecord | undefined {
    return records.get<BlockRecord>('block', this.blockId);
  }

  private fail(code: string, message: string) {
    this.teardown();
    useLive.getState().patch(this.blockId, { status: 'idle', interim: '', error: { code, message } });
    useUI.getState().toast(message, code === 'permission' ? { label: t('lp.meetings.get_help', 'Get help'), run: () => window.open('https://support.google.com/chrome/answer/2693767', '_blank') } : undefined);
  }

  private teardown() {
    this.rec?.stop();
    this.rec = null;
    this.stopLocal?.();
    this.stopLocal = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async start(resume: boolean) {
    const b = this.block;
    if (!b) return;
    if (!navigator.onLine) {
      useUI.getState().toast(t('lp.meetings.you_re_offline_so_meeting_notes', 'You’re offline, so meeting notes can’t be used.'));
      return;
    }
    if (!speechSupported()) {
      this.fail('unsupported', SPEECH_ERRORS.unsupported());
      return;
    }
    const lang = languageTag((b.format as Record<string, unknown> | undefined)?.meeting_language as string | undefined);
    useLive.getState().patch(this.blockId, { status: 'starting', error: null, interim: '' });
    try {
      const r = await api<{ sessionId: string; recordMap: any }>(resume ? 'meetingResume' : 'meetingStart', { blockId: this.blockId, language: lang, consent: true });
      records.mergeRecordMap(r.recordMap);
      this.sessionId = r.sessionId;
    } catch (e) {
      const status = (e as ApiError)?.status;
      this.fail(status === 429 ? 'rate_limited' : 'start', status === 429 ? limitMessage() : (e as Error).message || SPEECH_ERRORS.failed());
      return;
    }
    if (consentPlays(b.space_id)) await playConsent(lang);
    const st = meetingState(this.block);
    const baseMs = st.elapsed_ms ?? 0;
    this.rec = new LiveRecognizer({
      lang, baseMs,
      onFinal: (r) => this.push(r),
      onInterim: (text) => useLive.getState().patch(this.blockId, { interim: text }),
      onError: (code) => {
        const captured = this.captured;
        void this.flush().finally(() => {
          // nothing heard yet (microphone blocked / missing right away): undo the start; otherwise keep the server
          // session paused so the person can resume after fixing the microphone
          if (this.sessionId) void api(captured ? 'meetingPause' : 'meetingCancel', { blockId: this.blockId, sessionId: this.sessionId }).then((r) => records.mergeRecordMap(r.recordMap)).catch(() => {});
          this.fail(code, SPEECH_ERRORS[code]());
        });
      },
    });
    this.captured = 0;
    this.rec.start();
    useLive.getState().patch(this.blockId, { status: 'recording', baseMs, since: performance.now() });
    const space = records.get<SpaceRecord>('space', b.space_id);
    if ((space?.settings as Record<string, unknown> | undefined)?.meeting_store_audio_locally === true) {
      void startLocalRecording(this.blockId).then((stop) => { this.stopLocal = stop; });
    }
    mountRecordingPill();
  }

  private push(r: FinalResult) {
    this.captured++;
    this.queue.push(r);
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 700);
  }

  flush(): Promise<void> {
    const run = async () => {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 50);
        try {
          await api('meetingAppend', { blockId: this.blockId, sessionId: this.sessionId, segments: batch });
        } catch (e) {
          const status = (e as ApiError)?.status;
          if (status === 429) {
            this.fail('rate_limited', limitMessage());
            return;
          }
          if (status === 409 || status === 403 || status === 404) {
            this.fail('ended', (e as Error).message);
            return;
          }
          // transient: put the batch back and retry later
          this.queue.unshift(...batch);
          if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush(); }, 3000);
          return;
        }
      }
    };
    this.flushing = (this.flushing ?? Promise.resolve()).then(run, run);
    return this.flushing;
  }

  async pause() {
    useLive.getState().patch(this.blockId, { status: 'pausing' });
    this.rec?.stop();
    this.rec = null;
    this.stopLocal?.();
    this.stopLocal = null;
    await this.flush();
    try {
      const r = await api('meetingPause', { blockId: this.blockId, sessionId: this.sessionId });
      records.mergeRecordMap(r.recordMap);
    } catch {
      /* the server session may already have ended */
    }
    useLive.getState().patch(this.blockId, { status: 'paused', interim: '' });
  }

  async stop() {
    useLive.getState().patch(this.blockId, { status: 'stopping' });
    this.teardown();
    await this.flush();
    try {
      const r = await api('meetingStop', { blockId: this.blockId, sessionId: this.sessionId });
      records.mergeRecordMap(r.recordMap);
    } catch (e) {
      useUI.getState().toast((e as Error).message);
    }
    controllers.delete(this.blockId);
    useLive.getState().patch(this.blockId, { status: 'idle', interim: '' });
  }

  get recording(): boolean {
    return !!this.rec?.running;
  }
}

const controllers = new Map<string, Controller>();

export function activeSessions(): string[] {
  return [...controllers.keys()].filter((id) => ['recording', 'starting', 'paused', 'pausing'].includes(liveState(id).status));
}

export async function startMeeting(blockId: string, opts: { resume?: boolean } = {}) {
  let c = controllers.get(blockId);
  if (!c) {
    c = new Controller(blockId);
    controllers.set(blockId, c);
  }
  await c.start(!!opts.resume);
}

export async function pauseMeeting(blockId: string) {
  const c = controllers.get(blockId);
  if (c) await c.pause();
}

/** Stop and summarize. Without a local session (another tab, after a reload, a paused note) the server stops it. */
export async function stopMeeting(blockId: string) {
  const c = controllers.get(blockId);
  if (c) return c.stop();
  const st = meetingState(records.get<BlockRecord>('block', blockId));
  try {
    const r = await api('meetingStop', { blockId, sessionId: st.session_id });
    records.mergeRecordMap(r.recordMap);
  } catch (e) {
    useUI.getState().toast((e as Error).message);
  }
}

/** This tab is recording the block right now. */
export function isRecordingHere(blockId: string): boolean {
  return !!controllers.get(blockId)?.recording;
}

window.addEventListener('beforeunload', (e) => {
  if (activeSessions().some((id) => liveState(id).status === 'recording')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ---------------------------------------------------------------- recording pill (off-page)

let pillMounted = false;
function mountRecordingPill() {
  if (pillMounted) return;
  pillMounted = true;
  void import('./RecordingPill.tsx').then((m) => m.mountPill());
}

export function currentUserId(): string | null {
  return useSession.getState().userId;
}

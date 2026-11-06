// Live transcription in the browser: the Web Speech API (SpeechRecognition /
// webkitSpeechRecognition) with continuous interim results. Chrome ends a recognition session after silence or about a
// minute, so the recognizer restarts itself while the meeting is being transcribed. Errors map to the dictation
// Maps not-allowed to the microphone permission message, audio-capture to the unavailable microphone message, and
// other errors to the retry message. Final results go to session.ts.

export type SpeechErrorCode = 'unsupported' | 'permission' | 'no_microphone' | 'network' | 'language' | 'failed';

export interface FinalResult {
  text: string;
  /** ms since the recording started */
  startMs: number;
  endMs: number;
  /** speaker label when the engine separates speakers (not the case for browser engines; test fakes can set it) */
  speaker?: string;
}

interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives?: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart?: (() => void) | null;
}

function ctor(): (new () => RecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return typeof window !== 'undefined' && !!ctor();
}

export interface RecognizerOptions {
  lang: string;
  /** ms already recorded before this run (resume) */
  baseMs: number;
  onFinal(r: FinalResult): void;
  onInterim(text: string): void;
  onError(code: SpeechErrorCode, detail?: string): void;
}

/** One live recognition for a meeting (start → pause/resume → stop). */
export class LiveRecognizer {
  private rec: RecognitionLike | null = null;
  private active = false;
  private startedAt = 0;
  private baseMs: number;
  private utteranceStart: number | null = null;
  private restarts = 0;
  private opts: RecognizerOptions;

  constructor(opts: RecognizerOptions) {
    this.opts = opts;
    this.baseMs = opts.baseMs;
  }

  /** ms since the recording started (across pauses). */
  elapsed(): number {
    return this.baseMs + (this.active ? performance.now() - this.startedAt : 0);
  }

  start() {
    const C = ctor();
    if (!C) {
      this.opts.onError('unsupported');
      return;
    }
    this.active = true;
    this.startedAt = performance.now();
    this.restarts = 0;
    this.spawn(C);
  }

  private spawn(C: new () => RecognitionLike) {
    const rec = new C();
    rec.lang = this.opts.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex ?? 0; i < (e.results?.length ?? 0); i++) {
        const res = e.results[i];
        const alt = res?.[0];
        const text = String(alt?.transcript ?? '').trim();
        if (!text) continue;
        if (this.utteranceStart === null) this.utteranceStart = this.elapsed();
        if (res.isFinal) {
          const end = this.elapsed();
          const speaker = typeof res.speaker === 'string' ? res.speaker : typeof alt?.speaker === 'string' ? alt.speaker : undefined;
          this.opts.onFinal({ text, startMs: Math.round(this.utteranceStart ?? end), endMs: Math.round(end), ...(speaker ? { speaker } : {}) });
          this.utteranceStart = null;
        } else interim += `${text} `;
      }
      this.opts.onInterim(interim.trim());
    };
    rec.onerror = (e: any) => {
      const err = String(e?.error ?? 'failed');
      if (err === 'no-speech' || err === 'aborted') return; // silence: onend restarts
      this.active = false;
      if (err === 'not-allowed' || err === 'service-not-allowed') this.opts.onError('permission');
      else if (err === 'audio-capture') this.opts.onError('no_microphone');
      else if (err === 'network') this.opts.onError('network');
      else if (err === 'language-not-supported') this.opts.onError('language');
      else this.opts.onError('failed', err);
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.opts.onInterim('');
      if (!this.active) return;
      // Chrome stops after silence / ~60s: keep listening while the meeting is transcribed
      if (++this.restarts > 500) {
        this.active = false;
        this.opts.onError('failed', 'restart limit');
        return;
      }
      setTimeout(() => {
        if (this.active && this.rec === rec) this.spawn(C);
      }, 150);
    };
    this.rec = rec;
    try {
      rec.start();
    } catch (e) {
      this.active = false;
      this.opts.onError('failed', String((e as Error)?.message ?? e));
    }
  }

  /** Pause / stop: final results still in flight are delivered by the engine before onend. */
  stop(): number {
    const ms = this.elapsed();
    this.baseMs = ms;
    this.active = false;
    const rec = this.rec;
    this.rec = null;
    try {
      rec?.stop();
    } catch {
      /* already stopped */
    }
    this.opts.onInterim('');
    return ms;
  }

  get running(): boolean {
    return this.active;
  }
}

/** BCP-47 tags for the Language menu. */
export const LANGUAGES: { key: string; label: string; tag: string }[] = [
  { key: 'auto', label: 'Auto detect', tag: '' },
  { key: 'arabic', label: 'Arabic', tag: 'ar-SA' },
  { key: 'simplified_chinese', label: 'Chinese (Simplified)', tag: 'zh-CN' },
  { key: 'traditional_chinese', label: 'Chinese (Traditional)', tag: 'zh-TW' },
  { key: 'danish', label: 'Danish', tag: 'da-DK' },
  { key: 'dutch', label: 'Dutch', tag: 'nl-NL' },
  { key: 'english', label: 'English', tag: 'en-US' },
  { key: 'finnish', label: 'Finnish', tag: 'fi-FI' },
  { key: 'french', label: 'French', tag: 'fr-FR' },
  { key: 'german', label: 'German', tag: 'de-DE' },
  { key: 'hebrew', label: 'Hebrew', tag: 'he-IL' },
  { key: 'indonesian', label: 'Indonesian', tag: 'id-ID' },
  { key: 'italian', label: 'Italian', tag: 'it-IT' },
  { key: 'japanese', label: 'Japanese', tag: 'ja-JP' },
  { key: 'korean', label: 'Korean', tag: 'ko-KR' },
  { key: 'norwegian', label: 'Norwegian', tag: 'nb-NO' },
  { key: 'polish', label: 'Polish', tag: 'pl-PL' },
  { key: 'portuguese', label: 'Portuguese', tag: 'pt-BR' },
  { key: 'russian', label: 'Russian', tag: 'ru-RU' },
  { key: 'spanish', label: 'Spanish', tag: 'es-ES' },
  { key: 'swedish', label: 'Swedish', tag: 'sv-SE' },
  { key: 'thai', label: 'Thai', tag: 'th-TH' },
  { key: 'vietnamese', label: 'Vietnamese', tag: 'vi-VN' },
];

export function languageTag(key: string | undefined): string {
  const hit = LANGUAGES.find((l) => l.key === key || l.tag === key);
  if (hit?.tag) return hit.tag;
  return typeof navigator !== 'undefined' && navigator.language ? navigator.language : 'en-US';
}

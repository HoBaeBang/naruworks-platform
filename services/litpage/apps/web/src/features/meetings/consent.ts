// Consent: the spoken consent message ("This meeting is being transcribed by Litpage AI so it can take notes.")
// played from this device with the Web Speech synthesis voices, the message people copy into a chat, and who decides
// whether it plays: Settings › Meeting notes › "Enforce consent for all workspace members" (owners) wins over the
// person's "Auto play consent message on start" (Settings, or the block menu's "Auto-play consent"). The first time
// someone transcribes, the "Choose how you notify others" choice sets their preference.
import type { SpaceRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';

export function consentSpokenMessage(): string {
  return t('lp.meetings.this_meeting_is_being_transcribed_by', 'This meeting is being transcribed by Litpage AI so it can take notes.');
}

export function consentCopyMessage(localRecordings = false): string {
  return localRecordings
    ? t('lp.meetings.litpage_ai_is_recording_and_transcribing', 'Litpage AI is recording and transcribing this meeting for me, and it will write up notes.')
    : t('lp.meetings.i_have_litpage_ai_transcribing_this', 'I have Litpage AI transcribing this meeting, and it will produce notes.');
}

export function audioSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof (window as any).SpeechSynthesisUtterance === 'function';
}

/** Speak the consent message (resolves when it ends, or right away when audio isn't available). */
export function playConsent(lang?: string): Promise<boolean> {
  if (!audioSupported()) {
    useUI.getState().toast(t('lp.meetings.your_device_doesn_t_support_audio', 'Your device doesn’t support audio'));
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(consentSpokenMessage());
      if (lang) u.lang = lang;
      const voice = window.speechSynthesis.getVoices().find((v) => lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
      if (voice) u.voice = voice;
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      u.onend = () => finish(true);
      u.onerror = () => finish(false);
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
      // engines without voices never fire onend: don't hold the recording back
      setTimeout(() => finish(true), 6000);
    } catch {
      resolve(false);
    }
  });
}

export async function copyConsent(localRecordings = false) {
  try {
    await navigator.clipboard.writeText(consentCopyMessage(localRecordings));
    useUI.getState().toast(t('lp.meetings.consent_message_is_on_your_clipboard', 'Consent message is on your clipboard'));
  } catch {
    useUI.getState().toast(t('lp.meetings.couldn_t_place_the_consent_message', 'Couldn’t place the consent message on your clipboard'));
  }
}

function prefs(): Record<string, unknown> {
  const uid = useSession.getState().userId;
  return (records.get<UserSettingsRecord>('user_settings', uid)?.settings ?? {}) as Record<string, unknown>;
}

export function consentEnforced(spaceId: string | null | undefined): boolean {
  const s = records.get<SpaceRecord>('space', spaceId);
  return (s?.settings as Record<string, unknown> | undefined)?.meeting_enforce_consent === true;
}

/** The person's choice: true = play audio, false = get consent myself, undefined = not chosen yet. */
export function autoConsentPref(): boolean | undefined {
  const v = prefs().meeting_auto_consent;
  return typeof v === 'boolean' ? v : undefined;
}

/** Does the consent message play when this person starts / resumes? */
export function consentPlays(spaceId: string | null | undefined): boolean {
  return consentEnforced(spaceId) || autoConsentPref() === true;
}

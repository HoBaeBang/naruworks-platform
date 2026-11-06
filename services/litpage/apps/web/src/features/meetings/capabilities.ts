// What this server can do for AI Meeting Notes (api/modules/meetings.ts meetingStatus): uploaded audio is transcribed
// by a speech-to-text provider, and none ships with the clone (apps/server/src/meetings/audio.ts registers them). The
// "Upload audio" entry points show disabled with the reason instead of ending every upload in "This recording
// couldn't be transcribed."
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { t } from '../shell/i18n.ts';

const cache = new Map<string, Promise<string | null>>();

/** The speech-to-text provider's label for a workspace's meeting notes, or null when there is none. */
export function sttProviderOf(spaceId: string | undefined): Promise<string | null> {
  if (!spaceId) return Promise.resolve(null);
  let p = cache.get(spaceId);
  if (!p) {
    p = api<{ sttProvider?: string | null }>('meetingStatus', { spaceId }).then((r) => r?.sttProvider ?? null).catch(() => null);
    cache.set(spaceId, p);
  }
  return p;
}

/** undefined while loading, then the provider label or null. */
export function useSttProvider(spaceId: string | undefined): string | null | undefined {
  const [v, setV] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void sttProviderOf(spaceId).then((x) => { if (live) setV(x); });
    return () => { live = false; };
  }, [spaceId]);
  return v;
}

export const noSttReason = () => t('lp.meetings.uploaded_audio_can_t_be_transcribed', 'Uploaded audio can’t be transcribed here: no speech-to-text service is set up on this server.');

// Off-page recording pill: while this tab transcribes a meeting and the person is on
// another page, a floating pill shows "Transcribing…" with "Go to the recording" and Stop. Mounted on the first
// recording into its own root, so no shell file has to host it.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { BlockRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { openPage } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { pageIdOfBlock } from '../editor/commands.ts';
import { t } from '../shell/i18n.ts';
import { activeSessions, liveState, stopMeeting, useLive } from './session.ts';

function onScreen(blockId: string): boolean {
  return !!document.querySelector(`[data-meeting-block="${blockId}"]`);
}

function Pill() {
  useLive((s) => s.blocks);
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const id = activeSessions().find((b) => !onScreen(b));
  if (!id) return null;
  const st = liveState(id);
  const b = records.get<BlockRecord>('block', id);
  return (
    <div className="nc-mtg-floating" role="status" aria-label={t('lp.meetings.transcribing', 'Transcribing…')}>
      <span className="nc-mtg-dot" />
      <span>{st.status === 'paused' ? t('lp.meetings.paused', 'Paused') : t('lp.meetings.transcribing', 'Transcribing…')}</span>
      <span role="button" className="go" onClick={() => { const p = b ? pageIdOfBlock(b.id) : undefined; if (p) openPage(p, { blockId: id }); }}>
        {t('lp.meetings.open_the_recording', 'Open the recording')}
      </span>
      <button className="nc-mtg-stop" onClick={() => void stopMeeting(id)}><Icon name="stop" size={12} style={{ display: 'inline-flex', marginRight: 4 }} />{t('lp.meetings.stop', 'Stop')}</button>
    </div>
  );
}

let mounted = false;
export function mountPill() {
  if (mounted) return;
  mounted = true;
  const host = document.createElement('div');
  host.className = 'nc-mtg-pill-root';
  document.body.appendChild(host);
  createRoot(host).render(<Pill />);
}

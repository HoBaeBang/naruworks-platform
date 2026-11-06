// Transcript tab: one line per speaker run (speaker label, time since the recording started, the words), plus the
// live interim words while this tab records, "Scroll to bottom", and the empty / deleted states. Lines are blocks
// written by the server (read-only here; the summary's citation chips jump to them).
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { useBlock, useRecords } from '../../lib/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';
import type { MeetingStateValue } from './session.ts';

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const two = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600);
  return h ? `${h}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

function deletedText(st: MeetingStateValue): string {
  const d = st.transcript_deleted;
  if (!d) return '';
  const when = new Date(d.time);
  const date = when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.by === 'policy'
    ? t('lp.meetings.your_workspace_s_automatic_transcript_de', 'Your workspace’s automatic transcript deletion policy removed this transcript on {deletionDate} at {deletionTime}', { deletionDate: date, deletionTime: time })
    : t('lp.meetings.transcript_removed_at', 'Transcript removed {deletionDate} at {deletionTime}', { deletionDate: date, deletionTime: time });
}

export function TranscriptPanel({ sectionId, state, interim, recording, liveMs }: { sectionId: string | undefined; state: MeetingStateValue; interim: string; recording: boolean; liveMs: number }) {
  const section = useBlock(sectionId);
  const lines = useRecords<BlockRecord>('block', section?.content);
  const alive = lines.filter((l): l is BlockRecord => !!l && l.alive !== false);
  const box = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);
  useEffect(() => {
    const el = box.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [alive.length, interim, stick]);
  if (state.transcript_deleted && !alive.length) return <div className="nc-mtg-empty">{deletedText(state)}</div>;
  if (!alive.length && !interim) {
    const ended = !recording && (state.state === 'transcript_ready' || state.state === 'summary_ready' || state.state === 'error') && (state.elapsed_ms ?? 0) > 0;
    return (
      <div className="nc-mtg-empty">
        {ended
          ? t('lp.meetings.nothing_was_transcribed_make_sure_your', 'Nothing was transcribed. Make sure your microphone and system audio are set up correctly, then retry.')
          : t('lp.meetings.your_meeting_transcript_will_appear_here', 'Your meeting transcript will appear here…')}
      </div>
    );
  }
  return (
    <div
      ref={box}
      className="nc-mtg-transcript"
      data-testid="meeting-transcript"
      onScroll={(e) => {
        const el = e.currentTarget;
        setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 24);
      }}
    >
      {alive.map((l) => {
        const f = (l.format ?? {}) as Record<string, unknown>;
        return (
          <div key={l.id} className="nc-mtg-line" data-line-id={l.id} id={`mtg-line-${l.id}`}>
            <div className="who">
              <b>{String(f.meeting_speaker ?? t('lp.meetings.unknown', 'Unknown'))}</b>
              <span className="ts">{clock(Number(f.meeting_start_ms ?? 0))}</span>
            </div>
            <div className="txt">{toPlainText(l.properties?.title)}</div>
          </div>
        );
      })}
      {interim && (
        <div className="nc-mtg-line interim" aria-live="polite">
          <div className="who"><span className="ts">{clock(liveMs)}</span></div>
          <div className="txt">{interim}</div>
        </div>
      )}
      {!stick && (
        <div role="button" className="nc-mtg-tobottom" onClick={() => { setStick(true); const el = box.current; if (el) el.scrollTop = el.scrollHeight; }}>
          <Icon name="arrowDown" size={12} />{t('lp.meetings.scroll_to_the_bottom', 'Scroll to the bottom')}
        </div>
      )}
    </div>
  );
}

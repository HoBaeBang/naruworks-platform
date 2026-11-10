// AI Meeting Notes block (meeting_notes, legacy "transcription"). The block registers only when no other
// block implementation does.
// header: title (placeholder "AI Meeting Notes"), date, transcriber status; settings (slider) menu; Start
// transcribing / recording controls (timer, Pause, Stop) / Summarizing
// tabs: Summary (AI summary with citation chips), Notes (the person's blocks), and Transcript (speaker runs)
// footer: Instructions dropdown, consent message (play / copy)
// Server: apps/server/src/meetings/*.
import { useEffect, useRef, useState } from 'react';
import { Pause } from 'lucide-react';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { registerBlock, BlockList, type BlockProps } from '../editor/Block.tsx';
import { Icon, registerIcons } from '../../components/Icon.tsx';
import { api } from '../../lib/api.ts';
import { createBlockIn, getBlock, run } from '../../lib/blocks.ts';
import { useBlock, useRecord, useRole, useRecords, useUser } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useEditor } from '../editor/editorState.ts';
import { NoKeyNotice } from '../ai/NoKeyNotice.tsx';
import { t } from '../shell/i18n.ts';
import { TranscriptPanel, clock } from './Transcript.tsx';
import { installCitations } from './citations.tsx';
import { useInstructions, instructionsLabel, openInstructionsMenu } from './instructions.tsx';
import { askConsentChoice, openSettingsMenu, pickAudio, retrySummary as retry } from './menus.tsx';
import { noSttReason, useSttProvider } from './capabilities.ts';
import { autoConsentPref, consentEnforced, consentPlays, copyConsent, playConsent } from './consent.ts';
import { isRecordingHere, meetingState, startMeeting, pauseMeeting, stopMeeting, useLiveState, type MeetingStateValue } from './session.ts';
import { speechSupported } from './speech.ts';
import { meetingsEnabled } from './entry.ts';
import { hideSlashItemWhen, overrideSlashItem } from '../editor/blocks/registry.ts';
import { place, type SlashContext } from '../editor/slashItems.ts';
import { useUI } from '../../lib/store/ui.ts';
import './meetings.css';

registerIcons({ pause: Pause });
installCitations();

type Tab = 'summary' | 'notes' | 'transcript';
const TAB_KEY = 'nc:mtg-tab:';

export const retrySummary = retry;

function readTab(id: string): Tab | null {
  try {
    const v = localStorage.getItem(TAB_KEY + id);
    return v === 'summary' || v === 'notes' || v === 'transcript' ? v : null;
  } catch {
    return null;
  }
}

function writeTab(id: string, tab: Tab) {
  try {
    localStorage.setItem(TAB_KEY + id, tab);
  } catch {
    /* ignore */
  }
}

/** Sections are created on the server (idempotent); each block asks once per page load. */
const ensured = new Set<string>();
function ensureSections(block: BlockRecord, canEdit: boolean) {
  const f = (block.format ?? {}) as Record<string, unknown>;
  if (f.transcription_notes_id && f.transcription_summary_id && f.transcription_transcript_id) return;
  if (!canEdit || ensured.has(block.id)) return;
  ensured.add(block.id);
  void api<{ recordMap: any }>('meetingEnsure', { blockId: block.id }).then((r) => records.mergeRecordMap(r.recordMap)).catch(() => ensured.delete(block.id));
}

function aliveKids(section: BlockRecord | undefined, kids: (BlockRecord | undefined)[]): string[] {
  return (section?.content ?? []).filter((_, i) => kids[i] && kids[i]!.alive !== false);
}

function addFirstBlock(sectionId: string | undefined) {
  if (!sectionId) return;
  let id = '';
  run('meetingNotes.addBlock', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: sectionId, parentTable: 'block' }); });
  useEditor.getState().requestFocus(id, 0);
}

function useTicker(on: boolean) {
  const [, setN] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const i = setInterval(() => setN((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, [on]);
}

function limitBanner(): string {
  const d = new Date();
  const reset = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - d.getTime();
  const hours = Math.ceil(reset / 3_600_000);
  return hours > 1
    ? t('lp.meetings.you_have_used_all_of_today_8037', 'You have used all of today’s transcription time. Meeting notes with AI will be available again in {remainingValue, plural, one {an hour} other {# hours}}.', { remainingValue: hours })
    : t('lp.meetings.you_have_used_all_of_today_3e1f', 'You have used all of today’s transcription time. Meeting notes with AI will be available again in {remainingValue, plural, one {# minute} other {# minutes}}.', { remainingValue: Math.max(1, Math.ceil(reset / 60_000)) });
}

function ErrorBanner({ block, state, canEdit }: { block: BlockRecord; state: MeetingStateValue; canEdit: boolean }) {
  const e = state.error;
  if (!e) return null;
  if (e.code === 'no_key') return <div style={{ marginTop: 10 }}><NoKeyNotice compact /></div>;
  if (e.code === 'rate_limited') return <div className="nc-mtg-banner error" role="alert"><Icon name="warning" size={16} /><div className="grow">{limitBanner()}</div></div>;
  const summaryError = !['stt_unavailable', 'transcribe', 'audio_missing'].includes(e.code);
  return (
    <div className="nc-mtg-banner error" role="alert">
      <Icon name="warning" size={16} style={{ color: 'var(--lp-red-text-accent)', marginTop: 1 }} />
      <div className="grow">
        <div>{e.message}</div>
        {e.code === 'stt_unavailable' && <div className="sub">{t('lp.meetings.no_speech_to_text_service_is', 'No speech-to-text service is configured on this server, so uploaded audio can’t be transcribed. Live transcription in the browser still works.')}</div>}
      </div>
      {canEdit && summaryError && e.code !== 'empty' && (
        <button className="nc-blk-btn outline" onClick={() => void retry(block.id)}>{t('lp.meetings.retry_summary', 'Retry summary')}</button>
      )}
    </div>
  );
}

function Steps() {
  const steps = [
    t('lp.meetings.reading_transcript', 'Reading transcript…'),
    t('lp.meetings.finding_action_items', 'Finding action items'),
    t('lp.meetings.arranging_key_points', 'Arranging key points'),
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setI((n) => Math.min(n + 1, steps.length - 1)), 1600);
    return () => clearInterval(id);
  }, [steps.length]);
  return (
    <div className="nc-mtg-steps" aria-live="polite">
      {steps.slice(0, i + 1).map((s, k) => (
        <div key={s} className={`step ${k === i ? 'active' : ''}`}>{k === i ? <span className="nc-mtg-spinner" /> : <Icon name="check" size={12} />}{s}</div>
      ))}
    </div>
  );
}

function MeetingNotesBlock({ block, depth, readOnly }: BlockProps) {
  const role = useRole('block', block.id);
  const canEdit = !readOnly && roleAtLeast(role, 'read_and_write');
  const space = useRecord<SpaceRecord>('space', block.space_id);
  const settings = (space?.settings ?? {}) as Record<string, unknown>;
  const enabled = settings.meeting_notes_enabled !== false;
  // speech-to-text for uploaded audio (none ships with the clone: the upload button is off with the reason)
  const stt = useSttProvider(block.space_id);
  const storeLocally = settings.meeting_store_audio_locally === true;
  const me = useSession((s) => s.userId);
  const st = meetingState(block);
  const live = useLiveState(block.id);
  const f = (block.format ?? {}) as Record<string, unknown>;
  const summary = useBlock(f.transcription_summary_id as string | undefined);
  const notes = useBlock(f.transcription_notes_id as string | undefined);
  const transcript = useBlock(f.transcription_transcript_id as string | undefined);
  const summaryKids = useRecords<BlockRecord>('block', summary?.content);
  const notesKids = useRecords<BlockRecord>('block', notes?.content);
  const transcriptKids = useRecords<BlockRecord>('block', transcript?.content);
  const summaryIds = aliveKids(summary, summaryKids);
  const noteIds = aliveKids(notes, notesKids);
  const lineCount = aliveKids(transcript, transcriptKids).length;
  const transcriber = useUser(st.state === 'transcribing' || st.state === 'paused' ? st.transcriber_id : undefined);
  const instrLoaded = useInstructions((s) => s.loaded);
  useInstructions((s) => s.custom.length + s.builtins.length);
  const [tab, setTabState] = useState<Tab>(() => readTab(block.id) ?? (summaryIds.length ? 'summary' : 'notes'));
  const [title, setTitle] = useState(toPlainText(block.properties?.title));
  const editingTitle = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const recordingHere = live.status === 'recording' && isRecordingHere(block.id);
  useTicker(recordingHere);

  useEffect(() => ensureSections(block, canEdit), [block, canEdit]);
  useEffect(() => { if (!instrLoaded) void useInstructions.getState().load(); }, [instrLoaded]);
  useEffect(() => {
    if (!editingTitle.current) setTitle(toPlainText(block.properties?.title));
  }, [block.properties?.title]);
  // a finished summary opens the Summary tab
  const summaryTime = (st as { summary_time?: number }).summary_time;
  const lastSummary = useRef(summaryTime);
  useEffect(() => {
    if (summaryTime && summaryTime !== lastSummary.current) {
      lastSummary.current = summaryTime;
      setTab('summary');
    }
  }, [summaryTime]);
  // citation chips jump to the transcript line
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { blockId?: string; lineId?: string };
      if (d.blockId !== block.id || !d.lineId) return;
      setTab('transcript');
      setTimeout(() => {
        const el = rootRef.current?.querySelector<HTMLElement>(`[data-line-id="${d.lineId}"]`);
        if (!el) return;
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        el.classList.add('flash');
        setTimeout(() => el.classList.remove('flash'), 1600);
      }, 30);
    };
    window.addEventListener('nc:mtg-cite', on);
    return () => window.removeEventListener('nc:mtg-cite', on);
  }, [block.id]);

  function setTab(next: Tab) {
    setTabState(next);
    writeTab(block.id, next);
  }

  const commitTitle = () => {
    editingTitle.current = false;
    const next = title.trim();
    if (next === toPlainText(block.properties?.title)) return;
    run('meetingNotes.rename', (tx) => tx.set('block', block.id, ['properties', 'title'], next ? [[next]] : []));
  };

  const inTemplate = (() => {
    let cur: BlockRecord | undefined = block;
    for (let i = 0; i < 60 && cur; i++) {
      if (cur.is_template) return true;
      if (cur.parent_table !== 'block') break;
      cur = records.get<BlockRecord>('block', cur.parent_id);
    }
    return false;
  })();

  const someoneElse = (st.state === 'transcribing') && st.transcriber_id && st.transcriber_id !== me;
  const mineElsewhere = st.state === 'transcribing' && st.transcriber_id === me && !recordingHere && live.status !== 'starting' && live.status !== 'stopping' && live.status !== 'pausing';
  const paused = live.status === 'paused' || (st.state === 'paused') || mineElsewhere;
  const busy = live.status === 'starting' || live.status === 'stopping' || live.status === 'pausing';
  const summarizing = st.state === 'summarizing';
  const startedBefore = (st.elapsed_ms ?? 0) > 0 || lineCount > 0;

  let disabledReason: string | undefined;
  if (!enabled) disabledReason = t('lp.meetings.ai_meeting_notes_are_unavailable_in', 'Meeting notes with AI are unavailable in this workspace');
  else if (inTemplate) disabledReason = t('lp.meetings.you_can_t_start_transcription_inside', 'You can’t start transcription inside a template');
  else if (!canEdit) disabledReason = t('lp.meetings.you_do_not_have_access_to', 'You do not have access to transcribe this recording');

  const start = async (anchor: HTMLElement, resume = false) => {
    if (disabledReason) return;
    // first time: how this person lets others know (unless the workspace enforces the audio message)
    if (!consentEnforced(block.space_id) && autoConsentPref() === undefined && speechSupported()) {
      const choice = await askConsentChoice(anchor);
      if (choice === null) return;
    }
    await startMeeting(block.id, { resume });
  };

  const liveMs = live.baseMs + (recordingHere ? performance.now() - live.since : 0);
  const shownMs = recordingHere ? liveMs : st.elapsed_ms ?? 0;
  const created = new Date(st.started_time ?? block.created_time ?? Date.now());

  let controls: React.ReactNode;
  if (summarizing) {
    controls = <span className="nc-mtg-start busy" aria-busy="true"><span className="nc-mtg-spinner" />{t('lp.meetings.summarizing', 'Summarizing')}</span>;
  } else if (someoneElse) {
    controls = null;
  } else if (recordingHere || paused || busy) {
    controls = (
      <span className={`nc-mtg-rec ${paused ? 'paused' : ''}`} data-testid="meeting-recording">
        <span className="nc-mtg-dot" />
        <span className="nc-mtg-timer">{clock(shownMs)}</span>
        <span className="nc-mtg-wave" aria-hidden><i /><i /><i /><i /></span>
        {paused ? (
          <button className="nc-mtg-iconbtn" aria-label={t('lp.meetings.resume', 'Resume')} data-tooltip={consentPlays(block.space_id) ? t('lp.meetings.when_you_resume_a_consent_message', 'When you resume, a consent message plays') : t('lp.meetings.resume_transcription', 'Resume transcription')} onClick={(e) => void start(e.currentTarget, true)} disabled={busy}>
            <Icon name="mic" size={16} />
          </button>
        ) : (
          <button className="nc-mtg-iconbtn" aria-label={t('lp.meetings.pause', 'Pause')} data-tooltip={t('lp.meetings.pause_transcription', 'Pause transcription')} onClick={() => void pauseMeeting(block.id)} disabled={busy}>
            <Icon name="pause" size={16} />
          </button>
        )}
        <button className="nc-mtg-stop" data-tooltip={t('lp.meetings.stop_and_summarize', 'Stop recording and summarize')} onClick={() => void stopMeeting(block.id)} disabled={busy}>
          {t('lp.meetings.stop', 'Stop')}
        </button>
      </span>
    );
  } else if (!startedBefore) {
    controls = (
      <button
        className="nc-mtg-start"
        aria-disabled={!!disabledReason}
        data-tooltip={disabledReason ?? (consentPlays(block.space_id) ? t('lp.meetings.when_you_start_a_consent_message', 'When you start, a consent message plays') : undefined)}
        onClick={(e) => void start(e.currentTarget)}
      >
        <Icon name="mic" size={14} />
        {t('lp.meetings.start_transcribing', 'Start transcribing')}
      </button>
    );
  } else if (canEdit && enabled) {
    controls = (
      <button className="nc-mtg-start secondary" aria-disabled={!!disabledReason} data-tooltip={disabledReason} onClick={(e) => void start(e.currentTarget, true)}>
        <Icon name="mic" size={14} />
        {t('lp.meetings.resume', 'Resume')}
      </button>
    );
  }

  const panel = (() => {
    if (tab === 'summary') {
      if (summarizing) return <Steps />;
      if (summaryIds.length) return <div className="nc-mtg-summary"><BlockList parentId={summary!.id} ids={summary!.content} depth={depth + 1} readOnly={!canEdit} /></div>;
      return (
        <div className={`nc-mtg-empty ${canEdit && summary ? 'clickable' : ''}`} onMouseDown={(e) => { if (!canEdit || !summary) return; e.preventDefault(); addFirstBlock(summary.id); }}>
          {t('lp.meetings.start_writing_your_summary', 'Start writing your summary…')}
        </div>
      );
    }
    if (tab === 'notes') {
      if (noteIds.length) return <BlockList parentId={notes!.id} ids={notes!.content} depth={depth + 1} readOnly={!canEdit} />;
      return (
        <div className={`nc-mtg-empty ${canEdit && notes ? 'clickable' : ''}`} onMouseDown={(e) => { if (!canEdit || !notes) return; e.preventDefault(); addFirstBlock(notes.id); }}>
          {startedBefore ? t('lp.meetings.litpage_ai_turns_your_notes_and', 'Litpage AI turns your notes and the transcript into a summary') : t('lp.meetings.here_s_the_flow_1_press', 'Here’s the flow:\n1. Press “Start transcribing” to begin.\n2. Jot notes here whenever you like, and AI will use them for a better summary.\n3. Once you’re finished, press “Stop”. AI then writes up a summary and action items.')}
        </div>
      );
    }
    return <TranscriptPanel sectionId={transcript?.id} state={st} interim={live.interim} recording={recordingHere} liveMs={liveMs} />;
  })();

  const instrKey = (f.meeting_instructions as string | undefined) || undefined;

  return (
    <div className="nc-bpad">
      <div ref={rootRef} className={`nc-mtg ${recordingHere ? 'recording' : ''}`} data-meeting-block={block.id} data-testid="meeting-notes-block">
        <div className="nc-mtg-head">
          <div className="nc-mtg-icon"><Icon name="paperMicrophone" size={18} /></div>
          <div className="nc-mtg-titlebox">
            <input
              className={`nc-mtg-title ${summarizing && !title ? 'generating' : ''}`}
              value={title}
              readOnly={!canEdit}
              aria-label={t('lp.meetings.ai_meeting_notes', 'Meeting notes with AI')}
              placeholder={summarizing && !title ? t('lp.meetings.generating_title', 'Generating title') : t('lp.meetings.ai_meeting_notes', 'Meeting notes with AI')}
              onFocus={() => { editingTitle.current = true; }}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.currentTarget as HTMLInputElement).blur();
              }}
            />
            <div className="nc-mtg-sub">
              <span>{created.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · {created.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</span>
              {someoneElse && <span dangerouslySetInnerHTML={{ __html: t('lp.meetings.this_meeting_is_being_transcribed_by_f64d', 'This meeting is being transcribed by <bold>{transcriberName}</bold>', { transcriberName: escapeHtml(transcriber?.name || 'Someone') }).replace(/<bold>/g, '<b>').replace(/<\/bold>/g, '</b>') }} />}
              {recordingHere && <span dangerouslySetInnerHTML={{ __html: t('lp.meetings.this_meeting_is_being_transcribed_by_a2ca', 'This meeting is being transcribed by <bold>you</bold>').replace(/<bold>/g, '<b>').replace(/<\/bold>/g, '</b>') }} />}
            </div>
          </div>
          <div className="nc-mtg-actions">
            {!enabled ? null : (
              <span className="nc-mtg-iconbtn" role="button" aria-label={t('lp.meetings.browser_limitation', 'Browser limitation')} data-tooltip={t('lp.meetings.the_browser_records_only_your_microphone', 'The browser records only your microphone. To summarize video calls fully, use the Litpage app, which captures both microphone and system audio.')}>
                <Icon name="info" size={16} />
              </span>
            )}
            <span
              role="button"
              className="nc-mtg-iconbtn"
              aria-label={t('lp.meetings.options', 'Options')}
              data-tooltip={t('lp.meetings.options', 'Options')}
              onClick={(e) => void openSettingsMenu(e.currentTarget, block, { canEdit, fullAccess: canEdit && roleAtLeast(role, 'editor'), enabled, storeLocally, hasTranscript: lineCount > 0, hasContent: lineCount > 0 || noteIds.length > 0 })}
            >
              <Icon name="sliders" size={16} />
            </span>
            {controls}
          </div>
        </div>
        {!startedBefore && !recordingHere && canEdit && enabled && !summarizing && (
          <div className="nc-mtg-consent">{t('lp.meetings.by_starting_you_confirm_that_everyone', 'By starting, you confirm that everyone being transcribed has agreed.')}</div>
        )}
        {live.error && live.status === 'idle' && <div className="nc-mtg-banner error" role="alert"><Icon name="warning" size={16} /><div className="grow">{live.error.code === 'rate_limited' ? limitBanner() : live.error.message}</div></div>}
        {st.state === 'error' || st.error ? <ErrorBanner block={block} state={st} canEdit={canEdit} /> : null}
        {st.audio && st.audio.status === 'transcribing' && <div className="nc-mtg-banner"><span className="nc-mtg-spinner" /><div className="grow">{t('lp.meetings.transcribing_d8a8', 'Transcribing')} {st.audio.name}</div></div>}
        <div className="nc-tabs-strip" role="tablist">
          {(['summary', 'notes', 'transcript'] as Tab[]).map((k) => (
            <div key={k} role="tab" aria-selected={tab === k} className={`nc-tab-pill ${tab === k ? 'selected' : ''}`} onClick={() => setTab(k)}>
              {k === 'summary' ? t('lp.meetings.summary', 'Summary') : k === 'notes' ? t('lp.meetings.notes', 'Notes') : t('lp.meetings.transcript', 'Transcript')}
            </div>
          ))}
        </div>
        <div className="nc-mtg-panel" role="tabpanel" data-tab={tab}>{panel}</div>
        <div className="nc-mtg-foot">
          <span
            role="button"
            className="nc-mtg-instr"
            data-testid="meeting-instructions"
            onClick={(e) => openInstructionsMenu(e.currentTarget, block, { readOnly: !canEdit, hasSummary: summaryIds.length > 0 })}
          >
            {t('lp.meetings.instructions', 'Instructions:')} <b>{instructionsLabel(instrKey)}</b>
            <Icon name="arrowChevronSingleDownSmall" size={14} />
          </span>
          <span className="grow" />
          {canEdit && enabled && <span role="button" className="nc-mtg-iconbtn" aria-label={t('lp.meetings.play_a_spoken_consent_notice', 'Play a spoken consent notice')} data-tooltip={t('lp.meetings.play_a_spoken_consent_notice', 'Play a spoken consent notice')} onClick={() => void playConsent()}><Icon name="volumeOn" size={16} /></span>}
          {canEdit && enabled && <span role="button" className="nc-mtg-iconbtn" aria-label={t('lp.meetings.copy_the_consent_message', 'Copy the consent message')} data-tooltip={t('lp.meetings.copy_the_consent_message', 'Copy the consent message')} onClick={() => void copyConsent(storeLocally)}><Icon name="copy" size={16} /></span>}
          {canEdit && enabled && !startedBefore && !recordingHere && (
            <span
              role="button"
              className={`nc-mtg-iconbtn ${stt === null ? 'disabled' : ''}`}
              aria-label={t('lp.meetings.upload_audio', 'Upload audio')}
              aria-disabled={stt === null || undefined}
              data-tooltip={stt === null ? noSttReason() : t('lp.meetings.upload_audio', 'Upload audio')}
              onClick={() => { if (stt) pickAudio(block.id); }}
            ><Icon name="upload" size={16} /></span>
          )}
        </div>
      </div>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

registerBlock(['meeting_notes', 'transcription'], MeetingNotesBlock);

/** "/meet" (AI Meeting Notes in Suggested + Advanced blocks): not in the menu while the workspace has AI Meeting Notes off
 *  (Settings › Meeting notes › Enable Meeting notes for workspace); refused if the switch flips while it is open. */
function slashMeeting(ctx: SlashContext) {
  if (!meetingsEnabled(getBlock(ctx.blockId)?.space_id)) {
    useUI.getState().toast(t('lp.meetings.ai_meeting_notes_are_unavailable_in', 'Meeting notes with AI are unavailable in this workspace'));
    return;
  }
  place(ctx, 'meeting_notes', { focus: false, addTextAfter: false });
  useEditor.setState({ hoverBlock: null });
}
overrideSlashItem('ai-meeting-notes', slashMeeting);
overrideSlashItem('ai-meeting-notes-2', slashMeeting);
hideSlashItemWhen('ai-meeting-notes', () => !meetingsEnabled());
hideSlashItemWhen('ai-meeting-notes-2', () => !meetingsEnabled());

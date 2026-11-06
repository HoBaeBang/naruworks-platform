// AI Meeting Notes block menus: the settings menu (slider icon: Pause / Resume /
// Stop recording and summarize, Upload audio, Retry summary / transcription, Delete transcript / audio, Language, Consent,
// Audio recordings) and the first-use consent choice ("Choose how you notify others").
import type { BlockRecord } from '@nc/shared/records.ts';
import { api, uploadFile } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { run, setFormat } from '../../lib/blocks.ts';
import { openMenu, type MenuItemDef, type MenuSectionDef } from '../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { confirmDialog } from '../page/confirm.tsx';
import { savePref } from '../settings/userSettings.ts';
import { t } from '../shell/i18n.ts';
import { LANGUAGES } from './speech.ts';
import { autoConsentPref, consentEnforced, copyConsent, playConsent } from './consent.ts';
import { deleteRecordings, downloadRecording, listRecordings } from './localAudio.ts';
import { meetingState, pauseMeeting, startMeeting, stopMeeting, liveState } from './session.ts';
import { noSttReason, sttProviderOf } from './capabilities.ts';
import { useState } from 'react';

function merge(r: { recordMap?: any }) {
  if (r?.recordMap) records.mergeRecordMap(r.recordMap);
}

export async function retrySummary(blockId: string) {
  try {
    // the block's current choice goes along: its transaction may still be on the way to the server
    const instructions = (records.get<BlockRecord>('block', blockId)?.format as Record<string, unknown> | undefined)?.meeting_instructions;
    const r = await api<{ status: string; error?: string; recordMap: any }>('meetingSummarize', { blockId, ...(typeof instructions === 'string' && instructions ? { instructions } : {}) });
    merge(r);
    if (r.status === 'error' && r.error) useUI.getState().toast(r.error);
  } catch (e) {
    useUI.getState().toast((e as Error).message || t('lp.meetings.the_summary_could_not_be_created', 'The summary could not be created. Try again.'));
  }
}

export function pickAudio(blockId: string) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.aac,.m4a,.mp3,.wav,audio/aac,audio/mp4,audio/x-m4a,audio/mpeg,audio/wav';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    const b = records.get<BlockRecord>('block', blockId);
    try {
      useUI.getState().toast(t('lp.meetings.uploading_audio', 'Uploading audio'));
      const up = await uploadFile(f, f.name, b?.space_id);
      const r = await api<{ status: string; error?: string; recordMap: any }>('meetingUploadAudio', { blockId, fileId: up.id });
      merge(r);
    } catch (e) {
      useUI.getState().toast((e as Error).message || t('lp.meetings.the_audio_upload_failed_select_the', 'The audio upload failed. Select the file again and retry.'));
    }
  };
  input.click();
}

async function deleteTranscript(blockId: string) {
  const ok = await confirmDialog({
    message: t('lp.meetings.delete_transcript', 'Delete transcript'),
    description: t('lp.meetings.this_deletes_the_transcript_from_the', 'This deletes the transcript from the page. It also deletes this page’s version history.'),
    confirmLabel: t('lp.meetings.delete', 'Delete'),
    cancelLabel: t('lp.meetings.cancel', 'Cancel'),
    danger: true,
  });
  if (!ok) return;
  try {
    merge(await api('meetingDeleteTranscript', { blockId }));
    useUI.getState().toast(t('lp.meetings.transcript_deleted_f30c', 'Transcript deleted.'));
  } catch (e) {
    useUI.getState().toast((e as Error).message || t('lp.meetings.couldn_t_delete_the_transcript', 'Couldn’t delete the transcript.'));
  }
}

async function deleteAudio(blockId: string) {
  const ok = await confirmDialog({
    message: t('lp.meetings.delete_audio', 'Delete audio'),
    description: t('lp.meetings.only_the_audio_playback_gets_deleted', 'Only the audio playback gets deleted. The meeting note keeps its transcript and timestamps.'),
    confirmLabel: t('lp.meetings.delete', 'Delete'),
    cancelLabel: t('lp.meetings.cancel', 'Cancel'),
    danger: true,
  });
  if (!ok) return;
  try {
    merge(await api('meetingDeleteAudio', { blockId }));
    useUI.getState().toast(t('lp.meetings.audio_deleted', 'Audio deleted.'));
  } catch {
    useUI.getState().toast(t('lp.meetings.couldn_t_delete_the_playback_media', 'Couldn’t delete the playback media.'));
  }
}

function setLanguage(blockId: string, key: string) {
  run('meetingNotes.language', (tx) => setFormat(tx, blockId, { meeting_language: key } as never));
}

export interface SettingsContext {
  canEdit: boolean;
  /** Full access to the page: "Delete transcript" also deletes version history (server: meetings/model.ts) */
  fullAccess?: boolean;
  enabled: boolean;
  storeLocally: boolean;
  hasTranscript: boolean;
  hasContent: boolean;
}

/** The slider menu ("Options"). */
export async function openSettingsMenu(anchor: HTMLElement, block: BlockRecord, ctx: SettingsContext) {
  const recordings = ctx.storeLocally ? await listRecordings(block.id) : [];
  const stt = await sttProviderOf(block.space_id);
  const st = meetingState(block);
  const live = liveState(block.id);
  const recording = live.status === 'recording';
  const paused = live.status === 'paused' || st.state === 'paused' || (st.state === 'transcribing' && !recording);
  const lang = ((block.format as Record<string, unknown> | undefined)?.meeting_language as string | undefined) ?? 'auto';
  const enforced = consentEnforced(block.space_id);
  const auto = enforced || autoConsentPref() === true;
  const actions: MenuItemDef[] = [];
  if (ctx.canEdit && ctx.enabled) {
    if (recording) actions.push({ label: t('lp.meetings.pause_transcription', 'Pause transcription'), icon: 'pause', onSelect: () => void pauseMeeting(block.id) });
    if (paused) actions.push({ label: t('lp.meetings.resume_transcription', 'Resume transcription'), icon: 'mic', onSelect: () => void startMeeting(block.id, { resume: true }) });
    if (recording || paused) actions.push({ label: t('lp.meetings.stop_and_summarize', 'Stop recording and summarize'), icon: 'stop', onSelect: () => void stopMeeting(block.id) });
    if (!recording && !paused && st.state !== 'summarizing') {
      if ((st.elapsed_ms ?? 0) > 0) actions.push({ label: t('lp.meetings.resume_transcription', 'Resume transcription'), icon: 'mic', onSelect: () => void startMeeting(block.id, { resume: true }) });
      // no speech-to-text service on this server: shown, but off with the reason
      actions.push(stt
        ? { label: t('lp.meetings.upload_audio', 'Upload audio'), icon: 'upload', onSelect: () => pickAudio(block.id) }
        : { label: t('lp.meetings.upload_audio', 'Upload audio'), icon: 'upload', disabled: true, description: noSttReason() });
      if (ctx.hasContent) actions.push({ label: t('lp.meetings.retry_summary', 'Retry summary'), icon: 'refresh', onSelect: () => void retrySummary(block.id) });
      if (stt && st.audio && st.audio.status === 'failed') actions.push({ label: t('lp.meetings.retry_transcription', 'Retry transcription'), icon: 'refresh', onSelect: () => void api('meetingRetryTranscription', { blockId: block.id }).then(merge).catch((e) => useUI.getState().toast(e.message)) });
    }
    if (ctx.hasTranscript && !recording && ctx.fullAccess) actions.push({ label: t('lp.meetings.delete_transcript', 'Delete transcript'), icon: 'trash', danger: true, onSelect: () => { setTimeout(() => void deleteTranscript(block.id), 0); } });
    if (st.audio && st.audio.status !== 'deleted') actions.push({ label: t('lp.meetings.delete_audio', 'Delete audio'), icon: 'trash', danger: true, onSelect: () => { setTimeout(() => void deleteAudio(block.id), 0); } });
  }
  const sections: MenuSectionDef[] = [];
  if (actions.length) sections.push({ title: t('lp.meetings.actions', 'Actions'), items: actions });
  sections.push({
    items: [{
      label: t('lp.meetings.language', 'Language'),
      icon: 'translate',
      right: <span className="nc-menu-right-label">{LANGUAGES.find((l) => l.key === lang || l.tag === lang)?.label ?? t('lp.meetings.auto_detect', 'Auto detect')}</span>,
      disabled: !ctx.canEdit,
      submenu: () => ({
        width: 220, maxHeight: 360, search: true,
        sections: [{ items: LANGUAGES.map((l) => ({ label: t(`transcriptionBlockSettings.language.${l.key}.title`, l.label), checked: l.key === lang, onSelect: () => setLanguage(block.id, l.key) })) }],
      }),
    }],
  });
  sections.push({
    title: t('lp.meetings.consent', 'Consent'),
    items: [
      { label: t('lp.meetings.play_the_consent_audio', 'Play the consent audio'), icon: 'volumeOn', onSelect: () => void playConsent() },
      { label: t('lp.meetings.copy_the_consent_message', 'Copy the consent message'), icon: 'copy', onSelect: () => void copyConsent(ctx.storeLocally) },
      {
        label: t('lp.meetings.auto_play_consent_audio', 'Auto-play consent audio'),
        icon: 'sparkle',
        checked: auto,
        disabled: enforced,
        description: enforced ? t('lp.meetings.require_consent_from_every_workspace_mem', 'Require consent from every workspace member') : undefined,
        onSelect: () => savePref('meeting_auto_consent', !auto),
      },
    ],
  });
  if (ctx.storeLocally) {
    sections.push({
      items: [{
        label: t('lp.meetings.audio_recordings', 'Audio recordings'),
        icon: 'music',
        submenu: () => ({
          width: 300,
          emptyText: t('lp.meetings.no_recordings_on_this_device', 'No recordings on this device'),
          sections: [
            {
              title: t('lp.meetings.saved_locally_on_this_device', 'Saved locally on this device'),
              items: recordings.map((r) => {
                const d = new Date(r.created);
                const name = t('lp.meetings.audio_recording_at', 'Recording from {lastModifiedDate} at {lastModifiedTime}', {
                  lastModifiedDate: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), lastModifiedTime: d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
                });
                return {
                  label: name, icon: 'download',
                  onSelect: () => void downloadRecording(r.id, `${name}.webm`).then((ok) => { if (!ok) useUI.getState().toast(t('lp.meetings.couldn_t_download_the_audio_recording', 'Couldn’t download the audio recording')); }),
                };
              }),
            },
            ...(recordings.length ? [{ items: [{ label: t('lp.meetings.delete_recordings', 'Delete recordings'), icon: 'trash', danger: true, onSelect: () => void deleteRecordings(block.id) }] }] : []),
          ],
        }),
      }],
    });
  }
  openMenu(anchor, { width: 260, sections }, { placement: 'bottom-end', offset: 4, onClose: () => anchor.classList.remove('open') });
  anchor.classList.add('open');
}

/** First transcription: "Choose how you notify others" (Get consent myself / Automatically play audio). */
export function askConsentChoice(anchor: HTMLElement): Promise<boolean | null> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: boolean | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    openOverlay((close) => <ConsentChoice onDone={(v) => { done(v); close(); }} />, { anchor, placement: 'bottom-end', offset: 6, onClose: () => done(null) });
  });
}

function ConsentChoice({ onDone }: { onDone: (v: boolean) => void }) {
  const [auto, setAuto] = useState(true);
  return (
    <PopoverSurface width={320}>
      <div className="nc-mtg-nux" role="dialog" aria-label={t('lp.meetings.pick_how_to_let_others_know', 'Pick how to let others know')}>
        <h3>{t('lp.meetings.pick_how_to_let_others_know', 'Pick how to let others know')}</h3>
        <p>{t('lp.meetings.litpage_can_announce_your_transcription', 'Litpage can announce your transcription with an audio message, or you can keep getting consent on your own. Choose what happens by default in every meeting:')}</p>
        <label><input type="radio" name="nc-mtg-consent" checked={auto} onChange={() => setAuto(true)} />{t('lp.meetings.play_audio_automatically', 'Play audio automatically')}</label>
        <label><input type="radio" name="nc-mtg-consent" checked={!auto} onChange={() => setAuto(false)} />{t('lp.meetings.ask_for_consent_myself', 'Ask for consent myself')}</label>
        <div className="foot">
          <button className="nc-mtg-start" onClick={() => {
            savePref('meeting_auto_consent', auto);
            useUI.getState().toast(auto
              ? t('lp.meetings.litpage_plays_a_short_audio_message', 'Litpage plays a short audio message when each meeting starts.')
              : t('lp.meetings.you_ll_ask_for_consent_yourself', 'You’ll ask for consent yourself in every meeting.'));
            onDone(auto);
          }}>{t('lp.meetings.start_transcribing', 'Start transcribing')}</button>
        </div>
      </div>
    </PopoverSurface>
  );
}

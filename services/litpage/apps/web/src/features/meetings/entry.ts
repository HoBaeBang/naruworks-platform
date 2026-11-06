// Entry points of AI Meeting Notes: "New AI meeting note" (sidebar, Meetings page,
// Library — a page with the block, in the default meetings database when the person picked one), the empty page's
// "AI Meeting Notes" chip, /meet (hidden when the workspace turned AI Meeting Notes off), and whether the sidebar's
// Meetings tab shows (Settings › Meeting notes › Hide Meeting notes tab, or the workspace switch).
import type { SpaceRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openPage } from '../../lib/router.ts';
import { createBlockIn, getBlock, run } from '../../lib/blocks.ts';
import { useCurrentSpace, useUserSettings } from '../../lib/hooks.ts';
import { getLocale, t } from '../shell/i18n.ts';

export function meetingsEnabled(spaceId?: string | null): boolean {
  const s = records.get<SpaceRecord>('space', spaceId ?? useSession.getState().spaceId);
  return (s?.settings as Record<string, unknown> | undefined)?.meeting_notes_enabled !== false;
}

export function useMeetingsTabHidden(): boolean {
  const space = useCurrentSpace();
  const us = useUserSettings();
  const off = (space?.settings as Record<string, unknown> | undefined)?.meeting_notes_enabled === false;
  const pref = (us?.settings as Record<string, unknown> | undefined)?.meeting_hide_tab;
  return off || pref === 'always';
}

export function meetingsTabHiddenNow(): boolean {
  const uid = useSession.getState().userId;
  const pref = (records.get<UserSettingsRecord>('user_settings', uid)?.settings as Record<string, unknown> | undefined)?.meeting_hide_tab;
  return !meetingsEnabled() || pref === 'always';
}

/** "New AI meeting note": the server creates the page (+ block and sections) and we open it. */
export async function createMeetingNoteFlow() {
  const spaceId = useSession.getState().spaceId;
  if (!meetingsEnabled(spaceId)) {
    useUI.getState().toast(t('lp.meetings.ai_meeting_notes_are_unavailable_in', 'AI meeting notes are unavailable in this workspace'));
    return;
  }
  const title = `${t('lp.meetings.meeting_notes', 'Meeting Notes')} ${new Date().toLocaleDateString(getLocale(), { month: 'short', day: 'numeric' })}`;
  try {
    const r = await api<{ pageId: string; blockId: string; recordMap: any }>('meetingCreateNote', { spaceId, title });
    records.mergeRecordMap(r.recordMap);
    openPage(r.pageId);
  } catch (e) {
    useUI.getState().toast((e as Error).message || t('lp.meetings.creating_the_meeting_note_failed_give', 'Creating the meeting note failed. Give it another try.'));
  }
}

/** The empty page's "AI Meeting Notes" chip: an AI Meeting Notes block at the end of the page. */
export function insertMeetingBlock(pageId: string) {
  if (!meetingsEnabled(getBlock(pageId)?.space_id)) {
    useUI.getState().toast(t('lp.meetings.ai_meeting_notes_are_unavailable_in', 'AI meeting notes are unavailable in this workspace'));
    return;
  }
  const page = getBlock(pageId);
  if (!page) return;
  const last = (page.content ?? []).filter((id) => getBlock(id)?.alive !== false).slice(-1)[0];
  run('meetingNotes.insert', (tx) => { createBlockIn(tx, { type: 'meeting_notes', parentId: pageId, parentTable: 'block', after: last }); });
}

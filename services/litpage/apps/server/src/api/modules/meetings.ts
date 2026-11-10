// AI Meeting Notes endpoints (AI-MTG-*): structure, live transcription session (start / append / pause / resume /
// stop), summary (auto after Stop, "Retry summary"), transcript and audio deletion, audio upload, summary instructions,
// and "New AI meeting note" in the person's default meetings database when they picked one.
// Logic lives in apps/server/src/meetings/*.
import { newId } from '@nc/shared/ids.ts';
import { op as mk } from '@nc/shared/ops.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, SpaceViewRecord, UserRootRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { encodeDate } from '@nc/shared/database/values.ts';
import { getRecord } from '../../db.ts';
import { RecordMapBuilder, applyTransactions, blockRole } from '../../records.ts';
import { OpsBuilder } from '../../content/spec.ts';
import { markdownToSpecs } from '../../ai/edit.ts';
import { aiConfigured } from '../../ai/client.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import {
  MeetingError, appendSegments, cancelTranscription, dailyLimitMs, deleteTranscript, ensureStructure, meetingBlock, meetingsEnabled, msUntilReset, pauseTranscription, sectionId,
  spaceSetting, startTranscription, stopTranscription, usedTodayMs, SECTIONS,
} from '../../meetings/model.ts';
import { summarize } from '../../meetings/summary.ts';
import { ALLOWED_LABEL, deleteAudio, sttProvider, transcribeUploaded, uploadAudio } from '../../meetings/audio.ts';
import { AUTO, BUILTINS, CUSTOM_TEMPLATE, userMeetingPrefs } from '../../meetings/instructions.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof MeetingError) throw Object.assign(new ApiError(e.message, e.status), { code: e.code });
    throw e;
  }
}

async function wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MeetingError) throw Object.assign(new ApiError(e.message, e.status), { code: e.code });
    throw e;
  }
}

/** The meeting block and its sections (with their children) for the caller. */
function blockMap(userId: string, blockId: string) {
  const rm = new RecordMapBuilder(userId);
  const b = getRecord<BlockRecord>('block', blockId);
  if (!b) return rm.map;
  rm.add('block', b);
  for (const s of SECTIONS) {
    const id = sectionId(b, s);
    const sec = id ? getRecord<BlockRecord>('block', id) : undefined;
    if (!sec) continue;
    rm.add('block', sec);
    for (const c of sec.content ?? []) rm.add('block', getRecord<BlockRecord>('block', c));
  }
  return rm.map;
}

function spaceViewOf(userId: string, spaceId: string): SpaceViewRecord | undefined {
  const root = getRecord<UserRootRecord>('user_root', userId);
  return (root?.space_views ?? []).map((id) => getRecord<SpaceViewRecord>('space_view', id)).find((v): v is SpaceViewRecord => !!v && v.space_id === spaceId && v.parent_id === userId && v.alive !== false);
}

function settingsOf(userId: string): Record<string, unknown> {
  return (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
}

function saveSettings(userId: string, patch: Record<string, unknown>) {
  const exists = !!getRecord<UserSettingsRecord>('user_settings', userId);
  applyTransactions(userId, [{
    id: newId(), spaceId: '', debug: { userAction: 'meetingNotes.instructions' },
    operations: [exists ? mk.update({ table: 'user_settings', id: userId }, ['settings'], patch) : mk.set({ table: 'user_settings', id: userId }, [], { id: userId, settings: patch })],
  }], undefined, { client: true });
}

export const handlers: Record<string, Handler> = {
  meetingStatus(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    const prefs = userMeetingPrefs(uid);
    return {
      enabled: meetingsEnabled(space.id),
      enforceConsent: spaceSetting<boolean>(space, 'meeting_enforce_consent', false) === true,
      storeAudioLocally: spaceSetting<boolean>(space, 'meeting_store_audio_locally', false) === true,
      transcriptDeletion: spaceSetting<string>(space, 'meeting_transcript_deletion', 'never'),
      usedTodayMs: usedTodayMs(uid), dailyLimitMs: dailyLimitMs(), resetInMs: msUntilReset(),
      aiConfigured: aiConfigured(), sttProvider: sttProvider()?.label ?? null, audioTypes: ALLOWED_LABEL,
      defaultInstructions: prefs.defaultKey,
    };
  },

  meetingEnsure(ctx, { blockId }) {
    const uid = requireUser(ctx);
    const b = wrap(() => meetingBlock(blockId));
    if (blockRole(b.id, uid) === 'none') throw new ApiError('Not found', 404);
    const next = wrap(() => ensureStructure(b, uid));
    return { recordMap: blockMap(uid, next.id) };
  },

  meetingStart(ctx, { blockId, language, consent }) {
    const uid = requireUser(ctx);
    const r = wrap(() => startTranscription(blockId, uid, { language, consent }));
    return { sessionId: r.sessionId, usedMs: r.usedMs, limitMs: r.limitMs, recordMap: blockMap(uid, r.block.id) };
  },

  meetingResume(ctx, { blockId, language, consent }) {
    const uid = requireUser(ctx);
    const r = wrap(() => startTranscription(blockId, uid, { language, consent, resume: true }));
    return { sessionId: r.sessionId, usedMs: r.usedMs, limitMs: r.limitMs, recordMap: blockMap(uid, r.block.id) };
  },

  meetingAppend(ctx, { blockId, sessionId, segments }) {
    const uid = requireUser(ctx);
    const r = wrap(() => appendSegments(blockId, uid, sessionId, segments));
    return { usedMs: r.usedMs, limitMs: r.limitMs };
  },

  meetingPause(ctx, { blockId, sessionId }) {
    const uid = requireUser(ctx);
    wrap(() => pauseTranscription(blockId, uid, sessionId));
    return { recordMap: blockMap(uid, String(blockId)) };
  },

  /** The microphone failed before anything was captured: undo Start / Resume. */
  meetingCancel(ctx, { blockId, sessionId }) {
    const uid = requireUser(ctx);
    const b = wrap(() => cancelTranscription(blockId, uid, sessionId));
    return { recordMap: blockMap(uid, b.id) };
  },

  /** Stop → the summary is written in the background (the block shows "Summarizing" via realtime). */
  meetingStop(ctx, { blockId, sessionId }) {
    const uid = requireUser(ctx);
    const b = wrap(() => stopTranscription(blockId, uid, sessionId));
    void summarize(b.id, uid, { auto: true }).catch((e) => console.error('[meetings] summary failed', e));
    return { recordMap: blockMap(uid, b.id) };
  },

  /** "Retry summary" (and summarizing with other instructions). */
  async meetingSummarize(ctx, { blockId, instructions }) {
    const uid = requireUser(ctx);
    const r = await wrapAsync(() => summarize(blockId, uid, { instructions }));
    return { ...r, recordMap: blockMap(uid, String(blockId)) };
  },

  meetingDeleteTranscript(ctx, { blockId }) {
    const uid = requireUser(ctx);
    const b = wrap(() => deleteTranscript(blockId, uid, 'user'));
    return { recordMap: blockMap(uid, b.id) };
  },

  async meetingUploadAudio(ctx, { blockId, fileId }) {
    const uid = requireUser(ctx);
    const r = await wrapAsync(() => uploadAudio(blockId, uid, fileId));
    return { ...r, recordMap: blockMap(uid, String(blockId)) };
  },

  async meetingRetryTranscription(ctx, { blockId }) {
    const uid = requireUser(ctx);
    const b = wrap(() => meetingBlock(blockId));
    if (!roleAtLeast(blockRole(b.id, uid), 'read_and_write')) throw new ApiError('You do not have access to transcribe this recording', 403);
    const r = await wrapAsync(() => transcribeUploaded(b.id, uid));
    return { ...r, recordMap: blockMap(uid, b.id) };
  },

  meetingDeleteAudio(ctx, { blockId }) {
    const uid = requireUser(ctx);
    const b = wrap(() => deleteAudio(blockId, uid));
    return { recordMap: blockMap(uid, b.id) };
  },

  // ---------------------------------------------------------------- instructions (.x)

  meetingInstructions(ctx) {
    const uid = requireUser(ctx);
    const prefs = userMeetingPrefs(uid);
    const rm = new RecordMapBuilder(uid);
    const custom = prefs.pages.map((id) => {
      const p = getRecord<BlockRecord>('block', id);
      const ok = !!p && p.alive !== false && blockRole(id, uid) !== 'none';
      if (ok) rm.add('block', p);
      return { pageId: id, available: ok };
    });
    return { builtins: BUILTINS.map((b) => ({ key: b.key, name: b.name, icon: b.icon })), custom, defaultKey: prefs.defaultKey, auto: AUTO, recordMap: rm.map };
  },

  /** "+ Add custom instructions": a private page from the template, already in the person's menu. */
  meetingCreateInstructions(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    const sv = spaceViewOf(uid, space.id);
    if (!sv) throw new ApiError('Not found', 404);
    const b = new OpsBuilder(space.id, uid);
    const id = b.block({ type: 'page', text: 'Meeting summary instructions', icon: '📝', format: { meeting_instruction: true }, children: markdownToSpecs(CUSTOM_TEMPLATE) }, space.id, 'space', {
      permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }],
    });
    b.ops.push(mk.listBefore({ table: 'space_view', id: sv.id, spaceId: space.id }, ['private_pages'], id));
    applyTransactions(uid, [{ id: newId(), spaceId: space.id, debug: { userAction: 'meetingNotes.createInstructions' }, operations: b.ops }], undefined, { client: true });
    const prefs = userMeetingPrefs(uid);
    saveSettings(uid, { meeting_instructions: [...prefs.pages.filter((x) => x !== id), id] });
    const rm = new RecordMapBuilder(uid);
    rm.add('block', getRecord<BlockRecord>('block', id));
    return { pageId: id, recordMap: rm.map };
  },

  /** Page ••• › Use as AI meeting instruction (editors mark the page) / "+ Add to my instructions" (anyone who can read). */
  meetingAddInstructions(ctx, { pageId, mark }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || page.alive === false || page.type !== 'page' || blockRole(page.id, uid) === 'none') throw new ApiError('Not found', 404);
    if (mark && !(page.format as Record<string, unknown> | undefined)?.meeting_instruction) {
      if (!roleAtLeast(blockRole(page.id, uid), 'read_and_write')) throw new ApiError('You need edit access to turn this page into AI meeting instructions.', 403);
      applyTransactions(uid, [{ id: newId(), spaceId: page.space_id, debug: { userAction: 'meetingNotes.markInstructions' }, operations: [mk.update({ table: 'block', id: page.id, spaceId: page.space_id }, ['format'], { meeting_instruction: true })] }], undefined, { client: true });
    }
    const prefs = userMeetingPrefs(uid);
    if (!prefs.pages.includes(page.id)) saveSettings(uid, { meeting_instructions: [...prefs.pages, page.id].slice(-50) });
    return { ok: true };
  },

  /** Instructions menu ••• › Remove from menu / Set as default. */
  meetingUpdateInstructions(ctx, { remove, defaultKey }) {
    const uid = requireUser(ctx);
    const prefs = userMeetingPrefs(uid);
    const patch: Record<string, unknown> = {};
    if (typeof remove === 'string') {
      patch.meeting_instructions = prefs.pages.filter((x) => x !== remove);
      if (prefs.defaultKey === remove) patch.meeting_default_instructions = AUTO;
    }
    if (typeof defaultKey === 'string') {
      const ok = defaultKey === AUTO || BUILTINS.some((b) => b.key === defaultKey) || prefs.pages.includes(defaultKey);
      if (!ok) throw new ApiError('Unknown instructions', 400);
      patch.meeting_default_instructions = defaultKey;
    }
    if (Object.keys(patch).length) saveSettings(uid, patch);
    return { ok: true };
  },

  // ---------------------------------------------------------------- new meeting note

  /** Sidebar / Meetings "New AI meeting note": a page with an AI Meeting Notes block, in the default meetings database
   *  (Settings › Meeting notes › Select default meetings database) when the person can add rows there. */
  meetingCreateNote(ctx, { spaceId, title }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    if (!meetingsEnabled(space.id)) throw new ApiError('AI meeting notes are unavailable in this workspace', 403);
    const name = typeof title === 'string' && title.trim() ? title.trim().slice(0, 200) : 'Meeting notes';
    const b = new OpsBuilder(space.id, uid);
    const dbId = settingsOf(uid).meeting_default_db;
    const col = typeof dbId === 'string' ? getRecord<CollectionRecord>('collection', dbId) : undefined;
    const host = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
    let pageId = '';
    let where: 'database' | 'private' = 'private';
    const meetingId = newId();
    if (col && host && col.alive !== false && host.alive !== false && host.space_id === space.id && roleAtLeast(blockRole(host.id, uid), 'read_and_write')) {
      const props: Record<string, RichText> = {};
      const dateProp = Object.entries(col.schema ?? {}).find(([, p]) => p?.type === 'date');
      if (dateProp) props[dateProp[0]] = encodeDate({ type: 'date', start_date: new Date().toISOString().slice(0, 10) })!;
      pageId = b.block({ type: 'page', text: name, props, children: [] }, col.id, 'collection');
      for (const vid of host.view_ids ?? []) {
        const v = getRecord<CollectionViewRecord>('collection_view', vid);
        if (v?.page_sort?.length) b.ops.push(mk.listBefore({ table: 'collection_view', id: v.id, spaceId: space.id }, ['page_sort'], pageId));
      }
      where = 'database';
    } else {
      const sv = spaceViewOf(uid, space.id);
      if (!sv) throw new ApiError('Not found', 404);
      pageId = b.block({ type: 'page', text: name, children: [] }, space.id, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }] });
      b.ops.push(mk.listBefore({ table: 'space_view', id: sv.id, spaceId: space.id }, ['private_pages'], pageId));
    }
    b.block({ type: 'meeting_notes', text: [] }, pageId, 'block', { id: meetingId });
    b.ops.push(mk.listAfter({ table: 'block', id: pageId, spaceId: space.id }, ['content'], meetingId));
    applyTransactions(uid, [{ id: newId(), spaceId: space.id, debug: { userAction: 'meetingNotes.createNote' }, operations: b.ops }], undefined, { client: true });
    ensureStructure(getRecord<BlockRecord>('block', meetingId)!, uid);
    const rm = new RecordMapBuilder(uid);
    rm.add('block', getRecord<BlockRecord>('block', pageId));
    const map = { ...rm.map, ...blockMap(uid, meetingId) } as Record<string, any>;
    map.block = { ...(rm.map as any).block, ...(blockMap(uid, meetingId) as any).block };
    return { pageId, blockId: meetingId, where, recordMap: map };
  },
};

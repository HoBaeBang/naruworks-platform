// AI Meeting Notes server: block structure, live transcription session rules (consent, edit access,
// one transcriber, workspace switch, templates, daily limit), speaker runs, stop → summary with transcript citations,
// title and @mentions (fake Claude client), "connect a key" state, the Custom Agents hook, transcript deletion (by
// person and by the Enterprise retention policy), audio upload without / with a speech-to-text provider, summary
// instructions, "New AI meeting note" in the default meetings database, and the public API's transcription block.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-meetings-test-'));
delete process.env.ANTHROPIC_API_KEY;
vi.setConfig({ testTimeout: 30_000 });

type Ev = Record<string, any>;
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fake(text: string, seen: any[] = []) {
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const events: Ev[] = [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }];
          return {
            async *[Symbol.asyncIterator]() { for (const e of events) yield e; },
            finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }),
          };
        }) as any,
      },
    },
  };
}

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let model: typeof import('../src/meetings/model.ts');
let summary: typeof import('../src/meetings/summary.ts');
let audio: typeof import('../src/meetings/audio.ts');
let events: typeof import('../src/meetings/events.ts');
let app: typeof import('../src/app.ts')['app'];
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, ip: '127.0.0.1', setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}
const now = Date.now();
function block(id: string, type: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}) {
  return { id, version: 1, type, parent_id: parentId, parent_table: parentTable, space_id: ids.space, alive: true, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner, ...extra } as any;
}
const rec = (id: string) => db.getRecord<any>('block', id)!;
const state = (id: string) => rec(id).format?.transcription_state ?? { state: 'notes_ready' };
const text = (id: string) => (rec(id).properties?.title ?? []).map((d: any) => d[0]).join('');

function newMeeting(): string {
  const mid = newId();
  const page = rec(ids.page);
  db.putRecord('block', { ...page, version: page.version + 1, content: [...(page.content ?? []), mid] });
  db.putRecord('block', block(mid, 'meeting_notes', ids.page, 'block', { properties: { title: [] } }));
  return mid;
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  app = (await import('../src/app.ts')).app;
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  model = await import('../src/meetings/model.ts');
  summary = await import('../src/meetings/summary.ts');
  audio = await import('../src/meetings/audio.ts');
  events = await import('../src/meetings/events.ts');
  for (const n of ['owner', 'editor', 'viewer', 'outsider']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@mtg.test`, n === 'owner' ? 'Ada Lovelace' : n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  seed.addMember(ids.space, ids.editor, 'editor');
  seed.addMember(ids.space, ids.viewer, 'editor');
  ids.page = newId();
  db.putRecord('block', block(ids.page, 'page', ids.space, 'space', {
    properties: { title: [['Weekly sync']] }, content: [],
    permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'read_and_write', user_id: ids.editor }, { type: 'user_permission', role: 'reader', user_id: ids.viewer }],
  }));
});

describe('structure', () => {
  it('ensure creates Summary / Notes / Transcript sections once (legacy notes move into Notes)', async () => {
    const mid = newMeeting();
    const legacy = newId();
    db.putRecord('block', { ...rec(mid), content: [legacy] });
    db.putRecord('block', block(legacy, 'text', mid, 'block', { properties: { title: [['agenda item']] } }));
    const r = await call(ids.owner, 'meetingEnsure', { blockId: mid });
    expect(Object.keys(r.recordMap.block)).toContain(mid);
    const b = rec(mid);
    const [sum, notes, tr] = ['summary', 'notes', 'transcript'].map((s) => model.sectionId(b, s as any)!);
    expect(b.content).toEqual([sum, notes, tr]);
    expect(rec(notes).format.meeting_section).toBe('notes');
    expect(rec(notes).content).toEqual([legacy]);
    expect(rec(legacy).parent_id).toBe(notes);
    await call(ids.editor, 'meetingEnsure', { blockId: mid });
    expect(rec(mid).content).toHaveLength(3);
    // a viewer can't create them
    const m2 = newMeeting();
    await call(ids.viewer, 'meetingEnsure', { blockId: m2 });
    expect(rec(m2).format?.transcription_notes_id).toBeUndefined();
  });
});

describe('live transcription session', () => {
  it('needs consent, edit access, an enabled workspace and a non-template page', async () => {
    ids.m = newMeeting();
    expect(await status(() => call(ids.owner, 'meetingStart', { blockId: ids.m }))).toBe(400);
    expect(await status(() => call(ids.viewer, 'meetingStart', { blockId: ids.m, consent: true }))).toBe(403);
    expect(await status(() => call(ids.outsider, 'meetingStart', { blockId: ids.m, consent: true }))).toBe(404);
    const space = db.getRecord<any>('space', ids.space)!;
    db.putRecord('space', { ...space, settings: { ...space.settings, meeting_notes_enabled: false } });
    expect(await status(() => call(ids.owner, 'meetingStart', { blockId: ids.m, consent: true }))).toBe(403);
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, settings: { ...space.settings, meeting_notes_enabled: true } });
    const tpl = newMeeting();
    db.putRecord('block', { ...rec(tpl), is_template: true });
    expect(await status(() => call(ids.owner, 'meetingStart', { blockId: tpl, consent: true }))).toBe(400);
  });

  it('starts, joins final results into speaker runs, one transcriber at a time', async () => {
    const r = await call(ids.owner, 'meetingStart', { blockId: ids.m, consent: true, language: 'en-US' });
    ids.session = r.sessionId;
    expect(state(ids.m)).toMatchObject({ state: 'transcribing', transcriber_id: ids.owner, language: 'en-US' });
    expect(await status(() => call(ids.editor, 'meetingStart', { blockId: ids.m, consent: true }))).toBe(409);
    expect(await status(() => call(ids.editor, 'meetingAppend', { blockId: ids.m, sessionId: ids.session, segments: [{ text: 'x' }] }))).toBe(409);
    await call(ids.owner, 'meetingAppend', { blockId: ids.m, sessionId: ids.session, segments: [{ text: 'Let us review the launch plan.', startMs: 0, endMs: 2000 }, { text: 'Marketing needs the copy by Friday.', startMs: 2100, endMs: 4000 }] });
    await call(ids.owner, 'meetingAppend', { blockId: ids.m, sessionId: ids.session, segments: [{ text: 'I can take that.', startMs: 4500, endMs: 5000, speaker: 'Speaker 2' }] });
    const runs = model.transcriptRuns(rec(ids.m));
    expect(runs).toHaveLength(2);
    expect(text(runs[0].id)).toBe('Let us review the launch plan. Marketing needs the copy by Friday.');
    expect(runs[0].format).toMatchObject({ meeting_speaker: 'Ada Lovelace’s microphone', meeting_speaker_id: ids.owner, meeting_start_ms: 0, meeting_end_ms: 4000 });
    expect(runs[1].format.meeting_speaker).toBe('Speaker 2');
  });

  it('pause → another editor resumes as the transcriber; stale sessions are refused', async () => {
    await call(ids.owner, 'meetingPause', { blockId: ids.m, sessionId: ids.session });
    expect(state(ids.m).state).toBe('paused');
    const r = await call(ids.editor, 'meetingResume', { blockId: ids.m, consent: true });
    expect(state(ids.m)).toMatchObject({ state: 'transcribing', transcriber_id: ids.editor });
    expect(await status(() => call(ids.owner, 'meetingAppend', { blockId: ids.m, sessionId: ids.session, segments: [{ text: 'late' }] }))).toBe(409);
    await call(ids.editor, 'meetingAppend', { blockId: ids.m, sessionId: r.sessionId, segments: [{ text: 'Editor here, budget approved.', startMs: 6000, endMs: 7000 }] });
    ids.session = r.sessionId;
    expect(model.transcriptRuns(rec(ids.m)).map((x) => x.format.meeting_speaker)).toEqual(['Ada Lovelace’s microphone', 'Speaker 2', 'Editor’s microphone']);
  });

  it('microphone blocked right away: Cancel undoes Start / Resume (heard lines are kept, like Pause)', async () => {
    const m = newMeeting();
    const s = await call(ids.owner, 'meetingStart', { blockId: m, consent: true });
    await call(ids.owner, 'meetingCancel', { blockId: m, sessionId: s.sessionId });
    expect(state(m).state).toBe('notes_ready');
    expect(state(m).session_id).toBeUndefined();
    expect(state(m).transcriber_id).toBeUndefined();
    const s2 = await call(ids.owner, 'meetingStart', { blockId: m, consent: true });
    await call(ids.owner, 'meetingAppend', { blockId: m, sessionId: s2.sessionId, segments: [{ text: 'First words.' }] });
    await call(ids.owner, 'meetingPause', { blockId: m, sessionId: s2.sessionId });
    const s3 = await call(ids.owner, 'meetingResume', { blockId: m, consent: true });
    await call(ids.owner, 'meetingCancel', { blockId: m, sessionId: s3.sessionId });
    expect(state(m)).toMatchObject({ state: 'paused', transcriber_id: ids.owner });
    expect(state(m).session_id).toBeUndefined();
    const s4 = await call(ids.owner, 'meetingResume', { blockId: m, consent: true });
    await call(ids.owner, 'meetingAppend', { blockId: m, sessionId: s4.sessionId, segments: [{ text: 'More words.' }] });
    await call(ids.owner, 'meetingCancel', { blockId: m, sessionId: s4.sessionId });
    expect(state(m).state).toBe('paused');
    expect(model.transcriptRuns(rec(m)).map((x) => text(x.id)).join(' ')).toContain('More words.');
    expect(await status(() => call(ids.owner, 'meetingCancel', { blockId: m, sessionId: s4.sessionId }))).toBe(409);
    expect(await status(() => call(ids.editor, 'meetingCancel', { blockId: m, sessionId: s4.sessionId }))).toBe(409);
  });

  it('the daily limit pauses the recording with "You’ve reached your limit"', async () => {
    const m = newMeeting();
    const s = await call(ids.viewer === ids.viewer ? ids.owner : ids.owner, 'meetingStart', { blockId: m, consent: true });
    process.env.NC_MEETING_DAILY_LIMIT_MS = '1';
    db.db.prepare('INSERT INTO meeting_usage (user_id, day, ms) VALUES (?, ?, 5) ON CONFLICT(user_id, day) DO UPDATE SET ms = ms + 5').run(ids.owner, new Date().toISOString().slice(0, 10));
    expect(await status(() => call(ids.owner, 'meetingAppend', { blockId: m, sessionId: s.sessionId, segments: [{ text: 'hello' }] }))).toBe(429);
    expect(state(m)).toMatchObject({ state: 'paused', error: { code: 'rate_limited' } });
    expect(await status(() => call(ids.owner, 'meetingStart', { blockId: newMeeting(), consent: true }))).toBe(429);
    delete process.env.NC_MEETING_DAILY_LIMIT_MS;
  });
});

describe('summary', () => {
  it('stop → summary with citations, mentions and a generated title; the Custom Agents hook fires', async () => {
    model.stopTranscription(ids.m, ids.editor, ids.session);
    expect(state(ids.m).state).toBe('transcript_ready');
    const fired: any[] = [];
    const off = events.onMeetingNoteSummarized((e) => { fired.push(e); });
    const seen: any[] = [];
    const out = '# Launch plan sync\n\n### Action items\n- [ ] Send the marketing copy @Ada by Friday [L1]\n\n### Key takeaways\n- Budget approved [L3]\n- Launch plan reviewed [L1, L2]';
    const r = await summary.summarize(ids.m, ids.editor, { client: fake(out, seen) as any });
    off();
    expect(r.status).toBe('complete');
    const userTurn = seen[0].messages[0].content as string;
    expect(userTurn).toContain('L1 [00:00] Ada Lovelace’s microphone: Let us review the launch plan.');
    expect(userTurn).toContain('<instructions name="Auto">');
    expect(seen[0].system[0].text).toContain('You write the summary of a meeting');
    const b = rec(ids.m);
    expect(text(ids.m)).toBe('Launch plan sync');
    expect(state(ids.m).state).toBe('summary_ready');
    const sid = model.sectionId(b, 'summary')!;
    const kids = rec(sid).content.map((id: string) => rec(id));
    expect(kids.map((k: any) => k.type)).toEqual(['sub_sub_header', 'to_do', 'sub_sub_header', 'bulleted_list', 'bulleted_list']);
    const runs = model.transcriptRuns(b);
    const todo = kids[1].properties.title;
    expect(todo.some((d: any) => (d[1] ?? []).some((a: any) => a[0] === 'u' && a[1] === ids.owner))).toBe(true);
    const links = kids.flatMap((k: any) => (k.properties.title ?? []).flatMap((d: any) => (d[1] ?? []).filter((a: any) => a[0] === 'a').map((a: any) => a[1])));
    expect(links).toContain(`#mtg-cite-${runs[0].id}`);
    expect(links).toContain(`#mtg-cite-${runs[2].id}`);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({ blockId: ids.m, pageId: ids.page, userId: ids.editor, title: 'Launch plan sync' });
    expect(fired[0].summaryMarkdown).toContain('#mtg-cite-');
  });

  it('without an API key the block shows the connect-a-key error; viewers can’t summarize', async () => {
    const r = await call(ids.owner, 'meetingSummarize', { blockId: ids.m });
    expect(r.status).toBe('error');
    expect(state(ids.m)).toMatchObject({ state: 'error', error: { code: 'no_key', message: 'Connect an AI provider to use Litpage AI' } });
    expect(await status(() => call(ids.viewer, 'meetingSummarize', { blockId: ids.m }))).toBe(403);
  });

  it('custom instructions: create, use, default, unreadable → Auto', async () => {
    const c = await call(ids.editor, 'meetingCreateInstructions', { spaceId: ids.space });
    expect(rec(c.pageId).format.meeting_instruction).toBe(true);
    const list = await call(ids.editor, 'meetingInstructions', {});
    expect(list.custom.map((x: any) => x.pageId)).toContain(c.pageId);
    expect(list.builtins.map((x: any) => x.name)).toContain('Standup');
    await call(ids.editor, 'meetingUpdateInstructions', { defaultKey: c.pageId });
    const seen: any[] = [];
    await summary.summarize(ids.m, ids.editor, { client: fake('### Notes\n- ok [L1]', seen) as any });
    expect(seen[0].messages[0].content).toContain('Meeting summary instructions');
    expect(seen[0].messages[0].content).toContain('Team context');
    // the owner can't read the editor's private instructions page → Auto
    const seen2: any[] = [];
    await summary.summarize(ids.m, ids.owner, { client: fake('### Notes\n- ok', seen2) as any, instructions: c.pageId });
    expect(seen2[0].messages[0].content).toContain('<instructions name="Auto">');
    await call(ids.editor, 'meetingUpdateInstructions', { remove: c.pageId });
    expect((await call(ids.editor, 'meetingInstructions', {})).defaultKey).toBe('auto');
  });

  it('citation markers map to transcript line ids', () => {
    const c = summary.citeMarkdown('# T\n- a [L2]\n- b [L1-L2]\n- c [L9]', [{ n: 1, id: 'one' }, { n: 2, id: 'two' }]);
    expect(c.title).toBe('T');
    expect(c.markdown).toBe('- a [1](#mtg-cite-two)\n- b [2](#mtg-cite-one) [1](#mtg-cite-two)\n- c');
  });
});

describe('public API', () => {
  it('a connection reads the transcription block, its sections and the meeting as Markdown', async () => {
    const c = await call(ids.owner, 'devCreateConnection', { spaceId: ids.space, name: 'Meetings bot' });
    await call(ids.owner, 'devAddPageConnection', { pageId: ids.page, connectionId: c.connection.id });
    const headers = { authorization: `Bearer ${c.token}`, 'lit-version': '2026-10-01' };
    const res = await app.request(`/v1/blocks/${ids.m}`, { headers });
    const b = await res.json() as any;
    expect(b.type).toBe('transcription');
    const b0 = rec(ids.m);
    expect(b.transcription).toMatchObject({ status: 'summary_ready', children: { summary_block_id: model.sectionId(b0, 'summary'), transcript_block_id: model.sectionId(b0, 'transcript') } });
    expect(b.transcription.title[0].plain_text).toBe('Launch plan sync');
    const tr = await (await app.request(`/v1/blocks/${b.transcription.children.transcript_block_id}/children`, { headers })).json() as any;
    expect(tr.results[0].paragraph.rich_text[0].plain_text).toContain('Let us review the launch plan');
    const md = await (await app.request(`/v1/pages/${ids.page}/markdown`, { headers })).json() as any;
    expect(md.markdown).toContain('## Launch plan sync');
    expect(md.markdown).toContain('### Transcript');
    expect(md.markdown).toMatch(/\*\*Ada Lovelace’s microphone \(00:00\): \*\*Let us review/);
  });
});

describe('deletion and retention', () => {
  it('delete transcript removes the lines and the version history entries that hold them (Full access)', async () => {
    // an entry from before the transcript existed stays; one holding transcript lines goes
    db.db.prepare('INSERT INTO snapshots (id, page_id, space_id, created_time, author_ids, data) VALUES (?, ?, ?, ?, ?, ?)').run(newId(), ids.page, ids.space, Date.now(), '[]', '{"blocks":[]}');
    (await import('../src/history.ts')).takeSnapshot(ids.page, [ids.owner]);
    const n = () => (db.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE page_id = ?').get(ids.page) as any).n;
    const before = n();
    expect(await status(() => call(ids.viewer, 'meetingDeleteTranscript', { blockId: ids.m }))).toBe(403);
    expect(await status(() => call(ids.editor, 'meetingDeleteTranscript', { blockId: ids.m }))).toBe(403);
    await call(ids.owner, 'meetingDeleteTranscript', { blockId: ids.m });
    expect(model.transcriptRuns(rec(ids.m))).toHaveLength(0);
    expect(state(ids.m).transcript_deleted).toMatchObject({ by: 'user' });
    expect(n()).toBe(before - 1);
  });

  it('Enterprise automatic transcript deletion', async () => {
    const m = newMeeting();
    const s = await call(ids.owner, 'meetingStart', { blockId: m, consent: true });
    await call(ids.owner, 'meetingAppend', { blockId: m, sessionId: s.sessionId, segments: [{ text: 'old words' }] });
    model.stopTranscription(m, ids.owner, s.sessionId);
    expect(audio.runTranscriptRetention(Date.now() + 8 * 86_400_000)).toBe(0); // policy off
    const space = db.getRecord<any>('space', ids.space)!;
    db.putRecord('space', { ...space, plan_type: 'enterprise', settings: { ...space.settings, meeting_transcript_deletion: '7' } });
    expect(audio.runTranscriptRetention(Date.now() + 2 * 86_400_000)).toBe(0); // too recent
    expect(audio.runTranscriptRetention(Date.now() + 8 * 86_400_000)).toBeGreaterThanOrEqual(1);
    expect(model.transcriptRuns(rec(m))).toHaveLength(0);
    expect(state(m).transcript_deleted.by).toBe('policy');
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, plan_type: 'plus', settings: space.settings });
  });
});

describe('audio upload', () => {
  async function upload(name: string, mime: string, user = ids.owner) {
    const { storeFile } = await import('../src/content/files.ts');
    return storeFile(name, Buffer.from('ID3fakeaudio'), user, ids.space, mime);
  }

  it('refuses video / other files and someone else’s upload', async () => {
    const m = newMeeting();
    const v = await upload('call.mov', 'video/quicktime');
    expect(await status(() => call(ids.owner, 'meetingUploadAudio', { blockId: m, fileId: v.id }))).toBe(400);
    const other = await upload('a.mp3', 'audio/mpeg', ids.editor);
    expect(await status(() => call(ids.owner, 'meetingUploadAudio', { blockId: m, fileId: other.id }))).toBe(400);
  });

  it('without a speech-to-text provider: Litpage’s "couldn’t be transcribed" state; the audio expires', async () => {
    const m = newMeeting();
    const f = await upload('standup.mp3', 'audio/mpeg');
    const r = await call(ids.owner, 'meetingUploadAudio', { blockId: m, fileId: f.id });
    expect(r.status).toBe('error');
    expect(state(m)).toMatchObject({ state: 'error', error: { code: 'stt_unavailable', message: 'This recording could not be transcribed.' }, audio: { status: 'failed', name: 'standup.mp3' } });
    await call(ids.owner, 'meetingDeleteAudio', { blockId: m });
    expect(state(m).audio.status).toBe('deleted');
    expect(db.db.prepare('SELECT 1 FROM files WHERE id = ?').get(f.id)).toBeUndefined();
  });

  it('with a provider: the transcript is imported and the audio deleted', async () => {
    audio.registerSttProvider({ id: 'fake', label: 'Fake STT', transcribe: async () => ({ segments: [{ text: 'Hello team', startMs: 0, endMs: 900, speaker: 'Speaker 1' }, { text: 'Hi!', startMs: 1000, endMs: 1500, speaker: 'Speaker 2' }] }) });
    const m = newMeeting();
    const f = await upload('call.m4a', 'audio/mp4');
    const r = await call(ids.owner, 'meetingUploadAudio', { blockId: m, fileId: f.id });
    expect(r.status).toBe('complete');
    expect(model.transcriptRuns(rec(m)).map((x) => [x.format.meeting_speaker, text(x.id)])).toEqual([['Speaker 1', 'Hello team'], ['Speaker 2', 'Hi!']]);
    expect(state(m).audio.status).toBe('deleted');
    expect(db.db.prepare('SELECT 1 FROM files WHERE id = ?').get(f.id)).toBeUndefined();
  });
});

describe('meeting note creation', () => {
  it('lands in the default meetings database (with today’s date) or the person’s private pages', async () => {
    const p = await call(ids.editor, 'meetingCreateNote', { spaceId: ids.space });
    expect(p.where).toBe('private');
    expect(rec(p.pageId).content).toEqual([p.blockId]);
    expect(rec(p.blockId).format.transcription_summary_id).toBeTruthy();
    // a default meetings database
    const dbb = newId();
    const col = newId();
    const page = rec(ids.page);
    db.putRecord('block', { ...page, content: [...page.content, dbb] });
    db.putRecord('block', block(dbb, 'collection_view', ids.page, 'block', { collection_id: col, view_ids: [] }));
    db.putRecord('collection', { id: col, version: 1, parent_id: dbb, parent_table: 'block', alive: true, space_id: ids.space, name: [['Meetings']], schema: { title: { name: 'Name', type: 'title' }, dt: { name: 'Date', type: 'date' } } } as any);
    db.putRecord('user_settings', { id: ids.editor, version: 1, settings: { meeting_default_db: col } } as any);
    const r = await call(ids.editor, 'meetingCreateNote', { spaceId: ids.space });
    expect(r.where).toBe('database');
    expect(rec(r.pageId).parent_id).toBe(col);
    expect(rec(r.pageId).properties.dt[0][1][0][1].start_date).toBe(new Date().toISOString().slice(0, 10));
    // a viewer of the database falls back to their private pages
    db.putRecord('user_settings', { id: ids.viewer, version: 1, settings: { meeting_default_db: col } } as any);
    expect((await call(ids.viewer, 'meetingCreateNote', { spaceId: ids.space })).where).toBe('private');
  });
});

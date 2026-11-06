// AI Meeting Notes security.
// - item 4: "Delete audio", re-upload and transcription only touch files uploaded as that block's audio (server-side
// upload record) — a file id written into the block's state by any editor is never read or deleted
// - item 5: an instructions page someone else chose on the block is used only when that person and everyone who can
// open the meeting note can read it; the summarizer's own choice (their default, a different key they send, or the
// block's choice when they made it) needs only their access
// - item 6: "Delete transcript" needs Full access and a transcript; it deletes the lines (text included) and only the
// version history entries that hold the transcript
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-meetings-test-'));
process.env.NC_SCHEDULER = '0';
delete process.env.ANTHROPIC_API_KEY;
vi.setConfig({ testTimeout: 30_000 });

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fake(text: string, seen: any[] = []) {
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const events = [{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }];
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
let records: typeof import('../src/records.ts');
let model: typeof import('../src/meetings/model.ts');
let summary: typeof import('../src/meetings/summary.ts');
let audio: typeof import('../src/meetings/audio.ts');
let files: typeof import('../src/content/files.ts');
let history: typeof import('../src/history.ts');
let op: typeof import('@nc/shared/ops.ts')['op'];
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
const rec = (id: string) => db.getRecord<any>('block', id)!;
const state = (id: string) => rec(id).format?.transcription_state ?? { state: 'notes_ready' };
const fileExists = (id: string) => !!db.db.prepare('SELECT 1 AS hit FROM files WHERE id = ?').get(id) && existsSync(files.fileRow(id)!.path);

function block(id: string, type: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}) {
  return { id, version: 1, type, parent_id: parentId, parent_table: parentTable, space_id: ids.space, alive: true, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner, ...extra } as any;
}

function newMeeting(pageId = ids.page): string {
  const mid = newId();
  const page = rec(pageId);
  db.putRecord('block', { ...page, version: page.version + 1, content: [...(page.content ?? []), mid] });
  db.putRecord('block', block(mid, 'meeting_notes', pageId, 'block', { properties: { title: [] } }));
  model.ensureStructure(rec(mid), ids.owner);
  return mid;
}

/** A client transaction (what any editor can send from the browser). */
function clientWrite(userId: string, blockId: string, format: Record<string, unknown>) {
  records.applyTransactions(userId, [{ id: newId(), spaceId: ids.space, operations: [op.update({ table: 'block', id: blockId, spaceId: ids.space }, ['format'], format)] }], undefined, { client: true });
}

async function withTranscript(m: string, words = 'We agreed to ship the beta on Friday and review metrics next week.') {
  const s = await call(ids.owner, 'meetingStart', { blockId: m, consent: true });
  await call(ids.owner, 'meetingAppend', { blockId: m, sessionId: s.sessionId, segments: [{ text: words, startMs: 0, endMs: 3000 }] });
  model.stopTranscription(m, ids.owner, s.sessionId);
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  ({ op } = await import('@nc/shared/ops.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  records = await import('../src/records.ts');
  model = await import('../src/meetings/model.ts');
  summary = await import('../src/meetings/summary.ts');
  audio = await import('../src/meetings/audio.ts');
  files = await import('../src/content/files.ts');
  history = await import('../src/history.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['owner', 'editor', 'viewer', 'friend']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@aisec-mtg.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  for (const n of ['editor', 'viewer', 'friend']) seed.addMember(ids.space, ids[n], 'member');
  db.putRecord('space', { ...db.getRecord<any>('space', ids.space), plan_type: 'business' });
  ids.page = newId();
  db.putRecord('block', block(ids.page, 'page', ids.space, 'space', {
    properties: { title: [['Weekly sync']] }, content: [],
    permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'read_and_write', user_id: ids.editor }, { type: 'user_permission', role: 'reader', user_id: ids.viewer }],
  }));
});

describe('meeting audio files (item 4)', () => {
  it('a file id planted in the block state is never deleted, read or transcribed', async () => {
    const victim = files.storeFile('board-deck.pdf', Buffer.from('%PDF-1.4 secret deck'), ids.friend, ids.space, 'application/pdf');
    const m = newMeeting();
    clientWrite(ids.editor, m, { transcription_state: { state: 'error', audio: { file_id: victim.id, name: 'x.mp3', mime: 'audio/mpeg', size: 1, status: 'failed', time: now } } });
    expect(state(m).audio.file_id).toBe(victim.id);
    await call(ids.editor, 'meetingDeleteAudio', { blockId: m });
    expect(fileExists(victim.id)).toBe(true);
    expect(state(m).audio.status).toBe('deleted');
    // retry transcription with a provider: the planted file is neither sent to it nor deleted afterwards
    const got: Buffer[] = [];
    audio.registerSttProvider({ id: 'aisec-fake', label: 'Fake STT', transcribe: async (input) => { got.push(input.data); return { segments: [{ text: 'leaked words' }] }; } });
    clientWrite(ids.editor, m, { transcription_state: { state: 'error', audio: { file_id: victim.id, name: 'x.mp3', mime: 'audio/mpeg', size: 1, status: 'failed', time: now } } });
    const r = await call(ids.editor, 'meetingRetryTranscription', { blockId: m });
    expect(r.status).toBe('error');
    expect(got).toHaveLength(0);
    expect(fileExists(victim.id)).toBe(true);
    // re-uploading replaces only the block's own earlier upload
    clientWrite(ids.editor, m, { transcription_state: { state: 'error', audio: { file_id: victim.id, name: 'x.mp3', mime: 'audio/mpeg', size: 1, status: 'failed', time: now } } });
    const mine = files.storeFile('standup.mp3', Buffer.from('ID3fakeaudio'), ids.editor, ids.space, 'audio/mpeg');
    await call(ids.editor, 'meetingUploadAudio', { blockId: m, fileId: mine.id });
    expect(fileExists(victim.id)).toBe(true);
  });

  it('the block’s own upload is still deleted by Delete audio, a re-upload and a successful transcription', async () => {
    const m = newMeeting();
    process.env.NC_STT_PROVIDER = 'none-registered';
    const first = files.storeFile('one.mp3', Buffer.from('ID3one'), ids.editor, ids.space, 'audio/mpeg');
    await call(ids.editor, 'meetingUploadAudio', { blockId: m, fileId: first.id });
    expect(state(m).audio).toMatchObject({ file_id: first.id, status: 'failed' });
    const second = files.storeFile('two.mp3', Buffer.from('ID3two'), ids.owner, ids.space, 'audio/mpeg');
    await call(ids.owner, 'meetingUploadAudio', { blockId: m, fileId: second.id });
    expect(fileExists(first.id)).toBe(false);
    // any editor of the meeting may delete its audio
    await call(ids.editor, 'meetingDeleteAudio', { blockId: m });
    expect(fileExists(second.id)).toBe(false);
    delete process.env.NC_STT_PROVIDER;
    const m2 = newMeeting();
    process.env.NC_STT_PROVIDER = 'aisec-ok';
    audio.registerSttProvider({ id: 'aisec-ok', label: 'OK STT', transcribe: async () => ({ segments: [{ text: 'Hello team' }] }) });
    const third = files.storeFile('three.mp3', Buffer.from('ID3three'), ids.owner, ids.space, 'audio/mpeg');
    expect((await call(ids.owner, 'meetingUploadAudio', { blockId: m2, fileId: third.id })).status).toBe('complete');
    expect(fileExists(third.id)).toBe(false);
    delete process.env.NC_STT_PROVIDER;
  });
});

describe('summary instructions pages (item 5)', () => {
  function instructionsPage(title: string, body: string, perms: any[]): string {
    const id = newId();
    const line = newId();
    db.putRecord('block', block(id, 'page', ids.space, 'space', { properties: { title: [[title]] }, content: [line], format: { meeting_instruction: true }, permissions: perms }));
    db.putRecord('block', block(line, 'text', id, 'block', { properties: { title: [[body]] } }));
    return id;
  }
  const userTurn = (seen: any[]) => String(seen[seen.length - 1].messages[0].content);
  async function summarizeAs(userId: string, m: string, instructions?: string) {
    const seen: any[] = [];
    const r = await summary.summarize(m, userId, { client: fake('### Notes\n- ok [L1]', seen) as any, ...(instructions ? { instructions } : {}) });
    expect(r.status).toBe('complete');
    return userTurn(seen);
  }

  it('someone else can’t make your summary read a page only you (or not everyone) can read', async () => {
    const m = newMeeting();
    await withTranscript(m);
    const ownerOnly = instructionsPage('Owner private', 'owner-private-falcon', [{ type: 'user_permission', role: 'editor', user_id: ids.owner }]);
    clientWrite(ids.editor, m, { meeting_instructions: ownerOnly });
    let turn = await summarizeAs(ids.owner, m);
    expect(turn).not.toContain('owner-private-falcon');
    expect(turn).toContain('<instructions name="Auto">');
    // Retry summary sends the block's current choice along: still the editor's choice
    turn = await summarizeAs(ids.owner, m, ownerOnly);
    expect(turn).not.toContain('owner-private-falcon');
    // readable by the editor and the owner, but not by the viewer of the meeting note
    const partial = instructionsPage('Partial', 'partial-heron', [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'reader', user_id: ids.editor }]);
    clientWrite(ids.editor, m, { meeting_instructions: partial });
    expect(await summarizeAs(ids.owner, m)).not.toContain('partial-heron');
    // readable by everyone who can open the meeting note: used
    const shared = instructionsPage('Team format', 'shared-otter', [{ type: 'space_permission', role: 'reader' }]);
    clientWrite(ids.editor, m, { meeting_instructions: shared });
    expect(await summarizeAs(ids.owner, m)).toContain('shared-otter');
  });

  it('the summarizer’s own choices need only their access', async () => {
    const m = newMeeting();
    await withTranscript(m);
    const mine = instructionsPage('Mine', 'my-private-lynx', [{ type: 'user_permission', role: 'editor', user_id: ids.owner }]);
    // chosen on the block by the owner themself
    clientWrite(ids.owner, m, { meeting_instructions: mine });
    expect(await summarizeAs(ids.owner, m)).toContain('my-private-lynx');
    // a key they send that isn't the block's choice
    const other = instructionsPage('Mine 2', 'my-second-ibis', [{ type: 'user_permission', role: 'editor', user_id: ids.owner }]);
    clientWrite(ids.editor, m, { meeting_instructions: 'standup' });
    expect(await summarizeAs(ids.owner, m, other)).toContain('my-second-ibis');
    // a client can't claim someone else chose it
    clientWrite(ids.editor, m, { meeting_instructions: mine, meeting_instructions_by: ids.owner });
    expect(rec(m).format.meeting_instructions_by).toBe(ids.editor);
    expect(await summarizeAs(ids.owner, m)).not.toContain('my-private-lynx');
  });
});

describe('Delete transcript (item 6)', () => {
  const snapshotCount = (pageId: string) => (db.db.prepare('SELECT COUNT(*) AS n FROM snapshots WHERE page_id = ?').get(pageId) as any).n as number;

  it('needs a transcript and Full access; deletes only the versions holding it', async () => {
    const pageId = newId();
    db.putRecord('block', block(pageId, 'page', ids.space, 'space', {
      properties: { title: [['History page']] }, content: [],
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'read_and_write', user_id: ids.editor }],
    }));
    history.takeSnapshot(pageId, [ids.owner], Date.now() - 120_000); // before the meeting
    const m = newMeeting(pageId);
    // no transcript yet: nothing happens to the history
    expect(await status(() => call(ids.owner, 'meetingDeleteTranscript', { blockId: m }))).toBe(400);
    expect(snapshotCount(pageId)).toBe(1);
    await withTranscript(m, 'Confidential-words-quokka about the merger.');
    history.takeSnapshot(pageId, [ids.owner], Date.now() - 60_000); // holds the transcript
    expect(snapshotCount(pageId)).toBe(2);
    const lines = model.transcriptRuns(rec(m)).map((r) => r.id);
    expect(lines.length).toBeGreaterThan(0);
    // Can edit isn't enough to wipe history
    expect(await status(() => call(ids.editor, 'meetingDeleteTranscript', { blockId: m }))).toBe(403);
    expect(model.transcriptRuns(rec(m))).toHaveLength(lines.length);
    await call(ids.owner, 'meetingDeleteTranscript', { blockId: m });
    expect(model.transcriptRuns(rec(m))).toHaveLength(0);
    expect(state(m).transcript_deleted).toMatchObject({ by: 'user' });
    for (const id of lines) expect(JSON.stringify(rec(id).properties ?? {})).not.toContain('quokka');
    expect(snapshotCount(pageId)).toBe(1);
    const [left] = history.listSnapshots(pageId, 5);
    expect(JSON.stringify(history.getSnapshot(left.id)!.data)).not.toContain('quokka');
  });
});

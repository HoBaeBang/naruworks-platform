// Suggested edits: server-side rules for commenters. A comment-only user may change a
// block's text only through suggestion annotations of their own (packages/shared/src/richtextSuggest.ts) — never the
// accepted text, never someone else's suggestion, never on a locked page or outside text/to-do/heading/list blocks.
// Editors accept / reject with normal edits.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-suggest-test-'));
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let S: typeof import('@nc/shared/richtextSuggest.ts');
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });

function tx(user: string, operations: any[]) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
}
async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}
const title = (id: string) => db.getRecord<any>('block', id)!.properties.title;
const ptr = (table: string, id: string) => ({ table, id, spaceId: ids.space });

/** The operations the editor sends when a user types `text` at the end of block `blockId` in suggest mode. */
function suggestOps(user: string, blockId: string, text: string, did = newId(), cid = newId()) {
  const prev = title(blockId);
  const end = prev.map((d: any) => d[0]).join('').length;
  const next = S.suggestEdit(prev, end, end, text, { insertId: did, removeId: did, mine: (x) => x === did }).value;
  return {
    did,
    ops: [
      { pointer: ptr('discussion', did), path: [], command: 'set', args: { id: did, parent_id: blockId, parent_table: 'block', resolved: false, comments: [], alive: true, type: 'suggestion', space_id: ids.space } },
      { pointer: ptr('block', blockId), path: ['discussions'], command: 'listAfter', args: { id: did } },
      { pointer: ptr('comment', cid), path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: [], suggestion: true, alive: true } },
      { pointer: ptr('discussion', did), path: ['comments'], command: 'listAfter', args: { id: cid } },
      { pointer: ptr('block', blockId), path: ['properties', 'title'], command: 'set', args: next },
      { pointer: ptr('block', blockId), path: [], command: 'update', args: { last_edited_time: Date.now(), last_edited_by_id: user, last_edited_by_table: 'lit_user' } },
    ],
  };
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  S = await import('@nc/shared/richtextSuggest.ts');
  for (const n of ['alice', 'carl', 'dora']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@suggest.test`, n);
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  const now = Date.now();
  const blk = (id: string, parent: string, extra: Record<string, unknown> = {}, parentTable = 'block') => ({
    id, version: 1, type: 'text', properties: { title: [['Final paragraph.']] }, parent_id: parent, parent_table: parentTable, space_id: ids.space, alive: true,
    created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice, ...extra,
  });
  ids.page = newId();
  ids.text = newId();
  ids.callout = newId();
  db.putRecord('block', blk(ids.page, ids.space, {
    type: 'page', properties: { title: [['Doc']] }, content: [],
    permissions: [
      { type: 'user_permission', role: 'editor', user_id: ids.alice },
      { type: 'user_permission', role: 'comment_only', user_id: ids.carl },
      { type: 'user_permission', role: 'comment_only', user_id: ids.dora },
    ],
  }, 'space') as any);
  db.putRecord('block', blk(ids.text, ids.page) as any);
  db.putRecord('block', blk(ids.callout, ids.page, { type: 'callout', properties: { title: [['Note']] } }) as any);
  const page = db.getRecord<any>('block', ids.page)!;
  db.putRecord('block', { ...page, content: [ids.text, ids.callout] });
});

describe('suggested edits — commenters', () => {
  it('a commenter can suggest an insertion (text, discussion and suggestion comment in one transaction)', async () => {
    const { did, ops } = suggestOps(ids.carl, ids.text, ' Suggested');
    expect(await status(() => tx(ids.carl, ops))).toBe(200);
    expect(S.summarizeSuggestion(title(ids.text), did)).toMatchObject({ kind: 'add', added: ' Suggested' });
    expect(db.getRecord<any>('discussion', did)!.created_by_id).toBe(ids.carl);
    ids.carlSuggestion = did;
  });

  it('a commenter cannot edit the accepted text, format it, or touch other blocks / properties', async () => {
    const plain = [{ pointer: ptr('block', ids.text), path: ['properties', 'title'], command: 'set', args: [['Rewritten']] }];
    expect(await status(() => tx(ids.carl, plain))).toBe(403);
    const bold = [{ pointer: ptr('block', ids.text), path: ['properties', 'title'], command: 'set', args: [['Final', [['b']]], [' paragraph.']] }];
    expect(await status(() => tx(ids.carl, bold))).toBe(403);
    const checked = [{ pointer: ptr('block', ids.text), path: ['properties', 'checked'], command: 'set', args: [['Yes']] }];
    expect(await status(() => tx(ids.carl, checked))).toBe(403);
    expect(await status(() => tx(ids.carl, suggestOps(ids.carl, ids.callout, '!').ops))).toBe(403);
  });

  it('a commenter cannot accept, nor withdraw someone else\'s suggestion; withdrawing their own is fine', async () => {
    const cur = title(ids.text);
    const accept = [{ pointer: ptr('block', ids.text), path: ['properties', 'title'], command: 'set', args: S.acceptSuggestion(cur, ids.carlSuggestion) }];
    expect(await status(() => tx(ids.carl, accept))).toBe(403);
    const reject = [{ pointer: ptr('block', ids.text), path: ['properties', 'title'], command: 'set', args: S.rejectSuggestion(cur, ids.carlSuggestion) }];
    expect(await status(() => tx(ids.dora, reject))).toBe(403);
    // re-using someone else's suggestion id for new text is refused too
    const prev = title(ids.text);
    const hijack = S.suggestEdit(prev, 0, 0, 'X', { insertId: ids.carlSuggestion, removeId: ids.carlSuggestion, mine: () => true }).value;
    expect(await status(() => tx(ids.dora, [{ pointer: ptr('block', ids.text), path: ['properties', 'title'], command: 'set', args: hijack }]))).toBe(403);
    expect(await status(() => tx(ids.carl, reject))).toBe(200);
    expect(title(ids.text)).toEqual([['Final paragraph.']]);
  });

  it('no suggestions on a locked page', async () => {
    const page = db.getRecord<any>('block', ids.page)!;
    db.putRecord('block', { ...page, format: { ...(page.format ?? {}), block_locked: true } });
    expect(await status(() => tx(ids.carl, suggestOps(ids.carl, ids.text, ' locked').ops))).toBe(403);
    db.putRecord('block', { ...page, format: { ...(page.format ?? {}), block_locked: false } });
  });

  it('an editor accepts a suggestion (text becomes part of the page) and resolves the thread', async () => {
    const { did, ops } = suggestOps(ids.carl, ids.text, ' again');
    await tx(ids.carl, ops);
    const accepted = S.acceptSuggestion(title(ids.text), did);
    expect(await status(() => tx(ids.alice, [
      { pointer: ptr('block', ids.text), path: ['properties', 'title'], command: 'set', args: accepted },
      { pointer: ptr('discussion', did), path: [], command: 'update', args: { resolved: true, resolved_by_id: ids.alice, resolved_time: Date.now(), suggestion_status: 'accepted' } },
    ]))).toBe(200);
    expect(title(ids.text)).toEqual([['Final paragraph. again']]);
    expect(db.getRecord<any>('discussion', did)!.suggestion_status).toBe('accepted');
  });
});

// Regression tests for transaction-path holes: records moved between workspaces, forged page verification,
// "Hide in search" with group sharing, and the Free plan's guest limit on direct permission writes.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-tx-test-'));
delete process.env.NC_DEV_LOGIN_CODES;
vi.setConfig({ testTimeout: 30_000 });

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let search: typeof import('../src/search.ts');
let records: typeof import('../src/records.ts');
let verification: typeof import('@nc/shared/verification.ts');
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
const tx = (user: string, operations: any[], spaceId = ids.space) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
const now = Date.now();
function page(id: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}, spaceId = ids.space) {
  return { id, version: 1, type: 'page', properties: { title: [[`Page ${id.slice(0, 4)}`]] }, parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner, ...extra };
}
const svOf = (uid: string, spaceId: string) => db.getRecord<any>('user_root', uid)!.space_views.map((v: string) => db.getRecord<any>('space_view', v)).find((v: any) => v?.space_id === spaceId);

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  search = await import('../src/search.ts');
  records = await import('../src/records.ts');
  verification = await import('@nc/shared/verification.ts');
  for (const n of ['owner', 'editor', 'grouped', 'other', 'guest']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@tx.test`, n);
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  seed.addMember(ids.space, ids.editor, 'editor');
  seed.addMember(ids.space, ids.grouped, 'editor');
  seed.addMember(ids.space, ids.other, 'editor');
  ids.editorSpace = seed.createWorkspace(ids.editor, 'Editor home').space.id;
  ids.guestSpace = seed.createWorkspace(ids.guest, 'Guest home').space.id;
});

describe('records never move between workspaces through transactions', () => {
  it('a member of both workspaces can’t move a page out; a guest can’t move a shared page into their own workspace', async () => {
    const p = newId();
    db.putRecord('block', page(p, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.editor }, { type: 'user_permission', role: 'editor', user_id: ids.guest }] }) as any);
    const sv = svOf(ids.editor, ids.editorSpace);
    const moveOps = (user: string, targetSpace: string, view: any) => [
      { pointer: { table: 'block', id: p }, path: [], command: 'update', args: { parent_id: targetSpace, parent_table: 'space' } },
      { pointer: { table: 'space_view', id: view.id }, path: ['private_pages'], command: 'listAfter', args: { id: p } },
    ];
    expect(await status(() => tx(ids.editor, moveOps(ids.editor, ids.editorSpace, sv), ids.editorSpace))).toBe(403);
    expect(await status(() => tx(ids.guest, moveOps(ids.guest, ids.guestSpace, svOf(ids.guest, ids.guestSpace)), ids.guestSpace))).toBe(403);
    // under a page of the other workspace too
    const target = newId();
    db.putRecord('block', page(target, ids.editorSpace, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.editor }] }, ids.editorSpace) as any);
    expect(await status(() => tx(ids.editor, [
      { pointer: { table: 'block', id: p }, path: [], command: 'update', args: { parent_id: target, parent_table: 'block' } },
      { pointer: { table: 'block', id: target }, path: ['content'], command: 'listAfter', args: { id: p } },
    ], ids.editorSpace))).toBe(403);
    expect(db.getRecord<any>('block', p)!.space_id).toBe(ids.space);
    // moving inside the workspace still works
    const sibling = newId();
    db.putRecord('block', page(sibling, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.editor }] }) as any);
    expect(await status(() => tx(ids.editor, [
      { pointer: { table: 'block', id: p }, path: [], command: 'update', args: { parent_id: sibling, parent_table: 'block' } },
      { pointer: { table: 'block', id: sibling }, path: ['content'], command: 'listAfter', args: { id: p } },
    ]))).toBe(200);
  });
});

describe('page verification can only be changed through Verify (owners, plan)', () => {
  it('editors can’t forge or remove verification on a page or a wiki row', async () => {
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, plan_type: 'business' });
    const p = newId();
    db.putRecord('block', page(p, ids.space, 'space', { permissions: [{ type: 'space_permission', role: 'editor' }], format: { page_verification: { state: 'none', owners: [ids.owner] } } }) as any);
    const forged = verification.makeVerification(ids.editor, Date.now(), null, [ids.editor]);
    expect(await status(() => tx(ids.editor, [{ pointer: { table: 'block', id: p }, path: ['format', 'page_verification'], command: 'set', args: forged }]))).toBe(403);
    expect(await status(() => tx(ids.editor, [{ pointer: { table: 'block', id: p }, path: ['format'], command: 'update', args: { page_verification: { state: 'none', owners: [ids.editor] } } }]))).toBe(403);
    // the endpoint keeps its owner rule; the owner verifies
    expect(await status(() => call(ids.editor, 'setPageVerification', { pageId: p, verified: true }))).toBe(403);
    expect(await status(() => call(ids.owner, 'setPageVerification', { pageId: p, verified: true }))).toBe(200);
    // other format edits are fine
    expect(await status(() => tx(ids.editor, [{ pointer: { table: 'block', id: p }, path: ['format'], command: 'update', args: { page_full_width: true } }]))).toBe(200);

    // a wiki: Verification property V (owner property O)
    const host = newId();
    const col = newId();
    db.putRecord('block', page(host, ids.space, 'space', { type: 'collection_view_page', collection_id: col, permissions: [{ type: 'space_permission', role: 'editor' }] }) as any);
    db.putRecord('collection', { id: col, version: 1, parent_id: host, parent_table: 'block', space_id: ids.space, alive: true, name: [['Wiki']], format: { is_wiki: true }, template_pages: [], schema: { title: { name: 'Page', type: 'title' }, own: { name: 'Owner', type: 'person' }, ver: { name: 'Verification', type: 'verification', verifier_property: 'own' }, note: { name: 'Note', type: 'text' } } } as any);
    const row = newId();
    db.putRecord('block', page(row, col, 'collection', { properties: { title: [['Row']], own: verification.encodePeople([ids.owner]) } }) as any);
    const vr = verification.encodeVerificationValue(verification.makeVerification(ids.editor, Date.now(), null));
    expect(await status(() => tx(ids.editor, [{ pointer: { table: 'block', id: row }, path: ['properties', 'ver'], command: 'set', args: vr }]))).toBe(403);
    expect(await status(() => tx(ids.editor, [{ pointer: { table: 'block', id: row }, path: ['properties', 'note'], command: 'set', args: vr }]))).toBe(403);
    await call(ids.owner, 'setPageVerification', { pageId: row, verified: true });
    expect(await status(() => tx(ids.editor, [{ pointer: { table: 'block', id: row }, path: ['properties', 'ver'], command: 'set', args: null }]))).toBe(403);
    expect(verification.readVerification(db.getRecord<any>('block', row), db.getRecord<any>('collection', col)).status).toBe('verified');
    // ordinary edits of the row (Owner, other properties) still work
    expect(await status(() => tx(ids.editor, [{ pointer: { table: 'block', id: row }, path: ['properties', 'note'], command: 'set', args: [['hi']] }]))).toBe(200);
    // a pasted / duplicated row from a client doesn't arrive verified
    const copy = newId();
    await tx(ids.editor, [{ pointer: { table: 'block', id: copy }, path: [], command: 'set', args: page(copy, col, 'collection', { created_by_id: ids.editor, properties: { title: [['Copy']], ver: vr, note: vr } }) }]);
    const stored = db.getRecord<any>('block', copy)!;
    expect(stored.properties.ver).toBeUndefined();
    expect(stored.properties.note).toBeUndefined();
    expect(stored.properties.title).toEqual([['Copy']]);
  });
});

describe('"Hide in search" with group sharing', () => {
  it('only the caller’s own group grants make an unlisted page searchable', async () => {
    const g = await call(ids.owner, 'createGroup', { spaceId: ids.space, name: 'Insiders', memberIds: [ids.grouped] });
    const p = newId();
    const rec = page(p, ids.space, 'space', {
      properties: { title: [['Zebrafish strategy']] },
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'space_permission', role: 'reader', unlisted: true }, { type: 'group_permission', role: 'reader', group_id: g.group.id }],
    });
    db.putRecord('block', rec as any);
    search.indexBlock(db.getRecord<any>('block', p)!);
    const found = async (uid: string) => (await call(uid, 'searchWorkspace', { query: 'Zebrafish', spaceId: ids.space })).results.some((r: any) => r.id === p);
    expect(records.blockRole(p, ids.other)).toBe('reader');
    expect(await found(ids.other)).toBe(false);
    expect(await found(ids.grouped)).toBe(true);
  });
});

describe('Free plan guest limit on every permission write', () => {
  it('direct permission writes and approved access requests can’t pass 10 guests', async () => {
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, plan_type: 'free' });
    const p = newId();
    const guests = Array.from({ length: 10 }, (_, i) => {
      const id = newId();
      seed.createUser(id, `g${i}@guests.test`, `g${i}`);
      return id;
    });
    db.putRecord('block', page(p, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, ...guests.map((id) => ({ type: 'user_permission', role: 'reader', user_id: id }))] }) as any);
    const extra = newId();
    seed.createUser(extra, 'eleventh@guests.test', 'eleventh');
    const perms = () => db.getRecord<any>('block', p)!.permissions;
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'block', id: p }, path: ['permissions'], command: 'set', args: [...perms(), { type: 'user_permission', role: 'reader', user_id: extra }] }]))).toBe(403);
    // a new page that shares itself with the eleventh guest
    const q = newId();
    expect(await status(() => tx(ids.owner, [
      { pointer: { table: 'block', id: q }, path: [], command: 'set', args: page(q, p, 'block', { permissions: [{ type: 'user_permission', role: 'reader', user_id: extra }] }) },
      { pointer: { table: 'block', id: p }, path: ['content'], command: 'listAfter', args: { id: q } },
    ]))).toBe(403);
    // an access request approved by the owner
    const req = await call(extra, 'requestPageAccess', { pageId: p });
    expect(await status(() => call(ids.owner, 'decideAccessRequest', { requestId: req.requestId, approve: true, role: 'reader' }))).toBe(403);
    expect(records.blockRole(p, extra)).toBe('none');
    // existing guests can still be re-shared (not new) and members added
    expect(await status(() => tx(ids.owner, [{ pointer: { table: 'block', id: p }, path: ['permissions'], command: 'set', args: [...perms(), { type: 'user_permission', role: 'reader', user_id: ids.editor }] }]))).toBe(200);
    db.putRecord('space', { ...db.getRecord<any>('space', ids.space)!, plan_type: 'business' });
  });
});

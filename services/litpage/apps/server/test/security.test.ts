// Security regression tests: each block maps to a finding (S-xx).
// Runs against a temporary SQLite workspace: handlers are called directly, HTTP behaviour through app.request.
import { EventEmitter } from 'node:events';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-security-test-'));
delete process.env.NC_DEV_LOGIN_CODES;
delete process.env.NC_DEV_ALLOW_LOOPBACK_FETCH;

let H: Record<string, (ctx: any, body: any) => any>;
let app: typeof import('../src/app.ts').app;
let originAllowed: typeof import('../src/app.ts').originAllowed;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let records: typeof import('../src/records.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null, extra: Record<string, unknown> = {}) => ({ userId, setCookie: () => {}, ...extra });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

/** Run client transactions as `user` (same path as POST /api/rpc/applyChanges). */
function tx(user: string, operations: any[], spaceId = ids.spaceA) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
}

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function block(id: string, parentId: string, extra: Record<string, unknown> = {}, parentTable = 'block', spaceId = ids.spaceA, user = ids.alice) {
  const now = Date.now();
  return {
    id, version: 1, type: 'text', properties: { title: [['text of ' + id]] }, parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true,
    created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user, ...extra,
  };
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  ({ app, originAllowed } = await import('../src/app.ts'));
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  records = await import('../src/records.ts');

  for (const n of ['alice', 'bob', 'eve', 'gina']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@sec.test`, n[0].toUpperCase() + n.slice(1));
  }
  // workspace A: alice owner, bob member; eve has her own workspace E; gina is a guest on one page of A
  const a = seed.createWorkspace(ids.alice, 'Acme');
  ids.spaceA = a.space.id;
  ids.teamA = a.team.id;
  ids.alicePrivate = a.spaceView.private_pages[0];
  seed.addMember(ids.spaceA, ids.bob, 'editor');
  const e = seed.createWorkspace(ids.eve, 'Evil');
  ids.spaceE = e.space.id;
  ids.evePage = e.spaceView.private_pages[0];

  // alice's private content: a secret block inside her private page, and a private database
  ids.secret = newId();
  db.putRecord('block', block(ids.secret, ids.alicePrivate, { properties: { title: [['TOP SECRET alice text']] } }) as any);
  const priv = db.getRecord<any>('block', ids.alicePrivate)!;
  db.putRecord('block', { ...priv, content: [...(priv.content ?? []), ids.secret] });
  ids.dbBlock = newId();
  ids.collection = newId();
  ids.view = newId();
  ids.row = newId();
  db.putRecord('block', block(ids.dbBlock, ids.alicePrivate, { type: 'collection_view', collection_id: ids.collection, view_ids: [ids.view], properties: {} }) as any);
  db.putRecord('collection', { id: ids.collection, version: 1, name: [['Salaries']], schema: { title: { name: 'Name', type: 'title' } }, parent_id: ids.dbBlock, parent_table: 'block', alive: true, space_id: ids.spaceA } as any);
  db.putRecord('collection_view', { id: ids.view, version: 1, type: 'table', name: 'Table', format: {}, parent_id: ids.dbBlock, parent_table: 'block', alive: true, space_id: ids.spaceA } as any);
  db.putRecord('block', block(ids.row, ids.collection, { type: 'page', properties: { title: [['SECRET ROW alice']] } }, 'collection') as any);

  // a page alice shares with bob (can edit) and gina (can comment)
  ids.shared = newId();
  db.putRecord('block', block(ids.shared, ids.spaceA, {
    type: 'page', properties: { title: [['Shared']] }, content: [],
    permissions: [
      { type: 'user_permission', role: 'editor', user_id: ids.alice },
      { type: 'user_permission', role: 'read_and_write', user_id: ids.bob },
      { type: 'user_permission', role: 'comment_only', user_id: ids.gina },
    ],
  }, 'space') as any);

  // a private teamspace bob is not in
  ids.privateTeam = newId();
  seed.saveRecord('team', {
    id: ids.privateTeam, version: 0, space_id: ids.spaceA, name: 'Board', team_pages: [], parent_id: ids.spaceA, parent_table: 'space', alive: true,
    membership: [{ user_id: ids.alice, role: 'owner', added_time: Date.now() }], settings: { type: 'private', default_page_role: 'editor' }, created_time: Date.now(), created_by_id: ids.alice,
  });
});

describe('S-01 prototype pollution through operation paths', () => {
  it('rejects __proto__/constructor paths and keys without touching Object.prototype', async () => {
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'block', id: ids.evePage, spaceId: ids.spaceE }, path: ['__proto__', 'polluted'], command: 'set', args: 1 }], ids.spaceE))).toBe(400);
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'block', id: ids.evePage, spaceId: ids.spaceE }, path: ['__proto__'], command: 'update', args: { permissions: [{ type: 'public_permission', role: 'editor' }] } }], ids.spaceE))).toBe(400);
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'block', id: ids.evePage, spaceId: ids.spaceE }, path: [], command: 'update', args: JSON.parse('{"__proto__":{"x":1}}') }], ids.spaceE))).toBe(400);
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).permissions).toBeUndefined();
    expect(records.blockRole(ids.alicePrivate, null)).toBe('none');
  });
  it('rejects unknown tables and commands', async () => {
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'sessions', id: 'x' }, path: [], command: 'set', args: {} }]))).toBe(400);
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'block', id: ids.evePage }, path: [], command: 'eval', args: {} }]))).toBe(400);
  });
});

describe('S-02 sharing changes need full access (set path [] included)', () => {
  it('a "can edit" user cannot publish or re-share a page by replacing the whole record', async () => {
    const cur = db.getRecord<any>('block', ids.shared)!;
    const { version: _v, ...rest } = cur;
    const pub = { ...rest, permissions: [...cur.permissions, { type: 'public_permission', role: 'reader' }] };
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'block', id: ids.shared }, path: [], command: 'set', args: pub }]))).toBe(403);
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'block', id: ids.shared }, path: ['permissions'], command: 'set', args: pub.permissions }]))).toBe(403);
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'block', id: ids.shared }, path: [], command: 'update', args: { permissions: pub.permissions } }]))).toBe(403);
    // ordinary editing still works
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'block', id: ids.shared }, path: ['properties', 'title'], command: 'set', args: [['Shared (edited)']] }]))).toBe(200);
  });
  it('a web link never grants full access', async () => {
    const p = newId();
    db.putRecord('block', block(p, ids.spaceA, { type: 'page', permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'public_permission', role: 'editor' }] }, 'space') as any);
    expect(records.blockRole(p, ids.eve)).toBe('read_and_write');
    expect(records.blockRole(p, null)).toBe('read_and_write');
  });
  it('"Disable public access" switches web links off', () => {
    const p = newId();
    const sid = ids.spaceE;
    db.putRecord('block', block(p, sid, { type: 'page', permissions: [{ type: 'public_permission', role: 'reader' }] }, 'space', sid, ids.eve) as any);
    expect(records.blockRole(p, null)).toBe('reader');
    const sp = db.getRecord<any>('space', sid)!;
    db.putRecord('space', { ...sp, disable_public_access: true });
    expect(records.blockRole(p, null)).toBe('none');
    db.putRecord('space', { ...sp, disable_public_access: false });
  });
});

describe('S-03 content-list injection (adopting someone else\'s blocks)', () => {
  it('cannot list another workspace\'s block in your own page', async () => {
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'block', id: ids.evePage, spaceId: ids.spaceE }, path: ['content'], command: 'listAfter', args: { id: ids.secret } }], ids.spaceE))).toBe(403);
  });
  it('legacy injected ids are not copied, exported, snapshotted or deleted', async () => {
    // simulate data written before the fix: an eve page lists alice's secret block and database
    const evePage = seed.createPage({ spaceId: ids.spaceE, userId: ids.eve, parentId: ids.spaceE, parentTable: 'space', title: 'Loot', permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.eve }] }).id;
    const page = db.getRecord<any>('block', evePage)!;
    db.putRecord('block', { ...page, content: [...(page.content ?? []), ids.secret, ids.dbBlock] });
    const dup = await call(ids.eve, 'duplicateBlock', { blockId: evePage });
    const copied = JSON.stringify(db.db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND json_extract(data, '$.copied_from') IS NOT NULL AND json_extract(data, '$.created_by_id') = ?`).all(ids.eve));
    expect(dup.blockId).toBeTruthy();
    expect(copied).not.toContain('TOP SECRET');
    expect(copied).not.toContain('SECRET ROW');
    const exp = await call(ids.eve, 'startPageExport', { blockId: evePage, format: 'markdown' });
    const files = await import('../src/content/files.ts');
    const data = files.readStoredFile(exp.url, ids.eve, { anyUser: true })!.data.toString('utf8');
    expect(data).not.toContain('TOP SECRET');
    // permanent delete of eve's page leaves alice's block alone
    db.putRecord('block', { ...db.getRecord<any>('block', evePage)!, alive: false });
    await call(ids.eve, 'deleteBlocksPermanently', { blockIds: [evePage] });
    expect(db.getRecord('block', evePage)).toBeUndefined();
    expect(db.getRecord('block', ids.secret)).toBeTruthy();
    expect(db.getRecord('block', ids.dbBlock)).toBeTruthy();
  });
  it('version history never returns foreign blocks', async () => {
    const hist = await import('../src/history.ts');
    const p = newId();
    db.putRecord('block', block(p, ids.spaceE, { type: 'page', content: [ids.secret], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.eve }] }, 'space', ids.spaceE, ids.eve) as any);
    hist.takeSnapshot(p, [ids.eve]);
    const list = hist.listSnapshots(p);
    const snap = await call(ids.eve, 'getPageVersion', { snapshotId: list[0].id });
    expect(JSON.stringify(snap)).not.toContain('TOP SECRET');
  });
});

describe('S-04 pointers to records the user cannot read', () => {
  it('rejects a database view / synced block / link pointing into another workspace', async () => {
    const mk = (extra: Record<string, unknown>) => {
      const id = newId();
      return [
        { pointer: { table: 'block', id, spaceId: ids.spaceE }, path: [], command: 'set', args: block(id, ids.evePage, extra, 'block', ids.spaceE, ids.eve) },
        { pointer: { table: 'block', id: ids.evePage, spaceId: ids.spaceE }, path: ['content'], command: 'listAfter', args: { id } },
      ];
    };
    expect(await status(() => tx(ids.eve, mk({ type: 'collection_view', collection_id: ids.collection }), ids.spaceE))).toBe(403);
    expect(await status(() => tx(ids.eve, mk({ type: 'transclusion_reference', format: { transclusion_reference_pointer: { id: ids.alicePrivate, table: 'block' } } }), ids.spaceE))).toBe(403);
    expect(await status(() => tx(ids.eve, mk({ type: 'alias', format: { alias_pointer: { id: ids.alicePrivate, table: 'block' } } }), ids.spaceE))).toBe(403);
    // a pointer to something readable is fine
    expect(await status(() => tx(ids.eve, mk({ type: 'alias', format: { alias_pointer: { id: ids.evePage, table: 'block' } } }), ids.spaceE))).toBe(200);
  });
  it('legacy pointers do not leak through export, CSV, AI context or templates', async () => {
    const sync = newId();
    const ref = newId();
    db.putRecord('block', block(sync, ids.evePage, { type: 'transclusion_reference', format: { transclusion_reference_pointer: { id: ids.alicePrivate } } }, 'block', ids.spaceE, ids.eve) as any);
    db.putRecord('block', block(ref, ids.evePage, { type: 'collection_view', collection_id: ids.collection, view_ids: [] }, 'block', ids.spaceE, ids.eve) as any);
    const page = db.getRecord<any>('block', ids.evePage)!;
    db.putRecord('block', { ...page, alive: true, content: [sync, ref] });
    const exp = await call(ids.eve, 'startPageExport', { blockId: ids.evePage, format: 'markdown', includeSubpages: true });
    const files = await import('../src/content/files.ts');
    const f = files.readStoredFile(exp.url, ids.eve)!;
    expect(f.data.toString('latin1')).not.toContain('TOP SECRET');
    expect(f.data.toString('latin1')).not.toContain('SECRET ROW');
    expect(await status(() => call(ids.eve, 'exportCollectionViewCsv', { collectionId: ids.collection, viewId: ids.view }))).toBe(404);
    const ai = await import('../src/ai/context.ts');
    const md = ai.readPage(ids.evePage, ids.eve)!;
    expect(md.markdown).not.toContain('TOP SECRET');
    expect(md.markdown).not.toContain('SECRET ROW');
    expect(await status(() => call(ids.eve, 'applyDatabaseTemplate', { rowId: ids.evePage, templateId: ids.alicePrivate }))).toBe(404);
  });
});

describe('S-05 teamspaces', () => {
  it('members cannot join private teamspaces or change other teams', async () => {
    const t = db.getRecord<any>('team', ids.privateTeam)!;
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: t.id }, path: [], command: 'update', args: { membership: [...t.membership, { user_id: ids.bob, role: 'owner', added_time: 1 }] } }]))).toBe(403);
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: t.id }, path: ['settings'], command: 'update', args: { type: 'open' } }]))).toBe(403);
    const general = db.getRecord<any>('team', ids.teamA)!;
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: general.id }, path: [], command: 'update', args: { name: 'Hacked' } }]))).toBe(403);
    // private teams are invisible to non-members
    expect(records.recordRole('team', t, ids.bob)).toBe('none');
  });
  it('self join (open team) and leave still work; outsiders cannot create teams in a workspace', async () => {
    const tid = newId();
    seed.saveRecord('team', { id: tid, version: 0, space_id: ids.spaceA, name: 'Open', team_pages: [], parent_id: ids.spaceA, parent_table: 'space', alive: true, membership: [{ user_id: ids.alice, role: 'owner', added_time: 1 }], settings: { type: 'open' }, created_time: 1, created_by_id: ids.alice });
    const t = db.getRecord<any>('team', tid)!;
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: tid }, path: [], command: 'update', args: { membership: [...t.membership, { user_id: ids.bob, role: 'member', added_time: 2 }] } }]))).toBe(200);
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: tid }, path: [], command: 'update', args: { membership: t.membership } }]))).toBe(200);
    const nid = newId();
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'team', id: nid }, path: [], command: 'set', args: { id: nid, space_id: ids.spaceA, parent_id: ids.spaceA, parent_table: 'space', name: 'x', membership: [{ user_id: ids.eve, role: 'owner' }], team_pages: [], alive: true } }]))).toBe(403);
  });
});

describe('S-06 comments and discussions', () => {
  it('only authors edit text; reactions only for yourself; no threads without access', async () => {
    const did = newId();
    const cid = newId();
    await tx(ids.alice, [
      { pointer: { table: 'discussion', id: did }, path: [], command: 'set', args: { id: did, parent_id: ids.shared, parent_table: 'block', resolved: false, comments: [], alive: true, space_id: ids.spaceA } },
      { pointer: { table: 'block', id: ids.shared }, path: ['discussions'], command: 'listAfter', args: { id: did } },
      { pointer: { table: 'comment', id: cid }, path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: [['hello']], alive: true, created_by_id: ids.bob } },
      { pointer: { table: 'discussion', id: did }, path: ['comments'], command: 'listAfter', args: { id: cid } },
    ]);
    // authorship comes from the session, not the client
    expect(db.getRecord<any>('comment', cid)!.created_by_id).toBe(ids.alice);
    expect(await status(() => tx(ids.gina, [{ pointer: { table: 'comment', id: cid }, path: [], command: 'update', args: { text: [['forged']] } }]))).toBe(403);
    expect(await status(() => tx(ids.gina, [{ pointer: { table: 'comment', id: cid }, path: ['reactions', '👍'], command: 'set', args: [ids.alice] }]))).toBe(403);
    expect(await status(() => tx(ids.gina, [{ pointer: { table: 'comment', id: cid }, path: ['reactions', '👍'], command: 'set', args: [ids.gina] }]))).toBe(200);
    expect(await status(() => tx(ids.gina, [{ pointer: { table: 'discussion', id: did }, path: ['comments'], command: 'listRemove', args: { id: cid } }]))).toBe(403);
    // eve cannot attach a thread to (or re-parent a thread into) alice's page
    const evil = newId();
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'discussion', id: evil }, path: [], command: 'set', args: { id: evil, parent_id: ids.alicePrivate, parent_table: 'block', comments: [], alive: true } }]))).toBe(403);
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'comment', id: cid }, path: [], command: 'update', args: { alive: false } }]))).toBe(403);
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'discussion', id: did }, path: [], command: 'update', args: { parent_id: ids.evePage } }]))).toBe(403);
  });
});

describe('S-07 account records', () => {
  it('email is not client-writable (invite / share squatting)', async () => {
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'lit_user', id: ids.eve }, path: [], command: 'update', args: { email: 'ceo@sec.test' } }]))).toBe(403);
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'lit_user', id: ids.eve }, path: [], command: 'update', args: { name: 'Eve 2' } }]))).toBe(200);
  });
  it('no notifications / follows / visits on behalf of others', async () => {
    const n = newId();
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'notification', id: n }, path: [], command: 'set', args: { id: n, user_id: ids.alice, space_id: ids.spaceA, type: 'mention', actor_id: ids.bob, created_time: 1, read: false } }]))).toBe(403);
    const f = newId();
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'follow', id: f }, path: [], command: 'set', args: { id: f, user_id: ids.alice, navigable_block_id: ids.alicePrivate, following: true } }]))).toBe(403);
    await call(ids.eve, 'notifyMention', { userIds: [ids.alice], blockId: ids.alicePrivate });
    const count = (db.db.prepare(`SELECT COUNT(*) AS n FROM records WHERE tbl = 'notification' AND json_extract(data, '$.actor_id') = ?`).get(ids.eve) as any).n;
    expect(count).toBe(0);
  });
  it('user_root.space_views only holds your own sidebars', async () => {
    const aliceRoot = db.getRecord<any>('user_root', ids.alice)!;
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'user_root', id: ids.eve }, path: ['space_views'], command: 'listAfter', args: { id: aliceRoot.space_views[0] } }]))).toBe(403);
  });
  it('page visits / follows are private; emails only for people sharing a workspace', async () => {
    await call(ids.alice, 'markPageVisited', { block: { id: ids.alicePrivate } });
    const visit = `${ids.alice}:${ids.alicePrivate}`;
    const r1 = await call(ids.bob, 'fetchRecords', { requests: [{ pointer: { table: 'page_visit', id: visit } }, { pointer: { table: 'lit_user', id: ids.alice } }] });
    expect(r1.recordMap.page_visit).toBeUndefined();
    expect(r1.recordMap.lit_user[ids.alice].value.value.email).toBe('alice@sec.test');
    const r2 = await call(ids.eve, 'fetchRecords', { requests: [{ pointer: { table: 'lit_user', id: ids.alice } }] });
    expect(r2.recordMap.lit_user[ids.alice].value.value.email).toBeUndefined();
    expect(r2.recordMap.lit_user[ids.alice].value.value.name).toBe('Alice');
    const r3 = await call(null, 'fetchRecords', { requests: [{ pointer: { table: 'lit_user', id: ids.alice } }] });
    expect(r3.recordMap.lit_user[ids.alice].value.value.email).toBeUndefined();
  });
  it('workspace records: permissions/plan only through the settings API', async () => {
    expect(await status(() => tx(ids.alice, [{ pointer: { table: 'space', id: ids.spaceA }, path: [], command: 'update', args: { plan_type: 'enterprise' } }]))).toBe(403);
    const sp = db.getRecord<any>('space', ids.spaceA)!;
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'space', id: ids.spaceA }, path: [], command: 'update', args: { permissions: [...sp.permissions, { type: 'user_permission', role: 'owner', user_id: ids.bob }] } }]))).toBe(403);
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'space', id: ids.spaceA }, path: [], command: 'update', args: { name: 'Pwned' } }]))).toBe(403);
    expect(await status(() => tx(ids.alice, [{ pointer: { table: 'space', id: ids.spaceA }, path: [], command: 'update', args: { name: 'Acme Inc' } }]))).toBe(200);
    const nid = newId();
    expect(await status(() => tx(ids.eve, [{ pointer: { table: 'space', id: nid }, path: [], command: 'set', args: { id: nid, name: 'x', permissions: [{ type: 'user_permission', role: 'owner', user_id: ids.eve }], created_by_id: ids.eve } }]))).toBe(403);
  });
});

describe('S-08 read endpoints leaking private data', () => {
  it('public page bootstrap and backlinks answer nothing for private pages', async () => {
    expect(await status(() => call(ids.eve, 'getSharedPageInfo', { blockId: ids.alicePrivate }))).toBe(404);
    const r = await call(ids.eve, 'listBacklinks', { block: { id: ids.alicePrivate } });
    expect(r.backlinks).toEqual([]);
  });
  it('trash only lists pages the user can still open', async () => {
    const p = newId();
    db.putRecord('block', block(p, ids.alicePrivate, { type: 'page', alive: false, created_by_id: ids.bob, properties: { title: [['bob made this']] } }) as any);
    const t = await call(ids.bob, 'getTrash', { spaceId: ids.spaceA });
    expect(t.pages).not.toContain(p);
    const t2 = await call(ids.bob, 'getTrashFiltered', { spaceId: ids.spaceA });
    expect(t2.pages.map((x: any) => x.id)).not.toContain(p);
  });
});

describe('S-09 forms only write into their own database', () => {
  it('a form view pointing at another data source is not served or submittable', async () => {
    const fblock = newId();
    const fcol = newId();
    const fview = newId();
    db.putRecord('block', block(fblock, ids.evePage, { type: 'collection_view', collection_id: fcol, view_ids: [fview] }, 'block', ids.spaceE, ids.eve) as any);
    db.putRecord('collection', { id: fcol, version: 1, schema: { title: { name: 'Name', type: 'title' } }, parent_id: fblock, parent_table: 'block', alive: true, space_id: ids.spaceE } as any);
    const form = { form_config: { title: 'x', permission: 'public', ownerId: ids.alice, questions: [{ id: 'q1', config: { propertyId: 'title', isRequired: false } }] } };
    db.putRecord('collection_view', { id: fview, version: 1, type: 'form', name: 'Form', format: { ...form, collection_pointer: { id: ids.collection } }, parent_id: fblock, parent_table: 'block', alive: true, space_id: ids.spaceE } as any);
    const g = await call(null, 'getPublicForm', { viewId: fview });
    expect(g.status).toBe('notfound');
    expect(await status(() => call(null, 'submitFormResponse', { viewId: fview, answers: { q1: 'spam' } }))).toBe(404);
    expect(db.childrenOf('block', ids.collection).length).toBe(1);
  });
});

describe('S-10 files: uploads, downloads, exports', () => {
  let cookieAlice = '';
  let cookieEve = '';
  beforeAll(async () => {
    const auth = await import('../src/auth.ts');
    cookieAlice = `lit_session=${auth.createSession(ids.alice)}`;
    cookieEve = `lit_session=${auth.createSession(ids.eve)}`;
  });
  const upload = (name: string, type: string, body: string) =>
    app.request(`/api/upload?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`, { method: 'POST', body, headers: { cookie: cookieAlice, 'content-type': type } }).then((r) => r.json() as any);

  it('active content is a sandboxed download, passive media stays inline', async () => {
    const html = await upload('x.html', 'text/html', '<script>alert(document.domain)</script>');
    const r1 = await app.request(html.url);
    expect(r1.headers.get('content-type')).toBe('application/octet-stream');
    expect(r1.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(r1.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(r1.headers.get('x-content-type-options')).toBe('nosniff');
    const svg = await upload('x.svg', 'image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const r2 = await app.request(svg.url);
    expect(r2.headers.get('content-type')).toBe('image/svg+xml');
    expect(r2.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(r2.headers.get('content-security-policy')).toMatch(/sandbox/);
    const png = await upload('x.png', 'image/png', 'png');
    const r3 = await app.request(png.url);
    expect(r3.headers.get('content-type')).toBe('image/png');
    expect(r3.headers.get('content-disposition')).toMatch(/^inline/);
  });
  it('file names cannot inject headers or paths', async () => {
    const f = await upload('../../etc/passwd\r\nSet-Cookie: x=1', 'text/plain', 'x');
    expect(f.name).not.toMatch(/[\r\n/]/);
    const r = await app.request(f.url.replace(/\/[^/]*$/, '/anything'));
    expect(r.headers.get('set-cookie')).toBeNull();
  });
  it('exports are private to the exporting user', async () => {
    const exp = await call(ids.alice, 'startPageExport', { blockId: ids.alicePrivate, format: 'markdown' });
    expect((await app.request(exp.url, { headers: { cookie: cookieEve } })).status).toBe(404);
    expect((await app.request(exp.url)).status).toBe(404);
    expect((await app.request(exp.url, { headers: { cookie: cookieAlice } })).status).toBe(200);
  });
  it('exported HTML drops javascript: links', async () => {
    const p = newId();
    db.putRecord('block', block(p, ids.alicePrivate, { properties: { title: [['click', [['a', 'javascript:alert(1)']]], [' ok', [['a', 'https://docs.litpage.dev']]]] } }) as any);
    const priv = db.getRecord<any>('block', ids.alicePrivate)!;
    db.putRecord('block', { ...priv, content: [...priv.content, p] });
    const exp = await call(ids.alice, 'startPageExport', { blockId: ids.alicePrivate, format: 'html' });
    const body = await (await app.request(exp.url, { headers: { cookie: cookieAlice } })).text();
    expect(body).not.toContain('javascript:');
    expect(body).toContain('href="https://docs.litpage.dev"');
  });
});

describe('S-11 CSRF / origin checks', () => {
  it('state-changing API calls need JSON and a same-origin caller', async () => {
    const r1 = await app.request('/api/rpc/listMyWorkspaces', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } });
    expect(r1.status).toBe(415);
    const r2 = await app.request('/api/rpc/listMyWorkspaces', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' } });
    expect(r2.status).toBe(403);
    const r3 = await app.request('http://127.0.0.1:3001/api/rpc/listMyWorkspaces', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', origin: 'https://evil.example', host: '127.0.0.1:3001' } });
    expect(r3.status).toBe(403);
    const r4 = await app.request('/api/upload?name=a.txt', { method: 'POST', body: 'x', headers: { 'sec-fetch-site': 'same-site' } });
    expect(r4.status).toBe(403);
  });
  it('dev proxy rule: loopback Origin to loopback Host is allowed outside production only', () => {
    expect(originAllowed('http://127.0.0.1:5173', '127.0.0.1:3001')).toBe(true);
    expect(originAllowed('http://localhost:5173', '127.0.0.1:3001')).toBe(true);
    expect(originAllowed('https://evil.example', '127.0.0.1:3001')).toBe(false);
    expect(originAllowed('http://127.0.0.1:5173', 'lit.example.com')).toBe(false);
    expect(originAllowed('https://lit.example.com', 'lit.example.com')).toBe(true);
    expect(originAllowed(undefined, '127.0.0.1:3001')).toBe(true);
  });
  it('unknown endpoint names never reach Object.prototype', async () => {
    const r = await app.request('/api/rpc/constructor', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    expect(r.status).toBe(404);
  });
});

describe('S-12 login', () => {
  it('dev login codes need NODE_ENV!=production and NC_DEV_LOGIN_CODES=1', async () => {
    const auth = await import('../src/auth.ts');
    expect((await call(null, 'sendSignInCode', { email: 'nodev@sec.test' })).devCode).toBeUndefined();
    process.env.NC_DEV_LOGIN_CODES = '1';
    process.env.NODE_ENV = 'production';
    expect(auth.devLoginCodesEnabled()).toBe(false);
    process.env.NODE_ENV = 'test';
    expect(auth.devLoginCodesEnabled()).toBe(true);
    delete process.env.NC_DEV_LOGIN_CODES;
  });
  it('a code locks after 5 wrong attempts; asking again does not reset the budget', async () => {
    const auth = await import('../src/auth.ts');
    const email = 'brute@sec.test';
    const code = auth.issueLoginCode(email);
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) expect(auth.verifyLoginCode(email, wrong)).toBe(false);
    const again = auth.issueLoginCode(email);
    expect(auth.verifyLoginCode(email, again)).toBe(false);
  });
  it('code requests are rate limited per address', async () => {
    const email = 'flood@sec.test';
    for (let i = 0; i < 5; i++) await call(null, 'sendSignInCode', { email });
    expect(await status(() => call(null, 'sendSignInCode', { email }))).toBe(429);
  });
  it('session cookie flags', async () => {
    const auth = await import('../src/auth.ts');
    expect(auth.sessionCookie('t', true)).toMatch(/HttpOnly; SameSite=Lax; .*Secure/);
    expect(auth.sessionCookie('t')).not.toMatch(/Secure/);
  });
  it('passwords use the stronger scrypt format and legacy hashes still verify', async () => {
    const auth = await import('../src/auth.ts');
    auth.setPassword(ids.gina, 'correct horse battery');
    const row = db.db.prepare('SELECT hash FROM passwords WHERE user_id = ?').get(ids.gina) as any;
    expect(row.hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(auth.checkPassword(ids.gina, 'correct horse battery')).toBe(true);
    expect(auth.checkPassword(ids.gina, 'wrong')).toBe(false);
  });
});

describe('S-13 SSRF guard', () => {
  it('classifies internal addresses', async () => {
    const { isBlockedAddress } = await import('../src/safefetch.ts');
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '::127.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) expect(isBlockedAddress(ip), ip).toBe(false);
  });
  it('rejects bad schemes, credentials, IP literals and resolved private addresses', async () => {
    const { safeFetch } = await import('../src/safefetch.ts');
    for (const u of ['file:///etc/passwd', 'gopher://x/', 'http://169.254.169.254/latest/meta-data/', 'http://[::ffff:127.0.0.1]/', 'http://0x7f.1/', 'http://user:pw@example.com/', 'http://localhost/', 'http://metadata.google.internal/', 'http://example.com:22/']) {
      await expect(safeFetch(u), u).rejects.toThrow();
    }
    const fake: any = (_h: string, _o: any, cb: any) => cb(null, [{ address: '10.0.0.5', family: 4 }]);
    await expect(safeFetch('http://intranet.example/', { resolve: fake })).rejects.toThrow(/not reachable/);
  });
  it('re-checks every redirect hop', async () => {
    const { safeFetch } = await import('../src/safefetch.ts');
    const srv = createServer((req, res) => {
      res.writeHead(302, { location: req.url === '/a' ? 'http://169.254.169.254/latest/' : 'http://10.0.0.1/' });
      res.end();
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
    const port = (srv.address() as any).port;
    process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1'; // the fixture itself is on loopback
    try {
      await expect(safeFetch(`http://127.0.0.1:${port}/a`)).rejects.toThrow(/not reachable/);
      await expect(safeFetch(`http://127.0.0.1:${port}/b`)).rejects.toThrow(/not reachable/);
    } finally {
      delete process.env.NC_DEV_ALLOW_LOOPBACK_FETCH;
      srv.close();
    }
    await expect(safeFetch(`http://127.0.0.1:${port}/a`)).rejects.toThrow(/not reachable/);
  });
});

describe('S-14 imports', () => {
  it('zip bombs fail while inflating', async () => {
    const { readZip, writeZip } = await import('../src/content/zip.ts');
    const zip = writeZip([{ name: 'big.md', data: Buffer.alloc(8 * 1024 * 1024) }]);
    expect(zip.length).toBeLessThan(100_000);
    expect(() => readZip(zip, { maxTotalBytes: 1024 * 1024 })).toThrow(/too large/);
  });
  it('zip entries cannot climb out of the archive, imported links lose script schemes', async () => {
    const { readZip } = await import('../src/content/zip.ts');
    const { crc32 } = await import('../src/content/zip.ts');
    // hand-made archive with a "../" entry name
    const name = Buffer.from('../../evil.md');
    const data = Buffer.from('# hi');
    const comp = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const cdOff = 30 + name.length + comp.length;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(cdOff, 16);
    const entries = readZip(Buffer.concat([local, name, comp, central, name, end]));
    expect(entries[0].name).toBe('evil.md');
    const { parseHtml } = await import('../src/content/html.ts');
    const { parseMarkdown } = await import('../src/content/markdown.ts');
    expect(JSON.stringify(parseHtml('<p><a href="javascript:alert(1)">x</a><a href="https://ok.example">y</a></p>'))).not.toContain('javascript:');
    expect(JSON.stringify(parseMarkdown('[x](javascript:alert(1)) [y](https://ok.example)'))).not.toContain('javascript:');
  });
});

describe('S-15 realtime presence and subscriptions', () => {
  class FakeWs extends EventEmitter {
    readyState = 1;
    sent: any[] = [];
    send(s: string) { this.sent.push(JSON.parse(s)); }
  }
  it('presence is only shared on pages the user can open; subscriptions only for member workspaces', async () => {
    const { realtime } = await import('../src/realtime.ts');
    const a = new FakeWs();
    const e = new FakeWs();
    (realtime as any).onConnection(a, ids.alice, { url: '/ws?clientId=a' });
    (realtime as any).onConnection(e, ids.eve, { url: '/ws?clientId=e' });
    a.emit('message', JSON.stringify({ type: 'presence', pageId: ids.alicePrivate, data: { cursor: 'secret-block' } }));
    e.emit('message', JSON.stringify({ type: 'presence', pageId: ids.alicePrivate, data: { spoof: true } }));
    expect(JSON.stringify(e.sent)).not.toContain(ids.alice);
    expect(JSON.stringify(a.sent)).not.toContain(ids.eve);
    e.emit('message', JSON.stringify({ type: 'subscribe', spaceIds: [ids.spaceA, ids.spaceE] }));
    const client = [...(realtime as any).clients].find((c: any) => c.ws === e);
    expect([...client.spaces]).toEqual([ids.spaceE]);
    a.emit('close');
    e.emit('close');
  });
});

describe('S-16 AI rate limit', () => {
  it('per-user model calls are capped', async () => {
    const { aiAllowed } = await import('../src/ratelimit.ts');
    process.env.NC_AI_RATE_PER_MIN = '3';
    const u = newId();
    expect([aiAllowed(u), aiAllowed(u), aiAllowed(u), aiAllowed(u)]).toEqual([true, true, true, false]);
    delete process.env.NC_AI_RATE_PER_MIN;
  });
});

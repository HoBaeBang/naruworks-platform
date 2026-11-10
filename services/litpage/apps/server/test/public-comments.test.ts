// Comments on public pages: when "Anyone on the web with link" may comment (public_permission role
// comment_only — Share menu "This page allows comments from anyone on the web"), any signed-in visitor can start and
// answer threads on the page and its blocks, nothing else; with "Can view" they can't; signed-out visitors can't write.
// Fan-out (notifications) from people outside the workspace is rate limited.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-public-comments-test-'));
process.env.NC_SCHEDULER = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function tx(user: string | null, spaceId: string, operations: any[]) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
}

const ptr = (table: string, id: string) => ({ table, id, spaceId: ids.space });

/** The operations the web app sends for a new thread (comments.tsx addComment). */
function newThreadOps(user: string, blockId: string, text: string, type: 'page' | 'default' = 'page') {
  const did = newId();
  const cid = newId();
  const now = Date.now();
  return {
    did, cid,
    ops: [
      { pointer: ptr('discussion', did), path: [], command: 'set', args: { id: did, parent_id: blockId, parent_table: 'block', resolved: false, comments: [], space_id: ids.space, alive: true, type, created_by_id: user, created_time: now } },
      { pointer: ptr('block', blockId), path: ['discussions'], command: 'listAfter', args: { id: did } },
      { pointer: ptr('comment', cid), path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: [[text]], created_by_id: user, created_time: now, last_edited_time: now, alive: true, space_id: ids.space } },
      { pointer: ptr('discussion', did), path: ['comments'], command: 'listAfter', args: { id: cid } },
    ],
  };
}

function setPublicRole(role: string) {
  const p = db.getRecord<any>('block', ids.page)!;
  db.putRecord('block', { ...p, permissions: [...(p.permissions ?? []).filter((x: any) => x.type !== 'public_permission'), { type: 'public_permission', role, added_timestamp: Date.now() }] });
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'vera']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@public.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  seed.createWorkspace(ids.vera, 'Vera home');
  ids.page = newId();
  ids.block = newId();
  const now = Date.now();
  db.putRecord('block', {
    id: ids.page, version: 1, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, content: [ids.block],
    properties: { title: [['Launch notes']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }],
    created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
  db.putRecord('block', {
    id: ids.block, version: 1, type: 'text', parent_id: ids.page, parent_table: 'block', space_id: ids.space, alive: true,
    properties: { title: [['We ship on Friday']] }, created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
});

describe('comments on public pages', () => {
  it('"Can comment" for anyone with the link: a signed-in outsider starts page and block threads and replies', async () => {
    setPublicRole('comment_only');
    const page = newThreadOps(ids.vera, ids.page, 'Looks great!');
    expect(await status(() => tx(ids.vera, ids.space, page.ops))).toBe(200);
    expect(db.getRecord<any>('block', ids.page)!.discussions).toContain(page.did);
    expect(db.getRecord<any>('comment', page.cid)!.created_by_id).toBe(ids.vera);
    const block = newThreadOps(ids.vera, ids.block, 'Which Friday?', 'default');
    expect(await status(() => tx(ids.vera, ids.space, block.ops))).toBe(200);
    // the author of the page hears about it
    await call(ids.vera, 'notifyComment', { commentId: page.cid });
    const inbox = (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ? AND json_extract(data, '$.comment_id') = ?`).all(ids.alice, page.cid) as { data: string }[]);
    expect(inbox.length).toBe(1);
  });

  it('commenting is all an outsider can do', async () => {
    expect(await status(() => tx(ids.vera, ids.space, [{ pointer: ptr('block', ids.block), path: ['properties', 'title'], command: 'set', args: [['Hijacked']] }]))).toBe(403);
    expect(await status(() => tx(ids.vera, ids.space, [{ pointer: ptr('block', ids.page), path: ['permissions'], command: 'set', args: [] }]))).toBe(403);
    // someone else's thread can't be removed from the page
    const theirs = db.getRecord<any>('block', ids.page)!.discussions[0];
    const other = newThreadOps(ids.alice, ids.page, 'Owner note');
    await tx(ids.alice, ids.space, other.ops);
    expect(await status(() => tx(ids.vera, ids.space, [{ pointer: ptr('block', ids.page), path: ['discussions'], command: 'listRemove', args: { id: other.did } }]))).toBe(403);
    expect(theirs).toBeTruthy();
  });

  it('"Can view" links and signed-out visitors can not comment', async () => {
    setPublicRole('reader');
    const t1 = newThreadOps(ids.vera, ids.page, 'Hello?');
    expect(await status(() => tx(ids.vera, ids.space, t1.ops))).toBe(403);
    setPublicRole('comment_only');
    const t2 = newThreadOps(ids.vera, ids.page, 'Anonymous');
    expect(await status(() => tx(null, ids.space, t2.ops))).toBe(401);
  });

  it('notifications from people outside the workspace are rate limited', async () => {
    let limited = 0;
    for (let i = 0; i < 40; i++) {
      const t = newThreadOps(ids.vera, ids.page, `spam ${i}`);
      await tx(ids.vera, ids.space, t.ops);
      limited += (await status(() => call(ids.vera, 'notifyComment', { commentId: t.cid }))) === 429 ? 1 : 0;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

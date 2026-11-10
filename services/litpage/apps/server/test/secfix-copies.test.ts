// Regression tests: copies only contain what the person copying can see — database duplicates (move.ts
// duplicateDatabase / duplicateToSpace), "Duplicate" of a public page (sharing.ts) and Duplicate (TreeCopier): rows
// hidden by page-level rules, values / schema of properties with no access and restricted sub-pages stay behind.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-copies-test-'));
delete process.env.NC_DEV_LOGIN_CODES;
vi.setConfig({ testTimeout: 30_000 });

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, ip: '127.0.0.1', setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

const now = Date.now();
const base = (id: string, extra: Record<string, unknown>) => ({ id, version: 1, alive: true, space_id: ids.space, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner, ...extra });
const schema = {
  title: { name: 'Name', type: 'title' },
  pub: { name: 'Public note', type: 'text' },
  sec: { name: 'Salary', type: 'text', property_permissions: { default_access: 'none' } },
};

/** A page with a database inside it (`dbPerms` make the database's own sharing); returns ids. */
function pageWithDatabase(pagePerms: any[], dbPerms?: any[]) {
  const page = newId();
  const dbBlock = newId();
  const col = newId();
  const view = newId();
  const shown = newId();
  const hidden = newId();
  const sub = newId();
  db.putRecord('block', base(page, { type: 'page', parent_id: ids.space, parent_table: 'space', properties: { title: [['Payroll']] }, permissions: pagePerms, content: [dbBlock, sub] }) as any);
  db.putRecord('block', base(dbBlock, { type: 'collection_view', parent_id: page, parent_table: 'block', collection_id: col, view_ids: [view], ...(dbPerms ? { permissions: dbPerms, permissions_unlinked: true } : {}) }) as any);
  db.putRecord('collection', base(col, { parent_id: dbBlock, parent_table: 'block', name: [['People']], schema, template_pages: [] }) as any);
  db.putRecord('collection_view', base(view, { type: 'table', name: 'Table', parent_id: dbBlock, parent_table: 'block', format: {}, query2: {} }) as any);
  db.putRecord('block', base(shown, { type: 'page', parent_id: col, parent_table: 'collection', properties: { title: [['Ann']], pub: [['hello']], sec: [['SECRET-100k']] } }) as any);
  // a row only the owner may open, and a sub-page restricted to the owner
  db.putRecord('block', base(hidden, { type: 'page', parent_id: col, parent_table: 'collection', properties: { title: [['HIDDEN-ROW']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }], permissions_unlinked: true }) as any);
  db.putRecord('block', base(sub, { type: 'page', parent_id: page, parent_table: 'block', properties: { title: [['RESTRICTED-SUBPAGE']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }], permissions_unlinked: true }) as any);
  return { page, dbBlock, col, shown, hidden, sub };
}

/** Every record of a copy (blocks below `rootId` + data sources), as JSON. */
function copyJson(rootId: string): string {
  const out: any[] = [];
  const q = [rootId];
  while (q.length) {
    const id = q.pop()!;
    const b = db.getRecord<any>('block', id);
    if (!b) continue;
    out.push(b);
    for (const c of b.content ?? []) q.push(c);
    for (const cid of [b.collection_id].filter(Boolean)) {
      const c = db.getRecord<any>('collection', cid);
      if (!c || c.parent_id !== b.id) continue;
      out.push(c);
      for (const r of db.db.prepare(`SELECT id FROM records WHERE tbl = 'block' AND parent_id = ?`).all(c.id) as { id: string }[]) q.push(r.id);
    }
  }
  return JSON.stringify(out);
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  for (const n of ['owner', 'user', 'visitor']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@copies.test`, n);
  }
  ids.space = seed.createWorkspace(ids.owner, 'Acme').space.id;
  seed.addMember(ids.space, ids.user, 'editor');
  ids.userSpace = seed.createWorkspace(ids.user, 'Mine').space.id;
  ids.visitorSpace = seed.createWorkspace(ids.visitor, 'Visitor').space.id;
});

describe('database duplicates (move.ts) copy only what the person sees', () => {
  it('Duplicate with content: no hidden rows, no values or schema of "No access" properties', async () => {
    // the user can edit the page but only "can edit" the database (not full access): Salary has no access for them
    const d = pageWithDatabase(
      [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.user }],
      [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'read_and_write', user_id: ids.user }],
    );
    const res = await call(ids.user, 'duplicateDatabase', { blockId: d.dbBlock, withContent: true });
    const json = copyJson(res.blockId);
    expect(json).toContain('Ann');
    expect(json).toContain('hello');
    expect(json).not.toContain('SECRET-100k');
    expect(json).not.toContain('Salary');
    expect(json).not.toContain('HIDDEN-ROW');
  });

  it('Move to another workspace (duplicate): no hidden rows or restricted sub-pages', async () => {
    const d = pageWithDatabase([{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.user }]);
    const res = await call(ids.user, 'duplicateToSpace', { blockIds: [d.page], spaceId: ids.userSpace, parent: { kind: 'private' } });
    const json = copyJson(res.blockIds[0]);
    expect(json).toContain('Ann');
    expect(json).not.toContain('HIDDEN-ROW');
    expect(json).not.toContain('RESTRICTED-SUBPAGE');
  });

  it('Duplicate (TreeCopier) leaves restricted sub-pages behind', async () => {
    const d = pageWithDatabase([{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.user }]);
    const res = await call(ids.user, 'duplicateBlock', { blockId: d.page });
    const json = copyJson(res.blockId);
    expect(json).toContain('Payroll');
    expect(json).not.toContain('RESTRICTED-SUBPAGE');
    expect(json).not.toContain('HIDDEN-ROW');
  });
});

describe('"Duplicate" of a public page copies what the visitor sees', () => {
  it('leaves restricted values, property names, hidden rows and restricted sub-pages behind', async () => {
    const d = pageWithDatabase([
      { type: 'user_permission', role: 'editor', user_id: ids.owner },
      { type: 'public_permission', role: 'reader', published: true, allow_duplicate: true },
    ]);
    const res = await call(ids.visitor, 'duplicatePublicPage', { pageId: d.page, spaceId: ids.visitorSpace });
    const json = copyJson(res.blockId);
    expect(json).toContain('Ann');
    expect(json).toContain('hello');
    expect(json).not.toContain('SECRET-100k');
    expect(json).not.toContain('Salary');
    expect(json).not.toContain('HIDDEN-ROW');
    expect(json).not.toContain('RESTRICTED-SUBPAGE');
  });
});

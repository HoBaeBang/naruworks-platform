// Version history and databases: versions remember a database's properties, records with their
// property values and views; restoring brings those back (records added since go to Trash, deleted ones return) but not
// the records' page content; full access is required for a full-page database, locked databases stay unchanged, and a
// page with inline databases restores them only with "Also restore databases on this page".
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-version-db-test-'));
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

function tx(user: string, operations: any[]) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
}
const ptr = (table: string, id: string) => ({ table, id, spaceId: ids.space });
const setOp = (table: string, id: string, path: string[], args: unknown) => ({ pointer: ptr(table, id), path, command: 'set', args });
const rec = (table: string, id: string) => db.getRecord<any>(table, id)!;
const titleOf = (b: any) => (b?.properties?.title ?? []).map((x: any[]) => x[0]).join('');

function newRow(colId: string, title: string, props: Record<string, unknown> = {}) {
  const id = newId();
  const now = Date.now();
  tx(ids.alice, [setOp('block', id, [], {
    id, type: 'page', parent_id: colId, parent_table: 'collection', alive: true, space_id: ids.space,
    properties: { title: [[title]], ...props }, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice,
  })]);
  return id;
}

/** A database block (full page when `parent` is the space's private page list, inline inside `parent` otherwise). */
function makeDatabase(type: 'collection_view_page' | 'collection_view', parentId: string, name: string) {
  const blockId = newId();
  const colId = newId();
  const viewId = newId();
  const now = Date.now();
  db.putRecord('block', {
    id: blockId, version: 1, type, parent_id: parentId, parent_table: 'block', space_id: ids.space, alive: true,
    collection_id: colId, view_ids: [viewId], created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
  const p = rec('block', parentId);
  db.putRecord('block', { ...p, content: [...(p.content ?? []), blockId] });
  db.putRecord('collection', {
    id: colId, version: 1, name: [[name]], parent_id: blockId, parent_table: 'block', space_id: ids.space, alive: true,
    schema: { title: { name: 'Name', type: 'title' }, notes: { name: 'Notes', type: 'text' } },
  } as any);
  db.putRecord('collection_view', { id: viewId, version: 1, type: 'table', name: 'Table', parent_id: blockId, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
  return { blockId, colId, viewId };
}

async function latestVersion(pageId: string): Promise<string> {
  const h = await call(ids.alice, 'getVersionHistory', { pageId });
  return h.versions[0].id;
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'bob']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@versions.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.private = w.spaceView.private_pages[0];
  seed.addMember(ids.space, ids.bob, 'editor');
});

describe('full-page database versions', () => {
  it('restores properties, records and their values, views — not the records’ page content', async () => {
    const d = makeDatabase('collection_view_page', ids.private, 'Tasks');
    const keep = newRow(d.colId, 'Keep', { notes: [['original']] });
    const gone = newRow(d.colId, 'Deleted later');
    const v1 = await latestVersion(d.blockId);
    const preview = await call(ids.alice, 'getVersionPreview', { snapshotId: v1 });
    expect(preview.databases).toEqual([expect.objectContaining({ blockId: d.blockId, status: 'restored', rows: 2, inline: false })]);
    // later: a property added, a value edited, a record added, one deleted, the view filtered, content in a record page
    tx(ids.alice, [setOp('collection', d.colId, ['schema', 'extra'], { name: 'Extra', type: 'text' })]);
    tx(ids.alice, [setOp('block', keep, ['properties', 'notes'], [['edited']])]);
    const added = newRow(d.colId, 'Added later');
    tx(ids.alice, [setOp('block', gone, ['alive'], false)]);
    tx(ids.alice, [setOp('collection_view', d.viewId, ['format', 'table_wrap'], true)]);
    const textId = newId();
    tx(ids.alice, [
      setOp('block', textId, [], { id: textId, type: 'text', parent_id: keep, parent_table: 'block', alive: true, space_id: ids.space, properties: { title: [['row body']] } }),
      { pointer: ptr('block', keep), path: ['content'], command: 'listAfter', args: { id: textId } },
    ]);
    await latestVersion(d.blockId);
    const res = await call(ids.alice, 'restoreVersion', { snapshotId: v1 });
    expect(res.databasesUnchanged).toBe(0);
    expect(rec('collection', d.colId).schema.extra).toBeUndefined();
    expect(rec('block', keep).properties.notes).toEqual([['original']]);
    expect(rec('block', added).alive).toBe(false);
    expect(rec('block', gone).alive).toBe(true);
    expect(rec('collection_view', d.viewId).format.table_wrap).toBeUndefined();
    // the record's page content is not part of the database restore
    expect(rec('block', keep).content).toContain(textId);
    expect(rec('block', textId).alive).toBe(true);
    ids.fullDb = d.blockId;
    ids.fullDbVersion = v1;
  });

  it('needs full access to the database', async () => {
    const perms = rec('block', ids.fullDb).permissions ?? [];
    tx(ids.alice, [setOp('block', ids.fullDb, ['permissions'], [...perms, { type: 'user_permission', user_id: ids.bob, role: 'read_and_write' }])]);
    expect(await status(() => call(ids.bob, 'restoreVersion', { snapshotId: ids.fullDbVersion }))).toBe(403);
  });
});

describe('pages with inline databases', () => {
  it('"Also restore databases on this page" decides; locked databases stay unchanged', async () => {
    const pageId = newId();
    const now = Date.now();
    db.putRecord('block', { id: pageId, version: 1, type: 'page', parent_id: ids.private, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Plan']] }, created_time: now, created_by_id: ids.alice, last_edited_time: now } as any);
    const p = rec('block', ids.private);
    db.putRecord('block', { ...p, content: [...(p.content ?? []), pageId] });
    const d = makeDatabase('collection_view', pageId, 'Inline');
    const row = newRow(d.colId, 'Row', { notes: [['v1']] });
    const v1 = await latestVersion(pageId);
    tx(ids.alice, [setOp('block', row, ['properties', 'notes'], [['v2']])]);
    await latestVersion(pageId);
    const preview = await call(ids.alice, 'getVersionPreview', { snapshotId: v1 });
    expect(preview.databases).toEqual([expect.objectContaining({ blockId: d.blockId, status: 'restored', inline: true, name: 'Inline' })]);

    await call(ids.alice, 'restoreVersion', { snapshotId: v1, restoreDatabases: false });
    expect(rec('block', row).properties.notes).toEqual([['v2']]);
    await call(ids.alice, 'restoreVersion', { snapshotId: v1, restoreDatabases: true });
    expect(rec('block', row).properties.notes).toEqual([['v1']]);

    // locked: the page comes back, the database is left as it is ("1 database was left unchanged")
    tx(ids.alice, [setOp('block', row, ['properties', 'notes'], [['v3']])]);
    tx(ids.alice, [setOp('block', d.blockId, ['format'], { block_locked: true, block_locked_by: ids.alice })]);
    await latestVersion(pageId);
    const locked = await call(ids.alice, 'getVersionPreview', { snapshotId: v1 });
    expect(locked.databases[0]).toMatchObject({ status: 'unchanged' });
    const res = await call(ids.alice, 'restoreVersion', { snapshotId: v1, restoreDatabases: true });
    expect(res.databasesUnchanged).toBe(1);
    expect(rec('block', row).properties.notes).toEqual([['v3']]);
  });
});

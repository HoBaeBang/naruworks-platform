// Version history and database privacy (audit A3 items 1–2): stored versions hold a database's rows with every
// property value, so they reach people with edit access only and only as those people may see the page today —
// rows they can't open, values of properties they can't see and "No access" properties stay out (snapshot contents,
// version preview). Restoring writes back only values the restorer may edit and never changes access rules.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-dbsec-versions-'));
process.env.NC_SCHEDULER = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
const tx = (user: string, operations: any[]) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
const ptr = (table: string, id: string) => ({ table, id, spaceId: ids.space });
const setOp = (table: string, id: string, path: string[], args: unknown) => ({ pointer: ptr(table, id), path, command: 'set', args });
const rec = (table: string, id: string) => db.getRecord<any>(table, id)!;
const person = (userId: string) => [['‣', [['u', userId]]]];

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function newRow(title: string, props: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const id = newId();
  const now = Date.now();
  tx(ids.alice, [setOp('block', id, [], {
    id, type: 'page', parent_id: ids.col, parent_table: 'collection', alive: true, space_id: ids.space,
    properties: { title: [[title]], ...props }, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice, ...extra,
  })]);
  return id;
}

async function latestVersion(pageId: string): Promise<string> {
  return (await call(ids.alice, 'getVersionHistory', { pageId })).versions[0].id;
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'carl', 'dina', 'erin', 'fred']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@dbsec-v.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.private = w.spaceView.private_pages[0];
  for (const n of ['carl', 'dina', 'erin', 'fred']) seed.addMember(ids.space, ids[n], 'member');

  // a full-page database in Alice's private page: Notes, Salary ("No access"), Grade ("Can view property & values"),
  // Code ("Can view property only"), Owner (page-level rule "Can edit")
  ids.db = newId();
  ids.col = newId();
  ids.view = newId();
  const now = Date.now();
  db.putRecord('block', {
    id: ids.db, version: 1, type: 'collection_view_page', parent_id: ids.private, parent_table: 'block', space_id: ids.space, alive: true,
    collection_id: ids.col, view_ids: [ids.view], created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
  const p = rec('block', ids.private);
  db.putRecord('block', { ...p, content: [...(p.content ?? []), ids.db] });
  db.putRecord('collection', {
    id: ids.col, version: 1, name: [['Payroll']], parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true,
    schema: {
      title: { name: 'Name', type: 'title' }, notes: { name: 'Notes', type: 'text' }, sal: { name: 'Salary', type: 'text' },
      grade: { name: 'Grade', type: 'text' }, code: { name: 'Code', type: 'text' }, own: { name: 'Owner', type: 'person' },
    },
  } as any);
  db.putRecord('collection_view', { id: ids.view, version: 1, type: 'table', name: 'Table', parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
  ids.alpha = newRow('Alpha', { notes: [['alpha notes']], sal: [['alpha-salary-111']], grade: [['A1']], code: [['alpha-code-222']] });
  ids.erinRow = newRow('Erin row', { notes: [['erin notes v1']], sal: [['erin-salary-v1']], grade: [['E-v1']], own: person(ids.erin) });
  // a row restricted to Alice (its sharing unlinked from the database)
  ids.secretRow = newRow('Secret row', { notes: [['only alice']] }, { permissions_unlinked: true, permissions: [{ type: 'user_permission', user_id: ids.alice, role: 'editor' }] });
  // Carl edits the database, Dina can only create pages, Fred views; Erin reaches her row only through the Owner rule
  tx(ids.alice, [setOp('block', ids.db, ['permissions'], [
    { type: 'user_permission', user_id: ids.alice, role: 'editor' },
    { type: 'user_permission', user_id: ids.carl, role: 'read_and_write' },
    { type: 'user_permission', user_id: ids.dina, role: 'none', can_create_pages_in_collection: true },
    { type: 'user_permission', user_id: ids.fred, role: 'reader' },
  ])]);
  tx(ids.alice, [setOp('collection', ids.col, ['permission_rules'], [{ id: 'r-own', property: 'own', role: 'read_and_write' }])]);
  tx(ids.alice, [setOp('collection', ids.col, ['schema', 'sal', 'property_permissions'], { default_access: 'none', overrides: [] })]);
  tx(ids.alice, [setOp('collection', ids.col, ['schema', 'grade', 'property_permissions'], { default_access: 'reader', overrides: [] })]);
  tx(ids.alice, [setOp('collection', ids.col, ['schema', 'code', 'property_permissions'], { default_access: 'schema_only', overrides: [] })]);
  ids.dbVersion = await latestVersion(ids.db);
});

describe('stored versions follow database privacy (audit A3 #1)', () => {
  it('version history needs edit access; viewers and "Can only create" people can neither list nor read versions', async () => {
    expect(await status(() => call(ids.fred, 'listPageVersions', { pageId: ids.db }))).toBe(403);
    expect(await status(() => call(ids.dina, 'listPageVersions', { pageId: ids.db }))).toBe(403);
    expect(await status(() => call(ids.fred, 'getPageVersion', { snapshotId: ids.dbVersion }))).toBe(403);
    expect(await status(() => call(ids.dina, 'getPageVersion', { snapshotId: ids.dbVersion }))).toBe(403);
    expect(await status(() => call(ids.fred, 'getVersionPreview', { snapshotId: ids.dbVersion }))).toBe(403);
    expect((await call(ids.carl, 'listPageVersions', { pageId: ids.db })).snapshots.length).toBeGreaterThan(0);
  });

  it('snapshot contents leave out hidden rows, hidden values and "No access" properties', async () => {
    const asCarl = await call(ids.carl, 'getPageVersion', { snapshotId: ids.dbVersion });
    const text = JSON.stringify(asCarl);
    expect(text).not.toContain('alpha-salary-111');
    expect(text).not.toContain('erin-salary-v1');
    expect(text).not.toContain('alpha-code-222');
    expect(text).not.toContain('only alice');
    const d = asCarl.data.databases[ids.db];
    expect(d.collection.schema.sal).toBeUndefined();
    expect(d.collection.schema.code).toBeTruthy(); // "Can view property only": the column, not its values
    expect(d.rows.map((r: any) => r.properties.title[0][0]).sort()).toEqual(['Alpha', 'Erin row']);
    expect(d.rows.find((r: any) => r.id === ids.alpha).properties.grade).toEqual([['A1']]);
    // the owner still gets everything
    const asAlice = JSON.stringify(await call(ids.alice, 'getPageVersion', { snapshotId: ids.dbVersion }));
    expect(asAlice).toContain('alpha-salary-111');
    expect(asAlice).toContain('only alice');
  });

  it('the version preview reports databases from the visible rows only', async () => {
    const preview = await call(ids.carl, 'getVersionPreview', { snapshotId: ids.dbVersion });
    expect(JSON.stringify(preview)).not.toContain('alpha-salary-111');
    expect(preview.databases[0]).toMatchObject({ blockId: ids.db, rows: 2 });
  });
});

describe('the Updates feed reads versions the same way', () => {
  it('a sub-page restricted from the reader doesn’t show up in the page’s Updates', async () => {
    const page = newId();
    const now = Date.now();
    db.putRecord('block', { id: page, version: 1, type: 'page', parent_id: ids.private, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Notes']] }, permissions: [{ type: 'user_permission', user_id: ids.alice, role: 'editor' }, { type: 'user_permission', user_id: ids.fred, role: 'reader' }], created_time: now, created_by_id: ids.alice, last_edited_time: now } as any);
    await latestVersion(page);
    // the Updates feed tells "before" and "after" versions apart by time: keep the edit out of the first version's millisecond
    await new Promise((r) => setTimeout(r, 5));
    const sub = newId();
    tx(ids.alice, [
      setOp('block', sub, [], { id: sub, type: 'page', parent_id: page, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Secret plan']] }, permissions_unlinked: true, permissions: [{ type: 'user_permission', user_id: ids.alice, role: 'editor' }], created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice }),
      { pointer: { table: 'block', id: page, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: sub } },
    ]);
    await latestVersion(page);
    expect(JSON.stringify(await call(ids.alice, 'getPageUpdates', { pageId: page }))).toContain('Secret plan');
    expect(JSON.stringify(await call(ids.fred, 'getPageUpdates', { pageId: page }))).not.toContain('Secret plan');
  });
});

describe('row page versions and restores (audit A3 #2)', () => {
  it('a row editor previews a row version without restricted values and restores only what they may edit', async () => {
    const v1 = await latestVersion(ids.erinRow);
    tx(ids.alice, [setOp('block', ids.erinRow, ['properties', 'sal'], [['erin-salary-v2']])]);
    tx(ids.alice, [setOp('block', ids.erinRow, ['properties', 'grade'], [['E-v2']])]);
    tx(ids.alice, [setOp('block', ids.erinRow, ['properties', 'notes'], [['erin notes v2']])]);
    await latestVersion(ids.erinRow);
    // Erin can edit her row (page-level rule) but can't see Salary and can only view Grade
    const preview = await call(ids.erin, 'getVersionPreview', { snapshotId: v1 });
    const root = preview.blocks.find((b: any) => b.id === ids.erinRow);
    expect(root.properties.sal).toBeUndefined();
    expect(root.properties.grade).toEqual([['E-v1']]);
    expect(JSON.stringify(preview)).not.toContain('erin-salary');
    await call(ids.erin, 'restoreVersion', { snapshotId: v1 });
    const row = rec('block', ids.erinRow);
    expect(row.properties.notes).toEqual([['erin notes v1']]);
    expect(row.properties.sal).toEqual([['erin-salary-v2']]);
    expect(row.properties.grade).toEqual([['E-v2']]);
    // the legacy endpoint follows the same rules
    tx(ids.alice, [setOp('block', ids.erinRow, ['properties', 'notes'], [['erin notes v3']])]);
    await latestVersion(ids.erinRow);
    await call(ids.erin, 'restorePageVersion', { snapshotId: v1 });
    expect(rec('block', ids.erinRow).properties.notes).toEqual([['erin notes v1']]);
    expect(rec('block', ids.erinRow).properties.sal).toEqual([['erin-salary-v2']]);
  });

  it('restoring a database version keeps today’s access rules and keeps properties added since as deleted ones', async () => {
    const v = await latestVersion(ids.db);
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'notes', 'property_permissions'], { default_access: 'none', overrides: [] })]);
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'sal', 'property_permissions'], { default_access: 'none', overrides: [{ type: 'user_permission', user_id: ids.carl, role: 'reader' }] })]);
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'bonus'], { name: 'Bonus', type: 'text', property_permissions: { default_access: 'none', overrides: [] } })]);
    tx(ids.alice, [setOp('block', ids.alpha, ['properties', 'bonus'], [['alpha-bonus-333']])]);
    await latestVersion(ids.db);
    await call(ids.alice, 'restoreVersion', { snapshotId: v });
    const col = rec('collection', ids.col);
    expect(col.schema.notes.property_permissions).toEqual({ default_access: 'none', overrides: [] });
    expect(col.schema.sal.property_permissions.overrides).toHaveLength(1);
    expect(col.schema.bonus).toBeUndefined();
    expect(col.deleted_schema.bonus.property_permissions).toEqual({ default_access: 'none', overrides: [] });
    expect(rec('block', ids.alpha).properties.bonus).toEqual([['alpha-bonus-333']]);
    // …and the restored rows still don't show Carl what the current rules hide
    const asCarl = JSON.stringify(await call(ids.carl, 'loadCollectionRows', { collectionId: ids.col }));
    expect(asCarl).not.toContain('alpha notes');
    expect(asCarl).not.toContain('alpha-bonus-333');
    expect(asCarl).toContain('alpha-salary-111');
  });
});

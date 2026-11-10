// Database write rules that client and server-built writes share (audit A3 items 4, 5, 6, 9):
// - Property access on new rows: a row created (or moved in) by any write — client transaction, duplicate, CSV import —
// only carries values of restricted properties the writer can edit; copies drop what the copier couldn't see or edit
// - Automated sprints run as format.sprint_settings.automated_by: only the writer names themselves, for a Sprints
// database they can edit; the hourly job re-checks access and one failing database doesn't stop the others
// - "Disable duplicating pages to other workspaces" also covers data sources copied with their rows
// - Lock database also holds for user-initiated server writes (CSV import, view duplication)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-dbsec-writes-'));
process.env.NC_SCHEDULER = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let dbstruct: typeof import('../src/api/modules/dbstruct.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
const tx = (user: string, operations: any[], spaceId = ids.space) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
const ptr = (table: string, id: string, spaceId = ids.space) => ({ table, id, spaceId });
const setOp = (table: string, id: string, path: string[], args: unknown, spaceId = ids.space) => ({ pointer: ptr(table, id, spaceId), path, command: 'set', args });
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

function rowArgs(id: string, colId: string, user: string, props: Record<string, unknown>, spaceId = ids.space) {
  const now = Date.now();
  return {
    id, type: 'page', parent_id: colId, parent_table: 'collection', alive: true, space_id: spaceId, properties: props,
    created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user,
  };
}

const newRowOp = (user: string, colId: string, props: Record<string, unknown>) => {
  const id = newId();
  return { id, op: setOp('block', id, [], rowArgs(id, colId, user, props)) };
};

/** A full-page database under `parentId` (owner `owner`). */
function makeDatabase(parentId: string, name: string, schema: Record<string, unknown>, owner: string, spaceId = ids.space, format: Record<string, unknown> = {}) {
  const block = newId();
  const col = newId();
  const view = newId();
  const now = Date.now();
  db.putRecord('block', {
    id: block, version: 1, type: 'collection_view_page', parent_id: parentId, parent_table: 'block', space_id: spaceId, alive: true,
    collection_id: col, view_ids: [view], created_time: now, created_by_id: owner, last_edited_time: now,
  } as any);
  const p = rec('block', parentId);
  db.putRecord('block', { ...p, content: [...(p.content ?? []), block] });
  db.putRecord('collection', { id: col, version: 1, name: [[name]], parent_id: block, parent_table: 'block', space_id: spaceId, alive: true, schema, format } as any);
  db.putRecord('collection_view', { id: view, version: 1, type: 'table', name: 'Table', parent_id: block, parent_table: 'block', space_id: spaceId, alive: true, format: {}, page_sort: [] } as any);
  return { block, col, view };
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  dbstruct = await import('../src/api/modules/dbstruct.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'carl', 'bob']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@dbsec-w.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.private = w.spaceView.private_pages[0];
  seed.addMember(ids.space, ids.carl, 'member');
  seed.addMember(ids.space, ids.bob, 'member');
  // Carl's own private page in Acme (his space view)
  ids.carlPage = newId();
  const now = Date.now();
  db.putRecord('block', { id: ids.carlPage, version: 1, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, properties: { title: [['Carl home']] }, permissions: [{ type: 'user_permission', user_id: ids.carl, role: 'editor' }], created_time: now, created_by_id: ids.carl, last_edited_time: now } as any);
  // Bob's own workspace (destination of cross-workspace copies)
  const b = seed.createWorkspace(ids.bob, 'Bobco');
  ids.spaceB = b.space.id;
  ids.bobPrivate = b.spaceView.private_pages[0];

  // Payroll: Salary "No access", Grade "Can view property & values", Self "Can view property only" except "Page creator: Can
  // edit values only"
  const d = makeDatabase(ids.private, 'Payroll', {
    title: { name: 'Name', type: 'title' }, notes: { name: 'Notes', type: 'text' },
    sal: { name: 'Salary', type: 'text', property_permissions: { default_access: 'none', overrides: [] } },
    grade: { name: 'Grade', type: 'text', property_permissions: { default_access: 'reader', overrides: [] } },
    self: { name: 'Self review', type: 'text', property_permissions: { default_access: 'schema_only', overrides: [{ type: 'collection_property_permission', property_info: { property_id: 'created_by', type: 'created_by' }, role: 'content_only_editor' }] } },
    own: { name: 'Owner', type: 'person' },
  }, ids.alice);
  Object.assign(ids, { db: d.block, col: d.col, view: d.view });
  tx(ids.alice, [setOp('block', ids.db, ['permissions'], [
    { type: 'user_permission', user_id: ids.alice, role: 'editor' },
    { type: 'user_permission', user_id: ids.carl, role: 'read_and_write' },
    { type: 'user_permission', user_id: ids.bob, role: 'reader' },
  ])]);
  const alpha = newRowOp(ids.alice, ids.col, { title: [['Alpha']], notes: [['alpha notes']], sal: [['alpha-salary-111']], grade: [['A1']], self: [['alice-self-444']] });
  tx(ids.alice, [alpha.op]);
  ids.alpha = alpha.id;
});

describe('Property access on new rows (audit A3 #4)', () => {
  it('a client may create rows only with restricted values it can edit (a Page creator exception counts)', async () => {
    expect(await status(() => tx(ids.carl, [newRowOp(ids.carl, ids.col, { title: [['C1']], sal: [['carl-sets-salary']] }).op]))).toBe(403);
    expect(await status(() => tx(ids.carl, [newRowOp(ids.carl, ids.col, { title: [['C2']], grade: [['A+']] }).op]))).toBe(403);
    const own = newRowOp(ids.carl, ids.col, { title: [['C3']], notes: [['fine']], self: [['my own review']] });
    expect(await status(() => tx(ids.carl, [own.op]))).toBe(200);
    expect(rec('block', own.id).properties.self).toEqual([['my own review']]);
    // empty values are no values
    expect(await status(() => tx(ids.carl, [newRowOp(ids.carl, ids.col, { title: [['C4']], sal: [] }).op]))).toBe(200);
  });

  it('later operations of the same call are checked too', async () => {
    const r = newRowOp(ids.carl, ids.col, { title: [['C5']] });
    expect(await status(() => tx(ids.carl, [r.op, setOp('block', r.id, ['properties', 'sal'], [['sneaky']])]))).toBe(403);
    expect(db.getRecord('block', r.id)).toBeUndefined();
  });

  it('a row moved in from another database brings no restricted values its mover can’t edit', async () => {
    const other = makeDatabase(ids.carlPage, 'Scratch', { title: { name: 'Name', type: 'title' }, sal: { name: 'Salary', type: 'text' } }, ids.carl);
    const r = newRowOp(ids.carl, other.col, { title: [['Mover']], sal: [['moved-salary']] });
    expect(await status(() => tx(ids.carl, [r.op]))).toBe(200);
    expect(await status(() => tx(ids.carl, [{ pointer: ptr('block', r.id), path: [], command: 'update', args: { parent_id: ids.col } }]))).toBe(403);
    expect(rec('block', r.id).parent_id).toBe(other.col);
  });

  it('duplicates leave restricted values the copier couldn’t see or can’t edit behind', async () => {
    const res = await call(ids.carl, 'duplicateDatabaseRows', { rowIds: [ids.alpha] });
    const copy = rec('block', res.rowIds[0]);
    expect(copy.properties.notes).toEqual([['alpha notes']]);
    expect(copy.properties.sal).toBeUndefined();
    expect(copy.properties.grade).toBeUndefined();
    expect(copy.properties.self).toBeUndefined(); // Alice's value: Carl couldn't see it, though he may edit his copy's
    const page = await call(ids.carl, 'duplicateBlock', { blockId: ids.alpha });
    const p = rec('block', page.blockId);
    expect(p.parent_id).toBe(ids.col);
    expect(JSON.stringify(p.properties)).not.toMatch(/alpha-salary|A1|alice-self/);
    // full access copies everything
    const mine = await call(ids.alice, 'duplicateDatabaseRows', { rowIds: [ids.alpha] });
    expect(rec('block', mine.rowIds[0]).properties.sal).toEqual([['alpha-salary-111']]);
  });

  it('only real templates can be applied (an ordinary row would copy its hidden values)', async () => {
    const mine = newRowOp(ids.carl, ids.col, { title: [['Fresh']] });
    tx(ids.carl, [mine.op]);
    expect(await status(() => call(ids.carl, 'applyDatabaseTemplate', { rowId: mine.id, templateId: ids.alpha }))).toBe(404);
    expect(rec('block', mine.id).properties.sal).toBeUndefined();
  });

  it('CSV import into a database is checked like any write', async () => {
    expect(await status(() => call(ids.carl, 'importCsvToCollection', { collectionId: ids.col, csv: 'Name,Salary\nImported,999\n' }))).toBe(403);
    expect(await status(() => call(ids.carl, 'importCsvToCollection', { collectionId: ids.col, csv: 'Name,Notes\nImported,ok\n' }))).toBe(200);
  });

  it('a form response with a restricted answer is written by someone who may write it', async () => {
    const form = newId();
    const qTitle = newId();
    const qSal = newId();
    db.putRecord('collection_view', {
      id: form, version: 1, type: 'form', name: 'Form', parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, query2: {},
      format: { form_config: { version: 1, permission: 'space', ownerId: ids.alice, questions: [{ id: qTitle, config: { propertyId: 'title' } }, { id: qSal, config: { propertyId: 'sal' } }] } },
    } as any);
    db.putRecord('block', { ...rec('block', ids.db), view_ids: [ids.view, form] });
    const res = await call(ids.carl, 'submitFormResponse', { viewId: form, answers: { [qTitle]: 'Expectations', [qSal]: '120k' } });
    const page = rec('block', res.pageId);
    expect(page.properties.sal).toEqual([['120k']]);
    expect(page.created_by_id).toBe(ids.carl);
  });
});

describe('Lock database on server-built writes (audit A3 #9)', () => {
  it('CSV import adds rows but no properties, and views can’t be duplicated into a locked database', async () => {
    tx(ids.alice, [setOp('block', ids.db, ['format'], { block_locked: true, block_locked_by: ids.alice })]);
    expect(await status(() => call(ids.carl, 'importCsvToCollection', { collectionId: ids.col, csv: 'Name,Brand new column\nX,1\n' }))).toBe(403);
    expect(Object.values(rec('collection', ids.col).schema).some((p: any) => p.name === 'Brand new column')).toBe(false);
    expect(await status(() => call(ids.carl, 'importCsvToCollection', { collectionId: ids.col, csv: 'Name,Notes\nWhile locked,ok\n' }))).toBe(200);
    expect(await status(() => call(ids.carl, 'duplicateCollectionView', { viewId: ids.view }))).toBe(403);
    tx(ids.alice, [setOp('block', ids.db, ['format'], { block_locked: false })]);
    expect(await status(() => call(ids.carl, 'duplicateCollectionView', { viewId: ids.view }))).toBe(200);
  });
});

describe('Automated sprints run only as the person who turned them on (audit A3 #5)', () => {
  const range = (a: string, b: string) => [['‣', [['d', { type: 'daterange', start_date: a, end_date: b }]]]];
  const sprintSchema = (tasksCol: string, statusRule?: unknown) => ({
    title: { name: 'Sprint name', type: 'title' },
    ss: { name: 'Sprint status', type: 'select', options: ['Current', 'Next', 'Last', 'Past', 'Future'].map((v) => ({ id: v, value: v })), ...(statusRule ? { property_permissions: statusRule } : {}) },
    dt: { name: 'Dates', type: 'date' }, tk: { name: 'Tasks', type: 'relation', collection_id: tasksCol, property: 'sp' },
  });
  const sprintFormat = { app_config_uri: 'litpage://sprints_collection', app_uri_map: { 'litpage://sprints/sprint_status_property': 'ss', 'litpage://sprints/dates_property': 'dt', 'litpage://sprints/sprint_task_relation': 'tk' } };
  /** Tasks + Sprints databases under `parentId` (Sprint 1 ended long ago, Sprint 2 is next). */
  function sprintPair(parentId: string, owner: string, sprintsParent = parentId, statusRule?: unknown) {
    const t = makeDatabase(parentId, 'Tasks', { title: { name: 'Task', type: 'title' }, sp: { name: 'Sprint', type: 'relation' } }, owner, ids.space, {});
    const s = makeDatabase(sprintsParent, 'Sprints', sprintSchema(t.col, statusRule), owner, ids.space, sprintFormat);
    db.putRecord('collection', { ...rec('collection', t.col), schema: { ...rec('collection', t.col).schema, sp: { name: 'Sprint', type: 'relation', collection_id: s.col, property: 'tk' } }, format: { app_config_uri: 'litpage://tasks_collection', app_uri_map: { 'litpage://tasks/task_sprint_relation': 'sp' } } });
    for (const [title, st, a, b] of [['Sprint 1', 'Current', '2020-01-06', '2020-01-19'], ['Sprint 2', 'Next', '2020-01-20', '2020-02-02']]) {
      const id = newId();
      db.putRecord('block', { ...rowArgs(id, s.col, owner, { title: [[title]], ss: [[st]], dt: range(a, b) }), version: 1 } as any);
    }
    return { tasks: t, sprints: s };
  }
  const statusOf = (sprintsCol: string, title: string) => (db.childrenOf<any>('block', sprintsCol).find((r) => r.properties.title[0][0] === title)?.properties.ss ?? [])[0]?.[0];
  const settings = (s: Record<string, unknown>) => ({ duration_weeks: 2, start_day: 1, incomplete_tasks: 'next_sprint', ...s });

  it('only the writer can name themselves, for a Sprints database they can edit', async () => {
    const { tasks, sprints } = sprintPair(ids.carlPage, ids.carl, ids.private);
    // Carl edits the Tasks database (his page) but can't open the Sprints database (Alice's private page)
    expect(await status(() => tx(ids.carl, [setOp('collection', tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: sprints.col, automated: true, automated_by: ids.alice }))]))).toBe(403);
    expect(await status(() => tx(ids.carl, [setOp('collection', tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: sprints.col, automated: true, automated_by: ids.carl }))]))).toBe(403);
    // a Sprints database Carl can edit is fine
    const mine = makeDatabase(ids.carlPage, 'My sprints', sprintSchema(tasks.col), ids.carl, ids.space, sprintFormat);
    expect(await status(() => tx(ids.carl, [setOp('collection', tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: mine.col, automated: true, automated_by: ids.carl }))]))).toBe(200);
    // changing other settings keeps working; pointing someone else's automation elsewhere does not
    const shared = sprintPair(ids.private, ids.alice);
    tx(ids.alice, [setOp('block', shared.tasks.block, ['permissions'], [{ type: 'user_permission', user_id: ids.alice, role: 'editor' }, { type: 'user_permission', user_id: ids.carl, role: 'read_and_write' }])]);
    tx(ids.alice, [setOp('collection', shared.tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: shared.sprints.col, automated: true, automated_by: ids.alice }))]);
    expect(await status(() => tx(ids.carl, [setOp('collection', shared.tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: shared.sprints.col, automated: true, automated_by: ids.alice, duration_weeks: 3 }))]))).toBe(200);
    expect(await status(() => tx(ids.carl, [setOp('collection', shared.tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: mine.col, automated: true, automated_by: ids.alice }))]))).toBe(403);
    // a copy of the Tasks database doesn't keep Alice's automation
    const copy = await call(ids.carl, 'duplicateBlock', { blockId: shared.tasks.block, parentId: ids.carlPage, parentTable: 'block' });
    const copied = rec('collection', rec('block', copy.blockId).collection_id).format.sprint_settings;
    expect(copied.automated_by).toBeUndefined();
    expect(copied.automated).toBe(false);
  });

  it('the hourly job re-checks access, and a failing database doesn’t stop the others', async () => {
    // 1) Carl turned automation on, then lost access to the Sprints database: skipped
    const lost = sprintPair(ids.private, ids.alice);
    const editors = [{ type: 'user_permission', user_id: ids.alice, role: 'editor' }, { type: 'user_permission', user_id: ids.carl, role: 'read_and_write' }];
    tx(ids.alice, [setOp('block', lost.tasks.block, ['permissions'], editors), setOp('block', lost.sprints.block, ['permissions'], editors)]);
    tx(ids.carl, [setOp('collection', lost.tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: lost.sprints.col, automated: true, automated_by: ids.carl }))]);
    tx(ids.alice, [setOp('block', lost.sprints.block, ['permissions'], [editors[0]])]);
    // 2) Carl may edit both, but "Sprint status" is view-only for him: completing fails inside the job
    const failing = sprintPair(ids.private, ids.alice, ids.private, { default_access: 'reader', overrides: [] });
    tx(ids.alice, [setOp('block', failing.tasks.block, ['permissions'], editors), setOp('block', failing.sprints.block, ['permissions'], editors)]);
    tx(ids.carl, [setOp('collection', failing.tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: failing.sprints.col, automated: true, automated_by: ids.carl }))]);
    // 3) Alice's own automation still runs
    const ok = sprintPair(ids.private, ids.alice);
    tx(ids.alice, [setOp('collection', ok.tasks.col, ['format', 'sprint_settings'], settings({ sprints_collection_id: ok.sprints.col, automated: true, automated_by: ids.alice }))]);
    dbstruct.runAutomatedSprints();
    expect(statusOf(lost.sprints.col, 'Sprint 1')).toBe('Current');
    expect(statusOf(failing.sprints.col, 'Sprint 1')).toBe('Current');
    expect(statusOf(ok.sprints.col, 'Sprint 1')).toBe('Last');
    expect(statusOf(ok.sprints.col, 'Sprint 2')).toBe('Current');
  });
});

describe('"Disable duplicating pages to other workspaces" covers data source copies (audit A3 #6)', () => {
  /** Bob's client duplicating Payroll into his own workspace: new block + data source marked copied_from / nc_copy. */
  function copyOps() {
    const block = newId();
    const col = newId();
    const view = newId();
    const now = Date.now();
    const src = rec('collection', ids.col);
    return {
      block, col,
      ops: [
        setOp('block', block, [], { id: block, type: 'collection_view_page', parent_id: ids.bobPrivate, parent_table: 'block', space_id: ids.spaceB, alive: true, collection_id: col, view_ids: [view], created_time: now, created_by_id: ids.bob, last_edited_time: now }, ids.spaceB),
        setOp('collection', col, [], { id: col, parent_id: block, parent_table: 'block', space_id: ids.spaceB, alive: true, name: [['Payroll copy']], schema: { title: src.schema.title, notes: src.schema.notes }, copied_from: ids.col, nc_copy: 'with_content' }, ids.spaceB),
        setOp('collection_view', view, [], { id: view, type: 'table', name: 'Table', parent_id: block, parent_table: 'block', space_id: ids.spaceB, alive: true, format: {}, page_sort: [] }, ids.spaceB),
        { pointer: ptr('block', ids.bobPrivate, ids.spaceB), path: ['content'], command: 'listAfter', args: { id: block } },
      ],
    };
  }

  it('refuses copying another workspace’s rows when it disallows duplicating, else copies only what the copier may see', async () => {
    const space = rec('space', ids.space);
    db.putRecord('space', { ...space, settings: { ...(space.settings ?? {}), disable_move_to_space: true } });
    const blocked = copyOps();
    expect(await status(() => tx(ids.bob, blocked.ops, ids.spaceB))).toBe(403);
    expect(db.getRecord('collection', blocked.col)).toBeUndefined();
    db.putRecord('space', { ...rec('space', ids.space), settings: { ...(space.settings ?? {}), disable_move_to_space: false } });
    const allowed = copyOps();
    expect(await status(() => tx(ids.bob, allowed.ops, ids.spaceB))).toBe(200);
    const rows = db.childrenOf<any>('block', allowed.col).filter((r) => r.parent_table === 'collection');
    expect(rows.map((r) => r.properties.title[0][0])).toContain('Alpha');
    expect(JSON.stringify(rows)).not.toContain('alpha-salary-111');
  });
});

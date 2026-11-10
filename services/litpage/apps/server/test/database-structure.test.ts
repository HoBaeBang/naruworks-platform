// Database structure: Lock database, "Can edit content", "Can also create pages" / "Can only create",
// page-level access rules, property access, sub-item integrity, Unique ID numbering (server-assigned, never reused),
// Person "Default: Created by", schema guards, plus the shared planners for dependency date shifting and sprints.
// Handlers are called directly against a temporary SQLite workspace (same harness as page-features.test.ts).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-dbs-test-'));
process.env.NC_SCHEDULER = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let S: typeof import('@nc/shared/database/index.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

function tx(user: string, operations: any[], spaceId = ids.space) {
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

const ptr = (table: string, id: string) => ({ table, id, spaceId: ids.space });
const setOp = (table: string, id: string, path: string[], args: unknown) => ({ pointer: ptr(table, id), path, command: 'set', args });
const updateOp = (table: string, id: string, path: string[], args: unknown) => ({ pointer: ptr(table, id), path, command: 'update', args });
const titleOf = (b: any) => (b?.properties?.title ?? []).map((x: any[]) => x[0]).join('');
const rel = (...rowIds: string[]) => rowIds.flatMap((id, i) => (i ? [[','], ['‣', [['p', id, ids.space]]]] : [['‣', [['p', id, ids.space]]]]));
const person = (userId: string) => [['‣', [['u', userId]]]];

/** New row through a client transaction (the way the web app creates one). */
function newRow(user: string, title: string, extra: Record<string, unknown> = {}, idValue = '1') {
  const id = newId();
  const now = Date.now();
  tx(user, [setOp('block', id, [], {
    id, type: 'page', parent_id: ids.col, parent_table: 'collection', alive: true, space_id: ids.space,
    properties: { title: [[title]], uid: [[idValue]], ...extra }, created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user,
  })]);
  return id;
}

function row(id: string) {
  return db.getRecord<any>('block', id);
}

async function rowsAs(user: string) {
  const r = await call(user, 'loadCollectionRows', { collectionId: ids.col });
  return {
    collection: r.recordMap.collection?.[ids.col]?.value?.value,
    rows: Object.values(r.recordMap.block ?? {}).map((e: any) => e.value.value).filter((b: any) => b.parent_id === ids.col),
    total: r.total,
  };
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  S = await import('@nc/shared/database/index.ts');

  for (const n of ['alice', 'carl', 'dina', 'erin']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@dbs.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.private = w.spaceView.private_pages[0];

  // a full-page database in Alice's private page: Name, Owner (person), Notes (text), ID (TASK-n), sub-item pair
  ids.db = newId();
  ids.col = newId();
  ids.view = newId();
  const now = Date.now();
  db.putRecord('block', {
    id: ids.db, version: 1, type: 'collection_view_page', parent_id: ids.private, parent_table: 'block', space_id: ids.space, alive: true,
    collection_id: ids.col, view_ids: [ids.view], created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
  const p = db.getRecord<any>('block', ids.private)!;
  db.putRecord('block', { ...p, content: [...(p.content ?? []), ids.db] });
  db.putRecord('collection', {
    id: ids.col, version: 1, parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true,
    schema: {
      title: { name: 'Name', type: 'title' },
      own: { name: 'Owner', type: 'person' },
      notes: { name: 'Notes', type: 'text' },
      uid: { name: 'ID', type: 'auto_increment_id', prefix: 'TASK' },
      kids: { name: 'Sub-item', type: 'relation', collection_id: ids.col, property: 'par', version: 'v2' },
      par: { name: 'Parent item', type: 'relation', collection_id: ids.col, property: 'kids', version: 'v2', limit: 1 },
    },
    format: { subitem_property: 'kids' },
  } as any);
  db.putRecord('collection_view', { id: ids.view, version: 1, type: 'table', parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
});

describe('Unique ID (DB-UID-003/004)', () => {
  it('assigns increasing numbers on the server, whatever the client sent', () => {
    ids.r1 = newRow(ids.alice, 'R1');
    ids.r2 = newRow(ids.alice, 'R2');
    ids.r3 = newRow(ids.alice, 'R3');
    expect([row(ids.r1), row(ids.r2), row(ids.r3)].map((b) => b.properties.uid[0][0])).toEqual(['1', '2', '3']);
  });

  it('never reuses the number of a deleted row', () => {
    tx(ids.alice, [updateOp('block', ids.r3, [], { alive: false })]);
    const r4 = newRow(ids.alice, 'R4');
    expect(row(r4).properties.uid[0][0]).toBe('4');
  });

  it('numbers rows created together in one call distinctly (concurrent creators)', () => {
    const a = newId();
    const b = newId();
    const now = Date.now();
    const mk = (id: string, t: string, ts: number) => setOp('block', id, [], { id, type: 'page', parent_id: ids.col, parent_table: 'collection', alive: true, properties: { title: [[t]], uid: [['4']] }, created_time: ts, created_by_id: ids.alice, last_edited_time: ts });
    tx(ids.alice, [mk(a, 'A', now), mk(b, 'B', now + 1)]);
    expect(new Set([row(a).properties.uid[0][0], row(b).properties.uid[0][0]]).size).toBe(2);
    expect(Number(row(b).properties.uid[0][0])).toBeGreaterThan(Number(row(a).properties.uid[0][0]));
  });

  it('keeps an existing ID when a client tries to change it', () => {
    tx(ids.alice, [setOp('block', ids.r1, ['properties', 'uid'], [['99']])]);
    expect(row(ids.r1).properties.uid[0][0]).toBe('1');
  });

  it('resolves TASK-2 to the page for people who can open it only', async () => {
    const r = await call(ids.alice, 'resolveUniqueId', { uid: 'task-2' });
    expect(r.pageId).toBe(ids.r2);
    expect(await status(() => call(ids.erin, 'resolveUniqueId', { uid: 'TASK-2' }))).toBe(404);
    expect(await status(() => call(ids.alice, 'resolveUniqueId', { uid: 'TASK-77' }))).toBe(404);
  });

  it('refuses a second ID property, conversions and invalid prefixes', async () => {
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'uid2'], { name: 'ID 2', type: 'auto_increment_id' })]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'notes', 'type'], 'auto_increment_id')]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'uid', 'type'], 'number')]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'uid', 'prefix'], '1BAD')]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'uid', 'prefix'], 'TASK-X')]))).toBe(200);
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'uid', 'prefix'], 'TASK')]);
  });
});

describe('Person "Default: Created by"', () => {
  it('fills the creator into an empty Person property on new rows', () => {
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'own', 'default'], 'created_by')]);
    const r = newRow(ids.alice, 'Defaulted');
    expect(row(r).properties.own).toEqual(person(ids.alice));
    const kept = newRow(ids.alice, 'Explicit', { own: person(ids.carl) });
    expect(row(kept).properties.own).toEqual(person(ids.carl));
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'own', 'default'], undefined)]);
  });
});

describe('Lock database', () => {
  it('freezes views and properties but keeps data entry open', async () => {
    tx(ids.alice, [updateOp('block', ids.db, ['format'], { block_locked: true, block_locked_by: ids.alice })]);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'x'], { name: 'X', type: 'text' })]))).toBe(403);
    expect(await status(() => tx(ids.alice, [updateOp('collection_view', ids.view, ['format'], { table_wrap: false })]))).toBe(403);
    expect(await status(() => tx(ids.alice, [updateOp('block', ids.db, [], { alive: false })]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('block', ids.r2, ['properties', 'notes'], [['edited while locked']])]))).toBe(200);
    const fresh = newRow(ids.alice, 'Added while locked');
    expect(row(fresh)?.alive).toBe(true);
    expect(await status(() => tx(ids.alice, [{ pointer: ptr('collection_view', ids.view), path: ['page_sort'], command: 'listAfter', args: { id: fresh } }]))).toBe(200);
    tx(ids.alice, [updateOp('block', ids.db, ['format'], { block_locked: false, block_locked_by: null })]);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'x'], { name: 'X', type: 'text' })]))).toBe(200);
  });
});

describe('Database share roles (DB-PERM-003…005)', () => {
  it('"Can edit content": rows yes, views and properties no', async () => {
    tx(ids.alice, [setOp('block', ids.db, ['permissions'], [{ type: 'user_permission', user_id: ids.carl, role: 'content_only_editor', added_timestamp: Date.now() }])]);
    expect(await status(() => tx(ids.carl, [setOp('block', ids.r2, ['properties', 'notes'], [['by carl']])]))).toBe(200);
    expect(await status(() => tx(ids.carl, [setOp('collection', ids.col, ['schema', 'y'], { name: 'Y', type: 'text' })]))).toBe(403);
    expect(await status(() => tx(ids.carl, [updateOp('collection_view', ids.view, ['format'], { table_wrap: true })]))).toBe(403);
    const r = newRow(ids.carl, 'Carl row');
    expect(row(r)?.created_by_id).toBe(ids.carl);
    expect(await status(() => tx(ids.carl, [setOp('block', ids.db, ['permissions'], [])]))).toBe(403);
  });

  it('"Can only create": new pages only, own pages through the Created by rule', async () => {
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'cb'], { name: 'Created by', type: 'created_by' })]);
    tx(ids.alice, [setOp('collection', ids.col, ['permission_rules'], [{ id: 'r-cb', property: 'cb', role: 'read_and_write' }])]);
    const perms = row(ids.db).permissions ?? [];
    tx(ids.alice, [setOp('block', ids.db, ['permissions'], [...perms, { type: 'user_permission', user_id: ids.dina, role: 'none', can_create_pages_in_collection: true }])]);
    const before = await rowsAs(ids.dina);
    expect(before.rows).toHaveLength(0);
    expect(before.collection?.schema?.title).toBeTruthy();
    const mine = newRow(ids.dina, 'Dina page');
    expect(row(mine)?.alive).toBe(true);
    const after = await rowsAs(ids.dina);
    expect(after.rows.map(titleOf)).toEqual(['Dina page']);
    expect(after.total).toBe(1);
    expect(await status(() => tx(ids.dina, [setOp('block', mine, ['properties', 'notes'], [['mine']])]))).toBe(200);
    expect(await status(() => tx(ids.dina, [setOp('block', ids.r2, ['properties', 'notes'], [['not mine']])]))).toBe(403);
    expect(await status(() => tx(ids.dina, [setOp('collection', ids.col, ['permission_rules'], [])]))).toBe(403);
    expect(await status(() => tx(ids.carl, [setOp('collection', ids.col, ['permission_rules'], [])]))).toBe(403);
  });

  it('page-level rule: anyone in Owner gets the rule role on that page', async () => {
    const col = db.getRecord<any>('collection', ids.col)!;
    tx(ids.alice, [setOp('collection', ids.col, ['permission_rules'], [...col.permission_rules, { id: 'r-own', property: 'own', role: 'comment_only' }])]);
    expect((await rowsAs(ids.dina)).rows.map(titleOf)).not.toContain('R2');
    tx(ids.alice, [setOp('block', ids.r2, ['properties', 'own'], person(ids.dina))]);
    expect((await rowsAs(ids.dina)).rows.map(titleOf)).toContain('R2');
    expect(await status(() => tx(ids.dina, [setOp('block', ids.r2, ['properties', 'notes'], [['comment only']])]))).toBe(403);
    expect(S.rowRuleRole(row(ids.r2), db.getRecord<any>('collection', ids.col)!, ids.dina)).toBe('comment_only');
  });
});

describe('Property access', () => {
  it('"No access" removes the property and its values for others, and blocks their writes', async () => {
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'notes', 'property_permissions'], { default_access: 'none', overrides: [] })]);
    const asCarl = await rowsAs(ids.carl);
    expect(asCarl.collection.schema.notes).toBeUndefined();
    expect(asCarl.rows.some((r: any) => r.properties?.notes !== undefined)).toBe(false);
    const asAlice = await rowsAs(ids.alice);
    expect(asAlice.collection.schema.notes).toBeTruthy();
    expect(await status(() => tx(ids.carl, [setOp('block', ids.r2, ['properties', 'notes'], [['sneaky']])]))).toBe(403);
    expect(await status(() => tx(ids.carl, [setOp('block', ids.r2, ['properties', 'title'], [['R2']])]))).toBe(200);
  });

  it('"Can view property & values" shows values but refuses edits; an exception can open them', async () => {
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'notes', 'property_permissions'], { default_access: 'reader', overrides: [] })]);
    const asCarl = await rowsAs(ids.carl);
    expect(asCarl.rows.find((r: any) => r.id === ids.r2)?.properties?.notes).toBeTruthy();
    expect(await status(() => tx(ids.carl, [setOp('block', ids.r2, ['properties', 'notes'], [['nope']])]))).toBe(403);
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'notes', 'property_permissions'], { default_access: 'reader', overrides: [{ type: 'user_permission', user_id: ids.carl, role: 'content_only_editor' }] })]);
    expect(await status(() => tx(ids.carl, [setOp('block', ids.r2, ['properties', 'notes'], [['ok now']])]))).toBe(200);
  });

  it('only full access may change a rule; titles and IDs can’t be restricted', async () => {
    expect(await status(() => tx(ids.carl, [setOp('collection', ids.col, ['schema', 'notes', 'property_permissions'], { default_access: 'inherit', overrides: [] })]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'uid', 'property_permissions'], { default_access: 'none', overrides: [] })]))).toBe(403);
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'notes', 'property_permissions'], undefined)]);
  });

  it('resolves roles like Litpage (full access wins, exceptions beat the default, person-property exceptions per page)', () => {
    const prop: any = { name: 'P', type: 'text', property_permissions: { default_access: 'schema_only', overrides: [
      { type: 'group_permission', group_id: 'g1', role: 'reader' },
      { type: 'collection_property_permission', property_info: { property_id: 'own', type: 'person' }, role: 'content_only_editor' },
    ] } };
    const schema: any = { own: { name: 'Owner', type: 'person' } };
    expect(S.propertyRoleFor(prop, { userId: 'u', databaseRole: 'editor' })).toBe('editor');
    expect(S.propertyRoleFor(prop, { userId: 'u', databaseRole: 'read_and_write' })).toBe('schema_only');
    expect(S.propertyRoleFor(prop, { userId: 'u', databaseRole: 'read_and_write', groupIds: ['g1'] })).toBe('reader');
    const rowWithU = { properties: { own: person('u') } } as any;
    expect(S.propertyRoleFor(prop, { userId: 'u', databaseRole: 'read_and_write', row: rowWithU, schema })).toBe('content_only_editor');
    const none: any = { ...prop, property_permissions: { ...prop.property_permissions, default_access: 'none' } };
    expect(S.propertyRoleFor(none, { userId: 'u', databaseRole: 'read_and_write', row: rowWithU, schema })).toBe('none');
  });
});

describe('Sub-items (DB-TASK-003/008)', () => {
  it('refuses self-parenting, cycles and keeps both sides', async () => {
    expect(await status(() => tx(ids.alice, [setOp('block', ids.r1, ['properties', 'par'], rel(ids.r1))]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('block', ids.r2, ['properties', 'par'], rel(ids.r1)), setOp('block', ids.r1, ['properties', 'kids'], rel(ids.r2))]))).toBe(200);
    // R1 → R2; making R1 a child of R2 would close a loop
    expect(await status(() => tx(ids.alice, [setOp('block', ids.r1, ['properties', 'par'], rel(ids.r2))]))).toBe(403);
    expect(await status(() => tx(ids.alice, [setOp('block', ids.r2, ['properties', 'kids'], rel(ids.r1))]))).toBe(403);
  });

  it('duplicates rows together with their sub-items', async () => {
    const r = await call(ids.alice, 'duplicateDatabaseRows', { rowIds: [ids.r1] });
    expect(r.rowIds).toHaveLength(1);
    const copy = row(r.rowIds[0]);
    expect(titleOf(copy)).toBe('R1 (1)');
    const kids = S.childIdsOf(copy, { property: 'kids', inverse: 'par' });
    expect(kids).toHaveLength(1);
    expect(kids[0]).not.toBe(ids.r2);
    expect(S.parentIdOf(row(kids[0]), { property: 'kids', inverse: 'par' })).toBe(copy.id);
    // copies get fresh unique IDs
    expect(copy.properties.uid[0][0]).not.toBe(row(ids.r1).properties.uid[0][0]);
  });

  it('arranges nested rows and filter scopes', () => {
    const cfg = { property: 'kids', inverse: 'par' };
    const mk = (id: string, parent?: string, kids: string[] = []) => ({ id, properties: { ...(parent ? { par: rel(parent) } : {}), ...(kids.length ? { kids: rel(...kids) } : {}) } }) as any;
    const a = mk('a', undefined, ['b']);
    const b = mk('b', 'a', ['c']);
    const c = mk('c', 'b');
    const d = mk('d');
    const nested = S.arrangeSubitems([a, b, c, d], (r: any) => r.id !== 'a', { ...cfg, mode: 'show', scope: 'parents_and_subitems' } as any);
    expect(nested.rows.map((r: any) => r.id)).toEqual(['a', 'd']);
    expect(nested.result.context).toContain('a');
    expect(nested.result.children.a.map((r: any) => r.id)).toEqual(['b']);
    expect(nested.result.depth.c).toBe(2);
    const parentsOnly = S.arrangeSubitems([a, b, c, d], (r: any) => r.id !== 'a', { ...cfg, mode: 'show', scope: 'parents' } as any);
    expect(parentsOnly.rows.map((r: any) => r.id)).toEqual(['d']);
    const flat = S.arrangeSubitems([a, b, c, d], () => true, { ...cfg, mode: 'flattened', scope: 'subitems' } as any);
    expect(flat.rows.map((r: any) => r.id)).toEqual(['b', 'c']);
    expect(S.descendantIds(['a'], S.parentMap([a, b, c, d], cfg)).sort()).toEqual(['b', 'c']);
  });
});

describe('Dependency date shifting', () => {
  const cfg = { blocking: 'blk', blockedBy: 'by', mode: 'consume_gap' as const, avoidWeekends: false, dateProperty: 'd' };
  const dateOf = (start: string, end?: string) => [['‣', [['d', { type: end ? 'daterange' : 'date', start_date: start, ...(end ? { end_date: end } : {}) }]]]];
  const rows: Record<string, any> = {
    a: { id: 'a', properties: { d: dateOf('2026-03-02', '2026-03-04'), blk: rel('b') } },
    b: { id: 'b', properties: { d: dateOf('2026-03-06', '2026-03-07'), blk: rel('c') } },
    c: { id: 'c', properties: { d: dateOf('2026-03-09') } },
  };
  const getRow = (id: string) => rows[id];
  const datesOf = (id: string) => S.itemDatesOf(rows[id], cfg)!;

  it('consume_gap: shifts only when the blocker now overlaps, cascading', () => {
    const before = datesOf('a');
    const small = S.shiftItemDates(before, 1); // ends 03-05, still before b (03-06)
    expect(S.planDependencyShifts({ changedRowId: 'a', before, after: small, config: cfg, getRow })).toEqual([]);
    const big = S.shiftItemDates(before, 3); // ends 03-07 → b must start 03-08
    const plan = S.planDependencyShifts({ changedRowId: 'a', before, after: big, config: cfg, getRow });
    const b = plan.find((p: any) => p.rowId === 'b')!;
    expect(S.dayString(b.dates.start)).toBe('2026-03-08');
    expect(S.dayString(b.dates.end)).toBe('2026-03-09');
    const c = plan.find((p: any) => p.rowId === 'c')!;
    expect(S.dayString(c.dates.start)).toBe('2026-03-10');
  });

  it('preserve_gap: blocked items follow the blocker’s end in both directions', () => {
    const pg = { ...cfg, mode: 'preserve_gap' as const };
    const before = datesOf('a');
    const plan = S.planDependencyShifts({ changedRowId: 'a', before, after: S.shiftItemDates(before, -2), config: pg, getRow });
    expect(S.dayString(plan.find((p: any) => p.rowId === 'b')!.dates.start)).toBe('2026-03-04');
  });

  it('avoid weekends moves shifted items off Saturday / Sunday', () => {
    const wk = { ...cfg, avoidWeekends: true };
    const before = datesOf('a');
    const plan = S.planDependencyShifts({ changedRowId: 'a', before, after: S.shiftItemDates(before, 3), config: wk, getRow });
    for (const p of plan) {
      expect(S.isWeekendDay(p.dates.start)).toBe(false);
      expect(S.isWeekendDay(p.dates.end)).toBe(false);
    }
  });

  it('"Do not automatically shift" plans nothing', () => {
    const before = datesOf('a');
    expect(S.planDependencyShifts({ changedRowId: 'a', before, after: S.shiftItemDates(before, 5), config: { ...cfg, mode: undefined }, getRow })).toEqual([]);
  });
});

describe('Sprints', () => {
  it('completes the current sprint: Current → Last, Next → Current, a new Next, incomplete tasks move on', () => {
    const tasks: any = { id: 'T', space_id: 's', schema: { title: { name: 'Task', type: 'title' }, st: { name: 'Status', type: 'status', options: [{ id: 'o1', value: 'Not started' }, { id: 'o2', value: 'Done' }], groups: [{ id: 'g1', name: 'To-do', optionIds: ['o1'] }, { id: 'g3', name: 'Complete', optionIds: ['o2'] }] }, sp: { name: 'Sprint', type: 'relation' } }, format: { app_uri_map: { 'litpage://tasks/task_sprint_relation': 'sp', 'litpage://tasks/status_property': 'st' }, sprint_settings: { sprints_collection_id: 'SP' } } };
    const sprints: any = { id: 'SP', schema: { title: { name: 'Sprint name', type: 'title' }, ss: { name: 'Sprint status', type: 'status' }, dt: { name: 'Dates', type: 'date' }, tk: { name: 'Tasks', type: 'relation' } }, format: { app_uri_map: { 'litpage://sprints/sprint_status_property': 'ss', 'litpage://sprints/dates_property': 'dt', 'litpage://sprints/sprint_task_relation': 'tk' } } };
    const info = S.sprintInfoOf(tasks, (id: string) => (id === 'SP' ? sprints : undefined))!;
    expect(info).toBeTruthy();
    const range = (a: string, b: string) => [['‣', [['d', { type: 'daterange', start_date: a, end_date: b }]]]];
    const s1: any = { id: 's1', properties: { title: [['Sprint 1']], ss: [['Current']], dt: range('2026-03-02', '2026-03-15'), tk: rel('t1', 't2') } };
    const s2: any = { id: 's2', properties: { title: [['Sprint 2']], ss: [['Next']], dt: range('2026-03-16', '2026-03-29') } };
    const t1: any = { id: 't1', properties: { st: [['Done']], sp: rel('s1') } };
    const t2: any = { id: 't2', properties: { st: [['Not started']], sp: rel('s1') } };
    let n = 0;
    const plan = S.planSprintCompletion(info, { sprints: [s1, s2], tasks: [t1, t2] }, { incomplete: 'next_sprint', today: '2026-03-15', newId: () => `new${++n}` });
    expect(plan.completedSprintId).toBe('s1');
    expect(plan.newCurrentId).toBe('s2');
    const statusWrites = plan.writes.filter((w: any) => w.propId === 'ss').map((w: any) => [w.rowId, w.value[0][0]]);
    expect(statusWrites).toEqual(expect.arrayContaining([['s1', 'Last'], ['s2', 'Current']]));
    expect(plan.creates).toHaveLength(1);
    expect(plan.creates[0].properties.ss).toEqual([['Next']]);
    const moved = plan.writes.find((w: any) => w.rowId === 't2' && w.propId === 'sp');
    expect(JSON.stringify(moved?.value)).toContain('s2');
    expect(plan.writes.some((w: any) => w.rowId === 't1')).toBe(false);
  });
});

describe('Property limits', () => {
  it('refuses the 501st property and a second verification property', async () => {
    const col = db.getRecord<any>('collection', ids.col)!;
    const many: Record<string, unknown> = { ...col.schema };
    for (let i = Object.keys(many).length; i < 500; i++) many[`p${i}`] = { name: `P${i}`, type: 'text' };
    db.putRecord('collection', { ...col, schema: many, version: col.version + 1 });
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'over'], { name: 'Over', type: 'text' })]))).toBe(403);
    db.putRecord('collection', { ...db.getRecord<any>('collection', ids.col)!, schema: col.schema, version: col.version + 2 });
    tx(ids.alice, [setOp('collection', ids.col, ['schema', 'v1'], { name: 'Verification', type: 'verification' })]);
    expect(await status(() => tx(ids.alice, [setOp('collection', ids.col, ['schema', 'v2'], { name: 'Verification 2', type: 'verification' })]))).toBe(403);
  });
});

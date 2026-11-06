// AI Agent tools never reveal more than the person can open in Litpage.
// - read_comments lists the threads of the page itself: not a sub-page's (a restricted
// sub-page's comments leaked through its parent) and not a foreign block someone listed in the page's content
// - a database reached through a linked view is the person's view of the source: no access → not found (name, schema,
// "No access" properties and select options used to leak); write tools too
// - update_page matches property names against the redacted schema: errors don't list "No access" properties and
// their values can't be set by name
// - view_version_history needs Can edit and shows the redacted version
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-tools-test-'));
process.env.NC_SCHEDULER = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

let db: typeof import('../src/db.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let history: typeof import('../src/history.ts');
let newId: () => string;

const ids = {} as Record<string, string>;

function env(userId: string) {
  return {
    userId, spaceId: ids.space, threadId: null, turnId: `t-${Math.random().toString(36).slice(2)}`, currentPageId: null,
    approvalMode: 'skip_all', memories: false, cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept',
  } as any;
}

const run = (userId: string, name: string, input: Record<string, unknown>) => registry.runTool(env(userId), name, input, `s-${Math.random().toString(36).slice(2)}`);

function put(table: string, rec: Record<string, unknown>) {
  const now = Date.now();
  db.putRecord(table as any, { version: 1, space_id: ids.space, alive: true, created_time: now, created_by_id: ids.alice, last_edited_time: now, ...rec } as any);
}

function block(rec: Record<string, unknown>) {
  put('block', rec);
}

function thread(parentId: string, text: string, type = 'default') {
  const did = newId();
  const cid = newId();
  put('discussion', { id: did, parent_id: parentId, parent_table: 'block', resolved: false, comments: [cid], type });
  put('comment', { id: cid, parent_id: did, parent_table: 'discussion', text: [[text]], created_by_id: ids.alice });
  const b = db.getRecord<any>('block', parentId);
  db.putRecord('block', { ...b, discussions: [...(b.discussions ?? []), did] });
  return did;
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  db = await import('../src/db.ts');
  registry = await import('../src/ai/tools/registry.ts');
  history = await import('../src/history.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'bob', 'cara', 'dan']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@aisec-tools.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Sec');
  ids.space = w.space.id;
  for (const n of ['bob', 'cara', 'dan']) seed.addMember(ids.space, ids[n], 'member');

  // P: a shared page (everyone can edit) with a text block (+ a comment), a restricted sub-page S (+ a page comment) and
  // a foreign block of Alice's private page Q listed in P's content
  ids.p = newId();
  ids.text = newId();
  ids.sub = newId();
  ids.q = newId();
  ids.qtext = newId();
  ids.linked = newId();
  ids.lview = newId();
  block({ id: ids.p, type: 'page', parent_id: ids.space, parent_table: 'space', properties: { title: [['Project hub']] }, content: [ids.text, ids.sub, ids.qtext, ids.linked], permissions: [{ type: 'space_permission', role: 'editor' }] });
  block({ id: ids.text, type: 'text', parent_id: ids.p, parent_table: 'block', properties: { title: [['Kickoff notes']] } });
  block({ id: ids.sub, type: 'page', parent_id: ids.p, parent_table: 'block', properties: { title: [['Salaries']] }, permissions_unlinked: true, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }] });
  block({ id: ids.q, type: 'page', parent_id: ids.space, parent_table: 'space', properties: { title: [['Alice private']] }, content: [ids.qtext], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }] });
  block({ id: ids.qtext, type: 'text', parent_id: ids.q, parent_table: 'block', properties: { title: [['Private line']] } });
  thread(ids.text, 'visible-otter comment');
  thread(ids.sub, 'sub-secret-heron comment', 'page');
  thread(ids.qtext, 'foreign-lynx comment');

  // Payroll: Alice's private database (a "No access" property and a select with options); P shows it as a linked view
  ids.payroll = newId();
  ids.pcol = newId();
  ids.pview = newId();
  block({ id: ids.payroll, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', collection_id: ids.pcol, view_ids: [ids.pview], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }] });
  put('collection', {
    id: ids.pcol, parent_id: ids.payroll, parent_table: 'block', name: [['Payroll-ibex']],
    schema: {
      title: { name: 'Employee', type: 'title' },
      stage: { name: 'Secret-stage-kudu', type: 'select', options: [{ id: 'o1', value: 'Confidential-option-gnu', color: 'red' }] },
      sal: { name: 'Salary-yak', type: 'text', property_permissions: { default_access: 'none', overrides: [] } },
    },
  });
  put('collection_view', { id: ids.pview, type: 'table', parent_id: ids.payroll, parent_table: 'block', format: {}, page_sort: [] });
  block({ id: ids.linked, type: 'collection_view', parent_id: ids.p, parent_table: 'block', collection_id: ids.pcol, view_ids: [ids.lview] });
  put('collection_view', { id: ids.lview, type: 'table', parent_id: ids.linked, parent_table: 'block', format: {}, page_sort: [] });

  // Team DB: Bob can edit its rows; "Comp-yak" is a No access property for him
  ids.tdb = newId();
  ids.tcol = newId();
  ids.tview = newId();
  ids.trow = newId();
  block({ id: ids.tdb, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', collection_id: ids.tcol, view_ids: [ids.tview], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'read_and_write', user_id: ids.bob }] });
  put('collection', {
    id: ids.tcol, parent_id: ids.tdb, parent_table: 'block', name: [['Team']],
    schema: {
      title: { name: 'Name', type: 'title' },
      role: { name: 'Role', type: 'text' },
      comp: { name: 'Comp-yak', type: 'text', property_permissions: { default_access: 'none', overrides: [] } },
    },
  });
  put('collection_view', { id: ids.tview, type: 'table', parent_id: ids.tdb, parent_table: 'block', format: {}, page_sort: [] });
  block({ id: ids.trow, type: 'page', parent_id: ids.tcol, parent_table: 'collection', properties: { title: [['Ada']], role: [['Engineer']], comp: [['100k']] } });
});

describe('read_comments (item 1)', () => {
  it('lists the page’s own threads only', async () => {
    const asBob = await run(ids.bob, 'read_comments', { page_id: ids.p });
    expect(asBob.isError).toBeFalsy();
    expect(asBob.content).toContain('visible-otter');
    expect(asBob.content).not.toContain('sub-secret-heron');
    expect(asBob.content).not.toContain('foreign-lynx');
    // even with access, a sub-page’s and a foreign page’s threads aren’t the parent’s (like the comment list)
    const asAlice = await run(ids.alice, 'read_comments', { page_id: ids.p });
    expect(asAlice.content).toContain('visible-otter');
    expect(asAlice.content).not.toContain('sub-secret-heron');
    expect(asAlice.content).not.toContain('foreign-lynx');
    expect((await run(ids.alice, 'read_comments', { page_id: ids.sub })).content).toContain('sub-secret-heron');
    expect((await run(ids.bob, 'read_comments', { page_id: ids.sub })).isError).toBe(true);
  });
});

describe('linked views of a database the person can’t open (item 2)', () => {
  it('query_database is not found and names nothing of the source', async () => {
    const r = await run(ids.bob, 'query_database', { database_id: ids.linked });
    expect(r.isError).toBe(true);
    for (const leak of ['Payroll-ibex', 'Secret-stage-kudu', 'Confidential-option-gnu', 'Salary-yak', 'Employee']) expect(r.content).not.toContain(leak);
    const bySource = await run(ids.bob, 'query_database', { database_id: ids.pcol });
    expect(bySource.isError).toBe(true);
    expect(bySource.content).not.toContain('Payroll-ibex');
    // the owner still reads it through the linked view
    const asAlice = await run(ids.alice, 'query_database', { database_id: ids.linked });
    expect(asAlice.isError).toBeFalsy();
    expect(asAlice.content).toContain('Secret-stage-kudu');
  });

  it('write tools refuse it as not found too', async () => {
    const add = await run(ids.bob, 'create_pages', { parent: { type: 'database', id: ids.linked }, pages: [{ title: 'Intruder' }] });
    expect(add.isError).toBe(true);
    expect(add.content).not.toContain('Payroll-ibex');
    const upd = await run(ids.bob, 'update_database', { database_id: ids.linked, add_properties: [{ name: 'Hack', type: 'text' }] });
    expect(upd.isError).toBe(true);
    expect(upd.content).not.toContain('Payroll-ibex');
    expect(Object.values(db.getRecord<any>('collection', ids.pcol).schema).map((p: any) => p.name)).not.toContain('Hack');
  });
});

describe('update_page property names (item 3)', () => {
  it('errors list only the properties the person can see', async () => {
    const r = await run(ids.bob, 'update_page', { page_id: ids.trow, command: 'update_properties', properties: { Bogus: 'x' } });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Unknown property “Bogus”/);
    expect(r.content).toContain('Role');
    expect(r.content).not.toContain('Comp-yak');
  });

  it('a "No access" property can’t be set by name', async () => {
    const r = await run(ids.bob, 'update_page', { page_id: ids.trow, command: 'update_properties', properties: { 'Comp-yak': '1' } });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/Unknown property “Comp-yak”/);
    expect(r.content).not.toMatch(/Properties:.*Comp-yak/);
    expect(db.getRecord<any>('block', ids.trow).properties.comp).toEqual([['100k']]);
    // a visible property still works, and the owner sees every property in the list
    expect((await run(ids.bob, 'update_page', { page_id: ids.trow, command: 'update_properties', properties: { Role: 'Lead' } })).isError).toBeFalsy();
    expect(db.getRecord<any>('block', ids.trow).properties.role).toEqual([['Lead']]);
    const owner = await run(ids.alice, 'update_page', { page_id: ids.trow, command: 'update_properties', properties: { Bogus: 'x' } });
    expect(owner.content).toContain('Comp-yak');
  });
});

describe('view_version_history (item 20)', () => {
  it('needs Can edit, like the app', async () => {
    ids.vpage = newId();
    block({
      id: ids.vpage, type: 'page', parent_id: ids.space, parent_table: 'space', properties: { title: [['Versioned']] }, content: [],
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'reader', user_id: ids.bob }, { type: 'user_permission', role: 'comment_only', user_id: ids.cara }, { type: 'user_permission', role: 'read_and_write', user_id: ids.dan }],
    });
    ids.vtext = newId();
    block({ id: ids.vtext, type: 'text', parent_id: ids.vpage, parent_table: 'block', properties: { title: [['Deleted-text-tapir']] } });
    db.putRecord('block', { ...db.getRecord<any>('block', ids.vpage), content: [ids.vtext] });
    history.takeSnapshot(ids.vpage, [ids.alice], Date.now() - 60_000);
    db.putRecord('block', { ...db.getRecord<any>('block', ids.vtext), alive: false });
    db.putRecord('block', { ...db.getRecord<any>('block', ids.vpage), content: [] });
    const [snap] = history.listSnapshots(ids.vpage, 1);
    for (const who of [ids.bob, ids.cara]) {
      const list = await run(who, 'view_version_history', { page_id: ids.vpage });
      expect(list.isError).toBe(true);
      expect(list.content).not.toContain(snap.id);
      const one = await run(who, 'view_version_history', { page_id: ids.vpage, version_id: snap.id });
      expect(one.isError).toBe(true);
      expect(one.content).not.toContain('Deleted-text-tapir');
    }
    const asDan = await run(ids.dan, 'view_version_history', { page_id: ids.vpage, version_id: snap.id });
    expect(asDan.isError).toBeFalsy();
    expect(asDan.content).toContain('Deleted-text-tapir');
  });

  it('shows a database row’s old values only for properties the person may see', async () => {
    history.takeSnapshot(ids.trow, [ids.alice], Date.now() - 30_000);
    const [snap] = history.listSnapshots(ids.trow, 1);
    const asBob = await run(ids.bob, 'view_version_history', { page_id: ids.trow, version_id: snap.id });
    expect(asBob.isError).toBeFalsy();
    expect(asBob.content).not.toContain('100k');
  });
});

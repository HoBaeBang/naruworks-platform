// Search and export follow database privacy like record maps do: values of properties a person
// can't see (property access: "No access", "Can view property only") neither match a search nor show as
// snippets, and are missing from every export format (CSV columns/cells, HTML, PDF print view, formulas over them,
// comments on those values); rows hidden by row access ("Can only create" + page-level rules) never appear in search
// results or exports. Also covers the Quick Find query syntax (words in any order, "quoted" = exact phrase).
// Handlers are called directly against a temporary SQLite workspace (same harness as page-features.test.ts).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-search-export-test-'));
process.env.NC_SCHEDULER = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let files: typeof import('../src/content/files.ts');
let zip: typeof import('../src/content/zip.ts');
let search: typeof import('../src/search.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

function tx(user: string, operations: any[]) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
}

const ptr = (table: string, id: string) => ({ table, id, spaceId: ids.space });
const setOp = (table: string, id: string, path: string[], args: unknown) => ({ pointer: ptr(table, id), path, command: 'set', args });
const person = (userId: string) => [['‣', [['u', userId]]]];

function newRow(user: string, title: string, extra: Record<string, unknown> = {}) {
  const id = newId();
  const now = Date.now();
  tx(user, [setOp('block', id, [], {
    id, type: 'page', parent_id: ids.col, parent_table: 'collection', alive: true, space_id: ids.space,
    properties: { title: [[title]], ...extra }, created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user,
  })]);
  return id;
}

async function titles(user: string, query: string, filters: Record<string, unknown> = {}) {
  const r = await call(user, 'searchWorkspace', { query, spaceId: ids.space, limit: 50, filters, source: 'quick_find' });
  return r.results.map((x: any) => (r.recordMap.block?.[x.id]?.value?.value?.properties?.title ?? []).map((t: any[]) => t[0]).join(''));
}

async function snippets(user: string, query: string): Promise<string> {
  const r = await call(user, 'searchWorkspace', { query, spaceId: ids.space, limit: 50 });
  return r.results.map((x: any) => x.highlight?.text ?? '').join(' | ');
}

function readExport(url: string, user: string): Buffer {
  const f = files.readStoredFile(url, user);
  if (!f) throw new Error('export file missing');
  return f.data;
}

/** Every text file of an export (a single file or a zip). */
async function exportText(user: string, body: Record<string, unknown>): Promise<string> {
  const r = await call(user, 'startPageExport', body);
  const buf = readExport(r.url ?? r.printUrl, user);
  if (buf.subarray(0, 2).toString('latin1') === 'PK') return zip.readZip(buf).map((e) => `### ${e.name}\n${e.data.toString('utf8')}`).join('\n');
  return buf.toString('utf8');
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  files = await import('../src/content/files.ts');
  zip = await import('../src/content/zip.ts');
  search = await import('../src/search.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'carl', 'dina']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@sx.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.private = w.spaceView.private_pages[0];
  seed.addMember(ids.space, ids.carl, 'member');
  seed.addMember(ids.space, ids.dina, 'member');

  // full-page database in Alice's private page: Name, Notes, Salary ("No access"), Code ("Can view property only"),
  // Owner (person, page-level rule), Doubled (formula over Salary)
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
    id: ids.col, version: 1, name: [['Payroll']], parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true,
    schema: {
      title: { name: 'Name', type: 'title' },
      notes: { name: 'Notes', type: 'text' },
      sal: { name: 'Salary', type: 'text' },
      code: { name: 'Code', type: 'text' },
      own: { name: 'Owner', type: 'person' },
      dbl: { name: 'Echo', type: 'formula', formula: { expression: 'prop("Salary")' } },
    },
  } as any);
  db.putRecord('collection_view', { id: ids.view, version: 1, type: 'table', parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);

  ids.r1 = newRow(ids.alice, 'Alpha', { notes: [['apple pie']], sal: [['secret-salary-123']], code: [['hidden-code-456']] });
  ids.r2 = newRow(ids.alice, 'Banana', { notes: [['pie with apple']], sal: [['other-salary-789']], own: person(ids.dina) });
  // Carl can edit the database; Dina can only create pages and sees rows through the Owner rule
  tx(ids.alice, [setOp('block', ids.db, ['permissions'], [
    { type: 'user_permission', user_id: ids.alice, role: 'editor' },
    { type: 'user_permission', user_id: ids.carl, role: 'read_and_write' },
    { type: 'user_permission', user_id: ids.dina, role: 'none', can_create_pages_in_collection: true },
  ])]);
  tx(ids.alice, [setOp('collection', ids.col, ['permission_rules'], [{ id: 'r-own', property: 'own', role: 'reader' }])]);
  tx(ids.alice, [setOp('collection', ids.col, ['schema', 'sal', 'property_permissions'], { default_access: 'none', overrides: [] })]);
  tx(ids.alice, [setOp('collection', ids.col, ['schema', 'code', 'property_permissions'], { default_access: 'schema_only', overrides: [] })]);
  // a comment thread on Alpha's Salary value (property discussion)
  ids.disc = newId();
  ids.comment = newId();
  db.putRecord('discussion', { id: ids.disc, version: 1, parent_id: ids.r1, parent_table: 'block', resolved: false, property_id: 'sal', context: [['Salary']], comments: [ids.comment], space_id: ids.space, alive: true } as any);
  db.putRecord('comment', { id: ids.comment, version: 1, parent_id: ids.disc, parent_table: 'discussion', text: [['raise-to-999']], created_by_id: ids.alice, created_time: now, space_id: ids.space, alive: true } as any);
  db.putRecord('block', { ...db.getRecord<any>('block', ids.r1)!, discussions: [ids.disc] });
});

describe('search follows property access', () => {
  it('people with access find rows by any value, others not by hidden values', async () => {
    expect(await titles(ids.alice, 'secret-salary')).toEqual(['Alpha']);
    expect(await titles(ids.carl, 'secret-salary')).toEqual([]);
    // "Can view property only": the column is there, its values are not
    expect(await titles(ids.alice, 'hidden-code')).toEqual(['Alpha']);
    expect(await titles(ids.carl, 'hidden-code')).toEqual([]);
    // unrestricted values still match
    expect(await titles(ids.carl, 'apple pie')).toContain('Alpha');
  });

  it('snippets never carry a hidden value', async () => {
    expect(await snippets(ids.carl, 'Alpha')).not.toMatch(/secret|hidden-code/);
    expect(await snippets(ids.carl, 'apple')).not.toMatch(/secret|hidden-code/);
    expect(await snippets(ids.alice, 'secret-salary')).toContain('secret-salary-123');
  });

  it('a hidden value can not complete a multi-word query either', async () => {
    expect(await titles(ids.alice, 'apple secret-salary')).toEqual(['Alpha']);
    expect(await titles(ids.carl, 'apple secret-salary')).toEqual([]);
  });

  it('rows hidden by row access never show up', async () => {
    expect(await titles(ids.dina, 'Alpha')).toEqual([]);
    expect(await titles(ids.dina, 'apple')).toEqual(['Banana']);
    expect(await titles(ids.dina, 'Banana')).toEqual(['Banana']);
    // Dina sees Banana's row but not its Salary
    expect(await titles(ids.dina, 'other-salary')).toEqual([]);
  });

  it('searchText applies the rule for any caller (signed out / no viewer = unrestricted values only)', () => {
    const hits = (viewer?: { userId: string | null }) => search.searchText(ids.space, 'secret-salary', 50, viewer).length;
    expect(hits({ userId: ids.alice })).toBeGreaterThan(0);
    expect(hits({ userId: ids.carl })).toBe(0);
    expect(hits({ userId: null })).toBe(0);
    expect(hits()).toBe(0);
    expect(search.searchText(ids.space, 'apple pie', 50).length).toBeGreaterThan(0);
  });

  it('"Title only" no longer matches database property values', async () => {
    expect(await titles(ids.alice, 'apple', { titleOnly: true })).toEqual([]);
    expect(await titles(ids.alice, 'Alpha', { titleOnly: true })).toEqual(['Alpha']);
  });
});

describe('Quick Find query syntax', () => {
  it('words match in any order; "quoted text" matches exactly', async () => {
    const both = await titles(ids.alice, 'apple pie');
    expect(both.sort()).toEqual(['Alpha', 'Banana']);
    expect(await titles(ids.alice, '"apple pie"')).toEqual(['Alpha']);
    expect(await titles(ids.alice, '“pie with apple”')).toEqual(['Banana']);
    expect(await titles(ids.alice, '"apple pie" banana')).toEqual([]);
    expect(search.searchTerms('foo "bar baz" qux')).toEqual(['foo', 'bar baz', 'qux']);
    expect(search.searchTerms('"unterminated phrase')).toEqual(['unterminated phrase']);
  });
});

describe('exports follow property and row access', () => {
  it('CSV: "No access" columns are gone, "Can view property only" values are empty, formulas see no hidden input', async () => {
    const csv = (await exportText(ids.carl, { blockId: ids.db, format: 'markdown', databaseView: 'default' })).replace(/^﻿/, '');
    const header = csv.split(/\r?\n/)[0].split(',');
    expect(header).toContain('Notes');
    expect(header).toContain('Code');
    expect(header).not.toContain('Salary');
    expect(csv).not.toMatch(/secret-salary|other-salary|hidden-code/);
    const full = await exportText(ids.alice, { blockId: ids.db, format: 'markdown', databaseView: 'default' });
    expect(full).toContain('secret-salary-123');
    expect(full).toContain('hidden-code-456');
  });

  it('HTML (with comments) and the PDF print view leave hidden values and their comment threads out', async () => {
    const html = await exportText(ids.carl, { blockId: ids.db, format: 'html', includeSubpages: true, includeComments: true, databaseView: 'default' });
    expect(html).toContain('Alpha');
    expect(html).not.toMatch(/secret-salary|other-salary|hidden-code|raise-to-999/);
    const alice = await exportText(ids.alice, { blockId: ids.db, format: 'html', includeSubpages: true, includeComments: true, databaseView: 'default' });
    expect(alice).toContain('raise-to-999');
    const pdf = await exportText(ids.carl, { blockId: ids.db, format: 'pdf', databaseView: 'default' });
    expect(pdf).toContain('Alpha');
    expect(pdf).not.toMatch(/secret-salary|hidden-code/);
  });

  it('rows hidden by row access are missing from CSV, HTML and the exported row pages', async () => {
    const csv = await exportText(ids.dina, { blockId: ids.db, format: 'markdown', includeSubpages: true, databaseView: 'default' });
    expect(csv).toContain('Banana');
    expect(csv).not.toContain('Alpha');
    expect(csv).not.toMatch(/other-salary/);
    const html = await exportText(ids.dina, { blockId: ids.db, format: 'html', includeSubpages: true, databaseView: 'default' });
    expect(html).toContain('Banana');
    expect(html).not.toContain('Alpha');
  });
});

describe('group mentions in search and exports', () => {
  it('index as "@<group name>" and export as "@<group name>"', async () => {
    const { group } = await call(ids.alice, 'createGroup', { spaceId: ids.space, name: 'Studio Crew', memberIds: [ids.alice] });
    const pageId = newId();
    const textId = newId();
    tx(ids.alice, [
      setOp('block', pageId, [], { id: pageId, type: 'page', parent_id: ids.private, parent_table: 'block', alive: true, space_id: ids.space, properties: { title: [['Crew notes']] }, content: [] }),
      { pointer: ptr('block', ids.private), path: ['content'], command: 'listAfter', args: { id: pageId } },
      setOp('block', textId, [], { id: textId, type: 'text', parent_id: pageId, parent_table: 'block', alive: true, space_id: ids.space, properties: { title: [['Ping '], ['‣', [['g', group.id, ids.space]]], [' for review']] } }),
      { pointer: ptr('block', pageId), path: ['content'], command: 'listAfter', args: { id: textId } },
    ]);
    expect(await titles(ids.alice, 'Studio Crew')).toContain('Crew notes');
    expect(await snippets(ids.alice, 'Studio Crew')).toContain('@Studio Crew');
    const md = await exportText(ids.alice, { blockId: pageId, format: 'markdown' });
    expect(md).toContain('Ping @Studio Crew for review');
    const html = await exportText(ids.alice, { blockId: pageId, format: 'html' });
    expect(html).toContain('@Studio Crew');
    // database text values (CSV cells) read the same way
    tx(ids.alice, [setOp('block', ids.r2, ['properties', 'notes'], [['Owner: '], ['‣', [['g', group.id, ids.space]]]])]);
    const csv = await exportText(ids.alice, { blockId: ids.db, format: 'markdown', databaseView: 'default' });
    expect(csv).toContain('Owner: @Studio Crew');
  });
});

describe('database API reads follow row and property access (queryRows, view CSV)', () => {
  const query = (user: string, body: Record<string, unknown> = {}) => call(user, 'queryRows', { collectionId: ids.col, viewId: ids.view, ...body });
  const viewCsv = (user: string) => call(user, 'exportCollectionViewCsv', { collectionId: ids.col, viewId: ids.view, allProperties: true });

  it('queryRows searches only values the caller can see', async () => {
    expect((await query(ids.alice, { search: 'secret-salary' })).result.blockIds).toEqual([ids.r1]);
    expect((await query(ids.carl, { search: 'secret-salary' })).result.blockIds).toEqual([]);
    expect((await query(ids.carl, { search: 'hidden-code' })).result.blockIds).toEqual([]);
    expect((await query(ids.carl)).result.blockIds).toEqual(expect.arrayContaining([ids.r1, ids.r2]));
  });

  it('queryRows never returns rows hidden by row access, nor counts them', async () => {
    const r = await query(ids.dina).catch((e: any) => ({ status: e.status }));
    if ('status' in r) expect(r.status).toBe(404);
    else {
      expect(r.result.blockIds).toEqual([ids.r2]);
      expect(r.result.total).toBe(1);
      expect(JSON.stringify(r.recordMap)).not.toMatch(/secret-salary|other-salary|hidden-code/);
    }
  });

  it('the view CSV drops "No access" columns, hidden values and hidden rows', async () => {
    expect((await viewCsv(ids.alice)).csv).toContain('secret-salary-123');
    const carl = (await viewCsv(ids.carl)).csv;
    expect(carl.split('\n')[0]).not.toContain('Salary');
    expect(carl).not.toMatch(/secret-salary|other-salary|hidden-code/);
    expect(carl).toContain('Alpha');
    const dina = await viewCsv(ids.dina).catch((e: any) => ({ csv: '', status: e.status }));
    expect(dina.csv).not.toContain('Alpha');
    expect(dina.csv).not.toMatch(/secret-salary|other-salary/);
  });
});

// AI read paths apply the same database privacy rules as record maps (property access, page-level access rules):
// property values a principal can't see (and "No access" properties) never reach the model — not through
// query_database (formulas included), read_page of a row, inline database tables, search hits / snippets,
// comments on property values, version history, the autofill context or the formula assistant — and rows hidden
// by row access ("Can only create" + page-level rules) stay hidden. The same holds for a Custom Agent's bot.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-visibility-test-'));
process.env.NC_SCHEDULER = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

let db: typeof import('../src/db.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let context: typeof import('../src/ai/context.ts');
let agents: typeof import('../src/agents/model.ts');
let newId: () => string;
let indexBlock: (b: any) => void;

const ids = {} as Record<string, string>;

function env(userId: string) {
  return {
    userId, spaceId: ids.space, threadId: null, turnId: `t-${Math.random().toString(36).slice(2)}`, currentPageId: null,
    approvalMode: 'skip_all', memories: false, cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept',
  } as any;
}

const run = (userId: string, name: string, input: Record<string, unknown>) => registry.runTool(env(userId), name, input, `s-${Math.random().toString(36).slice(2)}`);

function putRow(col: string, title: string, props: Record<string, unknown>, by = ids.alice) {
  const id = newId();
  const now = Date.now();
  const rec = { id, version: 1, type: 'page', parent_id: col, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [[title]], ...props }, created_time: now, created_by_id: by, last_edited_time: now, last_edited_by_id: by } as any;
  db.putRecord('block', rec);
  indexBlock(rec);
  return id;
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  db = await import('../src/db.ts');
  registry = await import('../src/ai/tools/registry.ts');
  context = await import('../src/ai/context.ts');
  agents = await import('../src/agents/model.ts');
  await import('../src/agents/access.ts');
  indexBlock = (await import('../src/search.ts')).indexBlock as any;
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'bob', 'cara']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@vis.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Vis');
  ids.space = w.space.id;
  seed.addMember(ids.space, ids.bob, 'member');
  seed.addMember(ids.space, ids.cara, 'member');
  db.putRecord('space', { ...db.getRecord<any>('space', ids.space), plan_type: 'business' });
  const now = Date.now();
  // People DB (top-level, shared with Bob as Can view): Salary = No access, Notes = Can view property only
  ids.db = newId();
  ids.col = newId();
  ids.view = newId();
  db.putRecord('block', {
    id: ids.db, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: ids.col, view_ids: [ids.view],
    permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'reader', user_id: ids.bob }],
    created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
  db.putRecord('collection', {
    id: ids.col, version: 1, parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, name: [['People']],
    schema: {
      title: { name: 'Name', type: 'title' },
      sal: { name: 'Salary', type: 'text', property_permissions: { default_access: 'none', overrides: [] } },
      notes: { name: 'Notes', type: 'text', property_permissions: { default_access: 'schema_only', overrides: [] } },
      team: { name: 'Team', type: 'text' },
      dbl: { name: 'Doubled', type: 'formula', formula: { expression: 'prop("Salary")' } },
    },
  } as any);
  db.putRecord('collection_view', { id: ids.view, version: 1, type: 'table', parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
  ids.row = putRow(ids.col, 'Ada', { sal: [['zebra-salary-981']], notes: [['quokka-secret-note']], team: [['Platform']] });
  // a comment thread on the Salary value of that row
  ids.disc = newId();
  ids.comment = newId();
  db.putRecord('discussion', { id: ids.disc, version: 1, parent_id: ids.row, parent_table: 'block', property_id: 'sal', resolved: false, comments: [ids.comment], space_id: ids.space, alive: true, created_by_id: ids.alice } as any);
  db.putRecord('comment', { id: ids.comment, version: 1, parent_id: ids.disc, parent_table: 'discussion', text: [['Raise approved: walrus-raise']], created_by_id: ids.alice, created_time: now, last_edited_time: now, alive: true, space_id: ids.space } as any);
  db.putRecord('block', { ...db.getRecord<any>('block', ids.row), discussions: [ids.disc] });

  // Tasks DB shared with Cara as "Can only create": a page-level rule shows her the rows she is assigned to
  ids.db2 = newId();
  ids.col2 = newId();
  ids.view2 = newId();
  db.putRecord('block', {
    id: ids.db2, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: ids.col2, view_ids: [ids.view2],
    permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'none', user_id: ids.cara, can_create_pages_in_collection: true }],
    created_time: now, created_by_id: ids.alice, last_edited_time: now,
  } as any);
  db.putRecord('collection', {
    id: ids.col2, version: 1, parent_id: ids.db2, parent_table: 'block', space_id: ids.space, alive: true, name: [['Tasks']],
    schema: { title: { name: 'Task', type: 'title' }, who: { name: 'Assignee', type: 'person' } },
    permission_rules: [{ id: 'r1', property: 'who', role: 'reader' }],
  } as any);
  db.putRecord('collection_view', { id: ids.view2, version: 1, type: 'table', parent_id: ids.db2, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
  ids.mine = putRow(ids.col2, 'Cara task', { who: [['‣', [['u', ids.cara]]]] });
  ids.other = putRow(ids.col2, 'Hidden pelican task', { who: [['‣', [['u', ids.alice]]]] });
});

describe('property access in AI reads', () => {
  it('query_database: no hidden values, no "No access" property, formulas computed without them', async () => {
    const asBob = await run(ids.bob, 'query_database', { database_id: ids.db });
    expect(asBob.isError).toBeFalsy();
    expect(asBob.content).toContain('Ada');
    expect(asBob.content).toContain('Platform');
    expect(asBob.content).not.toContain('zebra-salary-981');
    expect(asBob.content).not.toContain('quokka-secret-note');
    expect(asBob.content).not.toMatch(/Salary/);
    // full access still sees everything
    const asAlice = await run(ids.alice, 'query_database', { database_id: ids.db });
    expect(asAlice.content).toContain('zebra-salary-981');
    expect(asAlice.content).toContain('quokka-secret-note');
  });

  it('filters can’t probe a hidden property', async () => {
    const r = await run(ids.bob, 'query_database', { database_id: ids.db, filters: [{ property: 'Salary', operator: 'contains', value: 'zebra' }] });
    expect(r.isError).toBe(true);
    expect(r.content).not.toMatch(/Salary \(/);
  });

  it('read_page of a row and the database page table hide the values', async () => {
    const rowAsBob = await run(ids.bob, 'read_page', { page_id: ids.row });
    expect(rowAsBob.isError).toBeFalsy();
    expect(rowAsBob.content).toContain('Ada');
    expect(rowAsBob.content).not.toContain('zebra-salary-981');
    expect(rowAsBob.content).not.toContain('quokka-secret-note');
    const dbAsBob = context.readPage(ids.db, ids.bob)!;
    expect(dbAsBob.markdown).toContain('Ada');
    expect(dbAsBob.markdown).not.toContain('zebra-salary-981');
    expect(dbAsBob.markdown).not.toContain('Salary');
    expect(context.readPage(ids.db, ids.alice)!.markdown).toContain('zebra-salary-981');
  });

  it('search_workspace finds nothing through a hidden value and shows no hidden snippet', async () => {
    const hit = await run(ids.bob, 'search_workspace', { query: 'zebra-salary-981' });
    expect(hit.content).toMatch(/^No pages matched/);
    expect(hit.content).not.toContain('Ada');
    expect(context.searchPages(ids.space, ids.alice, 'zebra-salary-981', 5).length).toBeGreaterThan(0);
    const byTitle = context.searchPages(ids.space, ids.bob, 'Ada', 5);
    expect(byTitle.some((r) => r.pageId === ids.row)).toBe(true);
    expect(byTitle.map((r) => r.snippet).join(' ')).not.toContain('zebra');
  });

  it('comments on a hidden property value stay out of read_comments', async () => {
    const asBob = await run(ids.bob, 'read_comments', { page_id: ids.row });
    expect(asBob.content).not.toContain('walrus-raise');
    const asAlice = await run(ids.alice, 'read_comments', { page_id: ids.row });
    expect(asAlice.content).toContain('walrus-raise');
  });

  it('the autofill context only holds what the person filling may read', () => {
    const r = context.rowForAutofill(ids.row, ids.bob)!;
    expect(r).toBeTruthy();
    expect(JSON.stringify(r.row.properties)).not.toContain('zebra');
    expect(Object.keys(r.col.schema)).not.toContain('sal');
    expect(JSON.stringify(context.rowForAutofill(ids.row, ids.alice)!.row.properties)).toContain('zebra');
  });
});

describe('row access in AI reads (page-level rules, Can only create)', () => {
  it('query_database lists only the rows the person can open', async () => {
    const asCara = await run(ids.cara, 'query_database', { database_id: ids.db2 });
    expect(asCara.isError).toBeFalsy();
    expect(asCara.content).toContain('Cara task');
    expect(asCara.content).not.toContain('Hidden pelican task');
    expect(asCara.content).toMatch(/1 matching row/);
    const page = context.readPage(ids.db2, ids.cara)!;
    expect(page.markdown).not.toContain('Hidden pelican task');
    expect((await run(ids.cara, 'read_page', { page_id: ids.other })).isError).toBe(true);
    const found = await run(ids.cara, 'search_workspace', { query: 'pelican' });
    expect(found.content).not.toContain('Hidden pelican task');
  });
});

describe('a Custom Agent reads with its own access', () => {
  it('a granted agent without Full access gets the redacted view', async () => {
    const a = agents.createAgent({ spaceId: ids.space, userId: ids.alice, config: { name: 'HR bot', grants: [{ block_id: ids.db, role: 'reader' }] } as any, published: true });
    const r = await run(a.bot_id, 'query_database', { database_id: ids.db });
    expect(r.isError).toBeFalsy();
    expect(r.content).toContain('Ada');
    expect(r.content).not.toContain('zebra-salary-981');
    expect(r.content).not.toContain('quokka-secret-note');
    const comments = await run(a.bot_id, 'read_comments', { page_id: ids.row });
    expect(comments.content).not.toContain('walrus-raise');
  });
});

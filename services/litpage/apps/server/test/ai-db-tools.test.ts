// AI service database tools: an attached CSV becomes a database (import_csv), and the agent adds charts,
// forms and dashboards — the same view records the database UI reads
// (format.chart_config / form_config / dashboard_layout).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-db-tools-test-'));

let db: typeof import('../src/db.ts');
let registry: typeof import('../src/ai/tools/registry.ts');
let threads: typeof import('../src/ai/threads.ts');
let files: typeof import('../src/content/files.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let A = '';
let B = '';
let spaceId = '';

const env = (userId: string, threadId: string | null = null) => ({
  userId, spaceId, threadId, turnId: `t-${Math.random().toString(36).slice(2)}`, currentPageId: null, approvalMode: 'skip_all', memories: true,
  cite: () => 1, step: () => {}, touched: () => {}, approve: async () => 'accept',
}) as any;
const tool = (e: any, name: string, input: Record<string, unknown>) => registry.runTool(e, name, input, `s-${Math.random().toString(36).slice(2)}`);
const views = (blockId: string) => (db.getRecord<any>('block', blockId).view_ids ?? []).map((id: string) => db.getRecord<any>('collection_view', id));

beforeAll(async () => {
  const { newId } = await import('@nc/shared/ids.ts');
  const seed = await import('../src/seed.ts');
  db = await import('../src/db.ts');
  registry = await import('../src/ai/tools/registry.ts');
  threads = await import('../src/ai/threads.ts');
  files = await import('../src/content/files.ts');
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  await import('../src/api/modules/ai.ts');
  A = newId();
  B = newId();
  seed.createUser(A, 'a@dbtools.dev', 'Ann');
  seed.createUser(B, 'b@dbtools.dev', 'Ben');
  spaceId = seed.createWorkspace(A, 'DB Tools').space.id;
  seed.addMember(spaceId, B, 'member');
});

describe('import_csv', () => {
  it('turns the attached CSV into a database with typed properties and every row', async () => {
    const csv = ['Name,Amount,Due,Stage,Done', ...Array.from({ length: 150 }, (_, i) => `Deal ${i + 1},${(i + 1) * 100},2026-11-${String((i % 28) + 1).padStart(2, '0')},${['Lead', 'Won', 'Lost'][i % 3]},${i % 2 ? 'yes' : 'no'}`)].join('\n');
    const f = files.storeFile('deals.csv', csv, A, spaceId, 'text/csv');
    const thread = threads.createThread(A, spaceId, 'Import');
    threads.addMessage(thread.id, 'user', { text: 'Turn this into a database', contexts: [{ kind: 'file', pageId: f.id, title: 'deals.csv', markdown: csv.slice(0, 200), truncated: true, mime: 'text/csv' }] } as any);
    const r = await tool(env(A, thread.id), 'import_csv', {});
    expect(r.isError).toBeFalsy();
    const dbId = /database_id: ([0-9a-f-]{36})/.exec(r.content)![1];
    const col = db.getRecord<any>('collection', db.getRecord<any>('block', dbId).collection_id);
    const types = Object.fromEntries(Object.values(col.schema).map((p: any) => [p.name, p.type]));
    expect(types).toMatchObject({ Name: 'title', Amount: 'number', Due: 'date', Stage: 'select', Done: 'checkbox' });
    const rows = db.childrenOf<any>('block', col.id).filter((b: any) => b.parent_table === 'collection');
    expect(rows).toHaveLength(150);
    expect(r.content).toContain('150 row(s)');
    // someone else's upload doesn't resolve, and a chat without a CSV says so
    const other = threads.createThread(B, spaceId, 'Other');
    threads.addMessage(other.id, 'user', { text: 'x', contexts: [{ kind: 'file', pageId: f.id, title: 'deals.csv', markdown: '', truncated: false }] } as any);
    expect((await tool(env(B, other.id), 'import_csv', {})).isError).toBe(true);
    expect((await tool(env(A, threads.createThread(A, spaceId, 'Empty').id), 'import_csv', {})).content).toMatch(/no CSV file attached/);
  });
});

describe('charts, forms and dashboards made by the agent', () => {
  it('create_database with a chart, a form and a dashboard', async () => {
    const r = await tool(env(A), 'create_database', {
      title: 'Bug reports',
      properties: [{ name: 'Title', type: 'title' }, { name: 'Severity', type: 'select', options: ['Low', 'High'] }, { name: 'Details', type: 'text' }, { name: 'Hours', type: 'number' }],
      views: [
        { type: 'table' },
        { type: 'chart', name: 'By severity', group_by: 'Severity', chart_type: 'donut' },
        { type: 'form', name: 'Report a bug', description: 'Tell us what broke', questions: [{ property: 'Severity', required: true }, { property: 'Details', long_answer: true }] },
        { type: 'dashboard', name: 'Overview', widgets: [{ type: 'chart', chart_type: 'number' }, { type: 'chart', group_by: 'Severity', aggregate: { function: 'sum', property: 'Hours' } }, { type: 'table' }] },
      ],
    });
    expect(r.isError).toBeFalsy();
    const dbId = /database_id: ([0-9a-f-]{36})/.exec(r.content)![1];
    const vs = views(dbId);
    expect(vs.map((v: any) => v.type)).toEqual(['table', 'chart', 'form', 'dashboard']);
    const col = db.getRecord<any>('collection', db.getRecord<any>('block', dbId).collection_id);
    const sev = Object.keys(col.schema).find((k) => col.schema[k].name === 'Severity');
    expect(vs[1].format.chart_config).toMatchObject({ type: 'donut', dataConfig: { type: 'groups_reducer', groupBy: { property: sev } } });
    const form = vs[2].format.form_config;
    expect(form).toMatchObject({ title: 'Report a bug', description: 'Tell us what broke', ownerId: A });
    expect(form.questions.map((q: any) => q.config.propertyId)).toEqual(['title', sev, expect.any(String)]);
    expect(form.questions[1].config.isRequired).toBe(true);
    const rows = vs[3].format.dashboard_layout.rows;
    const widgetViews = rows.flatMap((row: any) => row.widgets.map((w: any) => db.getRecord<any>('collection_view', w.view_id)));
    expect(widgetViews.map((w: any) => w.type)).toEqual(['chart', 'chart', 'table']);
    expect(widgetViews.every((w: any) => w.format.dashboard_view_id === vs[3].id)).toBe(true);
    expect(widgetViews[1].format.chart_config.dataConfig.aggregationConfig.aggregation).toMatchObject({ aggregator: 'sum' });
    // widget views stay out of the tab bar
    expect(db.getRecord<any>('block', dbId).view_ids).toHaveLength(4);
  });

  it('update_database adds a form to an existing database, as the person (view-only people can’t)', async () => {
    const r = await tool(env(A), 'create_database', { title: 'Requests', properties: [{ name: 'Topic', type: 'text' }] });
    const dbId = /database_id: ([0-9a-f-]{36})/.exec(r.content)![1];
    const up = await tool(env(A), 'update_database', { database_id: dbId, add_views: [{ type: 'form', name: 'Ask us' }] });
    expect(up.isError).toBeFalsy();
    expect(views(dbId).map((v: any) => v.type)).toEqual(['table', 'form']);
    expect((await tool(env(B), 'update_database', { database_id: dbId, add_views: [{ type: 'chart' }] })).isError).toBe(true);
  });
});

describe('chat table › Save as database', () => {
  it('saves the table as a private database of the person', async () => {
    const r = await H.aiTableToDatabase({ userId: B, setCookie: () => {} }, { spaceId, title: 'Competitors', header: ['Company', 'Founded', 'Pricing'], rows: [['Acme', '2001', 'Paid'], ['Globex', '1999', 'Free'], ['Initech', '2010', 'Paid']] });
    const block = db.getRecord<any>('block', r.pageId);
    expect(block).toMatchObject({ type: 'collection_view_page', parent_table: 'space', created_by_id: B });
    expect(block.permissions).toEqual([expect.objectContaining({ user_id: B, role: 'editor' })]);
    const col = db.getRecord<any>('collection', block.collection_id);
    expect(Object.values(col.schema).map((p: any) => p.name)).toEqual(['Company', 'Founded', 'Pricing']);
    expect(r.rows).toBe(3);
    expect(() => H.aiTableToDatabase({ userId: B, setCookie: () => {} }, { spaceId, header: [], rows: [] })).toThrow(/no columns/);
  });
});

// Database views work: database duplication (client duplicate + persist hook, server duplicateBlock), several
// data sources per database (search, page loads), forms (conditional logic, submission template, Email me a copy).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-dbviews-test-'));
process.env.NC_AUTOMATION_WINDOW_MS = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {}, ip: '10.0.0.9' });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}
const rec = (table: string, id: string) => db.getRecord<any>(table as any, id);
function tx(user: string, operations: any[]) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
}
const set = (table: string, id: string, args: any) => ({ pointer: { table, id, spaceId: ids.space }, path: [], command: 'set', args });

/** A database (block + collection + view + rows) written directly, like existing data. */
function makeDatabase(parentId: string, opts: { name?: string; rows?: string[]; permissions?: any[]; schema?: any; type?: string } = {}) {
  const now = Date.now();
  const block = newId();
  const col = newId();
  const view = newId();
  const schema = opts.schema ?? { title: { name: 'Name', type: 'title' } };
  db.putRecord('block', {
    id: block, version: 1, type: opts.type ?? 'collection_view', parent_id: parentId, parent_table: 'block', space_id: ids.space, alive: true, collection_id: col, view_ids: [view],
    created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice, ...(opts.permissions ? { permissions: opts.permissions } : {}),
    format: { collection_pointer: { id: col, table: 'collection', spaceId: ids.space } },
  } as any);
  db.putRecord('collection', { id: col, version: 1, parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, name: [[opts.name ?? 'Tasks']], schema, template_pages: [] } as any);
  db.putRecord('collection_view', { id: view, version: 1, type: 'table', name: 'Table', parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, format: { collection_pointer: { id: col, table: 'collection', spaceId: ids.space } }, query2: {}, page_sort: [] } as any);
  const parent = db.getRecord<any>('block', parentId)!;
  db.putRecord('block', { ...parent, content: [...(parent.content ?? []), block] });
  const rows: string[] = [];
  for (const t of opts.rows ?? []) {
    const id = newId();
    rows.push(id);
    db.putRecord('block', { id, version: 1, type: 'page', parent_id: col, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [[t]] }, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice } as any);
  }
  return { block, col, view, rows };
}
const rowsOf = (col: string) => (db.db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND parent_id = ?`).all(col) as any[]).map((r) => JSON.parse(r.data)).filter((b) => b.alive !== false);

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  H = (await import('../src/api/handlers.ts')).handlers as any;
  Object.assign(H, (await import('../src/api/extra.ts')).extraHandlers);
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  for (const n of ['alice', 'bob', 'carol']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@dbv.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.teamHome = w.team.team_pages[0];
  ids.private = w.spaceView.private_pages[0];
  seed.addMember(ids.space, ids.bob, 'editor');
  seed.addMember(ids.space, ids.carol, 'editor');
});

describe('database duplication', () => {
  it('a client duplicate gets its rows, templates and manual order in the same write (with content)', async () => {
    const src = makeDatabase(ids.teamHome, { rows: ['A', 'B'], schema: { title: { name: 'Name', type: 'title' }, rel: { name: 'Rel', type: 'relation', collection_id: '' } } });
    // self relation A → B, a template, manual order B, A
    const s = rec('collection', src.col);
    db.putRecord('collection', { ...s, schema: { ...s.schema, rel: { name: 'Rel', type: 'relation', collection_id: src.col, version: 'v2' } } });
    const a = rec('block', src.rows[0]);
    db.putRecord('block', { ...a, properties: { ...a.properties, rel: [['‣', [['p', src.rows[1], ids.space]]]] } });
    const tpl = newId();
    db.putRecord('block', { id: tpl, version: 1, type: 'page', parent_id: src.col, parent_table: 'collection', space_id: ids.space, alive: true, is_template: true, properties: { title: [['Tpl']] } } as any);
    db.putRecord('collection', { ...rec('collection', src.col), template_pages: [tpl] });
    db.putRecord('collection_view', { ...rec('collection_view', src.view), page_sort: [src.rows[1], src.rows[0]] });
    const nb = newId();
    const nc = newId();
    const nv = newId();
    await tx(ids.bob, [
      set('collection', nc, { id: nc, name: [['Tasks']], schema: { title: { name: 'Name', type: 'title' }, rel: { name: 'Rel', type: 'relation', collection_id: nc, version: 'v2' } }, parent_id: nb, parent_table: 'block', alive: true, template_pages: [], copied_from: src.col, nc_copy: 'with_content' }),
      set('collection_view', nv, { id: nv, type: 'table', name: 'Table', parent_id: nb, parent_table: 'block', alive: true, format: { collection_pointer: { id: nc, table: 'collection', spaceId: ids.space } }, query2: {}, page_sort: [src.rows[1], src.rows[0]] }),
      set('block', nb, { id: nb, type: 'collection_view', parent_id: ids.teamHome, parent_table: 'block', alive: true, collection_id: nc, view_ids: [nv], copied_from: src.block, format: { collection_pointer: { id: nc, table: 'collection', spaceId: ids.space } } }),
      { pointer: { table: 'block', id: ids.teamHome, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: nb, after: src.block } },
    ]);
    const copies = rowsOf(nc);
    const titles = copies.filter((r) => !r.is_template).map((r) => r.properties.title[0][0]).sort();
    expect(titles).toEqual(['A', 'B']);
    const copyA = copies.find((r) => r.properties.title[0][0] === 'A');
    const copyB = copies.find((r) => r.properties.title[0][0] === 'B');
    expect(copyA.properties.rel[0][1][0][1]).toBe(copyB.id); // relation re-pointed at the copy
    expect(copyA.copied_from).toBe(src.rows[0]);
    const c = rec('collection', nc);
    expect(c.nc_copy).toBeUndefined();
    expect(c.template_pages).toHaveLength(1);
    expect(c.template_pages[0]).not.toBe(tpl);
    expect(rec('collection_view', nv).page_sort).toEqual([copyB.id, copyA.id]);
    // the source keeps its rows
    expect(rowsOf(src.col).filter((r) => !r.is_template)).toHaveLength(2);
  });

  it('without content copies the templates but no rows', async () => {
    const src = makeDatabase(ids.teamHome, { rows: ['X'] });
    const tpl = newId();
    db.putRecord('block', { id: tpl, version: 1, type: 'page', parent_id: src.col, parent_table: 'collection', space_id: ids.space, alive: true, is_template: true, properties: { title: [['T']] } } as any);
    db.putRecord('collection', { ...rec('collection', src.col), template_pages: [tpl] });
    const nb = newId();
    const nc = newId();
    await tx(ids.bob, [
      set('collection', nc, { id: nc, name: [['Tasks']], schema: { title: { name: 'Name', type: 'title' } }, parent_id: nb, parent_table: 'block', alive: true, template_pages: [], copied_from: src.col, nc_copy: 'schema_only' }),
      set('block', nb, { id: nb, type: 'collection_view', parent_id: ids.teamHome, parent_table: 'block', alive: true, collection_id: nc, view_ids: [], copied_from: src.block }),
      { pointer: { table: 'block', id: ids.teamHome, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: nb } },
    ]);
    const copies = rowsOf(nc);
    expect(copies.filter((r) => !r.is_template)).toHaveLength(0);
    expect(copies.filter((r) => r.is_template)).toHaveLength(1);
    expect(rec('collection', nc).template_pages).toHaveLength(1);
  });

  it('copies nothing from a data source the person cannot read', async () => {
    const secret = makeDatabase(ids.private, { rows: ['Secret'], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }] });
    const nb = newId();
    const nc = newId();
    await tx(ids.carol, [
      set('collection', nc, { id: nc, name: [['Copy']], schema: { title: { name: 'Name', type: 'title' } }, parent_id: nb, parent_table: 'block', alive: true, template_pages: [], copied_from: secret.col, nc_copy: 'with_content' }),
      set('block', nb, { id: nb, type: 'collection_view', parent_id: ids.teamHome, parent_table: 'block', alive: true, collection_id: nc, view_ids: [] }),
      { pointer: { table: 'block', id: ids.teamHome, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: nb } },
    ]);
    expect(rowsOf(nc)).toHaveLength(0);
  });

  it('copies leave out the values of properties the person cannot see', async () => {
    const src = makeDatabase(ids.private, {
      rows: ['Row'],
      schema: { title: { name: 'Name', type: 'title' }, sal: { name: 'Salary', type: 'text', property_permissions: { default_access: 'none', overrides: [] } }, note: { name: 'Note', type: 'text' } },
      permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'read_and_write', user_id: ids.carol }],
    });
    db.putRecord('block', { ...rec('block', src.rows[0]), properties: { title: [['Row']], sal: [['secret-123']], note: [['visible']] } });
    const nb = newId();
    const nc = newId();
    await tx(ids.carol, [
      set('collection', nc, { id: nc, name: [['Copy']], schema: { title: { name: 'Name', type: 'title' }, note: { name: 'Note', type: 'text' } }, parent_id: nb, parent_table: 'block', alive: true, template_pages: [], copied_from: src.col, nc_copy: 'with_content' }),
      set('block', nb, { id: nb, type: 'collection_view', parent_id: ids.teamHome, parent_table: 'block', alive: true, collection_id: nc, view_ids: [] }),
      { pointer: { table: 'block', id: ids.teamHome, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: nb } },
    ]);
    const copies = rowsOf(nc);
    expect(copies).toHaveLength(1);
    expect(copies[0].properties.note[0][0]).toBe('visible');
    expect(copies[0].properties.sal).toBeUndefined();
    expect(JSON.stringify(copies)).not.toContain('secret-123');
  });

  it('server duplicateBlock gives a page\'s databases their own data sources and views', async () => {
    const page = newId();
    db.putRecord('block', { id: page, version: 1, type: 'page', parent_id: ids.teamHome, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Holder']] }, content: [] } as any);
    db.putRecord('block', { ...rec('block', ids.teamHome), content: [...(rec('block', ids.teamHome).content ?? []), page] });
    const inner = makeDatabase(page, { rows: ['R1', 'R2'] });
    const res = await call(ids.alice, 'duplicateBlock', { blockId: page });
    const copy = rec('block', res.blockId);
    const dbCopy = rec('block', copy.content[0]);
    expect(dbCopy.collection_id).not.toBe(inner.col);
    const view = rec('collection_view', dbCopy.view_ids[0]);
    expect(view.parent_id).toBe(dbCopy.id);
    expect(view.format.collection_pointer.id).toBe(dbCopy.collection_id);
    expect(rowsOf(dbCopy.collection_id).map((r) => r.properties.title[0][0]).sort()).toEqual(['R1', 'R2']);
  });
});

describe('several data sources per database', () => {
  it('search lists every owned source and page loads bring their rows and all views', async () => {
    const d = makeDatabase(ids.teamHome, { name: 'Primary', rows: ['P1'] });
    // a second source + a view of it + a dashboard widget view (not a tab)
    const second = newId();
    const sv = newId();
    const widget = newId();
    const now = Date.now();
    db.putRecord('collection', { id: second, version: 1, parent_id: d.block, parent_table: 'block', space_id: ids.space, alive: true, name: [['Secondary']], schema: { title: { name: 'Name', type: 'title' } }, template_pages: [] } as any);
    db.putRecord('collection_view', { id: sv, version: 1, type: 'table', name: 'Table', parent_id: d.block, parent_table: 'block', space_id: ids.space, alive: true, format: { collection_pointer: { id: second, table: 'collection', spaceId: ids.space } }, query2: {} } as any);
    db.putRecord('collection_view', { id: widget, version: 1, type: 'chart', name: 'Chart', parent_id: d.block, parent_table: 'block', space_id: ids.space, alive: true, format: { dashboard_view_id: d.view }, query2: {} } as any);
    db.putRecord('block', { ...rec('block', d.block), view_ids: [d.view, sv] });
    db.putRecord('block', { id: newId(), version: 1, type: 'page', parent_id: second, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['S1']] }, created_time: now } as any);
    const found = await call(ids.bob, 'searchDataSources', { spaceId: ids.space, query: 'Secondary' });
    expect(found.results.map((r: any) => r.collectionId)).toContain(second);
    const chunk = await call(ids.bob, 'loadPage', { pageId: ids.teamHome });
    const blocks = Object.values(chunk.recordMap.block ?? {}).map((x: any) => x.value.value);
    expect(blocks.some((b: any) => b.parent_id === second && b.properties?.title?.[0]?.[0] === 'S1')).toBe(true);
    expect(Object.keys(chunk.recordMap.collection_view ?? {})).toEqual(expect.arrayContaining([sv, widget]));
  });
});

describe('forms', () => {
  const formDb = () => {
    const d = makeDatabase(ids.teamHome, {
      name: 'Survey',
      schema: {
        title: { name: 'Name', type: 'title' },
        kind: { name: 'Kind', type: 'select', options: [{ id: 'o1', value: 'Bug', color: 'red' }, { id: 'o2', value: 'Idea', color: 'blue' }] },
        steps: { name: 'Steps', type: 'text' },
      },
    });
    const tpl = newId();
    db.putRecord('block', { id: tpl, version: 1, type: 'page', parent_id: d.col, parent_table: 'collection', space_id: ids.space, alive: true, is_template: true, properties: { title: [['Tpl']] }, content: [] } as any);
    db.putRecord('collection', { ...rec('collection', d.col), template_pages: [tpl] });
    const form = newId();
    const qTitle = newId();
    const qKind = newId();
    const qSteps = newId();
    db.putRecord('collection_view', {
      id: form, version: 1, type: 'form', name: 'Form builder', parent_id: d.block, parent_table: 'block', space_id: ids.space, alive: true, query2: {},
      format: { form_config: { version: 1, permission: 'public', anonymous: true, ownerId: ids.alice, templateId: tpl, submitScreen: { allowEmailResponse: true }, questions: [
        { id: qTitle, config: { propertyId: 'title' } },
        { id: qKind, config: { propertyId: 'kind' } },
        { id: qSteps, config: { propertyId: 'steps', isRequired: true, condition: { questionId: qKind, operator: 'any', values: ['Bug'] } } },
      ] } },
    } as any);
    db.putRecord('block', { ...rec('block', d.block), view_ids: [d.view, form] });
    return { ...d, form, qTitle, qKind, qSteps, tpl };
  };

  it('conditional questions are only required while their condition holds', async () => {
    const f = formDb();
    const ok = await call(null, 'submitFormResponse', { viewId: f.form, answers: { [f.qTitle]: 'An idea', [f.qKind]: 'Idea' } });
    expect(ok.pageId).toBeTruthy();
    const bad = await call(null, 'submitFormResponse', { viewId: f.form, answers: { [f.qTitle]: 'A bug', [f.qKind]: 'Bug' } });
    expect(bad.errors?.[f.qSteps]).toBe('Please answer this question');
    // answers to hidden questions are dropped
    const hidden = await call(null, 'submitFormResponse', { viewId: f.form, answers: { [f.qTitle]: 'Another idea', [f.qKind]: 'Idea', [f.qSteps]: 'ignored' } });
    expect(rec('block', hidden.pageId).properties.steps).toBeUndefined();
    const pub = await call(null, 'getPublicForm', { viewId: f.form });
    expect(pub.form.questions.find((q: any) => q.id === f.qSteps).condition.values).toEqual(['Bug']);
  });

  it('applies the form template to new submissions', async () => {
    const f = formDb();
    const child = newId();
    db.putRecord('block', { id: child, version: 1, type: 'text', parent_id: f.tpl, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Checklist']] } } as any);
    db.putRecord('block', { ...rec('block', f.tpl), content: [child] });
    const res = await call(null, 'submitFormResponse', { viewId: f.form, answers: { [f.qTitle]: 'With template', [f.qKind]: 'Idea' } });
    const page = rec('block', res.pageId);
    expect(page.properties.title[0][0]).toBe('With template'); // the answer wins over the template title
    expect((page.content ?? []).map((id: string) => rec('block', id)?.properties?.title?.[0]?.[0])).toContain('Checklist');
  });

  it('Email me a copy: only for a fresh response of this form, when the setting is on', async () => {
    const f = formDb();
    const res = await call(null, 'submitFormResponse', { viewId: f.form, answers: { [f.qTitle]: 'Mail me', [f.qKind]: 'Idea' } });
    expect(await status(() => call(null, 'emailFormResponse', { viewId: f.form, pageId: res.pageId, email: 'not-an-email' }))).toBe(400);
    const sent = await call(null, 'emailFormResponse', { viewId: f.form, pageId: res.pageId, email: 'resp@example.com' });
    expect(sent.to).toBe('resp@example.com');
    const mail = (db.db.prepare(`SELECT subject, text FROM mail_outbox WHERE to_email = ? ORDER BY created_time DESC`).all('resp@example.com') as any[])[0];
    expect(mail.subject).toContain('Your response to');
    expect(mail.text).toContain('Kind: Idea');
    // another database's page can't be mailed through this form
    const other = makeDatabase(ids.teamHome, { rows: ['Z'] });
    expect(await status(() => call(null, 'emailFormResponse', { viewId: f.form, pageId: other.rows[0], email: 'x@example.com' }))).toBe(404);
    // setting off → refused
    const v = rec('collection_view', f.form);
    db.putRecord('collection_view', { ...v, format: { form_config: { ...v.format.form_config, submitScreen: {} } } });
    expect(await status(() => call(null, 'emailFormResponse', { viewId: f.form, pageId: res.pageId, email: 'resp@example.com' }))).toBe(403);
  });
});

describe('feed view: track views', () => {
  it('lists who opened each post (author left out, view-history privacy, unreadable posts left out)', async () => {
    const d = makeDatabase(ids.teamHome, { rows: ['Post'] });
    const post = d.rows[0];
    for (const u of [ids.bob, ids.carol, ids.alice]) await call(u, 'recordPageView', { pageId: post });
    const r = await call(ids.alice, 'getFeedViews', { pageIds: [post] });
    expect(r.views[post].count).toBe(2); // the author's own views don't count
    expect(r.views[post].viewers.map((v: any) => v.userId).sort()).toEqual([ids.bob, ids.carol].sort());
    expect(r.recordMap.lit_user?.[ids.bob]).toBeTruthy();
    // Carol turns off "Show my view history": others no longer see her, she still sees her own view
    const us = rec('user_settings', ids.carol) ?? { id: ids.carol, version: 1 };
    db.putRecord('user_settings', { ...us, settings: { ...(us.settings ?? {}), page_view_history: 'deny' } } as any);
    expect((await call(ids.bob, 'getFeedViews', { pageIds: [post] })).views[post].viewers.map((v: any) => v.userId)).toEqual([ids.bob]);
    expect((await call(ids.carol, 'getFeedViews', { pageIds: [post] })).views[post].viewers.map((v: any) => v.userId).sort()).toEqual([ids.bob, ids.carol].sort());
    // someone outside the workspace learns nothing; signed out = 401
    const dave = newId();
    seed.createUser(dave, 'dave@dbv.test', 'Dave');
    expect((await call(dave, 'getFeedViews', { pageIds: [post] })).views[post]).toBeUndefined();
    expect(await status(() => call(null, 'getFeedViews', { pageIds: [post] }))).toBe(401);
  });
});

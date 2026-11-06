// Database privacy on the way out (audit A3 items 3, 7, 8, 10):
// - button and automation steps build messages / webhook bodies from the actor's view (clicker / automation owner)
// - deleted properties keep masking their values by their rule; values of properties deleted for good never leave
// - comment threads on a property value reach only people who can see that value
// - people who reach rows only through page-level access rules get the (redacted) data source, so row pages show
// their properties and linked views load
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-dbsec-reads-'));
process.env.NC_SCHEDULER = '0';
process.env.NC_AUTOMATION_WINDOW_MS = '0';
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let engine: typeof import('../src/automations/engine.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
const tx = (user: string, operations: any[]) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
const ptr = (table: string, id: string) => ({ table, id, spaceId: ids.space });
const setOp = (table: string, id: string, path: string[], args: unknown) => ({ pointer: ptr(table, id), path, command: 'set', args });
const rec = (table: string, id: string) => db.getRecord<any>(table, id)!;
const person = (userId: string) => [['‣', [['u', userId]]]];
const pageRef = (id: string) => [['‣', [['p', id, ids.space]]]];
const notificationsOf = (uid: string) => (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ?`).all(uid) as any[]).map((r) => JSON.parse(r.data));

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function newRow(user: string, colId: string, props: Record<string, unknown>) {
  const id = newId();
  const now = Date.now();
  tx(user, [setOp('block', id, [], {
    id, type: 'page', parent_id: colId, parent_table: 'collection', alive: true, space_id: ids.space, properties: props,
    created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user,
  })]);
  return id;
}

function makePage(parentId: string, title: string, extra: Record<string, unknown> = {}) {
  const id = newId();
  const now = Date.now();
  db.putRecord('block', { id, version: 1, type: 'page', parent_id: parentId, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [[title]] }, created_time: now, created_by_id: ids.alice, last_edited_time: now, ...extra } as any);
  const p = rec('block', parentId);
  db.putRecord('block', { ...p, content: [...(p.content ?? []), id] });
  return id;
}

function makeDatabase(parentId: string, name: string, schema: Record<string, unknown>, owner = ids.alice) {
  const block = newId();
  const col = newId();
  const view = newId();
  const now = Date.now();
  db.putRecord('block', { id: block, version: 1, type: 'collection_view_page', parent_id: parentId, parent_table: 'block', space_id: ids.space, alive: true, collection_id: col, view_ids: [view], created_time: now, created_by_id: owner, last_edited_time: now } as any);
  const p = rec('block', parentId);
  db.putRecord('block', { ...p, content: [...(p.content ?? []), block] });
  db.putRecord('collection', { id: col, version: 1, name: [[name]], parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, schema } as any);
  db.putRecord('collection_view', { id: view, version: 1, type: 'table', name: 'Table', parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, format: {}, page_sort: [] } as any);
  return { block, col, view };
}

let receiver: Server;
let port = 0;
const received: { url: string; body: any }[] = [];
const got = (path: string) => received.filter((r) => r.url === path);

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  engine = await import('../src/automations/engine.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'carl', 'erin', 'frank']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@dbsec-r.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.private = w.spaceView.private_pages[0];
  for (const n of ['carl', 'erin', 'frank']) seed.addMember(ids.space, ids[n], 'member');

  const d = makeDatabase(ids.private, 'Payroll', {
    title: { name: 'Name', type: 'title' }, notes: { name: 'Notes', type: 'text' },
    sal: { name: 'Salary', type: 'text', property_permissions: { default_access: 'none', overrides: [] } },
    grade: { name: 'Grade', type: 'text', property_permissions: { default_access: 'reader', overrides: [] } },
    code: { name: 'Code', type: 'text', property_permissions: { default_access: 'schema_only', overrides: [] } },
    own: { name: 'Owner', type: 'person' },
    btn: { name: 'Ping', type: 'button' },
  });
  Object.assign(ids, { db: d.block, col: d.col, view: d.view });
  // Carl edits the database; Erin and Frank have no access to it — Erin reaches her row through the Owner rule
  tx(ids.alice, [setOp('block', ids.db, ['permissions'], [{ type: 'user_permission', user_id: ids.alice, role: 'editor' }, { type: 'user_permission', user_id: ids.carl, role: 'read_and_write' }])]);
  tx(ids.alice, [setOp('collection', ids.col, ['permission_rules'], [{ id: 'r-own', property: 'own', role: 'read_and_write' }])]);
  ids.alpha = newRow(ids.alice, ids.col, { title: [['Alpha']], notes: [['alpha notes']], sal: [['alpha-salary-111']], grade: [['A1']], code: [['alpha-code-222']] });
  ids.erinRow = newRow(ids.alice, ids.col, { title: [['Erin row']], notes: [['erin notes']], sal: [['erin-salary-333']], grade: [['E1']], code: [['erin-code-444']], own: person(ids.erin) });
  // a team page shared with Erin and Frank holding a linked view of Payroll
  ids.team = makePage(ids.private, 'Team', { permissions: [{ type: 'user_permission', user_id: ids.alice, role: 'editor' }, { type: 'user_permission', user_id: ids.erin, role: 'read_and_write' }, { type: 'user_permission', user_id: ids.frank, role: 'read_and_write' }] });
  ids.linked = newId();
  ids.linkedView = newId();
  db.putRecord('block', { id: ids.linked, version: 1, type: 'collection_view', parent_id: ids.team, parent_table: 'block', space_id: ids.space, alive: true, collection_id: ids.col, view_ids: [ids.linkedView], format: { collection_pointer: { id: ids.col, table: 'collection', spaceId: ids.space } } } as any);
  db.putRecord('collection_view', { id: ids.linkedView, version: 1, type: 'table', name: 'Linked', parent_id: ids.linked, parent_table: 'block', space_id: ids.space, alive: true, format: { collection_pointer: { id: ids.col, table: 'collection', spaceId: ids.space } } } as any);
  db.putRecord('block', { ...rec('block', ids.team), content: [ids.linked] });

  receiver = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { received.push({ url: req.url ?? '', body: JSON.parse(data) }); } catch { received.push({ url: req.url ?? '', body: data }); }
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
  port = (receiver.address() as any).port;
});

afterAll(() => {
  receiver?.close();
});

describe('rows reached through page-level rules come with their data source (audit A3 #10)', () => {
  it('a row page shows its properties (redacted) to someone without access to the database', async () => {
    const chunk = await call(ids.erin, 'loadPage', { pageId: ids.erinRow });
    const col = chunk.recordMap.collection?.[ids.col]?.value?.value;
    expect(col).toBeTruthy();
    expect(chunk.recordMap.collection[ids.col].value.role).toBe('reader');
    expect(col.schema.sal).toBeUndefined();
    expect(col.schema.grade).toBeTruthy();
    expect(col.schema.code).toBeTruthy();
    const row = chunk.recordMap.block[ids.erinRow].value.value;
    expect(row.properties.grade).toEqual([['E1']]);
    expect(row.properties.sal).toBeUndefined();
    expect(row.properties.code).toBeUndefined();
    // the database block itself stays out of reach
    expect(chunk.recordMap.block[ids.db]).toBeUndefined();
  });

  it('a linked view loads the data source and only the rows the person reaches', async () => {
    const asErin = await call(ids.erin, 'loadPage', { pageId: ids.team });
    expect(asErin.recordMap.collection?.[ids.col]).toBeTruthy();
    const rows = Object.values(asErin.recordMap.block ?? {}).map((e: any) => e.value.value).filter((b: any) => b.parent_id === ids.col);
    expect(rows.map((r: any) => r.id)).toEqual([ids.erinRow]);
    expect(JSON.stringify(asErin)).not.toContain('alpha-salary-111');
    const rowsApi = await call(ids.erin, 'loadCollectionRows', { collectionId: ids.col });
    expect(rowsApi.total).toBe(1);
    // Frank sees the page but no row of the database: no data source either
    const asFrank = await call(ids.frank, 'loadPage', { pageId: ids.team });
    expect(asFrank.recordMap.collection?.[ids.col]).toBeUndefined();
    expect(await status(() => call(ids.frank, 'loadCollectionRows', { collectionId: ids.col }))).toBe(404);
  });
});

describe('button steps and automations send what their actor may see (audit A3 #3)', () => {
  it('a button on a row page notifies and posts without values hidden from the clicker', async () => {
    const btn = newId();
    const now = Date.now();
    db.putRecord('block', {
      id: btn, version: 1, type: 'button', parent_id: ids.erinRow, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Leak']] },
      format: { button_automation: { trigger: 'button_clicked', v: 2, actions: [
        { id: 'n', type: 'notify', target: { type: 'users', user_ids: [ids.erin] }, message: [{ type: 'text', text: 'Salary: ' }, { type: 'property', property: 'sal' }, { type: 'text', text: ' Code: ' }, { type: 'property', property: 'code' }, { type: 'text', text: ' Grade: ' }, { type: 'property', property: 'grade' }] },
        { id: 'w', type: 'webhook', url: `http://127.0.0.1:${port}/btn`, headers: [], properties: 'all' },
      ] } },
      created_time: now, created_by_id: ids.erin, last_edited_time: now, last_edited_by_id: ids.erin,
    } as any);
    db.putRecord('block', { ...rec('block', ids.erinRow), content: [btn] });
    received.length = 0;
    expect((await call(ids.erin, 'runButtonServerSteps', { blockId: btn, stepIds: ['n', 'w'] })).ok).toBe(true);
    const msg = notificationsOf(ids.erin).find((n) => n.activity?.automation_name === 'Leak')?.activity?.message;
    expect(msg).toContain('Grade: E1');
    expect(msg).not.toContain('erin-salary-333');
    expect(msg).not.toContain('erin-code-444');
    const body = got('/btn')[0].body;
    expect(JSON.stringify(body)).not.toMatch(/erin-salary-333|erin-code-444/);
    expect(body.data.properties.Salary).toBeUndefined();
    expect(body.data.properties.Grade.rich_text[0].plain_text).toBe('E1');
  });

  it('a database button posts only the properties its clicker can see', async () => {
    const col = rec('collection', ids.col);
    db.putRecord('collection', { ...col, schema: { ...col.schema, btn: { name: 'Ping', type: 'button', button_automation: { trigger: 'button_clicked', v: 2, actions: [{ id: 'w', type: 'webhook', url: `http://127.0.0.1:${port}/prop`, headers: [], properties: 'all' }] } } } });
    received.length = 0;
    expect((await call(ids.erin, 'runButtonServerSteps', { rowId: ids.erinRow, propertyId: 'btn', stepIds: ['w'] })).ok).toBe(true);
    const props = got('/prop')[0].body.data.properties;
    expect(props.Salary).toBeUndefined();
    expect(JSON.stringify(props)).not.toMatch(/erin-salary-333|erin-code-444/);
    // the database's owner gets everything
    received.length = 0;
    await call(ids.alice, 'runButtonServerSteps', { rowId: ids.erinRow, propertyId: 'btn', stepIds: ['w'] });
    expect(JSON.stringify(got('/prop')[0].body)).toContain('erin-salary-333');
  });

  it('an automation’s webhook and message use its owner’s view of related databases', async () => {
    // Carl has full access to Projects; a rollup reads Payroll's Salary, which Carl can't see
    const carlPage = newId();
    const now = Date.now();
    db.putRecord('block', { id: carlPage, version: 1, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, properties: { title: [['Carl home']] }, permissions: [{ type: 'user_permission', user_id: ids.carl, role: 'editor' }], created_time: now, created_by_id: ids.carl, last_edited_time: now } as any);
    const p = makeDatabase(carlPage, 'Projects', {
      title: { name: 'Name', type: 'title' }, rel: { name: 'People', type: 'relation', collection_id: ids.col },
      roll: { name: 'Pay', type: 'rollup', relation_property: 'rel', target_property: 'sal', aggregation: 'show_original' },
    }, ids.carl);
    const saved = await call(ids.carl, 'saveAutomation', {
      collectionId: p.col,
      automation: {
        trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] },
        actions: [
          { type: 'notify', target: { type: 'users', user_ids: [ids.carl] }, message: [{ type: 'text', text: 'Pay: ' }, { type: 'property', property: 'roll' }] },
          { type: 'webhook', url: `http://127.0.0.1:${port}/auto`, headers: [], properties: 'all' },
        ],
      },
    });
    expect(saved.automationId).toBeTruthy();
    received.length = 0;
    newRow(ids.carl, p.col, { title: [['Launch']], rel: pageRef(ids.alpha) });
    await engine.flushAutomations();
    expect(got('/auto').length).toBe(1);
    expect(JSON.stringify(got('/auto')[0].body)).not.toContain('alpha-salary-111');
    const msg = notificationsOf(ids.carl).find((n) => n.type === 'automation' && n.activity?.automation_id === saved.automationId)?.activity?.message;
    expect(msg).toBeDefined();
    expect(msg).not.toContain('alpha-salary-111');
  });
});

describe('deleted properties keep their rule (audit A3 #7)', () => {
  it('a deleted "No access" property stays hidden — values and its Deleted properties entry', async () => {
    const col = rec('collection', ids.col);
    tx(ids.alice, [
      setOp('collection', ids.col, ['deleted_schema', 'sal'], { ...col.schema.sal, deleted_time: Date.now() }),
      setOp('collection', ids.col, ['schema', 'sal'], undefined),
    ]);
    const asCarl = await call(ids.carl, 'loadCollectionRows', { collectionId: ids.col });
    expect(asCarl.recordMap.collection[ids.col].value.value.deleted_schema?.sal).toBeUndefined();
    expect(JSON.stringify(asCarl)).not.toContain('alpha-salary-111');
    const asAlice = await call(ids.alice, 'loadCollectionRows', { collectionId: ids.col });
    expect(asAlice.recordMap.collection[ids.col].value.value.deleted_schema.sal).toBeTruthy();
    expect(JSON.stringify(asAlice)).toContain('alpha-salary-111');
    // the rule of a deleted property is full access's to change; no entry can be invented for an unknown id
    expect(await status(() => tx(ids.carl, [setOp('collection', ids.col, ['deleted_schema', 'sal', 'property_permissions'], { default_access: 'inherit', overrides: [] })]))).toBe(403);
    expect(await status(() => tx(ids.carl, [setOp('collection', ids.col, ['deleted_schema', 'zz9'], { name: 'Ghost', type: 'text' })]))).toBe(403);
  });

  it('deleting a restricted property for good takes its values off the rows; leftover values never leave', async () => {
    tx(ids.alice, [setOp('collection', ids.col, ['deleted_schema', 'sal'], undefined)]);
    expect(rec('block', ids.alpha).properties.sal).toBeUndefined();
    expect(rec('block', ids.erinRow).properties.sal).toBeUndefined();
    // a value under an id no property describes (left from before) isn't sent to anyone
    db.putRecord('block', { ...rec('block', ids.alpha), properties: { ...rec('block', ids.alpha).properties, gh0: [['orphan-value-555']] } });
    expect(JSON.stringify(await call(ids.carl, 'loadCollectionRows', { collectionId: ids.col }))).not.toContain('orphan-value-555');
    expect(JSON.stringify(await call(ids.alice, 'loadCollectionRows', { collectionId: ids.col }))).not.toContain('orphan-value-555');
  });
});

describe('comment threads on property values (audit A3 #8)', () => {
  it('reach only people who can see the value — record maps, comments sidebar, Inbox', async () => {
    const mkThread = (prop: string, text: string, mention?: string) => {
      const d = newId();
      const c = newId();
      const now = Date.now();
      tx(ids.alice, [
        setOp('discussion', d, [], { id: d, parent_id: ids.alpha, parent_table: 'block', resolved: false, property_id: prop, context: [[prop]], comments: [c], space_id: ids.space, alive: true, type: 'default' }),
        setOp('comment', c, [], { id: c, parent_id: d, parent_table: 'discussion', text: [[text], ...(mention ? [['‣', [['u', mention]]]] : [])], created_time: now, space_id: ids.space, alive: true }),
        { pointer: ptr('block', ids.alpha), path: ['discussions'], command: 'listAfter', args: { id: d } },
      ]);
      return { d, c };
    };
    const hidden = mkThread('code', 'about-code-777', ids.carl);
    const open = mkThread('notes', 'about-notes-888', ids.carl);
    const chunk = await call(ids.carl, 'loadPage', { pageId: ids.alpha });
    expect(chunk.recordMap.discussion?.[hidden.d]).toBeUndefined();
    expect(chunk.recordMap.comment?.[hidden.c]).toBeUndefined();
    expect(chunk.recordMap.discussion?.[open.d]).toBeTruthy();
    const side = await call(ids.carl, 'getPageDiscussions', { pageId: ids.alpha });
    expect(side.discussions.map((x: any) => x.id)).not.toContain(hidden.d);
    expect(JSON.stringify(side)).not.toContain('about-code-777');
    expect(JSON.stringify(await call(ids.carl, 'getPageUpdates', { pageId: ids.alpha }))).not.toContain('about-code-777');
    // mentions in a hidden thread don't reach Carl's Inbox; in a visible one they do
    await call(ids.alice, 'notifyComment', { commentId: hidden.c });
    await call(ids.alice, 'notifyComment', { commentId: open.c });
    const inbox = JSON.stringify(notificationsOf(ids.carl));
    expect(inbox).not.toContain('about-code-777');
    expect(inbox).toContain('about-notes-888');
    // Alice sees both
    const asAlice = await call(ids.alice, 'loadPage', { pageId: ids.alpha });
    expect(asAlice.recordMap.discussion?.[hidden.d]).toBeTruthy();
  });
});

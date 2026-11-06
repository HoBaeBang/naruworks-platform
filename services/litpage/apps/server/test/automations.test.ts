// Database automations engine + API: authz (full access + workspace member), trigger matching with the
// detection window, actions as the creator, loop guard, permission loss, notifications, webhooks (local receiver),
// recurrence / repeating templates (scheduler), button server steps.
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-automation-test-'));
process.env.NC_AUTOMATION_WINDOW_MS = '0';
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let engine: typeof import('../src/automations/engine.ts');
let scheduler: typeof import('../src/scheduler.ts');
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

function rowOp(id: string, collectionId: string, props: Record<string, any> = {}, user = ids.alice) {
  const now = Date.now();
  return {
    pointer: { table: 'block', id, spaceId: ids.space }, path: [], command: 'set',
    args: { id, type: 'page', parent_id: collectionId, parent_table: 'collection', space_id: ids.space, alive: true, properties: props, created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user },
  };
}

function setProp(id: string, prop: string, value: any) {
  return { pointer: { table: 'block', id, spaceId: ids.space }, path: ['properties', prop], command: 'set', args: value };
}

const schema = {
  title: { name: 'Name', type: 'title' },
  st: { name: 'Status', type: 'status', options: [{ id: 'o1', value: 'Not started', color: 'default' }, { id: 'o2', value: 'Done', color: 'green' }], groups: [] },
  tags: { name: 'Tags', type: 'multi_select', options: [{ id: 't1', value: 'Bug', color: 'red' }] },
  who: { name: 'Assignee', type: 'person' },
  done: { name: 'Done', type: 'checkbox' },
  est: { name: 'Estimate', type: 'number' },
  log: { name: 'Log', type: 'text' },
};

/** A full-page database inside `parentId` (direct records, like a migrated workspace). */
function makeDatabase(parentId: string, opts: { permissions?: any[]; name?: string } = {}) {
  const now = Date.now();
  const block = newId();
  const col = newId();
  const view = newId();
  db.putRecord('block', {
    id: block, version: 1, type: 'collection_view_page', parent_id: parentId, parent_table: 'block', space_id: ids.space, alive: true, collection_id: col, view_ids: [view],
    created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice, ...(opts.permissions ? { permissions: opts.permissions } : {}),
    format: { collection_pointer: { id: col, table: 'collection', spaceId: ids.space } },
  } as any);
  db.putRecord('collection', { id: col, version: 1, parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, name: [[opts.name ?? 'Tasks']], schema, template_pages: [] } as any);
  db.putRecord('collection_view', { id: view, version: 1, type: 'table', name: 'Table', parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, format: {}, query2: {} } as any);
  const parent = db.getRecord<any>('block', parentId)!;
  db.putRecord('block', { ...parent, content: [...(parent.content ?? []), block] });
  return { block, col, view };
}

const rec = (id: string) => db.getRecord<any>('block', id)!;
const automation = (id: string) => db.getRecord<any>('automation', id)!;
const notificationsOf = (uid: string) => (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ?`).all(uid) as any[]).map((r) => JSON.parse(r.data));

let receiver: Server;
let receiverPort = 0;
const received: { headers: any; body: any }[] = [];
let receiverStatus = 200;

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  H = (await import('../src/api/handlers.ts')).handlers as any;
  Object.assign(H, (await import('../src/api/extra.ts')).extraHandlers);
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  engine = await import('../src/automations/engine.ts');
  scheduler = await import('../src/scheduler.ts');
  for (const n of ['alice', 'bob', 'carol', 'gina', 'eve']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@auto.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.teamHome = w.team.team_pages[0];
  ids.private = w.spaceView.private_pages[0];
  seed.addMember(ids.space, ids.bob, 'editor');
  seed.addMember(ids.space, ids.carol, 'editor');
  seed.createWorkspace(ids.eve, 'Other');
  const main = makeDatabase(ids.teamHome);
  ids.block = main.block; ids.col = main.col; ids.view = main.view;
  const other = makeDatabase(ids.teamHome, { name: 'Log' });
  ids.logCol = other.col;
  // a database where carol only "can edit" and gina is a guest with full access
  const restricted = makeDatabase(ids.private, {
    name: 'Restricted',
    permissions: [
      { type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'read_and_write', user_id: ids.carol },
      { type: 'user_permission', role: 'editor', user_id: ids.gina },
    ],
  });
  ids.rCol = restricted.col;
  receiver = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try { received.push({ headers: req.headers, body: JSON.parse(data) }); } catch { received.push({ headers: req.headers, body: data }); }
      res.statusCode = receiverStatus;
      res.end('ok');
    });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
  receiverPort = (receiver.address() as any).port;
});

afterAll(() => {
  receiver?.close();
});

describe('automation API authz', () => {
  const basic = () => ({ trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] }, actions: [{ type: 'edit_property', edits: [{ property: 'done', op: 'set', values: [{ type: 'checkbox', checked: true }] }] }] });
  it('only workspace members with full access create automations', async () => {
    expect(await status(() => call(ids.carol, 'saveAutomation', { collectionId: ids.rCol, automation: basic() }))).toBe(403); // can edit, not full access
    expect(await status(() => call(ids.gina, 'saveAutomation', { collectionId: ids.rCol, automation: basic() }))).toBe(403); // guest
    expect(await status(() => call(ids.eve, 'saveAutomation', { collectionId: ids.rCol, automation: basic() }))).toBe(404); // outsider
    expect(await status(() => call(null, 'saveAutomation', { collectionId: ids.rCol, automation: basic() }))).toBe(401);
    const res = await call(ids.alice, 'saveAutomation', { collectionId: ids.rCol, automation: basic() });
    expect(res.automationId).toBeTruthy();
    // readers see it, outsiders don't; guests can't edit
    const list = await call(ids.carol, 'getAutomations', { collectionId: ids.rCol });
    expect(list.automationIds).toEqual([res.automationId]);
    expect(list.canEdit).toBe(false);
    expect(list.editProblem).toBe('Full access to this database is required to edit automations');
    expect((await call(ids.gina, 'getAutomations', { collectionId: ids.rCol })).editProblem).toBe('Join this workspace before editing automations');
    expect(await status(() => call(ids.eve, 'getAutomations', { collectionId: ids.rCol }))).toBe(404);
    expect(await status(() => call(ids.carol, 'deleteAutomation', { automationId: res.automationId }))).toBe(403);
    expect(await status(() => call(ids.carol, 'setAutomationStatus', { automationId: res.automationId, status: 'paused' }))).toBe(403);
    await call(ids.alice, 'deleteAutomation', { automationId: res.automationId });
    expect(automation(res.automationId).alive).toBe(false);
  });
  it('clients cannot write automation records through transactions', async () => {
    const id = newId();
    expect(await status(() => tx(ids.alice, [{ pointer: { table: 'automation', id, spaceId: ids.space }, path: [], command: 'set', args: { id, parent_id: ids.col, parent_table: 'collection', created_by_id: ids.bob } }]))).toBe(403);
  });
  it('rejects invalid configurations when enabling', async () => {
    const bad = { trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] }, actions: [{ type: 'add_page', edits: [] }] };
    await expect(call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: bad })).rejects.toThrow('Choose a database for the new page');
    const paused = await call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { ...bad, status: 'paused' } });
    expect(automation(paused.automationId).status).toBe('paused');
    await expect(call(ids.alice, 'setAutomationStatus', { automationId: paused.automationId, status: 'active' })).rejects.toThrow('Choose a database for the new page');
    await call(ids.alice, 'deleteAutomation', { automationId: paused.automationId });
  });
});

describe('triggers and actions', () => {
  it('page added → edit property + add page to another database, as the creator', async () => {
    const a = await call(ids.alice, 'saveAutomation', {
      collectionId: ids.col,
      automation: {
        name: 'Welcome',
        trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] },
        actions: [
          { id: 's1', type: 'edit_property', edits: [{ property: 'st', op: 'set', values: [{ type: 'option', name: 'Not started' }] }, { property: 'who', op: 'set', values: [{ type: 'context', key: 'actor' }] }] },
          { id: 's2', type: 'add_page', collection_id: ids.logCol, edits: [{ property: 'title', op: 'set', values: [{ type: 'text', text: 'Created: ' }, { type: 'property', property: 'title' }] }] },
        ],
      },
    });
    const row = newId();
    tx(ids.bob, [rowOp(row, ids.col, { title: [['Write spec']] }, ids.bob)]);
    await engine.flushAutomations();
    expect(rec(row).properties.st).toEqual([['Not started']]);
    expect(rec(row).properties.who).toEqual([['‣', [['u', ids.bob]]]]); // Whoever triggered
    expect(rec(row).last_edited_by_id).toBe(ids.alice); // runs as the creator
    const logs = db.childrenOf<any>('block', ids.logCol).filter((b) => b.alive);
    expect(logs.map((b) => b.properties.title)).toEqual([[['Created: Write spec']]]);
    expect(automation(a.automationId).run_count).toBe(1);
    expect((await call(ids.alice, 'getAutomationRuns', { automationId: a.automationId })).runs[0].status).toBe('success');
    await call(ids.alice, 'deleteAutomation', { automationId: a.automationId });
  });

  it('property condition fires on the net change only; automations do not trigger automations', async () => {
    const row = newId();
    tx(ids.alice, [rowOp(row, ids.col, { title: [['Ship']], st: [['Not started']] })]);
    await engine.flushAutomations();
    const a = await call(ids.alice, 'saveAutomation', {
      collectionId: ids.col,
      automation: {
        trigger: { type: 'event', mode: 'any', events: [{ type: 'property_edited', property: 'st', condition: { op: 'is', values: ['Done'] } }] },
        actions: [{ id: 'x', type: 'edit_property', edits: [{ property: 'done', op: 'set', values: [{ type: 'checkbox', checked: true }] }, { property: 'est', op: 'set', values: [{ type: 'formula', formula: '1 + 1' }] }] }],
      },
    });
    // a loop candidate: any property edited → append to Log (would re-trigger itself without the guard)
    const loop = await call(ids.alice, 'saveAutomation', {
      collectionId: ids.col,
      automation: { trigger: { type: 'event', mode: 'any', events: [{ type: 'any_property_edited' }] }, actions: [{ id: 'l', type: 'edit_property', edits: [{ property: 'log', op: 'set', values: [{ type: 'text', text: 'touched' }] }] }] },
    });
    // edit + revert inside the window: no net change → nothing
    tx(ids.bob, [setProp(row, 'st', [['Done']])]);
    tx(ids.bob, [setProp(row, 'st', [['Not started']])]);
    await engine.flushAutomations();
    expect(rec(row).properties.done).toBeUndefined();
    expect(automation(loop.automationId).run_count ?? 0).toBe(0);
    tx(ids.bob, [setProp(row, 'st', [['Done']])]);
    await engine.flushAutomations();
    expect(rec(row).properties.done).toEqual([['Yes']]);
    expect(rec(row).properties.est).toEqual([['2']]);
    expect(rec(row).properties.log).toEqual([['touched']]);
    await engine.flushAutomations();
    expect(automation(a.automationId).run_count).toBe(1);
    expect(automation(loop.automationId).run_count).toBe(1); // its own edit did not trigger it again
    await call(ids.alice, 'deleteAutomation', { automationId: a.automationId });
    await call(ids.alice, 'deleteAutomation', { automationId: loop.automationId });
  });

  it('view scope, edit pages in with a filter, notifications', async () => {
    const r1 = newId();
    const r2 = newId();
    tx(ids.alice, [rowOp(r1, ids.col, { title: [['A']], tags: [['Bug']] }), rowOp(r2, ids.col, { title: [['B']] })]);
    await engine.flushAutomations();
    // a view that only shows "Done" pages
    db.putRecord('collection_view', { ...db.getRecord<any>('collection_view', ids.view), query2: { filter: { operator: 'and', filters: [{ property: 'done', filter: { operator: 'checkbox_is', value: { type: 'exact', value: true } } }] } } });
    const a = await call(ids.alice, 'saveAutomation', {
      collectionId: ids.col,
      automation: {
        scope: { type: 'view', view_id: ids.view },
        trigger: { type: 'event', mode: 'any', events: [{ type: 'property_edited', property: 'est', condition: { op: 'edited' } }] },
        actions: [
          { id: 'e', type: 'edit_pages', collection_id: ids.col, filter: { operator: 'and', filters: [{ property: 'tags', filter: { operator: 'enum_contains', value: [{ type: 'exact', value: 'Bug' }] } }] }, edits: [{ property: 'log', op: 'set', values: [{ type: 'text', text: 'bug batch' }] }] },
          { id: 'n', type: 'notify', target: { type: 'users', user_ids: [ids.carol, ids.eve] }, message: [{ type: 'text', text: 'Estimate changed on ' }, { type: 'context', key: 'page' }] },
        ],
      },
    });
    tx(ids.bob, [setProp(r2, 'est', [['5']])]); // r2 not in the view (not Done) → skipped
    await engine.flushAutomations();
    expect(rec(r1).properties.log).toBeUndefined();
    tx(ids.bob, [setProp(r2, 'done', [['Yes']]), setProp(r2, 'est', [['6']])]);
    await engine.flushAutomations();
    expect(rec(r1).properties.log).toEqual([['bug batch']]); // only the page matching the filter
    expect(rec(r2).properties.log).toBeUndefined();
    const n = notificationsOf(ids.carol).filter((x) => x.type === 'automation');
    expect(n.length).toBe(1);
    expect(n[0].activity.message).toBe('Estimate changed on B');
    expect(notificationsOf(ids.eve).length).toBe(0); // can't see the page → not notified
    await call(ids.alice, 'deleteAutomation', { automationId: a.automationId });
  });

  it('locked databases do not trigger; permission loss pauses and notifies the creator', async () => {
    const own = makeDatabase(ids.private, { name: 'Bob DB', permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'editor', user_id: ids.bob }] });
    const a = await call(ids.bob, 'saveAutomation', {
      collectionId: own.col,
      automation: { trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] }, actions: [{ id: 's', type: 'edit_property', edits: [{ property: 'log', op: 'set', values: [{ type: 'text', text: 'hi' }] }] }] },
    });
    const host = rec(own.block);
    db.putRecord('block', { ...host, format: { ...host.format, block_locked: true } });
    const r = newId();
    tx(ids.alice, [rowOp(r, own.col, { title: [['Locked']] })]);
    await engine.flushAutomations();
    expect(rec(r).properties.log).toBeUndefined();
    db.putRecord('block', { ...rec(own.block), format: { ...host.format, block_locked: false } });
    const r1 = newId();
    tx(ids.alice, [rowOp(r1, own.col, { title: [['Unlocked']] })]);
    await engine.flushAutomations();
    expect(rec(r1).properties.log).toEqual([['hi']]);
    // bob loses full access to the database
    db.putRecord('block', { ...rec(own.block), permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'read_and_write', user_id: ids.bob }] });
    const r2 = newId();
    tx(ids.alice, [rowOp(r2, own.col, { title: [['After']] })]);
    await engine.flushAutomations();
    expect(rec(r2).properties.log).toBeUndefined();
    expect(automation(a.automationId).status).toBe('paused');
    expect(automation(a.automationId).paused_reason).toBe('permission');
    expect(notificationsOf(ids.bob).some((x) => x.type === 'automation' && x.activity.kind === 'paused')).toBe(true);
  });

  it('webhook: POST to a local receiver with selected properties and headers; failures pause', async () => {
    const a = await call(ids.alice, 'saveAutomation', {
      collectionId: ids.col,
      automation: {
        trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] },
        actions: [{ id: 'w', type: 'webhook', url: `http://127.0.0.1:${receiverPort}/hook`, headers: [{ key: 'X-Token', value: 'abc' }], properties: ['title', 'est'] }],
      },
    });
    const r = newId();
    tx(ids.alice, [rowOp(r, ids.col, { title: [['Hooked']], est: [['3']] })]);
    await engine.flushAutomations();
    expect(received.length).toBe(1);
    expect(received[0].headers['x-token']).toBe('abc');
    expect(received[0].body.source.automation_id).toBe(a.automationId);
    expect(received[0].body.data.properties.Name.title[0].plain_text).toBe('Hooked');
    expect(received[0].body.data.properties.Estimate.number).toBe(3);
    expect(received[0].body.data.properties.Status).toBeUndefined();
    receiverStatus = 500;
    tx(ids.alice, [rowOp(newId(), ids.col, { title: [['Fails']] })]);
    await engine.flushAutomations();
    expect(automation(a.automationId).status).toBe('paused');
    expect(automation(a.automationId).last_error.message).toBe(`127.0.0.1:${receiverPort} returned HTTP 500`);
    receiverStatus = 200;
    // invalid / disallowed targets are refused at save time
    await expect(call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] }, actions: [{ type: 'webhook', url: 'file:///etc/passwd', headers: [], properties: 'all' }] } })).rejects.toThrow('Enter a valid URL');
    await call(ids.alice, 'deleteAutomation', { automationId: a.automationId });
  });
});

describe('recurrence and repeating templates', () => {
  it('"Every day" runs from the scheduler and reschedules', async () => {
    const a = await call(ids.alice, 'saveAutomation', {
      collectionId: ids.col,
      automation: {
        trigger: { type: 'recurrence', recurrence: { frequency: 'day', interval: 1, start: '2020-01-01', time: '09:00', time_zone: 'UTC' } },
        actions: [{ id: 'p', type: 'add_page', collection_id: ids.logCol, edits: [{ property: 'title', op: 'set', values: [{ type: 'text', text: 'Daily standup ' }, { type: 'context', key: 'today' }] }] }],
      },
    });
    const first = automation(a.automationId).next_run_time;
    expect(first).toBeGreaterThan(Date.now());
    expect(scheduler.getJob(engine.jobKey(a.automationId))?.runAt).toBe(first);
    const before = db.childrenOf<any>('block', ids.logCol).length;
    await scheduler.runDueJobs(first + 1000);
    expect(db.childrenOf<any>('block', ids.logCol).length).toBe(before + 1);
    expect(automation(a.automationId).next_run_time).toBeGreaterThan(first);
    expect(automation(a.automationId).recurrence_runs).toBe(1);
    // Edit property can't run on a schedule (no trigger page)
    await expect(call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { trigger: { type: 'recurrence', recurrence: { frequency: 'day', interval: 1, start: '2020-01-01', time: '09:00', time_zone: 'UTC' } }, actions: [{ type: 'edit_property', edits: [{ property: 'done', op: 'set', values: [{ type: 'checkbox', checked: true }] }] }] } })).rejects.toThrow('Choose a target');
    await call(ids.alice, 'deleteAutomation', { automationId: a.automationId });
    expect(scheduler.getJob(engine.jobKey(a.automationId))).toBeNull();
  });

  it('repeating template creates pages from the template without triggering automations', async () => {
    const tpl = newId();
    const child = newId();
    const now = Date.now();
    db.putRecord('block', { id: tpl, version: 1, type: 'page', is_template: true, parent_id: ids.col, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Weekly review']], st: [['Done']] }, content: [child], created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice } as any);
    db.putRecord('block', { id: child, version: 1, type: 'text', parent_id: tpl, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Agenda']] }, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice } as any);
    db.putRecord('collection', { ...db.getRecord<any>('collection', ids.col), template_pages: [tpl] });
    const watcher = await call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] }, actions: [{ id: 'w', type: 'edit_property', edits: [{ property: 'log', op: 'set', values: [{ type: 'text', text: 'saw it' }] }] }] } });
    expect(await status(() => call(ids.eve, 'setTemplateRecurrence', { templateId: tpl, recurrence: { frequency: 'week', interval: 1, weekdays: [1], start: '2020-01-06', time: '08:00', time_zone: 'UTC' } }))).toBe(404);
    const res = await call(ids.bob, 'setTemplateRecurrence', { templateId: tpl, recurrence: { frequency: 'week', interval: 1, weekdays: [1], start: '2020-01-06', time: '08:00', time_zone: 'UTC' } });
    expect(new Date(res.nextRunTime).getUTCDay()).toBe(1);
    const rowsBefore = db.childrenOf<any>('block', ids.col).filter((b) => b.alive && !b.is_template).length;
    await scheduler.runDueJobs(res.nextRunTime + 1);
    await engine.flushAutomations();
    const rows = db.childrenOf<any>('block', ids.col).filter((b) => b.alive && !b.is_template);
    expect(rows.length).toBe(rowsBefore + 1);
    const created = rows.find((b) => b.copied_from === tpl)!;
    expect(created.properties.title).toEqual([['Weekly review']]);
    expect(created.properties.st).toEqual([['Done']]);
    expect(created.created_by_id).toBe(ids.bob);
    expect(rec(created.content[0]).properties.title).toEqual([['Agenda']]);
    expect(created.properties.log).toBeUndefined(); // page added automation did not fire
    // turning repeat off removes the job
    await call(ids.bob, 'setTemplateRecurrence', { templateId: tpl, recurrence: null });
    expect(scheduler.getJob(engine.jobKey(res.automationId))).toBeNull();
    await call(ids.alice, 'deleteAutomation', { automationId: watcher.automationId });
  });
});

describe('button server steps', () => {
  it('notify / webhook steps are read from the stored button and need edit access', async () => {
    const page = ids.teamHome;
    const btn = newId();
    const now = Date.now();
    db.putRecord('block', {
      id: btn, version: 1, type: 'button', parent_id: page, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Ping']] },
      format: { button_automation: { trigger: 'button_clicked', v: 2, actions: [
        { id: 'v', type: 'define_variables', variables: [{ id: 'x', name: 'Variable 1', formula: '"from vars"' }] },
        { id: 'n', type: 'notify', target: { type: 'users', user_ids: [ids.carol] }, message: [{ type: 'text', text: 'Ping ' }, { type: 'variable', step: 'v', variable: 'x' }] },
        { id: 'w', type: 'webhook', url: `http://127.0.0.1:${receiverPort}/btn`, headers: [], properties: 'all' },
      ] } },
      created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice,
    } as any);
    received.length = 0;
    const res = await call(ids.bob, 'runButtonServerSteps', { blockId: btn, stepIds: ['n', 'w'] });
    expect(res.ok).toBe(true);
    const n = notificationsOf(ids.carol).filter((x) => x.activity?.automation_name === 'Ping');
    expect(n.map((x) => x.activity.message)).toEqual(['Ping from vars']);
    expect(received[0].body.source.type).toBe('button');
    expect(await status(() => call(ids.eve, 'runButtonServerSteps', { blockId: btn, stepIds: ['n'] }))).toBe(403);
  });
});

describe('formula schema limit', () => {
  it('a client cannot grow a schema past 1.5MB; shrinking an oversized schema is allowed', async () => {
    const { block: _b, col } = makeDatabase(ids.teamHome, { name: 'Big' });
    const formulaOf = (len: number) => ({ name: 'Long', type: 'formula', version: 'v2', formula2: { code: [['"' + 'x'.repeat(len) + '"']] } });
    const setFx = (len: number) => ({ pointer: { table: 'collection', id: col, spaceId: ids.space }, path: ['schema', 'fx'], command: 'set', args: formulaOf(len) });
    expect(await status(() => tx(ids.alice, [setFx(1000)]))).toBe(200);
    let err = '';
    try { await tx(ids.alice, [setFx(1.6 * 1024 * 1024)]); } catch (e: any) { err = String(e?.message ?? e); }
    expect(err).toMatch(/properties are too large/);
    expect(JSON.stringify(db.getRecord<any>('collection', col).schema.fx).length).toBeLessThan(2000);
    // an existing oversized schema (e.g. imported) can still be reduced
    const c = db.getRecord<any>('collection', col);
    db.putRecord('collection', { ...c, schema: { ...c.schema, fx: formulaOf(1.7 * 1024 * 1024) } });
    expect(await status(() => tx(ids.alice, [setFx(1.6 * 1024 * 1024)]))).toBe(200);
    expect(await status(() => tx(ids.alice, [setFx(10)]))).toBe(200);
  });
});

describe('form responses', () => {
  it('a response triggers Page added and property conditions on its answers', async () => {
    const d = makeDatabase(ids.teamHome, { name: 'Requests' });
    const c = db.getRecord<any>('collection', d.col);
    db.putRecord('collection', { ...c, schema: { ...c.schema, pri: { name: 'Priority', type: 'select', options: [{ id: 'u', value: 'Urgent', color: 'red' }, { id: 'l', value: 'Low', color: 'gray' }] } } });
    const fv = newId();
    const qTitle = { id: newId(), config: { propertyId: 'title' } };
    const qPri = { id: newId(), config: { propertyId: 'pri' } };
    db.putRecord('collection_view', { id: fv, version: 1, type: 'form', name: 'Form', parent_id: d.block, parent_table: 'block', space_id: ids.space, alive: true, format: { collection_pointer: { id: d.col, table: 'collection', spaceId: ids.space }, form_config: { version: 1, questions: [qTitle, qPri], permission: 'space', anonymous: false, submissionAccess: 'none', ownerId: ids.alice } } } as any);
    const host = db.getRecord<any>('block', d.block);
    db.putRecord('block', { ...host, view_ids: [...host.view_ids, fv] });
    const added = await call(ids.alice, 'saveAutomation', {
      collectionId: d.col,
      automation: { trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] }, actions: [{ id: 'a', type: 'edit_property', edits: [{ property: 'st', op: 'set', values: [{ type: 'option', name: 'Not started' }] }] }] },
    });
    const urgent = await call(ids.alice, 'saveAutomation', {
      collectionId: d.col,
      automation: {
        trigger: { type: 'event', mode: 'all', events: [{ type: 'page_added' }, { type: 'property_edited', property: 'pri', condition: { op: 'is', values: ['Urgent'] } }] },
        actions: [{ id: 'n', type: 'notify', target: { type: 'users', user_ids: [ids.carol] }, message: [{ type: 'text', text: 'Urgent request: ' }, { type: 'property', property: 'title' }] }],
      },
    });
    const r1 = await call(ids.bob, 'submitFormResponse', { viewId: fv, answers: { [qTitle.id]: 'Printer on fire', [qPri.id]: 'Urgent' } });
    const r2 = await call(ids.bob, 'submitFormResponse', { viewId: fv, answers: { [qTitle.id]: 'New mouse', [qPri.id]: 'Low' } });
    await engine.flushAutomations();
    expect(rec(r1.pageId).properties.st).toEqual([['Not started']]);
    expect(rec(r2.pageId).properties.st).toEqual([['Not started']]);
    const msgs = notificationsOf(ids.carol).filter((x) => x.activity?.automation_id === urgent.automationId).map((x) => x.activity.message);
    expect(msgs).toEqual(['Urgent request: Printer on fire']);
    await call(ids.alice, 'deleteAutomation', { automationId: added.automationId });
    await call(ids.alice, 'deleteAutomation', { automationId: urgent.automationId });
  });
});

describe('duplicated databases', () => {
  it('duplicating a database page copies its automations onto the copy', async () => {
    const d = makeDatabase(ids.teamHome, { name: 'Pipeline' });
    tx(ids.alice, [rowOp(newId(), d.col, { title: [['Existing deal']] })]);
    await engine.flushAutomations();
    const welcome = await call(ids.alice, 'saveAutomation', {
      collectionId: d.col,
      automation: { name: 'Welcome', trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] }, actions: [{ id: 'w', type: 'edit_property', edits: [{ property: 'log', op: 'set', values: [{ type: 'text', text: 'welcomed' }] }] }] },
    });
    const a = await call(ids.alice, 'saveAutomation', {
      collectionId: d.col,
      automation: {
        name: 'Stage done', scope: { type: 'view', view_id: d.view },
        trigger: { type: 'event', mode: 'any', events: [{ type: 'property_edited', property: 'st', condition: { op: 'is', values: ['Done'] } }] },
        actions: [{ id: 'x', type: 'edit_pages', collection_id: d.col, filter: null, edits: [{ property: 'done', op: 'set', values: [{ type: 'checkbox', checked: true }] }] }],
      },
    });
    const res = await call(ids.bob, 'duplicateBlock', { blockId: d.block });
    const copyBlock = db.getRecord<any>('block', res.blockId);
    expect(copyBlock.collection_id).not.toBe(d.col);
    await engine.flushAutomations();
    // copied rows are not "added" pages: the copied Page added automation leaves them alone
    const copiedRows = db.childrenOf<any>('block', copyBlock.collection_id).filter((b) => b.alive && !b.is_template);
    expect(copiedRows.map((r) => r.properties.log)).toEqual([undefined]);
    const copies = engine.automationsOf(copyBlock.collection_id).filter((x) => x.properties.name === 'Stage done');
    expect(copies).toHaveLength(1);
    expect(engine.automationsOf(copyBlock.collection_id)).toHaveLength(2);
    expect(copies[0].id).not.toBe(a.automationId);
    expect(copies[0].properties.name).toBe('Stage done');
    expect(copies[0].created_by_id).toBe(ids.bob);
    expect(copies[0].status).toBe('active');
    expect((copies[0].actions[0] as any).collection_id).toBe(copyBlock.collection_id);
    expect((copies[0].scope as any).view_id).toBe(copyBlock.view_ids[0]);
    // the original keeps its own
    expect(engine.automationsOf(d.col).map((x) => x.id).sort()).toEqual([welcome.automationId, a.automationId].sort());
    // and the copy runs on the copy
    const row = newId();
    tx(ids.bob, [rowOp(row, copyBlock.collection_id, { title: [['Deal']], st: [['Not started']] }, ids.bob)]);
    await engine.flushAutomations();
    tx(ids.bob, [setProp(row, 'st', [['Done']])]);
    await engine.flushAutomations();
    expect(rec(row).properties.done).toEqual([['Yes']]);
  });
});

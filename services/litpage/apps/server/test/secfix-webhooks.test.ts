// Regression tests: "Send webhook" custom header values are write-only secrets (automations, button blocks,
// button properties), automation records reach people who can't edit the database without webhook details, and old
// stored values are migrated.
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-webhooks-test-'));
process.env.NC_AUTOMATION_WINDOW_MS = '0';
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let engine: typeof import('../src/automations/engine.ts');
let secrets: typeof import('../src/webhookSecrets.ts');
let propaccess: typeof import('../src/propaccess.ts');
let MASK: string;
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
const tx = (user: string, operations: any[]) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });

const schema = { title: { name: 'Name', type: 'title' }, est: { name: 'Estimate', type: 'number' } };

function makeDatabase(parentId: string, permissions?: any[]) {
  const now = Date.now();
  const block = newId();
  const col = newId();
  const view = newId();
  db.putRecord('block', {
    id: block, version: 1, type: 'collection_view_page', parent_id: parentId, parent_table: 'block', space_id: ids.space, alive: true, collection_id: col, view_ids: [view],
    created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice, ...(permissions ? { permissions } : {}),
  } as any);
  db.putRecord('collection', { id: col, version: 1, parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, name: [['Tasks']], schema, template_pages: [] } as any);
  db.putRecord('collection_view', { id: view, version: 1, type: 'table', name: 'Table', parent_id: block, parent_table: 'block', space_id: ids.space, alive: true, format: {}, query2: {} } as any);
  const parent = db.getRecord<any>('block', parentId)!;
  db.putRecord('block', { ...parent, content: [...(parent.content ?? []), block] });
  return { block, col, view };
}

const rowOp = (id: string, collectionId: string, title: string) => {
  const now = Date.now();
  return {
    pointer: { table: 'block', id, spaceId: ids.space }, path: [], command: 'set',
    args: { id, type: 'page', parent_id: collectionId, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [[title]] }, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice },
  };
};

let receiver: Server;
let port = 0;
const received: { url: string; headers: any }[] = [];
/** requests that reached one path of the receiver (webhooks of other tests may still arrive late) */
const got = (path: string) => received.filter((r) => r.url === path);
const secretRows = () => db.db.prepare('SELECT owner, action_id, header, value, origin FROM webhook_secrets').all() as any[];
const hookUrl = (path: string, host = '127.0.0.1') => `http://${host}:${port}${path}`;
const automationRec = (id: string) => db.getRecord<any>('automation', id)!;
const webhookTrigger = { type: 'event', mode: 'any', events: [{ type: 'page_added' }] };

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  engine = await import('../src/automations/engine.ts');
  secrets = await import('../src/webhookSecrets.ts');
  propaccess = await import('../src/propaccess.ts');
  ({ WEBHOOK_SECRET_MASK: MASK } = await import('@nc/shared/automation/index.ts'));
  for (const n of ['alice', 'bob', 'vera', 'gus']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@hooks.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.home = w.team.team_pages[0];
  seed.addMember(ids.space, ids.bob, 'editor');
  seed.addMember(ids.space, ids.vera, 'editor');
  // alice: full access; bob: can edit; vera: can view (member); gus: guest who can view
  ids.private = w.spaceView.private_pages[0];
  const d = makeDatabase(ids.private, [
    { type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'read_and_write', user_id: ids.bob },
    { type: 'user_permission', role: 'reader', user_id: ids.vera }, { type: 'user_permission', role: 'reader', user_id: ids.gus },
  ]);
  ids.block = d.block; ids.col = d.col;
  receiver = createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { received.push({ url: req.url ?? '', headers: req.headers }); res.end('ok'); });
  });
  await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', () => r()));
  port = (receiver.address() as any).port;
});

afterAll(() => {
  receiver?.close();
});

describe('automation webhook headers are write-only secrets', () => {
  it('records keep a placeholder; the server sends the stored value; saving the placeholder keeps it', async () => {
    const res = await call(ids.alice, 'saveAutomation', {
      collectionId: ids.col,
      automation: { trigger: webhookTrigger, actions: [{ id: 'w', type: 'webhook', url: hookUrl('/a'), headers: [{ key: 'Authorization', value: 'Bearer tok-123' }], properties: 'all' }] },
    });
    ids.auto = res.automationId;
    const stored = automationRec(ids.auto);
    expect(stored.actions[0].headers[0]).toMatchObject({ key: 'Authorization', value: MASK });
    expect(JSON.stringify(stored)).not.toContain('tok-123');
    expect(JSON.stringify(res.recordMap)).not.toContain('tok-123');
    expect(secretRows().some((r) => r.value === 'Bearer tok-123')).toBe(true);

    received.length = 0;
    await tx(ids.alice, [rowOp(newId(), ids.col, 'One')]);
    await engine.flushAutomations();
    expect(got('/a').map((r) => r.headers.authorization)).toEqual(['Bearer tok-123']);

    // the editor re-saves the automation unchanged (placeholder) → the value stays
    await call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { id: ids.auto, trigger: webhookTrigger, actions: stored.actions } });
    received.length = 0;
    await tx(ids.alice, [rowOp(newId(), ids.col, 'Two')]);
    await engine.flushAutomations();
    expect(got('/a').map((r) => r.headers.authorization)).toEqual(['Bearer tok-123']);
  });

  it('pointing the webhook at another site needs the value again (no sending a stored token elsewhere)', async () => {
    const actions = automationRec(ids.auto).actions;
    const moved = [{ ...actions[0], url: hookUrl('/b', 'localhost') }];
    expect(await status(() => call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { id: ids.auto, trigger: webhookTrigger, actions: moved } }))).toBe(400);
    // same site, other path: fine
    await call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { id: ids.auto, trigger: webhookTrigger, actions: [{ ...actions[0], url: hookUrl('/c') }] } });
    received.length = 0;
    await tx(ids.alice, [rowOp(newId(), ids.col, 'Three')]);
    await engine.flushAutomations();
    expect(got('/c').map((r) => r.headers.authorization)).toEqual(['Bearer tok-123']);
    // clearing the value removes it
    await call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { id: ids.auto, trigger: webhookTrigger, actions: [{ ...actions[0], url: hookUrl('/c'), headers: [{ key: 'Authorization', value: '' }] }] } });
    expect(secretRows().some((r) => r.owner === `automation:${ids.auto}`)).toBe(false);
    received.length = 0;
    await tx(ids.alice, [rowOp(newId(), ids.col, 'Four')]);
    await engine.flushAutomations();
    expect(got('/c').length).toBe(1);
    expect(got('/c')[0].headers.authorization).toBeUndefined();
  });

  it('only people who can edit the database get webhook destinations (viewers and guests get the automation without them)', async () => {
    await call(ids.alice, 'saveAutomation', { collectionId: ids.col, automation: { id: ids.auto, trigger: webhookTrigger, actions: [{ id: 'w', type: 'webhook', url: hookUrl('/d'), headers: [{ key: 'X-Key', value: 'k-1' }], properties: 'all' }] } });
    const seen = async (user: string) => {
      const r = await call(user, 'getAutomations', { collectionId: ids.col });
      return r.recordMap.automation?.[ids.auto]?.value?.value;
    };
    for (const user of [ids.alice, ids.bob]) {
      const a = await seen(user);
      expect(a.actions[0].url).toBe(hookUrl('/d'));
      expect(a.actions[0].headers[0].value).toBe(MASK);
    }
    for (const user of [ids.vera, ids.gus]) {
      const a = await seen(user);
      expect(a.actions[0].type).toBe('webhook');
      expect(a.actions[0].url).toBe('');
      expect(a.actions[0].headers).toEqual([]);
    }
    // realtime pushes use the same view (no role passed)
    expect((propaccess.redactDatabaseRecord('automation', automationRec(ids.auto), ids.vera) as any).actions[0].url).toBe('');
    expect((propaccess.redactDatabaseRecord('automation', automationRec(ids.auto), ids.bob) as any).actions[0].url).toBe(hookUrl('/d'));
  });

  it('copies keep the values only for people who can edit the original', async () => {
    const dup = await call(ids.alice, 'duplicateAutomation', { automationId: ids.auto });
    expect(secretRows().some((r) => r.owner === `automation:${dup.automationId}` && r.value === 'k-1')).toBe(true);
    await call(ids.alice, 'deleteAutomation', { automationId: dup.automationId });
    const copiedOf = (blockId: string) => {
      const copyCol = db.getRecord<any>('block', blockId)!.collection_id;
      return (db.db.prepare(`SELECT data FROM records WHERE tbl = 'automation' AND parent_id = ?`).all(copyCol) as any[]).map((r) => JSON.parse(r.data));
    };
    // full access to the database: the duplicated database's automation keeps the value
    const mine = copiedOf((await call(ids.alice, 'duplicateBlock', { blockId: ids.block })).blockId);
    expect(mine.length).toBe(1);
    expect(mine[0].actions[0].headers[0].value).toBe(MASK);
    expect(secretRows().some((r) => r.owner === `automation:${mine[0].id}` && r.value === 'k-1')).toBe(true);
    // a viewer duplicating the database into a page of their own (full access there): the copy asks for it again
    const veraPage = newId();
    db.putRecord('block', { id: veraPage, version: 1, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, properties: { title: [['Vera’s notes']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.vera }], created_time: Date.now(), created_by_id: ids.vera, last_edited_time: Date.now(), last_edited_by_id: ids.vera } as any);
    const theirs = copiedOf((await call(ids.vera, 'duplicateBlock', { blockId: ids.block, parentId: veraPage, parentTable: 'block' })).blockId);
    expect(theirs.length).toBe(1);
    expect(theirs[0].actions[0].headers[0].value).toBe('');
    expect(secretRows().some((r) => r.owner === `automation:${theirs[0].id}`)).toBe(false);
  });
});

describe('button webhook headers are write-only secrets', () => {
  it('a button block written by a client keeps a placeholder; clicking sends the stored value', async () => {
    const btn = newId();
    const now = Date.now();
    const button = (headers: any[], url = hookUrl('/btn')) => ({ trigger: 'button_clicked', v: 2, actions: [{ id: 'w', type: 'webhook', url, headers, properties: 'all' }] });
    const res = await tx(ids.alice, [
      {
        pointer: { table: 'block', id: btn, spaceId: ids.space }, path: [], command: 'set',
        args: { id: btn, type: 'button', parent_id: ids.home, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Ping']] }, format: { button_automation: button([{ id: 'h1', key: 'X-Api-Key', value: 'btn-secret' }]) }, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice },
      },
      { pointer: { table: 'block', id: ids.home, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: btn } },
    ]);
    expect(JSON.stringify(res)).not.toContain('btn-secret');
    expect(db.getRecord<any>('block', btn)!.format.button_automation.actions[0].headers[0].value).toBe(MASK);
    received.length = 0;
    expect((await call(ids.bob, 'runButtonServerSteps', { blockId: btn, stepIds: ['w'] })).ok).toBe(true);
    expect(got('/btn').map((r) => r.headers['x-api-key'])).toEqual(['btn-secret']);
    // edits that send the placeholder back (renaming the header keeps its row id) keep the value
    await tx(ids.alice, [{ pointer: { table: 'block', id: btn, spaceId: ids.space }, path: ['format', 'button_automation'], command: 'set', args: button([{ id: 'h1', key: 'X-Key', value: MASK }]) }]);
    received.length = 0;
    await call(ids.bob, 'runButtonServerSteps', { blockId: btn, stepIds: ['w'] });
    expect(got('/btn').map((r) => r.headers['x-key'])).toEqual(['btn-secret']);
    // another site: the stored value is dropped, never sent there
    await tx(ids.alice, [{ pointer: { table: 'block', id: btn, spaceId: ids.space }, path: ['format', 'button_automation'], command: 'set', args: button([{ id: 'h1', key: 'X-Key', value: MASK }], hookUrl('/evil', 'localhost')) }]);
    expect(db.getRecord<any>('block', btn)!.format.button_automation.actions[0].headers[0].value).toBe('');
    received.length = 0;
    await call(ids.bob, 'runButtonServerSteps', { blockId: btn, stepIds: ['w'] });
    expect(got('/evil').length).toBe(1);
    expect(got('/evil')[0].headers['x-key']).toBeUndefined();
  });

  it('a duplicated button keeps the value for its editors only', async () => {
    const btn = newId();
    const now = Date.now();
    await tx(ids.alice, [
      { pointer: { table: 'block', id: btn, spaceId: ids.space }, path: [], command: 'set', args: { id: btn, type: 'button', parent_id: ids.home, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Dup']] }, format: { button_automation: { trigger: 'button_clicked', v: 2, actions: [{ id: 'w', type: 'webhook', url: hookUrl('/dup'), headers: [{ id: 'h9', key: 'X-Dup', value: 'dup-secret' }], properties: 'all' }] } }, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice } },
      { pointer: { table: 'block', id: ids.home, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: btn } },
    ]);
    // a client duplicate (copied_from) by an editor of the page
    const copy = newId();
    const src = db.getRecord<any>('block', btn)!;
    await tx(ids.bob, [
      { pointer: { table: 'block', id: copy, spaceId: ids.space }, path: [], command: 'set', args: { ...src, id: copy, version: undefined, applied_tx_ids: undefined, copied_from: btn, created_by_id: ids.bob, last_edited_by_id: ids.bob } },
      { pointer: { table: 'block', id: ids.home, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: copy, after: btn } },
    ]);
    expect(db.getRecord<any>('block', copy)!.format.button_automation.actions[0].headers[0].value).toBe(MASK);
    received.length = 0;
    expect((await call(ids.bob, 'runButtonServerSteps', { blockId: copy, stepIds: ['w'] })).ok).toBe(true);
    expect(got('/dup').map((r) => r.headers['x-dup'])).toEqual(['dup-secret']);
  });

  it('a button property keeps a placeholder in the schema', async () => {
    await tx(ids.alice, [{
      pointer: { table: 'collection', id: ids.col, spaceId: ids.space }, path: ['schema', 'btn'], command: 'set',
      args: { name: 'Notify', type: 'button', button_automation: { trigger: 'button_clicked', v: 2, actions: [{ id: 'w', type: 'webhook', url: hookUrl('/prop'), headers: [{ id: 'p1', key: 'X-Prop', value: 'prop-secret' }], properties: 'all' }] } },
    }]);
    const col = db.getRecord<any>('collection', ids.col)!;
    expect(col.schema.btn.button_automation.actions[0].headers[0].value).toBe(MASK);
    const row = newId();
    await tx(ids.alice, [rowOp(row, ids.col, 'Row')]);
    received.length = 0;
    expect((await call(ids.bob, 'runButtonServerSteps', { rowId: row, propertyId: 'btn', stepIds: ['w'] })).ok).toBe(true);
    expect(got('/prop').map((r) => r.headers['x-prop'])).toEqual(['prop-secret']);
  });
});

describe('migration of values stored before secrets existed', () => {
  it('moves plain values out of automations, buttons and page history', async () => {
    const a = automationRec(ids.auto);
    db.putRecord('automation', { ...a, actions: [{ ...a.actions[0], headers: [{ key: 'X-Old', value: 'old-automation-secret' }] }] });
    const btn = newId();
    db.putRecord('block', { id: btn, version: 1, type: 'button', parent_id: ids.home, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Old']] }, format: { button_automation: { trigger: 'button_clicked', v: 2, actions: [{ id: 'w', type: 'webhook', url: hookUrl('/old'), headers: [{ key: 'X-Old', value: 'old-button-secret' }], properties: 'all' }] } }, created_time: 1, created_by_id: ids.alice, last_edited_time: 1, last_edited_by_id: ids.alice } as any);
    db.db.prepare('INSERT INTO snapshots (id, page_id, space_id, created_time, author_ids, data) VALUES (?, ?, ?, ?, ?, ?)')
      .run(newId(), ids.home, ids.space, Date.now(), '[]', JSON.stringify({ blocks: [db.getRecord('block', btn)] }));
    expect(secrets.migrateWebhookSecrets()).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(automationRec(ids.auto))).not.toContain('old-automation-secret');
    expect(JSON.stringify(db.getRecord('block', btn))).not.toContain('old-button-secret');
    expect((db.db.prepare(`SELECT COUNT(*) AS n FROM snapshots WHERE data LIKE '%old-button-secret%'`).get() as any).n).toBe(0);
    received.length = 0;
    await call(ids.bob, 'runButtonServerSteps', { blockId: btn, stepIds: ['w'] });
    expect(got('/old').map((r) => r.headers['x-old'])).toEqual(['old-button-secret']);
  });
});

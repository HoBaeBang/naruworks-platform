// Regression test: "Edit pages in" skips rows the automation's creator can't open (they are never edited)
// instead of failing with "The action is missing a target" and pausing the whole automation.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-automations-test-'));
process.env.NC_AUTOMATION_WINDOW_MS = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let engine: typeof import('../src/automations/engine.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
const tx = (user: string, operations: any[]) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
const now = Date.now();
const block = (id: string, extra: Record<string, unknown>) => ({ id, version: 1, alive: true, space_id: ids.space, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner, ...extra });

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  engine = await import('../src/automations/engine.ts');
  for (const n of ['owner', 'builder']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@auto-skip.test`, n);
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  const priv = w.spaceView.private_pages[0];
  seed.addMember(ids.space, ids.builder, 'editor');
  ids.host = newId();
  ids.col = newId();
  db.putRecord('block', block(ids.host, { type: 'collection_view_page', parent_id: priv, parent_table: 'block', collection_id: ids.col, view_ids: [], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'editor', user_id: ids.builder }] }) as any);
  db.putRecord('collection', block(ids.col, { parent_id: ids.host, parent_table: 'block', name: [['Tasks']], template_pages: [], schema: { title: { name: 'Name', type: 'title' }, done: { name: 'Done', type: 'checkbox' } } }) as any);
  const p = db.getRecord<any>('block', priv)!;
  db.putRecord('block', { ...p, content: [...(p.content ?? []), ids.host] });
  ids.open = newId();
  db.putRecord('block', block(ids.open, { type: 'page', parent_id: ids.col, parent_table: 'collection', properties: { title: [['Open row']] } }) as any);
  // a row only the owner can open
  ids.hidden = newId();
  db.putRecord('block', block(ids.hidden, { type: 'page', parent_id: ids.col, parent_table: 'collection', properties: { title: [['Owner only']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }], permissions_unlinked: true }) as any);
});

describe('Edit pages in: rows the creator can’t open', () => {
  it('are skipped, never edited, and the automation keeps running', async () => {
    const a = await call(ids.builder, 'saveAutomation', {
      collectionId: ids.col,
      automation: {
        trigger: { type: 'event', mode: 'any', events: [{ type: 'page_added' }] },
        actions: [{ id: 'e', type: 'edit_pages', collection_id: ids.col, filter: null, edits: [{ property: 'done', op: 'set', values: [{ type: 'checkbox', checked: true }] }] }],
      },
    });
    const added = newId();
    await tx(ids.builder, [{ pointer: { table: 'block', id: added, spaceId: ids.space }, path: [], command: 'set', args: block(added, { type: 'page', parent_id: ids.col, parent_table: 'collection', created_by_id: ids.builder, properties: { title: [['New']] } }) }]);
    await engine.flushAutomations();
    const rec = db.getRecord<any>('automation', a.automationId)!;
    expect(rec.status).toBe('active');
    expect(rec.last_error ?? null).toBeNull();
    expect(db.getRecord<any>('block', ids.open)!.properties.done).toEqual([['Yes']]);
    expect(db.getRecord<any>('block', added)!.properties.done).toEqual([['Yes']]);
    expect(db.getRecord<any>('block', ids.hidden)!.properties.done).toBeUndefined();
  });
});

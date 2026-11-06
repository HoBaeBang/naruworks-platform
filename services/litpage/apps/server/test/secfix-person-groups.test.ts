// Regression test: Person properties hold permission groups too, and their Notifications option "Users and
// groups" notifies the members of a group added to the value ("Users only" doesn't; "None" nobody).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-person-groups-test-'));
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let values: typeof import('@nc/shared/database/index.ts');
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, ip: '127.0.0.1', setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
const tx = (user: string, operations: any[]) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId: ids.space, operations }] });
const mentions = (uid: string) => (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ?`).all(uid) as any[])
  .map((r) => JSON.parse(r.data)).filter((n) => n.type === 'property_mention');

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  values = await import('@nc/shared/database/index.ts');
  for (const n of ['owner', 'designer', 'outsider']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@groups.test`, n);
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  seed.addMember(ids.space, ids.designer, 'editor');
  ids.group = (await call(ids.owner, 'createGroup', { spaceId: ids.space, name: 'Design', memberIds: [ids.designer] })).group.id;
  const now = Date.now();
  ids.host = newId();
  ids.col = newId();
  db.putRecord('block', { id: ids.host, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: ids.col, view_ids: [], permissions: [{ type: 'space_permission', role: 'editor' }], created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner } as any);
  db.putRecord('collection', {
    id: ids.col, version: 1, parent_id: ids.host, parent_table: 'block', space_id: ids.space, alive: true, name: [['Tasks']], template_pages: [],
    schema: { title: { name: 'Name', type: 'title' }, rev: { name: 'Reviewers', type: 'person', notification_mode: 'users_and_groups' }, own: { name: 'Owner', type: 'person' }, cc: { name: 'CC', type: 'person', notification_mode: 'none' } },
  } as any);
  ids.row = newId();
  db.putRecord('block', { id: ids.row, version: 1, type: 'page', parent_id: ids.col, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Spec']] }, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner } as any);
});

describe('Person properties with groups', () => {
  it('decode and encode group values', () => {
    const raw = values.encodePeople([ids.owner], [{ id: ids.group, spaceId: ids.space }]);
    const v = values.getPropertyValue({ properties: { rev: raw } } as any, 'rev', { rev: { name: 'Reviewers', type: 'person' } } as any);
    expect(v).toEqual({ kind: 'person', ids: [ids.owner], groups: [{ id: ids.group, spaceId: ids.space }] });
    expect(values.isEmptyValue({ kind: 'person', ids: [], groups: [{ id: ids.group }] } as any)).toBe(false);
  });

  it('"Users and groups" notifies the group’s members; "Users only" and "None" don’t', async () => {
    const groupValue = values.encodePeople([], [{ id: ids.group, spaceId: ids.space }]);
    await tx(ids.owner, [{ pointer: { table: 'block', id: ids.row }, path: ['properties', 'own'], command: 'set', args: groupValue }]);
    expect(mentions(ids.designer).length).toBe(0);
    await tx(ids.owner, [{ pointer: { table: 'block', id: ids.row }, path: ['properties', 'cc'], command: 'set', args: groupValue }]);
    expect(mentions(ids.designer).length).toBe(0);
    await tx(ids.owner, [{ pointer: { table: 'block', id: ids.row }, path: ['properties', 'rev'], command: 'set', args: groupValue }]);
    const got = mentions(ids.designer);
    expect(got.length).toBe(1);
    expect(got[0].activity).toMatchObject({ property: 'rev', property_name: 'Reviewers' });
    expect(mentions(ids.outsider).length).toBe(0);
  });
});

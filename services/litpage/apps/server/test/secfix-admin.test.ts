// Regression tests: data retention defaults (every plan keeps deleted pages 30 days), Content search ›
// Retained pages, "Restore private pages" move semantics, audit events that were defined but never recorded,
// upgrade / AI service requests cleared when met, and teamspace-level "Disable publishing" taking links down.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-secfix-admin-test-'));
delete process.env.NC_DEV_LOGIN_CODES;
vi.setConfig({ testTimeout: 30_000 });

let H: Record<string, (ctx: any, body: any) => any>;
let app: typeof import('../src/app.ts').app;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let records: typeof import('../src/records.ts');
let retention: typeof import('../src/retention.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, ip: '127.0.0.1', setCookie: () => {} });
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
const now = Date.now();
function page(id: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}) {
  return { id, version: 1, type: 'page', properties: { title: [[`Page ${id.slice(0, 4)}`]] }, parent_id: parentId, parent_table: parentTable, space_id: ids.space, alive: true, created_time: now, created_by_id: ids.owner, last_edited_time: now, last_edited_by_id: ids.owner, ...extra };
}
const setSpace = (patch: Record<string, unknown>, settings?: Record<string, unknown>) => {
  const s = db.getRecord<any>('space', ids.space)!;
  db.putRecord('space', { ...s, ...patch, settings: { ...(s.settings ?? {}), ...(settings ?? {}) } });
};
const svOf = (uid: string) => db.getRecord<any>('user_root', uid)!.space_views.map((v: string) => db.getRecord<any>('space_view', v)).find((v: any) => v?.space_id === ids.space);
const auditEvents = (event: string) => db.db.prepare('SELECT * FROM audit_log WHERE space_id = ? AND event = ?').all(ids.space, event) as any[];

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  ({ app } = await import('../src/app.ts'));
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  records = await import('../src/records.ts');
  retention = await import('../src/retention.ts');
  for (const n of ['owner', 'member', 'visitor']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@admin.test`, n);
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  ids.team = w.team.id;
  seed.addMember(ids.space, ids.member, 'editor');
});

describe('data retention: UI default = server default', () => {
  it('pages deleted from Trash are kept 30 days on every plan; Enterprise picks the number', async () => {
    setSpace({ plan_type: 'plus' });
    const p = newId();
    db.putRecord('block', page(p, ids.space, 'space', { alive: false, deleted_time: now, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.member }], properties: { title: [['Deleted on Plus']] } }) as any);
    await call(ids.member, 'deleteBlocksPermanently', { blockIds: [p] });
    expect(db.getRecord('block', p)).toBeUndefined();
    const kept = retention.listRetained(ids.space, 'Deleted on Plus');
    expect(kept.length).toBe(1);
    expect(Math.round((kept[0].expires - kept[0].deletedTime) / 86_400_000)).toBe(30);
    // Enterprise: the owner's number (and still 30 when unset)
    setSpace({ plan_type: 'enterprise' }, { purge_retention_days: 7 });
    const q = newId();
    db.putRecord('block', page(q, ids.space, 'space', { alive: false, deleted_time: now, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.member }], properties: { title: [['Deleted on Enterprise']] } }) as any);
    await call(ids.member, 'deleteBlocksPermanently', { blockIds: [q] });
    const k2 = retention.listRetained(ids.space, 'Deleted on Enterprise');
    expect(Math.round((k2[0].expires - k2[0].deletedTime) / 86_400_000)).toBe(7);
    setSpace({}, { purge_retention_days: null });
  });

  it('Content search › Retained pages lists them and restores to Private pages', async () => {
    const res = await call(ids.owner, 'searchContentAsAdmin', { spaceId: ids.space, status: 'retained', query: 'Deleted on Plus' });
    const row = res.rows.find((r: any) => r.title === 'Deleted on Plus');
    expect(row).toMatchObject({ retained: true });
    await call(ids.owner, 'adminRestoreRetained', { spaceId: ids.space, retainedId: row.retainedId, to: 'private' });
    const restored = db.getRecord<any>('block', row.pageId)!;
    expect(restored.alive).toBe(true);
    expect(restored.permissions).toEqual([expect.objectContaining({ user_id: ids.owner, role: 'editor' })]);
    expect(svOf(ids.owner).private_pages).toContain(row.pageId);
  });
});

describe('Restore private pages', () => {
  it('is for pages in Trash only, and leaves no sidebar entry behind', async () => {
    // a live workspace-level page: never moved by a restore
    const live = newId();
    db.putRecord('block', page(live, ids.space, 'space') as any);
    setSpace({ pages: [...(db.getRecord<any>('space', ids.space)!.pages ?? []), live] });
    expect(await status(() => call(ids.owner, 'adminRestorePage', { spaceId: ids.space, pageId: live, to: 'private' }))).toBe(400);
    expect(db.getRecord<any>('block', live)!.parent_table).toBe('space');
    // a member's trashed private page that is still listed in their sidebar (and the Workspace section)
    const mine = newId();
    db.putRecord('block', page(mine, ids.space, 'space', { alive: false, deleted_time: now, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.member }] }) as any);
    const msv = svOf(ids.member);
    db.putRecord('space_view', { ...msv, private_pages: [...(msv.private_pages ?? []), mine] });
    setSpace({ pages: [...(db.getRecord<any>('space', ids.space)!.pages ?? []), mine] });
    await call(ids.owner, 'adminRestorePage', { spaceId: ids.space, pageId: mine, to: 'private' });
    expect(svOf(ids.member).private_pages).not.toContain(mine);
    expect(db.getRecord<any>('space', ids.space)!.pages).not.toContain(mine);
    expect(svOf(ids.owner).private_pages).toContain(mine);
    expect(records.blockRole(mine, ids.member)).toBe('none');
  });
});

describe('audit events that were defined but never recorded', () => {
  it('records exports, uploads, form responses and restored data sources', async () => {
    const p = newId();
    db.putRecord('block', page(p, ids.space, 'space', { permissions: [{ type: 'space_permission', role: 'editor' }], properties: { title: [['Quarterly plan']] } }) as any);
    await call(ids.member, 'startPageExport', { blockId: p, format: 'markdown' });
    expect(auditEvents('page_exported').some((e) => e.target_id === p && JSON.parse(e.data).pageName === 'Quarterly plan')).toBe(true);
    await call(ids.member, 'exportWorkspace', { spaceId: ids.space, format: 'markdown' });
    expect(auditEvents('workspace_exported').length).toBe(1);

    const auth = await import('../src/auth.ts');
    const cookie = `lit_session=${auth.createSession(ids.member)}`;
    const up = await app.request(`/api/upload?name=notes.txt&type=text%2Fplain&spaceId=${ids.space}&blockId=${p}`, { method: 'POST', body: 'hello', headers: { cookie, 'content-type': 'text/plain' } });
    expect(up.status).toBe(200);
    const fu = auditEvents('file_uploaded');
    expect(fu.length).toBe(1);
    expect(JSON.parse(fu[0].data)).toMatchObject({ fileName: 'notes.txt', pageName: 'Quarterly plan' });

    // a form response
    const host = newId();
    const col = newId();
    const fv = newId();
    const q = { id: newId(), config: { propertyId: 'title' } };
    db.putRecord('block', page(host, ids.space, 'space', { type: 'collection_view_page', collection_id: col, view_ids: [fv], permissions: [{ type: 'space_permission', role: 'editor' }] }) as any);
    db.putRecord('collection', { id: col, version: 1, parent_id: host, parent_table: 'block', space_id: ids.space, alive: true, name: [['Requests']], schema: { title: { name: 'Name', type: 'title' } }, template_pages: [] } as any);
    db.putRecord('collection_view', { id: fv, version: 1, type: 'form', name: 'Request form', parent_id: host, parent_table: 'block', space_id: ids.space, alive: true, format: { collection_pointer: { id: col, table: 'collection', spaceId: ids.space }, form_config: { version: 1, questions: [q], permission: 'space', anonymous: false, submissionAccess: 'none', ownerId: ids.owner } } } as any);
    await call(ids.member, 'submitFormResponse', { viewId: fv, answers: { [q.id]: 'Laptop' } });
    expect(auditEvents('workspace.form_response.created').some((e) => e.target_id === fv && e.actor_id === ids.member)).toBe(true);

    // a data source moved to Trash and restored
    await tx(ids.member, [{ pointer: { table: 'collection', id: col }, path: ['alive'], command: 'set', args: false }]);
    await tx(ids.member, [{ pointer: { table: 'collection', id: col }, path: ['alive'], command: 'set', args: true }]);
    expect(auditEvents('collection_deleted').some((e) => e.target_id === col)).toBe(true);
    expect(auditEvents('collection_restored').some((e) => e.target_id === col)).toBe(true);
  });
});

describe('plan requests and teamspace publishing', () => {
  it('upgrading clears the requests it meets, Litpage AI requests included', async () => {
    setSpace({ plan_type: 'plus' }, { upgrade_requests: [] });
    await call(ids.member, 'requestUpgrade', { spaceId: ids.space, plan: 'lit_ai' });
    await call(ids.member, 'requestUpgrade', { spaceId: ids.space, plan: 'business' });
    await call(ids.member, 'requestUpgrade', { spaceId: ids.space, plan: 'enterprise' });
    await call(ids.owner, 'changePlan', { spaceId: ids.space, plan: 'business' });
    expect(db.getRecord<any>('space', ids.space)!.settings.upgrade_requests.map((r: any) => r.plan)).toEqual(['enterprise']);
    const notes = (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ?`).all(ids.member) as any[]).map((r) => JSON.parse(r.data));
    expect(notes.filter((n) => JSON.stringify(n).includes('approved')).length).toBeGreaterThanOrEqual(2);
  });

  it('turning publishing off for a teamspace takes its public links down', async () => {
    const p = newId();
    db.putRecord('block', page(p, ids.team, 'team', { permissions: [{ type: 'public_permission', role: 'reader', published: true }] }) as any);
    expect(records.blockRole(p, null)).toBe('reader');
    const team = () => db.getRecord<any>('team', ids.team)!;
    db.putRecord('team', { ...team(), settings: { ...(team().settings ?? {}), disable_public_access: true } });
    expect(records.blockRole(p, null)).toBe('none');
    expect((await call(ids.owner, 'getPublicPages', { spaceId: ids.space })).pages.some((x: any) => x.blockId === p)).toBe(false);
    // a workspace-wide switch with the teamspace explicitly allowed by an owner keeps the link
    setSpace({ disable_public_access: true });
    db.putRecord('team', { ...team(), settings: { ...(team().settings ?? {}), disable_public_access: false } });
    expect(records.blockRole(p, null)).toBe('reader');
    setSpace({ disable_public_access: false });
  });
});

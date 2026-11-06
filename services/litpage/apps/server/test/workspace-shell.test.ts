// Server tests: teamspace access matrix (open / closed / private), teamspace join requests, page access and
// edit-access requests, reminders (time zones, scheduling, firing), notification emails / mail outbox / SMTP client,
// Person-property assignment notifications and page-update digests. Temporary SQLite workspace; handlers called directly.
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ws-test-'));
process.env.NC_EMAIL_DELAY_MS = '300000';
process.env.NC_PAGE_UPDATES_DELAY_MS = '600000';
delete process.env.NC_DEV_LOGIN_CODES;
delete process.env.NC_SMTP_URL;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let records: typeof import('../src/records.ts');
let perms: typeof import('@nc/shared/permissions.ts');
let scheduler: typeof import('../src/scheduler.ts');
let reminders: typeof import('../src/reminders.ts');
let mail: typeof import('../src/mail.ts');
let digests: typeof import('../src/digests.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
const status = async (p: () => unknown): Promise<number> => {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
};
function tx(user: string, operations: any[], spaceId = ids.space) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
}
function notifications(userId: string, type?: string): any[] {
  return (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ? ORDER BY json_extract(data, '$.created_time')`).all(userId) as { data: string }[])
    .map((r) => JSON.parse(r.data))
    .filter((n) => !type || n.type === type);
}
function team(id: string, type: 'open' | 'closed' | 'private', owner: string, extra: Record<string, unknown> = {}) {
  seed.saveRecord('team', {
    id, version: 0, space_id: ids.space, name: `Team ${type}`, team_pages: [], parent_id: ids.space, parent_table: 'space', alive: true,
    membership: [{ user_id: owner, role: 'owner', added_time: 1 }], settings: { type, default_page_role: 'editor' }, created_time: 1, created_by_id: owner, ...extra,
  });
}
function page(id: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}, user = ids.alice) {
  const now = Date.now();
  db.putRecord('block', {
    id, version: 1, type: 'page', properties: { title: [[`Page ${id.slice(0, 4)}`]] }, content: [], parent_id: parentId, parent_table: parentTable, space_id: ids.space,
    alive: true, created_time: now - 3600_000, created_by_id: user, last_edited_time: now, last_edited_by_id: user, ...extra,
  } as any);
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  records = await import('../src/records.ts');
  perms = await import('@nc/shared/permissions.ts');
  scheduler = await import('../src/scheduler.ts');
  reminders = await import('../src/reminders.ts');
  mail = await import('../src/mail.ts');
  digests = await import('../src/digests.ts');
  for (const n of ['alice', 'bob', 'carol', 'gina', 'zed']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@ws.test`, n[0].toUpperCase() + n.slice(1));
  }
  // workspace: alice owner, bob + carol members, gina guest (page share only), zed outsider
  const w = seed.createWorkspace(ids.alice, 'Acme');
  ids.space = w.space.id;
  ids.general = w.team.id;
  seed.addMember(ids.space, ids.bob, 'editor');
  seed.addMember(ids.space, ids.carol, 'editor');
  ids.open = newId();
  ids.closed = newId();
  ids.private = newId();
  team(ids.open, 'open', ids.carol);
  team(ids.closed, 'closed', ids.carol);
  team(ids.private, 'private', ids.carol);
  for (const k of ['open', 'closed', 'private']) {
    ids[`${k}Page`] = newId();
    page(ids[`${k}Page`], ids[k], 'team', {}, ids.carol);
    const t = db.getRecord<any>('team', ids[k])!;
    seed.saveRecord('team', { ...t, team_pages: [ids[`${k}Page`]] });
  }
});

describe('teamspace access matrix', () => {
  it('pages: owners full access, open → workspace members can edit, closed/private → nothing for non-members', () => {
    const role = (pageId: string, user: string) => records.blockRole(pageId, user);
    expect(role(ids.openPage, ids.carol)).toBe('editor');
    expect(role(ids.closedPage, ids.carol)).toBe('editor');
    expect(role(ids.privatePage, ids.carol)).toBe('editor');
    expect(role(ids.openPage, ids.bob)).toBe('read_and_write');
    expect(role(ids.closedPage, ids.bob)).toBe('none');
    expect(role(ids.privatePage, ids.bob)).toBe('none');
    // workspace owner: no automatic content access to closed/private teamspaces
    expect(role(ids.closedPage, ids.alice)).toBe('none');
    // outsiders / guests never get teamspace access
    expect(role(ids.openPage, ids.zed)).toBe('none');
    expect(role(ids.closedPage, ids.zed)).toBe('none');
  });

  it('members get the default page role; open teams honor "everyone else in workspace"', () => {
    const t = db.getRecord<any>('team', ids.open)!;
    seed.saveRecord('team', { ...t, membership: [...t.membership, { user_id: ids.gina, role: 'member', added_time: 2 }], settings: { ...t.settings, default_page_role: 'comment_only', workspace_page_role: 'reader' } });
    const tt = db.getRecord<any>('team', ids.open)!;
    expect(perms.teamPageRole(tt, ids.gina, true)).toBe('comment_only');
    expect(perms.teamPageRole(tt, ids.carol, true)).toBe('editor'); // owner
    expect(records.blockRole(ids.openPage, ids.bob)).toBe('reader');
    seed.saveRecord('team', { ...tt, membership: t.membership, settings: t.settings });
    expect(records.blockRole(ids.openPage, ids.bob)).toBe('read_and_write');
  });

  it('visibility and join mode: open = Join, closed = Request, private hidden', () => {
    const space = db.getRecord<any>('space', ids.space)!;
    const get = (id: string) => db.getRecord<any>('team', id)!;
    expect(perms.teamJoinMode(get(ids.open), space, ids.bob)).toBe('join');
    expect(perms.teamJoinMode(get(ids.closed), space, ids.bob)).toBe('request');
    expect(perms.teamJoinMode(get(ids.private), space, ids.bob)).toBe('none');
    expect(perms.teamJoinMode(get(ids.closed), space, ids.carol)).toBe('member');
    expect(perms.teamVisibleTo(get(ids.closed), space, ids.bob)).toBe(true);
    expect(perms.teamVisibleTo(get(ids.private), space, ids.bob)).toBe(false);
    expect(perms.teamVisibleTo(get(ids.private), space, ids.alice)).toBe(true); // workspace owner manages it
    expect(records.recordRole('team', get(ids.private), ids.bob)).toBe('none');
    expect(records.recordRole('team', get(ids.closed), ids.bob)).not.toBe('none');
  });

  it('server enforcement: no self-join or page creation in closed teams; self-join open teams', async () => {
    const closed = db.getRecord<any>('team', ids.closed)!;
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: closed.id }, path: [], command: 'update', args: { membership: [...closed.membership, { user_id: ids.bob, role: 'member', added_time: 3 }] } }]))).toBe(403);
    const nid = newId();
    expect(await status(() => tx(ids.bob, [
      { pointer: { table: 'block', id: nid }, path: [], command: 'set', args: { id: nid, type: 'page', parent_id: ids.closed, parent_table: 'team', space_id: ids.space, alive: true, properties: { title: [['x']] } } },
      { pointer: { table: 'team', id: ids.closed }, path: ['team_pages'], command: 'listAfter', args: { id: nid } },
    ]))).toBe(403);
    // reading a closed teamspace page is denied too
    const chunk = await call(ids.bob, 'loadPage', { pageId: ids.closedPage });
    expect(chunk.recordMap.block?.[ids.closedPage]).toBeUndefined();
    const open = db.getRecord<any>('team', ids.open)!;
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: open.id }, path: [], command: 'update', args: { membership: [...open.membership, { user_id: ids.bob, role: 'member', added_time: 3 }] } }]))).toBe(200);
    expect(records.blockRole(ids.openPage, ids.bob)).toBe('editor');
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'team', id: open.id }, path: [], command: 'update', args: { membership: open.membership } }]))).toBe(200);
  });
});

describe('teamspace join requests', () => {
  it('closed: request → owners notified → approve adds the member and their sidebar entry', async () => {
    expect(await status(() => call(ids.bob, 'requestJoinTeam', { teamId: ids.open }))).toBe(400);
    expect(await status(() => call(ids.bob, 'requestJoinTeam', { teamId: ids.private }))).toBe(404);
    expect(await status(() => call(ids.zed, 'requestJoinTeam', { teamId: ids.closed }))).toBe(404);
    const r = await call(ids.bob, 'requestJoinTeam', { teamId: ids.closed, message: 'Please let me in' });
    expect(r.requested).toBe(true);
    const again = await call(ids.bob, 'requestJoinTeam', { teamId: ids.closed });
    expect(again.already).toBe(true);
    expect((await call(ids.bob, 'getMyAccessRequests', { spaceId: ids.space })).teamIds).toEqual([ids.closed]);
    const n = notifications(ids.carol, 'team_join_requested');
    expect(n).toHaveLength(1);
    expect(n[0].activity).toMatchObject({ team_id: ids.closed, request_id: r.requestId, status: 'pending', message: 'Please let me in' });
    // only teamspace owners / workspace admins decide
    expect(await status(() => call(ids.gina, 'decideAccessRequest', { requestId: r.requestId, approve: true }))).toBe(403);
    const res = await call(ids.carol, 'decideAccessRequest', { requestId: r.requestId, approve: true });
    expect(res.status).toBe('approved');
    const t = db.getRecord<any>('team', ids.closed)!;
    expect(t.membership.some((m: any) => m.user_id === ids.bob && m.role === 'member')).toBe(true);
    const root = db.getRecord<any>('user_root', ids.bob)!;
    const sv = root.space_views.map((id: string) => db.getRecord<any>('space_view', id)).find((v: any) => v.space_id === ids.space);
    expect(sv.joined_teams).toContain(ids.closed);
    expect(records.blockRole(ids.closedPage, ids.bob)).toBe('editor');
    expect(notifications(ids.carol, 'team_join_requested')[0].activity).toMatchObject({ status: 'approved', resolved_by_id: ids.carol });
    expect(notifications(ids.bob, 'team_join_approved')).toHaveLength(1);
  });

  it('deny keeps them out', async () => {
    const r = await call(ids.gina, 'requestJoinTeam', { teamId: ids.closed }).catch((e: any) => e);
    // gina is not a workspace member: no request possible
    expect(r?.status).toBe(404);
    seed.addMember(ids.space, ids.gina, 'editor');
    const r2 = await call(ids.gina, 'requestJoinTeam', { teamId: ids.closed });
    const res = await call(ids.carol, 'decideAccessRequest', { requestId: r2.requestId, approve: false });
    expect(res.status).toBe('denied');
    expect(records.blockRole(ids.closedPage, ids.gina)).toBe('none');
    expect(notifications(ids.gina, 'team_join_approved')).toHaveLength(0);
  });
});

describe('page access approvals', () => {
  it('no access → request → approver approves with a role → requester gets access + notification', async () => {
    ids.secret = newId();
    page(ids.secret, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }] });
    const st = await call(ids.bob, 'getPageAccessState', { pageId: ids.secret });
    expect(st).toMatchObject({ state: 'no_access', canRequest: true, requested: false, workspaceName: 'Acme' });
    // the no-access screen never leaks the title
    expect(JSON.stringify(st)).not.toContain('Page');
    const r = await call(ids.bob, 'requestPageAccess', { pageId: ids.secret, message: 'Need this for the launch' });
    expect(r.requested).toBe(true);
    expect((await call(ids.bob, 'getPageAccessState', { pageId: ids.secret })).requested).toBe(true);
    const n = notifications(ids.alice, 'access_requested');
    expect(n).toHaveLength(1);
    expect(n[0].activity).toMatchObject({ page_id: ids.secret, kind: 'page_access', message: 'Need this for the launch', external: false, status: 'pending' });
    expect(await status(() => call(ids.bob, 'decideAccessRequest', { requestId: r.requestId, approve: true }))).toBe(403);
    const res = await call(ids.alice, 'decideAccessRequest', { requestId: r.requestId, approve: true, role: 'comment_only' });
    expect(res).toMatchObject({ status: 'approved', role: 'comment_only' });
    expect(records.blockRole(ids.secret, ids.bob)).toBe('comment_only');
    expect(notifications(ids.bob, 'access_granted')[0].activity).toMatchObject({ page_id: ids.secret, role: 'comment_only' });
    expect(notifications(ids.alice, 'access_requested')[0].activity).toMatchObject({ status: 'approved', granted_role: 'comment_only' });
  });

  it('edit access: commenter asks, approver grants Can edit; requests need a reason to exist', async () => {
    const st = await call(ids.bob, 'getPageAccessState', { pageId: ids.secret });
    expect(st).toMatchObject({ state: 'ok', role: 'comment_only', canRequestEdit: true, editRequested: false });
    expect(await status(() => call(ids.alice, 'requestPageAccess', { pageId: ids.secret, kind: 'edit' }))).toBe(400); // already full access
    const r = await call(ids.bob, 'requestPageAccess', { pageId: ids.secret, kind: 'edit' });
    const n = notifications(ids.alice, 'access_requested').find((x) => x.activity.request_id === r.requestId);
    expect(n.activity.kind).toBe('page_edit');
    await call(ids.alice, 'decideAccessRequest', { requestId: r.requestId, approve: true });
    expect(records.blockRole(ids.secret, ids.bob)).toBe('read_and_write');
  });

  it('non-members: allowed by default, blocked when Security › "Allow non-members to request page access" is off', async () => {
    const st = await call(ids.zed, 'getPageAccessState', { pageId: ids.secret });
    expect(st).toMatchObject({ state: 'no_access', canRequest: true, workspaceName: null, isMember: false });
    const space = db.getRecord<any>('space', ids.space)!;
    seed.saveRecord('space', { ...space, settings: { ...space.settings, allow_access_requests: false } });
    expect((await call(ids.zed, 'getPageAccessState', { pageId: ids.secret })).canRequest).toBe(false);
    expect(await status(() => call(ids.zed, 'requestPageAccess', { pageId: ids.secret }))).toBe(403);
    const sp = db.getRecord<any>('space', ids.space)!;
    seed.saveRecord('space', { ...sp, settings: { ...sp.settings, allow_access_requests: true } });
    const r = await call(ids.zed, 'requestPageAccess', { pageId: ids.secret });
    const n = notifications(ids.alice, 'access_requested').find((x) => x.activity.request_id === r.requestId);
    expect(n.activity.external).toBe(true);
    const res = await call(ids.alice, 'decideAccessRequest', { requestId: r.requestId, approve: false });
    expect(res.status).toBe('denied');
    expect(records.blockRole(ids.secret, ids.zed)).toBe('none');
    expect(notifications(ids.zed, 'access_granted')).toHaveLength(0);
    expect(await call(null, 'getPageAccessState', { pageId: ids.secret })).toMatchObject({ state: 'no_access', loggedIn: false, canRequest: false });
    expect(await call(ids.zed, 'getPageAccessState', { pageId: newId() })).toEqual({ state: 'missing' });
  });
});

describe('reminders', () => {
  it('time zones: wall clock in the zone, DST aware', () => {
    expect(new Date(reminders.zonedTimeToUtc(2026, 10, 21, 9, 0, 'Asia/Seoul')).toISOString()).toBe('2026-10-21T00:00:00.000Z');
    expect(new Date(reminders.zonedTimeToUtc(2026, 7, 1, 9, 0, 'America/New_York')).toISOString()).toBe('2026-07-01T13:00:00.000Z');
    expect(new Date(reminders.zonedTimeToUtc(2026, 12, 1, 9, 0, 'America/New_York')).toISOString()).toBe('2026-12-01T14:00:00.000Z');
    expect(new Date(reminders.zonedTimeToUtc(2026, 3, 1, 9, 0, 'Not/AZone')).toISOString()).toBe('2026-03-01T09:00:00.000Z');
    const at = (v: any, tz = 'Asia/Seoul') => new Date(reminders.reminderFireTime(v, tz)!).toISOString();
    expect(at({ type: 'date', start_date: '2026-10-22', reminder: { unit: 'day', value: 1, time: '09:00' } })).toBe('2026-10-21T00:00:00.000Z');
    expect(at({ type: 'datetime', start_date: '2026-10-22', start_time: '15:30', reminder: { unit: 'minute', value: 30 } })).toBe('2026-10-22T06:00:00.000Z');
    expect(at({ type: 'datetime', start_date: '2026-10-22', start_time: '15:30', time_zone: 'Europe/London', reminder: { unit: 'hour', value: 1 } })).toBe('2026-10-22T13:30:00.000Z');
    expect(at({ type: 'date', start_date: '2026-10-29', reminder: { unit: 'week', value: 1, time: '08:15' } }, 'UTC')).toBe('2026-10-22T08:15:00.000Z');
  });

  it('@remind in page text: scheduled on save, rescheduled on edit, fires once, cancelled on delete', async () => {
    const tomorrow = new Date(Date.now() + 2 * 86_400_000);
    const ymd = `${tomorrow.getUTCFullYear()}-${String(tomorrow.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrow.getUTCDate()).padStart(2, '0')}`;
    const pageId = newId();
    page(pageId, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.bob }] }, ids.bob);
    const blockId = newId();
    const date = (time: string) => ({ type: 'datetime', start_date: ymd, start_time: time, time_zone: 'UTC', reminder: { unit: 'minute', value: 0 } });
    const text = (time: string) => [['Ship it '], ['‣', [['d', date(time)]]]];
    await tx(ids.bob, [
      { pointer: { table: 'block', id: blockId }, path: [], command: 'set', args: { id: blockId, type: 'text', parent_id: pageId, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: text('10:00') } } },
      { pointer: { table: 'block', id: pageId }, path: ['content'], command: 'listAfter', args: { id: blockId } },
    ]);
    let jobs = scheduler.listJobs(`reminder:${blockId}:`);
    expect(jobs).toHaveLength(1);
    expect(new Date(jobs[0].runAt).toISOString()).toBe(`${ymd}T10:00:00.000Z`);
    expect(jobs[0].payload.ownerId).toBe(ids.bob);
    // editing the time reschedules (one job), unrelated edits keep it
    await tx(ids.bob, [{ pointer: { table: 'block', id: blockId }, path: ['properties', 'title'], command: 'set', args: text('11:30') }]);
    jobs = scheduler.listJobs(`reminder:${blockId}:`);
    expect(jobs.map((j) => new Date(j.runAt).toISOString())).toEqual([`${ymd}T11:30:00.000Z`]);
    // fire
    const before = notifications(ids.bob, 'reminder').length;
    await scheduler.runDueJobs(jobs[0].runAt + 1000);
    const fired = notifications(ids.bob, 'reminder');
    expect(fired.length).toBe(before + 1);
    expect(fired.at(-1).activity).toMatchObject({ page_id: pageId, kind: 'reminder' });
    expect(fired.at(-1).activity.text).toContain('Ship it');
    expect(scheduler.listJobs(`reminder:${blockId}:`)).toHaveLength(0);
    // a later unrelated edit does not re-arm a delivered reminder
    await tx(ids.bob, [{ pointer: { table: 'block', id: blockId }, path: ['properties', 'title'], command: 'set', args: [['Ship it! '], ['‣', [['d', date('11:30')]]]] }]);
    expect(scheduler.listJobs(`reminder:${blockId}:`)).toHaveLength(0);
    // new time → new job; deleting the block cancels it
    await tx(ids.bob, [{ pointer: { table: 'block', id: blockId }, path: ['properties', 'title'], command: 'set', args: text('12:00') }]);
    expect(scheduler.listJobs(`reminder:${blockId}:`)).toHaveLength(1);
    await tx(ids.bob, [{ pointer: { table: 'block', id: blockId }, path: [], command: 'update', args: { alive: false } }]);
    expect(scheduler.listJobs(`reminder:${blockId}:`)).toHaveLength(0);
  });

  it('@mention + @remind reminds the mentioned person; past reminders are never scheduled', async () => {
    const pageId = newId();
    page(pageId, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.bob }, { type: 'user_permission', role: 'reader', user_id: ids.carol }] }, ids.bob);
    const blockId = newId();
    const soon = new Date(Date.now() + 3 * 86_400_000);
    const ymd = soon.toISOString().slice(0, 10);
    await tx(ids.bob, [
      { pointer: { table: 'block', id: blockId }, path: [], command: 'set', args: { id: blockId, type: 'text', parent_id: pageId, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['‣', [['u', ids.carol]]], [' review '], ['‣', [['d', { type: 'date', start_date: ymd, reminder: { unit: 'day', value: 0, time: '09:00' } }]]]] } } },
      { pointer: { table: 'block', id: pageId }, path: ['content'], command: 'listAfter', args: { id: blockId } },
    ]);
    const [job] = scheduler.listJobs(`reminder:${blockId}:`);
    const carolBefore = notifications(ids.carol, 'reminder').length;
    const bobBefore = notifications(ids.bob, 'reminder').length;
    await scheduler.runDueJobs(job.runAt + 1);
    expect(notifications(ids.carol, 'reminder').length).toBe(carolBefore + 1);
    expect(notifications(ids.bob, 'reminder').length).toBe(bobBefore);
    const pastId = newId();
    await tx(ids.bob, [
      { pointer: { table: 'block', id: pastId }, path: [], command: 'set', args: { id: pastId, type: 'text', parent_id: pageId, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['‣', [['d', { type: 'date', start_date: '2020-01-01', reminder: { unit: 'day', value: 0, time: '09:00' } }]]]] } } },
      { pointer: { table: 'block', id: pageId }, path: ['content'], command: 'listAfter', args: { id: pastId } },
    ]);
    expect(scheduler.listJobs(`reminder:${pastId}:`)).toHaveLength(0);
  });

  it('database Date property reminders (cell value and the property default) notify the person who set them', async () => {
    const dbBlock = newId();
    const colId = newId();
    page(dbBlock, ids.space, 'space', { type: 'collection_view_page', collection_id: colId, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.bob }] }, ids.bob);
    db.putRecord('collection', { id: colId, version: 1, schema: { title: { name: 'Name', type: 'title' }, due: { name: 'Due', type: 'date' } }, parent_id: dbBlock, parent_table: 'block', alive: true, space_id: ids.space } as any);
    const row = newId();
    const ymd = new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
    await tx(ids.bob, [{ pointer: { table: 'block', id: row }, path: [], command: 'set', args: { id: row, type: 'page', parent_id: colId, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Launch']], due: [['‣', [['d', { type: 'date', start_date: ymd, reminder: { unit: 'day', value: 1, time: '09:00' } }]]]] } } }]);
    const [job] = scheduler.listJobs(`reminder:${row}:`);
    expect(job).toBeTruthy();
    await scheduler.runDueJobs(job.runAt + 1);
    const n = notifications(ids.bob, 'reminder').at(-1);
    expect(n.activity).toMatchObject({ page_id: row, property: 'due', property_name: 'Due' });
    // property default notification: rows without their own reminder get one
    const row2 = newId();
    await tx(ids.bob, [{ pointer: { table: 'block', id: row2 }, path: [], command: 'set', args: { id: row2, type: 'page', parent_id: colId, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Retro']], due: [['‣', [['d', { type: 'date', start_date: ymd }]]]] } } }]);
    expect(scheduler.listJobs(`reminder:${row2}:`)).toHaveLength(0);
    await tx(ids.bob, [{ pointer: { table: 'collection', id: colId }, path: ['schema', 'due'], command: 'update', args: { default_reminder: { unit: 'day', value: 0, time: '09:00' } } }]);
    expect(scheduler.listJobs(`reminder:${row2}:`)).toHaveLength(1);
    await tx(ids.bob, [{ pointer: { table: 'collection', id: colId }, path: ['schema', 'due'], command: 'update', args: { default_reminder: null } }]);
    expect(scheduler.listJobs(`reminder:${row2}:`)).toHaveLength(0);
  });
});

describe('notification emails and the mail outbox', () => {
  it('"Activity in my workspace": emailed after the delay when still unread; off → none; Always → immediately', async () => {
    const pageId = newId();
    page(pageId, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'editor', user_id: ids.carol }] });
    const notify = await import('../src/notify.ts');
    const n = notify.pushNotification({ user_id: ids.carol, space_id: ids.space, type: 'mention', navigable_block_id: pageId, actor_id: ids.alice, activity: { page_id: pageId, text: 'hello <b>' } });
    expect(mail.listMail({ to: 'carol@ws.test', kind: 'notification:mention' })).toHaveLength(0);
    await scheduler.runDueJobs(Date.now() + 301_000);
    const sent = mail.listMail({ to: 'carol@ws.test', kind: 'notification:mention' });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(`Alice tagged you on Page ${pageId.slice(0, 4)}`);
    expect(sent[0].html).toContain('hello &lt;b&gt;');
    expect(sent[0].status).toBe('stored'); // no SMTP in tests
    // read in Litpage before the delay → no email
    const n2 = notify.pushNotification({ user_id: ids.carol, space_id: ids.space, type: 'comment', navigable_block_id: pageId, actor_id: ids.alice, activity: { page_id: pageId, text: 'later' } });
    seed.saveRecord('notification', { ...db.getRecord<any>('notification', n2.id), read: true });
    await scheduler.runDueJobs(Date.now() + 301_000);
    expect(mail.listMail({ to: 'carol@ws.test', kind: 'notification:comment' })).toHaveLength(0);
    // settings: off
    const us = db.getRecord<any>('user_settings', ids.carol)!;
    seed.saveRecord('user_settings', { ...us, settings: { ...us.settings, email_activity: false } });
    notify.pushNotification({ user_id: ids.carol, space_id: ids.space, type: 'mention', navigable_block_id: pageId, actor_id: ids.alice, activity: { page_id: pageId } });
    await scheduler.runDueJobs(Date.now() + 301_000);
    expect(mail.listMail({ to: 'carol@ws.test', kind: 'notification:mention' })).toHaveLength(1);
    // always
    seed.saveRecord('user_settings', { ...us, settings: { ...us.settings, email_activity: true, email_always: true } });
    notify.pushNotification({ user_id: ids.carol, space_id: ids.space, type: 'reminder', navigable_block_id: pageId, actor_id: ids.carol, activity: { page_id: pageId, date_text: 'Oct 21, 2026' } });
    await scheduler.runDueJobs(Date.now() + 1000);
    expect(mail.listMail({ to: 'carol@ws.test', kind: 'notification:reminder' })[0].subject).toBe(`Reminder for Page ${pageId.slice(0, 4)}`);
    void n;
  });

  it('login codes and workspace invites are mailed; login codes are marked sensitive', async () => {
    await call(null, 'sendSignInCode', { email: 'newbie@ws.test' });
    const m = mail.listMail({ to: 'newbie@ws.test', kind: 'login_code' });
    expect(m).toHaveLength(1);
    expect(m[0].subject).toMatch(/^Litpage sign-in code: \d{6}$/);
    await call(ids.alice, 'inviteMembers', { spaceId: ids.space, emails: ['invitee@ws.test'] });
    expect(mail.listMail({ to: 'invitee@ws.test', kind: 'workspace_invite' })[0].subject).toBe('Alice asked you to join Acme');
    // page invite to an unknown address: placeholder account + immediate email
    await call(ids.alice, 'invitePagePermissions', { pageId: ids.secret, emails: ['outside@else.test'], role: 'reader' });
    await scheduler.runDueJobs(Date.now() + 1000);
    expect(mail.listMail({ to: 'outside@else.test', kind: 'notification:invite' })[0].subject).toBe(`Alice gave you access to Page ${ids.secret.slice(0, 4)}`);
  });

  it('SMTP client speaks the protocol (local fake server; never in normal runs)', async () => {
    const transcript: string[] = [];
    const server = createServer((sock) => {
      let data = false;
      sock.write('220 fake ESMTP\r\n');
      let buf = '';
      sock.on('data', (chunk) => {
        buf += chunk.toString();
        let i: number;
        while ((i = buf.indexOf('\r\n')) >= 0) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 2);
          transcript.push(line);
          if (data) {
            if (line === '.') { data = false; sock.write('250 queued\r\n'); }
            continue;
          }
          if (line.startsWith('EHLO')) sock.write('250-fake\r\n250 AUTH PLAIN\r\n');
          else if (line.startsWith('AUTH PLAIN')) sock.write('235 ok\r\n');
          else if (line.startsWith('MAIL FROM') || line.startsWith('RCPT TO')) sock.write('250 ok\r\n');
          else if (line === 'DATA') { data = true; sock.write('354 go\r\n'); }
          else if (line === 'QUIT') { sock.write('221 bye\r\n'); sock.end(); }
        }
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as any).port;
    await mail.deliver({ host: '127.0.0.1', port, secure: false, user: 'u', pass: 'p', from: 'Litpage <notify@example.test>', insecure: true },
      { id: 'm1', to: 'x@example.test', subject: 'Hé', text: 'line\n.dot', html: '<p>hi</p>' });
    server.close();
    expect(transcript.some((l) => l.startsWith('EHLO'))).toBe(true);
    expect(transcript).toContain('MAIL FROM:<notify@example.test>');
    expect(transcript).toContain('RCPT TO:<x@example.test>');
    expect(transcript.some((l) => l === 'Subject: =?UTF-8?B?SMOp?=')).toBe(true);
    expect(transcript).toContain('.');
    // credentials are never sent without TLS unless explicitly allowed
    await expect(mail.deliver({ host: '127.0.0.1', port: 1, secure: false, user: 'u', pass: 'p', from: 'a@b.c', insecure: false }, { id: 'm2', to: 'x@example.test', subject: 's', text: 't', html: 'h' })).rejects.toThrow();
  });
});

describe('database activity notifications', () => {
  it('adding someone to a Person property notifies them (unless the property says None)', async () => {
    const dbBlock = newId();
    const colId = newId();
    page(dbBlock, ids.space, 'space', { type: 'collection_view_page', collection_id: colId, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.bob }, { type: 'user_permission', role: 'read_and_write', user_id: ids.carol }] }, ids.bob);
    db.putRecord('collection', { id: colId, version: 1, schema: { title: { name: 'Name', type: 'title' }, owner: { name: 'Assignee', type: 'person' }, quiet: { name: 'Watchers', type: 'person', notification_mode: 'none' } }, parent_id: dbBlock, parent_table: 'block', alive: true, space_id: ids.space } as any);
    const row = newId();
    await tx(ids.bob, [{ pointer: { table: 'block', id: row }, path: [], command: 'set', args: { id: row, type: 'page', parent_id: colId, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [['Task']] } } }]);
    const before = notifications(ids.carol, 'property_mention').length;
    await tx(ids.bob, [{ pointer: { table: 'block', id: row }, path: ['properties', 'owner'], command: 'set', args: [['‣', [['u', ids.carol]]]] }]);
    const n = notifications(ids.carol, 'property_mention');
    expect(n.length).toBe(before + 1);
    expect(n.at(-1).activity).toMatchObject({ page_id: row, property: 'owner', property_name: 'Assignee' });
    await tx(ids.bob, [{ pointer: { table: 'block', id: row }, path: ['properties', 'quiet'], command: 'set', args: [['‣', [['u', ids.carol]]]] }]);
    expect(notifications(ids.carol, 'property_mention').length).toBe(before + 1);
    // "Notify me › Important updates" on the row: status/person/date changes only
    await call(ids.carol, 'setPageNotifySettings', { pageId: row, level: 'important_updates' });
    const ups = notifications(ids.carol, 'page_edit').length;
    await tx(ids.bob, [{ pointer: { table: 'block', id: row }, path: ['properties', 'title'], command: 'set', args: [['Task 2']] }]);
    expect(notifications(ids.carol, 'page_edit').length).toBe(ups);
    await tx(ids.bob, [{ pointer: { table: 'block', id: row }, path: ['properties', 'owner'], command: 'set', args: [['‣', [['u', ids.bob]]]] }]);
    expect(notifications(ids.carol, 'page_edit').length).toBe(ups + 1);
    // …and every comment on the row, like "All comments"
    const disc = newId();
    const cid = newId();
    await tx(ids.bob, [
      { pointer: { table: 'discussion', id: disc }, path: [], command: 'set', args: { id: disc, parent_id: row, parent_table: 'block', space_id: ids.space, resolved: false, comments: [cid], alive: true } },
      { pointer: { table: 'comment', id: cid }, path: [], command: 'set', args: { id: cid, parent_id: disc, parent_table: 'discussion', space_id: ids.space, text: [['Looks good']], alive: true, created_by_id: ids.bob, created_time: Date.now() } },
      { pointer: { table: 'block', id: row }, path: ['discussions'], command: 'listAfter', args: { id: disc } },
    ]);
    const commentsBefore = notifications(ids.carol).filter((x) => x.type === 'comment' || x.type === 'reply').length;
    await call(ids.bob, 'notifyComment', { commentId: cid });
    expect(notifications(ids.carol).filter((x) => x.type === 'comment' || x.type === 'reply').length).toBe(commentsBefore + 1);
  });

  it('page updates digest: queued for creators/followers, mailed once after the delay', async () => {
    const pageId = newId();
    page(pageId, ids.space, 'space', { created_time: Date.now() - 86_400_000, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'read_and_write', user_id: ids.bob }] });
    const blockId = newId();
    await tx(ids.bob, [
      { pointer: { table: 'block', id: blockId }, path: [], command: 'set', args: { id: blockId, type: 'text', parent_id: pageId, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['edit by bob']] } } },
      { pointer: { table: 'block', id: pageId }, path: ['content'], command: 'listAfter', args: { id: blockId } },
    ]);
    expect(scheduler.getJob(`page-updates:${ids.alice}:${ids.space}`)).toBeTruthy();
    await scheduler.runDueJobs(Date.now() + 601_000);
    const m = mail.listMail({ to: 'alice@ws.test', kind: 'page_updates' });
    expect(m).toHaveLength(1);
    expect(m[0].text).toContain('Bob');
    expect(digests.sendPageUpdates(ids.alice, ids.space)).toBe(0); // queue drained
  });

  it('jobs are persisted rows: a scheduled job survives (re)loading', () => {
    scheduler.scheduleJob('test-kind', 'test:persist', Date.now() + 10_000, { a: 1 });
    const row = db.db.prepare('SELECT kind, payload FROM scheduled_jobs WHERE key = ?').get('test:persist') as any;
    expect(row.kind).toBe('test-kind');
    expect(JSON.parse(row.payload)).toEqual({ a: 1 });
    scheduler.cancelJob('test:persist');
  });
});

describe('sharing: groups and restricted sub-pages', () => {
  it('group_permission grants its role to group members (workspace members only)', async () => {
    const pageId = newId();
    page(pageId, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }] });
    const space = db.getRecord<any>('space', ids.space)!;
    seed.saveRecord('space', { ...space, settings: { ...space.settings, groups: [{ id: 'g-design', name: 'Design', member_ids: [ids.carol, ids.zed], created_time: 1, created_by_id: ids.alice }] } });
    expect(records.blockRole(pageId, ids.carol)).toBe('none');
    await call(ids.alice, 'invitePagePermissions', { pageId, groupIds: ['g-design'], role: 'comment_only' });
    expect(records.blockRole(pageId, ids.carol)).toBe('comment_only');
    expect(records.blockRole(pageId, ids.zed)).toBe('none'); // in the group but not a workspace member
    const sharing = await call(ids.alice, 'getPageSharing', { pageId });
    expect(sharing.groups).toEqual([expect.objectContaining({ groupId: 'g-design', name: 'Design', role: 'comment_only' })]);
    expect(notifications(ids.carol, 'invite').some((n) => n.navigable_block_id === pageId)).toBe(true);
    // groups of another workspace are ignored
    await expect(call(ids.alice, 'invitePagePermissions', { pageId, groupIds: ['nope'] })).rejects.toThrow();
  });

  it('restricting a sub-page stops inheritance; restore re-links it', async () => {
    const parent = newId();
    const child = newId();
    page(parent, ids.space, 'space', { content: [child], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.alice }, { type: 'user_permission', role: 'read_and_write', user_id: ids.bob }, { type: 'user_permission', role: 'reader', user_id: ids.carol }] });
    page(child, parent, 'block');
    expect(records.blockRole(child, ids.bob)).toBe('read_and_write');
    expect(await status(() => call(ids.bob, 'restrictPageAccess', { pageId: child, removeUserId: ids.carol }))).toBe(403); // needs full access
    expect(await status(() => tx(ids.bob, [{ pointer: { table: 'block', id: child }, path: [], command: 'update', args: { permissions_unlinked: true } }]))).toBe(403);
    await call(ids.alice, 'restrictPageAccess', { pageId: child, removeUserId: ids.carol });
    expect(records.blockRole(child, ids.carol)).toBe('none');
    expect(records.blockRole(child, ids.bob)).toBe('read_and_write');
    expect(records.blockRole(child, ids.alice)).toBe('editor');
    expect(records.blockRole(parent, ids.carol)).toBe('reader'); // the parent is unchanged
    // later sharing on the parent no longer reaches the restricted child
    const pr = db.getRecord<any>('block', parent)!;
    seed.saveRecord('block', { ...pr, permissions: [...pr.permissions, { type: 'user_permission', role: 'editor', user_id: ids.gina }] });
    expect(records.blockRole(child, ids.gina)).toBe('none');
    expect((await call(ids.alice, 'getPageSharing', { pageId: child })).unlinked).toBe(true);
    await call(ids.alice, 'restoreInheritedAccess', { pageId: child });
    expect(records.blockRole(child, ids.carol)).toBe('reader');
    expect(records.blockRole(child, ids.gina)).toBe('editor');
  });

  it('restricting a teamspace page keeps teamspace members (team_permission)', async () => {
    const tid = newId();
    team(tid, 'open', ids.alice, { membership: [{ user_id: ids.alice, role: 'owner', added_time: 1 }, { user_id: ids.bob, role: 'member', added_time: 1 }] });
    const top = newId();
    const sub = newId();
    page(top, tid, 'team', { content: [sub] });
    page(sub, top, 'block');
    seed.saveRecord('team', { ...db.getRecord<any>('team', tid), team_pages: [top] });
    await call(ids.alice, 'restrictPageAccess', { pageId: sub });
    expect(records.blockRole(sub, ids.bob)).toBe('editor'); // via team_permission (default page role)
    expect(records.blockRole(sub, ids.carol)).toBe('read_and_write'); // open teamspace: everyone else in the workspace
    const sharing = await call(ids.alice, 'getPageSharing', { pageId: sub });
    expect(sharing.unlinkedFrom).toMatchObject({ kind: 'page', id: top });
  });

  it('"Change and unlink": one inherited person’s role, or general access → Only people invited', async () => {
    const tid = newId();
    team(tid, 'open', ids.alice, { membership: [{ user_id: ids.alice, role: 'owner', added_time: 1 }, { user_id: ids.bob, role: 'member', added_time: 1 }] });
    const top = newId();
    const a = newId();
    const b = newId();
    page(top, tid, 'team', { content: [a, b], permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.zed }] });
    page(a, top, 'block');
    page(b, top, 'block');
    seed.saveRecord('team', { ...db.getRecord<any>('team', tid), team_pages: [top] });
    expect(records.blockRole(a, ids.zed)).toBe('editor');
    const r = await call(ids.alice, 'restrictPageAccess', { pageId: a, userId: ids.zed, role: 'reader' });
    expect(r.recordMap.block[a]).toBeTruthy();
    expect(records.blockRole(a, ids.zed)).toBe('reader');
    expect(records.blockRole(top, ids.zed)).toBe('editor');
    // the caller can't lower their own access this way
    await call(ids.alice, 'restrictPageAccess', { pageId: a, userId: ids.alice, role: 'reader' });
    expect(records.blockRole(a, ids.alice)).toBe('editor');
    // teamspace page → "Only people invited": teamspace members and the rest of the workspace lose access
    await call(ids.alice, 'restrictPageAccess', { pageId: b, general: 'private' });
    expect(records.blockRole(b, ids.bob)).toBe('none');
    expect(records.blockRole(b, ids.carol)).toBe('none');
    expect(records.blockRole(b, ids.zed)).toBe('editor'); // a guest invited on the parent page
    expect(records.blockRole(b, ids.alice)).toBe('editor');
    expect((await call(ids.alice, 'getPageSharing', { pageId: b })).unlinkedFrom).toMatchObject({ kind: 'page', id: top });
    await call(ids.alice, 'restoreInheritedAccess', { pageId: b });
    expect(records.blockRole(b, ids.bob)).toBe('editor');
  });
});

describe('teamspaces: turn a page into a teamspace', () => {
  it('only teamspace owners (or workspace admins); everyone with access becomes a member', async () => {
    const tid = newId();
    team(tid, 'closed', ids.alice, { membership: [{ user_id: ids.alice, role: 'owner', added_time: 1 }, { user_id: ids.bob, role: 'member', added_time: 1 }] });
    const top = newId();
    page(top, tid, 'team', {}, ids.alice);
    seed.saveRecord('team', { ...db.getRecord<any>('team', tid), team_pages: [top] });
    for (const u of [ids.alice, ids.bob]) {
      const sv = db.getRecord<any>('user_root', u)!.space_views.map((id: string) => db.getRecord<any>('space_view', id)).find((v: any) => v.space_id === ids.space);
      seed.saveRecord('space_view', { ...sv, joined_teams: [...sv.joined_teams, tid] });
    }
    expect(await status(() => call(ids.bob, 'createTeamFromPage', { pageId: top }))).toBe(403);
    const r = await call(ids.alice, 'createTeamFromPage', { pageId: top });
    const nt = db.getRecord<any>('team', r.teamId)!;
    expect(nt.team_pages).toEqual([top]);
    expect(nt.membership.map((m: any) => m.user_id).sort()).toEqual([ids.alice, ids.bob].sort());
    expect(db.getRecord<any>('team', tid)!.team_pages).toEqual([]);
    expect(db.getRecord<any>('block', top)!.parent_id).toBe(r.teamId);
    const bobSv = db.getRecord<any>('user_root', ids.bob)!.space_views.map((id: string) => db.getRecord<any>('space_view', id)).find((v: any) => v.space_id === ids.space);
    expect(bobSv.joined_teams).toContain(r.teamId);
  });
});

describe('inbox, people and accounts endpoints', () => {
  it('Archive read archives only read items; guest notifications show in my inbox', async () => {
    const notify = await import('../src/notify.ts');
    const a = notify.pushNotification({ user_id: ids.bob, space_id: ids.space, type: 'mention', actor_id: ids.alice, activity: {} });
    const b = notify.pushNotification({ user_id: ids.bob, space_id: ids.space, type: 'mention', actor_id: ids.alice, activity: {} });
    seed.saveRecord('notification', { ...db.getRecord<any>('notification', a.id), read: true });
    await call(ids.bob, 'archiveReadNotifications', { spaceId: ids.space });
    expect(db.getRecord<any>('notification', a.id)!.archived).toBe(true);
    expect(db.getRecord<any>('notification', b.id)!.archived).toBe(false);
    // a notification from a workspace bob is only a guest in appears in his own workspace's inbox
    const other = seed.createWorkspace(ids.zed, 'Elsewhere');
    const g = notify.pushNotification({ user_id: ids.bob, space_id: other.space.id, type: 'invite', actor_id: ids.zed, activity: {} });
    const inbox = await call(ids.bob, 'getInbox', { spaceId: ids.space, status: 'all' });
    expect(inbox.notificationIds).toContain(g.id);
  });

  it('people directory / profile / search are for workspace members only', async () => {
    expect(await status(() => call(ids.zed, 'getPeopleDirectory', { spaceId: ids.space }))).toBe(404);
    const dir = await call(ids.bob, 'getPeopleDirectory', { spaceId: ids.space, includeGuests: true });
    const roles = Object.fromEntries(dir.people.map((p: any) => [p.userId, p.role]));
    expect(roles[ids.alice]).toBe('owner');
    expect(roles[ids.bob]).toBe('member');
    const prof = await call(ids.bob, 'getPersonProfile', { spaceId: ids.space, userId: ids.carol, withActivity: true });
    expect(prof.profile.teams.map((t: any) => t.id)).toEqual(expect.arrayContaining([ids.open]));
    expect(prof.profile.teams.map((t: any) => t.id)).not.toContain(ids.private); // private teamspace hidden from bob
    const found = await call(ids.bob, 'searchPeople', { spaceId: ids.space, query: 'car' });
    expect(found.userIds).toEqual([ids.carol]);
    // Recent activity: pages carol edited that bob can open — hidden when "Show recent activity" is off
    const edited = newId();
    page(edited, ids.open, 'team', {}, ids.carol);
    const withAct = await call(ids.bob, 'getPersonProfile', { spaceId: ids.space, userId: ids.carol, withActivity: true });
    expect(withAct.recentPages.map((x: any) => x.pageId)).toContain(edited);
    const sp0 = db.getRecord<any>('space', ids.space)!;
    seed.saveRecord('space', { ...sp0, settings: { ...sp0.settings, people_activity_enabled: false } });
    const noAct = await call(ids.bob, 'getPersonProfile', { spaceId: ids.space, userId: ids.carol, withActivity: true });
    expect(noAct.activityEnabled).toBe(false);
    expect(noAct.recentPages).toEqual([]);
    expect(noAct.recordMap.block?.[edited]).toBeUndefined();
    seed.saveRecord('space', { ...db.getRecord<any>('space', ids.space)!, settings: { ...sp0.settings, people_activity_enabled: true } });
    // owners can turn hover cards / profiles off
    const sp = db.getRecord<any>('space', ids.space)!;
    seed.saveRecord('space', { ...sp, settings: { ...sp.settings, people_profiles_enabled: false } });
    expect((await call(ids.bob, 'getPeopleDirectory', { spaceId: ids.space })).disabled).toBe(true);
    seed.saveRecord('space', { ...db.getRecord<any>('space', ids.space)!, settings: { ...sp.settings, people_profiles_enabled: true } });
  });

  it('multi-account cookie: list, switch, never expose tokens; join workspaces open to my domain', async () => {
    const auth = await import('../src/auth.ts');
    const tAlice = auth.createSession(ids.alice);
    const tBob = auth.createSession(ids.bob);
    const cookies: string[] = [];
    const c = (token: string, cookie = '') => ({ userId: auth.userForToken(token), token, cookie, setCookie: (x: string) => cookies.push(x) });
    await H.beginAddAccount(c(tAlice), {});
    const remembered = cookies.find((x) => x.startsWith('nc_accounts='))!;
    expect(remembered).toMatch(/HttpOnly/);
    const jar = remembered.split(';')[0];
    const acc = await H.getAccounts(c(tBob, jar), {});
    expect(acc.accounts.map((x: any) => x.userId).sort()).toEqual([ids.alice, ids.bob].sort());
    expect(JSON.stringify(acc)).not.toContain(tAlice);
    cookies.length = 0;
    await H.switchAccount(c(tBob, jar), { userId: ids.alice });
    expect(cookies.some((x) => x.startsWith(`lit_session=${tAlice}`))).toBe(true);
    // a forged cookie with someone else's (unknown) token does nothing
    expect(() => H.switchAccount(c(tBob, 'nc_accounts=deadbeefdeadbeefdeadbeef'), { userId: ids.carol })).toThrow();
    // allowed email domains
    const sp = db.getRecord<any>('space', ids.space)!;
    seed.saveRecord('space', { ...sp, settings: { ...sp.settings, allowed_email_domains: ['corp.test'] } });
    const dana = newId();
    seed.createUser(dana, 'dana@corp.test', 'Dana');
    const j = await call(dana, 'getJoinableWorkspaces', {});
    expect(j.spaces.map((x: any) => x.id)).toContain(ids.space);
    await call(dana, 'joinWorkspace', { spaceId: ids.space });
    expect(perms.isSpaceMember(db.getRecord<any>('space', ids.space), dana)).toBe(true);
    expect(await status(() => call(ids.zed, 'joinWorkspace', { spaceId: ids.space }))).toBe(403);
  });
});

describe('guest invitation approvals', () => {
  it('members request, owners approve; the guest gets the page and the requester hears back', async () => {
    const pageId = newId();
    page(pageId, ids.space, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.bob }] }, ids.bob);
    const sp = db.getRecord<any>('space', ids.space)!;
    seed.saveRecord('space', { ...sp, disable_guests: true, settings: { ...sp.settings, allow_guest_invite_requests: false } });
    expect(await status(() => call(ids.bob, 'requestGuestInvite', { pageId, emails: ['ext@out.test'] }))).toBe(403);
    seed.saveRecord('space', { ...db.getRecord<any>('space', ids.space)!, settings: { ...sp.settings, allow_guest_invite_requests: true } });
    const r = await call(ids.bob, 'requestGuestInvite', { pageId, emails: ['ext@out.test'], role: 'comment_only' });
    const n = notifications(ids.alice, 'access_requested').find((x) => x.activity.request_id === r.requestId);
    expect(n.activity).toMatchObject({ kind: 'guest_invite', for_emails: ['ext@out.test'], status: 'pending' });
    // the owner has no access to bob's page, yet sees the request in the inbox (without the page)
    const inbox = await call(ids.alice, 'getInbox', { spaceId: ids.space, status: 'all' });
    expect(inbox.notificationIds).toContain(n.id);
    expect(inbox.recordMap.block?.[pageId]).toBeUndefined();
    expect((await call(ids.alice, 'getWorkspaceRequests', { spaceId: ids.space })).requests.map((x: any) => x.id)).toContain(r.requestId);
    expect(await status(() => call(ids.carol, 'getWorkspaceRequests', { spaceId: ids.space }))).toBe(403);
    expect(await status(() => call(ids.carol, 'decideAccessRequest', { requestId: r.requestId, approve: true }))).toBe(403);
    await call(ids.alice, 'decideAccessRequest', { requestId: r.requestId, approve: true });
    const ext = db.findUserIdByEmail('ext@out.test')!;
    expect(records.blockRole(pageId, ext)).toBe('comment_only');
    expect(notifications(ids.bob, 'access_granted').some((x) => x.activity.kind === 'guest_invite' && x.activity.status === 'approved')).toBe(true);
    expect(notifications(ext, 'invite').length).toBe(1);
    seed.saveRecord('space', { ...db.getRecord<any>('space', ids.space)!, disable_guests: false });
  });
});

describe('guest limits', () => {
  it('a Free workspace stops at 10 guests', async () => {
    const w = seed.createWorkspace(ids.carol, 'Tiny');
    seed.saveRecord('space', { ...db.getRecord<any>('space', w.space.id)!, plan_type: 'free' });
    const pageId = w.spaceView.private_pages[0];
    const emails = Array.from({ length: 10 }, (_, i) => `g${i}@guests.test`);
    await call(ids.carol, 'invitePagePermissions', { pageId, emails, role: 'reader' });
    expect(await status(() => call(ids.carol, 'invitePagePermissions', { pageId, emails: ['eleventh@guests.test'], role: 'reader' }))).toBe(403);
    // re-inviting an existing guest is fine
    expect(await status(() => call(ids.carol, 'invitePagePermissions', { pageId, emails: ['g1@guests.test'], role: 'comment_only' }))).toBe(200);
  });
});

// Public REST API (v1) and internal connections: token auth + Litpage-Version,
// per-page grants (no access without a grant, descendants inherited, unlinked pages cut), capabilities, cross-workspace
// isolation, restricted members / guests, database property access rules and row visibility, locks, pagination,
// filters / sorts, comments, Markdown content endpoints, connection webhooks (verification + signed events).
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-public-api-test-'));
process.env.NC_CONNECTION_WEBHOOKS = '1';
process.env.NC_DEV_ALLOW_LOOPBACK_FETCH = '1';
process.env.NC_WEBHOOK_AGGREGATE_MS = '20';
process.env.NC_WEBHOOK_RETRY_MS = '20';
vi.setConfig({ testTimeout: 30_000 });

let app: typeof import('../src/app.ts')['app'];
let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let store: typeof import('../src/publicApi/store.ts');
let webhooks: typeof import('../src/publicApi/webhooks.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const tokens = {} as Record<string, string>;
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

async function api(token: string | null, method: string, path: string, body?: unknown, version: string | null = '2026-10-01') {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (version) headers['lit-version'] = version;
  const res = await app.request(`/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any, headers: res.headers };
}

const now = Date.now();
function block(id: string, type: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}, spaceId = ids.space, user = ids.owner) {
  return {
    id, version: 1, type, parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true,
    created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user, ...extra,
  } as any;
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  app = (await import('../src/app.ts')).app;
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  store = await import('../src/publicApi/store.ts');
  webhooks = await import('../src/publicApi/webhooks.ts');

  for (const n of ['owner', 'member', 'editor', 'restricted', 'guest', 'outsider']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@api.test`, n[0].toUpperCase() + n.slice(1));
  }
  const w = seed.createWorkspace(ids.owner, 'Acme');
  ids.space = w.space.id;
  seed.addMember(ids.space, ids.member, 'editor');
  seed.addMember(ids.space, ids.editor, 'editor');
  seed.addMember(ids.space, ids.restricted, 'restricted_member');
  // a restricted member who isn't in the (open) default teamspace
  const team = db.getRecord<any>('team', w.team.id)!;
  db.putRecord('team', { ...team, version: team.version + 1, membership: team.membership.filter((m: any) => m.user_id !== ids.restricted) });
  const other = seed.createWorkspace(ids.outsider, 'Other');
  ids.otherSpace = other.space.id;

  // Projects (shared with the connection) > Spec (child); Secret (not shared); Restricted child (unlinked)
  const perms = [{ type: 'user_permission', role: 'editor', user_id: ids.owner }, { type: 'user_permission', role: 'read_and_write', user_id: ids.editor }, { type: 'user_permission', role: 'editor', user_id: ids.restricted }];
  ids.projects = newId();
  ids.spec = newId();
  ids.para = newId();
  ids.unlinked = newId();
  ids.secret = newId();
  db.putRecord('block', block(ids.projects, 'page', ids.space, 'space', { properties: { title: [['Projects']] }, content: [ids.spec, ids.para, ids.unlinked], permissions: perms }));
  db.putRecord('block', block(ids.spec, 'page', ids.projects, 'block', { properties: { title: [['Spec']] } }));
  db.putRecord('block', block(ids.para, 'text', ids.projects, 'block', { properties: { title: [['Hello ', [['b']]], ['world']] } }));
  db.putRecord('block', block(ids.unlinked, 'page', ids.projects, 'block', { properties: { title: [['Private child']] }, permissions_unlinked: true, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }] }));
  db.putRecord('block', block(ids.secret, 'page', ids.space, 'space', { properties: { title: [['Secret']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.owner }] }));
  // a database inside Projects: Name, Status (select), Salary (No access rule), Owner (person) + 3 rows
  ids.db = newId();
  ids.col = newId();
  ids.view = newId();
  ids.status = 'stat';
  ids.salary = 'sal1';
  db.putRecord('block', { ...db.getRecord('block', ids.projects)!, content: [ids.spec, ids.para, ids.unlinked, ids.db] } as any);
  db.putRecord('block', block(ids.db, 'collection_view', ids.projects, 'block', { collection_id: ids.col, view_ids: [ids.view] }));
  db.putRecord('collection', {
    id: ids.col, version: 1, parent_id: ids.db, parent_table: 'block', alive: true, space_id: ids.space, name: [['Tasks']],
    schema: {
      title: { name: 'Name', type: 'title' },
      [ids.status]: { name: 'Status', type: 'select', options: [{ id: 'o1', value: 'Todo', color: 'gray' }, { id: 'o2', value: 'Done', color: 'green' }] },
      [ids.salary]: { name: 'Salary', type: 'number', property_permissions: { default_access: 'none' } },
      pts: { name: 'Points', type: 'number' },
    },
  } as any);
  db.putRecord('collection_view', { id: ids.view, version: 1, type: 'table', parent_id: ids.db, parent_table: 'block', alive: true, space_id: ids.space, page_sort: [] } as any);
  for (const [i, [name, st, pts]] of ([['Alpha', 'Todo', 3], ['Beta', 'Done', 5], ['Gamma', 'Done', 1]] as const).entries()) {
    const rid = newId();
    ids[`row${i}`] = rid;
    db.putRecord('block', { ...block(rid, 'page', ids.col, 'collection', { properties: { title: [[name]], [ids.status]: [[st]], [ids.salary]: [['1000']], pts: [[String(pts)]] } }), created_time: now + i } as any);
  }
  // a page in another workspace
  ids.foreign = newId();
  db.putRecord('block', block(ids.foreign, 'page', ids.otherSpace, 'space', { properties: { title: [['Foreign']] }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.outsider }] }, ids.otherSpace, ids.outsider));
});

describe('connections: creation rules and tokens', () => {
  it('members create a connection, the token is shown once and stored hashed', async () => {
    const r = await call(ids.owner, 'devCreateConnection', { spaceId: ids.space, name: 'Sync bot' });
    expect(r.token).toMatch(/^lp_int_[0-9A-Za-z]{43}$/);
    expect(r.connection.tokenPrefix).toBe(r.token.slice(0, 10));
    ids.conn = r.connection.id;
    tokens.full = r.token;
    const row = db.db.prepare('SELECT token_hash FROM api_integrations WHERE id = ?').get(ids.conn) as any;
    expect(row.token_hash).not.toContain(r.token);
    expect(row.token_hash).toBe(store.sha256(r.token));
    const list = await call(ids.member, 'devListConnections', { spaceId: ids.space });
    expect(list.connections.map((c: any) => c.id)).toContain(ids.conn);
    expect(JSON.stringify(list)).not.toContain(r.token);
  });

  it('guests, outsiders and restricted members cannot create connections', async () => {
    expect(await status(() => call(ids.outsider, 'devCreateConnection', { spaceId: ids.space, name: 'x' }))).toBe(404);
    expect(await status(() => call(ids.restricted, 'devCreateConnection', { spaceId: ids.space, name: 'x' }))).toBe(403);
    expect(() => store.createIntegration({ spaceId: ids.space, userId: ids.guest, name: 'x' })).toThrow();
  });

  it('a connection needs a capability and a name', async () => {
    expect(await status(() => call(ids.owner, 'devCreateConnection', { spaceId: ids.space, name: 'none', capabilities: { read_content: false, update_content: false, insert_content: false, read_comments: false, insert_comments: false, user_info: 'none' } }))).toBe(400);
    expect(await status(() => call(ids.owner, 'devCreateConnection', { spaceId: ids.space, name: '  ' }))).toBe(400);
  });

  it('a read-only connection and a comments-only one', async () => {
    const ro = await call(ids.member, 'devCreateConnection', { spaceId: ids.space, name: 'Reader', capabilities: { read_content: true, update_content: false, insert_content: false, read_comments: false, insert_comments: false, user_info: 'none' } });
    ids.ro = ro.connection.id;
    tokens.ro = ro.token;
    expect(ro.connection.ownerId).toBe(ids.member);
    // only the owner (or a workspace admin) manages it
    expect(await status(() => call(ids.editor, 'devUpdateConnection', { connectionId: ids.ro, name: 'Hijack' }))).toBe(403);
    expect((await call(ids.owner, 'devUpdateConnection', { connectionId: ids.ro, name: 'Reader 2' })).connection.name).toBe('Reader 2');
  });
});

describe('/v1 auth, version, errors', () => {
  it('rejects invalid tokens and validates the optional Litpage-Version header', async () => {
    const a = await api(null, 'GET', '/users/me');
    expect(a.status).toBe(401);
    expect(a.json).toMatchObject({ object: 'error', status: 401, code: 'unauthorized' });
    expect(a.json.request_id).toBeTruthy();
    const b = await api('lp_int_doesnotexist0000000000000000000000000000000', 'GET', '/users/me');
    expect(b.json.code).toBe('unauthorized');
    const c = await api(tokens.full, 'GET', '/users/me', undefined, null);
    expect(c.status).toBe(200);
    expect(c.json.type).toBe('bot');
    const unsupported = await api(tokens.full, 'GET', '/users/me', undefined, '2026-09-30');
    expect(unsupported.status).toBe(400);
    expect(unsupported.json.code).toBe('validation_error');
    expect(unsupported.json.message).toContain('2026-10-01');
    const d = await api(tokens.full, 'GET', '/nope');
    expect(d.json.code).toBe('invalid_request_url');
    const e = await app.request('/v1/pages', { method: 'POST', headers: { authorization: `Bearer ${tokens.full}`, 'lit-version': '2026-10-01', 'content-type': 'application/json' }, body: '{bad' });
    expect((await e.json() as any).code).toBe('invalid_json');
  });

  it('users/me is the connection’s bot', async () => {
    const r = await api(tokens.full, 'GET', '/users/me');
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ object: 'user', type: 'bot', name: 'Sync bot', bot: { owner: { type: 'workspace', workspace: true }, workspace_name: 'Acme' } });
  });
});

describe('per-page grants', () => {
  it('nothing is reachable before a page is shared with the connection', async () => {
    const r = await api(tokens.full, 'GET', `/pages/${ids.projects}`);
    expect(r.status).toBe(404);
    expect(r.json.code).toBe('object_not_found');
    const s = await api(tokens.full, 'POST', '/search', {});
    expect(s.json.results).toHaveLength(0);
  });

  it('adding a connection needs full access to the page', async () => {
    expect(await status(() => call(ids.editor, 'devAddPageConnection', { pageId: ids.projects, connectionId: ids.conn }))).toBe(403);
    expect(await status(() => call(ids.owner, 'devAddPageConnection', { pageId: ids.foreign, connectionId: ids.conn }))).toBe(403);
    const r = await call(ids.owner, 'devAddPageConnection', { pageId: ids.projects, connectionId: ids.conn });
    expect(r.connections.map((c: any) => c.integrationId)).toContain(ids.conn);
    await call(ids.owner, 'devAddPageConnection', { pageId: ids.projects, connectionId: ids.ro });
  });

  it('shared pages and their descendants are readable; unshared and unlinked ones are not', async () => {
    expect((await api(tokens.full, 'GET', `/pages/${ids.projects}`)).status).toBe(200);
    const spec = await api(tokens.full, 'GET', `/pages/${ids.spec.replace(/-/g, '')}`);
    expect(spec.status).toBe(200);
    expect(spec.json).toMatchObject({ object: 'page', id: ids.spec, parent: { type: 'page_id', page_id: ids.projects }, properties: { title: { type: 'title' } } });
    expect(spec.json.properties.title.title[0].plain_text).toBe('Spec');
    expect((await api(tokens.full, 'GET', `/pages/${ids.secret}`)).status).toBe(404);
    expect((await api(tokens.full, 'GET', `/pages/${ids.unlinked}`)).status).toBe(404);
    expect((await api(tokens.full, 'GET', `/pages/${ids.foreign}`)).status).toBe(404);
    // children list skips the unlinked page
    const kids = await api(tokens.full, 'GET', `/blocks/${ids.projects}/children`);
    expect(kids.json.object).toBe('list');
    expect(kids.json.results.map((b: any) => b.id)).not.toContain(ids.unlinked);
    const para = kids.json.results.find((b: any) => b.id === ids.para);
    expect(para.type).toBe('paragraph');
    expect(para.paragraph.rich_text[0]).toMatchObject({ type: 'text', plain_text: 'Hello ', annotations: { bold: true } });
  });

  it('page ••• › Connections lists direct and inherited access', async () => {
    const r = await call(ids.owner, 'devPageConnections', { pageId: ids.spec });
    const c = r.connections.find((x: any) => x.integrationId === ids.conn);
    expect(c).toMatchObject({ direct: false, sourceId: ids.projects });
    expect(await status(() => call(ids.owner, 'devRemovePageConnection', { pageId: ids.spec, connectionId: ids.conn }))).toBe(400);
  });

  it('search returns only reachable pages and databases', async () => {
    const all = await api(tokens.full, 'POST', '/search', { page_size: 100 });
    const got = all.json.results.map((r: any) => r.id);
    expect(got).toEqual(expect.arrayContaining([ids.projects, ids.spec, ids.row0]));
    expect(got).not.toContain(ids.secret);
    expect(got).not.toContain(ids.unlinked);
    const ds = await api(tokens.full, 'POST', '/search', { query: 'task', filter: { property: 'object', value: 'data_source' } });
    expect(ds.json.results).toHaveLength(1);
    expect(ds.json.results[0]).toMatchObject({ object: 'data_source', id: ids.col });
    const paged = await api(tokens.full, 'POST', '/search', { page_size: 2 });
    expect(paged.json.has_more).toBe(true);
    const next = await api(tokens.full, 'POST', '/search', { page_size: 2, start_cursor: paged.json.next_cursor });
    expect(next.json.results[0].id).toBe(paged.json.next_cursor);
  });
});

describe('capabilities', () => {
  it('a read-only connection can read but not write', async () => {
    expect((await api(tokens.ro, 'GET', `/pages/${ids.spec}`)).status).toBe(200);
    const w = await api(tokens.ro, 'PATCH', `/pages/${ids.spec}`, { properties: { title: { title: [{ text: { content: 'X' } }] } } });
    expect(w.status).toBe(403);
    expect(w.json.code).toBe('forbidden');
    expect((await api(tokens.ro, 'POST', '/pages', { parent: { page_id: ids.projects }, properties: { title: { title: [{ text: { content: 'x' } }] } } })).status).toBe(403);
    expect((await api(tokens.ro, 'GET', '/users')).status).toBe(403); // no user information
    expect((await api(tokens.ro, 'GET', `/comments?block_id=${ids.projects}`)).status).toBe(403);
  });

  it('user information without emails', async () => {
    const r = await api(tokens.full, 'GET', '/users');
    const owner = r.json.results.find((u: any) => u.id === ids.owner);
    expect(owner).toMatchObject({ type: 'person', name: 'Owner' });
    expect(owner.person.email).toBeUndefined();
    await call(ids.owner, 'devUpdateConnection', { connectionId: ids.conn, capabilities: { user_info: 'with_email' } });
    const r2 = await api(tokens.full, 'GET', `/users/${ids.owner}`);
    expect(r2.json.person.email).toBe('owner@api.test');
    expect((await api(tokens.full, 'GET', `/users/${ids.outsider}`)).status).toBe(404);
  });
});

describe('pages and blocks: writes', () => {
  it('creates a page with children under a shared page and appends / updates / deletes blocks', async () => {
    const r = await api(tokens.full, 'POST', '/pages', {
      parent: { page_id: ids.projects }, icon: { emoji: '🚀' },
      properties: { title: { title: [{ text: { content: 'From the API' } }] } },
      children: [
        { object: 'block', type: 'heading_2', heading_2: { rich_text: [{ text: { content: 'Goals' } }] } },
        { type: 'to_do', to_do: { rich_text: [{ text: { content: 'Ship' } }], checked: true } },
        { type: 'paragraph', paragraph: { rich_text: [{ type: 'mention', mention: { type: 'page', page: { id: ids.spec } } }] } },
      ],
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ object: 'page', icon: { type: 'emoji', emoji: '🚀' }, created_by: { id: store.getIntegration(ids.conn)!.botId } });
    ids.apiPage = r.json.id;
    const kids = await api(tokens.full, 'GET', `/blocks/${ids.apiPage}/children`);
    expect(kids.json.results.map((b: any) => b.type)).toEqual(['heading_2', 'to_do', 'paragraph']);
    expect(kids.json.results[1].to_do.checked).toBe(true);
    expect(kids.json.results[2].paragraph.rich_text[0]).toMatchObject({ type: 'mention', mention: { type: 'page', page: { id: ids.spec } }, plain_text: 'Spec' });
    // the stored records are ordinary blocks authored by the bot
    expect(db.getRecord<any>('block', ids.apiPage)!.created_by_id).toBe(store.getIntegration(ids.conn)!.botId);
    const app2 = await api(tokens.full, 'PATCH', `/blocks/${ids.apiPage}/children`, { children: [{ type: 'quote', quote: { rich_text: [{ text: { content: 'Q' } }] } }] });
    expect(app2.json.results[0].type).toBe('quote');
    const qid = app2.json.results[0].id;
    const up = await api(tokens.full, 'PATCH', `/blocks/${qid}`, { quote: { rich_text: [{ text: { content: 'Quoted', link: { url: 'https://docs.litpage.dev' } } }], color: 'red' } });
    expect(up.json.quote.color).toBe('red');
    expect(up.json.quote.rich_text[0].href).toBe('https://docs.litpage.dev');
    const del = await api(tokens.full, 'DELETE', `/blocks/${qid}`);
    expect(del.json.in_trash).toBe(true);
    expect(db.getRecord<any>('block', qid)!.alive).toBe(false);
  });

  it('refuses mentions of pages the connection can’t see and unsafe links', async () => {
    const r = await api(tokens.full, 'PATCH', `/blocks/${ids.apiPage}/children`, { children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'mention', mention: { page: { id: ids.secret } } }] } }] });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe('validation_error');
    const j = await api(tokens.full, 'PATCH', `/blocks/${ids.apiPage}/children`, { children: [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'x', link: { url: 'javascript:alert(1)' } } }] } }] });
    expect(j.status).toBe(400);
    const deep = { type: 'toggle', toggle: { rich_text: [], children: [{ type: 'toggle', toggle: { rich_text: [], children: [{ type: 'toggle', toggle: { rich_text: [], children: [{ type: 'paragraph', paragraph: { rich_text: [] } }] } }] } }] } };
    expect((await api(tokens.full, 'PATCH', `/blocks/${ids.apiPage}/children`, { children: [deep] })).status).toBe(400);
  });

  it('archives and restores a page; can’t write to unshared pages', async () => {
    const a = await api(tokens.full, 'PATCH', `/pages/${ids.apiPage}`, { in_trash: true });
    expect(a.json).toMatchObject({ in_trash: true, archived: true });
    const b = await api(tokens.full, 'PATCH', `/pages/${ids.apiPage}`, { in_trash: false });
    expect(b.json.in_trash).toBe(false);
    expect((db.getRecord<any>('block', ids.projects)!.content as string[])).toContain(ids.apiPage);
    expect((await api(tokens.full, 'PATCH', `/pages/${ids.secret}`, { in_trash: true })).status).toBe(404);
    expect((await api(tokens.full, 'POST', '/pages', { parent: { page_id: ids.secret }, properties: {} })).status).toBe(404);
    // internal connections can't create workspace-level pages
    expect((await api(tokens.full, 'POST', '/pages', { parent: { workspace: true }, properties: {} })).status).toBe(400);
  });
});

describe('databases, rows, property access, locks', () => {
  it('the data source hides "No access" properties and their values', async () => {
    const ds = await api(tokens.full, 'GET', `/data_sources/${ids.col}`);
    expect(ds.status).toBe(200);
    expect(Object.keys(ds.json.properties).sort()).toEqual(['Name', 'Points', 'Status']);
    const dbo = await api(tokens.full, 'GET', `/databases/${ids.db}`);
    expect(dbo.json).toMatchObject({ object: 'database', data_sources: [{ id: ids.col, name: 'Tasks' }], is_inline: true });
    const row = await api(tokens.full, 'GET', `/pages/${ids.row0}`);
    expect(row.json.parent).toEqual({ type: 'data_source_id', data_source_id: ids.col, database_id: ids.db });
    expect(row.json.properties.Salary).toBeUndefined();
    expect(row.json.properties.Status.select.name).toBe('Todo');
    const md = await api(tokens.full, 'GET', `/pages/${ids.projects}/markdown`);
    expect(md.json.markdown).toContain('Tasks');
    expect(md.json.markdown).not.toContain('1000');
  });

  it('queries with filters, sorts and pagination; filtering on a hidden property is refused', async () => {
    const q = await api(tokens.full, 'POST', `/data_sources/${ids.col}/query`, { filter: { property: 'Status', select: { equals: 'Done' } }, sorts: [{ property: 'Points', direction: 'descending' }] });
    expect(q.status).toBe(200);
    expect(q.json.results.map((r: any) => r.properties.Name.title[0].plain_text)).toEqual(['Beta', 'Gamma']);
    const and = await api(tokens.full, 'POST', `/databases/${ids.db}/query`, { filter: { and: [{ property: 'Points', number: { greater_than: 1 } }, { property: 'Name', title: { contains: 'a' } }] } });
    expect(and.json.results).toHaveLength(2);
    const page1 = await api(tokens.full, 'POST', `/data_sources/${ids.col}/query`, { page_size: 1, sorts: [{ timestamp: 'created_time', direction: 'ascending' }] });
    expect(page1.json.results[0].id).toBe(ids.row0);
    expect(page1.json.has_more).toBe(true);
    const page2 = await api(tokens.full, 'POST', `/data_sources/${ids.col}/query`, { page_size: 1, start_cursor: page1.json.next_cursor, sorts: [{ timestamp: 'created_time', direction: 'ascending' }] });
    expect(page2.json.results[0].id).toBe(ids.row1);
    const hidden = await api(tokens.full, 'POST', `/data_sources/${ids.col}/query`, { filter: { property: 'Salary', number: { greater_than: 0 } } });
    expect(hidden.status).toBe(400);
    expect(hidden.json.code).toBe('validation_error');
  });

  it('creates and updates rows (new select options); hidden properties can’t be written', async () => {
    const r = await api(tokens.full, 'POST', '/pages', { parent: { data_source_id: ids.col }, properties: { Name: { title: [{ text: { content: 'Delta' } }] }, Status: { select: { name: 'Blocked' } }, Points: { number: 8 } } });
    expect(r.status).toBe(200);
    expect(r.json.properties.Status.select.name).toBe('Blocked');
    ids.row3 = r.json.id;
    const col = db.getRecord<any>('collection', ids.col)!;
    expect(col.schema[ids.status].options.map((o: any) => o.value)).toContain('Blocked');
    const bad = await api(tokens.full, 'PATCH', `/pages/${ids.row3}`, { properties: { Salary: { number: 1 } } });
    expect(bad.status).toBe(400);
    const ok = await api(tokens.full, 'PATCH', `/pages/${ids.row3}`, { properties: { Points: { number: 9 } } });
    expect(ok.json.properties.Points.number).toBe(9);
  });

  it('a locked database keeps its schema but takes data', async () => {
    const dbRec = db.getRecord<any>('block', ids.db)!;
    db.putRecord('block', { ...dbRec, version: dbRec.version + 1, format: { ...(dbRec.format ?? {}), block_locked: true } });
    const s = await api(tokens.full, 'PATCH', `/data_sources/${ids.col}`, { properties: { Extra: { rich_text: {} } } });
    expect(s.status).toBe(403);
    expect(s.json.code).toBe('forbidden');
    const d = await api(tokens.full, 'PATCH', `/pages/${ids.row3}`, { properties: { Points: { number: 10 } } });
    expect(d.status).toBe(200);
    db.putRecord('block', { ...db.getRecord<any>('block', ids.db)!, format: {} });
    const s2 = await api(tokens.full, 'PATCH', `/data_sources/${ids.col}`, { properties: { Extra: { rich_text: {} } } });
    expect(s2.status).toBe(200);
    expect(Object.keys(s2.json.properties)).toContain('Extra');
  });

  it('creates a database under a shared page', async () => {
    const r = await api(tokens.full, 'POST', '/databases', {
      parent: { type: 'page_id', page_id: ids.projects }, title: [{ text: { content: 'Bugs' } }],
      initial_data_source: { properties: { Title: { title: {} }, Severity: { select: { options: [{ name: 'High', color: 'red' }] } }, Score: { formula: { expression: '1 + 1' } } } },
    });
    expect(r.status).toBe(200);
    expect(r.json.object).toBe('database');
    const ds = await api(tokens.full, 'GET', `/data_sources/${r.json.data_sources[0].id}`);
    expect(ds.json.properties.Severity.select.options[0]).toMatchObject({ name: 'High', color: 'red' });
    expect(ds.json.properties.Score.formula.expression).toBe('1 + 1');
  });
});

describe('comments and markdown', () => {
  it('lists and creates comments (bot is the author, people get notified)', async () => {
    const c = await api(tokens.full, 'POST', '/comments', { parent: { page_id: ids.spec }, rich_text: [{ text: { content: 'Hi from the bot' } }] });
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ object: 'comment', parent: { type: 'page_id', page_id: ids.spec }, created_by: { id: store.getIntegration(ids.conn)!.botId } });
    const r = await api(tokens.full, 'POST', '/comments', { discussion_id: c.json.discussion_id, rich_text: [{ text: { content: 'Reply' } }] });
    expect(r.json.discussion_id).toBe(c.json.discussion_id);
    const list = await api(tokens.full, 'GET', `/comments?block_id=${ids.spec}`);
    expect(list.json.results.map((x: any) => x.rich_text[0].plain_text)).toEqual(['Hi from the bot', 'Reply']);
    expect((await api(tokens.full, 'POST', '/comments', { parent: { page_id: ids.secret }, rich_text: [{ text: { content: 'x' } }] })).status).toBe(404);
  });

  it('reads and edits a page as Markdown', async () => {
    const g = await api(tokens.full, 'GET', `/pages/${ids.spec}/markdown`);
    expect(g.json).toMatchObject({ object: 'page_markdown', id: ids.spec });
    const a = await api(tokens.full, 'PATCH', `/pages/${ids.spec}/markdown`, { type: 'insert_content', insert_content: { content: '## Notes\n\n- one\n- two' } });
    expect(a.status).toBe(200);
    expect(a.json.markdown).toContain('## Notes');
    expect(a.json.markdown).toContain('- two');
    const rr = await api(tokens.full, 'PATCH', `/pages/${ids.spec}/markdown`, { type: 'replace_content_range', replace_content_range: { content: '- uno', content_range: '- one' } });
    expect(rr.json.markdown).toContain('- uno');
    expect(rr.json.markdown).not.toContain('- one');
    const rep = await api(tokens.full, 'PATCH', `/pages/${ids.spec}/markdown`, { type: 'replace_content', replace_content: { content: 'Fresh start' } });
    expect(rep.json.markdown.trim().endsWith('Fresh start')).toBe(true);
    expect(rep.json.markdown).not.toContain('Notes');
  });
});

describe('personal access tokens and restricted members', () => {
  async function pat(userId: string) {
    const { createToken } = await import('../src/ai/litMcp.ts');
    return createToken(userId, ids.space, 'cli').token;
  }

  it('a personal token acts as its person (their own access, private pages as parent)', async () => {
    tokens.ownerPat = await pat(ids.owner);
    expect((await api(tokens.ownerPat, 'GET', `/pages/${ids.secret}`)).status).toBe(200);
    expect((await api(tokens.ownerPat, 'GET', '/users/me')).json).toMatchObject({ type: 'person', id: ids.owner });
    const p = await api(tokens.ownerPat, 'POST', '/pages', { parent: { workspace: true }, properties: { title: [{ text: { content: 'Mine' } }] } });
    expect(p.status).toBe(200);
    expect(p.json.parent).toEqual({ type: 'workspace', workspace: true });
    // the owner's token sees the hidden property (full access to the database)
    expect((await api(tokens.ownerPat, 'GET', `/pages/${ids.row0}`)).json.properties.Salary.number).toBe(1000);
  });

  it('a restricted member gains nothing through tokens', async () => {
    tokens.restrictedPat = await pat(ids.restricted);
    expect((await api(tokens.restrictedPat, 'GET', `/pages/${ids.projects}`)).status).toBe(200); // shared with them
    expect((await api(tokens.restrictedPat, 'GET', `/pages/${ids.secret}`)).status).toBe(404);
    const team = db.getRecord<any>('space', ids.space)!.default_team_ids[0];
    const teamHome = db.getRecord<any>('team', team)!.team_pages[0];
    expect((await api(tokens.restrictedPat, 'GET', `/pages/${teamHome}`)).status).toBe(404);
    const users = await api(tokens.restrictedPat, 'GET', '/users');
    expect(users.json.results.map((u: any) => u.id)).toEqual([ids.restricted]);
    const s = await api(tokens.restrictedPat, 'POST', '/search', {});
    expect(s.json.results.map((r: any) => r.id)).not.toContain(teamHome);
  });

  it('row-level access rules: a person only reaches the rows a page-level rule gives them', async () => {
    // "Requests" lives in Secret (owner only); its page-level rule gives people in "Requester" view access to that row
    const rdb = newId();
    const rcol = newId();
    const mine = newId();
    const theirs = newId();
    db.putRecord('block', { ...db.getRecord<any>('block', ids.secret)!, content: [rdb] });
    db.putRecord('block', block(rdb, 'collection_view', ids.secret, 'block', { collection_id: rcol, view_ids: [] }));
    db.putRecord('collection', {
      id: rcol, version: 1, parent_id: rdb, parent_table: 'block', alive: true, space_id: ids.space, name: [['Requests']],
      schema: { title: { name: 'Name', type: 'title' }, req: { name: 'Requester', type: 'person' } },
      permission_rules: [{ id: 'r1', property: 'req', role: 'reader' }],
    } as any);
    db.putRecord('block', block(mine, 'page', rcol, 'collection', { properties: { title: [['Mine']], req: [['‣', [['u', ids.member]]]] } }));
    db.putRecord('block', block(theirs, 'page', rcol, 'collection', { properties: { title: [['Theirs']], req: [['‣', [['u', ids.editor]]]] } }));
    const memberPat = await pat(ids.member);
    expect((await api(memberPat, 'GET', `/pages/${mine}`)).status).toBe(200);
    expect((await api(memberPat, 'GET', `/pages/${theirs}`)).status).toBe(404);
    expect((await api(memberPat, 'POST', `/data_sources/${rcol}/query`, {})).status).toBe(404);
    const found = (await api(memberPat, 'POST', '/search', { query: '' })).json.results.map((r: any) => r.id);
    expect(found).toContain(mine);
    expect(found).not.toContain(theirs);
    // a view-only value rule ("Can view property & values") refuses writes for people without full access
    const col = db.getRecord<any>('collection', ids.col)!;
    db.putRecord('collection', { ...col, version: col.version + 1, schema: { ...col.schema, pts: { ...col.schema.pts, property_permissions: { default_access: 'reader' } } } });
    const editorPat = await pat(ids.editor);
    const w = await api(editorPat, 'PATCH', `/pages/${ids.row0}`, { properties: { Points: { number: 99 } } });
    expect(w.status).toBe(403);
    expect(w.json.code).toBe('forbidden');
    const okTitle = await api(editorPat, 'PATCH', `/pages/${ids.row0}`, { properties: { Name: { title: [{ text: { content: 'Alpha 2' } }] } } });
    expect(okTitle.status).toBe(200);
    db.putRecord('collection', { ...db.getRecord<any>('collection', ids.col)!, schema: col.schema });
  });

  it('a revoked / deleted connection’s token stops working at once', async () => {
    const t = await call(ids.member, 'devCreateConnection', { spaceId: ids.space, name: 'Temp' });
    expect((await api(t.token, 'GET', '/users/me')).status).toBe(200);
    const fresh = await call(ids.member, 'devRefreshConnectionToken', { connectionId: t.connection.id });
    expect((await api(t.token, 'GET', '/users/me')).status).toBe(401);
    expect((await api(fresh.token, 'GET', '/users/me')).status).toBe(200);
    const inst = await call(ids.member, 'devInstallationToken', { connectionId: t.connection.id });
    expect((await api(inst.token, 'GET', '/users/me')).status).toBe(200);
    await call(ids.member, 'devDeleteConnection', { connectionId: t.connection.id });
    expect((await api(fresh.token, 'GET', '/users/me')).status).toBe(401);
    expect((await api(inst.token, 'GET', '/users/me')).status).toBe(401);
  });

  it('removing the connection from the page removes access', async () => {
    await call(ids.owner, 'devRemovePageConnection', { pageId: ids.projects, connectionId: ids.ro });
    expect((await api(tokens.ro, 'GET', `/pages/${ids.spec}`)).status).toBe(404);
  });
});

describe('rate limits', () => {
  it('answers 429 rate_limited with Retry-After', async () => {
    process.env.NC_API_RATE_PER_MIN = '3';
    const t = await call(ids.owner, 'devCreateConnection', { spaceId: ids.space, name: 'Burst' });
    let last: any;
    for (let i = 0; i < 4; i++) last = await api(t.token, 'GET', '/users/me');
    expect(last.status).toBe(429);
    expect(last.json.code).toBe('rate_limited');
    expect(last.headers.get('retry-after')).toBeTruthy();
    delete process.env.NC_API_RATE_PER_MIN;
  });
});

describe('connection webhooks', () => {
  let server: Server;
  let port = 0;
  const received: { headers: Record<string, any>; body: any; raw: string }[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => { raw += c; });
      req.on('end', () => {
        received.push({ headers: req.headers, body: JSON.parse(raw || '{}'), raw });
        res.writeHead(200).end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as any).port;
  });
  afterAll(() => { server?.close(); });

  const until = async (fn: () => boolean, ms = 5000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error('timeout');
      await new Promise((r) => setTimeout(r, 25));
    }
  };

  it('verification flow, signed page events, own changes not echoed, unshared pages not sent', async () => {
    const created = await call(ids.owner, 'devCreateWebhook', { connectionId: ids.conn, url: `http://127.0.0.1:${port}/hook`, eventTypes: ['page.content_updated', 'page.created', 'comment.created'] });
    expect(created.webhook.status).toBe('pending_verification');
    expect(created.webhook.apiVersion).toBe('2026-10-01');
    await until(() => received.some((r) => r.body.verification_token));
    const token = received.find((r) => r.body.verification_token)!.body.verification_token as string;
    expect(await status(() => call(ids.owner, 'devVerifyWebhook', { webhookId: created.webhook.id, token: 'wrong' }))).toBe(400);
    const v = await call(ids.owner, 'devVerifyWebhook', { webhookId: created.webhook.id, token });
    expect(v.webhook.status).toBe('active');
    received.length = 0;
    // a person edits a shared page → page.content_updated; an unshared page → nothing
    const { applyTransactions } = await import('../src/records.ts');
    const bid = newId();
    applyTransactions(ids.owner, [{ id: newId(), spaceId: ids.space, operations: [
      { pointer: { table: 'block', id: bid, spaceId: ids.space }, path: [], command: 'set', args: { id: bid, type: 'text', properties: { title: [['new line']] }, parent_id: ids.spec, parent_table: 'block', alive: true, space_id: ids.space } },
      { pointer: { table: 'block', id: ids.spec, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: bid } },
    ] }], undefined, { client: true });
    const sid = newId();
    applyTransactions(ids.owner, [{ id: newId(), spaceId: ids.space, operations: [
      { pointer: { table: 'block', id: sid, spaceId: ids.space }, path: [], command: 'set', args: { id: sid, type: 'text', properties: { title: [['secret line']] }, parent_id: ids.secret, parent_table: 'block', alive: true, space_id: ids.space } },
      { pointer: { table: 'block', id: ids.secret, spaceId: ids.space }, path: ['content'], command: 'listAfter', args: { id: sid } },
    ] }], undefined, { client: true });
    await webhooks.flushWebhookEvents();
    await until(() => received.length >= 1);
    await new Promise((r) => setTimeout(r, 100));
    const ev = received.find((r) => r.body.type === 'page.content_updated')!;
    expect(ev.body).toMatchObject({ entity: { id: ids.spec, type: 'page' }, integration_id: ids.conn, workspace_id: ids.space, authors: [{ id: ids.owner, type: 'person' }] });
    expect(ev.body.data.updated_blocks).toEqual([{ id: bid, type: 'block' }]);
    expect(ev.headers['x-lit-signature']).toBe(`sha256=${createHmac('sha256', token).update(ev.raw).digest('hex')}`);
    expect(received.some((r) => r.body.entity?.id === ids.secret)).toBe(false);
    // the connection's own change is not echoed back
    received.length = 0;
    await api(tokens.full, 'PATCH', `/blocks/${ids.spec}/children`, { children: [{ type: 'paragraph', paragraph: { rich_text: [{ text: { content: 'by bot' } }] } }] });
    await webhooks.flushWebhookEvents();
    await new Promise((r) => setTimeout(r, 150));
    expect(received.filter((r) => r.body.type === 'page.content_updated')).toHaveLength(0);
    // paused subscriptions receive nothing
    await call(ids.owner, 'devUpdateWebhook', { webhookId: created.webhook.id, status: 'paused' });
    applyTransactions(ids.owner, [{ id: newId(), spaceId: ids.space, operations: [{ pointer: { table: 'block', id: ids.spec, spaceId: ids.space }, path: ['properties', 'title'], command: 'set', args: [['Spec v2']] }] }], undefined, { client: true });
    await webhooks.flushWebhookEvents();
    await new Promise((r) => setTimeout(r, 150));
    expect(received).toHaveLength(0);
  });

  it('subscriptions are refused when webhooks are off', async () => {
    process.env.NC_CONNECTION_WEBHOOKS = '0';
    expect(await status(() => call(ids.owner, 'devCreateWebhook', { connectionId: ids.conn, url: `http://127.0.0.1:${port}/hook` }))).toBe(400);
    process.env.NC_CONNECTION_WEBHOOKS = '1';
  });
});

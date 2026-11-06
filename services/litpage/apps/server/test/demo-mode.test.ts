import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-demo-data-'));
process.env.NC_DEMO_MODE = '1';
process.env.NC_BOOTSTRAP_EMAIL = 'demo@example.test';

let H: Record<string, (ctx: any, body: any) => any>;
let app: typeof import('../src/app.ts').app;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let auth: typeof import('../src/auth.ts');
let demo: typeof import('../src/demo.ts');
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string | null, ip = '198.51.100.1') => ({ userId, ip, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);
const status = async (fn: () => unknown) => {
  try { await fn(); return 200; } catch (e: any) { return e?.status ?? 500; }
};
const tx = (user: string, operations: any[], spaceId = ids.space) => H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  ({ app } = await import('../src/app.ts'));
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  auth = await import('../src/auth.ts');
  demo = await import('../src/demo.ts');
  ids.user = newId();
  seed.createUser(ids.user, process.env.NC_BOOTSTRAP_EMAIL!, 'Demo');
  const w = seed.createWorkspace(ids.user, 'Demo workspace');
  ids.space = w.space.id;
  auth.setPassword(ids.user, 'DemoPassword123!');
  ids.page = w.spaceView.private_pages[0];
});

describe('demo RPC refusals', () => {
  it('refuses identity, workspace, sharing, public, outbound, and session lockout actions', async () => {
    const names = [
      'changePassword', 'startTotpEnrollment', 'registerPasskey', 'addSecondaryEmail', 'deleteAccount', 'logoutOtherSessions',
      'inviteMembers', 'setSpaceDomain', 'deleteWorkspace', 'setMemberRole', 'resetInviteLink', 'requestMembers',
      'invitePagePermissions', 'getPublishedPage', 'getPublicForm', 'setSiteSettings', 'saveAutomation', 'runButtonServerSteps',
      'devCreateConnection', 'mcpCreateToken', 'restoreAgent', 'permanentlyDeleteAgent', 'setAgentPermissions', 'runAgent', 'stopAgentRun',
      'stopAllAgentRuns', 'agentRunFeedback', 'resolveAgentReview', 'resumeAgent', 'setAgentFavorite', 'setAgentCreditLimit', 'transferAgentOwnership',
      'adminJoinAgent', 'aiChat', 'aiFormula', 'aiGenerateImage', 'meetingSummarize', 'meetingUploadAudio',
    ];
    for (const name of names) expect(await status(() => call(ids.user, name))).toBe(403);
  });

  it('allows ordinary RPCs when demo mode is disabled', async () => {
    delete process.env.NC_DEMO_MODE;
    expect(await status(() => call(ids.user, 'checkSignInMethods', { email: process.env.NC_BOOTSTRAP_EMAIL }))).toBe(200);
    expect(await status(() => call(ids.user, 'changePassword', { password: 'DemoPassword456!', currentPassword: 'DemoPassword123!' }))).toBe(200);
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'block', id: ids.page }, path: ['properties', 'title'], command: 'set', args: [['Normal mode']] }]))).toBe(200);
    process.env.NC_DEMO_MODE = '1';
  });

  it('refuses REST and MCP entry points', async () => {
    const rest = await app.request(new Request('http://localhost/v1/users/me', { headers: { authorization: 'Bearer lp_pat_test' } }));
    expect(rest.status).toBe(403);
    const mcp = await import('../src/ai/litMcp.ts');
    expect((await mcp.handleMcpHttp('Bearer lp_pat_test', { jsonrpc: '2.0', id: 1, method: 'initialize' })).status).toBe(403);
  });

  it('caps demo uploads at 5 MB', async () => {
    const token = auth.createSession(ids.user);
    const body = new Uint8Array(5 * 1024 * 1024 + 1);
    const res = await app.request(new Request('http://localhost/api/upload?name=large.bin', { method: 'POST', headers: { cookie: `lit_session=${token}`, 'content-type': 'application/octet-stream' }, body }));
    expect(res.status).toBe(413);
  });

  it('does not serve uploaded capability URLs anonymously', async () => {
    const res = await app.request(new Request('http://localhost/files/00000000-0000-4000-8000-000000000000/file.txt'));
    expect(res.status).toBe(403);
  });
});

describe('demo transaction refusals', () => {
  it('rejects profile, workspace settings, public permissions, and display preference writes', async () => {
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'lit_user', id: ids.user }, path: ['name'], command: 'set', args: 'Changed' }]))).toBe(403);
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'space', id: ids.space }, path: ['settings'], command: 'update', args: { allow_guests: false } }]))).toBe(403);
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'block', id: ids.page }, path: ['permissions'], command: 'set', args: [{ type: 'public_permission', role: 'reader' }] }]))).toBe(403);
    const publicId = newId();
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'block', id: publicId }, path: [], command: 'set', args: { id: publicId, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, properties: { title: [['Public']] }, permissions: [{ type: 'public_permission', role: 'reader' }] } }]))).toBe(403);
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'user_settings', id: ids.user }, path: ['settings'], command: 'update', args: { locale: 'ko-KR' } }]))).toBe(403);
    const newPageId = newId();
    expect(await status(() => tx(ids.user, [
      { pointer: { table: 'block', id: newPageId }, path: [], command: 'set', args: { id: newPageId, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, properties: { title: [['New']] } } },
      { pointer: { table: 'block', id: newPageId }, path: ['permissions'], command: 'set', args: [{ type: 'public_permission', role: 'reader' }] },
    ]))).toBe(403);
    const formId = newId();
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'collection_view', id: formId }, path: [], command: 'set', args: {
      id: formId, type: 'form', parent_id: ids.page, parent_table: 'block', space_id: ids.space, alive: true,
      format: { form_config: { permission: 'public' } },
    } }]))).toBe(403);
    const buttonId = newId();
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'block', id: buttonId }, path: [], command: 'set', args: {
      id: buttonId, type: 'button', parent_id: ids.page, parent_table: 'block', space_id: ids.space, alive: true,
      format: { action: { webhook: 'https://example.test/hook' } },
    } }]))).toBe(403);
  });

  it('still permits ordinary page edits', async () => {
    expect(await status(() => tx(ids.user, [{ pointer: { table: 'block', id: ids.page }, path: ['properties', 'title'], command: 'set', args: [['Demo page']] }]))).toBe(200);
  });
});

describe('demo content and reset safety', () => {
  it('seeds the four requested templates once', () => {
    seed.seedDemoContent(ids.space, ids.user);
    const pages = db.recordsInSpace<any>('block', ids.space).filter((b) => b.parent_table === 'space' && b.alive !== false);
    const content = [...pages, ...db.recordsInSpace<any>('collection', ids.space)];
    for (const title of ['Roadmap', 'Projects', 'Meeting notes', 'Team wiki']) expect(content.some((p) => JSON.stringify(p).includes(title))).toBe(true);
    const count = pages.length;
    seed.seedDemoContent(ids.space, ids.user);
    expect(db.recordsInSpace<any>('block', ids.space).filter((b) => b.parent_table === 'space' && b.alive !== false).length).toBe(count);
    const roadmap = content.find((p) => JSON.stringify(p).includes('Roadmap'));
    expect(roadmap).toBeTruthy();
  });

  it('refuses an unset or suspicious reset directory and wipes a named data directory', () => {
    expect(demo.isSafeDemoDataDir(undefined)).toBe(false);
    expect(demo.isSafeDemoDataDir('/tmp')).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), 'nc-demo-data-guard-'));
    writeFileSync(join(dir, 'stale.txt'), 'stale');
    expect(demo.wipeDemoDataDir(dir)).toBe(true);
    expect(existsSync(join(dir, 'stale.txt'))).toBe(false);
  });
});

describe('demo login rate limits', () => {
  it('does not apply the per-email failure bucket to the shared account', async () => {
    process.env.NC_DEMO_MODE = '1';
    for (let i = 0; i < 12; i++) expect(await status(() => call(null, 'signInWithEmail', { email: process.env.NC_BOOTSTRAP_EMAIL, password: 'wrong' }))).toBe(401);
    expect(await status(() => call(null, 'signInWithEmail', { email: process.env.NC_BOOTSTRAP_EMAIL, password: 'DemoPassword456!' }))).toBe(200);
  });

  it('keeps the normal per-email bucket outside demo mode', async () => {
    delete process.env.NC_DEMO_MODE;
    const email = 'normal-lock@example.test';
    const id = newId();
    seed.createUser(id, email, 'Normal');
    auth.setPassword(id, 'NormalPassword123!');
    for (let i = 0; i < 10; i++) expect(await status(() => call(null, 'signInWithEmail', { email, password: 'wrong' }))).toBe(401);
    expect(await status(() => call(null, 'signInWithEmail', { email, password: 'wrong' }))).toBe(429);
    process.env.NC_DEMO_MODE = '1';
  });
});

// ---------------------------------------------------------------- per-visitor sandboxes
let ipSeq = 10;
const nextIp = () => `203.0.113.${ipSeq++}`;
const sessionOf = (cookie: string) => cookie.match(/lit_session=([0-9a-f]+)/)?.[1] ?? '';
async function startSandbox(opts: { ip?: string; userId?: string | null; token?: string } = {}) {
  const cookies: string[] = [];
  const res = await H.startDemoSandbox({ userId: opts.userId ?? null, token: opts.token, ip: opts.ip ?? nextIp(), setCookie: (c: string) => cookies.push(c) }, {});
  return { ...res, token: sessionOf(cookies.join(';')), cookie: cookies[0] ?? '' };
}
const titleOf = (b: any) => (b?.properties?.title ?? []).map((r: any) => r[0]).join('');
const sandboxCtx = (userId: string) => ({ userId, ip: '198.51.100.1', setCookie: () => {} });
const spaceRecords = (spaceId: string) => db.db.prepare('SELECT COUNT(*) AS n FROM records WHERE space_id = ?').get(spaceId) as { n: number };

/** Every row of every table (FTS shadow tables skipped) as JSON strings, keyed by table. */
function dumpAll(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const tables = db.db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string; sql: string }[];
  const virtual = tables.filter((t) => /VIRTUAL/i.test(t.sql ?? '')).map((t) => t.name);
  for (const t of tables) {
    if (virtual.some((v) => t.name.startsWith(`${v}_`))) continue;
    out.set(t.name, (db.db.prepare(`SELECT * FROM "${t.name}"`).all() as any[]).map((r) => JSON.stringify(r)));
  }
  return out;
}

describe('demo sandboxes: creation and sample content', () => {
  it('creates a guest, a seeded "Litpage Demo" workspace and a session that ends with the sandbox, quickly', async () => {
    const started = performance.now();
    const sb = await startSandbox();
    const ms = performance.now() - started;
    console.log(`[demo test] sandbox created in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(3000);
    expect(sb.path).toMatch(/^\/demo-[0-9a-f]{12}\/Start-here-[0-9a-f]{32}$/);
    expect(sb.cookie).toMatch(/HttpOnly/);
    const maxAge = Number(sb.cookie.match(/Max-Age=(\d+)/)?.[1]);
    expect(maxAge).toBeGreaterThan(3 * 3600);
    expect(maxAge).toBeLessThanOrEqual(4 * 3600);
    expect(auth.userForToken(sb.token)).toBe(sb.userId);
    const user = db.getRecord<any>('lit_user', sb.userId);
    expect(user.email).toMatch(/^guest-[0-9a-f]{12}@demo\.invalid$/);
    expect(user.name).toMatch(/^Guest \d{4}$/);
    expect(user.onboarding_completed).toBe(true);
    const space = db.getRecord<any>('space', sb.spaceId);
    expect(space.name).toBe('Litpage Demo');
    expect(space.permissions).toEqual([expect.objectContaining({ user_id: sb.userId, role: 'owner' })]);
    const acct = await H.loadAccountData(sandboxCtx(sb.userId), {});
    expect(acct.demoMode.enabled).toBe(true);
    expect(acct.demoMode.sandboxHours).toBe(4);
    expect(acct.demoMode.sandbox.expires - acct.demoMode.sandbox.createdTime).toBe(4 * 3_600_000);
    const res = await app.request(new Request('http://localhost/api/rpc/loadAccountData', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `lit_session=${sb.token}` }, body: '{}' }));
    expect(res.status).toBe(200);
  });

  it('lands on "Start here" and seeds Roadmap (board, table, timeline, chart, dates around today), Projects, Meeting notes and Team wiki', async () => {
    const sb = await startSandbox();
    expect(titleOf(db.getRecord<any>('block', sb.pageId))).toBe('Start here');
    const sv = db.recordsInSpace<any>('space_view', sb.spaceId)[0];
    expect(sv.private_pages[0]).toBe(sb.pageId);
    const text = db.recordsInSpace<any>('block', sb.spaceId).filter((b) => b.parent_id === sb.pageId).map(titleOf).join('\n');
    for (const s of ['/', 'Board, Timeline and Chart', 'second browser tab', 'dark mode', 'Korean', 'AI is not connected']) expect(text).toContain(s);
    const space = db.getRecord<any>('space', sb.spaceId);
    const cols = db.recordsInSpace<any>('collection', sb.spaceId);
    const names = cols.map((c) => titleOf({ properties: { title: c.name } })).join('|');
    for (const n of ['Roadmap', 'Projects', 'Meeting notes']) expect(names).toContain(n);
    expect(space.pages.map((id: string) => JSON.stringify(db.getRecord('block', id))).join('')).toContain('Team wiki');
    const roadmap = cols.find((c) => titleOf({ properties: { title: c.name } }) === 'Roadmap');
    const views = db.childrenOf<any>('collection_view', roadmap.parent_id).map((v) => v.type);
    for (const v of ['board', 'table', 'timeline', 'chart']) expect(views).toContain(v);
    const rows = db.childrenOf<any>('block', roadmap.id).filter((r) => r.parent_table === 'collection');
    const today = new Date().toISOString().slice(0, 10);
    const ranges = rows.map((r) => JSON.stringify(r.properties).match(/"start_date":"([\d-]+)","end_date":"([\d-]+)"/)).filter(Boolean) as RegExpMatchArray[];
    expect(ranges.length).toBeGreaterThanOrEqual(3);
    expect(ranges.some((m) => m[1] <= today && m[2] >= today)).toBe(true);
  });
});

describe('demo sandboxes: isolation', () => {
  it('a visitor cannot read, find or reach another sandbox, its pages or its guest', async () => {
    const a = await startSandbox();
    const b = await startSandbox();
    const bName = db.getRecord<any>('lit_user', b.userId).name;
    const secret = newId();
    await H.applyChanges(sandboxCtx(b.userId), { transactions: [{ id: newId(), spaceId: b.spaceId, operations: [
      { pointer: { table: 'block', id: secret, spaceId: b.spaceId }, path: [], command: 'set', args: { id: secret, type: 'text', parent_id: b.pageId, parent_table: 'block', space_id: b.spaceId, alive: true, properties: { title: [['zebracornsecret']] } } },
      { pointer: { table: 'block', id: b.pageId, spaceId: b.spaceId }, path: ['content'], command: 'listAfter', args: { id: secret } },
    ] }] });
    const A = sandboxCtx(a.userId);
    const leaks = (v: unknown) => {
      const s = JSON.stringify(v ?? null);
      return [b.userId, b.spaceId, b.pageId, bName, 'zebracornsecret'].filter((x) => s.includes(x));
    };
    const quiet = async (fn: () => any) => {
      try {
        return await fn();
      } catch (e: any) {
        return { status: e?.status };
      }
    };
    expect(leaks(await H.loadAccountData(A, {}))).toEqual([]);
    expect(leaks(await H.loadPage(A, { pageId: b.pageId }))).toEqual([]);
    expect(leaks(await H.fetchRecords(A, { requests: [
      { pointer: { table: 'block', id: b.pageId } }, { pointer: { table: 'space', id: b.spaceId } }, { pointer: { table: 'lit_user', id: b.userId } }, { pointer: { table: 'user_settings', id: b.userId } },
    ] }))).toEqual([]);
    expect(leaks(await H.getChangesSince(A, { lsn: 0, spaceIds: [b.spaceId] }))).toEqual([]);
    expect(leaks(await H.searchWorkspace(A, { query: 'zebracornsecret', spaceId: a.spaceId }))).toEqual([]);
    expect(leaks(await quiet(() => H.searchWorkspace(A, { query: 'zebracornsecret', spaceId: b.spaceId })))).toEqual([]);
    expect(leaks(await H.listRecentPages(A, { spaceId: b.spaceId }))).toEqual([]);
    expect(leaks(await H.getNotifications(A, { spaceId: b.spaceId }))).toEqual([]);
    expect(leaks(await quiet(() => H.getSharedWithMe(A, { spaceId: a.spaceId })))).toEqual([]);
    expect(leaks(await quiet(() => H.getInbox(A, { spaceId: b.spaceId })))).toEqual([]);
    expect(leaks(await quiet(() => H.getPageAccessState(A, { pageId: b.pageId })))).toEqual([]);
    expect(leaks(await quiet(() => H.getPeopleDirectory(A, { spaceId: b.spaceId })))).toEqual([]);
    expect(leaks(await quiet(() => H.searchPeople(A, { spaceId: b.spaceId, query: 'Guest' })))).toEqual([]);
    expect(leaks(await quiet(() => H.getPersonProfile(A, { spaceId: b.spaceId, userId: b.userId })))).toEqual([]);
    expect(leaks(await quiet(() => H.getPersonProfile(A, { spaceId: a.spaceId, userId: b.userId })))).toEqual([]);
    expect((await H.searchPeople(A, { spaceId: a.spaceId, query: 'Guest' })).userIds).toEqual([a.userId]);
    // writing into B, inviting, sharing with B and posting reviews other visitors see are refused
    const edit = { pointer: { table: 'block', id: b.pageId, spaceId: b.spaceId }, path: ['properties', 'title'], command: 'set', args: [['taken']] };
    expect(await status(() => H.applyChanges(A, { transactions: [{ id: newId(), spaceId: b.spaceId, operations: [edit] }] }))).toBe(403);
    expect(await status(() => H.inviteMembers(A, { spaceId: a.spaceId, emails: ['someone@example.com'] }))).toBe(403);
    const share = { pointer: { table: 'block', id: a.pageId, spaceId: a.spaceId }, path: ['permissions'], command: 'set', args: [{ type: 'user_permission', role: 'editor', user_id: a.userId }, { type: 'user_permission', role: 'editor', user_id: b.userId }] };
    expect(await status(() => H.applyChanges(A, { transactions: [{ id: newId(), spaceId: a.spaceId, operations: [share] }] }))).toBe(403);
    expect(await status(() => H.reviewTemplate(A, { templateId: 'roadmap', rating: 5 }))).toBe(403);
    // B's upload is served to B only
    const up = await app.request(new Request(`http://localhost/api/upload?name=b.txt&spaceId=${b.spaceId}`, { method: 'POST', headers: { cookie: `lit_session=${b.token}` }, body: 'b file' }));
    const { url } = await up.json() as any;
    expect((await app.request(new Request(`http://localhost${url}`, { headers: { cookie: `lit_session=${b.token}` } }))).status).toBe(200);
    expect((await app.request(new Request(`http://localhost${url}`, { headers: { cookie: `lit_session=${a.token}` } }))).status).toBe(404);
    expect((await app.request(new Request(`http://localhost${url}`))).status).toBe(403);
  });

  it('realtime never pushes another sandbox\'s records or guest to a visitor', async () => {
    const { realtime } = await import('../src/realtime.ts');
    const a = await startSandbox();
    const b = await startSandbox();
    const got: string[] = [];
    // even a client that claims B's workspace and page (subscribe filters spaces; records are checked per viewer)
    const fake = { ws: { readyState: 1, send: (m: string) => got.push(m), close() {} }, userId: a.userId, clientId: 'x', spaces: new Set([a.spaceId, b.spaceId]), page: b.pageId, presence: null };
    (realtime as any).clients.add(fake);
    try {
      await H.applyChanges(sandboxCtx(b.userId), { transactions: [{ id: newId(), spaceId: b.spaceId, operations: [{ pointer: { table: 'block', id: b.pageId, spaceId: b.spaceId }, path: ['properties', 'title'], command: 'set', args: [['Pushed']] }] }] });
      realtime.broadcastChanges([{ table: 'lit_user', record: db.getRecord('lit_user', b.userId)!, spaceId: null }]);
      expect(got.join('')).not.toContain(b.pageId);
      expect(got.join('')).not.toContain(b.userId);
    } finally {
      (realtime as any).clients.delete(fake);
    }
  });
});

describe('demo sandboxes: limits', () => {
  it('limits creations per client address (hour and day)', async () => {
    const ip = nextIp();
    for (let i = 0; i < 5; i++) expect(await status(() => startSandbox({ ip }))).toBe(200);
    expect(await status(() => startSandbox({ ip }))).toBe(429);
    expect(await status(() => startSandbox())).toBe(200);
    process.env.NC_DEMO_SANDBOXES_PER_IP_HOUR = '100';
    process.env.NC_DEMO_SANDBOXES_PER_IP_DAY = '2';
    try {
      const ip2 = nextIp();
      expect(await status(() => startSandbox({ ip: ip2 }))).toBe(200);
      expect(await status(() => startSandbox({ ip: ip2 }))).toBe(200);
      expect(await status(() => startSandbox({ ip: ip2 }))).toBe(429);
    } finally {
      delete process.env.NC_DEMO_SANDBOXES_PER_IP_HOUR;
      delete process.env.NC_DEMO_SANDBOXES_PER_IP_DAY;
    }
  });

  it('at the cap, deletes expired sandboxes first and otherwise refuses without touching live ones', async () => {
    const sandbox = await import('../src/demoSandbox.ts');
    const old = await startSandbox();
    db.db.prepare('UPDATE demo_sandboxes SET expires = ? WHERE user_id = ?').run(Date.now() - 1000, old.userId);
    process.env.NC_DEMO_MAX_SANDBOXES = String(sandbox.liveSandboxCount());
    try {
      const fresh = await startSandbox();
      expect(db.getRecord('lit_user', old.userId)).toBeUndefined();
      const live = sandbox.liveSandboxCount();
      let err: any;
      try { await startSandbox(); } catch (e) { err = e; }
      expect(err?.status).toBe(429);
      expect(err?.message).toMatch(/demo is busy/);
      expect(sandbox.liveSandboxCount()).toBe(live);
      expect(db.getRecord('lit_user', fresh.userId)).toBeTruthy();
    } finally {
      delete process.env.NC_DEMO_MAX_SANDBOXES;
    }
  });

  it('caps records per sandbox on the transaction path and for server-side copies', async () => {
    const sandbox = await import('../src/demoSandbox.ts');
    const sb = await startSandbox();
    const C = sandboxCtx(sb.userId);
    process.env.NC_DEMO_MAX_RECORDS = String(sandbox.sandboxRecordCount(sb.spaceId) + 2);
    const blocks = (n: number) => {
      const ops: any[] = [];
      for (let i = 0; i < n; i++) {
        const id = newId();
        ops.push({ pointer: { table: 'block', id, spaceId: sb.spaceId }, path: [], command: 'set', args: { id, type: 'text', parent_id: sb.pageId, parent_table: 'block', space_id: sb.spaceId, alive: true, properties: { title: [[`row ${i}`]] } } });
        ops.push({ pointer: { table: 'block', id: sb.pageId, spaceId: sb.spaceId }, path: ['content'], command: 'listAfter', args: { id } });
      }
      return H.applyChanges(C, { transactions: [{ id: newId(), spaceId: sb.spaceId, operations: ops }] });
    };
    try {
      let err: any;
      try { await blocks(3); } catch (e) { err = e; }
      expect(err?.status).toBe(413);
      expect(err?.message).toMatch(/demo workspace is full/);
      expect(await status(() => blocks(2))).toBe(200);
      expect(await status(() => H.duplicateBlock(C, { blockId: sb.pageId }))).toBe(413);
      // edits keep working when full
      expect(await status(() => H.applyChanges(C, { transactions: [{ id: newId(), spaceId: sb.spaceId, operations: [{ pointer: { table: 'block', id: sb.pageId, spaceId: sb.spaceId }, path: ['properties', 'title'], command: 'set', args: [['Still editable']] }] }] }))).toBe(200);
    } finally {
      delete process.env.NC_DEMO_MAX_RECORDS;
    }
  });

  it('caps uploaded files per sandbox by count and size', async () => {
    const sb = await startSandbox();
    const up = (bytes: number) => app.request(new Request(`http://localhost/api/upload?name=f.bin&spaceId=${sb.spaceId}`, { method: 'POST', headers: { cookie: `lit_session=${sb.token}` }, body: new Uint8Array(bytes) }));
    process.env.NC_DEMO_MAX_FILES = '2';
    process.env.NC_DEMO_MAX_UPLOAD_MB = '0.01';
    try {
      expect((await up(4000)).status).toBe(200);
      const big = await up(8000);
      expect(big.status).toBe(413);
      expect((await big.json() as any).message).toMatch(/MB of files/);
      expect((await up(1000)).status).toBe(200);
      const third = await up(10);
      expect(third.status).toBe(413);
      expect((await third.json() as any).message).toMatch(/at most 2 files/);
    } finally {
      delete process.env.NC_DEMO_MAX_FILES;
      delete process.env.NC_DEMO_MAX_UPLOAD_MB;
    }
  });
});

describe('demo sandboxes: cleanup', () => {
  it('deletes every row and file of an expired sandbox and nothing else', async () => {
    const sandbox = await import('../src/demoSandbox.ts');
    // a normal account with its own workspace, created in normal mode
    delete process.env.NC_DEMO_MODE;
    const normalId = newId();
    seed.createUser(normalId, 'normal-keep@example.test', 'Normal Keeper');
    const normal = seed.createWorkspace(normalId, 'Normal workspace');
    process.env.NC_DEMO_MODE = '1';
    const live = await startSandbox();
    const gone = await startSandbox();
    const G = sandboxCtx(gone.userId);
    // activity, history, search rows, a comment thread, visits (one to a template page), a page view and a file
    const block = newId();
    const disc = newId();
    const comment = newId();
    await H.applyChanges(G, { transactions: [{ id: newId(), spaceId: gone.spaceId, operations: [
      { pointer: { table: 'block', id: block, spaceId: gone.spaceId }, path: [], command: 'set', args: { id: block, type: 'text', parent_id: gone.pageId, parent_table: 'block', space_id: gone.spaceId, alive: true, properties: { title: [['soon gone']] }, discussions: [disc] } },
      { pointer: { table: 'block', id: gone.pageId, spaceId: gone.spaceId }, path: ['content'], command: 'listAfter', args: { id: block } },
      { pointer: { table: 'discussion', id: disc, spaceId: gone.spaceId }, path: [], command: 'set', args: { id: disc, parent_id: block, parent_table: 'block', space_id: gone.spaceId, alive: true, resolved: false, comments: [comment] } },
      { pointer: { table: 'comment', id: comment, spaceId: gone.spaceId }, path: [], command: 'set', args: { id: comment, parent_id: disc, parent_table: 'discussion', space_id: gone.spaceId, alive: true, text: [['a comment']] } },
    ] }] });
    await H.markPageVisited(G, { block: { id: gone.pageId } });
    const gallery = seed.ensureTemplateGallery();
    await H.markPageVisited(G, { block: { id: gallery.roadmap } });
    await H.listPageVersions(G, { pageId: gone.pageId });
    await H.searchWorkspace(G, { query: 'soon', spaceId: gone.spaceId });
    await Promise.resolve(H.recordPageView(G, { pageId: gallery.roadmap })).catch(() => {});
    const up = await app.request(new Request(`http://localhost/api/upload?name=gone.txt&spaceId=${gone.spaceId}`, { method: 'POST', headers: { cookie: `lit_session=${gone.token}` }, body: 'bye' }));
    const fileId = (await up.json() as any).id;
    expect(existsSync(join(db.DATA_DIR, 'files', fileId))).toBe(true);
    const goneIds = [gone.userId, gone.spaceId, fileId, ...(db.db.prepare('SELECT id FROM records WHERE space_id = ?').all(gone.spaceId) as { id: string }[]).map((r) => r.id)];
    const mentions = (row: string) => goneIds.some((id) => row.includes(id));
    const before = dumpAll();
    expect([...before.values()].flat().filter((r) => r.includes(gone.userId)).length).toBeGreaterThan(5);
    const liveCount = spaceRecords(live.spaceId).n;
    db.db.prepare('UPDATE demo_sandboxes SET expires = ? WHERE user_id = ?').run(Date.now() - 1, gone.userId);
    expect(sandbox.purgeExpiredSandboxes()).toBe(1);
    const after = dumpAll();
    // nothing that references the sandbox is left, in any table
    expect([...after].flatMap(([t, rows]) => rows.filter(mentions).map((r) => `${t}: ${r.slice(0, 200)}`))).toEqual([]);
    // every row that went away belonged to the sandbox; nothing else changed
    for (const [t, rows] of before) {
      const kept = new Set(after.get(t) ?? []);
      expect(rows.filter((r) => !kept.has(r) && !mentions(r)).map((r) => `${t}: ${r.slice(0, 200)}`)).toEqual([]);
    }
    for (const [t, rows] of after) {
      const old = new Set(before.get(t) ?? []);
      expect(rows.filter((r) => !old.has(r)).map((r) => `${t}: ${r.slice(0, 200)}`)).toEqual([]);
    }
    expect(before.get('records')!.length - after.get('records')!.length).toBeGreaterThan(50);
    expect(existsSync(join(db.DATA_DIR, 'files', fileId))).toBe(false);
    // the live sandbox, the normal account and the shared account are untouched
    expect(spaceRecords(live.spaceId).n).toBe(liveCount);
    expect(db.getRecord('lit_user', normalId)).toBeTruthy();
    expect(db.getRecord('space', normal.space.id)).toBeTruthy();
    expect(db.getRecord('lit_user', ids.user)).toBeTruthy();
    // the deleted guest's session no longer works; the signed-out answer offers the demo again
    expect(auth.userForToken(gone.token)).toBeNull();
    const res = await app.request(new Request('http://localhost/api/rpc/loadAccountData', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `lit_session=${gone.token}` }, body: '{}' }));
    expect(res.status).toBe(401);
    expect((await res.json() as any).demoMode).toMatchObject({ enabled: true, sandboxHours: 4 });
    expect(auth.userForToken(live.token)).toBe(live.userId);
  });

  it('"Start over" replaces the caller\'s sandbox', async () => {
    const first = await startSandbox();
    const second = await startSandbox({ userId: first.userId, token: first.token });
    expect(second.userId).not.toBe(first.userId);
    expect(db.getRecord('lit_user', first.userId)).toBeUndefined();
    expect(db.getRecord('space', first.spaceId)).toBeUndefined();
    expect(spaceRecords(first.spaceId).n).toBe(0);
    expect(auth.userForToken(first.token)).toBeNull();
    expect(auth.userForToken(second.token)).toBe(second.userId);
  });

  it('never deletes a user that is not a sandbox, even when listed, and does nothing outside demo mode', async () => {
    const sandbox = await import('../src/demoSandbox.ts');
    const normalId = newId();
    seed.createUser(normalId, 'listed-normal@example.test', 'Listed');
    const normal = seed.createWorkspace(normalId, 'Listed workspace');
    // the shared account and a normal account listed as expired sandboxes (e.g. a bad manual edit)
    const insert = db.db.prepare('INSERT INTO demo_sandboxes (user_id, space_id, created_time, expires) VALUES (?, ?, ?, ?)');
    insert.run(ids.user, ids.space, 0, 1);
    insert.run(normalId, normal.space.id, 0, 1);
    // a guest whose workspace gained another member
    const shared = await startSandbox();
    seed.addMember(shared.spaceId, normalId, 'editor');
    db.db.prepare('UPDATE demo_sandboxes SET expires = 1 WHERE user_id = ?').run(shared.userId);
    const before = dumpAll();
    expect(sandbox.purgeExpiredSandboxes()).toBe(0);
    const after = dumpAll();
    for (const [t, rows] of before) if (t !== 'demo_sandboxes') expect(after.get(t)).toEqual(rows);
    expect(after.get('demo_sandboxes')!.some((r) => r.includes(ids.user) || r.includes(normalId) || r.includes(shared.userId))).toBe(false);
    // outside demo mode nothing is deleted, even an expired real sandbox
    const real = await startSandbox();
    db.db.prepare('UPDATE demo_sandboxes SET expires = 1 WHERE user_id = ?').run(real.userId);
    delete process.env.NC_DEMO_MODE;
    try {
      expect(sandbox.purgeExpiredSandboxes()).toBe(0);
      expect(sandbox.deleteSandbox(real.userId)).toBe(false);
      expect(db.getRecord('lit_user', real.userId)).toBeTruthy();
    } finally {
      process.env.NC_DEMO_MODE = '1';
    }
    expect(sandbox.purgeExpiredSandboxes()).toBeGreaterThanOrEqual(1);
    expect(db.getRecord('lit_user', real.userId)).toBeUndefined();
  });
});

describe('demo sandboxes: normal mode is unchanged', () => {
  it('has no sandbox endpoint, no demo hint on 401, full user lookups and no record quota', async () => {
    const sb = await startSandbox();
    const other = newId();
    seed.createUser(other, 'other-normal@example.test', 'Other Normal');
    delete process.env.NC_DEMO_MODE;
    process.env.NC_DEMO_MAX_RECORDS = '1';
    try {
      expect(await status(() => H.startDemoSandbox({ userId: null, ip: nextIp(), setCookie: () => {} }, {}))).toBe(404);
      const res = await app.request(new Request('http://localhost/api/rpc/loadAccountData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
      expect(res.status).toBe(401);
      expect(Object.keys(await res.json() as any).sort()).toEqual(['errorId', 'message', 'name']);
      const rm = await H.fetchRecords(sandboxCtx(ids.user), { requests: [{ pointer: { table: 'lit_user', id: other } }] });
      expect(rm.recordMap.lit_user?.[other]).toBeTruthy();
      expect((await H.loadAccountData(sandboxCtx(ids.user), {})).demoMode).toEqual({ enabled: false });
      const id = newId();
      expect(await status(() => H.applyChanges(sandboxCtx(sb.userId), { transactions: [{ id: newId(), spaceId: sb.spaceId, operations: [
        { pointer: { table: 'block', id, spaceId: sb.spaceId }, path: [], command: 'set', args: { id, type: 'text', parent_id: sb.pageId, parent_table: 'block', space_id: sb.spaceId, alive: true } },
        { pointer: { table: 'block', id: sb.pageId, spaceId: sb.spaceId }, path: ['content'], command: 'listAfter', args: { id } },
      ] }] }))).toBe(200);
      const welcome = seed.createWorkspace(other, 'Other workspace');
      expect(titleOf(db.getRecord('block', welcome.spaceView.private_pages[0]))).toBe('Welcome to Litpage');
    } finally {
      process.env.NC_DEMO_MODE = '1';
      delete process.env.NC_DEMO_MAX_RECORDS;
    }
  });
});

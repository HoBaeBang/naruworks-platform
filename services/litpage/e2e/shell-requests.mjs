// Shell: access requests end to end with two users (two browser contexts, one Chrome).
//  1. Closed teamspace: B sees it in Library › Teamspaces with "Request" (not Join), can't open its pages; requests;
//     A approves in the Inbox ("asked to join" + Approve) → B is a member and can open the team page.
//  2. No-access page: B opens A's private page → "You can’t access this page in <workspace>" → Request access with a
//     message → "Request sent!"; A's Inbox item shows the message + role ▾ · Approve · Deny; A approves as "Can edit"
//     → B's screen loads the page without a reload.
//  3. Read-only page: B (Can view) sees "This page is view-only · Ask for edit access" → requested → A approves.
// Run: NC_BASE=http://127.0.0.1:5441 node e2e/shell-requests.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, CHROME } from './lib.mjs';
import { apiLogin, call, compact, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/requests';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const page = await ctx.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return page;
};

try {
  const A = await mk();
  const B = await mk();
  const id = uniq();
  const a = await apiLogin(A, { email: `alice${id}@test.dev`, name: 'Alice Owner', workspace: 'Acme Corp' });
  const spaceId = a.spaceId;
  const bEmail = `bob${id}@test.dev`;
  await call(A, 'inviteMembers', { spaceId, emails: [bEmail], role: 'editor' });
  const b = await apiLogin(B, { email: bEmail, name: 'Bob Member', createWorkspace: false });
  r.ok(!!b.userId, 'B signed in as a member of A’s workspace');

  // ---- closed teamspace
  const teamId = await A.evaluate(async ([spaceId]) => {
    const post = (n, body) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const userId = Object.keys(uc.recordMap.user_root)[0];
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const id = crypto.randomUUID();
    const pageId = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'team', id, spaceId }, path: [], command: 'set', args: { id, space_id: spaceId, name: 'Finance', description: 'Budgets', icon: '💰', team_pages: [], parent_id: spaceId, parent_table: 'space', alive: true, membership: [{ user_id: userId, role: 'owner', added_time: now }], settings: { type: 'closed', default_page_role: 'editor' }, created_time: now, created_by_id: userId } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['joined_teams'], command: 'listAfter', args: { id } },
      { pointer: { table: 'block', id: pageId, spaceId }, path: [], command: 'set', args: { id: pageId, type: 'page', properties: { title: [['Budget 2027']] }, content: [], parent_id: id, parent_table: 'team', space_id: spaceId, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId } },
      { pointer: { table: 'team', id, spaceId }, path: ['team_pages'], command: 'listAfter', args: { id: pageId } },
    ] }] });
    return id;
  }, [spaceId]);
  const teamPage = await A.evaluate(async (tid) => {
    const r = await fetch('/api/rpc/fetchRecords', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests: [{ pointer: { table: 'team', id: tid } }] }) }).then((x) => x.json());
    return (r.recordMap.team[tid].value.value ?? r.recordMap.team[tid].value).team_pages[0];
  }, teamId);
  const chunk = await call(B, 'loadPage', { pageId: teamPage });
  r.ok(!chunk.recordMap?.block?.[teamPage], 'B cannot read a closed teamspace page before joining');

  const domain = await B.evaluate(() => location.pathname.split('/')[1]);
  await B.goto(`${BASE}/${domain}/library/teamspaces`);
  await B.waitForSelector('.nc-lib-ts');
  await B.click('.nc-lib-ts-group-head:has-text("More teams")');
  const row = B.locator('.nc-lib-ts-item', { hasText: 'Finance' });
  await row.waitFor();
  r.ok(await row.locator('.nc-lib-ts-join:has-text("Request")').count() === 1 && await row.locator('.nc-lib-ts-join:has-text("Join")').count() === 0, 'closed teamspace offers Request (not Join)');
  await row.locator('.nc-lib-ts-join:has-text("Request")').click();
  await B.waitForSelector('.nc-team-request');
  await B.screenshot({ path: `${OUT}/01-team-request-dialog.png` });
  await B.fill('.nc-team-request textarea', 'I run the budget review');
  await B.click('.nc-team-request button:has-text("Request")');
  await B.waitForSelector('.nc-lib-ts-item:has-text("Finance") .nc-lib-ts-join.requested');
  r.ok(true, 'B sees "Requested" after sending the request');

  // A: Inbox → approve
  await A.goto(BASE + '/');
  await A.waitForSelector('nav.lit-sidebar-container');
  await A.click('nav [aria-label="Inbox"]');
  const teamReq = A.locator('.nc-inbox-row[data-notification-type="team_join_requested"]').first();
  await teamReq.waitFor();
  const head = await teamReq.locator('.nc-inbox-headline').textContent();
  r.ok(/Bob Member\s*asked to join\s*\S*\s*Finance/u.test(head ?? ""), `A’s Inbox: "${head}"`);
  r.ok(/I run the budget review/.test(await teamReq.textContent() ?? ''), 'request message shown');
  await A.screenshot({ path: `${OUT}/02-team-request-inbox.png` });
  await teamReq.locator('.nc-inbox-approve-btn').click();
  await waitFor(async () => /Approved by You/.test(await teamReq.textContent() ?? ''));
  r.ok(/Approved by You at/.test(await teamReq.textContent() ?? ''), 'item shows "Approved by You at …"');
  const chunk2 = await waitFor(async () => {
    const c = await call(B, 'loadPage', { pageId: teamPage });
    return c.recordMap?.block?.[teamPage] ? c : null;
  });
  r.ok(!!chunk2, 'B can open the teamspace page after approval');
  await B.goto(BASE + '/');
  await B.waitForSelector('nav.lit-sidebar-container');
  r.ok(await waitFor(async () => (await B.$$eval('.lit-outliner-team', (els) => els.map((e) => e.textContent))).some((x) => /Finance/.test(x))), 'Finance appears in B’s sidebar');
  await A.keyboard.press('Escape');

  // ---- no-access page → request access
  const secret = await createPrivatePage(A, spaceId, 'Launch plan');
  await B.goto(`${BASE}/${domain}/Launch-plan-${compact(secret)}`);
  await B.waitForSelector('.nc-noaccess');
  const title = await B.textContent('.nc-noaccess-title');
  r.ok(/You can’t access this page in\s*Acme Corp/.test(title ?? ''), `no-access title: "${title}"`);
  r.ok(!/Launch plan/.test(await B.textContent('.nc-noaccess') ?? ''), 'page title is not revealed');
  await B.screenshot({ path: `${OUT}/03-no-access.png` });
  await B.fill('.nc-noaccess-note textarea', 'Need this for the launch');
  await B.click('.nc-noaccess-request');
  await B.waitForSelector('.nc-noaccess[data-state="requested"]');
  r.ok(/Request sent!/.test(await B.textContent('.nc-noaccess-title') ?? ''), '"Request sent!" after requesting');
  r.ok((await B.textContent('.nc-noaccess-request'))?.trim() === 'Requested access', 'button turns into "Requested access"');

  await A.click('nav [aria-label="Inbox"]');
  const accReq = A.locator('.nc-inbox-row[data-notification-type="access_requested"]').first();
  await accReq.waitFor();
  const accText = await accReq.textContent();
  r.ok(/asked for access to/.test(accText ?? '') && /Need this for the launch/.test(accText ?? ''), 'access request item with the message');
  r.ok((await accReq.locator('.nc-inbox-role-btn').textContent())?.trim() === 'Can view', 'role dropdown defaults to Can view');
  await accReq.locator('.nc-inbox-role-btn').click();
  await A.click('.lit-overlay-container [role=option]:has-text("Can edit")');
  await A.screenshot({ path: `${OUT}/04-access-request-inbox.png` });
  await accReq.locator('.nc-inbox-approve-btn').click();
  await waitFor(async () => /Approved by You/.test(await accReq.textContent() ?? ''));
  r.ok(/Approved by You on .*Can edit/.test(await accReq.textContent() ?? ''), 'approved as Can edit');
  const loaded = await waitFor(async () => (await B.$('h1[data-content-editable-leaf]')) && /Launch plan/.test(await B.textContent('h1[data-content-editable-leaf]') ?? ''), { timeout: 10000 });
  r.ok(!!loaded, 'B’s no-access screen turns into the page after approval (realtime)');
  r.ok((await call(B, 'getPageAccessState', { pageId: secret })).role === 'read_and_write', 'B now has Can edit');
  await A.keyboard.press('Escape');

  // ---- read-only page → request edit access
  const view = await createPrivatePage(A, spaceId, 'Handbook');
  await A.evaluate(async ([pid, uid, spaceId]) => {
    await fetch('/api/rpc/invitePagePermissions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: pid, userIds: [uid], role: 'reader' }) });
    void spaceId;
  }, [view, b.userId, spaceId]);
  await B.goto(`${BASE}/${domain}/Handbook-${compact(view)}`);
  await B.waitForSelector('.nc-permission-banner');
  r.ok(/This page is view-only/.test(await B.textContent('.nc-permission-banner') ?? ''), 'read-only banner');
  await B.waitForSelector('.nc-permission-banner-btn');
  await B.screenshot({ path: `${OUT}/05-permission-banner.png` });
  await B.click('.nc-permission-banner-btn');
  await waitFor(async () => /Edit access requested/.test(await B.textContent('.nc-permission-banner') ?? ''));
  r.ok(/Edit access requested/.test(await B.textContent('.nc-permission-banner') ?? ''), '"Edit access requested"');
  await A.click('nav [aria-label="Inbox"]');
  const editReq = A.locator('.nc-inbox-row[data-notification-type="access_requested"]', { hasText: 'Handbook' }).first();
  await editReq.waitFor();
  r.ok(/Edit access requested/.test(await editReq.textContent() ?? ''), 'edit request says "Edit access requested"');
  await editReq.locator('.nc-inbox-approve-btn').click();
  await waitFor(async () => /Approved by You/.test(await editReq.textContent() ?? ''));
  r.ok((await call(B, 'getPageAccessState', { pageId: view })).role === 'read_and_write', 'B can edit after approval');
  const granted = await waitFor(async () => {
    const inbox = await call(B, 'getInbox', { spaceId, status: 'all' });
    return (inbox.items ?? []).some((it) => inbox.recordMap?.notification?.[it.id] && JSON.stringify(inbox.recordMap.notification[it.id]).includes('access_granted'));
  });
  r.ok(!!granted, 'B gets an "approved your request" Inbox item');
} catch (e) {
  console.log('FAIL exception', e.message.slice(0, 800));
  process.exitCode = 1;
} finally {
  await browser.close();
  r.done();
}

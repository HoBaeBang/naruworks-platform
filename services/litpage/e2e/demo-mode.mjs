// Public demo mode (NC_DEMO_MODE=1) with per-visitor sandboxes, against a dev server or a production build:
//   NC_DEMO_MODE=1 NC_DEMO_SANDBOXES_PER_IP_HOUR=50 … node apps/server/src/main.ts
//   NC_BASE=<web url> node e2e/demo-mode.mjs
// Covers: "Try the demo" on the login page (email form hidden without a shared account), landing on "Start here" in a
// seeded workspace with the notice bar, two visitors in separate workspaces that cannot read or find each other, editing
// and a second tab of the same sandbox updating live, refusals for account / workspace / sharing / outbound /
// programmatic actions (RPC and transaction paths, REST and MCP), the 5 MB upload cap, files served to their own
// sandbox only, and "Start over" (a fresh workspace; tabs of the old one return to the login page).
// With a shared account configured (DEMO_EMAIL / DEMO_PASSWORD) it also checks that it still signs in.
// Ids come from RPCs or the URL (production builds have no dev store hook).
import { chromium } from 'playwright-core';
import { BASE, CHROME } from './lib.mjs';

const SHARED_EMAIL = process.env.DEMO_EMAIL ?? '';
const SHARED_PASSWORD = process.env.DEMO_PASSWORD ?? '';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok || !detail ? '' : ` | ${String(detail).slice(0, 200)}`}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const newContext = () => browser.newContext({ viewport: { width: 1384, height: 853 }, locale: 'en-US' });

const rpc = (page, name, body = {}) => page.evaluate(async ([n, b]) => {
  const r = await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [name, body]);
const idFromUrl = (url) => {
  const hex = String(url).match(/([0-9a-f]{32})(?:[?#].*)?$/)?.[1] ?? '';
  return hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : '';
};
async function account(page) {
  const rm = (await rpc(page, 'loadAccountData')).body?.recordMap ?? {};
  return { spaceId: Object.keys(rm.space ?? {})[0], userId: Object.keys(rm.user_root ?? {})[0], recordMap: rm };
}

/** A new visitor: login page → "Try the demo" → "Start here". Returns the page, its ids and the time it took. */
async function visitor(label) {
  const ctx = await newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[pageerror ${label}]`, e.message));
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/login/);
  const button = page.locator('[data-testid="try-demo"]');
  await button.waitFor({ timeout: 15000 });
  const started = Date.now();
  await button.click();
  await page.waitForURL(/Start-here-[0-9a-f]{32}/, { timeout: 20000 });
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await page.locator('h1[data-content-editable-leaf]', { hasText: 'Start here' }).first().waitFor({ timeout: 20000 });
  const ms = Date.now() - started;
  const acct = await account(page);
  return { ctx, page, ms, pageId: idFromUrl(page.url()), ...acct };
}

// ---- the login page
{
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/login/);
  await page.locator('[data-testid="try-demo"]').waitFor({ timeout: 15000 });
  const text = await page.locator('.nc-auth-login').innerText();
  check('login page offers "Try the demo" with the sandbox explanation', /Try the demo/.test(text) && /own temporary workspace/.test(text) && /deleted after \d+ hours/.test(text) && /No sign-up/.test(text), text.slice(0, 200));
  const emailFields = await page.locator('#email').count();
  if (SHARED_EMAIL) check('the email form stays for the shared account', emailFields === 1);
  else check('without a shared account the email form is hidden', emailFields === 0);
  await ctx.close();
}

// ---- visitor A lands in a seeded workspace
const a = await visitor('A');
check(`visitor A lands on "Start here" in ${a.ms} ms`, a.ms < 10000 && !!a.pageId, a.page.url());
const notice = await a.page.locator('.lp-demo-notice').innerText().catch(() => '');
check('notice bar explains the sandbox and offers "Start over"', /Demo sandbox/.test(notice) && /only yours/.test(notice) && /personal information/.test(notice) && /Start over/.test(notice), notice);
const sidebarA = await a.page.locator('nav.lit-sidebar-container').innerText();
check('sample pages are in the sidebar', ['Start here', 'Roadmap', 'Projects', 'Meeting notes', 'Team wiki'].every((t) => sidebarA.includes(t)), sidebarA.slice(0, 300));
const startText = await a.page.locator('.nc-frame-content').innerText();
check('"Start here" lists things to try', /Things to try/.test(startText) && /Timeline/.test(startText) && /second browser tab/.test(startText) && /AI is not connected/.test(startText), startText.slice(0, 300));
const workspaceName = Object.values(a.recordMap.space ?? {})[0]?.value?.value?.name;
check('the workspace is "Litpage Demo"', workspaceName === 'Litpage Demo', workspaceName);

// ---- visitor B gets a separate workspace and cannot see A
const b = await visitor('B');
check('visitor B gets another workspace and account', !!b.spaceId && b.spaceId !== a.spaceId && b.userId !== a.userId, `${a.spaceId} ${b.spaceId}`);

// ---- editing works, and a second tab of the same sandbox sees it live
const marker = `Zebra${Date.now().toString(36)}`;
const tab2 = await a.ctx.newPage();
await tab2.goto(a.page.url());
await tab2.locator('h1[data-content-editable-leaf]', { hasText: 'Start here' }).first().waitFor({ timeout: 20000 });
await tab2.waitForTimeout(800);
const title = a.page.locator('h1[data-content-editable-leaf]').first();
await title.click();
await a.page.keyboard.press('End');
await a.page.keyboard.type(` ${marker}`);
const live = await tab2.locator('h1[data-content-editable-leaf]', { hasText: marker }).first().waitFor({ timeout: 8000 }).then(() => true, () => false);
check('a second tab of the same sandbox shows the edit live', live);
await a.page.waitForTimeout(600);
const saved = await rpc(a.page, 'loadPage', { pageId: a.pageId });
check('the edit is saved', JSON.stringify(saved.body?.recordMap?.block?.[a.pageId] ?? {}).includes(marker));

// B can't read, find or reach A
const loadA = await rpc(b.page, 'loadPage', { pageId: a.pageId });
check('B cannot open A\'s page', !JSON.stringify(loadA.body).includes(marker) && !loadA.body?.recordMap?.block?.[a.pageId], JSON.stringify(loadA.body).slice(0, 160));
const fetchA = await rpc(b.page, 'fetchRecords', { requests: [{ pointer: { table: 'lit_user', id: a.userId } }, { pointer: { table: 'space', id: a.spaceId } }] });
check('B cannot look up A\'s guest or workspace', !JSON.stringify(fetchA.body).includes(a.userId) && !JSON.stringify(fetchA.body).includes(a.spaceId), JSON.stringify(fetchA.body).slice(0, 160));
const searchB = await rpc(b.page, 'searchWorkspace', { query: marker, spaceId: b.spaceId });
const searchCross = await rpc(b.page, 'searchWorkspace', { query: marker, spaceId: a.spaceId });
check('B cannot find A\'s text by search', !JSON.stringify(searchB.body).includes(marker) && !JSON.stringify(searchCross.body).includes(marker));
const peopleB = await rpc(b.page, 'searchPeople', { spaceId: b.spaceId, query: 'Guest' });
check('B\'s people search only finds B', JSON.stringify(peopleB.body?.userIds ?? []) === JSON.stringify([b.userId]), JSON.stringify(peopleB.body).slice(0, 160));
await b.page.goto(a.page.url());
await b.page.waitForTimeout(1500);
const bView = await b.page.locator('body').innerText();
check('opening A\'s page URL in B shows nothing of A', !bView.includes(marker), bView.slice(0, 200));

// ---- refusals (403 with the demo message)
const REFUSED = [
  ['changePassword', { password: 'another-password-123' }],
  ['startTotpEnrollment', {}],
  ['passkeyRegistrationOptions', {}],
  ['addSecondaryEmail', { email: 'someone@example.com' }],
  ['deleteAccount', {}],
  ['logoutOtherSessions', {}],
  ['deleteWorkspace', { spaceId: a.spaceId, confirmName: 'x' }],
  ['leaveSpace', { spaceId: a.spaceId }],
  ['setSpaceDomain', { spaceId: a.spaceId, domain: 'taken-over' }],
  ['setMemberRole', { spaceId: a.spaceId, userId: a.userId, role: 'reader' }],
  ['inviteMembers', { spaceId: a.spaceId, emails: ['someone@example.com'] }],
  ['setInviteLinkEnabled', { spaceId: a.spaceId, enabled: true }],
  ['setAllowedEmailDomains', { spaceId: a.spaceId, domains: ['example.com'] }],
  ['mcpCreateToken', { spaceId: a.spaceId, name: 'x' }],
  ['devCreateConnection', { spaceId: a.spaceId, name: 'x' }],
  ['setSiteSettings', { spaceId: a.spaceId }],
  ['createWorkspace', { name: 'Another' }],
  ['reviewTemplate', { templateId: 'roadmap', rating: 5 }],
];
for (const [name, body] of REFUSED) {
  const r = await rpc(a.page, name, body);
  check(`refuses ${name}`, r.status === 403 && /public demo/i.test(r.body?.message ?? ''), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
}
const tx = (page, spaceId, operations) => rpc(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations }] });
const pub = await tx(a.page, a.spaceId, [{ pointer: { table: 'block', id: a.pageId, spaceId: a.spaceId }, path: ['permissions'], command: 'set', args: [{ type: 'public_permission', role: 'reader' }] }]);
check('transaction cannot make a page public', pub.status >= 400, `${pub.status}`);
const shareB = await tx(a.page, a.spaceId, [{ pointer: { table: 'block', id: a.pageId, spaceId: a.spaceId }, path: ['permissions'], command: 'set', args: [{ type: 'user_permission', role: 'editor', user_id: a.userId }, { type: 'user_permission', role: 'editor', user_id: b.userId }] }]);
check('transaction cannot share a page with another visitor', shareB.status >= 400, `${shareB.status}`);
const intoA = await tx(b.page, a.spaceId, [{ pointer: { table: 'block', id: a.pageId, spaceId: a.spaceId }, path: ['properties', 'title'], command: 'set', args: [['Taken over']] }]);
check('B cannot write into A\'s workspace', intoA.status >= 400, `${intoA.status}`);
const rename = await tx(a.page, a.spaceId, [{ pointer: { table: 'lit_user', id: a.userId }, path: ['name'], command: 'set', args: 'Taken over' }]);
check('transaction cannot rename the guest', rename.status >= 400, `${rename.status}`);

// ---- uploads: 1 MB ok, 6 MB refused; files only reach their own sandbox
const up = (page, spaceId, bytes) => page.evaluate(async ([n, s]) => {
  const r = await fetch(`/api/upload?name=f.bin&type=application/octet-stream&spaceId=${s}`, { method: 'POST', body: new Uint8Array(n) });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, [bytes, spaceId]);
const small = await up(a.page, a.spaceId, 1024 * 1024);
check('1 MB upload is accepted', small.status === 200, `${small.status}`);
const big = await up(a.page, a.spaceId, 6 * 1024 * 1024);
check('6 MB upload is refused', big.status === 413, `${big.status}`);
if (small.body?.url) {
  const anon = await fetch(new URL(small.body.url, BASE));
  check('uploaded files are not served without signing in', anon.status === 403, `${anon.status}`);
  const other = await b.page.evaluate(async (u) => (await fetch(u)).status, small.body.url);
  check('A\'s file is not served to B', other === 404, `${other}`);
  const own = await a.page.evaluate(async (u) => (await fetch(u)).status, small.body.url);
  check('A\'s file is served to A', own === 200, `${own}`);
}

// ---- REST API and MCP endpoint
const rest = await fetch(new URL('/v1/users/me', BASE), { headers: { authorization: 'Bearer lp_int_x' } });
check('REST API is closed', rest.status === 403, `${rest.status}`);
const mcp = await fetch(new URL('/api/mcp', BASE), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }) });
check('MCP endpoint is closed', mcp.status === 403, `${mcp.status}`);

// ---- "Start over": a fresh workspace; the other tab of the old sandbox goes back to the login page
const oldUrl = a.page.url();
await a.page.locator('.lp-demo-notice-action', { hasText: 'Start over' }).click();
await a.page.waitForURL((u) => /Start-here-[0-9a-f]{32}/.test(String(u)) && String(u) !== oldUrl, { timeout: 20000 });
await a.page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
const fresh = await account(a.page);
const freshTitle = await a.page.locator('h1[data-content-editable-leaf]').first().innerText();
check('"Start over" opens a fresh workspace', !!fresh.spaceId && fresh.spaceId !== a.spaceId && !freshTitle.includes(marker), `${fresh.spaceId} ${freshTitle}`);
// the other tab shares this browser's session, so it follows to the new sandbox
const tab2Moved = await tab2.waitForURL((u) => idFromUrl(u) && idFromUrl(u) !== a.pageId, { timeout: 15000 }).then(() => true, () => false);
check('the old sandbox\'s other tab leaves the deleted workspace', tab2Moved && idFromUrl(tab2.url()) === idFromUrl(a.page.url()), tab2.url());
// a visitor whose sandbox is gone (B's, deleted by its own "Start over" in another browser) gets the login page
const bCookies = await b.ctx.cookies();
const bOther = await browser.newContext({ viewport: { width: 1384, height: 853 }, locale: 'en-US' });
await bOther.addCookies(bCookies);
const bOtherPage = await bOther.newPage();
await bOtherPage.goto(`${BASE}/`);
await bOtherPage.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
await b.page.goto(`${BASE}/`);
await b.page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
await b.page.locator('.lp-demo-notice-action', { hasText: 'Start over' }).click();
await b.page.waitForURL((u) => idFromUrl(u) && idFromUrl(u) !== b.pageId, { timeout: 20000 });
const bBack = await bOtherPage.waitForURL(/\/login/, { timeout: 15000 }).then(() => bOtherPage.locator('[data-testid="try-demo"]').waitFor({ timeout: 10000 })).then(() => true, () => false);
check('a browser whose sandbox was deleted returns to the login page with "Try the demo"', bBack, bOtherPage.url());
const oldPage = await rpc(a.page, 'loadPage', { pageId: a.pageId });
check('the old sandbox is gone', !oldPage.body?.recordMap?.block?.[a.pageId]);

// ---- the shared account still signs in when the operator configured one
if (SHARED_EMAIL && SHARED_PASSWORD) {
  const ctx = await newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`);
  await page.waitForURL(/\/login/);
  await page.fill('#email', SHARED_EMAIL);
  await page.click('button[type=submit]');
  await page.getByText('Continue with a password').first().click();
  await page.fill('input[type=password]', SHARED_PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 30000 }).then(() => check('the shared account still signs in', true), (e) => check('the shared account still signs in', false, e.message));
  await ctx.close();
}

await browser.close();
console.log(`demo-mode: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

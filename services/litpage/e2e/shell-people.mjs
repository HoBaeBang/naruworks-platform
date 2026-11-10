// Shell: people & accounts: hover card on an @mention, profile page, People Directory
// with guests, guest → member upgrade from the card, multiple accounts in one browser
// (Add account → login → switcher lists the other account → switch back → Sign out everywhere).
// Run: NC_BASE=http://127.0.0.1:5441 node e2e/shell-people.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, CHROME } from './lib.mjs';
import { apiLogin, call, compact, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/people';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return p;
};

try {
  const A = await mk();
  const X = await mk();
  const id = uniq();
  const a = await apiLogin(A, { email: `paula${id}@test.dev`, name: 'Paula Owner', workspace: 'People Co' });
  const spaceId = a.spaceId;
  const bEmail = `brian${id}@test.dev`;
  await call(A, 'inviteMembers', { spaceId, emails: [bEmail], role: 'editor' });
  const b = await apiLogin(X, { email: bEmail, name: 'Brian Member', createWorkspace: false });
  // a guest on one page
  const gEmail = `gus${id}@else.dev`;
  const pageId = await createPrivatePage(A, spaceId, 'Team notes');
  await call(A, 'invitePagePermissions', { pageId, emails: [gEmail], role: 'reader' });
  // a block mentioning Brian
  await A.evaluate(async ([pageId, uid, spaceId]) => {
    const bid = crypto.randomUUID();
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: bid, spaceId }, path: [], command: 'set', args: { id: bid, type: 'text', parent_id: pageId, parent_table: 'block', space_id: spaceId, alive: true, properties: { title: [['Owner: '], ['‣', [['u', uid]]]] } } },
      { pointer: { table: 'block', id: pageId, spaceId }, path: ['content'], command: 'listAfter', args: { id: bid } },
    ] }] }) });
  }, [pageId, b.userId, spaceId]);
  const domain = await A.evaluate(() => location.pathname.split('/')[1]);
  await A.goto(`${BASE}/${domain}/Team-notes-${compact(pageId)}`);
  await A.waitForSelector('.lit-user-mention-token');
  await A.hover('.lit-user-mention-token');
  await A.waitForSelector('.nc-person-card-body', { timeout: 5000 });
  await A.waitForTimeout(500);
  const card = await A.textContent('.nc-person-card-body');
  r.ok(/Brian Member/.test(card ?? '') && new RegExp(bEmail).test(card ?? '') && /Member/.test(card ?? ''), `hover card: "${card?.slice(0, 90)}"`);
  r.ok(/local time/.test(card ?? ''), 'hover card shows local time');
  await A.screenshot({ path: `${OUT}/01-hover-card.png` });
  await A.click('.nc-person-card-btn:has-text("View profile")');
  await A.waitForSelector('.nc-profile');
  r.ok(/Brian Member/.test(await A.textContent('.nc-profile-name') ?? ''), 'profile page opens');
  r.ok(/Teams/.test(await A.textContent('.nc-profile') ?? '') && /General/.test(await A.textContent('.nc-profile') ?? ''), 'profile lists teamspaces');
  r.ok(/People Directory/.test(await A.textContent('.lit-topbar') ?? ''), 'breadcrumb "People Directory / Brian Member"');
  await A.screenshot({ path: `${OUT}/02-profile.png` });

  // directory
  await A.click('.lit-topbar .nc-crumb:has-text("People Directory")');
  await A.waitForSelector('.nc-ppl-row[data-user-id]');
  const rows = await A.$$eval('.nc-ppl-row[data-user-id]', (els) => els.map((e) => e.textContent));
  r.ok(rows.length === 2 && /Workspace Owner/.test(rows[0] ?? '') && /Member/.test(rows[1] ?? ''), `directory lists owner + member (${rows.length})`);
  await A.check('.nc-ppl-guests input');
  await waitFor(async () => (await A.$$('.nc-ppl-row[data-user-id]')).length === 3);
  const withGuests = await A.$$eval('.nc-ppl-row[data-user-id]', (els) => els.map((e) => e.textContent));
  r.ok(withGuests.some((x) => /Guest/.test(x ?? '') && x?.includes(gEmail)), 'Include guests shows the guest');
  await A.fill('.nc-ppl-search input', 'brian');
  await waitFor(async () => (await A.$$('.nc-ppl-row[data-user-id]')).length === 1);
  r.ok((await A.$$('.nc-ppl-row[data-user-id]')).length === 1, 'search filters the directory');
  await A.screenshot({ path: `${OUT}/03-directory.png` });

  // guest → member from the hover card on the guest's directory row (owner = "Upgrade to member")
  await A.fill('.nc-ppl-search input', '');
  await waitFor(async () => (await A.$$('.nc-ppl-row[data-user-id]')).length === 3);
  const guestId = await A.$$eval('.nc-ppl-row[data-user-id]', (els, e) => els.find((x) => x.textContent.includes(e))?.getAttribute('data-user-id'), gEmail);
  const res = await call(A, 'getPersonProfile', { spaceId, userId: guestId });
  r.ok(res.profile?.role === 'guest', 'guest profile role = guest');

  // ---- multiple accounts
  const dEmail = `dora${id}@test.dev`;
  await apiLogin(X, { email: dEmail, name: 'Dora Other', workspace: 'Dora HQ' }); // create Dora's account + workspace
  await A.goto(BASE + '/');
  await A.waitForSelector('nav .lit-sidebar-switcher');
  await A.click('nav .lit-sidebar-switcher');
  await A.click('.nc-ws-menu-row:has-text("Add account")');
  await A.waitForSelector('.nc-ws-add-account');
  await A.screenshot({ path: `${OUT}/04-add-account.png` });
  await A.click('.nc-ws-add-account .nc-btn.primary');
  await A.waitForSelector('#email');
  r.ok(/Add a different account/.test(await A.textContent('.nc-auth-addaccount') ?? ''), 'login screen in add-account mode');
  await A.fill('#email', dEmail);
  await A.click('button[type=submit]');
  await A.waitForSelector('#code');
  const code = (await A.locator('.nc-auth-hint b').textContent()).trim();
  await A.fill('#code', code);
  await A.click('button[type=submit]');
  await A.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  r.ok(/Dora HQ/.test(await A.textContent('nav .lit-sidebar-switcher') ?? ''), 'now signed in as the added account');
  await A.click('nav .lit-sidebar-switcher');
  await A.waitForSelector('.nc-ws-other-account');
  const other = await A.textContent('.nc-ws-other-account');
  r.ok(new RegExp(a.email).test(other ?? '') && /People Co/.test(other ?? ''), `switcher lists the other account and its workspace`);
  r.ok(/Sign out everywhere/.test(await A.textContent('.nc-ws-logout') ?? ''), '"Sign out everywhere" when several accounts are signed in');
  await A.screenshot({ path: `${OUT}/05-switcher-accounts.png` });
  await A.click('.nc-ws-other-account .nc-ws-row:has-text("People Co")');
  await A.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await waitFor(async () => /People Co/.test(await A.textContent('nav .lit-sidebar-switcher') ?? ''));
  r.ok(/People Co/.test(await A.textContent('nav .lit-sidebar-switcher') ?? ''), 'switched back to the first account');
  const accounts = await call(A, 'getAccounts', {});
  r.ok(accounts.accounts?.length === 2 && !JSON.stringify(accounts).match(/[0-9a-f]{64}/), 'two accounts listed, no session tokens exposed');
  await A.click('nav .lit-sidebar-switcher');
  await A.click('.nc-ws-menu-row .nc-ws-logout');
  await A.click('.nc-ws-add-account .nc-btn.danger');
  await A.waitForURL(/\/login/);
  const after = await call(A, 'getAccounts', {});
  r.ok(after.__error === 401, 'every account is logged out');
} catch (e) {
  console.log('FAIL exception', e.message.slice(0, 800));
  process.exitCode = 1;
} finally {
  await browser.close();
  r.done();
}

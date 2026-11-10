// Shell: Inbox panel — docked panel geometry, grouped feed, unread dot + sidebar badge, hover actions (read/unread,
// archive), filter menu (Status / Type), More actions (Mark all as read / Archive all), open item, pin, Esc.
// Seeds notifications through the dev-only createTestNotification endpoint. Run: cd e2e && node shell-inbox.mjs
import { mkdirSync } from 'node:fs';
import { launch, BASE } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/inbox';
mkdirSync(OUT, { recursive: true });

/** Sign up through the API (independent of the login/onboarding UI, which other agents are changing). */
async function apiSignup(page, name = 'Test User', ws = 'Acme') {
  const email = `e2e${Date.now()}${Math.floor(Math.random() * 1000)}@test.dev`;
  await page.goto(BASE + '/login');
  await page.evaluate(async ([email, name, ws]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const { devCode } = await post('sendSignInCode', { email });
    const { userId } = await post('signInWithEmail', { email, code: devCode });
    await post('applyChanges', { requestId: crypto.randomUUID(), transactions: [{ id: crypto.randomUUID(), spaceId: '', operations: [{ pointer: { table: 'lit_user', id: userId }, path: [], command: 'update', args: { name, given_name: name, onboarding_completed: true } }] }] });
    await post('createWorkspace', { name: ws });
  }, [email, name, ws]);
  await page.goto(BASE + '/');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await page.waitForTimeout(800);
  return email;
}

const { browser, page } = await launch();
page.setDefaultTimeout(10000);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++; };
const call = (name, body) => page.evaluate(async ([n, b]) => {
  const r = await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return r.json();
}, [name, body]);
const badge = () => page.$eval('nav .nc-sb-badge', (e) => e.textContent).catch(() => null);

try {
  await apiSignup(page);
  const before = page.url();
  await page.keyboard.press('Meta+n');
  await page.waitForFunction((u) => location.href !== u, before);
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(300);
  await page.keyboard.type('Inbox Target');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Some text for the comment');
  await page.waitForTimeout(800);
  const pageId = await page.evaluate(() => (location.pathname.match(/([0-9a-f]{32})$/) || [])[1]);
  const uc = await call('loadAccountData', {});
  const spaceId = Object.keys(uc.recordMap.space)[0];
  const blockId = pageId.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
  await call('createTestNotification', { spaceId, type: 'mention', blockId });
  await call('createTestNotification', { spaceId, type: 'comment', blockId, text: 'Looks good — please review the latest section.' });
  await call('createTestNotification', { spaceId, type: 'invite', blockId });
  await page.waitForTimeout(1200);
  ok((await badge()) === '3', `sidebar badge shows 3 (got ${await badge()})`);

  await page.click('nav [aria-label="Inbox"]');
  await page.waitForSelector('.nc-inbox-panel');
  await page.waitForTimeout(800);
  await shot('01-panel');
  const box = await page.locator('.nc-inbox-panel').boundingBox();
  ok(box && Math.round(box.x) === 270 && Math.round(box.width) === 390 && Math.round(box.height) === 853, `docked 390px panel at x=270 (got ${box && JSON.stringify(box)})`);
  const rows = await page.$$eval('.nc-inbox-row', (els) => els.map((e) => e.querySelector('.nc-inbox-headline')?.textContent ?? ''));
  ok(rows.length === 3, `3 notifications (got ${rows.length})`);
  ok(rows.some((r) => /tagged you in/.test(r)) && rows.some((r) => /added a comment to/.test(r)) && rows.some((r) => /sent you an invite to/.test(r)), `activity texts (${rows.join(' | ')})`);
  ok((await page.$$('.nc-inbox-dot')).length === 3, '3 unread dots');
  const group = await page.textContent('.nc-inbox-group');
  ok(group === 'Today', `group header "${group}"`);

  // hover → action bar → mark read
  const first = page.locator('.nc-inbox-row').first();
  await first.hover();
  await page.waitForTimeout(300);
  await shot('02-item-hover');
  await first.locator('[aria-label="Set notification to read"]').click();
  await page.waitForTimeout(900);
  ok((await page.$$('.nc-inbox-dot')).length === 2, 'mark read removes a dot');
  ok((await badge()) === '2', `badge updates to 2 (got ${await badge()})`);

  // filter menu: Unread
  await page.click('.nc-inbox-panel [aria-label="Filter notifications"]');
  await page.waitForTimeout(300);
  await shot('03-filter-menu');
  await page.getByRole('menuitemradio', { name: 'Unread', exact: true }).click();
  await page.waitForTimeout(800);
  ok((await page.$$('.nc-inbox-row')).length === 2, 'Unread filter shows 2');
  await page.click('.nc-inbox-filter-menu [role=menuitemradio]:has-text("Unread & read")');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');

  // archive one → Archived filter shows it
  const second = page.locator('.nc-inbox-row').nth(1);
  await second.hover();
  await second.locator('[aria-label="Archive notification"]').click();
  await page.waitForTimeout(800);
  ok((await page.$$('.nc-inbox-row')).length === 2, 'archived item leaves the list');
  await page.click('.nc-inbox-panel [aria-label="Filter notifications"]');
  await page.click('.nc-inbox-filter-menu [role=menuitemradio]:has-text("Archived")');
  await page.waitForTimeout(800);
  ok((await page.$$('.nc-inbox-row')).length === 1, 'Archived filter shows 1');
  await page.click('.nc-inbox-filter-menu [role=menuitemradio]:has-text("Unread & read")');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // More actions → Clear all unread (mark all as read)
  await page.click('.nc-inbox-panel [aria-label="More actions"]');
  await page.waitForTimeout(300);
  await shot('04-more-menu');
  await page.click('.nc-overlay .nc-menu-item:has-text("Clear all unread")');
  await page.waitForTimeout(1000);
  ok((await page.$$('.nc-inbox-dot')).length === 0, 'no unread dots after Clear all unread');
  ok((await badge()) === null, 'badge cleared');

  // pin keeps the panel open on outside click; Esc ignored while pinned
  await page.click('.nc-inbox-panel [aria-label="Pin"]');
  await page.mouse.click(1100, 500);
  await page.waitForTimeout(300);
  ok(!!(await page.$('.nc-inbox-panel')), 'pinned panel stays open');
  await page.click('.nc-inbox-panel [aria-label="Unpin"]');

  // open an item → navigates + closes
  await page.click('nav [aria-label="Search or ask"]').catch(() => {});
  await page.keyboard.press('Escape');
  if (!(await page.$('.nc-inbox-panel'))) await page.click('nav [aria-label="Inbox"]');
  await page.waitForSelector('.nc-inbox-panel');
  await page.locator('.nc-inbox-row .nc-inbox-link').first().click();
  await page.waitForTimeout(800);
  ok(!(await page.$('.nc-inbox-panel')), 'opening an item closes the panel');
  ok(/Inbox-Target/.test(page.url()), `navigated to the page (${page.url()})`);

  // empty state + dark
  await page.click('nav [aria-label="Inbox"]');
  await page.click('.nc-inbox-panel [aria-label="More actions"]');
  await page.click('.nc-overlay .nc-menu-item:has-text("Archive all")');
  await page.waitForTimeout(900);
  await shot('05-empty');
  const empty = await page.textContent('.nc-inbox-empty-title').catch(() => null);
  ok(empty === 'You’re up to date', `empty state copy (${empty})`);
  await page.keyboard.press('Meta+Shift+l');
  await page.waitForTimeout(400);
  await shot('06-dark');
  await page.keyboard.press('Meta+Shift+l');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(!(await page.$('.nc-inbox-panel')), 'Esc closes the panel');
} catch (e) {
  failed++;
  console.log('E2E FAILED', e.message.split('\n')[0]);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;

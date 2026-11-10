// Shell: Trash popover (Apps menu › Trash) — list, search, filter pills, restore, permanent delete, keyboard.
// Run: cd e2e && node shell-trash.mjs
import { mkdirSync } from 'node:fs';
import { launch, signup } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/auth';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

async function makePage(title) {
  await page.mouse.click(900, 600);
  await page.keyboard.press('Meta+KeyN');
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type(title);
  await page.waitForTimeout(600);
  await page.evaluate(() => (document.activeElement)?.blur());
}

async function trashFromSidebar(title) {
  const row = page.locator('.nc-sb-page', { hasText: title }).first().locator('[role=treeitem]').first();
  await row.hover();
  await row.locator('.lit-sidebar-page-menu').click();
  await page.click('.lit-overlay-container [role=option]:has-text("Send to Trash")');
  await page.waitForTimeout(400);
}

// poll until fn() is truthy (the busy shared dev server can take a few seconds to save and list)
async function until(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

const rowCount = (title) => page.locator('.nc-trash-row', title ? { hasText: title } : {}).count();

/** Open Trash and wait for `expect` rows; the list loads once on open, so reopen while the trash saves are pending. */
async function openTrash(expect = 0) {
  for (let i = 0; i < 4; i++) {
    await page.click('nav .nc-sb-footer-btn[aria-haspopup="menu"]'); // "Library, Trash, and more…"
    await page.click('.lit-overlay-container [role=option]:has-text("Trash")');
    await page.waitForSelector('.nc-trash');
    if (await until(async () => (await rowCount()) >= expect, 5000)) break;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(500);
}

try {
  await signup(page);
  await page.waitForTimeout(500);
  for (const n of ['Trash Alpha', 'Trash Beta', 'Trash Gamma']) await makePage(n);
  for (const n of ['Trash Alpha', 'Trash Beta', 'Trash Gamma']) await trashFromSidebar(n);

  await openTrash(3);
  await shot('30-trash');
  const box = await page.locator('.nc-trash').boundingBox();
  ok(box && Math.round(box.width) === 414, `popover 414 wide (got ${box?.width})`);
  ok(box && Math.abs(Math.round(box.x) - 234) <= 2, `popover left at x≈234 (got ${box?.x})`);
  let titles = await page.$$eval('.nc-trash-row .nc-trash-row-title', (els) => els.map((e) => e.textContent));
  ok(['Trash Alpha', 'Trash Beta', 'Trash Gamma'].every((n) => titles.includes(n)), `3 trashed pages listed (${titles.join(', ')})`);
  ok(await page.locator('.nc-trash-pill.active', { hasText: 'Last changed by' }).count() === 1, '"Last changed by" defaults to me (active)');

  // search
  await page.fill('.nc-trash-search input', 'beta');
  await until(async () => (await rowCount()) === 1);
  titles = await page.$$eval('.nc-trash-row .nc-trash-row-title', (els) => els.map((e) => e.textContent));
  ok(titles.length === 1 && titles[0] === 'Trash Beta', 'search filters the list');
  await page.fill('.nc-trash-search input', '');
  await until(async () => (await rowCount()) >= 3);

  // hover + pills
  await page.locator('.nc-trash-row').first().hover();
  await shot('31-trash-row-hover');
  await page.click('.nc-trash-pill:has-text("Last changed by")');
  await page.waitForTimeout(300);
  await shot('32-trash-filter-people');
  await page.keyboard.press('Escape');
  await page.click('.nc-trash-pill:has-text("In")');
  await page.waitForTimeout(400);
  await shot('33-trash-filter-in');
  await page.keyboard.press('Escape');
  await page.click('.nc-trash-pill:has-text("Teams")');
  await page.waitForTimeout(300);
  await shot('34-trash-filter-teamspaces');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // restore Alpha
  const alpha = page.locator('.nc-trash-row', { hasText: 'Trash Alpha' });
  await alpha.hover();
  await alpha.locator('[aria-label="Restore page"]').click();
  await until(async () => (await page.locator('nav .nc-sb-page', { hasText: 'Trash Alpha' }).count()) > 0);
  ok(await page.locator('.nc-trash-row', { hasText: 'Trash Alpha' }).count() === 0, 'restored row leaves the list');
  ok(await page.locator('nav .nc-sb-page', { hasText: 'Trash Alpha' }).count() > 0, 'restored page is back in the sidebar');

  // permanently delete Gamma
  const gamma = page.locator('.nc-trash-row', { hasText: 'Trash Gamma' });
  await gamma.hover();
  await gamma.locator('[aria-label="Permanently delete"]').click();
  await page.waitForSelector('.nc-trash-confirm');
  await shot('35-trash-confirm');
  await page.click('.nc-trash-confirm-danger');
  await until(async () => (await rowCount('Trash Gamma')) === 0);
  ok(await page.locator('.nc-trash-row', { hasText: 'Trash Gamma' }).count() === 0, 'permanently deleted row removed');

  // keyboard: ↓ + ↵ opens the remaining page
  await page.click('.nc-trash-search input');
  await page.keyboard.press('Enter');
  await until(() => /Trash-Beta/.test(page.url()), 5000);
  ok(/Trash-Beta/.test(page.url()), `Enter opens the trashed page (${page.url()})`);
  await shot('36-trash-opened-page');
} catch (e) {
  console.log('E2E FAILED', e.message);
  failures++;
  await shot('error-trash');
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exitCode = failures ? 1 : 0;

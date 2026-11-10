// Shell: sidebar anatomy, tabs, sections, menus, customize mode, close/peek/resize, drag & drop.
// Run: cd e2e && node shell-sidebar.mjs (screenshots → $NC_SHOTS or /tmp/nc-e2e/e2e-shell/sidebar)
import { mkdirSync } from 'node:fs';
import { launch, signup } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/sidebar';
mkdirSync(OUT, { recursive: true });
const only = process.argv[2];
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
try {
  await signup(page);
  await page.waitForTimeout(800);
  await shot('01-baseline');
  const box = await page.locator('nav.lit-sidebar-container').boundingBox();
  ok(Math.round(box.width) === 270, `sidebar width 270 (got ${box.width})`);
  const search = await page.locator('nav .nc-sb-search').boundingBox(); // "Search or ask here" pill
  ok(search && Math.round(search.x) === 12 && Math.round(search.y) === 44 && Math.round(search.width) === 246, `search pill at 12,44 246 wide (got ${JSON.stringify(search)})`);
  const tab = await page.locator('nav [role=tab][aria-label="Home"]').boundingBox();
  ok(tab && Math.round(tab.y) === 88 && Math.round(tab.height) === 32, `home tab y=88 h=32 (got ${JSON.stringify(tab)})`);
  // New page via the "New…" menu
  await page.click('nav [aria-label="New page"]');
  await page.waitForTimeout(300);
  await shot('02-new-menu');
  await page.keyboard.press('Escape');
  // section header hover + menu
  await page.hover('.lit-outliner-private-header');
  await page.waitForTimeout(300);
  await shot('03-private-header-hover');
  await page.click('.lit-outliner-private-header [aria-label="Open menu"]', { force: true });
  await page.waitForTimeout(300);
  await shot('04-private-section-menu');
  await page.keyboard.press('Escape');
  // add pages to private
  for (let i = 0; i < 2; i++) {
    await page.waitForTimeout(800);
    await page.hover('.lit-outliner-private-header');
    await page.click('.lit-outliner-private-header [aria-label="Create a page"]', { force: true });
    await page.waitForSelector('h1[data-content-editable-leaf]');
    await page.keyboard.type(`Sidebar Page ${i + 1}`);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(600);
  await shot('05-pages-added');
  const rows = await page.$$eval('.lit-outliner-private-header-container [role=treeitem]', (els) => els.map((e) => e.textContent.trim()));
  console.log('private rows:', rows);
  ok(rows.some((r) => r.includes('Sidebar Page 2')), 'new page appears in Private');
  // row hover + menu
  const row = page.locator('.lit-outliner-private-header-container [role=treeitem]').first();
  await row.hover();
  await page.waitForTimeout(200);
  await shot('06-row-hover');
  await row.locator('.lit-sidebar-page-menu').click({ force: true }); // "Duplicate, delete, and other options…"
  await page.waitForTimeout(300);
  await shot('07-row-menu');
  await page.keyboard.press('Escape');
  // drag page 1 into page 2 (inside)
  const src = page.locator('.lit-outliner-private-header-container [role=treeitem]', { hasText: 'Sidebar Page 1' });
  const dst = page.locator('.lit-outliner-private-header-container [role=treeitem]', { hasText: 'Sidebar Page 2' });
  await src.dragTo(dst, { targetPosition: { x: 100, y: 15 } });
  await page.waitForTimeout(800);
  await shot('08-after-drag-inside');
  const nested = await page.$$eval('.lit-outliner-private-header-container [role=treeitem]', (els) => els.map((e) => `${e.textContent.trim()}|${e.getAttribute('aria-expanded')}`));
  console.log('after drag:', nested);
  ok(nested.some((r) => r.startsWith('Sidebar Page 2|true')) && nested.some((r) => r.startsWith('Sidebar Page 1')), 'drag inside nests page 1 under expanded page 2');
  // tabs
  await page.click('nav [role=tab][aria-label="Chat"]');
  await page.waitForTimeout(300);
  await shot('09-chat-tab');
  await page.click('nav [role=tab][aria-label="Meetings"]');
  await page.waitForTimeout(300);
  await shot('10-meetings-tab');
  await page.click('nav [role=tab][aria-label="Home"]');
  await page.waitForTimeout(200);
  await page.click('nav [role=tab][aria-label="Home"]');
  await page.waitForTimeout(300);
  await shot('11-home-tab-menu');
  await page.keyboard.press('Escape');
  // customize mode
  await page.click('nav [aria-label="Customize sidebar"]');
  await page.waitForTimeout(400);
  await shot('12-customize');
  await page.click('text=Add section');
  await page.waitForTimeout(300);
  await shot('13-customize-add-section');
  await page.keyboard.press('Escape');
  await page.click('nav [aria-label="Done"]');
  await page.waitForTimeout(300);
  // workspace switcher / help / apps
  await page.click('nav .lit-sidebar-switcher');
  await page.waitForTimeout(300);
  await shot('14-workspace-menu');
  await page.keyboard.press('Escape');
  await page.click('nav .nc-sb-footer-btn[aria-haspopup="dialog"]'); // "Help, contact, and more…" (badged label only for unseen releases)
  await page.waitForTimeout(300);
  await shot('15-help-menu');
  await page.keyboard.press('Escape');
  await page.click('nav .nc-sb-footer-btn[aria-haspopup="menu"]'); // "Library, Trash, and more…"
  await page.waitForTimeout(300);
  await shot('16-apps-menu');
  await page.keyboard.press('Escape');
  // close + peek
  await page.click('nav [aria-label="Close sidebar"]');
  await page.waitForTimeout(500);
  await shot('17-closed');
  await page.hover('.lit-topbar .nc-topbar-sidebar-btn'); // "Keep the sidebar open"
  await page.waitForTimeout(500);
  await shot('18-peek');
  await page.mouse.move(900, 400);
  await page.waitForTimeout(600);
  await page.keyboard.press('Meta+Backslash');
  await page.waitForTimeout(500);
  await shot('19-reopened');
  // dark
  await page.keyboard.press('Meta+Shift+L');
  await page.waitForTimeout(400);
  await shot('20-dark');
  await page.keyboard.press('Meta+Shift+L');
} catch (e) {
  console.log('E2E FAILED', e.message);
  process.exitCode = 1;
  await shot('error');
} finally {
  await browser.close();
}

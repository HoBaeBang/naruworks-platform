// Shell: app-level keyboard shortcuts + Keyboard shortcuts modal. Run: cd e2e && node shell-shortcuts.mjs
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
const html = (cls) => page.evaluate((c) => document.documentElement.classList.contains(c), cls);
// page id at the end of the URL (the title slug in front of it can change while typing)
const pid = (u) => (u.match(/([0-9a-f]{32})(?:[?#]|$)/) ?? [])[1] ?? u;
try {
  await signup(page);
  await page.waitForTimeout(600);
  await page.mouse.click(900, 600);

  // keyboard shortcuts modal: ⌘⌥/
  await page.keyboard.press('Meta+Alt+Slash');
  await page.waitForSelector('.nc-kbd-dialog');
  await page.waitForTimeout(300);
  await shot('20-shortcuts-modal');
  const box = await page.locator('.nc-kbd-dialog').boundingBox();
  ok(box && Math.round(box.width) === 960 && Math.round(box.height) === 700, `modal 960×700 (got ${box && `${box.width}×${box.height}`})`);
  ok(await page.locator('.nc-kbd-row').count() >= 90, 'all shortcut rows rendered');
  await page.click('.nc-kbd-tab:has-text("Edit & move")');
  await page.waitForTimeout(800);
  ok(await page.locator('.nc-kbd-tab.selected', { hasText: 'Edit & move' }).count() === 1, 'tab click selects Edit & move');
  await shot('21-shortcuts-edit-move');
  await page.click('.nc-kbd-tab:has-text("more…")');
  await page.waitForTimeout(200);
  await shot('22-shortcuts-more');
  await page.click('.lit-overlay-container [role=option]:has-text("Slash commands")');
  await page.waitForTimeout(800);
  ok(await page.locator('.nc-kbd-tab.selected', { hasText: 'more…' }).count() === 1, 'more… selected after jumping to Slash commands');
  await page.click('.nc-kbd-iconbtn.round');
  await page.keyboard.type('bold');
  await page.waitForTimeout(200);
  const rows = await page.$$eval('.nc-kbd-row .nc-kbd-action', (els) => els.map((e) => e.textContent));
  ok(rows.length >= 2 && rows.every((r) => /bold/i.test(r)), `search filters rows (${rows.join(' | ')})`);
  await shot('23-shortcuts-search');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(await page.locator('.nc-kbd-dialog').count() === 0, 'Esc closes the modal');

  // dark mode ⌘⇧L (persisted)
  const wasDark = await html('lit-dark-theme');
  await page.keyboard.press('Meta+Shift+KeyL');
  await page.waitForTimeout(400);
  ok((await html('lit-dark-theme')) !== wasDark, '⌘⇧L toggles dark mode');
  await shot('24-dark');
  await page.waitForTimeout(500);
  const pref = await page.evaluate(async () => {
    const r = await fetch('/api/rpc/loadAccountData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const j = await r.json();
    const s = Object.values(j.recordMap.user_settings ?? {})[0];
    return s?.value?.value?.settings?.preferred_theme;
  });
  ok(pref === (wasDark ? 'light' : 'dark'), `theme saved to user_settings (${pref})`);
  await page.keyboard.press('Meta+Shift+KeyL');
  await page.waitForTimeout(300);

  // high contrast ⌘⇧⌥L
  await page.keyboard.press('Meta+Shift+Alt+KeyL');
  await page.waitForTimeout(200);
  ok(await html('lit-high-contrast'), '⌘⇧⌥L enables high contrast');
  await page.keyboard.press('Meta+Shift+Alt+KeyL');
  await page.waitForTimeout(200);
  ok(!(await html('lit-high-contrast')), '⌘⇧⌥L disables high contrast');

  // sidebar ⌘\
  await page.keyboard.press('Meta+Backslash');
  await page.waitForTimeout(400);
  const w = (await page.locator('nav.lit-sidebar-container').boundingBox())?.width ?? -1;
  ok(Math.round(w) === 0, `⌘\\ closes the sidebar (width ${w})`);
  await page.keyboard.press('Meta+Backslash');
  await page.waitForTimeout(400);

  // search ⌘K / ⌘P
  await page.keyboard.press('Meta+KeyK');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !!document.querySelector('[role=dialog] input')), '⌘K opens search');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // inbox ⌘⌥U
  await page.keyboard.press('Meta+Alt+KeyU');
  await page.waitForTimeout(300);
  await shot('25-inbox-shortcut');
  await page.keyboard.press('Meta+Alt+KeyU');
  await page.waitForTimeout(200);

  // settings ⌘,
  await page.keyboard.press('Meta+Comma');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => document.querySelectorAll('[role=dialog]').length > 0), '⌘, opens settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // new page ⌘N, sub page, parent ⌘⇧U, back/forward
  await page.mouse.click(900, 600);
  await page.keyboard.press('Meta+KeyN');
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type('Shortcut Parent');
  await page.waitForTimeout(500);
  const parentUrl = page.url();
  await page.evaluate(() => (document.activeElement)?.blur());
  // child via the sidebar row's "Create a subpage" button
  const row = page.locator('.nc-sb-page', { hasText: 'Shortcut Parent' }).first().locator('[role=treeitem]').first();
  await row.hover();
  await row.locator('[aria-label="Create a subpage"]').click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type('Shortcut Child');
  await page.waitForTimeout(500);
  const childUrl = page.url();
  await page.evaluate(() => (document.activeElement)?.blur());
  await page.keyboard.press('Meta+Shift+KeyU');
  await page.waitForTimeout(500);
  ok(pid(page.url()) === pid(parentUrl), `⌘⇧U goes to the parent page (${page.url()})`);
  await page.keyboard.press('Meta+BracketLeft');
  await page.waitForTimeout(500);
  ok(pid(page.url()) === pid(childUrl), `⌘[ goes back (${page.url()})`);
  await page.keyboard.press('Meta+BracketRight');
  await page.waitForTimeout(500);
  ok(pid(page.url()) === pid(parentUrl), `⌘] goes forward (${page.url()})`);

  // copy link ⌘L (toast)
  await page.keyboard.press('Meta+KeyL');
  await page.waitForTimeout(300);
  ok(await page.locator('.nc-toast').count() > 0, '⌘L copies the page link (toast)');

  // AI ⌘⇧J dispatches nc:ask-ai
  await page.evaluate(() => { window.__askAi = 0; window.addEventListener('nc:ask-ai', () => { window.__askAi++; }); });
  await page.keyboard.press('Meta+Shift+KeyJ');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => window.__askAi) === 1, '⌘⇧J dispatches nc:ask-ai');
  await page.keyboard.press('Escape');
} catch (e) {
  console.log('E2E FAILED', e.message);
  failures++;
  await shot('error-shortcuts');
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exitCode = failures ? 1 : 0;

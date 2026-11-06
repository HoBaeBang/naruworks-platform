// Shell: create teamspace (Teamspaces section ••• → New team), teamspace row menu & settings modal,
// workspace switcher → Add workspace dialog.
import { mkdirSync } from 'node:fs';
import { launch, signup } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/sidebar';
mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
try {
  await signup(page);
  await page.waitForTimeout(800);
  await page.hover('.lit-outliner-team-header');
  await page.click('.lit-outliner-team-header [aria-label="Open menu"]', { force: true });
  await page.click('.lit-overlay-container [role=option]:has-text("New team")');
  await page.waitForTimeout(300);
  await shot('t01-create-teamspace');
  await page.keyboard.type('Engineering');
  await page.click('.nc-ts-dialog button:has-text("Create team")');
  await page.waitForTimeout(800);
  const teams = await page.$$eval('.lit-outliner-team', (els) => els.map((e) => e.textContent.trim()));
  ok(teams.some((x) => x.includes('Engineering')), `teamspace created (${teams.join(', ')})`);
  const row = page.locator('.lit-outliner-team', { hasText: 'Engineering' });
  await row.hover();
  await row.locator('.lit-outliner-team-context-menu-button').click({ force: true }); // "Members and team settings..."
  await page.waitForTimeout(300);
  await shot('t02-teamspace-menu');
  await page.click('.lit-overlay-container [role=option]:has-text("Team settings")');
  await page.waitForTimeout(400);
  await shot('t03-teamspace-settings');
  await page.click('.nc-ts-tab:has-text("Members")');
  await page.waitForTimeout(300);
  await shot('t04-teamspace-members');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  // add a page inside the teamspace
  await row.hover();
  await row.locator('[aria-label="Create a page"]').click({ force: true });
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type('Eng Roadmap');
  await page.waitForTimeout(900);
  const kids = await page.$$eval('.lit-outliner-team-container', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
  ok(kids.some((x) => x.includes('Eng Roadmap')), `team page shown under teamspace (${kids.join(' / ')})`);
  await shot('t05-team-page');
  // workspace switcher → Add workspace
  await page.click('nav .lit-sidebar-switcher');
  await page.click('.nc-ws-menu [role=menuitem]:has-text("Add workspace")');
  await page.waitForTimeout(300);
  await shot('t06-create-workspace');
  await page.fill('#nc-ws-name', 'Second WS');
  await page.click('.nc-ws-dialog-submit');
  // creating the workspace can take a few seconds on a busy dev server: wait for the switcher to change
  await page.waitForFunction(() => /Second WS/.test(document.querySelector('nav .lit-sidebar-switcher')?.textContent ?? ''), null, { timeout: 20000 }).catch(() => {});
  const wsName = await page.textContent('nav .lit-sidebar-switcher');
  ok(wsName.includes('Second WS'), `switched to new workspace (${wsName.trim()})`);
  await shot('t07-new-workspace');
} catch (e) {
  console.log('E2E FAILED', e.message.slice(0, 600));
  process.exitCode = 1;
  await shot('t-error');
} finally {
  await browser.close();
}

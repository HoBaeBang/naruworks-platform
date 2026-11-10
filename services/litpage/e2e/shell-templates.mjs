// Shell: Marketplace (Discover / Templates / detail), "Add to workspace" (template copy), Templates modal.
// Run: cd e2e && node shell-templates.mjs (screenshots → $NC_SHOTS or /tmp/nc-e2e/e2e-shell/templates)
import { mkdirSync } from 'node:fs';
import { launch, signup, BASE, hoverClick } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/templates';
mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch();
page.setDefaultTimeout(30000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
// empty page › "Templates" chip → Templates modal, then pick a template (retried once: the shared dev server may hot-reload)
const pickFromModal = async (name) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.locator('text=Templates').last().click();
    if (!(await page.waitForSelector('.nc-tmodal-layout', { timeout: 8000 }).catch(() => null))) continue;
    const item = page.locator(`.nc-tmodal-item:has-text("${name}")`).first();
    if (await item.waitFor({ timeout: 15000 }).then(() => true, () => false)) {
      await item.click();
      await page.waitForTimeout(1200);
      return true;
    }
  }
  return false;
};
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
try {
  await signup(page, `tpl${Date.now()}@test.dev`, 'Template Tester', 'Acme');
  const domain = new URL(page.url()).pathname.split('/').filter(Boolean)[0];
  // Discover
  await page.goto(`${BASE}/${domain}/marketplace`);
  await page.waitForSelector('[data-testid=marketplace] .nc-mkt-tabs');
  await page.waitForTimeout(800);
  await shot('01-discover');
  const tabs = await page.$$eval('.nc-mkt-tab', (els) => els.map((e) => e.textContent));
  ok(tabs.join('|') === 'Discover|Templates|Agents|Consultants|Skills|Connections', `tabs ${tabs.join('|')}`);
  // Templates tab
  await page.click('.nc-mkt-tab:has-text("Templates")');
  await page.waitForSelector('.nc-mkt-tpl-title');
  await page.waitForTimeout(500);
  await shot('02-templates');
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(400);
  await shot('03-templates-scrolled');
  // search filter
  await page.fill('.nc-mkt-search input', 'budget');
  await page.waitForTimeout(300);
  const found = await page.$$eval('.nc-mkt-grid-card', (els) => els.map((e) => e.getAttribute('data-template-id')));
  // (in the starter catalog only the Travel planner has budget content)
  ok(found.length === 1 && found[0] === 'travel-planner', `search "budget" → ${found.join(',')}`);
  await shot('04-search');
  await page.fill('.nc-mkt-search input', '');
  // chip filter (the starter catalog has Work and Life templates, none under School)
  await page.click('.nc-mkt-chip:has-text("Life")');
  await page.waitForTimeout(300);
  const life = await page.$$eval('.nc-mkt-grid-card', (els) => els.map((e) => e.getAttribute('data-template-id')));
  ok(life.length >= 2 && life.includes('journal') && !life.includes('project-tracker'), `Life chip → ${life.join(',')}`);
  await page.click('.nc-mkt-chip:has-text("Life")');
  // detail page
  await page.click('.nc-mkt-grid-card[data-template-id="project-tracker"]');
  await page.waitForSelector('.nc-mkt-detail-title');
  await page.waitForTimeout(1500);
  await shot('05-detail');
  // add to workspace
  await page.click('[data-testid=add-template]');
  await page.waitForFunction(() => !location.pathname.includes('/marketplace'));
  await page.waitForTimeout(1500);
  await shot('06-added-page');
  const sidebarHas = await page.$$eval('nav.lit-sidebar-container [role=treeitem]', (els) => els.map((e) => e.textContent.trim()));
  ok(sidebarHas.some((t) => t.includes('Projects')), `sidebar has copied DB "Projects": ${sidebarHas.join(' | ')}`);
  const rows = await page.$$eval('.lit-collection_view-block [data-block-id], .lit-table-view [data-block-id]', (els) => els.length).catch(() => 0);
  console.log('copied database rows rendered:', rows);
  // Templates modal from an empty page's "Templates" chip (page agent's Get started bar)
  await hoverClick(page, '.lit-outliner-private-header', 'Create a page');
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(600);
  const emptyPageUrl = page.url();
  if (await pickFromModal('Team wiki')) {
    await shot('08-templates-modal-wiki');
    await page.click('[data-testid=use-template]');
    await page.waitForSelector('.nc-tmodal-layout', { state: 'detached', timeout: 30000 }).catch(() => {}); // applying can be slow on a busy server
    await page.waitForTimeout(1500);
    await shot('09-wiki-added');
    const title = await page.$eval('h1[data-content-editable-leaf]', (e) => e.textContent).catch(() => '');
    ok(title.includes('Team wiki'), `empty page became the template: "${title}"`);
    ok(page.url() === emptyPageUrl, 'template applied in place (same page)');
    const subpages = await page.$$eval('.lit-page-block, [data-block-type="page"]', (els) => els.length).catch(() => 0);
    console.log('sub-pages rendered in applied wiki:', subpages);
    // a database template applied to another empty page turns it into a full-page database
    await hoverClick(page, '.lit-outliner-private-header', 'Create a page');
    await page.waitForSelector('h1[data-content-editable-leaf]');
    await page.waitForTimeout(600);
    const dbPageUrl = page.url();
    ok(await pickFromModal('Project tracker'), 'Templates modal reopened from a second empty page');
    await page.click('[data-testid=use-template]');
    await page.waitForSelector('.nc-tmodal-layout', { state: 'detached', timeout: 30000 }).catch(() => {}); // applying can be slow on a busy server
    await page.waitForTimeout(2000);
    await shot('10-db-template-applied');
    const board = await page.locator('.lit-frame, main').first().innerText().catch(() => '');
    ok(page.url().split('-').pop() === dbPageUrl.split('-').pop() && ['Not started', 'In progress', 'Done', 'Website redesign'].every((x) => board.includes(x)), 'database template applied in place (board with rows)');
  } else {
    ok(false, 'empty page "Templates" chip opens the Templates modal');
    await shot('07-after-templates-chip');
  }
} catch (e) {
  console.log('E2E FAILED', e.message);
  process.exitCode = 1;
  await shot('error');
} finally {
  await browser.close();
}

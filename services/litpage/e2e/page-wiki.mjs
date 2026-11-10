// Wikis & page verification: ••• › More › Change to wiki → Home / All pages /
// Pages I manage tabs, sub-pages become wiki pages owned by their creator, Verification cell → Verify page menu → Verified,
// standalone page "Add verification" (Business) → pill under the title → popover (Verified by …, Owner, Remove
// verification), Undo wiki back to a normal page.
import { launch } from './lib.mjs';
import { createPage, reporter, shot, signupAny } from './page-lib.mjs';
import { apiCall } from './db-lib.mjs';

const { check, finish } = reporter();
const { browser, page } = await launch();
const overlayItem = (label) => page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: new RegExp(`^\\s*${label}`) }).first();
async function pageMenu() {
  await page.click('.lit-topbar-more-button');
  await page.waitForSelector('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]');
  await page.waitForTimeout(150);
}
async function moreItem(label) {
  await pageMenu();
  await overlayItem('More').hover();
  await page.waitForTimeout(350);
  await overlayItem(label).click();
}
try {
  await signupAny(page, `wiki-${Date.now()}@test.dev`, 'Wendy Wiki', 'Acme');
  const spaceId = await page.evaluate(async () => (await (await fetch('/api/rpc/loadAccountData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()));
  void spaceId;

  // --- a page with text and a sub-page
  await createPage(page, 'Team Wiki', ['Welcome to the team wiki.', '']);
  const wikiId = await page.$eval('.nc-page-title', (e) => e.getAttribute('data-block-id'));
  await page.keyboard.type('/page', { delay: 15 });
  await page.waitForTimeout(500);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Page\s*$/ }).first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(400);
  await page.keyboard.type('Policies');
  await page.waitForTimeout(900);
  await page.goBack();
  await page.waitForSelector('.nc-page-title');
  await page.waitForTimeout(600);

  // --- Turn into wiki
  await moreItem('Change to wiki');
  await page.waitForSelector('.nc-db-page', { timeout: 8000 });
  await page.waitForTimeout(600);
  const tabs = await page.locator('.nc-db-header [role="tab"], .nc-db-header .nc-view-tab').allInnerTexts();
  check('wiki tabs Home / All pages / Pages I manage', tabs.map((x) => x.trim()).filter(Boolean).join('|').startsWith('Home|All pages|Pages I manage'), tabs.join('|'));
  check('Home shows the page content', await page.isVisible('.nc-wiki-home >> text=Welcome to the team wiki.'));
  check('Home keeps the sub-page link', await page.isVisible('.nc-wiki-home >> text=Policies'));
  await shot(page, 'wiki-01-home');

  // --- All pages
  await page.locator('.nc-db-header [role="tab"], .nc-db-header .nc-view-tab').filter({ hasText: 'All pages' }).first().click();
  await page.waitForSelector('.nc-table-row-outer', { timeout: 8000 });
  const rows = await page.locator('.nc-table-row-outer').allInnerTexts();
  check('All pages lists the wiki page', rows.some((r) => r.includes('Policies')), rows.join(' / ').slice(0, 120));
  const headers = await page.locator('.lit-table-view-header-cell').allInnerTexts();
  check('wiki properties Owner / Verification / Tags', ['Owner', 'Verification', 'Tags'].every((h) => headers.some((x) => x.includes(h))), headers.join('|'));
  check('owner is the creator', rows.some((r) => r.includes('Policies') && r.includes('Wendy')), rows.join(' / ').slice(0, 160));
  await shot(page, 'wiki-02-all-pages');

  // --- verify from the Verification cell
  const row = page.locator('.nc-table-row-outer').filter({ hasText: 'Policies' }).first();
  await row.locator('.lit-table-view-cell[data-col="verification"]').click();
  await page.waitForSelector('.lit-overlay-container >> text=Verify page', { timeout: 5000 });
  check('Verify page menu presets', await overlayItem('For 7 days').isVisible() && await overlayItem('Indefinitely').isVisible() && await overlayItem('Choose a date').isVisible());
  await shot(page, 'wiki-03-verify-menu');
  await overlayItem('For 7 days').click();
  // the cell follows the server round trip: give a busy machine a few seconds
  await row.locator('.lit-table-view-cell[data-col="verification"]', { hasText: 'Verified' }).waitFor({ timeout: 6000 }).catch(() => {});
  const cellText = (await row.locator('.lit-table-view-cell[data-col="verification"]').innerText()).trim();
  check('cell shows Verified', /Verified/.test(cellText), cellText);

  // --- Pages I manage
  await page.locator('.nc-db-header [role="tab"], .nc-db-header .nc-view-tab').filter({ hasText: 'Pages I manage' }).first().click();
  await page.waitForTimeout(700);
  const mine = await page.locator('.nc-table-row-outer').allInnerTexts();
  check('Pages I manage shows my page', mine.some((r) => r.includes('Policies')), mine.length);

  // --- Undo wiki
  await moreItem('Undo wiki');
  await page.waitForSelector('.nc-confirm', { timeout: 5000 });
  check('Undo wiki confirm text', (await page.textContent('.nc-confirm')).includes('back to a regular page'));
  await page.click('.nc-confirm button >> text=Undo wiki');
  await page.waitForSelector('.nc-page-title', { timeout: 8000 });
  await page.waitForTimeout(600);
  check('back to a normal page with its sub-page', await page.isVisible('.lit-page-content >> text=Policies'));

  // --- standalone page verification (Business)
  const space = await page.evaluate(async (id) => {
    const r = await fetch('/api/rpc/loadPage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: id }) });
    return (await r.json()).recordMap.block[id].value.value.space_id;
  }, wikiId);
  const plan = await apiCall(page, 'changePlan', { spaceId: space, plan: 'business' });
  check('switch to Business (simulated billing)', plan.status === 200, String(plan.status));
  await page.waitForTimeout(500);
  await createPage(page, 'Handbook', ['Rules of the road.']);
  await page.hover('.nc-page-title');
  await page.waitForTimeout(300);
  const ctrls = await page.$$eval('.lit-page-controls .nc-page-control', (els) => els.map((e) => e.textContent.trim()));
  check('header control "Add verification"', ctrls.includes('Add verification'), ctrls.join('|'));
  await page.click('.lit-page-controls >> text=Add verification');
  await page.waitForSelector('.lit-overlay-container >> text=Verify page');
  await overlayItem('Indefinitely').click();
  await page.waitForSelector('.nc-verification-pill', { timeout: 5000 });
  check('pill "Verified"', (await page.textContent('.nc-verification-pill')).includes('Verified'));
  await page.click('.nc-verification-pill');
  await page.waitForSelector('.nc-verification-popover');
  const pop = await page.textContent('.nc-verification-popover');
  check('popover summary + owner', /Verified on .+ by Wendy Wiki/.test(pop) && pop.includes('Owner'), pop.slice(0, 120));
  await shot(page, 'wiki-04-verification-popover');
  await page.reload();
  await page.waitForSelector('.nc-verification-pill', { timeout: 8000 });
  check('verification persists', true);
  // --- Settings › Verified pages lists it; clicking the row opens the page
  await page.keyboard.press('Meta+Comma');
  await page.waitForSelector('.nc-set-dialog');
  await page.click('.nc-set-tab[data-settings-key="verified-pages"]');
  await page.waitForSelector('[data-testid=verified-pages] .tr[data-page-id]', { timeout: 8000 });
  const vrow = await page.locator('[data-testid=verified-pages] .tr[data-page-id]').filter({ hasText: 'Handbook' }).first().innerText();
  check('Settings › Verified pages row (owner, Indefinitely)', vrow.includes('Wendy Wiki') && vrow.includes('Indefinitely'), vrow.replace(/\s+/g, ' '));
  await shot(page, 'wiki-05-settings-verified');
  await page.locator('[data-testid=verified-pages] .tr[data-page-id]').filter({ hasText: 'Handbook' }).first().click();
  await page.waitForSelector('.nc-set-dialog', { state: 'detached', timeout: 5000 });
  await page.waitForSelector('.nc-verification-pill', { timeout: 8000 });
  await page.click('.nc-verification-pill');
  await page.waitForSelector('.nc-verification-popover');
  await page.click('.nc-verification-popover >> text=Remove verification');
  await page.waitForTimeout(800);
  check('Remove verification', !(await page.isVisible('.nc-verification-pill')));
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  await shot(page, 'wiki-error');
} finally {
  await browser.close();
  finish();
}

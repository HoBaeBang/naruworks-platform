// Marketplace numbers: Categories dropdown with
// subcategories, template page stats (downloads, version update), "Add to" counts the add, topbar › Purchased lists
// the added template, ••• › Write a review (Review this template → Tell us what you think → Submit), the template page
// shows "Ratings & reviews" with the review, the card shows the rating, ••• › Contact creator opens the creator profile;
// a new full-page database › More templates › Project tracker sets the database up from the template.
import { launch, BASE } from './lib.mjs';
import { createPage, reporter, shot, signupAny } from './page-lib.mjs';
import { apiCall } from './db-lib.mjs';

const { check, finish } = reporter();
const { browser, page } = await launch();
try {
  await signupAny(page, `tplrev-${Date.now()}@test.dev`, 'Rita Reviewer', 'Acme');
  const domain = new URL(page.url()).pathname.split('/').filter(Boolean)[0];
  // the data dir outlives runs: expectations are relative to the catalog numbers at start
  const start = (await apiCall(page, 'listTemplates', {})).body.templates.find((x) => x.id === 'meeting-notes');
  await page.goto(`${BASE}/${domain}/marketplace/templates`);
  await page.waitForSelector('.nc-mkt-tpl-title');
  await page.waitForSelector('.nc-mkt-grid-card');

  // --- Categories dropdown → subcategory
  await page.click('.nc-mkt-cat-dropdown');
  await page.waitForSelector('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]');
  const items = await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').allInnerTexts();
  check('dropdown lists subcategories', items.some((x) => x.includes('Meetings')) && items.some((x) => x.includes('View all')), items.slice(0, 6).join('|'));
  await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: 'Meetings' }).first().click();
  await page.waitForSelector('.nc-mkt-subcat');
  const ids = await page.$$eval('.nc-mkt-grid-card', (els) => els.map((e) => e.getAttribute('data-template-id')));
  check('subcategory filters the grid', ids.includes('meeting-notes') && !ids.includes('reading-list'), ids.join(','));
  await shot(page, 'tplrev-01-subcategory');

  // --- detail: stats, no reviews yet, Add
  await page.click('.nc-mkt-grid-card[data-template-id="meeting-notes"]');
  await page.waitForSelector('[data-testid=template-stats]');
  const stats = await page.textContent('[data-testid=template-stats]');
  check('stats: downloads + version update', stats.includes('Downloads') && stats.includes('Version update'), stats);
  await page.waitForSelector('[data-testid=template-reviews]');
  const pre = await page.textContent('[data-testid=template-reviews]');
  check('no "Leave a review" before adding', !(await page.$('.nc-mkt-leave-review')) && (start.reviews ? pre.includes('All reviews') : pre.includes('No reviews yet')), pre.slice(0, 80));
  const before = Number((await page.textContent('[data-stat="downloads"] .v')).trim());
  await page.click('[data-testid=add-template]');
  await page.waitForFunction(() => !location.pathname.includes('/marketplace'));
  await page.waitForTimeout(800);

  // --- Purchased
  await page.goto(`${BASE}/${domain}/marketplace/templates/meeting-notes`);
  await page.waitForSelector('[data-stat="downloads"]');
  await page.waitForTimeout(500);
  const after = Number((await page.textContent('[data-stat="downloads"] .v')).trim());
  check('add counted in Downloads', after === before + 1, `${before} → ${after}`);
  await page.locator('.lit-topbar-action-buttons [role="button"]', { hasText: 'Purchased' }).click();
  await page.waitForSelector('[data-testid=marketplace-purchased] .tr[data-template-id="meeting-notes"]');
  const row = await page.textContent('[data-testid=marketplace-purchased] .tr[data-template-id="meeting-notes"]');
  check('Purchased lists the template (creator, added by, price)', row.includes('Meeting notes') && row.includes('Rita Reviewer') && row.includes('Free'), row);
  await shot(page, 'tplrev-02-purchased');
  await page.click('[data-testid=marketplace-purchased] .tr[data-template-id="meeting-notes"] .more');
  await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: 'Write a review' }).first().click();
  await page.waitForSelector('.nc-mkt-review-dialog');
  await page.click('.nc-mkt-review-dialog .star >> nth=3');
  await page.waitForSelector('.nc-mkt-review-dialog >> text=Tell us what you think');
  await page.locator('.nc-mkt-review-field', { hasText: 'Title' }).locator('input').fill('Great for standups');
  await page.locator('.nc-mkt-review-field:has(textarea) textarea').fill('We keep every meeting here.');
  await shot(page, 'tplrev-03-review');
  await page.click('.nc-mkt-review-dialog button.primary');
  await page.waitForSelector('.nc-mkt-review-dialog', { state: 'detached' });
  await page.waitForSelector('[data-testid=marketplace-purchased] .tr[data-template-id="meeting-notes"] .mine');
  check('Purchased row shows my rating', (await page.textContent('[data-testid=marketplace-purchased] .tr[data-template-id="meeting-notes"] .mine')).includes('4'));
  await page.click('[data-testid=marketplace-purchased] .tr[data-template-id="meeting-notes"] .more');
  const menu = await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').allInnerTexts();
  check('menu: Review submitted / Contact creator / See it in the template gallery', menu.some((x) => x.includes('Review submitted')) && menu.some((x) => x.includes('Contact creator')) && menu.some((x) => x.includes('See it in the template gallery')), menu.join('|'));
  await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: 'Contact creator' }).first().click();
  await page.waitForSelector('[data-testid=marketplace-creator]');
  const creator = await page.textContent('[data-testid=marketplace-creator]');
  check('creator profile lists their templates', creator.includes('Litpage') && creator.includes('Meeting notes') && creator.includes('templates'), creator.slice(0, 120));
  await shot(page, 'tplrev-04-creator');
  await page.locator('[data-testid=marketplace-creator] .row', { hasText: 'Meeting notes' }).click();

  // --- template page: Ratings & reviews + card rating
  await page.waitForSelector('[data-testid=template-reviews] .nc-mkt-review-item', { timeout: 8000 });
  const rv = await page.textContent('[data-testid=template-reviews]');
  check('review shown on the template page', rv.includes('Great for standups') && rv.includes('Rita Reviewer') && rv.includes('Review submitted'), rv.slice(0, 160));
  check('rating stat', (await page.textContent('[data-testid=template-stats]')).includes('4.0'));
  await shot(page, 'tplrev-05-reviews');
  await page.click('.nc-mkt-back');
  await page.waitForSelector('.nc-mkt-grid-card[data-template-id="meeting-notes"]');
  const card = await page.textContent('.nc-mkt-grid-card[data-template-id="meeting-notes"] .nc-mkt-grid-meta');
  check('card shows rating and downloads', card.includes(`(${start.reviews + 1})`) && card.includes(`${start.adds + 1} download`), card);

  // --- new database › More templates
  await createPage(page, 'Launch plan', ['']);
  await page.keyboard.type('/full page', { delay: 15 });
  await page.waitForTimeout(500);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: 'Database full page' }).first().click();
  await page.waitForSelector('.nc-new-db-panel, .nc-newdb-panel', { timeout: 10000 });
  await page.click('[data-testid=new-db-more-templates]');
  await page.waitForSelector('.nc-db-templates-menu');
  const dbt = await page.locator('.nc-db-templates-menu [role="option"], .nc-db-templates-menu [role="menuitem"]').allInnerTexts();
  check('More templates lists database templates', dbt.some((x) => x.includes('Project tracker')) && !dbt.some((x) => x.includes('To-do list')), dbt.map((x) => x.split('\n')[0]).join('|'));
  await shot(page, 'tplrev-06-db-templates');
  await page.locator('.nc-db-templates-menu [role="option"], .nc-db-templates-menu [role="menuitem"]').filter({ hasText: 'Project tracker' }).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('Website redesign'), null, { timeout: 10000 });
  const dbText = await page.locator('.nc-db').first().innerText();
  check('the new database became a project tracker', ['Website redesign', 'In progress'].every((x) => dbText.includes(x)) && !(await page.$('.nc-new-db-panel, .nc-newdb-panel')), dbText.slice(0, 120).replace(/\s+/g, ' '));
  await shot(page, 'tplrev-07-db-applied');
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  await shot(page, 'tplrev-error');
} finally {
  await browser.close();
  finish();
}

// Page archive: ••• › Archive → yellow banner "… archived this page on …" + Unarchive,
// archived pages leave the sidebar and Quick Find (Content status "Archived" brings them back with an "Archived"
// badge), subpages are archived through their parent, database rows hidden from views with Settings › "Layout archived
// entries" (banner "Browsing archived pages · Exit"), Undo from the toast, persistence across reloads.
import { launch } from './lib.mjs';
import { createPage, reporter, shot, signupAny } from './page-lib.mjs';
import { createInlineDb, apiCall } from './db-lib.mjs';

const { check, finish } = reporter();
const { browser, page } = await launch();
const menuItem = (label) => page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first();
async function openPageMenu() {
  await page.click('.lit-topbar-more-button');
  await page.waitForSelector('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]');
  await page.waitForTimeout(150);
}
async function sidebarHas(title) {
  return page.locator('nav.lit-sidebar-container .lit-sidebar-item, nav.lit-sidebar-container [role="treeitem"]').filter({ hasText: title }).count();
}
/** the sidebar follows the record change after the server round trip: poll a little before judging */
async function eventually(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await page.waitForTimeout(200);
  }
}
try {
  await signupAny(page, `archive-${Date.now()}@test.dev`, 'Archie Vist', 'Acme');
  await createPage(page, 'Archive Lab', ['Some text that should stay.']);
  const pageId = await page.$eval('.nc-page-title', (e) => e.getAttribute('data-block-id'));
  await page.waitForTimeout(800);
  check('page in sidebar before archive', (await sidebarHas('Archive Lab')) > 0);
  // Archive is a Business feature: not in the menu on Plus
  await openPageMenu();
  check('no Archive on Plus', !(await menuItem('Archive').count()));
  await page.keyboard.press('Escape');
  const sid = await page.evaluate(async (id) => {
    const r = await fetch('/api/rpc/loadPage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: id }) });
    return (await r.json()).recordMap.block[id].value.value.space_id;
  }, pageId);
  check('switch to Business', (await apiCall(page, 'changePlan', { spaceId: sid, plan: 'business' })).status === 200);
  await page.waitForTimeout(500);

  // --- ••• › Archive
  await openPageMenu();
  check('••• has Archive', await menuItem('Archive').isVisible());
  await menuItem('Archive').click();
  await page.waitForSelector('.nc-archived-banner', { timeout: 5000 });
  const banner = (await page.textContent('.nc-archived-banner')).trim();
  check('archived banner text', /Archie Vist archived this page on [A-Z][a-z]+ \d+, \d{4}/.test(banner), banner);
  check('banner has Unarchive', await page.isVisible('.nc-archived-banner >> text=Unarchive'));
  const bg = await page.$eval('.nc-archived-banner', (e) => getComputedStyle(e).backgroundColor);
  check('banner is yellow', /rgba?\((2[0-5]\d|1[6-9]\d), (2[0-5]\d|1[6-9]\d), (1[0-9]\d|2[0-4]\d|[5-9]\d)(, [\d.]+)?\)/.test(bg), bg);
  check('toast "Archived page"', await page.isVisible('text=Archived page'));
  check('archive glyph after the name in the breadcrumb', await page.isVisible('.nc-breadcrumb .nc-archived-mark'));
  await shot(page, 'archive-01-banner');
  await page.waitForTimeout(800);
  check('archived page hidden from sidebar', await eventually(async () => (await sidebarHas('Archive Lab')) === 0));

  // --- search excludes it unless Content status asks for it
  const s1 = await apiCall(page, 'searchWorkspace', { query: 'Archive Lab', spaceId: await page.evaluate(() => JSON.parse(localStorage.getItem('nc:session') ?? '{}').spaceId ?? null), filters: {} });
  const spaceId = await page.evaluate(async (id) => {
    const r = await fetch('/api/rpc/loadPage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: id }) });
    const j = await r.json();
    return j.recordMap.block[id].value.value.space_id;
  }, pageId);
  const search = async (contentStatus) => (await apiCall(page, 'searchWorkspace', { query: 'Archive Lab', spaceId, filters: contentStatus ? { contentStatus } : {} })).body?.results ?? [];
  void s1;
  check('search hides archived page', (await search()).every((r) => r.id !== pageId));
  const arch = await search('archived_only');
  check('Content status › Archived finds it', arch.some((r) => r.id === pageId && r.archived));

  // Quick Find UI badge
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.nc-qf-link, .nc-qf input, [role="dialog"] input', { timeout: 5000 }).catch(() => {});
  await page.keyboard.type('Archive Lab');
  await page.waitForTimeout(900);
  const qfHits = await page.locator('.nc-qf-title').filter({ hasText: 'Archive Lab' }).count();
  check('Quick Find default excludes archived', qfHits === 0, `hits=${qfHits}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- persists across reload
  await page.reload();
  await page.waitForSelector('.nc-archived-banner', { timeout: 8000 });
  check('archive persists after reload', true);

  // --- Unarchive from the banner
  await page.click('.nc-archived-banner >> text=Unarchive');
  await page.waitForTimeout(600);
  check('banner gone after Unarchive', !(await page.isVisible('.nc-archived-banner')));
  check('no archive glyph after Unarchive', !(await page.isVisible('.nc-breadcrumb .nc-archived-mark')));
  await page.waitForTimeout(600);
  check('page back in sidebar', await eventually(async () => (await sidebarHas('Archive Lab')) > 0));
  check('search finds it again', (await search()).some((r) => r.id === pageId));

  // --- Undo from the toast
  await openPageMenu();
  await menuItem('Archive').click();
  await page.waitForSelector('.nc-archived-banner');
  const undo = page.locator('.nc-toast').filter({ hasText: 'Archived page' }).locator('.nc-toast-action').first();
  if (await undo.count()) await undo.click();
  await page.waitForTimeout(600);
  check('toast Undo unarchives', !(await page.isVisible('.nc-archived-banner')));

  // --- subpage archived through its parent
  await page.click('.lit-page-content');
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/page', { delay: 15 });
  await page.waitForTimeout(500);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Page\s*$/ }).first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(400);
  await page.keyboard.type('Child Of Lab');
  await page.waitForTimeout(900);
  const childUrl = page.url();
  await page.goto(page.url().replace(/[^/]*$/, '') + pageId.replace(/-/g, ''));
  await page.waitForSelector('.nc-page-title');
  await openPageMenu();
  await menuItem('Archive').click();
  await page.waitForSelector('.nc-archived-banner');
  await page.goto(childUrl);
  await page.waitForSelector('.nc-archived-banner', { timeout: 8000 });
  const childBanner = (await page.textContent('.nc-archived-banner')).trim();
  check('child shows "sits inside … archived too"', /This page sits inside Archive Lab, so it.s archived too/.test(childBanner), childBanner);
  await shot(page, 'archive-02-indirect');
  await openPageMenu();
  check('child ••• has no Archive/Unarchive (archived via parent)', !(await menuItem('Archive').count()) && !(await menuItem('Unarchive').count()));
  await page.keyboard.press('Escape');
  await page.click('.nc-archived-banner-link');
  await page.waitForSelector('.nc-archived-banner >> text=Unarchive');
  await page.click('.nc-archived-banner >> text=Unarchive');
  await page.waitForTimeout(500);

  // --- database rows: hidden from views, "View archived pages" shows them
  await createPage(page, 'Archive DB Lab', ['']);
  await createInlineDb(page, 'Tasks');
  const db = page.locator('.nc-db').last();
  for (const title of ['Keep me', 'Archive me']) {
    const empty = db.locator('.lit-table-view-empty-placeholder');
    if (await empty.count()) await empty.first().click();
    else await db.locator('.lit-table-view-add-row').first().click();
    await page.waitForSelector('.nc-title-cell-leaf.editing');
    await page.keyboard.type(title, { delay: 8 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const rowIds = await db.locator('.nc-table-row-outer').evaluateAll((els) => els.map((e) => e.getAttribute('data-block-id')).filter(Boolean));
  const before = rowIds.length;
  const target = rowIds[rowIds.length - 1];
  const tries = [];
  let r;
  for (let i = 0; i < 5; i++) {
    r = await apiCall(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'block', id: target, spaceId }, path: [], command: 'update', args: { archived_time: Date.now(), archived_by: null } }] }] });
    tries.push(`${r.status} ${r.body?.message ?? ''}`.trim());
    if (r.status === 200) break;
    await page.waitForTimeout(1000);
  }
  check('archive a row (transaction)', r.status === 200, tries.join(' / '));
  await page.reload();
  await page.waitForSelector('.nc-db .nc-table-row-outer');
  await page.waitForTimeout(600);
  const after = await page.locator('.nc-db').last().locator('.nc-table-row-outer').count();
  check('archived row hidden from the table', after === before - 1, `${before} → ${after}`);
  await page.locator('.nc-db').last().hover();
  await page.locator('.nc-db').last().locator('.nc-db-toolbar [aria-label="Settings"]').first().click();
  await page.waitForSelector('.nc-view-settings');
  await page.locator('.nc-view-settings').getByText('Show archived entries', { exact: true }).click();
  await page.waitForSelector('.nc-archived-view-banner');
  const archivedRows = await page.locator('.nc-db').last().locator('.nc-table-row-outer').evaluateAll((els) => els.map((e) => e.getAttribute('data-block-id')));
  check('archive view shows only archived rows', archivedRows.length === 1 && archivedRows[0] === target, JSON.stringify(archivedRows));
  check('"Browsing archived pages" banner', (await page.textContent('.nc-archived-view-banner')).includes('Browsing archived pages'));
  await shot(page, 'archive-03-db-archive-view');
  await page.click('.nc-archived-view-banner >> text=Exit');
  await page.waitForTimeout(400);
  check('Exit returns to live rows', (await page.locator('.nc-db').last().locator('.nc-table-row-outer').count()) === before - 1);
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  await shot(page, 'archive-error');
} finally {
  await browser.close();
  finish();
}

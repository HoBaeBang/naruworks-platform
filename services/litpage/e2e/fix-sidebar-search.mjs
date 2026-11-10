// "Link to page" blocks in the sidebar (@mentions stay out), the breadcrumb browser
// (hover = sibling pages, current title = back to top), Quick Find words vs "exact
// phrase" and search action results.
// Run: NC_BASE=http://127.0.0.1:5531 node e2e/fix-sidebar-search.mjs
import { mkdirSync } from 'node:fs';
import { launch, BASE } from './lib.mjs';
import { apiLogin, reporter, waitFor } from './ws-lib.mjs';
import { addBlock, addLinkToPage, domainOf, makeDatabase, makePage, openPageById, tx, cryptoId } from './fix-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/wave3/fix/shots';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // busy dev server: page loads can be slow
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });

try {
  const { spaceId } = await apiLogin(page, { name: 'Fix Tester', workspace: 'Fixers' });
  const domain = await domainOf(page, spaceId);

  // ---------------------------------------------------------------- "Link to page" blocks in the sidebar
  const target = await makePage(page, spaceId, 'Linked target');
  const mentioned = await makePage(page, spaceId, 'Only mentioned');
  const parent = await makePage(page, spaceId, 'Hub page', { lines: ['Intro line'] });
  await addLinkToPage(page, spaceId, parent, target);
  await addBlock(page, spaceId, parent, { title: [['See '], ['‣', [['p', mentioned, spaceId]]]] });
  await page.reload();
  await page.waitForSelector('nav.lit-sidebar-container');
  const hubRow = page.locator(`nav .nc-sb-page[data-block-id="${parent}"]`).first();
  await hubRow.waitFor();
  await hubRow.locator('.nc-sb-item').first().hover();
  await hubRow.locator('.nc-sb-toggle').first().click();
  const linkRow = hubRow.locator(`.nc-sb-link[data-link-target="${target}"]`);
  r.ok(await waitFor(() => linkRow.count()) === 1, 'a Link to page block shows under its page in the sidebar');
  r.ok((await linkRow.locator('.nc-sb-item-title').textContent())?.trim() === 'Linked target', 'the link row shows the linked page’s title');
  r.ok(await linkRow.locator('.nc-sb-link-arrow').count() === 1, 'the link row carries the small link arrow on its icon');
  r.ok(await hubRow.locator(`.nc-sb-children :text-is("Only mentioned")`).count() === 0, 'an @mention does not show in the sidebar');
  await shot('01-sidebar-link');
  await linkRow.locator('.nc-sb-item').first().click();
  r.ok(await waitFor(() => page.url().includes(target.replace(/-/g, ''))), 'clicking the link row opens the linked page');
  // realtime: a new link appears without reloading
  const second = await makePage(page, spaceId, 'Second target');
  await addLinkToPage(page, spaceId, parent, second);
  r.ok(await waitFor(() => hubRow.locator(`.nc-sb-link[data-link-target="${second}"]`).count(), { timeout: 8000 }) === 1, 'a new Link to page block shows up live');

  // ---------------------------------------------------------------- breadcrumb browser
  const folder = await makePage(page, spaceId, 'Folder');
  const kids = [];
  for (const n of ['Child A', 'Child B', 'Child C']) kids.push(await makePage(page, spaceId, n, { parentId: folder }));
  for (let i = 0; i < 40; i++) await addBlock(page, spaceId, kids[1], { title: [[`Paragraph ${i} with enough words to make the page long`]] });
  await openPageById(page, BASE, domain, kids[1]);
  const currentCrumb = page.locator(`.lit-topbar .nc-crumb[data-crumb-id="${kids[1]}"]`);
  await currentCrumb.hover();
  const popup = page.locator('.nc-crumb-popup');
  r.ok(await waitFor(() => popup.count()) > 0, 'hovering a crumb opens the sibling pages popup');
  const names = (await popup.locator('.nc-menu-item').allTextContents()).map((s) => s.trim());
  r.ok(['Child A', 'Child B', 'Child C'].every((n) => names.includes(n)), `siblings listed (${names.join(', ')})`);
  r.ok(await popup.locator('.nc-crumb-current').count() === 1, 'the hovered page is highlighted in its list');
  await shot('02-breadcrumb-siblings');
  await popup.locator('.nc-menu-item', { hasText: 'Child C' }).click();
  r.ok(await waitFor(() => page.url().includes(kids[2].replace(/-/g, ''))), 'picking a sibling opens it');
  // the top-level page's crumb: Private pages, listed under "Private"
  await page.mouse.move(700, 500);
  await page.waitForTimeout(400);
  await page.locator(`.lit-topbar .nc-crumb[data-crumb-id="${folder}"]`).hover();
  r.ok(await waitFor(() => page.locator('.nc-crumb-popup .nc-menu-section-title-text', { hasText: 'Private' }).count()) > 0, 'a private top-level page lists the Private pages under "Private"');
  await page.mouse.move(700, 600);
  r.ok(await waitFor(async () => (await page.locator('.nc-crumb-popup').count()) === 0, { timeout: 3000 }), 'the popup closes when the pointer leaves');
  // current title → back to the top
  await openPageById(page, BASE, domain, kids[1]);
  await page.evaluate(() => { const s = document.querySelector('.lit-frame .nc-page-scroller'); if (s) s.scrollTop = 1500; });
  await page.waitForTimeout(300);
  await page.locator(`.lit-topbar .nc-crumb[data-crumb-id="${kids[1]}"]`).click();
  r.ok(await waitFor(() => page.evaluate(() => (document.querySelector('.lit-frame .nc-page-scroller')?.scrollTop ?? 1) < 5), { timeout: 4000 }), 'clicking the current page’s title scrolls to the top');
  // database rows: "More pages in {database}" + More pages
  const db = await makeDatabase(page, spaceId, folder, 'Tasks DB', [{ title: 'Row one' }, { title: 'Row two' }]);
  await openPageById(page, BASE, domain, db.rowIds[0]);
  await page.locator(`.lit-topbar .nc-crumb[data-crumb-id="${db.rowIds[0]}"]`).hover();
  r.ok(await waitFor(() => page.locator('.nc-crumb-popup .nc-menu-section-title-text', { hasText: 'More pages in Tasks DB' }).count()) > 0, 'database rows list "More pages in Tasks DB"');
  r.ok(await page.locator('.nc-crumb-popup .nc-menu-item', { hasText: 'More pages' }).count() === 1, '…with a "More pages" link to the database');
  await shot('03-breadcrumb-db');
  await page.mouse.move(700, 600);
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------- words vs "exact phrase"
  await makePage(page, spaceId, 'Quarterly ledger', { lines: ['red apple pie recipe'] });
  await makePage(page, spaceId, 'Orchard notes', { lines: ['the pie was made from a green apple'] });
  await page.waitForTimeout(400);
  const search = async (q) => {
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+k');
    await page.waitForSelector('[role=dialog][aria-label="Search Litpage"]');
    await page.fill('.nc-qf-input', q);
    await page.waitForTimeout(700);
    return (await page.locator('.nc-qf-group:not(.nc-qf-jump):not(.nc-qf-ai):not(.nc-qf-people) .nc-qf-title').allTextContents()).map((s) => s.trim());
  };
  const words = await search('apple pie');
  r.ok(words.includes('Quarterly ledger') && words.includes('Orchard notes'), `words in any order match both pages (${words.join(', ')})`);
  const exact = await search('"apple pie"');
  r.ok(exact.includes('Quarterly ledger') && !exact.includes('Orchard notes'), `"apple pie" matches the exact phrase only (${exact.join(', ')})`);
  await shot('04-search-exact');

  // ---------------------------------------------------------------- search action results
  await search('sett');
  const jump = page.locator('.nc-qf-jump');
  r.ok(await waitFor(() => jump.count()) > 0 && /Settings/.test(await jump.textContent() ?? ''), '"sett" offers Settings');
  r.ok(/Adjust account details and preferences/.test(await jump.locator('.nc-qf-action-caption').first().textContent().catch(() => '') ?? ''), '…with Litpage’s caption');
  await search('gallery');
  r.ok(/Templates/.test(await page.locator('.nc-qf-jump').textContent().catch(() => '') ?? ''), '"gallery" offers Templates (alias)');
  await search('dark mo');
  r.ok(/Toggle theme/.test(await page.locator('.nc-qf-jump').textContent().catch(() => '') ?? ''), '"dark mo" offers Toggle theme');
  await search('new pa');
  const newPageRow = page.locator('.nc-qf-jump [data-row-kind="action"]', { hasText: 'New page' }).first();
  r.ok(await newPageRow.count() === 1, '"new pa" offers New page (Create a new page.)');
  await shot('05-search-actions');
  const before = page.url();
  await newPageRow.click();
  r.ok(await waitFor(() => page.url() !== before), 'New page creates and opens a page');
  void tx; void cryptoId;
} catch (e) {
  console.log('FAIL exception', e);
  process.exitCode = 1;
} finally {
  r.done();
  await browser.close();
}




// Run: NC_BASE=http://127.0.0.1:5471 node e2e/db-views-sources.mjs
import { freshPage, createInlineDb } from './db-lib.mjs';
import { setup, storeGet, bulkRows, saved, addView, slash, esc } from './dbv-lib.mjs';

const { page, wait, check, shot, section, finish, closeOverlays } = await setup('sources');

const dbs = () => page.locator('.nc-db.inline');
const dbIds = () => page.$$eval('.nc-db-block', (els) => els.map((e) => e.getAttribute('data-block-id')));
const tabs = (i) => dbs().nth(i).locator('[role="tab"]');
const overlay = () => page.locator('.lit-overlay-container .nc-overlay').last();
async function openSettings(i) {
  await closeOverlays();
  await dbs().nth(i).hover();
  await wait(150);
  await dbs().nth(i).locator('.nc-db-toolbar [aria-label="Settings"]').first().click();
  await page.waitForSelector('.nc-view-settings');
  await wait(200);
}
const vsRow = (label) => page.locator('.nc-view-settings [role="menuitem"]').filter({ has: page.locator('.nc-menu-label', { hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }) }).first();
const sourceRows = () => page.locator('.nc-view-settings [data-testid="data-source-row"]');
async function manage(i) {
  await openSettings(i);
  await vsRow('Manage datasets').click();
  await wait(300);
}

let main = '';
let other = '';
let newSource = '';

try {
  await freshPage(page, 'Sources Lab', `dbv-src-${Date.now()}@test.dev`);
  await createInlineDb(page, 'Main');
  main = (await dbIds())[0];
  const mainCol = (await storeGet(page, 'block', main)).collection_id;
  await bulkRows(page, mainCol, [{ title: 'M1' }, { title: 'M2' }]);
  await saved(page);

  await section('add a data source', async () => {
    await dbs().first().hover();
    await wait(150);
    await dbs().first().locator('.lit-collection-add-view').first().click({ force: true });
    await page.waitForSelector('.nc-add-view-menu');
    await page.locator('.nc-add-view-source').click();
    await page.waitForSelector('.nc-add-source-menu');
    const menuText = await page.locator('.nc-add-source-menu').innerText();
    check('new data source menu: New blank dataset / Import CSV / Suggested / Link an existing dataset', ['New blank dataset', 'Import CSV', 'Suggested', 'Tasks Tracker', 'Link an existing dataset'].every((t) => menuText.includes(t)), menuText.replace(/\n/g, ' | '));
    await shot('01-new-data-source');
    await page.locator('.nc-add-source-menu .nc-menu-item').filter({ hasText: 'New blank dataset' }).click();
    await wait(600);
    const b = await storeGet(page, 'block', main);
    const ptrs = b.format?.collection_pointers ?? [];
    newSource = ptrs.map((p) => p.id).find((id) => id !== mainCol) ?? '';
    const c = await storeGet(page, 'collection', newSource);
    check('add: second data source owned by the database', !!c && c.parent_id === main && ptrs.length === 2, JSON.stringify(ptrs));
    check('add: a tab per source, the new one active', (await tabs(0).count()) === 2 && (await tabs(0).nth(1).getAttribute('aria-selected')) === 'true');
    const v = await storeGet(page, 'collection_view', b.view_ids[1]);
    check('add: the new view shows the new source', v.format?.collection_pointer?.id === newSource);
    const title = dbs().first().locator('.nc-db-title-leaf');
    check('add: title placeholder "Create a dataset"', (await title.getAttribute('placeholder')) === 'Create a dataset' || (await title.getAttribute('data-placeholder')) === 'Create a dataset', `${await title.getAttribute('placeholder')} ${await title.getAttribute('data-placeholder')}`);
    await title.click();
    await page.keyboard.type('Second');
    await page.keyboard.press('Enter');
    await wait(300);
    check('add: the title names the active source', JSON.stringify((await storeGet(page, 'collection', newSource)).name) === '[["Second"]]' && JSON.stringify((await storeGet(page, 'collection', mainCol)).name) === '[["Main"]]');
    await bulkRows(page, newSource, [{ title: 'S1' }]);
    await saved(page);
    await wait(300);
    const titles = await dbs().first().locator('.nc-title-cell-text').allInnerTexts();
    check('add: the tab lists the new source\'s rows', titles.join(',') === 'S1', titles.join(','));
    await tabs(0).first().click();
    await wait(300);
    const t2 = await dbs().first().locator('.nc-title-cell-text').allInnerTexts();
    check('add: the first tab keeps the first source', t2.sort().join(',') === 'M1,M2', t2.join(','));
  });

  await section('manage data sources', async () => {
    await manage(0);
    const txt = await page.locator('.nc-view-settings').innerText();
    // (the help row "Explore datasets" only shows when a HELP_URL is configured; none by default)
    check('manage: Source / Linked / Create dataset / Link an existing dataset', txt.includes('Source') && txt.includes('Linked') && txt.includes('Create dataset') && txt.includes('Link an existing dataset'), txt.replace(/\n/g, ' | '));
    check('manage: both sources listed with "1 view"', (await sourceRows().count()) === 2 && (await sourceRows().nth(1).innerText()).includes('1 view'), await sourceRows().allInnerTexts().then((a) => a.join(' / ')));
    await shot('02-manage');
    await closeOverlays();
  });

  await section('linked source with a copied view', async () => {
    // a second database on the page
    await page.locator('.nc-click-to-append').click().catch(() => {});
    await wait(200);
    await page.keyboard.press('Enter');
    await createInlineDb(page, 'Other');
    other = (await dbIds())[1];
    const otherCol = (await storeGet(page, 'block', other)).collection_id;
    await bulkRows(page, otherCol, [{ title: 'O1' }, { title: 'O2' }, { title: 'O3' }]);
    await addView(page, dbs().nth(1), 'Board');
    await saved(page);
    await manage(0);
    await vsRow('Link an existing dataset').click();
    await wait(400);
    await page.locator('.nc-linked-picker input').fill('Other');
    await wait(500);
    await page.locator('.nc-linked-picker .nc-link-source-row').filter({ hasText: 'Other' }).first().click();
    await wait(300);
    const step = await page.locator('.nc-linked-picker').innerText();
    check('link: view step "New view" / New table view / Views on Other', step.includes('New view') && step.includes('New table view') && step.includes('Views on Other') && step.includes('Board'), step.replace(/\n/g, ' | '));
    await shot('03-view-step');
    await page.locator('.nc-linked-picker .nc-link-source-view').filter({ hasText: 'Board' }).first().click();
    await wait(600);
    await saved(page);
    const b = await storeGet(page, 'block', main);
    const lv = await storeGet(page, 'collection_view', b.view_ids[b.view_ids.length - 1]);
    check('link: copied the Board view onto Other', lv.type === 'board' && lv.format?.collection_pointer?.id === otherCol, `${lv.type} ${JSON.stringify(lv.format?.collection_pointer)}`);
    check('link: the linked tab is active and shows Other\'s rows', (await dbs().first().locator('.nc-board-card-wrap, .lit-collection-item').count()) >= 3);
    await manage(0);
    const linkedTxt = await page.locator('.nc-view-settings').innerText();
    check('manage: Linked lists Other', /Linked[\s\S]*Other/.test(linkedTxt), linkedTxt.replace(/\n/g, ' | '));
    await page.locator('.nc-view-settings [data-testid="data-source-row"]').filter({ hasText: 'Other' }).locator('[aria-label="Remove linked layouts"]').click();
    await wait(400);
    check('manage: Delete linked views removes the linked tab', (await storeGet(page, 'block', main)).view_ids.length === 2);
    await closeOverlays();
  });

  await section('form only on own sources', async () => {
    // a linked database (the /linked flow) offers no Form layout
    await closeOverlays();
    await page.locator('.nc-click-to-append').click().catch(() => {});
    await wait(300);
    await slash(page, 'linked', 'Linked data source view');
    await wait(400);
    await page.locator('.nc-linked-picker input').fill('Other');
    await wait(500);
    await page.locator('.nc-linked-picker .nc-link-source-row').filter({ hasText: 'Other' }).first().click();
    await wait(300);
    await page.locator('.nc-linked-picker .nc-link-new-view').click();
    await wait(600);
    const ids = await dbIds();
    check('/linked: new linked database block', ids.length === 3);
    const ldb = dbs().nth(2);
    await ldb.hover();
    await wait(150);
    await ldb.locator('.lit-collection-add-view').first().click({ force: true });
    await page.waitForSelector('.nc-add-view-menu');
    const cells = await page.locator('.nc-add-view-cell .nc-add-view-label').allInnerTexts();
    check('/linked: add-view grid has no Form', !cells.includes('Form') && cells.includes('Table'), cells.join(','));
    await closeOverlays();
  });

  await section('view source row', async () => {
    await closeOverlays();
    await tabs(0).first().click();
    await wait(300);
    await openSettings(0);
    const row = page.locator('.nc-view-settings [data-testid="view-source-row"]');
    check('source row: enabled with several sources', (await row.count()) === 1);
    await row.click();
    await wait(300);
    const m = await overlay().innerText();
    check('source row: lists Main and Second', m.includes('Main') && m.includes('Second') && m.includes('Link an existing dataset'), m.replace(/\n/g, ' | '));
    await overlay().locator('.nc-menu-item').filter({ hasText: /^\s*Second\s*$/ }).first().click();
    await wait(500);
    const b = await storeGet(page, 'block', main);
    const v0 = await storeGet(page, 'collection_view', b.view_ids[0]);
    check('source row: the view now shows Second', v0.format?.collection_pointer?.id === newSource, JSON.stringify(v0.format?.collection_pointer));
    await closeOverlays();
    // put it back
    await openSettings(0);
    await page.locator('.nc-view-settings [data-testid="view-source-row"]').click();
    await wait(300);
    await overlay().locator('.nc-menu-item').filter({ hasText: /^\s*Main\s*$/ }).first().click();
    await wait(400);
    await closeOverlays();
  });

  await section('reload keeps both sources', async () => {
    await page.reload();
    await page.waitForSelector('.nc-db.inline');
    await wait(1200);
    await tabs(0).nth(1).click();
    await wait(400);
    const titles = await dbs().first().locator('.nc-title-cell-text').allInnerTexts();
    check('reload: second source rows load', titles.join(',') === 'S1', titles.join(','));
  });

  await section('move a data source', async () => {
    await manage(0);
    await sourceRows().filter({ hasText: 'Second' }).locator('[aria-label="Dataset actions"]').click();
    await wait(250);
    await overlay().locator('.nc-menu-item').filter({ hasText: 'Move to' }).first().click();
    await wait(500);
    await page.locator('.nc-linked-picker .nc-link-source-row').filter({ hasText: 'Other' }).first().click();
    await wait(300);
    const dlg = page.locator('.nc-confirm');
    check('move: "Sending dataset Second" with the two choices', (await dlg.innerText()).includes('Sending dataset Second') && (await dlg.innerText()).includes('Move data source and 1 view') && (await dlg.innerText()).includes('Send dataset only'), await dlg.innerText());
    await dlg.getByText('Move data source and 1 view').click();
    await wait(600);
    await saved(page);
    const c = await storeGet(page, 'collection', newSource);
    check('move: the source now belongs to Other', c.parent_id === other);
    check('move: Main lost the tab, Other gained it', (await storeGet(page, 'block', main)).view_ids.length === 1 && (await storeGet(page, 'block', other)).view_ids.length === 3);
  });

  await section('delete a data source', async () => {
    await manage(1);
    await sourceRows().filter({ hasText: 'Second' }).locator('[aria-label="Dataset actions"]').click();
    await wait(250);
    await overlay().locator('.nc-menu-item').filter({ hasText: 'Delete' }).first().click();
    await wait(300);
    const dlg = page.locator('.nc-confirm');
    check('delete: "Send Second to trash?"', (await dlg.innerText()).includes('Send Second to trash?') && (await dlg.innerText()).includes('Send dataset to trash'), await dlg.innerText());
    await dlg.getByText('Send dataset to trash').click();
    await wait(500);
    await saved(page);
    check('delete: data source in the Trash', (await storeGet(page, 'collection', newSource)).alive === false);
    check('delete: its tab is gone', (await storeGet(page, 'block', other)).view_ids.length === 2);
    check('delete: toast', (await page.locator('.nc-toast').filter({ hasText: 'Sent Second to trash' }).count()) >= 1);
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
await finish();

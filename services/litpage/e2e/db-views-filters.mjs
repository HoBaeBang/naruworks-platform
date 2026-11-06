
// at once; on a shared database they stay yours (Reset / Save for everyone in the filter bar and the view settings),
// survive a reload, and "Save for everyone" / "Save as new view" write them; people who can't change the view (locked
// database) only get Reset. Run: NC_BASE=http://127.0.0.1:5471 node e2e/db-views-filters.mjs
import { freshPage, createInlineDb, tableHelpers } from './db-lib.mjs';
import { setup, storeGet, bulkRows, saved } from './dbv-lib.mjs';

const { page, wait, check, shot, section, finish, closeOverlays } = await setup('filters');
const t = tableHelpers(page);
let blockId = '';
let viewId = '';
let pageId = '';

const view = () => storeGet(page, 'collection_view', viewId);
const saveControl = () => page.locator('.nc-db .nc-save-control');
async function toolbar(label) {
  await t.db().hover();
  await wait(150);
  return t.db().locator(`.nc-db-toolbar [aria-label="${label}"]`).first();
}
async function sortBy(name) {
  await (await toolbar('Sort')).click();
  await wait(300);
  const item = page.locator('.lit-overlay-container [role="option"]').filter({ hasText: new RegExp(`^\\s*${name}\\s*$`) }).first();
  await item.click();
  await wait(400);
  await closeOverlays();
}
async function filterTitleContains(text) {
  await (await toolbar('Filter')).click();
  await wait(300);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Name\s*$/ }).first().click();
  await wait(400);
  await page.keyboard.type(text);
  await wait(400);
  await closeOverlays();
}

try {
  await freshPage(page, 'Filter Lab', `dbv-flt-${Date.now()}@test.dev`);
  await createInlineDb(page, 'Tasks');
  blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
  const block = await storeGet(page, 'block', blockId);
  viewId = block.view_ids[0];
  pageId = block.parent_id;
  await bulkRows(page, block.collection_id, [{ title: 'Banana' }, { title: 'Apple' }, { title: 'Cherry' }]);
  await saved(page);
  await wait(300);

  await section('private database saves at once', async () => {
    await sortBy('Name');
    const v = await view();
    check('private: sort saved to the view', (v.query2?.sort ?? []).length === 1, JSON.stringify(v.query2?.sort));
    check('private: no Save for everyone', (await saveControl().count()) === 0);
    await page.evaluate((id) => {
      const { records, transactions } = window.__ncEditor;
      const vv = records.get('collection_view', id);
      transactions.run(vv.space_id, 'e2e.clear', (tx) => tx.set('collection_view', id, ['query2'], {}));
    }, viewId);
    await saved(page);
    await wait(300);
  });

  await section('shared database keeps edits personal', async () => {
    // share the page with everyone in the workspace
    await page.evaluate((id) => {
      const { records, transactions } = window.__ncEditor;
      const b = records.get('block', id);
      transactions.run(b.space_id, 'e2e.share', (tx) => tx.update('block', id, [], { permissions: [...(b.permissions ?? []), { type: 'space_permission', role: 'read_and_write' }] }));
    }, pageId);
    await saved(page);
    await wait(300);
    await sortBy('Name');
    const titles = await t.titles();
    check('shared: the sort applies for me', titles.join(',') === 'Apple,Banana,Cherry', titles.join(','));
    check('shared: the view is unchanged for everyone', ((await view()).query2?.sort ?? []).length === 0, JSON.stringify((await view()).query2));
    check('shared: Reset + Save for everyone in the filter bar', (await saveControl().locator('.nc-save-reset').count()) === 1 && (await saveControl().locator('.nc-save-everyone-main').innerText()).includes('Store for everyone'), await saveControl().innerText().catch(() => ''));
    await shot('01-save-control');
  });

  await section('personal state survives a reload', async () => {
    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(1000);
    const titles = await t.titles();
    check('reload: my sort is still applied', titles.join(',') === 'Apple,Banana,Cherry', titles.join(','));
    check('reload: Save for everyone still offered', (await saveControl().count()) === 1);
  });

  await section('reset', async () => {
    await saveControl().locator('.nc-save-reset').click();
    await wait(400);
    check('reset: sort gone', (await t.titles()).join(',') !== 'Apple,Banana,Cherry' && (await page.locator('.nc-db .nc-filter-chip.sort').count()) === 0, (await t.titles()).join(','));
    check('reset: control gone', (await saveControl().count()) === 0);
  });

  await section('save for everyone', async () => {
    await filterTitleContains('an');
    const titles = await t.titles();
    check('filter: applies for me (Banana)', titles.join(',') === 'Banana', titles.join(','));
    check('filter: not saved yet', ((await view()).format?.property_filters ?? []).length === 0);
    await saveControl().locator('.nc-save-everyone-main').click();
    await wait(500);
    await saved(page);
    const v = await view();
    check('save: filter written to the view', (v.format?.property_filters ?? []).length === 1, JSON.stringify(v.format?.property_filters));
    check('save: control gone', (await saveControl().count()) === 0);
    check('save: toast "Everyone can now see the saved changes."', (await page.locator('.nc-toast').filter({ hasText: 'Everyone can now see the saved changes.' }).count()) >= 1);
  });

  await section('view settings save control', async () => {
    await sortBy('Name');
    await t.openSettings();
    await page.locator('.nc-view-settings [role="menuitem"]').filter({ hasText: /^\s*Sort/ }).first().click();
    await wait(300);
    const panel = page.locator('.nc-view-settings');
    const txt = await panel.innerText();
    check('settings: "Your sort differs from the shared view"', txt.includes('Your sort differs from the shared view'), txt.slice(0, 300));
    check('settings: Save for everyone + Reset sorts', txt.includes('Store for everyone') && txt.includes('Reset sorts'));
    await shot('02-settings-sort');
    await panel.locator('.nc-save-row').filter({ hasText: 'Store as a new layout' }).first().click();
    await wait(600);
    await saved(page);
    const b = await storeGet(page, 'block', blockId);
    check('save as new view: a second view', b.view_ids.length === 2, b.view_ids.join(','));
    const nv = await storeGet(page, 'collection_view', b.view_ids[1]);
    check('save as new view: carries the sort, named "(1)"', (nv?.query2?.sort ?? []).length === 1 && / \(1\)$/.test(nv?.name ?? ''), `${nv?.name} ${JSON.stringify(nv?.query2?.sort)}`);
    check('save as new view: original view untouched', ((await view()).query2?.sort ?? []).length === 0);
    await closeOverlays();
  });

  await section('locked database: personal only', async () => {
    await page.evaluate((id) => {
      const { records, transactions } = window.__ncEditor;
      const b = records.get('block', id);
      transactions.run(b.space_id, 'e2e.lock', (tx) => tx.update('block', id, ['format'], { block_locked: true }));
    }, blockId);
    await saved(page);
    await wait(300);
    // back to the first view
    await t.db().locator('[role="tab"]').first().click().catch(() => {});
    await wait(300);
    await sortBy('Name');
    check('locked: sort applies for me', (await t.titles()).join(',') === 'Banana', (await t.titles()).join(','));
    check('locked: only Reset (no Save for everyone)', (await saveControl().count()) === 1 && (await saveControl().locator('.nc-save-everyone-main').count()) === 0);
    check('locked: tooltip explains it', (await saveControl().getAttribute('data-tooltip')) === 'Changes to filters & sorts in this layout are only visible to you.');
    check('locked: view not written', ((await view()).query2?.sort ?? []).length === 0);
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
await finish();

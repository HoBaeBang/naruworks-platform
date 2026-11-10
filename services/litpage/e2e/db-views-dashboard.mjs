


import { freshPage } from './db-lib.mjs';
import { setup, createFullPageDb, storeGet, bulkRows, saved, addView } from './dbv-lib.mjs';

const { page, wait, check, shot, section, finish, closeOverlays } = await setup('dashboard');
const db = () => page.locator('.nc-db').first();
let blockId = '';
let collectionId = '';
let dashId = '';
const layout = async () => (await storeGet(page, 'collection_view', dashId)).format.dashboard_layout;
const mode = () => db().locator('.lit-dashboard-view').getAttribute('data-dashboard-mode');
const tableRows = () => db().locator('.nc-dash-widget[data-view-type="table"] .nc-table-row-outer').count();

try {
  await freshPage(page, 'DBV Dash', `dbv-dash-${Date.now()}@test.dev`);

  await section('setup', async () => {
    blockId = await createFullPageDb(page, 'Dash DB');
    collectionId = (await storeGet(page, 'block', blockId)).collection_id;
    await page.evaluate((cid) => {
      const { records, transactions } = window.__ncEditor;
      const c = records.get('collection', cid);
      transactions.run(c.space_id, 'e2e.schema', (tx) => tx.set('collection', cid, ['schema', 'kind'], { name: 'Kind', type: 'select', options: [{ id: 'o1', value: 'A', color: 'red' }, { id: 'o2', value: 'B', color: 'blue' }] }));
    }, collectionId);
    await bulkRows(page, collectionId, [{ title: 'D1', props: { kind: [['A']] } }, { title: 'D2', props: { kind: [['A']] } }, { title: 'D3', props: { kind: [['B']] } }]);
    await saved(page);
    await addView(page, db(), 'Dashboard');
    const b = await storeGet(page, 'block', blockId);
    dashId = b.view_ids[b.view_ids.length - 1];
    check('new dashboard: empty state in Edit mode', (await db().locator('[data-testid="dashboard-empty"]').count()) === 1 && (await db().locator('[data-testid="dashboard-done"]').count()) === 1);
    await db().locator('[data-testid="dashboard-add"]').click();
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Table\s*$/ }).first().click();
    await wait(700);
    const row = db().locator('.nc-dash-row').first();
    await row.hover();
    await row.locator('.nc-dash-row-add').click();
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*List\s*$/ }).first().click();
    await wait(700);
    check('edit mode: two widgets in a row', (await db().locator('.nc-dash-widget').count()) === 2 && (await db().locator('.nc-dash-row').count()) === 1);
    check('edit mode: table widget shows the 3 rows', (await tableRows()) === 3, String(await tableRows()));
  });

  await section('view mode', async () => {
    await db().locator('[data-testid="dashboard-done"]').click();
    await wait(400);
    check('Done: View mode', (await mode()) === 'view');
    check('View mode: no layout controls (add to row, new row, resize)', (await db().locator('.nc-dash-row-add, .nc-dash-newrow, .nc-dash-row-resize, .nc-dash-col-resize').count()) === 0);
    check('View mode: toolbar offers Edit dashboard', (await db().locator('[data-testid="dashboard-edit"]').count()) === 1);
    const head = db().locator('.nc-dash-widget-head').first();
    check('View mode: widgets are not draggable', (await head.getAttribute('draggable')) === 'false');
    await shot('01-view-mode');
  });

  await section('global filter', async () => {
    await db().hover();
    await wait(150);
    await db().locator('.nc-db-toolbar [aria-label="Filter"]').first().click();
    await wait(300);
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Kind\s*$/ }).first().click();
    await wait(400);
    await page.locator('.lit-overlay-container .nc-filter-option').filter({ hasText: /^\s*A\s*$/ }).first().click();
    await wait(400);
    await closeOverlays();
    await wait(300);
    check('global filter: the table widget shows only Kind = A', (await tableRows()) === 2, String(await tableRows()));
    const listItems = await db().locator('.nc-dash-widget[data-view-type="list"] .nc-list-item').count();
    check('global filter: the list widget too', listItems === 2, String(listItems));
    const dv = await storeGet(page, 'collection_view', dashId);
    check('View mode: the filter is yours (not saved on the dashboard)', !(dv.format.property_filters ?? []).length, JSON.stringify(dv.format.property_filters));
    const sc = db().locator('.nc-save-control');
    check('View mode: Reset + Save for everyone', (await sc.count()) > 0 && (await sc.first().locator('.nc-save-reset').count()) === 1 && (await sc.first().locator('.nc-save-everyone-main').count()) === 1, (await sc.count()) ? await sc.first().innerText() : 'none');
    await shot('02-global-filter');
    await sc.first().locator('.nc-save-everyone-main').first().click();
    await wait(500);
    await saved(page);
    const dv2 = await storeGet(page, 'collection_view', dashId);
    check('Save for everyone: stored on the dashboard view', (dv2.format.property_filters ?? []).length === 1, JSON.stringify(dv2.format.property_filters));
    const widgetViews = await page.evaluate((did) => window.__ncEditor.records.all('collection_view').filter((v) => v.format?.dashboard_view_id === did).map((v) => [v.query2?.filter ?? null, v.format?.property_filters ?? null]), dashId);
    check('global filter: widget views themselves stay unfiltered', widgetViews.every(([f, p]) => !f && !(p ?? []).length), JSON.stringify(widgetViews));
  });

  await section('widths and drag', async () => {
    await db().locator('[data-testid="dashboard-edit"]').click();
    await wait(400);
    check('Edit dashboard: Edit mode again', (await mode()) === 'edit');
    const handle = db().locator('.nc-dash-col-resize').first();
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + 40);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + 40, { steps: 8 });
    await page.mouse.up();
    await wait(500);
    await saved(page);
    const ws = (await layout()).rows[0].widgets.map((w) => w.width ?? 1);
    check('width handle: the first widget is wider now', ws.length === 2 && ws[0] > ws[1], ws.join(','));
    const w0 = await db().locator('.nc-dash-widget').nth(0).boundingBox();
    const w1 = await db().locator('.nc-dash-widget').nth(1).boundingBox();
    check('width handle: rendered widths follow', w0.width > w1.width + 100, `${Math.round(w0.width)} / ${Math.round(w1.width)}`);
    // drag the list widget into a new row below
    const src = db().locator('.nc-dash-widget[data-view-type="list"] .nc-dash-widget-head');
    const target = db().locator('[data-testid="dashboard-drop-row"]').last();
    await src.dragTo(target);
    await wait(600);
    await saved(page);
    const l = await layout();
    check('drag: the widget moved to a new row', l.rows.length === 2 && l.rows[1].widgets.length === 1, JSON.stringify(l.rows.map((r) => r.widgets.length)));
    await shot('03-dragged');
    // and back next to the table (drop on its right half)
    const tableW = db().locator('.nc-dash-widget[data-view-type="table"]');
    const tb = await tableW.boundingBox();
    await db().locator('.nc-dash-widget[data-view-type="list"] .nc-dash-widget-head').dragTo(tableW, { targetPosition: { x: tb.width - 40, y: 80 } });
    await wait(600);
    await saved(page);
    const l2 = await layout();
    check('drag: dropped on the right half of a widget → same row, after it', l2.rows.length === 1 && l2.rows[0].widgets.length === 2, JSON.stringify(l2.rows.map((r) => r.widgets.length)));
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
await finish();

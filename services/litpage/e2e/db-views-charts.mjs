


// Run: NC_BASE=http://127.0.0.1:5471 node e2e/db-views-charts.mjs
import { freshPage } from './db-lib.mjs';
import { setup, createFullPageDb, storeGet, bulkRows, saved, addView, slash } from './dbv-lib.mjs';

const { page, context, wait, check, shot, section, finish, closeOverlays } = await setup('charts');
const db = () => page.locator('.nc-db').first();
const settingsRow = (label) => page.locator('.nc-view-settings [role="button"], .nc-view-settings .nc-menu-item').filter({ hasText: new RegExp(`^\\s*${label}`) }).first();
async function openSettings() {
  await db().hover();
  await wait(120);
  await db().locator('.nc-db-toolbar [aria-label="Settings"]').first().click();
  await page.waitForSelector('.nc-view-settings');
  await wait(250);
}
let blockId = '';
let collectionId = '';
let chartViewId = '';
let parentId = '';

try {
  parentId = await (async () => {
    await freshPage(page, 'DBV Charts', `dbv-charts-${Date.now()}@test.dev`);
    return page.evaluate(() => document.querySelector('.nc-page-content, [data-page-id]')?.closest('[data-page-id]')?.getAttribute('data-page-id') ?? null);
  })();

  await section('setup', async () => {
    blockId = await createFullPageDb(page, 'Chart DB');
    const b = await storeGet(page, 'block', blockId);
    collectionId = b.collection_id;
    parentId = b.parent_id;
    await page.evaluate((cid) => {
      const { records, transactions } = window.__ncEditor;
      const c = records.get('collection', cid);
      transactions.run(c.space_id, 'e2e.schema', (tx) => {
        tx.set('collection', cid, ['schema', 'kind'], { name: 'Kind', type: 'select', options: [{ id: 'o1', value: 'A', color: 'red' }, { id: 'o2', value: 'B', color: 'blue' }, { id: 'o3', value: 'C', color: 'green' }] });
        tx.set('collection', cid, ['schema', 'est'], { name: 'Est', type: 'number' });
      });
    }, collectionId);
    await bulkRows(page, collectionId, [
      { title: 'P1', props: { kind: [['A']], est: [['1']] } }, { title: 'P2', props: { kind: [['A']], est: [['2']] } }, { title: 'P3', props: { kind: [['A']], est: [['3']] } },
      { title: 'P4', props: { kind: [['B']], est: [['4']] } }, { title: 'P5', props: { kind: [['B']], est: [['5']] } }, { title: 'P6', props: { kind: [['C']], est: [['6']] } },
    ]);
    await saved(page);
    await addView(page, db(), 'Chart');
    const vb = await storeGet(page, 'block', blockId);
    chartViewId = vb.view_ids[vb.view_ids.length - 1];
    // X axis = Kind
    await page.evaluate((vid) => {
      const { records, transactions } = window.__ncEditor;
      const v = records.get('collection_view', vid);
      const cfg = structuredClone(v.format.chart_config);
      cfg.dataConfig.groupBy = { property: 'kind', type: 'select', hideEmptyGroups: false, sort: { type: 'manual' } };
      transactions.run(v.space_id, 'e2e.chart', (tx) => tx.update('collection_view', vid, ['format'], { chart_config: cfg }));
    }, chartViewId);
    await saved(page);
    await wait(400);
    check('setup: a bar per Kind (A, B, C)', (await db().locator('.nc-chart-point').count()) === 3, String(await db().locator('.nc-chart-point').count()));
  });

  await section('hidden groups', async () => {
    await openSettings();
    const list = page.locator('[data-testid="chart-groups"]').first();
    const txt = await list.innerText();
    check('settings: Visible groups lists A, B, C', txt.includes('Visible groups') && ['A', 'B', 'C'].every((x) => txt.includes(x)), txt.replace(/\n/g, ' | '));
    await list.locator('.nc-chart-group-row').filter({ hasText: /^\s*B\s*$/ }).locator('[aria-label="Hide group"]').click();
    await wait(400);
    await saved(page);
    const v = await storeGet(page, 'collection_view', chartViewId);
    check('hide B: saved in format.collection_groups', (v.format.collection_groups ?? []).some((g) => g.value?.value === 'B' && g.hidden), JSON.stringify(v.format.collection_groups));
    check('hide B: the chart has 2 bars', (await db().locator('.nc-chart-point').count()) === 2);
    check('hide B: listed under Hidden groups', (await page.locator('[data-testid="chart-groups"]').first().innerText()).includes('Hidden groups'));
    await shot('01-hidden-groups');
    await page.locator('[data-testid="chart-groups"] .nc-vs-section-action').filter({ hasText: 'Show all' }).first().click();
    await wait(400);
    check('Show all: 3 bars again', (await db().locator('.nc-chart-point').count()) === 3);
    await closeOverlays();
  });

  await section('color by value', async () => {
    await page.evaluate((vid) => {
      const { records, transactions } = window.__ncEditor;
      const v = records.get('collection_view', vid);
      const cfg = structuredClone(v.format.chart_config);
      cfg.chartFormat = { ...(cfg.chartFormat ?? {}), colorTheme: 'blue' };
      transactions.run(v.space_id, 'e2e.chart', (tx) => tx.update('collection_view', vid, ['format'], { chart_config: cfg }));
    }, chartViewId);
    await saved(page);
    await openSettings();
    await settingsRow('More style settings').click();
    await wait(300);
    const item = page.locator('.lit-overlay-container .nc-menu-item').filter({ hasText: /^\s*Color by metric/ }).first();
    check('style: "Color by metric" offered for a single-color bar chart', (await item.count()) === 1);
    await item.click();
    await wait(400);
    await saved(page);
    const v = await storeGet(page, 'collection_view', chartViewId);
    check('Color by value: saved (chartFormat.weightColorValue)', v.format.chart_config.chartFormat.weightColorValue === true);
    await closeOverlays();
    const ops = await db().locator('.nc-chart-point path').evaluateAll((els) => els.map((e) => e.getAttribute('fill-opacity')));
    check('Color by value: bars get different shades (largest = 1)', new Set(ops).size === 3 && ops.includes('1'), ops.join(','));
    await shot('02-color-by-value');
  });

  await section('legend toggle', async () => {
    await page.evaluate((vid) => {
      const { records, transactions } = window.__ncEditor;
      const v = records.get('collection_view', vid);
      const cfg = structuredClone(v.format.chart_config);
      cfg.type = 'donut';
      cfg.chartFormat = { ...(cfg.chartFormat ?? {}), colorTheme: 'auto', weightColorValue: false };
      transactions.run(v.space_id, 'e2e.chart', (tx) => tx.update('collection_view', vid, ['format'], { chart_config: cfg }));
    }, chartViewId);
    await saved(page);
    await wait(400);
    const slices = () => db().locator('.nc-chart-slice').count();
    check('donut: 3 slices', (await slices()) === 3);
    const item = db().locator('.nc-chart-legend-item.toggle').filter({ hasText: 'A' }).first();
    await item.click();
    await wait(300);
    check('legend: clicking "A" hides its slice', (await slices()) === 2 && /\boff\b/.test(await item.getAttribute('class')));
    await shot('03-legend-off');
    await item.click();
    await wait(300);
    check('legend: clicking again shows it', (await slices()) === 3);
  });

  await section('drilldown', async () => {
    // a ring slice is an SVG path: dispatch the click on it (its bounding box centre can fall in the hole)
    await db().locator('.nc-chart-point path').first().dispatchEvent('click');
    await page.waitForSelector('[data-testid="chart-drilldown"]', { timeout: 4000 });
    const dd = page.locator('[data-testid="chart-drilldown"]');
    const head = (await dd.locator('.nc-chart-drill-head').innerText()).replace(/\s+/g, ' ');
    const names = await dd.locator('.nc-chart-drill-name').allInnerTexts();
    check('drilldown: the pages of the clicked slice as a table', names.length > 0 && head.includes('Kind'), `${head} / ${names.join(',')}`);
    const label = (await dd.locator('.nc-chart-drill-title').innerText()).trim();
    const expected = { A: ['P1', 'P2', 'P3'], B: ['P4', 'P5'], C: ['P6'] }[label] ?? [];
    check('drilldown: exactly that group\'s pages', names.slice().sort().join(',') === expected.join(','), `${label}: ${names.join(',')}`);
    check('drilldown: property cells are read-only', (await dd.locator('.nc-chart-drill-td [contenteditable="true"]').count()) === 0);
    await wait(400);
    await shot('04-drilldown');
    await dd.locator('[aria-label="More"]').click();
    await wait(300);
    const menu = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('drilldown •••: Open Chart DB / Store layout in…', menu.includes('Open Chart DB') && menu.includes('Store layout in…'), menu.replace(/\n/g, ' | '));
    await page.locator('.lit-overlay-container .nc-menu-item').filter({ hasText: 'Store layout in…' }).first().click();
    await page.waitForSelector('.nc-page-picker input', { timeout: 4000 });
    await page.keyboard.type('DBV Charts', { delay: 15 });
    await wait(900);
    await page.locator('.nc-page-picker [role="option"]').filter({ hasText: 'DBV Charts' }).first().click();
    await wait(600);
    await saved(page);
    const made = await page.evaluate(([pid, cid]) => {
      const { records } = window.__ncEditor;
      const p = records.get('block', pid);
      const blocks = (p?.content ?? []).map((id) => records.get('block', id)).filter((b) => b && b.type === 'collection_view' && b.collection_id === cid && b.alive !== false);
      const v = blocks[0] ? records.get('collection_view', blocks[0].view_ids?.[0]) : null;
      return v ? { type: v.type, name: v.name, filter: v.query2?.filter } : null;
    }, [parentId, collectionId]);
    check('Save as view in…: a linked table view on the picked page, filtered to the group', made?.type === 'table' && JSON.stringify(made.filter).includes('enum_is') && JSON.stringify(made.filter).includes(`"${label}"`), JSON.stringify(made));
    await closeOverlays();
  });

  await section('export', async () => {
    await page.evaluate((vid) => {
      const { records, transactions } = window.__ncEditor;
      const v = records.get('collection_view', vid);
      const cfg = structuredClone(v.format.chart_config);
      cfg.type = 'column';
      transactions.run(v.space_id, 'e2e.chart', (tx) => tx.update('collection_view', vid, ['format'], { chart_config: cfg }));
    }, chartViewId);
    await saved(page);
    await openSettings();
    await settingsRow('Store chart as…').click();
    await page.waitForSelector('[data-testid="chart-export"]', { timeout: 4000 });
    const dlg = page.locator('[data-testid="chart-export"]');
    const txt = await dlg.innerText();
    check('Save chart as…: Preview, Background, Copy as PNG / Download PNG / Download SVG', ['Preview', 'Background', 'Copy as PNG', 'Download PNG', 'Download SVG'].every((x) => txt.includes(x)), txt.replace(/\n/g, ' | '));
    await page.waitForFunction(() => document.querySelector('[data-testid="chart-export"] img')?.complete && document.querySelector('[data-testid="chart-export"] img')?.naturalWidth > 0, null, { timeout: 4000 });
    check('Save chart as…: the preview image renders', true);
    await dlg.locator('[role="radio"][aria-label="Transparent"]').click();
    await wait(200);
    check('Background: Transparent selected', (await dlg.locator('[role="radio"][aria-checked="true"]').getAttribute('aria-label')) === 'Transparent');
    await shot('05-export');
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }), dlg.locator('[role="button"]').filter({ hasText: 'Download SVG' }).click()]);
    check('Download SVG: a .svg file', dl.suggestedFilename().endsWith('.svg'), dl.suggestedFilename());
    await closeOverlays();
    await openSettings();
    await settingsRow('Store chart as…').click();
    await page.waitForSelector('[data-testid="chart-export"]');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await page.locator('[data-testid="chart-export"] [role="button"]').filter({ hasText: 'Copy as PNG' }).click();
    await wait(800);
    const types = await page.evaluate(async () => {
      try {
        const items = await navigator.clipboard.read();
        return items.flatMap((i) => i.types);
      } catch (e) {
        return [`error: ${e.message}`];
      }
    });
    check('Copy as PNG: an image/png on the clipboard', types.includes('image/png'), types.join(','));
    await closeOverlays();
  });

  await section('slash chart', async () => {
    // back on the parent page: /Horizontal bar chart → New chart; /Donut chart → link "Chart DB"
    await page.locator('.nc-topbar a, .nc-breadcrumb [role="link"], .nc-crumb').filter({ hasText: /^\s*DBV Charts\s*$/ }).first().click();
    await page.waitForSelector('h1[data-content-editable-leaf]');
    await wait(500);
    await page.mouse.move(700, 700);
    await wait(300);
    const newLine = async () => {
      await page.locator('h1[data-content-editable-leaf]').first().click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await wait(250);
    };
    await newLine();
    await slash(page, 'row bar', 'Row bar chart');
    await page.waitForSelector('.nc-linked-picker', { timeout: 4000 });
    const pickerText = await page.locator('.nc-linked-picker').innerText();
    check('/chart: picker offers "New chart" and existing data sources', pickerText.includes('New chart') && pickerText.includes('Available datasets'), pickerText.replace(/\n/g, ' | '));
    await page.locator('.nc-linked-picker .nc-menu-item').filter({ hasText: 'New chart' }).first().click();
    await wait(800);
    await saved(page);
    const newChart = await page.evaluate((pid) => {
      const { records } = window.__ncEditor;
      const p = records.get('block', pid);
      const b = (p?.content ?? []).map((id) => records.get('block', id)).filter((x) => x?.type === 'collection_view' && x.alive !== false && records.get('collection', x.collection_id)?.parent_id === x.id).pop();
      const v = b ? records.get('collection_view', b.view_ids?.[0]) : null;
      const c = b ? records.get('collection', b.collection_id) : null;
      return { view: v?.type, chart: v?.format?.chart_config?.type, owned: !!c && c.parent_id === b?.id };
    }, parentId);
    check('/Horizontal bar chart › New chart: a new database whose chart is a horizontal bar chart', newChart.view === 'chart' && newChart.chart === 'bar' && newChart.owned, JSON.stringify(newChart));
    await page.keyboard.press('Escape');
    await newLine();
    await slash(page, 'donut', 'Donut chart');
    await page.waitForSelector('.nc-linked-picker', { timeout: 4000 });
    await wait(800);
    await page.locator('.nc-linked-picker .nc-menu-item').filter({ hasText: 'Chart DB' }).first().click();
    await wait(800);
    await saved(page);
    const linked = await page.evaluate(([pid, cid]) => {
      const { records } = window.__ncEditor;
      const p = records.get('block', pid);
      const b = (p?.content ?? []).map((id) => records.get('block', id)).filter((x) => x?.type === 'collection_view' && x.alive !== false && x.collection_id === cid && (x.view_ids ?? []).some((v) => records.get('collection_view', v)?.type === 'chart')).pop();
      const v = b ? records.get('collection_view', b.view_ids?.[0]) : null;
      return { chart: v?.format?.chart_config?.type, pointer: v?.format?.collection_pointer?.id };
    }, [parentId, collectionId]);
    check('/Donut chart › Chart DB: a linked donut chart of the existing data source', linked.chart === 'donut' && linked.pointer === collectionId, JSON.stringify(linked));
    await shot('06-slash-chart');
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
await finish();

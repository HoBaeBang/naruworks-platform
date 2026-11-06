


// Run: NC_BASE=http://127.0.0.1:5471 node e2e/db-views-core.mjs
import { freshPage, tableHelpers } from './db-lib.mjs';
import { setup, createFullPageDb, storeGet, bulkRows, saved, addView, esc } from './dbv-lib.mjs';

const { page, wait, check, shot, section, finish } = await setup('core');
const compact = (id) => id.replace(/-/g, '');
const tabSelected = async (name) => page.locator('.nc-db [role="tab"][aria-selected="true"]').filter({ hasText: new RegExp(`^\\s*${esc(name)}\\s*$`) }).count();

let blockId = '';
let collectionId = '';
let rowIds = [];
let dateProp = '';

try {
  await freshPage(page, 'DBV Core', `dbv-core-${Date.now()}@test.dev`);

  await section('setup', async () => {
    blockId = await createFullPageDb(page, 'Core DB');
    const block = await storeGet(page, 'block', blockId);
    collectionId = block.collection_id;
    const t = tableHelpers(page);
    await t.addProperty('When', 'Date');
    const col = await storeGet(page, 'collection', collectionId);
    dateProp = Object.entries(col.schema).find(([, p]) => p.name === 'When')?.[0] ?? '';
    const dated = (d) => ({ [dateProp]: [['‣', [['d', { type: 'date', start_date: d }]]]] });
    rowIds = await bulkRows(page, collectionId, Array.from({ length: 12 }, (_, i) => ({
      title: `R${String(i + 1).padStart(2, '0')}`,
      props: i < 8 ? dated(`2026-10-${String(i + 5).padStart(2, '0')}`) : undefined,
    })));
    await saved(page);
    await wait(300);
    check('setup: 12 rows in the table', (await t.titles()).length === 12, (await t.titles()).join(','));
  });

  await section('document title', async () => {
    check('title: single view = "<db> | Litpage"', (await page.title()) === 'Core DB | Litpage', await page.title());
    await addView(page, page.locator('.nc-db').first(), 'Board');
    await wait(300);
    check('title: several views add the view name', (await page.title()) === 'Core DB | Board | Litpage', await page.title());
  });

  await section('sidebar view rows', async () => {
    // back on the parent page: expand "DBV Core" › "Core DB" in the sidebar and click the views
    const parentRow = page.locator('nav .nc-sb-item').filter({ hasText: /^\s*DBV Core\s*$/ }).first();
    await parentRow.click();
    await page.waitForSelector('.nc-db.inline, .nc-page-content, h1[data-content-editable-leaf]');
    await wait(400);
    await parentRow.hover();
    const toggle = parentRow.locator('.nc-sb-toggle').first();
    if (await toggle.getAttribute('aria-label') === 'Open') await toggle.click();
    await wait(300);
    const dbRow = page.locator('nav .nc-sb-item').filter({ hasText: /^\s*Core DB\s*$/ }).first();
    await dbRow.hover();
    const dbToggle = dbRow.locator('.nc-sb-toggle').first();
    if (await dbToggle.getAttribute('aria-label') === 'Open') await dbToggle.click();
    await wait(300);
    const viewRow = (name) => page.locator('nav .nc-sb-page a.nc-sb-item').filter({ has: page.locator('.nc-sb-view-dot') }).filter({ hasText: new RegExp(`^\\s*${esc(name)}\\s*$`) }).first();
    check('sidebar: database lists its views', (await viewRow('Table').count()) === 1 && (await viewRow('Board').count()) === 1);
    await viewRow('Table').click();
    await page.waitForSelector('.nc-db.full');
    await wait(500);
    check('sidebar: clicking "Table" opens the database on Table', (await tabSelected('Table')) === 1);
    await viewRow('Board').click();
    await wait(500);
    check('sidebar: clicking "Board" switches the open database to Board', (await tabSelected('Board')) === 1);
    check('sidebar: URL carries the view', page.url().includes('v='), page.url());
    await shot('01-sidebar-view');
    await viewRow('Table').click();
    await wait(400);
  });

  await section('peek previous / next', async () => {
    const t = tableHelpers(page);
    // sort Name descending (store) so the view order differs from creation order
    const viewId = (await storeGet(page, 'block', blockId)).view_ids[0];
    await page.evaluate(([vid]) => {
      const { records, transactions } = window.__ncEditor;
      const v = records.get('collection_view', vid);
      transactions.run(v.space_id, 'e2e.sort', (tx) => tx.set('collection_view', vid, ['query2'], { ...(v.query2 ?? {}), sort: [{ property: 'title', direction: 'descending' }] }));
    }, [viewId]);
    await wait(400);
    const order = await t.titles();
    check('peek: table sorted descending', order[0] === 'R12' && order[1] === 'R11', order.slice(0, 3).join(','));
    const r = t.rowByTitle('R11');
    await r.hover();
    await r.locator('.nc-open-button').click();
    await page.waitForSelector('.nc-side-peek');
    await wait(500);
    const peekId = () => new URL(page.url()).searchParams.get('p');
    check('peek: opened R11', peekId() === compact(rowIds[10]));
    await page.locator('.nc-side-peek .peek-top-hover-area').hover();
    await wait(150);
    const next = page.locator('.nc-side-peek [aria-label="Next page"]').first();
    check('peek: Next page button has the shortcut tooltip', !!(await next.getAttribute('data-tooltip-sub')));
    await next.click();
    await wait(400);
    check('peek: Next page follows the view order (R10)', peekId() === compact(rowIds[9]), peekId());
    await page.keyboard.press('Control+Shift+K');
    await wait(400);
    check('peek: Ctrl+Shift+K goes back to R11', peekId() === compact(rowIds[10]), peekId());
    await page.keyboard.press('Control+Shift+K');
    await wait(400);
    check('peek: Ctrl+Shift+K reaches the first row (R12)', peekId() === compact(rowIds[11]), peekId());
    await page.locator('.nc-side-peek .peek-top-hover-area').hover();
    await wait(150);
    check('peek: Previous page disabled on the first row', (await page.locator('.nc-side-peek [aria-label="Previous page"]').first().getAttribute('aria-disabled')) === 'true');
    await page.keyboard.press('Control+Shift+J');
    await wait(400);
    check('peek: Ctrl+Shift+J moves down (R11)', peekId() === compact(rowIds[10]), peekId());
    await shot('02-peek-nav');
    await page.keyboard.press('Escape');
    await wait(300);
  });

  await section('feed load more', async () => {
    await addView(page, page.locator('.nc-db').first(), 'Feed');
    await wait(500);
    const cards = () => page.locator('.nc-db .nc-feed-card');
    check('feed: first 10 posts (load limit 10)', (await cards().count()) === 10, String(await cards().count()));
    const more = page.locator('.nc-db .nc-feed-load-more');
    check('feed: "Load more" shown', (await more.count()) === 1);
    await more.click();
    await wait(300);
    check('feed: Load more shows the rest', (await cards().count()) === 12, String(await cards().count()));
    check('feed: Load more gone at the end', (await more.count()) === 0);
  });

  await section('timeline load limit', async () => {
    await addView(page, page.locator('.nc-db').first(), 'Timeline');
    await wait(500);
    const viewId = await page.evaluate((bid) => {
      const { records } = window.__ncEditor;
      const b = records.get('block', bid);
      return b.view_ids.find((v) => records.get('collection_view', v)?.type === 'timeline');
    }, blockId);
    await page.evaluate(([vid]) => {
      const { records, transactions } = window.__ncEditor;
      const v = records.get('collection_view', vid);
      transactions.run(v.space_id, 'e2e.limit', (tx) => tx.update('collection_view', vid, ['format'], { inline_collection_first_load_limit: { type: 'load_limit', limit: 10 } }));
    }, [viewId]);
    await wait(400);
    const rowsTl = () => page.locator('.nc-db .nc-tl-rows .nc-tl-row:not(.nc-tl-addrow)');
    check('timeline: load limit 10 shows 10 items', (await rowsTl().count()) === 10, String(await rowsTl().count()));
    const more = page.locator('.nc-db .nc-tl-load-more');
    check('timeline: "Load more" row', (await more.count()) === 1);
    await more.click();
    await wait(300);
    check('timeline: Load more shows all 12', (await rowsTl().count()) === 12, String(await rowsTl().count()));
    await shot('03-timeline');
  });

  await section('calendar no date', async () => {
    await addView(page, page.locator('.nc-db').first(), 'Calendar');
    await wait(500);
    // the calendar shows by "When" (the only date property)
    const btn = page.locator('.nc-db .nc-nodate-button');
    check('calendar: "No date (4)" in the toolbar', (await btn.innerText()).trim() === 'No date (4)', await btn.innerText().catch(() => ''));
    await btn.click();
    await page.waitForSelector('.nc-nodate-popup');
    const popup = page.locator('.nc-nodate-popup');
    check('calendar: popup hint', (await popup.innerText()).includes('Click or drag an item onto the calendar to set a date.'));
    check('calendar: popup lists the 4 pages', (await popup.locator('.nc-nodate-row').count()) === 4);
    await page.locator('.nc-nodate-popup input').fill('R10');
    await wait(250);
    check('calendar: search narrows to R10', (await popup.locator('.nc-nodate-row').count()) === 1);
    await shot('04-no-date');
    await popup.locator('.nc-nodate-row').first().click();
    await wait(400);
    const r10 = await storeGet(page, 'block', rowIds[9]);
    const v = r10.properties?.[dateProp]?.[0]?.[1]?.[0]?.[1];
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    check('calendar: clicking gives the page today\'s date', v?.start_date === iso, JSON.stringify(v));
    check('calendar: count drops to 3', (await btn.innerText()).trim() === 'No date (3)', await btn.innerText());
    // drag R11 onto the 1st of the month
    await btn.click();
    await page.waitForSelector('.nc-nodate-popup');
    const src = page.locator('.nc-nodate-popup .nc-nodate-row').filter({ hasText: 'R11' }).first();
    const target = page.locator('.nc-db .nc-cal-day').filter({ has: page.locator('.nc-cal-num:not(.outside)') }).first();
    const day = await target.getAttribute('data-day');
    const sb = await src.boundingBox();
    const tb = await target.boundingBox();
    await page.mouse.move(sb.x + 40, sb.y + sb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + 60, sb.y + sb.height / 2 + 10, { steps: 4 });
    await wait(150);
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 8 });
    await wait(150);
    await page.mouse.up();
    await wait(500);
    const r11 = await storeGet(page, 'block', rowIds[10]);
    check('calendar: dragging a page onto a day dates it', r11.properties?.[dateProp]?.[0]?.[1]?.[0]?.[1]?.start_date === day, `${day} ${JSON.stringify(r11.properties?.[dateProp])}`);
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
await finish();

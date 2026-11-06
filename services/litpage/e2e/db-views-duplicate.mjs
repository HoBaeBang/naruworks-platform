


// Run: NC_BASE=http://127.0.0.1:5471 node e2e/db-views-duplicate.mjs
import { freshPage, createInlineDb, apiCall } from './db-lib.mjs';
import { setup, storeGet, bulkRows, saved, addView } from './dbv-lib.mjs';

const { page, wait, check, shot, section, finish, closeOverlays } = await setup('duplicate');

const dbs = () => page.locator('.nc-db.inline');
const dbBlockIds = () => page.$$eval('.nc-db-block', (els) => els.map((e) => e.getAttribute('data-block-id')));
async function blockMenu(index) {
  const title = dbs().nth(index).locator('.nc-db-title-row, .nc-db-title-only').first();
  for (let i = 0; i < 4; i++) {
    await title.hover();
    await wait(200);
    const handle = page.locator('.nc-block-handle');
    if (await handle.count()) {
      await handle.first().click();
      await wait(300);
      return page.locator('.lit-overlay-container .nc-overlay').last();
    }
  }
  throw new Error('no block handle');
}
const rowsOf = (cid) => page.evaluate((c) => window.__ncEditor.records.all('block').filter((b) => b.parent_table === 'collection' && b.parent_id === c && b.alive !== false && !b.is_template).map((b) => b.properties?.title?.[0]?.[0]).sort(), cid);

let src = { block: '', collection: '', rows: [], tpl: '', rel: '' };

try {
  await freshPage(page, 'Dup Lab', `dbv-dup-${Date.now()}@test.dev`);

  await section('setup', async () => {
    await createInlineDb(page, 'Dup Src');
    src.block = (await dbBlockIds())[0];
    src.collection = (await storeGet(page, 'block', src.block)).collection_id;
    // a one-way self relation "Related" + rows + a template, through the record store
    src.rel = 'rL1x';
    await page.evaluate(([cid, rel]) => {
      const { records, transactions } = window.__ncEditor;
      const c = records.get('collection', cid);
      transactions.run(c.space_id, 'e2e.schema', (tx) => tx.set('collection', cid, ['schema', rel], { name: 'Related', type: 'relation', collection_id: cid, version: 'v2' }));
    }, [src.collection, src.rel]);
    src.rows = await bulkRows(page, src.collection, [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }]);
    await page.evaluate(([cid, rel, a, b]) => {
      const { records, transactions } = window.__ncEditor;
      const c = records.get('collection', cid);
      const tpl = crypto.randomUUID();
      transactions.run(c.space_id, 'e2e.relTpl', (tx) => {
        tx.set('block', a, ['properties', rel], [['‣', [['p', b, c.space_id]]]]);
        tx.set('block', tpl, [], { id: tpl, type: 'page', parent_id: cid, parent_table: 'collection', alive: true, is_template: true, space_id: c.space_id, properties: { title: [['Bug template']] } });
        tx.listAfter('collection', cid, ['template_pages'], tpl);
      });
    }, [src.collection, src.rel, src.rows[0], src.rows[1]]);
    src.tpl = (await storeGet(page, 'collection', src.collection)).template_pages[0];
    await addView(page, dbs().first(), 'Board');
    await saved(page);
    check('setup: source has 3 rows and 2 views', (await rowsOf(src.collection)).length === 3 && (await storeGet(page, 'block', src.block)).view_ids.length === 2);
  });

  let copy1 = '';
  await section('duplicate with content', async () => {
    const menu = await blockMenu(0);
    await shot('01-block-menu');
    const dup = menu.locator('.nc-menu-item').filter({ hasText: /^\s*Duplicate\s*⌘D\s*$/ }).first();
    check('menu: database "Duplicate" item', (await dup.count()) === 1, await menu.innerText());
    check('menu: Turn into page ("Change to entry") in the first section', (await menu.innerText()).includes('Change to entry'));
    await dup.hover();
    await wait(400);
    const sub = page.locator('.lit-overlay-container .nc-overlay').last();
    const subText = await sub.innerText();
    check('submenu: Make a copy with content (⌘D) / Make an empty copy', subText.includes('Make a copy with content') && subText.includes('Make an empty copy') && subText.includes('⌘D'), subText);
    await shot('02-duplicate-submenu');
    await sub.getByText('Make a copy with content', { exact: true }).click();
    await wait(800);
    await saved(page);
    await wait(500);
    const ids = await dbBlockIds();
    check('with content: a second database below the source', ids.length === 2 && ids[0] === src.block, ids.join(','));
    copy1 = ids[1];
    const cb = await storeGet(page, 'block', copy1);
    const sb = await storeGet(page, 'block', src.block);
    check('with content: copy has its own data source', !!cb.collection_id && cb.collection_id !== sb.collection_id);
    check('with content: copy has its own views', cb.view_ids.length === 2 && cb.view_ids.every((v) => !sb.view_ids.includes(v)));
    const cv = await storeGet(page, 'collection_view', cb.view_ids[0]);
    check('with content: copied views point at the copy', (cv.format?.collection_pointer?.id ?? cb.collection_id) === cb.collection_id, JSON.stringify(cv.format?.collection_pointer));
    const copyRows = await rowsOf(cb.collection_id);
    check('with content: rows copied', copyRows.join(',') === 'Alpha,Beta,Gamma', copyRows.join(','));
    const cc = await storeGet(page, 'collection', cb.collection_id);
    check('with content: template copied', (cc.template_pages ?? []).length === 1 && cc.template_pages[0] !== src.tpl);
    check('with content: self relation re-targeted to the copy', cc.schema[src.rel]?.collection_id === cb.collection_id, JSON.stringify(cc.schema[src.rel]));
    const copyAlpha = await page.evaluate((c) => window.__ncEditor.records.all('block').find((b) => b.parent_id === c && b.properties?.title?.[0]?.[0] === 'Alpha'), cb.collection_id);
    const relTarget = copyAlpha?.properties?.[src.rel]?.[0]?.[1]?.[0]?.[1];
    const copyBeta = await page.evaluate((c) => window.__ncEditor.records.all('block').find((b) => b.parent_id === c && b.properties?.title?.[0]?.[0] === 'Beta')?.id, cb.collection_id);
    check('with content: relation values point at the copied rows', !!relTarget && relTarget === copyBeta, `${relTarget} vs ${copyBeta}`);
    // editing the copy leaves the source alone
    await page.evaluate(([id]) => {
      const { records, transactions } = window.__ncEditor;
      const b = records.get('block', id);
      transactions.run(b.space_id, 'e2e.rename', (tx) => tx.set('block', id, ['properties', 'title'], [['Alpha copy']]));
    }, [copyAlpha.id]);
    await saved(page);
    check('independent: renaming a copied row keeps the source row', (await rowsOf(src.collection)).includes('Alpha') && (await rowsOf(cb.collection_id)).includes('Alpha copy'));
    await shot('03-after-duplicate');
  });

  await section('undo', async () => {
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 400);
    await page.keyboard.press('Meta+z'); // the rename
    await wait(300);
    await page.keyboard.press('Meta+z'); // the duplicate
    await wait(600);
    const ids = await dbBlockIds();
    check('undo: ⌘Z removes the duplicate', ids.length === 1, ids.join(','));
    await page.keyboard.press('Meta+Shift+z');
    await wait(600);
    check('redo: ⌘⇧Z brings it back', (await dbBlockIds()).length === 2);
  });

  await section('duplicate without content', async () => {
    const menu = await blockMenu(0);
    await menu.locator('.nc-menu-item').filter({ hasText: /^\s*Duplicate\s*⌘D\s*$/ }).first().hover();
    await wait(400);
    await page.locator('.lit-overlay-container .nc-overlay').last().getByText('Make an empty copy', { exact: true }).click();
    await wait(800);
    await saved(page);
    const ids = await dbBlockIds();
    check('without content: a third database', ids.length === 3, ids.join(','));
    const cb = await storeGet(page, 'block', ids[1]);
    const cc = await storeGet(page, 'collection', cb.collection_id);
    check('without content: same properties', !!cc.schema[src.rel] && cc.schema.title?.name === 'Name');
    check('without content: no rows', (await rowsOf(cb.collection_id)).length === 0, (await rowsOf(cb.collection_id)).join(','));
    check('without content: templates copied', (cc.template_pages ?? []).length === 1 && cc.template_pages[0] !== src.tpl);
  });

  await section('cmd+d', async () => {
    // select the source database block (what clicking its handle / Esc does) and press ⌘D
    await page.evaluate((id) => window.__ncEditor.useEditor.getState().selectBlocks([id], id), src.block);
    await wait(150);
    await page.keyboard.press('Meta+d');
    await wait(800);
    await saved(page);
    const ids = await dbBlockIds();
    check('⌘D: duplicates the selected database with content', ids.length === 4, ids.join(','));
    if (ids.length === 4) {
      const cb = await storeGet(page, 'block', ids[1]);
      check('⌘D: rows copied', (await rowsOf(cb.collection_id)).length === 3);
    }
  });

  await section('reload', async () => {
    await page.reload();
    await page.waitForSelector('.nc-db.inline');
    await wait(1200);
    const ids = await dbBlockIds();
    check('reload: all databases persist', ids.length === 4, ids.join(','));
    const counts = [];
    for (const id of ids) {
      const b = await storeGet(page, 'block', id);
      counts.push((await rowsOf(b.collection_id)).length);
    }
    check('reload: rows persist per copy (source 3, ⌘D 3, without content 0, with content 3)', counts.join(',') === '3,3,0,3', counts.join(','));
  });

  await section('server page duplicate', async () => {
    const pageId = await page.evaluate((id) => window.__ncEditor.records.get('block', id).parent_id, src.block);
    const res = await apiCall(page, 'duplicateBlock', { blockId: pageId });
    check('page duplicate: ok', res.status === 200, JSON.stringify(res.body).slice(0, 200));
    const dupPage = res.body?.blockId;
    const info = await page.evaluate(async ([id]) => {
      const r = await fetch('/api/rpc/loadPage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: id, limit: 100 }) });
      return r.json();
    }, [dupPage]);
    const blocks = Object.values(info?.recordMap?.block ?? {}).map((x) => x.value.value ?? x.value);
    const dbsCopied = blocks.filter((b) => b.type === 'collection_view' && b.parent_id === dupPage);
    const srcCols = new Set();
    for (const id of await dbBlockIds()) srcCols.add((await storeGet(page, 'block', id)).collection_id);
    check('page duplicate: inline databases copied with new data sources', dbsCopied.length === 4 && dbsCopied.every((b) => b.collection_id && !srcCols.has(b.collection_id)), `${dbsCopied.length}`);
    const views = Object.values(info?.recordMap?.collection_view ?? {}).map((x) => x.value.value ?? x.value).filter((v) => dbsCopied.some((b) => b.id === v.parent_id));
    check('page duplicate: views re-pointed at the copies', views.length >= 4 && views.every((v) => !v.format?.collection_pointer || !srcCols.has(v.format.collection_pointer.id)), `${views.length}`);
  });

  await section('turn into page / inline', async () => {
    await closeOverlays();
    const ids = await dbBlockIds();
    const target = ids[ids.length - 1];
    const menu = await blockMenu(ids.length - 1);
    await menu.getByText('Change to entry', { exact: true }).click();
    await wait(600);
    check('turn into page: block becomes a full-page database', (await storeGet(page, 'block', target)).type === 'collection_view_page');
    check('turn into page: shown as a page link on the parent', (await dbBlockIds()).length === ids.length - 1);
    const link = page.locator(`[data-block-id="${target}"]`).first();
    await link.hover();
    await wait(250);
    await page.locator('.nc-block-handle').first().click();
    await wait(300);
    const m2 = page.locator('.lit-overlay-container .nc-overlay').last();
    check('page link menu: Change to inline table', (await m2.innerText()).includes('Change to inline table'), await m2.innerText());
    await m2.getByText('Change to inline table', { exact: true }).click();
    await wait(600);
    check('turn into inline: inline again', (await storeGet(page, 'block', target)).type === 'collection_view' && (await dbBlockIds()).includes(target));
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
await finish();

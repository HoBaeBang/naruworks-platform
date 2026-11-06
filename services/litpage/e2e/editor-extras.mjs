


// Run: NC_BASE=http://127.0.0.1:5461 node e2e/editor-extras.mjs
import { start, newPage, shot, type, check, failed, MOD, tree, selectInFocused, appendBlock } from './editor-lib.mjs';

const { browser, context, page } = await start();
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
const wait = (ms) => page.waitForTimeout(ms);
const rec = (id) => page.evaluate((x) => window.__ncEditor.records.get('block', x), id);

try {
  await newPage(page, 'Extras');

  // ---- table: merge, fill, unmerge
  await type(page, '/table', 20);
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(400);
  for (const v of ['A1', 'B1', 'C1', 'A2', 'B2', 'C2', 'A3', 'B3', 'C3']) {
    await type(page, v, 10);
    await page.keyboard.press('Tab');
  }
  await wait(300);
  const tbl = page.locator('.lit-table-block').last();
  const tableId = await tbl.getAttribute('data-block-id');
  const cell = (r, c) => tbl.locator('tr.lit-table-row').nth(r).locator('td').nth(c);
  async function selectRange(r0, c0, r1, c1) {
    const a = await cell(r0, c0).boundingBox();
    const b = await cell(r1, c1).boundingBox();
    await page.mouse.move(a.x + 20, a.y + 15);
    await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + 15, { steps: 8 });
    await page.mouse.up();
    await wait(250);
  }
  const values = async () => page.evaluate((id) => {
    const { records } = window.__ncEditor;
    const t = records.get('block', id);
    const cols = t.format.table_block_column_order;
    return t.content.map((rid) => cols.map((c) => (records.get('block', rid).properties?.[c] ?? []).map((d) => d[0]).join('')));
  }, tableId);
  // fill down: first column rows 1..3
  await selectRange(0, 0, 2, 0);
  await page.keyboard.press(`${MOD}+d`);
  await wait(300);
  let v = await values();
  check('⌘D fills the selection down', v[0][0] === 'A1' && v[1][0] === 'A1' && v[2][0] === 'A1', v);
  // fill right: last row
  await selectRange(2, 0, 2, 2);
  await page.keyboard.press(`${MOD}+r`);
  await wait(300);
  v = await values();
  check('⌘R fills the selection right (page not reloaded)', v[2].join() === 'A1,A1,A1', v);
  // merge B1:C2
  await selectRange(0, 1, 1, 2);
  await cell(0, 1).click({ button: 'right' });
  await wait(300);
  check('cell menu offers "Merge cells"', (await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Merge cells' }).count()) === 1);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Merge cells' }).click();
  await wait(400);
  let t = await rec(tableId);
  check('merge stored on the table (2×2 anchor B1)', JSON.stringify(t.format.table_block_merges?.map((m) => [m.rows, m.cols])) === '[[2,2]]', t.format.table_block_merges);
  v = await values();
  check('merge keeps the top-left content, clears the rest', v[0][1] === 'B1' && v[0][2] === '' && v[1][1] === '' && v[1][2] === '', v);
  const merged = tbl.locator('td[data-merged="2x2"]');
  check('merged cell spans 2 rows and 2 columns', (await merged.count()) === 1 && (await merged.getAttribute('rowspan')) === '2' && (await merged.getAttribute('colspan')) === '2');
  check('covered cells are not rendered', (await tbl.locator('tr.lit-table-row').nth(1).locator('td').count()) === 1);
  await shot(page, 'table-merged');
  await merged.click({ position: { x: 20, y: 15 } });
  await page.keyboard.press('Escape');
  await wait(200);
  await merged.click({ button: 'right', position: { x: 20, y: 15 } });
  await wait(300);
  check('merged cell menu offers "Unmerge cells"', (await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Unmerge cells' }).count()) === 1);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Unmerge cells' }).click();
  await wait(400);
  t = await rec(tableId);
  check('unmerge removes the merge', !(t.format.table_block_merges ?? []).length && (await tbl.locator('tr.lit-table-row').nth(1).locator('td').count()) === 3);

  // ---- several blocks → one column each
  await appendBlock(page);
  await type(page, 'Col one');
  await page.keyboard.press('Enter');
  await type(page, 'Col two');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowUp');
  await wait(200);
  await page.keyboard.press(`${MOD}+/`);
  await wait(300);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Turn into' }).first().hover();
  await wait(400);
  await page.locator('.lit-overlay-container [role="menuitem"]', { hasText: '2 columns' }).click();
  await wait(400);
  const tr = await tree(page);
  const cl = tr.find((b) => b.t === 'column_list');
  check('2 selected blocks → 2 columns, one block each', cl?.k?.length === 2 && cl.k[0].k?.[0]?.x === 'Col one' && cl.k[1].k?.[0]?.x === 'Col two', cl);

  // ---- inline reaction
  await appendBlock(page);
  await type(page, 'React to this');
  await selectInFocused(page, 0, 5);
  await page.locator('.lit-text-action-menu [aria-label="React to this selection"], .lit-text-action-menu [data-tooltip="React to this selection"]').first().click();
  await wait(400);
  await page.locator('.lit-overlay-container .nc-em-search input').fill('thumbs up');
  await wait(300);
  await page.locator('.lit-overlay-container [role="gridcell"]').first().click();
  await wait(600);
  const rx = await page.evaluate(() => {
    const { records } = window.__ncEditor;
    const blk = records.all('block').find((b) => (b.properties?.title ?? []).map((d) => d[0]).join('') === 'React to this');
    const d = records.get('discussion', blk?.discussions?.[0]);
    const c = records.get('comment', d?.comments?.[0]);
    return { text: c?.text, reactions: c?.reactions, anchored: (blk?.properties?.title ?? []).some((r) => (r[1] ?? []).some((a) => a[0] === 'm')) };
  });
  check('inline reaction = thread with only a reaction on the text', Array.isArray(rx.text) && rx.text.length === 0 && Object.keys(rx.reactions ?? {}).length === 1 && rx.anchored, rx);
  check('margin shows the reaction chip', (await page.locator('.nc-margin-chip.reaction').count()) === 1);
  await shot(page, 'inline-reaction');

  // ---- comment composer: date mention, ↑ edits the last comment
  await appendBlock(page);
  await type(page, 'Commented text');
  await selectInFocused(page, 0, 9);
  await page.keyboard.press(`${MOD}+Shift+m`);
  await page.waitForSelector('.nc-discussion-popover.composer .nc-comment-input', { timeout: 5000 });
  await type(page, 'Due @tomorrow', 25);
  await wait(400);
  const dateRow = page.locator('.lit-overlay-container [role="option"]', { hasText: 'Tomorrow' }).first();
  check('comment "@" menu offers dates', (await dateRow.count()) === 1);
  await page.keyboard.press('Enter');
  await wait(200);
  await page.keyboard.press('Enter');
  await wait(600);
  const ct = await page.evaluate(() => {
    const { records } = window.__ncEditor;
    return records.all('comment').filter((c) => (c.text ?? []).some((d) => (d[1] ?? []).some((a) => a[0] === 'd'))).length;
  });
  check('comment with a date mention saved', ct === 1, ct);
  await page.click('.lit-page-content [data-discussion-id] >> nth=-1');
  await wait(500);
  await page.click('.nc-discussion-popover .nc-comment-input');
  await page.keyboard.press('ArrowUp');
  await wait(300);
  check('↑ in the empty composer edits your last comment', (await page.locator('.nc-discussion-popover .nc-comment [aria-label="Update comment"]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // ---- ⌘⇧V plain paste, ⌥⇧L copy link to block
  await appendBlock(page);
  // ⌘⇧V then the browser's paste event (synthetic here: headless keys don't run the native paste command)
  await page.keyboard.press(`${MOD}+Shift+v`);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/html', '<b>Bold</b> <i>it</i>');
    dt.setData('text/plain', 'Bold it');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await wait(500);
  const pasted = await page.evaluate(() => {
    const { records, useEditor } = window.__ncEditor;
    return records.get('block', useEditor.getState().focused?.blockId)?.properties?.title;
  });
  check('⌘⇧V pastes plain text without formatting', JSON.stringify(pasted) === JSON.stringify([['Bold it']]), pasted);
  await page.keyboard.press('Alt+Shift+l');
  await wait(400);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('⌥⇧L copies a link to the block', /#[0-9a-f]{32}$/.test(clip), clip);
} catch (e) {
  check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);

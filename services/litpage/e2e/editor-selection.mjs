// Block selection & drag and drop: dragging a text selection out of its block → block selection, Shift+click range,
// ⌘⇧click toggle, halo style, delete + undo, handle drag reorder (4px rgba(129,140,248,.43) indicator), drop at the
// right edge → columns, marquee from the margin, typing undo grouping.
import { start, newPage, tree, shot, type, check, failed, selectedBlocks, MOD, appendBlock, richText } from './editor-lib.mjs';

const { browser, page } = await start();
const leaf = (txt) => page.locator('.lit-page-content [data-content-editable-leaf]', { hasText: new RegExp(`^${txt}$`) }).first();
const blockEl = (txt) => leaf(txt).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " lit-selectable ")][1]');
try {
  await newPage(page, 'Selection');
  for (const r of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']) {
    await type(page, r);
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press('Backspace');

  // drag a text selection from Alpha down into Charlie → block selection Alpha..Charlie
  const a = await leaf('Alpha').boundingBox();
  const c = await leaf('Charlie').boundingBox();
  await page.mouse.move(a.x + 10, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + 40, a.y + a.height / 2, { steps: 4 });
  await page.mouse.move(c.x + 30, c.y + c.height / 2, { steps: 8 });
  let sel = await selectedBlocks(page);
  const textSel = await page.evaluate(() => getSelection()?.toString());
  await shot(page, 'drag-select');
  await page.mouse.up();
  check('dragging out of a block switches to block selection', sel.length === 3 && !textSel, { sel: sel.length, textSel });

  // halo style
  const halo = await page.evaluate(() => {
    const h = document.querySelector('.lit-selectable-halo');
    if (!h) return null;
    const cs = getComputedStyle(h);
    return { bg: cs.backgroundColor, inset: cs.top, radius: cs.borderRadius };
  });
  check('halo rgba(129,140,248,.14) inset 2px r4', halo?.bg === 'rgba(129, 140, 248, 0.14)' && halo?.inset === '2px' && halo?.radius === '4px', halo);

  // delete + undo
  await page.keyboard.press('Backspace');
  let t = await tree(page);
  check('Backspace deletes selected blocks', t.map((b) => b.x).join() === 'Delta,Echo', t.map((b) => b.x));
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(200);
  t = await tree(page);
  check('⌘Z restores them', t.map((b) => b.x).join() === 'Alpha,Bravo,Charlie,Delta,Echo', t.map((b) => b.x));
  await page.keyboard.press('Escape');

  // Shift+click range from the caret block
  await leaf('Bravo').click();
  await blockEl('Delta').click({ modifiers: ['Shift'] });
  sel = await selectedBlocks(page);
  check('Shift+click selects the range Bravo..Delta', sel.length === 3, sel.length);
  // ⌘⇧click toggles a block out of the selection
  await blockEl('Charlie').click({ modifiers: [MOD, 'Shift'] });
  sel = await selectedBlocks(page);
  check('⌘⇧click toggles a block', sel.length === 2, sel.length);
  await page.keyboard.press('Escape');

  // drag handle: move Echo above Alpha
  await leaf('Echo').hover();
  await page.waitForTimeout(150);
  const handle = page.locator('.nc-block-handle');
  const hb = await handle.boundingBox();
  const ab = await blockEl('Alpha').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 30, hb.y - 20, { steps: 5 });
  await page.mouse.move(ab.x + 100, ab.y + 4, { steps: 10 });
  const ind = await page.evaluate(() => {
    const d = document.querySelector('.nc-drop-indicator');
    if (!d) return null;
    const cs = getComputedStyle(d);
    return { h: d.getBoundingClientRect().height, bg: cs.backgroundColor };
  });
  await shot(page, 'drag-indicator');
  await page.mouse.up();
  await page.waitForTimeout(200);
  check('drop indicator 4px rgba(129,140,248,.43)', ind?.h === 4 && ind?.bg === 'rgba(129, 140, 248, 0.43)', ind);
  t = await tree(page);
  check('handle drag reorders (Echo first)', t[0]?.x === 'Echo', t.map((b) => b.x));

  // drop just outside the right edge of Bravo → columns
  await page.keyboard.press('Escape');
  await leaf('Delta').hover();
  await page.waitForTimeout(150);
  const hb2 = await page.locator('.nc-block-handle').boundingBox();
  const bb = await blockEl('Bravo').boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb2.x + 40, hb2.y, { steps: 5 });
  await page.mouse.move(bb.x + bb.width + 6, bb.y + bb.height / 2, { steps: 12 });
  const vind = await page.evaluate(() => {
    const d = document.querySelector('.nc-drop-indicator');
    return d ? { w: d.getBoundingClientRect().width, h: d.getBoundingClientRect().height } : null;
  });
  await page.mouse.up();
  await page.waitForTimeout(250);
  t = await tree(page);
  const cl = t.find((b) => b.t === 'column_list');
  check('vertical indicator at the right edge', vind?.w === 4, vind);
  check('drop at right edge creates columns [Bravo | Delta]', !!cl && cl.k?.[0]?.k?.[0]?.x === 'Bravo' && cl.k?.[1]?.k?.[0]?.x === 'Delta', cl);
  await shot(page, 'drag-columns');

  // marquee from the left margin
  await page.keyboard.press('Escape');
  const ech = await blockEl('Echo').boundingBox();
  const cha = await blockEl('Charlie').boundingBox();
  await page.mouse.move(ech.x - 60, ech.y - 4);
  await page.mouse.down();
  await page.mouse.move(cha.x + 50, cha.y + cha.height / 2, { steps: 10 });
  sel = await selectedBlocks(page);
  await shot(page, 'marquee');
  await page.mouse.up();
  check('marquee selects blocks it crosses', sel.length >= 2, sel.length);
  await page.keyboard.press('Escape');

  // typing undo groups: one ⌘Z removes the last typing burst
  await appendBlock(page);
  await type(page, 'hello world', 10);
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(200);
  const rt = await richText(page);
  check('⌘Z after a typing burst removes it', !rt || rt.length === 0 || (rt.map((d) => d[0]).join('') === ''), rt);
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.waitForTimeout(200);
  const rt2 = await richText(page);
  check('⌘⇧Z brings it back', (rt2 ?? []).map((d) => d[0]).join('') === 'hello world', rt2);
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(page, 'selection-error');
} finally {
  await browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

// Slash menu keywords & actions, block menu search, right-click menus.
// Run: NC_BASE=http://127.0.0.1:5461 node e2e/editor-slash-extra.mjs
import { start, newPage, tree, shot, type, check, failed, MOD, appendBlock } from './editor-lib.mjs';

const { browser, page } = await start();
const wait = (ms) => page.waitForTimeout(ms);
const rows = () => page.evaluate(() => Array.from(document.querySelectorAll('.nc-slash-menu [role="option"]')).map((el) => ({
  t: el.querySelector('.nc-slash-label .t')?.textContent ?? el.textContent,
  d: Array.from(el.querySelectorAll('.nc-slash-label .d')).map((x) => x.textContent).join(''),
})));
const blockOf = (text) => page.evaluate((x) => {
  const { records } = window.__ncEditor;
  const pageId = document.querySelector('.nc-page-title[data-block-id]')?.getAttribute('data-block-id');
  const walk = (id) => {
    const b = records.get('block', id);
    if (!b || b.alive === false) return null;
    if ((b.properties?.title ?? []).map((d) => d[0]).join('') === x) return b;
    for (const c of b.content ?? []) { const r = walk(c); if (r) return r; }
    return null;
  };
  return walk(pageId);
}, text);
async function slash(q) {
  await type(page, '/' + q, 12);
  await wait(350);
}
async function esc() {
  await page.keyboard.press('Escape');
  await wait(120);
}
async function clearLine() {
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press('Backspace');
  await wait(80);
}

try {
  await newPage(page, 'Slash extra');

  // ---- keyword search (search keywords + aliases)
  await slash('toc');
  let r = await rows();
  check('/toc → Contents list first', r[0]?.t === 'Contents list', r.slice(0, 3));
  await page.keyboard.press('Enter');
  await wait(400);
  let t = await tree(page);
  check('/toc inserts a table of contents block', t.some((b) => b.t === 'table_of_contents'), t.map((b) => b.t));

  await appendBlock(page);
  await slash('col2');
  r = await rows();
  check('/col2 → 2 columns first', r[0]?.t === '2 columns', r.slice(0, 3));
  await esc();
  await clearLine();
  await slash('col3');
  r = await rows();
  check('/col3 → 3 columns', r[0]?.t === '3 columns', r.slice(0, 3));
  await page.keyboard.press('Enter');
  await wait(400);
  t = await tree(page);
  const cl = t.find((b) => b.t === 'column_list');
  check('/col3 creates a 3-column list', cl?.k?.length === 3, cl);

  await appendBlock(page);
  await type(page, 'Turn me');
  await slash('turn');
  r = await rows();
  check('/turn lists the Turn into targets', r.length >= 10 && r.every((x) => x.d.includes('Turn into')), r.slice(0, 4));
  await esc();
  // the "/turn" text stays after Esc; remove it
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');
  await slash('turnbullet');
  r = await rows();
  check('/turnbullet → Bulleted list · Turn into', r[0]?.t === 'Bulleted list' && r[0]?.d.includes('Turn into'), r.slice(0, 3));
  await page.keyboard.press('Enter');
  await wait(300);
  let b = await blockOf('Turn me');
  check('/turnbullet converts the block (text kept)', b?.type === 'bulleted_list', b?.type);
  await page.keyboard.press('End');
  await slash('turncallout');
  r = await rows();
  check('/turncallout → Callout · Turn into', r[0]?.t === 'Callout' && r[0]?.d.includes('Turn into'), r.slice(0, 3));
  await esc();
  for (let i = 0; i < 12; i++) await page.keyboard.press('Backspace');
  await slash('turnintotoggleh1');
  r = await rows();
  check('/turnintotoggleh1 → Toggle heading 1 · Turn into', r[0]?.t === 'Toggle heading 1' && r[0]?.d.includes('Turn into'), r.slice(0, 3));
  await esc();
  for (let i = 0; i < 17; i++) await page.keyboard.press('Backspace');

  await appendBlock(page);
  await type(page, 'Colored line');
  await slash('color');
  r = await rows();
  check('/color lists text and background colors', r.some((x) => x.t === 'Red text') && r.some((x) => x.t === 'Blue background') && r.length >= 20, r.length);
  await esc();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
  await slash('red');
  r = await rows();
  check('/red → Red text, Red background', r[0]?.t === 'Red text' && r.some((x) => x.t === 'Red background'), r.slice(0, 3));
  await page.keyboard.press('Enter');
  await wait(300);
  b = await blockOf('Colored line');
  check('/red sets the block color', b?.format?.block_color === 'red', b?.format);
  await slash('grey');
  r = await rows();
  check('/grey → Gray text', r.some((x) => x.t === 'Gray text'), r.slice(0, 3));
  await esc();
  for (let i = 0; i < 5; i++) await page.keyboard.press('Backspace');

  await slash('moveto');
  r = await rows();
  check('/moveto → Move to', r[0]?.t === 'Move to', r.slice(0, 3));
  await esc();
  for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace');

  // ---- actions
  await slash('');
  const all = await rows();
  check('unfiltered menu hides Comment (search only)', !all.some((x) => x.t === 'Comment'));
  await esc();
  await page.keyboard.press('Backspace');
  await slash('comment');
  r = await rows();
  check('/comment → Comment action', r[0]?.t === 'Comment', r.slice(0, 3));
  await page.keyboard.press('Enter');
  await wait(500);
  check('/comment opens the comment composer', (await page.locator('.nc-discussion-popover.composer, .nc-comment-composer').count()) > 0);
  await esc();
  await esc();

  await appendBlock(page);
  await type(page, 'Dup me');
  await slash('duplicate');
  await page.keyboard.press('Enter');
  await wait(400);
  t = await tree(page);
  check('/duplicate duplicates the block', t.filter((x) => x.x === 'Dup me').length === 2, t.map((x) => x.x));
  await esc();
  await appendBlock(page);
  await type(page, 'Delete me');
  await slash('delete');
  await page.keyboard.press('Enter');
  await wait(400);
  t = await tree(page);
  check('/delete deletes the block', !t.some((x) => x.x === 'Delete me'), t.map((x) => x.x));

  // ---- import + synced databases + present
  await appendBlock(page);
  await slash('import');
  r = await rows();
  check('/import lists import sources', ['CSV', 'Plain text and Markdown', 'ZIP', 'PDF'].every((n) => r.some((x) => x.t === n)), r.map((x) => x.t));
  await esc();
  for (let i = 0; i < 7; i++) await page.keyboard.press('Backspace');
  await slash('zip');
  r = await rows();
  check('/zip → ZIP import', r.some((x) => x.t === 'ZIP'), r.slice(0, 3));
  await esc();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await slash('csv');
  r = await rows();
  const csvIdx = r.findIndex((x) => x.t === 'CSV');
  check('/csv → CSV import', csvIdx >= 0, r.slice(0, 3));
  for (let i = 0; i < csvIdx; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await wait(600);
  check('/csv opens the Import dialog', (await page.locator('.nc-import-modal').count()) > 0);
  await shot(page, 'slash-import-modal');
  await esc();
  await wait(200);
  if (await page.locator('.nc-import-modal').count()) await page.locator('.nc-import-modal-close').click();

  await appendBlock(page);
  await slash('asana');
  r = await rows();
  check('/asana → Asana (Embeds / Synced Databases / Import)', r.filter((x) => x.t === 'Asana').length >= 2, r.slice(0, 4));
  await esc();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Backspace');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nc:toast', { detail: 'Toast via event' })));
  await wait(200);
  check('nc:toast event shows a toast', (await page.locator('.nc-toast', { hasText: 'Toast via event' }).count()) === 1);

  await appendBlock(page);
  await type(page, 'Slide body');
  // headless Chrome enters and immediately leaves fullscreen, which ends the presentation: present without it
  await page.evaluate(() => { Element.prototype.requestFullscreen = undefined; });
  await slash('present');
  r = await rows();
  check('/present → Start presenting here (Beta, ⌘⌥P)', r[0]?.t === 'Start presenting here', r.slice(0, 3));
  await page.keyboard.press('Enter');
  await wait(600);
  check('Start presenting here opens presentation mode', (await page.locator('.nc-present').count()) === 1);
  await shot(page, 'slash-present');
  await page.keyboard.press('Escape');
  await wait(400);
  if (await page.locator('.nc-present').count()) await page.locator('[aria-label="Exit presentation"]').click();
  await wait(300);

  // ---- recently used ("Suggested")
  await appendBlock(page);
  await slash('');
  const sug = await page.evaluate(() => {
    const sec = Array.from(document.querySelectorAll('.nc-slash-menu .nc-menu-section')).find((s) => s.querySelector('.nc-menu-section-title')?.textContent?.trim() === 'Suggested');
    return Array.from(sec?.querySelectorAll('[role="option"] .nc-slash-label .t') ?? []).map((x) => x.textContent);
  });
  check('Suggested section shows recently used items (most recent first)', sug[0] === 'Start presenting here' && sug.includes('Red text') && sug.length === 5, sug);
  await esc();
  await page.keyboard.press('Backspace');

  // ---- block menu search: Turn into targets + colors
  await type(page, 'Menu target');
  await page.keyboard.press(`${MOD}+/`);
  await wait(400);
  await type(page, 'head', 20);
  await wait(250);
  const menuRows = () => page.evaluate(() => Array.from(document.querySelectorAll('.lit-overlay-container [role="option"]')).map((el) => el.textContent?.trim()));
  let mr = await menuRows();
  check('block menu search finds Turn into targets', mr.some((x) => x?.startsWith('Heading 2')), mr.slice(0, 6));
  for (let i = 0; i < 4; i++) await page.keyboard.press('Backspace');
  await type(page, 'blue', 20);
  await wait(250);
  mr = await menuRows();
  check('block menu search finds colors', mr.some((x) => x?.includes('Blue background')), mr.slice(0, 6));
  const idx = mr.findIndex((x) => x?.includes('Blue background'));
  for (let i = 0; i < idx; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await wait(300);
  b = await blockOf('Menu target');
  check('choosing a searched color applies it', b?.format?.block_color === 'blue_background', b?.format);

  // ---- right-click: word → text action menu; empty block area → native; divider → block menu
  const leaf = page.locator('[data-content-editable-leaf]', { hasText: 'Menu target' }).first();
  const box = await leaf.boundingBox();
  await page.mouse.click(box.x + 8, box.y + box.height / 2, { button: 'right' });
  await wait(400);
  const sel = await page.evaluate(() => getSelection()?.toString());
  check('right-click on a word selects it', sel === 'Menu', sel);
  check('right-click on text shows the text action menu', (await page.locator('.lit-text-action-menu').count()) === 1);
  await shot(page, 'right-click-text');
  await page.keyboard.press('Escape');
  await wait(200);
  await page.mouse.click(box.x + box.width - 20, box.y + box.height / 2, { button: 'right' });
  await wait(300);
  check('right-click on empty block area opens no Litpage menu', (await page.locator('.lit-text-action-menu').count()) === 0 && (await page.locator('.lit-overlay-container [role="listbox"]').count()) === 0);
  await page.keyboard.press('Escape');
  await appendBlock(page);
  await type(page, '---');
  await wait(400);
  const div = page.locator('.lit-divider-block').first();
  const db = await div.boundingBox();
  await page.mouse.click(db.x + 100, db.y + db.height / 2, { button: 'right' });
  await wait(400);
  mr = await menuRows();
  check('right-click on a divider opens the block menu at the pointer', mr.some((x) => x?.startsWith('Duplicate')) && mr.some((x) => x?.startsWith('Delete')), mr.slice(0, 6));
  await esc();

  // multi-selection counts footer: Esc selects the block, Shift+↑ extends the block selection
  await page.locator('[data-content-editable-leaf]', { hasText: 'Slide body' }).first().click();
  await wait(150);
  await page.keyboard.press('Escape');
  await wait(150);
  await page.keyboard.press('Shift+ArrowUp');
  await wait(150);
  await page.keyboard.press(`${MOD}+/`);
  await wait(400);
  const footer = await page.locator('.nc-block-menu-footer .count').first().textContent().catch(() => '');
  check('multi-block menu shows word/character counts', /\d+ words, \d+ characters/.test(footer ?? ''), footer);
  await shot(page, 'block-menu-multi');
  await esc();
} catch (e) {
  check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);

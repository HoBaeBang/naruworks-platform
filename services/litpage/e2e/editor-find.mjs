// ⌘F find in page: the floating find bar, matches inside
// collapsed toggles (auto-expand) and inline database rows, counter, Enter / ⇧Enter / buttons, replace + replace all,
// undo, Esc, auto-close on typing. Run: NC_BASE=http://127.0.0.1:5461 node e2e/editor-find.mjs
import { start, newPage, shot, type, check, failed, MOD } from './editor-lib.mjs';

const { browser, page } = await start();
const wait = (ms) => page.waitForTimeout(ms);
const counter = () => page.locator('.nc-find-count').textContent().catch(() => null);
const highlightSizes = () => page.evaluate(() => ({ all: CSS.highlights.get('nc-find')?.size ?? 0, cur: CSS.highlights.get('nc-find-current')?.size ?? 0 }));
const titles = () => page.evaluate(() => {
  const { records } = window.__ncEditor;
  return records.all('block').filter((b) => b.alive !== false).map((b) => (b.properties?.title ?? []).map((d) => d[0]).join('')).filter(Boolean);
});

try {
  const pageId = await newPage(page, 'Find test');
  await type(page, 'Alpha para one');
  await page.keyboard.press('Enter');
  await type(page, 'Para two end');
  await page.keyboard.press('Enter');
  await type(page, '> Toggle head');
  await page.keyboard.press('Enter');
  await type(page, 'hidden para inside');
  await wait(300);
  // collapse the toggle and add an inline database with a row "para row"
  await page.evaluate(async (pid) => {
    const { records } = window.__ncEditor;
    const cmds = await import('/src/features/editor/commands.ts');
    const tog = records.get('block', pid).content.map((id) => records.get('block', id)).find((b) => b.type === 'toggle');
    cmds.setOpen(tog.id, false);
    const blocks = await import('/src/lib/blocks.ts');
    const db = await import('/src/features/database/createDatabase.ts');
    const page = records.get('block', pid);
    let res;
    blocks.run('test.db', (tx) => { res = db.createDatabaseIn(tx, { parentId: pid, parentTable: 'block', after: page.content[page.content.length - 1], inline: true, viewType: 'table' }); });
    blocks.run('test.row', (tx) => { blocks.createBlockIn(tx, { type: 'page', parentId: res.collectionId, parentTable: 'collection', list: null, title: [['para row']] }); });
  }, pageId);
  await wait(800);
  check('toggle child is hidden before searching', (await page.locator('[data-content-editable-leaf]', { hasText: 'hidden para inside' }).count()) === 0);

  // ---- open
  await page.locator('[data-content-editable-leaf]', { hasText: 'Alpha para one' }).first().click();
  await page.keyboard.press(`${MOD}+f`);
  await wait(300);
  const bar = page.locator('.nc-find-bar');
  check('⌘F opens the find bar', (await bar.count()) === 1);
  const bb = await bar.boundingBox();
  check('bar geometry matches Litpage (280 wide, top 60, right edge 16px from the frame)', bb && Math.abs(bb.width - 280) < 1 && Math.abs(bb.y - 60) < 1.5 && Math.abs(bb.x + bb.width - 1368) < 1.5, bb);
  check('placeholder "Find or replace text…"', (await page.locator('.nc-find-bar input').first().getAttribute('placeholder')) === 'Find or replace text…');
  check('input focused', await page.evaluate(() => document.activeElement?.closest('.nc-find-bar') !== null));
  const labels = await page.locator('.nc-find-bar [role="button"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check('buttons Previous match / Next match / Replace / Close', ['Previous match', 'Next match', 'Replace', 'Close'].every((l) => labels.includes(l)), labels);

  await type(page, 'para', 25);
  await wait(400);
  check('counter "1 of 4" (text, collapsed toggle, inline database)', (await counter())?.replace(/\s+/g, ' ').trim() === '1of4' || (await counter())?.includes('1of4'), await counter());
  let hs = await highlightSizes();
  check('matches highlighted (current + visible others)', hs.cur === 1 && hs.all === 2, hs);
  await shot(page, 'find-typed');

  await page.keyboard.press('Enter');
  await wait(300);
  check('Enter → next match (2 of 4)', (await counter())?.includes('2of4'), await counter());
  await page.keyboard.press('Enter');
  await wait(500);
  check('Enter → match inside the collapsed toggle (3 of 4)', (await counter())?.includes('3of4'), await counter());
  check('the collapsed toggle opens to reveal it', (await page.locator('[data-content-editable-leaf]', { hasText: 'hidden para inside' }).count()) === 1);
  hs = await highlightSizes();
  check('current highlight follows, others highlighted', hs.cur === 1 && hs.all === 3, hs);
  await page.keyboard.press('Shift+Enter');
  await wait(200);
  check('⇧Enter → previous match (2 of 4)', (await counter())?.includes('2of4'), await counter());
  await page.locator('.nc-find-bar [aria-label="Next match"]').click();
  await page.locator('.nc-find-bar [aria-label="Next match"]').click();
  await wait(300);
  check('↓ button reaches the database row (4 of 4)', (await counter())?.includes('4of4'), await counter());
  await page.locator('.nc-find-bar [aria-label="Next match"]').click();
  await wait(200);
  check('↓ wraps around (1 of 4)', (await counter())?.includes('1of4'), await counter());
  await page.locator('.nc-find-bar [aria-label="Previous match"]').click();
  await page.locator('.nc-find-bar [aria-label="Previous match"]').click();
  await page.locator('.nc-find-bar [aria-label="Previous match"]').click();
  await wait(200);
  check('↑ button (2 of 4)', (await counter())?.includes('2of4'), await counter());

  // ---- replace
  await page.locator('.nc-find-bar [aria-label="Replace"]').click();
  await wait(200);
  check('Replace toggle pressed + panel', (await page.locator('.nc-find-bar [aria-label="Replace"]').getAttribute('aria-pressed')) === 'true' && (await page.locator('.nc-find-bar input[placeholder="Replace with…"]').count()) === 1);
  await shot(page, 'find-replace');
  await page.locator('.nc-find-bar input[placeholder="Replace with…"]').fill('item');
  await page.locator('.nc-find-bar input[placeholder="Replace with…"]').press('Enter');
  await wait(400);
  let ts = await titles();
  check('Replace replaces the current match only', ts.includes('item two end') && ts.includes('Alpha para one'), ts);
  check('counter after replace (x of 3)', (await counter())?.includes('of3'), await counter());
  await page.locator('.nc-find-bar .nc-find-text-btn', { hasText: 'Replace all' }).click();
  await wait(500);
  ts = await titles();
  check('Replace all replaces every match', ts.includes('Alpha item one') && ts.includes('hidden item inside') && ts.includes('item row') && !ts.some((x) => /para/i.test(x)), ts);
  // the toast waits for the server to keep the change; allow a slow save
  check('toast "Replaced 3 matches"', await page.locator('.nc-toast', { hasText: 'Replaced 3 matches' }).first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  check('no matches → "Not found"', (await counter())?.includes('Not found'), await counter());

  // ---- Esc + undo
  await page.keyboard.press('Escape');
  await wait(200);
  check('Esc closes the bar', (await bar.count()) === 0);
  hs = await highlightSizes();
  check('highlights cleared', hs.all === 0 && hs.cur === 0, hs);
  await page.locator('[data-content-editable-leaf]', { hasText: 'Alpha item one' }).first().click();
  await page.keyboard.press(`${MOD}+z`);
  await wait(400);
  ts = await titles();
  check('⌘Z undoes Replace all in one step', ts.includes('Alpha para one') && ts.includes('para row') && ts.includes('hidden para inside'), ts);

  // ---- ⌘⌥F with replace, typing closes
  await page.keyboard.press(`${MOD}+Alt+f`);
  await wait(300);
  check('⌘⌥F opens with Replace', (await page.locator('.nc-find-bar input[placeholder="Replace with…"]').count()) === 1);
  await page.locator('[data-content-editable-leaf]', { hasText: 'Alpha para one' }).first().click();
  await type(page, 'x');
  await wait(200);
  check('typing in the page closes the bar', (await bar.count()) === 0);

  // ---- reload persists the undo result
  await page.reload();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await wait(800);
  ts = await titles();
  check('state persists after reload', ts.some((x) => x.startsWith('Alpha para one')) && ts.includes('para row'), ts);
} catch (e) {
  check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);

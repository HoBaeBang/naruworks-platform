// Mentions & inline atoms: "@" menu (date / remind / people / pages / new sub-page), date picker, page mention hover,
// "[[" page links, ":" emoji autocomplete, "/emoji" picker, inline equations ("/inline equation", ⌘⇧E), slash ghost.
import { start, newPage, shot, type, check, failed, richText, MOD, appendBlock } from './editor-lib.mjs';

const { browser, page } = await start();
const atoms = (rt) => (rt ?? []).filter((d) => d[0] === '‣' || d[0] === '⁍').map((d) => d[1][0]);
try {
  await newPage(page, 'Mentions');

  // "/" ghost "Search by typing"
  await type(page, '/');
  await page.waitForTimeout(250);
  const ghost = await page.locator('.nc-trigger-ghost').innerText().catch(() => '');
  check('"/" shows the "Search by typing" ghost', ghost === 'Search by typing', ghost);
  const box = await page.locator('.nc-trigger-box').count();
  check('trigger token box drawn', box >= 1, box);
  await shot(page, 'slash-ghost');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Backspace');

  // "@" menu
  await type(page, '@');
  await page.waitForTimeout(500);
  const sections = await page.locator('.lit-overlay-container .nc-menu-section-title').allInnerTexts();
  check('@ menu sections Date / People / Page link / New page', ['Date', 'People', 'New page'].every((s) => sections.includes(s)), sections);
  const atGhost = await page.locator('.nc-trigger-ghost').innerText().catch(() => '');
  check('@ ghost completes "Today"', atGhost === 'Today', atGhost);
  const remind = await page.locator('.lit-overlay-container .nc-menu-item').nth(1).innerText();
  check('Remind me — Tomorrow 9am', /Remind me/.test(remind) && /Tomorrow 9am/.test(remind), remind);
  await shot(page, 'mention-menu');
  await page.keyboard.press('Enter'); // Today
  await page.waitForTimeout(250);
  let rt = await richText(page);
  const d = atoms(rt)[0];
  check('date mention ["d",{type:"date",date_format:"relative"}] + trailing space', d?.[0] === 'd' && d[1].type === 'date' && d[1].date_format === 'relative' && rt[rt.length - 1][0] === ' ', rt);
  const dateText = await page.locator('.lit-date-mention-token').first().innerText();
  check('date mention renders "@Today"', dateText.replace(/\s/g, '') === '@Today', dateText);

  // date picker
  const dateBlock = await page.evaluate(() => window.__ncEditor.useEditor.getState().focused?.blockId);
  await page.click('.lit-date-mention-token');
  await page.waitForSelector('.nc-dp');
  const dp = await page.locator('.nc-dp').innerText();
  check('date picker: End date / Date format / Include time / Remind / Clear', ['End date', 'Date format', 'Include time', 'Remind', 'Clear'].every((x) => dp.includes(x)), dp.slice(-120));
  // the reminder help link is shown only when a help URL is configured (none by default)
  const dpHelp = await page.locator('.nc-dp .nc-dp-help').count();
  check('date picker hides the reminder help link without a help URL', dpHelp === 0, dpHelp);
  await shot(page, 'date-picker');
  await page.click('.nc-dp-row:has-text("Date format")');
  await page.waitForTimeout(200);
  await page.click('.lit-overlay-container .nc-menu-item:has-text("Full date")');
  await page.waitForTimeout(200);
  rt = await richText(page, dateBlock);
  check('Date format → Full date stored', atoms(rt)[0]?.[1]?.date_format === 'full', atoms(rt)[0]);
  await page.click('.nc-dp-row:has-text("Include time")');
  await page.waitForTimeout(150);
  rt = await richText(page, dateBlock);
  await shot(page, 'date-picker-time');
  check('Include time → datetime + start_time', atoms(rt)[0]?.[1]?.type === 'datetime' && !!atoms(rt)[0]?.[1]?.start_time, atoms(rt)[0]);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // remind me via query
  await page.locator('.lit-page-content [data-content-editable-leaf]').first().click();
  await page.keyboard.press(`${MOD === 'Meta' ? 'Meta' : 'Control'}+ArrowRight`);
  await type(page, ' @tomorrow 3pm');
  await page.waitForTimeout(400);
  const first = await page.locator('.lit-overlay-container .nc-menu-item').first().innerText();
  check('natural date "tomorrow 3pm" parsed', /Tomorrow/.test(first) && /3:00 PM/.test(first), first);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('datetime mention inserted', atoms(rt).some((a) => a[0] === 'd' && a[1].start_time === '15:00'), atoms(rt));

  // new sub-page from @
  await appendBlock(page);
  await type(page, '@ED Mention Target');
  await page.waitForTimeout(600);
  const newItem = page.locator('.lit-overlay-container .nc-menu-item:has-text("sub-page")').first();
  const newLabel = await newItem.innerText();
  check('New “q” sub-page item', /New “ED Mention Target” sub-page/.test(newLabel), newLabel);
  await newItem.click();
  await page.waitForTimeout(400);
  rt = await richText(page);
  const p = atoms(rt).find((a) => a[0] === 'p');
  check('page mention ["p", id]', !!p && p.length === 2, atoms(rt));
  const parentOk = await page.evaluate((pid) => {
    const { records, useEditor } = window.__ncEditor;
    const pg = records.get('block', pid);
    const host = useEditor.getState().focused?.blockId;
    const hostBlock = records.get('block', host);
    return { parent: pg?.parent_id === host, inContent: (hostBlock?.content ?? []).includes(pid), title: pg?.properties?.title };
  }, p?.[1]);
  check('sub-page parent = text block, not listed in content', parentOk.parent && !parentOk.inContent, parentOk);
  const mention = await page.locator('.lit-page-mention-token').first().innerText();
  check('page mention renders icon + title', /ED Mention Target/.test(mention), mention);
  await shot(page, 'page-mention');
  await page.mouse.move(5, 5);
  await page.hover('.lit-page-mention-token');
  await page.waitForSelector('.nc-page-hover-card', { timeout: 2500 }).catch(() => {});
  const card = await page.locator('.nc-page-hover-card').innerText().catch(() => '');
  check('page mention hover card', /ED Mention Target/.test(card), card);
  await shot(page, 'page-mention-hover');
  await page.mouse.move(5, 5);

  // emoji ":" autocomplete
  await page.locator('.lit-page-content [data-content-editable-leaf]').last().click();
  await page.keyboard.press(`${MOD === 'Meta' ? 'Meta' : 'Control'}+ArrowRight`);
  await type(page, ' :smi');
  await page.waitForTimeout(300);
  const cells = await page.locator('.nc-em-menu .nc-em-cell').count();
  check(': autocomplete grid (≤35 cells, 12 cols)', cells > 0 && cells <= 35, cells);
  await shot(page, 'emoji-colon');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  rt = await richText(page);
  const txt = (rt ?? []).map((x) => x[0]).join('');
  check('Enter inserts emoji as plain text (no ":smi" left)', !txt.includes(':smi') && /\p{Extended_Pictographic}/u.test(txt), txt);
  const subpageAlive = await page.evaluate((pid) => window.__ncEditor.records.get('block', pid)?.alive, p?.[1]);
  check('emoji insert keeps the sub-page alive (Litpage bug not reproduced)', subpageAlive === true, subpageAlive);

  // "/emoji" full picker
  await appendBlock(page);
  await type(page, '/emoji');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nc-em-menu.full');
  const bar = await page.locator('.nc-em-bar .nc-em-bar-btn').count();
  check('/emoji opens full picker with 11 category buttons', bar === 11, bar);
  const firstSection = await page.locator('.nc-em-section-title').first().innerText();
  check('picker starts with Recent', firstSection === 'Recent', firstSection);
  await shot(page, 'emoji-picker');
  await page.locator('.nc-em-menu.full .nc-em-cell').nth(3).click();
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('picked emoji replaces ":"', !(rt ?? []).map((x) => x[0]).join('').includes(':') && (rt ?? []).length > 0, rt);

  // "[[" link to page
  await appendBlock(page);
  await type(page, 'Link: [[');
  await page.waitForTimeout(500);
  const lsec = await page.locator('.lit-overlay-container .nc-menu-section-title').allInnerTexts();
  check('[[ menu: Page link + Add a child page', lsec.includes('Page link') && (await page.locator('.lit-overlay-container').innerText()).includes('Add a child page'), lsec);
  await shot(page, 'brackets');
  await type(page, 'ED Mention');
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  rt = await richText(page);
  const link = atoms(rt).find((a) => a[0] === 'p');
  check('[[ inserts page link ["p", id, spaceId]', !!link && link.length === 3, atoms(rt));
  const arrow = await page.locator('.lit-page-link-token').count();
  check('page link renders with link arrow', arrow >= 1, arrow);
  await shot(page, 'brackets-select');

  // "/inline equation"
  await appendBlock(page);
  await type(page, 'Eq: /inline eq');
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nc-equation-editor');
  const ph = await page.locator('.nc-equation-input').getAttribute('data-placeholder');
  check('equation editor placeholder "E = mc^2"', ph === 'E = mc^2', ph);
  await type(page, 'x^2 + y^2 = z^2');
  await page.waitForTimeout(200);
  const live = await page.locator('.lit-text-equation-token .katex').count();
  check('live KaTeX preview while typing', live >= 1, live);
  await shot(page, 'inline-equation-typing');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  rt = await richText(page);
  check('inline equation committed ["e", tex]', atoms(rt).some((a) => a[0] === 'e' && a[1] === 'x^2 + y^2 = z^2'), atoms(rt));
  // click → editor reopens
  await page.click('.lit-text-equation-token');
  await page.waitForSelector('.nc-equation-editor');
  const again = await page.locator('.nc-equation-input').innerText();
  check('click on equation reopens editor', again === 'x^2 + y^2 = z^2', again);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);

  // ⌘⇧E with a collapsed caret → empty equation pill + editor; Esc removes it
  await page.locator('.lit-page-content [data-content-editable-leaf]').last().click();
  await page.keyboard.press(`${MOD}+Shift+e`);
  await page.waitForSelector('.nc-equation-editor');
  const pill = await page.locator('.lit-text-equation-token.empty').innerText().catch(() => '');
  check('empty equation shows "New equation" pill', /New equation/.test(pill), pill);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('Esc on a new empty equation removes it', atoms(rt).filter((a) => a[0] === 'e').length === 1, atoms(rt));
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(page, 'mentions-error');
} finally {
  await browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

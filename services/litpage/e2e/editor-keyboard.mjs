// Keyboard & markdown behaviors of the editor.
// Run: node e2e/editor-keyboard.mjs (dev server on :5173)
import { start, newPage, tree, shot, type, check, failed, focusedBlock, selectedBlocks, richText, MOD, lineStart, lineEnd, appendBlock } from './editor-lib.mjs';

const { browser, page } = await start();
const flat = (t) => t.map((b) => `${b.t}:${b.x}`);
try {
  await newPage(page, 'Keyboard');

  // --- block markdown ----------------------------------------------------------------------
  for (const [md, type_] of [['# ', 'header'], ['## ', 'sub_header'], ['### ', 'sub_sub_header'], ['#### ', 'header_4']]) {
    await type(page, `${md}H ${type_}`);
    await page.keyboard.press('Enter');
  }
  let t = await tree(page);
  check('md headings # ## ### ####', t.slice(0, 4).map((b) => b.t).join() === 'header,sub_header,sub_sub_header,header_4', flat(t));
  check('Enter at end of heading → text', t[4]?.t === 'text', flat(t));

  await type(page, '- B1');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await type(page, 'B2');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await type(page, 'B3');
  await page.keyboard.press('Enter');
  t = await tree(page);
  const b1 = t.find((b) => b.x === 'B1');
  check('"- " bulleted + Enter continues list', b1?.t === 'bulleted_list' && t.some((b) => b.x === 'B3' && b.t === 'bulleted_list'), flat(t));
  check('Tab nests under previous item', b1?.k?.[0]?.x === 'B2', b1);
  await page.keyboard.press('Enter'); // empty item → text
  t = await tree(page);
  check('Enter on empty list item → text', t[t.length - 1].t === 'text' && t[t.length - 1].x === '', flat(t));

  await type(page, '* star');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type(page, '+ plus');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  t = await tree(page);
  check('"* " and "+ " → bulleted', t.some((b) => b.x === 'star' && b.t === 'bulleted_list') && t.some((b) => b.x === 'plus' && b.t === 'bulleted_list'), flat(t));

  await type(page, '1. N1');
  await page.keyboard.press('Enter');
  await type(page, 'N2');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type(page, '[] Task A');
  await page.keyboard.press(`${MOD}+Enter`);
  await page.keyboard.press('Enter');
  await type(page, 'Task B');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  t = await tree(page);
  check('"1. " numbered list', t.filter((b) => b.t === 'numbered_list').length === 2, flat(t));
  const ta = t.find((b) => b.x === 'Task A');
  const tb = t.find((b) => b.x === 'Task B');
  check('"[] " to-do + ⌘Enter checks', ta?.t === 'to_do' && ta.checked === true, ta);
  check('Enter after checked to-do → unchecked to-do', tb?.t === 'to_do' && tb.checked === false, tb);

  await type(page, '> Toggle T');
  t = await tree(page);
  const toggleOpen = await page.evaluate(() => {
    const ids = Object.keys(localStorage).filter((k) => k.startsWith('nc:toggle:'));
    return ids.length > 0;
  });
  check('"> " → toggle created open', t[t.length - 1].t === 'toggle' && toggleOpen, flat(t));
  await page.keyboard.press('Enter');
  await type(page, 'inside');
  t = await tree(page);
  const tog = t.find((b) => b.x === 'Toggle T');
  check('Enter at end of OPEN toggle → child', tog?.k?.[0]?.x === 'inside', tog);
  await appendBlock(page);
  t = await tree(page);

  // quote
  await type(page, '" Quoted');
  await page.keyboard.press('Enter');
  await type(page, 'after quote');
  t = await tree(page);
  const qi = t.findIndex((b) => b.x === 'Quoted');
  check('"\\" " → quote, Enter → top-level text', t[qi]?.t === 'quote' && t[qi + 1]?.t === 'text' && t[qi + 1]?.x === 'after quote', flat(t));

  // --- instant shortcuts -------------------------------------------------------------------
  await page.keyboard.press('Enter');
  await type(page, '---');
  await page.waitForTimeout(150);
  t = await tree(page);
  const fb = await focusedBlock(page);
  check('"---" → divider + new focused text block', t.some((b) => b.t === 'divider') && fb?.t === 'text', { t: flat(t), fb });
  await type(page, '```');
  await page.waitForTimeout(150);
  const fb2 = await focusedBlock(page);
  check('"```" → code block with caret inside', fb2?.t === 'code', fb2);
  await type(page, 'x = 1');
  await page.keyboard.press('Enter');
  await type(page, 'y = 2');
  await page.keyboard.press(`${MOD}+Enter`); // no effect in code
  await page.keyboard.press('Tab');
  const code = await richText(page);
  check('code: Enter = newline, Tab = \\t, ⌘Enter = nothing', JSON.stringify(code) === JSON.stringify([['x = 1\ny = 2\t']]), code);
  // leave code block with ArrowDown → nothing below, so click below the content
  await appendBlock(page);

  // --- inline markdown + autoreplace --------------------------------------------------------
  await type(page, 'A **bold** *ital* _und_ ~strk~ `cod` ~~dbl~~ ');
  const inl = await richText(page);
  const marks = (inl ?? []).filter((d) => d[1]).map((d) => `${d[0]}[${d[1].map((a) => a[0]).join('')}]`);
  check('inline md: **b** *i* _i_ ~s~ `c`', JSON.stringify(marks) === JSON.stringify(['bold[b]', 'ital[i]', 'und[i]', 'strk[s]', 'cod[c]']), marks);
  check('~~x~~ stays literal', (inl ?? []).map((d) => d[0]).join('').includes('~~dbl~~'), inl);
  await page.keyboard.press('Enter');
  await type(page, 'B -> x <- y => z <=> w --- v -- u (c) (r) (tm) 1/2 ... != >= <= ');
  const ar = (await richText(page)).map((d) => d[0]).join('');
  check('autoreplace set', ar === 'B → x ← y ⇒ z ≤> w —- v — u (c) (r) (tm) 1/2 … ≠ ≥ ≤ ', ar);
  await page.keyboard.press('Enter');
  await type(page, 'C $E=mc^2$ D $$a^2$$');
  const eq = await richText(page);
  check('$$tex$$ → inline equation, $x$ literal', JSON.stringify(eq).includes('["e","a^2"]') && JSON.stringify(eq).includes('$E=mc^2$'), eq);
  await lineEnd(page);
  await page.keyboard.press('Enter');

  // --- headings: md on non-empty block, split, backspace merge ----------------------------
  await type(page, 'MD H3');
  await lineStart(page);
  await type(page, '### ');
  let fbH = await focusedBlock(page);
  check('"### " at start of NON-empty block converts (text kept)', fbH?.t === 'sub_sub_header', fbH);
  await lineEnd(page);
  await page.keyboard.press('Enter');
  await type(page, '#### MD H4');
  await lineStart(page);
  await page.keyboard.press('Backspace');
  t = await tree(page);
  check('Backspace at start of heading merges into previous block', t.some((b) => b.t === 'sub_sub_header' && b.x === 'MD H3MD H4'), flat(t));
  // split in the middle of a heading: first part heading, second text
  await page.keyboard.press('Enter');
  t = await tree(page);
  const hi = t.findIndex((b) => b.x === 'MD H3');
  check('Enter in middle of heading → heading + text', t[hi]?.t === 'sub_sub_header' && t[hi + 1]?.t === 'text' && t[hi + 1].x === 'MD H4', flat(t));
  await lineEnd(page);

  // bullet Backspace → text
  await page.keyboard.press('Enter');
  await type(page, '- item');
  await lineStart(page);
  await page.keyboard.press('Backspace');
  fbH = await focusedBlock(page);
  check('Backspace at start of bullet → text', fbH?.t === 'text', fbH);

  // --- soft line break ----------------------------------------------------------------------
  await lineEnd(page);
  await page.keyboard.press('Shift+Enter');
  await type(page, 'soft');
  const soft = (await richText(page)).map((d) => d[0]).join('');
  check('Shift+Enter → "\\n" in the same block', soft === 'item\nsoft', soft);

  // --- turn into shortcuts ----------------------------------------------------------------------
  const seq = [['1', 'header'], ['2', 'sub_header'], ['3', 'sub_sub_header'], ['4', 'to_do'], ['5', 'bulleted_list'], ['6', 'numbered_list'], ['7', 'toggle'], ['8', 'code'], ['0', 'text']];
  let okTurn = true;
  for (const [k, ty] of seq) {
    await page.keyboard.press(`${MOD}+Alt+Digit${k}`);
    await page.waitForFunction(() => document.activeElement?.hasAttribute('data-content-editable-leaf'), null, { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(120);
    const f = await focusedBlock(page);
    if (f?.t !== ty) {
      okTurn = false;
      console.log('  turn-into', k, '→', f?.t);
    }
  }
  check('⌘⌥0-8 turn into', okTurn);
  await page.keyboard.press(`${MOD}+Alt+Digit9`);
  await page.waitForTimeout(150);
  t = await tree(page);
  check('⌘⌥9 → page block in place', t.some((b) => b.t === 'page'), flat(t));
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(200);
  t = await tree(page);
  check('⌘Z undoes turn into page', !t.some((b) => b.t === 'page'), flat(t));
  await page.keyboard.press(`${MOD}+Shift+z`);
  await page.waitForTimeout(200);
  t = await tree(page);
  check('⌘⇧Z redoes it', t.some((b) => b.t === 'page'), flat(t));
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(200);

  // --- duplicate / move / select --------------------------------------------------------------
  await appendBlock(page);
  await type(page, 'Row one');
  await page.keyboard.press('Enter');
  await type(page, 'Row two');
  await page.keyboard.press('Enter');
  await type(page, 'Row three');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press(`${MOD}+d`);
  await page.waitForTimeout(150);
  let selb = await selectedBlocks(page);
  t = await tree(page);
  check('⌘D duplicates below and selects the duplicate', t.filter((b) => b.x === 'Row two').length === 2 && selb.length === 1, { sel: selb.length, t: flat(t).slice(-5) });
  await page.keyboard.press('Escape');
  // move
  const leaves = page.locator('.lit-page-content [data-content-editable-leaf]');
  await leaves.last().click();
  await page.keyboard.press(`${MOD}+Shift+ArrowUp`);
  await page.waitForTimeout(150);
  t = await tree(page);
  const rows = t.filter((b) => b.x.startsWith('Row')).map((b) => b.x);
  check('⌘⇧↑ moves the block up', rows.join('|') === 'Row one|Row two|Row three|Row two', rows);
  await page.keyboard.press(`${MOD}+Shift+ArrowDown`);
  await page.waitForTimeout(150);

  // Esc / Shift+arrows / ⌘A twice
  await page.keyboard.press('Escape');
  selb = await selectedBlocks(page);
  check('Esc selects the current block', selb.length === 1, selb);
  await page.keyboard.press('Shift+ArrowUp');
  await page.keyboard.press('Shift+ArrowUp');
  selb = await selectedBlocks(page);
  check('Shift+↑ extends block selection', selb.length === 3, selb.length);
  await page.keyboard.press('Shift+ArrowDown');
  selb = await selectedBlocks(page);
  check('Shift+↓ shrinks it', selb.length === 2, selb.length);
  await shot(page, 'kb-multi-select');
  await page.keyboard.press('Escape');
  selb = await selectedBlocks(page);
  check('Esc clears block selection', selb.length === 0, selb.length);
  await leaves.last().click();
  await page.keyboard.press(`${MOD}+a`);
  const domSel = await page.evaluate(() => window.getSelection()?.toString());
  check('⌘A once selects the block text', domSel === 'Row three', domSel);
  await page.keyboard.press(`${MOD}+a`);
  selb = await selectedBlocks(page);
  const topCount = (await tree(page)).length;
  check('⌘A twice selects every block', selb.length === topCount, { selb: selb.length, topCount });
  await shot(page, 'kb-cmd-a-twice');
  await page.keyboard.press('Escape');

  // Tab on text → child of previous text block; Shift+Tab out
  await leaves.last().click();
  await page.keyboard.press('Tab');
  t = await tree(page);
  const parentRow = t.filter((b) => b.x.startsWith('Row')).find((b) => b.k?.some((k) => k.x === 'Row three'));
  check('Tab on text → child of previous text block', !!parentRow, flat(t).slice(-4));
  await page.keyboard.press('Shift+Tab');
  t = await tree(page);
  check('Shift+Tab outdents', !t.some((b) => b.x.startsWith('Row') && b.k?.length), flat(t).slice(-4));

  // ⌘/ opens block menu
  await page.keyboard.press(`${MOD}+/`);
  await page.waitForTimeout(250);
  const menuText = await page.locator('.lit-overlay-container').innerText().catch(() => '');
  check('⌘/ opens the block action menu', /Turn into/.test(menuText) && /Duplicate/.test(menuText), menuText.slice(0, 120));
  await page.keyboard.press('Escape');
  await shot(page, 'kb-final');
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(page, 'kb-error');
} finally {
  await browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

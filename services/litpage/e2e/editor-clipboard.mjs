// Clipboard: rich copy/cut/paste (internal JSON + HTML + Markdown), block copy with nesting, Markdown/HTML paste,
// URL "Paste as" menu, image paste (upload → image block) and file drop.
import { start, newPage, tree, shot, type, check, failed, richText, selectInFocused, MOD, appendBlock, lineEnd } from './editor-lib.mjs';
import { BASE } from './lib.mjs';

const { browser, page } = await start();

/** Record what our copy/cut handler put on the clipboard (all MIME types). */
async function captureClipboard(page, keys) {
  await page.evaluate(() => {
    window.__clip = null;
    window.addEventListener('copy', (e) => { window.__clip = Object.fromEntries(Array.from(e.clipboardData.types).map((t) => [t, e.clipboardData.getData(t)])); }, { once: true });
    window.addEventListener('cut', (e) => { window.__clip = Object.fromEntries(Array.from(e.clipboardData.types).map((t) => [t, e.clipboardData.getData(t)])); }, { once: true });
  });
  await page.keyboard.press(keys);
  await page.waitForTimeout(150);
  return page.evaluate(() => window.__clip);
}

/** Paste arbitrary MIME data into the focused element. */
async function paste(page, data, files) {
  await page.evaluate(async ([d, f]) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(d)) dt.setData(k, v);
    if (f) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bytes], f.name, { type: f.type }));
    }
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [data, files ?? null]);
  await page.waitForTimeout(400);
}

const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

try {
  await newPage(page, 'Clipboard');

  // --- partial text copy keeps marks --------------------------------------------------------
  await type(page, 'Copy **bold** text');
  await selectInFocused(page, 5, 9);
  const clip1 = await captureClipboard(page, `${MOD}+c`);
  check('text copy: text/plain + text/html + internal JSON', !!clip1 && clip1['text/plain'] === '**bold**' && /<strong>bold<\/strong>/.test(clip1['text/html'] ?? '') && !!clip1['application/x-nc-blocks'], clip1);
  await lineEnd(page);
  await page.keyboard.press('Enter');
  await type(page, 'Paste: ');
  await paste(page, clip1);
  let rt = await richText(page);
  check('paste keeps bold', JSON.stringify(rt) === JSON.stringify([['Paste: '], ['bold', [['b']]]]), rt);

  // --- cut ---------------------------------------------------------------------------------
  await selectInFocused(page, 0, 7);
  const clipCut = await captureClipboard(page, `${MOD}+x`);
  rt = await richText(page);
  check('cut removes the range and fills the clipboard', clipCut?.['text/plain'] === 'Paste: ' && (rt ?? []).map((d) => d[0]).join('') === 'bold', { clipCut, rt });

  // --- markdown paste -------------------------------------------------------------------------
  await appendBlock(page);
  const md = ['# Title', '- a', '  - b', '- [x] done', '1. one', '2. two', '```js', 'const x = 1;', '```', '> quote', 'See [link](https://x.com) and `code`', '---', 'end'].join('\n');
  await paste(page, { 'text/plain': md });
  let t = await tree(page);
  const types = t.slice(2).map((b) => b.t);
  check('markdown paste → blocks', JSON.stringify(types) === JSON.stringify(['header', 'bulleted_list', 'to_do', 'numbered_list', 'numbered_list', 'code', 'quote', 'text', 'divider', 'text']), types);
  const a = t.find((b) => b.x === 'a');
  check('nested list from indentation', a?.k?.[0]?.x === 'b' && a.k[0].t === 'bulleted_list', a);
  check('to-do checked from [x]', t.find((b) => b.t === 'to_do')?.checked === true);
  const linkRt = await page.evaluate(() => {
    const { records } = window.__ncEditor;
    const pageId = document.querySelector('.nc-page-title[data-block-id]')?.getAttribute('data-block-id');
    const ids = records.get('block', pageId).content;
    for (const id of ids) {
      const v = records.get('block', id)?.properties?.title;
      if (v && JSON.stringify(v).includes('link')) return v;
    }
    return null;
  });
  check('inline markdown link + code', JSON.stringify(linkRt).includes('["a","https://x.com"]') && JSON.stringify(linkRt).includes('["c"]'), linkRt);
  const codeBlock = await page.evaluate(() => {
    const { records } = window.__ncEditor;
    const pageId = document.querySelector('.nc-page-title[data-block-id]')?.getAttribute('data-block-id');
    const b = records.get('block', pageId).content.map((id) => records.get('block', id)).find((x) => x.type === 'code');
    return { lang: b?.properties?.language?.[0]?.[0], text: b?.properties?.title?.[0]?.[0] };
  });
  check('code fence → code block with language', codeBlock.lang === 'JavaScript' && codeBlock.text === 'const x = 1;', codeBlock);

  // --- HTML paste ------------------------------------------------------------------------------
  await appendBlock(page);
  const before = (await tree(page)).length;
  await paste(page, {
    'text/html': '<meta charset="utf-8"><h2>Hello</h2><ul><li>One<ul><li>Two</li></ul></li></ul><p><b>B</b> and <a href="https://a.com">A</a></p><pre><code class="language-python">print(1)</code></pre>',
    'text/plain': 'Hello\nOne\nTwo\nB and A\nprint(1)',
  });
  t = await tree(page);
  const added = t.slice(before - 1).map((b) => b.t);
  check('HTML paste → heading, nested list, paragraph, code', JSON.stringify(added) === JSON.stringify(['sub_header', 'bulleted_list', 'text', 'code']), added);
  check('HTML nested <ul>', t.find((b) => b.x === 'One')?.k?.[0]?.x === 'Two');

  // --- block copy/paste with children ------------------------------------------------------------
  const leafOf = (txt) => page.locator('.lit-page-content [data-content-editable-leaf]', { hasText: new RegExp(`^${txt}$`) }).first();
  await leafOf('One').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown'); // One (+ child) and the paragraph
  const clipBlocks = await captureClipboard(page, `${MOD}+c`);
  const parsed = JSON.parse(clipBlocks?.['application/x-nc-blocks'] ?? '{}');
  check('block copy: JSON tree with children + markdown', parsed.blocks?.length === 2 && parsed.blocks[0].children?.[0]?.title?.[0]?.[0] === 'Two' && /- One\n {4}- Two/.test(clipBlocks['text/plain']), clipBlocks?.['text/plain']);
  await page.keyboard.press('Escape');
  await appendBlock(page);
  await paste(page, clipBlocks);
  t = await tree(page);
  check('block paste recreates the tree', t.filter((b) => b.x === 'One').length === 2 && t.filter((b) => b.x === 'One').every((b) => b.k?.[0]?.x === 'Two'), t.map((b) => b.x));

  
  // the pasted blocks, then the block-selection paste on window pasted them again) --------------------------------------
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await appendBlock(page);
  await type(page, 'Twin A');
  await page.keyboard.press('Enter');
  await type(page, 'Twin B');
  await leafOf('Twin A').click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press(`${MOD}+c`);
  await page.waitForTimeout(200);
  await appendBlock(page);
  await page.keyboard.press(`${MOD}+v`);
  await page.waitForTimeout(600);
  t = await tree(page);
  check('⌘V of two copied blocks into an empty block adds them once', t.filter((b) => b.x === 'Twin A').length === 2 && t.filter((b) => b.x === 'Twin B').length === 2, t.map((b) => b.x));

  // --- URL paste menu -------------------------------------------------------------------------------
  await appendBlock(page);
  await paste(page, { 'text/plain': 'https://example.com/help' });
  await page.waitForTimeout(300);
  const pasteMenu = await page.locator('.lit-overlay-container').innerText().catch(() => '');
  check('"Paste as" menu: Mention / URL / Bookmark / Embed', ['Paste as', 'Mention', 'URL', 'Bookmark', 'Embed'].every((x) => pasteMenu.includes(x)), pasteMenu);
  await shot(page, 'paste-as-menu');
  await page.click('.lit-overlay-container .nc-menu-item:has-text("Bookmark")');
  await page.waitForTimeout(300);
  t = await tree(page);
  check('Bookmark turns the empty block into a bookmark', t[t.length - 1].t === 'bookmark', t[t.length - 1]);

  await appendBlock(page);
  await type(page, 'See ');
  await paste(page, { 'text/plain': 'https://example.com/page' });
  await page.click('.lit-overlay-container .nc-menu-item:has-text("Mention")');
  await page.waitForTimeout(250);
  rt = await richText(page);
  check('Mention → link mention atom ["lm", {...}]', JSON.stringify(rt).includes('"lm"') && JSON.stringify(rt).includes('https://example.com/page'), rt);
  await appendBlock(page);
  await paste(page, { 'text/plain': 'https://example.com/x' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  rt = await richText(page);
  check('dismissing the menu keeps a plain link', JSON.stringify(rt) === JSON.stringify([['https://example.com/x', [['a', 'https://example.com/x']]]]), rt);

  // --- image paste ------------------------------------------------------------------------------------
  await appendBlock(page);
  await paste(page, {}, { b64: PNG_1x1, name: 'dot.png', type: 'image/png' });
  await page.waitForTimeout(800);
  t = await tree(page);
  const img = await page.evaluate(() => {
    const { records } = window.__ncEditor;
    const pageId = document.querySelector('.nc-page-title[data-block-id]')?.getAttribute('data-block-id');
    const b = records.get('block', pageId).content.map((id) => records.get('block', id)).filter((x) => x.alive !== false).pop();
    return { type: b?.type, src: b?.properties?.source?.[0]?.[0] };
  });
  check('pasted image uploads into an image block', img.type === 'image' && /\/files\//.test(img.src ?? ''), img);

  // --- file drop ---------------------------------------------------------------------------------------
  const count0 = (await tree(page)).length;
  await page.evaluate((b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'drop.png', { type: 'image/png' }));
    const target = document.querySelector('.lit-page-content .lit-selectable');
    const r = target.getBoundingClientRect();
    const opts = { dataTransfer: dt, bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.bottom - 2 };
    target.dispatchEvent(new DragEvent('dragover', opts));
    target.dispatchEvent(new DragEvent('drop', opts));
  }, PNG_1x1);
  await page.waitForTimeout(900);
  t = await tree(page);
  check('dropping an image file inserts an image block', t.length === count0 + 1 && t.some((b) => b.t === 'image'), t.map((b) => b.t));
  await shot(page, 'clipboard-final');
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(page, 'clipboard-error');
} finally {
  await browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

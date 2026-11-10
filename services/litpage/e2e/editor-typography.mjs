// Typography/spacing of text blocks compared with our type scale: block boxes, leaf font metrics, inline marks,
// light + dark screenshots of the same content.
import { start, newPage, shot, type, check, failed, appendBlock } from './editor-lib.mjs';

// Expected block metrics (height in px, font-size / line-height / weight), in the order the page below creates them.
const SPEC = [
  { cls: 'sub_header', h: 67.2, fs: '24px', lh: '31.2px', fw: '600' },
  { cls: 'sub_sub_header', h: 58, fs: '20px', lh: '26px', fw: '600' },
  { cls: 'header_4', h: 51.4, fs: '18px', lh: '23.4px', fw: '600' },
  { cls: 'text', h: 40, fs: '16px', lh: '24px', fw: '400' },
  { cls: 'bulleted_list', h: 65, fs: '16px', lh: '24px', fw: '400' },
  { cls: 'bulleted_list', h: 30, fs: '16px', lh: '24px', fw: '400' },
  { cls: 'bulleted_list', h: 30, fs: '16px', lh: '24px', fw: '400' },
  { cls: 'numbered_list', h: 30, fs: '16px', lh: '24px', fw: '400' },
  { cls: 'numbered_list', h: 30, fs: '16px', lh: '24px', fw: '400' },
  { cls: 'to_do', h: 35, fs: '16px', lh: '24px', fw: '400' },
];
const { browser, page } = await start();
try {
  await newPage(page, 'Typography');
  const lines = ['## Heading two', '### Heading three', '#### Heading four', 'Plain paragraph with **bold** and *italic* and `code` and ~strike~ text.'];
  for (const l of lines) {
    await type(page, l);
    await page.keyboard.press('Enter');
  }
  await type(page, '- Bullet one');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await type(page, 'Nested bullet');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  await type(page, 'Bullet two');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type(page, '1. Number one');
  await page.keyboard.press('Enter');
  await type(page, 'Number two');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type(page, '[] Todo item');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await type(page, 'After');
  await page.waitForTimeout(400);
  const ours = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('.lit-page-content .lit-selectable')) {
      const cls = Array.from(el.classList).find((c) => c.endsWith('-block'))?.replace(/^lit-|-block$/g, '');
      const r = el.getBoundingClientRect();
      const leaf = el.querySelector('[data-content-editable-leaf]');
      const cs = leaf && leaf.closest('.lit-selectable') === el ? getComputedStyle(leaf) : null;
      out.push({ cls, h: Math.round(r.height * 10) / 10, w: Math.round(r.width), fs: cs?.fontSize, lh: cs?.lineHeight, fw: cs?.fontWeight });
    }
    return out;
  });
  const refRows = SPEC;
  const pick = (arr, cls, n = 0) => arr.filter((x) => x.cls === cls)[n];
  for (const [cls, n] of [['sub_header', 0], ['sub_sub_header', 0], ['header_4', 0], ['text', 0], ['bulleted_list', 0], ['bulleted_list', 1], ['numbered_list', 0], ['numbered_list', 1], ['to_do', 0]]) {
    const a = pick(ours, cls, n);
    const b = pick(refRows, cls, n);
    if (!a || !b) { check(`${cls}#${n} present`, false, { a, b }); continue; }
    const ok = Math.abs(a.h - b.h) <= 1 && a.fs === b.fs && a.lh === b.lh && a.fw === b.fw;
    check(`${cls}#${n} box ${b.h}px ${b.fs}/${b.lh}/${b.fw}`, ok, { ours: a, litpage: b });
  }
  // inline marks in the paragraph: each mark renders with its own style
  const inl = await page.evaluate(() => {
    const leaf = Array.from(document.querySelectorAll('.lit-page-content .lit-text-block [data-content-editable-leaf]')).find((l) => l.textContent.startsWith('Plain paragraph'));
    const cs0 = getComputedStyle(leaf);
    return {
      color: cs0.color,
      spans: Array.from(leaf.querySelectorAll('span')).filter((s) => s.textContent.trim()).map((s) => {
        const cs = getComputedStyle(s);
        return { text: s.textContent, fw: cs.fontWeight, fst: cs.fontStyle, td: cs.textDecorationLine, fs: cs.fontSize, color: cs.color, bg: cs.backgroundColor, pl: cs.paddingLeft, br: cs.borderRadius };
      }),
    };
  });
  const span = (text) => inl.spans.find((s) => s.text === text);
  const transparent = (c) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';
  check('bold is bold', Number(span('bold')?.fw) >= 600, span('bold'));
  check('italic is italic', span('italic')?.fst === 'italic', span('italic'));
  check('code has a background and padding', !!span('code') && !transparent(span('code').bg) && span('code').pl !== '0px', span('code'));
  check('strike is struck through', (span('strike')?.td ?? '').includes('line-through'), span('strike'));
  check('plain text keeps the base size', inl.spans.every((s) => s.text === 'code' || s.fs === '16px'), inl.spans);
  await shot(page, 'typography-light');
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+l`);
  await page.waitForTimeout(400);
  await shot(page, 'typography-dark');
  // select text in dark mode to screenshot the text action menu
  await page.locator('.lit-page-content [data-content-editable-leaf]').nth(3).click();
  await page.evaluate(() => {
    const leaf = document.activeElement;
    const r = document.createRange();
    r.setStart(leaf.firstChild, 0);
    r.setEnd(leaf.firstChild, 15);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
  });
  await page.waitForTimeout(300);
  await shot(page, 'toolbar-dark');
  check('text action menu visible in dark mode', (await page.locator('.lit-text-action-menu').count()) === 1);
  await page.click('.lit-text-action-menu [data-tooltip="Text color"]');
  await page.waitForTimeout(250);
  await shot(page, 'color-menu-dark');
  await page.keyboard.press('Escape');
  await page.keyboard.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+Shift+l`);
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(page, 'typography-error');
} finally {
  await browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

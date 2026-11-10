// Text action menu (vertical card under a selection), color menu, links (⌘K popup, hover pill, edit, paste URL on
// selection), turn into, mark shortcuts.
import { start, newPage, tree, shot, type, check, failed, richText, selectInFocused, MOD } from './editor-lib.mjs';

const { browser, page, context } = await start();
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
try {
  await newPage(page, 'Toolbar');
  await type(page, 'Plain paragraph with bold and italic and code and strike text.');
  // select "Plain paragraph"
  await selectInFocused(page, 0, 15);
  await page.waitForSelector('.lit-text-action-menu .nc-tam-card', { timeout: 3000 }).catch(() => {});
  const card = await page.evaluate(() => {
    const c = document.querySelector('.lit-text-action-menu .nc-tam-card');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const btns = Array.from(c.querySelectorAll('[role=button]')).map((b) => b.getAttribute('data-tooltip') || b.getAttribute('aria-label') || b.textContent?.trim());
    return { w: r.width, h: Math.round(r.height), radius: getComputedStyle(c).borderRadius, btns };
  });
  check('text action menu appears on selection', !!card, card);
  check('card is 192px wide, radius 14', card?.w === 192 && card?.radius === '14px', card);
  check('rows: Turn into / A B I U Tx / link S code √x ••• / Comment 🙂 ✎', card && ['Text color', 'Bold', 'Italicize', 'Underline', 'Clear format', 'Add link', 'Strike-through', 'Apply code style', 'Apply equation style', 'Comment', 'React to this selection', 'Suggest edits'].every((x) => card.btns.includes(x)), card?.btns);
  const label = await page.locator('.nc-tam-turninto-label').innerText().catch(() => '');
  check('"Normal Text" turn-into row', label === 'Normal Text', label);
  await shot(page, 'toolbar-card');

  // Bold via toolbar button
  await page.click('.nc-tam-btn[data-tooltip="Bold"]');
  await page.waitForTimeout(200);
  let rt = await richText(page);
  check('toolbar Bold applies ["b"]', JSON.stringify(rt?.[0]) === JSON.stringify(['Plain paragraph', [['b']]]), rt?.[0]);
  const pressed = await page.getAttribute('.nc-tam-btn[data-tooltip="Bold"]', 'aria-pressed').catch(() => null);
  check('Bold button shows pressed state', pressed === 'true', pressed);
  await page.click('.nc-tam-btn[data-tooltip="Bold"]');
  await page.waitForTimeout(150);

  // color menu
  await page.click('.nc-tam-btn[data-tooltip="Text color"]');
  await page.waitForSelector('.nc-color-menu');
  await shot(page, 'toolbar-color-menu');
  const sections = await page.locator('.nc-color-menu .nc-menu-section-title').allInnerTexts();
  check('color menu sections', sections.join('|') === 'Text color|Background color' || sections.join('|') === 'Recently used|Text color|Background color', sections);
  // blue text = 7th text swatch
  await page.locator('.nc-color-menu .nc-color-section').nth(sections.length - 2).locator('.nc-color-cell-btn').nth(6).click();
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('text color annotation ["h","blue"]', JSON.stringify(rt?.[0]?.[1]) === JSON.stringify([['h', 'blue']]), rt?.[0]);
  const styleBlue = await page.evaluate(() => document.querySelector('.lit-page-content [data-content-editable-leaf] span')?.getAttribute('style'));
  check('rendered with var(--lp-blue-text-secondary)', /--lp-blue-text-secondary/.test(styleBlue ?? ''), styleBlue);

  // background on "with"
  await page.locator('.lit-page-content [data-content-editable-leaf]').first().click();
  await selectInFocused(page, 16, 20);
  await page.click('.nc-tam-btn[data-tooltip="Text color"]');
  await page.waitForSelector('.nc-color-menu');
  const secs2 = await page.locator('.nc-color-menu .nc-color-section').count();
  await page.locator('.nc-color-menu .nc-color-section').nth(secs2 - 1).locator('.nc-color-cell-btn').nth(4).click();
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('background annotation ["h","yellow_background"]', JSON.stringify(rt).includes('["h","yellow_background"]'), rt);
  const bgStyle = await page.evaluate(() => Array.from(document.querySelectorAll('.lit-page-content [data-content-editable-leaf] span')).map((s) => s.getAttribute('style')).find((s) => s?.includes('bg-secondary-transparent')));
  check('inline background uses translucent --lp-yellow-bg-secondary-transparent', /--lp-yellow-bg-secondary-transparent/.test(bgStyle ?? ''), bgStyle);
  await shot(page, 'toolbar-apply-bg');

  // ⌘⇧H re-applies the last color
  await page.locator('.lit-page-content [data-content-editable-leaf]').first().click();
  await selectInFocused(page, 21, 25); // "bold"
  await page.keyboard.press(`${MOD}+Shift+h`);
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('⌘⇧H applies last used color', (rt ?? []).filter((d) => JSON.stringify(d[1] ?? []).includes('yellow_background')).length >= 2, rt);

  // mark shortcuts
  const marks = [['b', ['b']], ['i', ['i']], ['u', ['_']], ['e', ['c']]];
  await page.locator('.lit-page-content [data-content-editable-leaf]').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await type(page, 'alpha beta gamma delta epsilon zeta');
  const words = { alpha: [0, 5], beta: [6, 10], gamma: [11, 16], delta: [17, 22], epsilon: [23, 30], zeta: [31, 35] };
  for (const [i, [k]] of marks.entries()) {
    const w = Object.values(words)[i];
    await selectInFocused(page, w[0], w[1]);
    await page.keyboard.press(`${MOD}+${k}`);
    await page.waitForTimeout(80);
  }
  await selectInFocused(page, ...words.epsilon);
  await page.keyboard.press(`${MOD}+Shift+s`);
  await selectInFocused(page, ...words.zeta);
  await page.keyboard.press(`${MOD}+Shift+x`);
  await page.waitForTimeout(150);
  rt = await richText(page);
  const got = (rt ?? []).filter((d) => d[1]).map((d) => `${d[0]}:${d[1].map((a) => a[0]).join('')}`);
  check('⌘B ⌘I ⌘U ⌘E ⌘⇧S ⌘⇧X', JSON.stringify(got) === JSON.stringify(['alpha:b', 'beta:i', 'gamma:_', 'delta:c', 'epsilon:s', 'zeta:s']), got);
  const uStyle = await page.evaluate(() => Array.from(document.querySelectorAll('[data-content-editable-leaf] span')).map((s) => s.getAttribute('style') ?? '').find((s) => s.includes('underline')));
  check('underline renders 0.05em thickness', /text-decoration-thickness:0.05em/.test(uStyle ?? ''), uStyle);
  const codeStyle = await page.evaluate(() => document.querySelector('.lit-inline-code-container > span')?.getAttribute('style'));
  check('inline code: SFMono, --lp-bg-interactive-transparent, --lp-red-text-secondary, 85%', /SFMono-Regular/.test(codeStyle ?? '') && /--lp-bg-interactive-transparent/.test(codeStyle ?? '') && /--lp-red-text-secondary/.test(codeStyle ?? '') && /85%/.test(codeStyle ?? ''), codeStyle);
  await shot(page, 'toolbar-marks');

  // ⌘K link popup → URL → Enter
  await selectInFocused(page, ...words.gamma);
  await page.keyboard.press(`${MOD}+k`);
  await page.waitForSelector('.nc-link-popup input');
  await shot(page, 'toolbar-link-popup');
  await page.keyboard.type('https://example.com');
  await page.waitForTimeout(250);
  const opt = await page.locator('.nc-link-popup .nc-menu-item').first().innerText().catch(() => '');
  check('typed URL → "Web page link" option', /example\.com/.test(opt) && /Web page link/.test(opt), opt);
  await shot(page, 'toolbar-link-url-typed');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  rt = await richText(page);
  check('link committed ["a", url]', JSON.stringify(rt).includes('["a","https://example.com"]'), rt);
  const linkMarkup = await page.evaluate(() => {
    const a = document.querySelector('.lit-page-content a.lit-link-token');
    return a ? { cls: a.className, inner: a.firstElementChild?.getAttribute('style') } : null;
  });
  check('link markup a.lit-link-token > span (underline .05em, opacity .7)', !!linkMarkup && /opacity:0.7/.test(linkMarkup.inner ?? '') && /--lp-text-decoration-transparent/.test(linkMarkup.inner ?? ''), linkMarkup);

  // hover pill
  await page.mouse.move(10, 10);
  await page.hover('.lit-page-content a.lit-link-token');
  await page.waitForSelector('.nc-link-pill', { timeout: 2000 }).catch(() => {});
  const pill = await page.locator('.nc-link-pill').innerText().catch(() => '');
  check('link hover pill: URL + Edit', /example\.com/.test(pill) && /Edit/.test(pill), pill);
  await shot(page, 'toolbar-link-hover');
  await page.click('.nc-link-pill .nc-link-pill-btn:not(.icon)');
  await page.waitForSelector('.nc-link-edit input');
  const editTxt = await page.locator('.nc-link-edit').innerText();
  check('Edit popup: Page or URL / Link title / Remove link', /Page or URL/.test(editTxt) && /Link title/.test(editTxt) && /Remove link/.test(editTxt), editTxt);
  await shot(page, 'toolbar-link-edit');
  await page.click('text=Remove link');
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('Remove link drops ["a"]', !JSON.stringify(rt).includes('"a"'), rt);

  // paste URL over a selection → link immediately
  await page.locator('.lit-page-content [data-content-editable-leaf]').nth(1).click();
  await selectInFocused(page, ...words.delta);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://example.org');
    document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(250);
  rt = await richText(page);
  check('paste URL on selection → link', JSON.stringify(rt).includes('["a","https://example.org"]'), rt);

  // turn into from the card
  await selectInFocused(page, ...words.alpha);
  await page.hover('.nc-tam-turninto');
  await page.waitForTimeout(400);
  const turnItems = await page.locator('.lit-overlay-container .nc-menu-item').allInnerTexts();
  check('Turn into submenu has 23 items incl. Page in / 5 columns', turnItems.length === 23 && turnItems.some((x) => x.includes('Page in')) && turnItems.some((x) => x.includes('5 columns')), turnItems.length);
  await shot(page, 'toolbar-turn-into');
  await page.click('.lit-overlay-container .nc-menu-item:has-text("Heading 2")');
  await page.waitForTimeout(200);
  const t = await tree(page);
  check('Turn into Heading 2 from the card', t.some((b) => b.t === 'sub_header' && b.x.startsWith('alpha')), t.map((b) => b.t));

  // ••• opens the block action menu
  await selectInFocused(page, 0, 5);
  await page.click('.nc-tam-more');
  await page.waitForTimeout(250);
  const more = await page.locator('.lit-overlay-container').innerText().catch(() => '');
  check('••• opens block action menu', /Copy block URL/.test(more) && /Duplicate/.test(more), more.slice(0, 80));
  await page.keyboard.press('Escape');

  // equation from the card
  await page.locator('.lit-page-content [data-content-editable-leaf]').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await type(page, 'Eq: theta');
  await selectInFocused(page, 4, 9);
  await page.click('.nc-tam-btn[data-tooltip="Apply equation style"]');
  await page.waitForSelector('.nc-equation-editor');
  const eqText = await page.locator('.nc-equation-input').innerText();
  check('√x converts selection to equation and opens the editor', eqText === 'theta', eqText);
  await shot(page, 'toolbar-equation');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  rt = await richText(page);
  check('Esc keeps the converted equation (cancel restores previous TeX)', JSON.stringify(rt).includes('["e","theta"]'), rt);
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(page, 'toolbar-error');
} finally {
  await browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

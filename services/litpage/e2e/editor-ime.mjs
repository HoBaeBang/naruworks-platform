// Korean IME through CDP Input.imeSetComposition (compositionstart/update/end like a real IME):
// the leaf must never re-render mid-composition, markdown/menus must still work around composed text.
import { start, newPage, tree, shot, type, check, failed, richText, appendBlock } from './editor-lib.mjs';

const { browser, page } = await start();
try {
  await newPage(page, 'IME');
  const cdp = await page.context().newCDPSession(page);
  const compose = async (steps, commit) => {
    for (const t of steps) {
      await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
      await page.waitForTimeout(15);
    }
    await cdp.send('Input.insertText', { text: commit });
    await page.waitForTimeout(30);
  };

  // plain Korean text
  await compose(['ㅎ', '하', '한'], '한');
  await compose(['ㄱ', '그', '글'], '글');
  await type(page, ' ');
  await compose(['ㅇ', '이', '입'], '입');
  await compose(['ㄹ', '려', '력'], '력');
  let rt = await richText(page);
  check('Korean syllables committed in order', (rt ?? []).map((d) => d[0]).join('') === '한글 입력', rt);

  // mid-composition the DOM is not replaced (leaf keeps the composing node)
  await cdp.send('Input.imeSetComposition', { text: 'ㅌ', selectionStart: 1, selectionEnd: 1 });
  const midText = await page.evaluate(() => document.activeElement?.textContent);
  check('composition text visible while composing', midText === '한글 입력ㅌ', midText);
  await cdp.send('Input.imeSetComposition', { text: '테', selectionStart: 1, selectionEnd: 1 });
  await cdp.send('Input.insertText', { text: '테' });
  await page.waitForTimeout(80);
  rt = await richText(page);
  check('composition commit lands once', (rt ?? []).map((d) => d[0]).join('') === '한글 입력테', rt);

  // Enter after composition splits normally
  await page.keyboard.press('Enter');
  await compose(['ㄷ', '두', '둘'], '둘');
  await compose(['ㅉ', '째'], '째');
  let t = await tree(page);
  check('Enter then Korean in the next block', t.length === 2 && t[1].x === '둘째', t);

  // markdown shortcut followed by Korean
  await page.keyboard.press('Enter');
  await type(page, '# ');
  await compose(['ㅈ', '제', '젬', '제목'], '제목');
  t = await tree(page);
  check('"# " + Korean → heading', t[2]?.t === 'header' && t[2]?.x === '제목', t[2]);

  // inline markdown around composed text
  await page.keyboard.press('Enter');
  await type(page, '**');
  await compose(['ㄱ', '구', '굵', '굵ㄱ', '굵게'], '굵게');
  await type(page, '**');
  rt = await richText(page);
  check('**한글** → bold', JSON.stringify(rt) === JSON.stringify([['굵게', [['b']]]]), rt);
  await type(page, ' 다음');
  rt = await richText(page);
  check('text after autoformat is not bold', JSON.stringify(rt?.[rt.length - 1]) === JSON.stringify([' 다음']), rt);

  // @ menu with a Korean query
  await appendBlock(page);
  await type(page, '@');
  await compose(['ㅇ', '오', '오느', '오늘'], '오늘');
  await page.waitForTimeout(300);
  const q = await page.evaluate(() => window.__ncEditor.useEditor.getState().slash?.query);
  check('@ menu query follows composed Korean', q === '오늘', q);
  await page.keyboard.press('Escape');

  // no text action menu while composing over a selection
  await appendBlock(page);
  await compose(['ㅅ', '선', '선ㅌ', '선태', '선택'], '선택');
  await page.evaluate(() => {
    const leaf = document.activeElement;
    const r = document.createRange();
    r.selectNodeContents(leaf);
    getSelection().removeAllRanges();
    getSelection().addRange(r);
  });
  await cdp.send('Input.imeSetComposition', { text: 'ㄱ', selectionStart: 1, selectionEnd: 1 });
  await page.waitForTimeout(250);
  const menuDuring = await page.locator('.lit-text-action-menu').count();
  check('no text action menu during composition', menuDuring === 0, menuDuring);
  await cdp.send('Input.insertText', { text: '교' });
  await page.waitForTimeout(100);
  rt = await richText(page);
  check('composition replaces the selection', (rt ?? []).map((d) => d[0]).join('') === '교', rt);
  await shot(page, 'ime');

  // persisted after reload
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.lit-page-content [data-content-editable-leaf]');
  await page.waitForTimeout(600);
  t = await tree(page);
  check('Korean text persisted', t[0]?.x === '한글 입력테' && t[1]?.x === '둘째' && t[2]?.x === '제목', t.slice(0, 3));
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(page, 'ime-error');
} finally {
  await browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

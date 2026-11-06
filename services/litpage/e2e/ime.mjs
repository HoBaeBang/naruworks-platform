// Korean IME composition test via CDP Input.imeSetComposition (compositionstart/update/end in Chrome).
import { launch, signup, newPage } from './lib.mjs';
const { browser, page } = await launch();
try {
  await signup(page);
  await newPage(page);
  await page.keyboard.type('IME');
  await page.keyboard.press('Enter');
  const cdp = await page.context().newCDPSession(page);
  const compose = async (steps, commit) => {
    for (const t of steps) await cdp.send('Input.imeSetComposition', { text: t, selectionStart: t.length, selectionEnd: t.length });
    await cdp.send('Input.insertText', { text: commit });
  };
  // "한글 입력" typed syllable by syllable as a Korean IME would
  await compose(['ㅎ', '하', '한'], '한');
  await compose(['ㄱ', '그', '글'], '글');
  await page.keyboard.type(' ');
  await compose(['ㅇ', '이', '입'], '입');
  await compose(['ㄹ', '려', '력'], '력');
  await page.keyboard.press('Enter');
  await compose(['ㄷ', '두', '둘'], '둘');
  await compose(['ㅉ', '째'], '째');
  await page.waitForTimeout(800);
  const texts = await page.$$eval('.lit-page-content [data-content-editable-leaf]', (els) => els.map((e) => e.textContent));
  console.log(JSON.stringify(texts));
  await page.reload();
  await page.waitForSelector('.lit-page-content [data-content-editable-leaf]');
  await page.waitForTimeout(600);
  console.log('after reload', JSON.stringify(await page.$$eval('.lit-page-content [data-content-editable-leaf]', (els) => els.map((e) => e.textContent))));
} catch (e) {
  console.log('IME FAILED', e.message);
} finally {
  await browser.close();
}

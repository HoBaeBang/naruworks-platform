// Quick smoke: create each non-text block from the slash menu on a fresh page and screenshot.
import { launch, signup } from './lib.mjs';
import { mkdirSync } from 'node:fs';
const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-blocks';
mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
async function newBlockLine() {
  // click below content to append an empty text block
  await page.click('.nc-click-to-append');
  await page.waitForTimeout(150);
}
async function slash(query) {
  await newBlockLine();
  await page.keyboard.type('/' + query, { delay: 15 });
  await page.waitForTimeout(350);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
}
try {
  await signup(page);
  await page.click('[aria-label="New page"]');
  await page.waitForTimeout(350);
  const item = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
  if (await item.count()) await item.first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type('Blocks smoke');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  for (const q of ['callout', 'quote', 'divider', 'toggle heading 1', 'table of contents', 'block equation', 'breadcrumb', 'tabs', 'synced block', 'button', 'code', 'image', 'video', 'audio', 'file', 'web bookmark', 'embed', 'figma', 'html', 'table', '2 columns', 'ai block']) {
    await slash(q);
    const types = await page.$$eval('.lit-page-content > .nc-block-list > .lit-selectable', (els) => els.map((e) => e.className.split(' ').find((c) => c.startsWith('lit-') && c.endsWith('-block'))));
    console.log(q.padEnd(20), '→', types[types.length - 1], types.length);
  }
  await page.screenshot({ path: `${OUT}/smoke-top.png` });
  await page.evaluate(() => document.querySelector('.nc-page-scroller')?.scrollBy(0, 900));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/smoke-mid.png` });
  await page.evaluate(() => document.querySelector('.nc-page-scroller')?.scrollBy(0, 900));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/smoke-bottom.png` });
} catch (e) {
  console.log('SMOKE FAILED', e.message);
  await page.screenshot({ path: `${OUT}/smoke-error.png` });
} finally {
  console.log('page errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
}

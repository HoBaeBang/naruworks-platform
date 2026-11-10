import { launch, signup, newPage, BASE } from './lib.mjs';
const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e';
import { mkdirSync } from 'node:fs';
mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch();
try {
  await signup(page);
  await page.screenshot({ path: `${OUT}/01-home.png` });
  await page.click('text=Welcome to Litpage');
  await page.waitForSelector('.lit-page-content');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/02-getting-started.png` });
  // new page
  await newPage(page);
  await page.keyboard.type('Smoke Test Page');
  await page.keyboard.press('Enter');
  await page.keyboard.type('# Heading one');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain **bold** text and `code`.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- bullet');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('[] todo');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/03-slash.png` });
  await page.keyboard.type('callout');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.keyboard.type('A callout');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/04-page.png` });
  const blocks = await page.$$eval('.lit-page-content .lit-selectable', (els) => els.map((e) => e.className.split(' ').find((c) => c.endsWith('-block')) + ':' + (e.innerText || '').slice(0, 30)));
  console.log(blocks.join('\n'));
  // reload persists?
  await page.reload();
  await page.waitForSelector('.lit-page-content .lit-selectable');
  await page.waitForTimeout(800);
  const after = await page.$$eval('.lit-page-content .lit-selectable', (els) => els.length);
  console.log('after reload blocks:', after);
  await page.screenshot({ path: `${OUT}/05-reloaded.png` });
} catch (e) {
  console.log('E2E FAILED', e.message);
  await page.screenshot({ path: `${OUT}/error.png` });
} finally {
  await browser.close();
}

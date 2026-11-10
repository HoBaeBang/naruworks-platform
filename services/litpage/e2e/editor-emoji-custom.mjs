
// "Add a custom emoji" (upload + name), ":name" autocomplete inserts a ["ce", id, spaceId] atom (image), /emoji full
// picker Custom section, page icon picker Custom section, comment reactions with a custom emoji.
// Run: NC_BASE=http://127.0.0.1:5461 node e2e/editor-emoji-custom.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { join } from 'node:path';
import { start, newPage, shot, type, check, failed, MOD, OUT, richText, appendBlock } from './editor-lib.mjs';

const FIX = join(OUT, 'fixtures');
mkdirSync(FIX, { recursive: true });
// 16×16 orange PNG (built here: signature + IHDR + IDAT + IEND)
function makePng(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const png = makePng(16, 16, [240, 140, 40]);
const pngPath = join(FIX, 'party-blob.png');
writeFileSync(pngPath, png);

const { browser, page } = await start();
const wait = (ms) => page.waitForTimeout(ms);

try {
  const pageId = await newPage(page, 'Custom emoji');
  await type(page, 'Hello :par', 30);
  await wait(400);
  check('":" menu open with the "+" cell', (await page.locator('.nc-em-menu .nc-em-add').count()) === 1);
  await page.locator('.nc-em-menu .nc-em-add').click();
  await wait(400);
  check('"+" opens "Add a custom emoji"', (await page.locator('.nc-cemoji-title', { hasText: 'Add a custom emoji' }).count()) === 1);
  await page.setInputFiles('[data-testid="custom-emoji-file"]', pngPath);
  await page.waitForSelector('#nc-cemoji-name', { timeout: 8000 });
  check('name suggested from the file name', (await page.inputValue('#nc-cemoji-name')) === 'party-blob');
  await shot(page, 'custom-emoji-popup');
  await page.locator('#nc-cemoji-name').press('Enter');
  await wait(800);
  let rt = await richText(page);
  const atom = (rt ?? []).find((d) => (d[1] ?? []).some((a) => a[0] === 'ce'));
  check('after adding, ":par" is replaced by the custom emoji atom', !!atom && !JSON.stringify(rt).includes(':par'), rt);
  check('custom emoji renders as an image', (await page.locator('.lit-page-content .lit-custom-emoji-token img').count()) === 1);

  // autocomplete
  await page.keyboard.press('End');
  await type(page, ' and :party', 30);
  await wait(400);
  const first = await page.locator('.nc-em-menu [role="gridcell"]').first().getAttribute('data-custom-emoji');
  check('":party" lists the custom emoji first', first === 'party-blob', first);
  await page.keyboard.press('Enter');
  await wait(400);
  rt = await richText(page);
  check('Enter inserts a second custom emoji', (rt ?? []).filter((d) => (d[1] ?? []).some((a) => a[0] === 'ce')).length === 2, rt);

  // /emoji full picker: Custom section
  await appendBlock(page);
  await type(page, '/emoji', 30);
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(400);
  await page.locator('.nc-em-menu [aria-label="Jump to category: custom"]').click();
  await wait(200);
  check('/emoji picker has a Custom section', (await page.locator('.nc-em-menu .nc-em-section-title', { hasText: 'Custom' }).count()) === 1);
  await page.locator('.nc-em-menu [data-custom-emoji="party-blob"]').first().click();
  await wait(300);
  check('picking from the full picker inserts the atom', (await page.locator('.lit-page-content .lit-custom-emoji-token img').count()) === 3);

  // reload
  await page.reload();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await wait(800);
  check('custom emoji atoms persist after reload', (await page.locator('.lit-page-content .lit-custom-emoji-token img').count()) === 3);

  // page icon picker → Custom
  await page.hover('.nc-page-title');
  await page.locator('.lit-page-controls >> text=Add icon').click();
  await wait(500);
  await page.locator('.nc-icon-picker [aria-label="Jump to category: custom"]').click();
  await wait(200);
  check('icon picker shows the Custom section', (await page.locator('.nc-icon-picker [data-section="custom"] [data-custom-emoji="party-blob"]').count()) === 1);
  await page.locator('.nc-icon-picker [data-custom-emoji="party-blob"]').click();
  await wait(400);
  const icon = await page.evaluate((pid) => window.__ncEditor.records.get('block', pid)?.format?.page_icon, pageId);
  check('custom emoji becomes the page icon (image url)', typeof icon === 'string' && icon.startsWith('/files/'), icon);

  // reaction with a custom emoji
  const leaf = page.locator('[data-content-editable-leaf]', { hasText: 'Hello' }).first();
  await leaf.click();
  await page.keyboard.press(`${MOD}+a`);
  await page.keyboard.press(`${MOD}+Shift+m`);
  await page.waitForSelector('.nc-discussion-popover.composer .nc-comment-input', { timeout: 5000 });
  await page.keyboard.type('Nice');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lit-page-content [data-discussion-id]', { timeout: 5000 });
  await page.click('.lit-page-content [data-discussion-id]');
  await page.waitForSelector('.nc-discussion-popover .nc-comment', { timeout: 5000 });
  await page.hover('.nc-discussion-popover .nc-comment >> nth=0');
  await page.locator('.nc-discussion-popover .nc-comment').first().locator('.nc-comment-actions [aria-label="Add reaction"]').click();
  await wait(400);
  await page.locator('.lit-overlay-container .nc-picker-filter input').fill('party');
  await wait(300);
  await page.locator('.lit-overlay-container [data-custom-emoji="party-blob"]').first().click();
  await page.waitForSelector('.nc-discussion-popover .nc-reaction:not(.add)', { timeout: 5000 });
  check('custom emoji reaction shows the image', (await page.locator('.nc-discussion-popover .nc-reaction:not(.add) img.nc-reaction-img').count()) === 1);
  await shot(page, 'custom-emoji-reaction');
} catch (e) {
  check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);

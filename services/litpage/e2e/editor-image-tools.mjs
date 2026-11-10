// Image block tools (crop, mask, ALT badge, add link, full screen viewer, Space,
// ⌘Enter): crop to a square, circle mask (transparent corners), revert, link to a page, viewer paging.
// Run: NC_BASE=http://127.0.0.1:5461 node e2e/editor-image-tools.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { start, newPage, shot, type, check, failed, MOD, OUT, appendBlock } from './editor-lib.mjs';

const FIX = join(OUT, 'fixtures');
mkdirSync(FIX, { recursive: true });
const { browser, page } = await start();
const wait = (ms) => page.waitForTimeout(ms);
const block = (id) => page.evaluate((x) => window.__ncEditor.records.get('block', x), id);

async function addImage(w, h, label, color) {
  await appendBlock(page);
  await type(page, '/image', 20);
  await wait(300);
  await page.keyboard.press('Enter');
  await wait(400);
  const dataUrl = await page.evaluate(([w, h, label, color]) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = '#fff'; g.font = 'bold 40px sans-serif'; g.fillText(label, 30, h / 2);
    return c.toDataURL('image/png');
  }, [w, h, label, color]);
  const path = join(FIX, `${label}.png`);
  writeFileSync(path, Buffer.from(dataUrl.split(',')[1], 'base64'));
  await page.locator('.nc-media-picker').last().locator('input[type=file]').setInputFiles(path);
  await page.locator('.lit-image-block img.nc-image').last().waitFor({ timeout: 10000 });
  await wait(500);
  return page.locator('.lit-image-block').last().getAttribute('data-block-id');
}

try {
  await newPage(page, 'Image tools');
  await type(page, 'Target page link text');
  const img1 = await addImage(600, 300, 'first', '#2783de');
  const img2 = await addImage(400, 300, 'second', '#d44c47');
  const fig = page.locator(`[data-block-id="${img1}"]`);

  // ---- crop to a square
  await fig.locator('.nc-media-frame').hover();
  await wait(200);
  check('hover bar has Crop', (await fig.locator('[aria-label="Crop image"]').count()) === 1);
  await fig.locator('[aria-label="Crop image"]').click();
  await page.waitForSelector('.nc-image-editor canvas', { timeout: 5000 });
  await wait(300);
  check('"Crop image" editor opens', (await page.locator('.nc-image-editor-title', { hasText: 'Crop image' }).count()) === 1);
  await page.locator('.nc-image-editor [aria-label="Aspect ratio"]').click();
  await page.locator('.lit-overlay-container [role="menuitem"]', { hasText: 'Square' }).click();
  await wait(200);
  const box = await page.locator('[data-testid="crop-box"]').boundingBox();
  check('Square style makes a 1:1 crop box', box && Math.abs(box.width - box.height) < 2, box);
  await shot(page, 'image-crop-editor');
  const before = (await block(img1)).properties.source[0][0];
  await page.locator('.nc-image-editor .nc-dialog-btn.primary', { hasText: 'Save' }).click();
  await page.waitForFunction(([id, src]) => window.__ncEditor.records.get('block', id)?.properties?.source?.[0]?.[0] !== src, [img1, before], { timeout: 10000 });
  await wait(500);
  let b = await block(img1);
  check('Save uploads the cropped image (new source, square ratio)', b.properties.source[0][0] !== before && Math.abs(b.format.block_aspect_ratio - 1) < 0.02, b.format);
  check('original kept for "Restore original"', b.format.original_source === before, b.format.original_source);
  const nat = await fig.locator('img.nc-image').evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
  check('cropped file is square (300×300)', nat.w === 300 && nat.h === 300, nat);

  // ---- circle mask
  await fig.locator('.nc-media-frame').hover();
  await fig.locator('[aria-label="Crop image"]').click();
  await page.waitForSelector('.nc-image-editor canvas', { timeout: 5000 });
  await page.locator('.nc-image-editor [aria-label="Aspect ratio"]').click();
  await page.locator('.lit-overlay-container [role="menuitem"]', { hasText: 'Circle' }).click();
  await wait(200);
  check('Circle style shows a round crop box', (await page.locator('[data-testid="crop-box"].circle').count()) === 1);
  const prev = (await block(img1)).properties.source[0][0];
  await page.locator('.nc-image-editor .nc-dialog-btn.primary', { hasText: 'Save' }).click();
  await page.waitForFunction(([id, src]) => window.__ncEditor.records.get('block', id)?.properties?.source?.[0]?.[0] !== src, [img1, prev], { timeout: 10000 });
  await wait(600);
  b = await block(img1);
  check('circle mask saved as PNG (image_mask circle)', b.format.image_mask === 'circle' && /\.png/.test(b.properties.source[0][0]), b.format);
  const corner = await page.evaluate(async (src) => {
    const im = new Image();
    im.src = src;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(im, 0, 0);
    return { corner: g.getImageData(1, 1, 1, 1).data[3], center: g.getImageData(c.width / 2, c.height / 2, 1, 1).data[3] };
  }, b.properties.source[0][0]);
  check('mask: transparent corner, opaque center', corner.corner === 0 && corner.center === 255, corner);

  // ---- revert
  await fig.locator('.nc-media-frame').hover();
  await fig.locator('[aria-label="Crop image"]').click();
  await page.waitForSelector('.nc-image-editor', { timeout: 5000 });
  await page.locator('.nc-image-editor .nc-dialog-btn', { hasText: 'Restore original' }).click();
  await wait(800);
  b = await block(img1);
  check('Restore original restores the first source', b.properties.source[0][0] === before && !b.format.original_source && !b.format.image_mask, b.format);

  // ---- add link to image (page link)
  await fig.locator('.nc-media-frame').hover();
  await fig.locator('[aria-label="Open block options"]').click();
  await wait(300);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Add image link' }).click();
  await wait(300);
  check('"Add image link" popover', (await page.locator('.nc-image-link-popover input[placeholder="Paste a link or find pages"]').count()) === 1);
  await page.locator('.nc-image-link-popover input').fill('https://example.com/target');
  await page.locator('.nc-image-link-popover input').press('Enter');
  await wait(400);
  b = await block(img1);
  check('link stored in format.image_hyperlink', b.format.image_hyperlink === 'https://example.com/target', b.format);
  await fig.locator('.nc-media-frame').hover();
  await fig.locator('[aria-label="Open block options"]').click();
  await wait(300);
  check('menu now says "Change image link"', (await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Change image link' }).count()) === 1);
  await page.keyboard.press('Escape');

  // ---- alt text badge
  await page.evaluate(async (id) => {
    const blocks = await import('/src/lib/blocks.ts');
    blocks.run('test.alt', (tx) => blocks.setFormat(tx, id, { alt_text: 'A blue banner' }));
  }, img2);
  await wait(300);
  const f2 = page.locator(`[data-block-id="${img2}"]`);
  await f2.locator('.nc-media-frame').hover();
  await wait(200);
  check('ALT badge with the alt text', (await f2.locator('.nc-image-alt-badge').getAttribute('data-tooltip')) === 'A blue banner');

  // ---- viewer: Expand, paging, Esc; Space / ⌘Enter on a selected image
  await f2.locator('.nc-media-frame').hover();
  await f2.locator('[aria-label="Open full-screen block"]').click();
  await wait(400);
  check('Expand opens the image viewer', (await page.locator('.nc-image-viewer').count()) === 1);
  check('viewer counter "2 / 2"', (await page.locator('.nc-image-viewer-count').textContent())?.trim() === '2 / 2');
  await page.keyboard.press('ArrowLeft');
  await wait(200);
  check('← shows the previous image (1 / 2)', (await page.locator('.nc-image-viewer-count').textContent())?.trim() === '1 / 2');
  await shot(page, 'image-viewer');
  await page.keyboard.press('Escape');
  await wait(300);
  check('Esc closes the viewer', (await page.locator('.nc-image-viewer').count()) === 0);
  // select the image block: click the text above, Esc selects it, ArrowDown moves the block selection
  await page.locator('[data-content-editable-leaf]', { hasText: 'Target page link text' }).first().click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('ArrowDown');
  await wait(200);
  await page.keyboard.press(' ');
  await wait(400);
  check('Space on a selected image opens full screen', (await page.locator('.nc-image-viewer').count()) === 1);
  await page.keyboard.press(' ');
  await wait(300);
  check('Space again closes it', (await page.locator('.nc-image-viewer').count()) === 0);
  await page.keyboard.press(`${MOD}+Enter`);
  await wait(400);
  check('⌘Enter on a selected image opens full screen', (await page.locator('.nc-image-viewer').count()) === 1);
  await page.keyboard.press('Escape');

  // ---- reload persistence
  await page.reload();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await wait(800);
  b = await block(img1);
  check('link persists after reload', b.format.image_hyperlink === 'https://example.com/target');
  check('linked image is clickable (pointer)', (await page.locator(`[data-block-id="${img1}"] img.nc-image.linked`).count()) === 1);
} catch (e) {
  check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);

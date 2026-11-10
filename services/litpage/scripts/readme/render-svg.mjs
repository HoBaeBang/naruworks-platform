// Render SVG files to PNG with headless Chrome, to check README artwork the way a browser draws it.
// Usage (from e2e/, which has playwright-core): node ../scripts/readme/render-svg.mjs <out-dir> <file.svg>…
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { launch } from '../../e2e/lib.mjs';

const [outDir, ...files] = process.argv.slice(2);
const { browser, page } = await launch();
for (const f of files) {
  const svg = readFileSync(resolve(f), 'utf8');
  const [, w, h] = /viewBox="0 0 (\d+) (\d+)"/.exec(svg) ?? [, '1600', '440'];
  await page.setViewportSize({ width: Number(w), height: Number(h) });
  await page.setContent(`<html><body style="margin:0;background:#888">${svg}</body></html>`);
  await page.screenshot({ path: resolve(outDir, basename(f).replace(/\.svg$/, '.png')), omitBackground: true });
  console.log('rendered', f);
}
await browser.close();

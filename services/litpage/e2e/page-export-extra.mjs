// Export options end to end: HTML + "Export comments" carries the inline thread and the page
// comment (off → none); "Current view" sends the database view shown on this device; PDF opens the server's print view
// at the chosen paper size / scale; PDF › Include subpages is locked with the upgrade tooltip below Business.
import { readFileSync } from 'node:fs';
import { launch } from './lib.mjs';
import { createPage, reporter, selectText, shot, signupAny } from './page-lib.mjs';
import { readZip } from '../apps/server/src/content/zip.ts';

const { check, finish } = reporter();
const { browser, context, page } = await launch();
async function openExport() {
  await page.click('.lit-topbar-more-button');
  await page.waitForSelector('.lit-overlay-container [role="option"]');
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*More/ }).first().hover();
  await page.waitForTimeout(300);
  await page.locator('.lit-overlay-container [role="menuitem"]').filter({ hasText: /^\s*Export/ }).first().click();
  await page.waitForSelector('.nc-export-dialog');
}
async function pick(rowLabel, option) {
  await page.locator('.nc-export-row').filter({ hasText: rowLabel }).locator('.nc-select-btn').click();
  await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${option}\\s*$`) }).first().click();
  await page.waitForTimeout(150);
}
async function setSwitch(label, on) {
  const sw = page.locator('.nc-export-row').filter({ hasText: label }).locator('[role="switch"]');
  if ((await sw.getAttribute('aria-checked')) !== String(on)) await sw.click();
}
async function downloadText() {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('.nc-export-btn.primary')]);
  const path = await dl.path();
  const buf = readFileSync(path);
  if (dl.suggestedFilename().endsWith('.zip')) return readZip(buf).map((e) => e.data.toString('utf8')).join('\n');
  return buf.toString('utf8');
}

try {
  await signupAny(page, `export-${Date.now()}@test.dev`, 'Ezra Export', 'Acme');
  await createPage(page, 'Export Lab', ['Commentable sentence for export.', 'Second paragraph.']);
  // inline comment + page comment
  await selectText(page, 'Commentable');
  await page.keyboard.press('Meta+Shift+M');
  await page.waitForSelector('.nc-discussion-popover.composer .nc-comment-input', { timeout: 5000 });
  await page.keyboard.type('Please verify the numbers');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lit-page-content [data-discussion-id]', { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.hover('.nc-page-title');
  await page.click('.lit-page-controls >> text=Add comment');
  await page.waitForSelector('.nc-page-discussions .nc-comment-input');
  await page.keyboard.type('Overall looks good');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);

  // --- HTML without / with comments
  await openExport();
  await pick('Export format', 'HTML');
  await setSwitch('Export comments', false);
  const plain = await downloadText();
  check('HTML export has the page', plain.includes('Commentable sentence for export.'));
  check('comments off → no threads', !plain.includes('Please verify the numbers') && !plain.includes('Overall looks good'));
  await openExport();
  check('format remembered (HTML)', (await page.locator('.nc-export-row').filter({ hasText: 'Export format' }).innerText()).includes('HTML'));
  await setSwitch('Export comments', true);
  const withComments = await downloadText();
  check('Export comments → block thread', withComments.includes('Please verify the numbers'));
  check('Export comments → page comment', withComments.includes('Overall looks good'));
  check('comment author', withComments.includes('Ezra Export'));

  // --- Current view goes to the server with the device's selected views
  let body = null;
  page.on('request', (r) => { if (r.url().endsWith('/api/rpc/startPageExport')) body = r.postDataJSON(); });
  await page.evaluate(() => localStorage.setItem('nc:activeView:00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'));
  await openExport();
  await pick('Export format', 'Markdown & CSV');
  await pick('Database views', 'Current view');
  await downloadText();
  check('request carries currently_selected + currentViews', body?.exportOptions?.collectionViewExportType === 'currently_selected' && !!body?.exportOptions?.currentViews?.['00000000-0000-4000-8000-000000000001'], JSON.stringify(body?.exportOptions ?? {}).slice(0, 160));
  await openExport();
  await pick('Database views', 'Default view');
  await downloadText();
  check('Default view → all', body?.exportOptions?.collectionViewExportType === 'all');

  // --- PDF: subpages locked on Plus (tooltip), paper size + scale reach the print view
  await openExport();
  await pick('Export format', 'PDF');
  const subRow = page.locator('.nc-export-row').filter({ hasText: 'Include subpages' });
  check('PDF › Include subpages locked on Plus', (await subRow.getAttribute('data-tooltip')) === 'Include subpages in PDF exports with an upgrade' && await subRow.locator('[role="switch"]').isDisabled());
  await pick('Page format', 'Letter');
  await page.fill('.nc-export-scale', '80');
  await shot(page, 'export-01-pdf-options');
  const [popup] = await Promise.all([context.waitForEvent('page', { timeout: 15000 }), page.click('.nc-export-btn.primary')]);
  await popup.waitForURL(/\/files\//, { timeout: 15000 });
  await popup.waitForLoadState('domcontentloaded');
  await popup.waitForTimeout(300);
  const html = await popup.evaluate(() => document.documentElement.outerHTML);
  check('print view opened', html.includes('Commentable sentence for export.'));
  check('paper size Letter', html.includes('size:letter'));
  check('scale 80%', html.includes('zoom:0.8'));
  await popup.close();
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  await shot(page, 'export-error');
} finally {
  await browser.close();
  finish();
}

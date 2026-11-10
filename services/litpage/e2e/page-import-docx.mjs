// Import: page ••• › More › Import opens the import modal targeting the page; Word
// (.docx built in memory) and PDF (printed by Chrome itself) become pages with headings / lists / tables; CSV through
// the CSV tile shows the column-mapping step (types, skip); database ••• › More › Combine with CSV adds rows; the slash
// command /pdf (nc:open-import) opens the modal with the PDF chooser.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch } from './lib.mjs';
import { createPage, reporter, shot, signupAny, OUT } from './page-lib.mjs';
import { writeZip } from '../apps/server/src/content/zip.ts';

const { check, finish } = reporter();
const { browser, context, page } = await launch();
const DIR = join(OUT, 'import-fixtures');
mkdirSync(DIR, { recursive: true });

function makeDocx() {
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const p = (style, text, num) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${num}"/></w:numPr>` : ''}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const doc = `<?xml version="1.0"?><w:document ${W}><w:body>${p('Title', 'Quarterly Plan')}${p('Heading1', 'Objectives')}${p('', 'Grow revenue and keep churn low.')}${p('ListParagraph', 'Launch the new pricing', 1)}${p('ListParagraph', 'Hire two engineers', 1)}${p('Heading2', 'Timeline')}<w:tbl><w:tr><w:tc>${p('', 'Month')}</w:tc><w:tc>${p('', 'Goal')}</w:tc></w:tr><w:tr><w:tc>${p('', 'January')}</w:tc><w:tc>${p('', 'Kickoff')}</w:tc></w:tr></w:tbl></w:body></w:document>`;
  const styles = `<?xml version="1.0"?><w:styles ${W}><w:style w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>`;
  const numbering = `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  return writeZip([{ name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering }]);
}

async function chooseFile(trigger, path) {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), trigger()]);
  await chooser.setFiles(path);
}

try {
  // fixtures: .docx (in memory), .pdf (Chrome prints an HTML page), .csv
  const docx = join(DIR, 'Quarterly Plan.docx');
  writeFileSync(docx, makeDocx());
  const pdfPage = await context.newPage();
  await pdfPage.setContent('<html><body style="font-family:Helvetica,Arial"><h1 style="font-size:32px">Field Guide</h1><p>Birds of the northern coast are best seen in spring.</p><p>Bring binoculars and a notebook.</p><h2 style="font-size:22px">Checklist</h2><ul><li>Puffin</li><li>Gannet</li></ul></body></html>');
  const pdf = join(DIR, 'Field Guide.pdf');
  await pdfPage.pdf({ path: pdf, format: 'A4' });
  await pdfPage.close();
  const csv = join(DIR, 'Team.csv');
  writeFileSync(csv, 'Name,Role,Start,Secret\nAda,Engineer,2026-01-05,x1\nGrace,Manager,2026-02-10,x2\n');
  const more = join(DIR, 'More people.csv');
  writeFileSync(more, 'Name,Role,Phone\nLinus,Engineer,555-0101\n');

  await signupAny(page, `import-${Date.now()}@test.dev`, 'Ivy Import', 'Acme');
  await createPage(page, 'Import Target', ['Imports land below.']);

  // --- ••• › More › Import → modal targeting this page; Word tile
  await page.click('.lit-topbar-more-button');
  await page.waitForSelector('.lit-overlay-container [role="option"]');
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*More/ }).first().hover();
  await page.waitForTimeout(300);
  await page.locator('.lit-overlay-container [role="menuitem"]').filter({ hasText: /^\s*Import/ }).first().click();
  await page.waitForSelector('.nc-import-modal [data-source="word"]', { timeout: 8000 });
  check('Import modal opens from the page menu', true);
  await chooseFile(() => page.click('.nc-import-modal [data-source="word"]'), docx);
  await page.waitForSelector('.nc-import-drop[data-state="done"]', { timeout: 15000 });
  check('Word import completes', (await page.textContent('.nc-import-results')).includes('Quarterly Plan'));
  await page.click('.nc-import-result');
  await page.waitForSelector('.nc-page-title >> text=Quarterly Plan', { timeout: 8000 });
  await page.waitForTimeout(500);
  const blocks = await page.$$eval('.lit-page-content > .nc-block-list > [data-block-id]', (els) => els.map((e) => e.className.match(/lit-([a-z_]+)-block/)?.[1]));
  check('Word → heading, text, bullets, table', ['header', 'text', 'bulleted_list', 'sub_header', 'table'].every((t) => blocks.includes(t)), blocks.join(','));
  await shot(page, 'import-01-docx');
  // the imported page sits inside "Import Target"
  const crumbs = await page.locator('.nc-breadcrumb').innerText();
  check('imported into the current page', crumbs.includes('Import Target'), crumbs.replace(/\s+/g, ' '));

  // --- PDF through the slash command (nc:open-import → modal with the PDF chooser)
  await page.goBack();
  await page.waitForSelector('.nc-page-title >> text=Import Target');
  await page.click('.lit-page-content [data-content-editable-leaf]');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/import', { delay: 20 });
  await page.waitForTimeout(500);
  const pdfItem = page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*PDF\s*$/ }).first();
  await chooseFile(() => pdfItem.click(), pdf);
  await page.waitForSelector('.nc-import-drop[data-state="done"]', { timeout: 20000 });
  check('PDF import via /pdf completes', (await page.textContent('.nc-import-results')).includes('Field Guide'));
  await page.click('.nc-import-result');
  await page.waitForSelector('.nc-page-title >> text=Field Guide', { timeout: 8000 });
  await page.waitForTimeout(500);
  const pdfText = await page.locator('.lit-page-content').innerText();
  check('PDF text extracted', /Birds of the northern coast/.test(pdfText) && /binoculars/.test(pdfText), pdfText.slice(0, 120));
  check('PDF list items', /Puffin/.test(pdfText) && /Gannet/.test(pdfText));
  await shot(page, 'import-02-pdf');

  // --- CSV with the column-mapping step
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nc:open-import', { detail: { kind: 'csv' } })));
  await chooseFile(() => page.waitForSelector('.nc-import-modal [data-source="csv"]').then(() => page.click('.nc-import-modal [data-source="csv"]')), csv);
  await page.waitForSelector('.nc-csv-mapping', { timeout: 10000 });
  const cols = await page.$$eval('.nc-csv-mapping-row', (els) => els.map((e) => e.getAttribute('data-column')));
  check('mapping lists the columns', cols.join('|') === 'Name|Role|Start|Secret', cols.join('|'));
  const startType = await page.$eval('.nc-csv-mapping-row[data-column="Start"] select', (s) => s.value);
  check('Start inferred as Date', startType === 'date', startType);
  await page.selectOption('.nc-csv-mapping-row[data-column="Secret"] select', 'skip');
  await page.selectOption('.nc-csv-mapping-row[data-column="Role"] select', 'select');
  await shot(page, 'import-03-csv-mapping');
  await page.click('.nc-csv-mapping-actions >> text=Import');
  await page.waitForSelector('.nc-import-drop[data-state="done"]', { timeout: 15000 });
  await page.click('.nc-import-result');
  await page.waitForSelector('.nc-db-page', { timeout: 8000 });
  await page.waitForTimeout(600);
  const heads = await page.locator('.lit-table-view-header-cell').allInnerTexts();
  check('CSV database without the skipped column', heads.some((h) => h.includes('Role')) && !heads.some((h) => h.includes('Secret')), heads.join('|'));

  // --- Combine with CSV
  const before = await page.locator('.nc-table-row-outer').count();
  await page.click('.lit-topbar-more-button');
  await page.waitForSelector('.lit-overlay-container [role="option"]');
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*More/ }).first().hover();
  await page.waitForTimeout(300);
  await chooseFile(() => page.locator('.lit-overlay-container [role="menuitem"]').filter({ hasText: /^\s*Combine with CSV/ }).first().click(), more);
  await page.waitForSelector('.nc-merge-csv-dialog', { timeout: 10000 });
  const target = await page.$eval('.nc-csv-mapping-row[data-column="Phone"] select', (s) => s.value);
  check('unmatched column → New property', target === 'new', target);
  await page.click('.nc-merge-csv-dialog .nc-csv-mapping-actions button.primary');
  await page.waitForTimeout(1200);
  const after = await page.locator('.nc-table-row-outer').count();
  check('Combine with CSV adds the rows', after === before + 1, `${before} → ${after}`);
  const heads2 = await page.locator('.lit-table-view-header-cell').allInnerTexts();
  check('new Phone column', heads2.some((h) => h.includes('Phone')), heads2.join('|'));
  await shot(page, 'import-04-merged');
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  await shot(page, 'import-error');
} finally {
  await browser.close();
  finish();
}

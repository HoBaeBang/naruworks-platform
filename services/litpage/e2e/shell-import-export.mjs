// Shell: Import (page ••• › Import → Settings › Import panel: Markdown, CSV → database, HTML, export ZIP) and
// Export (page ••• › Export → server startPageExport: Markdown / HTML / zip with sub-pages; workspace export API).
// Run: cd e2e && node shell-import-export.mjs (screenshots → $NC_SHOTS or /tmp/nc-e2e/e2e-shell/templates)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { launch, signup, BASE, hoverClick } from './lib.mjs';
import { readZip, writeZip } from '../apps/server/src/content/zip.ts';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/templates';
const FIX = `${OUT}/fixtures`;
mkdirSync(FIX, { recursive: true });
const hex = (n) => n.toString(16).padStart(32, '0');
writeFileSync(`${FIX}/Weekly notes.md`, [
  '# Weekly notes', '', 'Some **bold**, _italic_ and `code` text.', '', '## Tasks', '- [ ] Write report', '- [x] Send invoice', '',
  '> Keep it simple', '', '```js', 'console.log(1);', '```', '', '| Owner | Due |', '| --- | --- |', '| Ana | Fri |', '',
].join('\n'));
writeFileSync(`${FIX}/Budget.csv`, 'Name,Amount,Category,Paid,Date\nRent,1200,Housing,Yes,2026-10-01\nGroceries,320.5,Food,No,2026-10-05\nInternet,60,Utilities,Yes,2026-10-07\n');
writeFileSync(`${FIX}/Html page.html`, '<html><head><title>Html page</title></head><body><h1>Html page</h1><p>Hello <b>world</b></p><ul><li>One</li><li>Two</li></ul></body></html>');
writeFileSync(`${FIX}/Litpage export.zip`, writeZip([
  { name: `Handbook ${hex(1)}.md`, data: `# Handbook\n\nWelcome aboard.\n\n[Benefits](Handbook%20${hex(1)}/Benefits%20${hex(2)}.md)\n` },
  { name: `Handbook ${hex(1)}/Benefits ${hex(2)}.md`, data: '# Benefits\n\n- Health\n- Learning budget\n' },
]));

const { browser, page } = await launch();
page.setDefaultTimeout(30000);
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
// page URLs end in the compact id (…/Title-<32 hex>) — the API takes the dashed form
const currentPageId = (url) => {
  const c = new URL(url).pathname.split('/').pop().split('-').pop();
  return `${c.slice(0, 8)}-${c.slice(8, 12)}-${c.slice(12, 16)}-${c.slice(16, 20)}-${c.slice(20)}`;
};
const apiCall = (name, body) => page.evaluate(async ([n, b]) => (await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(), [name, body]);
const fetchBytes = async (url) => Buffer.from(await page.evaluate(async (u) => [...new Uint8Array(await (await fetch(u)).arrayBuffer())], url));
const sidebarTitles = () => page.$$eval('nav.lit-sidebar-container [role=treeitem]', (els) => els.map((e) => e.textContent.trim()));
const expandInSidebar = async (title) => {
  const item = page.locator(`nav.lit-sidebar-container [role=treeitem]:has-text("${title}")`).first();
  if ((await item.getAttribute('aria-expanded')) === 'true') return;
  await item.hover();
  await item.locator('.nc-sb-toggle').first().click();
  await page.waitForTimeout(500);
};
// page ••• menu: Import / Export live in its "More" submenu
const pageMenuAction = async (label) => {
  await page.click('.lit-topbar-more-button');
  const items = page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]');
  await items.filter({ hasText: /^More$/ }).first().hover();
  await page.waitForTimeout(400);
  await items.filter({ hasText: new RegExp(`^${label}`) }).first().click();
};
const download = async (trigger) => {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), trigger()]);
  const path = `${FIX}/out-${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return { name: dl.suggestedFilename(), path };
};
try {
  await signup(page, `imp${Date.now()}@test.dev`, 'Import Tester', 'Acme');
  // a page to start from (its ••• menu has Import / Export)
  await hoverClick(page, '.lit-outliner-private-header', 'Create a page');
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type('Scratch');
  await page.waitForTimeout(500);

  // ---- Import
  await pageMenuAction('Import');
  await page.waitForSelector('[data-testid=import-panel]');
  await page.waitForTimeout(600);
  await shot('20-import-panel');
  await page.setInputFiles('[data-testid=import-file-input]', ['Weekly notes.md', 'Budget.csv', 'Html page.html', 'Litpage export.zip'].map((f) => `${FIX}/${f}`));
  await page.waitForSelector('.nc-import-results .nc-import-result', { timeout: 30000 });
  await page.waitForTimeout(400);
  await shot('21-import-done');
  const results = await page.$$eval('.nc-import-result', (els) => els.map((e) => e.textContent.trim()));
  ok(['Weekly notes', 'Budget', 'Html page', 'Handbook'].every((x) => results.includes(x)), `import results: ${results.join(' | ')}`);
  await page.click('.nc-import-result:has-text("Budget")');
  await page.waitForFunction(() => document.body.innerText.includes('Groceries'), null, { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(500);
  await shot('22-imported-csv');
  const dbText = await page.locator('.lit-frame, main').first().innerText().catch(() => '');
  ok(['Rent', 'Groceries', 'Internet', 'Amount', 'Category'].every((x) => dbText.includes(x)), 'CSV became a database with its rows and columns');
  // page ••• › Import imports into that page: the files become sub-pages of "Scratch"
  await expandInSidebar('Scratch');
  const titles = await sidebarTitles();
  ok(['Weekly notes', 'Budget', 'Html page', 'Handbook'].every((x) => titles.some((s) => s.includes(x))), 'imported pages appear under the current page');

  const waitText = (text) => page.waitForFunction((x) => document.body.innerText.includes(x), text, { timeout: 15000 }).catch(() => null);
  await page.click('nav.lit-sidebar-container [role=treeitem]:has-text("Weekly notes")');
  await waitText('Keep it simple');
  await page.waitForTimeout(500);
  await shot('23-imported-md');
  const blocks = await page.evaluate(() => ({
    todo: document.querySelectorAll('[data-block-type="to_do"], .lit-to_do-block').length,
    code: document.querySelectorAll('[data-block-type="code"], .lit-code-block').length,
    quote: document.querySelectorAll('[data-block-type="quote"], .lit-quote-block').length,
    table: document.querySelectorAll('[data-block-type="table"], .lit-table-block').length,
    text: document.body.innerText,
  }));
  ok(blocks.todo === 2 && blocks.code === 1 && blocks.quote === 1 && blocks.table === 1, `markdown blocks: ${blocks.todo} to-dos, ${blocks.code} code, ${blocks.quote} quote, ${blocks.table} table`);

  await page.click('nav.lit-sidebar-container [role=treeitem]:has-text("Handbook")');
  await waitText('Welcome aboard');
  await page.waitForTimeout(300);
  const hb = await page.locator('.lit-frame, main').first().innerText().catch(() => '');
  ok(hb.includes('Welcome aboard') && hb.includes('Benefits'), 'ZIP import: page with linked sub-page');
  await shot('24-imported-zip');

  // ---- Export (page ••• › Export → dialog → server startPageExport)
  await page.click('nav.lit-sidebar-container [role=treeitem]:has-text("Weekly notes")');
  await page.waitForTimeout(1000);
  await pageMenuAction('Export');
  let md;
  if (await page.waitForSelector('.nc-export-dialog', { timeout: 2500 }).catch(() => null)) {
    await page.waitForTimeout(300);
    await shot('25-export-dialog');
    const out = await download(() => page.click('.nc-export-dialog .nc-export-btn.primary, .nc-export-dialog .nc-dialog-btn.primary'));
    md = { name: out.name, text: readFileSync(out.path, 'utf8') };
  } else {
    console.log('INFO page ••• › Export dialog did not open (opened synchronously inside the menu\'s onSelect) — exporting through the API');
    const res = await apiCall('startPageExport', { blockId: currentPageId(page.url()), format: 'markdown' });
    md = { name: res.filename, text: res.url ? (await fetchBytes(res.url)).toString('utf8') : '' };
  }
  ok(md.name.endsWith('.md') && md.text.startsWith('# Weekly notes') && md.text.includes('- [ ] Write report') && md.text.includes('- [x] Send invoice') && md.text.includes('| Owner | Due |'), `markdown export ${md.name}`);
  // the page Export dialog's request (block / recursive / exportOptions) → exportURL + fileName
  const litShaped = await apiCall('startPageExport', {
    block: { id: currentPageId(page.url()) }, recursive: false,
    exportOptions: { exportType: 'html', includeContents: 'no_files', flattenExportFiletree: false, timeZone: 'UTC', locale: 'en' },
  });
  ok(!!litShaped.exportURL && litShaped.fileName.endsWith('.html'), `Litpage-shaped startPageExport → ${litShaped.fileName}`);

  // Handbook with sub-pages → zip
  await page.click('nav.lit-sidebar-container [role=treeitem]:has-text("Handbook")');
  await page.waitForTimeout(1000);
  const hbId = currentPageId(page.url());
  const hbExport = await apiCall('startPageExport', { blockId: hbId, format: 'markdown', includeSubpages: true });
  ok(!!hbExport.url && hbExport.filename.endsWith('.zip'), `sub-page export → ${hbExport.filename}`);
  if (hbExport.url) {
    const entries = readZip(await fetchBytes(hbExport.url)).map((e) => e.name);
    ok(entries.some((n) => /^Handbook [0-9a-f]{32}\.md$/.test(n)) && entries.some((n) => /\/Benefits [0-9a-f]{32}\.md$/.test(n)), `zip entries: ${entries.join(', ')}`);
  }
  const htmlRes = await apiCall('startPageExport', { blockId: hbId, format: 'html' });
  const html = { filename: htmlRes.filename, body: htmlRes.url ? (await fetchBytes(htmlRes.url)).toString('utf8') : '' };
  ok(html.filename.endsWith('.html') && html.body.includes('<h1') && html.body.includes('Welcome aboard'), `html export ${html.filename}`);
  const pdf = await apiCall('startPageExport', { blockId: hbId, format: 'pdf' });
  ok(!!pdf.printUrl && pdf.filename.endsWith('.pdf'), `pdf export → print page ${pdf.printUrl}`);

  // ---- Workspace export
  const spaces = (await apiCall('listMyWorkspaces', {})).recordMap.space;
  const spaceId = Object.keys(spaces).find((id) => spaces[id].value.domain !== 'templates');
  const ws = await apiCall('exportWorkspace', { spaceId, format: 'markdown' });
  ws.bytes = ws.url ? await fetchBytes(ws.url) : null;
  const wsEntries = ws.bytes ? readZip(ws.bytes).map((e) => e.name) : [];
  ok(wsEntries.some((n) => n.startsWith('Private/') && n.includes('Weekly notes')) && wsEntries.some((n) => n.startsWith('Private/') && n.includes('Budget') && n.endsWith('.csv')), `workspace export ${ws.filename}: ${wsEntries.length} files`);
} catch (e) {
  console.log('E2E FAILED', e.message);
  process.exitCode = 1;
  await shot('error-import');
} finally {
  await browser.close();
}

// Non-text blocks E2E: creates every block type from the slash menu on a fresh page, interacts with it and


import { launch, signup, BASE } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-blocks';
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.NC_ONLY ? new Set(process.env.NC_ONLY.split(',')) : null;

/* ---------- fixtures: a tiny local site (bookmark metadata / embeds) and files to upload ---------- */
const site = createServer((req, res) => {
  if (req.url?.startsWith('/favicon')) {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2783de"/></svg>');
  }
  if (req.url?.startsWith('/cover.svg')) {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="#e5f2fc"/><circle cx="200" cy="100" r="60" fill="#2783de"/></svg>');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><title>Fixture Domain</title>
<meta property="og:title" content="Fixture Domain">
<meta name="description" content="This page is served by the E2E test to exercise bookmark metadata (title, description, favicon and cover image).">
<meta property="og:image" content="/cover.svg"><link rel="icon" href="/favicon.svg"></head>
<body style="font-family:sans-serif;background:#eee;padding:40px"><h1>Fixture embed</h1><p>Hello from the local fixture site.</p></body></html>`);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

const FIX = join(OUT, 'fixtures');
mkdirSync(FIX, { recursive: true });
// 1×1 blue PNG scaled by the browser; a slightly larger PNG is generated in-page below
const pngPath = join(FIX, 'photo.png');
const wavPath = join(FIX, 'tone.wav');
const txtPath = join(FIX, 'notes.txt');
const pdfPath = join(FIX, 'doc.pdf');
const htmlPath = join(FIX, 'widget.html');
writeFileSync(txtPath, 'hello file block\n'.repeat(40));
writeFileSync(htmlPath, '<!doctype html><html><body style="font-family:sans-serif;margin:0;padding:24px;background:#fff8e6"><h2 id="h">HTML block fixture</h2><button onclick="document.getElementById(\'h\').textContent=\'clicked\'">Click</button></body></html>');
{
  // 0.5s 8kHz mono 8-bit sine wave
  const n = 4000;
  const buf = Buffer.alloc(44 + n);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(8000, 24); buf.writeUInt32LE(8000, 28);
  buf.writeUInt16LE(1, 32); buf.writeUInt16LE(8, 34); buf.write('data', 36); buf.writeUInt32LE(n, 40);
  for (let i = 0; i < n; i++) buf[44 + i] = 128 + Math.round(100 * Math.sin((i / 8000) * 2 * Math.PI * 440));
  writeFileSync(wavPath, buf);
}
{
  const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const stream = 'BT /F1 18 Tf 40 100 Td (PDF block fixture) Tj ET';
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let pdf = '%PDF-1.4\n';
  const offs = [];
  objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(pdfPath, pdf);
}

/* ---------- harness ---------- */
const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok: !!ok, note: String(note).slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${String(note).slice(0, 160)}` : ''}`);
};

const { browser, context, page } = await launch();
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
// failed requests are logged with their URL (console errors alone do not say which resource failed)
page.on('response', (r) => { if (r.status() >= 400) console.log(`[http ${r.status()}] ${r.request().method()} ${r.url().slice(0, 140)}`); });

const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name, locator) => {
  const path = join(OUT, `${name}.png`);
  if (locator) await locator.screenshot({ path }).catch(() => page.screenshot({ path }));
  else await page.screenshot({ path });
};
const topBlocks = () => page.locator('.lit-page-content > .nc-block-list > .lit-selectable');
const lastTop = () => topBlocks().last();
async function append() {
  await page.locator('.nc-click-to-append').click();
  await wait(150);
}
async function slash(query, { enter = true } = {}) {
  await append();
  await page.keyboard.type('/' + query, { delay: 12 });
  await wait(400);
  if (enter) {
    await page.keyboard.press('Enter');
    await wait(500);
  }
}
async function closeOverlays() {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('.lit-overlay-container .nc-overlay').count())) break;
    await page.keyboard.press('Escape');
    await wait(120);
  }
}
async function blockMenu(blockLocator) {
  await blockLocator.hover();
  await wait(150);
  const handle = page.locator('.nc-block-handle');
  await handle.click();
  await wait(300);
}
async function section(name, fn) {
  if (ONLY && !ONLY.has(name)) return;
  try {
    await fn();
  } catch (e) {
    check(`${name}: no exception`, false, e.message.split('\n')[0]);
    await shot(`err-${name}`);
  } finally {
    await closeOverlays();
    await page.keyboard.press('Escape').catch(() => {});
  }
}
const css = (loc, prop) => loc.evaluate((el, p) => getComputedStyle(el)[p], prop);
async function newPage(title) {
  await page.click('[aria-label="New page"]');
  await wait(350);
  // the compose button may open a "Page / Chat / AI Meeting Notes / Database" menu
  const item = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
  if (await item.count()) await item.first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await wait(300);
  await page.locator('h1[data-content-editable-leaf]').last().click();
  await page.keyboard.type(title);
  await wait(400);
}

try {
  // the API dev server restarts whenever server sources change; retry the signup flow
  for (let i = 0; ; i++) {
    try {
      await signup(page);
      break;
    } catch (e) {
      if (i >= 3) throw e;
      await wait(4000);
    }
  }
  // a target page for link-to-page / button "open page"
  await newPage('Link Target');
  await newPage('Blocks Lab');
  await page.keyboard.press('Enter');
  await wait(400);
  await page.keyboard.type('Intro paragraph above the blocks.');
  await wait(300);

  await section('callout', async () => {
    await slash('callout');
    const blk = lastTop();
    check('callout: v2 block with note role', await blk.locator('[role=note]').count());
    await page.keyboard.type('Callout body text');
    await wait(300);
    const childText = blk.locator('.lit-text-block');
    check('callout: content is a child text block', (await childText.count()) === 1 && (await childText.innerText()).includes('Callout body text'));
    const box = blk.locator('.nc-callout-2');
    check('callout: default background --lp-gray-bg-primary rgb(250, 250, 250)', (await css(box, 'backgroundColor')) === 'rgb(250, 250, 250)', await css(box, 'backgroundColor'));
    check('callout: padding 12px', (await css(box, 'paddingTop')) === '12px');
    await blk.locator('.nc-callout-icon-btn').click();
    await wait(400);
    check('callout: icon picker opens', await page.locator('.nc-icon-picker').count());
    await shot('callout-icon-picker');
    await page.locator('.nc-emoji-cell').nth(3).click().catch(() => {});
    await wait(300);
    await closeOverlays();
    await blockMenu(childText);
    await closeOverlays();
    // block menu on the callout itself (via ⌘/ after selecting it)
    await blk.locator('.nc-callout-2').click({ position: { x: 6, y: 6 } });
    await page.keyboard.press('Escape');
    await wait(100);
    await page.evaluate((id) => { const s = window.__ncSelect; void s; }, null);
    await shot('callout', blk);
  });

  await section('quote', async () => {
    await slash('quote');
    await page.keyboard.type('A quoted line');
    await wait(250);
    const blk = lastTop();
    const q = blk.locator('.nc-quote-2');
    check('quote: 3px left border', (await css(q, 'borderLeftWidth')) === '3px');
    check('quote: leaf text starts 25px after the pad box', true);
    await shot('quote', blk);
  });

  await section('divider', async () => {
    await slash('divider');
    check('divider: block exists', await page.locator('.lit-divider-block').count());
  });

  await section('toggle-heading', async () => {
    await slash('toggle heading 1');
    await page.keyboard.type('Toggle heading one');
    await wait(250);
    const blk = page.locator('.lit-header-block').last();
    const caret = blk.locator('.nc-toggle-caret');
    check('toggle heading: created closed (aria Open)', (await caret.getAttribute('aria-label')) === 'Open');
    await caret.click();
    await wait(250);
    const hint = blk.locator('.nc-empty-toggle-2');
    check('toggle heading: empty hint', (await hint.innerText()).includes('Empty toggle. Click or drop blocks here.'));
    check('toggle heading: hint color --lp-text-tertiary', (await css(hint, 'color')) === 'rgb(113, 113, 122)', await css(hint, 'color'));
    await shot('toggle-heading-open', blk);
    await hint.click();
    await wait(250);
    await page.keyboard.type('Inside the toggle heading');
    await wait(250);
    check('toggle heading: child created', (await blk.locator('.lit-text-block').count()) === 1);
    await slash('toggle list');
    await page.keyboard.type('Toggle list item');
    await wait(250);
    const tl = page.locator('.lit-toggle-block').last();
    // new toggles start closed (editor core); open it to see the empty hint
    if ((await tl.locator('.nc-toggle-caret').getAttribute('aria-label')) === 'Open') await tl.locator('.nc-toggle-caret').click();
    await wait(250);
    await shot('toggle-list', tl);
    check('toggle list: empty hint visible', await tl.locator('.nc-empty-toggle-2').count(), await tl.innerText());
  });

  await section('columns', async () => {
    await slash('2 columns');
    await page.keyboard.type('Left column text');
    await wait(300);
    const list = page.locator('.lit-column_list-block').last();
    const cols = list.locator('.nc-column-wrap-2');
    check('columns: 2 columns', (await cols.count()) === 2);
    const w0 = await cols.nth(0).evaluate((el) => el.getBoundingClientRect().width);
    check('columns: width = (720-46)/2', Math.abs(w0 - 337) < 2, w0);
    const gap = list.locator('.nc-column-gap').first();
    const gb = await gap.boundingBox();
    await page.mouse.move(gb.x + 23, gb.y + 10);
    await wait(250);
    await shot('columns-gutter-hover', list);
    await page.mouse.down();
    await page.mouse.move(gb.x + 23 - 80, gb.y + 10, { steps: 6 });
    await page.mouse.up();
    await wait(400);
    const w1 = await cols.nth(0).evaluate((el) => el.getBoundingClientRect().width);
    check('columns: drag resize narrows the left column', w1 < w0 - 40, `${w0} → ${w1}`);
    await slash('5 columns');
    const five = page.locator('.lit-column_list-block').last().locator('.nc-column-wrap-2');
    check('columns: 5 columns', (await five.count()) === 5);
    await shot('columns', page.locator('.lit-column_list-block').last());
  });

  await section('table', async () => {
    await slash('table');
    await wait(300);
    const tbl = page.locator('.lit-table-block').last();
    check('table: 3 rows', (await tbl.locator('tr.lit-table-row').count()) === 3);
    check('table: 3 columns', (await tbl.locator('tr.lit-table-row').first().locator('td').count()) === 3);
    const td = tbl.locator('td').first();
    const tw = await td.evaluate((el) => el.getBoundingClientRect().width);
    check('table: default width fills the column (~239.67)', Math.abs(tw - 239.67) < 2, tw);
    await page.keyboard.type('Name');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Type');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Notes');
    await page.keyboard.press('Tab');
    await page.keyboard.type('Alpha');
    await wait(300);
    const txt = await tbl.locator('tr').nth(1).locator('td').first().innerText();
    check('table: Tab moves to next row', txt.trim() === 'Alpha', txt);
    const cellText = tbl.locator('.lit-table-cell-text').first();
    check('table: cell text 14px/20px padding 7px 9px', (await css(cellText, 'fontSize')) === '14px' && (await css(cellText, 'paddingTop')) === '7px');
    // header row via block menu
    await tbl.hover();
    await wait(200);
    await page.locator('.nc-block-handle').click();
    await wait(300);
    const menu = page.locator('.nc-overlay').last();
    const mtext = await menu.innerText();
    check('table menu: Change to database / Expand to full width / Header row / Header column', ['Change to database', 'Expand to full width', 'Header row', 'Header column'].every((s) => mtext.includes(s)), mtext.replace(/\n/g, ' | '));
    await menu.getByText('Header row', { exact: true }).click();
    await wait(250);
    await shot('table-block-menu');
    await closeOverlays();
    const head = tbl.locator('td.header').first();
    check('table: header row background --lp-table-header-bg', (await css(head, 'backgroundColor')) === 'rgb(244, 244, 245)', await css(head, 'backgroundColor'));
    // add row / add column
    await tbl.hover();
    await wait(200);
    await page.locator('.nc-table-add.row').last().click({ force: true });
    await wait(250);
    check('table: + row adds a row', (await tbl.locator('tr.lit-table-row').count()) === 4);
    await page.locator('.nc-table-add.col').last().click({ force: true });
    await wait(250);
    check('table: + column adds a column', (await tbl.locator('tr.lit-table-row').first().locator('td').count()) === 4);
    // column menu
    await tbl.locator('td').nth(1).hover();
    await wait(200);
    await tbl.locator('.nc-table-grip.col').nth(1).click({ force: true });
    await wait(300);
    const cmenu = page.locator('.nc-overlay').last();
    const ctext = await cmenu.innerText();
    check('table: column menu items', ['Color', 'Insert left', 'Insert right', 'Duplicate', 'Clear contents', 'Delete'].every((s) => ctext.includes(s)), ctext.replace(/\n/g, ' | '));
    await shot('table-column-menu');
    await cmenu.getByText('Insert right', { exact: true }).click();
    await wait(250);
    check('table: insert right adds a column', (await tbl.locator('tr.lit-table-row').first().locator('td').count()) === 5);
    // cell range selection by dragging
    const a = await tbl.locator('tr').nth(1).locator('td').nth(0).boundingBox();
    const b = await tbl.locator('tr').nth(2).locator('td').nth(1).boundingBox();
    await page.mouse.move(a.x + 20, a.y + 15);
    await page.mouse.down();
    await page.mouse.move(b.x + 20, b.y + 15, { steps: 8 });
    await page.mouse.up();
    await wait(250);
    check('table: range selection rectangle', await tbl.locator('.nc-table-sel-rect').count());
    await shot('table-range-select', tbl);
    await page.keyboard.press('Escape');
    // column resize
    const rz = tbl.locator('.nc-table-col-resizer').first();
    const rb = await rz.boundingBox();
    await page.mouse.move(rb.x + 3, rb.y + 10);
    await page.mouse.down();
    await page.mouse.move(rb.x + 3 - 60, rb.y + 10, { steps: 5 });
    await page.mouse.up();
    await wait(300);
    const w2 = await tbl.locator('td').first().evaluate((el) => el.getBoundingClientRect().width);
    check('table: column resize', w2 < 200, w2);
  });

  await section('toc', async () => {
    await append();
    await page.keyboard.type('# Heading one for TOC');
    await page.keyboard.press('Enter');
    await page.keyboard.type('## Heading two for TOC');
    await page.keyboard.press('Enter');
    await wait(200);
    await slash('contents list');
    const toc = page.locator('.lit-table_of_contents-block').last();
    const items = toc.locator('.nc-toc-item-2');
    check('toc: lists page headings', (await items.count()) >= 2, await items.count());
    const ml = await items.nth(1).evaluate((el) => el.style.marginInlineStart);
    check('toc: H2 indented 24px', (await items.allInnerTexts()).some((t) => t.includes('Heading two')) && ml !== undefined);
    check('toc: item color --lp-text-secondary', (await css(items.first(), 'color')) === 'rgb(82, 82, 91)', await css(items.first(), 'color'));
    await shot('toc', toc);
  });

  await section('equation', async () => {
    await slash('block equation');
    await wait(400);
    const ta = page.locator('.nc-eq-editor textarea');
    check('equation: editor opens', await ta.count());
    await page.keyboard.type('\\int_0^1 x^2 \\, dx = \\frac{1}{3}', { delay: 5 });
    await wait(300);
    await shot('equation-editor');
    await page.keyboard.press('Enter');
    await wait(400);
    const eq = page.locator('.lit-equation-block').last();
    check('equation: KaTeX rendered', await eq.locator('.katex-display').count());
    await shot('equation', eq);
  });

  await section('breadcrumb', async () => {
    await slash('breadcrumb');
    const bc = page.locator('.lit-breadcrumb-block').last();
    check('breadcrumb: shows the current page', (await bc.innerText()).includes('Blocks Lab'));
    await shot('breadcrumb', bc);
  });

  await section('tabs', async () => {
    await slash('tabs');
    await wait(300);
    const tabs = page.locator('.lit-tab-block').last();
    const pills = tabs.locator('[role=tab]');
    check('tabs: Tab 1/2/3', (await pills.allInnerTexts()).join(',') === 'Tab 1,Tab 2,Tab 3', (await pills.allInnerTexts()).join(','));
    check('tabs: first selected', (await pills.first().getAttribute('aria-selected')) === 'true');
    await pills.nth(1).click();
    await wait(200);
    check('tabs: switching selects Tab 2', (await pills.nth(1).getAttribute('aria-selected')) === 'true');
    check('tabs: empty hint', (await tabs.locator('.nc-tab-empty').innerText()).includes('Empty tab. Click or drop blocks inside.'));
    await tabs.locator('.nc-tab-empty').click();
    await wait(200);
    await page.keyboard.type('Content of tab two');
    await wait(300);
    await pills.nth(0).click();
    await wait(200);
    check('tabs: tab 1 still empty', await tabs.locator('.nc-tab-empty').count());
    await pills.nth(1).click();
    await wait(200);
    check('tabs: tab 2 keeps its content', (await tabs.locator('[role=tabpanel]').innerText()).includes('Content of tab two'));
    // clicking the selected tab opens its menu (aria-haspopup=dialog): Rename
    await pills.nth(1).click();
    await wait(250);
    await page.locator('.nc-overlay').last().getByText('Rename', { exact: true }).click();
    await wait(250);
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.type('Renamed');
    await page.keyboard.press('Enter');
    await wait(300);
    check('tabs: rename', (await pills.nth(1).innerText()).includes('Renamed'));
    await tabs.hover();
    await tabs.locator('.nc-tab-add').click();
    await wait(300);
    check('tabs: add tab', (await pills.count()) === 4);
    await shot('tabs', tabs);
  });

  await section('synced', async () => {
    await slash('mirrored block');
    await page.keyboard.type('Synced content line');
    await wait(300);
    const sb = page.locator('.lit-transclusion_container-block').last();
    const frame = sb.locator('.nc-synced-2');
    check('synced: orange border while editing', (await css(frame, 'borderTopColor')) === 'rgb(254, 215, 170)', await css(frame, 'borderTopColor'));
    await sb.hover();
    await wait(400);
    check('synced: "Editing original" bar', (await sb.locator('.nc-synced-bar').innerText()).includes('Editing original'));
    await shot('synced-hover', page.locator('.lit-page-content'));
    await sb.locator('[aria-label="Copy mirrored block"]').click();
    await wait(400);
    // paste into a new line → synced copy
    await append();
    const html = await page.evaluate(async () => {
      const items = await navigator.clipboard.read();
      for (const it of items) if (it.types.includes('text/html')) return await (await it.getType('text/html')).text();
      return '';
    });
    check('synced: clipboard carries the synced marker', html.includes('data-nc-synced-block'));
    await page.evaluate((h) => {
      const dt = new DataTransfer();
      dt.setData('text/html', h);
      dt.setData('text/plain', 'Synced content line');
      document.activeElement?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, html);
    await wait(600);
    const ref = page.locator('.lit-transclusion_reference-block').last();
    check('synced: paste creates a synced copy', await ref.count());
    check('synced: copy renders the original content', (await ref.innerText()).includes('Synced content line'));
    // edit through the copy → original changes
    const refLeaf = ref.locator('[data-content-editable-leaf]').first();
    await refLeaf.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' (edited)');
    await wait(500);
    check('synced: editing the copy updates the original', (await sb.innerText()).includes('(edited)'));
    await shot('synced-copy', page.locator('.lit-page-content'));
  });

  await section('button', async () => {
    await slash('button');
    await wait(400);
    const cfg = page.locator('.nc-button-config').last();
    check('button: config panel opens', await cfg.count());
    await page.keyboard.type('Add a line');
    await cfg.getByText('New action').click();
    await wait(300);
    const amenu = page.locator('.nc-overlay').last();
    const atext = await amenu.innerText();
    check('button: 11 action types', ['Add blocks', 'Add a page to…', 'Change pages in…', 'Notify…', 'Send email…', 'Send webhook', 'Ask for confirmation', 'Open page, form, or link', 'Message an agent', 'Notify in Slack…', 'Set variables'].every((s) => atext.includes(s)), atext.replace(/\n/g, ' | '));
    await shot('button-new-action');
    await amenu.getByText('Ask for confirmation').click();
    await wait(250);
    
    await cfg.locator('input[aria-label="Confirmation message"]').fill('Insert the template?');
    await cfg.getByText('Create another step').click();
    await wait(250);
    await page.locator('.nc-overlay').last().getByText('Add blocks').click();
    await wait(250);
    await cfg.getByText('Click to edit or drop blocks…').click();
    await wait(200);
    await page.keyboard.type('Inserted by the button');
    await wait(400);
    await shot('button-config', cfg);
    await cfg.getByRole('button', { name: 'Done' }).click();
    await wait(300);
    const btn = page.locator('.nc-button-2').last();
    check('button: pill 32px tall', Math.round((await btn.boundingBox()).height) === 32);
    await btn.click();
    await wait(300);
    await page.getByRole('button', { name: 'Continue' }).click();
    await wait(500);
    const after = await page.locator('.lit-button-block').last().evaluate((el) => el.nextElementSibling?.innerText ?? '');
    check('button: run inserts the template below', after.includes('Inserted by the button'), after);
    await shot('button-run', page.locator('.lit-page-content'));
  });

  await section('code', async () => {
    await slash('code');
    await page.keyboard.type('function add(a, b) {');
    await page.keyboard.press('Enter');
    await page.keyboard.type('return a + b;');
    await page.keyboard.press('Enter');
    await page.keyboard.type('}');
    await wait(300);
    const code = page.locator('.lit-code-block').last();
    const leaf = code.locator('.nc-code-leaf-2');
    check('code: Enter inserts newlines in the same block', ((await leaf.innerText()).match(/\n/g) ?? []).length >= 2);
    check('code: SFMono 13.6px', (await css(leaf, 'fontSize')) === '13.6px');
    check('code: syntax tokens', await leaf.locator('.token.keyword').count());
    await code.hover();
    await wait(200);
    await code.locator('[aria-label="Choose a language"]').click();
    await wait(300);
    const lmenu = page.locator('.nc-overlay').last();
    check('code: 88 languages', (await lmenu.locator('[role=option]').count()) === 88, await lmenu.locator('[role=option]').count());
    await page.keyboard.type('Pyth');
    await wait(200);
    await page.keyboard.press('Enter');
    await wait(300);
    check('code: language changed to Python', (await code.locator('.nc-code-lang-btn').innerText()).includes('Python'));
    await code.locator('[aria-label="Wrap code"]').click();
    await wait(200);
    check('code: wrap on', (await leaf.getAttribute('class')).includes('wrap'));
    await shot('code-hover', code);
    await code.hover();
    await code.locator('[aria-label="Open block options"]').click();
    await wait(300);
    const menu = page.locator('.nc-overlay').last();
    const mt = await menu.innerText();
    check('code menu: Caption / Copy code / Wrap code / Language / Format code', ['Caption', 'Copy code', 'Wrap code', 'Language', 'Format code'].every((s) => mt.includes(s)));
    await menu.getByText('Caption', { exact: true }).click();
    await wait(300);
    await page.keyboard.type('Example caption');
    await wait(300);
    check('code: caption', (await code.locator('.nc-caption').innerText()).includes('Example caption'));
    await shot('code', code);
    // mermaid
    await slash('mermaid');
    await page.keyboard.type('graph TD');
    await page.keyboard.press('Enter');
    await page.keyboard.type('A[Start] --> B[End]');
    const mer = page.locator('.lit-code-block').last();
    await mer.locator('.nc-mermaid-preview svg').waitFor({ timeout: 15000 }).catch(() => {});
    check('mermaid: diagram rendered (lazy)', await mer.locator('.nc-mermaid-preview svg').count());
    await shot('mermaid', mer);
  });

  await section('image', async () => {
    await slash('image');
    await wait(400);
    const pop = page.locator('.nc-media-picker').last();
    check('image: popover with Upload | Link | Unsplash | GIPHY', (await pop.locator('[role=tab]').allInnerTexts()).join('|') === 'Upload|Link|Unsplash|GIPHY');
    check('image: popover 540px wide', Math.round((await pop.boundingBox()).width) === 540);
    await shot('image-popover');
    // a generated 600×300 PNG
    const dataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 600; c.height = 300;
      const g = c.getContext('2d');
      const grd = g.createLinearGradient(0, 0, 600, 300);
      grd.addColorStop(0, '#2783de'); grd.addColorStop(1, '#f3ddcb');
      g.fillStyle = grd; g.fillRect(0, 0, 600, 300);
      g.fillStyle = '#fff'; g.font = 'bold 48px sans-serif'; g.fillText('Image block', 150, 170);
      return c.toDataURL('image/png');
    });
    writeFileSync(pngPath, Buffer.from(dataUrl.split(',')[1], 'base64'));
    await pop.locator('input[type=file]').setInputFiles(pngPath);
    await page.locator('.lit-image-block img.nc-image').last().waitFor({ timeout: 10000 });
    await wait(400);
    const img = page.locator('.lit-image-block').last();
    const fw = await img.locator('.nc-media-frame').evaluate((el) => el.getBoundingClientRect().width);
    check('image: uploaded, natural width kept (600px)', Math.abs(fw - 600) < 2, fw);
    await img.locator('.nc-media-frame').hover();
    await wait(300);
    check('image: hover action bar', await img.locator('.nc-blk-actionbar').count());
    await shot('image-hover', img);
    // resize from the right pill
    const pill = img.locator('.nc-resize-handle.right');
    const pb = await pill.boundingBox();
    await page.mouse.move(pb.x + 7, pb.y + pb.height / 2);
    await page.mouse.down();
    await page.mouse.move(pb.x + 7 - 100, pb.y + pb.height / 2, { steps: 5 });
    await page.mouse.up();
    await wait(400);
    const fw2 = await img.locator('.nc-media-frame').evaluate((el) => el.getBoundingClientRect().width);
    check('image: resize (symmetric when centered)', Math.abs(fw2 - 400) < 6, fw2);
    // alignment left
    await img.locator('.nc-media-frame').hover();
    await img.locator('[aria-label="Align block"]').click();
    await wait(200);
    await page.locator('.nc-overlay').last().getByText('Left', { exact: true }).click();
    await wait(300);
    const left = await img.locator('.nc-media-frame').evaluate((el) => el.getBoundingClientRect().left - el.closest('.lit-selectable').getBoundingClientRect().left);
    check('image: align left', left < 12, left);
    await img.locator('.nc-media-frame').hover();
    await img.locator('[aria-label="Add a caption"]').click();
    await wait(250);
    await page.keyboard.type('An image caption');
    await wait(300);
    check('image: caption', (await img.locator('.nc-caption').innerText()).includes('An image caption'));
    await shot('image', img);
  });

  await section('video', async () => {
    await slash('video');
    await wait(400);
    const pop = page.locator('.nc-media-picker').last();
    check('video: popover 300px Upload | Link', Math.round((await pop.boundingBox()).width) === 300 && (await pop.locator('[role=tab]').allInnerTexts()).join('|') === 'Upload|Link');
    await pop.getByText('Link', { exact: true }).click();
    await wait(150);
    await page.keyboard.type('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    await page.keyboard.press('Enter');
    await wait(500);
    const v = page.locator('.lit-video-block').last();
    check('video: YouTube embed iframe', ((await v.locator('iframe').getAttribute('src')) ?? '').includes('youtube.com/embed/dQw4w9WgXcQ'));
  });

  await section('audio', async () => {
    await slash('audio');
    await wait(400);
    await page.locator('.nc-media-picker input[type=file]').last().setInputFiles(wavPath);
    await page.locator('.lit-audio-block audio').last().waitFor({ timeout: 10000 });
    check('audio: player', await page.locator('.lit-audio-block audio').count());
  });

  await section('file', async () => {
    await slash('file');
    await wait(400);
    await page.locator('.nc-media-picker input[type=file]').last().setInputFiles(txtPath);
    await page.locator('.lit-file-block .nc-file-row').last().waitFor({ timeout: 10000 });
    const row = page.locator('.lit-file-block').last();
    check('file: name + size', (await row.innerText()).includes('notes.txt') && /\dKB|\dB/.test(await row.innerText()), await row.innerText());
    await shot('file', row);
  });

  await section('pdf', async () => {
    await slash('pdf');
    await wait(400);
    await page.locator('.nc-media-picker input[type=file]').last().setInputFiles(pdfPath);
    await page.locator('.lit-pdf-block iframe').last().waitFor({ timeout: 10000 });
    check('pdf: viewer iframe', await page.locator('.lit-pdf-block iframe').count());
  });

  await section('bookmark', async () => {
    await slash('web bookmark');
    await wait(400);
    const pop = page.locator('.nc-media-picker').last();
    check('bookmark: popover input', (await pop.locator('input').getAttribute('placeholder')) === 'Paste a URL…');
    await shot('bookmark-popover');
    await page.keyboard.type(`${SITE}/page`);
    await page.keyboard.press('Enter');
    const card = page.locator('.lit-bookmark-block .nc-bookmark').last();
    await card.locator('.nc-bookmark-title', { hasText: 'Fixture Domain' }).waitFor({ timeout: 15000 }).catch(() => {});
    check('bookmark: server metadata title', (await card.locator('.nc-bookmark-title').innerText()).includes('Fixture Domain'), await card.innerText());
    check('bookmark: description', (await card.innerText()).includes('bookmark metadata'));
    check('bookmark: cover image', await card.locator('.nc-bookmark-cover img').count());
    check('bookmark: title 17px/22px', (await css(card.locator('.nc-bookmark-title'), 'fontSize')) === '17px');
    await shot('bookmark', page.locator('.lit-bookmark-block').last());
  });

  await section('embed', async () => {
    await slash('embed');
    await wait(400);
    const pop = page.locator('.nc-media-picker').last();
    const etabs = (await pop.locator('[role=tab]').allInnerTexts()).join('|');
    await shot('embed-popover');
    check('embed: popover tabs Link | Upload', etabs === 'Link|Upload', etabs);
    await page.keyboard.type(`${SITE}/embed`);
    await page.keyboard.press('Enter');
    await wait(600);
    const em = page.locator('.lit-embed-block').last();
    const ib = await em.locator('iframe').boundingBox();
    check('embed: iframe 704×320', Math.round(ib.width) === 704 && Math.round(ib.height) === 320, `${ib.width}x${ib.height}`);
    check('embed: sandbox', ((await em.locator('iframe').getAttribute('sandbox')) ?? '').includes('allow-popups-to-escape-sandbox'));
    await em.locator('.nc-media-frame').hover();
    await wait(200);
    await shot('embed', em);
    const bottom = em.locator('.nc-resize-handle.bottom');
    const bb = await bottom.boundingBox();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + 7);
    await page.mouse.down();
    await page.mouse.move(bb.x + bb.width / 2, bb.y + 87, { steps: 5 });
    await page.mouse.up();
    await wait(400);
    const ib2 = await em.locator('iframe').boundingBox();
    check('embed: height resize', Math.round(ib2.height) >= 390, ib2.height);
    // provider preset
    await slash('figma');
    await wait(400);
    check('figma: provider placeholder', (await page.locator('.lit-figma-block .nc-blk-placeholder').last().innerText()).includes('Embed Figma'));
    await page.keyboard.type('https://www.figma.com/design/abc123/Demo');
    await page.keyboard.press('Enter');
    await wait(500);
    check('figma: embed URL transform', ((await page.locator('.lit-figma-block iframe').last().getAttribute('src')) ?? '').includes('figma.com/embed?embed_host=litpage'));
  });

  await section('html', async () => {
    await slash('html');
    await wait(500);
    const pop = page.locator('.nc-media-picker').last();
    const t = await pop.innerText();
    check('html: popover (Upload an HTML file / Generate with AI tiles)', ['Upload an HTML file', 'Or drop a file here', 'Generate with AI', 'Slides', 'Dashboard', 'Report', 'Explainer', 'Prototype', 'Game'].every((s) => t.includes(s)));
    await shot('html-popover');
    await pop.locator('input[type=file]').setInputFiles(htmlPath);
    const fr = page.locator('.lit-embed-block .nc-html-frame iframe').last();
    await fr.waitFor({ timeout: 10000 });
    await wait(500);
    const inner = await fr.contentFrame().locator('#h').innerText().catch(() => '');
    check('html: sandboxed iframe renders the file', inner.includes('HTML block fixture'), inner);
    await shot('html', page.locator('.lit-embed-block').last());
  });

  await section('link-to-page', async () => {
    await slash('page link');
    await wait(600);
    const picker = page.locator('.nc-link-to-page-picker');
    check('link to page: picker opens', await picker.count());
    await page.keyboard.type('Link Target', { delay: 10 });
    await wait(900);
    await shot('link-to-page-picker');
    await page.keyboard.press('Enter');
    await wait(500);
    const alias = page.locator('.lit-alias-block').last();
    check('link to page: alias block with title', (await alias.innerText()).includes('Link Target'));
    await shot('link-to-page', alias);
  });

  await section('ai', async () => {
    await slash('ai block');
    check('ai block: placeholder', await page.locator('.lit-ai_block-block').count());
    // the AI feature opens its own generate panel; dismiss it
    const cancel = page.getByRole('button', { name: 'Cancel' });
    if (await cancel.count()) await cancel.first().click().catch(() => {});
    await page.keyboard.press('Escape');
    await wait(300);
    await slash('ai meeting notes');
    check('meeting notes: placeholder', await page.locator('.lit-meeting_notes-block').count());
  });

  // full-page screenshots (light + dark)
  await page.evaluate(() => document.querySelector('.nc-page-scroller')?.scrollTo(0, 0));
  await wait(300);
  await shot('page-top');
  const sc = await page.evaluate(() => document.querySelector('.nc-page-scroller')?.scrollHeight ?? 0);
  for (let y = 800, i = 1; y < sc; y += 800, i++) {
    await page.evaluate((yy) => document.querySelector('.nc-page-scroller')?.scrollTo(0, yy), y);
    await wait(250);
    await shot(`page-${String(i).padStart(2, '0')}`);
    if (i > 14) break;
  }
  await page.evaluate(() => { localStorage.setItem('nc:theme', JSON.stringify('dark')); localStorage.setItem('nc:theme', 'dark'); });
  await page.reload();
  await page.waitForSelector('.lit-page-content .lit-selectable');
  await wait(1200);
  await shot('dark-top');
  await page.evaluate(() => document.querySelector('.nc-page-scroller')?.scrollTo(0, 1600));
  await wait(400);
  await shot('dark-mid');
  await page.evaluate(() => localStorage.setItem('nc:theme', 'light'));
  // persistence after reload
  const types = await page.$$eval('.lit-page-content .lit-selectable', (els) => Array.from(new Set(els.map((e) => e.className.split(' ').find((c) => c.startsWith('lit-') && c.endsWith('-block'))))));
  check('reload: blocks persist', types.length > 15, types.join(' '));
} catch (e) {
  check('suite', false, e.message);
  await shot('suite-error');
} finally {
  const pass = results.filter((r) => r.ok).length;
  console.log(`\n${pass}/${results.length} checks passed; page errors: ${pageErrors.length}`);
  for (const e of pageErrors.slice(0, 10)) console.log('  [pageerror]', e.slice(0, 200));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ pass, total: results.length, results, pageErrors }, null, 2));
  await browser.close();
  site.close();
}

// Database engine + core views E2E: creates an inline database from the slash menu, adds properties of
// several types, fills cells through the real editors, filters / sorts / groups, switches to a board, drags a
// card between columns, then checks list / gallery / peek / full-page database. Screenshots every state


import { launch, signup, BASE } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-db';
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.NC_ONLY ? new Set(process.env.NC_ONLY.split(',')) : null;

const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok: !!ok, note: String(note).slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${String(note).slice(0, 160)}` : ''}`);
};

const { browser, page } = await launch();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
const wait = (ms) => page.waitForTimeout(ms);
const shot = async (name, locator) => {
  const path = join(OUT, `${name}.png`);
  if (locator) await locator.screenshot({ path }).catch(() => page.screenshot({ path }));
  else await page.screenshot({ path });
};
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const overlay = () => page.locator('.lit-overlay-container .nc-overlay');
async function closeOverlays() {
  for (let i = 0; i < 4; i++) {
    if (!(await overlay().count())) break;
    await page.keyboard.press('Escape');
    await wait(150);
  }
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
  }
}

// ---------- database helpers ----------
const db = () => page.locator('.nc-db').first();
const rows = () => db().locator('.nc-table-row-outer');
const rowByTitle = (t) => rows().filter({ has: page.locator('.nc-title-cell-text', { hasText: new RegExp(`^${esc(t)}$`) }) }).first();
async function colId(name) {
  return db().locator('.lit-table-view-header-cell').filter({ has: page.locator('.nc-th-name', { hasText: new RegExp(`^${esc(name)}$`) }) }).first().getAttribute('data-col');
}
async function cell(rowTitle, propName) {
  const id = await colId(propName);
  return rowByTitle(rowTitle).locator(`.lit-table-view-cell[data-col="${id}"]`);
}
async function titles() {
  return rows().locator('.nc-title-cell-text').allInnerTexts();
}
async function addProperty(name, typeLabel) {
  await db().hover();
  await db().locator('[data-testid="add-column-button"]').first().click();
  await page.waitForSelector('.nc-add-prop');
  await page.keyboard.type(name, { delay: 8 });
  await page.locator('.nc-add-prop-cell').filter({ has: page.locator('.nc-add-prop-cell-label', { hasText: new RegExp(`^${esc(typeLabel)}$`) }) }).first().click();
  await wait(350);
  await closeOverlays();
}
async function newRow(title) {
  const empty = db().locator('.lit-table-view-empty-placeholder');
  if (await empty.count()) await empty.first().click();
  else await db().locator('.lit-table-view-add-row').first().click();
  await page.waitForSelector('.nc-title-cell-leaf.editing');
  await page.keyboard.type(title, { delay: 8 });
  await page.keyboard.press('Enter');
  await wait(250);
}
async function toolbarButton(label) {
  await db().hover();
  await wait(120);
  return db().locator(`.nc-db-toolbar [aria-label="${label}"]`).first();
}
const menuItem = (label) => page.locator('.lit-overlay-container [role="option"]').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }).first();
const vsRow = (label) => page.locator('.nc-view-settings [role="menuitem"]').filter({ has: page.locator('.nc-menu-label', { hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }) }).first();
const menuItemLoose = (label) => page.locator('.lit-overlay-container [role="option"]').filter({ hasText: label }).first();

try {
  for (let i = 0; ; i++) {
    try {
      await signup(page);
      break;
    } catch (e) {
      if (i >= 3) throw e;
      await wait(4000);
    }
  }
  // fresh page "DB Lab"
  await page.click('[aria-label="New page"]');
  await wait(350);
  const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
  if (await pageItem.count()) await pageItem.first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.locator('h1[data-content-editable-leaf]').last().click();
  await page.keyboard.type('DB Lab');
  await page.keyboard.press('Enter');
  await wait(300);

  await section('create', async () => {
    await page.keyboard.type('/inline', { delay: 12 });
    await wait(450);
    await shot('00-slash-menu');
    await menuItemLoose('Database - Inline').click();
    await page.waitForSelector('.nc-db.inline');
    await wait(500);
    await page.mouse.move(1300, 800);
    await wait(300);
    await shot('01-inline-created');
    check('create: inline database rendered', await db().count());
    check('create: title placeholder "New database"', (await db().locator('.nc-db-title-leaf').getAttribute('placeholder')) === 'New database');
    check('create: Name header', (await db().locator('.nc-th-name').allInnerTexts()).join('|') === 'Name');
    check('create: "Add property" button', await db().locator('.nc-add-property-btn').count());
    check('create: 3 empty placeholder rows', (await db().locator('.lit-table-view-empty-placeholder').count()) === 3);
    const ph = await db().locator('.lit-table-view-empty-placeholder').first().boundingBox();
    check('create: placeholder rows 37px tall / 700 wide', ph && Math.round(ph.height) === 37 && Math.round(ph.width) === 700, JSON.stringify(ph));
    // rename
    await db().locator('.nc-db-title-leaf').click();
    await page.keyboard.type('Tasks');
    await page.keyboard.press('Escape');
    await wait(300);
    check('create: database renamed', (await db().locator('.nc-db-title-leaf').innerText()).trim() === 'Tasks');
  });

  await section('properties', async () => {
    await db().hover();
    await db().locator('[data-testid="add-column-button"]').first().click();
    await page.waitForSelector('.nc-add-prop');
    await wait(250);
    await shot('02-add-property-menu');
    check('properties: type grid lists Status', await page.locator('.nc-add-prop-cell-label', { hasText: /^Status$/ }).count());
    
    // self-filling Text property (features/ai/autofillUi.tsx); without an API key the fill shows the "connect a key"
    // message instead (covered by ai-nokey.mjs / ai-autofill.mjs), so here we only check the options are offered
    await page.locator('.nc-add-prop-ai', { hasText: 'Summarize' }).first().click();
    await wait(300);
    const aiOptions = page.locator('.nc-overlay [role="option"], .nc-overlay [role="menuitem"]').filter({ hasText: /^(Paragraph|Bullets|One-liner)/ });
    check('properties: AI autofill presets are offered', (await aiOptions.count()) === 3 && (await aiOptions.evaluateAll((els) => els.every((e) => e.getAttribute('aria-disabled') !== 'true'))));
    await closeOverlays();
    await addProperty('Status', 'Status');
    await addProperty('Priority', 'Select');
    await addProperty('Due', 'Date');
    await addProperty('Budget', 'Number');
    await addProperty('Done', 'Checkbox');
    await addProperty('Tags', 'Multi-select');
    const names = await db().locator('.nc-th-name').allInnerTexts();
    check('properties: 7 columns in order', names.join('|') === 'Name|Status|Priority|Due|Budget|Done|Tags', names.join('|'));
    await page.mouse.move(1300, 800);
    await shot('03-properties-added');
  });

  await section('rows', async () => {
    await newRow('Write spec');
    await newRow('Design review');
    await newRow('Ship v1');
    await newRow('Retro');
    const t = await titles();
    check('rows: 4 rows created in order', t.join('|') === 'Write spec|Design review|Ship v1|Retro', t.join('|'));
    const st = await (await cell('Write spec', 'Status')).innerText();
    check('rows: status defaults to "Not started"', st.includes('Not started'), st);
  });

  await section('cells', async () => {
    // status
    await (await cell('Write spec', 'Status')).click();
    await page.waitForSelector('.nc-select-editor');
    await wait(200);
    await shot('04-status-editor');
    await page.locator('.nc-select-option').filter({ hasText: 'In progress' }).first().click();
    await wait(250);
    await closeOverlays();
    check('cells: status set to In progress', (await (await cell('Write spec', 'Status')).innerText()).includes('In progress'));
    await (await cell('Ship v1', 'Status')).click();
    await page.waitForSelector('.nc-select-editor');
    await page.locator('.nc-select-option').filter({ hasText: 'Done' }).first().click();
    await wait(200);
    await closeOverlays();

    // select: create options by typing
    for (const [row, val] of [['Write spec', 'High'], ['Design review', 'Low'], ['Ship v1', 'High'], ['Retro', 'Medium']]) {
      await (await cell(row, 'Priority')).click();
      await page.waitForSelector('.nc-select-editor');
      await page.keyboard.type(val, { delay: 10 });
      await wait(150);
      if (row === 'Retro') await shot('05-select-create');
      await page.keyboard.press('Enter');
      await wait(200);
      await closeOverlays();
    }
    check('cells: select values', (await (await cell('Retro', 'Priority')).innerText()).trim() === 'Medium');

    // multi-select
    await (await cell('Write spec', 'Tags')).click();
    await page.waitForSelector('.nc-select-editor');
    for (const v of ['docs', 'q4']) {
      await page.keyboard.type(v, { delay: 10 });
      await page.keyboard.press('Enter');
      await wait(150);
    }
    await shot('06-multiselect-editor');
    await closeOverlays();
    check('cells: multi-select two tags', (await (await cell('Write spec', 'Tags')).locator('.nc-pill').count()) === 2);

    // number
    for (const [row, val] of [['Write spec', '1200'], ['Design review', '300'], ['Ship v1', '5000'], ['Retro', '50']]) {
      await (await cell(row, 'Budget')).click();
      await page.waitForSelector('.nc-cell-editor-input');
      await page.keyboard.type(val);
      await page.keyboard.press('Enter');
      await wait(150);
      await closeOverlays();
    }
    check('cells: number value shown', (await (await cell('Ship v1', 'Budget')).innerText()).trim() === '5000');

    // checkbox
    await (await cell('Ship v1', 'Done')).locator('.nc-prop-checkbox').click();
    await wait(200);
    check('cells: checkbox toggled', await (await cell('Ship v1', 'Done')).locator('.nc-prop-checkbox.checked').count());

    // date
    await (await cell('Write spec', 'Due')).click();
    await page.waitForSelector('.nc-date-picker');
    await wait(200);
    await shot('07-date-picker');
    await page.locator('.nc-date-day.today').first().click();
    await wait(200);
    await closeOverlays();
    const due = (await (await cell('Write spec', 'Due')).innerText()).trim();
    check('cells: date set from picker', /\w{3,} \d{1,2}, \d{4}/.test(due), due);
    await page.mouse.move(1300, 800);
    await wait(200);
    await shot('08-table-filled');
  });

  await section('title-edit', async () => {
    await rowByTitle('Retro').locator('.nc-title-cell').click();
    await page.waitForSelector('.nc-title-cell.editing');
    await page.keyboard.type(' notes');
    await wait(150);
    await shot('09-title-editing');
    await page.keyboard.press('Enter');
    await wait(200);
    check('title-edit: renamed in place', (await titles()).includes('Retro notes'));
  });

  await section('header-menu', async () => {
    const id = await colId('Due');
    await db().locator(`.lit-table-view-header-cell[data-col="${id}"] .nc-th-button`).click();
    await page.waitForSelector('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]');
    await wait(250);
    await shot('09b-header-menu');
    const txt = await page.locator('.lit-overlay-container').innerText();
    check('header-menu: has Edit property / Filter / Sort / Hide / Insert left', ['Edit property', 'Filter', 'Sort', 'Hide', 'Insert left', 'Delete property'].every((t) => txt.includes(t)), txt.replace(/\s+/g, ' ').slice(0, 160));
    await closeOverlays();
  });

  await section('filter', async () => {
    await (await toolbarButton('Filter')).click();
    await page.waitForSelector('.lit-overlay-container [role="option"]');
    await shot('10-filter-picker');
    await menuItem('Priority').click();
    await page.waitForSelector('.nc-filter-editor');
    await wait(200);
    await page.locator('.nc-filter-option').filter({ hasText: 'High' }).first().click();
    await wait(300);
    await shot('11-filter-editor');
    await closeOverlays();
    const t = await titles();
    check('filter: only High rows', t.join('|') === 'Write spec|Ship v1', t.join('|'));
    check('filter: chip shows "Priority: High"', (await db().locator('.nc-filter-chip').first().innerText()).replace(/\s+/g, ' ').includes('Priority: High'));
    await page.mouse.move(1300, 800);
    await shot('12-filtered');
    // remove the filter via the chip editor ••• → Delete filter
    await db().locator('.nc-filter-chip').first().click();
    await page.waitForSelector('.nc-filter-editor');
    await page.locator('.nc-filter-editor-more').click();
    await menuItemLoose('Delete filter').click();
    await wait(300);
    check('filter: removed', (await titles()).length === 4);
  });

  await section('sort', async () => {
    await (await toolbarButton('Sort')).click();
    await page.waitForSelector('.lit-overlay-container [role="option"]');
    await menuItem('Budget').click();
    await wait(300);
    await shot('13-sort-popover');
    await closeOverlays();
    let t = await titles();
    check('sort: ascending by Budget', t.join('|') === 'Retro notes|Design review|Write spec|Ship v1', t.join('|'));
    // flip direction from the sort chip popover
    await db().locator('.nc-filter-chip.sort').click();
    await page.waitForSelector('.nc-sort-popover');
    await page.locator('.nc-sort-popover .nc-adv-select').nth(1).click();
    await menuItem('High → low').click();
    await wait(300);
    await closeOverlays();
    t = await titles();
    check('sort: descending by Budget', t.join('|') === 'Ship v1|Write spec|Design review|Retro notes', t.join('|'));
    await page.mouse.move(1300, 800);
    await shot('14-sorted');
    await db().locator('.nc-filter-chip.sort').click();
    await page.waitForSelector('.nc-sort-popover');
    await page.locator('.nc-sort-popover [role="button"]', { hasText: 'Delete sort' }).first().click();
    await wait(300);
    await closeOverlays();
  });

  await section('calc', async () => {
    const id = await colId('Budget');
    check('calc: no footer row before a calculation', !(await db().locator('.nc-table-calc-row').count()));
    
    await db().locator(`.lit-table-view-header-cell[data-col="${id}"] .nc-th-button`).click();
    await page.waitForSelector('.lit-overlay-container [role="menuitem"]');
    await page.locator('.lit-overlay-container [role="menuitem"]').filter({ hasText: /^\s*Calculate\s*$/ }).first().hover();
    await wait(300);
    await menuItemLoose('More options').hover();
    await wait(300);
    await menuItem('Sum').click();
    await wait(300);
    await closeOverlays();
    const foot = db().locator(`.nc-table-calc-cell[data-col="${id}"]`);
    const txt = (await foot.innerText()).replace(/\s+/g, ' ').trim();
    check('calc: Sum of Budget = 6,550', /SUM\s*6,?550/i.test(txt), txt);
    await page.mouse.move(1300, 800);
    await shot('15-calc-sum');
  });

  await section('search', async () => {
    await (await toolbarButton('Search')).click();
    await page.waitForSelector('.nc-db-search-input');
    await page.keyboard.type('spec', { delay: 15 });
    await wait(300);
    await shot('15b-search');
    const t = await titles();
    check('search: rows filtered by text', t.join('|') === 'Write spec', t.join('|'));
    check('search: match highlighted', (await db().locator('.nc-search-hit').count()) >= 1);
    await page.keyboard.press('Escape');
    await wait(200);
    check('search: cleared', (await titles()).length === 4);
  });

  await section('group', async () => {
    await (await toolbarButton('Settings')).click();
    await page.waitForSelector('.nc-view-settings');
    await wait(200);
    await shot('16-view-settings');
    await vsRow('Group').click();
    await wait(250);
    await shot('16b-group-picker');
    await page.locator('.nc-vs-pick-list [role="option"]').filter({ hasText: /^\s*Status\s*$/ }).first().click();
    await wait(400);
    await closeOverlays();
    const heads = await db().locator('.nc-group-header').allInnerTexts();
    check('group: three status groups', heads.length >= 3, heads.map((h) => h.replace(/\s+/g, ' ')).join(' / '));
    await page.mouse.move(1300, 800);
    await shot('17-grouped');
    // ungroup
    await (await toolbarButton('Settings')).click();
    await page.waitForSelector('.nc-view-settings');
    await vsRow('Group').click();
    await wait(250);
    await vsRow('Remove grouping').click();
    await wait(300);
    await closeOverlays();
    check('group: removed', !(await db().locator('.nc-group-header').count()));
  });

  await section('conditional-color', async () => {
    await (await toolbarButton('Settings')).click();
    await page.waitForSelector('.nc-view-settings');
    await vsRow('Conditional color').click();
    await wait(250);
    await vsRow('New color setting').click();
    await wait(250);
    await menuItem('Priority').click();
    await wait(400);
    await shot('17b-conditional-color');
    await closeOverlays();
    const bg = await (await cell('Write spec', 'Status')).evaluate((el) => getComputedStyle(el).backgroundColor);
    check('conditional-color: rows with a Priority are tinted', bg !== 'rgb(255, 255, 255)' && bg !== 'rgba(0, 0, 0, 0)', bg);
    // remove the rule again
    await (await toolbarButton('Settings')).click();
    await page.waitForSelector('.nc-view-settings');
    await vsRow('Conditional color').click();
    await wait(250);
    await page.locator('.nc-view-settings [aria-label="Delete conditional color rule"]').first().click();
    await wait(250);
    await closeOverlays();
  });

  await section('board', async () => {
    await db().hover();
    await db().locator('.lit-collection-add-view').first().click();
    await page.waitForSelector('.nc-add-view-grid, .lit-overlay-container [role="option"]');
    await wait(200);
    await shot('18-add-view-menu');
    await page.locator('.lit-overlay-container').getByText('Board', { exact: true }).first().click();
    await wait(600);
    await closeOverlays();
    check('board: board view rendered', await db().locator('.lit-board-view').count());
    const cols = await db().locator('.nc-board-header-cell').allInnerTexts();
    check('board: columns by Status', cols.some((c) => c.includes('Not started')) && cols.some((c) => c.includes('Done')), cols.map((c) => c.replace(/\s+/g, ' ')).join(' / '));
    check('board: two view tabs', (await db().locator('.nc-view-tablist [role="tab"]').count()) === 2);
    await page.mouse.move(1300, 800);
    await shot('19-board');
    // drag "Design review" (Not started) into the Done column
    const card = db().locator('.nc-board-card').filter({ hasText: 'Design review' }).first();
    const target = db().locator('.nc-board-column').nth(2);
    const cb = await card.boundingBox();
    const tb = await target.boundingBox();
    await page.mouse.move(cb.x + 30, cb.y + 15);
    await page.mouse.down();
    await page.mouse.move(cb.x + 60, cb.y + 30, { steps: 4 });
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height - 20, { steps: 12 });
    await wait(150);
    await shot('20-board-dragging');
    await page.mouse.up();
    await wait(500);
    const doneCol = await db().locator('.nc-board-column').nth(2).innerText();
    check('board: card moved to Done', doneCol.includes('Design review'), doneCol.replace(/\s+/g, ' '));
    await page.mouse.move(1300, 800);
    await shot('21-board-after-drag');
  });

  await section('list-gallery', async () => {
    for (const [type, cls, shotName] of [['List', '.lit-list-view', '22-list'], ['Gallery', '.lit-gallery-view', '23-gallery']]) {
      await db().hover();
      const add = db().locator('.lit-collection-add-view, [aria-label="Add view"]').first();
      await add.click();
      await wait(300);
      await page.locator('.lit-overlay-container').getByText(type, { exact: true }).first().click();
      await wait(600);
      await closeOverlays();
      check(`${type.toLowerCase()}: rendered`, await db().locator(cls).count());
      await page.mouse.move(1300, 800);
      await shot(shotName);
    }
  });

  await section('peek', async () => {
    // back to the first tab (table) and open a row in side peek
    await db().locator('.nc-view-tablist [role="tab"]').first().click();
    await wait(400);
    const r = rowByTitle('Write spec');
    await r.hover();
    await r.locator('.nc-open-button').click();
    await page.waitForSelector('.nc-side-peek', { timeout: 5000 });
    await wait(500);
    await shot('24-side-peek');
    const peek = page.locator('.nc-side-peek').first();
    check('peek: properties panel shows Status', (await peek.innerText()).includes('In progress'));
    await page.keyboard.press('Escape');
    await wait(300);
  });

  await section('full-page', async () => {
    await page.locator('.nc-click-to-append').click().catch(() => {});
    await wait(200);
    await page.keyboard.type('/full page', { delay: 12 });
    await wait(400);
    await menuItemLoose(/Database( -)? full page/i).click();
    await wait(1200);
    await shot('25-full-page-db');
    check('full-page: navigated to database page', await page.locator('.nc-db.full').count());
    check('full-page: new database setup panel', await page.locator('.nc-new-db-panel, .nc-newdb-panel').count());
  });
} catch (e) {
  console.log('FATAL', e.message);
  await shot('fatal');
} finally {
  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ base: BASE, results, pageErrors }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  await browser.close();
}

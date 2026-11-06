// Advanced database views E2E: creates an inline database with date / number / select properties, adds
// Calendar, Timeline, Chart (all chart types), Map, Feed, Form and Dashboard views, interacts with them
// (drag a calendar item, resize/move timeline bars, zoom, switch chart types, fill + submit a form), opens the


// Run: node e2e/db-advanced.mjs   (NC_BASE to point at another dev server, NC_ONLY=calendar,timeline,… to filter)

import { launch, signup, BASE } from './lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-dbx';
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.NC_ONLY ? new Set(process.env.NC_ONLY.split(',')) : null;

const results = [];
const check = (name, ok, note = '') => {
  results.push({ name, ok: !!ok, note: String(note).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${note ? `  — ${String(note).slice(0, 200)}` : ''}`);
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
  for (let i = 0; i < 5; i++) {
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
    const diag = await page.evaluate(() => ({
      overlays: [...document.querySelectorAll('.lit-overlay-container .nc-overlay')].map((o) => o.className + ' ' + (o.textContent ?? '').slice(0, 80)),
      active: document.activeElement?.className ?? '',
    })).catch(() => ({}));
    console.log('   diag:', JSON.stringify(diag).slice(0, 400), '|', (e.message.split('\n').find((l) => l.includes('intercepts') || l.includes('waiting for')) ?? '').slice(0, 200));
    await shot(`err-${name}`);
  } finally {
    await closeOverlays();
  }
}

const db = () => page.locator('.nc-db').first();
const menuItemLoose = (label) => page.locator('.lit-overlay-container [role="option"]').filter({ hasText: label }).first();
async function addProperty(name, typeLabel) {
  await db().hover();
  await db().locator('[data-testid="add-column-button"]').first().click();
  await page.waitForSelector('.nc-add-prop');
  await page.keyboard.type(name, { delay: 8 });
  await page.locator('.nc-add-prop-cell').filter({ has: page.locator('.nc-add-prop-cell-label', { hasText: new RegExp(`^${esc(typeLabel)}$`) }) }).first().click();
  await wait(350);
  await closeOverlays();
}
/** Open the "Add view" type menu (the "+" after the tabs, or "N more…" › New view once tabs collapse). */
async function openAddViewMenu() {
  await db().hover();
  await wait(150);
  const add = db().locator('.lit-collection-add-view, [aria-label="Add view"]').first();
  if (await add.isVisible().catch(() => false)) await add.click();
  else {
    await db().locator('.nc-view-tabs-more').first().click();
    await wait(300);
    await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: /^\s*New view\s*$/ }).first().click();
  }
  await wait(300);
}

async function addView(type) {
  await openAddViewMenu();
  await page.locator('.lit-overlay-container').getByText(type, { exact: true }).first().click();
  await wait(700);
  await closeOverlays();
  await page.mouse.move(1370, 840);
  await wait(200);
}
async function openViewSettings() {
  await db().hover();
  await wait(100);
  const btn = db().locator('.nc-db-toolbar [aria-label="Settings"], .nc-db-toolbar [aria-label="View settings"]').first();
  await btn.click();
  await page.waitForSelector('.nc-view-settings');
  await wait(250);
}
const vsRow = (label) => page.locator('.nc-view-settings [role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${esc(label)}`) }).first();

// The record store comes from the dev-only window.__ncEditor hook, not import('/src/lib/store/records.ts'): after an
// HMR invalidation Vite serves the app's copy as records.ts?t=<ts>, so a bare-path import would get a second, empty store.
/** Read the collection (schema + rows) behind the first database on the page through Litpage's record store. */
async function dbState() {
  return page.evaluate(async () => {
    const { records } = window.__ncEditor;
    const dbBlock = document.querySelector('.nc-db-block[data-block-id]')?.getAttribute('data-block-id');
    const host = records.get('block', dbBlock);
    const colId = host?.collection_id ?? host?.format?.collection_pointer?.id;
    const col = records.get('collection', colId);
    const rows = records.all('block').filter((b) => b.parent_id === colId && b.alive !== false && b.type === 'page' && !b.is_template);
    const title = (b) => (b.properties?.title ?? []).map((x) => x[0]).join('');
    return { colId, schema: col?.schema ?? {}, rows: rows.map((r) => ({ id: r.id, title: title(r), properties: r.properties ?? {} })), views: (host?.view_ids ?? []).map((id) => records.get('collection_view', id)).filter(Boolean).map((v) => ({ id: v.id, type: v.type, name: v.name, format: v.format, query2: v.query2 })) };
  });
}

/** Data setup through Litpage modules (same Vite module instances as the UI): dates/numbers/selects. */
async function seedRows() {
  return page.evaluate(async () => {
    const { records } = window.__ncEditor;
    const { run, setProperty } = await import('/src/lib/blocks.ts');
    const dbBlock = document.querySelector('.nc-db-block[data-block-id]')?.getAttribute('data-block-id');
    const host = records.get('block', dbBlock);
    const colId = host?.collection_id ?? host?.format?.collection_pointer?.id;
    const col = records.get('collection', colId);
    const schema = col.schema;
    const byName = (n) => Object.keys(schema).find((k) => schema[k].name === n);
    const rows = records.all('block').filter((b) => b.parent_id === colId && b.alive !== false && b.type === 'page' && !b.is_template);
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const add = (n) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + n);
    const plan = [
      { start: -5, end: -5, est: 3, pri: 'High' },
      { start: 0, end: 4, est: 8, pri: 'Low' },
      { start: 2, end: 2, est: 5, pri: 'High' },
      { start: 6, end: 9, est: 2, pri: 'Medium' },
    ];
    const pri = byName('Priority');
    const opts = [{ id: 'opt-high', value: 'High', color: 'red' }, { id: 'opt-low', value: 'Low', color: 'gray' }, { id: 'opt-med', value: 'Medium', color: 'yellow' }];
    run('e2e.seed', (tx) => {
      tx.update('collection', colId, ['schema', pri], { options: opts });
      rows.forEach((r, i) => {
        setProperty(tx, r.id, pri, [[plan[i % plan.length].pri]]);
        const p = plan[i % plan.length];
        const s = iso(add(p.start));
        const e = iso(add(p.end));
        const d = p.start === p.end ? { type: 'date', start_date: s } : { type: 'daterange', start_date: s, end_date: e };
        setProperty(tx, r.id, byName('Due'), [['‣', [['d', d]]]]);
        setProperty(tx, r.id, byName('Estimate'), [[String(p.est)]]);
      });
    });
    return { colId, rows: rows.length, props: Object.values(schema).map((p) => `${p.name}:${p.type}`) };
  });
}

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
  await page.click('[aria-label="New page"]');
  await wait(350);
  const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
  if (await pageItem.count()) await pageItem.first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.locator('h1[data-content-editable-leaf]').last().click();
  await page.keyboard.type('Advanced DB Lab');
  await page.keyboard.press('Enter');
  await wait(300);

  await section('setup', async () => {
    await page.keyboard.type('/inline', { delay: 12 });
    await wait(450);
    await menuItemLoose('Database - Inline').click();
    await page.waitForSelector('.nc-db.inline');
    await wait(500);
    await db().locator('.nc-db-title-leaf').click();
    await page.keyboard.type('Tasks');
    await page.keyboard.press('Escape');
    await wait(200);
    await addProperty('Due', 'Date');
    await addProperty('Estimate', 'Number');
    await addProperty('Priority', 'Select');
    // rows through the placeholder rows
    for (const t of ['Write spec', 'Design review', 'Ship v1', 'Retro']) {
      const empty = db().locator('.lit-table-view-empty-placeholder');
      if (await empty.count()) await empty.first().click();
      else await db().locator('.lit-table-view-add-row').first().click();
      await page.waitForSelector('.nc-title-cell-leaf.editing');
      await page.keyboard.type(t, { delay: 8 });
      await page.keyboard.press('Enter');
      await wait(250);
    }
    await closeOverlays();
    const seeded = await seedRows();
    check('setup: seeded 4 rows with dates/estimates', seeded.rows === 4, JSON.stringify(seeded));
    await wait(400);
    await page.mouse.move(1370, 840);
    await shot('00-table');
  });

  await section('calendar', async () => {
    await addView('Calendar');
    check('calendar: rendered', await db().locator('.lit-calendar-view').count());
    const items = await db().locator('.nc-cal-item').count();
    check('calendar: items placed', items >= 4, `items=${items}`);
    check('calendar: today highlighted', await db().locator('[data-testid="today-day-number"]').count());
    await shot('10-calendar');
    // drag the single-day "Ship v1" one day to the right
    const item = db().locator('.nc-cal-item').filter({ hasText: 'Ship v1' }).first();
    await item.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, 200);
    await wait(300);
    const box = await item.boundingBox();
    const dayW = (await db().locator('.nc-cal-day').first().boundingBox()).width;
    await page.mouse.move(box.x + 20, box.y + 12);
    await page.mouse.down();
    await page.mouse.move(box.x + 30, box.y + 14, { steps: 3 });
    await page.mouse.move(box.x + 20 + dayW, box.y + 12, { steps: 8 });
    await page.mouse.up();
    await wait(400);
    const after = await db().locator('.nc-cal-item').filter({ hasText: 'Ship v1' }).first().boundingBox();
    check('calendar: drag moved item by one day', after && Math.abs(after.x - box.x - dayW) < 6, `dx=${after ? Math.round(after.x - box.x) : 'n/a'} day=${Math.round(dayW)}`);
    await page.mouse.move(1370, 840);
    await shot('11-calendar-after-drag');
    await openViewSettings();
    await vsRow('Layout').click();
    await wait(250);
    check('calendar: layout settings show "Group calendar by"', await vsRow('Group calendar by').count());
    await shot('12-calendar-layout-settings');
    await closeOverlays();
  });

  await section('timeline', async () => {
    await addView('Timeline');
    check('timeline: rendered', await db().locator('.lit-timeline-view').count());
    const bars = await db().locator('.lit-timeline-item').count();
    check('timeline: 4 bars', bars === 4, `bars=${bars}`);
    check('timeline: header "Month" zoom', (await db().locator('.nc-tl-zoom').innerText()).includes('Month'));
    await shot('20-timeline');
    // resize "Design review" one day longer
    const bar = db().locator('.lit-timeline-item').nth(1);
    const b0 = await bar.boundingBox();
    const handle = bar.locator('.lit-timeline-item-resizer-right');
    const hb = await handle.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + 20, hb.y + 10, { steps: 4 });
    await page.mouse.move(hb.x + hb.width / 2 + 40, hb.y + hb.height / 2, { steps: 8 });
    await page.mouse.up();
    await wait(400);
    const b1 = await db().locator('.lit-timeline-item').nth(1).boundingBox();
    check('timeline: resize extended bar by 1 day (40px)', b1 && Math.abs(b1.width - b0.width - 40) < 4, `w0=${Math.round(b0.width)} w1=${b1 ? Math.round(b1.width) : 'n/a'}`);
    // move the first bar 2 days right
    const first = db().locator('.lit-timeline-item').first();
    const f0 = await first.boundingBox();
    await page.mouse.move(f0.x + f0.width / 2, f0.y + f0.height / 2);
    await page.mouse.down();
    await page.mouse.move(f0.x + f0.width / 2 + 10, f0.y + f0.height / 2, { steps: 3 });
    await page.mouse.move(f0.x + f0.width / 2 + 80, f0.y + f0.height / 2, { steps: 8 });
    await page.mouse.up();
    await wait(400);
    const f1 = await db().locator('.lit-timeline-item').first().boundingBox();
    check('timeline: move shifted bar by 2 days', f1 && Math.abs(f1.x - f0.x - 80) < 4, `dx=${f1 ? Math.round(f1.x - f0.x) : 'n/a'}`);
    await page.mouse.move(1370, 840);
    await shot('21-timeline-after-drag');
    // zoom to Week
    await db().locator('.nc-tl-zoom').click();
    await wait(200);
    await shot('22-timeline-zoom-menu');
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Week\s*$/ }).first().click();
    await wait(400);
    check('timeline: zoom switched to Week', (await db().locator('.nc-tl-zoom').innerText()).includes('Week'));
    await page.mouse.move(1370, 840);
    await shot('23-timeline-week');
    // show table
    await db().locator('[aria-label="Show table"]').first().click();
    await wait(400);
    check('timeline: table sidebar shown', await db().locator('.nc-tl-table').count());
    await shot('24-timeline-table');
    await db().locator('[aria-label="Hide table"]').first().click();
    await wait(300);
    await db().locator('.nc-tl-zoom').click();
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Month\s*$/ }).first().click();
    await wait(300);
  });

  await section('chart', async () => {
    await addView('Chart');
    check('chart: rendered', await db().locator('.lit-chart-view').count());
    await page.mouse.move(1370, 840);
    await wait(300);
    await shot('30-chart-column');
    const bars = await db().locator('.nc-chart-point').count();
    check('chart: column bars per Priority option', bars >= 3, `bars=${bars}`);
    await openViewSettings();
    check('chart: settings show Chart type', await page.locator('.nc-chart-types').count());
    await shot('31-chart-settings');
    for (const [label, file] of [['Horizontal bar', '32-chart-hbar'], ['Line', '33-chart-line'], ['Donut', '34-chart-donut'], ['Number', '35-chart-number'], ['Vertical bar', '36-chart-vbar']]) {
      await page.locator(`.nc-chart-type[aria-label="${label}"]`).click();
      await wait(400);
      check(`chart: switched to ${label}`, (await db().locator('.lit-chart-view').getAttribute('data-chart-type')) === ({ 'Horizontal bar': 'bar', Line: 'line', Donut: 'donut', Number: 'number', 'Vertical bar': 'column' })[label]);
      await shot(file);
    }
    await closeOverlays();
  });

  await section('formula', async () => {
    // switch back to the table view and add a formula property through the core "+ Add property" flow
    const firstTab = db().locator('.nc-view-tablist .lit-collection-view-tab').first();
    if (await firstTab.count()) await firstTab.click();
    await wait(400);
    await db().hover();
    await db().locator('[data-testid="add-column-button"]').first().click();
    await page.waitForSelector('.nc-add-prop');
    await page.keyboard.type('Double', { delay: 8 });
    await page.locator('.nc-add-prop-cell').filter({ has: page.locator('.nc-add-prop-cell-label', { hasText: /^Formula$/ }) }).first().click();
    await page.waitForSelector('.nc-fx-dialog', { timeout: 8000 });
    await wait(300);
    await shot('40-formula-editor-empty');
    await page.locator('.nc-fx-code').click();
    await page.keyboard.type('prop("Estimate', { delay: 15 });
    await wait(250);
    await shot('41-formula-autocomplete');
    await page.keyboard.type('") * 2', { delay: 15 });
    await wait(400);
    const type = await page.locator('.nc-fx-type').innerText();
    check('formula: type badge is number', /number/i.test(type), type);
    await shot('42-formula-typed');
    await page.locator('.nc-fx-close').click();
    await wait(500);
    const st = await dbState();
    const fx = Object.entries(st.schema).find(([, p]) => p.name === 'Double');
    check('formula: property saved as formula v2', fx && fx[1].type === 'formula' && fx[1].formula2?.code, fx ? JSON.stringify(fx[1]).slice(0, 160) : 'missing');
    const cells = await db().locator('.lit-table-view-cell').allInnerTexts();
    check('formula: cells show doubled estimates', cells.some((t) => t.trim() === '16') && cells.some((t) => t.trim() === '6'), cells.filter((t) => /^\d+$/.test(t.trim())).join(','));
    await page.mouse.move(1370, 840);
    await shot('43-formula-column');
  });

  await section('relation', async () => {
    await db().hover();
    await db().locator('[data-testid="add-column-button"]').first().click();
    await page.waitForSelector('.nc-add-prop');
    await page.keyboard.type('Blocked by', { delay: 8 });
    await page.locator('.nc-add-prop-cell').filter({ has: page.locator('.nc-add-prop-cell-label', { hasText: /^Relation$/ }) }).first().click();
    await page.waitForSelector('.nc-rel-panel[aria-label="Related to"]', { timeout: 8000 });
    await wait(400);
    await shot('50-relation-related-to');
    await page.locator('.nc-rel-ds').filter({ hasText: 'Tasks' }).first().click();
    await page.waitForSelector('.nc-rel-panel[aria-label="New relation"]');
    await page.locator('.nc-rel-panel[aria-label="New relation"] [role="menuitemcheckbox"]').click();
    await wait(200);
    const rev = page.locator('.nc-rel-panel[aria-label="New relation"] .nc-rel-input input').last();
    await rev.fill('Blocking');
    await shot('51-relation-new');
    await page.locator('.nc-rel-button', { hasText: 'Add relation' }).click();
    await wait(500);
    await closeOverlays();
    const st = await dbState();
    const rel = Object.entries(st.schema).find(([, p]) => p.name === 'Blocked by');
    const back = Object.entries(st.schema).find(([, p]) => p.name === 'Blocking');
    check('relation: two-way self relation created', rel && back && rel[1].type === 'relation' && rel[1].property === back[0] && back[1].property === rel[0], JSON.stringify(rel?.[1] ?? {}).slice(0, 160));
    // link "Ship v1" blocked by "Write spec" through the API, then check the reverse side synced via the UI module
    const ok = await page.evaluate(async ({ relId }) => {
      const mod = await import('/src/features/database/advanced/relations.ts');
      const { records } = window.__ncEditor;
      const dbBlock = document.querySelector('.nc-db-block[data-block-id]')?.getAttribute('data-block-id');
      const host = records.get('block', dbBlock);
      const colId = host?.collection_id;
      const rows = records.all('block').filter((b) => b.parent_id === colId && b.alive !== false && b.type === 'page');
      const t = (b) => (b.properties?.title ?? []).map((x) => x[0]).join('');
      const ship = rows.find((r) => t(r) === 'Ship v1');
      const spec = rows.find((r) => t(r) === 'Write spec');
      mod.setRelationValue(ship.id, relId, [spec.id]);
      return true;
    }, { relId: rel?.[0] });
    await wait(500);
    const st2 = await dbState();
    const spec = st2.rows.find((r) => r.title === 'Write spec');
    check('relation: reverse property synced', ok && JSON.stringify(spec?.properties?.[back?.[0]] ?? '').includes('‣'), JSON.stringify(spec?.properties?.[back?.[0]] ?? null).slice(0, 120));
    await page.mouse.move(1370, 840);
    await shot('52-relation-column');
  });

  await section('form', async () => {
    await openAddViewMenu();
    await page.locator('.lit-overlay-container').getByText('Form', { exact: true }).first().click();
    await page.waitForSelector('[data-testid="form-autocreate"]', { timeout: 8000 });
    await wait(300);
    await shot('60-form-autocreate');
    await page.locator('[data-testid="form-autocreate"] [role="button"]').filter({ hasText: /^Create \d+ questions?$/ }).click();
    await wait(400);
    await closeOverlays();
    await page.mouse.move(1370, 840);
    const qCount = await db().locator('.nc-form-b-q').count();
    check('form: questions created from supported properties', qCount >= 4, `questions=${qCount}`);
    await db().locator('[data-testid="form-title"]').click();
    await page.keyboard.type('Task intake');
    await page.keyboard.press('Enter');
    await wait(200);
    // Name question → Required
    const nameQ = db().locator('.nc-form-b-q').first();
    await nameQ.hover();
    await nameQ.locator('.nc-form-b-qmore').click();
    await page.waitForSelector('[data-testid="form-question-options"]');
    await shot('61-form-question-options');
    await page.locator('[data-testid="form-question-options"] [role="menuitem"]').filter({ hasText: /^\s*Required/ }).click();
    await wait(200);
    await closeOverlays();
    check('form: Name marked required', await nameQ.locator('.nc-form-req').count());
    await page.mouse.move(1370, 840);
    await shot('62-form-builder');
    // preview + submit
    await page.locator('[data-testid="form-preview-button"]').click();
    await page.waitForSelector('[data-testid="form-preview"] .nc-form-r-q', { timeout: 8000 });
    await wait(300);
    await page.locator('[data-testid="form-preview"] [role="button"]', { hasText: /^Submit$/ }).click();
    await wait(300);
    check('form: required validation', (await page.locator('[data-testid="form-preview"] .nc-form-error').first().innerText().catch(() => '')).includes('Please answer this question'));
    await page.locator('[data-testid="form-preview"] .nc-form-r-q').first().locator('input').fill('From preview');
    await shot('63-form-preview');
    await page.locator('[data-testid="form-preview"] [role="button"]', { hasText: /^Submit$/ }).click();
    await page.waitForSelector('[data-testid="form-confirmation"]', { timeout: 8000 });
    await shot('64-form-submitted');
    await closeOverlays();
    await wait(600);
    let st = await dbState();
    check('form: preview submission created a row', st.rows.some((r) => r.title === 'From preview'), st.rows.map((r) => r.title).join('|'));
    // share publicly and submit anonymously in a fresh context
    await page.locator('[data-testid="form-share-button"]').click();
    await page.waitForSelector('[data-testid="form-share-menu"]');
    await page.locator('[data-testid="form-share-menu"] [role="menuitem"]').filter({ hasText: /^\s*Who can submit/ }).click();
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: 'Anyone online with the link' }).first().click();
    await wait(400);
    if (!(await page.locator('[data-testid="form-share-menu"]').count())) await page.locator('[data-testid="form-share-button"]').click();
    await page.waitForSelector('[data-testid="form-share-menu"]');
    await shot('65-form-share-menu');
    const link = await page.locator('[data-testid="form-share-menu"] input').inputValue();
    check('form: share link points at /form/<id>', /\/form\/[0-9a-f]{32}$/.test(link), link);
    await closeOverlays();
    const ctx2 = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
    try {
      const anon = await ctx2.newPage();
      await anon.goto(link);
      await anon.waitForSelector('.nc-form-r-q', { timeout: 10000 });
      await anon.locator('.nc-form-r-q').first().locator('input').fill('Anonymous answer');
      await anon.screenshot({ path: join(OUT, '66-form-public.png') });
      await anon.locator('[role="button"]', { hasText: /^Submit$/ }).click();
      await anon.waitForSelector('[data-testid="form-confirmation"]', { timeout: 10000 });
      await anon.screenshot({ path: join(OUT, '67-form-public-submitted.png') });
      check('form: anonymous public submission confirmed', true);
    } finally {
      await ctx2.close();
    }
    await wait(1500);
    st = await dbState();
    check('form: public submission arrived as a row (realtime)', st.rows.some((r) => r.title === 'Anonymous answer'), st.rows.map((r) => r.title).join('|'));
  });

  await section('map', async () => {
    await addView('Map');
    check('map: rendered', await db().locator('[data-testid="map-canvas"]').count());
    const label = await db().locator('[data-testid="map-no-location"]').innerText();
    check('map: "No location (N)" toolbar', /^No location \(\d+\)$/.test(label.trim()), label);
    await shot('70-map');
    await db().locator('[aria-label="Enable pin placement"]').click();
    const box = await db().locator('[data-testid="map-canvas"]').boundingBox();
    await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20);
    await wait(800);
    await shot('71-map-new-page-peek');
    // close the center peek of the new page (Escape: leave the title, then close the peek)
    // close the center peek: leave the title editor, then Escape (PeekPanel closes on Escape when not editing)
    if (await page.locator('.nc-center-peek-layer, .nc-side-peek').count()) {
      await page.evaluate(() => (document.activeElement)?.blur?.());
      await page.keyboard.press('Escape');
      await wait(400);
      if (await page.locator('.nc-center-peek-layer, .nc-side-peek').count()) await page.goBack();
      await wait(400);
    }
    check('map: new page opened in center peek and closed', !(await page.locator('.nc-center-peek-layer').count()));
    await closeOverlays();
    await wait(300);
    const pins = await db().locator('.nc-map-pin').count();
    check('map: add-pin mode created a pinned page', pins >= 1, `pins=${pins}`);
    await page.mouse.move(1370, 840);
    await shot('72-map-pin');
  });

  await section('feed', async () => {
    await addView('Feed');
    const cards = await db().locator('.nc-feed-card').count();
    check('feed: cards rendered', cards >= 4, `cards=${cards}`);
    check('feed: author byline shown', await db().locator('.nc-feed-byline').count());
    await shot('80-feed');
  });

  await section('dashboard', async () => {
    await addView('Dashboard');
    check('dashboard: empty state', await db().locator('[data-testid="dashboard-empty"]').count());
    await shot('90-dashboard-empty');
    await db().locator('[data-testid="dashboard-add"]').click();
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Chart\s*$/ }).first().click();
    await wait(600);
    const row = db().locator('.nc-dash-row').first();
    await row.hover();
    await row.locator('.nc-dash-row-add').click();
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Table\s*$/ }).first().click();
    await wait(700);
    const widgets = await db().locator('.nc-dash-widget').count();
    check('dashboard: two widgets in one row', widgets === 2 && (await db().locator('.nc-dash-row').count()) === 1, `widgets=${widgets}`);
    check('dashboard: chart widget renders bars', await db().locator('.nc-dash-widget[data-view-type="chart"] .nc-chart-point').count());
    const tabs = await db().locator('.nc-view-tablist .lit-collection-view-tab').count();
    check('dashboard: widget views stay out of the tab bar', tabs <= 9, `tabs=${tabs}`);
    await page.mouse.move(1370, 840);
    await shot('91-dashboard-widgets');
  });
} catch (e) {
  check('run: no fatal exception', false, e.message.split('\n')[0]);
  await shot('err-fatal');
} finally {
  check('no page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ base: BASE, results, pageErrors }, null, 2));
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed → ${OUT}`);
}

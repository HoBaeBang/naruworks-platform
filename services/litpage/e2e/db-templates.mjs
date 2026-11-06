
// Tasks" + "Duplicate every…"), template variables (Person "Me — Person who duplicated entry", Date "Today — Duplication
// date", "@Today" in the body), repeat (Duplicate every › Week → "Duplicate weekly" caption + server schedule),
// template ••• menu (Set as default / Edit / Duplicate every… / Duplicate / Delete) and the "For all views" default
// dialog, new rows from the default template with variables resolved, and the template list in an empty page.
// Run: NC_BASE=http://127.0.0.1:5421 node e2e/db-templates.mjs
import { apiCall, createInlineDb, freshPage, setup, tableHelpers } from './db-lib.mjs';

process.env.NC_SHOTS ??= '/tmp/nc-e2e/wave3/dba/shots/db-templates';
const T = await setup('db-templates');
const { page, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);
const opt = (text) => page.locator('.lit-overlay-container .nc-overlay [role="option"], .lit-overlay-container .nc-overlay [role="menuitem"]').filter({ hasText: text }).first();
const peek = () => page.locator('.nc-peek, [class*="peek"]').filter({ has: page.locator('.nc-tpl-banner') }).first();

function today() {
  const d = new Date();
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await wait(250);
  }
}

async function openNewMenu() {
  await tb.db().hover();
  await wait(150);
  await tb.db().locator('[aria-label="More create options"]').first().click();
  await wait(350);
}

try {
  await freshPage(page, 'Template Lab');

  await section('setup', async () => {
    await createInlineDb(page, 'Tasks');
    await tb.addProperty('Owner', 'Person');
    await tb.addProperty('Due', 'Date');
    await tb.newRow('Existing');
    check('setup: database ready', (await tb.titles()).includes('Existing'));
  });

  await section('new-template', async () => {
    await openNewMenu();
    await opt('New template').click();
    await page.waitForSelector('.nc-tpl-banner');
    await wait(400);
    const banner = page.locator('.nc-tpl-banner').first();
    check('banner: "You’re editing a template in Tasks"', (await banner.innerText()).replace(/\s+/g, ' ').includes('You’re editing a template in Tasks'));
    check('banner: "Duplicate every…" button', (await banner.locator('.nc-tpl-repeat').innerText()).includes('Duplicate every'));
    const bg = await banner.evaluate((el) => getComputedStyle(el).backgroundColor);
    check('banner: yellow background (--lp-yellow-bg-secondary)', bg !== 'rgba(0, 0, 0, 0)' && bg !== 'rgb(255, 255, 255)', bg);
    // title
    const title = page.locator('.nc-tpl-banner').first().locator('xpath=ancestor::*[contains(@class,"peek") or contains(@class,"nc-page")][1]').locator('h1[data-content-editable-leaf]').first();
    const h1 = (await title.count()) ? title : page.locator('h1[data-content-editable-leaf]').last();
    await h1.click();
    await page.keyboard.type('Weekly review');
    await wait(300);
    // Owner = Me (person who duplicated page)
    const ownerCell = page.locator('.nc-page-prop-row').filter({ hasText: 'Owner' }).first().locator('.nc-page-prop-value .nc-property-cell').first();
    await ownerCell.click();
    await wait(300);
    const me = page.locator('.nc-select-option').filter({ hasText: 'Person who duplicated entry' }).first();
    check('person editor: "Me — Person who duplicated entry" on templates', await me.count());
    await me.click();
    await wait(200);
    await closeOverlays();
    check('person value: template variable chip', (await page.locator('.nc-page-prop-row').filter({ hasText: 'Owner' }).first().innerText()).includes('Person who duplicated entry'));
    const dueCell = page.locator('.nc-page-prop-row').filter({ hasText: 'Due' }).first().locator('.nc-page-prop-value .nc-property-cell').first();
    await dueCell.click();
    await wait(300);
    const td = page.locator('.nc-tplvar-option').filter({ hasText: 'Duplication date' }).first();
    check('date editor: "Today — Duplication date" on templates', await td.count());
    await td.click();
    await wait(250);
    await closeOverlays();
    check('date value: template variable chip "Today"', (await page.locator('.nc-page-prop-row').filter({ hasText: 'Due' }).first().locator('.nc-tplvar-chip').innerText()).includes('Today'));
    // body: @today → template variable
    const empty = page.locator('.nc-empty-row-hint .nc-empty-row-continue').first();
    if (await empty.count()) await empty.click();
    else await page.locator('.nc-click-to-append').last().click();
    await wait(250);
    await page.keyboard.type('Review of @tod', { delay: 20 });
    await wait(500);
    const varItem = page.locator('.lit-overlay-container [role="option"]').filter({ hasText: 'Duplication date' }).first();
    check('@ menu: template variable "Today — Duplication date"', await varItem.count());
    await varItem.click();
    await wait(300);
    check('editor: @Today variable atom', await page.locator('.lit-date-mention-token', { hasText: 'Today' }).count());
    await shot('01-template-editing');
  });

  await section('repeat', async () => {
    const btn = page.locator('.nc-tpl-repeat').first();
    await btn.click();
    await wait(250);
    const menu = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('repeat menu: presets', ['Day', 'Weekday', 'Week', '2 Weeks', 'Month', '3 Months', '6 Months', 'Year'].every((x) => menu.includes(x)), menu.replace(/\n/g, ','));
    await opt(/^Week$/).click();
    const ok = await waitFor(async () => (await btn.innerText()).includes('Duplicate weekly'));
    check('repeat: banner shows "Duplicate weekly"', ok, await btn.innerText());
    await shot('02-repeat');
    await page.keyboard.press('Escape');
    await wait(400);
    await closeOverlays();
  });

  await section('menu-default', async () => {
    await openNewMenu();
    const row = page.locator('.nc-templates-menu [role="menuitem"], .nc-templates-menu [role="option"]').filter({ hasText: 'Weekly review' }).first();
    check('templates menu: repeat caption "Duplicate weekly"', (await row.innerText()).includes('Duplicate weekly'));
    await row.hover();
    await row.locator('[aria-label="Template options"]').click();
    await wait(300);
    const items = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('template •••: Set as default / Edit / Duplicate every… / Duplicate / Delete', ['Set as default', 'Edit', 'Duplicate every…', 'Duplicate', 'Delete'].every((x) => items.includes(x)), items.replace(/\n/g, ','));
    await opt('Set as default').click();
    await wait(300);
    const dlg = page.locator('.nc-tpl-default');
    check('default dialog: message + "For all views" / "Only on … view"', (await dlg.innerText()).includes('Use “Weekly review” as default template when creating new pages?') && (await dlg.innerText()).includes('For all views in “Tasks”') && (await dlg.innerText()).includes('Only on'));
    await shot('03-default-dialog');
    await dlg.locator('button', { hasText: 'For all views' }).click();
    await wait(300);
    await closeOverlays();
  });

  await section('use-template', async () => {
    await tb.db().hover();
    await tb.db().locator('.nc-db-new').first().click();
    await wait(400);
    await closeOverlays();
    const ok = await waitFor(async () => (await tb.titles()).filter((t) => t === 'Weekly review').length >= 1, 8000);
    check('default template: New creates "Weekly review"', ok, (await tb.titles()).join(','));
    await wait(800);
    const owner = await (await tb.cell('Weekly review', 'Owner')).innerText();
    check('variables: Owner = the person who duplicated', owner.includes('Test User'), owner);
    const due = await (await tb.cell('Weekly review', 'Due')).innerText();
    check('variables: Due = today', due.length > 0 && !due.includes('Today'), due);
    // body text variable resolved
    const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
    const chunk = await apiCall(page, 'loadPage', { pageId: blockId });
    const blocks = Object.values(chunk.body?.recordMap?.block ?? {}).map((e) => e.value?.value ?? e.value);
    const row = blocks.find((b) => b?.parent_table === 'collection' && !b.is_template && (b.properties?.title ?? []).map((d) => d[0]).join('') === 'Weekly review');
    check('variables: row created from template (copied_from)', !!row?.copied_from);
    const rowChunk = row ? await apiCall(page, 'loadPage', { pageId: row.id }) : null;
    const texts = Object.values(rowChunk?.body?.recordMap?.block ?? {}).map((e) => e.value?.value ?? e.value).filter((b) => b?.parent_id === row?.id && b.type === 'text');
    const dateAtom = texts.flatMap((b) => (b.properties?.title ?? []).flatMap((d) => (d[1] ?? []))).find((a) => a[0] === 'd');
    check('variables: body @Today became a concrete date', !!dateAtom && !dateAtom[1].template_variable, JSON.stringify(dateAtom));
  });

  await section('empty-page-templates', async () => {
    await openNewMenu();
    await opt(/^Empty$/).click();
    await wait(800);
    const hint = page.locator('.nc-empty-row-hint').last();
    const ok = await waitFor(async () => (await hint.count()) > 0, 4000);
    check('empty page: hint visible in the new page', ok);
    const item = page.locator('.nc-empty-row-template-item', { hasText: 'Weekly review' }).last();
    check('empty page: template list under the hint', await item.count());
    await shot('04-empty-page-templates');
    await item.click();
    const applied = await waitFor(async () => (await page.locator('.lit-date-mention-token').count()) > 0, 6000);
    check('empty page: clicking a template applies it', applied);
    await closeOverlays();
  });

  await section('repeat-server', async () => {
    const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
    const chunk = await apiCall(page, 'loadPage', { pageId: blockId });
    const colId = chunk.body?.recordMap?.block?.[blockId]?.value?.value?.collection_id;
    const res = await apiCall(page, 'getAutomations', { collectionId: colId });
    const autos = Object.values(res.body?.recordMap?.automation ?? {}).map((e) => e.value?.value ?? e.value);
    const rep = autos.find((a) => a?.template_id && a.alive !== false);
    check('repeat: server schedule (next run in the future)', rep && rep.next_run_time > Date.now() && rep.trigger?.recurrence?.frequency === 'week', JSON.stringify(rep?.next_run_time));
  });
} catch (e) {
  check('no fatal error', false, e.message);
  await shot('fatal');
} finally {
  await T.finish();
}

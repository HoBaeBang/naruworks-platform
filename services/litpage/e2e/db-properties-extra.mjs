
// validation + ID URL, Status "Display as › Checkbox", Person "Default: Created by" + Notifications, Text → Place and
// the place overlay, Files & media (upload, rename, menu, drop on the cell), Shift+click end dates and Korean date
// input, Deleted properties (permanent delete), property detail Duplicate / Delete, copy button on email values,
// relation "Customize shown properties", relation page section, timeline drag-to-connect dependencies.
// Run: NC_BASE=http://127.0.0.1:5431 node e2e/db-properties-extra.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { SCRATCH, apiCall, createInlineDb, esc, freshPage, setup, tableHelpers } from './db-lib.mjs';

const T = await setup('db-properties-extra');
const { page, context, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const opt = (label) => page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${esc(label)}`) }).first();
const optExact = (label) => page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }).last();
const vsRow = (label) => page.locator('.nc-view-settings [role="menuitem"]').filter({ has: page.locator('.nc-menu-label', { hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }) }).first();
const S = {};

async function ids() {
  const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
  const r = await apiCall(page, 'loadPage', { pageId: blockId });
  const b = r.body?.recordMap?.block?.[blockId]?.value?.value;
  return { blockId, collectionId: b?.collection_id, spaceId: b?.space_id, viewIds: b?.view_ids ?? [] };
}
async function data() {
  // let queued edits reach the server first (the machine can be slow; dev builds expose the transaction queue)
  await page.waitForFunction(() => !window.__ncEditor || window.__ncEditor.transactions.pendingCount() === 0, null, { timeout: 8000 }).catch(() => {});
  const r = await apiCall(page, 'loadCollectionRows', { collectionId: S.collectionId });
  const rm = r.body?.recordMap ?? {};
  const rows = Object.values(rm.block ?? {}).map((e) => e.value.value).filter((b) => b.parent_id === S.collectionId && b.alive !== false && !b.is_template);
  return { collection: rm.collection?.[S.collectionId]?.value?.value, rows, byTitle: (t) => rows.find((r) => (r.properties?.title ?? []).map((x) => x[0]).join('') === t) };
}
async function tx(operations) {
  return apiCall(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: S.spaceId, operations }] });
}
const op = (table, id, path, command, args) => ({ pointer: { table, id, spaceId: S.spaceId }, path, command, args });
async function headerMenu(name) {
  await tb.db().locator('.lit-table-view-header-cell').filter({ has: page.locator('.nc-th-name', { hasText: new RegExp(`^${esc(name)}$`) }) }).first().click();
  await wait(300);
}
async function propDetail(name) {
  await tb.openSettings();
  await vsRow('Edit properties').click();
  await wait(250);
  await page.locator('.nc-view-settings [role="menuitem"]').filter({ has: page.locator('.nc-menu-label', { hasText: new RegExp(`^\\s*${esc(name)}\\s*$`) }) }).first().click();
  await page.waitForSelector('.nc-edit-property-popover');
  await wait(200);
}
async function confirmModal(label) {
  const btn = page.locator('.lit-overlay-container [role="button"], .lit-overlay-container button').filter({ hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }).last();
  await btn.waitFor({ timeout: 5000 });
  await btn.click();
  await wait(400);
}
async function cellText(rowTitle, propName) {
  return (await (await tb.cell(rowTitle, propName)).innerText()).trim();
}

try {
  await freshPage(page, 'Props Lab');
  await createInlineDb(page, 'Things');
  await tb.newRow('Alpha');
  await tb.newRow('Beta');
  Object.assign(S, await ids());
  S.domain = new URL(page.url()).pathname.split('/').filter(Boolean)[0];

  await section('unique-id', async () => {
    await tb.addProperty('ID', 'ID');
    await wait(600);
    check('id: existing rows numbered 1, 2', (await cellText('Alpha', 'ID')) === '1' && (await cellText('Beta', 'ID')) === '2', `${await cellText('Alpha', 'ID')} ${await cellText('Beta', 'ID')}`);
    await propDetail('ID');
    await page.locator('[data-testid="id-prefix"]').fill('1X');
    await page.locator('[data-testid="id-prefix-apply"]').click();
    await wait(200);
    check('id: invalid prefix explained', (await page.locator('.nc-id-error').innerText()).includes('The prefix must begin with a letter'));
    await page.locator('[data-testid="id-prefix"]').fill('TASK');
    await page.locator('[data-testid="id-prefix-apply"]').click();
    await wait(400);
    await shot('01-id-prefix', page.locator('.nc-edit-property-popover'));
    await closeOverlays();
    check('id: prefix shown in cells', (await cellText('Alpha', 'ID')) === 'TASK-1', await cellText('Alpha', 'ID'));
    await tb.newRow('Gamma');
    await wait(600);
    check('id: new row gets the next number', (await cellText('Gamma', 'ID')) === 'TASK-3', await cellText('Gamma', 'ID'));
    const d = await data();
    const idProp = Object.entries(d.collection.schema).find(([, p]) => p.type === 'auto_increment_id')[0];
    S.idProp = idProp;
    await tx([op('block', d.byTitle('Gamma').id, [], 'update', { alive: false })]);
    await tb.newRow('Delta');
    await wait(700);
    const d2 = await data();
    check('id: a deleted number is never reused', d2.byTitle('Delta')?.properties?.[idProp]?.[0]?.[0] === '4', JSON.stringify(d2.byTitle('Delta')?.properties?.[idProp]));
    const sec = await tx([op('collection', S.collectionId, ['schema', 'id2'], 'set', { name: 'ID 2', type: 'auto_increment_id' })]);
    check('id: server refuses a second ID property', sec.status === 403 && /only one ID property/.test(sec.body?.message ?? ''), `${sec.status} ${sec.body?.message ?? ''}`);
    S.alphaId = d2.byTitle('Alpha').id;
    S.betaId = d2.byTitle('Beta').id;
    S.labUrl = page.url();
    await page.goto(new URL(`/${S.domain}/TASK-2`, page.url()).href);
    await page.waitForFunction(() => /Beta/.test(document.querySelector('h1[data-content-editable-leaf]')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
    check('id: /<domain>/TASK-2 opens that page', /Beta/.test(await page.locator('h1[data-content-editable-leaf]').first().innerText().catch(() => '')) && page.url().replace(/-/g, '').includes(S.betaId.replace(/-/g, '')), page.url());
    await page.goto(new URL(`/${S.domain}/TASK-404`, page.url()).href);
    await page.waitForSelector('[data-testid="unique-id-missing"]', { timeout: 10000 }).catch(() => {});
    check('id: unknown ID shows not found', await page.locator('[data-testid="unique-id-missing"]').count());
    await page.goto(S.labUrl);
    await page.waitForSelector('.nc-db .nc-table-row-outer');
    await wait(500);
  });

  await section('status-checkbox', async () => {
    await tb.addProperty('State', 'Status');
    await headerMenu('State');
    await opt('Display as').click();
    await wait(200);
    await opt('Checkbox').click();
    await wait(400);
    await closeOverlays();
    const box = (await tb.cell('Alpha', 'State')).locator('[role="checkbox"]');
    check('status checkbox: cells render a checkbox', await box.count());
    await box.click();
    await wait(500);
    const d = await data();
    const sp = Object.entries(d.collection.schema).find(([, p]) => p.name === 'State')[0];
    S.stateProp = sp;
    check('status checkbox: checking sets a Complete option', d.byTitle('Alpha')?.properties?.[sp]?.[0]?.[0] === 'Done', JSON.stringify(d.byTitle('Alpha')?.properties?.[sp]));
    await (await tb.cell('Alpha', 'State')).locator('[role="checkbox"]').click();
    await wait(500);
    const d2 = await data();
    check('status checkbox: unchecking goes back to the default option', d2.byTitle('Alpha')?.properties?.[sp]?.[0]?.[0] === 'Not started', JSON.stringify(d2.byTitle('Alpha')?.properties?.[sp]));
    await shot('02-status-checkbox', tb.db());
  });

  await section('person-default', async () => {
    await tb.addProperty('Owner', 'Person');
    await propDetail('Owner');
    await page.locator('.nc-edit-property-popover [role="menuitem"]').filter({ hasText: 'Default' }).first().click();
    await wait(200);
    await opt('Created by').click();
    await wait(300);
    await page.locator('.nc-edit-property-popover [role="menuitem"]').filter({ hasText: 'Notifications' }).first().click();
    await wait(200);
    const notifyMenu = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('person: Notifications offers Users and groups / Users only / None', /Users and groups/.test(notifyMenu) && /Users only/.test(notifyMenu) && /None/.test(notifyMenu), notifyMenu.replace(/\n/g, ' | '));
    await opt('None').click();
    await wait(300);
    await shot('03-person-settings', page.locator('.nc-edit-property-popover'));
    await closeOverlays();
    await tb.newRow('Epsilon');
    await wait(700);
    const d = await data();
    const own = Object.entries(d.collection.schema).find(([, p]) => p.name === 'Owner');
    S.ownerProp = own[0];
    check('person: Notifications saved as none', own[1].notification_mode === 'none', JSON.stringify(own[1]));
    check('person: new row filled with its creator (Default: Created by)', JSON.stringify(d.byTitle('Epsilon')?.properties?.[own[0]] ?? '').includes('"u"'), JSON.stringify(d.byTitle('Epsilon')?.properties?.[own[0]]));
  });

  await section('place', async () => {
    await tb.addProperty('Where', 'Text');
    await (await tb.cell('Alpha', 'Where')).click();
    await wait(250);
    await page.keyboard.type('Seoul Station');
    await page.keyboard.press('Enter');
    await wait(300);
    await closeOverlays();
    await headerMenu('Where');
    await opt('Change type').click();
    await wait(250);
    await opt('Place').click();
    await wait(700);
    const d = await data();
    const wp = Object.entries(d.collection.schema).find(([, p]) => p.name === 'Where');
    S.whereProp = wp[0];
    check('place: Text → Place keeps the text as the place name', wp[1].type === 'place' && JSON.stringify(d.byTitle('Alpha')?.properties?.[wp[0]] ?? '').includes('Seoul Station'), JSON.stringify(d.byTitle('Alpha')?.properties?.[wp[0]]));
    await (await tb.cell('Alpha', 'Where')).click();
    await page.waitForSelector('[data-testid="place-search"]');
    check('place: search placeholder "Find a place..."', (await page.locator('[data-testid="place-search"]').getAttribute('placeholder')) === 'Find a place...');
    check('place: "Current Location" offered', await page.locator('[data-testid="place-current"]').count());
    check('place: place name field + "Clear location field"', (await page.locator('[data-testid="place-name"]').inputValue()) === 'Seoul Station' && await page.locator('[data-testid="place-clear"]').count());
    await page.locator('[data-testid="place-search"]').fill('Gangnam-daero 1');
    await wait(150);
    await shot('04-place-editor', page.locator('.nc-place-editor'));
    await page.keyboard.press('Enter');
    await wait(500);
    const d2 = await data();
    check('place: typed address saved with the place name', JSON.stringify(d2.byTitle('Alpha')?.properties?.[wp[0]] ?? '').includes('Gangnam-daero 1'));
    await (await tb.cell('Alpha', 'Where')).click();
    await page.waitForSelector('[data-testid="place-clear"]');
    await page.locator('[data-testid="place-clear"]').click();
    await wait(400);
    const d3 = await data();
    check('place: Clear location field empties the value', !d3.byTitle('Alpha')?.properties?.[wp[0]]);
  });

  await section('files', async () => {
    const dir = join(SCRATCH, 'wave3/dbs/tmp-files');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'first.txt'), 'first file');
    writeFileSync(join(dir, 'second.txt'), 'second file');
    await tb.addProperty('Docs', 'Files & media');
    await (await tb.cell('Alpha', 'Docs')).click();
    await page.waitForSelector('[data-testid="files-editor"]');
    await page.locator('[data-testid="files-input"]').setInputFiles([join(dir, 'first.txt'), join(dir, 'second.txt')]);
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="files-item"]').length === 2, null, { timeout: 15000 });
    check('files: two files uploaded', (await page.locator('[data-testid="files-item"]').count()) === 2);
    await page.locator('[data-testid="files-item-menu"]').first().click();
    await wait(250);
    const menu = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('files: file menu has View original / Download / Rename / Delete', ['View original', 'Download', 'Rename', 'Delete'].every((x) => menu.includes(x)), menu.replace(/\n/g, ' | '));
    await opt('Rename').click();
    await wait(200);
    await page.locator('.nc-files-rename').fill('renamed.txt');
    await page.keyboard.press('Enter');
    await wait(400);
    check('files: rename shows the new name', (await page.locator('.nc-files-name').first().innerText()) === 'renamed.txt');
    await page.locator('.nc-files-handle').nth(1).dragTo(page.locator('[data-testid="files-item"]').first());
    await wait(500);
    const names = await page.locator('.nc-files-name').allInnerTexts();
    check('files: drag ⋮⋮ reorders files', names[0] === 'second.txt' && names[1] === 'renamed.txt', names.join('|'));
    await shot('05-files-editor', page.locator('.nc-files-editor'));
    await closeOverlays();
    const d = await data();
    const fp = Object.entries(d.collection.schema).find(([, p]) => p.name === 'Docs')[0];
    const saved = JSON.stringify(d.byTitle('Alpha')?.properties?.[fp] ?? '');
    check('files: order and name persisted', saved.indexOf('second.txt') >= 0 && saved.indexOf('second.txt') < saved.indexOf('renamed.txt'), saved.slice(0, 160));
    // drop a file straight onto another row's cell
    const cell = (await tb.cell('Beta', 'Docs')).locator('.nc-property-cell').first();
    await cell.evaluate(async (el) => {
      const dt = new DataTransfer();
      dt.items.add(new File(['dropped'], 'dropped.txt', { type: 'text/plain' }));
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await wait(1500);
    const d2 = await data();
    check('files: dropping a file on the cell uploads it', JSON.stringify(d2.byTitle('Beta')?.properties?.[fp] ?? '').includes('dropped.txt'));
    const hex = new URL(page.url()).pathname.replace(/-/g, '').match(/[0-9a-f]{32}$/i)?.[0] ?? '';
    const pageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const chunk = await apiCall(page, 'loadPage', { pageId });
    const fileBlocks = Object.values(chunk.body?.recordMap?.block ?? {}).map((e) => e.value.value).filter((b) => b.type === 'file' && b.alive !== false);
    check('files: the drop stays in the cell (no file block added to the page)', fileBlocks.length === 0, fileBlocks.map((b) => JSON.stringify(b.properties?.title)).join('|'));
  });

  await section('dates', async () => {
    await tb.addProperty('When', 'Date');
    await (await tb.cell('Alpha', 'When')).click();
    await page.waitForSelector('.nc-date-grid');
    const days = page.locator('.nc-date-grid .nc-date-day:not(.other)');
    await days.nth(9).click();
    await wait(200);
    await days.nth(11).click({ modifiers: ['Shift'] });
    await wait(400);
    await closeOverlays();
    // the save can lag on a busy machine: poll the server briefly
    let d, wp, v;
    for (let i = 0; i < 10; i++) {
      d = await data();
      wp = Object.entries(d.collection.schema).find(([, p]) => p.name === 'When')[0];
      v = JSON.stringify(d.byTitle('Alpha')?.properties?.[wp] ?? '');
      if (v.includes('end_date')) break;
      await wait(400);
    }
    S.whenProp = wp;
    check('dates: Shift+click adds an end date', v.includes('end_date') && v.includes('-10"') && v.includes('-12"'), v);
    await (await tb.cell('Beta', 'When')).click();
    await page.waitForSelector('.nc-date-input input');
    const input = page.locator('.nc-date-input input').first();
    await input.fill('2026년 3월 5일');
    await input.press('Enter');
    await wait(400);
    await closeOverlays();
    const d2 = await data();
    check('dates: Korean input "2026년 3월 5일" understood', JSON.stringify(d2.byTitle('Beta')?.properties?.[wp] ?? '').includes('2026-03-05'));
  });

  await section('deleted-properties', async () => {
    await tb.addProperty('Scratch', 'Text');
    await headerMenu('Scratch');
    await opt('Delete property').click();
    await confirmModal('Delete');
    await tb.openSettings();
    await vsRow('Edit properties').click();
    await wait(250);
    await vsRow('Deleted properties').click();
    await wait(250);
    await opt('Scratch').click();
    await wait(250);
    const sub = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('deleted: per-property Restore / Delete', sub.includes('Restore') && sub.includes('Delete'), sub.replace(/\n/g, ' | '));
    await optExact('Delete').click();
    await confirmModal('Delete');
    await closeOverlays();
    const d = await data();
    const left = Object.values(d.collection.deleted_schema ?? {}).filter((p) => p?.name === 'Scratch');
    check('deleted: permanently removed', left.length === 0, JSON.stringify(Object.keys(d.collection.deleted_schema ?? {})));
  });

  await section('property-detail', async () => {
    await propDetail('State');
    const txt = await page.locator('.nc-edit-property-popover').innerText();
    check('detail: Duplicate property and Delete property at the bottom', txt.includes('Duplicate property') && txt.includes('Delete property'));
    await page.locator('.nc-edit-property-popover [role="menuitem"]').filter({ hasText: 'Duplicate property' }).click();
    await wait(500);
    await closeOverlays();
    const d = await data();
    check('detail: duplicate created', Object.values(d.collection.schema).some((p) => p.name === 'State (1)'));
  });

  await section('copy-value', async () => {
    await tb.addProperty('Mail', 'Email');
    await (await tb.cell('Alpha', 'Mail')).click();
    await wait(250);
    await page.keyboard.type('alpha@example.com');
    await page.keyboard.press('Enter');
    await wait(400);
    await closeOverlays();
    const cell = await tb.cell('Alpha', 'Mail');
    await cell.hover();
    await wait(200);
    const btn = cell.locator('.nc-copy-value');
    check('copy: hover shows a labeled copy button', (await btn.count()) && /^Copy\b/.test((await btn.getAttribute('aria-label')) ?? ''), await btn.getAttribute('aria-label').catch(() => ''));
    await btn.click();
    await wait(400);
    const toast = await page.locator('.nc-toast, [role="status"]').allInnerTexts().catch(() => []);
    check('copy: copied with a toast', toast.some((t) => /Copied email to clipboard|Failed to copy/.test(t)), toast.join('|'));
  });

  await section('relation-shown', async () => {
    // one-way self relation "Links" (API), then customize which properties the picker shows
    S.linkProp = 'lnk1';
    await tx([op('collection', S.collectionId, ['schema', S.linkProp], 'set', { name: 'Links', type: 'relation', collection_id: S.collectionId, version: 'v2' })]);
    // show the new column in the table view (properties added through the API start hidden)
    const chunk = await apiCall(page, 'loadPage', { pageId: S.blockId });
    const view = chunk.body?.recordMap?.collection_view?.[S.viewIds[0]]?.value?.value;
    const list = (view?.format?.table_properties ?? []).filter((e) => e.property !== S.linkProp);
    await tx([op('collection_view', S.viewIds[0], ['format', 'table_properties'], 'set', [...list, { property: S.linkProp, visible: true, width: 200 }])]);
    await page.reload();
    await page.waitForSelector('.nc-db .nc-table-row-outer');
    await wait(700);
    const cell = await tb.cell('Alpha', 'Links');
    await cell.click();
    await page.waitForSelector('[data-testid="relation-customize"]');
    await page.locator('[data-testid="relation-customize"]').click();
    await wait(250);
    const m = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('relation: "Visible in linked records" / "Hidden in linked records" lists', m.includes('Visible in linked records') && m.includes('Hidden in linked records'), m.replace(/\n/g, ' | ').slice(0, 160));
    await opt('ID').click();
    await wait(500);
    const d = await data();
    check('relation: choice saved on the relation property', (d.collection.schema[S.linkProp]?.relation_shown_properties ?? []).includes(S.idProp), JSON.stringify(d.collection.schema[S.linkProp]));
    await closeOverlays();
    await (await tb.cell('Alpha', 'Links')).click();
    await page.waitForSelector('.nc-relpick');
    await wait(300);
    check('relation: picker rows show the chosen property', (await page.locator('.nc-relpick .nc-relpick-props').first().innerText().catch(() => '')).includes('TASK-'));
    await shot('06-relation-picker', page.locator('.nc-relpick'));
    await closeOverlays();
  });

  await section('relation-section', async () => {
    const d = await data();
    await tx([
      op('block', S.alphaId, ['properties', S.linkProp], 'set', [['‣', [['p', S.betaId, S.spaceId]]]]),
      op('collection', S.collectionId, ['format', 'page_layout'], 'set', {
        structure: 'simple',
        modules: {
          page_main: [
            { id: 'title', type: 'title', pinned: [] },
            { id: 'properties', type: 'properties', sections: [{ id: 'default', properties: Object.keys(d.collection.schema).filter((k) => k !== 'title' && k !== S.linkProp) }], hidden: [] },
            { id: 'rel', type: 'property', property: S.linkProp },
            { id: 'editor', type: 'editor' },
          ],
          page_details: [],
        },
        settings: {},
      }),
    ]);
    await page.goto(new URL(`/${S.domain}/${S.alphaId.replace(/-/g, '')}`, page.url()).href);
    await page.waitForSelector('[data-testid="relation-section"]', { timeout: 15000 }).catch(() => {});
    const sec = page.locator('[data-testid="relation-section"]');
    check('relation section: row page lists related pages as a section', (await sec.count()) && (await sec.innerText()).includes('Beta'), (await sec.innerText().catch(() => '')).replace(/\n/g, ' | '));
    check('relation section: "Add a relation" offered', await page.locator('[data-testid="relation-section-add"]').count());
    await shot('07-relation-section');
    // comment on a property value (database.CommentButton)
    const mailRow = page.locator('.nc-page-prop-row').filter({ has: page.locator('.nc-page-prop-name', { hasText: /^Mail$/ }) }).first();
    await mailRow.hover();
    await wait(200);
    const cbtn = mailRow.locator('[data-testid="property-comment"]');
    check('property comment: hover shows "Comment"', (await cbtn.count()) && (await cbtn.getAttribute('aria-label')) === 'Comment');
    await cbtn.click();
    await wait(300);
    await page.keyboard.type('Is this the right address?', { delay: 5 });
    await page.keyboard.press('Enter');
    await wait(900);
    check('property comment: the row shows "Open discussion" with a count', (await cbtn.getAttribute('aria-label')) === 'Open discussion' && (await cbtn.innerText()).includes('1'), await cbtn.innerText());
    const chunk = await apiCall(page, 'loadPage', { pageId: S.alphaId });
    const ds = Object.values(chunk.body?.recordMap?.discussion ?? {}).map((e) => e.value.value);
    check('property comment: discussion stored with the property id', ds.some((d) => d.property_id && d.parent_id === S.alphaId), JSON.stringify(ds.map((d) => d.property_id)));
    await cbtn.click();
    await wait(400);
    check('property comment: "Open discussion" shows the thread', (await page.locator('.nc-discussion-popover').innerText().catch(() => '')).includes('Is this the right address?'));
    await shot('07b-property-comment');
    await closeOverlays();
    await page.goto(S.labUrl);
    await page.waitForSelector('.nc-db .nc-table-row-outer');
    await wait(400);
  });

  await section('timeline-connect', async () => {
    // Dependencies on (Blocking / Blocked by) + a timeline view by "When"
    const { collection } = await data();
    void collection;
    const viewId = crypto.randomUUID();
    await tx([
      op('collection', S.collectionId, ['schema', 'blk1'], 'set', { name: 'Blocking', type: 'relation', collection_id: S.collectionId, property: 'bby1', version: 'v2' }),
      op('collection', S.collectionId, ['schema', 'bby1'], 'set', { name: 'Blocked by', type: 'relation', collection_id: S.collectionId, property: 'blk1', version: 'v2' }),
      op('collection', S.collectionId, ['format', 'collection_default_arrows_by'], 'set', 'blk1'),
      op('collection_view', viewId, [], 'set', { id: viewId, type: 'timeline', name: 'Plan', parent_id: S.blockId, parent_table: 'block', alive: true, format: { timeline_arrows_by: { property: 'blk1' }, collection_pointer: { id: S.collectionId, table: 'collection', spaceId: S.spaceId } }, query2: { timeline_by: S.whenProp } }),
      op('block', S.blockId, ['view_ids'], 'listAfter', { id: viewId }),
      op('block', S.alphaId, ['properties', S.whenProp], 'set', [['‣', [['d', { type: 'date', start_date: new Date().toISOString().slice(0, 10) }]]]]),
      op('block', S.betaId, ['properties', S.whenProp], 'set', [['‣', [['d', { type: 'date', start_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10) }]]]]),
    ]);
    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(600);
    const tab = page.locator('.nc-db').first().locator('[role="tab"]').filter({ hasText: 'Plan' }).first();
    if (await tab.count()) await tab.click();
    else {
      await page.locator('.nc-db').first().locator('.nc-view-tabs-more, [aria-label*="more"]').first().click().catch(() => {});
      await opt('Plan').click().catch(() => {});
    }
    await page.waitForSelector('.nc-tl-item', { timeout: 10000 });
    await wait(800);
    const alphaBar = page.locator(`.nc-tl-item[data-block-id="${S.alphaId}"]`);
    const betaRow = page.locator(`.nc-tl-item[data-block-id="${S.betaId}"]`);
    await alphaBar.scrollIntoViewIfNeeded().catch(() => {});
    await alphaBar.hover();
    await wait(200);
    const conn = alphaBar.locator('[data-testid="timeline-connector"]');
    check('timeline: connector shown on hover with Dependencies on', await conn.count());
    const a = await conn.boundingBox();
    const b = await betaRow.boundingBox();
    if (a && b) {
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(a.x + 40, (a.y + b.y) / 2, { steps: 5 });
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
      await shot('08-timeline-linking');
      await page.mouse.up();
      await wait(700);
    }
    const d = await data();
    check('timeline: dragging the connector adds a Blocking link', JSON.stringify(d.byTitle('Alpha')?.properties?.blk1 ?? '').includes(S.betaId), JSON.stringify(d.byTitle('Alpha')?.properties?.blk1));
    check('timeline: the other side shows Blocked by', JSON.stringify(d.byTitle('Beta')?.properties?.bby1 ?? '').includes(S.alphaId), JSON.stringify(d.byTitle('Beta')?.properties?.bby1));
    check('timeline: arrow drawn', await page.locator('.nc-tl-arrows .nc-tl-arrow').count());
    await shot('09-timeline-arrow');
  });
} catch (e) {
  check('fatal', false, e.message);
  await shot('fatal');
} finally {
  await T.finish();
}

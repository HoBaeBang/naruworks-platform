
// label, pin heading properties, sections, property modules, details panel, page settings, Apply to all pages
// (persisted, used by every page), Cancel / Reset, locked databases. Run: NC_BASE=http://127.0.0.1:5431 node e2e/db-layout.mjs
import { apiCall, createInlineDb, esc, freshPage, setup, tableHelpers } from './db-lib.mjs';

const T = await setup('db-layout');
const { page, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);
const opt = (label) => page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${esc(label)}`) }).first();
const lb = () => page.locator('.nc-lb');

async function collectionOf() {
  const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id').catch(() => null);
  const r = await apiCall(page, 'loadPage', { pageId: blockId });
  const b = r.body?.recordMap?.block?.[blockId]?.value?.value;
  const rows = await apiCall(page, 'loadCollectionRows', { collectionId: b?.collection_id });
  return rows.body?.recordMap?.collection?.[b?.collection_id]?.value?.value;
}
async function openRow(title) {
  await tb.rowByTitle(title).hover();
  await tb.rowByTitle(title).locator('.nc-open-button').click();
  await page.waitForSelector('.nc-row-props');
  await wait(400);
}
const peek = () => page.locator('.nc-peek, [data-peek], .lit-peek-renderer').first();

try {
  await freshPage(page, 'Layout Lab');
  await createInlineDb(page, 'Projects');
  await tb.addProperty('Status', 'Status');
  await tb.addProperty('Priority', 'Select');
  await tb.addProperty('Notes', 'Text');
  await tb.newRow('Alpha');
  await tb.newRow('Beta');
  const col0 = await collectionOf();

  await section('builder', async () => {
    await openRow('Alpha');
    await page.locator('.nc-page-prop-label-button', { hasText: 'Status' }).first().click();
    await wait(200);
    check('builder: label menu offers "Customize layout"', await opt('Customize layout').count());
    await opt('Customize layout').click();
    await page.waitForSelector('.nc-lb', { timeout: 5000 });
    await wait(300);
    check('builder: header shows the database name', (await lb().locator('.nc-lb-dbname').innerText()).includes('Projects'));
    check('builder: "Preview: Alpha"', (await lb().locator('.nc-lb-preview').innerText()).replace(/\s+/g, ' ').includes('Preview: Alpha'));
    check('builder: Cancel + Apply to all entries', (await lb().locator('[data-testid="layout-cancel"]').count()) && (await lb().locator('[data-testid="layout-apply"]').innerText()).includes('Apply to all entries'));
    check('builder: Page settings with Structure Simple / Tabbed', (await lb().locator('.nc-lb-side-title').innerText()) === 'Page settings' && (await lb().locator('[data-testid="structure-tabbed"]').count()));
    check('builder: education tooltip "Start creating your layout"', await lb().locator('.nc-lb-tip', { hasText: 'Start creating your layout' }).count());
    check('builder: modules Heading / Property group / Page discussions / Content', (await lb().locator('.nc-lb-main .nc-lb-module').count()) === 4);
    await shot('01-builder');
    // (heading-pins)
    await lb().locator('.nc-lb-module.type-title').click();
    await wait(200);
    check('heading: sidebar shows Pinned / Unpinned properties', (await lb().locator('.nc-lb-side-heading', { hasText: 'Pinned properties' }).count()) && (await lb().locator('.nc-lb-side-heading', { hasText: 'Unpinned properties' }).count()));
    await lb().locator('.nc-lb-pin-row', { hasText: 'Status' }).locator('.nc-lb-pin').click();
    await wait(200);
    check('heading: Status pinned in the preview', await lb().locator('.nc-lb-pinned-prop', { hasText: 'Status' }).count());
    await shot('02-pinned');
    // (group-sections)
    await lb().locator('.nc-lb-module.type-properties').click();
    await wait(200);
    check('group: sidebar "Property group" with search', (await lb().locator('.nc-lb-side-title').innerText()) === 'Property group' && (await lb().locator('.nc-lb-search input').count()));
    await lb().locator('[data-testid="layout-add-section"]').click();
    await wait(200);
    check('group: "New section" added', await lb().locator('.nc-lb-group-section-head', { hasText: 'New section' }).count());
    await lb().locator('.nc-lb-group-prop', { hasText: 'Notes' }).locator('.nc-lb-eye').click();
    await wait(150);
    check('group: hidden property leaves the preview', !(await lb().locator('.nc-lb-module.type-properties .nc-lb-prop-row', { hasText: 'Notes' }).count()));
    await lb().locator('.nc-lb-group-prop', { hasText: 'Notes' }).locator('.nc-lb-eye').click();
    await wait(150);
    // (modules)
    // "+" after the property group → Use an existing field › Notes
    const slot = lb().locator('.nc-lb-slot').filter({ has: page.locator('.nc-lb-module.type-properties') });
    await slot.hover();
    await slot.locator('.nc-lb-add').click({ force: true });
    await wait(250);
    check('modules: add menu sections', (await page.locator('.nc-menu-section-title, .nc-menu-section-title-text', { hasText: 'Use an existing field' }).count()) > 0);
    await opt('Notes').click();
    await wait(250);
    check('modules: Notes became its own module', await lb().locator('.nc-lb-module.type-property', { hasText: 'Notes' }).count());
    await lb().locator('[data-testid="layout-add-to-panel"]').click();
    await wait(250);
    await opt('Priority').click();
    await wait(250);
    check('modules: Priority added to the details panel', await lb().locator('.nc-lb-panel .nc-lb-module.type-property', { hasText: 'Priority' }).count());
    // page settings: property icons off
    await lb().locator('.nc-lb-canvas').click({ position: { x: 10, y: 10 } });
    await wait(150);
    await lb().locator('[data-testid="setting-icons"]').click();
    await wait(150);
    await shot('03-modules');
    // (apply)
    await lb().locator('[data-testid="layout-apply"]').click();
    await wait(600);
    check('apply: builder closed', !(await lb().count()));
    const col = await collectionOf();
    const L = col?.format?.page_layout;
    check('apply: layout stored on the data source', !!L && L.modules.page_main[0].pinned.includes(Object.keys(col.schema).find((k) => col.schema[k].name === 'Status')) && L.settings.property_icons === false, JSON.stringify(L ?? null).slice(0, 160));
    check('apply: page shows the pinned Status', await page.locator('.nc-pinned-prop', { hasText: 'Status' }).count());
    check('apply: page shows the Notes module', await page.locator('.nc-layout-prop-module', { hasText: 'Notes' }).count());
    check('apply: property icons hidden', await page.locator('.nc-row-props.no-icons').count());
    check('apply: "Hide details" toggle + panel with Priority', (await page.locator('[data-testid="toggle-details"]').count()) && (await page.locator('.nc-row-details-panel', { hasText: 'Priority' }).count()));
    await shot('04-applied-page');
    await page.locator('[data-testid="toggle-details"]').click();
    await wait(200);
    check('apply: "View details" hides the panel', !(await page.locator('.nc-row-details-panel').count()) && (await page.locator('[data-testid="toggle-details"]').innerText()).includes('View details'));
    await page.locator('[data-testid="toggle-details"]').click();
    await wait(200);
  });

  await section('all-pages', async () => {
    await page.keyboard.press('Escape');
    await wait(300);
    await openRow('Beta');
    check('all pages: another page uses the same layout', (await page.locator('.nc-pinned-prop', { hasText: 'Status' }).count()) && (await page.locator('.nc-layout-prop-module', { hasText: 'Notes' }).count()));
    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(500);
    await openRow('Alpha');
    check('all pages: layout persists after reload', await page.locator('.nc-pinned-prop', { hasText: 'Status' }).count());
  });

  await section('cancel-reset', async () => {
    await page.locator('.nc-layout-prop-module-label', { hasText: 'Notes' }).first().click();
    await wait(150);
    await opt('Customize layout').click();
    await page.waitForSelector('.nc-lb');
    await lb().locator('.nc-lb-module.type-title').click();
    await lb().locator('.nc-lb-pin-row', { hasText: 'Priority' }).locator('.nc-lb-pin').click().catch(() => {});
    await wait(150);
    await lb().locator('[data-testid="layout-cancel"]').click();
    await wait(200);
    check('cancel: asks "Discard all layout changes?"', await page.locator('.nc-confirm', { hasText: 'Discard all layout changes?' }).count());
    await page.locator('.nc-confirm button', { hasText: 'Discard' }).click();
    await wait(300);
    check('cancel: builder closed without saving', !(await lb().count()) && !(await page.locator('.nc-pinned-prop', { hasText: 'Priority' }).count()));
    await page.locator('.nc-layout-prop-module-label', { hasText: 'Notes' }).first().click();
    await wait(150);
    await opt('Customize layout').click();
    await page.waitForSelector('.nc-lb');
    await lb().locator('.nc-lb-apply-more').click();
    await wait(150);
    await opt('Reset to original entry layout').click();
    await wait(200);
    await page.locator('.nc-confirm button', { hasText: 'Reset' }).click();
    await wait(500);
    const col = await collectionOf();
    check('reset: layout removed (original page layout)', !col?.format?.page_layout && !(await page.locator('.nc-pinned-prop').count()));
  });

  await section('locked', async () => {
    await page.keyboard.press('Escape');
    await wait(200);
    await tb.openSettings();
    await page.locator('[data-testid="lock-database"]').click();
    await wait(300);
    await closeOverlays();
    await openRow('Alpha');
    await page.locator('.nc-page-prop-label-button').first().click();
    await wait(200);
    const item = opt('Customize layout');
    check('locked: "Customize layout" disabled with the unlock hint', (await item.getAttribute('aria-disabled')) === 'true' && (await item.innerText()).includes('Unlock this table to adjust its layout.'));
  });
  void col0;
} catch (e) {
  check('fatal', false, e.message);
  await shot('fatal');
} finally {
  await T.finish();
}

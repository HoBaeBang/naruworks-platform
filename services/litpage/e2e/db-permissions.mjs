// Database lock + permissions E2E (DB-PERM-*): "Lock database" freezes views/properties but keeps data entry open
// (client and server), database share roles (Can edit content / Can also create pages), page-level access rules and
// property access. Run: NC_BASE=http://127.0.0.1:5431 node e2e/db-permissions.mjs
import { apiCall, createInlineDb, freshPage, setup, tableHelpers } from './db-lib.mjs';
import { signup } from './lib.mjs';

const T = await setup('db-permissions');
const { page, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);

async function ids() {
  const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
  const r = await apiCall(page, 'loadPage', { pageId: blockId });
  const b = r.body?.recordMap?.block?.[blockId]?.value?.value;
  return { blockId, collectionId: b?.collection_id, viewId: b?.view_ids?.[0], spaceId: b?.space_id };
}
async function tx(spaceId, operations, p = page) {
  return apiCall(p, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations }] });
}
const uuidOf = (url) => {
  const hex = new URL(url).pathname.replace(/-/g, '').match(/[0-9a-f]{32}$/i)?.[0] ?? '';
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
async function userIdOf(p) {
  const r = await apiCall(p, 'loadAccountData', {});
  return Object.keys(r.body?.recordMap?.user_root ?? {})[0] ?? null;
}
async function rowsAs(p, collectionId) {
  const r = await apiCall(p, 'loadCollectionRows', { collectionId });
  const rm = r.body?.recordMap ?? {};
  return {
    status: r.status,
    collection: rm.collection?.[collectionId]?.value?.value,
    rows: Object.values(rm.block ?? {}).map((e) => e.value.value).filter((b) => b.parent_id === collectionId && b.alive !== false && !b.is_template),
  };
}
const titleOf = (b) => (b?.properties?.title ?? []).map((x) => x[0]).join('');

try {
  await freshPage(page, 'Perm Lab');

  await section('lock', async () => {
    await createInlineDb(page, 'Projects');
    await tb.addProperty('Status', 'Status');
    await tb.addProperty('Priority', 'Select');
    await tb.newRow('Alpha');
    await tb.newRow('Beta');
    await (await tb.cell('Alpha', 'Priority')).click();
    await page.waitForSelector('.nc-select-editor');
    await page.keyboard.type('High');
    await page.keyboard.press('Enter');
    await wait(200);
    await closeOverlays();

    await tb.openSettings();
    const lockRow = page.locator('[data-testid="lock-database"]');
    check('lock: View settings shows "Lock database"', (await lockRow.innerText()).includes('Lock database'));
    await lockRow.click();
    await wait(350);
    check('lock: row turns into "Unlock database"', (await lockRow.innerText()).includes('Unlock database'));
    await shot('01-locked-settings');
    await closeOverlays();
    await page.mouse.move(1300, 800);
    await tb.db().hover();
    await wait(200);
    check('lock: "+ Add property" hidden while locked', !(await tb.db().locator('[data-testid="add-column-button"]').count()));
    check('lock: "New page" row still offered', await tb.db().locator('.lit-table-view-add-row').count());
    await tb.newRow('Gamma');
    check('lock: rows can still be added', (await tb.titles()).includes('Gamma'));
    await (await tb.cell('Beta', 'Status')).click();
    await page.waitForSelector('.nc-select-editor');
    await page.locator('.nc-select-option').filter({ hasText: 'In progress' }).first().click();
    await wait(250);
    await closeOverlays();
    check('lock: cell values stay editable', (await (await tb.cell('Beta', 'Status')).innerText()).includes('In progress'));
    await (await tb.cell('Beta', 'Priority')).click();
    await page.waitForSelector('.nc-select-editor');
    await page.keyboard.type('Urgent');
    await wait(200);
    check('lock: select editor offers no "Create" for new options', !(await page.locator('.nc-select-option.create').count()));
    await page.keyboard.press('Backspace');
    await closeOverlays();
    await shot('02-locked-table');

    // server: structure writes are rejected while locked, data writes go through
    const { spaceId, collectionId, viewId, blockId } = await ids();
    check('lock: database ids resolved', !!collectionId && !!viewId, JSON.stringify({ collectionId, viewId }));
    const addProp = await tx(spaceId, [{ pointer: { table: 'collection', id: collectionId, spaceId }, path: ['schema', 'zzzz'], command: 'set', args: { name: 'Hack', type: 'text' } }]);
    check('lock: server rejects schema change (403)', addProp.status === 403, `${addProp.status} ${addProp.body?.message ?? ''}`);
    const viewFmt = await tx(spaceId, [{ pointer: { table: 'collection_view', id: viewId, spaceId }, path: ['format'], command: 'update', args: { table_wrap: false } }]);
    check('lock: server rejects view change (403)', viewFmt.status === 403, `${viewFmt.status}`);
    const trash = await tx(spaceId, [{ pointer: { table: 'block', id: blockId, spaceId }, path: [], command: 'update', args: { alive: false } }]);
    check('lock: server refuses to trash a locked database', trash.status === 403 && /Unlock this database/.test(trash.body?.message ?? ''), `${trash.status} ${trash.body?.message ?? ''}`);
    const rowId = crypto.randomUUID();
    const now = Date.now();
    const addRow = await tx(spaceId, [{ pointer: { table: 'block', id: rowId, spaceId }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: collectionId, parent_table: 'collection', alive: true, properties: { title: [['From API']] }, created_time: now, last_edited_time: now } }]);
    check('lock: server accepts new rows (200)', addRow.status === 200, `${addRow.status} ${addRow.body?.message ?? ''}`);

    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(600);
    const t = await tb.titles();
    check('lock: rows persist after reload (incl. API row)', t.includes('Gamma') && t.includes('From API'), t.join('|'));
    check('lock: Status edit persisted', (await (await tb.cell('Beta', 'Status')).innerText()).includes('In progress'));

    await tb.openSettings();
    await page.locator('[data-testid="lock-database"]').click();
    await wait(300);
    await closeOverlays();
    await tb.db().hover();
    await wait(200);
    check('lock: unlocking brings "+ Add property" back', await tb.db().locator('[data-testid="add-column-button"]').count());
    const addProp2 = await tx(spaceId, [{ pointer: { table: 'collection', id: collectionId, spaceId }, path: ['schema', 'zzzy'], command: 'set', args: { name: 'Allowed', type: 'text' } }]);
    check('lock: schema changes allowed again after unlock', addProp2.status === 200, `${addProp2.status}`);
  });

  // ---------------------------------------------------------------- database share roles (second person)
  const ctxB = await T.browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 1, locale: 'en-US' });
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', (e) => T.pageErrors.push(`[B] ${e.message}`));
  const emailB = `perm-b-${Date.now()}@test.dev`;
  const tbB = tableHelpers(pageB, 0);
  const S = {};
  const headerNames = async (p) => p.locator('.nc-db').first().locator('.lit-table-view-header-cell .nc-th-name').allInnerTexts();
  async function openShare() {
    await page.locator('.lit-topbar-share-menu').first().click();
    await page.waitForSelector('.nc-share-people .nc-share-row.person');
    await wait(400);
  }
  async function roleRowB() {
    return page.locator('.nc-share-row.person').filter({ hasText: emailB }).first();
  }
  async function pickRoleForB(label) {
    await (await roleRowB()).locator('.nc-share-role').click();
    await wait(250);
    await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: new RegExp(`^\\s*${label}`) }).first().click();
    await wait(500);
  }

  await section('share-roles', async () => {
    await page.locator('h1[data-content-editable-leaf]').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/database full', { delay: 12 });
    await wait(500);
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /Database( -)? full page/i }).first().click();
    await page.waitForSelector('.nc-db');
    await wait(900);
    S.dbUrl = page.url();
    S.blockId = uuidOf(S.dbUrl);
    const chunk = await apiCall(page, 'loadPage', { pageId: S.blockId });
    const blk = chunk.body?.recordMap?.block?.[S.blockId]?.value?.value;
    S.collectionId = blk?.collection_id;
    S.viewId = blk?.view_ids?.[0];
    S.spaceId = blk?.space_id;
    check('roles: full-page database created', blk?.type === 'collection_view_page' && !!S.collectionId, blk?.type);
    const tbA = tableHelpers(page, 0);
    await tbA.addProperty('Owner', 'Person');
    await tbA.addProperty('Notes', 'Text');
    const existing = await rowsAs(page, S.collectionId);
    if (existing.rows.length) await tx(S.spaceId, existing.rows.map((r) => ({ pointer: { table: 'block', id: r.id, spaceId: S.spaceId }, path: [], command: 'update', args: { alive: false } })));
    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(500);
    await tbA.newRow('R1');
    await tbA.newRow('R2');
    S.ownerProp = await tbA.colId('Owner');
    S.notesProp = await tbA.colId('Notes');
    const rs = await rowsAs(page, S.collectionId);
    S.r1 = rs.rows.find((r) => titleOf(r) === 'R1')?.id;
    S.r2 = rs.rows.find((r) => titleOf(r) === 'R2')?.id;
    check('roles: rows R1/R2 exist', !!S.r1 && !!S.r2, rs.rows.map(titleOf).join('|'));

    await signup(pageB, emailB, 'Bea Guest', 'Bea Space');
    S.userB = await userIdOf(pageB);
    const inv = await apiCall(page, 'invitePagePermissions', { pageId: S.blockId, emails: [emailB], role: 'reader' });
    check('roles: invited the second person (Can view)', inv.status === 200, `${inv.status} ${inv.body?.message ?? ''}`);

    await openShare();
    await (await roleRowB()).locator('.nc-share-role').click();
    await wait(300);
    const menuText = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('roles: database role picker offers "Can edit content"', menuText.includes('Can edit content'), menuText.replace(/\n/g, ' | ').slice(0, 200));
    check('roles: role picker offers "Can also create entries" and "Can only create"', menuText.includes('Can also create entries') && menuText.includes('Can only create'), menuText.replace(/\n/g, ' | ').slice(-200));
    await shot('10-role-picker');
    await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: /^\s*Can edit content/ }).first().click();
    await wait(600);
    check('roles: person row shows "Can edit content"', (await (await roleRowB()).locator('.nc-share-role').innerText()).includes('Can edit content'));
    check('roles: "Entry-level access" section shown for the database', await page.locator('[data-testid="entry-level-access"]').count());
    await shot('11-share-content-editor');
    await closeOverlays();

    // B: content editor — rows yes, structure no
    await pageB.goto(S.dbUrl);
    await pageB.waitForSelector('.nc-db .nc-table-row-outer', { timeout: 15000 });
    await pageB.waitForTimeout(800);
    check('content editor: sees the rows', (await tbB.titles()).includes('R1'));
    await tbB.db().hover();
    await pageB.waitForTimeout(200);
    check('content editor: "+ Add property" not offered', !(await tbB.db().locator('[data-testid="add-column-button"]').count()));
    check('content editor: "New page" row offered', await tbB.db().locator('.lit-table-view-add-row').count());
    await tbB.newRow('From B');
    check('content editor: can add a row', (await tbB.titles()).includes('From B'));
    await (await tbB.cell('R1', 'Notes')).click();
    await pageB.waitForTimeout(250);
    await pageB.keyboard.type('note by B');
    await pageB.keyboard.press('Enter');
    await pageB.waitForTimeout(500);
    const afterEdit = await rowsAs(page, S.collectionId);
    const r1 = afterEdit.rows.find((r) => r.id === S.r1);
    check('content editor: cell edit saved (seen by the owner)', JSON.stringify(r1?.properties?.[S.notesProp] ?? '').includes('note by B'));
    const schemaHack = await tx(S.spaceId, [{ pointer: { table: 'collection', id: S.collectionId, spaceId: S.spaceId }, path: ['schema', 'hack'], command: 'set', args: { name: 'Hack', type: 'text' } }], pageB);
    check('content editor: server rejects property changes', schemaHack.status === 403, `${schemaHack.status}`);
    const viewHack = await tx(S.spaceId, [{ pointer: { table: 'collection_view', id: S.viewId, spaceId: S.spaceId }, path: ['format'], command: 'update', args: { table_wrap: false } }], pageB);
    check('content editor: server rejects view changes', viewHack.status === 403, `${viewHack.status}`);
    await shot('12-content-editor-view', pageB.locator('.nc-db').first());
  });

  await section('can-create', async () => {
    await page.goto(S.dbUrl);
    await page.waitForSelector('.nc-db');
    await wait(500);
    await openShare();
    await (await roleRowB()).locator('.nc-share-role').click();
    await wait(300);
    await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: /^\s*Can only create/ }).first().click();
    await page.waitForSelector('[data-testid="create-creator-rule"]', { timeout: 5000 });
    check('can create: asks "How much access should entry creators get?"', (await page.locator('.nc-perm-modal').innerText()).includes('How much access should entry creators get?'));
    await shot('13-creator-access');
    await page.locator('[data-testid="create-creator-rule"]').click();
    await wait(700);
    check('can create: person row shows "Can only create"', (await (await roleRowB()).locator('.nc-share-role').innerText()).includes('Can only create'));
    check('can create: page-level rule "Anyone in Created by" added', (await page.locator('[data-testid="entry-level-access"]').innerText()).includes('Anyone in Created by'));
    await shot('14-share-only-create');
    await closeOverlays();

    const asB = await rowsAs(pageB, S.collectionId);
    const tB = asB.rows.map(titleOf);
    check('can create: only the pages they created are readable', tB.includes('From B') && !tB.includes('R1') && !tB.includes('R2'), tB.join('|'));
    await pageB.reload();
    await pageB.waitForSelector('.nc-db', { timeout: 15000 });
    await pageB.waitForTimeout(900);
    check('can create: database still opens, other rows hidden', !(await tbB.titles()).includes('R2'), (await tbB.titles()).join('|'));
    await tbB.newRow('Made by B');
    await pageB.waitForTimeout(400);
    const asB2 = await rowsAs(pageB, S.collectionId);
    const made = asB2.rows.find((r) => titleOf(r) === 'Made by B');
    check('can create: new page created and kept', !!made, asB2.rows.map(titleOf).join('|'));
    if (made) {
      const edit = await tx(S.spaceId, [{ pointer: { table: 'block', id: made.id, spaceId: S.spaceId }, path: ['properties', S.notesProp], command: 'set', args: [['mine']] }], pageB);
      check('can create: creator can edit their page (rule)', edit.status === 200, `${edit.status} ${edit.body?.message ?? ''}`);
    }
    const editR2 = await tx(S.spaceId, [{ pointer: { table: 'block', id: S.r2, spaceId: S.spaceId }, path: ['properties', S.notesProp], command: 'set', args: [['nope']] }], pageB);
    check('can create: server refuses edits to other pages', editR2.status === 403 || editR2.status === 404, `${editR2.status}`);
  });

  await section('page-rule', async () => {
    await openShare();
    await page.locator('[data-testid="add-page-rule"]').click();
    await page.waitForSelector('.nc-perm-creator');
    await page.locator('.nc-perm-option').filter({ hasText: 'Owner' }).first().click();
    await page.locator('[data-testid="create-rule"]').click();
    await wait(600);
    check('page rule: "Anyone in Owner" rule listed', (await page.locator('[data-testid="entry-level-access"]').innerText()).includes('Anyone in Owner'));
    await shot('15-page-rules');
    await closeOverlays();
    const before = (await rowsAs(pageB, S.collectionId)).rows.map(titleOf);
    check('page rule: R1 hidden before B is the owner', !before.includes('R1'), before.join('|'));
    const setOwner = await tx(S.spaceId, [{ pointer: { table: 'block', id: S.r1, spaceId: S.spaceId }, path: ['properties', S.ownerProp], command: 'set', args: [['‣', [['u', S.userB]]]] }]);
    check('page rule: owner set on R1', setOwner.status === 200, `${setOwner.status}`);
    const after = (await rowsAs(pageB, S.collectionId)).rows.map(titleOf);
    check('page rule: R1 readable once B is in Owner', after.includes('R1') && !after.includes('R2'), after.join('|'));
    const edit = await tx(S.spaceId, [{ pointer: { table: 'block', id: S.r1, spaceId: S.spaceId }, path: ['properties', 'title'], command: 'set', args: [['R1 (edited by B)']] }], pageB);
    check('page rule: "Can edit" rule lets B edit R1', edit.status === 200, `${edit.status} ${edit.body?.message ?? ''}`);
    const bad = await tx(S.spaceId, [{ pointer: { table: 'collection', id: S.collectionId, spaceId: S.spaceId }, path: ['permission_rules'], command: 'set', args: [] }], pageB);
    check('page rule: only full access may change rules (server)', bad.status === 403, `${bad.status}`);
  });

  await section('property-access', async () => {
    // B back to "Can edit content" so rows are editable, then restrict Notes
    await openShare();
    await pickRoleForB('Can edit content');
    await closeOverlays();
    await page.goto(S.dbUrl);
    await page.waitForSelector('.nc-db');
    await wait(500);
    const tbA = tableHelpers(page, 0);
    await tbA.db().locator('.lit-table-view-header-cell').filter({ has: page.locator('.nc-th-name', { hasText: /^Notes$/ }) }).first().click();
    await wait(300);
    await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: /^\s*Property access/ }).first().click();
    await page.waitForSelector('[data-testid="property-access"]');
    const dlg = page.locator('[data-testid="property-access"]');
    check('property access: dialog opens with "Default access" and "Exceptions"', /Default access/.test(await dlg.innerText()) && /Exceptions/.test(await dlg.innerText()));
    await dlg.locator('[data-testid="pa-default"]').click();
    await wait(250);
    await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: /^\s*No access/ }).first().click();
    await wait(200);
    await dlg.locator('[data-testid="pa-preview-toggle"]').click();
    await wait(200);
    check('property access: preview shows the owner keeps full access', (await dlg.locator('[data-testid="pa-preview"]').innerText()).includes('Full access'));
    await shot('16-property-access', dlg);
    await dlg.locator('[data-testid="pa-save"]').click();
    await wait(600);
    const col = (await rowsAs(page, S.collectionId)).collection;
    check('property access: rule saved on the property', col?.schema?.[S.notesProp]?.property_permissions?.default_access === 'none');
    const asB = await rowsAs(pageB, S.collectionId);
    check('property access: "No access" hides the property from B (server)', !asB.collection?.schema?.[S.notesProp] && !asB.rows.some((r) => r.properties?.[S.notesProp] !== undefined));
    await pageB.goto(S.dbUrl);
    await pageB.waitForSelector('.nc-db .nc-table-row-outer', { timeout: 15000 });
    await pageB.waitForTimeout(700);
    check('property access: B no longer sees the Notes column', !(await headerNames(pageB)).includes('Notes'), (await headerNames(pageB)).join('|'));
    const w1 = await tx(S.spaceId, [{ pointer: { table: 'block', id: S.r1, spaceId: S.spaceId }, path: ['properties', S.notesProp], command: 'set', args: [['sneaky']] }], pageB);
    check('property access: server refuses B writing the hidden property', w1.status === 403, `${w1.status}`);

    // view-only values, then an exception for B
    const rules = { default_access: 'reader', overrides: [] };
    await tx(S.spaceId, [{ pointer: { table: 'collection', id: S.collectionId, spaceId: S.spaceId }, path: ['schema', S.notesProp, 'property_permissions'], command: 'set', args: rules }]);
    const asB2 = await rowsAs(pageB, S.collectionId);
    check('property access: "Can view property & values" shows values to B', JSON.stringify(asB2.rows.find((r) => r.id === S.r1)?.properties?.[S.notesProp] ?? '').includes('note by B'));
    const w2 = await tx(S.spaceId, [{ pointer: { table: 'block', id: S.r1, spaceId: S.spaceId }, path: ['properties', S.notesProp], command: 'set', args: [['edit?']] }], pageB);
    check('property access: view-only property refuses B edits', w2.status === 403, `${w2.status}`);
    const w3 = await tx(S.spaceId, [{ pointer: { table: 'block', id: S.r1, spaceId: S.spaceId }, path: ['properties', 'title'], command: 'set', args: [['R1']] }], pageB);
    check('property access: other properties stay editable', w3.status === 200, `${w3.status} ${w3.body?.message ?? ''}`);
    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(500);
    await tbA.db().locator('.lit-table-view-header-cell').filter({ has: page.locator('.nc-th-name', { hasText: /^Notes$/ }) }).first().click();
    await wait(300);
    await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: /^\s*Property access/ }).first().click();
    await page.waitForSelector('[data-testid="property-access"]');
    await dlg.locator('[data-testid="pa-add-override"]').click();
    await wait(300);
    await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: 'Bea Guest' }).first().click().catch(async () => {
      await page.keyboard.press('Escape');
    });
    await wait(250);
    const hasOverride = await dlg.locator('[data-testid="pa-override"]').count();
    if (!hasOverride) {
      // B is a guest (not in the workspace member list): add the exception through the API instead
      await page.keyboard.press('Escape');
      await tx(S.spaceId, [{ pointer: { table: 'collection', id: S.collectionId, spaceId: S.spaceId }, path: ['schema', S.notesProp, 'property_permissions'], command: 'set', args: { default_access: 'reader', overrides: [{ type: 'user_permission', user_id: S.userB, role: 'content_only_editor' }] } }]);
    } else {
      await dlg.locator('[data-testid="pa-override-role"]').first().click();
      await wait(200);
      await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: /^\s*Edit values only/ }).first().click();
      await wait(200);
      await dlg.locator('[data-testid="pa-save"]').click();
      await wait(500);
    }
    await closeOverlays();
    const w4 = await tx(S.spaceId, [{ pointer: { table: 'block', id: S.r1, spaceId: S.spaceId }, path: ['properties', S.notesProp], command: 'set', args: [['exception works']] }], pageB);
    check('property access: exception "Edit values only" lets B edit', w4.status === 200, `${w4.status} ${w4.body?.message ?? ''}`);
    const settings = await tx(S.spaceId, [{ pointer: { table: 'collection', id: S.collectionId, spaceId: S.spaceId }, path: ['schema', S.notesProp, 'property_permissions'], command: 'set', args: { default_access: 'inherit', overrides: [] } }], pageB);
    check('property access: only full access may change the rule (server)', settings.status === 403, `${settings.status}`);
  });
  await ctxB.close();
} catch (e) {
  check('fatal', false, e.message);
  await shot('fatal');
} finally {
  await T.finish();
}

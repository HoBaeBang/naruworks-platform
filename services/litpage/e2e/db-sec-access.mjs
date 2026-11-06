



// Run: NC_BASE=http://127.0.0.1:5551 node e2e/db-sec-access.mjs
import { apiCall, freshPage, setup, tableHelpers } from './db-lib.mjs';
import { BASE, signup } from './lib.mjs';

const T = await setup('db-sec-access');
const { page, wait, check, shot, section, closeOverlays } = T;

const uuidOf = (url) => {
  const hex = new URL(url).pathname.replace(/-/g, '').match(/[0-9a-f]{32}$/i)?.[0] ?? '';
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
const titleOf = (b) => (b?.properties?.title ?? []).map((x) => x[0]).join('');
async function tx(spaceId, operations, p = page) {
  return apiCall(p, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations }] });
}
async function userIdOf(p) {
  const r = await apiCall(p, 'loadAccountData', {});
  return Object.keys(r.body?.recordMap?.user_root ?? {})[0] ?? null;
}
async function rowsAs(p, collectionId) {
  const r = await apiCall(p, 'loadCollectionRows', { collectionId });
  return Object.values(r.body?.recordMap?.block ?? {}).map((e) => e.value.value).filter((b) => b.parent_id === collectionId && b.alive !== false && !b.is_template);
}
const ptr = (table, id, spaceId) => ({ table, id, spaceId });

const S = {};
try {
  await freshPage(page, 'Sec Lab');
  S.labId = uuidOf(page.url());
  const tbA = tableHelpers(page, 0);

  await section('setup', async () => {
    await page.locator('h1[data-content-editable-leaf]').last().click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('/database full', { delay: 12 });
    await wait(500);
    await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /Database( -)? full page/i }).first().click();
    await page.waitForSelector('.nc-db');
    await wait(900);
    S.dbUrl = page.url();
    S.domain = new URL(S.dbUrl).pathname.split('/').filter(Boolean)[0];
    S.blockId = uuidOf(S.dbUrl);
    const chunk = await apiCall(page, 'loadPage', { pageId: S.blockId });
    const blk = chunk.body?.recordMap?.block?.[S.blockId]?.value?.value;
    S.collectionId = blk?.collection_id;
    S.spaceId = blk?.space_id;
    await tbA.addProperty('Owner', 'Person');
    await tbA.addProperty('Notes', 'Text');
    const existing = await rowsAs(page, S.collectionId);
    if (existing.length) await tx(S.spaceId, existing.map((r) => ({ pointer: ptr('block', r.id, S.spaceId), path: [], command: 'update', args: { alive: false } })));
    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(500);
    await tbA.newRow('R1');
    await tbA.newRow('R2');
    S.ownerProp = await tbA.colId('Owner');
    S.notesProp = await tbA.colId('Notes');
    const rs = await rowsAs(page, S.collectionId);
    S.r1 = rs.find((r) => titleOf(r) === 'R1')?.id;
    S.r2 = rs.find((r) => titleOf(r) === 'R2')?.id;
    await tx(S.spaceId, [
      { pointer: ptr('block', S.r1, S.spaceId), path: ['properties', S.notesProp], command: 'set', args: [['first note']] },
      { pointer: ptr('block', S.r2, S.spaceId), path: ['properties', S.notesProp], command: 'set', args: [['second note']] },
    ]);
    // a "Board" page under the lab page with a linked view of the database
    S.board = crypto.randomUUID();
    S.linked = crypto.randomUUID();
    S.linkedView = crypto.randomUUID();
    const pointer = { id: S.collectionId, table: 'collection', spaceId: S.spaceId };
    const made = await tx(S.spaceId, [
      { pointer: ptr('block', S.board, S.spaceId), path: [], command: 'set', args: { id: S.board, type: 'page', parent_id: S.labId, parent_table: 'block', space_id: S.spaceId, alive: true, properties: { title: [['Board']] }, content: [S.linked] } },
      { pointer: ptr('block', S.linked, S.spaceId), path: [], command: 'set', args: { id: S.linked, type: 'collection_view', parent_id: S.board, parent_table: 'block', space_id: S.spaceId, alive: true, collection_id: S.collectionId, view_ids: [S.linkedView], format: { collection_pointer: pointer } } },
      { pointer: ptr('collection_view', S.linkedView, S.spaceId), path: [], command: 'set', args: { id: S.linkedView, type: 'table', name: 'Linked', parent_id: S.linked, parent_table: 'block', space_id: S.spaceId, alive: true, format: { collection_pointer: pointer, table_properties: [{ property: 'title', visible: true, width: 200 }, { property: S.ownerProp, visible: true, width: 160 }, { property: S.notesProp, visible: true, width: 200 }] } } },
      { pointer: ptr('block', S.labId, S.spaceId), path: ['content'], command: 'listAfter', args: { id: S.board } },
    ]);
    check('setup: database, rows and a page with a linked view', made.status === 200 && !!S.r1 && !!S.r2, `${made.status} ${made.body?.message ?? ''}`);
  });

  const ctxB = await T.browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 1, locale: 'en-US' });
  const pageB = await ctxB.newPage();
  pageB.on('pageerror', (e) => T.pageErrors.push(`[B] ${e.message}`));
  const emailB = `dbsec-b-${Date.now()}@test.dev`;
  const tbB = tableHelpers(pageB, 0);
  const boardUrl = () => `${BASE}/${S.domain}/${S.board.replace(/-/g, '')}`;
  async function openBoardAsB() {
    await pageB.goto(boardUrl());
    await pageB.waitForSelector('.nc-db', { timeout: 15000 });
    await pageB.waitForSelector('.nc-db .nc-table-row-outer', { timeout: 15000 }).catch(() => {});
    await pageB.waitForTimeout(700);
  }
  const editableCell = async (title) => (await tbB.cell(title, 'Notes')).locator('.nc-property-cell.editable').count();

  await section('linked-view', async () => {
    await signup(pageB, emailB, 'Bea Viewer', 'Bea Space');
    S.userB = await userIdOf(pageB);
    const viewDb = await apiCall(page, 'invitePagePermissions', { pageId: S.blockId, emails: [emailB], role: 'reader' });
    const editBoard = await apiCall(page, 'invitePagePermissions', { pageId: S.board, emails: [emailB], role: 'read_and_write' });
    check('linked view: B can view the database and edit the Board page', viewDb.status === 200 && editBoard.status === 200, `${viewDb.status} ${editBoard.status}`);
    await openBoardAsB();
    await shot('00-linked-view-b', pageB.locator('body'));
    check('linked view: B sees the rows', (await tbB.titles()).sort().join('|') === 'R1|R2', (await tbB.titles()).join('|'));
    check('linked view: cells are read-only for a viewer of the source', (await editableCell('R1')) === 0 && (await editableCell('R2')) === 0);
    check('linked view: no "New page" row for a viewer of the source', (await tbB.db().locator('.lit-table-view-add-row').count()) === 0);
    await tbB.db().hover();
    await pageB.waitForTimeout(200);
    check('linked view: no "Add property" for a viewer of the source', (await tbB.db().locator('[data-testid="add-column-button"]').count()) === 0);
    check('linked view: the page editor still manages the view ("Show or hide properties")', (await tbB.db().locator('.lit-table-view-add-column').count()) === 1);
    await shot('01-linked-view-viewer', pageB.locator('.nc-db').first());
    // a page-level rule makes R1 editable for B: that row's cells open, the others stay read-only
    const rule = await tx(S.spaceId, [
      { pointer: ptr('collection', S.collectionId, S.spaceId), path: ['permission_rules'], command: 'set', args: [{ id: crypto.randomUUID(), property: S.ownerProp, role: 'read_and_write' }] },
      { pointer: ptr('block', S.r1, S.spaceId), path: ['properties', S.ownerProp], command: 'set', args: [['‣', [['u', S.userB]]]] },
    ]);
    check('linked view: rule "Anyone in Owner: Can edit" + B as R1 owner', rule.status === 200, `${rule.status} ${rule.body?.message ?? ''}`);
    await openBoardAsB();
    check('linked view: B may edit the row the rule gives them', (await editableCell('R1')) === 1 && (await editableCell('R2')) === 0);
    await (await tbB.cell('R1', 'Notes')).locator('.nc-property-cell').click();
    await pageB.waitForTimeout(300);
    await pageB.keyboard.press('Meta+A');
    await pageB.keyboard.type('edited by B');
    await pageB.keyboard.press('Enter');
    await pageB.waitForTimeout(800);
    const r1 = (await rowsAs(page, S.collectionId)).find((r) => r.id === S.r1);
    check('linked view: the edit is saved', JSON.stringify(r1?.properties?.[S.notesProp] ?? '').includes('edited by B'), JSON.stringify(r1?.properties?.[S.notesProp] ?? ''));
  });

  await section('rule-only', async () => {
    // B loses access to the database itself: R1 is still theirs through the Owner rule
    const chunk = await apiCall(page, 'loadPage', { pageId: S.blockId });
    const perms = (chunk.body?.recordMap?.block?.[S.blockId]?.value?.value?.permissions ?? []).filter((p) => p.user_id !== S.userB);
    const revoke = await tx(S.spaceId, [{ pointer: ptr('block', S.blockId, S.spaceId), path: ['permissions'], command: 'set', args: perms }]);
    check('rule only: B removed from the database', revoke.status === 200, `${revoke.status} ${revoke.body?.message ?? ''}`);
    await pageB.goto(`${BASE}/${S.domain}/${S.r1.replace(/-/g, '')}`);
    await pageB.waitForSelector('.nc-page-prop-row', { timeout: 15000 }).catch(() => {});
    await pageB.waitForTimeout(900);
    await shot('01b-rule-only-b', pageB.locator('body'));
    const names = await pageB.locator('.nc-page-prop-row .nc-page-prop-name').allInnerTexts();
    check('rule only: the row page shows its properties', names.includes('Owner') && names.includes('Notes'), names.join('|'));
    const notes = pageB.locator('.nc-page-prop-row').filter({ has: pageB.locator('.nc-page-prop-name', { hasText: /^Notes$/ }) }).first();
    check('rule only: values are there', (await notes.innerText().catch(() => '')).includes('edited by B'), (await notes.innerText().catch(() => '')).slice(0, 80));
    const hintB = await pageB.locator('.nc-empty-row-hint').innerText().catch(() => '');
    check('rule only: the empty-page hint offers no "create a template" (the database isn\u2019t theirs to change)', hintB.includes('continue with an empty page') && !hintB.includes('create a template'), hintB);
    await shot('02-rule-only-row-page', pageB);
    await openBoardAsB();
    check('rule only: the linked view loads (not "Loading…")', (await pageB.locator('.nc-db-missing').count()) === 0);
    check('rule only: only the reachable row is listed', (await tbB.titles()).join('|') === 'R1', (await tbB.titles()).join('|'));
    await shot('03-rule-only-linked', pageB.locator('.nc-db').first());
  });
  await ctxB.close();

  await section('property-comment', async () => {
    await page.goto(`${BASE}/${S.domain}/${S.r2.replace(/-/g, '')}`);
    await page.waitForSelector('.nc-page-prop-row', { timeout: 15000 });
    await wait(600);
    check('owner: the empty-page hint offers "create a template"', (await page.locator('.nc-empty-row-hint').innerText().catch(() => '')).includes('create a template'));
    const row = page.locator('.nc-page-prop-row').filter({ has: page.locator('.nc-page-prop-name', { hasText: /^Notes$/ }) }).first();
    await row.hover();
    await wait(200);
    await row.locator('[data-testid="property-comment"]').click();
    await wait(300);
    await page.keyboard.type('Is this right?', { delay: 5 });
    await page.keyboard.press('Enter');
    await wait(900);
    const c = await apiCall(page, 'loadPage', { pageId: S.r2 });
    const d = Object.values(c.body?.recordMap?.discussion ?? {}).map((e) => e.value.value).find((x) => x.property_id === S.notesProp);
    check('property comment: the thread is on the Notes value', !!d, JSON.stringify(Object.keys(c.body?.recordMap?.discussion ?? {})));
    check('property comment: its context is the property name only', JSON.stringify(d?.context) === JSON.stringify([['Notes']]), JSON.stringify(d?.context));
    await closeOverlays();
  });
} catch (e) {
  check('fatal', false, e.message);
  await shot('fatal');
} finally {
  await T.finish();
}

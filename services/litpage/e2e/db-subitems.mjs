
// turn on sub-items, nested rows (toggle, New sub-item, flattened count, filter scopes), delete + duplicate with
// sub-items, server integrity checks, dependencies with automatic date shifting, Tasks database + My Tasks, sprints
// (board views, Complete sprint). Run: NC_BASE=http://127.0.0.1:5431 node e2e/db-subitems.mjs
import { apiCall, createInlineDb, esc, freshPage, setup, tableHelpers } from './db-lib.mjs';

const T = await setup('db-subitems');
const { page, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);
const opt = (label) => page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: new RegExp(`^\\s*${esc(label)}`) }).first();
const vsRow = (label) => page.locator('.nc-view-settings [role="menuitem"]').filter({ has: page.locator('.nc-menu-label', { hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }) }).first();

async function ids() {
  const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
  const r = await apiCall(page, 'loadPage', { pageId: blockId });
  const map = r.body?.recordMap ?? {};
  const b = map.block?.[blockId]?.value?.value;
  const rows = await apiCall(page, 'loadCollectionRows', { collectionId: b?.collection_id });
  const col = rows.body?.recordMap?.collection?.[b?.collection_id]?.value?.value ?? map.collection?.[b?.collection_id]?.value?.value;
  return { blockId, collectionId: b?.collection_id, spaceId: b?.space_id, collection: col, map };
}
async function myUserId() {
  const r = await apiCall(page, 'loadAccountData', {});
  return Object.keys(r.body?.recordMap?.user_root ?? {})[0] ?? null;
}
async function collectionRecord(id) {
  const r = await apiCall(page, 'loadCollectionRows', { collectionId: id });
  return { collection: r.body?.recordMap?.collection?.[id]?.value?.value, rows: Object.values(r.body?.recordMap?.block ?? {}).map((e) => e.value.value).filter((b) => b.parent_id === id) };
}
async function tx(spaceId, operations) {
  return apiCall(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations }] });
}
async function openMoreSettings(item) {
  await tb.openSettings();
  await vsRow('More settings').click();
  await wait(200);
  await opt(item).click();
  await wait(300);
}
const toggleOf = (title) => tb.rowByTitle(title).locator('.nc-subitem-toggle');

try {
  await freshPage(page, 'Task Lab');
  await createInlineDb(page, 'Work');
  await tb.newRow('Parent A');
  await tb.newRow('Parent B');

  await section('subitems-on', async () => {
    await openMoreSettings('Sub-items');
    check('subitems: page explains "Group items under toggles"', await page.locator('.nc-rf-desc', { hasText: 'Group items under toggles' }).count());
    await shot('01-subitems-off');
    await page.locator('[data-testid="turn-on-subitems"]').click();
    await wait(400);
    check('subitems: turning on shows Display options', await page.locator('[data-testid="subitem-display"]').count());
    check('subitems: default display "Nested under a toggle"', (await page.locator('[data-testid="subitem-display"]').innerText()).includes('Nested under a toggle'));
    await shot('02-subitems-on');
    await closeOverlays();
    // the turn-on transaction may still be in flight: poll the server copy briefly
    let collection;
    for (let i = 0; i < 12; i++) {
      ({ collection } = await ids());
      if (collection?.format?.subitem_property) break;
      await wait(250);
    }
    const sub = collection?.format?.subitem_property;
    check('subitems: Sub-item / Parent item relation pair created', !!sub && collection.schema[sub]?.name === 'Sub-item' && collection.schema[collection.schema[sub]?.property]?.name === 'Parent item', JSON.stringify(Object.values(collection?.schema ?? {}).map((p) => p.name)));
  });

  await section('nested', async () => {
    await tb.rowByTitle('Parent A').hover();
    await toggleOf('Parent A').click();
    await wait(250);
    check('nested: expanding a row shows "New sub-item"', await tb.db().locator('.nc-subitem-new-btn').count());
    await tb.db().locator('.nc-subitem-new-btn').first().click();
    await page.waitForSelector('.nc-title-cell-leaf.editing');
    await page.keyboard.type('Child 1', { delay: 8 });
    await page.keyboard.press('Enter');
    await wait(400);
    const t = await tb.titles();
    check('nested: sub-item listed right under its parent', t.indexOf('Child 1') === t.indexOf('Parent A') + 1, t.join('|'));
    const indent = await tb.rowByTitle('Child 1').locator('.nc-subitem-indent').count();
    check('nested: sub-item row is indented', indent === 1);
    check('nested: parent toggle shows it has sub-items', await toggleOf('Parent A').evaluate((el) => el.classList.contains('has-children') && el.classList.contains('open')));
    await shot('03-nested');
    await toggleOf('Parent A').click();
    await wait(250);
    check('nested: collapsing hides the sub-item', !(await tb.titles()).includes('Child 1'));
    await toggleOf('Parent A').click();
    await wait(250);
    // parent link stored on the child (Parent item) and the child on the parent (Sub-item)
    const { collection } = await ids();
    const sub = collection.format.subitem_property;
    const inv = collection.schema[sub].property;
    const childRec = (await collectionRecord(collection.id)).rows.find((b) => b?.properties?.title?.[0]?.[0] === 'Child 1');
    const parentId = await tb.rowByTitle('Parent A').getAttribute('data-block-id');
    check('nested: child stores its Parent item', JSON.stringify(childRec?.properties?.[inv] ?? '').includes(parentId), JSON.stringify(childRec?.properties?.[inv] ?? null));
  });

  await section('display-modes', async () => {
    await openMoreSettings('Sub-items');
    await page.locator('[data-testid="subitem-display"]').click();
    await wait(150);
    await opt('Flattened list').click();
    await wait(300);
    check('display: preview text for flattened parents', await page.locator('.nc-rf-caption', { hasText: 'count of nested items' }).count());
    await closeOverlays();
    let t = await tb.titles();
    check('display: flattened "Parents only" hides sub-items', !t.includes('Child 1') && t.includes('Parent A'), t.join('|'));
    check('display: flattened shows a sub-item count on the parent', ((await tb.rowByTitle('Parent A').locator('.nc-subitem-count').innerText().catch(() => '')).trim()) === '1');
    await shot('04-flattened');
    await openMoreSettings('Sub-items');
    await page.locator('[data-testid="subitem-scope"]').click();
    await wait(150);
    await opt('Parents and nested items').click();
    await wait(250);
    await closeOverlays();
    t = await tb.titles();
    check('display: "Parents and nested items" lists the sub-item flat', t.includes('Child 1') && t.includes('Parent A'), t.join('|'));
    await openMoreSettings('Sub-items');
    await page.locator('[data-testid="subitem-display"]').click();
    await wait(150);
    await opt('Nested under a toggle').click();
    await wait(200);
    await page.locator('[data-testid="subitem-scope"]').click();
    await wait(150);
    await opt('Parents only').click();
    await wait(200);
    await closeOverlays();
    check('display: back to nested', (await tb.titles()).indexOf('Child 1') === (await tb.titles()).indexOf('Parent A') + 1);
  });

  await section('integrity', async () => {
    const { collection, spaceId } = await ids();
    const sub = collection.format.subitem_property;
    const inv = collection.schema[sub].property;
    const a = await tb.rowByTitle('Parent A').getAttribute('data-block-id');
    const c = await tb.rowByTitle('Child 1').getAttribute('data-block-id');
    const rel = (id) => [['‣', [['p', id, spaceId]]]];
    const self = await tx(spaceId, [{ pointer: { table: 'block', id: a, spaceId }, path: ['properties', inv], command: 'set', args: rel(a) }]);
    check('integrity: an item can’t be its own parent', self.status === 403 && /own parent/.test(self.body?.message ?? ''), `${self.status} ${self.body?.message ?? ''}`);
    const cycle = await tx(spaceId, [{ pointer: { table: 'block', id: a, spaceId }, path: ['properties', inv], command: 'set', args: rel(c) }]);
    check('integrity: no circular nesting', cycle.status === 403 && /cycle/.test(cycle.body?.message ?? ''), `${cycle.status} ${cycle.body?.message ?? ''}`);
  });

  await section('duplicate-delete', async () => {
    await tb.rowByTitle('Parent A').click({ button: 'right' });
    await wait(200);
    await opt('Duplicate').click();
    await wait(900);
    const t = await tb.titles();
    check('duplicate: copy of the parent created', t.includes('Parent A (1)'), t.join('|'));
    if (!(await toggleOf('Parent A (1)').evaluate((el) => el.classList.contains('open')).catch(() => false))) await toggleOf('Parent A (1)').click().catch(() => {});
    await wait(300);
    const t2 = await tb.titles();
    check('duplicate: the sub-item is duplicated under the copy', t2.filter((x) => x === 'Child 1').length === 2, t2.join('|'));
    await tb.rowByTitle('Parent A (1)').click({ button: 'right' });
    await wait(200);
    await opt('Send to trash').click();
    await wait(300);
    const dialog = page.locator('.nc-confirm');
    check('delete: confirmation mentions the sub-item', (await dialog.innerText()).includes('This will also move 1 sub-item to Trash'));
    await shot('05-delete-confirm');
    await dialog.locator('button', { hasText: 'Delete' }).click();
    await wait(500);
    const t3 = await tb.titles();
    check('delete: parent and its sub-item went to Trash', !t3.includes('Parent A (1)') && t3.filter((x) => x === 'Child 1').length === 1, t3.join('|'));
  });

  await section('dependencies', async () => {
    await tb.addProperty('Date', 'Date');
    await openMoreSettings('Dependencies');
    check('dependencies: description shown', await page.locator('.nc-rf-desc', { hasText: 'blocking — or blocked by' }).count());
    check('dependencies: default shift mode is "Shift only when dates overlap"', await page.locator('[data-testid="shift-consume_gap"] .lit-icon').count());
    await page.locator('[data-testid="turn-on-dependencies"]').click();
    await wait(400);
    await closeOverlays();
    const { collection, spaceId } = await ids();
    const blocking = collection.format.collection_default_arrows_by;
    const blockedBy = collection.schema[blocking]?.property;
    check('dependencies: Blocking / Blocked by pair created', collection.schema[blocking]?.name === 'Blocking' && collection.schema[blockedBy]?.name === 'Blocked by');
    check('dependencies: shifting config stored', collection.format.dependency_date_shifting_config?.mode === 'consume_gap' && collection.format.dependency_date_shifting_config?.avoid_weekends === true);
    // Parent B blocks Parent A: B Oct 5 2026 (Mon), A Oct 6 2026 (Tue)
    const a = await tb.rowByTitle('Parent A').getAttribute('data-block-id');
    const b = await tb.rowByTitle('Parent B').getAttribute('data-block-id');
    const datePid = collection.format.dependency_date_shifting_config.date_property;
    const d = (s) => [['‣', [['d', { type: 'date', start_date: s }]]]];
    const rel = (id) => [['‣', [['p', id, spaceId]]]];
    const r = await tx(spaceId, [
      { pointer: { table: 'block', id: b, spaceId }, path: ['properties', blocking], command: 'set', args: rel(a) },
      { pointer: { table: 'block', id: a, spaceId }, path: ['properties', blockedBy], command: 'set', args: rel(b) },
      { pointer: { table: 'block', id: b, spaceId }, path: ['properties', datePid], command: 'set', args: d('2026-10-05') },
      { pointer: { table: 'block', id: a, spaceId }, path: ['properties', datePid], command: 'set', args: d('2026-10-06') },
    ]);
    check('dependencies: relation + dates set', r.status === 200, `${r.status}`);
    await page.reload();
    await page.waitForSelector('.nc-db');
    await wait(600);
    // move Parent B to Friday Oct 9 in the date picker → Parent A (blocked) must start after it, skipping the weekend
    await (await tb.cell('Parent B', 'Date')).click();
    await page.waitForSelector('.nc-date-picker');
    await page.locator('.nc-date-day:not(.other)', { hasText: /^9$/ }).first().click();
    await wait(300);
    await closeOverlays();
    await wait(400);
    const aDate = (await (await tb.cell('Parent A', 'Date')).innerText()).trim();
    check('dependencies: blocked item shifted past the blocker, avoiding the weekend (→ Oct 12)', /Oct(ober)? 12, 2026/.test(aDate), aDate);
    await shot('06-dependency-shift');
    await page.keyboard.press('Meta+z');
    await wait(500);
    const aBack = (await (await tb.cell('Parent A', 'Date')).innerText()).trim();
    check('dependencies: one undo reverts the edit and the shift', /Oct(ober)? 6, 2026/.test(aBack), aBack);
  });

  await section('task-database', async () => {
    await tb.openSettings();
    await vsRow('Turn into').click();
    await wait(200);
    await opt('Change to Tasks table').click();
    await wait(400);
    check('tasks: dialog asks for status, assignee and due date', await page.locator('.nc-tt-dialog', { hasText: 'Task tables require status, assignee, and due date fields.' }).count());
    await shot('07-turn-into-tasks');
    await page.locator('[data-testid="turn-into-tasks-confirm"]').click();
    await wait(600);
    const { collection } = await ids();
    check('tasks: typed as a Tasks database', collection.format.app_config_uri === 'litpage://tasks_collection' && !!collection.format.app_uri_map?.['litpage://tasks/assign_property']);
    // assign Parent B to me through the API (person property) and read My Tasks
    const assignee = collection.format.app_uri_map['litpage://tasks/assign_property'];
    const { spaceId } = await ids();
    const userId = await myUserId();
    const b = await tb.rowByTitle('Parent B').getAttribute('data-block-id');
    const set = await tx(spaceId, [{ pointer: { table: 'block', id: b, spaceId }, path: ['properties', assignee], command: 'set', args: [['‣', [['u', userId ?? 'x']]]] }]);
    const mine = await apiCall(page, 'getMyTasks', { spaceId });
    check('tasks: My Tasks lists the assigned task', set.status === 200 && (mine.body?.taskIds ?? []).includes(b), `${set.status} ${JSON.stringify(mine.body?.taskIds ?? mine.body)}`);
    check('tasks: Sub-items are called Sub-tasks', await (async () => { await tb.openSettings(); await vsRow('More settings').click(); await wait(200); const ok = await opt('Sub-tasks').count(); await closeOverlays(); return ok; })());
  });

  await section('sprints', async () => {
    await openMoreSettings('Sprints');
    check('sprints: setup explains the sprint board and database', await page.locator('.nc-sprint-setup-list', { hasText: 'Sprint board' }).count());
    await page.locator('[data-testid="turn-on-sprints"]').click();
    await page.waitForSelector('h1:has-text("Sprint board"), .nc-title-leaf:has-text("Sprint board")', { timeout: 8000 }).catch(() => {});
    await wait(900);
    const boardChunk = await apiCall(page, 'loadPage', { pageId: await page.locator('[data-page-id]').first().getAttribute('data-page-id') });
    const tabText = Object.values(boardChunk.body?.recordMap?.collection_view ?? {}).map((e) => e.value.value.name).join('|');
    check('sprints: Sprint board with Current sprint / Sprint planning / Backlog', /Current sprint/.test(tabText) && /Sprint planning/.test(tabText) && /Backlog/.test(tabText), tabText);
    check('sprints: Complete sprint button on the current sprint view', await page.locator('[data-testid="complete-sprint"]').count());
    await shot('08-sprint-board');
    await page.locator('[data-testid="complete-sprint"]').click();
    await wait(400);
    check('sprints: summary modal "Sprint 1 summary"', await page.locator('.nc-sprint-modal', { hasText: 'Sprint 1 summary' }).count());
    await shot('09-complete-sprint');
    await page.locator('[data-testid="complete-sprint-confirm"]').click();
    await wait(800);
    const tasksId = (await ids()).collectionId;
    const tasksCol = (await collectionRecord(tasksId)).collection;
    const sprintsId = tasksCol?.format?.sprint_settings?.sprints_collection_id;
    const { collection: sprintsCol, rows: recs } = await collectionRecord(sprintsId);
    const status = sprintsCol?.format?.app_uri_map?.['litpage://sprints/sprint_status_property'];
    const st = Object.fromEntries(recs.map((r) => [r.properties?.title?.[0]?.[0], r.properties?.[status]?.[0]?.[0]]));
    check('sprints: Sprint 1 → Last, Sprint 2 → Current, Sprint 3 → Next', st['Sprint 1'] === 'Last' && st['Sprint 2'] === 'Current' && st['Sprint 3'] === 'Next', JSON.stringify(st));
  });
} catch (e) {
  check('fatal', false, e.message);
  await shot('fatal');
} finally {
  await T.finish();
}

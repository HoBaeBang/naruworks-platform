// Shell extras: Quick Find keyword shortcuts + People results, Library multi-select actions + section ↔ sidebar,
// Add tab presets + Reset tab, My Tasks, Change to team, breadcrumb location chip.
// Run: NC_BASE=http://127.0.0.1:5441 node e2e/shell-workspace-extra.mjs
import { mkdirSync } from 'node:fs';
import { launch, BASE } from './lib.mjs';
import { apiLogin, call, compact, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/extra';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow

try {
  const id = uniq();
  const me = await apiLogin(page, { email: `xtra${id}@test.dev`, name: 'Xena Tester', workspace: 'Extra Co' });
  const spaceId = me.spaceId;
  await call(page, 'inviteMembers', { spaceId, emails: [`quinn${id}@test.dev`], role: 'editor' });
  const domain = await page.evaluate(() => location.pathname.split('/')[1]);

  // ---- Quick Find keywords + people
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.nc-qf-input');
  await page.keyboard.type('setti');
  await page.waitForSelector('.nc-qf-jump [data-row-kind="action"]');
  r.ok(/Settings/.test(await page.textContent('.nc-qf-jump') ?? ''), '"setti" offers Jump to › Settings');
  await page.screenshot({ path: `${OUT}/01-quickfind-keyword.png` });
  await page.keyboard.press('Enter');
  r.ok(!!(await waitFor(async () => page.$('.nc-settings-modal, [role=dialog][aria-label*="Settings"], .nc-set-modal'))), 'Enter opens Settings');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.nc-qf-input');
  await page.fill('.nc-qf-input', 'quinn');
  await page.waitForSelector('.nc-qf-people [data-row-kind="person"]');
  r.ok(new RegExp(`quinn${id}`).test(await page.textContent('.nc-qf-people') ?? ''), 'People results in Quick Find');
  await page.click('.nc-qf-people [data-row-kind="person"]');
  await page.waitForSelector('.nc-profile');
  r.ok(true, 'person result opens the profile page');

  // ---- a private page for the breadcrumb test (⌘F find in page is covered by e2e/editor-find*.mjs)
  const findId = await createPrivatePage(page, spaceId, 'Find me');
  await page.goto(`${BASE}/${domain}/Find-me-${compact(findId)}`);
  await page.waitForSelector('h1[data-content-editable-leaf]');

  // ---- breadcrumb location chip → Move to
  await page.click('.nc-crumb-location');
  r.ok(!!(await waitFor(async () => page.$('.lit-overlay-container input[placeholder*="Move page to"], .lit-overlay-container [placeholder*="Move"]'))), 'Private ▾ chip opens the Move to picker');
  await page.keyboard.press('Escape');

  // ---- Library: multi-select delete + section ↔ sidebar
  const p1 = await createPrivatePage(page, spaceId, 'Bulk one');
  const p2 = await createPrivatePage(page, spaceId, 'Bulk two');
  await page.goto(`${BASE}/${domain}/library/private`);
  await page.waitForSelector('.nc-lib-item');
  for (const pid of [p1, p2]) {
    const row = page.locator(`.nc-lib-item[data-block-id="${pid}"]`);
    await row.hover();
    await row.locator('input[type=checkbox]').check({ force: true });
  }
  await page.waitForSelector('.nc-lib-bulkbar');
  r.ok(/2 selected/.test(await page.textContent('.nc-lib-bulkbar') ?? ''), 'bulk bar "2 selected"');
  await page.screenshot({ path: `${OUT}/03-library-bulk.png` });
  await page.click('.nc-lib-bulk-btn.danger');
  await waitFor(async () => !(await page.$(`.nc-lib-item[data-block-id="${p1}"]`)));
  const gone = await waitFor(() => page.evaluate(async ([a, b]) => {
    const r2 = await fetch('/api/rpc/fetchRecords', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests: [{ pointer: { table: 'block', id: a } }, { pointer: { table: 'block', id: b } }] }) }).then((x) => x.json());
    return [a, b].every((id) => (r2.recordMap.block[id].value.value ?? r2.recordMap.block[id].value).alive === false);
  }, [p1, p2]));
  r.ok(gone, 'Delete moves both pages to Trash');
  await page.click('.nc-lib-tab.selected');
  await page.click('.lit-overlay-container [role=option]:has-text("Hide from sidebar")');
  await page.waitForTimeout(500);
  r.ok(!(await page.$('nav .lit-outliner-private-header, nav [data-section-type="private"]')) || !/Private/.test(await page.textContent('nav .nc-sb-scroller, nav') ?? ''), 'Private section removed from the sidebar');
  await page.click('.nc-lib-tab.selected');
  await page.click('.lit-overlay-container [role=option]:has-text("Add section to sidebar")');
  await page.waitForTimeout(500);
  r.ok(/Private/.test(await page.textContent('nav') ?? ''), 'Private section added back');

  // ---- Add tab presets + Reset tab
  await page.click('nav [aria-label="Customize sidebar"], nav :text("Customize sidebar")').catch(() => {});
  const addTab = page.locator('nav .nc-sb-tab.add');
  if (await addTab.count()) {
    await addTab.first().click();
    await page.waitForSelector('.lit-overlay-container [role=option]:has-text("Blank tab")');
    r.ok(/Litpage presets/.test(await page.textContent('.lit-overlay-container') ?? ''), 'Add tab shows the preset picker');
    await page.screenshot({ path: `${OUT}/04-add-tab.png` });
    await page.keyboard.press('Escape');
  } else r.ok(false, 'Add tab button visible in customize mode');
  await page.click('nav button:has-text("Done"), nav [role=button]:has-text("Done")').catch(() => {});

  // ---- My Tasks
  await page.evaluate(async ([spaceId, uid]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const dbId = crypto.randomUUID();
    const colId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const now = Date.now();
    const d = new Date(Date.now() + 86400000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: dbId, spaceId }, path: [], command: 'set', args: { id: dbId, type: 'collection_view_page', collection_id: colId, view_ids: [], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }] } },
      { pointer: { table: 'collection', id: colId, spaceId }, path: [], command: 'set', args: { id: colId, name: [['Sprint tasks']], schema: { title: { name: 'Task', type: 'title' }, who: { name: 'Assignee', type: 'person' }, due: { name: 'Due', type: 'date' } }, format: { app_config_uri: 'litpage://tasks_collection', app_uri_map: { 'litpage://tasks/assign_property': 'who', 'litpage://tasks/due_date_property': 'due' } }, parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: dbId } },
      { pointer: { table: 'block', id: rowId, spaceId }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: colId, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['Write release notes']], who: [['‣', [['u', uid]]]], due: [['‣', [['d', { type: 'date', start_date: ymd }]]]] } } },
    ] }] });
  }, [spaceId, me.userId]);
  await page.goto(`${BASE}/${domain}/tasks`);
  await page.waitForSelector('.nc-task-row');
  r.ok(/Write release notes/.test(await page.textContent('.nc-tasks') ?? '') && /Sprint tasks/.test(await page.textContent('.nc-tasks') ?? ''), 'My Tasks lists the task assigned to me');
  r.ok(/Today|Next 7 days/.test(await page.textContent('.nc-tasks-group-title') ?? ''), 'grouped by due date');
  await page.screenshot({ path: `${OUT}/05-my-tasks.png` });

  // ---- database view menu › "Add layout to sidebar"
  const dbId = await page.evaluate(async ([spaceId, uid]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const dbId = crypto.randomUUID();
    const colId = crypto.randomUUID();
    const viewId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: dbId, spaceId }, path: [], command: 'set', args: { id: dbId, type: 'collection_view_page', collection_id: colId, view_ids: [viewId], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }] } },
      { pointer: { table: 'collection', id: colId, spaceId }, path: [], command: 'set', args: { id: colId, name: [['Roadmap DB']], schema: { title: { name: 'Name', type: 'title' } }, parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId } },
      { pointer: { table: 'collection_view', id: viewId, spaceId }, path: [], command: 'set', args: { id: viewId, type: 'table', name: 'Table', parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId, format: {} } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: dbId } },
      { pointer: { table: 'block', id: rowId, spaceId }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: colId, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['Launch beta']] } } },
    ] }] });
    return dbId;
  }, [spaceId, me.userId]);
  await page.goto(`${BASE}/${domain}/Roadmap-DB-${compact(dbId)}`);
  await page.waitForSelector('.nc-view-tablist .lit-collection-view-tab.active');
  await page.click('.nc-view-tablist .lit-collection-view-tab.active');
  await page.click('.lit-overlay-container [role=option]:has-text("Add layout to sidebar"), .lit-overlay-container [role=menuitem]:has-text("Add layout to sidebar")');
  r.ok(!!(await waitFor(async () => /Roadmap DB/.test(await page.textContent('nav') ?? '') && /Launch beta/.test(await page.textContent('nav') ?? ''))), 'view menu "Add layout to sidebar" adds a section with the view’s rows');
  await page.screenshot({ path: `${OUT}/05b-db-view-section.png` });

  // ---- Change to team (page in the General teamspace)
  const tp = await page.evaluate(async ([spaceId, uid]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const team = Object.values(uc.recordMap.team).map((e) => e.value.value ?? e.value).find((t) => t.space_id === spaceId);
    const pid = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: pid, spaceId }, path: [], command: 'set', args: { id: pid, type: 'page', properties: { title: [['Design Guild']] }, content: [], parent_id: team.id, parent_table: 'team', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid } },
      { pointer: { table: 'team', id: team.id, spaceId }, path: ['team_pages'], command: 'listAfter', args: { id: pid } },
    ] }] });
    return pid;
  }, [spaceId, me.userId]);
  await page.goto(`${BASE}/${domain}/Design-Guild-${compact(tp)}`);
  await page.waitForSelector('nav.lit-sidebar-container');
  const general = page.locator('.lit-outliner-team', { hasText: 'General' });
  if ((await general.getAttribute('aria-expanded')) !== 'true') await general.click();
  const row = page.locator(`nav .nc-sb-page[data-block-id="${tp}"] .nc-sb-item`).first();
  await row.waitFor();
  await row.click({ button: 'right' });
  await page.click('.lit-overlay-container [role=option]:has-text("Change to team")');
  await page.waitForSelector('.nc-confirm');
  await page.click('.nc-confirm .nc-confirm-buttons button:first-child'); // "Create team"
  r.ok(!!(await waitFor(async () => (await page.$$eval('.lit-outliner-team', (els) => els.map((e) => e.textContent))).some((x) => /Design Guild/.test(x)), { timeout: 10000 })), 'page became a teamspace in the sidebar');
  await page.screenshot({ path: `${OUT}/06-turned-into-teamspace.png` });
} catch (e) {
  console.log('FAIL exception', e.message.slice(0, 800));
  process.exitCode = 1;
} finally {
  await browser.close();
  r.done();
}

// Shell: Share menu additions (shareAccess.tsx): group sharing ("Email or group" suggestion, group row,
// role change, Remove), restricting a sub-page (inherited person → Remove → "Change, then unlink", unlinked
// banner, Relink), "Remove from search", guest invite requests and the database-row "Notify me"
// levels in the page ••• menu.
// Run: NC_BASE=http://127.0.0.1:5441 node e2e/shell-sharing.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, CHROME } from './lib.mjs';
import { apiLogin, call, compact, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/sharing';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return p;
};
const blockOf = (page, id) => page.evaluate(async (id) => {
  const res = await fetch('/api/rpc/fetchRecords', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requests: [{ pointer: { table: 'block', id } }] }) }).then((x) => x.json());
  const v = res.recordMap?.block?.[id]?.value;
  return v?.value ?? v ?? null;
}, id);
const openShare = async (page) => {
  await page.click('.lit-topbar-share-menu');
  await page.waitForSelector('.nc-share-menu .nc-share-people');
  await page.waitForTimeout(300);
};
const closeShare = async (page) => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
};
const pick = (page, label) => page.click(`.lit-overlay-container [role=option]:has-text("${label}"), .lit-overlay-container [role=menuitem]:has-text("${label}")`);

try {
  const A = await mk();
  const B = await mk();
  const id = uniq();
  const a = await apiLogin(A, { email: `sara${id}@test.dev`, name: 'Sara Owner', workspace: 'Share Co' });
  const spaceId = a.spaceId;
  const bEmail = `ben${id}@test.dev`;
  await call(A, 'inviteMembers', { spaceId, emails: [bEmail], role: 'editor' });
  const b = await apiLogin(B, { email: bEmail, name: 'Ben Member', createWorkspace: false });
  const grp = await call(A, 'createGroup', { spaceId, name: 'Design team', memberIds: [b.userId] });
  r.ok(!!grp.group?.id, 'group created');
  const parent = await createPrivatePage(A, spaceId, 'Parent doc');
  const child = await A.evaluate(async ([parent, spaceId, uid]) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id, spaceId }, path: [], command: 'set', args: { id, type: 'page', properties: { title: [['Child doc']] }, content: [], parent_id: parent, parent_table: 'block', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid } },
      { pointer: { table: 'block', id: parent, spaceId }, path: ['content'], command: 'listAfter', args: { id } },
    ] }] }) });
    return id;
  }, [parent, spaceId, a.userId]);
  const domain = await A.evaluate(() => location.pathname.split('/')[1]);

  // ---- group sharing: "Email or group" suggestion → group row
  await A.goto(`${BASE}/${domain}/Parent-doc-${compact(parent)}`);
  await A.waitForSelector('h1[data-content-editable-leaf]');
  await openShare(A);
  await A.fill('.nc-share-invite-input input', 'Desig');
  await A.waitForSelector('.nc-share-group-suggestions [data-group-id]');
  const sug = await A.textContent('.nc-share-group-suggestions');
  r.ok(/Design team/.test(sug ?? '') && /1 member/.test(sug ?? ''), `group suggestion: "${sug?.trim()}"`);
  await A.screenshot({ path: `${OUT}/01-group-suggestion.png` });
  await A.click('.nc-share-group-suggestions [data-group-id]');
  await A.waitForSelector('.nc-share-group-row');
  const row = await A.textContent('.nc-share-group-row');
  r.ok(/Design team/.test(row ?? '') && /Group/.test(row ?? '') && /Full access/.test(row ?? ''), `group row: "${row?.trim()}"`);
  r.ok(!(await call(B, 'getPageSharing', { pageId: parent })).__error, 'a group member can open the page');
  await A.click('.nc-share-group-row .nc-share-role');
  await pick(A, 'Can view');
  r.ok(!!(await waitFor(async () => (await blockOf(A, parent))?.permissions?.some((p) => p.type === 'group_permission' && p.role === 'reader'))), 'group role changed to Can view');
  await A.screenshot({ path: `${OUT}/02-group-row.png` });
  await closeShare(A);

  // ---- restrict a sub-page: Ben (Can edit on the parent) removed on the child → Change, then unlink
  await call(A, 'invitePagePermissions', { pageId: parent, userIds: [b.userId], role: 'read_and_write' });
  await A.goto(`${BASE}/${domain}/Child-doc-${compact(child)}`);
  await A.waitForSelector('h1[data-content-editable-leaf]');
  await openShare(A);
  const benRow = A.locator(`.nc-share-row.person[data-user-id="${b.userId}"]`);
  await benRow.waitFor();
  await benRow.locator('.nc-share-role').click();
  await A.waitForSelector('.lit-overlay-container :text("Current access")');
  await pick(A, 'Remove');
  await A.waitForSelector('.nc-confirm');
  r.ok(/unlink inherited sharing settings/.test(await A.textContent('.nc-confirm') ?? ''), 'confirm "Change access and unlink inherited sharing settings?"');
  await A.screenshot({ path: `${OUT}/03-change-and-unlink.png` });
  await A.click('.nc-confirm .nc-confirm-buttons button:first-child'); // "Change, then unlink"
  await A.waitForSelector('.nc-share-unlinked');
  r.ok(/no longer follow its parent page, Parent doc/.test(await A.textContent('.nc-share-unlinked') ?? ''), 'unlinked banner names the parent page');
  r.ok(!!(await waitFor(async () => !(await A.$(`.nc-share-row.person[data-user-id="${b.userId}"]`)))), 'Ben is gone from the child');
  r.ok((await call(B, 'getPageSharing', { pageId: child })).__error === undefined, 'Ben still sees the child through the group (Can view)');
  // remove the group on the (now unlinked) child: no confirm, Ben loses access
  await A.click('.nc-share-group-row .nc-share-role');
  await pick(A, 'Remove');
  r.ok(!!(await waitFor(async () => (await call(B, 'getPageSharing', { pageId: child })).__error === 404)), 'without the group Ben has no access to the child');
  r.ok(!(await call(B, 'getPageSharing', { pageId: parent })).__error, 'Ben keeps access to the parent');
  await A.screenshot({ path: `${OUT}/04-unlinked.png` });
  await A.click('.nc-share-unlinked-relink');
  await A.waitForSelector('.nc-confirm');
  r.ok(/Reconnect sharing settings/.test(await A.textContent('.nc-confirm') ?? ''), 'Relink confirm');
  await A.click('.nc-confirm .nc-confirm-buttons button:first-child'); // "Relink"
  r.ok(!!(await waitFor(async () => !(await A.$('.nc-share-unlinked')))), 'banner gone after Relink');
  r.ok(!!(await waitFor(async () => !(await call(B, 'getPageSharing', { pageId: child })).__error)), 'Ben can open the child again');
  await closeShare(A);

  // ---- Remove from search (Everyone at Share Co › role menu)
  await A.goto(`${BASE}/${domain}/Parent-doc-${compact(parent)}`);
  await A.waitForSelector('h1[data-content-editable-leaf]');
  await openShare(A);
  await A.click('.nc-share-ga-btn');
  await pick(A, 'Everyone at Share Co');
  await waitFor(async () => (await blockOf(A, parent))?.permissions?.some((p) => p.type === 'space_permission'));
  await A.waitForTimeout(400);
  await A.click('.nc-share-general .nc-share-role');
  await A.waitForSelector('.lit-overlay-container :text("Remove from search")');
  await A.screenshot({ path: `${OUT}/05-hide-in-search.png` });
  await pick(A, 'Remove from search');
  r.ok(!!(await waitFor(async () => (await blockOf(A, parent))?.permissions?.some((p) => p.type === 'space_permission' && p.unlisted === true))), 'Remove from search sets space_permission.unlisted');
  await closeShare(A);

  // ---- guest invite requests (Security: guests only by request) — a member's invite becomes a request
  await A.evaluate(async (spaceId) => {
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'space', id: spaceId, spaceId }, path: [], command: 'update', args: { disable_guests: true } },
      { pointer: { table: 'space', id: spaceId, spaceId }, path: ['settings'], command: 'update', args: { allow_guest_invite_requests: true } },
    ] }] }) });
  }, spaceId);
  const benPage = await createPrivatePage(B, spaceId, 'Ben notes');
  await B.goto(`${BASE}/${domain}/Ben-notes-${compact(benPage)}`);
  await B.waitForSelector('h1[data-content-editable-leaf]');
  await openShare(B);
  const guest = `gil${id}@outside.dev`;
  await B.fill('.nc-share-invite-input input', guest);
  await B.click('.nc-share-invite-btn');
  const toast = await waitFor(async () => {
    const txt = await B.evaluate(() => document.body.innerText);
    return /Requested guest access for .*gil/.test(txt) ? txt.match(/Requested guest access for [^\n]*/)[0] : null;
  });
  r.ok(!!toast, `toast: ${toast}`);
  await B.screenshot({ path: `${OUT}/06-guest-request.png` });
  const inbox = await call(A, 'getInbox', { spaceId, status: 'all' });
  const reqs = Object.values(inbox.recordMap?.notification ?? {}).map((e) => e.value?.value ?? e.value).filter((n) => n?.type === 'access_requested' && n.activity?.kind === 'guest_invite');
  r.ok(reqs.length === 1 && (reqs[0].activity.for_emails ?? []).includes(guest), 'workspace owner gets the guest invite request');
  await closeShare(B);

  // ---- database row › ••• › Notify me: All updates / Important updates / Replies plus @mentions
  const rowId = await A.evaluate(async ([spaceId, uid]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const dbId = crypto.randomUUID();
    const colId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: dbId, spaceId }, path: [], command: 'set', args: { id: dbId, type: 'collection_view_page', collection_id: colId, view_ids: [], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }] } },
      { pointer: { table: 'collection', id: colId, spaceId }, path: [], command: 'set', args: { id: colId, name: [['Tasks']], schema: { title: { name: 'Name', type: 'title' } }, parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: dbId } },
      { pointer: { table: 'block', id: rowId, spaceId }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: colId, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['Ship it']] } } },
    ] }] });
    return rowId;
  }, [spaceId, a.userId]);
  await A.goto(`${BASE}/${domain}/Ship-it-${compact(rowId)}`);
  await A.waitForSelector('h1[data-content-editable-leaf]');
  await A.click('.lit-topbar-more-button');
  const notifyItem = A.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: /^Notify me/ }).first();
  await notifyItem.hover();
  await A.waitForSelector('.lit-overlay-container :text("Important updates")', { timeout: 5000 }).catch(() => null);
  const sub = await A.evaluate(() => document.querySelector('.lit-overlay-container')?.parentElement?.innerText ?? '');
  r.ok(/All updates/.test(sub) && /Important updates/.test(sub) && /Replies plus @mentions/.test(sub), 'row Notify me offers All updates / Important updates / Replies plus @mentions');
  await A.screenshot({ path: `${OUT}/07-row-notify.png` });
  await pick(A, 'Important updates');
  r.ok(!!(await waitFor(async () => (await call(A, 'getPageNotifySettings', { pageId: rowId })).level === 'important_updates')), 'level saved as important_updates');
} catch (e) {
  console.log('FAIL exception', e.message.slice(0, 800));
  process.exitCode = 1;
} finally {
  await browser.close();
  r.done();
}

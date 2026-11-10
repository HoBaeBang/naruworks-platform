// Move to: the picker works in the moved page's own workspace (not the session's). A guest with full access
// to a page in someone else's workspace sees that workspace in the footer and no Private section there; the server
// refuses a hand-built cross-workspace move.
// NC_BASE=http://127.0.0.1:5541 node e2e/secfix-moveto.mjs
import { BASE, launch } from './lib.mjs';
import { apiLogin, call, compact, createPrivatePage, uniq } from './ws-lib.mjs';

const { browser, page } = await launch();
page.setDefaultTimeout(15000);
let failed = 0;
let passed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (cond) passed++; else { failed++; process.exitCode = 1; } };
const extra = [];
try {
  const u = uniq();
  const ownerEmail = `owner${u}@move.dev`;
  const guestEmail = `guest${u}@move.dev`;
  // the guest has an account (and a workspace of their own) first
  const guestCtx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  extra.push(guestCtx);
  const guest = await guestCtx.newPage();
  guest.setDefaultTimeout(15000);
  const g = await apiLogin(guest, { email: guestEmail, name: 'Gus Guest', workspace: `Gus home ${u}` });

  const { spaceId } = await apiLogin(page, { email: ownerEmail, name: 'Owen Owner', workspace: `Owen Co ${u}` });
  const uc = await call(page, 'loadAccountData', {});
  const domain = (uc.recordMap.space[spaceId].value.value ?? uc.recordMap.space[spaceId].value).domain;
  const pid = await createPrivatePage(page, spaceId, `Shared plan ${u}`);
  ok(!(await call(page, 'invitePagePermissions', { pageId: pid, userIds: [g.userId], role: 'editor' })).__error, 'page shared with the guest (full access)');

  await guest.goto(`${BASE}/${domain}/${compact(pid)}`);
  await guest.waitForSelector('.nc-page-scroller', { timeout: 20000 });
  await guest.waitForTimeout(600);
  await guest.click('.lit-topbar-more-button');
  await guest.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Move to/ }).first().click();
  await guest.waitForSelector('.nc-moveto');
  const footer = await guest.textContent('.nc-moveto-space');
  // a guest can't read the other workspace's record, so its name may show as "Workspace" — never the guest's own one
  ok(!(footer ?? '').includes(`Gus home ${u}`), `the picker works in the page's workspace, not the guest's own ("${footer}")`);
  ok(await guest.locator('.nc-moveto-hint').count() === 0, 'not in "duplicate to another workspace" mode');
  await guest.locator('.nc-moveto input').fill('private');
  await guest.waitForTimeout(300);
  ok(await guest.locator('.nc-moveto-row', { hasText: /Private/ }).count() === 0, 'a guest has no Private section in that workspace to move to');
  await guest.keyboard.press('Escape');

  // the server: a hand-built move into the guest's own workspace is refused
  const gsv = Object.values((await call(guest, 'loadAccountData', {})).recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === g.spaceId);
  const r = await call(guest, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: g.spaceId, operations: [
    { pointer: { table: 'block', id: pid, spaceId: g.spaceId }, path: [], command: 'update', args: { parent_id: g.spaceId, parent_table: 'space' } },
    { pointer: { table: 'space_view', id: gsv.id, spaceId: g.spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: pid } },
  ] }] });
  ok(r.__error === 403, 'a cross-workspace move through a transaction is refused');
} catch (e) {
  ok(false, `unexpected: ${e.message}`);
} finally {
  for (const c of extra) await c.close().catch(() => {});
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
}

// Settings / admin UI: membership admins don't get owner-only workspace settings (tabs hidden, Requests
// switches off), People › Guests is for admins only, Content search › Retained pages lists and restores a page deleted
// from Trash, the Trash footer shows the workspace's Trash retention, and "Start or join a workspace" follows the
// allowed-domain join mode (Request → Access requested).
// NC_BASE=http://127.0.0.1:5541 node e2e/secfix-settings.mjs
import { mkdirSync } from 'node:fs';
import { launch } from './lib.mjs';
import { apiLogin, call, createPrivatePage, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/wave3/secfix/shots';
mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
page.setDefaultTimeout(15000);
let failed = 0;
let passed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (cond) passed++; else { failed++; process.exitCode = 1; } };
async function step(name, fn, p = page) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: ${String(e.message ?? e).split('\n')[0]}`);
    await p.screenshot({ path: `${OUT}/fail-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
    for (let i = 0; i < 3; i++) await p.keyboard.press('Escape').catch(() => {});
  }
}
const dialog = '.nc-set-dialog';
async function openSettings(p, key) {
  if (!(await p.locator(dialog).count())) {
    await p.keyboard.press('Meta+Comma');
    await p.waitForSelector(dialog);
  }
  if (key) {
    await p.click(`.nc-set-tab[data-settings-key="${key}"]`);
    await p.waitForTimeout(400);
  }
}
async function closeSettings(p) {
  if (await p.locator(dialog).count()) await p.locator('.nc-set-close').click();
  await p.waitForTimeout(200);
}

const u = uniq();
const domain = `secfix${u}.dev`;
const ownerEmail = `owner${u}@${domain}`;
const adminEmail = `admin${u}@${domain}`;
const memberEmail = `member${u}@${domain}`;
const joinerEmail = `joiner${u}@${domain}`;
const extra = [];
try {
  const { spaceId } = await apiLogin(page, { email: ownerEmail, name: 'Olga Owner', workspace: `Secfix ${u}` });
  ok(!(await call(page, 'changePlan', { spaceId, plan: 'enterprise' })).__error, 'owner on an Enterprise workspace');
  ok(!(await call(page, 'inviteMembers', { spaceId, emails: [adminEmail], role: 'membership_admin' })).__error, 'membership admin invited');
  ok(!(await call(page, 'inviteMembers', { spaceId, emails: [memberEmail], role: 'editor' })).__error, 'member invited');

  // ---------------------------------------------------------------- membership admin
  const adminCtx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  extra.push(adminCtx);
  const admin = await adminCtx.newPage();
  admin.setDefaultTimeout(15000);
  await step('admin settings', async () => {
    await apiLogin(admin, { email: adminEmail, name: 'Adam Admin', createWorkspace: false });
    await openSettings(admin);
    for (const key of ['security', 'identity', 'teamspaces', 'sidebar', 'billing']) {
      ok(await admin.locator(`.nc-set-tab[data-settings-key="${key}"]`).count() === 0, `membership admin: no ${key} tab (owner-only workspace settings)`);
    }
    ok(await admin.locator('.nc-set-tab[data-settings-key="members"]').count() === 1, 'membership admin: People tab');
    await openSettings(admin, 'requests');
    ok(await admin.locator('.nc-set-row[data-setting="allow-upgrade-requests"] input[role="switch"]').isDisabled(), 'membership admin: "Let members request upgrades" is off-limits');
    await openSettings(admin, 'general');
    ok(await admin.locator('.nc-set-row[data-setting="workspace-name"], input[aria-label="Workspace name"]').count() === 0, 'membership admin: no workspace name / icon');
    await openSettings(admin, 'members');
    ok(await admin.locator('.nc-set-tabs [role="tab"]', { hasText: 'Guests' }).count() === 1, 'membership admin: People › Guests');
    ok(await admin.locator('.nc-set-row[data-setting="people-directory"]').count() === 0, 'membership admin: no Profiles switches');
    await admin.screenshot({ path: `${OUT}/admin-people.png` });
    // the server agrees
    const r = await call(admin, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'space', id: spaceId, spaceId }, path: ['settings'], command: 'update', args: { limit_team_creation: true } }] }] });
    ok(r.__error === 403, 'membership admin: a hand-built settings write is refused');
    await closeSettings(admin);
  }, admin);

  // ---------------------------------------------------------------- member: no guest list
  const memberCtx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  extra.push(memberCtx);
  const member = await memberCtx.newPage();
  await step('member people', async () => {
    await apiLogin(member, { email: memberEmail, name: 'Mia Member', createWorkspace: false });
    await openSettings(member, 'members');
    ok(await member.locator('.nc-set-tabs [role="tab"]', { hasText: 'Guests' }).count() === 0, 'member: no People › Guests tab');
    ok((await call(member, 'getWorkspaceGuests', { spaceId })).__error === 403, 'member: the guest list API refuses');
    await closeSettings(member);
  }, member);

  // ---------------------------------------------------------------- owner: retained pages, Trash retention
  await step('retained pages', async () => {
    const pid = await createPrivatePage(page, spaceId, `Retained ${u}`);
    await call(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'block', id: pid, spaceId }, path: ['alive'], command: 'set', args: false }] }] });
    ok(!(await call(page, 'deleteBlocksPermanently', { blockIds: [pid] })).__error, 'page deleted from Trash');
    await page.reload();
    await page.waitForSelector('nav.lit-sidebar-container');
    await openSettings(page, 'content-search');
    const ack = page.locator('[data-testid="content-search-ack"]').getByText('Acknowledge', { exact: true });
    if (await ack.count()) { await ack.click(); await page.waitForTimeout(600); }
    await page.click('[data-filter="status"]');
    const opt = page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Retained pages' }).first();
    ok(await opt.count() === 1, 'Content search › Page status offers "Retained pages"');
    await opt.click();
    const rowSel = `tr[data-page-id="${pid}"]`;
    await page.waitForSelector(rowSel);
    ok((await page.locator(rowSel).innerText()).includes('Retained'), 'the deleted page is listed as Retained');
    await page.screenshot({ path: `${OUT}/content-search-retained.png` });
    await page.locator(`${rowSel} [aria-label="More actions"]`).click();
    await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Put back where it was' }).first().click();
    const back = await waitFor(async () => {
      const rv = await call(page, 'fetchRecords', { requests: [{ pointer: { table: 'block', id: pid }, version: -1 }] });
      const v = rv.recordMap?.block?.[pid]?.value?.value ?? rv.recordMap?.block?.[pid]?.value;
      return v?.alive === true;
    });
    ok(!!back, 'Restore brings the page back');
    await closeSettings(page);
  });

  await step('trash footer', async () => {
    await call(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'space', id: spaceId, spaceId }, path: ['settings'], command: 'update', args: { trash_retention_days: 7 } }] }] });
    await page.reload();
    await page.waitForSelector('nav.lit-sidebar-container');
    await page.click('nav [aria-label="Library, Trash, and more…"]');
    await page.click('.lit-overlay-container [role=option]:has-text("Trash")');
    await page.waitForSelector('.nc-trash-footer');
    const text = await page.locator('.nc-trash-footer').innerText();
    ok(text.includes('7 days'), `Trash footer shows the workspace's retention ("${text.trim().slice(0, 80)}")`);
    await page.keyboard.press('Escape');
  });

  // ---------------------------------------------------------------- Start or join a workspace: Request to join
  await step('join request', async () => {
    // the joiner signed up before the domain was allowed (new accounts on an allowed domain ask at sign-up already)
    const joinCtx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
    extra.push(joinCtx);
    const joiner = await joinCtx.newPage();
    joiner.setDefaultTimeout(15000);
    const { userId: joinerId } = await apiLogin(joiner, { email: joinerEmail, name: 'Jo Joiner', workspace: `Jo ${u}` });
    ok(!(await call(page, 'setAllowedEmailDomains', { spaceId, domains: [domain] })).__error, 'owner allows the email domain');
    const mode = await call(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'space', id: spaceId, spaceId }, path: ['settings'], command: 'update', args: { allowed_email_domain_join: 'request' } }] }] });
    ok(!mode.__error, `owner sets "Request to join"${mode.__error ? ` (${mode.message})` : ''}`);
    await joiner.click('nav .lit-sidebar-switcher');
    await joiner.click('[aria-label="Account options"]');
    await joiner.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Start or join a workspace' }).first().click();
    const rowSel = `.nc-ws-join-row[data-space-id="${spaceId}"]`;
    await joiner.waitForSelector(rowSel);
    const btn = joiner.locator(`${rowSel} button`);
    const label = (await btn.innerText()).trim();
    ok(label === 'Request', `the workspace offers "Request" (Request to join) — got "${label}"`);
    await btn.click();
    await joiner.waitForFunction((sel) => document.querySelector(`${sel} button`)?.textContent?.trim() === 'Access requested', rowSel);
    ok(true, 'after asking it reads "Access requested"');
    await joiner.screenshot({ path: `${OUT}/join-request.png` });
    const sp = await call(page, 'fetchRecords', { requests: [{ pointer: { table: 'space', id: spaceId }, version: -1 }] });
    const space = sp.recordMap.space[spaceId].value.value ?? sp.recordMap.space[spaceId].value;
    ok((space.settings.member_requests ?? []).some((r) => r.emails.includes(joinerEmail)) && !space.permissions.some((p) => p.user_id === joinerId && p.role !== 'none'), 'a member request was filed; the joiner is not a member');
  });
} catch (e) {
  ok(false, `unexpected: ${e.message}`);
} finally {
  for (const c of extra) await c.close().catch(() => {});
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
}

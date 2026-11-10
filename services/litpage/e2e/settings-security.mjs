// Settings › Security / Teamspaces / Preferences on an Enterprise workspace (simulated billing):
// workspace security toggles are enforced by the server and reflected in members' UI — Disable export, Disable
// publishing sites/forms/links, Disable duplicating pages to other workspaces, Allow members to invite guests,
// Allow non-members to request page access, Limit teamspace creation — then the Preferences defects: High contrast
// (root data-contrast + darker tokens), Start week on Monday (date picker), text direction controls (block menu →
// dir=rtl) and Show my view history (page analytics).
// NC_BASE=http://127.0.0.1:5451 node e2e/settings-security.mjs
import { mkdirSync } from 'node:fs';
import { BASE, hoverClick, launch } from './lib.mjs';
import { apiLogin, call, createPrivatePage, uniq } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-settings/security';
mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
let passed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (cond) passed++; else { failed++; process.exitCode = 1; } };
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png` });
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: ${String(e.message ?? e).split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
    if (mp) await shot(`fail-${name.replace(/\W+/g, '-')}-member`, mp).catch(() => {});
    for (const p of [page, mp].filter(Boolean)) for (let i = 0; i < 3; i++) await p.keyboard.press('Escape').catch(() => {});
  }
}

const dialog = '.nc-set-dialog';
const sub = '.nc-set-subdialog';
const menu = '.lit-overlay-container';
const row = (id, p = page) => p.locator(`.nc-set-row[data-setting="${id}"]`);
async function openSettings(key, p = page) {
  if (!(await p.locator(dialog).count())) {
    await p.keyboard.press('Meta+Comma');
    await p.waitForSelector(dialog);
  }
  await p.click(`.nc-set-tab[data-settings-key="${key}"]`);
  await p.waitForTimeout(400);
}
async function closeSettings(p = page) {
  while (await p.locator(sub).count()) { await p.keyboard.press('Escape'); await p.waitForTimeout(100); }
  if (await p.locator(dialog).count()) await p.locator('.nc-set-close').click();
  await p.waitForTimeout(200);
}
async function toggle(id, p = page) {
  await row(id, p).locator('input[role="switch"]').click();
  if (await p.locator(sub).count()) await p.locator(`${sub} .nc-set-btn.danger, ${sub} .nc-set-btn.primary`).first().click();
  await p.waitForTimeout(600);
}
async function pill(label, p = page) {
  await p.locator('.nc-set-panel .nc-set-pills [role="tab"], .nc-set-panel .nc-set-pills .nc-set-pill', { hasText: label }).first().click();
  await p.waitForTimeout(300);
}
const errOf = (r) => (r && r.__error) || 200;

const u = uniq();
let mp; // member page
let spaceId = '';
let domain = '';
let pageId = '';
let memberId = '';
try {
  ({ spaceId } = await apiLogin(page, { email: `sec${u}@test.dev`, name: 'Sam Security', workspace: `Sec Co ${u}` }));
  ok(!(await call(page, 'changePlan', { spaceId, plan: 'enterprise' })).__error, 'Enterprise workspace');
  const memberEmail = `secmember${u}@test.dev`;
  await call(page, 'inviteMembers', { spaceId, emails: [memberEmail], role: 'editor' });
  pageId = await createPrivatePage(page, spaceId, `Roadmap ${u}`);
  const uc = await call(page, 'loadAccountData', {});
  domain = (uc.recordMap.space[spaceId].value.value ?? uc.recordMap.space[spaceId].value).domain;
  const mctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  mp = await mctx.newPage();
  mp.setDefaultTimeout(15000);
  mp.on('pageerror', (e) => errors.push(`[member] ${e.message}`));
  ({ userId: memberId } = await apiLogin(mp, { email: memberEmail, name: 'Mia Member', createWorkspace: false }));
  // full access for the member (so only the workspace policy can stop them)
  ok(!(await call(page, 'invitePagePermissions', { pageId, userIds: [memberId], role: 'editor' })).__error, 'page shared with the member (Full access)');
  await page.reload();
  await page.waitForSelector('nav.lit-sidebar-container');

  await step('disable export', async () => {
    await openSettings('security');
    await toggle('disable-export');
    ok(await row('disable-export').locator('input[role="switch"]').isChecked(), 'Disable export on');
    ok(errOf(await call(mp, 'startPageExport', { blockId: pageId, format: 'markdown' })) === 403, 'member export refused by the server (403)');
    ok(errOf(await call(page, 'startPageExport', { blockId: pageId, format: 'markdown' })) === 200, 'owners can still export');
    await mp.goto(`${BASE}/${domain}/${pageId.replace(/-/g, '')}`);
    await mp.waitForSelector('h1[data-content-editable-leaf]');
    await mp.click('.lit-topbar-more-button');
    await mp.waitForSelector(`${menu} [role="option"], ${menu} [role="menuitem"]`);
    ok(await mp.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: /^Export/ }).count() === 0, 'member page menu has no Export');
    await mp.keyboard.press('Escape');
    await toggle('disable-export');
    ok(errOf(await call(mp, 'startPageExport', { blockId: pageId, format: 'markdown' })) === 200, 'turned off: member can export again');
  });

  await step('disable publishing', async () => {
    const pub = async (p) => {
      const rec = (await call(p, 'loadPage', { pageId })).recordMap.block[pageId];
      const perms = [...(((rec.value.value ?? rec.value).permissions) ?? []).filter((x) => x.type !== 'public_permission'), { type: 'public_permission', role: 'reader', published: true, published_time: Date.now() }];
      return call(p, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'block', id: pageId, spaceId }, path: ['permissions'], command: 'set', args: perms }] }] });
    };
    await toggle('disable-public-access');
    ok(await row('disable-public-access').locator('input[role="switch"]').isChecked(), 'Disable publishing on (after the confirmation)');
    ok(errOf(await pub(mp)) === 403, 'member can’t publish (403)');
    ok(errOf(await pub(page)) === 403, 'owner can’t publish either');
    await shot('01-security-general');
    await toggle('disable-public-access');
    ok(errOf(await pub(mp)) === 200, 'turned off: publishing works');
    const pageRec = (await call(page, 'loadPage', { pageId })).recordMap.block[pageId];
    const perms = ((pageRec.value.value ?? pageRec.value).permissions ?? []).filter((p) => p.type !== 'public_permission');
    await call(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'block', id: pageId, spaceId }, path: ['permissions'], command: 'set', args: perms }] }] });
  });

  await step('disable duplicating to other workspaces', async () => {
    const other = await call(mp, 'createWorkspace', { name: `Member side ${u}` });
    ok(!!other.spaceId, 'member has another workspace');
    await toggle('disable-move-to-space');
    const r = await call(mp, 'duplicateToSpace', { blockIds: [pageId], spaceId: other.spaceId });
    ok(r.__error === 403, `duplicating to another workspace refused (${r.message ?? r.__error})`);
    await toggle('disable-move-to-space');
    const r2 = await call(mp, 'duplicateToSpace', { blockIds: [pageId], spaceId: other.spaceId });
    ok(!r2.__error, 'turned off: duplicating works');
  });

  await step('guests and access requests', async () => {
    // a signed-in non-member asks for access
    const octx = await browser.newContext();
    const op = await octx.newPage();
    await apiLogin(op, { email: `stranger${u}@test.dev`, name: 'Stan Stranger', createWorkspace: true, workspace: 'Elsewhere' });
    await openSettings('security');
    await pill('General');
    await toggle('allow-access-requests');
    ok(!(await row('allow-access-requests').locator('input[role="switch"]').isChecked()), 'Allow non-members to request page access off');
    const denied = await call(op, 'requestPageAccess', { pageId });
    ok(denied.__error === 403, `access requests from non-members refused while off (“${denied.message}”)`);
    // guests can only be turned off once non-member access requests are off
    await pill('Members & guests');
    await toggle('allow-guests');
    ok(!(await row('allow-guests').locator('input[role="switch"]').isChecked()), 'Allow members to invite guests off');
    const refused = await call(mp, 'invitePagePermissions', { pageId, emails: [`outsider${u}@elsewhere.dev`], role: 'reader' });
    ok(refused.__error === 403 && /invite guests/i.test(refused.message ?? ''), `member guest invite refused (“${refused.message}”)`);
    ok(!(await call(page, 'invitePagePermissions', { pageId, emails: [`ownerguest${u}@elsewhere.dev`], role: 'reader' })).__error, 'owners can still invite guests');
    await shot('02-security-members');
    await toggle('allow-guests');
    ok(await row('allow-guests').locator('input[role="switch"]').isChecked(), 'guests allowed again');
    await pill('General');
    await toggle('allow-access-requests');
    const allowed = await call(op, 'requestPageAccess', { pageId });
    ok(!allowed.__error && allowed.requested, 'access requests on again: the request goes through');
    await octx.close();
  });

  await step('limit teamspace creation', async () => {
    await openSettings('teamspaces');
    await toggle('limit-team-creation');
    ok(await row('limit-team-creation').locator('input[role="switch"]').isChecked(), 'Limit teamspace creation on');
    await closeSettings();
    await mp.reload();
    await mp.waitForSelector('nav.lit-sidebar-container');
    await mp.waitForTimeout(800);
    await hoverClick(mp, '.nc-sb-section[data-section="teamspaces"] .nc-sb-section-header', 'Open menu');
    const item = mp.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: /New team/ }).first();
    await item.waitFor();
    ok((await item.getAttribute('aria-disabled')) === 'true', 'member: New team disabled in the sidebar menu');
    await shot('03-member-teamspace-menu', mp);
    await mp.keyboard.press('Escape');
    const tid = crypto.randomUUID();
    const team = { id: tid, space_id: spaceId, name: 'Rogue', team_pages: [], parent_id: spaceId, parent_table: 'space', alive: true, membership: [{ user_id: memberId, role: 'owner', added_time: Date.now() }], settings: { type: 'open' }, created_time: Date.now(), created_by_id: memberId };
    const r = await call(mp, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'team', id: tid, spaceId }, path: [], command: 'set', args: team }] }] });
    ok(r.__error === 403, 'member teamspace creation refused by the server');
    await openSettings('teamspaces');
    await toggle('limit-team-creation');
    await closeSettings();
  });

  await step('high contrast', async () => {
    const before = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lp-text-secondary').trim());
    await openSettings('preferences');
    await row('contrast').locator('.nc-set-dropdown').click();
    await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: /^High contrast/ }).first().click();
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.documentElement.getAttribute('data-contrast')) === 'high', 'root marked data-contrast="high"');
    const after = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lp-text-secondary').trim());
    ok(before !== after && after.length > 0, `secondary text token darkened (${before} → ${after})`);
    await shot('04-high-contrast');
    await row('contrast').locator('.nc-set-dropdown').click();
    await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: /^Standard contrast/ }).first().click();
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => document.documentElement.getAttribute('data-contrast')) === null, 'standard contrast restores the tokens');
  });

  await step('start week on Monday + text direction', async () => {
    await openSettings('preferences');
    const sw = row('week-start').locator('input[role="switch"]');
    if (await sw.isChecked()) await sw.click();
    await closeSettings();
    await page.goto(`${BASE}/${domain}/${pageId.replace(/-/g, '')}`);
    await page.click('h1[data-content-editable-leaf]');
    await page.keyboard.press('Meta+ArrowRight');
    await page.keyboard.press('Enter');
    await page.keyboard.type('@today');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    const token = page.locator('.lit-date-mention-token').first();
    await token.waitFor();
    await token.click();
    await page.waitForSelector('.nc-dp-table th');
    ok((await page.locator('.nc-dp-table th').first().textContent()).trim().startsWith('Su'), 'date picker starts on Sunday by default');
    await page.keyboard.press('Escape');
    await openSettings('preferences');
    await row('week-start').locator('input[role="switch"]').click();
    await page.waitForTimeout(400);
    await closeSettings();
    await token.click();
    await page.waitForSelector('.nc-dp-table th');
    ok((await page.locator('.nc-dp-table th').first().textContent()).trim().startsWith('Mo'), 'Start week on Monday: the date picker starts on Monday');
    await shot('05-week-monday');
    await page.keyboard.press('Escape');
    // text direction
    await openSettings('preferences');
    await row('text-direction').locator('input[role="switch"]').click();
    await page.waitForTimeout(300);
    await closeSettings();
    const block = page.locator('.lit-page-content [data-block-id]').filter({ has: page.locator('.lit-date-mention-token') }).first();
    const blockId = await block.getAttribute('data-block-id');
    await block.locator('[contenteditable]').first().click();
    await page.keyboard.press('Meta+/');
    await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: 'Text direction' }).first().hover();
    await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: 'Right to left' }).first().click();
    await page.waitForTimeout(400);
    ok(await page.locator(`[data-block-id="${blockId}"][dir="rtl"]`).count() === 1, 'Text direction › Right to left sets dir=rtl on the block');
    await shot('06-text-direction');
  });

  await step('show my view history', async () => {
    await openSettings('preferences');
    const r = row('view-history');
    await r.scrollIntoViewIfNeeded();
    const sw = r.locator('input[role="switch"]');
    if (await sw.count()) {
      if (await sw.isChecked()) await sw.click();
    } else {
      await r.locator('.nc-set-dropdown').click();
      await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: /Don.t allow|Off|Never/ }).first().click();
    }
    await page.waitForTimeout(600);
    await closeSettings();
    const a = await call(page, 'getPageStats', { pageId, days: 28 });
    ok(a.showViewHistory === false, 'page analytics: my view history is hidden from editors');
  });
} catch (e) {
  ok(false, `unexpected: ${e.message}`);
} finally {
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
}

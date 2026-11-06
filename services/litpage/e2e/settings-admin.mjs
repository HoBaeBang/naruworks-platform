// Settings › workspace admin, on an Enterprise workspace (simulated billing):
// ?target= deep link → Search settings (location + highlight, owner-only rows) → General › Allowed email domains
// (suggested domain, join mode; a sign-up on that domain joins / requests to join) → Members CSV (columns, guests)
// → Audit log (events from the changes above, CSV export) → Analytics tabs → Content search → Sidebar presets
// → Connections › Manage (owner-only tab, webhook toggle is server state) → Developer (developer bar, block menu
// Developer section, real personal access tokens) → Public pages (homepage limited to published sites; /site/<domain>)
// → People › Restricted member (member loses workspace-wide access) → page analytics off ("viewership tracking is disabled").
// NC_BASE=http://127.0.0.1:5451 node e2e/settings-admin.mjs
import { mkdirSync, readFileSync } from 'node:fs';
import { BASE, launch } from './lib.mjs';
import { apiLogin, call, createPrivatePage, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-settings/admin';
mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png` });
let failed = 0;
let passed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (cond) passed++; else { failed++; process.exitCode = 1; } };
async function step(name, fn, p = page) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: ${String(e.message ?? e).split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`, p).catch(() => {});
    for (let i = 0; i < 3; i++) await p.keyboard.press('Escape').catch(() => {});
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
async function pickMenu(text, p = page) {
  const item = p.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: text }).first();
  await item.waitFor();
  await item.click();
}
async function download(trigger, p = page) {
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), trigger()]);
  return readFileSync(await dl.path(), 'utf8');
}

const u = uniq();
const domain = `acme${u}.dev`;
const ownerEmail = `owner${u}@${domain}`;
const memberEmail = `member${u}@${domain}`;
let spaceId = '';
let spaceDomainName = '';
let privatePageId = '';
let memberCtx;
let memberPage;
try {
  ({ spaceId } = await apiLogin(page, { email: ownerEmail, name: 'Olivia Owner', workspace: `Admin Co ${u}` }));
  ok(!!spaceId, 'owner signed up with a workspace');
  ok(!(await call(page, 'changePlan', { spaceId, plan: 'enterprise' })).__error, 'workspace on the Enterprise plan (simulated billing)');
  const invited = await call(page, 'inviteMembers', { spaceId, emails: [memberEmail], role: 'editor' });
  ok(!invited.__error, 'member invited');
  const uc = await call(page, 'loadAccountData', {});
  spaceDomainName = (uc.recordMap.space[spaceId].value.value ?? uc.recordMap.space[spaceId].value).domain;
  privatePageId = await createPrivatePage(page, spaceId, `Quarterly plan ${u}`);
  await page.reload();
  await page.waitForSelector('nav.lit-sidebar-container');
  await page.waitForTimeout(800);

  await step('deep link + settings search', async () => {
    await page.goto(`${BASE}/${spaceDomainName}?target=audit_log`);
    await page.waitForSelector(dialog);
    await page.waitForTimeout(500);
    ok(await page.locator('.nc-set-tab[data-settings-key="audit-log"][aria-selected="true"]').count() === 1, '?target=audit_log opens Settings › Audit log');
    ok(!page.url().includes('target='), 'target parameter removed from the URL');
    await page.fill('.nc-set-search-box input', 'webhook');
    const hit = page.locator('.nc-set-hit', { hasText: 'Allow automations to run webhook actions' });
    await hit.waitFor();
    ok((await hit.locator('.nc-set-hit-loc').textContent()).includes('Connections'), 'search result shows its location (… / Connections)');
    await hit.click();
    await page.waitForSelector('.nc-set-row[data-setting="allow-webhook-actions"]');
    ok(await page.locator('[role="tab"][aria-selected="true"]', { hasText: 'Manage' }).count() === 1, 'picking the result opens Connections › Manage');
    ok(await waitFor(async () => (await row('allow-webhook-actions').getAttribute('class')).includes('nc-set-flash'), { timeout: 3000 }), 'the row flashes');
    await page.fill('.nc-set-search-box input', '');
    await page.waitForTimeout(200);
    ok(await page.locator('.nc-set-tab[data-settings-key="connections"][aria-selected="true"]').count() === 1, 'Connections is the selected section');
    await shot('01-search-hit');
  });

  await step('allowed email domains', async () => {
    await openSettings('general');
    const r = row('allowed-email-domains');
    await r.scrollIntoViewIfNeeded();
    const sug = r.locator('.nc-set-domain-suggest-item', { hasText: domain });
    ok(await sug.count() === 1, `suggested domain ${domain} (a member's email domain)`);
    await sug.locator('.nc-set-btn', { hasText: 'Add' }).click();
    await r.locator('.nc-set-chip', { hasText: domain }).waitFor();
    ok(true, 'domain added as a chip');
    // consumer domains are refused by the server
    const bad = await call(page, 'setAllowedEmailDomains', { spaceId, domains: [domain, 'gmail.com'] });
    ok(bad.__error === 400, 'gmail.com refused as an allowed domain');
    ok(await row('allowed-email-domains-join').locator('.nc-set-dropdown', { hasText: 'Join automatically' }).count() === 1, 'join mode defaults to Join automatically');
    await shot('02-allowed-domains');

    // a new sign-up on the domain joins automatically
    const ctxC = await browser.newContext();
    const pc = await ctxC.newPage();
    await pc.goto(BASE + '/login');
    const joined = await pc.evaluate(async (email) => {
      const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
      const { devCode } = await post('sendSignInCode', { email });
      const { userId } = await post('signInWithEmail', { email, code: devCode });
      const uc = await post('loadAccountData', {});
      return { userId, spaces: Object.keys(uc.recordMap.space ?? {}) };
    }, `newbie${u}@${domain}`);
    ok(joined.spaces.includes(spaceId), 'a sign-up with an allowed domain joined the workspace');

    // "Request to join": the next sign-up files a member self request
    await row('allowed-email-domains-join').locator('.nc-set-dropdown').click();
    await pickMenu('Ask to join');
    await page.waitForTimeout(600);
    const asker = await pc.evaluate(async (email) => {
      await fetch('/api/rpc/signOut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
      const { devCode } = await post('sendSignInCode', { email });
      const { userId } = await post('signInWithEmail', { email, code: devCode });
      const uc = await post('loadAccountData', {});
      return { userId, spaces: Object.keys(uc.recordMap.space ?? {}) };
    }, `asker${u}@${domain}`);
    ok(!asker.spaces.includes(spaceId), '"Ask to join": the sign-up is not a member yet');
    await ctxC.close();
    await openSettings('requests');
    const req = page.locator('.nc-set-request', { hasText: `asker${u}@${domain}` });
    await req.waitFor();
    ok((await req.textContent()).includes('Member request'), 'Requests lists it as a member (self) request');
    await shot('03-requests-self');
    await req.locator('.nc-set-btn.primary', { hasText: 'Approve' }).click();
    await req.waitFor({ state: 'detached' });
    const after = await call(page, 'loadAccountData', {});
    const perms = (after.recordMap.space[spaceId].value.value ?? after.recordMap.space[spaceId].value).permissions;
    ok(perms.some((p) => p.user_id === asker.userId && p.role !== 'none'), 'approving adds them as a member');
    await openSettings('general');
    await row('allowed-email-domains-join').locator('.nc-set-dropdown').click();
    await pickMenu('Join automatically');
  });

  await step('members CSV', async () => {
    // a guest on the private page
    const g = await call(page, 'invitePagePermissions', { pageId: privatePageId, emails: [`guest${u}@outside.dev`], role: 'reader' });
    ok(!g.__error, 'guest invited to a page');
    await openSettings('general');
    const csv = await download(() => row('export-members').locator('.nc-set-btn', { hasText: 'Export' }).click());
    const head = csv.split('\n')[0];
    ok(head === '"Email","Name","Role","Permission groups","Pages","ID"', `CSV header follows Litpage (${head})`);
    ok(csv.includes(`"${ownerEmail}","Olivia Owner","Workspace owner"`), 'owner row with role');
    ok(new RegExp(`"guest${u}@outside.dev","[^"]*","Guest","","Quarterly plan ${u} \\(`).test(csv), 'guest row lists the page they can access');
  });

  await step('audit log', async () => {
    await openSettings('audit-log');
    await page.waitForSelector('.nc-set-audit-table');
    ok(await page.locator('tr[data-event="allowed_email_domain_added"]').count() >= 1, 'domain change recorded (Added allowed email domain)');
    ok(await page.locator('tr[data-event="member_invited"]').count() >= 1, 'member invite recorded');
    await shot('04-audit-log');
    await page.locator('.nc-set-audit .nc-set-btn', { hasText: 'Export' }).click();
    await pickMenu('Last 30 days');
    const csv = await download(() => page.locator(`${sub} .nc-set-btn.primary`).click());
    ok(/allowed email domain/i.test(csv), 'audit log CSV export contains the events');
    // members can't read it (server)
    ok(true, 'audit log is owner-only (server test: settings-admin.test.ts)');
  });

  await step('analytics + content search', async () => {
    await openSettings('analytics');
    await page.waitForSelector('.nc-set-statcard');
    for (const tab of ['Members', 'Content', 'AI', 'Search']) {
      const pill = page.locator('.nc-set-pills [role="tab"], .nc-set-pills .nc-set-pill', { hasText: new RegExp(`^${tab}`) }).first();
      ok(await pill.count() === 1, `Analytics › ${tab} tab`);
    }
    await shot('05-analytics');
    await openSettings('content-search');
    const ack = page.locator('[data-testid="content-search-ack"] .nc-set-btn.primary');
    if (await ack.count()) await ack.click();
    const input = page.locator('.nc-set-csearch .nc-set-search-inline input');
    await input.fill(`Quarterly plan ${u}`);
    await input.press('Enter');
    const hit = page.locator('.nc-set-panel tr', { hasText: `Quarterly plan ${u}` });
    await hit.first().waitFor();
    ok(true, 'content search finds the owner’s private page by title');
    await shot('06-content-search');
  });

  await step('sidebar presets', async () => {
    await openSettings('sidebar');
    await page.locator('.nc-set-panel .nc-set-btn.primary', { hasText: 'New tab' }).click();
    await page.fill(`${sub} input[aria-label="Name"]`, 'Engineering');
    await page.locator(`${sub} .nc-set-btn.primary`, { hasText: 'Save' }).click();
    await page.locator('.nc-set-presets', { hasText: 'Engineering' }).waitFor();
    await page.locator('.nc-set-savebar .nc-set-btn.primary', { hasText: 'Save changes' }).click();
    await page.waitForTimeout(600);
    const uc = await call(page, 'loadAccountData', {});
    const settings = (uc.recordMap.space[spaceId].value.value ?? uc.recordMap.space[spaceId].value).settings;
    ok(JSON.stringify(settings.sidebar_presets ?? {}).includes('Engineering'), 'preset saved to the workspace (space.settings.sidebar_presets)');
    await shot('07-sidebar-presets');
  });

  await step('connections manage', async () => {
    await openSettings('connections');
    await page.locator('[role="tab"]', { hasText: 'Manage' }).click();
    await row('allow-webhook-actions').waitFor();
    ok(await row('all-connections').count() === 1 && await row('all-personal-access-tokens').count() === 1, 'Manage lists All connections and All personal access tokens');
    await row('allow-webhook-actions').locator('input[role="switch"]').click();
    await page.waitForTimeout(600);
    let uc = await call(page, 'loadAccountData', {});
    ok((uc.recordMap.space[spaceId].value.value ?? uc.recordMap.space[spaceId].value).settings.disallow_webhook_automation_action === true, 'turning webhooks off writes disallow_webhook_automation_action (read by the automation engine)');
    await row('allow-webhook-actions').locator('input[role="switch"]').click();
    await page.waitForTimeout(600);
    uc = await call(page, 'loadAccountData', {});
    ok((uc.recordMap.space[spaceId].value.value ?? uc.recordMap.space[spaceId].value).settings.disallow_webhook_automation_action === false, 'turned back on');
    await shot('08-connections-manage');
  });

  await step('developer features + tokens', async () => {
    await openSettings('developers');
    await row('developer-mode').locator('input[role="switch"]').click();
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => localStorage.getItem('nc:developer-mode')) === '1', 'developer features are a per-browser setting');
    // personal access token (server-issued)
    await row('new-token').locator('.nc-set-btn', { hasText: 'New token' }).click();
    await page.fill(`${sub} input[aria-label="Name"]`, 'CI bot');
    await page.locator(`${sub} .nc-set-btn.primary`, { hasText: 'New token' }).click();
    const tokenInput = page.locator(`${sub} input[readonly]`);
    await tokenInput.waitFor();
    const token = await tokenInput.inputValue();
    ok(/^lp_pat_[A-Za-z0-9_-]{20,}$/.test(token), 'token shown once after creation');
    await page.keyboard.press('Escape');
    await page.locator('[data-testid="pat-table"] tr', { hasText: 'CI bot' }).waitFor();
    ok(true, 'token listed under Personal access tokens');
    const mcp = await page.evaluate(async (tok) => {
      const r = await fetch('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      return r.status;
    }, token);
    ok(mcp === 200, `the token authenticates against the Litpage MCP endpoint (HTTP ${mcp})`);
    await page.locator('[data-testid="pat-table"] tr', { hasText: 'CI bot' }).locator('.nc-set-btn', { hasText: 'Revoke' }).click();
    await page.locator('[data-testid="pat-table"] tr', { hasText: 'CI bot' }).waitFor({ state: 'detached' }).catch(() => {});
    const after = await page.evaluate(async (tok) => (await fetch('/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).status, token);
    ok(after === 401, `revoked token refused (HTTP ${after})`);
    await closeSettings();
    // developer bar on a page
    await page.goto(`${BASE}/${spaceDomainName}/${privatePageId.replace(/-/g, '')}`);
    await page.waitForSelector('.nc-dev-bar');
    ok(await page.locator('.nc-dev-bar .nc-dev-item[data-kind="page"]', { hasText: privatePageId }).count() === 1, 'developer bar shows the Page ID');
    ok(await page.locator('.nc-dev-bar .nc-dev-item[data-kind="workspace"]', { hasText: spaceId }).count() === 1, '… and the Workspace ID');
    await page.click('h1[data-content-editable-leaf]');
    await page.keyboard.press('Meta+ArrowRight'); // end of the title (macOS line end)
    await page.keyboard.press('Enter');
    await page.keyboard.type('Developer block');
    await page.waitForTimeout(400);
    ok(await page.locator('.nc-dev-bar .nc-dev-item[data-kind="block"]').count() === 1, 'the block holding the caret shows as Block');
    await shot('09-developer-bar');
    await page.keyboard.press('Meta+/');
    await page.waitForSelector(`${menu} [role="option"], ${menu} [role="menuitem"]`);
    ok(await page.locator(menu, { hasText: 'Developer' }).count() >= 1 && await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: 'Copy Block ID' }).count() === 1, 'block menu has the Developer section (Copy Block ID)');
    await shot('10-block-menu-developer');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Meta+Alt+Shift+KeyD');
    await page.waitForTimeout(300);
    ok(await page.locator('.nc-dev-bar').count() === 0, '⌘⌥⇧D hides the developer bar');
    await page.keyboard.press('Meta+Alt+Shift+KeyD');
    await page.evaluate(() => localStorage.setItem('nc:developer-mode', '0'));
  });

  await step('public pages: homepage + site root', async () => {
    await openSettings('public-pages');
    await page.locator('.nc-set-home-picker').click();
    ok(await page.locator(menu, { hasText: 'first publish a page on' }).count() === 1, 'homepage picker: “To choose a homepage, first publish a page on …” with no sites');
    await page.keyboard.press('Escape');
    // publish the private page as a site (owner transaction)
    const now = Date.now();
    const blk = (await call(page, 'loadPage', { pageId: privatePageId })).recordMap.block[privatePageId];
    const perms = [...((blk.value.value ?? blk.value).permissions ?? []), { type: 'public_permission', role: 'reader', published: true, published_time: now, added_timestamp: now }];
    const pub = await call(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'block', id: privatePageId, spaceId }, path: ['permissions'], command: 'set', args: perms }] }] });
    ok(!pub.__error, 'page published as a site');
    await closeSettings();
    await openSettings('public-pages');
    await page.locator('.nc-set-home-picker').click();
    await pickMenu(`Quarterly plan ${u}`);
    await page.locator('.nc-set-home-link', { hasText: `Quarterly plan ${u}` }).waitFor();
    ok(true, 'homepage set to the published page');
    await page.locator('.nc-set-ptile', { hasText: 'Published sites' }).click();
    ok(await page.locator('.nc-set-public-table[data-kind="site"] td', { hasText: `${spaceDomainName}.litpage.site` }).count() === 1, 'Sites table has the Domain column');
    await shot('11-public-pages');
    await closeSettings();
    // anonymous visitor at the domain root lands on the homepage
    const anon = await browser.newContext();
    const pa = await anon.newPage();
    await pa.goto(`${BASE}/site/${spaceDomainName}`);
    await pa.waitForURL(/\/public\//, { timeout: 10000 });
    ok(true, `/site/${spaceDomainName} redirects to the homepage (${new URL(pa.url()).pathname.slice(0, 40)}…)`);
    await pa.goto(`${BASE}/site/no-such-site-${u}`);
    await pa.waitForSelector('[data-testid="site-not-found"]');
    ok(true, 'an unknown domain shows “We couldn’t find this page”');
    await anon.close();
  });

  await step('restricted member', async () => {
    // a workspace-level page every member can open
    const wsPage = crypto.randomUUID();
    const userId = Object.keys((await call(page, 'loadAccountData', {})).recordMap.user_root)[0];
    const now = Date.now();
    const created = await call(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: wsPage, spaceId }, path: [], command: 'set', args: { id: wsPage, type: 'page', properties: { title: [[`Company wiki ${u}`]] }, content: [], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId } },
      { pointer: { table: 'space', id: spaceId, spaceId }, path: ['pages'], command: 'listAfter', args: { id: wsPage } },
    ] }] });
    ok(!created.__error, 'workspace page created');
    memberCtx = await browser.newContext({ viewport: { width: 1384, height: 853 } });
    memberPage = await memberCtx.newPage();
    const { userId: memberId } = await apiLogin(memberPage, { email: memberEmail, name: 'Max Member', createWorkspace: false });
    const before = await call(memberPage, 'loadPage', { pageId: wsPage });
    ok(!!before.recordMap.block?.[wsPage], 'as a member: the workspace page is readable');
    await openSettings('members');
    const mrow = page.locator(`.nc-set-utable-row[data-user-id="${memberId}"]`);
    await mrow.waitFor();
    await mrow.locator('.nc-set-dropdown, [aria-haspopup]').last().click();
    await pickMenu('Restricted member');
    await page.waitForTimeout(800);
    ok((await mrow.textContent()).includes('Restricted member'), 'role shows Restricted member');
    await shot('12-restricted-member');
    const after = await call(memberPage, 'loadPage', { pageId: wsPage });
    ok(!after.recordMap.block?.[wsPage], 'as a restricted member: the workspace page is no longer available');
    await memberPage.reload();
    await memberPage.waitForSelector('nav.lit-sidebar-container');
    await memberPage.waitForTimeout(1000);
    ok(!(await memberPage.locator('nav.lit-sidebar-container').textContent()).includes(`Company wiki ${u}`), 'restricted member’s sidebar doesn’t list the workspace page');
    await shot('12b-restricted-sidebar', memberPage);
    const pagesByOwner = await call(page, 'invitePagePermissions', { pageId: wsPage, userIds: [memberId], role: 'reader' });
    ok(!pagesByOwner.__error, 'owners can share pages with restricted members');
    const shared = await call(memberPage, 'loadPage', { pageId: wsPage });
    ok(!!shared.recordMap.block?.[wsPage], '… and then they can open them');
    // back to member for the next steps
    await mrow.locator('.nc-set-dropdown, [aria-haspopup]').last().click();
    await pickMenu(/^Member/);
    await page.waitForTimeout(500);
  });

  await step('page analytics off', async () => {
    await openSettings('general');
    const sw = row('page-view-analytics').locator('input[role="switch"]');
    await sw.click();
    await page.waitForTimeout(500);
    ok(!(await sw.isChecked()), 'Save and display page view analytics turned off');
    const res = await call(page, 'getPageStats', { pageId: privatePageId, days: 28 });
    ok(res.analyticsDisabled === true, 'server reports analyticsDisabled for the page panel');
    await sw.click();
    await page.waitForTimeout(400);
    await closeSettings();
  });

  await step('member view', async () => {
    if (!memberPage) return;
    await memberPage.reload();
    await memberPage.waitForSelector('nav.lit-sidebar-container');
    await openSettings('connections', memberPage);
    ok(await memberPage.locator('[role="tab"]', { hasText: 'Manage' }).count() === 0, 'members don’t get Connections › Manage');
    ok(await memberPage.locator('.nc-set-tab[data-settings-key="audit-log"]').count() === 0, 'members don’t see Audit log');
    const denied = await call(memberPage, 'getAuditLog', { spaceId });
    ok(denied.__error === 403, 'the audit log API refuses members (403)');
    await memberPage.fill('.nc-set-search-box input', 'webhook');
    await memberPage.waitForTimeout(300);
    ok(await memberPage.locator('.nc-set-hit', { hasText: 'Allow automations to run webhook actions' }).count() === 0, 'owner-only settings are not search results for members');
    await shot('13-member-settings', memberPage);
    await closeSettings(memberPage);
  }, memberPage);
  await step('profile discoverability', async () => {
    const addMember = async () => {
      await openSettings('members');
      await page.locator('.nc-set-panel .nc-set-btn.primary', { hasText: 'Add members' }).click();
      await page.waitForSelector('.nc-set-add-members input');
      await page.fill('.nc-set-add-members input', memberEmail);
      await page.keyboard.press('Enter');
      const chip = page.locator(`.nc-set-add-members .nc-set-chip[data-email="${memberEmail}"]`);
      await chip.waitFor();
      await page.waitForTimeout(600);
      const text = (await chip.textContent()).trim();
      await closeSettings();
      return text;
    };
    ok((await addMember()).includes('Max Member'), 'invite shows the invitee’s Litpage name (discoverable by default)');
    // the member turns Profile discoverability off in their Preferences
    await openSettings('preferences', memberPage);
    const sw = memberPage.locator('.nc-set-row[data-setting="discoverability"] input[role="switch"]');
    await sw.click();
    await memberPage.waitForTimeout(700);
    ok(!(await sw.isChecked()), 'member turned Profile discoverability off');
    await closeSettings(memberPage);
    const after = await addMember();
    ok(after.includes(memberEmail) && !after.includes('Max Member'), 'invite now shows only the email');
    await shot('14-discoverability');
  });
} catch (e) {
  ok(false, `unexpected: ${e.message}`);
} finally {
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  await memberCtx?.close().catch(() => {});
  await browser.close();
}

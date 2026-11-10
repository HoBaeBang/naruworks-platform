// Shell: Settings modal — every section renders (screenshots), nav search, and the settings that persist:
// preferences (theme / start week / open on start / date format) across reload, preferred name, workspace name,
// People (invite → role change → group), Emoji (upload → delete), feature level change (owner, no billing),
// Security toggle, Connections filters/search, MCP enable, PAT creation, AI instructions page,
// language switch (ko-KR ↔ en-US), log out of other devices.
// NC_BASE=http://127.0.0.1:5173 node e2e/shell-settings.mjs
import { mkdirSync } from 'node:fs';
import { BASE, launch, signup } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/settings';
mkdirSync(OUT, { recursive: true });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMElEQVR42mP8z8Dwn4EIwDiqgWHUAIZRAxhGDWAYNYBh1ACGUQMYRg1gGDWAYZQBAH0gH/Ec5D0PAAAAAElFTkSuQmCC', 'base64');

const { browser, page } = await launch();
page.setDefaultTimeout(30000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
let failed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) { failed++; process.exitCode = 1; } };
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: ${String(e.message ?? e).split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  }
}

const dialog = '.nc-set-dialog';
const opts = '.lit-overlay-container [role=option]';
const row = (id) => page.locator(`.nc-set-row[data-setting="${id}"]`).first();
async function openSettings() {
  if (await page.locator(dialog).count()) return;
  await page.keyboard.press('Meta+Comma');
  await page.waitForSelector(dialog);
}
async function tab(key) {
  await openSettings();
  await page.click(`.nc-set-tab[data-settings-key="${key}"]`);
  await page.waitForTimeout(250);
}
async function pick(dropdownRow, option) {
  await row(dropdownRow).locator('.nc-set-dropdown').click();
  await page.locator(opts, { hasText: option }).first().click();
  await page.waitForTimeout(250);
}
async function api(name, body = {}) {
  return page.evaluate(async ([n, b]) => (await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json(), [name, body]);
}

try {
  await signup(page, `settings${Date.now()}@test.dev`, 'Settings Tester', 'Settings Co');
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
  await page.waitForTimeout(800);

  await step('open + nav', async () => {
    await openSettings();
    await shot('00-account');
    const keys = await page.$$eval('.nc-set-tab', (els) => els.map((e) => e.getAttribute('data-settings-key')));
    ok(keys.includes('teamspaces') && keys.includes('security') && keys.includes('billing'), `owner sees admin sections (${keys.join(',')})`);
    ok((await page.locator('.nc-set-tab[data-settings-key="account"]').textContent()).includes('Settings Tester'), 'account tab shows user name');
    await page.fill('[aria-label="Search settings"]', 'theme');
    const filtered = await page.$$eval('.nc-set-tab', (els) => els.map((e) => e.getAttribute('data-settings-key')));
    ok(filtered.length === 1 && filtered[0] === 'preferences', `search "theme" → ${filtered.join(',')}`);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    ok(await page.locator('.nc-set-title', { hasText: 'Preferences' }).count() === 1, 'Enter opens first match');
    await page.fill('[aria-label="Search settings"]', '');
  });

  // every section renders
  const sections = ['account', 'preferences', 'notifications', 'mail-calendar', 'general', 'members', 'teamspaces', 'security', 'identity', 'import',
    'lit-ai', 'meeting-notes', 'connections', 'lit-mcp', 'verified-pages', 'public-pages', 'emoji', 'developers', 'requests', 'billing', 'plans'];
  for (const [i, key] of sections.entries()) {
    await step(`render ${key}`, async () => {
      await tab(key);
      const title = (await page.locator('.nc-set-title').first().textContent()) ?? '';
      ok(title.length > 0, `section ${key} → "${title}"`);
      await shot(`${String(i + 1).padStart(2, '0')}-${key}`);
    });
  }

  await step('preferences persist', async () => {
    await tab('preferences');
    await pick('theme', 'Dark');
    ok(await page.evaluate(() => document.documentElement.classList.contains('lit-dark-theme')), 'theme → dark');
    await shot('30-pref-dark');
    await row('week-start').locator('input[role=switch]').click(); // "Begin weeks on Monday"
    await pick('start-page', 'Library'); // "Open at startup"
    await pick('date-format', 'Year, month, day');
    await row('theme').locator('.nc-set-dropdown').click();
    await shot('31-theme-menu');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);
    await page.reload();
    await page.waitForSelector('nav.lit-sidebar-container');
    await tab('preferences');
    ok(await row('week-start').locator('input[role=switch]').isChecked(), 'begin weeks on Monday persisted');
    ok((await row('start-page').locator('.nc-set-dropdown').textContent()).includes('Library'), 'open at startup persisted');
    ok((await row('date-format').locator('.nc-set-dropdown').textContent()).includes('Year, month, day'), 'date format persisted');
    ok(await page.evaluate(() => document.documentElement.classList.contains('lit-dark-theme')), 'dark theme persisted');
    const r = await api('loadAccountData');
    const s = Object.values(r.recordMap.user_settings ?? {})[0]?.value?.value?.settings ?? {};
    ok(s.preferred_theme === 'dark' && s.start_day_of_week === 1 && s.start_page === 'library' && s.date_format === 'ymd', `user_settings saved (${JSON.stringify({ t: s.preferred_theme, w: s.start_day_of_week, p: s.start_page, d: s.date_format })})`);
    await pick('theme', 'Light');
  });

  await step('account name', async () => {
    await tab('account');
    const input = page.locator('#nc-set-pref-name');
    await input.fill('Renamed Tester');
    await input.press('Enter');
    await page.locator('.nc-set-title').first().click();
    await page.waitForTimeout(500);
    ok((await page.locator('.nc-set-tab[data-settings-key="account"]').textContent()).includes('Renamed Tester'), 'preferred name saved');
  });

  await step('general workspace name', async () => {
    await tab('general');
    const input = page.locator('.nc-set-row[data-setting="workspace-name"] input');
    await input.fill('Renamed Co');
    await input.press('Enter');
    await page.waitForTimeout(600);
    const r = await api('loadAccountData');
    const names = Object.values(r.recordMap.space ?? {}).map((x) => x.value.value.name);
    ok(names.includes('Renamed Co'), `workspace renamed (${names.join(',')})`);
  });

  await step('people invite + role + group', async () => {
    await tab('members');
    await page.click('.nc-set-people-actions .nc-set-btn.primary');
    await page.waitForSelector('.nc-set-add-members');
    await page.keyboard.type('teammate@test.dev,');
    await shot('40-add-members');
    await page.click('.nc-set-add-members .actions .nc-set-btn.primary');
    await page.waitForSelector('.nc-set-utable-row:has-text("teammate@test.dev")');
    ok(true, 'invited member listed');
    const r = page.locator('.nc-set-utable-row', { hasText: 'teammate@test.dev' });
    await r.locator('.c-role .nc-set-cell-btn').click();
    await shot('41-role-menu');
    await page.locator(opts, { hasText: 'Membership admin' }).first().click();
    await page.waitForTimeout(500);
    ok((await r.locator('.c-role').textContent()).includes('Membership admin'), 'role changed to Membership admin');
    await page.click('.nc-set-tab-pill:has-text("Groups")');
    await page.click('.nc-set-people-actions .nc-set-btn.primary');
    await page.keyboard.type('Design');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    await page.click('.nc-set-group-card-head:has-text("Design")');
    await page.click('.nc-set-group-card-body .nc-set-btn');
    await page.locator(opts, { hasText: 'teammate' }).first().click();
    await page.waitForTimeout(400);
    ok((await page.locator('.nc-set-group-card', { hasText: 'Design' }).textContent()).includes('1 user'), 'group created with member');
    await shot('42-groups');
    await page.click('.nc-set-tab-pill:has-text("Members")');
    ok((await page.locator('.nc-set-utable-row', { hasText: 'teammate@test.dev' }).locator('.c-col').nth(1).textContent()).includes('1 member group'), 'member row shows 1 member group');
  });

  await step('emoji upload + delete', async () => {
    await tab('emoji');
    await page.click('.nc-set-emoji-head .nc-set-btn');
    await page.setInputFiles('.nc-set-subdialog input[type=file]', { name: 'party.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForSelector('.nc-set-emoji-drop .preview img');
    await page.fill('.nc-set-subdialog .nc-set-input input:not([type=file])', 'party-time');
    await shot('50-emoji-dialog');
    await page.click('.nc-set-subdialog .actions .nc-set-btn.primary');
    await page.waitForSelector('.nc-set-etable tr[data-emoji="party-time"]');
    ok((await page.locator('.nc-set-emoji-count').textContent()).includes('1 uploaded emoji'), 'emoji added');
    await shot('51-emoji-list');
    await page.locator('.nc-set-etable tr[data-emoji="party-time"]').hover();
    await page.click('.nc-set-etable tr[data-emoji="party-time"] .row-more');
    await page.locator(opts, { hasText: 'Delete' }).first().click();
    await page.click('.nc-set-subdialog .actions .nc-set-btn.danger');
    await page.waitForTimeout(600);
    ok(await page.locator('.nc-set-etable tr[data-emoji="party-time"]').count() === 0, 'emoji deleted');
  });

  await step('security + plan change', async () => {
    await tab('security');
    await page.click('.nc-set-pill:has-text("Members & guests")');
    const sw = page.locator('.nc-set-row[data-setting="external-member-requests"] input[role=switch]');
    await sw.click();
    await page.waitForTimeout(400);
    ok(await sw.isChecked(), 'security toggle saved');
    ok(await page.locator('.nc-set-row[data-setting="allow-guests"] input[role=switch]').isDisabled(), 'enterprise toggle locked on Plus');
    await tab('plans');
    await page.click('.nc-set-plan-head .col[data-plan="enterprise"] .nc-set-btn');
    await page.click('.nc-set-subdialog .actions .nc-set-btn.primary');
    await page.waitForTimeout(700);
    ok((await page.locator('.nc-set-plan-head .col[data-plan="enterprise"]').textContent()).includes('Active'), 'plan upgraded to Enterprise');
    await shot('60-plans-enterprise');
    await tab('security');
    await page.click('.nc-set-pill:has-text("Members & guests")');
    // (Allow members to invite guests stays locked while non-member access requests are on)
    await page.click('.nc-set-pill:has-text("General")');
    ok(!(await page.locator('.nc-set-row[data-setting="disable-export"] input[role=switch]').isDisabled()), 'enterprise toggle unlocked');
    await tab('plans');
    await page.click('.nc-set-plan-head .col[data-plan="plus"] .nc-set-btn');
    await page.click('.nc-set-subdialog .actions .nc-set-btn');
    await page.waitForTimeout(700);
    ok((await page.locator('.nc-set-plan-head .col[data-plan="plus"]').textContent()).includes('Active'), 'plan back to Pro (plus)');
    // feature levels list their features inline (no billing, no separate compare table)
    ok(await page.locator('.nc-set-highlights .col').count() === 4, 'four feature levels listed with their features');
    await shot('61-feature-levels');
  });

  await step('connections filters', async () => {
    await tab('connections');
    await page.locator('.nc-set-conn-filter').first().click(); // "Filter categories: All categories"
    await shot('70-category-menu');
    const items = await page.$$eval(opts, (els) => els.map((e) => e.textContent));
    ok(['All categories', 'Communication', 'Projects and tasks'].every((c) => items.some((x) => x.includes(c))), `category menu lists the catalog categories (${items.length})`);
    await page.locator(opts, { hasText: 'Communication' }).first().click();
    await page.waitForTimeout(200);
    const cats = await page.$$eval('.nc-set-conn-cat .nc-set-cat-title', (els) => els.map((e) => e.textContent));
    ok(cats.length === 1 && cats[0] === 'Communication', `category filter → ${cats.join(',')}`);
    await page.locator('.nc-set-conn-filter').nth(1).click(); // "Filter connection types: All types"
    await shot('71-type-menu');
    await page.keyboard.press('Escape');
    await page.fill('[aria-label="Search connections"]', 'git');
    await page.waitForTimeout(200);
    const names = await page.$$eval('.nc-set-ccard .nm', (els) => els.map((e) => e.textContent));
    ok(names.includes('GitHub') && names.includes('GitLab'), `search "git" → ${names.join(',')}`);
    await shot('72-search');
  });

  await step('mcp + developer', async () => {
    await tab('lit-mcp');
    await page.click('.nc-set-mcp-card[aria-label="Enable Claude"]');
    await page.waitForTimeout(400);
    ok((await page.locator('.nc-set-group-title', { hasText: 'Enabled clients' }).textContent()).includes('(1)'), 'MCP client enabled');
    await shot('80-mcp-enabled');
    await tab('developers');
    await page.click('.nc-set-row[data-setting="new-token"] .nc-set-btn');
    await page.keyboard.type('CI token');
    await page.keyboard.press('Enter');
    const token = await page.inputValue('.nc-set-subdialog input[readonly]');
    ok(/^lp_(?:pat|int)_[A-Za-z0-9_-]{20,}/.test(token), 'token generated'); // server-issued token (real PATs)
    await page.keyboard.press('Escape');
    await page.click('.nc-set-row[data-setting="new-token"] .nc-set-row-desc a');
    ok((await page.locator('.nc-set-table').last().textContent()).includes('CI token'), 'token listed');
  });

  await step('devices', async () => {
    await tab('account');
    await page.click('.nc-set-row[data-setting="logout-all"] .nc-set-btn.danger'); // "Sign out everywhere"
    await page.click('.nc-set-subdialog .actions .nc-set-btn.danger');
    await page.waitForSelector('.nc-set-subdialog', { state: 'detached' });
    await page.waitForTimeout(500);
    const open = await page.locator(dialog).count();
    ok(open === 1, `logged out other sessions, still signed in here (settings dialogs open: ${open})`);
    if (open !== 1) await shot('85-devices-after');
  });

  await step('language ko-KR', async () => {
    await tab('preferences');
    await row('language').locator('.nc-set-dropdown').click();
    await page.locator(opts, { hasText: '한국어' }).first().click();
    await page.waitForLoadState('load');
    await page.waitForSelector('nav.lit-sidebar-container');
    await page.waitForTimeout(500);
    await openSettings();
    await page.click('.nc-set-tab[data-settings-key="preferences"]');
    await page.waitForTimeout(300);
    ok((await page.locator('.nc-set-title').first().textContent()) === '환경설정', 'Korean UI after language switch');
    await shot('90-ko-preferences');
    await page.click('.nc-set-tab[data-settings-key="members"]');
    await shot('91-ko-people');
    // back on Preferences before switching the language back (the row isn't on the People tab)
    await page.click('.nc-set-tab[data-settings-key="preferences"]');
    await row('language').locator('.nc-set-dropdown').waitFor({ timeout: 10000 });
    await row('language').locator('.nc-set-dropdown').click();
    await page.locator(opts, { hasText: 'English (US)' }).first().click();
    await page.waitForLoadState('load');
    await page.waitForSelector('nav.lit-sidebar-container');
    ok(await page.evaluate(() => document.documentElement.lang) === 'en', 'back to English');
  });

  await step('ai instructions', async () => {
    await tab('lit-ai');
    await page.click('.nc-set-btn:has-text("Add instructions")');
    await page.waitForTimeout(800);
    ok(await page.locator(dialog).count() === 0, 'settings closed and instructions page opened');
    await shot('95-ai-instructions-page');
  });

  ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
  console.log(failed ? `${failed} check(s) failed` : 'all settings checks passed', '→', OUT, BASE);
} finally {
  await browser.close();
}

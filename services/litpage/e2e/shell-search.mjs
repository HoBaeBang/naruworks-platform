// Shell: Quick Find (⌘K) — empty state groups, results + highlight, filters (Title only / Created by / In / + Filter),
// sort, search settings, keyboard navigation, ⌘↵, reopen keeps query, highlight pane, dark mode.
// Run: cd e2e && node shell-search.mjs
import { mkdirSync } from 'node:fs';
import { launch, BASE } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/search';
mkdirSync(OUT, { recursive: true });

/** Sign up through the API (independent of the login/onboarding UI, which other agents are changing). */
async function apiSignup(page, name = 'Test User', ws = 'Acme') {
  const email = `e2e${Date.now()}${Math.floor(Math.random() * 1000)}@test.dev`;
  await page.goto(BASE + '/login');
  await page.evaluate(async ([email, name, ws]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const { devCode } = await post('sendSignInCode', { email });
    const { userId } = await post('signInWithEmail', { email, code: devCode });
    await post('applyChanges', { requestId: crypto.randomUUID(), transactions: [{ id: crypto.randomUUID(), spaceId: '', operations: [{ pointer: { table: 'lit_user', id: userId }, path: [], command: 'update', args: { name, given_name: name, onboarding_completed: true } }] }] });
    await post('createWorkspace', { name: ws });
  }, [email, name, ws]);
  await page.goto(BASE + '/');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await page.waitForTimeout(800);
  return email;
}

const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
let failed = 0;

/** Wait (bounded) for a DOM condition: the busy shared dev server can answer the search API slowly. */
const settle = (fn, arg, timeout = 10000) => page.waitForFunction(fn, arg, { timeout }).catch(() => {});
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failed++; };

async function newPrivatePage(title, lines = []) {
  const before = page.url();
  await page.keyboard.press('Meta+n');
  await page.waitForFunction((u) => location.href !== u, before);
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(300);
  await page.keyboard.type(title);
  for (const l of lines) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(l);
  }
  await page.waitForTimeout(500);
}

try {
  await apiSignup(page);
  await newPrivatePage('Alpha Roadmap', ['# Milestones', 'Ship the quick find window', '- first bullet', '[] a todo']);
  await newPrivatePage('Beta Notes', ['Notes about the alpha release']);
  await newPrivatePage('Gamma Plan');
  await page.waitForTimeout(800);

  // open with ⌘K → recent pages grouped by time
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('[role=dialog][aria-label="Search Litpage"]');
  await settle(() => document.querySelector('.nc-qf-group-label'));
  await page.waitForTimeout(300);
  await shot('01-empty');
  const box = await page.locator('[role=dialog][aria-label="Search Litpage"]').boundingBox();
  ok(box && Math.round(box.width) === 1006 && Math.round(box.height) === 700, `window 1006×700 (got ${box && `${Math.round(box.width)}×${Math.round(box.height)}`})`);
  ok(box && Math.abs(box.y - 77) <= 2 && Math.abs(box.x - 189) <= 2, `window at [189,77] (got ${box && `${Math.round(box.x)},${Math.round(box.y)}`})`);
  const groups = await page.$$eval('.nc-qf-group-label', (els) => els.map((e) => e.textContent));
  ok(groups.includes('Today'), `empty state grouped (got ${groups.join(', ')})`);
  const placeholder = await page.getAttribute('.nc-qf-input', 'placeholder');
  ok(/^Ask anything or search .+…$/.test(placeholder ?? ''), `placeholder "${placeholder}"`);
  const dim = await page.evaluate(() => getComputedStyle(document.querySelector('.nc-qf-layer')).backgroundColor);
  ok(dim === 'rgba(0, 0, 0, 0)', `no dimmed backdrop (${dim})`);

  // keyboard navigation
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(200);
  const sel = await page.$$eval('[role=option][aria-selected=true]', (els) => els.length);
  ok(sel === 1, 'one active row after ArrowDown');
  await shot('02-arrow-down');

  // query
  await page.keyboard.type('alpha');
  await settle(() => /^Search results/.test(document.querySelector('.nc-qf-group-label')?.textContent ?? '') && document.querySelectorAll('.nc-qf-row.result').length >= 2);
  await page.waitForTimeout(300);
  await shot('03-query');
  const header = await page.textContent('.nc-qf-group-label');
  ok(/^Search results \(\d+\)$/.test(header ?? ''), `results header "${header}"`);
  const titles = await page.$$eval('.nc-qf-row.result .nc-qf-title', (els) => els.map((e) => e.textContent));
  ok(titles[0] === 'Alpha Roadmap', `title match ranked first (got ${titles.join(' | ')})`);
  ok(titles.includes('Beta Notes'), 'content match included');
  const bold = await page.$$eval('.nc-qf-row.result .nc-qf-title-match', (els) => els.map((e) => e.textContent));
  ok(bold.includes('Alpha'), 'matched part highlighted in title');

  // Title only
  await page.click('.nc-qf-chip:has-text("Title only")');
  await settle(() => document.querySelectorAll('.nc-qf-row.result').length === 1);
  const titlesOnly = await page.$$eval('.nc-qf-row.result .nc-qf-title', (els) => els.map((e) => e.textContent));
  ok(titlesOnly.length === 1 && titlesOnly[0] === 'Alpha Roadmap', `Title only filters content matches (got ${titlesOnly.join(' | ')})`);
  await shot('04-title-only');
  await page.click('.nc-qf-chip:has-text("Title only")');
  await settle(() => document.querySelectorAll('.nc-qf-row.result').length >= 2);

  // Created by
  await page.click('.nc-qf-chip:has-text("Created by")');
  await page.waitForTimeout(300);
  await shot('05-created-by');
  const you = await page.textContent('.nc-overlay .nc-menu-item');
  ok(/\(You\)/.test(you ?? ''), `first person is "(You)" (${you})`);
  await page.click('.nc-overlay .nc-menu-item');
  await page.waitForTimeout(700);
  await page.keyboard.press('Escape');
  const chip = await page.textContent('.nc-qf-chip.active');
  ok(/Created by: /.test(chip ?? ''), `Created by chip label (${chip})`);
  const afterCreated = await page.$$eval('.nc-qf-row.result', (els) => els.length);
  ok(afterCreated >= 1, 'results remain for own pages');

  // In
  await page.click('.nc-qf-chip:has-text("In")');
  await page.waitForTimeout(500);
  await shot('06-in');
  await page.keyboard.press('Escape');

  // + Filter
  await page.click('.nc-qf-add-filter');
  await page.waitForTimeout(300);
  await shot('07-add-filter');
  await page.click('.nc-overlay .nc-menu-item:has-text("Date")');
  await page.waitForTimeout(400);
  await shot('08-date-submenu');
  await page.click('.nc-overlay .nc-menu-item:has-text("Last 7 days")');
  await settle(() => [...document.querySelectorAll('.nc-qf-chip.active')].some((e) => /Last edited/.test(e.textContent ?? '')));
  await page.waitForTimeout(300);
  const dateChip = await page.textContent('.nc-qf-chip.active:has-text("Last edited")').catch(() => null);
  ok(!!dateChip, `date chip shown (${dateChip})`);

  // sort menu
  await page.click('.nc-qf-sort');
  await page.waitForTimeout(300);
  await shot('09-sort');
  await page.click('.nc-overlay .nc-menu-item:has-text("Created first")');
  await settle(() => document.querySelector('.nc-qf-row.result .nc-qf-title')?.textContent === 'Alpha Roadmap', undefined, 5000);
  await page.waitForTimeout(300);
  const sorted = await page.$$eval('.nc-qf-row.result .nc-qf-title', (els) => els.map((e) => e.textContent));
  ok(sorted[0] === 'Alpha Roadmap', `oldest created first (got ${sorted.join(' | ')})`);

  // search settings
  await page.click('[aria-label="Search settings"]');
  await page.waitForTimeout(300);
  await shot('10-settings');
  await page.keyboard.press('Escape');

  // highlight pane toggle
  await page.click('[aria-label="Hide highlights pane"]');
  await page.waitForTimeout(400);
  const narrow = await page.locator('[role=dialog][aria-label="Search Litpage"]').boundingBox();
  ok(narrow && Math.round(narrow.width) === 600, `pane hidden → 600px (got ${narrow && Math.round(narrow.width)})`);
  await page.click('[aria-label="Show highlights pane"]');
  await page.waitForTimeout(400);

  // Enter opens, Esc closes, reopen keeps the query
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok(!(await page.$('[role=dialog][aria-label="Search Litpage"]')), 'Esc closes');
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('[role=dialog][aria-label="Search Litpage"]');
  const kept = await page.inputValue('.nc-qf-input');
  ok(kept === 'alpha', `query kept on reopen ("${kept}")`);
  await settle(() => document.querySelector('.nc-qf-row.result.active'));
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await settle(() => /Alpha-Roadmap/.test(location.href), undefined, 5000);
  const url = page.url();
  ok(/Alpha-Roadmap/.test(url), `Enter opens the active result (${url})`);
  ok(!(await page.$('[role=dialog][aria-label="Search Litpage"]')), 'modal closed after open');

  // sidebar pill opens the same window; dark mode
  await page.click('nav .nc-sb-search');
  await page.waitForSelector('[role=dialog][aria-label="Search Litpage"]');
  await page.fill('.nc-qf-input', '');
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+l');
  await page.waitForTimeout(300);
  await page.keyboard.press('Meta+k');
  await page.waitForTimeout(800);
  await shot('11-dark');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+Shift+l');
} catch (e) {
  failed++;
  console.log('E2E FAILED', e.message.split('\n')[0]);
  await shot('error').catch(() => {});
} finally {
  await browser.close();
}
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exitCode = failed ? 1 : 0;

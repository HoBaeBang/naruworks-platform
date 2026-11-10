// Two sessions of the same account type into the same block at the same time (different positions).
// With spliceText both edits must survive in both windows and after reload (no last-writer-wins clobbering).
import { chromium } from 'playwright-core';
import { BASE, CHROME, signup, newPage } from './lib.mjs';

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, locale: 'en-US' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return page;
};
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) fails++; };

const a = await mk();
const email = await signup(a, `concurrent${Date.now()}@test.dev`, 'Ada', 'Acme');
await newPage(a);
await a.keyboard.type('Concurrent');
await a.keyboard.press('Enter');
await a.waitForTimeout(400);
await a.keyboard.type('Hello world');
await a.waitForTimeout(1500);
const url = a.url();

// second session of the same account
const b = await mk();
await b.goto(`${BASE}/login`);
await b.fill('#email', email);
await b.click('button[type=submit]');
await b.waitForSelector('#code');
await b.fill('#code', (await b.locator('.nc-auth-hint b').textContent()).trim());
await b.click('button[type=submit]');
await b.waitForSelector('nav.lit-sidebar-container', { state: 'attached', timeout: 15000 });
await b.goto(url);
await b.waitForSelector('.lit-page-content [data-content-editable-leaf]');
await b.waitForTimeout(1200);

const leaf = (p) => p.locator('.lit-page-content [data-content-editable-leaf]', { hasText: 'Hello' }).first();
const caretAt = async (p, offset) => {
  await leaf(p).click();
  await p.evaluate(({ offset }) => {
    const el = [...document.querySelectorAll('.lit-page-content [data-content-editable-leaf]')].find((e) => e.textContent.includes('Hello'));
    const t = el.firstChild;
    const r = document.createRange();
    r.setStart(t, offset);
    r.collapse(true);
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
  }, { offset });
};
await caretAt(a, 5); // after "Hello"
await caretAt(b, 11); // end
// type at the same time, interleaved keystrokes
await Promise.all([a.keyboard.type(' big', { delay: 90 }), b.keyboard.type('!!!', { delay: 110 })]);
await a.waitForTimeout(2500);
const ta = await leaf(a).textContent();
const tb = await leaf(b).textContent();
console.log('A:', JSON.stringify(ta), 'B:', JSON.stringify(tb));
check(ta === 'Hello big world!!!', 'window A shows both edits');
check(tb === 'Hello big world!!!', 'window B shows both edits');
// undo in A removes only A's own words (B's "!!!" stays), in both windows
await leaf(a).click();
await a.keyboard.press('Meta+Z');
await a.waitForTimeout(2000);
const undone = await leaf(a).textContent();
check(undone === 'Hello world!!!', `undo in A reverts only A's insertion (${JSON.stringify(undone)})`);
check((await leaf(b).textContent()) === 'Hello world!!!', 'B sees the undo');
await a.keyboard.press('Meta+Shift+Z');
await a.waitForTimeout(1500);
await a.reload();
await a.waitForSelector('.lit-page-content [data-content-editable-leaf]');
await a.waitForTimeout(1000);
const stored = await leaf(a).textContent();
check(stored === 'Hello big world!!!', `stored value after reload (${JSON.stringify(stored)})`);

await browser.close();
console.log(fails ? `${fails} check(s) failed` : 'all checks passed');
process.exit(fails ? 1 : 0);

// Shell: login / signup screens, email-code + password flows, onboarding (work use case with invite step),
// language picker, dark mode and 390px layout. Run: cd e2e && node shell-auth.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, CHROME, launch, newPage, signup } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/auth';
mkdirSync(OUT, { recursive: true });
let failures = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) failures++; };

const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(30000);
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png` });
try {
  // ---- login screen
  await page.goto(BASE + '/login');
  await page.waitForSelector('#email');
  await page.waitForTimeout(300);
  await shot('01-login');
  ok(await page.locator('h1', { hasText: 'Your intelligent workspace' }).count() === 1, 'login title');
  ok(await page.locator('h2', { hasText: 'Sign in to keep working in Litpage' }).count() === 1, 'login subtitle');
  ok(await page.locator('.nc-auth-provider').count() === 6, '6 provider buttons (Google/ChatGPT/Apple/Microsoft/Passkey/SSO)');
  const cont = await page.locator('button[type=submit]').boundingBox();
  ok(cont && Math.round(cont.width) === 360 && Math.round(cont.height) === 40, `Continue 360×40 (got ${JSON.stringify(cont)})`);
  const prov = await page.locator('.nc-auth-provider').first().boundingBox();
  ok(prov && Math.round(prov.height) === 72, `provider 72px tall (got ${prov?.height})`);

  // invalid email
  await page.fill('#email', 'not-an-email');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]');
  ok((await page.textContent('[role=alert]')).includes('isn’t valid'), 'invalid email error');
  await shot('02-login-error');

  // ---- signup screen
  await page.click('a[href="/signup"]');
  await page.waitForURL(/\/signup/);
  await page.waitForTimeout(300);
  await shot('03-signup');
  ok(await page.locator('h1', { hasText: 'Litpage: a workspace with AI built in.' }).count() === 1, 'signup title');
  ok(await page.locator('.nc-auth-provider').count() === 3, 'signup has 3 providers');
  ok(await page.locator('.nc-auth-tip').count() === 1, 'signup tip box');

  // ---- email code flow (new account) + onboarding with "For work"
  const email = `auth${Date.now()}@test.dev`;
  await page.fill('#email', email);
  await page.click('button[type=submit]');
  await page.waitForSelector('#code');
  await page.waitForTimeout(200);
  await shot('04-code-step');
  await page.fill('#code', '000000');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]');
  ok((await page.textContent('[role=alert]')).includes('login code is incorrect'), 'wrong code error');
  const code = (await page.locator('.nc-auth-hint b').textContent()).trim();
  await page.fill('#code', code);
  await page.click('button[type=submit]');
  await page.waitForSelector('#name');
  await page.waitForTimeout(200);
  await shot('05-onboarding-profile');
  await page.fill('#name', 'Ada Auth');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=radiogroup]');
  await page.click('[role=radio]:has-text("For work")');
  await shot('06-onboarding-use-case');
  await page.click('text=Continue');
  await page.waitForSelector('#ws');
  await shot('07-onboarding-workspace');
  await page.fill('#ws', 'Auth Labs');
  await page.click('button[type=submit]');
  await page.waitForSelector('text=Who else works with you?');
  await shot('08-onboarding-invite');
  await page.click('text=Do this later');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
  ok(true, 'onboarding (work) reached the workspace');

  // set a password, log out, log back in with password
  const setPw = await page.evaluate(async () => (await fetch('/api/rpc/changePassword', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse 1' }) })).status);
  ok(setPw === 200, 'password set');
  await page.evaluate(async () => { await fetch('/api/rpc/signOut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
  await page.goto(BASE + '/login');
  await page.fill('#email', email);
  await page.click('button[type=submit]');
  await page.waitForSelector('#password');
  await shot('09-password-step');
  await page.fill('#password', 'wrong password');
  await page.click('button[type=submit]');
  await page.waitForSelector('[role=alert]');
  ok((await page.textContent('[role=alert]')).includes('Incorrect password'), 'incorrect password error');
  await page.fill('#password', 'correct horse 1');
  await page.click('button[type=submit]');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
  ok(true, 'password login works');

  // a page link opened while signed out lands on that page after logging in, not on the last visited page (QA);
  // the tab title follows the page title (QA)
  await newPage(page);
  await page.keyboard.type('Come back here');
  await page.waitForTimeout(800);
  const linkUrl = page.url();
  ok(/Come back here \| Litpage$/.test(await page.title()), `tab title follows the page title (got ${await page.title()})`);
  await page.locator('nav.lit-sidebar-container [role=treeitem]', { hasText: 'Welcome to Litpage' }).first().click();
  await page.waitForURL((u) => u.href !== linkUrl);
  await page.waitForTimeout(800);
  await page.evaluate(async () => { await fetch('/api/rpc/signOut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
  await page.goto(linkUrl);
  await page.waitForURL(/\/login/);
  await page.fill('#email', email);
  await page.click('button[type=submit]');
  await page.waitForSelector('#password');
  await page.fill('#password', 'correct horse 1');
  await page.click('button[type=submit]');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(500);
  const landed = await page.locator('h1[data-content-editable-leaf]').first().innerText();
  ok(page.url() === linkUrl && landed === 'Come back here', `signed-out page link returns there after login (got ${page.url()} "${landed}")`);
} catch (e) {
  console.log('E2E FAILED', e.message);
  failures++;
  await shot('error');
} finally {
  await browser.close();
}

// ---- language, dark mode and phone layout on fresh contexts
const b2 = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  const ctx = await b2.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  await p.goto(BASE + '/login');
  await p.waitForSelector('#email');
  await p.click('[aria-label^="Language:"]');
  await p.waitForTimeout(300);
  await shot('10-language-menu', p);
  await Promise.all([p.waitForEvent('load'), p.click('.lit-overlay-container [role=option]:has-text("한국어")')]);
  await p.waitForSelector('#email');
  await p.waitForTimeout(300);
  await shot('11-login-ko', p);
  ok(await p.locator('h1', { hasText: '나만의 AI 워크스페이스' }).count() === 1, 'Korean login title');
  await p.evaluate(() => { localStorage.setItem('nc:locale', 'en-US'); localStorage.setItem('nc:theme', 'dark'); });
  await p.reload();
  await p.waitForSelector('#email');
  await p.waitForTimeout(300);
  await shot('12-login-dark', p);
  ok(await p.evaluate(() => document.documentElement.classList.contains('lit-dark-theme')), 'dark theme applied on login');
  await p.evaluate(() => localStorage.removeItem('nc:theme'));
  await ctx.close();

  const mob = await b2.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'en-US' });
  const m = await mob.newPage();
  await m.goto(BASE + '/login');
  await m.waitForSelector('#email');
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${OUT}/13-login-390.png`, fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  ok(!overflow, 'no horizontal overflow at 390px');
  await m.goto(BASE + '/signup');
  await m.waitForSelector('#email');
  await m.waitForTimeout(300);
  await m.screenshot({ path: `${OUT}/14-signup-390.png`, fullPage: true });
  await mob.close();
} catch (e) {
  console.log('E2E FAILED (locale/theme/mobile)', e.message);
  failures++;
} finally {
  await b2.close();
}

// default e2e signup helper still works
const s = await launch();
try {
  await signup(s.page);
  ok(true, 'lib.mjs signup() still works');
} catch (e) {
  console.log('E2E FAILED (signup helper)', e.message);
  failures++;
} finally {
  await s.browser.close();
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exitCode = failures ? 1 : 0;

// Settings › Account › Passkeys, with Chrome's virtual WebAuthn authenticator (DevTools protocol on this
// script's own headless Chrome): Add passkey → listed in Manage Passkeys (rename) → log out → login page "Passkey"
// signs in without an email → delete the passkey → it no longer signs in. WebAuthn needs a domain, so the service is
// opened on localhost (on 127.0.0.1 the server explains that passkeys need a domain name).
// NC_BASE=http://127.0.0.1:5451 node e2e/settings-passkeys.mjs (the script switches the host to localhost)
import { mkdirSync } from 'node:fs';
import { BASE as BASE_IP, launch } from './lib.mjs';
import { apiLogin, call, uniq } from './ws-lib.mjs';

const BASE = BASE_IP.replace('127.0.0.1', 'localhost');
const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-settings/passkeys';
mkdirSync(OUT, { recursive: true });

const { browser, context, page } = await launch();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let failed = 0;
let passed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (cond) passed++; else { failed++; process.exitCode = 1; } };
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: ${String(e.message ?? e).split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => {});
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});
  }
}
const dialog = '.nc-set-dialog';
const sub = '.nc-set-subdialog';
const menu = '.lit-overlay-container';
const row = (id) => page.locator(`.nc-set-row[data-setting="${id}"]`);
async function openAccount() {
  if (!(await page.locator(dialog).count())) {
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector(dialog);
  }
  await page.click('.nc-set-tab[data-settings-key="account"]');
  await page.waitForTimeout(500);
}

try {
  // virtual platform authenticator (resident keys + user verification), presence simulated
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  ok(!!authenticatorId, 'virtual authenticator attached');

  const u = uniq();
  // log in on localhost (cookies are per host)
  const prev = process.env.NC_BASE;
  await page.goto(BASE + '/login');
  const email = `passkey${u}@test.dev`;
  const res = await page.evaluate(async ([email]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const { devCode } = await post('sendSignInCode', { email });
    const { userId } = await post('signInWithEmail', { email, code: devCode });
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: '', operations: [{ pointer: { table: 'lit_user', id: userId }, path: [], command: 'update', args: { name: 'Pat Passkey', given_name: 'Pat', onboarding_completed: true } }] }] });
    const { spaceId } = await post('createWorkspace', { name: 'Passkey Co' });
    return { userId, spaceId };
  }, [email]);
  void prev;
  ok(!!res.userId && !!res.spaceId, 'signed up on localhost');
  await page.goto(BASE + '/');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });

  await step('add passkey', async () => {
    await openAccount();
    ok(await page.locator('.nc-set-callout', { hasText: 'adding a passkey' }).count() === 1, 'callout offers a passkey');
    await row('passkeys').locator('.nc-set-btn', { hasText: 'Add passkey' }).click();
    await row('passkeys').locator('.nc-set-btn', { hasText: 'Manage passkeys' }).waitFor();
    ok(true, 'passkey registered → Manage passkeys');
    ok(await page.locator('.nc-set-callout', { hasText: 'adding a passkey' }).count() === 0, 'callout hidden once a passkey exists');
    const { credentials } = await cdp.send('WebAuthn.getCredentials', { authenticatorId });
    ok(credentials.length === 1 && credentials[0].isResidentCredential && credentials[0].rpId === 'localhost', 'a discoverable credential for localhost is on the authenticator');
    await row('passkeys').locator('.nc-set-btn', { hasText: 'Manage passkeys' }).click();
    await page.waitForSelector('[data-testid="manage-passkeys"]');
    const item = page.locator('.nc-set-passkey').first();
    ok(/Chrome on macOS|Chrome/.test(await item.locator('.name').textContent()), 'named after the device (Chrome on macOS)');
    await item.locator('.nc-set-icon-btn').click();
    await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: 'Rename passkey' }).first().click();
    const input = item.locator('input');
    await input.fill('Work laptop');
    await input.press('Enter');
    await page.locator('.nc-set-passkey .name', { hasText: 'Work laptop' }).waitFor();
    ok(true, 'renamed');
    await shot('01-manage-passkeys');
    await page.keyboard.press('Escape');
  });

  await step('log in with the passkey', async () => {
    await page.evaluate(() => fetch('/api/rpc/signOut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    await context.clearCookies();
    await page.goto(BASE + '/login');
    await page.waitForSelector('.nc-auth-provider');
    await shot('02-login');
    await page.locator('.nc-auth-provider', { hasText: 'Passkey' }).click();
    await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
    ok(true, 'Passkey button signs in without an email');
    const uc = await call(page, 'loadAccountData', {});
    ok(Object.keys(uc.recordMap?.user_root ?? {})[0] === res.userId, 'signed in as the passkey’s account');
  });

  await step('delete passkey', async () => {
    await openAccount();
    await row('passkeys').locator('.nc-set-btn', { hasText: 'Manage passkeys' }).click();
    await page.waitForSelector('[data-testid="manage-passkeys"]');
    await page.locator('.nc-set-passkey').first().locator('.nc-set-icon-btn').click();
    await page.locator(`${menu} [role="option"], ${menu} [role="menuitem"]`, { hasText: 'Delete' }).first().click();
    const confirm = page.locator(sub, { hasText: 'Remove this passkey' });
    await confirm.waitFor();
    ok((await confirm.textContent()).includes('Work laptop'), 'confirmation names the passkey');
    await confirm.locator('.nc-set-btn.danger').click();
    await page.locator('.nc-set-passkey').first().waitFor({ state: 'detached' });
    ok(true, 'passkey deleted');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.evaluate(() => fetch('/api/rpc/signOut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
    await context.clearCookies();
    await page.goto(BASE + '/login');
    await page.waitForSelector('.nc-auth-provider');
    await page.locator('.nc-auth-provider', { hasText: 'Passkey' }).click();
    const toast = page.locator('.nc-toast, [role="status"], .lit-toast', { hasText: /isn’t registered|didn’t work|sign-in failed/ }).first();
    await toast.waitFor({ timeout: 10000 });
    ok(true, `a deleted passkey no longer signs in (“${(await toast.textContent()).trim().slice(0, 60)}”)`);
    ok(await page.locator('nav.lit-sidebar-container').count() === 0, 'still on the login page');
  });

  await step('IP address origin', async () => {
    await page.goto(BASE_IP + '/login');
    await page.waitForSelector('.nc-auth-provider');
    await page.locator('.nc-auth-provider', { hasText: 'Passkey' }).click();
    const toast = page.locator('.nc-toast, [role="status"], .lit-toast', { hasText: 'domain name' }).first();
    await toast.waitFor({ timeout: 10000 });
    ok(true, 'on 127.0.0.1 the user learns passkeys need a domain name');
  });
} catch (e) {
  ok(false, `unexpected: ${e.message}`);
} finally {
  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  await browser.close();
}

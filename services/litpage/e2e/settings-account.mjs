// Settings › Account security: password rules → 2-factor authentication setup (QR code decodes to the
// otpauth URI, authenticator code, 6 backup codes) → login asks for the code (wrong code refused, backup code works
// once, "Remaining backup codes") → manage methods (regenerate needs a code) → Manage emails (add with verification
// code, log in with the secondary address, make primary, remove) → Remove password (turns 2FA off) → Delete my account
// (type email, workspace list, account gone, email can sign up again).
// NC_BASE=http://127.0.0.1:5451 node e2e/settings-account.mjs
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { BASE, launch, signup } from './lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-settings/account';
mkdirSync(OUT, { recursive: true });

const { browser, context, page } = await launch();
page.setDefaultTimeout(15000);
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

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits)
function b32(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const ch of s.replace(/[\s=]/g, '').toUpperCase()) {
    value = (value << 5) | A.indexOf(ch);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret, offsetSteps = 0) {
  const step = Math.floor(Date.now() / 30000) + offsetSteps;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', b32(secret)).update(msg).digest();
  const o = mac[mac.length - 1] & 15;
  const bin = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(bin % 1e6).padStart(6, '0');
}
/** Wait for a fresh 30-second step so a code isn't rejected as already used (replay protection). */
async function nextStep() {
  const left = 30000 - (Date.now() % 30000);
  await page.waitForTimeout(left + 300);
}

const dialog = '.nc-set-dialog';
const sub = '.nc-set-subdialog';
const row = (id) => page.locator(`.nc-set-row[data-setting="${id}"]`);
async function openSettings(key = 'account') {
  if (!(await page.locator(dialog).count())) {
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector(dialog);
  }
  await page.click(`.nc-set-tab[data-settings-key="${key}"]`);
  await page.waitForTimeout(300);
}
async function closeSettings() {
  while (await page.locator(sub).count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(100); }
  if (await page.locator(dialog).count()) await page.locator('.nc-set-close').click();
}
async function logout() {
  await page.evaluate(() => fetch('/api/rpc/signOut', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  await context.clearCookies();
}
async function loginPassword(email, password) {
  await page.goto(BASE + '/login');
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
  for (let i = 0; i < 3; i++) {
    await page.fill('#email', email);
    if ((await page.inputValue('#email')) === email) break;
    await page.waitForTimeout(300);
  }
  await page.click('button[type=submit]');
  await page.waitForSelector('#password');
  await page.fill('#password', password);
  await page.click('button[type=submit]');
}

const email = `acct${Date.now()}@test.dev`;
const PW = 'Correct1horse';
let secret = '';
let backup = [];
try {
  await signup(page, email, 'Account Tester', 'Account Co');
  await page.waitForTimeout(600);

  await step('password rules + set password', async () => {
    await openSettings();
    await row('password').locator('.nc-set-btn', { hasText: 'Add password' }).click();
    await page.fill(`${sub} input[type=password] >> nth=0`, 'abcdefgh');
    await page.fill(`${sub} input[type=password] >> nth=1`, 'abcdefgh');
    await page.click(`${sub} button[type=submit]`);
    ok((await page.locator(`${sub} .error`).textContent()).includes('letters and numbers'), 'password rule: 8–14 chars need letters and numbers');
    await page.fill(`${sub} input[type=password] >> nth=0`, PW);
    await page.fill(`${sub} input[type=password] >> nth=1`, PW);
    await page.click(`${sub} button[type=submit]`);
    await page.waitForSelector(sub, { state: 'detached' });
    await row('password').locator('.nc-set-btn', { hasText: 'Change password' }).waitFor({ timeout: 5000 }).catch(() => {});
    ok(await row('password').locator('.nc-set-btn', { hasText: 'Change password' }).count() === 1, 'password set → Change password');
    ok(await row('password').locator('.nc-set-btn', { hasText: 'Remove password' }).count() === 1, 'Remove password offered');
  });

  await step('2FA setup with QR code', async () => {
    await row('two-step').locator('.nc-set-btn', { hasText: 'Add a verification option' }).click();
    await page.waitForSelector(`${sub} [data-method="totp"]`);
    await shot('01-2fa-methods');
    ok(await page.locator(`${sub} .nc-set-method[aria-disabled="true"]`, { hasText: 'Text a code to me' }).count() === 1, 'SMS method shown but unavailable');
    await page.click(`${sub} [data-method="totp"]`);
    await page.waitForSelector(`${sub} .nc-set-qr svg`);
    const uri = await page.getAttribute(`${sub} .nc-set-qr svg`, 'data-otpauth');
    secret = /secret=([A-Z2-7]+)/.exec(uri)[1];
    ok(uri.startsWith('otpauth://totp/Litpage%3A') && secret.length === 32, 'otpauth URI with 160-bit secret');
    await shot('02-2fa-qr');
    // the drawn QR code must decode to the same URI (Chrome's built-in BarcodeDetector)
    const decoded = await page.evaluate(async () => {
      if (!('BarcodeDetector' in window)) return null;
      const svg = document.querySelector('.nc-set-qr svg');
      const xml = new XMLSerializer().serializeToString(svg);
      const img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml.replace('<svg', '<svg width="400" height="400"'));
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 440; c.height = 440;
      const g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, 440, 440); g.drawImage(img, 20, 20, 400, 400);
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const res = await det.detect(c);
      return res[0]?.rawValue ?? '';
    });
    if (decoded === null) console.log('SKIP QR decode: BarcodeDetector unavailable in this Chrome');
    else ok(decoded === uri, `QR code decodes to the otpauth URI${decoded === uri ? '' : ` (got "${decoded.slice(0, 60)}")`}`);
    await page.click(`${sub} a:has-text("Can’t scan the code?")`);
    ok((await page.locator(`${sub} [data-testid="totp-secret"]`).textContent()).replace(/\s/g, '') === secret, 'Can’t scan the code? shows the secret');
    await page.fill(`${sub} input[placeholder="Duo or Authy"]`, 'Phone');
    await page.fill(`${sub} input[autocomplete="one-time-code"]`, '000000');
    await page.click(`${sub} .nc-set-btn:has-text("Continue")`);
    await page.waitForSelector(`${sub} .error`);
    ok((await page.locator(`${sub} .error`).textContent()).includes('not accepted'), 'wrong code rejected');
    await page.fill(`${sub} input[autocomplete="one-time-code"]`, totp(secret));
    await page.click(`${sub} .nc-set-btn:has-text("Continue")`);
    await page.waitForSelector(`${sub} [data-testid="backup-codes"]`);
    backup = await page.$$eval(`${sub} [data-testid="backup-codes"] span`, (els) => els.map((e) => e.textContent.trim()));
    ok(backup.length === 6 && backup.every((c) => /^[a-z0-9]{4}-[a-z0-9]{4}$/.test(c)), 'six backup codes shown once');
    await shot('03-2fa-backup-codes');
    await page.click(`${sub} .nc-set-btn:has-text("I saved my codes")`);
    await page.waitForSelector(`${sub} h3:has-text("verification is on")`);
    await page.click(`${sub} .nc-set-btn:has-text("Close")`);
    await page.waitForTimeout(400);
    ok((await row('two-step').textContent()).includes('Two-step verification is on'), 'row shows 2FA enabled');
  });

  await step('login asks for a code', async () => {
    await closeSettings();
    await logout();
    await nextStep(); // the setup code's step can't be reused
    await loginPassword(email, PW);
    await page.waitForSelector('#mfa-code');
    ok((await page.locator('.nc-auth-login').textContent()).includes('Phone'), 'verify step names the authenticator');
    await shot('04-login-mfa');
    await page.fill('#mfa-code', '123456');
    await page.click('button[type=submit]');
    await page.waitForSelector('.nc-auth-error');
    ok((await page.locator('.nc-auth-error').textContent()).includes('not accepted'), 'wrong 2FA code refused');
    const noSession = await page.evaluate(async () => (await fetch('/api/rpc/loadAccountData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
    ok(noSession === 401, 'no session before the second factor');
    await page.fill('#mfa-code', totp(secret));
    await page.click('button[type=submit]');
    await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
    ok(true, 'authenticator code logs in');
  });

  await step('backup code login (single use) + remaining codes', async () => {
    await logout();
    await loginPassword(email, PW);
    await page.waitForSelector('#mfa-code');
    await page.click('.nc-auth-textbtn:has-text("Enter a single-use backup code")');
    await page.fill('#mfa-code', backup[0]);
    await page.click('button[type=submit]');
    await page.waitForSelector('.nc-auth-backup-left');
    ok((await page.locator('.nc-auth-backup-left').textContent()).includes('Backup codes remaining: 5.'), 'remaining backup codes shown');
    await page.click('.nc-auth-textbtn:has-text("Do this later")');
    await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
    await logout();
    await loginPassword(email, PW);
    await page.waitForSelector('#mfa-code');
    await page.click('.nc-auth-textbtn:has-text("Enter a single-use backup code")');
    await page.fill('#mfa-code', backup[0]);
    await page.click('button[type=submit]');
    await page.waitForSelector('.nc-auth-error');
    ok(true, 'a used backup code is refused');
    await nextStep();
    await page.click('.nc-auth-textbtn:has-text("Use an authenticator code")');
    await page.fill('#mfa-code', totp(secret));
    await page.click('button[type=submit]');
    await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
  });

  await step('manage methods: regenerate needs a code', async () => {
    await page.waitForTimeout(500);
    await openSettings();
    await row('two-step').locator('.nc-set-btn', { hasText: 'Manage verification options' }).click();
    await page.waitForSelector(`${sub} .nc-set-mfa-row[data-factor="Phone"]`);
    await shot('05-2fa-manage');
    await page.click(`${sub} .nc-set-btn:has-text("Create new backup codes")`);
    await page.click(`${sub} .nc-set-btn:has-text("Create fresh backup codes")`);
    await page.fill(`${sub} input[autocomplete="one-time-code"]`, '000000');
    await page.click(`${sub} .nc-set-btn:has-text("Continue")`);
    await page.waitForSelector(`${sub} .error`);
    ok(true, 'regenerating with a wrong code fails');
    await page.click(`${sub} .nc-set-btn:has-text("Switch to backup codes")`);
    await page.fill(`${sub} input[autocomplete="one-time-code"]`, backup[1]);
    await page.click(`${sub} .nc-set-btn:has-text("Continue")`);
    await page.waitForSelector(`${sub} [data-testid="backup-codes"]`);
    const fresh = await page.$$eval(`${sub} [data-testid="backup-codes"] span`, (els) => els.map((e) => e.textContent.trim()));
    ok(fresh.length === 6 && !fresh.includes(backup[2]), 'new set of backup codes');
    backup = fresh;
    await page.click(`${sub} .nc-set-btn:has-text("I saved my codes")`);
    await page.keyboard.press('Escape');
  });

  const alias = `alias${Date.now()}@test.dev`;
  await step('manage emails: add + verify + log in with it', async () => {
    await openSettings();
    await row('emails').locator('.nc-set-btn', { hasText: 'Manage emails' }).click();
    await page.click(`${sub} .nc-set-btn:has-text("Add an email address")`);
    await page.fill(`${sub} input[type=email]`, email);
    await page.click(`${sub} .nc-set-btn:has-text("Add email")`);
    await page.waitForSelector(`${sub} .error`);
    ok((await page.locator(`${sub} .error`).textContent()).includes('already'), 'own primary address refused');
    await page.fill(`${sub} input[type=email]`, alias);
    await page.click(`${sub} .nc-set-btn:has-text("Add email")`);
    await page.waitForSelector(`${sub} h3:has-text("Confirm your email address")`);
    const code = (await page.locator(`${sub} .nc-auth-hint b`).textContent()).trim();
    await page.fill(`${sub} input[autocomplete="one-time-code"]`, code);
    await page.click(`${sub} .nc-set-btn:has-text("OK")`);
    await page.waitForSelector(`${sub} .nc-set-email-row[data-email="${alias}"]`);
    ok(true, 'secondary email verified and listed');
    await shot('06-manage-emails');
    await page.keyboard.press('Escape');
    await closeSettings();
    await logout();
    await loginPassword(alias, PW);
    await page.waitForSelector('#mfa-code');
    await page.fill('#mfa-code', backup[0]);
    await page.click('button[type=submit]');
    await page.waitForSelector('.nc-auth-backup-left');
    await page.click('.nc-auth-textbtn:has-text("Do this later")');
    await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
    const me = await page.evaluate(async () => (await (await fetch('/api/rpc/getAccountSecurity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).emails);
    ok(me.some((e) => e.email === email && e.primary) && me.some((e) => e.email === alias), 'secondary email logs in to the same account');
  });

  await step('remove password turns 2FA off', async () => {
    await page.waitForTimeout(400);
    await openSettings();
    await row('password').locator('.nc-set-btn', { hasText: 'Remove password' }).click();
    ok((await page.locator(sub).textContent()).includes('Continuing will also disable two-step verification'), '2FA removal warning');
    await page.fill(`${sub} input[type=password]`, PW);
    await page.click(`${sub} .nc-set-btn:has-text("Continue")`);
    await page.waitForSelector(`${sub} h3:has-text("Password removed")`);
    await page.click(`${sub} .nc-set-btn:has-text("OK")`);
    await page.waitForTimeout(400);
    ok(await row('password').locator('.nc-set-btn', { hasText: 'Add password' }).count() === 1, 'password removed');
    ok((await row('two-step').textContent()).includes('Protect your account with an extra security step'), '2FA off');
  });

  await step('delete my account', async () => {
    await row('delete-account').locator('.nc-set-btn').click();
    await page.waitForSelector(`${sub} [data-testid="delete-workspaces"]`);
    ok((await page.locator(`${sub} [data-testid="delete-workspaces"]`).textContent()).includes('Account Co'), 'workspace that will be deleted is listed');
    const btn = page.locator(`${sub} .nc-set-btn.danger`);
    ok((await btn.textContent()).includes('Permanently erase your account plus 1 workspace'), 'button names the workspace count');
    ok((await btn.getAttribute('aria-disabled')) === 'true', 'disabled until the email is typed');
    await shot('07-delete-account');
    await page.fill(`${sub} input`, email);
    await btn.click();
    await page.waitForURL(/\/login/, { timeout: 15000 });
    const gone = await page.evaluate(async () => (await fetch('/api/rpc/loadAccountData', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status);
    ok(gone === 401, 'session ended');
    // the address can sign up again as a new account
    await page.fill('#email', email);
    await page.click('button[type=submit]');
    await page.waitForSelector('#code');
    const code = (await page.locator('.nc-auth-hint b').textContent()).trim();
    await page.fill('#code', code);
    await page.click('button[type=submit]');
    await page.waitForSelector('#name', { timeout: 15000 });
    ok(true, 'email signs up again as a new account (onboarding)');
  });

  ok(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
console.log(failed ? `${failed} failed` : 'all passed');

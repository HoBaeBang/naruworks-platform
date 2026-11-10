// Shared helpers for E2E scripts: launch system Chrome headless at a 1384x853 desktop viewport.
import { chromium } from 'playwright-core';
export const BASE = process.env.NC_BASE ?? 'http://127.0.0.1:5173';
export const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export async function launch({ headless = true } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless });
  const context = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300)); });
  return { browser, context, page };
}
export async function signup(page, email = `e2e${Date.now()}@test.dev`, name = 'Test User', ws = 'Acme') {
  await page.goto(BASE + '/');
  await page.waitForURL(/\/login/);
  await page.fill('#email', email);
  await page.click('button[type=submit]');
  await page.waitForSelector('#code');
  const code = await page.locator('.nc-auth-hint b').textContent();
  await page.fill('#code', code.trim());
  await page.click('button[type=submit]');
  await page.waitForSelector('#name');
  await page.fill('#name', name);
  await page.click('button[type=submit]');
  await page.click('text=Continue');
  await page.waitForSelector('#ws');
  await page.fill('#ws', ws);
  await page.click('button[type=submit]');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
  return email;
}
/** Create a private page through the sidebar compose button ("New…" menu → Page) and wait for its title editor. */
export async function newPage(page) {
  await page.click('nav [aria-label="New page"]');
  const item = page.locator('.lit-overlay-container [role="option"]', { hasText: /^Page$/ }).first();
  if (await item.count()) await item.click();
  else await page.keyboard.press('Meta+N');
  await page.waitForSelector('h1[data-content-editable-leaf]');
}
/**
 * Click a hover-revealed action button (e.g. a sidebar section header's "Add a page"). Re-hovers until the button is
 * visible, because async sidebar sections (Recents, Shared) can shift the layout between the hover and the click.
 */
export async function hoverClick(page, host, label, { tries = 5 } = {}) {
  const hostLoc = typeof host === 'string' ? page.locator(host).first() : host;
  const btn = hostLoc.locator(`[aria-label="${label}"]`).first();
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      await hostLoc.hover({ timeout: 3000 });
      await btn.waitFor({ state: 'visible', timeout: 1000 });
      await btn.click({ timeout: 1500 });
      return;
    } catch (e) {
      last = e;
      await page.waitForTimeout(250);
    }
  }
  throw last;
}

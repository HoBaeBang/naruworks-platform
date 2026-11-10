// Helpers shared by the page-level E2E scripts (page-ui, page-comments, page-share, page-realtime).
import { mkdirSync } from 'node:fs';
import { BASE, newPage } from './lib.mjs';

export const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-page';
mkdirSync(OUT, { recursive: true });

export function reporter() {
  const results = [];
  const check = (name, ok, detail = '') => {
    results.push({ name, ok: !!ok, detail });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const finish = () => {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed`);
    process.exitCode = failed.length ? 1 : 0;
  };
  return { results, check, finish };
}

export const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}.png` });

/** Sign up (or log in) with the code shown on the auth page; tolerant of the invited-user onboarding. */
export async function signupAny(page, email, name = 'Test User', ws = 'Acme') {
  await page.goto(BASE + '/');
  await page.waitForURL(/\/login/, { timeout: 20000 });
  await page.fill('#email', email);
  await page.click('button[type=submit]');
  await page.waitForSelector('#code');
  const code = await page.locator('.nc-auth-hint b').textContent();
  await page.fill('#code', code.trim());
  await page.click('button[type=submit]');
  const done = new Set();
  for (let i = 0; i < 60; i++) {
    if (await page.isVisible('nav.lit-sidebar-container').catch(() => false)) return email;
    try {
      if (!done.has('name') && await page.isVisible('#name')) {
        done.add('name');
        await page.fill('#name', name);
        await page.click('button[type=submit]', { timeout: 5000 });
      } else if (!done.has('ws') && await page.isVisible('#ws')) {
        done.add('ws');
        await page.fill('#ws', ws);
        await page.click('button[type=submit]', { timeout: 5000 });
      } else if (await page.locator('button:has-text("Continue"):not([disabled])').first().isVisible()) {
        await page.locator('button:has-text("Continue"):not([disabled])').first().click({ timeout: 5000 });
      }
    } catch {
      /* the step changed under us — re-evaluate */
    }
    await page.waitForTimeout(400);
  }
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 15000 });
  return email;
}

/** New private page with a title and paragraphs (markdown shortcuts allowed). Returns its URL. */
export async function createPage(page, title, lines = []) {
  await newPage(page);
  await page.keyboard.type(title);
  for (const line of lines) {
    await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
  await page.waitForTimeout(900); // let the transactions flush
  return page.url();
}

/** Select [start, start+len) of the first text leaf containing `text` (DOM selection → editor selection). */
export async function selectText(page, text) {
  await page.evaluate((needle) => {
    const leaves = [...document.querySelectorAll('.lit-page-content [data-content-editable-leaf]')];
    for (const leaf of leaves) {
      const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const i = n.nodeValue.indexOf(needle);
        if (i >= 0) {
          leaf.focus();
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          document.dispatchEvent(new Event('selectionchange'));
          return true;
        }
      }
    }
    return false;
  }, text);
  await page.waitForTimeout(250);
}

/** Share menu → invite emails with the default role. */
export async function invite(page, email) {
  await page.click('.lit-topbar-share-menu');
  await page.waitForSelector('.nc-share-menu .nc-share-people');
  await page.fill('.nc-share-invite-input input', email);
  await page.click('.nc-share-invite-btn');
  await page.waitForFunction((em) => [...document.querySelectorAll('.nc-share-row.person .email')].some((e) => e.textContent.includes(em)), email, { timeout: 8000 });
}

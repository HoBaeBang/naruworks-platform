// Shared helpers for the database structure e2e scripts (db-permissions / db-subitems / db-layout / db-properties-extra):
// result bookkeeping, overlay handling, inline-database creation, table cell access and direct API calls from the page
// (same-origin fetch with the session cookie, like the web client).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { launch, signup } from './lib.mjs';

export const SCRATCH = '/tmp/nc-e2e';
export const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export async function setup(name) {
  const OUT = process.env.NC_SHOTS ?? join(SCRATCH, 'wave3/dbs/shots', name);
  mkdirSync(OUT, { recursive: true });
  const ONLY = process.env.NC_ONLY ? new Set(process.env.NC_ONLY.split(',')) : null;
  const results = [];
  const { browser, context, page } = await launch();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const wait = (ms) => page.waitForTimeout(ms);
  const check = (n, ok, note = '') => {
    results.push({ name: n, ok: !!ok, note: String(note).slice(0, 200) });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${note ? `  — ${String(note).slice(0, 160)}` : ''}`);
  };
  const shot = async (n, locator) => {
    const path = join(OUT, `${n}.png`);
    if (locator) await locator.screenshot({ path }).catch(() => page.screenshot({ path }));
    else await page.screenshot({ path });
  };
  const overlay = () => page.locator('.lit-overlay-container .nc-overlay');
  async function closeOverlays() {
    for (let i = 0; i < 5; i++) {
      if (!(await overlay().count())) break;
      await page.keyboard.press('Escape');
      await wait(150);
    }
  }
  async function section(n, fn) {
    if (ONLY && !ONLY.has(n)) return;
    try {
      await fn();
    } catch (e) {
      check(`${n}: no exception`, false, e.message.split('\n')[0]);
      await shot(`err-${n}`);
    } finally {
      await closeOverlays();
    }
  }
  async function finish() {
    writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, pageErrors }, null, 2));
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} passed${pageErrors.length ? `, ${pageErrors.length} page errors` : ''}`);
    for (const e of pageErrors.slice(0, 5)) console.log('  pageerror:', e.slice(0, 200));
    await browser.close();
    process.exit(failed.length ? 1 : 0);
  }
  return { browser, context, page, wait, check, shot, section, closeOverlays, finish, results, pageErrors, OUT };
}

/** Sign up (retries while the dev server warms up) and open a fresh private page titled `title`. */
export async function freshPage(page, title, email) {
  for (let i = 0; ; i++) {
    try {
      await signup(page, email);
      break;
    } catch (e) {
      if (i >= 3) throw e;
      await page.waitForTimeout(4000);
    }
  }
  await page.click('[aria-label="New page"]');
  await page.waitForTimeout(350);
  const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
  if (await pageItem.count()) await pageItem.first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.locator('h1[data-content-editable-leaf]').last().click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}

/** Table helpers bound to the n-th database on the page. */
export function tableHelpers(page, index = 0) {
  const db = () => page.locator('.nc-db').nth(index);
  const rows = () => db().locator('.nc-table-row-outer');
  const rowByTitle = (t) => rows().filter({ has: page.locator('.nc-title-cell-text', { hasText: new RegExp(`^${esc(t)}$`) }) }).first();
  async function colId(name) {
    return db().locator('.lit-table-view-header-cell').filter({ has: page.locator('.nc-th-name', { hasText: new RegExp(`^${esc(name)}$`) }) }).first().getAttribute('data-col');
  }
  async function cell(rowTitle, propName) {
    const id = await colId(propName);
    return rowByTitle(rowTitle).locator(`.lit-table-view-cell[data-col="${id}"]`);
  }
  async function titles() {
    return rows().locator('.nc-title-cell-text').allInnerTexts();
  }
  async function addProperty(name, typeLabel) {
    await db().hover();
    await db().locator('[data-testid="add-column-button"]').first().click();
    await page.waitForSelector('.nc-add-prop');
    await page.keyboard.type(name, { delay: 8 });
    await page.locator('.nc-add-prop-cell').filter({ has: page.locator('.nc-add-prop-cell-label', { hasText: new RegExp(`^${esc(typeLabel)}$`) }) }).first().click();
    await page.waitForTimeout(350);
    for (let i = 0; i < 4 && (await page.locator('.lit-overlay-container .nc-overlay').count()); i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    }
  }
  async function newRow(title) {
    const empty = db().locator('.lit-table-view-empty-placeholder');
    if (await empty.count()) await empty.first().click();
    else await db().locator('.lit-table-view-add-row').first().click();
    await page.waitForSelector('.nc-title-cell-leaf.editing');
    await page.keyboard.type(title, { delay: 8 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(250);
  }
  async function openSettings() {
    await db().hover();
    await page.waitForTimeout(120);
    await db().locator('.nc-db-toolbar [aria-label="Settings"]').first().click();
    await page.waitForSelector('.nc-view-settings');
    await page.waitForTimeout(200);
  }
  return { db, rows, rowByTitle, colId, cell, titles, addProperty, newRow, openSettings };
}

/** Insert an inline database with "/inline" at the caret and name it. */
export async function createInlineDb(page, name) {
  await page.keyboard.type('/inline', { delay: 12 });
  await page.waitForTimeout(450);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: 'Database - Inline' }).first().click();
  await page.waitForSelector('.nc-db.inline');
  await page.waitForTimeout(500);
  const db = page.locator('.nc-db').last();
  await db.locator('.nc-db-title-leaf').click();
  await page.keyboard.type(name);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

/** POST /api/rpc/<name> from the page (session cookie); returns {status, body}. */
export async function apiCall(page, name, body) {
  return page.evaluate(async ([n, b]) => {
    const res = await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b), credentials: 'same-origin' });
    let json = null;
    try { json = await res.json(); } catch { /* empty */ }
    return { status: res.status, body: json };
  }, [name, body]);
}

/** Records of the current client store (debug / ids): window.__nc exposes nothing, so read ids from the DOM. */
export async function dbIds(page, index = 0) {
  return page.evaluate((i) => {
    const el = document.querySelectorAll('.nc-db-block')[i];
    return { blockId: el?.getAttribute('data-block-id') ?? null };
  }, index);
}

export { launch };

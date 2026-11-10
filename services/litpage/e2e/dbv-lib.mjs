
// tableHelpers / createInlineDb / apiCall) and adds full-page databases, views, bulk rows through the dev record
// store (window.__ncEditor, dev builds only) and small store readers.
import { join } from 'node:path';
import { SCRATCH, esc, setup as baseSetup } from './db-lib.mjs';

export async function setup(name) {
  process.env.NC_SHOTS ??= join(SCRATCH, 'wave3/dbv/shots', name);
  return baseSetup(name);
}

/** Type a slash command at the caret and pick the item whose text matches `label`. */
export async function slash(page, query, label) {
  await page.keyboard.type(`/${query}`, { delay: 12 });
  await page.waitForTimeout(450);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: label }).first().click();
}

/** "/Database - Full page" on the current page → the new database page (setup panel closed, titled `name`). */
export async function createFullPageDb(page, name) {
  await slash(page, 'full page', /Database( -)? full page/i);
  await page.waitForSelector('.nc-db.full');
  await page.waitForTimeout(500);
  const close = page.locator('.nc-new-db-panel [aria-label="Close"]');
  if (await close.count()) await close.first().click();
  await page.waitForTimeout(200);
  await page.locator('.nc-db-page-title').click();
  await page.keyboard.type(name);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  return page.locator('.nc-db-page').first().getAttribute('data-page-id');
}

/** Record store access (dev builds expose window.__ncEditor). */
export function storeGet(page, table, id) {
  return page.evaluate(([t, i]) => window.__ncEditor.records.get(t, i) ?? null, [table, id]);
}

export function spaceIdOf(page, blockId) {
  return page.evaluate((id) => window.__ncEditor.records.get('block', id)?.space_id, blockId);
}

/** Add rows to a data source in one transaction: rows = [{ title, props? }] (props are stored values). */
export async function bulkRows(page, collectionId, rows) {
  return page.evaluate(([cid, list]) => {
    const { records, transactions } = window.__ncEditor;
    const col = records.get('collection', cid);
    const ids = [];
    transactions.run(col.space_id, 'e2e.bulkRows', (tx) => {
      let t = Date.now();
      for (const r of list) {
        const id = crypto.randomUUID();
        ids.push(id);
        tx.set('block', id, [], {
          id, type: 'page', parent_id: cid, parent_table: 'collection', alive: true, space_id: col.space_id, version: 0,
          properties: { title: [[r.title]], ...(r.props ?? {}) }, created_time: t++, last_edited_time: t,
        });
      }
    });
    return ids;
  }, [collectionId, rows]);
}

/** Wait until every queued transaction reached the server. */
export async function saved(page, timeout = 8000) {
  await page.waitForFunction(() => window.__ncEditor.transactions.pendingCount() === 0, null, { timeout });
}

/** Add a view of `typeLabel` through the "+" next to the tabs / the title (single view), closing the New view panel. */
export async function addView(page, dbLocator, typeLabel, opts = {}) {
  await dbLocator.hover();
  await page.waitForTimeout(150);
  const plus = dbLocator.locator('.lit-collection-add-view').first();
  await plus.click({ force: true });
  await page.waitForSelector('.nc-add-view-menu');
  await page.locator('.nc-add-view-cell').filter({ has: page.locator('.nc-add-view-label', { hasText: new RegExp(`^${esc(typeLabel)}$`) }) }).first().click();
  await page.waitForTimeout(400);
  if (opts.keepOverlays) return;
  for (let i = 0; i < 3 && (await page.locator('.lit-overlay-container .nc-overlay').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(150);
  }
}

export { esc };

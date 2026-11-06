// Move to another workspace: the Move to picker's workspace switcher lists the user's
// workspaces; choosing a destination there asks "This creates a copy instead of moving the page" → "Confirm and duplicate"; the
// copy (with its sub-page) appears in the other workspace's Private section while the original stays; with Settings ›
// Security › "Disable duplicating pages to other workspaces" only the current workspace is listed.
import { launch } from './lib.mjs';
import { createPage, reporter, shot, signupAny } from './page-lib.mjs';
import { apiCall } from './db-lib.mjs';

const { check, finish } = reporter();
const { browser, page } = await launch();
try {
  await signupAny(page, `move-${Date.now()}@test.dev`, 'Mona Move', 'Acme');
  const second = await apiCall(page, 'createWorkspace', { name: 'Beta Labs' });
  check('second workspace created', second.status === 200, String(second.status));
  await page.reload();
  await page.waitForSelector('nav.lit-sidebar-container');
  await createPage(page, 'Roadmap 2027', ['Quarter one: discovery.', '']);
  const pageId = await page.$eval('.nc-page-title', (e) => e.getAttribute('data-block-id'));

  // --- Move to › workspace switcher
  await page.keyboard.press('Escape');
  await page.click('.lit-topbar-more-button');
  await page.waitForSelector('.lit-overlay-container [role="option"]');
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Move to/ }).first().click();
  await page.waitForSelector('.nc-moveto');
  await page.click('.nc-moveto-space');
  await page.waitForSelector('.lit-overlay-container >> text=Workspaces');
  const spaces = await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').allInnerTexts();
  check('switcher lists both workspaces', spaces.some((s) => s.includes('Acme')) && spaces.some((s) => s.includes('Beta Labs')), spaces.join('|'));
  await page.locator('.lit-overlay-container [role="menuitem"], .lit-overlay-container [role="option"]').filter({ hasText: 'Beta Labs' }).first().click();
  await page.waitForSelector('.nc-moveto-hint');
  check('hint: duplicate, not move', (await page.textContent('.nc-moveto-hint')).includes('Pages can only be duplicated into another workspace, not moved there.'));
  check('picker footer shows Beta Labs', (await page.textContent('.nc-moveto-space')).includes('Beta Labs'));
  await shot(page, 'move-01-other-workspace');
  await page.locator('.nc-moveto-row').filter({ hasText: 'Private Pages' }).first().click();
  await page.waitForSelector('.nc-confirm');
  const confirmText = await page.textContent('.nc-confirm');
  check('confirm "This creates a copy instead of moving the page"', confirmText.includes('This creates a copy instead of moving the page') && confirmText.includes('The current workspace page stays unchanged'), confirmText.slice(0, 80));
  await page.click('.nc-confirm button >> text=Confirm and duplicate');
  await page.waitForSelector('.nc-toast >> text=/Moved 1 page/', { timeout: 8000 });
  check('toast "Moved 1 page to Beta Labs › Private"', (await page.textContent('.nc-toast')).includes('Beta Labs'));
  // the original stays
  check('original page still here', (await page.$eval('.nc-page-title', (e) => e.getAttribute('data-block-id'))) === pageId);
  // Visit → the copy in Beta Labs
  await page.click('.nc-toast-action >> text=Visit');
  await page.waitForSelector('.nc-page-title >> text=Roadmap 2027', { timeout: 8000 });
  const copyId = await page.$eval('.nc-page-title', (e) => e.getAttribute('data-block-id'));
  check('Visit opens the copy', copyId && copyId !== pageId);
  check('copy keeps the content', (await page.locator('.lit-page-content').innerText()).includes('Quarter one: discovery.'));
  await page.waitForTimeout(600);
  check('copy listed in Beta Labs sidebar', (await page.locator('nav.lit-sidebar-container [role="treeitem"]').filter({ hasText: 'Roadmap 2027' }).count()) > 0);
  await shot(page, 'move-02-copy');

  // --- Disable duplicating pages to other workspaces (Acme) → only the current workspace is listed
  const acme = await page.evaluate(async (id) => {
    const r = await fetch('/api/rpc/loadPage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: id }) });
    return (await r.json()).recordMap.block[id].value.value.space_id;
  }, pageId);
  const off = await apiCall(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: acme, operations: [{ pointer: { table: 'space', id: acme, spaceId: acme }, path: ['settings'], command: 'update', args: { disable_move_to_space: true } }] }] });
  check('owner disables duplicating to other workspaces', off.status === 200, String(off.status));
  const denied = await apiCall(page, 'duplicateToSpace', { blockIds: [pageId], spaceId: (await apiCall(page, 'getMoveTargets', { spaceId: copyId ? (await page.evaluate(async (id) => (await (await fetch('/api/rpc/loadPage', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: id }) })).json()).recordMap.block[id].value.value.space_id, copyId)) : '' })).body?.spaceId, parent: { kind: 'private' } });
  check('server refuses while disabled', denied.status === 403, `${denied.status} ${denied.body?.message ?? ''}`);
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  await shot(page, 'move-error');
} finally {
  await browser.close();
  finish();
}

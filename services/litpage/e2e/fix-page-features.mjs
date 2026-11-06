// Comments on public pages ("Can comment" link → signed-in visitors comment, signed-out visitors log
// in first), the sidebar's New page shortcut in preview mode (center peek + "Add to ▾", "New page
// in…" destination) and database restore rules in Version history.
// Run: NC_BASE=http://127.0.0.1:5531 node e2e/fix-page-features.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, CHROME } from './lib.mjs';
import { apiLogin, call, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';
import { addBlock, domainOf, makeDatabase, makePage, tx } from './fix-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/wave3/fix/shots';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const contexts = [];
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.setDefaultNavigationTimeout(60000); // busy dev server: page loads can be slow
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return p;
};
const rec = (rm, table, id) => {
  const e = rm?.[table]?.[id];
  return e?.value?.value ?? e?.value;
};
const get = async (page, table, id) => rec((await call(page, 'fetchRecords', { requests: [{ pointer: { table, id } }] })).recordMap, table, id);

try {
  const id = uniq();
  const A = await mk();
  const a = await apiLogin(A, { email: `pat${id}@test.dev`, name: 'Pat Publisher', workspace: 'Press Co' });
  const spaceId = a.spaceId;
  const domain = await domainOf(A, spaceId);

  // ---------------------------------------------------------------- public comments
  const pub = await createPrivatePage(A, spaceId, 'Press release');
  await addBlock(A, spaceId, pub, { title: [['Embargo lifts on Monday']] });
  await A.goto(`${BASE}/${domain}/Press-release-${pub.replace(/-/g, '')}`);
  await A.waitForSelector('.lit-topbar');
  await A.locator('.lit-topbar [aria-label="Share"]').first().click();
  await A.waitForSelector('.nc-share-ga-btn');
  await A.click('.nc-share-ga-btn');
  await A.locator('.lit-overlay-container [role="option"]', { hasText: 'Anyone online who has the link' }).first().click();
  await A.waitForTimeout(400);
  await A.locator('.nc-share-general .nc-share-role').first().click();
  await A.locator('.lit-overlay-container [role="option"]', { hasText: /^Can comment/ }).first().click();
  r.ok(await waitFor(() => A.locator('.nc-share-public-comments', { hasText: 'Anyone on the web can comment on this page' }).count()), 'Share: "Anyone on the web can comment on this page"');
  await A.screenshot({ path: `${OUT}/30-share-public-comments.png` });
  await A.keyboard.press('Escape');

  const V = await mk();
  await apiLogin(V, { email: `vic${id}@test.dev`, name: 'Vic Visitor', workspace: 'Vic home' });
  await V.goto(`${BASE}/public/${pub.replace(/-/g, '')}`);
  const commentBtn = V.locator('.nc-public-comment-btn');
  await commentBtn.waitFor();
  r.ok(await commentBtn.count() === 1, 'public page: Litpage’s "Comment" button in the top bar');
  await commentBtn.click();
  const composer = V.locator('.nc-page-discussions .nc-comment-input');
  await composer.waitFor();
  await composer.click();
  await V.keyboard.type('Can we quote you on this?');
  await V.keyboard.press('Enter');
  r.ok(await waitFor(() => V.locator('.nc-page-discussions', { hasText: 'Can we quote you on this?' }).count()), 'a signed-in visitor adds a page comment');
  await V.screenshot({ path: `${OUT}/31-public-comment.png` });
  const page1 = await waitFor(async () => {
    const p = await get(A, 'block', pub);
    return (p?.discussions ?? []).length ? p : null;
  });
  r.ok(!!page1, 'the comment is saved on the page (the owner sees it)');

  const anon = await mk();
  await anon.goto(`${BASE}/public/${pub.replace(/-/g, '')}`);
  await anon.waitForSelector('.nc-public-comment-btn');
  r.ok(await waitFor(() => anon.locator('.nc-page-discussions', { hasText: 'Can we quote you on this?' }).count()), 'signed-out visitors read the comments');
  r.ok(await anon.locator('.nc-page-discussions .nc-comment-input').count() === 0, '…but get no composer');
  await anon.click('.nc-public-comment-btn');
  r.ok(await waitFor(() => anon.url().includes('/login')), '"Comment" sends signed-out visitors to log in');

  // ---------------------------------------------------------------- New page shortcut + preview mode
  const projects = await makePage(A, spaceId, 'Projects hub');
  await A.goto(`${BASE}/${domain}`);
  await A.waitForSelector('nav.lit-sidebar-container');
  await A.getByText('Customize sidebar').click();
  await A.locator('.nc-sb-cust-add').first().click();
  await A.locator('.lit-overlay-container [role="option"]', { hasText: /^New page$/ }).first().click();
  await A.click('.nc-sb-done');
  const shortcut = A.locator('nav .nc-sb-shortcut [aria-label="New page"]').first();
  await shortcut.waitFor();
  r.ok(await shortcut.count() === 1, 'the New page shortcut is in the sidebar');
  await shortcut.click();
  const addTo = A.locator('.nc-center-peek .nc-preview-addto');
  r.ok(await waitFor(() => addTo.count()) === 1, 'New page opens in preview mode (center peek)');
  r.ok(/Add to\s*Private pages/.test(await addTo.textContent() ?? ''), 'the preview bar says "Add to  Private pages ▾"');
  await A.screenshot({ path: `${OUT}/32-new-page-preview.png` });
  const draftId = await A.evaluate(() => new URL(location.href).searchParams.get('p'));
  await addTo.click();
  const pickerInput = A.locator('.nc-moveto input');
  await pickerInput.waitFor();
  r.ok((await pickerInput.getAttribute('placeholder')) === 'Search for a destination page…', 'the location picker: "Search for a destination page…"');
  await pickerInput.fill('Projects hub');
  await A.locator('.nc-moveto-row', { hasText: 'Projects hub' }).first().click();
  r.ok(await waitFor(async () => /Add to\s*Projects hub/.test(await addTo.textContent().catch(() => '') ?? '')), 'after choosing, the bar shows the new location');
  const moved = await waitFor(async () => {
    const all = await call(A, 'fetchRecords', { requests: [{ pointer: { table: 'block', id: projects } }] });
    const p = rec(all.recordMap, 'block', projects);
    return (p?.content ?? []).some((c) => c.replace(/-/g, '') === draftId);
  });
  r.ok(!!moved, 'the new page now lives in Projects hub');
  await A.keyboard.press('Escape');
  // shortcut ••• › Create page in… → "Create page in Projects hub"
  const row = A.locator('nav .nc-sb-shortcut').filter({ has: A.locator('[aria-label="New page"]') }).first();
  await row.hover();
  await row.locator('[aria-label="Open the shortcut menu"]').click();
  await A.locator('.lit-overlay-container [role="option"]', { hasText: 'Create page in…' }).first().click();
  const destInput = A.locator('.nc-newpage-dest input');
  await destInput.waitFor();
  await destInput.fill('Projects hub');
  await A.locator('.nc-newpage-dest .nc-moveto-row', { hasText: 'Projects hub' }).first().click();
  r.ok(await waitFor(() => A.locator('nav .nc-sb-shortcut [aria-label="Create page in Projects hub"]').count()), 'the shortcut reads "Create page in Projects hub"');
  await A.locator('nav .nc-sb-shortcut [aria-label="Create page in Projects hub"]').click();
  r.ok(await waitFor(async () => /Add to\s*Projects hub/.test(await A.locator('.nc-center-peek .nc-preview-addto').textContent().catch(() => '') ?? '')), 'its new pages start in Projects hub');
  await A.keyboard.press('Escape');

  // ---------------------------------------------------------------- database restore rules
  const host = await makePage(A, spaceId, 'Planning');
  const inline = await makeDatabase(A, spaceId, host, 'Milestones', [{ title: 'Kickoff', notes: 'v1' }], { inline: true });
  const full = await makeDatabase(A, spaceId, host, 'Roster', [{ title: 'Ada', notes: 'lead' }]);
  // first versions
  const v1Host = (await call(A, 'getVersionHistory', { pageId: host })).versions[0].id;
  const v1Full = (await call(A, 'getVersionHistory', { pageId: full.blockId })).versions[0].id;
  await tx(A, spaceId, [{ pointer: { table: 'block', id: inline.rowIds[0] }, path: ['properties', 'notes'], command: 'set', args: [['v2']] }]);
  await tx(A, spaceId, [{ pointer: { table: 'block', id: full.rowIds[0] }, path: ['properties', 'notes'], command: 'set', args: [['changed']] }]);
  await addBlock(A, spaceId, host, { title: [['Later paragraph']] });

  // the page with an inline database: "Restore this page’s databases too"
  await A.goto(`${BASE}/${domain}/Planning-${host.replace(/-/g, '')}?vh=${v1Host.replace(/-/g, '')}`);
  await A.waitForSelector('.nc-vh');
  // versions made within the same minute share one row in the default "1 minute" grouping: the link still selects v1
  await A.waitForSelector('.nc-vh-restore-btn:not([disabled])');
  await A.waitForTimeout(500);
  await A.click('.nc-vh-restore-btn');
  const panel = A.locator('.nc-vh-restore');
  await panel.waitFor();
  r.ok(await panel.locator('.nc-vh-db-option', { hasText: 'Restore this page’s databases too' }).count() === 1, 'restore panel: "Restore this page’s databases too"');
  r.ok(await panel.locator('.nc-vh-db-group[data-group="restored"]', { hasText: 'Milestones' }).count() === 1, '…Milestones "Will restore"');
  await panel.locator('.nc-vh-db-option input').uncheck();
  r.ok(await panel.locator('.nc-vh-db-group[data-group="unchanged"]', { hasText: 'Milestones' }).count() === 1, 'unchecked: Milestones "Will stay unchanged"');
  await A.screenshot({ path: `${OUT}/33-restore-inline.png` });
  await panel.locator('.nc-vh-db-option input').check();
  await panel.getByRole('button', { name: 'Restore selected version' }).click();
  r.ok(await waitFor(async () => (await get(A, 'block', inline.rowIds[0]))?.properties?.notes?.[0]?.[0] === 'v1'), 'restoring brings back the inline database’s values');
  r.ok(await waitFor(async () => (await get(A, 'block', full.rowIds[0]))?.properties?.notes?.[0]?.[0] === 'changed'), 'a nested full-page database is not part of the page’s restore');

  // the full-page database itself: its own restore panel
  await A.goto(`${BASE}/${domain}/Roster-${full.blockId.replace(/-/g, '')}?vh=${v1Full.replace(/-/g, '')}`);
  await A.waitForSelector('.nc-vh');
  await A.waitForSelector('.nc-vh-restore-btn:not([disabled])');
  await A.waitForTimeout(500);
  await A.click('.nc-vh-restore-btn');
  const dbPanel = A.locator('.nc-vh-restore');
  await dbPanel.waitFor();
  for (const title of ['Database properties', 'Every record with its property values', 'Every database view and how it’s set up', 'Database metadata']) {
    r.ok(await dbPanel.locator('.item .t', { hasText: title }).count() === 1, `full-page database restore lists "${title}"`);
  }
  await A.screenshot({ path: `${OUT}/34-restore-database.png` });
  await dbPanel.getByRole('button', { name: 'Restore selected version' }).click();
  r.ok(await waitFor(async () => (await get(A, 'block', full.rowIds[0]))?.properties?.notes?.[0]?.[0] === 'lead'), 'restoring the database brings back its records’ values');
} catch (e) {
  console.log('FAIL exception', e);
  process.exitCode = 1;
} finally {
  r.done();
  for (const c of contexts) await c.close().catch(() => {});
  await browser.close();
}

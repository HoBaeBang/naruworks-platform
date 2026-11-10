// Editor / database UI checks:
// Find & replace (inline database rows hidden by the view's filter aren't found; "Replaced N matches" after the save;
// Suggesting mode → suggestions in text blocks only) · Present from a block inside a toggle · Customize layout (not on
// a wiki home, on database row pages) · "Add layout to sidebar" shows the view's filtered rows · Person property groups
// · webhook header values come back masked · Upload audio off without speech-to-text · layout backlinks on row pages.
// NC_BASE=http://127.0.0.1:5541 node e2e/secfix-editor.mjs
import { mkdirSync } from 'node:fs';
import { BASE, launch } from './lib.mjs';
import { apiLogin, call, compact, createPrivatePage, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/wave3/secfix/shots';
mkdirSync(OUT, { recursive: true });
const MASK = '•'.repeat(8);

const { browser, page } = await launch();
page.setDefaultTimeout(15000);
let failed = 0;
let passed = 0;
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (cond) passed++; else { failed++; process.exitCode = 1; } };
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    ok(false, `${name}: ${String(e.message ?? e).split('\n')[0]}`);
    await page.screenshot({ path: `${OUT}/fail-editor-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});
  }
}
const now = Date.now();
let spaceId = '';
let uid = '';
let domain = '';
const tx = (operations) => call(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations }] });
const set = (table, id, args) => ({ pointer: { table, id, spaceId }, path: [], command: 'set', args });
const block = (id, parentId, extra) => set('block', id, { id, version: 1, parent_id: parentId, parent_table: 'block', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, ...extra });
const text = (id, parentId, s, extra = {}) => block(id, parentId, { type: 'text', properties: { title: [[s]] }, ...extra });
const record = async (table, id) => {
  const r = await call(page, 'fetchRecords', { requests: [{ pointer: { table, id }, version: -1 }] });
  const e = r.recordMap?.[table]?.[id];
  return e?.value?.value ?? e?.value;
};
const hiddenFilter = [{ id: 'f1', filter: { property: 'title', filter: { operator: 'string_does_not_contain', value: { type: 'exact', value: 'hidden' } } } }];
const open = async (id) => {
  await page.goto(`${BASE}/${domain}/${compact(id)}`);
  await page.waitForSelector('.nc-page-scroller', { timeout: 20000 });
  await page.waitForTimeout(700);
};
const menuItem = (text) => page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: text }).first();

try {
  const u = uniq();
  ({ spaceId, userId: uid } = await apiLogin(page, { email: `editor${u}@secfix.dev`, name: 'Eddie Editor', workspace: `Editor ${u}` }));
  const uc = await call(page, 'loadAccountData', {});
  domain = (uc.recordMap.space[spaceId].value.value ?? uc.recordMap.space[spaceId].value).domain;
  ok(!!domain, 'signed up with a workspace');

  // ---------------------------------------------------------------- Find & replace
  const P = await createPrivatePage(page, spaceId, `Findings ${u}`);
  const t1 = crypto.randomUUID();
  const t2 = crypto.randomUUID();
  const D = crypto.randomUUID();
  const C = crypto.randomUUID();
  const V = crypto.randomUUID();
  const R1 = crypto.randomUUID();
  const R2 = crypto.randomUUID();
  await tx([
    text(t1, P, 'zebra one'), text(t2, P, 'zebra two'),
    block(D, P, { type: 'collection_view', collection_id: C, view_ids: [V] }),
    set('collection', C, { id: C, name: [['Animals']], schema: { title: { name: 'Name', type: 'title' } }, parent_id: D, parent_table: 'block', alive: true, space_id: spaceId }),
    set('collection_view', V, { id: V, type: 'table', name: 'Table', parent_id: D, parent_table: 'block', alive: true, space_id: spaceId, format: { property_filters: hiddenFilter } }),
    set('block', R1, { id: R1, type: 'page', parent_id: C, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['zebra visible']] } }),
    set('block', R2, { id: R2, type: 'page', parent_id: C, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['zebra hidden']] } }),
    { pointer: { table: 'block', id: P, spaceId }, path: ['content'], command: 'set', args: [t1, t2, D] },
  ]);
  await step('find', async () => {
    await open(P);
    await page.waitForSelector('.nc-db');
    await page.locator(`[data-block-id="${t1}"] [data-content-editable-leaf]`).first().click();
    await page.keyboard.press('Meta+Alt+f');
    await page.waitForSelector('.nc-find-bar');
    await page.keyboard.type('zebra');
    await page.waitForTimeout(300);
    const total = await page.locator('.nc-find-count-inner span').last().innerText();
    ok(total === '3', `Find counts what the page shows: 2 text blocks + 1 visible row (got ${total}; the filtered-out row isn't found)`);
    await page.locator('.nc-find-bar input[placeholder="Replace with…"]').fill('okapi');
    await page.locator('.nc-find-bar .nc-find-text-btn', { hasText: 'Replace all' }).click();
    const toast = await waitFor(async () => (await page.locator('.nc-toast', { hasText: 'Replaced' }).allInnerTexts()).join(' '));
    ok(/Replaced 3 matches/.test(toast ?? ''), `toast after the save: "${toast}"`);
    ok((await record('block', R2)).properties.title[0][0] === 'zebra hidden', 'the hidden row was left alone');
    ok((await record('block', t1)).properties.title[0][0] === 'okapi one', 'text replaced');
    await page.keyboard.press('Escape');
  });

  await step('find while suggesting', async () => {
    await page.evaluate((id) => sessionStorage.setItem('nc:suggesting', JSON.stringify({ [id]: true })), P);
    await open(P);
    await page.locator(`[data-block-id="${t2}"] [data-content-editable-leaf]`).first().click();
    await page.keyboard.press('Meta+Alt+f');
    await page.waitForSelector('.nc-find-bar');
    await page.keyboard.type('okapi');
    await page.waitForTimeout(300);
    await page.locator('.nc-find-bar input[placeholder="Replace with…"]').fill('lion');
    await page.locator('.nc-find-bar .nc-find-text-btn', { hasText: 'Replace all' }).click();
    const toast = await waitFor(async () => (await page.locator('.nc-toast', { hasText: 'Replaced 2' }).allInnerTexts()).join(' '));
    ok(/Replaced 2 matches/.test(toast ?? ''), `suggesting: 2 suggestions (text blocks only) — "${toast}"`);
    const b1 = await record('block', t1);
    const anns = JSON.stringify(b1.properties.title);
    ok(anns.includes('"si"') && anns.includes('"sr"'), 'suggesting: the text keeps "okapi" struck and suggests "lion"');
    ok((await record('block', R1)).properties.title[0][0] === 'okapi visible', 'suggesting: the database row is not changed');
    await page.screenshot({ path: `${OUT}/find-suggesting.png` });
    await page.keyboard.press('Escape');
    await page.evaluate(() => sessionStorage.removeItem('nc:suggesting'));
  });

  // ---------------------------------------------------------------- Present from here (nested block)
  await step('present', async () => {
    const Q = await createPrivatePage(page, spaceId, `Deck ${u}`);
    const [a, d1, tg, deep, d2, z] = Array.from({ length: 6 }, () => crypto.randomUUID());
    await tx([
      text(a, Q, 'Intro'), block(d1, Q, { type: 'divider' }), block(tg, Q, { type: 'toggle', properties: { title: [['Fold']] }, content: [deep] }),
      text(deep, tg, 'Deep inside'), block(d2, Q, { type: 'divider' }), text(z, Q, 'Last'),
      { pointer: { table: 'block', id: Q, spaceId }, path: ['content'], command: 'set', args: [a, d1, tg, d2, z] },
    ]);
    await open(Q);
    await page.evaluate(([pageId, blockId]) => window.dispatchEvent(new CustomEvent('nc:present', { detail: { pageId, blockId } })), [Q, deep]);
    await page.waitForSelector('.nc-present-controls .count');
    const count = await page.locator('.nc-present-controls .count').innerText();
    ok(count.replace(/\s/g, '') === '3/4', `Present from a block inside a toggle starts on its slide (${count})`);
    await page.locator('[aria-label="Exit presentation"]').click();
  });

  // ---------------------------------------------------------------- Customize layout availability
  await step('customize layout', async () => {
    await open(R1);
    await page.click('.lit-topbar-more-button');
    await page.hover('.nc-popover [role=option] >> text=Appearance & layout');
    await page.waitForTimeout(400);
    ok(await page.locator('.nc-popover [role=menuitem]', { hasText: 'Customize layout' }).count() > 0, 'database row page: ••• › Appearance & layout › Customize layout');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const W = await createPrivatePage(page, spaceId, `Handbook ${u}`);
    ok(!(await call(page, 'turnIntoWiki', { pageId: W })).__error, 'a page turned into a wiki');
    await open(W);
    await page.click('.lit-topbar-more-button');
    await page.hover('.nc-popover [role=option] >> text=Appearance & layout');
    await page.waitForTimeout(400);
    ok(await page.locator('.nc-popover [role=menuitem]', { hasText: 'Customize layout' }).count() === 0, 'wiki home: no Customize layout');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });

  // ---------------------------------------------------------------- full-page database: sidebar view + person groups
  const F = crypto.randomUUID();
  const FC = crypto.randomUUID();
  const FV = crypto.randomUUID();
  const shown = crypto.randomUUID();
  const hidden = crypto.randomUUID();
  const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
  await tx([
    set('block', F, { id: F, type: 'collection_view_page', collection_id: FC, view_ids: [FV], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }] }),
    set('collection', FC, { id: FC, name: [['Roster']], schema: { title: { name: 'Name', type: 'title' }, rev: { name: 'Reviewers', type: 'person', notification_mode: 'users_and_groups' } }, parent_id: F, parent_table: 'block', alive: true, space_id: spaceId }),
    set('collection_view', FV, { id: FV, type: 'table', name: 'Table', parent_id: F, parent_table: 'block', alive: true, space_id: spaceId, format: { property_filters: hiddenFilter, table_properties: [{ property: 'title', visible: true }, { property: 'rev', visible: true }] } }),
    { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: F } },
    set('block', shown, { id: shown, type: 'page', parent_id: FC, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['Shown row']] } }),
    set('block', hidden, { id: hidden, type: 'page', parent_id: FC, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['Hidden row']] } }),
  ]);
  await step('sidebar view', async () => {
    await open(F);
    await page.waitForSelector('.nc-view-tablist .lit-collection-view-tab.active');
    await page.click('.nc-view-tablist .lit-collection-view-tab.active');
    await menuItem('Add layout to sidebar').click();
    const nav = await waitFor(async () => { const s = await page.textContent('nav') ?? ''; return /Roster/.test(s) && /Shown row/.test(s) ? s : null; });
    ok(!!nav, 'the sidebar section lists the view’s rows');
    ok(!/Hidden row/.test(nav ?? ''), 'rows the view filters out are not listed');
  });

  await step('person groups', async () => {
    const g = await call(page, 'createGroup', { spaceId, name: 'Design crew', memberIds: [uid] });
    ok(!g.__error, 'a permission group');
    await open(F);
    const row = page.locator('.nc-table-row-outer').filter({ has: page.locator('.nc-title-cell-text', { hasText: /^Shown row$/ }) }).first();
    const colId = await page.locator('.lit-table-view-header-cell').filter({ has: page.locator('.nc-th-name', { hasText: /^Reviewers$/ }) }).first().getAttribute('data-col');
    await row.locator(`.lit-table-view-cell[data-col="${colId}"]`).click();
    await page.waitForSelector('.nc-select-editor');
    const opt = page.locator('.nc-select-editor [data-group-id]', { hasText: 'Design crew' });
    ok(await opt.count() > 0, 'the Person editor lists groups ("Search for people or groups…")');
    await opt.first().click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    ok(await row.locator(`.lit-table-view-cell[data-col="${colId}"] .nc-group-chip`, { hasText: 'Design crew' }).count() > 0, 'the cell shows the group');
    const rv = await record('block', shown);
    ok(JSON.stringify(rv.properties.rev ?? []).includes('"g"'), 'the value stores the group');
    await page.screenshot({ path: `${OUT}/person-groups.png` });
  });

  await step('peek mode', async () => {
    await open(F);
    const row = page.locator('.nc-table-row-outer').filter({ has: page.locator('.nc-title-cell-text', { hasText: /^Shown row$/ }) }).first();
    await row.hover();
    await row.locator('.nc-open-button').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('pm') === 's');
    await page.hover('.lit-peek-topbar'); // the switch shows on hover of the peek header
    await page.locator('.lit-peek-topbar [aria-label="Change preview mode"]').first().click();
    await menuItem('Center preview').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('pm') === 'c');
    const saved = await waitFor(async () => (await record('collection_view', FV))?.format?.collection_peek_mode === 'center_peek');
    ok(!!saved, 'Change preview mode saves the view’s "Open pages in"');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await row.hover();
    await row.locator('.nc-open-button').click();
    await page.waitForFunction(() => new URL(location.href).searchParams.get('pm') === 'c');
    ok(true, 'the next page of that view opens in center peek');
    await page.keyboard.press('Escape');
  });

  // ---------------------------------------------------------------- button webhook header + meeting upload
  await step('button webhook header', async () => {
    const B = crypto.randomUUID();
    const host = await createPrivatePage(page, spaceId, `Buttons ${u}`);
    await tx([
      block(B, host, { type: 'button', properties: { title: [['Ping']] }, format: { button_automation: { trigger: 'button_clicked', v: 2, actions: [{ id: 'w', type: 'webhook', url: 'https://hooks.example.test/x', headers: [{ id: 'h1', key: 'X-Token', value: 'secret-123' }], properties: 'all' }] } } }),
      { pointer: { table: 'block', id: host, spaceId }, path: ['content'], command: 'set', args: [B] },
    ]);
    const stored = await record('block', B);
    ok(stored.format.button_automation.actions[0].headers[0].value === MASK, 'the stored header value is a placeholder');
    await open(host);
    await page.locator(`[data-block-id="${B}"]`).first().hover();
    await page.locator(`[data-block-id="${B}"] [aria-label="Edit button"]`).first().click();
    await page.waitForSelector('.nc-button-config');
    const v = await page.locator('.nc-button-config input[aria-label="Value"]').first().inputValue();
    ok(v === MASK, 'the header value shows masked in the editor');
    await page.keyboard.press('Escape');
  });

  await step('meeting upload', async () => {
    const M = crypto.randomUUID();
    const host = await createPrivatePage(page, spaceId, `Standup ${u}`);
    await tx([block(M, host, { type: 'meeting_notes', properties: { title: [['Standup']] } }), { pointer: { table: 'block', id: host, spaceId }, path: ['content'], command: 'set', args: [M] }]);
    await open(host);
    const btn = page.locator(`[data-block-id="${M}"] [aria-label="Upload audio"]`).first();
    await btn.waitFor();
    // the button renders before meetingStatus answers (enabled while loading): wait for the answer
    ok(await waitFor(async () => (await btn.getAttribute('aria-disabled')) === 'true'), 'Upload audio is off without a speech-to-text service');
    ok(/speech-to-text/.test((await btn.getAttribute('data-tooltip')) ?? ''), 'and says why');
  });

  // ---------------------------------------------------------------- layout backlinks on row pages
  await step('layout backlinks', async () => {
    const mention = crypto.randomUUID();
    const other = await createPrivatePage(page, spaceId, `Mentions ${u}`);
    await tx([
      text(mention, other, '', { properties: { title: [['‣', [['p', shown, spaceId]]]] } }),
      { pointer: { table: 'block', id: other, spaceId }, path: ['content'], command: 'set', args: [mention] },
      { pointer: { table: 'collection', id: FC, spaceId }, path: ['format'], command: 'update', args: { page_layout: { structure: 'simple', modules: { page_main: [{ id: 'title', type: 'title', pinned: [], backlinks: 'show' }], page_details: [] }, settings: { inline_comments: 'minimal' } } } },
    ]);
    await open(shown);
    const bl = await waitFor(async () => (await page.locator('.nc-backlinks').count()) > 0);
    ok(!!bl, 'Heading › Backlinks "Always show" expands backlinks on the database page');
  });
} catch (e) {
  ok(false, `unexpected: ${e.message}`);
} finally {
  await browser.close();
  console.log(`\n${passed} passed, ${failed} failed`);
}

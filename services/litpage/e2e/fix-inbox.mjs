// Mention & comment notifications: Inbox badge, Mentions filter, Resolve / Reopen and
// Reply from the Inbox, clicking opens the page on that thread (?d=), group mentions read "tagged your group on".
// Two users (A owner, B member), one Chrome, two contexts.
// Run: NC_BASE=http://127.0.0.1:5531 node e2e/fix-inbox.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { CHROME } from './lib.mjs';
import { apiLogin, call, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/wave3/fix/shots';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.setDefaultNavigationTimeout(60000); // busy dev server: page loads can be slow
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return p;
};

/** A thread on `blockId` with one comment (mentioning `mention`), then the fan-out — what the comments UI does. */
function comment(page, blockId, text, mention = null) {
  return page.evaluate(async ([blockId, text, mention]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const uid = Object.keys(uc.recordMap.user_root)[0];
    const chunk = await post('fetchRecords', { requests: [{ pointer: { table: 'block', id: blockId } }] });
    const b = chunk.recordMap.block[blockId].value.value ?? chunk.recordMap.block[blockId].value;
    const did = crypto.randomUUID();
    const cid = crypto.randomUUID();
    const now = Date.now();
    const rich = mention ? [[text + ' '], ['‣', [['u', mention]]]] : [[text]];
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: b.space_id, operations: [
      { pointer: { table: 'discussion', id: did, spaceId: b.space_id }, path: [], command: 'set', args: { id: did, parent_id: blockId, parent_table: 'block', resolved: false, comments: [], space_id: b.space_id, alive: true, type: 'default', context: [['Ship date']], created_by_id: uid, created_time: now } },
      { pointer: { table: 'block', id: blockId, spaceId: b.space_id }, path: ['discussions'], command: 'listAfter', args: { id: did } },
      { pointer: { table: 'comment', id: cid, spaceId: b.space_id }, path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: rich, created_by_id: uid, created_time: now, last_edited_time: now, alive: true, space_id: b.space_id } },
      { pointer: { table: 'discussion', id: did, spaceId: b.space_id }, path: ['comments'], command: 'listAfter', args: { id: cid } },
    ] }] });
    await post('notifyComment', { commentId: cid });
    return did;
  }, [blockId, text, mention]);
}

/** A text block under `pageId` (rich text), then notifyMentions — what the editor's @ menu does. */
function mentionBlock(page, pageId, title, notify) {
  return page.evaluate(async ([pageId, title, notify]) => {
    const post = (n, body) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    const chunk = await post('fetchRecords', { requests: [{ pointer: { table: 'block', id: pageId } }] });
    const p = chunk.recordMap.block[pageId].value.value ?? chunk.recordMap.block[pageId].value;
    const bid = crypto.randomUUID();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: p.space_id, operations: [
      { pointer: { table: 'block', id: bid, spaceId: p.space_id }, path: [], command: 'set', args: { id: bid, type: 'text', parent_id: pageId, parent_table: 'block', space_id: p.space_id, alive: true, properties: { title } } },
      { pointer: { table: 'block', id: pageId, spaceId: p.space_id }, path: ['content'], command: 'listAfter', args: { id: bid } },
    ] }] });
    await post('notifyMentions', { blockId: bid, ...notify });
    return bid;
  }, [pageId, title, notify]);
}

try {
  const A = await mk();
  const B = await mk();
  const id = uniq();
  const a = await apiLogin(A, { email: `ann${id}@test.dev`, name: 'Ann Owner', workspace: 'Inbox Fix' });
  const spaceId = a.spaceId;
  const bEmail = `ben${id}@test.dev`;
  await call(A, 'inviteMembers', { spaceId, emails: [bEmail], role: 'editor' });
  const b = await apiLogin(B, { email: bEmail, name: 'Ben Member', createWorkspace: false });
  const pageId = await createPrivatePage(A, spaceId, 'Launch plan');
  await call(A, 'invitePagePermissions', { pageId, userIds: [b.userId], role: 'editor' });
  const blockId = await A.evaluate(async ([pageId, spaceId]) => {
    const post = (n, body) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    const bid = crypto.randomUUID();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: bid, spaceId }, path: [], command: 'set', args: { id: bid, type: 'text', parent_id: pageId, parent_table: 'block', space_id: spaceId, alive: true, properties: { title: [['Ship date: Friday']] } } },
      { pointer: { table: 'block', id: pageId, spaceId }, path: ['content'], command: 'listAfter', args: { id: bid } },
    ] }] });
    return bid;
  }, [pageId, spaceId]);

  // B comments on the line and mentions Ann; a group with Ann is mentioned in the page text
  const did = await comment(B, blockId, 'Can we ship Thursday instead?', a.userId);
  const { group } = await call(A, 'createGroup', { spaceId, name: 'Design', memberIds: [a.userId] });
  await mentionBlock(B, pageId, [['Heads up '], ['‣', [['g', group.id, spaceId]]]], { groupIds: [group.id] });

  await A.goto(A.url());
  await A.waitForSelector('nav.lit-sidebar-container');
  const badge = await waitFor(async () => (await A.locator('nav .nc-sb-badge').first().textContent().catch(() => ''))?.trim());
  r.ok(!!badge && Number(badge) >= 2, `Inbox badge counts the new notifications (${badge})`);
  await A.keyboard.press('Meta+Alt+u');
  await A.waitForSelector('.nc-inbox-row');
  const rows = A.locator('.nc-inbox-row');
  const groupRow = rows.filter({ hasText: 'tagged your group on' });
  r.ok(await waitFor(() => groupRow.count()) >= 1, 'a group mention reads "tagged your group on"');
  r.ok(/Heads up @Design/.test(await groupRow.first().textContent() ?? ''), '…quoting the line with "@Design"');
  // a mention inside a comment: "Ben Member tagged you in Launch plan" + the comment, with the thread's actions
  const threadRow = rows.filter({ hasText: 'tagged you in' }).filter({ hasText: 'Can we ship Thursday instead?' }).first();
  r.ok(await threadRow.count() === 1, 'the comment mention shows in the Inbox with the comment');
  r.ok(/Can we ship Thursday instead\? @Ann Owner/.test(await threadRow.textContent() ?? ''), 'the quote resolves the mention ("@Ann Owner")');
  await A.screenshot({ path: `${OUT}/10-inbox.png` });

  // Resolve / Reopen from the Inbox
  await threadRow.hover();
  const resolveBtn = threadRow.locator('.nc-inbox-resolve-btn');
  r.ok(await resolveBtn.count() === 1 && /Resolve/.test(await resolveBtn.textContent() ?? ''), 'the thread offers Resolve');
  await resolveBtn.click();
  const resolved = async () => {
    const res = await call(A, 'fetchRecords', { requests: [{ pointer: { table: 'discussion', id: did } }] });
    const d = res.recordMap?.discussion?.[did];
    return (d?.value?.value ?? d?.value)?.resolved;
  };
  r.ok(await waitFor(async () => (await resolved()) === true), 'Resolve from the Inbox resolves the thread');
  r.ok(await waitFor(async () => /Reopen/.test(await threadRow.locator('.nc-inbox-resolve-btn').textContent().catch(() => '') ?? '')), '…and the button turns into Reopen');
  await threadRow.hover();
  await threadRow.locator('.nc-inbox-resolve-btn').click();
  r.ok(await waitFor(async () => (await resolved()) === false), 'Reopen from the Inbox re-opens it');

  // Mentions filter keeps the mention items only
  const typeItem = (label) => A.locator('.nc-inbox-filter-menu [role="menuitemcheckbox"]').filter({ has: A.locator('.nc-menu-label', { hasText: new RegExp(`^${label}$`) }) }).first();
  const OTHERS = ['Access', 'Discussions', 'Automations & runs', 'Updates', 'Workspace'];
  await A.click('[aria-label="Filter notifications"]');
  await A.waitForSelector('.nc-inbox-filter-menu');
  for (const label of OTHERS) await typeItem(label).click();
  await A.keyboard.press('Escape');
  await A.waitForTimeout(500);
  const texts = await A.locator('.nc-inbox-row .nc-inbox-headline').allTextContents();
  r.ok(texts.length > 0 && texts.every((x) => /tagged/.test(x)), `Mentions filter shows mention items only (${texts.length})`);
  await A.click('[aria-label="Filter notifications"]');
  await A.waitForSelector('.nc-inbox-filter-menu');
  for (const label of OTHERS) await typeItem(label).click();
  await A.keyboard.press('Escape');

  // clicking the comment notification opens the page on that thread
  await A.waitForTimeout(300);
  await threadRow.locator('.nc-inbox-link').click();
  r.ok(await waitFor(() => A.url().includes(`d=${did.replace(/-/g, '')}`)), 'the notification opens the page with the thread (?d=)');
  r.ok(await waitFor(() => A.locator(`[data-block-id="${blockId}"]`).count()), 'the commented line is on screen');
  r.ok(await waitFor(() => A.locator('.nc-discussion-popover:not(.composer)').count(), { timeout: 6000 }) > 0, '…and its thread opens');
  r.ok(/Can we ship Thursday instead\?/.test(await A.locator('.nc-discussion-popover').first().textContent().catch(() => '') ?? ''), 'the opened thread shows the comment');
  await A.screenshot({ path: `${OUT}/11-inbox-open-thread.png` });
} catch (e) {
  console.log('FAIL exception', e);
  process.exitCode = 1;
} finally {
  r.done();
  await browser.close();
}

// Shell: Inbox extras: grouping per page, "N discussions" expand, inline reply, grouped
// mentions, Person-property assignment items, database "Notify me › All updates",
// More › Archive read. Three users in one workspace (A owner; B, C members), one Chrome, two contexts.
// Run: NC_BASE=http://127.0.0.1:5441 node e2e/shell-inbox-extra.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { CHROME } from './lib.mjs';
import { apiLogin, call, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/inbox-extra';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return p;
};

/** A new discussion (or a reply) with one comment, then the server-side fan-out — what the comments UI does. */
function comment(page, blockId, text, discussionId = null, mentionUserId = null) {
  return page.evaluate(async ([blockId, text, discussionId, mention]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const uid = Object.keys(uc.recordMap.user_root)[0];
    const chunk = await post('fetchRecords', { requests: [{ pointer: { table: 'block', id: blockId } }] });
    const b = chunk.recordMap.block[blockId].value.value ?? chunk.recordMap.block[blockId].value;
    const did = discussionId ?? crypto.randomUUID();
    const cid = crypto.randomUUID();
    const now = Date.now();
    const rich = mention ? [[text + ' '], ['‣', [['u', mention]]]] : [[text]];
    const ops = [];
    if (!discussionId) {
      ops.push({ pointer: { table: 'discussion', id: did, spaceId: b.space_id }, path: [], command: 'set', args: { id: did, parent_id: blockId, parent_table: 'block', resolved: false, comments: [], space_id: b.space_id, alive: true, type: 'page', created_by_id: uid, created_time: now } });
      ops.push({ pointer: { table: 'block', id: blockId, spaceId: b.space_id }, path: ['discussions'], command: 'listAfter', args: { id: did } });
    }
    ops.push({ pointer: { table: 'comment', id: cid, spaceId: b.space_id }, path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: rich, created_by_id: uid, created_time: now, last_edited_time: now, alive: true, space_id: b.space_id } });
    ops.push({ pointer: { table: 'discussion', id: did, spaceId: b.space_id }, path: ['comments'], command: 'listAfter', args: { id: cid } });
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: b.space_id, operations: ops }] });
    await post('notifyComment', { commentId: cid });
    return did;
  }, [blockId, text, discussionId, mentionUserId]);
}

try {
  const A = await mk();
  const B = await mk();
  const id = uniq();
  const a = await apiLogin(A, { email: `ann${id}@test.dev`, name: 'Ann Owner', workspace: 'Inbox Co' });
  const spaceId = a.spaceId;
  const bEmail = `ben${id}@test.dev`;
  const cEmail = `cat${id}@test.dev`;
  await call(A, 'inviteMembers', { spaceId, emails: [bEmail, cEmail], role: 'editor' });
  const b = await apiLogin(B, { email: bEmail, name: 'Ben Member', createWorkspace: false });
  const pageId = await createPrivatePage(A, spaceId, 'Roadmap');
  await call(A, 'invitePagePermissions', { pageId, userIds: [b.userId], role: 'editor' });

  // B: two threads; C (logged in later in the same context as B) replies to one
  const t1 = await comment(B, pageId, 'Can we move the launch?');
  await comment(B, pageId, 'Budget looks off');
  const c = await apiLogin(B, { email: cEmail, name: 'Cat Member', createWorkspace: false });
  await call(A, 'invitePagePermissions', { pageId, userIds: [c.userId], role: 'editor' });
  await comment(B, pageId, 'Agree with Ben', t1);
  // mentions: B and C mention Ann in page text
  for (const who of [cEmail, bEmail]) {
    if (who === bEmail) await apiLogin(B, { email: bEmail, name: 'Ben Member', createWorkspace: false });
    await B.evaluate(async ([pageId, mention, text]) => {
      const post = (n, body) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
      const chunk = await post('fetchRecords', { requests: [{ pointer: { table: 'block', id: pageId } }] });
      const p = chunk.recordMap.block[pageId].value.value ?? chunk.recordMap.block[pageId].value;
      const bid = crypto.randomUUID();
      await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: p.space_id, operations: [
        { pointer: { table: 'block', id: bid, spaceId: p.space_id }, path: [], command: 'set', args: { id: bid, type: 'text', parent_id: pageId, parent_table: 'block', space_id: p.space_id, alive: true, properties: { title: [[text + ' '], ['‣', [['u', mention]]]] } } },
        { pointer: { table: 'block', id: pageId, spaceId: p.space_id }, path: ['content'], command: 'listAfter', args: { id: bid } },
      ] }] });
      await post('notifyMentions', { blockId: bid, userIds: [mention] });
    }, [pageId, a.userId, who === bEmail ? 'Ben pinging' : 'Cat pinging']);
  }

  await A.reload();
  await A.waitForSelector('nav.lit-sidebar-container');
  await A.click('nav [aria-label="Inbox"]');
  await A.waitForSelector('.nc-inbox-row');
  await A.waitForTimeout(600);
  const grouped = A.locator('.nc-inbox-row[data-notification-type="comment"]');
  r.ok(await grouped.count() === 1, `comments on one page are one item (${await grouped.count()})`);
  const g = grouped.first();
  r.ok(Number(await g.getAttribute('data-count')) === 3, `group holds 3 notifications (${await g.getAttribute('data-count')})`);
  const gh = await g.locator('.nc-inbox-headline').textContent();
  r.ok(/Cat Member\s+and\s+Ben Member\s*added comments to\s*Roadmap/.test(gh ?? ''), `grouped headline "${gh}"`);
  r.ok(/2 discussions/.test(await g.textContent() ?? ''), '"2 discussions" footer');
  await g.locator('.nc-inbox-threads-toggle').click();
  r.ok(await g.locator('.nc-inbox-thread').count() === 2, 'expanding shows both threads');
  const mentions = A.locator('.nc-inbox-row[data-notification-type="mention"]');
  r.ok(await mentions.count() === 1 && /Ben Member,\s*Cat Member\s*tagged you in/.test(await mentions.first().locator('.nc-inbox-headline').textContent() ?? ''), `mentions grouped: "${await mentions.first().locator('.nc-inbox-headline').textContent()}"`);
  await A.screenshot({ path: `${OUT}/01-grouped.png` });

  // inline reply
  await g.hover();
  await g.locator('.nc-inbox-reply-btn').click();
  await A.waitForSelector('.nc-inbox-reply-composer [contenteditable]');
  await A.keyboard.type('Thanks, on it');
  await A.keyboard.press('Enter');
  const replied = await waitFor(async () => {
    const d = await call(A, 'getPageDiscussions', { pageId });
    const cs = Object.values(d.recordMap?.comment ?? {}).map((e) => e.value.value ?? e.value);
    return cs.some((x) => JSON.stringify(x.text).includes('Thanks, on it'));
  });
  r.ok(!!replied, 'inline reply posted to the thread');
  await A.screenshot({ path: `${OUT}/02-replied.png` });

  // Person property assignment → Ben's Inbox
  const db = await A.evaluate(async ([spaceId, uid, ben]) => {
    const post = (n, body) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const dbId = crypto.randomUUID();
    const colId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: dbId, spaceId }, path: [], command: 'set', args: { id: dbId, type: 'collection_view_page', collection_id: colId, view_ids: [], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }, { type: 'user_permission', role: 'read_and_write', user_id: ben }] } },
      { pointer: { table: 'collection', id: colId, spaceId }, path: [], command: 'set', args: { id: colId, name: [['Tasks']], schema: { title: { name: 'Name', type: 'title' }, who: { name: 'Assignee', type: 'person' }, st: { name: 'Status', type: 'status' } }, parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: dbId } },
      { pointer: { table: 'block', id: rowId, spaceId }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: colId, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['Write launch post']] } } },
    ] }] });
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'block', id: rowId, spaceId }, path: ['properties', 'who'], command: 'set', args: [['‣', [['u', ben]]]] }] }] });
    return { rowId };
  }, [spaceId, a.userId, b.userId]);
  await B.reload();
  await B.waitForSelector('nav.lit-sidebar-container');
  await B.click('nav [aria-label="Inbox"]');
  const assign = B.locator('.nc-inbox-row[data-notification-type="property_mention"]').first();
  await assign.waitFor();
  const at = await assign.textContent();
  r.ok(/Ann Owner\s*tagged you in\s*Write launch post/.test(at ?? '') && /Assignee/.test(at ?? ''), `assignment item: "${at?.slice(0, 90)}"`);
  await B.screenshot({ path: `${OUT}/03-assignment.png` });

  // B: Notify me › All updates on the row (hover bell), then Ann changes the status → "changed a property"
  await assign.hover();
  await assign.locator('[aria-label="Adjust how this page notifies you"]').click();
  await B.click('.lit-overlay-container [role=option]:has-text("All updates")');
  await B.waitForTimeout(500);
  await A.evaluate(async ([spaceId, rowId]) => {
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'block', id: rowId, spaceId }, path: ['properties', 'title'], command: 'set', args: [['Write the launch post']] }] }] }) });
  }, [spaceId, db.rowId]);
  const upd = B.locator('.nc-inbox-row[data-notification-type="page_edit"]').first();
  await upd.waitFor({ timeout: 8000 });
  r.ok(/changed a property in/.test(await upd.textContent() ?? ''), `"All updates" item: "${(await upd.textContent())?.slice(0, 80)}"`);

  // Archive read
  await upd.hover();
  await upd.locator('[aria-label="Set notification to read"]').click();
  await B.waitForTimeout(800);
  await B.click('.nc-inbox-panel [aria-label="More actions"]');
  await B.click('.lit-overlay-container [role=option]:has-text("Archive read")');
  await B.waitForTimeout(1200);
  r.ok(await B.locator('.nc-inbox-row[data-notification-type="page_edit"]').count() === 0, 'Archive read removes read items');
  r.ok(await B.locator('.nc-inbox-row[data-notification-type="property_mention"]').count() === 1, 'unread items stay');
} catch (e) {
  console.log('FAIL exception', e.message.slice(0, 800));
  process.exitCode = 1;
} finally {
  await browser.close();
  r.done();
}

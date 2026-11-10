// Comments & discussions E2E (CMT-*): inline comment from a text selection (⌘⇧M → 470px composer under
// the selection), yellow highlight + "💬 N" badge, thread popover (480px) with reply, reaction, resolve /
// reopen, topbar Comments → Discussions popover → See all → "All discussions" panel, page-level comment,
// @mention of a second workspace member → their Inbox notification.
import { launch, BASE } from './lib.mjs';
import { createPage, invite, reporter, selectText, shot, signupAny } from './page-lib.mjs';

const { check, finish } = reporter();
const stamp = Date.now();
const emailA = `cmt-a-${stamp}@test.dev`;
const emailB = `cmt-b-${stamp}@test.dev`;

const A = await launch();
let B = null;
const page = A.page;
try {
  await signupAny(page, emailA, 'Ada Author', 'Comment Co');
  const url = await createPage(page, 'Comments Lab', ['Commentable text lives here for inline comments.', 'Second paragraph without comments.']);

  // --- inline comment on a selection
  await selectText(page, 'Commentable');
  await page.keyboard.press('Meta+Shift+M');
  await page.waitForSelector('.nc-discussion-popover.composer .nc-comment-input', { timeout: 5000 });
  await page.waitForTimeout(300);
  const comp = await page.$eval('.nc-discussion-popover.composer', (el) => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
  check('composer popover 470 wide', comp.w === 470, JSON.stringify(comp));
  const sendDisabled = await page.getAttribute('.nc-discussion-popover.composer .nc-comment-send', 'aria-disabled');
  check('send disabled while empty', sendDisabled === 'true');
  await shot(page, 'c01-inline-composer');
  await page.keyboard.type('Is this wording right?');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lit-page-content [data-discussion-id]', { timeout: 5000 });
  const hl = await page.$eval('.lit-page-content [data-discussion-id]', (el) => ({ text: el.textContent, bg: getComputedStyle(el).backgroundColor, bb: getComputedStyle(el).borderBottomColor }));
  check('highlight on commented text', hl.text === 'Commentable', JSON.stringify(hl));
  check('highlight colors', hl.bg.includes('255, 203, 0') && hl.bb.includes('255, 203, 0'), `${hl.bg} / ${hl.bb}`);
  await page.waitForSelector('.nc-margin-chip', { timeout: 5000 });
  check('comment badge "1"', (await page.textContent('.nc-margin-chip')).trim() === '1');
  await shot(page, 'c02-highlight-badge');

  // --- thread popover: click the highlight
  await page.click('.lit-page-content [data-discussion-id]');
  await page.waitForSelector('.nc-discussion-popover .nc-discussion.mode-popover', { timeout: 5000 });
  await page.waitForTimeout(300); // pop-in animation
  const pop = await page.$eval('.nc-discussion-popover', (el) => Math.round(el.getBoundingClientRect().width));
  check('thread popover 480 wide', pop === 480, String(pop));
  check('thread shows context quote', (await page.textContent('.nc-discussion-popover .nc-discussion-context')).includes('Commentable'));
  check('relative time "Just now"', (await page.textContent('.nc-discussion-popover .nc-comment-time')).includes('Just now'));
  await page.click('.nc-discussion-popover .nc-comment-input');
  await page.keyboard.type('Yes, looks good.');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('.nc-discussion-popover .nc-comment').length === 2, null, { timeout: 5000 });
  check('reply added', true);
  await page.hover('.nc-discussion-popover .nc-comment >> nth=0');
  await page.waitForTimeout(200);
  const actions = await page.$$eval('.nc-discussion-popover .nc-comment >> nth=0', () => []).catch(() => []);
  const toolbar = await page.locator('.nc-discussion-popover .nc-comment').first().locator('.nc-comment-actions [role=button]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check('hover actions', toolbar.join('|') === 'Add reaction|Resolve|More actions', toolbar.join('|') || String(actions.length));
  await shot(page, 'c03-thread-popover');
  // reaction
  await page.locator('.nc-discussion-popover .nc-comment').first().locator('.nc-comment-actions [aria-label="Add reaction"]').click();
  await page.waitForSelector('.nc-icon-picker, .nc-emoji-quick, [role=gridcell]', { timeout: 5000 });
  await page.locator('.lit-overlay-container [role=gridcell]').first().click();
  await page.waitForSelector('.nc-discussion-popover .nc-reaction:not(.add)', { timeout: 5000 });
  check('reaction pill', (await page.textContent('.nc-discussion-popover .nc-reaction:not(.add) .count')).trim() === '1');
  // resolve
  await page.hover('.nc-discussion-popover .nc-comment >> nth=0');
  await page.locator('.nc-discussion-popover .nc-comment').first().locator('.nc-comment-actions [aria-label="Resolve"]').click();
  await page.waitForTimeout(500);
  const resolvedBg = await page.$eval('.lit-page-content [data-discussion-id]', (el) => getComputedStyle(el).backgroundColor);
  check('resolved: highlight removed', !resolvedBg.includes('255, 203, 0'), resolvedBg);
  check('resolved: badge gone', !(await page.isVisible('.nc-margin-chip')));
  await page.keyboard.press('Escape');

  // --- page-level comment (Add comment under the title)
  await page.hover('.nc-page-title');
  await page.click('.lit-page-controls >> text=Add comment');
  await page.waitForSelector('.nc-page-discussions .nc-comment-input');
  await page.keyboard.type('Page-level note');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.nc-page-discussions')?.textContent.includes('Page-level note'), null, { timeout: 5000 });
  check('page comment', true);

  // --- topbar Comments → Discussions popover → See all → sidebar
  await page.waitForSelector('.lit-topbar-comments-button', { timeout: 5000 });
  const order = await page.$$eval('.lit-topbar-action-buttons [role=button][aria-label]', (els) => els.map((e) => e.getAttribute('aria-label')).filter((l) => ['Share', 'Copy link', 'Comments', 'Favorite', 'Actions'].includes(l)));
  check('topbar order', order.join('|') === 'Share|Copy link|Comments|Favorite|Actions', order.join('|'));
  await page.click('.lit-topbar-comments-button');
  await page.waitForSelector('.nc-discussions-popover', { timeout: 5000 });
  await page.waitForTimeout(300);
  check('discussions popover 456', Math.round(await page.$eval('.nc-discussions-popover', (e) => e.getBoundingClientRect().width)) === 456);
  await shot(page, 'c04-discussions-popover');
  await page.click('.nc-discussions-popover .see-all');
  await page.waitForSelector('.lit-update-sidebar .nc-comments-sidebar', { timeout: 5000 });
  const panelW = await page.$eval('.lit-update-sidebar', (e) => Math.round(e.getBoundingClientRect().width));
  check('sidebar 385 wide', panelW === 385, String(panelW));
  check('sidebar title', (await page.textContent('.nc-comments-sidebar-bar .title')).trim() === 'All discussions');
  check('frame actions moved to panel', !(await page.isVisible('.lit-frame .lit-topbar-action-buttons')) && await page.isVisible('.nc-right-panel-topbar .lit-topbar-share-menu'));
  await shot(page, 'c05-all-discussions');
  // filter → Resolved → reopen
  await page.click('.nc-comments-sidebar-bar [aria-label="Filter"]');
  await page.click('.lit-overlay-container [role=option] >> text=Resolved');
  await page.waitForTimeout(300);
  check('resolved filter shows thread', (await page.textContent('.nc-comments-sidebar')).includes('Is this wording right?'));
  await page.click('.nc-comments-sidebar .nc-link-btn >> text=Reopen');
  await page.waitForTimeout(500);
  check('reopened: badge back', await page.isVisible('.nc-margin-chip'));
  await page.click('.nc-right-panel-topbar [aria-label="Close panel"]');

  // --- @mention a second member → notification
  await invite(page, emailB);
  await page.keyboard.press('Escape');
  B = await launch();
  await signupAny(B.page, emailB, 'Ben Builder', 'Ben Space');
  await page.waitForTimeout(500);
  await page.hover('.nc-page-title');
  await page.click('.lit-page-controls >> text=Add comment').catch(() => {});
  await page.click('.nc-page-discussions .nc-comment-input');
  await page.keyboard.type('Hey @Ben');
  await page.waitForSelector('.lit-overlay-container [role=option]', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await page.keyboard.type('please review');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  check('mention rendered', await page.isVisible('.nc-page-discussions .lit-user-mention-token'));
  await shot(page, 'c06-mention');
  await B.page.goto(url);
  await B.page.waitForSelector('.nc-page-title', { timeout: 15000 });
  const n = await B.page.evaluate(async (pageUrl) => {
    const post = async (name, body) => {
      const r = await fetch(`/api/rpc/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      return r.ok ? r.json() : null;
    };
    const hex = pageUrl.match(/([0-9a-f]{32})(?:[?#].*)?$/)?.[1];
    if (!hex) return 'no page id';
    const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const chunk = await post('loadPage', { pageId: id });
    const spaceId = chunk?.recordMap?.block?.[id]?.spaceId;
    const inbox = await post('getInbox', { spaceId, status: 'all' });
    const notes = Object.values(inbox?.recordMap?.notification ?? {}).map((x) => x.value.value);
    return notes.some((x) => x.type === 'mention') ? true : JSON.stringify(notes.map((x) => x.type));
  }, url);
  check('mention notification for B', n === true, String(n));
  await shot(B.page, 'c07-b-view');
} catch (e) {
  console.log('E2E ERROR', e.message);
  await shot(page, 'c-error').catch(() => {});
  check('exception', false, e.message);
} finally {
  await A.browser.close();
  if (B) await B.browser.close();
  finish();
}

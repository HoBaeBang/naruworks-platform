// Suggested edits: page ••• ›
// Suggest edits → "Suggesting ×" pill; typing → blue suggested insertion + "1 suggestion" margin badge + card
// "Add: “…”" with Accept / Reject; deletions strike, replacements, ⌘B format suggestions; Accept all / Reject all; a
// commenter suggests (server allows only suggestions), the owner sees it live and accepts; locked pages take none.
// One Chrome, two contexts. Run: NC_BASE=http://127.0.0.1:5461 node e2e/editor-suggest.mjs
import { launch, signup, BASE } from './lib.mjs';
import { check, failed, shot, type, newPage, MOD, selectInFocused, lineEnd } from './editor-lib.mjs';

const { browser, page: a } = await launch();
const ctxB = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
const b = await ctxB.newPage();
b.on('pageerror', (e) => console.log('[pageerror B]', e.message));
const wait = (p, ms) => p.waitForTimeout(ms);

const title = (p, text) => p.evaluate((x) => {
  const { records } = window.__ncEditor ?? { records: globalThis.__records };
  const blk = records.all('block').find((r) => r.alive !== false && (r.properties?.title ?? []).map((d) => d[0]).join('').startsWith(x));
  return blk ? { id: blk.id, title: blk.properties.title, discussions: blk.discussions ?? [] } : null;
}, text);
const discussion = (p, id) => p.evaluate((x) => (window.__ncEditor?.records ?? globalThis.__records).get('discussion', x), id);
const plain = (rt) => (rt ?? []).map((d) => d[0]).join('');
const ids = (rt, key) => [...new Set((rt ?? []).flatMap((d) => (d[1] ?? []).filter((x) => x[0] === key).map((x) => x[1])))];

async function openPageMenuItem(p, label) {
  await p.locator('.lit-topbar-more-button').click();
  await wait(p, 300);
  await p.locator('.lit-overlay-container [role="option"]', { hasText: label }).first().click();
  await wait(p, 300);
}
async function caretToEnd(p, text) {
  await p.locator('[data-content-editable-leaf]', { hasText: text }).first().click();
  await lineEnd(p);
  await wait(p, 100);
}

try {
  const ts = Date.now();
  const emailB = `suggestb${ts}@test.dev`;
  await signup(a, `suggesta${ts}@test.dev`, 'Owner A', 'Suggest Co');
  const pageId = await newPage(a, 'Suggest test');
  await type(a, 'Final paragraph.');
  await a.keyboard.press('Enter');
  await type(a, 'Second line here.');
  await wait(a, 400);

  // ---- enter suggest mode from the page menu
  await openPageMenuItem(a, 'Suggest edits');
  check('topbar shows the "Suggesting" pill', (await a.locator('.nc-suggesting-pill', { hasText: 'Suggesting' }).count()) === 1);
  check('pill has "Stop suggesting"', (await a.locator('.nc-suggesting-pill [aria-label="Stop suggesting"]').count()) === 1);

  // ---- insertion
  await caretToEnd(a, 'Final paragraph.');
  await type(a, ' Suggested', 30);
  await wait(a, 600);
  let blk = await title(a, 'Final paragraph.');
  const sid = ids(blk?.title, 'si')[0];
  check('typing in suggest mode creates a suggested insertion', !!sid && plain(blk.title) === 'Final paragraph. Suggested', blk?.title);
  const span = a.locator('.lit-page-content .lit-suggestion-insert').first();
  const st = await span.evaluate((el) => ({ c: getComputedStyle(el).color, bb: getComputedStyle(el).borderBottom, text: el.textContent }));
  check('insertion rendered blue with a 2px underline (Litpage colours)', st.c === 'rgb(79, 70, 229)' && st.bb.startsWith('2px solid') && st.text === ' Suggested', st);
  const d0 = await discussion(a, sid);
  check('suggestion is a discussion of type "suggestion" on the block', d0?.type === 'suggestion' && blk.discussions.includes(sid), d0);
  await shot(a, 'suggest-inline');
  const chip = a.locator('.nc-margin-chip.suggestion').first();
  check('margin badge "1 suggested change"', (await chip.getAttribute('aria-label')) === '1 suggested change' && (await chip.innerText()).trim() === '1');
  await chip.click();
  await wait(a, 500);
  const change = (await a.locator('.nc-discussion-popover .nc-suggestion-change').first().innerText()).replace(/\s+/g, ' ');
  check('card says Add: “ Suggested”', change.includes('Add:') && change.includes('“ Suggested”'), change);
  await a.locator('.nc-discussion-popover .nc-comment').first().hover();
  await wait(a, 200);
  const acts = await a.locator('.nc-discussion-popover .nc-comment').first().locator('.nc-comment-actions [role=button]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check('hover toolbar Accept / Reject / Add reaction / More actions', acts.join('|') === 'Accept|Reject|Add reaction|More actions', acts.join('|'));
  await shot(a, 'suggest-card');
  await a.locator('.nc-discussion-popover [aria-label="Accept"]').first().click();
  await wait(a, 500);
  blk = await title(a, 'Final paragraph.');
  check('Accept applies the text', JSON.stringify(blk.title) === JSON.stringify([['Final paragraph. Suggested']]), blk.title);
  check('accepted thread is resolved (accepted)', (await discussion(a, sid))?.suggestion_status === 'accepted');
  await a.keyboard.press('Escape');

  // ---- deletion → Reject
  await caretToEnd(a, 'Second line here.');
  for (let i = 0; i < 5; i++) await a.keyboard.press('Backspace');
  await wait(a, 500);
  blk = await title(a, 'Second line');
  const rid = ids(blk?.title, 'sr')[0];
  check('Backspace suggests a deletion (text stays, struck)', !!rid && plain(blk.title) === 'Second line here.' && blk.title.some((d) => d[0] === 'here.'), blk?.title);
  check('struck text rendered with line-through', await a.locator('.lit-page-content .lit-suggestion-remove').first().evaluate((el) => getComputedStyle(el).textDecorationLine.includes('line-through')));
  await a.locator('.lit-page-content .lit-suggestion-remove').first().click();
  await wait(a, 500);
  await a.locator('.nc-discussion-popover .nc-comment').first().hover();
  await a.locator('.nc-discussion-popover [aria-label="Reject"]').first().click();
  await wait(a, 500);
  blk = await title(a, 'Second line');
  check('Reject keeps the original text', JSON.stringify(blk.title) === JSON.stringify([['Second line here.']]), blk.title);
  await a.keyboard.press('Escape');

  // ---- replacement + format suggestion, then Accept all from the sidebar
  await a.locator('[data-content-editable-leaf]', { hasText: 'Final paragraph. Suggested' }).first().click();
  await selectInFocused(a, 0, 5);
  await type(a, 'Last', 30);
  await wait(a, 500);
  blk = await title(a, 'Final');
  const rep = ids(blk?.title, 'si')[0];
  check('typing over a selection suggests a replacement', !!rep && plain(blk.title).startsWith('FinalLast'), blk?.title);
  await a.locator('[data-content-editable-leaf]', { hasText: 'Second line here.' }).first().click();
  await selectInFocused(a, 0, 6);
  await a.keyboard.press(`${MOD}+b`);
  await wait(a, 500);
  blk = await title(a, 'Second line');
  check('⌘B suggests bold (sa mark, not applied)', blk.title.some((d) => (d[1] ?? []).some((x) => x[0] === 'sa' && x[2][0] === 'b')) && !blk.title.some((d) => (d[1] ?? []).some((x) => x[0] === 'b')), blk.title);
  await a.locator('.lit-topbar-comments-button:visible').first().click();
  await wait(a, 300);
  await a.locator('.lit-overlay-container .see-all').click();
  await wait(a, 500);
  await a.locator('[data-testid="suggestions-review"] >> text=Accept all').click();
  await wait(a, 600);
  const t1 = await title(a, 'Last');
  const t2 = await title(a, 'Second');
  check('Accept all applies the replacement', plain(t1?.title) === 'Last paragraph. Suggested' && !ids(t1?.title, 'si').length && !ids(t1?.title, 'sr').length, t1?.title);
  check('Accept all applies the bold', JSON.stringify(t2?.title) === JSON.stringify([['Second', [['b']]], [' line here.']]), t2?.title);
  await shot(a, 'suggest-sidebar');
  await a.keyboard.press('Escape');
  await a.locator('.lit-topbar-comments-button:visible').first().click(); // close the comments panel
  await wait(a, 300);

  // ---- turn off suggesting: typing edits directly
  await a.locator('.nc-suggesting-pill:visible [aria-label="Stop suggesting"]').first().click();
  await wait(a, 200);
  check('pill gone after turning off', (await a.locator('.nc-suggesting-pill').count()) === 0);
  await caretToEnd(a, 'Last paragraph');
  await type(a, '!', 30);
  await wait(a, 400);
  blk = await title(a, 'Last paragraph');
  check('outside suggest mode edits are direct', JSON.stringify(blk.title) === JSON.stringify([['Last paragraph. Suggested!']]), blk.title);

  // ---- commenter B: joins the workspace, gets "Can comment" on the page
  const { code } = await a.evaluate(() => ({ code: globalThis.__records.all('space').find((x) => x.name === 'Suggest Co')?.invite_link_code }));
  await b.goto(`${BASE}/invite/${code}`);
  await b.waitForURL(/\/login/);
  await b.fill('#email', emailB);
  await b.click('button[type=submit]');
  await b.waitForSelector('#code');
  await b.fill('#code', (await b.locator('.nc-auth-hint b').textContent()).trim());
  await b.click('button[type=submit]');
  await b.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  const bId = await b.evaluate((e) => globalThis.__records.all('lit_user').find((u) => u.email === e)?.id, emailB);
  await a.evaluate(async ([pid, uid]) => {
    const { records } = window.__ncEditor;
    const blocks = await import('/src/lib/blocks.ts');
    const page = records.get('block', pid);
    blocks.run('test.share', (tx) => tx.set('block', pid, ['permissions'], [...(page.permissions ?? []), { type: 'user_permission', role: 'comment_only', user_id: uid }]));
  }, [pageId, bId]);
  await wait(a, 800);
  const url = a.url();
  await b.goto(url);
  await b.waitForSelector('[data-content-editable-leaf]', { timeout: 15000 });
  await wait(b, 800);
  check('commenter sees the "Suggesting" pill without ×', (await b.locator('.nc-suggesting-pill').count()) === 1 && (await b.locator('.nc-suggesting-pill [aria-label="Stop suggesting"]').count()) === 0);
  const editable = await b.locator('[data-content-editable-leaf]', { hasText: 'Last paragraph' }).first().getAttribute('contenteditable');
  check('commenter can type in text blocks (suggestions)', editable === 'plaintext-only', editable);
  await b.locator('[data-content-editable-leaf]', { hasText: 'Last paragraph' }).first().click();
  await lineEnd(b);
  await type(b, ' from B', 30);
  await wait(b, 1500);
  const onA = await title(a, 'Last paragraph');
  const bSid = ids(onA?.title, 'si')[0];
  check('commenter suggestion saved and visible to the owner live', !!bSid && plain(onA.title) === 'Last paragraph. Suggested! from B', onA?.title);
  const color = await a.locator(`.lit-page-content [data-suggestion-id~="${bSid}"]`).first().evaluate((el) => getComputedStyle(el).color).catch(() => '');
  check('another author\'s suggestion is drawn in their colour (not your blue)', !!color && color !== 'rgb(79, 70, 229)', color);
  await shot(a, 'suggest-commenter-live');
  // the new thread is unread for the owner — dot on the Comments button, "New" in the Discussions popup
  await a.waitForSelector('[data-testid="comments-unread-dot"]', { timeout: 8000 }).catch(() => {});
  check('owner\'s Comments button shows a "new" dot', (await a.locator('.lit-topbar-comments-button:visible [data-testid="comments-unread-dot"]').count()) === 1);
  await a.locator('.lit-topbar-comments-button:visible').first().click();
  await wait(a, 400);
  const popText = await a.locator('.nc-discussions-popover').innerText().catch(() => '');
  check('Discussions popup lists the new thread under "New" with an unread dot', /^New$/m.test(popText) && (await a.locator('.nc-discussions-popover .item.new .nc-comment-unread').count()) >= 1, popText);
  await shot(a, 'discussions-new');
  await a.keyboard.press('Escape');
  await wait(a, 200);
  // commenter: no Accept on own suggestion
  await b.locator('.nc-margin-chip.suggestion').first().click();
  await wait(b, 500);
  await b.locator('.nc-discussion-popover .nc-comment').first().hover();
  check('commenter cannot accept (no Accept button), can reject own', (await b.locator('.nc-discussion-popover [aria-label="Accept"]').count()) === 0 && (await b.locator('.nc-discussion-popover [aria-label="Reject"]').count()) === 1);
  await b.keyboard.press('Escape');
  // the server refuses a direct edit from the commenter
  const direct = await b.evaluate(async ([bid]) => {
    const res = await fetch('/api/rpc/applyChanges', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestId: 'x', transactions: [{ id: crypto.randomUUID(), spaceId: globalThis.__records.get('block', bid).space_id, operations: [{ pointer: { table: 'block', id: bid }, path: ['properties', 'title'], command: 'set', args: [['hacked']] }] }] }) });
    return res.status;
  }, [onA.id]);
  check('server refuses a commenter\'s direct text edit (403)', direct === 403, direct);
  // owner accepts B's suggestion; B sees the result
  await a.locator('.nc-margin-chip.suggestion').first().click();
  await wait(a, 500);
  await a.locator('.nc-discussion-popover .nc-comment').first().hover();
  await a.locator('.nc-discussion-popover [aria-label="Accept"]').first().click();
  await wait(a, 1200);
  const onB = await title(b, 'Last paragraph');
  check('accepted suggestion reaches the commenter in realtime', JSON.stringify(onB?.title) === JSON.stringify([['Last paragraph. Suggested! from B']]), onB?.title);
  await a.keyboard.press('Escape');
  const readAll = await a.evaluate((did) => globalThis.__records.all('notification').filter((n) => n.discussion_id === did).map((n) => n.read), bSid);
  check('opening the thread read its Inbox notification (shared read state)', readAll.length >= 1 && readAll.every(Boolean), readAll);

  // ---- locked page: no suggestions
  await openPageMenuItem(a, 'Lock page');
  await a.keyboard.press('Escape');
  await wait(b, 1200);
  const lockedEditable = await b.locator('[data-content-editable-leaf]', { hasText: 'Last paragraph' }).first().getAttribute('contenteditable');
  check('locked page: commenter can no longer suggest', lockedEditable === 'false', lockedEditable);

  // ---- owner notification ("suggested in")
  const notes = await a.evaluate(async (sid) => {
    const res = await fetch('/api/rpc/getInbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spaceId: sid, status: 'all' }), credentials: 'same-origin' });
    const json = await res.json();
    return Object.values(json.recordMap?.notification ?? {}).map((r) => r?.value?.value ?? r?.value ?? r).filter((n) => n?.activity?.kind === 'suggestion');
  }, await a.evaluate((pid) => window.__ncEditor.records.get('block', pid).space_id, pageId));
  check('page owner gets a "suggestion" inbox notification', notes.length >= 1 && /Add: “ from B”/.test(notes[0]?.activity?.text ?? ''), notes.map((n) => n.activity));
} catch (e) {
  check('no exception', false, String(e?.stack ?? e));
  await shot(a, 'suggest-error').catch(() => {});
} finally {
  await browser.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);

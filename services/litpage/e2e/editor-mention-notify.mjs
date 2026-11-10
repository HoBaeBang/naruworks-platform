// Person mention → Inbox: A mentions member B with "@" in a teamspace page and B gets a
// "mentioned you in" notification whose quote is the block text with "@Name"; a mention on a page B cannot see
// (A's Private page) does not notify. Two browsers, workspace joined through the invite link.
import { launch, signup, BASE } from './lib.mjs';
import { check, failed, shot, type, newPage } from './editor-lib.mjs';

const a = await launch();
const b = await launch();

/** B's mention notifications through the Inbox API (cookie session of B's browser). */
async function mentionsOfB(spaceId) {
  return b.page.evaluate(async (sid) => {
    const res = await fetch('/api/rpc/getInbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spaceId: sid, status: 'all' }), credentials: 'same-origin' });
    const json = await res.json();
    const all = Object.values(json.recordMap?.notification ?? {}).map((r) => r?.value?.value ?? r?.value ?? r);
    return all.filter((n) => n?.type === 'mention');
  }, spaceId);
}

try {
  const ts = Date.now();
  const emailB = `mentionb${ts}@test.dev`;
  await signup(a.page, `mentiona${ts}@test.dev`, 'Owner A', 'Mention Co');
  const { code, spaceId } = await a.page.evaluate(() => {
    const s = globalThis.__records.all('space').find((x) => x.name === 'Mention Co');
    return { code: s?.invite_link_code, spaceId: s?.id };
  });
  await b.page.goto(`${BASE}/invite/${code}`);
  await b.page.waitForURL(/\/login/);
  await b.page.fill('#email', emailB);
  await b.page.click('button[type=submit]');
  await b.page.waitForSelector('#code');
  const dev = await b.page.locator('.nc-auth-hint b').textContent();
  await b.page.fill('#code', dev.trim());
  await b.page.click('button[type=submit]');
  await b.page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  const bId = await b.page.evaluate((e) => globalThis.__records.all('lit_user').find((u) => u.email === e)?.id, emailB);
  check('member B joined the workspace', !!bId, bId);

  // A learns about the new member, then writes in a page of the shared teamspace
  await a.page.reload();
  await a.page.waitForSelector('nav.lit-sidebar-container');
  const row = a.page.locator('.lit-outliner-team').first();
  await row.hover();
  await row.locator('[aria-label="Create a page"]').click({ force: true });
  await a.page.waitForFunction(() => document.activeElement?.matches?.('h1[data-content-editable-leaf]'), null, { timeout: 15000 });
  await a.page.keyboard.type('Team notes');
  await a.page.keyboard.press('Enter');
  await a.page.waitForTimeout(200);
  await type(a.page, 'Ping @mentionb');
  await a.page.waitForTimeout(400);
  const menu = await a.page.locator('.lit-overlay-container').innerText().catch(() => '');
  check('@ menu lists member B under People', /People/.test(menu) && menu.includes('mentionb'), menu.slice(0, 200));
  await shot(a.page, 'mention-person-menu');
  await a.page.keyboard.press('Enter');
  await a.page.waitForTimeout(1500);
  let notes = await mentionsOfB(spaceId);
  check('B gets one "mention" notification', notes.length === 1, notes.length);
  check('notification quotes the block text with @name', /^Ping @/.test(notes[0]?.activity?.text ?? ''), notes[0]?.activity);
  check('notification points at the mentioning block', !!notes[0]?.navigable_block_id);

  // re-inserting right away does not spam (one per minute per block/author)
  await type(a.page, '@mentionb');
  await a.page.waitForTimeout(300);
  await a.page.keyboard.press('Enter');
  await a.page.waitForTimeout(1200);
  notes = await mentionsOfB(spaceId);
  check('repeat mention in the same block within a minute is not re-notified', notes.length === 1, notes.length);

  // a Private page of A: B has no access → no notification
  await newPage(a.page, 'Private notes');
  await type(a.page, 'Secret @mentionb');
  await a.page.waitForTimeout(400);
  await a.page.keyboard.press('Enter');
  await a.page.waitForTimeout(1500);
  notes = await mentionsOfB(spaceId);
  check('no notification for a page B cannot see', notes.length === 1, notes.length);
} catch (e) {
  console.log('E2E ERROR', e.stack);
  await shot(a.page, 'mention-notify-error');
} finally {
  await a.browser.close();
  await b.browser.close();
  console.log(failed() ? `${failed()} FAILED` : 'ALL PASSED');
  process.exitCode = failed() ? 1 : 0;
}

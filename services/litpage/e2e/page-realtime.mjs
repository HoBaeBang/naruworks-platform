// Realtime collaboration E2E (two browser contexts): A shares a page with B (Can edit); both open it.
// - B's typing appears live on A (and A's on B) without reload
// - presence: A's topbar facepile shows B; B's caret/selection is drawn on A's page with B's name flag
// - a second tab of the same user (A2) also receives edits live
// - comments sync: B's inline comment highlight + badge appear on A
import { launch } from './lib.mjs';
import { createPage, invite, reporter, selectText, shot, signupAny } from './page-lib.mjs';

const { check, finish } = reporter();
const stamp = Date.now();
const emailA = `rt-a-${stamp}@test.dev`;
const emailB = `rt-b-${stamp}@test.dev`;

const A = await launch();
let B = null;
const pa = A.page;
const waitText = (page, text, timeout = 6000) =>
  page.waitForFunction((t) => document.querySelector('.lit-page-content')?.textContent.includes(t), text, { timeout }).then(() => true, () => false);

try {
  await signupAny(pa, emailA, 'Ada Realtime', 'Live Co');
  const url = await createPage(pa, 'Realtime Lab', ['Shared starting text.']);
  await invite(pa, emailB);
  await pa.keyboard.press('Escape');

  B = await launch();
  const pb = B.page;
  await signupAny(pb, emailB, 'Ben Realtime', 'Ben Space');
  await pb.goto(url);
  await pb.waitForSelector('.lit-page-content [data-content-editable-leaf]', { timeout: 15000 });
  await waitText(pb, 'Shared starting text.');

  // --- B types → A sees it live
  await pb.click('.lit-page-content [data-content-editable-leaf] >> nth=0');
  await pb.keyboard.press('End');
  await pb.keyboard.press('Enter');
  await pb.keyboard.type('Hello from B');
  check('B edit appears on A', await waitText(pa, 'Hello from B'));

  // --- presence: facepile + remote caret on A while B is focused
  await pa.waitForTimeout(800);
  const faces = await pa.$$eval('.nc-facepile .nc-face', (els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('data-tooltip') || e.textContent));
  check('A facepile shows B', faces.some((f) => /Ben/.test(f ?? '')), faces.join(' / '));
  const caret = await pa.waitForSelector('.nc-presence-layer .nc-remote-caret', { timeout: 6000 }).then(() => true, () => false);
  check('A sees B caret', caret);
  if (caret) check('caret flag shows name', (await pa.textContent('.nc-presence-layer .nc-remote-flag')).includes('Ben'));
  await shot(pa, 'r01-a-sees-b');
  // B selects a word → A sees a selection rectangle
  await selectText(pb, 'starting');
  const selRect = await pa.waitForSelector('.nc-presence-layer .nc-remote-selection', { timeout: 6000 }).then(() => true, () => false);
  check('A sees B selection', selRect);
  await shot(pa, 'r02-remote-selection');

  // --- A types → B sees it
  await pa.click('.lit-page-content [data-content-editable-leaf] >> nth=0');
  await pa.keyboard.press('End');
  await pa.keyboard.press('Enter');
  await pa.keyboard.type('Answer from A');
  check('A edit appears on B', await waitText(pb, 'Answer from A'));
  await shot(pb, 'r03-b-sees-a');

  // --- same user, second tab
  const pa2 = await A.context.newPage();
  await pa2.goto(url);
  await pa2.waitForSelector('.lit-page-content [data-content-editable-leaf]', { timeout: 15000 });
  await pb.locator('.lit-page-content [data-content-editable-leaf]', { hasText: 'Hello from B' }).first().click();
  await pb.keyboard.press('End');
  await pb.keyboard.type(' (more)');
  check('second tab of A receives edits', await waitText(pa2, 'Answer from A') && await waitText(pa2, '(more)'));
  await pa2.close();

  // --- comments sync: B comments inline → highlight + badge on A
  await selectText(pb, 'Hello');
  await pb.keyboard.press('Meta+Shift+M');
  await pb.waitForSelector('.nc-discussion-popover.composer .nc-comment-input', { timeout: 5000 });
  await pb.keyboard.type('Live comment from B');
  await pb.keyboard.press('Enter');
  const hl = await pa.waitForSelector('.lit-page-content [data-discussion-id]', { timeout: 8000 }).then(() => true, () => false);
  check('A sees B comment highlight', hl);
  const badge = await pa.waitForSelector('.nc-margin-chip', { timeout: 8000 }).then(() => true, () => false);
  check('A sees comment badge', badge);
  await shot(pa, 'r04-a-sees-b-comment');
} catch (e) {
  console.log('E2E ERROR', e.message);
  await shot(pa, 'r-error').catch(() => {});
  check('exception', false, e.message);
} finally {
  await A.browser.close();
  if (B) await B.browser.close();
  finish();
}

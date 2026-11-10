// AI Meeting Notes end-to-end with a FAKE Web Speech API injected
// by page.addInitScript (never the real microphone or a network speech service) and the mock Anthropic API:
// sidebar New… › AI Meeting Notes → consent notice → Start (first-run consent choice, spoken consent message) → live
// interim + final lines with speakers → Pause / Resume → Stop → summary with citations (click → transcript line) and
// a generated title → Instructions dropdown (built-in) + Retry summary → Delete transcript → permission denied /
// unsupported browser states → Settings: workspace switch off (block disabled, /meet hidden + New… menu item hidden,
// Meetings tab hidden) and "Hide Meeting notes tab".
// node e2e/mtg-notes.mjs (own servers: API 3201, web 5521, mock 3202)
import { mkdirSync } from 'node:fs';
import { SHOTS_ROOT, appendLine, reporter, speechInitScript, startDevHarness } from './dev-harness.mjs';

const OUT = `${SHOTS_ROOT}/meetings`;
mkdirSync(OUT, { recursive: true });

const h = await startDevHarness({ key: true, env: { NC_MEETING_MIN_SUMMARY_CHARS: '40' } });
process.env.NC_BASE = h.base;
const { launch } = await import('./lib.mjs');
const { apiLogin, compact, createPrivatePage, uniq, waitFor } = await import('./ws-lib.mjs');

const r = reporter();
const { browser, context, page } = await launch();
await context.addInitScript(speechInitScript());
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
page.setDefaultTimeout(15000);
page.on('dialog', (d) => d.accept().catch(() => {}));
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    r.ok(false, `${name}: ${String(e?.message ?? e).split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});
  }
}
const block = () => page.locator('[data-testid="meeting-notes-block"]').first();
const toasts = () => page.locator('.nc-toast').allInnerTexts().catch(() => []);
const say = (text, opts) => page.evaluate(([t, o]) => window.__say(t, o), [text, opts ?? {}]);
async function openSettings(key) {
  if (!(await page.locator('.nc-set-dialog').count())) {
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector('.nc-set-dialog');
  }
  await page.click(`.nc-set-tab[data-settings-key="${key}"]`);
  await page.waitForTimeout(300);
}
async function closeSettings() {
  if (await page.locator('.nc-set-dialog').count()) await page.locator('.nc-set-close').click();
  await page.waitForTimeout(200);
}

const u = uniq();
let spaceId = '';
let meetingUrl = '';
try {
  ({ spaceId } = await apiLogin(page, { email: `mtg${u}@test.dev`, name: 'Ada Lovelace', workspace: `Meet Co ${u}` }));
  r.ok(!!spaceId, 'signed in');

  await step('new AI meeting note from the sidebar', async () => {
    await page.click('nav [aria-label="New page"]');
    await page.locator('.lit-overlay-container [role="option"]', { hasText: 'AI Meeting Notes' }).first().click();
    await block().waitFor();
    meetingUrl = page.url();
    r.ok(/Meeting-Notes/.test(meetingUrl), 'opened a new "Meeting Notes <date>" page with the block', meetingUrl);
    const consent = await block().locator('.nc-mtg-consent').textContent();
    r.ok(consent.includes('By starting, you confirm that everyone being transcribed has agreed.'), 'consent notice before starting');
    const tabs = await block().locator('[role="tab"]').allInnerTexts();
    r.ok(tabs.join('|') === 'Summary|Notes|Transcript', 'Summary · Notes · Transcript tabs', tabs);
    await shot('01-new-meeting-note');
  });

  await step('start → consent choice → live transcription', async () => {
    await block().locator('.nc-mtg-start', { hasText: 'Start transcribing' }).click();
    const nux = page.locator('.nc-mtg-nux');
    await nux.waitFor();
    r.ok((await nux.textContent()).includes('Pick how to let others know'), 'first start asks how to notify others');
    await shot('02-consent-choice');
    await nux.locator('button', { hasText: 'Start transcribing' }).click();
    await block().locator('[data-testid="meeting-recording"]').waitFor();
    const spoken = await waitFor(() => page.evaluate(() => window.__spoken.length > 0 && window.__spoken[0]), { timeout: 8000 });
    r.ok(spoken === 'This meeting is being transcribed by Litpage AI so it can take notes.', 'consent message spoken on start', spoken);
    await waitFor(() => page.evaluate(() => !!window.__fakeSpeech.current), { timeout: 8000 });
    const fs = await page.evaluate(() => ({ started: window.__fakeSpeech.started, lang: window.__fakeSpeech.langs[0] }));
    r.ok(fs.started === 1 && /^en/.test(fs.lang), 'recognizer started (continuous, browser language)', fs);
    await block().locator('[role="tab"]', { hasText: 'Transcript' }).click();
    await say('we need to', { interim: true });
    await block().locator('.nc-mtg-line.interim', { hasText: 'we need to' }).waitFor();
    r.ok(true, 'interim text shows live');
    await say('Welcome everyone to the launch planning sync', { speaker: 'Ada' });
    await say('We need to ship the beta by Friday and update the docs', { speaker: 'Ada' });
    await say('I will send the launch checklist today', { speaker: 'Lin' });
    const lines = await waitFor(async () => {
      const n = await block().locator('[data-testid="meeting-transcript"] .nc-mtg-line:not(.interim)').count();
      return n >= 2 ? n : 0;
    }, { timeout: 10000 });
    r.ok(lines >= 2, `transcript lines stored on the server (${lines} speaker runs)`);
    const who = await block().locator('[data-testid="meeting-transcript"] .nc-mtg-line .who').allInnerTexts();
    r.ok(who.some((w) => w.includes('Ada')) && who.some((w) => w.includes('Lin')) && who.every((w) => /\d\d:\d\d/.test(w)), 'speaker labels + timestamps', who);
    await shot('03-live-transcript');
  });

  await step('pause / resume', async () => {
    await block().locator('button[aria-label="Pause"]').click();
    await block().locator('button[aria-label="Resume"]').waitFor();
    r.ok(await say('this should not be captured') === false, 'paused: the recognizer is stopped');
    await block().locator('button[aria-label="Resume"]').click();
    await waitFor(() => page.evaluate(() => !!window.__fakeSpeech.current), { timeout: 8000 });
    r.ok(await page.evaluate(() => window.__fakeSpeech.started) === 2 && await page.evaluate(() => window.__spoken.length) === 2, 'resume restarts recognition and replays the consent message');
    await say('Lin owns the checklist and Ada reviews the docs', { speaker: 'Lin' });
    await page.waitForTimeout(1000);
  });

  await step('stop → summary with citations + title', async () => {
    await block().locator('.nc-mtg-stop').click();
    await block().locator('.nc-mtg-summary').waitFor({ timeout: 20000 });
    const summary = await block().locator('.nc-mtg-summary').innerText();
    r.ok(summary.includes('Discussion') && summary.includes('Action items') && summary.includes('Send the launch checklist'), 'summary from the AI service (mock)', summary.slice(0, 300));
    const chips = block().locator('.nc-mtg-summary a.lit-link-token[href^="#mtg-cite-"]');
    r.ok(await chips.count() >= 2, `citation chips (${await chips.count()})`);
    const title = await block().locator('input.nc-mtg-title').inputValue();
    r.ok(title === 'Launch planning sync', 'generated meeting title', title);
    r.ok(!summary.includes('this should not be captured'), 'nothing recorded while paused');
    await shot('04-summary');
    await chips.first().click();
    await block().locator('[data-testid="meeting-transcript"]').waitFor();
    const flashed = await waitFor(() => block().locator('.nc-mtg-line.flash').count(), { timeout: 3000 });
    r.ok(!!flashed, 'clicking a citation opens the transcript at that line');
    await shot('05-citation-jump');
  });

  await step('instructions dropdown + retry summary', async () => {
    await block().locator('[data-testid="meeting-instructions"]').click();
    const items = await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').allInnerTexts();
    r.ok(['Auto', 'Sales call', 'Standup', 'Team meeting', '1:1', 'Add your own instructions'].every((x) => items.some((i) => i.includes(x))), 'Auto, built-in instructions, Add your own instructions', items);
    await shot('06-instructions-menu');
    await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Team meeting' }).first().click();
    const label = await block().locator('[data-testid="meeting-instructions"] b').textContent();
    r.ok(label === 'Team meeting', 'block uses Team meeting', label);
    await page.locator('.nc-toast-action', { hasText: 'Retry summary' }).click();
    const redone = await waitFor(async () => (await block().locator('.nc-mtg-summary').innerText().catch(() => '')).includes('Instructions used: Team meeting'), { timeout: 20000 });
    r.ok(!!redone, 'Retry summary uses the new instructions');
  });

  await step('delete transcript', async () => {
    await block().locator('[aria-label="Options"]').click();
    await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Delete transcript' }).first().click();
    await page.locator('.nc-confirm .nc-dialog-btn.danger').click();
    await block().locator('[role="tab"]', { hasText: 'Transcript' }).click();
    const gone = await waitFor(async () => (await block().locator('.nc-mtg-panel').innerText()).includes('Transcript removed'), { timeout: 6000 });
    r.ok(!!gone, 'transcript deleted (summary kept)');
    await block().locator('[role="tab"]', { hasText: 'Summary' }).click();
    r.ok((await block().locator('.nc-mtg-summary').innerText()).includes('Action items'), 'summary still there');
  });

  await step('permission denied', async () => {
    await page.evaluate(() => { window.__fakeSpeech.mode = 'deny'; });
    await page.locator('[role="tab"][aria-label="Meetings"]').click();
    await page.locator('.nc-sb-shortcuts [role="button"][aria-label="Start meeting note"]').click();
    await page.waitForURL((url) => url.toString() !== meetingUrl);
    await block().waitFor();
    await block().locator('.nc-mtg-start', { hasText: 'Start transcribing' }).click();
    const t = await waitFor(async () => (await toasts()).find((x) => x.includes('Microphone permission is missing')), { timeout: 8000 });
    r.ok(!!t, 'not-allowed → "Microphone permission is missing…"');
    r.ok((await block().locator('[role="alert"]').innerText().catch(() => '')).includes('Microphone permission is missing'), 'banner in the block');
    const idle = await waitFor(async () => (await block().locator('[data-testid="meeting-recording"]').count()) === 0 && (await block().locator('.nc-mtg-start', { hasText: 'Start transcribing' }).count()) === 1, { timeout: 6000 });
    r.ok(!!idle, 'nothing started: the block offers “Start transcribing” again');
    await shot('07-permission-denied');
    await page.evaluate(() => { window.__fakeSpeech.mode = 'ok'; });
    await page.locator('[role="tab"][aria-label="Home"]').click().catch(() => {});
  });

  await step('unsupported browser', async () => {
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 800 }, storageState: await context.storageState() });
    await ctx2.addInitScript(speechInitScript({ unsupported: true }));
    const p2 = await ctx2.newPage();
    await p2.goto(meetingUrl);
    const b2 = p2.locator('[data-testid="meeting-notes-block"]').first();
    await b2.waitFor();
    // a finished meeting offers Resume; the browser check happens on start
    await b2.locator('.nc-mtg-start').first().click();
    const t = await waitFor(async () => (await p2.locator('.nc-toast').allInnerTexts()).find((x) => x.includes('isn’t supported in this browser')), { timeout: 8000 });
    r.ok(!!t, 'no SpeechRecognition → "Live transcription isn’t supported in this browser…"');
    await p2.screenshot({ path: `${OUT}/08-unsupported.png` }).catch(() => {});
    await ctx2.close();
  });

  await step('workspace switch off', async () => {
    await openSettings('meeting-notes');
    await page.locator('.nc-set-row[data-setting="meeting-notes-enabled"] input[role="switch"]').click();
    await page.waitForTimeout(500);
    await closeSettings();
    r.ok(await page.locator('[role="tab"][aria-label="Meetings"]').count() === 0, 'Meetings tab hidden while AI Meeting Notes is off');
    await page.goto(meetingUrl);
    await block().waitFor();
    r.ok(await block().locator('.nc-mtg-start[aria-disabled="true"]').count() + (await block().locator('.nc-mtg-start').count() === 0 ? 1 : 0) >= 1, 'block can’t start transcribing');
    // the New… menu leaves AI meeting notes out while the workspace has them off (no dead menu item)
    await page.click('nav [aria-label="New page"]');
    await page.locator('.lit-overlay-container [role="option"]', { hasText: /^\s*Page\s*$/ }).first().waitFor();
    r.ok(await page.locator('.lit-overlay-container [role="option"]', { hasText: 'AI Meeting Notes' }).count() === 0, 'New… › AI meeting notes not offered while off');
    await page.keyboard.press('Escape');
    // /meet in the editor
    const plain = await createPrivatePage(page, spaceId, `Plain ${u}`);
    const domain = await page.evaluate(() => location.pathname.split('/')[1]);
    await page.goto(`${h.base}/${domain}/Plain-${compact(plain)}`);
    await page.locator('h1[data-content-editable-leaf]').waitFor();
    await appendLine(page);
    // while the workspace has AI Meeting Notes off, "/meet" isn't offered at all (no dead menu item)
    await page.keyboard.type('/meet');
    await page.waitForTimeout(500);
    const offered = await page.locator('.nc-slash-menu [role="option"], .nc-slash-menu [role="menuitem"]', { hasText: 'AI Meeting Notes' }).count();
    await page.keyboard.press('Escape');
    r.ok(offered === 0 && await page.locator('[data-testid="meeting-notes-block"]').count() === 0, '/meet hidden while off (no block inserted)');
    await shot('09-workspace-off');
    await openSettings('meeting-notes');
    await page.locator('.nc-set-row[data-setting="meeting-notes-enabled"] input[role="switch"]').click();
    await page.waitForTimeout(500);
    await closeSettings();
    r.ok(await page.locator('[role="tab"][aria-label="Meetings"]').count() === 1, 'Meetings tab back when turned on again');
  });

  await step('hide Meeting notes tab (personal)', async () => {
    await openSettings('meeting-notes');
    await page.locator('.nc-set-row[data-setting="meeting-hide-tab"] .nc-set-dropdown').click();
    await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Always' }).first().click();
    await page.waitForTimeout(400);
    await closeSettings();
    r.ok(await page.locator('[role="tab"][aria-label="Meetings"]').count() === 0, 'Hide Meeting notes tab = Always hides it from my sidebar');
    await openSettings('meeting-notes');
    await page.locator('.nc-set-row[data-setting="meeting-hide-tab"] .nc-set-dropdown').click();
    await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Never' }).first().click();
    await page.waitForTimeout(400);
    await closeSettings();
    r.ok(await page.locator('[role="tab"][aria-label="Meetings"]').count() === 1, 'Never shows it again');
  });

  r.ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await browser.close().catch(() => {});
  h.stop();
  r.done('mtg-notes');
}

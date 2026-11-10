

// Run against the dev server (no openai / Anthropic settings): node e2e/ai-nokey.mjs
// or in an isolated server + Vite without a key: node e2e/ai-nokey.mjs --isolated
import { mkdirSync } from 'node:fs';

let harness = null;
if (process.argv.includes('--isolated')) {
  const { startHarness } = await import('./ai-harness.mjs');
  harness = await startHarness({ key: false, apiPort: 3113, webPort: 5413, dataDir: '/tmp/nc-e2e/wave3/ai/data' });
  process.env.NC_BASE = harness.base;
}
const { launch, signup } = await import('./lib.mjs');

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-ai';
mkdirSync(OUT, { recursive: true });
const NO_KEY = 'Connect an AI provider to use Litpage AI';
let failures = 0;

/** New page → title → Enter: leaves the caret in the first (empty) text block. */
async function newPageWithEmptyLine(page, title) {
  await page.click('[aria-label="New page"]');
  
  const item = await page.waitForSelector('.lit-overlay-container [role="option"]:has-text("Page")', { timeout: 1500 }).catch(() => null);
  if (item) await item.click();
  const h1 = await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(300);
  await h1.click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => {
    const a = document.activeElement;
    return !!a?.closest?.('.lit-page-content .lit-text-block') && a.textContent === '';
  }, null, { timeout: 5000 });
}
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};

const { browser, page } = await launch();
try {
  await signup(page, `ai-nokey-${Date.now()}@test.dev`, 'AI Tester', 'AI Lab');
  await page.waitForTimeout(600);

  // server: status + 400s
  // retries while the dev API server restarts (node --watch → the Vite proxy answers 502/503/504)
  const post = (path, body) => page.evaluate(async ([p, b]) => {
    for (let i = 0; ; i++) {
      const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
      if (r.status >= 502 && r.status <= 504 && i < 40) { await new Promise((ok) => setTimeout(ok, 500)); continue; }
      return { status: r.status, json: await r.json() };
    }
  }, [path, body]);
  const api = (name, body) => post(`/api/rpc/${name}`, body);
  const status = await api('aiStatus', {});
  if (status.json.configured) {
    console.log('A model provider is configured on this server; skipping no-key checks (use --isolated).');
    await browser.close();
    process.exit(0);
  }
  check(status.status === 200 && status.json.configured === false && status.json.message === NO_KEY, 'aiStatus reports not configured');
  for (const [name, body] of [['aiChat', { text: 'hello' }], ['aiAutofill', { rowId: 'x', propId: 'y', kind: 'summary' }], ['aiQuery', { query: 'x' }], ['aiComplete', { skill: 'improve', selection: 'x' }]]) {
    const r = await api(name, body);
    check(r.status === 400 && r.json.message === NO_KEY, `${name} → 400 "${r.json.message}"`);
  }
  const sse = await post('/api/ai/stream', { kind: 'chat', text: 'hi' });
  check(sse.status === 400 && sse.json.message === NO_KEY, `/api/ai/stream → 400 "${sse.json.message}"`);

  // floating AI button (bottom-right) on a page
  await page.click('text=Welcome to Litpage');
  await page.waitForSelector('.lit-page-content');
  await page.waitForTimeout(500);
  const btn = await page.$('.lit-ai-button');
  check(!!btn, 'floating AI button is rendered');
  const box = btn && (await btn.boundingBox());
  check(!!box && Math.abs(box.x + box.width - (1384 - 16)) <= 2 && Math.abs(box.y + box.height - (853 - 16)) <= 2 && box.width === 40, `AI button 40px at bottom/right 16px (${JSON.stringify(box)})`);
  await page.screenshot({ path: `${OUT}/nokey-01-page-button.png` });

  // panel
  await page.click('.lit-ai-button');
  await page.waitForSelector('.nc-ai-panel');
  await page.waitForTimeout(300);
  const panelText = await page.textContent('.nc-ai-panel');
  check(panelText.includes(NO_KEY), 'panel shows the connect-key banner');
  check(panelText.includes('What would you like to work on?'), 'panel shows the welcome title');
  await page.screenshot({ path: `${OUT}/nokey-02-panel.png` });
  await page.click('.nc-ai-panel [aria-label="Hide chat"]');

  // inline writer: Space on an empty line
  await newPageWithEmptyLine(page, 'AI no key page');
  await page.keyboard.press(' ');
  await page.waitForSelector('[data-testid="ai-inline-writer"]', { timeout: 3000 });
  await page.waitForTimeout(250);
  const writerText = await page.textContent('[data-testid="ai-inline-writer"]');
  check(writerText.includes(NO_KEY), 'inline writer (Space) shows the connect-key notice');
  const ph = await page.getAttribute('.nc-ai-writer-input', 'placeholder');
  check(ph === 'Ask AI a question…', `writer placeholder "${ph}"`);
  await page.screenshot({ path: `${OUT}/nokey-03-inline-writer.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check(!(await page.$('[data-testid="ai-inline-writer"]')), 'Escape closes the writer');
  // typing still works after closing: the empty line keeps working without AI
  await page.keyboard.type('plain text still works');
  await page.waitForTimeout(400);
  const blockTexts = await page.$$eval('.lit-page-content .lit-text-block', (els) => els.map((e) => e.innerText.trim()));
  check(blockTexts.some((t) => t.includes('plain text still works')), 'editing works without AI');

  // AI block via slash menu
  await page.keyboard.press('Enter');
  await page.keyboard.type('/AI Block');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid="ai-block"]', { timeout: 4000 });
  await page.waitForTimeout(500);
  const cfg = await page.$('.nc-ai-block-config');
  check(!!cfg, 'AI block opens its "Generate" settings');
  const cfgText = cfg ? await cfg.textContent() : '';
  check(cfgText.includes(NO_KEY), 'AI block settings show the connect-key notice');
  await page.screenshot({ path: `${OUT}/nokey-04-ai-block.png` });
  await page.keyboard.press('Escape');

  // full-page chat
  await page.click('[role="tab"][aria-label="Chat"]');
  await page.waitForTimeout(300);
  // the Chat tab switches the sidebar to "New chat" + "Chats"; the chat page opens from "New chat"
  if (!(await page.$('.nc-ai-landing'))) await page.click('nav.lit-sidebar-container >> text=New chat');
  await page.waitForSelector('.nc-ai-landing');
  await page.waitForTimeout(400);
  const landing = await page.textContent('.nc-ai-chat');
  check(landing.includes('What would you like to work on?') && landing.includes(NO_KEY), 'chat page landing shows the title and connect-key banner');
  check((await page.$$('[data-testid="ai-landing-page-prompt-category"]')).length === 4, 'four prompt pills');
  await page.screenshot({ path: `${OUT}/nokey-05-chat-page.png` });
  await page.click('.nc-ai-banner-link');
  await page.waitForSelector('.nc-ai-keyhelp');
  await page.screenshot({ path: `${OUT}/nokey-06-key-help.png` });
} catch (e) {
  failures++;
  console.log('E2E FAILED', e.message);
  await page.screenshot({ path: `${OUT}/nokey-error.png` });
} finally {
  await browser.close();
  harness?.stop();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

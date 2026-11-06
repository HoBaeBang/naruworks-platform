
// streamed chat (Markdown, citations from the search_workspace tool, workspace Q&A), stop / retry / copy,
// save & insert into pages, the floating panel, the inline writer (Space, ⌘J selection, topic skills),
// the AI block and database autofill. Runs in an isolated server + Vite (e2e/ai-harness.mjs).
//   node e2e/ai-mock.mjs
import { mkdirSync } from 'node:fs';
import { startHarness } from './ai-harness.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-ai';
mkdirSync(OUT, { recursive: true });
const h = await startHarness({ key: true, apiPort: 3113, webPort: 5413, mockPort: 3112, dataDir: '/tmp/nc-e2e/wave3/ai/data' });
process.env.NC_BASE = h.base;
const { launch, signup } = await import('./lib.mjs');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
const lastAnswer = (page) => page.locator('.nc-ai-row.assistant').last();
async function waitIdle(page, timeout = 20000) {
  await page.waitForFunction(() => !document.querySelector('.nc-ai-row.assistant[aria-busy="true"]'), null, { timeout });
}
async function send(page, text) {
  const input = page.locator('.nc-ai-prompt').last();
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}
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
const blockTexts = (page) => page.$$eval('.lit-page-content .lit-selectable', (els) => els.map((e) => `${([...e.classList].find((c) => c.endsWith('-block')) ?? '').replace(/^lit-/, '')}:${(e.innerText || '').trim()}`));
/** the inline writer is open and its input has the focus (keys go to the writer, not the editor) */
const writerFocused = (page, state = '') => page.waitForFunction((st) => {
  const bar = document.querySelector(`[data-testid="ai-inline-writer"] .nc-ai-writer-bar${st ? '.' + st : ''}`);
  return !!bar && !!document.activeElement?.classList.contains('nc-ai-writer-input');
}, state, { timeout: 15000 });

const { browser, context, page } = await launch();
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
try {
  await signup(page, `ai-mock-${Date.now()}@test.dev`, 'Ada Lovelace', 'AI Lab');
  const domain = await page.evaluate(() => location.pathname.split('/')[1]);
  const status = await page.evaluate(async () => (await fetch('/api/rpc/aiStatus', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json());
  check(status.configured === true && status.model === 'claude-opus-5-5', `aiStatus configured (${status.model})`);

  // ---- full-page chat ----
  await page.click('[role="tab"][aria-label="Chat"]');
  await page.waitForTimeout(300);
  if (!(await page.$('.nc-ai-landing'))) await page.click('nav.lit-sidebar-container >> text=New chat');
  await page.waitForSelector('.nc-ai-landing');
  check(!(await page.$('.nc-ai-banner')), 'no connect-key banner when configured');
  await send(page, 'Hello there');
  await page.waitForSelector('.nc-ai-row.user .nc-ai-bubble');
  await waitIdle(page);
  const ans = await lastAnswer(page).innerText();
  check(ans.includes('Hello!') && ans.includes('Second item') && ans.includes('A to-do'), 'streamed Markdown answer rendered');
  check(await lastAnswer(page).locator('table.nc-ai-table').count() === 1, 'Markdown table rendered');
  check(/\/chat\/[0-9a-f-]{36}$/.test(page.url()), `URL is the new thread (${page.url().split('/').slice(-2).join('/')})`);
  await page.waitForTimeout(300);
  const sidebarChats = await page.locator('nav.lit-sidebar-container').innerText();
  check(sidebarChats.includes('Hello there'), 'sidebar Chats lists the new chat');
  await page.screenshot({ path: `${OUT}/mock-01-chat-answer.png` });

  await lastAnswer(page).hover();
  await lastAnswer(page).locator('[aria-label="Copy response"]').click();
  await page.waitForSelector('text=Response copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  check(clip.startsWith('# Hello!'), 'Copy response copies the Markdown');

  // tool use: search_workspace → cited answer
  await send(page, 'please search my workspace for toggles');
  await waitIdle(page);
  const cited = lastAnswer(page);
  check(await cited.locator('.nc-ai-cite.linked').count() >= 1, 'citation chip [1] rendered');
  const sourcesText = await cited.locator('.nc-ai-sources').innerText().catch(() => '');
  check(sourcesText.includes('Welcome to Litpage'), `Sources row cites "Welcome to Litpage" (${sourcesText.replace(/\n/g, ' | ')})`);
  await page.screenshot({ path: `${OUT}/mock-02-cited-answer.png` });

  // stop + retry
  await send(page, 'write something slow');
  await page.waitForFunction(() => (document.querySelector('.nc-ai-row.assistant[aria-busy="true"] .nc-ai-md')?.textContent ?? '').length > 30, null, { timeout: 10000 });
  await page.click('.nc-ai-send.stop');
  await waitIdle(page);
  await page.waitForTimeout(700);
  const stopped = await lastAnswer(page).innerText();
  check(stopped.includes('Interrupted') && !stopped.includes('Sentence 60'), 'Stop keeps the partial answer as Interrupted');
  await page.screenshot({ path: `${OUT}/mock-03-stopped.png` });
  await lastAnswer(page).locator('[aria-label="Retry"]').click();
  await waitIdle(page, 30000);
  const retried = await lastAnswer(page).innerText();
  check(retried.includes('Sentence 60') && !retried.includes('Interrupted'), 'Retry regenerates the full answer');
  const thread = await page.evaluate(async (id) => (await fetch('/api/rpc/aiGetThread', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: id }) })).json(), page.url().split('/').pop());
  check(thread.messages.length === 6 && thread.messages.filter((m) => m.role === 'assistant').every((m) => m.status === 'complete'), `thread persisted (${thread.messages.length} messages)`);

  // rate limit error
  await send(page, 'trigger [[429]] please');
  await waitIdle(page, 30000);
  const err = await lastAnswer(page).innerText();
  check(err.includes('too many requests'), 'rate limit shows a friendly error');
  await page.screenshot({ path: `${OUT}/mock-04-error.png` });

  // save an answer as a private page
  await page.locator('.nc-ai-row.assistant').first().hover();
  await page.locator('.nc-ai-row.assistant').first().locator('[aria-label="Save among private pages"]').click();
  await page.waitForSelector('text=Saved to private pages');
  await page.click('.nc-toast-action');
  await page.waitForSelector('.lit-page-content');
  await page.waitForTimeout(500);
  const saved = await blockTexts(page);
  check(saved.some((t) => t.startsWith('numbered_list-block') && t.includes('First item')) && saved.some((t) => t.startsWith('table-block')), `saved page has real blocks (${saved.map((t) => t.split(':')[0]).join(', ')})`);

  
  await page.goto(`${h.base}/${domain}/chat?q=${encodeURIComponent('How do toggle blocks work?')}&ws=1`);
  await page.waitForSelector('.nc-ai-row.assistant');
  await waitIdle(page);
  const qa = lastAnswer(page);
  check((await qa.innerText()).includes('Toggle blocks hide tips'), 'workspace Q&A answer');
  check((await qa.locator('.nc-ai-sources').innerText().catch(() => '')).includes('Welcome to Litpage'), 'Q&A cites the retrieved page');
  await page.screenshot({ path: `${OUT}/mock-05-workspace-qa.png` });

  // ---- floating panel on a page: insert into page ----
  await page.goto(`${h.base}/${domain}`);
  await page.click('[role="tab"][aria-label="Home"]');
  await page.click('nav.lit-sidebar-container >> text=Welcome to Litpage');
  await page.waitForSelector('.lit-page-content');
  const before = (await blockTexts(page)).length;
  await page.click('.lit-ai-button');
  await page.waitForSelector('.nc-ai-panel');
  // docked "Side Peek" panel; the page it sits on is context by default (+ menu › Context › Current page)
  await page.click('.nc-ai-panel [aria-label="Add files and settings"]');
  const ctxItem = page.locator('.lit-overlay-container [role=option]', { hasText: 'Current page' }).first();
  check((await ctxItem.innerText()).includes('Welcome to Litpage'), 'panel offers the "Current page" context');
  await page.keyboard.press('Escape');
  await page.click('.nc-ai-panel >> text=Spot useful patterns');
  await waitIdle(page);
  await page.screenshot({ path: `${OUT}/mock-06-panel-answer.png` });
  await page.locator('.nc-ai-panel .nc-ai-row.assistant').last().locator('[aria-label="Add to this page"]').click();
  await page.waitForTimeout(600);
  const after = await blockTexts(page);
  if (process.env.DEBUG_E2E) console.log(after.slice(before - 2));
  check(after.length > before && after.some((t) => t.startsWith('header-block') && t.includes('Hello!')), `Add to this page adds blocks (${before} → ${after.length})`);
  const req = await page.evaluate(async () => {
    const t = await (await fetch('/api/rpc/aiListThreads', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spaceId: localStorage.getItem('nc:lastSpaceId') }) })).json();
    return t.threads?.length ?? 0;
  });
  check(req >= 3, `chat history lists threads (${req})`);
  await page.click('.nc-ai-panel [aria-label="Hide chat"]');

  // ---- inline writer: Space on an empty line → Continue writing → Accept ----
  await newPageWithEmptyLine(page, 'Writer test');
  await page.keyboard.press(' ');
  await writerFocused(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/mock-07-writer-menu.png` });
  await page.keyboard.press('Enter'); // first suggestion: Continue writing
  await page.waitForFunction(() => document.querySelector('[data-testid="ai-inline-writer"] .nc-ai-writer-preview')?.textContent?.includes('next step'), null, { timeout: 10000 });
  await writerFocused(page, 'done');
  await page.screenshot({ path: `${OUT}/mock-08-writer-result.png` });
  await page.keyboard.press('Enter'); // Accept
  await page.waitForTimeout(500);
  let texts = await blockTexts(page);
  check(texts.some((t) => t === 'text-block:The story continues with a bold next step.'), 'Accept writes the result into the empty line');
  const bold = await page.$eval('.lit-page-content .lit-text-block', (el) => el.innerHTML.includes('font-weight') || /<(b|strong)\b/.test(el.innerHTML) || !!el.querySelector('[style*="600"],[style*="bold"]')).catch(() => false);
  check(bold, 'inline **bold** became a bold annotation');

  // ⌘J on a selection → Proofread → Accept (replace selection)
  await page.keyboard.press('Enter');
  await page.keyboard.type('teh qiuck fox jumps');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Home');
  await page.keyboard.up('Shift');
  await page.keyboard.press('Meta+j');
  await page.waitForSelector('[data-testid="ai-inline-writer"].selection');
  await page.keyboard.type('Proof');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="ai-inline-writer"] .nc-ai-writer-preview')?.textContent?.includes('the quick fox'), null, { timeout: 10000 });
  await writerFocused(page, 'done');
  await page.screenshot({ path: `${OUT}/mock-09-writer-selection.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  texts = await blockTexts(page);
  check(texts.includes('text-block:the quick fox jumps'), 'Proofread replaced the selection');

  // topic skill: Make a table about … → table block
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  await page.keyboard.press(' ');
  await writerFocused(page);
  await page.keyboard.type('table');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nc-ai-writer-chip');
  await page.keyboard.type('owners');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !!document.querySelector('[data-testid="ai-inline-writer"] .nc-ai-writer-preview table'), null, { timeout: 10000 });
  await writerFocused(page, 'done');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  texts = await blockTexts(page);
  check(texts.some((t) => t.startsWith('table-block') && t.includes('Ada')), 'Make a table inserted a table block');
  await page.screenshot({ path: `${OUT}/mock-10-writer-table.png` });

  // undo removes the inserted table in one step
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(400);
  texts = await blockTexts(page);
  check(!texts.some((t) => t.startsWith('table-block')), '⌘Z undoes the AI insertion in one step');

  // Esc while the AI is writing: focus stays in the writer, the generation stops and the partial
  // draft can be discarded (with the "Do you want to discard the AI response?" confirmation)
  await page.click('.lit-page-content .lit-text-block >> nth=-1');
  if (await page.evaluate(() => (document.activeElement?.textContent ?? '') !== '')) {
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
  }
  await page.keyboard.press(' ');
  await writerFocused(page);
  await page.keyboard.type('Write a slow story');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => (document.querySelector('[data-testid="ai-inline-writer"] .nc-ai-writer-preview')?.textContent ?? '').includes('Sentence 3'), null, { timeout: 10000 });
  const focusedWhileRunning = await page.evaluate(() => !!document.querySelector('.nc-ai-writer-bar.running') && !!document.activeElement?.classList.contains('nc-ai-writer-input'));
  await page.keyboard.press('Escape');
  await writerFocused(page, 'done');
  const partial = await page.$eval('[data-testid="ai-inline-writer"] .nc-ai-writer-preview', (el) => el.textContent ?? '');
  check(focusedWhileRunning && partial.includes('Sentence 3') && !partial.includes('Sentence 60'), 'Esc stops the writer mid-answer (focus stays in the writer)');
  await page.keyboard.press('Escape');
  await page.click('.nc-ai-writer-confirm button.danger');
  await page.waitForFunction(() => !document.querySelector('[data-testid="ai-inline-writer"]'));
  texts = await blockTexts(page);
  check(!texts.some((t) => t.includes('long draft')), 'discarding the stopped draft leaves the page unchanged');

  // ---- AI block ----
  await page.click('.lit-page-content .lit-text-block >> nth=-1');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/AI Block');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nc-ai-block-config');
  await page.click('.nc-ai-block-type:has-text("Key points")');
  await page.screenshot({ path: `${OUT}/mock-11-ai-block-config.png` });
  await page.click('.nc-ai-block-config .nc-btn.primary');
  await page.waitForSelector('.nc-ai-block-footer', { timeout: 15000 });
  await page.waitForTimeout(400);
  const blockText = await page.locator('[data-testid="ai-block"]').innerText();
  check(blockText.includes('Welcome to the workspace') && blockText.includes('Generated by Litpage AI on'), 'AI block generated child blocks + footer');
  await page.screenshot({ path: `${OUT}/mock-12-ai-block.png` });

  // ---- database autofill API ----
  const auto = await page.evaluate(async () => {
    const call = async (n, b) => (await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
    const hex = /([0-9a-f]{32})$/.exec(location.pathname)[1];
    const pageId = hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const page = (await call('fetchRecords', { requests: [{ pointer: { table: 'block', id: pageId } }] })).recordMap.block[pageId].value.value;
    const spaceId = page.space_id;
    const now = Date.now();
    const id = () => crypto.randomUUID();
    const dbId = id(), colId = id(), rowId = id();
    const op = (table, i, path, command, args) => ({ pointer: { table, id: i, spaceId }, path, command, args });
    await call('applyChanges', { requestId: id(), transactions: [{ id: id(), spaceId, operations: [
      op('block', dbId, [], 'set', { type: 'collection_view', collection_id: colId, view_ids: [], parent_id: pageId, parent_table: 'block', space_id: spaceId, alive: true, created_time: now, created_by_id: page.created_by_id, last_edited_time: now, last_edited_by_id: page.created_by_id }),
      op('block', pageId, ['content'], 'listAfter', { id: dbId }),
      op('collection', colId, [], 'set', { parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId, schema: { title: { name: 'Name', type: 'title' }, size: { name: 'Size', type: 'select', options: [{ id: 'a', value: 'Small', color: 'gray' }, { id: 'b', value: 'Large', color: 'red' }] } } }),
      op('block', rowId, [], 'set', { type: 'page', properties: { title: [['Acme expansion deal']] }, parent_id: colId, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: page.created_by_id, last_edited_time: now, last_edited_by_id: page.created_by_id }),
    ] }] });
    return call('aiAutofill', { rowId, propId: 'size', kind: 'custom', prompt: 'Deal size' });
  });
  check(JSON.stringify(auto.value) === '[["Large"]]', `aiAutofill returns the encoded select value (${JSON.stringify(auto)})`);

  
  await newPageWithEmptyLine(page, 'My Litpage AI');
  await page.keyboard.type('Always answer like a pirate.');
  await page.waitForTimeout(800);
  await page.click('.lit-topbar-more-button');
  await page.click('.lit-overlay-container [role="option"]:has-text("Use in AI")');
  await page.click('.lit-overlay-container [role="menuitem"]:has-text("Use as agent guidance")');
  const prefsNow = () => page.evaluate(async () => {
    const call = async (n, b) => (await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
    const hex = /([0-9a-f]{32})$/.exec(location.pathname)[1];
    const pageId = hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const rec = (table, id) => call('fetchRecords', { requests: [{ pointer: { table, id } }] }).then((r) => { const e = r.recordMap?.[table]?.[id]; return e?.value?.value ?? e?.value; });
    const pg = await rec('block', pageId);
    const us = await rec('user_settings', pg.created_by_id);
    return { pageId, userId: pg.created_by_id, settings: us?.settings ?? {} };
  });
  let prefs = await prefsNow();
  for (let i = 0; i < 20 && prefs.settings.ai_instructions_page !== prefs.pageId; i++) { await page.waitForTimeout(250); prefs = await prefsNow(); }
  check(prefs.settings.ai_instructions_page === prefs.pageId, 'Use as agent guidance saves the instructions page');
  // Personalize → name (same user_settings update the Settings dialog sends)
  await page.evaluate(async (userId) => {
    const id = () => crypto.randomUUID();
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ requestId: id(), transactions: [{ id: id(), spaceId: '', operations: [{ pointer: { table: 'user_settings', id: userId }, path: ['settings'], command: 'update', args: { ai_name: 'Captain' } }] }] }) });
  }, prefs.userId);
  if (!(await page.$('.nc-ai-panel'))) await page.click('.lit-ai-button');
  await page.waitForSelector('.nc-ai-panel');
  await send(page, 'Who are you?');
  await waitIdle(page);
  const persona = await lastAnswer(page).innerText();
  check(persona.includes('I am Captain') && persona.includes('Always answer like a pirate.'), `chat follows the instructions page and name ("${persona.split('\n')[0]}")`);
  await page.screenshot({ path: `${OUT}/mock-13-instructions.png` });

  // ---- secrets ----
  const logs = h.logs().join('\n');
  check(!logs.includes('test-key'), 'the API key never appears in server logs');
  check(/\[ai\] chat failed: rate_limited status=429 request_id=req_mock_429/.test(logs), 'API errors are logged with status/request id only');
} catch (e) {
  failures++;
  console.log('E2E FAILED', e.message);
  await page.screenshot({ path: `${OUT}/mock-error.png` }).catch(() => {});
} finally {
  await browser.close();
  h.stop();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

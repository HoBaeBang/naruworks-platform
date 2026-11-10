
// attachments (image / text), MCP connections (External MCP endpoint dialog → the clone runs the tools of a local fake MCP
// server itself, through the approval step), Quick Find "Search every source with AI" → Research mode, the model picker, and skills ("/" menu, Library).
//   node e2e/ai-sources.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { startHarness } from './ai-harness.mjs';
import { startFakeMcp } from './ai-mcp-fake.mjs';

const SCRATCH = '/tmp/nc-e2e';
const OUT = process.env.NC_SHOTS ?? `${SCRATCH}/e2e-ai`;
mkdirSync(OUT, { recursive: true });
const h = await startHarness({ key: true, apiPort: 3113, webPort: 5413, mockPort: 3112, dataDir: `${SCRATCH}/wave3/ai/data` });
const mcp = await startFakeMcp(3115, { token: 'mcp-secret' });
process.env.NC_BASE = h.base;
const { launch, signup } = await import('./lib.mjs');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
const chat = (page) => page.locator('.nc-ai-chat.page');
const lastAnswer = (page) => chat(page).locator('.nc-ai-row.assistant').last();
async function waitIdle(page, timeout = 20000) {
  await page.waitForFunction(() => !document.querySelector('.nc-ai-row.assistant[aria-busy="true"]'), null, { timeout });
}
async function send(page, text) {
  // the composer must be idle (no Stop button) before a new message can be sent
  await page.waitForFunction(() => !document.querySelector('.nc-ai-chat.page .nc-ai-send.stop'), null, { timeout: 10000 }).catch(async () => {
    console.log('DEBUG composer still streaming', await page.evaluate(() => JSON.stringify({ dbg: window.__ncChatDbg, turns: window.__ncTurns })));
  });
  const before = await chat(page).locator('.nc-ai-row.user').count();
  await chat(page).locator('.nc-ai-prompt').last().click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => document.querySelectorAll('.nc-ai-chat.page .nc-ai-row.user').length > n, before, { timeout: 8000 });
}
  const option = (page, text) => page.locator('.lit-overlay-container [role=option]', { hasText: text }).first();
async function openPlus(page) {
  await chat(page).locator('[aria-label="Add files and settings"]').last().click();
}

const { browser, context, page } = await launch();
try {
  await signup(page, `ai-src-${Date.now()}@test.dev`, 'Grace Hopper', 'Sources Lab');
  const domain = await page.evaluate(() => location.pathname.split('/')[1]);
  await page.goto(`${h.base}/${domain}/chat`);
  await page.waitForSelector('.nc-ai-landing');

  // ---- web: warning → web pill → server web search with a cited answer ----
  await openPlus(page);
  await option(page, 'Web').click();
  await page.waitForSelector('[role=alertdialog]:has-text("Confirm this action?")');
  check((await page.locator('[role=alertdialog]').innerText()).includes('prompt injection'), 'web warning mentions the risks');
  await page.locator('[role=alertdialog] button', { hasText: 'Enable web access' }).click();
  check(await chat(page).locator('[aria-label="Turn off web browser"]').count() === 1, 'web pill in the composer');
  await send(page, 'What is the latest Litpage news on the web?');
  await waitIdle(page);
  let ans = lastAnswer(page);
  const webSteps = await ans.locator('[data-testid="ai-agent-steps"]').innerText().catch(() => '');
  check(webSteps.includes('Searched') && webSteps.includes('litpage agent news'), `web search step (${webSteps.replace(/\n/g, ' | ')})`);
  check(await ans.locator('.nc-ai-cite.linked').count() >= 1, 'web citation chip');
  const webSource = ans.locator('.nc-ai-source.web').first();
  check((await webSource.getAttribute('href')) === 'https://example.com/lit-agent', 'Sources row links the web page');
  await page.screenshot({ path: `${OUT}/sources-01-web.png` });
  await chat(page).locator('[aria-label="Turn off web browser"]').click();

  // ---- attachments: image + text file ----
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  writeFileSync(`${SCRATCH}/wave3/ai/pixel.png`, png);
  writeFileSync(`${SCRATCH}/wave3/ai/notes.md`, '# Launch notes\nShip on Friday.\n');
  await chat(page).locator('[data-testid="ai-file-input"]').last().setInputFiles([`${SCRATCH}/wave3/ai/pixel.png`, `${SCRATCH}/wave3/ai/notes.md`]);
  await page.waitForFunction(() => document.querySelectorAll('.nc-ai-attach.file.ready').length === 2, null, { timeout: 10000 });
  check(true, 'two attachment chips uploaded');
  await send(page, 'Describe these files');
  await waitIdle(page);
  ans = lastAnswer(page);
  const attText = await ans.innerText();
  check(attText.includes('an image (image/png') && attText.includes('the file “notes.md” starting with “# Launch notes”'), `the model received the image and the text file (${attText.slice(0, 120)})`);
  const bubbleChips = await chat(page).locator('.nc-ai-row.user').last().locator('.nc-ai-context-chip.file').count();
  check(bubbleChips === 2, 'the user message shows the attachments');

  // ---- MCP: Add Connections → External MCP endpoint → tool call (client-side, approval rules apply) ----
  await openPlus(page);
  await option(page, 'Connections').hover();
  await option(page, 'Add Connections').click();
  const dlg = page.locator('[role=dialog][aria-label="External MCP endpoint"]');
  await dlg.waitFor();
  check((await dlg.innerText()).includes('Litpage has not reviewed this endpoint'), 'custom MCP warning');
  await dlg.locator('input').nth(0).fill('Weather');
  await dlg.locator('input').nth(1).fill(mcp.url);
  await dlg.locator('input').nth(2).fill('wrong-token');
  await dlg.locator('button', { hasText: 'Connect' }).click();
  await dlg.locator('.nc-ai-dialog-error').waitFor({ timeout: 8000 });
  check((await dlg.locator('.nc-ai-dialog-error').innerText()).includes('Connection failed'), 'a bad token is reported');
  await dlg.locator('input').nth(2).fill('mcp-secret');
  await dlg.locator('button', { hasText: 'Connect' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 8000 });
  await openPlus(page);
  await option(page, 'Connections').hover();
  const listed = await option(page, 'Weather').waitFor({ timeout: 5000 }).then(() => true, () => false);
  if (!listed) await page.screenshot({ path: `${OUT}/sources-02-connections.png` });
  check(listed, 'the connection is listed under Connections');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await send(page, 'What is the weather? Use the MCP tool.');
  await waitIdle(page);
  ans = lastAnswer(page);
  const mcpText = await ans.innerText();
  check(mcpText.includes('Ran MCP tool: get_weather') && mcpText.includes('Sunny, 21°C in Seoul'), `MCP tool step and answer (${mcpText.replace(/\n/g, ' | ').slice(0, 160)})`);
  check(mcp.calls.length === 1 && mcp.calls[0].name === 'get_weather', 'the MCP server received the tool call with the token');
  await page.screenshot({ path: `${OUT}/sources-02-mcp.png` });
  
  // call never reaches the MCP server
  await send(page, 'Use the MCP tool to delete everything.');
  const mcpCard = chat(page).locator('[data-testid="ai-approval-card"]').last();
  const asked = await mcpCard.waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(asked && (await mcpCard.innerText()).includes('Run delete_everything'), 'a destructive MCP tool asks for approval');
  if (asked) await mcpCard.locator('[role=button]', { hasText: /^Reject$/ }).first().click();
  await waitIdle(page);
  check(mcp.calls.length === 1, 'a rejected MCP tool call never reaches the server');
  check((await lastAnswer(page).innerText()).includes('Rejected'), 'the rejected MCP step is marked');

  // ---- model picker ----
  await chat(page).locator('[data-testid="agent-chat-model-button"]').last().click();
  const modelMenu = await page.locator('.lit-overlay-container').last().innerText();
  check(modelMenu.includes('Auto') && modelMenu.includes('Opus') && modelMenu.includes('Sonnet') && modelMenu.includes('Haiku') && modelMenu.includes('Other models'), 'model picker lists Auto and Claude models');
  await option(page, 'Sonnet').click();
  check((await chat(page).locator('[data-testid="agent-chat-model-button"]').last().innerText()).includes('Sonnet 5.5'), 'model pill shows the choice');
  await send(page, 'Hello again');
  await waitIdle(page);
  const model = await page.evaluate(async () => {
    const id = location.pathname.split('/').pop();
    const r = await (await fetch('/api/rpc/aiGetThread', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: id }) })).json();
    return { thread: r.thread.model, last: r.messages.at(-1).model };
  });
  check(model.thread === 'claude-sonnet-5-5' && model.last === 'Sonnet 5.5', `the chat runs on the chosen model (${JSON.stringify(model)})`);

  // ---- skills: New skill in the Library → "/" in chat ----
  await page.goto(`${h.base}/${domain}/library/skills`);
  await page.waitForSelector('.nc-lib-skills');
  await page.locator('.nc-lib-headline .nc-lib-primary', { hasText: 'New skill' }).click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(400);
  const skillTitle = await page.locator('h1[data-content-editable-leaf]').innerText();
  check(skillTitle.includes('New skill'), 'New skill creates and opens a skill page');
  await page.goto(`${h.base}/${domain}/library/skills`);
  await page.waitForSelector('[data-testid="ai-skill-row"][data-skill="New skill"]', { timeout: 8000 }).catch(() => {});
  check(await page.locator('[data-testid="ai-skill-row"][data-skill="New skill"]').count() === 1, 'the skill is listed under Enabled for me');
  check(await page.locator('[data-testid="ai-skill-row"][data-skill="Improve writing"]').count() === 1, 'built-in skills are listed');
  await page.screenshot({ path: `${OUT}/sources-03-skills.png` });
  await page.goto(`${h.base}/${domain}/chat`);
  await page.waitForSelector('.nc-ai-landing');
  await chat(page).locator('.nc-ai-prompt').last().click();
  await page.keyboard.type('/New');
  await page.waitForSelector('.nc-ai-mention-menu[data-trigger="/"]');
  const listedSkill = await page.waitForFunction(() => document.querySelector('.nc-ai-mention-menu')?.textContent?.includes('New skill'), null, { timeout: 5000 }).then(() => true, () => false);
  check(listedSkill, '"/" lists the user skill');
  await page.keyboard.press('Enter');
  check(await chat(page).locator('.nc-ai-attach.skill').count() === 1, 'picking a skill adds a skill chip');
  await page.keyboard.type('use my skill please');
  await page.keyboard.press('Enter');
  await waitIdle(page);
  check(await chat(page).locator('.nc-ai-row.user').last().locator('.nc-ai-context-chip.skill').count() === 1, 'the sent message shows the skill');
  check((await lastAnswer(page).innerText()).includes('Following your skill'), 'the agent used the skill');

  // ---- Quick Find → "Search every source with AI" → Research mode ----
  await page.keyboard.press('Meta+k');
  await page.waitForSelector('.nc-qf-grid, .search-snapshot-container');
  await page.keyboard.type('shortcuts');
  await page.waitForSelector('[data-testid="search-ai-row"]', { timeout: 8000 });
  check((await page.locator('[data-testid="search-ai-row"]').innerText()).includes('Search every source with AI'), 'Quick Find offers "Search every source with AI"');
  await page.locator('[data-testid="search-ai-row"] .nc-qf-row').click();
  await page.waitForSelector('[data-testid="ai-mode-pill"][data-mode="research"]', { timeout: 8000 });
  await waitIdle(page, 30000);
  ans = lastAnswer(page);
  const research = await ans.innerText();
  check(research.includes('Summary') && research.includes('Open questions'), 'research report');
  const rsteps = await ans.locator('[data-testid="ai-agent-steps"]').innerText().catch(() => '');
  check(rsteps.includes('Searched') && rsteps.includes('Viewed'), `research searched and read pages (${rsteps.replace(/\n/g, ' | ')})`);
  await page.screenshot({ path: `${OUT}/sources-04-research.png` });
  // a workspace citation opens the page at the block the search matched
  await ans.locator('.nc-ai-cite.linked').first().click();
  const jumped = await page.waitForFunction(() => /#[0-9a-f]{32}$/.test(location.href), null, { timeout: 8000 }).then(() => true, () => false);
  check(jumped, `citation opens the cited block (${await page.evaluate(() => location.pathname + location.hash)})`);
} catch (e) {
  failures++;
  console.log('FAIL exception', e?.message ?? e);
  await page.screenshot({ path: `${OUT}/sources-error.png` }).catch(() => {});
} finally {
  await browser.close();
  mcp.close();
  const logs = h.logs().filter((l) => /\[api\].*(error|Error)/.test(l) && !/AbortError|aborted/i.test(l)).slice(0, 10);
  if (logs.length) console.log(logs.join('\n'));
  h.stop();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);


// (e2e/ai-mock-openai.mjs — never the real endpoint): the model picker lists openai's models by display name, chat
// streams Markdown and gets an AI title from the fast model, the agent edits the workspace with tool calls (call_id
// round trip) behind an "Always ask" approval and live on the open page, web search answers with numbered citations,

// refusal text, the inline writer, the AI block, database autofill and a Custom Agent run all
// go through openai, and every request is a valid Responses request (store:false, stream:true, instructions,
// strict:false function tools, no item ids, no max_output_tokens) while the key never reaches the logs.
//   node e2e/ai-openai.mjs          (own servers: API 3251, web 5571, mock 3252, fake MCP 3253; NC_E2E_PORTS / NC_E2E_MCP_PORT override)
import { mkdirSync } from 'node:fs';
import { startHarness } from './ai-harness.mjs';
import { startFakeMcp } from './ai-mcp-fake.mjs';

const SCRATCH = '/tmp/nc-e2e';
const OUT = process.env.NC_SHOTS ?? `${SCRATCH}/wave3/llm/shots`;
mkdirSync(OUT, { recursive: true });
const mcp = await startFakeMcp(Number(process.env.NC_E2E_MCP_PORT) || 3253, { token: 'mcp-secret' });
const h = await startHarness({ key: true, provider: 'openai', apiPort: 3251, webPort: 5571, mockPort: 3252, dataDir: `${SCRATCH}/wave3/llm/data` });
process.env.NC_BASE = h.base;
const mockPort = Number((process.env.NC_E2E_PORTS ?? '').split(',')[2]) || 3252;
const MOCK = `http://127.0.0.1:${mockPort}`;
const { launch, signup } = await import('./lib.mjs');
const { call } = await import('./ws-lib.mjs');
const { addBlock } = await import('./fix-lib.mjs');

let failures = 0;
let passes = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (cond) passes++;
  else failures++;
};
const everyRequest = new Map();
const mockRequests = async () => {
  const list = (await (await fetch(`${MOCK}/__requests`)).json()).requests;
  for (const r of list) everyRequest.set(r.n, r);
  return list;
};
const clearMock = async () => {
  await mockRequests();
  await fetch(`${MOCK}/__requests`, { method: 'DELETE' });
};
const chat = (page) => page.locator('.nc-ai-chat.page');
const scope = (page, panel) => (panel ? page.locator('.nc-ai-panel') : chat(page));
const lastAnswer = (page, panel = false) => scope(page, panel).locator('.nc-ai-row.assistant').last();
async function waitIdle(page, timeout = 25000) {
  await page.waitForFunction(() => !document.querySelector('.nc-ai-row.assistant[aria-busy="true"]'), null, { timeout });
}
async function send(page, text, panel = false) {
  const host = panel ? '.nc-ai-panel' : '.nc-ai-chat.page';
  await page.waitForFunction((sel) => !document.querySelector(`${sel} .nc-ai-send.stop`), host, { timeout: 15000 }).catch(() => {});
  const before = await scope(page, panel).locator('.nc-ai-row.user').count();
  await scope(page, panel).locator('.nc-ai-prompt').last().click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForFunction(([sel, n]) => document.querySelectorAll(`${sel} .nc-ai-row.user`).length > n, [host, before], { timeout: 8000 });
}
const option = (page, text) => page.locator('.lit-overlay-container [role=option]', { hasText: text }).first();
const button = (host, label) => host.locator('[role=button]', { hasText: new RegExp(`^${label}$`) }).first();
async function approvalCard(page, panel = false) {
  const card = scope(page, panel).locator('[data-testid="ai-approval-card"]').last();
  await card.waitFor({ timeout: 15000 });
  return card;
}
async function chooseApproval(page, label) {
  await page.locator('[data-testid="agent-service-approval-mode-button"]').last().click();
  await option(page, label).click();
  await page.waitForTimeout(150);
}
const sidebarHas = (page, title) => page.locator('nav.lit-sidebar-container').innerText().then((t) => t.includes(title));
const blockTexts = (page) => page.$$eval('.lit-page-content .lit-selectable', (els) => els.map((e) => `${([...e.classList].find((c) => c.endsWith('-block')) ?? '').replace(/^lit-/, '')}:${(e.innerText || '').trim()}`));
const writerFocused = (page, state = '') => page.waitForFunction((st) => {
  const bar = document.querySelector(`[data-testid="ai-inline-writer"] .nc-ai-writer-bar${st ? '.' + st : ''}`);
  return !!bar && !!document.activeElement?.classList.contains('nc-ai-writer-input');
}, state, { timeout: 15000 });
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
async function waitFor(fn, timeout = 20000, interval = 400) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

const { browser, context, page } = await launch();
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
try {
  await signup(page, `openai-${Date.now()}@test.dev`, 'Ada Lovelace', 'OpenAI Lab');
  const domain = await page.evaluate(() => location.pathname.split('/')[1]);
  const spaceId = await page.evaluate(() => localStorage.getItem('nc:lastSpaceId'));

  // ---- status + model list from openai's /models
  const status = await call(page, 'aiStatus', { spaceId });
  check(status.configured === true && status.model === 'gpt-mock-astra' && status.modelLabel === 'GPT-Mock-Astra', `aiStatus: configured, default GPT-Mock-Astra (${status.model} / ${status.modelLabel})`);
  const listed = (status.models ?? []).map((m) => `${m.name}:${m.group}`);
  check(JSON.stringify(listed) === JSON.stringify(['GPT-Mock-Astra:recommended', 'GPT-Mock-Sol:recommended', 'GPT-Mock-Luna:recommended', 'GPT-Mock-Classic:other']), `model list = listed openai models by display name, hidden ones left out (${listed.join(', ')})`);

  // ---- chat: streamed Markdown + AI title (fast model)
  await page.goto(`${h.base}/${domain}/chat`);
  await page.waitForSelector('.nc-ai-landing');
  check(!(await page.$('.nc-ai-banner')), 'no connect-a-provider banner when openai is configured');
  await clearMock();
  await send(page, 'Hello there');
  await waitIdle(page);
  const hello = await lastAnswer(page).innerText();
  check(hello.includes('Hello!') && hello.includes('Second item') && (await lastAnswer(page).locator('table.nc-ai-table').count()) === 1, 'chat answer streamed from openai (Markdown list + table)');
  let reqs = await waitFor(async () => { const r = await mockRequests(); return r.some((x) => x.body.instructions.startsWith('You name chat conversations')) ? r : null; }, 8000);
  const chatReq = reqs?.find((x) => x.body.instructions.startsWith('You are Litpage AI, the agent'));
  const titleReq = reqs?.find((x) => x.body.instructions.startsWith('You name chat conversations'));
  check(chatReq?.body.model === 'gpt-mock-astra' && titleReq?.body.model === 'gpt-mock-luna', `Auto: chat on the default model, the title on the fast model (${chatReq?.body.model} / ${titleReq?.body.model})`);
  const threads = await waitFor(async () => { const t = await call(page, 'aiListThreads', { spaceId }); return t.threads?.some((x) => x.title === 'Hello there (AI title)') ? t.threads : null; }, 8000);
  check(!!threads, 'the chat gets its AI title (generated through openai)');
  await page.screenshot({ path: `${OUT}/openai-01-chat.png` });

  // ---- model picker: openai models, an explicit choice is sent as the model
  await page.locator('[data-testid="agent-chat-model-button"]').last().click();
  await page.waitForSelector('.lit-overlay-container [role=option]');
  const menu = await page.locator('.lit-overlay-container').last().innerText();
  check(['Auto', 'GPT-Mock-Astra', 'GPT-Mock-Sol', 'GPT-Mock-Luna', 'Other models'].every((s) => menu.includes(s)) && !menu.includes('Opus') && !menu.includes('GPT-Mock-Hidden'), 'model menu: Auto + openai models (no Claude models, no hidden models)');
  await page.screenshot({ path: `${OUT}/openai-02-models.png` });
  await option(page, 'GPT-Mock-Sol').click();
  await clearMock();
  await send(page, 'Thanks, what can you do?');
  await waitIdle(page);
  reqs = await mockRequests();
  check(reqs.some((x) => x.body.model === 'gpt-mock-sol' && x.body.instructions.startsWith('You are Litpage AI, the agent')), 'the picked model (GPT-Mock-Sol) is sent to openai');
  await page.locator('[data-testid="agent-chat-model-button"]').last().click();
  await option(page, 'Auto').click();

  // ---- agent: tool call → approval (Always ask) → page created; call_id round trip
  await chooseApproval(page, 'Always ask');
  await clearMock();
  await send(page, 'Please create a page called "OpenAI Roadmap"');
  const approval = await approvalCard(page);
  check((await approval.innerText()).includes('Create page “OpenAI Roadmap”'), 'approval card for the tool call the model made');
  await page.screenshot({ path: `${OUT}/openai-03-approval.png` });
  await button(approval, 'Continue').click();
  await waitIdle(page);
  await page.waitForFunction(() => document.querySelector('nav.lit-sidebar-container')?.textContent?.includes('OpenAI Roadmap'), null, { timeout: 8000 }).catch(() => {});
  check(await sidebarHas(page, 'OpenAI Roadmap'), 'Continue → the agent created the page (sidebar, realtime)');
  const ans = lastAnswer(page);
  check((await ans.innerText()).includes('I created OpenAI Roadmap') && (await ans.locator('[data-testid="ai-changes-card"]').count()) === 1, 'summary after the tool result + Changes made card');
  reqs = await mockRequests();
  const turnReqs = reqs.filter((x) => x.body.instructions.startsWith('You are Litpage AI, the agent'));
  const call1 = turnReqs[0]?.n;
  const second = turnReqs.find((x) => x.body.input.some((i) => i.type === 'function_call_output'));
  const fc = second?.body.input.find((i) => i.type === 'function_call');
  const fco = second?.body.input.find((i) => i.type === 'function_call_output');
  check(!!call1 && fc?.name === 'create_pages' && fco?.call_id === fc?.call_id && /Created/i.test(fco?.output ?? ''), `tool round trip: function_call → function_call_output with the same call_id (${fc?.call_id})`);
  check(second?.body.input.some((i) => i.type === 'reasoning' && i.encrypted_content && !i.id), 'reasoning replayed with encrypted content, without item ids');
  await chooseApproval(page, 'Review risky actions');

  // ---- panel on the new page: live edit through the tool loop
  await page.click('nav.lit-sidebar-container >> text=OpenAI Roadmap');
  await page.waitForSelector('.lit-page-content');
  await page.click('.lit-ai-button');
  await page.waitForSelector('.nc-ai-panel');
  await send(page, 'append "Edited through openai" to this page', true);
  await page.waitForFunction(() => document.querySelector('.lit-page-content')?.textContent?.includes('Edited through openai'), null, { timeout: 15000 }).catch(() => {});
  check((await page.locator('.lit-page-content').innerText()).includes('Edited through openai'), 'the agent’s edit shows on the open page live');
  await waitIdle(page);
  await page.screenshot({ path: `${OUT}/openai-04-panel-edit.png` });
  await page.click('.nc-ai-panel [aria-label="Hide chat"]').catch(() => {});

  // ---- web search: hosted web_search → numbered citation + web source
  await page.goto(`${h.base}/${domain}/chat`);
  await page.waitForSelector('.nc-ai-landing');
  await chat(page).locator('[aria-label="Add files and settings"]').last().click();
  await option(page, 'Web').click();
  await page.waitForSelector('[role=alertdialog]:has-text("Confirm this action?")');
  await page.locator('[role=alertdialog] button', { hasText: 'Enable web access' }).click();
  await clearMock();
  await send(page, 'What is the latest Litpage news on the web?');
  await waitIdle(page);
  const web = lastAnswer(page);
  const webSteps = await web.locator('[data-testid="ai-agent-steps"]').innerText().catch(() => '');
  check(webSteps.includes('Searched') && webSteps.includes('litpage agent news'), `web search step (${webSteps.replace(/\n/g, ' | ')})`);
  const webText = await web.locator('.nc-ai-md').first().innerText().catch(() => '');
  check((await web.locator('.nc-ai-cite').count()) >= 1 && !webText.includes('](') && !webText.includes('utm_source'), 'citation chip instead of the inline ([site](url)) link');
  check((await web.locator('.nc-ai-source.web').first().getAttribute('href')) === 'https://example.com/lit-agent', 'Sources row links the cited page (tracking parameter removed)');
  reqs = await mockRequests();
  check(reqs.some((x) => (x.body.tools ?? []).some((t) => t.type === 'web_search') && x.body.include.includes('web_search_call.action.sources')), 'request carries the hosted web_search tool');
  await page.screenshot({ path: `${OUT}/openai-05-web.png` });
  await chat(page).locator('[aria-label="Turn off web browser"]').click().catch(() => {});

  // ---- MCP: a custom MCP server's tools run as client tools through openai (approval rules apply)
  await chat(page).locator('[aria-label="Add files and settings"]').last().click();
  await option(page, 'Connections').hover();
  await option(page, 'Add Connections').click();
  const dlg = page.locator('[role=dialog][aria-label="External MCP endpoint"]');
  await dlg.waitFor();
  await dlg.locator('input').nth(0).fill('Weather');
  await dlg.locator('input').nth(1).fill(mcp.url);
  await dlg.locator('input').nth(2).fill('mcp-secret');
  await dlg.locator('button', { hasText: 'Connect' }).click();
  await dlg.waitFor({ state: 'detached', timeout: 8000 });
  await clearMock();
  await send(page, 'What is the weather? Use the MCP tool.');
  await waitIdle(page);
  const mcpText = await lastAnswer(page).innerText();
  check(mcpText.includes('Ran MCP tool: get_weather') && mcpText.includes('Sunny, 21°C in Seoul'), `MCP tool step and answer through openai (${mcpText.replace(/\n/g, ' | ').slice(0, 120)})`);
  check(mcp.calls.length === 1 && mcp.calls[0].name === 'get_weather', 'the MCP server received the tool call');
  reqs = await mockRequests();
  check(reqs.some((x) => (x.body.tools ?? []).some((t) => t.type === 'function' && /^mcp_[0-9a-f]{8}_get_weather$/.test(t.name))) && reqs.some((x) => x.body.input.some((i) => i.type === 'function_call' && /^mcp_/.test(i.name))), 'MCP tools are plain function tools in the Responses request (no hosted MCP)');
  await send(page, 'Use the MCP tool to delete everything.');
  const mcpCard = chat(page).locator('[data-testid="ai-approval-card"]').last();
  const asked = await mcpCard.waitFor({ timeout: 15000 }).then(() => true, () => false);
  check(asked && (await mcpCard.innerText()).includes('Run delete_everything'), 'a destructive MCP tool asks for approval');
  if (asked) await button(mcpCard, 'Reject').click();
  await waitIdle(page);
  check(mcp.calls.length === 1, 'the rejected MCP call never reaches the server');

  // ---- refusal + rate limit + max tokens
  await send(page, 'Tell me something [[refusal]]');
  await waitIdle(page);
  check((await lastAnswer(page).innerText()).includes('Litpage AI can’t help with that request.'), 'a refusal content part shows Litpage’s refusal text');
  await send(page, 'trigger [[429]] please');
  await waitIdle(page, 40000);
  check((await lastAnswer(page).innerText()).includes('too many requests'), 'HTTP 429 (after retries) shows the friendly rate-limit error');
  await send(page, 'please answer [[incomplete]]');
  await waitIdle(page);
  check((await lastAnswer(page).innerText()).includes('This answer was cut'), 'an incomplete (max_output_tokens) answer keeps its text');

  // ---- inline writer (Space → Continue writing → Accept)
  await newPageWithEmptyLine(page, 'Writer via openai');
  await clearMock();
  await page.keyboard.press(' ');
  await writerFocused(page);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid="ai-inline-writer"] .nc-ai-writer-preview')?.textContent?.includes('next step'), null, { timeout: 15000 });
  await writerFocused(page, 'done');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check((await blockTexts(page)).includes('text-block:The story continues with a bold next step.'), 'inline writer: Continue writing → Accept writes the result');
  reqs = await mockRequests();
  check(reqs.some((x) => x.body.instructions.startsWith('You are Litpage AI, the writing assistant') && x.body.model === 'gpt-mock-astra' && x.body.reasoning?.effort === 'low'), 'writer request: default model, low effort');

  // ---- AI block
  await page.click('.lit-page-content .lit-text-block >> nth=-1');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/AI Block');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nc-ai-block-config');
  await page.click('.nc-ai-block-type:has-text("Key points")');
  await page.click('.nc-ai-block-config .nc-btn.primary');
  await page.waitForSelector('.nc-ai-block-footer', { timeout: 20000 });
  check((await page.locator('[data-testid="ai-block"]').innerText()).includes('Welcome to the workspace'), 'AI block generated through openai');
  await page.screenshot({ path: `${OUT}/openai-06-writer-block.png` });

  // ---- database autofill (fast model)
  await clearMock();
  const auto = await page.evaluate(async () => {
    const post = async (n, b) => (await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })).json();
    const hex = /([0-9a-f]{32})$/.exec(location.pathname)[1];
    const pageId = hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
    const pg = (await post('fetchRecords', { requests: [{ pointer: { table: 'block', id: pageId } }] })).recordMap.block[pageId].value.value;
    const sid = pg.space_id;
    const now = Date.now();
    const id = () => crypto.randomUUID();
    const dbId = id(), colId = id(), rowId = id();
    const op = (table, i, path, command, args) => ({ pointer: { table, id: i, spaceId: sid }, path, command, args });
    await post('applyChanges', { requestId: id(), transactions: [{ id: id(), spaceId: sid, operations: [
      op('block', dbId, [], 'set', { type: 'collection_view', collection_id: colId, view_ids: [], parent_id: pageId, parent_table: 'block', space_id: sid, alive: true, created_time: now, created_by_id: pg.created_by_id, last_edited_time: now, last_edited_by_id: pg.created_by_id }),
      op('block', pageId, ['content'], 'listAfter', { id: dbId }),
      op('collection', colId, [], 'set', { parent_id: dbId, parent_table: 'block', alive: true, space_id: sid, schema: { title: { name: 'Name', type: 'title' }, size: { name: 'Size', type: 'select', options: [{ id: 'a', value: 'Small', color: 'gray' }, { id: 'b', value: 'Large', color: 'red' }] } } }),
      op('block', rowId, [], 'set', { type: 'page', properties: { title: [['Acme expansion deal']] }, parent_id: colId, parent_table: 'collection', space_id: sid, alive: true, created_time: now, created_by_id: pg.created_by_id, last_edited_time: now, last_edited_by_id: pg.created_by_id }),
    ] }] });
    return post('aiAutofill', { rowId, propId: 'size', kind: 'custom', prompt: 'Deal size' });
  });
  check(JSON.stringify(auto.value) === '[["Large"]]', `autofill through openai returns the select value (${JSON.stringify(auto.value)})`);
  reqs = await mockRequests();
  check(reqs.some((x) => x.body.instructions.startsWith('You fill in one property value') && x.body.model === 'gpt-mock-luna'), 'autofill runs on the fast model');

  // ---- Custom Agent: a manual run through openai as the agent's bot
  check(!(await call(page, 'changePlan', { spaceId, plan: 'business' })).__error, 'workspace on the Business plan (simulated billing)');
  const created = await call(page, 'createAgent', { spaceId });
  const agentId = created.agentId;
  await call(page, 'updateAgentDraft', { agentId, patch: { name: 'OpenAI reporter' } });
  const det = await call(page, 'getAgent', { agentId });
  const instrId = det.config?.instructions_page_id;
  if (instrId) await addBlock(page, spaceId, instrId, { type: 'text', title: [['Write a short report page every run.']] });
  const saved = await call(page, 'saveAgent', { agentId });
  check(!!agentId && !saved.__error, `Custom Agent created and saved${saved.__error ? ` (${saved.message})` : ''}`);
  await clearMock();
  await call(page, 'runAgent', { agentId });
  const run = await waitFor(async () => {
    const r = await call(page, 'getAgentRuns', { agentId });
    return (r.runs ?? []).find((x) => x.kind === 'manual' && ['success', 'failed', 'skipped', 'needs_review'].includes(x.status));
  }, 30000, 500);
  check(run?.status === 'success' && /report/i.test(run?.result ?? ''), `manual Custom Agent run finished through openai: ${run?.status ?? 'none'} (${(run?.result ?? run?.error ?? '').slice(0, 80)})`);
  reqs = await mockRequests();
  const agentReq = reqs.find((x) => /You are a custom agent in a Litpage workspace/i.test(x.body.instructions));
  check(!!agentReq && agentReq.body.model === 'gpt-mock-astra' && (agentReq.body.tools ?? []).some((t) => t.name === 'create_pages'), 'agent request: default model + agent tools as function tools');
  const agentLoop = reqs.find((x) => /You are a custom agent in a Litpage workspace/i.test(x.body.instructions) && x.body.input.some((i) => i.type === 'function_call_output'));
  const agentCall = agentLoop?.body.input.find((i) => i.type === 'function_call');
  check(agentCall?.name === 'create_pages' && agentLoop.body.input.some((i) => i.type === 'function_call_output' && i.call_id === agentCall.call_id), 'the agent’s tool call (create_pages) round-trips its result by call_id');
  check((run?.credits ?? 0) > 0, `run credits computed from the Responses usage (${run?.credits})`);

  // ---- every request was a valid Responses request; no key in the logs
  await mockRequests();
  const all = [...everyRequest.values()];
  const bad = all.filter((x) => x.body.store !== false || x.body.stream !== true || !x.body.instructions || 'max_output_tokens' in x.body || (x.body.tools ?? []).some((t) => t.type === 'function' && t.strict !== false) || x.body.input.some((i) => i.id));
  check(all.length >= 15 && bad.length === 0, `all ${all.length} requests of this run: store:false, stream:true, instructions, strict:false tools, no item ids, no max_output_tokens`);
  const logs = h.logs().join('\n');
  check(!logs.includes('Bearer test-key') && !/OPENAI_API_KEY=/.test(logs), 'the openai key never appears in server logs');
  check(/\[ai\] chat failed: rate_limited status=429 request_id=req_mock_429/.test(logs), 'provider errors are logged with status / request id only');
  check(!pageErrors.length, `no page errors (${pageErrors.slice(0, 2).join(' | ')})`);
} catch (e) {
  failures++;
  console.log('E2E FAILED', e.message);
  await page.screenshot({ path: `${OUT}/openai-error.png` }).catch(() => {});
} finally {
  await browser.close();
  h.stop();
  mcp.close();
}
console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);




//   Revoke → 401), shared chats (Share chat → B sees it read-only, Settings › Public pages › AI chats shared, Stop
//   sharing), Pin + Change icon in the sidebar, Inbox → Prioritize with AI, New database → Build with AI, HTML block →
//   Build with AI, AI block (Action items, Specific pages), "/skill" in the editor and writer @page references.
//   node e2e/ai-workspace.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { startHarness } from './ai-harness.mjs';

const SCRATCH = '/tmp/nc-e2e';
const OUT = process.env.NC_SHOTS ?? `${SCRATCH}/e2e-ai`;
mkdirSync(OUT, { recursive: true });
const h = await startHarness({ key: true, apiPort: 3113, webPort: 5413, mockPort: 3112, dataDir: `${SCRATCH}/wave3/ai/data` });
process.env.NC_BASE = h.base;
const { CHROME } = await import('./lib.mjs');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
const ITEM = '.lit-overlay-container :is([role=option], [role=menuitem])';
const option = (page, text) => page.locator(ITEM, { hasText: text }).first();
const call = (page, name, body = {}) => page.evaluate(async ([n, b]) => {
  const r = await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [name, body]);
async function toast(page, re, timeout = 10000) {
  return page.waitForFunction((src) => [...document.querySelectorAll('.nc-toast')].some((t) => new RegExp(src).test(t.textContent ?? '')), re.source, { timeout }).then(() => true, () => false);
}
async function waitIdle(page, scope, timeout = 25000) {
  await page.waitForFunction((sel) => !document.querySelector(`${sel} .nc-ai-row.assistant[aria-busy="true"]`), scope, { timeout });
}
async function escapeAll(page) {
  for (let i = 0; i < 5 && (await page.locator('.lit-overlay-container .nc-overlay').count()); i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
}
/** Sign in with a dev login code (API), finish onboarding, optionally create a workspace. */
async function apiLogin(page, { email, name, workspace = null }) {
  await page.goto(`${h.base}/login`);
  const res = await page.evaluate(async ([email, name, ws]) => {
    const post = (n, b) => fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const { devCode } = await post('sendSignInCode', { email });
    const { userId } = await post('signInWithEmail', { email, code: devCode });
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: '', operations: [{ pointer: { table: 'lit_user', id: userId }, path: [], command: 'update', args: { name, given_name: name, onboarding_completed: true } }] }] });
    const spaceId = ws ? (await post('createWorkspace', { name: ws })).spaceId : null;
    return { userId, spaceId };
  }, [email, name, workspace]);
  await page.goto(`${h.base}/`);
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await page.waitForTimeout(500);
  return res;
}
async function newPage(page, title) {
  await page.click('[aria-label="New page"]');
  await page.waitForTimeout(300);
  const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
  if (await pageItem.count()) await pageItem.first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.locator('h1[data-content-editable-leaf]').last().click();
  await page.keyboard.type(title);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
}
async function openSettings(page, key) {
  if (!(await page.locator('.nc-set-dialog').count())) {
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector('.nc-set-dialog');
  }
  await page.click(`.nc-set-tab[data-settings-key="${key}"]`);
  await page.waitForTimeout(400);
}
async function closeSettings(page) {
  await escapeAll(page);
  if (await page.locator('.nc-set-dialog').count()) await page.locator('.nc-set-close').click();
  await page.waitForTimeout(200);
}
const sw = (page, label) => page.locator(`input[role=switch][aria-label="${label}"]`);
async function mcpRpc(token, method, params = {}, id = 1) {
  const r = await fetch(`${h.base}/api/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  return p;
};
const A = await mk();
const B = await mk();
const pageErrors = [];
A.on('pageerror', (e) => pageErrors.push(`A: ${e.message}`));
B.on('pageerror', (e) => pageErrors.push(`B: ${e.message}`));
try {
  const id = `${Date.now()}`;
  const a = await apiLogin(A, { email: `ai-ws-a${id}@test.dev`, name: 'Ann Owner', workspace: 'AI Works' });
  const bEmail = `ai-ws-b${id}@test.dev`;
  await call(A, 'inviteMembers', { spaceId: a.spaceId, emails: [bEmail], role: 'editor' });
  const b = await apiLogin(B, { email: bEmail, name: 'Ben Member' });
  await A.reload();
  await A.waitForSelector('nav.lit-sidebar-container');
  const domain = await A.evaluate(() => location.pathname.split('/')[1]);

  
  await openSettings(A, 'lit-ai');
  await A.locator('[data-testid="ai-workspace-controls"]').scrollIntoViewIfNeeded();
  check(await A.locator('[data-testid="ai-workspace-controls"]').count() === 1, 'Litpage AI settings show the workspace controls');
  await sw(A, 'Allow web search for this workspace').click({ force: true });
  await A.waitForTimeout(600);
  check(!(await sw(A, 'Allow web search for this workspace').isChecked()), 'web search switched off');
  await A.screenshot({ path: `${OUT}/workspace-01-ai-settings.png` });
  await closeSettings(A);
  await A.goto(`${h.base}/${domain}/chat`);
  await A.waitForSelector('.nc-ai-landing');
  await A.waitForTimeout(500);
  await A.locator('.nc-ai-chat.page [aria-label="Add files and settings"]').last().click();
  const webRow = option(A, 'Web');
  const webText = await webRow.innerText();
  check(webText.includes('disabled by your workspace admin') && (await webRow.getAttribute('aria-disabled')) === 'true', 'the + menu locks Web when the workspace turned web search off');
  await escapeAll(A);
  const statusOff = await call(A, 'aiStatus', { spaceId: a.spaceId });
  check(statusOff.body?.policy?.webSearch === false, 'aiStatus reports the workspace policy');
  // the floating AI button lives on pages (not on the full-page chat)
  await A.goto(`${h.base}/${domain}`);
  await A.waitForSelector('nav.lit-sidebar-container');
  await A.waitForSelector('.lit-ai-button', { timeout: 8000 });
  await openSettings(A, 'lit-ai');
  await sw(A, 'Allow web search for this workspace').click({ force: true });
  await sw(A, 'Turn on Litpage AI').click({ force: true });
  await A.waitForTimeout(800);
  await closeSettings(A);
  await A.waitForTimeout(500);
  check(await A.locator('.lit-ai-button').count() === 0, 'turning Litpage AI off hides the AI button');
  const deniedB = await B.evaluate(async () => (await fetch('/api/ai/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'chat', text: 'hi' }) })).status);
  const deniedBody = await call(B, 'aiStatus', { spaceId: a.spaceId });
  check(deniedB >= 400 && deniedBody.body?.policy?.enabled === false, `members can't use AI while it is off (${deniedB})`);
  await openSettings(A, 'lit-ai');
  await sw(A, 'Turn on Litpage AI').click({ force: true });
  await A.waitForTimeout(800);
  await closeSettings(A);
  await A.waitForSelector('.lit-ai-button', { timeout: 8000 }).catch(() => {});
  check(await A.locator('.lit-ai-button').count() === 1, 'turning it back on restores the AI button');

  
  await openSettings(A, 'lit-mcp');
  const mcpBox = A.locator('[data-testid="lit-mcp-access"]');
  await mcpBox.scrollIntoViewIfNeeded();
  await mcpBox.locator('input[aria-label="Token name"]').fill('Claude Desktop');
  await mcpBox.locator(':is(button, [role=button])', { hasText: 'Create token' }).click();
  await A.waitForSelector('[data-testid="mcp-token-value"]');
  const token = (await A.locator('[data-testid="mcp-token-value"]').innerText()).trim();
  check(/^lp_pat_/.test(token), 'Create token shows a new token once');
  await A.screenshot({ path: `${OUT}/workspace-02-mcp-token.png` });
  const unauth = await mcpRpc(null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  check(unauth.status === 401, 'MCP without a token → 401');
  const init = await mcpRpc(token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  check(init.status === 200 && init.body?.result?.serverInfo?.name === 'Litpage MCP', 'MCP initialize');
  const list = await mcpRpc(token, 'tools/list', {}, 2);
  const names = (list.body?.result?.tools ?? []).map((t) => t.name);
  check(names.includes('lit-search') && names.includes('lit-create-pages'), `MCP tools/list (${names.length} tools)`);
  const search = await mcpRpc(token, 'tools/call', { name: 'lit-search', arguments: { query: 'Welcome to Litpage' } }, 3);
  const searchText = JSON.stringify(search.body?.result?.content ?? []);
  check(search.status === 200 && searchText.includes('Welcome to Litpage'), 'MCP tools/call lit-search finds the user’s page');
  const created = await mcpRpc(token, 'tools/call', { name: 'lit-create-pages', arguments: { pages: [{ title: 'From MCP', content: 'Written by an MCP client' }] } }, 4);
  check(created.status === 200 && !created.body?.result?.isError, 'MCP tools/call lit-create-pages acts as the user');
  await A.locator('[data-testid="lit-mcp-access"] :is(button, [role=button])', { hasText: 'Revoke' }).first().click();
  await A.locator('.nc-set-subdialog :is(button, [role=button])', { hasText: /^Revoke$/ }).last().click();
  await A.waitForTimeout(600);
  const revoked = await mcpRpc(token, 'tools/list', {}, 5);
  check(revoked.status === 401, 'Revoke → the token stops working');
  await closeSettings(A);
  await A.waitForTimeout(400);
  check(await A.locator('nav.lit-sidebar-container', { hasText: 'From MCP' }).count() >= 1, 'the page created over MCP shows up in the sidebar (realtime)');

  // ---------------- shared chat (read-only for B), pin, icon ----------------
  await A.goto(`${h.base}/${domain}/chat`);
  await A.waitForSelector('.nc-ai-landing');
  await A.locator('.nc-ai-chat.page .nc-ai-prompt').last().click();
  await A.keyboard.type('Hello from Ann');
  await A.keyboard.press('Enter');
  await A.waitForFunction(() => /\/chat\/[0-9a-f-]{36}$/.test(location.pathname), null, { timeout: 10000 });
  await waitIdle(A, '.nc-ai-chat.page');
  const chatId = await A.evaluate(() => location.pathname.split('/').pop());
  await A.click('[role="tab"][aria-label="Chat"]');
  const row = A.locator(`.nc-sb-item[href$="/chat/${chatId}"]`).first();
  await row.waitFor({ timeout: 10000 });
  await row.click({ button: 'right' });
  await option(A, 'Share chat').click();
  check(await toast(A, /Link copied/), 'Share chat copies the link');
  await B.goto(`${h.base}/${domain}/chat/${chatId}`);
  await B.waitForSelector('.nc-ai-row.assistant', { timeout: 15000 });
  const bView = await B.locator('.nc-ai-chat.page').innerText();
  check(bView.includes('This chat is read-only') && bView.includes('Ann Owner'), 'B sees the shared chat read-only');
  check(await B.locator('.nc-ai-chat.page .nc-ai-prompt').count() === 0, 'no composer on a shared chat');
  await B.screenshot({ path: `${OUT}/workspace-03-shared-chat.png` });
  await openSettings(A, 'public-pages');
  await A.locator('.nc-set-ptile', { hasText: 'AI chats shared' }).click();
  await A.waitForSelector('[data-testid="shared-ai-chats"]', { timeout: 8000 }).catch(() => {});
  check(await A.locator('[data-testid="shared-ai-chats"]').count() === 1, 'Settings › Public pages › AI chats shared lists it');
  await closeSettings(A);
  // pin + icon
  await row.click({ button: 'right' });
  await option(A, 'Pin').click();
  await A.waitForTimeout(500);
  await row.click({ button: 'right' });
  check(await option(A, 'Unpin').count() === 1, 'the chat is pinned (menu offers Unpin)');
  await option(A, 'Change icon').click();
  await A.waitForSelector('.nc-ai-icon-grid', { timeout: 5000 }).catch(() => {});
  const firstEmoji = A.locator('.nc-ai-icon-grid [role=option]').nth(4);
  const emoji = (await firstEmoji.innerText().catch(() => '')).trim();
  await firstEmoji.click();
  await A.waitForTimeout(500);
  check(!!emoji && (await row.innerText()).includes(emoji), `Change icon shows the emoji in the sidebar (${emoji})`);
  // stop sharing → B loses access
  await row.click({ button: 'right' });
  await option(A, 'Stop sharing').click();
  await A.waitForTimeout(500);
  await B.reload();
  await B.waitForSelector('.nc-ai-chat.page', { timeout: 10000 });
  await B.waitForTimeout(800);
  check((await B.locator('.nc-ai-chat.page .nc-ai-noaccess').innerText().catch(() => '')).includes('You cannot open this chat'), 'after Stop sharing B no longer sees the chat');

  // ---------------- Inbox → Prioritize with AI ----------------
  const pageId = await A.evaluate(async (spaceId) => {
    const post = (n, b) => fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const uc = await post('loadAccountData', {});
    const uid = Object.keys(uc.recordMap.lit_user ?? {})[0];
    const sv = Object.values(uc.recordMap.space_view ?? {}).map((e) => e.value?.value ?? e.value).find((v) => v.space_id === spaceId);
    const pid = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: pid, spaceId }, path: [], command: 'set', args: { id: pid, type: 'page', parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, properties: { title: [['Launch plan']] }, permissions: [{ type: 'space_permission', role: 'editor' }], created_by_id: uid, created_time: now, last_edited_time: now } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: pid } },
    ] }] });
    return pid;
  }, a.spaceId);
  // B mentions A in a comment on the page → A gets an Inbox item
  await B.evaluate(async ([pageId, mention]) => {
    const post = (n, b) => fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const uc = await post('loadAccountData', {});
    const uid = Object.keys(uc.recordMap.user_root)[0];
    const chunk = await post('fetchRecords', { requests: [{ pointer: { table: 'block', id: pageId } }] });
    const p = chunk.recordMap.block[pageId].value.value ?? chunk.recordMap.block[pageId].value;
    const did = crypto.randomUUID();
    const cid = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: p.space_id, operations: [
      { pointer: { table: 'discussion', id: did, spaceId: p.space_id }, path: [], command: 'set', args: { id: did, parent_id: pageId, parent_table: 'block', resolved: false, comments: [], space_id: p.space_id, alive: true, type: 'page', created_by_id: uid, created_time: now } },
      { pointer: { table: 'block', id: pageId, spaceId: p.space_id }, path: ['discussions'], command: 'listAfter', args: { id: did } },
      { pointer: { table: 'comment', id: cid, spaceId: p.space_id }, path: [], command: 'set', args: { id: cid, parent_id: did, parent_table: 'discussion', text: [['Please review the launch date '], ['‣', [['u', mention]]]], created_by_id: uid, created_time: now, last_edited_time: now, alive: true, space_id: p.space_id } },
      { pointer: { table: 'discussion', id: did, spaceId: p.space_id }, path: ['comments'], command: 'listAfter', args: { id: cid } },
    ] }] });
    await post('notifyComment', { commentId: cid });
  }, [pageId, a.userId]);
  await A.goto(`${h.base}/${domain}`);
  await A.waitForSelector('nav.lit-sidebar-container');
  await A.click('[aria-label="Inbox"]');
  await A.waitForTimeout(800);
  await A.locator('[aria-label="Use AI to prioritize"]').first().click();
  await A.waitForSelector('.nc-ai-panel', { timeout: 8000 });
  await A.waitForFunction(() => [...document.querySelectorAll('.nc-ai-panel .nc-ai-row.user')].some((r) => r.textContent?.includes('notifications should I handle first')), null, { timeout: 10000 });
  await A.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.nc-ai-panel .nc-ai-row')];
    return rows.length > 0 && rows[rows.length - 1].classList.contains('assistant') && rows[rows.length - 1].getAttribute('aria-busy') !== 'true';
  }, null, { timeout: 30000 });
  const inboxAnswer = await A.locator('.nc-ai-panel .nc-ai-row.assistant').last().innerText();
  check(/Your inbox: 1 unread notification/.test(inboxAnswer), `Prioritize with AI reads the Inbox (${inboxAnswer.replace(/\n/g, ' | ').slice(0, 140)})`);
  const unread = await call(A, 'countUnreadInbox', { spaceId: a.spaceId });
  check(unread.body && (unread.body.count ?? unread.body.unreadCount ?? 0) === 0, `the agent marked the notification read (${JSON.stringify(unread.body)})`);
  await A.screenshot({ path: `${OUT}/workspace-04-inbox.png` });
  await A.locator('.nc-ai-panel [aria-label="Hide chat"]').first().click().catch(() => {});
  // close the Inbox panel
  for (let i = 0; i < 3 && (await A.locator('.nc-inbox-panel').count()); i++) {
    await A.keyboard.press('Escape');
    await A.waitForTimeout(200);
    if (await A.locator('.nc-inbox-panel').count()) await A.click('[aria-label="Inbox"]').catch(() => {});
    await A.waitForTimeout(200);
  }

  // ---------------- New database → Build with AI ----------------
  await A.click('[aria-label="New page"]');
  await option(A, 'Database').click();
  await A.waitForSelector('[role=dialog][aria-label="New database"]', { timeout: 10000 });
  await A.locator('[role=dialog][aria-label="New database"] input.nc-new-db-ai-text').fill('a reading list for my book club');
  await A.keyboard.press('Enter');
  await A.waitForSelector('.nc-ai-panel', { timeout: 8000 });
  // the panel may still show the previous chat for a moment: wait for this request's turn
  await A.waitForFunction(() => [...document.querySelectorAll('.nc-ai-panel .nc-ai-row.user')].some((r) => r.textContent?.includes('Build this database')), null, { timeout: 10000 });
  await A.waitForFunction(() => {
    const rows = [...document.querySelectorAll('.nc-ai-panel .nc-ai-row')];
    return rows.length > 0 && rows[rows.length - 1].classList.contains('assistant') && rows[rows.length - 1].getAttribute('aria-busy') !== 'true';
  }, null, { timeout: 30000 });
  const buildAnswer = await A.locator('.nc-ai-panel .nc-ai-row.assistant').last().innerText();
  check(buildAnswer.includes('Reading list'), `Build with AI answer (${buildAnswer.replace(/\n/g, ' | ').slice(0, 160)})`);
  await A.waitForFunction(() => document.body.innerText.includes('Neuromancer') && document.body.innerText.includes('Dune'), null, { timeout: 10000 }).catch(() => {});
  const dbText = await A.locator('.lit-frame').first().innerText();
  check(dbText.includes('Reading list') && dbText.includes('Dune') && dbText.includes('Neuromancer') && dbText.includes('Author'), 'the database got its name, properties and rows');
  await A.screenshot({ path: `${OUT}/workspace-05-build-db.png` });
  await A.locator('.nc-ai-panel [aria-label="Hide chat"]').first().click().catch(() => {});

  // ---------------- editor: HTML block, AI block, /skill, writer @reference ----------------
  await newPage(A, 'Editor AI');
  await A.keyboard.type('/html');
  await A.waitForTimeout(450);
  await option(A, 'HTML').click();
  await A.waitForTimeout(500);
  if (!(await A.locator('.nc-html-tile').count())) await A.locator('.lit-page-content [role=button]', { hasText: 'Create or upload HTML' }).last().click();
  await A.locator('.nc-html-tile', { hasText: 'Dashboard' }).click();
  const htmlOk = await A.waitForFunction(() => [...document.querySelectorAll('.nc-html-frame iframe')].some((f) => (f.getAttribute('srcdoc') ?? '').includes('AI dashboard')), null, { timeout: 20000 }).then(() => true, () => false);
  check(htmlOk, 'HTML block → Build with AI → Dashboard renders the generated document');
  await A.screenshot({ path: `${OUT}/workspace-06-html.png` });

  // AI block: Action items from specific pages
  await newPage(A, 'AI block page');
  await A.keyboard.type('/AI Block');
  await A.waitForTimeout(450);
  await A.keyboard.press('Enter');
  await A.waitForSelector('.nc-ai-block-config');
  await A.click('.nc-ai-block-type:has-text("Action items")');
  await A.click('[data-testid="ai-block-sources"]');
  await option(A, 'Specific pages').click();
  await A.locator('.nc-ai-block-context-chip.ghost', { hasText: 'Add page' }).click();
  await A.waitForSelector('.nc-page-picker input');
  await A.keyboard.type('Launch');
  await A.waitForTimeout(700);
  await A.locator('.nc-page-picker [role=option]', { hasText: 'Launch plan' }).first().click();
  check(await A.locator('[data-testid="ai-block-ref"]', { hasText: 'Launch plan' }).count() === 1, 'AI block: Specific pages adds a page chip');
  await A.click('.nc-ai-block-config .nc-btn.primary');
  await A.waitForSelector('.nc-ai-block-footer', { timeout: 15000 });
  const todos = await A.locator('[data-testid="ai-block"] .lit-to_do-block').count();
  check(todos === 2, `AI block → Action items generates to-dos (${todos})`);

  // "/skill": a page used as a skill, then run from the slash menu
  await A.keyboard.press('Escape');
  const skill = await call(A, 'aiCreateSkill', { spaceId: a.spaceId, title: 'Pirate voice' });
  check(skill.status === 200, 'skill page created');
  await newPage(A, 'Skill page');
  await A.keyboard.type('/skill');
  await A.waitForTimeout(450);
  await option(A, 'Skills').click();
  await option(A, 'Pirate voice').waitFor({ timeout: 8000 });
  await option(A, 'Pirate voice').click();
  const skillOut = await A.waitForFunction(() => (document.querySelector('[data-testid="ai-inline-writer"] .nc-ai-writer-preview')?.textContent ?? '').includes('Skill applied: Pirate voice'), null, { timeout: 15000 }).then(() => true, () => false);
  check(skillOut, '"/skill" runs the chosen skill in the inline writer');
  await A.keyboard.press('Escape');
  await A.locator('.nc-ai-writer-confirm button.danger').click().catch(() => {});
  await A.waitForTimeout(300);

  // writer @reference
  await newPage(A, 'Writer page');
  await A.keyboard.press(' ');
  await A.waitForFunction(() => document.activeElement?.classList.contains('nc-ai-writer-input'), null, { timeout: 8000 });
  await A.keyboard.type('Write an intro like @Launch');
  await A.waitForTimeout(800);
  await A.locator('.nc-ai-writer-menu [role=option]', { hasText: 'Launch plan' }).first().click();
  check(await A.locator('[data-testid="ai-writer-ref"]', { hasText: 'Launch plan' }).count() === 1, 'writer: @ adds a page reference chip');
  await A.keyboard.press('Enter');
  const refOut = await A.waitForFunction(() => (document.querySelector('[data-testid="ai-inline-writer"] .nc-ai-writer-preview')?.textContent ?? '').includes('Written in the style of Launch plan'), null, { timeout: 15000 }).then(() => true, () => false);
  check(refOut, 'the writer reads the referenced page');
  await A.screenshot({ path: `${OUT}/workspace-07-editor-ai.png` });
  check(!pageErrors.length, `no page errors ${pageErrors.slice(0, 2).join(' | ')}`);
} catch (e) {
  failures++;
  console.log('FAIL exception', e?.message ?? e);
  await A.screenshot({ path: `${OUT}/workspace-error-a.png` }).catch(() => {});
  await B.screenshot({ path: `${OUT}/workspace-error-b.png` }).catch(() => {});
} finally {
  await browser.close();
  const logs = h.logs().filter((l) => /\[api\].*(error|Error)/.test(l) && !/AbortError|aborted/i.test(l)).slice(0, 10);
  if (logs.length) console.log(logs.join('\n'));
  h.stop();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

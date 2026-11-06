
// deletes pages and databases as the user, streams its steps, asks for approval ("Always ask", unsafe actions under
// "Review for me", plan mode), shows the "Changes made" card with Undo, updates open pages live (realtime), keeps
// steps / changes / feedback after a reload. Runs in an isolated server + Vite (e2e/ai-harness.mjs).
//   node e2e/ai-agent.mjs
import { mkdirSync } from 'node:fs';
import { startHarness } from './ai-harness.mjs';

const SCRATCH = '/tmp/nc-e2e';
const OUT = process.env.NC_SHOTS ?? `${SCRATCH}/e2e-ai`;
mkdirSync(OUT, { recursive: true });
const h = await startHarness({ key: true, apiPort: 3113, webPort: 5413, mockPort: 3112, dataDir: `${SCRATCH}/wave3/ai/data` });
process.env.NC_BASE = h.base;
const { launch, signup } = await import('./lib.mjs');

let failures = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
const scope = (page, panel) => (panel ? page.locator('.nc-ai-panel') : page.locator('.nc-ai-chat.page'));
const lastAnswer = (page, panel = false) => scope(page, panel).locator('.nc-ai-row.assistant').last();
async function waitIdle(page, timeout = 20000) {
  await page.waitForFunction(() => !document.querySelector('.nc-ai-row.assistant[aria-busy="true"]'), null, { timeout });
}
async function send(page, text, panel = false) {
  const input = scope(page, panel).locator('.nc-ai-prompt').last();
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}
async function approvalCard(page, panel = false) {
  const card = scope(page, panel).locator('[data-testid="ai-approval-card"]').last();
  await card.waitFor({ timeout: 15000 });
  return card;
}
const button = (host, label) => host.locator('[role=button]', { hasText: new RegExp(`^${label}$`) }).first();
const sidebarHas = (page, title) => page.locator('nav.lit-sidebar-container').innerText().then((t) => t.includes(title));
async function chooseApproval(page, label) {
  await page.locator('[data-testid="agent-service-approval-mode-button"]').last().click();
  await page.locator('.lit-overlay-container [role=option]', { hasText: label }).first().click();
  await page.waitForTimeout(150);
}

const { browser, context, page } = await launch();
try {
  await signup(page, `ai-agent-${Date.now()}@test.dev`, 'Ada Lovelace', 'Agent Lab');
  const domain = await page.evaluate(() => location.pathname.split('/')[1]);

  // ---- create a page (Review for me: no approval for a plain create), Changes made card, realtime sidebar ----
  await page.goto(`${h.base}/${domain}/chat`);
  await page.waitForSelector('.nc-ai-landing');
  await send(page, 'Please create a page called "Agent Roadmap"');
  await waitIdle(page);
  let ans = lastAnswer(page);
  const steps = await ans.locator('[data-testid="ai-agent-steps"]').innerText().catch(() => '');
  check(steps.includes('Added 1 page'), `step row "Added 1 page" (${steps.replace(/\n/g, ' | ')})`);
  check((await ans.innerText()).includes('I created Agent Roadmap'), 'agent summary after the tool call');
  const card = ans.locator('[data-testid="ai-changes-card"]');
  check((await card.innerText()).includes('Updated Agent Roadmap'), 'Changes made card names the page (“Updated Agent Roadmap”)');
  await page.waitForFunction(() => document.querySelector('nav.lit-sidebar-container')?.textContent?.includes('Agent Roadmap'), null, { timeout: 8000 }).catch(() => {});
  check(await sidebarHas(page, 'Agent Roadmap'), 'the new page shows up in the sidebar without a reload (realtime)');
  await page.screenshot({ path: `${OUT}/agent-01-created.png` });
  await button(card, 'Show changes').click();
  check((await card.innerText()).includes('Created'), 'Show changes lists the created page');
  await button(card, 'Undo').click();
  await button(card, 'Confirm Undo').click();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="ai-changes-card"]')].some((c) => c.textContent?.includes('Changes reverted')), null, { timeout: 8000 });
  check(true, 'Undo → "Changes reverted"');
  await page.waitForFunction(() => !document.querySelector('nav.lit-sidebar-container')?.textContent?.includes('Agent Roadmap'), null, { timeout: 8000 }).catch(() => {});
  check(!(await sidebarHas(page, 'Agent Roadmap')), 'Undo removed the page from the sidebar');

  // ---- Always ask: Reject leaves nothing, Continue applies ----
  await chooseApproval(page, 'Always ask');
  await send(page, 'Now create a page called "Approved Page"');
  let approval = await approvalCard(page);
  const approvalText = await approval.innerText();
  check(approvalText.includes('Create page “Approved Page”') && approvalText.includes('Continue with this step?'), 'approval card shows the planned page');
  check((await approval.innerText()).includes('Ship the agent'), 'approval card previews the content');
  await page.screenshot({ path: `${OUT}/agent-02-approval.png` });
  await button(approval, 'Reject').click();
  await waitIdle(page);
  ans = lastAnswer(page);
  check((await ans.innerText()).includes('Rejected'), 'rejected step is marked');
  check(!(await sidebarHas(page, 'Approved Page')), 'a rejected change creates nothing');
  await send(page, 'OK, create a page called "Approved Page"');
  approval = await approvalCard(page);
  await button(approval, 'Continue').click();
  await waitIdle(page);
  await page.waitForFunction(() => document.querySelector('nav.lit-sidebar-container')?.textContent?.includes('Approved Page'), null, { timeout: 8000 }).catch(() => {});
  check(await sidebarHas(page, 'Approved Page'), 'Continue creates the page');

  // ---- panel on a page: the agent edits the open page live, then deletes it (unsafe → approval) ----
  await page.click('nav.lit-sidebar-container >> text=Approved Page');
  await page.waitForSelector('.lit-page-content');
  await page.waitForFunction(() => document.querySelector('.lit-page-content')?.textContent?.includes('Ship the agent'), null, { timeout: 8000 });
  await page.click('.lit-ai-button');
  await page.waitForSelector('.nc-ai-panel');
  await send(page, 'append "Hello from the agent" to this page', true);
  approval = await approvalCard(page, true);
  await button(approval, 'Continue').click();
  await page.waitForFunction(() => document.querySelector('.lit-page-content')?.textContent?.includes('Hello from the agent'), null, { timeout: 10000 }).catch(() => {});
  check((await page.locator('.lit-page-content').innerText()).includes('Hello from the agent'), 'the open page shows the agent’s edit live');
  await waitIdle(page);
  await page.screenshot({ path: `${OUT}/agent-03-panel-edit.png` });
  await chooseApproval(page, 'Review risky actions');
  await send(page, 'rename this page to "Renamed by AI"', true);
  await waitIdle(page);
  await page.waitForFunction(() => document.querySelector('h1[data-content-editable-leaf]')?.textContent?.includes('Renamed by AI'), null, { timeout: 8000 }).catch(() => {});
  check((await page.locator('h1[data-content-editable-leaf]').innerText()).includes('Renamed by AI'), 'rename applied without approval under Review risky actions');
  // "suggest edits": the change lands as a suggested edit (struck old text + inserted new text) to accept or reject
  await send(page, 'suggest replacing "Ship the agent" with "Launch the agent"', true);
  await waitIdle(page);
  await page.waitForSelector('.lit-page-content .lit-suggestion-insert', { timeout: 8000 }).catch(() => {});
  const sugIns = (await page.locator('.lit-page-content .lit-suggestion-insert').allInnerTexts()).join(' ');
  const sugRem = (await page.locator('.lit-page-content .lit-suggestion-remove').allInnerTexts()).join(' ');
  check(sugIns.includes('Launch the agent') && sugRem.includes('Ship the agent'), `the agent’s suggested edit shows on the page (+${sugIns} / −${sugRem})`);
  check((await lastAnswer(page, true).locator('[data-testid="ai-agent-steps"]').innerText().catch(() => '')).includes('Suggested edits'), 'step row "Suggested edits"');
  await page.screenshot({ path: `${OUT}/agent-03b-suggested-edit.png` });
  await send(page, 'delete this page', true);
  approval = await approvalCard(page, true);
  const delText = await approval.innerText();
  check(delText.includes('Delete 1 page?') && delText.includes('Move pages to Trash'), 'deleting asks even under Review risky actions');
  await button(approval, 'Move pages to Trash').click();
  await waitIdle(page);
  await page.waitForFunction(() => !document.querySelector('nav.lit-sidebar-container')?.textContent?.includes('Renamed by AI'), null, { timeout: 8000 }).catch(() => {});
  check(!(await sidebarHas(page, 'Renamed by AI')), 'the page moved to Trash');
  await page.click('.nc-ai-panel [aria-label="Hide chat"]').catch(() => {});

  // ---- plan mode: plan card → Continue → executes ----
  await page.goto(`${h.base}/${domain}/chat`);
  await page.waitForSelector('.nc-ai-landing');
  await page.click('[aria-label="Add files and settings"]');
  await page.locator('.lit-overlay-container [role=option]', { hasText: 'Plan' }).first().click();
  check(await page.locator('[data-testid="ai-mode-pill"][data-mode="plan"]').count() === 1, 'Plan pill in the composer');
  await send(page, 'Prepare the launch');
  approval = await approvalCard(page);
  const planText = await approval.innerText();
  check(planText.includes('Launch checklist') && planText.includes('Add the launch tasks as to-dos'), 'plan card lists the steps');
  await page.screenshot({ path: `${OUT}/agent-04-plan.png` });
  await button(approval, 'Continue').click();
  await waitIdle(page);
  check((await lastAnswer(page).innerText()).includes('The plan is done'), 'approved plan is carried out');
  check(await sidebarHas(page, 'Launch checklist'), 'plan created the page');
  await page.locator('[data-testid="ai-mode-pill"] [aria-label="Disable planning mode"]').click();

  // ---- database + rows ----
  await send(page, 'Create a database with rows for my project');
  await waitIdle(page);
  ans = lastAnswer(page);
  const dbSteps = await ans.locator('[data-testid="ai-agent-steps"]').innerText();
  check(dbSteps.includes('Created database') && dbSteps.includes('Added 1 page'), `database steps (${dbSteps.replace(/\n/g, ' | ')})`);
  await page.click('nav.lit-sidebar-container >> text=Project tracker');
  await page.waitForFunction(() => document.body.innerText.includes('Kickoff') && document.body.innerText.includes('Write spec'), null, { timeout: 10000 }).catch(() => {});
  const dbText = await page.locator('.lit-frame').innerText();
  check(dbText.includes('Kickoff') && dbText.includes('Write spec') && dbText.includes('Status'), 'database page shows the rows and properties');
  await page.screenshot({ path: `${OUT}/agent-05-database.png` });

  // ---- persistence: steps, changes and feedback survive a reload ----
  await page.goBack();
  await page.waitForSelector('.nc-ai-row.assistant');
  await lastAnswer(page).hover();
  await lastAnswer(page).locator('[aria-label="Send positive feedback"]').click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForSelector('.nc-ai-row.assistant');
  ans = lastAnswer(page);
  check((await ans.locator('[data-testid="ai-agent-steps"]').innerText()).includes('Created database'), 'steps persist after reload');
  check((await ans.locator('[data-testid="ai-changes-card"]').count()) === 1, 'changes card persists after reload');
  check((await ans.locator('[aria-label="Send positive feedback"]').getAttribute('aria-pressed')) === 'true', 'feedback persists');
  const title = await page.evaluate(async () => {
    const id = location.pathname.split('/').pop();
    const r = await (await fetch('/api/rpc/aiGetThread', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ threadId: id }) })).json();
    return r.thread.title;
  });
  check(/\(AI title\)$/.test(title), `chat got an AI summary title (${title})`);
} catch (e) {
  failures++;
  console.log('FAIL exception', e?.message ?? e);
  await page.screenshot({ path: `${OUT}/agent-error.png` }).catch(() => {});
} finally {
  await browser.close();
  const logs = h.logs().filter((l) => /\[api\].*(error|Error)/.test(l) && !/AbortError|aborted/i.test(l)).slice(0, 10);
  if (logs.length) console.log(logs.join('\n'));
  h.stop();
}
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);

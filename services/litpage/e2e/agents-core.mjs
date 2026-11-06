
// (templates, Create blank), the agent page (Chat / Activity / Insights, Settings panel), instructions, Tools and
// permissions grants, triggers, Save, an "A page enters a database" trigger run that comments as the agent, chat that works
// with the agent's own access (creates a page where it may, can't find pages it wasn't given), Run, Activity details +
// feedback, Insights + CSV, sharing with the workspace and read-only settings for "Can view and interact", version
// history restore. Runs in an isolated server + Vite (e2e/ai-harness.mjs) unless NC_BASE points at running servers.
//   node e2e/agents-core.mjs
import { mkdirSync } from 'node:fs';
import { startHarness } from './ai-harness.mjs';

const SCRATCH = '/tmp/nc-e2e';
const OUT = process.env.NC_SHOTS ?? `${SCRATCH}/wave3/agt/shots`;
mkdirSync(OUT, { recursive: true });
const h = process.env.NC_BASE ? null : await startHarness({ key: true, apiPort: 3193, webPort: 5493, mockPort: 3194, dataDir: `${SCRATCH}/wave3/agt/data` });
if (h) process.env.NC_BASE = h.base;
const { launch, BASE } = await import('./lib.mjs');
const { apiLogin, call, waitFor } = await import('./ws-lib.mjs');
const { makePage, makeDatabase, tx, cryptoId } = await import('./fix-lib.mjs');

let failures = 0;
let passes = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (cond) passes++;
  else failures++;
};
const overlayOption = (page, text) => page.locator('.lit-overlay-container [role=option]', { hasText: text }).first();
// matches the item label exactly (descriptions such as “Can edit anything…” under Full access contain other labels)
const overlayItem = (page, label) => page.locator('.lit-overlay-container [role=option]').filter({ has: page.locator('.nc-menu-label .nc-ellipsis', { hasText: new RegExp(`^${label}$`) }) }).first();
const expand = (hex) => hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
async function waitIdle(page, timeout = 25000) {
  await page.waitForFunction(() => !document.querySelector('.nc-ai-row.assistant[aria-busy="true"]'), null, { timeout });
}
async function send(page, text) {
  const input = page.locator('.nc-agent-chat .nc-ai-prompt').last();
  await input.click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await waitIdle(page);
}
const lastAnswer = (page) => page.locator('.nc-agent-chat .nc-ai-row.assistant').last();

const { browser, page } = await launch();
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
try {
  const u = `${Date.now()}`;
  const ada = await apiLogin(page, { email: `agt-ada${u}@test.dev`, name: 'Ada Admin', workspace: 'Acme' });
  const spaceId = ada.spaceId;
  const benEmail = `agt-ben${u}@test.dev`;
  await call(page, 'inviteMembers', { spaceId, emails: [benEmail], role: 'editor' });
  check(!(await call(page, 'changePlan', { spaceId, plan: 'business' })).__error, 'workspace on the Business plan (simulated billing)');
  const projectsId = await makePage(page, spaceId, 'Projects', { lines: ['Team projects live here.'] });
  const tasks = await makeDatabase(page, spaceId, projectsId, 'Tasks');
  const secretId = await makePage(page, spaceId, 'Secret plans', { lines: ['Do not share.'] });
  await page.reload();
  await page.waitForSelector('nav.lit-sidebar-container');

  
  await page.click('[role=tab][aria-label="Chat"]');
  await page.waitForSelector('[data-testid=sidebar-agents]');
  check(await page.locator('[data-testid=sidebar-new-agent]').isVisible(), 'Chat tab shows the Agents section with “New agent”');
  await page.click('[data-testid=sidebar-new-agent]');
  await page.waitForSelector('[data-testid=new-agent-modal] [data-template-id]');
  const tabs = await page.locator('[data-testid=new-agent-modal] [role=tab]').allInnerTexts();
  const cards = await page.locator('[data-testid=new-agent-modal] [data-template-id]').count();
  check(tabs.includes('For everyone') && tabs.length >= 5 && cards >= 3, `New agent modal: ${tabs.length} template categories, ${cards} templates`);
  await page.screenshot({ path: `${OUT}/core-01-new-agent.png` });
  const firstTitle = (await page.locator('[data-testid=new-agent-modal] [data-template-id] .ttl').first().innerText()).replace(/New$/, '').trim();
  await page.locator('[data-testid=new-agent-modal] [data-template-id]').first().click();
  await page.waitForSelector('[data-testid=agent-page]');
  await page.waitForFunction(() => (document.querySelector('[data-testid=agent-instructions]')?.textContent ?? '').length > 40, null, { timeout: 10000 }).catch(() => {});
  const tplName = await page.locator('[data-testid=agent-name-input]').inputValue();
  const tplInstructions = await page.locator('[data-testid=agent-instructions]').innerText();
  check(tplName === firstTitle && tplInstructions.length > 40, `template agent “${tplName}” starts with instructions (${tplInstructions.length} chars)`);

  
  await page.click('[data-testid=sidebar-new-agent]');
  await page.click('[data-testid=create-blank-agent]');
  await page.waitForFunction((n) => !location.pathname.includes('/agent/') || document.querySelector('[data-testid=agent-name-input]')?.value !== n, tplName);
  await page.waitForSelector('[data-testid=agent-pending-banner]');
  const agentId = expand(page.url().split('/agent/')[1].split('?')[0]);
  const tabNames = await page.locator('.nc-agent-tabs [role=tab]').allInnerTexts();
  check(tabNames.join(',') === 'Chat,Activity,Insights', `agent page tabs: ${tabNames.join(' · ')}`);
  check(await page.locator('[data-testid=agent-settings]').isVisible(), 'Settings panel open next to the chat for a new agent');

  // name → unsaved edit
  await page.fill('[data-testid=agent-name-input]', 'Triage bot');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=agent-unsaved]');
  check((await page.locator('[data-testid=agent-unsaved]').innerText()).includes('1 pending edit'), 'renaming shows “1 pending edit”');

  
  await page.locator('[data-testid=agent-instructions] .nc-agent-instructions-empty').click();
  await page.waitForTimeout(300);
  await page.keyboard.type('Triage new tasks: leave a short comment on every new task.');
  await page.waitForTimeout(1200);
  const detail0 = await call(page, 'getAgent', { agentId });
  const chunk = await call(page, 'loadPage', { pageId: detail0.instructionsPageId });
  const instrText = JSON.stringify(chunk.recordMap?.block ?? {});
  check(instrText.includes('Triage new tasks'), 'instructions are saved on the agent’s instructions page');

  
  await page.click('[data-testid=agent-add-page]');
  await page.locator('.nc-agent-picker-search input').fill('Projects');
  await page.locator('.nc-agent-picker-row', { hasText: 'Projects' }).first().click();
  const grantRow = page.locator(`[data-grant="${projectsId}"]`);
  await grantRow.waitFor();
  check((await grantRow.innerText()).includes('Can view'), 'page added under Tools and permissions with “Can view”');
  await grantRow.locator('[data-testid=agent-grant-role]').click();
  await overlayItem(page, 'Can edit').click();
  await page.waitForFunction((id) => document.querySelector(`[data-grant="${id}"]`)?.textContent?.includes('Can edit'), projectsId);
  check(true, 'grant raised to “Can edit”');

  
  await page.click('[data-testid=agent-add-trigger]');
  await overlayOption(page, 'A page enters a database').click();
  await page.waitForSelector('[data-testid=agent-trigger-pane]');
  await page.click('[data-testid=agent-trigger-database]');
  await page.locator('.nc-agent-picker-search input').fill('Tasks');
  await page.locator('.nc-agent-picker-row', { hasText: 'Tasks' }).first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid=agent-trigger-database]')?.textContent?.includes('Tasks'));
  check(await page.locator('.nc-agent-field-warn').isVisible(), 'trigger pane warns that any added page triggers a run');
  await page.click('[data-testid=agent-trigger-save]');
  await page.waitForSelector('[data-trigger-type="lit.page_created"]');
  check(await page.waitForFunction(() => document.querySelector('[data-trigger-type="lit.page_created"]')?.textContent?.includes('in Tasks')).then(() => true, () => false), 'trigger row “Page added in Tasks”');
  await page.click('[data-testid=agent-add-trigger]');
  await overlayOption(page, 'The agent is mentioned').click();
  await page.click('[data-testid=agent-trigger-save]');
  await page.waitForSelector('[data-trigger-type="lit.agent_mentioned"]');
  await page.screenshot({ path: `${OUT}/core-02-settings.png` });

  
  await page.click('[data-testid=agent-save]');
  await page.waitForSelector('[data-testid=agent-pending-banner]', { state: 'detached' });
  check(!(await page.locator('[data-testid=agent-unsaved]').count()), 'Save publishes the agent (no pending banner, no unsaved edits)');
  check((await page.locator('[data-testid=sidebar-agents]').innerText()).includes('Triage bot'), 'sidebar lists the saved agent');
  const detail = await call(page, 'getAgent', { agentId });
  const botId = detail.agent.botId;
  check(detail.agent.published && detail.config.triggers.length === 2 && detail.config.grants[0]?.role === 'read_and_write', 'server has the saved triggers and grants');

  
  const rowId = cryptoId();
  await tx(page, spaceId, [{ pointer: { table: 'block', id: rowId }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: tasks.colId, parent_table: 'collection', space_id: spaceId, alive: true, properties: { title: [['Fix login bug']] }, created_time: Date.now(), created_by_id: ada.userId, last_edited_time: Date.now(), last_edited_by_id: ada.userId } }]);
  const trigRun = await waitFor(async () => {
    const r = await call(page, 'getAgentRuns', { agentId });
    return (r.runs ?? []).find((x) => x.triggerType === 'lit.page_created' && ['success', 'failed', 'skipped'].includes(x.status));
  }, { timeout: 30000, interval: 500 });
  check(trigRun?.status === 'success', `“Page added” run finished: ${trigRun?.status ?? 'none'}${trigRun?.error ? ` (${trigRun.error})` : ''}`);
  const rowChunk = await call(page, 'loadPage', { pageId: rowId });
  const botComment = Object.values(rowChunk.recordMap?.comment ?? {}).map((e) => e.value?.value ?? e.value).find((c) => c?.created_by_id === botId);
  check(!!botComment && JSON.stringify(botComment.text).includes('Triaged by the agent'), 'the agent commented on the new task as itself');

  
  await page.click('.nc-agent-tabs [data-tab=activity]');
  await page.waitForSelector('[data-testid=agent-activity] .nc-agent-run');
  const runRow = page.locator('.nc-agent-run[data-status=success]', { hasText: 'Page added' }).first();
  check(await runRow.isVisible(), 'Activity lists the successful “Page added” run');
  await runRow.click();
  await page.waitForSelector('[data-testid=agent-run-detail]');
  const detailText = await page.locator('[data-testid=agent-run-detail]').innerText();
  check(detailText.includes('Trigger details') && detailText.includes('triaged'), 'run details show the trigger and the agent’s answer');
  await page.locator('[data-testid=agent-run-feedback] [aria-label="Good response"]').click();
  await page.waitForTimeout(500);
  const fb = await call(page, 'getAgentRun', { runId: trigRun.id });
  check(fb.run?.feedback?.rating === 'positive', '👍 feedback is stored on the run');
  await page.screenshot({ path: `${OUT}/core-03-run-detail.png` });

  
  await page.click('.nc-agent-tabs [data-tab=chat]');
  await page.waitForSelector('.nc-agent-chat .nc-ai-prompt');
  await send(page, 'create a page called "Agent Notes" in "Projects"');
  const ans1 = await lastAnswer(page).innerText();
  check(ans1.includes('I created') && ans1.includes('Agent Notes'), 'chat: the agent creates a page where it has edit access');
  const projChunk = await call(page, 'loadPage', { pageId: projectsId });
  const notes = Object.values(projChunk.recordMap?.block ?? {}).map((e) => e.value?.value ?? e.value).find((b) => JSON.stringify(b?.properties?.title ?? '').includes('Agent Notes'));
  check(notes?.created_by_id === botId, 'the new page is created by the agent (its own principal), not by Ada');
  await send(page, 'create a page called "Leak" in "Secret plans"');
  const ans2 = await lastAnswer(page).innerText();
  const secretChunk = await call(page, 'loadPage', { pageId: secretId });
  const leaked = Object.values(secretChunk.recordMap?.block ?? {}).some((e) => JSON.stringify((e.value?.value ?? e.value)?.properties?.title ?? '').includes('Leak'));
  check(/can’t find|don’t have access/i.test(ans2) && !leaked, 'chat: the agent can’t reach a page it wasn’t given (even though Ada can)');
  await page.screenshot({ path: `${OUT}/core-04-chat.png` });

  
  await page.click('[data-testid=agent-run]');
  const manual = await waitFor(async () => {
    const r = await call(page, 'getAgentRuns', { agentId });
    return (r.runs ?? []).find((x) => x.kind === 'manual' && ['success', 'failed', 'skipped'].includes(x.status));
  }, { timeout: 25000, interval: 500 });
  check(manual?.status === 'skipped', `Run → manual run recorded as “No action” (${manual?.status ?? 'none'})`);

  // a second saved version: a description
  await page.locator('.nc-agent-desc-input').fill('Triages new tasks');
  await page.keyboard.press('Enter');
  await page.waitForSelector('[data-testid=agent-unsaved]');
  await page.click('[data-testid=agent-save]');
  await page.waitForSelector('[data-testid=agent-unsaved]', { state: 'detached' });

  
  await page.click('.nc-agent-tabs [data-tab=insights]');
  await page.waitForSelector('[data-testid=agent-insights-tiles]');
  const tiles = await page.locator('[data-testid=agent-insights-tiles]').innerText();
  const total = Number(/Total runs\s+(\d+)/.exec(tiles)?.[1] ?? 0);
  check(total >= 3, `Insights: Total runs ${total}`);
  check(await page.locator('[data-testid=agent-insights-runs] svg path').count() > 0, 'runs-per-day chart draws bars');
  await page.locator('[data-testid=agent-insights-runs] svg rect').last().hover();
  check(await page.locator('.nc-agent-chart-tip').isVisible(), 'hovering a day shows the tooltip');
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.click('[data-testid=agent-insights-export]')]);
  check(/\.csv$/.test(download.suggestedFilename()), `Export as CSV downloads ${download.suggestedFilename()}`);
  await page.screenshot({ path: `${OUT}/core-05-insights.png` });

  
  await page.click('[data-testid=agent-share]');
  await page.waitForSelector(`[data-testid=agent-share-menu] [data-share-row="${ada.userId}"]`);
  const shareText = await page.locator('[data-testid=agent-share-menu]').innerText();
  check(shareText.includes('Full access') && shareText.includes('(You)'), 'Share lists Ada with Full access');
  check(await page.locator('[data-testid=agent-share-warning]').isVisible(), 'Share warns that the agent can reach private pages');
  await page.locator('.nc-agent-share-general').click();
  await overlayOption(page, 'Everyone at').click();
  await page.waitForFunction(() => document.querySelector('[data-share-row=space]')?.textContent?.includes('View and use'));
  const sharing = await call(page, 'getAgentSharing', { agentId });
  check(sharing.sharing?.some((s) => s.type === 'space_permission' && s.role === 'reader'), 'agent shared with everyone at Acme (View and use)');
  await page.keyboard.press('Escape');

  
  await page.click('[data-testid=agent-more]');
  await overlayOption(page, 'Version history').click();
  await page.waitForSelector('[data-testid=agent-versions] [data-version-id]');
  const versions = await page.locator('[data-testid=agent-versions] [data-version-id]').count();
  check(versions >= 2, `Version history lists ${versions} versions`);
  await page.locator('[data-testid=agent-versions] [data-version-id]').last().click();
  await page.click('[data-testid=agent-version-restore]');
  await page.locator('.nc-ai-dialog button', { hasText: 'Restore' }).click();
  await page.waitForSelector('[data-testid=agent-versions]', { state: 'detached' });
  const restored = await call(page, 'getAgent', { agentId });
  check(!restored.config.description && restored.config.name === 'Triage bot' && restored.config.triggers.length === 2, 'restoring the first version brings back its settings (no description)');
  const versions2 = await call(page, 'getAgentVersions', { agentId });
  check(versions2.versions.length === versions + 1, 'the restore is recorded as a new version');

  
  const ctxB = await browser.newContext({ viewport: { width: 1384, height: 853 }, locale: 'en-US' });
  const pageB = await ctxB.newPage();
  pageB.setDefaultTimeout(15000);
  await apiLogin(pageB, { email: benEmail, name: 'Ben Member', createWorkspace: false });
  await pageB.goto(`${BASE}/agent/${agentId.replace(/-/g, '')}?tab=settings`);
  await pageB.waitForSelector('[data-testid=agent-page]');
  await pageB.waitForSelector('[data-testid=agent-settings-readonly]');
  check(await pageB.locator('[data-testid=agent-name-input]').isDisabled(), 'Ben sees the settings read-only (name field disabled)');
  check(!(await pageB.locator('.nc-agent-tabs [data-tab=insights]').count()) && !(await pageB.locator('[data-testid=agent-save]').count()), 'Ben has no Insights tab and no Save');
  const benEdit = await call(pageB, 'updateAgentDraft', { agentId, patch: { name: 'Hijacked' } });
  check(benEdit.__error === 403, `the server refuses Ben’s settings change (${benEdit.__error})`);
  await pageB.screenshot({ path: `${OUT}/core-06-readonly.png` });
  await ctxB.close();

  check(!pageErrors.length, `no page errors${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('FAIL exception:', e.message.split('\n')[0]);
  failures++;
  await page.screenshot({ path: `${OUT}/core-error.png` }).catch(() => {});
} finally {
  await browser.close();
  h?.stop();
}
console.log(`\n${passes}/${passes + failures} passed`);
process.exit(failures ? 1 : 0);

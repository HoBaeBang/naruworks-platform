// Custom Agents around the workspace: the page Share menu (agent suggestions + confirmation, "Agents · N agents",
// Remove access, Advanced › Agent permissions, @-mentioning an agent on a page ("Invite agent to page?"), an

// for workspace owners (who can create agents, allowed models, the agents table). Isolated harness unless NC_BASE.
//   node e2e/agents-share.mjs
import { mkdirSync } from 'node:fs';
import { startHarness } from './ai-harness.mjs';

const SCRATCH = '/tmp/nc-e2e';
const OUT = process.env.NC_SHOTS ?? `${SCRATCH}/wave3/agt/shots`;
mkdirSync(OUT, { recursive: true });
const h = process.env.NC_BASE ? null : await startHarness({ key: true, apiPort: 3193, webPort: 5493, mockPort: 3194, dataDir: `${SCRATCH}/wave3/agt/data` });
if (h) process.env.NC_BASE = h.base;
const { launch, BASE } = await import('./lib.mjs');
const { apiLogin, call, waitFor } = await import('./ws-lib.mjs');
const { makePage, openPageById, domainOf } = await import('./fix-lib.mjs');

let failures = 0;
let passes = 0;
const check = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (cond) passes++;
  else failures++;
};
const overlayOption = (page, text) => page.locator('.lit-overlay-container [role=option]', { hasText: text }).first();

const { browser, context, page } = await launch();
await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
page.setDefaultTimeout(15000);
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
try {
  const u = `${Date.now()}`;
  const ada = await apiLogin(page, { email: `agts-ada${u}@test.dev`, name: 'Ada Admin', workspace: 'Acme' });
  const spaceId = ada.spaceId;
  await call(page, 'changePlan', { spaceId, plan: 'business' });
  // an agent shared with everyone at Acme that listens to mentions
  const created = await call(page, 'createAgent', { spaceId });
  const agentId = created.agentId;
  await call(page, 'updateAgentDraft', { agentId, patch: { name: 'Helper', triggers: [{ id: crypto.randomUUID(), type: 'lit.agent_mentioned', enabled: true }] } });
  await call(page, 'saveAgent', { agentId });
  await call(page, 'setAgentPermissions', { agentId, permissions: [{ type: 'user_permission', user_id: ada.userId, role: 'editor' }, { type: 'space_permission', role: 'reader' }] });
  const roadmapId = await makePage(page, spaceId, 'Roadmap', { lines: ['Q4 goals'] });
  const domain = await domainOf(page, spaceId);
  await page.reload();
  await page.waitForSelector('nav.lit-sidebar-container');

  
  await openPageById(page, BASE, domain, roadmapId);
  await page.locator('.lit-topbar [role=button]', { hasText: /^Share$/ }).first().click();
  await page.waitForSelector('.nc-share-people');
  const invite = page.locator('.lit-overlay-container input').first();
  await invite.fill('Help');
  await page.waitForSelector('[data-testid=share-agent-suggestions] [data-agent-id]');
  check((await page.locator('[data-testid=share-agent-suggestions]').innerText()).includes('Helper'), 'typing an agent’s name suggests the agent');
  await page.locator('[data-testid=share-agent-suggestions] [data-agent-id]').first().click();
  await page.locator('.nc-ai-dialog button', { hasText: 'Continue' }).click();
  await page.waitForSelector('[data-testid=share-agents]');
  check((await page.locator('[data-testid=share-agents] .nc-share-agents-count').innerText()).trim() === '1 available agent', 'Share menu shows “Agents · 1 available agent” after the confirmation');
  const det = await call(page, 'getAgent', { agentId });
  check(det.config.grants.some((g) => g.block_id === roadmapId && g.role === 'read_and_write'), 'the agent got Can edit on the page (Full access inviter)');
  await page.locator('[data-testid=share-agents] [aria-expanded]').click();
  await page.waitForSelector(`[data-testid=share-agents] [data-agent-id="${agentId}"]`);
  await page.screenshot({ path: `${OUT}/share-01-menu.png` });
  await page.locator(`[data-testid=share-agents] [data-agent-id="${agentId}"] .nc-share-role`).click();
  await overlayOption(page, 'Remove Helper’s access').click();
  await page.waitForSelector('[data-testid=share-agents]', { state: 'detached' });
  const after = await call(page, 'getAgent', { agentId });
  check(!after.config.grants.some((g) => g.block_id === roadmapId), 'Remove access takes the page away from the agent');
  // Advanced › Agent permissions
  await page.locator('.nc-share-advanced').click();
  await overlayOption(page, 'Restricted to Full access').click();
  await page.waitForTimeout(600);
  const chunk = await call(page, 'loadPage', { pageId: roadmapId });
  const rb = chunk.recordMap.block[roadmapId];
  check((rb.value?.value ?? rb.value).format?.agent_access_policy === 'full_access', 'Advanced › Agent permissions saves “Restricted to Full access”');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  
  await page.locator('[data-content-editable-leaf]', { hasText: 'Q4 goals' }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' @Help');
  await page.waitForSelector('.nc-mention-menu');
  const agentRow = overlayOption(page, 'Helper');
  check(await agentRow.isVisible(), 'the @ menu lists the agent under Agents');
  await agentRow.click();
  const toast = page.locator('.nc-toast', { hasText: 'Share page with agent?' });
  await toast.waitFor({ timeout: 10000 });
  check(true, 'mentioning an agent that can’t open the page asks “Share page with agent?”');
  await toast.locator('.nc-toast-action').click();
  const invited = await waitFor(async () => (await call(page, 'getPageAgents', { pageId: roadmapId })).agents?.some((a) => a.agentId === agentId), { timeout: 8000 });
  check(!!invited, 'Invite gives the agent access to the page');
  // the mention couldn't reach the agent (a blocked run in the Activity); Invite answers it
  const mentionRun = await waitFor(async () => (await call(page, 'getAgentRuns', { agentId })).runs?.find((r) => r.triggerType === 'lit.agent_mentioned' && (r.status === 'success' || r.status === 'skipped')), { timeout: 20000, interval: 500 });
  const mentionRuns = (await call(page, 'getAgentRuns', { agentId })).runs?.filter((r) => r.triggerType === 'lit.agent_mentioned') ?? [];
  check(!!mentionRun, `after Invite the agent answers the mention (${mentionRuns.map((r) => r.status).join(', ') || 'no runs'})`);

  
  const embedPageId = await makePage(page, spaceId, 'Team hub', { lines: [''] });
  await openPageById(page, BASE, domain, embedPageId);
  const emptyLeaf = page.locator('.lit-page-content [data-content-editable-leaf]').last();
  await emptyLeaf.click();
  const link = `${BASE}/agent/${agentId.replace(/-/g, '')}`;
  await page.evaluate((text) => {
    const el = document.activeElement;
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, link);
  await overlayOption(page, 'Embed').click();
  await page.waitForSelector('[data-testid=agent-embed] .nc-ai-prompt');
  check((await page.locator('[data-testid=agent-embed]').innerText()).includes('Helper'), 'pasting the agent link › Embed shows the agent chat in the page');
  await page.locator('[data-testid=agent-embed] .nc-ai-prompt').last().click();
  await page.keyboard.type('hello there');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-testid=agent-embed] .nc-ai-row.assistant:not([aria-busy="true"])')?.textContent?.length > 10, null, { timeout: 20000 });
  check(true, 'the embedded chat answers');
  const chatRun = await waitFor(async () => (await call(page, 'getAgentRuns', { agentId })).runs?.find((r) => r.kind === 'chat' && r.pageId === embedPageId), { timeout: 8000 });
  check(!!chatRun, 'the embedded chat is logged as a chat from that page');
  await page.screenshot({ path: `${OUT}/share-02-embed.png` });

  
  await page.goto(`${BASE}/${domain}/library/agents`);
  await page.waitForSelector(`[data-testid=agent-directory] [data-agent-id="${agentId}"]`);
  check(await page.locator('[data-testid=agent-dir-create]').isVisible(), 'Library › Agents shows the agent card and “Create new agent”');
  await page.click('[data-testid=agent-dir-status]');
  await page.locator('.lit-overlay-container [role=option]', { hasText: 'Disabled' }).click();
  await page.keyboard.press('Escape');
  await page.waitForSelector(`[data-testid=agent-directory] [data-agent-id="${agentId}"]`, { state: 'detached' });
  check(true, 'the Status filter hides active agents');
  await page.screenshot({ path: `${OUT}/share-03-library.png` });

  
  await page.keyboard.press('Meta+Comma');
  await page.waitForSelector('.nc-set-dialog');
  await page.click('.nc-set-tab[data-settings-key="lit-ai"]');
  await page.locator('.nc-set-pill', { hasText: 'Agents' }).click();
  await page.waitForSelector('[data-testid=agents-admin-table]');
  check((await page.locator('[data-testid=agents-admin-table]').innerText()).includes('Helper'), 'Settings › Litpage AI › Agents lists the workspace’s agents');
  await page.locator('[data-setting=agent-creation] .nc-set-dropdown').click();
  await overlayOption(page, 'Workspace owners').click();
  const policy = await waitFor(async () => {
    const uc = await call(page, 'loadAccountData', {});
    const s = uc.recordMap.space?.[spaceId];
    return (s?.value?.value ?? s?.value)?.settings?.agent_creation === 'owners';
  }, { timeout: 5000 });
  check(!!policy, '“Who can create agents” saves Workspace owners');
  await page.screenshot({ path: `${OUT}/share-04-admin.png` });

  
  await call(page, 'changePlan', { spaceId, plan: 'enterprise' });
  const idle = await call(page, 'createAgent', { spaceId });
  await call(page, 'updateAgentDraft', { agentId: idle.agentId, patch: { name: 'Idle helper' } });
  await call(page, 'saveAgent', { agentId: idle.agentId });
  await page.click('.nc-set-tab[data-settings-key="analytics"]');
  await page.locator('.nc-set-pill', { hasText: /^AI$/ }).click();
  await page.waitForSelector('[data-testid=analytics-agents] [data-agent-id]');
  check(await page.locator(`[data-testid=analytics-agents] tr[data-agent-id="${agentId}"]`).isVisible(), 'Analytics › AI lists the agent that ran under Custom Agents');
  check((await page.locator('[data-testid=analytics-agents-unused]').innerText()).includes('Idle helper'), 'an agent nobody used is listed as not used');
  await page.locator('[data-testid=analytics-agents]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/share-05-analytics.png` });
  await page.click('.nc-set-tab[data-settings-key="content-search"]');
  const ack = page.locator('.nc-set-btn, [role=button], button', { hasText: /^Acknowledge$/ }).first();
  if (await ack.isVisible().catch(() => false)) await ack.click();
  await page.waitForSelector('[data-filter=shared-with]');
  // unfiltered first: every page, including ones the agent can't open
  await page.waitForSelector(`.nc-set-cs-table tr[data-page-id="${embedPageId}"]`);
  await page.click('[data-filter=shared-with]');
  await page.locator('.lit-overlay-container [role=option]').filter({ hasText: /^\s*Helper\s*$/ }).first().click();
  const filtered = await page.waitForSelector(`.nc-set-cs-table tr[data-page-id="${embedPageId}"]`, { state: 'detached', timeout: 8000 }).then(() => true, () => false);
  const csRows = await page.locator('.nc-set-cs-table tbody tr').count();
  check(filtered && (await page.locator(`.nc-set-cs-table tr[data-page-id="${roadmapId}"]`).count()) === 1, `Content search › Shared with Helper lists only the pages it can access (${csRows})`);
  await page.click('[data-testid=content-search-agent-access]');
  await page.waitForSelector('[data-testid=agents-admin-resources] .nc-agent-row');
  check((await page.locator('[data-testid=agents-admin-resources]').innerText()).includes('Roadmap'), '“Manage access” shows what the agent can reach');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/share-06-content-search.png` });
  await page.locator('[data-testid=agents-admin-resources] .nc-agent-row', { hasText: 'Roadmap' }).locator('button, [role=button]', { hasText: 'Remove' }).click();
  await page.waitForSelector(`.nc-set-cs-table tr[data-page-id="${roadmapId}"]`, { state: 'detached' });
  check(true, 'removing the page from the agent drops it from the results');
  await page.keyboard.press('Escape');

  check(!pageErrors.length, `no page errors${pageErrors.length ? `: ${pageErrors.slice(0, 3).join(' | ')}` : ''}`);
} catch (e) {
  console.log('FAIL exception:', e.message.split('\n')[0]);
  failures++;
  await page.screenshot({ path: `${OUT}/share-error.png` }).catch(() => {});
} finally {
  await browser.close();
  h?.stop();
}
console.log(`\n${passes}/${passes + failures} passed`);
process.exit(failures ? 1 : 0);

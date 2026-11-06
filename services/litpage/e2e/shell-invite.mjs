// Shell: workspace invite link (/invite/<code>) → a new user logs in and lands in the inviting workspace.
import { launch, signup, BASE } from './lib.mjs';

const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
const a = await launch();
const b = await launch();
try {
  a.page.setDefaultTimeout(10000);
  b.page.setDefaultTimeout(15000);
  for (const x of [a, b]) x.page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
  await signup(a.page, `inv-a-${Date.now()}@test.dev`, 'Owner A', 'Invite Co');
  const code = await a.page.evaluate(() => globalThis.__records.all('space').find((s) => s.name === 'Invite Co')?.invite_link_code);
  ok(!!code, `owner workspace has an invite code (${code})`);
  // user B opens the invite link while logged out
  await b.page.goto(`${BASE}/invite/${code}`);
  await b.page.waitForURL(/\/login/);
  await b.page.fill('#email', `inv-b-${Date.now()}@test.dev`);
  await b.page.click('button[type=submit]');
  await b.page.waitForSelector('#code');
  const dev = await b.page.locator('.nc-auth-hint b').textContent();
  await b.page.fill('#code', dev.trim());
  await b.page.click('button[type=submit]');
  await b.page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await b.page.waitForTimeout(1000);
  const ws = await b.page.textContent('nav .lit-sidebar-switcher');
  ok(ws.includes('Invite Co'), `invited user lands in the workspace (${ws.trim()})`);
} catch (e) {
  console.log('E2E FAILED', e.message.slice(0, 400));
  process.exitCode = 1;
} finally {
  await a.browser.close();
  await b.browser.close();
}

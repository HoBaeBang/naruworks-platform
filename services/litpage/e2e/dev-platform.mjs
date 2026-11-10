
// Developer section → in-app developer tools › New connection (token shown once) → page ••• › More › Connections →
// the public REST API (/v1) with that token (search, retrieve, children, append, Markdown, unshared page = 404, version /
// auth errors, Vite /v1 proxy) and the page updating live → webhooks (verification token to a local receiver on 3203,
// verify in the UI, signed page.content_updated deliveries, no echo of the connection's own writes) → Settings ›
// Connections › Manage rows → deleting the connection revokes the token.
//   node e2e/dev-platform.mjs        (own servers: API 3201, web 5521; NC_CONNECTION_WEBHOOKS=1)
import http from 'node:http';
import { createHmac } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { SHOTS_ROOT, appendLine, reporter, startDevHarness } from './dev-harness.mjs';

const OUT = `${SHOTS_ROOT}/dev-platform`;
mkdirSync(OUT, { recursive: true });

// local webhook receiver (the only "external" endpoint; loopback)
const hooks = [];
const receiver = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    hooks.push({ path: req.url, headers: req.headers, body, time: Date.now() });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"ok":true}');
  });
});
await new Promise((r) => receiver.listen(3203, '127.0.0.1', r));

const h = await startDevHarness({ key: false, env: { NC_CONNECTION_WEBHOOKS: '1', NC_WEBHOOK_AGGREGATE_MS: '300' } });
process.env.NC_BASE = h.base;
const { launch } = await import('./lib.mjs');
const { apiLogin, createPrivatePage, compact, uniq, waitFor } = await import('./ws-lib.mjs');

const r = reporter();
const { browser, page } = await launch();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});
async function step(name, fn) {
  try {
    await fn();
  } catch (e) {
    r.ok(false, `${name}: ${String(e?.message ?? e).split('\n')[0]}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`);
    for (let i = 0; i < 3; i++) await page.keyboard.press('Escape').catch(() => {});
  }
}

const V = '2026-10-01';
async function v1(method, path, { token, body, version = V, base = h.api } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  if (version) headers['lit-version'] = version;
  const res = await fetch(`${base}/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const u = uniq();
let spaceId = '';
let domain = '';
let token = '';
let connectionId = '';
let pageId = '';
let secretId = '';
let verification = '';
try {
  ({ spaceId } = await apiLogin(page, { email: `dev${u}@test.dev`, name: 'Dana Developer', workspace: `Dev Co ${u}` }));
  domain = await page.evaluate(() => location.pathname.split('/')[1]);
  r.ok(!!spaceId && !!domain, 'signed in with a workspace');

  await step('developer mode → sidebar section', async () => {
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector('.nc-set-dialog');
    await page.click('.nc-set-tab[data-settings-key="developers"]');
    await page.locator('.nc-set-row[data-setting="developer-mode"] input[role="switch"]').click();
    await page.waitForTimeout(300);
    r.ok(await page.evaluate(() => localStorage.getItem('nc:developer-mode')) === '1', 'Settings › Developer › Enable developer features');
    // "Open developer tools" now opens the in-app developer tools
    await page.click('.nc-set-dev-link');
    await page.waitForURL(/\/developers$/);
    r.ok(await page.locator('.nc-set-dialog').count() === 0, '"Open developer tools" closes Settings and opens /developers');
    const sec = page.locator('[data-testid="sidebar-developer"]');
    await sec.waitFor();
    const rows = await sec.locator('.nc-dev-sb-row').allInnerTexts();
    r.ok(rows.join('|') === 'Connections|Access tokens', 'sidebar Developer section: Connections · Access tokens', rows);
    await shot('01-developer-section');
  });

  await step('new connection (token shown once)', async () => {
    await page.locator('[data-testid="sidebar-developer"] .nc-dev-sb-row', { hasText: 'Connections' }).click();
    await page.waitForURL(/\/developers\/connections$/);
    await page.locator('.nc-set-btn', { hasText: 'New connection' }).click();
    await page.fill('.nc-set-subdialog input[aria-label="Connection name"]', 'Build Bot');
    await page.keyboard.press('Enter');
    const revealed = page.locator('[data-testid="revealed-token"]');
    await revealed.waitFor();
    token = (await revealed.textContent()).trim();
    r.ok(/^lp_int_[A-Za-z0-9]{40,}$/.test(token), 'integration token issued (lp_int_…)');
    await shot('02-token-reveal');
    await page.locator('.nc-set-subdialog .nc-set-btn', { hasText: 'Copy, then close' }).click();
    await page.waitForURL(/\/developers\/connections\/[0-9a-f-]{36}$/);
    connectionId = page.url().split('/').pop();
    const masked = await page.locator('[data-testid="token-prefix"]').textContent();
    r.ok(!masked.includes(token) && masked.startsWith(token.slice(0, 10)) && masked.includes('•'), 'afterwards only the token prefix is shown', masked);
    const example = await page.locator('[data-testid="api-example"]').textContent();
    r.ok(example.includes('/v1/search') && !example.includes(token), '"Make your first request" example without the secret');
    await shot('03-connection-detail');
  });

  await step('share a page with the connection (page ••• › Connections)', async () => {
    pageId = await createPrivatePage(page, spaceId, `Roadmap API ${u}`);
    secretId = await createPrivatePage(page, spaceId, `Secret plans ${u}`);
    await page.goto(`${h.base}/${domain}/Roadmap-API-${compact(pageId)}`);
    await page.locator('h1[data-content-editable-leaf]').waitFor();
    await appendLine(page);
    await page.keyboard.type('Hello from the page');
    await page.waitForTimeout(800);
    await page.click('.lit-topbar-more-button');
    await page.locator('.nc-popover [role=option]', { hasText: /^More$/ }).hover();
    const conn = page.locator('.nc-page-submenu [role=menuitem], .nc-page-submenu [role=option]', { hasText: 'Connections' }).first();
    await conn.waitFor();
    await conn.hover();
    const search = page.locator('[role=menuitem], [role=option]', { hasText: 'Search connections…' }).first();
    await search.waitFor();
    await search.hover();
    const pick = page.locator('.nc-popover [role=menuitem], .nc-popover [role=option]', { hasText: 'Build Bot' }).last();
    await pick.waitFor();
    await shot('04-page-connections-search');
    await pick.click();
    await page.waitForTimeout(600);
    const toast = await page.locator('.nc-toast, [role="status"]').allInnerTexts().catch(() => []);
    r.ok(toast.some((x) => x.includes('Added Build Bot to this page')), 'connection added to the page (toast)', toast);
    for (let i = 0; i < 4; i++) await page.keyboard.press('Escape');
  });

  await step('public API with the token', async () => {
    const me = await v1('GET', '/users/me', { token });
    r.ok(me.status === 200 && me.json?.type === 'bot' && me.json?.name === 'Build Bot', 'GET /v1/users/me → the bot user', me.json);
    const s = await v1('POST', '/search', { token, body: { query: 'Roadmap' } });
    r.ok(s.status === 200 && s.json?.object === 'list' && s.json.results.some((x) => x.id === pageId), 'POST /v1/search finds the shared page');
    const s2 = await v1('POST', '/search', { token, body: { query: 'Secret' } });
    r.ok(s2.status === 200 && !s2.json.results.some((x) => x.id === secretId), 'search does not return unshared pages');
    const pg = await v1('GET', `/pages/${pageId}`, { token });
    r.ok(pg.status === 200 && pg.json?.properties?.title?.title?.[0]?.plain_text === `Roadmap API ${u}`, 'GET /v1/pages/:id', pg.json?.properties);
    const kids = await v1('GET', `/blocks/${pageId}/children`, { token });
    r.ok(kids.status === 200 && kids.json.results.some((b) => b.type === 'paragraph' && b.paragraph.rich_text.map((t) => t.plain_text).join('') === 'Hello from the page'), 'GET /v1/blocks/:id/children has the typed paragraph');
    const md = await v1('GET', `/pages/${pageId}/markdown`, { token });
    r.ok(md.status === 200 && md.json?.markdown?.includes('Hello from the page'), 'GET /v1/pages/:id/markdown', md.json);
    const hidden = await v1('GET', `/pages/${secretId}`, { token });
    r.ok(hidden.status === 404 && hidden.json?.code === 'object_not_found', 'unshared page → 404 object_not_found', hidden.json);
    const noVersion = await v1('GET', '/users/me', { token, version: null });
    r.ok(noVersion.status === 200 && noVersion.json?.type === 'bot', 'missing Litpage-Version defaults to 2026-10-01', noVersion.json);
    const unsupported = await v1('GET', '/users/me', { token, version: '2026-09-30' });
    r.ok(unsupported.status === 400 && unsupported.json?.code === 'validation_error' && unsupported.json?.message?.includes(V), 'unsupported Litpage-Version → 400 validation_error', unsupported.json);
    const badToken = await v1('GET', '/users/me', { token: 'lp_int_nope' });
    r.ok(badToken.status === 401 && badToken.json?.code === 'unauthorized', 'bad token → 401 unauthorized');
    const proxied = await v1('GET', '/users/me', { token, base: h.base });
    r.ok(proxied.status === 200 && proxied.json?.type === 'bot', 'the web dev server proxies /v1 to the API');
    // write through the API → the open page updates live
    const add = await v1('PATCH', `/blocks/${pageId}/children`, { token, body: { children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Written by the API' } }] } }] } });
    r.ok(add.status === 200 && add.json?.results?.length === 1, 'PATCH /v1/blocks/:id/children appends a paragraph', add.json);
    const live = await waitFor(() => page.locator('.lit-page-content', { hasText: 'Written by the API' }).count(), { timeout: 8000 });
    r.ok(!!live, 'the open page shows the API write without a reload');
    await shot('05-api-write-live');
  });

  await step('webhooks: verify + signed events, no echo', async () => {
    await page.goto(`${h.base}/${domain}/developers/connections/${connectionId}`);
    await page.locator('.nc-dev-tab', { hasText: 'Webhooks' }).click();
    await page.locator('.nc-set-btn', { hasText: 'Create a subscription' }).click();
    await page.fill('.nc-set-subdialog input[aria-label="Webhook URL"]', 'http://127.0.0.1:3203/hook');
    await page.locator('.nc-set-subdialog .nc-set-btn.primary', { hasText: 'Create a subscription' }).click();
    const vt = await waitFor(() => hooks.find((x) => x.path === '/hook' && JSON.parse(x.body || '{}').verification_token), { timeout: 8000 });
    r.ok(!!vt, 'verification token POSTed to the endpoint');
    verification = vt ? JSON.parse(vt.body).verification_token : '';
    r.ok(/^lp_whsec_/.test(verification), 'token looks like lp_whsec_…', verification.slice(0, 9));
    await page.waitForSelector('[data-testid="webhook-status"]');
    r.ok(await page.locator('[data-testid="webhook-status"].pending').count() === 1 && (await page.locator('[data-testid="webhook-status"]').textContent()).includes('until your endpoint is verified'), 'subscription pending verification');
    await page.locator('.nc-set-btn', { hasText: /^Verify$/ }).click();
    await page.fill('.nc-set-subdialog input[aria-label="Verification token"]', verification);
    await page.locator('.nc-set-subdialog .nc-set-btn.primary', { hasText: 'Verify subscription' }).click();
    await waitFor(async () => (await page.locator('[data-testid="webhook-status"].active').count()) === 1, { timeout: 6000 });
    r.ok(await page.locator('[data-testid="webhook-status"].active').count() === 1 && (await page.locator('[data-testid="webhook-status"]').textContent()).includes('up and running'), 'verified → active');
    await shot('06-webhook-active');

    // the connection's own write is not echoed back
    const before = hooks.length;
    await v1('PATCH', `/blocks/${pageId}/children`, { token, body: { children: [{ type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: 'Bot write' } }] } }] } });
    await new Promise((res) => setTimeout(res, 1500));
    r.ok(hooks.length === before, 'no webhook for the connection’s own change', hooks.slice(before).map((x) => x.body.slice(0, 120)));

    // a person edits the shared page → page.content_updated, signed with the verification token
    await page.goto(`${h.base}/${domain}/Roadmap-API-${compact(pageId)}`);
    const para = page.locator('.lit-page-content [data-content-editable-leaf]', { hasText: 'Hello from the page' }).first();
    await para.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' — edited');
    const ev = await waitFor(() => hooks.slice(before).find((x) => {
      try { return JSON.parse(x.body).type === 'page.content_updated'; } catch { return false; }
    }), { timeout: 10000 });
    r.ok(!!ev, 'page.content_updated delivered after a person’s edit');
    if (ev) {
      const body = JSON.parse(ev.body);
      r.ok(body.entity?.id === pageId && body.entity?.type === 'page' && body.integration_id === connectionId, 'event names the page and the connection', body);
      const sig = `sha256=${createHmac('sha256', verification).update(ev.body).digest('hex')}`;
      r.ok(ev.headers['x-lit-signature'] === sig, 'X-Litpage-Signature = HMAC-SHA256(body, verification token)');
      r.ok(Array.isArray(body.authors) && body.authors.some((a) => a.type === 'person'), 'authors list the person', body.authors);
    }
    // an unshared page's edits are not sent
    const n = hooks.length;
    await page.goto(`${h.base}/${domain}/Secret-plans-${compact(secretId)}`);
    const t2 = page.locator('h1[data-content-editable-leaf]');
    await t2.waitFor();
    await t2.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' (draft)');
    await new Promise((res) => setTimeout(res, 1800));
    r.ok(!hooks.slice(n).some((x) => x.body.includes(secretId)), 'no events for pages the connection can’t reach');
  });

  await step('Settings › Connections › Manage', async () => {
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector('.nc-set-dialog');
    await page.click('.nc-set-tab[data-settings-key="connections"]');
    await page.locator('.nc-set-pill', { hasText: 'Manage' }).click();
    const table = page.locator('[data-testid="api-connections"]');
    await table.waitFor();
    const txt = await table.innerText();
    r.ok(txt.includes('Build Bot') && txt.includes('Dana Developer'), 'API connection row (name, owner)', txt.slice(0, 200));
    await page.locator('[data-testid="api-connection-menu"]').first().click();
    const items = await page.locator('.lit-overlay-container [role=menuitem], .lit-overlay-container [role=option]').allInnerTexts();
    r.ok(['View access', 'Capabilities', 'Copy installation access token', 'Open in developer tools', 'Disconnect'].every((x) => items.some((i) => i.includes(x))), 'row ••• menu', items);
    await page.locator('.lit-overlay-container [role=menuitem], .lit-overlay-container [role=option]', { hasText: 'View access' }).first().click();
    await page.locator('[data-testid="connection-access"]').waitFor();
    r.ok((await page.locator('[data-testid="connection-access"]').innerText()).includes(`Roadmap API ${u}`), 'View access lists the shared page');
    await shot('07-manage-connections');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  });

  await step('audit log + delete connection', async () => {
    const audit = await page.evaluate(async (sid) => {
      const r = await fetch('/api/rpc/getAuditLog', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spaceId: sid, limit: 50 }) });
      return r.ok ? r.json() : { __error: r.status };
    }, spaceId);
    const events = (audit.entries ?? audit.events ?? []).map((e) => e.event);
    if (!audit.__error) r.ok(events.includes('integration.created'), 'audit log has integration.created', events.slice(0, 10));
    await page.locator('[data-testid="api-connection-menu"]').first().click();
    await page.locator('.lit-overlay-container [role=menuitem], .lit-overlay-container [role=option]', { hasText: 'Disconnect' }).first().click();
    await page.locator('.nc-set-subdialog .nc-set-btn.danger').click();
    await page.waitForTimeout(600);
    const after = await v1('GET', '/users/me', { token });
    r.ok(after.status === 401, 'deleted connection → its token is rejected (401)', after.status);
  });

  r.ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await browser.close().catch(() => {});
  h.stop();
  receiver.close();
  r.done('dev-platform');
}

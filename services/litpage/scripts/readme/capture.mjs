// README media: screenshots (light and dark) and the frames of the demo animation, taken from a local Litpage with
// sample content from the built-in templates. Starts its own API, web and mock AI servers (e2e/ai-harness.mjs; no
// real AI endpoint is called) on NC_E2E_PORTS, then writes PNG files and screencast frames to <out-dir>.
// Run from e2e/ (playwright-core lives there):
//   NC_E2E_PORTS=3071,5171,3072 node ../scripts/readme/capture.mjs <out-dir>
// Then build the README assets with scripts/readme/build-assets.sh <out-dir>.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startHarness } from '../../e2e/ai-harness.mjs';
import { launch } from '../../e2e/lib.mjs';
import { addView } from '../../e2e/dbv-lib.mjs';

const OUT = resolve(process.argv[2] ?? 'readme-raw');
mkdirSync(join(OUT, 'frames'), { recursive: true });
process.env.MOCK_DEMO_ANSWERS = join(dirname(fileURLToPath(import.meta.url)), 'demo-answers.json');

const h = await startHarness({ key: true, dataDir: mkdtempSync(join(tmpdir(), 'litpage-readme-')) });
const { browser, context, page } = await launch();
const wait = (ms) => page.waitForTimeout(ms);
const rpc = (name, body) => page.evaluate(async ([n, b]) => {
  const r = await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
  return r.json();
}, [name, body]);

async function signup() {
  await page.goto(`${h.base}/`);
  await page.waitForURL(/\/login/);
  await page.fill('#email', 'jamie@example.com');
  await page.click('button[type=submit]');
  await page.waitForSelector('#code');
  await page.fill('#code', (await page.locator('.nc-auth-hint b').textContent()).trim());
  await page.click('button[type=submit]');
  await page.waitForSelector('#name');
  await page.fill('#name', 'Jamie Park');
  await page.click('button[type=submit]');
  await page.click('text=Continue');
  await page.waitForSelector('#ws');
  await page.fill('#ws', 'Acme Studio');
  await page.click('button[type=submit]');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
}

async function prefs({ theme = 'light', locale = 'en-US' } = {}) {
  // the app keeps language and theme in the user's settings record (it wins over localStorage on load)
  await page.evaluate(async ([t, l]) => {
    const { records, transactions } = window.__ncEditor;
    const user = records.all('lit_user')[0];
    if (user) {
      const exists = !!records.get('user_settings', user.id);
      const patch = { locale: l, preferred_theme: t };
      transactions.run('', 'updateUserSettings', (tx) => {
        if (!exists) tx.set('user_settings', user.id, [], { id: user.id, settings: patch });
        else tx.update('user_settings', user.id, ['settings'], patch);
      }, { skipHistory: true });
      await transactions.flush();
    }
    localStorage.setItem('nc:theme', t);
    localStorage.setItem('nc:locale', l);
  }, [theme, locale]);
  await page.reload();
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await wait(800);
}

async function closeOverlays() {
  for (let i = 0; i < 4 && (await page.locator('.lit-overlay-container .nc-overlay-backdrop').count()); i++) {
    await page.keyboard.press('Escape');
    await wait(200);
  }
}

async function open(title) {
  await closeOverlays();
  await page.locator('nav.lit-sidebar-container [role=treeitem]', { hasText: title }).first().click();
  await page.waitForSelector('h1[data-content-editable-leaf], .nc-db-page', { timeout: 15000 });
  await wait(900);
}

async function viewTab(name) {
  await closeOverlays();
  const tab = page.locator('.nc-db .nc-view-tablist .lit-collection-view-tab', { hasText: name }).first();
  if (await tab.count()) await tab.click();
  else {
    // views that do not fit sit behind the "more" button
    await page.locator('.nc-db .nc-view-tabs-more').first().click();
    await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container .nc-menu-item', { hasText: name }).first().click();
  }
  await wait(900);
}

async function setRoadmapDates(pid) {
  await page.evaluate(async (pid) => {
    const { records, transactions } = window.__ncEditor;
    const b = records.get('block', pid);
  // date ranges around today so the timeline shows bars
  const colId = b.collection_id ?? b.format?.collection_pointer?.id;
  const schema = records.get('collection', colId)?.schema ?? {};
  const dateProp = Object.keys(schema).find((k) => schema[k].type === 'date');
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const RANGES = { 'Dark mode': [-11, -2], 'Offline sync': [-9, 8], 'Referral program': [1, 11], Widgets: [5, 14] };
  const rows = records.all('block').filter((r) => r.parent_id === colId && r.alive !== false && !r.is_template);
  transactions.run(b.space_id, 'readme.dates', (tx) => {
    for (const r of rows) {
      const name = (r.properties?.title ?? []).map((x) => x[0]).join('');
      const span = RANGES[name];
      if (span && dateProp) tx.set('block', r.id, ['properties', dateProp], [['‣', [['d', { type: 'daterange', start_date: day(span[0]), end_date: day(span[1]) }]]]]);
    }
  }, { skipHistory: true });
    await transactions.flush();
  }, pid);
}

async function shot(name, { scroll = 0 } = {}) {
  await closeOverlays();
  await page.evaluate(() => document.activeElement?.blur?.());
  if (scroll) { await page.mouse.move(1100, 600); await page.mouse.wheel(0, scroll); await wait(500); }
  await page.mouse.move(1430, 890);
  await wait(400);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log('shot', name);
}

await page.setViewportSize({ width: 1440, height: 900 });
await signup();
const domain = await page.evaluate(() => location.pathname.split('/')[1]);
const spaceId = await page.evaluate(() => window.__ncEditor.records.all('space')[0]?.id);
const TITLE = {};
for (const templateId of ['meeting-notes', 'project-tracker', 'roadmap', 'team-wiki']) {
  const r = await rpc('getTemplate', { templateId, spaceId });
  if (!r?.pageId) throw new Error(`template ${templateId}: ${JSON.stringify(r).slice(0, 300)} (space ${spaceId})`);
  TITLE[templateId] = r.pageId;
}
const ROADMAP_ID = TITLE.roadmap;
await prefs();
// screenshots read better without the roadmap's cover image
await page.evaluate(async (pid) => {
  const { records, transactions } = window.__ncEditor;
  const b = records.get('block', pid);
  transactions.run(b.space_id, 'readme.removeCover', (tx) => tx.update('block', pid, ['format'], { page_cover: null }), { skipHistory: true });
  await transactions.flush();
}, TITLE.roadmap);
for (const [k, id] of Object.entries(TITLE)) {
  TITLE[k] = await page.evaluate((pid) => {
    const { records } = window.__ncEditor;
    const b = records.get('block', pid);
    const text = (rt) => (rt ?? []).map((x) => x[0]).join('');
    return text(b?.properties?.title) || text(records.get('collection', b?.collection_id ?? b?.format?.collection_pointer?.id)?.name);
  }, id);
}
console.log('titles', JSON.stringify(TITLE));

// extra views on the roadmap: timeline and chart
await open(TITLE.roadmap);
const db = page.locator('.nc-db').first();
await setRoadmapDates(ROADMAP_ID);
await wait(800);
await addView(page, db, 'Timeline');
await addView(page, db, 'Chart');
await viewTab('By status');

const SHOTS = [
  ['editor', async () => open(TITLE['team-wiki'])],
  ['board', async () => { await open(TITLE.roadmap); await viewTab('By status'); }],
  ['timeline', async () => { await open(TITLE.roadmap); await viewTab('Timeline'); }],
  ['chart', async () => { await open(TITLE.roadmap); await viewTab('Chart'); }],
  ['ai', async () => {
    await page.goto(`${h.base}/${domain}/chat?q=${encodeURIComponent('Which roadmap items need attention this quarter?')}`);
    await page.waitForSelector('.nc-ai-message, .nc-ai-msg, [data-role="assistant"]', { timeout: 20000 }).catch(() => {});
    await wait(2500);
  }],
];
for (const theme of ['light', 'dark']) {
  await prefs({ theme });
  for (const [name, go, scroll] of SHOTS) { await go(); await shot(`${name}-${theme}`, { scroll }); }
}
await prefs({ theme: 'light', locale: 'ko-KR' });
await open(TITLE['team-wiki']);
await page.keyboard.press('Meta+Comma');
await wait(1500);
await page.screenshot({ path: join(OUT, 'korean-light.png') });
console.log('shot korean-light');
await page.keyboard.press('Escape');
await wait(400);
await prefs({ theme: 'dark', locale: 'ko-KR' });
await open(TITLE['team-wiki']);
await page.keyboard.press('Meta+Comma');
await wait(1500);
await page.screenshot({ path: join(OUT, 'korean-dark.png') });
console.log('shot korean-dark');
await page.keyboard.press('Escape');
await wait(400);

// demo animation: screencast frames (JPEG + timestamps) of writing a page, then switching database views
await prefs({ theme: 'light', locale: 'en-US' });
await page.setViewportSize({ width: 1280, height: 800 });
await open('Welcome to Litpage');
const cdp = await context.newCDPSession(page);
const frames = [];
cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
  frames.push({ t: metadata.timestamp, data });
  await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
});
await page.click('nav [aria-label="New page"]');
const item = page.locator('.lit-overlay-container [role="option"]', { hasText: /^Page$/ }).first();
if (await item.count()) await item.click();
await page.waitForSelector('h1[data-content-editable-leaf]');
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1280, maxHeight: 800, everyNthFrame: 1 });
await wait(600);
const type = async (s, d = 55) => { await page.keyboard.type(s, { delay: d }); };
await type('Launch plan');
await page.keyboard.press('Enter');
await wait(300);
await type('/head', 90);
await wait(700);
await page.keyboard.press('Enter');
await type('Goals');
await page.keyboard.press('Enter');
await type('/task', 90);
await wait(700);
await page.keyboard.press('Enter');
await type('Ship the public beta');
await page.keyboard.press('Enter');
await type('Write the launch post');
await page.keyboard.press('Enter');
await page.keyboard.press('Enter');
await type('/callout', 90);
await wait(700);
await page.keyboard.press('Enter');
await type('Everything lives in one self-hosted workspace.');
await wait(1200);
await open(TITLE.roadmap);
await viewTab('By status');
await wait(1000);
await viewTab('Timeline');
await wait(1400);
await viewTab('Chart');
await wait(1600);
await cdp.send('Page.stopScreencast');
frames.forEach((f, i) => writeFileSync(join(OUT, 'frames', `${String(i).padStart(4, '0')}.jpg`), Buffer.from(f.data, 'base64')));
writeFileSync(join(OUT, 'frames', 'times.json'), JSON.stringify(frames.map((f) => f.t)));
console.log('frames', frames.length);

await browser.close();
await h.stop();

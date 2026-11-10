// AI image generation end-to-end against the mock Anthropic API (the default provider asks
// Claude for an SVG; the server sanitises it and stores it as an uploaded file):
// Business plan → /image › AI tab (prompt + style → Generate Image) → stored SVG without script / handlers /
// links → "Polish with AI" on the generated image (redrawn) → unavailable on a non-AI image → "/AI Image" (Image creation)
// → page cover › AI tab → chat "generate an image of …" (generate_image tool, image shown in the answer) → Settings › AI › Image
// generation off (tab, slash item, Polish with AI gone; server refuses) → Plus plan (no tab; upsell; server refuses).
// node e2e/img-gen.mjs (own servers: API 3201, web 5521, mock 3202)
import { mkdirSync } from 'node:fs';
import { SHOTS_ROOT, appendLine, reporter, startDevHarness } from './dev-harness.mjs';

const OUT = `${SHOTS_ROOT}/images`;
mkdirSync(OUT, { recursive: true });

const h = await startDevHarness({ key: true });
process.env.NC_BASE = h.base;
const { launch } = await import('./lib.mjs');
const { apiLogin, call, compact, createPrivatePage, uniq, waitFor } = await import('./ws-lib.mjs');

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
const toasts = () => page.locator('.nc-toast').allInnerTexts().catch(() => []);
const fetchText = (src) => page.evaluate(async (s) => { const res = await fetch(s); return { status: res.status, type: res.headers.get('content-type'), text: await res.text() }; }, src);
async function openSettings(key) {
  if (!(await page.locator('.nc-set-dialog').count())) {
    await page.keyboard.press('Meta+Comma');
    await page.waitForSelector('.nc-set-dialog');
  }
  await page.click(`.nc-set-tab[data-settings-key="${key}"]`);
  await page.waitForTimeout(300);
}
async function closeSettings() {
  if (await page.locator('.nc-set-dialog').count()) await page.locator('.nc-set-close').click();
  await page.waitForTimeout(200);
}
/** New line at the end of the page (click below the content), then a slash command. */
async function slash(query) {
  await page.keyboard.press('Escape');
  await appendLine(page);
  await page.keyboard.type(query);
  await page.locator('.nc-slash-menu').waitFor();
  await page.waitForTimeout(150);
}
const slashItems = () => page.locator('.nc-slash-menu [role="option"]').allInnerTexts();
const images = () => page.locator('.lit-page-content img.nc-image');

const u = uniq();
let spaceId = '';
let domain = '';
let pageId = '';
let firstBlockId = '';
let firstSrc = '';
try {
  ({ spaceId } = await apiLogin(page, { email: `img${u}@test.dev`, name: 'Ivy Illustrator', workspace: `Pixel Co ${u}` }));
  r.ok(!(await call(page, 'changePlan', { spaceId, plan: 'business' })).__error, 'Business feature level');
  domain = await page.evaluate(() => location.pathname.split('/')[1]);
  pageId = await createPrivatePage(page, spaceId, `Launch visuals ${u}`);
  await page.goto(`${h.base}/${domain}/Launch-visuals-${compact(pageId)}`);
  await page.locator('h1[data-content-editable-leaf]').waitFor();

  await step('settings: Image generation on', async () => {
    await openSettings('lit-ai');
    const row = page.locator('.nc-set-row[data-setting="ai-image-generation"]');
    await row.waitFor();
    r.ok((await row.innerText()).includes('Turn on image generation') && await row.locator('input[role="switch"]').isChecked(), 'Settings › Litpage AI › Image generation › Turn on image generation (on)');
    await shot('01-settings');
    await closeSettings();
  });

  await step('image block › Litpage AI tab', async () => {
    await slash('/image');
    await page.keyboard.press('Enter');
    const picker = page.locator('.nc-media-picker');
    await picker.waitFor();
    const tabs = await picker.locator('[role="tab"]').allInnerTexts();
    r.ok(tabs.join('|') === 'Upload|Link|Unsplash|GIPHY|Litpage AI', 'image picker tabs include Litpage AI', tabs);
    await picker.locator('[role="tab"]', { hasText: 'Litpage AI' }).click();
    const form = page.locator('[data-testid="ai-image-tab"]');
    await form.waitFor();
    r.ok((await form.locator('.nc-aiimg-caption').innerText()).includes('Create a custom image with AI from your description'), 'caption');
    const styles = await form.locator('.nc-aiimg-style').allInnerTexts();
    r.ok(styles.length === 12 && styles[0] === 'General' && styles.includes('Diagram') && styles.includes('Modern Art'), 'style chips', styles);
    await form.locator('textarea').fill('A lighthouse at dusk');
    await form.locator('.nc-aiimg-style', { hasText: 'Diagram' }).click();
    await shot('02-lit-ai-tab');
    await form.locator('button', { hasText: 'Generate Image' }).click();
    await images().first().waitFor({ timeout: 20000 });
    firstSrc = await images().first().getAttribute('src');
    r.ok(/^\/files\/[0-9a-f-]+\/.+\.svg$/.test(firstSrc), 'image block shows the stored SVG', firstSrc);
    const svg = await fetchText(firstSrc);
    r.ok(svg.status === 200 && svg.type === 'image/svg+xml', 'served as image/svg+xml', svg.type);
    r.ok(svg.text.includes('A lighthouse at dusk') && svg.text.startsWith('<svg'), 'drawing from the provider (prompt text kept)');
    r.ok(!/<script|onload|<a[\s>]|example\.com|javascript:/i.test(svg.text), 'sanitised: no script, handlers or links');
    firstBlockId = await images().first().evaluate((el) => el.closest('[data-block-id]')?.getAttribute('data-block-id'));
    await shot('03-generated');
  });

  await step('Polish with AI (generated image)', async () => {
    await images().first().hover();
    const btn = page.locator('.nc-aiimg-edit-btn').first();
    await btn.waitFor();
    r.ok((await btn.innerText()).includes('Polish with AI'), 'image bar: Polish with AI');
    await btn.click();
    const pop = page.locator('[data-testid="ai-image-edit"]');
    await pop.waitFor();
    await pop.locator('textarea').waitFor();
    r.ok((await pop.innerText()).includes('A lighthouse at dusk'), 'popover shows the original prompt');
    await pop.locator('textarea').fill('make the background a snowy afternoon');
    await pop.locator('button', { hasText: 'Apply' }).click();
    const changed = await waitFor(async () => {
      const src = await images().first().getAttribute('src');
      return src && src !== firstSrc ? src : null;
    }, { timeout: 20000 });
    r.ok(!!changed, 'image replaced by the edited drawing');
    if (changed) {
      const svg = await fetchText(changed);
      r.ok(svg.text.includes('Edited: make the background a snowy afternoon'), 'edit instruction reached the provider with the current SVG');
    }
    r.ok((await pop.innerText()).includes('Image updated'), 'popover stays open for another round');
    await shot('04-edit-with-ai');
    await page.keyboard.press('Escape');
  });

  await step('Polish with AI unavailable on a non-AI image', async () => {
    await slash('/image');
    await page.keyboard.press('Enter');
    const picker = page.locator('.nc-media-picker');
    await picker.waitFor();
    await picker.locator('[role="tab"]', { hasText: 'Unsplash' }).click();
    await picker.locator('.nc-stock-item').first().click();
    await waitFor(() => images().count().then((n) => n >= 2), { timeout: 8000 });
    await images().nth(1).hover();
    await page.locator('.nc-aiimg-edit-btn').last().click();
    const pop = page.locator('[data-testid="ai-image-edit"]');
    await pop.waitFor();
    await waitFor(async () => (await pop.innerText()).includes('only available for images created with Litpage AI'), { timeout: 5000 });
    r.ok((await pop.innerText()).includes('Polish with AI is only available for images created with Litpage AI.'), 'unavailable state for other images');
    r.ok(await pop.locator('textarea').count() === 0, 'no edit field there');
    await shot('05-edit-unavailable');
    await page.keyboard.press('Escape');
  });

  await step('/AI Image', async () => {
    await slash('/ai image');
    const items = await slashItems();
    r.ok(items.some((x) => x.includes('AI Image')), '"AI Image" in the slash menu', items.slice(0, 6));
    await page.keyboard.press('Enter');
    const form = page.locator('[data-testid="ai-image-tab"]');
    await form.waitFor();
    r.ok((await page.locator('.nc-aiimg-head').innerText()).includes('Litpage AI'), 'Litpage AI image popover under the new block');
    await form.locator('textarea').fill('Quarterly revenue chart');
    await form.locator('.nc-aiimg-style', { hasText: 'Chart' }).click();
    await form.locator('button', { hasText: 'Generate Image' }).click();
    await waitFor(() => images().count().then((n) => n >= 3), { timeout: 20000 });
    r.ok(await images().count() >= 3, 'third image generated from /AI Image');
    await shot('06-slash-ai-image');
  });

  // the page cover picker's AI tab generates a cover about the page
  await step('cover › Litpage AI', async () => {
    await page.locator('h1[data-content-editable-leaf]').hover();
    await page.locator('.nc-page-control', { hasText: 'Add cover' }).click();
    await page.locator('.nc-cover').hover();
    await page.locator('.nc-cover-btn', { hasText: /^Change$/ }).click();
    const picker = page.locator('.nc-cover-picker');
    await picker.waitFor();
    const tabs = await picker.locator('[role="tab"]').allInnerTexts();
    r.ok(tabs.includes('Litpage AI'), 'cover picker has a Litpage AI tab', tabs);
    await picker.locator('[role="tab"]', { hasText: 'Litpage AI' }).click();
    const form = picker.locator('[data-testid="ai-image-tab"]');
    await form.locator('textarea').fill('Abstract waves for the launch page');
    await form.locator('button', { hasText: 'Generate Image' }).click();
    const cover = await waitFor(async () => {
      const src = await page.locator('img.lit-page-cover').getAttribute('src').catch(() => null);
      return src && /^\/files\/[0-9a-f-]+\/.+\.svg$/.test(src) ? src : null;
    }, { timeout: 20000 });
    r.ok(!!cover, 'the generated SVG becomes the page cover', cover);
    await shot('06b-ai-cover');
  });

  await step('chat: generate an image', async () => {
    await page.click('[role="tab"][aria-label="Chat"]');
    await page.waitForTimeout(300);
    if (!(await page.$('.nc-ai-landing'))) await page.click('nav.lit-sidebar-container >> text=New chat');
    await page.waitForSelector('.nc-ai-landing');
    const input = page.locator('.nc-ai-prompt').last();
    await input.waitFor();
    await input.click();
    await page.keyboard.type('Please generate an image of a rocket launch timeline');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.nc-ai-row.assistant[aria-busy="true"]') && !!document.querySelector('.nc-ai-row.assistant'), null, { timeout: 30000 });
    const img = page.locator('.nc-ai-row.assistant').last().locator('img.nc-ai-img');
    await img.waitFor({ timeout: 10000 });
    const src = await img.getAttribute('src');
    r.ok(/^\/files\/.+\.svg$/.test(src ?? ''), 'answer shows the generated image', src);
    const svg = await fetchText(src);
    r.ok(svg.text.includes('a rocket launch timeline'), 'chat tool used the image provider');
    await shot('07-chat-image');
    await page.click('[role="tab"][aria-label="Home"]').catch(() => {});
  });

  await step('workspace switch off', async () => {
    await page.goto(`${h.base}/${domain}/Launch-visuals-${compact(pageId)}`);
    await images().first().waitFor();
    await openSettings('lit-ai');
    await page.locator('.nc-set-row[data-setting="ai-image-generation"] input[role="switch"]').click();
    await page.waitForTimeout(500);
    await closeSettings();
    await images().first().hover();
    await page.waitForTimeout(300);
    r.ok(await page.locator('.nc-aiimg-edit-btn').count() === 0, 'Polish with AI hidden');
    await slash('/ai image');
    r.ok(!(await slashItems()).some((x) => x.includes('AI Image')), '"AI Image" not offered');
    await page.keyboard.press('Escape');
    const denied = await call(page, 'aiGenerateImageBlock', { blockId: firstBlockId, prompt: 'x', style: 'default' });
    r.ok(denied.__error === 403 && /turned off/.test(denied.message ?? ''), 'server refuses (403)', denied);
    await openSettings('lit-ai');
    await page.locator('.nc-set-row[data-setting="ai-image-generation"] input[role="switch"]').click();
    await page.waitForTimeout(400);
    await closeSettings();
  });

  await step('plan without image generation', async () => {
    r.ok(!(await call(page, 'changePlan', { spaceId, plan: 'plus' })).__error, 'Pro feature level (plan_type plus)');
    await page.waitForTimeout(500);
    await slash('/image');
    await page.keyboard.press('Enter');
    const picker = page.locator('.nc-media-picker');
    await picker.waitFor();
    const tabs = await picker.locator('[role="tab"]').allInnerTexts();
    r.ok(!tabs.includes('Litpage AI'), 'no Litpage AI tab on Pro', tabs);
    await page.keyboard.press('Escape');
    await slash('/ai image');
    await page.keyboard.press('Enter');
    const t = await waitFor(async () => (await toasts()).find((x) => x.includes('Business and Enterprise')), { timeout: 5000 });
    r.ok(!!t, '/AI Image explains the plan');
    const denied = await call(page, 'aiGenerateImageBlock', { blockId: firstBlockId, prompt: 'x', style: 'default' });
    r.ok(denied.__error === 403 && /Business/.test(denied.message ?? ''), 'server refuses on Pro (403)', denied);
    await openSettings('lit-ai');
    const row = page.locator('.nc-set-row[data-setting="ai-image-generation"]');
    r.ok((await row.innerText()).includes('Upgrade to Business'), 'settings row shows the upsell');
    await shot('08-plus-upsell');
    await closeSettings();
  });

  r.ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
} finally {
  await browser.close().catch(() => {});
  h.stop();
  r.done('img-gen');
}

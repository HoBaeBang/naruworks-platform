// Share & Publish E2E (SHR-*, PUB-*): invite by email (placeholder user → signs up later and can edit),
// general access → "Anyone online who has the link", Publish tab → live site URL, anonymous visitor sees the
// read-only public page (/public/<slug>) with Duplicate (→ login), signed-in visitor duplicates it into
// their workspace, Unpublish → public URL stops working.
import { launch, BASE } from './lib.mjs';
import { chromium } from 'playwright-core';
import { CHROME } from './lib.mjs';
import { createPage, invite, reporter, shot, signupAny } from './page-lib.mjs';

const { check, finish } = reporter();
const stamp = Date.now();
const emailA = `shr-a-${stamp}@test.dev`;
const emailB = `shr-b-${stamp}@test.dev`;
const emailC = `shr-c-${stamp}@test.dev`;

const A = await launch();
const page = A.page;
let anon = null;
let B = null;
let C = null;
try {
  await signupAny(page, emailA, 'Ada Owner', 'Share Co');
  const pageUrl = await createPage(page, 'Share Lab', ['Public content paragraph.', 'Second line.']);

  // --- invite B (not yet a user)
  await invite(page, emailB);
  const people = await page.$$eval('.nc-share-row.person', (els) => els.map((e) => e.textContent));
  check('invitee listed', people.some((p) => p.includes(emailB)), people.join(' / '));
  const menuSize = await page.$eval('.nc-share-menu', (e) => ({ w: Math.round(e.getBoundingClientRect().width), r: getComputedStyle(e).borderRadius }));
  check('share menu 456 / r12', menuSize.w === 456 && menuSize.r === '12px', JSON.stringify(menuSize));
  await shot(page, 's01-share-invited');

  // --- publish
  await page.click('.lit-share-menu-publish-tab');
  await page.waitForSelector('.nc-publish-btn');
  await shot(page, 's03-publish-tab');
  await page.click('.nc-publish-btn');
  await page.waitForSelector('.nc-publish-url a', { timeout: 8000 });
  const siteUrl = await page.getAttribute('.nc-publish-url a', 'href');
  check('published url', /\/public\//.test(siteUrl ?? ''), siteUrl);
  // allow visitors to duplicate (Duplicate as a template)
  await page.locator('.nc-setting-row', { hasText: 'Duplicate as a template' }).locator('[role=switch]').click();
  await page.waitForTimeout(800);
  check('duplicate as template on', (await page.locator('.nc-setting-row', { hasText: 'Duplicate as a template' }).locator('[role=switch]').getAttribute('aria-checked')) === 'true');
  await shot(page, 's04-published');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('sites banner', await page.isVisible('.nc-sites-banner, .nc-banner.sites'));
  check('share button shows published state', (await page.getAttribute('.lit-topbar-share-menu', 'data-share-state')) === 'published');

  // --- anonymous visitor
  const browser2 = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx2 = await browser2.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  anon = { browser: browser2, page: await ctx2.newPage() };
  const full = siteUrl.startsWith('http') ? siteUrl : BASE + siteUrl;
  await anon.page.goto(full);
  await anon.page.waitForSelector('.nc-public-page, .nc-page-title', { timeout: 15000 });
  await anon.page.waitForTimeout(800);
  const body = await anon.page.textContent('body');
  check('public page content', body.includes('Public content paragraph.'));
  const editable = await anon.page.$$eval('[contenteditable]:not([contenteditable="false"])', (els) => els.length);
  check('public page read-only', editable === 0, `${editable} editable`);
  check('public Duplicate button', await anon.page.isVisible('text=Duplicate'));
  await shot(anon.page, 's05-public-anon');
  await anon.page.click('text=Duplicate');
  await anon.page.waitForURL(/\/login/, { timeout: 8000 }).catch(() => {});
  check('duplicate → login', /\/login/.test(anon.page.url()), anon.page.url());

  // --- C (new user) duplicates the public page into their workspace
  C = await launch();
  await signupAny(C.page, emailC, 'Cy Visitor', 'Visitor Space');
  await C.page.goto(full);
  await C.page.waitForSelector('text=Duplicate', { timeout: 15000 });
  await C.page.click('text=Duplicate');
  await C.page.waitForURL((u) => !u.pathname.startsWith('/public/') && !u.pathname.startsWith('/login'), { timeout: 10000 }).catch(() => {});
  await C.page.waitForTimeout(1200);
  const cBody = await C.page.textContent('body');
  check('duplicated into visitor workspace', !C.page.url().includes('/public/') && cBody.includes('Public content paragraph.'), C.page.url());
  await shot(C.page, 's06-duplicated');

  // --- B signs up with the invited email and can edit the shared page
  B = await launch();
  await signupAny(B.page, emailB, 'Ben Invitee', 'Ben Space');
  await B.page.goto(pageUrl);
  await B.page.waitForSelector('.nc-page-title', { timeout: 15000 });
  const bEditable = await B.page.$$eval('.lit-page-content [contenteditable]:not([contenteditable="false"])', (els) => els.length);
  check('invitee can edit', bEditable > 0, `${bEditable} editable`);
  await shot(B.page, 's07-invitee');

  // --- unpublish → the anonymous visitor loses access
  await page.click('.lit-topbar-share-menu');
  await page.click('.lit-share-menu-publish-tab');
  await page.waitForSelector('.nc-publish-actions');
  await page.click('.nc-publish-actions button >> text=Unpublish');
  const confirm = page.locator('.lit-overlay-container button').filter({ hasText: /^Unpublish$/ });
  if (await confirm.count()) await confirm.last().click();
  await page.waitForSelector('.nc-publish-btn', { timeout: 8000 });
  check('unpublished', true);
  await anon.page.goto(full);
  await anon.page.waitForTimeout(1500);
  const gone = await anon.page.textContent('body');
  check('public page gone after unpublish', !gone.includes('Public content paragraph.'), gone.slice(0, 100));
  await shot(anon.page, 's08-after-unpublish');

  // --- general access → Anyone online who has the link (view-only link without publishing)
  await page.click('.nc-share-tab [role=tab] >> nth=0');
  await page.waitForSelector('.nc-share-ga-btn');
  await page.click('.nc-share-ga-btn');
  await page.click('.lit-overlay-container [role=option] >> text=Anyone online who has the link');
  // the menu re-reads the server's sharing model once the change is saved: allow a busy machine a few seconds
  await page.waitForFunction(() => document.querySelector('.nc-share-general')?.textContent.includes('Anyone online who has the link'), null, { timeout: 8000 }).catch(() => {});
  check('general access public', (await page.textContent('.nc-share-general')).includes('Anyone online who has the link'));
  await shot(page, 's09-general-access-public');
  await page.keyboard.press('Escape');
  await anon.page.goto(full);
  await anon.page.waitForTimeout(1500);
  check('link access: anonymous can view', (await anon.page.textContent('body')).includes('Public content paragraph.'));
  const editable2 = await anon.page.$$eval('[contenteditable]:not([contenteditable="false"])', (els) => els.length);
  check('link access: read-only', editable2 === 0);
  await shot(anon.page, 's10-link-access-anon');
} catch (e) {
  console.log('E2E ERROR', e.message);
  await shot(page, 's-error').catch(() => {});
  check('exception', false, e.message);
} finally {
  await A.browser.close();
  if (anon) await anon.browser.close();
  if (B) await B.browser.close();
  if (C) await C.browser.close();
  finish();
}

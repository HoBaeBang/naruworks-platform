// Sites: Share › Publish → Customize site appearance (short link, theme, share preview /
// SEO, header search + share + navigation, Google Analytics) → Publish changes; Embed page snippet; an anonymous
// visitor opens the short link: dark theme, <title>/description/robots, navigation link, site search, embed mode.
import { launch } from './lib.mjs';
import { createPage, reporter, shot, signupAny } from './page-lib.mjs';
import { BASE } from './lib.mjs';

const { check, finish } = reporter();
const { browser, context, page } = await launch();
const slug = `acme-handbook-${Date.now().toString(36)}`;
try {
  await signupAny(page, `sites-${Date.now()}@test.dev`, 'Sita Sites', 'Acme');
  await createPage(page, 'Handbook', ['How we work at Acme.', '']);
  await page.keyboard.type('/page', { delay: 15 });
  await page.waitForTimeout(500);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^\s*Page\s*$/ }).first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(400);
  await page.keyboard.type('Vacation policy');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Everyone gets 25 days of vacation.');
  await page.waitForTimeout(900);
  await page.goBack();
  await page.waitForSelector('.nc-page-title >> text=Handbook');

  // --- publish
  await page.click('.lit-topbar-share-menu');
  await page.click('.lit-share-menu-publish-tab');
  await page.click('.nc-publish-btn');
  await page.waitForSelector('.nc-publish-url a', { timeout: 8000 });
  // --- site customization
  await page.locator('.nc-setting-row', { hasText: 'Customize site appearance' }).click();
  await page.waitForSelector('.nc-site-settings');
  await page.fill('.nc-site-slug input', slug);
  await page.waitForSelector('.nc-site-hint.ok', { timeout: 5000 });
  check('short link available', true);
  await page.locator('.nc-site-segment[aria-label="Theme"] [role="radio"]', { hasText: 'Dark' }).click();
  await page.locator('.nc-site-field', { hasText: 'Link title' }).locator('input').fill('Acme handbook');
  await page.locator('.nc-site-field', { hasText: 'Description' }).locator('textarea').fill('How the Acme team works');
  await page.locator('.nc-site-section', { hasText: 'Header' }).locator('.nc-setting-row', { hasText: 'Share' }).locator('[role="switch"]').click();
  await page.click('.nc-site-add-link');
  await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]').filter({ hasText: 'Vacation policy' }).first().click();
  check('navigation link added', await page.isVisible('.nc-site-link-row >> text=Vacation policy'));
  await page.locator('.nc-site-field', { hasText: 'Measurement ID' }).locator('input').fill('G-TEST123');
  await shot(page, 'sites-01-customize');
  await page.click('.nc-site-settings-actions >> text=Publish changes');
  await page.waitForSelector('.nc-site-settings', { state: 'detached', timeout: 8000 });
  check('changes published', true);
  // the share menu stays open under the dialog: its publish tab now shows the short link
  if (!(await page.isVisible('.nc-publish-url a'))) {
    await page.click('.lit-topbar-share-menu');
    await page.click('.lit-share-menu-publish-tab');
  }
  await page.waitForSelector('.nc-publish-url a');
  await page.waitForTimeout(500);
  const href = await page.getAttribute('.nc-publish-url a', 'href');
  check('site URL uses the short link', href.endsWith(`/public/${slug}`), href);
  // --- embed code
  await page.locator('.nc-setting-row', { hasText: 'Embed page' }).click();
  await page.waitForSelector('.nc-embed-code textarea');
  const code = await page.inputValue('.nc-embed-code textarea');
  check('embed snippet', code.startsWith('<iframe') && code.includes(`/public/${slug}?embed=1`), code.slice(0, 120));
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');

  // --- anonymous visitor
  const anon = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  const v = await anon.newPage();
  await v.goto(`${BASE}/public/${slug}`);
  await v.waitForSelector('.nc-public-page .nc-page-title', { timeout: 15000 });
  check('short link opens the site', (await v.textContent('.nc-page-title')).includes('Handbook'));
  check('dark theme', await v.evaluate(() => document.documentElement.classList.contains('lit-dark-theme')));
  await v.waitForTimeout(500);
  check('<title> = link title', (await v.title()) === 'Acme handbook', await v.title());
  check('meta description', (await v.getAttribute('meta[name="description"]', 'content')) === 'How the Acme team works');
  check('noindex while indexing is off', (await v.getAttribute('meta[name="robots"]', 'content'))?.includes('noindex'));
  check('GA not loaded on localhost', !(await v.$('script[data-nc-ga]')));
  check('share button in header', await v.isVisible('.nc-public-topbar [aria-label="Share"]'));
  await shot(v, 'sites-02-visitor');
  // site search
  await v.click('.nc-public-topbar [aria-label="Search"]');
  await v.waitForSelector('.nc-public-search input');
  await v.waitForTimeout(300);
  await v.fill('.nc-public-search input', 'vacation');
  await v.waitForSelector('.nc-public-search-results .row', { timeout: 12000 });
  check('site search finds the subpage', (await v.textContent('.nc-public-search-results')).includes('Vacation policy'));
  // navigation link
  await v.keyboard.press('Escape');
  await v.click('.nc-public-nav-link >> text=Vacation policy');
  await v.waitForSelector('.nc-page-title >> text=Vacation policy', { timeout: 8000 });
  check('header navigation link', (await v.locator('.lit-page-content').innerText()).includes('25 days'));
  // embed mode
  await v.goto(`${BASE}/public/${slug}?embed=1`);
  await v.waitForSelector('.nc-public-embed .nc-page-title', { timeout: 15000 });
  check('embed mode hides the header', !(await v.$('.nc-public-topbar')));
  await anon.close();

  // --- search engine indexing on → no robots meta
  for (let i = 0; i < 3 && (await page.locator('.lit-overlay-container .nc-overlay').count()); i++) await page.keyboard.press('Escape');
  await page.click('.lit-topbar-share-menu');
  await page.click('.lit-share-menu-publish-tab');
  await page.locator('.nc-setting-row', { hasText: 'Web search indexing' }).locator('[role="switch"]').click();
  await page.waitForTimeout(800);
  const anon2 = await browser.newContext();
  const v2 = await anon2.newPage();
  await v2.goto(`${BASE}/public/${slug}`);
  await v2.waitForSelector('.nc-public-page .nc-page-title', { timeout: 15000 });
  await v2.waitForTimeout(500);
  check('indexing on → no noindex', !(await v2.$('meta[name="robots"]')));
  await anon2.close();
} catch (e) {
  check('no exception', false, e.message.split('\n')[0]);
  await shot(page, 'sites-error');
} finally {
  await browser.close();
  finish();
}

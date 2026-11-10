// Shell: Library (/<domain>/library/<tab>) and Meetings pages.
// Run: cd e2e && node shell-library.mjs (screenshots → $NC_SHOTS or /tmp/nc-e2e/e2e-shell/library)
import { mkdirSync, readFileSync } from 'node:fs';
import { launch, signup, hoverClick } from './lib.mjs';

/** Switch Library tabs (clicking the tab that is already selected opens its sidebar-section menu). */
async function selectTab(page, name) {
  const tab = page.locator(`.nc-lib-tab:has-text("${name}")`).first();
  if ((await tab.getAttribute('aria-selected')) === 'true') return;
  await tab.click();
}

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/library';
mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(30000); // cold loads of the shared dev server's module graph can exceed 10s
// Other agents edit concurrently: if one of THEIR modules is momentarily broken (Vite 500), serve a harmless stub
// so this page's test can still run (no effect once their module compiles).
await page.addInitScript(() => {
  const css = 'vite-error-overlay{display:none!important;pointer-events:none!important}';
  const add = () => { const st = document.createElement('style'); st.textContent = css; document.documentElement.appendChild(st); };
  if (document.documentElement) add(); else document.addEventListener('DOMContentLoaded', add);
});
// …and keep Vite's HMR socket inert, so another agent's edit can't full-reload the page mid-test.
await page.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = new Proxy(Native, {
    construct(target, args) {
      const protocols = [].concat(args[1] ?? []);
      if (protocols.some((p) => String(p).startsWith('vite-'))) return Object.assign(new EventTarget(), { readyState: 0, url: String(args[0]), send() {}, close() {} });
      return Reflect.construct(target, args);
    },
  });
});
// The stub re-exports the module's own export names as inert components so importers still link.
function stubFor(path) {
  let src = '';
  try { src = readFileSync(new URL(`../apps/web/src/${path}`, import.meta.url), 'utf8'); } catch {}
  const names = new Set([...src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]));
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(',')) {
      const n = part.trim().split(/\s+as\s+/).pop();
      if (n && n !== 'default' && !/^type\s/.test(part.trim())) names.add(n);
    }
  }
  const lines = [...names].map((n) => `export const ${n} = () => null;`);
  if (/export\s+default\b/.test(src)) lines.push('export default () => null;');
  return lines.join('\n') || 'export {};';
}
await page.route(/\/src\/features\/(settings|database|editor|page|ai|search|auth|templates|import|comments)\/.*\.tsx?(\?.*)?$/, async (route) => {
  try {
    const res = await route.fetch();
    if (res.status() !== 500) return await route.fulfill({ response: res });
    const path = new URL(route.request().url()).pathname.replace(/^\/src\//, '');
    console.log('[stubbed broken module]', path);
    await route.fulfill({ status: 200, contentType: 'text/javascript', body: stubFor(path) });
  } catch {
    // page/browser already closed
  }
});
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
  if (!cond) failures++;
};
// in-app navigation (the router listens to popstate) — avoids slow full reloads of the dev module graph
const spaNav = (path) => page.evaluate((p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')); }, path);
const rowTitles = () => page.$$eval('.nc-lib-item .nc-lib-title-text', (els) => els.map((e) => e.textContent.trim()));

async function addPrivatePage(title) {
  await hoverClick(page, '.lit-outliner-private-header', 'Add a page');
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type(title);
  await page.waitForTimeout(500);
}

try {
  await signup(page);
  await page.waitForTimeout(600);
  await addPrivatePage('Alpha Library Page');
  await addPrivatePage('Beta Library Page');
  // sub-page inside Beta via the sidebar row "+"
  const beta = page.locator('nav [role=treeitem]', { hasText: 'Beta Library Page' }).first();
  await beta.hover();
  await beta.locator('[aria-label="Add a page inside"]').click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type('Beta Child');
  await page.waitForTimeout(700);

  // open Library from the sidebar shortcut
  await page.click('nav [role=button][aria-label="Library"]');
  await page.waitForSelector('.nc-lib-page');
  await page.waitForTimeout(800);
  ok(/\/library\/(recents|teamspaces|favorites|shared|private|meetings|skills)$/.test(new URL(page.url()).pathname), `library URL ${new URL(page.url()).pathname}`);
  await selectTab(page, 'Recents');
  await page.waitForTimeout(800);
  await shot('01-recents');
  const h1 = await page.locator('.nc-lib-h1').boundingBox();
  ok(h1 && Math.round(h1.x) === 372 && Math.round(h1.y) === 52, `h1 at 372,52 (got ${h1 && [Math.round(h1.x), Math.round(h1.y)]})`);
  const tabBox = await page.locator('.nc-lib-tab').first().boundingBox();
  ok(tabBox && Math.round(tabBox.x) === 374 && Math.round(tabBox.y) === 105 && Math.round(tabBox.height) === 32, `first tab at 374,105 h32 (got ${tabBox && [Math.round(tabBox.x), Math.round(tabBox.y), Math.round(tabBox.height)]})`);
  const heads = await page.$$eval('.nc-lib-hcell', (els) => els.map((e) => e.textContent.trim()));
  ok(heads.join('|') === 'Page name|Created by|Source|Last edited time|Last visited time', `recents columns ${heads.join('|')}`);
  const hdr = await page.locator('.nc-lib-hcell').first().boundingBox();
  ok(hdr && Math.round(hdr.x) === 374 && Math.round(hdr.y) === 141 && Math.round(hdr.width) === 420, `header cell 374,141 w420 (got ${hdr && [Math.round(hdr.x), Math.round(hdr.y), Math.round(hdr.width)]})`);
  const recents = await rowTitles();
  console.log('recents rows:', recents);
  ok(recents.includes('Beta Library Page') && recents.includes('Alpha Library Page'), 'recents shows visited pages');

  // expand Beta's sub-pages
  // (match the title cell: Beta Child's Source cell also reads "Beta Library Page")
  const betaRow = page.locator('.nc-lib-item').filter({ has: page.locator('.nc-lib-title-text', { hasText: /^Beta Library Page$/ }) }).first();
  const toggle = betaRow.locator('.nc-lib-toggle');
  await page.waitForTimeout(500);
  const childCount = async () => (await rowTitles()).filter((x) => x === 'Beta Child').length;
  if (await toggle.count()) {
    const before = await childCount();
    await toggle.click();
    await page.waitForTimeout(400);
    const titles = await rowTitles();
    ok((await childCount()) === before + 1 && titles[titles.indexOf('Beta Library Page') + 1] === 'Beta Child', 'toggle expands sub-pages under their parent');
    await toggle.click();
    await page.waitForTimeout(300);
  } else ok(false, 'Beta has a sub-page toggle');
  await betaRow.hover();
  await page.waitForTimeout(200);
  await shot('02-recents-row-hover');

  // column menu + sort
  await page.click('.nc-lib-hcell:has-text("Page name") .nc-lib-hbtn');
  await page.waitForTimeout(300);
  await shot('03-column-menu');
  await page.hover('.nc-overlay [role=option]:has-text("Sort")');
  await page.waitForTimeout(400);
  await shot('04-column-sort-submenu');
  await page.click('.nc-overlay [role=option]:has-text("Sort Z → A")');
  await page.waitForTimeout(300);
  const sorted = await rowTitles();
  ok(sorted.indexOf('Beta Library Page') < sorted.indexOf('Alpha Library Page'), 'sort Z → A applied');
  ok(await page.locator('.nc-lib-tool.active[aria-label="Sort"]').count() === 1, 'blue sort indicator shown');
  await page.click('.nc-lib-tool[aria-label="Sort"]');
  await page.click('.nc-overlay [role=option]:has-text("Delete sort")');
  await page.waitForTimeout(200);

  // filter
  await page.click('.nc-lib-tool[aria-label="Filter"]');
  await page.waitForTimeout(300);
  await shot('05-filter-menu');
  await page.click('.nc-overlay [role=option]:has-text("Page name")');
  await page.waitForTimeout(300);
  await page.keyboard.type('Alpha');
  await page.waitForTimeout(300);
  await shot('06-filter-editor');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const filtered = await rowTitles();
  ok(filtered.length >= 1 && filtered.every((t) => t.includes('Alpha')), `filter Page name contains Alpha → ${filtered.join(', ')}`);
  await page.click('.nc-lib-pill');
  await page.click('.nc-overlay [aria-label="Delete filter"]');
  await page.waitForTimeout(200);
  ok(await page.locator('.nc-lib-pill').count() === 0, 'filter removed');

  // search
  await page.click('.nc-lib-tool[aria-label="Search"]');
  await page.keyboard.type('Beta');
  await page.waitForTimeout(300);
  await shot('07-search');
  const searched = await rowTitles();
  ok(searched.every((t) => t.includes('Beta')), `search filters rows → ${searched.join(', ')}`);
  await page.keyboard.press('Escape');

  // settings panel + property visibility
  await page.click('.nc-lib-tool[aria-label="Settings"]');
  await page.waitForTimeout(300);
  await shot('08-settings-panel');
  await page.click('.nc-lib-settings [role=menuitem]:has-text("Property visibility")');
  await page.waitForTimeout(300);
  await shot('09-property-visibility');
  await page.click('.nc-overlay [role=menuitem]:has-text("Source")');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  const heads2 = await page.$$eval('.nc-lib-hcell', (els) => els.map((e) => e.textContent.trim()));
  ok(!heads2.includes('Source'), `Source hidden → ${heads2.join('|')}`);
  await page.click('.nc-lib-settings [aria-label="Close"]');

  // other tabs
  for (const [name, file] of [['Teamspaces', '10-teamspaces'], ['Favorites', '11-favorites'], ['Shared', '12-shared'], ['Private', '13-private']]) {
    await selectTab(page, name);
    await page.waitForTimeout(600);
    await shot(file);
  }
  ok(await page.locator('.nc-lib-tool.active[aria-label="Sort"]').count() === 1, 'Private tab has default Last edited sort');
  const priv = await rowTitles();
  ok(priv.includes('Alpha Library Page'), `private rows → ${priv.join(', ')}`);
  await selectTab(page, 'Teamspaces');
  await page.waitForTimeout(300);
  ok(await page.locator('.nc-lib-ts-row', { hasText: 'General' }).count() >= 1, 'Your teamspaces lists General');
  await page.locator('.nc-lib-ts-row', { hasText: 'General' }).first().locator('.nc-lib-toggle').click();
  await page.waitForTimeout(300);
  await shot('14-teamspaces-expanded');

  // AI Meeting Notes + Skills
  const more = page.locator('.nc-lib-more');
  if (await more.count()) {
    await more.click();
    await page.click('.nc-overlay [role=option]:has-text("AI Meeting Notes")');
  } else {
    await selectTab(page, 'AI Meeting Notes');
  }
  await page.waitForTimeout(800);
  await shot('15-ai-notes-empty');
  ok(await page.locator('.nc-lib-empty').count() === 1, 'AI notes empty state');
  await page.click('.nc-lib-empty .nc-lib-primary');
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.waitForTimeout(800);
  await page.goBack();
  await page.waitForSelector('.nc-lib-page');
  await page.waitForTimeout(1000);
  await shot('16-ai-notes-list');
  const notes = await rowTitles();
  ok(notes.some((t) => /meeting notes/i.test(t)), `AI notes lists the new note → ${notes.join(', ')}`);
  const url = new URL(page.url());
  const domain = url.pathname.split('/')[1];
  await spaNav(`/${domain}/library/skills`);
  await page.waitForSelector('.nc-lib-seg');
  await page.waitForTimeout(400);
  await shot('17-skills');
  await page.click('.nc-lib-seg-item:has-text("Discover")');
  await page.waitForTimeout(200);
  await shot('18-skills-discover');

  // Meetings page
  await spaNav(`/${domain}/meetings`);
  await page.waitForSelector('.nc-meetings-page');
  await page.waitForTimeout(800);
  await shot('19-meetings');
  ok(await page.locator('.nc-meet-row').count() >= 1, 'Meetings page lists meeting notes with AI');

  // dark mode
  await spaNav(`/${domain}/library/recents`);
  await page.waitForSelector('.nc-lib-table');
  await page.keyboard.press('Meta+Shift+L');
  await page.waitForTimeout(500);
  await shot('20-recents-dark');
  await page.keyboard.press('Meta+Shift+L');

  // narrow width: tabs overflow into "N more"
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(500);
  await shot('21-recents-1024');
  ok(await page.locator('.nc-lib-more').count() === 1, '"N more" overflow at 1024px');
} catch (e) {
  console.log('E2E FAILED', e.message);
  failures++;
  await shot('error').catch(() => {});
} finally {
  await browser.close();
}
console.log(failures ? `${failures} failure(s)` : 'all passed');
process.exitCode = failures ? 1 : 0;

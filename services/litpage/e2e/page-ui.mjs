// Page-level UI E2E: header hover controls, Add icon (random emoji → picker), icon picker tabs/colors,
// Add cover (random) → Change/Reposition, page ••• menu (2026 structure + footer), Appearance & layout
// (fonts, full width), More → Export dialog, Version history (full screen), Updates & analytics panel
// (frame shrinks, 385px), Move to picker, TOC rail hover card, Lock page. Screenshots → $NC_SHOTS.
import { launch } from './lib.mjs';
import { createPage, reporter, shot, signupAny } from './page-lib.mjs';

const { check, finish } = reporter();
const { browser, page } = await launch();
const rect = (sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; });
try {
  await signupAny(page, `page-ui-${Date.now()}@test.dev`, 'Page Tester', 'Acme');
  await createPage(page, 'Page UI Lab', ['# Overview', 'Commentable text lives here for inline comments.', '## Details', 'More words in a second section.', '### Deep', 'Last words.']);

  // --- header hover controls
  await page.hover('.nc-page-title');
  await page.waitForTimeout(300);
  const controls = await page.$$eval('.lit-page-controls .nc-page-control', (els) => els.map((e) => e.textContent.trim()));
  check('header controls', controls.join('|') === 'Add icon|Add cover|Add comment', controls.join('|'));
  await shot(page, '01-header-hover');

  // --- Add icon: random emoji applied immediately + picker opens under it
  await page.click('.lit-page-controls >> text=Add icon');
  await page.waitForSelector('.nc-page-icon');
  const randomIcon = (await page.textContent('.nc-page-icon')).trim();
  check('random emoji applied', randomIcon.length > 0, randomIcon);
  await page.waitForSelector('.nc-icon-picker', { timeout: 3000 }).catch(() => page.click('.nc-page-icon'));
  await page.waitForSelector('.nc-icon-picker');
  const tabs = await page.$$eval('.nc-icon-picker [role=tab]', (els) => els.map((e) => e.textContent.trim()));
  check('icon picker tabs', tabs.join('|') === 'Emoji|Icons|Upload', tabs.join('|'));
  check('icon picker remove', await page.isVisible('.nc-icon-picker >> text=Remove'));
  await page.waitForTimeout(300); // pop-in animation
  const ip = await rect('.nc-icon-picker');
  check('icon picker 408×390', ip.w === 408 && ip.h === 390, JSON.stringify(ip));
  await shot(page, '02-icon-picker-emoji');
  await page.fill('.nc-icon-picker input', 'rocket');
  await page.waitForTimeout(250);
  await page.click('.nc-icon-picker [role=gridcell] >> nth=0');
  await page.waitForTimeout(300);
  check('emoji search pick', (await page.textContent('.nc-page-icon')).includes('🚀'));
  await page.click('.nc-page-icon');
  await page.click('.nc-icon-picker [role=tab] >> text=Icons');
  await page.waitForTimeout(200);
  await shot(page, '03-icon-picker-icons');
  await page.click('.nc-icon-picker [aria-label^="Choose an icon color"]');
  await page.waitForSelector('.nc-icon-color-menu');
  await shot(page, '04-icon-color-menu');
  await page.click('.nc-icon-color-menu [aria-label="Blue"]');
  await page.click('.nc-icon-picker [role=gridcell] >> nth=3');
  await page.waitForTimeout(300);
  check('icon from set', await page.isVisible('.nc-page-icon svg'));
  await page.keyboard.press('Escape');

  // --- Add cover: random cover applied immediately; Change → picker; Reposition
  await page.hover('.nc-page-title');
  await page.click('.lit-page-controls >> text=Add cover');
  await page.waitForSelector('.nc-cover img');
  check('random cover applied', (await page.getAttribute('.nc-cover img', 'src')).includes('/covers/'));
  await page.hover('.nc-cover');
  const btns = await page.$$eval('.nc-cover-controls [role=button]', (els) => els.map((e) => e.textContent.trim() || e.getAttribute('aria-label')));
  check('cover controls', btns[0] === 'Change' && btns[1] === 'Reposition' && btns.length === 3, btns.join('|'));
  await page.click('.nc-cover-controls .nc-cover-btn:text-is("Change")');
  await page.waitForSelector('.nc-cover-picker');
  const ctabs = await page.$$eval('.nc-cover-picker [role=tab]', (els) => els.map((e) => e.textContent.trim()));
  check('cover picker tabs', ctabs.join('|') === 'Gallery|Upload|Link|Unsplash', ctabs.join('|'));
  await page.waitForTimeout(300);
  const cp = await rect('.nc-cover-picker');
  check('cover picker 540×485', cp.w === 540 && cp.h === 485, JSON.stringify(cp));
  await shot(page, '05-cover-picker');
  await page.click('.nc-cover-picker [aria-label="Concrete"]');
  await page.waitForTimeout(300);
  check('cover set', (await page.getAttribute('.nc-cover img', 'src')).includes('texture-concrete'));
  await page.keyboard.press('Escape');
  await page.hover('.nc-cover');
  await page.click('.nc-cover-controls >> text=Reposition');
  await page.mouse.move(700, 150);
  await page.mouse.down();
  await page.mouse.move(700, 100, { steps: 5 });
  await page.mouse.up();
  await page.click('.nc-cover-controls >> text=Save position');
  await page.waitForTimeout(300);
  await shot(page, '06-cover-and-icon');

  // --- page ••• menu
  await page.click('.lit-topbar-more-button');
  await page.waitForSelector('.nc-popover [role=listbox]');
  const items = await page.$$eval('.nc-popover [role=option] .nc-menu-label', (els) => els.map((e) => e.textContent.trim()));
  const expected = ['Copy link', 'Copy the page content', 'Duplicate', 'Move to', 'Version history', 'Updates & analytics', 'Appearance & layout', 'Use in AI', 'Suggest edits', 'Notify me', 'Lock page', 'Send to Trash', 'More'];
  check('page menu items', expected.every((x, i) => items[i] === x), items.join('|'));
  const footer = await page.textContent('.nc-page-menu-footer');
  check('page menu footer', footer.includes('Last edited') && /\d+ words/.test(footer), footer);
  await shot(page, '07-page-menu');
  await page.hover('.nc-popover [role=option] >> text=Appearance & layout');
  await page.waitForTimeout(400);
  await shot(page, '08-appearance-submenu');
  await page.click('.nc-popover [role=menuitem] >> text=Full width');
  await page.waitForTimeout(300);
  check('full width toggled', await page.isVisible('.layout.layout-wide'));
  await page.click('.nc-popover [role=menuitem] >> text=Full width');
  await page.click('.nc-font-choice >> text=Serif');
  await page.waitForTimeout(200);
  const serif = await page.$eval('.lit-page-content', (e) => getComputedStyle(e).fontSize);
  check('serif font 17px', (await page.isVisible('.nc-page-scroller.font-serif')) && serif === '17px', serif);
  await page.click('.nc-font-choice >> text=Default');
  await page.hover('.nc-popover [role=option] >> text=More');
  await page.waitForTimeout(400);
  await shot(page, '09-more-submenu');
  await page.click('.nc-popover [role=menuitem] >> text=Export');
  await page.waitForSelector('.nc-export-dialog');
  await page.waitForTimeout(300);
  const ed = await rect('.nc-export-dialog');
  check('export dialog 320 wide', ed.w === 320, JSON.stringify(ed));
  await shot(page, '10-export-dialog');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }).catch(() => null),
    page.click('.nc-export-dialog button >> text=Export'),
  ]);
  check('export download', !!download, download ? download.suggestedFilename() : 'no download');

  // --- version history (full screen, 320px list)
  await page.waitForTimeout(500);
  await page.click('.lit-topbar-more-button');
  await page.click('.nc-popover [role=option] >> text=Version history');
  await page.waitForSelector('.nc-vh-entry', { timeout: 8000 });
  await page.waitForTimeout(600);
  const side = await rect('.nc-vh-sidebar');
  check('version history list 320', side.w === 320, JSON.stringify(side));
  await shot(page, '11-version-history');
  check('version history entries', (await page.$$('.nc-vh-entry')).length >= 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  if (await page.isVisible('.nc-vh')) await page.click('.nc-vh [aria-label="Close"]').catch(() => {});

  // --- Updates & analytics: right panel 385px, frame shrinks, actions move into the panel header
  const frameBefore = (await rect('.lit-frame')).w;
  await page.click('.lit-topbar-more-button');
  await page.click('.nc-popover [role=option] >> text=Updates & analytics');
  await page.waitForSelector('.lit-update-sidebar .nc-panel-tabs');
  await page.waitForTimeout(1500);
  const panel = await rect('.lit-update-sidebar');
  const frameAfter = (await rect('.lit-frame')).w;
  check('updates panel 385 full height', panel.w === 385 && panel.y === 0, JSON.stringify(panel));
  check('frame shrinks', frameAfter === frameBefore - 385, `${frameBefore} → ${frameAfter}`);
  check('topbar actions in panel', await page.isVisible('.nc-right-panel-topbar .lit-topbar-share-menu') && !(await page.isVisible('.lit-frame .lit-topbar-action-buttons')));
  check('updates card', (await page.textContent('.nc-updates')).includes('You edited') || (await page.textContent('.nc-updates')).includes('You created'));
  await shot(page, '12-updates');
  await page.click('.nc-panel-tab >> text=Analytics');
  await page.waitForSelector('.nc-analytics-head');
  await page.waitForTimeout(400);
  check('analytics views', (await page.textContent('.nc-analytics-head')).includes('Views'));
  await shot(page, '13-analytics');
  await page.click('.nc-right-panel-topbar [aria-label="Close panel"]');
  await page.waitForTimeout(200);

  // --- Move to picker
  await page.click('.lit-topbar-more-button');
  await page.click('.nc-popover [role=option] >> text=Move to');
  await page.waitForSelector('.nc-moveto');
  await page.waitForTimeout(300);
  const mv = await rect('.nc-moveto');
  check('move to 330×453', mv.w === 330 && mv.h === 453, JSON.stringify(mv));
  check('move to placeholder', (await page.getAttribute('.nc-moveto input', 'placeholder')) === 'Move page here…');
  await shot(page, '14-move-to');
  await page.keyboard.press('Escape');

  // --- TOC rail → hover card
  const rail = await page.$('.nc-toc-dashes');
  check('toc rail', !!rail);
  if (rail) {
    await rail.hover();
    await page.waitForSelector('.nc-toc-panel', { timeout: 3000 });
    const toc = await rect('.nc-toc-panel');
    check('toc card 232 wide', toc.w === 232, JSON.stringify(toc));
    await shot(page, '15-toc-card');
    await page.mouse.move(400, 400);
  }

  // --- Lock page
  await page.click('.lit-topbar-more-button');
  await page.click('.nc-popover [role=option] >> text=Lock page');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('locked pill', await page.isVisible('.nc-lock-indicator'));
  const editableLocked = await page.$$eval('.lit-page-content [contenteditable]:not([contenteditable="false"])', (els) => els.length);
  check('locked page read-only', editableLocked === 0, String(editableLocked));
  await page.click('.nc-lock-indicator');
  await page.waitForSelector('.lit-overlay-container [role=option]');
  const lockItems = await page.$$eval('.lit-overlay-container [role=option]', (els) => els.map((e) => e.textContent.trim()));
  check('unlock menu', lockItems.some((x) => x.includes('Unlock my access')) && lockItems.some((x) => x.includes('Unlock for all users')), lockItems.join('|'));
  await shot(page, '16-locked');
  await page.click('.lit-overlay-container [role=option] >> text=Unlock for all users');
  await page.waitForTimeout(400);
  check('unlocked', !(await page.isVisible('.nc-lock-indicator')));
} catch (e) {
  console.log('E2E ERROR', e.message);
  await shot(page, 'error').catch(() => {});
  check('exception', false, e.message);
} finally {
  await browser.close();
  finish();
}

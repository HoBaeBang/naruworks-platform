





// Run: NC_BASE=http://127.0.0.1:5461 node e2e/editor-extras2.mjs   (API with NC_DEV_ALLOW_LOOPBACK_FETCH=1)
import { createServer } from 'node:http';
import { start, newPage, shot, type, check, failed, MOD, tree, selectInFocused, appendBlock, richText, lineStart } from './editor-lib.mjs';

/* a tiny local site for link metadata (the API may fetch loopback URLs in dev with NC_DEV_ALLOW_LOOPBACK_FETCH=1) */
let siteTitle = 'Fixture Article';
const site = createServer((req, res) => {
  if (req.url?.startsWith('/favicon')) {
    res.writeHead(200, { 'content-type': 'image/svg+xml' });
    return res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="#2783de"/></svg>');
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><html><head><title>${siteTitle}</title><meta name="description" content="Served by the editor e2e test."><link rel="icon" href="/favicon.svg"></head><body><h1>Fixture</h1></body></html>`);
});
await new Promise((r) => site.listen(0, '127.0.0.1', r));
const SITE = `http://127.0.0.1:${site.address().port}`;

const { browser, context, page } = await start();
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
// nothing leaves the machine: third-party frames / favicons get an empty local answer
await context.route((u) => !/^(127\.0\.0\.1|localhost)$/.test(u.hostname) && /^https?:$/.test(u.protocol), (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>stub</title>' }));
const wait = (ms) => page.waitForTimeout(ms);
const leaf = (txt) => page.locator('.lit-page-content [data-content-editable-leaf]', { hasText: new RegExp(`^${txt}$`) }).first();
const blockEl = (txt) => leaf(txt).locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " lit-selectable ")][1]');
const plain = (rt) => (rt ?? []).map((d) => d[0]).join('');

async function captureClipboard(keys) {
  await page.evaluate(() => {
    window.__clip = null;
    window.addEventListener('copy', (e) => { window.__clip = Object.fromEntries(Array.from(e.clipboardData.types).map((t) => [t, e.clipboardData.getData(t)])); }, { once: true });
  });
  await page.keyboard.press(keys);
  await wait(150);
  return page.evaluate(() => window.__clip);
}
async function paste(data) {
  await page.evaluate((d) => {
    const dt = new DataTransfer();
    for (const [k, v] of Object.entries(d)) dt.setData(k, v);
    const target = document.activeElement && document.activeElement !== document.body ? document.activeElement : document;
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
  await wait(400);
}
/** "rgb(…)" / "rgba(…)" / "color(srgb r g b / a)" → [r, g, b, a] in 0–255 / 0–1 */
function rgba(css) {
  const n = (css.match(/[\d.]+/g) ?? []).map(Number);
  if (/^color\(srgb/.test(css)) return [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1];
  return [n[0], n[1], n[2], n[3] ?? 1];
}
const near = (a, b, tol = 1.5) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= (i === 3 ? 0.01 : tol));

try {
  await newPage(page, 'Extras 2');

  // ---- global placeholder rule: field text colour at 37.5%; component rules keep their own colour
  const ph = await page.evaluate(() => {
    const host = document.createElement('div');
    host.innerHTML = '<input id="ph-a" placeholder="x" style="color: rgb(50, 48, 44)"><div class="nc-input"><input id="ph-b" placeholder="y"></div>';
    document.body.appendChild(host);
    const a = getComputedStyle(document.getElementById('ph-a'), '::placeholder').color;
    const b = getComputedStyle(document.getElementById('ph-b'), '::placeholder').color;
    const probe = document.createElement('span');
    probe.style.color = 'var(--lp-text-tertiary)';
    host.appendChild(probe);
    const ter = getComputedStyle(probe).color;
    host.remove();
    return { a, b, ter };
  });
  check('input placeholder = its text colour at 37.5% (Litpage ::placeholder rule)', near(rgba(ph.a), [50, 48, 44, 0.375]), ph.a);
  check('component placeholder colours are not dimmed twice (.nc-input keeps --lp-text-tertiary)', near(rgba(ph.b), rgba(ph.ter)), ph);

  // ---- link mention: title / icon / description from the page itself
  await type(page, 'See ');
  await paste({ 'text/plain': `${SITE}/article` });
  await wait(300);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Mention' }).first().click();
  await page.waitForFunction(() => document.querySelector('.lit-link-mention-token .lit-page-mention-token__title')?.textContent === 'Fixture Article', null, { timeout: 8000 }).catch(() => {});
  const lm = (await richText(page))?.flatMap((d) => d[1] ?? []).find((a) => a[0] === 'lm')?.[1];
  check('link mention takes the page title, favicon and description', lm?.title === 'Fixture Article' && /\/favicon\.svg$/.test(lm?.icon_url ?? '') && lm?.description === 'Served by the editor e2e test.', lm);
  check('link mention renders the title', (await page.locator('.lit-link-mention-token .lit-page-mention-token__title').last().innerText()) === 'Fixture Article');
  await shot(page, 'link-mention-meta');
  
  const lmTitle = () => page.locator('.lit-link-mention-token .lit-page-mention-token__title').last().innerText().catch(() => '');
  await page.mouse.move(10, 400);
  await page.locator('.lit-link-mention-token').last().hover();
  await page.waitForSelector('.nc-lm-hover-card', { timeout: 3000 }).catch(() => {});
  const card = await page.locator('.nc-lm-hover-card').innerText().catch(() => '');
  check('hovering a link mention previews it (site, title, description, URL, actions)',
    ['127.0.0.1', 'Fixture Article', 'Served by the editor e2e test.', `${SITE}/article`, 'Copy link', 'Reload mention', 'Change to preview'].every((x) => card.includes(x)), card);
  await shot(page, 'link-mention-hover');
  siteTitle = 'Fixture Article v2';
  await page.locator('.nc-lm-hover-card [aria-label="Reload mention"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.lit-link-mention-token .lit-page-mention-token__title')].pop()?.textContent === 'Fixture Article v2', null, { timeout: 8000 }).catch(() => {});
  check('Reload mention fetches the page title again', (await lmTitle()) === 'Fixture Article v2', await lmTitle());
  await page.mouse.move(10, 400);
  await wait(400);
  await page.locator('.lit-link-mention-token').last().hover();
  await page.waitForSelector('.nc-lm-hover-card', { timeout: 3000 }).catch(() => {});
  await page.locator('.nc-lm-hover-card [aria-label="Change to preview"]').click();
  await wait(500);
  let tp = await tree(page);
  check('Change to preview: the mention becomes a preview (bookmark) block below the text',
    tp[0]?.x === 'See' || tp[0]?.x === 'See ' ? tp[1]?.t === 'bookmark' : false, tp.slice(0, 2));
  await page.mouse.move(10, 400);

  // ---- keyboard link menu: ← onto a link shows the pill, Enter opens the link, ⌘/ focuses the pill
  await appendBlock(page);
  await type(page, 'Go here now');
  await selectInFocused(page, 3, 7);
  await page.keyboard.press(`${MOD}+k`);
  await page.waitForSelector('.nc-link-popup input', { timeout: 4000 });
  await type(page, `${SITE}/linked`);
  await wait(200);
  await page.keyboard.press('Enter');
  await wait(400);
  await page.keyboard.press('ArrowLeft');
  await wait(300);
  check('caret moved onto a link → its link menu shows', (await page.locator('.nc-link-pill').count()) === 1 && (await page.locator('.nc-link-pill .nc-link-pill-url').innerText()).includes('/linked'));
  await page.evaluate(() => { window.__opened = null; window.open = (u) => { window.__opened = String(u); return null; }; });
  await page.keyboard.press('Enter');
  await wait(300);
  const opened = await page.evaluate(() => window.__opened);
  check('Enter opens the link instead of splitting the block', opened === `${SITE}/linked` && plain(await richText(page)) === 'Go here now', { opened, text: plain(await richText(page)) });
  await page.keyboard.press(`${MOD}+/`);
  await wait(300);
  check('⌘/ on a link moves focus into its link menu', await page.evaluate(() => document.activeElement?.classList.contains('nc-link-pill-url')));
  await shot(page, 'link-pill-keyboard');
  await page.keyboard.press('Escape');
  await wait(200);
  check('Escape returns to the text', await page.evaluate(() => document.activeElement?.hasAttribute('data-content-editable-leaf')));
  await lineStart(page);
  await page.keyboard.press('ArrowRight');
  await wait(250);
  check('leaving the link hides its keyboard menu', (await page.locator('.nc-link-pill').count()) === 0);

  // ---- inline equation: arrows open the editor at the near side; continuing in the same direction leaves it
  await appendBlock(page);
  await type(page, 'A /inline eq');
  await wait(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nc-equation-editor');
  await type(page, 'x+1');
  await page.keyboard.press('Enter');
  await wait(300);
  await type(page, ' B');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await page.waitForSelector('.nc-equation-editor', { timeout: 3000 }).catch(() => {});
  const caretInEquation = () => page.evaluate(() => {
    const input = document.querySelector('.nc-equation-input');
    const s = getSelection();
    if (!input || !s.rangeCount || !input.contains(s.anchorNode)) return { open: !!document.querySelector('.nc-equation-editor'), inEditor: false };
    const r = document.createRange();
    r.setStart(input, 0);
    r.setEnd(s.anchorNode, s.anchorOffset);
    return { open: true, inEditor: true, offset: r.toString().length, text: input.textContent };
  });
  const fromRight = await caretInEquation();
  check('← onto an inline equation opens its editor, caret at the end', fromRight.open && fromRight.inEditor && fromRight.offset === 3 && fromRight.text === 'x+1', fromRight);
  await page.keyboard.press('ArrowRight');
  await wait(300);
  await type(page, 'Z');
  await wait(200);
  let rt = await richText(page);
  check('→ at the end closes it and continues after the equation', (await page.locator('.nc-equation-editor').count()) === 0 && plain(rt) === 'A ⁍Z B', plain(rt));
  await lineStart(page);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); // "A", " ", then onto the equation
  await page.waitForSelector('.nc-equation-editor', { timeout: 3000 }).catch(() => {});
  const fromLeft = await caretInEquation();
  check('→ onto it from the left opens it with the caret at the start', fromLeft.open && fromLeft.inEditor && fromLeft.offset === 0, fromLeft);
  await page.keyboard.press('ArrowLeft');
  await wait(300);
  await type(page, 'Y');
  await wait(200);
  rt = await richText(page);
  check('← at the start closes it and continues before the equation', (await page.locator('.nc-equation-editor').count()) === 0 && plain(rt) === 'A Y⁍Z B' && rt.some((d) => (d[1] ?? []).some((a) => a[0] === 'e' && a[1] === 'x+1')), plain(rt));

  // ---- chemistry in equations (mhchem): \ce{…}
  await appendBlock(page);
  await type(page, '/inline eq');
  await wait(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.nc-equation-editor');
  await type(page, '\\ce{H2O + CO2}');
  await page.keyboard.press('Enter');
  await wait(300);
  const chem = await page.evaluate(() => {
    const tok = [...document.querySelectorAll('.lit-text-equation-token')].pop();
    return { katex: !!tok?.querySelector('.katex'), error: !!tok?.querySelector('.katex-error'), text: tok?.querySelector('.katex-html')?.textContent ?? '' };
  });
  check('\\ce{…} renders as chemistry (KaTeX mhchem)', chem.katex && !chem.error && /H/.test(chem.text) && !chem.text.includes('\\ce'), chem);

  // ---- List format (numbered list: Numbers / Letters / Roman numerals)
  await appendBlock(page);
  await type(page, '1. One');
  await page.keyboard.press('Enter');
  await type(page, 'Two');
  await page.keyboard.press('Enter');
  await type(page, 'Three');
  await page.keyboard.press('Escape');
  await wait(150);
  await page.keyboard.press(`${MOD}+/`);
  await wait(300);
  await page.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'List format' }).first().hover();
  await wait(400);
  const fmtItems = (await page.locator('.lit-overlay-container [role="menu"] [role="menuitem"]').allInnerTexts()).map((s) => s.trim());
  check('block menu of a numbered list offers List format ▸ Default / Numbers / Letters / Roman numerals',
    ['Default', 'Numbers', 'Letters', 'Roman numerals'].every((x) => fmtItems.some((s) => s.startsWith(x))), fmtItems);
  await page.locator('.lit-overlay-container [role="menuitem"]', { hasText: 'Letters' }).click();
  await wait(400);
  const markers = await page.locator('.lit-page-content .nc-num-marker').allInnerTexts();
  check('Letters: a. b. c.', markers.slice(-3).join(' ') === 'a. b. c.', markers);
  await page.keyboard.press('Escape');

  
  await appendBlock(page);
  await type(page, 'Parent');
  await page.keyboard.press('Enter');
  await type(page, 'Kid');
  await wait(150);
  await leaf('Kid').hover();
  await wait(200);
  const hb = await page.locator('.nc-block-handle').boundingBox();
  const pb = await blockEl('Parent').boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 30, hb.y - 10, { steps: 4 });
  await page.mouse.move(pb.x + 120, pb.y + pb.height - 4, { steps: 8 });
  await wait(100);
  const ind = await page.evaluate(() => {
    const d = document.querySelector('.nc-drop-indicator');
    return d ? d.getBoundingClientRect().left : null;
  });
  await shot(page, 'drag-nest');
  await page.mouse.up();
  await wait(400);
  check('nesting drop indicator is indented under the target', ind !== null && ind > pb.x + 20, { ind, left: pb.x });
  let t = await tree(page);
  const parent = t.find((b) => b.x === 'Parent');
  check('dropping right of a block nests the dragged block inside it', parent?.k?.length === 1 && parent.k[0].x === 'Kid' && !t.some((b) => b.x === 'Kid'), parent);

  // ---- copy blocks, paste into an empty block → "Paste and mirror"
  await page.keyboard.press('Escape');
  await appendBlock(page);
  await type(page, 'Sync me');
  await page.keyboard.press('Escape');
  await wait(150);
  const clip = await captureClipboard(`${MOD}+c`);
  check('block copy carries the source ids', !!JSON.parse(clip?.['application/x-nc-blocks'] ?? '{}').src?.length, Object.keys(clip ?? {}));
  await page.keyboard.press('Escape');
  await appendBlock(page);
  await paste(clip);
  await wait(300);
  const offer = page.locator('.lit-overlay-container [role="option"]', { hasText: 'Paste and mirror' });
  check('pasting copied blocks offers "Paste and mirror"', (await offer.count()) === 1 && (await page.locator('.lit-overlay-container').innerText()).includes('Suggested actions'));
  await shot(page, 'paste-and-sync-offer');
  await offer.click();
  await wait(500);
  t = await tree(page);
  const container = t.find((b) => b.t === 'transclusion_container');
  const refs = t.filter((b) => b.t === 'transclusion_reference');
  check('Paste and mirror: the source moves into a synced block and the paste becomes a copy of it',
    container?.k?.[0]?.x === 'Sync me' && refs.length === 1 && t.filter((b) => b.x === 'Sync me').length === 0, t.map((b) => b.t));
  check('the synced copy renders the original content', (await page.locator('.lit-page-content [data-content-editable-leaf]', { hasText: /^Sync me$/ }).count()) === 2);

  // ---- Google Calendar share link → the calendar's embed view
  await appendBlock(page);
  await type(page, '/embed', 12);
  await wait(400);
  await page.keyboard.press('Enter');
  await wait(500);
  await type(page, 'https://calendar.google.com/calendar/u/0?cid=dGVzdEBleGFtcGxlLmNvbQ', 5);
  await page.keyboard.press('Enter');
  await wait(600);
  const em = page.locator('.lit-embed-block').last();
  const src = (await em.locator('iframe').getAttribute('src')) ?? '';
  const ib = await em.locator('iframe').boundingBox();
  check('Google Calendar link → /calendar/embed?src=<calendar id>', src === 'https://calendar.google.com/calendar/embed?src=dGVzdEBleGFtcGxlLmNvbQ', src);
  check('Google Calendar embed is 500px tall', Math.round(ib?.height ?? 0) === 500, ib);

  // ---- block links: paste → Mention (block mention) / Synced block / URL; clicking / opening the link reveals the block
  await appendBlock(page);
  await type(page, 'Target block text');
  const targetId = await page.evaluate(() => window.__ncEditor.useEditor.getState().focused?.blockId);
  await page.keyboard.press('Alt+Shift+l');
  await wait(300);
  const blockLink = await page.evaluate(() => navigator.clipboard.readText());
  await appendBlock(page);
  await type(page, 'Ref: ');
  await paste({ 'text/plain': blockLink });
  await wait(200);
  const pasteAs = (await page.locator('.lit-overlay-container').innerText()).split('\n').map((x) => x.trim()).filter(Boolean);
  check('block link → Paste as: Mention / Synced block / URL', JSON.stringify(pasteAs) === JSON.stringify(['Paste as', 'Mention', 'Synced block', 'URL']), pasteAs);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Mention' }).first().click();
  await wait(300);
  const bm = (await richText(page))?.flatMap((d) => d[1] ?? []).find((a) => a[0] === 'p');
  check('Mention stores a mention of the block', bm?.[1] === targetId && bm.length === 2, bm);
  check('a block mention on its own page shows the block text', (await page.locator('.lit-block-mention-token .lit-page-mention-token__title').last().innerText()) === 'Target block text');
  await shot(page, 'block-mention');
  await page.locator('.lit-block-mention-token').last().click();
  const flashed = await page.waitForFunction((id) => document.querySelector('.nc-flash')?.getAttribute('data-block-id') === id, targetId, { timeout: 3000 }).then(() => true).catch(() => false);
  check('clicking a block mention scrolls to the block and flashes it', flashed && (await page.evaluate(() => location.hash.length === 33)));
  const before = (await tree(page)).filter((b) => b.t === 'transclusion_reference').length;
  await appendBlock(page);
  await paste({ 'text/plain': blockLink });
  await wait(200);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Synced block' }).click();
  await wait(500);
  t = await tree(page);
  check('Synced block: the linked block becomes a synced original and a synced copy takes the empty line',
    t.some((b) => b.t === 'transclusion_container' && b.k?.[0]?.x === 'Target block text') && t.filter((b) => b.t === 'transclusion_reference').length === before + 1 && !t.some((b) => b.t === 'text' && b.x === blockLink), t.map((b) => b.t));
  // ---- database link → Connected database view
  await appendBlock(page);
  await type(page, '/table view', 12);
  await wait(400);
  await page.keyboard.press('Enter');
  await wait(800);
  await page.keyboard.press('Escape');
  const db = await page.evaluate(() => {
    const { records } = window.__ncEditor;
    const pageId = document.querySelector('.nc-page-title[data-block-id]')?.getAttribute('data-block-id');
    const id = (records.get('block', pageId)?.content ?? []).find((x) => records.get('block', x)?.type === 'collection_view');
    const b = records.get('block', id);
    return b ? { id, collection: b.collection_id, url: `${location.origin}/${location.pathname.split('/')[1]}/db-${id.replace(/-/g, '')}` } : null;
  });
  await appendBlock(page);
  await paste({ 'text/plain': db?.url ?? '' });
  await wait(200);
  const dbMenu = (await page.locator('.lit-overlay-container').innerText()).split('\n').map((x) => x.trim()).filter(Boolean);
  check('database link → Paste as: Mention / Connected database view / URL', JSON.stringify(dbMenu) === JSON.stringify(['Paste as', 'Mention', 'Connected database view', 'URL']), dbMenu);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Connected database view' }).click();
  await wait(600);
  const linkedViews = await page.evaluate((c) => window.__ncEditor.records.all('block').filter((b) => b.alive !== false && b.type === 'collection_view' && b.collection_id === c && b.view_ids?.length).length, db?.collection);
  check('Connected database view adds a second view block of the same database', linkedViews === 2, linkedViews);
  
  await appendBlock(page);
  await type(page, 'Move me to the sidebar page');
  await wait(150);
  await leaf('Move me to the sidebar page').hover();
  await wait(200);
  const hb2 = await page.locator('.nc-block-handle').boundingBox();
  const row = page.locator('.lit-sidebar-container .nc-sb-page .nc-sb-item', { hasText: 'Welcome to Litpage' }).last();
  const rb = await row.boundingBox();
  await page.mouse.move(hb2.x + hb2.width / 2, hb2.y + hb2.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb2.x - 40, hb2.y, { steps: 4 });
  await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 });
  await wait(100);
  const rowLit = await row.evaluate((el) => el.classList.contains('drop-inside'));
  await shot(page, 'drag-to-sidebar');
  await page.mouse.up();
  await wait(500);
  const moved = await page.evaluate(() => {
    const { records } = window.__ncEditor;
    const b = records.all('block').find((x) => x.alive !== false && (x.properties?.title ?? []).map((d) => d[0]).join('') === 'Move me to the sidebar page');
    const parent = records.get('block', b?.parent_id);
    return { parent: (parent?.properties?.title ?? []).map((d) => d[0]).join(''), last: parent?.content?.[parent.content.length - 1] === b?.id };
  });
  check('dragging a block onto a sidebar page lights its row and moves the block to the end of that page', rowLit && moved.parent === 'Welcome to Litpage' && moved.last, { rowLit, moved });
  check('the moved block leaves this page, with a "Moved to Welcome to Litpage" toast', (await leaf('Move me to the sidebar page').count()) === 0 && (await page.getByText('Moved to Welcome to Litpage').count()) >= 1);

  
  await appendBlock(page);
  await type(page, 'Revisit me later');
  await selectInFocused(page, 0, 7);
  await page.keyboard.press(`${MOD}+Shift+m`);
  await page.waitForSelector('.nc-discussion-popover.composer .nc-comment-input', { timeout: 5000 });
  await type(page, 'Check this', 20);
  await page.keyboard.press('Enter');
  await wait(600);
  await page.keyboard.press('Escape');
  await wait(200);
  await page.click('.lit-page-content [data-discussion-id] >> nth=-1');
  await page.waitForSelector('.nc-discussion-popover .nc-comment', { timeout: 4000 });
  await wait(1800); // past the popover's own "read" moment
  await page.locator('.nc-discussion-popover .nc-comment').first().hover();
  await page.locator('.nc-discussion-popover .nc-comment [aria-label="More actions"]').first().click();
  await wait(300);
  const moreItems = (await page.locator('.lit-overlay-container [role="option"]').allInnerTexts()).map((x) => x.trim());
  check('comment ••• offers "Mark unread"', moreItems.includes('Mark unread'), moreItems);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: 'Mark unread' }).click();
  await wait(400);
  check('the comment shows an unread dot', (await page.locator('.nc-discussion-popover .nc-comment-unread').count()) === 1);
  await page.keyboard.press('Escape');
  await wait(300);
  check('Comments button shows the "new" dot', (await page.locator('.lit-topbar-comments-button:visible [data-testid="comments-unread-dot"]').count()) === 1);
  await page.locator('.lit-topbar-comments-button:visible').first().click();
  await wait(400);
  check('Discussions popup: the thread is under "New"', (await page.locator('.nc-discussions-popover .section', { hasText: 'New' }).count()) === 1 && (await page.locator('.nc-discussions-popover .item.new').count()) === 1);
  await shot(page, 'discussions-unread');
  await page.locator('.nc-discussions-popover .item.new').first().click();
  await wait(900);
  await page.keyboard.press('Escape');
  await wait(300);
  check('opening it from "New" reads it (dot gone, revisit mark cleared)', (await page.locator('[data-testid="comments-unread-dot"]').count()) === 0
    && await page.evaluate(() => Object.keys(window.__ncEditor.records.all('user_settings')[0]?.settings?.discussion_revisit ?? {}).length === 0));

  
  const created = await page.evaluate(async () => {
    const { records } = window.__ncEditor;
    const me = records.all('lit_user')[0]?.id;
    const spaceId = records.all('space')[0]?.id;
    const r = await fetch('/api/rpc/createGroup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ spaceId, name: 'Design Team', memberIds: [me] }), credentials: 'same-origin' });
    // this page becomes one of the user's AI skills (for the selection menu check below)
    const pageId = document.querySelector('.nc-page-title[data-block-id]')?.getAttribute('data-block-id');
    const sk = await fetch('/api/rpc/aiRegisterSkill', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId }), credentials: 'same-origin' });
    return { ok: r.ok, me, spaceId, pageId, skill: sk.ok };
  });
  await page.reload();
  await page.waitForSelector('.lit-page-content [data-content-editable-leaf]', { timeout: 15000 });
  await wait(500);
  await appendBlock(page);
  await type(page, 'Ping @Design', 25);
  await wait(500);
  const groupRow = page.locator('.lit-overlay-container [role="option"]', { hasText: 'Design Team' }).first();
  const groupMenu = await page.locator('.lit-overlay-container').innerText().catch(() => '');
  check('"@" offers the workspace\'s groups with their member count', created.ok && groupMenu.includes('Groups') && (await groupRow.count()) === 1 && (await groupRow.innerText()).includes('1 member'), groupMenu);
  await shot(page, 'group-mention-menu');
  await groupRow.click();
  await wait(400);
  const gm = (await richText(page))?.flatMap((d) => d[1] ?? []).find((a) => a[0] === 'g');
  check('picking a group inserts a group mention ["g", id, space]', !!gm?.[1] && gm[2] === created.spaceId, gm);
  const token = page.locator('.lit-group-mention-token').last();
  check('group mention renders "@Design Team"', (await token.innerText()).replace(/\s+/g, ' ').trim() === '@Design Team', await token.innerText());
  await page.mouse.move(10, 400);
  await token.hover();
  await page.waitForSelector('.nc-group-hover-card', { timeout: 3000 }).catch(() => {});
  const groupCard = await page.locator('.nc-group-hover-card').innerText().catch(() => '');
  const myName = await page.evaluate((id) => window.__ncEditor.records.get('lit_user', id)?.name ?? '', created.me);
  check('hovering a group mention lists its members', groupCard.includes('Design Team') && groupCard.includes('1 member') && (!myName || groupCard.includes(myName)), groupCard);
  await page.mouse.move(10, 400);

  
  await appendBlock(page);
  await type(page, 'Skill target');
  await selectInFocused(page, 0, 5);
  await page.waitForFunction(() => [...document.querySelectorAll('.lit-text-action-menu .nc-tam-skill')].some((x) => x.textContent.includes('Extras 2')), null, { timeout: 5000 }).catch(() => {});
  const skillRows = (await page.locator('.lit-text-action-menu .nc-tam-skill').allInnerTexts()).map((x) => x.trim());
  check('selection menu lists your own skills after the built-in four', created.skill && skillRows.slice(0, 4).join('|') === 'Improve writing|Proofread|Explain|Reformat' && skillRows.includes('Extras 2'), skillRows);
  await page.evaluate(() => { window.__ask = null; window.addEventListener('nc:ask-ai', (e) => { window.__ask = { ...e.detail }; }, { capture: true, once: true }); });
  await page.locator('.lit-text-action-menu .nc-tam-skill', { hasText: 'Extras 2' }).click();
  await wait(300);
  const ask = await page.evaluate(() => window.__ask);
  check('picking your skill runs it on the selection (nc:ask-ai with skillId)', ask?.skillId === created.pageId && ask.start === 0 && ask.end === 5, ask);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait(200);
  
  await leaf('Skill target').click();
  await page.keyboard.press('Escape');
  await wait(150);
  await page.keyboard.press(`${MOD}+/`);
  await wait(300);
  await page.locator('.lit-overlay-container [role="option"]', { hasText: /^Skills$/ }).first().hover();
  await wait(500);
  const skillMenu = await page.locator('.lit-overlay-container').last().innerText().catch(() => '');
  check('block menu › Skills: built-ins + "Your skills" + Manage skills', ['Improve writing', 'Proofread', 'Explain', 'Reformat', 'Your skills', 'Extras 2', 'Manage skills'].every((x) => skillMenu.includes(x)), skillMenu);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await wait(200);

  // ---- opening a block link (page load with "#<block id>") scrolls to the block
  await page.goto(blockLink);
  const revealed = await page.waitForFunction((id) => document.querySelector('.nc-flash')?.getAttribute('data-block-id') === id, targetId, { timeout: 15000 }).then(() => true).catch(() => false);
  check('opening a "Copy link to block" URL scrolls to the block and flashes it', revealed);
} catch (e) {
  check('no exception', false, String(e?.stack ?? e));
} finally {
  await browser.close();
  site.close();
}
console.log(failed() ? `\n${failed()} FAILED` : '\nALL PASSED');
process.exit(failed() ? 1 : 0);

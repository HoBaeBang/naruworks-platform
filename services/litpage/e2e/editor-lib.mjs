// Helpers shared by e2e/editor-*.mjs: fresh signup + empty page, block-tree dump from the record store,
// screenshots into $NC_SHOTS (default /tmp/nc-e2e/e2e-editor), and small assertions that print PASS/FAIL lines.
import { mkdirSync } from 'node:fs';
import { launch, signup } from './lib.mjs';

export const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-editor';
mkdirSync(OUT, { recursive: true });

export const isMac = process.platform === 'darwin';
export const MOD = isMac ? 'Meta' : 'Control';

let failures = 0;
export function check(name, ok, detail) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.log(`FAIL ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  }
}
export function failed() {
  return failures;
}

export async function start({ headless = true } = {}) {
  const ctx = await launch({ headless });
  await signup(ctx.page);
  return ctx;
}

/** New private page; caret ends in the first (empty) text block when `body` is true. */
export async function newPage(page, title = 'Editor test', { body = true } = {}) {
  const before = page.url();
  await page.click('[aria-label="New page"]');
  // the compose button may open a chooser (Page / Chat / AI Meeting Notes / Database)
  const chooser = page.locator('.lit-overlay-container .nc-menu-item:has-text("Page")').first();
  if (await chooser.isVisible({ timeout: 600 }).catch(() => false)) await chooser.click();
  // wait for the NEW page: URL changes and its empty title leaf takes focus
  await page.waitForFunction((u) => location.href !== u && document.activeElement?.matches?.('h1[data-content-editable-leaf]') && document.activeElement.textContent === '', before, { timeout: 15000 });
  await page.waitForTimeout(100);
  await page.keyboard.type(title);
  if (body) {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
  }
  return page.evaluate(() => {
    const el = document.querySelector('.nc-page-title[data-block-id]');
    return el?.getAttribute('data-block-id');
  });
}

/** Block tree of the current page from the record store: [{t, x, k?, checked?, f?}] */
export async function tree(page) {
  return page.evaluate(() => {
    const { records } = window.__ncEditor;
    const pageId = document.querySelector('.nc-page-title[data-block-id]')?.getAttribute('data-block-id');
    const walk = (id) => {
      const b = records.get('block', id);
      if (!b || b.alive === false) return null;
      const title = (b.properties?.title ?? []).map((d) => {
        const a = (d[1] ?? []).find((x) => ['p', 'u', 'd', 'e', 'lm'].includes(x[0]));
        return a ? `{${a[0]}}` : d[0];
      }).join('');
      const node = { t: b.type, x: title };
      if (b.type === 'to_do') node.checked = b.properties?.checked?.[0]?.[0] === 'Yes';
      if (b.format?.toggleable) node.toggleable = true;
      const kids = (b.content ?? []).map(walk).filter(Boolean);
      if (kids.length && b.type !== 'page') node.k = kids;
      return node;
    };
    const p = records.get('block', pageId);
    return (p?.content ?? []).map(walk).filter(Boolean);
  });
}

/** Raw rich text of the block whose leaf currently has focus (or of `blockId`). */
export async function richText(page, blockId) {
  return page.evaluate((id) => {
    const { records, useEditor } = window.__ncEditor;
    const bid = id ?? useEditor.getState().focused?.blockId;
    return records.get('block', bid)?.properties?.title ?? null;
  }, blockId ?? null);
}

export async function focusedBlock(page) {
  return page.evaluate(() => {
    const { records, useEditor } = window.__ncEditor;
    const f = useEditor.getState().focused;
    const b = f ? records.get('block', f.blockId) : null;
    return b ? { id: b.id, t: b.type } : null;
  });
}

export async function selectedBlocks(page) {
  return page.evaluate(() => window.__ncEditor.useEditor.getState().selectedBlocks);
}

export async function shot(page, name) {
  await page.screenshot({ path: `${OUT}/${name}.png` });
}

export async function type(page, text, delay = 15) {
  await page.keyboard.type(text, { delay });
}

/** Select [start,end) of the focused leaf programmatically (keyboard-free), then fire mouseup/keyup. */
export async function selectInFocused(page, start, end) {
  await page.evaluate(([s, e]) => {
    const leaf = document.activeElement;
    const walker = document.createTreeWalker(leaf, NodeFilter.SHOW_TEXT);
    let pos = 0;
    let sn = null, so = 0, en = null, eo = 0;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const len = n.nodeValue.length;
      if (!sn && s <= pos + len) { sn = n; so = s - pos; }
      if (!en && e <= pos + len) { en = n; eo = e - pos; }
      pos += len;
    }
    const r = document.createRange();
    r.setStart(sn, so);
    r.setEnd(en, eo);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
  }, [start, end]);
  await page.waitForTimeout(250);
}

/** Caret to start/end of the current line (macOS Home/End scroll instead of moving the caret). */
export async function lineStart(page) {
  await page.keyboard.press(isMac ? 'Meta+ArrowLeft' : 'Home');
}
export async function lineEnd(page) {
  await page.keyboard.press(isMac ? 'Meta+ArrowRight' : 'End');
}

/** Click below the page content: focuses (or creates) an empty text block at the end of the page. */
export async function appendBlock(page) {
  await page.click('.nc-click-to-append');
  await page.waitForTimeout(120);
}

export async function undo(page) {
  await page.keyboard.press(`${MOD}+z`);
  await page.waitForTimeout(150);
}

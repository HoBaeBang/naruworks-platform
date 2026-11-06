

// Run: node e2e/blocks-measure.mjs
import { launch, signup } from './lib.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-blocks';
mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
const wait = (ms) => page.waitForTimeout(ms);
const rows = [];
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;
function expect(name, got, want, tol) {
  const ok = near(got, want, tol);
  rows.push({ name, got: Math.round(got * 10) / 10, want, ok });
  console.log(`${ok ? 'OK  ' : 'DIFF'}  ${name.padEnd(48)} got ${String(Math.round(got * 10) / 10).padStart(7)}  want ${want}`);
}
async function append() {
  await page.locator('.nc-click-to-append').click();
  await wait(150);
}
async function slash(q) {
  await append();
  await page.keyboard.type('/' + q, { delay: 10 });
  await wait(380);
  await page.keyboard.press('Enter');
  await wait(450);
}
async function closeAll() {
  for (let i = 0; i < 3; i++) {
    if (!(await page.locator('.lit-overlay-container .nc-overlay').count())) break;
    await page.keyboard.press('Escape');
    await wait(100);
  }
}
const box = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

try {
  for (let i = 0; ; i++) {
    try { await signup(page); break; } catch (e) { if (i > 3) throw e; await wait(4000); }
  }
  await page.click('[aria-label="New page"]');
  await wait(300);
  const item = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
  if (await item.count()) await item.first().click();
  await page.waitForSelector('h1[data-content-editable-leaf]');
  await page.keyboard.type('ED Blocks Lab');
  await page.keyboard.press('Enter');
  await wait(300);

  // toggle heading 1, open, empty
  await page.keyboard.press('Backspace');
  await slash('toggle heading 1');
  await page.keyboard.type('Toggle H1 title');
  const h1 = page.locator('.lit-header-block').last();
  await h1.locator('.nc-toggle-caret').click();
  await wait(250);
  {
    const b = await box(h1);
    const caret = await box(h1.locator('.nc-toggle-caret'));
    const leaf = await box(h1.locator('[data-content-editable-leaf]'));
    const hint = await box(h1.locator('.nc-empty-toggle-2'));
    expect('toggle H1: block height (open, empty)', b.h, 119);
    expect('toggle H1: caret x (rel)', caret.x - b.x, 8);
    expect('toggle H1: caret y (rel)', caret.y - b.y, 39.5);
    expect('toggle H1: leaf x (rel)', leaf.x - b.x, 32);
    expect('toggle H1: leaf y (rel)', leaf.y - b.y, 30);
    expect('toggle H1: hint x (rel)', hint.x - b.x, 32);
    expect('toggle H1: hint y (rel)', hint.y - b.y, 73);
    expect('toggle H1: hint w', hint.w, 682);
    expect('toggle H1: hint h', hint.h, 40);
  }

  // callout v2
  await slash('callout');
  await page.keyboard.type('A callout block');
  await wait(200);
  {
    const blk = page.locator('.lit-callout-block').last();
    const b = await box(blk);
    const inner = await box(blk.locator('.nc-callout-2'));
    const icon = await box(blk.locator('.nc-callout-icon-btn'));
    const child = await box(blk.locator('.lit-text-block'));
    expect('callout: block height', b.h, 82);
    expect('callout: inner x (rel)', inner.x - b.x, 8);
    expect('callout: inner w', inner.w, 704);
    expect('callout: inner h', inner.h, 66);
    expect('callout: icon x (rel)', icon.x - b.x, 21);
    expect('callout: icon y (rel)', icon.y - b.y, 28.5);
    expect('callout: child x (rel)', child.x - b.x, 45);
    expect('callout: child y (rel)', child.y - b.y, 21);
    expect('callout: child w', child.w, 654);
  }

  // quote
  await slash('quote');
  await page.keyboard.type('Quoted text line');
  await wait(200);
  {
    const blk = page.locator('.lit-quote-block').last();
    const b = await box(blk);
    const leaf = await box(blk.locator('[data-content-editable-leaf]'));
    expect('quote: block height', b.h, 40);
    expect('quote: leaf x (rel)', leaf.x - b.x, 25);
    expect('quote: leaf w', leaf.w, 673);
  }

  // code (2 lines)
  await slash('code');
  await page.keyboard.type('function add(a, b) {');
  await page.keyboard.press('Enter');
  await page.keyboard.type('\treturn a + b;}');
  await wait(250);
  {
    const blk = page.locator('.lit-code-block').last();
    const b = await box(blk);
    const leaf = await box(blk.locator('.nc-code-leaf-2'));
    const inner = await box(blk.locator('.nc-code-box'));
    expect('code: block height (2 lines)', b.h, 128.8);
    expect('code: box x (rel)', inner.x - b.x, 8);
    expect('code: leaf x (rel)', leaf.x - b.x, 30);
    expect('code: leaf y (rel)', leaf.y - b.y, 44);
    expect('code: leaf w', leaf.w, 660);
    expect('code: leaf h', leaf.h, 40.8);
  }

  // table
  await slash('table');
  await wait(200);
  {
    const blk = page.locator('.lit-table-block').last();
    const b = await box(blk);
    const t = await box(blk.locator('table'));
    const td = await box(blk.locator('td').first());
    expect('table: table x (rel)', t.x - b.x, 14);
    expect('table: table w', t.w, 720);
    expect('table: td w', td.w, 239.7, 1);
    expect('table: td h', td.h, 35, 1.5);
  }
  await page.keyboard.press('Escape');

  // table of contents (3 headings exist? add two)
  await append();
  await page.keyboard.type('## Toggle H2 title');
  await page.keyboard.press('Enter');
  await wait(200);
  await slash('table of contents');
  {
    const blk = page.locator('.lit-table_of_contents-block').last();
    const b = await box(blk);
    const first = await box(blk.locator('.nc-toc-item-2').first());
    expect('toc: first item x (rel)', first.x - b.x, 8);
    expect('toc: item height', first.h, 30);
  }

  // equation empty + done
  await slash('block equation');
  await wait(300);
  {
    const pop = await box(page.locator('.nc-eq-popover'));
    expect('equation editor: width', pop.w, 400);
  }
  await page.keyboard.type('\\int_0^1 x^2 \\, dx = \\frac{1}{3}', { delay: 3 });
  await page.keyboard.press('Enter');
  await wait(300);
  {
    const blk = page.locator('.lit-equation-block').last();
    const b = await box(blk);
    expect('equation: block height (rendered)', b.h, 107.9, 6);
  }

  // button
  await slash('button');
  await wait(300);
  await page.locator('.nc-button-config .nc-button-done').click();
  await wait(200);
  {
    const blk = page.locator('.lit-button-block').last();
    const b = await box(blk);
    const pill = await box(blk.locator('.nc-button-2'));
    expect('button: block height', b.h, 48);
    expect('button: pill x (rel)', pill.x - b.x, 6);
    expect('button: pill h', pill.h, 32);
  }

  // breadcrumb
  await slash('breadcrumb');
  {
    const blk = page.locator('.lit-breadcrumb-block').last();
    const b = await box(blk);
    expect('breadcrumb: block height', b.h, 44);
  }

  // synced
  await slash('synced block');
  await page.keyboard.type('Synced content line');
  await wait(200);
  {
    const blk = page.locator('.lit-transclusion_container-block').last();
    const b = await box(blk.locator('.nc-synced-2'));
    expect('synced: frame w', b.w, 720);
    expect('synced: frame h', b.h, 40);
  }

  // placeholders + bookmark + embed
  for (const [q, cls] of [['image', 'image'], ['video', 'video'], ['audio', 'audio'], ['file', 'file'], ['pdf', 'pdf']]) {
    await slash(q);
    await closeAll();
    const blk = page.locator(`.lit-${cls}-block`).last();
    const b = await box(blk);
    const ph = await box(blk.locator('.nc-blk-placeholder'));
    expect(`${q}: placeholder block height`, b.h, 65);
    expect(`${q}: placeholder w`, ph.w, 704);
    expect(`${q}: placeholder h`, ph.h, 49);
  }
  await slash('2 columns');
  {
    const blk = page.locator('.lit-column_list-block').last();
    const b = await box(blk);
    const col = await box(blk.locator('.lit-column-block').first());
    expect('columns: block height', b.h, 64);
    expect('columns: column w', col.w, 337);
  }
  await page.screenshot({ path: `${OUT}/measure.png`, fullPage: false });
} catch (e) {
  console.log('MEASURE FAILED', e.message);
  await page.screenshot({ path: `${OUT}/measure-error.png` });
} finally {
  writeFileSync(`${OUT}/measure.json`, JSON.stringify(rows, null, 2));
  console.log(`\n${rows.filter((r) => r.ok).length}/${rows.length} metrics within tolerance`);
  await browser.close();
}






// Run: NC_BASE=http://127.0.0.1:5471 node e2e/db-views-misc.mjs
import { freshPage, tableHelpers, createInlineDb } from './db-lib.mjs';
import { setup, createFullPageDb, storeGet, bulkRows, saved, addView, esc } from './dbv-lib.mjs';

const { page, wait, check, shot, section, finish, closeOverlays } = await setup('misc');
const db = () => page.locator('.nc-db').first();
const tab = (name) => db().locator('[role="tab"]').filter({ hasText: new RegExp(`^\\s*${esc(name)}\\s*$`) }).first();
async function selectTab(name) {
  // tabs that don't fit go under "N more…": switch through the same event the sidebar view rows use
  if (!(await tab(name).count())) {
    await page.evaluate(([bid, n]) => {
      const { records } = window.__ncEditor;
      const vid = records.get('block', bid).view_ids.find((v) => records.get('collection_view', v)?.name === n);
      window.dispatchEvent(new CustomEvent('nc:select-view', { detail: { blockId: bid, viewId: vid } }));
    }, [blockId, name]);
    await wait(600);
    return;
  }
  
  if ((await tab(name).getAttribute('aria-selected')) === 'true') return;
  await tab(name).click();
  await wait(500);
}
const rowsOf = (cid) => page.evaluate((c) => window.__ncEditor.records.all('block').filter((b) => b.parent_id === c && b.alive !== false && !b.is_template), cid);
// conditional colors: `var(--lp-red-bg-secondary)` (older builds: `var(--c-redBacSec)`)
const RED_BG = /red-bg-secondary|redBacSec/;
const BLUE_BG = /blue-bg-secondary|bluBacSec/;
const titleOf = (b) => (b?.properties?.title ?? []).map((x) => x[0]).join('');
async function setViewFormat(viewId, patch) {
  await page.evaluate(([vid, p]) => {
    const { records, transactions } = window.__ncEditor;
    const v = records.get('collection_view', vid);
    transactions.run(v.space_id, 'e2e.viewFormat', (tx) => tx.update('collection_view', vid, ['format'], p));
  }, [viewId, patch]);
  await saved(page);
  await wait(300);
}
async function center(loc) {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}
async function lastViewId() {
  const b = await storeGet(page, 'block', blockId);
  return b.view_ids[b.view_ids.length - 1];
}

let blockId = '';
let collectionId = '';
let rowIds = [];
let props = {};

try {
  await freshPage(page, 'DBV Misc', `dbv-misc-${Date.now()}@test.dev`);

  await section('setup', async () => {
    blockId = await createFullPageDb(page, 'Misc DB');
    collectionId = (await storeGet(page, 'block', blockId)).collection_id;
    const t = tableHelpers(page);
    await t.addProperty('Note', 'Text');
    await t.addProperty('Score', 'Number');
    await t.addProperty('When', 'Date');
    const col = await storeGet(page, 'collection', collectionId);
    for (const [id, p] of Object.entries(col.schema)) props[p.name] = id;
    rowIds = await bulkRows(page, collectionId, Array.from({ length: 6 }, (_, i) => ({
      title: `R${i + 1}`,
      props: {
        [props.Note]: [[`note ${i + 1}`]],
        [props.Score]: [[String((i + 1) * 2)]],
        [props.When]: [['‣', [['d', { type: 'date', start_date: `2026-10-${String(i + 5).padStart(2, '0')}` }]]]],
      },
    })));
    await saved(page);
    await wait(400);
    check('setup: 6 rows with Note / Score / When', (await t.titles()).length === 6 && !!props.Note && !!props.Score && !!props.When, (await t.titles()).join(','));
  });

  await section('relation retarget', async () => {
    
    const t = tableHelpers(page);
    await t.addProperty('Link', 'Text');
    const header = t.db().locator('.lit-table-view-header-cell').filter({ has: page.locator('.nc-th-name', { hasText: /^Link$/ }) }).first();
    await header.click();
    await wait(300);
    await page.locator('.lit-overlay-container .nc-menu-item').filter({ hasText: /^\s*Change type/ }).first().hover();
    await wait(400);
    await page.locator('.lit-overlay-container .nc-menu-item').filter({ hasText: /^\s*Relation\s*$/ }).first().click();
    await page.waitForSelector('[role="dialog"][aria-label="Related to"]', { timeout: 5000 });
    check('Change type › Relation: the "Related to" data source picker opens', true);
    await wait(800);
    await page.locator('[role="dialog"][aria-label="Related to"] .nc-rel-ds').filter({ hasText: 'Misc DB' }).first().click();
    await wait(300);
    await page.locator('.nc-rel-button').filter({ hasText: 'Add relation' }).first().click();
    await wait(500);
    await saved(page);
    const col = await storeGet(page, 'collection', collectionId);
    const link = Object.values(col.schema).find((p) => p.name === 'Link');
    check('Change type › Relation: the property relates to the picked data source', link?.type === 'relation' && link?.collection_id === collectionId, JSON.stringify(link));
    // clean up: delete the column so later sections see the original table
    await page.evaluate(([cid]) => {
      const { records, transactions } = window.__ncEditor;
      const c = records.get('collection', cid);
      const id = Object.entries(c.schema).find(([, p]) => p.name === 'Link')?.[0];
      if (id) transactions.run(c.space_id, 'e2e.cleanup', (tx) => tx.set('collection', cid, ['schema', id], undefined));
    }, [collectionId]);
    await saved(page);
    await closeOverlays();
  });

  await section('cell comments', async () => {
    const t = tableHelpers(page);
    const note = await t.cell('R1', 'Note');
    await note.hover();
    await wait(200);
    const btn = note.locator('[data-testid="property-comment"]');
    check('cell 💬: a cell with a value offers Comment', (await btn.count()) === 1 && (await btn.getAttribute('aria-label')) === 'Comment');
    const name = await t.cell('R1', 'Name');
    check('cell 💬: not on the Name column', (await name.locator('[data-testid="property-comment"]').count()) === 0);
    await btn.click();
    await page.waitForSelector('.nc-discussion-popover.composer [contenteditable]');
    await page.keyboard.type('Is this right?');
    await page.keyboard.press('Enter');
    await wait(600);
    await saved(page);
    const row = await storeGet(page, 'block', rowIds[0]);
    const ds = await Promise.all((row.discussions ?? []).map((id) => storeGet(page, 'discussion', id)));
    const d = ds.find((x) => x?.property_id === props.Note);
    check('cell 💬: discussion on the Note property of R1', !!d, JSON.stringify(ds.map((x) => x?.property_id)));
    const first = d ? await storeGet(page, 'comment', d.comments[0]) : null;
    check('cell 💬: comment text saved', titleOf({ properties: { title: first?.text } }) === 'Is this right?', JSON.stringify(first?.text));
    await closeOverlays();
    const count = (await t.cell('R1', 'Note')).locator('.nc-prop-comment-count');
    check('cell 💬: the cell shows the thread count', (await count.count()) === 1 && (await count.innerText()).trim() === '1');
    await (await t.cell('R1', 'Note')).hover();
    await (await t.cell('R1', 'Note')).locator('[data-testid="property-comment"]').click();
    await wait(500);
    const pop = page.locator('.lit-overlay-container .nc-overlay').last();
    check('cell 💬: clicking the count opens the thread', (await pop.innerText()).includes('Is this right?'), (await pop.innerText()).slice(0, 120));
    await shot('01-cell-comment');
    await closeOverlays();
  });

  await section('cell selection fill', async () => {
    const t = tableHelpers(page);
    const order = await db().locator('.nc-table-row-outer[data-block-id]').evaluateAll((els) => els.map((e) => e.dataset.blockId));
    const note = async (i) => (await storeGet(page, 'block', order[i])).properties?.[props.Note]?.[0]?.[0] ?? '';
    const score = async (i) => (await storeGet(page, 'block', order[i])).properties?.[props.Score]?.[0]?.[0] ?? '';
    const titleAt = async (i) => titleOf(await storeGet(page, 'block', order[i]));
    const cellAt = async (i, prop) => t.cell(await titleAt(i), prop);
    // drag from Note of row 0 to Note of row 2 → a 3×1 selection
    const a = await center(await cellAt(0, 'Note'));
    const b = await center(await cellAt(2, 'Note'));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    await wait(300);
    check('selection: dragging across cells shows the selection box', (await page.locator('[data-testid="cell-selection"]').count()) === 1);
    check('selection: no cell editor opened', (await page.locator('.lit-overlay-container .nc-overlay').count()) === 0);
    const before1 = await note(1);
    await page.keyboard.press('Meta+d');
    await wait(400);
    check('fill down ⌘D: rows 2–3 take row 1\'s Note', (await note(1)) === (await note(0)) && (await note(2)) === (await note(0)), `${await note(0)} | ${await note(1)} | ${await note(2)}`);
    await shot('02-fill-down');
    await page.keyboard.press('Meta+z');
    await wait(400);
    check('fill down: undo restores the values', (await note(1)) === before1, await note(1));
    await page.keyboard.press('Escape');
    await wait(200);
    check('selection: Esc clears it', (await page.locator('[data-testid="cell-selection"]').count()) === 0);

    // select Score of rows 0–1, drag the fill handle down to row 4 → the two values repeat (a, b, a, b, a)
    const orig = [];
    for (let i = 0; i < 6; i++) orig.push(await score(i));
    const s0 = await center(await cellAt(0, 'Score'));
    const s1 = await center(await cellAt(1, 'Score'));
    await page.mouse.move(s0.x, s0.y);
    await page.mouse.down();
    await page.mouse.move(s1.x, s1.y, { steps: 6 });
    await page.mouse.up();
    await wait(300);
    const handle = page.locator('[data-testid="fill-handle"]');
    check('fill handle: shown on the selection', (await handle.count()) === 1);
    const h = await center(handle);
    const target = await center(await cellAt(4, 'Score'));
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x, target.y, { steps: 10 });
    await wait(150);
    check('fill handle: dragging previews the filled range', (await page.locator('.nc-cell-fill-preview').count()) === 1);
    await page.mouse.up();
    await wait(500);
    await saved(page);
    const got = [await score(0), await score(1), await score(2), await score(3), await score(4), await score(5)];
    check('fill handle: the selected values repeat down to the target row', got.join(',') === [orig[0], orig[1], orig[0], orig[1], orig[0], orig[5]].join(','), `${orig.join(',')} → ${got.join(',')}`);
    // Delete clears the (now larger) selection's cells
    await page.keyboard.press('Backspace');
    await wait(400);
    check('selection: Delete clears the selected cells', (await score(2)) === '' && (await score(4)) === '' && (await score(5)) === orig[5], `${await score(2)} ${await score(4)} ${await score(5)}`);
    await page.keyboard.press('Meta+z');
    await wait(400);
    await page.keyboard.press('Escape');
  });

  await section('list quick edit', async () => {
    await addView(page, db(), 'List');
    await wait(300);
    await db().locator('.nc-list-new').first().click();
    await page.waitForSelector('.nc-list-title.editing');
    await page.keyboard.type('Quick A', { delay: 10 });
    await page.keyboard.press('Shift+Enter');
    await wait(500);
    check('list: Shift+Enter starts a new item below', (await page.locator('.nc-list-title.editing').count()) === 1);
    await page.keyboard.type('Quick B', { delay: 10 });
    await page.keyboard.press('Enter');
    await wait(500);
    await saved(page);
    const titles = await db().locator('.nc-list-item').evaluateAll((els) => els.map((e) => e.querySelector('.nc-list-title')?.textContent?.trim() ?? ''));
    const i = titles.indexOf('Quick A');
    check('list: both items saved, B right after A', i >= 0 && titles[i + 1] === 'Quick B', titles.join(','));
    await shot('03-list-quick-edit');
  });

  await section('card reposition', async () => {
    await addView(page, db(), 'Gallery');
    const vid = await lastViewId();
    await setViewFormat(vid, { gallery_cover: { type: 'page_cover' } });
    // a tiny inline image as R1's cover
    await page.evaluate(([id]) => {
      const { records, transactions } = window.__ncEditor;
      const b = records.get('block', id);
      const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="200" fill="#e33"/><rect y="200" width="400" height="200" fill="#33e"/></svg>');
      transactions.run(b.space_id, 'e2e.cover', (tx) => tx.update('block', id, ['format'], { page_cover: svg }));
    }, [rowIds[0]]);
    await saved(page);
    await wait(400);
    const card = db().locator(`[data-block-id="${rowIds[0]}"]`).first();
    const cover = card.locator('.nc-card-cover').first();
    await cover.hover();
    await wait(200);
    const rep = cover.locator('.nc-card-reposition');
    check('reposition: hovering a cropped cover offers Reposition', (await rep.count()) === 1 && await rep.isVisible());
    await rep.click();
    await wait(200);
    check('reposition: "Drag the image to move it" with Save position / Cancel', (await cover.innerText()).includes('Drag the image to move it') && (await cover.innerText()).includes('Save position'));
    const img = cover.locator('.nc-card-cover-img').first();
    const c = await center(img);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y - 60, { steps: 6 });
    await page.mouse.up();
    await wait(200);
    await shot('04-reposition');
    await cover.locator('.nc-card-reposition-btn').filter({ hasText: 'Save position' }).click();
    await wait(400);
    await saved(page);
    const pos = (await storeGet(page, 'block', rowIds[0])).format?.page_cover_position;
    check('reposition: the page cover position is saved (dragged up = lower part shown)', typeof pos === 'number' && pos > 0.5, String(pos));
    check('reposition: the card did not open', (await page.locator('.nc-peek, .lit-peek-renderer').count()) === 0);
  });

  await section('calendar', async () => {
    await addView(page, db(), 'Calendar');
    const vid = await lastViewId();
    const title = async () => (await db().locator('.nc-cal-title').innerText()).trim();
    const start = await title();
    await db().locator('[aria-label="Next Month"]').click();
    await wait(200);
    await db().locator('[aria-label="Next Month"]').click();
    await wait(300);
    const moved = await title();
    check('calendar: Next Month twice', moved !== start, `${start} → ${moved}`);
    await selectTab('Table');
    await selectTab('Calendar');
    check('calendar: the viewed month is remembered when coming back', (await title()) === moved, await title());
    await db().locator('.nc-cal-today').click();
    await wait(300);
    check('calendar: Today goes back', (await title()) === start, await title());

    // conditional color: Score > 5 → red cards
    await setViewFormat(vid, { conditional_color_rules: [{ id: 'cc1', property: props.Score, filter: { operator: 'number_greater_than', value: { type: 'exact', value: 5 } }, color: 'red_background' }] });
    const bg = async (id) => db().locator(`.nc-cal-item[data-block-id="${id}"] .nc-cal-card`).first().evaluate((el) => el.style.background || '');
    check('calendar: conditional color tints matching cards', RED_BG.test(await bg(rowIds[3])) && !RED_BG.test(await bg(rowIds[0])), `${await bg(rowIds[3])} / ${await bg(rowIds[0])}`);
    await shot('05-calendar-colors');

    // scrolling past the month appends the next months
    const weeks0 = await db().locator('.nc-cal-week').count();
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => {
        const s = document.querySelector('.nc-cal')?.closest('.lit-scroller.vertical, .nc-page-scroller');
        if (s) s.scrollTop = s.scrollHeight;
      });
      await wait(400);
    }
    const weeks1 = await db().locator('.nc-cal-week').count();
    check('calendar: scrolling down adds the next months', weeks1 > weeks0, `${weeks0} → ${weeks1}`);
    check('calendar: the header follows the month in view', (await title()) !== start, await title());
    await shot('06-calendar-scrolled');
    await page.evaluate(() => {
      const s = document.querySelector('.nc-cal')?.closest('.lit-scroller.vertical, .nc-page-scroller');
      if (s) s.scrollTop = 0;
    });
  });

  await section('timeline', async () => {
    await addView(page, db(), 'Timeline');
    const vid = await lastViewId();
    await setViewFormat(vid, { conditional_color_rules: [{ id: 'cc1', property: props.Score, filter: { operator: 'number_greater_than', value: { type: 'exact', value: 5 } }, color: 'red_background' }] });
    await db().hover();
    await db().locator('[aria-label="Show table"]').first().click();
    await wait(500);
    const trs = db().locator('.nc-tl-tr:not(.nc-tl-load-more-spacer)');
    const order = async () => trs.locator('.nc-tl-title-text').allInnerTexts();
    const o0 = await order();
    check('timeline: table rows shown', o0.length >= 6, o0.join(','));
    check('timeline: calculation row under the table', (await db().locator('.nc-tl-table .nc-table-calc-row').count()) === 1);
    // drag the third row above the first one
    const src = trs.nth(2);
    const dst = trs.nth(0);
    const moving = o0[2];
    await src.dragTo(dst, { targetPosition: { x: 30, y: 3 } });
    await wait(500);
    await saved(page);
    const o1 = await order();
    check('timeline: dragging a table row reorders the timeline', o1[0] === moving, o1.join(','));
    const v = await storeGet(page, 'collection_view', vid);
    check('timeline: order saved on the view', (v.page_sort ?? [])[0] === (await page.evaluate(([cid, t]) => window.__ncEditor.records.all('block').find((b) => b.parent_id === cid && b.alive !== false && (b.properties?.title ?? []).map((x) => x[0]).join('') === t)?.id, [collectionId, moving])));
    const bar = async (id) => db().locator(`.nc-tl-bar`).evaluateAll((els, rid) => els.filter((e) => e.closest('[data-block-id]')?.getAttribute('data-block-id') === rid).map((e) => e.style.background || '').join(''), id);
    const hot = await bar(rowIds[3]);
    const cold = await bar(rowIds[0]);
    check('timeline: conditional color tints matching bars', RED_BG.test(hot) && !RED_BG.test(cold), `${hot} / ${cold}`);
    await shot('07-timeline');
    // the calculation row works like the table's: pick Count all on Name
    const calc = db().locator('.nc-tl-table .nc-table-calc-row .nc-table-calc-button').first();
    if (await calc.count()) {
      await calc.hover();
      await calc.click();
      await wait(300);
      const item = page.locator('.lit-overlay-container .nc-menu-item').filter({ hasText: /^\s*Count all\s*$/ }).first();
      if (await item.count()) {
        await item.click();
        await wait(400);
      } else {
        const countMenu = page.locator('.lit-overlay-container .nc-menu-item').filter({ hasText: /^\s*Count\s*$/ }).first();
        await countMenu.hover();
        await wait(300);
        await page.locator('.lit-overlay-container .nc-menu-item').filter({ hasText: /^\s*Count all\s*$/ }).first().click();
        await wait(400);
      }
      await closeOverlays();
      const txt = (await db().locator('.nc-tl-table .nc-table-calc-row').innerText()).replace(/\s+/g, ' ');
      check('timeline: Count all shows in the calculation row', /\b\d+\b/.test(txt), txt);
    } else check('timeline: calculation cell present', false);
  });

  await section('feed colors', async () => {
    await addView(page, db(), 'Feed');
    const vid = await lastViewId();
    await setViewFormat(vid, { conditional_color_rules: [{ id: 'cc1', property: props.Score, filter: { operator: 'number_greater_than', value: { type: 'exact', value: 5 } }, color: 'blue_background' }] });
    const bg = async (id) => db().locator(`.nc-feed-card[data-block-id="${id}"]`).first().evaluate((el) => el.style.background || '');
    check('feed: conditional color tints matching posts', BLUE_BG.test(await bg(rowIds[4])) && !BLUE_BG.test(await bg(rowIds[0])), `${await bg(rowIds[4])} / ${await bg(rowIds[0])}`);
  });

  await section('feed social', async () => {
    await selectTab('Feed');
    const card = db().locator(`.nc-feed-card[data-block-id="${rowIds[0]}"]`);
    await card.scrollIntoViewIfNeeded();
    const discussionsOf = async () => page.evaluate((id) => {
      const { records } = window.__ncEditor;
      return (records.get('block', id)?.discussions ?? []).map((d) => records.get('discussion', d)).filter((d) => d && d.alive !== false)
        .map((d) => ({ id: d.id, type: d.type, comments: (d.comments ?? []).map((c) => records.get('comment', c)).filter(Boolean).map((c) => ({ text: (c.text ?? []).map((x) => x[0]).join(''), reactions: c.reactions ?? {} })) }));
    }, rowIds[0]);
    // reaction
    await card.locator('[data-testid="feed-add-reaction"]').click();
    await page.waitForSelector('.nc-icon-picker [data-section="quick"] .nc-emoji-cell');
    await page.locator('.nc-icon-picker [data-section="quick"] .nc-emoji-cell').filter({ hasText: '👍' }).first().click();
    await wait(400);
    await saved(page);
    const pill = card.locator('[data-testid="feed-reaction"]');
    check('feed: reacting shows a 👍 1 pill (yours)', (await pill.count()) === 1 && (await pill.innerText()).replace(/\s+/g, '') === '👍1' && /\bmine\b/.test(await pill.getAttribute('class')), (await pill.count()) ? await pill.innerText() : 'none');
    let ds = await discussionsOf();
    check('feed: the reaction is stored on the page (page discussion, empty comment)', ds.some((d) => d.type === 'page' && d.comments.length === 1 && !d.comments[0].text && d.comments[0].reactions['👍']?.length === 1), JSON.stringify(ds));
    await pill.click();
    await wait(400);
    await saved(page);
    ds = await discussionsOf();
    check('feed: clicking your pill takes the reaction back (empty thread removed)', (await card.locator('[data-testid="feed-reaction"]').count()) === 0 && !ds.some((d) => d.type === 'page' && !d.comments[0]?.text), JSON.stringify(ds));
    // comment from the feed
    const composer = card.locator('.nc-feed-composer [contenteditable]').first();
    await page.mouse.move(5, 5);
    await composer.click({ force: true });
    await page.keyboard.type('Nice post', { delay: 10 });
    await page.keyboard.press('Enter');
    await wait(500);
    await saved(page);
    ds = await discussionsOf();
    check('feed: a comment from the feed is a page comment of the post', ds.some((d) => d.type === 'page' && d.comments[0]?.text === 'Nice post'), JSON.stringify(ds));
    check('feed: the comment shows under the post', (await card.locator('.nc-feed-comments .nc-discussion').innerText()).includes('Nice post'));
    // react again, then open the post: reactions above the page comments, no empty thread
    await card.locator('[data-testid="feed-add-reaction"]').click();
    await page.waitForSelector('.nc-icon-picker [data-section="quick"] .nc-emoji-cell');
    await page.locator('.nc-icon-picker [data-section="quick"] .nc-emoji-cell').filter({ hasText: '🎉' }).first().click();
    await wait(400);
    await saved(page);
    check('feed: views button (nobody else opened the post yet)', (await card.locator('[data-testid="feed-views"]').count()) === 1 && (await card.locator('[data-testid="feed-views"]').innerText()).trim() === '0', (await card.locator('[data-testid="feed-views"]').count()) ? await card.locator('[data-testid="feed-views"]').innerText() : 'none');
    await shot('12-feed-social');
    await card.locator('.nc-feed-title').click();
    await page.waitForSelector('.nc-row-comments', { timeout: 6000 });
    await wait(500);
    const pd = page.locator('.nc-row-comments').last();
    check('page: the post\'s reactions show as pills above its comments', (await pd.locator('[data-testid="page-reactions"] .nc-reaction').filter({ hasText: '🎉' }).count()) === 1);
    check('page: no empty reaction thread among the comments', (await pd.locator('.nc-discussion').count()) === 1 && (await pd.locator('.nc-discussion').innerText()).includes('Nice post'), String(await pd.locator('.nc-discussion').count()));
    await shot('13-post-page');
    await page.keyboard.press('Escape');
    await wait(400);
  });

  await section('timeline groups subitems', async () => {
    // sub-items on (Sub-item / Parent item pair): R2 and R3 are R1's sub-items; Kind select: R1–R3 = A, R4–R6 = B
    await page.evaluate(([cid, ids]) => {
      const { records, transactions } = window.__ncEditor;
      const c = records.get('collection', cid);
      const ptr = { id: cid, table: 'collection', spaceId: c.space_id };
      const rel = (list) => list.map((id, i) => [['‣', [['p', id, c.space_id]]], ...(i < list.length - 1 ? [[',']] : [])]).flat();
      transactions.run(c.space_id, 'e2e.subitems', (tx) => {
        tx.set('collection', cid, ['schema', 'subi'], { name: 'Sub-item', type: 'relation', collection_id: cid, collection_pointer: ptr, property: 'pari', version: 'v2' });
        tx.set('collection', cid, ['schema', 'pari'], { name: 'Parent item', type: 'relation', collection_id: cid, collection_pointer: ptr, property: 'subi', version: 'v2', limit: 1 });
        tx.set('collection', cid, ['schema', 'kind'], { name: 'Kind', type: 'select', options: [{ id: 'ka', value: 'A', color: 'red' }, { id: 'kb', value: 'B', color: 'blue' }] });
        tx.update('collection', cid, ['format'], { subitem_property: 'subi' });
        tx.set('block', ids[0], ['properties', 'subi'], rel([ids[1], ids[2]]));
        tx.set('block', ids[1], ['properties', 'pari'], rel([ids[0]]));
        tx.set('block', ids[2], ['properties', 'pari'], rel([ids[0]]));
        ids.forEach((id, i) => tx.set('block', id, ['properties', 'kind'], [[i < 3 ? 'A' : 'B']]));
      });
    }, [collectionId, rowIds]);
    await saved(page);
    await selectTab('Timeline');
    const trs = db().locator('.nc-tl-table .nc-tl-tr[data-row-id]');
    const titles = async () => trs.locator('.nc-tl-title-text').allInnerTexts();
    const t0 = await titles();
    check('timeline sub-items: sub-items are nested under their parent (collapsed)', t0.includes('R1') && !t0.includes('R2') && !t0.includes('R3'), t0.join(','));
    const r1 = trs.filter({ has: page.locator('.nc-tl-title-text', { hasText: /^R1$/ }) }).first();
    await r1.hover();
    await r1.locator('.nc-subitem-toggle').click();
    await wait(400);
    const t1 = await titles();
    const i1 = t1.indexOf('R1');
    check('timeline sub-items: expanding R1 shows R2 / R3 right below it', i1 >= 0 && [t1[i1 + 1], t1[i1 + 2]].sort().join(',') === 'R2,R3', t1.join(','));
    const indent = await trs.filter({ has: page.locator('.nc-tl-title-text', { hasText: /^R2$/ }) }).first().locator('.nc-subitem-indent').count();
    check('timeline sub-items: nested rows are indented', indent === 1);
    check('timeline sub-items: bars for the sub-items are drawn too', (await db().locator(`.nc-tl-item[data-block-id="${rowIds[1]}"]`).count()) === 1);
    await shot('09-timeline-subitems');

    // Group by Kind
    const vid = (await storeGet(page, 'block', blockId)).view_ids.find(async () => true);
    const tlId = await page.evaluate((bid) => window.__ncEditor.records.get('block', bid).view_ids.find((id) => window.__ncEditor.records.get('collection_view', id)?.type === 'timeline'), blockId);
    void vid;
    await setViewFormat(tlId, { collection_group_by: { type: 'select', property: 'kind', sort: { type: 'manual' } } });
    const headers = db().locator('.nc-tl-table .nc-tl-group-tr');
    const hText = (await headers.allInnerTexts()).map((x) => x.replace(/\s+/g, ' ').trim());
    check('timeline groups: a header row per group', hText.length >= 2 && hText.some((x) => x.startsWith('A')) && hText.some((x) => x.startsWith('B')), hText.join(' | '));
    const order = await db().locator('.nc-tl-table .nc-tl-tr').evaluateAll((els) => els.map((e) => (e.classList.contains('nc-tl-group-tr') ? `#${e.textContent.trim().split(/\s/)[0]}` : e.querySelector('.nc-tl-title-text')?.textContent ?? '')));
    const ia = order.indexOf('#A');
    const ib = order.indexOf('#B');
    const groupA = order.slice(ia + 1, order.findIndex((x, i) => i > ia && x.startsWith('#')));
    check('timeline groups: R1 (with its sub-items) under A, R4 under B', groupA.includes('R1') && groupA.includes('R2') && order.indexOf('R4') > ib, order.join(','));
    check('timeline groups: canvas has the same rows (bars line up)', (await db().locator('.nc-tl-rows > .nc-tl-row').count()) === (await db().locator('.nc-tl-table .nc-tl-tr').count()) - (await db().locator('.nc-tl-table .nc-tl-load-more-spacer').count()) + (await db().locator('.nc-tl-rows > .nc-tl-addrow').count()) - 0);
    const arrowTops = await db().locator('.nc-tl-offscreen').evaluateAll((els) => els.map((e) => parseInt(e.style.top, 10)));
    const headerIdx = await db().locator('.nc-tl-table .nc-tl-tr:not(.nc-tl-load-more-spacer)').evaluateAll((els) => els.map((e, i) => (e.classList.contains('nc-tl-group-tr') ? i : -1)).filter((i) => i >= 0));
    check('timeline groups: off-screen arrows sit on item rows, not on group headers', arrowTops.length > 0 && !arrowTops.some((t) => headerIdx.includes((t - 9) / 36)), `${arrowTops.join(',')} / headers ${headerIdx.join(',')}`);
    await shot('10-timeline-groups');
    // drag R4 (group B) above R1 (group A) → R4 becomes A
    const r4 = db().locator('.nc-tl-table .nc-tl-tr[data-row-id]').filter({ has: page.locator('.nc-tl-title-text', { hasText: /^R4$/ }) }).first();
    const r1b = db().locator('.nc-tl-table .nc-tl-tr[data-row-id]').filter({ has: page.locator('.nc-tl-title-text', { hasText: /^R1$/ }) }).first();
    await r4.dragTo(r1b, { targetPosition: { x: 40, y: 4 } });
    await wait(500);
    await saved(page);
    const kind4 = (await storeGet(page, 'block', rowIds[3])).properties?.kind?.[0]?.[0];
    check('timeline groups: dropping a row into another group changes its value', kind4 === 'A', String(kind4));
    // collapse group B
    const hb = db().locator('.nc-tl-table .nc-tl-group-tr').filter({ hasText: /^\s*B/ }).first();
    const beforeRows = await db().locator('.nc-tl-table .nc-tl-tr[data-row-id]').count();
    await hb.locator('.nc-group-caret').click();
    await wait(300);
    const afterRows = await db().locator('.nc-tl-table .nc-tl-tr[data-row-id]').count();
    check('timeline groups: collapsing a group hides its rows', afterRows < beforeRows, `${beforeRows} → ${afterRows}`);
    await hb.locator('.nc-group-caret').click();
    await setViewFormat(tlId, { collection_group_by: null });
  });

  await section('calendar subitems', async () => {
    await selectTab('Calendar');
    const chip = db().locator(`.nc-cal-item[data-block-id="${rowIds[0]}"] [data-testid="calendar-subitems"]`);
    check('calendar sub-items: the parent card shows "2 sub-items"', (await chip.count()) === 1 && (await chip.innerText()).trim() === '2 sub-items', (await chip.count()) ? await chip.innerText() : 'none');
    check('calendar sub-items: sub-items are not separate cards (Card property mode)', (await db().locator(`.nc-cal-item[data-block-id="${rowIds[1]}"]`).count()) === 0);
    await chip.click();
    await wait(300);
    const menu = page.locator('.lit-overlay-container .nc-overlay').last();
    const mt = await menu.innerText();
    check('calendar sub-items: clicking lists them', mt.includes('R2') && mt.includes('R3'), mt.replace(/\n/g, ' | '));
    await shot('11-calendar-subitems');
    await closeOverlays();
  });

  await section('get started database', async () => {
    await closeOverlays();
    await page.click('[aria-label="New page"]');
    await wait(400);
    const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
    if (await pageItem.count()) await pageItem.first().click();
    await page.waitForSelector('h1[data-content-editable-leaf]');
    await page.locator('h1[data-content-editable-leaf]').last().click();
    await page.keyboard.type('Tasks');
    await wait(400);
    await page.locator('.nc-get-started [role="button"]').filter({ hasText: /^\s*Database\s*$/ }).first().click();
    await page.waitForSelector('.nc-db.full', { timeout: 5000 });
    await wait(600);
    const pid = await page.locator('.nc-db-page').first().getAttribute('data-page-id');
    const b = await storeGet(page, 'block', pid);
    const c = await storeGet(page, 'collection', b.collection_id);
    check('get started: the page itself became a full-page database', b.type === 'collection_view_page' && JSON.stringify(c.name) === '[["Tasks"]]', `${b.type} ${JSON.stringify(c?.name)}`);
    check('get started: table view + the database setup panel', (await storeGet(page, 'collection_view', b.view_ids[0])).type === 'table' && (await page.locator('.nc-new-db-panel').count()) === 1);
    await shot('08-get-started');
  });

  await section('inline database to sidebar', async () => {
    
    await closeOverlays();
    await page.click('[aria-label="New page"]');
    await wait(400);
    const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
    if (await pageItem.count()) await pageItem.first().click();
    await page.waitForSelector('h1[data-content-editable-leaf]');
    await page.locator('h1[data-content-editable-leaf]').last().click();
    await page.keyboard.type('Inline Holder');
    await page.keyboard.press('Enter');
    await wait(300);
    await createInlineDb(page, 'Drag Me DB');
    const dbBlock = page.locator('.nc-db-block').first();
    const id = await dbBlock.getAttribute('data-block-id');
    await dbBlock.locator('.nc-db-title-leaf').hover();
    await wait(250);
    const handle = page.locator('.nc-block-handle').first();
    const hb = await handle.boundingBox();
    const row = page.locator('.lit-sidebar-container .nc-sb-page .nc-sb-item', { hasText: 'Welcome to Litpage' }).last();
    const rb = await row.boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 40, hb.y, { steps: 4 });
    await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2, { steps: 12 });
    await wait(150);
    await page.mouse.up();
    await wait(600);
    await saved(page);
    const b = await storeGet(page, 'block', id);
    const parent = await storeGet(page, 'block', b?.parent_id);
    check('inline → sidebar: the database moved into the sidebar page', titleOf(parent) === 'Welcome to Litpage', titleOf(parent));
    check('inline → sidebar: it is a full-page database now', b?.type === 'collection_view_page', b?.type);
  });

  await section('pages and rows by drag', async () => {
    
    await closeOverlays();
    await page.click('[aria-label="New page"]');
    await wait(400);
    const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
    if (await pageItem.count()) await pageItem.first().click();
    await page.waitForSelector('h1[data-content-editable-leaf]');
    await page.locator('h1[data-content-editable-leaf]').last().click();
    await page.keyboard.type('Drag Lab');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Anchor text');
    await page.keyboard.press('Enter');
    await wait(300);
    await createInlineDb(page, 'Drag DB');
    const dbBlockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
    const cid = (await storeGet(page, 'block', dbBlockId)).collection_id;
    await bulkRows(page, cid, [{ title: 'Row One' }, { title: 'Row Two' }]);
    const labId = (await storeGet(page, 'block', dbBlockId)).parent_id;
    // a sub-page block "Loose page" at the end of the page
    const looseId = await page.evaluate((pid) => {
      const { records, transactions } = window.__ncEditor;
      const p = records.get('block', pid);
      const id = crypto.randomUUID();
      transactions.run(p.space_id, 'e2e.subpage', (tx) => {
        tx.set('block', id, [], { id, type: 'page', parent_id: pid, parent_table: 'block', alive: true, space_id: p.space_id, version: 0, properties: { title: [['Loose page']] }, content: [] });
        tx.listAfter('block', pid, ['content'], id);
      });
      return id;
    }, labId);
    await saved(page);
    await wait(500);
    // drag the page block by its ⋮⋮ handle onto the table rows
    const loose = page.locator(`[data-block-id="${looseId}"]`).first();
    await loose.hover();
    await wait(250);
    const hb = await page.locator('.nc-block-handle').first().boundingBox();
    const body = await page.locator('.nc-db .lit-collection-view-body').first().boundingBox();
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x - 30, hb.y, { steps: 4 });
    await page.mouse.move(body.x + 200, body.y + body.height / 2, { steps: 12 });
    await wait(150);
    const lit = await page.locator('.nc-db[data-drop-target]').count();
    await page.mouse.up();
    await wait(600);
    await saved(page);
    const moved = await storeGet(page, 'block', looseId);
    check('page → database: the database lights up while the page is over its rows', lit === 1);
    check('page → database: the page became an item of the data source', moved.parent_table === 'collection' && moved.parent_id === cid, `${moved.parent_table} ${moved.parent_id === cid}`);
    check('page → database: it shows as a row', (await tableHelpers(page).titles()).includes('Loose page'), (await tableHelpers(page).titles()).join(','));
    const lab = await storeGet(page, 'block', labId);
    check('page → database: gone from the page content', !(lab.content ?? []).includes(looseId));
    // drag "Row Two" out of the table onto the page (above "Anchor text")
    const t = tableHelpers(page);
    const rowTwo = t.rowByTitle('Row Two');
    const rowId = await rowTwo.getAttribute('data-block-id');
    await rowTwo.hover();
    await wait(200);
    const handle = rowTwo.locator('.nc-row-drag').first();
    const anchorBlock = page.locator('.lit-page-content [data-block-id]').filter({ hasText: /^Anchor text$/ }).first();
    await handle.dragTo(anchorBlock, { targetPosition: { x: 40, y: 4 } });
    await wait(600);
    await saved(page);
    const out = await storeGet(page, 'block', rowId);
    const lab2 = await storeGet(page, 'block', labId);
    check('row → page: the row left the database for the page', out.parent_table === 'block' && out.parent_id === labId, `${out.parent_table} ${out.parent_id === labId}`);
    const anchorId = await anchorBlock.getAttribute('data-block-id').catch(() => null);
    check('row → page: placed before "Anchor text"', (lab2.content ?? []).indexOf(rowId) >= 0 && (lab2.content ?? []).indexOf(rowId) < (lab2.content ?? []).indexOf(anchorId ?? ''), JSON.stringify(lab2.content));
    check('row → page: no longer in the table', !(await t.titles()).includes('Row Two'), (await t.titles()).join(','));
    await shot('14-row-to-page');

    
    const todo = await page.evaluate(([pid, c]) => {
      const { records, transactions } = window.__ncEditor;
      const p = records.get('block', pid);
      const me = records.all('lit_user')[0]?.id;
      const id = crypto.randomUUID();
      transactions.run(p.space_id, 'e2e.todo', (tx) => {
        tx.set('collection', c, ['schema', 'when'], { name: 'When', type: 'date' });
        tx.set('collection', c, ['schema', 'who'], { name: 'Who', type: 'person' });
        tx.set('block', id, [], { id, type: 'to_do', parent_id: pid, parent_table: 'block', alive: true, space_id: p.space_id, version: 0, properties: { title: [['Call '], ['‣', [['u', me]]], [' on '], ['‣', [['d', { type: 'date', start_date: '2026-11-02' }]]]] } });
        tx.listAfter('block', pid, ['content'], id);
      });
      return { id, me };
    }, [labId, cid]);
    await saved(page);
    await wait(500);
    await page.locator(`[data-block-id="${todo.id}"]`).first().hover();
    await wait(250);
    const hb3 = await page.locator('.nc-block-handle').first().boundingBox();
    const body3 = await page.locator('.nc-db .lit-collection-view-body').first().boundingBox();
    await page.mouse.move(hb3.x + hb3.width / 2, hb3.y + hb3.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb3.x - 30, hb3.y, { steps: 4 });
    await page.mouse.move(body3.x + 200, body3.y + body3.height / 2, { steps: 12 });
    await wait(150);
    await page.mouse.up();
    await wait(600);
    await saved(page);
    const item = await storeGet(page, 'block', todo.id);
    check('to-do → database: an item (page) of the data source', item.type === 'page' && item.parent_table === 'collection' && item.parent_id === cid, `${item.type} ${item.parent_table}`);
    check('mentions → properties: Date filled from the @date', item.properties?.when?.[0]?.[1]?.[0]?.[1]?.start_date === '2026-11-02', JSON.stringify(item.properties?.when));
    check('mentions → properties: Person filled from the @person', item.properties?.who?.[0]?.[1]?.[0]?.[1] === todo.me, JSON.stringify(item.properties?.who));
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
void rowsOf;
await finish();

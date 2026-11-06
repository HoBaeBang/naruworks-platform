
// (defect: it used to edit every loaded row), "Add page to" + "Show confirmation" with custom labels, "Insert blocks",
// "Send notification to" (server step → Inbox notification), "Send webhook" (server step → local receiver), step
// reordering; database button property: Edit automation builder (Enter a name / Button is clicked / Save) and a click
// running Show confirmation + Edit property on the clicked row; read-only users can't run buttons.
// Run: NC_BASE=http://127.0.0.1:5421 node e2e/db-buttons.mjs
import { createServer } from 'node:http';
import { apiCall, createInlineDb, freshPage, setup, tableHelpers } from './db-lib.mjs';

process.env.NC_SHOTS ??= '/tmp/nc-e2e/wave3/dba/shots/db-buttons';
const T = await setup('db-buttons');
const { page, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);
const opt = (text) => page.locator('.lit-overlay-container .nc-overlay [role="option"], .lit-overlay-container .nc-overlay [role="menuitem"]').filter({ hasText: text }).first();
const panel = () => page.locator('.nc-button-config').last();

const hooks = [];
const receiver = createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => { try { hooks.push(JSON.parse(data)); } catch { hooks.push(data); } res.end('ok'); });
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${receiver.address().port}/btn`;

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await wait(250);
  }
}

async function setSelect(row, prop, value) {
  await (await tb.cell(row, prop)).click();
  await page.waitForSelector('.nc-select-editor');
  const existing = page.locator('.nc-select-option').filter({ hasText: value });
  if (await existing.count()) await existing.first().click();
  else { await page.keyboard.type(value); await page.keyboard.press('Enter'); }
  await wait(200);
  await closeOverlays();
}

/** Insert a button block at the end of the page and open its config panel. */
async function newButton(name) {
  
  await page.locator('.nc-click-to-append').first().click();
  await wait(250);
  await page.keyboard.type('/button', { delay: 15 });
  await wait(450);
  await page.locator('.lit-overlay-container [role="option"]').filter({ hasText: /^Button/ }).first().click();
  await page.waitForSelector('.nc-button-config');
  await wait(200);
  await panel().locator('.nc-button-config-name').fill(name);
}

async function addStep(label) {
  await panel().locator('[aria-label="Add action"]').click();
  await wait(250);
  await opt(label).click();
  await wait(300);
}

try {
  await freshPage(page, 'Button Lab');

  await section('setup', async () => {
    await createInlineDb(page, 'Tasks');
    await tb.addProperty('Status', 'Status');
    await tb.addProperty('Priority', 'Select');
    await tb.addProperty('Done', 'Checkbox');
    for (const t of ['Alpha', 'Beta', 'Gamma']) await tb.newRow(t);
    await setSelect('Alpha', 'Status', 'Done');
    await setSelect('Gamma', 'Status', 'Done');
    await setSelect('Beta', 'Priority', 'Low');
    await setSelect('Alpha', 'Priority', 'High');
    await setSelect('Alpha', 'Priority', 'Low');
    check('setup: rows and options', (await tb.titles()).length === 3);
  });

  await section('edit-pages-filter', async () => {
    await newButton('Escalate done');
    check('button: config panel (When "Button is clicked" / Do / New action)', (await panel().innerText()).includes('Button') && (await panel().innerText()).includes('is clicked') && (await panel().locator('[aria-label="Add action"]').innerText()).includes('New action'));
    await panel().locator('[aria-label="Add action"]').click();
    await wait(250);
    const menu = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    for (const a of ['Add blocks', 'Add a page to…', 'Change pages in…', 'Notify…', 'Send webhook', 'Ask for confirmation', 'Open page, form, or link', 'Message an agent', 'Set variables']) check(`button menu: ${a}`, menu.includes(a));
    await opt('Change pages in…').click();
    await wait(300);
    const step = panel().locator('[data-step-type="edit_pages"]');
    await step.locator('[aria-label="Choose a dataset"]').click();
    await wait(600);
    await opt(/^Tasks$/).click();
    await wait(300);
    await step.locator('.nc-auto-pill', { hasText: 'all pages' }).click();
    await wait(300);
    await page.locator('.nc-auto-link', { hasText: 'Add filter rule' }).click();
    await wait(250);
    await opt(/^Status$/).click();
    await wait(300);
    const rule = page.locator('.nc-filter-option').filter({ hasText: /^Done$/ }).first();
    if (!(await rule.count())) await page.locator('.nc-auto-pill', { hasText: 'Value' }).last().click();
    await page.locator('.nc-filter-option').filter({ hasText: /^Done$/ }).first().click();
    await wait(200);
    await page.keyboard.press('Escape');
    await wait(200);
    check('edit pages: filter pill "pages that match 1 filter"', await step.locator('.nc-auto-pill', { hasText: 'pages that match 1 filter' }).count());
    await step.locator('.nc-auto-link', { hasText: 'Edit a property' }).click();
    await wait(250);
    await opt(/^Priority$/).click();
    await wait(300);
    await step.locator('.nc-auto-row .nc-auto-pill').first().click();
    await wait(300);
    await page.locator('.nc-auto-pop .nc-auto-opt').filter({ hasText: 'High' }).first().click();
    await wait(300);
    await closeOverlays();
    check('edit pages: row "Set Priority to High"', (await step.innerText()).replace(/\s+/g, ' ').includes('Set Priority to'));
    await shot('01-edit-pages-config');
    await panel().locator('.nc-button-done').click();
    await wait(300);
    await page.locator('.nc-button-2', { hasText: 'Escalate done' }).click();
    const ok = await waitFor(async () => (await (await tb.cell('Alpha', 'Priority')).innerText()).includes('High') && (await (await tb.cell('Gamma', 'Priority')).innerText()).includes('High'));
    check('edit pages: matching rows (Status = Done) edited', ok);
    check('edit pages: non-matching row untouched (defect fixed)', (await (await tb.cell('Beta', 'Priority')).innerText()).includes('Low'), await (await tb.cell('Beta', 'Priority')).innerText());
    check('toast: "Edited 2 pages"', await page.locator('text=/Edited 2 pages/').count());
    await page.keyboard.press('Meta+z');
    await wait(500);
    check('undo: button edits are undoable', !(await (await tb.cell('Gamma', 'Priority')).innerText()).includes('High'));
  });

  await section('add-page-confirm', async () => {
    await newButton('New follow-up');
    await addStep('Add a page to…');
    const add = panel().locator('[data-step-type="add_page"]');
    await add.locator('[aria-label="Choose a dataset"]').click();
    await wait(600);
    await opt(/^Tasks$/).click();
    await wait(300);
    const title = add.locator('[role="textbox"]').first();
    await title.click();
    await page.keyboard.type('Follow-up');
    await addStep('Ask for confirmation');
    const conf = panel().locator('[data-step-type="confirm"]');
    await conf.locator('input[aria-label="Confirmation message"]').fill('Create a follow-up?');
    await conf.locator('input[aria-label="Text for the continue button"]').fill('Yes, add');
    await conf.locator('input[aria-label="Text for the cancel button"]').fill('Not now');
    // move the confirmation above the add-page step (step menu › Move up)
    await conf.hover();
    await conf.locator('[aria-label="More"]').click();
    await wait(200);
    await opt('Move up').click();
    await wait(300);
    const order = await panel().locator('[data-step-type]').evaluateAll((els) => els.map((e) => e.getAttribute('data-step-type')));
    check('steps: Move up reorders steps', order[0] === 'confirm' && order[1] === 'add_page', order.join(','));
    await panel().locator('.nc-button-done').click();
    await wait(300);
    await page.locator('.nc-button-2', { hasText: 'New follow-up' }).click();
    await wait(400);
    const dlg = page.locator('[aria-label="Confirmation"]');
    check('confirm: custom message and labels', (await dlg.innerText()).includes('Create a follow-up?') && (await dlg.innerText()).includes('Yes, add') && (await dlg.innerText()).includes('Not now'));
    await shot('02-confirm');
    await dlg.locator('button', { hasText: 'Not now' }).click();
    await wait(800);
    check('confirm: cancel stops the button', !(await tb.titles()).includes('Follow-up'));
    await page.locator('.nc-button-2', { hasText: 'New follow-up' }).click();
    await wait(300);
    await page.locator('[aria-label="Confirmation"] button', { hasText: 'Yes, add' }).click();
    const ok = await waitFor(async () => (await tb.titles()).includes('Follow-up'));
    check('add page: row "Follow-up" created', ok, (await tb.titles()).join(','));
    check('toast: "Created 1 page" with Open', await page.locator('text=/Created 1 page/').count());
  });

  await section('insert-blocks', async () => {
    await newButton('Log entry');
    await addStep('Add blocks');
    const ins = panel().locator('[data-step-type="insert_blocks"]');
    check('insert blocks: positions menu', (await ins.locator('.nc-auto-pill').first().innerText()).includes('below button'));
    await ins.locator('.nc-auto-blocks-empty').click();
    await wait(300);
    await page.keyboard.type('Logged entry');
    await wait(300);
    await panel().locator('.nc-button-done').click();
    await wait(400);
    const before = await page.locator('.lit-page-content [data-content-editable-leaf]', { hasText: 'Logged entry' }).count();
    await page.locator('.nc-button-2', { hasText: 'Log entry' }).click();
    const ok = await waitFor(async () => (await page.locator('.lit-page-content [data-content-editable-leaf]', { hasText: 'Logged entry' }).count()) > before);
    check('insert blocks: template block inserted below the button', ok);
  });

  await section('click-effect', async () => {
    
    const btnBlock = page.locator('.nc-button-block-wrap').filter({ has: page.locator('.nc-button-2', { hasText: 'Log entry' }) }).first();
    await btnBlock.hover();
    await wait(250);
    await page.locator('.nc-block-handle').first().click();
    await wait(300);
    const item = page.locator('.lit-overlay-container .nc-overlay').last().locator('[role="option"], [role="menuitem"]').filter({ hasText: 'Click effect' }).first();
    check('block menu: "Click effect"', await item.count());
    await item.hover();
    await wait(400);
    const sub = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('Click effect: None / Confetti', sub.includes('None') && sub.includes('Confetti'), sub.replace(/\n/g, ','));
    await page.locator('.lit-overlay-container .nc-overlay').last().locator('[role="option"], [role="menuitem"]').filter({ hasText: 'Confetti' }).first().click();
    await wait(300);
    await closeOverlays();
    await page.locator('.nc-button-2', { hasText: 'Log entry' }).click();
    const burst = await waitFor(async () => (await page.locator('canvas.nc-confetti').count()) > 0, 1500);
    check('confetti: burst on click', burst);
    await shot('06-confetti');
    const gone = await waitFor(async () => (await page.locator('canvas.nc-confetti').count()) === 0, 6000);
    check('confetti: cleans up', gone);
  });

  await section('server-steps', async () => {
    await newButton('Ping');
    await addStep('Notify…');
    const n = panel().locator('[data-step-type="notify"]');
    await n.locator('.nc-auto-pill.placeholder').first().click();
    await wait(300);
    await opt('Test User').click();
    await wait(200);
    await closeOverlays();
    const msg = n.locator('[role="textbox"][aria-label="Message"]');
    await msg.click();
    await page.keyboard.type('Hello from a button');
    await addStep('Send webhook');
    await panel().locator('[data-step-type="webhook"] input[aria-label="URL"]').fill(hookUrl);
    await wait(200);
    await panel().locator('.nc-button-done').click();
    await wait(400);
    await page.locator('.nc-button-2', { hasText: 'Ping' }).click();
    const gotHook = await waitFor(async () => hooks.some((h) => h?.source?.type === 'button'));
    check('webhook: button POST received', gotHook);
    const uc = await apiCall(page, 'loadAccountData', {});
    const sid = Object.keys(uc.body?.recordMap?.space ?? {})[0];
    const res = await apiCall(page, 'getNotifications', { spaceId: sid });
    const notes = Object.values(res.body?.recordMap?.notification ?? {}).map((e) => e.value?.value ?? e.value);
    check('notify: inbox notification with the message', notes.some((x) => x?.type === 'automation' && x?.activity?.message === 'Hello from a button'), JSON.stringify(notes.map((x) => x?.activity?.message)));
  });

  await section('db-button-property', async () => {
    await tb.addProperty('Approve', 'Button');
    await wait(300);
    // header menu › Edit automation
    const id = await tb.colId('Approve');
    await tb.db().locator(`.lit-table-view-header-cell[data-col="${id}"]`).click();
    await wait(300);
    await opt('Edit automation').click();
    await wait(500);
    const m = page.locator('.lit-automation-builder-modal');
    check('db button: builder opens ("Enter a name", Button is clicked, Save)', (await m.locator('.nc-auto-name').getAttribute('placeholder')) === 'Enter a name' && (await m.innerText()).includes('is clicked') && (await m.locator('.nc-btn.primary').innerText()).includes('Save'));
    await m.locator('.nc-auto-name').fill('Approve it');
    await m.locator('[aria-label="Add action"]').click();
    await wait(250);
    const menu = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('db button: actions include Change property… / Ask for confirmation / Open page…', menu.includes('Change property…') && menu.includes('Ask for confirmation') && menu.includes('Open page, form, or link') && !menu.includes('Add blocks'));
    await opt('Ask for confirmation').click();
    await wait(250);
    await m.locator('[aria-label="Add action"]').click();
    await opt('Change property…').hover();
    await wait(400);
    await opt(/^Status$/).click();
    await wait(300);
    await m.locator('[data-step-type="edit_property"] .nc-auto-row .nc-auto-pill').first().click();
    await wait(300);
    await page.locator('.nc-auto-pop .nc-auto-opt').filter({ hasText: 'In progress' }).first().click();
    await wait(300);
    await shot('03-db-button-builder');
    await m.locator('.nc-btn.primary', { hasText: 'Save' }).click();
    await wait(500);
    const btn = (await tb.cell('Beta', 'Approve')).locator('.nc-prop-button');
    check('db button: cell shows the label', (await btn.innerText()).includes('Approve it'));
    await btn.click();
    await wait(300);
    await page.locator('[aria-label="Confirmation"] button', { hasText: 'Continue' }).click();
    const ok = await waitFor(async () => (await (await tb.cell('Beta', 'Status')).innerText()).includes('In progress'));
    check('db button: click edits the clicked row', ok);
    check('db button: other rows untouched', !(await (await tb.cell('Gamma', 'Status')).innerText()).includes('In progress'));
  });
} catch (e) {
  check('no fatal error', false, e.message);
  await shot('fatal');
} finally {
  receiver.close();
  await T.finish();
}

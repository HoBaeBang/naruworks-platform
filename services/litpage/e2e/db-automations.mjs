
// (Event / Property sections), property condition picker, action menu, Edit property step, Enable → server engine
// runs after the detection window and the change reaches the open page in realtime; list popover + summary caption,
// pause (Paused token), "Page added" with a text value + "Whoever triggered", "Every…" recurrence editor, Send
// webhook to a local receiver, View settings › Automations sub-page, read-only state for a viewer.
// Run: NC_BASE=http://127.0.0.1:5421 node e2e/db-automations.mjs
import { createServer } from 'node:http';
import { apiCall, createInlineDb, freshPage, setup, tableHelpers } from './db-lib.mjs';

process.env.NC_SHOTS ??= '/tmp/nc-e2e/wave3/dba/shots/db-automations';
const T = await setup('db-automations');
const { page, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);
const modal = () => page.locator('.lit-automation-builder-modal');
const opt = (text) => page.locator('.lit-overlay-container .nc-overlay [role="option"]').filter({ hasText: text }).first();

// local webhook receiver (the API server allows loopback targets in dev: NC_DEV_ALLOW_LOOPBACK_FETCH=1)
const hooks = [];
const receiver = createServer((req, res) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => { try { hooks.push({ headers: req.headers, body: JSON.parse(data) }); } catch { hooks.push({ body: data }); } res.end('ok'); });
});
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const hookUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

async function openBolt() {
  await tb.db().hover();
  await wait(150);
  await tb.db().locator('.nc-db-toolbar [aria-label="Automations"]').first().click();
  await wait(400);
}

async function setStatus(row, value) {
  await (await tb.cell(row, 'Status')).click();
  await page.waitForSelector('.nc-select-editor');
  await page.locator('.nc-select-option').filter({ hasText: value }).first().click();
  await wait(200);
  await closeOverlays();
}

async function waitFor(fn, ms = 9000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await wait(300);
  }
}

try {
  await freshPage(page, 'Automation Lab');

  await section('setup', async () => {
    await createInlineDb(page, 'Tasks');
    await tb.addProperty('Status', 'Status');
    await tb.addProperty('Done', 'Checkbox');
    await tb.addProperty('Log', 'Text');
    await tb.newRow('Write spec');
    await tb.newRow('Ship it');
    check('setup: two rows', (await tb.titles()).length === 2);
  });

  await section('builder', async () => {
    await openBolt();
    check('builder: ⚡ opens the builder when there are no automations', await modal().count());
    check('builder: name placeholder is “{name}’s automation”', ((await modal().locator('.nc-auto-name').getAttribute('placeholder')) ?? '').endsWith('’s automation'));
    check('builder: scope "For every entry in Tasks"', (await modal().locator('.nc-auto-scope').innerText()).replace(/\s+/g, ' ').includes('For every entry in Tasks'));
    check('builder: When / New trigger / Do / New action', (await modal().innerText()).includes('When') && (await modal().locator('[aria-label="Add trigger"]').innerText()).includes('New trigger') && (await modal().locator('[aria-label="Add action"]').innerText()).includes('New action'));
    const enable = modal().locator('.nc-auto-foot .nc-btn.primary');
    check('builder: Enable disabled while empty', (await enable.getAttribute('aria-disabled')) === 'true' && (await enable.innerText()).trim() === 'Enable');
    const box = await page.locator('.nc-auto-dialog').boundingBox();
    check('builder: dialog 500×600', box && Math.round(box.width) === 500 && Math.round(box.height) === 600, JSON.stringify(box));
    await shot('01-builder-empty');

    await modal().locator('[aria-label="Add trigger"]').click();
    await wait(250);
    const menuText = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('trigger menu: Event section', menuText.includes('Event') && menuText.includes('Any field edited') && menuText.includes('Page added') && menuText.includes('Every…'), menuText.slice(0, 200));
    check('trigger menu: Property section lists properties', menuText.includes('Property') && menuText.includes('Status') && menuText.includes('Done'));
    check('trigger menu: search placeholder', await page.locator('.lit-overlay-container input[placeholder="Search triggers…"]').count());
    await shot('02-trigger-menu');
    await opt(/^Status$/).click();
    await wait(400);
    // condition picker opened on the new card
    await page.locator('.nc-auto-pop .nc-auto-opt').filter({ hasText: 'Done' }).first().click();
    await wait(150);
    await page.locator('.nc-auto-pop .nc-btn.primary', { hasText: 'Done' }).click();
    await wait(200);
    check('trigger card: "Status matches Done"', (await modal().locator('[data-trigger-id]').innerText()).includes('Status matches Done'));

    await modal().locator('[aria-label="Add action"]').click();
    await wait(250);
    const actions = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    for (const a of ['Change property…', 'Add a page to…', 'Change pages in…', 'Notify…', 'Send email…', 'Send webhook', 'Notify in Slack…', 'Set variables']) check(`action menu: ${a}`, actions.includes(a));
    check('action menu: search placeholder "Search actions…"', await page.locator('.lit-overlay-container input[placeholder="Search actions…"]').count());
    await shot('03-action-menu');
    await opt('Change property…').hover();
    await wait(400);
    await opt(/^Done$/).click();
    await wait(300);
    check('step card: Edit property → "Set Done to Checked"', (await modal().locator('[data-step-type="edit_property"]').innerText()).replace(/\s+/g, ' ').includes('Set Done to Checked'));
    check('builder: Enable enabled once valid', (await enable.getAttribute('aria-disabled')) === 'false');
    await shot('04-builder-filled');
    await enable.click();
    await wait(600);
    check('builder: closes after Enable', !(await modal().count()));
    check('toast: "… created"', await page.locator('text=/automation created/').count());
  });

  await section('engine', async () => {
    await setStatus('Ship it', 'Done');
    const ok = await waitFor(async () => (await (await tb.cell('Ship it', 'Done')).locator('[role="checkbox"]').getAttribute('aria-checked')) === 'true');
    check('engine: Status → Done checks Done (server run, realtime to this page)', ok);
    check('engine: other row untouched', (await (await tb.cell('Write spec', 'Done')).locator('[role="checkbox"]').getAttribute('aria-checked')) !== 'true');
    await shot('05-engine-ran');
  });

  await section('list', async () => {
    await openBolt();
    const card = page.locator('.nc-autocard').first();
    check('list: ⚡ shows the automation list', await card.count());
    const caption = await card.locator('.nc-autocard-caption').first().innerText();
    check('list: caption "When Status matches Done, edit Done"', caption.includes('When Status matches Done') && caption.includes('edit Done'), caption);
    await shot('06-list');
    await card.hover();
    await card.locator('[aria-label="More"]').click();
    await wait(250);
    const more = await page.locator('.lit-overlay-container .nc-overlay').last().innerText();
    check('list: card menu Active / Edit / Duplicate / Delete', ['Active', 'Edit', 'Duplicate', 'Delete'].every((x) => more.includes(x)));
    await opt('Active').click();
    await wait(600);
    check('list: pausing shows the Paused token', await page.locator('.nc-autocard-token.paused').count());
    await closeOverlays();
    // paused: no run
    await setStatus('Write spec', 'Done');
    await wait(4500);
    check('engine: paused automation does not run', (await (await tb.cell('Write spec', 'Done')).locator('[role="checkbox"]').getAttribute('aria-checked')) !== 'true');
  });

  await section('page-added', async () => {
    await openBolt();
    await page.locator('.nc-autolist-foot .nc-menu-item', { hasText: 'New automation' }).click();
    await wait(400);
    await modal().locator('.nc-auto-name').fill('Stamp new pages');
    await modal().locator('[aria-label="Add trigger"]').click();
    await opt('Page added').click();
    await wait(200);
    await modal().locator('[aria-label="Add action"]').click();
    await opt('Change property…').hover();
    await wait(400);
    await opt(/^Log$/).click();
    await wait(300);
    const field = modal().locator('[data-step-type="edit_property"] [role="textbox"]').first();
    await field.click();
    await page.keyboard.type('Added by ');
    await modal().locator('[data-step-type="edit_property"] [aria-label="Mention"]').first().click();
    await wait(300);
    await page.locator('.nc-auto-pop .nc-auto-opt').filter({ hasText: 'Whoever triggered' }).first().click();
    await wait(200);
    check('values: "@" inserts a Whoever triggered chip', (await field.innerText()).includes('Whoever triggered'));
    await modal().locator('.nc-auto-foot .nc-btn.primary').click();
    await wait(600);
    await tb.newRow('Fresh page');
    const ok = await waitFor(async () => (await (await tb.cell('Fresh page', 'Log')).innerText()).includes('Added by'));
    check('engine: Page added → Log "Added by @user"', ok, await (await tb.cell('Fresh page', 'Log')).innerText());
  });

  await section('recurrence', async () => {
    await openBolt();
    await page.locator('.nc-autolist-foot .nc-menu-item', { hasText: 'New automation' }).click();
    await wait(400);
    await modal().locator('[aria-label="Add trigger"]').click();
    await opt('Every…').click();
    await wait(500);
    const rec = page.locator('.nc-rec');
    check('recurrence: editor opens with presets', (await rec.count()) && (await rec.innerText()).includes('Weekday') && (await rec.innerText()).includes('6 Months'));
    await rec.locator('.nc-auto-pop-tab', { hasText: /^Week$/ }).click();
    await wait(150);
    check('recurrence: next occurrence shown', (await rec.locator('.nc-rec-next').innerText()).startsWith('Next occurrence:'));
    await shot('07-recurrence');
    await rec.locator('.nc-btn.primary', { hasText: 'Save' }).click();
    await wait(200);
    check('recurrence: trigger card "Every week"', (await modal().locator('[data-trigger-recurrence]').innerText()).includes('Every week'));
    await modal().locator('[aria-label="Add action"]').click();
    await wait(200);
    check('recurrence: "Change property…" not offered with Every…', !(await page.locator('.lit-overlay-container .nc-overlay').last().innerText()).includes('Change property…'));
    await opt('Add a page to…').click();
    await wait(300);
    await modal().locator('[data-step-type="add_page"] [aria-label="Choose a dataset"]').click();
    await wait(500);
    await opt(/^Tasks$/).click();
    await wait(300);
    await modal().locator('.nc-auto-foot .nc-btn.primary').click();
    await wait(600);
    check('recurrence: saved', !(await modal().count()));
  });

  await section('webhook', async () => {
    await openBolt();
    await page.locator('.nc-autolist-foot .nc-menu-item', { hasText: 'New automation' }).click();
    await wait(400);
    await modal().locator('[aria-label="Add trigger"]').click();
    await opt('Page added').click();
    await modal().locator('[aria-label="Add action"]').click();
    await opt('Send webhook').click();
    await wait(200);
    await modal().locator('input[aria-label="URL"]').fill(hookUrl);
    await modal().locator('[data-step-type="webhook"] .nc-auto-link', { hasText: 'Create custom header' }).click();
    await modal().locator('input[aria-label="Key"]').fill('X-From');
    await modal().locator('input[aria-label="Value"]').fill('clone');
    await shot('08-webhook-step');
    await modal().locator('.nc-auto-foot .nc-btn.primary').click();
    await wait(600);
    await tb.newRow('Hooked');
    const ok = await waitFor(async () => hooks.some((h) => h.body?.data?.properties?.Name?.title?.[0]?.plain_text === 'Hooked'));
    check('webhook: POST received with page properties', ok, JSON.stringify(hooks.map((h) => h.body?.data?.properties?.Name?.title?.[0]?.plain_text)));
    check('webhook: custom header sent', hooks.some((h) => h.headers?.['x-from'] === 'clone'));
  });

  await section('settings', async () => {
    await tb.openSettings();
    await page.locator('.nc-view-settings [role="menuitem"]', { hasText: 'Automations' }).first().click();
    await wait(500);
    const vs = page.locator('.nc-view-settings');
    check('settings: View settings › Automations sub-page', (await vs.locator('.nc-vs-title').innerText()).includes('Automations') && (await vs.locator('.nc-autocard').count()) >= 3);
    await shot('09-settings-automations');
  });

  await section('api', async () => {
    const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
    const chunk = await apiCall(page, 'loadPage', { pageId: blockId });
    const colId = chunk.body?.recordMap?.block?.[blockId]?.value?.value?.collection_id;
    const res = await apiCall(page, 'getAutomations', { collectionId: colId });
    check('api: getAutomations lists 4 automations, canEdit', res.body?.automationIds?.length === 4 && res.body?.canEdit === true, JSON.stringify(res.body?.automationIds?.length));
    const forged = await apiCall(page, 'applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: 'x', operations: [{ pointer: { table: 'automation', id: crypto.randomUUID(), spaceId: 'x' }, path: [], command: 'set', args: { parent_id: colId } }] }] });
    check('api: automation records cannot be written through transactions', forged.status === 403, String(forged.status));
  });
} catch (e) {
  check('no fatal error', false, e.message);
  await shot('fatal');
} finally {
  receiver.close();
  await T.finish();
}

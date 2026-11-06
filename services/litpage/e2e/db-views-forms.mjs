



import { freshPage, createInlineDb } from './db-lib.mjs';
import { setup, storeGet, saved, addView, esc } from './dbv-lib.mjs';

const { page, wait, check, shot, section, finish, closeOverlays } = await setup('forms');
const db = () => page.locator('.nc-db').first();
const question = (name) => page.locator('.nc-form-b-q').filter({ has: page.locator('.nc-form-b-qtitle', { hasText: new RegExp(`^${esc(name)}$`) }) }).first();
async function questionMenu(name) {
  const q = question(name);
  await q.hover();
  await wait(150);
  await q.locator('.nc-form-b-qmore').click();
  await page.waitForSelector('.nc-form-qopts');
  await wait(150);
}
const optRow = (label) => page.locator('.nc-form-qopts [role="menuitem"]').filter({ has: page.locator('.nc-menu-label', { hasText: new RegExp(`^\\s*${esc(label)}\\s*$`) }) }).first();
const formConfig = async () => (await storeGet(page, 'collection_view', (await storeGet(page, 'block', blockId)).view_ids.find(async () => true))) ?? null;
let blockId = '';
let collectionId = '';
let formViewId = '';

try {
  await freshPage(page, 'Form Lab', `dbv-form-${Date.now()}@test.dev`);
  await createInlineDb(page, 'Survey');
  blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
  collectionId = (await storeGet(page, 'block', blockId)).collection_id;
  await page.evaluate((cid) => {
    const { records, transactions } = window.__ncEditor;
    const c = records.get('collection', cid);
    transactions.run(c.space_id, 'e2e.schema', (tx) => {
      tx.set('collection', cid, ['schema', 'kind'], { name: 'Kind', type: 'select', options: [{ id: 'o1', value: 'Bug', color: 'red' }, { id: 'o2', value: 'Idea', color: 'blue' }] });
      tx.set('collection', cid, ['schema', 'stps'], { name: 'Steps', type: 'text' });
    });
  }, collectionId);
  await saved(page);

  await section('form builder', async () => {
    await addView(page, db(), 'Form', { keepOverlays: true });
    await page.waitForSelector('[data-testid="form-autocreate"]', { timeout: 5000 });
    await page.locator('[data-testid="form-autocreate"] .nc-form-btn').click();
    await wait(500);
    await closeOverlays(); // the New view panel
    const b = await storeGet(page, 'block', blockId);
    formViewId = b.view_ids[b.view_ids.length - 1];
    const v = await storeGet(page, 'collection_view', formViewId);
    check('builder: questions created for Name / Kind / Steps', (v.format.form_config.questions ?? []).length === 3, JSON.stringify(v.format.form_config.questions.map((q) => q.config.propertyId)));
  });

  await section('conditional logic', async () => {
    await questionMenu('Kind');
    const txt = await page.locator('.nc-form-qopts').innerText();
    check('question options: Question type / Create a condition / Duplicate question', txt.includes('Question type') && txt.includes('Create a condition') && txt.includes('Duplicate question'), txt.replace(/\n/g, ' | '));
    await optRow('Create a condition').click();
    await wait(500);
    const head = page.locator('[data-testid="form-condition"]').first();
    check('builder: condition header "If Bug is selected"', /If\s+Bug\s+is selected/.test(await head.innerText()), await head.innerText());
    const v = await storeGet(page, 'collection_view', formViewId);
    const steps = v.format.form_config.questions.find((q) => q.config.propertyId === 'stps');
    check('builder: Steps asked only when Kind is Bug', steps?.config.condition?.values?.[0] === 'Bug', JSON.stringify(steps?.config.condition));
    await shot('01-condition');
  });

  await section('duplicate question + question type', async () => {
    await closeOverlays();
    await questionMenu('Steps');
    await optRow('Duplicate question').click();
    await wait(500);
    const v = await storeGet(page, 'collection_view', formViewId);
    const qs = v.format.form_config.questions;
    check('duplicate: a fourth question right after Steps', qs.length === 4 && qs[3].config.propertyId !== 'stps', qs.map((q) => q.config.propertyId).join(','));
    const col = await storeGet(page, 'collection', collectionId);
    const dupProp = qs[3].config.propertyId;
    check('duplicate: backed by a copy of the property', col.schema[dupProp]?.type === 'text', JSON.stringify(col.schema[dupProp]));
    const dupName = col.schema[dupProp].name;
    await closeOverlays();
    await questionMenu(dupName);
    await optRow('Question type').click();
    await wait(300);
    await page.locator('.lit-overlay-container .nc-overlay').last().locator('.nc-menu-item').filter({ hasText: /^\s*Number\s*$/ }).first().click();
    await wait(400);
    check('question type: the property became a Number', (await storeGet(page, 'collection', collectionId)).schema[dupProp]?.type === 'number');
    await closeOverlays();
  });

  await section('form settings', async () => {
    await db().hover();
    await wait(150);
    await db().locator('.nc-db-toolbar [aria-label="Settings"]').first().click();
    await page.waitForSelector('[data-testid="form-settings"]');
    const txt = await page.locator('[data-testid="form-settings"]').innerText();
    // (the help link "Explore forms" only shows when a HELP_URL is configured; none by default)
    check('form settings: New question / Submit screen / Select template / Who can submit / Automations / Delete form', ['New question', 'Submit screen', 'Select template', 'Who can submit', 'Automations', 'Delete form'].every((t) => txt.includes(t)), txt.replace(/\n/g, ' | '));
    await page.locator('[data-testid="form-settings"] [role="menuitem"]').filter({ hasText: 'Submit screen' }).first().click();
    await page.waitForSelector('[data-testid="form-submit-screen"]');
    const fields = page.locator('[data-testid="form-submit-screen"] .nc-form-settings-field');
    await fields.nth(0).locator('input').fill('Send it');
    await fields.nth(1).locator('input').fill('All done');
    await fields.nth(1).locator('input').press('Enter');
    await wait(300);
    await page.locator('[data-testid="form-submit-screen"] [role="menuitem"]').filter({ hasText: 'Email me a copy' }).first().click();
    await wait(300);
    await shot('02-submit-screen');
    const v = await storeGet(page, 'collection_view', formViewId);
    const ss = v.format.form_config.submitScreen ?? {};
    check('submit screen: text, confirmation title and Email me a copy saved', ss.submitButtonText === 'Send it' && ss.confirmationTitle === 'All done' && ss.allowEmailResponse === true, JSON.stringify(ss));
    await closeOverlays();
  });

  await section('preview with conditional question', async () => {
    await page.locator('[data-testid="form-preview-button"]').click();
    await page.waitForSelector('[data-testid="form-preview"] .nc-form-r-q');
    await wait(400);
    const prev = page.locator('[data-testid="form-preview"]');
    const titles = async () => prev.locator('.nc-form-r-qtitle').allInnerTexts();
    check('preview: Steps hidden until Kind is Bug', !(await titles()).some((t) => t.startsWith('Steps')), (await titles()).join(' | '));
    await prev.locator('.nc-form-option').filter({ hasText: 'Bug' }).first().click();
    await wait(300);
    check('preview: choosing Bug asks Steps', (await titles()).some((t) => t.startsWith('Steps')), (await titles()).join(' | '));
    check('preview: submit button says "Send it"', (await prev.locator('[data-testid="form-submit"]').innerText()).trim() === 'Send it');
    await prev.locator('.nc-form-r-q').first().locator('input, textarea').first().fill('Crash on save');
    await prev.locator('.nc-form-r-q').filter({ hasText: 'Steps' }).first().locator('input, textarea').first().fill('Click save');
    await prev.locator('[data-testid="form-submit"]').click();
    await page.waitForSelector('[data-testid="form-confirmation"]');
    check('preview: confirmation title "All done"', (await prev.locator('.nc-form-done-title').innerText()).trim() === 'All done');
    await shot('03-confirmation');
    await page.keyboard.press('Escape');
    await wait(500);
    await saved(page);
    const rows = await page.evaluate((cid) => window.__ncEditor.records.all('block').filter((b) => b.parent_id === cid && !b.is_template && b.alive !== false), collectionId);
    const r = rows.find((x) => x.properties?.title?.[0]?.[0] === 'Crash on save');
    check('submission: row with the conditional answer', !!r && r.properties?.stps?.[0]?.[0] === 'Click save', JSON.stringify(r?.properties ?? {}));
  });

  await section('get started form', async () => {
    // a new empty page → Get started › Form turns the page into a form database with a Respondent property
    await page.keyboard.press('Escape');
    await page.click('[aria-label="New page"]');
    await wait(400);
    const pageItem = page.locator('.nc-overlay [role=option]').filter({ hasText: /^\s*Page\s*$/ });
    if (await pageItem.count()) await pageItem.first().click();
    await page.waitForSelector('h1[data-content-editable-leaf]');
    await page.locator('h1[data-content-editable-leaf]').last().click();
    await page.keyboard.type('Feedback');
    await wait(400);
    const chip = page.locator('.nc-get-started [role="menuitem"], .nc-get-started [role="button"]').filter({ hasText: /^\s*Form\s*$/ }).first();
    await chip.click();
    await page.waitForSelector('.nc-db.full', { timeout: 5000 });
    await wait(600);
    const pid = await page.locator('.nc-db-page').first().getAttribute('data-page-id');
    const b = await storeGet(page, 'block', pid);
    const c = await storeGet(page, 'collection', b.collection_id);
    check('get started: the page became a full-page database', b.type === 'collection_view_page' && JSON.stringify(c.name) === '[["Feedback"]]', `${b.type} ${JSON.stringify(c.name)}`);
    check('get started: a form view', (await storeGet(page, 'collection_view', b.view_ids[0])).type === 'form');
    check('get started: Respondent property', Object.values(c.schema).some((p) => p.name === 'Respondent' && p.type === 'created_by'));
  });
} catch (e) {
  check('script: no exception', false, e.message.split('\n')[0]);
  await shot('err-top');
}
void formConfig;
await finish();

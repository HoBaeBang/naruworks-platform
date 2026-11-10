// Shell: reminders + notification emails end to end.
//  - "@remind tomorrow 9am" typed in a page → server schedules a job for tomorrow 9:00 in the browser's time zone
//  - advancing the scheduler (dev endpoint) fires it → Inbox badge updates in realtime → "Reminder for <page>" item
//  - "Always send email notifications" on → the reminder is also emailed (dev outbox GET /api/dev/mail)
//  - deleting the reminder text cancels the job; a database Date property reminder notifies the person who set it
// Run: NC_BASE=http://127.0.0.1:5441 node e2e/shell-reminders.mjs
import { mkdirSync } from 'node:fs';
import { launch, BASE, newPage } from './lib.mjs';
import { apiLogin, call, reporter, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/e2e-shell/reminders';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const { browser, page } = await launch();
page.setDefaultTimeout(10000);
page.setDefaultNavigationTimeout(60000); // page loads on the shared dev server can be slow
const badge = () => page.$eval('nav .nc-sb-badge', (e) => e.textContent).catch(() => null);

try {
  const me = await apiLogin(page, { name: 'Remi Nder', workspace: 'Remind Co' });
  const spaceId = me.spaceId;
  // the login code was "emailed" (dev outbox)
  const outbox0 = await page.evaluate(async (to) => (await fetch(`/api/dev/mail?format=json&to=${encodeURIComponent(to)}`)).json(), me.email);
  r.ok(outbox0.messages?.some((m) => m.kind === 'login_code' && /sign-in code/i.test(m.subject)), 'login code email in the dev outbox');

  await newPage(page);
  await page.keyboard.type('Launch checklist');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Ship the release ');
  await page.keyboard.type('@remind tomorrow 9am');
  await page.waitForSelector('.lit-overlay-container [role="option"]');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.lit-reminder-token');
  r.ok(true, '"@remind tomorrow 9am" inserts a reminder token');
  await page.waitForTimeout(1500);
  const blockId = await page.$eval('.lit-reminder-token', (el) => el.closest('[data-block-id]')?.getAttribute('data-block-id'));
  const rem = await waitFor(async () => {
    const x = await call(page, 'getPageReminders', { blockIds: [blockId] });
    return x.reminders?.length ? x.reminders : null;
  });
  const expected = new Date();
  expected.setDate(expected.getDate() + 1);
  expected.setHours(9, 0, 0, 0);
  r.ok(rem?.length === 1 && rem[0].runAt === expected.getTime(), `scheduled for tomorrow 9:00 local (${rem && new Date(rem[0].runAt).toString()})`);

  // Settings › Notifications › "Always send email notifications" (stored in user_settings; the server honors it)
  await page.evaluate(async (uid) => {
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: [{ id: crypto.randomUUID(), spaceId: '', operations: [{ pointer: { table: 'user_settings', id: uid }, path: ['settings'], command: 'update', args: { email_always: true } }] }] }) });
  }, me.userId);

  const before = await badge();
  const ran = await call(page, 'devRunScheduler', { advanceMs: rem[0].runAt - Date.now() + 1000 });
  r.ok(ran.ran >= 1, `scheduler fired (${ran.ran} job(s))`);
  r.ok(await waitFor(async () => (await badge()) !== before && (await badge()) !== null), `Inbox badge updates in realtime (${before} → ${await badge()})`);
  await page.click('nav [aria-label="Inbox"]');
  const item = page.locator('.nc-inbox-row[data-notification-type="reminder"]').first();
  await item.waitFor();
  const text = await item.textContent();
  r.ok(/Reminder\s*for\s*Launch checklist/.test(text ?? ''), `Inbox item: "${text?.slice(0, 80)}"`);
  r.ok(/Ship the release/.test(text ?? ''), 'item quotes the reminder text');
  await page.screenshot({ path: `${OUT}/01-reminder-inbox.png` });
  await call(page, 'devRunScheduler', { advanceMs: 2000 });
  const mails = await page.evaluate(async (to) => (await fetch(`/api/dev/mail?format=json&to=${encodeURIComponent(to)}`)).json(), me.email);
  r.ok(mails.messages?.some((m) => m.kind === 'notification:reminder' && /Reminder for Launch checklist/.test(m.subject)), 'reminder emailed ("Always send email notifications")');
  await page.goto(`${BASE}/api/dev/mail`);
  r.ok(/Mail outbox/.test(await page.textContent('h1')), 'dev outbox page renders');
  await page.screenshot({ path: `${OUT}/02-dev-outbox.png` });
  await page.goBack();
  await page.waitForSelector('nav.lit-sidebar-container');

  // a fresh reminder, then delete its text → job cancelled
  await page.keyboard.press('Escape');
  await page.click('.lit-page-content');
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.press('Enter');
  await page.keyboard.type('@remind next friday 3pm');
  await page.waitForSelector('.lit-overlay-container [role="option"]');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const ids = await page.$$eval('.lit-reminder-token', (els) => els.map((el) => el.closest('[data-block-id]')?.getAttribute('data-block-id')));
  const second = ids[ids.length - 1];
  const sched = await waitFor(async () => ((await call(page, 'getPageReminders', { blockIds: [second] })).reminders ?? []).length === 1);
  r.ok(!!sched, 'second reminder scheduled');
  await page.keyboard.press('Meta+a');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(1500);
  const after = await waitFor(async () => ((await call(page, 'getPageReminders', { blockIds: [second] })).reminders ?? []).length === 0);
  r.ok(!!after, 'deleting the reminder cancels its job');

  // database Date property reminder (row written like the date picker does)
  const res = await page.evaluate(async ([spaceId, uid]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const dbId = crypto.randomUUID();
    const colId = crypto.randomUUID();
    const viewId = crypto.randomUUID();
    const rowId = crypto.randomUUID();
    const d = new Date(Date.now() + 3 * 86400000);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id: dbId, spaceId }, path: [], command: 'set', args: { id: dbId, type: 'collection_view_page', collection_id: colId, view_ids: [viewId], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }] } },
      { pointer: { table: 'collection', id: colId, spaceId }, path: [], command: 'set', args: { id: colId, name: [['Tasks']], schema: { title: { name: 'Name', type: 'title' }, due: { name: 'Due', type: 'date' } }, parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId } },
      { pointer: { table: 'collection_view', id: viewId, spaceId }, path: [], command: 'set', args: { id: viewId, type: 'table', name: 'Table', format: {}, parent_id: dbId, parent_table: 'block', alive: true, space_id: spaceId } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listAfter', args: { id: dbId } },
      { pointer: { table: 'block', id: rowId, spaceId }, path: [], command: 'set', args: { id: rowId, type: 'page', parent_id: colId, parent_table: 'collection', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, properties: { title: [['Quarterly report']], due: [['‣', [['d', { type: 'date', start_date: ymd, reminder: { unit: 'day', value: 1, time: '09:00' } }]]]] } } },
    ] }] });
    return { rowId };
  }, [spaceId, me.userId]);
  const rowJobs = await waitFor(async () => ((await call(page, 'getPageReminders', { blockIds: [res.rowId] })).reminders ?? []));
  r.ok(rowJobs.length === 1, 'database date reminder scheduled');
  await call(page, 'devRunScheduler', { advanceMs: rowJobs[0].runAt - Date.now() + 1000 });
  const row = page.locator('.nc-inbox-row[data-notification-type="reminder"]', { hasText: 'Quarterly report' }).first();
  if (!(await page.$('.nc-inbox-panel'))) await page.click('nav [aria-label="Inbox"]');
  await row.waitFor({ timeout: 8000 });
  r.ok(/Due/.test(await row.textContent() ?? ''), 'database reminder item names the Date property');
  await page.screenshot({ path: `${OUT}/03-db-reminder.png` });
} catch (e) {
  console.log('FAIL exception', e.message.slice(0, 800));
  process.exitCode = 1;
  await page.screenshot({ path: `${OUT}/error.png` }).catch(() => {});
} finally {
  await browser.close();
  r.done();
}

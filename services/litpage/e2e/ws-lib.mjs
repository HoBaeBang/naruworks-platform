// Helpers for the shell e2e scripts (requests, reminders, people, inbox extras): API sign-up in a fresh browser
// context, JSON API calls from the page, and small polling helpers. Run against private servers: NC_BASE=http://127.0.0.1:5441
import { BASE } from './lib.mjs';

export const uniq = () => `${Date.now()}${Math.floor(Math.random() * 10000)}`;

/** POST /api/rpc/<name> from inside the page (same-origin cookies). */
export function call(page, name, body = {}) {
  return page.evaluate(async ([n, b]) => {
    const r = await fetch(`/api/rpc/${n}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { __error: r.status, ...j };
  }, [name, body]);
}

/**
 * Log in (creating the account if needed) through the API, set the display name, optionally create a workspace,
 * then open Litpage. Returns { email, userId, spaceId }.
 */
export async function apiLogin(page, { email = `ws${uniq()}@test.dev`, name = 'Test User', workspace = 'Acme', createWorkspace = true } = {}) {
  await page.goto(BASE + '/login');
  const res = await page.evaluate(async ([email, name, ws, create]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const { devCode } = await post('sendSignInCode', { email });
    const { userId } = await post('signInWithEmail', { email, code: devCode });
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: '', operations: [{ pointer: { table: 'lit_user', id: userId }, path: [], command: 'update', args: { name, given_name: name, onboarding_completed: true } }] }] });
    let spaceId = null;
    if (create) spaceId = (await post('createWorkspace', { name: ws })).spaceId;
    return { userId, spaceId };
  }, [email, name, workspace, createWorkspace]);
  await page.goto(BASE + '/');
  await page.waitForSelector('nav.lit-sidebar-container', { timeout: 20000 });
  await page.waitForTimeout(600);
  return { email, ...res };
}

/** First workspace id of the signed-in user (from loadAccountData). */
export async function spaceIdOf(page) {
  const uc = await call(page, 'loadAccountData', {});
  return Object.keys(uc.recordMap.space ?? {})[0];
}

export async function waitFor(fn, { timeout = 8000, interval = 200 } = {}) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, interval));
  }
  return last;
}

export function reporter() {
  let failed = 0;
  let passed = 0;
  return {
    ok(cond, msg) {
      console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`);
      if (cond) passed++;
      else failed++;
    },
    done() {
      console.log(`\n${passed} passed, ${failed} failed`);
      if (failed) process.exitCode = 1;
    },
  };
}

/** Create a page via a client transaction (private, in the caller's workspace sidebar). Returns its id. */
export async function createPrivatePage(page, spaceId, title, extra = {}) {
  return page.evaluate(async ([spaceId, title, extra]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
    const uc = await post('loadAccountData', {});
    const userId = Object.keys(uc.recordMap.user_root)[0];
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const id = crypto.randomUUID();
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'block', id, spaceId }, path: [], command: 'set', args: { id, type: 'page', properties: { title: [[title]] }, content: [], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: userId, last_edited_time: now, last_edited_by_id: userId, permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }], ...extra } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['private_pages'], command: 'listBefore', args: { id } },
    ] }] });
    return id;
  }, [spaceId, title, extra]);
}

export const compact = (id) => id.replace(/-/g, '');

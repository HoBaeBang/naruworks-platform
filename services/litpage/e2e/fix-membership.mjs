// Teamspace invite links (Invite Link switch, Copy invite link, /team-invite/<code> join page,
// signed-out visitors come back after login), membership requests from outside the workspace and from
// page guests (guest banner → Request membership) answered in the owner's Inbox, restricted member tags
// and the teamspace sidebar "+" when only owners edit it. One Chrome, several contexts.
// Run: NC_BASE=http://127.0.0.1:5531 node e2e/fix-membership.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { BASE, CHROME } from './lib.mjs';
import { apiLogin, call, createPrivatePage, reporter, uniq, waitFor } from './ws-lib.mjs';

const OUT = process.env.NC_SHOTS ?? '/tmp/nc-e2e/wave3/fix/shots';
mkdirSync(OUT, { recursive: true });
const r = reporter();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const contexts = [];
const mk = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1384, height: 853 }, deviceScaleFactor: 2, locale: 'en-US' });
  contexts.push(ctx);
  const p = await ctx.newPage();
  p.setDefaultTimeout(10000);
  p.setDefaultNavigationTimeout(60000); // busy dev server: page loads can be slow
  p.on('pageerror', (e) => console.log('[pageerror]', e.message));
  return p;
};
const rec = (rm, table, id) => {
  const e = rm?.[table]?.[id];
  return e?.value?.value ?? e?.value;
};

try {
  const id = uniq();
  const A = await mk();
  const a = await apiLogin(A, { email: `owner${id}@test.dev`, name: 'Olga Owner', workspace: 'Invite Co' });
  const spaceId = a.spaceId;
  await call(A, 'changePlan', { spaceId, plan: 'enterprise' });
  const cEmail = `carl${id}@test.dev`;
  const rEmail = `rita${id}@test.dev`;
  await call(A, 'inviteMembers', { spaceId, emails: [cEmail], role: 'editor' });
  await call(A, 'inviteMembers', { spaceId, emails: [rEmail], role: 'restricted_member' });
  // a closed teamspace owned by Olga
  const teamId = crypto.randomUUID();
  await A.evaluate(async ([spaceId, teamId, uid]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const uc = await post('loadAccountData', {});
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    const now = Date.now();
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
      { pointer: { table: 'team', id: teamId, spaceId }, path: [], command: 'set', args: { id: teamId, space_id: spaceId, name: 'Design', description: '', icon: '', team_pages: [], parent_id: spaceId, parent_table: 'space', alive: true, membership: [{ user_id: uid, role: 'owner', added_time: now }], settings: { type: 'closed' }, created_time: now, created_by_id: uid } },
      { pointer: { table: 'space_view', id: sv.id, spaceId }, path: ['joined_teams'], command: 'listAfter', args: { id: teamId } },
    ] }] });
  }, [spaceId, teamId, a.userId]);

  // ---------------------------------------------------------------- Teamspace settings: Invite Link + Copy invite link
  await A.reload();
  await A.waitForSelector('nav.lit-sidebar-container');
  const teamRow = A.locator('nav .nc-sb-team-container', { hasText: 'Design' }).first();
  await teamRow.hover();
  await teamRow.locator('.lit-outliner-team-context-menu-button').click();
  await A.locator('.lit-overlay-container [role="option"], .lit-overlay-container [role="menuitem"]', { hasText: 'Team settings' }).first().click();
  await A.locator('.nc-ts-tab', { hasText: 'Security' }).click();
  const linkSwitch = A.locator('[role="switch"][aria-label="Invite Link"]');
  r.ok(await linkSwitch.count() === 1 && (await linkSwitch.getAttribute('aria-checked')) === 'true', 'Security tab: "Invite Link" switch, on by default');
  await A.screenshot({ path: `${OUT}/20-team-security.png` });
  await A.locator('.nc-ts-tab', { hasText: 'Members' }).click();
  r.ok(await A.locator('.nc-ts-copy-link', { hasText: 'Copy invitation link' }).count() === 1, 'Members tab: Copy invitation link (owners can invite)');
  await A.screenshot({ path: `${OUT}/21-team-members.png` });
  await A.keyboard.press('Escape');
  const link = await call(A, 'getTeamInviteLink', { teamId });
  r.ok(link.enabled && /^\/team-invite\/[\w-]+$/.test(link.path), `the invite link comes from the server (${link.path})`);

  // ---------------------------------------------------------------- a workspace member joins from the link
  const C = await mk();
  const c = await apiLogin(C, { email: cEmail, name: 'Carl Member', createWorkspace: false });
  await C.goto(BASE + link.path);
  await C.waitForSelector('.nc-team-invite-page[data-state="join"]');
  r.ok(/You’re invited to join Design/.test(await C.textContent('.nc-team-invite-page') ?? ''), 'join page: "You’re invited to join Design"');
  await C.screenshot({ path: `${OUT}/22-team-invite-join.png` });
  await C.getByRole('button', { name: 'Join team' }).click();
  r.ok(await waitFor(() => C.locator('nav .nc-sb-team-container', { hasText: 'Design' }).count()), 'after Join team the teamspace is in the sidebar');
  const team1 = rec((await call(A, 'fetchRecords', { requests: [{ pointer: { table: 'team', id: teamId } }] })).recordMap, 'team', teamId);
  r.ok(team1?.membership?.some((m) => m.user_id === c.userId && m.role === 'member'), 'Carl is a teamspace member');
  // only owners edit the sidebar → Carl's "+" is disabled
  await A.evaluate(async ([spaceId, teamId]) => {
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'team', id: teamId, spaceId }, path: ['settings'], command: 'update', args: { sidebar_edit: 'owners', invite_access: 'owners' } }] }] }) });
  }, [spaceId, teamId]);
  await C.reload();
  await C.waitForSelector('nav.lit-sidebar-container');
  const carlTeam = C.locator('nav .nc-sb-team-container', { hasText: 'Design' }).first();
  await carlTeam.hover();
  r.ok(await waitFor(async () => (await carlTeam.locator('[aria-label="Create a page"]').getAttribute('aria-disabled')) === 'true'), '"Who can edit teamspace sidebar" = owners: a member’s "+" is disabled');
  r.ok((await call(C, 'getTeamInviteLink', { teamId })).__error === 403, 'only people who can invite members get the link');

  // ---------------------------------------------------------------- outsider: signed out → login → request membership
  const O = await mk();
  await O.goto(BASE + link.path);
  r.ok(await waitFor(() => O.url().includes('/login')), 'signed out: the link asks to log in first');
  const oEmail = `outsider${id}@test.dev`;
  await O.evaluate(async ([email]) => {
    const post = (n, b) => fetch('/api/rpc/' + n, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((x) => x.json());
    const { devCode } = await post('sendSignInCode', { email });
    const { userId } = await post('signInWithEmail', { email, code: devCode });
    await post('applyChanges', { transactions: [{ id: crypto.randomUUID(), spaceId: '', operations: [{ pointer: { table: 'lit_user', id: userId }, path: [], command: 'update', args: { name: 'Oscar Outsider', given_name: 'Oscar', onboarding_completed: true } }] }] });
    await post('createWorkspace', { name: 'Oscar home' });
  }, [oEmail]);
  await O.goto(BASE + '/');
  r.ok(await waitFor(() => O.url().includes(link.path), { timeout: 10000 }), 'after logging in the visitor lands back on the invite link');
  await O.waitForSelector('.nc-team-invite-page[data-state="no_access"]');
  r.ok(/That invite link is disabled/.test(await O.textContent('.nc-team-invite-page') ?? ''), 'external membership requests off: Litpage’s "That invite link is disabled…" message');
  await A.evaluate(async ([spaceId]) => {
    await fetch('/api/rpc/applyChanges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ transactions: [{ id: crypto.randomUUID(), spaceId, operations: [{ pointer: { table: 'space', id: spaceId, spaceId }, path: ['settings'], command: 'update', args: { allow_external_member_requests: true } }] }] }) });
  }, [spaceId]);
  await O.reload();
  await O.waitForSelector('.nc-team-invite-page[data-state="request"]');
  r.ok(/Ask for access to Design/.test(await O.textContent('.nc-team-invite-page') ?? ''), 'external requests on: "Ask for access to Design"');
  await O.fill('.nc-team-invite-page textarea', 'I run the design studio');
  await O.getByRole('button', { name: 'Request access' }).click();
  r.ok(await waitFor(() => O.getByRole('button', { name: 'Pending' }).count()), 'after Request access the button shows Pending');
  await O.screenshot({ path: `${OUT}/23-team-invite-request.png` });

  // ---------------------------------------------------------------- owner approves in the Inbox
  await A.reload();
  await A.waitForSelector('nav.lit-sidebar-container');
  await A.keyboard.press('Meta+Alt+u');
  const reqRow = A.locator('.nc-inbox-row', { hasText: 'asked to become a workspace member' }).first();
  await reqRow.waitFor();
  r.ok(/I run the design studio/.test(await reqRow.textContent() ?? ''), 'Inbox: "Oscar Outsider asked to become a workspace member, “…”"');
  await A.screenshot({ path: `${OUT}/24-inbox-member-request.png` });
  await reqRow.getByRole('button', { name: 'Approve' }).click();
  r.ok(await waitFor(() => reqRow.locator('.nc-inbox-resolved', { hasText: /Approved by You/ }).count()), 'after Approve the item reads "Approved by You at …"');
  const sp = rec((await call(A, 'fetchRecords', { requests: [{ pointer: { table: 'space', id: spaceId } }] })).recordMap, 'space', spaceId);
  const oscarId = (await call(O, 'loadAccountData', {})).recordMap && Object.keys((await call(O, 'loadAccountData', {})).recordMap.user_root)[0];
  r.ok(sp?.permissions?.some((p) => p.user_id === oscarId && p.role === 'editor'), 'Oscar is now a workspace member');
  const team2 = rec((await call(A, 'fetchRecords', { requests: [{ pointer: { table: 'team', id: teamId } }] })).recordMap, 'team', teamId);
  r.ok(team2?.membership?.some((m) => m.user_id === oscarId), '…and a member of Design');
  await A.keyboard.press('Escape');

  // ---------------------------------------------------------------- page guest asks to become a member
  const G = await mk();
  const gEmail = `guest${id}@test.dev`;
  const g = await apiLogin(G, { email: gEmail, name: 'Gwen Guest', workspace: 'Gwen home' });
  const shared = await createPrivatePage(A, spaceId, 'Partner brief');
  await call(A, 'invitePagePermissions', { pageId: shared, userIds: [g.userId], role: 'reader' });
  const domain = sp.domain;
  await G.goto(`${BASE}/${domain}/Partner-brief-${shared.replace(/-/g, '')}`);
  const banner = G.locator('.nc-guest-banner');
  await banner.waitFor();
  r.ok(/In Invite Co you only have guest access\. Join as a member/.test(await banner.textContent() ?? ''), 'guest banner: "In Invite Co you only have guest access. Join as a member…"');
  await banner.getByRole('button', { name: 'Request membership' }).click();
  const dialog = G.locator('.nc-membership-request');
  await dialog.waitFor();
  r.ok(/Request membership in Invite Co/.test(await dialog.textContent() ?? ''), 'dialog: "Request membership in Invite Co"');
  await dialog.locator('textarea').fill('Working with you on the brief');
  await G.screenshot({ path: `${OUT}/25-guest-request.png` });
  await dialog.getByRole('button', { name: 'Send request' }).click();
  r.ok(await waitFor(() => G.locator('.nc-guest-banner[data-state="pending"]').count()), 'the banner shows the pending request');
  const reqs = rec((await call(A, 'fetchRecords', { requests: [{ pointer: { table: 'space', id: spaceId } }] })).recordMap, 'space', spaceId)?.settings?.member_requests ?? [];
  r.ok(reqs.some((x) => x.requested_by === g.userId && x.self && x.via === 'guest'), 'the request is in Settings › Requests (self request)');

  // ---------------------------------------------------------------- restricted member tags in the Share menu
  await A.goto(`${BASE}/${domain}/Partner-brief-${shared.replace(/-/g, '')}`);
  await A.waitForSelector('.lit-topbar');
  await A.locator('.lit-topbar [aria-label="Share"]').first().click();
  await A.waitForSelector('.nc-share-invite-input input');
  await A.fill('.nc-share-invite-input input', 'rita');
  const sugg = A.locator('.nc-share-suggestions .nc-share-row', { hasText: rEmail }).first();
  r.ok(await waitFor(() => sugg.count()) === 1, 'invite suggestions list the restricted member');
  r.ok(await sugg.locator('.guest.restricted', { hasText: 'Restricted member' }).count() === 1, '…with a "Restricted member" tag');
  await A.screenshot({ path: `${OUT}/26-share-restricted.png` });
  await sugg.click();
  r.ok(await waitFor(() => A.locator('.nc-share-people .nc-share-row.person', { hasText: rEmail }).locator('.guest.restricted').count()), 'the people list tags the restricted member');
  await A.keyboard.press('Escape');

  // a member shares with a restricted member → owners approve first ("Access requested for …")
  const carlPage = await createPrivatePage(C, spaceId, 'Carl plan');
  await C.goto(`${BASE}/${domain}/Carl-plan-${carlPage.replace(/-/g, '')}`);
  await C.waitForSelector('.lit-topbar');
  await C.locator('.lit-topbar [aria-label="Share"]').first().click();
  await C.waitForSelector('.nc-share-invite-input input');
  await C.fill('.nc-share-invite-input input', 'rita');
  const carlSugg = C.locator('.nc-share-suggestions .nc-share-row', { hasText: rEmail }).first();
  await carlSugg.waitFor();
  r.ok(/A workspace owner must approve this restricted member/.test(await carlSugg.getAttribute('data-tooltip') ?? ''), 'a member sees "A workspace owner must approve this restricted member first"');
  await carlSugg.click();
  r.ok(await waitFor(() => C.locator('text=Access requested for').count()), 'sharing asks the owners instead: "Access requested for …"');
  await A.goto(BASE + '/');
  await A.waitForSelector('nav.lit-sidebar-container');
  await A.keyboard.press('Meta+Alt+u');
  const ritaReq = A.locator('.nc-inbox-row', { hasText: 'Restricted member' }).first();
  r.ok(await waitFor(() => ritaReq.count()) === 1, 'owner Inbox: "Access requested for … (Restricted member)"');
  await ritaReq.getByRole('button', { name: 'Approve' }).click();
  const cp = await waitFor(async () => {
    const res = await call(C, 'fetchRecords', { requests: [{ pointer: { table: 'block', id: carlPage } }] });
    const b = rec(res.recordMap, 'block', carlPage);
    return b?.permissions?.some((p) => p.type === 'user_permission' && p.role !== 'none' && p.user_id !== c.userId) ? b : null;
  });
  r.ok(!!cp, 'after Approve the restricted member has access to the page');
} catch (e) {
  console.log('FAIL exception', e);
  process.exitCode = 1;
} finally {
  r.done();
  for (const c of contexts) await c.close().catch(() => {});
  await browser.close();
}

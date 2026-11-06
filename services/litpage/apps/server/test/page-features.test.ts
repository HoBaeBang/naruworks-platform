// Page-level features (W3 page agent): export options (comments, database views, PDF), archive, cross-workspace move,
// Word import, wiki & verification, Sites settings. Handlers are called directly against a temporary SQLite workspace.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-page-test-'));
process.env.NC_SCHEDULER = '0';
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let files: typeof import('../src/content/files.ts');
let newId: () => string;

const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, setCookie: () => {} });
const call = async (user: string | null, name: string, body: any = {}) => H[name](ctx(user), body);

function tx(user: string, operations: any[], spaceId = ids.spaceA) {
  return H.applyChanges(ctx(user), { transactions: [{ id: newId(), spaceId, operations }] });
}

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function put(table: string, rec: any) {
  db.putRecord(table as any, { version: 1, ...rec });
  return rec;
}

function blockRec(id: string, parentId: string, extra: Record<string, unknown> = {}, parentTable = 'block', spaceId = ids.spaceA, user = ids.alice) {
  const now = Date.now();
  return {
    id, type: 'text', properties: { title: [['text of ' + id]] }, parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true,
    created_time: now, created_by_id: user, last_edited_time: now, last_edited_by_id: user, ...extra,
  };
}

function appendChild(parentId: string, childId: string) {
  const p = db.getRecord<any>('block', parentId)!;
  db.putRecord('block', { ...p, content: [...(p.content ?? []), childId] });
}

function readExport(url: string, user: string): string {
  const f = files.readStoredFile(url, user);
  if (!f) throw new Error('export file missing');
  return f.data.toString('utf8');
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  files = await import('../src/content/files.ts');

  for (const n of ['alice', 'bob', 'gina', 'hugo', 'eve']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@page.test`, n[0].toUpperCase() + n.slice(1));
  }
  const a = seed.createWorkspace(ids.alice, 'Acme');
  ids.spaceA = a.space.id;
  ids.teamA = a.team.id;
  ids.alicePrivate = a.spaceView.private_pages[0];
  seed.addMember(ids.spaceA, ids.bob, 'editor');
  const e = seed.createWorkspace(ids.eve, 'Evil');
  ids.spaceE = e.space.id;

  // a team page shared with two guests: gina (full access), hugo (can view)
  ids.page = newId();
  put('block', blockRec(ids.page, ids.teamA, {
    type: 'page', properties: { title: [['Export me']] }, content: [],
    permissions: [
      { type: 'user_permission', role: 'editor', user_id: ids.gina },
      { type: 'user_permission', role: 'reader', user_id: ids.hugo },
    ],
  }, 'team'));
  const team = db.getRecord<any>('team', ids.teamA)!;
  db.putRecord('team', { ...team, team_pages: [...team.team_pages, ids.page] });
  // a commented paragraph + a page discussion
  ids.para = newId();
  put('block', blockRec(ids.para, ids.page, { properties: { title: [['Commented paragraph']] } }));
  appendChild(ids.page, ids.para);
  ids.disc = newId();
  ids.comment = newId();
  put('discussion', { id: ids.disc, parent_id: ids.para, parent_table: 'block', resolved: false, context: [['Commented']], comments: [ids.comment], space_id: ids.spaceA, alive: true });
  put('comment', { id: ids.comment, parent_id: ids.disc, parent_table: 'discussion', text: [['Please double-check this']], created_by_id: ids.bob, created_time: Date.now(), last_edited_time: Date.now(), alive: true, space_id: ids.spaceA });
  db.putRecord('block', { ...db.getRecord<any>('block', ids.para)!, discussions: [ids.disc] });
  ids.pageDisc = newId();
  ids.pageComment = newId();
  put('discussion', { id: ids.pageDisc, parent_id: ids.page, parent_table: 'block', type: 'page', resolved: true, comments: [ids.pageComment], space_id: ids.spaceA, alive: true });
  put('comment', { id: ids.pageComment, parent_id: ids.pageDisc, parent_table: 'discussion', text: [['Page level remark']], created_by_id: ids.alice, created_time: Date.now(), last_edited_time: Date.now(), alive: true, space_id: ids.spaceA });
  db.putRecord('block', { ...db.getRecord<any>('block', ids.page)!, discussions: [ids.pageDisc] });

  // an inline database: rows Alpha (Done), Beta (Todo), Gamma (Done); views: form, filtered table (Done, Status hidden), plain table
  ids.db = newId();
  ids.col = newId();
  ids.formView = newId();
  ids.doneView = newId();
  ids.allView = newId();
  put('block', blockRec(ids.db, ids.page, { type: 'collection_view', collection_id: ids.col, view_ids: [ids.formView, ids.doneView, ids.allView], properties: {} }));
  appendChild(ids.page, ids.db);
  put('collection', {
    id: ids.col, name: [['Tasks']], parent_id: ids.db, parent_table: 'block', alive: true, space_id: ids.spaceA,
    schema: { title: { name: 'Name', type: 'title' }, st: { name: 'Status', type: 'select', options: [{ id: 'd', value: 'Done', color: 'green' }, { id: 't', value: 'Todo', color: 'red' }] }, nt: { name: 'Notes', type: 'text' } },
  });
  put('collection_view', { id: ids.formView, type: 'form', name: 'Form', format: {}, parent_id: ids.db, parent_table: 'block', alive: true, space_id: ids.spaceA });
  put('collection_view', {
    id: ids.doneView, type: 'table', name: 'Done', parent_id: ids.db, parent_table: 'block', alive: true, space_id: ids.spaceA,
    format: { table_properties: [{ property: 'title', visible: true }, { property: 'nt', visible: true }, { property: 'st', visible: false }], property_filters: [{ id: 'f1', filter: { property: 'st', filter: { operator: 'enum_is', value: { type: 'exact', value: 'Done' } } } }] },
    query2: { sort: [{ property: 'title', direction: 'descending' }] },
  });
  put('collection_view', { id: ids.allView, type: 'table', name: 'All', format: { table_properties: [{ property: 'title', visible: true }, { property: 'st', visible: true }] }, parent_id: ids.db, parent_table: 'block', alive: true, space_id: ids.spaceA });
  for (const [name, st, note] of [['Alpha', 'Done', 'a-note'], ['Beta', 'Todo', 'b-note'], ['Gamma', 'Done', 'g-note']]) {
    const id = newId();
    ids[`row${name}`] = id;
    put('block', blockRec(id, ids.col, { type: 'page', properties: { title: [[name]], st: [[st]], nt: [[note]] } }, 'collection'));
  }
  // a sub-page (for PDF include subpages)
  ids.sub = newId();
  put('block', blockRec(ids.sub, ids.page, { type: 'page', properties: { title: [['Child page']] }, content: [] }));
  appendChild(ids.page, ids.sub);
  ids.subText = newId();
  put('block', blockRec(ids.subText, ids.sub, { properties: { title: [['inside child']] } }));
  appendChild(ids.sub, ids.subText);
});

describe('export options (EXP-003/004/006/008/012)', () => {
  it('HTML: Export comments includes block and page threads only when asked', async () => {
    const off = await call(ids.alice, 'startPageExport', { blockId: ids.page, format: 'html' });
    const htmlOff = readExport(off.url, ids.alice);
    expect(htmlOff).toContain('Commented paragraph');
    expect(htmlOff).not.toContain('Please double-check this');
    const on = await call(ids.alice, 'startPageExport', { block: { id: ids.page }, exportOptions: { exportType: 'html', includeComments: true } });
    const html = readExport(on.url, ids.alice);
    expect(html).toContain('Please double-check this');
    expect(html).toContain('class="comment-author">Bob');
    expect(html).toContain('Page level remark');
    expect(html).toContain('Resolved');
    // the thread follows its block
    expect(html.indexOf('Please double-check this')).toBeGreaterThan(html.indexOf('Commented paragraph'));
  });

  it('Markdown never carries comments', async () => {
    const r = await call(ids.alice, 'startPageExport', { blockId: ids.db, format: 'markdown', includeComments: true });
    expect(readExport(r.url, ids.alice)).not.toContain('double-check');
  });

  it('Current view follows the selected view (filter, sort, visible properties); Default view exports everything', async () => {
    const cur = await call(ids.alice, 'startPageExport', { block: { id: ids.db }, exportOptions: { exportType: 'markdown', collectionViewExportType: 'currently_selected', currentViews: { [ids.db]: ids.doneView } } });
    const csv = readExport(cur.url, ids.alice).replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(csv[0]).toBe('Name,Notes');
    expect(csv.slice(1)).toEqual(['Gamma,g-note', 'Alpha,a-note']);
    const def = await call(ids.alice, 'startPageExport', { block: { id: ids.db }, exportOptions: { exportType: 'markdown', collectionViewExportType: 'all', currentViews: { [ids.db]: ids.doneView } } });
    const all = readExport(def.url, ids.alice).replace(/^﻿/, '').trim().split(/\r?\n/);
    expect(all[0].split(',').sort()).toEqual(['Name', 'Notes', 'Status']);
    expect(all.length).toBe(4);
  });

  it('a form view is never the exported view; unknown current views fall back to the first table', async () => {
    const r = await call(ids.alice, 'startPageExport', { blockId: ids.db, format: 'markdown', databaseView: 'current', currentViews: { [ids.db]: ids.formView } });
    const csv = readExport(r.url, ids.alice).replace(/^﻿/, '').trim().split(/\r?\n/);
    // first non-form view = the "Done" table
    expect(csv[0]).toBe('Name,Notes');
    expect(csv.length).toBe(3);
  });

  it('HTML export renders inline databases as a table of the exported view', async () => {
    const r = await call(ids.alice, 'startPageExport', { blockId: ids.page, format: 'html', databaseView: 'current', currentViews: { [ids.db]: ids.allView } });
    const html = readExport(r.url, ids.alice);
    expect(html).toContain('<h4 class="collection-title">Tasks</h4>');
    expect(html).toContain('<td>Beta</td>');
  });

  it('PDF: paper size and scale; subpages only on Business+', async () => {
    const r = await call(ids.alice, 'startPageExport', { block: { id: ids.page }, recursive: true, exportOptions: { exportType: 'pdf', pdfFormat: 'Letter', pdfScale: 80 } });
    expect(r.printUrl).toBeTruthy();
    const doc = readExport(r.printUrl, ids.alice);
    expect(doc).toContain('size:letter');
    expect(doc).toContain('zoom:0.8');
    expect(doc).toContain('window.print()');
    expect(doc).not.toContain('inside child'); // Plus plan: no subpages
    db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, plan_type: 'business' });
    const r2 = await call(ids.alice, 'startPageExport', { block: { id: ids.page }, recursive: true, exportOptions: { exportType: 'pdf', pdfFormat: 'Tabloid' } });
    const doc2 = readExport(r2.printUrl, ids.alice);
    expect(doc2).toContain('size:11in 17in');
    expect(doc2).toContain('inside child');
    expect(doc2).toContain('page-break');
    // the page, its child page and the two rows of the database's exported view
    expect(r2.pages).toBe(4);
    db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, plan_type: 'plus' });
  });

  it('workspace export as PDF (Business+, SET-WS-004.1): one print document, top-level pages and subpages on new sheets', async () => {
    expect(await status(() => call(ids.alice, 'exportWorkspace', { spaceId: ids.spaceA, format: 'pdf' }))).toBe(403); // Plus
    db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, plan_type: 'business' });
    try {
      const r = await call(ids.alice, 'exportWorkspace', { spaceId: ids.spaceA, format: 'pdf', pageFormat: 'Legal' });
      expect(r.printUrl).toBeTruthy();
      expect(r.filename).toMatch(/^Export-Acme-\d{4}-\d{2}-\d{2}\.pdf$/);
      const doc = readExport(r.printUrl, ids.alice);
      expect(doc).toContain('<title>Acme</title>');
      expect(doc).toContain('size:legal');
      expect(doc).toContain('inside child'); // the team page's subpage
      expect(doc).toContain('page-break');
      expect(r.pages).toBeGreaterThan(2);
      // a guest isn't a workspace member
      expect(await status(() => call(ids.gina, 'exportWorkspace', { spaceId: ids.spaceA, format: 'pdf' }))).toBe(403);
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, plan_type: 'plus' });
    }
  });

  it('PDF of a database prints its table instead of CSV text', async () => {
    const r = await call(ids.alice, 'startPageExport', { blockId: ids.db, format: 'pdf', databaseView: 'default' });
    const doc = readExport(r.printUrl, ids.alice);
    expect(doc).toContain('<table class="collection-content">');
    expect(doc).toContain('Gamma');
  });

  it('export permissions: workspace Disable export, guests need full access, strangers see nothing', async () => {
    expect(await status(() => call(ids.eve, 'startPageExport', { blockId: ids.page, format: 'markdown' }))).toBe(404);
    expect(await status(() => call(ids.hugo, 'startPageExport', { blockId: ids.page, format: 'markdown' }))).toBe(403);
    const space = db.getRecord<any>('space', ids.spaceA)!;
    db.putRecord('space', { ...space, disable_export: true });
    try {
      expect(await status(() => call(ids.bob, 'startPageExport', { blockId: ids.page, format: 'markdown' }))).toBe(403);
      expect(await status(() => call(ids.alice, 'startPageExport', { blockId: ids.page, format: 'markdown' }))).toBe(200);
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, disable_export: false });
    }
    expect(await status(() => call(ids.bob, 'startPageExport', { blockId: ids.page, format: 'markdown' }))).toBe(200);
  });
});

describe('archive', () => {
  it('archived pages and their subpages leave search unless Content status asks for them', async () => {
    const archived = newId();
    const child = newId();
    put('block', blockRec(archived, ids.teamA, { type: 'page', properties: { title: [['Zebra handbook']] }, content: [child] }, 'team'));
    put('block', blockRec(child, archived, { type: 'page', properties: { title: [['Zebra appendix']] }, content: [] }));
    const team = db.getRecord<any>('team', ids.teamA)!;
    db.putRecord('team', { ...team, team_pages: [...team.team_pages, archived] });
    const { indexBlock } = await import('../src/search.ts');
    indexBlock(db.getRecord<any>('block', archived)!);
    indexBlock(db.getRecord<any>('block', child)!);
    const search = async (contentStatus?: string) => (await call(ids.bob, 'searchWorkspace', { query: 'Zebra', spaceId: ids.spaceA, filters: contentStatus ? { contentStatus } : {} })).results.map((r: any) => r.id).sort();
    expect(await search()).toEqual([archived, child].sort());
    // archive through a normal block transaction (anyone who can edit)
    await tx(ids.bob, [{ pointer: { table: 'block', id: archived, spaceId: ids.spaceA }, path: [], command: 'update', args: { archived_time: Date.now(), archived_by: ids.bob } }]);
    expect(await search()).toEqual([]);
    expect(await search('all')).toEqual([]);
    expect(await search('all_with_archived')).toEqual([archived, child].sort());
    expect(await search('archived_only')).toEqual([archived, child].sort());
    const res = await call(ids.bob, 'searchWorkspace', { query: 'Zebra', spaceId: ids.spaceA, filters: { contentStatus: 'archived_only' } });
    expect(res.results.every((r: any) => r.archived)).toBe(true);
    // a reader can't archive
    expect(await status(() => tx(ids.hugo, [{ pointer: { table: 'block', id: ids.page, spaceId: ids.spaceA }, path: [], command: 'update', args: { archived_time: Date.now(), archived_by: ids.hugo } }]))).toBe(403);
    // unarchive brings them back
    await tx(ids.bob, [{ pointer: { table: 'block', id: archived, spaceId: ids.spaceA }, path: [], command: 'update', args: { archived_time: null, archived_by: null } }]);
    expect(await search()).toEqual([archived, child].sort());
  });

  it('archived database rows are left out of exports', async () => {
    await tx(ids.alice, [{ pointer: { table: 'block', id: ids.rowGamma, spaceId: ids.spaceA }, path: [], command: 'update', args: { archived_time: Date.now(), archived_by: ids.alice } }]);
    const r = await call(ids.alice, 'startPageExport', { blockId: ids.db, format: 'markdown', databaseView: 'default' });
    expect(readExport(r.url, ids.alice)).not.toContain('Gamma');
    await tx(ids.alice, [{ pointer: { table: 'block', id: ids.rowGamma, spaceId: ids.spaceA }, path: [], command: 'update', args: { archived_time: null, archived_by: null } }]);
  });
});

describe('page verification and wikis', () => {
  it('verifying a plain page needs Business; owners only; expiry notifies the owners', async () => {
    const page = newId();
    put('block', blockRec(page, ids.teamA, { type: 'page', properties: { title: [['Onboarding guide']] }, content: [] }, 'team'));
    (await import('../src/search.ts')).indexBlock(db.getRecord<any>('block', page)!);
    expect(await status(() => call(ids.bob, 'setPageVerification', { pageId: page, verified: true, expiry: null }))).toBe(403); // Plus plan
    db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, plan_type: 'business' });
    try {
      expect(await status(() => call(ids.hugo, 'setPageVerification', { pageId: page, verified: true }))).toBe(404); // no access
      const soon = Date.now() + 60_000;
      await call(ids.bob, 'setPageVerification', { pageId: page, verified: true, expiry: soon });
      let b = db.getRecord<any>('block', page)!;
      expect(b.format.page_verification.state).toBe('verified');
      expect(b.format.page_verification.owners).toEqual([ids.bob]);
      expect(b.format.page_verification.expiry_time).toBe(soon);
      // search: verified_only + badge
      const found = await call(ids.bob, 'searchWorkspace', { query: 'Onboarding', spaceId: ids.spaceA, filters: { contentStatus: 'verified_only' } });
      expect(found.results.map((r: any) => r.id)).toEqual([page]);
      expect(found.results[0].verification).toBe('verified');
      // only owners re-verify (alice is a workspace owner → allowed; a plain member who isn't an owner is not)
      seed.addMember(ids.spaceA, ids.gina, 'editor');
      expect(await status(() => call(ids.gina, 'setPageVerification', { pageId: page, verified: true, expiry: null }))).toBe(403);
      // owners: at least one while verified
      expect(await status(() => call(ids.bob, 'setPageOwners', { pageId: page, owners: [] }))).toBe(400);
      await call(ids.bob, 'setPageOwners', { pageId: page, owners: [ids.bob, ids.gina] });
      expect(db.getRecord<any>('block', page)!.format.page_verification.owners).toEqual([ids.bob, ids.gina]);
      // Settings › Verified pages
      const listed = await call(ids.alice, 'getVerifiedPages', { spaceId: ids.spaceA });
      expect(listed.pages.map((p: any) => p.pageId)).toContain(page);
      // expiry: the scheduler job notifies both owners
      const sched = await import('../src/scheduler.ts');
      expect(sched.getJob(`verification:${page}`)?.runAt).toBe(soon);
      b = db.getRecord<any>('block', page)!;
      db.putRecord('block', { ...b, format: { ...b.format, page_verification: { ...b.format.page_verification, expiry_time: Date.now() - 1 } } });
      sched.scheduleJob('verification_expiry', `verification:${page}`, Date.now() - 1, { pageId: page, expiry: db.getRecord<any>('block', page)!.format.page_verification.expiry_time });
      await sched.runDueJobs(Date.now());
      const notes = db.recordsInSpace<any>('notification', ids.spaceA).filter((n) => n.type === 'verification_expired' && n.navigable_block_id === page);
      expect(notes.map((n) => n.user_id).sort()).toEqual([ids.bob, ids.gina].sort());
      // remove verification
      await call(ids.bob, 'setPageVerification', { pageId: page, verified: false });
      expect(db.getRecord<any>('block', page)!.format.page_verification).toBeNull();
      // archived pages can't be verified
      await tx(ids.bob, [{ pointer: { table: 'block', id: page, spaceId: ids.spaceA }, path: [], command: 'update', args: { archived_time: Date.now(), archived_by: ids.bob } }]);
      expect(await status(() => call(ids.bob, 'setPageVerification', { pageId: page, verified: true }))).toBe(400);
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, plan_type: 'plus' });
    }
  });

  it('Turn into wiki → rows with owners, Home/All pages/Pages I own, verification on every plan, Undo wiki', async () => {
    const wiki = newId();
    const sub = newId();
    const text = newId();
    put('block', blockRec(wiki, ids.teamA, { type: 'page', properties: { title: [['Team wiki']] }, content: [text, sub], permissions: [{ type: 'user_permission', role: 'read_and_write', user_id: ids.eve }] }, 'team'));
    put('block', blockRec(text, wiki, { properties: { title: [['Welcome text']] } }));
    put('block', blockRec(sub, wiki, { type: 'page', properties: { title: [['Policies']] }, content: [], created_by_id: ids.bob }));
    // full access only
    expect(await status(() => call(ids.hugo, 'turnIntoWiki', { pageId: wiki }))).toBe(404);
    const r = await call(ids.alice, 'turnIntoWiki', { pageId: wiki });
    const w = db.getRecord<any>('block', wiki)!;
    expect(w.type).toBe('collection_view_page');
    expect(w.content).toEqual([text, sub]);
    const col = db.getRecord<any>('collection', r.collectionId)!;
    expect(col.format.is_wiki).toBe(true);
    expect(Object.values(col.schema).map((p: any) => p.type).sort()).toEqual(['last_edited_time', 'multi_select', 'person', 'title', 'verification']);
    const views = w.view_ids.map((id: string) => db.getRecord<any>('collection_view', id)!);
    expect(views.map((v: any) => [v.type, v.name])).toEqual([['page', 'Home'], ['table', 'All pages'], ['table', 'Pages I manage']]);
    const row = db.getRecord<any>('block', sub)!;
    expect(row.parent_table).toBe('collection');
    expect(JSON.stringify(row.properties.verification_owner)).toContain(ids.bob);
    // wiki pages verify on the Plus plan; only the owner (bob) — alice is a workspace admin and may too
    expect(await status(() => call(ids.gina, 'setPageVerification', { pageId: sub, verified: true }))).toBe(403);
    await call(ids.bob, 'setPageVerification', { pageId: sub, verified: true, expiry: null });
    expect(JSON.stringify(db.getRecord<any>('block', sub)!.properties.verification)).toContain('"state":"verified"');
    // a page created in the wiki's Home becomes a wiki page owned by its creator
    const fresh = newId();
    await tx(ids.bob, [
      { pointer: { table: 'block', id: fresh, spaceId: ids.spaceA }, path: [], command: 'set', args: blockRec(fresh, wiki, { type: 'page', properties: { title: [['New wiki page']] }, content: [] }, 'block', ids.spaceA, ids.bob) },
      { pointer: { table: 'block', id: wiki, spaceId: ids.spaceA }, path: ['content'], command: 'listAfter', args: { id: fresh } },
    ]);
    await new Promise((res) => setTimeout(res, 20));
    expect(db.getRecord<any>('block', fresh)!.parent_table).toBe('collection');
    // Undo wiki
    expect(await status(() => call(ids.eve, 'undoWiki', { pageId: wiki }))).toBe(403); // eve: can edit, not full access
    await call(ids.alice, 'undoWiki', { pageId: wiki });
    const back = db.getRecord<any>('block', wiki)!;
    expect(back.type).toBe('page');
    expect(back.content).toEqual([text, sub, fresh]);
    expect(db.getRecord<any>('block', sub)!.parent_table).toBe('block');
    expect(db.getRecord<any>('block', sub)!.properties.verification).toBeUndefined();
    expect(db.getRecord<any>('collection', r.collectionId)!.alive).toBe(false);
  });
});

// ---------------------------------------------------------------- import fixtures (built in memory)
const PNG_1PX = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4b30000000049454e44ae426082', 'hex');

async function makeDocx(): Promise<Buffer> {
  const { writeZip } = await import('../src/content/zip.ts');
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
  const p = (style: string, runs: string, num?: [number, number]) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${num ? `<w:numPr><w:ilvl w:val="${num[1]}"/><w:numId w:val="${num[0]}"/></w:numPr>` : ''}</w:pPr>${runs}</w:p>`;
  const r = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>
    ${p('Title', r('Product Spec'))}
    ${p('Heading1', r('Overview'))}
    ${p('', r('Plain ') + r('bold', '<w:b/>') + r(' and ') + `<w:hyperlink r:id="rIdLink">${r('a link')}</w:hyperlink>` + r(' &amp; more.'))}
    ${p('Heading2', r('Goals'))}
    ${p('ListParagraph', r('First bullet'), [1, 0])}
    ${p('ListParagraph', r('Nested bullet'), [1, 1])}
    ${p('ListParagraph', r('Step one'), [2, 0])}
    ${p('ListParagraph', r('Step two'), [2, 0])}
    ${p('Quote', r('Quoted words'))}
    <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p>${r('Name')}</w:p></w:tc><w:tc><w:p>${r('Role')}</w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p>${r('Ada')}</w:p></w:tc><w:tc><w:p>${r('Engineer')}</w:p></w:tc></w:tr></w:tbl>
    <w:p><w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="rIdImg"/></a:graphicData></a:graphic></w:drawing></w:r></w:p>
    ${p('', '<w:del><w:r><w:delText>deleted text</w:delText></w:r></w:del>')}
    <w:sectPr/></w:body></w:document>`;
  const styles = `<?xml version="1.0"?><w:styles ${W}><w:style w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style><w:style w:styleId="Quote"><w:name w:val="Quote"/></w:style></w:styles>`;
  const numbering = `<?xml version="1.0"?><w:numbering ${W}><w:abstractNum w:abstractNumId="10"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="20"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="10"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="20"/></w:num></w:numbering>`;
  const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/spec" TargetMode="External"/><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>`;
  return writeZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering },
    { name: 'word/_rels/document.xml.rels', data: rels }, { name: 'word/media/image1.png', data: PNG_1PX },
  ]);
}

function makePdf(): Buffer {
  const { deflateSync } = require('node:zlib') as typeof import('node:zlib');
  const content = [
    'BT /F1 24 Tf 72 720 Td (Quarterly Report) Tj ET',
    'BT /F1 12 Tf 72 690 Td (First paragraph line one) Tj 0 -14 Td (continues here.) Tj ET',
    'BT /F1 12 Tf 72 640 Td (\\225 Bullet item) Tj ET',
    'BT /F2 12 Tf 72 610 Td <00010002> Tj ET',
    'BT /F1 12 Tf 72 580 Td [(Kern)-50(ed) -400 (words)] TJ ET',
  ].join('\n');
  const stream = deflateSync(Buffer.from(content, 'latin1'));
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange 2 beginbfchar <0001> <C548> <0002> <B155> endbfchar endcmap CMapName currentdict /CMap defineresource pop end end';
  const parts: (string | Buffer)[] = ['%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'];
  parts.push('1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n');
  parts.push('2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n');
  parts.push('3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >> endobj\n');
  parts.push('4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >> endobj\n');
  parts.push('5 0 obj << /Type /Font /Subtype /Type0 /BaseFont /Malgun /Encoding /Identity-H /ToUnicode 7 0 R >> endobj\n');
  parts.push(`6 0 obj << /Length ${stream.length} /Filter /FlateDecode >> stream\n`, stream, '\nendstream endobj\n');
  parts.push(`7 0 obj << /Length ${cmap.length} >> stream\n${cmap}\nendstream endobj\n`);
  parts.push('trailer << /Root 1 0 R >>\n%%EOF\n');
  return Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : p)));
}

async function makeXlsx(): Promise<Buffer> {
  const { writeZip } = await import('../src/content/zip.ts');
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>
    <row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>12.5</v></c><c r="C2" s="1"><v>46315</v></c></row>
    <row r="3"><c r="A3" t="inlineStr"><is><t>Widget B</t></is></c><c r="B3"><v>7</v></c><c r="C3" s="1"><v>46316</v></c></row>
  </sheetData></worksheet>`;
  return writeZip([
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventory" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
    { name: 'xl/sharedStrings.xml', data: '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Item</t></si><si><t>Price</t></si><si><t>Shipped</t></si><si><t>Widget A</t></si></sst>' },
    { name: 'xl/styles.xml', data: '<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>' },
    { name: 'xl/worksheets/sheet1.xml', data: sheet },
  ]);
}

describe('import: Word, PDF, Excel, Merge with CSV (IMP-005/006/007/010/011)', () => {
  const upload = (name: string, data: Buffer | string) => files.storeFile(name, data, ids.alice, ids.spaceA).url;
  const blocksOf = (pageId: string) => (db.getRecord<any>('block', pageId)!.content ?? []).map((id: string) => db.getRecord<any>('block', id)!);
  const textOf = (b: any) => (b.properties?.title ?? []).map((d: any) => d[0]).join('');

  it('Word (.docx): title, headings, rich text + links, nested lists, quote, table, image; tracked deletions dropped', async () => {
    const res = await call(ids.alice, 'importFiles', { spaceId: ids.spaceA, parent: { kind: 'page', pageId: ids.page }, files: [{ name: 'spec.docx', url: upload('spec.docx', await makeDocx()) }] });
    const pageId = res.pageIds[0];
    const page = db.getRecord<any>('block', pageId)!;
    expect(textOf(page)).toBe('Product Spec');
    const kids = blocksOf(pageId);
    expect(kids.map((b: any) => b.type)).toEqual(['header', 'text', 'sub_header', 'bulleted_list', 'numbered_list', 'numbered_list', 'quote', 'table', 'image']);
    const para = kids[1];
    expect(textOf(para)).toBe('Plain bold and a link & more.');
    expect(JSON.stringify(para.properties.title)).toContain('["b"]');
    expect(JSON.stringify(para.properties.title)).toContain('https://example.com/spec');
    const nested = blocksOf(kids[3].id);
    expect(textOf(nested[0])).toBe('Nested bullet');
    expect(kids[7].format.table_block_column_header).toBe(true);
    const rows = blocksOf(kids[7].id);
    expect(rows.length).toBe(2);
    expect(kids[8].properties.source[0][0]).toMatch(/^\/files\//);
    expect(JSON.stringify(kids)).not.toContain('deleted text');
  });

  it('PDF: text layer → title, paragraphs (joined lines), bullets, ToUnicode text, kerning gaps', async () => {
    const res = await call(ids.alice, 'importFiles', { spaceId: ids.spaceA, parent: { kind: 'private' }, files: [{ name: 'report.pdf', url: upload('report.pdf', makePdf()) }] });
    const pageId = res.pageIds[0];
    expect(textOf(db.getRecord<any>('block', pageId)!)).toBe('Quarterly Report');
    const kids = blocksOf(pageId);
    expect(kids.map((b: any) => [b.type, textOf(b)])).toEqual([
      ['text', 'First paragraph line one continues here.'],
      ['bulleted_list', 'Bullet item'],
      ['text', '안녕'],
      ['text', 'Kerned words'],
    ]);
    // not a PDF / scanned
    expect(await status(() => call(ids.alice, 'importFiles', { spaceId: ids.spaceA, parent: { kind: 'private' }, files: [{ name: 'fake.pdf', url: upload('fake.pdf', 'hello') }] }))).toBe(400);
  });

  it('Excel (.xlsx) → database with typed columns (dates from date-formatted cells)', async () => {
    const res = await call(ids.alice, 'importFiles', { spaceId: ids.spaceA, parent: { kind: 'private' }, files: [{ name: 'Inventory.xlsx', url: upload('Inventory.xlsx', await makeXlsx()) }] });
    const dbBlock = db.getRecord<any>('block', res.pageIds[0])!;
    expect(dbBlock.type).toBe('collection_view_page');
    const col = db.getRecord<any>('collection', dbBlock.collection_id)!;
    const types = Object.values(col.schema).map((p: any) => `${p.name}:${p.type}`).sort();
    expect(types).toEqual(['Item:title', 'Price:number', 'Shipped:date']);
    expect(res.databases).toBe(1);
  });

  it('CSV column mapping: preview + type overrides / skip', async () => {
    const csv = 'Name,Count,Tags,Secret\nA,1,"x, y",s1\nB,2,z,s2\n';
    const url = upload('people.csv', csv);
    const prev = await call(ids.alice, 'previewCsv', { spaceId: ids.spaceA, url, name: 'people.csv' });
    expect(prev.columns.map((c: any) => c.type)).toEqual(['title', 'number', 'multi_select', 'select']);
    const res = await call(ids.alice, 'importFiles', { spaceId: ids.spaceA, parent: { kind: 'private' }, files: [{ name: 'people.csv', url }], csvTypes: { 1: 'text', 2: 'multi_select', 3: 'skip' } });
    const col = db.getRecord<any>('collection', db.getRecord<any>('block', res.pageIds[0])!.collection_id)!;
    expect(Object.values(col.schema).map((p: any) => `${p.name}:${p.type}`).sort()).toEqual(['Count:text', 'Name:title', 'Tags:multi_select']);
  });

  it('Merge with CSV appends rows to an existing database (match by name, new options, new columns)', async () => {
    const before = db.childrenOf<any>('block', ids.col).filter((r) => r.parent_table === 'collection' && r.alive).length;
    const csv = 'Name,Status,Notes,Owner email\nDelta,Done,d-note,x@y.z\nEpsilon,Blocked,e-note,\n';
    const url = upload('more.csv', csv);
    const prev = await call(ids.alice, 'previewCsv', { spaceId: ids.spaceA, url, name: 'more.csv', blockId: ids.db });
    expect(prev.target.properties.map((p: any) => p.name).sort()).toEqual(['Name', 'Notes', 'Status']);
    // readers can't merge
    expect(await status(() => call(ids.hugo, 'mergeCsv', { blockId: ids.db, url, name: 'more.csv' }))).toBe(403);
    const res = await call(ids.alice, 'mergeCsv', { blockId: ids.db, url, name: 'more.csv' });
    expect(res.added).toBe(2);
    expect(res.newProperties).toEqual(['Owner email']);
    const rows = db.childrenOf<any>('block', ids.col).filter((r) => r.parent_table === 'collection' && r.alive);
    expect(rows.length).toBe(before + 2);
    const col = db.getRecord<any>('collection', ids.col)!;
    expect(col.schema.st.options.map((o: any) => o.value)).toEqual(['Done', 'Todo', 'Blocked']);
    const delta = rows.find((r: any) => textOf(r) === 'Delta');
    expect(delta.properties.st).toEqual([['Done']]);
    expect(delta.properties.nt).toEqual([['d-note']]);
  });
});

describe('move to another workspace = duplicate (PG-031.1–.4)', () => {
  it('copies a page tree (content + database) into a workspace the user belongs to; policy and access enforced', async () => {
    // alice also joins Evil (eve's workspace)
    seed.addMember(ids.spaceE, ids.alice, 'editor');
    const res = await call(ids.alice, 'duplicateToSpace', { blockIds: [ids.page], spaceId: ids.spaceE, parent: { kind: 'private' } });
    const copy = db.getRecord<any>('block', res.blockIds[0])!;
    expect(copy.space_id).toBe(ids.spaceE);
    expect(copy.copied_from).toBe(ids.page);
    expect(copy.discussions).toBeUndefined();
    const kids = (copy.content ?? []).map((id: string) => db.getRecord<any>('block', id)!);
    expect(kids.every((k: any) => k.space_id === ids.spaceE)).toBe(true);
    const dbCopy = kids.find((k: any) => k.type === 'collection_view');
    expect(dbCopy.collection_id).not.toBe(ids.col);
    const rows = db.childrenOf<any>('block', dbCopy.collection_id).filter((r) => r.parent_table === 'collection');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(rows.every((r: any) => r.space_id === ids.spaceE)).toBe(true);
    // the original stays
    expect(db.getRecord<any>('block', ids.page)!.alive).toBe(true);
    // the copy sits at the top of alice's private pages in Evil
    const root = db.getRecord<any>('user_root', ids.alice)!;
    const sv = root.space_views.map((id: string) => db.getRecord<any>('space_view', id)).find((v: any) => v.space_id === ids.spaceE);
    expect(sv.private_pages[0]).toBe(copy.id);
    // not a member of the destination
    expect(await status(() => call(ids.bob, 'duplicateToSpace', { blockIds: [ids.page], spaceId: ids.spaceE }))).toBe(403);
    // guests without full access
    expect(await status(() => call(ids.hugo, 'duplicateToSpace', { blockIds: [ids.page], spaceId: ids.spaceE }))).toBe(403);
    // Settings › Security › Disable duplicating pages to other workspaces (source workspace)
    const a = db.getRecord<any>('space', ids.spaceA)!;
    db.putRecord('space', { ...a, settings: { ...(a.settings ?? {}), disable_move_to_space: true } });
    try {
      const st = await status(() => call(ids.alice, 'duplicateToSpace', { blockIds: [ids.page], spaceId: ids.spaceE }));
      expect(st).toBe(403);
    } finally {
      const a2 = db.getRecord<any>('space', ids.spaceA)!;
      db.putRecord('space', { ...a2, settings: { ...(a2.settings ?? {}), disable_move_to_space: false } });
    }
    // move targets of the other workspace
    const targets = await call(ids.alice, 'getMoveTargets', { spaceId: ids.spaceE });
    expect(Array.isArray(targets.teamIds)).toBe(true);
  });
});

describe('Sites settings and public site (PUB-003/004/005/007/010)', () => {
  it('slug, theme, SEO, favicon, header links, GA; full access only; anonymous resolve + site search', async () => {
    const site = newId();
    const sub = newId();
    const other = newId();
    put('block', blockRec(site, ids.teamA, { type: 'page', properties: { title: [['Team handbook']] }, content: [sub], permissions: [{ type: 'public_permission', role: 'reader', published: true, published_time: Date.now() }] }, 'team'));
    put('block', blockRec(sub, site, { type: 'page', properties: { title: [['Vacation policy']] }, content: [] }));
    put('block', blockRec(other, ids.teamA, { type: 'page', properties: { title: [['Vacation secrets']] }, content: [] }, 'team'));
    const { indexBlock } = await import('../src/search.ts');
    for (const id of [site, sub, other]) indexBlock(db.getRecord<any>('block', id)!);
    // only full access (hugo can read the published page)
    expect(await status(() => call(ids.hugo, 'setSiteSettings', { pageId: site, settings: { theme: 'dark' } }))).toBe(403);
    expect(await status(() => call(ids.bob, 'setSiteSettings', { pageId: sub, settings: { theme: 'dark' } }))).toBe(400); // not the site root
    const r = await call(ids.alice, 'setSiteSettings', { pageId: site, settings: { slug: 'Team-Handbook', theme: 'dark', title: 'Acme handbook', description: 'How we work', favicon: '📘', header: { search: true, links: [{ pageId: sub }] }, ga: 'G-ABC123' } });
    expect(r.settings.slug).toBe('team-handbook');
    expect(r.settings.header.links).toEqual([{ pageId: sub }]);
    // invalid input
    expect(await status(() => call(ids.alice, 'setSiteSettings', { pageId: site, settings: { ga: 'G-<script>' } }))).toBe(400);
    expect(await status(() => call(ids.alice, 'setSiteSettings', { pageId: site, settings: { header: { links: [{ pageId: other }] } } }))).toBe(400);
    expect(await status(() => call(ids.alice, 'setSiteSettings', { pageId: site, settings: { slug: 'api' } }))).toBe(400);
    expect(await status(() => call(ids.alice, 'setSiteSettings', { pageId: site, settings: { image: 'javascript:alert(1)' } }))).toBe(400);
    // slug availability
    expect((await call(ids.bob, 'checkSiteSlug', { pageId: other, slug: 'team-handbook' })).available).toBe(false);
    // anonymous visitors resolve the slug and see the settings
    const pub = await call(null, 'getSite', { slugOrId: 'team-handbook' });
    expect(pub.pageId).toBe(site);
    expect(pub.settings.theme).toBe('dark');
    expect(pub.settings.title).toBe('Acme handbook');
    expect((await call(null, 'getSite', { slugOrId: sub.replace(/-/g, '') })).rootId).toBe(site);
    expect(await status(() => call(null, 'getSite', { slugOrId: other }))).toBe(404);
    // site search: only pages of the site
    const found = await call(null, 'searchSite', { pageId: site, query: 'Vacation' });
    expect(found.results.map((x: any) => x.id)).toEqual([sub]);
    // publishing disabled by the workspace → settings can't change
    const a = db.getRecord<any>('space', ids.spaceA)!;
    db.putRecord('space', { ...a, disable_public_access: true });
    try {
      expect(await status(() => call(ids.alice, 'setSiteSettings', { pageId: site, settings: { theme: 'light' } }))).toBe(403);
    } finally {
      db.putRecord('space', { ...db.getRecord<any>('space', ids.spaceA)!, disable_public_access: false });
    }
  });
});

describe('template gallery numbers: adds, reviews, Purchased', () => {
  it('counts adds, lets people who added a template review it once, lists what they added', async () => {
    const before = (await call(ids.bob, 'listTemplates')).templates.find((x: any) => x.id === 'meeting-notes');
    expect(before.added).toBe(false);
    const adds0 = before.adds;
    // bob has not added it → can't review
    expect(await status(() => call(ids.bob, 'reviewTemplate', { templateId: 'meeting-notes', rating: 5 }))).toBe(403);
    const { pageId } = await call(ids.bob, 'getTemplate', { templateId: 'meeting-notes', spaceId: ids.spaceA });
    const after = (await call(ids.bob, 'listTemplates')).templates.find((x: any) => x.id === 'meeting-notes');
    expect(after.adds).toBe(adds0 + 1);
    expect(after.added).toBe(true);
    expect((await call(ids.alice, 'listTemplates')).templates.find((x: any) => x.id === 'meeting-notes').added).toBe(false);
    // rating is required, limits enforced
    expect(await status(() => call(ids.bob, 'reviewTemplate', { templateId: 'meeting-notes', rating: 0 }))).toBe(400);
    expect(await status(() => call(ids.bob, 'reviewTemplate', { templateId: 'meeting-notes', rating: 4, title: 'x'.repeat(101) }))).toBe(400);
    expect(await status(() => call(ids.bob, 'reviewTemplate', { templateId: 'no-such-template', rating: 4 }))).toBe(404);
    expect((await call(ids.bob, 'getTemplateReviews', { templateId: 'meeting-notes' })).canReview).toBe(true);
    await call(ids.bob, 'reviewTemplate', { templateId: 'meeting-notes', rating: 4, title: 'Handy', text: 'Our standups live here now.' });
    expect(await status(() => call(ids.bob, 'reviewTemplate', { templateId: 'meeting-notes', rating: 1 }))).toBe(409);
    const rv = await call(ids.alice, 'getTemplateReviews', { templateId: 'meeting-notes' });
    expect(rv.histogram).toEqual([0, 0, 0, 1, 0]);
    expect(rv.reviews[0]).toMatchObject({ rating: 4, title: 'Handy', name: 'Bob', text: 'Our standups live here now.' });
    expect(rv.mine).toBe(null);
    expect(rv.canReview).toBe(false);
    const mine = await call(ids.bob, 'getTemplateReviews', { templateId: 'meeting-notes' });
    expect(mine.mine.rating).toBe(4);
    expect(mine.canReview).toBe(false);
    const listed = (await call(ids.alice, 'listTemplates')).templates.find((x: any) => x.id === 'meeting-notes');
    expect(listed.rating).toBe(4);
    expect(listed.reviews).toBe(1);
    expect(typeof listed.updatedTime).toBe('number');
    // Purchased: bob's added templates with where the copy went and his rating
    const added = await call(ids.bob, 'getAddedTemplates');
    expect(added.added.map((x: any) => x.templateId)).toEqual(['meeting-notes']);
    expect(added.added[0]).toMatchObject({ pageId, myRating: 4, times: 1, spaceId: ids.spaceA });
    expect((await call(ids.alice, 'getAddedTemplates')).added).toEqual([]);
    // the copy was trashed → no link back
    await tx(ids.bob, [{ pointer: { table: 'block', id: pageId, spaceId: ids.spaceA }, path: ['alive'], command: 'set', args: false }]);
    expect((await call(ids.bob, 'getAddedTemplates')).added[0].pageId).toBe(null);
  });

  it('new database › More templates: an empty inline database takes the template’s data source', async () => {
    const host = newId();
    const dbId = newId();
    const col = newId();
    const view = newId();
    put('block', blockRec(host, ids.alicePrivate, { type: 'page', properties: { title: [['Planning']] }, content: [dbId] }));
    put('block', blockRec(dbId, host, { type: 'collection_view', collection_id: col, view_ids: [view], format: { collection_pointer: { id: col, table: 'collection', spaceId: ids.spaceA } } }));
    db.putRecord('block', { ...db.getRecord<any>('block', dbId)!, properties: undefined });
    put('collection', { id: col, name: [['Q4 projects']], parent_id: dbId, parent_table: 'block', alive: true, space_id: ids.spaceA, schema: { title: { name: 'Name', type: 'title' } } });
    put('collection_view', { id: view, type: 'table', name: 'Table', format: {}, parent_id: dbId, parent_table: 'block', alive: true, space_id: ids.spaceA });
    expect(await status(() => call(ids.eve, 'applyTemplateToDatabase', { templateId: 'project-tracker', blockId: dbId }))).toBe(403);
    expect(await status(() => call(ids.alice, 'applyTemplateToDatabase', { templateId: 'project-tracker', blockId: host }))).toBe(404);
    const r = await call(ids.alice, 'applyTemplateToDatabase', { templateId: 'project-tracker', blockId: dbId });
    const b = db.getRecord<any>('block', dbId)!;
    expect(b.type).toBe('collection_view');
    expect(b.parent_id).toBe(host);
    expect(b.collection_id).toBe(r.collectionId);
    expect(b.format.collection_pointer.id).toBe(r.collectionId);
    expect(b.view_ids.length).toBeGreaterThan(1);
    const c = db.getRecord<any>('collection', r.collectionId)!;
    expect(c.name).toEqual([['Q4 projects']]); // the typed name stays
    expect(Object.values(c.schema).map((p: any) => p.name)).toContain('Status');
    expect(db.childrenOf<any>('block', r.collectionId).filter((x) => x.alive && x.parent_table === 'collection').length).toBeGreaterThan(1);
    expect(db.getRecord<any>('collection', col)!.alive).toBe(false);
    expect(db.getRecord<any>('collection_view', view)!.alive).toBe(false);
    expect(db.getRecord<any>('block', host)!.content).toEqual([dbId]);
    // now it has rows → no second template
    expect(await status(() => call(ids.alice, 'applyTemplateToDatabase', { templateId: 'reading-list', blockId: dbId }))).toBe(400);
  });
});

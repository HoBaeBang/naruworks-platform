// Helpers for the e2e scripts (fix-*.mjs): build pages / blocks / databases through client transactions from
// inside the signed-in page, so each script sets up exactly the content it checks. Run against private servers:
// NC_BASE=http://127.0.0.1:5531 node e2e/fix-<name>.mjs
import { call } from './ws-lib.mjs';

/** Run one transaction (operations use `{ pointer: { table, id }, path, command, args }`; spaceId is filled in). */
export async function tx(page, spaceId, operations) {
  const ops = operations.map((o) => ({ ...o, pointer: { ...o.pointer, spaceId } }));
  return call(page, 'applyChanges', { transactions: [{ id: cryptoId(), spaceId, operations: ops }] });
}

export function cryptoId() {
  return globalThis.crypto.randomUUID();
}

async function me(page) {
  const uc = await call(page, 'loadAccountData', {});
  return Object.keys(uc.recordMap.user_root)[0];
}

/** A page (private top-level when parentId is null, else a sub-page listed in the parent's content). */
export async function makePage(page, spaceId, title, { parentId = null, lines = [], extra = {} } = {}) {
  const uid = await me(page);
  const id = cryptoId();
  const now = Date.now();
  const ops = [];
  if (parentId) {
    ops.push({ pointer: { table: 'block', id }, path: [], command: 'set', args: { id, type: 'page', properties: { title: [[title]] }, content: [], parent_id: parentId, parent_table: 'block', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, ...extra } });
    ops.push({ pointer: { table: 'block', id: parentId }, path: ['content'], command: 'listAfter', args: { id } });
  } else {
    const uc = await call(page, 'loadAccountData', {});
    const sv = Object.values(uc.recordMap.space_view).map((e) => e.value.value ?? e.value).find((v) => v.space_id === spaceId);
    ops.push({ pointer: { table: 'block', id }, path: [], command: 'set', args: { id, type: 'page', properties: { title: [[title]] }, content: [], parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, created_time: now, created_by_id: uid, last_edited_time: now, last_edited_by_id: uid, permissions: [{ type: 'user_permission', role: 'editor', user_id: uid }], ...extra } });
    ops.push({ pointer: { table: 'space_view', id: sv.id }, path: ['private_pages'], command: 'listBefore', args: { id } });
  }
  await tx(page, spaceId, ops);
  for (const l of lines) await addBlock(page, spaceId, id, typeof l === 'string' ? { type: 'text', title: [[l]] } : l);
  return id;
}

/** Append a block to a page: { type, title: richText, format? }. */
export async function addBlock(page, spaceId, parentId, { type = 'text', title = [], format, extra = {} } = {}) {
  const id = cryptoId();
  await tx(page, spaceId, [
    { pointer: { table: 'block', id }, path: [], command: 'set', args: { id, type, properties: { title }, ...(format ? { format } : {}), parent_id: parentId, parent_table: 'block', space_id: spaceId, alive: true, ...extra } },
    { pointer: { table: 'block', id: parentId }, path: ['content'], command: 'listAfter', args: { id } },
  ]);
  return id;
}

/** "Link to page" block (alias) pointing at `targetId`. */
export function addLinkToPage(page, spaceId, parentId, targetId) {
  return addBlock(page, spaceId, parentId, { type: 'alias', format: { alias_pointer: { id: targetId, table: 'block', spaceId } } });
}

/** Full-page database (or inline with `inline: true`) with a Notes text property and the given rows. */
export async function makeDatabase(page, spaceId, parentId, name, rows = [], { inline = false } = {}) {
  const uid = await me(page);
  const blockId = cryptoId();
  const colId = cryptoId();
  const viewId = cryptoId();
  const now = Date.now();
  await tx(page, spaceId, [
    { pointer: { table: 'block', id: blockId }, path: [], command: 'set', args: { id: blockId, type: inline ? 'collection_view' : 'collection_view_page', parent_id: parentId, parent_table: 'block', space_id: spaceId, alive: true, collection_id: colId, view_ids: [viewId], created_time: now, created_by_id: uid, last_edited_time: now } },
    { pointer: { table: 'block', id: parentId }, path: ['content'], command: 'listAfter', args: { id: blockId } },
    { pointer: { table: 'collection', id: colId }, path: [], command: 'set', args: { id: colId, name: [[name]], parent_id: blockId, parent_table: 'block', space_id: spaceId, alive: true, schema: { title: { name: 'Name', type: 'title' }, notes: { name: 'Notes', type: 'text' } } } },
    { pointer: { table: 'collection_view', id: viewId }, path: [], command: 'set', args: { id: viewId, type: 'table', name: 'Table', parent_id: blockId, parent_table: 'block', space_id: spaceId, alive: true, format: { table_properties: [{ property: 'title', visible: true, width: 240 }, { property: 'notes', visible: true, width: 200 }] }, page_sort: [] } },
  ]);
  const rowIds = [];
  for (const r of rows) {
    const id = cryptoId();
    await tx(page, spaceId, [{ pointer: { table: 'block', id }, path: [], command: 'set', args: { id, type: 'page', parent_id: colId, parent_table: 'collection', space_id: spaceId, alive: true, properties: { title: [[r.title]], ...(r.notes ? { notes: [[r.notes]] } : {}) }, created_time: Date.now(), created_by_id: uid, last_edited_time: Date.now(), last_edited_by_id: uid } }]);
    rowIds.push(id);
  }
  return { blockId, colId, viewId, rowIds };
}

/** Workspace domain of a space (for /<domain>/<slug> URLs). */
export async function domainOf(page, spaceId) {
  const uc = await call(page, 'loadAccountData', {});
  const s = uc.recordMap.space?.[spaceId];
  return (s?.value?.value ?? s?.value)?.domain;
}

/** Open a page by id in Litpage and wait for its title. */
export async function openPageById(page, BASE, domain, id) {
  await page.goto(`${BASE}/${domain}/p-${id.replace(/-/g, '')}`);
  await page.waitForSelector('.lit-frame h1[data-content-editable-leaf], .lit-frame .nc-db-page', { timeout: 15000 });
  await page.waitForTimeout(400);
}

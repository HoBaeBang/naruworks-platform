// Smoke test against a running server: node test/smoke.mjs http://127.0.0.1:3999
const base = (process.argv[2] ?? 'http://127.0.0.1:3001') + '/api/rpc';
let cookie = '';
async function call(name, body = {}) {
  const res = await fetch(`${base}/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const json = await res.json();
  if (!res.ok) throw new Error(`${name} ${res.status} ${JSON.stringify(json)}`);
  return json;
}
const email = `u${Date.now()}@test.dev`;
console.log('loginOptions', await call('checkSignInMethods', { email }));
const { devCode } = await call('sendSignInCode', { email });
console.log('login', await call('signInWithEmail', { email, code: devCode }));
console.log('createWorkspace', (await call('createWorkspace', { name: 'Acme' })).spaceId);
const uc = await call('loadAccountData');
const rm = uc.recordMap;
console.log('userContent tables', Object.fromEntries(Object.entries(rm).filter(([k]) => k !== '__version__').map(([k, v]) => [k, Object.keys(v).length])));
const sv = Object.values(rm.space_view)[0].value.value;
const spaceId = sv.space_id;
const pageId = sv.private_pages[0];
const chunk = await call('loadPage', { pageId });
console.log('pageChunk tables', Object.fromEntries(Object.entries(chunk.recordMap).filter(([k]) => k !== '__version__').map(([k, v]) => [k, Object.keys(v).length])));
const page = chunk.recordMap.block[pageId].value.value;
console.log('page', page.properties.title, page.content.length, 'children');
// add a block via transaction
const newId = crypto.randomUUID();
const now = Date.now();
await call('applyChanges', { requestId: crypto.randomUUID(), transactions: [{ id: crypto.randomUUID(), spaceId, operations: [
  { pointer: { table: 'block', id: newId, spaceId }, path: [], command: 'set', args: { type: 'text', id: newId, space_id: spaceId, created_time: now, created_by_id: page.created_by_id, last_edited_time: now, last_edited_by_id: page.created_by_id, properties: { title: [['Hello 노션 world']] }, alive: true, parent_id: pageId, parent_table: 'block' } },
  { pointer: { table: 'block', id: pageId, spaceId }, path: ['content'], command: 'listAfter', args: { id: newId } },
] }] });
const sync = await call('fetchRecords', { requests: [{ pointer: { table: 'block', id: newId }, version: -1 }, { pointer: { table: 'block', id: pageId }, version: -1 }] });
console.log('synced', sync.recordMap.block[newId].value.value.version, sync.recordMap.block[pageId].value.value.content.length);
console.log('search 노션', (await call('searchWorkspace', { query: '노션', spaceId })).results.length, 'search Welcome', (await call('searchWorkspace', { query: 'Welcome', spaceId })).results.length);
console.log('activity', (await call('listPageActivity', { pageId })).activities.length, 'snapshots', (await call('listPageVersions', { pageId })).snapshots.length);
const dup = await call('duplicateBlock', { blockId: pageId });
console.log('duplicated', dup.blockId);
console.log('OK');

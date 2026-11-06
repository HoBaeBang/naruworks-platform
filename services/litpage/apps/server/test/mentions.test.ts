// Group mentions: a ["g", groupId] mention in a block notifies the members of that workspace permission group
// (space.settings.groups) who can see the page — never the author, never members without access, never groups that the
// text does not mention; someone mentioned directly and through the group gets one notification.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-mentions-test-'));
delete process.env.NC_DEV_LOGIN_CODES;

let H: Record<string, (ctx: any, body: any) => any>;
let db: typeof import('../src/db.ts');
let seed: typeof import('../src/seed.ts');
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string | null) => ({ userId, ip: '127.0.0.1', setCookie: () => {} });

async function status(p: () => unknown): Promise<number> {
  try {
    await p();
    return 200;
  } catch (e: any) {
    return e?.status ?? 500;
  }
}

function notifications(blockId: string): any[] {
  return (db.db.prepare(`SELECT data FROM records WHERE tbl = 'notification'`).all() as { data: string }[])
    .map((r) => JSON.parse(r.data))
    .filter((n) => n.navigable_block_id === blockId);
}

function textBlock(id: string, title: any[]) {
  const now = Date.now();
  db.putRecord('block', {
    id, version: 1, type: 'text', properties: { title }, parent_id: ids.page, parent_table: 'block', space_id: ids.space, alive: true,
    created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice,
  } as any);
  const page = db.getRecord<any>('block', ids.page)!;
  db.putRecord('block', { ...page, content: [...(page.content ?? []), id] });
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts'); // merges api/modules handlers (notifyMentions)
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  seed = await import('../src/seed.ts');
  for (const n of ['alice', 'bob', 'carl', 'dora']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@mentions.test`, n);
  }
  ids.space = seed.createWorkspace(ids.alice, 'Acme').space.id;
  for (const n of ['bob', 'carl', 'dora']) seed.addMember(ids.space, ids[n], 'editor');
  ids.group = newId();
  ids.other = newId();
  const space = db.getRecord<any>('space', ids.space)!;
  db.putRecord('space', {
    ...space,
    settings: {
      ...(space.settings ?? {}),
      groups: [
        { id: ids.group, name: 'Design', member_ids: [ids.alice, ids.bob, ids.carl, ids.dora], created_time: Date.now(), created_by_id: ids.alice },
        { id: ids.other, name: 'Other', member_ids: [ids.carl], created_time: Date.now(), created_by_id: ids.alice },
      ],
    },
  });
  // a page shared with alice, bob and carl only — dora is in the group but cannot see the page
  ids.page = newId();
  const now = Date.now();
  db.putRecord('block', {
    id: ids.page, version: 1, type: 'page', properties: { title: [['Spec']] }, content: [], parent_id: ids.space, parent_table: 'space', space_id: ids.space,
    alive: true, created_time: now, created_by_id: ids.alice, last_edited_time: now, last_edited_by_id: ids.alice,
    permissions: [
      { type: 'user_permission', role: 'editor', user_id: ids.alice },
      { type: 'user_permission', role: 'editor', user_id: ids.bob },
      { type: 'user_permission', role: 'comment_only', user_id: ids.carl },
    ],
  } as any);
});

describe('group mentions', () => {
  it('notifies the group members who can see the page, with the group name', async () => {
    ids.text = newId();
    textBlock(ids.text, [['Review please '], ['‣', [['g', ids.group, ids.space]]]]);
    await H.notifyMentions(ctx(ids.alice), { blockId: ids.text, groupIds: [ids.group, ids.other] });
    const got = notifications(ids.text);
    expect(got.map((n) => n.user_id).sort()).toEqual([ids.bob, ids.carl].sort());
    expect(got.every((n) => n.type === 'mention' && n.actor_id === ids.alice && n.activity?.kind === 'group_mention' && n.activity?.group_name === 'Design')).toBe(true);
    expect(got[0].activity.text).toBe('Review please @Design');
  });

  it('a person mentioned directly and through the group is notified once', async () => {
    ids.both = newId();
    textBlock(ids.both, [['‣', [['u', ids.bob]]], [' and '], ['‣', [['g', ids.group, ids.space]]]]);
    await H.notifyMentions(ctx(ids.alice), { blockId: ids.both, userIds: [ids.bob], groupIds: [ids.group] });
    const got = notifications(ids.both);
    expect(got.filter((n) => n.user_id === ids.bob)).toHaveLength(1);
    expect(got.filter((n) => n.user_id === ids.carl)).toHaveLength(1);
  });

  it('groups that the text does not mention, and callers who cannot edit the block, notify no one', async () => {
    ids.plain = newId();
    textBlock(ids.plain, [['No mention here']]);
    await H.notifyMentions(ctx(ids.alice), { blockId: ids.plain, groupIds: [ids.group] });
    expect(notifications(ids.plain)).toHaveLength(0);
    expect(await status(() => H.notifyMentions(ctx(ids.dora), { blockId: ids.text, groupIds: [ids.group] }))).toBe(403);
    expect(await status(() => H.notifyMentions(ctx(ids.carl), { blockId: ids.text, groupIds: [ids.group] }))).toBe(403);
  });
});

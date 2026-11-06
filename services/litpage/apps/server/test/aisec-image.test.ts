// item 8: the page an image request is about must be readable by the person and belong to the workspace whose
// AI service / image settings were checked — another workspace's page (where AI service may be off) never reaches the
// model, nor does a page the person can't open.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-image-test-'));
process.env.NC_SCHEDULER = '0';
delete process.env.ANTHROPIC_API_KEY;
vi.setConfig({ testTimeout: 30_000 });

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>';
function fake(seen: any[]) {
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
              yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: SVG } };
            },
            finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: SVG }], usage }),
          };
        }) as any,
      },
    },
  };
}

let image: typeof import('../src/ai/image.ts');
let db: typeof import('../src/db.ts');
let newId: () => string;
const ids = {} as Record<string, string>;

function page(spaceId: string, title: string, body: string, perms: any[]) {
  const id = newId();
  const line = newId();
  const now = Date.now();
  db.putRecord('block', { id, version: 1, type: 'page', parent_id: spaceId, parent_table: 'space', space_id: spaceId, alive: true, properties: { title: [[title]] }, content: [line], permissions: perms, created_time: now } as any);
  db.putRecord('block', { id: line, version: 1, type: 'text', parent_id: id, parent_table: 'block', space_id: spaceId, alive: true, properties: { title: [[body]] }, created_time: now } as any);
  return id;
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  image = await import('../src/ai/image.ts');
  db = await import('../src/db.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['ada', 'bea']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@aisec-img.test`, n);
  }
  ids.a = seed.createWorkspace(ids.ada, 'Images on').space.id;
  ids.b = seed.createWorkspace(ids.bea, 'AI off').space.id;
  seed.addMember(ids.b, ids.ada, 'member');
  for (const s of [ids.a, ids.b]) db.putRecord('space', { ...db.getRecord<any>('space', s), plan_type: 'business' });
  const sb = db.getRecord<any>('space', ids.b);
  db.putRecord('space', { ...sb, settings: { ...sb.settings, ai_enabled: false } });
  ids.inA = page(ids.a, 'Roadmap', 'roadmap-context-owl', [{ type: 'user_permission', role: 'editor', user_id: ids.ada }]);
  ids.inB = page(ids.b, 'Secret plans', 'workspace-b-secret-mole', [{ type: 'space_permission', role: 'reader' }]);
  ids.private = page(ids.a, 'Bea private', 'bea-private-vole', [{ type: 'user_permission', role: 'editor', user_id: ids.bea }]);
});

describe('image generation context page', () => {
  it('uses a readable page of the same workspace', async () => {
    const seen: any[] = [];
    await image.generateImage({ userId: ids.ada, spaceId: ids.a, prompt: 'a diagram of this page', pageId: ids.inA, client: fake(seen) as any });
    expect(JSON.stringify(seen[0].messages)).toContain('roadmap-context-owl');
  });

  it('refuses another workspace’s page (Litpage AI off there) and pages the person can’t open', async () => {
    const seen: any[] = [];
    await expect(image.generateImage({ userId: ids.ada, spaceId: ids.a, prompt: 'chart', pageId: ids.inB, client: fake(seen) as any })).rejects.toMatchObject({ status: 403 });
    await expect(image.generateImage({ userId: ids.ada, spaceId: ids.a, prompt: 'chart', pageId: ids.private, client: fake(seen) as any })).rejects.toMatchObject({ status: 403 });
    expect(seen).toHaveLength(0);
    // the workspace with AI service off refuses on its own
    await expect(image.generateImage({ userId: ids.ada, spaceId: ids.b, prompt: 'chart', pageId: ids.inB, client: fake(seen) as any })).rejects.toMatchObject({ status: 403 });
    expect(JSON.stringify(seen)).not.toContain('workspace-b-secret-mole');
  });
});

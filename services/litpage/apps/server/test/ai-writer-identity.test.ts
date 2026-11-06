// The inline writer always runs as the signed-in user: a `userId` (or a foreign `spaceId`) in the request body must
// not let anyone read another person's private pages through the writer's output (audit A5a, critical).
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-writer-test-'));
process.env.NC_SCHEDULER = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';
process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9'; // never reach the network, even if a check regressed

let H: Record<string, (ctx: any, body: any) => any>;
let svc: typeof import('../src/ai/service.ts');
const ids = {} as Record<string, string>;
const ctx = (userId: string) => ({ userId, setCookie: () => {} });

beforeAll(async () => {
  const { newId } = await import('@nc/shared/ids.ts');
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  svc = await import('../src/ai/service.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['alice', 'mallory']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@writer.test`, n);
  }
  const a = seed.createWorkspace(ids.alice, 'Alice Co');
  ids.aliceSpace = a.space.id;
  ids.alicePage = a.spaceView.private_pages[0];
  const m = seed.createWorkspace(ids.mallory, 'Mallory Co');
  ids.mallorySpace = m.space.id;
  ids.malloryPage = m.spaceView.private_pages[0];
});

const status = async (fn: () => unknown) => {
  try {
    await fn();
    return 200;
  } catch (e: any) {
    return e.status ?? 500;
  }
};

describe('inline writer identity', () => {
  it('ignores a userId in the request body', async () => {
    // Mallory asks the writer to summarize Alice's private page while claiming to be Alice
    const body = { userId: ids.alice, pageId: ids.alicePage, skill: 'Summarize' };
    expect(await status(() => H.aiComplete(ctx(ids.mallory), body))).toBe(403);
  });

  it('a foreign workspace or a missing context is refused', async () => {
    expect(() => svc.prepareWriter({ userId: ids.mallory, spaceId: ids.aliceSpace, prompt: 'hi' })).toThrow(/cannot access this workspace/);
    expect(() => svc.prepareWriter({ userId: ids.mallory, prompt: 'hi' })).toThrow(/Open a page/);
    // a page of someone else's private section
    expect(() => svc.prepareWriter({ userId: ids.mallory, pageId: ids.alicePage, skill: 'Summarize' })).toThrow(/access to this page/);
  });

  it('still works for the user on their own page and workspace', () => {
    expect(svc.prepareWriter({ userId: ids.mallory, pageId: ids.malloryPage, skill: 'Summarize' })).toBeTruthy();
    expect(svc.prepareWriter({ userId: ids.mallory, spaceId: ids.mallorySpace, prompt: 'Write a haiku' })).toBeTruthy();
  });
});

// AI service chat "All sources" and date mentions in prompts: a chat limited to one
// page searches only inside it (and the model is told), "Workspace" turns web and connected apps off, "Web" drops the
// workspace search tool and turns web on, and a page the person can't open is ignored as a source.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-ai-scope-test-'));
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

type Ev = Record<string, any>;
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fake(turns: { final: Ev }[], seen: any[] = []) {
  let i = 0;
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const t = turns[Math.min(i++, turns.length - 1)];
          return { async *[Symbol.asyncIterator]() { /* no stream events */ }, finalMessage: async () => t.final };
        }) as any,
      },
    },
  };
}
const say = (text: string) => ({ final: { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage } });
const search = (query: string) => ({ final: { model: 'claude-opus-5-5', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_${Math.random().toString(36).slice(2, 8)}`, name: 'search_workspace', input: { query } }], usage } });

let svc: typeof import('../src/ai/service.ts');
let A = '';
let B = '';
let spaceId = '';
const ids = {} as Record<string, string>;

beforeAll(async () => {
  const { newId } = await import('@nc/shared/ids.ts');
  const seed = await import('../src/seed.ts');
  const db = await import('../src/db.ts');
  const { indexBlock } = await import('../src/search.ts');
  svc = await import('../src/ai/service.ts');
  A = newId();
  B = newId();
  seed.createUser(A, 'a@scope.dev', 'Ann');
  seed.createUser(B, 'b@scope.dev', 'Ben');
  spaceId = seed.createWorkspace(A, 'Scope Lab').space.id;
  seed.addMember(spaceId, B, 'member');
  const now = Date.now();
  const page = (title: string, parentId: string, parentTable: string, extra: Record<string, unknown> = {}) => {
    const id = newId();
    const rec = { id, version: 1, type: 'page', properties: { title: [[title]] }, content: [], parent_id: parentId, parent_table: parentTable, space_id: spaceId, alive: true, created_time: now, created_by_id: A, last_edited_time: now, ...extra } as any;
    db.putRecord('block', rec);
    if (parentTable === 'block') {
      const p = db.getRecord<any>('block', parentId);
      db.putRecord('block', { ...p, content: [...(p.content ?? []), id] });
    }
    indexBlock(rec);
    return id;
  };
  ids.handbook = page('Roadmap handbook', spaceId, 'space', { permissions: [{ type: 'space_permission', role: 'read_and_write' }] });
  ids.inside = page('Roadmap Q4 goals', ids.handbook, 'block');
  ids.outside = page('Roadmap for marketing', spaceId, 'space', { permissions: [{ type: 'space_permission', role: 'read_and_write' }] });
  ids.secret = page('Roadmap secrets', spaceId, 'space', { permissions: [{ type: 'user_permission', role: 'editor', user_id: A }] });
});

describe('chat sources', () => {
  it('one page: workspace search stays inside it and the model is told', async () => {
    const seen: any[] = [];
    const prep = svc.prepareChatTurn({ userId: A, spaceId, text: 'What are the roadmap goals?', web: true, scope: { kind: 'page', id: ids.handbook } });
    await svc.executeChatTurn(prep, {}, undefined, fake([search('Roadmap'), say('Q4 goals.')], seen) as any);
    const results = JSON.stringify(seen[1].messages);
    expect(results).toContain('Roadmap Q4 goals');
    expect(results).not.toContain('Roadmap for marketing');
    expect(JSON.stringify(seen[0].messages)).toContain('limited this question to the page “Roadmap handbook”');
    // Workspace-only sources never get the web tools, even with Web on
    expect((seen[0].tools ?? []).some((t: any) => String(t.type ?? '').startsWith('web_search'))).toBe(false);
  });

  it('Web only: no workspace search, web tools on', async () => {
    const seen: any[] = [];
    const prep = svc.prepareChatTurn({ userId: A, spaceId, text: 'Latest news?', scope: { kind: 'web' } });
    await svc.executeChatTurn(prep, {}, undefined, fake([say('News.')], seen) as any);
    const names = (seen[0].tools ?? []).map((t: any) => t.name);
    expect(names).not.toContain('search_workspace');
    expect((seen[0].tools ?? []).some((t: any) => String(t.type ?? '').startsWith('web_search'))).toBe(true);
  });

  it('a page the person can’t open is ignored as a source', async () => {
    const seen: any[] = [];
    const prep = svc.prepareChatTurn({ userId: B, spaceId, text: 'Roadmap?', scope: { kind: 'page', id: ids.secret } });
    await svc.executeChatTurn(prep, {}, undefined, fake([search('Roadmap'), say('…')], seen) as any);
    expect(JSON.stringify(seen[0].messages)).not.toContain('Roadmap secrets');
    expect(JSON.stringify(seen[1].messages)).not.toContain('Roadmap secrets');
    expect(JSON.stringify(seen[1].messages)).toContain('Roadmap for marketing');
  });
});

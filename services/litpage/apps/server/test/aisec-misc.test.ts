// Smaller AI fixes.
// 22 — SKILL.md front matter is valid YAML whatever the description holds (backslashes, quotes, CR, separators)
// 23 — "@" a skill in chat runs it, like "/" does
// 25 — the MCP server allowlist: owners turn it on / off and add / remove URL patterns (validation messages);
// on with an empty list, no custom MCP server can be connected
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-aisec-misc-test-'));
process.env.NC_SCHEDULER = '0';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-0000000000';

const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
function fake(seen: any[]) {
  return {
    beta: {
      messages: {
        stream: ((params: any) => {
          seen.push(JSON.parse(JSON.stringify(params)));
          const text = 'Done.';
          return {
            async *[Symbol.asyncIterator]() {
              yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
              yield { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } };
            },
            finalMessage: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text }], usage }),
          };
        }) as any,
      },
    },
  };
}

let db: typeof import('../src/db.ts');
let skills: typeof import('../src/ai/skills.ts');
let svc: typeof import('../src/ai/service.ts');
let policy: typeof import('../src/ai/aiPolicy.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let newId: () => string;
const ids = {} as Record<string, string>;
const call = async (user: string, name: string, body: any = {}) => H[name]({ userId: user, setCookie: () => {} }, body);
async function failure(p: () => unknown): Promise<{ status: number; message: string }> {
  try {
    await p();
    return { status: 200, message: '' };
  } catch (e: any) {
    return { status: e?.status ?? 500, message: String(e?.message ?? '') };
  }
}

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  db = await import('../src/db.ts');
  skills = await import('../src/ai/skills.ts');
  svc = await import('../src/ai/service.ts');
  policy = await import('../src/ai/aiPolicy.ts');
  await import('../src/api/modules/ai.ts');
  const seed = await import('../src/seed.ts');
  for (const n of ['owner', 'member']) {
    ids[n] = newId();
    seed.createUser(ids[n], `${n}@aisec-misc.test`, n);
  }
  ids.space = seed.createWorkspace(ids.owner, 'Misc').space.id;
  seed.addMember(ids.space, ids.member, 'member');
});

describe('SKILL.md (item 22)', () => {
  it('front matter description is a valid quoted scalar', () => {
    const description = 'Path C:\\temp\\new "quoted"\r\nsecond line\ttab \u2028 end';
    const md = skills.skillMarkdown({ id: 'x', pageId: 'x', name: 'Weekly report', description, instructions: 'Do it.', builtin: false, enabled: true, mine: true, automatic: true, inChat: true, inPage: true } as any);
    const line = md.split('\n').find((l) => l.startsWith('description: '))!;
    expect(md.split('\n')[2]).toBe(line);
    const scalar = line.slice('description: '.length);
    expect(scalar.startsWith('"') && scalar.endsWith('"')).toBe(true);
    expect(scalar).not.toMatch(/[\r\u2028\u2029]/);
    // JSON strings are YAML double-quoted scalars: the value reads back exactly (line breaks folded to spaces)
    expect(JSON.parse(scalar.replace(/\\u2028/g, '\u2028'))).toBe('Path C:\\temp\\new "quoted" second line\ttab \u2028 end');
  });
});

describe('"@" a skill in chat (item 23)', () => {
  it('runs it like "/"', async () => {
    const skillId = newId();
    const now = Date.now();
    db.putRecord('block', { id: skillId, version: 1, type: 'page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, properties: { title: [['Standup digest']] }, content: [], format: { ai_skill: { enabled: true, description: 'Digest' } }, permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.member }], created_time: now, created_by_id: ids.member } as any);
    const line = newId();
    db.putRecord('block', { id: line, version: 1, type: 'text', parent_id: skillId, parent_table: 'block', space_id: ids.space, alive: true, properties: { title: [['Write the digest as three bullets-pelican.']] }, created_time: now } as any);
    db.putRecord('block', { ...db.getRecord<any>('block', skillId), content: [line] });
    db.putRecord('user_settings', { id: ids.member, version: 1, settings: { ai_skills_enabled: [skillId] } } as any);
    const seen: any[] = [];
    const prep = svc.prepareChatTurn({ userId: ids.member, spaceId: ids.space, text: 'Use @Standup digest for today', mentions: [skillId] } as any);
    await svc.executeChatTurn(prep, {}, undefined, fake(seen) as any);
    const user = JSON.stringify(seen[0].messages.at(-1));
    expect(user).toContain('<skill name=\\"Standup digest\\">');
    expect(user).toContain('bullets-pelican');
    expect(prep.userMessage?.data.skills?.map((s: any) => s.id)).toEqual([skillId]);
  });
});

describe('MCP server allowlist (item 25)', () => {
  it('owners manage it with Litpage’s validation; on + empty blocks every custom server', async () => {
    const S = ids.space;
    expect((await failure(() => call(ids.member, 'aiUpdateMcpAllowlist', { spaceId: S, enabled: true }))).status).toBe(403);
    const bad: [string, RegExp][] = [
      ['', /Enter an MCP server URL or URL pattern/],
      ['http://mcp.example.com/*', /Only HTTPS URLs are allowed/],
      ['mcp.example.com/*', /must start with https/],
      ['https://*.example.com/mcp', /Use wildcards in the URL path only/],
      ['https://mcp.litpage.dev', /Add a path after the domain/],
    ];
    for (const [v, re] of bad) expect((await failure(() => call(ids.owner, 'aiUpdateMcpAllowlist', { spaceId: S, add: v }))).message).toMatch(re);
    // on with nothing approved: nothing is allowed
    expect(await call(ids.owner, 'aiUpdateMcpAllowlist', { spaceId: S, enabled: true })).toEqual({ allowlist: [], enabled: true });
    expect(policy.mcpServerAllowed(policy.workspaceAiPolicy(S), 'https://mcp.litpage.dev/mcp')).toBe(false);
    const r = await call(ids.owner, 'aiUpdateMcpAllowlist', { spaceId: S, add: 'https://mcp.litpage.dev/*' });
    expect(r).toEqual({ allowlist: ['https://mcp.litpage.dev/*'], enabled: true });
    expect((await failure(() => call(ids.owner, 'aiUpdateMcpAllowlist', { spaceId: S, add: 'https://mcp.litpage.dev/*' }))).message).toMatch(/already on the list/);
    expect(policy.mcpServerAllowed(policy.workspaceAiPolicy(S), 'https://mcp.litpage.dev/mcp')).toBe(true);
    expect(policy.mcpServerAllowed(policy.workspaceAiPolicy(S), 'https://evil.example.org/mcp')).toBe(false);
    // off: the list is kept but not in effect
    await call(ids.owner, 'aiUpdateMcpAllowlist', { spaceId: S, enabled: false });
    expect(policy.mcpServerAllowed(policy.workspaceAiPolicy(S), 'https://evil.example.org/mcp')).toBe(true);
    expect((await call(ids.owner, 'aiUpdateMcpAllowlist', { spaceId: S, remove: 'https://mcp.litpage.dev/*' })).allowlist).toEqual([]);
    const events = db.db.prepare("SELECT event FROM audit_log WHERE space_id = ? AND event LIKE 'workspace.settings.mcp_server_%'").all(S) as { event: string }[];
    expect(events.map((e) => e.event).sort()).toEqual(['workspace.settings.mcp_server_added_to_allowlist', 'workspace.settings.mcp_server_removed_from_allowlist']);
  });
});

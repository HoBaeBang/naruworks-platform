// Skills databases: a data source flagged format.ai_skills_db makes every page a skill; its Description
// property (format.ai_skills_description, else a text property named "Description") is the skill description;
// "Enable skills for me" (user_settings.ai_skills_dbs_enabled) enables every page, and a page can still be turned off
// on its own; people who can't open a row don't get it as a skill.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

process.env.NC_DATA_DIR = mkdtempSync(join(tmpdir(), 'nc-skills-db-test-'));
process.env.NC_SCHEDULER = '0';

let db: typeof import('../src/db.ts');
let skills: typeof import('../src/ai/skills.ts');
let H: Record<string, (ctx: any, body: any) => any>;
let newId: () => string;
const ids = {} as Record<string, string>;
const ctx = (userId: string) => ({ userId, setCookie: () => {} });

beforeAll(async () => {
  ({ newId } = await import('@nc/shared/ids.ts'));
  await import('../src/app.ts');
  H = (await import('../src/api/handlers.ts')).handlers as any;
  await import('../src/api/modules/ai.ts');
  const seed = await import('../src/seed.ts');
  db = await import('../src/db.ts');
  skills = await import('../src/ai/skills.ts');
  ids.A = newId();
  ids.B = newId();
  seed.createUser(ids.A, 'a@skills.dev', 'Ann');
  seed.createUser(ids.B, 'b@skills.dev', 'Ben');
  ids.space = seed.createWorkspace(ids.A, 'Skills Co').space.id;
  seed.addMember(ids.space, ids.B, 'member');
  ids.db = newId();
  ids.col = newId();
  const now = Date.now();
  db.putRecord('block', { id: ids.db, version: 1, type: 'collection_view_page', parent_id: ids.space, parent_table: 'space', space_id: ids.space, alive: true, collection_id: ids.col, view_ids: [], permissions: [{ type: 'space_permission', role: 'read_and_write' }], created_time: now, created_by_id: ids.A } as any);
  db.putRecord('collection', { id: ids.col, version: 1, parent_id: ids.db, parent_table: 'block', space_id: ids.space, alive: true, name: [['Team skills']], schema: { title: { name: 'Name', type: 'title' }, dsc: { name: 'Summary', type: 'text' } }, format: { ai_skills_db: true, ai_skills_description: 'dsc' } } as any);
  const row = (title: string, summary: string, extra: Record<string, unknown> = {}) => {
    const id = newId();
    db.putRecord('block', { id, version: 1, type: 'page', parent_id: ids.col, parent_table: 'collection', space_id: ids.space, alive: true, properties: { title: [[title]], dsc: [[summary]] }, content: [], created_time: now, created_by_id: ids.A, ...extra } as any);
    return id;
  };
  ids.r1 = row('Draft release notes', 'Turn merged PRs into release notes');
  ids.r2 = row('Weekly digest', 'Summarize the week for leadership');
  // a row only Ann can open (page-level access)
  ids.r3 = row('Comp review', 'Salary bands', { permissions: [{ type: 'user_permission', role: 'editor', user_id: ids.A }], permissions_unlinked: true });
});

describe('skills databases', () => {
  it('every readable page is a skill described by the mapped property; enable for me + turn off one page', async () => {
    const before = skills.listSkills(ids.B, ids.space);
    const r1 = before.discover.find((s) => s.id === ids.r1)!;
    expect(r1.description).toBe('Turn merged PRs into release notes');
    expect(before.discover.some((s) => s.id === ids.r3)).toBe(false);
    // Enable skills for me (the whole database)
    db.putRecord('user_settings', { id: ids.B, version: 1, settings: { ai_skills_dbs_enabled: [ids.col] } } as any);
    const on = skills.listSkills(ids.B, ids.space).enabled.map((s) => s.id);
    expect(on).toEqual(expect.arrayContaining([ids.r1, ids.r2]));
    expect(skills.skillById(ids.r2, ids.B, ids.space)).toMatchObject({ name: 'Weekly digest', enabled: true });
    // turn one page off from the Library (the database stays enabled)
    await H.aiSetSkillEnabled(ctx(ids.B), { spaceId: ids.space, skillId: ids.r2, enabled: false });
    const after = skills.listSkills(ids.B, ids.space);
    expect(after.enabled.map((s) => s.id)).toContain(ids.r1);
    expect(after.enabled.map((s) => s.id)).not.toContain(ids.r2);
    await H.aiSetSkillEnabled(ctx(ids.B), { spaceId: ids.space, skillId: ids.r2, enabled: true });
    expect(skills.listSkills(ids.B, ids.space).enabled.map((s) => s.id)).toContain(ids.r2);
    // Undo Skills database: the pages stop being skills
    const col = db.getRecord<any>('collection', ids.col);
    db.putRecord('collection', { ...col, format: { ...col.format, ai_skills_db: false } });
    expect(skills.skillById(ids.r1, ids.B, ids.space)).toBeNull();
  });
});

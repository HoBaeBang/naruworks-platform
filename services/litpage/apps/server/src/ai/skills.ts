// AI skills (Library → Skills, page ••• → Use as AI skill, "/" in chat, the selection menu's Skills list).
//
// A user skill is a page: its body is the instructions, its first paragraph the description AI uses to decide
// when the skill is relevant ("Change the beginning of a page to update it."). The page carries the skill flag in
// format.ai_skill (anyone who can read the page can find it under Discover); each member keeps their own set of
// enabled skills in user_settings.settings.ai_skills_enabled ("Enabled for me"). Built-in skills are the inline
// writer's actions. Rows of a database flagged format.ai_skills_db (a skills database) are skills too.
import type { BlockRecord, CollectionRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { childrenOf, db, getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { blockTitle, mdSource } from './context.ts';
import { pageToMarkdown } from './prompts.ts';
import { visibleCollection, visibleRow } from './visibility.ts';

export interface SkillInfo {
  /** page id for user skills, "builtin:<id>" for built-ins */
  id: string;
  pageId: string | null;
  name: string;
  description: string;
  instructions: string;
  builtin: boolean;
  enabled: boolean;
  /** created by this user */
  mine: boolean;
  /** AI may use it on its own when relevant */
  automatic: boolean;
  inChat: boolean;
  inPage: boolean;
  icon?: string;
  createdBy?: string;
  updatedTime?: number;
}

/** Built-in skills use the same tasks as the inline writer. */
export const BUILTIN_SKILLS: { id: string; name: string; description: string; instructions: string }[] = [
  { id: 'improve', name: 'Improve writing', description: 'Make the writing clearer and easier to follow while keeping its meaning.', instructions: 'Revise the writing for clarity, flow, and structure. Keep the meaning, voice, and language.' },
  { id: 'proofread', name: 'Proofread', description: 'Correct spelling, grammar, punctuation, and formatting while keeping your voice.', instructions: 'Correct spelling, grammar, punctuation, and formatting. Leave the wording and voice intact.' },
  { id: 'explain', name: 'Explain', description: 'Explain a selected idea with context from the page and workspace.', instructions: 'Explain the selected text plainly for someone new to the topic. Use the page and workspace for context.' },
  { id: 'reformat', name: 'Reformat', description: 'Make the layout and line breaks easier to scan without changing the content.', instructions: 'Improve the layout with headings, lists, or a table when helpful. Keep the underlying content unchanged.' },
];

function settings(userId: string): Record<string, unknown> {
  return (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
}

function enabledIds(userId: string): Set<string> {
  const v = settings(userId).ai_skills_enabled;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

function disabledBuiltins(userId: string): Set<string> {
  const v = settings(userId).ai_skills_disabled;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

/** Skills databases whose pages are all enabled for the person ("Enable skills for me"), minus the
 *  pages they turned off one by one. */
function enabledDatabases(userId: string): Set<string> {
  const v = settings(userId).ai_skills_dbs_enabled;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

function rowsTurnedOff(userId: string): Set<string> {
  const v = settings(userId).ai_skills_rows_off;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

/** A page that is a skill: flagged with format.ai_skill or a row of a skills database. */
export function isSkillPage(b: BlockRecord | undefined): boolean {
  return !!b && (!!skillFlag(b) || isSkillsDatabaseRow(b));
}

function automaticOff(userId: string): Set<string> {
  const v = settings(userId).ai_skills_manual;
  return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
}

export function skillFlag(b: BlockRecord | undefined): { enabled?: boolean; description?: string; in_chat?: boolean; in_page?: boolean } | null {
  const f = (b?.format as Record<string, unknown> | undefined)?.ai_skill;
  return f && typeof f === 'object' && (f as { enabled?: boolean }).enabled !== false ? (f as any) : null;
}

/** First paragraph of a page, used as the skill description. */
export function pageDescription(pageId: string, userId: string): string {
  const src = mdSource(userId);
  const page = src.block(pageId);
  for (const id of page?.content ?? []) {
    const b = src.block(id);
    if (!b || b.type === 'page') continue;
    const text = toPlainText(b.properties?.title as any).replace(/[‣⁍]/g, '').trim();
    if (text) return text.slice(0, 240);
  }
  return '';
}

function isSkillsDatabaseRow(b: BlockRecord): boolean {
  if (b.parent_table !== 'collection') return false;
  const c = getRecord<CollectionRecord>('collection', b.parent_id);
  return !!(c?.format as Record<string, unknown> | undefined)?.ai_skills_db;
}

/** A skills-database row's Description property (the mapped one, else a text property named “Description”). */
function rowDescription(b: BlockRecord, userId: string): string {
  if (b.parent_table !== 'collection') return '';
  const c = getRecord<CollectionRecord>('collection', b.parent_id);
  const fmt = (c?.format ?? {}) as Record<string, unknown>;
  if (!c || !fmt.ai_skills_db) return '';
  const visible = visibleCollection(c, userId) ?? c;
  const pid = typeof fmt.ai_skills_description === 'string' && visible.schema[fmt.ai_skills_description]
    ? fmt.ai_skills_description
    : Object.keys(visible.schema).find((k) => visible.schema[k].type === 'text' && visible.schema[k].name.trim().toLowerCase() === 'description');
  if (!pid) return '';
  const row = visibleRow(b, userId);
  return toPlainText((row?.properties?.[pid] ?? []) as any).trim();
}

function skillOfPage(b: BlockRecord, userId: string, enabled: Set<string>, manual: Set<string>, dbs: Set<string> = new Set()): SkillInfo {
  const flag = skillFlag(b) ?? {};
  const md = pageToMarkdown(b.id, mdSource(userId), { includeTitle: false, maxChars: 20_000 });
  const inEnabledDb = b.parent_table === 'collection' && dbs.has(b.parent_id) && !rowsTurnedOff(userId).has(b.id);
  return {
    id: b.id, pageId: b.id, name: blockTitle(b) || 'Untitled', description: (flag.description || rowDescription(b, userId) || pageDescription(b.id, userId)).slice(0, 240), instructions: md.markdown,
    builtin: false, enabled: enabled.has(b.id) || inEnabledDb, mine: b.created_by_id === userId, automatic: !manual.has(b.id), inChat: flag.in_chat !== false, inPage: flag.in_page !== false,
    icon: typeof b.format?.page_icon === 'string' ? (b.format.page_icon as string) : undefined, createdBy: b.created_by_id, updatedTime: b.last_edited_time,
  };
}

/** All skill pages in a workspace the user can read (flagged pages + skills-database rows). */
function skillPages(userId: string, spaceId: string): BlockRecord[] {
  const flagged = (db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND data LIKE '%"ai_skill"%'`).all(spaceId) as { data: string }[])
    .map((r) => JSON.parse(r.data) as BlockRecord)
    .filter((b) => !!skillFlag(b));
  const dbRows: BlockRecord[] = [];
  for (const r of db.prepare(`SELECT id FROM records WHERE tbl = 'collection' AND space_id = ? AND data LIKE '%"ai_skills_db":true%'`).all(spaceId) as { id: string }[]) {
    dbRows.push(...childrenOf<BlockRecord>('block', r.id).filter((b) => b.parent_table === 'collection' && b.alive !== false && !b.is_template));
  }
  const seen = new Set<string>();
  return [...flagged, ...dbRows].filter((b) => {
    if (b.alive === false || seen.has(b.id)) return false;
    seen.add(b.id);
    return blockRole(b.id, userId) !== 'none';
  });
}

export function listSkills(userId: string, spaceId: string): { enabled: SkillInfo[]; discover: SkillInfo[] } {
  const enabled = enabledIds(userId);
  const manual = automaticOff(userId);
  const off = disabledBuiltins(userId);
  const builtins: SkillInfo[] = BUILTIN_SKILLS.map((s) => ({
    id: `builtin:${s.id}`, pageId: null, name: s.name, description: s.description, instructions: s.instructions, builtin: true, enabled: !off.has(s.id), mine: false,
    automatic: false, inChat: true, inPage: true,
  }));
  const dbs = enabledDatabases(userId);
  const pages = skillPages(userId, spaceId).map((b) => skillOfPage(b, userId, enabled, manual, dbs));
  // the creator always sees their own skills under "Enabled for me" unless they turned them off
  return {
    enabled: [...pages.filter((s) => s.enabled), ...builtins.filter((s) => s.enabled)],
    discover: [...pages.filter((s) => !s.enabled), ...builtins.filter((s) => !s.enabled)],
  };
}

/** An enabled skill the user can use (built-in or page). */
export function skillById(id: string, userId: string, spaceId: string): SkillInfo | null {
  if (id.startsWith('builtin:')) {
    const s = BUILTIN_SKILLS.find((x) => `builtin:${x.id}` === id);
    return s ? { id, pageId: null, name: s.name, description: s.description, instructions: s.instructions, builtin: true, enabled: true, mine: false, automatic: false, inChat: true, inPage: true } : null;
  }
  const b = getRecord<BlockRecord>('block', id);
  if (!b || b.alive === false || b.space_id !== spaceId || blockRole(b.id, userId) === 'none') return null;
  if (!skillFlag(b) && !isSkillsDatabaseRow(b)) return null;
  return skillOfPage(b, userId, enabledIds(userId), automaticOff(userId), enabledDatabases(userId));
}

/** Enabled skills the agent may pick on its own (system prompt list). */
export function automaticSkills(userId: string, spaceId: string): { id: string; name: string; description: string }[] {
  return listSkills(userId, spaceId).enabled.filter((s) => !s.builtin && s.automatic).map((s) => ({ id: s.id, name: s.name, description: s.description }));
}

/** SKILL.md for local agents (Download for local agents). */
export function skillMarkdown(s: SkillInfo): string {
  const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill';
  // one line, as a YAML double-quoted scalar: JSON string escaping is valid YAML (backslashes, quotes, control
  // characters), plus the Unicode line / paragraph separators
  const yamlString = (v: string) => JSON.stringify(v.replace(/\r\n?|\n/g, ' ')).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `---\nname: ${slug}\ndescription: ${yamlString(s.description || s.name)}\n---\n\n# ${s.name}\n\n${s.instructions}\n`;
}

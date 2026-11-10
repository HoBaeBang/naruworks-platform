// Read-only agent tools. Everything is read with the acting user's permissions (blockRole / readable query
// context); results are compact text the model can cite ("[n]" source numbers are assigned through env.cite).
import type { BlockRecord, CollectionRecord, CommentRecord, DiscussionRecord, NotificationRecord, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { getPropertyValue, isEmptyValue, valueToNumber, valueToText, compareValues } from '@nc/shared/database/values.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { db, getRecord } from '../../db.ts';
import { blockRole } from '../../records.ts';
import { aiQueryContext, discussionVisible, visibleRows } from '../visibility.ts';
import { getSnapshot, listSnapshots } from '../../history.ts';
import { redactVersionData } from '../../versionAccess.ts';
import { AiError } from '../client.ts';
import { blockTitle, canRead, mdSource, readPage, searchPages } from '../context.ts';
import { databaseOf, isAncestor, normalizeId, PAGE_TYPES, readableBlock } from '../edit.ts';
import { childBlocks } from '../../tree.ts';
import { MAX_PAGE_CHARS, pageContextText, pageToMarkdown, richTextToMarkdown, type MdSource } from '../prompts.ts';
import { skillById } from '../skills.ts';
import type { AgentEnv, ToolOutput, ToolRun } from './types.ts';

const iso = (t: number | undefined) => (t ? new Date(t).toISOString().replace(/\.\d+Z$/, 'Z') : '');

function userName(id: string | undefined): string {
  if (!id) return 'Unknown';
  const u = getRecord<UserRecord>('lit_user', id);
  return u?.name || u?.email || 'Unknown';
}

/** Teamspace a block ultimately lives in (null for private / workspace pages). */
function teamOf(blockId: string): string | null {
  let cur = getRecord<BlockRecord>('block', blockId);
  for (let i = 0; i < 200 && cur; i++) {
    if (cur.parent_table === 'team') return cur.parent_id;
    if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const c = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = c ? getRecord<BlockRecord>('block', c.parent_id) : undefined;
    } else return null;
  }
  return null;
}

export const searchWorkspace: ToolRun = async (env, input, stepId) => {
  const query = String(input.query);
  env.step({ id: stepId, tool: 'search_workspace', status: 'running', label: 'Searching', detail: query });
  // the person limited the chat's sources to a page or a teamspace: searches stay inside it
  const pageScope = env.searchScope?.pageId ?? (input.page_id ? normalizeId(input.page_id) : null);
  const teamScope = env.searchScope?.teamId ?? (input.teamspace_id ? String(input.teamspace_id) : null);
  let results = searchPages(env.spaceId, env.userId, query, pageScope || teamScope ? 40 : 8);
  if (pageScope) {
    // with a chosen source the page itself counts too; a page_id argument searches below it
    results = results.filter((r) => (env.searchScope?.pageId && r.pageId === pageScope) || (r.pageId !== pageScope && isAncestor(pageScope, r.pageId)));
  }
  if (teamScope) results = results.filter((r) => teamOf(r.pageId) === teamScope);
  results = results.slice(0, 8);
  const refs = results.map((r) => ({ pageId: r.pageId, title: r.title }));
  env.step({ id: stepId, tool: 'search_workspace', status: 'done', label: 'Searched', detail: query, refs });
  if (!results.length) return { content: `No pages matched "${query}".` };
  const lines = results.map((r) => {
    const n = env.cite({ pageId: r.pageId, title: r.title, ...(r.blockId ? { blockId: r.blockId } : {}) });
    return `[${n}] ${r.title} (page_id: ${r.pageId})${r.snippet ? `\n${r.snippet}` : ''}`;
  });
  return { content: lines.join('\n\n') };
};

export const readPageTool: ToolRun = async (env, input, stepId) => {
  const id = normalizeId(input.page_id);
  const b = getRecord<BlockRecord>('block', id);
  env.step({ id: stepId, tool: 'read_page', status: 'running', label: 'Viewing', detail: blockTitle(b) || undefined });
  const pc = readPage(id, env.userId, { maxChars: MAX_PAGE_CHARS });
  if (!pc) {
    env.step({ id: stepId, tool: 'read_page', status: 'error', label: 'Viewing', error: 'Not found' });
    return { content: 'That page doesn’t exist or the user can’t access it.', isError: true };
  }
  const n = env.cite({ pageId: pc.pageId, title: pc.title });
  env.step({ id: stepId, tool: 'read_page', status: 'done', label: 'Viewed', detail: pc.title, refs: [{ pageId: pc.pageId, title: pc.title }] });
  const role = blockRole(id, env.userId);
  const access = role === 'reader' || role === 'comment_only' ? `\n(The user can ${role === 'reader' ? 'only view' : 'view and comment on'} this page.)` : '';
  return { content: `Source [${n}]${access}\n${pageContextText(pc)}` };
};

/** "Name (select: A | B)" schema line for the model. */
function schemaLine(col: CollectionRecord): string {
  return Object.entries(col.schema).map(([, p]) => {
    const opts = (p.options ?? []).map((o) => o.value);
    return `${p.name} (${p.type}${opts.length ? `: ${opts.slice(0, 30).join(' | ')}` : ''})`;
  }).join(', ');
}

function cell(v: string): string {
  return v.replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim();
}

export const queryDatabase: ToolRun = async (env, input, stepId) => {
  // the person's view of the data source (a linked view of one they can't open is "not found"); only rows and property
  // values they may see (row access, property access) — formulas / rollups are computed from the redacted rows
  const { col, block } = databaseOf(String(input.database_id), env.userId);
  const name = toPlainText(col.name) || 'Untitled database';
  env.step({ id: stepId, tool: 'query_database', status: 'running', label: 'Viewing', detail: name });
  const ctx = aiQueryContext(env.userId);
  const schema = col.schema;
  const pidOf = (nm: string) => Object.keys(schema).find((k) => schema[k].name.toLowerCase() === nm.trim().toLowerCase() || k === nm);
  let rows = visibleRows(col.id, env.userId);
  for (const f of (input.filters ?? []) as { property: string; operator: string; value?: string }[]) {
    const pid = pidOf(f.property);
    if (!pid) return { content: `Unknown property “${f.property}”. Properties: ${schemaLine(col)}`, isError: true };
    const want = (f.value ?? '').trim().toLowerCase();
    rows = rows.filter((r) => {
      const v = getPropertyValue(r, pid, schema, ctx);
      const text = valueToText(v, schema[pid], ctx).toLowerCase();
      const items = text.split(/\s*,\s*/);
      switch (f.operator) {
        case 'equals': return text === want || items.includes(want);
        case 'not_equals': return !(text === want || items.includes(want));
        case 'contains': return text.includes(want);
        case 'is_empty': return isEmptyValue(v);
        case 'is_not_empty': return !isEmptyValue(v);
        case 'before':
        case 'after': {
          const num = valueToNumber(v);
          if (v.kind === 'date' && v.date) return f.operator === 'before' ? v.date.start < (f.value ?? '') : v.date.start > (f.value ?? '');
          if (num !== null && f.value !== undefined && f.value !== '' && Number.isFinite(Number(f.value))) return f.operator === 'before' ? num < Number(f.value) : num > Number(f.value);
          return false;
        }
        default: return true;
      }
    });
  }
  if (input.sort?.property) {
    const pid = pidOf(String(input.sort.property));
    if (pid) {
      const dir = input.sort.direction === 'descending' ? -1 : 1;
      rows = [...rows].sort((a, b) => dir * compareValues(getPropertyValue(a, pid, schema, ctx), getPropertyValue(b, pid, schema, ctx), schema[pid], ctx));
    }
  }
  const total = rows.length;
  const limit = Math.min(200, Number(input.limit) || 50);
  const shown = rows.slice(0, limit);
  const entries = Object.entries(schema);
  const props = [...entries.filter(([, p]) => p.type === 'title'), ...entries.filter(([, p]) => p.type !== 'title')].slice(0, 14);
  const lines = [
    `Database: ${name} (database_id: ${block.id}, ${total} matching row${total === 1 ? '' : 's'}${total > shown.length ? `, showing ${shown.length}` : ''})`,
    `Properties: ${schemaLine(col)}`,
    '',
    `| page_id | ${props.map(([, p]) => cell(p.name)).join(' | ')} |`,
    `| --- | ${props.map(() => '---').join(' | ')} |`,
    ...shown.map((r) => `| ${r.id} | ${props.map(([pid, p]) => cell(valueToText(getPropertyValue(r, pid, schema, ctx), p, ctx))).join(' | ')} |`),
  ];
  const n = env.cite({ pageId: block.id, title: name });
  env.step({ id: stepId, tool: 'query_database', status: 'done', label: 'Viewed', detail: name, refs: [{ pageId: block.id, title: name }] });
  return { content: `Source [${n}]\n${lines.join('\n')}` };
};

/**
 * Comment threads of a page: the page and its real child blocks
 * (tree.ts childBlocks — `content` is client-writable, so a block of another page listed there isn't this page's), never
 * a sub-page's threads: those belong to the sub-page and are read there, with its own access (a restricted sub-page's
 * comments used to come through its parent).
 */
function discussionsOf(page: BlockRecord): DiscussionRecord[] {
  const out: DiscussionRecord[] = [];
  const seen = new Set<string>();
  const walk = (b: BlockRecord | undefined, depth: number) => {
    if (!b || b.alive === false || seen.has(b.id) || depth > 30) return;
    if (depth > 0 && PAGE_TYPES.has(b.type)) return;
    seen.add(b.id);
    for (const did of b.discussions ?? []) {
      const d = getRecord<DiscussionRecord>('discussion', did);
      if (d && d.alive !== false && d.parent_id === b.id) out.push(d);
    }
    for (const c of childBlocks(b)) walk(c, depth + 1);
  };
  walk(page, 0);
  return out;
}

export const readComments: ToolRun = async (env, input, stepId) => {
  const page = readableBlock(String(input.page_id), env.userId);
  const title = blockTitle(page) || 'Untitled';
  env.step({ id: stepId, tool: 'read_comments', status: 'running', label: 'Viewing', detail: title });
  // threads on property values the reader can't see stay hidden
  const threads = discussionsOf(page).filter((d) => (input.include_resolved || !d.resolved) && discussionVisible(d as DiscussionRecord & { property_id?: string }, env.userId));
  const src = mdSource(env.userId);
  const parts = threads.map((d, i) => {
    const comments = (d.comments ?? []).map((cid) => getRecord<CommentRecord>('comment', cid)).filter((c): c is CommentRecord => !!c && c.alive !== false);
    const ctxText = d.context ? toPlainText(d.context).slice(0, 200) : d.parent_id !== page.id ? toPlainText(getRecord<BlockRecord>('block', d.parent_id)?.properties?.title).slice(0, 200) : '';
    return [
      `Thread ${i + 1}${d.resolved ? ' (resolved)' : ''}${ctxText ? ` on “${ctxText}”` : ' on the page'}:`,
      ...comments.map((c) => `- ${userName(c.created_by_id)} (${iso(c.created_time)}): ${richTextToMarkdown(c.text, src, { plain: true })}`),
    ].join('\n');
  });
  env.step({ id: stepId, tool: 'read_comments', status: 'done', label: 'Reviewed comments on', detail: title, refs: [{ pageId: page.id, title }] });
  return { content: parts.length ? `Comments on “${title}” (page_id: ${page.id}):\n\n${parts.join('\n\n')}` : `“${title}” has no ${input.include_resolved ? '' : 'open '}comments.` };
};

export const viewVersionHistory: ToolRun = async (env, input, stepId) => {
  const page = readableBlock(String(input.page_id), env.userId);
  const title = blockTitle(page) || 'Untitled';
  // like Version history: Can edit or more — old versions hold deleted text
  if (!roleAtLeast(blockRole(page.id, env.userId), 'read_and_write')) throw new AiError('forbidden', `The user can’t see the version history of “${title}”: it needs edit access to the page.`, 403);
  env.step({ id: stepId, tool: 'view_version_history', status: 'running', label: 'Opening version history', detail: title });
  if (input.version_id) {
    const snap = getSnapshot(String(input.version_id));
    if (!snap || snap.pageId !== page.id) return { content: 'That version doesn’t exist for this page.', isError: true };
    // the version as the preview shows it to this person (versionAccess.ts): rows, values, "No access" properties
    // and restricted sub-pages hidden from them today stay out
    const data = redactVersionData(page.id, snap.data ?? {}, env.userId);
    const blocks = new Map<string, BlockRecord>(((data.blocks ?? []) as BlockRecord[]).map((b) => [b.id, b] as [string, BlockRecord]));
    const live = mdSource(env.userId);
    const src: MdSource = { ...live, block: (id) => (blocks.get(id) as any) ?? undefined, pageTitle: (id) => (blocks.has(id) ? blockTitle(blocks.get(id)) : live.pageTitle(id)) };
    const md = pageToMarkdown(page.id, src, { maxChars: MAX_PAGE_CHARS });
    env.step({ id: stepId, tool: 'view_version_history', status: 'done', label: 'Checked version history', detail: title, refs: [{ pageId: page.id, title }] });
    return { content: `Version ${snap.id} of “${title}” saved ${iso(snap.createdTime)} by ${snap.authorIds.map(userName).join(', ') || 'Unknown'}:\n\n${md.markdown}` };
  }
  const versions = listSnapshots(page.id, 30) as { id: string; createdTime: number; authorIds: string[] }[];
  env.step({ id: stepId, tool: 'view_version_history', status: 'done', label: 'Checked version history', detail: title, refs: [{ pageId: page.id, title }] });
  if (!versions.length) return { content: `“${title}” has no saved versions yet.` };
  return {
    content: `Versions of “${title}” (newest first):\n${versions.map((v) => `- version_id ${v.id}: ${iso(v.createdTime)} by ${(v.authorIds ?? []).map(userName).join(', ') || 'Unknown'}`).join('\n')}\n\nCall again with version_id to read one.`,
  };
};

export const listPeople: ToolRun = async (env, input, stepId) => {
  env.step({ id: stepId, tool: 'list_people', status: 'running', label: 'Viewing', detail: 'People' });
  const space = getRecord<SpaceRecord>('space', env.spaceId);
  const q = String(input.query ?? '').trim().toLowerCase();
  const people = (space?.permissions ?? []).filter((p) => p.user_id && p.role !== 'none').map((p) => ({ u: getRecord<UserRecord>('lit_user', p.user_id!), role: p.role }))
    .filter((x): x is { u: UserRecord; role: any } => !!x.u)
    .filter(({ u }) => !q || (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q))
    .slice(0, 50);
  env.step({ id: stepId, tool: 'list_people', status: 'done', label: 'Viewed', detail: `${people.length} ${people.length === 1 ? 'person' : 'people'}` });
  if (!people.length) return { content: 'No workspace members matched.' };
  return { content: people.map(({ u, role }) => `- ${u.name || u.email} (user_id: ${u.id}${u.email ? `, ${u.email}` : ''}${u.id === env.userId ? ', this is the user' : ''}, ${role})`).join('\n') };
};

export function notificationsOf(userId: string, spaceId: string): NotificationRecord[] {
  return (db.prepare(`SELECT data FROM records WHERE tbl = 'notification' AND json_extract(data, '$.user_id') = ?`).all(userId) as { data: string }[])
    .map((r) => JSON.parse(r.data) as NotificationRecord)
    .filter((n) => n.space_id === spaceId)
    .sort((a, b) => b.created_time - a.created_time);
}

export const listNotifications: ToolRun = async (env, input, stepId) => {
  env.step({ id: stepId, tool: 'list_notifications', status: 'running', label: 'Viewing', detail: 'Inbox' });
  let list = notificationsOf(env.userId, env.spaceId).filter((n) => input.include_archived || !n.archived);
  if (input.unread_only) list = list.filter((n) => !n.read);
  list = list.slice(0, Math.min(100, Number(input.limit) || 40));
  env.step({ id: stepId, tool: 'list_notifications', status: 'done', label: 'Viewed', detail: `${list.length} notification${list.length === 1 ? '' : 's'}` });
  if (!list.length) return { content: 'The inbox is empty.' };
  return {
    content: list.map((n) => {
      const page = n.navigable_block_id && canRead(n.navigable_block_id, env.userId) ? blockTitle(getRecord<BlockRecord>('block', n.navigable_block_id)) || 'Untitled' : '';
      const text = typeof n.activity?.text === 'string' ? (n.activity.text as string).slice(0, 160) : '';
      return `- notification_id ${n.id}: ${n.type}${n.read ? '' : ' (unread)'}${n.archived ? ' (archived)' : ''}, ${iso(n.created_time)}, from ${userName(n.actor_id)}${page ? ` on “${page}”` : ''}${text ? `: ${text}` : ''}`;
    }).join('\n'),
  };
};

export const useSkill: ToolRun = async (env, input, stepId) => {
  const skill = skillById(String(input.skill_id), env.userId, env.spaceId);
  if (!skill) return { content: 'That skill doesn’t exist or isn’t enabled for the user.', isError: true };
  env.step({ id: stepId, tool: 'use_skill', status: 'done', label: 'Viewed', detail: skill.name, refs: skill.pageId ? [{ pageId: skill.pageId, title: skill.name }] : [] });
  return { content: `Skill “${skill.name}”. Follow these instructions:\n\n${skill.instructions}` };
};

export function teamName(id: string): string {
  return getRecord<TeamRecord>('team', id)?.name ?? '';
}

export const READ_TOOL_RUNS: Record<string, ToolRun> = {
  search_workspace: searchWorkspace,
  read_page: readPageTool,
  query_database: queryDatabase,
  read_comments: readComments,
  view_version_history: viewVersionHistory,
  list_people: listPeople,
  list_notifications: listNotifications,
  use_skill: useSkill,
};

export type { AgentEnv, ToolOutput };
export { AiError };

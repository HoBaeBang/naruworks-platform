// Write tools of the agent. Each tool plans its change first (permission checks with friendly errors, operations,
// an approval preview and the pages it touches), asks for approval when the approval mode requires it, then
// applies the operations as the acting user through changes.ts (applyTransactions with client-level checks,
// realtime broadcast, Undo log). A declined approval leaves the workspace untouched.
import { newId } from '@nc/shared/ids.ts';
import { op as mk, type Operation } from '@nc/shared/ops.ts';
import type { BlockRecord, CollectionRecord, DiscussionRecord, PropertySchema, UserSettingsRecord } from '@nc/shared/records.ts';
import { slice as sliceText, toPlainText, type Decoration, type RichText } from '@nc/shared/richtext.ts';
import { suggestEdit } from '@nc/shared/richtextSuggest.ts';
import { getRecord } from '../../db.ts';
import { OpsBuilder, shortPropId, type Spec } from '../../content/spec.ts';
import { handlers as commentHandlers } from '../../api/modules/comments.ts';
import { AiError } from '../client.ts';
import { applyAgentOps, type TouchedPage } from '../changes.ts';
import { blockTitle } from '../context.ts';
import {
  addViewOps, canComment, canEditRow, canEditStructure, countBlocks, databaseOf, databaseSpec, deleteOps, editableBlock, encodeValues, inlineRichText, SPECIAL_VIEW_TYPES, specialViewOps, type AgentViewInput,
  formulaPatch, insertSpecs, isAncestor, markdownToSpecs, matchSelection, moveOps, normalizeId, pageUnits, placeUnder, readableBlock, resolveParent, resolvePeople,
  spaceViewOf, textRange, viewsOf, type Parent, type PropertyInput,
} from '../edit.ts';
import { notificationsOf } from './read.ts';
import { discussionVisible, visibleCollection } from '../visibility.ts';
import type { AgentEnv, ApprovalPayload, Risk, StepRef, ToolOutput, ToolRun } from './types.ts';
import { listMessages } from '../threads.ts';
import { readStoredFile } from '../../content/files.ts';
import { csvToDb } from '../../content/csv.ts';

const MAX_BLOCKS_PER_CALL = 3000;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('{n}', String(n)));
const clip = (s: string, n = 4000) => (s.length > n ? `${s.slice(0, n)}\n…` : s);

interface Plan {
  tool: string;
  ops: Operation[];
  pages: TouchedPage[];
  risk: Risk;
  approval: Omit<ApprovalPayload, 'id'>;
  running: string;
  done: string;
  /** label when declined (the "undone" form, e.g. "Create page") */
  declined: string;
  detail?: string;
  result: (applied: boolean) => string;
  after?: () => void;
}

/** Approval → apply → step events. Errors from planning are thrown before this (reported by the registry). */
async function execute(env: AgentEnv, stepId: string, plan: Plan): Promise<ToolOutput> {
  const refs: StepRef[] = plan.pages.filter((p) => p.pageId).map((p) => ({ pageId: p.pageId, title: p.title }));
  env.step({ id: stepId, tool: plan.tool, status: 'running', label: plan.running, detail: plan.detail, refs });
  const decision = await env.approve({ tool: plan.tool, stepId, risk: plan.risk, payload: plan.approval });
  if (decision !== 'accept') {
    env.step({ id: stepId, tool: plan.tool, status: 'declined', label: plan.declined, detail: plan.detail, refs });
    return { content: 'The user rejected this change, so nothing was changed. Do not retry it; ask the user how they would like to proceed.' };
  }
  if (plan.ops.length) {
    applyAgentOps({ userId: env.userId, spaceId: env.spaceId, turnId: env.turnId, threadId: env.threadId, clientId: env.clientId, source: env.source }, plan.tool, plan.ops, plan.pages);
    env.touched(plan.pages);
  }
  plan.after?.();
  env.step({ id: stepId, tool: plan.tool, status: 'done', label: plan.done, detail: plan.detail, refs });
  return { content: plan.result(true) };
}

function touch(ptr: { id: string; spaceId: string }, userId: string): Operation {
  return mk.update({ table: 'block', id: ptr.id, spaceId: ptr.spaceId }, [], { last_edited_time: Date.now(), last_edited_by_id: userId, last_edited_by_table: 'lit_user' });
}

function isDatabase(b: BlockRecord | undefined): boolean {
  return b?.type === 'collection_view_page' || b?.type === 'collection_view';
}

// ---------------------------------------------------------------------------------------------
// create_pages

export const createPages: ToolRun = async (env, input, stepId) => {
  const pages = input.pages as { title?: string; icon?: string; content?: string; properties?: Record<string, unknown> }[];
  const parent = resolveParent(input.parent, env.userId, env.spaceId, null);
  const b = new OpsBuilder(parent.spaceId, env.userId);
  const created: { id: string; title: string }[] = [];
  let blocks = 0;
  if (parent.kind === 'database') {
    const { col, block } = databaseOf(parent.collectionId, env.userId);
    const working: CollectionRecord = { ...col, schema: { ...col.schema } };
    const patched = new Set<string>();
    const errors: string[] = [];
    for (const p of pages) {
      const values: Record<string, unknown> = { ...(p.properties ?? {}) };
      const titleName = (Object.values(working.schema).find((x) => x.type === 'title')?.name ?? 'Name').toLowerCase();
      if (p.title !== undefined && !Object.keys(values).some((k) => k === 'title' || k.toLowerCase() === titleName)) values.title = p.title;
      const enc = encodeValues(working, values, env.userId);
      errors.push(...enc.errors);
      for (const [pid, prop] of Object.entries(enc.schemaPatch)) {
        working.schema[pid] = prop;
        patched.add(pid);
      }
      const props = { ...enc.properties };
      const titleKey = Object.keys(working.schema).find((x) => working.schema[x].type === 'title') ?? 'title';
      const title = enc.title ?? props[titleKey] ?? (p.title ? inlineRichText(p.title) : []);
      delete props[titleKey];
      delete props.title;
      const children = markdownToSpecs(p.content ?? '');
      blocks += countBlocks(children) + 1;
      const id = b.block({ type: 'page', text: title, props, icon: p.icon, children }, col.id, 'collection');
      for (const v of viewsOf(block)) if (v.page_sort?.length) b.ops.push(mk.listAfter({ table: 'collection_view', id: v.id, spaceId: block.space_id }, ['page_sort'], id));
      created.push({ id, title: toPlainText(title) || 'Untitled' });
    }
    if (errors.length) throw new AiError('bad_request', [...new Set(errors)].join(' '), 400);
    for (const pid of patched) b.ops.unshift(mk.set({ table: 'collection', id: col.id, spaceId: block.space_id }, ['schema', pid], working.schema[pid]));
  } else {
    if (pages.some((p) => p.properties && Object.keys(p.properties).length)) {
      throw new AiError('bad_request', 'properties only apply to database rows: create them with parent {"type": "database", "id": …}.', 400);
    }
    // private pages are prepended: create in reverse so they keep the given order at the top
    const order = parent.kind === 'private' ? [...pages].reverse() : pages;
    const made: { id: string; title: string }[] = [];
    for (const p of order) {
      const children = markdownToSpecs(p.content ?? '');
      blocks += countBlocks(children) + 1;
      const spec: Spec = { type: 'page', text: p.title ? inlineRichText(p.title) : [], icon: p.icon, children };
      made.push({ id: placeUnder(b, parent, env.userId, spec), title: p.title?.trim() || 'Untitled' });
    }
    created.push(...(parent.kind === 'private' ? made.reverse() : made));
  }
  if (blocks > MAX_BLOCKS_PER_CALL) throw new AiError('bad_request', `That is too much content for one call (${blocks} blocks). Create the pages in smaller parts.`, 400);
  if (parent.kind === 'page') b.ops.push(touch({ id: parent.id, spaceId: parent.spaceId }, env.userId));
  const n = created.length;
  const where = parent.kind === 'private' ? 'Private' : parent.title;
  const first = pages[0];
  return execute(env, stepId, {
    tool: 'create_pages',
    ops: b.ops,
    pages: created.map((c) => ({ pageId: c.id, title: c.title, action: 'created' })),
    risk: 'edit',
    approval: {
      title: n === 1 ? `Create page “${created[0].title}”` : `Create ${n} pages`,
      description: `In ${where}`,
      markdown: n === 1 ? clip(first.content ?? '') : created.map((c) => `- ${c.title}`).join('\n'),
      properties: n === 1 && first.properties ? Object.entries(first.properties).map(([k, v]) => ({ name: k, value: Array.isArray(v) ? v.join(', ') : String(v) })) : undefined,
      pages: created.map((c) => ({ title: c.title })),
      confirmLabel: 'Continue',
    },
    running: 'Creating pages',
    done: plural(n, 'Added 1 page', 'Added {n} pages'),
    declined: plural(n, 'Add page', 'Add {n} pages'),
    detail: n === 1 ? created[0].title : undefined,
    result: () => `${created.map((c) => `Created “${c.title}” (page_id: ${c.id})`).join('\n')}${parent.kind === 'database' ? `\nIn the database “${parent.title}”.` : ''}`,
  });
};

// ---------------------------------------------------------------------------------------------
// update_page

function propertyText(v: unknown): string {
  return Array.isArray(v) ? v.join(', ') : v && typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
}

// Suggested edits  the agent writes instead of changing the text, when the user asks it to "suggest edits"
// or can only comment: ["sr", id] marks the replaced text, ["si", id] the new text, and a "suggestion" discussion on
// the block stands for the change — the user accepts or rejects each one on the page.
const SUGGESTABLE = new Set(['text', 'to_do', 'header', 'sub_header', 'sub_sub_header', 'header_4', 'bulleted_list', 'numbered_list']);
const plainInline = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/(\*\*|__|~~|`)/g, '').replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|$)/g, '$1$2').replace(/\s*\n+\s*/g, ' ');

async function suggestPageEdit(env: AgentEnv, input: Record<string, any>, stepId: string): Promise<ToolOutput> {
  const page = readableBlock(String(input.page_id), env.userId);
  const title = blockTitle(page) || 'Untitled';
  if (!canComment(page.id, env.userId)) throw new AiError('forbidden', `The user can only view “${title}”, so they can’t suggest edits.`, 403);
  if (String(input.command) !== 'replace_content_range' || !input.selection_with_ellipsis) {
    throw new AiError('bad_request', 'Suggested edits change text inside one block: use command "replace_content_range" with selection_with_ellipsis and new_str (one call per block; an empty new_str suggests removing the text).', 400);
  }
  const sel = String(input.selection_with_ellipsis);
  const units = pageUnits(page.id, env.userId);
  const { first, last } = matchSelection(units, sel);
  if (first !== last) throw new AiError('bad_request', 'A suggested edit must stay inside one block. Make one update_page call per block.', 400);
  const blk = getRecord<BlockRecord>('block', units[first].id);
  if (!blk || !SUGGESTABLE.has(blk.type)) throw new AiError('bad_request', 'Suggestions are only possible in text, to-do, heading and list blocks.', 400);
  const prev = (blk.properties?.title ?? []) as RichText;
  const range = textRange(prev, sel);
  if (!range) throw new AiError('bad_request', 'Couldn’t find that text inside the block. Quote its plain text exactly (without Markdown or mentions).', 400);
  const inserted = plainInline(typeof input.new_str === 'string' ? input.new_str : '').trim();
  const did = newId();
  const cid = newId();
  const r = suggestEdit(prev, range.start, range.end, inserted, { insertId: did, removeId: did, mine: () => false });
  if (!r.used.length) throw new AiError('bad_request', 'Nothing to suggest: the new text is the same.', 400);
  const spaceId = blk.space_id;
  const now = Date.now();
  const removedText = toPlainText(prev.length ? sliceText(prev, range.start, range.end) : []);
  const ops: Operation[] = [
    mk.set({ table: 'discussion', id: did, spaceId }, [], {
      id: did, parent_id: blk.id, parent_table: 'block', resolved: false, comments: [], space_id: spaceId, alive: true, type: 'suggestion',
      created_by_id: env.userId, created_by_table: 'lit_user', created_time: now,
    }),
    mk.listAfter({ table: 'block', id: blk.id, spaceId }, ['discussions'], did),
    mk.set({ table: 'comment', id: cid, spaceId }, [], {
      id: cid, parent_id: did, parent_table: 'discussion', text: [], suggestion: true, created_by_id: env.userId, created_by_table: 'lit_user',
      created_time: now, last_edited_time: now, alive: true, space_id: spaceId,
    }),
    mk.listAfter({ table: 'discussion', id: did, spaceId }, ['comments'], cid),
    mk.set({ table: 'block', id: blk.id, spaceId }, ['properties', 'title'], r.value),
  ];
  const what = inserted && removedText ? `replace “${clip(removedText, 80)}” with “${clip(inserted, 80)}”` : inserted ? `add “${clip(inserted, 80)}”` : `remove “${clip(removedText, 80)}”`;
  return execute(env, stepId, {
    tool: 'update_page',
    ops,
    pages: [{ pageId: page.id, title, action: 'updated' }],
    risk: 'edit',
    approval: { title: `Suggest edits on “${title}”`, description: `Suggest to ${what}.`, pages: [{ pageId: page.id, title }], confirmLabel: 'Continue' },
    running: 'Suggesting edits',
    done: 'Suggested edits',
    declined: 'Suggest edits',
    detail: title,
    result: () => `Suggested to ${what} in “${title}”. It shows on the page as a suggested edit the user can accept or reject.`,
  });
}

export const updatePage: ToolRun = async (env, input, stepId) => {
  if (input.suggest === true) return suggestPageEdit(env, input, stepId);
  const page = editableBlock(String(input.page_id), env.userId);
  const title = blockTitle(page) || 'Untitled';
  const spaceId = page.space_id;
  const ptr = { table: 'block' as const, id: page.id, spaceId };
  const b = new OpsBuilder(spaceId, env.userId);
  const command = String(input.command);
  let risk: Risk = 'edit';
  const approval: Omit<ApprovalPayload, 'id'> = { title: `Update “${title}”`, pages: [{ pageId: page.id, title }], confirmLabel: 'Continue' };
  let summary = '';
  if (command === 'update_properties') {
    const props: { name: string; value: string }[] = [];
    if (typeof input.title === 'string') {
      if (isDatabase(page) && page.collection_id) b.ops.push(mk.set({ table: 'collection', id: page.collection_id, spaceId }, ['name'], inlineRichText(input.title)));
      else b.ops.push(mk.set(ptr, ['properties', 'title'], inlineRichText(input.title)));
      props.push({ name: 'Title', value: input.title });
    }
    if (typeof input.icon === 'string' && input.icon.trim()) {
      const icon = input.icon.trim();
      if (/^(https?:|javascript:|data:)/i.test(icon) || icon.length > 16) throw new AiError('bad_request', 'icon must be an emoji.', 400);
      b.ops.push(mk.update(ptr, ['format'], { page_icon: icon }));
      props.push({ name: 'Icon', value: icon });
    }
    if (input.properties && Object.keys(input.properties).length) {
      if (page.parent_table !== 'collection') throw new AiError('bad_request', `“${title}” isn’t a database row, so it has no properties. Use title / icon, or edit the content.`, 400);
      // property names are matched against (and errors list) only the properties this person may see: "No access"
      // properties don't exist for them
      const col = visibleCollection(getRecord<CollectionRecord>('collection', page.parent_id), env.userId);
      if (!col) throw new AiError('not_found', 'The row’s database no longer exists.', 404);
      const enc = encodeValues(col, input.properties, env.userId);
      if (enc.errors.length) throw new AiError('bad_request', [...new Set(enc.errors)].join(' '), 400);
      for (const [pid, prop] of Object.entries(enc.schemaPatch)) b.ops.push(mk.set({ table: 'collection', id: col.id, spaceId }, ['schema', pid], prop));
      for (const [pid, v] of Object.entries(enc.properties)) b.ops.push(mk.set(ptr, ['properties', col.schema[pid]?.type === 'title' ? 'title' : pid], v));
      for (const [k, v] of Object.entries(input.properties)) props.push({ name: k, value: propertyText(v) });
    }
    if (!b.ops.length) throw new AiError('bad_request', 'Nothing to update: give title, icon or properties.', 400);
    approval.properties = props;
    summary = `Updated ${props.map((p) => p.name).join(', ')} of “${title}”.`;
  } else {
    if (isDatabase(page)) throw new AiError('bad_request', `“${title}” is a database: add rows with create_pages (parent type "database") and change its schema with update_database.`, 400);
    const newStr = typeof input.new_str === 'string' ? input.new_str : '';
    const specs = markdownToSpecs(newStr);
    if (command !== 'replace_content' && command !== 'replace_content_range' && !specs.length) throw new AiError('bad_request', 'new_str is empty.', 400);
    if (countBlocks(specs) > MAX_BLOCKS_PER_CALL) throw new AiError('bad_request', 'That is too much content for one call. Split it into smaller edits.', 400);
    const units = pageUnits(page.id, env.userId);
    let removed: string[] = [];
    if (command === 'append_content') {
      const last = [...(page.content ?? [])].reverse().find((id) => getRecord<BlockRecord>('block', id)?.alive !== false);
      insertSpecs(b, page.id, specs, last ? { after: last } : { first: true });
      summary = `Added ${countBlocks(specs)} block(s) at the end of “${title}”.`;
    } else if (command === 'insert_content_after') {
      if (!input.selection_with_ellipsis) throw new AiError('bad_request', 'insert_content_after needs selection_with_ellipsis.', 400);
      const m = matchSelection(units, String(input.selection_with_ellipsis));
      insertSpecs(b, page.id, specs, { after: units[m.last].id });
      summary = `Inserted ${countBlocks(specs)} block(s) into “${title}”.`;
    } else if (command === 'replace_content_range' || command === 'replace_content') {
      let first = 0;
      let last = units.length - 1;
      if (command === 'replace_content_range') {
        if (!input.selection_with_ellipsis) throw new AiError('bad_request', 'replace_content_range needs selection_with_ellipsis.', 400);
        ({ first, last } = matchSelection(units, String(input.selection_with_ellipsis)));
      }
      const target = units.slice(first, Math.max(first, last + 1));
      removed = target.map((u) => u.markdown);
      const before = first > 0 ? units[first - 1].id : undefined;
      if (specs.length) insertSpecs(b, page.id, specs, before ? { after: before } : { first: true });
      const dead = target.map((u) => getRecord<BlockRecord>('block', u.id)).filter((x): x is BlockRecord => !!x);
      b.ops.push(...deleteOps(dead, env.userId));
      // removing sub-pages / databases or a lot of existing content is a potentially unsafe action
      if (dead.some((x) => x.type === 'page' || isDatabase(x)) || dead.length > 8) risk = 'destructive';
      summary = command === 'replace_content' ? `Replaced the content of “${title}”.` : `Replaced ${dead.length} block(s) in “${title}”.`;
    } else {
      throw new AiError('bad_request', `Unknown command ${command}.`, 400);
    }
    approval.markdown = clip(newStr);
    if (removed.length) approval.removed = removed.map((r) => clip(r, 1500)).slice(0, 30);
  }
  b.ops.push(touch({ id: page.id, spaceId }, env.userId));
  return execute(env, stepId, {
    tool: 'update_page',
    ops: b.ops,
    pages: [{ pageId: page.id, title: typeof input.title === 'string' && command === 'update_properties' ? input.title : title, action: 'updated', database: isDatabase(page) }],
    risk,
    approval: { ...approval, danger: risk === 'destructive' },
    running: 'Updating page',
    done: 'Updated 1 page',
    declined: 'Update page',
    detail: title,
    result: () => summary,
  });
};

// ---------------------------------------------------------------------------------------------
// delete_pages / move_pages

export const deletePages: ToolRun = async (env, input, stepId) => {
  const ids = [...new Set((input.page_ids as string[]).map(normalizeId))];
  const blocks = ids.map((id) => editableBlock(id, env.userId));
  const dbs = blocks.filter(isDatabase).length;
  const pagesN = blocks.length - dbs;
  const title = dbs && pagesN
    ? `Delete ${plural(pagesN, '1 page', '{n} pages')} and ${plural(dbs, '1 database', '{n} databases')}?`
    : dbs ? `Delete ${plural(dbs, '1 database', '{n} databases')}?` : `Delete ${plural(pagesN, '1 page', '{n} pages')}?`;
  const list = blocks.map((b) => ({ pageId: b.id, title: blockTitle(b) || 'Untitled', action: 'deleted' as const, database: isDatabase(b) }));
  const n = blocks.length;
  return execute(env, stepId, {
    tool: 'delete_pages',
    ops: deleteOps(blocks, env.userId),
    pages: list,
    risk: 'destructive',
    approval: { title, pages: list.map((p) => ({ title: p.title })), confirmLabel: dbs ? 'Delete' : 'Move pages to Trash', danger: true },
    running: 'Moving pages to Trash',
    done: plural(n, 'Moved 1 page to Trash', 'Moved {n} pages to Trash'),
    declined: plural(n, 'Move page to Trash', 'Move {n} pages to Trash'),
    detail: n === 1 ? list[0].title : undefined,
    result: () => `Moved to Trash: ${list.map((p) => `“${p.title}”`).join(', ')}. The user can restore them from Trash.`,
  });
};

/** private:<user> / team:<id> / space — moving between scopes changes who can see a page. */
function scopeOf(blockId: string): string {
  let cur = getRecord<BlockRecord>('block', blockId);
  for (let i = 0; i < 200 && cur; i++) {
    if (cur.parent_table === 'team') return `team:${cur.parent_id}`;
    if (cur.parent_table === 'space') return (cur.permissions ?? []).some((p) => p.type === 'user_permission') && !(cur.permissions ?? []).some((p) => p.type === 'space_permission') ? `private:${cur.id}` : 'space';
    if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const c = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = c ? getRecord<BlockRecord>('block', c.parent_id) : undefined;
    } else break;
  }
  return 'space';
}

function parentScope(p: Parent): string {
  if (p.kind === 'private') return 'private:new';
  if (p.kind === 'teamspace') return `team:${p.id}`;
  return scopeOf(p.kind === 'page' ? p.id : p.blockId);
}

export const movePages: ToolRun = async (env, input, stepId) => {
  const parent = resolveParent(input.new_parent, env.userId, env.spaceId, null);
  const ids = [...new Set((input.page_ids as string[]).map(normalizeId))];
  const ops: Operation[] = [];
  const moved: TouchedPage[] = [];
  let risk: Risk = 'edit';
  const target = parent.kind === 'page' ? parent.id : parent.kind === 'database' ? parent.blockId : null;
  for (const id of ids) {
    const page = editableBlock(id, env.userId);
    if (target && isAncestor(page.id, target)) throw new AiError('bad_request', `“${blockTitle(page) || 'Untitled'}” can’t be moved into itself or one of its sub-pages.`, 400);
    if (page.type !== 'page' && !isDatabase(page)) throw new AiError('bad_request', 'Only pages and databases can be moved with move_pages.', 400);
    const from = scopeOf(page.id);
    const to = parentScope(parent);
    if (from !== to && !(from.startsWith('private:') && to === 'private:new')) risk = 'share';
    ops.push(...moveOps(page, parent, env.userId));
    moved.push({ pageId: page.id, title: blockTitle(page) || 'Untitled', action: 'moved', database: isDatabase(page) });
  }
  const where = parent.kind === 'private' ? 'Private' : parent.title;
  const n = moved.length;
  return execute(env, stepId, {
    tool: 'move_pages',
    ops,
    pages: moved,
    risk,
    approval: { title: n === 1 ? `Move “${moved[0].title}” to ${where}` : `Move ${n} pages to ${where}`, description: risk === 'share' ? 'People who can access this to the new location will be able to see the moved pages.' : undefined, pages: moved.map((m) => ({ title: m.title })), confirmLabel: 'Continue' },
    running: 'Moving pages',
    done: plural(n, 'Moved 1 page', 'Moved {n} pages'),
    declined: plural(n, 'Move page', 'Move {n} pages'),
    detail: n === 1 ? moved[0].title : where,
    result: () => `Moved ${moved.map((m) => `“${m.title}”`).join(', ')} to ${where}.`,
  });
};

// ---------------------------------------------------------------------------------------------
// Databases

/** Schema entries built the way OpsBuilder does (select colors, status groups, number format). */
function buildProps(defs: PropertyInput[], spaceId: string): Record<string, PropertySchema> {
  const tmp = new OpsBuilder(spaceId, '');
  const schema: Record<string, { name: string; type: any; options?: string[] }> = {};
  const formulas: Record<string, string> = {};
  for (const d of defs) {
    const pid = shortPropId();
    schema[pid] = { name: d.name.trim().slice(0, 100), type: d.type, ...(d.options?.length ? { options: d.options.map((o) => String(o).slice(0, 100)) } : {}) };
    if (d.type === 'formula') formulas[pid] = String(d.expression ?? '').slice(0, 2000);
  }
  tmp.database({ name: '', schema: schema as any, rows: [], views: [] }, 'tmp');
  const colOp = tmp.ops.find((o) => o.pointer.table === 'collection');
  const built = ((colOp?.args as { schema?: Record<string, PropertySchema> })?.schema) ?? {};
  for (const [pid, expression] of Object.entries(formulas)) if (built[pid]) built[pid] = { ...built[pid], formula: { expression } };
  return built;
}

export const createDatabase: ToolRun = async (env, input, stepId) => {
  const parent = resolveParent(input.parent, env.userId, env.spaceId, null);
  if (parent.kind === 'database') throw new AiError('bad_request', 'A database cannot be created inside another database. Use a page, team, or private parent.', 400);
  const inline = !!input.inline && parent.kind === 'page';
  const title = String(input.title).trim().slice(0, 200) || 'Untitled database';
  // charts, forms and dashboards are added after the data source exists
  const allViews = (input.views ?? []) as AgentViewInput[];
  const special = allViews.filter((v) => SPECIAL_VIEW_TYPES.has(v.type));
  const { spec, ids } = databaseSpec(title, (input.properties ?? []) as PropertyInput[], allViews.filter((v) => !SPECIAL_VIEW_TYPES.has(v.type)), input.rows ?? []);
  const b = new OpsBuilder(parent.spaceId, env.userId);
  const id = placeUnder(b, parent, env.userId, { type: inline ? 'collection_view' : 'collection_view_page', db: spec });
  if (special.length) {
    const colOp = b.ops.find((o) => o.pointer.table === 'collection');
    const schema = ((colOp?.args as { schema?: Record<string, PropertySchema> } | undefined)?.schema ?? {}) as Record<string, PropertySchema>;
    for (const v of special) b.ops.push(...specialViewOps(parent.spaceId, id, colOp?.pointer.id ?? '', schema, v, env.userId).ops);
  }
  const formulas = formulaPatch(ids, (input.properties ?? []) as PropertyInput[]);
  if (Object.keys(formulas).length) {
    const colOp = b.ops.find((o) => o.pointer.table === 'collection');
    const schema = (colOp?.args as { schema?: Record<string, Record<string, unknown>> } | undefined)?.schema;
    for (const [pid, f] of Object.entries(formulas)) if (schema?.[pid]) schema[pid].formula = f;
  }
  if (parent.kind === 'page') b.ops.push(touch({ id: parent.id, spaceId: parent.spaceId }, env.userId));
  const where = parent.kind === 'private' ? 'Private' : parent.title;
  const props = Object.values(spec.schema).map((p) => ({ name: p.name, value: `${p.type}${p.options?.length ? `: ${p.options.map((o) => (typeof o === 'string' ? o : o.value)).join(', ')}` : ''}` }));
  return execute(env, stepId, {
    tool: 'create_database',
    ops: b.ops,
    pages: [{ pageId: id, title, action: 'created', database: true }],
    risk: 'edit',
    approval: { title: `Create database “${title}”`, description: `In ${where}${inline ? ' (inline)' : ''} · ${spec.rows.length} row(s) · ${spec.views.map((v) => v.type).join(', ')}`, properties: props, pages: [{ title }], confirmLabel: 'Continue' },
    running: 'Creating database',
    done: 'Created database',
    declined: 'Create database',
    detail: title,
    result: () => `Created the database “${title}” (database_id: ${id}) with properties ${Object.values(spec.schema).map((p) => `${p.name} (${p.type})`).join(', ')}${spec.rows.length ? ` and ${spec.rows.length} row(s)` : ''}. Add rows with create_pages and parent {"type": "database", "id": "${id}"}.`,
  });
};

export const updateDatabase: ToolRun = async (env, input, stepId) => {
  const { col, block } = databaseOf(String(input.database_id), env.userId);
  const name = toPlainText(col.name) || 'Untitled database';
  if (!canEditStructure(block, env.userId)) throw new AiError('forbidden', block.format?.block_locked ? `The database “${name}” is locked, so its properties and views can’t change.` : `The user can’t change the structure of “${name}”.`, 403);
  const spaceId = block.space_id;
  const cptr = { table: 'collection' as const, id: col.id, spaceId };
  const ops: Operation[] = [];
  const changes: { name: string; value: string }[] = [];
  let risk: Risk = 'edit';
  const byName = (n: string) => Object.keys(col.schema).find((k) => col.schema[k].name.toLowerCase() === n.trim().toLowerCase());
  if (typeof input.title === 'string' && input.title.trim()) {
    ops.push(mk.set(cptr, ['name'], inlineRichText(input.title)));
    changes.push({ name: 'Rename database', value: input.title.trim() });
  }
  const adds = ((input.add_properties ?? []) as PropertyInput[]).filter((p) => p.type !== 'title');
  for (const p of adds) if (byName(p.name)) throw new AiError('bad_request', `A property named “${p.name}” already exists.`, 400);
  const built = buildProps(adds, spaceId);
  for (const [pid, prop] of Object.entries(built)) {
    ops.push(mk.set(cptr, ['schema', pid], prop));
    changes.push({ name: 'Add property', value: `${prop.name} (${prop.type})` });
  }
  for (const r of (input.rename_properties ?? []) as { from: string; to: string }[]) {
    const pid = byName(r.from);
    if (!pid) throw new AiError('bad_request', `Unknown property “${r.from}”.`, 400);
    ops.push(mk.set(cptr, ['schema', pid, 'name'], r.to.trim().slice(0, 100)));
    changes.push({ name: 'Rename property', value: `${r.from} → ${r.to}` });
  }
  for (const d of (input.delete_properties ?? []) as string[]) {
    const pid = byName(d);
    if (!pid) throw new AiError('bad_request', `Unknown property “${d}”.`, 400);
    if (col.schema[pid].type === 'title') throw new AiError('bad_request', 'The title property can’t be deleted.', 400);
    ops.push(mk.set(cptr, ['schema', pid], undefined));
    changes.push({ name: 'Delete property', value: col.schema[pid].name });
    risk = 'destructive';
  }
  // new properties show up in table views (they are added as visible columns)
  if (Object.keys(built).length) {
    for (const v of viewsOf(block)) {
      if (v.type !== 'table') continue;
      const tp = Array.isArray(v.format?.table_properties) ? (v.format.table_properties as Record<string, unknown>[]) : [];
      ops.push(mk.set({ table: 'collection_view', id: v.id, spaceId }, ['format', 'table_properties'], [...tp, ...Object.keys(built).map((pid) => ({ property: pid, visible: true, width: 200 }))]));
    }
  }
  if (Array.isArray(input.add_views) && input.add_views.length) {
    const nextCol = { ...col, schema: { ...col.schema, ...built } };
    const v = addViewOps(spaceId, block, nextCol, input.add_views, env.userId);
    ops.push(...v.ops);
    for (const view of input.add_views) changes.push({ name: 'Add view', value: `${view.name ?? view.type} (${view.type})` });
  }
  if (!ops.length) throw new AiError('bad_request', 'Nothing to change.', 400);
  return execute(env, stepId, {
    tool: 'update_database',
    ops,
    pages: [{ pageId: block.id, title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : name, action: 'updated', database: true }],
    risk,
    approval: { title: `Update database “${name}”`, properties: changes, pages: [{ pageId: block.id, title: name }], confirmLabel: 'Continue', danger: risk === 'destructive' },
    running: 'Updating database',
    done: 'Updated database',
    declined: 'Update database',
    detail: name,
    result: () => `Updated “${name}”: ${changes.map((c) => `${c.name} ${c.value}`).join('; ')}.`,
  });
};

// ---------------------------------------------------------------------------------------------
// Comments

/** Comment text with "@Name" turned into user mentions of workspace members. */
function commentText(text: string, spaceId: string): { rt: RichText; mentioned: string[] } {
  const space = getRecord<any>('space', spaceId);
  const people = ((space?.permissions ?? []) as { user_id?: string; role?: string }[]).filter((p) => p.user_id && p.role !== 'none')
    .map((p) => getRecord<any>('lit_user', p.user_id!)).filter((u) => u?.name)
    .sort((a, b) => b.name.length - a.name.length);
  const out: Decoration[] = [];
  const mentioned: string[] = [];
  let buf = '';
  let i = 0;
  const lower = text.toLowerCase();
  while (i < text.length) {
    if (text[i] === '@') {
      const hit = people.find((u) => lower.startsWith(`@${u.name.toLowerCase()}`, i));
      if (hit) {
        if (buf) out.push([buf]);
        buf = '';
        out.push(['‣', [['u', hit.id]]] as unknown as Decoration);
        mentioned.push(hit.id);
        i += hit.name.length + 1;
        continue;
      }
    }
    buf += text[i++];
  }
  if (buf) out.push([buf]);
  return { rt: out as RichText, mentioned };
}

export const addComment: ToolRun = async (env, input, stepId) => {
  const page = readableBlock(String(input.page_id), env.userId);
  if (!canComment(page.id, env.userId)) throw new AiError('forbidden', 'The user can’t comment on this page.', 403);
  const title = blockTitle(page) || 'Untitled';
  let target = page;
  let context: RichText | undefined;
  if (input.selection_with_ellipsis) {
    const units = pageUnits(page.id, env.userId);
    const m = matchSelection(units, String(input.selection_with_ellipsis));
    const blk = getRecord<BlockRecord>('block', units[m.first].id);
    if (blk) {
      target = blk;
      context = (blk.properties?.title as RichText | undefined)?.length ? (blk.properties!.title as RichText) : undefined;
    }
  }
  const { rt, mentioned } = commentText(String(input.text).trim().slice(0, 10_000), page.space_id);
  const cid = newId();
  const now = Date.now();
  const spaceId = page.space_id;
  if (input.discussion_id) {
    // a reply in an existing thread of this page (Custom Agents answer where they were @mentioned)
    const d = getRecord<DiscussionRecord>('discussion', normalizeId(input.discussion_id));
    const host = d && d.alive !== false ? getRecord<BlockRecord>('block', d.parent_id) : undefined;
    if (!d || d.alive === false || !host || (host.id !== page.id && !isAncestor(page.id, host.id)) || !discussionVisible(d as DiscussionRecord & { property_id?: string }, env.userId)) throw new AiError('not_found', 'That comment thread isn’t on this page.', 404);
    const replyOps: Operation[] = [
      mk.set({ table: 'comment', id: cid, spaceId }, [], { id: cid, parent_id: d.id, parent_table: 'discussion', text: rt, created_by_id: env.userId, created_time: now, last_edited_time: now, alive: true, space_id: spaceId }),
      mk.listAfter({ table: 'discussion', id: d.id, spaceId }, ['comments'], cid),
      ...(d.resolved ? [mk.update({ table: 'discussion', id: d.id, spaceId }, [], { resolved: false })] : []),
    ];
    return execute(env, stepId, {
      tool: 'add_comment',
      ops: replyOps,
      pages: [{ pageId: page.id, title, action: 'commented' }],
      risk: mentioned.length ? 'share' : 'edit',
      approval: { title: `Reply on “${title}”`, markdown: String(input.text), description: mentioned.length ? 'Mentioned people will be notified.' : undefined, pages: [{ pageId: page.id, title }], confirmLabel: 'Continue' },
      running: 'Adding comment',
      done: 'Added comment',
      declined: 'Add comment',
      detail: title,
      after: () => {
        try {
          commentHandlers.notifyComment({ userId: env.userId } as any, { commentId: cid });
        } catch {
          /* notifications are best effort */
        }
      },
      result: () => `Replied in the comment thread on “${title}”.`,
    });
  }
  const did = newId();
  const ops: Operation[] = [
    mk.set({ table: 'discussion', id: did, spaceId }, [], {
      id: did, parent_id: target.id, parent_table: 'block', resolved: false, comments: [], space_id: spaceId, alive: true,
      type: target.id === page.id ? 'page' : 'default', created_by_id: env.userId, created_time: now, ...(context ? { context } : {}),
    }),
    mk.listAfter({ table: 'block', id: target.id, spaceId }, ['discussions'], did),
    mk.set({ table: 'comment', id: cid, spaceId }, [], { id: cid, parent_id: did, parent_table: 'discussion', text: rt, created_by_id: env.userId, created_time: now, last_edited_time: now, alive: true, space_id: spaceId }),
    mk.listAfter({ table: 'discussion', id: did, spaceId }, ['comments'], cid),
  ];
  return execute(env, stepId, {
    tool: 'add_comment',
    ops,
    pages: [{ pageId: page.id, title, action: 'commented' }],
    risk: mentioned.length ? 'share' : 'edit',
    approval: { title: `Comment on “${title}”`, markdown: String(input.text), description: mentioned.length ? 'Mentioned people will be notified.' : undefined, pages: [{ pageId: page.id, title }], confirmLabel: 'Continue' },
    running: 'Adding comment',
    done: 'Added comment',
    declined: 'Add comment',
    detail: title,
    after: () => {
      try {
        commentHandlers.notifyComment({ userId: env.userId } as any, { commentId: cid });
      } catch {
        /* notifications are best effort */
      }
    },
    result: () => `Commented on “${title}”${target.id !== page.id ? ' (on the selected block)' : ''}.`,
  });
};

// ---------------------------------------------------------------------------------------------
// Inbox, memory, skills, plans

export const updateNotifications: ToolRun = async (env, input, stepId) => {
  if (input.read === undefined && input.archived === undefined) throw new AiError('bad_request', 'Give read and/or archived.', 400);
  const all = notificationsOf(env.userId, env.spaceId);
  const ids = new Set((input.notification_ids ?? []) as string[]);
  const targets = input.all ? all : all.filter((n) => ids.has(n.id));
  if (!targets.length) throw new AiError('bad_request', 'No matching notifications.', 400);
  const patch: Record<string, unknown> = {};
  if (typeof input.read === 'boolean') patch.read = input.read;
  if (typeof input.archived === 'boolean') patch.archived = input.archived;
  const ops = targets.map((n) => mk.update({ table: 'notification', id: n.id, spaceId: n.space_id }, [], patch));
  const what = [input.read === true ? 'mark as read' : input.read === false ? 'mark as unread' : '', input.archived === true ? 'archive' : input.archived === false ? 'unarchive' : ''].filter(Boolean).join(' and ');
  const n = targets.length;
  return execute(env, stepId, {
    tool: 'update_notifications',
    ops,
    pages: [{ pageId: '', title: `Inbox · ${plural(n, '1 notification', '{n} notifications')}`, action: 'updated' }],
    risk: 'edit',
    approval: { title: `${what[0].toUpperCase()}${what.slice(1)} ${plural(n, '1 notification', '{n} notifications')}`, confirmLabel: 'Continue' },
    running: 'Updating inbox',
    done: 'Updated inbox',
    declined: 'Update inbox',
    detail: plural(n, '1 notification', '{n} notifications'),
    result: () => `Done: ${what} for ${plural(n, '1 notification', '{n} notifications')}.`,
  });
};

function settingsOf(userId: string): Record<string, unknown> {
  return (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
}

function userSettingsOp(env: AgentEnv, patch: Record<string, unknown>): Operation {
  const rec = getRecord<UserSettingsRecord>('user_settings', env.userId);
  const ptr = { table: 'user_settings' as const, id: env.userId, spaceId: env.spaceId };
  return rec ? mk.update(ptr, ['settings'], patch) : mk.set(ptr, [], { id: env.userId, settings: patch });
}

export const updateMemory: ToolRun = async (env, input, stepId) => {
  if (!env.memories) throw new AiError('forbidden', 'Memories are turned off in this workspace (Settings → Litpage AI).', 403);
  const memory = String(input.memory).replace(/\s+/g, ' ').trim().slice(0, 500);
  const pageId = typeof settingsOf(env.userId).ai_instructions_page === 'string' ? (settingsOf(env.userId).ai_instructions_page as string) : '';
  const existing = pageId ? getRecord<BlockRecord>('block', pageId) : undefined;
  // memories stay in this workspace: an instructions page in another workspace isn't edited from here
  if (existing && existing.alive !== false && existing.space_id !== env.spaceId) throw new AiError('forbidden', 'The user’s AI instructions page is in another workspace, so it can’t be updated from here.', 403);
  const b = new OpsBuilder(env.spaceId, env.userId);
  let target: string;
  let created = false;
  if (existing && existing.alive !== false && canEditRow(existing.id, env.userId)) {
    target = existing.id;
    const last = [...(existing.content ?? [])].reverse().find((id) => getRecord<BlockRecord>('block', id)?.alive !== false);
    insertSpecs(b, existing.id, [{ type: 'bulleted_list', text: inlineRichText(memory) }], last ? { after: last } : { first: true });
  } else {
    const sv = spaceViewOf(env.userId, env.spaceId);
    if (!sv) throw new AiError('forbidden', 'The user isn’t a member of this workspace.', 403);
    target = placeUnder(b, { kind: 'private', spaceId: env.spaceId, spaceViewId: sv.id, title: 'Private' }, env.userId, { type: 'page', text: [['AI instructions']], children: [{ type: 'bulleted_list', text: inlineRichText(memory) }] });
    b.ops.push(userSettingsOp(env, { ai_instructions_page: target }));
    created = true;
  }
  const title = existing && !created ? blockTitle(existing) || 'AI instructions' : 'AI instructions';
  return execute(env, stepId, {
    tool: 'update_memory',
    ops: b.ops,
    pages: [{ pageId: target, title, action: created ? 'created' : 'updated' }],
    risk: 'edit',
    approval: { title: 'Update instructions', markdown: `- ${memory}`, pages: [{ pageId: target, title }], confirmLabel: 'Continue' },
    running: 'Updating instructions',
    done: 'Updated instructions',
    declined: 'Update instructions',
    detail: title,
    result: () => `Saved to the user’s instructions page: “${memory}”. It applies to future chats.`,
  });
};

export const createSkill: ToolRun = async (env, input, stepId) => {
  const sv = spaceViewOf(env.userId, env.spaceId);
  if (!sv) throw new AiError('forbidden', 'The user isn’t a member of this workspace.', 403);
  const title = String(input.title).trim().slice(0, 120);
  const description = typeof input.description === 'string' ? input.description.trim().slice(0, 240) : '';
  const children = [...(description ? [{ type: 'text' as const, text: inlineRichText(description) }] : []), ...markdownToSpecs(String(input.instructions))];
  const b = new OpsBuilder(env.spaceId, env.userId);
  const id = placeUnder(b, { kind: 'private', spaceId: env.spaceId, spaceViewId: sv.id, title: 'Private' }, env.userId, { type: 'page', text: inlineRichText(title), icon: '🧠', children, format: { ai_skill: { enabled: true, ...(description ? { description } : {}) } } });
  const enabled = Array.isArray(settingsOf(env.userId).ai_skills_enabled) ? (settingsOf(env.userId).ai_skills_enabled as string[]) : [];
  b.ops.push(userSettingsOp(env, { ai_skills_enabled: [...enabled.filter((x) => x !== id), id] }));
  return execute(env, stepId, {
    tool: 'create_skill',
    ops: b.ops,
    pages: [{ pageId: id, title, action: 'created' }],
    risk: 'edit',
    approval: { title: `Create skill “${title}”`, description: description || undefined, markdown: clip(String(input.instructions)), pages: [{ title }], confirmLabel: 'Continue' },
    running: 'Creating skill',
    done: 'Created skill',
    declined: 'Create skill',
    detail: title,
    result: () => `Created the skill “${title}” (page_id: ${id}). It is enabled for the user: they can run it with "/" in chat, and Litpage AI uses it when relevant.`,
  });
};

export const proposePlan: ToolRun = async (env, input, stepId) => {
  const title = String(input.title).trim().slice(0, 200);
  const steps = (input.steps as string[]).map((s) => String(s).trim()).filter(Boolean).slice(0, 20);
  env.step({ id: stepId, tool: 'propose_plan', status: 'running', label: 'Creating plan', detail: title });
  const decision = await env.approve({ tool: 'propose_plan', stepId, risk: 'plan', payload: { title, plan: { title, steps }, description: 'Take a look and approve to begin building.', confirmLabel: 'Continue' } });
  if (decision !== 'accept') {
    env.step({ id: stepId, tool: 'propose_plan', status: 'declined', label: 'Plan page', detail: title });
    return { content: 'The user rejected the plan. Ask what they would like to change; do not start the work.' };
  }
  env.step({ id: stepId, tool: 'propose_plan', status: 'done', label: 'Plan ready', detail: title });
  return { content: 'The user approved the plan. Carry it out now, step by step.' };
};

/** The CSV attachment of this chat named `name` (else the most recent CSV / TSV), read with the user's access. */
function attachedCsv(env: AgentEnv, name: string): { name: string; text: string } {
  if (!env.threadId) throw new AiError('bad_request', 'Attach a CSV file to the chat first.', 400);
  const files: { id: string; title: string }[] = [];
  for (const m of listMessages(env.threadId)) {
    if (m.role !== 'user') continue;
    for (const c of (m.data.contexts ?? []) as { kind: string; pageId: string; title: string }[]) {
      if (c.kind === 'file' && /\.(csv|tsv)$/i.test(c.title)) files.push({ id: c.pageId, title: c.title });
    }
  }
  const wanted = name.trim().toLowerCase();
  const hit = wanted ? [...files].reverse().find((f) => f.title.toLowerCase() === wanted || f.title.toLowerCase().includes(wanted)) : files[files.length - 1];
  if (!hit) throw new AiError('not_found', files.length ? `No attached CSV is called “${name}”. Attached: ${files.map((f) => f.title).join(', ')}.` : 'There is no CSV file attached to this chat.', 404);
  const file = readStoredFile(hit.id, env.userId);
  if (!file) throw new AiError('not_found', `“${hit.title}” is no longer available.`, 404);
  const buf = file.data;
  const text = buf[0] === 0xff && buf[1] === 0xfe ? buf.subarray(2).toString('utf16le') : buf.toString('utf8');
  return { name: hit.title, text };
}

export const importCsv: ToolRun = async (env, input, stepId) => {
  const file = attachedCsv(env, typeof input.file === 'string' ? input.file : '');
  const title = (typeof input.title === 'string' && input.title.trim() ? input.title.trim() : file.name.replace(/\.(csv|tsv)$/i, '')).slice(0, 200) || 'Imported CSV';
  const spec = csvToDb(title, file.text);
  if (!spec.rows.length && Object.keys(spec.schema).length <= 1) throw new AiError('bad_request', `“${file.name}” has no rows to import.`, 400);
  if (spec.rows.length > 5000) throw new AiError('bad_request', `“${file.name}” has ${spec.rows.length} rows — import up to 5,000 rows at a time.`, 400);
  const parent = resolveParent(input.parent, env.userId, env.spaceId, null);
  if (parent.kind === 'database') throw new AiError('bad_request', 'A database cannot be created inside another database. Use a page, team, or private parent.', 400);
  const b = new OpsBuilder(parent.spaceId, env.userId);
  const id = placeUnder(b, parent, env.userId, { type: 'collection_view_page', db: spec });
  if (parent.kind === 'page') b.ops.push(touch({ id: parent.id, spaceId: parent.spaceId }, env.userId));
  const props = Object.values(spec.schema).map((p) => ({ name: p.name, value: p.type }));
  return execute(env, stepId, {
    tool: 'import_csv',
    ops: b.ops,
    pages: [{ pageId: id, title, action: 'created', database: true }],
    risk: 'edit',
    approval: { title: `Import “${file.name}” as a database`, description: `In ${parent.kind === 'private' ? 'Private' : parent.title} · ${spec.rows.length} row(s)`, properties: props, pages: [{ title }], confirmLabel: 'Continue' },
    running: 'Importing CSV',
    done: 'Imported CSV',
    declined: 'Import CSV',
    detail: file.name,
    result: () => `Created the database “${title}” (database_id: ${id}) from ${file.name}: ${spec.rows.length} row(s), properties ${Object.values(spec.schema).map((p) => `${p.name} (${p.type})`).join(', ')}.`,
  });
};

export const WRITE_TOOL_RUNS: Record<string, ToolRun> = {
  import_csv: importCsv,
  create_pages: createPages,
  update_page: updatePage,
  delete_pages: deletePages,
  move_pages: movePages,
  create_database: createDatabase,
  update_database: updateDatabase,
  add_comment: addComment,
  update_notifications: updateNotifications,
  update_memory: updateMemory,
  create_skill: createSkill,
  propose_plan: proposePlan,
};

export { resolvePeople };

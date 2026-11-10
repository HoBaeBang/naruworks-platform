// AI tool definitions (pure: schemas + input validation, no DB access). Executors live in ./read.ts and
// ./write.ts; ./registry.ts binds both. The same tools back chat and the MCP server
// (../litMcp.ts), and are reusable by custom agents: every executor acts as a given user.
//
// Order is fixed (tools render first in the prompt-cache prefix); client tools stream their input eagerly
// (eager_input_streaming) and are validated here before they run — the SDK's tolerant parser can hand back a
// silently truncated object, so a schema check is the only guard.
import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages';

type Json = Record<string, unknown>;

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Json;
  /** read = never needs approval; write tools are gated by the approval mode */
  access: 'read' | 'write';
}

const str = (description: string, extra: Json = {}): Json => ({ type: 'string', description, ...extra });
const PARENT: Json = {
  type: 'object',
  description: 'Where to put the new item. Omit to use the page the user is on (if any), else the user’s private pages.',
  properties: {
    type: { type: 'string', enum: ['page', 'database', 'teamspace', 'private'], description: 'page = inside a page; database = a new row of a database; teamspace = the top level of a team; private = the user’s private pages.' },
    id: str('page_id, database_id, or teamspace_id (omit for private).'),
  },
  required: ['type'],
  additionalProperties: false,
};
const PROPERTIES: Json = {
  type: 'object',
  description: 'Database row property values keyed by property name, e.g. {"Status": "Done", "Due": "2026-10-24", "Tags": ["UI", "Web"], "Estimate": 3, "Done": true}. Use "title" or the title property’s name for the row title.',
  additionalProperties: true,
};
const PROPERTY_DEFS: Json = {
  type: 'array',
  maxItems: 40,
  items: {
    type: 'object',
    properties: {
      name: str('Property name.'),
      type: { type: 'string', enum: ['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone_number', 'files', 'created_time', 'last_edited_time', 'formula'] },
      options: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Options for select / multi_select / status.' },
      expression: str('Formula expression (Litpage formulas 2.0), e.g. prop("Points") * 2 or if(prop("Done"), "✅", "⏳").'),
    },
    required: ['name', 'type'],
    additionalProperties: false,
  },
};
const CHART_FIELDS: Record<string, Json> = {
  chart_type: { type: 'string', enum: ['column', 'bar', 'line', 'donut', 'number'], description: 'chart: column (vertical bars, default), bar (horizontal), line, donut, or number (one big number).' },
  aggregate: {
    type: 'object',
    description: 'chart: what each bar / slice measures — count of pages (default) or sum / average / median / min / max of a number property.',
    properties: { function: { type: 'string', enum: ['count', 'sum', 'average', 'median', 'min', 'max'] }, property: str('Number property name (not for count).') },
    additionalProperties: false,
  },
};

const VIEWS: Json = {
  type: 'array',
  maxItems: 8,
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['table', 'board', 'list', 'gallery', 'calendar', 'timeline', 'chart', 'form', 'dashboard'] },
      name: str('View name (a form’s title).'),
      group_by: str('Property name to group a board by (select / status), or a chart’s X axis / donut slices.'),
      ...CHART_FIELDS,
      questions: {
        type: 'array',
        maxItems: 50,
        description: 'form: the questions, in order — each answers one property (the title is always asked). Omit to ask every answerable property.',
        items: { type: 'object', properties: { property: str('Property name.'), required: { type: 'boolean' }, long_answer: { type: 'boolean', description: 'text: multi-line answer.' } }, required: ['property'], additionalProperties: false },
      },
      description: str('form: description shown under the title.'),
      widgets: {
        type: 'array',
        maxItems: 12,
        description: 'dashboard: its widgets, laid out in rows (charts four per row, tables / boards two per row).',
        items: {
          type: 'object',
          properties: { type: { type: 'string', enum: ['chart', 'table', 'board', 'list', 'gallery', 'calendar', 'timeline'] }, name: str('Widget title.'), group_by: str('Property name.'), ...CHART_FIELDS },
          required: ['type'],
          additionalProperties: false,
        },
      },
    },
    required: ['type'],
    additionalProperties: false,
  },
};

export const TOOL_DEFS: ToolDef[] = [
  {
    name: 'search_workspace',
    access: 'read',
    description: 'Search the pages in the user’s Litpage workspace that the user can access. Call it whenever the user asks about something that may be in their workspace (projects, notes, docs, databases) and it is not already in the conversation. Returns up to 8 matching pages, each with a source number, title, page id and a text snippet. Use short keyword queries (1-5 words); try another wording or language if nothing matches.',
    input_schema: {
      type: 'object',
      properties: {
        query: str('Keywords to look for in page titles and text.'),
        page_id: str('Only search inside this page and its sub-pages.'),
        teamspace_id: str('Only search inside this team.'),
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_page',
    access: 'read',
    description: 'Read the full content of a page (or database row) as Markdown, with its properties. Call it before editing a page, and to read a page found by search_workspace or shared in the conversation.',
    input_schema: { type: 'object', properties: { page_id: str('The page id (UUID).') }, required: ['page_id'], additionalProperties: false },
  },
  {
    name: 'query_database',
    access: 'read',
    description: 'List the rows of a database with their property values and page ids, optionally filtered and sorted. Use it to answer questions about database contents or to find the rows to update.',
    input_schema: {
      type: 'object',
      properties: {
        database_id: str('The database id (a database page or inline database block, or its data source id).'),
        filters: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              property: str('Property name.'),
              operator: { type: 'string', enum: ['equals', 'not_equals', 'contains', 'is_empty', 'is_not_empty', 'before', 'after'] },
              value: str('Value to compare with (dates as YYYY-MM-DD).'),
            },
            required: ['property', 'operator'],
            additionalProperties: false,
          },
        },
        sort: { type: 'object', properties: { property: str('Property name.'), direction: { type: 'string', enum: ['ascending', 'descending'] } }, required: ['property'], additionalProperties: false },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Maximum rows (default 50).' },
      },
      required: ['database_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_comments',
    access: 'read',
    description: 'Read the comment threads of a page (page comments and comments on its blocks), with authors, times and resolved state.',
    input_schema: { type: 'object', properties: { page_id: str('The page id.'), include_resolved: { type: 'boolean' } }, required: ['page_id'], additionalProperties: false },
  },
  {
    name: 'view_version_history',
    access: 'read',
    description: 'List the saved versions of a page (time and editors), or read one version as Markdown when version_id is given. Use it when the user asks what changed or what a page used to say.',
    input_schema: { type: 'object', properties: { page_id: str('The page id.'), version_id: str('A version id from the list.') }, required: ['page_id'], additionalProperties: false },
  },
  {
    name: 'list_people',
    access: 'read',
    description: 'List the people in the workspace (name and user id), optionally filtered by name. Use it to resolve @mentions, person properties and comment mentions.',
    input_schema: { type: 'object', properties: { query: str('Part of a name or email.') }, additionalProperties: false },
  },
  {
    name: 'list_notifications',
    access: 'read',
    description: 'List the user’s inbox notifications (mentions, comments, page updates, invites) with ids, read/archived state, the page and a preview.',
    input_schema: {
      type: 'object',
      properties: { unread_only: { type: 'boolean' }, include_archived: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      additionalProperties: false,
    },
  },
  {
    name: 'use_skill',
    access: 'read',
    description: 'Load the instructions of one of the user’s skills (listed in the system prompt). Call it when a request matches a skill’s description, then follow the instructions.',
    input_schema: { type: 'object', properties: { skill_id: str('The skill id.') }, required: ['skill_id'], additionalProperties: false },
  },
  {
    name: 'create_pages',
    access: 'write',
    description: 'Create one or more pages, or rows of a database. Content is Litpage-flavored Markdown: headings, lists, to-dos ("- [ ] "), quotes, toggles ("<details><summary>…</summary>…</details>"), callouts, code blocks, tables, dividers, and page mentions as [Title](page_id).',
    input_schema: {
      type: 'object',
      properties: {
        parent: PARENT,
        pages: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            properties: {
              title: str('Page title.'),
              icon: str('An emoji icon.'),
              content: str('Page body as Markdown.'),
              properties: PROPERTIES,
            },
            additionalProperties: false,
          },
        },
      },
      required: ['pages'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_page',
    access: 'write',
    description: 'Edit a page. Commands: "update_properties" (title, icon, or database row properties); "append_content" (add Markdown at the end); "insert_content_after" (add Markdown after the block matched by selection_with_ellipsis); "replace_content_range" (replace the blocks matched by selection_with_ellipsis with new_str); "replace_content" (replace the whole body with new_str). selection_with_ellipsis is the start and end of the target text as it appears in read_page output, joined by "..." — e.g. "## Risks...owner: Ada" — or a short unique snippet. Read the page first.',
    input_schema: {
      type: 'object',
      properties: {
        page_id: str('The page id.'),
        command: { type: 'string', enum: ['update_properties', 'append_content', 'insert_content_after', 'replace_content_range', 'replace_content'] },
        title: str('New title (update_properties).'),
        icon: str('New emoji icon (update_properties).'),
        properties: PROPERTIES,
        selection_with_ellipsis: str('Target text: "start...end" or a unique snippet.'),
        new_str: str('Markdown to insert or to replace with.'),
        suggest: { type: 'boolean', description: 'Write the change as a suggested edit the user accepts or rejects on the page instead of editing directly — when the user asks you to "suggest edits", or can only comment. Works with replace_content_range inside one text / heading / list / to-do block (one call per block; an empty new_str suggests removing the text).' },
      },
      required: ['page_id', 'command'],
      additionalProperties: false,
    },
  },
  {
    name: 'delete_pages',
    access: 'write',
    description: 'Move pages (or database rows / databases) to Trash. Only when the user explicitly asks to delete something.',
    input_schema: { type: 'object', properties: { page_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 } }, required: ['page_ids'], additionalProperties: false },
  },
  {
    name: 'move_pages',
    access: 'write',
    description: 'Move pages to another parent page, a team, or the user’s private pages.',
    input_schema: {
      type: 'object',
      properties: { page_ids: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 50 }, new_parent: PARENT },
      required: ['page_ids', 'new_parent'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_database',
    access: 'write',
    description: 'Add a database (a full page database, or an inline database inside a page with inline: true) with properties, views and optional starting rows. A title property is added automatically when none is given. Views can also be a chart (bar / line / donut / number), a form people fill in (each answer becomes a page), or a dashboard of charts and tables.',
    input_schema: {
      type: 'object',
      properties: {
        parent: PARENT,
        title: str('Database name.'),
        inline: { type: 'boolean', description: 'Create an inline database inside the parent page.' },
        properties: PROPERTY_DEFS,
        views: VIEWS,
        rows: { type: 'array', maxItems: 100, items: PROPERTIES },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_database',
    access: 'write',
    description: 'Change a database: rename it, add, rename or delete properties, add select options, or add views — including charts, a form that collects responses as pages, or a dashboard of charts and tables.',
    input_schema: {
      type: 'object',
      properties: {
        database_id: str('The database id.'),
        title: str('New database name.'),
        add_properties: PROPERTY_DEFS,
        rename_properties: { type: 'array', maxItems: 20, items: { type: 'object', properties: { from: str('Current name.'), to: str('New name.') }, required: ['from', 'to'], additionalProperties: false } },
        delete_properties: { type: 'array', maxItems: 20, items: { type: 'string' } },
        add_views: VIEWS,
      },
      required: ['database_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'add_comment',
    access: 'write',
    description: 'Add a comment to a page, or to the block matched by selection_with_ellipsis, or reply in an existing comment thread with discussion_id. Mention people as @Name.',
    input_schema: {
      type: 'object',
      properties: { page_id: str('The page id.'), text: str('Comment text.'), selection_with_ellipsis: str('Block to comment on.'), discussion_id: str('Reply in this comment thread (from read_comments or the trigger context).') },
      required: ['page_id', 'text'],
      additionalProperties: false,
    },
  },
  {
    name: 'update_notifications',
    access: 'write',
    description: 'Mark the user’s inbox notifications as read or unread, or archive / unarchive them.',
    input_schema: {
      type: 'object',
      properties: {
        notification_ids: { type: 'array', items: { type: 'string' }, maxItems: 200 },
        all: { type: 'boolean', description: 'Apply to every notification in the inbox.' },
        read: { type: 'boolean' },
        archived: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'update_memory',
    access: 'write',
    description: 'Remember something about the user for future chats by adding it to their instructions page (Settings → Litpage AI → Instructions). Use when the user says "remember…" or states a lasting preference.',
    input_schema: { type: 'object', properties: { memory: str('What to remember, as one short sentence.') }, required: ['memory'], additionalProperties: false },
  },
  {
    name: 'create_skill',
    access: 'write',
    description: 'Save a reusable skill for the user: a page with instructions Litpage AI follows when the skill is used ("/" in chat or automatically when relevant).',
    input_schema: {
      type: 'object',
      properties: { title: str('Skill name.'), description: str('One sentence: when to use it.'), instructions: str('The skill’s instructions as Markdown.') },
      required: ['title', 'instructions'],
      additionalProperties: false,
    },
  },
  {
    // SVG illustration made by Claude (ai/image.ts provider)
    name: 'generate_image',
    access: 'write',
    description: 'Create an image (illustration, diagram, infographic, chart, slide, mockup, sketch, cartoon, comic, pattern) with Litpage AI image generation. Use when the user asks for an image or visual. Set use_current_page (or about_page_id) when it should depict a page. Set insert_into_page_id only when the user wants the image on a page. Show the result with the Markdown image the tool returns.',
    input_schema: {
      type: 'object',
      properties: {
        prompt: str('What to draw, in detail.'),
        style: { type: 'string', enum: ['default', 'diagram', 'infographic', 'chart', 'slide', 'mockup', 'photo', 'sketch', 'cartoon', 'comic', 'pattern', 'modern_art'] },
        use_current_page: { type: 'boolean', description: 'Base the image on the page the user is on.' },
        about_page_id: str('Base the image on this page.'),
        insert_into_page_id: str('Add the image at the end of this page.'),
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    // : the whole attached CSV becomes a database server-side (no row limit of create_database)
    name: 'import_csv',
    access: 'write',
    description: 'Turn a CSV (or TSV) file the user attached to the chat into a database: the first column becomes the title, the other columns properties with detected types (number, date, select, checkbox, URL…), every line a page. Prefer it over create_database for attached spreadsheets.',
    input_schema: {
      type: 'object',
      properties: {
        file: str('The attached file’s name (omit for the most recent CSV attachment).'),
        title: str('Database name (default: the file name).'),
        parent: PARENT,
      },
      additionalProperties: false,
    },
  },
  {
    name: 'propose_plan',
    access: 'write',
    description: 'Plan mode: present the plan for the user’s approval before doing any work. Call it once you understand the task; carry the plan out only after it is approved.',
    input_schema: {
      type: 'object',
      properties: { title: str('Plan title.'), steps: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 20 } },
      required: ['title', 'steps'],
      additionalProperties: false,
    },
  },
];

export const READ_TOOLS = TOOL_DEFS.filter((t) => t.access === 'read').map((t) => t.name);

/** Tools only some surfaces offer (Custom Agents: call_agent, send_notification…) — validated like TOOL_DEFS but never
 *  part of Agent's list. `dynamic` accepts generated tool names (an agent's MCP tools) with a schema check of
 *  its own. */
export const EXTRA_TOOL_DEFS: ToolDef[] = [];
const dynamicTools: { match: (name: string) => boolean; validate: (input: Record<string, unknown>) => string | null }[] = [];
export function registerToolDefs(defs: ToolDef[]) {
  for (const d of defs) if (!EXTRA_TOOL_DEFS.some((x) => x.name === d.name) && !TOOL_DEFS.some((x) => x.name === d.name)) EXTRA_TOOL_DEFS.push(d);
}
export function registerDynamicTools(match: (name: string) => boolean, validate: (input: Record<string, unknown>) => string | null = () => null) {
  dynamicTools.push({ match, validate });
}
function findDef(name: string): ToolDef | undefined {
  return TOOL_DEFS.find((t) => t.name === name) ?? EXTRA_TOOL_DEFS.find((t) => t.name === name);
}

/** Tool definitions in API form (eager input streaming on: inputs are validated here before running). */
export function toolParams(names: string[]): BetaToolUnion[] {
  const set = new Set(names);
  return [...TOOL_DEFS, ...EXTRA_TOOL_DEFS].filter((t) => set.has(t.name)).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema as any, eager_input_streaming: true }) as BetaToolUnion);
}

// ---------------------------------------------------------------------------------------------
// Minimal JSON-schema validation for the shapes above

function check(schema: Json, v: unknown, path: string): string | null {
  const type = schema.type as string | undefined;
  if (type === 'string') {
    if (typeof v !== 'string') return `${path} must be a string`;
    if (Array.isArray(schema.enum) && !(schema.enum as string[]).includes(v)) return `${path} must match one of ${(schema.enum as string[]).join(', ')}`;
    if (v.length > 200_000) return `${path} is too long`;
    return null;
  }
  if (type === 'integer' || type === 'number') {
    if (typeof v !== 'number' || !Number.isFinite(v) || (type === 'integer' && !Number.isInteger(v))) return `${path} must be ${type === 'integer' ? 'an integer' : 'a number'}`;
    if (typeof schema.minimum === 'number' && v < schema.minimum) return `${path} must be ≥ ${schema.minimum}`;
    if (typeof schema.maximum === 'number' && v > schema.maximum) return `${path} must be ≤ ${schema.maximum}`;
    return null;
  }
  if (type === 'boolean') return typeof v === 'boolean' ? null : `${path} must be a boolean`;
  if (type === 'array') {
    if (!Array.isArray(v)) return `${path} must be an array`;
    if (typeof schema.minItems === 'number' && v.length < schema.minItems) return `${path} needs at least ${schema.minItems} item(s)`;
    if (typeof schema.maxItems === 'number' && v.length > schema.maxItems) return `${path} has more than ${schema.maxItems} items`;
    const items = schema.items as Json | undefined;
    if (items) for (let i = 0; i < v.length; i++) {
      const e = check(items, v[i], `${path}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (type === 'object') {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return `${path} must be an object`;
    const o = v as Json;
    const props = (schema.properties ?? {}) as Record<string, Json>;
    for (const r of (schema.required as string[] | undefined) ?? []) {
      if (o[r] === undefined || o[r] === null || (typeof o[r] === 'string' && !(o[r] as string).trim())) return `${path}.${r} is required`;
    }
    for (const [k, val] of Object.entries(o)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') return `${path}.${k} is not allowed`;
      if (val === undefined || val === null) continue;
      if (props[k]) {
        const e = check(props[k], val, `${path}.${k}`);
        if (e) return e;
      } else if (schema.additionalProperties === false) {
        return `Unexpected field ${path === 'input' ? '' : `${path}.`}${k}`;
      }
    }
    return null;
  }
  return null;
}

/** Validate a tool input against its schema (unknown tools and malformed inputs → an error string). */
export function validateInput(name: string, input: unknown): { ok: true; value: Json } | { ok: false; error: string } {
  const def = findDef(name);
  if (!def) {
    const dyn = dynamicTools.find((d) => d.match(name));
    if (!dyn) return { ok: false, error: `Unknown tool ${name}.` };
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Tool input must be a JSON object.' };
    const err = dyn.validate(input as Json);
    return err ? { ok: false, error: err } : { ok: true, value: input as Json };
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'Tool input must be a JSON object.' };
  const err = check(def.input_schema, input, 'input');
  if (err) return { ok: false, error: err.replace(/^input\./, '') };
  // trim string fields at the top level (ids, queries)
  const value: Json = {};
  for (const [k, v] of Object.entries(input as Json)) value[k] = typeof v === 'string' && /(^|_)(id|query|command)$/.test(k) ? v.trim() : v;
  return { ok: true, value };
}

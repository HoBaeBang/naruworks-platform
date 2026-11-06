// Declarative block specs → record operations (block / collection / collection_view).
// Shared by the template gallery (seed), importers (Markdown / CSV / HTML / ZIP) and template duplication.
import { newId } from '@nc/shared/ids.ts';
import type { Operation } from '@nc/shared/ops.ts';
import type { BlockType, ParentTable, PropertySchema, PropertyType, SelectOption, ViewType } from '@nc/shared/records.ts';
import type { DateValue, RichText } from '@nc/shared/richtext.ts';
import { defaultStatusSchema } from '@nc/shared/database/schema.ts';
import { encodeCheckbox, encodeDate, encodeNumber, encodeSelect, encodeText } from '@nc/shared/database/values.ts';

export type RowValue = string | number | boolean | string[] | { date: string; end?: string } | null | undefined;

export interface DbPropSpec {
  name: string;
  type: PropertyType;
  /** select / multi_select / status option names (status: [optionName, group] pairs allowed via statusGroups) */
  options?: (string | { value: string; color?: string })[];
  number_format?: string;
}

export interface DbViewSpec {
  type: ViewType;
  name?: string;
  /** board / list grouping property id */
  groupBy?: string;
  /** visible properties (ids) besides title; default: all for tables, title (+ group) for others */
  visible?: string[];
  sort?: { property: string; direction: 'ascending' | 'descending' }[];
}

export interface DbRowSpec {
  values: Record<string, RowValue>;
  icon?: string;
  children?: Spec[];
}

export interface DbSpec {
  name: string;
  description?: string;
  schema: Record<string, DbPropSpec>;
  rows: DbRowSpec[];
  views: DbViewSpec[];
}

export interface Spec {
  type: BlockType;
  /** title / text (plain string or rich text) */
  text?: string | RichText;
  props?: Record<string, RichText>;
  format?: Record<string, unknown>;
  children?: Spec[];
  icon?: string;
  cover?: string;
  checked?: boolean;
  language?: string;
  /** simple table rows (cells as plain strings or rich text); first row is the header when tableHeader */
  table?: (string | RichText)[][];
  tableHeader?: boolean;
  /** image / bookmark / embed / file source */
  url?: string;
  /** database for collection_view (inline) / collection_view_page */
  db?: DbSpec;
  /** link_to_page / alias target (resolved by importers) */
  pageRef?: string;
  /** pre-assigned block id (importers resolve cross-page links before building) */
  id?: string;
}

export const rt = (v: string | RichText | undefined): RichText => (v === undefined ? [] : typeof v === 'string' ? (v ? [[v]] : []) : v);

const DEFAULT_TITLE_WIDTH = 280;
const DEFAULT_COLUMN_WIDTH = 200;
const COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

/** Collects set-operations for new records; callers add the list insertion op(s) and apply them as one transaction. */
export class OpsBuilder {
  ops: Operation[] = [];
  readonly spaceId: string;
  readonly userId: string;
  readonly now: number;
  /** spec-local page keys (Spec.pageRef targets) → created block ids */
  pageIds = new Map<string, string>();
  blockCount = 0;

  constructor(spaceId: string, userId: string, now = Date.now()) {
    this.spaceId = spaceId;
    this.userId = userId;
    this.now = now;
  }

  private set(table: 'block' | 'collection' | 'collection_view', id: string, value: Record<string, unknown>) {
    this.ops.push({ pointer: { table, id, spaceId: this.spaceId }, path: [], command: 'set', args: value });
  }

  private meta() {
    return {
      space_id: this.spaceId, alive: true,
      created_time: this.now, created_by_id: this.userId, created_by_table: 'lit_user',
      last_edited_time: this.now, last_edited_by_id: this.userId, last_edited_by_table: 'lit_user',
    };
  }

  /** Create a block (and its subtree) under parent; returns the new id. */
  block(spec: Spec, parentId: string, parentTable: ParentTable, extra?: Record<string, unknown>): string {
    const id = (extra?.id as string) ?? spec.id ?? newId();
    this.blockCount++;
    const properties: Record<string, RichText> = { ...(spec.props ?? {}) };
    const format: Record<string, unknown> = { ...(spec.format ?? {}) };
    if (spec.text !== undefined && spec.type !== 'collection_view' && spec.type !== 'collection_view_page') properties.title = rt(spec.text);
    if (spec.type === 'to_do') properties.checked = [[spec.checked ? 'Yes' : 'No']];
    if (spec.type === 'code') properties.language = [[spec.language || 'Plain Text']];
    if (spec.icon) format.page_icon = spec.icon;
    if (spec.cover) {
      format.page_cover = spec.cover;
      format.page_cover_position = 0.5;
    }
    if (spec.url && ['image', 'video', 'audio', 'file', 'pdf', 'bookmark', 'embed'].includes(spec.type)) {
      properties.source = [[spec.url]];
      if (spec.type !== 'bookmark') format.display_source = spec.url;
      if (spec.type === 'bookmark') properties.link = [[spec.url]];
    }
    let content: string[] = [];
    const value: Record<string, unknown> = {
      type: spec.type, properties, format, parent_id: parentId, parent_table: parentTable, ...this.meta(), ...(extra ?? {}), id,
    };
    if (spec.type === 'table' && spec.table) {
      const cols = Array.from({ length: Math.max(1, ...spec.table.map((r) => r.length)) }, () => shortPropId());
      format.table_block_column_order = cols;
      format.table_block_column_header = spec.tableHeader !== false;
      format.table_block_row_header = false;
      for (const row of spec.table) {
        const rowId = newId();
        const props: Record<string, RichText> = {};
        cols.forEach((c, i) => {
          if (row[i] !== undefined) props[c] = rt(row[i]);
        });
        this.set('block', rowId, { id: rowId, type: 'table_row', properties: props, format: {}, parent_id: id, parent_table: 'block', ...this.meta() });
        content.push(rowId);
      }
    } else if ((spec.type === 'collection_view' || spec.type === 'collection_view_page') && spec.db) {
      const { collectionId, viewIds } = this.database(spec.db, id);
      value.collection_id = collectionId;
      value.view_ids = viewIds;
      delete (value.properties as Record<string, unknown>).title;
    } else {
      content = (spec.children ?? []).map((c) => this.block(c, id, 'block'));
    }
    if (content.length) value.content = content;
    if (!Object.keys(format).length) delete value.format;
    if (!Object.keys(properties).length) delete value.properties;
    if (spec.pageRef) this.pageIds.set(spec.pageRef, id);
    this.set('block', id, value);
    return id;
  }

  /** collection + views + rows for a database block. */
  database(db: DbSpec, blockId: string): { collectionId: string; viewIds: string[] } {
    const collectionId = newId();
    const schema: Record<string, PropertySchema> = {};
    for (const [pid, p] of Object.entries(db.schema)) schema[pid] = buildProperty(p);
    const rowIds: string[] = [];
    for (const row of db.rows) {
      const rowId = newId();
      rowIds.push(rowId);
      const properties: Record<string, RichText> = {};
      for (const [pid, v] of Object.entries(row.values)) {
        const prop = schema[pid];
        if (!prop) continue;
        const enc = encodeRowValue(prop, v);
        if (enc) properties[pid] = enc;
      }
      const content = (row.children ?? []).map((c) => this.block(c, rowId, 'block'));
      this.blockCount++;
      this.set('block', rowId, {
        id: rowId, type: 'page', properties, ...(row.icon ? { format: { page_icon: row.icon } } : {}),
        ...(content.length ? { content } : {}), parent_id: collectionId, parent_table: 'collection', ...this.meta(),
      });
    }
    const ids = Object.keys(schema);
    const titleFirst = ['title', ...ids.filter((x) => x !== 'title')];
    this.set('collection', collectionId, {
      id: collectionId, name: db.name ? [[db.name]] : [], ...(db.description ? { description: [[db.description]] } : {}), schema,
      format: { collection_page_properties: titleFirst.filter((k) => k !== 'title').map((k) => ({ property: k, visible: true })) },
      parent_id: blockId, parent_table: 'block', alive: true, space_id: this.spaceId, template_pages: [],
    });
    const viewIds = (db.views.length ? db.views : [{ type: 'table' as ViewType }]).map((v) => {
      const vid = newId();
      this.set('collection_view', vid, {
        id: vid, type: v.type, name: v.name ?? VIEW_NAMES[v.type] ?? 'View', ...viewDefaults(v, schema, titleFirst),
        parent_id: blockId, parent_table: 'block', alive: true, space_id: this.spaceId, page_sort: rowIds,
      });
      return vid;
    });
    return { collectionId, viewIds };
  }
}

const VIEW_NAMES: Record<string, string> = { table: 'Table', board: 'Board', gallery: 'Gallery', list: 'List', calendar: 'Calendar', timeline: 'Timeline' };

function viewDefaults(v: DbViewSpec, schema: Record<string, PropertySchema>, titleFirst: string[]): { format: Record<string, unknown>; query2: Record<string, unknown> } {
  const visible = (p: string) => p === 'title' || (v.visible ? v.visible.includes(p) : v.type === 'table');
  const query2: Record<string, unknown> = {};
  if (v.sort?.length) query2.sort = v.sort;
  switch (v.type) {
    case 'table':
      return { format: { table_properties: titleFirst.map((p) => ({ property: p, visible: visible(p), width: p === 'title' ? DEFAULT_TITLE_WIDTH : DEFAULT_COLUMN_WIDTH })), table_wrap: true }, query2 };
    case 'board': {
      const gid = v.groupBy ?? titleFirst.find((p) => ['status', 'select'].includes(schema[p]?.type));
      const prop = gid ? schema[gid] : undefined;
      return {
        format: {
          ...(gid && prop
            ? {
                board_columns_by: {
                  type: prop.type, property: gid, hideEmptyGroups: false,
                  ...(prop.type === 'status' ? { groupBy: 'option', sort: { type: 'ascending' } } : { sort: { type: 'manual' } }),
                },
              }
            : {}),
          board_properties: titleFirst.map((p) => ({ property: p, visible: visible(p) })),
          board_cover: { type: 'page_cover' }, board_cover_size: 'medium', board_cover_aspect: 'cover', table_wrap: true,
        },
        query2: { ...query2, ...(gid ? { group_by: gid } : {}), aggregations: [{ aggregator: 'count', enforceMaxAggregationLimit: true }] },
      };
    }
    case 'gallery':
      return { format: { gallery_properties: titleFirst.map((p) => ({ property: p, visible: visible(p) })), gallery_cover: { type: 'page_content_first' }, gallery_cover_size: 'medium', gallery_cover_aspect: 'cover' }, query2 };
    case 'list':
      return { format: { list_properties: titleFirst.map((p) => ({ property: p, visible: visible(p) })) }, query2 };
    default:
      return { format: { [`${v.type}_properties`]: titleFirst.map((p) => ({ property: p, visible: visible(p) })) }, query2 };
  }
}

export function shortPropId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function buildProperty(p: DbPropSpec): PropertySchema {
  const out: PropertySchema = { name: p.name, type: p.type };
  if (p.type === 'status') {
    const s = defaultStatusSchema();
    if (p.options?.length) {
      // custom status options: map onto the three default groups by keyword
      const opts: SelectOption[] = p.options.map((o, i) => {
        const value = typeof o === 'string' ? o : o.value;
        const color = typeof o === 'string' ? (i === 0 ? 'default' : /done|complete|finished|launched|shipped/i.test(value) ? 'green' : 'blue') : o.color ?? 'default';
        return { id: newId(), value, color };
      });
      const groupOf = (v: string) => (/done|complete|finished|launched|shipped|read$/i.test(v) ? 2 : /progress|doing|reading|active|review|planning|started/i.test(v) && !/not started/i.test(v) ? 1 : 0);
      out.options = opts;
      out.groups = s.groups.map((g, gi) => ({ ...g, optionIds: opts.filter((o) => groupOf(o.value) === gi).map((o) => o.id) }));
      out.defaultOption = opts[0]?.value;
    } else {
      out.options = s.options;
      out.groups = s.groups;
      out.defaultOption = s.defaultOption;
    }
  } else if (p.type === 'select' || p.type === 'multi_select') {
    out.options = (p.options ?? []).map((o, i) => (typeof o === 'string' ? { id: newId(), value: o, color: COLORS[(i + 1) % COLORS.length] } : { id: newId(), value: o.value, color: o.color ?? COLORS[(i + 1) % COLORS.length] }));
  } else if (p.type === 'number') {
    out.number_format = p.number_format ?? 'number';
  }
  return out;
}

export function encodeRowValue(prop: PropertySchema, v: RowValue): RichText | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  switch (prop.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number':
      return encodeText(String(v));
    case 'number':
      return encodeNumber(typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, '')));
    case 'checkbox':
      return encodeCheckbox(v === true || /^(yes|true|x|1|checked|✓|✅)$/i.test(String(v)));
    case 'select':
    case 'status':
      return encodeSelect([Array.isArray(v) ? String(v[0] ?? '') : String(v)]);
    case 'multi_select':
      return encodeSelect(Array.isArray(v) ? v.map(String) : String(v).split(',').map((s) => s.trim()));
    case 'date': {
      if (typeof v === 'object' && !Array.isArray(v)) {
        const d = v as { date: string; end?: string };
        const val: DateValue = d.end ? { type: 'daterange', start_date: d.date, end_date: d.end } : { type: 'date', start_date: d.date };
        return encodeDate(val);
      }
      return encodeDate({ type: 'date', start_date: String(v) });
    }
    default:
      return encodeText(String(v));
  }
}

/** ISO date (YYYY-MM-DD) offset by n days from today (template sample data stays current). */
export function dayOffset(n: number, base = Date.now()): string {
  const d = new Date(base + n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

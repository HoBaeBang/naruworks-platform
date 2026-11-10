// Public API objects: user, page (+ property values), block, database, data source,
// comment. Everything is read as the calling principal: blocks it can't see are never serialized, database rows and
// data source schemas pass through the property access rules (propaccess.ts) first, relation ids and mentions of pages
// it can't open are dropped / shown as "Untitled".
import type { BlockRecord, CollectionRecord, CommentRecord, DiscussionRecord, PropertySchema, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import type { RichText, DateValue } from '@nc/shared/richtext.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getPropertyValue, decodeStored } from '@nc/shared/database/values.ts';
import type { DateRange, PropertyValue, QueryContext } from '@nc/shared/database/types.ts';
import { getRecord } from '../db.ts';
import { redactDatabaseRecord } from '../propaccess.ts';
import { viewerQueryContext } from '../queryctx.ts';
import { appUrl } from '../mail.ts';
import { pageLink } from '../notify.ts';
import { dateToApi, iso, toApiRichText, type ApiRichText } from './richtext.ts';
import type { Principal } from './principal.ts';

type Json = Record<string, unknown>;

export const PAGE_TYPES = new Set(['page', 'collection_view_page']);
export const DATABASE_TYPES = new Set(['collection_view_page', 'collection_view']);

const userRef = (id: string | undefined | null) => ({ object: 'user', id: id ?? '' });

// ---------------------------------------------------------------- users

export function userObject(userId: string, p: Principal): Json {
  const u = getRecord<UserRecord>('lit_user', userId) as (UserRecord & { bot?: Record<string, unknown> }) | undefined;
  if (!u) return userRef(userId);
  if (p.caps.user_info === 'none' && userId !== p.id) return userRef(userId);
  const avatar = typeof u.profile_photo === 'string' && u.profile_photo ? absoluteUrl(u.profile_photo) : null;
  if (u.bot) {
    const space = getRecord<SpaceRecord>('space', String(u.bot.space_id ?? ''));
    return {
      object: 'user', id: u.id, name: u.name ?? '', avatar_url: avatar, type: 'bot',
      bot: { owner: { type: 'workspace', workspace: true }, workspace_name: space?.name ?? null, workspace_limits: { max_file_upload_size_in_bytes: 5_242_880 } },
    };
  }
  const person: Json = {};
  if (p.caps.user_info === 'with_email' && u.email) person.email = u.email;
  return { object: 'user', id: u.id, name: u.name ?? '', avatar_url: avatar, type: 'person', person };
}

export function absoluteUrl(u: string): string {
  return u.startsWith('/') ? appUrl(u) : u;
}

/** Stored file / external URL → file object ({ type: "file", file: { url, expiry_time } } | external). */
export function fileObject(url: string, extra: Json = {}): Json {
  if (url.startsWith('/files/')) return { type: 'file', file: { url: absoluteUrl(url), expiry_time: new Date(Date.now() + 3600_000).toISOString() }, ...extra };
  return { type: 'external', external: { url }, ...extra };
}

export function iconObject(icon: unknown): Json | null {
  if (typeof icon !== 'string' || !icon) return null;
  if (icon.startsWith('/') || /^https?:\/\//.test(icon)) return fileObject(icon);
  return { type: 'emoji', emoji: icon };
}

export function coverObject(cover: unknown): Json | null {
  if (typeof cover !== 'string' || !cover) return null;
  return fileObject(cover);
}

// ---------------------------------------------------------------- reading context (permission-checked)

export interface ReadCtx {
  p: Principal;
  query: QueryContext;
  canRead(id: string | undefined): boolean;
  /** a database row / data source as the principal may see it (property access rules applied) */
  row(b: BlockRecord): BlockRecord;
  collection(c: CollectionRecord): CollectionRecord;
}

/** The principal's view (queryctx.ts viewerQueryContext — shared with search, exports and queryRows): rows it
 * can't open (page-level row access rules) are left out and property values it can't see are redacted, so filters,
 * sorts, formulas, relations and rollups never read them. A connection's bot resolves through its grants
 * (access.ts registerPrincipalResolver). */
export function readCtx(p: Principal): ReadCtx {
  const query = viewerQueryContext(p.id);
  const row = (b: BlockRecord) => redactDatabaseRecord('block', b, p.id) as BlockRecord;
  const collection = (c: CollectionRecord) => redactDatabaseRecord('collection', c, p.id) as CollectionRecord;
  return { p, query, canRead: query.canRead, row, collection };
}

// ---------------------------------------------------------------- parents

/** API parent of a block / page / database. */
export function parentObject(b: BlockRecord, p: Principal): Json {
  const pt = b.parent_table as string;
  if (pt === 'collection') {
    const col = getRecord<CollectionRecord>('collection', b.parent_id);
    const dbId = col?.parent_id ?? b.parent_id;
    return { type: 'data_source_id', data_source_id: b.parent_id, database_id: dbId };
  }
  if (pt === 'block') {
    const parent = getRecord<BlockRecord>('block', b.parent_id);
    if (parent && PAGE_TYPES.has(parent.type) && parent.type !== 'collection_view_page') return { type: 'page_id', page_id: parent.id };
    return { type: 'block_id', block_id: b.parent_id };
  }
  return { type: 'workspace', workspace: true };
}

function trashFields(b: { alive?: boolean }) {
  const inTrash = b.alive === false;
  return { archived: inTrash, in_trash: inTrash };
}

function audit(b: BlockRecord): Json {
  return {
    created_time: iso(b.created_time), last_edited_time: iso(b.last_edited_time ?? b.created_time),
    created_by: userRef(b.created_by_id), last_edited_by: userRef((b.last_edited_by_id as string | undefined) ?? b.created_by_id),
  };
}

// ---------------------------------------------------------------- property values

function rangeToApi(r: DateRange | null | undefined): Json | null {
  if (!r) return null;
  if (r.raw) return dateToApi(r.raw);
  const one = (d: string | undefined, t: string | undefined) => (d ? (t ? `${d}T${t}:00.000+00:00` : d) : null);
  return { start: one(r.start, r.hasTime ? r.startTime : undefined), end: r.isRange ? one(r.end ?? r.start, r.hasTime ? r.endTime : undefined) : null, time_zone: r.timeZone ?? null };
}

function optionObject(o: { id: string; value: string; color?: string; description?: string } | null | undefined): Json | null {
  if (!o) return null;
  return { id: o.id || o.value, name: o.value, color: o.color || 'default' };
}

function formulaResult(v: PropertyValue): Json {
  switch (v.kind) {
    case 'number': return { type: 'number', number: v.number };
    case 'checkbox': return { type: 'boolean', boolean: v.checked };
    case 'date': return { type: 'date', date: rangeToApi(v.date) };
    case 'text': return { type: 'string', string: v.text || null };
    case 'select': return { type: 'string', string: v.options.map((o) => o.value).join(', ') || null };
    case 'status': return { type: 'string', string: v.option?.value ?? null };
    case 'person': case 'relation': return { type: 'string', string: null };
    case 'error': return { type: 'string', string: null };
    default: return { type: 'string', string: null };
  }
}

function rollupResult(v: PropertyValue, fn: string, ctx: ReadCtx): Json {
  if (v.kind === 'number') return { type: 'number', number: v.number, function: fn };
  if (v.kind === 'date') return { type: 'date', date: rangeToApi(v.date), function: fn };
  if (v.kind === 'array') return { type: 'array', array: v.items.slice(0, 25).map((x) => arrayItem(x, ctx)), function: fn };
  return { type: 'array', array: [arrayItem(v, ctx)], function: fn };
}

function arrayItem(v: PropertyValue, ctx: ReadCtx): Json {
  switch (v.kind) {
    case 'number': return { type: 'number', number: v.number };
    case 'checkbox': return { type: 'checkbox', checkbox: v.checked };
    case 'date': return { type: 'date', date: rangeToApi(v.date) };
    case 'select': return { type: 'multi_select', multi_select: v.options.map(optionObject) };
    case 'status': return { type: 'status', status: optionObject(v.option) };
    case 'person': return { type: 'people', people: v.ids.map((id) => userObject(id, ctx.p)) };
    case 'relation': return { type: 'relation', relation: v.ids.filter((id) => ctx.canRead(id)).map((id) => ({ id })) };
    case 'text': return { type: 'rich_text', rich_text: v.rich ? toApiRichText(v.rich, { principalId: ctx.p.id }) : (v.text ? [{ type: 'text', text: { content: v.text, link: null }, annotations: plainAnnotations(), plain_text: v.text, href: null }] : []) };
    default: return { type: 'rich_text', rich_text: [] };
  }
}

const plainAnnotations = () => ({ bold: false, italic: false, strikethrough: false, underline: false, code: false, color: 'default' });

/** Property ids are URL-safe in responses. */
export const apiPropId = (pid: string) => encodeURIComponent(pid);

/** One property value of a (redacted) row. */
export function propertyValueObject(row: BlockRecord, pid: string, prop: PropertySchema, schema: Record<string, PropertySchema>, ctx: ReadCtx): Json {
  const id = apiPropId(pid);
  const raw = (pid === 'title' || prop.type === 'title' ? row.properties?.title : row.properties?.[pid]) as RichText | undefined;
  const reader = { principalId: ctx.p.id };
  switch (prop.type) {
    case 'title': return { id: 'title', type: 'title', title: toApiRichText(raw, reader) };
    case 'text': return { id, type: 'rich_text', rich_text: toApiRichText(raw, reader) };
    case 'number': { const v = decodeStored(raw, prop); return { id, type: 'number', number: v.kind === 'number' ? v.number : null }; }
    case 'select': { const v = decodeStored(raw, prop); return { id, type: 'select', select: v.kind === 'select' ? optionObject(v.options[0]) : null }; }
    case 'multi_select': { const v = decodeStored(raw, prop); return { id, type: 'multi_select', multi_select: v.kind === 'select' ? v.options.map(optionObject) : [] }; }
    case 'status': { const v = decodeStored(raw, prop); return { id, type: 'status', status: v.kind === 'status' ? optionObject(v.option) : null }; }
    case 'date': {
      const d = (raw ?? []).flatMap((x) => (x[1] ?? []) as unknown[][]).find((a) => a?.[0] === 'd')?.[1] as DateValue | undefined;
      return { id, type: 'date', date: dateToApi(d) };
    }
    case 'person': { const v = decodeStored(raw, prop); return { id, type: 'people', people: v.kind === 'person' ? v.ids.map((u) => userObject(u, ctx.p)) : [] }; }
    case 'file': {
      const v = decodeStored(raw, prop, row, ctx.query);
      return { id, type: 'files', files: v.kind === 'file' ? v.files.filter((f) => f.url).map((f) => fileObject(f.url, { name: f.name })) : [] };
    }
    case 'checkbox': { const v = decodeStored(raw, prop); return { id, type: 'checkbox', checkbox: v.kind === 'checkbox' && v.checked }; }
    case 'url': return { id, type: 'url', url: toPlainText(raw) || null };
    case 'email': return { id, type: 'email', email: toPlainText(raw) || null };
    case 'phone_number': return { id, type: 'phone_number', phone_number: toPlainText(raw) || null };
    case 'formula': return { id, type: 'formula', formula: formulaResult(getPropertyValue(row, pid, schema, ctx.query)) };
    case 'relation': {
      const v = decodeStored(raw, prop);
      const ids = v.kind === 'relation' ? v.ids.filter((x) => ctx.canRead(x)) : [];
      return { id, type: 'relation', relation: ids.map((x) => ({ id: x })), has_more: false };
    }
    case 'rollup': return { id, type: 'rollup', rollup: rollupResult(getPropertyValue(row, pid, schema, ctx.query), String(prop.aggregation ?? 'show_original'), ctx) };
    case 'created_time': return { id, type: 'created_time', created_time: iso(row.created_time) };
    case 'last_edited_time': return { id, type: 'last_edited_time', last_edited_time: iso(row.last_edited_time ?? row.created_time) };
    case 'created_by': return { id, type: 'created_by', created_by: userObject(row.created_by_id, ctx.p) };
    case 'last_edited_by': return { id, type: 'last_edited_by', last_edited_by: userObject((row.last_edited_by_id as string | undefined) ?? row.created_by_id, ctx.p) };
    case 'auto_increment_id': {
      const v = decodeStored(raw, prop);
      return { id, type: 'unique_id', unique_id: { prefix: prop.prefix ? String(prop.prefix) : null, number: v.kind === 'number' ? v.number : null } };
    }
    case 'verification': {
      const v = decodeStored(raw, prop, row, ctx.query);
      if (v.kind !== 'verification') return { id, type: 'verification', verification: { state: 'unverified', verified_by: null, date: null } };
      return { id, type: 'verification', verification: { state: v.state === 'none' ? 'unverified' : v.state, verified_by: v.by ? userObject(v.by, ctx.p) : null, date: rangeToApi(v.date ?? null) } };
    }
    case 'button': return { id, type: 'button', button: {} };
    case 'place': case 'location': {
      const v = decodeStored(raw, prop, row, ctx.query);
      return { id, type: 'place', place: v.kind === 'place' ? v.place : null };
    }
    default: return { id, type: prop.type, [prop.type]: null };
  }
}

// ---------------------------------------------------------------- pages

function pageTitle(b: BlockRecord): RichText {
  if (b.type === 'collection_view_page' && b.collection_id) return (getRecord<CollectionRecord>('collection', b.collection_id)?.name ?? []) as RichText;
  return (b.properties?.title ?? []) as RichText;
}

/** Page object of a page or database row (`b` must be readable by the principal). */
export function pageObject(b0: BlockRecord, ctx: ReadCtx): Json {
  const isRow = b0.parent_table === 'collection';
  const b = isRow ? ctx.row(b0) : b0;
  const fmt = (b.format ?? {}) as Json;
  const properties: Json = {};
  if (isRow) {
    const col = getRecord<CollectionRecord>('collection', b.parent_id);
    const schema = col ? ctx.collection(col).schema : {};
    for (const [pid, prop] of Object.entries(schema)) {
      if (!prop) continue;
      properties[prop.name || pid] = propertyValueObject(b, pid, prop, schema, ctx);
    }
  } else {
    properties.title = { id: 'title', type: 'title', title: toApiRichText(pageTitle(b), { principalId: ctx.p.id }) };
  }
  return {
    object: 'page', id: b.id, ...audit(b),
    cover: coverObject(fmt.page_cover), icon: iconObject(fmt.page_icon),
    parent: parentObject(b, ctx.p), ...trashFields(b), is_locked: !!fmt.block_locked,
    properties, url: pageLink(b.id), public_url: null,
  };
}

// ---------------------------------------------------------------- blocks

const TEXT_TYPES: Record<string, string> = {
  text: 'paragraph', header: 'heading_1', sub_header: 'heading_2', sub_sub_header: 'heading_3', header_4: 'heading_4',
  bulleted_list: 'bulleted_list_item', numbered_list: 'numbered_list_item', to_do: 'to_do', toggle: 'toggle', quote: 'quote', callout: 'callout',
};
export const API_TEXT_TYPES: Record<string, string> = Object.fromEntries(Object.entries(TEXT_TYPES).map(([k, v]) => [v, k]));

function colorOf(b: BlockRecord): string {
  const c = (b.format as Json | undefined)?.block_color;
  return typeof c === 'string' && c ? c : 'default';
}

function aliveChildren(b: BlockRecord): string[] {
  return (b.content ?? []).filter((id) => {
    const c = getRecord<BlockRecord>('block', id);
    return !!c && c.alive !== false && c.parent_id === b.id;
  });
}

/** API block type of a stored block. */
export function apiBlockType(b: BlockRecord): string {
  if (TEXT_TYPES[b.type]) return TEXT_TYPES[b.type];
  switch (b.type as string) {
    case 'page': return 'child_page';
    case 'collection_view_page': case 'collection_view': return 'child_database';
    case 'transclusion_container': case 'transclusion_reference': return 'synced_block';
    case 'alias': case 'link_to_page': return 'link_to_page';
    case 'meeting_notes': case 'transcription': return 'transcription';
    case 'divider': case 'code': case 'equation': case 'table': case 'table_row': case 'column_list': case 'column': case 'image': case 'video':
    case 'audio': case 'file': case 'pdf': case 'bookmark': case 'embed': case 'table_of_contents': case 'breadcrumb':
      return b.type;
    default: return 'unsupported';
  }
}

function captionOf(b: BlockRecord, ctx: ReadCtx): ApiRichText[] {
  return toApiRichText(b.properties?.caption as RichText | undefined, { principalId: ctx.p.id });
}

function sourceOf(b: BlockRecord): string {
  const fmt = (b.format ?? {}) as Json;
  return String(fmt.display_source ?? toPlainText(b.properties?.source as RichText | undefined) ?? '');
}

/** Block object (`b` readable). Meeting notes use the "transcription" block. */
export function blockObject(b: BlockRecord, ctx: ReadCtx): Json {
  const type = apiBlockType(b);
  const fmt = (b.format ?? {}) as Json;
  const reader = { principalId: ctx.p.id };
  const rich = () => toApiRichText(b.properties?.title as RichText | undefined, reader);
  let content: Json = {};
  if (TEXT_TYPES[b.type]) {
    content = { rich_text: rich(), color: colorOf(b) };
    if (b.type === 'to_do') content.checked = toPlainText(b.properties?.checked as RichText | undefined).trim() === 'Yes';
    if (b.type.startsWith('header') || b.type === 'sub_header' || b.type === 'sub_sub_header') content.is_toggleable = !!fmt.toggleable;
    if (b.type === 'callout') content.icon = iconObject(fmt.page_icon);
  } else {
    switch (type) {
      case 'child_page': content = { title: toPlainText(b.properties?.title as RichText | undefined).replace(/[‣⁍]/g, '') }; break;
      case 'child_database': {
        const col = b.collection_id ? getRecord<CollectionRecord>('collection', b.collection_id) : undefined;
        content = { title: toPlainText(col?.name as RichText | undefined) };
        break;
      }
      case 'code': content = { rich_text: rich(), caption: captionOf(b, ctx), language: (toPlainText(b.properties?.language as RichText | undefined) || 'plain text').toLowerCase() }; break;
      case 'equation': content = { expression: toPlainText(b.properties?.title as RichText | undefined) }; break;
      case 'divider': case 'breadcrumb': case 'column_list': content = {}; break;
      case 'column': content = typeof fmt.column_ratio === 'number' ? { width_ratio: fmt.column_ratio } : {}; break;
      case 'table_of_contents': content = { color: colorOf(b) }; break;
      case 'table': content = {
        table_width: ((fmt.table_block_column_order as string[] | undefined) ?? []).length,
        has_column_header: !!fmt.table_block_column_header, has_row_header: !!fmt.table_block_row_header,
      }; break;
      case 'table_row': {
        const parent = getRecord<BlockRecord>('block', b.parent_id);
        const order = ((parent?.format as Json | undefined)?.table_block_column_order as string[] | undefined) ?? [];
        content = { cells: order.map((c) => toApiRichText(b.properties?.[c] as RichText | undefined, reader)) };
        break;
      }
      case 'image': case 'video': case 'audio': case 'pdf': case 'file': {
        const src = sourceOf(b);
        content = { caption: captionOf(b, ctx), ...(src ? fileObject(src) : { type: 'external', external: { url: '' } }) };
        if (type === 'file') content.name = toPlainText(b.properties?.title as RichText | undefined) || src.split('/').pop() || 'File';
        break;
      }
      case 'bookmark': case 'embed': content = { caption: captionOf(b, ctx), url: toPlainText((b.properties?.link ?? b.properties?.source) as RichText | undefined) || sourceOf(b) }; break;
      case 'link_to_page': {
        const target = String((fmt.alias_pointer as Json | undefined)?.id ?? '');
        const tb = getRecord<BlockRecord>('block', target);
        content = tb && DATABASE_TYPES.has(tb.type) ? { type: 'database_id', database_id: target } : { type: 'page_id', page_id: target };
        break;
      }
      case 'synced_block': {
        const src = String((fmt.transclusion_reference_pointer as Json | undefined)?.id ?? '');
        content = { synced_from: b.type === 'transclusion_reference' && src ? { type: 'block_id', block_id: src } : null };
        break;
      }
      case 'transcription': content = transcriptionContent(b, ctx); break;
      default: content = {};
    }
  }
  return {
    object: 'block', id: b.id, parent: parentObject(b, ctx.p), ...audit(b),
    has_children: type === 'child_page' || type === 'child_database' ? false : aliveChildren(b).length > 0,
    ...trashFields(b), type, [type]: content,
  };
}

/** AI Meeting Notes block: title, status and the ids of its summary / notes / transcript sections. */
function transcriptionContent(b: BlockRecord, ctx: ReadCtx): Json {
  const fmt = (b.format ?? {}) as Json;
  const st = (fmt.transcription_state ?? {}) as Json;
  const id = (k: string) => {
    const v = fmt[k];
    return typeof v === 'string' && ctx.canRead(v) ? v : null;
  };
  return {
    title: toApiRichText(b.properties?.title as RichText | undefined, { principalId: ctx.p.id }),
    status: typeof st.state === 'string' ? st.state : 'notes_ready',
    children: { summary_block_id: id('transcription_summary_id'), notes_block_id: id('transcription_notes_id'), transcript_block_id: id('transcription_transcript_id') },
    calendar_event: null,
    recording: { start_time: typeof st.started_time === 'number' ? iso(st.started_time) : null, end_time: typeof st.stopped_time === 'number' ? iso(st.stopped_time) : null },
  };
}

// ---------------------------------------------------------------- databases / data sources

export function schemaPropertyObject(pid: string, prop: PropertySchema, p: Principal): Json {
  const base = { id: pid === 'title' ? 'title' : apiPropId(pid), name: prop.name, description: typeof prop.description === 'string' ? prop.description : null };
  const options = () => (prop.options ?? []).map((o) => ({ id: o.id, name: o.value, color: o.color || 'default', description: o.description ?? null }));
  switch (prop.type) {
    case 'title': return { ...base, type: 'title', title: {} };
    case 'text': return { ...base, type: 'rich_text', rich_text: {} };
    case 'number': return { ...base, type: 'number', number: { format: prop.number_format ?? 'number' } };
    case 'select': return { ...base, type: 'select', select: { options: options() } };
    case 'multi_select': return { ...base, type: 'multi_select', multi_select: { options: options() } };
    case 'status': return { ...base, type: 'status', status: { options: options(), groups: (prop.groups ?? []).map((g) => ({ id: g.id, name: g.name, color: g.color, option_ids: g.optionIds })) } };
    case 'person': return { ...base, type: 'people', people: {} };
    case 'file': return { ...base, type: 'files', files: {} };
    case 'formula': return { ...base, type: 'formula', formula: { expression: String(prop.formula?.expression ?? '') } };
    case 'relation': {
      const target = prop.collection_id ? getRecord<CollectionRecord>('collection', prop.collection_id) : undefined;
      const rel: Json = { data_source_id: prop.collection_id ?? null, database_id: target?.parent_id ?? null };
      if (prop.property) {
        rel.type = 'dual_property';
        rel.dual_property = { synced_property_id: apiPropId(String(prop.property)), synced_property_name: target?.schema?.[String(prop.property)]?.name ?? '' };
      } else {
        rel.type = 'single_property';
        rel.single_property = {};
      }
      return { ...base, type: 'relation', relation: rel };
    }
    case 'rollup': return {
      ...base, type: 'rollup', rollup: {
        relation_property_id: prop.relation_property ? apiPropId(String(prop.relation_property)) : null, relation_property_name: null,
        rollup_property_id: prop.target_property ? apiPropId(String(prop.target_property)) : null, rollup_property_name: null,
        function: String(prop.aggregation ?? 'show_original'),
      },
    };
    case 'auto_increment_id': return { ...base, type: 'unique_id', unique_id: { prefix: prop.prefix ? String(prop.prefix) : null } };
    case 'place': case 'location': return { ...base, type: 'place', place: {} };
    default: return { ...base, type: prop.type, [prop.type]: {} };
  }
}

function schemaObject(col: CollectionRecord, p: Principal): Json {
  const out: Json = {};
  for (const [pid, prop] of Object.entries(col.schema ?? {})) if (prop) out[prop.name || pid] = schemaPropertyObject(pid, prop, p);
  return out;
}

/** Database object, including its data source. */
export function databaseObject(block: BlockRecord, ctx: ReadCtx): Json {
  const col0 = block.collection_id ? getRecord<CollectionRecord>('collection', block.collection_id) : undefined;
  const col = col0 ? ctx.collection(col0) : undefined;
  const fmt = (block.format ?? {}) as Json;
  const reader = { principalId: ctx.p.id };
  const out: Json = {
    object: 'database', id: block.id, ...audit(block),
    title: toApiRichText((col?.name ?? []) as RichText, reader), description: toApiRichText((col?.description ?? []) as RichText, reader),
    icon: iconObject(fmt.page_icon ?? col?.icon), cover: coverObject(fmt.page_cover ?? col?.cover),
    parent: parentObject(block, ctx.p), url: pageLink(block.id), public_url: null, ...trashFields(block),
    is_inline: block.type === 'collection_view', is_locked: !!fmt.block_locked,
  };
  out.data_sources = col ? [{ id: col.id, name: toPlainText(col.name as RichText | undefined) }] : [];
  return out;
}

export function dataSourceObject(col0: CollectionRecord, ctx: ReadCtx): Json {
  const col = ctx.collection(col0);
  const block = getRecord<BlockRecord>('block', col.parent_id);
  const reader = { principalId: ctx.p.id };
  const parent = block ? parentObject(block, ctx.p) : { type: 'workspace', workspace: true };
  return {
    object: 'data_source', id: col.id,
    created_time: iso((col.created_time as number | undefined) ?? block?.created_time), last_edited_time: iso((col.last_edited_time as number | undefined) ?? block?.last_edited_time),
    created_by: userRef(block?.created_by_id), last_edited_by: userRef((block?.last_edited_by_id as string | undefined) ?? block?.created_by_id),
    properties: schemaObject(col, ctx.p),
    parent: { type: 'database_id', database_id: col.parent_id }, database_parent: parent,
    title: toApiRichText((col.name ?? []) as RichText, reader), description: toApiRichText((col.description ?? []) as RichText, reader),
    icon: iconObject(col.icon), ...trashFields({ alive: col.alive !== false && block?.alive !== false }),
    url: block ? pageLink(block.id) : null, public_url: null,
  };
}

// ---------------------------------------------------------------- comments

export function commentObject(c: CommentRecord, d: DiscussionRecord, ctx: ReadCtx): Json {
  const target = getRecord<BlockRecord>('block', d.parent_id);
  const parent = target && PAGE_TYPES.has(target.type) ? { type: 'page_id', page_id: target.id } : { type: 'block_id', block_id: d.parent_id };
  return {
    object: 'comment', id: c.id, parent, discussion_id: d.id,
    created_time: iso(c.created_time), last_edited_time: iso(c.last_edited_time ?? c.created_time),
    created_by: userRef(c.created_by_id), rich_text: toApiRichText(c.text as RichText, { principalId: ctx.p.id }),
    display_name: { type: 'user', resolved_name: getRecord<UserRecord>('lit_user', c.created_by_id)?.name ?? '' },
  };
}

export function listObject(results: unknown[], nextCursor: string | null, type: string): Json {
  return { object: 'list', results, next_cursor: nextCursor, has_more: !!nextCursor, type, [type]: {}, request_id: '' };
}

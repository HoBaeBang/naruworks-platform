// "Send webhook" body (help: webhook-actions): a POST with the page in Litpage's public API shape —
// { source: {type, automation_id, action_id, event_id, attempt}, data: { object:"page", id, …, properties } } —
// only database page properties are sent (no page content), restricted to the properties the step selected.
import type { BlockRecord, CollectionRecord, PropertySchema } from '../records.ts';
import type { RichText } from '../richtext.ts';
import { decodeStored, getPropertyValue, valueToText, type PropertyValue, type QueryContext } from '../database/index.ts';
import { compactId } from '../ids.ts';

const NOT_SENDABLE = new Set(['button']);

/**
 * Custom header values are write-only secrets (API tokens): records of automations, button blocks and button
 * properties only carry this placeholder for a stored value; the server keeps the value and applies it when the
 * webhook fires (apps/server/src/webhookSecrets.ts). Saving the placeholder back keeps the stored value.
 */
export const WEBHOOK_SECRET_MASK = '••••••••';

function richTextJson(rt: RichText | undefined, ctx?: QueryContext) {
  const out: unknown[] = [];
  for (const d of rt ?? []) {
    const anns = (d[1] ?? []) as unknown[][];
    const atom = anns.find((a) => a[0] === 'u' || a[0] === 'p' || a[0] === 'd');
    if (atom?.[0] === 'u') out.push({ type: 'mention', mention: { type: 'user', user: { object: 'user', id: atom[1] } }, plain_text: ctx?.getRecord?.('lit_user', String(atom[1]))?.name ?? '' });
    else if (atom?.[0] === 'p') out.push({ type: 'mention', mention: { type: 'page', page: { id: atom[1] } }, plain_text: (ctx?.getRecord?.('block', String(atom[1]))?.properties?.title ?? []).map((x: RichText[number]) => x[0]).join('') || 'Untitled' });
    else if (atom?.[0] === 'd') {
      const dv = atom[1] as { start_date?: string; end_date?: string; start_time?: string };
      out.push({ type: 'mention', mention: { type: 'date', date: { start: dv?.start_date ?? null, end: dv?.end_date ?? null } }, plain_text: dv?.start_date ?? '' });
    } else {
      const link = anns.find((a) => a[0] === 'a');
      out.push({
        type: 'text', text: { content: d[0], link: link ? { url: link[1] } : null }, plain_text: d[0], href: link ? link[1] : null,
        annotations: { bold: anns.some((a) => a[0] === 'b'), italic: anns.some((a) => a[0] === 'i'), strikethrough: anns.some((a) => a[0] === 's'), underline: anns.some((a) => a[0] === '_'), code: anns.some((a) => a[0] === 'c'), color: (anns.find((a) => a[0] === 'h')?.[1] as string | undefined) ?? 'default' },
      });
    }
  }
  return out;
}

function dateJson(v: PropertyValue) {
  if (v.kind !== 'date' || !v.date) return null;
  const d = v.date;
  const start = d.hasTime ? `${d.start}T${d.startTime ?? '00:00'}:00.000` : d.start;
  const end = d.isRange ? (d.hasTime ? `${d.end}T${d.endTime ?? '00:00'}:00.000` : d.end ?? null) : null;
  return { start, end, time_zone: d.timeZone ?? null };
}

/** One property in the public API's page-property shape. */
export function propertyJson(row: BlockRecord, id: string, prop: PropertySchema, schema: Record<string, PropertySchema>, ctx?: QueryContext): Record<string, unknown> {
  const raw = (id === 'title' || prop.type === 'title' ? row.properties?.title : row.properties?.[id]) as RichText | undefined;
  const v = getPropertyValue(row, id, schema, ctx);
  const base = { id, type: prop.type === 'person' ? 'people' : prop.type === 'file' ? 'files' : prop.type === 'auto_increment_id' ? 'unique_id' : prop.type === 'text' ? 'rich_text' : prop.type };
  switch (prop.type) {
    case 'title': return { ...base, title: richTextJson(raw, ctx) };
    case 'text': return { ...base, rich_text: richTextJson(raw, ctx) };
    case 'number': return { ...base, number: v.kind === 'number' ? v.number : null };
    case 'checkbox': return { ...base, checkbox: v.kind === 'checkbox' ? v.checked : false };
    case 'select': {
      const o = v.kind === 'select' ? v.options[0] : undefined;
      return { ...base, select: o ? { id: o.id, name: o.value, color: o.color ?? 'default' } : null };
    }
    case 'multi_select': return { ...base, multi_select: v.kind === 'select' ? v.options.map((o) => ({ id: o.id, name: o.value, color: o.color ?? 'default' })) : [] };
    case 'status': {
      const o = v.kind === 'status' ? v.option : null;
      return { ...base, status: o ? { id: o.id, name: o.value, color: o.color ?? 'default' } : null };
    }
    case 'date': return { ...base, date: dateJson(v) };
    case 'person': return { ...base, people: v.kind === 'person' ? v.ids.map((uid) => ({ object: 'user', id: uid })) : [] };
    case 'relation': return { ...base, relation: v.kind === 'relation' ? v.ids.map((pid) => ({ id: pid })) : [], has_more: false };
    case 'url': case 'email': case 'phone_number': {
      const s = valueToText(decodeStored(raw, prop), prop, ctx);
      return { ...base, [prop.type]: s || null };
    }
    case 'file': return { ...base, files: v.kind === 'file' ? v.files.map((f) => ({ name: f.name, type: 'external', external: { url: f.url } })) : [] };
    case 'created_time': return { ...base, created_time: new Date(row.created_time).toISOString() };
    case 'last_edited_time': return { ...base, last_edited_time: new Date(row.last_edited_time).toISOString() };
    case 'created_by': return { ...base, created_by: { object: 'user', id: row.created_by_id } };
    case 'last_edited_by': return { ...base, last_edited_by: { object: 'user', id: row.last_edited_by_id } };
    case 'auto_increment_id': return { ...base, unique_id: { prefix: (prop.prefix as string | undefined) ?? null, number: v.kind === 'number' ? v.number : null } };
    case 'formula': {
      const t = v.kind === 'number' ? { type: 'number', number: v.number } : v.kind === 'checkbox' ? { type: 'boolean', boolean: v.checked } : v.kind === 'date' ? { type: 'date', date: dateJson(v) } : { type: 'string', string: valueToText(v, prop, ctx) };
      return { ...base, formula: t };
    }
    case 'rollup': return { ...base, rollup: v.kind === 'number' ? { type: 'number', number: v.number, function: String(prop.aggregation ?? '') } : { type: 'array', array: [], function: String(prop.aggregation ?? '') }, text: valueToText(v, prop, ctx) };
    default: return { ...base, text: valueToText(v, prop, ctx) };
  }
}

export interface WebhookMeta {
  automationId: string;
  actionId: string;
  eventId: string;
  attempt?: number;
  /** origin used for page urls */
  baseUrl?: string;
  sourceType?: 'automation' | 'button' | 'button_property';
}

export function webhookPayload(page: BlockRecord | undefined, collection: CollectionRecord | undefined, selected: string[] | 'all', meta: WebhookMeta, ctx?: QueryContext): Record<string, unknown> {
  const source = { type: meta.sourceType ?? 'automation', automation_id: meta.automationId, action_id: meta.actionId, event_id: meta.eventId, attempt: meta.attempt ?? 1 };
  if (!page) return { source, data: null };
  const properties: Record<string, unknown> = {};
  if (collection) {
    for (const [id, prop] of Object.entries(collection.schema)) {
      if (NOT_SENDABLE.has(prop.type)) continue;
      if (selected !== 'all' && !selected.includes(id)) continue;
      properties[prop.name] = propertyJson(page, id, prop, collection.schema, ctx);
    }
  }
  const icon = page.format?.page_icon;
  return {
    source,
    data: {
      object: 'page',
      id: page.id,
      created_time: new Date(page.created_time).toISOString(),
      last_edited_time: new Date(page.last_edited_time).toISOString(),
      created_by: { object: 'user', id: page.created_by_id },
      last_edited_by: { object: 'user', id: page.last_edited_by_id },
      cover: page.format?.page_cover ? { type: 'external', external: { url: page.format.page_cover } } : null,
      icon: icon ? (/^https?:/.test(String(icon)) ? { type: 'external', external: { url: icon } } : { type: 'emoji', emoji: icon }) : null,
      parent: page.parent_table === 'collection' ? { type: 'data_source_id', data_source_id: page.parent_id, database_id: collection?.parent_id ?? null } : { type: 'page_id', page_id: page.parent_id },
      archived: page.alive === false,
      in_trash: page.alive === false,
      properties,
      url: `${meta.baseUrl ?? ''}/${compactId(page.id)}`,
      public_url: null,
    },
  };
}

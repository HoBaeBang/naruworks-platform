// public API request bodies → stored records: block children (append / create page), page property values, icons and
// covers. Validation errors use Litpage's plain wording; anything that points at another record
// (mentions, relations, link_to_page, synced blocks) must be readable by the calling principal.
import { expandId, newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, PropertySchema, SelectOption, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { safeHref } from '@nc/shared/url.ts';
import { encodeCheckbox, encodeDate, encodeFiles, encodeNumber, encodePeople, encodeRelation, encodeSelect } from '@nc/shared/database/values.ts';
import type { Spec } from '../content/spec.ts';
import { getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { invalid } from './errors.ts';
import { COLORS, dateFromApi, fromApiRichText, type RichTextReader } from './richtext.ts';
import { API_TEXT_TYPES, apiPropId } from './objects.ts';
import { isIntegrationBot, integrationByBot } from './store.ts';

type Json = Record<string, any>;

export const MAX_CHILDREN = 100;
export const MAX_DEPTH = 2;
export const MAX_BLOCKS = 1000;

const CODE_LANGUAGES = ['ABAP', 'Agda', 'Arduino', 'ASCII Art', 'Assembly', 'Bash', 'BASIC', 'BNF', 'C', 'C#', 'C++', 'Clojure', 'CoffeeScript', 'CSS',
  'Dart', 'Dhall', 'Diff', 'Docker', 'EBNF', 'Elixir', 'Elm', 'Erlang', 'F#', 'Flow', 'Fortran', 'Gherkin', 'GLSL', 'Go', 'GraphQL', 'Groovy', 'Haskell',
  'HCL', 'HTML', 'Idris', 'Java', 'JavaScript', 'JSON', 'Julia', 'Kotlin', 'LaTeX', 'Less', 'Lisp', 'LiveScript', 'LLVM IR', 'Lua', 'Makefile', 'Markdown',
  'Markup', 'Mathematica', 'MATLAB', 'Mermaid', 'Nix', 'Litpage Formula', 'Objective-C', 'OCaml', 'Pascal', 'Perl', 'PHP', 'Plain Text', 'PowerShell',
  'Prolog', 'Protobuf', 'PureScript', 'Python', 'R', 'Racket', 'Reason', 'Rocq', 'Ruby', 'Rust', 'Sass', 'Scala', 'Scheme', 'SCSS', 'Shell', 'Smalltalk',
  'Solidity', 'SQL', 'Swift', 'TOML', 'TypeScript', 'VB.Net', 'Verilog', 'VHDL', 'Visual Basic', 'WebAssembly', 'XML', 'YAML'];

export function codeLanguage(raw: unknown): string {
  const s = String(raw ?? 'plain text').trim().toLowerCase();
  return CODE_LANGUAGES.find((l) => l.toLowerCase() === s) ?? (s === 'c#' ? 'C#' : 'Plain Text');
}

function color(raw: unknown, path: string): string | undefined {
  if (raw === undefined || raw === null || raw === 'default') return undefined;
  if (typeof raw !== 'string' || !COLORS.includes(raw)) throw invalid(`Invalid request: ${path}.color must be a valid color, instead was \`${JSON.stringify(raw)}\`.`);
  return raw;
}

function httpUrl(raw: unknown, path: string): string {
  if (typeof raw !== 'string' || !/^https?:\/\//i.test(raw.trim()) || !safeHref(raw.trim()) || raw.length > 2000) {
    throw invalid(`Invalid request: ${path} must be a valid URL, instead was \`${JSON.stringify(raw)?.slice(0, 120)}\`.`);
  }
  return raw.trim();
}

/** { type: "emoji", emoji } | { type: "external", external: { url } } | null → stored page_icon. */
export function iconFromApi(raw: unknown, path = 'icon'): string | null {
  if (raw === null) return null;
  const o = (raw ?? {}) as Json;
  const type = o.type ?? (o.emoji ? 'emoji' : o.external ? 'external' : undefined);
  if (type === 'emoji' && typeof o.emoji === 'string' && o.emoji && [...o.emoji].length <= 8) return o.emoji;
  if (type === 'external') return httpUrl(o.external?.url, `${path}.external.url`);
  throw invalid(`Invalid request: ${path} must be an emoji or external icon.`);
}

export function coverFromApi(raw: unknown, path = 'cover'): string | null {
  if (raw === null) return null;
  const o = (raw ?? {}) as Json;
  if ((o.type ?? 'external') === 'external') return httpUrl(o.external?.url, `${path}.external.url`);
  throw invalid(`Invalid request: ${path} must be an external file.`);
}

interface Budget {
  blocks: number;
}

function readable(id: string, reader: RichTextReader): BlockRecord {
  const b = getRecord<BlockRecord>('block', id);
  if (!b || b.alive === false || blockRole(id, reader.principalId) === 'none') {
    throw invalid(`No block with id ${id} is available to this connection.`);
  }
  return b;
}

/** API block objects → specs (append children / create page). */
export function specsFromApi(raw: unknown, reader: RichTextReader, spaceId: string, path = 'children', depth = 0, budget: Budget = { blocks: 0 }): Spec[] {
  if (!Array.isArray(raw)) throw invalid(`Invalid request: ${path} must be an array, instead was \`${JSON.stringify(raw)?.slice(0, 80)}\`.`);
  if (raw.length > MAX_CHILDREN) throw invalid(`Invalid request: ${path}.length must be ≤ \`${MAX_CHILDREN}\`, instead was \`${raw.length}\`.`);
  if (depth > MAX_DEPTH) throw invalid(`Invalid request: ${path} exceeds the maximum nesting of ${MAX_DEPTH} levels per request.`);
  return raw.map((item, i) => specFromApi(item, reader, spaceId, `${path}[${i}]`, depth, budget));
}

function specFromApi(item: unknown, reader: RichTextReader, spaceId: string, path: string, depth: number, budget: Budget): Spec {
  if (!item || typeof item !== 'object') throw invalid(`Invalid request: ${path} must be an object.`);
  if (++budget.blocks > MAX_BLOCKS) throw invalid(`Invalid request: a request can contain at most ${MAX_BLOCKS} blocks.`);
  const o = item as Json;
  const type = String(o.type ?? Object.keys(o).find((k) => k !== 'object') ?? '');
  const body = (o[type] ?? {}) as Json;
  const kids = (): Spec[] | undefined => (body.children === undefined ? undefined : specsFromApi(body.children, reader, spaceId, `${path}.${type}.children`, depth + 1, budget));
  const rt = (k = 'rich_text') => fromApiRichText(body[k] ?? [], reader, `${path}.${type}.${k}`);
  const internal = API_TEXT_TYPES[type];
  if (internal) {
    const format: Json = {};
    const c = color(body.color, `${path}.${type}`);
    if (c) format.block_color = c;
    if (type.startsWith('heading_') && body.is_toggleable === true) format.toggleable = true;
    if (type === 'callout') format.page_icon = body.icon ? iconFromApi(body.icon, `${path}.callout.icon`) : '💡';
    const spec: Spec = { type: internal as Spec['type'], text: rt(), format, children: kids() };
    if (type === 'to_do') spec.checked = body.checked === true;
    return spec;
  }
  switch (type) {
    case 'divider': return { type: 'divider' };
    case 'breadcrumb': return { type: 'breadcrumb' };
    case 'table_of_contents': {
      const c = color(body.color, `${path}.${type}`);
      return { type: 'table_of_contents', format: c ? { block_color: c } : {} };
    }
    case 'equation': {
      if (typeof body.expression !== 'string' || !body.expression) throw invalid(`Invalid request: ${path}.equation.expression is required.`);
      return { type: 'equation', text: body.expression.slice(0, 5000) };
    }
    case 'code': {
      const text = toPlainText(rt()).slice(0, 100_000);
      return { type: 'code', text, language: codeLanguage(body.language), props: body.caption ? { caption: rt('caption') } : undefined };
    }
    case 'image': case 'video': case 'audio': case 'file': case 'pdf': {
      const url = httpUrl(body.external?.url ?? body.url, `${path}.${type}.external.url`);
      const spec: Spec = { type, url, props: body.caption ? { caption: rt('caption') } : undefined };
      if (type === 'file' && typeof body.name === 'string') spec.props = { ...(spec.props ?? {}), title: [[body.name.slice(0, 200)]] };
      return spec;
    }
    case 'bookmark': case 'embed':
      return { type, url: httpUrl(body.url, `${path}.${type}.url`), props: body.caption ? { caption: rt('caption') } : undefined };
    case 'table': {
      const width = Number(body.table_width);
      if (!Number.isInteger(width) || width < 1 || width > 50) throw invalid(`Invalid request: ${path}.table.table_width must be an integer between 1 and 50.`);
      const rows = Array.isArray(body.children) ? body.children : [];
      if (rows.length > MAX_CHILDREN) throw invalid(`Invalid request: ${path}.table.children.length must be ≤ \`${MAX_CHILDREN}\`.`);
      const table = rows.map((r: Json, ri: number) => {
        const cells = r?.table_row?.cells;
        if (r?.type && r.type !== 'table_row') throw invalid(`Invalid request: ${path}.table.children[${ri}] must be a table_row.`);
        if (!Array.isArray(cells) || cells.length !== width) throw invalid(`Invalid request: ${path}.table.children[${ri}].table_row.cells must have ${width} cells.`);
        budget.blocks++;
        return cells.map((c: unknown, ci: number) => fromApiRichText(c, reader, `${path}.table.children[${ri}].table_row.cells[${ci}]`));
      });
      if (!table.length) table.push(Array.from({ length: width }, () => [] as RichText));
      return { type: 'table', table, tableHeader: body.has_column_header === true, format: { table_block_row_header: body.has_row_header === true } };
    }
    case 'column_list': {
      const cols = specsFromApi(body.children ?? [], reader, spaceId, `${path}.column_list.children`, depth + 1, budget);
      if (cols.length < 2 || cols.some((c) => c.type !== 'column')) throw invalid(`Invalid request: ${path}.column_list.children must contain at least 2 column blocks.`);
      return { type: 'column_list', children: cols };
    }
    case 'column': {
      const ratio = typeof body.width_ratio === 'number' && body.width_ratio > 0 && body.width_ratio <= 1 ? body.width_ratio : undefined;
      return { type: 'column', format: ratio ? { column_ratio: ratio } : {}, children: kids() ?? [] };
    }
    case 'link_to_page': {
      const id = expandId(String(body.page_id ?? body.database_id ?? ''));
      readable(id, reader);
      return { type: 'alias', format: { alias_pointer: { id, table: 'block', spaceId } } };
    }
    case 'synced_block': {
      const from = body.synced_from?.block_id;
      if (from) {
        const src = readable(expandId(String(from)), reader);
        if (src.type !== 'transclusion_container') throw invalid(`Invalid request: ${path}.synced_block.synced_from.block_id must be an original synced block.`);
        return { type: 'transclusion_reference', format: { transclusion_reference_pointer: { id: src.id, table: 'block', spaceId } } };
      }
      return { type: 'transclusion_container', children: kids() ?? [] };
    }
    case 'child_page': case 'child_database':
      throw invalid(`Invalid request: ${path}.type \`${type}\` can’t be created by appending children. Use the pages or databases endpoint.`);
    default:
      throw invalid(`Invalid request: ${path}.type must be a supported block type, instead was \`${JSON.stringify(type)}\`.`);
  }
}

// ---------------------------------------------------------------- page properties

export interface EncodedProperties {
  title?: RichText;
  properties: Record<string, RichText | undefined>;
  /** select / multi-select options the call adds to the schema */
  schemaPatch: Record<string, PropertySchema>;
}

const READ_ONLY = new Set(['formula', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'auto_increment_id', 'button', 'verification', 'location']);
const OPTION_COLORS = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

/** Find a schema property by name or (URL-encoded) id. */
export function findProperty(schema: Record<string, PropertySchema>, key: string): string | undefined {
  if (schema[key]) return key;
  let dec = key;
  try {
    dec = decodeURIComponent(key);
  } catch {
    /* keep */
  }
  if (schema[dec]) return dec;
  if (key === 'title') return Object.keys(schema).find((k) => schema[k]?.type === 'title') ?? (schema.title ? 'title' : undefined);
  return Object.keys(schema).find((k) => schema[k]?.name === key);
}

function optionsInput(raw: unknown, path: string): { name?: string; id?: string; color?: string }[] {
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((x, i) => {
    if (!x || typeof x !== 'object') throw invalid(`Invalid request: ${path}[${i}] must be an object.`);
    const o = x as Json;
    if (typeof o.name !== 'string' && typeof o.id !== 'string') throw invalid(`Invalid request: ${path}[${i}] must have a name or id.`);
    if (typeof o.name === 'string' && (o.name.includes(',') || o.name.length > 100)) throw invalid(`Invalid request: ${path}[${i}].name can’t contain commas and must be ≤ 100 characters.`);
    return { name: o.name, id: o.id, color: o.color };
  });
}

function pickOptions(prop: PropertySchema, inputs: { name?: string; id?: string; color?: string }[], allowCreate: boolean, path: string): { names: string[]; options: SelectOption[] | null } {
  const opts = [...(prop.options ?? [])];
  let created = false;
  const names: string[] = [];
  for (const it of inputs) {
    const hit = opts.find((o) => (it.id && o.id === it.id) || (it.name !== undefined && o.value.toLowerCase() === it.name.toLowerCase()));
    if (hit) {
      names.push(hit.value);
      continue;
    }
    if (!allowCreate || !it.name) throw invalid(`Invalid request: ${path} option ${JSON.stringify(it.name ?? it.id)} does not exist.`);
    const o: SelectOption = { id: newId(), value: it.name.trim(), color: OPTION_COLORS.includes(String(it.color)) ? String(it.color) : OPTION_COLORS[(opts.length + 1) % OPTION_COLORS.length] };
    opts.push(o);
    names.push(o.value);
    created = true;
  }
  return { names, options: created ? opts : null };
}

function personIds(raw: unknown, spaceId: string, path: string): string[] {
  if (!Array.isArray(raw)) throw invalid(`Invalid request: ${path} must be an array.`);
  const space = getRecord<SpaceRecord>('space', spaceId);
  return raw.map((x, i) => {
    const id = expandId(String((x as Json)?.id ?? ''));
    const u = getRecord<UserRecord>('lit_user', id);
    const bot = isIntegrationBot(id) && integrationByBot(id)?.spaceId === spaceId;
    if (!u || (!isSpaceMember(space, id) && !bot)) throw invalid(`Invalid request: ${path}[${i}].id must be a user of this workspace.`);
    return id;
  });
}

/** API property values for a page of `col` (or a plain page when `col` is undefined: title only). */
export function propertiesFromApi(raw: unknown, col: CollectionRecord | undefined, reader: RichTextReader, spaceId: string, opts: { allowCreateOptions: boolean }): EncodedProperties {
  const out: EncodedProperties = { properties: {}, schemaPatch: {} };
  if (raw === undefined) return out;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('Invalid request: body.properties must be an object.');
  const schema: Record<string, PropertySchema> = col?.schema ?? { title: { name: 'title', type: 'title' } };
  for (const [key, value] of Object.entries(raw as Json)) {
    const pid = findProperty(schema, key);
    if (!pid) throw invalid(`No property named ${key} exists in this data source.`);
    const prop = out.schemaPatch[pid] ?? schema[pid];
    const path = `body.properties.${key}`;
    if (READ_ONLY.has(prop.type)) throw invalid(`${prop.name} is a ${prop.type} property and cannot be updated.`);
    const v = (value ?? {}) as Json;
    const field = (name: string) => (Object.hasOwn(v, name) ? v[name] : v);
    switch (prop.type) {
      case 'title': {
        out.title = fromApiRichText(field('title'), reader, `${path}.title`);
        break;
      }
      case 'text': out.properties[pid] = fromApiRichText(field('rich_text'), reader, `${path}.rich_text`); break;
      case 'number': {
        const n = field('number');
        if (n !== null && (typeof n !== 'number' || !Number.isFinite(n))) throw invalid(`Invalid request: ${path}.number must be a number or \`null\`.`);
        out.properties[pid] = encodeNumber(n as number | null);
        break;
      }
      case 'checkbox': {
        const c = field('checkbox');
        if (typeof c !== 'boolean') throw invalid(`Invalid request: ${path}.checkbox must be a boolean.`);
        out.properties[pid] = encodeCheckbox(c);
        break;
      }
      case 'url': case 'email': case 'phone_number': {
        const s = field(prop.type);
        if (s !== null && typeof s !== 'string') throw invalid(`Invalid request: ${path}.${prop.type} must be a string or \`null\`.`);
        if (prop.type === 'url' && s && !safeHref(s)) throw invalid(`Invalid request: ${path}.url must be a valid URL.`);
        out.properties[pid] = s ? [[String(s).slice(0, 2000)]] : undefined;
        break;
      }
      case 'select': case 'status': {
        const s = field(prop.type);
        if (s === null) {
          out.properties[pid] = undefined;
          break;
        }
        const r = pickOptions(prop, optionsInput(s, `${path}.${prop.type}`), opts.allowCreateOptions && prop.type === 'select', `${path}.${prop.type}`);
        if (r.options) out.schemaPatch[pid] = { ...prop, options: r.options };
        out.properties[pid] = encodeSelect(r.names.slice(0, 1));
        break;
      }
      case 'multi_select': {
        const s = field('multi_select');
        if (!Array.isArray(s)) throw invalid(`Invalid request: ${path}.multi_select must be an array.`);
        const r = pickOptions(prop, optionsInput(s, `${path}.multi_select`), opts.allowCreateOptions, `${path}.multi_select`);
        if (r.options) out.schemaPatch[pid] = { ...prop, options: r.options };
        out.properties[pid] = encodeSelect(r.names.slice(0, 100));
        break;
      }
      case 'date': out.properties[pid] = encodeDate(dateFromApi(field('date'), `${path}.date`)); break;
      case 'person': out.properties[pid] = encodePeople(personIds(field('people'), spaceId, `${path}.people`)); break;
      case 'relation': {
        const arr = field('relation');
        if (!Array.isArray(arr)) throw invalid(`Invalid request: ${path}.relation must be an array.`);
        const ids = arr.map((x, i) => {
          const id = expandId(String((x as Json)?.id ?? ''));
          const b = getRecord<BlockRecord>('block', id);
          if (!b || b.alive === false || blockRole(id, reader.principalId) === 'none' || (prop.collection_id && b.parent_id !== prop.collection_id)) {
            throw invalid(`Invalid request: ${path}.relation[${i}].id must be a page of the related database available to this connection.`);
          }
          return id;
        });
        out.properties[pid] = encodeRelation(ids);
        break;
      }
      case 'file': {
        const arr = field('files');
        if (!Array.isArray(arr)) throw invalid(`Invalid request: ${path}.files must be an array.`);
        out.properties[pid] = encodeFiles(arr.slice(0, 100).map((f, i) => {
          const url = httpUrl((f as Json)?.external?.url, `${path}.files[${i}].external.url`);
          return { name: String((f as Json)?.name ?? url.split('/').pop() ?? 'File').slice(0, 200), url };
        }));
        break;
      }
      case 'place': {
        const s = field('place');
        out.properties[pid] = s ? ([['‣', [['plc', { name: String(s.name ?? ''), address: s.address ? String(s.address) : undefined, lat: Number(s.lat) || undefined, lon: Number(s.lon) || undefined }]]]] as unknown as RichText) : undefined;
        break;
      }
      default:
        throw invalid(`${prop.name} cannot be updated through the API.`);
    }
  }
  return out;
}

/** Property id → schema (for property ids in responses). */
export { apiPropId };

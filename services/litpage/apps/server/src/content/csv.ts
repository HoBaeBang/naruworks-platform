// CSV (RFC 4180) parsing/writing + property type inference for the CSV → database importer.
import type { PropertyType } from '@nc/shared/records.ts';
import type { DbPropSpec, DbSpec, RowValue } from './spec.ts';
import { shortPropId } from './spec.ts';

export function parseCsv(src: string): string[][] {
  const text = src.replace(/^﻿/, '');
  // delimiter sniffing: comma, semicolon or tab (first line)
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const counts = { ',': (firstLine.match(/,/g) ?? []).length, ';': (firstLine.match(/;/g) ?? []).length, '\t': (firstLine.match(/\t/g) ?? []).length };
  const delim = (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[1] ?? 0) > 0 ? (Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] as string) : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') {
      quoted = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function csvEscape(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map((c) => csvEscape(c ?? '')).join(',')).join('\r\n') + '\r\n';
}

const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

/** Parse common date spellings ("2026-10-20", "10/20/2026", "October 20, 2026", "Oct 20, 2026 3:00 PM") → YYYY-MM-DD. */
export function parseDateCell(v: string): string | null {
  const s = v.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s.*)?$/.exec(s);
  if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})(?:\s.*)?$/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  return null;
}

function inferType(name: string, values: string[]): PropertyType {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return 'text';
  if (vals.every((v) => /^(yes|no|true|false|checked|unchecked|x|✓|✅|☐)$/i.test(v))) return 'checkbox';
  if (vals.every((v) => /^[-+]?[$€£₩¥]?\s?\d{1,3}(?:[,]\d{3})*(?:\.\d+)?%?$|^[-+]?\d+(?:\.\d+)?%?$/.test(v))) return 'number';
  if (vals.every((v) => parseDateCell(v) !== null)) return 'date';
  if (vals.every((v) => /^https?:\/\/\S+$/i.test(v))) return 'url';
  if (vals.every((v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v))) return 'email';
  const distinct = new Set(vals);
  const multi = vals.some((v) => v.includes(',')) && vals.every((v) => v.split(',').every((p) => p.trim().length > 0 && p.trim().length <= 30));
  if (multi && /tag|label|categor|skill|topic/i.test(name)) return 'multi_select';
  if (distinct.size <= Math.max(2, Math.min(12, Math.ceil(vals.length / 2))) && vals.every((v) => v.length <= 40) && vals.length >= 2) return 'select';
  return 'text';
}

/** Property type the CSV importer picks for a column (shown as the default in the column mapping step). */
export function inferColumnType(name: string, values: string[]): PropertyType {
  return inferType(name, values);
}

/** Types a CSV column can be imported as (column mapping). */
export const CSV_COLUMN_TYPES: PropertyType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'checkbox', 'url', 'email', 'phone_number'];

/**
 * CSV text → database spec (first column = title, the CSV importer convention). `types` overrides the inferred
 * property type per column index (1…n; the first column is always the title); 'skip' leaves a column out.
 */
export function csvToDb(name: string, src: string, types?: Record<number, PropertyType | 'skip'>): DbSpec {
  const rows = parseCsv(src);
  return rowsToDb(name, rows, types);
}

export function rowsToDb(name: string, input: string[][], types?: Record<number, PropertyType | 'skip'>): DbSpec {
  const rows = input.map((r) => [...r]);
  const header = (rows.shift() ?? ['Name']).map((h, i) => h.trim() || (i === 0 ? 'Name' : `Column ${i + 1}`));
  const schema: Record<string, DbPropSpec> = {};
  const ids: string[] = [];
  const used = new Set<string>();
  header.forEach((h, ci) => {
    if (ci === 0) {
      ids.push('title');
      schema.title = { name: h, type: 'title' };
      return;
    }
    const override = types?.[ci];
    if (override === 'skip') {
      ids.push('');
      return;
    }
    let id = shortPropId();
    while (used.has(id)) id = shortPropId();
    used.add(id);
    ids.push(id);
    const type = override && CSV_COLUMN_TYPES.includes(override) ? override : inferType(h, rows.map((r) => r[ci] ?? ''));
    const spec: DbPropSpec = { name: h, type };
    if (type === 'select' || type === 'multi_select' || type === 'status') {
      const opts = new Set<string>();
      for (const r of rows) for (const part of type === 'multi_select' ? (r[ci] ?? '').split(',') : [r[ci] ?? '']) if (part.trim()) opts.add(part.trim());
      spec.options = [...opts];
    }
    if (type === 'number' && rows.some((r) => /^[-+]?\$/.test((r[ci] ?? '').trim()))) spec.number_format = 'dollar';
    if (type === 'number' && rows.some((r) => /%$/.test((r[ci] ?? '').trim()))) spec.number_format = 'percent';
    schema[id] = spec;
  });
  const dbRows = rows.map((r) => {
    const values: Record<string, RowValue> = {};
    ids.forEach((id, ci) => {
      const raw = (r[ci] ?? '').trim();
      if (!raw || !id) return;
      const p = schema[id];
      if (p.type === 'number') {
        const n = Number(raw.replace(/[$€£₩¥,%\s]/g, ''));
        values[id] = Number.isFinite(n) ? (p.number_format === 'percent' ? n / 100 : n) : null;
      } else if (p.type === 'date') {
        const d = parseDateCell(raw);
        if (d) values[id] = { date: d };
      } else if (p.type === 'multi_select') values[id] = raw.split(',').map((x) => x.trim()).filter(Boolean);
      else if (p.type === 'checkbox') values[id] = /^(yes|true|checked|x|✓|✅|1)$/i.test(raw);
      else values[id] = raw;
    });
    return { values };
  });
  return { name, schema, rows: dbRows, views: [{ type: 'table', name: 'Table' }] };
}

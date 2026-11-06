// Spreadsheet-like imports → CSV text for csvToDb ("CSV, XLSX, TSV → databases"):
//   xlsxToRows: first worksheet of an Excel workbook (shared strings, inline strings, numbers, booleans, date formats)
//   tsvToRows:  tab-separated values
// plus OPML outlines → nested bulleted lists ("OPML → pages").
import type { Spec } from './spec.ts';
import { readZip } from './zip.ts';
import { parseXml, type XNode } from './docx.ts';

const els = (n: XNode | undefined): XNode[] => (n ? (n.children.filter((c) => typeof c !== 'string') as XNode[]) : []);
const textOf = (n: XNode | undefined): string => {
  if (!n) return '';
  let s = '';
  for (const c of n.children) s += typeof c === 'string' ? c : textOf(c);
  return s;
};
function findAll(n: XNode | undefined, name: string, out: XNode[] = []): XNode[] {
  for (const c of els(n)) {
    if (c.name === name || c.name.endsWith(`:${name}`)) out.push(c);
    findAll(c, name, out);
  }
  return out;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 22, 27, 30, 36, 45, 46, 47, 50, 57]);

/** Excel serial date (1900 system) → YYYY-MM-DD[ HH:mm]. */
function serialToDate(v: number): string {
  const ms = Math.round((v - 25569) * 86400_000);
  const d = new Date(ms);
  const ymd = d.toISOString().slice(0, 10);
  const hm = d.toISOString().slice(11, 16);
  return v % 1 ? `${ymd} ${hm}` : ymd;
}

export function xlsxToRows(buf: Buffer): string[][] {
  const entries = new Map(readZip(buf, { budget: { bytes: 128 * 1024 * 1024, entries: 3000 } }).map((e) => [e.name, e]));
  const shared: string[] = [];
  const ss = entries.get('xl/sharedStrings.xml');
  if (ss) for (const si of findAll(parseXml(ss.data.toString('utf8')), 'si')) shared.push(findAll(si, 't').map(textOf).join(''));
  // number formats that are dates
  const dateStyles = new Set<number>();
  const st = entries.get('xl/styles.xml');
  if (st) {
    const tree = parseXml(st.data.toString('utf8'));
    const custom = new Map<number, string>();
    for (const f of findAll(tree, 'numFmt')) custom.set(Number(f.attrs.numFmtId), (f.attrs.formatCode ?? '').toLowerCase());
    const cellXfs = findAll(tree, 'cellXfs')[0];
    els(cellXfs).forEach((xf, i) => {
      const id = Number(xf.attrs.numFmtId ?? 0);
      const code = custom.get(id) ?? '';
      if (BUILTIN_DATE_FORMATS.has(id) || (/[dmy]/.test(code.replace(/"[^"]*"|\[[^\]]*\]/g, '')) && /y|d/.test(code))) dateStyles.add(i);
    });
  }
  // first sheet in workbook order
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = entries.get('xl/workbook.xml');
  const rels = entries.get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = findAll(parseXml(wb.data.toString('utf8')), 'sheet')[0];
    const rid = first?.attrs['r:id'];
    const rel = findAll(parseXml(rels.data.toString('utf8')), 'Relationship').find((r) => r.attrs.Id === rid);
    if (rel?.attrs.Target) sheetPath = rel.attrs.Target.startsWith('/') ? rel.attrs.Target.slice(1) : `xl/${rel.attrs.Target}`;
  }
  const sheet = entries.get(sheetPath);
  if (!sheet) throw new Error('This workbook has no sheets');
  const rows: string[][] = [];
  const colIndex = (ref: string) => {
    const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  };
  for (const row of findAll(parseXml(sheet.data.toString('utf8')), 'row')) {
    const out: string[] = [];
    for (const c of els(row).filter((x) => x.name === 'c' || x.name.endsWith(':c'))) {
      const idx = c.attrs.r ? colIndex(c.attrs.r) : out.length;
      if (idx > 500) continue;
      const v = textOf(els(c).find((x) => x.name === 'v' || x.name.endsWith(':v')));
      let s = '';
      switch (c.attrs.t) {
        case 's':
          s = shared[Number(v)] ?? '';
          break;
        case 'inlineStr':
          s = findAll(c, 't').map(textOf).join('');
          break;
        case 'b':
          s = v === '1' ? 'Yes' : 'No';
          break;
        case 'str':
        case 'e':
          s = v;
          break;
        default:
          s = v !== '' && dateStyles.has(Number(c.attrs.s ?? -1)) && Number.isFinite(Number(v)) ? serialToDate(Number(v)) : v;
      }
      while (out.length < idx) out.push('');
      out[idx] = s;
    }
    rows.push(out);
    if (rows.length > 20_000) break;
  }
  // drop empty trailing rows
  while (rows.length && rows[rows.length - 1].every((x) => !x)) rows.pop();
  if (!rows.length) throw new Error('The first sheet is empty');
  const width = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array(width - r.length).fill('')]);
}

export function tsvToRows(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').split('\n').filter((l, i, a) => l || i < a.length - 1).map((l) => l.split('\t'));
}

/** OPML outline → page title + nested bulleted lists (notes become child paragraphs). */
export function opmlToSpecs(text: string): { title?: string; blocks: Spec[] } {
  const tree = parseXml(text);
  const title = textOf(findAll(tree, 'title')[0]).trim() || undefined;
  const body = findAll(tree, 'body')[0];
  let count = 0;
  const walk = (n: XNode | undefined, depth: number): Spec[] => {
    if (depth > 30) return [];
    return els(n).filter((x) => x.name === 'outline').map((o) => {
      count++;
      if (count > 20_000) throw new Error('Outline is too large');
      const kids = walk(o, depth + 1);
      const note = o.attrs._note ? [{ type: 'text', text: o.attrs._note } as Spec] : [];
      return { type: 'bulleted_list', text: o.attrs.text ?? o.attrs.title ?? '', children: [...note, ...kids] } as Spec;
    });
  };
  return { title, blocks: walk(body, 0) };
}

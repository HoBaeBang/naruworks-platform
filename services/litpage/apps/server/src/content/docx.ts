// Microsoft Word (.docx) → block specs (the "Word" importer): text, headings (Title / Heading 1–9 /
// outline levels), bulleted & numbered lists (numbering.xml, nesting by level), quotes, code styles, bold / italic /
// underline / strikethrough / highlight, links, tables (merged cells flattened), and inline images (word/media).
// as expected, comments, tracked deletions, text boxes, SmartArt and headers/footers are left out.
import type { Annotation, Decoration, RichText } from '@nc/shared/richtext.ts';
import { safeHref } from '@nc/shared/url.ts';
import type { Spec } from './spec.ts';
import { readZip, type ZipEntry } from './zip.ts';

// ---------------------------------------------------------------- tiny XML tree

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: (XNode | string)[];
}

const XML_ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return XML_ENT[e.toLowerCase()] ?? m;
  });
}

/** Tolerant XML parser (elements, attributes, text, CDATA); comments / PIs / doctype dropped. */
export function parseXml(src: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [] };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(src))) {
    if (++guard > 4_000_000) throw new Error('Document is too large');
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2] !== undefined) {
      // close the nearest open element with this name (ignore stray closers)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const attrs: Record<string, string> = {};
      const are = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = are.exec(m[4] ?? ''))) attrs[a[1]] = decodeXml(a[2] ?? a[3] ?? '');
      const el: XNode = { name: m[3], attrs, children: [] };
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) {
      top.children.push(decodeXml(m[6]));
    }
  }
  return root;
}

const els = (n: XNode | undefined): XNode[] => (n ? (n.children.filter((c) => typeof c !== 'string') as XNode[]) : []);
const child = (n: XNode | undefined, name: string): XNode | undefined => els(n).find((c) => c.name === name);
const childrenNamed = (n: XNode | undefined, name: string): XNode[] => els(n).filter((c) => c.name === name);
function find(n: XNode | undefined, name: string): XNode | undefined {
  if (!n) return undefined;
  for (const c of els(n)) {
    if (c.name === name) return c;
    const hit = find(c, name);
    if (hit) return hit;
  }
  return undefined;
}
function findAll(n: XNode | undefined, name: string, out: XNode[] = []): XNode[] {
  for (const c of els(n)) {
    if (c.name === name) out.push(c);
    findAll(c, name, out);
  }
  return out;
}
const val = (n: XNode | undefined) => n?.attrs['w:val'];
/** OOXML on/off property: present without w:val, or w:val true/1/on. */
const on = (n: XNode | undefined) => !!n && !['0', 'false', 'off', 'none'].includes((val(n) ?? 'true').toLowerCase());

// ---------------------------------------------------------------- document parts

interface Rel {
  target: string;
  external: boolean;
  type: string;
}

interface StyleInfo {
  name: string;
  basedOn?: string;
  outline?: number;
  numId?: string;
}

export interface DocxOptions {
  /** store an embedded image; returns its URL (or null to drop it) */
  storeImage?: (name: string, data: Buffer) => string | null;
  /** fallback title (file name without extension) */
  title?: string;
}

export interface DocxResult {
  title: string;
  blocks: Spec[];
}

type ListKind = 'bulleted_list' | 'numbered_list';

class Converter {
  rels = new Map<string, Rel>();
  styles = new Map<string, StyleInfo>();
  /** numId → abstract levels (ilvl → numFmt) */
  numbering = new Map<string, Map<number, string>>();
  entries: Map<string, ZipEntry>;
  opts: DocxOptions;
  images = new Map<string, string | null>();
  title: string | null = null;

  constructor(entries: Map<string, ZipEntry>, opts: DocxOptions) {
    this.entries = entries;
    this.opts = opts;
    const relsXml = entries.get('word/_rels/document.xml.rels');
    if (relsXml) {
      for (const r of findAll(parseXml(relsXml.data.toString('utf8')), 'Relationship')) {
        this.rels.set(r.attrs.Id, { target: r.attrs.Target ?? '', external: r.attrs.TargetMode === 'External', type: r.attrs.Type ?? '' });
      }
    }
    const stylesXml = entries.get('word/styles.xml');
    if (stylesXml) {
      for (const s of findAll(parseXml(stylesXml.data.toString('utf8')), 'w:style')) {
        const id = s.attrs['w:styleId'];
        if (!id) continue;
        const ppr = child(s, 'w:pPr');
        const outline = val(child(ppr, 'w:outlineLvl'));
        this.styles.set(id, {
          name: (val(child(s, 'w:name')) ?? id).toLowerCase(),
          basedOn: val(child(s, 'w:basedOn')),
          outline: outline !== undefined ? Number(outline) : undefined,
          numId: val(child(child(ppr, 'w:numPr'), 'w:numId')),
        });
      }
    }
    const numXml = entries.get('word/numbering.xml');
    if (numXml) {
      const tree = parseXml(numXml.data.toString('utf8'));
      const abstract = new Map<string, Map<number, string>>();
      for (const a of findAll(tree, 'w:abstractNum')) {
        const levels = new Map<number, string>();
        for (const l of childrenNamed(a, 'w:lvl')) levels.set(Number(l.attrs['w:ilvl'] ?? 0), val(child(l, 'w:numFmt')) ?? 'decimal');
        abstract.set(a.attrs['w:abstractNumId'], levels);
      }
      for (const n of findAll(tree, 'w:num')) {
        const levels = abstract.get(val(child(n, 'w:abstractNumId')) ?? '');
        if (levels) this.numbering.set(n.attrs['w:numId'], levels);
      }
    }
  }

  /** Style name, following basedOn for built-in names (e.g. a custom style based on "heading 2"). */
  styleChain(id: string | undefined): StyleInfo[] {
    const out: StyleInfo[] = [];
    let cur = id ? this.styles.get(id) : undefined;
    for (let i = 0; i < 10 && cur; i++) {
      out.push(cur);
      cur = cur.basedOn ? this.styles.get(cur.basedOn) : undefined;
    }
    return out;
  }

  image(rid: string | undefined): Spec | null {
    if (!rid) return null;
    const rel = this.rels.get(rid);
    if (!rel || rel.external) return null;
    const path = rel.target.startsWith('/') ? rel.target.slice(1) : `word/${rel.target}`.replace(/\/\.\//g, '/');
    if (!this.images.has(path)) {
      const e = this.entries.get(path);
      this.images.set(path, e && /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path) && this.opts.storeImage ? this.opts.storeImage(path.split('/').pop()!, e.data) : null);
    }
    const url = this.images.get(path);
    return url ? { type: 'image', url } : null;
  }

  /** Rich text of a paragraph (or any run container) + the images it holds. */
  inline(n: XNode, anns: Annotation[] = [], out: { rt: Decoration[]; images: Spec[] } = { rt: [], images: [] }) {
    for (const c of els(n)) {
      switch (c.name) {
        case 'w:r':
          this.run(c, anns, out);
          break;
        case 'w:hyperlink': {
          const rel = c.attrs['r:id'] ? this.rels.get(c.attrs['r:id']) : undefined;
          const href = rel?.external ? safeHref(rel.target) : null;
          this.inline(c, href ? [...anns, ['a', href] as Annotation] : anns, out);
          break;
        }
        case 'w:ins':
        case 'w:smartTag':
        case 'w:fldSimple':
        case 'w:customXml':
        case 'w:dir':
        case 'w:bdo':
          this.inline(c, anns, out);
          break;
        case 'w:sdt':
          this.inline(child(c, 'w:sdtContent') ?? c, anns, out);
          break;
        default:
          break; // w:del, w:pPr, bookmarks, comments, proofing marks …
      }
    }
    return out;
  }

  run(r: XNode, anns: Annotation[], out: { rt: Decoration[]; images: Spec[] }) {
    const rpr = child(r, 'w:rPr');
    const a: Annotation[] = [...anns];
    if (on(child(rpr, 'w:b'))) a.push(['b']);
    if (on(child(rpr, 'w:i'))) a.push(['i']);
    const u = child(rpr, 'w:u');
    if (u && val(u) !== 'none') a.push(['_']);
    if (on(child(rpr, 'w:strike')) || on(child(rpr, 'w:dstrike'))) a.push(['s']);
    const hl = val(child(rpr, 'w:highlight'));
    if (hl && hl !== 'none') a.push(['h', highlightColor(hl)]);
    const rStyle = val(child(rpr, 'w:rStyle'))?.toLowerCase() ?? '';
    if (/code|verbatim|html/.test(rStyle)) a.push(['c']);
    let text = '';
    const flush = () => {
      if (text) push(out.rt, text, a);
      text = '';
    };
    for (const c of els(r)) {
      switch (c.name) {
        case 'w:t':
          text += c.children.filter((x): x is string => typeof x === 'string').join('');
          break;
        case 'w:tab':
        case 'w:ptab':
          text += '\t';
          break;
        case 'w:br':
        case 'w:cr':
          if (c.attrs['w:type'] !== 'page' && c.attrs['w:type'] !== 'column') text += '\n';
          break;
        case 'w:noBreakHyphen':
        case 'w:softHyphen':
          text += '-';
          break;
        case 'w:sym': {
          const code = parseInt(c.attrs['w:char'] ?? '', 16);
          if (Number.isFinite(code) && code >= 0x20 && code < 0xf000) text += String.fromCodePoint(code);
          break;
        }
        case 'w:drawing':
        case 'w:pict':
        case 'w:object': {
          flush();
          // text boxes are skipped; pictures become image blocks after the paragraph
          if (find(c, 'w:txbxContent')) break;
          const blip = find(c, 'a:blip');
          const img = this.image(blip?.attrs['r:embed'] ?? find(c, 'v:imagedata')?.attrs['r:id']);
          if (img) out.images.push(img);
          break;
        }
        default:
          break;
      }
    }
    flush();
  }

  paragraphType(p: XNode): { type: Spec['type'] | 'title'; list?: { kind: ListKind; level: number } } {
    const ppr = child(p, 'w:pPr');
    const styleId = val(child(ppr, 'w:pStyle'));
    const chain = this.styleChain(styleId);
    const names = chain.map((s) => s.name);
    const outline = val(child(ppr, 'w:outlineLvl')) ?? chain.find((s) => s.outline !== undefined)?.outline;
    const numPr = child(ppr, 'w:numPr');
    const numId = val(child(numPr, 'w:numId')) ?? chain.find((s) => s.numId)?.numId;
    const level = Number(val(child(numPr, 'w:ilvl')) ?? 0) || 0;
    if (names.includes('title')) return { type: 'title' };
    const heading = names.map((n) => /^heading\s*(\d)$/.exec(n)?.[1]).find(Boolean);
    const lvl = heading ? Number(heading) : outline !== undefined && Number(outline) < 9 ? Number(outline) + 1 : 0;
    if (lvl === 1) return { type: 'header' };
    if (lvl === 2) return { type: 'sub_header' };
    if (lvl >= 3) return { type: 'sub_sub_header' };
    if (numId && numId !== '0') {
      const fmt = this.numbering.get(numId)?.get(level) ?? 'bullet';
      return { type: 'text', list: { kind: fmt === 'bullet' || fmt === 'none' ? 'bulleted_list' : 'numbered_list', level } };
    }
    if (names.some((n) => /^list (bullet|paragraph bullet)/.test(n))) return { type: 'text', list: { kind: 'bulleted_list', level: 0 } };
    if (names.some((n) => /^list number/.test(n))) return { type: 'text', list: { kind: 'numbered_list', level: 0 } };
    if (names.some((n) => /quote/.test(n))) return { type: 'quote' };
    if (names.some((n) => /^(code|source code|html preformatted|plain text)$/.test(n))) return { type: 'code' };
    return { type: 'text' };
  }

  table(tbl: XNode): Spec | null {
    const rows: RichText[][] = [];
    let header = false;
    childrenNamed(tbl, 'w:tr').forEach((tr, ri) => {
      if (ri === 0 && find(child(tr, 'w:trPr'), 'w:tblHeader')) header = true;
      const row: RichText[] = [];
      for (const tc of childrenNamed(tr, 'w:tc')) {
        const tcPr = child(tc, 'w:tcPr');
        const span = Math.max(1, Number(val(child(tcPr, 'w:gridSpan')) ?? 1) || 1);
        const vm = child(tcPr, 'w:vMerge');
        const continued = !!vm && (val(vm) ?? 'continue') === 'continue';
        let cell: RichText = [];
        if (!continued) {
          const parts = childrenNamed(tc, 'w:p').map((p) => this.inline(p).rt);
          cell = parts.reduce<RichText>((acc, part, i) => (i ? [...acc, ['\n'], ...part] : [...part]), []);
        }
        row.push(cell);
        for (let i = 1; i < span; i++) row.push([]);
      }
      rows.push(row);
    });
    if (!rows.length) return null;
    // Word tables usually start with a heading row: treat a bold first row as the header too
    if (!header) header = rows[0].length > 0 && rows[0].every((c) => !c.length || c.every((d) => (d[1] ?? []).some((a) => a[0] === 'b')));
    return { type: 'table', table: rows, tableHeader: header };
  }

  body(n: XNode): Spec[] {
    const out: Spec[] = [];
    // open list items by level (nested items go into the previous item's children)
    let stack: { level: number; spec: Spec }[] = [];
    const emit = (s: Spec, level?: number) => {
      if (level === undefined) {
        stack = [];
        out.push(s);
        return;
      }
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      if (stack.length) {
        const parent = stack[stack.length - 1].spec;
        parent.children = [...(parent.children ?? []), s];
      } else out.push(s);
      stack.push({ level, spec: s });
    };
    for (const c of els(n)) {
      if (c.name === 'w:p') {
        const { type, list } = this.paragraphType(c);
        const { rt, images } = this.inline(c);
        const text = trimRich(rt);
        if (type === 'title' && !this.title && text.length) {
          this.title = text.map((d) => d[0]).join('').trim();
          continue;
        }
        if (text.length) {
          if (list) emit({ type: list.kind, text }, list.level);
          else if (type === 'code') {
            const s: Spec = { type: 'code', text: text.map((d) => d[0]).join(''), language: 'Plain Text' };
            const prev = out[out.length - 1];
            // consecutive code paragraphs form one code block
            if (prev?.type === 'code' && !stack.length && typeof prev.text === 'string') prev.text += '\n' + (s.text as string);
            else emit(s);
          } else emit({ type: type === 'title' ? 'header' : type, text });
        } else if (!images.length) {
          // empty paragraph: ends a list run
          stack = [];
          continue;
        }
        for (const img of images) emit(img);
      } else if (c.name === 'w:tbl') {
        const t = this.table(c);
        if (t) emit(t);
      } else if (c.name === 'w:sdt') {
        for (const s of this.body(child(c, 'w:sdtContent') ?? c)) emit(s);
      } else if (c.name === 'w:customXml') {
        for (const s of this.body(c)) emit(s);
      }
    }
    return out;
  }
}

function highlightColor(hl: string): string {
  const map: Record<string, string> = {
    yellow: 'yellow_background', green: 'green_background', cyan: 'blue_background', blue: 'blue_background', magenta: 'pink_background',
    red: 'red_background', darkYellow: 'brown_background', lightGray: 'gray_background', darkGray: 'gray_background', darkRed: 'red_background',
    darkGreen: 'green_background', darkBlue: 'blue_background', darkCyan: 'blue_background', darkMagenta: 'purple_background', black: 'gray_background',
  };
  return map[hl] ?? 'yellow_background';
}

function sameAnns(a: Annotation[] | undefined, b: Annotation[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

function push(rt: Decoration[], text: string, anns: Annotation[]) {
  const last = rt[rt.length - 1];
  if (last && sameAnns(last[1], anns.length ? anns : undefined)) last[0] += text;
  else rt.push(anns.length ? [text, anns.map((x) => [...x]) as Annotation[]] : [text]);
}

/** Drop leading/trailing whitespace-only runs (Word pads paragraphs with tabs/spaces). */
function trimRich(rt: Decoration[]): RichText {
  const out = rt.map((d) => [...d] as Decoration);
  while (out.length && !out[0][0].trim()) out.shift();
  while (out.length && !out[out.length - 1][0].trim()) out.pop();
  if (out.length) {
    out[0][0] = out[0][0].replace(/^\s+/, '');
    out[out.length - 1][0] = out[out.length - 1][0].replace(/\s+$/, '');
  }
  return out;
}

/** Convert a .docx file into a page title + block specs. Throws for files that aren't Word documents. */
export function docxToSpecs(buf: Buffer, opts: DocxOptions = {}): DocxResult {
  let entries: ZipEntry[];
  try {
    entries = readZip(buf, { budget: { bytes: 128 * 1024 * 1024, entries: 3000 } });
  } catch {
    throw new Error('This file isn’t a Word document (.docx)');
  }
  const map = new Map(entries.map((e) => [e.name, e]));
  const doc = map.get('word/document.xml');
  if (!doc) throw new Error('This file isn’t a Word document (.docx)');
  const conv = new Converter(map, opts);
  const tree = parseXml(doc.data.toString('utf8'));
  const body = find(tree, 'w:body');
  const blocks = body ? conv.body(body) : [];
  // the document title (core properties) when there is no Title paragraph
  let title = conv.title;
  if (!title) {
    const core = map.get('docProps/core.xml');
    const t = core ? find(parseXml(core.data.toString('utf8')), 'dc:title') : undefined;
    const s = t?.children.filter((x): x is string => typeof x === 'string').join('').trim();
    if (s) title = s;
  }
  return { title: title || opts.title || 'Untitled', blocks };
}

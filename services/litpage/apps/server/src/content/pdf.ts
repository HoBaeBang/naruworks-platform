// PDF → block specs (the "PDF" importer): text extraction without external libraries.
// Reads the object table (incl. compressed object streams), decodes page content streams (Flate / ASCIIHex /
// ASCII85), maps glyph codes through ToUnicode CMaps or the font's simple encoding (WinAnsi / MacRoman / Differences),
// places text runs by their text matrix and turns lines into paragraphs, headings (larger type) and list items
// (bullet / number prefixes). as expected, tables flatten to text and scanned PDFs (no text layer) can't be read.
import { inflateSync, constants as zc } from 'node:zlib';
import type { Spec } from './spec.ts';

type PdfValue = number | boolean | null | PdfName | PdfRef | Buffer | PdfValue[] | PdfDict;
interface PdfName { name: string }
interface PdfRef { ref: number }
interface PdfDict { dict: Map<string, PdfValue> }

const isName = (v: unknown): v is PdfName => !!v && typeof v === 'object' && 'name' in (v as object);
const isRef = (v: unknown): v is PdfRef => !!v && typeof v === 'object' && 'ref' in (v as object);
const isDict = (v: unknown): v is PdfDict => !!v && typeof v === 'object' && 'dict' in (v as object);

// ---------------------------------------------------------------- lexer / value parser

const WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

class Lexer {
  buf: Buffer;
  pos: number;
  end: number;
  constructor(buf: Buffer, pos = 0, end = buf.length) {
    this.buf = buf;
    this.pos = pos;
    this.end = end;
  }
  skipWs() {
    while (this.pos < this.end) {
      const c = this.buf[this.pos];
      if (WS.has(c)) this.pos++;
      else if (c === 0x25) {
        while (this.pos < this.end && this.buf[this.pos] !== 0x0a && this.buf[this.pos] !== 0x0d) this.pos++;
      } else break;
    }
  }
  /** Next token: a value (number/string/name/array/dict/bool/null) or an operator/keyword string. */
  next(): { kind: 'value'; v: PdfValue } | { kind: 'op'; op: string } | null {
    this.skipWs();
    if (this.pos >= this.end) return null;
    const c = this.buf[this.pos];
    if (c === 0x2f) {
      // name
      let i = this.pos + 1;
      while (i < this.end && !WS.has(this.buf[i]) && !DELIM.has(this.buf[i])) i++;
      const raw = this.buf.toString('latin1', this.pos + 1, i).replace(/#([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));
      this.pos = i;
      return { kind: 'value', v: { name: raw } };
    }
    if (c === 0x28) return { kind: 'value', v: this.literalString() };
    if (c === 0x3c) {
      if (this.buf[this.pos + 1] === 0x3c) {
        this.pos += 2;
        return { kind: 'value', v: this.dict() };
      }
      return { kind: 'value', v: this.hexString() };
    }
    if (c === 0x5b) {
      this.pos++;
      return { kind: 'value', v: this.array() };
    }
    if (c === 0x5d || c === 0x3e || c === 0x7b || c === 0x7d) {
      this.pos += c === 0x3e && this.buf[this.pos + 1] === 0x3e ? 2 : 1;
      return { kind: 'op', op: c === 0x5d ? ']' : c === 0x3e ? '>>' : String.fromCharCode(c) };
    }
    let i = this.pos;
    while (i < this.end && !WS.has(this.buf[i]) && !DELIM.has(this.buf[i])) i++;
    if (i === this.pos) i++;
    const word = this.buf.toString('latin1', this.pos, i);
    this.pos = i;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) return { kind: 'value', v: Number(word) };
    if (word === 'true' || word === 'false') return { kind: 'value', v: word === 'true' };
    if (word === 'null') return { kind: 'value', v: null };
    return { kind: 'op', op: word };
  }
  literalString(): Buffer {
    this.pos++;
    const out: number[] = [];
    let depth = 1;
    while (this.pos < this.end) {
      const c = this.buf[this.pos++];
      if (c === 0x5c) {
        const n = this.buf[this.pos++];
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12, 0x28: 0x28, 0x29: 0x29, 0x5c: 0x5c };
        if (n in map) out.push(map[n]);
        else if (n >= 0x30 && n <= 0x37) {
          let oct = n - 0x30;
          for (let k = 0; k < 2 && this.buf[this.pos] >= 0x30 && this.buf[this.pos] <= 0x37; k++) oct = oct * 8 + (this.buf[this.pos++] - 0x30);
          out.push(oct & 0xff);
        } else if (n === 0x0d) {
          if (this.buf[this.pos] === 0x0a) this.pos++;
        } else if (n !== 0x0a) out.push(n);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) break;
        out.push(c);
      } else out.push(c);
    }
    return Buffer.from(out);
  }
  hexString(): Buffer {
    this.pos++;
    let hex = '';
    while (this.pos < this.end && this.buf[this.pos] !== 0x3e) {
      const ch = String.fromCharCode(this.buf[this.pos++]);
      if (/[0-9a-f]/i.test(ch)) hex += ch;
    }
    this.pos++;
    if (hex.length % 2) hex += '0';
    return Buffer.from(hex, 'hex');
  }
  array(): PdfValue[] {
    const out: PdfValue[] = [];
    for (let guard = 0; guard < 1_000_000; guard++) {
      const t = this.next();
      if (!t) break;
      if (t.kind === 'op') {
        if (t.op === ']') break;
        if (t.op === 'R' && out.length >= 2 && typeof out[out.length - 1] === 'number' && typeof out[out.length - 2] === 'number') {
          out.pop();
          out.push({ ref: out.pop() as number });
        }
        continue;
      }
      out.push(t.v);
    }
    return out;
  }
  dict(): PdfDict {
    const map = new Map<string, PdfValue>();
    const items: PdfValue[] = [];
    for (let guard = 0; guard < 1_000_000; guard++) {
      const t = this.next();
      if (!t) break;
      if (t.kind === 'op') {
        if (t.op === '>>') break;
        if (t.op === 'R' && items.length >= 2 && typeof items[items.length - 1] === 'number' && typeof items[items.length - 2] === 'number') {
          items.pop();
          items.push({ ref: items.pop() as number });
        }
        continue;
      }
      items.push(t.v);
    }
    for (let i = 0; i + 1 < items.length; i += 2) if (isName(items[i])) map.set((items[i] as PdfName).name, items[i + 1]);
    return { dict: map };
  }
}

// ---------------------------------------------------------------- document

interface PdfObject {
  value: PdfValue;
  stream?: Buffer;
}

const MAX_OBJECTS = 200_000;

class PdfDoc {
  buf: Buffer;
  objs = new Map<number, PdfObject>();
  trailer: PdfDict | null = null;
  inflateBudget = 200 * 1024 * 1024;

  constructor(buf: Buffer) {
    this.buf = buf;
    const text = buf.toString('latin1');
    const re = /(\d+)\s+(\d+)\s+obj\b/g;
    let m: RegExpExecArray | null;
    let count = 0;
    while ((m = re.exec(text))) {
      if (++count > MAX_OBJECTS) throw new Error('This PDF is too complex to import');
      const num = Number(m[1]);
      const lex = new Lexer(buf, m.index + m[0].length);
      const t = lex.next();
      if (!t || t.kind !== 'value') continue;
      const value: PdfValue = t.v;
      let stream: Buffer | undefined;
      lex.skipWs();
      if (text.startsWith('stream', lex.pos)) {
        let start = lex.pos + 6;
        if (buf[start] === 0x0d) start++;
        if (buf[start] === 0x0a) start++;
        const len = isDict(value) ? value.dict.get('Length') : undefined;
        let end = -1;
        if (typeof len === 'number' && start + len <= buf.length && text.startsWith('endstream', skipWsAt(text, start + len))) end = start + len;
        if (end < 0) {
          const e = text.indexOf('endstream', start);
          end = e < 0 ? buf.length : e;
          while (end > start && (buf[end - 1] === 0x0a || buf[end - 1] === 0x0d)) end--;
        }
        stream = buf.subarray(start, end);
        re.lastIndex = end;
      }
      this.objs.set(num, { value, stream });
    }
    // trailer (classic) or the xref stream's dictionary (PDF 1.5+)
    const ti = text.lastIndexOf('trailer');
    if (ti >= 0) {
      const t = new Lexer(buf, ti + 7).next();
      if (t?.kind === 'value' && isDict(t.v)) this.trailer = t.v;
    }
    if (!this.trailer?.dict.get('Root')) {
      for (const o of this.objs.values()) {
        if (isDict(o.value) && (o.value.dict.get('Type') as PdfName | undefined)?.name === 'XRef' && o.value.dict.get('Root')) this.trailer = o.value;
      }
    }
    // compressed object streams
    for (const [, o] of [...this.objs]) {
      if (!isDict(o.value) || (o.value.dict.get('Type') as PdfName | undefined)?.name !== 'ObjStm' || !o.stream) continue;
      const data = this.decode(o);
      if (!data) continue;
      const n = Number(o.value.dict.get('N')) || 0;
      const first = Number(o.value.dict.get('First')) || 0;
      const head = new Lexer(data, 0, Math.min(first, data.length));
      const pairs: number[] = [];
      for (let i = 0; i < n * 2; i++) {
        const t = head.next();
        if (!t || t.kind !== 'value' || typeof t.v !== 'number') break;
        pairs.push(t.v);
      }
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        const num = pairs[i];
        if (this.objs.has(num)) continue;
        const t = new Lexer(data, first + pairs[i + 1]).next();
        if (t?.kind === 'value') this.objs.set(num, { value: t.v });
      }
    }
  }

  get(v: PdfValue | undefined, depth = 0): PdfValue | undefined {
    if (isRef(v) && depth < 20) return this.get(this.objs.get(v.ref)?.value, depth + 1);
    return v;
  }

  dictOf(v: PdfValue | undefined): Map<string, PdfValue> | undefined {
    const d = this.get(v);
    return isDict(d) ? d.dict : undefined;
  }

  objectOf(v: PdfValue | undefined): PdfObject | undefined {
    return isRef(v) ? this.objs.get(v.ref) : undefined;
  }

  /** Decoded stream bytes (null when the filter isn't supported). */
  decode(o: PdfObject): Buffer | null {
    if (!o.stream) return null;
    const d = isDict(o.value) ? o.value.dict : new Map<string, PdfValue>();
    const f = this.get(d.get('Filter'));
    const filters = (Array.isArray(f) ? f : f ? [f] : []).map((x) => (isName(x) ? x.name : ''));
    let data: Buffer = o.stream;
    for (const name of filters) {
      if (name === 'FlateDecode' || name === 'Fl') {
        const maxOutputLength = Math.max(1, Math.min(this.inflateBudget, 64 * 1024 * 1024));
        try {
          data = inflateSync(data, { maxOutputLength });
        } catch {
          try {
            data = inflateSync(data, { finishFlush: zc.Z_SYNC_FLUSH, maxOutputLength });
          } catch {
            return null;
          }
        }
        this.inflateBudget -= data.length;
        if (this.inflateBudget < 0) throw new Error('This PDF is too large to import');
        const parms = this.dictOf(d.get('DecodeParms'));
        const predictor = Number(parms?.get('Predictor') ?? 1);
        if (predictor >= 10) data = pngUnpredict(data, Number(parms?.get('Columns') ?? 1), Number(parms?.get('Colors') ?? 1), Number(parms?.get('BitsPerComponent') ?? 8));
      } else if (name === 'ASCIIHexDecode' || name === 'AHx') {
        data = Buffer.from(data.toString('latin1').replace(/[^0-9a-f]/gi, '').replace(/^(.(..)*)$/, '$10'), 'hex');
      } else if (name === 'ASCII85Decode' || name === 'A85') {
        data = ascii85(data);
      } else return null; // LZW / DCT / JPX / CCITT: not text
    }
    return data;
  }
}

function skipWsAt(text: string, i: number): number {
  while (i < text.length && /[\s]/.test(text[i])) i++;
  return i;
}

function pngUnpredict(data: Buffer, columns: number, colors: number, bits: number): Buffer {
  const bpp = Math.max(1, Math.ceil((colors * bits) / 8));
  const rowLen = Math.ceil((columns * colors * bits) / 8);
  const out: number[] = [];
  let prev = new Uint8Array(rowLen);
  for (let i = 0; i + rowLen < data.length + 1; i += rowLen + 1) {
    const type = data[i];
    const row = new Uint8Array(rowLen);
    for (let j = 0; j < rowLen; j++) {
      const x = data[i + 1 + j] ?? 0;
      const a = j >= bpp ? row[j - bpp] : 0;
      const b = prev[j];
      const c = j >= bpp ? prev[j - bpp] : 0;
      let v = x;
      if (type === 1) v = x + a;
      else if (type === 2) v = x + b;
      else if (type === 3) v = x + ((a + b) >> 1);
      else if (type === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      row[j] = v & 0xff;
    }
    out.push(...row);
    prev = row;
  }
  return Buffer.from(out);
}

function ascii85(data: Buffer): Buffer {
  const s = data.toString('latin1').replace(/\s+/g, '').replace(/^<~/, '').replace(/~>.*$/, '');
  const out: number[] = [];
  let group: number[] = [];
  for (const ch of s) {
    if (ch === 'z' && !group.length) {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0) - 33);
    if (group.length === 5) {
      let v = 0;
      for (const g of group) v = v * 85 + g;
      out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
      group = [];
    }
  }
  if (group.length) {
    const n = group.length;
    while (group.length < 5) group.push(84);
    let v = 0;
    for (const g of group) v = v * 85 + g;
    out.push(...[(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255].slice(0, n - 1));
  }
  return Buffer.from(out);
}

// ---------------------------------------------------------------- fonts

const WIN_ANSI_EXTRA: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160,
  0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

const GLYPHS: Record<string, string> = {
  space: ' ', exclam: '!', quotedbl: '"', numbersign: '#', dollar: '$', percent: '%', ampersand: '&', quotesingle: "'", quoteright: '’', quoteleft: '‘',
  parenleft: '(', parenright: ')', asterisk: '*', plus: '+', comma: ',', hyphen: '-', minus: '−', period: '.', slash: '/', colon: ':', semicolon: ';',
  less: '<', equal: '=', greater: '>', question: '?', at: '@', bracketleft: '[', backslash: '\\', bracketright: ']', asciicircum: '^', underscore: '_',
  grave: '`', braceleft: '{', bar: '|', braceright: '}', asciitilde: '~', bullet: '•', endash: '–', emdash: '—', quotedblleft: '“', quotedblright: '”',
  quotesinglbase: '‚', quotedblbase: '„', ellipsis: '…', fi: 'fi', fl: 'fl', ff: 'ff', ffi: 'ffi', ffl: 'ffl', copyright: '©', registered: '®',
  trademark: '™', degree: '°', section: '§', paragraph: '¶', dagger: '†', daggerdbl: '‡', zero: '0', one: '1', two: '2', three: '3', four: '4',
  five: '5', six: '6', seven: '7', eight: '8', nine: '9', nbspace: ' ', periodcentered: '·', guillemotleft: '«', guillemotright: '»',
};

function glyphToChar(name: string): string | null {
  if (GLYPHS[name] !== undefined) return GLYPHS[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  const uni = /^uni([0-9A-F]{4,6})$/i.exec(name) ?? /^u([0-9A-F]{4,6})$/i.exec(name);
  if (uni) return String.fromCodePoint(parseInt(uni[1], 16));
  const accent = /^([A-Za-z])(acute|grave|circumflex|dieresis|tilde|ring|cedilla|caron)$/.exec(name);
  if (accent) {
    const marks: Record<string, string> = { acute: '́', grave: '̀', circumflex: '̂', dieresis: '̈', tilde: '̃', ring: '̊', cedilla: '̧', caron: '̌' };
    return (accent[1] + marks[accent[2]]).normalize('NFC');
  }
  return null;
}

interface Font {
  /** bytes per code (ToUnicode codespace or Type0 = 2) */
  codeBytes: 1 | 2;
  toUnicode?: Map<number, string>;
  simple?: (code: number) => string;
}

function parseCMap(text: string): { map: Map<number, string>; bytes: 1 | 2 } {
  const map = new Map<number, string>();
  let bytes: 1 | 2 = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text);
  if (cs) {
    const m = /<([0-9a-f]+)>/i.exec(cs[1]);
    if (m && m[1].length >= 4) bytes = 2;
  }
  const utf16 = (hex: string) => {
    const b = Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex');
    let s = '';
    for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b.readUInt16BE(i));
    if (b.length === 1) s = String.fromCharCode(b[0]);
    return s;
  };
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]*)>/gi)) {
      map.set(parseInt(m[1], 16), utf16(m[2]));
      if (m[1].length >= 4) bytes = 2;
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(?:<([0-9a-f]+)>|\[([^\]]*)\])/gi)) {
      const lo = parseInt(m[1], 16);
      const hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[1].length >= 4) bytes = 2;
      if (m[3] !== undefined) {
        const base = Buffer.from(m[3].length % 2 ? m[3] + '0' : m[3], 'hex');
        for (let c = lo; c <= hi; c++) {
          const b = Buffer.from(base);
          if (b.length >= 2) b.writeUInt16BE((b.readUInt16BE(b.length - 2) + (c - lo)) & 0xffff, b.length - 2);
          else if (b.length === 1) b[0] = (b[0] + (c - lo)) & 0xff;
          map.set(c, utf16(b.toString('hex')));
        }
      } else if (m[4] !== undefined) {
        const list = [...m[4].matchAll(/<([0-9a-f]+)>/gi)].map((x) => x[1]);
        list.forEach((h, i) => map.set(lo + i, utf16(h)));
      }
    }
  }
  return { map, bytes };
}

function loadFont(doc: PdfDoc, ref: PdfValue | undefined): Font {
  const d = doc.dictOf(ref);
  if (!d) return { codeBytes: 1, simple: (c) => String.fromCharCode(WIN_ANSI_EXTRA[c] ?? c) };
  const subtype = (doc.get(d.get('Subtype')) as PdfName | undefined)?.name;
  const font: Font = { codeBytes: subtype === 'Type0' ? 2 : 1 };
  const tu = doc.objectOf(d.get('ToUnicode'));
  if (tu) {
    const data = doc.decode(tu);
    if (data) {
      const { map, bytes } = parseCMap(data.toString('latin1'));
      if (map.size) {
        font.toUnicode = map;
        if (subtype !== 'Type0') font.codeBytes = bytes;
      }
    }
  }
  // simple fonts: base encoding + Differences
  const enc = doc.get(d.get('Encoding'));
  const diffs = new Map<number, string>();
  let base = 'WinAnsiEncoding';
  if (isName(enc)) base = enc.name;
  else if (isDict(enc)) {
    const be = doc.get(enc.dict.get('BaseEncoding'));
    if (isName(be)) base = be.name;
    const arr = doc.get(enc.dict.get('Differences'));
    if (Array.isArray(arr)) {
      let code = 0;
      for (const item of arr) {
        if (typeof item === 'number') code = item;
        else if (isName(item)) {
          const ch = glyphToChar(item.name);
          if (ch !== null) diffs.set(code, ch);
          code++;
        }
      }
    }
  }
  font.simple = (c: number) => {
    const dch = diffs.get(c);
    if (dch !== undefined) return dch;
    if (base === 'MacRomanEncoding' && c >= 0x80) return Buffer.from([c]).toString('latin1');
    return String.fromCharCode(WIN_ANSI_EXTRA[c] ?? c);
  };
  return font;
}

const LIGATURES: Record<string, string> = { '\ufb00': 'ff', '\ufb01': 'fi', '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st' };

function decodeText(font: Font, bytes: Buffer): string {
  let s = '';
  const step = font.codeBytes;
  for (let i = 0; i + step <= bytes.length; i += step) {
    const code = step === 2 ? bytes.readUInt16BE(i) : bytes[i];
    const mapped = font.toUnicode?.get(code);
    if (mapped !== undefined) s += mapped;
    else if (step === 1 && font.simple) s += font.simple(code);
    else if (step === 2 && !font.toUnicode && code >= 0x20) s += String.fromCharCode(code);
  }
  return s.replace(/\u0000/g, '').replace(/[\ufb00-\ufb06]/g, (c) => LIGATURES[c] ?? c);
}

// ---------------------------------------------------------------- page text

type M = [number, number, number, number, number, number];
const mul = (a: M, b: M): M => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

interface Run {
  x: number;
  y: number;
  size: number;
  text: string;
  end: number;
}

function pageRuns(doc: PdfDoc, page: Map<string, PdfValue>, resources: Map<string, PdfValue> | undefined, budget: { ops: number }): Run[] {
  const fontsDict = doc.dictOf(resources?.get('Font'));
  const fonts = new Map<string, Font>();
  const fontOf = (name: string) => {
    if (!fonts.has(name)) fonts.set(name, loadFont(doc, fontsDict?.get(name)));
    return fonts.get(name)!;
  };
  const contents = doc.get(page.get('Contents'));
  const parts = (Array.isArray(contents) ? contents : [page.get('Contents')]).map((r) => doc.objectOf(r as PdfValue)).filter((o): o is PdfObject => !!o);
  const data = Buffer.concat(parts.map((o) => doc.decode(o) ?? Buffer.alloc(0)).flatMap((b) => [b, Buffer.from('\n')]));
  const runs: Run[] = [];
  const lex = new Lexer(data);
  let ctm: M = [1, 0, 0, 1, 0, 0];
  const stack: M[] = [];
  let tm: M = [1, 0, 0, 1, 0, 0];
  let tlm: M = [1, 0, 0, 1, 0, 0];
  let font: Font = { codeBytes: 1, simple: (c) => String.fromCharCode(c) };
  let size = 12;
  let leading = 0;
  let operands: PdfValue[] = [];
  const show = (pieces: PdfValue[]) => {
    const m = mul(tm, ctm);
    const scale = Math.hypot(m[2], m[3]) || 1;
    const fs = Math.abs(size * scale) || size;
    let text = '';
    let adv = 0;
    for (const p of pieces) {
      if (Buffer.isBuffer(p)) {
        const s = decodeText(font, p);
        text += s;
        adv += s.length * size * 0.5;
      } else if (typeof p === 'number') {
        adv -= (p / 1000) * size;
        if (p < -180 && text && !/\s$/.test(text)) text += ' ';
      }
    }
    if (text) runs.push({ x: m[4], y: m[5], size: fs, text, end: m[4] + adv * scale });
    tm = mul([1, 0, 0, 1, adv, 0], tm);
  };
  const newLine = (tx: number, ty: number) => {
    tlm = mul([1, 0, 0, 1, tx, ty], tlm);
    tm = tlm;
  };
  for (;;) {
    if (--budget.ops < 0) throw new Error('This PDF is too complex to import');
    const t = lex.next();
    if (!t) break;
    if (t.kind === 'value') {
      operands.push(t.v);
      if (operands.length > 64) operands.shift();
      continue;
    }
    const n = (i: number) => Number(operands[operands.length - i]) || 0;
    switch (t.op) {
      case 'q':
        stack.push(ctm);
        if (stack.length > 64) stack.shift();
        break;
      case 'Q':
        ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
        break;
      case 'cm':
        ctm = mul([n(6), n(5), n(4), n(3), n(2), n(1)], ctm);
        break;
      case 'BT':
        tm = [1, 0, 0, 1, 0, 0];
        tlm = [1, 0, 0, 1, 0, 0];
        break;
      case 'Tf': {
        const name = operands[operands.length - 2];
        if (isName(name)) font = fontOf(name.name);
        size = n(1) || size;
        break;
      }
      case 'TL':
        leading = n(1);
        break;
      case 'Td':
        newLine(n(2), n(1));
        break;
      case 'TD':
        leading = -n(1);
        newLine(n(2), n(1));
        break;
      case 'Tm':
        tm = [n(6), n(5), n(4), n(3), n(2), n(1)];
        tlm = tm;
        break;
      case 'T*':
        newLine(0, -leading);
        break;
      case 'Tj': {
        const s = operands[operands.length - 1];
        if (Buffer.isBuffer(s)) show([s]);
        break;
      }
      case 'TJ': {
        const arr = operands[operands.length - 1];
        if (Array.isArray(arr)) show(arr);
        break;
      }
      case "'": {
        newLine(0, -leading);
        const s = operands[operands.length - 1];
        if (Buffer.isBuffer(s)) show([s]);
        break;
      }
      case '"': {
        newLine(0, -leading);
        const s = operands[operands.length - 1];
        if (Buffer.isBuffer(s)) show([s]);
        break;
      }
      case 'BI': {
        // inline image: skip to EI
        const rest = data.indexOf('EI', lex.pos);
        lex.pos = rest < 0 ? data.length : rest + 2;
        break;
      }
      default:
        break;
    }
    operands = [];
  }
  return runs;
}

function pagesOf(doc: PdfDoc): { page: Map<string, PdfValue>; resources?: Map<string, PdfValue> }[] {
  const out: { page: Map<string, PdfValue>; resources?: Map<string, PdfValue> }[] = [];
  const seen = new Set<PdfValue>();
  const walk = (node: PdfValue | undefined, inherited: Map<string, PdfValue> | undefined, depth: number) => {
    const d = doc.dictOf(node);
    if (!d || depth > 40 || seen.has(node as PdfValue)) return;
    seen.add(node as PdfValue);
    const res = doc.dictOf(d.get('Resources')) ?? inherited;
    const type = (doc.get(d.get('Type')) as PdfName | undefined)?.name;
    const kids = doc.get(d.get('Kids'));
    if (type === 'Page' || (!kids && d.get('Contents'))) out.push({ page: d, resources: res });
    else if (Array.isArray(kids)) for (const k of kids) walk(k, res, depth + 1);
  };
  const root = doc.dictOf(doc.trailer?.dict.get('Root'));
  if (root) walk(root.get('Pages'), undefined, 0);
  if (!out.length) {
    for (const [, o] of [...doc.objs].sort((a, b) => a[0] - b[0])) {
      if (isDict(o.value) && (o.value.dict.get('Type') as PdfName | undefined)?.name === 'Page') out.push({ page: o.value.dict, resources: doc.dictOf(o.value.dict.get('Resources')) });
    }
  }
  return out.slice(0, 2000);
}

// ---------------------------------------------------------------- layout → blocks

interface Line {
  y: number;
  size: number;
  text: string;
  page: number;
  x: number;
  end: number;
}

function linesOf(runs: Run[], page: number): Line[] {
  const sorted = [...runs].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: { y: number; runs: Run[] }[] = [];
  for (const r of sorted) {
    const tol = Math.max(1.5, r.size * 0.35);
    const line = lines.find((l) => Math.abs(l.y - r.y) <= tol);
    if (line) line.runs.push(r);
    else lines.push({ y: r.y, runs: [r] });
  }
  return lines.sort((a, b) => b.y - a.y).map((l) => {
    const rs = l.runs.sort((a, b) => a.x - b.x);
    let text = '';
    let prevEnd = -Infinity;
    for (const r of rs) {
      const gap = r.x - prevEnd;
      if (text && !/\s$/.test(text) && !/^\s/.test(r.text) && gap > r.size * 0.25) text += ' ';
      text += r.text;
      prevEnd = Math.max(prevEnd, r.end);
    }
    const size = rs.reduce((m, r) => Math.max(m, r.size), 0);
    return { y: l.y, size, text: text.replace(/\s+/g, ' ').trim(), page, x: rs[0].x, end: prevEnd };
  }).filter((l) => l.text);
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function blocksOf(lines: Line[]): { title?: string; blocks: Spec[] } {
  const body = median(lines.map((l) => Math.round(l.size * 10) / 10)) || 12;
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) if (lines[i].page === lines[i - 1].page) gaps.push(lines[i - 1].y - lines[i].y);
  // a paragraph break is a gap clearly larger than the usual line pitch (the lower quartile of the gaps, so wide
  // paragraph spacing doesn't count as "usual"; short documents fall back to 1.6 × the body size)
  const positive = gaps.filter((g) => g > 0).sort((a, b) => a - b);
  const pitch = positive.length >= 8 ? positive[Math.floor(positive.length / 4)] : 0;
  const breakGap = Math.max(body * 1.6, pitch * 1.3);
  const blocks: Spec[] = [];
  let para: Line[] = [];
  let title: string | undefined;
  // a line that stops well short of the text column ends its paragraph (list items, short lines, last lines)
  const left = median(lines.map((l) => l.x));
  const ends = lines.map((l) => l.end).sort((a, b) => a - b);
  const right = ends[Math.floor(ends.length * 0.9)] ?? 0;
  const short = (l: Line) => right - left > body * 8 && l.end < left + (right - left) * 0.6;
  const headingType = (size: number): Spec['type'] | null => (size >= body * 1.75 ? 'header' : size >= body * 1.35 ? 'sub_header' : size >= body * 1.15 ? 'sub_sub_header' : null);
  const flush = () => {
    if (!para.length) return;
    let text = '';
    for (const l of para) text = text ? (text.endsWith('-') && /^[a-z]/.test(l.text) ? text.slice(0, -1) + l.text : `${text} ${l.text}`) : l.text;
    const h = headingType(para[0].size);
    const bullet = /^([•●◦▪‣∙·\-–*])\s+(.*)$/.exec(text);
    const number = /^(\d{1,3}[.)])\s+(.*)$/.exec(text);
    if (h && text.length < 160) {
      if (!title && h === 'header' && !blocks.length) title = text;
      else blocks.push({ type: h, text });
    } else if (bullet) blocks.push({ type: 'bulleted_list', text: bullet[2] });
    else if (number) blocks.push({ type: 'numbered_list', text: number[2] });
    else blocks.push({ type: 'text', text });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const prev = para[para.length - 1];
    const startsItem = /^([•●◦▪‣∙·\-–*]|\d{1,3}[.)])\s+/.test(l.text);
    if (prev) {
      const gap = prev.page === l.page ? prev.y - l.y : Infinity;
      const sizeChange = Math.abs(prev.size - l.size) > Math.max(0.6, body * 0.12);
      if (gap > breakGap || sizeChange || startsItem || headingType(prev.size) || short(prev)) flush();
    }
    para.push(l);
  }
  flush();
  return { title, blocks };
}

export interface PdfResult {
  title: string;
  blocks: Spec[];
  pages: number;
}

/** Extract a PDF's text layer into a page (title + paragraphs / headings / list items). */
export function pdfToSpecs(buf: Buffer, opts: { title?: string } = {}): PdfResult {
  if (buf.subarray(0, 1024).indexOf('%PDF-') < 0) throw new Error('This file isn’t a PDF');
  const doc = new PdfDoc(buf);
  if (doc.trailer?.dict.get('Encrypt')) throw new Error('This PDF is password-protected and can’t be imported');
  const pages = pagesOf(doc);
  const lines: Line[] = [];
  const budget = { ops: 5_000_000 };
  pages.forEach((p, i) => {
    try {
      lines.push(...linesOf(pageRuns(doc, p.page, p.resources, budget), i));
    } catch (e) {
      if (/too complex|too large/.test((e as Error).message)) throw e;
      /* unreadable page: skip */
    }
  });
  if (!lines.length) throw new Error('No text found in this PDF (scanned documents need OCR)');
  const { title, blocks } = blocksOf(lines);
  // Info dictionary title when the first line isn't a heading
  let infoTitle: string | undefined;
  const info = doc.dictOf(doc.trailer?.dict.get('Info'));
  const t = info ? doc.get(info.get('Title')) : undefined;
  if (Buffer.isBuffer(t)) infoTitle = (t[0] === 0xfe && t[1] === 0xff ? Buffer.from(t.subarray(2)).swap16().toString('utf16le') : t.toString('latin1')).trim() || undefined;
  return { title: title || infoTitle || opts.title || 'Untitled', blocks, pages: pages.length };
}

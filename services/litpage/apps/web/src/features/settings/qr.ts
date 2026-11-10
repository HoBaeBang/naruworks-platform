// Minimal QR Code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1–10 (up to 213 bytes —
// enough for the otpauth:// URI of 2-step verification), automatic mask selection by the standard penalty rules.
// Written from the specification for the authenticator setup dialog; no third-party code.

/** [total codewords, EC codewords per block, [blocks, data codewords per block][]] for level M, versions 1..10. */
const VERSIONS_M: [number, number, [number, number][]][] = [
  [26, 10, [[1, 16]]],
  [44, 16, [[1, 28]]],
  [70, 26, [[1, 44]]],
  [100, 18, [[2, 32]]],
  [134, 24, [[2, 43]]],
  [172, 16, [[4, 27]]],
  [196, 18, [[4, 31]]],
  [242, 22, [[2, 38], [2, 39]]],
  [292, 22, [[3, 36], [2, 37]]],
  [346, 26, [[4, 43], [1, 44]]],
];

const ALIGN: number[][] = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];
const VERSION_INFO: Record<number, number> = { 7: 0x07c94, 8: 0x085bc, 9: 0x09a99, 10: 0x0a4d3 };
const REMAINDER_BITS = [0, 7, 7, 7, 7, 7, 0, 0, 0, 0];

// ---------------------------------------------------------------------------------------------- Reed–Solomon (GF 256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();

function gfMul(a: number, b: number): number {
  return a && b ? EXP[LOG[a] + LOG[b]] : 0;
}

function rsGenerator(n: number): number[] {
  let poly = [1];
  for (let i = 0; i < n; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: number[], n: number): number[] {
  const gen = rsGenerator(n);
  const res = new Array(n).fill(0);
  for (const b of data) {
    const factor = b ^ res[0];
    res.shift();
    res.push(0);
    for (let i = 0; i < n; i++) res[i] ^= gfMul(gen[i + 1], factor);
  }
  return res;
}

// ---------------------------------------------------------------------------------------------- encoding

function utf8(s: string): number[] {
  return Array.from(new TextEncoder().encode(s));
}

function chooseVersion(len: number): number {
  for (let v = 1; v <= 10; v++) {
    const [, , blocks] = VERSIONS_M[v - 1];
    const dataCap = blocks.reduce((n, [c, d]) => n + c * d, 0);
    const bits = 4 + (v <= 9 ? 8 : 16) + len * 8;
    if (bits <= dataCap * 8) return v;
  }
  throw new Error('Text is too long for a QR code');
}

function dataCodewords(bytes: number[], v: number): number[] {
  const [, , blocks] = VERSIONS_M[v - 1];
  const cap = blocks.reduce((n, [c, d]) => n + c * d, 0);
  const bits: number[] = [];
  const put = (val: number, len: number) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, v <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, cap * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; out.length < cap; pad ^= 0xec ^ 0x11) out.push(pad);
  return out;
}

function interleave(data: number[], v: number): number[] {
  const [, ecLen, groups] = VERSIONS_M[v - 1];
  const blocks: number[][] = [];
  let k = 0;
  for (const [count, size] of groups) for (let i = 0; i < count; i++) { blocks.push(data.slice(k, k + size)); k += size; }
  const ecs = blocks.map((b) => rsRemainder(b, ecLen));
  const out: number[] = [];
  const maxLen = Math.max(...blocks.map((b) => b.length));
  for (let i = 0; i < maxLen; i++) for (const b of blocks) if (i < b.length) out.push(b[i]);
  for (let i = 0; i < ecLen; i++) for (const e of ecs) out.push(e[i]);
  return out;
}

// ---------------------------------------------------------------------------------------------- matrix

type Grid = (boolean | null)[][];

function makeGrid(size: number): { m: Grid; fn: boolean[][] } {
  return { m: Array.from({ length: size }, () => new Array(size).fill(null)), fn: Array.from({ length: size }, () => new Array(size).fill(false)) };
}

function setFn(m: Grid, fn: boolean[][], x: number, y: number, dark: boolean) {
  m[y][x] = dark;
  fn[y][x] = true;
}

function drawFunctionPatterns(m: Grid, fn: boolean[][], v: number) {
  const size = m.length;
  for (let i = 0; i < size; i++) {
    setFn(m, fn, 6, i, i % 2 === 0);
    setFn(m, fn, i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(m, fn, x, y, d !== 2 && d !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const pos = ALIGN[v - 1];
  for (const ay of pos) {
    for (const ax of pos) {
      if ((ax === 6 && ay === 6) || (ax === 6 && ay === size - 7) || (ax === size - 7 && ay === 6)) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFn(m, fn, ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
  // reserve format areas (filled per mask) + the dark module
  drawFormat(m, fn, 0);
  setFn(m, fn, 8, size - 8, true);
  if (v >= 7) {
    const bits = VERSION_INFO[v];
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFn(m, fn, a, b, dark);
      setFn(m, fn, b, a, dark);
    }
  }
}

/** Format info for level M (00) and the mask: BCH(15,5) with 0x537, XOR 0x5412. */
function formatBits(mask: number): number {
  const data = (0b00 << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(m: Grid, fn: boolean[][], mask: number) {
  const size = m.length;
  const bits = formatBits(mask);
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) setFn(m, fn, 8, i, bit(i));
  setFn(m, fn, 8, 7, bit(6));
  setFn(m, fn, 8, 8, bit(7));
  setFn(m, fn, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFn(m, fn, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFn(m, fn, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFn(m, fn, 8, size - 15 + i, bit(i));
}

function placeData(m: Grid, fn: boolean[][], codewords: number[], remainder: number) {
  const size = m.length;
  const bits: number[] = [];
  for (const c of codewords) for (let i = 7; i >= 0; i--) bits.push((c >>> i) & 1);
  for (let i = 0; i < remainder; i++) bits.push(0);
  let k = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fn[y][x]) continue;
        m[y][x] = k < bits.length ? bits[k] === 1 : false;
        k++;
      }
    }
  }
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function applyMask(m: Grid, fn: boolean[][], mask: number): boolean[][] {
  const f = MASKS[mask];
  return m.map((row, y) => row.map((v, x) => (fn[y][x] ? !!v : !!v !== f(x, y))));
}

function penalty(g: boolean[][]): number {
  const size = g.length;
  let score = 0;
  // rule 1: runs of 5+ same-colored modules in a row/column
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = pass ? g[b][a] : g[a][b];
        const prev = pass ? g[b - 1][a] : g[a][b - 1];
        if (cur === prev) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
      if (run >= 5) score += run - 2;
    }
  }
  // rule 2: 2×2 blocks
  for (let y = 0; y < size - 1; y++) for (let x = 0; x < size - 1; x++) if (g[y][x] === g[y][x + 1] && g[y][x] === g[y + 1][x] && g[y][x] === g[y + 1][x + 1]) score += 3;
  // rule 3: finder-like patterns 1:1:3:1:1 with 4 light modules on a side
  const pat1 = [true, false, true, true, true, false, true, false, false, false, false];
  const pat2 = [false, false, false, false, true, false, true, true, true, false, true];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x + 11 <= size; x++) {
      let h1 = true, h2 = true, v1 = true, v2 = true;
      for (let k = 0; k < 11; k++) {
        if (g[y][x + k] !== pat1[k]) h1 = false;
        if (g[y][x + k] !== pat2[k]) h2 = false;
        if (g[x + k][y] !== pat1[k]) v1 = false;
        if (g[x + k][y] !== pat2[k]) v2 = false;
      }
      score += 40 * (Number(h1) + Number(h2) + Number(v1) + Number(v2));
    }
  }
  // rule 4: dark module balance
  let dark = 0;
  for (const row of g) for (const v of row) if (v) dark++;
  const pct = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(pct - 50) / 5) * 10;
  return score;
}

/** QR matrix for `text` (true = dark module), without the quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  const bytes = utf8(text);
  const v = chooseVersion(bytes.length);
  const size = 17 + 4 * v;
  const codewords = interleave(dataCodewords(bytes, v), v);
  const { m, fn } = makeGrid(size);
  drawFunctionPatterns(m, fn, v);
  placeData(m, fn, codewords, REMAINDER_BITS[v - 1]);
  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    drawFormat(m, fn, mask);
    const g = applyMask(m, fn, mask);
    const s = penalty(g);
    if (s < bestScore) {
      bestScore = s;
      best = g;
    }
  }
  return best!;
}

/** SVG path data (one unit per module, 4-module quiet zone) for an <svg viewBox="0 0 size size">. */
export function qrSvgPath(text: string): { size: number; path: string } {
  const g = qrMatrix(text);
  const q = 4;
  let path = '';
  g.forEach((row, y) => row.forEach((dark, x) => { if (dark) path += `M${x + q} ${y + q}h1v1h-1z`; }));
  return { size: g.length + 2 * q, path };
}

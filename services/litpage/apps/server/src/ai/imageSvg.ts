// SVG sanitizer for AI image generation (AI-IMG-*): the model's SVG becomes a stored file that pages show through
// <img>, so it is rebuilt from an allowlist instead of trusted:
//   - only drawing elements (shapes, paths, text, gradients, patterns, clip paths, masks, markers, filters) survive;
//     script, foreignObject, image, iframe, animation, use of anything outside the document … are dropped with their
//     content;
//   - only presentation / geometry attributes survive; on* handlers, href / xlink:href that don't point inside the
//     document (#id), url(…) values that aren't url(#id), javascript: / data: / external references and CSS @import
//     are removed;
//   - <style> keeps plain declarations only; DOCTYPE / ENTITY / processing instructions / CDATA are removed
//     (no XXE or entity expansion); comments are dropped;
//   - the result is re-serialized (escaped text and attributes) with a single <svg> root and an xmlns, and capped at
//     MAX_SVG_BYTES.
export const MAX_SVG_BYTES = 300_000;

const ELEMENTS = new Set([
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'textpath',
  'lineargradient', 'radialgradient', 'stop', 'clippath', 'mask', 'pattern', 'marker', 'style', 'filter', 'fegaussianblur', 'feoffset', 'feblend',
  'fecolormatrix', 'fecomposite', 'feflood', 'femerge', 'femergenode', 'fedropshadow', 'femorphology', 'feturbulence', 'fedisplacementmap',
  'fecomponenttransfer', 'fefunca', 'fefuncr', 'fefuncg', 'fefuncb',
]);
// everything else (script, foreignObject, image, feImage, iframe, a, animate/set, …) is dropped with its content

const ATTRS = new Set([
  'id', 'class', 'style', 'transform', 'viewbox', 'width', 'height', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'd', 'points',
  'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'offset', 'stop-color', 'stop-opacity', 'gradientunits', 'gradienttransform', 'spreadmethod',
  'fx', 'fy', 'fr', 'patternunits', 'patterncontentunits', 'patterntransform', 'clip-path', 'clip-rule', 'clippathunits', 'mask', 'maskunits',
  'maskcontentunits', 'filter', 'filterunits', 'primitiveunits', 'preserveaspectratio', 'font-family', 'font-size', 'font-weight', 'font-style',
  'text-anchor', 'dominant-baseline', 'alignment-baseline', 'letter-spacing', 'word-spacing', 'text-decoration', 'dx', 'dy', 'rotate', 'lengthadjust',
  'textlength', 'visibility', 'display', 'color', 'xmlns', 'xmlns:xlink', 'version', 'href', 'xlink:href', 'markerwidth', 'markerheight', 'refx', 'refy',
  'orient', 'markerunits', 'marker-start', 'marker-mid', 'marker-end', 'stddeviation', 'in', 'in2', 'result', 'mode', 'operator', 'k1', 'k2', 'k3', 'k4',
  'values', 'type', 'flood-color', 'flood-opacity', 'basefrequency', 'numoctaves', 'seed', 'stitchtiles', 'scale', 'xchannelselector', 'ychannelselector',
  'radius', 'tablevalues', 'slope', 'intercept', 'amplitude', 'exponent', 'paint-order', 'vector-effect', 'shape-rendering', 'image-rendering',
  'mix-blend-mode', 'isolation', 'pathlength', 'startoffset', 'method', 'spacing', 'side',
]);

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h: string) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_m, d: string) => safeChar(parseInt(d, 10)))
    .replace(/&(lt|gt|amp|quot|apos);/g, (_m, n: string) => ({ lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" } as Record<string, string>)[n]);
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return ' ';
  return String.fromCodePoint(code);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** url(#id) only; no external / data / javascript references, no expressions or imports. */
function safeValue(name: string, raw: string): string | null {
  const v = decodeEntities(raw).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (v.length > 50_000) return null;
  const lower = v.toLowerCase().replace(/\s+/g, '');
  if (/javascript:|vbscript:|data:|expression\(|@import|behavior:|-moz-binding/.test(lower)) return null;
  for (const m of lower.matchAll(/url\(([^)]*)\)/g)) {
    const target = m[1].replace(/^['"]|['"]$/g, '');
    if (!target.startsWith('#')) return null;
  }
  if (name === 'href' || name === 'xlink:href') return /^#[\w.:-]+$/.test(v) ? v : null;
  return v;
}

function safeStyle(css: string): string {
  // declarations only: drop at-rules, url() pointing outside, imports
  const clean = decodeEntities(css).replace(/\/\*[\s\S]*?\*\//g, '').replace(/@[a-z-]+[^;{}]*(\{[^}]*\}|;)/gi, '');
  const lower = clean.toLowerCase().replace(/\s+/g, '');
  if (/javascript:|expression\(|behavior:|-moz-binding|@import/.test(lower)) return '';
  return clean.replace(/url\(\s*(['"]?)(?!#)[^)]*\1\s*\)/gi, 'none').replace(/</g, '').slice(0, 50_000);
}

interface Tag {
  name: string;
  attrs: [string, string][];
  selfClosing: boolean;
  closing: boolean;
}

function parseTag(src: string): Tag | null {
  const m = /^<(\/?)([A-Za-z][\w:.-]*)([\s\S]*?)(\/?)>$/.exec(src);
  if (!m) return null;
  const attrs: [string, string][] = [];
  const re = /([A-Za-z_:][\w:.-]*)\s*(?:=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let a: RegExpExecArray | null;
  while ((a = re.exec(m[3]))) attrs.push([a[1].toLowerCase(), a[3] ?? a[4] ?? a[5] ?? '']);
  return { name: m[2].toLowerCase(), attrs, selfClosing: m[4] === '/', closing: m[1] === '/' };
}

export class SvgError extends Error {}

/** Extract and sanitize the first <svg>…</svg> document of `raw` (model output may wrap it in prose / code fences). */
export function sanitizeSvg(raw: string): string {
  const start = raw.search(/<svg[\s>]/i);
  const end = raw.toLowerCase().lastIndexOf('</svg>');
  if (start < 0 || end < start) throw new SvgError('The model didn’t return an SVG image.');
  let src = raw.slice(start, end + 6);
  if (src.length > 2 * MAX_SVG_BYTES) throw new SvgError('The generated image is too large.');
  // no DOCTYPE / ENTITY / processing instructions / comments; CDATA becomes plain (escaped) text
  src = src.replace(/<!DOCTYPE[\s\S]*?>/gi, '').replace(/<!ENTITY[\s\S]*?>/gi, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  src = src.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_m, t: string) => esc(t));
  const out: string[] = [];
  const stack: string[] = [];
  let drop = 0; // depth inside a dropped element
  let rootSeen = false;
  let i = 0;
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const text = lt < 0 ? src.slice(i) : src.slice(i, lt);
    if (text && !drop && stack.length) out.push(esc(decodeEntities(text)));
    if (lt < 0) break;
    const gt = src.indexOf('>', lt);
    if (gt < 0) break;
    const tag = parseTag(src.slice(lt, gt + 1));
    i = gt + 1;
    if (!tag) continue;
    if (tag.closing) {
      if (drop) {
        drop--;
        continue;
      }
      if (stack.length && stack[stack.length - 1] === tag.name) {
        stack.pop();
        out.push(`</${tag.name === 'lineargradient' ? 'linearGradient' : tag.name === 'radialgradient' ? 'radialGradient' : canonical(tag.name)}>`);
      }
      continue;
    }
    if (drop || !ELEMENTS.has(tag.name) || (tag.name === 'svg' && rootSeen && !stack.length)) {
      if (!tag.selfClosing) drop++;
      continue;
    }
    if (tag.name === 'svg' && !stack.length) rootSeen = true;
    if (!stack.length && tag.name !== 'svg') continue;
    const attrs: string[] = [];
    for (const [name, value] of tag.attrs) {
      if (name.startsWith('on') || !ATTRS.has(name)) continue;
      if (name === 'style') {
        const css = safeStyle(value);
        if (css.trim()) attrs.push(`style="${esc(css)}"`);
        continue;
      }
      const v = safeValue(name, value);
      if (v === null) continue;
      attrs.push(`${canonicalAttr(name)}="${esc(v)}"`);
    }
    if (tag.name === 'svg' && stack.length === 0 && !tag.attrs.some(([n]) => n === 'xmlns')) attrs.unshift('xmlns="http://www.w3.org/2000/svg"');
    const el = canonical(tag.name);
    if (tag.name === 'style') {
      // the content of <style> is read raw up to </style> and sanitized as CSS
      const close = src.toLowerCase().indexOf('</style>', i);
      const css = safeStyle(src.slice(i, close < 0 ? src.length : close));
      out.push(`<style>${css.replace(/</g, '')}</style>`);
      i = close < 0 ? src.length : close + 8;
      continue;
    }
    if (tag.selfClosing) out.push(`<${el}${attrs.length ? ` ${attrs.join(' ')}` : ''}/>`);
    else {
      out.push(`<${el}${attrs.length ? ` ${attrs.join(' ')}` : ''}>`);
      stack.push(tag.name);
    }
    if (out.join('').length > MAX_SVG_BYTES) throw new SvgError('The generated image is too large.');
  }
  while (stack.length) out.push(`</${canonical(stack.pop()!)}>`);
  const svg = out.join('');
  if (!rootSeen || !/<svg[\s>]/.test(svg)) throw new SvgError('The model didn’t return an SVG image.');
  if (Buffer.byteLength(svg) > MAX_SVG_BYTES) throw new SvgError('The generated image is too large.');
  return svg;
}

const CANON: Record<string, string> = {
  lineargradient: 'linearGradient', radialgradient: 'radialGradient', clippath: 'clipPath', textpath: 'textPath', fegaussianblur: 'feGaussianBlur',
  feoffset: 'feOffset', feblend: 'feBlend', fecolormatrix: 'feColorMatrix', fecomposite: 'feComposite', feflood: 'feFlood', femerge: 'feMerge',
  femergenode: 'feMergeNode', fedropshadow: 'feDropShadow', femorphology: 'feMorphology', feturbulence: 'feTurbulence', fedisplacementmap: 'feDisplacementMap',
  fecomponenttransfer: 'feComponentTransfer', fefunca: 'feFuncA', fefuncr: 'feFuncR', fefuncg: 'feFuncG', fefuncb: 'feFuncB',
};
function canonical(name: string): string {
  return CANON[name] ?? name;
}

const CANON_ATTR: Record<string, string> = {
  viewbox: 'viewBox', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform', spreadmethod: 'spreadMethod', patternunits: 'patternUnits',
  patterncontentunits: 'patternContentUnits', patterntransform: 'patternTransform', clippathunits: 'clipPathUnits', maskunits: 'maskUnits',
  maskcontentunits: 'maskContentUnits', filterunits: 'filterUnits', primitiveunits: 'primitiveUnits', preserveaspectratio: 'preserveAspectRatio',
  markerwidth: 'markerWidth', markerheight: 'markerHeight', refx: 'refX', refy: 'refY', markerunits: 'markerUnits', stddeviation: 'stdDeviation',
  basefrequency: 'baseFrequency', numoctaves: 'numOctaves', stitchtiles: 'stitchTiles', xchannelselector: 'xChannelSelector',
  ychannelselector: 'yChannelSelector', tablevalues: 'tableValues', lengthadjust: 'lengthAdjust', textlength: 'textLength', pathlength: 'pathLength',
  startoffset: 'startOffset',
};
function canonicalAttr(name: string): string {
  return CANON_ATTR[name] ?? name;
}

/** Width / height of a sanitized SVG (viewBox, else width/height attributes, else 1024×768). */
export function svgSize(svg: string): { width: number; height: number } {
  const root = /<svg[^>]*>/.exec(svg)?.[0] ?? '';
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(root);
  if (vb) return { width: Math.round(Number(vb[1])), height: Math.round(Number(vb[2])) };
  const w = /width="([\d.]+)/.exec(root);
  const h = /height="([\d.]+)/.exec(root);
  return { width: w ? Math.round(Number(w[1])) : 1024, height: h ? Math.round(Number(h[1])) : 768 };
}

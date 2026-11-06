// Lazy Mermaid renderer for code blocks with language "Mermaid" (mermaid is only fetched when a diagram is shown).
type MermaidApi = typeof import('mermaid')['default'];

let loading: Promise<MermaidApi> | null = null;
let currentTheme = '';
let seq = 0;
const cache = new Map<string, { svg?: string; error?: string }>();

function load(): Promise<MermaidApi> {
  loading ??= import('mermaid').then((m) => m.default);
  return loading;
}

function isDark() {
  return document.documentElement.classList.contains('lit-dark-theme') || document.body.classList.contains('lit-dark-theme') || !!document.querySelector('.lit-dark-theme');
}

/** Render `code` to SVG markup; results are cached per (theme, code). */
export async function renderMermaid(code: string): Promise<{ svg?: string; error?: string }> {
  const theme = isDark() ? 'dark' : 'neutral';
  const key = `${theme}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const mermaid = await load();
  if (theme !== currentTheme) {
    mermaid.initialize({ startOnLoad: false, theme, securityLevel: 'strict', fontFamily: 'ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif' });
    currentTheme = theme;
  }
  const id = `nc-mermaid-${++seq}`;
  let res: { svg?: string; error?: string };
  try {
    await mermaid.parse(code);
    const { svg } = await mermaid.render(id, code);
    res = { svg };
  } catch (e) {
    res = { error: String((e as Error)?.message ?? e).replace(/^Error:\s*/, '') };
    document.getElementById(id)?.remove();
    document.getElementById(`d${id}`)?.remove();
  }
  if (cache.size > 100) cache.clear();
  cache.set(key, res);
  return res;
}

/** Rasterize an SVG string for “Download image”, which saves the diagram as JPEG. */
export async function svgToJpeg(svg: string, scale = 2): Promise<Blob | null> {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const el = doc.documentElement;
  const vb = el.getAttribute('viewBox')?.split(/[\s,]+/).map(Number);
  const w = vb?.[2] || parseFloat(el.getAttribute('width') ?? '') || 800;
  const h = vb?.[3] || parseFloat(el.getAttribute('height') ?? '') || 600;
  el.setAttribute('width', String(w));
  el.setAttribute('height', String(h));
  const data = new XMLSerializer().serializeToString(el);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * scale);
  c.height = Math.ceil(h * scale);
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.92));
}

// URL safety helpers shared by the server (import/export rendering) and the web app (links, embeds).
// Stored data (rich-text links, bookmark/embed sources, button URLs, file properties) is user-controlled, so every
// place that turns it into a navigation (href, window.open) or a frame (iframe src) must drop script-capable schemes
// such as `javascript:`, `data:` and `vbscript:`. Parsing with the WHATWG URL parser normalizes the tricks browsers
// accept (leading control characters, embedded tabs/newlines, mixed case: "  JaVa\tScRiPt:alert(1)").

const LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const BASE = 'https://relative.invalid/';

function parse(raw: string): URL | null {
  try {
    return new URL(raw, BASE);
  } catch {
    return null;
  }
}

/** Safe value for an `<a href>` / `window.open`: http(s), mailto, tel or a relative URL; otherwise null. */
export function safeHref(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const u = parse(s);
  if (!u || !LINK_SCHEMES.has(u.protocol)) return null;
  return s;
}

/** Safe value for an `<iframe src>`: an absolute http(s) URL or a same-origin path ("/files/…"); otherwise null. */
export function safeFrameSrc(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  const u = parse(s);
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) return null;
  // relative input resolves against the placeholder base: only rooted paths ("/files/…") are meaningful in a frame
  if (u.origin === new URL(BASE).origin && !s.startsWith('/')) return null;
  return s;
}

/** True for absolute http(s) URLs (the only targets the server may fetch or a webhook may call). */
export function isHttpUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

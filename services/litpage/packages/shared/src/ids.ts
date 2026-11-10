// IDs: UUID v4 like Litpage's record ids; URL form is the 32-char hex without dashes.
export function newId(): string {
  return globalThis.crypto.randomUUID();
}

export function compactId(id: string): string {
  return id.replace(/-/g, '');
}

export function expandId(hex32: string): string {
  const h = hex32.replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(h)) return hex32;
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** "My Page Title" + id -> "My-Page-Title-<32hex>" (Litpage page URL slug). */
export function pageSlug(title: string, id: string): string {
  const words = title
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join('-');
  return words ? `${words}-${compactId(id)}` : compactId(id);
}

/** Extract the trailing 32-hex id from a slug or path segment. */
export function idFromSlug(slug: string): string | null {
  const m = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(slug);
  return m ? expandId(m[1]) : null;
}

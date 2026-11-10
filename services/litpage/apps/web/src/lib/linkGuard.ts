
// from user data (rich text, bookmarks, properties, imports), so a click on any <a href="javascript:…"> /
// "vbscript:" / non-download "data:" link is cancelled before the browser navigates. Render sites also sanitize
// with safeHref / safeFrameSrc from @nc/shared/url.ts; this catches anything they miss.
function blocked(a: HTMLAnchorElement): boolean {
  const raw = a.getAttribute('href');
  if (!raw) return false;
  let protocol = '';
  try {
    protocol = new URL(raw, location.href).protocol;
  } catch {
    return false;
  }
  if (protocol === 'javascript:' || protocol === 'vbscript:') return true;
  return protocol === 'data:' && !a.hasAttribute('download');
}

function guard(e: MouseEvent) {
  const t = e.target as Element | null;
  const a = t && typeof t.closest === 'function' ? (t.closest('a[href]') as HTMLAnchorElement | null) : null;
  if (a && blocked(a)) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', guard, true);
  document.addEventListener('auxclick', guard, true);
}

export {};

// web_fetch for providers without a server-side page reader (openai): the model calls a `web_fetch` function and
// the server opens the page itself through safefetch.ts (SSRF rules: public addresses only, bounded size and time).
// Like Anthropic's web_fetch, only URLs that already appeared in the conversation — the user's messages, web search
// results, earlier fetched pages — can be opened, so a prompt-injected model can't send workspace data out in a URL;
// an allowed-domains list (Custom Agents' trusted sites) additionally limits where it may go.
import { FetchBlockedError, safeFetch } from '../../safefetch.ts';
import { decodeEntities, parseHtmlTree } from '../../content/html.ts';
import { hostOf, normUrl } from './responses.ts';

export interface WebFetchRequest {
  url: string;
  allowedDomains?: string[];
  blockedDomains?: string[];
  /** normalized URLs seen in the conversation (responses.ts normUrl) */
  knownUrls: Set<string>;
  maxChars: number;
}

export interface WebFetchResult {
  url: string;
  title?: string;
  text?: string;
  /** Anthropic web_fetch error codes: url_not_allowed, url_not_accessible, unsupported_content_type, too_many_requests, invalid_input */
  error?: string;
}

export type WebFetcher = (req: WebFetchRequest, signal?: AbortSignal) => Promise<WebFetchResult>;

function onDomain(host: string, list: string[]): boolean {
  return list.some((d) => {
    const dd = d.toLowerCase().replace(/^\*\./, '').replace(/^www\./, '');
    return !!dd && (host === dd || host.endsWith(`.${dd}`));
  });
}

type Tree = ReturnType<typeof parseHtmlTree>;
const BLOCKS = new Set(['p', 'div', 'section', 'article', 'main', 'header', 'footer', 'aside', 'ul', 'ol', 'li', 'table', 'tr', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'dl', 'dt', 'dd', 'figure', 'figcaption', 'details', 'summary', 'br', 'hr']);

/** Readable text of an HTML page (links kept as "text (url)" so the model can follow them). */
export function htmlToText(html: string, base: string): { title: string; text: string } {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').replace(/\s+/g, ' ').trim();
  const out: string[] = [];
  const walk = (n: Tree | string) => {
    if (typeof n === 'string') {
      out.push(n.replace(/\s+/g, ' '));
      return;
    }
    const block = BLOCKS.has(n.tag);
    if (block) out.push('\n');
    if (/^h[1-6]$/.test(n.tag)) out.push(`${'#'.repeat(Number(n.tag[1]))} `);
    if (n.tag === 'li') out.push('- ');
    for (const c of n.children as (Tree | string)[]) walk(c);
    if (n.tag === 'a' && n.attrs.href) {
      try {
        const href = new URL(n.attrs.href, base);
        if (href.protocol === 'http:' || href.protocol === 'https:') out.push(` (${href.toString()})`);
      } catch {
        /* not a URL */
      }
    }
    if (n.tag === 'td' || n.tag === 'th') out.push(' | ');
    if (block) out.push('\n');
  };
  walk(parseHtmlTree(html));
  const text = out.join('').split('\n').map((l) => l.replace(/[ \t]+/g, ' ').trim()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

function decode(body: Buffer, contentType: string): string {
  const charset = /charset=([^;]+)/i.exec(contentType)?.[1]?.trim().replace(/^["']|["']$/g, '') || 'utf-8';
  try {
    return new TextDecoder(charset).decode(body);
  } catch {
    return body.toString('utf8');
  }
}

export const fetchWebPage: WebFetcher = async (req, signal) => {
  const raw = String(req.url ?? '').trim();
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, error: 'invalid_input' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { url: raw, error: 'invalid_input' };
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (req.blockedDomains?.length && onDomain(host, req.blockedDomains)) return { url: raw, error: 'url_not_allowed' };
  if (req.allowedDomains?.length) {
    if (!onDomain(host, req.allowedDomains)) return { url: raw, error: 'url_not_allowed' };
  } else if (!req.knownUrls.has(normUrl(raw))) {
    return { url: raw, error: 'url_not_allowed' };
  }
  try {
    const fetching = safeFetch(u.toString(), { accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5', maxBytes: 2_000_000, timeoutMs: 10_000 });
    const res = await (signal
      ? Promise.race([fetching, new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('aborted'));
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      })])
      : fetching);
    // a redirect may not leave the allowed domains either
    if (req.allowedDomains?.length && !onDomain(new URL(res.url).hostname.toLowerCase().replace(/^www\./, ''), req.allowedDomains)) return { url: raw, error: 'url_not_allowed' };
    if (res.status === 429) return { url: raw, error: 'too_many_requests' };
    if (res.status >= 400) return { url: raw, error: 'url_not_accessible' };
    const type = res.contentType.toLowerCase();
    let title = '';
    let text: string;
    if (type.includes('html')) ({ title, text } = htmlToText(decode(res.body, type), res.url));
    else if (!type || type.startsWith('text/') || type.includes('json') || type.includes('xml')) text = decode(res.body, type);
    else return { url: raw, error: 'unsupported_content_type' };
    const body = text.length > req.maxChars ? `${text.slice(0, req.maxChars)}\n[Page truncated.]` : text;
    return { url: res.url, title: title || hostOf(res.url), text: `Title: ${title || hostOf(res.url)}\nURL: ${res.url}\n\n${body}` };
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof FetchBlockedError) return { url: raw, error: 'url_not_allowed' };
    return { url: raw, error: 'url_not_accessible' };
  }
};

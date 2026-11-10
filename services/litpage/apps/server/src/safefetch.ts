// Server-side fetch of user-supplied URLs (bookmark previews, embed discovery / oEmbed) without SSRF:
//   - http(s) only, no credentials in the URL, default ports or 1024+ (no SMTP/SSH/Redis-style targets)
//   - every address the host resolves to must be public (loopback, private, link-local / cloud metadata,
//     CGNAT, multicast, reserved, IPv4-mapped / NAT64 / 6to4 forms of those are refused)
//   - the address that was checked is the one connected to (custom `lookup`: no DNS-rebinding window)
//   - redirects are followed manually (max 5) and every hop is validated again
//   - bounded time and size; no compressed transfer encodings
// Local development can allow loopback targets (e2e fixture sites) with NODE_ENV!=production and
// NC_DEV_ALLOW_LOOPBACK_FETCH=1 — private networks and metadata addresses stay blocked even then.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

export class FetchBlockedError extends Error {
  status = 400;
}

const v4 = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) v4.addSubnet(net, prefix, 'ipv4');

const v6 = new BlockList();
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) v6.addSubnet(net, prefix, 'ipv6');

/** 16 bytes of an IPv6 address (handles "::" and a dotted IPv4 tail), or null. */
function v6Bytes(addr: string): number[] | null {
  let a = addr.split('%')[0].toLowerCase();
  let tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    tail = dotted[1].split('.').map(Number);
    a = a.slice(0, -dotted[1].length) + '0:0';
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const parse = (s: string) => (s ? s.split(':').map((h) => parseInt(h, 16)) : []);
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  const groups = halves.length === 2 ? [...head, ...Array(8 - head.length - rest.length).fill(0), ...rest] : head;
  if (groups.length !== 8 || groups.some((g) => !Number.isInteger(g) || g < 0 || g > 0xffff)) return null;
  const bytes = groups.flatMap((g) => [g >> 8, g & 0xff]);
  if (tail.length) bytes.splice(12, 4, ...tail);
  return bytes;
}

/** True for addresses a server-side fetch must never reach. */
export function isBlockedAddress(ip: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    if (opts.allowLoopback && ip.startsWith('127.')) return false;
    return v4.check(ip, 'ipv4');
  }
  if (kind !== 6) return true;
  const b = v6Bytes(ip);
  if (!b) return true;
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d) forms: judge the embedded IPv4 address
  const zeros = b.slice(0, 10).every((x) => x === 0);
  if (zeros && ((b[10] === 0xff && b[11] === 0xff) || (b[10] === 0 && b[11] === 0 && !(b[12] === 0 && b[13] === 0 && b[14] === 0 && b[15] <= 1)))) {
    return isBlockedAddress(b.slice(12).join('.'), opts);
  }
  if (opts.allowLoopback && b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return false;
  return v6.check(ip.split('%')[0], 'ipv6');
}

function devLoopback(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.NC_DEV_ALLOW_LOOPBACK_FETCH === '1';
}

/** Throw unless `raw` is a URL the server may fetch (scheme, credentials, port; addresses are checked on connect). */
export function assertFetchableUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new FetchBlockedError('Invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchBlockedError('Only http(s) URLs are supported');
  if (u.username || u.password) throw new FetchBlockedError('URLs with credentials are not supported');
  const port = u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
  if (port !== 80 && port !== 443 && port < 1024 && !(devLoopback() && isLoopbackHost(u.hostname))) throw new FetchBlockedError('This port is not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && isBlockedAddress(host, { allowLoopback: devLoopback() })) throw new FetchBlockedError('URL is not reachable');
  if (/^(localhost|.*\.localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host) && !(devLoopback() && /^localhost$/i.test(host))) {
    throw new FetchBlockedError('URL is not reachable');
  }
  return u;
}

function isLoopbackHost(h: string): boolean {
  const host = h.replace(/^\[|\]$/g, '');
  return /^localhost$/i.test(host) || host.startsWith('127.') || host === '::1';
}

/** DNS lookup that refuses (all) blocked addresses — used for the actual connection. */
export function guardedLookup(resolve: typeof dnsLookup = dnsLookup): LookupFunction {
  return ((hostname: string, options: any, callback: any) => {
    resolve(hostname, { ...options, all: true }, (err: NodeJS.ErrnoException | null, addresses: LookupAddress[] | string) => {
      if (err) return callback(err);
      const list = (Array.isArray(addresses) ? addresses : [{ address: addresses as string, family: isIP(addresses as string) }]) as LookupAddress[];
      if (!list.length || list.some((a) => isBlockedAddress(a.address, { allowLoopback: devLoopback() }))) {
        return callback(Object.assign(new FetchBlockedError('URL is not reachable'), { code: 'EBLOCKED' }));
      }
      if (options?.all) return callback(null, list);
      return callback(null, list[0].address, list[0].family);
    });
  }) as LookupFunction;
}

export interface SafeResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
  /** response headers (lower-case names), e.g. mcp-session-id for MCP connection checks */
  headers?: Record<string, string | string[] | undefined>;
}

export interface SafeFetchOptions {
  accept?: string;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  /** POST (automation / button "Send webhook"): redirects are not followed, the 3xx response is returned */
  method?: 'GET' | 'POST';
  body?: string;
  /** extra request headers (POST only; hop-by-hop / host headers are ignored) */
  headers?: Record<string, string>;
  /** test seam */
  resolve?: typeof dnsLookup;
}

const BLOCKED_REQUEST_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-connection', 'expect']);

function once(u: URL, opts: SafeFetchOptions, signal: AbortSignal): Promise<IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const post = opts.method === 'POST';
    const extra: Record<string, string> = {};
    if (post) {
      for (const [k, v] of Object.entries(opts.headers ?? {})) {
        if (!BLOCKED_REQUEST_HEADERS.has(k.toLowerCase()) && !/[\r\n]/.test(v) && !/[\r\n]/.test(k)) extra[k] = v;
      }
      extra['content-length'] = String(Buffer.byteLength(opts.body ?? ''));
    }
    const req = (u.protocol === 'https:' ? httpsRequest : httpRequest)(u, {
      method: post ? 'POST' : 'GET',
      lookup: guardedLookup(opts.resolve),
      signal,
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; LitCloneBot/1.0; +https://localhost)',
        accept: opts.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.8',
        'accept-encoding': 'identity',
        ...extra,
      },
    });
    req.on('response', resolvePromise);
    req.on('error', reject);
    req.end(post ? opts.body ?? '' : undefined);
  });
}

/** GET (or POST, see SafeFetchOptions.method) a user-supplied URL with the protections above. Throws FetchBlockedError for refused targets. */
export async function safeFetch(raw: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 6000);
  try {
    let u = assertFetchableUrl(raw);
    for (let hop = 0; ; hop++) {
      const res = await once(u, opts, ac.signal);
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location && opts.method !== 'POST') {
        res.resume();
        if (hop >= (opts.maxRedirects ?? 5)) throw new FetchBlockedError('Too many redirects');
        u = assertFetchableUrl(new URL(res.headers.location, u).toString());
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of res) {
        const b = chunk as Buffer;
        size += b.length;
        if (size > maxBytes) {
          chunks.push(b.subarray(0, Math.max(0, maxBytes - (size - b.length))));
          res.destroy();
          break;
        }
        chunks.push(b);
      }
      return { url: u.toString(), status, contentType: String(res.headers['content-type'] ?? ''), body: Buffer.concat(chunks), headers: res.headers };
    }
  } catch (e) {
    if (e instanceof FetchBlockedError || (e as { code?: string })?.code === 'EBLOCKED') throw e instanceof FetchBlockedError ? e : new FetchBlockedError('URL is not reachable');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

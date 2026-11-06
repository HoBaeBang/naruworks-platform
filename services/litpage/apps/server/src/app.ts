// HTTP routes: /api/rpc/* JSON RPC, file uploads/downloads, AI streaming and (in production) the built web
// app. main.ts serves this app and attaches the WebSocket hub; tests import it directly (app.request).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { getConnInfo } from '@hono/node-server/conninfo';
import { newId } from '@nc/shared/ids.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getRecord } from './db.ts';
import { parseCookies, userForToken } from './auth.ts';
import { handlers, ApiError } from './api/handlers.ts';
import { realtime } from './realtime.ts';
import { blockRole, recordRole, UserVisibility } from './records.ts';
import { redactDatabaseRecord } from './propaccess.ts';
import { extraHandlers } from './api/extra.ts';
import { registerAiRoutes } from './aiStream.ts';
import { registerMailRoutes } from './mail.ts';
import { registerPublicApi } from './publicApi/routes.ts';
import { cleanFileName, cleanMime, fileHeaders, fileRow, storeFile } from './content/files.ts';
import { hit } from './ratelimit.ts';
import { audit } from './audit.ts';
import { pageIdOf } from './search.ts';
import { assertDemoRpc, DEMO_MESSAGE, demoConfig, isDemoMode } from './demo.ts';
import { installDemoSandboxHooks, sandboxFileProblem } from './demoSandbox.ts';

Object.assign(handlers, extraHandlers);
// Keep direct RPC calls and HTTP dispatch on the same demo policy.
for (const [name, handler] of Object.entries(handlers)) {
  handlers[name] = (ctx, body) => {
    assertDemoRpc(name);
    return handler(ctx, body);
  };
}
installDemoSandboxHooks();
realtime.setRoleResolver((table, rec, userId) => recordRole(table, rec, userId));
realtime.setAccess({
  page: (pageId, userId) => blockRole(pageId, userId) !== 'none',
  space: (spaceId, userId) => isSpaceMember(getRecord<SpaceRecord>('space', spaceId), userId),
  view: (table, rec, userId) => (table === 'lit_user' ? new UserVisibility(userId).user(rec) : redactDatabaseRecord(table, rec, userId)),
});

const MAX_JSON_BYTES = 20 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const DEMO_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Behind a reverse proxy (NC_TRUST_PROXY=1) the client address / scheme come from X-Forwarded-* headers. */
const TRUST_PROXY = process.env.NC_TRUST_PROXY === '1';
const EXTRA_ORIGINS = new Set((process.env.NC_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean));

export function clientIp(c: Context): string {
  if (TRUST_PROXY) {
    const fwd = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (fwd) return fwd;
  }
  try {
    return getConnInfo(c).remote.address ?? '';
  } catch {
    return '';
  }
}

function isHttps(c: Context): boolean {
  if (TRUST_PROXY && c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() === 'https') return true;
  return new URL(c.req.url).protocol === 'https:';
}

/** Origin header of a browser request matches the host it was sent to (or an explicitly allowed origin). */
export function originAllowed(origin: string | undefined, host: string | undefined, forwardedHost?: string): boolean {
  if (!origin) return true; // non-browser clients; browsers always send Origin on cross-origin and POST requests
  if (EXTRA_ORIGINS.has(origin)) return true;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (!!host && (o.host === host || (!!forwardedHost && o.host === forwardedHost))) return true;
  // development: the Vite dev server (any loopback port) proxies /api with Host rewritten to the API's own
  // loopback address, so a loopback Origin talking to a loopback Host is the same app. Production stays strict.
  return DEV_LOOPBACK && !!host && LOOPBACK.test(o.host) && LOOPBACK.test(host);
}
const DEV_LOOPBACK = process.env.NODE_ENV !== 'production';
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export const app = new Hono();

// ---------------------------------------------------------------- security headers + CSRF
app.use('*', async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS') {
    // state-changing requests must come from this app: Fetch Metadata first, Origin as fallback for older browsers
    const site = c.req.header('sec-fetch-site');
    const fwdHost = TRUST_PROXY ? c.req.header('x-forwarded-host') : undefined;
    if ((site && site !== 'same-origin' && site !== 'none') || !originAllowed(c.req.header('origin'), c.req.header('host'), fwdHost)) {
      return c.json({ errorId: newId(), name: 'PermissionError', message: 'Cross-site request blocked' }, 403);
    }
  }
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  // embedded published pages (/public/…?embed=1, "Embed this page") opt out of the frame lock via their CSP
  if (!c.res.headers.has('X-Frame-Options') && !/frame-ancestors \*/.test(c.res.headers.get('Content-Security-Policy') ?? '')) c.header('X-Frame-Options', 'SAMEORIGIN');
});

const tooLarge = (c: Context) => c.json({ errorId: newId(), name: 'ValidationError', message: 'Request is too large' }, 413);

// ---------------------------------------------------------------- JSON API
app.post('/api/rpc/:name', bodyLimit({ maxSize: MAX_JSON_BYTES, onError: tooLarge }), async (c) => {
  const name = c.req.param('name');
  const handler = Object.hasOwn(handlers, name) ? handlers[name] : undefined;
  if (!handler) return c.json({ errorId: newId(), name: 'NotFound', message: 'Unknown endpoint' }, 404);
  // JSON only: a cross-site <form> or no-cors fetch can't send application/json (CSRF), see also the Origin check above
  if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) {
    return c.json({ errorId: newId(), name: 'ValidationError', message: 'Expected application/json' }, 415);
  }
  const token = parseCookies(c.req.header('cookie')).lit_session;
  const userId = userForToken(token);
  const cookies: string[] = [];
  let body: any = {};
  try {
    const text = await c.req.text();
    body = text ? JSON.parse(text) : {};
  } catch {
    return c.json({ name: 'ValidationError', message: 'Invalid JSON' }, 400);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) body = {};
  try {
    const result = await handler({
      userId, token, clientId: c.req.header('x-lit-client-id')?.slice(0, 100) ?? undefined, ip: clientIp(c), secure: isHttps(c),
      setCookie: (s) => cookies.push(s), cookie: c.req.header('cookie'), userAgent: c.req.header('user-agent')?.slice(0, 300),
      origin: c.req.header('origin')?.slice(0, 300) ?? undefined,
    }, body);
    for (const ck of cookies) c.header('Set-Cookie', ck, { append: true });
    return c.json(result ?? {});
  } catch (e: any) {
    const st = typeof e?.status === 'number' && e.status >= 400 && e.status < 600 ? e.status : 500;
    const status = e instanceof ApiError ? e.status : st;
    if (status >= 500) console.error(`[api] ${name} failed`, e);
    // denied writes are worth seeing in the server log (no request data beyond the reason)
    else if (status === 403 || (status === 400 && name === 'applyChanges')) console.warn(`[authz] ${name} ${status} user=${userId ?? '-'}: ${String(e?.message ?? '').slice(0, 300)}`);
    const kind = status === 401 ? 'UnauthorizedError' : status === 403 ? 'PermissionError' : status === 429 ? 'RateLimitedError' : status >= 500 ? 'InternalError' : 'ValidationError';
    // internal errors are logged, not echoed (no SQL / stack details to clients)
    // public demo: the signed-out answer tells the login page about "Try the demo"
    const demo = status === 401 && isDemoMode() ? { demoMode: demoConfig() } : {};
    return c.json({ errorId: newId(), name: kind, message: status >= 500 ? 'Something went wrong while processing that request.' : (e?.message ?? 'Error'), ...demo }, status as any);
  }
});

// AI streaming (SSE): POST /api/ai/stream
registerAiRoutes(app);
// dev mail outbox viewer: GET /api/dev/mail (404 in production)
registerMailRoutes(app);
// public REST API for connections and personal access tokens: /v1/* (publicApi/routes.ts)
registerPublicApi(app);

// ---------------------------------------------------------------- uploads: raw body; filename/type in query
app.post('/api/upload', bodyLimit({ maxSize: isDemoMode() ? DEMO_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES, onError: (c) => c.json({ message: isDemoMode() ? `${DEMO_MESSAGE} Files are limited to 5 MB in the public demo.` : 'File too large (50MB max)' }, 413) }), async (c) => {
  const userId = userForToken(parseCookies(c.req.header('cookie')).lit_session);
  if (!userId) return c.json({ message: 'Unauthorized' }, 401);
  const maxUpload = isDemoMode() ? DEMO_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
  if (Number(c.req.header('content-length') ?? 0) > maxUpload) return c.json({ message: isDemoMode() ? `${DEMO_MESSAGE} Files are limited to 5 MB in the public demo.` : 'File too large (50MB max)' }, 413);
  if (!hit(`upload:user:${userId}`, 300, 10 * 60_000)) return c.json({ message: 'Too many uploads. Try again later.' }, 429);
  const name = cleanFileName(c.req.query('name') ?? 'file');
  const mime = cleanMime(c.req.query('type') ?? c.req.header('content-type'));
  // files are attributed to a workspace only when the uploader belongs to it
  const sid = c.req.query('spaceId');
  const spaceId = sid && isSpaceMember(getRecord<SpaceRecord>('space', sid), userId) ? sid : null;
  const buf = Buffer.from(await c.req.arrayBuffer());
  if (buf.length > maxUpload) return c.json({ message: isDemoMode() ? `${DEMO_MESSAGE} Files are limited to 5 MB in the public demo.` : 'File too large (50MB max)' }, 413);
  const quota = isDemoMode() ? sandboxFileProblem(userId, buf.length) : null;
  if (quota) return c.json({ message: quota }, 413);
  const f = storeFile(name, buf, userId, spaceId, mime);
  // Settings › Audit log › File uploaded: "Uploaded {fileName} to {pageName}" when the upload names a block the
  // uploader can edit, else "Uploaded a file" in the workspace it is attributed to
  const target = c.req.query('blockId') ? getRecord<BlockRecord>('block', String(c.req.query('blockId'))) : undefined;
  const page = target && roleAtLeast(blockRole(target.id, userId), 'read_and_write') ? getRecord<BlockRecord>('block', pageIdOf(target)) : undefined;
  const auditSpace = page?.space_id ?? spaceId;
  if (auditSpace) audit('file_uploaded', { spaceId: auditSpace, actorId: userId, targetId: page?.id ?? null, ip: clientIp(c), data: { fileName: f.name, ...(page ? { pageName: toPlainText(page.properties?.title) } : {}) } });
  return c.json({ url: f.url, id: f.id, name: f.name, size: f.size, mime: f.mime });
});

// ---------------------------------------------------------------- downloads
app.get('/files/:id/:name', (c) => {
  // Uploaded files remain usable to signed-in demo visitors, but capability URLs must not expose them anonymously.
  if (isDemoMode() && !userForToken(parseCookies(c.req.header('cookie')).lit_session)) return c.text(DEMO_MESSAGE, 403);
  const row = fileRow(c.req.param('id'));
  if (!row || !existsSync(row.path)) return c.text('Not found', 404);
  if (isDemoMode()) {
    // demo visitors only reach files of their own workspace (or their own uploads)
    const viewer = userForToken(parseCookies(c.req.header('cookie')).lit_session);
    if (row.user_id !== viewer && !(row.space_id && viewer && isSpaceMember(getRecord<SpaceRecord>('space', row.space_id), viewer))) return c.text('Not found', 404);
  }
  if (row.private) {
    // exports: only the person who exported
    const userId = userForToken(parseCookies(c.req.header('cookie')).lit_session);
    if (!userId || userId !== row.user_id) return c.text('Not found', 404);
  }
  const stream = Readable.toWeb(createReadStream(row.path)) as ReadableStream;
  return new Response(stream, {
    headers: { ...fileHeaders(row, c.req.query('download') === '1'), 'Content-Length': String(statSync(row.path).size) },
  });
});

// ---------------------------------------------------------------- production: the built SPA
const WEB_DIST = resolve(import.meta.dirname, '../../web/dist');
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.webp': 'image/webp',
};

let spaCsp: string | null = null;
/**
 * CSP for the application shell: no plugins and no framing by other sites. script-src is deliberately not restricted:
 * srcdoc iframes (HTML block, embeds) inherit the page policy and must keep running their own inline scripts inside
 * their sandbox; script-capable URLs are filtered where they are rendered (packages/shared/src/url.ts).
 */
function appCsp(): string {
  spaCsp ??= ["object-src 'none'", "frame-ancestors 'self'"].join('; ');
  return spaCsp;
}

app.get('*', (c) => {
  if (!existsSync(WEB_DIST)) return c.text('Web app not built. Run `pnpm build` or use `pnpm dev`.', 404);
  const url = new URL(c.req.url);
  let pathname = '/';
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    /* malformed escape: serve the application shell */
  }
  let file = resolve(WEB_DIST, `.${pathname}`);
  if (!(file + sep).startsWith(WEB_DIST + sep) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIST, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
  const body = readFileSync(file);
  const headers: Record<string, string> = { 'Content-Type': type, 'Cache-Control': cache };
  if (type.startsWith('text/html')) {
    // "Embed this page" : only the read-only public page in embed mode may be framed by other sites
    const embed = pathname.startsWith('/public/') && url.searchParams.get('embed') === '1';
    headers['Content-Security-Policy'] = embed ? "object-src 'none'; frame-ancestors *" : appCsp();
  }
  return new Response(body, { headers });
});

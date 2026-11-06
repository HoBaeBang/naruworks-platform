// Server entry. Reset demo data before importing app.ts or db.ts because those modules open SQLite at import time.
import { demoResetHours, isDemoMode, scheduleDemoExit, wipeDemoDataDir } from './demo.ts';

if (isDemoMode() && demoResetHours()) wipeDemoDataDir();

const { serve } = await import('@hono/node-server');
const { userFromRequest } = await import('./auth.ts');
const { app, originAllowed } = await import('./app.ts');
const { realtime } = await import('./realtime.ts');
const { startScheduler } = await import('./scheduler.ts');
const { bootstrapOwner } = await import('./bootstrap.ts');
const { startDemoSandboxCleanup } = await import('./demoSandbox.ts');

bootstrapOwner();
scheduleDemoExit();
// demo sandboxes past their lifetime: once now, then every few minutes
startDemoSandboxCleanup();
const port = Number(process.env.PORT ?? 3001);
const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) => {
  console.log(`[server] listening on http://${info.address}:${info.port}`);
});
realtime.attach(server as any, (req) => {
  // cross-site WebSocket hijacking: the browser sends the session cookie with same-site pages on other ports too
  const fwdHost = process.env.NC_TRUST_PROXY === '1' ? (req.headers['x-forwarded-host'] as string | undefined) : undefined;
  if (!originAllowed(req.headers.origin, req.headers.host, fwdHost)) return null;
  return userFromRequest(req);
});
// reminders, notification emails, digests (scheduler.ts; jobs persist in SQLite)
startScheduler();

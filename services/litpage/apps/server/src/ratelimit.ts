// In-memory sliding-window rate limits (single server process). Keys are namespaced strings such as
// "login-code:email:<addr>" or "ai:user:<id>". Limits reset when the process restarts — good enough to stop
// brute force (login codes, passwords) and runaway clients (AI, public form submissions) on one node.

const buckets = new Map<string, number[]>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, hits] of buckets) {
    // windows are at most a day long
    while (hits.length && hits[0] <= now - 86_400_000) hits.shift();
    if (!hits.length) buckets.delete(k);
  }
}

/** Record a hit for `key`; false (and nothing recorded) when `max` hits already happened within `windowMs`. */
export function hit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  sweep(now);
  const hits = buckets.get(key) ?? [];
  while (hits.length && hits[0] <= now - windowMs) hits.shift();
  if (hits.length >= max) {
    buckets.set(key, hits);
    return false;
  }
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

/** Hits for `key` within the window (without recording one). */
export function count(key: string, windowMs: number, now = Date.now()): number {
  const hits = buckets.get(key);
  if (!hits) return 0;
  return hits.filter((t) => t > now - windowMs).length;
}

/** Forget a key (e.g. failed-login counter after a successful login). */
export function reset(key: string) {
  buckets.delete(key);
}

/** Loopback clients (local development, e2e runs) are exempt from per-IP limits outside production. */
export function exemptIp(ip: string | undefined): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return !ip || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

export class RateLimitError extends Error {
  status = 429;
  constructor(message = 'Too many requests. Try again later.') {
    super(message);
  }
}

/** AI service requests that call the model: NC_AI_RATE_PER_MIN (default 30) and NC_AI_RATE_PER_DAY (default 1000) per user. */
export function aiAllowed(userId: string): boolean {
  const perMin = Number(process.env.NC_AI_RATE_PER_MIN) || 30;
  const perDay = Number(process.env.NC_AI_RATE_PER_DAY) || 1000;
  if (count(`ai:user-day:${userId}`, 86_400_000) >= perDay) return false;
  if (!hit(`ai:user:${userId}`, perMin, 60_000)) return false;
  return hit(`ai:user-day:${userId}`, perDay, 86_400_000);
}

export const AI_RATE_MESSAGE = 'You’ve reached the Litpage AI request limit. Try again in a moment.';

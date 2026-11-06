// Persistent job scheduler: timed work that must survive restarts — reminders (@remind / database date
// reminders), delayed notification emails, page-update email digests, the weekly workspace digest — and anything
// other modules want to run later (automations, agents).
//
// API:
// registerJobHandler(kind, fn) — fn(payload, job) runs when a job of `kind` is due (sync or async)
// scheduleJob(kind, key, runAt, payload) — upsert by unique `key` (re-scheduling replaces time and payload)
// cancelJob(key) / cancelJobs(prefix) — remove pending jobs
// getJob(key) / listJobs(prefix) — inspect pending jobs
// runDueJobs(now?) — run everything due at `now` (the timer calls it; tests/dev call it directly)
// startScheduler / stopScheduler — main.ts starts the timer; tests never do (no timers, no side effects)
// Jobs live in SQLite (`scheduled_jobs`), so a restart picks up overdue jobs on the first tick. A failing handler is
// retried with backoff (max 5 attempts); unknown kinds are kept until a handler is registered.
import { db } from './db.ts';

export interface Job {
  key: string;
  kind: string;
  runAt: number;
  payload: any;
  attempts: number;
  createdTime: number;
}

type JobHandler = (payload: any, job: Job) => void | Promise<void>;

db.exec(`
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  run_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_run_at ON scheduled_jobs(run_at);
`);

const handlers = new Map<string, JobHandler>();
const MAX_ATTEMPTS = 5;
const MAX_KEY = 300;

const q = {
  upsert: db.prepare(`INSERT INTO scheduled_jobs (key, kind, run_at, payload, attempts, created_time) VALUES (?, ?, ?, ?, 0, ?)
                      ON CONFLICT(key) DO UPDATE SET kind = excluded.kind, run_at = excluded.run_at, payload = excluded.payload, attempts = 0`),
  get: db.prepare('SELECT * FROM scheduled_jobs WHERE key = ?'),
  del: db.prepare('DELETE FROM scheduled_jobs WHERE key = ?'),
  delPrefix: db.prepare('DELETE FROM scheduled_jobs WHERE substr(key, 1, ?) = ?'),
  listPrefix: db.prepare('SELECT * FROM scheduled_jobs WHERE substr(key, 1, ?) = ? ORDER BY run_at LIMIT ?'),
  due: db.prepare('SELECT * FROM scheduled_jobs WHERE run_at <= ? ORDER BY run_at LIMIT ?'),
  next: db.prepare('SELECT MIN(run_at) AS t FROM scheduled_jobs'),
  retry: db.prepare('UPDATE scheduled_jobs SET run_at = ?, attempts = ? WHERE key = ? AND run_at = ?'),
  claim: db.prepare('DELETE FROM scheduled_jobs WHERE key = ? AND run_at = ?'),
};

function rowToJob(r: any): Job {
  let payload: any = null;
  try {
    payload = JSON.parse(r.payload);
  } catch {
    /* corrupt payload: handler gets null */
  }
  return { key: r.key, kind: r.kind, runAt: r.run_at, payload, attempts: r.attempts, createdTime: r.created_time };
}

export function registerJobHandler(kind: string, fn: JobHandler) {
  handlers.set(kind, fn);
}

/** Create or replace the job with this key. */
export function scheduleJob(kind: string, key: string, runAt: number, payload: unknown = null) {
  if (!key || key.length > MAX_KEY) throw new Error('Invalid job key');
  q.upsert.run(key, kind, Math.round(runAt), JSON.stringify(payload ?? null), Date.now());
  kick(runAt);
}

export function cancelJob(key: string) {
  q.del.run(key);
}

/** Cancel every job whose key starts with `prefix`. */
export function cancelJobs(prefix: string) {
  if (!prefix) return;
  q.delPrefix.run(prefix.length, prefix);
}

export function getJob(key: string): Job | null {
  const r = q.get.get(key);
  return r ? rowToJob(r) : null;
}

export function listJobs(prefix: string, limit = 500): Job[] {
  return (q.listPrefix.all(prefix.length, prefix, limit) as any[]).map(rowToJob);
}

let running: Promise<number> | null = null;

/** Run the jobs due at `now` (each job runs once: it is removed before its handler runs). Returns how many ran. */
export function runDueJobs(now = Date.now(), limit = 200): Promise<number> {
  // one batch at a time: a tick that overlaps a slow batch waits for it
  const go = async (): Promise<number> => {
    let ran = 0;
    for (const r of q.due.all(now, limit) as any[]) {
      const job = rowToJob(r);
      const fn = handlers.get(job.kind);
      if (!fn) continue; // keep until a handler exists (module not loaded yet)
      // claim: only the row we read (a re-schedule in between keeps the newer job)
      if (Number(q.claim.run(job.key, job.runAt).changes ?? 0) === 0) continue;
      try {
        await fn(job.payload, job);
        ran++;
      } catch (e) {
        const attempts = job.attempts + 1;
        console.error(`[scheduler] ${job.kind} ${job.key} failed (attempt ${attempts})`, e);
        if (attempts < MAX_ATTEMPTS && !getJob(job.key)) {
          // back off 1, 4, 9, 16 minutes
          const at = Date.now() + attempts * attempts * 60_000;
          q.upsert.run(job.key, job.kind, at, JSON.stringify(job.payload ?? null), job.createdTime);
          q.retry.run(at, attempts, job.key, at);
        }
      }
    }
    return ran;
  };
  const p = (running ?? Promise.resolve(0)).then(go, go);
  running = p.finally(() => {
    if (running === p) running = null;
  }) as Promise<number>;
  return p;
}

// ---------------------------------------------------------------- timer
let timer: ReturnType<typeof setTimeout> | null = null;
let nextAt = Infinity;
let started = false;
const MIN_DELAY = 250;
const MAX_DELAY = 30_000;

function arm(at: number) {
  if (!started) return;
  if (timer && at >= nextAt) return;
  if (timer) clearTimeout(timer);
  nextAt = at;
  const delay = Math.max(MIN_DELAY, Math.min(MAX_DELAY, at - Date.now()));
  timer = setTimeout(() => {
    timer = null;
    nextAt = Infinity;
    void runDueJobs()
      .catch((e) => console.error('[scheduler] tick failed', e))
      .finally(() => {
        const row = q.next.get() as { t: number | null } | undefined;
        arm(row?.t ?? Date.now() + MAX_DELAY);
      });
  }, delay);
  timer.unref?.();
}

/** A job was scheduled: wake up earlier if it is due before the current timer. */
function kick(runAt: number) {
  if (started && runAt < nextAt) arm(runAt);
}

export function startScheduler() {
  if (started || process.env.NC_SCHEDULER === '0') return;
  started = true;
  const row = q.next.get() as { t: number | null } | undefined;
  arm(row?.t ?? Date.now() + MAX_DELAY);
}

export function stopScheduler() {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
  nextAt = Infinity;
}

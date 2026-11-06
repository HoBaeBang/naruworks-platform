// Reminder + scheduler endpoints . Loading this module registers the reminder sync (apps/server/src/reminders.ts)
// and the notification-email / digest job handlers, so they also run in tests that import the service.
import '../../reminders.ts';
import '../../digests.ts';
import '../../activityNotify.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { listJobs, runDueJobs } from '../../scheduler.ts';
import { blockRole } from '../../records.ts';

type Handler = (ctx: Ctx, body: any) => any;

function devOnly() {
  if (process.env.NODE_ENV === 'production') throw new ApiError('Not available', 404);
}

export const handlers: Record<string, Handler> = {
  /** Reminders scheduled on a page's blocks (the date picker shows "Reminder set"; e2e checks scheduling). */
  getPageReminders(ctx, { blockIds }) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const out: { blockId: string; key: string; runAt: number }[] = [];
    for (const id of (Array.isArray(blockIds) ? blockIds : []).slice(0, 200).map(String)) {
      if (!/^[\w-]{1,64}$/.test(id) || blockRole(id, ctx.userId) === 'none') continue;
      for (const j of listJobs(`reminder:${id}:`)) out.push({ blockId: id, key: j.key, runAt: j.runAt });
    }
    return { reminders: out };
  },

  /** Dev/e2e: run the scheduler as if `advanceMs` had passed (reminders, notification emails, digests). */
  async devRunScheduler(ctx, { advanceMs }) {
    devOnly();
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const ms = Math.max(0, Math.min(Number(advanceMs) || 0, 400 * 86_400_000));
    const ran = await runDueJobs(Date.now() + ms);
    return { ran };
  },
};

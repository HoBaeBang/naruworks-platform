// Public demo (NC_DEMO_MODE=1, demo.ts / demoSandbox.ts): "Try the demo" on the login page (which learns about the demo
// from the 401 answer, app.ts) and "Start over" in the notice bar.
//   startDemoSandbox {} → { userId, spaceId, pageId, path, expires }   (no session needed; signs the browser in to a new
//     sandbox, a sandbox calling it is replaced; unknown endpoint on normal servers)
import { destroySession, sessionCookie } from '../../auth.ts';
import { isDemoMode } from '../../demo.ts';
import { createSandbox, DemoSandboxError, sandboxOfUser } from '../../demoSandbox.ts';
import { ApiError, type Ctx } from '../handlers.ts';

type Handler = (ctx: Ctx, body: any) => any;

export const handlers: Record<string, Handler> = {
  startDemoSandbox(ctx) {
    if (!isDemoMode()) throw new ApiError('Unknown endpoint', 404);
    const current = ctx.userId;
    const replacing = !!sandboxOfUser(current);
    let created;
    try {
      created = createSandbox(ctx.ip, replacing ? current : null);
    } catch (e) {
      if (e instanceof DemoSandboxError) throw new ApiError(e.message, e.status);
      throw e;
    }
    // a shared-account session in this browser ends here (a replaced sandbox lost every session with it)
    if (current && !replacing) destroySession(ctx.token);
    const maxAge = Math.max(1, Math.floor((created.expires - Date.now()) / 1000));
    ctx.setCookie(sessionCookie(created.token, !!ctx.secure, maxAge));
    return { userId: created.userId, spaceId: created.spaceId, pageId: created.pageId, path: created.path, expires: created.expires };
  },
};

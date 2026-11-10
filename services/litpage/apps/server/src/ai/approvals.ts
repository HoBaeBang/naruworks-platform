// Pending agent approvals ("Do you want to continue?" → Continue / Reject). A write tool that needs the user's
// approval (approval mode "Always ask", or a potentially unsafe action under "Review for me") streams an
// `approval` event and waits here until the user answers through POST /api/rpc/aiApprove, the turn is stopped
// (client disconnect → declined) or the request times out. In-memory: an approval only lives as long as its stream.
import { newId } from '@nc/shared/ids.ts';

export type Decision = 'accept' | 'decline';

interface Pending {
  id: string;
  userId: string;
  threadId: string | null;
  created: number;
  resolve: (d: Decision) => void;
}

const pending = new Map<string, Pending>();
const TIMEOUT_MS = 15 * 60_000;

export interface ApprovalWait {
  id: string;
  decision: Promise<Decision>;
}

/** Register a pending approval; the promise resolves with the user's decision ('decline' on abort / timeout). */
export function waitForApproval(userId: string, threadId: string | null, signal?: AbortSignal): ApprovalWait {
  const id = newId();
  const decision = new Promise<Decision>((resolve) => {
    let done = false;
    const finish = (d: Decision) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      pending.delete(id);
      resolve(d);
    };
    const onAbort = () => finish('decline');
    const timer = setTimeout(() => finish('decline'), TIMEOUT_MS);
    if (signal?.aborted) {
      finish('decline');
      return;
    }
    signal?.addEventListener('abort', onAbort);
    pending.set(id, { id, userId, threadId, created: Date.now(), resolve: finish });
  });
  return { id, decision };
}

/** Answer a pending approval. Only the user it was asked of can answer; false when unknown or already answered. */
export function decideApproval(userId: string, id: string, decision: Decision): boolean {
  const p = pending.get(id);
  if (!p || p.userId !== userId) return false;
  p.resolve(decision);
  return true;
}

export function pendingCount(): number {
  return pending.size;
}

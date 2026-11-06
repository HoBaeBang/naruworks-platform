
// Pending requests the current user sent are cached per workspace so buttons can show "Requested" right away.
import { create } from 'zustand';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';

export type PageAccessState =
  | { state: 'missing' }
  | { state: 'ok'; role: string; inTrash?: boolean; canRequestEdit: boolean; editRequested: boolean }
  | {
    state: 'no_access'; inTrash: boolean; loggedIn: boolean; isMember: boolean; workspaceName: string | null; canRequest: boolean;
    requestsDisabled: boolean; requested: boolean;
  };

export function getPageAccessState(pageId: string): Promise<PageAccessState> {
  return api<PageAccessState>('getPageAccessState', { pageId });
}

export function requestPageAccess(pageId: string, opts: { message?: string; edit?: boolean } = {}): Promise<{ requested: boolean; requestId?: string; already?: boolean }> {
  return api('requestPageAccess', { pageId, message: opts.message ?? '', kind: opts.edit ? 'edit' : 'access' }).then((r) => {
    useMyRequests.getState().add(opts.edit ? 'edit' : 'page', pageId);
    return r;
  });
}

export async function decideAccessRequest(requestId: string, approve: boolean, role?: string): Promise<{ status: string; role?: string | null }> {
  const r = await api<{ status: string; role?: string | null; recordMap?: unknown }>('decideAccessRequest', { requestId, approve, role });
  return r;
}

export function requestJoinTeam(teamId: string, message = ''): Promise<{ requested: boolean; member?: boolean }> {
  return api<{ requested: boolean; member?: boolean }>('requestJoinTeam', { teamId, message }).then((r) => {
    if (r.requested) useMyRequests.getState().add('team', teamId);
    return r;
  });
}

interface MyRequests {
  spaceId: string | null;
  teams: Set<string>;
  pages: Set<string>;
  edits: Set<string>;
  load: (spaceId: string) => Promise<void>;
  add: (kind: 'team' | 'page' | 'edit', id: string) => void;
}

export const useMyRequests = create<MyRequests>((set, get) => ({
  spaceId: null,
  teams: new Set(),
  pages: new Set(),
  edits: new Set(),
  async load(spaceId) {
    try {
      const r = await api<{ teamIds: string[]; pageIds: string[] }>('getMyAccessRequests', { spaceId });
      set({ spaceId, teams: new Set(r.teamIds), pages: new Set(r.pageIds) });
    } catch {
      /* offline: keep what we know */
    }
  },
  add(kind, id) {
    const s = get();
    if (kind === 'team') set({ teams: new Set([...s.teams, id]) });
    else if (kind === 'page') set({ pages: new Set([...s.pages, id]) });
    else set({ edits: new Set([...s.edits, id]) });
  },
}));

// approvals arriving in realtime (my team request approved → team record / joined_teams change) refresh the cache
records.subscribeAll((keys) => {
  if (!keys.some((k) => k.startsWith('notification:'))) return;
  const { spaceId } = useSession.getState();
  if (spaceId && useMyRequests.getState().spaceId === spaceId) void useMyRequests.getState().load(spaceId);
});


import { create } from 'zustand';

export type InboxStatus = 'all' | 'unread' | 'archived' | 'workspace';
export type InboxType = 'access' | 'discussions' | 'mentions' | 'automations' | 'updates' | 'workspace';
export const ALL_TYPES: InboxType[] = ['access', 'discussions', 'mentions', 'automations', 'updates', 'workspace'];

interface InboxState {
  status: InboxStatus;
  types: InboxType[];
  pinned: boolean;
  
  width: number;
  set: (p: Partial<Pick<InboxState, 'status' | 'types' | 'pinned' | 'width'>>) => void;
}

export const INBOX_MIN_WIDTH = 320;
export const INBOX_MAX_WIDTH = 600;
export const INBOX_DEFAULT_WIDTH = 390;

const KEY = 'nc:inbox:filters';
function read(): Pick<InboxState, 'status' | 'types' | 'pinned' | 'width'> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') {
      const w = Number(v.width);
      return {
        status: v.status ?? 'all', types: Array.isArray(v.types) ? v.types : ALL_TYPES, pinned: !!v.pinned,
        width: Number.isFinite(w) && w > 0 ? Math.max(INBOX_MIN_WIDTH, Math.min(INBOX_MAX_WIDTH, w)) : INBOX_DEFAULT_WIDTH,
      };
    }
  } catch {
    /* ignore */
  }
  return { status: 'all', types: ALL_TYPES, pinned: false, width: INBOX_DEFAULT_WIDTH };
}

export const useInboxState = create<InboxState>((set, get) => ({
  ...read(),
  set: (p) => {
    set(p);
    const s = get();
    try {
      localStorage.setItem(KEY, JSON.stringify({ status: s.status, types: s.types, pinned: s.pinned, width: s.width }));
    } catch {
      /* ignore */
    }
  },
}));

// Global UI state (zustand): sidebar, theme, modals, peek, presence, toasts.
import { create } from 'zustand';

export type Theme = 'light' | 'dark' | 'system';
export type PeekMode = 'side_peek' | 'center_peek' | 'full_page';

export interface Viewer {
  userId: string;
  clientId: string;
  data?: any;
}

export interface Toast {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

interface UIState {
  sidebarOpen: boolean;
  sidebarWidth: number;
  sidebarPeek: boolean;
  theme: Theme;
  resolvedDark: boolean;
  searchOpen: boolean;
  searchMode: 'search' | 'ai';
  settingsOpen: boolean;
  settingsSection: string;
  trashOpen: boolean;
  inboxOpen: boolean;
  importOpen: boolean;
  templatesOpen: boolean;
  shortcutsOpen: boolean;
  rightPanel: null | 'comments' | 'updates' | 'history' | 'ai';
  peek: { pageId: string; mode: PeekMode } | null;
  presence: Record<string, Viewer[]>;
  connection: 'online' | 'offline';
  toasts: Toast[];
  typing: boolean;
  set: (patch: Partial<UIState>) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (w: number) => void;
  setTheme: (t: Theme) => void;
  openSettings: (section?: string) => void;
  setPresence: (pageId: string, viewers: Viewer[]) => void;
  setConnection: (c: 'online' | 'offline') => void;
  toast: (message: string, action?: Toast['action']) => void;
  dismissToast: (id: number) => void;
}

function readLS<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writeLS(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

const media = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme(t: Theme) {
  const dark = t === 'dark' || (t === 'system' && media.matches);
  const el = document.documentElement;
  el.classList.toggle('lit-dark-theme', dark);
  el.classList.toggle('lit-light-theme', !dark);
  document.body?.classList.toggle('dark', dark); 
  return dark;
}

const initialTheme = (() => {
  try {
    return (localStorage.getItem('nc:theme') as Theme) || 'system';
  } catch {
    return 'system' as Theme;
  }
})();

let toastSeq = 1;

export const useUI = create<UIState>((set, get) => ({
  sidebarOpen: readLS('nc:sidebarOpen', true),
  sidebarWidth: readLS('nc:sidebarWidth', 270),
  sidebarPeek: false,
  theme: initialTheme,
  resolvedDark: applyTheme(initialTheme),
  searchOpen: false,
  searchMode: 'search',
  settingsOpen: false,
  settingsSection: 'account',
  trashOpen: false,
  inboxOpen: false,
  importOpen: false,
  templatesOpen: false,
  shortcutsOpen: false,
  rightPanel: null,
  peek: null,
  presence: {},
  connection: 'online',
  toasts: [],
  typing: false,
  set: (patch) => set(patch),
  setSidebarOpen: (open) => {
    writeLS('nc:sidebarOpen', open);
    set({ sidebarOpen: open, sidebarPeek: false });
  },
  setSidebarWidth: (w) => {
    const width = Math.max(270, Math.min(600, Math.round(w))); 
    writeLS('nc:sidebarWidth', width);
    set({ sidebarWidth: width });
  },
  setTheme: (t) => {
    try {
      localStorage.setItem('nc:theme', t);
    } catch {
      /* ignore */
    }
    set({ theme: t, resolvedDark: applyTheme(t) });
  },
  openSettings: (section) => set({ settingsOpen: true, settingsSection: section ?? get().settingsSection }),
  setPresence: (pageId, viewers) => set({ presence: { ...get().presence, [pageId]: viewers } }),
  setConnection: (connection) => set({ connection }),
  toast: (message, action) => {
    const id = toastSeq++;
    set({ toasts: [...get().toasts, { id, message, action }] });
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

media.addEventListener('change', () => {
  const s = useUI.getState();
  if (s.theme === 'system') s.set({ resolvedDark: applyTheme('system') });
});

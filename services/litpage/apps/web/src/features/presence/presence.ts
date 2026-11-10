// Live presence: reports this tab's focused block + text selection through the realtime socket
// (server realtime.ts relays it to everyone viewing the same page) and exposes the viewers of a page.
import { useEditor } from '../editor/editorState.ts';
import { setPresenceData } from '../../lib/store/sync.ts';
import { clientId } from '../../lib/api.ts';
import { useUI, type Viewer } from '../../lib/store/ui.ts';
import { useSession } from '../../lib/store/session.ts';

let installed = false;
let lastKey = '';
let timer: ReturnType<typeof setTimeout> | null = null;

export interface PresenceData {
  blockId: string;
  property: string;
  start: number;
  end: number;
}

/** Start reporting caret/selection changes (idempotent; throttled to ~15/s). */
export function installPresenceReporter() {
  if (installed) return;
  installed = true;
  useEditor.subscribe((s) => {
    const f = s.focused;
    const c = s.caret;
    let data: PresenceData | null = f && c ? { blockId: f.blockId, property: f.property, start: c.start, end: c.end } : null;
    if (data && data.blockId.startsWith('nc-')) data = null; // comment composers etc. are not page blocks
    const key = JSON.stringify(data);
    if (key === lastKey) return;
    lastKey = key;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => setPresenceData(data as Record<string, unknown> | null), 66);
  });
  window.addEventListener('blur', () => {
    lastKey = 'blurred';
    setPresenceData(null);
  });
}

/** Viewers of a page from the realtime hub (one entry per connected tab). */
export function usePageViewers(pageId: string | null | undefined): Viewer[] {
  return useUI((s) => (pageId ? s.presence[pageId] : undefined)) ?? EMPTY;
}
const EMPTY: Viewer[] = [];

export function isMe(v: Viewer): boolean {
  return v.clientId === clientId;
}

export function myUserId(): string | null {
  return useSession.getState().userId;
}

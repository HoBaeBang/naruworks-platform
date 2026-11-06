// Realtime: websocket for pushed record changes + page presence; reconnects with backoff and
// re-syncs the records currently in view after reconnecting.
import { clientId, api } from '../api.ts';
import { records } from './records.ts';
import { useUI } from './ui.ts';

let ws: WebSocket | null = null;
let spaceIds: string[] = [];
let currentPage: string | null = null;
let currentPresenceData: Record<string, unknown> | null = null;
let retry = 0;
let resyncHandler: (() => void) | null = null;
let closedByUs = false;

export function onResync(fn: () => void) {
  resyncHandler = fn;
}

function send(msg: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

export function connectRealtime(spaces: string[]) {
  spaceIds = spaces;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    send({ type: 'subscribe', spaceIds });
    return;
  }
  closedByUs = false;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const sock = new WebSocket(`${proto}://${location.host}/ws?clientId=${clientId}`);
  ws = sock;
  sock.onopen = () => {
    const wasReconnect = retry > 0;
    retry = 0;
    send({ type: 'subscribe', spaceIds });
    if (currentPage) send({ type: 'presence', pageId: currentPage, data: currentPresenceData });
    useUI.getState().setConnection('online');
    if (wasReconnect) resyncHandler?.();
  };
  sock.onmessage = (ev) => {
    let msg: any;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (msg.type === 'records') {
      if (msg.origin && msg.origin === clientId) return; // our own echo is handled by the HTTP response
      records.batch(() => {
        for (const r of msg.records) records.mergeServer(r.table, r.id, r.value, r.role);
      });
    } else if (msg.type === 'presence') {
      useUI.getState().setPresence(msg.pageId, msg.viewers);
    } else if (msg.type === 'session_ended') {
      // the account is gone (a deleted demo sandbox): start over from the root (login page, or the browser's new sandbox)
      disconnectRealtime();
      location.assign('/');
    }
  };
  sock.onclose = () => {
    ws = null;
    if (closedByUs) return;
    useUI.getState().setConnection('offline');
    retry = Math.min(retry + 1, 6);
    setTimeout(() => connectRealtime(spaceIds), 500 * 2 ** retry);
  };
}

export function disconnectRealtime() {
  closedByUs = true;
  ws?.close();
  ws = null;
}

export function setPresencePage(pageId: string | null) {
  if (pageId !== currentPage) currentPresenceData = null;
  currentPage = pageId;
  send({ type: 'presence', pageId, data: currentPresenceData });
}

/** Presence payload for the current page (focused block + text selection), relayed to other viewers. */
export function setPresenceData(data: Record<string, unknown> | null) {
  currentPresenceData = data;
  if (currentPage) send({ type: 'presence', pageId: currentPage, data });
}

export function presencePageId(): string | null {
  return currentPage;
}

export async function syncRecords(pointers: { table: string; id: string }[]) {
  if (!pointers.length) return;
  const res = await api('fetchRecords', { requests: pointers.map((p) => ({ pointer: p, version: -1 })) });
  records.mergeRecordMap(res.recordMap);
}

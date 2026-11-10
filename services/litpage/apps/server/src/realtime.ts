// WebSocket hub: pushes record changes to clients of the same space and relays presence
// (who is viewing a page, cursor/selection hints).
import type { IncomingMessage } from 'node:http';
import type { Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { BaseRecord, Table } from '@nc/shared/records.ts';

interface Client {
  ws: WebSocket;
  userId: string;
  clientId: string;
  spaces: Set<string>;
  page: string | null;
  presence: Record<string, unknown> | null;
}

type ChangeLike = { table: Table; record: BaseRecord; spaceId: string | null };

interface Access {
  /** may `userId` see who is on page `pageId` (and be seen there)? */
  page(pageId: string, userId: string): boolean;
  /** is `userId` a member of workspace `spaceId`? */
  space(spaceId: string, userId: string): boolean;
  /** record value as `userId` may see it (e.g. other users' emails removed) */
  view(table: Table, rec: BaseRecord, userId: string): BaseRecord;
}

const MAX_PRESENCE_BYTES = 4096;

class Realtime {
  private clients = new Set<Client>();
  private roleFor: ((table: Table, rec: BaseRecord, userId: string) => string) | null = null;
  private access: Access | null = null;

  setRoleResolver(fn: (table: Table, rec: BaseRecord, userId: string) => string) {
    this.roleFor = fn;
  }

  setAccess(a: Access) {
    this.access = a;
  }

  attach(server: Server, authenticate: (req: IncomingMessage) => string | null) {
    const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
    server.on('upgrade', (req, socket, head) => {
      if (!req.url?.startsWith('/ws')) return;
      const userId = authenticate(req);
      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws, userId, req));
    });
  }

  private onConnection(ws: WebSocket, userId: string, req: IncomingMessage) {
    const url = new URL(req.url ?? '/ws', 'http://x');
    const client: Client = { ws, userId, clientId: (url.searchParams.get('clientId') ?? '').slice(0, 100), spaces: new Set(), page: null, presence: null };
    this.clients.add(client);
    ws.on('message', (raw) => {
      let msg: any;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.type === 'subscribe' && Array.isArray(msg.spaceIds)) {
        // only workspaces the user belongs to (record-level checks below still apply to every change)
        client.spaces = new Set(msg.spaceIds.slice(0, 100).filter((id: unknown) => typeof id === 'string' && (!this.access || this.access.space(id, userId))));
      } else if (msg.type === 'presence') {
        const prevPage = client.page;
        const pageId = typeof msg.pageId === 'string' ? msg.pageId : null;
        // presence is shared only on pages the user can open; payloads stay small
        client.page = pageId && (!this.access || this.access.page(pageId, userId)) ? pageId : null;
        const data = msg.data && typeof msg.data === 'object' && JSON.stringify(msg.data).length <= MAX_PRESENCE_BYTES ? msg.data : null;
        client.presence = client.page ? data : null;
        if (prevPage && prevPage !== client.page) this.sendPresence(prevPage);
        if (client.page) this.sendPresence(client.page);
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', t: typeof msg.t === 'number' ? msg.t : null }));
      }
    });
    ws.on('close', () => {
      this.clients.delete(client);
      if (client.page) this.sendPresence(client.page);
    });
    ws.send(JSON.stringify({ type: 'hello', userId }));
  }

  private sendPresence(pageId: string) {
    const viewers = [...this.clients].filter((c) => c.page === pageId);
    const payload = JSON.stringify({
      type: 'presence', pageId,
      viewers: viewers.map((c) => ({ userId: c.userId, clientId: c.clientId, data: c.presence })),
    });
    for (const c of viewers) if (c.ws.readyState === 1) c.ws.send(payload);
  }

  broadcastChanges(changes: ChangeLike[], originClientId?: string) {
    if (!changes.length) return;
    for (const c of this.clients) {
      if (c.ws.readyState !== 1) continue;
      const visible = [];
      for (const ch of changes) {
        if (ch.spaceId && !c.spaces.has(ch.spaceId) && ch.table !== 'lit_user') {
          // user-scoped records (space_view of this user, user_root, settings) are always delivered to their owner
          const owner = (ch.record as any).parent_id === c.userId || ch.record.id === c.userId || (ch.record as any).user_id === c.userId;
          // guests aren't subscribed to the host workspace: while they have a page open they still get
          // the changes they can read (the role check below filters the rest)
          if (!owner && !c.page) continue;
        }
        const role = this.roleFor ? this.roleFor(ch.table, ch.record, c.userId) : 'reader';
        if (role === 'none') continue;
        const value = this.access ? this.access.view(ch.table, ch.record, c.userId) : ch.record;
        visible.push({ table: ch.table, id: ch.record.id, version: ch.record.version, value, role });
      }
      if (visible.length) c.ws.send(JSON.stringify({ type: 'records', origin: originClientId ?? null, records: visible }));
    }
  }

  /** Whether the user has an open app connection right now (notification emails wait while they are active). */
  isConnected(userId: string): boolean {
    for (const c of this.clients) if (c.userId === userId && c.ws.readyState === 1) return true;
    return false;
  }

  /** The user's account is gone (a deleted demo sandbox): tell their open tabs and close the connections. */
  endUserSessions(userId: string) {
    for (const c of this.clients) {
      if (c.userId !== userId) continue;
      if (c.ws.readyState === 1) c.ws.send(JSON.stringify({ type: 'session_ended' }));
      c.ws.close();
    }
  }

  notifyUser(userId: string, payload: unknown) {
    const s = JSON.stringify(payload);
    for (const c of this.clients) if (c.userId === userId && c.ws.readyState === 1) c.ws.send(s);
  }
}

export const realtime = new Realtime();

// Developer platform client: connections of the current workspace, their pages, and webhooks.
// Server: apps/server/src/api/modules/developer.ts (+ publicApi/*).
import { create } from 'zustand';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { navigate, spaceDomain } from '../../lib/router.ts';

export type UserInfo = 'none' | 'no_email' | 'with_email';

export interface Capabilities {
  read_content: boolean;
  update_content: boolean;
  insert_content: boolean;
  read_comments: boolean;
  insert_comments: boolean;
  user_info: UserInfo;
}

export interface Connection {
  id: string;
  name: string;
  icon: string | null;
  botId: string;
  ownerId: string;
  ownerName: string;
  capabilities: Capabilities;
  tokenPrefix: string;
  tokenRefreshedTime: number;
  installTokenPrefix: string | null;
  installTokenTime: number | null;
  createdTime: number;
  lastUsedTime: number | null;
  pageCount: number;
  canManage: boolean;
  spaceId: string;
}

export interface Webhook {
  id: string;
  integrationId: string;
  url: string;
  eventTypes: string[];
  apiVersion: string;
  status: 'pending_verification' | 'active' | 'paused' | 'paused_errors';
  createdTime: number;
  verifiedTime: number | null;
  successes: number;
  failures: number;
  lastFailureTime: number | null;
  lastFailureStatus: number | null;
}

export interface ConnectionDetailData {
  connection: Connection;
  pages: { blockId: string; title: string; type: string; canOpen: boolean; alive: boolean }[];
  stats: { ok: number; clientErrors: number; rateLimited: number } | null;
  webhooks: Webhook[];
  webhooksEnabled: boolean;
  events: string[];
  dataSourceEvents: string[];
}

interface Store {
  spaceId: string | null;
  connections: Connection[];
  canCreate: boolean;
  createProblem: string | null;
  admin: boolean;
  webhooksEnabled: boolean;
  loaded: boolean;
  load(force?: boolean): Promise<void>;
}

export const useConnections = create<Store>((set, get) => ({
  spaceId: null, connections: [], canCreate: false, createProblem: null, admin: false, webhooksEnabled: false, loaded: false,
  async load(force) {
    const spaceId = useSession.getState().spaceId;
    if (!spaceId) return;
    if (!force && get().loaded && get().spaceId === spaceId) return;
    try {
      const r = await api<{ connections: Connection[]; canCreate: boolean; createProblem: string | null; admin: boolean; webhooksEnabled: boolean; recordMap: any }>('devListConnections', { spaceId });
      records.mergeRecordMap(r.recordMap);
      set({ spaceId, connections: r.connections, canCreate: r.canCreate, createProblem: r.createProblem, admin: r.admin, webhooksEnabled: r.webhooksEnabled, loaded: true });
    } catch {
      set({ spaceId, connections: [], loaded: true });
    }
  },
}));

export async function createConnection(name: string, capabilities?: Partial<Capabilities>): Promise<{ connection: Connection; token: string }> {
  const spaceId = useSession.getState().spaceId;
  const r = await api<{ connection: Connection; token: string; recordMap: any }>('devCreateConnection', { spaceId, name, capabilities });
  records.mergeRecordMap(r.recordMap);
  await useConnections.getState().load(true);
  return r;
}

export function developersUrl(tab?: string, id?: string): string {
  const domain = spaceDomain(useSession.getState().spaceId);
  return `/${domain}/developers${tab ? `/${tab}` : ''}${id ? `/${id}` : ''}`;
}

export function openDevelopers(tab?: string, id?: string) {
  navigate(developersUrl(tab, id));
}

/** "Read, update, insert content, read profile details" (developerPortal.connections.summary*). */
export function capabilitySummary(c: Capabilities): string {
  const verbs: string[] = [];
  if (c.read_content) verbs.push('read');
  if (c.update_content) verbs.push('update');
  if (c.insert_content) verbs.push('insert');
  const parts: string[] = [];
  if (verbs.length) parts.push(`${verbs.join(', ')} content`);
  const cv: string[] = [];
  if (c.read_comments) cv.push('read');
  if (c.insert_comments) cv.push('insert');
  if (cv.length) parts.push(`${cv.join(', ')} comments`);
  if (c.user_info !== 'none') parts.push('read profile details');
  if (!parts.length) return 'No capabilities';
  const s = parts.join(', ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const EVENT_LABELS: Record<string, string> = {
  'page.created': 'Page created', 'page.content_updated': 'Page content changed', 'page.properties_updated': 'Page fields changed',
  'page.moved': 'Page moved', 'page.deleted': 'Page deleted', 'page.undeleted': 'Page undeleted', 'page.locked': 'Page locked', 'page.unlocked': 'Page unlocked',
  'database.created': 'Database created', 'database.content_updated': 'Database content changed', 'database.schema_updated': 'Database structure changed',
  'database.moved': 'Database moved', 'database.deleted': 'Database deleted', 'database.undeleted': 'Database undeleted',
  'data_source.created': 'Data source added', 'data_source.content_updated': 'Data source content changed', 'data_source.schema_updated': 'Data source structure changed',
  'data_source.moved': 'Data source relocated', 'data_source.deleted': 'Data source removed', 'data_source.undeleted': 'Data source restored',
  'comment.created': 'Comment created', 'comment.updated': 'Comment updated', 'comment.deleted': 'Comment deleted',
};

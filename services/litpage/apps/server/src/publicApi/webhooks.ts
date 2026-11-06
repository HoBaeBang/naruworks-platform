// Connection webhooks: a connection subscribes a URL to events on the pages, databases and comments shared with
// it. Off unless the server runs with NC_CONNECTION_WEBHOOKS=1 (like automation webhook actions, nothing is sent to the
// outside by default). Every request goes through safefetch.ts (SSRF guards; loopback only in development).
// - Create a subscription → the server sends { verification_token } to the URL → the owner pastes the token into
// "Verify subscription" → active. "Resend token" sends it again.
// - Events: page.created / content_updated / properties_updated / moved / deleted / undeleted / locked / unlocked,
// database.* and data_source.*
// created / content_updated / schema_updated / moved / deleted / undeleted, comment.created / updated / deleted.
// Only entities the connection can reach are sent; changes made by the connection itself are not echoed back;
// consecutive events for one entity are aggregated over NC_WEBHOOK_AGGREGATE_MS (default 1s).
// - Each delivery is signed: X-Signature: sha256=<HMAC-SHA256(body, verification_token)>. Failures are retried
// (3 attempts); 20 consecutive failures pause the subscription ("paused due to high error rate").
import { createHmac, randomBytes } from 'node:crypto';
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CommentRecord, DiscussionRecord, SpaceRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../db.ts';
import { onCommit, type CommitInfo } from '../records.ts';
import { safeFetch, assertFetchableUrl } from '../safefetch.ts';
import { pageIdOf } from '../search.ts';
import { connectionRole } from './access.ts';
import { canManage, getIntegration, IntegrationError, isIntegrationBot, integrationsInSpace, type Integration } from './store.ts';
import { API_VERSION } from './principal.ts';
import { isDemoMode } from '../demo.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS api_webhooks (
  id TEXT PRIMARY KEY,
  integration_id TEXT NOT NULL,
  url TEXT NOT NULL,
  event_types TEXT NOT NULL,
  api_version TEXT NOT NULL,
  verification_token TEXT NOT NULL,
  status TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  updated_time INTEGER NOT NULL,
  verified_time INTEGER,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_failure_time INTEGER,
  last_failure_status INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_webhooks_integration ON api_webhooks(integration_id);
CREATE TABLE IF NOT EXISTS api_webhook_failures (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  entity_id TEXT,
  status INTEGER,
  error TEXT,
  created_time INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_webhook_failures ON api_webhook_failures(webhook_id, created_time);
`);
db.prepare('UPDATE api_webhooks SET api_version = ? WHERE api_version != ?').run(API_VERSION, API_VERSION);

export const PAGE_EVENTS = ['page.created', 'page.content_updated', 'page.properties_updated', 'page.moved', 'page.deleted', 'page.undeleted', 'page.locked', 'page.unlocked'];
export const DATABASE_EVENTS = ['database.created', 'database.content_updated', 'database.schema_updated', 'database.moved', 'database.deleted', 'database.undeleted'];
export const DATA_SOURCE_EVENTS = ['data_source.created', 'data_source.content_updated', 'data_source.schema_updated', 'data_source.moved', 'data_source.deleted', 'data_source.undeleted'];
export const COMMENT_EVENTS = ['comment.created', 'comment.updated', 'comment.deleted'];
export const ALL_EVENTS = [...PAGE_EVENTS, ...DATABASE_EVENTS, ...DATA_SOURCE_EVENTS, ...COMMENT_EVENTS];

export function webhooksEnabled(): boolean {
  return !isDemoMode() && process.env.NC_CONNECTION_WEBHOOKS === '1';
}

export const WEBHOOKS_OFF = 'Connection webhooks are turned off on this server. Start it with NC_CONNECTION_WEBHOOKS=1 to use them.';

export type WebhookStatus = 'pending_verification' | 'active' | 'paused' | 'paused_errors';

export interface Webhook {
  id: string;
  integrationId: string;
  url: string;
  eventTypes: string[];
  apiVersion: string;
  status: WebhookStatus;
  createdTime: number;
  verifiedTime: number | null;
  successes: number;
  failures: number;
  lastFailureTime: number | null;
  lastFailureStatus: number | null;
}

interface Row {
  id: string; integration_id: string; url: string; event_types: string; api_version: string; verification_token: string; status: WebhookStatus;
  created_time: number; updated_time: number; verified_time: number | null; successes: number; failures: number; consecutive_failures: number;
  last_failure_time: number | null; last_failure_status: number | null;
}

function toWebhook(r: Row): Webhook {
  let events: string[] = [];
  try {
    events = (JSON.parse(r.event_types) as unknown[]).filter((x): x is string => typeof x === 'string' && ALL_EVENTS.includes(x));
  } catch {
    events = [];
  }
  return {
    id: r.id, integrationId: r.integration_id, url: r.url, eventTypes: events, apiVersion: API_VERSION, status: r.status, createdTime: r.created_time,
    verifiedTime: r.verified_time ?? null, successes: r.successes, failures: r.failures, lastFailureTime: r.last_failure_time ?? null,
    lastFailureStatus: r.last_failure_status ?? null,
  };
}

function rowOf(id: string): Row | undefined {
  return db.prepare('SELECT * FROM api_webhooks WHERE id = ?').get(String(id)) as Row | undefined;
}

function cleanEvents(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string' && ALL_EVENTS.includes(x)) : ALL_EVENTS;
  return [...new Set(list)];
}

function cleanUrl(raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 2000) throw new IntegrationError('Enter a webhook URL.', 400);
  let u: URL;
  try {
    u = assertFetchableUrl(s);
  } catch (e) {
    throw new IntegrationError(`This URL can’t receive webhook events: ${(e as Error).message}`, 400);
  }
  const loopback = /^(localhost|127\.|\[::1\])/.test(u.host);
  if (u.protocol !== 'https:' && !(loopback && process.env.NODE_ENV !== 'production')) throw new IntegrationError('Webhook URLs must use https.', 400);
  return u.toString();
}

function manageable(integrationId: string, userId: string): Integration {
  const i = getIntegration(integrationId);
  if (!i) throw new IntegrationError('Not found: connection is unavailable.', 404);
  if (!canManage(i, userId)) throw new IntegrationError('Only the connection’s owner or a workspace owner can manage its webhooks.', 403);
  return i;
}

export function listWebhooks(integrationId: string, userId: string): Webhook[] {
  manageable(integrationId, userId);
  return (db.prepare('SELECT * FROM api_webhooks WHERE integration_id = ? ORDER BY created_time').all(integrationId) as unknown as Row[]).map(toWebhook);
}

export async function createWebhook(input: { integrationId: string; userId: string; url: unknown; eventTypes?: unknown; apiVersion?: unknown }): Promise<Webhook> {
  if (!webhooksEnabled()) throw new IntegrationError(WEBHOOKS_OFF, 400);
  manageable(input.integrationId, input.userId);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM api_webhooks WHERE integration_id = ?').get(input.integrationId) as { n: number }).n;
  if (n >= 5) throw new IntegrationError('A connection can have up to 5 webhook subscriptions.', 400);
  const url = cleanUrl(input.url);
  const events = cleanEvents(input.eventTypes);
  if (!events.length) throw new IntegrationError('Select at least one event.', 400);
  const id = newId();
  const nowMs = Date.now();
  const token = `lp_whsec_${randomBytes(24).toString('base64url')}`;
  const version = API_VERSION;
  db.prepare(`INSERT INTO api_webhooks (id, integration_id, url, event_types, api_version, verification_token, status, created_time, updated_time)
    VALUES (?, ?, ?, ?, ?, ?, 'pending_verification', ?, ?)`).run(id, input.integrationId, url, JSON.stringify(events), version, token, nowMs, nowMs);
  await sendVerification(id).catch(() => undefined);
  return toWebhook(rowOf(id)!);
}

/** POST { verification_token } to the subscription URL. */
export async function sendVerification(webhookId: string): Promise<{ ok: boolean; status: number }> {
  if (!webhooksEnabled()) throw new IntegrationError(WEBHOOKS_OFF, 400);
  const r = rowOf(webhookId);
  if (!r) throw new IntegrationError('Not found: subscription is unavailable.', 404);
  try {
    const res = await safeFetch(r.url, {
      method: 'POST', body: JSON.stringify({ verification_token: r.verification_token }), headers: { 'content-type': 'application/json' },
      accept: 'application/json', timeoutMs: 5000, maxBytes: 64 * 1024,
    });
    return { ok: res.status >= 200 && res.status < 300, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

export async function resendVerification(webhookId: string, userId: string) {
  const r = rowOf(webhookId);
  if (!r) throw new IntegrationError('Not found: subscription is unavailable.', 404);
  manageable(r.integration_id, userId);
  return sendVerification(webhookId);
}

export function verifyWebhook(webhookId: string, userId: string, token: unknown): Webhook {
  const r = rowOf(webhookId);
  if (!r) throw new IntegrationError('Not found: subscription is unavailable.', 404);
  manageable(r.integration_id, userId);
  if (typeof token !== 'string' || token.trim() !== r.verification_token) throw new IntegrationError('The verification token is invalid.', 400);
  const nowMs = Date.now();
  db.prepare("UPDATE api_webhooks SET status = 'active', verified_time = ?, updated_time = ?, consecutive_failures = 0 WHERE id = ?").run(nowMs, nowMs, webhookId);
  return toWebhook(rowOf(webhookId)!);
}

export function updateWebhook(webhookId: string, userId: string, patch: { status?: unknown; eventTypes?: unknown; url?: unknown }): Webhook {
  const r = rowOf(webhookId);
  if (!r) throw new IntegrationError('Not found: subscription is unavailable.', 404);
  manageable(r.integration_id, userId);
  let status = r.status;
  if (patch.status === 'paused' && (status === 'active' || status === 'paused_errors')) status = 'paused';
  if (patch.status === 'active' && (status === 'paused' || status === 'paused_errors')) status = r.verified_time ? 'active' : 'pending_verification';
  const events = patch.eventTypes !== undefined ? cleanEvents(patch.eventTypes) : JSON.parse(r.event_types);
  if (!events.length) throw new IntegrationError('Select at least one event.', 400);
  let url = r.url;
  if (patch.url !== undefined && patch.url !== r.url) {
    url = cleanUrl(patch.url);
    status = 'pending_verification';
  }
  db.prepare('UPDATE api_webhooks SET status = ?, event_types = ?, url = ?, updated_time = ?, consecutive_failures = CASE WHEN ? = \'active\' THEN 0 ELSE consecutive_failures END WHERE id = ?')
    .run(status, JSON.stringify(events), url, Date.now(), status, webhookId);
  return toWebhook(rowOf(webhookId)!);
}

export function deleteWebhook(webhookId: string, userId: string) {
  const r = rowOf(webhookId);
  if (!r) throw new IntegrationError('Not found: subscription is unavailable.', 404);
  manageable(r.integration_id, userId);
  db.prepare('DELETE FROM api_webhooks WHERE id = ?').run(webhookId);
  db.prepare('DELETE FROM api_webhook_failures WHERE webhook_id = ?').run(webhookId);
}

export function webhookFailures(webhookId: string, userId: string) {
  const r = rowOf(webhookId);
  if (!r) throw new IntegrationError('Not found: subscription is unavailable.', 404);
  manageable(r.integration_id, userId);
  return (db.prepare('SELECT * FROM api_webhook_failures WHERE webhook_id = ? ORDER BY created_time DESC LIMIT 50').all(webhookId) as {
    id: string; event_type: string; entity_id: string | null; status: number | null; error: string | null; created_time: number;
  }[]).map((f) => ({ id: f.id, eventType: f.event_type, entityId: f.entity_id, status: f.status, error: f.error, time: f.created_time }));
}

// ---------------------------------------------------------------- event detection

interface PendingEvent {
  type: string;
  entity: { id: string; type: 'page' | 'block' | 'database' | 'data_source' | 'comment' };
  spaceId: string;
  authors: Set<string>;
  data: { parent?: { id: string; type: string }; updated_blocks: Set<string>; updated_properties: Set<string>; page_id?: string };
}

const pending = new Map<string, PendingEvent>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function aggregateMs(): number {
  const v = Number(process.env.NC_WEBHOOK_AGGREGATE_MS);
  return Number.isFinite(v) && v >= 0 ? v : 1000;
}

function queue(ev: Omit<PendingEvent, 'authors' | 'data'> & { author: string; data?: Partial<{ parent: { id: string; type: string }; updated_blocks: string[]; updated_properties: string[]; page_id: string }> }) {
  const key = `${ev.type}:${ev.entity.id}`;
  const cur = pending.get(key) ?? { type: ev.type, entity: ev.entity, spaceId: ev.spaceId, authors: new Set<string>(), data: { updated_blocks: new Set<string>(), updated_properties: new Set<string>() } };
  cur.authors.add(ev.author);
  if (ev.data?.parent) cur.data.parent = ev.data.parent;
  if (ev.data?.page_id) cur.data.page_id = ev.data.page_id;
  for (const b of ev.data?.updated_blocks ?? []) cur.data.updated_blocks.add(b);
  for (const p of ev.data?.updated_properties ?? []) cur.data.updated_properties.add(p);
  pending.set(key, cur);
  // deleted/undeleted cancel each other inside the window (aggregated by canceling out)
  const [kind, verb] = ev.type.split('.');
  const opposite = verb === 'deleted' ? `${kind}.undeleted` : verb === 'undeleted' ? `${kind}.deleted` : null;
  if (opposite && pending.has(`${opposite}:${ev.entity.id}`)) {
    pending.delete(`${opposite}:${ev.entity.id}`);
    pending.delete(key);
  }
  if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, aggregateMs());
}

const isPageType = (t: string) => t === 'page' || t === 'collection_view_page';
const isDbType = (t: string) => t === 'collection_view_page' || t === 'collection_view';

function parentRef(b: BlockRecord): { id: string; type: string } {
  if (b.parent_table === 'collection') return { id: getRecord<CollectionRecord>('collection', b.parent_id)?.parent_id ?? b.parent_id, type: 'database' };
  if (b.parent_table === 'block') return { id: b.parent_id, type: isPageType(getRecord<BlockRecord>('block', b.parent_id)?.type ?? '') ? 'page' : 'block' };
  return { id: b.space_id, type: 'space' };
}

function blockEvents(info: CommitInfo, b: BlockRecord, prev: BlockRecord | undefined) {
  const author = info.userId;
  const spaceId = b.space_id;
  if (isDbType(b.type)) {
    const entity = { id: b.id, type: 'database' as const };
    if (!prev) return queue({ type: 'database.created', entity, spaceId, author, data: { parent: parentRef(b) } });
    if (prev.alive !== false && b.alive === false) return queue({ type: 'database.deleted', entity, spaceId, author, data: { parent: parentRef(b) } });
    if (prev.alive === false && b.alive !== false) return queue({ type: 'database.undeleted', entity, spaceId, author, data: { parent: parentRef(b) } });
    if (prev.parent_id !== b.parent_id) return queue({ type: 'database.moved', entity, spaceId, author, data: { parent: parentRef(b) } });
    return;
  }
  if (b.type === 'page') {
    const entity = { id: b.id, type: 'page' as const };
    const parent = parentRef(b);
    if (!prev) return queue({ type: 'page.created', entity, spaceId, author, data: { parent } });
    if (prev.alive !== false && b.alive === false) return queue({ type: 'page.deleted', entity, spaceId, author, data: { parent } });
    if (prev.alive === false && b.alive !== false) return queue({ type: 'page.undeleted', entity, spaceId, author, data: { parent } });
    if (prev.parent_id !== b.parent_id) queue({ type: 'page.moved', entity, spaceId, author, data: { parent } });
    if (!!prev.format?.block_locked !== !!b.format?.block_locked) queue({ type: b.format?.block_locked ? 'page.locked' : 'page.unlocked', entity, spaceId, author, data: { parent } });
    const changedProps = Object.keys({ ...(prev.properties ?? {}), ...(b.properties ?? {}) }).filter((k) => JSON.stringify(prev.properties?.[k]) !== JSON.stringify(b.properties?.[k]));
    if (changedProps.length) queue({ type: 'page.properties_updated', entity, spaceId, author, data: { parent, updated_properties: changedProps.map((k) => encodeURIComponent(k)) } });
    if (JSON.stringify(prev.content ?? []) !== JSON.stringify(b.content ?? [])) queue({ type: 'page.content_updated', entity, spaceId, author, data: { parent } });
    return;
  }
  // a content block: the page it lives in changed
  const pageId = pageIdOf(b);
  if (pageId && pageId !== b.id) {
    const page = getRecord<BlockRecord>('block', pageId);
    if (page && page.type === 'page') queue({ type: 'page.content_updated', entity: { id: pageId, type: 'page' }, spaceId, author, data: { parent: parentRef(page), updated_blocks: [b.id] } });
  }
}

function detect(info: CommitInfo) {
  if (!webhooksEnabled()) return;
  for (const ch of info.changes) {
    const prev = info.prev.get(`${ch.table}:${ch.record.id}`);
    if (ch.table === 'block') blockEvents(info, ch.record as BlockRecord, prev as BlockRecord | undefined);
    else if (ch.table === 'collection') {
      const c = ch.record as CollectionRecord;
      const p = prev as CollectionRecord | undefined;
      if (!p) continue; // database.created covers it
      const schema = JSON.stringify(p.schema) !== JSON.stringify(c.schema);
      const host = getRecord<BlockRecord>('block', c.parent_id);
      if (!host) continue;
      if (schema) {
        queue({ type: 'database.schema_updated', entity: { id: host.id, type: 'database' }, spaceId: host.space_id, author: info.userId, data: { parent: parentRef(host) } });
        queue({ type: 'data_source.schema_updated', entity: { id: c.id, type: 'data_source' }, spaceId: host.space_id, author: info.userId, data: { parent: { id: host.id, type: 'database' } } });
      }
    } else if (ch.table === 'comment') {
      const c = ch.record as CommentRecord;
      const p = prev as CommentRecord | undefined;
      const d = getRecord<DiscussionRecord>('discussion', c.parent_id);
      if (!d) continue;
      const target = getRecord<BlockRecord>('block', d.parent_id);
      if (!target) continue;
      const pageId = pageIdOf(target);
      const type = !p ? 'comment.created' : p.alive !== false && c.alive === false ? 'comment.deleted' : JSON.stringify(p.text) !== JSON.stringify(c.text) ? 'comment.updated' : null;
      if (type) queue({ type, entity: { id: c.id, type: 'comment' }, spaceId: c.space_id, author: info.userId, data: { page_id: pageId, parent: { id: d.parent_id, type: d.parent_id === pageId ? 'page' : 'block' } } });
    }
    // rows added / removed: the database's content changed
    if (ch.table === 'block') {
      const b = ch.record as BlockRecord;
      const p = prev as BlockRecord | undefined;
      if (b.parent_table === 'collection' && (!p || p.alive !== b.alive)) {
        const host = getRecord<BlockRecord>('block', getRecord<CollectionRecord>('collection', b.parent_id)?.parent_id ?? '');
        if (host) {
          queue({ type: 'database.content_updated', entity: { id: host.id, type: 'database' }, spaceId: host.space_id, author: info.userId, data: { parent: parentRef(host), updated_blocks: [b.id] } });
          queue({ type: 'data_source.content_updated', entity: { id: b.parent_id, type: 'data_source' }, spaceId: host.space_id, author: info.userId, data: { parent: { id: host.id, type: 'database' }, updated_blocks: [b.id] } });
        }
      }
    }
  }
}

onCommit(detect);

/** The block whose reachability decides whether a connection may see the event. */
function accessAnchor(ev: PendingEvent): string | null {
  if (ev.entity.type === 'comment') return ev.data.page_id ?? null;
  if (ev.entity.type === 'data_source') return getRecord<CollectionRecord>('collection', ev.entity.id)?.parent_id ?? null;
  return ev.entity.id;
}

function sign(body: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function deliver(r: Row, payload: Record<string, unknown>, attempt = 1): Promise<void> {
  const body = JSON.stringify({ ...payload, attempt_number: attempt });
  let status = 0;
  let error = '';
  try {
    const res = await safeFetch(r.url, {
      method: 'POST', body, accept: 'application/json', timeoutMs: 5000, maxBytes: 64 * 1024,
      headers: { 'content-type': 'application/json', 'x-lit-signature': sign(body, r.verification_token), 'user-agent': 'LitCloneWebhooks/1.0' },
    });
    status = res.status;
    if (status >= 200 && status < 300) {
      db.prepare('UPDATE api_webhooks SET successes = successes + 1, consecutive_failures = 0 WHERE id = ?').run(r.id);
      return;
    }
    error = `HTTP ${status}`;
  } catch (e) {
    error = String((e as Error)?.message ?? e).slice(0, 200);
  }
  if (attempt < 3) {
    setTimeout(() => { void deliver(r, payload, attempt + 1); }, attempt * Number(process.env.NC_WEBHOOK_RETRY_MS ?? 2000));
    return;
  }
  const nowMs = Date.now();
  db.prepare('INSERT INTO api_webhook_failures (id, webhook_id, event_type, entity_id, status, error, created_time) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(newId(), r.id, String(payload.type), String((payload.entity as { id?: string })?.id ?? ''), status || null, error, nowMs);
  db.prepare(`UPDATE api_webhooks SET failures = failures + 1, consecutive_failures = consecutive_failures + 1, last_failure_time = ?, last_failure_status = ?,
    status = CASE WHEN consecutive_failures + 1 >= 20 AND status = 'active' THEN 'paused_errors' ELSE status END WHERE id = ?`).run(nowMs, status || null, r.id);
}

async function flush() {
  const events = [...pending.values()];
  pending.clear();
  if (!webhooksEnabled() || !events.length) return;
  const bySpace = new Map<string, PendingEvent[]>();
  for (const ev of events) bySpace.set(ev.spaceId, [...(bySpace.get(ev.spaceId) ?? []), ev]);
  for (const [spaceId, list] of bySpace) {
    const space = getRecord<SpaceRecord>('space', spaceId);
    for (const i of integrationsInSpace(spaceId)) {
      const subs = (db.prepare("SELECT * FROM api_webhooks WHERE integration_id = ? AND status = 'active'").all(i.id) as unknown as Row[]);
      if (!subs.length) continue;
      for (const ev of list) {
        // the connection's own changes are not echoed back to it
        if (ev.authors.size === 1 && ev.authors.has(i.botId)) continue;
        const anchor = accessAnchor(ev);
        if (!anchor || connectionRole(i, anchor) === 'none') continue;
        for (const r of subs) {
          const events = toWebhook(r).eventTypes;
          if (!events.includes(ev.type)) continue;
          const payload: Record<string, unknown> = {
            id: newId(), timestamp: new Date().toISOString(), workspace_id: spaceId, workspace_name: space?.name ?? '', subscription_id: r.id,
            integration_id: i.id, type: ev.type,
            authors: [...ev.authors].map((a) => ({ id: a, type: isIntegrationBot(a) ? 'bot' : 'person' })),
            accessible_by: [{ id: i.botId, type: 'bot' }],
            entity: ev.entity,
            data: {
              ...(ev.data.parent ? { parent: ev.data.parent } : {}),
              ...(ev.data.page_id ? { page_id: ev.data.page_id } : {}),
              ...(ev.data.updated_blocks.size ? { updated_blocks: [...ev.data.updated_blocks].slice(0, 100).map((id) => ({ id, type: 'block' })) } : {}),
              ...(ev.data.updated_properties.size ? { updated_properties: [...ev.data.updated_properties] } : {}),
            },
          };
          void deliver(r, payload);
        }
      }
    }
  }
}

/** Test seam: deliver everything queued now. */
export async function flushWebhookEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush();
}

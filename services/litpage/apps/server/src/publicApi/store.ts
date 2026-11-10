// Public API internal connections: storage of connections, their capabilities, their
// hashed API tokens, the pages shared with them (page ••• › Connections) and the bot user that acts for them.
// - a connection lives in one workspace (fixed at creation, with its associated workspace);
// - its API token ("lp_int_…") is shown once — at creation and when it is refreshed — and stored as a sha256 hash;
// - it acts as its own bot principal (a lit_user record { bot: { integration_id } }, never a login): it reaches
// only the pages / databases shared with it and their descendants (access.ts), never its owner's access;
// - capabilities (Read / Update / Insert content, Read / Insert comments, user information without / with email)
// are checked by every /v1 endpoint (routes.ts).
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '@nc/shared/ids.ts';
import { isRestrictedMember, isSpaceMember } from '@nc/shared/permissions.ts';
import { isSpaceOwner } from '../policy.ts';
import type { SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { db, getRecord, putRecord } from '../db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS api_integrations (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  bot_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  icon TEXT,
  capabilities TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  token_refreshed_time INTEGER NOT NULL,
  install_token_hash TEXT,
  install_token_prefix TEXT,
  install_token_time INTEGER,
  created_time INTEGER NOT NULL,
  updated_time INTEGER NOT NULL,
  last_used_time INTEGER,
  deleted_time INTEGER
);
CREATE INDEX IF NOT EXISTS idx_api_integrations_space ON api_integrations(space_id, deleted_time);
CREATE TABLE IF NOT EXISTS api_integration_grants (
  integration_id TEXT NOT NULL,
  block_id TEXT NOT NULL,
  space_id TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  PRIMARY KEY (integration_id, block_id)
);
CREATE INDEX IF NOT EXISTS idx_api_grants_block ON api_integration_grants(block_id);
CREATE TABLE IF NOT EXISTS api_request_stats (
  integration_id TEXT NOT NULL,
  hour INTEGER NOT NULL,
  ok INTEGER NOT NULL DEFAULT 0,
  client_errors INTEGER NOT NULL DEFAULT 0,
  rate_limited INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (integration_id, hour)
);
`);

export type UserInfoCapability = 'none' | 'no_email' | 'with_email';

/** Capabilities: content read, update, and insert; comment read and insert; user information. */
export interface Capabilities {
  read_content: boolean;
  update_content: boolean;
  insert_content: boolean;
  read_comments: boolean;
  insert_comments: boolean;
  user_info: UserInfoCapability;
}

export const DEFAULT_CAPABILITIES: Capabilities = {
  read_content: true, update_content: true, insert_content: true, read_comments: true, insert_comments: true, user_info: 'no_email',
};

export interface Integration {
  id: string;
  spaceId: string;
  ownerId: string;
  botId: string;
  name: string;
  icon: string | null;
  capabilities: Capabilities;
  tokenPrefix: string;
  tokenRefreshedTime: number;
  installTokenPrefix: string | null;
  installTokenTime: number | null;
  createdTime: number;
  updatedTime: number;
  lastUsedTime: number | null;
  deletedTime: number | null;
}

interface Row {
  id: string;
  space_id: string;
  owner_id: string;
  bot_id: string;
  name: string;
  icon: string | null;
  capabilities: string;
  token_prefix: string;
  token_refreshed_time: number;
  install_token_prefix: string | null;
  install_token_time: number | null;
  created_time: number;
  updated_time: number;
  last_used_time: number | null;
  deleted_time: number | null;
}

export class IntegrationError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function cleanCapabilities(raw: unknown, base: Capabilities = DEFAULT_CAPABILITIES): Capabilities {
  const v = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const bool = (k: keyof Capabilities) => (typeof v[k] === 'boolean' ? (v[k] as boolean) : (base[k] as boolean));
  const ui = v.user_info;
  return {
    read_content: bool('read_content'),
    update_content: bool('update_content'),
    insert_content: bool('insert_content'),
    read_comments: bool('read_comments'),
    insert_comments: bool('insert_comments'),
    user_info: ui === 'none' || ui === 'no_email' || ui === 'with_email' ? ui : base.user_info,
  };
}

/** A connection must be able to do something (at least one capability). */
export function hasAnyCapability(c: Capabilities): boolean {
  return c.read_content || c.update_content || c.insert_content || c.read_comments || c.insert_comments || c.user_info !== 'none';
}

function toIntegration(r: Row): Integration {
  let caps: Capabilities;
  try {
    caps = cleanCapabilities(JSON.parse(r.capabilities));
  } catch {
    caps = { ...DEFAULT_CAPABILITIES };
  }
  return {
    id: r.id, spaceId: r.space_id, ownerId: r.owner_id, botId: r.bot_id, name: r.name, icon: r.icon, capabilities: caps,
    tokenPrefix: r.token_prefix, tokenRefreshedTime: r.token_refreshed_time, installTokenPrefix: r.install_token_prefix ?? null,
    installTokenTime: r.install_token_time ?? null, createdTime: r.created_time, updatedTime: r.updated_time,
    lastUsedTime: r.last_used_time ?? null, deletedTime: r.deleted_time ?? null,
  };
}

export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Alphanumeric secret (no "_" or "-", so it never looks like a personal access token "lp_pat_…"). */
function secret(len = 43): string {
  const bytes = randomBytes(len);
  let out = '';
  for (const b of bytes) out += B62[b % 62];
  return out;
}

export function newApiToken(): string {
  return `lp_int_${secret(43)}`;
}

/** Shown in lists: the first characters only. */
export function tokenPrefixOf(token: string): string {
  return token.slice(0, 10);
}

// ---------------------------------------------------------------- bots

let bots: Map<string, string> | null = null; // bot user id → integration id

function botMap(): Map<string, string> {
  if (!bots) {
    bots = new Map();
    for (const r of db.prepare('SELECT bot_id, id FROM api_integrations').all() as { bot_id: string; id: string }[]) bots.set(r.bot_id, r.id);
  }
  return bots;
}

/** Is this user id an API connection's bot? (cheap: in-memory map) */
export function isIntegrationBot(id: string | null | undefined): boolean {
  return !!id && botMap().has(id);
}

export function integrationIdOfBot(botId: string): string | undefined {
  return botMap().get(botId);
}

function botUserValue(i: Integration, version: number): UserRecord {
  const icon = i.icon && /^(https?:\/\/|\/files\/)/.test(i.icon) ? i.icon : undefined;
  return {
    id: i.botId, version, name: i.name, given_name: i.name, created_time: i.createdTime,
    ...(icon ? { profile_photo: icon } : {}),
    bot: { integration_id: i.id, space_id: i.spaceId, icon: i.icon ?? null, owner_id: i.ownerId },
  } as unknown as UserRecord;
}

/** Keep the bot's user record (name / icon shown for the connection's edits and comments) in sync. */
export function syncBotUser(i: Integration) {
  const prev = getRecord<UserRecord>('lit_user', i.botId) as unknown as Record<string, unknown> | undefined;
  const next = botUserValue(i, Number(prev?.version ?? 0) + 1) as unknown as Record<string, unknown>;
  if (prev && prev.name === next.name && JSON.stringify(prev.bot) === JSON.stringify(next.bot) && prev.profile_photo === next.profile_photo) return;
  putRecord('lit_user', next as unknown as UserRecord);
  botMap().set(i.botId, i.id);
}

// ---------------------------------------------------------------- integrations

export function getIntegration(id: string | null | undefined, opts: { includeDeleted?: boolean } = {}): Integration | undefined {
  if (!id || typeof id !== 'string') return undefined;
  const r = db.prepare('SELECT * FROM api_integrations WHERE id = ?').get(id) as Row | undefined;
  if (!r || (r.deleted_time && !opts.includeDeleted)) return undefined;
  return toIntegration(r);
}

export function integrationByBot(botId: string): Integration | undefined {
  return getIntegration(integrationIdOfBot(botId));
}

export function integrationsInSpace(spaceId: string): Integration[] {
  return (db.prepare('SELECT * FROM api_integrations WHERE space_id = ? AND deleted_time IS NULL ORDER BY created_time').all(spaceId) as unknown as Row[]).map(toIntegration);
}

/** Who may create an internal connection in a workspace: full members (not guests, not restricted members). */
export function creationProblem(spaceId: string, userId: string): string | null {
  const space = getRecord<SpaceRecord>('space', spaceId);
  if (!space || !isSpaceMember(space, userId)) return 'You cannot create connections in this workspace.';
  if (isRestrictedMember(space, userId)) return 'You cannot create internal connections in this workspace.';
  return null;
}

/** The connection's owner and workspace owners manage it (rename, capabilities, token, delete) — not membership admins,
 * who manage members only (policy.ts). */
export function canManage(i: Integration, userId: string): boolean {
  if (i.ownerId === userId) return isSpaceMember(getRecord<SpaceRecord>('space', i.spaceId), userId);
  return isSpaceOwner(getRecord<SpaceRecord>('space', i.spaceId), userId);
}

/** Every workspace member sees the workspace's connections (Settings › Connections, page ••• › Connections). */
export function canSee(i: Integration, userId: string): boolean {
  return isSpaceMember(getRecord<SpaceRecord>('space', i.spaceId), userId);
}

const MAX_PER_SPACE = 100;

export function cleanName(raw: unknown): string {
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 100);
}

export function cleanIcon(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim();
  if (/^\/files\/[0-9a-f-]{36}\//i.test(s) || /^https:\/\//.test(s)) return s.slice(0, 500);
  // an emoji / short glyph
  return [...s].length <= 8 ? s : null;
}

export function createIntegration(input: { spaceId: string; userId: string; name: string; icon?: unknown; capabilities?: unknown }): { integration: Integration; token: string } {
  const problem = creationProblem(input.spaceId, input.userId);
  if (problem) throw new IntegrationError(problem, 403);
  const name = cleanName(input.name);
  if (!name) throw new IntegrationError('Add a name first', 400);
  const caps = cleanCapabilities(input.capabilities);
  if (!hasAnyCapability(caps)) throw new IntegrationError('Choose at least one capability before saving', 400);
  const n = (db.prepare('SELECT COUNT(*) AS n FROM api_integrations WHERE space_id = ? AND deleted_time IS NULL').get(input.spaceId) as { n: number }).n;
  if (n >= MAX_PER_SPACE) throw new IntegrationError('This workspace has reached the maximum number of connections.', 400);
  const id = newId();
  const botId = newId();
  const token = newApiToken();
  const now = Date.now();
  db.prepare(`INSERT INTO api_integrations (id, space_id, owner_id, bot_id, name, icon, capabilities, token_hash, token_prefix, token_refreshed_time, created_time, updated_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, input.spaceId, input.userId, botId, name, cleanIcon(input.icon), JSON.stringify(caps), sha256(token), tokenPrefixOf(token), now, now, now);
  const integration = getIntegration(id)!;
  syncBotUser(integration);
  return { integration, token };
}

export function updateIntegration(id: string, userId: string, patch: { name?: unknown; icon?: unknown; capabilities?: unknown }): Integration {
  const i = getIntegration(id);
  if (!i || !canSee(i, userId)) throw new IntegrationError('Not found: connection is unavailable.', 404);
  if (!canManage(i, userId)) throw new IntegrationError('Only the connection’s owner or a workspace owner can change this connection.', 403);
  const name = patch.name !== undefined ? cleanName(patch.name) : i.name;
  if (!name) throw new IntegrationError('Add a name first', 400);
  const caps = patch.capabilities !== undefined ? cleanCapabilities(patch.capabilities, i.capabilities) : i.capabilities;
  if (!hasAnyCapability(caps)) throw new IntegrationError('Choose at least one capability before saving', 400);
  const icon = patch.icon !== undefined ? cleanIcon(patch.icon) : i.icon;
  db.prepare('UPDATE api_integrations SET name = ?, icon = ?, capabilities = ?, updated_time = ? WHERE id = ?').run(name, icon, JSON.stringify(caps), Date.now(), id);
  const next = getIntegration(id)!;
  syncBotUser(next);
  bumpGrants();
  return next;
}

/** "Refresh API token": the old token stops working at once; the new one is returned once. */
export function refreshToken(id: string, userId: string): { integration: Integration; token: string } {
  const i = getIntegration(id);
  if (!i || !canSee(i, userId)) throw new IntegrationError('Not found: connection is unavailable.', 404);
  if (!canManage(i, userId)) throw new IntegrationError('Only the connection’s owner or a workspace owner can refresh its token.', 403);
  const token = newApiToken();
  const now = Date.now();
  db.prepare('UPDATE api_integrations SET token_hash = ?, token_prefix = ?, token_refreshed_time = ?, updated_time = ? WHERE id = ?').run(sha256(token), tokenPrefixOf(token), now, now, id);
  return { integration: getIntegration(id)!, token };
}

/** "Copy installation access token": a second token for pasting into a partner's setup form (replaces the previous one). */
export function newInstallationToken(id: string, userId: string): { integration: Integration; token: string } {
  const i = getIntegration(id);
  if (!i || !canSee(i, userId)) throw new IntegrationError('Not found: connection is unavailable.', 404);
  if (!canManage(i, userId)) throw new IntegrationError('Only the connection’s owner or a workspace owner can copy its installation access token.', 403);
  const token = `lp_int_${secret(43)}`;
  const now = Date.now();
  db.prepare('UPDATE api_integrations SET install_token_hash = ?, install_token_prefix = ?, install_token_time = ?, updated_time = ? WHERE id = ?').run(sha256(token), tokenPrefixOf(token), now, now, id);
  return { integration: getIntegration(id)!, token };
}

/** Disconnect / delete: the token stops working, every page loses the connection. */
export function deleteIntegration(id: string, userId: string): Integration {
  const i = getIntegration(id);
  if (!i || !canSee(i, userId)) throw new IntegrationError('Not found: connection is unavailable.', 404);
  if (!canManage(i, userId)) throw new IntegrationError('Only the connection’s owner or a workspace owner can delete this connection.', 403);
  const now = Date.now();
  db.prepare('UPDATE api_integrations SET deleted_time = ?, updated_time = ? WHERE id = ?').run(now, now, id);
  db.prepare('DELETE FROM api_integration_grants WHERE integration_id = ?').run(id);
  bumpGrants();
  return getIntegration(id, { includeDeleted: true })!;
}

/** Token → connection (null when unknown, revoked or its workspace is gone). Records the last use. */
export function integrationForToken(token: string): Integration | null {
  if (!/^lp_int_[0-9A-Za-z]{30,80}$/.test(token)) return null;
  const h = sha256(token);
  const r = db.prepare('SELECT * FROM api_integrations WHERE (token_hash = ? OR install_token_hash = ?) AND deleted_time IS NULL').get(h, h) as Row | undefined;
  if (!r) return null;
  if (!getRecord<SpaceRecord>('space', r.space_id)) return null;
  const now = Date.now();
  if (!r.last_used_time || now - r.last_used_time > 60_000) db.prepare('UPDATE api_integrations SET last_used_time = ? WHERE id = ?').run(now, r.id);
  return toIntegration(r);
}

// ---------------------------------------------------------------- grants (pages shared with a connection)

let grantVersion = 0;
const grantCache = new Map<string, { version: number; set: Set<string> }>();

function bumpGrants() {
  grantVersion++;
  if (grantCache.size > 2000) grantCache.clear();
}

export function grantsOf(integrationId: string): Set<string> {
  const hit = grantCache.get(integrationId);
  if (hit && hit.version === grantVersion) return hit.set;
  const set = new Set((db.prepare('SELECT block_id FROM api_integration_grants WHERE integration_id = ?').all(integrationId) as { block_id: string }[]).map((r) => r.block_id));
  grantCache.set(integrationId, { version: grantVersion, set });
  return set;
}

export interface GrantRow {
  integrationId: string;
  blockId: string;
  grantedBy: string;
  createdTime: number;
}

export function grantsOnBlocks(blockIds: string[]): GrantRow[] {
  if (!blockIds.length) return [];
  const rows = db.prepare(`SELECT * FROM api_integration_grants WHERE block_id IN (${blockIds.map(() => '?').join(',')})`).all(...blockIds) as {
    integration_id: string; block_id: string; granted_by: string; created_time: number;
  }[];
  return rows.map((r) => ({ integrationId: r.integration_id, blockId: r.block_id, grantedBy: r.granted_by, createdTime: r.created_time }));
}

export function addGrant(integrationId: string, blockId: string, spaceId: string, userId: string) {
  db.prepare('INSERT OR IGNORE INTO api_integration_grants (integration_id, block_id, space_id, granted_by, created_time) VALUES (?, ?, ?, ?, ?)')
    .run(integrationId, blockId, spaceId, userId, Date.now());
  bumpGrants();
}

export function removeGrant(integrationId: string, blockId: string): boolean {
  const n = Number(db.prepare('DELETE FROM api_integration_grants WHERE integration_id = ? AND block_id = ?').run(integrationId, blockId).changes ?? 0);
  bumpGrants();
  return n > 0;
}

export function grantCount(integrationId: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM api_integration_grants WHERE integration_id = ?').get(integrationId) as { n: number }).n;
}

export function grantedBlockIds(integrationId: string): string[] {
  return (db.prepare('SELECT block_id FROM api_integration_grants WHERE integration_id = ? ORDER BY created_time').all(integrationId) as { block_id: string }[]).map((r) => r.block_id);
}

// ---------------------------------------------------------------- request stats (Health)

export function recordRequest(integrationId: string, status: number) {
  const hour = Math.floor(Date.now() / 3_600_000);
  const col = status === 429 ? 'rate_limited' : status >= 400 && status < 500 ? 'client_errors' : 'ok';
  db.prepare(`INSERT INTO api_request_stats (integration_id, hour, ${col}) VALUES (?, ?, 1)
    ON CONFLICT(integration_id, hour) DO UPDATE SET ${col} = ${col} + 1`).run(integrationId, hour);
}

export function requestStats(integrationId: string, hours = 24): { ok: number; clientErrors: number; rateLimited: number } {
  const since = Math.floor(Date.now() / 3_600_000) - hours;
  const r = db.prepare('SELECT SUM(ok) AS ok, SUM(client_errors) AS ce, SUM(rate_limited) AS rl FROM api_request_stats WHERE integration_id = ? AND hour > ?').get(integrationId, since) as { ok: number | null; ce: number | null; rl: number | null };
  return { ok: r.ok ?? 0, clientErrors: r.ce ?? 0, rateLimited: r.rl ?? 0 };
}

export function ownerName(i: Integration): string {
  const u = getRecord<UserRecord>('lit_user', i.ownerId);
  return u?.name || u?.email || '';
}

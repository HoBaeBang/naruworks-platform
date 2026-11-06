// Who is calling the public API: an internal connection (its bot, its capabilities, the pages shared with it) or a
// person through a personal access token (Settings › Developer › Personal access tokens, "lp_pat_…": acts as that
// person with their own permissions in the token's workspace).
import { isRestrictedMember, isSpaceMember } from '@nc/shared/permissions.ts';
import { isSpaceOwner } from '../policy.ts';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import { integrationForToken, sha256, type Capabilities, type Integration } from './store.ts';

/** The single API version supported by Litpage's public REST API. */
export const API_VERSION = '2026-10-01';

export interface Principal {
  kind: 'integration' | 'personal';
  /** acting user id: the connection's bot or the person */
  id: string;
  spaceId: string;
  caps: Capabilities;
  integration?: Integration;
  /** personal access token id */
  tokenId?: string;
  /** rate limit / stats key */
  key: string;
}

const PERSONAL_CAPS: Capabilities = {
  read_content: true, update_content: true, insert_content: true, read_comments: true, insert_comments: true, user_info: 'with_email',
};

/** Personal access tokens are MCP tokens (table mcp_tokens): same hash, same rules. */
function personalForToken(token: string): { tokenId: string; userId: string; spaceId: string } | null {
  if (!/^lp_pat_[A-Za-z0-9_-]{20,}$/.test(token)) return null;
  let r: { id: string; user_id: string; space_id: string; last_used_time: number | null } | undefined;
  try {
    r = db.prepare('SELECT id, user_id, space_id, last_used_time FROM mcp_tokens WHERE token_hash = ? AND revoked_time IS NULL').get(sha256(token)) as typeof r;
  } catch {
    return null; // table not created (MCP module not loaded)
  }
  if (!r || !isSpaceMember(getRecord<SpaceRecord>('space', r.space_id), r.user_id)) return null;
  const now = Date.now();
  if (!r.last_used_time || now - r.last_used_time > 60_000) db.prepare('UPDATE mcp_tokens SET last_used_time = ? WHERE id = ?').run(now, r.id);
  return { tokenId: r.id, userId: r.user_id, spaceId: r.space_id };
}

/** Bearer token → principal (null = invalid / revoked token). */
export function principalForToken(token: string): Principal | null {
  const i = integrationForToken(token);
  if (i) return { kind: 'integration', id: i.botId, spaceId: i.spaceId, caps: i.capabilities, integration: i, key: `int:${i.id}` };
  const p = personalForToken(token);
  if (p) return { kind: 'personal', id: p.userId, spaceId: p.spaceId, caps: { ...PERSONAL_CAPS }, tokenId: p.tokenId, key: `pat:${p.tokenId}` };
  return null;
}

/** The principal can see this block (and it is in the principal's workspace). */
export function canReadBlock(p: Principal, blockId: string): boolean {
  return blockRole(blockId, p.id) !== 'none';
}

/** Workspace member list visibility: restricted members (and their tokens) only see themselves. */
export function canListUsers(p: Principal): boolean {
  if (p.kind === 'integration') return p.caps.user_info !== 'none';
  const space = getRecord<SpaceRecord>('space', p.spaceId);
  return isSpaceMember(space, p.id) && !isRestrictedMember(space, p.id);
}

export function isWorkspaceAdmin(p: Principal): boolean {
  return p.kind === 'personal' && isSpaceOwner(getRecord<SpaceRecord>('space', p.spaceId), p.id);
}

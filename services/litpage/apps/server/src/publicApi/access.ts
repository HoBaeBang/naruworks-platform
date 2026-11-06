// What an API connection can reach, enforced on the server:
// - a connection acts as its own principal (its bot user): effectiveRole(…, botId) is answered here — it reaches the
// pages and databases shared with it through page ••• › Connections, and everything below them (sub-pages, database
// rows, inline databases), never its owner's or the caller's access, never another workspace. A page whose sharing
// was unlinked from its parent (restricted sub-page) stops the inheritance.
// - the role follows the capabilities: Update / Insert content → Can edit, comments only → Can comment, else Can view.
// Full access (sharing) is never given, so a connection can't change page permissions.
// - database row / property access rules (dbaccess.ts, propaccess.ts) apply to the bot like to anyone: its role on the
// database decides, person-based exceptions never match it.
// - adding / removing a connection on a page needs Full access to that page (restricted members can only share what
// they fully own; they can't create connections at all — store.ts creationProblem).
import { maxRole, registerPrincipalResolver, roleAtLeast, type PermissionLookup } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, Role, SpaceRecord, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { getRecord } from '../db.ts';
import { blockRole } from '../records.ts';
import {
  addGrant, canSee, getIntegration, grantsOf, grantsOnBlocks, IntegrationError, integrationByBot, integrationsInSpace, isIntegrationBot, removeGrant,
  type Capabilities, type Integration,
} from './store.ts';

const SHAREABLE = new Set(['page', 'collection_view_page', 'collection_view']);

/** The role a connection gets on what is shared with it. */
export function grantRole(caps: Capabilities): Role {
  if (caps.update_content || caps.insert_content) return 'read_and_write';
  if (caps.insert_comments) return 'comment_only';
  return 'reader';
}

/** Role of connection `i` on block `id` (`lookup` = the caller's view of records, e.g. TxGuard's in-call state). */
export function integrationBlockRole(lookup: PermissionLookup, i: Integration, id: string): Role {
  if (i.deletedTime) return 'none';
  const grants = grantsOf(i.id);
  if (!grants.size) return 'none';
  let cur = lookup.block(id);
  const seen = new Set<string>();
  let role: Role = 'none';
  while (cur && !seen.has(cur.id) && seen.size < 2000) {
    seen.add(cur.id);
    if (cur.space_id !== i.spaceId) return 'none';
    if (grants.has(cur.id)) {
      role = maxRole(role, grantRole(i.capabilities));
      break;
    }
    if ((cur as { permissions_unlinked?: boolean }).permissions_unlinked) break;
    const pt = cur.parent_table as string;
    if (pt === 'collection' || pt === 'block') {
      const parentId = pt === 'collection' ? lookup.collection(cur.parent_id)?.parent_id : cur.parent_id;
      cur = parentId ? lookup.block(parentId) : undefined;
      continue;
    }
    break;
  }
  return role;
}

registerPrincipalResolver((lookup, id, principalId) => {
  if (!isIntegrationBot(principalId)) return null;
  const i = integrationByBot(principalId);
  return i ? integrationBlockRole(lookup, i, id) : 'none';
});

const serverLookup: PermissionLookup = {
  block: (id) => getRecord<BlockRecord>('block', id),
  space: (id) => getRecord<SpaceRecord>('space', id),
  team: (id) => getRecord<TeamRecord>('team', id),
  collection: (id) => getRecord<CollectionRecord>('collection', id),
};

export function connectionRole(i: Integration, blockId: string): Role {
  return integrationBlockRole(serverLookup, i, blockId);
}

export function blockLabel(id: string): string {
  const b = getRecord<BlockRecord>('block', id);
  if (!b) return 'Untitled';
  if ((b.type === 'collection_view_page' || b.type === 'collection_view') && b.collection_id) {
    const name = toPlainText(getRecord<CollectionRecord>('collection', b.collection_id)?.name);
    if (name) return name;
  }
  return toPlainText(b.properties?.title).replace(/[‣⁍]/g, '').trim() || 'Untitled';
}

/** Why `userId` may not add / remove a connection on `blockId` (null = allowed). */
export function grantProblem(userId: string, i: Integration | undefined, blockId: string): string | null {
  const b = getRecord<BlockRecord>('block', blockId);
  if (!i || !b || b.alive === false) return 'This page doesn’t exist or you can’t access it.';
  if (b.space_id !== i.spaceId) return 'This connection belongs to another workspace.';
  if (!SHAREABLE.has(b.type)) return 'Only pages and databases can be shared with a connection.';
  const mine = blockRole(blockId, userId);
  if (mine === 'none') return 'This page doesn’t exist or you can’t access it.';
  if (!roleAtLeast(mine, 'editor')) return 'You need full access to this page to add or remove connections.';
  return null;
}

export function addPageConnection(userId: string, integrationId: string, blockId: string): Integration {
  const i = getIntegration(integrationId);
  if (!i || !canSee(i, userId)) throw new IntegrationError('Not found: connection is unavailable.', 404);
  const problem = grantProblem(userId, i, blockId);
  if (problem) throw new IntegrationError(problem, 403);
  addGrant(i.id, blockId, i.spaceId, userId);
  return i;
}

export function removePageConnection(userId: string, integrationId: string, blockId: string): Integration {
  const i = getIntegration(integrationId);
  if (!i || !canSee(i, userId)) throw new IntegrationError('Not found: connection is unavailable.', 404);
  const problem = grantProblem(userId, i, blockId);
  if (problem) throw new IntegrationError(problem, 403);
  if (!removeGrant(i.id, blockId)) {
    // inherited from a parent page: removed there
    throw new IntegrationError('This connection has access through a parent page. Remove it from that page instead.', 400);
  }
  return i;
}

export interface PageConnection {
  integrationId: string;
  name: string;
  icon: string | null;
  /** shared on this page itself (removable here) vs through an ancestor */
  direct: boolean;
  /** the ancestor that shares it (inherited) */
  sourceId?: string;
  sourceTitle?: string;
  capabilities: Capabilities;
}

/** Connections that can reach a page (page ••• › Connections). */
export function pageConnections(pageId: string, viewerId: string): PageConnection[] {
  const page = getRecord<BlockRecord>('block', pageId);
  if (!page || blockRole(pageId, viewerId) === 'none') return [];
  // the page and its ancestors, nearest first (stopping where an unlinked page cuts inheritance)
  const chain: string[] = [];
  let cur: BlockRecord | undefined = page;
  for (let n = 0; n < 200 && cur; n++) {
    chain.push(cur.id);
    if ((cur as { permissions_unlinked?: boolean }).permissions_unlinked) break;
    if (cur.parent_table === 'collection') cur = getRecord<BlockRecord>('block', getRecord<CollectionRecord>('collection', cur.parent_id)?.parent_id ?? '');
    else if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else break;
  }
  const grants = grantsOnBlocks(chain);
  const out: PageConnection[] = [];
  const seen = new Set<string>();
  for (const id of chain) {
    for (const g of grants.filter((x) => x.blockId === id)) {
      if (seen.has(g.integrationId)) continue;
      const i = getIntegration(g.integrationId);
      if (!i || i.spaceId !== page.space_id) continue;
      seen.add(i.id);
      const direct = id === pageId;
      out.push({
        integrationId: i.id, name: i.name, icon: i.icon, direct, capabilities: i.capabilities,
        ...(direct ? {} : { sourceId: id, sourceTitle: blockRole(id, viewerId) === 'none' ? 'Private page' : blockLabel(id) }),
      });
    }
  }
  return out;
}

/** Connections of the workspace a member can add to a page (page ••• › Connections › Add connections). */
export function addableConnections(spaceId: string, viewerId: string): Integration[] {
  return integrationsInSpace(spaceId).filter((i) => canSee(i, viewerId));
}

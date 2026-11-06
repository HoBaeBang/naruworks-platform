// Developer platform endpoints for the web app: internal connections
// (create with capabilities, rename, refresh the API token, installation access token, delete), page ••• › Connections
// (which connections reach a page, add / remove one), connection webhook subscriptions. The public REST API itself is
// apps/server/src/publicApi/routes.ts (/v1); storage and access rules live in publicApi/store.ts + access.ts.
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { isSpaceOwner } from '../../policy.ts';
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { getRecord } from '../../db.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';
import { audit } from '../../audit.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import {
  canManage, canSee, createIntegration, creationProblem, deleteIntegration, getIntegration, grantCount, grantedBlockIds, IntegrationError, integrationsInSpace,
  newInstallationToken, ownerName, refreshToken, requestStats, updateIntegration, type Integration,
} from '../../publicApi/store.ts';
import { addPageConnection, addableConnections, blockLabel, grantRole, pageConnections, removePageConnection } from '../../publicApi/access.ts';
import {
  ALL_EVENTS, DATA_SOURCE_EVENTS, createWebhook, deleteWebhook, listWebhooks, resendVerification, updateWebhook, verifyWebhook, webhookFailures, webhooksEnabled,
} from '../../publicApi/webhooks.ts';
import '../../publicApi/access.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

function wrap<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof IntegrationError) throw new ApiError(e.message, e.status);
    throw e;
  }
}

async function wrapAsync<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof IntegrationError) throw new ApiError(e.message, e.status);
    throw e;
  }
}

function member(spaceId: unknown, userId: string): SpaceRecord {
  const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
  if (!space || !isSpaceMember(space, userId)) throw new ApiError('Not found', 404);
  return space;
}

/** What the Connections lists show (never the token). */
function view(i: Integration, userId: string) {
  return {
    id: i.id, name: i.name, icon: i.icon, botId: i.botId, ownerId: i.ownerId, ownerName: ownerName(i), capabilities: i.capabilities,
    tokenPrefix: i.tokenPrefix, tokenRefreshedTime: i.tokenRefreshedTime, installTokenPrefix: i.installTokenPrefix, installTokenTime: i.installTokenTime,
    createdTime: i.createdTime, lastUsedTime: i.lastUsedTime, pageCount: grantCount(i.id), canManage: canManage(i, userId), spaceId: i.spaceId,
  };
}

function users(userId: string, ids: string[]) {
  const rm = new RecordMapBuilder(userId);
  for (const id of new Set(ids)) rm.add('lit_user', getRecord<UserRecord>('lit_user', id));
  return rm.map;
}

function visible(connectionId: unknown, userId: string): Integration {
  const i = getIntegration(String(connectionId ?? ''));
  if (!i || !canSee(i, userId)) throw new ApiError('Connection could not be found', 404);
  return i;
}

const describeCaps = (i: Integration) => Object.entries(i.capabilities).filter(([, v]) => v === true).map(([k]) => k).join(', ') + `, user info: ${i.capabilities.user_info}`;

export const handlers: Record<string, Handler> = {
  /** Settings › Connections (Manage) and the Developer tools "Connections" list. */
  devListConnections(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = member(spaceId, uid);
    const list = integrationsInSpace(space.id).filter((i) => canSee(i, uid));
    return {
      connections: list.map((i) => view(i, uid)),
      canCreate: creationProblem(space.id, uid) === null,
      createProblem: creationProblem(space.id, uid),
      admin: isSpaceOwner(space, uid),
      webhooksEnabled: webhooksEnabled(),
      recordMap: users(uid, list.flatMap((i) => [i.ownerId, i.botId])),
    };
  },

  devCreateConnection(ctx, { spaceId, name, capabilities, icon }) {
    const uid = requireUser(ctx);
    member(spaceId, uid);
    const { integration, token } = wrap(() => createIntegration({ spaceId: String(spaceId), userId: uid, name: String(name ?? ''), icon, capabilities }));
    audit('integration.created', { spaceId: integration.spaceId, actorId: uid, ip: ctx.ip, targetId: integration.id, data: { integrationName: integration.name } });
    return { connection: view(integration, uid), token, recordMap: users(uid, [uid, integration.botId]) };
  },

  devGetConnection(ctx, { connectionId }) {
    const uid = requireUser(ctx);
    const i = visible(connectionId, uid);
    const manage = canManage(i, uid);
    const rm = new RecordMapBuilder(uid);
    const pages = grantedBlockIds(i.id).map((id) => {
      const b = getRecord<BlockRecord>('block', id);
      const readable = !!b && blockRole(id, uid) !== 'none';
      if (readable) rm.add('block', b);
      return { blockId: id, title: readable ? blockLabel(id) : 'Private page', type: b?.type ?? 'page', canOpen: readable, alive: b?.alive !== false };
    });
    for (const u of [i.ownerId, i.botId]) rm.add('lit_user', getRecord<UserRecord>('lit_user', u));
    return {
      connection: view(i, uid), pages, stats: manage ? requestStats(i.id) : null,
      webhooks: manage && webhooksEnabled() ? listWebhooks(i.id, uid) : [], webhooksEnabled: webhooksEnabled(), events: ALL_EVENTS, dataSourceEvents: DATA_SOURCE_EVENTS,
      recordMap: rm.map,
    };
  },

  devUpdateConnection(ctx, { connectionId, name, capabilities, icon }) {
    const uid = requireUser(ctx);
    const before = visible(connectionId, uid);
    const i = wrap(() => updateIntegration(before.id, uid, { name, capabilities, icon }));
    if (capabilities !== undefined && JSON.stringify(before.capabilities) !== JSON.stringify(i.capabilities)) {
      audit('integration.permission.updated', { spaceId: i.spaceId, actorId: uid, ip: ctx.ip, targetId: i.id, data: { integrationName: i.name, botCapabilities: describeCaps(i) } });
    }
    if ((name !== undefined && before.name !== i.name) || (icon !== undefined && before.icon !== i.icon)) {
      audit('integration.settings.updated', { spaceId: i.spaceId, actorId: uid, ip: ctx.ip, targetId: i.id, data: { integrationName: i.name } });
    }
    return { connection: view(i, uid), recordMap: users(uid, [i.botId]) };
  },

  /** "Refresh API token": shown once. */
  devRefreshConnectionToken(ctx, { connectionId }) {
    const uid = requireUser(ctx);
    const r = wrap(() => refreshToken(visible(connectionId, uid).id, uid));
    audit('integration.secret_reset', { spaceId: r.integration.spaceId, actorId: uid, ip: ctx.ip, targetId: r.integration.id, data: { integrationName: r.integration.name } });
    return { connection: view(r.integration, uid), token: r.token };
  },

  /** ••• › Copy installation access token : a fresh token each time (the previous one stops working). */
  devInstallationToken(ctx, { connectionId }) {
    const uid = requireUser(ctx);
    const r = wrap(() => newInstallationToken(visible(connectionId, uid).id, uid));
    return { connection: view(r.integration, uid), token: r.token };
  },

  devDeleteConnection(ctx, { connectionId }) {
    const uid = requireUser(ctx);
    const i = wrap(() => deleteIntegration(visible(connectionId, uid).id, uid));
    audit('integration.deleted', { spaceId: i.spaceId, actorId: uid, ip: ctx.ip, targetId: i.id, data: { integrationName: i.name } });
    return { ok: true };
  },

  /** Page ••• › Connections: connections that reach the page (direct / inherited) and the workspace's others. */
  devPageConnections(ctx, { pageId }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || blockRole(page.id, uid) === 'none') throw new ApiError('Not found', 404);
    const space = getRecord<SpaceRecord>('space', page.space_id);
    const connected = pageConnections(page.id, uid);
    const member = isSpaceMember(space, uid);
    const addable = member ? addableConnections(page.space_id, uid).filter((i) => !connected.some((c) => c.integrationId === i.id)) : [];
    return {
      connections: connected,
      addable: addable.map((i) => ({ id: i.id, name: i.name, icon: i.icon, botId: i.botId })),
      canManage: blockRole(page.id, uid) === 'editor',
      recordMap: users(uid, [...connected.map((c) => getIntegration(c.integrationId)?.botId ?? ''), ...addable.map((i) => i.botId)].filter(Boolean)),
    };
  },

  devAddPageConnection(ctx, { pageId, connectionId }) {
    const uid = requireUser(ctx);
    const i = wrap(() => addPageConnection(uid, String(connectionId ?? ''), String(pageId ?? '')));
    audit('page_permission_updated', { spaceId: i.spaceId, actorId: uid, ip: ctx.ip, targetId: String(pageId), data: { integrationName: i.name, change: 'connection_added', userId: i.botId, oldRole: 'none', newRole: grantRole(i.capabilities) } });
    return { connections: pageConnections(String(pageId), uid) };
  },

  devRemovePageConnection(ctx, { pageId, connectionId }) {
    const uid = requireUser(ctx);
    const i = wrap(() => removePageConnection(uid, String(connectionId ?? ''), String(pageId ?? '')));
    audit('page_permission_updated', { spaceId: i.spaceId, actorId: uid, ip: ctx.ip, targetId: String(pageId), data: { integrationName: i.name, change: 'connection_removed', userId: i.botId, oldRole: grantRole(i.capabilities), newRole: 'none' } });
    return { connections: pageConnections(String(pageId), uid) };
  },

  // ---------------------------------------------------------------- webhooks 

  devListWebhooks(ctx, { connectionId }) {
    const uid = requireUser(ctx);
    const i = visible(connectionId, uid);
    return { webhooks: wrap(() => listWebhooks(i.id, uid)), enabled: webhooksEnabled() };
  },

  async devCreateWebhook(ctx, { connectionId, url, eventTypes, apiVersion }) {
    const uid = requireUser(ctx);
    const i = visible(connectionId, uid);
    const webhook = await wrapAsync(() => createWebhook({ integrationId: i.id, userId: uid, url, eventTypes, apiVersion }));
    return { webhook };
  },

  devVerifyWebhook(ctx, { webhookId, token }) {
    const uid = requireUser(ctx);
    return { webhook: wrap(() => verifyWebhook(String(webhookId ?? ''), uid, token)) };
  },

  async devResendWebhookToken(ctx, { webhookId }) {
    const uid = requireUser(ctx);
    return wrapAsync(() => resendVerification(String(webhookId ?? ''), uid));
  },

  devUpdateWebhook(ctx, { webhookId, status, eventTypes, url }) {
    const uid = requireUser(ctx);
    return { webhook: wrap(() => updateWebhook(String(webhookId ?? ''), uid, { status, eventTypes, url })) };
  },

  devDeleteWebhook(ctx, { webhookId }) {
    const uid = requireUser(ctx);
    wrap(() => deleteWebhook(String(webhookId ?? ''), uid));
    return { ok: true };
  },

  devWebhookFailures(ctx, { webhookId }) {
    const uid = requireUser(ctx);
    return { failures: wrap(() => webhookFailures(String(webhookId ?? ''), uid)) };
  },
};

// Sharing & publishing (SHR/PUB): access list for the Share tab, invites by email (members or guests),
// published-site info for /public pages, and "Duplicate" of a public page into the visitor's workspace.
// Permission edits themselves (role changes, general access, publish settings) are client transactions on
// block.permissions; publishing is a `public_permission` with `published: true` (see packages/shared records).
import { newId } from '@nc/shared/ids.ts';
import { isRestrictedMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type {
  BlockRecord, CollectionRecord, Permission, Role, SpaceRecord, SpaceViewRecord, TeamRecord, UserRootRecord,
} from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, findUserIdByEmail, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, TransactionError, applyTransactions, blockRole } from '../../records.ts';
import { createUser } from '../../seed.ts';
import { TreeCopier, assertCopyBudget } from '../../dbcopy.ts';
import { pushNotification } from './notifications.ts';
import { restrictedPageAddProblem } from '../../policy.ts';

type Handler = (ctx: Ctx, body: any) => any;

const RANK: Record<string, number> = { none: 0, reader: 1, comment_only: 2, content_only_editor: 2.5, read_and_write: 3, editor: 4 };
// the Free plan's guest limit is enforced for every permission write by the transaction guard (policy.ts); Invite checks
// it before creating placeholder accounts
export { FREE_GUEST_LIMIT, workspaceGuests } from '../../policy.ts';
import { FREE_GUEST_LIMIT, workspaceGuests } from '../../policy.ts';
const PAGE_ROLES = new Set(['editor', 'read_and_write', 'content_only_editor', 'comment_only', 'reader']);

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

/** Block ancestors (nearest first), crossing database rows → database block. */
export function blockAncestors(b: BlockRecord): BlockRecord[] {
  const out: BlockRecord[] = [];
  let cur: BlockRecord | undefined = b;
  for (let i = 0; i < 60 && cur; i++) {
    if (cur.parent_table === 'block') cur = getRecord<BlockRecord>('block', cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const col = getRecord<CollectionRecord>('collection', cur.parent_id);
      cur = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
    } else break;
    if (cur) out.push(cur);
  }
  return out;
}

const isLivePublic = (p: Permission) => p.type === 'public_permission' && (!p.expiry_time || p.expiry_time > Date.now());

/** Publish (Sites) permission on the page or the nearest published ancestor. */
export function publishedRoot(page: BlockRecord): { block: BlockRecord; perm: Permission } | null {
  for (const b of [page, ...blockAncestors(page)]) {
    const perm = (b.permissions ?? []).find((p) => isLivePublic(p) && p.published);
    if (perm) return { block: b, perm };
  }
  return null;
}

function title(b: BlockRecord | undefined): string {
  if (!b) return '';
  if (b.type === 'collection_view_page' && b.collection_id) {
    const col = getRecord<CollectionRecord>('collection', b.collection_id);
    const t = toPlainText(col?.name as any);
    if (t) return t;
  }
  return toPlainText(b.properties?.title);
}

function generalAccess(chain: BlockRecord[], space: SpaceRecord | undefined) {
  for (const b of chain) {
    const pub = (b.permissions ?? []).find((p) => p.type === 'public_permission' && !p.published);
    if (pub) return { kind: 'public' as const, role: pub.role, expiry: pub.expiry_time ?? null, expired: !!pub.expiry_time && pub.expiry_time < Date.now(), sourceId: b.id };
    const sp = (b.permissions ?? []).find((p) => p.type === 'space_permission' && p.role !== 'none');
    if (sp) return { kind: 'workspace' as const, role: sp.role, sourceId: b.id };
    const tp = (b.permissions ?? []).find((p) => p.type === 'team_permission' && p.team_id && p.role !== 'none');
    if (tp) {
      const team = getRecord<TeamRecord>('team', tp.team_id!);
      return { kind: 'team' as const, role: tp.role, teamId: team?.id ?? null, teamName: team?.name ?? '', teamIcon: team?.icon ?? '', memberCount: team?.membership?.length ?? 0, sourceId: b.id };
    }
  }
  const root = chain[chain.length - 1];
  if (root?.parent_table === 'space' && !(root.permissions?.length)) {
    // legacy workspace-level pages: every member gets their workspace role
    return { kind: 'workspace' as const, role: 'read_and_write' as Role, sourceId: root.id, implicit: true };
  }
  if (root?.parent_table === 'team') {
    const team = getRecord<TeamRecord>('team', root.parent_id);
    return { kind: 'team' as const, role: (team?.settings?.default_page_role as Role) ?? 'editor', teamId: team?.id ?? null, teamName: team?.name ?? '', teamIcon: team?.icon ?? '', memberCount: team?.membership?.length ?? 0, sourceId: root.id };
  }
  void space;
  return { kind: 'private' as const, role: 'none' as Role, sourceId: null };
}

/**
 * Deep copy of a page subtree (nested pages and databases included) into another location, as the duplicating person
 * sees it (dbcopy.ts TreeCopier): nested pages restricted from them, database rows they can't open and values of
 * properties they can't see (property access) stay behind; schemas lose the properties they have no access to.
 */
function copyTreeOps(src: BlockRecord, target: { spaceId: string; parentId: string; parentTable: 'space' | 'block'; permissions?: Permission[] }, uid: string) {
  const copier = new TreeCopier(uid, target.spaceId, { rows: true });
  let rootId: string;
  try {
    rootId = copier.block(src, target.parentId, target.parentTable, target.permissions ? { permissions: target.permissions } : {});
    assertCopyBudget(uid, copier.count);
  } catch (e) {
    if (e instanceof TransactionError) throw new ApiError(e.message, e.status);
    throw e;
  }
  const ops: any[] = [...copier.finish().values()].map((e) => ({ pointer: { table: e.table, id: e.record.id, spaceId: target.spaceId }, path: [], command: 'set', args: e.record }));
  return { rootId, ops };
}

export const handlers: Record<string, Handler> = {
  /** Share tab model: people with access (explicit + inherited), general access, publish state. */
  getPageSharing(ctx, { pageId }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    const myRole = page ? blockRole(page.id, uid) : 'none';
    if (!page || myRole === 'none') throw new ApiError('Not found', 404);
    const space = getRecord<SpaceRecord>('space', page.space_id);
    const fullChain = [page, ...blockAncestors(page)];
    // an "unlinked" page (restricted) doesn't inherit from above it
    const cut = fullChain.findIndex((b) => (b as any).permissions_unlinked);
    const chain = cut >= 0 ? fullChain.slice(0, cut + 1) : fullChain;
    const users = new Map<string, { userId: string; role: string; sourceId: string; inherited: boolean }>();
    for (const b of chain) {
      for (const p of b.permissions ?? []) {
        // database "Can only create" = role none + can_create_pages_in_collection 
        if (p.type !== 'user_permission' || !p.user_id || (p.role === 'none' && !p.can_create_pages_in_collection)) continue;
        const prev = users.get(p.user_id);
        if (!prev || (RANK[p.role] ?? 0) > (RANK[prev.role] ?? 0)) users.set(p.user_id, { userId: p.user_id, role: p.role, sourceId: b.id, inherited: b.id !== page.id });
      }
    }
    // group sharing : groups with access (explicit on the page or inherited)
    const spaceGroups = ((space?.settings as { groups?: { id: string; name: string; member_ids?: string[] }[] } | undefined)?.groups ?? []).filter((g) => g && g.id);
    const groupRows = new Map<string, { groupId: string; name: string; memberCount: number; role: string; sourceId: string; inherited: boolean }>();
    for (const b of chain) {
      for (const p of b.permissions ?? []) {
        if (p.type !== 'group_permission' || !p.group_id || p.role === 'none') continue;
        const g = spaceGroups.find((x) => x.id === p.group_id);
        if (!g) continue;
        const prev = groupRows.get(g.id);
        if (!prev || (RANK[p.role] ?? 0) > (RANK[prev.role] ?? 0)) groupRows.set(g.id, { groupId: g.id, name: g.name, memberCount: g.member_ids?.length ?? 0, role: p.role, sourceId: b.id, inherited: b.id !== page.id });
      }
    }
    const allMemberIds = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
    // the workspace member directory (invite suggestions) is for members; guests only see who has access to this page
    const memberIds = allMemberIds.includes(uid) ? allMemberIds : [];
    const rm = new RecordMapBuilder(uid);
    for (const id of new Set([...users.keys(), ...memberIds, uid])) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    for (const b of fullChain) rm.add('block', b);
    const pub = publishedRoot(page);
    const ga = generalAccess(chain, space);
    if (ga.kind === 'team' && ga.teamId) rm.add('team', getRecord<TeamRecord>('team', ga.teamId));
    // restricted members: "Restricted member" badge in the people list and invite suggestions
    const list = [...users.values()].map((u) => ({ ...u, isGuest: !allMemberIds.includes(u.userId), isRestricted: isRestrictedMember(space, u.userId), sourceTitle: title(getRecord<BlockRecord>('block', u.sourceId)) }));
    // unlinked page : what it was unlinked from — the nearest parent page/database, else its teamspace
    let unlinkedFrom: { kind: 'page' | 'teamspace'; id: string; title: string } | null = null;
    if ((page as any).permissions_unlinked) {
      const anc = fullChain.slice(1).find((b) => b.type === 'page' || b.type === 'collection_view_page' || b.type === 'collection_view');
      const root = fullChain[fullChain.length - 1];
      const team = root.parent_table === 'team' ? getRecord<TeamRecord>('team', root.parent_id) : undefined;
      if (anc) unlinkedFrom = { kind: 'page', id: anc.id, title: title(anc) };
      else if (team) unlinkedFrom = { kind: 'teamspace', id: team.id, title: team.name ?? '' };
    }
    // the current user first, then by role
    list.sort((a, b) => (a.userId === uid ? -1 : b.userId === uid ? 1 : (RANK[b.role] ?? 0) - (RANK[a.role] ?? 0)));
    return {
      pageId: page.id, myRole, canManage: roleAtLeast(myRole, 'editor'), unlinked: !!(page as any).permissions_unlinked, unlinkedFrom,
      users: list, memberIds, generalAccess: ga,
      restrictedIds: memberIds.filter((id) => isRestrictedMember(space, id)),
      // Security › "Who can add restricted members to pages": why this person can't add one directly (null = allowed)
      restrictedAddProblem: space && memberIds.length ? restrictedPageAddProblem(space, uid) : null,
      groups: [...groupRows.values()],
      // groups members can share with (Share › "Email or group")
      availableGroups: allMemberIds.includes(uid) ? spaceGroups.map((g) => ({ groupId: g.id, name: g.name, memberCount: g.member_ids?.length ?? 0 })) : [],
      published: pub ? {
        pageId: pub.block.id, inherited: pub.block.id !== page.id, sourceTitle: title(pub.block),
        allowDuplicate: !!pub.perm.allow_duplicate, searchIndexing: !!pub.perm.allow_search_engine_indexing,
        expiry: pub.perm.expiry_time ?? null, publishedTime: pub.perm.published_time ?? pub.perm.added_timestamp ?? null,
      } : null,
      space: { id: space?.id, name: space?.name, domain: space?.domain, icon: space?.icon, allowPublic: (space?.settings as any)?.allow_public_pages !== false },
      recordMap: rm.map,
    };
  },

  /** Share › "Email or group, separated by commas" → Invite. Unknown emails become placeholder accounts (guests). */
  invitePagePermissions(ctx, { pageId, emails, userIds, groupIds, role }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || blockRole(page.id, uid) === 'none') throw new ApiError('Not found', 404);
    if (!roleAtLeast(blockRole(page.id, uid), 'editor')) throw new ApiError('Only people with full access can add others.', 403);
    const r = PAGE_ROLES.has(String(role)) ? (role as Role) : 'editor';
    const targets: string[] = [];
    for (const raw of (Array.isArray(emails) ? emails : []).slice(0, 100)) {
      const email = String(raw).trim().toLowerCase();
      if (!email) continue;
      if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(`"${email}" is not a valid email address.`);
      let id = findUserIdByEmail(email);
      if (!id) {
        id = newId();
        createUser(id, email);
      }
      if (!targets.includes(id)) targets.push(id);
    }
    for (const id of (Array.isArray(userIds) ? userIds : []).slice(0, 100)) if (getRecord('lit_user', String(id)) && !targets.includes(String(id))) targets.push(String(id));
    // groups of this workspace (members only share with groups)
    const space = getRecord<SpaceRecord>('space', page.space_id);
    const spaceGroups = ((space?.settings as { groups?: { id: string; member_ids?: string[] }[] } | undefined)?.groups ?? []);
    const groups = [...new Set((Array.isArray(groupIds) ? groupIds : []).map(String))].filter((gid) => spaceGroups.some((g) => g?.id === gid)).slice(0, 50);
    if (groups.length && !(space?.permissions ?? []).some((p) => p.user_id === uid && p.role !== 'none')) throw new ApiError('Only workspace members can share with groups.', 403);
    if (!targets.length && !groups.length) throw new ApiError('Enter an email address to invite.');
    // Free plan: at most FREE_GUEST_LIMIT guests in the workspace 
    if (space?.plan_type === 'free') {
      const members = new Set((space.permissions ?? []).filter((p) => p.type === 'user_permission' && p.role !== 'none').map((p) => p.user_id));
      const newGuests = targets.filter((id) => !members.has(id));
      if (newGuests.length) {
        const existing = workspaceGuests(space.id, members);
        const total = new Set([...existing, ...newGuests]).size;
        if (total > FREE_GUEST_LIMIT) throw new ApiError(`Sharing would exceed this workspace’s guest limit (${FREE_GUEST_LIMIT} on the Free plan).`, 403);
      }
    }
    const now = Date.now();
    const perms = (page.permissions ?? []).filter((p) => !(p.type === 'user_permission' && p.user_id && targets.includes(p.user_id)) && !(p.type === 'group_permission' && p.group_id && groups.includes(p.group_id)));
    for (const id of targets) perms.push({ type: 'user_permission', role: r, user_id: id, added_timestamp: now });
    for (const gid of groups) perms.push({ type: 'group_permission', role: r, group_id: gid, added_timestamp: now });
    // group members hear about it like individual invitees
    for (const gid of groups) for (const m of spaceGroups.find((g) => g.id === gid)?.member_ids ?? []) if (!targets.includes(m) && getRecord('lit_user', m)) targets.push(m);
    const changes = applyTransactions(uid, [{
      id: newId(), spaceId: page.space_id, debug: { userAction: 'invitePagePermissions' },
      operations: [{ pointer: { table: 'block', id: page.id, spaceId: page.space_id }, path: [], command: 'update', args: { permissions: perms } }],
    }], ctx.clientId);
    for (const id of targets) {
      if (id === uid) continue;
      pushNotification({ user_id: id, space_id: page.space_id, type: 'invite', navigable_block_id: page.id, actor_id: uid, activity: { page_id: page.id, role: r, title: title(page) } });
    }
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    for (const id of targets) rm.add('lit_user', getRecord('lit_user', id), 'reader');
    return { userIds: targets, recordMap: rm.map };
  },

  /**
   * Restrict a sub-page : "unlink" it from its parent so it stops inheriting share settings
   * (restrictedPermissionConfirmationModal). The access people have today is copied onto the page (people, groups,
   * workspace, teamspace members, owners) — minus the person/group being removed — and the caller keeps full access.
   * The same call can change one inherited entry instead ("Change and unlink"): userId/groupId + role, or general
   * access ('private' drops workspace + teamspace access, 'workspace' sets the workspace role to generalRole).
   */
  restrictPageAccess(ctx, { pageId, removeUserId, removeGroupId, userId, groupId, role, general, generalRole }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || page.alive === false || blockRole(page.id, uid) === 'none') throw new ApiError('Not found', 404);
    if (blockRole(page.id, uid) !== 'editor') throw new ApiError('Only those with full access can change sharing.', 403);
    const newRole = PAGE_ROLES.has(String(role)) ? (role as Role) : null;
    const gaRole = PAGE_ROLES.has(String(generalRole)) ? (generalRole as Role) : 'read_and_write';
    const change = !!(removeUserId || removeGroupId || (userId && newRole) || (groupId && newRole) || general === 'private' || general === 'workspace');
    if ((page as any).permissions_unlinked && !change) return { unlinked: true, recordMap: {} };
    const chain = [page, ...blockAncestors(page)];
    const merged = new Map<string, Permission>();
    const keep = (key: string, p: Permission) => {
      const prev = merged.get(key);
      if (!prev || (RANK[p.role] ?? 0) > (RANK[prev.role] ?? 0)) merged.set(key, { ...p });
    };
    for (const b of chain) {
      for (const p of b.permissions ?? []) {
        if (!p || p.role === 'none') continue;
        if (p.type === 'user_permission' && p.user_id) keep(`u:${p.user_id}`, p);
        else if (p.type === 'group_permission' && p.group_id) keep(`g:${p.group_id}`, p);
        else if (p.type === 'space_permission') keep('space', p);
        else if (p.type === 'team_permission' && p.team_id) keep(`t:${p.team_id}`, p);
        else if (p.type === 'public_permission' && b.id === page.id) keep(p.published ? 'pub:site' : 'pub:link', p);
      }
      if ((b as any).permissions_unlinked) break;
    }
    const root = chain[chain.length - 1];
    if (!(root as any).permissions_unlinked) {
      if (root.parent_table === 'team') {
        const team = getRecord<TeamRecord>('team', root.parent_id);
        if (team) {
          keep(`t:${team.id}`, { type: 'team_permission', team_id: team.id, role: (team.settings?.default_page_role as Role) ?? 'editor' });
          for (const m of team.membership ?? []) if (m.role === 'owner') keep(`u:${m.user_id}`, { type: 'user_permission', user_id: m.user_id, role: 'editor' });
          if ((team.settings?.type ?? 'open') === 'open') keep('space', { type: 'space_permission', role: ((team.settings?.workspace_page_role as Role) ?? 'read_and_write') });
        }
      } else if (root.parent_table === 'space' && !(root.permissions ?? []).length) {
        keep('space', { type: 'space_permission', role: 'editor' });
      }
    }
    if (removeUserId) merged.delete(`u:${String(removeUserId)}`);
    if (removeGroupId) merged.delete(`g:${String(removeGroupId)}`);
    const now = Date.now();
    // "Change and unlink" for one inherited person / group (never the caller: they keep full access below)
    if (userId && newRole && String(userId) !== uid && getRecord('lit_user', String(userId))) merged.set(`u:${String(userId)}`, { type: 'user_permission', user_id: String(userId), role: newRole, added_timestamp: now });
    if (groupId && newRole && merged.has(`g:${String(groupId)}`)) merged.set(`g:${String(groupId)}`, { ...merged.get(`g:${String(groupId)}`)!, role: newRole });
    if (general === 'private') {
      merged.delete('space');
      for (const k of [...merged.keys()]) if (k.startsWith('t:')) merged.delete(k);
    } else if (general === 'workspace') {
      merged.set('space', { type: 'space_permission', role: gaRole, added_timestamp: now });
    }
    merged.set(`u:${uid}`, { type: 'user_permission', user_id: uid, role: 'editor', added_timestamp: now });
    const next = [...merged.values()];
    const own = (page as any).permissions_unlinked ? (page as any).permissions_pre_unlink ?? [] : page.permissions ?? [];
    const changes = applyTransactions(uid, [{
      id: newId(), spaceId: page.space_id, debug: { userAction: 'restrictPageAccess' },
      operations: [{ pointer: { table: 'block', id: page.id, spaceId: page.space_id }, path: [], command: 'update', args: { permissions: next, permissions_unlinked: true, permissions_pre_unlink: own } }],
    }], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { unlinked: true, permissions: next.length, recordMap: rm.map };
  },

  /** "Restore inherited access": re-link the page to its parent's share settings (activity.restorePermissionsForActivity). */
  restoreInheritedAccess(ctx, { pageId }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || blockRole(page.id, uid) !== 'editor') throw new ApiError('Only those with full access can change sharing.', 403);
    if (!(page as any).permissions_unlinked) return { unlinked: false, recordMap: {} };
    const own = ((page as any).permissions_pre_unlink ?? []) as Permission[];
    const changes = applyTransactions(uid, [{
      id: newId(), spaceId: page.space_id, debug: { userAction: 'restoreInheritedAccess' },
      operations: [{ pointer: { table: 'block', id: page.id, spaceId: page.space_id }, path: [], command: 'update', args: { permissions: own, permissions_unlinked: null, permissions_pre_unlink: null } }],
    }], ctx.clientId);
    const rm = new RecordMapBuilder(uid);
    for (const ch of changes) rm.add(ch.table, ch.record);
    return { unlinked: false, recordMap: rm.map };
  },

  /** Public (published or "anyone with link") page bootstrap for /public/<id>; works without a session. */
  getPublishedPage(ctx, { pageId }) {
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || !page.alive) throw new ApiError('Not found', 404);
    const role = blockRole(page.id, ctx.userId);
    if (role === 'none') throw new ApiError('Not found', 404);
    const space = getRecord<SpaceRecord>('space', page.space_id);
    const pub = publishedRoot(page);
    const chain = [page, ...blockAncestors(page)];
    // breadcrumb inside the site (from the published root down to this page)
    const crumbs: { id: string; title: string; icon: string | null }[] = [];
    for (const b of chain) {
      crumbs.unshift({ id: b.id, title: title(b), icon: (b.format?.page_icon as string) ?? null });
      if (pub && b.id === pub.block.id) break;
    }
    const rm = new RecordMapBuilder(ctx.userId);
    for (const b of chain) rm.add('block', b);
    rm.add('lit_user', getRecord('lit_user', page.created_by_id), 'reader');
    let member = false;
    if (ctx.userId) member = !!space?.permissions?.some((p) => p.user_id === ctx.userId && p.role !== 'none');
    return {
      pageId: page.id, role, published: !!pub, siteRootId: pub?.block.id ?? null,
      allowDuplicate: !!pub?.perm.allow_duplicate, searchIndexing: !!pub?.perm.allow_search_engine_indexing,
      spaceName: space?.name ?? '', spaceDomain: space?.domain ?? '', spaceIcon: space?.icon ?? '',
      breadcrumb: pub ? crumbs.filter((c, i) => i > 0 || c.id === pub.block.id) : crumbs.slice(-1),
      loggedIn: !!ctx.userId, isMember: member,
      recordMap: rm.map,
    };
  },

  /** "Duplicate" on a public page (Duplicate as template): deep copy into the visitor's Private section. */
  duplicatePublicPage(ctx, { pageId, spaceId }) {
    const uid = requireUser(ctx);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    if (!page || !page.alive) throw new ApiError('Not found', 404);
    const role = blockRole(page.id, uid);
    const pub = publishedRoot(page);
    if (role === 'none' || (!roleAtLeast(role, 'read_and_write') && !pub?.perm.allow_duplicate)) throw new ApiError('This page can’t be duplicated.', 403);
    const root = getRecord<UserRootRecord>('user_root', uid);
    const views = (root?.space_views ?? []).map((id) => getRecord<SpaceViewRecord>('space_view', id)).filter((v): v is SpaceViewRecord => !!v && v.alive !== false);
    const sv = views.find((v) => v.space_id === spaceId) ?? views[0];
    if (!sv) throw new ApiError('Create a workspace to duplicate this page.', 400);
    const { rootId, ops } = copyTreeOps(page, {
      spaceId: sv.space_id, parentId: sv.space_id, parentTable: 'space',
      permissions: [{ type: 'user_permission', role: 'editor', user_id: uid, added_timestamp: Date.now() }],
    }, uid);
    ops.push({ pointer: { table: 'space_view', id: sv.id, spaceId: sv.space_id }, path: ['private_pages'], command: 'listBefore', args: { id: rootId } });
    applyTransactions(uid, [{ id: newId(), spaceId: sv.space_id, debug: { userAction: 'duplicatePublicPage' }, operations: ops }], ctx.clientId);
    return { blockId: rootId, spaceId: sv.space_id };
  },
};

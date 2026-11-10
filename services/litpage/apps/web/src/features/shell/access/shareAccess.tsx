
// rendered by features/page/ShareMenu.tsx:



//    from …" banner with Relink (restoreInheritedAccess)


import type { BlockRecord, Permission, Role, UserRecord } from '@nc/shared/records.ts';
import { openMenu, type MenuDef, type MenuItemDef, type MenuSectionDef } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { api } from '../../../lib/api.ts';
import { getBlock, run } from '../../../lib/blocks.ts';
import { useBlock } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { confirmDialog } from '../../page/confirm.tsx';
import { Toggle } from '../../database/properties/editors/DatePicker.tsx';
import { t } from '../i18n.ts';
import './access.css';

export interface ShareGroup { groupId: string; name: string; memberCount: number; role: string; sourceId: string; inherited: boolean }

/** The parts of getPageSharing's answer used here (ShareMenu's model carries them). */
export interface ShareExtrasModel {
  pageId: string;
  canManage: boolean;
  memberIds?: string[];
  unlinked?: boolean;
  unlinkedFrom?: { kind: 'page' | 'teamspace'; id: string; title: string } | null;
  groups?: ShareGroup[];
  availableGroups?: { groupId: string; name: string; memberCount: number }[];
  generalAccess?: { kind: string; role: string; sourceId: string | null };
}

const RANK: Record<string, number> = { none: 0, reader: 1, comment_only: 2, content_only_editor: 2.5, read_and_write: 3, editor: 4 };
const GROUP_ROLES = ['editor', 'read_and_write', 'comment_only', 'reader'] as const;

function roleLabel(r: string): string {
  switch (r) {
    case 'editor': return t('lp.shell.full_access', 'Full access');
    case 'read_and_write': return t('lp.shell.can_edit', 'Can edit');
    case 'comment_only': return t('lp.shell.can_comment', 'Can comment');
    case 'content_only_editor': return t('lp.shell.can_edit_the_content', 'Can edit the content');
    case 'reader': return t('lp.shell.can_view', 'Can view');
    default: return t('lp.shell.no_access', 'No access');
  }
}

function roleCaption(r: string): string | undefined {
  switch (r) {
    case 'editor': return t('lp.shell.editing_suggestions_comments_and_sharing', 'Editing, suggestions, comments, and sharing');
    case 'read_and_write': return t('lp.shell.editing_suggestions_and_comments', 'Editing, suggestions, and comments');
    case 'comment_only': return t('lp.shell.suggest_or_comment', 'Suggest or comment');
    default: return undefined;
  }
}

/** A dropdown inside the Share menu: picking closes only the dropdown. */
function openDropdown(anchor: HTMLElement, def: MenuDef) {
  let close: () => void = () => {};
  const wrap = (items: MenuItemDef[]): MenuItemDef[] => items.map((it) => (it.onSelect && !it.submenu
    ? { ...it, onSelect: () => { close(); setTimeout(() => void it.onSelect!(), 0); return false; } }
    : it));
  close = openMenu(anchor, { ...def, sections: def.sections.map((s) => ({ ...s, items: wrap(s.items) })) }, { placement: 'bottom-end' });
}

function fail(e: unknown) {
  useUI.getState().toast((e as Error)?.message || t('lp.shell.couldn_t_process_the_invite', 'Couldn’t process the invite'));
}



function confirmUnlink(): Promise<boolean> {
  return confirmDialog({
    message: t('lp.shell.change_access_and_unlink_inherited_shari', 'Change access and unlink inherited sharing settings?'),
    description: t('lp.shell.this_removes_the_page_s_link', 'This removes the page’s link to its parent, so it stops inheriting sharing settings. Admins can still restore settings on unlinked pages.'),
    confirmLabel: t('lp.shell.change_then_unlink', 'Change, then unlink'),
    width: 340,
  });
}

/** Change or remove access that comes from a parent page / the teamspace: confirm, then unlink the page with the change. */
export async function changeInheritedAccess(pageId: string, target: { userId?: string; groupId?: string; general?: 'private' | 'workspace' }, role: string): Promise<boolean> {
  if (!(await confirmUnlink())) return false;
  const body: Record<string, unknown> = { pageId };
  if (target.userId) Object.assign(body, role === 'remove' ? { removeUserId: target.userId } : { userId: target.userId, role });
  if (target.groupId) Object.assign(body, role === 'remove' ? { removeGroupId: target.groupId } : { groupId: target.groupId, role });
  if (target.general) Object.assign(body, { general: target.general, generalRole: role });
  try {
    const r = await api<{ recordMap?: unknown }>('restrictPageAccess', body);
    if (r.recordMap) records.mergeRecordMap(r.recordMap as never);
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}

/**
 * ShareMenu › General access picks on a page whose general access is inherited (parent page or teamspace): narrowing
 * it there would do nothing (access is the union of the parents'), so it becomes "Change and unlink". Returns true
 * when handled here.
 */
export function restrictGeneralAccess(model: ShareExtrasModel, kind: 'private' | 'workspace' | 'public', role?: string): boolean {
  const ga = model.generalAccess;
  if (!ga) return false;
  const inherited = ga.kind === 'team' || (!!ga.sourceId && ga.sourceId !== model.pageId);
  if (!inherited) return false;
  if (kind === 'private' && ga.kind !== 'private') {
    void changeInheritedAccess(model.pageId, { general: 'private' }, 'reader');
    return true;
  }
  const r = role ?? 'read_and_write';
  if (kind === 'workspace' && (ga.kind === 'public' || (ga.kind === 'workspace' && (RANK[r] ?? 0) < (RANK[ga.role] ?? 0)))) {
    void changeInheritedAccess(model.pageId, { general: 'workspace' }, r);
    return true;
  }
  return false;
}

/** "Share settings on this page are unlinked from the parent page …" + Relink (restoreInheritedAccess). */
export function UnlinkedBanner({ model }: { model: ShareExtrasModel }) {
  const page = useBlock(model.pageId);
  if (!model.unlinked) return null;
  const isDb = page?.type === 'collection_view_page' || page?.type === 'collection_view';
  const from = model.unlinkedFrom;
  const text = from?.kind === 'teamspace'
    ? (isDb
      ? t('lp.shell.this_database_s_sharing_settings_no', 'This database’s sharing settings no longer follow the {teamspaceTitle} team default', { teamspaceTitle: from.title })
      : t('lp.shell.this_page_s_sharing_settings_no', 'This page’s sharing settings no longer follow the {teamspaceTitle} team default', { teamspaceTitle: from.title }))
    : (isDb
      ? t('lp.shell.this_database_s_sharing_settings_no_c3cb', 'This database’s sharing settings no longer follow its parent page, {parentPageTitle}', { parentPageTitle: from?.title || t('lp.shell.untitled', 'Untitled') })
      : t('lp.shell.this_page_s_sharing_settings_no_0b1c', 'This page’s sharing settings no longer follow its parent page, {parentPageTitle}', { parentPageTitle: from?.title || t('lp.shell.untitled', 'Untitled') }));
  const relink = async () => {
    const ok = await confirmDialog({
      message: t('lp.shell.reconnect_sharing_settings', 'Reconnect sharing settings?'),
      description: t('lp.shell.these_settings_will_go_back_to', 'These settings will go back to matching {parentName}', { parentName: from?.title || t('lp.shell.untitled', 'Untitled') }),
      confirmLabel: t('lp.shell.relink', 'Relink'),
      danger: false,
      width: 320,
    });
    if (!ok) return;
    try {
      const r = await api<{ recordMap?: unknown }>('restoreInheritedAccess', { pageId: model.pageId });
      if (r.recordMap) records.mergeRecordMap(r.recordMap as never);
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="nc-share-banner-wrap nc-share-unlinked">
      <div className="nc-share-banner">
        <Icon name="info" size={16} style={{ color: 'var(--lp-blue-icon-primary, var(--lp-blue-text-primary))', flexShrink: 0 }} />
        <span className="text">{text}</span>
        {model.canManage && <span role="button" className="nc-share-unlinked-relink" onClick={() => void relink()}>{t('lp.shell.relink', 'Relink')}</span>}
      </div>
    </div>
  );
}



function GroupAvatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <span className="nc-share-group-avatar" style={{ width: size, height: size }} aria-hidden>
      {name.trim() ? name.trim()[0]!.toUpperCase() : <Icon name="users" size={Math.round(size * 0.5)} />}
    </span>
  );
}

const peopleCount = (n: number) => t('lp.shell.numberofgroupmembers_plural_one_member_o', '{numberOfGroupMembers, plural, one {{numberOfGroupMembers} member} other {{numberOfGroupMembers} members}}', { numberOfGroupMembers: n });

/** Groups matching the invite field ("Email or group, separated by commas"); clicking one shares the page with it. */
export function ShareGroupSuggestions({ model, query, role, onInvited }: { model: ShareExtrasModel; query: string; role: string; onInvited: () => void }) {
  const q = query.trim().toLowerCase();
  if (!q || q.includes(',') || q.includes('@') || !model.canManage) return null;
  const direct = new Set((model.groups ?? []).filter((g) => !g.inherited).map((g) => g.groupId));
  const matches = (model.availableGroups ?? []).filter((g) => !direct.has(g.groupId) && (g.name || '').toLowerCase().includes(q)).slice(0, 5);
  if (!matches.length) return null;
  const share = async (g: { groupId: string; name: string }) => {
    try {
      const r = await api<{ recordMap?: unknown }>('invitePagePermissions', { pageId: model.pageId, emails: [], groupIds: [g.groupId], role });
      if (r.recordMap) records.mergeRecordMap(r.recordMap as never);
      useUI.getState().toast(t('lp.shell.shared_with', 'Shared with {firstInvitee}', { firstInvitee: g.name }));
      onInvited();
    } catch (e) {
      fail(e);
    }
  };
  return (
    <div className="nc-share-suggestions nc-share-group-suggestions">
      {matches.map((g) => (
        <div key={g.groupId} role="button" className="nc-share-row hoverable" data-group-id={g.groupId} onMouseDown={(e) => e.preventDefault()} onClick={() => void share(g)}>
          <GroupAvatar name={g.name} size={24} />
          <div className="who"><div className="name nc-ellipsis">{g.name}</div><div className="email nc-ellipsis">{peopleCount(g.memberCount)}</div></div>
        </div>
      ))}
    </div>
  );
}

function setGroupRole(pageId: string, groupId: string, role: string | 'remove') {
  const perms = (getBlock(pageId)?.permissions ?? []) as Permission[];
  const rest = perms.filter((p) => !(p.type === 'group_permission' && p.group_id === groupId));
  const next: Permission[] = role === 'remove' ? rest : [...rest, { type: 'group_permission', group_id: groupId, role: role as Role, added_timestamp: Date.now() }];
  run(role === 'remove' ? 'removeGroupPermission' : 'updateGroupPermission', (tx) => tx.update('block', pageId, [], { permissions: next }));
}

/** Group rows under the people with access: icon, name, "N people", role dropdown (inherited → Change and unlink). */
export function ShareGroupRows({ model }: { model: ShareExtrasModel }) {
  const groups = model.groups ?? [];
  if (!groups.length) return null;
  return (
    <>
      {groups.map((g) => {
        const src = g.inherited ? getBlock(g.sourceId) : undefined;
        const pick = (r: string) => {
          if (g.inherited) void changeInheritedAccess(model.pageId, { groupId: g.groupId }, r);
          else setGroupRole(model.pageId, g.groupId, r);
        };
        const open = (anchor: HTMLElement) => {
          const sections: MenuSectionDef[] = [];
          if (src) {
            sections.push({ items: [{ label: roleLabel(g.role), disabled: true, render: () => (
              <div className="nc-menu-item-inner" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2, cursor: 'default' }}>
                <div style={{ fontSize: 14 }}>{roleLabel(g.role)}</div>
                <div style={{ fontSize: 12, color: 'var(--lp-text-secondary)' }}>{t('lp.shell.this_access_comes_from', 'This access comes from {inlineIconAndName}', { inlineIconAndName: titleOf(src) })}</div>
              </div>
            ) }] });
          }
          sections.push({ items: GROUP_ROLES.map((r) => ({ label: roleLabel(r), description: roleCaption(r), checked: r === g.role, onSelect: () => pick(r) })) });
          sections.push({ items: [{ label: t('lp.shell.remove', 'Remove'), icon: 'trash', onSelect: () => pick('remove') }] });
          openDropdown(anchor, { width: 280, sections });
        };
        return (
          <div key={g.groupId} role="button" className="nc-share-row person nc-share-group-row" data-group-id={g.groupId}>
            <GroupAvatar name={g.name} />
            <div className="who">
              <div className="name nc-ellipsis"><span className="nc-ellipsis">{g.name}</span><span className="nc-share-group-tag">{t('lp.shell.group', 'Group')}</span></div>
              <div className="email nc-ellipsis">{peopleCount(g.memberCount)}</div>
            </div>
            <div role="button" className={`nc-share-role ${model.canManage ? '' : 'disabled'}`} onClick={(e) => model.canManage && open(e.currentTarget)}>
              <span className="nc-ellipsis">{roleLabel(g.role)}</span>
              <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
          </div>
        );
      })}
    </>
  );
}

function titleOf(b: BlockRecord | undefined): string {
  const raw = b?.properties?.title;
  const s = Array.isArray(raw) ? raw.map((x) => (Array.isArray(x) ? String(x[0] ?? '') : '')).join('') : '';
  return s || t('lp.shell.untitled', 'Untitled');
}



function toggleHideInSearch(pageId: string) {
  const perms = (getBlock(pageId)?.permissions ?? []) as Permission[];
  if (!perms.some((p) => p.type === 'space_permission')) return;
  const next = perms.map((p) => (p.type === 'space_permission' ? { ...p, unlisted: p.unlisted ? undefined : true } : p));
  run('updateSpacePermissionUnlisted', (tx) => tx.update('block', pageId, [], { permissions: next }));
}

function HideInSearchSwitch({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  const on = !!page?.permissions?.some((p) => p.type === 'space_permission' && p.unlisted);
  return <Toggle on={on} decorative onChange={() => toggleHideInSearch(pageId)} />;
}

/** Extra section for the "Everyone at <workspace>" role menu when the workspace access is set on this page. */
export function hideInSearchSection(pageId: string): MenuSectionDef[] {
  if (!getBlock(pageId)?.permissions?.some((p) => p.type === 'space_permission')) return [];
  return [{ items: [{
    id: 'hide-in-search',
    label: t('lp.shell.remove_from_search', 'Remove from search'),
    description: t('lp.shell.keep_this_page_out_of_search', 'Keep this page out of search results for people without its link or prior visit'),
    right: <HideInSearchSwitch pageId={pageId} />,
    onSelect: () => toggleHideInSearch(pageId),
  }] }];
}



/**
 * The invite failed because guests can only be invited by request (Settings › Security): share with the workspace
 * members right away and send workspace owners a request for the rest. Returns true when handled.
 */
export async function requestGuestsInstead(err: unknown, ctx: { pageId: string; emails: string[]; role: string; memberIds?: string[] }): Promise<boolean> {
  if (!/must request an invitation/i.test((err as Error)?.message ?? '') || !ctx.emails.length) return false;
  const memberEmails = new Set((ctx.memberIds ?? []).map((id) => records.get<UserRecord>('lit_user', id)?.email?.toLowerCase()).filter(Boolean) as string[]);
  const members = ctx.emails.filter((e) => memberEmails.has(e.toLowerCase()));
  const guests = ctx.emails.filter((e) => !memberEmails.has(e.toLowerCase()));
  try {
    if (members.length) {
      const r = await api<{ recordMap?: unknown }>('invitePagePermissions', { pageId: ctx.pageId, emails: members, role: ctx.role });
      if (r.recordMap) records.mergeRecordMap(r.recordMap as never);
    }
    if (guests.length) await api('requestGuestInvite', { pageId: ctx.pageId, emails: guests, role: ctx.role });
  } catch (e) {
    fail(e);
    return true;
  }
  const toast = members.length && guests.length
    ? t('lp.shell.access_granted_to_numadditionalnonguesti', 'Access granted to {firstNonGuestInvitee}{numAdditionalNonGuestInvites, plural, =0 {} one { and 1 more person} other { and {numAdditionalNonGuestInvites} more people}}. {numGuestRequests, plural, one {1 guest still needs approval} other {{numGuestRequests} guests still need approval}}.', { firstNonGuestInvitee: members[0], numAdditionalNonGuestInvites: members.length - 1, numGuestRequests: guests.length })
    : guests.length > 1
      ? t('lp.shell.requested_guest_access_for_and_numadditi', 'Requested guest access for {firstInvitee} and {numAdditionalInvites, plural, one {{numAdditionalInvites} more person} other {{numAdditionalInvites} more people}}', { firstInvitee: guests[0], numAdditionalInvites: guests.length - 1 })
      : guests.length === 1
        ? t('lp.shell.requested_guest_access_for', 'Requested guest access for {firstInvitee}', { firstInvitee: guests[0] })
        : t('lp.shell.shared_with', 'Shared with {firstInvitee}', { firstInvitee: members[0] });
  useUI.getState().toast(toast);
  return true;
}

/** Whether a person row's inherited access may be removed from here (not your own). */
export function canRemoveInherited(userId: string): boolean {
  return userId !== useSession.getState().userId;
}

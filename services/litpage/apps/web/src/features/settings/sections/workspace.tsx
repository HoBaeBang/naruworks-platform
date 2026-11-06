import { HELP_URL } from '@nc/shared/brand.ts';
// Settings › Workspace: General (Sidebar / Danger zone / Workspace ID, plus the admin rows), and the admin-only
// Teamspaces, Security, Identity and Requests sections. Admin features are plan-gated by space.plan_type
// (Plus by default).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { api, uploadFile } from '../../../lib/api.ts';
import { useCurrentSpaceView, useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { transactions } from '../../../lib/store/transactions.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { openEmojiPicker } from '../../page/IconPicker.tsx';
import { archiveTeamspace, joinTeamspace, leaveTeamspace, openCreateTeamspaceDialog, openTeamspaceSettings } from '../../shell/teamspaces.tsx';
import { getLocale, t } from '../../shell/i18n.ts';
import { Button, Dropdown, Group, IdRow, Pills, Row, SectionPage, Switch, Upsell, UserAvatar, confirmDialog, msg, openSubDialog, rich } from '../ui.tsx';
import { saveSpaceViewSetting } from '../userSettings.ts';
import { useSettingsFocus } from '../searchIndex.ts';
import { canCreateTeamspace, planAtLeast, policyTooltip, retentionDurationLabel, saveSpace, saveSpaceSettings, spaceApi, spaceSetting, useSpaceAccess, type PlanType } from '../spaceSettings.ts';
import { purgeRetentionDays, trashRetentionDays } from '@nc/shared/retention.ts';

const NAME_MAX = 65;

export function fmtDate(ms: number | undefined): string {
  if (!ms) return '—';
  return new Intl.DateTimeFormat(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(ms));
}

function toastError(e: unknown) {
  useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
}

function SpaceIconView({ space, size }: { space: SpaceRecord; size: number }) {
  const icon = space.icon;
  if (icon && /^(https?:|\/files\/|data:)/.test(icon)) return <img src={icon} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: 6 }} />;
  if (icon) return <span style={{ fontSize: size * 0.78, lineHeight: 1 }}>{icon}</span>;
  return <span className="nc-set-ws-letter" style={{ width: size, height: size, fontSize: size * 0.5 }}>{(space.name || 'W').slice(0, 1).toUpperCase()}</span>;
}

// ---------------------------------------------------------------------------------------------- General

export function GeneralSection() {
  // workspace settings are the owners' (membership admins manage members and groups only, server: policy.ts)
  const { space, owner } = useSpaceAccess();
  const sv = useCurrentSpaceView();
  if (!space) return null;

  const leave = async () => {
    const ok = await confirmDialog({
      title: t('lp.settings.you_re_about_to_leave_the', 'You’re about to leave the {workspaceName} workspace. Continue?', { workspaceName: space.name }),
      confirmLabel: t('lp.settings.leave', 'Leave'),
      danger: true,
    });
    if (!ok) return;
    try {
      await api('leaveSpace', { spaceId: space.id });
      location.href = '/';
    } catch (e) {
      toastError(e);
    }
  };

  const destroy = async () => {
    const ok = await confirmDialog({
      title: t('lp.settings.permanently_delete_this_whole_workspace', 'Permanently delete this whole workspace?'),
      description: t('lp.settings.you_can_t_undo_this_the', 'You can’t undo this. The workspace, including every page and file, will be deleted permanently. Type the workspace name to confirm.'),
      confirmLabel: t('lp.settings.delete_workspace_permanently', 'Delete workspace permanently'),
      danger: true,
      requireText: space.name,
    });
    if (!ok) return;
    try {
      await api('deleteWorkspace', { spaceId: space.id, confirmName: space.name });
      location.href = '/';
    } catch (e) {
      toastError(e);
    }
  };

  return (
    <SectionPage title={t('lp.settings.general', 'General')} subtitle={t('lp.settings.edit_the_workspace_s_name_domains', 'Edit the workspace’s name, domains, and other details')}>
      {owner && <WorkspaceBasics space={space} />}
      {owner && <AllowedDomains space={space} owner={owner} />}
      <Group title={t('lp.settings.sidebar', 'Sidebar')} help={t('lp.settings.these_toggles_affect_only_you_in', 'These toggles affect only you in this workspace')}>
        <Row
          id="show-lit-apps"
          label={t('lp.settings.sidebar_app_shortcuts', 'Sidebar app shortcuts')}
          description={t('lp.settings.add_a_calendar_shortcut_to_the_sidebar', 'Add a calendar shortcut to the sidebar')}
          control={<Switch label="Show app shortcuts in the sidebar" checked={sv?.settings?.show_lit_apps !== false} onChange={(v) => saveSpaceViewSetting('show_lit_apps', v)} />}
        />
      </Group>
      {owner && <ExportGroup space={space} />}
      {owner && (
        <Group title={t('lp.settings.analytics', 'Analytics')}>
          <Row
            id="page-view-analytics"
            label={t('lp.settings.save_page_views_and_show_analytics', 'Save page views and show analytics')}
            description={t('lp.settings.track_page_views_across_people_with', 'Track page views across {workspaceName}. People with edit or full access can see each page’s view count.', { workspaceName: space.name })}
            control={<Switch label="Save and show page view metrics" checked={spaceSetting(space, 'page_view_analytics', true)} onChange={(v) => saveSpaceSettings(space.id, { page_view_analytics: v })} />}
          />
        </Group>
      )}
      <Group title={t('lp.settings.danger_zone', 'Danger zone')}>
        <Row
          id="leave-workspace"
          label={t('lp.settings.leave_workspace', 'Leave workspace')}
          description={t('lp.settings.leaving_removes_your_account_from_the', 'Leaving removes your account from the workspace and cuts off access to everything in it, even pages you created.')}
          control={<Button variant="danger" onClick={leave}>{t('lp.settings.leave_workspace', 'Leave workspace')}</Button>}
        />
        {owner && (
          <Row
            id="delete-workspace"
            label={t('lp.settings.delete_workspace', 'Delete workspace')}
            description={t('lp.settings.delete_the_workspace_for_good_along', 'Delete the workspace for good, along with every page and file in it.')}
            control={<Button variant="danger" onClick={destroy}>{t('lp.settings.delete_workspace', 'Delete workspace')}</Button>}
          />
        )}
      </Group>
      <Group title={t('lp.settings.workspace_id', 'Workspace ID')}>
        <IdRow label={t('lp.settings.workspace_id', 'Workspace ID')} id={space.id} />
      </Group>
    </SectionPage>
  );
}

function WorkspaceBasics({ space }: { space: SpaceRecord }) {
  const [name, setName] = useState(space.name);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => setName(space.name), [space.name]);
  const commit = () => {
    const v = name.trim().slice(0, NAME_MAX);
    if (v && v !== space.name) saveSpace(space.id, { name: v });
    else setName(space.name);
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) {
      useUI.getState().toast(t('lp.settings.please_choose_an_image_file', 'Please choose an image file'));
      return;
    }
    try {
      const up = await uploadFile(f, f.name, space.id);
      saveSpace(space.id, { icon: up.url });
    } catch (e) {
      toastError(e);
    }
  };
  const iconMenu = (anchor: HTMLElement) => {
    openMenu(anchor, {
      width: 220,
      sections: [{
        items: [
          { label: t('lp.settings.choose_an_emoji', 'Choose an emoji'), icon: 'emojiFace', onSelect: () => { setTimeout(() => openEmojiPicker(anchor, { onPick: (emoji) => saveSpace(space.id, { icon: emoji }) }), 0); } },
          { label: t('lp.settings.upload_an_image', 'Choose an image'), icon: 'cloudArrowUp', onSelect: () => { fileRef.current?.click(); } },
          ...(space.icon ? [{ label: t('lp.settings.remove', 'Remove'), icon: 'trashSmall', onSelect: () => saveSpace(space.id, { icon: '' }) }] : []),
        ],
      }],
    }, { placement: 'bottom-end' });
  };
  return (
    <Group title={t('lp.settings.workspace_settings', 'Workspace settings')}>
      <Row
        id="workspace-name"
        label={t('lp.settings.workspace_name', 'Workspace name')}
        description={t('lp.settings.use_characters_or_fewer_for_the', 'Use {maxLength} characters or fewer for the workspace name', { maxLength: NAME_MAX })}
        control={(
          <div className="nc-set-input" style={{ width: 250 }}>
            <input
              aria-label={t('lp.settings.workspace_name', 'Workspace name')}
              value={name}
              maxLength={NAME_MAX}
              placeholder={t('lp.settings.example_company_name', 'Example: company name')}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setName(space.name); } }}
            />
          </div>
        )}
      />
      <Row
        id="workspace-icon"
        label={t('lp.settings.icon', 'Icon')}
        description={t('lp.settings.your_sidebar_and_notifications_will_show', 'Your sidebar and notifications will show this icon. Choose an emoji or upload your own image.')}
        control={(
          <>
            <div role="button" tabIndex={0} className="nc-set-ws-icon" aria-label={t('lp.settings.icon', 'Icon')} onClick={(e) => iconMenu(e.currentTarget)}>
              <SpaceIconView space={space} size={40} />
            </div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
          </>
        )}
      />
    </Group>
  );
}

// Settings › General › Verified email domains: owners list email domains their members use; people who
// sign up with an address on one of them join automatically / ask to join (server: domainJoin.ts).
const CONSUMER_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'naver.com', 'daum.net', 'hanmail.net', 'kakao.com', 'qq.com', '163.com', 'example.com']);

function AllowedDomains({ space, owner }: { space: SpaceRecord; owner: boolean }) {
  useTableVersion(['lit_user']);
  const domains = spaceSetting<string[]>(space, 'allowed_email_domains', []);
  const join = spaceSetting<string>(space, 'allowed_email_domain_join', 'auto');
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const memberDomains = [...new Set((space.permissions ?? [])
    .filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none')
    .map((p) => String(records.get<UserRecord>('lit_user', p.user_id!)?.email ?? '').toLowerCase().split('@')[1] ?? '')
    .filter((d) => d && !CONSUMER_DOMAINS.has(d)))];
  const suggested = memberDomains.filter((d) => !domains.includes(d)).slice(0, 3);
  const save = async (next: string[]) => {
    setBusy(true);
    try {
      await spaceApi('setAllowedEmailDomains', { spaceId: space.id, domains: next });
      setDraft('');
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const addDraft = () => {
    const d = draft.trim().toLowerCase().replace(/^@/, '');
    if (!d || domains.includes(d)) { setDraft(''); return; }
    void save([...domains, d]);
  };
  const paid = space.plan_type !== 'free';
  return (
    <Group title={t('lp.settings.permitted_email_domains', 'Permitted email domains')}>
      <Row
        id="allowed-email-domains"
        label={t('lp.settings.allowed_domains', 'Allowed domains')}
        description={(
          <>
            {paid
              ? rich(msg('lp.settings.people_whose_email_uses_one_of', 'People whose email uses one of these domains can join the workspace without an invite and are billed as members. <learnmorelink>Learn more</learnmorelink>'), {}, {
                learnmorelink: (c) => HELP_URL ? <a href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
              })
              : t('lp.settings.people_whose_email_uses_one_of_62f0', 'People whose email uses one of these domains can join the workspace as members without an invite')}
            {owner && suggested.length > 0 && (
              <span className="nc-set-domain-suggest">
                {t('lp.settings.suggested_domains', 'Suggested domains:')}
                {suggested.map((d) => (
                  <span key={d} className="nc-set-domain-suggest-item">
                    <b>{d}</b>
                    <Button small disabled={busy} onClick={() => void save([...domains, d])}>{t('lp.settings.add', 'Add')}</Button>
                  </span>
                ))}
              </span>
            )}
          </>
        )}
        control={(
          <div className="nc-set-input nc-set-chip-input nc-set-domain-input" style={{ width: 250 }} aria-disabled={!owner || undefined} title={owner ? undefined : policyTooltip.ownersOnly()}>
            {domains.map((d) => (
              <span key={d} className="nc-set-chip">
                {d}
                {owner && <span role="button" aria-label={`Remove ${d}`} className="x" onClick={() => void save(domains.filter((x) => x !== d))}><Icon name="xMarkSmall" size={14} /></span>}
              </span>
            ))}
            {owner && (
              <input
                aria-label={t('lp.settings.allowed_domains', 'Allowed domains')}
                value={draft}
                disabled={busy}
                placeholder={domains.length ? '' : t('lp.settings.domain_e_g_acme_com', 'Domain, e.g. acme.com…')}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ' ') { e.preventDefault(); addDraft(); }
                  if (e.key === 'Backspace' && !draft && domains.length) void save(domains.slice(0, -1));
                }}
                onBlur={() => { if (draft.trim()) addDraft(); }}
              />
            )}
            {!owner && !domains.length && <span className="placeholder">{t('lp.settings.domain_e_g_acme_com', 'Domain, e.g. acme.com…')}</span>}
          </div>
        )}
      />
      <Row
        id="allowed-email-domains-join"
        label={t('lp.settings.let_teammates_from_approved_email_domain', 'Let teammates from approved email domains join as members')}
        description={t('lp.settings.let_teammates_with_an_allowed_email', 'Let teammates with an allowed email domain join or request access to this workspace')}
        disabled={!domains.length}
        control={(
          <Dropdown
            value={(join === 'request' || join === 'none' ? join : 'auto') as 'auto' | 'request' | 'none'}
            width={200}
            disabled={!owner || !domains.length}
            options={[
              { value: 'auto', label: t('lp.settings.join_automatically', 'Join automatically') },
              { value: 'request', label: t('lp.settings.ask_to_join', 'Ask to join') },
              { value: 'none', label: t('lp.settings.no_access_63bd', 'No access') },
            ]}
            onChange={(v) => saveSpaceSettings(space.id, { allowed_email_domain_join: v })}
          />
        )}
      />
    </Group>
  );
}

/** Settings › General › Export › Members: member list CSV (Email, Name, Role, Permission groups, Pages, ID)
 *  with guests and the pages they can access. */
async function exportMembersCsv(space: SpaceRecord) {
  const roleName = (r: string) => r === 'owner' ? t('lp.settings.workspace_owner_7abc', 'Workspace owner')
    : r === 'membership_admin' ? t('lp.settings.membership_admin_51e1', 'Membership admin')
      : r === 'restricted_member' ? t('lp.settings.restricted_member', 'Restricted member')
        : t('lp.settings.member_6853', 'Member');
  const groups = spaceSetting<{ id: string; name?: string; member_ids?: string[] }[]>(space, 'groups', []);
  const groupsOf = (uid: string) => groups.filter((g) => g.member_ids?.includes(uid)).map((g) => g.name || t('lp.settings.untitled', 'Untitled')).join(t('lp.settings.text_d3bc', ', '));
  const rows: string[][] = [[
    t('lp.settings.email', 'Email'), t('lp.settings.name', 'Name'), t('lp.settings.role', 'Role'),
    t('lp.settings.permission_groups', 'Permission groups'), t('lp.settings.pages', 'Pages'), t('lp.settings.id_89f8', 'ID'),
  ]];
  for (const p of space.permissions ?? []) {
    if (p.type !== 'user_permission' || !p.user_id || p.role === 'none') continue;
    const u = records.get<UserRecord>('lit_user', p.user_id);
    rows.push([u?.email ?? '', u?.name ?? '', roleName(p.role as string), groupsOf(p.user_id), '', p.user_id]);
  }
  try {
    const res = await api<{ guests: { userId: string; pageIds: string[] }[]; recordMap: any }>('getWorkspaceGuests', { spaceId: space.id });
    records.mergeRecordMap(res.recordMap);
    for (const g of res.guests ?? []) {
      const u = records.get<UserRecord>('lit_user', g.userId);
      const pages = g.pageIds.map((id) => {
        const b = records.get<any>('block', id);
        const title = b ? (b.properties?.title ?? []).map((x: any) => x?.[0] ?? '').join('') || t('lp.settings.untitled', 'Untitled') : t('lp.settings.private_page', 'Private page');
        return t('lp.settings.text_247c', '{pageTitle} ({pageId})', { pageTitle: title, pageId: id });
      }).join(t('lp.settings.text_d3bc', ', '));
      rows.push([u?.email ?? '', u?.name ?? '', t('lp.settings.guest_face', 'Guest'), groupsOf(g.userId), pages, g.userId]);
    }
  } catch (e) {
    toastError(e);
    return;
  }
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `${space.name || 'workspace'}-members.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function ExportGroup({ space }: { space: SpaceRecord }) {
  const { plan } = useSpaceAccess();
  const exportMembers = () => { void exportMembersCsv(space); };
  return (
    <Group title={t('lp.settings.export_f3e4', 'Export')}>
      <Row
        id="export-content"
        label={t('lp.settings.workspace_content', 'Workspace content')}
        description={rich(msg('lp.settings.export_every_page_in_larger_workspaces', 'Export every page in {spaceName}. Larger workspaces may take longer. <inlinelink>Learn more</inlinelink>'), { spaceName: space.name }, {
          inlinelink: (c) => HELP_URL ? <a href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
        })}
        control={<Button onClick={() => openExportWorkspaceDialog(space)}>{t('lp.settings.export_f3e4', 'Export')}</Button>}
      />
      <Row
        id="export-members"
        label={t('lp.settings.members', 'Members')}
        description={(
          <>
            {t('lp.settings.download_a_csv_listing_every_member', 'Download a CSV listing every member and guest in {spaceName}', { spaceName: space.name })}
            {!planAtLeast(plan, 'business') && <Upsell text={msg('lp.settings.a_list_of_workspace_members_and', 'A list of workspace members and guests is available after you <highlight>upgrade</highlight>')} />}
          </>
        )}
        control={<Button disabled={!planAtLeast(plan, 'business')} onClick={exportMembers}>{t('lp.settings.export_f3e4', 'Export')}</Button>}
      />
    </Group>
  );
}

function openExportWorkspaceDialog(space: SpaceRecord) {
  openSubDialog((close) => <ExportWorkspaceBody space={space} close={close} />);
}

function ExportWorkspaceBody({ space, close }: { space: SpaceRecord; close: () => void }) {
  const [format, setFormat] = useState<'markdown' | 'html' | 'pdf'>('markdown');
  const [pageFormat, setPageFormat] = useState<'Letter' | 'A4' | 'A3' | 'Legal' | 'Tabloid'>('Letter');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Workspace PDF export is a Business / Enterprise feature (server: export.ts)
  const pdfOk = planAtLeast(space.plan_type ?? 'plus', 'business');
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      if (format === 'pdf') {
        // the server returns a print view: a new tab opens the browser's print dialog ("Save as PDF")
        const res = await api<{ printUrl: string; filename?: string }>('exportWorkspace', { spaceId: space.id, format: 'pdf', pageFormat });
        const w = window.open(res.printUrl, '_blank');
        if (w) w.opener = null;
        close();
        return;
      }
      const res = await api<{ url: string; filename?: string }>('exportWorkspace', { spaceId: space.id, format });
      const a = document.createElement('a');
      a.href = res.url;
      a.download = res.filename ?? '';
      document.body.appendChild(a);
      a.click();
      a.remove();
      close();
      useUI.getState().toast(t('lp.settings.export_complete_download_started', 'Export complete — download started'));
    } catch (e: any) {
      if (e?.status === 404) {
        close();
        useUI.getState().toast(t('lp.settings.workspace_export_isn_t_available_on', 'Workspace export isn’t available on this server'));
        return;
      }
      setErr(e?.message ?? 'Export failed');
      setBusy(false);
    }
  };
  return (
    <>
      <h3>{t('lp.settings.export_everything_in_the_workspace', 'Export everything in the workspace')}</h3>
      <div className="desc">{t('lp.settings.export_every_page_in_larger_workspaces', 'Export every page in {spaceName}. Larger workspaces may take longer. <inlinelink>Learn more</inlinelink>', { spaceName: space.name })}</div>
      <Row
        label={t('lp.settings.export_format', 'Export format')}
        control={(
          <Dropdown
            value={format}
            width={220}
            options={[
              { value: 'markdown', label: t('lp.settings.markdown_csv', 'Markdown & CSV') },
              { value: 'html', label: t('lp.settings.html', 'HTML') },
              { value: 'pdf', label: t('lp.settings.pdf', 'PDF'), disabled: !pdfOk, description: pdfOk ? undefined : t('lp.settings.upgrade_to_the_business_plan_to', 'Upgrade to the Business plan to export your workspace as PDF') },
            ]}
            onChange={setFormat}
          />
        )}
      />
      {format === 'pdf' && (
        <Row
          label={t('lp.settings.page_format', 'Page format')}
          control={(
            <Dropdown
              value={pageFormat}
              width={160}
              options={(['Letter', 'A4', 'A3', 'Legal', 'Tabloid'] as const).map((v) => ({ value: v, label: v }))}
              onChange={setPageFormat}
            />
          )}
        />
      )}
      {err && <div className="error">{err}</div>}
      <div className="actions">
        <Button variant="primary" disabled={busy} onClick={go}>{busy ? t('lp.settings.exporting', 'Exporting…') : t('lp.settings.export_f3e4', 'Export')}</Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Teamspaces

type Access = 'default' | 'open' | 'closed' | 'private';

function accessOf(team: TeamRecord, space: SpaceRecord): Access {
  if (space.default_team_ids?.includes(team.id)) return 'default';
  const ty = team.settings?.type;
  return ty === 'closed' || ty === 'private' ? ty : 'open';
}

function accessLabel(a: Access): string {
  switch (a) {
    case 'default': return t('lp.settings.default', 'Default');
    case 'closed': return t('lp.settings.closed', 'Closed');
    case 'private': return t('lp.settings.private', 'Private');
    default: return t('lp.settings.open', 'Open');
  }
}

function useSpaceTeams(spaceId: string | undefined): TeamRecord[] {
  const ver = useTableVersion(['team']);
  return useMemo(
    () => records.all<TeamRecord>('team').filter((tm) => tm.space_id === spaceId && tm.alive !== false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spaceId, ver],
  );
}

export function TeamspacesSection() {
  const { space, uid, owner } = useSpaceAccess();
  const teams = useSpaceTeams(space?.id);
  const [q, setQ] = useState('');
  const [access, setAccess] = useState<'any' | 'open' | 'closed' | 'private'>('any');
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null); // user id, 'none' = no owners
  const [sortDesc, setSortDesc] = useState(true);
  if (!space) return null;

  const shown = teams
    .filter((tm) => (status === 'archived' ? !!tm.archived_by : !tm.archived_by))
    .filter((tm) => {
      if (!ownerFilter) return true;
      const owners = (tm.membership ?? []).filter((m) => m.role === 'owner');
      return ownerFilter === 'none' ? owners.length === 0 : owners.some((m) => m.user_id === ownerFilter);
    })
    .filter((tm) => access === 'any' || accessOf(tm, space) === access || (access === 'open' && accessOf(tm, space) === 'default'))
    .filter((tm) => !q.trim() || (tm.name || '').toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => {
      const ta = Number(a.last_edited_time ?? a.created_time ?? 0);
      const tb = Number(b.last_edited_time ?? b.created_time ?? 0);
      return sortDesc ? tb - ta : ta - tb;
    });

  const rowMenu = (anchor: HTMLElement, team: TeamRecord) => {
    const mine = team.membership?.find((m) => m.user_id === uid);
    const owners = (team.membership ?? []).filter((m) => m.role === 'owner');
    // workspace owners can join any teamspace (also as owner) and take over teamspaces nobody owns
    const becomeOwner = () => {
      const membership = [...(team.membership ?? []).filter((m) => m.user_id !== uid), { user_id: uid, role: 'owner' as const, added_time: Date.now() }];
      const sv = records.all<any>('space_view').find((v) => v.space_id === space.id && v.parent_id === uid);
      transactions.run(space.id, 'joinTeamAsOwner', (tx) => {
        tx.update('team', team.id, [], { membership });
        if (sv && !(sv.joined_teams ?? []).includes(team.id)) tx.listAfter('space_view', sv.id, ['joined_teams'], team.id);
      }, {});
      useUI.getState().toast(mine
        ? t('lp.settings.became_owner_of_with_admin_access', 'Became owner of {teamName} with admin access', { teamName: team.name })
        : t('lp.settings.joined_with_admin_access', 'Joined {teamName} with admin access', { teamName: team.name }));
    };
    openMenu(anchor, {
      width: 260,
      sections: [
        {
          items: [
            { label: t('lp.settings.team_settings', 'Team settings'), icon: 'gear', onSelect: () => { setTimeout(() => openTeamspaceSettings(team.id), 0); } },
            { label: t('lp.settings.security', 'Security'), icon: 'shield', onSelect: () => { setTimeout(() => openTeamspaceSettings(team.id, 'security'), 0); } },
          ],
        },
        {
          items: team.archived_by
            ? [{ label: t('lp.settings.restore_team', 'Restore team'), icon: 'arrowTurnUpLeft', onSelect: () => { transactions.run(space.id, 'restoreTeam', (tx) => tx.update('team', team.id, [], { archived_by: null }), {}); } }]
            : [
              ...(mine
                ? [{ label: t('lp.settings.leave_team', 'Leave team'), icon: 'arrowLineLeft', onSelect: () => leaveTeamspace(team.id) }]
                : [{ label: t('lp.settings.join_team', 'Join team'), icon: 'plus', onSelect: () => joinTeamspace(team.id) }]),
              ...(owner && mine?.role !== 'owner'
                ? [{ label: owners.length ? (mine ? t('lp.settings.make_team_owner', 'Make team owner') : t('lp.settings.join_as_team_owner', 'Join as team owner')) : t('lp.settings.become_owner_no_owners', 'Become owner (no owners)'), icon: 'personPlus', onSelect: becomeOwner }]
                : []),
              { label: t('lp.settings.archive_team', 'Archive team'), icon: 'archive', danger: true, onSelect: () => archiveTeamspace(team.id) },
            ],
        },
      ],
    }, { placement: 'bottom-end' });
  };
  const owners = [...new Set(teams.flatMap((tm) => (tm.membership ?? []).filter((m) => m.role === 'owner').map((m) => m.user_id)))];
  const ownerMenu = (anchor: HTMLElement) => openMenu(anchor, {
    width: 260,
    search: t('lp.settings.search_for_a_team_owner', 'Search for a team owner...'),
    sections: [
      { items: [{ label: t('lp.settings.no_owners', 'No owners'), checked: ownerFilter === 'none', onSelect: () => setOwnerFilter(ownerFilter === 'none' ? null : 'none') }] },
      {
        title: t('lp.settings.select_users', 'Select users'),
        items: owners.map((id) => {
          const u = records.get<UserRecord>('lit_user', id);
          return { label: u?.name || u?.email || id, text: `${u?.name ?? ''} ${u?.email ?? ''}`, icon: <UserAvatar user={u} size={20} />, checked: ownerFilter === id, onSelect: () => setOwnerFilter(ownerFilter === id ? null : id) };
        }),
      },
    ],
  }, { placement: 'bottom-start' });
  const ownerFilterLabel = ownerFilter === 'none'
    ? t('lp.settings.owner_none', 'Owner: None')
    : ownerFilter
      ? t('lp.settings.owner_156f', 'Owner: {teamOwnerName}', { teamOwnerName: records.get<UserRecord>('lit_user', ownerFilter)?.name ?? '' })
      : t('lp.settings.owner', 'Owner');

  return (
    <SectionPage wide title={t('lp.settings.teams', 'Teams')} subtitle={t('lp.settings.manage_this_workspace_s_teams', 'Manage this workspace’s teams')}>
      <Group title={t('lp.settings.default_teams', 'Default teams')} description={t('lp.settings.choose_the_teams_that_current_and', 'Choose the teams that current and future workspace members join automatically')}>
        <DefaultTeams space={space} teams={teams.filter((tm) => !tm.archived_by)} />
        <Row
          id="limit-team-creation"
          label={t('lp.settings.only_workspace_owners_can_create_teams', 'Only workspace owners can create teams')}
          description={t('lp.settings.only_workspace_owners_can_create_teams', 'Only workspace owners can create teams')}
          control={(
            <Switch
              label="Limit teamspace creation"
              disabled={!owner}
              checked={spaceSetting(space, 'limit_team_creation', false)}
              onChange={(v) => {
                void confirmDialog({
                  title: v
                    ? t('lp.settings.allow_only_workspace_owners_to_create', 'Allow only workspace owners to create teams?')
                    : t('lp.settings.let_every_workspace_member_create_teams', 'Let every workspace member create teams?'),
                  confirmLabel: t('lp.settings.yes', 'Yes'),
                }).then((ok) => { if (ok) saveSpaceSettings(space.id, { limit_team_creation: v }); });
              }}
            />
          )}
        />
      </Group>
      <Group title={t('lp.settings.teams', 'Teams')} description={t('lp.settings.manage_all_teams_you_can_access', 'Manage all teams you can access here')}>
        <div className="nc-set-toolbar wrap">
          <div className="nc-set-input nc-set-search-inline">
            <Icon name="magnifyingGlassSmall" size={16} />
            <input aria-label={t('lp.settings.search_teams', 'Search teams')} placeholder={t('lp.settings.search_teams', 'Search teams')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <Dropdown
            width={200}
            label={t('lp.settings.access', 'Access')}
            value={access}
            options={[
              { value: 'any', label: t('lp.settings.any', 'Any') },
              { value: 'open', label: t('lp.settings.open', 'Open') },
              { value: 'closed', label: t('lp.settings.closed', 'Closed') },
              { value: 'private', label: t('lp.settings.private', 'Private') },
            ]}
            renderLabel={(o) => `${t('lp.settings.access', 'Access')}: ${o?.label ?? ''}`}
            onChange={setAccess}
          />
          <Dropdown
            width={200}
            value={status}
            options={[
              { value: 'active', label: t('lp.settings.active', 'Active') },
              { value: 'archived', label: t('lp.settings.archived_eddc', 'Archived') },
            ]}
            onChange={setStatus}
          />
          <div role="button" tabIndex={0} data-filter="owner" className={`nc-set-btn nc-set-dropdown ${ownerFilter ? 'open' : ''}`} onClick={(e) => ownerMenu(e.currentTarget)}>
            <span>{ownerFilterLabel}</span>
            <span className="chev"><Icon name="arrowChevronSingleDownSmall" size={14} /></span>
          </div>
          <div style={{ flex: 1 }} />
          <span data-tooltip={canCreateTeamspace(space, uid) ? undefined : policyTooltip.createTeamspace()}>
            <Button variant="primary" icon="plusSmall" disabled={!canCreateTeamspace(space, uid)} onClick={() => openCreateTeamspaceDialog()}>{t('lp.settings.new_team', 'New team')}</Button>
          </span>
        </div>
        <table className="nc-set-ptable nc-set-teams">
          <thead>
            <tr>
              <th style={{ width: '34%' }}>{t('lp.settings.name', 'Name')}</th>
              <th>{t('lp.settings.owners', 'Owners')}</th>
              <th>{t('lp.settings.members', 'Members')}</th>
              <th>{t('lp.settings.access', 'Access')}</th>
              <th>
                <span className="sort" role="button" onClick={() => setSortDesc((d) => !d)}>
                  {t('lp.settings.updated', 'Updated')}
                  <Icon name={sortDesc ? 'arrowStraightDownFill' : 'arrowStraightUpFill'} size={12} />
                </span>
              </th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {shown.map((tm) => {
              const tmOwners = (tm.membership ?? []).filter((m) => m.role === 'owner');
              return (
                <tr key={tm.id} className="clickable" onClick={() => openTeamspaceSettings(tm.id)}>
                  <td>
                    <div className="nc-set-user">
                      <span className="nc-set-team-icon">{tm.icon && !/^(https?:|\/files\/|lit-icon)/.test(tm.icon) ? tm.icon : (tm.name || 'T').slice(0, 1).toUpperCase()}</span>
                      <span className="nc-set-user-name ellipsis">{tm.name || t('lp.settings.untitled', 'Untitled')}</span>
                      {tm.archived_by && <span className="nc-set-badge gray">{t('lp.settings.archived_eddc', 'Archived')}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="nc-set-avatars">
                      {tmOwners.slice(0, 3).map((o) => <UserAvatar key={o.user_id} user={records.get<UserRecord>('lit_user', o.user_id)} size={20} />)}
                      {tmOwners.length > 3 && <span className="more">{t('lp.settings.text_590b', '+{numAdditionalOwners}', { numAdditionalOwners: tmOwners.length - 3 })}</span>}
                      {!tmOwners.length && <span className="muted">{t('lp.settings.no_owners', 'No owners')}</span>}
                    </div>
                  </td>
                  <td>{t('lp.settings.nummembers_plural_one_other', '{numMembers, plural, one {# workspace member} other {# workspace members}}', { numMembers: tm.membership?.length ?? 0 })}</td>
                  <td>{accessLabel(accessOf(tm, space))}</td>
                  <td>{fmtDate(Number(tm.last_edited_time ?? tm.created_time ?? 0))}</td>
                  <td>
                    <span role="button" className="nc-set-icon-btn" aria-label={t('lp.settings.more_actions', 'More actions')} onClick={(e) => { e.stopPropagation(); rowMenu(e.currentTarget as HTMLElement, tm); }}>
                      <Icon name="ellipsisSmall" size={16} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <div className="nc-set-empty">{t('lp.settings.no_teams_were_found', 'No teams were found.')}</div>}
      </Group>
    </SectionPage>
  );
}

function DefaultTeams({ space, teams }: { space: SpaceRecord; teams: TeamRecord[] }) {
  const current = space.default_team_ids ?? [];
  const [sel, setSel] = useState<string[]>(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSel(space.default_team_ids ?? []), [space.default_team_ids?.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const same = sel.length === current.length && sel.every((id) => current.includes(id));
  const reason = !teams.length
    ? t('lp.settings.to_pick_a_default_create_a', 'To pick a default, create a team first')
    : !sel.length
      ? t('lp.settings.select_at_least_one_default_team', 'Select at least one default team')
      : same
        ? t('lp.settings.your_selection_already_matches_the_curre', 'Your selection already matches the current default teams')
        : undefined;
  const add = (anchor: HTMLElement) => {
    const rest = teams.filter((tm) => !sel.includes(tm.id));
    openMenu(anchor, {
      width: 300,
      search: t('lp.settings.choose_a_default_team', 'Choose a default team...'),
      emptyText: t('lp.settings.no_teams_available', 'No teams available'),
      sections: [{ items: rest.map((tm) => ({ label: tm.name || t('lp.settings.untitled', 'Untitled'), text: tm.name, icon: 'teamspace', onSelect: () => setSel((s) => [...s, tm.id]) })) }],
    }, { placement: 'bottom-start' });
  };
  const update = async () => {
    setBusy(true);
    try {
      await spaceApi('setDefaultTeams', { spaceId: space.id, teamIds: sel });
      useUI.getState().toast(t('lp.settings.default_teams_updated', 'Default teams updated'));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nc-set-default-teams">
      <div className="nc-set-input nc-set-chip-input" role="button" tabIndex={0} onClick={(e) => { if ((e.target as HTMLElement).closest('.nc-set-chip')) return; add(e.currentTarget); }}>
        {sel.map((id) => {
          const tm = records.get<TeamRecord>('team', id);
          return (
            <span key={id} className="nc-set-chip">
              {tm?.name || t('lp.settings.untitled', 'Untitled')}
              <span role="button" aria-label="Remove" className="x" onClick={() => setSel((s) => s.filter((x) => x !== id))}><Icon name="xMarkSmall" size={14} /></span>
            </span>
          );
        })}
        {!sel.length && <span className="placeholder">{t('lp.settings.choose_a_default_team', 'Choose a default team...')}</span>}
      </div>
      <Button variant="primary" disabled={!!reason || busy} title={reason} onClick={update}>{t('lp.settings.update', 'Update')}</Button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------- Security

function GateHint({ plan, min, text }: { plan: PlanType; min: PlanType; text: string }) {
  return planAtLeast(plan, min) ? null : <Upsell text={text} />;
}

export function SecuritySection() {
  const { space, plan } = useSpaceAccess();
  const focus = useSettingsFocus();
  const [tab, setTab] = useState<'general' | 'members' | 'retention'>(focus.section === 'security' && (focus.tab === 'members' || focus.tab === 'retention') ? focus.tab : 'general');
  useEffect(() => {
    if (focus.section === 'security' && (focus.tab === 'general' || focus.tab === 'members' || focus.tab === 'retention')) setTab(focus.tab);
  }, [focus.nonce]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!space) return null;
  const ent = planAtLeast(plan, 'enterprise');
  const accessRequests = spaceSetting<boolean>(space, 'allow_access_requests', true) !== false;
  const guestsOn = !space.disable_guests;
  const supportOn = !!spaceSetting(space, 'support_access', false);
  const supportSince = Number(spaceSetting(space, 'support_access_granted_time', 0)) || 0;
  const entTip = t('lp.settings.changing_security_settings_requires_the', 'Changing security settings requires the Enterprise plan');
  const set = (patch: Record<string, unknown>) => saveSpaceSettings(space.id, patch);
  const confirmPublic = async (v: boolean) => {
    if (v) {
      const ok = await confirmDialog({
        title: t('lp.settings.this_will_stop_sites_and_forms', 'This will stop sites and forms from being published and turn off public links. Continue?'),
        description: t('lp.settings.this_removes_access_to_every_page', 'This removes access to every page in this workspace for anyone who isn’t a member or guest.'),
        confirmLabel: t('lp.settings.yes', 'Yes'),
        danger: true,
      });
      if (!ok) return;
    }
    saveSpace(space.id, { disable_public_access: v });
  };
  return (
    <SectionPage title={t('lp.settings.security', 'Security')} subtitle={t('lp.settings.decide_who_can_publish_how_members', 'Decide who can publish, how members get added, how long data is kept, and more')}>
      <Pills
        value={tab}
        onChange={setTab}
        items={[
          { value: 'general', label: t('lp.settings.general', 'General') },
          { value: 'members', label: t('lp.settings.members_guests', 'Members & guests') },
          { value: 'retention', label: t('lp.settings.data_retention', 'Data retention') },
        ]}
      />
      {tab === 'general' && (
        <Group>
          <Row
            id="disable-public-access"
            label={t('lp.settings.turn_off_public_links_forms_and', 'Turn off public links, forms, and site publishing')}
            description={t('lp.settings.block_public_sharing_from_this_workspace', 'Block public sharing from this workspace')}
            control={<span data-tooltip={ent ? undefined : entTip}><Switch label="Disable publishing" disabled={!ent} checked={!!space.disable_public_access} onChange={(v) => void confirmPublic(v)} /></span>}
          />
          <Row
            id="disable-move-to-space"
            label={t('lp.settings.prevent_copying_pages_to_other_workspace', 'Prevent copying pages to other workspaces')}
            description={rich(msg('lp.settings.prevent_pages_from_being_duplicated_to', 'Prevent pages from being duplicated to another workspace through <bold>Change to</bold> or <bold>Duplicate to</bold>'), {}, { bold: (c) => <strong>{c}</strong> })}
            control={<span data-tooltip={ent ? undefined : entTip}><Switch label="Disable duplicating pages" disabled={!ent} checked={spaceSetting(space, 'disable_move_to_space', false)} onChange={(v) => set({ disable_move_to_space: v })} /></span>}
          />
          <Row
            id="disable-export"
            label={t('lp.settings.disable_export', 'Disable export')}
            description={t('lp.settings.block_exports_of_this_workspace_s', 'Block exports of this workspace’s content')}
            control={<span data-tooltip={ent ? undefined : entTip}><Switch label="Disable export" disabled={!ent} checked={!!space.disable_export} onChange={(v) => saveSpace(space.id, { disable_export: v })} /></span>}
          />
          <Row
            id="allow-access-requests"
            label={t('lp.settings.let_non_members_request_access_with', 'Let non-members request access with the link')}
            description={t('lp.settings.let_non_members_request_page_access', 'Let non-members request page access when they have its link')}
            control={<Switch label="Let non-members request page access" disabled={plan === 'free'} checked={accessRequests} onChange={(v) => set({ allow_access_requests: v })} />}
          />
          <Row
            id="disable-space-page-edits"
            label={t('lp.settings.lock_the_workspace_section_so_members', 'Lock the Workspace section so members can’t edit it')}
            description={t('lp.settings.stop_members_from_creating_moving_reorde', 'Stop members from creating, moving, reordering, or deleting top-level workspace pages.')}
            control={<span data-tooltip={ent ? undefined : entTip}><Switch label="Stop members editing the Workspace section" disabled={!ent} checked={!!spaceSetting(space, 'disable_space_page_edits', false)} onChange={(v) => set({ disable_space_page_edits: v })} /></span>}
          />
          <Row
            id="workspace-support-access"
            label={t('lp.settings.open_this_workspace_to_litpage_support', 'Open this workspace to Litpage support')}
            description={supportOn && supportSince
              ? `${t('lp.settings.allow_litpage_to_inspect_this_workspace', 'Allow Litpage to inspect this workspace’s data while troubleshooting. Access ends automatically.')} ${t('lp.settings.active_until', 'Active until {date}', { date: fmtDate(supportSince + 28 * 86_400_000) })}`
              : t('lp.settings.allow_litpage_to_inspect_this_workspace', 'Allow Litpage to inspect this workspace’s data while troubleshooting. Access ends automatically.')}
            control={<span data-tooltip={t('lp.settings.give_litpage_support_short_term_access', 'Give Litpage support short-term access so they can diagnose and fix problems in your workspace. It ends automatically after {days} days.', { days: 28 })}><Switch label="Workspace support access" checked={supportOn} onChange={(v) => set({ support_access: v, support_access_granted_time: v ? Date.now() : null })} /></span>}
          />
          <GateHint plan={plan} min="enterprise" text={msg('lp.settings.upgrade_to_enterprise_to_disable_publish', '<highlight>Upgrade</highlight> to Enterprise to disable publishing, duplicating and exporting')} />
        </Group>
      )}
      {tab === 'members' && (
        <Group>
          <Row
            id="allow-guests"
            label={t('lp.settings.members_can_share_pages_with_guests', 'Members can share pages with guests')}
            description={t('lp.settings.allow_members_to_add_guests_to', 'Allow members to add guests to pages.')}
            control={(
              <span data-tooltip={!ent ? entTip : guestsOn && accessRequests ? t('lp.settings.to_turn_this_off_first_stop', 'To turn this off, first stop non-members from requesting access to pages') : undefined}>
                <Switch label="Allow members to invite guests" disabled={!ent || (guestsOn && accessRequests)} checked={guestsOn} onChange={(v) => saveSpace(space.id, { disable_guests: !v })} />
              </span>
            )}
          />
          <Row
            id="guest-invite-requests"
            label={t('lp.settings.let_members_ask_to_invite_guests', 'Let members ask to invite guests')}
            description={t('lp.settings.allow_members_to_request_to_add', 'Allow members to request to add guests to pages. Requests must be approved by a workspace owner.')}
            control={(
              <span data-tooltip={!ent ? entTip : guestsOn ? t('lp.settings.turn_off_guest_invitations_to_use', 'Turn off guest invitations to use this feature') : undefined}>
                <Switch label="Let members ask to invite guests" disabled={!ent || guestsOn} checked={!!spaceSetting(space, 'allow_guest_invite_requests', false)} onChange={(v) => set({ allow_guest_invite_requests: v })} />
              </span>
            )}
          />
          <Row
            id="member-requests"
            label={t('lp.settings.let_members_ask_to_add_other', 'Let members ask to add other members')}
            description={t('lp.settings.let_members_request_that_admins_add', 'Let members request that admins add more people')}
            control={<Switch label="Let members ask to add members" disabled={plan === 'free'} checked={spaceSetting(space, 'allow_member_requests', true)} onChange={(v) => set({ allow_member_requests: v })} />}
          />
          <Row
            id="external-member-requests"
            label={t('lp.settings.let_anyone_ask_to_become_a', 'Let anyone ask to become a workspace member')}
            description={t('lp.settings.let_people_with_team_invite_links', 'Let people with team invite links request workspace membership')}
            control={<Switch label="Let anyone request workspace membership" disabled={plan === 'free'} checked={spaceSetting(space, 'allow_external_member_requests', false)} onChange={(v) => set({ allow_external_member_requests: v })} />}
          />
          <Row
            id="guest-member-requests"
            label={t('lp.settings.let_guests_ask_to_become_members', 'Let guests ask to become members')}
            description={t('lp.settings.let_guests_request_workspace_membership', 'Let guests request workspace membership')}
            control={<Switch label="Let guests ask to join as members" disabled={plan === 'free'} checked={spaceSetting(space, 'allow_guest_member_requests', true)} onChange={(v) => set({ allow_guest_member_requests: v })} />}
          />
          <Row
            id="restricted-teamspaces"
            label={t('lp.settings.adding_restricted_members_to_teams', 'Adding restricted members to teams')}
            description={t('lp.settings.set_who_may_bring_restricted_members', 'Set who may bring restricted members into teams')}
            control={(
              <Dropdown
                disabled={!ent}
                value={spaceSetting(space, 'restricted_members_teamspaces', 'space_owner_and_team_owner')}
                options={[
                  { value: 'space_owner', label: t('lp.settings.workspace_owners', 'Workspace owners') },
                  { value: 'space_owner_and_team_owner', label: t('lp.settings.team_owners_and_workspace_owners', 'Team owners and workspace owners') },
                  { value: 'member', label: t('lp.settings.any_member', 'Any member') },
                ]}
                onChange={(v) => set({ restricted_members_teamspaces: v })}
              />
            )}
          />
          <Row
            id="restricted-pages"
            label={t('lp.settings.who_may_add_restricted_page_members', 'Who may add restricted page members')}
            description={t('lp.settings.set_who_may_bring_restricted_members_266f', 'Set who may bring restricted members onto pages')}
            control={(
              <Dropdown
                disabled={!ent}
                value={spaceSetting(space, 'restricted_members_pages', 'member_with_admin_approval')}
                options={[
                  { value: 'space_owner', label: t('lp.settings.workspace_owners', 'Workspace owners') },
                  { value: 'member_with_admin_approval', label: t('lp.settings.any_member_approved_by_an_admin', 'Any member approved by an admin') },
                  { value: 'member', label: t('lp.settings.any_member', 'Any member') },
                ]}
                onChange={(v) => set({ restricted_members_pages: v })}
              />
            )}
          />
        </Group>
      )}
      {tab === 'retention' && <RetentionTab space={space} plan={plan} />}
    </SectionPage>
  );
}

const RETENTION_DAYS = [1, 7, 14, 30, 60, 90, 180, 365, 3650];

const durationLabel = retentionDurationLabel;

function RetentionTab({ space, plan }: { space: SpaceRecord; plan: PlanType }) {
  const ent = planAtLeast(plan, 'enterprise');
  const opts = RETENTION_DAYS.map((d) => ({ value: String(d), label: durationLabel(d) }));
  return (
    <Group>
      <Row
        id="trash-retention"
        label={t('lp.settings.how_long_pages_stay_in_trash', 'How long pages stay in Trash')}
        description={(
          <>
            {t('lp.settings.choose_how_long_pages_stay_in', 'Choose how long pages stay in Trash. Anyone with edit or full access can still delete or restore a page manually at any time.')}
            {!ent && <Upsell text={msg('lp.settings.upgrade_to_choose_when_trash_is', '<highlight>Upgrade</highlight> to choose when Trash is cleared automatically')} />}
          </>
        )}
        control={<Dropdown disabled={!ent} value={String(trashRetentionDays(space))} options={opts} onChange={(v) => saveSpaceSettings(space.id, { trash_retention_days: Number(v) })} />}
      />
      <Row
        id="purge-retention"
        label={t('lp.settings.how_long_deleted_pages_and_ai', 'How long deleted pages and AI chats are kept')}
        description={(
          <>
            {t('lp.settings.choose_how_long_deleted_pages_and', 'Choose how long deleted pages and AI chats remain after leaving Trash before permanent deletion from Litpage servers. Only workspace owners can view or restore pages during this period.')}
            {!ent && <Upsell text={msg('lp.settings.upgrade_to_set_the_trash_recovery', '<highlight>Upgrade</highlight> to set the Trash recovery window')} />}
          </>
        )}
        control={<Dropdown disabled={!ent} value={String(purgeRetentionDays(space))} options={opts} onChange={(v) => saveSpaceSettings(space.id, { purge_retention_days: Number(v) })} />}
      />
      {HELP_URL && <a className="nc-set-help-link" href={HELP_URL} target="_blank" rel="noreferrer">
        <Icon name="questionMarkCircleSmall" size={16} />
        {t('lp.settings.learn_about_litpage_data_retention', 'Learn about Litpage data retention')}
      </a>}
    </Group>
  );
}

// ---------------------------------------------------------------------------------------------- Identity

interface VerifiedDomain { domain: string; status: 'pending' | 'verified'; token: string; created_time: number }

export function IdentitySection() {
  const { space, plan } = useSpaceAccess();
  if (!space) return null;
  const business = planAtLeast(plan, 'business');
  const ent = planAtLeast(plan, 'enterprise');
  const domains = spaceSetting<VerifiedDomain[]>(space, 'verified_domains', []);
  const saml = spaceSetting<{ enabled?: boolean; login?: 'any' | 'saml'; auto_create?: boolean; idp_url?: string }>(space, 'saml', {});
  const setSaml = (patch: Partial<typeof saml>) => saveSpaceSettings(space.id, { saml: { ...saml, ...patch } });
  const addDomain = () => {
    openSubDialog((close) => <AddDomainBody close={close} onAdd={(d) => saveSpaceSettings(space.id, { verified_domains: [...domains, d] })} existing={domains.map((x) => x.domain)} />);
  };
  return (
    <SectionPage title={t('lp.settings.identity', 'Identity')} subtitle={t('lp.settings.configure_scim_and_single_sign_on', 'Configure SCIM and single sign-on')}>
      <Group title={t('lp.settings.verified_domains', 'Verified domains')} description={t('lp.settings.advanced_security_features_like_single_s', 'Advanced security features like single sign-on become available once you confirm you own an email domain')}>
        {!business && <Upsell text={msg('lp.settings.domain_verification_for_sso_and_other', 'Domain verification for SSO and other security features is available when you <highlight>upgrade</highlight>')} />}
        {business && (
          <>
            <table className="nc-set-table">
              <thead><tr><th>{t('lp.settings.domain', 'Domain')}</th><th>{t('lp.settings.status', 'Status')}</th><th style={{ width: 40 }} /></tr></thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.domain}>
                    <td className="primary">{d.domain}</td>
                    <td><span className={`nc-set-status ${d.status}`}>{d.status === 'verified' ? t('lp.settings.verified', 'Verified') : t('lp.settings.pending', 'Pending')}</span></td>
                    <td>
                      <span
                        role="button"
                        className="nc-set-icon-btn"
                        aria-label={t('lp.settings.remove_domain', 'Remove domain')}
                        onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
                          width: 260,
                          sections: [{
                            items: [
                              { label: t('lp.settings.view_details_badd', 'View details'), description: `TXT lit-domain-verification=${d.token}`, onSelect: () => { void navigator.clipboard?.writeText(`lit-domain-verification=${d.token}`); useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete')); } },
                              { label: t('lp.settings.remove_domain', 'Remove domain'), danger: true, onSelect: () => saveSpaceSettings(space.id, { verified_domains: domains.filter((x) => x.domain !== d.domain) }) },
                            ],
                          }],
                        }, { placement: 'bottom-end' })}
                      >
                        <Icon name="ellipsisSmall" size={16} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!domains.length && <div className="nc-set-empty">{t('lp.settings.no_domains_set_up', 'No domains set up.')}</div>}
            <div><Button icon="plusSmall" onClick={addDomain}>{t('lp.settings.add_domain', 'Add domain')}</Button></div>
          </>
        )}
      </Group>
      <Group title={t('lp.settings.saml_single_sign_on_sso', 'SAML sign-in (SSO)')}>
        <Row
          id="saml-enabled"
          label={t('lp.settings.turn_on_saml_sso', 'Turn on SAML SSO')}
          description={t('lp.settings.members_whose_email_belongs_to_a', 'Members whose email belongs to a verified domain can sign in through SAML SSO')}
          control={<Switch label="Turn on SAML SSO" disabled={!business || !domains.some((d) => d.status === 'verified')} checked={!!saml.enabled} onChange={(v) => setSaml({ enabled: v })} />}
        />
        <Row
          id="saml-login"
          disabled={!saml.enabled}
          label={t('lp.settings.login_method', 'Login method')}
          description={t('lp.settings.choose_how_people_sign_in_when', 'Choose how people sign in when SAML SSO is enabled. Workspace owners can always use a password or passkey.')}
          control={(
            <Dropdown
              disabled={!saml.enabled}
              value={saml.login ?? 'any'}
              options={[
                { value: 'any', label: t('lp.settings.any_method', 'Any method') },
                { value: 'saml', label: t('lp.settings.saml_sso_only', 'SAML SSO only') },
              ]}
              onChange={(v) => setSaml({ login: v })}
            />
          )}
        />
        <Row
          id="saml-auto-create"
          disabled={!saml.enabled}
          label={t('lp.settings.create_accounts_automatically', 'Create accounts automatically')}
          description={t('lp.settings.give_first_time_saml_sso_users', 'Give first-time SAML SSO users a Litpage account automatically')}
          control={<Switch label="Create accounts automatically" disabled={!saml.enabled} checked={!!saml.auto_create} onChange={(v) => setSaml({ auto_create: v })} />}
        />
        {!business && <Upsell text={msg('lp.settings.upgrade_to_business_to_set_up', '<highlight>Upgrade</highlight> to Business to set up SAML single sign-on')} />}
      </Group>
      <Group title={t('lp.settings.scim_provisioning', 'SCIM provisioning')}>
        {!ent
          ? <Upsell text={msg('lp.settings.upgrade_to_enterprise_to_provision_users', '<highlight>Upgrade</highlight> to Enterprise to provision users with SCIM')} />
          : <div className="nc-set-row-desc">{t('lp.settings.scim_tokens_are_managed_in_the', 'SCIM tokens are managed in the organization console.')}</div>}
      </Group>
      <Group title={t('lp.settings.user_management', 'User management')}>
        {!ent
          ? <Upsell text={msg('lp.settings.upgrade_to_choose_how_long_managed', '<highlight>Upgrade</highlight> to choose how long managed user sessions last before sign-in is required again')} />
          : <div className="nc-set-row-desc">{t('lp.settings.managed_users_require_at_least_one', 'Managed users require at least one verified domain.')}</div>}
      </Group>
      <Group title={t('lp.settings.setup_details_for_scim_and_saml', 'Setup details for SCIM and SAML SSO')}>
        <IdRow label={t('lp.settings.workspace_id', 'Workspace ID')} id={space.id} />
      </Group>
    </SectionPage>
  );
}

function AddDomainBody({ close, onAdd, existing }: { close: () => void; onAdd: (d: VerifiedDomain) => void; existing: string[] }) {
  const [v, setV] = useState('');
  const d = v.trim().toLowerCase();
  const valid = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d);
  const dup = existing.includes(d);
  return (
    <>
      <h3>{t('lp.settings.add_domain', 'Add domain')}</h3>
      <div className="nc-set-input"><input autoFocus placeholder="example.com" value={v} onChange={(e) => setV(e.target.value)} /></div>
      {dup && <div className="error">{t('lp.settings.this_domain_was_already_added', 'This domain was already added')}</div>}
      <div className="actions">
        <Button
          variant="primary"
          disabled={!valid || dup}
          onClick={() => {
            onAdd({ domain: d, status: 'pending', token: crypto.randomUUID().replace(/-/g, ''), created_time: Date.now() });
            close();
          }}
        >
          {t('lp.settings.continue', 'Continue')}
        </Button>
        <Button onClick={close}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------------------------- Requests

export interface MemberRequest { id: string; emails: string[]; requested_by: string; created_time: number; via?: string; self?: boolean; message?: string; team_id?: string }
interface GuestInviteRequest { id: string; kind: string; pageId: string; requesterId: string; emails: string[]; role: string | null; message: string; createdTime: number; restricted?: boolean }
export interface UpgradeRequest { id: string; plan: string; note?: string; requested_by: string; created_time: number }

export function RequestsSection() {
  const { space, admin, owner } = useSpaceAccess();
  // guest invite requests (members asking to invite guests; server: requests.ts)
  const [guestRequests, setGuestRequests] = useState<GuestInviteRequest[] | null>(null);
  useEffect(() => {
    if (!space?.id || !admin) return;
    let live = true;
    api<{ requests: GuestInviteRequest[]; recordMap: any }>('getWorkspaceRequests', { spaceId: space.id })
      .then((r) => { if (!live) return; records.mergeRecordMap(r.recordMap); setGuestRequests(r.requests); })
      .catch(() => { if (live) setGuestRequests([]); });
    return () => { live = false; };
  }, [space?.id, admin]);
  if (!space) return null;
  const memberReqs = spaceSetting<MemberRequest[]>(space, 'member_requests', []);
  const upgradeReqs = spaceSetting<UpgradeRequest[]>(space, 'upgrade_requests', []);
  const resolve = async (requestId: string, approve: boolean) => {
    try {
      await spaceApi('resolveMemberRequest', { spaceId: space.id, requestId, approve });
    } catch (e) {
      toastError(e);
    }
  };
  const userName = (id: string) => {
    const u = records.get<UserRecord>('lit_user', id);
    return u?.name || u?.email || '—';
  };
  const guestReqs = guestRequests ?? [];
  const resolveGuest = async (requestId: string, approve: boolean) => {
    try {
      await api('decideAccessRequest', { requestId, approve });
      setGuestRequests((list) => (list ?? []).filter((r) => r.id !== requestId));
    } catch (e) {
      toastError(e);
    }
  };
  return (
    <SectionPage title={t('lp.settings.requests', 'Requests')} subtitle={t('lp.settings.review_member_and_add_on_requests', 'Review member and add-on requests')}>
      <Group title={t('lp.settings.permissions', 'Permissions')}>
        <Row
          id="allow-upgrade-requests"
          label={t('lp.settings.let_members_request_upgrades', 'Let members request upgrades')}
          description={t('lp.settings.people_in_this_workspace_can_request', 'People in this workspace can request a plan upgrade, add-ons, or other changes from an owner')}
          control={<span data-tooltip={owner ? undefined : policyTooltip.ownersOnly()}><Switch label="Let members request upgrades" disabled={!owner} checked={spaceSetting(space, 'allow_upgrade_requests', true)} onChange={(v) => saveSpaceSettings(space.id, { allow_upgrade_requests: v })} /></span>}
        />
        <Row
          id="allow-member-requests"
          label={t('lp.settings.let_members_ask_to_add_other', 'Let members ask to add other members')}
          description={t('lp.settings.let_members_request_that_admins_add', 'Let members request that admins add more people')}
          control={<span data-tooltip={owner ? undefined : policyTooltip.ownersOnly()}><Switch label="Let members ask to add members" disabled={!owner} checked={spaceSetting(space, 'allow_member_requests', true)} onChange={(v) => saveSpaceSettings(space.id, { allow_member_requests: v })} /></span>}
        />
      </Group>
      <Group title={t('lp.settings.people', 'People')}>
        {!memberReqs.length && !guestReqs.length && <div className="nc-set-empty">{t('lp.settings.no_invitation_requests_so_far', 'No invitation requests so far')}</div>}
        {memberReqs.map((r) => {
          // "Request to join" from an allowed email domain (General › Verified email domains), the guest banner or a teamspace
          // invite link: the person asked themselves
          const self = r.via === 'allowed_email_domain' || !!r.self;
          const domain = (r.emails[0] ?? '').split('@')[1] ?? '';
          return (
            <div key={r.id} className="nc-set-request">
              <div className="main">
                <div className="ttl">{t('lp.settings.make_a_member', 'Make {actorEmail} a member', { actorEmail: r.emails.join(', ') })}</div>
                <div className="sub">
                  {self
                    ? t('lp.settings.member_request', 'Member request')
                    : rich(msg('lp.settings.submitted_by', 'Submitted by <b>{actorName}</b>'), { actorName: userName(r.requested_by) }, { b: (c) => <strong>{c}</strong> })}
                  {' · '}{fmtDate(r.created_time)}
                  {r.message ? ` · “${r.message}”` : ''}
                </div>
              </div>
              <Button onClick={() => void resolve(r.id, false)}>{t('lp.settings.decline', 'Decline')}</Button>
              <Button variant="primary" title={self && domain ? t('lp.settings.once_approved_this_user_will_join', 'Once approved, this user will join the workspace automatically because {domain} is an allowed email domain', { domain }) : undefined} onClick={() => void resolve(r.id, true)}>{t('lp.settings.approve', 'Approve')}</Button>
            </div>
          );
        })}
        {guestReqs.map((r) => (
          <div key={r.id} className="nc-set-request" data-kind="guest-invite">
            <div className="main">
              <div className="ttl">{r.restricted
                ? t('lp.settings.let_view_this_page', 'Let {actorEmail} view this page', { actorEmail: r.emails.join(', ') })
                : t('lp.settings.give_guest_access', 'Give {actorEmail} guest access', { actorEmail: r.emails.join(', ') })}</div>
              <div className="sub">{rich(msg('lp.settings.submitted_by', 'Submitted by <b>{actorName}</b>'), { actorName: userName(r.requesterId) }, { b: (c) => <strong>{c}</strong> })} · {fmtDate(r.createdTime)}{r.message ? ` · “${r.message}”` : ''}</div>
            </div>
            <Button onClick={() => void resolveGuest(r.id, false)}>{t('lp.settings.decline', 'Decline')}</Button>
            <Button variant="primary" onClick={() => void resolveGuest(r.id, true)}>{t('lp.settings.approve', 'Approve')}</Button>
          </div>
        ))}
      </Group>
      <Group title={t('lp.settings.upgrades', 'Upgrades')}>
        {!upgradeReqs.length ? (
          <div className="nc-set-empty-card">
            <div>{t('lp.settings.nobody_in_your_workspace_has_asked', 'Nobody in your workspace has asked for an upgrade')}</div>
            <Button onClick={() => useUI.getState().set({ settingsSection: 'plans' })}>{t('lp.settings.explore_plans', 'Explore plans')}</Button>
          </div>
        ) : (
          <table className="nc-set-table">
            <thead>
              <tr>
                <th>{t('lp.settings.upgrade_plan', 'Upgrade Plan')}</th>
                <th>{t('lp.settings.requested_by', 'Requested By')}</th>
                <th>{t('lp.settings.date', 'Date')}</th>
                <th>{t('lp.settings.note', 'Note')}</th>
                <th style={{ width: 110 }} />
              </tr>
            </thead>
            <tbody>
              {upgradeReqs.map((r) => (
                <tr key={r.id}>
                  <td className="primary">{r.plan === 'lit_ai' ? t('lp.settings.litpage_ai', 'Litpage AI') : r.plan === 'business' ? t('lp.settings.business', 'Business') : r.plan === 'enterprise' ? t('lp.settings.enterprise', 'Enterprise') : r.plan.charAt(0).toUpperCase() + r.plan.slice(1)}</td>
                  <td>{userName(r.requested_by)}</td>
                  <td>{fmtDate(r.created_time)}</td>
                  <td>{r.note || '—'}</td>
                  <td><Button small onClick={() => useUI.getState().set({ settingsSection: 'plans' })}>{t('lp.settings.view_detail', 'View Detail')}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>
    </SectionPage>
  );
}

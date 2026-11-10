import { HELP_URL } from '@nc/shared/brand.ts';
// Sidebar sections (lit-outliner-<kind>-header-container): header with hover chevron + actions
// (Open in Library / Add a page / Open menu), collapsible tree, "View all" row. Data per section type.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, SpaceRecord, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { isArchivedRecord } from '@nc/shared/archive.ts';
import { isSpaceAdmin, teamAccessType, teamMembership } from '@nc/shared/permissions.ts';
import { useCurrentSpace, useCurrentSpaceView, useRecords, useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { navigate, spaceDomain, useLocation } from '../../../lib/router.ts';
import { api } from '../../../lib/api.ts';
import { Icon } from '../../../components/Icon.tsx';
import { newPage, pageTitle } from '../../page/pageActions.ts';
import { t } from '../i18n.ts';
import { DEFAULT_LIMIT, findSection, updateLayout, useSidebarExpand, useSidebarLayout, type SidebarSection } from './model.ts';
import { SECTION_CLASS, SECTION_LIBRARY_TAB, sectionLabel } from './labels.ts';
import { PageTreeItem, EmptyRow, INDENT, dropIntoContainer, outlineChildren, ensureChildrenLoaded, useSidebarDrag, type TreeCtx } from './PageTree.tsx';
import { openSectionMenu, openTeamspaceMenu } from './menus.tsx';
import { TeamIcon } from './TeamIcon.tsx';
import { useChatThreads } from '../../ai/aiApi.ts';
import { ChatThreadIcon, chatUrl, openThreadMenu, UNTITLED_CHAT } from '../../ai/ChatHistory.tsx';
import { AgentsSection } from '../../agents/AgentsSection.tsx';
import { DeveloperSection } from '../../developer/SidebarSection.tsx';
import { runQuery } from '@nc/shared/database/index.ts';
import { collectionOfView, collectionRows, makeQueryContext } from '../../database/data.ts';
import { effectiveView, useViewTempVersion } from '../../database/viewState.ts';

// ---------------- shared data (recents / shared-with-me) ----------------
interface SidebarData {
  recents: string[];
  sharedWithMe: string[];
  set: (p: Partial<SidebarData>) => void;
}
export const useSidebarData = create<SidebarData>((set) => ({ recents: [], sharedWithMe: [], set: (p) => set(p) }));

export function refreshRecents(spaceId: string | null) {
  if (!spaceId) return;
  void api('listRecentPages', { spaceId, limit: 100 })
    .then((res) => {
      records.mergeRecordMap(res.recordMap);
      useSidebarData.getState().set({ recents: res.pages.map((p: { id: string }) => p.id) });
    })
    .catch(() => {});
}

export function refreshSharedWithMe(spaceId: string | null) {
  if (!spaceId) return;
  void api('getSharedWithMe', { spaceId })
    .then((res) => {
      records.mergeRecordMap(res.recordMap);
      useSidebarData.getState().set({ sharedWithMe: res.pageIds ?? [] });
    })
    .catch(() => {});
}

export function useSidebarDataLoader() {
  const spaceId = useSession((s) => s.spaceId);
  const { route } = useLocation();
  const pageId = route.name === 'page' ? route.pageId : null;
  useEffect(() => {
    refreshRecents(spaceId);
    // Workspace records the visit after saving pending transactions, then fires nc:page-visited
    const onVisit = () => refreshRecents(spaceId);
    window.addEventListener('nc:page-visited', onVisit);
    return () => window.removeEventListener('nc:page-visited', onVisit);
  }, [spaceId]);
  void pageId;
  useEffect(() => {
    refreshSharedWithMe(spaceId);
    const onResync = () => {
      refreshRecents(spaceId);
      refreshSharedWithMe(spaceId);
    };
    window.addEventListener('nc:resync', onResync);
    return () => window.removeEventListener('nc:resync', onResync);
  }, [spaceId]);
}

// ---------------- helpers ----------------
function alive(id: string): boolean {
  const b = records.get<BlockRecord>('block', id);
  
  return !!b && b.alive !== false && !isArchivedRecord(b);
}

/** A private-list page that is shared with others (user/public/space permissions) shows under "Shared". */
export function isSharedPage(b: BlockRecord | undefined, uid: string): boolean {
  return !!b?.permissions?.some((p) => (p.type === 'user_permission' && p.user_id && p.user_id !== uid && p.role !== 'none') || p.type === 'public_permission' || p.type === 'space_permission');
}

function sortIds(ids: string[], sort: 'manual' | 'last_edited' | undefined): string[] {
  if (sort !== 'last_edited') return ids;
  return [...ids].sort((a, b) => (records.get<BlockRecord>('block', b)?.last_edited_time ?? 0) - (records.get<BlockRecord>('block', a)?.last_edited_time ?? 0));
}

// ---------------- section shell ----------------

const useSectionDrag = create<{ id: string | null; over: { id: string; after: boolean } | null; set: (p: Partial<{ id: string | null; over: { id: string; after: boolean } | null }>) => void }>((set) => ({
  id: null, over: null, set: (p) => set(p),
}));

function moveSectionTo(dragId: string, targetId: string, after: boolean) {
  updateLayout((l) => {
    const from = findSection(l, dragId);
    const to = findSection(l, targetId);
    if (!from || !to || dragId === targetId) return;
    const [sec] = from.tab.sections.splice(from.index, 1);
    const idx = to.tab.sections.findIndex((s) => s.id === targetId);
    to.tab.sections.splice(after ? idx + 1 : idx, 0, sec);
  });
}

export function SectionShell({ section, children, actions, viewAll, dropTarget, forceShow, title }: {
  section: SidebarSection;
  children: ReactNode;
  actions?: ReactNode;
  viewAll?: boolean;
  dropTarget?: { kind: 'private' } | { kind: 'favorites' };
  forceShow?: boolean;
  /** custom header label (database view sections show the view / database name) */
  title?: string;
}) {
  const key = section.id;
  const collapsed = useSidebarExpand((s) => !!s.collapsed[key]);
  const spaceId = useSession((s) => s.spaceId);
  const libTab = SECTION_LIBRARY_TAB[section.type];
  const cls = SECTION_CLASS[section.type];
  const label = title || sectionLabel(section.type);
  const over = useSidebarDrag((s) => s.over?.key === `header:${key}`);
  const secDragging = useSectionDrag((s) => s.id === key);
  const secOver = useSectionDrag((s) => (s.over?.id === key ? (s.over.after ? 'drop-after' : 'drop-before') : ''));
  void forceShow;
  return (
    <div
      className={`nc-sb-section-drag ${secDragging ? 'dragging' : ''} ${secOver}`}
      onDragOver={(e) => {
        const dragId = useSectionDrag.getState().id;
        if (!dragId || dragId === key) return;
        e.preventDefault();
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const after = e.clientY > r.top + Math.min(r.height / 2, 30);
        const cur = useSectionDrag.getState().over;
        if (cur?.id !== key || cur.after !== after) useSectionDrag.getState().set({ over: { id: key, after } });
      }}
      onDrop={(e) => {
        const dragId = useSectionDrag.getState().id;
        const ov = useSectionDrag.getState().over;
        if (!dragId || !ov) return;
        e.preventDefault();
        useSectionDrag.getState().set({ id: null, over: null });
        moveSectionTo(dragId, ov.id, ov.after);
      }}
    >
    <div className={`lit-outliner-${cls}-header-container nc-sb-section`} data-section={section.type}>
      <div
        className={`lit-outliner-${cls}-header nc-sb-section-header ${over ? 'drop-inside' : ''}`}
        role="button"
        aria-expanded={!collapsed}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/x-nc-section', key);
          useSectionDrag.getState().set({ id: key, over: null });
        }}
        onDragEnd={() => useSectionDrag.getState().set({ id: null, over: null })}
        onClick={() => useSidebarExpand.getState().setCollapsed(key, !collapsed)}
        onDragOver={(e) => {
          if (!dropTarget || !useSidebarDrag.getState().dragging) return;
          e.preventDefault();
          if (!over) useSidebarDrag.getState().set({ over: { key: `header:${key}`, zone: 'inside' } });
        }}
        onDragLeave={() => { if (over) useSidebarDrag.getState().set({ over: null }); }}
        onDrop={(e) => {
          const id = useSidebarDrag.getState().dragging;
          useSidebarDrag.getState().set({ over: null, dragging: null });
          if (!dropTarget || !id) return;
          e.preventDefault();
          dropIntoContainer(id, dropTarget);
          if (collapsed) useSidebarExpand.getState().setCollapsed(key, false);
        }}
      >
        <span className="nc-sb-section-title">{label}</span>
        <Icon name="arrowChevronSingleDownSmall" size={12} className={`nc-sb-section-chevron ${collapsed ? 'collapsed' : ''}`} />
        <div style={{ marginInlineStart: 'auto' }}>
          <div className="nc-sb-section-actions">
            {libTab && (
              <div
                role="button"
                aria-label={t('lp.shell.open_library', 'Open Library')}
                className="nc-sb-mini-btn"
                data-tooltip={t('lp.shell.open_library', 'Open Library')}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/${spaceDomain(spaceId)}/library/${libTab}`);
                }}
              >
                <Icon name="arrowDiagonalUpRightSmall" size={16} />
              </div>
            )}
            {actions}
            <div
              role="button"
              aria-label={t('lp.shell.open_menu', 'Open menu')}
              aria-haspopup="dialog"
              className="nc-sb-mini-btn"
              onClick={(e) => {
                e.stopPropagation();
                openSectionMenu(section.id, e.currentTarget as HTMLElement);
              }}
            >
              <Icon name="ellipsisSmall" size={16} />
            </div>
          </div>
        </div>
      </div>
      {!collapsed && children}
      {!collapsed && viewAll && libTab && <ViewAllRow onClick={() => navigate(`/${spaceDomain(spaceId)}/library/${libTab}`)} />}
    </div>
    </div>
  );
}

export function ViewAllRow({ onClick }: { onClick: () => void }) {
  return (
    <div role="button" aria-haspopup="dialog" className="nc-sb-row nc-sb-viewall" onClick={onClick}>
      <div className="nc-sb-row-inner">
        <div className="nc-sb-row-icon"><Icon name="ellipsis" size={20} /></div>
        <div className="nc-sb-row-label">{t('lp.shell.view_all', 'View all')}</div>
      </div>
    </div>
  );
}

function PageList({ ids, limit, ctx, section, viewAllWhenTruncated, empty }: {
  ids: string[];
  limit: number;
  ctx: TreeCtx;
  section: SidebarSection;
  viewAllWhenTruncated?: boolean;
  empty?: ReactNode;
}) {
  const shown = ids.slice(0, limit);
  return (
    <>
      <div role="tree" className="nc-sb-tree">
        {shown.map((id) => <PageTreeItem key={id} pageId={id} depth={0} ctx={ctx} section={section.id} />)}
        {!shown.length && empty}
      </div>
      {viewAllWhenTruncated && ids.length > limit && <ViewAllRowFor section={section} />}
    </>
  );
}

function ViewAllRowFor({ section }: { section: SidebarSection }) {
  const spaceId = useSession((s) => s.spaceId);
  const tab = SECTION_LIBRARY_TAB[section.type] ?? 'recents';
  return <ViewAllRow onClick={() => navigate(`/${spaceDomain(spaceId)}/library/${tab}`)} />;
}

// ---------------- section bodies ----------------
export function SectionView({ section }: { section: SidebarSection }) {
  switch (section.type) {
    case 'upcoming_events':
      return <UpcomingEventsSection section={section} />;
    case 'recents':
      return <RecentsSection section={section} />;
    case 'favorites':
      return <FavoritesSection section={section} />;
    case 'teamspaces':
      return <TeamspacesSection section={section} />;
    case 'shared':
      return <SharedSection section={section} />;
    case 'private':
      return <PrivateSection section={section} />;
    case 'teamspace':
      return <SingleTeamspaceSection section={section} />;
    case 'lit_apps':
      return <LitAppsSection section={section} />;
    case 'chats':
      return <ChatsSection section={section} />;
    case 'pinned_chats':
      return <ChatsSection section={section} pinned />;
    case 'ai_meeting_notes':
      return <MeetingNotesSection section={section} />;
    case 'database_view':
      return <DatabaseViewSection section={section} />;
    case 'agents':
      return <AgentsSection section={section} />;
    case 'developer':
      return <DeveloperSection section={section} />;
    default:
      return <EmptySection section={section} />;
  }
}

function limitOf(section: SidebarSection) {
  return section.limit ?? DEFAULT_LIMIT[section.type] ?? 5;
}

function UpcomingEventsSection({ section }: { section: SidebarSection }) {
  return (
    <SectionShell section={section}>
      <div className="nc-sb-tree">
        <div role="button" className="nc-sb-row" onClick={() => useUI.getState().openSettings('mail-calendar')}>
          <div className="nc-sb-row-inner">
            <div className="nc-sb-row-icon"><Icon name="calendarConnect" size={20} /></div>
            <div className="nc-sb-row-label" style={{ fontWeight: 400 }}>{t('lp.shell.link_your_calendar', 'Link your calendar')}</div>
          </div>
        </div>
      </div>
    </SectionShell>
  );
}

function RecentsSection({ section }: { section: SidebarSection }) {
  const recents = useSidebarData((s) => s.recents);
  useRecords<BlockRecord>('block', recents);
  const ids = recents.filter(alive);
  if (!ids.length) return null;
  return (
    <SectionShell section={section}>
      <PageList ids={ids} limit={limitOf(section)} ctx={{ kind: 'recents' }} section={section} viewAllWhenTruncated />
    </SectionShell>
  );
}


function DatabaseViewSection({ section }: { section: SidebarSection }) {
  const blockId = section.blockId;
  const block = useRecords<BlockRecord>('block', blockId ? [blockId] : [])[0];
  const ver = useTableVersion(['block', 'collection', 'collection_view']);
  useEffect(() => {
    if (blockId) void api('loadPage', { pageId: blockId }).then((r) => records.mergeRecordMap(r.recordMap)).catch(() => {});
  }, [blockId]);
  const view = records.get<CollectionViewRecord>('collection_view', section.viewId ?? block?.view_ids?.[0]);
  // a linked view reads its own data source
  const col = collectionOfView(view, block) ?? records.get<CollectionRecord>('collection', block?.collection_id);
  const temp = useViewTempVersion();
  const ids = useMemo(() => {
    if (!col) return [];
    const rows = collectionRows(col.id);
    // what the view shows: its filters and sorts (and the person's own unsaved ones), in its order
    if (view) {
      try {
        return runQuery(rows, col, effectiveView(view), makeQueryContext()).rows.map((b) => b.id);
      } catch {
        /* a broken view: fall back to every row */
      }
    }
    return rows.map((b) => b.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col?.id, view?.id, ver, temp]);
  if (!block || block.alive === false) return <EmptySection section={section} />;
  const dbName = toPlainText(col?.name as never) || pageTitle(block) || t('lp.shell.untitled', 'Untitled');
  const title = view?.name && (block.view_ids?.length ?? 0) > 1 ? `${dbName} · ${view.name}` : dbName;
  return (
    <SectionShell section={section} title={title}>
      {ids.length
        ? <PageList ids={ids} limit={limitOf(section)} ctx={{ kind: 'recents' }} section={section} viewAllWhenTruncated />
        : <EmptyRow depth={0} label={t('lp.shell.no_pages_inside', 'Empty')} />}
    </SectionShell>
  );
}


function MeetingNotesSection({ section }: { section: SidebarSection }) {
  const spaceId = useSession((s) => s.spaceId);
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => void api<{ pageIds: string[]; recordMap: unknown }>('getLibraryMeetingNotes', { spaceId, limit: 50 })
      .then((r) => { if (!alive) return; records.mergeRecordMap(r.recordMap as never); setIds(r.pageIds); })
      .catch(() => {});
    load();
    window.addEventListener('nc:page-visited', load);
    return () => {
      alive = false;
      window.removeEventListener('nc:page-visited', load);
    };
  }, [spaceId]);
  useRecords<BlockRecord>('block', ids);
  const live = ids.filter(alive);
  return (
    <SectionShell section={section}>
      {live.length
        ? <PageList ids={live} limit={limitOf(section)} ctx={{ kind: 'recents' }} section={section} viewAllWhenTruncated />
        : <EmptyRow depth={0} label={t('lp.shell.no_meeting_notes_yet', 'No meeting notes yet')} />}
    </SectionShell>
  );
}

function FavoritesSection({ section }: { section: SidebarSection }) {
  const sv = useCurrentSpaceView();
  useRecords<BlockRecord>('block', sv?.bookmarked_pages);
  const ids = (sv?.bookmarked_pages ?? []).filter(alive);
  if (!ids.length) return null;
  return (
    <SectionShell section={section} dropTarget={{ kind: 'favorites' }}>
      <PageList ids={ids} limit={limitOf(section)} ctx={{ kind: 'favorites' }} section={section} viewAllWhenTruncated />
    </SectionShell>
  );
}

function SharedSection({ section }: { section: SidebarSection }) {
  const sv = useCurrentSpaceView();
  const space = useCurrentSpace();
  const uid = useSession((s) => s.userId) ?? '';
  const sharedWithMe = useSidebarData((s) => s.sharedWithMe);
  const watched = useRecords<BlockRecord>('block', [...(sv?.private_pages ?? []), ...(space?.pages ?? []), ...sharedWithMe]);
  const ver = watched;
  const ids = useMemo(() => {
    const fromPrivate = (sv?.private_pages ?? []).filter((id) => alive(id) && isSharedPage(records.get<BlockRecord>('block', id), uid));
    const workspace = (space?.pages ?? []).filter(alive);
    const all = [...new Set([...fromPrivate, ...workspace, ...sharedWithMe.filter(alive)])];
    return sortIds(all, section.sort);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sv, space, uid, sharedWithMe, ver, section.sort]);
  if (!ids.length) return null;
  return (
    <SectionShell section={section}>
      <PageList ids={ids} limit={limitOf(section)} ctx={{ kind: 'shared' }} section={section} viewAllWhenTruncated />
    </SectionShell>
  );
}

function PrivateSection({ section }: { section: SidebarSection }) {
  const sv = useCurrentSpaceView();
  const uid = useSession((s) => s.userId) ?? '';
  const ver = useRecords<BlockRecord>('block', sv?.private_pages);
  const ids = useMemo(
    () => sortIds((sv?.private_pages ?? []).filter((id) => alive(id) && !isSharedPage(records.get<BlockRecord>('block', id), uid)), section.sort),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sv, uid, ver, section.sort],
  );
  return (
    <SectionShell
      section={section}
      dropTarget={{ kind: 'private' }}
      actions={
        <div
          role="button"
          aria-label={t('lp.shell.create_a_page', 'Create a page')}
          className="nc-sb-mini-btn"
          data-tooltip={t('lp.shell.create_a_page', 'Create a page')}
          onClick={(e) => {
            e.stopPropagation();
            newPage({ kind: 'private' });
          }}
        >
          <Icon name="plusSmall" size={16} />
        </div>
      }
    >
      <PageList
        ids={ids}
        limit={limitOf(section)}
        ctx={{ kind: 'private' }}
        section={section}
        viewAllWhenTruncated
        empty={<EmptyRow depth={0} label={t('lp.shell.no_pages_inside', 'Empty')} />}
      />
    </SectionShell>
  );
}

function TeamspacesSection({ section }: { section: SidebarSection }) {
  const sv = useCurrentSpaceView();
  const teams = useRecords<TeamRecord>('team', sv?.joined_teams);
  const spaceId = useSession((s) => s.spaceId);
  const uid = useSession((s) => s.userId);
  // closed / private teamspaces stay in the sidebar only while I'm a member (owners can remove people)
  const live = teams.filter((x): x is TeamRecord => !!x && x.alive !== false && !x.archived_by && (!!teamMembership(x, uid) || teamAccessType(x) === 'open'));
  return (
    <SectionShell section={section}>
      <div className="nc-sb-tree">
        {live.slice(0, limitOf(section)).map((team) => <TeamItem key={team.id} team={team} section={section.id} />)}
      </div>
      <ViewAllRow onClick={() => navigate(`/${spaceDomain(spaceId)}/library/teamspaces`)} />
    </SectionShell>
  );
}

function SingleTeamspaceSection({ section }: { section: SidebarSection }) {
  const team = records.get<TeamRecord>('team', section.teamId);
  if (!team || team.alive === false) return <EmptySection section={section} />;
  return (
    <SectionShell section={section}>
      <div className="nc-sb-tree">
        <TeamItem team={team} section={section.id} />
      </div>
    </SectionShell>
  );
}

export function TeamItem({ team, section }: { team: TeamRecord; section: string }) {
  const key = `${section}:team:${team.id}`;
  const expanded = useSidebarExpand((s) => s.expanded[key] ?? false);
  const over = useSidebarDrag((s) => s.over?.key === `team:${team.id}`);
  useRecords<BlockRecord>('block', team.team_pages);
  const pages = (team.team_pages ?? []).filter(alive);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (expanded) for (const id of pages) ensureChildrenLoaded(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);
  const toggle = () => useSidebarExpand.getState().setExpanded(key, !expanded);
  
  const sidebarLocked = teamSidebarLocked(team);
  return (
    <div className="lit-outliner-team-container nc-sb-team-container">
      <div
        ref={ref}
        className={`lit-outliner-team nc-sb-team ${over ? 'drop-inside' : ''}`}
        role="button"
        aria-expanded={expanded}
        onClick={toggle}
        onDragOver={(e) => {
          if (!useSidebarDrag.getState().dragging) return;
          e.preventDefault();
          if (!over) useSidebarDrag.getState().set({ over: { key: `team:${team.id}`, zone: 'inside' } });
        }}
        onDragLeave={() => { if (over) useSidebarDrag.getState().set({ over: null }); }}
        onDrop={(e) => {
          const id = useSidebarDrag.getState().dragging;
          useSidebarDrag.getState().set({ over: null, dragging: null });
          if (!id) return;
          e.preventDefault();
          dropIntoContainer(id, { kind: 'team', teamId: team.id });
          useSidebarExpand.getState().setExpanded(key, true);
        }}
      >
        <div className="nc-sb-team-icon">
          <div className="nc-sb-team-icon-layer"><TeamIcon team={team} size={20} /></div>
          <div className="nc-sb-team-toggle-layer">
            <div role="button" aria-label={t('lp.shell.open', 'Open')} className="nc-sb-toggle">
              <Icon name="arrowChevronSingleDownFillSmall" size={12} style={{ transform: expanded ? 'none' : 'rotateZ(-90deg)', transition: 'transform 200ms ease-out', color: 'var(--lp-icon-tertiary)' }} />
            </div>
          </div>
        </div>
        <div className="nc-sb-team-name nc-ellipsis">{team.name}</div>
        <div className="nc-sb-team-actions">
          <div
            role="button"
            aria-label={t('lp.shell.members_and_team_settings', 'Members and team settings...')}
            aria-haspopup="dialog"
            className="nc-sb-mini-btn lit-outliner-team-context-menu-button"
            data-tooltip={t('lp.shell.members_and_team_settings', 'Members and team settings...')}
            onClick={(e) => {
              e.stopPropagation();
              openTeamspaceMenu(team, e.currentTarget as HTMLElement);
            }}
          >
            <Icon name="ellipsisSmall" size={16} />
          </div>
          <div
            role="button"
            aria-label={t('lp.shell.create_a_page', 'Create a page')}
            aria-disabled={sidebarLocked || undefined}
            className={`nc-sb-mini-btn${sidebarLocked ? ' disabled' : ''}`}
            data-tooltip={sidebarLocked ? t('lp.shell.only_team_owners_can_edit_the', 'Only team owners can edit the team sidebar') : t('lp.shell.create_a_page', 'Create a page')}
            onClick={(e) => {
              e.stopPropagation();
              if (sidebarLocked) return;
              useSidebarExpand.getState().setExpanded(key, true);
              newPage({ kind: 'team', teamId: team.id });
            }}
          >
            <Icon name="plusSmall" size={16} />
          </div>
        </div>
      </div>
      {expanded && (
        <div role="group" className="nc-sb-children">
          {pages.length
            ? pages.map((id) => <PageTreeItem key={id} pageId={id} depth={1} ctx={{ kind: 'team', teamId: team.id }} section={section} />)
            : <EmptyRow depth={1} label={t('lp.shell.no_pages_inside', 'Empty')} />}
        </div>
      )}
    </div>
  );
}

/** Mirrors the server (authz.ts checkTeam + policy.ts teamSidebarProblem): teamspace owners and workspace admins always
 *  edit the teamspace sidebar; members only when it isn't owners-only and their default page access lets them edit. */
function teamSidebarLocked(team: TeamRecord): boolean {
  const uid = useSession.getState().userId;
  const st = (team.settings ?? {}) as Record<string, unknown>;
  if ((team.membership ?? []).some((m) => m.user_id === uid && m.role === 'owner')) return false;
  if (uid && isSpaceAdmin(records.get<SpaceRecord>('space', team.space_id), uid)) return false;
  if (st.sidebar_edit === 'owners') return true;
  const role = String(st.default_page_role ?? 'editor');
  return role === 'comment_only' || role === 'reader';
}


function ChatsSection({ section, pinned }: { section: SidebarSection; pinned?: boolean }) {
  const spaceId = useSession((s) => s.spaceId);
  const all = useChatThreads((s) => s.threads);
  
  const layout = useSidebarLayout();
  const pinnedHome = useMemo(() => layout.tabs.some((tab) => tab.sections.some((sec) => sec.type === 'pinned_chats')), [layout]);
  const threads = useMemo(
    () => (pinned ? all.filter((th) => th.pinned) : pinnedHome ? all.filter((th) => !th.pinned) : [...all.filter((th) => th.pinned), ...all.filter((th) => !th.pinned)]),
    [all, pinned, pinnedHome],
  );
  const { route } = useLocation();
  const activeId = route.name === 'chat' ? route.chatId : undefined;
  useEffect(() => {
    if (spaceId) void useChatThreads.getState().load(spaceId);
  }, [spaceId]);
  return (
    <SectionShell section={section}>
      <div role="tree" className="nc-sb-tree">
        {threads.slice(0, limitOf(section)).map((th) => (
          <div key={th.id} className="nc-sb-page">
            <a
              role="treeitem"
              href={chatUrl(th.id)}
              aria-selected={th.id === activeId}
              className={`nc-sb-item ${th.id === activeId ? 'selected' : ''}`}
              onClick={(e) => {
                e.preventDefault();
                if (e.metaKey || e.ctrlKey) window.open(chatUrl(th.id), '_blank');
                else navigate(chatUrl(th.id));
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                openThreadMenu(th, e.currentTarget as HTMLElement, () => { if (th.id === activeId) navigate(chatUrl()); });
              }}
            >
              <div className="nc-sb-item-inner">
                <div className="nc-sb-item-icon"><ChatThreadIcon t={th} size={20} /></div>
                <div className="nc-sb-item-title"><div className="notranslate nc-ellipsis">{th.title || UNTITLED_CHAT}</div></div>
                <div className="nc-sb-item-actions">
                  <div className="nc-sb-item-actions-inner">
                    <div
                      role="button"
                      aria-label={t('lp.shell.open_menu', 'Open menu')}
                      className="nc-sb-mini-btn"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        openThreadMenu(th, e.currentTarget as HTMLElement, () => { if (th.id === activeId) navigate(chatUrl()); });
                      }}
                    >
                      <Icon name="ellipsisSmall" size={16} />
                    </div>
                  </div>
                </div>
              </div>
            </a>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function LitAppsSection({ section }: { section: SidebarSection }) {
  
  const sv = useCurrentSpaceView();
  if ((sv?.settings as { show_lit_apps?: boolean } | undefined)?.show_lit_apps === false) return null;
  return (
    <SectionShell section={section}>
      <div className="nc-sb-tree">
        {(HELP_URL ? [
          { label: t('lp.shell.calendar', 'Calendar'), icon: 'calendarAlt', url: HELP_URL! },
        ] : []).map((a) => (
          <div key={a.label} role="button" className="nc-sb-row" onClick={() => window.open(a.url, '_blank')}>
            <div className="nc-sb-row-inner">
              <div className="nc-sb-row-icon"><Icon name={a.icon} size={20} /></div>
              <div className="nc-sb-row-label" style={{ fontWeight: 400 }}>{a.label}</div>
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

function EmptySection({ section }: { section: SidebarSection }) {
  return (
    <SectionShell section={section}>
      <div className="nc-sb-tree" />
    </SectionShell>
  );
}

export { outlineChildren, INDENT };

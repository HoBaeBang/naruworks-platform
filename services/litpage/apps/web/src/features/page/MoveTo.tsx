import { HELP_URL } from '@nc/shared/brand.ts';
// "Move to" picker (⌘⇧P, ••• → Move to): 330×453 popover with
// a "Move page to…" search field, "Suggested" pages as an expandable tree (› loads child pages), search
// results (pages, Private pages, teamspaces) and a footer with the current workspace.
// The footer switches workspaces: destinations in another workspace duplicate the page there after a
// "Page will be duplicated, not moved" confirmation (server `duplicateToSpace`); the list of other workspaces is hidden
// when Settings › Security › "Disable duplicating pages to other workspaces" is on.
import { useEffect, useMemo, useRef, useState } from 'react';
import { compactId } from '@nc/shared/ids.ts';
import type { BlockRecord, SpaceRecord, SpaceViewRecord, TeamRecord, UserRootRecord } from '@nc/shared/records.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { closePeek, navigate } from '../../lib/router.ts';
import { confirmDialog } from './confirm.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { getBlock, moveBlocksIn, run } from '../../lib/blocks.ts';
import { useTableVersion } from '../../lib/hooks.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';
import { pageTitle, trashPage } from './pageActions.ts';
import { useUI } from '../../lib/store/ui.ts';
import './pageIcons.tsx';

const PAGE_TYPES = new Set(['page', 'collection_view_page']);

function anchorRect(anchor: Anchor): DOMRect | null {
  if (anchor instanceof HTMLElement) return anchor.getBoundingClientRect();
  if (anchor instanceof DOMRect) return anchor;
  return null;
}

/** `addTo`: a brand-new page in preview mode (sidebar New page shortcut), searched with "Search page to add to…";
 *  sending it to another workspace duplicates it there and trashes the draft here. */
export function openMoveToDialog(ids: string[], anchor: Anchor, opts?: { addTo?: boolean }) {
  const r = anchorRect(anchor);
  const placement = r && r.right > window.innerWidth - 340 ? 'bottom-end' : 'bottom-start';
  // the picker's top edge sits right on the ••• button's bottom (offset 0)
  openOverlay((close) => <MoveTo ids={ids} close={close} addTo={!!opts?.addTo} />, { anchor, placement, offset: 0 });
}

type Target = { kind: 'page'; id: string } | { kind: 'team'; id: string } | { kind: 'private' };

/** The signed-in person's sidebar (space_view) in a workspace, if they are a member there. */
function spaceViewOf(spaceId: string | null | undefined): SpaceViewRecord | undefined {
  const root = records.get<UserRootRecord>('user_root', useSession.getState().userId);
  for (const id of root?.space_views ?? []) {
    const v = records.get<SpaceViewRecord>('space_view', id);
    if (v && v.alive !== false && v.space_id === spaceId) return v;
  }
  return undefined;
}

/** ids of the moved blocks and everything under them (can't move a page into itself). */
function excludedIds(ids: string[]): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    for (const c of getBlock(id)?.content ?? []) walk(c);
  };
  ids.forEach(walk);
  return out;
}

function MoveTo({ ids, close, addTo }: { ids: string[]; close: () => void; addTo?: boolean }) {
  useTableVersion(['block']);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const sessionSpaceId = useSession((s) => s.spaceId);
  // the moved pages' own workspace — not the session's: a guest's page lives in a workspace they aren't a member of,
  // and pages only move inside their workspace (other workspaces get a duplicate)
  const homeSpaceId = records.get<BlockRecord>('block', ids[0])?.space_id ?? sessionSpaceId;
  const [spaceId, setSpaceId] = useState<string | null>(homeSpaceId);
  const space = records.get<SpaceRecord>('space', spaceId);
  const crossSpace = !!spaceId && spaceId !== homeSpaceId;
  const [targetTeams, setTargetTeams] = useState<string[]>([]);
  const excluded = useMemo(() => excludedIds(ids), [ids]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setSuggested([]);
    void api('listRecentPages', { spaceId, limit: 20 }).then((res) => {
      records.mergeRecordMap(res.recordMap);
      setSuggested((res.pages ?? []).map((p: any) => p.id));
    }).catch(() => {});
    if (spaceId && spaceId !== homeSpaceId) {
      void api('getMoveTargets', { spaceId }).then((res) => {
        records.mergeRecordMap(res.recordMap);
        setTargetTeams(res.teamIds ?? []);
      }).catch(() => setTargetTeams([]));
    }
  }, [spaceId, homeSpaceId]);
  useEffect(() => {
    if (!q.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const res = await api('searchWorkspace', { query: q, spaceId, limit: 20 });
        records.mergeRecordMap(res.recordMap);
        setResults(res.results.map((r: any) => r.id));
      } catch {
        setResults([]);
      }
    }, 120);
    return () => clearTimeout(timer);
  }, [q, spaceId]);

  // my sidebar in the page's workspace (none for a guest: no Private section or teamspaces to move to there)
  const sv = spaceViewOf(homeSpaceId);
  const teams = (crossSpace ? targetTeams : (sv?.joined_teams ?? [])).map((id) => records.get<TeamRecord>('team', id)).filter(Boolean) as TeamRecord[];
  const ok = (id: string) => {
    const b = records.get<BlockRecord>('block', id);
    return !!b && b.alive !== false && PAGE_TYPES.has(b.type) && !excluded.has(id) && (!spaceId || b.space_id === spaceId);
  };
  const destinationName = (target: Target) => (target.kind === 'page' ? pageTitle(getBlock(target.id)) || 'page' : target.kind === 'team' ? records.get<TeamRecord>('team', target.id)?.name ?? 'Teamspace' : t('lp.page.private', 'Private'));
  const moveTo = (target: Target) => {
    if (crossSpace) {
      void duplicateTo(target);
      return;
    }
    run('moveTo', (tx) => {
      if (target.kind === 'page') {
        const p = getBlock(target.id);
        moveBlocksIn(tx, ids, { parentId: target.id, parentTable: 'block', after: p?.content?.[p.content.length - 1] });
      } else if (target.kind === 'team') moveBlocksIn(tx, ids, { parentId: target.id, parentTable: 'team' });
      else if (sv) moveBlocksIn(tx, ids, { parentId: sv.space_id, parentTable: 'space', list: { table: 'space_view', id: sv.id, path: ['private_pages'] }, first: true });
    });
    useUI.getState().toast(`Moved to ${destinationName(target)}`);
    close();
  };
  // another workspace: confirm, then the server duplicates the page tree there
  const duplicateTo = async (target: Target) => {
    close();
    const ok2 = await confirmDialog({
      width: 360,
      danger: false,
      message: t('lp.page.this_creates_a_copy_instead_of', 'This creates a copy instead of moving the page'),
      description: (
        <>
          <p style={{ margin: '0 0 8px' }}>{t('lp.page.the_current_workspace_page_stays_unchang', 'The current workspace page stays unchanged, and a copy is created in the workspace you choose.')}</p>
          <p style={{ margin: 0 }}>{t('lp.page.links_relations_permissions_page_history', 'Links, relations, permissions, page history, and other content or settings might not work correctly in the copy.')}{' '}
            {HELP_URL && (<a href={HELP_URL} target="_blank" rel="noreferrer">{t('lp.page.learn_more', 'Learn more')}</a>)} </p>
        </>
      ),
      confirmLabel: t('lp.page.confirm_and_duplicate', 'Confirm and duplicate'),
    });
    if (!ok2 || !spaceId) return;
    try {
      const parent = target.kind === 'team' ? { kind: 'team', teamId: target.id } : target.kind === 'page' ? { kind: 'page', pageId: target.id } : { kind: 'private' };
      const res = await api<{ blockIds: string[]; domain: string; recordMap: any }>('duplicateToSpace', { blockIds: ids, spaceId, parent });
      records.mergeRecordMap(res.recordMap);
      const first = res.blockIds[0];
      // a new page in preview mode lives on in the other workspace only: the draft here goes to Trash
      if (addTo) {
        for (const id of ids) trashPage(id);
        closePeek();
      }
      useUI.getState().toast(
        t('lp.page.moved_to', 'Moved {pageDescriptor} to {destinationName}', {
          pageDescriptor: t('lp.page.numpagesmoved_plural_one_other', '{numPagesMoved, plural, one {# page} other {# pages}}', { numPagesMoved: res.blockIds.length }),
          destinationName: `${space?.name ?? 'workspace'} › ${destinationName(target)}`,
        }),
        { label: t('lp.page.visit', 'Visit'), run: () => { useSession.getState().setSpace(spaceId); navigate(`/${res.domain}/${compactId(first)}`); } },
      );
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? t('lp.page.something_went_wrong_while_processing_th', 'Something went wrong while processing that request.'));
    }
  };

  // Workspaces the page can go to (footer menu); only this one when duplicating to other workspaces is disabled
  const openSpaces = (anchor: HTMLElement) => {
    const home = records.get<SpaceRecord>('space', homeSpaceId);
    const blocked = !!(home?.settings as Record<string, unknown> | undefined)?.disable_move_to_space;
    const root = records.get<UserRootRecord>('user_root', useSession.getState().userId);
    const spaces = (root?.space_views ?? []).map((id) => records.get<SpaceViewRecord>('space_view', id)).filter((v): v is SpaceViewRecord => !!v && v.alive !== false)
      .map((v) => records.get<SpaceRecord>('space', v.space_id)).filter((x): x is SpaceRecord => !!x && (!blocked || x.id === homeSpaceId));
    // picking a workspace closes only this menu — the picker stays open on that workspace
    const closeMenu = openMenu(anchor, {
      width: 260,
      sections: [{
        title: t('lp.page.workspaces', 'Workspaces'),
        items: spaces.map((x) => ({ label: x.name, icon: <PageIcon icon={x.icon || undefined} size={20} fallback="workspace" />, checked: x.id === spaceId, onSelect: () => { setSpaceId(x.id); setQ(''); setExpanded(new Set()); closeMenu(); return false; } })),
      }],
    }, { placement: 'top-start' });
  };

  // flattened rows (for keyboard navigation)
  type Row = { key: string; depth: number; target: Target; id?: string; label: string; icon: React.ReactNode; expandable: boolean };
  const rows: Row[] = [];
  const pushPage = (id: string, depth: number) => {
    if (!ok(id)) return;
    const b = records.get<BlockRecord>('block', id)!;
    const kids = (b.content ?? []).filter((c) => {
      const cb = records.get<BlockRecord>('block', c);
      return !cb || PAGE_TYPES.has(cb.type);
    });
    // every page row offers › "Open" (children load on demand)
    rows.push({ key: `${id}:${depth}`, depth, target: { kind: 'page', id }, id, label: pageTitle(b) || t('lp.page.new_page', 'New page'), icon: <PageIcon block={b} size={20} />, expandable: b.type === 'page' });
    if (expanded.has(id)) for (const c of kids) pushPage(c, depth + 1);
  };
  const query = q.trim().toLowerCase();
  if (!query && crossSpace) {
    // another workspace: its top-level destinations first (Private, joined teamspaces)
    rows.push({ key: 'private', depth: 0, target: { kind: 'private' }, label: t('lp.page.private_pages', 'Private Pages'), icon: <Icon name="lock" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />, expandable: false });
    for (const tm of teams) rows.push({ key: `team:${tm.id}`, depth: 0, target: { kind: 'team', id: tm.id }, label: tm.name ?? 'Teamspace', icon: <PageIcon icon={tm.icon || '🏠'} size={20} />, expandable: false });
    for (const id of suggested) pushPage(id, 0);
  } else if (!query) {
    for (const id of suggested) pushPage(id, 0);
  } else {
    if ((crossSpace || sv) && ('private pages'.includes(query) || 'private'.startsWith(query))) rows.push({ key: 'private', depth: 0, target: { kind: 'private' }, label: 'Private pages', icon: <Icon name="lock" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />, expandable: false });
    for (const tm of teams) if (tm.name?.toLowerCase().includes(query)) rows.push({ key: `team:${tm.id}`, depth: 0, target: { kind: 'team', id: tm.id }, label: tm.name ?? 'Teamspace', icon: <PageIcon icon={tm.icon || '🏠'} size={20} />, expandable: false });
    for (const id of results) pushPage(id, 0);
  }
  const sel = Math.min(cursor, Math.max(0, rows.length - 1));
  useEffect(() => {
    listRef.current?.querySelector('.nc-moveto-row.selected')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        next.add(id);
        void api('getSidebarChildren', { blockIds: [id] }).then((res) => records.mergeRecordMap(res.recordMap)).catch(() => {});
      }
      return next;
    });
  };

  return (
    <PopoverSurface width={330} maxHeight={453} className="nc-moveto" style={{ height: 453 }}>
      <div className="nc-moveto-search">
        <div className="nc-input">
          <Icon name="search" size={16} style={{ color: 'var(--lp-icon-secondary)', flexShrink: 0 }} />
          <input
            autoFocus
            placeholder={addTo ? t('lp.page.search_for_a_destination_page', 'Search for a destination page…') : t('lp.page.move_page_here', 'Move page here…')}
            value={q}
            onChange={(e) => { setQ(e.target.value); setCursor(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(rows.length - 1, c + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
              else if (e.key === 'ArrowRight' && rows[sel]?.expandable && rows[sel].id) { e.preventDefault(); toggle(rows[sel].id!); }
              else if (e.key === 'Enter' && rows[sel]) { e.preventDefault(); moveTo(rows[sel].target); }
            }}
          />
        </div>
      </div>
      {crossSpace && (
        <div className="nc-moveto-hint">
          {t('lp.page.pages_can_only_be_duplicated_into', 'Pages can only be duplicated into another workspace, not moved there.')}{' '}
          {HELP_URL && (<a href={HELP_URL} target="_blank" rel="noreferrer">{t('lp.page.learn_more', 'Learn more')}</a>)}
        </div>
      )}
      <div ref={listRef} className="lit-scroller vertical nc-moveto-list" role="menu">
        {!query && rows.length > 0 && <div className="nc-moveto-section">{t('lp.page.suggested', 'Suggested')}</div>}
        {query && rows.length === 0 && <div className="nc-moveto-empty">{t('lp.page.no_results', 'No results')}</div>}
        {rows.map((r, i) => (
          <div
            key={r.key}
            role="menuitem"
            className={`nc-moveto-row ${i === sel ? 'selected' : ''}`}
            style={{ paddingInlineStart: 14 + r.depth * 16 }}
            onMouseMove={() => setCursor(i)}
            onClick={() => moveTo(r.target)}
          >
            <div
              role="button"
              aria-label={r.id && expanded.has(r.id) ? 'Close' : 'Open'}
              className={`nc-moveto-chevron ${r.expandable ? '' : 'hidden'} ${r.id && expanded.has(r.id) ? 'open' : ''}`}
              onClick={(e) => { e.stopPropagation(); if (r.expandable && r.id) toggle(r.id); }}
            >
              <Icon name="chevronRight" size={14} />
            </div>
            {r.icon}
            <span className="nc-ellipsis label">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="nc-moveto-footer">
        <div role="button" className="nc-moveto-space" aria-haspopup="menu" onClick={(e) => openSpaces(e.currentTarget)}>
          <PageIcon icon={space?.icon || undefined} size={16} fallback="workspace" />
          <span className="nc-ellipsis">{space?.name ?? 'Workspace'}</span>
          <Icon name="chevronDownNarrow" size={12} style={{ color: 'var(--lp-icon-tertiary)' }} />
        </div>
      </div>
    </PopoverSurface>
  );
}

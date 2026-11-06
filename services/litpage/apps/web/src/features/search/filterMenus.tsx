// Quick Find filter bar menus: Sort, Created by (people + "(You)"), In (page picker),
// "+ Filter" (Date / Teamspace / Content status) and Search settings (Persist filters / Disable Quick Answers).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, SpaceRecord, SpaceViewRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { openMenu } from '../../components/Menu.tsx';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { currentSpaceView, useSession } from '../../lib/store/session.ts';
import { ancestorsOf } from '../../lib/blocks.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { pageTitle } from '../page/pageActions.ts';
import { t } from '../shell/i18n.ts';
import { useSearchState, type ContentStatus, type DateFilter, type SearchSort } from './searchState.ts';

export function sortLabel(s: SearchSort): string {
  if (s.field === 'lastEdited') return s.direction === 'asc' ? t('lp.search.least_recently_edited', 'Least recently edited') : t('lp.search.most_recently_edited', 'Most recently edited');
  if (s.field === 'created') return s.direction === 'asc' ? t('lp.search.created_oldest_first', 'Created first') : t('lp.search.created_newest_first', 'Created most recently');
  return t('lp.search.best_matches', 'Best matches');
}

const SORTS: SearchSort[] = [
  { field: 'relevance', direction: 'desc' },
  { field: 'lastEdited', direction: 'desc' },
  { field: 'lastEdited', direction: 'asc' },
  { field: 'created', direction: 'desc' },
  { field: 'created', direction: 'asc' },
];

export function openSortMenu(anchor: Anchor) {
  const cur = useSearchState.getState().sort;
  openMenu(anchor, {
    width: 182,
    sections: [{
      items: SORTS.map((s) => ({
        label: sortLabel(s),
        checked: s.field === cur.field && (s.field === 'relevance' || s.direction === cur.direction),
        onSelect: () => useSearchState.getState().setSort(s),
      })),
    }],
  }, { placement: 'bottom-start' });
}

export function Avatar({ user, size = 20 }: { user?: Partial<UserRecord>; size?: number }) {
  const name = user?.name || user?.email || '?';
  return (
    <span className="nc-qf-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}>
      {user?.profile_photo ? <img src={user.profile_photo} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function spaceMembers(): UserRecord[] {
  const { spaceId, userId } = useSession.getState();
  const space = records.get<SpaceRecord>('space', spaceId);
  const ids = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
  const users = [...new Set(ids)].map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u);
  users.sort((a, b) => (a.id === userId ? -1 : b.id === userId ? 1 : (a.name || a.email).localeCompare(b.name || b.email)));
  return users;
}

export function openCreatedByMenu(anchor: Anchor) {
  openOverlay((close) => <PeoplePicker close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

function PeoplePicker({ close }: { close: () => void }) {
  const me = useSession((s) => s.userId);
  const selected = useSearchState((s) => s.filters.createdBy);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const all = useMemo(() => spaceMembers(), []);
  const list = all.filter((u) => !q.trim() || `${u.name} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id: string) => {
    const cur = useSearchState.getState().filters.createdBy;
    useSearchState.getState().setFilters({ createdBy: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };
  return (
    <PopoverSurface width={252} maxHeight={340}>
      <div className="nc-menu-search">
        <div className="nc-input focused">
          <input
            autoFocus
            placeholder={t('lp.search.search_people', 'Search people')}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing && list[active]) { e.preventDefault(); toggle(list[active].id); }
              else if (e.key === 'Escape') { e.preventDefault(); close(); }
            }}
          />
        </div>
      </div>
      <div className="lit-scroller vertical nc-menu-scroll" role="listbox">
        <div className="nc-menu-section">
          {list.length === 0 && <div className="nc-menu-empty">{t('lp.search.no_results', 'No results')}</div>}
          {list.map((u, i) => (
            <div key={u.id} role="option" aria-selected={i === active} className={`nc-menu-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(u.id)}>
              <div className="nc-menu-item-inner">
                <div className="nc-menu-icon"><Avatar user={u} /></div>
                <div className="nc-menu-label nc-ellipsis">
                  {u.name || u.email}
                  {u.id === me && <span className="nc-qf-you"> {t('lp.search.you', '(You)')}</span>}
                </div>
                {selected.includes(u.id) && <Icon name="check" size={16} />}
              </div>
            </div>
          ))}
        </div>
      </div>
    </PopoverSurface>
  );
}

/** Page picker for "In" (search as you type; recent pages when empty). */
export function openInPageMenu(anchor: Anchor) {
  openOverlay((close) => <InPagePicker close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

function InPagePicker({ close }: { close: () => void }) {
  const spaceId = useSession((s) => s.spaceId);
  const [q, setQ] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const inPage = useSearchState((s) => s.filters.inPage);
  useEffect(() => {
    let alive = true;
    const tm = setTimeout(async () => {
      try {
        const res = q.trim()
          ? await api('searchWorkspace', { query: q, spaceId, limit: 30, filters: { titleOnly: true } })
          : await api('listRecentPages', { spaceId, limit: 20 });
        if (!alive) return;
        records.mergeRecordMap(res.recordMap);
        setIds((q.trim() ? res.results.map((r: { id: string }) => r.id) : res.pages.map((p: { id: string }) => p.id)) as string[]);
        setActive(0);
      } catch {
        /* ignore */
      }
    }, q ? 120 : 0);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
  }, [q, spaceId]);
  const pick = (id: string) => {
    useSearchState.getState().setFilters({ inPage: inPage === id ? null : id });
    close();
  };
  return (
    <PopoverSurface width={252} maxHeight={340}>
      <div className="nc-menu-search">
        <div className="nc-input focused">
          <input
            autoFocus
            placeholder={t('lp.search.search_pages', 'Search pages')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(ids.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing && ids[active]) { e.preventDefault(); pick(ids[active]); }
            }}
          />
        </div>
      </div>
      <div className="lit-scroller vertical nc-menu-scroll" role="listbox">
        <div className="nc-menu-section">
          {ids.length === 0 && <div className="nc-menu-empty">{t('lp.search.no_results', 'No results')}</div>}
          {ids.map((id, i) => {
            const b = records.get<BlockRecord>('block', id);
            if (!b) return null;
            const path = ancestorsOf(id).map((a) => pageTitle(a) || t('lp.search.untitled', 'Untitled'));
            return (
              <div key={id} role="option" aria-selected={i === active} className={`nc-menu-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(id)}>
                <div className="nc-menu-item-inner nc-qf-picker-row">
                  <PageIcon block={b} size={20} />
                  <div className="nc-menu-label">
                    <div className="nc-ellipsis">{pageTitle(b) || t('lp.search.untitled', 'Untitled')}</div>
                    {path.length > 0 && <div className="nc-qf-picker-path nc-ellipsis">{path.join(' / ')}</div>}
                  </div>
                  {inPage === id && <Icon name="check" size={16} />}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PopoverSurface>
  );
}

const DATE_RANGES: DateFilter['range'][] = ['today', 'last7', 'last30'];
export function dateRangeLabel(r: DateFilter['range']) {
  return r === 'today' ? t('lp.search.today', 'Today') : r === 'last7' ? t('lp.search.last_7_days', 'Last 7 days') : t('lp.search.last_30_days', 'Last 30 days');
}
export function dateKindLabel(k: DateFilter['kind']) {
  return k === 'created' ? t('lp.search.created', 'Created') : t('lp.search.last_edited', 'Last edited');
}

export function dateMenuDef() {
  const cur = useSearchState.getState().filters.date;
  const set = (date: DateFilter | null) => {
    const f = useSearchState.getState().filters;
    useSearchState.getState().setFilters({ date, added: date ? [...new Set([...f.added, 'date' as const])] : f.added.filter((x) => x !== 'date') });
  };
  return {
    width: 220,
    sections: [
      ...(['lastEdited', 'created'] as const).map((kind) => ({
        title: dateKindLabel(kind),
        items: DATE_RANGES.map((range) => ({
          label: dateRangeLabel(range),
          checked: cur?.kind === kind && cur.range === range,
          onSelect: () => set({ kind, range }),
        })),
      })),
      { items: [{ label: t('lp.search.clear', 'Clear'), icon: 'xMark', disabled: !cur, onSelect: () => set(null) }] },
    ],
  };
}

export function teamMenuDef() {
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  const spaceId = useSession.getState().spaceId;
  const teams = records.all<TeamRecord>('team').filter((tm) => tm.space_id === spaceId && tm.alive !== false && (sv?.joined_teams ?? []).includes(tm.id));
  const sel = useSearchState.getState().filters.teamIds;
  return {
    width: 240,
    search: t('lp.search.search_teams', 'Search teams'),
    sections: [{
      items: teams.map((tm) => ({
        label: tm.name,
        icon: <span className="nc-qf-team-icon">{tm.icon || tm.name.slice(0, 1)}</span>,
        checked: sel.includes(tm.id),
        onSelect: () => {
          const f = useSearchState.getState().filters;
          const teamIds = f.teamIds.includes(tm.id) ? f.teamIds.filter((x) => x !== tm.id) : [...f.teamIds, tm.id];
          useSearchState.getState().setFilters({ teamIds, added: [...new Set([...f.added, 'teamspace' as const])] });
        },
      })),
    }],
    emptyText: t('lp.search.no_results', 'No results'),
  };
}

export function contentStatusLabel(s: ContentStatus) {
  switch (s) {
    case 'all_with_archived':
      return t('lp.search.every_page_archived_ones_too', 'Every page, archived ones too');
    case 'verified_only':
      return t('lp.search.only_verified_pages', 'Only verified pages');
    case 'archived_only':
      return t('lp.search.only_archived_pages', 'Only archived pages');
    default:
      return t('lp.search.every_page_except_archived_ones', 'Every page except archived ones');
  }
}

export function contentStatusMenuDef() {
  const cur = useSearchState.getState().filters.contentStatus;
  return {
    width: 280,
    sections: [{
      items: (['all', 'all_with_archived', 'verified_only', 'archived_only'] as ContentStatus[]).map((s) => ({
        label: contentStatusLabel(s),
        checked: s === cur,
        onSelect: () => {
          const f = useSearchState.getState().filters;
          useSearchState.getState().setFilters({ contentStatus: s, added: [...new Set([...f.added, 'contentStatus' as const])] });
        },
      })),
    }],
  };
}

export function openAddFilterMenu(anchor: Anchor) {
  openMenu(anchor, {
    width: 200,
    sections: [{
      items: [
        { label: t('lp.search.date', 'Date'), icon: 'calendar', submenu: dateMenuDef },
        { label: t('lp.search.team', 'Team'), icon: 'building', submenu: teamMenuDef },
        { label: t('lp.search.content_status', 'Content status'), icon: 'checkBadge', submenu: contentStatusMenuDef },
      ],
    }],
  }, { placement: 'bottom-start' });
}

function Switch({ on }: { on: boolean }) {
  return <span className={`nc-qf-switch ${on ? 'on' : ''}`}><span /></span>;
}

export function openSearchSettingsMenu(anchor: Anchor) {
  const st = useSearchState.getState();
  const def = () => ({
    width: 300,
    sections: [{
      items: [
        {
          label: t('lp.search.keep_filters_between_sessions', 'Keep filters between sessions'),
          right: <SettingSwitch k="persistFilters" />,
          onSelect: () => {
            useSearchState.getState().setSetting({ persistFilters: !useSearchState.getState().persistFilters });
            return false;
          },
        },
        {
          label: t('lp.search.turn_off_quick_answers', 'Turn off Quick Answers'),
          right: <SettingSwitch k="disableQuickAnswers" />,
          onSelect: () => {
            useSearchState.getState().setSetting({ disableQuickAnswers: !useSearchState.getState().disableQuickAnswers });
            return false;
          },
        },
      ],
    }],
  });
  void st;
  openMenu(anchor, def(), { placement: 'top-end' });
}

function SettingSwitch({ k }: { k: 'persistFilters' | 'disableQuickAnswers' }) {
  const on = useSearchState((s) => s[k]);
  return <Switch on={on} />;
}

/** Label for the Created by chip: "Created by" or "Created by: Name (+N)". */
export function useCreatedByLabel(): ReactNode {
  const ids = useSearchState((s) => s.filters.createdBy);
  return useMemo(() => {
    const base = t('lp.search.created_by', 'Created by');
    if (!ids.length) return base;
    const first = records.get<UserRecord>('lit_user', ids[0]);
    const name = first?.name || first?.email || '';
    return `${base}: ${name}${ids.length > 1 ? ` +${ids.length - 1}` : ''}`;
  }, [ids]);
}

export function useInLabel(): ReactNode {
  const id = useSearchState((s) => s.filters.inPage);
  const base = t('lp.search.in', 'In');
  if (!id) return base;
  return `${base}: ${pageTitle(records.get<BlockRecord>('block', id)) || t('lp.search.untitled', 'Untitled')}`;
}

export function useAnchorRef<T extends HTMLElement>() {
  return useRef<T>(null);
}

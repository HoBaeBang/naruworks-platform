// Library (/<domain>/library/<tab>) data model: tabs, columns, per-tab view state (sort / filters / hidden
// columns / widths / wrap / group, kept in localStorage as per-user library view settings, and
// row values. Columns and tabs are defined here.
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord, SpaceViewRecord, TeamRecord } from '@nc/shared/records.ts';
import { records } from '../../../lib/store/records.ts';
import { getLocale, t } from '../../shell/i18n.ts';
import { pageTitle } from '../../page/pageActions.ts';

export type LibTab = 'teamspaces' | 'recents' | 'favorites' | 'shared' | 'private' | 'meetings' | 'agents' | 'skills';
export const LIB_TABS: LibTab[] = ['teamspaces', 'recents', 'favorites', 'shared', 'private', 'meetings', 'agents', 'skills'];
export type PageTab = 'recents' | 'favorites' | 'shared' | 'private' | 'meetings';

export function isLibTab(v: string | undefined | null): v is LibTab {
  return !!v && (LIB_TABS as string[]).includes(v);
}

export function tabLabel(tab: LibTab): string {
  switch (tab) {
    case 'teamspaces':
      return t('lp.home.teams', 'Teams');
    case 'recents':
      return t('lp.home.recents', 'Recents');
    case 'favorites':
      return t('lp.home.favorites', 'Favorites');
    case 'shared':
      return t('lp.home.shared', 'Shared');
    case 'private':
      return t('lp.home.private', 'Private');
    case 'meetings':
      return t('lp.home.ai_meeting_notes', 'AI meeting notes');
    case 'agents':
      return t('lp.home.agents', 'Agents');
    case 'skills':
      return t('lp.home.skills', 'Skills');
  }
}

export const TAB_ICON: Record<LibTab, string> = {
  teamspaces: 'teamspace',
  recents: 'clock',
  favorites: 'star',
  shared: 'people',
  private: 'lock',
  meetings: 'libPaperMic',
  agents: 'agentFace',
  skills: 'libPaperSkill',
};

// ---------------- columns ----------------
export type ColKey = 'title' | 'created_by' | 'source' | 'last_edited_time' | 'last_visited_time' | 'last_edited_by' | 'created_time';
export const ALL_COLUMNS: ColKey[] = ['title', 'created_by', 'source', 'last_edited_time', 'last_visited_time', 'last_edited_by', 'created_time'];
export type ColKind = 'title' | 'person' | 'source' | 'date';

export const COL_KIND: Record<ColKey, ColKind> = {
  title: 'title',
  created_by: 'person',
  last_edited_by: 'person',
  source: 'source',
  last_edited_time: 'date',
  last_visited_time: 'date',
  created_time: 'date',
};

export const COL_ICON: Record<ColKey, string> = {
  title: 'libDocFill',
  created_by: 'libUserCircleFill',
  last_edited_by: 'libUserCircleFill',
  source: 'libLocationFill',
  last_edited_time: 'libClockFill',
  last_visited_time: 'libClockFill',
  created_time: 'libClockFill',
};

export function colLabel(c: ColKey): string {
  switch (c) {
    case 'title':
      return t('lp.home.page_name', 'Page name');
    case 'created_by':
      return t('lp.home.created_by', 'Created by');
    case 'source':
      return t('lp.home.source', 'Source');
    case 'last_edited_time':
      return t('lp.home.last_edited', 'Last edited');
    case 'last_visited_time':
      return t('lp.home.time_last_visited', 'Time last visited');
    case 'last_edited_by':
      return t('lp.home.last_changed_by', 'Last changed by');
    case 'created_time':
      return t('lp.home.created_time', 'Created time');
  }
}

/** Columns visible by default per tab and the properties available to show. */
export const DEFAULT_VISIBLE: Record<PageTab, ColKey[]> = {
  recents: ['title', 'created_by', 'source', 'last_edited_time', 'last_visited_time'],
  favorites: ['title', 'created_by', 'source', 'last_edited_time'],
  shared: ['title', 'created_by', 'source', 'last_edited_time'],
  private: ['title', 'last_edited_time'],
  meetings: ['title', 'created_by', 'created_time'],
};

export function availableColumns(tab: PageTab): ColKey[] {
  return tab === 'recents' ? ALL_COLUMNS : ALL_COLUMNS.filter((c) => c !== 'last_visited_time');
}

export const DEFAULT_WIDTH: Record<ColKey, number> = {
  title: 420, created_by: 200, source: 200, last_edited_time: 200, last_visited_time: 200, last_edited_by: 200, created_time: 200,
};

// ---------------- view state ----------------
export type DateRange = 'today' | 'week' | 'month' | 'year';
export interface LibFilter {
  id: string;
  col: ColKey;
  text?: string;
  users?: string[];
  range?: DateRange;
}
export interface LibSort {
  col: ColKey;
  dir: 'asc' | 'desc';
}
export interface LibView {
  visible: ColKey[];
  widths: Partial<Record<ColKey, number>>;
  wrap: Partial<Record<ColKey, boolean>>;
  sort: LibSort | null;
  filters: LibFilter[];
  group: ColKey | null;
  includeArchived?: boolean;
  skillsTab?: 'enabled' | 'discover';
}

export function defaultView(tab: LibTab): LibView {
  const visible = tab === 'teamspaces' || tab === 'skills' || tab === 'agents' ? [] : [...DEFAULT_VISIBLE[tab]];
  return {
    visible,
    widths: {},
    wrap: {},
    // Private is sorted by "Last edited" by default (blue sort indicator in)
    sort: tab === 'private' ? { col: 'last_edited_time', dir: 'desc' } : null,
    filters: [],
    group: null,
    includeArchived: false,
    skillsTab: 'enabled',
  };
}

function readView(tab: LibTab): LibView {
  const base = defaultView(tab);
  try {
    const raw = localStorage.getItem(`nc:library:view:${tab}`);
    if (!raw) return base;
    const v = JSON.parse(raw) as Partial<LibView>;
    return {
      ...base,
      ...v,
      visible: Array.isArray(v.visible) && v.visible.length ? v.visible.filter((c): c is ColKey => (ALL_COLUMNS as string[]).includes(c)) : base.visible,
      filters: Array.isArray(v.filters) ? v.filters : [],
    };
  } catch {
    return base;
  }
}

interface LibState {
  views: Partial<Record<LibTab, LibView>>;
  get: (tab: LibTab) => LibView;
  update: (tab: LibTab, fn: (v: LibView) => void) => void;
}

export const useLibraryViews = create<LibState>((set, getState) => ({
  views: Object.fromEntries(LIB_TABS.map((tab) => [tab, readView(tab)])) as Record<LibTab, LibView>,
  get: (tab) => getState().views[tab] ?? readView(tab),
  update: (tab, fn) => {
    const next = structuredClone(getState().get(tab));
    fn(next);
    try {
      localStorage.setItem(`nc:library:view:${tab}`, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    set({ views: { ...getState().views, [tab]: next } });
  },
}));

export function useLibraryView(tab: LibTab): LibView {
  const v = useLibraryViews((s) => s.views[tab]);
  return v ?? defaultView(tab);
}

const LAST_TAB = 'nc:library:lastTab';
export function lastLibraryTab(): LibTab {
  try {
    const v = localStorage.getItem(LAST_TAB);
    if (isLibTab(v)) return v;
  } catch {
    /* ignore */
  }
  return 'recents';
}
export function rememberLibraryTab(tab: LibTab) {
  try {
    localStorage.setItem(LAST_TAB, tab);
  } catch {
    /* ignore */
  }
}

// ---------------- values ----------------
export interface Row {
  id: string;
  visitedAt?: number;
}

export interface UserLite {
  id: string;
  name?: string;
  email?: string;
  profile_photo?: string;
}

export function userOf(id: string | undefined): UserLite | undefined {
  if (!id) return undefined;
  return records.get('lit_user', id) as UserLite | undefined;
}

export function userName(u: UserLite | undefined): string {
  return u?.name || u?.email || '';
}

export interface SourceInfo {
  kind: 'private' | 'page' | 'database' | 'team' | 'none';
  id?: string;
  label: string;
  block?: BlockRecord;
  team?: TeamRecord;
}

/** "Source" (location) of a page: its parent page, database, teamspace or "Private". */
export function sourceOf(b: BlockRecord | undefined, sv: SpaceViewRecord | undefined): SourceInfo {
  if (!b) return { kind: 'none', label: '' };
  if (b.parent_table === 'collection') {
    const col = records.get<CollectionRecord>('collection', b.parent_id);
    const db = col ? records.get<BlockRecord>('block', col.parent_id) : undefined;
    return { kind: 'database', id: db?.id, block: db, label: (db && pageTitle(db)) || t('lp.home.untitled', 'Untitled') };
  }
  if (b.parent_table === 'block') {
    let cur = records.get<BlockRecord>('block', b.parent_id);
    for (let i = 0; i < 40 && cur && cur.type !== 'page' && cur.type !== 'collection_view_page' && cur.parent_table === 'block'; i++) {
      cur = records.get<BlockRecord>('block', cur.parent_id);
    }
    if (!cur) return { kind: 'none', label: '' };
    return { kind: 'page', id: cur.id, block: cur, label: pageTitle(cur) || t('lp.home.untitled', 'Untitled') };
  }
  if (b.parent_table === 'team') {
    const team = records.get<TeamRecord>('team', b.parent_id);
    return { kind: 'team', id: team?.id, team, label: team?.name ?? '' };
  }
  if (b.parent_table === 'space' && sv?.private_pages?.includes(b.id)) {
    return { kind: 'private', label: t('lp.home.private', 'Private') };
  }
  return { kind: 'none', label: '' };
}

export function dateValue(b: BlockRecord | undefined, row: Row, col: ColKey): number | undefined {
  if (!b) return undefined;
  if (col === 'last_edited_time') return b.last_edited_time;
  if (col === 'created_time') return b.created_time;
  if (col === 'last_visited_time') return row.visitedAt;
  return undefined;
}

export function personValue(b: BlockRecord | undefined, col: ColKey): string | undefined {
  if (!b) return undefined;
  return col === 'created_by' ? b.created_by_id : col === 'last_edited_by' ? b.last_edited_by_id : undefined;
}

/** Relative timestamps ("Just now", "11 minutes ago", "3 weeks ago") followed by short dates. */
export function libraryTime(ts: number | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('lp.home.just_now', 'Just now');
  if (min < 60) return t('lp.home.numminutes_plural_one_minute_ago_other', '{numMinutes, plural, one {{numMinutes} minute earlier} other {{numMinutes} minutes earlier}}', { numMinutes: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('lp.home.numhours_plural_one_hour_ago_other', '{numHours, plural, one {{numHours} hour earlier} other {{numHours} hours earlier}}', { numHours: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t('lp.home.numdays_plural_one_day_ago_other', '{numDays, plural, one {{numDays} day earlier} other {{numDays} days earlier}}', { numDays: d });
  const w = Math.floor(d / 7);
  if (w < 4) return t('lp.home.numweeks_plural_one_week_ago_other', '{numWeeks, plural, one {{numWeeks} week earlier} other {{numWeeks} weeks earlier}}', { numWeeks: w });
  const date = new Date(ts);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(getLocale(), sameYear ? { month: 'long', day: 'numeric' } : { year: 'numeric', month: 'long', day: 'numeric' });
}

export function rangeLabel(r: DateRange): string {
  switch (r) {
    case 'today':
      return t('lp.home.today', 'Today');
    case 'week':
      return t('lp.home.past_week', 'Past week');
    case 'month':
      return t('lp.home.past_month', 'Past month');
    case 'year':
      return t('lp.home.past_year', 'Past year');
  }
}

function inRange(ts: number | undefined, r: DateRange): boolean {
  if (!ts) return false;
  const now = new Date();
  if (r === 'today') return new Date(ts).toDateString() === now.toDateString();
  const days = r === 'week' ? 7 : r === 'month' ? 30 : 365;
  return Date.now() - ts <= days * 86_400_000;
}

export function matchesFilter(b: BlockRecord | undefined, row: Row, f: LibFilter, sv: SpaceViewRecord | undefined): boolean {
  const kind = COL_KIND[f.col];
  if (kind === 'title') return !f.text || pageTitle(b).toLowerCase().includes(f.text.toLowerCase());
  if (kind === 'person') return !f.users?.length || f.users.includes(personValue(b, f.col) ?? '');
  if (kind === 'date') return !f.range || inRange(dateValue(b, row, f.col), f.range);
  if (kind === 'source') return !f.text || sourceOf(b, sv).label.toLowerCase().includes(f.text.toLowerCase());
  return true;
}

export function filterActive(f: LibFilter): boolean {
  return !!(f.text || f.users?.length || f.range);
}

export function sortRows(rows: Row[], sort: LibSort | null, sv: SpaceViewRecord | undefined): Row[] {
  if (!sort) return rows;
  const kind = COL_KIND[sort.col];
  const key = (r: Row): string | number => {
    const b = records.get<BlockRecord>('block', r.id);
    if (kind === 'date') return dateValue(b, r, sort.col) ?? 0;
    if (kind === 'person') return userName(userOf(personValue(b, sort.col))).toLowerCase();
    if (kind === 'source') return sourceOf(b, sv).label.toLowerCase();
    return pageTitle(b).toLowerCase();
  };
  const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -1 * dir;
    if (ka > kb) return 1 * dir;
    return 0;
  });
}

/** Group key and label for a row, with relative buckets for date columns. */
export function groupOf(b: BlockRecord | undefined, row: Row, col: ColKey, sv: SpaceViewRecord | undefined): { key: string; label: string } {
  const kind = COL_KIND[col];
  if (kind === 'person') {
    const id = personValue(b, col) ?? '';
    return { key: id, label: userName(userOf(id)) || t('lp.home.no_value', 'No value') };
  }
  if (kind === 'source') {
    const s = sourceOf(b, sv);
    return { key: `${s.kind}:${s.id ?? ''}`, label: s.label || t('lp.home.no_value', 'No value') };
  }
  if (kind === 'date') {
    const ts = dateValue(b, row, col);
    if (!ts) return { key: 'none', label: t('lp.home.no_value', 'No value') };
    const days = (Date.now() - ts) / 86_400_000;
    if (new Date(ts).toDateString() === new Date().toDateString()) return { key: '0', label: t('lp.home.today', 'Today') };
    if (days < 2) return { key: '1', label: t('lp.home.yesterday', 'Yesterday') };
    if (days < 7) return { key: '2', label: t('lp.home.past_week', 'Past week') };
    if (days < 30) return { key: '3', label: t('lp.home.past_month', 'Past month') };
    return { key: '4', label: t('lp.home.older', 'Older') };
  }
  const title = pageTitle(b);
  return { key: title.slice(0, 1).toUpperCase(), label: title.slice(0, 1).toUpperCase() || t('lp.home.no_value', 'No value') };
}

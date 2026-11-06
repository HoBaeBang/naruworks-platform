// Quick Find state: the last query survives closing/reopening within the session; filters persist
// across sessions only when "Persist filters across sessions" is on (Search settings menu).
import { create } from 'zustand';

export type SortField = 'relevance' | 'lastEdited' | 'created';
export interface SearchSort {
  field: SortField;
  direction: 'asc' | 'desc';
}
export interface DateFilter {
  kind: 'lastEdited' | 'created';
  range: 'today' | 'last7' | 'last30';
}
export type ContentStatus = 'all' | 'all_with_archived' | 'verified_only' | 'archived_only';
export interface SearchFilters {
  titleOnly: boolean;
  createdBy: string[];
  inPage: string | null;
  teamIds: string[];
  date: DateFilter | null;
  contentStatus: ContentStatus;
  /** filters added through "+ Filter" are shown as chips even before a value is picked */
  added: ('date' | 'teamspace' | 'contentStatus')[];
}

export const EMPTY_FILTERS: SearchFilters = { titleOnly: false, createdBy: [], inPage: null, teamIds: [], date: null, contentStatus: 'all', added: [] };

interface SearchSettings {
  persistFilters: boolean;
  disableQuickAnswers: boolean;
  showPane: boolean;
  showFilters: boolean;
}

interface SearchState extends SearchSettings {
  query: string;
  filters: SearchFilters;
  sort: SearchSort;
  setQuery: (q: string) => void;
  setFilters: (f: Partial<SearchFilters>) => void;
  resetFilters: () => void;
  setSort: (s: SearchSort) => void;
  setSetting: (patch: Partial<SearchSettings>) => void;
}

const SETTINGS_KEY = 'nc:search:settings';
const FILTERS_KEY = 'nc:search:filters';

function read<T>(key: string, fb: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? { ...fb, ...(JSON.parse(v) as T) } : fb;
  } catch {
    return fb;
  }
}
function write(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
}

const initialSettings = read<SearchSettings>(SETTINGS_KEY, { persistFilters: false, disableQuickAnswers: false, showPane: true, showFilters: true });

export const useSearchState = create<SearchState>((set, get) => ({
  ...initialSettings,
  query: '',
  filters: initialSettings.persistFilters ? read<SearchFilters>(FILTERS_KEY, EMPTY_FILTERS) : EMPTY_FILTERS,
  sort: { field: 'relevance', direction: 'desc' },
  setQuery: (query) => set({ query }),
  setFilters: (f) => {
    const filters = { ...get().filters, ...f };
    set({ filters });
    if (get().persistFilters) write(FILTERS_KEY, filters);
  },
  resetFilters: () => {
    set({ filters: EMPTY_FILTERS });
    if (get().persistFilters) write(FILTERS_KEY, EMPTY_FILTERS);
  },
  setSort: (sort) => set({ sort }),
  setSetting: (patch) => {
    set(patch);
    const s = get();
    write(SETTINGS_KEY, { persistFilters: s.persistFilters, disableQuickAnswers: s.disableQuickAnswers, showPane: s.showPane, showFilters: s.showFilters });
    if (patch.persistFilters) write(FILTERS_KEY, s.filters);
  },
}));

export function hasActiveFilters(f: SearchFilters): boolean {
  return f.titleOnly || f.createdBy.length > 0 || !!f.inPage || f.teamIds.length > 0 || !!f.date || f.contentStatus !== 'all';
}

/** Server filter payload for api('searchWorkspace'). */
export function toServerFilters(f: SearchFilters, now = Date.now()) {
  const out: Record<string, unknown> = {};
  if (f.titleOnly) out.titleOnly = true;
  if (f.createdBy.length) out.createdBy = f.createdBy;
  if (f.inPage) out.ancestorIds = [f.inPage];
  if (f.teamIds.length) out.teamIds = f.teamIds;
  if (f.contentStatus !== 'all') out.contentStatus = f.contentStatus;
  if (f.date) {
    const start = new Date(now);
    if (f.date.range === 'today') start.setHours(0, 0, 0, 0);
    else start.setTime(now - (f.date.range === 'last7' ? 7 : 30) * 86_400_000);
    out[f.date.kind === 'created' ? 'createdTime' : 'lastEditedTime'] = { start: start.getTime() };
  }
  return out;
}

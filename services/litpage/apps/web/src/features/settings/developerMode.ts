// Settings › Developer › Enable developer features. It is a local setting: each browser
// (and the desktop app) turns it on separately, and it survives workspace switches. When on:
//   - the developer bar at the bottom of the page frame (DeveloperBar.tsx): Workspace / Page / Block / Database /
//     Data source / User IDs, click to copy (right-click copies without dashes), hide with the × or ⌘⌥⇧D;
//   - a "Developer" section in block menus (⋮⋮ / right-click): Copy block / page / database / data source ID,
//     Toggle developer bar.
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import type { MenuItemDef, MenuSectionDef } from '../../components/Menu.tsx';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';

const MODE_KEY = 'nc:developer-mode';
const BAR_KEY = 'nc:developer-bar-hidden';

function readFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, v: boolean) {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* storage unavailable (private window): keep the in-memory value */
  }
}

interface DeveloperState {
  on: boolean;
  barHidden: boolean;
  setOn: (v: boolean) => void;
  toggleBar: () => void;
}

export const useDeveloperMode = create<DeveloperState>((set, get) => ({
  on: readFlag(MODE_KEY),
  barHidden: readFlag(BAR_KEY),
  setOn: (v) => {
    writeFlag(MODE_KEY, v);
    set({ on: v });
  },
  toggleBar: () => {
    const hidden = !get().barHidden;
    writeFlag(BAR_KEY, hidden);
    set({ barHidden: hidden });
    useUI.getState().toast(hidden ? t('lp.settings.developer_bar_is_hidden', 'Developer bar is hidden') : t('lp.settings.developer_bar_is_visible', 'Developer bar is visible'));
  },
}));

if (typeof window !== 'undefined') {
  // other tabs of this browser
  window.addEventListener('storage', (e) => {
    if (e.key === MODE_KEY || e.key === BAR_KEY) useDeveloperMode.setState({ on: readFlag(MODE_KEY), barHidden: readFlag(BAR_KEY) });
  });
  // ⌘⌥⇧D / Ctrl+Alt+Shift+D toggles the developer bar while developer features are on
  window.addEventListener('keydown', (e) => {
    if (!useDeveloperMode.getState().on) return;
    if (e.code === 'KeyD' && e.shiftKey && e.altKey && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      useDeveloperMode.getState().toggleBar();
    }
  });
}

export const DEVELOPER_BAR_SHORTCUT = /Mac|iPhone|iPad/.test(typeof navigator !== 'undefined' ? navigator.platform : '') ? '⌘⌥⇧D' : 'Ctrl+Alt+Shift+D';

export function developerModeOn(): boolean {
  return useDeveloperMode.getState().on;
}

/** Copy an id (dashes removed on request) and confirm with a toast. */
export function copyDeveloperId(label: string, id: string, opts: { undashed?: boolean; bar?: boolean } = {}) {
  const value = opts.undashed ? id.replace(/-/g, '') : id;
  void navigator.clipboard?.writeText(value).catch(() => {});
  useUI.getState().toast(opts.bar
    ? (opts.undashed ? t('lp.settings.id_copied_without_dashes', '{label} ID copied without dashes', { label }) : t('lp.settings.copied_id', 'Copied {label} ID', { label }))
    : t('lp.settings.copied', 'Copied {label}', { label }));
}

export interface DataSourceRef { id: string; name: string }

/** Data sources of a database block (collection_view / collection_view_page). */
export function dataSourcesOf(block: BlockRecord | undefined): DataSourceRef[] {
  if (!block || (block.type !== 'collection_view' && block.type !== 'collection_view_page') || !block.collection_id) return [];
  const c = records.get<CollectionRecord>('collection', block.collection_id);
  return [{ id: block.collection_id, name: c ? toPlainText((c as any).name) : '' }];
}

/** The database a row page belongs to: { database block id, data source id }. */
export function databaseOfRow(page: BlockRecord | undefined): { databaseId: string | null; dataSourceId: string } | null {
  if (!page || page.parent_table !== 'collection') return null;
  const c = records.get<CollectionRecord>('collection', page.parent_id);
  return { databaseId: (c as any)?.parent_id ?? null, dataSourceId: page.parent_id };
}

function copyItem(label: string, id: string): MenuItemDef {
  return {
    label: t('lp.settings.copy', 'Copy {label}', { label }),
    icon: 'duplicate',
    onSelect: () => copyDeveloperId(label, id),
  };
}

/** Block menu "Developer" section — only with developer features on. */
export function developerMenuSection(blockId: string): MenuSectionDef | null {
  if (!developerModeOn()) return null;
  const b = records.get<BlockRecord>('block', blockId);
  if (!b) return null;
  const isPage = b.type === 'page' || b.type === 'collection_view_page';
  const items: MenuItemDef[] = [copyItem(isPage ? t('lp.settings.page_id', 'Page ID') : t('lp.settings.block_id', 'Block ID'), b.id)];
  const sources = dataSourcesOf(b);
  if (sources.length) {
    items.push(copyItem(t('lp.settings.database_id', 'Database ID'), b.id));
    for (const s of sources) {
      items.push(copyItem(sources.length > 1 ? t('lp.settings.id', '{name} ID', { name: s.name || t('lp.settings.data_source_without_a_name', 'Data source without a name') }) : t('lp.settings.id_for_data_source', 'ID for data source'), s.id));
    }
  }
  items.push({ label: t('lp.settings.show_or_hide_developer_bar', 'Show or hide developer bar'), icon: 'curlyBraces', onSelect: () => useDeveloperMode.getState().toggleBar() });
  return { title: t('lp.settings.developer', 'Developer'), items };
}

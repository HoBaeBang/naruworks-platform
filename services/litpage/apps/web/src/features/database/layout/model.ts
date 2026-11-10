// Database page layouts on the client (DB-LAY-*): the effective layout of a data source (normalized against the
// schema; the original layout when none was applied), Apply to all pages / Reset, and the details-panel state.
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { normalizePageLayout, type PageLayout, type TitleModule } from '@nc/shared/database/index.ts';
import { records } from '../../../lib/store/records.ts';
import { run } from '../../../lib/blocks.ts';
import { useBlock, useCollection } from '../../../lib/hooks.ts';
import { nullify } from '../actions.ts';

/** Page property order of the original layout: stored order first, then the rest alphabetically. */
export function pagePropertyOrder(c: CollectionRecord): string[] {
  const stored = ((c.format?.collection_page_properties ?? []) as { property: string }[]).map((e) => e.property).filter((id) => c.schema[id] && id !== 'title');
  const rest = Object.keys(c.schema).filter((id) => id !== 'title' && !stored.includes(id)).sort((a, b) => c.schema[a].name.localeCompare(c.schema[b].name));
  return [...stored, ...rest];
}

export function pageLayoutOf(c: CollectionRecord): PageLayout {
  return normalizePageLayout(c.format?.page_layout, c.schema, pagePropertyOrder(c));
}

/** Page options a database row page takes from its data source's layout builder (Options › Inline comments, Heading ›
 *  Backlinks) — only what the layout sets; the page's own ••• choices win (comments/margin.tsx, page/Backlinks.tsx). */
export function rowLayoutOptions(page: { parent_table?: string; parent_id?: string } | undefined): { inlineComments?: 'default' | 'minimal'; backlinks?: 'show' | 'hover' | 'off' } | null {
  if (!page || page.parent_table !== 'collection' || !page.parent_id) return null;
  const c = records.get<CollectionRecord>('collection', page.parent_id);
  if (!c?.format?.page_layout) return null;
  const layout = pageLayoutOf(c);
  const title = layout.modules.page_main.find((m) => m.type === 'title') as TitleModule | undefined;
  return { inlineComments: layout.settings.inline_comments, backlinks: title?.backlinks };
}

/** "Apply to all pages": the layout is stored on the data source and used by every page of it. */
export function applyPageLayout(c: CollectionRecord, layout: PageLayout) {
  const clean = normalizePageLayout(layout, c.schema, pagePropertyOrder(c));
  run('applyPageLayout', (tx) => tx.update('collection', c.id, ['format'], { page_layout: clean }));
}

/** "Reset to original page layout" (no properties are deleted). */
export function resetPageLayout(c: CollectionRecord) {
  run('resetPageLayout', (tx) => tx.update('collection', c.id, ['format'], nullify({ page_layout: undefined })));
}

// ------------------------------------------------------------------ details panel (per data source, this device)

const PANEL_KEY = 'nc:layoutPanelOpen';
function loadPanel(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(PANEL_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export const useDetailsPanel = create<{ open: Record<string, boolean>; set: (collectionId: string, open: boolean) => void }>((set, get) => ({
  open: loadPanel(),
  set: (collectionId, open) => {
    const all = { ...get().open, [collectionId]: open };
    set({ open: all });
    try {
      localStorage.setItem(PANEL_KEY, JSON.stringify(all));
    } catch {
      /* ignore */
    }
  },
}));

export const DETAILS_PANEL_WIDTH = 360;

export interface RowPageLayout {
  layout: PageLayout | null;
  collection?: CollectionRecord;
  /** the details panel has modules and is open */
  panelOpen: boolean;
  hasPanel: boolean;
  /** layout default for full width (pages can still override it) */
  fullWidth?: boolean;
}

/** Layout state of a database row page (PageView): null layout for pages that aren't database rows. */
export function useRowPageLayout(pageId: string): RowPageLayout {
  const page = useBlock(pageId);
  const c = useCollection(page?.parent_table === 'collection' ? page.parent_id : undefined) as CollectionRecord | undefined;
  const open = useDetailsPanel((s) => (c ? s.open[c.id] : undefined));
  if (!page || !c) return { layout: null, panelOpen: false, hasPanel: false };
  const layout = pageLayoutOf(c);
  const hasPanel = layout.modules.page_details.length > 0;
  return { layout, collection: c, hasPanel, panelOpen: hasPanel && open !== false, fullWidth: layout.settings.full_width };
}

export function rowCollection(page: BlockRecord | undefined): CollectionRecord | undefined {
  return page?.parent_table === 'collection' ? records.get<CollectionRecord>('collection', page.parent_id) : undefined;
}

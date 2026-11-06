
// The sidebar's New page shortcut creates the page where the shortcut points ("New page" = Private,
// or "New page in {page / database}" through the shortcut menu) and opens it in preview mode: a center peek whose
// top bar carries an "Add to ▾" location dropdown (the Move-to picker, other workspaces included). Nothing chosen = the
// page stays where it was created (Private by default).
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord, SpaceViewRecord, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { useBlock, useTableVersion } from '../../../lib/hooks.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { currentSpaceView, useSession } from '../../../lib/store/session.ts';
import { openPeek } from '../../../lib/router.ts';
import { newPage, pageTitle } from '../../page/pageActions.ts';
import { openMoveToDialog } from '../../page/MoveTo.tsx';
import { PageIcon } from '../PageIcon.tsx';
import { t } from '../i18n.ts';
import { findShortcut, layoutOf, updateLayout, type SidebarShortcut } from './model.ts';

export interface NewPageDestination {
  kind: 'page' | 'database';
  id: string;
}

/** Pages opened in preview mode during this session (their peek shows "Add to ▾"). */
export const usePreviewPages = create<{ ids: Record<string, true>; mark: (id: string) => void }>((set) => ({
  ids: {},
  mark: (id) => set((s) => ({ ids: { ...s.ids, [id]: true } })),
}));

function destinationOf(s: SidebarShortcut): NewPageDestination | undefined {
  const d = (s as SidebarShortcut & { destination?: NewPageDestination }).destination;
  if (!d || (d.kind !== 'page' && d.kind !== 'database') || !d.id) return undefined;
  const b = records.get<BlockRecord>('block', d.id);
  return b && b.alive !== false ? d : undefined;
}

function databaseName(blockId: string): string {
  const b = records.get<BlockRecord>('block', blockId);
  const col = b?.collection_id ? records.get<CollectionRecord>('collection', b.collection_id) : undefined;
  return toPlainText(col?.name) || pageTitle(b) || t('lp.shell.untitled', 'Untitled');
}

/** "New page" / "New page in {pageName}" / "New page in {databaseName}". */
export function newPageShortcutLabel(s: SidebarShortcut): string {
  const d = destinationOf(s);
  if (!d) return t('lp.shell.new_page', 'New page');
  if (d.kind === 'database') return t('lp.shell.create_page_in_6794', 'Create page in {databaseName}', { databaseName: databaseName(d.id) });
  return t('lp.shell.create_page_in_33c2', 'Create page in {pageName}', { pageName: pageTitle(records.get<BlockRecord>('block', d.id)) || t('lp.shell.untitled', 'Untitled') });
}

/** New page shortcut: create the page at the shortcut's destination and open it in preview mode (center peek). */
export async function runNewPageShortcut(s: SidebarShortcut): Promise<void> {
  const d = destinationOf(s);
  let id = '';
  if (d?.kind === 'database') {
    const b = records.get<BlockRecord>('block', d.id);
    if (b?.collection_id) {
      const { createRow } = await import('../../database/actions.ts');
      id = createRow(b.collection_id);
    }
  } else if (d?.kind === 'page') {
    const p = records.get<BlockRecord>('block', d.id);
    id = newPage({ kind: 'block', parentId: d.id, after: p?.content?.[p.content.length - 1] }, { open: false });
  }
  if (!id) id = newPage({ kind: 'private' }, { open: false });
  openPreviewPage(id);
}

/** Open a freshly created page in preview mode. */
export function openPreviewPage(id: string) {
  usePreviewPages.getState().mark(id);
  openPeek(id, 'center_peek');
}

// ---------------------------------------------------------------- "Add to ▾" in the preview's top bar
function locationOf(page: BlockRecord | undefined): { label: string; icon: React.ReactNode } {
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  if (!page) return { label: '', icon: null };
  if (page.parent_table === 'space' && sv?.private_pages?.includes(page.id)) {
    return { label: t('lp.shell.private_pages', 'Private pages'), icon: <Icon name="lockFill" size={14} style={{ color: 'var(--lp-icon-tertiary)' }} /> };
  }
  if (page.parent_table === 'team') {
    const team = records.get<TeamRecord>('team', page.parent_id);
    return { label: team?.name ?? t('lp.shell.team', 'Team'), icon: <PageIcon icon={team?.icon || undefined} size={16} fallback="workspace" /> };
  }
  if (page.parent_table === 'collection') {
    const col = records.get<CollectionRecord>('collection', page.parent_id);
    const host = records.get<BlockRecord>('block', col?.parent_id);
    return { label: toPlainText(col?.name) || t('lp.shell.untitled', 'Untitled'), icon: host ? <PageIcon block={host} size={16} fallback="viewTable" /> : null };
  }
  if (page.parent_table === 'block') {
    const parent = records.get<BlockRecord>('block', page.parent_id);
    return { label: pageTitle(parent) || t('lp.shell.untitled', 'Untitled'), icon: parent ? <PageIcon block={parent} size={16} /> : null };
  }
  return { label: records.get<{ id: string; version: number; name?: string }>('space', page.space_id)?.name ?? '', icon: null };
}

/** Preview mode location dropdown: "Add to 🔒 Private pages ▾" → the Move-to picker ("Search page to add to…"). */
export function PreviewAddTo({ pageId }: { pageId: string }) {
  const isPreview = usePreviewPages((s) => !!s.ids[pageId]);
  const page = useBlock(pageId);
  useTableVersion(['space_view']);
  if (!isPreview || !page) return null;
  const loc = locationOf(page);
  return (
    <div
      role="button"
      className="nc-btn nc-preview-addto"
      aria-label={`${t('lp.shell.add_to', 'Add to')} ${loc.label}`}
      onClick={(e) => openMoveToDialog([pageId], e.currentTarget as HTMLElement, { addTo: true })}
    >
      <span className="nc-preview-addto-label">{t('lp.shell.add_to', 'Add to')}</span>
      {loc.icon}
      <span className="nc-ellipsis nc-preview-addto-loc">{loc.label}</span>
      <Icon name="arrowChevronSingleDownFill" size={11} style={{ color: 'var(--lp-icon-tertiary)' }} />
    </div>
  );
}

// ---------------------------------------------------------------- shortcut ••• › New page in…
/** Destination picker for a New page shortcut (search "New page in…": Private, pages and databases). */
export function openNewPageDestinationPicker(shortcutId: string, anchor: Anchor) {
  openOverlay((close) => <DestinationPicker shortcutId={shortcutId} close={close} />, { anchor, placement: 'right-start', offset: 4 });
}

function setDestination(shortcutId: string, d: NewPageDestination | undefined) {
  updateLayout((l) => {
    const loc = findShortcut(l, shortcutId);
    if (!loc) return;
    const s = loc.tab.shortcuts[loc.index] as SidebarShortcut & { destination?: NewPageDestination };
    if (d) s.destination = d;
    else delete s.destination;
  });
}

function DestinationPicker({ shortcutId, close }: { shortcutId: string; close: () => void }) {
  const [q, setQ] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const spaceId = useSession((s) => s.spaceId);
  const shortcut = findShortcut(layoutOf(currentSpaceView()), shortcutId);
  const current = shortcut ? destinationOf(shortcut.tab.shortcuts[shortcut.index]) : undefined;
  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        if (q.trim()) {
          const res = await api('searchWorkspace', { query: q, spaceId, limit: 20 });
          records.mergeRecordMap(res.recordMap);
          if (live) setIds(res.results.map((r: { id: string }) => r.id));
        } else {
          const res = await api('listRecentPages', { spaceId, limit: 12 });
          records.mergeRecordMap(res.recordMap);
          if (live) setIds((res.pages ?? []).map((p: { id: string }) => p.id));
        }
      } catch {
        if (live) setIds([]);
      }
    }, q.trim() ? 150 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [q, spaceId]);
  const rows = ids.map((id) => records.get<BlockRecord>('block', id)).filter((b): b is BlockRecord => !!b && b.alive !== false && (b.type === 'page' || b.type === 'collection_view_page' || b.type === 'collection_view'));
  const pick = (d: NewPageDestination | undefined) => {
    setDestination(shortcutId, d);
    close();
  };
  const showPrivate = !q.trim() || t('lp.shell.private', 'Private').toLowerCase().startsWith(q.trim().toLowerCase());
  return (
    <PopoverSurface width={300} maxHeight={360} className="nc-newpage-dest">
      <div className="nc-moveto-search">
        <div className="nc-input">
          <Icon name="search" size={16} style={{ color: 'var(--lp-icon-secondary)', flexShrink: 0 }} />
          <input autoFocus placeholder={t('lp.shell.create_page_in', 'Create page in…')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') close(); }} />
        </div>
      </div>
      <div className="lit-scroller vertical nc-moveto-list" role="menu">
        {showPrivate && (
          <div role="menuitem" className={`nc-moveto-row ${!current ? 'current' : ''}`} onClick={() => pick(undefined)}>
            <Icon name="lockFill" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
            <span className="nc-ellipsis label">{t('lp.shell.private', 'Private')}</span>
            {!current && <Icon name="check" size={14} />}
          </div>
        )}
        {rows.map((b) => {
          const db = b.type === 'collection_view_page' || b.type === 'collection_view';
          const on = current?.id === b.id;
          return (
            <div key={b.id} role="menuitem" className={`nc-moveto-row ${on ? 'current' : ''}`} onClick={() => pick({ kind: db ? 'database' : 'page', id: b.id })}>
              <PageIcon block={b} size={18} fallback={db ? 'viewTable' : 'page'} />
              <span className="nc-ellipsis label">{db ? databaseName(b.id) : pageTitle(b) || t('lp.shell.untitled', 'Untitled')}</span>
              {on && <Icon name="check" size={14} />}
            </div>
          );
        })}
        {q.trim() && !rows.length && !showPrivate && <div className="nc-moveto-empty">{t('lp.shell.no_results', 'No results')}</div>}
      </div>
    </PopoverSurface>
  );
}

// Page archive (beta). `•••` › Archive keeps a page (or database) with its links,
// mentions and history but takes it out of the way: hidden from the sidebar, database views and search (Content
// status filter brings it back), shown with the yellow "This page was archived by … on …" banner + Unarchive.
// Model: packages/shared/src/archive.ts (flag on the archived page; subpages are archived through it).
import { create } from 'zustand';
import type { BlockRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { archiveStateOf, isArchivedRecord, type ArchiveState } from '@nc/shared/archive.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { getBlock, me, run } from '../../lib/blocks.ts';
import { useRecord, useRole, useTableVersion } from '../../lib/hooks.ts';
import { openPage } from '../../lib/router.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';
import { pageTitle } from './pageActions.ts';

const lookup = {
  block: (id: string) => records.get<BlockRecord>('block', id),
  collection: (id: string) => records.get<any>('collection', id),
  team: (id: string) => records.get<TeamRecord>('team', id),
};

export { isArchivedRecord };

/** Why a page is archived (itself, an ancestor, its teamspace) from the loaded records, or null. */
export function archiveState(pageId: string | undefined | null): ArchiveState | null {
  return archiveStateOf(lookup, pageId);
}

/** Live archive state (re-renders when any block or teamspace changes: ancestors can be (un)archived). */
export function useArchiveState(pageId: string | undefined | null): ArchiveState | null {
  useTableVersion(['block', 'team']);
  return archiveState(pageId);
}

export function archivePage(pageId: string, opts: { toast?: boolean } = {}) {
  const page = getBlock(pageId);
  if (!page || isArchivedRecord(page)) return;
  run('archivePage', (tx) => tx.update('block', pageId, [], { archived_time: Date.now(), archived_by: me() }));
  if (opts.toast !== false) {
    useUI.getState().toast(t('lp.page.archived_page', 'Archived page'), { label: t('lp.page.undo', 'Undo'), run: () => unarchivePage(pageId, { toast: false }) });
  }
}

export function unarchivePage(pageId: string, opts: { toast?: boolean } = {}) {
  const page = getBlock(pageId);
  if (!page || !isArchivedRecord(page)) return;
  run('unarchivePage', (tx) => tx.update('block', pageId, [], { archived_time: null, archived_by: null }));
  if (opts.toast !== false) useUI.getState().toast(t('lp.page.page_unarchived', 'Page unarchived'));
}

function archivedDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** Yellow banner on archived pages: direct archive with Unarchive, or the
 *  ancestor page / archived teamspace it is archived through. */
export function ArchivedBanner({ page }: { page: BlockRecord }) {
  const state = useArchiveState(page.id);
  const root = state?.root;
  const by = useRecord<UserRecord>('lit_user', (root?.archived_by as string | undefined) ?? undefined);
  const role = useRole('block', root?.id ?? page.id);
  if (!state) return null;
  const canEdit = roleAtLeast(role, 'read_and_write');
  if (state.team) {
    return (
      <div className="nc-archived-banner" role="status">
        <Icon name="archive" size={16} />
        <span>{t('lp.page.the_team_is_archived_so_this', 'The team {teamspaceName} is archived, so this page is archived too', { teamspaceName: state.team.name || 'Untitled' })}</span>
      </div>
    );
  }
  if (!root) return null;
  if (!state.direct) {
    return (
      <div className="nc-archived-banner" role="status">
        <Icon name="archive" size={16} />
        <span>
          {t('lp.page.this_page_sits_inside_so_it', 'This page sits inside {pageLink}, so it’s archived too', { pageLink: '\u0000' }).split('\u0000').map((part, i) => (
            i === 0 ? <span key={i}>{part}</span> : <span key={i}><a role="link" className="nc-archived-banner-link" onClick={() => openPage(root.id)}>{pageTitle(root) || 'Untitled'}</a>{part}</span>
          ))}
        </span>
      </div>
    );
  }
  return (
    <div className="nc-archived-banner" role="status">
      <Icon name="archive" size={16} />
      <span>{t('lp.page.archived_this_page_on', '{archivedBy} archived this page on {archivedDate}', { archivedBy: userName(by), archivedDate: archivedDate(Number(root.archived_time)) })}</span>
      <div role="button" className={`nc-banner-btn yellow ${canEdit ? '' : 'disabled'}`} onClick={() => canEdit && unarchivePage(root.id)}>
        {t('lp.page.unarchive', 'Unarchive')}
      </div>
    </div>
  );
}

/** Small archive glyph shown after an archived page's name (breadcrumbs, search results, links). */
export function ArchivedMark({ pageId, size = 14 }: { pageId: string; size?: number }) {
  const state = useArchiveState(pageId);
  if (!state) return null;
  return (
    <span className="nc-archived-mark" data-tooltip={t('lp.page.archived', 'Archived')} aria-label={t('lp.page.archived', 'Archived')}>
      <Icon name="archive" size={size} />
    </span>
  );
}

// ---------------------------------------------------------------- database: Settings › View archived pages

interface ArchivedViews {
  /** database block id → showing its archived rows */
  on: Record<string, boolean>;
  set: (blockId: string, on: boolean) => void;
}
export const useArchivedViews = create<ArchivedViews>((set) => ({
  on: {},
  set: (blockId, on) => set((s) => ({ on: { ...s.on, [blockId]: on } })),
}));

/** Rows a database view shows: live rows normally, only the archived ones in "View archived pages". */
export function rowsForArchiveMode<T extends { [key: string]: unknown }>(rows: T[], archivedMode: boolean): T[] {
  return rows.filter((r) => (archivedMode ? isArchivedRecord(r) : !isArchivedRecord(r)));
}

/** "Viewing archived pages · Exit" above a database in archive view. */
export function ArchivedViewBanner({ blockId }: { blockId: string }) {
  const on = useArchivedViews((s) => !!s.on[blockId]);
  if (!on) return null;
  return (
    <div className="nc-archived-view-banner" role="status">
      <Icon name="archive" size={16} />
      <span className="msg">{t('lp.page.browsing_archived_pages', 'Browsing archived pages')}</span>
      <div role="button" className="nc-banner-btn yellow" onClick={() => useArchivedViews.getState().set(blockId, false)}>
        {t('lp.page.exit', 'Exit')}
      </div>
    </div>
  );
}

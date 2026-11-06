// Wikis: ••• › More › Turn into wiki / Undo wiki. The server converts the page
// (api/modules/wiki.ts turnIntoWiki / undoWiki); a wiki is a full-page database whose first view ("Home") renders the
// page's own blocks (wikiHome.view.tsx), with "All pages" and "Pages I manage" tables and Owner / Verification / Tags.
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { getBlock } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { confirmDialog } from './confirm.tsx';
import { pageTitle } from './pageActions.ts';

export function isWikiPage(page: BlockRecord | undefined): boolean {
  if (!page || page.type !== 'collection_view_page' || !page.collection_id) return false;
  return !!(records.get<CollectionRecord>('collection', page.collection_id)?.format as Record<string, unknown> | undefined)?.is_wiki;
}

/** A page inside a wiki (a row of a wiki database). */
export function isWikiRow(page: BlockRecord | undefined): boolean {
  if (!page || page.parent_table !== 'collection') return false;
  return !!(records.get<CollectionRecord>('collection', page.parent_id)?.format as Record<string, unknown> | undefined)?.is_wiki;
}

/** Turn into wiki needs full access on a plain page (not a database or a database page). */
export function canTurnIntoWiki(page: BlockRecord | undefined): boolean {
  return !!page && page.type === 'page' && page.parent_table !== 'collection' && !page.is_template && records.role('block', page.id) === 'editor';
}

export async function turnIntoWiki(pageId: string) {
  try {
    const res = await api<{ recordMap: any }>('turnIntoWiki', { pageId });
    records.mergeRecordMap(res.recordMap);
    useUI.getState().toast(t('lp.page.your_new_wiki_is_ready', 'Your new wiki is ready!'));
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? 'Could not turn this page into a wiki');
  }
}

export async function undoWiki(pageId: string) {
  const page = getBlock(pageId);
  const ok = await confirmDialog({
    message: t('lp.page.change_back_to_a_regular_page', 'Change “{pageName}” back to a regular page?', { pageName: pageTitle(page) || 'Untitled' }),
    description: t('lp.page.this_deletes_the_wiki_database_including', 'This deletes the wiki database, including all database views and page properties. You can’t undo this.'),
    confirmLabel: t('lp.page.undo_wiki', 'Undo wiki'),
  });
  if (!ok) return;
  try {
    const res = await api<{ recordMap: any }>('undoWiki', { pageId });
    records.mergeRecordMap(res.recordMap);
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? 'Could not undo the wiki');
  }
}

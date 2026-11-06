
// a "Comments" block (page discussions + an "Add a comment…" composer) closed by a divider, and, while the page is
// empty, the hint "Press ‘enter’ to continue with an empty page, or create a template" in place of the

import { useEffect, useRef } from 'react';
import type { BlockRecord, DiscussionRecord } from '@nc/shared/records.ts';
import { useBlock, useCollection, useRecords } from '../../lib/hooks.ts';
import type { CollectionRecord } from '@nc/shared/records.ts';
import { pageLayoutOf } from './layout/model.ts';
import { openPeek } from '../../lib/router.ts';
import { appendToPage } from '../editor/commands.ts';
import { CommentComposer, DiscussionThread, addComment, isPageDiscussion, isPostReactions, useComments } from '../comments/comments.tsx';
import { PostReactionPills } from './views/feed/FeedSocial.tsx';
import { createTemplate } from './actions.ts';
import { EmptyRowTemplates } from './templates/templates.tsx';
import { useCollectionAccess } from './access.ts';

export function RowComments({ pageId, canComment }: { pageId: string; canComment: boolean }) {
  const page = useBlock(pageId);
  const discussions = useRecords<DiscussionRecord>('discussion', page?.discussions);
  const active = useComments((s) => s.active);
  // reactions on the page (Feed view posts) show as pills, not as a comment thread
  const open = discussions.filter((d): d is DiscussionRecord => !!d && d.alive !== false && !d.resolved && isPageDiscussion(d, pageId) && !isPostReactions(d));
  
  // the shared composer leaves it unnamed, so label it from here
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = rootRef.current?.querySelector<HTMLElement>('.nc-comment-composer [role="textbox"]');
    if (box && !box.getAttribute('aria-label')) box.setAttribute('aria-label', box.getAttribute('placeholder') ?? 'Add a comment…');
  });
  return (
    <div ref={rootRef} className="layout-content nc-row-comments">
      <div className="nc-row-comments-inner">
        <div className="nc-row-comments-title">Comments</div>
        <div className="lit-page-view-discussion nc-row-comments-body">
          {page && <PostReactionPills row={page} />}
          {open.map((d) => (
            <DiscussionThread key={d.id} discussion={d} mode="page" active={active === d.id} onActivate={() => { if (active !== d.id) useComments.getState().set({ active: d.id }); }} />
          ))}
          {canComment && <CommentComposer onSubmit={(text) => addComment(pageId, text, undefined, undefined, { type: 'page' })} />}
        </div>
      </div>
    </div>
  );
}

export function EmptyRowHint({ page }: { page: BlockRecord }) {
  // page layout › "Database templates" off: empty pages don't offer templates
  const c = useCollection(page.parent_table === 'collection' ? page.parent_id : undefined) as CollectionRecord | undefined;
  // templates are part of the database: people who can't edit it (Can edit content, page-level rules only) can't add one
  const canCreateTemplate = useCollectionAccess(page.parent_table === 'collection' ? page.parent_id : undefined).canEditStructure;
  if (c && pageLayoutOf(c).settings.database_templates === false) return null;
  return (
    <div className="nc-empty-row-hint">
      <span className="nc-empty-row-continue" onMouseDown={(e) => { e.preventDefault(); appendToPage(page.id); }}>
        {canCreateTemplate ? <>Press ‘enter’ to continue with an empty page, or{' '}</> : 'Press ‘enter’ to continue with an empty page'}
      </span>
      {canCreateTemplate && <span
        role="button"
        className="nc-empty-row-template"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (page.parent_table !== 'collection') return;
          const id = createTemplate(page.parent_id);
          openPeek(id, 'center_peek');
        }}
      >
        create a template
      </span>}
      <EmptyRowTemplates page={page} />
    </div>
  );
}

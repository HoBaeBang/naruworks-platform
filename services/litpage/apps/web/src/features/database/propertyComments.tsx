// Comments on a property value of a database page (database.CommentButton, /): a quick
// action on page property rows — "Comment" opens a composer, "Open discussion" (with a count) opens the property's
// threads. The discussion on the page any other (discussion.property_id = the property; the comments
// sidebar lists it with the property name as context — never the value: it may be restricted by Property access, and
// the server only hands the thread to people who can see that value, apps/server propaccess.ts).
import type { BlockRecord, CollectionRecord, DiscussionRecord, PropertySchema } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { useRole, useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { CommentComposer, addComment, openDiscussionPopover } from '../comments/comments.tsx';
import { propertyAccessFor } from './access.ts';

/** Open (unresolved) discussions on `propId` of `page`. */
export function propertyDiscussions(page: BlockRecord, propId: string): DiscussionRecord[] {
  return (page.discussions ?? [])
    .map((id) => records.get<DiscussionRecord>('discussion', id))
    .filter((d): d is DiscussionRecord => !!d && d.alive !== false && !d.resolved && d.property_id === propId);
}

function openPropertyComposer(anchor: HTMLElement, page: BlockRecord, col: CollectionRecord, propId: string) {
  const prop: PropertySchema | undefined = col.schema[propId];
  const context = [[prop?.name ?? '']];
  openOverlay((close) => (
    <PopoverSurface width={420} className="nc-discussion-popover composer">
      <CommentComposer autoFocus onSubmit={(text) => { addComment(page.id, text, undefined, context as never, { type: 'default', propertyId: propId }); close(); }} onCancel={close} />
    </PopoverSurface>
  ), { anchor, placement: 'bottom-end', offset: 4 });
}

/** Hover button of a page property row ("Comment" / "Open discussion" with a count). */
export function PropertyCommentButton({ page, col, propId }: { page: BlockRecord; col: CollectionRecord; propId: string }) {
  useTableVersion(['discussion']);
  const role = useRole('block', page.id);
  const list = propertyDiscussions(page, propId);
  const count = list.length;
  if (!count && !roleAtLeast(role, 'comment_only')) return null;
  // a value hidden from this person (Property access) takes no comments from them: its threads aren't theirs to see
  if (!propertyAccessFor(col.id, propId, page).canSeeValues) return null;
  const label = count > 0 ? 'Open discussion' : 'Comment';
  return (
    <span
      role="button"
      className={`nc-prop-comment-btn ${count ? 'has-comments' : ''}`}
      aria-label={label}
      data-tooltip={label}
      data-testid="property-comment"
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation();
        if (count) openDiscussionPopover(list.map((d) => d.id), e.currentTarget);
        else openPropertyComposer(e.currentTarget, page, col, propId);
      }}
    >
      <Icon name="comment" size={14} />
      {count > 0 && <span className="nc-prop-comment-count">{count > 99 ? '99+' : count}</span>}
    </span>
  );
}

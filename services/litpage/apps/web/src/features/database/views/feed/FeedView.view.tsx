// Feed view: a centered stream of 752px cards (radius 12, padding 16, shadow 0 12px 32px
// rgba(0,0,0,.02) + 1px ring) with author byline "Name · 59m (edited)", 26px title, visible properties
// (feed_properties), the page's content preview, reactions + views (FeedSocial.tsx) and the post's comments with an
// "Add a comment" composer.
//:.2 (Layout: Wrap properties = table_wrap,
// Display author credit = feed_show_author_byline, Open pages in › Center peek, Load limit 10).
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { registerLayoutSettings, registerView, type LayoutSettingsProps, type ViewProps } from '../../viewRegistry.ts';
import { Icon } from '../../../../components/Icon.tsx';
import { useUser, useTableVersion } from '../../../../lib/hooks.ts';
import { records } from '../../../../lib/store/records.ts';
import { UserAvatar } from '../../../presence/Avatar.tsx';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { StaticBlockList } from '../../../page/StaticBlocks.tsx';
import { loadPage } from '../../../page/usePageLoader.ts';
import { PropertyCell } from '../../properties/PropertyCell.tsx';
import { viewCreationHooks } from '../../actions.ts';
import { conditionalBg, useConditionalColors } from '../../data.ts';
import { titleOf } from '../../advanced/index.ts';
import { SettingsToggle, setFormat, useViewKit, visibleProperties } from '../../advanced/viewKit.tsx';
import { PostComments, PostReactions, PostViews, useFeedViews, type PostViewInfo } from './FeedSocial.tsx';
import './feed.css';

function ago(t: number | undefined): string {
  if (!t) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d`;
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Byline({ row }: { row: BlockRecord }) {
  const user = useUser(row.created_by_id);
  const edited = (row.last_edited_time ?? 0) - (row.created_time ?? 0) > 60_000;
  // anonymous form responses are written with the form owner's access but credited to nobody
  const anonymous = !!(row.format as { form_response?: { anonymous?: boolean } } | undefined)?.form_response?.anonymous;
  return (
    <div className="nc-feed-byline">
      {anonymous ? <span className="nc-feed-anon">?</span> : <UserAvatar userId={row.created_by_id} size={24} />}
      <span className="nc-feed-author">{anonymous ? 'Anonymous' : user?.name || user?.email || 'Unknown'}</span>
      <span className="nc-feed-time">{ago(row.created_time)}{edited ? ' (edited)' : ''}</span>
    </div>
  );
}

const PREVIEW_BLOCKS = 6;

function FeedCard({ row, props, showByline, wrap, onOpen, bg, views }: { row: BlockRecord; props: { schema: Record<string, any>; ids: string[] }; showByline: boolean; wrap: boolean; onOpen: () => void; bg?: string; views?: PostViewInfo }) {
  useTableVersion(['block']);
  const content = (records.get<BlockRecord>('block', row.id)?.content ?? []).slice(0, PREVIEW_BLOCKS);
  return (
    <article className="nc-feed-card lit-feed-item" data-block-id={row.id} style={bg ? { background: bg } : undefined}>
      {showByline && <Byline row={row} />}
      <div className="nc-feed-body">
        <div role="link" className="nc-feed-title" onClick={onOpen}>
          <PageIcon block={row} size={26} fallback={null} className="nc-feed-icon" />
          <span>{titleOf(row) || 'Untitled'}</span>
        </div>
        {props.ids.length > 0 && (
          <div className={`nc-feed-props ${wrap ? 'wrap' : ''}`}>
            {props.ids.map((pid) => (
              <div key={pid} className="nc-feed-prop"><PropertyCell row={row} schema={props.schema} propId={pid} readOnly mode="card" noEdit /></div>
            ))}
          </div>
        )}
        {content.length > 0 && (
          <div className="nc-feed-content" onClick={onOpen}>
            <StaticBlockList ids={content} get={(id) => records.get<BlockRecord>('block', id)} />
          </div>
        )}
        <div className="nc-feed-actions">
          <PostReactions row={row} />
          <PostViews info={views} />
        </div>
        <PostComments row={row} onOpen={onOpen} />
      </div>
    </article>
  );
}

function FeedView(props: ViewProps) {
  const kit = useViewKit(props);
  const { view, collection, readOnly } = kit;
  const fmt = (view.format ?? {}) as Record<string, any>;
  // Load limit (default 10) + "Load more" for the next batch 
  const first = Math.max(1, Number(fmt.inline_collection_first_load_limit?.limit) || 10);
  const [limit, setLimit] = useState(first);
  useEffect(() => setLimit(first), [first, view.id]);
  const rows = kit.rows.slice(0, limit);
  const ids = visibleProperties(view, collection.schema);
  const showByline = fmt.feed_show_author_byline !== false;
  const wrap = fmt.table_wrap === true;
  const bleed = kit.db?.bleed ?? { left: 0, right: 0 };
  // View settings › Conditional color tints the posts 
  const colorsOf = useConditionalColors(view, collection);
  // Track views: who opened each post
  const views = useFeedViews(rows.map((r) => r.id));

  // page bodies (content previews) and comments of the posts
  useEffect(() => {
    for (const r of rows) {
      const needsBody = r.content?.length && !records.get('block', r.content[0]);
      const needsComments = r.discussions?.some((id) => !records.get('discussion', id));
      if (needsBody || needsComments) void loadPage(r.id);
    }
  }, [rows.map((r) => r.id).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="nc-feed lit-feed-view" style={{ paddingInlineStart: bleed.left, paddingInlineEnd: bleed.right }}>
      {rows.map((r) => <FeedCard key={r.id} row={r} props={{ schema: collection.schema, ids }} showByline={showByline} wrap={wrap} onOpen={() => kit.openRow(r.id)} bg={conditionalBg(colorsOf(r)?.row)} views={views[r.id]} />)}
      {kit.rows.length > limit && (
        <div role="button" className="nc-feed-load-more" onClick={() => setLimit((l) => l + first)}>
          <Icon name="arrowDown" size={16} />
          <span>Load more</span>
        </div>
      )}
      {!readOnly && (
        <div role="button" className="nc-feed-new" onClick={() => kit.addRow(undefined, { open: true })}><Icon name="plus" size={16} /><span>New page</span></div>
      )}
    </div>
  );
}

registerView('feed', FeedView);

function FeedLayoutSettings({ view, readOnly }: LayoutSettingsProps) {
  const fmt = (view.format ?? {}) as Record<string, any>;
  return (
    <>
      <SettingsToggle label="Wrap properties" on={fmt.table_wrap === true} disabled={readOnly} onChange={(v) => setFormat(view, { table_wrap: v }, 'feedView.wrapProperties')} />
      <SettingsToggle label="Display author credit" on={fmt.feed_show_author_byline !== false} disabled={readOnly} onChange={(v) => setFormat(view, { feed_show_author_byline: v }, 'feedView.showAuthorByline')} />
    </>
  );
}

registerLayoutSettings('feed', FeedLayoutSettings);

/** New feed views: center peek, author byline on, load limit 10 (2). */
viewCreationHooks.feed = (tx, viewId) => {
  tx.update('collection_view', viewId, ['format'], { feed_show_author_byline: true, collection_peek_mode: 'center_peek', inline_collection_first_load_limit: { type: 'load_limit', limit: 10 } });
};

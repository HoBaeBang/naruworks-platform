// Page: banners (Trash, "This page is live on …"), cover, header controls (Add icon / Add cover / Add comment /
// N backlinks), icon, title, database-row properties, backlinks + page discussions, block content, margin
// comments, floating contents list, live cursors of other viewers and the "Start with" bar.
// Layout grid: [full-start] minmax(96px,1fr) [content-start]
// minmax(auto,720px) [content-end] var(--margin-right-width, minmax(96px,1fr)) [full-end].
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { trashRetentionDays } from '@nc/shared/retention.ts';
import { length, slice, type RichText } from '@nc/shared/richtext.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { useBlock, useRecord, useRole } from '../../lib/hooks.ts';
import { run, setTitle, setFormat, createBlockIn, getBlock } from '../../lib/blocks.ts';
import { api } from '../../lib/api.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useSession } from '../../lib/store/session.ts';
import { navigate, openPage, spaceDomain } from '../../lib/router.ts';
import { RichTextEditable } from '../editor/RichTextEditable.tsx';
import { BlockList } from '../editor/Block.tsx';
import { appendToPage } from '../editor/commands.ts';
import { useEditor } from '../editor/editorState.ts';
import { EditorSurface } from '../editor/EditorSurface.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';
import { retentionDurationLabel } from '../settings/spaceSettings.ts';
import { openIconPicker, randomEmoji } from './IconPicker.tsx';
import { PageCover, randomCover } from './Cover.tsx';
import { EmptyRowHint } from '../database/RowPageExtras.tsx';
import { RowDetailsPanel, RowLayoutBottom, RowLayoutTop, rowPanelStyle, useRowPageLayout } from '../database/layout/RowLayout.tsx';
import { CollectionPage } from '../database/CollectionPage.tsx';
import { PageDiscussions, startPageComment } from '../comments/comments.tsx';
import { DiscussionHighlightStyles, MARGIN_WIDTH, PageCommentsLayer, useDiscussionInteractions, useMarginComments } from '../comments/margin.tsx';
import { PresenceLayer } from '../presence/PresenceLayer.tsx';
import { installPresenceReporter } from '../presence/presence.ts';
import { userName } from '../presence/Avatar.tsx';
import { GetStartedBar } from './GetStartedBar.tsx';
import { TableOfContentsRail } from './TocRail.tsx';
import { BacklinksButton, BacklinksSection, backlinksMode, useBacklinks } from './Backlinks.tsx';
import { useEffectiveLock } from './PageLock.tsx';
import { publishedRoot, shareStateOf, openShareMenuFromTopbar, publicPath, siteHost } from './ShareMenu.tsx';
import { pageSetting } from './PageMenu.tsx';
import { confirmDialog } from './confirm.tsx';
import { pageTitle, restorePage } from './pageActions.ts';
import { pageDocumentTitle, useDocumentTitle } from '../database/documentTitle.ts';
import { ArchivedBanner } from './archive.tsx';
import { PageVerification, openVerifyMenu, showAddVerification } from './verification.tsx';
import { useVersionLink } from './VersionHistory.tsx';
import { NoAccessPage } from '../shell/access/NoAccessPage.tsx';
import { PermissionBanner } from '../shell/access/PermissionBanner.tsx';
import { InstructionsBanner } from '../meetings/instructions.tsx';
import { AgentInstructionsBanner } from '../agents/InstructionsBanner.tsx';
import '../editor/blocks/TextBlocks.tsx';
import '../editor/blocks/registerAll.ts';
import '../editor/editor.css';
import './page.css';

export function PageView({ pageId, state, inPeek, publicView }: { pageId: string; state: 'loading' | 'ok' | 'missing'; inPeek?: boolean; publicView?: boolean }) {
  const page = useBlock(pageId);
  const role = useRole('block', pageId);
  const locked = useEffectiveLock(pageId);
  // database rows follow their data source's page layout (pinned properties, sections, details panel, tabs)
  const rowLayout = useRowPageLayout(pageId);
  const readOnly = !!publicView || !roleAtLeast(role, 'read_and_write') || locked || page?.alive === false;
  // a public page whose link lets anyone comment shows its threads; signed-in visitors can add to them
  const signedIn = useSession((s) => s.status === 'ready');
  const publicComments = !!publicView && roleAtLeast(role, 'comment_only');
  const showComments = !publicView || publicComments;
  const commentsReadOnly = publicView ? !signedIn : readOnly && role !== 'comment_only';
  const scroller = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const margin = useMarginComments(pageId, layoutRef, showComments);
  useDiscussionInteractions(pageId, margin, scroller);

  useEffect(() => {
    if (!publicView) installPresenceReporter();
  }, [publicView]);
  // shared version links (?vh=…) open Version history at that version
  useVersionLink(pageId, !!page && !publicView);
  // browser tab title follows the page title (full-page databases set theirs in DatabaseView, public pages in PublicPage)
  const isDatabase = page?.type === 'collection_view_page' || page?.type === 'collection_view';
  useDocumentTitle(page && !inPeek && !publicView && !isDatabase ? pageDocumentTitle(pageTitle(page), t('lp.page.new_page', 'New page')) : null);

  // page analytics: one view per open (server coalesces reloads)
  const alive = !!page;
  useEffect(() => {
    if (!alive) return;
    // a brand-new page may not have reached the server yet: record once it exists there
    let tries = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      void api<{ recorded?: boolean }>('recordPageView', { pageId, public: !!publicView })
        .then((r) => { if (r && r.recorded === false && tries++ < 5) timer = setTimeout(send, 1500); })
        .catch(() => {});
    };
    timer = setTimeout(send, 600);
    return () => clearTimeout(timer);
  }, [pageId, alive, publicView]);

  useEffect(() => {
    // focus the title of a brand-new untitled empty page (right after "New page")
    if (!page || readOnly) return;
    if (length(page.properties?.title) === 0 && !(page.content?.length) && Date.now() - page.created_time < 10_000) {
      useEditor.getState().requestFocus(pageId, 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, !!page]);

  if (!page) {
    // the server tells apart missing pages and pages you can request access to
    if (state === 'missing') return publicView ? <PageNotFound /> : <NoAccessPage pageId={pageId} />;
    return <div className="nc-page-loading" />;
  }
  const banners = (
    <>
      {!page.alive && !publicView && <TrashBanner page={page} />}
      {page.alive && !publicView && <ArchivedBanner page={page} />}
      {page.alive && !publicView && !inPeek && <SitesBanner page={page} />}
      {page.alive && !publicView && !inPeek && <PermissionBanner page={page} />}
      {page.alive && !publicView && <AgentInstructionsBanner page={page} />}
    </>
  );
  // full-page databases, and inline databases opened "as full page" (↗ in the database toolbar)
  if (page.type === 'collection_view_page' || page.type === 'collection_view') {
    return (
      <>
        {banners}
        <CollectionPage block={page} inPeek={inPeek} />
      </>
    );
  }

  const full = !!(page.format?.page_full_width ?? rowLayout.fullWidth);
  const small = !!page.format?.page_small_text;
  const font = (page.format?.page_font as string) ?? 'default';
  const showToc = !inPeek && !margin && pageSetting(page, 'page_floating_table_of_contents');
  const blMode = backlinksMode(page);
  return (
    <>
      {banners}
      <div ref={scroller} className={`lit-scroller vertical nc-page-scroller font-${font} ${small ? 'small-text' : ''}`} data-page-id={pageId}>
        <EditorSurface pageId={pageId} readOnly={readOnly} scroller={scroller}>
          <div
            ref={layoutRef}
            className={`layout ${full ? 'layout-wide' : ''} ${margin ? 'with-margin-comments' : ''}`}
            style={margin ? ({ ['--margin-right-width' as any]: `minmax(${MARGIN_WIDTH}px, 1fr)` }) : (rowPanelStyle(rowLayout.panelOpen) as React.CSSProperties | undefined)}
          >
            <div className="layout-full">
              {page.format?.page_cover && <PageCover page={page} readOnly={readOnly} />}
            </div>
            <div className="layout-content">
              <PageHeader page={page} readOnly={readOnly} publicView={publicView} backlinks={blMode} />
              {!publicView && <PageVerification pageId={page.id} readOnly={readOnly} />}
              {/* AI meeting notes instructions page: "This page contains AI meeting notes summary instructions." */}
              {!publicView && <InstructionsBanner pageId={page.id} />}
            </div>
            {/* database rows: properties + "Comments" block in the data source's layout order */}
            {page.parent_table === 'collection' && <RowLayoutTop page={page} readOnly={readOnly} publicView={publicView} canComment={roleAtLeast(role, 'comment_only')} />}
            <div className="layout-content" style={{ marginTop: 8 }}>
              {blMode === 'section' && !publicView && <BacklinksSection pageId={pageId} />}
              {showComments && page.parent_table !== 'collection' && <PageDiscussions pageId={pageId} readOnly={commentsReadOnly} />}
              <div className="lit-page-content">
                <BlockList parentId={pageId} ids={page.content} depth={0} readOnly={readOnly} />
                {!readOnly && <ClickToAppend pageId={pageId} />}
              </div>
              {/* the "Start with" bar stays in the content column, absolutely pinned near the viewport bottom */}
              {!readOnly && !(page.content?.length) && (page.parent_table === 'collection' ? <EmptyRowHint page={page} /> : <GetStartedBar pageId={pageId} />)}
            </div>
            {page.parent_table === 'collection' && <RowLayoutBottom page={page} readOnly={readOnly} publicView={publicView} canComment={roleAtLeast(role, 'comment_only')} />}
            {page.parent_table === 'collection' && !margin && <RowDetailsPanel page={page} readOnly={readOnly} publicView={publicView} canComment={roleAtLeast(role, 'comment_only')} />}
            {showComments && <PageCommentsLayer pageId={pageId} margin={margin} readOnly={commentsReadOnly} />}
            {showToc && <TableOfContentsRail pageId={pageId} scroller={scroller} />}
          </div>
        </EditorSurface>
        {!publicView && <PresenceLayer pageId={pageId} rootRef={scroller} />}
        {showComments && <DiscussionHighlightStyles pageId={pageId} />}
      </div>
    </>
  );
}

function openPageIconPicker(pageId: string, anchor: HTMLElement) {
  openIconPicker(anchor, {
    current: getBlock(pageId)?.format?.page_icon as string | undefined,
    onPick: (v) => run(v ? 'setPageIcon' : 'removePageIcon', (tx) => setFormat(tx, pageId, { page_icon: v ?? null } as any)),
  });
}

function ClickToAppend({ pageId }: { pageId: string }) {
  return <div className="nc-click-to-append" onMouseDown={(e) => { e.preventDefault(); appendToPage(pageId); }} />;
}

function PageHeader({ page, readOnly, publicView, backlinks }: { page: BlockRecord; readOnly: boolean; publicView?: boolean; backlinks: 'section' | 'popover' | 'off' }) {
  const [hover, setHover] = useState(false);
  const icon = page.format?.page_icon as string | undefined;
  const hasCover = !!page.format?.page_cover;
  const role = useRole('block', page.id);
  // public pages: "Add comment" only for signed-in visitors of links that allow comments
  const signedIn = useSession((s) => s.status === 'ready');
  const canComment = (!publicView || signedIn) && roleAtLeast(role, 'comment_only');
  const bl = useBacklinks(page.id, backlinks !== 'off' && !publicView);
  const titleRef = useRef<HTMLDivElement>(null);
  const onTitleChange = useMemo(
    () => (next: RichText, info: { caret: number; prev?: RichText }) => {
      run('Text.handleMutation', (tx) => setTitle(tx, page.id, next, info.prev), { coalesceKey: `type:${page.id}:title`, selectionAfter: { blockId: page.id, offset: info.caret } });
    },
    [page.id],
  );
  const controls: React.ReactNode[] = [];
  if (!readOnly && !icon) {
    controls.push(
      <div key="icon" role="button" className="nc-page-control" onClick={() => {
        // apply a random emoji immediately and open the picker under the new icon
        run('addPageIcon', (tx) => setFormat(tx, page.id, { page_icon: randomEmoji() }));
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const el = document.querySelector<HTMLElement>(`.nc-page-header[data-header-for="${page.id}"] .nc-page-icon`);
          if (el) openPageIconPicker(page.id, el);
        }));
      }}>
        <Icon name="pageControlFace" size={14} />{t('lp.page.add_icon', 'Add icon')}
      </div>,
    );
  }
  if (!readOnly && !hasCover) {
    controls.push(
      <div key="cover" role="button" className="nc-page-control" onClick={() => run('addPageCover', (tx) => setFormat(tx, page.id, { page_cover: randomCover(), page_cover_position: 0.5 }))}>
        <Icon name="pageControlCover" size={14} />{t('lp.page.add_cover', 'Add cover')}
      </div>,
    );
  }
  if (backlinks === 'popover' && bl.length > 0) controls.push(<BacklinksButton key="bl" pageId={page.id} pages={bl} />);
  if (canComment && pageSetting(page, 'page_discussions')) {
    controls.push(
      <div key="comment" role="button" className="nc-page-control" onClick={() => startPageComment(page.id)}>
        <Icon name="pageControlComment" size={14} />{t('lp.page.add_comment', 'Add comment')}
      </div>,
    );
  }
  // page verification (Business+): "Add verification" → Verify page menu
  if (!readOnly && showAddVerification(page)) {
    controls.push(
      <div key="verify" role="button" className="nc-page-control" onClick={(e) => openVerifyMenu(e.currentTarget, page.id)}>
        <Icon name="verification" size={14} />{t('lp.page.add_verification', 'Add verification')}
      </div>,
    );
  }
  return (
    <div className="nc-page-header" data-header-for={page.id} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {icon && (
        <div className={`nc-page-icon-wrap ${hasCover ? 'with-cover' : ''}`}>
          <div
            role="button"
            aria-label={`${icon.startsWith('lit-icon') || /^(https?:|\/)/.test(icon) ? 'Page icon' : icon} Change page icon`}
            className="lit-record-icon nc-page-icon"
            onClick={(e) => !readOnly && openPageIconPicker(page.id, e.currentTarget)}
          >
            <PageIcon block={page} size={78} fallback={null} />
          </div>
        </div>
      )}
      {controls.length > 0 && (
        <div className="lit-page-controls" style={{ opacity: hover ? 1 : 0, pointerEvents: hover ? 'auto' : 'none', paddingTop: icon ? 8 : hasCover ? 16 : 80 }}>
          {controls}
        </div>
      )}
      {!controls.length && !icon && <div style={{ height: hasCover ? 48 : 112 }} />}
      <div className="lit-selectable lit-page-block nc-page-title" data-block-id={page.id} ref={titleRef}>
        <RichTextEditable
          blockId={page.id}
          value={page.properties?.title as RichText | undefined}
          readOnly={readOnly}
          tagName="h1"
          className="content-editable-leaf-rtl nc-title-leaf"
          placeholder={t('lp.page.new_page', 'New page')}
          placeholderAlways
          spellCheck
          onChange={onTitleChange}
          onKeyDown={(e, api2) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const sel = api2.selection();
              const tt = (page.properties?.title as RichText | undefined) ?? [];
              if (sel && sel.start < length(tt)) {
                // split the title: text after the caret becomes the first block
                let id = '';
                run('Text.handleEnter', (tx) => {
                  setTitle(tx, page.id, slice(tt, 0, sel.start));
                  id = createBlockIn(tx, { type: 'text', parentId: page.id, parentTable: 'block', first: true, title: slice(tt, sel.start) });
                });
                useEditor.getState().requestFocus(id, 0);
                return;
              }
              const first = page.content?.[0];
              const firstBlock = getBlock(first);
              if (firstBlock && firstBlock.type === 'text' && length(firstBlock.properties?.title) === 0) useEditor.getState().requestFocus(first!, 0);
              else {
                let id = '';
                run('Text.handleEnter', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: page.id, parentTable: 'block', first: true }); });
                useEditor.getState().requestFocus(id, 0);
              }
            } else if (e.key === 'ArrowDown' || (e.key === 'ArrowRight' && api2.atEnd())) {
              const line = api2.caretLine();
              if (e.key === 'ArrowDown' && !line.last) return;
              const leaf = document.querySelector<HTMLElement>(`.lit-page-content [data-content-editable-leaf]`);
              if (leaf) {
                e.preventDefault();
                useEditor.getState().requestFocus(leaf.dataset.blockId!, 0, { property: leaf.dataset.property, x: line.x, line: 'first' });
              }
            }
          }}
        />
      </div>
    </div>
  );
}

function PageNotFound() {
  return (
    <div className="nc-page-missing">
      <div className="nc-page-missing-title">We couldn’t find this page</div>
      <div className="nc-page-missing-sub">You may lack access, or the page moved or was removed. Check the URL and try again.</div>
    </div>
  );
}

/** Red banner on pages in Trash. */
function TrashBanner({ page }: { page: BlockRecord }) {
  const by = useRecord<UserRecord>('lit_user', page.deleted_by_id ?? page.last_edited_by_id);
  const role = useRole('block', page.id);
  const canEdit = roleAtLeast(role, 'read_and_write') || page.created_by_id === by?.id;
  const deleted = page.deleted_time ?? page.last_edited_time;
  // Settings › Security › Data retention: 30 days, or the Enterprise workspace's own number
  const space = useRecord<SpaceRecord>('space', page.space_id);
  const daysLeft = Math.max(1, trashRetentionDays(space) - Math.floor((Date.now() - deleted) / 86400000));
  const when = Date.now() - deleted < 60_000 ? 'just now' : Date.now() - deleted < 86400000 ? `${Math.round((Date.now() - deleted) / 3600000) || 1}h ago` : new Date(deleted).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <div className="nc-trash-banner" role="status">
      <span>{t('lp.page.moved_to_trash_by_permanent_deletion', 'Moved to Trash by {trashAuthorDisplayName} {movedToTrashDateComponent}. Permanent deletion in {numDaysLeftInTrashComponent}.', { trashAuthorDisplayName: userName(by), movedToTrashDateComponent: when, numDaysLeftInTrashComponent: retentionDurationLabel(daysLeft) })}</span>
      <div role="button" className={`nc-banner-btn ${canEdit ? '' : 'disabled'}`} onClick={() => canEdit && restorePage(page.id)}>
        <Icon name="undo" size={14} />{t('lp.page.restore_page', 'Restore page')}
      </div>
      <div
        role="button"
        className={`nc-banner-btn ${canEdit ? '' : 'disabled'}`}
        onClick={async () => {
          if (!canEdit) return;
          const ok = await confirmDialog({ message: 'Are you sure you want to delete this page permanently?', description: 'You can’t undo this action.', confirmLabel: t('lp.page.permanently_delete', 'Permanently delete') });
          if (!ok) return;
          await api('deleteBlocksPermanently', { blockIds: [page.id] }).catch(() => {});
          if (page.parent_table === 'block' && getBlock(page.parent_id)?.alive) openPage(page.parent_id);
          else navigate(`/${spaceDomain(page.space_id)}`);
          useUI.getState().toast('Page deleted permanently');
        }}
      >
        <Icon name="trash" size={14} />{t('lp.page.permanently_delete', 'Permanently delete')}
      </div>
    </div>
  );
}

/** "This page is live on {domain}" + View site / Site settings. */
function SitesBanner({ page }: { page: BlockRecord }) {
  const state = shareStateOf(page);
  if (state !== 'published') return null;
  const root = publishedRoot(page);
  if (!root) return null;
  const url = `${location.origin}${publicPath(page.id)}`;
  return (
    <div className="nc-sites-banner" role="status">
      <div className="msg">{t('lp.page.now_live_at', 'Now live at {domain}', { domain: siteHost() })}</div>
      <div className="actions">
        <div role="button" className="nc-banner-btn blue" onClick={() => window.open(url, '_blank')}>
          <Icon name="globe" size={16} />{t('lp.page.view_site', 'View site')}
        </div>
        <div role="button" className="nc-banner-btn blue" onClick={() => openShareMenuFromTopbar(page.id, 'publish')}>
          <Icon name="gear" size={16} />{t('lp.page.site_settings', 'Site settings')}
        </div>
      </div>
    </div>
  );
}

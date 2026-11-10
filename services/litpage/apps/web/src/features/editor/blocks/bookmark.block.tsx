// Web bookmark. Flow: properties.link [[url]] → POST
// /api/rpc/saveBookmarkPreview {type:"external-bookmark", block, url} → the server writes properties.title /
// description and format.bookmark_icon / bookmark_cover. Card: 704 wide, r10, border 1px
// var(--lp-border-primary), hover rgba(67, 20, 7, 0.05); title 17px/22px 500, description 13px/18px (2 lines), URL 13px/18px
// texSec with favicon; cover image on the right when og:image exists. Placeholder "Add a bookmark".
import type { RichText } from '@nc/shared/richtext.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openBlockMenu } from '../BlockMenu.tsx';
import { registerBlockMenu } from './registry.ts';
import { ActionBar, ActionButton, BlockPlaceholder, Caption, copyText, showCaption, sourceOf } from './shared.tsx';
import { openMediaPicker, refreshBookmark, useUploads } from './media/MediaPicker.tsx';
import { replaceMedia } from './media.block.tsx';

function BookmarkBlock({ block, readOnly }: BlockProps) {
  const url = toPlainText((block.properties as any)?.link as RichText | undefined) || sourceOf(block);
  const loading = useUploads((s) => !!s.uploading[block.id]);
  if (!url) {
    return (
      <div className="nc-bpad">
        <BlockPlaceholder block={block} readOnly={readOnly} icon="bookmark" label="Add a bookmark" onOpen={(el) => openMediaPicker(block, el)} />
      </div>
    );
  }
  const title = toPlainText(block.properties?.title as RichText | undefined);
  const desc = toPlainText((block.properties as any)?.description as RichText | undefined);
  const icon = block.format?.bookmark_icon as string | undefined;
  const cover = block.format?.bookmark_cover as string | undefined;
  return (
    <div className="nc-bpad">
      <div className="nc-blk-hoverable" style={{ position: 'relative' }}>
        <a className={`nc-bookmark ${loading ? 'loading' : ''}`} href={url} target="_blank" rel="noreferrer noopener" role="link" draggable={false}>
          <div className="nc-bookmark-text">
            <div className="nc-bookmark-title">{title || (loading ? 'Fetching preview…' : url)}</div>
            {desc && <div className="nc-bookmark-desc">{desc}</div>}
            <div className="nc-bookmark-url">
              {icon ? <img src={icon} alt="" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} /> : null}
              <span>{url}</span>
            </div>
          </div>
          {cover && (
            <div className="nc-bookmark-cover">
              <img src={cover} alt="" onError={(e) => { (e.currentTarget.parentElement as HTMLElement).style.display = 'none'; }} />
            </div>
          )}
        </a>
        {!readOnly && (
          <ActionBar>
            <ActionButton icon="caption" tooltip="Caption" onClick={() => showCaption(block.id)} />
            <ActionButton icon="ellipsis" tooltip="More actions" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
          </ActionBar>
        )}
      </div>
      <Caption block={block} readOnly={readOnly} />
    </div>
  );
}

registerBlock(['bookmark'], BookmarkBlock);

// Bookmark menu (help center): Copy source link, Color, plus Caption / Reload / Replace.
registerBlockMenu(['bookmark'], ({ block, color }) => {
  const url = toPlainText((block.properties as any)?.link as RichText | undefined) || sourceOf(block);
  return [
    { label: 'Caption', icon: 'caption', shortcut: '⌘⌥M', onSelect: () => showCaption(block.id) },
    ...(url ? [
      { label: 'Copy source link', icon: 'link', onSelect: () => void copyText(url, 'Link copied') },
      { label: 'Reload', icon: 'refresh', onSelect: () => void refreshBookmark(block.id, url) },
      { label: 'Replace', icon: 'replace', onSelect: () => replaceMedia(block) },
    ] : []),
    color,
  ];
});

export { Icon };

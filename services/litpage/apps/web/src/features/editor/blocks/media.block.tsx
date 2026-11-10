// Media blocks: image, video, audio, file, and PDF. Empty state is a gray placeholder row:
// "Add an image file" (photo), "Add or embed a video" (playButton), "Add an audio track" (waveform),
// "Add or embed a file" (arrowPageUp), "Embed a PDF" (filePdf), 704×49 r10 rgba(124, 45, 18, 0.03), text texSec;
// click opens the Upload/Link popover (media/MediaPicker.tsx). Filled: properties.source (+format.display_source),
// properties.size, format.block_width / block_alignment / block_aspect_ratio / alt_text.
// Image hover bar: Alignment, Caption, Comment, Download, Expand, •••; block menu adds Replace, Alt text,
// View original, Full screen (help center.x).
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { safeHref } from '@nc/shared/url.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import type { MenuItemDef } from '../../../components/Menu.tsx';
import { getBlock, run, setFormat } from '../../../lib/blocks.ts';
import { openBlockMenu } from '../BlockMenu.tsx';
import { startCommentOnBlock } from '../../comments/comments.tsx';
import { registerBlockMenu } from './registry.ts';
import { ActionButton, BlockPlaceholder, blockElement, downloadUrl, fileNameOf, fileSizeLabel, openLightbox, originalSourceOf, showCaption, sourceOf, Caption } from './shared.tsx';
import { MediaFrame, AlignButton } from './media/MediaFrame.tsx';
import { openMediaPicker, useUploads } from './media/MediaPicker.tsx';
import { isVideoFile, videoEmbedUrl } from './media/embedProviders.ts';
import { openImageEditor, openImageLinkPopover } from './media/ImageTools.tsx';
import { followLink } from '../inline/LinkPopups.tsx';
import { AiImageEditButton } from '../../aiImage/EditWithAi.tsx';

const PLACEHOLDER: Record<string, [string, string]> = {
  image: ['Add an image file', 'photo'],
  video: ['Add or embed a video', 'squarePlay'],
  audio: ['Add an audio track', 'waveform'],
  file: ['Add or embed a file', 'arrowPageUp'],
  pdf: ['Embed a PDF', 'filePdfLabel'],
};

export function MediaPlaceholder({ block, readOnly }: { block: BlockRecord; readOnly: boolean }) {
  const uploading = useUploads((s) => s.uploading[block.id]);
  const [label, icon] = PLACEHOLDER[block.type] ?? ['Add content', 'plus'];
  return (
    <div className="nc-bpad">
      <BlockPlaceholder
        block={block}
        readOnly={readOnly || !!uploading}
        icon={uploading ? <div className="nc-spinner" /> : icon}
        label={uploading ? `Uploading ${uploading.name}…` : label}
        className={uploading ? 'uploading' : ''}
        onOpen={(el) => openMediaPicker(block, el)}
      />
    </div>
  );
}

function isLocalFile(src: string) {
  return src.startsWith('/files/') || src.startsWith(location.origin + '/files/');
}

export function downloadBlockFile(b: BlockRecord) {
  const src = originalSourceOf(b);
  if (!src) return;
  if (isLocalFile(src) || src.startsWith('data:')) downloadUrl(src, fileNameOf(b));
  else openExternal(src);
}

/** Media sources are user data: only http(s)/relative URLs are opened (no javascript: windows). */
function openExternal(src: string | undefined | null) {
  const url = safeHref(src);
  if (url) window.open(url, '_blank', 'noopener');
}

export function viewOriginal(b: BlockRecord) {
  openExternal(originalSourceOf(b));
}

export function replaceMedia(b: BlockRecord) {
  const el = blockElement(b.id)?.querySelector('.nc-media-frame, .nc-file-row, .nc-bookmark, .nc-html-frame, .nc-pdf-frame, .nc-blk-placeholder') as HTMLElement | null;
  if (el) setTimeout(() => openMediaPicker(b, el, { replace: true }), 0);
}

function editAltText(b: BlockRecord) {
  const el = blockElement(b.id)?.querySelector('.nc-media-frame') as HTMLElement | null;
  openOverlay((close) => <AltTextEditor blockId={b.id} close={close} />, { anchor: el ?? undefined, placement: 'bottom', offset: 6 });
}

function AltTextEditor({ blockId, close }: { blockId: string; close: () => void }) {
  const [v, setV] = useState((getBlock(blockId)?.format?.alt_text as string | undefined) ?? '');
  const save = () => {
    run('setAltText', (tx) => setFormat(tx, blockId, { alt_text: v || undefined }));
    close();
  };
  return (
    <PopoverSurface width={320}>
      <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 12, color: 'var(--lp-text-secondary)', fontWeight: 500 }}>Alt text</div>
        <div className="nc-input"><input autoFocus placeholder="Describe this image…" value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} /></div>
        <button className="nc-blk-btn primary" onClick={save}>Save</button>
      </div>
    </PopoverSurface>
  );
}

/* ------------------------------------------------------------------ full screen viewer */

/** Image blocks of the page in document order, which the viewer pages through. */
function pageImages(blockId: string): string[] {
  const root = blockElement(blockId)?.closest('.lit-page-content') ?? document.querySelector('.lit-page-content');
  if (!root) return [blockId];
  const ids = Array.from(root.querySelectorAll<HTMLElement>('.lit-image-block[data-block-id]')).map((el) => el.dataset.blockId!).filter((id) => !!sourceOf(getBlock(id)!));
  return ids.includes(blockId) ? ids : [blockId];
}

let viewerClose: (() => void) | null = null;

/** Full screen (Expand / double-click / ••• › Full screen / Space / ⌘Enter): images open a viewer that pages through the * page's images (← / →, Esc closes, Download / View original); embeds, PDFs and videos fill the screen. */
export function openFullScreen(blockId: string) {
  if (viewerClose) {
    viewerClose();
    return;
  }
  const b = getBlock(blockId);
  if (!b) return;
  if (b.type !== 'image') {
    const src = sourceOf(b);
    if (!src) return;
    const fileLike = b.type === 'video' && (isLocalFile(src) || isVideoFile(src));
    const close = openLightbox(() => fileLike
      ? <video className="nc-lightbox-media" src={src} controls autoPlay />
      : <iframe className="nc-lightbox-media nc-lightbox-frame" src={b.type === 'video' ? (videoEmbedUrl(src) ?? src) : src} title="Full screen" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation" allowFullScreen />);
    viewerClose = () => { close(); viewerClose = null; };
    return;
  }
  const close = openOverlay((c) => <ImageViewer startId={blockId} close={c} />, {
    backdrop: 'dim', placement: 'center', className: 'nc-lightbox-overlay', onClose: () => { viewerClose = null; },
  });
  viewerClose = close;
}

function ImageViewer({ startId, close }: { startId: string; close: () => void }) {
  const ids = pageImages(startId);
  const [i, setI] = useState(Math.max(0, ids.indexOf(startId)));
  const [zoom, setZoom] = useState(false);
  const b = getBlock(ids[i]);
  const src = b ? sourceOf(b) : null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && i < ids.length - 1) { e.preventDefault(); setI(i + 1); setZoom(false); }
      else if (e.key === 'ArrowLeft' && i > 0) { e.preventDefault(); setI(i - 1); setZoom(false); }
      else if (e.key === ' ') { e.preventDefault(); close(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [i, ids.length, close]);
  if (!b || !src) return null;
  const alt = (b.format?.alt_text as string | undefined) ?? '';
  return (
    <div className="nc-lightbox nc-image-viewer" role="dialog" aria-label="Image viewer" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="nc-image-viewer-bar">
        {ids.length > 1 && <span className="nc-image-viewer-count">{i + 1} / {ids.length}</span>}
        <div className="nc-lightbox-btn" role="button" aria-label="Download" data-tooltip="Download" onClick={() => downloadBlockFile(b)}><Icon name="download" size={18} /></div>
        <div className="nc-lightbox-btn" role="button" aria-label="View original" data-tooltip="View original" onClick={() => viewOriginal(b)}><Icon name="openOriginal" size={18} /></div>
        <div className="nc-lightbox-btn" role="button" aria-label="Close" data-tooltip="Close" onClick={close}><Icon name="close" size={18} /></div>
      </div>
      {i > 0 && <div className="nc-image-viewer-nav prev" role="button" aria-label="Previous image" onClick={() => { setI(i - 1); setZoom(false); }}><Icon name="chevronLeft" size={22} /></div>}
      <div className={`nc-lightbox-body ${zoom ? 'zoomed' : ''}`} onClick={() => setZoom(!zoom)}>
        <img src={src} alt={alt} draggable={false} />
      </div>
      {i < ids.length - 1 && <div className="nc-image-viewer-nav next" role="button" aria-label="Next image" onClick={() => { setI(i + 1); setZoom(false); }}><Icon name="chevronRight" size={22} /></div>}
    </div>
  );
}

/* ------------------------------------------------------------------ image */

function ImageBlock({ block, readOnly }: BlockProps) {
  const src = sourceOf(block);
  const [failed, setFailed] = useState(false);
  if (!src) return <MediaPlaceholder block={block} readOnly={readOnly} />;
  const aspect = block.format?.block_aspect_ratio as number | undefined;
  const alt = (block.format?.alt_text as string | undefined) ?? '';
  const link = block.format?.image_hyperlink as string | undefined;
  const expand = () => openFullScreen(block.id);
  return (
    <MediaFrame
      block={block}
      readOnly={readOnly}
      aspect={aspect}
      bar={(
        <>
          <AiImageEditButton block={block} readOnly={readOnly} />
          <AlignButton block={block} />
          <ActionButton icon="caption" tooltip="Caption" label="Add a caption" onClick={() => showCaption(block.id)} />
          <ActionButton icon="commentFilled" tooltip="Comment" onClick={() => startCommentOnBlock(block.id)} />
          <ActionButton icon="crop" tooltip="Crop" label="Crop image" onClick={() => openImageEditor(block.id)} />
          <ActionButton icon="download" tooltip="Download" label="Download file" onClick={() => downloadBlockFile(block)} />
          <ActionButton icon="expand2" tooltip="Expand" label="Open full-screen block" onClick={expand} />
          <ActionButton icon="ellipsis" tooltip="More actions" label="Open block options" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
        </>
      )}
    >
      {(live) => failed ? (
        <div className="nc-media-error-box"><Icon name="photo" size={18} />The image could not be loaded.</div>
      ) : (
        <div className="nc-image-wrap" style={live?.h && aspect ? { height: live.h } : undefined} onDoubleClick={link ? undefined : expand}>
          <img
            className={`nc-image ${link ? 'linked' : ''}`}
            src={src}
            alt={alt}
            draggable={false}
            onError={() => setFailed(true)}
            style={aspect ? { aspectRatio: `${1} / ${aspect}` } : undefined}
            // "Add image link": a click opens the page / URL (in-app pages navigate; ⌘-click = new tab)
            onClick={link ? (e) => { e.preventDefault(); followLink(link, e.metaKey || e.ctrlKey); } : undefined}
            data-image-link={link || undefined}
          />
          {alt && (
            <div className="nc-image-alt-badge" role="button" aria-label={`Alt text: ${alt}`} data-tooltip={alt} onClick={(e) => { e.stopPropagation(); if (!readOnly) editAltText(block); }}>ALT</div>
          )}
        </div>
      )}
    </MediaFrame>
  );
}

/* ------------------------------------------------------------------ video */

function VideoBlock({ block, readOnly }: BlockProps) {
  const src = sourceOf(block);
  if (!src) return <MediaPlaceholder block={block} readOnly={readOnly} />;
  const original = originalSourceOf(block) ?? src;
  const fileLike = isLocalFile(src) || isVideoFile(src) || src.startsWith('blob:');
  const embed = fileLike ? null : videoEmbedUrl(src) ?? src;
  return (
    <MediaFrame
      block={block}
      readOnly={readOnly}
      aspect={9 / 16}
      bar={(
        <>
          <AlignButton block={block} />
          <ActionButton icon="caption" tooltip="Caption" onClick={() => showCaption(block.id)} />
          <ActionButton icon="commentFilled" tooltip="Comment" onClick={() => startCommentOnBlock(block.id)} />
          {fileLike ? <ActionButton icon="download" tooltip="Download" onClick={() => downloadBlockFile(block)} /> : <ActionButton icon="openOriginal" tooltip="View original" label="View source media" onClick={() => openExternal(original)} />}
          <ActionButton icon="ellipsis" tooltip="More actions" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
        </>
      )}
    >
      {() => fileLike ? (
        <video className="nc-video-el" src={src} controls preload="metadata" />
      ) : (
        <div className="nc-embed-frame" style={{ aspectRatio: '16 / 9' }}>
          <iframe src={embed!} title="Video" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen sandbox="allow-scripts allow-popups allow-top-navigation-by-user-activation allow-forms allow-same-origin allow-presentation" />
        </div>
      )}
    </MediaFrame>
  );
}

/* ------------------------------------------------------------------ audio */

function AudioBlock({ block, readOnly }: BlockProps) {
  const src = sourceOf(block);
  if (!src) return <MediaPlaceholder block={block} readOnly={readOnly} />;
  const external = !isLocalFile(src) && /spotify|soundcloud/.test(src);
  return (
    <div className="nc-bpad">
      <div className="nc-blk-hoverable" style={{ position: 'relative' }}>
        {external ? (
          <div className="nc-embed-frame" style={{ height: 152 }}><iframe src={src} title="Audio" allow="autoplay; encrypted-media" sandbox="allow-scripts allow-same-origin allow-popups" /></div>
        ) : (
          <audio className="nc-audio" src={src} controls preload="metadata" />
        )}
      </div>
      <Caption block={block} readOnly={readOnly} />
    </div>
  );
}

/* ------------------------------------------------------------------ file */

function FileBlock({ block, readOnly }: BlockProps) {
  const src = sourceOf(block);
  if (!src) return <MediaPlaceholder block={block} readOnly={readOnly} />;
  const name = fileNameOf(block);
  const size = toPlainText(block.properties?.size as RichText | undefined) || (block.format?.file_size ? fileSizeLabel(block.format.file_size as number) : '');
  return (
    <div className="nc-bpad6">
      <a
        className="nc-file-row"
        href={src}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => {
          e.preventDefault();
          if ((e.target as HTMLElement).closest('.nc-file-actions')) return;
          downloadBlockFile(block);
        }}
      >
        <span className="nc-file-icon"><Icon name="paperClip" size={18} /></span>
        <span className="nc-file-name">{name}</span>
        {size && <span className="nc-file-size">{size}</span>}
        {!readOnly && (
          <span className="nc-file-actions">
            <ActionButton icon="download" tooltip="Download" onClick={() => downloadBlockFile(block)} />
            <ActionButton icon="ellipsis" tooltip="More actions" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
          </span>
        )}
      </a>
      <Caption block={block} readOnly={readOnly} />
    </div>
  );
}

/* ------------------------------------------------------------------ pdf */

function PdfBlock({ block, readOnly }: BlockProps) {
  const src = sourceOf(block);
  if (!src) return <MediaPlaceholder block={block} readOnly={readOnly} />;
  const h = (block.format?.block_height as number | undefined) ?? 640;
  return (
    <MediaFrame
      block={block}
      readOnly={readOnly}
      heightResizable
      bar={(
        <>
          <AlignButton block={block} />
          <ActionButton icon="caption" tooltip="Caption" onClick={() => showCaption(block.id)} />
          <ActionButton icon="download" tooltip="Download" onClick={() => downloadBlockFile(block)} />
          <ActionButton icon="openOriginal" tooltip="View original" onClick={() => viewOriginal(block)} />
          <ActionButton icon="ellipsis" tooltip="More actions" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())} />
        </>
      )}
    >
      {(live) => (
        <div className="nc-pdf-frame" style={{ height: live?.h ?? h }}>
          <iframe src={src} title={fileNameOf(block)} />
        </div>
      )}
    </MediaFrame>
  );
}

registerBlock(['image'], ImageBlock);
registerBlock(['video'], VideoBlock);
registerBlock(['audio'], AudioBlock);
registerBlock(['file'], FileBlock);
registerBlock(['pdf'], PdfBlock);

/* ------------------------------------------------------------------ block menus */

function mediaItems(block: BlockRecord, extra: MenuItemDef[] = []): MenuItemDef[] {
  const has = !!sourceOf(block);
  return [
    ...(has ? [{ label: 'Replace', icon: 'replace', onSelect: () => replaceMedia(block) }] : []),
    { label: 'Caption', icon: 'caption', shortcut: '⌘⌥M', onSelect: () => showCaption(block.id) },
    ...extra,
    ...(has ? [
      { label: 'Download', icon: 'download', onSelect: () => downloadBlockFile(block) },
      { label: 'View original', icon: 'openOriginal', onSelect: () => viewOriginal(block) },
    ] : []),
  ];
}

registerBlockMenu(['image'], ({ block }) => mediaItems(block, [
  ...(sourceOf(block) ? [
    { label: 'Crop image', icon: 'crop', onSelect: () => setTimeout(() => openImageEditor(block.id), 0) },
    {
      label: block.format?.image_hyperlink ? 'Change image link' : 'Add image link', icon: 'link',
      onSelect: () => setTimeout(() => { const el = blockElement(block.id)?.querySelector('.nc-media-frame') as HTMLElement | null; openImageLinkPopover(block.id, el ?? new DOMRect(window.innerWidth / 2, 200, 0, 0)); }, 0),
    },
  ] : []),
  { label: 'Alt text', icon: 'alt', onSelect: () => setTimeout(() => editAltText(block), 0) },
  {
    label: 'Align', icon: 'alignmentCenter',
    submenu: () => ({ width: 180, sections: [{ items: (['left', 'center', 'right'] as const).map((a) => ({ label: a[0].toUpperCase() + a.slice(1), icon: `alignment${a[0].toUpperCase()}${a.slice(1)}`, checked: (block.format?.block_alignment ?? 'center') === a, onSelect: () => run('setBlockAlignment', (tx) => setFormat(tx, block.id, { block_alignment: a })) })) }] }),
  },
  { label: 'Full screen', icon: 'expand2', shortcut: '⌘↵', onSelect: () => { if (sourceOf(block)) setTimeout(() => openFullScreen(block.id), 0); } },
]));
registerBlockMenu(['video', 'audio', 'pdf'], ({ block }) => mediaItems(block));
registerBlockMenu(['file'], ({ block, color }) => [...mediaItems(block), color]);

// "Embed" popover opened empty media blocks (Upload | Link | Unsplash | GIPHY …), 
//,video,audio,file,pdf}-popover-overlay.html: dialog r10 --lp-shadow-outset-large; tab strip with 8px
// inline padding, 28px tabs (14px, texPri active + 2px underline / graTexAccPri idle); image 540px wide, other
// media 300px; image Upload = outline "Upload file" 32px; other Upload = blue "Choose a file" 28px.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import type { BlockRecord } from '@nc/shared/records.ts';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { api, uploadFile } from '../../../../lib/api.ts';
import { getBlock, run, setFormat, setProperty, touch } from '../../../../lib/blocks.ts';
import { useSession } from '../../../../lib/store/session.ts';
import { fileSizeLabel, isValidUrl, normalizeUrl, containerWidthOf, toast } from '../shared.tsx';
import { isAudioFile, isImageFile, isPdfFile, isVideoFile, providerByName, providerForType, providerForUrl, resolveEmbed, videoEmbedUrl } from './embedProviders.ts';
import { AiImageTab, aiImageTabs } from '../../../aiImage/AiImageTab.tsx';

type Tab = 'upload' | 'link' | 'unsplash' | 'giphy' | 'embed' | 'add' | 'ai';

/* ------------------------------------------------------------ upload progress */

interface UploadState {
  uploading: Record<string, { name: string; progress: number }>;
  set: (blockId: string, v: { name: string; progress: number } | null) => void;
}

export const useUploads = create<UploadState>((set, get) => ({
  uploading: {},
  set: (blockId, v) => {
    const next = { ...get().uploading };
    if (v) next[blockId] = v;
    else delete next[blockId];
    set({ uploading: next });
  },
}));

/* ------------------------------------------------------------ commits */

function imageSize(url: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    const t = setTimeout(() => resolve(null), 4000);
    img.onload = () => {
      clearTimeout(t);
      resolve(img.naturalWidth ? { w: img.naturalWidth, h: img.naturalHeight } : null);
    };
    img.onerror = () => {
      clearTimeout(t);
      resolve(null);
    };
    img.src = url;
  });
}

/** Point a media block at `url` using properties.source and format.display_source. */
export async function setMediaSource(blockId: string, url: string, file?: { name: string; size: number; id?: string; mime?: string }) {
  const b = getBlock(blockId);
  if (!b) return;
  let type = b.type as string;
  // a file dropped into the generic embed/file picker becomes the matching media block
  if (file && (type === 'embed' || type === 'file')) {
    if (file.mime?.startsWith('image/') || isImageFile(file.name)) type = 'image';
    else if (file.mime?.startsWith('video/') || isVideoFile(file.name)) type = 'video';
    else if (file.mime?.startsWith('audio/') || isAudioFile(file.name)) type = 'audio';
    else if (file.mime === 'application/pdf' || isPdfFile(file.name)) type = type === 'embed' ? 'pdf' : 'file';
    else type = 'file';
  }
  const fmt: Record<string, unknown> = { display_source: url };
  if (type === 'image') {
    const size = await imageSize(url);
    if (size) {
      fmt.block_aspect_ratio = size.h / size.w;
      const cw = containerWidthOf(blockId);
      if (size.w < cw) fmt.block_width = size.w;
      fmt.block_preserve_scale = true;
    }
  }
  if (type === 'video' || type === 'loom') {
    const embed = videoEmbedUrl(url);
    if (embed) fmt.display_source = embed;
  }
  if (type === 'pdf') fmt.block_height = fmt.block_height ?? undefined;
  run('setMediaSource', (tx) => {
    if (type !== b.type) tx.update('block', blockId, [], { type });
    setProperty(tx, blockId, 'source', [[url]]);
    if (file) {
      setProperty(tx, blockId, 'size', [[fileSizeLabel(file.size)]]);
      if (type === 'file' || type === 'pdf' || type === 'audio' || type === 'video') setProperty(tx, blockId, 'title', [[file.name]]);
      if (file.id) tx.update('block', blockId, [], { file_ids: [file.id] });
    }
    setFormat(tx, blockId, fmt as any);
    touch(tx, blockId);
  });
}

/** Generic/provider embed: properties.source + format.display_source (iframe src) + block_height (default 320). */
export async function setEmbedSource(blockId: string, raw: string) {
  const b = getBlock(blockId);
  if (!b) return;
  const url = normalizeUrl(raw);
  const providerName = b.format?.embed_provider as string | undefined;
  let type = b.type as string;
  // a known provider link pasted into a plain embed becomes that provider's block (or a video block)
  if (type === 'embed' && !providerName && !b.format?.embed_variant) {
    if (videoEmbedUrl(url)) type = /loom\.com/.test(url) ? 'loom' : 'video';
    else if (isPdfFile(url)) type = 'pdf';
    else if (isImageFile(url)) type = 'image';
    else {
      const p = providerForUrl(url);
      if (p && p.type !== 'embed' && p.type !== 'pdf') type = p.type;
    }
  }
  if (type === 'video' || type === 'image' || type === 'pdf') {
    if (type !== b.type) run('embedBlockActions.initializeEmbedBlock', (tx) => tx.update('block', blockId, [], { type }));
    return setMediaSource(blockId, url);
  }
  const resolved = resolveEmbed(url, type, providerName);
  run('embedBlockActions.initializeEmbedBlock', (tx) => {
    setProperty(tx, blockId, 'source', [[url]]);
    setFormat(tx, blockId, { block_height: b.format?.block_height ?? resolved.height, display_source: resolved.src && resolved.src !== url ? resolved.src : undefined } as any);
    if (type !== b.type) tx.update('block', blockId, [], { type });
  });
  // generic links: ask the server for an oEmbed iframe
  if (!resolved.provider && !resolved.srcdoc) {
    try {
      const res = await api<{ empty?: boolean; type?: string; format?: Record<string, unknown>; properties?: Record<string, unknown> }>('resolveEmbedLink', {
        source: url, pageWidth: containerWidthOf(blockId) - 12, type: 'embed',
      });
      if (res && !res.empty && res.format?.display_source) {
        run('embedBlockActions.updateEmbedBlock', (tx) => {
          setFormat(tx, blockId, res.format as any);
          if (res.type && res.type !== getBlock(blockId)?.type) tx.update('block', blockId, [], { type: res.type });
        }, { skipHistory: true });
      }
    } catch {
      /* offline: keep the plain iframe */
    }
  }
}

/** Bookmark: properties.link, then the server fills title/description/icon/cover (saveBookmarkPreview). */
export async function setBookmarkLink(blockId: string, raw: string) {
  const url = normalizeUrl(raw);
  run('bookmarkBlockActions.createBookmark', (tx) => {
    setProperty(tx, blockId, 'link', [[url]]);
  });
  await refreshBookmark(blockId, url);
}

export async function refreshBookmark(blockId: string, url: string) {
  const b = getBlock(blockId);
  if (!b) return;
  useUploads.getState().set(blockId, { name: url, progress: 0 });
  try {
    const res = await api<{ recordMap?: any }>('saveBookmarkPreview', { type: 'external-bookmark', block: { id: blockId, spaceId: b.space_id }, url });
    if (res?.recordMap) {
      const { records } = await import('../../../../lib/store/records.ts');
      records.mergeRecordMap(res.recordMap);
    }
  } catch {
    /* metadata is best-effort; the card falls back to the URL */
  } finally {
    useUploads.getState().set(blockId, null);
  }
}

export async function uploadInto(block: BlockRecord, file: File) {
  const spaceId = useSession.getState().spaceId ?? undefined;
  const limit = 50 * 1024 * 1024;
  if (file.size > limit) {
    toast('The maximum size per file is 50 MB.');
    return;
  }
  if (block.type === 'image' && !file.type.startsWith('image/') && !isImageFile(file.name)) {
    toast('This file type isn’t supported.');
    return;
  }
  useUploads.getState().set(block.id, { name: file.name, progress: 0 });
  try {
    const res = await uploadFile(file, file.name, spaceId, block.id);
    await setMediaSource(block.id, res.url, { name: res.name, size: res.size, id: res.id, mime: res.mime });
  } catch (e) {
    toast((e as Error).message || 'Upload failed');
  } finally {
    useUploads.getState().set(block.id, null);
  }
}

/* ------------------------------------------------------------ picker config */

interface PickerConfig {
  width: number;
  tabs: Tab[];
  accept?: string;
  uploadLabel: string;
  uploadStyle: 'outline' | 'primary';
  linkPlaceholder: string;
  linkButton: string;
  linkCaption?: string;
}

function configFor(b: BlockRecord): PickerConfig {
  // generic `embed` blocks only have a provider when created a preset (format.embed_provider)
  const provider = providerByName(b.format?.embed_provider as string | undefined) ?? (b.type !== 'embed' ? providerForType(b.type) : undefined);
  switch (b.type) {
    case 'image':
      return { width: 540, tabs: ['upload', 'link', 'unsplash', 'giphy', ...aiImageTabs(b)], accept: 'image/*', uploadLabel: 'Upload file', uploadStyle: 'outline', linkPlaceholder: 'Paste an image URL…', linkButton: 'Embed image', linkCaption: 'Accepts image URLs from the web' };
    case 'video':
      return { width: 300, tabs: ['upload', 'link'], accept: 'video/*', uploadLabel: 'Choose a video', uploadStyle: 'primary', linkPlaceholder: 'Paste a video URL…', linkButton: 'Embed video', linkCaption: 'Supports YouTube, Vimeo, and other sites' };
    case 'audio':
      return { width: 300, tabs: ['upload', 'link'], accept: 'audio/*', uploadLabel: 'Choose a file', uploadStyle: 'primary', linkPlaceholder: 'Paste the audio link…', linkButton: 'Embed audio', linkCaption: 'Supports MP3, WAV, and OGG audio' };
    case 'file':
      return { width: 300, tabs: ['upload', 'link'], uploadLabel: 'Choose a file', uploadStyle: 'primary', linkPlaceholder: 'Paste a file URL…', linkButton: 'Embed link', linkCaption: 'Supports PDF, Drive, Maps, CodePen, and more' };
    case 'pdf':
      return { width: 300, tabs: ['upload', 'link'], accept: 'application/pdf', uploadLabel: 'Choose a file', uploadStyle: 'primary', linkPlaceholder: 'Paste a URL…', linkButton: 'Embed PDF', linkCaption: 'Add a PDF embed' };
    case 'bookmark':
      return { width: 300, tabs: [], uploadLabel: '', uploadStyle: 'primary', linkPlaceholder: 'Paste a URL…', linkButton: 'Create bookmark', linkCaption: 'Make a visual link card.' };
    case 'embed':
      if (provider && provider.type === 'embed') return { width: 300, tabs: [], uploadLabel: '', uploadStyle: 'primary', linkPlaceholder: 'Paste a URL…', linkButton: 'Embed link', linkCaption: `Works with ${provider.name} links` };
      return { width: 300, tabs: ['link', 'upload'], uploadLabel: 'Choose a file', uploadStyle: 'primary', linkPlaceholder: 'Paste a URL…', linkButton: 'Embed link', linkCaption: 'Supports PDF, Drive, Maps, CodePen, and more' };
    default:
      return { width: 300, tabs: [], uploadLabel: '', uploadStyle: 'primary', linkPlaceholder: 'Paste a URL…', linkButton: 'Embed link', linkCaption: provider ? `Works with ${provider.name} links` : 'Supports PDF, Drive, Maps, CodePen, and more' };
  }
}

export function openMediaPicker(block: BlockRecord, anchor: HTMLElement, opts?: { replace?: boolean }) {
  //: the popover sits directly under the placeholder row (top = row bottom), horizontally centered
  return openOverlay((close) => <MediaPicker blockId={block.id} close={close} replace={opts?.replace} />, { anchor, placement: 'bottom', offset: 0 });
}

const TAB_LABEL: Record<Tab, string> = { upload: 'Upload', link: 'Link', unsplash: 'Unsplash', giphy: 'GIPHY', embed: 'Embed link', add: 'Add', ai: 'Litpage AI' };

export function PickerTabs({ tabs, tab, setTab, right }: { tabs: Tab[]; tab: Tab; setTab: (t: Tab) => void; right?: ReactNode }) {
  return (
    <div className="nc-media-tabs hide-scrollbar" role="tablist">
      {tabs.map((t) => (
        <div key={t} className={`nc-media-tab-wrap ${t === tab ? 'active' : ''}`}>
          <div role="tab" aria-selected={t === tab} className="nc-media-tab" onMouseDown={(e) => e.preventDefault()} onClick={() => setTab(t)}>
            {t === 'unsplash' && <Icon name="unsplash" size={12} style={{ marginInlineEnd: 4 }} />}
            {t === 'giphy' && <Icon name="giphy" size={12} style={{ marginInlineEnd: 4 }} />}
            {TAB_LABEL[t]}
          </div>
          {t === tab && <div className="nc-media-tab-underline" />}
        </div>
      ))}
      <div style={{ flex: 1 }} />
      {right}
    </div>
  );
}

function MediaPicker({ blockId, close, replace }: { blockId: string; close: () => void; replace?: boolean }) {
  const block = getBlock(blockId)!;
  const cfg = useMemo(() => configFor(block), [block]);
  const [tab, setTab] = useState<Tab>(cfg.tabs[0] ?? 'link');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const submitLink = () => {
    const v = url.trim();
    if (!v || !isValidUrl(v)) {
      setError(block.type === 'bookmark' ? 'Enter a valid URL' : 'Enter a valid URL.');
      return;
    }
    close();
    const n = normalizeUrl(v);
    if (block.type === 'bookmark') void setBookmarkLink(blockId, n);
    else if (['image', 'video', 'audio', 'file', 'pdf'].includes(block.type)) void setMediaSource(blockId, n);
    else void setEmbedSource(blockId, n);
  };

  const onFiles = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    close();
    void uploadInto(block, f);
  };

  return (
    <PopoverSurface width={cfg.width} maxHeight={cfg.width > 300 ? 420 : '70vh'} className="lit-media-menu nc-media-picker">
      {cfg.tabs.length > 0 && <PickerTabs tabs={cfg.tabs} tab={tab} setTab={(t) => { setTab(t); setError(''); }} right={replace ? undefined : undefined} />}
      <div className={`nc-media-picker-body ${cfg.tabs.length ? 'has-tabs' : ''}`}>
        {tab === 'upload' && (
          <div className={cfg.uploadStyle === 'outline' ? 'nc-media-upload-outline' : 'nc-media-upload-primary'}>
            <button className={`nc-blk-btn ${cfg.uploadStyle === 'outline' ? 'outline big' : 'primary'}`} onClick={() => fileRef.current?.click()}>
              {cfg.uploadLabel}
            </button>
            <input ref={fileRef} type="file" accept={cfg.accept} hidden onChange={(e) => onFiles(e.target.files)} />
          </div>
        )}
        {tab === 'link' && (
          <div className="nc-media-link">
            <div className={`nc-input ${error ? 'error' : ''}`}>
              <input
                autoFocus
                placeholder={cfg.linkPlaceholder}
                value={url}
                onChange={(e) => { setUrl(e.target.value); setError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submitLink();
                  }
                }}
              />
            </div>
            <button className={`nc-blk-btn primary ${block.type === 'bookmark' ? 'wide' : 'link'}`} onClick={submitLink}>{cfg.linkButton}</button>
            {error ? <div className="nc-media-error">{error}</div> : cfg.linkCaption && <div className="nc-media-caption">{cfg.linkCaption}</div>}
          </div>
        )}
        {(tab === 'unsplash' || tab === 'giphy') && <StockTab kind={tab} onPick={(u) => { close(); void setMediaSource(blockId, u); }} />}
        {tab === 'ai' && <AiImageTab blockId={blockId} close={close} />}
      </div>
    </PopoverSurface>
  );
}

/** Unsplash / GIPHY tabs: search box + grid. Without network access to those services the grid offers a * small set of generated gradient images (data URLs) so the flow can be exercised offline. */
function StockTab({ kind, onPick }: { kind: 'unsplash' | 'giphy'; onPick: (url: string) => void }) {
  const [q, setQ] = useState('');
  const items = useMemo(() => stockImages(q || kind), [q, kind]);
  useEffect(() => undefined, []);
  return (
    <div className="nc-stock">
      <div className="nc-input">
        <input autoFocus placeholder={kind === 'unsplash' ? 'Find an image…' : 'Search GIPHY…'} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="nc-stock-grid">
        {items.map((it) => (
          <div key={it.url} role="button" className="nc-stock-item" onClick={() => onPick(it.url)} title={it.label}>
            <img src={it.url} alt={it.label} />
            <div className="nc-stock-by">by {it.author}</div>
          </div>
        ))}
      </div>
      <div className="nc-media-caption">{kind === 'unsplash' ? 'Unsplash search is offline in this build; generated images are shown.' : 'GIPHY search is offline in this build; generated images are shown.'}</div>
    </div>
  );
}

const AUTHORS = ['Haseeb Jamil', 'Ginta Wang', 'Hanseul Kim', 'Ian Macharia', 'Mayur Deshpande', 'Gijs Tissink', 'Seongho Jang', 'Martijn Baudoin'];

function stockImages(seed: string): { url: string; label: string; author: string }[] {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return Array.from({ length: 8 }, (_, i) => {
    const a = (h + i * 47) % 360;
    const b = (a + 40 + i * 13) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a},70%,62%)"/><stop offset="1" stop-color="hsl(${b},65%,42%)"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="${300 + i * 90}" cy="${260 + (i % 3) * 90}" r="${120 + i * 10}" fill="rgba(255,255,255,.18)"/></svg>`;
    return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, label: `${seed} ${i + 1}`, author: AUTHORS[(h + i) % AUTHORS.length] };
  });
}

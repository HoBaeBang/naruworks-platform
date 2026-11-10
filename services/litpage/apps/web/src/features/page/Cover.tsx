// Page cover: full-width 30vh (max 280px) image, hover action bar (Change, Reposition), drag to
// reposition (format.page_cover_position 0..1), and the cover picker: Gallery / Upload / Link / Unsplash
// (+ Remove). Gallery images are our own procedural SVGs (apps/web/public/covers). Unsplash needs
// VITE_UNSPLASH_ACCESS_KEY, otherwise the tab explains that.
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { safeHref } from '@nc/shared/url.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { run, setFormat } from '../../lib/blocks.ts';
import { uploadFile } from '../../lib/api.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { AiImageTab, aiImageTabs } from '../aiImage/AiImageTab.tsx';
import { generateCover } from '../aiImage/api.ts';
import './pickers.css';

const c = (name: string) => `/covers/${name}.svg`;

export const GALLERY: { title: string; items: { url: string; title: string }[] }[] = [
  {
    title: t('lp.page.color_gradient', 'Color & Gradient'),
    items: [
      { url: c('solid-red'), title: 'Red' }, { url: c('solid-yellow'), title: 'Yellow' }, { url: c('solid-blue'), title: 'Blue' }, { url: c('solid-beige'), title: 'Beige' },
      { url: c('gradient-8'), title: 'Gradient 8' }, { url: c('gradient-4'), title: 'Gradient 4' }, { url: c('gradient-2'), title: 'Gradient 2' }, { url: c('gradient-11'), title: 'Gradient 11' },
      { url: c('gradient-10'), title: 'Gradient 10' }, { url: c('gradient-5'), title: 'Gradient 5' }, { url: c('gradient-3'), title: 'Gradient 3' },
    ],
  },
  {
    title: 'Textures',
    items: [
      { url: c('texture-frosted-glass'), title: 'Frosted glass' }, { url: c('texture-painted-metal'), title: 'Painted metal' }, { url: c('texture-old-paint'), title: 'Old paint' },
      { url: c('texture-paint'), title: 'Paint canvas' }, { url: c('texture-rusted-metal'), title: 'Rusted metal' }, { url: c('texture-aged-copper'), title: 'Aged copper' },
      { url: c('texture-ice'), title: 'Ice' }, { url: c('texture-concrete'), title: 'Concrete' }, { url: c('texture-painted-wood'), title: 'Painted wood' },
      { url: c('texture-vintage-paper'), title: 'Vintage paper' },
    ],
  },
  {
    title: 'Cosmos',
    items: [
      { url: c('cosmos-cliffs'), title: 'Nebula' }, { url: c('cosmos-deep-field'), title: 'Deep field' }, { url: c('cosmos-ring'), title: 'Ring nebula' }, { url: c('cosmos-quintet'), title: 'Galaxy cluster' },
    ],
  },
  {
    title: 'Patterns',
    items: [
      { url: c('pattern-dots'), title: 'Dots' }, { url: c('pattern-stripes'), title: 'Stripes' }, { url: c('pattern-grid'), title: 'Grid' },
      { url: c('pattern-waves'), title: 'Waves' }, { url: c('pattern-checker'), title: 'Checker' }, { url: c('pattern-triangles'), title: 'Triangles' },
    ],
  },
];

export function randomCover(): string {
  const all = GALLERY.flatMap((g) => g.items);
  return all[Math.floor(Math.random() * all.length)].url;
}

/** Legacy generated covers ("gradient:a,b" / "solid:#hex" / "pattern:kind:#hex") still render. */
export function coverStyle(cover: string): React.CSSProperties {
  if (cover.startsWith('gradient:')) {
    const [a, b] = cover.slice(9).split(',');
    return { background: `linear-gradient(135deg, ${a}, ${b})` };
  }
  if (cover.startsWith('solid:')) return { background: cover.slice(6) };
  if (cover.startsWith('pattern:')) {
    const [, kind, col] = cover.split(':');
    const bg = kind === 'dots'
      ? `radial-gradient(${col} 2px, transparent 2px) 0 0/18px 18px, ${col}22`
      : kind === 'stripes'
        ? `repeating-linear-gradient(45deg, ${col}, ${col} 10px, ${col}aa 10px, ${col}aa 20px)`
        : `linear-gradient(${col}55 1px, transparent 1px) 0 0/22px 22px, linear-gradient(90deg, ${col}55 1px, ${col}18 1px) 0 0/22px 22px`;
    return { background: bg };
  }
  return {};
}

export function isImageCover(cover: string) {
  return /^(https?:|\/files\/|\/covers\/|data:)/.test(cover);
}

/** page_cover_position p (0..1) renders as object-position 50% ((1 - p) * 100%). */
const coverY = (pos: number) => `${Math.round((1 - pos) * 1000) / 10}%`;

export function PageCover({ page, readOnly, height }: { page: BlockRecord; readOnly: boolean; height?: string | number }) {
  const cover = page.format?.page_cover as string;
  const pos = (page.format?.page_cover_position as number | undefined) ?? 0.5;
  const [repositioning, setRepositioning] = useState(false);
  const [tmpPos, setTmpPos] = useState(pos);
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!repositioning) setTmpPos(pos);
  }, [pos, repositioning]);
  const drag = (e: React.PointerEvent) => {
    if (!repositioning || e.button !== 0) return;
    e.preventDefault();
    const y0 = e.clientY;
    const p0 = tmpPos;
    const img = ref.current?.querySelector('img');
    const box = ref.current?.getBoundingClientRect();
    // range of motion = overflow of the scaled image (object-fit: cover)
    const natural = img && img.naturalWidth ? (img.naturalHeight / img.naturalWidth) * (box?.width ?? 1) : (box?.height ?? 256) * 2;
    const overflow = Math.max(1, natural - (box?.height ?? 256));
    // dragging the image down reveals its top: object-position y decreases → position increases
    const onMove = (ev: PointerEvent) => setTmpPos(Math.max(0, Math.min(1, p0 + (ev.clientY - y0) / overflow)));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const shown = repositioning ? tmpPos : pos;
  const download = () => {
    // covers are user data: never follow a javascript:/data: "cover"
    const href = safeHref(cover);
    if (!href) return;
    const a = document.createElement('a');
    a.href = href;
    a.download = cover.split('/').pop() ?? 'cover';
    a.target = '_blank';
    a.click();
  };
  return (
    <div className={`nc-cover lit-page-cover-wrapper ${repositioning ? 'repositioning' : ''}`} ref={ref} style={height !== undefined ? { height, maxHeight: 'none' } : undefined} onPointerDown={drag}>
      {isImageCover(cover) ? (
        <img className="lit-page-cover" src={cover} alt="" draggable={false} style={{ objectPosition: `50% ${coverY(shown)}` }} />
      ) : (
        <div className="nc-cover-fill lit-page-cover" style={coverStyle(cover)} />
      )}
      {repositioning && <div className="nc-cover-hint">{t('lp.page.drag_to_move_the_image', 'Drag to reposition the image')}</div>}
      {!readOnly && (
        <div className={`nc-cover-controls ${repositioning || menuOpen ? 'visible' : ''}`} role="toolbar" aria-label={t('lp.page.cover_image_toolbar', 'Cover image toolbar')}>
          {repositioning ? (
            <>
              <div role="button" className="nc-cover-btn" aria-label={t('lp.page.save_cover_image_position', 'Save cover image position')}
                onClick={() => { run('repositionCover', (tx) => setFormat(tx, page.id, { page_cover_position: Math.round(tmpPos * 1000) / 1000 })); setRepositioning(false); }}>
                {t('lp.page.save_position', 'Save position')}
              </div>
              <div role="button" className="nc-cover-btn" aria-label={t('lp.page.cancel_cover_image_position_change', 'Cancel cover image position change')} onClick={() => { setTmpPos(pos); setRepositioning(false); }}>
                {t('lp.page.cancel', 'Cancel')}
              </div>
            </>
          ) : (
            <>
              <div role="button" className="nc-cover-btn" aria-label={t('lp.page.change_this_page_s_cover', 'Change this page’s cover')}
                onClick={(e) => { setMenuOpen(true); openCoverPicker(e.currentTarget.parentElement ?? e.currentTarget, page, () => setMenuOpen(false)); }}>
                {t('lp.page.change', 'Change')}
              </div>
              {isImageCover(cover) && (
                <div role="button" className="nc-cover-btn" aria-label={t('lp.page.adjust_the_cover_position', 'Adjust the cover position')} onClick={() => { setTmpPos(pos); setRepositioning(true); }}>
                  {t('lp.page.reposition', 'Reposition')}
                </div>
              )}
              {isImageCover(cover) && (
                <div role="button" className="nc-cover-btn icon" aria-label={t('lp.page.save_a_copy_of_the_cover', 'Save a copy of the cover')} data-tooltip={t('lp.page.download', 'Download')} onClick={download}>
                  <Icon name="download" size={14} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function openCoverPicker(anchor: Anchor, page: BlockRecord, onClose?: () => void) {
  return openOverlay((close) => <CoverPicker page={page} close={close} />, { anchor, placement: 'bottom-end', offset: 6, onClose });
}

type CoverTab = 'gallery' | 'upload' | 'link' | 'unsplash' | 'ai';

function CoverPicker({ page, close }: { page: BlockRecord; close: () => void }) {
  const [tab, setTab] = useState<CoverTab>('gallery');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const spaceId = useSession((s) => s.spaceId) ?? undefined;
  const set = (v: string | null) => {
    run(v ? 'setCover' : 'removeCover', (tx) => setFormat(tx, page.id, { page_cover: v ?? null, page_cover_position: v ? 0.5 : null } as any));
    close();
  };
  const upload = async (f: File) => {
    setBusy(true);
    try {
      const res = await uploadFile(f, f.name || 'cover.png', spaceId);
      set(res.url);
    } catch (er: any) {
      setErr(er?.message ?? t('lp.page.upload_failed', 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (tab !== 'upload') return;
    const onPaste = (e: ClipboardEvent) => {
      const file = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void upload(file);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);
  const tabs: [CoverTab, string][] = [
    ['gallery', t('lp.page.gallery', 'Gallery')],
    ['upload', t('lp.page.upload', 'Upload')],
    ['link', t('lp.page.link', 'Link')],
    ['unsplash', 'Unsplash'],
    // Litpage AI: a generated cover, where the workspace can generate images (plan + Settings › Litpage AI)
    ...aiImageTabs(page).map((k): [CoverTab, string] => [k, t('lp.page.litpage_ai', 'Litpage AI')]),
  ];
  return (
    <PopoverSurface width={540} maxHeight={485} className="nc-cover-picker lit-media-menu" style={{ height: 485 }}>
      <div className="nc-tabs-row" role="tablist" aria-label={t('lp.page.page_cover', 'Page cover')}>
        {tabs.map(([k, label]) => (
          <div key={k} className={`nc-tab-wrap ${tab === k ? 'active' : ''}`}>
            <div role="tab" aria-selected={tab === k} className="nc-tab" onClick={() => setTab(k)}>
              {k === 'unsplash' && <Icon name="image" size={12} style={{ marginInlineEnd: 6, color: 'var(--lp-icon-secondary)' }} />}
              {label}
            </div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div role="button" className="nc-tab nc-tab-action" onClick={() => set(null)}>{t('lp.page.remove', 'Remove')}</div>
      </div>
      <div className="lit-scroller vertical nc-tab-panel">
        {tab === 'gallery' && GALLERY.map((g) => (
          <div key={g.title}>
            <div className="nc-cover-section"><span>{g.title}</span></div>
            <div className="nc-cover-grid">
              {g.items.map((it) => (
                <div key={it.url} role="button" aria-label={it.title} className="nc-cover-thumb" data-tooltip={it.title} onClick={() => set(it.url)}>
                  <img src={it.url} alt="" loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        ))}
        {tab === 'upload' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4 }}>
            <div role="button" className="nc-dialog-btn outline nc-upload-btn" style={{ maxWidth: 300 }} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : t('lp.page.upload_file', 'Upload file')}</div>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
            <div className="nc-picker-hint" style={{ marginTop: 8 }}>{t('lp.page.or_paste_from_the_clipboard_with', 'or paste from the clipboard with {keyboardShortcut}', { keyboardShortcut: '⌘+V' })}</div>
            <div className="nc-picker-hint" style={{ marginTop: 4 }}>{t('lp.page.for_best_results_use_images_over', 'For best results, use images over {idealImageWidth} pixels wide.', { idealImageWidth: 1500 })}</div>
          </div>
        )}
        {tab === 'link' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div className="nc-picker-filter" style={{ width: '100%' }}>
              <input autoFocus placeholder={t('lp.page.paste_a_link_to_an_image', 'Paste an image URL…')} value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }}
                onKeyDown={(e) => { if (e.key === 'Enter') submitLink(); }} />
            </div>
            <div role="button" className="nc-dialog-btn primary" style={{ width: 300, marginTop: 10 }} onClick={submitLink}>{t('lp.page.submit', 'Submit')}</div>
            <div className="nc-picker-hint">{t('lp.page.works_with_any_web_image', 'Works with any web image.')}</div>
          </div>
        )}
        {tab === 'unsplash' && <UnsplashTab onPick={set} />}
        {tab === 'ai' && (
          <AiImageTab
            close={close}
            generate={(prompt, style) => generateCover(page, prompt, style).then((r) => run('setCover', (tx) => setFormat(tx, page.id, { page_cover: r.url, page_cover_position: 0.5 } as any)))}
          />
        )}
        {err && <div className="nc-picker-hint" style={{ color: 'var(--lp-red-text-primary)' }}>{err}</div>}
      </div>
    </PopoverSurface>
  );
  function submitLink() {
    const v = url.trim();
    if (!/^https?:\/\/\S+$/.test(v)) {
      setErr(t('lp.page.enter_a_valid_image_link', 'Enter a valid image link.'));
      return;
    }
    set(v);
  }
}

function UnsplashTab({ onPick }: { onPick: (url: string) => void }) {
  const key = (import.meta as any).env?.VITE_UNSPLASH_ACCESS_KEY as string | undefined;
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; thumb: string; full: string; author: string }[]>([]);
  useEffect(() => {
    if (!key) return;
    const h = setTimeout(async () => {
      try {
        const u = q.trim() ? `https://api.unsplash.com/search/photos?per_page=24&query=${encodeURIComponent(q)}` : 'https://api.unsplash.com/photos?per_page=24&order_by=popular';
        const res = await fetch(u, { headers: { Authorization: `Client-ID ${key}` } });
        const json = await res.json();
        const list = (json.results ?? json) as any[];
        setResults(list.map((p) => ({ id: p.id, thumb: p.urls?.thumb, full: `${p.urls?.raw}&w=1500&fit=crop`, author: p.user?.name ?? '' })));
      } catch {
        setResults([]);
      }
    }, 250);
    return () => clearTimeout(h);
  }, [q, key]);
  if (!key) {
    return <div className="nc-unsplash-note">Unsplash search needs an API access key.<br />Set <code>VITE_UNSPLASH_ACCESS_KEY</code> to enable it — or pick from the Gallery, upload a file, or paste a link.</div>;
  }
  return (
    <div>
      <div className="nc-picker-filter" style={{ marginBottom: 12 }}>
        <Icon name="search" size={14} style={{ color: 'var(--lp-icon-secondary)', marginInlineEnd: 6 }} />
        <input autoFocus placeholder={t('lp.page.find_an_image', 'Find an image…')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="nc-cover-grid">
        {results.map((r) => (
          <div key={r.id} role="button" className="nc-cover-thumb" data-tooltip={`by ${r.author}`} onClick={() => onPick(r.full)}>
            <img src={r.thumb} alt="" loading="lazy" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Image block tools: "Crop image" editor with mask shapes and "Add image link".
// Labels cover crop and hyperlink controls,
// Image editing actions provide labels for crop and hyperlink controls.
// Crop/mask: the image is rotated/flipped/cropped on a canvas (circle = elliptical clip with a transparent outside),
// uploaded as a new file and the block points at it (properties.source + format.display_source), keeping the first
// source in format.original_source for "Restore original". Images origins without CORS cannot be read back
// a canvas; failures end in "Image crop failed.".
import { useEffect, useMemo, useRef, useState } from 'react';
import * as L from 'lucide-react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { safeHref } from '@nc/shared/url.ts';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { openMenu } from '../../../../components/Menu.tsx';
import { Icon, registerIcons } from '../../../../components/Icon.tsx';
import { uploadFile } from '../../../../lib/api.ts';
import { getBlock, run, setFormat, setProperty, touch } from '../../../../lib/blocks.ts';
import { useSession } from '../../../../lib/store/session.ts';
import { useUI } from '../../../../lib/store/ui.ts';
import { pageUrl } from '../../../../lib/router.ts';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { pageTitle } from '../../../page/pageActions.ts';
import { breadcrumbOf, pageOrNull, usePageSearch } from '../../inline/pageSearch.ts';
import { looksLikeUrl, normalizeUrl } from '../../inline/LinkPopups.tsx';
import { originalSourceOf, sourceOf } from '../shared.tsx';

registerIcons({
  flipHorizontal: L.FlipHorizontal2, flipVertical: L.FlipVertical2, rotateLeft: L.RotateCcw, rotateRight: L.RotateCw,
  cropStyleFreeform: L.Scan, cropStyleRectangle: L.RectangleHorizontal, cropStyleSquare: L.Square, cropStyleCircle: L.Circle,
  revertImage: L.Undo2, imageLink: L.Link,
});

/* ------------------------------------------------------------------ crop / mask */

type CropStyle = 'freeform' | 'rectangle' | 'square' | 'circle';
const STYLES: { id: CropStyle; label: string; icon: string; ratio: number | null }[] = [
  { id: 'freeform', label: 'Freeform', icon: 'cropStyleFreeform', ratio: null },
  { id: 'rectangle', label: 'Rectangle', icon: 'cropStyleRectangle', ratio: 16 / 9 },
  { id: 'square', label: 'Square', icon: 'cropStyleSquare', ratio: 1 },
  { id: 'circle', label: 'Circle', icon: 'cropStyleCircle', ratio: 1 },
];

interface Crop { x: number; y: number; w: number; h: number } // fractions of the oriented image

export function openImageEditor(blockId: string) {
  const b = getBlock(blockId);
  if (!b || !sourceOf(b)) return;
  openOverlay((close) => <ImageEditor blockId={blockId} close={close} />, { backdrop: 'dim', placement: 'middle', className: 'nc-image-editor-overlay', closeOnEscape: true });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    try {
      if (new URL(src, location.href).origin !== location.origin) img.crossOrigin = 'anonymous';
    } catch {
      /* relative */
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('load'));
    img.src = src;
  });
}

/** Oriented size after a rotation of `rot` degrees. */
function orientedSize(img: HTMLImageElement, rot: number) {
  return rot % 180 ? { w: img.naturalHeight, h: img.naturalWidth } : { w: img.naturalWidth, h: img.naturalHeight };
}

/** Draw the rotated / flipped image (screen-relative flips) into a canvas of its oriented size × scale. */
function drawOriented(img: HTMLImageElement, rot: number, flipH: boolean, flipV: boolean, scale = 1): HTMLCanvasElement {
  const { w, h } = orientedSize(img, rot);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * scale));
  c.height = Math.max(1, Math.round(h * scale));
  const ctx = c.getContext('2d')!;
  ctx.translate(c.width / 2, c.height / 2);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(img, (-img.naturalWidth * scale) / 2, (-img.naturalHeight * scale) / 2, img.naturalWidth * scale, img.naturalHeight * scale);
  return c;
}

function fitCrop(style: CropStyle, ow: number, oh: number, prev?: Crop): Crop {
  const ratio = STYLES.find((s) => s.id === style)?.ratio ?? null;
  if (!ratio) return prev ?? { x: 0, y: 0, w: 1, h: 1 };
  // largest centered box with ratio (in pixels) inside the image
  let pw = ow;
  let ph = pw / ratio;
  if (ph > oh) { ph = oh; pw = ph * ratio; }
  const w = pw / ow;
  const h = ph / oh;
  return { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
}

function ImageEditor({ blockId, close }: { blockId: string; close: () => void }) {
  const block = getBlock(blockId) as BlockRecord;
  const src = sourceOf(block)!;
  const original = block.format?.original_source as string | undefined;
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [failed, setFailed] = useState(false);
  const [rot, setRot] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [style, setStyle] = useState<CropStyle>('freeform');
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, w: 1, h: 1 });
  const [saving, setSaving] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  useEffect(() => {
    let alive = true;
    loadImage(src).then((i) => alive && setImg(i)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [src]);

  // preview canvas sized to fit the stage
  useEffect(() => {
    if (!img || !stageRef.current) return;
    const { w: ow, h: oh } = orientedSize(img, rot);
    const sw = stageRef.current.clientWidth - 48;
    const sh = stageRef.current.clientHeight - 48;
    const k = Math.min(1, sw / ow, sh / oh);
    const dw = Math.max(1, Math.round(ow * k));
    const dh = Math.max(1, Math.round(oh * k));
    setBox({ w: dw, h: dh });
    const c = previewRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    let o: HTMLCanvasElement;
    try {
      o = drawOriented(img, rot, flipH, flipV, Math.min(1, (k * dpr)));
    } catch {
      return;
    }
    c.width = o.width;
    c.height = o.height;
    c.getContext('2d')!.drawImage(o, 0, 0);
  }, [img, rot, flipH, flipV]);

  const pickStyle = (s: CropStyle) => {
    setStyle(s);
    if (img) {
      const { w, h } = orientedSize(img, rot);
      setCrop(fitCrop(s, w, h, s === 'freeform' ? crop : undefined));
    }
  };

  const rotate = (dir: 1 | -1) => {
    const next = (rot + (dir > 0 ? 90 : 270)) % 360;
    setRot(next);
    if (img) {
      const { w, h } = orientedSize(img, next);
      setCrop(fitCrop(style, w, h));
    }
  };

  // drag the crop box (move) or one of its 8 handles (resize), keeping the style's ratio
  const startDrag = (e: React.PointerEvent, mode: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!img) return;
    const ratio = STYLES.find((s) => s.id === style)?.ratio ?? null;
    const { w: ow, h: oh } = orientedSize(img, rot);
    const start = { x: e.clientX, y: e.clientY, crop: { ...crop } };
    const min = 0.04;
    const onMove = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / box.w;
      const dy = (ev.clientY - start.y) / box.h;
      const c = { ...start.crop };
      if (mode === 'move') {
        c.x = Math.min(1 - c.w, Math.max(0, c.x + dx));
        c.y = Math.min(1 - c.h, Math.max(0, c.y + dy));
      } else {
        let { x, y, w, h } = c;
        if (mode.includes('w')) { const nx = Math.min(x + w - min, Math.max(0, x + dx)); w += x - nx; x = nx; }
        if (mode.includes('e')) w = Math.min(1 - x, Math.max(min, w + dx));
        if (mode.includes('n')) { const ny = Math.min(y + h - min, Math.max(0, y + dy)); h += y - ny; y = ny; }
        if (mode.includes('s')) h = Math.min(1 - y, Math.max(min, h + dy));
        if (ratio) {
          // keep w·ow / (h·oh) = ratio, anchored at the side opposite the dragged handle
          const wantH = (w * ow) / ratio / oh;
          const wantW = (h * oh * ratio) / ow;
          if (mode === 'n' || mode === 's') w = Math.min(wantW, 1);
          else h = wantH;
          if (y + h > 1) { h = 1 - y; w = (h * oh * ratio) / ow; }
          if (x + w > 1) { w = 1 - x; h = (w * ow) / ratio / oh; }
          if (mode.includes('n')) y = start.crop.y + start.crop.h - h;
          if (mode.includes('w')) x = start.crop.x + start.crop.w - w;
          x = Math.max(0, x);
          y = Math.max(0, y);
        }
        Object.assign(c, { x, y, w, h });
      }
      setCrop(c);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const save = async () => {
    if (!img || saving) return;
    setSaving(true);
    try {
      const full = drawOriented(img, rot, flipH, flipV);
      const cx = Math.round(crop.x * full.width);
      const cy = Math.round(crop.y * full.height);
      const cw = Math.max(1, Math.round(crop.w * full.width));
      const ch = Math.max(1, Math.round(crop.h * full.height));
      const out = document.createElement('canvas');
      out.width = cw;
      out.height = ch;
      const ctx = out.getContext('2d')!;
      if (style === 'circle') {
        ctx.beginPath();
        ctx.ellipse(cw / 2, ch / 2, cw / 2, ch / 2, 0, 0, Math.PI * 2);
        ctx.clip();
      }
      ctx.drawImage(full, cx, cy, cw, ch, 0, 0, cw, ch);
      const jpeg = style !== 'circle' && /\.jpe?g($|\?)/i.test(src);
      const blob = await new Promise<Blob | null>((res) => out.toBlob(res, jpeg ? 'image/jpeg' : 'image/png', 0.92));
      if (!blob) throw new Error('encode');
      const base = (originalSourceOf(block) ?? 'image').split('/').pop()?.split('?')[0]?.replace(/\.[a-z0-9]+$/i, '') || 'image';
      const name = `${decodeURIComponent(base).slice(0, 60)}-cropped.${jpeg ? 'jpg' : 'png'}`;
      const up = await uploadFile(blob, name, useSession.getState().spaceId ?? undefined);
      const cur = getBlock(blockId);
      run('imageEditActions.cropImage', (tx) => {
        setProperty(tx, blockId, 'source', [[up.url]]);
        setFormat(tx, blockId, {
          display_source: up.url,
          block_aspect_ratio: ch / cw,
          original_source: (cur?.format?.original_source as string | undefined) ?? originalSourceOf(cur) ?? src,
          image_mask: style === 'circle' ? 'circle' : undefined,
        } as any);
        tx.update('block', blockId, [], { file_ids: [up.id] });
        touch(tx, blockId);
      });
      close();
    } catch {
      useUI.getState().toast('Image crop failed.');
      setSaving(false);
    }
  };

  const revert = () => {
    if (!original) return;
    const probe = new Image();
    probe.onload = () => {
      run('imageEditActions.revertImage', (tx) => {
        setProperty(tx, blockId, 'source', [[original]]);
        setFormat(tx, blockId, { display_source: original, original_source: undefined, image_mask: undefined, block_aspect_ratio: probe.naturalWidth ? probe.naturalHeight / probe.naturalWidth : undefined } as any);
        touch(tx, blockId);
      });
      close();
    };
    probe.onerror = () => {
      run('imageEditActions.revertImage', (tx) => {
        setProperty(tx, blockId, 'source', [[original]]);
        setFormat(tx, blockId, { display_source: original, original_source: undefined, image_mask: undefined } as any);
      });
      close();
    };
    probe.src = original;
  };

  const cur = STYLES.find((s) => s.id === style)!;
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
  return (
    <div className="nc-image-editor" role="dialog" aria-label="Crop image">
      <div className="nc-image-editor-head">
        <div
          role="button"
          className="nc-image-editor-style"
          aria-label="Aspect ratio"
          data-tooltip="Aspect ratio"
          onClick={(e) => {
            // only this menu closes (Menu closes every overlay unless onSelect returns false — the editor stays)
            let closeMenu: () => void = () => {};
            closeMenu = openMenu(e.currentTarget, { width: 200, role: 'menu', sections: [{ items: STYLES.map((s) => ({ label: s.label, icon: s.icon, checked: s.id === style, onSelect: () => { pickStyle(s.id); closeMenu(); return false; } })) }] });
          }}
        >
          <Icon name={cur.icon} size={18} />
          <Icon name="chevronDown" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
        <div className="nc-image-editor-title">Crop image</div>
        <div style={{ flex: 1 }} />
        <div role="button" className="nc-icon-btn" aria-label="Rotate left" data-tooltip="Rotate left" onClick={() => rotate(-1)}><Icon name="rotateLeft" size={18} /></div>
        <div role="button" className="nc-icon-btn" aria-label="Rotate right" data-tooltip="Rotate right" onClick={() => rotate(1)}><Icon name="rotateRight" size={18} /></div>
        <div role="button" className="nc-icon-btn" aria-label="Flip horizontal" data-tooltip="Flip horizontal" onClick={() => setFlipH(!flipH)}><Icon name="flipHorizontal" size={18} /></div>
        <div role="button" className="nc-icon-btn" aria-label="Flip vertical" data-tooltip="Flip vertical" onClick={() => setFlipV(!flipV)}><Icon name="flipVertical" size={18} /></div>
      </div>
      <div className="nc-image-editor-stage" ref={stageRef}>
        {failed && <div className="nc-image-editor-error">The image could not be loaded.</div>}
        {img && (
          <div className="nc-image-editor-canvas" style={{ width: box.w, height: box.h }}>
            <canvas ref={previewRef} style={{ width: box.w, height: box.h }} aria-label="Source image" />
            <div
              className={`nc-crop-box ${style === 'circle' ? 'circle' : ''}`}
              style={{ left: crop.x * box.w, top: crop.y * box.h, width: crop.w * box.w, height: crop.h * box.h }}
              onPointerDown={(e) => startDrag(e, 'move')}
              data-testid="crop-box"
            >
              <div className="nc-crop-grid" />
              {handles.map((h) => <div key={h} className={`nc-crop-handle ${h}`} data-handle={h} onPointerDown={(e) => startDrag(e, h)} />)}
            </div>
          </div>
        )}
      </div>
      <div className="nc-image-editor-foot">
        {original && <div role="button" className="nc-dialog-btn" onClick={revert}><Icon name="revertImage" size={16} />Restore original</div>}
        <div style={{ flex: 1 }} />
        <div role="button" className="nc-dialog-btn" onClick={close}>Cancel</div>
        <div role="button" className={`nc-dialog-btn primary ${!img || saving ? 'disabled' : ''}`} aria-disabled={!img || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ link */

/** “Add image link” / “Change image link”: a URL or page the image opens when clicked. */
export function openImageLinkPopover(blockId: string, anchor: HTMLElement | DOMRect) {
  openOverlay((close) => <ImageLinkPopover blockId={blockId} close={close} />, { anchor, placement: 'bottom', offset: 6 });
}

function setImageLink(blockId: string, href: string | null) {
  run(href ? 'imageActions.setHyperlink' : 'imageActions.removeHyperlink', (tx) => setFormat(tx, blockId, { image_hyperlink: href ?? undefined } as any));
}

function ImageLinkPopover({ blockId, close }: { blockId: string; close: () => void }) {
  const cur = (getBlock(blockId)?.format?.image_hyperlink as string | undefined) ?? '';
  const [q, setQ] = useState(cur);
  const [active, setActive] = useState(0);
  const isUrl = looksLikeUrl(q);
  const hits = usePageSearch(isUrl ? '' : q, { limit: 8 });
  const rows = useMemo(() => {
    const out: { key: string; label: string; sub?: string; pageId?: string; href: string }[] = [];
    if (isUrl) out.push({ key: 'url', label: q.trim(), sub: 'Web page link', href: normalizeUrl(q) });
    else for (const id of hits.ids) {
      const p = pageOrNull(id);
      if (p) out.push({ key: id, label: pageTitle(p) || 'Untitled', sub: breadcrumbOf(id), pageId: id, href: pageUrl(id) });
    }
    return out;
  }, [isUrl, q, hits.ids]);
  const pick = (href: string) => {
    if (!safeHref(href) && !href.startsWith('/')) return;
    setImageLink(blockId, href);
    close();
  };
  return (
    <PopoverSurface width={330} className="nc-image-link-popover">
      <div style={{ padding: '12px 12px 6px' }}>
        <div className="nc-input">
          <input
            autoFocus
            placeholder="Paste a link or find pages"
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                const r = rows[active];
                if (r) pick(r.href);
              }
            }}
          />
        </div>
      </div>
      <div className="nc-image-link-list" role="listbox">
        {!isUrl && !q.trim() && rows.length > 0 && <div className="nc-image-link-section">Recents</div>}
        {rows.map((r, i) => (
          <div key={r.key} role="option" aria-selected={i === active} className={`nc-menu-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r.href)}>
            <div className="nc-menu-item-inner nc-mi">
              <div className="nc-menu-icon">{r.pageId ? <PageIcon block={pageOrNull(r.pageId)!} size={18} /> : <Icon name="globe" size={18} />}</div>
              <div className="nc-menu-label">
                <div className="nc-ellipsis">{r.label}</div>
                {r.sub && <div className="nc-menu-desc nc-ellipsis">{r.sub}</div>}
              </div>
            </div>
          </div>
        ))}
        {cur && (
          <div role="option" aria-selected={false} className="nc-menu-item" onMouseDown={(e) => e.preventDefault()} onClick={() => { setImageLink(blockId, null); close(); }}>
            <div className="nc-menu-item-inner nc-mi">
              <div className="nc-menu-icon"><Icon name="trash" size={18} /></div>
              <div className="nc-menu-label"><div className="nc-ellipsis">Remove link</div></div>
            </div>
          </div>
        )}
      </div>
    </PopoverSurface>
  );
}

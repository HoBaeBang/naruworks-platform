// Card pieces shared by board and gallery: cover/preview (none | page cover | page content | file property),
// title row (page icon + 15px/500 title, editable when new), property lines (List / Compact card layout).
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { getPropertyValue, isEmptyValue } from '@nc/shared/database/index.ts';
import { records } from '../../../lib/store/records.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { RichTextEditable } from '../../editor/RichTextEditable.tsx';
import { PropertyCell } from '../properties/PropertyCell.tsx';
import { RichTextView } from '../properties/RichTextView.tsx';
import { setValue } from '../actions.ts';
import { run } from '../../../lib/blocks.ts';
import { makeQueryContext } from '../data.ts';
import { useDatabaseContext } from '../DatabaseContext.tsx';
import { CardSubitems } from '../subitemsUi.tsx';
import { TitleText } from './highlight.tsx';
import '../dbv.css';

export interface CoverConfig {
  type: 'none' | 'page_cover' | 'page_content' | 'page_content_first' | 'property';
  property?: string;
  aspect: 'cover' | 'contain';
  size: 'small' | 'medium' | 'large';
}

export function cardCoverConfig(view: CollectionViewRecord, kind: 'board' | 'gallery'): CoverConfig {
  const fmt = (view.format ?? {}) as Record<string, any>;
  const c = (kind === 'board' ? fmt.board_cover : fmt.gallery_cover) as { type?: string; property?: string } | undefined;
  const type = (c?.type ?? (kind === 'board' ? 'none' : 'page_content_first')) as CoverConfig['type'];
  return { type, property: c?.property, aspect: (kind === 'board' ? fmt.board_cover_aspect : fmt.gallery_cover_aspect) === 'contain' ? 'contain' : 'cover', size: (kind === 'board' ? fmt.board_cover_size : fmt.gallery_cover_size) ?? 'medium' };
}

function isImage(url: string) {
  return /\.(png|jpe?g|gif|webp|svg|avif)(\?|#|$)/i.test(url) || url.startsWith('data:image');
}

function coverStyle(cover: string | undefined, position?: number): React.CSSProperties | null {
  if (!cover) return null;
  if (/^(linear|radial)-gradient|^#|^rgb/.test(cover)) return { background: cover };
  return { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: `center ${Math.round((position ?? 0.5) * 100)}%` };
}

/** First image / text of a page's content (only blocks already in the store). */
function contentPreview(row: BlockRecord): { image?: string; lines: RichText[] } {
  const lines: RichText[] = [];
  for (const id of row.content ?? []) {
    const b = records.get<BlockRecord>('block', id);
    if (!b || !b.alive) continue;
    if (b.type === 'image') {
      const src = (b.properties?.source as RichText | undefined)?.map((d) => d[0]).join('') ?? (b.format as any)?.display_source;
      if (src) return { image: src, lines };
    }
    const t = b.properties?.title as RichText | undefined;
    if (t?.length) lines.push(t);
    if (lines.length >= 6) break;
  }
  return { lines };
}

/** "Reposition" on a cropped card image: drag the image vertically, then * "Save position" — a page cover keeps the page's own cover position, other images a per-card position. */
function useReposition(row: BlockRecord, kind: CoverConfig['type']) {
  const stored = kind === 'page_cover' ? (row.format?.page_cover_position as number | undefined) : ((row.format as Record<string, unknown> | undefined)?.card_cover_position as number | undefined);
  const [draft, setDraft] = useState<number | null>(null);
  const save = () => {
    if (draft === null) return;
    const key = kind === 'page_cover' ? 'page_cover_position' : 'card_cover_position';
    run('cardCover.reposition', (tx) => tx.update('block', row.id, ['format'], { [key]: Math.round(draft * 1000) / 1000 }));
    setDraft(null);
  };
  return { position: draft ?? stored ?? 0.5, editing: draft !== null, start: () => setDraft(stored ?? 0.5), set: setDraft, save, cancel: () => setDraft(null) };
}

export function CardCover({ row, cover, view, collection, readOnly = true }: { row: BlockRecord; cover: CoverConfig; view: CollectionViewRecord; collection: CollectionRecord; readOnly?: boolean }) {
  const rep = useReposition(row, cover.type);
  if (cover.type === 'none') return null;
  let style: React.CSSProperties | null = null;
  let preview: { image?: string; lines: RichText[] } | null = null;
  if (cover.type === 'page_cover') style = coverStyle(row.format?.page_cover as string | undefined, row.format?.page_cover_position as number | undefined);
  else if (cover.type === 'property' && cover.property) {
    const v = getPropertyValue(row, cover.property, collection.schema, makeQueryContext());
    const img = v.kind === 'file' ? v.files.find((f) => isImage(f.url)) : undefined;
    if (img) style = { backgroundImage: `url("${img.url}")` };
  } else preview = contentPreview(row);
  if (cover.type === 'page_cover' && !style) return null;
  if (cover.type === 'property' && !style) return null;
  void view;
  const imageUrl = style?.backgroundImage ? style.backgroundImage : preview?.image ? `url("${preview.image}")` : undefined;
  // cropped images can be repositioned; "Fit media" (contain) shows the whole image
  const canReposition = !readOnly && !!imageUrl && cover.aspect === 'cover';
  const pos = `center ${Math.round(rep.position * 100)}%`;
  const drag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!rep.editing) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    const h = el.getBoundingClientRect().height || 1;
    const y0 = e.clientY;
    const p0 = rep.position;
    const move = (ev: PointerEvent) => rep.set(Math.max(0, Math.min(1, p0 - (ev.clientY - y0) / (h * 2))));
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={`nc-card-cover ${cover.aspect} ${preview ? 'content' : ''} ${rep.editing ? 'repositioning' : ''}`} onClick={(e) => { if (rep.editing) e.stopPropagation(); }}>
      {style && <div className="nc-card-cover-img" onPointerDown={drag} style={{ ...style, backgroundSize: cover.aspect === 'contain' ? 'contain' : 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: imageUrl ? pos : style.backgroundPosition ?? 'center' }} />}
      {preview && (preview.image ? (
        <div className="nc-card-cover-img" onPointerDown={drag} style={{ backgroundImage: `url("${preview.image}")`, backgroundSize: cover.aspect === 'contain' ? 'contain' : 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: pos }} />
      ) : (
        <div className="nc-card-preview-text">{preview.lines.map((l, i) => <div key={i} className="nc-card-preview-line"><RichTextView value={l} /></div>)}</div>
      ))}
      {canReposition && !rep.editing && (
        <div role="button" className="nc-card-reposition" onClick={(e) => { e.stopPropagation(); rep.start(); }}>Reposition</div>
      )}
      {rep.editing && (
        <div className="nc-card-reposition-bar" onClick={(e) => e.stopPropagation()}>
          <span className="nc-card-reposition-hint">Drag the image to move it</span>
          <span role="button" className="nc-card-reposition-btn" onClick={rep.save}>Save position</span>
          <span role="button" className="nc-card-reposition-btn" onClick={rep.cancel}>Cancel</span>
        </div>
      )}
    </div>
  );
}

export function CardBody({ row, view, collection, props, showTitle, readOnly, editing, onDoneEditing }: { row: BlockRecord; view: CollectionViewRecord; collection: CollectionRecord; props: string[]; showTitle: boolean; readOnly: boolean; editing: boolean; onDoneEditing: () => void }) {
  const db = useDatabaseContext();
  const fmt = (view.format ?? {}) as Record<string, any>;
  const compact = fmt.card_layout?.mode === 'compact';
  const wrap = fmt.table_wrap !== false;
  const showIcon = fmt.show_page_icon !== false;
  const ctx = makeQueryContext();
  const title = (row.properties?.title as RichText | undefined) ?? [];
  const ref = useRef<HTMLDivElement>(null);
  const [edit, setEdit] = useState(editing);
  useEffect(() => setEdit(editing), [editing]);
  useEffect(() => {
    if (!edit) return;
    const el = ref.current?.querySelector<HTMLElement>('[contenteditable]');
    if (!el) return;
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    r.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(r);
  }, [edit]);
  const values = props.filter((p) => collection.schema[p] && (collection.schema[p].type === 'checkbox' || collection.schema[p].type === 'button' || !isEmptyValue(getPropertyValue(row, p, collection.schema, ctx))));
  return (
    <div className="nc-card-body">
      {(showTitle || edit) && (
        <div className="nc-card-title-row" ref={ref}>
          {showIcon && row.format?.page_icon && <span className="nc-card-title-icon"><PageIcon block={row} size={18} /></span>}
          {edit && !readOnly ? (
            <RichTextEditable
              blockId={row.id}
              property="title"
              value={title}
              className="nc-card-title editing"
              placeholder="Type a name…"
              placeholderAlways
              onChange={(next) => setValue(row.id, 'title', next, { coalesce: `title:${row.id}` })}
              onBlur={() => { setEdit(false); onDoneEditing(); }}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' && !e.nativeEvent.isComposing) || e.key === 'Escape') {
                  e.preventDefault();
                  (e.currentTarget as HTMLElement).blur();
                }
              }}
            />
          ) : (
            <div className={`nc-card-title ${title.length ? '' : 'untitled'}`}>{title.length ? <TitleText title={title} search={db?.search} /> : 'Untitled'}</div>
          )}
        </div>
      )}
      {values.length > 0 && (
        <div className={`nc-card-props ${compact ? 'compact' : 'list'} ${!showTitle ? 'no-title' : ''}`} onClick={(e) => e.stopPropagation()}>
          {values.map((p) => (
            <PropertyCell key={p} row={row} schema={collection.schema} propId={p} readOnly={readOnly} view={view} wrap={wrap} mode="card" className="nc-card-prop" />
          ))}
        </div>
      )}
      <CardSubitems row={row} view={view} collection={collection} openRow={(id) => db?.openRow(id)} />
    </div>
  );
}

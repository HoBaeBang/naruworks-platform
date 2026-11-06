// Version-history preview of a page snapshot. It mirrors the editor’s block DOM (Block.tsx wrapper with
// --nc-pad-top/--nc-pad-bottom from editor/spacing.ts, .nc-pad/.nc-row/.nc-leaf, list/quote/divider/callout/code
// structures from editor/blocks/*) so editor.css/blocks.css give the preview the page's exact vertical rhythm:
// every block sits at the page offsets, titles 40/48 bold.
// Layout: content up to 900px centered with ≥20px margins (block boxes x 402–1302 in a 1064px preview pane),
// page title 83px below the preview's top edge.
// Snapshot blocks share ids with live blocks, so nothing here touches the record store or uses data-block-id.
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { HEADING_TYPES, LIST_TYPES } from '@nc/shared/blocks.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { renderRichText } from '../editor/richTextDom.ts';
import { spacingFor } from '../editor/spacing.ts';
import { highlightToHtml } from '../editor/blocks/codeHighlight.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { coverStyle, isImageCover } from './Cover.tsx';

type Lookup = (id: string) => BlockRecord | undefined;

interface Ctx {
  get: Lookup;
  /** blocks changed in the previewed version (outlined) */
  changed: Set<string>;
}

const HEADING_TAG: Record<string, 'h2' | 'h3' | 'h4' | 'h5'> = { header: 'h2', sub_header: 'h3', sub_sub_header: 'h4', header_4: 'h5' };
const CALLOUT_BG: Record<string, string> = {
  gray: 'var(--nc-callout-gray-bg, var(--lp-gray-bg-primary))', brown: 'var(--lp-brown-bg-secondary)', orange: 'var(--lp-orange-bg-secondary)', yellow: 'var(--lp-yellow-bg-secondary)', green: 'var(--lp-green-bg-secondary)',
  teal: 'var(--lp-green-bg-secondary)', blue: 'var(--lp-blue-bg-secondary)', purple: 'var(--lp-purple-bg-secondary)', pink: 'var(--lp-pink-bg-secondary)', red: 'var(--lp-red-bg-secondary)',
};

function Leaf({ value, tag = 'div', className }: { value: RichText | undefined; tag?: 'div' | 'h2' | 'h3' | 'h4' | 'h5'; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (ref.current) renderRichText(ref.current, value ?? []);
  }, [value]);
  const Tag = tag as any;
  return <Tag ref={ref} className={`notranslate content-editable-leaf-rtl nc-leaf ${className ?? ''}`} />;
}

function colorClass(b: BlockRecord): string {
  const color = b.format?.block_color as string | undefined;
  if (!color || color === 'default' || b.type === 'callout') return '';
  return color.endsWith('_background') ? `lit-bg-${color.replace('_background', '')}` : `lit-color-${color}`;
}

function listDepth(b: BlockRecord, type: string, get: Lookup): number {
  let d = 0;
  let cur = get(b.parent_id);
  while (cur && cur.type === type) {
    d++;
    cur = get(cur.parent_id);
  }
  return d;
}

function numberLabel(n: number, depth: number): string {
  const level = depth % 3;
  if (level === 1) {
    let s = '';
    let x = n;
    while (x > 0) {
      x--;
      s = String.fromCharCode(97 + (x % 26)) + s;
      x = Math.floor(x / 26);
    }
    return s;
  }
  if (level === 2) {
    const map: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
    let r = '';
    let x = n;
    for (const [v, s] of map) while (x >= v) { r += s; x -= v; }
    return r;
  }
  return String(n);
}

function List({ ids, depth, ctx }: { ids: string[] | undefined; depth: number; ctx: Ctx }) {
  const alive = (ids ?? []).map(ctx.get).filter((b): b is BlockRecord => !!b && b.alive !== false);
  return (
    <div className="nc-block-list">
      {alive.map((b, i) => (
        <SnapBlock key={b.id} block={b} prev={alive[i - 1]} next={alive[i + 1]} index={i} siblings={alive} depth={depth} ctx={ctx} />
      ))}
    </div>
  );
}

function SnapBlock({ block: b, prev, next, index, siblings, depth, ctx }: { block: BlockRecord; prev?: BlockRecord; next?: BlockRecord; index: number; siblings: BlockRecord[]; depth: number; ctx: Ctx }) {
  const sp = spacingFor(b, prev, next, index === 0, depth > 0);
  return (
    <div
      className={`lit-selectable lit-${b.type}-block ${ctx.changed.has(b.id) ? 'nc-vh-changed' : ''}`}
      data-snapshot-block-id={b.id}
      style={{ ['--nc-pad-top' as any]: `${sp.top}px`, ['--nc-pad-bottom' as any]: `${sp.bottom}px` }}
    >
      <div className={`nc-block-color ${colorClass(b)}`}>
        <BlockBody block={b} index={index} siblings={siblings} depth={depth} ctx={ctx} />
      </div>
    </div>
  );
}

function Children({ block, depth, ctx, indent }: { block: BlockRecord; depth: number; ctx: Ctx; indent: boolean }): ReactNode {
  if (!block.content?.length || block.type === 'page' || block.type === 'collection_view_page') return null;
  return (
    <div className={`nc-block-children ${indent ? 'indent' : ''}`}>
      <List ids={block.content} depth={depth + 1} ctx={ctx} />
    </div>
  );
}

function BlockBody({ block: b, index, siblings, depth, ctx }: { block: BlockRecord; index: number; siblings: BlockRecord[]; depth: number; ctx: Ctx }) {
  const title = b.properties?.title as RichText | undefined;
  if (HEADING_TYPES.has(b.type)) {
    return (
      <div className="nc-pad">
        <div className="nc-row">
          <Leaf value={title} tag={HEADING_TAG[b.type]} className={`nc-heading nc-${b.type}`} />
        </div>
        {b.format?.toggleable && <div className="nc-toggle-heading-children"><Children block={b} depth={depth} ctx={ctx} indent={false} /></div>}
      </div>
    );
  }
  if (LIST_TYPES.has(b.type)) {
    const checked = b.type === 'to_do' && toPlainText(b.properties?.checked as RichText | undefined) === 'Yes';
    let marker: ReactNode;
    if (b.type === 'bulleted_list') {
      marker = <div className="lit-list-item-box-left"><div className="pseudoBefore nc-bullet"><span className="g">{['•', '◦', '▪'][listDepth(b, 'bulleted_list', ctx.get) % 3]}</span></div></div>;
    } else if (b.type === 'numbered_list') {
      let n = 1;
      for (let i = index - 1; i >= 0 && siblings[i]?.type === 'numbered_list'; i--) n++;
      const start = (siblings[index - n + 1]?.format?.list_start_index as number | undefined) ?? 1;
      marker = <div className="lit-list-item-box-left nc-num-marker"><span className="pseudoBefore">{numberLabel(start + n - 1, listDepth(b, 'numbered_list', ctx.get))}.</span></div>;
    } else if (b.type === 'to_do') {
      marker = (
        <div className="lit-list-item-box-left nc-todo-box">
          <div className={`nc-checkbox ${checked ? 'checked' : ''}`}>
            {checked && <Check size={12} strokeWidth={2.5} aria-hidden />}
          </div>
        </div>
      );
    } else {
      return <SnapToggle block={b} depth={depth} ctx={ctx} />;
    }
    return (
      <div className="nc-pad nc-list-pad">
        <div className="nc-row">
          <div className="nc-list-row">
            {marker}
            <div className="nc-list-body">
              <Leaf value={title} className={checked ? 'nc-checked' : ''} />
              <Children block={b} depth={depth} ctx={ctx} indent={false} />
            </div>
          </div>
        </div>
      </div>
    );
  }
  switch (b.type) {
    case 'quote':
      return (
        <div className="nc-bpad">
          <div className={`nc-quote-2 ${b.format?.quote_size === 'large' ? 'large' : ''}`}>
            <Leaf value={title} className="nc-quote-leaf" />
            <Children block={b} depth={depth} ctx={ctx} indent={false} />
          </div>
        </div>
      );
    case 'divider':
      return (
        <div className="nc-divider">
          <div role="separator" className="nc-divider-line" />
        </div>
      );
    case 'callout': {
      const iconV = b.format?.page_icon as string | null | undefined;
      const icon = iconV === '' || iconV === null ? null : iconV ?? '💡';
      const color = (b.format?.block_color as string | undefined) ?? 'default';
      const base = color.replace('_background', '');
      const style = color.endsWith('_background') ? { background: CALLOUT_BG[base] ?? 'var(--lp-gray-bg-primary)' } : undefined;
      const cls = !color.endsWith('_background') && color !== 'default' ? `colored-text lit-color-${base}` : '';
      const v2 = b.format?.callout_version === 2 || (!title && !!b.content?.length);
      return (
        <div className="nc-bpad">
          <div style={{ display: 'flex' }}>
            <div className={`nc-callout-2 ${cls}`} style={style}>
              {icon && (
                <div className="nc-callout-icon-2">
                  <div className="lit-record-icon notranslate nc-callout-icon-btn"><PageIcon icon={icon} size={24} fallback={null} /></div>
                </div>
              )}
              <div className={`nc-callout-body-2 ${v2 ? '' : 'legacy'}`}>
                {!v2 && <Leaf value={title} />}
                {b.content?.length ? <List ids={b.content} depth={depth + 1} ctx={ctx} /> : null}
              </div>
            </div>
          </div>
        </div>
      );
    }
    case 'code': {
      const language = (b.properties?.language as RichText | undefined)?.[0]?.[0] ?? 'Plain Text';
      return (
        <div className="nc-bpad">
          <div className="nc-code-box" role="figure" aria-label="Code block">
            <div className="nc-code-scroll">
              <div
                className={`nc-code-leaf-2 language-${String(language).toLowerCase().replace(/[^a-z0-9]/g, '')} ${b.format?.code_wrap === true ? 'wrap' : ''}`}
                dangerouslySetInnerHTML={{ __html: highlightToHtml(toPlainText(title), String(language)) }}
              />
            </div>
          </div>
        </div>
      );
    }
    case 'image': {
      const src = toPlainText(b.properties?.source as RichText | undefined) || (b.format?.display_source as string) || '';
      return <div className="nc-bpad">{src ? <img src={src} alt="" style={{ maxWidth: '100%', borderRadius: 4, display: 'block' }} /> : <div className="nc-static-placeholder">Image</div>}</div>;
    }
    case 'page': case 'collection_view_page': case 'link_to_page': case 'alias': {
      const target = b.type === 'alias' || b.type === 'link_to_page' ? ctx.get(String((b.format as any)?.alias_pointer?.id ?? '')) ?? b : b;
      return (
        <div className="nc-pad">
          <div className="nc-row nc-snap-pagelink">
            <PageIcon block={target} size={20} />
            <span>{toPlainText(target.properties?.title) || 'Untitled'}</span>
          </div>
        </div>
      );
    }
    case 'column_list':
      return (
        <div className="nc-snap-columns">
          {(b.content ?? []).map((id) => {
            const col = ctx.get(id);
            return col ? <div key={id} style={{ flex: (col.format?.column_ratio as number | undefined) ?? 1, minWidth: 0 }}><List ids={col.content} depth={depth + 1} ctx={ctx} /></div> : null;
          })}
        </div>
      );
    case 'table': {
      const order = (b.format?.table_block_column_order as string[] | undefined) ?? [];
      return (
        <div className="nc-bpad">
          <table className="nc-static-table">
            <tbody>
              {(b.content ?? []).map((id) => {
                const r = ctx.get(id);
                if (!r) return null;
                const cols = order.length ? order : Object.keys(r.properties ?? {});
                return <tr key={id}>{cols.map((k) => <td key={k}><Leaf value={r.properties?.[k] as RichText | undefined} /></td>)}</tr>;
              })}
            </tbody>
          </table>
        </div>
      );
    }
    case 'equation':
      return <div className="nc-bpad"><div style={{ textAlign: 'center', fontFamily: 'KaTeX_Main, serif', padding: 8 }}>{toPlainText(title)}</div></div>;
    case 'collection_view':
      return <div className="nc-bpad"><div className="nc-static-placeholder">Database</div></div>;
    case 'video': case 'audio': case 'file': case 'pdf': case 'bookmark': case 'embed':
      return <div className="nc-bpad"><div className="nc-static-placeholder">{toPlainText(title) || toPlainText(b.properties?.source as RichText | undefined) || b.type}</div></div>;
    case 'column': case 'transclusion_container': case 'tabs': case 'tab':
      return <List ids={b.content} depth={depth} ctx={ctx} />;
    default:
      return (
        <>
          <div className="nc-pad">
            <div className="nc-row">
              <Leaf value={title} />
            </div>
          </div>
          <Children block={b} depth={depth} ctx={ctx} indent />
        </>
      );
  }
}

/** Toggle list item: expanded in the preview, the caret still opens/closes it locally. */
function SnapToggle({ block: b, depth, ctx }: { block: BlockRecord; depth: number; ctx: Ctx }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="nc-pad nc-list-pad">
      <div className="nc-row">
        <div className="nc-list-row">
          <div className="lit-list-item-box-left nc-toggle-btn-box">
            <div role="button" tabIndex={0} aria-label={open ? 'Close' : 'Open'} aria-expanded={open} className="nc-toggle-btn nc-toggle-caret" onClick={() => setOpen(!open)}>
              <ChevronDown size={16} aria-hidden className="nc-toggle-caret-svg" style={{ transform: open ? 'none' : 'rotateZ(-90deg)', opacity: b.content?.length ? undefined : 0.5 }} />
            </div>
          </div>
          <div className="nc-list-body">
            <Leaf value={b.properties?.title as RichText | undefined} />
            {open && <Children block={b} depth={depth} ctx={ctx} indent={false} />}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Page header (cover, icon, title) + body of a snapshot. `changed` = blocks outlined as changed in this version. */
export function SnapshotPage({ rootId, blocks, changed }: { rootId: string; blocks: BlockRecord[]; changed?: Set<string> }) {
  const map = new Map(blocks.map((b) => [b.id, b]));
  const ctx: Ctx = { get: (id) => map.get(id), changed: changed ?? new Set() };
  const root = map.get(rootId);
  if (!root) return null;
  const cover = root.format?.page_cover as string | undefined;
  const icon = root.format?.page_icon as string | undefined;
  const font = (root.format?.page_font as string) ?? 'default';
  return (
    <div className={`nc-snapshot-page font-${font} ${root.format?.page_small_text ? 'small-text' : ''}`}>
      {cover && (
        <div className="nc-snapshot-cover">
          {isImageCover(cover) ? <img src={cover} alt="" style={{ objectPosition: `center ${(1 - ((root.format?.page_cover_position as number) ?? 0.5)) * 100}%` }} /> : <div style={{ ...coverStyle(cover), width: '100%', height: '100%' }} />}
        </div>
      )}
      <div className={`nc-snapshot-content ${cover ? 'with-cover' : ''} ${icon ? 'with-icon' : ''}`}>
        {icon && <div className="nc-snapshot-icon"><PageIcon icon={icon} size={78} /></div>}
        <h1 className={`nc-snapshot-title ${ctx.changed.has(rootId) ? 'nc-vh-changed' : ''}`}>{toPlainText(root.properties?.title) || 'Untitled'}</h1>
        <div className="nc-snapshot-body">
          <List ids={root.content} depth={0} ctx={ctx} />
        </div>
      </div>
    </div>
  );
}

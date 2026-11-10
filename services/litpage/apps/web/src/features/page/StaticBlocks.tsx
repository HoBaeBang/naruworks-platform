// Read-only renderer for a detached set of block records (version-history previews). It reuses the
// editor’s block classes (editor.css) so a snapshot looks like the page without touching the
// global record store (snapshot blocks share ids with live blocks).
import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { renderRichText } from '../editor/richTextDom.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { coverStyle, isImageCover } from './Cover.tsx';

function Rich({ value, className, tag = 'div' }: { value: RichText | undefined; className?: string; tag?: 'div' | 'h2' | 'h3' | 'h4' | 'h5' | 'span' }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (ref.current) renderRichText(ref.current, value ?? []);
  }, [value]);
  const Tag = tag as any;
  return <Tag ref={ref} className={`nc-leaf notranslate ${className ?? ''}`} />;
}

type Lookup = (id: string) => BlockRecord | undefined;

/** blocks changed in the previewed version (outlined) */
let changedSet: Set<string> = new Set();

/** Toggles (and toggle headings) open/close locally; presentation mode starts them closed. */
const ToggleDefault = createContext(true);

function ToggleArrow({ open, onClick }: { open: boolean; onClick: () => void }) {
  return (
    <span role="button" aria-label={open ? 'Close' : 'Open'} aria-expanded={open} className="nc-static-toggle" onClick={onClick}
      style={{ display: 'inline-flex', cursor: 'pointer', fontSize: 12, color: 'var(--lp-icon-primary)', transform: open ? undefined : 'rotate(-90deg)', transition: 'transform 120ms' }}>▼</span>
  );
}

function Children({ ids, get, depth }: { ids: string[] | undefined; get: Lookup; depth: number }) {
  let n = 0;
  return (
    <div className="nc-block-children">
      {(ids ?? []).map((id) => {
        const b = get(id);
        if (!b || b.alive === false) return null;
        n = b.type === 'numbered_list' ? n + 1 : 0;
        return <StaticBlock key={id} block={b} get={get} depth={depth} index={n} />;
      })}
    </div>
  );
}

function StaticBlock({ block: b, get, depth, index }: { block: BlockRecord; get: Lookup; depth: number; index: number }) {
  const title = b.properties?.title as RichText | undefined;
  const color = b.format?.block_color as string | undefined;
  const colorCls = color ? (color.endsWith('_background') ? `lit-bg-${color.replace('_background', '')}` : `lit-color-${color}`) : '';
  const togglable = b.type === 'toggle' || (!!b.format?.toggleable && ['header', 'sub_header', 'sub_sub_header', 'header_4'].includes(b.type));
  const defaultOpen = useContext(ToggleDefault);
  const [open, setOpen] = useState(defaultOpen);
  const showKids = !togglable || open;
  const kids = showKids && b.content?.length && b.type !== 'page' && b.type !== 'collection_view_page' ? <div style={{ paddingInlineStart: 24 }}><Children ids={b.content} get={get} depth={depth + 1} /></div> : null;
  const wrap = (inner: React.ReactNode, cls = '') => (
    <div className={`lit-selectable lit-${b.type}-block ${cls} ${changedSet.has(b.id) ? 'nc-vh-changed' : ''}`} data-snapshot-block-id={b.id}>
      <div className={`nc-pad ${colorCls}`}>{inner}</div>
      {kids}
    </div>
  );
  switch (b.type) {
    case 'header': case 'sub_header': case 'sub_sub_header': case 'header_4':
      return wrap(togglable
        ? <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ToggleArrow open={open} onClick={() => setOpen((x) => !x)} /><Rich value={title} tag={b.type === 'header' ? 'h2' : b.type === 'sub_header' ? 'h3' : 'h4'} className={`nc-heading nc-${b.type}`} /></div>
        : <Rich value={title} tag={b.type === 'header' ? 'h2' : b.type === 'sub_header' ? 'h3' : 'h4'} className={`nc-heading nc-${b.type}`} />);
    case 'bulleted_list': case 'numbered_list': case 'to_do': case 'toggle': {
      const checked = toPlainText(b.properties?.checked as RichText | undefined) === 'Yes';
      const marker = b.type === 'bulleted_list' ? <span className="nc-bullet">{['•', '◦', '▪'][depth % 3]}</span>
        : b.type === 'numbered_list' ? <span className="pseudoBefore">{index || 1}.</span>
          : b.type === 'to_do' ? <div className={`nc-checkbox ${checked ? 'checked' : ''}`}>{checked && <Check size={12} strokeWidth={2.5} />}</div>
            : <ToggleArrow open={open} onClick={() => setOpen((x) => !x)} />;
      return (
        <div className={`lit-selectable lit-${b.type}-block ${changedSet.has(b.id) ? 'nc-vh-changed' : ''}`} data-snapshot-block-id={b.id}>
          <div className={`nc-pad ${colorCls}`}>
            <div className="nc-list-row">
              <div className={`lit-list-item-box-left ${b.type === 'numbered_list' ? 'nc-number' : ''}`}>{marker}</div>
              <div className="nc-list-body">
                <Rich value={title} className={b.type === 'to_do' && checked ? 'nc-checked' : ''} />
              </div>
            </div>
          </div>
          {kids}
        </div>
      );
    }
    case 'quote':
      return wrap(<div style={{ borderInlineStart: '3px solid currentColor', paddingInlineStart: 14 }}><Rich value={title} /></div>);
    case 'callout':
      return wrap(
        <div style={{ display: 'flex', gap: 8, padding: '16px 16px 16px 12px', borderRadius: 10, background: color ? undefined : 'var(--lp-gray-bg-secondary, #d4d4d8)' }}>
          <PageIcon icon={(b.format?.page_icon as string) ?? '💡'} size={22} />
          <div style={{ flex: 1, minWidth: 0 }}><Rich value={title} /><Children ids={b.content} get={get} depth={depth + 1} /></div>
        </div>,
      );
    case 'divider':
      return wrap(<div style={{ height: 1, background: 'var(--lp-border-primary)', margin: '6px 0' }} />);
    case 'code':
      return wrap(<pre style={{ margin: 0, padding: '32px 16px 32px 32px', borderRadius: 10, background: 'var(--lp-bg-secondary, #09090b)', fontFamily: 'var(--font-mono, monospace)', fontSize: 14, whiteSpace: 'pre-wrap' }}>{toPlainText(title)}</pre>);
    case 'equation':
      return wrap(<div style={{ textAlign: 'center', fontFamily: 'KaTeX_Main, serif', padding: 8 }}>{toPlainText(title)}</div>);
    case 'image': {
      const src = toPlainText(b.properties?.source as RichText | undefined) || (b.format?.display_source as string) || '';
      return wrap(src ? <img src={src} alt="" style={{ maxWidth: '100%', borderRadius: 4, display: 'block' }} /> : <div className="nc-static-placeholder">Image</div>);
    }
    case 'page': case 'collection_view_page': case 'link_to_page': case 'alias':
      return wrap(
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500, textDecoration: 'underline', textDecorationColor: 'var(--lp-border-primary-transparent)' }}>
          <PageIcon block={b} size={20} />
          <span>{toPlainText(b.properties?.title) || 'Untitled'}</span>
        </div>,
      );
    case 'column_list':
      return (
        <div className="lit-selectable lit-column_list-block" style={{ display: 'flex', gap: 46 }}>
          {(b.content ?? []).map((id) => {
            const col = get(id);
            return col ? <div key={id} style={{ flex: (col.format?.column_ratio as number | undefined) ?? 1, minWidth: 0 }}><Children ids={col.content} get={get} depth={depth} /></div> : null;
          })}
        </div>
      );
    case 'table': {
      const order = (b.format?.table_block_column_order as string[] | undefined) ?? [];
      return wrap(
        <table className="nc-static-table">
          <tbody>
            {(b.content ?? []).map((id) => {
              const r = get(id);
              if (!r) return null;
              const cols = order.length ? order : Object.keys(r.properties ?? {});
              return <tr key={id}>{cols.map((k) => <td key={k}><Rich value={r.properties?.[k] as RichText | undefined} /></td>)}</tr>;
            })}
          </tbody>
        </table>,
      );
    }
    case 'collection_view':
      return wrap(<div className="nc-static-placeholder">Database</div>);
    case 'video': case 'audio': case 'file': case 'pdf': case 'bookmark': case 'embed':
      return wrap(<div className="nc-static-placeholder">{toPlainText(b.properties?.title) || toPlainText(b.properties?.source as RichText | undefined) || b.type}</div>);
    case 'column': case 'transclusion_container': case 'tabs': case 'tab':
      return <Children ids={b.content} get={get} depth={depth} />;
    default:
      return wrap(<Rich value={title} />);
  }
}

/** Read-only list of blocks resolved through `get` (live records or a snapshot). `togglesClosed`: toggles start closed. */
export function StaticBlockList({ ids, get, togglesClosed }: { ids: string[]; get: (id: string) => BlockRecord | undefined; togglesClosed?: boolean }) {
  return (
    <ToggleDefault.Provider value={!togglesClosed}>
      <Children ids={ids} get={get} depth={0} />
    </ToggleDefault.Provider>
  );
}

/** Page header + body of a snapshot. */
export function StaticPage({ rootId, blocks, changed }: { rootId: string; blocks: BlockRecord[]; changed?: Set<string> }) {
  changedSet = changed ?? new Set();
  const map = new Map(blocks.map((b) => [b.id, b]));
  const get: Lookup = (id) => map.get(id);
  const root = map.get(rootId);
  if (!root) return null;
  const cover = root.format?.page_cover as string | undefined;
  const icon = root.format?.page_icon as string | undefined;
  const font = (root.format?.page_font as string) ?? 'default';
  return (
    <div className={`nc-static-page font-${font} ${root.format?.page_small_text ? 'small-text' : ''}`}>
      {cover && (
        <div className="nc-static-cover">
          {isImageCover(cover) ? <img src={cover} alt="" style={{ objectPosition: `center ${((root.format?.page_cover_position as number) ?? 0.5) * 100}%` }} /> : <div style={{ ...coverStyle(cover), width: '100%', height: '100%' }} />}
        </div>
      )}
      <div className={`nc-static-content ${root.format?.page_full_width ? 'wide' : ''}`}>
        {icon && <div className="nc-static-icon" style={{ marginTop: cover ? -42 : 64 }}><PageIcon icon={icon} size={78} /></div>}
        <h1 className={`nc-static-title ${changedSet.has(rootId) ? 'nc-vh-changed' : ''}`} style={{ marginTop: icon ? 8 : cover ? 24 : 80 }}>{toPlainText(root.properties?.title) || 'Untitled'}</h1>
        <div className="lit-page-content" style={{ paddingTop: 8 }}>
          <Children ids={root.content} get={get} depth={0} />
        </div>
      </div>
    </div>
  );
}

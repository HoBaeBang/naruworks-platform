// Text-like blocks: text, headings (incl. toggle headings 1–4), lists (bulleted, numbered, to-do, toggle),
// quote and divider. DOM structure and metrics follow the editor layout rules.

// Callout, code and page links live in their own *.block.tsx modules.
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { BlockRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { HEADING_TYPES } from '@nc/shared/blocks.ts';
import { registerBlock, BlockChildren, type BlockProps } from '../Block.tsx';
import { RichTextEditable } from '../RichTextEditable.tsx';
import { makeTextHandlers, toggleTodo } from '../textHandlers.ts';
import { useCommenterSuggesting } from '../../comments/suggest.ts';
import { isOpen, setOpen, appendToPage } from '../commands.ts';
import { Icon } from '../../../components/Icon.tsx';
import type { MenuItemDef } from '../../../components/Menu.tsx';
import { records } from '../../../lib/store/records.ts';
import { createBlockIn, getBlock, run, setFormat } from '../../../lib/blocks.ts';
import { useEditor } from '../editorState.ts';
import { registerBlockMenu, overrideSlashItem } from './registry.ts';
import { createToggleHeading } from './factories.ts';
import { PREF, setPref } from '../prefs.ts';
import './icons.tsx';
import './blocks.css';

const PLACEHOLDER: Record<string, string> = {
  text: 'Press ‘space’ for AI or ‘/’ to open commands',
  header: 'Heading 1',
  sub_header: 'Heading 2',
  sub_sub_header: 'Heading 3',
  header_4: 'Heading 4',
  bulleted_list: 'List',
  numbered_list: 'List',
  to_do: 'To-do',
  toggle: 'Toggle',
  quote: 'Empty quote',
  callout: 'Type something…',
};

const HEADING_TAG: Record<string, 'h2' | 'h3' | 'h4' | 'h5'> = { header: 'h2', sub_header: 'h3', sub_sub_header: 'h4', header_4: 'h5' };
/** line heights of H1–H4 leaves (30/39, 24/31.2, 20/26, 18/23.4) used to center the toggle caret */
const HEADING_LH: Record<string, number> = { header: 39, sub_header: 31.2, sub_sub_header: 26, header_4: 23.4 };

export function useToggleOpen(blockId: string): [boolean, (v: boolean) => void] {
  const [open, setOpenState] = useState(() => isOpen(blockId));
  useEffect(() => {
    setOpenState(isOpen(blockId));
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d.blockId === blockId) setOpenState(d.open);
    };
    window.addEventListener('nc:toggle', on);
    return () => window.removeEventListener('nc:toggle', on);
  }, [blockId]);
  return [open, (v) => setOpen(blockId, v)];
}

export function Leaf({ block, readOnly, tag, className, placeholderAlways, placeholder }: { block: BlockRecord; readOnly: boolean; tag?: any; className?: string; placeholderAlways?: boolean; placeholder?: string }) {
  const handlers = useMemo(() => makeTextHandlers(block.id), [block.id]);
  // commenters suggest edits: their text, to-do, heading and list text stays editable as suggestions
  const suggesting = useCommenterSuggesting(block);
  readOnly = readOnly && !suggesting;
  return (
    <RichTextEditable
      blockId={block.id}
      value={block.properties?.title as RichText | undefined}
      readOnly={readOnly}
      tagName={tag}
      className={`content-editable-leaf-rtl nc-leaf ${className ?? ''}`}
      placeholder={placeholder ?? PLACEHOLDER[block.type]}
      placeholderAlways={placeholderAlways}
      onChange={handlers.onChange}
      onKeyDown={handlers.onKeyDown}
      onPaste={handlers.onPaste}
    />
  );
}

function TextBlock({ block, depth, readOnly }: BlockProps) {
  return (
    <>
      <div className="nc-pad">
        <div className="nc-row">
          <Leaf block={block} readOnly={readOnly} />
        </div>
      </div>
      <BlockChildren block={block} depth={depth} readOnly={readOnly} />
    </>
  );
}

function HeadingBlock({ block, depth, readOnly }: BlockProps) {
  const toggleable = !!block.format?.toggleable;
  const [open, setOpenV] = useToggleOpen(block.id);
  // toggle-heading children sit inside the padded box; the padding wraps the leaf and its children
  return (
    <div className="nc-pad">
      <div className="nc-row">
        {toggleable && <ToggleTriangle open={open} onToggle={() => setOpenV(!open)} lineHeight={HEADING_LH[block.type]} empty={!block.content?.length} />}
        <Leaf block={block} readOnly={readOnly} tag={HEADING_TAG[block.type]} className={`nc-heading nc-${block.type}`} placeholderAlways />
      </div>
      {toggleable && open && (
        block.content?.length ? <div className="nc-toggle-heading-children"><BlockChildren block={block} depth={depth} readOnly={readOnly} indent={false} /></div> : <EmptyToggle blockId={block.id} readOnly={readOnly} heading />
      )}
    </div>
  );
}

/** Disclosure caret: 24×24 r4 button; a 0.8em (12.8px) filled down caret in the * text color (fill: inherit), rotated -90° while closed, at 50% opacity when the toggle has no children. */
export function ToggleTriangle({ open, onToggle, lineHeight, empty }: { open: boolean; onToggle: () => void; lineHeight?: number; empty?: boolean }) {
  // headings: box equals leaf line height, with margin 2px 0 0 2px; the button is centered
  const style = lineHeight ? { height: lineHeight, minHeight: 0, margin: '2px 0 0 2px', padding: 0 } : undefined;
  return (
    <div className="lit-list-item-box-left nc-toggle-btn-box" style={style}>
      <div
        role="button"
        tabIndex={0}
        aria-label={open ? 'Close' : 'Open'}
        aria-expanded={open}
        className="nc-toggle-btn nc-toggle-caret"
        onMouseDown={(e) => e.preventDefault()}
        onClick={onToggle}
      >
        <ChevronDown size={16} aria-hidden className="nc-toggle-caret-svg" style={{ transform: open ? 'none' : 'rotateZ(-90deg)', opacity: empty ? 0.5 : undefined }} />
      </div>
    </div>
  );
}

/** "Empty toggle. Click or drop blocks here." (16px/24px texTer, role=button r4, 8px padding). */
export function EmptyToggle({ blockId, readOnly, heading, label }: { blockId: string; readOnly: boolean; heading?: boolean; label?: string }) {
  return (
    <div className={`nc-empty-toggle-wrap ${heading ? 'heading' : ''}`}>
      <div
        className="nc-empty-toggle-2"
        role="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (readOnly) return;
          let id = '';
          run('emptyToggle.add', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: blockId, parentTable: 'block' }); });
          useEditor.getState().requestFocus(id, 0);
        }}
      >
        {label ?? 'Empty toggle. Click or drop blocks here.'}
      </div>
    </div>
  );
}

function bulletGlyph(depth: number, fmt?: string) {
  if (fmt === 'disc') return '•';
  if (fmt === 'circle') return '◦';
  if (fmt === 'square') return '▪';
  return ['•', '◦', '▪'][depth % 3];
}

/** First item of the consecutive run of `type` items that contains `id` (where the list format lives). */
function runStart(id: string, type: string): string {
  const b = getBlock(id);
  const p = b ? getBlock(b.parent_id) : undefined;
  const sibs = (p?.content ?? []) as string[];
  let i = sibs.indexOf(id);
  while (i > 0 && getBlock(sibs[i - 1])?.type === type && getBlock(sibs[i - 1])?.alive !== false) i--;
  return sibs[i] ?? id;
}

/** “List format” uses numbers, letters, or Roman numerals for numbered lists and disc, circle, or square for bulleted lists; stored as format.list_format on the first item of the list. */
function listFormatItem(block: BlockRecord): MenuItemDef {
  const numbered = block.type === 'numbered_list';
  const first = runStart(block.id, block.type);
  const cur = (getBlock(first)?.format?.list_format as string | undefined) ?? '';
  const options: [string, string][] = numbered
    ? [['numbers', 'Numbers'], ['letters', 'Letters'], ['roman', 'Roman numerals']]
    : [['disc', 'Disc'], ['circle', 'Circle'], ['square', 'Square']];
  return {
    label: 'List format', icon: numbered ? 'listNumber' : 'listBullet',
    submenu: () => ({
      width: 200, role: 'menu',
      sections: [{ items: [
        { label: 'Default', checked: !cur, onSelect: () => run('blockActions.listFormat', (tx) => setFormat(tx, first, { list_format: undefined } as any)) },
        ...options.map(([v, label]) => ({ label, checked: cur === v, onSelect: () => run('blockActions.listFormat', (tx) => setFormat(tx, first, { list_format: v } as any)) })),
      ] }],
    }),
  };
}

function numberLabel(n: number, depth: number, fmt?: string) {
  const level = fmt === 'letters' ? 1 : fmt === 'roman' ? 2 : fmt === 'numbers' ? 0 : depth % 3;
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

function listDepth(block: BlockRecord, type: string): number {
  let d = 0;
  let cur = getBlock(block.parent_id);
  while (cur && cur.parent_table === 'block' && cur.type === type) {
    d++;
    cur = getBlock(cur.parent_id);
  }
  return d;
}

function ListItem({ block, depth, readOnly, index, siblings }: BlockProps) {
  const [open, setOpenV] = useToggleOpen(block.id);
  let marker: React.ReactNode = null;
  if (block.type === 'bulleted_list') {
    let bfmt = block.format?.list_format as string | undefined;
    for (let i = index - 1; i >= 0 && !bfmt; i--) {
      const s = records.get<BlockRecord>('block', siblings[i]);
      if (s?.type !== 'bulleted_list') break;
      if (s.format?.list_format) bfmt = s.format.list_format as string;
    }
    marker = <div className="lit-list-item-box-left"><div className="pseudoBefore nc-bullet"><span className="g">{bulletGlyph(listDepth(block, 'bulleted_list'), bfmt)}</span></div></div>;
  } else if (block.type === 'numbered_list') {
    // number = position within the consecutive run of numbered items (+ start index of the first)
    let n = 1;
    let start = 1;
    let fmt = block.format?.list_format as string | undefined;
    for (let i = index - 1; i >= 0; i--) {
      const s = records.get<BlockRecord>('block', siblings[i]);
      if (s?.type !== 'numbered_list') break;
      n++;
      if (s.format?.list_start_index) start = s.format.list_start_index;
      if (s.format?.list_format) fmt = s.format.list_format as string;
    }
    if (n === 1 && block.format?.list_start_index) start = block.format.list_start_index;
    marker = <div className="lit-list-item-box-left nc-num-marker"><span className="pseudoBefore">{numberLabel(start + n - 1, listDepth(block, 'numbered_list'), fmt)}.</span></div>;
  } else if (block.type === 'to_do') {
    const checked = block.properties?.checked?.[0]?.[0] === 'Yes';
    marker = (
      <div className="lit-list-item-box-left nc-todo-box">
        <div role="checkbox" aria-checked={checked} className={`nc-checkbox ${checked ? 'checked' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => !readOnly && toggleTodo(block.id)}>
          {checked && <Icon name="check" size={12} strokeWidth={3} style={{ color: '#fff' }} />}
        </div>
      </div>
    );
  } else if (block.type === 'toggle') {
    marker = <ToggleTriangle open={open} onToggle={() => setOpenV(!open)} empty={!block.content?.length} />;
  }
  const checked = block.type === 'to_do' && block.properties?.checked?.[0]?.[0] === 'Yes';
  const showKids = block.type !== 'toggle' || open;
  return (
    <div className="nc-pad nc-list-pad">
      <div className="nc-row">
        <div className="nc-list-row">
          {marker}
          <div className="nc-list-body">
            <Leaf block={block} readOnly={readOnly} className={checked ? 'nc-checked' : ''} />
            {showKids && (block.type === 'toggle' && !block.content?.length ? <EmptyToggle blockId={block.id} readOnly={readOnly} /> : <BlockChildren block={block} depth={depth} readOnly={readOnly} indent={false} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Quote: 3px left rule (currentColor), wrapper padding 0 14px, leaf padding 0 8px; Large = 19.2px/28.8px. */
function QuoteBlock({ block, depth, readOnly }: BlockProps) {
  const large = block.format?.quote_size === 'large';
  return (
    <div className="nc-bpad">
      <div className={`nc-quote-2 ${large ? 'large' : ''}`}>
        <Leaf block={block} readOnly={readOnly} className="nc-quote-leaf" />
        <BlockChildren block={block} depth={depth} readOnly={readOnly} indent={false} />
      </div>
    </div>
  );
}

/** Divider: block box 13px with no padding; inner flex row 13px tall, padding-inline 8px, holding the 1px var(--lp-border-primary-transparent) line (role=separator). */
function DividerBlock() {
  return (
    <div className="nc-divider lit-cursor-default">
      <div role="separator" className="nc-divider-line" />
    </div>
  );
}

registerBlock(['text'], TextBlock);
registerBlock(['header', 'sub_header', 'sub_sub_header', 'header_4'], HeadingBlock);
registerBlock(['bulleted_list', 'numbered_list', 'to_do', 'toggle'], ListItem);
registerBlock(['quote'], QuoteBlock);
registerBlock(['divider'], DividerBlock);

// Quote menu: Turn into, Color, Quote size ▸ Default | Large
registerBlockMenu(['numbered_list', 'bulleted_list'], ({ ids, block, turnInto, color }) => (ids.length === 1 ? [turnInto, color, listFormatItem(block)] : [turnInto, color]));

registerBlockMenu(['quote'], ({ ids, block, turnInto, color }) => [
  turnInto,
  color,
  {
    label: 'Quote size', icon: 'quoteText',
    submenu: () => ({
      width: 220,
      sections: [{
        items: (['default', 'large'] as const).map((s) => ({
          label: s === 'default' ? 'Default' : 'Large',
          checked: (block.format?.quote_size ?? 'default') === s,
          onSelect: () => {
            run('actionRegistry.createQuoteSizeAction', (tx) => { for (const id of ids) setFormat(tx, id, { quote_size: s === 'large' ? 'large' : undefined }); });
            setPref(PREF.quoteSize, s); // QuoteBlockDefaultSize: new quotes on this device use it
          },
        })),
      }],
    }),
  },
]);

export { appendToPage, HEADING_TYPES };

// Toggle headings 1–3 from the slash menu are created closed
overrideSlashItem('toggle-h1', (ctx) => createToggleHeading(ctx, 'header'));
overrideSlashItem('toggle-h2', (ctx) => createToggleHeading(ctx, 'sub_header'));
overrideSlashItem('toggle-h3', (ctx) => createToggleHeading(ctx, 'sub_sub_header'));

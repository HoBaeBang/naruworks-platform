// Expanded cell editor for text / title / number / url / email / phone (overlays the cell:
// same left/top as the cell, at least the cell width, grows with content).
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { encodeNumber, encodeText, formatNumber, getPropertyValue, parseNumberInput } from '@nc/shared/database/index.ts';
import { records } from '../../../../lib/store/records.ts';
import { getBlock } from '../../../../lib/blocks.ts';
import { openOverlay } from '../../../../components/overlay.tsx';
import { RichTextEditable } from '../../../editor/RichTextEditable.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { setValue, setValues } from '../../actions.ts';
import { makeQueryContext } from '../../data.ts';
import type { CellEditorOptions } from '../editorRegistry.ts';

function RichCellEditor({ rowId, propId, close, minWidth, minHeight, allRows }: { rowId: string; propId: string; close: () => void; minWidth: number; minHeight: number; allRows: string[] }) {
  const row = getBlock(rowId);
  const [value, setVal] = useState<RichText>(((propId === 'title' ? row?.properties?.title : row?.properties?.[propId]) as RichText | undefined) ?? []);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('[contenteditable]');
    if (!el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, []);
  return (
    <div ref={ref} className="nc-cell-editor" style={{ minWidth, minHeight }}>
      <RichTextEditable
        blockId={rowId}
        property={propId}
        value={value}
        className="nc-cell-editor-leaf"
        placeholder=""
        onChange={(next) => {
          setVal(next);
          if (allRows.length > 1) setValues(allRows, propId, next.length ? next : undefined);
          else setValue(rowId, propId, next.length ? next : propId === 'title' ? [] : undefined, { coalesce: `cell:${rowId}:${propId}` });
        }}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
    </div>
  );
}

function PlainCellEditor({ rowIds, prop, propId, close, minWidth, minHeight }: { rowIds: string[]; prop: PropertySchema; propId: string; close: () => void; minWidth: number; minHeight: number }) {
  const row = getBlock(rowIds[0]);
  const ctx = makeQueryContext();
  const c = records.get<CollectionRecord>('collection', row?.parent_id);
  const v = row && c ? getPropertyValue(row, propId, c.schema, ctx) : null;
  const initial = v?.kind === 'number' ? (v.number === null ? '' : String(v.number)) : v?.kind === 'text' ? v.text : '';
  const [text, setTextState] = useState(initial);
  // the unmount cleanup commits — read the latest text through a ref (the effect closure is from the first render)
  const textRef = useRef(initial);
  const setText = (t: string) => {
    textRef.current = t;
    setTextState(t);
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const saved = useRef(initial);
  const commit = () => {
    const text = textRef.current;
    if (text === saved.current) return;
    saved.current = text;
    let raw: RichText | undefined;
    if (prop.type === 'number') {
      const n = parseNumberInput(text);
      raw = encodeNumber(n);
    } else raw = encodeText(text.trim() ? text : '');
    if (rowIds.length > 1) setValues(rowIds, propId, raw);
    else setValue(rowIds[0], propId, raw);
  };
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const isLink = prop.type === 'url' || prop.type === 'email' || prop.type === 'phone_number';
  const href = prop.type === 'email' ? `mailto:${text}` : prop.type === 'phone_number' ? `tel:${text}` : /^[a-z]+:/i.test(text) ? text : `https://${text}`;
  return (
    <div className="nc-cell-editor plain" style={{ minWidth, minHeight }}>
      <input
        ref={inputRef}
        className="nc-cell-editor-input"
        value={text}
        inputMode={prop.type === 'number' ? 'decimal' : prop.type === 'phone_number' ? 'tel' : undefined}
        placeholder={prop.type === 'url' ? 'Type or paste in a link…' : prop.type === 'email' ? 'Enter an email…' : prop.type === 'phone_number' ? 'Type a phone number…' : prop.type === 'number' ? '' : ''}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            close();
          }
        }}
      />
      {isLink && text.trim() && (
        <a className="nc-cell-editor-open" href={href} target="_blank" rel="noreferrer" data-tooltip={prop.type === 'email' ? 'Send email' : prop.type === 'phone_number' ? 'Call' : 'Open link'}>
          <Icon name={prop.type === 'email' ? 'mail' : prop.type === 'phone_number' ? 'phone' : 'arrowDiagonalUpRightSmall'} size={14} />
        </a>
      )}
      {prop.type === 'number' && text && parseNumberInput(text) !== null && prop.number_format && prop.number_format !== 'number' && (
        <span className="nc-cell-editor-preview">{formatNumber(parseNumberInput(text), prop.number_format as string)}</span>
      )}
    </div>
  );
}

export function openTextEditor(anchor: HTMLElement, opts: CellEditorOptions): () => void {
  const c = records.get<CollectionRecord>('collection', opts.collectionId);
  const prop = c?.schema[opts.propId];
  if (!c || !prop) return () => {};
  const rect = anchor.getBoundingClientRect();
  const rich = prop.type === 'text' || prop.type === 'title';
  return openOverlay(
    (close) =>
      rich ? (
        <RichCellEditor rowId={opts.rowIds[0]} allRows={opts.rowIds} propId={opts.propId} close={close} minWidth={Math.max(rect.width, 240)} minHeight={rect.height} />
      ) : (
        <PlainCellEditor rowIds={opts.rowIds} prop={prop} propId={opts.propId} close={close} minWidth={Math.max(rect.width, 240)} minHeight={rect.height} />
      ),
    { anchor: new DOMRect(rect.left, rect.top, rect.width, 0), placement: 'bottom-start', offset: 0, onClose: opts.onClose, className: 'nc-cell-editor-overlay' },
  );
}

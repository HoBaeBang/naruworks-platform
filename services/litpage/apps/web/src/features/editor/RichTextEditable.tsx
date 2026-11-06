// A contenteditable leaf bound to a rich-text value (one block property).
// - Renders decorations itself (no React children) so the browser owns the caret while typing.
// - Folds input back into the model as a text diff; skips work during IME composition (Korean etc.).
// - Re-renders canonically when the DOM drifts from the model, restoring the caret by offset.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { annotationsAt, deleteRange, equals, insertText, length, toPlainText, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import { mapTextOffset } from '@nc/shared/textmerge.ts';
import { canonicalHTML, domText, getSelectionOffsets, renderRichText, setSelectionOffsets, caretLine, offsetAtX, caretRect } from './richTextDom.ts';
import { useEditor } from './editorState.ts';
import { transactions } from '../../lib/store/transactions.ts';

export interface LeafApi {
  el: HTMLElement;
  value: () => RichText;
  selection: () => { start: number; end: number } | null;
  setSelection: (start: number, end?: number) => void;
  isCollapsed: () => boolean;
  atStart: () => boolean;
  atEnd: () => boolean;
  caretLine: () => { first: boolean; last: boolean; x: number };
  caretRect: () => DOMRect;
  /** pending marks for the next typed text (Cmd+B with a collapsed caret) */
  setPendingMarks: (anns: Annotation[] | null) => void;
}

export interface RichTextEditableProps {
  blockId: string;
  property?: string;
  value: RichText | undefined;
  placeholder?: string;
  /** show the placeholder even when not focused (headings, title) */
  placeholderAlways?: boolean;
  readOnly?: boolean;
  tagName?: 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'span';
  className?: string;
  style?: CSSProperties;
  spellCheck?: boolean;
  /** custom renderer (e.g. syntax highlighting); text content must equal the plain text */
  renderer?: (el: HTMLElement, value: RichText) => void;
  /** `prev` is the value this edit was computed from (the splice base, which may lag behind remote updates). */
  onChange: (next: RichText, info: { caret: number; inserted: string; inputType: string; prev: RichText }) => void;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLElement>, api: LeafApi) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLElement>, api: LeafApi) => void;
  onFocus?: (api: LeafApi) => void;
  onBlur?: () => void;
  onSelect?: (api: LeafApi) => void;
}

export const RichTextEditable = forwardRef<LeafApi, RichTextEditableProps>(function RichTextEditable(props, ref) {
  const { blockId, property = 'title', value, placeholder, placeholderAlways, readOnly, tagName = 'div', className, style, spellCheck = true } = props;
  const elRef = useRef<HTMLElement>(null);
  const lastValue = useRef<RichText>(value ?? []);
  const composing = useRef(false);
  const pendingMarks = useRef<Annotation[] | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;
  const render = (el: HTMLElement, v: RichText) => {
    if (propsRef.current.renderer) {
      propsRef.current.renderer(el, v);
      ensureTrailingBreak(el, v);
    } else renderRichText(el, v);
  };
  const canonical = (v: RichText) => {
    if (!propsRef.current.renderer) return canonicalHTML(v);
    const d = document.createElement('div');
    propsRef.current.renderer(d, v);
    ensureTrailingBreak(d, v);
    return d.innerHTML;
  };

  const api: LeafApi = useCallback(
    () => ({
      get el() {
        return elRef.current!;
      },
      value: () => lastValue.current,
      selection: () => (elRef.current ? getSelectionOffsets(elRef.current) : null),
      setSelection: (start: number, end?: number) => elRef.current && setSelectionOffsets(elRef.current, start, end ?? start),
      isCollapsed: () => {
        const s = elRef.current ? getSelectionOffsets(elRef.current) : null;
        return !s || s.start === s.end;
      },
      atStart: () => {
        const s = elRef.current ? getSelectionOffsets(elRef.current) : null;
        return !!s && s.start === 0 && s.end === 0;
      },
      atEnd: () => {
        const s = elRef.current ? getSelectionOffsets(elRef.current) : null;
        return !!s && s.start === s.end && s.end === length(lastValue.current);
      },
      caretLine: () => caretLine(elRef.current!),
      caretRect: () => caretRect(elRef.current!),
      setPendingMarks: (anns: Annotation[] | null) => {
        pendingMarks.current = anns;
      },
    }),
    [],
  )() as LeafApi;
  const apiRef = useRef(api);
  useImperativeHandle(ref, () => apiRef.current, []);

  // initial + external value changes → render (never while composing)
  useLayoutEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const v = value ?? [];
    if (composing.current) return;
    if (el.childNodes.length === 0 && v.length === 0) {
      lastValue.current = v;
      return;
    }
    if (equals(v, lastValue.current) && el.innerHTML === canonical(v)) return;
    const focused = document.activeElement === el;
    const sel = focused ? getSelectionOffsets(el) : null;
    const prevPlain = toPlainText(lastValue.current);
    lastValue.current = v;
    render(el, v);
    if (focused && sel) {
      // keep the caret next to the same characters when someone else edited this block
      const len = length(v);
      const nextPlain = toPlainText(v);
      const start = mapTextOffset(prevPlain, nextPlain, sel.start, 'start');
      const end = sel.end === sel.start ? start : mapTextOffset(prevPlain, nextPlain, sel.end, 'end');
      setSelectionOffsets(el, Math.min(start, len), Math.min(Math.max(start, end), len));
    }
  });

  // focus requests addressed to this leaf
  const focusRequest = useEditor((s) => s.focusRequest);
  useLayoutEffect(() => {
    const req = focusRequest;
    const el = elRef.current;
    if (!req || !el || req.blockId !== blockId || (req.property ?? 'title') !== property) return;
    useEditor.setState({ focusRequest: null });
    el.focus({ preventScroll: true });
    const len = length(lastValue.current);
    let start: number;
    if (req.line && req.x !== undefined) start = offsetAtX(el, req.x, req.line);
    else start = req.offset === 'end' ? len : req.offset === 'start' ? 0 : Math.min(req.offset, len);
    const end = req.end !== undefined ? Math.min(req.end, len) : start;
    setSelectionOffsets(el, start, end);
    pendingMarks.current = req.marks ?? null;
    scrollIntoViewIfNeeded(el);
  }, [focusRequest, blockId, property]);

  const commitFromDom = (inputType: string) => {
    const el = elRef.current;
    if (!el) return;
    const prev = lastValue.current;
    const prevText = toPlainText(prev);
    const nextText = domText(el);
    if (nextText === prevText) {
      // structure-only drift (e.g. browser wrapped text) → re-render canonical
      if (el.innerHTML !== canonical(prev)) {
        const sel = getSelectionOffsets(el);
        render(el, prev);
        if (sel) setSelectionOffsets(el, sel.start, sel.end);
      }
      return;
    }
    // common prefix/suffix diff
    let p = 0;
    const max = Math.min(prevText.length, nextText.length);
    while (p < max && prevText[p] === nextText[p]) p++;
    let s = 0;
    while (s < max - p && prevText[prevText.length - 1 - s] === nextText[nextText.length - 1 - s]) s++;
    const removedEnd = prevText.length - s;
    const inserted = nextText.slice(p, nextText.length - s);
    let next = deleteRange(prev, p, removedEnd);
    if (inserted) {
      const marks = pendingMarks.current ?? annotationsAt(prev, p);
      pendingMarks.current = null;
      next = insertText(next, p, inserted, marks);
    }
    lastValue.current = next;
    const caret = p + inserted.length;
    if (el.innerHTML !== canonical(next)) {
      const sel = getSelectionOffsets(el);
      render(el, next);
      setSelectionOffsets(el, sel ? sel.start : caret, sel ? sel.end : caret);
    }
    propsRef.current.onChange(next, { caret, inserted, inputType, prev });
  };

  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onBeforeInput = (e: InputEvent) => {
      const t = e.inputType;
      if (t.startsWith('format') || t === 'historyUndo' || t === 'historyRedo' || t === 'insertParagraph' || t === 'insertLineBreak') {
        e.preventDefault();
      }
    };
    const onInput = (e: Event) => {
      if (composing.current || (e as InputEvent).isComposing) return;
      commitFromDom((e as InputEvent).inputType ?? 'insertText');
    };
    const onCompStart = () => {
      composing.current = true;
    };
    const onCompEnd = () => {
      composing.current = false;
      commitFromDom('insertCompositionText');
    };
    el.addEventListener('beforeinput', onBeforeInput);
    el.addEventListener('input', onInput);
    el.addEventListener('compositionstart', onCompStart);
    el.addEventListener('compositionend', onCompEnd);
    return () => {
      el.removeEventListener('beforeinput', onBeforeInput);
      el.removeEventListener('input', onInput);
      el.removeEventListener('compositionstart', onCompStart);
      el.removeEventListener('compositionend', onCompEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onSel = () => {
      const el = elRef.current;
      if (!el || document.activeElement !== el) return;
      const s = getSelectionOffsets(el);
      if (s) useEditor.setState({ caret: { start: s.start, end: s.end } });
      propsRef.current.onSelect?.(apiRef.current);
    };
    document.addEventListener('selectionchange', onSel);
    return () => document.removeEventListener('selectionchange', onSel);
  }, []);

  const Tag = tagName as any;
  const empty = !value || length(value) === 0;
  return (
    <Tag
      ref={elRef}
      className={`notranslate ${className ?? ''}`}
      style={style}
      role="textbox"
      spellCheck={spellCheck}
      data-content-editable-leaf="true"
      data-block-id={blockId}
      data-property={property}
      contentEditable={readOnly ? false : 'plaintext-only'}
      suppressContentEditableWarning
      placeholder={placeholder}
      data-empty={empty && (placeholderAlways ? 'true' : undefined)}
      data-placeholder-always={placeholderAlways ? 'true' : undefined}
      onKeyDown={(e: ReactKeyboardEvent<HTMLElement>) => {
        if (e.nativeEvent.isComposing || composing.current) return;
        propsRef.current.onKeyDown?.(e, apiRef.current);
        // every leaf, including page titles, table cells, and comments, gets Litpage undo/redo; the browser’s native
        // contenteditable history is disabled in beforeinput
        if (!e.defaultPrevented && (e.metaKey || e.ctrlKey) && !e.altKey) {
          const k = e.key.toLowerCase();
          if (k === 'z' || (k === 'y' && e.ctrlKey && !e.metaKey)) {
            e.preventDefault();
            if (k === 'y' || e.shiftKey) transactions.redo();
            else transactions.undo();
          }
        }
      }}
      onPaste={(e: React.ClipboardEvent<HTMLElement>) => {
        if (propsRef.current.onPaste) propsRef.current.onPaste(e, apiRef.current);
      }}
      onFocus={() => {
        useEditor.setState({ focused: { blockId, property } });
        propsRef.current.onFocus?.(apiRef.current);
      }}
      onBlur={() => {
        const f = useEditor.getState().focused;
        if (f?.blockId === blockId && f.property === property) useEditor.setState({ focused: null });
        propsRef.current.onBlur?.();
      }}
    />
  );
});

/** Custom renderers (code highlighting) get the same trailing-newline placeholder as renderRichText. */
function ensureTrailingBreak(el: HTMLElement, v: RichText) {
  const last = v[v.length - 1];
  if (last && last[0].endsWith('\n') && el.lastChild?.nodeName !== 'BR') el.appendChild(document.createElement('br'));
}

export function scrollIntoViewIfNeeded(el: HTMLElement) {
  const scroller = el.closest('.lit-scroller') as HTMLElement | null;
  if (!scroller) return;
  const r = el.getBoundingClientRect();
  const sr = scroller.getBoundingClientRect();
  if (r.top < sr.top + 60) scroller.scrollTop -= sr.top + 60 - r.top;
  else if (r.bottom > sr.bottom - 80) scroller.scrollTop += r.bottom - (sr.bottom - 80);
}

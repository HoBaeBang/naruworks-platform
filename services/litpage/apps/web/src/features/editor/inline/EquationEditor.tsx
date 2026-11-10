// Inline equation editor: 400px dialog under the equation token,
// mono LaTeX input (placeholder "E = mc^2") + blue "Done ↵". Changes render live (KaTeX); Enter commits, Shift+Enter
// inserts a newline, Esc cancels (restores the previous TeX; a new empty equation is removed).
// Storage: "⁍" + ["e", tex] (network log ed-inline-equation-commit: InlineEquationOverlay.handleSubmit).
import { useEffect, useRef } from 'react';
import { annotationsOf, deleteRange, insertRich, EQUATION_CHAR, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { run, setTitle, setProperty } from '../../../lib/blocks.ts';
import { useEditor } from '../editorState.ts';
import { valueOf, type TextRange } from './format.ts';

function writeValue(blockId: string, property: string, next: RichText, action: string, coalesce?: string) {
  run(action, (tx) => (property === 'title' ? setTitle(tx, blockId, next) : setProperty(tx, blockId, property, next)), coalesce ? { coalesceKey: coalesce } : undefined);
}

/** Decoration index + annotation of the equation atom at character offset. */
function equationAt(value: RichText, offset: number): { index: number; tex: string; anns: Annotation[] } | null {
  let pos = 0;
  for (let i = 0; i < value.length; i++) {
    const d = value[i];
    if (pos === offset && d[0] === EQUATION_CHAR) {
      const anns = annotationsOf(d);
      const e = anns.find((a) => a[0] === 'e');
      if (e) return { index: i, tex: String(e[1]), anns };
    }
    pos += d[0].length;
  }
  return null;
}

function setTex(value: RichText, offset: number, tex: string): RichText {
  const eq = equationAt(value, offset);
  if (!eq) return value;
  const anns = eq.anns.map((a) => (a[0] === 'e' ? (['e', tex] as Annotation) : a));
  const next = value.slice();
  next[eq.index] = [EQUATION_CHAR, anns];
  return next;
}

function atomEl(blockId: string, property: string, offset: number): HTMLElement | null {
  const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${blockId}"][data-property="${property}"]`);
  if (!leaf) return null;
  const value = valueOf(blockId, property);
  const eq = equationAt(value, offset);
  return eq ? leaf.querySelector<HTMLElement>(`[data-token-index="${eq.index}"]`) : null;
}

let openFor: string | null = null;

/** The token being edited gets a selected look, re-applied after each live re-render. */
function markEditing(blockId: string, property: string, offset: number, on: boolean) {
  requestAnimationFrame(() => {
    const el = atomEl(blockId, property, offset);
    el?.classList.toggle('editing', on);
  });
}

/** Open the editor for the equation atom at `offset`. `isNew` removes it again when cancelled/empty. */
export function openEquationEditor(blockId: string, property: string, offset: number, opts?: { isNew?: boolean; onClose?: () => void; from?: 'left' | 'right' }) {
  const key = `${blockId}:${property}:${offset}`;
  if (openFor === key) return;
  const value = valueOf(blockId, property);
  const eq = equationAt(value, offset);
  if (!eq) return;
  const anchor = atomEl(blockId, property, offset) ?? document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`) ?? undefined;
  openFor = key;
  useEditor.setState({ editingEquation: { blockId, property, offset } });
  markEditing(blockId, property, offset, true);
  let result: 'commit' | 'cancel' = 'commit';
  let exitLeft = false;
  const original = eq.tex;
  openOverlay((close) => <EquationEditor blockId={blockId} property={property} offset={offset} initial={original} from={opts?.from} close={(r, side) => { result = r; exitLeft = side === 'left'; close(); }} />, {
    anchor: anchor?.getBoundingClientRect(),
    placement: 'bottom-start',
    offset: 8,
    closeOnEscape: false,
    onClose: () => {
      openFor = null;
      useEditor.setState({ editingEquation: null });
      markEditing(blockId, property, offset, false);
      const cur = equationAt(valueOf(blockId, property), offset);
      if (result === 'cancel') {
        if (opts?.isNew) removeEquation(blockId, property, offset);
        else if (cur && cur.tex !== original) writeValue(blockId, property, setTex(valueOf(blockId, property), offset, original), 'InlineEquationOverlay.handleCancel');
      } else if (cur && !cur.tex.trim()) {
        removeEquation(blockId, property, offset);
      }
      opts?.onClose?.();
      // caret after the equation; leaving the editor places it before
      useEditor.getState().requestFocus(blockId, cur && cur.tex.trim() && !exitLeft ? offset + 1 : offset, { property });
    },
  });
}

function removeEquation(blockId: string, property: string, offset: number) {
  const v = valueOf(blockId, property);
  if (!equationAt(v, offset)) return;
  writeValue(blockId, property, deleteRange(v, offset, offset + 1), 'InlineEquationOverlay.handleDelete');
}

/** ⌘⇧E with a collapsed caret / slash "Inline equation": insert an empty equation and edit it. */
export function insertEquationAt(blockId: string, property: string, offset: number, tex = '') {
  const v = valueOf(blockId, property);
  writeValue(blockId, property, insertRich(v, offset, [[EQUATION_CHAR, [['e', tex]]]]), 'InlineEquationOverlay.handleSubmit');
  setTimeout(() => openEquationEditor(blockId, property, offset, { isNew: !tex }), 0);
}

/** ⌘⇧E / toolbar √x with a selection: the selected text becomes the TeX source (kb-cmd-shift-e). */
export function convertSelectionToEquation(r: TextRange) {
  const v = valueOf(r.blockId, r.property);
  const tex = v.length ? (() => {
    let s = '';
    let pos = 0;
    for (const d of v) {
      const a = Math.max(r.start, pos);
      const b = Math.min(r.end, pos + d[0].length);
      if (a < b) s += d[0] === EQUATION_CHAR ? String(annotationsOf(d).find((x) => x[0] === 'e')?.[1] ?? '') : d[0].slice(a - pos, b - pos);
      pos += d[0].length;
    }
    return s;
  })() : '';
  let next = deleteRange(v, r.start, r.end);
  next = insertRich(next, r.start, [[EQUATION_CHAR, [['e', tex]]]]);
  writeValue(r.blockId, r.property, next, 'InlineEquationOverlay.handleSubmit');
  (document.activeElement as HTMLElement | null)?.blur?.();
  setTimeout(() => openEquationEditor(r.blockId, r.property, r.start, { isNew: false }), 0);
}

function EquationEditor({ blockId, property, offset, initial, close, from }: { blockId: string; property: string; offset: number; initial: string; from?: 'left' | 'right'; close: (r: 'commit' | 'cancel', side?: 'left' | 'right') => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = initial;
    el.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    if (from) {
      // reached with the arrow keys: caret at the side it came 
      range.collapse(from === 'left');
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else if (initial) {
      sel?.removeAllRanges();
      sel?.addRange(range);
    } else {
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onInput = () => {
    const tex = ref.current?.innerText.replace(/\n$/, '') ?? '';
    writeValue(blockId, property, setTex(valueOf(blockId, property), offset, tex), 'InlineEquationOverlay.handleChange', `eq:${blockId}:${offset}`);
    markEditing(blockId, property, offset, true);
  };
  return (
    <div role="dialog" className="nc-popover nc-equation-editor" style={{ width: 400 }}>
      <div className="nc-equation-row">
        <div
          ref={ref}
          className="nc-equation-input notranslate"
          contentEditable="plaintext-only"
          suppressContentEditableWarning
          spellCheck={false}
          role="textbox"
          aria-label="Equation (LaTeX)"
          aria-multiline="true"
          data-placeholder="E = mc^2"
          onInput={onInput}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            const caretAt = () => {
              const sel = window.getSelection();
              const el = ref.current;
              if (!sel || !el || !sel.isCollapsed || !sel.rangeCount) return null;
              const r = document.createRange();
              r.selectNodeContents(el);
              r.setEnd(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
              return { at: r.toString().length, len: (el.textContent ?? '').length };
            };
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              close('commit');
            } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && !e.metaKey && !e.altKey) {
              // moving on in the same direction past the TeX leaves the editor 
              const c = caretAt();
              if (c && ((e.key === 'ArrowRight' && c.at === c.len) || (e.key === 'ArrowLeft' && c.at === 0))) {
                e.preventDefault();
                close('commit', e.key === 'ArrowLeft' ? 'left' : 'right');
              }
            } else if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close('cancel');
            }
          }}
        />
        <span style={{ alignSelf: 'flex-start' }}>
          <div role="button" className="nc-equation-done" onMouseDown={(e) => e.preventDefault()} onClick={() => close('commit')}>
            Done
            <Icon name="arrowTurnDownLeftSmall" size={14} />
          </div>
        </span>
      </div>
    </div>
  );
}

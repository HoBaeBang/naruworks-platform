// Block equation. Empty state: placeholder row “Insert a TeX formula”
// (texTintable icon, 704×49 r10). Editor: popover 400×100, 14px mono textarea with TeX highlighting (commands
// red), multi-line placeholder, blue "Done ↵"; the block previews the draft live; Enter = Done, Shift+Enter =
// newline, Esc = cancel. Rendered:katex-display at 1.21em (19.36px), block padding 4px 8px; after Done the
// block is selected.
import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/contrib/mhchem'; // \ce{…} / \pu{…} chemistry support
import { create } from 'zustand';
import { toPlainText } from '@nc/shared/richtext.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { getBlock, run, setTitle } from '../../../lib/blocks.ts';
import { useEditor } from '../editorState.ts';
import { registerBlockMenu } from './registry.ts';
import { BlockPlaceholder, blockElement } from './shared.tsx';

const PLACEHOLDER = '|x| = \\begin{cases}             \n  x, &\\quad x \\geq 0 \\\\           \n -x, &\\quad x < 0             \n\\end{cases}';

const useDrafts = create<{ drafts: Record<string, string | undefined>; set: (id: string, v: string | undefined) => void }>((set, get) => ({
  drafts: {},
  set: (id, v) => set({ drafts: { ...get().drafts, [id]: v } }),
}));

export function renderTex(expr: string, display = true): { html: string; error?: string } {
  try {
    return { html: katex.renderToString(expr, { throwOnError: true, displayMode: display, strict: 'ignore', trust: false }) };
  } catch (e) {
    return { html: '', error: (e as Error).message.replace(/^KaTeX parse error:\s*/, '') };
  }
}

/** Escape + colorize TeX source for the editor overlay. */
function highlightTex(src: string): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return src.split(/(\\[a-zA-Z]+|\\.|[{}])/g).map((part) => {
    if (!part) return '';
    if (part.startsWith('\\')) return `<span class="nc-tex-cmd">${esc(part)}</span>`;
    if (part === '{' || part === '}') return `<span class="nc-tex-brace">${part}</span>`;
    return esc(part);
  }).join('') + '\n';
}

function EquationEditor({ blockId, initial, close, onCommit }: { blockId: string; initial: string; close: () => void; onCommit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  const ta = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    useDrafts.getState().set(blockId, v);
  }, [blockId, v]);
  useEffect(() => {
    ta.current?.focus();
    ta.current?.setSelectionRange(initial.length, initial.length);
    return () => useDrafts.getState().set(blockId, undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const done = () => {
    onCommit(v);
    close();
  };
  return (
    <PopoverSurface width={400} className="nc-eq-popover">
      <div className="nc-eq-editor">
        <div className="nc-eq-editor-input">
          <pre aria-hidden dangerouslySetInnerHTML={{ __html: v ? highlightTex(v) : '' }} />
          <textarea
            ref={ta}
            value={v}
            spellCheck={false}
            placeholder={PLACEHOLDER}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                done();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                useDrafts.getState().set(blockId, undefined);
                close();
              } else if (e.key === 'Tab') {
                e.preventDefault();
                const t = e.currentTarget;
                const s = t.selectionStart;
                setV(v.slice(0, s) + '  ' + v.slice(t.selectionEnd));
                requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2));
              }
            }}
          />
        </div>
        <button className="nc-blk-btn primary" style={{ flexShrink: 0 }} onMouseDown={(e) => e.preventDefault()} onClick={done}>
          Done <span style={{ fontSize: 14, marginInlineStart: 2 }}>↵</span>
        </button>
      </div>
    </PopoverSurface>
  );
}

export function openEquationEditor(blockId: string, anchor: HTMLElement) {
  const b = getBlock(blockId);
  if (!b) return;
  const initial = toPlainText(b.properties?.title);
  let committed: string | null = null;
  openOverlay((close) => <EquationEditor blockId={blockId} initial={initial} close={close} onCommit={(v) => { committed = v; }} />, {
    anchor, placement: 'bottom-start', offset: 6,
    onClose: () => {
      useDrafts.getState().set(blockId, undefined);
      if (committed !== null && committed !== initial) run('setEquation', (tx) => setTitle(tx, blockId, committed ? [[committed]] : []));
      if (committed !== null) useEditor.getState().selectBlocks([blockId], blockId);
    },
  });
}

function EquationBlock({ block, readOnly }: BlockProps) {
  const saved = toPlainText(block.properties?.title);
  const draft = useDrafts((s) => s.drafts[block.id]);
  const expr = draft ?? saved;
  const editing = draft !== undefined;
  const rendered = useMemo(() => (expr.trim() ? renderTex(expr) : null), [expr]);
  const ref = useRef<HTMLDivElement>(null);
  if (!expr.trim() && !editing) {
    return (
      <div className="nc-bpad">
        <BlockPlaceholder block={block} readOnly={readOnly} icon="texTintable" label="Insert a TeX formula" onOpen={(el) => openEquationEditor(block.id, el)} />
      </div>
    );
  }
  return (
    <div className="nc-bpad">
      <div
        ref={ref}
        role="button"
        tabIndex={-1}
        className={`nc-equation-2 ${editing ? 'editing' : ''}`}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => !readOnly && ref.current && openEquationEditor(block.id, ref.current)}
      >
        {rendered?.error ? (
          <div className="nc-equation-error">{rendered.error}</div>
        ) : rendered ? (
          <div dangerouslySetInnerHTML={{ __html: rendered.html }} />
        ) : (
          <div style={{ height: 52 }} />
        )}
      </div>
    </div>
  );
}

registerBlock(['equation'], EquationBlock);

registerBlockMenu(['equation'], ({ block, turnInto }) => [
  turnInto,
  { label: 'Edit equation', icon: 'texTintable', onSelect: () => { const el = blockElement(block.id)?.querySelector('.nc-equation-2, .nc-blk-placeholder') as HTMLElement | null; if (el) setTimeout(() => openEquationEditor(block.id, el), 0); } },
]);

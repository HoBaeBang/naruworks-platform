// Text action menu (“lit-text-action-menu”): the vertical card shown under a text selection.
// Structure and metrics for the text selection menu:
// [Normal Text ›] / [A] B I U Tx / link S code √x ••• / Comment 🙂+ ✎ / Skills… / "Revise with AI ⌘⌃E"
// The container is anchored at the selection's focus end (left = focus x, top = bottom of the last line) with a
// 16px transparent padding, so the 192px card appears 16px right/below the selection end.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { BlockType } from '@nc/shared/records.ts';
import { annotationValue, slice, type Annotation } from '@nc/shared/richtext.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu, type MenuDef } from '../../../components/Menu.tsx';
import { useOverlays } from '../../../components/overlay.tsx';
import { getBlock } from '../../../lib/blocks.ts';
import { useBlock } from '../../../lib/hooks.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { domText, getSelectionOffsets, offsetOf, rectsForRange, setSelectionOffsets } from '../richTextDom.ts';
import { useEditor } from '../editorState.ts';
import { openBlockMenu } from '../BlockMenu.tsx';
import { startCommentOnSelection } from '../../comments/comments.tsx';
import { clearFormatRange, colorsOf, rangeHas, toggleMarkRange, valueOf, type TextRange } from './format.ts';
import { openColorMenu } from './ColorMenu.tsx';
import { openLinkPopup } from './LinkPopups.tsx';
import { convertSelectionToEquation } from './EquationEditor.tsx';
import { openEmojiPopover } from './EmojiMenu.tsx';
import { turnIntoItems, blockTypeLabel } from './turnInto.ts';
import { isMac } from '../textHandlers.ts';
import { useSkills } from '../../ai/aiStores.ts';
import { openPage } from '../../../lib/router.ts';
import './icons.tsx';
import { colorToken } from '../../../lib/colorToken.ts';

interface MenuState {
  range: TextRange | null;
  /** focus x / bottom of last line / top of first line (viewport coords) */
  pos: { x: number; y: number; top: number } | null;
  /** >0 while a child popup (link, color, turn into…) owns the focus: keep showing the card */
  frozen: number;
  composing: boolean;
  mouseDown: boolean;
  /** If a popup below the selection owns that space, the card moves above the selection. */
  above?: boolean;
}

export const useTextMenu = create<MenuState>(() => ({ range: null, pos: null, frozen: 0, composing: false, mouseDown: false, above: false }));

export function hideTextMenu() {
  useTextMenu.setState({ range: null, pos: null, frozen: 0, above: false });
}

/** Freeze the card while a popup opened it is visible; returns the unfreeze function. */
export function freezeTextMenu(): () => void {
  useTextMenu.setState((s) => ({ frozen: s.frozen + 1 }));
  let done = false;
  return () => {
    if (done) return;
    done = true;
    useTextMenu.setState((s) => ({ frozen: Math.max(0, s.frozen - 1) }));
  };
}

function leafOf(n: Node | null): HTMLElement | null {
  const el = n ? (n.nodeType === 1 ? (n as HTMLElement) : n.parentElement) : null;
  return (el?.closest('[data-content-editable-leaf="true"]') as HTMLElement | null) ?? null;
}

export function leafFor(blockId: string, property = 'title'): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${blockId}"][data-property="${property}"]`);
}

/** Single-leaf, non-collapsed selection inside the page body (not the title, not code blocks). */
export function currentTextSelection(): { range: TextRange; leaf: HTMLElement; backward: boolean } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const a = leafOf(sel.anchorNode);
  const f = leafOf(sel.focusNode);
  if (!a || a !== f || !a.isContentEditable) return null;
  if (!a.closest('.lit-page-content') || a.classList.contains('nc-code-leaf')) return null;
  const off = getSelectionOffsets(a);
  if (!off || off.start === off.end) return null;
  return { range: { blockId: a.dataset.blockId!, property: a.dataset.property ?? 'title', start: off.start, end: off.end }, leaf: a, backward: off.backward };
}

function positionFor(leaf: HTMLElement, r: TextRange, backward: boolean): MenuState['pos'] {
  const rects = rectsForRange(leaf, r.start, r.end).filter((x) => x.width > 0 || x.height > 0);
  if (!rects.length) return null;
  const first = rects[0];
  const last = rects[rects.length - 1];
  return { x: backward ? first.left : last.right, y: last.bottom, top: first.top };
}

function evaluate() {
  const st = useTextMenu.getState();
  if (st.frozen > 0) return;
  if (st.composing || st.mouseDown || useEditor.getState().selectedBlocks.length) {
    if (st.range) useTextMenu.setState({ range: null, pos: null });
    return;
  }
  const cur = currentTextSelection();
  if (!cur || useEditor.getState().slash) {
    if (st.range) useTextMenu.setState({ range: null, pos: null });
    return;
  }
  const pos = positionFor(cur.leaf, cur.range, cur.backward);
  if (!pos) return;
  const same = st.range && st.range.blockId === cur.range.blockId && st.range.property === cur.range.property && st.range.start === cur.range.start && st.range.end === cur.range.end;
  if (same && st.pos && Math.abs(st.pos.x - pos.x) < 1 && Math.abs(st.pos.y - pos.y) < 1) return;
  useTextMenu.setState({ range: cur.range, pos });
}

let raf = 0;
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(evaluate);
}

/** Model offset under a viewport point inside `leaf`, or null when the point is not over a glyph, such as empty space to the right of the text. */
function offsetAtPoint(leaf: HTMLElement, x: number, y: number): number | null {
  const doc = document as Document & { caretRangeFromPoint?: (x: number, y: number) => Range | null; caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null };
  let node: Node | null = null;
  let off = 0;
  const cp = doc.caretPositionFromPoint?.(x, y);
  if (cp) { node = cp.offsetNode; off = cp.offset; }
  else {
    const cr = doc.caretRangeFromPoint?.(x, y);
    if (cr) { node = cr.startContainer; off = cr.startOffset; }
  }
  if (!node || !leaf.contains(node)) return null;
  const at = offsetOf(leaf, node, off);
  const len = domText(leaf).length;
  // the pointer must be over the character before or after the caret position
  for (const o of [at - 1, at]) {
    if (o < 0 || o >= len) continue;
    for (const r of rectsForRange(leaf, o, o + 1)) {
      if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - 1 && y <= r.bottom + 1) return o;
    }
  }
  return null;
}

/** Word boundaries around `offset` in plain text (Intl.Segmenter: works for CJK); atoms/spaces select one char. */
function wordAt(text: string, offset: number): { start: number; end: number } {
  try {
    const seg = new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const part of seg.segment(text)) {
      const end = part.index + part.segment.length;
      if (offset >= part.index && offset < end) {
        if (!part.isWordLike) return { start: offset, end: offset + 1 };
        return { start: part.index, end };
      }
    }
  } catch {
    /* no Intl.Segmenter */
  }
  let a = offset;
  let b = offset;
  while (a > 0 && /[\p{L}\p{N}_]/u.test(text[a - 1])) a--;
  while (b < text.length && /[\p{L}\p{N}_]/u.test(text[b])) b++;
  return b > a ? { start: a, end: b } : { start: offset, end: offset + 1 };
}

/** * Right-click on text selects the word under the pointer, or keeps a selection that contains it, and shows this card at its usual place, including when the block was block-selected. * Returns false when the pointer is not over text (the caller lets the browser menu open). */
export function openTextMenuAtPoint(leaf: HTMLElement, x: number, y: number): boolean {
  if (!leaf.isContentEditable || !leaf.closest('.lit-page-content') || leaf.classList.contains('nc-code-leaf')) return false;
  const at = offsetAtPoint(leaf, x, y);
  if (at === null) return false;
  const cur = getSelectionOffsets(leaf);
  const sel = window.getSelection();
  const inside = !!cur && cur.start !== cur.end && at >= cur.start && at < cur.end && !!sel && leafOf(sel.anchorNode) === leaf && leafOf(sel.focusNode) === leaf;
  const ed = useEditor.getState();
  if (ed.selectedBlocks.length) ed.clearBlockSelection();
  if (!inside) {
    const w = wordAt(domText(leaf), at);
    if (document.activeElement !== leaf) leaf.focus({ preventScroll: true });
    setSelectionOffsets(leaf, w.start, w.end);
  }
  useTextMenu.setState({ mouseDown: false, frozen: 0 });
  cancelAnimationFrame(raf);
  evaluate();
  return true;
}

/** Watches the document selection; installed once by the editor surface. */
export function installTextMenuWatcher(): () => void {
  const onSel = () => {
    // selection collapsing (typing, clicking) hides immediately; growing waits for mouseup/keyup
    const st = useTextMenu.getState();
    if (st.frozen) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      if (st.range) useTextMenu.setState({ range: null, pos: null });
      return;
    }
    if (!st.mouseDown) schedule();
  };
  const onDown = (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest?.('.lit-text-action-menu, .lit-overlay-container')) return;
    useTextMenu.setState({ mouseDown: true, ...(useTextMenu.getState().frozen ? {} : { range: null, pos: null }) });
  };
  const onUp = () => {
    if (!useTextMenu.getState().mouseDown) return;
    useTextMenu.setState({ mouseDown: false });
    setTimeout(schedule, 0);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return;
    schedule();
  };
  const onCompStart = () => useTextMenu.setState({ composing: true, range: null, pos: null });
  const onCompEnd = () => useTextMenu.setState({ composing: false });
  const onScroll = () => {
    const st = useTextMenu.getState();
    if (!st.range) return;
    const leaf = leafFor(st.range.blockId, st.range.property);
    if (!leaf) return;
    const pos = positionFor(leaf, st.range, false);
    if (pos) useTextMenu.setState({ pos });
  };
  document.addEventListener('selectionchange', onSel);
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mouseup', onUp, true);
  document.addEventListener('keyup', onKeyUp, true);
  document.addEventListener('compositionstart', onCompStart, true);
  document.addEventListener('compositionend', onCompEnd, true);
  window.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', onScroll);
  return () => {
    document.removeEventListener('selectionchange', onSel);
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mouseup', onUp, true);
    document.removeEventListener('keyup', onKeyUp, true);
    document.removeEventListener('compositionstart', onCompStart, true);
    document.removeEventListener('compositionend', onCompEnd, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onScroll);
  };
}

const SKILLS = ['Improve writing', 'Proofread', 'Explain', 'Reformat'];
const mod = isMac ? '⌘' : 'Ctrl+';
const alt = isMac ? '⌥' : 'Alt+';
const shift = isMac ? '⇧' : 'Shift+';
const ctrl = isMac ? '⌃' : 'Ctrl+';

export function askAI(r: TextRange, extra?: { prompt?: string; skill?: string; skillId?: string }) {
  hideTextMenu();
  window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { blockId: r.blockId, property: r.property, start: r.start, end: r.end, ...extra } }));
}

function TBtn({ icon, tip, sub, pressed, onPress, width = 32, label, children, className, haspopup, expanded }: {
  icon?: string; tip?: string; sub?: string; pressed?: boolean; onPress: (el: HTMLElement) => void; width?: number; label?: string; children?: ReactNode; className?: string; haspopup?: boolean; expanded?: boolean;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={pressed === undefined ? undefined : pressed}
      aria-label={label}
      aria-haspopup={haspopup ? 'dialog' : undefined}
      aria-expanded={haspopup ? !!expanded : undefined}
      className={`nc-tam-btn ${className ?? ''}`}
      style={{ width }}
      data-tooltip={tip}
      data-tooltip-sub={sub}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => onPress(e.currentTarget)}
    >
      {children ?? (icon && <Icon name={icon} size={icon === 'ellipsisSmall' ? 16 : 20} />)}
    </div>
  );
}

export function TextActionMenu({ readOnly }: { readOnly: boolean }) {
  const range = useTextMenu((s) => s.range);
  const pos = useTextMenu((s) => s.pos);
  const above = useTextMenu((s) => !!s.above);
  const block = useBlock(range?.blockId);
  const cardRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 192, h: 323 });
  const [aiText, setAiText] = useState('');
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const turnIntoOpen = useRef(false);
  /** Which button’s popover is open, whose button keeps the hover background. */
  const [popup, setPopup] = useState<string | null>(null);
  // the user's own skills offered in page editors, after the built-in four
  const enabledSkills = useSkills((s) => s.enabled);
  const userSkills = enabledSkills.filter((x) => !x.builtin && x.inPage);
  useEffect(() => {
    if (range && pos && !readOnly) void useSkills.getState().load().catch(() => {});
  }, [!!range && !!pos, readOnly]);

  useLayoutEffect(() => {
    const el = cardRef.current;
    if (el) setSize({ w: el.offsetWidth, h: el.offsetHeight });
  }, [range?.blockId, range?.property, !!pos]);

  useEffect(() => setAiText(''), [range?.blockId, range?.start, range?.end]);

  if (!range || !pos || readOnly || !block) return null;
  const value = valueOf(range.blockId, range.property);
  const has = (k: Annotation[0]) => rangeHas(range, k);
  const colors = colorsOf(value, range.start, range.end);
  const isLink = annotationValue(value, range.start, range.end, 'a') !== undefined;
  const showTurnInto = range.property === 'title';

  // place below the selection end; flip above when the card would leave the viewport
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  let left = pos.x;
  let top = pos.y;
  if (above) top = Math.max(8 - 16, pos.top - size.h - 32); // card bottom 16px above the selection
  else if (top + 16 + size.h > vh - 8) top = Math.max(8 - 16, pos.top - size.h - 32 + 8);
  if (left + 16 + size.w > vw - 8) left = vw - 8 - size.w - 16;

  const withFreeze = (open: (unfreeze: () => void) => void, key?: string) => {
    const release = freezeTextMenu();
    if (key) setPopup(key);
    open(() => {
      if (key) setPopup((k) => (k === key ? null : k));
      release();
    });
  };
  const r = range;
  const openTurnInto = (el: HTMLElement) => {
    if (turnIntoOpen.current) return;
    withFreeze((unfreeze) => {
      turnIntoOpen.current = true;
      openMenu(el, turnIntoMenuFor(r), { placement: 'right-start', offset: 6, onClose: () => { turnIntoOpen.current = false; unfreeze(); } });
    });
  };
  const content = (
    <div className="lit-text-action-menu" style={{ position: 'fixed', top, left, zIndex: 998, pointerEvents: 'none', transformOrigin: '112px center' }}>
      <div style={{ pointerEvents: 'none', padding: 16 }}>
        <div
          ref={cardRef}
          className="nc-tam-card"
          onMouseDown={(e) => {
            if (!(e.target as HTMLElement).closest('.nc-tam-ai-input')) e.preventDefault();
          }}
        >
          {showTurnInto && (
            <>
              <div
                role="button"
                tabIndex={0}
                aria-haspopup="dialog"
                className="nc-tam-turninto"
                data-tooltip={turnIntoDescription(block.type)}
                data-tooltip-side="right"
                onClick={(e) => openTurnInto(e.currentTarget)}
                onMouseEnter={(e) => {
                  // Hovering “Normal Text” opens the Turn into submenu
                  const el = e.currentTarget;
                  if (hoverTimer.current) clearTimeout(hoverTimer.current);
                  hoverTimer.current = setTimeout(() => openTurnInto(el), 180);
                }}
                onMouseLeave={() => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }}
              >
                <div className="nc-tam-turninto-icon"><Icon name={turnIntoIcon(block.type, !!block.format?.toggleable)} size={20} /></div>
                <div className="nc-tam-turninto-label">{blockTypeLabel(block.type, !!block.format?.toggleable)}</div>
                <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
              </div>
              <div className="nc-tam-divider" />
            </>
          )}
          <div className="nc-tam-rows">
            <div className="nc-tam-row">
              <TBtn
                haspopup
                expanded={popup === 'color'}
                tip="Text color"
                onPress={(el) => withFreeze((unfreeze) => openColorMenu(el, r, unfreeze), 'color')}
              >
                <div
                  className="nc-tam-color-a"
                  style={{
                    color: colors.text ? `var(${colorToken(tok(colors.text), 'text-secondary')})` : 'var(--lp-text-primary)',
                    background: colors.bg ? `var(${colorToken(tok(colors.bg), 'bg-secondary')})` : undefined,
                    boxShadow: `inset 0 0 0 1px var(${colorToken(tok(colors.bg ?? colors.text ?? 'gray'), 'border-primary-transparent')})`,
                  }}
                >
                  A
                </div>
              </TBtn>
              <TBtn icon="textBold" tip="Bold" sub={`${mod}B`} pressed={has('b')} onPress={() => toggleMarkRange(r, ['b'])} />
              <TBtn icon="textItalic" tip="Italicize" sub={`${mod}I`} pressed={has('i')} onPress={() => toggleMarkRange(r, ['i'])} />
              <TBtn icon="textUnderline" tip="Underline" sub={`${mod}U`} pressed={has('_')} onPress={() => toggleMarkRange(r, ['_'])} />
              <TBtn icon="textX" width={28} tip="Clear format" sub={`${mod}${alt}\\`} label="Clear format" onPress={() => clearFormatRange(r)} />
            </div>
            <div className="nc-tam-row">
              <TBtn
                icon="link"
                haspopup
                tip="Add link"
                sub={`${mod}K`}
                pressed={isLink ? true : undefined}
                expanded={popup === 'link'}
                onPress={() => withFreeze((unfreeze) => openLinkPopup(r, { onClose: unfreeze }), 'link')}
              />
              <TBtn icon="textStrikethrough" tip="Strike-through" sub={`${mod}${shift}X`} pressed={has('s')} onPress={() => toggleMarkRange(r, ['s'])} />
              <TBtn icon="code" tip="Apply code style" sub={`${mod}E`} pressed={has('c')} onPress={() => toggleMarkRange(r, ['c'])} />
              <TBtn icon="squareRoot" tip="Apply equation style" sub={`${mod}${shift}E`} onPress={() => { hideTextMenu(); convertSelectionToEquation(r); }} />
              <TBtn
                icon="ellipsisSmall"
                className="lit-block-action-menu nc-tam-more"
                onPress={(el) => {
                  hideTextMenu();
                  openBlockMenu([r.blockId], el.getBoundingClientRect());
                }}
              />
            </div>
          </div>
          <div className="nc-tam-divider" />
          <div className="nc-tam-comment-row">
            <div
              role="button"
              tabIndex={0}
              aria-label="Write a comment"
              className="nc-tam-comment"
              data-tooltip="Comment"
              data-tooltip-sub={`${mod}${shift}M`}
              onClick={() => { hideTextMenu(); startCommentOnSelection(r.blockId, r.start, r.end, r.property); }}
            >
              <Icon name="commentFilled" size={20} />
              Comment
            </div>
            <div className="nc-tam-row" style={{ gap: 4 }}>
              <TBtn
                icon="emojiFacePlus"
                haspopup
                expanded={popup === 'emoji'}
                tip="React to this selection"
                onPress={(el) => withFreeze((unfreeze) => openEmojiPopover(el, (emoji) => reactToSelection(r, emoji), unfreeze), 'emoji')}
              />
              <TBtn icon="commentPencil" tip="Suggest edits" sub={`${mod}${shift}${alt}X`} onPress={() => { hideTextMenu(); void import('../../comments/suggest.ts').then((m) => m.startSuggestingOnRange(r)); }} />
            </div>
          </div>
          <div className="nc-tam-divider" style={{ marginBlock: '4px 0' }} />
          <div style={{ position: 'relative' }}>
            {/* The list shows a 15px scrollbar and rows 161px wide. */}
            <div className="nc-tam-skills lit-scroller vertical">
              <div className="nc-tam-skills-head">
                Skills
                <div role="button" aria-label="Skills" className="nc-tam-icon-btn" data-tooltip="Manage skills" onClick={() => askAI(r, { skill: 'manage' })}>
                  <Icon name="sliders" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
                </div>
              </div>
              {SKILLS.map((s) => (
                <div key={s} role="button" tabIndex={0} className="nc-tam-skill" onClick={() => askAI(r, { skill: s })}>
                  <span className="nc-ellipsis" style={{ flex: '1 1 0%', minWidth: 0 }}>{s}</span>
                  <div className="nc-tam-skill-edit">
                    <div role="button" aria-label="Edit skill" className="nc-tam-icon-btn" data-tooltip="Edit skill" onClick={(e) => { e.stopPropagation(); askAI(r, { skill: s, edit: true } as any); }}>
                      <Icon name="pencilLineSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
                    </div>
                  </div>
                </div>
              ))}
              {userSkills.map((s) => (
                <div key={s.id} role="button" tabIndex={0} className="nc-tam-skill" data-skill-id={s.id} title={s.description || undefined} onClick={() => askAI(r, { skill: s.name, skillId: s.id })}>
                  <span className="nc-ellipsis" style={{ flex: '1 1 0%', minWidth: 0 }}>{s.name}</span>
                  {s.pageId && (
                    <div className="nc-tam-skill-edit">
                      <div role="button" aria-label="Edit skill" className="nc-tam-icon-btn" data-tooltip="Edit skill" onClick={(e) => { e.stopPropagation(); hideTextMenu(); openPage(s.pageId!); }}>
                        <Icon name="pencilLineSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="nc-tam-skills-fade" />
          </div>
          <div className="nc-tam-ai">
            {/* A multi-line role=textbox wraps, grows to 60px, then scrolls; Enter sends, ⇧Enter breaks. */}
            <textarea
              className="nc-tam-ai-input"
              role="textbox"
              aria-multiline="true"
              rows={1}
              placeholder="Revise with AI"
              value={aiText}
              onFocus={() => { useTextMenu.setState((s) => ({ frozen: s.frozen + 1 })); }}
              onBlur={() => { useTextMenu.setState((s) => ({ frozen: Math.max(0, s.frozen - 1) })); }}
              onChange={(e) => setAiText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (aiText.trim()) askAI(r, { prompt: aiText.trim() });
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  hideTextMenu();
                }
              }}
            />
            <div className="nc-tam-ai-hint">{isMac ? '⌘⌃E' : `${ctrl}${alt}E`}</div>
          </div>
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

function tok(c: string): string {
  const map: Record<string, string> = { gray: 'gra', brown: 'bro', orange: 'ora', yellow: 'yel', green: 'gre', blue: 'blu', purple: 'pur', pink: 'pin', red: 'red', default: 'gra' };
  return map[c] ?? 'gra';
}

const DESCRIPTIONS: Partial<Record<BlockType, string>> = {
  text: 'Write with plain text', header: 'Large section heading', sub_header: 'Medium heading', sub_sub_header: 'Small heading',
  bulleted_list: 'Add a bulleted list', numbered_list: 'Add a numbered list', to_do: 'Track tasks in a checklist',
  toggle: 'Toggles collapse or reveal content', quote: 'Capture a quote', callout: 'Highlight important text', code: 'Add a code snippet',
};

function turnIntoDescription(t: BlockType): string | undefined {
  return DESCRIPTIONS[t];
}

function turnIntoIcon(t: BlockType, toggleable: boolean): string {
  const it = turnIntoItems().find((x) => x.type === t && !!x.format?.toggleable === toggleable);
  return it?.icon ?? 'textNormal';
}

function turnIntoMenuFor(r: TextRange): MenuDef {
  const b = getBlock(r.blockId);
  const items = turnIntoItems();
  return {
    width: 220,
    maxHeight: '70vh',
    sections: [{
      items: items.map((t) => ({
        label: t.label,
        icon: t.icon,
        checked: !!b && b.type === t.type && !!b.format?.toggleable === !!t.format?.toggleable && !t.columns && !t.pickParent,
        right: t.pickParent ? <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} /> : undefined,
        onSelect: () => {
          const anchor = leafFor(r.blockId, r.property)?.getBoundingClientRect();
          t.apply([r.blockId], anchor);
          // keep the text selected while the block keeps its id
          if (!t.pickParent && getBlock(r.blockId)?.alive && t.type !== 'page' && !t.columns) useEditor.getState().requestFocus(r.blockId, r.start, { property: r.property, end: r.end });
        },
      })),
    }],
  };
}

function reactToSelection(r: TextRange, emoji: string) {
  const ev = new CustomEvent('nc:inline-reaction', { detail: { blockId: r.blockId, property: r.property, start: r.start, end: r.end, emoji, handled: false } });
  window.dispatchEvent(ev);
  if ((ev.detail as any).handled) return;
  // fallback: an inline discussion whose first comment is the emoji (rendered large like emoji-only comments)
  void import('../../comments/comments.tsx').then(({ addComment }) => {
    const context = slice(valueOf(r.blockId, r.property), r.start, r.end);
    addComment(r.blockId, [[emoji]], undefined, context, { annotate: { property: r.property, start: r.start, end: r.end } });
  });
}

export { useOverlays };

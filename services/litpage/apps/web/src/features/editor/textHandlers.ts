// Input/keyboard behavior shared by all rich-text blocks (text, headings, lists, quote, callout, code).
// behaviors: (keyboard / markdown_autoformat / text_autoreplace).
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BlockType } from '@nc/shared/records.ts';
import {
  annotationsAt, annotationValue, deleteRange, hasAnnotation, insertText, length, toPlainText, toggleAnnotation, addAnnotation, removeAnnotation,
  type Annotation, type RichText,
} from '@nc/shared/richtext.ts';
import { HEADING_TYPES, TEXT_BLOCKS } from '@nc/shared/blocks.ts';
import { getBlock, run, setTitle, setProperty } from '../../lib/blocks.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { useUI } from '../../lib/store/ui.ts';
import type { LeafApi } from './RichTextEditable.tsx';
import { useEditor } from './editorState.ts';
import {
  backspaceAtStart, deleteAtEnd, duplicateBlocks, indent, insertAfter, isOpen, moveBlockUpDown, neighborLeaf, outdent, pageIdOfBlock, setOpen, splitBlock,
  titleOf, toggleAllToggles, turnInto,
} from './commands.ts';
import { applyAutoReplace, applyInlineEquation, applyInlineMarkdown, matchBlockShortcut, matchInstantShortcut, AUTOREPLACE_LAST } from './markdown.ts';
import { openSlashMenu, updateSlashQuery, closeSlashMenu } from './SlashMenu.tsx';
import { pasteIntoBlock } from './clipboard.ts';
import { openBlockMenuFor } from './BlockMenu.tsx';
import { stickyFormat } from './prefs.ts';
import { applySuggestedEdit, suggestFormatRange, suggestingIn, suggestReplace } from '../comments/suggestEdits.ts';

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = (e: { metaKey: boolean; ctrlKey: boolean }) => (isMac ? e.metaKey : e.ctrlKey);

/** @deprecated kept for older callers — recent colors live in inline/format.ts */
export function rememberColor(c: string) {
  void import('./inline/format.ts').then((m) => m.pushRecentColor(c));
}

export function commitText(blockId: string, property: string, next: RichText, caret: number, opts?: { coalesce?: boolean; action?: string; base?: RichText }) {
  run(opts?.action ?? 'Text.handleMutation', (tx) => {
    if (property === 'title') setTitle(tx, blockId, next, opts?.base);
    else setProperty(tx, blockId, property, next);
  }, {
    coalesceKey: opts?.coalesce === false ? undefined : `type:${blockId}:${property}`,
    selectionAfter: { blockId, offset: caret, property },
  });
}

const TRIGGER_PREV = /[\s([{"'“‘]/;

/** The keyboard-shown link pill is up for the link around `caret` in this leaf. */
let linkHoverState: (() => { blockId: string; property: string; start: number; end: number; keyboard?: boolean } | null) | null = null;
void import('./inline/LinkPopups.tsx').then((m) => { linkHoverState = () => m.useLinkHover.getState().hover; });
function keyboardLinkAt(blockId: string, property: string, caret: number): boolean {
  const h = linkHoverState?.();
  return !!h && !!h.keyboard && h.blockId === blockId && h.property === property && caret > h.start && caret < h.end;
}

/** Is the character at `offset` an inline equation atom? */
function isEquationAt(v: RichText, offset: number): boolean {
  let pos = 0;
  for (const d of v) {
    if (offset >= pos && offset < pos + d[0].length) return d[0] === '⁍' && (d[1] ?? []).some((a) => a[0] === 'e');
    pos += d[0].length;
  }
  return false;
}

/** ⌘⇧V was pressed: the paste event that follows is "paste without formatting" (until this time). */
let plainPasteUntil = 0;

export function makeTextHandlers(blockId: string, property = 'title') {
  const onChange = (next: RichText, info: { caret: number; inserted: string; inputType: string; prev?: RichText }) => {
    const b = getBlock(blockId);
    if (!b) return;
 // suggest mode: the edit becomes a suggestion, with no Markdown, autoformat, or trigger menus
    if (property === 'title' && suggestingIn(blockId)) {
      if (useEditor.getState().slash) closeSlashMenu();
      applySuggestedEdit(blockId, info.prev ?? titleOf(blockId), next, info.inputType);
      return;
    }
    const { caret, inserted } = info;
    const text = toPlainText(next);
    const slash = useEditor.getState().slash;
    const isCode = b.type === 'code';

 // active "/" "@" "[[" "+" ":" menus follow the typed query
    if (slash && slash.blockId === blockId && slash.property === property) {
      if (caret <= slash.start || text.slice(slash.start, slash.start + slash.trigger.length) !== slash.trigger) closeSlashMenu();
      else {
        const q = text.slice(slash.start + slash.trigger.length, caret);
 // “/” not at the block start closes on a space
        if (slash.trigger === '/' && slash.start > 0 && q.endsWith(' ') && q.trim() === '') closeSlashMenu();
        else updateSlashQuery(q);
      }
    }

    if (property === 'title' && !isCode) {
 // instant shortcuts in an otherwise empty block: "---" → divider (+ new text), "```" → code
      const instant = matchInstantShortcut(text);
      if (instant && (inserted === '-' || inserted === '`') && (b.type === 'text' || b.type === 'bulleted_list')) {
        convertInstant(blockId, instant);
        return;
      }
 // block shortcuts after a space at the very beginning ("# ", "- ", "1. ", "[] ", "> ", "\" " …), also in non-empty blocks
      if (inserted === ' ' || inserted === ' ') {
        const before = text.slice(0, caret).replace(/ /g, ' ');
        const sc = caret <= 6 ? matchBlockShortcut(before, { type: b.type, toggleable: !!b.format?.toggleable }) : null;
        const convertible = b.type === 'text' || ['bulleted_list', 'numbered_list', 'to_do', 'toggle', 'quote', 'header', 'sub_header', 'sub_sub_header', 'header_4'].includes(b.type);
        if (sc && convertible && (sc.type !== b.type || (sc.format?.toggleable && !b.format?.toggleable))) {
          const stripped = deleteRange(next, 0, sc.strip);
          run('textFilterActions.runAllFiltersAfterTransaction', (tx) => {
            tx.update('block', blockId, [], { type: sc.type });
            if (sc.format) tx.update('block', blockId, ['format'], sc.format);
            if (sc.properties) for (const [k, v] of Object.entries(sc.properties)) tx.set('block', blockId, ['properties', k], v);
            setTitle(tx, blockId, stripped);
          }, { selectionAfter: { blockId, offset: 0 } });
          if (sc.type === 'toggle' || sc.format?.toggleable) setOpen(blockId, !!sc.open);
          useEditor.getState().requestFocus(blockId, Math.max(0, caret - sc.strip));
          return;
        }
      }
 // $$tex$$ → inline equation
      if (inserted === '$') {
        const r = applyInlineEquation(next, caret);
        if (r) {
          commitText(blockId, property, r.value, r.caret, { coalesce: false, action: 'textFilterActions.runAllFiltersAfterTransaction', base: info.prev });
          useEditor.getState().requestFocus(blockId, r.caret, { property });
          return;
        }
      }
 // inline markdown on the closing marker
      if (inserted && /^[*_`~]$/.test(inserted)) {
        const r = applyInlineMarkdown(next, caret);
        if (r) {
          commitText(blockId, property, r.value, r.caret, { coalesce: false, action: 'textFilterActions.runAllFiltersAfterTransaction', base: info.prev });
 // removeAnnotation runs after autoformat so the next typed text is not formatted
          const marks = annotationsAt(r.value, r.caret).filter((a) => a[0] !== r.ann[0]);
          useEditor.getState().requestFocus(blockId, r.caret, { property, marks });
          return;
        }
      }
      if (inserted && AUTOREPLACE_LAST.test(inserted)) {
        const r = applyAutoReplace(next, caret);
        if (r) {
          commitText(blockId, property, r.value, r.caret, { base: info.prev });
          useEditor.getState().requestFocus(blockId, r.caret, { property });
          return;
        }
      }
    }

    commitText(blockId, property, next, caret, { base: info.prev });

    if (isCode || useEditor.getState().slash) return;
 // open menus on trigger characters
    const prev = text[caret - 2];
    const atWordStart = caret === 1 || TRIGGER_PREV.test(prev ?? ' ');
    if (inserted === '/' && !/\d/.test(prev ?? '')) openSlashMenu(blockId, property, caret - 1, '/');
    else if (inserted === '@' && atWordStart) openSlashMenu(blockId, property, caret - 1, '@');
    else if (inserted === '[' && text.slice(caret - 2, caret) === '[[') openSlashMenu(blockId, property, caret - 2, '[[');
    else if (inserted === '+' && atWordStart) openSlashMenu(blockId, property, caret - 1, '+');
    else if (inserted && /^[\p{L}\p{N}_+-]$/u.test(inserted)) {
 // ":" + at least two name characters → emoji autocomplete
      const m = /(^|[\s(])(:)([\p{L}\p{N}_+-]{2,})$/u.exec(text.slice(0, caret));
      if (m) {
        const start = caret - m[3].length - 1;
        openSlashMenu(blockId, property, start, ':');
        updateSlashQuery(m[3]);
      }
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>, api: LeafApi) => {
    const b = getBlock(blockId);
    if (!b) return;
    const k = e.key;
    const sel = api.selection() ?? { start: 0, end: 0 };
    const value = api.value();
    const isCode = b.type === 'code';
    const m = mod(e);
    const collapsed = sel.start === sel.end;
    const range = { blockId, property, start: sel.start, end: sel.end };

    if (useEditor.getState().slash && (k === 'ArrowUp' || k === 'ArrowDown' || k === 'Enter' || k === 'Tab')) return;

    if (property === 'title' && suggestingIn(blockId) && suggestModeKey(e, api, blockId)) return;

    if (m && !e.altKey) {
      const lower = k.toLowerCase();
      if (e.shiftKey && e.code === 'KeyV') {
 // ⌘⇧V: take only the pasted plain text
        plainPasteUntil = Date.now() + 1000;
        return;
      }
      const fmt: Record<string, Annotation> = { b: ['b'], i: ['i'], u: ['_'], e: ['c'] };
      if (!e.shiftKey && fmt[lower] && !isCode) {
        e.preventDefault();
        toggleMark(blockId, property, api, fmt[lower]);
        return;
      }
      if (e.shiftKey && (lower === 's' || lower === 'x') && !isCode) {
        e.preventDefault();
        toggleMark(blockId, property, api, ['s']);
        return;
      }
      if (e.shiftKey && lower === 'h' && !isCode) {
        e.preventDefault();
        void import('./inline/format.ts').then(({ lastUsedColor, setColorRange }) => {
          const c = lastUsedColor();
          if (c && !collapsed) setColorRange(range, c);
        });
        return;
      }
      if (e.shiftKey && lower === 'e' && !isCode) {
        e.preventDefault();
        void import('./inline/EquationEditor.tsx').then(({ convertSelectionToEquation, insertEquationAt }) => {
          if (collapsed) insertEquationAt(blockId, property, sel.start);
          else convertSelectionToEquation(range);
        });
        return;
      }
      if (e.shiftKey && lower === 'm') {
        e.preventDefault();
        void import('../comments/comments.tsx').then(({ startCommentOnSelection, startCommentOnBlock }) => {
          if (collapsed) startCommentOnBlock(blockId);
          else startCommentOnSelection(blockId, sel.start, sel.end, property);
        });
        return;
      }
      if (!e.shiftKey && lower === 'k') {
        const href = annotationValue(value, sel.start, sel.end, 'a') as string | undefined;
        if (!collapsed || href) {
          e.preventDefault();
          e.stopPropagation();
          void import('./inline/LinkPopups.tsx').then(({ openLinkPopup, openLinkEdit, linkExtent }) => {
            if (collapsed && href) {
              const ext = linkExtent(value, sel.start, href);
              if (ext) openLinkEdit({ blockId, property, start: ext.start, end: ext.end }, href);
            } else openLinkPopup(range);
          });
        }
        return; // collapsed caret outside a link: the global handler opens Search
      }
      if (!e.shiftKey && lower === 'j') {
        e.preventDefault();
        e.stopPropagation();
        window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { blockId, property, start: sel.start, end: sel.end } }));
        return;
      }
      if (e.ctrlKey && isMac && lower === 'e') {
 // ⌘⌃E — "Edit with AI"
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { blockId, property, start: sel.start, end: sel.end, mode: 'edit' } }));
        return;
      }
      if (!e.shiftKey && lower === 'z') {
        e.preventDefault();
        transactions.undo();
        return;
      }
      if ((e.shiftKey && lower === 'z') || (!isMac && lower === 'y')) {
        e.preventDefault();
        transactions.redo();
        return;
      }
      if (!e.shiftKey && lower === 'd') {
 // duplicates below; the duplicate becomes block-selected (kb-dup-move)
        e.preventDefault();
        const nids = duplicateBlocks([blockId]);
        if (nids.length) useEditor.getState().selectBlocks(nids, nids[0]);
        return;
      }
      if (lower === 'a' && !e.shiftKey) {
 // first ⌘A selects the block's text; second selects every block on the page (kb-select-multi)
        if (sel.start === 0 && sel.end === length(value)) {
          e.preventDefault();
          const page = api.el.closest('.lit-page-content');
          const ids = Array.from(page?.querySelectorAll<HTMLElement>(':scope > .nc-block-list > .lit-selectable') ?? []).map((el) => el.dataset.blockId!).filter(Boolean);
          if (ids.length) useEditor.getState().selectBlocks(ids, ids[0]);
        }
        return;
      }
      if (k === 'Enter') {
        e.preventDefault();
 if (isCode) return; // ⌘Enter in code: no effect
        if (b.type === 'to_do') toggleTodo(blockId);
        else if (b.type === 'toggle' || b.format?.toggleable) setOpen(blockId, !isOpen(blockId));
        return;
      }
      if (e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
        e.preventDefault();
        moveBlockUpDown(blockId, k === 'ArrowUp' ? -1 : 1);
        useEditor.getState().requestFocus(blockId, sel.start, { property, end: sel.end });
        return;
      }
      if (k === '/') {
        e.preventDefault();
 // caret on a link: ⌘/ moves into its link menu; otherwise the block menu
        const href = collapsed ? (annotationValue(value, sel.start, sel.start, 'a') as string | undefined) : undefined;
        if (href) {
          void import('./inline/LinkPopups.tsx').then((m) => {
            m.syncKeyboardLinkPill(blockId, property, sel.start);
            requestAnimationFrame(() => { if (!m.focusLinkPill()) openBlockMenuFor(blockId, api.el); });
          });
          return;
        }
        openBlockMenuFor(blockId, api.el);
        return;
      }
    }
    if (m && e.altKey) {
      const code = e.code; // ⌥ changes e.key on macOS (⌥0 = "º"): use the physical key
      if (e.shiftKey && code === 'KeyX') {
 // ⌘⇧⌥X — Suggest edits (block menu / selection card shortcut)
        e.preventDefault();
        void import('../comments/suggest.ts').then((s) => s.startSuggestingOnRange(range));
        return;
      }
      if (!e.shiftKey && code === 'KeyP') {
 // ⌘⌥P, “Present here” from the block menu
        e.preventDefault();
        void import('./slashItems.ts').then((m) => m.presentFrom(blockId));
        return;
      }
      const digit = /^Digit([0-9])$/.exec(code)?.[1] ?? (/^[0-9]$/.test(k) ? k : null);
      if (digit !== null && property === 'title') {
        e.preventDefault();
        const map: Record<string, BlockType> = {
          '0': 'text', '1': 'header', '2': 'sub_header', '3': 'sub_sub_header', '4': 'to_do', '5': 'bulleted_list',
          '6': 'numbered_list', '7': 'toggle', '8': 'code', '9': 'page',
        };
        const t = map[digit];
        if (t === 'page') {
          void import('./inline/turnInto.ts').then(({ convertToPage }) => convertToPage(blockId));
          return;
        }
        turnInto(blockId, t, HEADING_TYPES.has(t) && b.format?.toggleable ? undefined : b.format?.toggleable ? { toggleable: undefined } : undefined);
        if (t === 'toggle') setOpen(blockId, true);
        useEditor.getState().requestFocus(blockId, sel.start, { property });
        return;
      }
      if (code === 'Backslash' || k === '\\' || k === '«') {
 // ⌘⌥\ clear formatting of the selection
        e.preventDefault();
        if (!collapsed) void import('./inline/format.ts').then(({ clearFormatRange }) => clearFormatRange(range));
        return;
      }
      if (code === 'KeyT') {
        e.preventDefault();
        const pid = pageIdOfBlock(blockId);
        if (pid) toggleAllToggles(pid);
        return;
      }
    }

 // ⌥⇧L — Copy link to block
    if (e.altKey && e.shiftKey && !m && e.code === 'KeyL') {
      e.preventDefault();
      void import('../page/pageActions.ts').then((p) => p.copyPageLink(pageIdOfBlock(blockId) ?? blockId, blockId));
      return;
    }

 // ←/→ onto a link shows its menu; Enter then opens the link
    if ((k === 'ArrowLeft' || k === 'ArrowRight') && !e.shiftKey && !e.altKey && !m) {
      setTimeout(() => {
        const after = api.selection();
        void import('./inline/LinkPopups.tsx').then((mod2) => mod2.syncKeyboardLinkPill(blockId, property, after && after.start === after.end ? after.start : null));
      }, 0);
    }
    if (k === 'Enter' && !e.shiftKey && !m && collapsed && keyboardLinkAt(blockId, property, sel.start)) {
      e.preventDefault();
      void import('./inline/LinkPopups.tsx').then((mod2) => {
        const h = mod2.useLinkHover.getState().hover;
        if (h) mod2.followLink(h.href);
      });
      return;
    }

    switch (k) {
      case 'Enter': {
        e.preventDefault();
        if (e.shiftKey || isCode) {
          insertTextAtSelection(blockId, property, api, '\n');
          return;
        }
        if (property !== 'title') return;
        closeSlashMenu();
        splitBlock(blockId, sel.start, sel.end);
        return;
      }
      case 'Backspace': {
        if (collapsed && sel.start === 0 && property === 'title') {
          e.preventDefault();
          backspaceAtStart(blockId);
        }
        return;
      }
      case 'Delete': {
        if (collapsed && sel.end === length(value) && property === 'title') {
          e.preventDefault();
          deleteAtEnd(blockId);
        }
        return;
      }
      case 'Tab': {
        e.preventDefault();
        if (isCode) {
          if (!e.shiftKey) insertTextAtSelection(blockId, property, api, '\t');
          return;
        }
        if (property !== 'title') return;
        if (e.shiftKey) outdent(blockId, sel.start);
        else indent(blockId, sel.start);
        return;
      }
      case ' ': {
 // "Press ‘space’ for AI" in an empty text block: the AI owner marks the event handled
        if (!e.shiftKey && !m && property === 'title' && b.type === 'text' && length(value) === 0) {
          const ev = new CustomEvent('nc:ask-ai', { detail: { blockId, property, start: 0, end: 0, trigger: 'space', handled: false } });
          window.dispatchEvent(ev);
          if ((ev.detail as any).handled) e.preventDefault();
        }
        return;
      }
      case 'ArrowUp':
      case 'ArrowDown': {
        if (e.shiftKey || e.altKey) {
          if (e.shiftKey && !e.altKey) {
 // Shift+Arrow at the edge of the block selects the block
            const line = api.caretLine();
            const atEdge = k === 'ArrowUp' ? line.first && (sel.start === 0 || collapsed) : line.last && (sel.end === length(value) || collapsed);
            if (atEdge && (collapsed || (k === 'ArrowUp' ? sel.start === 0 : sel.end === length(value)))) {
              e.preventDefault();
              useEditor.getState().selectBlocks([blockId], blockId);
            }
          }
          return;
        }
        const line = api.caretLine();
        const up = k === 'ArrowUp';
        if ((up && line.first) || (!up && line.last)) {
          const target = neighborLeaf(blockId, up ? -1 : 1, property);
          if (target) {
            e.preventDefault();
            useEditor.getState().requestFocus(target.dataset.blockId!, 0, { property: target.dataset.property ?? 'title', x: line.x, line: up ? 'last' : 'first' });
          } else if (up) {
            e.preventDefault();
            api.setSelection(0);
          } else {
            e.preventDefault();
            api.setSelection(length(value));
          }
        }
        return;
      }
      case 'ArrowLeft': {
 // ← onto an inline equation opens its editor
        if (!e.shiftKey && !e.metaKey && !e.altKey && collapsed && sel.start > 0 && isEquationAt(value, sel.start - 1)) {
          e.preventDefault();
          void import('./inline/EquationEditor.tsx').then((m) => m.openEquationEditor(blockId, property, sel.start - 1, { from: 'right' }));
          return;
        }
 // ⌘← / ⌘→ are line start / end (macOS): never leave the block
        if (!e.shiftKey && !e.metaKey && collapsed && sel.start === 0) {
          const target = neighborLeaf(blockId, -1, property);
          if (target) {
            e.preventDefault();
            useEditor.getState().requestFocus(target.dataset.blockId!, 'end', { property: target.dataset.property ?? 'title' });
          }
        }
        return;
      }
      case 'ArrowRight': {
        if (!e.shiftKey && !e.metaKey && !e.altKey && collapsed && isEquationAt(value, sel.start)) {
          e.preventDefault();
          void import('./inline/EquationEditor.tsx').then((m) => m.openEquationEditor(blockId, property, sel.start, { from: 'left' }));
          return;
        }
        if (!e.shiftKey && !e.metaKey && collapsed && sel.end === length(value)) {
          const target = neighborLeaf(blockId, 1, property);
          if (target) {
            e.preventDefault();
            useEditor.getState().requestFocus(target.dataset.blockId!, 0, { property: target.dataset.property ?? 'title' });
          }
        }
        return;
      }
      case 'Escape': {
        if (useEditor.getState().slash) return;
        e.preventDefault();
        useEditor.getState().selectBlocks([blockId], blockId);
        return;
      }
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLElement>, api: LeafApi) => {
    e.preventDefault();
    const plainOnly = Date.now() < plainPasteUntil;
    plainPasteUntil = 0;
    if (property === 'title' && suggestingIn(blockId)) {
 // pasting while suggesting suggests the plain text
      const text = (e.clipboardData.getData('text/plain') ?? '').replace(/\r\n?/g, '\n');
      const sel = api.selection() ?? { start: 0, end: 0 };
      if (text) suggestReplace(blockId, api.value(), sel.start, sel.end, text);
      return;
    }
    pasteIntoBlock(blockId, property, api, e.clipboardData, { plain: plainOnly });
  };

  return { onChange, onKeyDown, onPaste };
}

/** * Keys in suggest mode: Enter suggests a line break, formatting shortcuts suggest formatting, structural keys (merge, * indent, turn into, duplicate, move, links, equations) do nothing — they can't be expressed as text suggestions. * Returns true when the key was handled here. */
function suggestModeKey(e: ReactKeyboardEvent<HTMLElement>, api: LeafApi, blockId: string): boolean {
  const k = e.key;
  const m = mod(e);
  const sel = api.selection() ?? { start: 0, end: 0 };
  const collapsed = sel.start === sel.end;
  const block = (fn: () => void = () => {}) => {
    e.preventDefault();
    fn();
    return true;
  };
  if (m && !e.altKey) {
    const lower = k.toLowerCase();
    const fmt: Record<string, Annotation> = { b: ['b'], i: ['i'], u: ['_'], e: ['c'] };
    if (!e.shiftKey && fmt[lower]) return block(() => { if (!collapsed) suggestFormatRange(blockId, sel.start, sel.end, fmt[lower]); });
    if (e.shiftKey && (lower === 's' || lower === 'x')) return block(() => { if (!collapsed) suggestFormatRange(blockId, sel.start, sel.end, ['s']); });
    if (e.shiftKey && lower === 'h') {
      return block(() => {
        void import('./inline/format.ts').then(({ lastUsedColor }) => {
          const c = lastUsedColor();
          if (c && !collapsed) suggestFormatRange(blockId, sel.start, sel.end, ['h', c]);
        });
      });
    }
    if ((e.shiftKey && (lower === 'e' || k === 'ArrowUp' || k === 'ArrowDown')) || lower === 'k' || lower === 'd' || k === 'Enter') return block();
    return false;
  }
  if (m && e.altKey) return block();
  switch (k) {
    case 'Enter':
      return block(() => suggestReplace(blockId, api.value(), sel.start, sel.end, '\n'));
    case 'Tab':
      return block();
    case 'Backspace':
      return collapsed && sel.start === 0 ? block() : false;
    case 'Delete':
      return collapsed && sel.end === length(api.value()) ? block() : false;
    default:
      return false;
  }
}

export function insertTextAtSelection(blockId: string, property: string, api: LeafApi, s: string) {
  const sel = api.selection() ?? { start: 0, end: 0 };
  const value = api.value();
  let next = deleteRange(value, sel.start, sel.end);
  next = insertText(next, sel.start, s, annotationsAt(value, sel.start));
  commitText(blockId, property, next, sel.start + s.length);
  useEditor.getState().requestFocus(blockId, sel.start + s.length, { property });
}

export function toggleMark(blockId: string, property: string, api: LeafApi, ann: Annotation) {
  const sel = api.selection();
  if (!sel) return;
  const value = api.value();
  if (sel.start === sel.end) {
 // collapsed: toggle the mark for the next typed characters
    const active = annotationsAt(value, sel.start);
    const has = active.some((a) => a[0] === ann[0]);
    api.setPendingMarks(has ? active.filter((a) => a[0] !== ann[0]) : [...active, ann]);
    return;
  }
  const next = toggleAnnotation(value, sel.start, sel.end, ann);
  commitText(blockId, property, next, sel.end, { coalesce: false, action: 'textAnnotationActions.annotateSelection' });
  useEditor.getState().requestFocus(blockId, sel.start, { end: sel.end, property });
}

export function applyMark(blockId: string, property: string, start: number, end: number, ann: Annotation | null, removeKey?: Annotation[0]) {
  const value = (property === 'title' ? titleOf(blockId) : ((getBlock(blockId)?.properties as any)?.[property] ?? [])) as RichText;
  let next = value;
  if (removeKey) next = removeAnnotation(next, start, end, removeKey);
  if (ann) next = addAnnotation(next, start, end, ann);
  commitText(blockId, property, next, end, { coalesce: false, action: 'applyAnnotation' });
}

export function isMarked(blockId: string, start: number, end: number, key: Annotation[0]) {
  return hasAnnotation(titleOf(blockId), start, end, key);
}

export function toggleTodo(blockId: string) {
  const b = getBlock(blockId);
  const checked = b?.properties?.checked?.[0]?.[0] === 'Yes';
  run('toggleTodo', (tx) => setProperty(tx, blockId, 'checked', [[checked ? 'No' : 'Yes']]));
}

/** "---" → divider + a new focused text block below; "```" → empty code block with the caret inside. */
function convertInstant(blockId: string, type: BlockType) {
  if (type === 'divider') {
    run('textFilterActions.runAllFiltersAfterTransaction', (tx) => {
      tx.update('block', blockId, [], { type: 'divider' });
      setTitle(tx, blockId, []);
    });
    insertAfter(blockId, 'text');
    return;
  }
  if (type === 'code') {
    const sticky = stickyFormat('code');
    run('textFilterActions.runAllFiltersAfterTransaction', (tx) => {
      tx.update('block', blockId, [], { type: 'code' });
      tx.set('block', blockId, ['properties', 'language'], sticky.properties?.language ?? [['JavaScript']]);
      if (sticky.format) tx.update('block', blockId, ['format'], sticky.format);
      setTitle(tx, blockId, []);
    });
    useEditor.getState().requestFocus(blockId, 0);
  }
}

export { useUI, TEXT_BLOCKS };

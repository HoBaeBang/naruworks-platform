// Editor interaction state: focused leaf + caret, pending focus requests, block selection,
// hovered block (for the gutter handle) and active text menus (slash, mention, inline toolbar).
import { create } from 'zustand';
import type { Annotation } from '@nc/shared/richtext.ts';

export interface FocusRequest {
  blockId: string;
  property?: string;
  offset: number | 'end' | 'start';
  end?: number;
  /** x-coordinate to place caret on first/last line when moving vertically */
  x?: number;
  line?: 'first' | 'last';
  /** marks for the next typed characters (e.g. stop bold continuing after **bold** autoformat) */
  marks?: Annotation[];
  seq: number;
}

export interface SlashState {
  blockId: string;
  property: string;
  start: number; // offset of the "/" (or "@", "[[", ":")
  trigger: '/' | '@' | '[[' | ':' | '+';
  query: string;
}

interface EditorState {
  focused: { blockId: string; property: string } | null;
  caret: { start: number; end: number } | null;
  focusRequest: FocusRequest | null;
  selectedBlocks: string[];
  selectionAnchor: string | null;
  hoverBlock: string | null;
  slash: SlashState | null;
  dragging: string[] | null;
  readOnlyPages: Record<string, boolean>;
  /** inline equation whose editor popover is open (token gets the "selected" look) */
  editingEquation: { blockId: string; property: string; offset: number } | null;
  /** block whose action menu (⋮⋮ click / ⌘/) is open: its gutter stays visible with the handle pressed */
  blockMenuFor?: string | null;
  set: (p: Partial<EditorState>) => void;
  requestFocus: (blockId: string, offset: FocusRequest['offset'], opts?: Partial<FocusRequest>) => void;
  selectBlocks: (ids: string[], anchor?: string | null) => void;
  clearBlockSelection: () => void;
}

let seq = 1;

export const useEditor = create<EditorState>((set) => ({
  focused: null,
  caret: null,
  focusRequest: null,
  selectedBlocks: [],
  selectionAnchor: null,
  hoverBlock: null,
  slash: null,
  dragging: null,
  readOnlyPages: {},
  editingEquation: null,
  blockMenuFor: null,
  set: (p) => set(p),
  requestFocus: (blockId, offset, opts) => set({ focusRequest: { blockId, offset, property: 'title', ...opts, seq: seq++ }, selectedBlocks: [] }),
  selectBlocks: (ids, anchor) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    window.getSelection()?.removeAllRanges();
    set({ selectedBlocks: ids, selectionAnchor: anchor ?? ids[0] ?? null, focused: null });
  },
  clearBlockSelection: () => set({ selectedBlocks: [], selectionAnchor: null }),
}));

/** All editable text leaves of the active page in document order (for arrow-key navigation). */
export function leavesInOrder(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('.lit-page-content [data-content-editable-leaf="true"], .nc-page-title [data-content-editable-leaf="true"]')).filter(
    (el) => el.isContentEditable && el.offsetParent !== null,
  );
}

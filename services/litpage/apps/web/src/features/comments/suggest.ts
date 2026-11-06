
// ("Suggest edits" → `nc:suggest-edits`), the block menu (⋮⋮ › Suggest edits), the selection card's ✎ button or
// ⌘⇧⌥X; left with the topbar pill's × ("Turn off suggesting"). Comment-only users are always suggesting when they
// type (their edits can only be suggestions). The editing behavior lives in suggestEdits.ts.
import { create } from 'zustand';
import type { BlockRecord } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { getBlock } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useBlock, useRole } from '../../lib/hooks.ts';
import { useEditor } from '../editor/editorState.ts';
import { pageIdOfBlock } from '../editor/commands.ts';

interface SuggestState {
  pages: Record<string, boolean>;
}

const KEY = 'nc:suggesting';

function load(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Record<string, boolean>;
  } catch {
    return {};
  }
}

export const useSuggest = create<SuggestState>(() => ({ pages: load() }));

function save(pages: Record<string, boolean>) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(pages));
  } catch {
    
  }
}


export function canSuggest(pageId: string): boolean {
  const page = getBlock(pageId);
  if (!page || page.alive === false) return false;
  if (page.format?.block_locked) return false;
  return roleAtLeast(records.role('block', pageId), 'comment_only');
}


export function commentOnly(pageId: string): boolean {
  const r = records.role('block', pageId);
  return roleAtLeast(r, 'comment_only') && !roleAtLeast(r, 'read_and_write');
}

export function isSuggesting(pageId: string | undefined | null): boolean {
  if (!pageId) return false;
  return !!useSuggest.getState().pages[pageId] && canSuggest(pageId);
}

export function setSuggesting(pageId: string, on: boolean) {
  const pages = { ...useSuggest.getState().pages };
  if (on && canSuggest(pageId)) pages[pageId] = true;
  else delete pages[pageId];
  useSuggest.setState({ pages });
  save(pages);
}

export function toggleSuggesting(pageId: string) {
  setSuggesting(pageId, !isSuggesting(pageId));
}


export const SUGGESTABLE_TYPES = new Set(['text', 'to_do', 'header', 'sub_header', 'sub_sub_header', 'header_4', 'bulleted_list', 'numbered_list']);


export function useCommenterSuggesting(block: BlockRecord): boolean {
  const pageId = pageIdOfBlock(block.id) ?? null;
  useBlock(pageId); // lock changes
  const role = useRole('block', pageId ?? '');
  if (!pageId || !SUGGESTABLE_TYPES.has(block.type)) return false;
  return roleAtLeast(role, 'comment_only') && !roleAtLeast(role, 'read_and_write') && canSuggest(pageId);
}


export function startSuggestingFrom(blockId: string) {
  const pageId = pageIdOfBlock(blockId);
  if (!pageId) return;
  setSuggesting(pageId, true);
  const b = getBlock(blockId);
  if (b && b.type !== 'page') useEditor.getState().requestFocus(blockId, 'end');
}


export function startSuggestingOnRange(r: { blockId: string; property: string; start: number; end: number }) {
  const pageId = pageIdOfBlock(r.blockId);
  if (!pageId) return;
  if (isSuggesting(pageId)) {
    setSuggesting(pageId, false);
    return;
  }
  setSuggesting(pageId, true);
  useEditor.getState().requestFocus(r.blockId, r.start, { property: r.property, end: r.end });
}


window.addEventListener('nc:suggest-edits', ((e: CustomEvent) => {
  const pageId = (e.detail as { pageId?: string } | undefined)?.pageId;
  if (pageId) toggleSuggesting(pageId);
}) as EventListener);

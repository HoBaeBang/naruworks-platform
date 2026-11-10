// Shared helpers for inline trigger menus ("/", "@", "[[", "+", ":"): the active trigger lives in
// useEditor.slash = { blockId, property, start, trigger, query }. Picking an item replaces "<trigger><query>".
import { create } from 'zustand';
import { deleteRange, insertRich, insertText, length, type RichText } from '@nc/shared/richtext.ts';
import { run, setProperty, setTitle } from '../../../lib/blocks.ts';
import { useEditor } from '../editorState.ts';
import { valueOf } from './format.ts';

/** Ghost completion shown after the trigger text ("/Type to search", "@Today"). */
export const useTriggerUI = create<{ ghost: string }>(() => ({ ghost: '' }));

function write(blockId: string, property: string, next: RichText, action: string) {
  run(action, (tx) => (property === 'title' ? setTitle(tx, blockId, next) : setProperty(tx, blockId, property, next)));
}

/** Remove "<trigger><query>" block; returns where it started and whether the block is now empty. */
export function consumeTriggerText(action = 'slash.consume'): { blockId: string; property: string; start: number; empty: boolean } | null {
  const s = useEditor.getState().slash;
  if (!s) return null;
  const value = valueOf(s.blockId, s.property);
  const end = Math.min(s.start + s.trigger.length + s.query.length, length(value));
  const next = deleteRange(value, s.start, end);
  write(s.blockId, s.property, next, action);
  return { blockId: s.blockId, property: s.property, start: s.start, empty: length(next) === 0 };
}

/** Replace the trigger text with an inline atom and trailing space. */
export function insertAtomForTrigger(atom: RichText, opts?: { trailingSpace?: boolean; action?: string }) {
  const s = useEditor.getState().slash;
  if (!s) return;
  const value = valueOf(s.blockId, s.property);
  const end = Math.min(s.start + s.trigger.length + s.query.length, length(value));
  let next = deleteRange(value, s.start, end);
  const ins: RichText = opts?.trailingSpace === false ? atom : [...atom, [' ']];
  next = insertRich(next, s.start, ins);
  write(s.blockId, s.property, next, opts?.action ?? 'MentionMenu.menuItem');
  const caret = s.start + length(ins);
  closeTrigger();
  useEditor.getState().requestFocus(s.blockId, caret, { property: s.property });
}

/** Replace the trigger text with plain text (emoji). */
export function insertTextForTrigger(text: string, action = 'EmojiMenu.handleSubmit') {
  const s = useEditor.getState().slash;
  if (!s) return;
  const value = valueOf(s.blockId, s.property);
  const end = Math.min(s.start + s.trigger.length + s.query.length, length(value));
  let next = deleteRange(value, s.start, end);
  next = insertText(next, s.start, text, []);
  write(s.blockId, s.property, next, action);
  closeTrigger();
  useEditor.getState().requestFocus(s.blockId, s.start + text.length, { property: s.property });
}

let closer: (() => void) | null = null;
export function setTriggerCloser(fn: (() => void) | null) {
  closer = fn;
}
export function closeTrigger() {
  const f = closer;
  closer = null;
  f?.();
  if (useEditor.getState().slash) useEditor.setState({ slash: null });
  useTriggerUI.setState({ ghost: '' });
}

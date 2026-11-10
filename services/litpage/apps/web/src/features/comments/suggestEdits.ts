
// heading and list blocks become suggestions instead of changes (packages/shared/src/richtextSuggest.ts):
//   typing → ["si", id] text, deleting → ["si"] text of your own disappears, other text gets ["sr", id] (struck),
//   typing over a selection → "Replace “old” with “new”", ⌘B/⌘I/… → ["sa", id, mark].
// Each suggestion is a discussion (type "suggestion") on the block whose first comment ({suggestion: true}) stands for
// the change (reactions, replies). Accept applies it, Reject drops it; both resolve the thread
// (suggestion_status). The server only lets commenters write their own suggestions (apps/server/src/authz.ts).
import type { BlockRecord, CommentRecord, DiscussionRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { toPlainText, type Annotation, type RichText } from '@nc/shared/richtext.ts';
import {
  acceptSuggestion as acceptIn, adjacentSuggestionId, hasSuggestion, rejectSuggestion as rejectIn, suggestEdit, suggestFormat, suggestionIds,
  summarizeSuggestion, type SuggestionSummary,
} from '@nc/shared/richtextSuggest.ts';
import { getBlock, me, run, setTitle } from '../../lib/blocks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { api } from '../../lib/api.ts';
import { useEditor } from '../editor/editorState.ts';
import { getSelectionOffsets } from '../editor/richTextDom.ts';
import { pageIdOfBlock } from '../editor/commands.ts';
import { afterSaved } from './comments.tsx';
import { canSuggest, commentOnly, isSuggesting, SUGGESTABLE_TYPES } from './suggest.ts';

export { SUGGESTABLE_TYPES };



export function suggestingIn(blockId: string): boolean {
  const b = getBlock(blockId);
  if (!b || !SUGGESTABLE_TYPES.has(b.type)) return false;
  const pageId = pageIdOfBlock(blockId);
  if (!pageId) return false;
  return isSuggesting(pageId) || (commentOnly(pageId) && canSuggest(pageId));
}

function discussion(id: string): DiscussionRecord | undefined {
  return records.get<DiscussionRecord>('discussion', id);
}


function mineOpen(id: string): boolean {
  const d = discussion(id);
  return !!d && d.type === 'suggestion' && d.created_by_id === me() && !d.resolved && d.alive !== false;
}

function titleOf(blockId: string): RichText {
  return ((getBlock(blockId)?.properties?.title as RichText | undefined) ?? []);
}

type Tx = Parameters<Parameters<typeof run>[1]>[0];

function createSuggestionThread(tx: Tx, block: BlockRecord, did: string) {
  const now = Date.now();
  const cid = newId();
  tx.set('discussion', did, [], {
    id: did, parent_id: block.id, parent_table: 'block', resolved: false, comments: [], space_id: block.space_id, alive: true,
    type: 'suggestion', created_by_id: me(), created_time: now,
  } as any);
  tx.listAfter('block', block.id, ['discussions'], did);
  tx.set('comment', cid, [], {
    id: cid, parent_id: did, parent_table: 'discussion', text: [], suggestion: true, created_by_id: me(), created_time: now, last_edited_time: now,
    alive: true, space_id: block.space_id,
  } as any);
  tx.listAfter('discussion', did, ['comments'], cid);
  return cid;
}


function dropEmpty(tx: Tx, blockId: string, prev: RichText, next: RichText) {
  for (const id of suggestionIds(prev)) {
    if (!mineOpen(id) || hasSuggestion(next, id)) continue;
    const d = discussion(id);
    for (const c of d?.comments ?? []) tx.update('comment', c, [], { alive: false });
    tx.update('discussion', id, [], { alive: false });
    tx.listRemove('block', blockId, ['discussions'], id);
  }
}

// owners of the page hear about a suggestion once the author paused typing (no notification per keystroke)
const notifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
function notifySoon(did: string) {
  const t = notifyTimers.get(did);
  if (t) clearTimeout(t);
  notifyTimers.set(did, setTimeout(() => {
    notifyTimers.delete(did);
    const d = discussion(did);
    const first = d?.comments?.[0];
    if (!d || d.alive === false || !first) return;
    afterSaved(() => void api('notifyComment', { commentId: first }).catch(() => {}));
  }, 2500));
}


export function applySuggestedEdit(blockId: string, leafPrev: RichText, next: RichText, inputType: string): boolean {
  const block = getBlock(blockId);
  if (!block) return false;
  // the leaf's previous value is rebuilt from its DOM and can lag behind the store's suggestion marks when typing fast;
  // the stored value (same text) is the right base
  const stored = titleOf(blockId);
  const prev = toPlainText(stored) === toPlainText(leafPrev) ? stored : leafPrev;
  const a = toPlainText(prev);
  const z = toPlainText(next);
  if (a === z) return false;
  let p = 0;
  const max = Math.min(a.length, z.length);
  while (p < max && a[p] === z[p]) p++;
  let s = 0;
  while (s < max - p && a[a.length - 1 - s] === z[z.length - 1 - s]) s++;
  let start = p;
  let end = a.length - s;
  const inserted = z.slice(p, z.length - s);
  // "S" typed before "Second" (or Backspace in "ss") diffs to several equivalent places; which characters carry the
  // suggestion marks matters, so the real caret decides
  const leaf = document.activeElement as HTMLElement | null;
  const sel = leaf?.dataset?.blockId === blockId && leaf.dataset.property === 'title' ? getSelectionOffsets(leaf) : null;
  if (sel && sel.start === sel.end) {
    const at = inserted ? sel.end - inserted.length : sel.end;
    const len = end - start;
    if (at >= 0 && at !== start && at + len <= a.length) {
      const same = a.slice(0, at) + inserted + a.slice(at + len) === a.slice(0, start) + inserted + a.slice(end);
      if (same) {
        start = at;
        end = at + len;
      }
    }
  }
  return suggestReplace(blockId, prev, start, end, inserted, inputType === 'deleteContentForward' || inputType === 'deleteWordForward');
}


export function suggestReplace(blockId: string, prev: RichText, start: number, end: number, inserted: string, forward = false): boolean {
  const block = getBlock(blockId);
  if (!block) return false;
  const existing = adjacentSuggestionId(prev, start, end, mineOpen);
  const did = existing ?? newId();
  const res = suggestEdit(prev, start, end, inserted, { insertId: did, removeId: did, mine: mineOpen, forward });
  const needThread = !existing && res.used.includes(did);
  run('suggestEdits.suggest', (tx) => {
    if (needThread) createSuggestionThread(tx, block, did);
    setTitle(tx, blockId, res.value, prev);
    dropEmpty(tx, blockId, prev, res.value);
  }, { coalesceKey: `suggest:${blockId}:${did}`, selectionAfter: { blockId, offset: res.caret } });
  useEditor.getState().requestFocus(blockId, res.caret);
  if (res.used.includes(did)) notifySoon(did);
  return true;
}


export function suggestReplacements(ranges: { blockId: string; start: number; end: number }[], inserted: string): number {
  const byBlock = new Map<string, { start: number; end: number }[]>();
  for (const r of ranges) byBlock.set(r.blockId, [...(byBlock.get(r.blockId) ?? []), r]);
  const plans: { block: BlockRecord; prev: RichText; value: RichText; threads: string[] }[] = [];
  let n = 0;
  for (const [blockId, list] of byBlock) {
    const block = getBlock(blockId);
    if (!block) continue;
    const prev = titleOf(blockId);
    let value = prev;
    const threads: string[] = [];
    // last match first: earlier offsets stay valid while struck / inserted text grows the title
    for (const r of [...list].sort((a, b) => b.start - a.start)) {
      const did = newId();
      const res = suggestEdit(value, r.start, r.end, inserted, { insertId: did, removeId: did, mine: mineOpen });
      if (!res.used.includes(did)) continue;
      value = res.value;
      threads.push(did);
      n++;
    }
    if (threads.length) plans.push({ block, prev, value, threads });
  }
  if (!plans.length) return 0;
  run('suggestEdits.replaceAll', (tx) => {
    for (const p of plans) {
      for (const did of p.threads) createSuggestionThread(tx, p.block, did);
      setTitle(tx, p.block.id, p.value, p.prev);
    }
  });
  for (const p of plans) for (const did of p.threads) notifySoon(did);
  return n;
}


export function suggestFormatRange(blockId: string, start: number, end: number, ann: Annotation) {
  const block = getBlock(blockId);
  if (!block || end <= start) return;
  const prev = titleOf(blockId);
  const did = newId();
  const value = suggestFormat(prev, start, end, ann, did);
  run('suggestEdits.format', (tx) => {
    createSuggestionThread(tx, block, did);
    setTitle(tx, blockId, value, prev);
  });
  useEditor.getState().requestFocus(blockId, start, { end });
  notifySoon(did);
}



export function canReview(did: string): boolean {
  const d = discussion(did);
  if (!d) return false;
  const page = getBlock(pageIdOfBlock(d.parent_id));
  return roleAtLeast(records.role('block', d.parent_id), 'read_and_write') && !page?.format?.block_locked;
}

export function canReject(did: string): boolean {
  const d = discussion(did);
  return !!d && (canReview(did) || (d.created_by_id === me() && roleAtLeast(records.role('block', d.parent_id), 'comment_only')));
}

function close(tx: Tx, did: string, status: 'accepted' | 'rejected') {
  // the change description is kept on the thread (the annotations are gone once it is applied / dropped)
  const summary = suggestionSummary(did);
  tx.update('discussion', did, [], {
    resolved: true, resolved_by_id: me(), resolved_time: Date.now(), suggestion_status: status,
    ...(summary && summary.kind !== 'empty' ? { suggestion_summary: summary } : {}),
  } as any);
}

export function acceptSuggestion(did: string) {
  const d = discussion(did);
  if (!d || !canReview(did)) return;
  const prev = titleOf(d.parent_id);
  run('suggestEdits.accept', (tx) => {
    setTitle(tx, d.parent_id, acceptIn(prev, did), prev);
    close(tx, did, 'accepted');
  });
}

export function rejectSuggestion(did: string) {
  const d = discussion(did);
  if (!d || !canReject(did)) return;
  const prev = titleOf(d.parent_id);
  run('suggestEdits.reject', (tx) => {
    setTitle(tx, d.parent_id, rejectIn(prev, did), prev);
    close(tx, did, 'rejected');
  });
}


export function openSuggestions(pageId: string): DiscussionRecord[] {
  const out: DiscussionRecord[] = [];
  const walk = (id: string, root: boolean) => {
    const b = getBlock(id);
    if (!b || b.alive === false) return;
    if (!root && (b.type === 'page' || b.type === 'collection_view_page')) return;
    for (const did of b.discussions ?? []) {
      const d = discussion(did);
      if (d && d.alive !== false && d.type === 'suggestion' && !d.resolved && hasSuggestion(b.properties?.title as RichText | undefined, did)) out.push(d);
    }
    for (const c of b.content ?? []) walk(c, false);
  };
  walk(pageId, true);
  return out;
}


export function reviewAll(pageId: string, how: 'accept' | 'reject') {
  const list = openSuggestions(pageId).filter((d) => (how === 'accept' ? canReview(d.id) : canReject(d.id)));
  if (!list.length) return;
  const byBlock = new Map<string, string[]>();
  for (const d of list) byBlock.set(d.parent_id, [...(byBlock.get(d.parent_id) ?? []), d.id]);
  run(how === 'accept' ? 'suggestEdits.acceptAll' : 'suggestEdits.rejectAll', (tx) => {
    for (const [blockId, dids] of byBlock) {
      const prev = titleOf(blockId);
      let v = prev;
      for (const did of dids) v = how === 'accept' ? acceptIn(v, did) : rejectIn(v, did);
      setTitle(tx, blockId, v, prev);
      for (const did of dids) close(tx, did, how === 'accept' ? 'accepted' : 'rejected');
    }
  });
  useUI.getState().toast(how === 'accept' ? `Accepted ${list.length} ${list.length === 1 ? 'suggestion' : 'suggestions'}` : `Rejected ${list.length} ${list.length === 1 ? 'suggestion' : 'suggestions'}`);
}


export function suggestionSummary(did: string): SuggestionSummary | null {
  const d = discussion(did);
  if (!d) return null;
  return summarizeSuggestion(getBlock(d.parent_id)?.properties?.title as RichText | undefined, did);
}


export function isSuggestionComment(c: CommentRecord | undefined): boolean {
  return !!c && !!c.suggestion;
}

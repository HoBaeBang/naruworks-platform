
// (['m', discussionId] highlights → margin threads or a popover, see margin.tsx), the comments sidebar,
// the composer (with @mentions), reactions, edit/delete, resolve/reopen and "Mute replies".
// Records: `discussion` (parent = block) and `comment` (parent = discussion), written with transactions;
// inbox notifications are fanned out by the server (api/modules/comments.ts).
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowUpCircle, MessageSquareDiff } from 'lucide-react';
import { create } from 'zustand';
import type { BlockRecord, CommentRecord, DiscussionRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { newId, compactId } from '@nc/shared/ids.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import {
  addAnnotation, dateMention, deleteRange, insertRich, insertText, length, mention, normalize, removeAnnotation, slice, toPlainText, type DateValue, type RichText,
} from '@nc/shared/richtext.ts';
import { addDays, isoDate, parseNaturalDate } from '../editor/inline/dates.ts';
import { useBlock, useCurrentUser, useRecord, useRecords, useRole, useTableVersion } from '../../lib/hooks.ts';
import { getBlock, me, pageOf, run } from '../../lib/blocks.ts';
import { api, uploadFile } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { pageUrl } from '../../lib/router.ts';
import { formatDateTime, timeAgo } from '../../lib/format.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { Menu, openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { RichTextEditable, type LeafApi } from '../editor/RichTextEditable.tsx';
import { renderRichText } from '../editor/richTextDom.ts';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';
import { confirmDialog } from '../page/confirm.tsx';
import { getCustomEmojis } from '../settings/customEmoji.ts';
import { canSuggest, commentOnly, isSuggesting, setSuggesting, useSuggest } from './suggest.ts';
import { acceptSuggestion, canReject, canReview, openSuggestions, rejectSuggestion, reviewAll, suggestionSummary } from './suggestEdits.ts';
import type { SuggestionSummary } from '@nc/shared/richtextSuggest.ts';
import { isDiscussionUnread, markCommentUnread, markDiscussionRead, unreadCommentIds } from './unread.ts';
import { Mail, MailOpen } from 'lucide-react';
import { registerIcons } from '../../components/Icon.tsx';
import './comments.css';
import { agentMentionItems } from '../agents/mentions.tsx';

registerIcons({ commentUnread: Mail, commentRead: MailOpen });

// ---------------------------------------------------------------------------------------------
// state shared by the page, margin, popovers and the sidebar

export interface CommentDraft {
  key: number;
  blockId: string;
  property: string;
  start: number;
  end: number;
  
  rect?: { x: number; y: number; width: number; height: number };
}

interface CommentsState {
  active: string | null;
  
  editing?: string | null;
  draft: CommentDraft | null;
  composingPage: Record<string, number>;
  marginMode: Record<string, boolean>;
  set: (p: Partial<CommentsState>) => void;
}

export const useComments = create<CommentsState>((set) => ({
  active: null,
  draft: null,
  composingPage: {},
  marginMode: {},
  set: (p) => set(p),
}));

let draftSeq = 1;

// ---------------------------------------------------------------------------------------------
// queries

export function isPageDiscussion(d: DiscussionRecord, pageId: string): boolean {
  return d.type === 'page' || (d.parent_id === pageId && !d.context?.length && d.type !== 'default');
}


export function pageBlocks(pageId: string): BlockRecord[] {
  const out: BlockRecord[] = [];
  const walk = (id: string, root: boolean) => {
    const b = getBlock(id);
    if (!b || !b.alive) return;
    if (!root && (b.type === 'page' || b.type === 'collection_view_page')) return;
    out.push(b);
    for (const c of b.content ?? []) walk(c, false);
  };
  walk(pageId, true);
  return out;
}

export function pageDiscussions(pageId: string): { d: DiscussionRecord; block: BlockRecord }[] {
  const out: { d: DiscussionRecord; block: BlockRecord }[] = [];
  for (const b of pageBlocks(pageId)) {
    for (const id of b.discussions ?? []) {
      const d = records.get<DiscussionRecord>('discussion', id);
      if (d && d.alive !== false) out.push({ d, block: b });
    }
  }
  return out;
}

function liveComments(d: DiscussionRecord): CommentRecord[] {
  return (d.comments ?? []).map((id) => records.get<CommentRecord>('comment', id)).filter((c): c is CommentRecord => !!c && c.alive !== false);
}

export function lastActivity(d: DiscussionRecord): number {
  const cs = liveComments(d);
  return Math.max(d.created_time ?? 0, ...cs.map((c) => c.created_time));
}



export function afterSaved(fn: () => void) {
  if (transactions.pendingCount() === 0) {
    fn();
    return;
  }
  const off = transactions.onSaveState((s) => {
    if (s.pending === 0) {
      off();
      if (!s.error) fn();
    }
  });
}

function notify(commentId: string, editedMentionsOnly = false) {
  afterSaved(() => void api('notifyComment', { commentId, editedMentionsOnly }).catch(() => {}));
}

// ---------------------------------------------------------------------------------------------
// mutations


export function addComment(
  blockId: string,
  text: RichText,
  discussionId?: string,
  context?: RichText,
  opts?: { type?: 'page' | 'default'; annotate?: { property: string; start: number; end: number }; propertyId?: string },
): string {
  const block = getBlock(blockId);
  const did = discussionId ?? newId();
  const cid = newId();
  const now = Date.now();
  const canEdit = roleAtLeast(records.role('block', blockId), 'read_and_write') && !(pageOf(blockId)?.format?.block_locked);
  run(discussionId ? 'Comment.reply' : 'Comment.create', (tx) => {
    if (!discussionId) {
      const d: Omit<DiscussionRecord, 'version'> = {
        id: did, parent_id: blockId, parent_table: 'block', resolved: false, comments: [], space_id: block?.space_id ?? tx.spaceId, alive: true,
        type: opts?.type ?? (block && (block.type === 'page' || block.type === 'collection_view_page') && !context?.length ? 'page' : 'default'),
        created_by_id: me(), created_time: now,
        ...(context?.length ? { context } : {}),
        ...(opts?.propertyId ? { property_id: opts.propertyId } : {}),
      };
      tx.set('discussion', did, [], d);
      tx.listAfter('block', blockId, ['discussions'], did);
      const a = opts?.annotate;
      if (a && canEdit && block && a.end > a.start) {
        const cur = (block.properties?.[a.property] as RichText | undefined) ?? [];
        tx.set('block', blockId, ['properties', a.property], addAnnotation(cur, a.start, a.end, ['m', did]));
      }
    }
    const c: Omit<CommentRecord, 'version'> = {
      id: cid, parent_id: did, parent_table: 'discussion', text: normalize(text), created_by_id: me(), created_time: now, last_edited_time: now,
      alive: true, space_id: block?.space_id ?? tx.spaceId,
    };
    tx.set('comment', cid, [], c);
    tx.listAfter('discussion', did, ['comments'], cid);
    if (discussionId) {
      
      const d = records.get<DiscussionRecord>('discussion', discussionId);
      if (d?.resolved) tx.update('discussion', did, [], { resolved: false });
      // replying un-mutes
      if (d?.muted_user_ids?.includes(me())) tx.update('discussion', did, [], { muted_user_ids: d.muted_user_ids.filter((u) => u !== me()) });
    }
  });
  notify(cid);
  return did;
}


export function addInlineReaction(blockId: string, property: string, start: number, end: number, emoji: string): string | null {
  const block = getBlock(blockId);
  if (!block || end <= start) return null;
  const cur = (block.properties?.[property] as RichText | undefined) ?? [];
  const context = slice(cur, start, end);
  // an open reaction thread on the same text: toggle this emoji on it
  for (const did of block.discussions ?? []) {
    const d = records.get<DiscussionRecord>('discussion', did);
    if (!d || d.alive === false || d.resolved || d.type === 'suggestion') continue;
    const first = records.get<CommentRecord>('comment', d.comments?.[0]);
    if (!first || length(first.text as RichText) || toPlainText(d.context as RichText) !== toPlainText(context)) continue;
    const users = first.reactions?.[emoji] ?? [];
    const others = Object.entries(first.reactions ?? {}).some(([k, u]) => (k !== emoji ? u?.length : u?.some((x) => x !== me())));
    if (users.includes(me()) && !others && (d.comments?.length ?? 0) === 1) {
      // taking back the only reaction removes the reaction thread (and its highlight)
      run('Comment.inlineReactionRemove', (tx) => {
        tx.update('comment', first.id, [], { alive: false });
        tx.update('discussion', did, [], { alive: false });
        tx.listRemove('block', blockId, ['discussions'], did);
        const v = (getBlock(blockId)?.properties?.[property] as RichText | undefined) ?? [];
        if (v.some((r) => (r[1] as any[] | undefined)?.some((a) => a[0] === 'm' && a[1] === did))) tx.set('block', blockId, ['properties', property], removeAnnotation(v, 0, length(v), 'm', did));
      });
      return null;
    }
    toggleReaction(first, emoji);
    return did;
  }
  const did = newId();
  const cid = newId();
  const now = Date.now();
  const canEdit = roleAtLeast(records.role('block', blockId), 'read_and_write') && !(pageOf(blockId)?.format?.block_locked);
  run('Comment.inlineReaction', (tx) => {
    tx.set('discussion', did, [], {
      id: did, parent_id: blockId, parent_table: 'block', resolved: false, comments: [], space_id: block.space_id, alive: true, type: 'default',
      created_by_id: me(), created_time: now, context,
    } as any);
    tx.listAfter('block', blockId, ['discussions'], did);
    if (canEdit) tx.set('block', blockId, ['properties', property], addAnnotation(cur, start, end, ['m', did]));
    tx.set('comment', cid, [], {
      id: cid, parent_id: did, parent_table: 'discussion', text: [], reactions: { [emoji]: [me()] }, created_by_id: me(), created_time: now,
      last_edited_time: now, alive: true, space_id: block.space_id,
    } as any);
    tx.listAfter('discussion', did, ['comments'], cid);
  });
  return did;
}


export function isPostReactions(d: DiscussionRecord): boolean {
  if (d.type !== 'page' || (d.comments?.length ?? 0) !== 1) return false;
  const first = records.get<CommentRecord>('comment', d.comments?.[0]);
  return !!first && !length(first.text as RichText) && !first.suggestion;
}


export function isReactionThread(d: DiscussionRecord): boolean {
  const first = records.get<CommentRecord>('comment', d.comments?.[0]);
  return !!first && !length(first.text as RichText) && !first.suggestion && Object.values(first.reactions ?? {}).some((u) => u?.length);
}

// the text action menu's 🙂 (features/editor/inline/TextActionMenu.tsx reactToSelection)
window.addEventListener('nc:inline-reaction', ((e: CustomEvent) => {
  const d = e.detail as { blockId: string; property: string; start: number; end: number; emoji: string; handled?: boolean };
  if (!d?.blockId || !d.emoji) return;
  d.handled = true;
  addInlineReaction(d.blockId, d.property ?? 'title', d.start, d.end, d.emoji);
}) as EventListener);

export function resolveDiscussion(id: string, resolved = true) {
  run(resolved ? 'Comment.resolve' : 'Comment.reopen', (tx) =>
    tx.update('discussion', id, [], resolved ? { resolved: true, resolved_by_id: me(), resolved_time: Date.now() } : { resolved: false, resolved_by_id: null, resolved_time: null }),
  );
  if (resolved && useComments.getState().active === id) useComments.getState().set({ active: null });
}

export async function deleteComment(c: CommentRecord) {
  const d = records.get<DiscussionRecord>('discussion', c.parent_id);
  if (!d) return;
  const live = liveComments(d);
  const first = live[0]?.id === c.id;
  const replies = live.length - 1;
  const ok = await confirmDialog(
    first && replies > 0
      ? {
          message: t('lp.comments.delete_the_comment_along_with_all', 'Delete the comment along with all replies?'),
          description: t('lp.comments.this_also_deletes_count_plural_one', 'This also deletes {count, plural, one {# reply} other {# replies}}.', { count: replies }),
        }
      : { message: t('lp.comments.delete_this_comment', 'Remove this comment?') },
  );
  if (!ok) return;
  if (!first) {
    run('Comment.delete', (tx) => {
      tx.update('comment', c.id, [], { alive: false });
      tx.listRemove('discussion', d.id, ['comments'], c.id);
    });
    return;
  }
  const block = getBlock(d.parent_id);
  const canEdit = roleAtLeast(records.role('block', d.parent_id), 'read_and_write');
  run('Comment.deleteDiscussion', (tx) => {
    for (const x of live) tx.update('comment', x.id, [], { alive: false });
    tx.update('discussion', d.id, [], { alive: false });
    tx.listRemove('block', d.parent_id, ['discussions'], d.id);
    if (block && canEdit) {
      for (const [prop, v] of Object.entries(block.properties ?? {})) {
        const rt = v as RichText;
        if (rt?.some((r) => (r[1] as any[])?.some((a) => a[0] === 'm' && a[1] === d.id))) {
          tx.set('block', block.id, ['properties', prop], removeAnnotation(rt, 0, length(rt), 'm', d.id));
        }
      }
    }
  });
  if (useComments.getState().active === d.id) useComments.getState().set({ active: null });
}

export function toggleReaction(c: CommentRecord, emoji: string) {
  const uid = me();
  const users = c.reactions?.[emoji] ?? [];
  const has = users.includes(uid);
  const next = has ? users.filter((u) => u !== uid) : [...users, uid];
  run('Comment.react', (tx) => tx.set('comment', c.id, ['reactions', emoji], next));
  // reactions on a page (Feed post) have no comment author to notify
  const d = records.get<DiscussionRecord>('discussion', c.parent_id);
  if (!has && !(d && isPostReactions(d))) afterSaved(() => void api('notifyReaction', { commentId: c.id, emoji }).catch(() => {}));
}

function setMuted(d: DiscussionRecord, muted: boolean) {
  const uid = me();
  const cur = d.muted_user_ids ?? [];
  run('Comment.mute', (tx) => tx.update('discussion', d.id, [], { muted_user_ids: muted ? [...new Set([...cur, uid])] : cur.filter((u) => u !== uid) }));
  useUI.getState().toast(muted
    ? t('lp.comments.this_discussion_s_replies_are_now', 'This discussion’s replies are now muted')
    : t('lp.comments.this_discussion_s_replies_are_now_c67b', 'This discussion’s replies are now unmuted'));
}

export function discussionLink(d: DiscussionRecord): string {
  const page = pageOf(d.parent_id);
  return `${location.origin}${pageUrl(page?.id ?? d.parent_id)}?d=${compactId(d.id)}`;
}

// ---------------------------------------------------------------------------------------------
// entry points used by the page header, block menu (⋮⋮ → Comment) and the editor's inline toolbar

export function startPageComment(pageId: string) {
  const s = useComments.getState();
  s.set({ composingPage: { ...s.composingPage, [pageId]: Date.now() } });
  window.dispatchEvent(new CustomEvent('nc:page-comment', { detail: { pageId } }));
}

function rectOfRange(blockId: string, property: string, start: number, end: number): CommentDraft['rect'] | undefined {
  const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${blockId}"][data-property="${property}"]`)
    ?? document.querySelector<HTMLElement>(`[data-block-id="${blockId}"]`);
  if (!leaf) return undefined;
  const range = rangeIn(leaf, start, end);
  const r = range?.getBoundingClientRect();
  const rr = r && r.width + r.height > 0 ? r : leaf.getBoundingClientRect();
  return { x: rr.left, y: rr.top, width: rr.width, height: rr.height };
}


export function rangeIn(leaf: HTMLElement, start: number, end: number): Range | null {
  const pos = (target: number): { node: Node; offset: number } | null => {
    let remaining = target;
    let last: { node: Node; offset: number } | null = null;
    const walk = (n: Node): { node: Node; offset: number } | null => {
      if (n.nodeType === 3) {
        const len = n.nodeValue?.length ?? 0;
        if (remaining <= len) return { node: n, offset: remaining };
        remaining -= len;
        last = { node: n, offset: len };
        return null;
      }
      const el = n as HTMLElement;
      if (el.dataset?.atom === '1') {
        const parent = el.parentNode!;
        const idx = Array.from(parent.childNodes).indexOf(el as ChildNode);
        if (remaining === 0) return { node: parent, offset: idx };
        remaining -= 1;
        last = { node: parent, offset: idx + 1 };
        return remaining === 0 ? last : null;
      }
      for (const c of Array.from(n.childNodes)) {
        const r = walk(c);
        if (r) return r;
      }
      return null;
    };
    for (const c of Array.from(leaf.childNodes)) {
      const r = walk(c);
      if (r) return r;
    }
    return last ?? { node: leaf, offset: 0 };
  };
  const s = pos(start);
  const e = pos(end);
  if (!s || !e) return null;
  try {
    const r = document.createRange();
    r.setStart(s.node, s.offset);
    r.setEnd(e.node, e.offset);
    return r;
  } catch {
    return null;
  }
}


export function startCommentOnSelection(blockId: string, start: number, end: number, property = 'title') {
  const block = getBlock(blockId);
  if (!block) return;
  const len = length(block.properties?.[property] as RichText | undefined);
  const s = Math.max(0, Math.min(start, end, len));
  const e = Math.min(len, Math.max(start, end));
  window.getSelection()?.removeAllRanges();
  (document.activeElement as HTMLElement | null)?.blur?.();
  useComments.getState().set({
    draft: { key: draftSeq++, blockId, property, start: s, end: e, rect: rectOfRange(blockId, property, s, e) },
    active: null,
  });
  window.dispatchEvent(new CustomEvent('nc:comment-draft'));
}


export function startCommentOnBlock(blockId: string) {
  const b = getBlock(blockId);
  if (!b) return;
  const len = length(b.properties?.title as RichText | undefined);
  if (len > 0 && b.type !== 'page' && b.type !== 'code') startCommentOnSelection(blockId, 0, len, 'title');
  else startCommentOnSelection(blockId, 0, 0, 'title');
}

export function submitDraft(draft: CommentDraft, text: RichText) {
  const block = getBlock(draft.blockId);
  if (!block) return;
  const cur = (block.properties?.[draft.property] as RichText | undefined) ?? [];
  const context = draft.end > draft.start ? slice(cur, draft.start, draft.end) : undefined;
  const did = addComment(draft.blockId, text, undefined, context, {
    type: 'default',
    annotate: draft.end > draft.start ? { property: draft.property, start: draft.start, end: draft.end } : undefined,
  });
  useComments.getState().set({ draft: null, active: did });
}

// ---------------------------------------------------------------------------------------------
// rendering helpers

export function RichTextView({ value, className }: { value: RichText | undefined; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) renderRichText(ref.current, value ?? []);
  }, [value]);
  return <div ref={ref} className={className} />;
}

function workspaceUsers(): UserRecord[] {
  const spaceId = useSession.getState().spaceId;
  const space = records.get<SpaceRecord>('space', spaceId);
  const ids = new Set((space?.permissions ?? []).map((p) => p.user_id).filter(Boolean) as string[]);
  for (const u of records.all<UserRecord>('lit_user')) ids.add(u.id);
  // Custom Agents' own users (bots) are listed under "Agents", not People
  return [...ids].map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u && !!(u.name || u.email) && !(u as { bot?: unknown }).bot);
}

const useMentionQuery = create<{ q: string }>(() => ({ q: '' }));

type MentionPick = (kind: 'u' | 'p' | 'd', id: string, date?: DateValue) => void;

function MentionMenu({ close, onPick }: { close: () => void; onPick: MentionPick }) {
  const q = useMentionQuery((s) => s.q);
  const def = useMemo(() => {
    
    const today = new Date();
    const parsed = q.trim() ? parseNaturalDate(q) : null;
    const dateItems: MenuItemDef[] = parsed
      ? [{ id: 'd:parsed', label: parsed.label, keywords: [q], icon: parsed.remind ? 'alarm' : 'clock', onSelect: () => onPick('d', '', parsed.value) }]
      : [
        { id: 'd:today', label: 'Today', icon: 'clock', onSelect: () => onPick('d', '', { type: 'date', start_date: isoDate(today), date_format: 'relative' }) },
        { id: 'd:remind', label: 'Remind me', text: 'Remind me tomorrow', icon: 'alarm', onSelect: () => onPick('d', '', { type: 'datetime', start_date: isoDate(addDays(today, 1)), start_time: '09:00', date_format: 'relative', reminder: { unit: 'minute', value: 0 } }) },
      ];
    const users = workspaceUsers();
    const pages = records.all<BlockRecord>('block').filter((b) => b.alive && (b.type === 'page' || b.type === 'collection_view_page') && toPlainText(b.properties?.title)).slice(0, 200);
    const people: MenuItemDef[] = users.map((u) => ({
      id: `u:${u.id}`, label: userName(u), text: `${u.name ?? ''} ${u.email ?? ''}`, icon: <UserAvatar userId={u.id} size={20} />,
      onSelect: () => onPick('u', u.id),
    }));
    const pageItems: MenuItemDef[] = pages.map((b) => ({
      id: `p:${b.id}`, label: toPlainText(b.properties?.title), icon: <span style={{ fontSize: 16 }}>{typeof b.format?.page_icon === 'string' && !b.format.page_icon.startsWith('lit-icon') && !b.format.page_icon.startsWith('/') && !b.format.page_icon.startsWith('http') ? b.format.page_icon : '📄'}</span>,
      onSelect: () => onPick('p', b.id),
    }));
    const agents = agentMentionItems(q, (a) => onPick('u', a.botId));
    return { width: 300, maxHeight: 320, emptyText: t('lp.comments.no_results', 'No results'), sections: [{ title: 'Date', items: dateItems }, { title: 'People', items: people }, ...(agents.length ? [{ title: 'Agents', items: agents }] : []), { title: 'Page link', items: pageItems.slice(0, 50) }] };
  }, [onPick, q]);
  // picking must not close the overlays around the composer (Menu closes them all unless onSelect returns false)
  const keepOpen = useMemo(() => ({ ...def, sections: def.sections.map((sec) => ({ ...sec, items: sec.items.map((it) => ({ ...it, onSelect: () => { it.onSelect?.(); close(); return false; } })) })) }), [def, close]);
  return <Menu def={keepOpen} close={close} externalQuery={q} keyTarget="window" />;
}

// ---------------------------------------------------------------------------------------------
// composer

export function CommentComposer({
  onSubmit, onCancel, autoFocus, placeholder, initial, showAvatar = true, compact, submitAria, focusKey, onEditLast,
}: {
  
  onEditLast?: () => boolean;
  onSubmit: (t: RichText) => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  placeholder?: string;
  initial?: RichText;
  showAvatar?: boolean;
  compact?: boolean;
  submitAria?: string;
  focusKey?: unknown;
}) {
  const [value, setValue] = useState<RichText>(initial ?? []);
  const [leafId] = useState(() => `nc-comment-input-${newId()}`);
  const leaf = useRef<LeafApi>(null);
  const mentionAt = useRef<number | null>(null);
  const closeMenu = useRef<(() => void) | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const userId = useSession((s) => s.userId);
  const fileRef = useRef<HTMLInputElement>(null);
  const empty = length(value) === 0;

  
  useLayoutEffect(() => {
    if (!autoFocus) return;
    const focus = () => {
      leaf.current?.el?.focus();
      leaf.current?.setSelection(length(valueRef.current));
    };
    focus();
    // overlays position themselves after mount; re-assert focus once if something else grabbed it
    const id = requestAnimationFrame(() => { if (!leaf.current?.el?.contains(document.activeElement)) focus(); });
    return () => cancelAnimationFrame(id);
  }, [autoFocus, focusKey]);

  useEffect(() => () => closeMenu.current?.(), []);

  const endMention = () => {
    mentionAt.current = null;
    closeMenu.current?.();
    closeMenu.current = null;
  };

  const pickMention: MentionPick = (kind, id, date) => {
    const start = mentionAt.current;
    if (start === null) return;
    const caret = leaf.current?.selection()?.end ?? start + 1 + useMentionQuery.getState().q.length;
    const cur = valueRef.current;
    let next = insertRich(deleteRange(cur, start, caret), start, kind === 'd' && date ? dateMention(date) : mention(kind === 'd' ? 'u' : kind, id));
    next = insertText(next, start + 1, ' ', []);
    setValue(next);
    mentionAt.current = null;
    const closeIt = closeMenu.current;
    closeMenu.current = null;
    closeIt?.();
    requestAnimationFrame(() => {
      leaf.current?.el?.focus();
      leaf.current?.setSelection(start + 2);
    });
  };

  const openMention = (at: number) => {
    mentionAt.current = at;
    useMentionQuery.setState({ q: '' });
    const el = leaf.current;
    const rect = el?.caretRect?.() ?? el?.el?.getBoundingClientRect();
    closeMenu.current?.();
    closeMenu.current = openOverlay((close) => <MentionMenu close={close} onPick={pickMention} />, {
      anchor: rect ? new DOMRect(rect.left, rect.top, rect.width, rect.height) : undefined,
      placement: 'bottom-start', offset: 4, backdrop: 'none', onClose: () => { mentionAt.current = null; closeMenu.current = null; },
    });
  };

  const submit = () => {
    const v = normalize(valueRef.current);
    if (!length(v) || !toPlainText(v).trim()) return;
    endMention();
    onSubmit(v);
    setValue([]);
  };

  return (
    <div className={`nc-comment-composer lit-discussion-input ${compact ? 'compact' : ''} ${showAvatar ? '' : 'editing'}`} onMouseDown={(e) => e.stopPropagation()}>
      {showAvatar && <UserAvatar userId={userId} size={24} style={{ marginInlineEnd: 8, alignSelf: 'flex-start' }} />}
      <div className="nc-comment-input-wrap" onClick={(e) => { if (!(e.target as HTMLElement).closest('[role="button"]')) leaf.current?.el?.focus(); }}>
        <div className="nc-comment-input-field">
        <RichTextEditable
          ref={leaf}
          blockId={leafId}
          property="text"
          value={value}
          placeholder={placeholder ?? t('lp.comments.write_a_comment', 'Write a comment…')}
          placeholderAlways
          className="nc-comment-input"
          onChange={(next, info) => {
            setValue(next);
            if (info.inserted === '@') openMention(info.caret - 1);
            else if (mentionAt.current !== null) {
              const q = toPlainText(next).slice(mentionAt.current + 1, info.caret);
              if (info.caret <= mentionAt.current || /[\n]/.test(q) || q.length > 40) endMention();
              else useMentionQuery.setState({ q });
            }
          }}
          onKeyDown={(e, api2) => {
            if (e.key === 'Enter' && e.shiftKey) {
              e.preventDefault();
              const sel = api2.selection();
              const at = sel?.start ?? length(valueRef.current);
              const next = insertText(deleteRange(valueRef.current, at, sel?.end ?? at), at, '\n');
              setValue(next);
              requestAnimationFrame(() => api2.setSelection(at + 1));
              return;
            }
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              if (mentionAt.current !== null) return; // the mention menu handles Enter
              e.preventDefault();
              submit();
              return;
            }
            if (e.key === 'Escape' && mentionAt.current === null) {
              e.preventDefault();
              e.stopPropagation();
              onCancel?.();
            }
            if (e.key === 'ArrowUp' && !e.shiftKey && length(valueRef.current) === 0 && mentionAt.current === null && onEditLast?.()) e.preventDefault();
          }}
        />
        </div>
      <div className="nc-comment-composer-actions">
        <div role="button" className="nc-icon-btn" aria-label={t('lp.comments.attach_file', 'Attach file')} data-tooltip={t('lp.comments.attach_file', 'Attach file')}
          onMouseDown={(e) => e.preventDefault()} onClick={() => fileRef.current?.click()}>
          <Icon name="paperClip" size={20} />
        </div>
        <input ref={fileRef} type="file" hidden onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const res = await uploadFile(f, f.name, useSession.getState().spaceId ?? undefined);
            const at = leaf.current?.selection()?.start ?? length(valueRef.current);
            const next = insertRich(valueRef.current, at, [[f.name, [['a', res.url]]], [' ']]);
            setValue(next);
          } catch {
            useUI.getState().toast(t('lp.comments.upload_failed', 'Upload failed'));
          }
        }} />
        <div role="button" className="nc-icon-btn" aria-label={t('lp.comments.mention_people_pages_or_dates', 'Mention people, pages, or dates')} data-tooltip={t('lp.comments.mention_people_pages_or_dates', 'Mention people, pages, or dates')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const sel = leaf.current?.selection();
            const at = sel?.start ?? length(valueRef.current);
            const next = insertText(valueRef.current, at, '@', []);
            setValue(next);
            leaf.current?.el?.focus();
            requestAnimationFrame(() => {
              leaf.current?.setSelection(at + 1);
              openMention(at);
            });
          }}>
          <Icon name="at" size={20} />
        </div>
        <div
          role="button"
          aria-label={submitAria ?? t('lp.comments.send_comment', 'Send comment')}
          aria-disabled={empty}
          className={`nc-comment-send ${empty ? 'disabled' : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={submit}
        >
          <SendGlyph />
        </div>
      </div>
      </div>
    </div>
  );
}


function SendGlyph() {
  return <ArrowUpCircle size={24} aria-hidden fill="currentColor" style={{ display: 'block' }} />;
}

// ---------------------------------------------------------------------------------------------
// comment + thread

function ReactionPills({ comment }: { comment: CommentRecord }) {
  const uid = useSession((s) => s.userId);
  const entries = Object.entries(comment.reactions ?? {}).filter(([, ids]) => ids?.length);
  if (!entries.length) return null;
  return (
    <div className="nc-reactions">
      {entries.map(([emoji, ids]) => {
        const names = ids.map((id) => userName(records.get<UserRecord>('lit_user', id))).join(', ');
        return (
          <div key={emoji} role="button" className={`nc-reaction ${ids.includes(uid ?? '') ? 'mine' : ''}`} data-tooltip={names} onClick={() => toggleReaction(comment, emoji)}>
            <span className="emoji"><ReactionGlyph emoji={emoji} /></span>
            <span className="count">{ids.length}</span>
          </div>
        );
      })}
      <div role="button" className="nc-reaction add" aria-label={t('lp.comments.add_reaction', 'Add reaction')} onClick={(e) => pickReaction(e.currentTarget, comment)}>
        <Icon name="emojiFacePlus" size={14} />
      </div>
    </div>
  );
}

const QUICK_REACTIONS = ['👍', '❤️', '🎉', '😄', '👀', '✅', '🙏', '🔥'];


export function ReactionGlyph({ emoji }: { emoji: string }) {
  if (/^(\/files\/|https?:|data:image\/)/.test(emoji)) {
    const ce = getCustomEmojis().find((e) => e.url === emoji);
    return <img className="nc-reaction-img" src={emoji} alt={ce ? `:${ce.name}:` : 'custom emoji'} draggable={false} />;
  }
  return <>{emoji}</>;
}

function pickReaction(anchor: Anchor, comment: CommentRecord) {
  void import('../page/IconPicker.tsx').then(({ openEmojiPicker }) => {
    if (openEmojiPicker) openEmojiPicker(anchor, { onPick: (e) => toggleReaction(comment, e), quick: QUICK_REACTIONS });
  });
}


export function commentTime(ms: number): string {
  const s = Math.floor((Date.now() - ms) / 1000);
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function blockTypeLabel(blockId: string): string {
  const b = getBlock(blockId);
  if (!b) return '';
  const map: Record<string, string> = {
    text: 'Text', header: 'Heading 1', sub_header: 'Heading 2', sub_sub_header: 'Heading 3', header_4: 'Heading 4', quote: 'Quote', callout: 'Callout',
    bulleted_list: 'Bulleted list', numbered_list: 'Numbered list', to_do: 'To-do', toggle: 'Toggle', code: 'Code', image: 'Image', page: 'Page',
  };
  return map[b.type] ?? '';
}

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg|avif|heic)(\?|#|$)/i;


function CommentImages({ text }: { text: RichText | undefined }) {
  const [all, setAll] = useState(false);
  const urls: string[] = [];
  for (const d of text ?? []) {
    const a = ((d[1] ?? []) as any[]).find((x) => x[0] === 'a');
    if (a && (IMAGE_FILE.test(String(a[1])) || IMAGE_FILE.test(d[0])) && !urls.includes(String(a[1]))) urls.push(String(a[1]));
  }
  if (!urls.length) return null;
  const shown = all ? urls : urls.slice(0, 3);
  return (
    <div className="nc-comment-images">
      {shown.map((u) => <a key={u} href={u} target="_blank" rel="noreferrer noopener"><img src={u} alt="" loading="lazy" /></a>)}
      {!all && urls.length > 3 && <div role="button" className="more" onClick={() => setAll(true)}>+{urls.length - 3}</div>}
    </div>
  );
}


export function SuggestGlyph({ size = 16 }: { size?: number }) {
  return <MessageSquareDiff size={size} aria-hidden style={{ display: 'block', flexShrink: 0 }} />;
}

const FORMAT_LABEL: Record<string, [string, string]> = {
  b: ['Bold', 'Unbold'], i: ['Italicize', 'Unitalicize'], _: ['Underline', 'Remove underline'], s: ['Strike through', 'Clear strikethrough'],
  c: ['Apply code style', 'Clear code style'], h: ['Highlight', 'Remove highlight'], a: ['Add link', 'Remove link'],
};


function SuggestionChange({ discussion }: { discussion: DiscussionRecord }) {
  const live = suggestionSummary(discussion.id);
  const snap = (discussion as DiscussionRecord & { suggestion_summary?: SuggestionSummary }).suggestion_summary;
  const sum = live && live.kind !== 'empty' ? live : snap ?? live;
  const q = (v: string) => `“${v.replace(/\n/g, '↵')}”`;
  let body: ReactNode = null;
  if (sum) {
    if (sum.kind === 'add') body = <><span className="lbl">{t('lp.comments.add', 'Add')}: </span><span className="val">{q(sum.added)}</span></>;
    else if (sum.kind === 'remove') body = <><span className="lbl">{t('lp.comments.delete', 'Delete')}: </span><span className="val removed">{q(sum.removed)}</span></>;
    else if (sum.kind === 'replace') body = <><span className="lbl">{t('lp.comments.replace', 'Replace')} </span><span className="val removed">{q(sum.removed)}</span><span className="lbl"> {t('lp.comments.with', 'with')} </span><span className="val">{q(sum.added)}</span></>;
    else if (sum.kind === 'format' || sum.kind === 'unformat') {
      const labels = FORMAT_LABEL[String(sum.format?.[0])] ?? ['Format', 'Remove format'];
      body = <><span className="lbl">{sum.kind === 'format' ? labels[0] : labels[1]} </span><span className="val">{q(sum.target ?? '')}</span></>;
    }
  }
  const status = (discussion as DiscussionRecord & { suggestion_status?: string }).suggestion_status;
  return (
    <div className="nc-suggestion-change" data-suggestion-kind={sum?.kind}>
      {body}
      {status && <span className="status">{status === 'accepted' ? 'Accepted' : 'Rejected'}</span>}
    </div>
  );
}

function CommentItem({ comment, discussion, first, canComment, canManage, context }: { comment: CommentRecord; discussion: DiscussionRecord; first: boolean; canComment: boolean; canManage: boolean; context?: ReactNode }) {
  const author = useRecord<UserRecord>('lit_user', comment.created_by_id);
  const uid = useSession((s) => s.userId);
  const [editing, setEditing] = useState(false);
  const mine = comment.created_by_id === uid;
  const editRequested = useComments((s) => s.editing === comment.id);
  useEffect(() => {
    if (!editRequested) return;
    setEditing(true);
    useComments.getState().set({ editing: null });
  }, [editRequested]);
  
  const isSuggestion = !!comment.suggestion && first && discussion.type === 'suggestion';
  useTableVersion(['notification', 'user_settings']);
  const unread = unreadCommentIds(discussion).has(comment.id); 
  useBlock(isSuggestion ? discussion.parent_id : undefined); // re-render as the suggested text changes
  const more = (anchor: HTMLElement) => {
    const muted = !!discussion.muted_user_ids?.includes(uid ?? '');
    
    let closeMenu: () => void = () => {};
    const act = (fn: () => void) => () => { closeMenu(); setTimeout(fn, 0); return false; };
    const items: MenuItemDef[] = [];
    if (mine && !isSuggestion) items.push({ label: t('lp.comments.edit', 'Edit'), icon: 'edit', onSelect: act(() => setEditing(true)) });
    items.push({
      label: first ? t('lp.comments.copy_link', 'Copy link') : t('lp.comments.copy_discussion_link', 'Copy discussion link'),
      icon: 'link', onSelect: act(() => { void navigator.clipboard?.writeText(discussionLink(discussion)); useUI.getState().toast('Link copied'); }),
    });
    items.push(unread
      ? { label: t('lp.comments.mark_read', 'Mark read'), icon: 'commentRead', onSelect: act(() => markDiscussionRead(discussion.id)) }
      : { label: t('lp.comments.mark_unread', 'Mark unread'), icon: 'commentUnread', onSelect: act(() => markCommentUnread(discussion, comment)) });
    items.push({ label: muted ? t('lp.comments.unmute_replies', 'Unmute replies') : t('lp.comments.mute_replies', 'Mute replies'), icon: muted ? 'bell' : 'bellOff', onSelect: act(() => setMuted(discussion, !muted)) });
    if (isSuggestion) {
      // withdrawing / dropping a suggestion = rejecting it
      if (!discussion.resolved && canReject(discussion.id)) items.push({ label: t('lp.comments.delete', 'Delete'), icon: 'trash', danger: true, onSelect: act(() => rejectSuggestion(discussion.id)) });
    } else if (mine || canManage) items.push({ label: t('lp.comments.delete', 'Delete'), icon: 'trash', danger: true, onSelect: act(() => void deleteComment(comment)) });
    closeMenu = openMenu(anchor, { width: 240, sections: [{ items }] }, { placement: 'bottom-end' });
  };
  return (
    <div className="nc-comment" data-comment-id={comment.id}>
      <div className="nc-comment-inner">
      <div className="nc-comment-head">
        {isSuggestion ? (
          <div className="nc-suggest-avatar">
            <UserAvatar userId={comment.created_by_id} size={24} />
            <span className="badge" aria-hidden><span><SuggestGlyph size={10} /></span></span>
          </div>
        ) : (
          <UserAvatar userId={comment.created_by_id} size={24} style={{ marginInlineEnd: 2 }} />
        )}
        <span className="nc-comment-author nc-ellipsis">{userName(author)}</span>
        <span className="nc-comment-time" title={formatDateTime(comment.created_time)}>{commentTime(comment.created_time)}</span>
        {comment.edited && <span className="nc-comment-time">{t('lp.comments.edited', '(edited)')}</span>}
        {unread && <span className="nc-comment-unread" role="img" aria-label={t('lp.comments.unread', 'Unread')} />}
      </div>
      {!editing && (
        <div className={`nc-comment-actions ${isSuggestion ? 'suggestion' : ''}`} role="toolbar" aria-label={t('lp.comments.comment_actions', 'Comment actions')}>
          {isSuggestion && !discussion.resolved && canReview(discussion.id) && (
            <div role="button" className="nc-icon-btn small" aria-label={t('lp.comments.accept', 'Accept')} data-tooltip={t('lp.comments.accept', 'Accept')} onClick={() => acceptSuggestion(discussion.id)}>
              <Icon name="check" size={16} />
            </div>
          )}
          {isSuggestion && !discussion.resolved && canReject(discussion.id) && (
            <div role="button" className="nc-icon-btn small" aria-label={t('lp.comments.reject', 'Reject')} data-tooltip={t('lp.comments.reject', 'Reject')} onClick={() => rejectSuggestion(discussion.id)}>
              <Icon name="close" size={16} />
            </div>
          )}
          <div role="button" className="nc-icon-btn small" aria-label={t('lp.comments.add_reaction', 'Add reaction')} data-tooltip={t('lp.comments.add_reaction', 'Add reaction')} onClick={(e) => pickReaction(e.currentTarget, comment)}>
            <Icon name="emojiFacePlus" size={16} />
          </div>
          {first && canComment && !isSuggestion && (
            <div role="button" className="nc-icon-btn small" aria-label={discussion.resolved ? t('lp.comments.reopen', 'Reopen') : t('lp.comments.resolve', 'Resolve')}
              data-tooltip={discussion.resolved ? t('lp.comments.reopen', 'Reopen') : t('lp.comments.resolve', 'Resolve')}
              onClick={() => resolveDiscussion(discussion.id, !discussion.resolved)}>
              <Icon name={discussion.resolved ? 'undo' : 'check'} size={16} />
            </div>
          )}
          <div role="button" className="nc-icon-btn small" aria-label={t('lp.comments.more_actions', 'More actions')} data-tooltip={t('lp.comments.more_actions', 'More actions')} onClick={(e) => more(e.currentTarget)}>
            <Icon name="ellipsis" size={16} />
          </div>
        </div>
      )}
      <div className="nc-comment-body">
        {context}
        {isSuggestion ? (
          <SuggestionChange discussion={discussion} />
        ) : editing ? (
          <CommentComposer
            autoFocus
            showAvatar={false}
            compact
            initial={comment.text as RichText}
            submitAria={t('lp.comments.update_comment', 'Update comment')}
            onSubmit={(text) => {
              run('Comment.edit', (tx) => tx.update('comment', comment.id, [], { text, last_edited_time: Date.now(), edited: true }));
              setEditing(false);
              notify(comment.id, true);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <RichTextView value={comment.text as RichText} className={`nc-comment-text ${/^\p{Extended_Pictographic}{1,3}$/u.test(toPlainText(comment.text as RichText).trim()) ? 'emoji-only' : ''}`} />
        )}
        {!editing && !isSuggestion && <CommentImages text={comment.text as RichText} />}
        <ReactionPills comment={comment} />
      </div>
      </div>
    </div>
  );
}

export type ThreadMode = 'page' | 'margin' | 'popover' | 'sidebar';


function ContextQuote({ discussion, boxed }: { discussion: DiscussionRecord; boxed?: boolean }) {
  const text = toPlainText(discussion.context as RichText | undefined);
  if (!text) return null;
  if (boxed) {
    return (
      <div className="nc-discussion-context boxed">
        <div className="bar" />
        <div className="inner">
          {blockTypeLabel(discussion.parent_id) && <div className="type">{blockTypeLabel(discussion.parent_id)}</div>}
          <div className="excerpt">{text}</div>
        </div>
      </div>
    );
  }
  return (
    <div className="nc-discussion-context">
      <div className="bar" />
      <div className="excerpt">{text}</div>
    </div>
  );
}

export function DiscussionThread({ discussion, mode, active, showContext, onActivate }: { discussion: DiscussionRecord; mode: ThreadMode; active?: boolean; showContext?: boolean; onActivate?: () => void }) {
  const comments = useRecords<CommentRecord>('comment', discussion.comments).filter((c): c is CommentRecord => !!c && c.alive !== false);
  const role = useRole('block', discussion.parent_id);
  const canComment = roleAtLeast(role, 'comment_only');
  const canManage = roleAtLeast(role, 'editor');
  const [expanded, setExpanded] = useState(false);
  if (!comments.length) return null;
  const collapse = (mode === 'margin' || mode === 'sidebar') && !active && !expanded && comments.length > 3;
  const shown = collapse ? [comments[0], comments[comments.length - 1]] : comments;
  const hidden = comments.length - shown.length;
  return (
    <div
      className={`nc-discussion mode-${mode} ${active ? 'active' : ''} ${discussion.resolved ? 'resolved' : ''}`}
      data-discussion-id={discussion.id}
      onMouseDown={() => onActivate?.()}
    >
      {shown.map((c, i) => (
        <div key={c.id}>
          {i === 1 && hidden > 0 && (
            <div role="button" className="nc-show-replies" onClick={(e) => { e.stopPropagation(); setExpanded(true); onActivate?.(); }}>
              {t('lp.comments.see_morecommentsnumber_plural_one_more_r', 'See {moreCommentsNumber, plural, one {{moreCommentsNumber} more reply} other {{moreCommentsNumber} more replies}}', { moreCommentsNumber: hidden })}
            </div>
          )}
          <CommentItem
            comment={c} discussion={discussion} first={i === 0} canComment={canComment} canManage={canManage}
            context={i === 0 && showContext ? <ContextQuote discussion={discussion} boxed={mode === 'sidebar'} /> : undefined}
          />
        </div>
      ))}
      {discussion.resolved ? (
        <div className="nc-discussion-resolved-note">
          <span>{t('lp.comments.this_discussion_is_resolved', 'This discussion is resolved')}</span>
          {canComment && discussion.type !== 'suggestion' && <div role="button" className="nc-link-btn" onClick={() => resolveDiscussion(discussion.id, false)}>{t('lp.comments.reopen', 'Reopen')}</div>}
        </div>
      ) : (
        canComment && ((mode !== 'margin' && mode !== 'page') || active) && (
          <CommentComposer
            compact
            placeholder={mode === 'popover' ? t('lp.comments.write_a_comment', 'Write a comment…') : t('lp.comments.reply', 'Reply…')}
            onSubmit={(text) => addComment(discussion.parent_id, text, discussion.id)}
            onEditLast={() => {
              const last = [...comments].reverse().find((c) => c.created_by_id === me() && !c.suggestion && length(c.text as RichText) > 0);
              if (!last) return false;
              useComments.getState().set({ editing: last.id });
              return true;
            }}
          />
        )
      )}
    </div>
  );
}


export function Discussion({ discussion }: { discussion: DiscussionRecord }) {
  return <DiscussionThread discussion={discussion} mode="sidebar" showContext />;
}

// ---------------------------------------------------------------------------------------------
// page discussions (under the title)

export function PageDiscussions({ pageId, readOnly }: { pageId: string; readOnly?: boolean }) {
  const page = useBlock(pageId);
  const discussions = useRecords<DiscussionRecord>('discussion', page?.discussions);
  const composeKey = useComments((s) => s.composingPage[pageId]);
  const active = useComments((s) => s.active);
  const role = useRole('block', pageId);
  const canComment = roleAtLeast(role, 'comment_only');
  const visibility = ((page?.format as any)?.page_section_visibility?.comments as string | undefined) ?? 'section_show';
  const all = discussions.filter((d): d is DiscussionRecord => !!d && d.alive !== false && !d.resolved && isPageDiscussion(d, pageId));
  const open = all.filter((d) => !isPostReactions(d));
  // reactions on the page (Feed view posts) sit above the threads as pills
  const reactions = all.filter(isPostReactions).map((d) => records.get<CommentRecord>('comment', d.comments?.[0])).find((c) => Object.values(c?.reactions ?? {}).some((u) => u?.length));
  const composing = !!composeKey && canComment;
  if (visibility === 'section_hide' && !composing) return null;
  if (!open.length && !composing && !reactions) return null;
  const stop = () => {
    const s = useComments.getState();
    const next = { ...s.composingPage };
    delete next[pageId];
    s.set({ composingPage: next });
  };
  return (
    <div className="nc-page-discussions" data-page-discussions={pageId}>
      {reactions && <div className="nc-page-reactions"><ReactionPills comment={reactions} /></div>}
      {open.map((d) => (
        <DiscussionThread key={d.id} discussion={d} mode="page" active={active === d.id} onActivate={() => { if (active !== d.id) useComments.getState().set({ active: d.id }); }} />
      ))}
      {canComment && !readOnly && (composing || open.length > 0) && (
        <CommentComposer
          autoFocus={composing}
          focusKey={composeKey}
          onSubmit={(text) => { addComment(pageId, text, undefined, undefined, { type: 'page' }); stop(); }}
          onCancel={stop}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// popovers: thread (480 wide, anchored under the block), new-comment composer (470 wide)


function threadAnchor(anchor: Anchor): Anchor {
  if (!(anchor instanceof HTMLElement)) return anchor;
  const block = anchor.closest<HTMLElement>('[data-block-id]');
  const line = anchor.getClientRects()[0] ?? anchor.getBoundingClientRect();
  if (!block || block === anchor) {
    const r = anchor.getBoundingClientRect();
    return new DOMRect(r.left, r.top, r.width, Math.min(r.height, 28));
  }
  const b = block.getBoundingClientRect();
  return new DOMRect(b.left, line.top, b.width, line.height);
}

export function openDiscussionPopover(ids: string[], anchor: Anchor) {
  return openOverlay((close) => <DiscussionPopover ids={ids} close={close} />, { anchor: threadAnchor(anchor), placement: 'bottom', offset: 4, onClose: () => useComments.getState().set({ active: null }) });
}

function DiscussionPopover({ ids, close }: { ids: string[]; close: () => void }) {
  const ds = useRecords<DiscussionRecord>('discussion', ids);
  const live = ds.filter((d): d is DiscussionRecord => !!d && d.alive !== false);
  useEffect(() => {
    if (!live.length) close();
  }, [live.length, close]);
  
  useEffect(() => {
    const timer = setTimeout(() => { for (const id of ids) markDiscussionRead(id); }, 1500);
    return () => clearTimeout(timer);
  }, [ids.join(',')]);
  return (
    <PopoverSurface width={480} maxHeight="50vh" className="nc-discussion-popover">
      <div className="lit-scroller vertical" style={{ overflow: 'auto' }}>
        {live.map((d) => <DiscussionThread key={d.id} discussion={d} mode="popover" active showContext />)}
      </div>
    </PopoverSurface>
  );
}

export function openDraftPopover(draft: CommentDraft) {
  const r = draft.rect;
  const anchor = r ? new DOMRect(r.x, r.y, r.width, r.height) : undefined;
  return openOverlay((close) => (
    <PopoverSurface width={470} className="nc-discussion-popover composer">
      <CommentComposer autoFocus onSubmit={(text) => { submitDraft(draft, text); close(); }} onCancel={close} />
    </PopoverSurface>
  ), { anchor, placement: 'bottom', offset: 4, onClose: () => { if (useComments.getState().draft?.key === draft.key) useComments.getState().set({ draft: null }); } });
}

// ---------------------------------------------------------------------------------------------
// topbar Comments button → "Discussions" popover → "See all" → sidebar

function dayLabel(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function notifyBell(pageId: string, anchor: HTMLElement) {
  void api('getPageNotifySettings', { pageId }).then((r) => {
    const set = (level: string) => void api('setPageNotifySettings', { pageId, level }).then((x) => records.mergeRecordMap(x.recordMap));
    openMenu(anchor, { width: 240, sections: [{ title: 'Notify me', items: [
      { label: 'All comments', checked: r.level === 'all_comments', onSelect: () => set('all_comments') },
      { label: 'Replies and mentions', checked: r.level === 'replies_and_mentions', onSelect: () => set('replies_and_mentions') },
    ] }] }, { placement: 'bottom-end' });
  }).catch(() => {});
}

export function openDiscussionsPopover(pageId: string, anchor: HTMLElement) {
  openOverlay((close) => <DiscussionsPopover pageId={pageId} close={close} />, { anchor, placement: 'bottom-end', offset: 8 });
}

function DiscussionsPopover({ pageId, close }: { pageId: string; close: () => void }) {
  useTableVersion(['discussion', 'comment', 'notification', 'user_settings']);
  const all = pageDiscussions(pageId)
    .filter(({ d }) => !d.resolved && liveComments(d).length > 0)
    .sort((a, b) => lastActivity(b.d) - lastActivity(a.d));
  
  const fresh = all.filter(({ d }) => isDiscussionUnread(d));
  const rest = all.filter(({ d }) => !isDiscussionUnread(d));
  const list = [...fresh, ...rest];
  const row = (d: DiscussionRecord, isNew: boolean) => {
    const c = liveComments(d).slice(-1)[0];
    return (
      <div key={d.id} role="button" className={`item ${isNew ? 'new' : ''}`} aria-label={t('lp.comments.view_comment', 'View comment')} onClick={() => { close(); focusDiscussion(d.id, true); }}>
        <UserAvatar userId={c.created_by_id} size={24} />
        <span className="who nc-ellipsis">{userName(records.get<UserRecord>('lit_user', c.created_by_id))}</span>
        <span className="what nc-ellipsis">{toPlainText(c.text as RichText).replace(/[‣⁍]/g, '@')}</span>
        {isNew && <span className="nc-comment-unread" role="img" aria-label={t('lp.comments.unread', 'Unread')} />}
      </div>
    );
  };
  return (
    <PopoverSurface width={456} maxHeight={492} className="nc-discussions-popover">
      <div className="head">
        <span>{t('lp.comments.discussions', 'Discussions')}</span>
        <div role="button" className="nc-icon-btn small" aria-label={t('lp.comments.page_notification_settings', 'Page alert settings')} onClick={(e) => notifyBell(pageId, e.currentTarget)}>
          <Icon name="bell" size={16} />
        </div>
      </div>
      <div className="lit-scroller vertical list" role="menu">
        {list.length === 0 && (
          <div className="empty">
            <div className="t">{t('lp.comments.you_re_up_to_date', 'You’re up to date')}</div>
            <div className="s">{t('lp.comments.no_discussions_are_open', 'No discussions are open')}</div>
          </div>
        )}
        {fresh.length > 0 ? (
          <>
            <div className="section">{t('lp.comments.new', 'New')}</div>
            {fresh.map(({ d }) => row(d, true))}
            {rest.length > 0 && <div className="section">{t('lp.comments.previous', 'Previous')}</div>}
            {rest.map(({ d }) => row(d, false))}
          </>
        ) : list.map(({ d }) => row(d, false))}
      </div>
      <div className="foot">
        <div role="button" className="see-all" onClick={() => { close(); useUI.getState().set({ rightPanel: 'comments' }); }}>{t('lp.comments.see_all', 'See all')}</div>
      </div>
    </PopoverSurface>
  );
}

export function CommentsSidebar({ pageId }: { pageId: string }) {
  useTableVersion(['block', 'discussion', 'comment']);
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const [author, setAuthor] = useState<string | null>(null);
  const [kind, setKind] = useState<'any' | 'suggestions'>('any');
  const [readState, setReadState] = useState<'any' | 'unread' | 'read'>('any');
  useTableVersion(['notification', 'user_settings']);
  const active = useComments((s) => s.active);
  const all = pageDiscussions(pageId);
  const openSugg = openSuggestions(pageId);
  const list = all
    .filter(({ d }) => (status === 'open' ? !d.resolved : d.resolved))
    .filter(({ d }) => kind === 'any' || d.type === 'suggestion')
    .filter(({ d }) => readState === 'any' || (readState === 'unread') === isDiscussionUnread(d))
    .filter(({ d }) => !author || liveComments(d).some((c) => c.created_by_id === author))
    .filter(({ d }) => liveComments(d).length > 0)
    .sort((a, b) => lastActivity(b.d) - lastActivity(a.d));
  const otherCount = all.filter(({ d }) => (status === 'open' ? d.resolved : !d.resolved) && liveComments(d).length > 0).length;
  const authors = [...new Set(all.flatMap(({ d }) => liveComments(d).map((c) => c.created_by_id)))];
  const filtered = status !== 'open' || !!author || kind !== 'any' || readState !== 'any';
  const filterMenu = (anchor: HTMLElement) => {
    openMenu(anchor, {
      width: 240,
      sections: [
        { title: t('lp.comments.status', 'Status'), items: [
          { label: t('lp.comments.open', 'Open'), checked: status === 'open', onSelect: () => setStatus('open') },
          { label: t('lp.comments.resolved', 'Resolved'), checked: status === 'resolved', onSelect: () => setStatus('resolved') },
        ] },
        { title: 'Type', items: [
          { label: t('lp.comments.any', 'Any'), checked: kind === 'any', onSelect: () => setKind('any') },
          { label: t('lp.comments.suggestions_only', 'Suggestions only'), checked: kind === 'suggestions', onSelect: () => setKind('suggestions') },
        ] },
        { title: 'Read', items: [
          { label: t('lp.comments.any', 'Any'), checked: readState === 'any', onSelect: () => setReadState('any') },
          { label: t('lp.comments.unread', 'Unread'), checked: readState === 'unread', onSelect: () => setReadState('unread') },
          { label: t('lp.comments.read', 'Read'), checked: readState === 'read', onSelect: () => setReadState('read') },
        ] },
        { title: t('lp.comments.person', 'Person'), items: [
          { label: t('lp.comments.anyone', 'Anyone'), checked: !author, onSelect: () => setAuthor(null) },
          ...authors.map((id) => ({ label: userName(records.get<UserRecord>('lit_user', id)), icon: <UserAvatar userId={id} size={20} />, checked: author === id, onSelect: () => setAuthor(id) })),
        ] },
      ],
    }, { placement: 'bottom-end' });
  };
  let lastDay = '';
  return (
    <div className="nc-comments-sidebar">
      <div className="nc-comments-sidebar-bar">
        <span className="title">{t('lp.comments.all_discussions', 'All discussions')}</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <div role="button" className={`nc-icon-btn ${filtered ? 'accent' : ''}`} aria-label={t('lp.comments.filter', 'Filter')} data-tooltip={t('lp.comments.filter', 'Filter')} onClick={(e) => filterMenu(e.currentTarget)}>
            <Icon name="filter" size={18} />
          </div>
          <div role="button" className="nc-icon-btn" aria-label={t('lp.comments.page_notification_settings', 'Page alert settings')} onClick={(e) => notifyBell(pageId, e.currentTarget)}>
            <Icon name="bell" size={18} />
          </div>
        </div>
      </div>
      {status === 'open' && openSugg.length > 0 && openSugg.some((d) => canReject(d.id)) && (
        <div className="nc-sidebar-review" data-testid="suggestions-review">
          {openSugg.some((d) => canReview(d.id)) && <div role="button" className="nc-dialog-btn outline small" onClick={() => reviewAll(pageId, 'accept')}>Accept all</div>}
          <div role="button" className="nc-dialog-btn outline small" onClick={() => reviewAll(pageId, 'reject')}>Reject all</div>
        </div>
      )}
      {list.length === 0 ? (
        <div className="nc-comments-empty">
          <Icon name="commentFilled" size={28} />
          <div className="title">{t('lp.comments.no_discussions', 'No discussions')}</div>
          {otherCount > 0 && (
            <>
              <div className="sub">{status === 'open'
                ? t('lp.comments.this_page_has_resolved_threads', 'This page has resolved threads')
                : t('lp.comments.this_page_has_open_threads', 'This page has open threads')}</div>
              <div role="button" className="nc-dialog-btn outline small" onClick={() => setStatus(status === 'open' ? 'resolved' : 'open')}>
                {status === 'open' ? t('lp.comments.show_resolved_threads', 'Show resolved threads') : t('lp.comments.show_open_threads', 'Show open threads')}
              </div>
            </>
          )}
        </div>
      ) : (
        list.map(({ d }) => {
          const label = dayLabel(lastActivity(d));
          const header = label !== lastDay ? <div className="nc-comments-day">{label}</div> : null;
          lastDay = label;
          return (
            <div key={d.id}>
              {header}
              <div className={`nc-sidebar-thread ${active === d.id ? 'active' : ''}`} onMouseDown={() => focusDiscussion(d.id)}>
                <DiscussionThread discussion={d} mode="sidebar" showContext active={active === d.id} />
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}


export function focusDiscussion(id: string, openPopover = false) {
  useComments.getState().set({ active: id });
  markDiscussionRead(id); 
  const hl = document.querySelector<HTMLElement>(`.lit-page-content [data-discussion-id~="${id}"]`);
  const d = records.get<DiscussionRecord>('discussion', id);
  const target = hl ?? (d ? document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${d.parent_id}"], [data-page-discussions="${d.parent_id}"]`) : null);
  target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (openPopover && target && d && !isPageDiscussion(d, pageOf(d.parent_id)?.id ?? '')) {
    setTimeout(() => openDiscussionPopover([id], target.closest<HTMLElement>('[data-block-id]') ?? target), 350);
  }
}

// ---------------------------------------------------------------------------------------------



export function SuggestingPill({ pageId }: { pageId: string }): ReactNode {
  useSuggest((s) => s.pages[pageId]);
  useBlock(pageId);
  const on = isSuggesting(pageId);
  const commenter = commentOnly(pageId) && canSuggest(pageId);
  if (!on && !commenter) return null;
  return (
    <div className="nc-suggesting-pill" data-tooltip={commenter ? 'Suggest changes or comment' : 'Suggesting changes'} role="status">
      <SuggestGlyph size={16} />
      <span>{t('lp.comments.suggesting', 'Suggesting')}</span>
      {!commenter && (
        <span role="button" className="x" aria-label={t('lp.comments.stop_suggesting', 'Stop suggesting')} data-tooltip={t('lp.comments.stop_suggesting', 'Stop suggesting')} onClick={() => setSuggesting(pageId, false)}>
          <Icon name="close" size={14} />
        </span>
      )}
    </div>
  );
}

export function TopbarCommentsButton({ pageId }: { pageId: string }): ReactNode {
  useTableVersion(['block', 'discussion', 'notification', 'user_settings']);
  const panel = useUI((s) => s.rightPanel);
  const threads = pageDiscussions(pageId).filter(({ d }) => liveComments(d).length > 0);
  const count = threads.length;
  const hasNew = threads.some(({ d }) => !d.resolved && isDiscussionUnread(d));
  if (!count) return null;
  const open = panel === 'comments';
  return (
    <div
      role="button"
      aria-label={t('lp.comments.comments', 'Comments')}
      className={`nc-topbar-icon-btn lit-topbar-comments-button ${open ? 'active' : ''}`}
      data-tooltip={open ? t('lp.comments.close_every_discussion', 'Close every discussion') : t('lp.comments.see_every_new_discussion', 'See every new discussion')}
      onClick={(e) => (open ? useUI.getState().set({ rightPanel: null }) : openDiscussionsPopover(pageId, e.currentTarget))}
    >
      <Icon name="commentFilled" size={18} style={{ color: 'var(--lp-icon-primary)' }} />
      {hasNew && <span className="nc-topbar-unread-dot" data-testid="comments-unread-dot" aria-hidden />}
    </div>
  );
}

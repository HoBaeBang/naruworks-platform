// Inline/block discussions on the page body:
// - "Default" inline comments (page_section_visibility.margin_comments = 'inline'): when the centered
//   right margin can hold a 256px thread (frame ≥ 720 + 2×296), threads sit in the margin aligned with

//   block and opens the thread popover.
// - "Minimal": icon-only badge beside the block.
// - Highlight state: resolved threads lose the yellow highlight, the active one turns darker
//   (spans carry data-discussion-id, emitted by editor/richTextDom.ts).
// - Drafts started from the inline toolbar / ⋮⋮ → Comment (startCommentOnSelection).
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { DiscussionRecord } from '@nc/shared/records.ts';
import { expandId } from '@nc/shared/ids.ts';
import { useBlock, useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { Icon } from '../../components/Icon.tsx';
import {
  CommentComposer, DiscussionThread, focusDiscussion, isPageDiscussion, openDiscussionPopover, openDraftPopover, pageDiscussions, rangeIn,
  isReactionThread, ReactionGlyph, submitDraft, SuggestGlyph, useComments, type CommentDraft,
} from './comments.tsx';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { rowLayoutOptions } from '../database/layout/model.ts';
import { colorToken } from '../../lib/colorToken.ts';


export const MARGIN_WIDTH = 390;

const MIN_LAYOUT_FOR_MARGIN = 720 + MARGIN_WIDTH + 96;
const GAP = 8;

export function inlineCommentsMode(page: { format?: any; parent_table?: string; parent_id?: string } | undefined): 'inline' | 'minimal' {
  const own = page?.format?.page_section_visibility?.margin_comments;
  if (own !== undefined && own !== null) return own === 'minimal' ? 'minimal' : 'inline';
  // database row pages: the layout builder's Options › Inline comments
  return rowLayoutOptions(page)?.inlineComments === 'minimal' ? 'minimal' : 'inline';
}

interface Item {
  id: string; // discussion id or "draft"
  blockId: string;
  discussion?: DiscussionRecord;
  draft?: CommentDraft;
}


function bodyItems(pageId: string): Item[] {
  return pageDiscussions(pageId)
    // property-value threads (discussion.property_id) live on their property row, not in the margin
    .filter(({ d }) => !d.resolved && !d.property_id && !isPageDiscussion(d, pageId) && d.comments?.some((c) => records.get('comment', c)?.alive !== false && records.get('comment', c)))
    .map(({ d, block }) => ({ id: d.id, blockId: block.id, discussion: d }));
}

function anchorEl(item: Item): HTMLElement | null {
  if (item.discussion) {
    const hl = document.querySelector<HTMLElement>(`.lit-page-content [data-discussion-id~="${item.id}"]`);
    if (hl) return hl;
  }
  return document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${item.blockId}"]`);
}


export function useMarginComments(pageId: string, layoutRef: RefObject<HTMLDivElement | null>, enabled: boolean): boolean {
  const page = useBlock(pageId);
  useTableVersion(['discussion', 'comment']);
  const draft = useComments((s) => s.draft);
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const el = layoutRef.current;
    if (!el) return;
    const measure = () => setWide(el.clientWidth >= MIN_LAYOUT_FOR_MARGIN);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [layoutRef]);
  const hasItems = bodyItems(pageId).length > 0 || (!!draft && pageBlockIds(pageId).has(draft.blockId));
  const fullWidth = !!(page?.format as any)?.page_full_width;
  const on = enabled && wide && !fullWidth && inlineCommentsMode(page) === 'inline' && hasItems;
  useEffect(() => {
    const s = useComments.getState();
    if (!!s.marginMode[pageId] !== on) s.set({ marginMode: { ...s.marginMode, [pageId]: on } });
  }, [on, pageId]);
  return on;
}

function pageBlockIds(pageId: string): Set<string> {
  const ids = new Set<string>();
  const walk = (id: string, root: boolean) => {
    const b = records.get('block', id) as any;
    if (!b || !b.alive) return;
    if (!root && (b.type === 'page' || b.type === 'collection_view_page')) return;
    ids.add(id);
    for (const c of b.content ?? []) walk(c, false);
  };
  walk(pageId, true);
  return ids;
}


export function PageCommentsLayer({ pageId, margin, readOnly }: { pageId: string; margin: boolean; readOnly: boolean }) {
  useTableVersion(['block', 'discussion', 'comment']);
  const minimalMode = inlineCommentsMode(useBlock(pageId)) === 'minimal';
  const draft = useComments((s) => s.draft);
  const active = useComments((s) => s.active);
  const colRef = useRef<HTMLDivElement>(null);
  const heights = useRef(new Map<string, number>());
  const [tops, setTops] = useState<Record<string, number>>({});
  const items = bodyItems(pageId);
  const draftHere = draft && pageBlockIds(pageId).has(draft.blockId) ? draft : null;
  const all: Item[] = draftHere && margin ? [...items, { id: 'draft', blockId: draftHere.blockId, draft: draftHere }] : items;
  const key = all.map((i) => i.id).join(',');

  const layout = useCallback(() => {
    const col = colRef.current;
    if (!col) return;
    const base = col.getBoundingClientRect().top;
    const anchors = all.map((it) => {
      let top: number | null = null;
      let exact = false;
      if (it.draft) {
        // the draft card's top edge sits 3px above the selected line's box (= the leaf's top on its first line)
        const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${it.blockId}"][data-property="${it.draft.property}"]`);
        const range = leaf ? rangeIn(leaf, it.draft.start, Math.max(it.draft.end, it.draft.start)) : null;
        const r = range ? range.getClientRects()[0] ?? range.getBoundingClientRect() : null;
        if (leaf && r && r.height) {
          const lh = parseFloat(getComputedStyle(leaf).lineHeight) || r.height;
          const lr = leaf.getBoundingClientRect();
          // first line: the leaf's own top; later lines: that line's box top − the leaf's 3px top padding
          top = (r.top - lr.top < lh ? lr.top : r.top - (lh - r.height) / 2 - 3) - base;
          exact = true;
        }
      }
      if (top === null) {
        const el = margin ? anchorEl(it) : document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${it.blockId}"]`);
        top = el ? el.getBoundingClientRect().top - base : 0;
      }
      return { id: it.id, top: Math.max(0, exact ? top : top - 2) };
    });
    anchors.sort((a, b) => a.top - b.top);
    const next: Record<string, number> = {};
    if (!margin) {
      for (const a of anchors) next[a.id] = a.top + 2;
      setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      return;
    }
    const pinned = active && anchors.find((a) => a.id === active) ? active : draftHere ? 'draft' : null;
    const pinIdx = pinned ? anchors.findIndex((a) => a.id === pinned) : -1;
    if (pinIdx < 0) {
      let cursor = 0;
      for (const a of anchors) {
        const top = Math.max(a.top, cursor);
        next[a.id] = top;
        cursor = top + (heights.current.get(a.id) ?? 80) + GAP;
      }
    } else {
      next[anchors[pinIdx].id] = anchors[pinIdx].top;
      let cursor = anchors[pinIdx].top + (heights.current.get(anchors[pinIdx].id) ?? 80) + GAP;
      for (let i = pinIdx + 1; i < anchors.length; i++) {
        const top = Math.max(anchors[i].top, cursor);
        next[anchors[i].id] = top;
        cursor = top + (heights.current.get(anchors[i].id) ?? 80) + GAP;
      }
      let ceiling = anchors[pinIdx].top - GAP;
      for (let i = pinIdx - 1; i >= 0; i--) {
        const h = heights.current.get(anchors[i].id) ?? 80;
        const top = Math.min(anchors[i].top, ceiling - h);
        next[anchors[i].id] = top;
        ceiling = top - GAP;
      }
    }
    setTops((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active, draftHere?.key, margin]);

  useLayoutEffect(() => {
    layout();
  });

  useEffect(() => {
    const content = document.querySelector('.lit-page-content');
    const ro = new ResizeObserver(() => layout());
    if (content) ro.observe(content);
    if (colRef.current) ro.observe(colRef.current);
    const onResize = () => layout();
    window.addEventListener('resize', onResize);
    const onInput = () => requestAnimationFrame(layout);
    document.addEventListener('input', onInput, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('input', onInput, true);
    };
  }, [layout]);

  // without a margin, drafts open in a popover anchored to the text
  useEffect(() => {
    if (!draftHere || margin) return;
    const close = openDraftPopover(draftHere);
    return () => close();
  }, [draftHere?.key, margin]); // eslint-disable-line react-hooks/exhaustive-deps

  const measureRef = (id: string) => (el: HTMLDivElement | null) => {
    if (!el) return;
    const h = el.offsetHeight;
    if (heights.current.get(id) !== h) {
      heights.current.set(id, h);
      requestAnimationFrame(layout);
    }
  };

  if (!margin) {
    // badge per block with open threads ("💬 N"; icon only in Minimal mode); suggestions get their own badge
    
    const byBlock = new Map<string, Item[]>();
    const suggestionsByBlock = new Map<string, Item[]>();
    const reactionsByBlock = new Map<string, Item[]>();
    for (const it of items) {
      const map = it.discussion?.type === 'suggestion' ? suggestionsByBlock : it.discussion && isReactionThread(it.discussion) && (it.discussion.comments?.length ?? 0) === 1 ? reactionsByBlock : byBlock;
      map.set(it.blockId, [...(map.get(it.blockId) ?? []), it]);
    }
    const minimal = minimalMode;
    return (
      <div className="layout-margin-right nc-margin-comments badges" ref={colRef}>
        {[...reactionsByBlock.entries()].map(([blockId, its]) => {
          
          const counts = new Map<string, number>();
          for (const it of its) {
            const first = records.get<any>('comment', it.discussion?.comments?.[0]);
            for (const [emoji, users] of Object.entries((first?.reactions ?? {}) as Record<string, string[]>)) counts.set(emoji, (counts.get(emoji) ?? 0) + (users?.length ?? 0));
          }
          const top = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
          if (!top) return null;
          const total = [...counts.values()].reduce((n, v) => n + v, 0);
          const offset = (byBlock.has(blockId) ? 28 : 0) + (suggestionsByBlock.has(blockId) ? 28 : 0);
          return (
            <div key={`r:${blockId}`} role="button" className={`nc-margin-chip reaction ${its.some((i) => i.id === active) ? 'active' : ''}`} style={{ top: Math.min(...its.map((i) => tops[i.id] ?? 0)) + offset }}
              aria-label={`${total} ${total === 1 ? 'reaction' : 'reactions'}`}
              onClick={() => {
                useComments.getState().set({ active: its[0].id });
                const blockEl = document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${blockId}"]`);
                if (blockEl) openDiscussionPopover(its.map((i) => i.id), blockEl);
              }}>
              <span className="emoji"><ReactionGlyph emoji={top[0]} /></span>
              <span>{total}</span>
            </div>
          );
        })}
        {[...suggestionsByBlock.entries()].map(([blockId, its]) => {
          const top = Math.min(...its.map((i) => tops[i.id] ?? 0)) + (byBlock.has(blockId) ? 28 : 0);
          const isActive = its.some((i) => i.id === active);
          return (
            <div key={`s:${blockId}`} role="button" className={`nc-margin-chip suggestion ${isActive ? 'active' : ''}`} style={{ top }}
              aria-label={t('lp.comments.count_plural_one_other_suggestions', '{count, plural, one {1 suggested change} other {{count} suggested changes}}', { count: its.length })}
              onClick={() => {
                useComments.getState().set({ active: its[0].id });
                const blockEl = document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${blockId}"]`);
                if (blockEl) openDiscussionPopover(its.map((i) => i.id), blockEl);
              }}>
              <SuggestGlyph size={16} />
              <span>{its.length}</span>
            </div>
          );
        })}
        {[...byBlock.entries()].map(([blockId, its]) => {
          const top = Math.min(...its.map((i) => tops[i.id] ?? 0));
          const count = its.reduce((n, i) => n + (i.discussion?.comments ?? []).filter((c) => { const r = records.get<any>('comment', c); return r && r.alive !== false; }).length, 0);
          const isActive = its.some((i) => i.id === active);
          return (
            <div key={blockId} role="button" className={`nc-margin-chip ${minimal ? 'minimal' : ''} ${isActive ? 'active' : ''}`} style={{ top }}
              aria-label={t('lp.comments.count_plural_one_other_comments', '{count, plural, one {1 discussion} other {{count} discussions}}', { count })}
              onClick={() => {
                useComments.getState().set({ active: its[0].id });
                const blockEl = document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${blockId}"]`);
                if (blockEl) openDiscussionPopover(its.map((i) => i.id), blockEl);
              }}>
              <Icon name="comment" size={16} />
              <span>{count}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="layout-margin-right nc-margin-comments" ref={colRef}>
      {all.map((it) => (
        <div
          key={it.id}
          ref={measureRef(it.id)}
          className={`nc-margin-thread ${active === it.id || it.draft ? 'active' : ''}`}
          style={{ top: tops[it.id] ?? -9999 }}
          onMouseDown={() => { if (it.discussion && active !== it.id) useComments.getState().set({ active: it.id }); }}
        >
          {it.discussion ? (
            <DiscussionThread discussion={it.discussion} mode="margin" active={active === it.id} />
          ) : it.draft && !readOnly ? (
            <div className="nc-discussion mode-margin active draft">
              <CommentComposer
                showAvatar={false}
                autoFocus
                focusKey={it.draft.key}
                onSubmit={(text) => submitDraft(it.draft!, text)}
                onCancel={() => useComments.getState().set({ draft: null })}
              />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}


export function DiscussionHighlightStyles({ pageId }: { pageId: string }) {
  useTableVersion(['block', 'discussion']);
  const active = useComments((s) => s.active);
  const ds = pageDiscussions(pageId).map(({ d }) => d);
  const sel = (id: string) => `.lit-page-content [data-discussion-id~="${id}"]`;
  const resolved = ds.filter((d) => d.resolved).map((d) => sel(d.id));
  const open = ds.filter((d) => !d.resolved).map((d) => sel(d.id));
  let css = '';
  if (resolved.length) css += `${resolved.join(',')}{background:none!important;border-bottom:0!important;cursor:inherit!important}`;
  if (open.length) css += `${open.join(',')}{background:var(--nc-discussion-bg)!important;border-bottom:2px solid var(--nc-discussion-border)!important;padding-bottom:1px;cursor:pointer}`;
  if (active && open.includes(sel(active))) css += `${sel(active)}{background:var(--nc-discussion-bg-active)!important;border-bottom-color:var(--nc-discussion-border-active)!important}`;
  
  const uid = useSession.getState().userId;
  for (const d of ds) {
    if (d.type !== 'suggestion' || d.resolved || !d.created_by_id || d.created_by_id === uid) continue;
    const c = authorTone(d.created_by_id);
    css += `.lit-page-content [data-suggestion-id~="${d.id}"]{--nc-sug-text:var(${colorToken(c, 'text-accent')});--nc-sug-bg:color-mix(in srgb,var(${colorToken(c, 'text-accent')}) 5%,transparent);--nc-sug-border:color-mix(in srgb,var(${colorToken(c, 'text-accent')}) 22%,transparent)}`;
  }
  if (active && ds.some((d) => d.id === active && d.type === 'suggestion')) css += `.lit-page-content [data-suggestion-id~="${active}"]{--nc-sug-bg:color-mix(in srgb,var(--nc-sug-text) 12%,transparent)}`;
  return css ? <style data-nc-discussion-styles={pageId}>{css}</style> : null;
}

const TONES = ['gre', 'pur', 'pin', 'ora', 'red', 'bro', 'yel'];
function authorTone(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TONES[h % TONES.length];
}


export function useDiscussionInteractions(pageId: string, margin: boolean, rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      // suggested text → its suggestion card
      const sg = (e.target as HTMLElement).closest?.('.lit-page-content [data-suggestion-id]') as HTMLElement | null;
      if (sg && !(window.getSelection()?.toString())) {
        const sids = (sg.dataset.suggestionId ?? '').split(' ').filter((id) => {
          const d = records.get<DiscussionRecord>('discussion', id);
          return d && d.alive !== false && !d.resolved;
        });
        if (sids.length) {
          useComments.getState().set({ active: sids[0] });
          if (!margin) openDiscussionPopover(sids, sg);
          return;
        }
      }
      const hl = (e.target as HTMLElement).closest?.('.lit-page-content [data-discussion-id]') as HTMLElement | null;
      if (!hl) return;
      const ids = (hl.dataset.discussionId ?? '').split(' ').filter((id) => {
        const d = records.get<DiscussionRecord>('discussion', id);
        return d && d.alive !== false && !d.resolved;
      });
      if (!ids.length) return;
      useComments.getState().set({ active: ids[0] });
      if (!margin) openDiscussionPopover(ids, hl);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.lit-overlay-container, .nc-discussion, [data-discussion-id], [data-suggestion-id], .nc-right-panel, .nc-margin-chip')) return;
      if (useComments.getState().active) useComments.getState().set({ active: null });
    };
    root.addEventListener('click', onClick);
    document.addEventListener('mousedown', onDown, true);
    return () => {
      root.removeEventListener('click', onClick);
      document.removeEventListener('mousedown', onDown, true);
    };
  }, [pageId, margin, rootRef]);

  // deep link: ?d=<discussion id>
  useEffect(() => {
    const d = new URLSearchParams(location.search).get('d');
    if (!d) return;
    const id = expandId(d);
    let tries = 0;
    const tick = () => {
      if (records.get('discussion', id)) {
        focusDiscussion(id);
        return;
      }
      if (tries++ < 20) setTimeout(tick, 150);
    };
    tick();
  }, [pageId]);

  // draft highlight (CSS Custom Highlight API) while composing an inline comment
  const draft = useComments((s) => s.draft);
  useEffect(() => {
    const H = (window as any).Highlight;
    const reg = (CSS as any).highlights;
    if (!H || !reg) return;
    if (!draft || draft.end <= draft.start) {
      reg.delete('nc-comment-draft');
      return;
    }
    const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${draft.blockId}"][data-property="${draft.property}"]`);
    const range = leaf ? rangeIn(leaf, draft.start, draft.end) : null;
    if (range) reg.set('nc-comment-draft', new H(range));
    return () => reg.delete('nc-comment-draft');
  }, [draft]);
}

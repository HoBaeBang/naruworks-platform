// Find in page: ⌘F opens the floating find bar at the top right of the frame,
// ⌘⌥F opens it with Replace. The bar is 280px wide,
// r12, 3px blue outline ring, 41px row: input "Find or replace text…" 14px · counter "1 of 2" 0.8rem texTer · ↑ ↓ ⟲ 24×24
// buttons (gap 2) · × (gap 10); Replace panel: 1px divider, "Replace with…" input, "Replace all" + blue "Replace ↵").
// Labels include Previous match / Next match / Replace / Close / Not found / of / Replace all /
// Replaced N matches / No matches changed / This page is locked).
// Matches come record tree, so text inside collapsed toggles (opened when the match is reached), table cells,
// captions and inline database rows is found too. Highlights use the CSS Custom Highlight API (no DOM changes inside
// the editable leaves): other matches rgba(120, 53, 15, 0.4), the current one rgba(120, 53, 15, 0.9) with black text.
// Enter / ⇧Enter = next / previous, Esc closes, typing in the page or opening another page closes the bar.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { annotationsAt, deleteRange, insertText, toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { isArchivedRecord } from '@nc/shared/archive.ts';
import { Icon } from '../../../components/Icon.tsx';
import { getBlock, run, setProperty, setTitle } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { transactions } from '../../../lib/store/transactions.ts';
import { runQuery } from '@nc/shared/database/index.ts';
import type { CollectionViewRecord } from '@nc/shared/records.ts';
import { activeViewIdOf, collectionOfView, collectionRows, makeQueryContext } from '../../database/data.ts';
import { effectiveView } from '../../database/viewState.ts';
import { canEditRow, propertyAccessFor } from '../../database/access.ts';
import { canSuggest, commentOnly, isSuggesting, SUGGESTABLE_TYPES } from '../../comments/suggest.ts';
import { suggestReplacements } from '../../comments/suggestEdits.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { getLocation, useLocation } from '../../../lib/router.ts';
import { positionAt, setSelectionOffsets } from '../richTextDom.ts';
import { useEditor } from '../editorState.ts';
import { isOpen, pageIdOfBlock, setOpen } from '../commands.ts';
import './find.css';

export interface FindMatch {
  /** block (or database row) id and rich-text property holding the match */
  blockId: string;
  property: string;
  start: number;
  end: number;
  /** text block leaf, or a database row cell (plain DOM text) */
  kind: 'leaf' | 'row';
  /** toggles that must be open for the match to be rendered */
  toggles: string[];
  /** k-th occurrence inside the row cell's text (row matches) */
  nth: number;
}

interface FindState {
  open: boolean;
  replace: boolean;
  pageId: string | null;
  query: string;
  replacement: string;
  matches: FindMatch[];
  current: number;
  /** bumps when the bar should take the keyboard focus (⌘F again) */
  focusSeq: number;
}

export const useFind = create<FindState>(() => ({ open: false, replace: false, pageId: null, query: '', replacement: '', matches: [], current: -1, focusSeq: 0 }));

const TEXT_PROPS: Record<string, string[]> = { image: ['caption'], video: ['caption'], audio: ['caption'], file: ['caption', 'title'], pdf: ['caption'], bookmark: ['title', 'description', 'caption'], embed: ['caption'], code: ['title', 'caption'] };
const SKIP_TITLE = new Set(['equation', 'divider', 'table_of_contents', 'breadcrumb', 'column_list', 'column', 'image', 'video', 'audio', 'pdf', 'embed', 'bookmark', 'alias', 'link_to_page', 'transclusion_reference', 'collection_view', 'button']);
const ROW_TEXT_TYPES = new Set(['title', 'text', 'url', 'email', 'phone_number']);

function textOf(b: BlockRecord, prop: string): string {
  return toPlainText((b.properties as Record<string, RichText> | undefined)?.[prop]);
}

function occurrences(text: string, q: string): number[] {
  const out: number[] = [];
  if (!q) return out;
  const hay = text.toLocaleLowerCase();
  const needle = q.toLocaleLowerCase();
  let i = hay.indexOf(needle);
  while (i >= 0) {
    out.push(i);
    i = hay.indexOf(needle, i + Math.max(1, needle.length));
  }
  return out;
}

function rowsOfCollection(collectionId: string): BlockRecord[] {
  const out: BlockRecord[] = [];
  for (const b of records.all<BlockRecord>('block')) {
    if (b.parent_table === 'collection' && b.parent_id === collectionId && b.alive && !b.is_template && !isArchivedRecord(b)) out.push(b);
  }
  return out.sort((a, b) => (a.created_time ?? 0) - (b.created_time ?? 0) || (a.id < b.id ? -1 : 1));
}

/** What an inline database shows: the rows of its current view (filters, the person's own filters, sort order). */
function shownRows(b: BlockRecord): { rows: BlockRecord[]; collection: CollectionRecord | undefined } {
  const view = records.get<CollectionViewRecord>('collection_view', activeViewIdOf(b));
  const coll = collectionOfView(view, b);
  if (!coll) return { rows: [], collection: undefined };
  if (!view) return { rows: rowsOfCollection(coll.id), collection: coll };
  try {
    return { rows: runQuery(collectionRows(coll.id), coll, effectiveView(view), makeQueryContext()).rows, collection: coll };
  } catch {
    return { rows: rowsOfCollection(coll.id), collection: coll };
  }
}

/** Every match of `q` on the page, in document order. */
export function collectMatches(pageId: string, q: string): FindMatch[] {
  const out: FindMatch[] = [];
  if (!q) return out;
  const seen = new Set<string>();
  const add = (b: BlockRecord, prop: string, toggles: string[], kind: FindMatch['kind'] = 'leaf') => {
    const t = textOf(b, prop);
    occurrences(t, q).forEach((s, nth) => out.push({ blockId: b.id, property: prop, start: s, end: s + q.length, kind, toggles, nth }));
  };
  const walk = (id: string, toggles: string[], depth: number) => {
    if (depth > 40 || seen.has(id)) return;
    seen.add(id);
    const b = getBlock(id);
    if (!b || b.alive === false) return;
    if (b.type === 'page' || b.type === 'collection_view_page') {
      add(b, 'title', toggles);
      return;
    }
    if (b.type === 'table') {
      const cols = (b.format?.table_block_column_order as string[] | undefined) ?? [];
      for (const rid of b.content ?? []) {
        const row = getBlock(rid);
        if (row && row.alive !== false) for (const c of cols) add(row, c, toggles);
      }
      return;
    }
    if (b.type === 'collection_view') {
      // only rows the view shows (its filters hide the others) are found
      const { rows, collection: coll } = shownRows(b);
      if (coll) {
        const props = Object.entries(coll.schema ?? {}).filter(([, s]) => ROW_TEXT_TYPES.has(s.type)).map(([k]) => k);
        for (const row of rows) for (const p of props) add(row, p, toggles, 'row');
      }
      return;
    }
    if (b.type === 'transclusion_reference') {
      const ptr = b.format?.transclusion_reference_pointer as { id?: string } | undefined;
      const src = ptr?.id ? getBlock(ptr.id) : undefined;
      for (const c of src?.content ?? []) walk(c, toggles, depth + 1);
      return;
    }
    if (!SKIP_TITLE.has(b.type)) add(b, 'title', toggles);
    for (const p of TEXT_PROPS[b.type] ?? []) if (p !== 'title' || SKIP_TITLE.has(b.type)) add(b, p, toggles);
    const isToggle = b.type === 'toggle' || !!b.format?.toggleable;
    const childToggles = isToggle ? [...toggles, b.id] : toggles;
    for (const c of b.content ?? []) walk(c, childToggles, depth + 1);
  };
  const page = getBlock(pageId);
  if (!page) return out;
  add(page, 'title', []);
  for (const c of page.content ?? []) walk(c, [], 0);
  return out;
}

/* ------------------------------------------------------------------ DOM ranges + highlights */

function scrollerFor(pageId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.nc-page-scroller[data-page-id="${pageId}"]`);
}

function leafFor(root: ParentNode, blockId: string, property: string): HTMLElement | null {
  return root.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${CSS.escape(blockId)}"][data-property="${CSS.escape(property)}"]`);
}

/** Range of the k-th case-insensitive occurrence of q in an element's text (database rows render plain text). */
function textRange(el: Element, q: string, nth: number): Range | null {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    text += (n as Text).data;
  }
  const at = occurrences(text, q)[nth];
  if (at === undefined) return null;
  const pos = (off: number): [Text, number] | null => {
    let acc = 0;
    for (const n of nodes) {
      if (off <= acc + n.data.length) return [n, off - acc];
      acc += n.data.length;
    }
    return null;
  };
  const s = pos(at);
  const e = pos(at + q.length);
  if (!s || !e) return null;
  const r = document.createRange();
  r.setStart(s[0], s[1]);
  r.setEnd(e[0], e[1]);
  return r;
}

function rangeFor(m: FindMatch, root: ParentNode, q: string): Range | null {
  if (m.kind === 'leaf') {
    const leaf = leafFor(root, m.blockId, m.property);
    if (!leaf) return null;
    const s = positionAt(leaf, m.start);
    const e = positionAt(leaf, m.end);
    try {
      const r = document.createRange();
      r.setStart(s.node, s.offset);
      r.setEnd(e.node, e.offset);
      return r;
    } catch {
      return null;
    }
  }
  const row = root.querySelector(`.lit-collection-view-body [data-block-id="${CSS.escape(m.blockId)}"]`);
  if (!row) return null;
  const cell = row.querySelector(`[data-col="${CSS.escape(m.property)}"]`) ?? row;
  return textRange(cell, q, m.nth);
}

type HighlightRegistry = { set: (k: string, v: unknown) => void; delete: (k: string) => void };
const highlights = (): HighlightRegistry | null => ((globalThis as any).CSS?.highlights as HighlightRegistry | undefined) ?? null;
const HighlightCtor = (): (new (...r: Range[]) => unknown) | null => (globalThis as any).Highlight ?? null;

function paint() {
  const reg = highlights();
  const H = HighlightCtor();
  if (!reg || !H) return;
  const st = useFind.getState();
  const root = st.pageId ? scrollerFor(st.pageId) : null;
  if (!st.open || !root || !st.query) {
    reg.delete('nc-find');
    reg.delete('nc-find-current');
    return;
  }
  const others: Range[] = [];
  let cur: Range | null = null;
  st.matches.forEach((m, i) => {
    const r = rangeFor(m, root, st.query);
    if (!r) return;
    if (i === st.current) cur = r;
    else others.push(r);
  });
  reg.set('nc-find', new H(...others));
  if (cur) reg.set('nc-find-current', new H(cur));
  else reg.delete('nc-find-current');
}

/* ------------------------------------------------------------------ navigation */

function keyOf(m: FindMatch | undefined) {
  return m ? `${m.blockId}:${m.property}:${m.start}` : '';
}

function recompute(keepCurrent = true) {
  const st = useFind.getState();
  if (!st.open || !st.pageId) return;
  const prevKey = keepCurrent ? keyOf(st.matches[st.current]) : '';
  const matches = collectMatches(st.pageId, st.query);
  let current = matches.length ? 0 : -1;
  if (prevKey) {
    const i = matches.findIndex((m) => keyOf(m) === prevKey);
    if (i >= 0) current = i;
    else if (st.current >= 0 && matches.length) current = Math.min(st.current, matches.length - 1);
  }
  useFind.setState({ matches, current });
  paint();
}

/** Make a match visible: open the collapsed toggles around it, then scroll it to the middle of the page. */
function reveal(i: number) {
  const st = useFind.getState();
  const m = st.matches[i];
  if (!m || !st.pageId) return;
  const closed = m.toggles.filter((id) => !isOpen(id));
  for (const id of closed) setOpen(id, true);
  const doScroll = () => {
    const root = scrollerFor(st.pageId!);
    if (!root) return;
    paint();
    const r = rangeFor(m, root, st.query);
    const rect = r?.getBoundingClientRect() ?? (root.querySelector(`[data-block-id="${CSS.escape(m.blockId)}"]`) as HTMLElement | null)?.getBoundingClientRect();
    if (!rect) return;
    const sr = root.getBoundingClientRect();
    if (rect.top < sr.top + 80 || rect.bottom > sr.bottom - 40) root.scrollTop += rect.top - (sr.top + sr.height / 2);
  };
  if (closed.length) requestAnimationFrame(() => requestAnimationFrame(doScroll));
  else doScroll();
}

export function findStep(dir: 1 | -1) {
  const st = useFind.getState();
  if (!st.matches.length) return;
  const next = st.current < 0 ? 0 : (st.current + dir + st.matches.length) % st.matches.length;
  useFind.setState({ current: next });
  reveal(next);
}

export function openFind(pageId: string, opts?: { replace?: boolean; query?: string }) {
  const st = useFind.getState();
  const query = opts?.query ?? (st.pageId === pageId ? st.query : '');
  useFind.setState({ open: true, pageId, replace: opts?.replace ?? st.replace, query, focusSeq: st.focusSeq + 1 });
  recompute(false);
  if (useFind.getState().current >= 0) reveal(useFind.getState().current);
}

export function closeFind(opts?: { selectCurrent?: boolean }) {
  const st = useFind.getState();
  if (!st.open) return;
  const m = st.matches[st.current];
  useFind.setState({ open: false, matches: [], current: -1 });
  paint();
  // Esc leaves the found text selected in the page, ready to edit
  if (opts?.selectCurrent && m?.kind === 'leaf' && st.pageId) {
    const root = scrollerFor(st.pageId);
    const leaf = root && leafFor(root, m.blockId, m.property);
    if (leaf?.isContentEditable) {
      leaf.focus({ preventScroll: true });
      setSelectionOffsets(leaf, m.start, m.end);
    }
  }
}

/* ------------------------------------------------------------------ replace */

/** Replacing on this page becomes suggestions (Suggesting mode, or a commenter —). */
function suggestingOn(pageId: string | null): boolean {
  return !!pageId && canSuggest(pageId) && (isSuggesting(pageId) || commentOnly(pageId));
}

function canEdit(pageId: string | null): boolean {
  if (!pageId) return false;
  const page = getBlock(pageId);
  if (!page || page.format?.block_locked) return false;
  return roleAtLeast(records.role('block', pageId), 'read_and_write') || suggestingOn(pageId);
}

/** A match this person may change: its own block's role (synced content other pages, database rows with their * own sharing), the lock of the page holding it, and for database rows the property's access rule. */
function editable(m: FindMatch, suggesting: boolean): boolean {
  const b = getBlock(m.blockId);
  if (!b || b.alive === false) return false;
  if (suggesting) {
    if (m.kind !== 'leaf' || m.property !== 'title' || !SUGGESTABLE_TYPES.has(b.type)) return false;
    // text already suggested for removal (struck through) isn't replaced again
    const title = (b.properties?.title as RichText | undefined) ?? [];
    return !annotationsAt(title, m.start + 1).some((a) => a[0] === 'sr');
  }
  if (m.kind === 'row') return canEditRow(b.id) && propertyAccessFor(b.parent_id, m.property, b).canEditValues;
  const holder = getBlock(pageIdOfBlock(b.id) ?? '');
  if (holder?.format?.block_locked) return false;
  return roleAtLeast(records.role('block', b.id), 'read_and_write');
}

/** "Replaced N matches" once the server kept the change (a refused write shows its own error). */
function toastWhenSaved(n: number) {
  const say = () => useUI.getState().toast(n ? `Replaced ${n} ${n === 1 ? 'match' : 'matches'}` : 'No matches changed');
  if (!n || transactions.pendingCount() === 0) {
    say();
    return;
  }
  const off = transactions.onSaveState((s) => {
    if (s.pending > 0) return;
    off();
    if (!s.error) say();
  });
}

function replaced(v: RichText, start: number, end: number, by: string): RichText {
  const anns = annotationsAt(v, start + 1).filter((a) => !['p', 'u', 'd', 'e', 'lm'].includes(a[0]));
  const cut = deleteRange(v, start, end);
  return by ? insertText(cut, start, by, anns) : cut;
}

function writeProp(tx: Parameters<Parameters<typeof run>[1]>[0], blockId: string, prop: string, v: RichText) {
  if (prop === 'title') setTitle(tx, blockId, v);
  else setProperty(tx, blockId, prop, v);
}

export function replaceCurrent() {
  const st = useFind.getState();
  const m = st.matches[st.current];
  if (!m || !canEdit(st.pageId)) return;
  const b = getBlock(m.blockId);
  if (!b) return;
  const suggesting = suggestingOn(st.pageId);
  if (!editable(m, suggesting)) {
    useUI.getState().toast(suggesting ? 'Suggestions can only be made in text, to-do, heading and list blocks' : "You don't have permission to edit this.");
    return;
  }
  const cur = ((b.properties as Record<string, RichText> | undefined)?.[m.property]) ?? [];
  if (suggesting) suggestReplacements([m], st.replacement);
  else run('inPageFind.replace', (tx) => writeProp(tx, m.blockId, m.property, replaced(cur, m.start, m.end, st.replacement)));
  // the next match keeps its place in the list (the replaced one disappears unless the replacement matches again)
  const idx = st.current;
  recompute(false);
  const after = useFind.getState();
  if (after.matches.length) {
    const next = after.matches.findIndex((x, i) => i >= idx && !(x.blockId === m.blockId && x.property === m.property && x.start < m.start + st.replacement.length && x.start >= m.start));
    const ni = next >= 0 ? next : 0;
    useFind.setState({ current: ni });
    reveal(ni);
  }
}

export function replaceAll() {
  const st = useFind.getState();
  if (!canEdit(st.pageId)) return;
  const suggesting = suggestingOn(st.pageId);
  // only what this person may change: the rest stays (a database row shared read-only, a synced block a page
  // they can't edit, …) instead of the whole replacement being refused by the server
  const targets = st.matches.filter((m) => editable(m, suggesting));
  if (suggesting) {
    toastWhenSaved(targets.length ? suggestReplacements(targets, st.replacement) : 0);
    recompute(false);
    return;
  }
  const groups = new Map<string, FindMatch[]>();
  for (const m of targets) {
    const k = `${m.blockId}\u0000${m.property}`;
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  let n = 0;
  if (groups.size) {
    run('inPageFind.replaceAll', (tx) => {
      for (const ms of groups.values()) {
        const b = getBlock(ms[0].blockId);
        if (!b) continue;
        let v = ((b.properties as Record<string, RichText> | undefined)?.[ms[0].property]) ?? [];
        for (const m of [...ms].sort((a, c) => c.start - a.start)) {
          v = replaced(v, m.start, m.end, st.replacement);
          n++;
        }
        writeProp(tx, ms[0].blockId, ms[0].property, v);
      }
    });
  }
  toastWhenSaved(n);
  recompute(false);
}

/* ------------------------------------------------------------------ UI */

function selectedText(): string {
  const s = window.getSelection()?.toString() ?? '';
  return s.includes('\n') || s.length > 120 ? '' : s;
}

/** Page under the keyboard focus (peek panels have their own scroller), else the routed page. */
function activePageId(): string | null {
  const el = (document.activeElement as HTMLElement | null)?.closest?.('.nc-page-scroller[data-page-id]') as HTMLElement | null;
  if (el?.dataset.pageId) return el.dataset.pageId;
  const { route } = getLocation();
  if (route.name === 'page' && scrollerFor(route.pageId)) return route.pageId;
  const any = document.querySelector<HTMLElement>('.nc-page-scroller[data-page-id]');
  return any?.dataset.pageId ?? null;
}

let installed = false;
/** ⌘F / ⌘⌥F / ⌘G; installed once by the editor surface. */
export function installFindShortcuts() {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? e.metaKey : e.ctrlKey;
    if (!mod || e.code !== 'KeyF' && e.code !== 'KeyG') return;
    if (e.code === 'KeyG') {
      if (!useFind.getState().open) return;
      e.preventDefault();
      findStep(e.shiftKey ? -1 : 1);
      return;
    }
    if (e.shiftKey) return;
    const pageId = activePageId();
    if (!pageId) return; // no page on screen: the browser's own find
    e.preventDefault();
    e.stopPropagation();
    const sel = selectedText();
    openFind(pageId, { replace: e.altKey ? true : undefined, query: sel || undefined });
  }, true);
  // typing in the page closes the bar
  document.addEventListener('beforeinput', (e) => {
    if (!useFind.getState().open) return;
    if ((e.target as HTMLElement | null)?.closest?.('.nc-find-bar')) return;
    if ((e.target as HTMLElement | null)?.closest?.('[data-content-editable-leaf]')) closeFind();
  }, true);
}

export function FindBar() {
  const st = useFind();
  const { route } = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [frame, setFrame] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (st.open) setFrame(document.querySelector<HTMLElement>('main.lit-frame'));
  }, [st.open]);

  // focus + select the query on every ⌘F
  useEffect(() => {
    if (!st.open) return;
    const el = inputRef.current;
    if (el) {
      el.focus({ preventScroll: true });
      el.select();
    }
  }, [st.open, st.focusSeq, frame]);

  // another page → close
  const routePage = route.name === 'page' ? route.pageId : null;
  useEffect(() => {
    const s = useFind.getState();
    if (s.open && s.pageId && routePage && routePage !== s.pageId && !document.querySelector(`.nc-page-scroller[data-page-id="${s.pageId}"]`)) closeFind();
  }, [routePage]);

  // keep matches/highlights in sync with edits, remote changes and toggles opening
  useEffect(() => {
    if (!st.open || !st.pageId) return;
    const root = scrollerFor(st.pageId);
    if (!root) return;
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => recompute(true));
    });
    mo.observe(root, { subtree: true, childList: true, characterData: true });
    const onScroll = () => paint();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
      root.removeEventListener('scroll', onScroll);
    };
  }, [st.open, st.pageId]);

  useEffect(() => () => {
    const reg = highlights();
    reg?.delete('nc-find');
    reg?.delete('nc-find-current');
  }, []);

  if (!st.open || !frame) return null;
  const editable = canEdit(st.pageId);
  const total = st.matches.length;
  const locked = !!getBlock(st.pageId)?.format?.block_locked;
  return createPortal(
    <div
      className="nc-find-bar"
      role="dialog"
      aria-label="Find in page"
      onMouseDown={(e) => {
        e.stopPropagation();
        // buttons keep the keyboard focus in the inputs (Enter / Esc keep working)
        if ((e.target as HTMLElement).closest('[role="button"]')) e.preventDefault();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.stopPropagation();
          closeFind({ selectCurrent: true });
        }
      }}
    >
      <div className="nc-find-row">
        <div className="nc-find-input">
          <input
            ref={inputRef}
            type="text"
            placeholder="Find or replace text…"
            value={st.query}
            spellCheck={false}
            onChange={(e) => {
              useFind.setState({ query: e.target.value });
              recompute(false);
              if (useFind.getState().current >= 0) reveal(useFind.getState().current);
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter') {
                e.preventDefault();
                findStep(e.shiftKey ? -1 : 1);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeFind({ selectCurrent: true });
              }
            }}
          />
        </div>
        {st.query && (
          <div className="nc-find-count" aria-live="polite">
            {total ? <div className="nc-find-count-inner"><span>{st.current + 1}</span>of<span>{total}</span></div> : <span>Not found</span>}
          </div>
        )}
        <div className="nc-find-buttons">
          <div role="button" tabIndex={0} aria-label="Previous match" data-tooltip="Previous match" data-tooltip-sub="⇧↵" className={`nc-find-btn ${total ? '' : 'disabled'}`} onClick={() => findStep(-1)}>
            <Icon name="arrowUp" size={16} />
          </div>
          <div role="button" tabIndex={0} aria-label="Next match" data-tooltip="Next match" data-tooltip-sub="↵" className={`nc-find-btn ${total ? '' : 'disabled'}`} onClick={() => findStep(1)}>
            <Icon name="arrowDown" size={16} />
          </div>
          <div
            role="button"
            tabIndex={0}
            aria-label="Replace"
            aria-pressed={st.replace}
            data-tooltip={locked ? 'This page is locked' : 'Replace'}
            className={`nc-find-btn ${st.replace ? 'pressed' : ''} ${editable ? '' : 'disabled'}`}
            onClick={() => { if (editable) useFind.setState({ replace: !st.replace }); }}
          >
            <Icon name="arrowLoop" size={16} />
          </div>
        </div>
        <div role="button" tabIndex={0} aria-label="Close" data-tooltip="Close" data-tooltip-sub="esc" className="nc-find-btn" onClick={() => closeFind()}>
          <Icon name="close" size={16} />
        </div>
      </div>
      {st.replace && editable && (
        <div className="nc-find-replace">
          <div className="nc-find-divider" />
          <div className="nc-find-replace-body">
            <div className="nc-find-input">
              <input
                type="text"
                placeholder="Replace with…"
                value={st.replacement}
                spellCheck={false}
                onChange={(e) => useFind.setState({ replacement: e.target.value })}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing) return;
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    if (e.metaKey || e.ctrlKey) replaceAll();
                    else replaceCurrent();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    closeFind({ selectCurrent: true });
                  }
                }}
              />
            </div>
            <div className="nc-find-replace-actions">
              <div role="button" tabIndex={0} className={`nc-find-text-btn ${total ? '' : 'disabled'}`} onClick={() => replaceAll()}>Replace all</div>
              <div role="button" tabIndex={0} className={`nc-find-primary-btn ${total ? '' : 'disabled'}`} onClick={() => replaceCurrent()}>
                <div className="inner">Replace<Icon name="arrowTurnDownLeft" size={16} /></div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    frame,
  );
}

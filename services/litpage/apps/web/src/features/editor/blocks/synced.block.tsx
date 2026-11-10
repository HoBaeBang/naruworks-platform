import { HELP_URL } from '@nc/shared/brand.ts';
// Synced blocks: original = transclusion_container{content:[…]}, copy = transclusion_reference with
// format.transclusion_reference_pointer {id, table:"block", spaceId}; copies render (and edit) the original's
// children. The border is 2px solid rgb(253, 186, 116)
// (var(--lp-orange-border-primary)) r6 border while hovered/focused; action bar at the top-right: "Editing original ▾" /
// "Synced to N other pages ▾" (aria "Open backlinks", 112×24), "Copy mirrored block" (24×24), ••• (block menu).
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { registerBlock, BlockList, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { useBlock } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { api } from '../../../lib/api.ts';
import { createBlockIn, getBlock, moveBlocksIn, pageOf, run } from '../../../lib/blocks.ts';
import type { Tx } from '../../../lib/store/transactions.ts';
import { openPage } from '../../../lib/router.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { openBlockMenu } from '../BlockMenu.tsx';
import { useEditor } from '../editorState.ts';
import { blockToMarkdown } from '../clipboard.ts';
import { registerBlockMenu, registerTurnInto, overrideSlashItem } from './registry.ts';
import { createSyncedBlock, wrapInSyncedBlock } from './factories.ts';
import { toast } from './shared.tsx';

const MARK = 'data-nc-synced-block';

/* ------------------------------------------------------------------ references */

interface RefInfo {
  id: string;
  pageId: string;
}

const refCache = new Map<string, { at: number; refs: RefInfo[] }>();

async function fetchReferences(containerId: string, force = false): Promise<RefInfo[]> {
  const hit = refCache.get(containerId);
  if (hit && !force && Date.now() - hit.at < 5000) return hit.refs;
  try {
    const res = await api<{ references: RefInfo[]; recordMap?: any }>('getTransclusionReferences', { blockId: containerId });
    if (res.recordMap) records.mergeRecordMap(res.recordMap);
    refCache.set(containerId, { at: Date.now(), refs: res.references ?? [] });
    return res.references ?? [];
  } catch {
    return hit?.refs ?? [];
  }
}

function useReferences(containerId: string | undefined, enabled: boolean): RefInfo[] {
  const [refs, setRefs] = useState<RefInfo[]>(() => (containerId ? refCache.get(containerId)?.refs ?? [] : []));
  useEffect(() => {
    if (!containerId || !enabled) return;
    let alive = true;
    void fetchReferences(containerId).then((r) => alive && setRefs(r));
    return () => {
      alive = false;
    };
  }, [containerId, enabled]);
  return refs;
}

/* ------------------------------------------------------------------ copy / paste */

function containerOf(b: BlockRecord | undefined): string | undefined {
  if (!b) return undefined;
  if (b.type === 'transclusion_container') return b.id;
  if (b.type === 'transclusion_reference') return (b.format as any)?.transclusion_reference_pointer?.id;
  return undefined;
}

export async function copySyncedBlock(blockId: string) {
  const id = containerOf(getBlock(blockId));
  const c = getBlock(id);
  if (!c) return;
  const md = (c.content ?? []).map((k) => getBlock(k)).filter((k): k is BlockRecord => !!k && k.alive)
    .map((k) => blockToMarkdown({ type: k.type, title: (k.properties?.title as any) ?? [], props: k.properties as any, children: [] }, 0)).join('\n');
  const html = `<div ${MARK}="${c.id}" data-space-id="${c.space_id}">${md.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]!)}</div>`;
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([md || ' '], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
  } catch {
    // fallback: execCommand copy with a temporary listener
    const on = (e: ClipboardEvent) => {
      e.clipboardData?.setData('text/plain', md || ' ');
      e.clipboardData?.setData('text/html', html);
      e.preventDefault();
    };
    document.addEventListener('copy', on, { once: true });
    document.execCommand('copy');
  }
  lastCopied = c.id;
  toast('Copied. Paste into any page to mirror it.');
}

let lastCopied: string | null = null;

/** Insert a synced copy of container `srcId` at the current caret block (replacing it when empty). */
export function pasteSyncedReference(srcId: string, atBlockId: string) {
  const at = getBlock(atBlockId);
  const src = getBlock(srcId);
  if (!at || !src) return;
  // pasting inside the original (or its own copies) would recurse: paste a plain copy instead
  let cur: BlockRecord | undefined = at;
  for (let i = 0; i < 50 && cur; i++) {
    if (cur.id === srcId) {
      toast('Can’t paste a synced block inside itself');
      return;
    }
    cur = cur.parent_table === 'block' ? getBlock(cur.parent_id) : undefined;
  }
  const empty = at.type === 'text' && !(at.properties?.title as any)?.length && !(at.content?.length);
  const id = newId();
  run('blockPasteActions.createTransclusionReference', (tx) => {
    createBlockIn(tx, { id, type: 'transclusion_reference', parentId: at.parent_id, parentTable: at.parent_table as any, after: atBlockId, format: { transclusion_reference_pointer: { id: srcId, table: 'block', spaceId: src.space_id } } as any });
    if (empty) {
      tx.update('block', atBlockId, [], { alive: false });
      tx.listRemove('block', at.parent_id, ['content'], atBlockId);
    }
  });
  refCache.delete(srcId);
  useEditor.getState().selectBlocks([id], id);
}

function onPaste(e: ClipboardEvent) {
  const html = e.clipboardData?.getData('text/html') ?? '';
  const m = new RegExp(`${MARK}="([0-9a-f-]{36})"`).exec(html);
  if (!m) return;
  const f = useEditor.getState().focused;
  const target = f?.blockId ?? useEditor.getState().selectedBlocks[0];
  if (!target || !getBlock(target) || !getBlock(m[1])) return;
  e.preventDefault();
  e.stopPropagation();
  pasteSyncedReference(m[1], target);
}

function onKeyDown(e: KeyboardEvent) {
  // ⌘C on a selected synced block copies it as a synced block (pasting creates a synced copy)
  if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'c' || e.shiftKey || e.altKey) return;
  const sel = useEditor.getState().selectedBlocks;
  if (sel.length !== 1 || (document.activeElement as HTMLElement | null)?.isContentEditable) return;
  if (!containerOf(getBlock(sel[0]))) return;
  e.preventDefault();
  e.stopPropagation();
  void copySyncedBlock(sel[0]);
}

const w = window as any;
if (w.__ncSyncedPaste) window.removeEventListener('paste', w.__ncSyncedPaste, true);
if (w.__ncSyncedKey) window.removeEventListener('keydown', w.__ncSyncedKey, true);
w.__ncSyncedPaste = onPaste;
w.__ncSyncedKey = onKeyDown;
window.addEventListener('paste', onPaste, true);
window.addEventListener('keydown', onKeyDown, true);

/* ------------------------------------------------------------------ unsync */

/** Deep-copy `ids` (with descendants) after `after` under `parentId`. */
function cloneInto(tx: Tx, ids: string[], parentId: string, parentTable: any, after: string | undefined): string | undefined {
  let prev = after;
  const clone = (id: string, pid: string, ptable: any, aft?: string): string | undefined => {
    const b = getBlock(id);
    if (!b || !b.alive) return undefined;
    const nid = newId();
    const { version: _v, content, id: _id, ...rest } = b;
    void _v; void _id;
    tx.set('block', nid, [], { ...rest, id: nid, parent_id: pid, parent_table: ptable, content: [], created_time: Date.now(), last_edited_time: Date.now(), copied_from: id });
    if (ptable === 'block') tx.listAfter('block', pid, ['content'], nid, aft);
    let last: string | undefined;
    for (const c of content ?? []) last = clone(c, nid, 'block', last) ?? last;
    return nid;
  };
  for (const id of ids) prev = clone(id, parentId, parentTable, prev) ?? prev;
  return prev;
}

export function unsyncReference(refId: string) {
  const ref = getBlock(refId);
  const src = getBlock(containerOf(ref));
  if (!ref) return;
  run('transclusion.unsyncReference', (tx) => {
    cloneInto(tx, src?.content ?? [], ref.parent_id, ref.parent_table, refId);
    tx.update('block', refId, [], { alive: false });
    tx.listRemove('block', ref.parent_id, ['content'], refId);
  });
}

export async function unsyncAll(containerId: string) {
  const c = getBlock(containerId);
  if (!c) return;
  const refs = await fetchReferences(containerId, true);
  run('transclusion.unsyncContainer', (tx) => {
    for (const r of refs) {
      const rb = getBlock(r.id);
      if (!rb || !rb.alive) continue;
      cloneInto(tx, c.content ?? [], rb.parent_id, rb.parent_table, rb.id);
      tx.update('block', rb.id, [], { alive: false });
      tx.listRemove('block', rb.parent_id, ['content'], rb.id);
    }
    const kids = (c.content ?? []).filter((k) => getBlock(k)?.alive);
    if (kids.length) moveBlocksIn(tx, kids, { parentId: c.parent_id, parentTable: c.parent_table as any, after: containerId });
    tx.update('block', containerId, [], { alive: false });
    tx.listRemove('block', c.parent_id, ['content'], containerId);
  });
  refCache.delete(containerId);
}

function confirmDialog(anchor: HTMLElement | DOMRect, title: string, text: string, confirm: string, onConfirm: () => void) {
  openOverlay((close) => (
    <PopoverSurface width={300}>
      <div className="nc-confirm-dialog">
        <div className="msg" style={{ fontWeight: 600 }}>{title}</div>
        <div className="msg" style={{ color: 'var(--lp-text-secondary)', fontSize: 13 }}>{text}</div>
        <div className="btns">
          <button className="nc-blk-btn danger outline" onClick={() => { close(); onConfirm(); }}>{confirm}</button>
          <button className="nc-blk-btn outline" onClick={close}>Cancel</button>
        </div>
      </div>
    </PopoverSurface>
  ), { anchor: anchor as any, placement: 'center', backdrop: 'dim' });
}

/* ------------------------------------------------------------------ UI */

function pagesLabel(n: number) {
  return n === 1 ? '1 other page' : `${n} other pages`;
}

function BacklinksButton({ containerId, refs, currentPage }: { containerId: string; refs: RefInfo[]; currentPage?: string }) {
  const origPage = pageOf(containerId)?.id;
  const others = useMemo(() => {
    const pages = new Set<string>();
    if (origPage && origPage !== currentPage) pages.add(origPage);
    for (const r of refs) if (r.pageId !== currentPage) pages.add(r.pageId);
    return Array.from(pages);
  }, [refs, origPage, currentPage]);
  const label = others.length === 0 ? 'Editing original' : `Synced to ${pagesLabel(others.length)}`;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Open backlinks"
      className="nc-blk-action with-text"
      style={{ color: 'var(--lp-text-secondary)', fontSize: 14, height: 24 }}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        void fetchReferences(containerId, true);
        const all = [origPage, ...refs.map((r) => r.pageId)].filter((p, i, a): p is string => !!p && a.indexOf(p) === i);
        openMenu(e.currentTarget, {
          width: 280,
          sections: [{
            title: 'Synced to',
            items: all.map((p) => ({
              id: p, label: pageTitle(getBlock(p)) || 'New page', icon: <PageIcon block={getBlock(p)} size={20} />,
              right: p === origPage ? <span className="nc-menu-badge">Original</span> : p === currentPage ? <span className="nc-menu-shortcut">Current</span> : undefined,
              onSelect: () => { if (p !== currentPage) openPage(p); },
            })),
          }, ...(HELP_URL ? [{ items: [{ label: 'Learn about mirrored blocks', icon: 'questionMarkCircle', onSelect: () => window.open(HELP_URL!, '_blank') }] }] : [])],
        });
      }}
    >
      {label}
      <Icon name="chevronDown" size={14} />
    </div>
  );
}

function SyncFrame({ block, containerId, depth, readOnly, isReference }: { block: BlockRecord; containerId: string; depth: number; readOnly: boolean; isReference: boolean }) {
  const src = useBlock(containerId);
  const [hover, setHover] = useState(false);
  const focused = useEditor((s) => {
    const f = s.focused?.blockId;
    if (!f || !src) return false;
    let cur = getBlock(f);
    for (let i = 0; i < 40 && cur; i++) {
      if (cur.id === containerId) return true;
      cur = cur.parent_table === 'block' ? getBlock(cur.parent_id) : undefined;
    }
    return false;
  });
  const active = (hover || focused) && !readOnly;
  const refs = useReferences(containerId, active);
  const currentPage = pageOf(block.id)?.id;
  const kids = src?.content ?? [];

  if (!src) {
    return (
      <div className="nc-bpad0">
        <div className="nc-synced-2 readonly">
          <div className="nc-synced-missing"><Icon name="blockSync" size={16} />You can’t access this mirrored block</div>
        </div>
      </div>
    );
  }
  return (
    <div className="nc-bpad0" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className={`nc-synced-2 ${active ? 'active' : ''} ${readOnly ? 'readonly' : ''}`} data-synced-container={containerId}>
        {!readOnly && (
          <div className="nc-synced-bar" role="toolbar" aria-label="Mirrored block actions" onMouseDown={(e) => e.preventDefault()}>
            <BacklinksButton containerId={containerId} refs={refs} currentPage={currentPage} />
            <div className="nc-blk-action-divider" />
            <div role="button" tabIndex={0} className="nc-blk-action" aria-label="Copy mirrored block" data-tooltip="Copy mirrored block" onClick={() => void copySyncedBlock(block.id)}>
              <Icon name="duplicate" size={16} />
            </div>
            <div role="button" tabIndex={0} className="nc-blk-action" aria-label="Open block options" onClick={(e) => openBlockMenu([block.id], e.currentTarget.getBoundingClientRect())}>
              <Icon name="ellipsis" size={16} />
            </div>
          </div>
        )}
        {src.alive === false && (
          <div className="nc-synced-missing">
            <Icon name="warningTriangle" size={16} />
            {isReference ? 'The original synced block has been deleted.' : 'This synced block has been deleted.'}
            {isReference && !readOnly && <button className="nc-blk-btn outline" style={{ marginInlineStart: 'auto' }} onClick={() => unsyncReference(block.id)}>Unsync</button>}
          </div>
        )}
        {kids.length ? (
          <BlockList parentId={containerId} ids={kids} depth={depth + 1} readOnly={readOnly} />
        ) : (
          <div
            className="nc-synced-empty-2"
            role="button"
            onMouseDown={(e) => {
              if (readOnly) return;
              e.preventDefault();
              let id = '';
              run('transclusion.addChild', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: containerId, parentTable: 'block' }); });
              useEditor.getState().requestFocus(id, 0);
            }}
          >
            Click or drag blocks here, then paste in another page to sync content.
          </div>
        )}
      </div>
    </div>
  );
}

function SyncedContainer({ block, depth, readOnly }: BlockProps) {
  return <SyncFrame block={block} containerId={block.id} depth={depth} readOnly={readOnly} isReference={false} />;
}

function SyncedReference({ block, depth, readOnly }: BlockProps) {
  const srcId = containerOf(block);
  const src = useBlock(srcId);
  useEffect(() => {
    // the original may live on another page that is not loaded yet
    if (srcId && !src) void api('fetchRecords', { requests: [{ pointer: { table: 'block', id: srcId }, version: -1 }] }).then((res: any) => res?.recordMap && records.mergeRecordMap(res.recordMap)).catch(() => {});
  }, [srcId, src]);
  if (!srcId) return null;
  return <SyncFrame block={block} containerId={srcId} depth={depth} readOnly={readOnly} isReference />;
}

registerBlock(['transclusion_container'], SyncedContainer);
registerBlock(['transclusion_reference'], SyncedReference);

registerBlockMenu(['transclusion_container'], ({ block, anchor }) => [
  { label: 'Copy and sync', icon: 'blockSync', onSelect: () => void copySyncedBlock(block.id) },
  {
    label: 'Unsync all', icon: 'unsync',
    onSelect: () => {
      void fetchReferences(block.id, true).then((refs) => {
        if (!refs.length) return unsyncAll(block.id);
        confirmDialog(anchor ?? new DOMRect(innerWidth / 2, innerHeight / 3, 0, 0), 'Unsync all?', `${pagesLabel(refs.length)[0].toUpperCase()}${pagesLabel(refs.length).slice(1)} will no longer sync with these blocks.`, 'Unsync all', () => void unsyncAll(block.id));
      });
    },
  },
]);

registerBlockMenu(['transclusion_reference'], ({ block, anchor }) => [
  { label: 'Copy and sync', icon: 'blockSync', onSelect: () => void copySyncedBlock(block.id) },
  { label: 'Go to original', icon: 'arrowDiagonalUpRight', onSelect: () => { const p = pageOf(containerOf(block) ?? '')?.id; if (p) openPage(p); } },
  {
    label: 'Unsync', icon: 'unsync',
    onSelect: () => confirmDialog(anchor ?? new DOMRect(innerWidth / 2, innerHeight / 3, 0, 0), 'Unsync this?', 'Selected blocks will stop mirroring the source.', 'Unsync', () => unsyncReference(block.id)),
  },
]);

overrideSlashItem('synced', createSyncedBlock);
registerTurnInto('transclusion_container', wrapInSyncedBlock);
void lastCopied;

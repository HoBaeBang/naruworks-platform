// Sub-page (page / collection_view_page) and link-to-page (alias) blocks, plus the "Page link" picker.
// Slash “Page link” inserts an empty `link_to_page` block (16px tall, padding 8px) and opens a
// page picker; choosing a page turns it into an `alias` block with format.alias_pointer {id, table, spaceId}
// alias = “Page link”, format.alias_pointer. Dismissing the picker removes the empty block.
// The “[[]” picker menu has a “Page link” section with icon, title, and parent path rows.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { TEXT_BLOCKS } from '@nc/shared/blocks.ts';
import { length } from '@nc/shared/richtext.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface, useOverlays } from '../../../components/overlay.tsx';
import { MenuRow, type MenuItemDef } from '../../../components/Menu.tsx';
import { useBlock } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { ancestorsOf, createBlockIn, getBlock, run, setFormat, touch } from '../../../lib/blocks.ts';
import { openPage, pageUrl } from '../../../lib/router.ts';
import { api } from '../../../lib/api.ts';
import { useSession } from '../../../lib/store/session.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { useEditor } from '../editorState.ts';
import { pageIdOfBlock, titleOf } from '../commands.ts';
import type { SlashContext } from '../slashItems.ts';
import { registerBlockMenu } from './registry.ts';
import { blockElement } from './shared.tsx';

function aliasTarget(b: BlockRecord): string | undefined {
  return (b.format as any)?.alias_pointer?.id as string | undefined;
}

function PageLinkBlock({ block, readOnly }: BlockProps) {
  const isAlias = block.type === 'alias' || block.type === 'link_to_page';
  const targetId = isAlias ? aliasTarget(block) : block.id;
  const target = useBlock(targetId);
  const elRef = useRef<HTMLDivElement>(null);

  // empty link_to_page: invisible 16px row that re-opens the picker (and is removed when dismissed)
  if (block.type === 'link_to_page' && !targetId) {
    return (
      <div className="nc-bpad">
        <div ref={elRef} className="nc-link-empty" role="button" aria-label="Page link" onClick={() => !readOnly && elRef.current && openLinkToPagePicker(block.id, elRef.current)} />
      </div>
    );
  }
  if (!target || target.alive === false) {
    return (
      <div className="nc-pad">
        <div className="nc-pagelink-2 missing">
          <div className="nc-pagelink-icon"><Icon name="pageEmpty" size={18} style={{ color: 'var(--lp-icon-secondary)' }} /></div>
          <span className="nc-pagelink-title-2" style={{ borderBottom: 'none', fontWeight: 400 }}>{target && target.alive === false ? 'Deleted page' : 'You can’t view this page'}</span>
        </div>
      </div>
    );
  }
  const title = pageTitle(target) || (target.type === 'collection_view_page' ? 'Untitled database' : 'New page');
  return (
    <div className="nc-pad">
      <a
        href={pageUrl(target.id)}
        className="nc-pagelink-2"
        role="link"
        draggable={false}
        onClick={(e) => {
          e.preventDefault();
          if (e.metaKey || e.ctrlKey) window.open(pageUrl(target.id), '_blank');
          else openPage(target.id);
        }}
      >
        <div className="nc-pagelink-icon">
          <PageIcon block={target} size={24} />
          {isAlias && <span className="arrow"><Icon name="arrowDiagonalUpRightSmall" size={10} strokeWidth={2.4} /></span>}
        </div>
        <span className="nc-pagelink-title-2">{title}</span>
      </a>
    </div>
  );
}

registerBlock(['page', 'alias', 'link_to_page', 'collection_view_page'], PageLinkBlock);

// sub-page blocks: the editor defaults + "Open a new tab" 
registerBlockMenu(['page'], ({ block, turnInto, color }) => [
  turnInto,
  color,
  { label: 'Open a new tab', icon: 'openAsPage', onSelect: () => { window.open(pageUrl(block.id), '_blank'); } },
]);

registerBlockMenu(['alias', 'link_to_page'], ({ block, color }) => [
  color,
  { label: 'Open a new tab', icon: 'openAsPage', onSelect: () => { const t = aliasTarget(block); if (t) window.open(pageUrl(t), '_blank'); } },
  { label: 'Edit link', icon: 'pencilLine', onSelect: () => { const el = blockElement(block.id); if (el) setTimeout(() => openLinkToPagePicker(block.id, el), 0); } },
]);

/* ------------------------------------------------------------------ picker */

interface PickerResult {
  id: string;
}

function parentPath(b: BlockRecord | undefined): string {
  if (!b) return '';
  const chain = ancestorsOf(b.id);
  return chain.map((p) => pageTitle(p) || 'New page').join(' / ');
}

function usePageSearch(q: string) {
  const spaceId = useSession((s) => s.spaceId);
  const [ids, setIds] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        if (!q.trim()) {
          const res = await api('listRecentPages', { spaceId, limit: 20 });
          if (!alive) return;
          records.mergeRecordMap(res.recordMap);
          const list = (res.pages as PickerResult[]).map((p) => p.id);
          setIds(list);
          setTotal(list.length);
          return;
        }
        const res = await api('searchWorkspace', { query: q, spaceId, limit: 50, filters: { titleOnly: false } });
        if (!alive) return;
        records.mergeRecordMap(res.recordMap);
        const list = (res.results as PickerResult[]).map((r) => r.id);
        setIds(list);
        setTotal(res.total ?? list.length);
      } catch {
        if (alive) setIds([]);
      }
    }, 100);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, spaceId]);
  return { ids, total };
}

function LinkToPagePicker({ blockId, close, onDone }: { blockId: string; close: () => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const { ids, total } = usePageSearch(q);
  const hostPage = pageIdOfBlock(blockId);
  const pages = useMemo(() => ids.filter((id) => id !== hostPage).slice(0, 5), [ids, hostPage]);
  const choose = (pageId: string) => {
    const b = getBlock(blockId);
    if (!b) return;
    run('linkToPage.select', (tx) => {
      tx.update('block', blockId, [], { type: 'alias' });
      setFormat(tx, blockId, { alias_pointer: { id: pageId, table: 'block', spaceId: b.space_id } } as any);
      touch(tx, blockId);
    });
    onDone();
    close();
    useEditor.getState().selectBlocks([blockId], blockId);
  };
  const createSub = () => {
    const b = getBlock(blockId);
    const parent = hostPage;
    if (!b || !parent) return;
    const pageId = newId();
    run('linkToPage.newSubpage', (tx) => {
      createBlockIn(tx, { id: pageId, type: 'page', parentId: parent, parentTable: 'block', title: q ? [[q]] : [], list: null });
      tx.update('block', blockId, [], { type: 'alias' });
      setFormat(tx, blockId, { alias_pointer: { id: pageId, table: 'block', spaceId: b.space_id } } as any);
    });
    onDone();
    close();
  };
  const items: MenuItemDef[] = [
    ...pages.map((id) => {
      const p = getBlock(id);
      const path = parentPath(p);
      return {
        id, text: pageTitle(p),
        label: (
          <div className="nc-link-picker-item">
            <div style={{ minWidth: 0 }}>
              <div className="nc-ellipsis">{pageTitle(p) || 'New page'}</div>
              {path && <div className="sub">{path}</div>}
            </div>
          </div>
        ),
        icon: <PageIcon block={p} size={20} />,
        onSelect: () => choose(id),
      } as MenuItemDef;
    }),
    ...(total > pages.length && pages.length >= 5 ? [{ id: 'more', label: `${total - pages.length} more results`, icon: 'ellipsis', disabled: true } as MenuItemDef] : []),
  ];
  const actions: MenuItemDef[] = [
    { id: 'new', label: q ? `Add new “${q}” sub-page` : 'Add a child page', icon: 'plus', onSelect: createSub },
  ];
  const flat = [...items.filter((i) => !i.disabled), ...actions];
  useEffect(() => setActive(0), [q, ids.length]);
  return (
    <PopoverSurface width={324} maxHeight={360} className="nc-link-to-page-picker">
      <div className="nc-menu-search">
        <div className="nc-input focused">
          <input
            autoFocus
            placeholder="Find a page…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % Math.max(1, flat.length)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + flat.length) % Math.max(1, flat.length)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); flat[active]?.onSelect?.(); }
            }}
          />
        </div>
      </div>
      <div className="lit-scroller vertical nc-menu-scroll" role="listbox">
        <div className="nc-menu-section">
          <div className="nc-menu-section-title">Page link</div>
          {items.length === 0 && <div className="nc-menu-empty">{q ? 'No results' : 'No recent pages'}</div>}
          {items.map((it) => (
            <MenuRow key={it.id} item={it} active={!it.disabled && flat.indexOf(it) === active} onHover={() => !it.disabled && setActive(flat.indexOf(it))} onClick={() => it.onSelect?.()} />
          ))}
        </div>
        <div className="nc-menu-section">
          {actions.map((it) => (
            <MenuRow key={it.id} item={it} active={flat.indexOf(it) === active} onHover={() => setActive(flat.indexOf(it))} onClick={() => it.onSelect?.()} />
          ))}
        </div>
      </div>
    </PopoverSurface>
  );
}

export function openLinkToPagePicker(blockId: string, anchor: HTMLElement) {
  let done = false;
  return openOverlay((close) => <LinkToPagePicker blockId={blockId} close={close} onDone={() => { done = true; }} />, {
    anchor, placement: 'bottom-start', offset: 4,
    onClose: () => {
      const b = getBlock(blockId);
      // dismissed without choosing: drop the empty placeholder block
      if (!done && b && b.type === 'link_to_page' && !aliasTarget(b) && b.alive) {
        run('linkToPage.cancel', (tx) => {
          tx.update('block', blockId, [], { alive: false });
          tx.listRemove('block', b.parent_id, ['content'], blockId);
        }, { skipHistory: true });
      }
    },
  });
}

/** Slash "Page link": empty link_to_page block in place of the slash block + picker. */
function startLinkToPage(ctx: SlashContext) {
  const b = getBlock(ctx.blockId);
  if (!b) return;
  let id = ctx.blockId;
  const replace = ctx.empty && (b.type === 'text' || TEXT_BLOCKS.has(b.type)) && length(titleOf(b.id)) === 0 && !(b.content?.length);
  run('linkToPage.insert', (tx) => {
    if (replace) {
      tx.update('block', ctx.blockId, [], { type: 'link_to_page' });
      touch(tx, ctx.blockId);
    } else {
      id = createBlockIn(tx, { type: 'link_to_page', parentId: b.parent_id, parentTable: b.parent_table as any, after: ctx.blockId });
    }
  });
  (document.activeElement as HTMLElement | null)?.blur?.();
  const tryOpen = (n: number) => {
    const el = blockElement(id)?.querySelector('.nc-link-empty') as HTMLElement | null;
    if (el) openLinkToPagePicker(id, el);
    else if (n > 0) setTimeout(() => tryOpen(n - 1), 30);
  };
  setTimeout(() => tryOpen(10), 0);
}

function onLinkToPage(e: Event) {
  const ctx = (e as CustomEvent).detail as SlashContext;
  if (!ctx?.blockId) return;
  // close any lingering slash overlay first
  if (useOverlays.getState().stack.length) useOverlays.getState().closeAll();
  startLinkToPage(ctx);
}
const w = window as any;
if (w.__ncLinkToPage) window.removeEventListener('nc:link-to-page', w.__ncLinkToPage);
w.__ncLinkToPage = onLinkToPage;
window.addEventListener('nc:link-to-page', onLinkToPage);

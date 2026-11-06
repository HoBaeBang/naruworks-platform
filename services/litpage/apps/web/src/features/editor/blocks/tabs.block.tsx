// Tabs block. Record shape: type "tab" whose children are
// text blocks, one per tab — the text block's title is the tab label (empty → "Tab N",
// The tab title is numbered when needed, and its children are the tab content; an optional icon appears in the text
// block’s format.page_icon. Card border 1px var(--lp-border-primary), r16; tablist pills role=tab
// 32px, padding 0 10px, r9999, 14px/500 (selected rgba(67, 20, 7, 0.05) + texPri, others rgb(129, 140, 248)); "Add tab"
// + 28×28 on hover; empty tab hint "Empty tab. Click or drop blocks inside.". Tab menu: Rename, Edit icon,
// Copy link, Delete. The selected tab is per-viewer UI state.
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { registerBlock, BlockList, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { useRecords } from '../../../lib/hooks.ts';
import { createBlockIn, getBlock, run, setFormat, setTitle } from '../../../lib/blocks.ts';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { copyPageLink } from '../../page/pageActions.ts';
import { useEditor } from '../editorState.ts';
import { pageIdOfBlock } from '../commands.ts';
import { registerBlockMenu, overrideSlashItem } from './registry.ts';
import { createTabs } from './factories.ts';

const KEY = 'nc:tab-selected:';

function readSelected(blockId: string): string | null {
  try {
    return localStorage.getItem(KEY + blockId);
  } catch {
    return null;
  }
}

function writeSelected(blockId: string, tabId: string) {
  try {
    localStorage.setItem(KEY + blockId, tabId);
  } catch {
    /* ignore */
  }
}

export function tabLabel(tab: BlockRecord, index: number): string {
  return toPlainText(tab.properties?.title as RichText | undefined) || `Tab ${index + 1}`;
}

function addTab(blockId: string): string {
  let id = '';
  const b = getBlock(blockId);
  run('tabBlockActions.addTab', (tx) => {
    id = createBlockIn(tx, { type: 'text', parentId: blockId, parentTable: 'block', after: b?.content?.[b.content.length - 1], format: {} });
  });
  return id;
}

function deleteTab(blockId: string, tabId: string) {
  const b = getBlock(blockId);
  if (!b) return;
  const alive = (b.content ?? []).filter((id) => getBlock(id)?.alive);
  run('tabBlockActions.deleteTab', (tx) => {
    if (alive.length <= 1) {
      // deleting the last tab deletes the tabs block
      tx.update('block', blockId, [], { alive: false });
      tx.listRemove('block', b.parent_id, ['content'], blockId);
      return;
    }
    tx.update('block', tabId, [], { alive: false });
    tx.listRemove('block', blockId, ['content'], tabId);
  });
}

function TabPill({ tab, index, selected, readOnly, onSelect, blockId }: { tab: BlockRecord; index: number; selected: boolean; readOnly: boolean; onSelect: () => void; blockId: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const icon = tab.format?.page_icon as string | undefined;
  const startRename = () => {
    setV(toPlainText(tab.properties?.title as RichText | undefined) || `Tab ${index + 1}`);
    setEditing(true);
  };
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === tab.id) startRename(); };
    window.addEventListener('nc:tab-rename', on);
    return () => window.removeEventListener('nc:tab-rename', on);
  });
  const commit = () => {
    setEditing(false);
    const cur = toPlainText(tab.properties?.title as RichText | undefined);
    if (v !== cur && !(v === `Tab ${index + 1}` && !cur)) run('tabBlockActions.renameTab', (tx) => setTitle(tx, tab.id, v ? [[v]] : []));
  };
  return (
    <div className="nc-tab-pill-wrap" role="presentation">
      <div
        ref={ref}
        role="tab"
        tabIndex={0}
        aria-selected={selected}
        aria-haspopup="dialog"
        className={`nc-tab-pill ${selected ? 'selected' : ''}`}
        onMouseDown={(e) => { if (!editing) e.preventDefault(); }}
        onClick={() => {
          if (editing) return;
          if (selected && !readOnly && ref.current) {
            openMenu(ref.current, {
              width: 220,
              sections: [{
                items: [
                  { label: 'Rename', icon: 'pencilLine', onSelect: () => { setTimeout(startRename, 0); } },
                  { label: 'Edit icon', icon: 'iconEdit', onSelect: () => { setTimeout(() => ref.current && openIconPicker(ref.current, { current: icon, onPick: (val) => run('tabBlockActions.setIcon', (tx) => setFormat(tx, tab.id, { page_icon: val ?? undefined })) }), 0); } },
                  { label: 'Copy link', icon: 'link', onSelect: () => copyPageLink(pageIdOfBlock(blockId) ?? blockId, tab.id) },
                  { label: 'Delete', icon: 'trash', onSelect: () => deleteTab(blockId, tab.id) },
                ],
              }],
            });
          } else onSelect();
        }}
        onDoubleClick={() => !readOnly && startRename()}
      >
        {icon && <PageIcon icon={icon} size={16} fallback={null} />}
        {editing ? (
          <input
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); commit(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: Math.max(40, v.length * 8 + 8) }}
          />
        ) : (
          <span className="t">{tabLabel(tab, index)}</span>
        )}
      </div>
    </div>
  );
}

function TabsBlock({ block, depth, readOnly }: BlockProps) {
  const kids = useRecords<BlockRecord>('block', block.content);
  const tabs = kids.filter((t): t is BlockRecord => !!t && t.alive);
  const [sel, setSel] = useState<string | null>(() => readSelected(block.id));
  const current = tabs.find((t) => t.id === sel) ?? tabs[0];
  const select = (id: string) => {
    setSel(id);
    writeSelected(block.id, id);
  };
  // focus moving into another tab's content (e.g. search result / undo) switches tabs
  const focused = useEditor((s) => s.focused?.blockId);
  useEffect(() => {
    if (!focused) return;
    let cur = getBlock(focused);
    for (let i = 0; i < 30 && cur && cur.parent_table === 'block'; i++) {
      if (cur.parent_id === block.id) {
        if (cur.id !== current?.id) select(cur.id);
        return;
      }
      cur = getBlock(cur.parent_id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);
  return (
    <div className="nc-bpad">
      <div className="nc-tabs-card">
        <div className="nc-tabs-strip">
          <div role="tablist" aria-label="Tab block" aria-orientation="horizontal" style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tabs.map((t, i) => (
              <TabPill key={t.id} tab={t} index={i} blockId={block.id} selected={t.id === current?.id} readOnly={readOnly} onSelect={() => select(t.id)} />
            ))}
          </div>
          {!readOnly && (
            <div role="button" aria-label="Add tab" className="nc-tab-add" data-tooltip="Add tab" onMouseDown={(e) => e.preventDefault()} onClick={() => { const id = addTab(block.id); select(id); }}>
              <Icon name="plus" size={16} />
            </div>
          )}
        </div>
        {current && (
          <div role="tabpanel" aria-label={tabLabel(current, tabs.indexOf(current))} className="nc-tab-panel">
            {current.content?.length ? (
              <BlockList parentId={current.id} ids={current.content} depth={depth + 1} readOnly={readOnly} />
            ) : (
              <div
                role="button"
                className="nc-tab-empty"
                onMouseDown={(e) => {
                  if (readOnly) return;
                  e.preventDefault();
                  let id = '';
                  run('tab.addContent', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: current.id, parentTable: 'block' }); });
                  useEditor.getState().requestFocus(id, 0);
                }}
              >
                Empty tab. Click or drop blocks inside.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

registerBlock(['tab', 'tabs'], TabsBlock);
registerBlockMenu(['tab', 'tabs'], () => []);
overrideSlashItem('tabs', createTabs);

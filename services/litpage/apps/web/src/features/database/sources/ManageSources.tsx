import { HELP_URL } from '@nc/shared/brand.ts';
// View settings › Manage datasets:
// Source — the data sources this database owns: name · "N views" · ••• (Move to, Copy dataset ID, Delete)
// + Create dataset (New blank dataset, Import CSV, Suggested templates, Link an existing dataset)
// Linked — other databases' sources shown here: name · "N views" · delete the linked views
// + Link an existing dataset
// Explore datasets
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, ViewType } from '@nc/shared/records.ts';
import { compactId } from '@nc/shared/ids.ts';
import { useBlock, useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { api } from '../../../lib/api.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { VSHeader as Header, VSRow as Row, VSSection as Section } from '../chrome/ViewSettings.tsx';
import { openLinkedSourcePicker } from '../chrome/LinkedSourcePicker.tsx';
import { templateSchema, type Template } from '../chrome/NewDatabasePanel.tsx';
import { addDataSource, addLinkedView, blockSources, moveDataSource, removeLinkedSource, sourceName, trashDataSource } from './sources.ts';
import { choiceDialog, openDatabasePicker } from './DatabasePicker.tsx';
import '../dbv.css';

const nViews = (n: number) => (n === 1 ? '1 view' : `${n} views`);

function selectView(block: BlockRecord, viewId: string) {
  window.dispatchEvent(new CustomEvent('nc:select-view', { detail: { blockId: block.id, viewId } }));
}

/** “Create dataset” menu and panel content. */
export function openAddDataSource(anchor: HTMLElement, block: BlockRecord, onDone?: () => void) {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.csv,text/csv';
  const created = (res: { viewId: string } | null) => {
    if (res) selectView(block, res.viewId);
    onDone?.();
  };
  return openOverlay((close) => <AddSourceMenu block={block} close={close} onCreated={created} fileInput={fileInput} />, { anchor, placement: 'bottom-start', offset: 4 });
}

function AddSourceMenu({ block, close, onCreated, fileInput }: { block: BlockRecord; close: () => void; onCreated: (r: { viewId: string } | null) => void; fileInput: HTMLInputElement }) {
  const [q, setQ] = useState('');
  const templates = ([
    { id: 'tasks', label: 'Tasks Tracker', icon: 'checkmarkSquare', tile: 'green' },
    { id: 'projects', label: 'Projects', icon: 'refresh', tile: 'blue' },
    { id: 'skills', label: 'Skills', icon: 'magicWand', tile: 'gray' },
  ] as const).filter((t) => !q || t.label.toLowerCase().includes(q.toLowerCase()));
  const fromTemplate = (t: Template) => {
    const tpl = templateSchema(t);
    close();
    onCreated(addDataSource(block, { name: tpl.name, schema: tpl.schema, views: tpl.views.map((v) => ({ type: v.type as ViewType, name: v.name, groupBy: v.groupBy })) }));
  };
  const importCsv = () => {
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      const res = addDataSource(block, { name: f.name.replace(/\.csv$/i, '') });
      if (!res) return;
      try {
        // the new source must reach the server before the rows go in
        await new Promise((r) => setTimeout(r, 200));
        const out = await api<{ rows: number }>('importCsvToCollection', { collectionId: res.collectionId, csv: await f.text() });
        useUI.getState().toast(`Imported ${out.rows} rows`);
      } catch (err) {
        useUI.getState().toast(err instanceof Error ? err.message : 'Import failed');
      }
      onCreated(res);
    };
    close();
    fileInput.click();
  };
  return (
    <PopoverSurface width={300} className="nc-add-source-menu" maxHeight="min(520px, 70vh)">
      <div className="nc-vs-header">
        <span className="nc-vs-title">Create a dataset</span>
        <span role="button" className="nc-panel-close" aria-label="Close" onClick={close}><Icon name="xMarkSmall" size={14} /></span>
      </div>
      <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-menu-scroll">
        <div className="nc-menu-section">
          <div role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => { close(); onCreated(addDataSource(block, { name: q.trim() || undefined })); }}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-tile"><Icon name="plusSmall" size={16} /></span><div className="nc-menu-label">{q.trim() ? `New “${q.trim()}” dataset` : 'New blank dataset'}</div></div>
          </div>
          {!q && (
            <div role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={importCsv}>
              <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="download" size={20} /></span><div className="nc-menu-label">Import CSV</div></div>
            </div>
          )}
        </div>
        {templates.length > 0 && (
          <div className="nc-menu-section no-divider">
            <div className="nc-menu-section-title">Suggested</div>
            {templates.map((t) => (
              <div key={t.id} role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => fromTemplate(t.id)}>
                <div className="nc-menu-item-inner"><span className={`nc-new-db-tile tile-${t.tile}`}><Icon name={t.icon} size={16} /></span><div className="nc-menu-label">{t.label}</div></div>
              </div>
            ))}
          </div>
        )}
        <div className="nc-menu-section with-divider">
          <div role="menuitem" className="nc-menu-item nc-new-db-row" onClick={(e) => {
            const anchor = e.currentTarget.closest('.nc-add-source-menu') as HTMLElement | null;
            close();
            linkExisting(anchor ?? document.body, block, (id) => onCreated({ viewId: id }));
          }}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="arrowDiagonalUpRight" size={16} /></span><div className="nc-menu-label">Link an existing dataset</div></div>
          </div>
        </div>
      </div>
    </PopoverSurface>
  );
}

/** Link another database's source into this block (source → "New view" step). */
export function linkExisting(anchor: HTMLElement, block: BlockRecord, onDone?: (viewId: string) => void) {
  const { owned, linked } = blockSources(block);
  openLinkedSourcePicker(anchor, {
    exclude: [...owned, ...linked].map((c) => c.id),
    onPick: (target, choice) => {
      const live = records.get<BlockRecord>('block', block.id) ?? block;
      const id = addLinkedView(live, target, { type: choice.type, copyViewId: choice.copyViewId });
      if (id) {
        selectView(live, id);
        onDone?.(id);
      }
    },
  });
}

function sourceMenu(anchor: HTMLElement, block: BlockRecord, c: CollectionRecord, viewCount: number, canDelete: boolean) {
  const name = sourceName(c) || 'Untitled';
  openMenu(anchor, {
    width: 240,
    sections: [
      { items: [
        { id: 'move', label: 'Move to', icon: 'arrowTurnUpRight', onSelect: () => {
          setTimeout(() => openDatabasePicker(anchor, { exclude: [block.id], title: 'Send dataset to…', onPick: async (to) => {
            const how = viewCount > 0 ? await choiceDialog({
              message: `Sending dataset ${name}`,
              description: viewCount === 1 ? 'This database has 1 view based on this data source.' : `This database has ${viewCount} views based on this data source.`,
              choices: [
                { key: 'views', label: viewCount === 1 ? 'Move data source and 1 view' : `Move data source and ${viewCount} views`, primary: true },
                { key: 'only', label: 'Send dataset only' },
              ],
            }) : 'views';
            if (!how) return;
            const live = records.get<BlockRecord>('block', block.id) ?? block;
            moveDataSource(live, c.id, to, how === 'views');
          } }), 0);
        } },
        { id: 'copy', label: 'Copy dataset ID', icon: 'copy', onSelect: () => { void navigator.clipboard?.writeText(compactId(c.id)); useUI.getState().toast(`${name} ID copied`); } },
      ] },
      ...(canDelete ? [{ items: [
        { id: 'delete', label: 'Delete', icon: 'trash', danger: true, onSelect: async () => {
          await new Promise((r) => setTimeout(r, 0)); // after the menu closed (it closes overlays opened above it)
          const ok = await confirmDialog({
            message: `Send ${name} to trash?`,
            description: `This will move the data source and ${nViews(viewCount)} to Trash`,
            confirmLabel: 'Send dataset to trash',
          });
          if (ok) trashDataSource(records.get<BlockRecord>('block', block.id) ?? block, c.id);
        } },
      ] }] : []),
    ],
  }, { placement: 'bottom-end' });
}

/** The Manage datasets page of the view settings panel. */
export function ManageDataSourcesPage({ block: blockIn, readOnly, onBack, close }: { block: BlockRecord; readOnly: boolean; onBack: () => void; close: () => void }) {
  useTableVersion(['collection', 'collection_view']);
  const block = useBlock(blockIn.id) ?? blockIn;
  const { owned, linked, views } = blockSources(block);
  const total = owned.length + linked.length;
  const openFirst = (c: CollectionRecord) => {
    const v = views.get(c.id)?.[0];
    if (v) selectView(block, v.id);
  };
  const rowFor = (c: CollectionRecord, kind: 'owned' | 'linked') => {
    const n = views.get(c.id)?.length ?? 0;
    return (
      <div key={c.id} role="menuitem" className="nc-menu-item nc-vs-row nc-source-row" data-testid="data-source-row" onClick={() => openFirst(c)}>
        <div className="nc-menu-item-inner">
          <div className="nc-menu-icon"><Icon name="collection" size={20} /></div>
          <div className="nc-menu-label nc-ellipsis">{sourceName(c) || 'Untitled'}</div>
          <span className="nc-menu-value">{nViews(n)}</span>
          {!readOnly && kind === 'owned' && (
            <span role="button" className="nc-source-more" aria-label="Dataset actions" onClick={(e) => { e.stopPropagation(); sourceMenu(e.currentTarget, block, c, n, total > 1); }}>
              <Icon name="ellipsisSmall" size={16} />
            </span>
          )}
          {!readOnly && kind === 'linked' && total > 1 && (
            <span role="button" className="nc-source-more" aria-label="Remove linked layouts" data-tooltip={n === 1 ? 'Delete linked view' : `Delete ${n} linked views`} onClick={(e) => { e.stopPropagation(); removeLinkedSource(block, c.id); }}>
              <Icon name="trash" size={16} />
            </span>
          )}
        </div>
      </div>
    );
  };
  return (
    <>
      <Header title="Manage datasets" onBack={onBack} close={close} />
      <Section title="Source">
        {owned.map((c) => rowFor(c, 'owned'))}
        {!readOnly && <Row icon="plus" label="Create dataset" chevron={false} onClick={(e) => openAddDataSource(e.currentTarget, block)} />}
      </Section>
      <Section divider title="Linked">
        {linked.map((c) => rowFor(c, 'linked'))}
        {!readOnly && <Row icon="plus" label="Link an existing dataset" chevron={false} onClick={(e) => linkExisting(e.currentTarget, block)} />}
      </Section>
      <Section divider>
        {HELP_URL && <Row icon="questionMarkCircle" label="Explore datasets" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
      </Section>
    </>
  );
}

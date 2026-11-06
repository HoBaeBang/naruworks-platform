// "New database" setup panel for a fresh full-page database (05-database-.3, /):
// AI box (disabled), New blank dataset, Import CSV, Suggested templates (Tasks Tracker, Projects, Skills),
// More templates, Link an existing dataset (search + list).
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { newId } from '@nc/shared/ids.ts';
import { defaultStatusSchema } from '@nc/shared/database/index.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { run } from '../../../lib/blocks.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useUI } from '../../../lib/store/ui.ts';
import { createViewIn, newPropertyId } from '../actions.ts';
import { openDatabaseTemplates } from '../../templates/dbTemplates.tsx';
import { ViewStep } from './LinkedSourcePicker.tsx';
import { addLinkedView } from '../sources/sources.ts';

/** The block's own, still empty data source (replaced when the database links an existing one). */
function own(c: CollectionRecord, b: BlockRecord): boolean {
  return c.parent_id === b.id && !Object.keys(c.schema).some((k) => k !== 'title');
}

export type Template = 'tasks' | 'projects' | 'skills';

function option(value: string, color: string) {
  return { id: newId(), value, color };
}

/** Schema + views of the suggested templates (names follow starter templates). */
export function templateSchema(t: Template): { name: string; schema: Record<string, PropertySchema>; views: { type: 'table' | 'board' | 'list'; name: string; groupBy?: string }[] } {
  const st = defaultStatusSchema();
  if (t === 'tasks') {
    const ids = { status: newPropertyId(), assignee: newPropertyId(), due: newPropertyId(), priority: newPropertyId(), type: newPropertyId(), desc: newPropertyId(), effort: newPropertyId() };
    return {
      name: 'Tasks Tracker',
      schema: {
        title: { name: 'Task name', type: 'title' },
        [ids.status]: { name: 'Status', type: 'status', options: st.options, groups: st.groups, defaultOption: st.defaultOption },
        [ids.assignee]: { name: 'Assignee', type: 'person' },
        [ids.due]: { name: 'Due date', type: 'date' },
        [ids.priority]: { name: 'Priority', type: 'select', options: [option('Low', 'green'), option('Medium', 'yellow'), option('High', 'red')] },
        [ids.type]: { name: 'Task type', type: 'multi_select', options: [option('🐞 Bug', 'red'), option('💬 Feature request', 'blue'), option('💅 Polish', 'purple')] },
        [ids.effort]: { name: 'Effort level', type: 'select', options: [option('Small', 'green'), option('Medium', 'yellow'), option('Large', 'red')] },
        [ids.desc]: { name: 'Description', type: 'text' },
      },
      views: [{ type: 'table', name: 'All tasks' }, { type: 'board', name: 'By status', groupBy: ids.status }],
    };
  }
  if (t === 'projects') {
    const ids = { status: newPropertyId(), owner: newPropertyId(), dates: newPropertyId(), priority: newPropertyId(), summary: newPropertyId() };
    const pst = defaultStatusSchema();
    pst.options[0].value = 'Planning';
    pst.defaultOption = 'Planning';
    return {
      name: 'Projects',
      schema: {
        title: { name: 'Project name', type: 'title' },
        [ids.status]: { name: 'Status', type: 'status', options: pst.options, groups: pst.groups, defaultOption: pst.defaultOption },
        [ids.owner]: { name: 'Owner', type: 'person' },
        [ids.dates]: { name: 'Dates', type: 'date' },
        [ids.priority]: { name: 'Priority', type: 'select', options: [option('Low', 'green'), option('Medium', 'yellow'), option('High', 'red')] },
        [ids.summary]: { name: 'Summary', type: 'text' },
      },
      views: [{ type: 'table', name: 'All projects' }, { type: 'board', name: 'By status', groupBy: ids.status }],
    };
  }
  const ids = { desc: newPropertyId(), cat: newPropertyId() };
  return {
    name: 'Skills',
    schema: {
      title: { name: 'Name', type: 'title' },
      [ids.desc]: { name: 'Description', type: 'text' },
      [ids.cat]: { name: 'Category', type: 'select', options: [option('Writing', 'blue'), option('Research', 'purple'), option('Planning', 'orange')] },
    },
    views: [{ type: 'list', name: 'All skills' }],
  };
}

function applyTemplate(block: BlockRecord, collection: CollectionRecord, t: Template) {
  const tpl = templateSchema(t);
  run('applyDatabaseTemplate', (tx) => {
    tx.set('collection', collection.id, ['schema'], tpl.schema);
    tx.set('collection', collection.id, ['name'], [[tpl.name]]);
    // the Skills template makes a skills database: every page is a skill
    if (t === 'skills') {
      tx.set('collection', collection.id, ['format', 'ai_skills_db'], true);
      const desc = Object.entries(tpl.schema).find(([, p]) => (p as { name?: string }).name === 'Description')?.[0];
      if (desc) tx.set('collection', collection.id, ['format', 'ai_skills_description'], desc);
    }
    for (const vid of block.view_ids ?? []) {
      tx.listRemove('block', block.id, ['view_ids'], vid);
      tx.update('collection_view', vid, [], { alive: false });
    }
    for (const v of tpl.views) {
      const id = createViewIn(tx, block.id, v.type, collection.id, { name: v.name });
      tx.listAfter('block', block.id, ['view_ids'], id);
    }
  });
}

export function NewDatabasePanel({ block, collection, view, onClose }: { block: BlockRecord; collection: CollectionRecord; view: CollectionViewRecord; onClose: () => void }) {
  const [page, setPage] = useState<'main' | 'link'>('main');
  const fileRef = useRef<HTMLInputElement>(null);
  void view;
  if (page === 'link') return <LinkExisting block={block} collection={collection} onBack={() => setPage('main')} onClose={onClose} />;
  return (
    <div className="nc-new-db-panel lit-view-settings-sidebar" role="dialog" aria-label="New database">
      <div className="nc-vs-header">
        <span className="nc-vs-title">New database</span>
        <span role="button" className="nc-panel-close" aria-label="Close" data-testid="collection-settings-menu-close-button" onClick={onClose}><Icon name="xMarkSmall" size={14} /></span>
      </div>
      <div className="lit-scroller vertical nc-new-db-scroll">
        <div className="nc-new-db-ai">
          {/* Build with AI: AI designs this database. */}
          <form
            className="nc-new-db-ai-box"
            onSubmit={(e) => {
              e.preventDefault();
              const prompt = String(new FormData(e.currentTarget).get('prompt') ?? '').trim();
              if (!prompt) return;
              window.dispatchEvent(new CustomEvent('nc:ai-build-database', { detail: { blockId: block.id, collectionId: collection.id, prompt } }));
              onClose();
            }}
          >
            <span className="nc-new-db-ai-avatar"><Icon name="aiFace" size={14} /></span>
            <input name="prompt" className="nc-new-db-ai-text" placeholder="Describe what to build" aria-label="Describe what to build" autoComplete="off" style={{ border: 'none', outline: 'none', background: 'transparent', font: 'inherit', color: 'inherit', flex: 1, minWidth: 0 }} />
            <button type="submit" className="nc-new-db-ai-submit" aria-label="Send prompt to Litpage AI" style={{ border: 'none', cursor: 'pointer' }}><Icon name="arrowUp" size={14} /></button>
          </form>
        </div>
        <div className="nc-menu-section">
          <div role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => { onClose(); setTimeout(() => document.querySelector<HTMLElement>('.nc-db-page-title')?.focus(), 30); }}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-tile"><Icon name="plusSmall" size={16} /></span><div className="nc-menu-label">New blank dataset</div></div>
          </div>
          {/*: Import CSV goes through the column mapping of Merge with CSV (features/import, /006) */}
          <div role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => { onClose(); void import('../../import/MergeCsv.tsx').then((m) => m.openMergeCsv(block.id)); }}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="download" size={20} /></span><div className="nc-menu-label">Import CSV</div></div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            const csv = await f.text();
            try {
              const res = await api<{ rows: number }>('importCsvToCollection', { collectionId: collection.id, csv });
              useUI.getState().toast(`Imported ${res.rows} rows`);
              onClose();
            } catch (err) {
              useUI.getState().toast(err instanceof Error ? err.message : 'Import failed');
            }
          }} />
        </div>
        <div className="nc-menu-section no-divider">
          <div className="nc-menu-section-title">Suggested</div>
          {([
            { id: 'tasks', label: 'Tasks Tracker', icon: 'checkmarkSquare', tile: 'green' },
            { id: 'projects', label: 'Projects', icon: 'refresh', tile: 'blue' },
            { id: 'skills', label: 'Skills', icon: 'magicWand', tile: 'gray' },
          ] as const).map((t) => (
            <div key={t.id} role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => { applyTemplate(block, collection, t.id); onClose(); }}>
              <div className="nc-menu-item-inner"><span className={`nc-new-db-tile tile-${t.tile}`}><Icon name={t.icon} size={16} /></span><div className="nc-menu-label">{t.label}</div></div>
            </div>
          ))}
          {/*: gallery templates with a database */}
          <div role="menuitem" className="nc-menu-item nc-new-db-row" data-testid="new-db-more-templates" onClick={(e) => void openDatabaseTemplates(e.currentTarget, block.id, onClose)}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="ellipsis" size={20} /></span><div className="nc-menu-label">More templates</div></div>
          </div>
        </div>
        <div className="nc-menu-section with-divider">
          <div role="menuitem" className="nc-menu-item nc-new-db-row" onClick={() => setPage('link')}>
            <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="arrowDiagonalUpRight" size={16} /></span><div className="nc-menu-label">Link an existing dataset</div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Point this database block at an existing data source (becomes a linked view). */
export function linkToDataSource(block: BlockRecord, own: CollectionRecord | undefined, target: CollectionRecord) {
  run('linkExistingDataSource', (tx) => {
    tx.update('block', block.id, [], { collection_id: target.id });
    tx.update('block', block.id, ['format'], { collection_pointer: { id: target.id, table: 'collection', spaceId: target.space_id } });
    for (const vid of block.view_ids ?? []) {
      const v = records.get<CollectionViewRecord>('collection_view', vid);
      if (!v) continue;
      const ids = ['title', ...Object.keys(target.schema).filter((k) => k !== 'title')];
      tx.update('collection_view', vid, ['format'], { collection_pointer: { id: target.id, table: 'collection', spaceId: target.space_id }, table_properties: ids.map((p) => ({ property: p, visible: true, width: p === 'title' ? 280 : 200 })) });
    }
    if (own && own.id !== target.id && own.parent_id === block.id && !Object.keys(own.schema).some((k) => k !== 'title')) tx.update('collection', own.id, [], { alive: false });
  });
}

function LinkExisting({ block, collection, onBack, onClose }: { block: BlockRecord; collection: CollectionRecord; onBack: () => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  // step 2: "New view" — a new table view, or a copy of one of the source's views
  const [picked, setPicked] = useState<CollectionRecord | null>(null);
  const [results, setResults] = useState<{ collectionId: string; blockId: string; name: string }[]>([]);
  const [limit, setLimit] = useState(4);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await api<{ results: { collectionId: string; blockId: string; name: string }[]; recordMap: any }>('searchDataSources', { spaceId: useSession.getState().spaceId, query: q, limit: 100 });
        records.mergeRecordMap(res.recordMap);
        setResults(res.results.filter((r) => r.collectionId !== collection.id));
      } catch (e) {
        console.error(e);
      }
    }, 120);
    return () => clearTimeout(t);
  }, [q, collection.id]);
  if (picked) {
    return (
      <div className="nc-new-db-panel lit-view-settings-sidebar" role="dialog" aria-label="New view">
        <ViewStep source={picked} onBack={() => setPicked(null)} close={onClose} onChoose={(choice) => {
          if (choice.copyViewId) {
            const views = block.view_ids ?? [];
            if (own(collection, block)) run('linkExistingDataSource', (tx) => tx.update('collection', collection.id, [], { alive: false }));
            addLinkedView(block, picked, { copyViewId: choice.copyViewId, replaceViewIds: views });
          } else linkToDataSource(block, collection, picked);
          onClose();
        }} />
      </div>
    );
  }
  return (
    <div className="nc-new-db-panel lit-view-settings-sidebar" role="dialog" aria-label="Link an existing dataset">
      <div className="nc-vs-header link">
        <span role="button" className="nc-vs-back" aria-label="Back" onClick={onBack}><Icon name="arrowStraightLeftSmall" size={16} /></span>
        <span className="nc-vs-title">Link an existing dataset</span>
        <span role="button" className="nc-panel-close" aria-label="Close" onClick={onClose}><Icon name="xMarkSmall" size={14} /></span>
      </div>
      <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Link…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-new-db-scroll">
        <div className="nc-menu-section">
          <div className="nc-menu-section-title">Available datasets</div>
          {results.slice(0, q ? 100 : limit).map((r) => {
            const host = records.get<BlockRecord>('block', r.blockId);
            const target = records.get<CollectionRecord>('collection', r.collectionId);
            return (
              <div key={r.collectionId} role="menuitem" className="nc-menu-item nc-link-source-row" onClick={() => { if (target) setPicked(target); }}>
                <div className="nc-menu-item-inner">
                  <span className="nc-link-source-icon"><Icon name="collection" size={20} /></span>
                  <div className="nc-menu-label">
                    <div className="nc-ellipsis">{r.name}</div>
                    <div className="nc-link-source-path">{host ? toPlainText(records.get<BlockRecord>('block', host.parent_id)?.properties?.title) || '' : ''}</div>
                  </div>
                </div>
              </div>
            );
          })}
          {!q && results.length > limit && (
            <div role="menuitem" className="nc-menu-item nc-new-db-row muted" onClick={() => setLimit(100)}>
              <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="ellipsis" size={20} /></span><div className="nc-menu-label">Show {results.length - limit} more</div></div>
            </div>
          )}
          {!results.length && <div className="nc-menu-empty">No data sources</div>}
        </div>
      </div>
    </div>
  );
}

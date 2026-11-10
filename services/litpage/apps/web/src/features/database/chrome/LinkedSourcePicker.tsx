// “Linked view of data source” picker:
// step 1 — search the workspace's data sources ("Choose a dataset…", or "Create or link a dataset…" when a new
// source may be created: "New blank dataset" on top, `New “<query>” data source` below the matches)
// step 2 — "New view": "Find a layout…", "+ New table view", "Views on <source>" (copies that view: layout,
// filters, sorts, groups, properties), "Show N more" 
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, ViewType } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { viewTypeMeta } from '@nc/shared/database/index.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { viewsOfSource } from '../sources/sources.ts';

interface Result {
  collectionId: string;
  blockId: string;
  name: string;
}

export interface ViewChoice {
  /** copy this view of the source; otherwise a new view of `type` */
  copyViewId?: string;
  type: ViewType;
}

export interface LinkedPickerOptions {
  onPick: (c: CollectionRecord, choice: ViewChoice) => void;
  /** offer "New blank dataset" / `New “<query>” data source` (an owned source instead of a link) */
  onCreate?: (name: string) => void;
  /** skip the "New view" step (a new table view) */
  skipViewStep?: boolean;
  /** data sources not to list (the database's own) */
  exclude?: string[];
  /** label of the "create" row (default "New blank dataset"; /chart says "New chart") */
  createLabel?: string;
}

/** Search the workspace's data sources (server searchDataSources merges the records it returns). */
export function useDataSourceSearch(q: string, exclude: string[] = []): Result[] {
  const [results, setResults] = useState<Result[]>([]);
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const res = await api<{ results: Result[]; recordMap: any }>('searchDataSources', { spaceId: useSession.getState().spaceId, query: q, limit: 100 });
        records.mergeRecordMap(res.recordMap);
        setResults(res.results.filter((r) => !exclude.includes(r.collectionId)));
      } catch (e) {
        console.error(e);
      }
    }, 100);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, exclude.join(',')]);
  return results;
}

function SourceRow({ r, active, onHover, onClick }: { r: Result; active: boolean; onHover: () => void; onClick: () => void }) {
  const host = records.get<BlockRecord>('block', r.blockId);
  const parent = host ? records.get<BlockRecord>('block', host.parent_id) : undefined;
  return (
    <div role="option" aria-selected={active} className={`nc-menu-item nc-link-source-row ${active ? 'active' : ''}`} onMouseMove={onHover} onClick={onClick}>
      <div className="nc-menu-item-inner">
        <span className="nc-link-source-icon">{host?.format?.page_icon ? <PageIcon block={host} size={20} /> : <Icon name="collection" size={20} />}</span>
        <div className="nc-menu-label">
          <div className="nc-ellipsis">{r.name}</div>
          {parent && <div className="nc-link-source-path">{toPlainText(parent.properties?.title) || 'Untitled'}</div>}
        </div>
      </div>
    </div>
  );
}

/** Step 2: "New view" — a new table view, or a copy of one of the source's views. */
export function ViewStep({ source, onChoose, onBack, close }: { source: CollectionRecord; onChoose: (c: ViewChoice) => void; onBack?: () => void; close?: () => void }) {
  const [q, setQ] = useState('');
  const [more, setMore] = useState(false);
  const all = useMemo(() => viewsOfSource(source), [source]);
  const list = all.filter((v) => !q || (v.name || viewTypeMeta(v.type).label).toLowerCase().includes(q.toLowerCase()));
  const shown = q || more ? list : list.slice(0, 7);
  const name = toPlainText(source.name as never) || 'Untitled';
  return (
    <>
      <div className="nc-vs-header link">
        {onBack && <span role="button" className="nc-vs-back" aria-label="Back" onClick={onBack}><Icon name="arrowStraightLeftSmall" size={16} /></span>}
        <span className="nc-vs-title">New view</span>
        {close && <span role="button" className="nc-panel-close" aria-label="Close" onClick={close}><Icon name="xMarkSmall" size={14} /></span>}
      </div>
      <div className="nc-vs-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Find a layout…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      <div className="lit-scroller vertical nc-menu-scroll">
        {!q && (
          <div className="nc-menu-section">
            <div role="menuitem" className="nc-menu-item nc-link-new-view" onClick={() => onChoose({ type: 'table' })}>
              <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="plus" size={20} /></div><div className="nc-menu-label">New table view</div></div>
            </div>
          </div>
        )}
        {list.length > 0 && (
          <div className="nc-menu-section">
            <div className="nc-menu-section-title">Views on {name}</div>
            {shown.map((v) => (
              <div key={v.id} role="menuitem" className="nc-menu-item nc-link-source-view" onClick={() => onChoose({ copyViewId: v.id, type: v.type as ViewType })}>
                <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name={viewTypeMeta(v.type).icon} size={20} /></div><div className="nc-menu-label nc-ellipsis">{v.name || viewTypeMeta(v.type).label}</div></div>
              </div>
            ))}
            {!q && !more && list.length > 7 && (
              <div role="menuitem" className="nc-menu-item nc-new-db-row muted" onClick={() => setMore(true)}>
                <div className="nc-menu-item-inner"><div className="nc-menu-icon"><Icon name="ellipsis" size={20} /></div><div className="nc-menu-label">Show {list.length - 7} more</div></div>
              </div>
            )}
          </div>
        )}
        {q && !list.length && <div className="nc-menu-empty">No results</div>}
      </div>
    </>
  );
}

function Picker({ opts, close }: { opts: LinkedPickerOptions; close: () => void }) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [source, setSource] = useState<CollectionRecord | null>(null);
  const [showAll, setShowAll] = useState(false);
  const results = useDataSourceSearch(q, opts.exclude);
  useEffect(() => setActive(0), [q]);
  const shown = q || showAll ? results : results.slice(0, 4);
  const choose = (r: Result) => {
    const c = records.get<CollectionRecord>('collection', r.collectionId);
    if (!c) return;
    if (opts.skipViewStep) {
      opts.onPick(c, { type: 'table' });
      close();
    } else setSource(c);
  };
  if (source) {
    return (
      <PopoverSurface width={340} className="nc-linked-picker" maxHeight="min(448px, 60vh)">
        <ViewStep source={source} onBack={() => setSource(null)} onChoose={(choice) => { opts.onPick(source, choice); close(); }} />
      </PopoverSurface>
    );
  }
  const create = (name: string) => {
    opts.onCreate?.(name);
    close();
  };
  return (
    <PopoverSurface width={340} className="nc-linked-picker" maxHeight="min(448px, 60vh)">
      <div className="nc-vs-search" data-menu-keys="ignore">
        <div className="nc-input focused">
          <input
            autoFocus
            placeholder={opts.onCreate ? 'Create or link a dataset…' : 'Choose a dataset…'}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              if (e.key === 'Enter' && shown[active]) { e.preventDefault(); choose(shown[active]); }
            }}
          />
        </div>
      </div>
      <div className="lit-scroller vertical nc-menu-scroll">
        {opts.onCreate && !q && (
          <div className="nc-menu-section">
            <div role="menuitem" className="nc-menu-item nc-new-db-row tall" onClick={() => create('')}>
              <div className="nc-menu-item-inner"><span className="nc-new-db-tile"><Icon name="plusSmall" size={16} /></span><div className="nc-menu-label">{opts.createLabel ?? 'New blank dataset'}</div></div>
            </div>
          </div>
        )}
        <div className="nc-menu-section">
          <div className="nc-menu-section-title">Available datasets</div>
          {shown.map((r, i) => <SourceRow key={r.collectionId} r={r} active={i === active} onHover={() => setActive(i)} onClick={() => choose(r)} />)}
          {!q && !showAll && results.length > 4 && (
            <div role="menuitem" className="nc-menu-item nc-new-db-row muted" onClick={() => setShowAll(true)}>
              <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="ellipsis" size={20} /></span><div className="nc-menu-label">Show more</div></div>
            </div>
          )}
          {!results.length && <div className="nc-menu-empty">No datasets found</div>}
        </div>
        {opts.onCreate && q.trim() && (
          <div className="nc-menu-section with-divider">
            <div role="menuitem" className="nc-menu-item nc-new-db-row" onClick={() => create(q.trim())}>
              <div className="nc-menu-item-inner"><span className="nc-new-db-icon"><Icon name="plus" size={20} /></span><div className="nc-menu-label">New “{q.trim()}” data source</div></div>
            </div>
          </div>
        )}
      </div>
    </PopoverSurface>
  );
}

export function openLinkedSourcePicker(anchor: Anchor, opts: LinkedPickerOptions) {
  return openOverlay((close) => <Picker opts={opts} close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

/** "Views on <source>" step on its own (Manage data sources › Link existing data source / New database panel). */
export function openViewStep(anchor: Anchor, source: CollectionRecord, onChoose: (c: ViewChoice) => void) {
  return openOverlay((close) => (
    <PopoverSurface width={340} className="nc-linked-picker" maxHeight="min(448px, 60vh)">
      <ViewStep source={source} onChoose={(c) => { onChoose(c); close(); }} close={close} />
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 4 });
}

export type { CollectionViewRecord };

import { HELP_URL } from '@nc/shared/brand.ts';


// relation + Linked field name, Add relation) and the relation "Edit property" panel.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { openOverlay, type Anchor } from '../../../components/overlay.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useCollection, useTableVersion } from '../../../lib/hooks.ts';
import { run } from '../../../lib/blocks.ts';
import { collectionName, getCollection, titleOf } from './context.ts';
import { createRelationProperty, knownCollections, setRelationLimit, setRelationTarget, setRelationTwoWay } from './relations.ts';
import './advanced.css';

interface DataSourceItem {
  id: string;
  name: string;
  path: string;
}

function pathOf(c: CollectionRecord): string {
  const host = records.get<BlockRecord>('block', c.parent_id);
  if (!host) return '';
  // inline DB: the page that contains the DB block; full-page DB: its own parent
  let cur: BlockRecord | undefined = host.parent_table === 'block' ? records.get<BlockRecord>('block', host.parent_id) : undefined;
  const parts: string[] = [];
  for (let i = 0; i < 3 && cur; i++) {
    if (cur.type === 'page' || cur.type === 'collection_view_page') parts.unshift(titleOf(cur) || 'Untitled');
    cur = cur.parent_table === 'block' ? records.get<BlockRecord>('block', cur.parent_id) : undefined;
  }
  return parts.join(' / ');
}

function localDataSources(): DataSourceItem[] {
  return knownCollections().map((c) => ({ id: c.id, name: collectionName(c), path: pathOf(c) }));
}


function useDataSources(query: string): DataSourceItem[] {
  useTableVersion(['collection', 'block']);
  const [remote, setRemote] = useState<DataSourceItem[]>([]);
  useEffect(() => {
    let alive = true;
    const spaceId = useSession.getState().spaceId;
    const t = setTimeout(() => {
      api<{ results?: { collectionId?: string; id?: string; name: string }[]; recordMap?: unknown }>('searchDataSources', { spaceId, query, limit: 100 })
        .then((res) => {
          if (!alive) return;
          if (res.recordMap) records.mergeRecordMap(res.recordMap as never);
          // core endpoint returns {collectionId, blockId, name}; paths come from the merged records
          setRemote((res.results ?? []).map((r) => {
            const id = r.collectionId ?? r.id ?? '';
            const c = records.get<CollectionRecord>('collection', id);
            return { id, name: r.name || (c ? collectionName(c) : 'Untitled'), path: c ? pathOf(c) : '' };
          }).filter((r) => r.id));
        })
        .catch(() => undefined);
    }, query ? 150 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query]);
  return useMemo(() => {
    const map = new Map<string, DataSourceItem>();
    for (const d of [...remote, ...localDataSources()]) if (!map.has(d.id)) map.set(d.id, d);
    const q = query.trim().toLowerCase();
    return [...map.values()].filter((d) => !q || d.name.toLowerCase().includes(q) || d.path.toLowerCase().includes(q));
  }, [remote, query]);
}

function DataSourcePicker({ onPick, close, currentId }: { onPick: (id: string) => void; close: () => void; currentId?: string }) {
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const list = useDataSources(q);
  const shown = all || q ? list : list.slice(0, 5);
  return (
    <div className="nc-rel-panel" role="dialog" aria-label="Related to">
      <div className="nc-rel-head">
        <div className="nc-rel-title">Related to</div>
        <div role="button" className="nc-rel-x" aria-label="Close" onClick={close}><Icon name="xSmall" size={12} /></div>
      </div>
      <div className="nc-rel-input focused">
        <input autoFocus placeholder="Choose a dataset…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="nc-rel-section" style={{ maxHeight: 340, overflowY: 'auto' }}>
        <div className="nc-rel-section-title">Available datasets</div>
        {shown.map((d) => (
          <div key={d.id} role="menuitem" className={`nc-rel-ds ${d.id === currentId ? 'active' : ''}`} onClick={() => onPick(d.id)}>
            <Icon name="databaseEmbed" size={18} color="var(--lp-icon-secondary)" />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="name">{d.name}</div>
              {d.path && <div className="path">{d.path}</div>}
            </div>
            {d.id === currentId && <Icon name="check" size={14} />}
          </div>
        ))}
        {!all && !q && list.length > 5 && (
          <div role="menuitem" className="nc-rel-row" onClick={() => setAll(true)}>
            <Icon name="ellipsis" size={18} color="var(--lp-icon-secondary)" />
            <span className="label" style={{ color: 'var(--lp-text-secondary)' }}>Show {list.length - 5} more</span>
          </div>
        )}
        {list.length === 0 && <div className="nc-rel-sub">No results</div>}
      </div>
    </div>
  );
}

function LimitMenu(anchor: HTMLElement, value: number | undefined, onChange: (v: number | undefined) => void) {
  openMenu(anchor, {
    width: 250,
    sections: [{ items: [
      { label: '1 page', checked: value === 1, onSelect: () => onChange(1) },
      { label: 'No limit', checked: !value, onSelect: () => onChange(undefined) },
    ] }],
  }, { placement: 'right-start' });
}

function NewRelation({ collectionId, targetId, view, afterPropId, close, onCreated, onBack, initialName, propId }: {
  collectionId: string; targetId: string; view?: CollectionViewRecord; afterPropId?: string; close: () => void; onCreated?: (propId: string) => void; onBack: () => void; initialName?: string; propId?: string;
}) {
  const source = useCollection(collectionId);
  const target = useCollection(targetId);
  const [name, setName] = useState(initialName ?? (target ? collectionName(target) : ''));
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [twoWay, setTwoWay] = useState(false);
  const [reverseName, setReverseName] = useState('');
  const self = collectionId === targetId;
  const add = () => {
    const pid = createRelationProperty({ collectionId, name, targetCollectionId: targetId, limit, twoWay, reverseName: reverseName || (source ? collectionName(source) : ''), view: propId ? undefined : view, afterPropId, propId });
    close();
    if (pid) onCreated?.(pid);
  };
  return (
    <div className="nc-rel-panel" role="dialog" aria-label="New relation">
      <div className="nc-rel-head">
        <div className="nc-rel-title">New relation</div>
        <div role="button" className="nc-rel-x" aria-label="Close" onClick={close}><Icon name="xSmall" size={12} /></div>
      </div>
      <div className="nc-rel-input">
        <input autoFocus placeholder="Property name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
      </div>
      <div className="nc-rel-section">
        <div role="menuitem" className="nc-rel-row" onClick={onBack}>
          <Icon name="collectionArrow" size={18} color="var(--lp-icon-primary)" />
          <span className="label">Related to</span>
          <span className="value"><Icon name="databaseEmbed" size={14} color="var(--lp-icon-tertiary)" /><span className="v">{self ? 'This data source' : target ? collectionName(target) : ''}</span><Icon name="chevronRight" size={14} /></span>
        </div>
        <div role="menuitem" className="nc-rel-row" onClick={(e) => LimitMenu(e.currentTarget, limit, setLimit)}>
          <Icon name="numberProp" size={18} color="var(--lp-icon-primary)" />
          <span className="label">Limit</span>
          <span className="value"><span className="v">{limit === 1 ? '1 page' : 'No limit'}</span><Icon name="chevronRight" size={14} /></span>
        </div>
        <div role="menuitemcheckbox" aria-checked={twoWay} className="nc-rel-row" onClick={() => setTwoWay(!twoWay)}>
          <Icon name="fullWidth" size={18} color="var(--lp-icon-primary)" />
          <span className="label">Bidirectional link <span data-tooltip={self ? 'Creates a second property in this data source that shows the reverse relation.' : `Show this relation on ${target ? collectionName(target) : 'the related data source'}.`} style={{ color: 'var(--lp-icon-tertiary)', verticalAlign: 'middle', display: 'inline-flex' }}><Icon name="questionMark" size={14} /></span></span>
          <span className={`nc-adv-toggle ${twoWay ? 'on' : ''}`}><span /></span>
        </div>
      </div>
      {twoWay && (
        <>
          <div className="nc-rel-section-title" style={{ padding: '0 16px' }}>Linked field name</div>
          <div className="nc-rel-input" style={{ marginTop: 0 }}>
            <input placeholder={source ? collectionName(source) : 'Related'} value={reverseName} onChange={(e) => setReverseName(e.target.value)} />
          </div>
          <div className="nc-rel-preview" aria-label="Relation preview">
            <div className="nc-rel-preview-line"><Icon name="databaseEmbed" size={14} /><b>{source ? collectionName(source) : ''}</b><span>→</span><span>{name || 'Relation'}</span></div>
            <div className="nc-rel-preview-line"><Icon name="databaseEmbed" size={14} /><b>{target ? collectionName(target) : ''}</b><span>→</span><span>{reverseName || (source ? collectionName(source) : '')}</span></div>
          </div>
        </>
      )}
      <div role="button" className="nc-rel-button" onClick={add}>Add relation</div>
      <div className="nc-rel-foot">
        {HELP_URL && <a className="nc-rel-row" style={{ color: 'var(--lp-text-secondary)', textDecoration: 'none' }} href={HELP_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="questionMark" size={18} color="var(--lp-icon-secondary)" /><span className="label">Explore linked fields</span>
        </a>}
      </div>
    </div>
  );
}

function CreateRelationFlow(props: { collectionId: string; view?: CollectionViewRecord; afterPropId?: string; close: () => void; onCreated?: (propId: string) => void; initialTarget?: string; name?: string; propertyId?: string }) {
  const [target, setTarget] = useState<string | undefined>(props.initialTarget);
  if (!target) return <DataSourcePicker close={props.close} onPick={(id) => setTarget(id)} />;
  return <NewRelation collectionId={props.collectionId} targetId={target} view={props.view} afterPropId={props.afterPropId} close={props.close} onCreated={props.onCreated} onBack={() => setTarget(undefined)} initialName={props.name} propId={props.propertyId} />;
}

function EditRelation({ collectionId, propertyId, close }: { collectionId: string; propertyId: string; close: () => void }) {
  useTableVersion(['collection']);
  const source = useCollection(collectionId);
  const ps = source?.schema[propertyId];
  const target = getCollection(ps?.collection_id as string | undefined);
  const [picking, setPicking] = useState(false);
  const nameRef = useRef(ps?.name ?? '');
  if (!source || !ps) return null;
  if (picking) return <DataSourcePicker close={() => setPicking(false)} currentId={target?.id} onPick={(id) => { setRelationTarget(collectionId, propertyId, id); setPicking(false); }} />;
  const twoWay = !!ps.property && ps.property !== propertyId;
  const reverseName = twoWay && target ? target.schema[ps.property as string]?.name : undefined;
  return (
    <div className="nc-rel-panel" role="dialog" aria-label="Edit property">
      <div className="nc-rel-head">
        <div className="nc-rel-title">Edit property</div>
        <div role="button" className="nc-rel-x" aria-label="Close" onClick={close}><Icon name="xSmall" size={12} /></div>
      </div>
      <div className="nc-rel-input">
        <Icon name="relation" size={16} color="var(--lp-icon-secondary)" />
        <input
          style={{ marginLeft: 6 }}
          defaultValue={ps.name}
          placeholder="Property name"
          onChange={(e) => { nameRef.current = e.target.value; }}
          onBlur={() => { if (nameRef.current.trim() && nameRef.current !== ps.name) run('renameProperty', (tx) => tx.update('collection', collectionId, ['schema', propertyId], { name: nameRef.current.trim() })); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
      </div>
      <div className="nc-rel-section">
        <div role="menuitem" className="nc-rel-row" onClick={() => setPicking(true)}>
          <Icon name="collectionArrow" size={18} color="var(--lp-icon-secondary)" />
          <span className="label">Related to</span>
          <span className="value"><Icon name="databaseEmbed" size={14} color="var(--lp-icon-tertiary)" /><span className="v" style={{ color: 'var(--lp-text-secondary)', fontWeight: 500 }}>{target ? collectionName(target) : 'Select'}</span></span>
        </div>
        <div role="menuitem" className="nc-rel-row" onClick={(e) => LimitMenu(e.currentTarget, ps.limit as number | undefined, (v) => setRelationLimit(collectionId, propertyId, v))}>
          <Icon name="numberProp" size={18} color="var(--lp-icon-primary)" />
          <span className="label">Limit</span>
          <span className="value"><span className="v">{ps.limit === 1 ? '1 page' : 'No limit'}</span><Icon name="chevronRight" size={14} /></span>
        </div>
        <div role="menuitem" className="nc-rel-row" onClick={(e) => openMenu(e.currentTarget, {
          width: 250,
          sections: [{ items: [
            { label: 'On', description: reverseName ? `Shown on ${target ? collectionName(target) : ''} as “${reverseName}”` : undefined, checked: twoWay, onSelect: () => setRelationTwoWay(collectionId, propertyId, true) },
            { label: 'Off', checked: !twoWay, onSelect: () => setRelationTwoWay(collectionId, propertyId, false) },
          ] }],
        }, { placement: 'right-start' })}>
          <Icon name="fullWidth" size={18} color="var(--lp-icon-primary)" />
          <span className="label">Bidirectional link</span>
          <span className="value"><span className="v">{twoWay ? 'On' : 'Off'}</span><Icon name="chevronRight" size={14} /></span>
        </div>
      </div>
      <div className="nc-rel-foot">
        {HELP_URL && <a className="nc-rel-row" style={{ color: 'var(--lp-text-secondary)', textDecoration: 'none' }} href={HELP_URL} target="_blank" rel="noopener noreferrer">
          <Icon name="questionMark" size={18} color="var(--lp-icon-secondary)" /><span className="label">Explore linked fields</span>
        </a>}
      </div>
    </div>
  );
}


export function openRelationConfig(anchor: Anchor | null | undefined, opts: {
  collectionId: string; propertyId?: string; view?: CollectionViewRecord; afterPropId?: string; targetCollectionId?: string; name?: string;
  onCreated?: (propId: string) => void; onClose?: () => void;
}): () => void {
  return openOverlay((close) => (
    opts.propertyId && getCollection(opts.collectionId)?.schema[opts.propertyId]?.collection_id
      ? <EditRelation collectionId={opts.collectionId} propertyId={opts.propertyId} close={close} />
      : <CreateRelationFlow collectionId={opts.collectionId} view={opts.view} afterPropId={opts.afterPropId} close={close} onCreated={opts.onCreated} initialTarget={opts.targetCollectionId} name={opts.name ?? (opts.propertyId ? getCollection(opts.collectionId)?.schema[opts.propertyId]?.name : undefined)} propertyId={opts.propertyId} />
  ), { anchor: anchor ?? undefined, placement: anchor ? 'bottom-start' : 'center', backdrop: 'transparent', onClose: opts.onClose });
}

// Person, Files & media, Place and (fallback) Relation cell editors.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord, CollectionRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { encodeFiles, encodePeople, encodePlace, encodeRelation, getPropertyValue, type FileValue, type PlaceValue } from '@nc/shared/database/index.ts';
import { records } from '../../../../lib/store/records.ts';
import { useSession } from '../../../../lib/store/session.ts';
import { getBlock } from '../../../../lib/blocks.ts';
import { uploadFile } from '../../../../lib/api.ts';
import { useCollection } from '../../../../lib/hooks.ts';
import { openOverlay, PopoverSurface } from '../../../../components/overlay.tsx';
import { Icon } from '../../../../components/Icon.tsx';
import { UserAvatar } from '../../../presence/Avatar.tsx';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { setValue, setValues } from '../../actions.ts';
import { collectionRows, makeQueryContext } from '../../data.ts';
import type { CellEditorOptions } from '../editorRegistry.ts';
import { TEMPLATE_ME } from '../../templates/templateVars.tsx';
import '../../featureIcons.tsx';
import { useUI } from '../../../../lib/store/ui.ts';
import { openNestedMenu } from '../../menus.ts';

function write(opts: CellEditorOptions, raw: any) {
  if (opts.rowIds.length > 1) setValues(opts.rowIds, opts.propId, raw);
  else setValue(opts.rowIds[0], opts.propId, raw);
}

function currentValue(opts: CellEditorOptions) {
  const c = records.get<CollectionRecord>('collection', opts.collectionId);
  const row = getBlock(opts.rowIds[0]);
  if (!c || !row) return null;
  return getPropertyValue(row, opts.propId, c.schema, makeQueryContext());
}

export function workspaceMembers(): UserRecord[] {
  const spaceId = useSession.getState().spaceId;
  const space = records.get<SpaceRecord>('space', spaceId);
  const ids = new Set((space?.permissions ?? []).map((p) => p.user_id).filter(Boolean) as string[]);
  for (const u of records.all<UserRecord>('lit_user')) ids.add(u.id);
  // Custom Agents' own users (bots) aren't people
  return [...ids].map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u && !!(u.name || u.email) && !(u as { bot?: unknown }).bot);
}

function PersonEditor({ opts, close }: { opts: CellEditorOptions; close: () => void }) {
  const c = useCollection(opts.collectionId);
  const limit = (c?.schema[opts.propId]?.limit as number | undefined) ?? 0;
  const [ids, setIds] = useState<string[]>(() => {
    const v = currentValue(opts);
    return v?.kind === 'person' ? v.ids : [];
  });
  // permission groups (Settings › People › Groups) can be picked too: "Find people or groups…"
  const [groups, setGroups] = useState<{ id: string; spaceId?: string }[]>(() => {
    const v = currentValue(opts);
    return v?.kind === 'person' ? v.groups ?? [] : [];
  });
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  const users = useMemo(() => workspaceMembers(), []);
  const spaceId = (c?.space_id as string | undefined) ?? useSession.getState().spaceId ?? undefined;
  const spaceGroups = useMemo(() => (((records.get<SpaceRecord>('space', spaceId)?.settings as { groups?: { id: string; name?: string; member_ids?: string[] }[] } | undefined)?.groups ?? []).filter((g) => g && g.id)), [spaceId]);
  const needle = q.trim().toLowerCase();
  const list = users.filter((u) => !ids.includes(u.id) && (!needle || `${u.name} ${u.email}`.toLowerCase().includes(needle)));
  const groupList = spaceGroups.filter((g) => !groups.some((x) => x.id === g.id) && (!needle || (g.name ?? '').toLowerCase().includes(needle)));
  const options: ({ kind: 'user'; id: string } | { kind: 'group'; id: string })[] = [...list.map((u) => ({ kind: 'user' as const, id: u.id })), ...groupList.map((g) => ({ kind: 'group' as const, id: g.id }))];
  const set = (nextIds: string[], nextGroups = groups) => {
    setIds(nextIds);
    setGroups(nextGroups);
    write(opts, encodePeople(nextIds, nextGroups));
  };
  const add = (id: string) => {
    if (limit === 1) {
      set([id], []);
      close();
      return;
    }
    set([...ids, id]);
    setQ('');
  };
  const addGroup = (id: string) => {
    const g = { id, ...(spaceId ? { spaceId } : {}) };
    if (limit === 1) {
      set([], [g]);
      close();
      return;
    }
    set(ids, [...groups, g]);
    setQ('');
  };
  const pick = (o: (typeof options)[number] | undefined) => {
    if (!o) return;
    if (o.kind === 'user') add(o.id);
    else addGroup(o.id);
  };
  const groupName = (id: string) => spaceGroups.find((g) => g.id === id)?.name || 'Deleted group';
  return (
    <PopoverSurface width={300} className="nc-select-editor">
      <div className="nc-select-editor-field">
      <div className="nc-select-editor-input" onMouseDown={(e) => { if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus(); } }}>
        {ids.map((id) => {
          const u = records.get<UserRecord>('lit_user', id);
          return (
            <span key={id} className="nc-person-token">
              <UserAvatar userId={id} size={18} />
              <span>{id === TEMPLATE_ME ? 'Me' : u?.name || u?.email || 'Unknown'}</span>
              <span role="button" className="nc-pill-remove" onClick={() => set(ids.filter((x) => x !== id))}><Icon name="xSmall" size={12} /></span>
            </span>
          );
        })}
        {groups.map((g) => (
          <span key={`g:${g.id}`} className="nc-person-token" data-group-id={g.id}>
            <span className="nc-group-avatar" style={{ width: 18, height: 18 }} aria-hidden>{groupName(g.id).trim()[0]?.toUpperCase()}</span>
            <span>{groupName(g.id)}</span>
            <span role="button" className="nc-pill-remove" onClick={() => set(ids, groups.filter((x) => x.id !== g.id))}><Icon name="xSmall" size={12} /></span>
          </span>
        ))}
        <input
          ref={inputRef}
          value={q}
          placeholder={ids.length || groups.length ? '' : spaceGroups.length ? 'Find people or groups…' : 'Find a person…'}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            else if (e.key === 'Enter') { e.preventDefault(); pick(options[active]); }
            else if (e.key === 'Backspace' && !q && (ids.length || groups.length)) { if (groups.length) set(ids, groups.slice(0, -1)); else set(ids.slice(0, -1)); }
            else if (e.key === 'Escape') { e.preventDefault(); close(); }
          }}
        />
      </div>
      </div>
      <div className="lit-scroller vertical nc-select-editor-scroll">
        <div className="nc-select-editor-hint">{spaceGroups.length ? (limit === 1 ? 'Select one' : 'Choose any number of options') : limit === 1 ? 'Select a person' : 'Select as many people as you like'}</div>
        {/* database templates: "Me — Person who duplicated entry" */}
        {getBlock(opts.rowIds[0])?.is_template && !ids.includes(TEMPLATE_ME) && (!q || 'me'.includes(q.trim().toLowerCase())) && (
          <div role="option" aria-selected={false} className="nc-select-option" onMouseDown={(e) => e.preventDefault()} onClick={() => add(TEMPLATE_ME)}>
            <span className="nc-person-chip"><Icon name="person" size={18} /><span className="nc-person-name">Me</span><span className="nc-select-editor-hint" style={{ padding: 0, marginInlineStart: 8 }}>Person who duplicated entry</span></span>
          </div>
        )}
        {list.map((u, i) => (
          <div key={u.id} role="option" aria-selected={i === active} className={`nc-select-option ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => add(u.id)}>
            <span className="nc-person-chip"><UserAvatar userId={u.id} size={20} /><span className="nc-person-name">{u.name || u.email}</span></span>
          </div>
        ))}
        {groupList.length > 0 && <div className="nc-select-editor-hint">Groups</div>}
        {groupList.map((g, k) => {
          const i = list.length + k;
          return (
            <div key={g.id} role="option" aria-selected={i === active} data-group-id={g.id} className={`nc-select-option ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => addGroup(g.id)}>
              <span className="nc-person-chip">
                <span className="nc-group-avatar" style={{ width: 20, height: 20 }} aria-hidden>{(g.name ?? '').trim()[0]?.toUpperCase()}</span>
                <span className="nc-person-name">{g.name || 'Untitled'}</span>
                <span className="nc-select-editor-hint" style={{ padding: 0, marginInlineStart: 8 }}>{(g.member_ids?.length ?? 0) === 1 ? '1 person' : `${g.member_ids?.length ?? 0} people`}</span>
              </span>
            </div>
          );
        })}
        {!options.length && <div className="nc-select-editor-empty">No results</div>}
      </div>
    </PopoverSurface>
  );
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?|#|$)/i;
export const isImageFile = (f: FileValue) => IMAGE_EXT.test(f.name) || IMAGE_EXT.test(f.url);

/** Upload dropped / chosen files (5 MB each, the editor) and return them as file values. */
export async function uploadFileValues(list: File[]): Promise<FileValue[]> {
  const out: FileValue[] = [];
  for (const f of list) {
    if (f.size > 5 * 1024 * 1024) {
      useUI.getState().toast('The maximum size per file is 5 MB.');
      continue;
    }
    try {
      const res = await uploadFile(f, f.name, useSession.getState().spaceId ?? undefined);
      out.push({ name: res.name || f.name, url: res.url });
    } catch (err) {
      console.error(err);
      useUI.getState().toast('Upload failed.');
    }
  }
  return out;
}

/** Full- viewer for an image file value (FilePropertyModuleValue › click / "View original"). */
export function openFileFullScreen(f: FileValue) {
  openOverlay((close) => (
    <div className="nc-file-fullscreen" role="dialog" aria-label={f.name} onClick={close}>
      <img src={f.url} alt={f.name} onClick={(e) => e.stopPropagation()} />
      <div className="nc-file-fullscreen-bar" onClick={(e) => e.stopPropagation()}>
        <span className="nc-ellipsis">{f.name}</span>
        <a href={f.url} download={f.name} className="nc-btn outline">Download</a>
        <span role="button" className="nc-btn outline" onClick={close}>Close</span>
      </div>
    </div>
  ), { placement: 'center', backdrop: 'dim', className: 'nc-file-fullscreen-overlay' });
}

function downloadFile(f: FileValue) {
  const a = document.createElement('a');
  a.href = f.url;
  a.download = f.name;
  a.rel = 'noreferrer';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function FilesEditor({ opts, close }: { opts: CellEditorOptions; close: () => void }) {
  const [files, setFiles] = useState<FileValue[]>(() => {
    const v = currentValue(opts);
    return v?.kind === 'file' ? v.files : [];
  });
  const [tab, setTab] = useState<'upload' | 'link'>('upload');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const [dropping, setDropping] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const prop = records.get<CollectionRecord>('collection', opts.collectionId)?.schema[opts.propId];
  const single = prop?.limit === 1;
  const set = (next: FileValue[]) => {
    const value = single ? next.slice(-1) : next;
    setFiles(value);
    write(opts, encodeFiles(value));
  };
  const addUploads = async (list: File[]) => {
    if (!list.length) return;
    setBusy(true);
    const added = await uploadFileValues(list);
    setBusy(false);
    set([...files, ...added]);
  };
  const fileMenu = (anchor: HTMLElement, i: number) => {
    const f = files[i];
    openNestedMenu(anchor, { width: 200, sections: [
      { items: [
        ...(isImageFile(f) ? [{ id: 'full', label: 'Full screen', icon: 'maximize', onSelect: () => { setTimeout(() => openFileFullScreen(f), 0); } }] : []),
        { id: 'orig', label: 'View original', icon: 'openAsPage', onSelect: () => { window.open(f.url, '_blank', 'noopener'); } },
        { id: 'dl', label: 'Download', icon: 'download', onSelect: () => downloadFile(f) },
        { id: 'rename', label: 'Rename', icon: 'pencil', onSelect: () => setRenaming(i) },
      ] },
      { items: [{ id: 'delete', label: 'Delete', icon: 'trash', onSelect: () => set(files.filter((_, j) => j !== i)) }] },
    ] }, { placement: 'bottom-end' });
  };
  return (
    <PopoverSurface width={360} className={`nc-files-editor ${dropping ? 'dropping' : ''}`}>
      <div
        data-testid="files-editor"
        onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
        onDragLeave={() => setDropping(false)}
        onDrop={(e) => { if (!e.dataTransfer.files.length) return; e.preventDefault(); setDropping(false); void addUploads([...e.dataTransfer.files]); }}
      >
        {files.length > 0 && (
          <div className="nc-files-list">
            {files.map((f, i) => (
              <div
                key={`${f.url}-${i}`}
                className={`nc-files-item ${drag && drag.over === i && drag.from !== i ? (drag.from < i ? 'drop-after' : 'drop-before') : ''}`}
                data-testid="files-item"
                onDragOver={(e) => { if (drag) { e.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); } }}
                onDrop={(e) => {
                  if (!drag) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const next = [...files];
                  const [moved] = next.splice(drag.from, 1);
                  next.splice(i, 0, moved);
                  setDrag(null);
                  set(next);
                }}
              >
                <span className="nc-files-handle" draggable aria-label="Drag to reorder" onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); setDrag({ from: i, over: i }); }} onDragEnd={() => setDrag(null)}><Icon name="gripVertical" size={14} /></span>
                {isImageFile(f) ? <img className="nc-files-thumb" src={f.url} alt="" /> : <Icon name="paperClip" size={16} />}
                {renaming === i ? (
                  <input
                    className="nc-files-rename"
                    autoFocus
                    defaultValue={f.name}
                    onBlur={(e) => { const n = e.target.value.trim(); setRenaming(null); if (n && n !== f.name) set(files.map((x, j) => (j === i ? { ...x, name: n } : x))); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null); }}
                  />
                ) : (
                  <a href={f.url} target="_blank" rel="noreferrer" className="nc-files-name" onClick={(e) => { if (isImageFile(f)) { e.preventDefault(); openFileFullScreen(f); } }}>{f.name}</a>
                )}
                <span role="button" className="nc-files-remove" aria-label="More actions" data-testid="files-item-menu" onClick={(e) => fileMenu(e.currentTarget, i)}><Icon name="ellipsisSmall" size={14} /></span>
              </div>
            ))}
          </div>
        )}
        <div className="nc-files-tabs">
          <span role="tab" aria-selected={tab === 'upload'} className={tab === 'upload' ? 'active' : ''} onClick={() => setTab('upload')}>Upload</span>
          <span role="tab" aria-selected={tab === 'link'} className={tab === 'link' ? 'active' : ''} onClick={() => setTab('link')}>Link</span>
        </div>
        <div className="nc-files-body">
          {tab === 'upload' ? (
            <>
              <button className="nc-btn outline nc-files-choose" disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : 'Choose a file'}</button>
              <input ref={fileRef} type="file" multiple={!single} hidden data-testid="files-input" onChange={(e) => void addUploads([...(e.target.files ?? [])])} />
              <div className="nc-files-hint">{dropping ? 'Drop to upload' : 'The maximum size per file is 5 MB.'}</div>
            </>
          ) : (
            <>
              <div className="nc-input focused"><input autoFocus placeholder="Paste a URL such as https://…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && link.trim()) { e.preventDefault(); set([...files, { name: link.trim(), url: /^[a-z]+:/i.test(link.trim()) ? link.trim() : `https://${link.trim()}` }]); setLink(''); } if (e.key === 'Escape') close(); }} /></div>
              <button className="nc-btn primary nc-files-embed" disabled={!link.trim()} onClick={() => { set([...files, { name: link.trim(), url: /^[a-z]+:/i.test(link.trim()) ? link.trim() : `https://${link.trim()}` }]); setLink(''); }}>Embed link</button>
            </>
          )}
        </div>
      </div>
    </PopoverSurface>
  );
}

/** Places already used in this workspace's Place properties (offline suggestions — no external map search). */
function knownPlaces(spaceId: string | undefined): PlaceValue[] {
  const out = new Map<string, PlaceValue>();
  for (const c of records.all<CollectionRecord>('collection')) {
    if (spaceId && c.space_id !== spaceId) continue;
    const pids = Object.entries(c.schema ?? {}).filter(([, p]) => p?.type === 'place').map(([id]) => id);
    if (!pids.length) continue;
    for (const r of collectionRows(c.id)) {
      for (const pid of pids) {
        const v = getPropertyValue(r, pid, c.schema, makeQueryContext());
        if (v.kind === 'place' && v.place && (v.place.name || v.place.address)) out.set(`${v.place.name ?? ''}|${v.place.address ?? ''}`, v.place);
      }
    }
  }
  return [...out.values()];
}

function mapsUrl(p: PlaceValue): string {
  const q = p.lat !== undefined && p.lon !== undefined ? `${p.lat},${p.lon}` : [p.name, p.address].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

/** Place value overlay (placePropertyValueOverlay): search field, Current Location, place name, clear, map link. */
function PlaceEditor({ opts, close }: { opts: CellEditorOptions; close: () => void }) {
  const v = currentValue(opts);
  const cur = v?.kind === 'place' ? v.place : null;
  const c = records.get<CollectionRecord>('collection', opts.collectionId);
  const [q, setQ] = useState(cur?.address ?? cur?.name ?? '');
  const [name, setName] = useState(cur?.name ?? '');
  const [geoError, setGeoError] = useState(false);
  const [busy, setBusy] = useState(false);
  const known = useMemo(() => knownPlaces(c?.space_id), [c?.space_id]);
  const needle = q.trim().toLowerCase();
  const matches = needle ? known.filter((p) => `${p.name ?? ''} ${p.address ?? ''}`.toLowerCase().includes(needle)).slice(0, 6) : [];
  const set = (place: PlaceValue | null) => write(opts, encodePlace(place));
  const pickTyped = () => {
    const text = q.trim();
    if (!text) return;
    set({ ...(cur ?? {}), name: name.trim() || cur?.name || text, address: text });
  };
  const useCurrent = () => {
    if (!('geolocation' in navigator)) return setGeoError(true);
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBusy(false);
        const lat = Math.round(pos.coords.latitude * 1e6) / 1e6;
        const lon = Math.round(pos.coords.longitude * 1e6) / 1e6;
        set({ name: name.trim() || 'Current Location', address: `${lat}, ${lon}`, lat, lon });
        close();
      },
      () => { setBusy(false); setGeoError(true); },
      { timeout: 8000, maximumAge: 60_000 },
    );
  };
  return (
    <PopoverSurface width={340} className="nc-place-editor">
      <div className="nc-place-fields" data-menu-keys="ignore">
        <div className="nc-input focused">
          <Icon name="magnifyingGlassSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
          <input autoFocus placeholder="Find a place..." value={q} data-testid="place-search" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); pickTyped(); close(); } if (e.key === 'Escape') close(); }} />
        </div>
      </div>
      <div className="nc-place-results">
        <div role="button" className={`nc-menu-item ${geoError ? 'disabled' : ''}`} data-testid="place-current" data-tooltip={geoError ? 'Location access is unavailable' : undefined} onClick={() => !geoError && !busy && useCurrent()}>
          <div className="nc-menu-item-inner"><Icon name="crosshair" size={16} /><div className="nc-menu-label">{busy ? 'Current Location…' : 'Current Location'}</div></div>
        </div>
        {needle && (
          <div role="button" className="nc-menu-item" data-testid="place-use-typed" onClick={() => { pickTyped(); close(); }}>
            <div className="nc-menu-item-inner"><Icon name="mapPin" size={16} /><div className="nc-menu-label nc-ellipsis">{q.trim()}</div></div>
          </div>
        )}
        {matches.map((p, i) => (
          <div key={i} role="button" className="nc-menu-item" onClick={() => { set(p); close(); }}>
            <div className="nc-menu-item-inner">
              <Icon name="mapPin" size={16} />
              <div className="nc-menu-label"><div className="nc-ellipsis">{p.name || p.address}</div>{p.name && p.address && <div className="nc-menu-desc nc-ellipsis">{p.address}</div>}</div>
            </div>
          </div>
        ))}
        {needle && <div className="nc-place-disclaimer">Results may be limited. </div>}
      </div>
      {cur && (
        <>
          <div className="nc-menu-divider" />
          <div className="nc-place-fields" data-menu-keys="ignore">
            <label className="nc-place-label">Place name</label>
            <div className="nc-input"><input placeholder="Rename place" value={name} data-testid="place-name" onChange={(e) => setName(e.target.value)} onBlur={() => set({ ...cur, name: name.trim() || undefined })} onKeyDown={(e) => { if (e.key === 'Enter') { set({ ...cur, name: name.trim() || undefined }); close(); } }} /></div>
          </div>
          <a className="nc-menu-item nc-place-map" href={mapsUrl(cur)} target="_blank" rel="noreferrer"><div className="nc-menu-item-inner"><Icon name="openAsPage" size={16} /><div className="nc-menu-label">Open in Maps</div></div></a>
          <div role="button" className="nc-menu-item nc-place-clear" data-testid="place-clear" onClick={() => { write(opts, undefined); close(); }}><div className="nc-menu-item-inner"><Icon name="trash" size={16} /><div className="nc-menu-label">Clear place</div></div></div>
        </>
      )}
    </PopoverSurface>
  );
}

/** Fallback relation picker (pages of the related data source). The relation work stream may override it. */
function RelationEditor({ opts, close }: { opts: CellEditorOptions; close: () => void }) {
  const c = useCollection(opts.collectionId);
  const prop = c?.schema[opts.propId];
  const target = records.get<CollectionRecord>('collection', String(prop?.collection_id ?? ''));
  const [ids, setIds] = useState<string[]>(() => {
    const v = currentValue(opts);
    return v?.kind === 'relation' ? v.ids : [];
  });
  const [q, setQ] = useState('');
  const pages = useMemo(() => (target ? collectionRows(target.id) : []), [target]);
  const title = (b: BlockRecord) => toPlainText(b.properties?.title) || 'Untitled';
  const set = (next: string[]) => {
    setIds(next);
    write(opts, encodeRelation(next, c?.space_id));
  };
  const linked = ids.map((id) => getBlock(id)).filter((b): b is BlockRecord => !!b);
  const rest = pages.filter((p) => !ids.includes(p.id) && (!q || title(p).toLowerCase().includes(q.toLowerCase())));
  return (
    <PopoverSurface width={360} className="nc-select-editor">
      <div className="nc-select-editor-field">
      <div className="nc-select-editor-input">
        <input autoFocus value={q} placeholder="Link or create an entry…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') close(); }} />
      </div>
      </div>
      <div className="lit-scroller vertical nc-select-editor-scroll">
        {!target && <div className="nc-select-editor-empty">Choose a related database in Edit property.</div>}
        {linked.length > 0 && <div className="nc-select-editor-hint">Linked</div>}
        {linked.map((b) => (
          <div key={b.id} className="nc-select-option" onClick={() => set(ids.filter((x) => x !== b.id))}>
            <span className="nc-page-chip"><PageIcon block={b} size={18} /><span className="nc-page-chip-title">{title(b)}</span></span>
            <span className="nc-select-option-more"><Icon name="minus" size={14} /></span>
          </div>
        ))}
        {target && <div className="nc-select-editor-hint">{rest.length ? 'Select more' : 'No pages'}</div>}
        {rest.slice(0, 100).map((b) => (
          <div key={b.id} className="nc-select-option" onClick={() => { if (prop?.limit === 1) { set([b.id]); close(); } else set([...ids, b.id]); }}>
            <span className="nc-page-chip"><PageIcon block={b} size={18} /><span className="nc-page-chip-title">{title(b)}</span></span>
            <span className="nc-select-option-more"><Icon name="plus" size={14} /></span>
          </div>
        ))}
      </div>
    </PopoverSurface>
  );
}

function opener(Comp: (p: { opts: CellEditorOptions; close: () => void }) => any) {
  return (anchor: HTMLElement, opts: CellEditorOptions) => {
    const rect = anchor.getBoundingClientRect();
    return openOverlay((close) => <Comp opts={opts} close={close} />, { anchor: new DOMRect(rect.left, rect.top, rect.width, 0), placement: 'bottom-start', offset: 0, onClose: opts.onClose });
  };
}

export const openPersonEditor = opener(PersonEditor);
export const openFilesEditor = opener(FilesEditor);
export const openPlaceEditor = opener(PlaceEditor);
export const openRelationEditor = opener(RelationEditor);

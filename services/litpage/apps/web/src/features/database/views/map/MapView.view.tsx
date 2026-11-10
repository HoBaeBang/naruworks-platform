// Map view: rows with a Place property (query2.map_by) as pins on an OpenStreetMap raster map
// (Web Mercator tiles drawn as <img> — uses MapLibre GL; the look: 898×400 canvas, blue pins,
// toolbar "No location (N)" + "Enable pin placement", Style: Height from format.map_config.height —
// toolbar “No location (N)” and “Enable pin placement”, with height from format.map_config.height.
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord, PropertySchema } from '@nc/shared/records.ts';
import type { PlaceValue } from '@nc/shared/database/index.ts';
import { registerLayoutSettings, registerView, type LayoutSettingsProps, type ViewProps } from '../../viewRegistry.ts';
import { Icon } from '../../../../components/Icon.tsx';
import { openMenu } from '../../../../components/Menu.tsx';
import { run, setProperty } from '../../../../lib/blocks.ts';
import { addProperty, viewCreationHooks } from '../../actions.ts';
import { newPropId, titleOf } from '../../advanced/index.ts';
import { SettingsRow, pickMenu, setFormat, setQuery2, useViewKit } from '../../advanced/viewKit.tsx';
import { PropertyIcon } from '../../properties/PropertyCell.tsx';
import './map.css';

const TILE = 256;
const MIN_Z = 1;
const MAX_Z = 18;
export const MAP_HEIGHTS: Record<string, number> = { small: 300, medium: 400, large: 600, extra_large: 800 };

interface LatLon { lat: number; lon: number }

function project({ lat, lon }: LatLon, z: number): { x: number; y: number } {
  const s = TILE * 2 ** z;
  const sin = Math.sin((Math.max(-85.05, Math.min(85.05, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

function unproject(x: number, y: number, z: number): LatLon {
  const s = TILE * 2 ** z;
  const lon = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  return { lat: (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))), lon: ((lon + 540) % 360) - 180 };
}

export function placeOf(row: BlockRecord, propId: string): PlaceValue | null {
  for (const seg of (row.properties?.[propId] as unknown as [string, unknown[][]?][] | undefined) ?? []) {
    for (const a of seg[1] ?? []) if (a[0] === 'plc' && a[1]) return a[1] as PlaceValue;
  }
  return null;
}

function encodePlace(p: PlaceValue) {
  return [['‣', [['plc', p]]]];
}

/** Zoom and center that fit all points into w x h. */
function fit(points: LatLon[], w: number, h: number): { center: LatLon; z: number } {
  if (!points.length) return { center: { lat: 30, lon: 0 }, z: 2 };
  if (points.length === 1) return { center: points[0], z: 12 };
  for (let z = 16; z >= MIN_Z; z--) {
    const ps = points.map((p) => project(p, z));
    const minX = Math.min(...ps.map((p) => p.x));
    const maxX = Math.max(...ps.map((p) => p.x));
    const minY = Math.min(...ps.map((p) => p.y));
    const maxY = Math.max(...ps.map((p) => p.y));
    if (maxX - minX < w - 120 && maxY - minY < h - 120) return { center: unproject((minX + maxX) / 2, (minY + maxY) / 2, z), z };
  }
  return { center: points[0], z: MIN_Z };
}

function NoPlace({ onAdd, readOnly }: { onAdd: () => void; readOnly: boolean }) {
  return (
    <div className="nc-cal-nodate">
      <div className="nc-cal-nodate-title">No place property</div>
      {readOnly ? <div>Map views require a place property in order to display.</div> : <div><span role="link" className="nc-cal-link" onClick={onAdd}>Add a place property</span> to your database in order to display a Map view.</div>}
    </div>
  );
}

function MapView(props: ViewProps) {
  const kit = useViewKit(props);
  const { view, collection, readOnly } = kit;
  const schema = collection.schema;
  const fmt = (view.format ?? {}) as Record<string, any>;
  const q2 = (view.query2 ?? {}) as Record<string, unknown>;
  const byProp = (q2.map_by as string | undefined) && schema[q2.map_by as string] ? (q2.map_by as string) : Object.keys(schema).find((k) => schema[k].type === 'place');
  const height = MAP_HEIGHTS[fmt.map_config?.height ?? 'medium'] ?? 400;
  const bleed = kit.db?.bleed ?? { left: 0, right: 0 };
  const boxRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [cam, setCam] = useState<{ center: LatLon; z: number } | null>(null);
  const [pinMode, setPinMode] = useState<{ rowId: string | null } | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  const located = useMemo(() => (byProp ? kit.rows.map((r) => ({ row: r, place: placeOf(r, byProp) })).filter((x) => x.place && Number.isFinite(x.place.lat) && Number.isFinite(x.place.lon)) : []), [kit.rows, byProp]) as { row: BlockRecord; place: PlaceValue & LatLon }[];
  const missing = useMemo(() => (byProp ? kit.rows.filter((r) => { const p = placeOf(r, byProp); return !p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon); }) : []), [kit.rows, byProp]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const m = () => setWidth(Math.max(200, el.clientWidth));
    m();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(m);
    ro.observe(el);
    return () => ro.disconnect();
  }, [byProp]);

  const camera = cam ?? fit(located.map((x) => ({ lat: x.place.lat, lon: x.place.lon })), width, height);
  const z = camera.z;
  const c = project(camera.center, z);
  const tl = { x: c.x - width / 2, y: c.y - height / 2 };
  const n = 2 ** z;

  const tiles = useMemo(() => {
    const out: { key: string; src: string; left: number; top: number }[] = [];
    const x0 = Math.floor(tl.x / TILE);
    const y0 = Math.floor(tl.y / TILE);
    const x1 = Math.floor((tl.x + width) / TILE);
    const y1 = Math.floor((tl.y + height) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n;
        out.push({ key: `${z}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`, left: tx * TILE - tl.x, top: ty * TILE - tl.y });
      }
    }
    return out;
  }, [tl.x, tl.y, width, height, z, n]);

  const addPlaceProperty = () => {
    const pid = addProperty(collection.id, 'place' as never, { name: 'Place', view });
    if (pid) setQuery2(view, { map_by: pid });
  };
  if (!byProp) return <div className="nc-map" style={{ marginInlineStart: bleed.left, marginInlineEnd: bleed.right }}><NoPlace onAdd={addPlaceProperty} readOnly={readOnly} /></div>;

  const setZoom = (nz: number, at?: { x: number; y: number }) => {
    const zz = Math.max(MIN_Z, Math.min(MAX_Z, nz));
    const anchor = at ?? { x: width / 2, y: height / 2 };
    const ll = unproject(tl.x + anchor.x, tl.y + anchor.y, z);
    const p = project(ll, zz);
    setCam({ center: unproject(p.x - anchor.x + width / 2, p.y - anchor.y + height / 2, zz), z: zz });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.nc-map-pin, .nc-map-ui')) return;
    const start = { x: e.clientX, y: e.clientY, c };
    let moved = false;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) setCam({ center: unproject(start.c.x - dx, start.c.y - dy, z), z });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      if (moved || !pinMode || readOnly) return;
      const r = el.getBoundingClientRect();
      const ll = unproject(tl.x + ev.clientX - r.left, tl.y + ev.clientY - r.top, z);
      const place: PlaceValue = { lat: Math.round(ll.lat * 1e6) / 1e6, lon: Math.round(ll.lon * 1e6) / 1e6, name: `${ll.lat.toFixed(4)}, ${ll.lon.toFixed(4)}` };
      if (pinMode.rowId) {
        const row = kit.rows.find((x) => x.id === pinMode.rowId);
        const prev = row ? placeOf(row, byProp) : null;
        run('mapView.placePin', (tx) => setProperty(tx, pinMode.rowId!, byProp, encodePlace({ ...(prev ?? {}), ...place, name: prev?.name ?? place.name })));
      } else kit.addRow({ [byProp]: encodePlace(place) as never }, { open: true });
      setPinMode(null);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 30) return;
    const r = e.currentTarget.getBoundingClientRect();
    setZoom(z + (e.deltaY < 0 ? 1 : -1), { x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div className="nc-map lit-map-view" style={{ marginInlineStart: bleed.left, marginInlineEnd: bleed.right }}>
      <div ref={boxRef} className={`nc-map-canvas ${pinMode ? 'pin-mode' : ''}`} style={{ height }} onPointerDown={onPointerDown} onWheel={onWheel} data-testid="map-canvas">
        {tiles.map((t) => <img key={t.key} className="nc-map-tile" src={t.src} alt="" draggable={false} style={{ left: t.left, top: t.top }} />)}
        {located.map(({ row, place }) => {
          const p = project(place, z);
          const x = p.x - tl.x;
          const y = p.y - tl.y;
          if (x < -40 || y < -40 || x > width + 40 || y > height + 40) return null;
          return (
            <div key={row.id} className={`nc-map-pin ${hover === row.id ? 'hover' : ''}`} style={{ left: x, top: y }} data-block-id={row.id} role="button" aria-label={titleOf(row) || 'Untitled'}
              onPointerEnter={() => setHover(row.id)} onPointerLeave={() => setHover(null)} onClick={() => kit.openRow(row.id)}>
              <svg width="26" height="34" viewBox="0 0 26 34" aria-hidden><path d="M13 33s11-11.4 11-19.5C24 6.6 19.1 2 13 2S2 6.6 2 13.5C2 21.6 13 33 13 33z" fill="var(--lp-blue-bg-accent)" stroke="var(--lp-bg-primary)" strokeWidth="2" /><circle cx="13" cy="13.5" r="4" fill="var(--lp-bg-primary)" /></svg>
              {hover === row.id && <div className="nc-map-pin-label">{titleOf(row) || 'Untitled'}{place.address && place.address !== place.name ? <span>{place.address}</span> : place.name ? <span>{place.name}</span> : null}</div>}
            </div>
          );
        })}
        <div className="nc-map-ui nc-map-toolbar">
          <div role="button" className="nc-map-btn" data-testid="map-no-location" onClick={(e) => openMenu(e.currentTarget, {
            width: 280, header: <div className="nc-map-menu-head">No location ({missing.length})</div>,
            sections: [{ items: missing.length ? missing.slice(0, 100).map((r) => ({ id: r.id, label: titleOf(r) || 'Untitled', icon: 'page', description: readOnly ? undefined : 'Click the map to place this page', onSelect: () => { if (!readOnly) setPinMode({ rowId: r.id }); else kit.openRow(r.id); } })) : [{ id: 'none', label: 'Every page has a location', disabled: true }] }],
          }, { placement: 'bottom-start' })}>No location ({missing.length})</div>
          {!readOnly && (
            <div role="button" className={`nc-map-btn icon ${pinMode && !pinMode.rowId ? 'on' : ''}`} aria-label={pinMode ? 'Disable add-pin mode' : 'Enable pin placement'} data-tooltip={pinMode ? 'Disable add-pin mode' : 'Enable pin placement'} onClick={() => setPinMode(pinMode ? null : { rowId: null })}>
              <Icon name="location" size={16} />
            </div>
          )}
        </div>
        {pinMode && <div className="nc-map-ui nc-map-hint">{pinMode.rowId ? `Click the map to place “${titleOf(kit.rows.find((r) => r.id === pinMode.rowId)) || 'Untitled'}”` : 'Click the map to add a page with a pin'}<span role="button" onClick={() => setPinMode(null)}>Cancel</span></div>}
        <div className="nc-map-ui nc-map-zoom">
          <div role="button" aria-label="Zoom in" onClick={() => setZoom(z + 1)}><Icon name="plus" size={16} /></div>
          <div role="button" aria-label="Zoom out" onClick={() => setZoom(z - 1)}><Icon name="dashLong" size={16} /></div>
        </div>
        <div className="nc-map-ui nc-map-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors</div>
      </div>
    </div>
  );
}

registerView('map', MapView);

function MapLayoutSettings({ view, collection, readOnly }: LayoutSettingsProps) {
  const schema = collection.schema;
  const q2 = (view.query2 ?? {}) as Record<string, unknown>;
  const fmt = (view.format ?? {}) as Record<string, any>;
  const places = Object.entries(schema).filter(([, p]) => p.type === 'place');
  const by = (q2.map_by as string | undefined) && schema[q2.map_by as string] ? (q2.map_by as string) : places[0]?.[0];
  const h = fmt.map_config?.height ?? 'medium';
  const labels: Record<string, string> = { small: 'Small', medium: 'Medium', large: 'Large', extra_large: 'Extra large' };
  return (
    <>
      <SettingsRow label="Map by" value={by ? schema[by]?.name : 'None'} disabled={readOnly} onClick={(e) => pickMenu(e.currentTarget, places.length ? places.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: id === by, onSelect: () => setQuery2(view, { map_by: id }, 'mapView.setMapBy') })) : [{ id: 'none', label: 'No place properties', disabled: true }])} />
      <SettingsRow label="Height" value={labels[h] ?? 'Medium'} disabled={readOnly} onClick={(e) => pickMenu(e.currentTarget, Object.keys(labels).map((k) => ({ id: k, label: labels[k], checked: h === k, onSelect: () => setFormat(view, { map_config: { ...(fmt.map_config ?? {}), height: k } }, 'mapView.setHeight') })))} />
    </>
  );
}

registerLayoutSettings('map', MapLayoutSettings);

/** New map views: query2.map_by = first place property (creates "Place" when missing). */
viewCreationHooks.map = (tx, viewId, collection) => {
  let pid = Object.keys(collection.schema).find((k) => collection.schema[k].type === 'place');
  if (!pid) {
    pid = newPropId(collection.schema);
    tx.set('collection', collection.id, ['schema', pid], { name: 'Place', type: 'place' } as PropertySchema);
  }
  tx.update('collection_view', viewId, ['query2'], { map_by: pid });
  tx.update('collection_view', viewId, ['format'], { map_config: { height: 'medium' } });
};

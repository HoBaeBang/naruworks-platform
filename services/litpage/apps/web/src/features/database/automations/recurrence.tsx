// "Every…" editor (automation trigger, repeating templates): presets (Day, Weekday, Week,
// 2 Weeks, Month, 3 Months, 6 Months, Year), Every N Hours/Days/Weeks/Months/Years, weekdays, "On the" day / last day,
// "At" time or "Around midnight", Starting, Ending (Never / Run count / Specific date), Timezone and the
// next occurrence.
import { useMemo, useState } from 'react';
import {
  FREQUENCY_LABELS, RECURRENCE_PRESETS, WEEKDAY_ABBR, formatOccurrence, nextOccurrence, presetOf, presetRecurrence, recurrenceValid, type Recurrence, type RecurrencePreset,
} from '@nc/shared/automation/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { openKeepMenu } from './keepMenu.ts';
import { startOfWeekSetting, userTimeZone } from '../advanced/context.ts';

function zones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
}

function RecurrenceEditor({ value, onSave, onDelete, close, deleteLabel }: { value: Recurrence | null; onSave: (r: Recurrence) => void; onDelete?: () => void; close: () => void; deleteLabel?: string }) {
  const [r, setR] = useState<Recurrence>(() => value ?? presetRecurrence('day', Date.now(), userTimeZone()));
  const set = (patch: Partial<Recurrence>) => setR((x) => ({ ...x, ...patch }));
  const next = useMemo(() => (recurrenceValid(r) ? nextOccurrence(r, Date.now()) : null), [r]);
  const valid = recurrenceValid(r);
  const preset = presetOf(r);
  const order = startOfWeekSetting() === 1 ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6];
  const plural = r.interval === 1 ? 0 : 1;
  return (
    <PopoverSurface width={300} className="nc-rec-pop" maxHeight="80vh">
      <div className="nc-rec" data-menu-keys="ignore">
        <div className="nc-auto-pop-tabs" style={{ padding: 0 }}>
          {RECURRENCE_PRESETS.map((p) => (
            <span key={p.id} role="button" className={`nc-auto-pop-tab ${preset === p.id ? 'on' : ''}`} onClick={() => setR({ ...presetRecurrence(p.id as RecurrencePreset, Date.now(), r.time_zone, r.time), end: r.end })}>{p.label}</span>
          ))}
        </div>
        <div className="nc-rec-row">
          <span className="nc-rec-label">Every</span>
          <input type="number" min={1} max={1000} aria-label="Interval" value={r.interval} onChange={(e) => set({ interval: Math.max(1, Math.min(1000, Number(e.target.value) || 1)) })} />
          <span role="button" className="nc-auto-pill" onClick={(e) => openKeepMenu(e.currentTarget, { width: 160, sections: [{ items: (Object.keys(FREQUENCY_LABELS) as Recurrence['frequency'][]).map((f) => ({ id: f, label: FREQUENCY_LABELS[f][plural], checked: r.frequency === f, onSelect: () => {
            const d = new Date(`${r.start}T00:00:00`);
            set({ frequency: f, weekdays: f === 'week' ? (r.weekdays?.length ? r.weekdays : [d.getDay()]) : undefined, month_day: f === 'month' || f === 'year' ? (r.month_day ?? d.getDate()) : undefined, month: f === 'year' ? (r.month ?? d.getMonth() + 1) : undefined });
          } })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
            <span>{FREQUENCY_LABELS[r.frequency][plural]}</span><Icon name="arrowChevronSingleDownSmall" size={14} />
          </span>
        </div>
        {r.frequency === 'week' && (
          <div className="nc-rec-row">
            <span className="nc-rec-label">On</span>
            <div className="nc-rec-days" role="group" aria-label="Weekdays">
              {order.map((d) => {
                const on = (r.weekdays ?? []).includes(d);
                return <span key={d} role="checkbox" aria-checked={on} aria-label={WEEKDAY_ABBR[d]} className={`nc-rec-day ${on ? 'on' : ''}`} onClick={() => { const cur = r.weekdays ?? []; const nextDays = on ? cur.filter((x) => x !== d) : [...cur, d]; set({ weekdays: nextDays.length ? nextDays : cur }); }}>{WEEKDAY_ABBR[d]}</span>;
              })}
            </div>
          </div>
        )}
        {(r.frequency === 'month' || r.frequency === 'year') && (
          <div className="nc-rec-row">
            <span className="nc-rec-label">On the</span>
            <span role="button" className="nc-auto-pill" onClick={(e) => openKeepMenu(e.currentTarget, { width: 160, maxHeight: 300, sections: [{ items: [
              ...Array.from({ length: 31 }, (_, i) => ({ id: String(i + 1), label: `Day ${i + 1}`, checked: r.month_day === i + 1, onSelect: () => set({ month_day: i + 1 }) })),
              { id: 'last', label: 'Last', checked: r.month_day === 'last', onSelect: () => set({ month_day: 'last' }) },
            ] }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
              <span>{r.month_day === 'last' ? 'Last day' : `Day ${r.month_day ?? 1}`}</span><Icon name="arrowChevronSingleDownSmall" size={14} />
            </span>
          </div>
        )}
        {r.frequency !== 'hour' && (
          <div className="nc-rec-row">
            <span className="nc-rec-label">At</span>
            {r.time ? (
              <input type="time" aria-label="Time" value={r.time} onChange={(e) => set({ time: e.target.value || undefined })} />
            ) : <span className="nc-auto-pill static"><span>Around midnight</span><span className="nc-auto-hint">12–3AM</span></span>}
            <span role="button" className="nc-auto-link" onClick={() => set({ time: r.time ? undefined : '09:00' })}>{r.time ? 'Around midnight' : 'Pick a time'}</span>
          </div>
        )}
        <div className="nc-rec-row">
          <span className="nc-rec-label">Starting</span>
          <input type="date" aria-label="Starting" value={r.start} onChange={(e) => e.target.value && set({ start: e.target.value })} />
        </div>
        <div className="nc-rec-row">
          <span className="nc-rec-label">Ending</span>
          <span role="button" className="nc-auto-pill" onClick={(e) => openKeepMenu(e.currentTarget, { width: 180, sections: [{ items: [
            { id: 'never', label: 'Never', checked: !r.end || r.end.type === 'never', onSelect: () => set({ end: { type: 'never' } }) },
            { id: 'count', label: 'Run count', checked: r.end?.type === 'count', onSelect: () => set({ end: { type: 'count', count: 10 } }) },
            { id: 'date', label: 'Specific date', checked: r.end?.type === 'date', onSelect: () => set({ end: { type: 'date', date: r.start } }) },
          ] }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
            <span>{r.end?.type === 'count' ? 'Run count' : r.end?.type === 'date' ? 'Specific date' : 'Never'}</span><Icon name="arrowChevronSingleDownSmall" size={14} />
          </span>
          {r.end?.type === 'count' && <input type="number" min={1} aria-label="Run count" value={r.end.count} onChange={(e) => set({ end: { type: 'count', count: Math.max(1, Number(e.target.value) || 1) } })} />}
          {r.end?.type === 'date' && <input type="date" aria-label="End date" value={r.end.date} onChange={(e) => e.target.value && set({ end: { type: 'date', date: e.target.value } })} />}
        </div>
        <div className="nc-rec-row">
          <span className="nc-rec-label">Timezone</span>
          <span role="button" className="nc-auto-pill" style={{ maxWidth: 190 }} onClick={(e) => openKeepMenu(e.currentTarget, { width: 260, search: 'Search timezones…', maxHeight: 320, sections: [{ items: zones().map((z) => ({ id: z, label: z.replace(/_/g, ' '), checked: z === r.time_zone, onSelect: () => set({ time_zone: z }) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
            <span>{r.time_zone.replace(/_/g, ' ')}</span><Icon name="arrowChevronSingleDownSmall" size={14} />
          </span>
        </div>
        <div className={`nc-rec-next ${next === null ? 'bad' : ''}`} aria-live="polite">
          {!valid ? 'Some required fields are missing' : next === null ? 'This workflow is set never to run' : <>Next occurrence: {formatOccurrence(next, r.time_zone)}</>}
        </div>
        <div className="nc-rec-foot">
          {onDelete ? <span role="button" className="nc-btn outline" onClick={() => { onDelete(); close(); }}>{deleteLabel ?? 'Cancel recurrence'}</span> : <span />}
          <span role="button" aria-disabled={!valid} className={`nc-btn primary ${valid ? '' : 'disabled'}`} onClick={() => { if (!valid) return; onSave(r); close(); }}>Save</span>
        </div>
      </div>
    </PopoverSurface>
  );
}

export function openRecurrenceEditor(anchor: Anchor, opts: { value: Recurrence | null; onSave: (r: Recurrence) => void; onDelete?: () => void; deleteLabel?: string; onClose?: () => void }) {
  return openOverlay((close) => <RecurrenceEditor {...opts} close={close} />, { anchor, placement: 'bottom-start', offset: 4, parent: anchor instanceof HTMLElement ? overlayIdOf(anchor) : undefined, onClose: opts.onClose });
}

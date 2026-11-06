// Trigger section of the automation builder: trigger menu and trigger cards.
// "Search triggers…", Event › Any field edited · Page added · Every…, Property › each property with a condition
// submenu), trigger cards with their condition pickers, "When Any/All triggers occur" for several triggers
//, and the "Every…" recurrence card.
import { useEffect, useState } from 'react';
import type { BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import {
  CONDITION_LABELS, TRIGGER_PROPERTY_TYPES, conditionOpsFor, conditionText, frequencyText, recurrenceLabel, type AutomationTrigger, type ConditionOp,
  type PropertyCondition, type TriggerEvent, type ValidationIssue,
} from '@nc/shared/automation/index.ts';
import { newId } from '@nc/shared/ids.ts';
import { records } from '../../../lib/store/records.ts';
import { api } from '../../../lib/api.ts';
import { useTableVersion } from '../../../lib/hooks.ts';
import { Icon, registerIcons } from '../../../components/Icon.tsx';
import type { MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { UserAvatar } from '../../presence/Avatar.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { OptionPill, StatusPill } from '../properties/ValueView.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { workspaceMembers } from '../properties/editors/MiscEditors.tsx';
import { openKeepMenu } from './keepMenu.ts';
import { openRecurrenceEditor } from './recurrence.tsx';
import * as L from 'lucide-react';

registerIcons({ arrowSquareLeftRight: L.Repeat2, cursorClick: L.MousePointerClick, gmail: L.Mail, slack: L.Hash });

function names() {
  return {
    user: (id: string) => records.get<any>('lit_user', id)?.name ?? 'Unknown',
    page: (id: string) => toPlainText(records.get<BlockRecord>('block', id)?.properties?.title) || 'Untitled',
  };
}

export function triggerableProps(collectionId: string | undefined): [string, PropertySchema][] {
  const schema = records.get<CollectionRecord>('collection', collectionId)?.schema ?? {};
  return Object.entries(schema).filter(([, p]) => TRIGGER_PROPERTY_TYPES.has(p.type)).sort((a, b) => (a[0] === 'title' ? -1 : b[0] === 'title' ? 1 : a[1].name.localeCompare(b[1].name)));
}

function defaultCondition(p: PropertySchema): PropertyCondition {
  switch (p.type) {
    case 'select': case 'status': return { op: 'is', values: [] };
    case 'multi_select': case 'person': case 'relation': return { op: 'contains', values: [] };
    case 'checkbox': return { op: 'is', values: ['checked'] };
    default: return { op: 'edited' };
  }
}

const hasValues = (t: string) => t !== 'date';

// ------------------------------------------------------------------ condition editor

function ConditionEditor({ prop, cond, onChange, close }: { prop: PropertySchema; cond: PropertyCondition; onChange: (c: PropertyCondition) => void; close: () => void }) {
  const [c, setC] = useState<PropertyCondition>(cond);
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<BlockRecord[]>([]);
  const update = (next: PropertyCondition) => { setC(next); onChange(next); };
  const vals = c.values ?? [];
  const toggle = (v: string, single = false) => update({ ...c, op: c.op === 'edited' ? (prop.type === 'select' || prop.type === 'status' || prop.type === 'checkbox' ? 'is' : 'contains') : c.op, values: single ? [v] : vals.includes(v) ? vals.filter((x) => x !== v) : [...vals, v] });
  useEffect(() => {
    if (prop.type !== 'relation') return;
    const cid = String(prop.collection_id ?? '');
    const local = () => records.all<BlockRecord>('block').filter((b) => b.parent_table === 'collection' && b.parent_id === cid && b.alive && !b.is_template);
    setPages(local());
    api('loadCollectionRows', { collectionId: cid }).then((res) => { records.mergeRecordMap(res.recordMap); setPages(local()); }).catch(() => {});
  }, [prop.type, prop.collection_id]);
  const ops = conditionOpsFor(prop.type);
  const ql = q.trim().toLowerCase();
  const textual = ['title', 'text', 'url', 'email', 'phone_number', 'number'].includes(prop.type);
  const row = (key: string, content: React.ReactNode, on: boolean, click: () => void) => (
    <div key={key} role="option" aria-selected={on} className="nc-auto-opt" onMouseDown={(e) => e.preventDefault()} onClick={click}>
      <span className={`nc-prop-checkbox ${on ? 'checked' : ''}`}>{on && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
      {content}
    </div>
  );
  let list: React.ReactNode[] = [];
  if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') {
    list = [row('any', <span className="grow">Any option</span>, !vals.length, () => update({ ...c, values: [] })),
      ...(prop.options ?? []).filter((o) => !ql || o.value.toLowerCase().includes(ql)).map((o) => row(o.id, prop.type === 'status' ? <StatusPill option={o} /> : <OptionPill option={o} />, vals.includes(o.value), () => toggle(o.value)))];
  } else if (prop.type === 'person') {
    list = [row('any', <span className="grow">Any person</span>, !vals.length, () => update({ ...c, values: [] })),
      ...workspaceMembers().filter((u) => !ql || `${u.name} ${u.email}`.toLowerCase().includes(ql)).map((u) => row(u.id, <><UserAvatar userId={u.id} size={20} /><span className="grow">{u.name || u.email}</span></>, vals.includes(u.id), () => toggle(u.id)))];
  } else if (prop.type === 'relation') {
    list = [row('any', <span className="grow">Any page</span>, !vals.length, () => update({ ...c, values: [] })),
      ...pages.filter((p) => !ql || (toPlainText(p.properties?.title) || 'Untitled').toLowerCase().includes(ql)).slice(0, 50).map((p) => row(p.id, <><PageIcon block={p} size={18} /><span className="grow">{toPlainText(p.properties?.title) || 'Untitled'}</span></>, vals.includes(p.id), () => toggle(p.id)))];
  } else if (prop.type === 'checkbox') {
    list = [row('checked', <span className="grow">Checked</span>, vals[0] === 'checked', () => toggle('checked', true)), row('unchecked', <span className="grow">Unchecked</span>, vals[0] === 'unchecked', () => toggle('unchecked', true))];
  }
  return (
    <PopoverSurface width={280} className="nc-auto-pop" maxHeight="60vh">
      <div className="nc-auto-pop-head" style={{ color: 'var(--lp-text-primary)' }}>
        <PropertyIcon prop={prop} size={14} /><span>{prop.name}</span>
        {ops.length > 1 && (
          <span role="button" className="nc-auto-mode-btn" onClick={(e) => openKeepMenu(e.currentTarget, { width: 200, sections: [{ items: ops.map((o) => ({ id: o, label: CONDITION_LABELS[o], checked: c.op === o, onSelect: () => update({ ...c, op: o as ConditionOp, values: o === 'edited' || o === 'cleared' ? [] : c.values }) })) }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>
            {prop.type === 'checkbox' ? 'set to' : CONDITION_LABELS[c.op]}<Icon name="arrowChevronSingleDownSmall" size={12} />
          </span>
        )}
      </div>
      {c.op !== 'edited' && c.op !== 'cleared' && (
        textual ? (
          <div style={{ padding: '0 8px 8px' }} data-menu-keys="ignore">
            <input autoFocus className="nc-auto-input" aria-label="Value" placeholder={prop.type === 'number' ? 'Number' : 'Type a value…'} inputMode={prop.type === 'number' ? 'decimal' : undefined} value={vals[0] ?? ''} onChange={(e) => update({ ...c, values: e.target.value ? [e.target.value] : [] })} onKeyDown={(e) => { if (e.key === 'Enter') close(); }} />
          </div>
        ) : (
          <>
            {list.length > 4 && <div className="nc-auto-pop-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>}
            <div className="nc-auto-pop-list">{list}</div>
          </>
        )
      )}
      <div className="nc-auto-pop-foot"><span role="button" className="nc-btn primary" onClick={close}>Done</span></div>
    </PopoverSurface>
  );
}

export function openConditionEditor(anchor: HTMLElement, opts: { prop: PropertySchema; cond: PropertyCondition; onChange: (c: PropertyCondition) => void; onClose?: () => void; placement?: 'right-start' | 'bottom-start' }) {
  return openOverlay((close) => <ConditionEditor {...opts} close={close} />, { anchor, placement: opts.placement ?? 'bottom-start', offset: 4, parent: overlayIdOf(anchor), onClose: opts.onClose });
}

// ------------------------------------------------------------------ trigger menu

export function openTriggerMenu(anchor: HTMLElement, opts: { collectionId: string; trigger: AutomationTrigger; onChange: (t: AutomationTrigger) => void }) {
  const t = opts.trigger;
  const events = t.type === 'event' ? t.events : [];
  const hasAny = events.some((e) => e.type === 'any_property_edited');
  const hasAdded = events.some((e) => e.type === 'page_added');
  const propEvents = events.filter((e) => e.type === 'property_edited');
  const mode = t.type === 'event' ? t.mode : 'any';
  const add = (ev: TriggerEvent) => opts.onChange({ type: 'event', mode, events: [...events, ev] });
  const eventItems: MenuItemDef[] = [];
  if (!hasAny) eventItems.push({ id: 'any', label: 'Any field edited', icon: 'pencilLine', onSelect: () => {
    if (propEvents.length) {
      void confirmDialog({ message: 'Replace the other triggers?', description: 'Adding the ‘Any field edited’ trigger replaces every other field trigger.', confirmLabel: 'Replace', danger: false }).then((ok) => {
        if (ok) opts.onChange({ type: 'event', mode, events: [...events.filter((e) => e.type !== 'property_edited'), { id: newId(), type: 'any_property_edited' }] });
      });
      return;
    }
    add({ id: newId(), type: 'any_property_edited' });
  } });
  if (!hasAdded) eventItems.push({ id: 'added', label: 'Page added', icon: 'plus', onSelect: () => add({ id: newId(), type: 'page_added' }) });
  if (!events.length) eventItems.push({ id: 'every', label: 'Every…', icon: 'arrowSquareLeftRight', onSelect: () => {
    opts.onChange({ type: 'recurrence', recurrence: null });
    // open the cadence editor on the new card
    setTimeout(() => (document.querySelector('[data-trigger-recurrence] .nc-auto-pill') as HTMLElement | null)?.click(), 50);
  } });
  const propItems: MenuItemDef[] = hasAny ? [] : triggerableProps(opts.collectionId).map(([pid, p]) => ({
    id: pid, label: p.name, icon: <PropertyIcon prop={p} size={16} />,
    right: hasValues(p.type) ? <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} /> : undefined,
    onSelect: () => {
      const ev: TriggerEvent = { id: newId(), type: 'property_edited', property: pid, condition: defaultCondition(p) };
      add(ev);
      if (hasValues(p.type)) setTimeout(() => (document.querySelector(`[data-trigger-id="${ev.id}"] .nc-auto-pill`) as HTMLElement | null)?.click(), 50);
    },
  }));
  return openKeepMenu(anchor, {
    width: 266, search: 'Search triggers…', emptyText: 'No results',
    sections: [
      ...(eventItems.length ? [{ title: 'Event', items: eventItems }] : []),
      ...(propItems.length ? [{ title: 'Property', items: propItems }] : []),
    ],
  }, { placement: 'bottom-start', offset: 0, parent: overlayIdOf(anchor), backdrop: 'transparent' });
}

// ------------------------------------------------------------------ section

export function TriggerSection({ collectionId, trigger, onChange, readOnly, issues }: { collectionId: string; trigger: AutomationTrigger; onChange: (t: AutomationTrigger) => void; readOnly?: boolean; issues?: ValidationIssue[] }) {
  useTableVersion(['collection']);
  const col = records.get<CollectionRecord>('collection', collectionId);
  const schema = col?.schema ?? {};
  const events = trigger.type === 'event' ? trigger.events : [];
  const mode = trigger.type === 'event' ? trigger.mode : 'any';
  const triggerIssue = issues?.find((i) => i.trigger);
  const setEvent = (id: string, ev: TriggerEvent) => onChange({ type: 'event', mode, events: events.map((e) => (e.id === id ? ev : e)) });
  const remove = (id: string) => onChange({ type: 'event', mode, events: events.filter((e) => e.id !== id) });
  const card = (key: string, icon: React.ReactNode, content: React.ReactNode, onRemove: () => void, extra?: Record<string, string>) => (
    <div key={key} className="nc-auto-card" {...extra}>
      <div className="nc-auto-card-head">
        <span className="nc-auto-card-icon">{icon}</span>
        <div className="nc-auto-card-title">{content}</div>
        {!readOnly && <div className="nc-auto-card-actions"><span role="button" className="nc-auto-icon-btn" aria-label="Delete trigger" data-tooltip="Delete trigger" onClick={onRemove}><Icon name="xMarkSmall" size={14} /></span></div>}
      </div>
    </div>
  );
  const cards: React.ReactNode[] = [];
  if (trigger.type === 'recurrence') {
    const r = trigger.recurrence;
    cards.push(card('rec', <Icon name="arrowSquareLeftRight" size={18} />, (
      <>
        <b>Every</b>
        <span role="button" className={`nc-auto-pill ${r ? '' : 'placeholder'}`} onClick={(e) => !readOnly && openRecurrenceEditor(e.currentTarget, { value: r, onSave: (rec) => onChange({ type: 'recurrence', recurrence: rec }), onDelete: () => onChange({ type: 'event', mode: 'any', events: [] }), deleteLabel: 'Delete trigger' })}>
          <span>{r ? frequencyText(r) : 'frequency'}</span><Icon name="arrowChevronSingleDownSmall" size={14} />
        </span>
        {r && <span className="nc-auto-hint" style={{ width: '100%' }}>{recurrenceLabel(r)}</span>}
      </>
    ), () => onChange({ type: 'event', mode: 'any', events: [] }), { 'data-trigger-recurrence': '1' }));
  }
  for (const ev of events) {
    if (ev.type === 'page_added') cards.push(card(ev.id, <Icon name="plus" size={18} />, <b>Page added</b>, () => remove(ev.id)));
    else if (ev.type === 'any_property_edited') cards.push(card(ev.id, <Icon name="pencilLine" size={18} />, <b>Any field edited</b>, () => remove(ev.id)));
    else {
      const prop = schema[ev.property];
      const text = conditionText(prop, ev.condition, names());
      cards.push(card(ev.id, prop ? <PropertyIcon prop={prop} size={16} /> : <Icon name="warning" size={16} />, (
        <span role="button" className="nc-auto-pill" style={{ whiteSpace: 'normal', height: 'auto', minHeight: 24 }} onClick={(e) => !readOnly && prop && hasValues(prop.type) && openConditionEditor(e.currentTarget, { prop, cond: ev.condition, onChange: (cond) => setEvent(ev.id, { ...ev, condition: cond }) })}>
          <span>{text}</span>{prop && hasValues(prop.type) && !readOnly && <Icon name="arrowChevronSingleDownSmall" size={14} />}
        </span>
      ), () => remove(ev.id), { 'data-trigger-id': ev.id }));
    }
  }
  return (
    <section className="nc-auto-section">
      <header className="nc-auto-section-head">
        {events.length > 1 ? (
          <>
            <span>When</span>
            <span role="button" className="nc-auto-mode-btn" onClick={(e) => !readOnly && openKeepMenu(e.currentTarget, { width: 160, sections: [{ items: [
              { id: 'any', label: 'Any', checked: mode === 'any', onSelect: () => onChange({ type: 'event', mode: 'any', events }) },
              { id: 'all', label: 'All', checked: mode === 'all', onSelect: () => onChange({ type: 'event', mode: 'all', events }) },
            ] }] }, { placement: 'bottom-start', parent: overlayIdOf(e.currentTarget), backdrop: 'transparent' })}>{mode === 'all' ? 'All' : 'Any'}<Icon name="arrowChevronSingleDownSmall" size={12} /></span>
            <span>triggers occur</span>
          </>
        ) : <span>When</span>}
      </header>
      <div style={{ position: 'relative', paddingInline: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {cards}
        {!readOnly && trigger.type !== 'recurrence' && (events.length === 0 ? (
          <div role="button" aria-label="Add trigger" aria-haspopup="dialog" className="nc-auto-add" onClick={(e) => openTriggerMenu(e.currentTarget, { collectionId, trigger, onChange })}>
            <span className="nc-auto-add-icon"><Icon name="plusSmall" size={16} /></span>
            <span className="nc-auto-add-label">New trigger</span>
          </div>
        ) : (
          <span role="button" aria-label="Add trigger" className="nc-auto-link" onClick={(e) => openTriggerMenu(e.currentTarget, { collectionId, trigger, onChange })}><Icon name="plusSmall" size={16} />Add trigger</span>
        ))}
        {triggerIssue && triggerIssue.message !== 'Add trigger' && <div className="nc-auto-card-error" style={{ margin: 0 }} role="alert"><Icon name="warning" size={14} /><span>{triggerIssue.message}</span></div>}
      </div>
    </section>
  );
}

/** Static "Button is clicked" card (button builders). */
export function ButtonTriggerSection() {
  return (
    <section className="nc-auto-section">
      <header className="nc-auto-section-head"><span>When</span></header>
      <div className="nc-auto-card"><div className="nc-auto-card-head"><span className="nc-auto-card-icon"><Icon name="cursorClick" size={18} /></span><div className="nc-auto-card-title"><span><b>Button</b> is clicked</span></div></div></div>
    </section>
  );
}

// Values in automation and button steps: labels of @ values, token fields, custom formulas, and typed property values.
// "@" mentions and "∑" custom formulas (titles, text, messages), and the typed value picker of a property edit
// ("Set Status to", "Add … to Tags", people incl. "Whoever triggered", relations incl. "Trigger page", dates incl.
// "Date triggered" / "Time triggered" / relative dates, checkbox incl. "Toggle").
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord, PropertySchema, UserRecord } from '@nc/shared/records.ts';
import { toPlainText, type DateValue } from '@nc/shared/richtext.ts';
import {
  ACTION_META, contextLabel, type AutomationAction, type ContextKey, type EditOp, type PropertyEdit, type ValueRef,
} from '@nc/shared/automation/index.ts';
import { encodeToken } from '@nc/shared/formula/index.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { api } from '../../../lib/api.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { UserAvatar } from '../../presence/Avatar.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { OptionPill, StatusPill } from '../properties/ValueView.tsx';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { DatePicker } from '../properties/editors/DatePicker.tsx';
import { workspaceMembers } from '../properties/editors/MiscEditors.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { formatDateValue } from '../../editor/inline/dates.ts';
import { openAutomationFormula } from './formulaField.tsx';

export type Surface = 'automation' | 'button_block' | 'button_property';

/** What a value editor needs to know about the step it belongs to. */
export interface EditorCtx {
  surface: Surface;
  /** data source of the automation / button property (the trigger page's database) */
  collectionId?: string;
  steps: AutomationAction[];
  /** index of the step being edited (earlier steps' pages and variables can be used) */
  stepIndex: number;
  /** button block id (insert blocks) */
  blockId?: string;
}

export const ctxSurface = (c: EditorCtx): 'automation' | 'button' => (c.surface === 'automation' ? 'automation' : 'button');

export function sourceSchema(c: EditorCtx): Record<string, PropertySchema> {
  return records.get<CollectionRecord>('collection', c.collectionId)?.schema ?? {};
}

function userName(id: string): string {
  const u = records.get<UserRecord>('lit_user', id);
  return u?.name || u?.email || 'Unknown';
}

export function stepNumber(c: EditorCtx, stepId: string): number {
  return c.steps.findIndex((s) => s.id === stepId) + 1;
}

/** Display of one value (chip label + icon). */
export function refLabel(ref: ValueRef, c: EditorCtx): { label: string; icon?: string } {
  switch (ref.type) {
    case 'text': return { label: ref.text };
    case 'option': return { label: ref.name };
    case 'user': return { label: userName(ref.id), icon: 'person' };
    case 'page': return { label: pageTitle(records.get<BlockRecord>('block', ref.id)) || 'Untitled', icon: 'page' };
    case 'date': return { label: formatDateValue(ref.date), icon: 'date' };
    case 'checkbox': return { label: ref.checked ? 'Checked' : 'Unchecked', icon: 'checkboxChecked' };
    case 'context': return { label: contextLabel(ref.key, ctxSurface(c)), icon: ref.key === 'page' ? 'page' : ref.key === 'actor' || ref.key === 'page_creator' ? 'person' : 'clock' };
    case 'relative_date': {
      const n = Math.abs(ref.amount);
      const unit = `${ref.unit}${n === 1 ? '' : 's'}`;
      if (ref.amount === 0) return { label: 'Today', icon: 'date' };
      return { label: ref.amount > 0 ? `${n} ${unit} from today` : `${n} ${unit} ago`, icon: 'date' };
    }
    case 'property': {
      const p = sourceSchema(c)[ref.property];
      return { label: `${contextLabel('page', ctxSurface(c))}’s ${p?.name ?? 'deleted property'}`, icon: 'page' };
    }
    case 'step': {
      const s = c.steps.find((x) => x.id === ref.step);
      const n = stepNumber(c, ref.step);
      return { label: s?.type === 'edit_pages' ? `Entries from step ${n}` : `Entry created in step ${n}`, icon: 'page' };
    }
    case 'variable': {
      const s = c.steps.find((x) => x.id === ref.step);
      const v = s?.type === 'define_variables' ? s.variables.find((x) => x.id === ref.variable) : undefined;
      return { label: v?.name || 'Variable', icon: 'formula' };
    }
    case 'formula': return { label: ref.name || 'My value' };
  }
}

/** Steps before the current one that produce pages / variables ("From this workflow"). */
export function earlierOutputs(c: EditorCtx): { pages: ValueRef[]; variables: ValueRef[] } {
  const pages: ValueRef[] = [];
  const variables: ValueRef[] = [];
  c.steps.slice(0, Math.max(0, c.stepIndex)).forEach((s) => {
    if (s.type === 'add_page' || s.type === 'edit_pages') pages.push({ type: 'step', step: s.id });
    if (s.type === 'define_variables') for (const v of s.variables) variables.push({ type: 'variable', step: s.id, variable: v.id });
  });
  return { pages, variables };
}

/** "@" context values available on this surface. */
export function contextKeys(c: EditorCtx): ContextKey[] {
  const trigger = c.steps.length >= 0; // always
  void trigger;
  const keys: ContextKey[] = ['page', 'actor'];
  if (c.surface === 'automation') keys.push('page_creator');
  keys.push('today', 'now');
  return keys;
}

// ------------------------------------------------------------------ "@" menu

interface MentionPick {
  (ref: ValueRef): void;
}

function MentionMenu({ c, onPick, close, kinds }: { c: EditorCtx; onPick: MentionPick; close: () => void; kinds?: ('context' | 'people' | 'pages' | 'dates' | 'steps' | 'properties')[] }) {
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<string[]>([]);
  const spaceId = useSession((s) => s.spaceId);
  const want = (k: string) => !kinds || kinds.includes(k as never);
  useEffect(() => {
    if (!want('pages')) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const res = q.trim() ? await api('searchWorkspace', { query: q.trim(), spaceId, limit: 10 }) : await api('listRecentPages', { spaceId, limit: 6 });
        if (!alive) return;
        records.mergeRecordMap(res.recordMap);
        setPages((q.trim() ? res.results.map((r: any) => r.id) : res.pages.map((p: any) => p.id)).slice(0, 8));
      } catch {
        /* offline */
      }
    }, 120);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, spaceId]);
  const ql = q.trim().toLowerCase();
  const match = (s: string) => !ql || s.toLowerCase().includes(ql);
  const pick = (r: ValueRef) => { onPick(r); close(); };
  const out = earlierOutputs(c);
  const schema = sourceSchema(c);
  const props = Object.entries(schema).filter(([, p]) => p.type !== 'button');
  const rows: ReactNode[] = [];
  const section = (title: string, items: ReactNode[]) => {
    if (!items.length) return;
    rows.push(<div key={`s-${title}`} className="nc-auto-pop-section">{title}</div>, ...items);
  };
  const opt = (key: string, icon: ReactNode, label: string, r: ValueRef, hint?: string) => (
    <div key={key} role="option" className="nc-auto-opt" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r)}>
      {icon}<span className="grow">{label}</span>{hint && <span className="nc-auto-hint">{hint}</span>}
    </div>
  );
  if (want('context')) {
    section('From this workflow'.replace('automation', c.surface === 'automation' ? 'automation' : 'button'), [
      ...contextKeys(c).filter((k) => match(contextLabel(k, ctxSurface(c)))).map((k) => opt(`c-${k}`, <Icon name={refLabel({ type: 'context', key: k }, c).icon ?? 'page'} size={18} />, contextLabel(k, ctxSurface(c)), { type: 'context', key: k })),
      ...(want('steps') ? [...out.pages, ...out.variables].filter((r) => match(refLabel(r, c).label)).map((r, i) => opt(`o-${i}`, <Icon name={refLabel(r, c).icon ?? 'page'} size={18} />, refLabel(r, c).label, r)) : []),
    ]);
  }
  if (want('properties') && c.collectionId) {
    section(`${contextLabel('page', ctxSurface(c))} properties`, props.filter(([, p]) => match(p.name)).slice(0, 30).map(([id, p]) => opt(`p-${id}`, <PropertyIcon prop={p} size={16} />, p.name, { type: 'property', property: id })));
  }
  if (want('people')) section('People', workspaceMembers().filter((u) => match(`${u.name ?? ''} ${u.email ?? ''}`)).slice(0, 8).map((u) => opt(`u-${u.id}`, <UserAvatar userId={u.id} size={20} />, u.name || u.email, { type: 'user', id: u.id })));
  if (want('pages')) section('Pages', pages.map((id) => opt(`g-${id}`, <PageIcon block={records.get<BlockRecord>('block', id)} size={18} />, pageTitle(records.get<BlockRecord>('block', id)) || 'Untitled', { type: 'page', id })));
  if (want('dates')) {
    const today = new Date();
    const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    section('Date', [
      ...(match('today') ? [opt('d-today', <Icon name="clock" size={18} />, 'Today', { type: 'date', date: { type: 'date', start_date: iso(today), date_format: 'relative' } }, 'fixed date')] : []),
      ...(match('tomorrow') ? [opt('d-tom', <Icon name="clock" size={18} />, 'Tomorrow', { type: 'date', date: { type: 'date', start_date: iso(new Date(today.getTime() + 864e5)), date_format: 'relative' } }, 'fixed date')] : []),
    ]);
  }
  return (
    <PopoverSurface width={300} className="nc-auto-pop" maxHeight="50vh">
      <div className="nc-auto-pop-search" style={{ paddingTop: 8 }} data-menu-keys="ignore">
        <div className="nc-input focused"><input autoFocus placeholder="Type to find…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }} /></div>
      </div>
      <div className="nc-auto-pop-list">{rows.length ? rows : <div className="nc-auto-pop-section">No results</div>}</div>
    </PopoverSurface>
  );
}

export function openMentionMenu(anchor: Anchor, c: EditorCtx, onPick: MentionPick, kinds?: ('context' | 'people' | 'pages' | 'dates' | 'steps' | 'properties')[]) {
  const parent = anchor instanceof HTMLElement ? overlayIdOf(anchor) : undefined;
  return openOverlay((close) => <MentionMenu c={c} onPick={onPick} close={close} kinds={kinds} />, { anchor, placement: 'bottom-start', offset: 4, parent });
}

// ------------------------------------------------------------------ token field (text with "@" values and "∑" formulas)

function chipText(ref: ValueRef, c: EditorCtx) {
  return refLabel(ref, c).label;
}

function renderInto(el: HTMLElement, value: ValueRef[], c: EditorCtx) {
  el.textContent = '';
  for (const r of value) {
    if (r.type === 'text') {
      el.append(document.createTextNode(r.text));
      continue;
    }
    const span = document.createElement('span');
    span.className = `nc-auto-chip${r.type === 'formula' ? ' formula' : ''}`;
    span.contentEditable = 'false';
    span.dataset.ref = JSON.stringify(r);
    span.textContent = chipText(r, c);
    el.append(span);
  }
}

function serialize(el: HTMLElement): ValueRef[] {
  const out: ValueRef[] = [];
  let buf = '';
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf });
    buf = '';
  };
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) { buf += n.textContent ?? ''; return; }
    if (!(n instanceof HTMLElement)) return;
    if (n.dataset.ref) {
      flush();
      try { out.push(JSON.parse(n.dataset.ref)); } catch { /* ignore */ }
      return;
    }
    if (n.tagName === 'BR') { buf += '\n'; return; }
    const block = n.tagName === 'DIV' || n.tagName === 'P';
    if (block && buf && !buf.endsWith('\n')) buf += '\n';
    n.childNodes.forEach(walk);
  };
  el.childNodes.forEach(walk);
  flush();
  return out;
}

/** Text field whose content mixes typed text with "@" values and "∑" formulas. */
export function RefsField({ value, onChange, c, placeholder, multiline, ariaLabel, mentionKinds }: { value: ValueRef[]; onChange: (v: ValueRef[]) => void; c: EditorCtx; placeholder?: string; multiline?: boolean; ariaLabel?: string; mentionKinds?: ('context' | 'people' | 'pages' | 'dates' | 'steps' | 'properties')[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const last = useRef<string>('');
  const composing = useRef(false);
  const json = JSON.stringify(value);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || json === last.current) return;
    renderInto(el, value, c);
    last.current = json;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json]);
  const emit = () => {
    const el = ref.current;
    if (!el || composing.current) return;
    const v = serialize(el);
    const j = JSON.stringify(v);
    last.current = j;
    onChange(v);
  };
  const insertRef = (r: ValueRef, range: Range | null, removeAt?: boolean) => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    let rg = range;
    if (!rg || !el.contains(rg.startContainer)) {
      rg = document.createRange();
      rg.selectNodeContents(el);
      rg.collapse(false);
    }
    if (removeAt && rg.startContainer.nodeType === Node.TEXT_NODE && rg.startOffset > 0 && rg.startContainer.textContent?.[rg.startOffset - 1] === '@') {
      const t = rg.startContainer as Text;
      t.deleteData(rg.startOffset - 1, 1);
      rg.setStart(t, rg.startOffset - 1);
    }
    const span = document.createElement('span');
    span.className = `nc-auto-chip${r.type === 'formula' ? ' formula' : ''}`;
    span.contentEditable = 'false';
    span.dataset.ref = JSON.stringify(r);
    span.textContent = chipText(r, c);
    rg.deleteContents();
    rg.insertNode(span);
    const after = document.createRange();
    after.setStartAfter(span);
    after.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(after);
    emit();
  };
  const caretRange = () => {
    const sel = window.getSelection();
    return sel && sel.rangeCount && ref.current?.contains(sel.anchorNode) ? sel.getRangeAt(0).cloneRange() : null;
  };
  const openAt = (removeAt: boolean) => {
    const rg = caretRange();
    const rect = rg?.getBoundingClientRect();
    const anchor = rect && rect.width + rect.height > 0 ? new DOMRect(rect.left, rect.top, rect.width, rect.height) : ref.current!;
    openMentionMenu(anchor, c, (r) => insertRef(r, rg, removeAt), mentionKinds);
  };
  const formula = (e: React.MouseEvent) => {
    const rg = caretRange();
    openAutomationFormula(e.currentTarget as HTMLElement, { c, initial: '', onSave: (src) => { if (src.trim()) insertRef({ type: 'formula', formula: src, name: 'My value' }, rg); } });
  };
  return (
    <div className="nc-auto-input nc-auto-refs" data-menu-keys="ignore">
      <div
        ref={ref}
        className="nc-auto-refs-edit"
        role="textbox"
        aria-label={ariaLabel}
        aria-multiline={multiline || undefined}
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder ?? ''}
        onInput={emit}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; emit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !multiline) { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); return; }
          if (e.key === 'Enter' && multiline && !e.shiftKey) {
            e.preventDefault();
            document.execCommand('insertLineBreak');
            emit();
          }
        }}
        onKeyUp={(e) => { if (e.key === '@') openAt(true); }}
        onClick={(e) => {
          const chip = (e.target as HTMLElement).closest?.('.nc-auto-chip.formula') as HTMLElement | null;
          if (!chip?.dataset.ref) return;
          const r = JSON.parse(chip.dataset.ref) as Extract<ValueRef, { type: 'formula' }>;
          openAutomationFormula(chip, { c, initial: r.formula, onSave: (src) => { chip.dataset.ref = JSON.stringify({ ...r, formula: src }); emit(); } });
        }}
        onPaste={(e) => {
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
      />
      <div className="nc-auto-refs-tools">
        <span role="button" className="nc-auto-refs-tool" aria-label="Mention" data-tooltip="Mention a value" onMouseDown={(e) => e.preventDefault()} onClick={() => openAt(false)}>@</span>
        <span role="button" className="nc-auto-refs-tool" aria-label="Custom formula" data-tooltip="Custom formula" onMouseDown={(e) => e.preventDefault()} onClick={formula}>∑</span>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ property edits

export const OP_LABELS: Record<EditOp, string> = { set: 'Replace with', add: 'Add', remove: 'Remove', toggle: 'Toggle', clear: 'Clear' };
const LIST_TYPES = new Set(['multi_select', 'person', 'relation']);

export function opsFor(prop: PropertySchema | undefined): EditOp[] {
  if (!prop) return ['set'];
  if (LIST_TYPES.has(prop.type)) return ['set', 'add', 'remove', 'toggle', 'clear'];
  if (prop.type === 'checkbox') return ['set', 'toggle'];
  return ['set', 'clear'];
}

/** Sentence for one edit: "Set Status to Done", "Add Bug to Tags", or "Clear Due". */
export function editSentence(prop: PropertySchema | undefined, e: PropertyEdit, c: EditorCtx): { before: string; values: ValueRef[]; after: string } {
  const name = prop?.name ?? 'a deleted property';
  if (e.op === 'clear') return { before: `Clear ${name}`, values: [], after: '' };
  if (e.op === 'toggle' && prop?.type === 'checkbox') return { before: `Toggle ${name}`, values: [], after: '' };
  if (e.op === 'add') return { before: 'Add', values: e.values, after: `to ${name}` };
  if (e.op === 'remove') return { before: 'Remove', values: e.values, after: `from ${name}` };
  if (e.op === 'toggle') return { before: 'Toggle', values: e.values, after: `in ${name}` };
  if (prop && LIST_TYPES.has(prop.type)) return { before: `Replace ${name} with`, values: e.values, after: '' };
  void c;
  return { before: `Set ${name} to`, values: e.values, after: '' };
}

function sameRef(a: ValueRef, b: ValueRef) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Typed value picker for a property edit. */
function ValuePicker({ c, prop, collectionId, edit, onChange, close }: { c: EditorCtx; prop: PropertySchema; collectionId: string; edit: PropertyEdit; onChange: (e: PropertyEdit) => void; close: () => void }) {
  const [e, setE] = useState(edit);
  const [q, setQ] = useState('');
  const [pages, setPages] = useState<BlockRecord[]>([]);
  const update = (next: PropertyEdit) => { setE(next); onChange(next); };
  const multi = LIST_TYPES.has(prop.type);
  const has = (r: ValueRef) => e.values.some((x) => sameRef(x, r));
  const toggle = (r: ValueRef) => {
    if (!multi) { update({ ...e, op: e.op === 'clear' ? 'set' : e.op, values: [r] }); close(); return; }
    update({ ...e, op: e.op === 'clear' ? 'set' : e.op, values: has(r) ? e.values.filter((x) => !sameRef(x, r)) : [...e.values, r] });
  };
  const ql = q.trim().toLowerCase();
  const match = (s: string) => !ql || s.toLowerCase().includes(ql);
  useEffect(() => {
    if (prop.type !== 'relation') return;
    const target = String(prop.collection_id ?? '');
    const local = records.all<BlockRecord>('block').filter((b) => b.parent_table === 'collection' && b.parent_id === target && b.alive && !b.is_template);
    setPages(local);
    api('loadCollectionRows', { collectionId: target }).then((res) => {
      records.mergeRecordMap(res.recordMap);
      setPages(records.all<BlockRecord>('block').filter((b) => b.parent_table === 'collection' && b.parent_id === target && b.alive && !b.is_template));
    }).catch(() => {});
  }, [prop.type, prop.collection_id]);
  const out = earlierOutputs(c);
  const opt = (key: string, icon: ReactNode, label: ReactNode, r: ValueRef, text?: string) => {
    if (!match(text ?? (typeof label === 'string' ? label : ''))) return null;
    const on = has(r);
    return (
      <div key={key} role="option" aria-selected={on} className="nc-auto-opt" onMouseDown={(ev) => ev.preventDefault()} onClick={() => toggle(r)}>
        {icon}<span className="grow">{label}</span>{on && <Icon name="check" size={16} className="check" />}
      </div>
    );
  };
  const rows: ReactNode[] = [];
  const sec = (title: string, items: (ReactNode | null)[]) => {
    const list = items.filter(Boolean);
    if (list.length) rows.push(<div key={`s-${title}`} className="nc-auto-pop-section">{title}</div>, ...list);
  };
  const t = prop.type;
  if (t === 'select' || t === 'multi_select' || t === 'status') {
    sec('Options', (prop.options ?? []).map((o) => opt(o.id, t === 'status' ? <StatusPill option={o} /> : <OptionPill option={o} />, '', { type: 'option', name: o.value }, o.value)));
  } else if (t === 'person') {
    sec('From this workflow', [opt('actor', <Icon name="person" size={18} />, contextLabel('actor', ctxSurface(c)), { type: 'context', key: 'actor' }), ...(c.surface === 'automation' ? [opt('creator', <Icon name="person" size={18} />, 'Page creator', { type: 'context', key: 'page_creator' })] : [])]);
    sec('People', workspaceMembers().map((u) => opt(u.id, <UserAvatar userId={u.id} size={20} />, u.name || u.email, { type: 'user', id: u.id }, `${u.name} ${u.email}`)));
  } else if (t === 'relation') {
    const sameDb = prop.collection_id === c.collectionId;
    sec('From this workflow', [
      ...(sameDb ? [opt('page', <Icon name="page" size={18} />, contextLabel('page', ctxSurface(c)), { type: 'context', key: 'page' })] : []),
      ...out.pages.map((r, i) => opt(`st${i}`, <Icon name="page" size={18} />, refLabel(r, c).label, r)),
    ]);
    sec('Pages', pages.slice(0, 50).map((p) => opt(p.id, <PageIcon block={p} size={18} />, toPlainText(p.properties?.title) || 'Untitled', { type: 'page', id: p.id })));
  } else if (t === 'checkbox') {
    sec('Value', [
      opt('on', <Icon name="checkboxChecked" size={18} />, 'Checked', { type: 'checkbox', checked: true }),
      opt('off', <Icon name="checkbox" size={18} />, 'Unchecked', { type: 'checkbox', checked: false }),
    ]);
  } else if (t === 'date') {
    sec('From this workflow', [
      opt('today', <Icon name="date" size={18} />, contextLabel('today', ctxSurface(c)), { type: 'context', key: 'today' }),
      opt('now', <Icon name="clock" size={18} />, contextLabel('now', ctxSurface(c)), { type: 'context', key: 'now' }),
    ]);
    sec('Relative', [
      opt('tomorrow', <Icon name="date" size={18} />, 'Tomorrow', { type: 'relative_date', amount: 1, unit: 'day' }),
      opt('yesterday', <Icon name="date" size={18} />, 'Yesterday', { type: 'relative_date', amount: -1, unit: 'day' }),
      opt('week', <Icon name="date" size={18} />, 'One week from today', { type: 'relative_date', amount: 1, unit: 'week' }),
      opt('weekago', <Icon name="date" size={18} />, 'A week ago', { type: 'relative_date', amount: -1, unit: 'week' }),
      opt('month', <Icon name="date" size={18} />, 'One month from today', { type: 'relative_date', amount: 1, unit: 'month' }),
    ]);
  }
  const fixedDate = e.values.find((r) => r.type === 'date') as Extract<ValueRef, { type: 'date' }> | undefined;
  const typed = ['number', 'title', 'text', 'url', 'email', 'phone_number', 'file'].includes(t);
  const ops = opsFor(prop);
  return (
    <PopoverSurface width={300} className="nc-auto-pop" maxHeight="60vh">
      <div className="nc-auto-pop-head"><PropertyIcon prop={prop} size={14} />{e.op === 'set' && !multi ? `Set ${prop.name} to` : `Edit ${prop.name}`}</div>
      {ops.length > 1 && (
        <div className="nc-auto-pop-tabs" role="tablist">
          {ops.map((op) => (
            <span key={op} role="tab" aria-selected={e.op === op} className={`nc-auto-pop-tab ${e.op === op ? 'on' : ''}`} onClick={() => update({ ...e, op, values: op === 'clear' || (op === 'toggle' && t === 'checkbox') ? [] : e.values })}>
              {op === 'set' && !multi ? 'Set to' : OP_LABELS[op]}
            </span>
          ))}
        </div>
      )}
      {e.op !== 'clear' && !(e.op === 'toggle' && t === 'checkbox') && (
        <>
          {typed ? (
            <div style={{ padding: '0 8px 8px' }}>
              <RefsField c={c} value={e.values} onChange={(v) => update({ ...e, op: 'set', values: v })} placeholder={t === 'number' ? 'Number or ∑ formula' : 'Type a value, @ to mention'} ariaLabel={`${prop.name} value`} multiline={t === 'text'} />
            </div>
          ) : (
            <>
              {['select', 'multi_select', 'status', 'person', 'relation'].includes(t) && (
                <div className="nc-auto-pop-search" data-menu-keys="ignore"><div className="nc-input focused"><input autoFocus placeholder="Search…" value={q} onChange={(ev) => setQ(ev.target.value)} /></div></div>
              )}
              <div className="nc-auto-pop-list">{rows}</div>
              {t === 'date' && (
                <div style={{ padding: '0 4px 4px' }} data-menu-keys="ignore">
                  <div className="nc-auto-pop-section">Specific date</div>
                  <DatePicker simple value={fixedDate?.date ?? null} onChange={(d: DateValue | null) => update({ ...e, op: 'set', values: d ? [{ type: 'date', date: d }] : [] })} />
                </div>
              )}
            </>
          )}
          <div className="nc-auto-pop-foot" style={{ justifyContent: 'space-between' }}>
            <span role="button" className="nc-auto-link" onClick={(ev) => openAutomationFormula(ev.currentTarget as HTMLElement, { c, initial: (e.values.find((v) => v.type === 'formula') as any)?.formula ?? '', onSave: (src) => { if (src.trim()) update({ ...e, op: e.op === 'clear' ? 'set' : e.op, values: [{ type: 'formula', formula: src, name: 'My value' }] }); } })}>
              <span style={{ fontWeight: 600 }}>∑</span> Custom formula
            </span>
            <span role="button" className="nc-btn primary" onClick={close}>Done</span>
          </div>
        </>
      )}
      {(e.op === 'clear' || (e.op === 'toggle' && t === 'checkbox')) && <div className="nc-auto-pop-foot"><span role="button" className="nc-btn primary" onClick={close}>Done</span></div>}
      {void collectionId}
    </PopoverSurface>
  );
}

export function openValuePicker(anchor: HTMLElement, opts: { c: EditorCtx; prop: PropertySchema; collectionId: string; edit: PropertyEdit; onChange: (e: PropertyEdit) => void }) {
  return openOverlay((close) => <ValuePicker {...opts} close={close} />, { anchor, placement: 'bottom-start', offset: 4, parent: overlayIdOf(anchor) });
}

/** Chips showing the values of an edit. */
export function ValueChips({ values, c, prop }: { values: ValueRef[]; c: EditorCtx; prop?: PropertySchema }) {
  if (!values.length) return <span className="nc-auto-pill placeholder"><span>Empty</span></span>;
  return (
    <>
      {values.map((r, i) => {
        if (r.type === 'option' && prop?.options) {
          const o = prop.options.find((x) => x.value === r.name) ?? { id: '', value: r.name, color: 'default' };
          return prop.type === 'status' ? <StatusPill key={i} option={o} /> : <OptionPill key={i} option={o} />;
        }
        if (r.type === 'user') return <span key={i} className="nc-auto-pill static"><UserAvatar userId={r.id} size={18} /><span>{userName(r.id)}</span></span>;
        if (r.type === 'text') return <span key={i} className="nc-auto-pill static"><span>{r.text}</span></span>;
        const l = refLabel(r, c);
        return <span key={i} className={`nc-auto-chip${r.type === 'formula' ? ' formula' : ''}`}>{r.type !== 'formula' && l.icon && <Icon name={l.icon} size={12} />}{l.label}</span>;
      })}
    </>
  );
}

/** Menu of a step's editable properties (Edit property… › / Edit another property). */
export function editablePropsOf(collectionId: string | undefined): [string, PropertySchema][] {
  const schema = records.get<CollectionRecord>('collection', collectionId)?.schema ?? {};
  const allowed = new Set(['title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone_number', 'relation', 'file']);
  return Object.entries(schema).filter(([, p]) => allowed.has(p.type)).sort((a, b) => (a[0] === 'title' ? -1 : b[0] === 'title' ? 1 : a[1].name.localeCompare(b[1].name)));
}

export function defaultEditFor(propId: string, prop: PropertySchema): PropertyEdit {
  if (prop.type === 'checkbox') return { property: propId, op: 'set', values: [{ type: 'checkbox', checked: true }] };
  return { property: propId, op: 'set', values: [] };
}

export { ACTION_META, encodeToken };

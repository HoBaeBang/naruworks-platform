import { HELP_URL } from '@nc/shared/brand.ts';
// Automations of a data source (/002/024.4): ⚡ toolbar popover and View settings › Automations.
// Summary cards ("When {triggers}, {actions}" / "Every {frequency}, {actions}", tokens Paused / Failing / Completed),
// card ••• menu (Active, Edit, Duplicate, Delete), search, "New automation", empty and read-only states
// With no automations yet, ⚡ opens the builder directly.
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, UserRecord } from '@nc/shared/records.ts';
import { automationCaption, type AutomationRecord } from '@nc/shared/automation/index.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { confirmDialog } from '../../page/confirm.tsx';
import { Toggle } from '../properties/editors/DatePicker.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { automationAccess, automationRuns, deleteAutomation, duplicateAutomation, loadAutomations, setAutomationStatus, useAutomations } from './api.ts';
import { openAutomationBuilder } from './builder.tsx';
import './automations.css';
import { openKeepMenu } from './keepMenu.ts';

export function automationDisplayName(a: AutomationRecord): string {
  if (a.properties?.name) return a.properties.name;
  const u = records.get<UserRecord>('lit_user', a.created_by_id);
  return u?.name ? `${u.name}’s automation` : 'Automation';
}

function caption(a: AutomationRecord): string {
  const col = records.get<CollectionRecord>('collection', a.parent_id);
  return automationCaption(a.trigger, a.actions, {
    collectionId: a.parent_id,
    schema: col?.schema ?? {},
    user: (id) => records.get<UserRecord>('lit_user', id)?.name ?? '',
    page: (id) => ((records.get<BlockRecord>('block', id)?.properties?.title ?? []) as string[][]).map((d) => d[0]).join('') || 'Untitled',
    collection: (id) => ((records.get<CollectionRecord>('collection', id)?.name ?? []) as string[][]).map((d) => d[0]).join('') || 'Untitled',
  });
}

function statusToken(a: AutomationRecord): { label: string; cls: string } | null {
  if (a.status === 'completed') return { label: 'Completed', cls: 'completed' };
  if (a.status === 'paused' && a.last_error) return { label: 'Failing', cls: 'failing' };
  if (a.status === 'paused') return { label: 'Paused', cls: 'paused' };
  return null;
}

function cardMenu(anchor: HTMLElement, a: AutomationRecord, canEdit: boolean, onOpen: () => void, onMenu: (open: boolean) => void) {
  onMenu(true);
  const active = a.status === 'active';
  openKeepMenu(anchor, {
    width: 240,
    sections: [
      ...(canEdit ? [{ items: [{
        id: 'active', label: 'Active', icon: 'lightning',
        right: <Toggle on={active} decorative />,
        onSelect: () => {
          setAutomationStatus(a.id, active ? 'paused' : 'active').then(() => {
            if (!active && a.last_error) useUI.getState().toast('Workflow restarted successfully');
          }).catch((e) => useUI.getState().toast(e?.message || 'Fix any errors or remove failing steps to enable this workflow'));
        },
      }] }] : []),
      { items: [
        { id: 'edit', label: canEdit ? 'Edit' : 'View', icon: 'pencilLine', onSelect: () => openAutomationBuilder(a.parent_id, a.id) },
        ...(canEdit ? [
          { id: 'dup', label: 'Duplicate', icon: 'duplicate', onSelect: () => void duplicateAutomation(a.id).catch((e) => useUI.getState().toast(e?.message || 'Could not duplicate')) },
          { id: 'del', label: 'Delete', icon: 'trash', onSelect: async () => { if (await confirmDialog({ message: `Delete ${automationDisplayName(a)}?`, confirmLabel: 'Delete' })) await deleteAutomation(a.id); } },
        ] : []),
      ] },
      { items: [{ id: 'runs', label: 'Recent runs', icon: 'history', onSelect: () => { void openRuns(anchor, a); } }] },
    ],
  }, { placement: 'bottom-end', parent: overlayIdOf(anchor), backdrop: 'transparent', onClose: () => onMenu(false) });
  void onOpen;
}

async function openRuns(anchor: HTMLElement, a: AutomationRecord) {
  const runs = await automationRuns(a.id).catch(() => []);
  openOverlay(() => (
    <PopoverSurface width={300} className="nc-auto-pop">
      <div className="nc-auto-pop-head">Recent runs</div>
      <div className="nc-auto-pop-list nc-autoruns" style={{ padding: '0 12px 10px' }}>
        {!runs.length && <div className="nc-auto-hint">This automation hasn’t run yet.</div>}
        {runs.map((r) => (
          <div key={r.id} className={`nc-autorun ${r.status}`}>
            <span className="dot" />
            <span>{new Date(r.time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <span style={{ color: r.status === 'error' ? 'var(--lp-red-text-secondary, #c4554d)' : 'var(--lp-text-tertiary)' }}>{r.status === 'success' ? 'Completed' : r.status === 'error' ? r.message ?? 'Failed' : r.message ?? 'Skipped'}</span>
          </div>
        ))}
      </div>
    </PopoverSurface>
  ), { anchor, placement: 'left-start', offset: 6, parent: overlayIdOf(anchor) });
}

function SummaryCard({ a, canEdit }: { a: AutomationRecord; canEdit: boolean }) {
  const [menu, setMenu] = useState(false);
  const token = statusToken(a);
  return (
    <div className="nc-autocard" role="button" data-automation-id={a.id} onClick={(e) => { if ((e.target as HTMLElement).closest('.nc-autocard-more')) return; openAutomationBuilder(a.parent_id, a.id); }}>
      <span className="nc-autocard-icon"><Icon name={a.trigger.type === 'recurrence' ? 'arrowSquareLeftRight' : 'lightning'} size={16} /></span>
      <div className="nc-autocard-text">
        <div className="nc-autocard-name"><span>{automationDisplayName(a)}</span>{token && <span className={`nc-autocard-token ${token.cls}`}>{token.label}</span>}</div>
        <div className="nc-autocard-caption">{caption(a)}</div>
        {a.status === 'paused' && a.last_error && <div className="nc-autocard-caption" style={{ color: 'var(--lp-red-text-secondary, #c4554d)' }}>{a.last_error.message}</div>}
      </div>
      <span role="button" className={`nc-auto-icon-btn nc-autocard-more ${menu ? 'open' : ''}`} aria-label="More" data-tooltip="More" onClick={(e) => { e.stopPropagation(); cardMenu(e.currentTarget, a, canEdit, () => {}, setMenu); }}>
        <Icon name="ellipsisSmall" size={16} />
      </span>
    </div>
  );
}

export function AutomationsList({ collectionId, onNew, header }: { collectionId: string; onNew?: () => void; header?: boolean }) {
  const { list, access } = useAutomations(collectionId);
  const [q, setQ] = useState('');
  const canEdit = !!access?.canEdit;
  const shown = list.filter((a) => !q.trim() || `${automationDisplayName(a)} ${caption(a)}`.toLowerCase().includes(q.trim().toLowerCase()));
  const newAutomation = () => { onNew?.(); openAutomationBuilder(collectionId); };
  return (
    <div className="nc-autolist">
      {header && <div className="nc-autolist-head"><span>Automations</span></div>}
      {list.length > 5 && <div className="nc-autolist-search" data-menu-keys="ignore"><div className="nc-input"><input placeholder="Search automations…" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>}
      {list.length === 0 ? (
        <div className="nc-autolist-empty">
          <span>{access && !access.canEdit ? (access.role === 'read_and_write' || access.role === 'content_only_editor' ? 'You can edit entries, but full access is required to create workflows.' : access.editProblem === 'Join this workspace before editing automations' ? access.editProblem : 'View-only users cannot create workflows.') : 'Update fields, create entries, send notices, and more'}</span>
        </div>
      ) : (
        <div className="nc-autolist-items">
          {shown.map((a) => <SummaryCard key={a.id} a={a} canEdit={canEdit} />)}
          {!shown.length && <div className="nc-auto-pop-section">No results</div>}
        </div>
      )}
      <div className="nc-autolist-foot">
        {canEdit && (
          <div role="menuitem" className="nc-menu-item" onClick={newAutomation}>
            <div className="nc-menu-item-inner nc-mi"><div className="nc-menu-icon"><Icon name="plus" size={20} /></div><div className="nc-menu-label">New automation</div></div>
          </div>
        )}
        {HELP_URL && <a role="menuitem" className="nc-menu-item" href={HELP_URL} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="nc-menu-item-inner nc-mi"><div className="nc-menu-icon"><Icon name="questionMarkCircle" size={20} /></div><div className="nc-menu-label">Explore workflows</div></div>
        </a>}
      </div>
    </div>
  );
}

/** ⚡ toolbar button / View settings › Automations entry point. */
export async function openAutomations(collection: CollectionRecord, anchor?: HTMLElement | null) {
  const access = await loadAutomations(collection.id).catch(() => automationAccess(collection.id));
  const existing = records.all<AutomationRecord>('automation').filter((a) => a.parent_id === collection.id && a.alive !== false && !a.template_id);
  if (!existing.length && access?.canEdit) return openAutomationBuilder(collection.id);
  return openOverlay((close) => (
    <PopoverSurface width={340} className="nc-autolist-pop" maxHeight="70vh">
      <AutomationsList collectionId={collection.id} header onNew={close} />
    </PopoverSurface>
  ), { anchor: anchor ?? undefined, placement: anchor ? 'bottom-end' : 'center', offset: 4 });
}

/** View settings › Automations: the list sub-page, or the builder when the data source has none yet. */
export async function automationsEntry(collection: CollectionRecord, showList: () => void) {
  const access = await loadAutomations(collection.id).catch(() => automationAccess(collection.id));
  const existing = records.all<AutomationRecord>('automation').filter((a) => a.parent_id === collection.id && a.alive !== false && !a.template_id);
  if (!existing.length && access?.canEdit) openAutomationBuilder(collection.id);
  else showList();
}

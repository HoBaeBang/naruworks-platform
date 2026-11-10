import { HELP_URL } from '@nc/shared/brand.ts';
// Sprints UI: View settings › More settings › Sprints (set up / settings / turn off), the "Complete sprint" toolbar
// button of sprint views and its summary modal.
import { useState } from 'react';
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { dayIndex, dayString, sprintDatesOf, sprintStatusOf, sprintSummary, type SprintSettings } from '@nc/shared/database/index.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay } from '../../../components/overlay.tsx';
import { useCollection } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { openPage } from '../../../lib/router.ts';
import { confirmDialog } from '../../page/confirm.tsx';
import { useDatabaseVersion } from '../data.ts';
import { VSRow as Row, VSSection as Section, VSToggleRow as ToggleRow, vsPick as pick } from '../chrome/ViewSettings.tsx';
import { completeSprint, manageSprintFromView, sprintInfo, sprintRows, todayStr, turnOffSprints, turnOnSprints, updateSprintSettings } from './sprints.ts';
import './sprints.css';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const INCOMPLETE: { id: SprintSettings['incomplete_tasks']; label: string; short: string }[] = [
  { id: 'next_sprint', label: 'Send to the next sprint', short: 'Next sprint' },
  { id: 'backlog', label: 'Send to the backlog', short: 'Backlog' },
  { id: 'current_sprint', label: 'Stay in the current sprint', short: 'Current sprint' },
];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** "Next sprint starts in N days (date)" line for the settings panel. */
function nextStartLine(tasks: CollectionRecord): string | null {
  const info = sprintInfo(tasks);
  if (!info) return null;
  const cur = sprintRows(info).sprints.find((r) => sprintStatusOf(r, info) === 'Current');
  const dates = sprintDatesOf(cur, info);
  if (!dates) return null;
  const startNext = dayIndex(dates.end) + 1;
  const days = startNext - dayIndex(todayStr());
  if (days === 0) return 'Next sprint should start today';
  return days > 0 ? `Next sprint starts in ${days} ${days === 1 ? 'day' : 'days'} (${fmtDate(dayString(startNext))})` : `Next sprint should have started ${-days} ${days === -1 ? 'day' : 'days'} ago (${fmtDate(dayString(startNext))})`;
}

export function SprintSettingsBody({ collection, view, readOnly, closePanel }: { collection: CollectionRecord; view: CollectionViewRecord; block: BlockRecord; readOnly: boolean; closePanel: () => void }) {
  useDatabaseVersion();
  const c = useCollection(collection.id) ?? collection;
  const info = sprintInfo(c);
  if (!info) {
    return (
      <>
        <div className="nc-rf-desc">Sprints organize tasks into recurring time windows.</div>
        <div className="nc-rf-desc">We’ll also add this to your team:</div>
        <ul className="nc-sprint-setup-list">
          <li><b>Sprint board</b>: To manage tasks and plan your work</li>
          <li><b>Sprints database</b>: To keep a historical record of what you accomplished</li>
        </ul>
        <div className="nc-rf-cta"><div role="button" data-testid="turn-on-sprints" className={`nc-btn primary nc-rf-cta-btn ${readOnly ? 'disabled' : ''}`} onClick={() => {
          if (readOnly) return;
          const res = turnOnSprints(c);
          closePanel();
          if (res) openPage(res.boardId);
        }}>Enable sprints</div></div>
        {HELP_URL && <Section divider><Row icon="questionMarkCircle" label="Explore sprints" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} /></Section>}
      </>
    );
  }
  const s = info.settings;
  const line = nextStartLine(c);
  return (
    <>
      <Section className="nc-vs-sec first">
        <Row label="Duration" value={`${s.duration_weeks} ${s.duration_weeks === 1 ? 'week' : 'weeks'}`} disabled={readOnly} onClick={(e) => pick(e.currentTarget, [1, 2, 3, 4, 5, 6, 7, 8].map((w) => ({ id: String(w), label: `${w} ${w === 1 ? 'week' : 'weeks'}`, checked: s.duration_weeks === w, onSelect: () => updateSprintSettings(c, { duration_weeks: w }) })))} />
        <Row label="Start on" value={`${WEEKDAYS[s.start_day]}s`} disabled={readOnly} onClick={(e) => pick(e.currentTarget, WEEKDAYS.map((d, i) => ({ id: d, label: `${d}s`, checked: s.start_day === i, onSelect: () => updateSprintSettings(c, { start_day: i }) })))} />
        {line && <div className="nc-rf-caption">{line}</div>}
        <Row label="Incomplete tasks" value={INCOMPLETE.find((x) => x.id === s.incomplete_tasks)?.short} disabled={readOnly} onClick={(e) => pick(e.currentTarget, INCOMPLETE.map((o) => ({ id: o.id, label: o.label, checked: s.incomplete_tasks === o.id, onSelect: () => updateSprintSettings(c, { incomplete_tasks: o.id }) })))} />
        <ToggleRow label="Automated sprints" on={s.automated} disabled={readOnly} onChange={(v) => updateSprintSettings(c, { automated: v })} />
        <div className="nc-rf-caption">Sprints finish automatically before the next sprint starts.</div>
      </Section>
      <Section divider>
        <Row label="Manage this layout’s sprint" chevron={false} disabled={readOnly || (view.format as Record<string, unknown>)?.sprint_view === 'current'} onClick={async () => {
          const ok = await confirmDialog({ message: 'Manage this layout’s sprint?', description: s.automated ? 'The layout will be updated with filters for the current sprint.' : 'The layout will be updated with filters for the current sprint and a button to complete sprints will be displayed.', confirmLabel: 'Update view', danger: false });
          if (ok) manageSprintFromView(view, c);
        }} />
        {HELP_URL && <Row icon="questionMarkCircle" label="Explore sprints" chevron={false} onClick={() => window.open(HELP_URL!, '_blank', 'noopener')} />}
        <Row icon="trash" label="Disable sprints" chevron={false} disabled={readOnly} testid="turn-off-sprints" onClick={async () => {
          const ok = await confirmDialog({ message: 'Disable sprints?', description: 'This removes your sprint board(s), sprint table, and linked layouts.', confirmLabel: 'Disable and remove' });
          if (ok) {
            turnOffSprints(c);
            closePanel();
          }
        }} />
      </Section>
    </>
  );
}

// ------------------------------------------------------------------ Complete sprint

function CompleteSprintModal({ tasksId, close }: { tasksId: string; close: () => void }) {
  useDatabaseVersion();
  const tasks = useCollection(tasksId);
  const info = sprintInfo(tasks);
  const [incomplete, setIncomplete] = useState<SprintSettings['incomplete_tasks'] | null>(null);
  if (!tasks || !info) return null;
  const rows = sprintRows(info);
  const current = rows.sprints.find((r) => sprintStatusOf(r, info) === 'Current');
  const next = rows.sprints.find((r) => sprintStatusOf(r, info) === 'Next');
  if (!current) {
    return (
      <div className="nc-sprint-modal" role="dialog" aria-label="Complete sprint">
        <div className="nc-sprint-modal-title">There is no current sprint</div>
        <div className="nc-sprint-modal-foot">
          <div role="button" className="nc-btn outline" onClick={close}>Cancel</div>
          <div role="button" className="nc-btn primary" onClick={() => { close(); openPage(info.sprints.parent_id); }}>Fix in Sprints table</div>
        </div>
      </div>
    );
  }
  const name = toPlainText(current.properties?.title as never) || 'Sprint';
  const sum = sprintSummary(info, current.id, rows.tasks);
  const choice = incomplete ?? info.settings.incomplete_tasks;
  const nextDates = sprintDatesOf(next, info);
  return (
    <div className="nc-sprint-modal" role="dialog" aria-label={`${name} summary`} data-menu-keys="ignore">
      <div className="nc-sprint-modal-title">{`${name} summary`}</div>
      <div className="nc-sprint-modal-summary">
        <Icon name="checkmarkSquare" size={16} />
        <span data-testid="sprint-summary">{`${sum.completed} / ${sum.total} total tasks`}</span>
      </div>
      {sum.incomplete > 0 && (
        <div className="nc-sprint-modal-row">
          <div className="nc-sprint-modal-label">{`${sum.incomplete} ${sum.incomplete === 1 ? 'incomplete task' : 'incomplete tasks'}`}</div>
          <div role="button" className="nc-tt-select" data-testid="sprint-incomplete" onClick={(e) => pick(e.currentTarget, INCOMPLETE.map((o) => ({ id: o.id, label: o.label, checked: choice === o.id, onSelect: () => setIncomplete(o.id) })), 240)}>
            <span className="nc-tt-select-label">{INCOMPLETE.find((x) => x.id === choice)?.label}</span>
            <Icon name="chevronDown" size={14} />
          </div>
        </div>
      )}
      <div className="nc-sprint-modal-row">
        <div className="nc-sprint-modal-label">Dates for the next sprint</div>
        <div className="nc-sprint-modal-dates">{nextDates ? `${fmtDate(nextDates.start)} → ${fmtDate(nextDates.end)}` : 'Select dates'}</div>
      </div>
      <div className="nc-sprint-modal-foot">
        <div role="button" className="nc-btn outline" onClick={close}>Cancel</div>
        <div role="button" className="nc-btn primary" data-testid="complete-sprint-confirm" onClick={() => { completeSprint(tasks, { incomplete: choice }); close(); }}>{`Complete ${name}`}</div>
      </div>
    </div>
  );
}

export function openCompleteSprint(tasksCollectionId: string) {
  return openOverlay((close) => <CompleteSprintModal tasksId={tasksCollectionId} close={close} />, { placement: 'center', backdrop: 'dim' });
}

/** Toolbar "Complete sprint" button of a view managed as the current sprint (format.sprint_view = 'current'). */
export function SprintToolbarButton({ view, collection, readOnly }: { view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean }) {
  if ((view.format as Record<string, unknown> | undefined)?.sprint_view !== 'current' || readOnly || !sprintInfo(records.get<CollectionRecord>('collection', collection.id))) return null;
  return (
    <div role="button" className="nc-btn outline nc-sprint-complete-btn" data-testid="complete-sprint" onClick={() => openCompleteSprint(collection.id)}>
      <Icon name="checkmarkSquare" size={14} />
      <span>Complete sprint</span>
    </div>
  );
}

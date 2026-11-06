import { HELP_URL } from '@nc/shared/brand.ts';
// "Turn into Tasks database" dialog (CollectionTypedDatabaseMigrationModal): pick the properties that represent status,
// assignee and due date ("Create new" when missing), preview of My Tasks, "Turn into task database".
import { useState } from 'react';
import type { CollectionRecord } from '@nc/shared/records.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openNestedMenu as openMenu } from '../menus.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { useCollection } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { PropertyIcon } from '../properties/PropertyCell.tsx';
import { defaultRoleChoice, roleCandidates, turnIntoTaskDatabase, type RoleChoice } from '../taskdb.ts';
import './relationFeatures.css';

const ROLES: { id: 'status' | 'assignee' | 'due'; word: string; newName: string; newType: string }[] = [
  { id: 'status', word: 'status', newName: 'Status', newType: 'status' },
  { id: 'assignee', word: 'assignee', newName: 'Assignee', newType: 'person' },
  { id: 'due', word: 'due date', newName: 'Due', newType: 'date' },
];

function TurnIntoTasks({ collectionId, close }: { collectionId: string; close: () => void }) {
  const c = useCollection(collectionId);
  const [choice, setChoice] = useState<Record<string, RoleChoice>>(() => {
    const col = records.get<CollectionRecord>('collection', collectionId);
    return col ? { status: defaultRoleChoice(col, 'status'), assignee: defaultRoleChoice(col, 'assignee'), due: defaultRoleChoice(col, 'due') } : {};
  });
  if (!c) return null;
  return (
    <div className="nc-tt-dialog" role="dialog" aria-label="Turn into task database" data-menu-keys="ignore">
      <div className="nc-tt-title">Turn into task database</div>
      <div className="nc-tt-sub">Task tables require status, assignee, and due date fields.</div>
      {ROLES.map((r) => {
        const cur = choice[r.id];
        const prop = cur && cur !== 'new' ? c.schema[cur] : undefined;
        return (
          <div key={r.id} className="nc-tt-row">
            <div className="nc-tt-row-label">{`Pick the field that represents ${r.word}`}</div>
            <div
              role="button"
              className="nc-tt-select"
              data-testid={`task-role-${r.id}`}
              onClick={(e) => openMenu(e.currentTarget, {
                width: 280,
                sections: [{ items: [
                  ...roleCandidates(c, r.id).map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: cur === id, onSelect: () => setChoice({ ...choice, [r.id]: id }) })),
                  { id: 'new', label: 'Create new', icon: 'plus', checked: cur === 'new', onSelect: () => setChoice({ ...choice, [r.id]: 'new' }) },
                ] }],
              }, { placement: 'bottom-start' })}
            >
              {prop ? <PropertyIcon prop={prop} size={16} /> : <Icon name="plus" size={16} />}
              <span className="nc-tt-select-label">{prop ? prop.name : cur === 'new' ? `Create new · ${r.newName}` : 'Select…'}</span>
              <Icon name="chevronDown" size={14} />
            </div>
            {r.id === 'status' && prop && prop.type !== 'status' && <div className="nc-tt-note">This field will be converted to a Status field type.</div>}
          </div>
        );
      })}
      <div className="nc-tt-preview">
        <Icon name="checkmarkSquare" size={20} />
        <div>
          <div className="nc-tt-preview-title">My Tasks</div>
          <div className="nc-tt-preview-desc">See all your tasks across multiple tables in your personal Home.</div>
        </div>
      </div>
      <div className="nc-tt-footer">
        {HELP_URL && (<a className="nc-tt-learn" href={HELP_URL} target="_blank" rel="noreferrer">Learn about task databases</a>)}
        <div role="button" className="nc-btn outline" onClick={close}>Close</div>
        <div role="button" className="nc-btn primary" data-testid="turn-into-tasks-confirm" onClick={() => { turnIntoTaskDatabase(c, { status: choice.status, assignee: choice.assignee, due: choice.due }); close(); }}>Turn into task database</div>
      </div>
    </div>
  );
}

export function openTurnIntoTasksDialog(collectionId: string) {
  return openOverlay((close) => <TurnIntoTasks collectionId={collectionId} close={close} />, { placement: 'center', backdrop: 'dim' });
}

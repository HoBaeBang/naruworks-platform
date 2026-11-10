import { HELP_URL } from '@nc/shared/brand.ts';


// "Enable skills for me" turns the whole database on in your skills. The server reads collection.format.ai_skills_db
// (+ ai_skills_description) — ai/skills.ts; "Undo Skills database" turns it back into a plain database.
import { useState } from 'react';
import type { CollectionRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay } from '../../components/overlay.tsx';
import { run } from '../../lib/blocks.ts';
import { useCollection } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openNestedMenu as openMenu } from '../database/menus.ts';
import { newPropertyId } from '../database/actions.ts';
import { PropertyIcon } from '../database/properties/PropertyCell.tsx';
import { savePrefs } from '../settings/userSettings.ts';
import '../database/chrome/relationFeatures.css';

export function isSkillsDatabase(c: CollectionRecord | undefined): boolean {
  return !!(c?.format as Record<string, unknown> | undefined)?.ai_skills_db;
}

function enabledDbs(): string[] {
  const me = useSession.getState().userId;
  const v = (records.get<UserSettingsRecord>('user_settings', me)?.settings as Record<string, unknown> | undefined)?.ai_skills_dbs_enabled;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function TurnIntoSkills({ collectionId, close }: { collectionId: string; close: () => void }) {
  const c = useCollection(collectionId);
  const textProps = c ? Object.entries(c.schema).filter(([, p]) => p.type === 'text') : [];
  const [desc, setDesc] = useState<string>(() => textProps.find(([, p]) => p.name.trim().toLowerCase() === 'description')?.[0] ?? textProps[0]?.[0] ?? 'new');
  const [enable, setEnable] = useState(true);
  if (!c) return null;
  const prop = desc !== 'new' ? c.schema[desc] : undefined;
  const apply = () => {
    run('turnIntoSkillsDatabase', (tx) => {
      let pid = desc;
      if (desc === 'new') {
        pid = newPropertyId(c.schema);
        tx.set('collection', c.id, ['schema', pid], { name: 'Description', type: 'text' });
      }
      tx.set('collection', c.id, ['format', 'ai_skills_db'], true);
      tx.set('collection', c.id, ['format', 'ai_skills_description'], pid);
    });
    if (enable) savePrefs({ ai_skills_dbs_enabled: [...new Set([...enabledDbs(), c.id])] });
    useUI.getState().toast('Every page in this database is now a skill');
    close();
  };
  return (
    <div className="nc-tt-dialog" role="dialog" aria-label="Change to Skills database" data-menu-keys="ignore" data-testid="turn-into-skills">
      <div className="nc-tt-title">Change to Skills database</div>
      <div className="nc-tt-sub">Every page in this database becomes a skill that Litpage AI and your agents can use. A skill with a description is used automatically when it fits the task.</div>
      <div className="nc-tt-row">
        <div className="nc-tt-row-label">Pick the property that describes each skill</div>
        <div
          role="button"
          className="nc-tt-select"
          data-testid="skills-description-prop"
          onClick={(e) => openMenu(e.currentTarget, {
            width: 280,
            sections: [{ items: [
              ...textProps.map(([id, p]) => ({ id, label: p.name, icon: <PropertyIcon prop={p} size={16} />, checked: desc === id, onSelect: () => setDesc(id) })),
              { id: 'new', label: 'Create new', icon: 'plus', checked: desc === 'new', onSelect: () => setDesc('new') },
            ] }],
          }, { placement: 'bottom-start' })}
        >
          {prop ? <PropertyIcon prop={prop} size={16} /> : <Icon name="plus" size={16} />}
          <span className="nc-tt-select-label">{prop ? prop.name : 'Create new · Description'}</span>
          <Icon name="chevronDown" size={14} />
        </div>
      </div>
      <label className="nc-tt-row nc-ai-skills-enable">
        <input type="checkbox" checked={enable} onChange={(e) => setEnable(e.target.checked)} />
        <span>Enable skills for me</span>
      </label>
      <div className="nc-tt-footer">
        {HELP_URL && (<a className="nc-tt-learn" href={HELP_URL} target="_blank" rel="noreferrer">Learn about skills</a>)}
        <div role="button" className="nc-btn outline" onClick={close}>Close</div>
        <div role="button" className="nc-btn primary" data-testid="turn-into-skills-confirm" onClick={apply}>Change to Skills database</div>
      </div>
    </div>
  );
}

export function openTurnIntoSkillsDialog(collectionId: string) {
  return openOverlay((close) => <TurnIntoSkills collectionId={collectionId} close={close} />, { placement: 'center', backdrop: 'dim' });
}


export function undoSkillsDatabase(c: CollectionRecord) {
  run('undoSkillsDatabase', (tx) => {
    tx.set('collection', c.id, ['format', 'ai_skills_db'], false);
  });
  const left = enabledDbs().filter((x) => x !== c.id);
  savePrefs({ ai_skills_dbs_enabled: left });
}

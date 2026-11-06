// Template variables: in database templates and in button "Insert blocks" content,
// "@Today — Duplication date", "@Now — Duplication time" and "@Me — Person who copied the entry" stay
// variables until the template is used / the button is clicked (packages/shared/src/automation/templateVars.ts:
// date mentions with template_variable, the reserved user id TEMPLATE_ME). Used by the date / person property
// editors, the property value views, the editor's "@" menu and its mention atoms.
import type { ReactNode } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import type { DateValue } from '@nc/shared/richtext.ts';
import { TEMPLATE_ME, isTemplateVariableDate, templateDate, type TemplateDateVariable } from '@nc/shared/automation/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { records } from '../../../lib/store/records.ts';
import { userTimeZone } from '../advanced/context.ts';
import { mentionMenuExtensions } from '../../editor/inline/MentionMenus.tsx';
import { insertAtomForTrigger } from '../../editor/inline/trigger.ts';
import './templates.css';

export { TEMPLATE_ME, isTemplateVariableDate };

/** Is `blockId` inside a database template page or a button's "Insert blocks" content? */
export function inTemplateContext(blockId: string | undefined | null): boolean {
  let cur = blockId ? records.get<BlockRecord>('block', blockId) : undefined;
  for (let i = 0; i < 100 && cur; i++) {
    if (cur.is_template || cur.type === 'button') return true;
    if (cur.parent_table !== 'block') return false;
    cur = records.get<BlockRecord>('block', cur.parent_id);
  }
  return false;
}

export function newTemplateDate(kind: TemplateDateVariable): DateValue {
  return templateDate(kind, Date.now(), userTimeZone());
}

export const TEMPLATE_DATE_LABELS: Record<TemplateDateVariable, [string, string]> = {
  today: ['Today', 'Duplication date'],
  now: ['Now', 'Duplication time'],
};

/** Label of a date value that is a template variable ("Today" / "Now"), else null. */
export function templateDateLabel(v: unknown): string | null {
  return isTemplateVariableDate(v) ? TEMPLATE_DATE_LABELS[v.template_variable!][0] : null;
}

/** Blue chip used for template variable values (person / date properties). */
export function TemplateVarChip({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <span className="nc-tplvar-chip" title="Filled in when the template is used">
      <Icon name={icon} size={14} />
      <span>{children}</span>
    </span>
  );
}

/** "Today / Now (when duplicated)" rows above the date picker of a template page. */
export function TemplateDateOptions({ value, onPick }: { value: DateValue | null; onPick: (v: DateValue) => void }) {
  const cur = isTemplateVariableDate(value) ? value.template_variable : null;
  return (
    <div className="nc-tplvar-options" role="listbox" aria-label="Template variables">
      {(Object.keys(TEMPLATE_DATE_LABELS) as TemplateDateVariable[]).map((k) => (
        <div key={k} role="option" aria-selected={cur === k} className={`nc-tplvar-option ${cur === k ? 'on' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(newTemplateDate(k))}>
          <Icon name={k === 'now' ? 'clock' : 'date'} size={16} />
          <span className="grow">{TEMPLATE_DATE_LABELS[k][0]}</span>
          <span className="hint">{TEMPLATE_DATE_LABELS[k][1]}</span>
          {cur === k && <Icon name="check" size={14} />}
        </div>
      ))}
    </div>
  );
}


// ------------------------------------------------------------------ "@" menu items (editor)

let registered = false;
/** "@Today" for the duplication date, "@Now" for the duplication time, and "@Me" for the person who copied the entry in database templates and the "Insert blocks" menu. */
export function registerTemplateVariableMentions() {
  if (registered) return;
  registered = true;
  mentionMenuExtensions.push(({ blockId, q }) => {
    if (!inTemplateContext(blockId)) return [];
    const ql = q.trim().toLowerCase();
    const match = (k: string) => !ql || k.startsWith(ql);
    const dates = (Object.keys(TEMPLATE_DATE_LABELS) as TemplateDateVariable[]).filter((k) => match(k)).map((k) => ({
      id: `tv-${k}`,
      label: <span>{TEMPLATE_DATE_LABELS[k][0]} <span className="nc-tplvar-hint">— {TEMPLATE_DATE_LABELS[k][1]}</span></span>,
      text: `${TEMPLATE_DATE_LABELS[k][0]} ${TEMPLATE_DATE_LABELS[k][1]}`,
      icon: k === 'now' ? 'clock' : 'date',
      onSelect: () => insertAtomForTrigger([['‣', [['d', newTemplateDate(k)]]]] as any),
    }));
    const me = match('me') ? [{ id: 'tv-me', label: <span>Me <span className="nc-tplvar-hint">— Person who copied the entry</span></span>, text: 'Me Person who duplicated page', icon: 'person', onSelect: () => insertAtomForTrigger([['‣', [['u', TEMPLATE_ME]]]] as any) }] : [];
    return [{ title: 'Date', items: dates }, { title: 'People', items: me }];
  });
}
registerTemplateVariableMentions();

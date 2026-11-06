// Custom formulas in automation and button fields: the formula editor in automation
// mode — "From this automation" values (Trigger page / This page, Whoever triggered / clicked, Page creator,
// Time triggered, Date triggered, pages of earlier steps, variables) as {{lit:context:…}} tokens, trigger-page
// properties as member paths (Trigger page.Status), with a page of the data source.
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { contextLabel, type ValueRef } from '@nc/shared/automation/index.ts';
import { dateFromMs, datetimeFromMs, encodeToken, type FValue } from '@nc/shared/formula/index.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { openCustomFormulaEditor, type CustomFormula } from '../advanced/FormulaEditor.tsx';
import { userTimeZone } from '../advanced/context.ts';
import { contextKeys, ctxSurface, earlierOutputs, refLabel, type EditorCtx } from './valueRefs.tsx';

const DESCRIPTIONS: Record<string, [string, string]> = {
  page: ['The entry that was edited to trigger this workflow to run.', 'The entry that contains this button'],
  actor: ['The user who made the edit that triggered this workflow to run.', 'The person who clicked this button'],
  page_creator: ['The user who created the entry that was edited to trigger this workflow to run.', 'The user who created this page.'],
  now: ['The time when this workflow begins to run.', 'The time when this button was clicked.'],
  today: ['The date when this workflow begins to run.', 'The date when this button was clicked.'],
};

function refKey(r: ValueRef): string | null {
  if (r.type === 'step') return `step:${r.step}`;
  if (r.type === 'variable') return `var:${r.step}:${r.variable}`;
  return null;
}

export function customFormulaFor(c: EditorCtx, onSave: (src: string) => void): CustomFormula {
  const surface = ctxSurface(c);
  const items: CustomFormula['contextItems'] = contextKeys(c).map((k) => ({
    key: k,
    label: contextLabel(k, surface),
    icon: k === 'page' ? 'page' : k === 'actor' || k === 'page_creator' ? 'person' : k === 'now' ? 'clock' : 'date',
    description: DESCRIPTIONS[k][surface === 'automation' ? 0 : 1],
    type: k === 'page' ? 'block' : k === 'actor' || k === 'page_creator' ? 'person' : 'date',
  }));
  const out = earlierOutputs(c);
  for (const r of out.pages) {
    const key = refKey(r)!;
    const step = c.steps.find((s) => s.id === (r as { step: string }).step);
    items.push({ key, label: refLabel(r, c).label, icon: 'page', description: step?.type === 'edit_pages' ? 'The pages edited by this step' : 'The entry created by the add-entry action', type: step?.type === 'edit_pages' ? 'list' : 'block' });
  }
  for (const r of out.variables) items.push({ key: refKey(r)!, label: refLabel(r, c).label, icon: 'formula', description: 'A variable defined earlier in this automation.' });
  const col = records.get<CollectionRecord>('collection', c.collectionId);
  const me = useSession.getState().userId ?? '';
  return {
    title: 'Edit formula',
    collectionId: c.collectionId,
    blockId: c.blockId,
    contextItems: items,
    contextLabel: (k) => (k === 'page' ? contextLabel('page', surface) : items.find((i) => i.key === k)?.label),
    contextValue: (k, row): FValue | undefined => {
      const now = Date.now();
      const tz = userTimeZone();
      switch (k) {
        case 'page': return row ? { type: 'block', value: { table: 'block', id: row.id, spaceId: row.space_id } } : undefined;
        case 'actor': return { type: 'person', value: { table: 'lit_user', id: me } };
        case 'page_creator': return row?.created_by_id ? { type: 'person', value: { table: 'lit_user', id: row.created_by_id } } : undefined;
        case 'now': return { type: 'date', value: datetimeFromMs(now, tz) };
        case 'today': return { type: 'date', value: dateFromMs(now, tz) };
        default: return undefined;
      }
    },
    propertyInsert: col ? (propId) => `${encodeToken({ type: 'context', key: 'page' })}.${encodeToken({ type: 'block_property', property: propId, collection: { id: col.id, table: 'collection', spaceId: col.space_id as string | undefined } })}` : undefined,
    onSave,
  };
}

export function openAutomationFormula(anchor: HTMLElement | null, opts: { c: EditorCtx; initial: string; onSave: (src: string) => void; row?: BlockRecord }) {
  return openCustomFormulaEditor(anchor, { ...customFormulaFor(opts.c, opts.onSave), initial: opts.initial, rowId: opts.row?.id });
}

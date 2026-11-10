// Button property click (/021): runs the property's steps (schema[prop].button_automation, or the first-wave
// button_actions) for the clicked row through the shared button runner (features/database/automations/runner.tsx):
// Edit property / Add page to / Edit pages in / Send notification / Send webhook / Show confirmation / Open page… /
// Define variables, as the person who clicked.
import type { BlockRecord } from '@nc/shared/records.ts';
import { buttonPropertyLabel, buttonPropertySteps } from '@nc/shared/automation/index.ts';
import type { Schema } from '@nc/shared/database/index.ts';

export function buttonActions(schema: Schema, propId: string) {
  return buttonPropertySteps(schema[propId], schema);
}

export function runButton(row: BlockRecord, propId: string, schema: Schema, anchor?: HTMLElement | null) {
  const prop = schema[propId];
  if (!prop) return;
  const steps = buttonPropertySteps(prop, schema);
  void import('../automations/runner.tsx').then((m) => m.runButtonSteps({
    surface: 'button_property', steps, page: row, collectionId: row.parent_id, propertyId: propId, anchor: anchor ?? null, label: buttonPropertyLabel(prop),
  }));
}

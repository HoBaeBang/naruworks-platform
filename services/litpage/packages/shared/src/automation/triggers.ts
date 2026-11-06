// Trigger semantics: a trigger is evaluated once per page after the detection window, comparing
// the page as it was before the first change in the window with its current value — only the net change counts
// (editing a value and reverting it inside the window triggers nothing).
import type { BlockRecord, CollectionRecord, PropertySchema } from '../records.ts';
import type { RichText } from '../richtext.ts';
import { decodeStored, isEmptyValue, valueToText, type PropertyValue, type QueryContext } from '../database/index.ts';
import { TRIGGER_PROPERTY_TYPES, type AutomationTrigger, type ConditionOp, type PropertyCondition, type TriggerEvent } from './types.ts';

function stable(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v) && v.length === 0) return '';
  return JSON.stringify(v);
}

function rawOf(b: BlockRecord | undefined, propId: string, prop: PropertySchema | undefined): RichText | undefined {
  if (!b) return undefined;
  const k = propId === 'title' || prop?.type === 'title' ? 'title' : propId;
  return b.properties?.[k] as RichText | undefined;
}

/** Was this block a live row of `collectionId` (not a template)? */
export function isLiveRow(b: BlockRecord | undefined, collectionId: string): boolean {
  return !!b && b.alive !== false && b.parent_table === 'collection' && b.parent_id === collectionId && !b.is_template;
}

/** Stored properties whose value differs between two versions of a page (schema properties only). */
export function changedProperties(before: BlockRecord | undefined, after: BlockRecord, schema: Record<string, PropertySchema>): string[] {
  const out: string[] = [];
  for (const [id, prop] of Object.entries(schema)) {
    if (['formula', 'rollup', 'created_time', 'created_by', 'last_edited_time', 'last_edited_by', 'button', 'auto_increment_id'].includes(prop.type)) continue;
    if (stable(rawOf(before, id, prop)) !== stable(rawOf(after, id, prop))) out.push(id);
  }
  return out;
}

export interface TriggerInput {
  /** page as it was before the window (undefined = did not exist / was not a row of this data source) */
  before: BlockRecord | undefined;
  /** current page */
  after: BlockRecord;
  collection: CollectionRecord;
  ctx?: QueryContext;
}

/** Operators a property-edited trigger offers per property type (trigger submenu / summary verbs). */
export function conditionOpsFor(type: string): ConditionOp[] {
  switch (type) {
    case 'select':
    case 'status':
      return ['is', 'is_not', 'edited'];
    case 'multi_select':
    case 'person':
    case 'relation':
      return ['contains', 'does_not_contain', 'edited', 'cleared'];
    case 'checkbox':
      return ['is', 'edited'];
    case 'number':
      return ['equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to', 'edited', 'cleared'];
    case 'date':
      return ['edited', 'cleared'];
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number':
      return ['is', 'is_not', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'edited', 'cleared'];
    default:
      return ['edited'];
  }
}

export function canTriggerOn(prop: PropertySchema | undefined): boolean {
  return !!prop && TRIGGER_PROPERTY_TYPES.has(prop.type);
}

function listKeys(v: PropertyValue): string[] {
  switch (v.kind) {
    case 'select': return v.options.map((o) => o.value);
    case 'status': return v.option ? [v.option.value] : [];
    case 'person': return v.ids;
    case 'relation': return v.ids;
    default: return [];
  }
}

/** Does `cond` hold for one value (no "changed" requirement). */
export function conditionHolds(prop: PropertySchema, cond: PropertyCondition, v: PropertyValue, ctx?: QueryContext): boolean {
  const vals = (cond.values ?? []).map((x) => String(x));
  switch (cond.op) {
    case 'edited': return true;
    case 'cleared': return isEmptyValue(v);
    case 'is':
    case 'is_not': {
      let hit: boolean;
      if (v.kind === 'checkbox') hit = vals.length ? vals.some((x) => (x === 'checked') === v.checked) : true;
      else if (v.kind === 'select' || v.kind === 'status') hit = vals.length ? listKeys(v).some((k) => vals.includes(k)) : true;
      else {
        const t = valueToText(v, prop, ctx).trim().toLowerCase();
        hit = vals.length ? vals.some((x) => x.trim().toLowerCase() === t) : true;
      }
      return cond.op === 'is' ? hit : !hit;
    }
    case 'contains':
    case 'does_not_contain': {
      let hit: boolean;
      if (v.kind === 'select' || v.kind === 'person' || v.kind === 'relation' || v.kind === 'status') hit = vals.length ? listKeys(v).some((k) => vals.includes(k)) : !isEmptyValue(v);
      else {
        const t = valueToText(v, prop, ctx).toLowerCase();
        hit = vals.length ? vals.some((x) => x && t.includes(x.toLowerCase())) : true;
      }
      return cond.op === 'contains' ? hit : !hit;
    }
    case 'starts_with': return valueToText(v, prop, ctx).toLowerCase().startsWith((vals[0] ?? '').toLowerCase());
    case 'ends_with': return valueToText(v, prop, ctx).toLowerCase().endsWith((vals[0] ?? '').toLowerCase());
    default: {
      if (v.kind !== 'number' || v.number === null) return false;
      const n = Number(vals[0]);
      if (!Number.isFinite(n)) return false;
      switch (cond.op) {
        case 'equals': return v.number === n;
        case 'not_equals': return v.number !== n;
        case 'greater_than': return v.number > n;
        case 'less_than': return v.number < n;
        case 'greater_than_or_equal_to': return v.number >= n;
        case 'less_than_or_equal_to': return v.number <= n;
        default: return false;
      }
    }
  }
}

const LIST_TYPES = new Set(['multi_select', 'person', 'relation']);

export function eventMatches(ev: TriggerEvent, input: TriggerInput, changed = changedProperties(input.before, input.after, input.collection.schema)): boolean {
  if (!isLiveRow(input.after, input.collection.id)) return false; // deleted rows and templates never trigger
  const added = !isLiveRow(input.before, input.collection.id);
  switch (ev.type) {
    case 'page_added':
      return added;
    case 'any_property_edited':
      return !added && changed.length > 0;
    case 'property_edited': {
      // a new page counts when the property is filled in as it is created (form responses with a given answer,
      // rows added to a board column / filtered view)
      const prop = input.collection.schema[ev.property];
      if (!prop || !changed.includes(ev.property)) return false;
      const after = decodeStored(rawOf(input.after, ev.property, prop), prop, input.after, input.ctx);
      if (!conditionHolds(prop, ev.condition, after, input.ctx)) return false;
      // list conditions fire when they become true ("Assignee contains Ana" when Ana is added)
      if (LIST_TYPES.has(prop.type) && (ev.condition.op === 'contains' || ev.condition.op === 'does_not_contain')) {
        const before = decodeStored(rawOf(input.before, ev.property, prop), prop, input.before, input.ctx);
        return !conditionHolds(prop, ev.condition, before, input.ctx);
      }
      return true;
    }
    default:
      return false;
  }
}

/** Does an event trigger fire for this net change? `all` mode needs every event (~3s window). */
export function triggerMatches(trigger: AutomationTrigger, input: TriggerInput): boolean {
  if (trigger.type !== 'event' || !trigger.events.length) return false;
  const changed = changedProperties(input.before, input.after, input.collection.schema);
  const results = trigger.events.map((ev) => eventMatches(ev, input, changed));
  return trigger.mode === 'all' ? results.every(Boolean) : results.some(Boolean);
}

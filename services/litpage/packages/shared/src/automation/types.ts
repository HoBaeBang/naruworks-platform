// Database automations, buttons and button properties share one step model.
// Storage: an `automation` record keeps its trigger and actions inline; a button
// block keeps its steps in format.button_automation, a button property in schema[prop].button_actions.
import type { BaseRecord, Role } from '../records.ts';
import type { DateValue } from '../richtext.ts';
import type { FilterGroup } from '../database/types.ts';

// ---------------------------------------------------------------- values used by actions

/** Values a step can resolve at run time (mention-like "@" values of action fields). */
export type ContextKey =
  /** the trigger page (automations) / the page holding the button (buttons) */
  | 'page'
  /** Whoever triggered / Whoever clicked */
  | 'actor'
  /** creator of the trigger page */
  | 'page_creator'
  /** Time triggered (datetime) */
  | 'now'
  /** Date triggered (date) */
  | 'today';

export type ValueRef =
  /** literal text (also numbers, URLs, e-mails, phone numbers typed into a field) */
  | { type: 'text'; text: string }
  /** select / multi-select / status option, by name (values store option names) */
  | { type: 'option'; name: string }
  | { type: 'user'; id: string }
  | { type: 'page'; id: string }
  | { type: 'date'; date: DateValue }
  | { type: 'checkbox'; checked: boolean }
  | { type: 'context'; key: ContextKey }
  /** relative date from the time the automation runs ("1 week from today") */
  | { type: 'relative_date'; amount: number; unit: 'day' | 'week' | 'month' | 'year' }
  /** a property of the trigger page ("Trigger page's Due") */
  | { type: 'property'; property: string }
  /** pages created (add page) or edited (edit pages) by an earlier step ("Page added in step 2") */
  | { type: 'step'; step: string }
  /** a variable defined by an earlier "Define variables" step */
  | { type: 'variable'; step: string; variable: string }
  /** ∑ custom formula (engine source with {{lit:…}} tokens); `name` defaults to "My value" */
  | { type: 'formula'; formula: string; name?: string };

export type EditOp = 'set' | 'clear' | 'add' | 'remove' | 'toggle';

/** One property edit of "Edit property" / "Add page to" / "Edit pages in" (title included as property "title"). */
export interface PropertyEdit {
  property: string;
  op: EditOp;
  values: ValueRef[];
}

// ---------------------------------------------------------------- triggers

export type ConditionOp =
  | 'edited'
  | 'cleared'
  | 'is'
  | 'is_not'
  | 'contains'
  | 'does_not_contain'
  | 'starts_with'
  | 'ends_with'
  | 'equals'
  | 'not_equals'
  | 'greater_than'
  | 'less_than'
  | 'greater_than_or_equal_to'
  | 'less_than_or_equal_to';

/** Property condition of a "property edited" trigger. Values are static (no mentions/formulas):
 * option names, user ids, page ids, "checked"/"unchecked", text or a number as text. */
export interface PropertyCondition {
  op: ConditionOp;
  values?: string[];
}

export type TriggerEvent =
  | { id: string; type: 'page_added' }
  | { id: string; type: 'any_property_edited' }
  | { id: string; type: 'property_edited'; property: string; condition: PropertyCondition };

export type RecurrenceFrequency = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface Recurrence {
  frequency: RecurrenceFrequency;
  /** every N units (≥ 1) */
  interval: number;
  /** weekly: days of week, 0 = Sunday … 6 = Saturday */
  weekdays?: number[];
  /** monthly / yearly: day of month (1–31) or the last day */
  month_day?: number | 'last';
  /** yearly: month 1–12 */
  month?: number;
  /** "HH:mm"; omitted = "Around midnight" (12–3AM) */
  time?: string;
  /** "Starting" (YYYY-MM-DD) */
  start: string;
  end?: { type: 'never' } | { type: 'count'; count: number } | { type: 'date'; date: string };
  time_zone: string;
}

export type AutomationTrigger =
  | { type: 'event'; mode: 'any' | 'all'; events: TriggerEvent[] }
  | { type: 'recurrence'; recurrence: Recurrence | null }
  | { type: 'button' };

// ---------------------------------------------------------------- actions (steps)

export type PeekTarget = 'side_peek' | 'center_peek' | 'full_page' | 'new_tab';

export type OpenTarget =
  | { type: 'page'; page_id: string }
  | { type: 'url'; url: string }
  | { type: 'step'; step: string }
  | { type: 'context'; key: 'page' };

export type AutomationAction =
  /** Edit property (trigger page / this page) */
  | { id: string; type: 'edit_property'; edits: PropertyEdit[] }
  /** Add page to {database} as {template} */
  | { id: string; type: 'add_page'; collection_id?: string; template_id?: string | null; edits: PropertyEdit[] }
  /** Edit {all pages | pages that match N filters} in {database | variable} */
  | {
    id: string; type: 'edit_pages'; collection_id?: string; filter?: FilterGroup | null;
    /** edit the pages held by a variable / produced by a step instead of a database query */
    source?: { type: 'variable'; step: string; variable: string } | { type: 'step'; step: string } | null;
    edits: PropertyEdit[];
  }
  /** Send notification to {People | Person property} */
  | {
    id: string; type: 'notify';
    target: { type: 'users'; user_ids: string[]; dynamic?: ContextKey[] } | { type: 'property'; property: string };
    message: ValueRef[];
  }
  /** Send webhook: URL, custom headers, page properties sent as content */
  | { id: string; type: 'webhook'; url: string; headers: { id?: string; key: string; value: string }[]; properties: string[] | 'all' }
  /** Define variables (Variable 1 …) */
  | { id: string; type: 'define_variables'; variables: { id: string; name: string; formula: string }[] }
  /** Show confirmation (buttons) */
  | { id: string; type: 'confirm'; message: string; continue_label?: string; cancel_label?: string }
  /** Open page, form, or URL (buttons) */
  | { id: string; type: 'open'; target: OpenTarget | null; peek?: PeekTarget }
  /** Insert blocks (button block): the button block's children are the template */
  | { id: string; type: 'insert_blocks'; position: 'below' | 'above' | 'top' | 'bottom' }
  /** Send message to agent (buttons) */
  | { id: string; type: 'agent'; message: string }
  /** connected actions that can't run yet (shown disabled): Send mail…, Send Slack notification to… */
  | { id: string; type: 'mail' | 'slack' };

export type ActionType = AutomationAction['type'];

// ---------------------------------------------------------------- records

export type AutomationStatus = 'active' | 'paused' | 'completed';

export interface AutomationRun {
  id: string;
  time: number;
  status: 'success' | 'error' | 'skipped';
  page_id?: string;
  /** step that failed */
  step_id?: string;
  message?: string;
  duration_ms?: number;
}

/** `automation` record (table "automation"), parent = the data source (collection). */
export interface AutomationRecord extends BaseRecord {
  space_id: string;
  parent_table: 'collection';
  parent_id: string;
  alive: boolean;
  status: AutomationStatus;
  properties: { name?: string };
  /** "For pages in": the whole data source or the pages of one (filtered) view */
  scope?: { type: 'collection' } | { type: 'view'; view_id: string };
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  created_by_id: string;
  created_by_table?: 'lit_user';
  created_time: number;
  last_edited_by_id: string;
  last_edited_time: number;
  /** why the automation stopped (execution error, lost permission) — cleared when re-enabled */
  paused_reason?: 'error' | 'permission' | 'page_inaccessible' | null;
  last_error?: { message: string; step_id?: string; time: number } | null;
  last_run_time?: number | null;
  run_count?: number;
  /** recurrence bookkeeping (server-owned) */
  next_run_time?: number | null;
  recurrence_runs?: number;
  /** repeating database template: this automation duplicates the template on its schedule and is
   * managed from the template's "Duplicate every…" menu (hidden from the automations list) */
  template_id?: string | null;
}

export interface AutomationPermissions {
  canEdit: boolean;
  role: Role;
  reason?: string;
}

/** Properties an automation trigger / Edit property action can use (the trigger menu hides computed ones). */
export const TRIGGER_PROPERTY_TYPES = new Set([
  'title', 'text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'url', 'email', 'phone_number', 'relation',
]);

/** Property types an action can write. */
export const EDITABLE_PROPERTY_TYPES = new Set([...TRIGGER_PROPERTY_TYPES, 'file']);

/** Limits of webhook actions, buttons and database automations. */
export const LIMITS = {
  webhookActions: 5,
  customHeaders: 10,
  notifyUsers: 20,
  pagesPerAction: 1000,
  steps: 25,
  variables: 25,
  nameLength: 200,
  messageLength: 2000,
  formulaLength: 5000,
} as const;

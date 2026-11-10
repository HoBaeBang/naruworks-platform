// Database automations API (…029), repeating database templates (/009) and the server-side
// steps of buttons (Send notification / Send webhook — /009, /021.6).
// Automation records live in the `automation` table (parent = data source) and are written only here: clients
// read them through recordMaps / realtime; every write checks "workspace member with full access to the database"
// (/2) and re-validates the configuration. Execution: ../../automations/engine.ts.
import { newId } from '@nc/shared/ids.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, NotificationRecord, SpaceRecord } from '@nc/shared/records.ts';
import type { FilterGroup } from '@nc/shared/database/index.ts';
import {
  AutomationError, AutomationPlanner, LIMITS, buttonBlockSteps, buttonPropertySteps, buttonPropertyLabel, recurrenceValid, validateAutomation,
  webhookPayload, type AutomationAction, type AutomationRecord, type AutomationTrigger, type PropertyEdit, type Recurrence, type RunContext,
  type TriggerEvent, type ValueRef,
} from '@nc/shared/automation/index.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { getRecord } from '../../db.ts';
import { blockRole, RecordMapBuilder } from '../../records.ts';
import { messageQueryContext, readableQueryContext, viewerQueryContext } from '../../queryctx.ts';
import { redactDatabaseRecord } from '../../propaccess.ts';
import { pageIdOf } from '../../search.ts';
import { hit, RateLimitError } from '../../ratelimit.ts';
import { safeFetch, FetchBlockedError } from '../../safefetch.ts';
import { pushNotification } from '../../notify.ts';
import { audit } from '../../audit.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import {
  automationEditProblem, automationName, automationsOf, flushAutomations, jobKey, listRuns, saveAutomationRecord, scheduleRecurrence, webhooksAllowed,
} from '../../automations/engine.ts';
import { userTimeZone } from '../../automations/templates.ts';
import { automationOwner, blockOwner, copySecrets, propertyOwner, resolveHeaders, sealActions, WebhookSecretError } from '../../webhookSecrets.ts';
import { DEMO_MESSAGE, isDemoMode } from '../../demo.ts';
import { cancelJob } from '../../scheduler.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

const str = (v: unknown, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const ids = (v: unknown, max = 100) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[\w-]{1,64}$/.test(x)).slice(0, max) : []);
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,100}$/.test(v);

// ------------------------------------------------------------------ input sanitizing (shape whitelist)

const CONTEXT_KEYS = new Set(['page', 'actor', 'page_creator', 'now', 'today']);
const CONDITION_OPS = new Set(['edited', 'cleared', 'is', 'is_not', 'contains', 'does_not_contain', 'starts_with', 'ends_with', 'equals', 'not_equals', 'greater_than', 'less_than', 'greater_than_or_equal_to', 'less_than_or_equal_to']);
const EDIT_OPS = new Set(['set', 'clear', 'add', 'remove', 'toggle']);

function cleanDate(v: any) {
  if (!v || typeof v !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(String(v.start_date ?? ''))) return null;
  const out: any = { type: ['date', 'datetime', 'daterange', 'datetimerange'].includes(v.type) ? v.type : 'date', start_date: String(v.start_date) };
  for (const k of ['start_time', 'end_date', 'end_time', 'time_zone', 'date_format', 'time_format']) if (typeof v[k] === 'string') out[k] = v[k].slice(0, 64);
  return out;
}

function cleanRef(r: any): ValueRef | null {
  if (!r || typeof r !== 'object') return null;
  switch (r.type) {
    case 'text': return { type: 'text', text: str(r.text, LIMITS.messageLength) };
    case 'option': return { type: 'option', name: str(r.name, 200) };
    case 'user': return isId(r.id) ? { type: 'user', id: r.id } : null;
    case 'page': return isId(r.id) ? { type: 'page', id: r.id } : null;
    case 'date': { const d = cleanDate(r.date); return d ? { type: 'date', date: d } : null; }
    case 'checkbox': return { type: 'checkbox', checked: !!r.checked };
    case 'context': return CONTEXT_KEYS.has(r.key) ? { type: 'context', key: r.key } : null;
    case 'relative_date': return ['day', 'week', 'month', 'year'].includes(r.unit) && Number.isFinite(Number(r.amount)) ? { type: 'relative_date', amount: Math.max(-1000, Math.min(1000, Math.trunc(Number(r.amount)))), unit: r.unit } : null;
    case 'property': return isId(r.property) || typeof r.property === 'string' ? { type: 'property', property: str(r.property, 100) } : null;
    case 'step': return isId(r.step) ? { type: 'step', step: r.step } : null;
    case 'variable': return isId(r.step) && isId(r.variable) ? { type: 'variable', step: r.step, variable: r.variable } : null;
    case 'formula': return { type: 'formula', formula: str(r.formula, LIMITS.formulaLength), ...(typeof r.name === 'string' ? { name: r.name.slice(0, 100) } : {}) };
    default: return null;
  }
}

function cleanRefs(v: unknown, max = 50): ValueRef[] {
  return (Array.isArray(v) ? v : []).slice(0, max).map(cleanRef).filter((x): x is ValueRef => !!x);
}

function cleanEdits(v: unknown): PropertyEdit[] {
  return (Array.isArray(v) ? v : []).slice(0, 50).filter((e) => e && typeof e.property === 'string' && EDIT_OPS.has(e.op)).map((e) => ({ property: str(e.property, 100), op: e.op, values: cleanRefs(e.values) }));
}

function cleanFilter(f: any, depth = 0): FilterGroup | null {
  if (!f || typeof f !== 'object' || !Array.isArray(f.filters) || depth > 2) return null;
  const json = JSON.stringify(f);
  if (json.length > 50_000) throw new ApiError('Filter is too large');
  return JSON.parse(json) as FilterGroup;
}

function cleanRecurrence(r: any): Recurrence | null {
  if (!r || typeof r !== 'object') return null;
  const out: Recurrence = {
    frequency: ['hour', 'day', 'week', 'month', 'year'].includes(r.frequency) ? r.frequency : 'day',
    interval: Math.max(1, Math.min(1000, Math.trunc(Number(r.interval) || 1))),
    start: /^\d{4}-\d{2}-\d{2}$/.test(String(r.start ?? '')) ? String(r.start) : '',
    time_zone: str(r.time_zone, 64) || 'UTC',
  };
  if (Array.isArray(r.weekdays)) out.weekdays = [...new Set(r.weekdays.map(Number).filter((d: number) => Number.isInteger(d) && d >= 0 && d <= 6))] as number[];
  if (r.month_day === 'last' || (Number.isInteger(r.month_day) && r.month_day >= 1 && r.month_day <= 31)) out.month_day = r.month_day;
  if (Number.isInteger(r.month) && r.month >= 1 && r.month <= 12) out.month = r.month;
  if (typeof r.time === 'string' && /^\d{1,2}:\d{2}$/.test(r.time)) out.time = r.time;
  if (r.end?.type === 'count') out.end = { type: 'count', count: Math.max(1, Math.min(100_000, Math.trunc(Number(r.end.count) || 1))) };
  else if (r.end?.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(r.end.date ?? ''))) out.end = { type: 'date', date: r.end.date };
  else out.end = { type: 'never' };
  return out;
}

export function cleanTrigger(t: any): AutomationTrigger {
  if (t?.type === 'recurrence') return { type: 'recurrence', recurrence: cleanRecurrence(t.recurrence) };
  if (t?.type === 'button') return { type: 'button' };
  const events: TriggerEvent[] = [];
  for (const e of (Array.isArray(t?.events) ? t.events : []).slice(0, 20)) {
    const id = isId(e?.id) ? e.id : newId();
    if (e?.type === 'page_added') events.push({ id, type: 'page_added' });
    else if (e?.type === 'any_property_edited') events.push({ id, type: 'any_property_edited' });
    else if (e?.type === 'property_edited' && typeof e.property === 'string') {
      const op = CONDITION_OPS.has(e.condition?.op) ? e.condition.op : 'edited';
      events.push({ id, type: 'property_edited', property: str(e.property, 100), condition: { op, values: (Array.isArray(e.condition?.values) ? e.condition.values : []).slice(0, 50).map((x: unknown) => String(x).slice(0, 500)) } });
    }
  }
  return { type: 'event', mode: t?.mode === 'all' ? 'all' : 'any', events };
}

export function cleanActions(list: unknown): AutomationAction[] {
  const out: AutomationAction[] = [];
  for (const a of (Array.isArray(list) ? list : []).slice(0, LIMITS.steps)) {
    if (!a || typeof a !== 'object') continue;
    const id = isId(a.id) ? a.id : newId();
    switch (a.type) {
      case 'edit_property': out.push({ id, type: 'edit_property', edits: cleanEdits(a.edits) }); break;
      case 'add_page': out.push({ id, type: 'add_page', collection_id: isId(a.collection_id) ? a.collection_id : undefined, template_id: isId(a.template_id) ? a.template_id : null, edits: cleanEdits(a.edits) }); break;
      case 'edit_pages': {
        const source = a.source?.type === 'step' && isId(a.source.step) ? { type: 'step' as const, step: a.source.step }
          : a.source?.type === 'variable' && isId(a.source.step) && isId(a.source.variable) ? { type: 'variable' as const, step: a.source.step, variable: a.source.variable } : null;
        out.push({ id, type: 'edit_pages', collection_id: isId(a.collection_id) ? a.collection_id : undefined, filter: cleanFilter(a.filter), source, edits: cleanEdits(a.edits) });
        break;
      }
      case 'notify': {
        const target = a.target?.type === 'property' && typeof a.target.property === 'string'
          ? { type: 'property' as const, property: str(a.target.property, 100) }
          : { type: 'users' as const, user_ids: ids(a.target?.user_ids, LIMITS.notifyUsers), dynamic: (Array.isArray(a.target?.dynamic) ? a.target.dynamic : []).filter((k: string) => CONTEXT_KEYS.has(k)).slice(0, 3) };
        out.push({ id, type: 'notify', target, message: cleanRefs(a.message) });
        break;
      }
      case 'webhook': out.push({ id, type: 'webhook', url: str(a.url, 2000).trim(), headers: (Array.isArray(a.headers) ? a.headers : []).slice(0, LIMITS.customHeaders + 1).map((h: any) => ({ ...(isId(h?.id) ? { id: h.id } : {}), key: str(h?.key, 100).trim(), value: str(h?.value, 1000) })), properties: a.properties === 'all' ? 'all' : (Array.isArray(a.properties) ? a.properties.filter((p: unknown) => typeof p === 'string').slice(0, 500) : 'all') }); break;
      case 'define_variables': out.push({ id, type: 'define_variables', variables: (Array.isArray(a.variables) ? a.variables : []).slice(0, LIMITS.variables).map((v: any) => ({ id: isId(v?.id) ? v.id : newId(), name: str(v?.name, 100) || 'Variable 1', formula: str(v?.formula, LIMITS.formulaLength) })) }); break;
      case 'confirm': out.push({ id, type: 'confirm', message: str(a.message, 500), ...(typeof a.continue_label === 'string' ? { continue_label: a.continue_label.slice(0, 50) } : {}), ...(typeof a.cancel_label === 'string' ? { cancel_label: a.cancel_label.slice(0, 50) } : {}) }); break;
      case 'open': {
        const t = a.target;
        const target = t?.type === 'page' && isId(t.page_id) ? { type: 'page' as const, page_id: t.page_id } : t?.type === 'url' ? { type: 'url' as const, url: str(t.url, 2000) } : t?.type === 'step' && isId(t.step) ? { type: 'step' as const, step: t.step } : t?.type === 'context' ? { type: 'context' as const, key: 'page' as const } : null;
        out.push({ id, type: 'open', target, peek: ['side_peek', 'center_peek', 'full_page', 'new_tab'].includes(a.peek) ? a.peek : undefined });
        break;
      }
      case 'insert_blocks': out.push({ id, type: 'insert_blocks', position: ['below', 'above', 'top', 'bottom'].includes(a.position) ? a.position : 'below' }); break;
      case 'agent': out.push({ id, type: 'agent', message: str(a.message, 2000) }); break;
      case 'mail': case 'slack': out.push({ id, type: a.type }); break;
      default: break;
    }
  }
  return out;
}

// ------------------------------------------------------------------ helpers

function collectionOrThrow(collectionId: unknown, uid: string): CollectionRecord {
  const col = getRecord<CollectionRecord>('collection', String(collectionId ?? ''));
  if (!col || blockRole(col.parent_id, uid) === 'none') throw new ApiError('Not found', 404);
  return col;
}

function automationOrThrow(id: unknown, uid: string): { a: AutomationRecord; col: CollectionRecord } {
  const a = getRecord<AutomationRecord>('automation', String(id ?? ''));
  if (!a || a.alive === false) throw new ApiError('Not found', 404);
  const col = collectionOrThrow(a.parent_id, uid);
  return { a, col };
}

function assertCanEdit(col: CollectionRecord, uid: string) {
  const p = automationEditProblem(col, uid);
  if (p) throw new ApiError(p, p === 'Not found' ? 404 : 403);
}

/** Targets of add page / edit pages must be databases the editor can edit . */
function assertTargets(actions: AutomationAction[], uid: string) {
  for (const a of actions) {
    if ((a.type === 'add_page' || a.type === 'edit_pages') && a.collection_id) {
      const target = getRecord<CollectionRecord>('collection', a.collection_id);
      if (!target || !roleAtLeast(blockRole(target.parent_id, uid), 'read_and_write')) throw new ApiError('You need full access to every target database to edit this automation', 403);
    }
  }
}

function recordMapFor(uid: string, list: AutomationRecord[]) {
  const rm = new RecordMapBuilder(uid);
  for (const a of list) {
    rm.add('automation', a);
    rm.add('lit_user', getRecord('lit_user', a.created_by_id), 'reader');
  }
  return rm.map;
}

/** Audit log: the system records "Automation created" / "Automation edited"; a deletion is an edit. */
function auditAutomation(event: 'automation_created' | 'automation_edited', a: AutomationRecord, uid: string, extra: Record<string, unknown> = {}) {
  const col = getRecord<CollectionRecord>('collection', a.parent_id);
  audit(event, { spaceId: a.space_id, actorId: uid, targetId: col?.parent_id, data: { automation_id: a.id, automation_type: a.trigger.type === 'recurrence' ? 'recurrence' : 'automation', name: automationName(a), ...extra } });
}

// ------------------------------------------------------------------ repeating templates (/009)

/** The template's repeat automation (one per template). */
function templateRepeat(templateId: string): AutomationRecord | undefined {
  const tpl = getRecord<BlockRecord>('block', templateId);
  if (!tpl || tpl.parent_table !== 'collection') return undefined;
  return automationsOf(tpl.parent_id).find((a) => a.template_id === templateId);
}

/** Templates (and their repeat cadence) this template sits inside: nesting rules of . */
function nestingProblem(tpl: BlockRecord, rec: Recurrence): string | null {
  let depth = 0;
  let cur: BlockRecord | undefined = tpl;
  for (let i = 0; i < 200 && cur; i++) {
    let parent: BlockRecord | undefined;
    if (cur.parent_table === 'block') parent = getRecord<BlockRecord>('block', cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const c = getRecord<CollectionRecord>('collection', cur.parent_id);
      parent = c ? getRecord<BlockRecord>('block', c.parent_id) : undefined;
    }
    if (parent?.is_template && cur.id !== tpl.id) {
      const outer = templateRepeat(parent.id);
      if (outer && outer.status === 'active' && outer.trigger.type === 'recurrence') {
        depth++;
        if (outer.trigger.recurrence?.frequency === 'day' || outer.trigger.recurrence?.frequency === 'hour') return 'A different repeating template already creates this each day.';
        if (depth >= 3) return 'Other repeating templates already create this automatically.';
        if (rec.frequency === 'day' || rec.frequency === 'hour') return `This template is nested inside one that repeats every ${outer.trigger.recurrence?.frequency ?? 'week'}.`;
      }
    }
    cur = parent;
  }
  return null;
}

// ------------------------------------------------------------------ button server steps

function buttonSource(body: any, uid: string): { steps: AutomationAction[]; page?: BlockRecord; spaceId: string; label: string; block?: BlockRecord; sourceType: 'button' | 'button_property'; propertyId?: string; owner: string } {
  if (body?.blockId) {
    const block = getRecord<BlockRecord>('block', String(body.blockId));
    if (!block || block.alive === false || block.type !== 'button') throw new ApiError('Not found', 404);
    if (!roleAtLeast(blockRole(block.id, uid), 'read_and_write')) throw new ApiError('You need edit access to use this button', 403);
    const pageId = pageIdOf(block);
    const page = getRecord<BlockRecord>('block', pageId);
    return { steps: buttonBlockSteps(block, (cid) => getRecord<CollectionRecord>('collection', cid)?.schema), page, spaceId: block.space_id, label: toPlainText(block.properties?.title as RichText | undefined) || 'New button', block, sourceType: 'button', owner: blockOwner(block.id) };
  }
  const row = getRecord<BlockRecord>('block', String(body?.rowId ?? ''));
  if (!row || row.alive === false || row.parent_table !== 'collection') throw new ApiError('Not found', 404);
  const col = getRecord<CollectionRecord>('collection', row.parent_id);
  const prop = col?.schema[String(body?.propertyId ?? '')];
  if (!col || !prop || prop.type !== 'button') throw new ApiError('Not found', 404);
  if (!roleAtLeast(blockRole(row.id, uid), 'read_and_write')) throw new ApiError('You need edit access to use this button', 403);
  return { steps: buttonPropertySteps(prop, col.schema), page: row, spaceId: row.space_id, label: buttonPropertyLabel(prop) || prop.name, sourceType: 'button_property', propertyId: String(body.propertyId), owner: propertyOwner(col.id, String(body.propertyId)) };
}

// ------------------------------------------------------------------ handlers

export const handlers: Record<string, Handler> = {
  /** Automations of a data source (list in ⚡ / View settings › Automations) + whether the caller may edit them. */
  getAutomations(ctx, { collectionId }) {
    const uid = requireUser(ctx);
    const col = collectionOrThrow(collectionId, uid);
    const list = automationsOf(col.id);
    const problem = automationEditProblem(col, uid);
    const role = blockRole(col.parent_id, uid);
    return { automationIds: list.map((a) => a.id), canEdit: !problem, editProblem: problem, role, webhooksAllowed: webhooksAllowed(col.space_id as string), recordMap: recordMapFor(uid, list) };
  },

  /** Create or update an automation. `automation.status` 'active' requires a valid configuration ("Fix errors to enable"). */
  saveAutomation(ctx, { collectionId, automation }) {
    const uid = requireUser(ctx);
    if (!hit(`automation-save:${uid}`, 120, 60_000)) throw new RateLimitError();
    const col = collectionOrThrow(collectionId, uid);
    assertCanEdit(col, uid);
    if (!automation || typeof automation !== 'object') throw new ApiError('Invalid automation');
    if (JSON.stringify(automation).length > 300_000) throw new ApiError('Automation is too large', 413);
    const trigger = cleanTrigger(automation.trigger);
    if (trigger.type === 'button') throw new ApiError('Invalid trigger');
    let actions = cleanActions(automation.actions);
    assertTargets(actions, uid);
    if (actions.some((a) => a.type === 'webhook') && !webhooksAllowed(col.space_id as string)) throw new ApiError('This feature is disabled in your workspace', 403);
    const scopeView = automation.scope?.type === 'view' && isId(automation.scope.view_id) ? getRecord<CollectionViewRecord>('collection_view', automation.scope.view_id) : undefined;
    const scope = scopeView && blockRole(scopeView.parent_id, uid) !== 'none' ? { type: 'view' as const, view_id: scopeView.id } : { type: 'collection' as const };
    const host = getRecord<BlockRecord>('block', col.parent_id)!;
    const look = { surface: 'automation' as const, collectionId: col.id, schema: col.schema, collection: (id: string) => getRecord<CollectionRecord>('collection', id), block: (id: string) => getRecord<BlockRecord>('block', id), webhooksAllowed: webhooksAllowed(col.space_id as string) };
    const issues = validateAutomation(trigger, actions, look);
    const wantActive = automation.status !== 'paused';
    if (wantActive && issues.length) throw new ApiError(issues[0].message);
    const now = Date.now();
    const existing = isId(automation.id) ? getRecord<AutomationRecord>('automation', automation.id) : undefined;
    if (existing && (existing.parent_id !== col.id || existing.alive === false)) throw new ApiError('Not found', 404);
    const recId = existing?.id ?? newId();
    // webhook header values are kept by the server; the record keeps placeholders (webhookSecrets.ts)
    try {
      actions = sealActions(automationOwner(recId), actions, { strict: true });
    } catch (e) {
      if (e instanceof WebhookSecretError) throw new ApiError(e.message, 400);
      throw e;
    }
    const name = str(automation.name, LIMITS.nameLength).trim();
    let rec: AutomationRecord = existing
      ? { ...existing, properties: { ...existing.properties, name }, scope, trigger, actions, status: wantActive ? 'active' : 'paused', paused_reason: wantActive ? null : existing.paused_reason ?? null, last_error: wantActive ? null : existing.last_error ?? null, last_edited_by_id: uid, last_edited_time: now }
      : {
        id: recId, version: 0, space_id: host.space_id, parent_table: 'collection', parent_id: col.id, alive: true, status: wantActive ? 'active' : 'paused',
        properties: { name }, scope, trigger, actions, created_by_id: uid, created_by_table: 'lit_user', created_time: now, last_edited_by_id: uid, last_edited_time: now, run_count: 0,
      };
    if (existing && JSON.stringify(existing.trigger) !== JSON.stringify(trigger)) rec = { ...rec, recurrence_runs: 0, next_run_time: null };
    rec = saveAutomationRecord(rec);
    if (rec.trigger.type === 'recurrence') rec = scheduleRecurrence(rec);
    else cancelJob(jobKey(rec.id));
    auditAutomation(existing ? 'automation_edited' : 'automation_created', rec, uid);
    return { automationId: rec.id, recordMap: recordMapFor(uid, [rec]) };
  },

  /** Active ⇄ paused (summary card ••• › Active, Restart). Re-enabling re-validates and clears the error. */
  setAutomationStatus(ctx, { automationId, status }) {
    const uid = requireUser(ctx);
    const { a, col } = automationOrThrow(automationId, uid);
    assertCanEdit(col, uid);
    let rec: AutomationRecord;
    if (status === 'active') {
      const look = { surface: 'automation' as const, collectionId: col.id, schema: col.schema, collection: (id: string) => getRecord<CollectionRecord>('collection', id), block: (id: string) => getRecord<BlockRecord>('block', id), webhooksAllowed: webhooksAllowed(col.space_id as string) };
      const issues = validateAutomation(a.trigger, a.actions, look);
      if (issues.length) throw new ApiError(issues[0].message);
      rec = saveAutomationRecord({ ...a, status: 'active', paused_reason: null, last_error: null, last_edited_by_id: uid, last_edited_time: Date.now() });
      if (rec.trigger.type === 'recurrence') rec = scheduleRecurrence(rec);
    } else {
      rec = saveAutomationRecord({ ...a, status: 'paused', paused_reason: null, last_edited_by_id: uid, last_edited_time: Date.now() });
      cancelJob(jobKey(rec.id));
    }
    auditAutomation('automation_edited', rec, uid);
    return { recordMap: recordMapFor(uid, [rec]) };
  },

  deleteAutomation(ctx, { automationId }) {
    const uid = requireUser(ctx);
    const { a, col } = automationOrThrow(automationId, uid);
    assertCanEdit(col, uid);
    const rec = saveAutomationRecord({ ...a, alive: false, last_edited_by_id: uid, last_edited_time: Date.now() });
    cancelJob(jobKey(rec.id));
    auditAutomation('automation_edited', rec, uid, { deleted: true });
    return { recordMap: recordMapFor(uid, [rec]) };
  },

  duplicateAutomation(ctx, { automationId }) {
    const uid = requireUser(ctx);
    const { a, col } = automationOrThrow(automationId, uid);
    assertCanEdit(col, uid);
    const now = Date.now();
    const copyId = newId();
    copySecrets(automationOwner(a.id), automationOwner(copyId)); // same database and editors: header values come along
    let rec = saveAutomationRecord({
      ...a, id: copyId, version: 0, properties: { ...a.properties, name: `${automationName(a)} (1)` }, created_by_id: uid, created_time: now, last_edited_by_id: uid,
      last_edited_time: now, run_count: 0, last_run_time: null, last_error: null, paused_reason: null, next_run_time: null, recurrence_runs: 0, template_id: null,
      actions: a.actions.map((s) => ({ ...s })),
    });
    if (rec.trigger.type === 'recurrence') rec = scheduleRecurrence(rec);
    auditAutomation('automation_created', rec, uid);
    return { automationId: rec.id, recordMap: recordMapFor(uid, [rec]) };
  },

  /** Run history (last 50 runs: success / error / skipped with the failing step). */
  getAutomationRuns(ctx, { automationId, limit }) {
    const uid = requireUser(ctx);
    const { a } = automationOrThrow(automationId, uid);
    return { runs: listRuns(a.id, Number(limit) || 50) };
  },

  /** Template ••• › Duplicate every… (null turns repeating off). The repeat is an automation owned by the caller. */
  setTemplateRecurrence(ctx, { templateId, recurrence }) {
    const uid = requireUser(ctx);
    const tpl = getRecord<BlockRecord>('block', String(templateId ?? ''));
    if (!tpl || tpl.alive === false || !tpl.is_template || tpl.parent_table !== 'collection') throw new ApiError('Not found', 404);
    const col = collectionOrThrow(tpl.parent_id, uid);
    const host = getRecord<BlockRecord>('block', col.parent_id)!;
    if (!roleAtLeast(blockRole(host.id, uid), 'read_and_write') || !isSpaceMember(getRecord<SpaceRecord>('space', host.space_id), uid)) throw new ApiError('You do not have access to edit this automation', 403);
    if (!hit(`automation-save:${uid}`, 120, 60_000)) throw new RateLimitError();
    const existing = templateRepeat(tpl.id);
    if (recurrence === null) {
      if (existing) {
        cancelJob(jobKey(existing.id));
        saveAutomationRecord({ ...existing, alive: false, last_edited_by_id: uid, last_edited_time: Date.now() });
      }
      return { automationId: null };
    }
    const rec = cleanRecurrence(recurrence);
    if (!rec || !recurrenceValid(rec)) throw new ApiError('Some required fields are missing');
    const nested = nestingProblem(tpl, rec);
    if (nested) throw new ApiError(`This template can’t be repeated. ${nested}`);
    const now = Date.now();
    const trigger: AutomationTrigger = { type: 'recurrence', recurrence: rec };
    const actions: AutomationAction[] = [{ id: 'repeat', type: 'add_page', collection_id: col.id, template_id: tpl.id, edits: [] }];
    let a: AutomationRecord = existing
      ? { ...existing, trigger, actions, status: 'active', paused_reason: null, last_error: null, created_by_id: uid, last_edited_by_id: uid, last_edited_time: now, recurrence_runs: 0, next_run_time: null }
      : {
        id: newId(), version: 0, space_id: host.space_id, parent_table: 'collection', parent_id: col.id, alive: true, status: 'active', properties: { name: '' }, scope: { type: 'collection' },
        trigger, actions, created_by_id: uid, created_by_table: 'lit_user', created_time: now, last_edited_by_id: uid, last_edited_time: now, run_count: 0, template_id: tpl.id,
      };
    a = saveAutomationRecord(a);
    a = scheduleRecurrence(a);
    auditAutomation(existing ? 'automation_edited' : 'automation_created', a, uid);
    return { automationId: a.id, nextRunTime: a.next_run_time ?? null, recordMap: recordMapFor(uid, [a]) };
  },

  /**
   * Button steps that run on the server: Send notification to… / Send webhook. The configuration is read from the
   * stored button (never from the request); the clicker needs edit access to the page holding the button.
   * `context.pages` maps earlier step ids to the pages they created/edited (client-side planned steps).
   */
  async runButtonServerSteps(ctx, body) {
    const uid = requireUser(ctx);
    if (!hit(`button-run:${uid}`, 60, 60_000)) throw new RateLimitError();
    const src = buttonSource(body, uid);
    const wanted = new Set(ids(body?.stepIds, LIMITS.steps));
    // messages and webhook bodies are built from what the clicker may see : rows they can't open and values
    // of properties hidden from them never leave in a payload, whoever configured the button
    const view = viewerQueryContext(uid);
    const msg = messageQueryContext(uid);
    const page = src.page ? (redactDatabaseRecord('block', src.page, uid) as BlockRecord) : undefined;
    const rc: RunContext = {
      kind: 'button',
      getRecord: (t, id) => msg.getRecord!(t, id),
      rowsOf: (cid) => msg.rowsOf!(cid) ?? [],
      actorId: uid, runAsId: uid, page, now: Date.now(), timeZone: userTimeZone(uid) ?? 'UTC', spaceId: src.spaceId, newId,
    };
    const planner = new AutomationPlanner(rc);
    // recipients: a Person property of the clicked page names them even when the clicker can't see its values
    const readable = readableQueryContext(uid);
    const recipients = new AutomationPlanner({ ...rc, getRecord: (t, id) => readable.getRecord!(t, id), rowsOf: (cid) => (readable.rowsOf!(cid) ?? []).filter((r) => readable.canRead(r.id)), page: src.page });
    const stepPages = (body?.context?.pages && typeof body.context.pages === 'object') ? body.context.pages as Record<string, unknown> : {};
    const results: { stepId: string; ok: boolean; message?: string }[] = [];
    for (const step of src.steps) {
      try {
        if (step.type === 'define_variables') planner.defineVariables(step);
        else if ((step.type === 'add_page' || step.type === 'edit_pages' || step.type === 'edit_property') && Array.isArray(stepPages[step.id])) {
          const readable = ids(stepPages[step.id], LIMITS.pagesPerAction).filter((id) => blockRole(id, uid) !== 'none');
          planner.stepPages.set(step.id, { ids: readable, single: step.type !== 'edit_pages' });
        }
        if (!wanted.has(step.id)) continue;
        if (step.type === 'notify') {
          const targets = recipients.notifyTargets(step);
          if (!targets.length) throw new AutomationError('Choose at least one recipient');
          const rich = planner.message(step.message);
          const text = planner.plainOf(planner.fromFValue({ type: 'text', value: rich }));
          const pageId = src.page?.id;
          for (const target of targets) {
            if (pageId && blockRole(pageId, target) === 'none') continue;
            pushNotification({
              user_id: target, space_id: src.spaceId, type: 'automation' as NotificationRecord['type'], navigable_block_id: pageId, actor_id: uid,
              activity: { kind: 'message', button: true, automation_name: src.label, message: text.slice(0, LIMITS.messageLength), message_rich: rich, page_id: pageId },
            });
          }
          results.push({ stepId: step.id, ok: true });
        } else if (step.type === 'webhook') {
          if (isDemoMode()) throw new AutomationError(DEMO_MESSAGE);
          if (!webhooksAllowed(src.spaceId)) throw new AutomationError('This feature is disabled in your workspace');
          if (!hit(`button-webhook:${src.block?.id ?? src.page?.id}`, 30, 60_000)) throw new AutomationError('Too many webhook requests. Try again later.');
          let host = step.url;
          try { host = new URL(step.url).host; } catch { throw new AutomationError('Enter a valid URL'); }
          const pageCol = page?.parent_table === 'collection' ? (view.getRecord!('collection', page.parent_id) as CollectionRecord | undefined) : undefined;
          // DB buttons can't choose the content: the clicked page's properties are sent  — those the clicker
          // can see ("No access" ones aren't in their schema, hidden values aren't on their page)
          const payload = webhookPayload(page, pageCol, src.sourceType === 'button_property' ? 'all' : step.properties, { automationId: src.block?.id ?? `${page?.parent_id}:${src.propertyId}`, actionId: step.id, eventId: newId(), sourceType: src.sourceType }, view);
          // stored header values (secrets) are applied here only, never read from the button record
          const headers: Record<string, string> = { 'content-type': 'application/json', accept: '*/*', ...resolveHeaders(src.owner, step) };
          try {
            const res = await safeFetch(step.url, { method: 'POST', body: JSON.stringify(payload), headers, timeoutMs: 10_000, maxBytes: 64 * 1024 });
            if (res.status < 200 || res.status >= 300) throw new AutomationError(`${host} returned HTTP ${res.status}`);
          } catch (e) {
            if (e instanceof AutomationError) throw e;
            if (e instanceof FetchBlockedError) throw new AutomationError('Enter a valid URL');
            throw new AutomationError((e as { name?: string })?.name === 'AbortError' ? 'The button could not finish because the webhook timed out' : `Could not reach ${host}`);
          }
          results.push({ stepId: step.id, ok: true });
        }
      } catch (e) {
        if (!(e instanceof AutomationError)) throw e;
        if (wanted.has(step.id)) {
          results.push({ stepId: step.id, ok: false, message: e.message });
          return { ok: false, message: e.message, results };
        }
      }
    }
    return { ok: true, results };
  },

  /** Dev/test helper: evaluate pending trigger windows immediately (never exposed in production). */
  async flushAutomationsForTests(ctx) {
    requireUser(ctx);
    if (process.env.NODE_ENV === 'production' || process.env.NC_DEV_LOGIN_CODES !== '1') throw new ApiError('Not found', 404);
    await flushAutomations();
    return {};
  },
};

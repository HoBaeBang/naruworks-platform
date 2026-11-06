// Database automation engine (…025). Runs server-side so automations fire no matter which client (or
// form submission, button, API call) changed the data:
//   - every committed transaction (records.ts onCommit) is scanned for rows of databases that have active event
//     automations; each touched page gets a detection window of about 3 seconds after which the page is compared
//     with its value before the window — only the net change counts;
//   - matching automations run as their creator (permissions of the creator — ): data steps are
//     planned with the shared planner and committed in one applyTransactions call with source 'automation', which
//     this engine ignores (automations never trigger automations — ); repeating templates use source
//     'recurring_template' ; buttons are ordinary client writes, so they do trigger ;
//   - "Every…" triggers and repeating templates are jobs in the persistent scheduler (scheduler.ts);
//   - a failing run pauses the automation , records the error and notifies its creator (024.3).
import { newId } from '@nc/shared/ids.ts';
import { isSpaceMember, roleAtLeast } from '@nc/shared/permissions.ts';
import { isArchivedRecord } from '@nc/shared/archive.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, NotificationRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { combinedFilter, matchesFilter } from '@nc/shared/database/index.ts';
import {
  AutomationError, AutomationPlanner, LIMITS, nextOccurrence, planDataSteps, triggerMatches, validateAutomation, webhookPayload,
  type AutomationAction, type AutomationRecord, type AutomationRun, type RunContext,
} from '@nc/shared/automation/index.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { childrenOf, db, getRecord, putRecord } from '../db.ts';
import { applyTransactions, blockRole, onBeforePersist, onCommit, TransactionError, type CommitInfo } from '../records.ts';
import { automationOwner, copySecrets, migrateWebhookSecrets, resolveHeaders, sealActions, sealChangedRecords } from '../webhookSecrets.ts';
import { DEMO_MESSAGE, isDemoMode } from '../demo.ts';
import { realtime } from '../realtime.ts';
import { messageQueryContext, readableQueryContext, viewerQueryContext } from '../queryctx.ts';
import { redactDatabaseRecord } from '../propaccess.ts';
import { registerJobHandler, scheduleJob, cancelJob } from '../scheduler.ts';
import { pushNotification } from '../notify.ts';
import { safeFetch, FetchBlockedError } from '../safefetch.ts';
import { hit } from '../ratelimit.ts';
import { instantiateTemplate, TemplateError, userTimeZone } from './templates.ts';

/** Detection window: ~3 seconds. Tests shorten it with NC_AUTOMATION_WINDOW_MS. */
export function windowMs(): number {
  const v = Number(process.env.NC_AUTOMATION_WINDOW_MS);
  return Number.isFinite(v) && v >= 0 ? v : 3000;
}

db.exec(`
CREATE TABLE IF NOT EXISTS automation_runs (
  id TEXT PRIMARY KEY,
  automation_id TEXT NOT NULL,
  time INTEGER NOT NULL,
  status TEXT NOT NULL,
  page_id TEXT,
  step_id TEXT,
  message TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_automation_runs ON automation_runs(automation_id, time);
`);
const runIns = db.prepare('INSERT INTO automation_runs (id, automation_id, time, status, page_id, step_id, message, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
const runList = db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY time DESC LIMIT ?');
const runPrune = db.prepare('DELETE FROM automation_runs WHERE automation_id = ? AND time < (SELECT MIN(time) FROM (SELECT time FROM automation_runs WHERE automation_id = ? ORDER BY time DESC LIMIT 100))');

export function listRuns(automationId: string, limit = 50): AutomationRun[] {
  return (runList.all(automationId, Math.min(Math.max(limit, 1), 100)) as any[]).map((r) => ({
    id: r.id, time: r.time, status: r.status, page_id: r.page_id ?? undefined, step_id: r.step_id ?? undefined, message: r.message ?? undefined, duration_ms: r.duration_ms ?? undefined,
  }));
}

function recordRun(a: AutomationRecord, run: Omit<AutomationRun, 'id' | 'time'> & { time?: number }) {
  const time = run.time ?? Date.now();
  runIns.run(newId(), a.id, time, run.status, run.page_id ?? null, run.step_id ?? null, run.message ? run.message.slice(0, 500) : null, run.duration_ms ?? null);
  runPrune.run(a.id, a.id);
}

// ------------------------------------------------------------------ records

export function automationsOf(collectionId: string): AutomationRecord[] {
  return childrenOf<AutomationRecord>('automation', collectionId).filter((a) => a.alive !== false && a.parent_table === 'collection');
}

/** Persist a server-owned change of an automation record and push it to open clients. */
export function saveAutomationRecord(a: AutomationRecord): AutomationRecord {
  const prev = getRecord<AutomationRecord>('automation', a.id);
  const next = { ...a, version: (prev?.version ?? 0) + 1 } as AutomationRecord;
  putRecord('automation', next);
  realtime.broadcastChanges([{ table: 'automation', record: next, spaceId: next.space_id ?? null }]);
  return next;
}

function patchAutomation(id: string, patch: Partial<AutomationRecord>): AutomationRecord | null {
  const cur = getRecord<AutomationRecord>('automation', id);
  if (!cur) return null;
  return saveAutomationRecord({ ...cur, ...patch });
}

export function automationName(a: AutomationRecord): string {
  if (a.properties?.name) return a.properties.name;
  const u = getRecord<UserRecord>('lit_user', a.created_by_id);
  return u?.name ? `${u.name}’s automation` : 'Automation';
}

export function webhooksAllowed(spaceId: string): boolean {
  if (process.env.NODE_ENV === 'production' && process.env.NC_AUTOMATION_WEBHOOKS !== '1') return false;
  const space = getRecord<SpaceRecord>('space', spaceId);
  return (space?.settings as any)?.disallow_webhook_automation_action !== true;
}

// ------------------------------------------------------------------ permissions

/** workspace members with full access to the database create / edit / delete automations (/2). */
export function automationEditProblem(collection: CollectionRecord | undefined, userId: string | null): string | null {
  if (!collection || !userId) return 'Not found';
  const host = getRecord<BlockRecord>('block', collection.parent_id);
  if (!host) return 'Not found';
  const space = getRecord<SpaceRecord>('space', host.space_id);
  const role = blockRole(host.id, userId);
  if (role === 'none') return 'Not found';
  if (!isSpaceMember(space, userId)) return 'Join this workspace before editing automations';
  if (!roleAtLeast(role, 'editor')) return 'Full access to this database is required to edit automations';
  if (host.alive === false) return 'This database is in the trash and cannot be edited.';
  return null;
}

// ------------------------------------------------------------------ running

export interface RunInput {
  page?: BlockRecord;
  actorId: string;
  now?: number;
  source?: 'automation' | 'recurring_template';
}

export interface RunResult {
  status: 'success' | 'error' | 'skipped';
  message?: string;
  created: string[];
  edited: string[];
}

function lookupsFor(a: AutomationRecord) {
  const col = getRecord<CollectionRecord>('collection', a.parent_id);
  return {
    surface: 'automation' as const,
    collectionId: a.parent_id,
    schema: col?.schema,
    collection: (id: string) => getRecord<CollectionRecord>('collection', id),
    block: (id: string) => getRecord<BlockRecord>('block', id),
    webhooksAllowed: col ? webhooksAllowed(col.space_id as string) : true,
  };
}

function pauseFor(a: AutomationRecord, reason: AutomationRecord['paused_reason'], message: string, stepId?: string) {
  const cur = getRecord<AutomationRecord>('automation', a.id) ?? a;
  const updated = saveAutomationRecord({ ...cur, status: 'paused', paused_reason: reason, last_error: { message, step_id: stepId, time: Date.now() } });
  if (updated.trigger.type === 'recurrence') cancelJob(jobKey(updated.id));
  // the creator hears about it ; the notification links to the database
  const col = getRecord<CollectionRecord>('collection', a.parent_id);
  const host = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
  if (host && blockRole(host.id, a.created_by_id) !== 'none') {
    pushNotification({
      user_id: a.created_by_id, space_id: host.space_id, type: 'automation' as NotificationRecord['type'], navigable_block_id: host.id,
      activity: { kind: 'paused', automation_id: a.id, automation_name: automationName(a), message, page_id: host.id, collection_id: col!.id },
    });
  }
  return updated;
}

function runContext(a: AutomationRecord, input: RunInput, spaceId: string): RunContext {
  const q = readableQueryContext(a.created_by_id);
  return {
    kind: 'automation',
    getRecord: (t, id) => q.getRecord!(t, id),
    // rows the creator can't open (page-level access rules, restricted rows) are never read or edited by the run
    rowsOf: (cid) => (q.rowsOf!(cid) ?? []).filter((r) => !isArchivedRecord(r) && q.canRead(r.id)),
    actorId: input.actorId,
    runAsId: a.created_by_id,
    page: input.page,
    now: input.now ?? Date.now(),
    timeZone: userTimeZone(a.created_by_id) ?? 'UTC',
    spaceId,
    newId,
  };
}

/**
 * Messages and webhook bodies are built from what the automation's creator may see (viewerQueryContext):
 * rows they can't open and values of properties hidden from them never leave in a payload. The data steps already ran
 * (`data`): pages they produced are shared, variables are evaluated again on this view.
 */
function payloadPlanner(a: AutomationRecord, input: RunInput, spaceId: string, data: AutomationPlanner): AutomationPlanner {
  const q = messageQueryContext(a.created_by_id);
  const out = new AutomationPlanner({
    ...data.ctx,
    getRecord: (t, id) => q.getRecord!(t, id),
    rowsOf: (cid) => (q.rowsOf!(cid) ?? []).filter((r) => !isArchivedRecord(r) && q.canRead(r.id)),
    page: input.page ? (redactDatabaseRecord('block', input.page, a.created_by_id) as BlockRecord) : undefined,
    spaceId,
  });
  for (const [k, v] of data.stepPages) out.stepPages.set(k, v);
  for (const step of a.actions) {
    if (step.type !== 'define_variables') continue;
    try {
      out.defineVariables(step);
    } catch {
      /* a variable that only works on hidden values stays empty in messages */
    }
  }
  return out;
}

async function sendWebhook(a: AutomationRecord, step: Extract<AutomationAction, { type: 'webhook' }>, planner: AutomationPlanner, col: CollectionRecord) {
  if (isDemoMode()) throw new AutomationError(DEMO_MESSAGE, 'webhook_disabled', step.id);
  if (!webhooksAllowed(col.space_id as string)) throw new AutomationError('This feature is disabled in your workspace', 'webhook_disabled', step.id);
  if (!hit(`automation-webhook:${a.id}`, 60, 60_000) || !hit(`automation-webhook-space:${col.space_id}`, 600, 60_000)) throw new AutomationError('Too many webhook requests. Try again later.', 'rate_limited', step.id);
  // the creator's view: hidden values are off the page, "No access" properties out of the schema (payloadPlanner)
  const view = viewerQueryContext(a.created_by_id);
  const page = planner.ctx.page ? planner.get<BlockRecord>('block', planner.ctx.page.id) : undefined;
  const pageCol = page?.parent_table === 'collection' ? (view.getRecord!('collection', page.parent_id) as CollectionRecord | undefined) : undefined;
  const body = webhookPayload(page, pageCol, step.properties, { automationId: a.id, actionId: step.id, eventId: newId(), sourceType: 'automation' }, view);
  // custom header values are secrets the server keeps (webhookSecrets.ts); the record only has placeholders
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: '*/*', ...resolveHeaders(automationOwner(a.id), step) };
  let host = step.url;
  try { host = new URL(step.url).host; } catch { /* reported below */ }
  try {
    const res = await safeFetch(step.url, { method: 'POST', body: JSON.stringify(body), headers, timeoutMs: 10_000, maxBytes: 64 * 1024 });
    if (res.status < 200 || res.status >= 300) throw new AutomationError(`${host} returned HTTP ${res.status}`, 'webhook_failed', step.id);
  } catch (e) {
    if (e instanceof AutomationError) throw e;
    if (e instanceof FetchBlockedError) throw new AutomationError('Enter a valid URL', 'webhook_failed', step.id);
    const timeout = (e as { name?: string })?.name === 'AbortError';
    throw new AutomationError(timeout ? 'Webhook request timed out' : `Could not reach ${host}`, 'webhook_failed', step.id);
  }
}

/** Recipients come from the run (`planner`), the message from the creator's view (`payload`, see payloadPlanner). */
function sendNotifications(a: AutomationRecord, step: Extract<AutomationAction, { type: 'notify' }>, planner: AutomationPlanner, payload: AutomationPlanner, host: BlockRecord) {
  const targets = planner.notifyTargets(step).slice(0, LIMITS.notifyUsers);
  const rich = payload.message(step.message);
  const text = payload.plainOf(payload.fromFValue({ type: 'text', value: rich as RichText }));
  const pageId = planner.ctx.page?.id ?? host.id;
  for (const uid of targets) {
    // only people who can open the page hear about it
    if (blockRole(pageId, uid) === 'none') continue;
    pushNotification({
      user_id: uid, space_id: host.space_id, type: 'automation' as NotificationRecord['type'], navigable_block_id: pageId, actor_id: planner.ctx.actorId,
      activity: { kind: 'message', automation_id: a.id, automation_name: automationName(a), message: text.slice(0, LIMITS.messageLength), message_rich: rich, page_id: pageId },
    });
  }
}

/** Run one automation for one trigger event (or a schedule tick). Never throws. */
export async function runAutomation(a: AutomationRecord, input: RunInput): Promise<RunResult> {
  if (isDemoMode()) return { status: 'error', message: DEMO_MESSAGE, created: [], edited: [] };
  const started = Date.now();
  const empty: RunResult = { status: 'skipped', created: [], edited: [] };
  const col = getRecord<CollectionRecord>('collection', a.parent_id);
  const host = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
  if (!col || !host || host.alive === false || col.alive === false) return empty;
  const creator = a.created_by_id;
  // the creator keeps full access to the database, else the automation pauses (permission loss)
  if (!roleAtLeast(blockRole(host.id, creator), 'editor') || !isSpaceMember(getRecord<SpaceRecord>('space', host.space_id), creator)) {
    pauseFor(a, 'permission', 'This automation paused after losing access to one of its targets. Update the target, then enable it again.');
    recordRun(a, { status: 'error', page_id: input.page?.id, message: 'Permission lost' });
    return { ...empty, status: 'error', message: 'Permission lost' };
  }
  // restricted pages the creator can't open are left alone 
  if (input.page && blockRole(input.page.id, creator) === 'none') {
    recordRun(a, { status: 'skipped', page_id: input.page.id, message: 'Page is not accessible to the automation owner' });
    return empty;
  }
  const issues = validateAutomation(a.trigger, a.actions, lookupsFor(a));
  if (issues.length) {
    pauseFor(a, 'error', issues[0].message, issues[0].stepId);
    recordRun(a, { status: 'error', page_id: input.page?.id, step_id: issues[0].stepId, message: issues[0].message });
    return { ...empty, status: 'error', message: issues[0].message };
  }
  const planner = new AutomationPlanner(runContext(a, input, host.space_id));
  try {
    planDataSteps(planner, a.actions);
    if (planner.ops.length) {
      applyTransactions(creator, [{ id: newId(), spaceId: host.space_id, debug: { userAction: 'automation' }, operations: planner.ops }], undefined, { source: input.source ?? 'automation' });
    }
    for (const t of planner.templates) instantiateTemplate(t.rowId, t.templateId, creator, { source: input.source ?? 'automation', override: true, actorId: input.actorId });
    const payload = a.actions.some((s) => s.type === 'notify' || s.type === 'webhook') ? payloadPlanner(a, input, host.space_id, planner) : planner;
    for (const step of a.actions) {
      if (step.type === 'notify') sendNotifications(a, step, planner, payload, host);
      else if (step.type === 'webhook') await sendWebhook(a, step, payload, col);
    }
    const cur = getRecord<AutomationRecord>('automation', a.id) ?? a;
    saveAutomationRecord({ ...cur, last_run_time: Date.now(), run_count: (cur.run_count ?? 0) + 1 });
    recordRun(a, { status: 'success', page_id: input.page?.id, duration_ms: Date.now() - started });
    return { status: 'success', created: planner.created, edited: [...planner.edited] };
  } catch (e) {
    let message = 'Automation paused due to unexpected error';
    let stepId: string | undefined;
    let reason: AutomationRecord['paused_reason'] = 'error';
    if (e instanceof AutomationError) { message = e.message; stepId = e.stepId; }
    else if (e instanceof TransactionError) { message = e.status === 403 ? 'This action cannot access one of its records' : e.message; reason = e.status === 403 ? 'permission' : 'error'; }
    else if (e instanceof TemplateError) { message = 'The add-page template is invalid'; }
    else console.error('[automation] run failed', a.id, e);
    pauseFor(a, reason, message, stepId);
    recordRun(a, { status: 'error', page_id: input.page?.id, step_id: stepId, message, duration_ms: Date.now() - started });
    return { status: 'error', message, created: planner.created, edited: [...planner.edited] };
  }
}

// ------------------------------------------------------------------ event triggers (detection window)

interface Pending {
  collectionId: string;
  pageId: string;
  baseline: BlockRecord | undefined;
  actorId: string;
  firstAt: number;
  timer: ReturnType<typeof setTimeout> | null;
}
const pending = new Map<string, Pending>();
const inflight = new Set<Promise<unknown>>();

function hasEventAutomations(collectionId: string): boolean {
  return automationsOf(collectionId).some((a) => a.status === 'active' && a.trigger.type === 'event' && a.trigger.events.length > 0);
}

function schedule(p: Pending) {
  if (p.timer) clearTimeout(p.timer);
  const w = windowMs();
  // debounce within the window, but never wait longer than 4 windows after the first change
  const delay = Math.max(0, Math.min(w, p.firstAt + 4 * w - Date.now()));
  p.timer = setTimeout(() => {
    const job = fire(p.pageId);
    inflight.add(job);
    void job.finally(() => inflight.delete(job));
  }, delay);
  p.timer.unref?.();
}

async function fire(pageId: string) {
  const p = pending.get(pageId);
  if (!p) return;
  pending.delete(pageId);
  if (p.timer) clearTimeout(p.timer);
  const after = getRecord<BlockRecord>('block', p.pageId);
  const col = getRecord<CollectionRecord>('collection', p.collectionId);
  if (!after || !col) return;
  const host = getRecord<BlockRecord>('block', col.parent_id);
  if (!host || host.alive === false) return;
  // a locked database does not trigger automations 
  if ((host.format as any)?.block_locked) return;
  if (isArchivedRecord(after)) return;
  for (const a of automationsOf(col.id)) {
    if (a.status !== 'active' || a.trigger.type !== 'event') continue;
    try {
      const q = readableQueryContext(a.created_by_id);
      if (!triggerMatches(a.trigger, { before: p.baseline, after, collection: col, ctx: q })) continue;
      // "For pages in <view>": the page must (still) match the view's filters after the edit 
      if (a.scope?.type === 'view') {
        const view = getRecord<CollectionViewRecord>('collection_view', a.scope.view_id);
        if (!view || view.alive === false) continue;
        const f = combinedFilter(view);
        if (f && !matchesFilter(after, f, col.schema, q)) continue;
      }
      await runAutomation(a, { page: after, actorId: p.actorId });
    } catch (e) {
      console.error('[automation] trigger evaluation failed', a.id, e);
    }
  }
}

/** Ids inside an automation config that point at the source database (its views, itself) → the copy's. */
function remapIds<T>(value: T, idMap: Map<string, string>): T {
  let s = JSON.stringify(value ?? null);
  for (const [from, to] of idMap) if (s.includes(from)) s = s.split(`"${from}"`).join(`"${to}"`);
  return JSON.parse(s) as T;
}

/** Duplicated databases bring their automations along — duplicating a page, a template from the gallery (Sales
 *  Pipeline, Applicant Tracker… ship with automations) or a database template with an inline database .
 *  The copies belong to the person who duplicated the database and act on the copy: the source database id, its
 *  host block and its views are re-pointed. Repeating-template automations are not copied (templates aren't). */
function copyAutomationsOfDuplicates(info: CommitInfo) {
  if (isDemoMode()) return;
  for (const ch of info.changes) {
    if (ch.table !== 'block') continue;
    const b = ch.record as BlockRecord;
    if (info.prev.get(`block:${b.id}`) || !b.copied_from || !b.collection_id || (b.type !== 'collection_view_page' && b.type !== 'collection_view')) continue;
    const src = getRecord<BlockRecord>('block', b.copied_from);
    if (!src?.collection_id || src.collection_id === b.collection_id) continue;
    const col = getRecord<CollectionRecord>('collection', b.collection_id);
    if (!col || col.parent_id !== b.id) continue; // a linked view: the automations stay with their database
    const list = automationsOf(src.collection_id).filter((a) => a.alive !== false && !a.template_id);
    if (!list.length || automationEditProblem(col, info.userId)) continue;
    const idMap = new Map<string, string>([[src.collection_id, col.id], [src.id, b.id]]);
    const srcViews = src.view_ids ?? [];
    if (srcViews.length === (b.view_ids ?? []).length) srcViews.forEach((v, i) => idMap.set(v, b.view_ids![i]));
    for (const a of list) {
      const now = Date.now();
      const scope = a.scope?.type === 'view' && !idMap.has(a.scope.view_id) ? { type: 'collection' as const } : remapIds(a.scope, idMap);
      let rec: AutomationRecord = {
        id: newId(), version: 0, space_id: col.space_id as string, parent_table: 'collection', parent_id: col.id, alive: true,
        status: a.status === 'active' ? 'active' : 'paused', properties: { ...a.properties }, ...(scope ? { scope } : {}),
        trigger: remapIds(a.trigger, idMap), actions: remapIds(a.actions, idMap),
        created_by_id: info.userId, created_by_table: 'lit_user', created_time: now, last_edited_by_id: info.userId, last_edited_time: now, run_count: 0,
      } as AutomationRecord;
      // stored webhook header values come along only for people with full access to the original database (they can
      // edit — and fire — its automations already); anyone else's copy asks for them again
      if (roleAtLeast(blockRole(src.id, info.userId), 'editor')) copySecrets(automationOwner(a.id), automationOwner(rec.id));
      rec.actions = sealActions(automationOwner(rec.id), rec.actions);
      if (rec.status === 'active' && validateAutomation(rec.trigger, rec.actions, lookupsFor(rec)).length) rec.status = 'paused';
      rec = saveAutomationRecord(rec);
      if (rec.trigger.type === 'recurrence') scheduleRecurrence(rec);
    }
  }
}

function onCommitted(info: CommitInfo) {
  copyAutomationsOfDuplicates(info);
  // automations never trigger automations; repeating templates don't either
  if (info.source === 'automation' || info.source === 'recurring_template') return;
  const now = Date.now();
  // rows of a database created by this very commit (a duplicated page, a template's inline database) are copies,
  // not pages added by someone — the automations copied with that database must not fire for them
  const newCollections = new Set(info.changes.filter((c) => c.table === 'collection' && !info.prev.get(`collection:${c.record.id}`)).map((c) => c.record.id));
  for (const ch of info.changes) {
    if (ch.table !== 'block') continue;
    const after = ch.record as BlockRecord;
    const before = info.prev.get(`block:${after.id}`) as BlockRecord | undefined;
    const colId = after.parent_table === 'collection' ? after.parent_id : before?.parent_table === 'collection' ? before.parent_id : null;
    if (!colId || after.is_template || newCollections.has(colId)) continue;
    let p = pending.get(after.id);
    if (!p) {
      if (!hasEventAutomations(colId)) continue;
      p = { collectionId: colId, pageId: after.id, baseline: before, actorId: info.userId, firstAt: now, timer: null };
      pending.set(after.id, p);
    } else p.actorId = info.userId;
    schedule(p);
  }
}

/** Tests / dev: evaluate every pending window now and wait for the runs. */
export async function flushAutomations(): Promise<void> {
  const ids = [...pending.keys()];
  await Promise.all(ids.map((id) => fire(id)));
  await Promise.all([...inflight]);
}

// ------------------------------------------------------------------ recurrence ("Every…" triggers, repeating templates)

const JOB_KIND = 'automation.recurrence';
export function jobKey(id: string) {
  return `automation:${id}`;
}

/** (Re)compute the next run of a recurring automation and (re)schedule its job. */
export function scheduleRecurrence(a: AutomationRecord, from = Date.now()): AutomationRecord {
  cancelJob(jobKey(a.id));
  if (a.alive === false || a.status !== 'active' || a.trigger.type !== 'recurrence' || !a.trigger.recurrence) {
    if (a.next_run_time) return saveAutomationRecord({ ...a, next_run_time: null });
    return a;
  }
  const next = nextOccurrence(a.trigger.recurrence, from, a.recurrence_runs ?? 0);
  if (next === null) return saveAutomationRecord({ ...a, status: 'completed', next_run_time: null });
  scheduleJob(JOB_KIND, jobKey(a.id), next, { id: a.id, at: next });
  return a.next_run_time === next ? a : saveAutomationRecord({ ...a, next_run_time: next });
}

async function runRecurrence(payload: { id: string; at?: number }) {
  const a = getRecord<AutomationRecord>('automation', String(payload?.id ?? ''));
  if (!a || a.alive === false || a.status !== 'active' || a.trigger.type !== 'recurrence') return;
  const now = Date.now();
  const updated = saveAutomationRecord({ ...a, recurrence_runs: (a.recurrence_runs ?? 0) + 1 });
  // repeating templates: created by the template's owner, not triggering other automations
  await runAutomation(updated, { actorId: a.created_by_id, now, source: a.template_id ? 'recurring_template' : 'automation' });
  const fresh = getRecord<AutomationRecord>('automation', a.id);
  if (fresh && fresh.status === 'active') scheduleRecurrence(fresh, Math.max(now, payload?.at ?? now));
}

let started = false;
export function startAutomationEngine() {
  if (started) return;
  started = true;
  onCommit(onCommitted);
  // webhook header values of buttons are sealed before any write is persisted; old stored values are migrated
  onBeforePersist((changed, userId) => sealChangedRecords(changed, (id) => blockRole(id, userId)));
  try {
    migrateWebhookSecrets();
  } catch (e) {
    console.error('[automation] webhook secret migration failed', e);
  }
  registerJobHandler(JOB_KIND, (p) => runRecurrence(p));
}
startAutomationEngine();

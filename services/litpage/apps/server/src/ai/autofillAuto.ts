// AI Autofill "auto-update on page edits": a database property configured with schema[prop].ai_autofill =
// { kind, prompt?, language?, auto_update: true } is refilled a few seconds after a row is created or edited (its
// properties or its page content). Runs as the editing user (their permissions and AI rate limit), through an
// ordinary transaction tagged "aiAutofill.auto" — changes made by autofill itself never retrigger it.
import { newId } from '@nc/shared/ids.ts';
import type { BaseRecord, BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { stableJson } from '../authz.ts';
import { getRecord } from '../db.ts';
import { aiAllowed } from '../ratelimit.ts';
import { applyTransactions, onCommit, type CommitInfo } from '../records.ts';
import { aiConfigured, logAiError, type ClaudeLike } from './client.ts';
import { runAutofill } from './service.ts';
import type { AutofillKind } from './prompts.ts';
import { isDemoMode } from '../demo.ts';

export interface AutofillConfig {
  kind: AutofillKind;
  prompt?: string;
  language?: string;
  auto_update?: boolean;
}

export const AUTOFILL_ACTION = 'aiAutofill.auto';
const DEBOUNCE_MS = Number(process.env.NC_AI_AUTOFILL_DEBOUNCE_MS) || 3000;
const timers = new Map<string, { timer: ReturnType<typeof setTimeout>; userId: string }>();
// unit tests swap in a fake Claude client; production uses the shared client
let clientOverride: ClaudeLike | undefined;
export function setAutofillClientForTests(client: ClaudeLike | undefined) {
  clientOverride = client;
}

export function autofillConfig(prop: PropertySchema | undefined): AutofillConfig | null {
  const c = (prop as Record<string, unknown> | undefined)?.ai_autofill as AutofillConfig | undefined;
  return c && typeof c === 'object' && ['summary', 'keywords', 'translation', 'custom'].includes(c.kind) ? c : null;
}

function autoProps(col: CollectionRecord | undefined): [string, AutofillConfig][] {
  if (!col) return [];
  return Object.entries(col.schema).map(([pid, p]) => [pid, autofillConfig(p)] as [string, AutofillConfig | null]).filter((x): x is [string, AutofillConfig] => !!x[1]?.auto_update);
}

/** The database row a block belongs to (itself, or the row page whose content holds it). */
function rowOf(b: BlockRecord | undefined): BlockRecord | null {
  let cur = b;
  for (let i = 0; i < 30 && cur; i++) {
    if (cur.parent_table === 'collection') return cur;
    if (cur.parent_table !== 'block' || cur.type === 'page' && i > 0) return null;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  return null;
}

async function fill(rowId: string, userId: string) {
  if (isDemoMode()) return;
  const row = getRecord<BlockRecord>('block', rowId);
  if (!row || row.alive === false || row.parent_table !== 'collection') return;
  const col = getRecord<CollectionRecord>('collection', row.parent_id);
  for (const [pid, cfg] of autoProps(col)) {
    if (!aiConfigured() || !aiAllowed(userId)) return;
    try {
      const r = await runAutofill({ userId, rowId, propId: pid, kind: cfg.kind, prompt: cfg.prompt, language: cfg.language }, clientOverride);
      const cur = getRecord<BlockRecord>('block', rowId);
      if (!cur || cur.alive === false) return;
      if (stableJson(cur.properties?.[pid] ?? []) === stableJson(r.value)) continue;
      applyTransactions(userId, [{
        id: newId(), spaceId: cur.space_id, debug: { userAction: AUTOFILL_ACTION },
        operations: [{ pointer: { table: 'block', id: rowId, spaceId: cur.space_id }, path: ['properties', pid], command: 'set', args: r.value }],
      }], undefined, { client: true });
    } catch (e) {
      logAiError('autofill (auto-update)', e);
    }
  }
}

function schedule(rowId: string, userId: string) {
  const prev = timers.get(rowId);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    timers.delete(rowId);
    void fill(rowId, userId);
  }, DEBOUNCE_MS);
  (timer as { unref?: () => void }).unref?.();
  timers.set(rowId, { timer, userId });
}

/** Commit hook: schedule autofill for rows whose content changed (not by autofill itself). */
export function onAutofillCommit(info: CommitInfo) {
  if (isDemoMode() || !aiConfigured()) return;
  if (info.transactions.some((t) => t.debug?.userAction === AUTOFILL_ACTION || t.debug?.userAction === 'aiAutofill')) return;
  const rows = new Set<string>();
  for (const ch of info.changes) {
    if (ch.table !== 'block') continue;
    const b = ch.record as BlockRecord;
    const row = rowOf(b);
    if (!row) continue;
    const col = getRecord<CollectionRecord>('collection', row.parent_id);
    const auto = autoProps(col);
    if (!auto.length) continue;
    if (b.id === row.id) {
      // only autofill properties changed (e.g. the user typed into one) → nothing to refill
      const before = info.prev.get(`block:${b.id}`) as BaseRecord | undefined as BlockRecord | undefined;
      const changedKeys = new Set<string>();
      const keys = new Set([...Object.keys(before?.properties ?? {}), ...Object.keys(b.properties ?? {})]);
      for (const k of keys) if (stableJson(before?.properties?.[k]) !== stableJson(b.properties?.[k])) changedKeys.add(k);
      const created = !before;
      if (!created && [...changedKeys].every((k) => auto.some(([pid]) => pid === k))) continue;
      if (!created && !changedKeys.size && stableJson(before?.content) === stableJson(b.content)) continue;
    }
    rows.add(row.id);
  }
  for (const id of rows) schedule(id, info.userId);
}

let installed = false;
export function installAutofillHook() {
  if (installed) return;
  installed = true;
  onCommit(onAutofillCommit);
}

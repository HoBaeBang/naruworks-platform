// "Send webhook" custom header values are write-only secrets. Headers usually carry API tokens, and the
// records holding them reach every viewer of a database (automations) or page (button blocks, button properties), so
// records only keep WEBHOOK_SECRET_MASK for a stored value; the values live in `webhook_secrets` and only the server
// applies them when the webhook fires.
// - saving the placeholder keeps the stored value; an empty value removes it; any other value replaces it
// - pointing a webhook at another site (URL origin) drops the stored values (saving an automation is refused), so a
// person who can edit the step can't send a stored token to a server of their choosing
// - copies (Duplicate, database templates, duplicated databases, duplicating an automation) take the values along
// only when the person copying can edit the original — they can click that button / edit that automation already;
// anyone else's copy (a reader duplicating a page) asks for them again
// - client writes of button blocks / button properties are sealed before they are persisted (records.ts
// onBeforePersist); values stored before this existed are migrated at startup (migrateWebhookSecrets)
// Owners: 'automation:<id>' | 'block:<id>' (button block) | 'prop:<collectionId>:<propertyId>' (button property).
import { LIMITS, WEBHOOK_SECRET_MASK, type AutomationAction, type AutomationRecord } from '@nc/shared/automation/index.ts';
import type { BaseRecord, BlockRecord, CollectionRecord, Role } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { db, getRecord, putRecord } from './db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS webhook_secrets (
  owner TEXT NOT NULL,
  action_id TEXT NOT NULL,
  header TEXT NOT NULL,
  value TEXT NOT NULL,
  origin TEXT NOT NULL,
  PRIMARY KEY (owner, action_id, header)
);
`);

const selOne = db.prepare('SELECT value, origin FROM webhook_secrets WHERE owner = ? AND action_id = ? AND header = ?');
const selOwner = db.prepare('SELECT action_id, header FROM webhook_secrets WHERE owner = ?');
const upsert = db.prepare('INSERT INTO webhook_secrets (owner, action_id, header, value, origin) VALUES (?, ?, ?, ?, ?) ON CONFLICT(owner, action_id, header) DO UPDATE SET value = excluded.value, origin = excluded.origin');
const delOne = db.prepare('DELETE FROM webhook_secrets WHERE owner = ? AND action_id = ? AND header = ?');
const copyOwner = db.prepare('INSERT OR REPLACE INTO webhook_secrets (owner, action_id, header, value, origin) SELECT ?, action_id, header, value, origin FROM webhook_secrets WHERE owner = ?');

export const automationOwner = (id: string) => `automation:${id}`;
export const blockOwner = (id: string) => `block:${id}`;
export const propertyOwner = (collectionId: string, propertyId: string) => `prop:${collectionId}:${propertyId}`;

export class WebhookSecretError extends Error {
  status = 400;
}

function originOf(url: unknown): string {
  try {
    return new URL(String(url ?? '')).origin;
  } catch {
    return '';
  }
}

/** A header row's identity: its stable id (rows added since secrets exist) or its name (older rows). */
const headerKey = (h: { id?: unknown; key?: unknown } | undefined) => (typeof h?.id === 'string' && h.id ? `#${h.id}` : String(h?.key ?? '').trim().toLowerCase());

type WebhookStep = Extract<AutomationAction, { type: 'webhook' }>;
const isWebhook = (a: unknown): a is WebhookStep => !!a && typeof a === 'object' && (a as { type?: unknown }).type === 'webhook' && Array.isArray((a as { headers?: unknown }).headers);

/** Whether a list of steps holds a header value that isn't the placeholder (still to be sealed). */
export function hasPlainHeaderValues(actions: unknown): boolean {
  return Array.isArray(actions) && actions.some((a) => isWebhook(a) && a.headers.some((h) => !!h && typeof h.value === 'string' && h.value !== '' && h.value !== WEBHOOK_SECRET_MASK));
}

/**
 * Store the header values of `actions` for `owner` and return the steps as records keep them (placeholders).
 * `strict`: a placeholder whose webhook now points at another site is an error instead of being dropped.
 */
export function sealActions<T>(owner: string, actions: T[], opts: { strict?: boolean } = {}): T[] {
  if (!Array.isArray(actions)) return actions;
  const kept = new Set<string>();
  const out = actions.map((a) => {
    if (!isWebhook(a)) return a;
    const origin = originOf(a.url);
    const actionId = String(a.id ?? '');
    const headers = a.headers.slice(0, LIMITS.customHeaders + 1).map((h) => {
      const key = String(h?.key ?? '');
      const value = typeof h?.value === 'string' ? h.value : '';
      const k = headerKey(h);
      if (!k || !value) return { ...h, key, value: '' };
      if (value === WEBHOOK_SECRET_MASK) {
        const stored = selOne.get(owner, actionId, k) as { value: string; origin: string } | undefined;
        if (stored && stored.origin === origin) {
          kept.add(`${actionId}\n${k}`);
          return { ...h, key, value: WEBHOOK_SECRET_MASK };
        }
        if (stored && opts.strict) throw new WebhookSecretError(`Enter the value of the ${key ? `“${key}” ` : ''}header again to send it to the new URL`);
        return { ...h, key, value: '' };
      }
      upsert.run(owner, actionId, k, value, origin);
      kept.add(`${actionId}\n${k}`);
      return { ...h, key, value: WEBHOOK_SECRET_MASK };
    });
    return { ...a, headers } as T;
  });
  for (const r of selOwner.all(owner) as { action_id: string; header: string }[]) {
    if (!kept.has(`${r.action_id}\n${r.header}`)) delOne.run(owner, r.action_id, r.header);
  }
  return out;
}

/** Headers to send for a webhook step: placeholders become the stored values (for the step's own site only). */
export function resolveHeaders(owner: string, step: WebhookStep): Record<string, string> {
  const out: Record<string, string> = {};
  const origin = originOf(step.url);
  for (const h of step.headers.slice(0, LIMITS.customHeaders)) {
    const key = String(h?.key ?? '');
    if (!key) continue;
    if (h.value === WEBHOOK_SECRET_MASK) {
      const stored = selOne.get(owner, String(step.id ?? ''), headerKey(h)) as { value: string; origin: string } | undefined;
      if (stored && stored.origin === origin) out[key] = stored.value;
    } else if (h.value) out[key] = h.value; // not sealed yet (migration pending)
  }
  return out;
}

/** Duplicate an automation inside its own database: the copy keeps the stored values. */
export function copySecrets(fromOwner: string, toOwner: string) {
  copyOwner.run(toOwner, fromOwner);
}

// ---------------------------------------------------------------------------------------------- records

/** Seal a button block's steps (format.button_automation.actions); returns the record to persist. */
export function sealButtonBlock(b: BlockRecord): BlockRecord {
  const ba = (b.format as Record<string, any> | undefined)?.button_automation;
  const actions = sealActions(blockOwner(b.id), Array.isArray(ba?.actions) ? ba.actions : []);
  if (!ba || !Array.isArray(ba.actions) || !ba.actions.some(isWebhook)) return b;
  return { ...b, format: { ...b.format, button_automation: { ...ba, actions } } } as BlockRecord;
}

const buttonSteps = (prop: any): unknown[] => (Array.isArray(prop?.button_automation?.actions) ? prop.button_automation.actions : Array.isArray(prop?.button_actions) ? prop.button_actions : []);

/** Seal the steps of a data source's button properties (schema[prop].button_automation.actions, or the older
 * button_actions); `only` limits it to the properties whose steps changed. */
export function sealButtonProperties(c: CollectionRecord, only?: Set<string>): CollectionRecord {
  let schema: Record<string, any> | null = null;
  for (const [pid, prop] of Object.entries(c.schema ?? {}) as [string, any][]) {
    if (prop?.type !== 'button' || (only && !only.has(pid))) continue;
    const field = Array.isArray(prop.button_automation?.actions) ? 'button_automation' : Array.isArray(prop.button_actions) ? 'button_actions' : null;
    const actions = sealActions(propertyOwner(c.id, pid), buttonSteps(prop));
    if (!field || !buttonSteps(prop).some(isWebhook)) continue;
    schema ??= { ...c.schema };
    schema[pid] = field === 'button_automation' ? { ...prop, button_automation: { ...prop.button_automation, actions } } : { ...prop, button_actions: actions };
  }
  return schema ? ({ ...c, schema } as CollectionRecord) : c;
}

/** What people who can't edit a database see of its automations (they can still view existing ones): no
 * webhook destinations or headers. */
export function automationForViewer(rec: BaseRecord, role: Role | undefined): BaseRecord {
  const a = rec as AutomationRecord;
  if (roleAtLeast(role, 'read_and_write') || !Array.isArray(a.actions) || !a.actions.some(isWebhook)) return rec;
  return { ...a, actions: a.actions.map((s) => (isWebhook(s) ? { ...s, url: '', headers: [] } : s)) } as BaseRecord;
}

/** Startup: header values stored in records before secrets existed move to `webhook_secrets`; page history keeps
 * placeholders only. */
export function migrateWebhookSecrets(): number {
  let n = 0;
  const save = (table: 'automation' | 'block' | 'collection', next: BaseRecord) => {
    putRecord(table, { ...next, version: (next.version ?? 0) + 1 });
    n++;
  };
  for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'automation' AND data LIKE '%"webhook"%'`).all() as { data: string }[]) {
    const a = JSON.parse(r.data) as AutomationRecord;
    if (hasPlainHeaderValues(a.actions)) save('automation', { ...a, actions: sealActions(automationOwner(a.id), a.actions) } as BaseRecord);
  }
  for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND data LIKE '%button_automation%' AND data LIKE '%"webhook"%'`).all() as { data: string }[]) {
    const b = JSON.parse(r.data) as BlockRecord;
    if (hasPlainHeaderValues((b.format as any)?.button_automation?.actions)) save('block', sealButtonBlock(b));
  }
  for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'collection' AND data LIKE '%"webhook"%'`).all() as { data: string }[]) {
    const c = JSON.parse(r.data) as CollectionRecord;
    const plain = Object.values(c.schema ?? {}).some((p: any) => p?.type === 'button' && hasPlainHeaderValues(buttonSteps(p)));
    if (plain) save('collection', sealButtonProperties(c));
  }
  // page history snapshots (serialized blocks / data sources) keep placeholders instead of values
  const mask = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(mask);
    if (!v || typeof v !== 'object') return v;
    const o = v as Record<string, unknown>;
    if (isWebhook(o)) return { ...o, headers: (o.headers as { key: string; value: string }[]).map((h) => ({ ...h, value: h?.value ? WEBHOOK_SECRET_MASK : '' })) };
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, mask(x)]));
  };
  const hasSnapshots = db.prepare(`SELECT 1 AS hit FROM sqlite_master WHERE type = 'table' AND name = 'snapshots'`).get();
  if (hasSnapshots) {
    const upd = db.prepare('UPDATE snapshots SET data = ? WHERE id = ?');
    for (const r of db.prepare(`SELECT id, data FROM snapshots WHERE data LIKE '%"webhook"%'`).all() as { id: string; data: string }[]) {
      const next = JSON.stringify(mask(JSON.parse(r.data)));
      if (next !== r.data) upd.run(next, r.id);
    }
  }
  return n;
}

/**
 * records.ts onBeforePersist hook: client and server writes of button blocks / button properties are sealed.
 * `roleOf` is the writer's role on a block: a copy (copied_from — Duplicate, templates, duplicated databases) takes the
 * stored values along only when the writer can edit the original (and so click its button already).
 */
export function sealChangedRecords(changed: Map<string, { table: string; record: BaseRecord }>, roleOf: (blockId: string) => Role = () => 'none') {
  const canEdit = (blockId: string | undefined) => !!blockId && roleAtLeast(roleOf(blockId), 'read_and_write');
  for (const ch of changed.values()) {
    if (ch.table === 'block' && (ch.record as BlockRecord).type === 'button') {
      const steps = (r: BlockRecord | undefined) => JSON.stringify((r?.format as any)?.button_automation?.actions ?? null);
      const prevBlock = getRecord<BlockRecord>('block', ch.record.id);
      const from = (ch.record as BlockRecord).copied_from;
      if (!prevBlock && typeof from === 'string' && from !== ch.record.id && canEdit(from)) copySecrets(blockOwner(from), blockOwner(ch.record.id));
      if (steps(prevBlock) === steps(ch.record as BlockRecord)) continue;
      ch.record = sealButtonBlock(ch.record as BlockRecord);
    } else if (ch.table === 'collection') {
      const c = ch.record as CollectionRecord;
      const prev = getRecord<CollectionRecord>('collection', c.id);
      const from = typeof (c as any).copied_from === 'string' ? getRecord<CollectionRecord>('collection', (c as any).copied_from) : undefined;
      if (!prev && from && from.id !== c.id && canEdit(from.parent_id)) {
        for (const [pid, prop] of Object.entries(c.schema ?? {}) as [string, any][]) if (prop?.type === 'button') copySecrets(propertyOwner(from.id, pid), propertyOwner(c.id, pid));
      }
      const touched = new Set<string>();
      for (const [pid, prop] of Object.entries(c.schema ?? {}) as [string, any][]) {
        if (prop?.type === 'button' && JSON.stringify(buttonSteps(prop)) !== JSON.stringify(buttonSteps((prev?.schema as any)?.[pid]))) touched.add(pid);
      }
      if (touched.size) ch.record = sealButtonProperties(c, touched);
    }
  }
}

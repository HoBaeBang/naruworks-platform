// Client side of the automations API (apps/server/src/api/modules/automations.ts): records arrive through
// recordMaps / realtime (table "automation"); writes go through the API (server-owned records).
import { useEffect, useMemo, useState } from 'react';
import type { CollectionRecord } from '@nc/shared/records.ts';
import type { AutomationAction, AutomationRecord, AutomationRun, AutomationTrigger, Recurrence } from '@nc/shared/automation/index.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useTableVersion } from '../../../lib/hooks.ts';

export interface AutomationAccess {
  canEdit: boolean;
  editProblem: string | null;
  role: string;
  webhooksAllowed: boolean;
}

const access = new Map<string, AutomationAccess>();
const loaded = new Map<string, Promise<AutomationAccess>>();

export function loadAutomations(collectionId: string, force = false): Promise<AutomationAccess> {
  if (!force && loaded.has(collectionId)) return loaded.get(collectionId)!;
  const p = api<{ automationIds: string[]; recordMap: any } & AutomationAccess>('getAutomations', { collectionId }).then((res) => {
    records.mergeRecordMap(res.recordMap);
    const a = { canEdit: res.canEdit, editProblem: res.editProblem, role: res.role, webhooksAllowed: res.webhooksAllowed };
    access.set(collectionId, a);
    return a;
  });
  loaded.set(collectionId, p);
  p.catch(() => loaded.delete(collectionId));
  return p;
}

export function automationAccess(collectionId: string): AutomationAccess | undefined {
  return access.get(collectionId);
}

/** Automations of a data source (live: realtime updates re-render). */
export function useAutomations(collectionId: string | undefined, opts: { includeTemplateRepeats?: boolean } = {}): { list: AutomationRecord[]; access: AutomationAccess | undefined } {
  const ver = useTableVersion(['automation']);
  const [acc, setAcc] = useState<AutomationAccess | undefined>(collectionId ? access.get(collectionId) : undefined);
  useEffect(() => {
    if (!collectionId) return;
    let alive = true;
    loadAutomations(collectionId).then((a) => { if (alive) setAcc(a); }).catch(() => {});
    return () => { alive = false; };
  }, [collectionId]);
  const list = useMemo(() => {
    if (!collectionId) return [];
    return records.all<AutomationRecord>('automation')
      .filter((a) => a.parent_id === collectionId && a.alive !== false && (opts.includeTemplateRepeats || !a.template_id))
      .sort((a, b) => (a.created_time ?? 0) - (b.created_time ?? 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionId, ver, opts.includeTemplateRepeats]);
  return { list, access: acc };
}

export interface AutomationDraft {
  id?: string;
  name: string;
  scope: AutomationRecord['scope'];
  trigger: AutomationTrigger;
  actions: AutomationAction[];
  status?: 'active' | 'paused';
}

export async function saveAutomation(collectionId: string, draft: AutomationDraft): Promise<string> {
  const res = await api<{ automationId: string; recordMap: any }>('saveAutomation', { collectionId, automation: draft });
  records.mergeRecordMap(res.recordMap);
  return res.automationId;
}

export async function setAutomationStatus(id: string, status: 'active' | 'paused') {
  const res = await api<{ recordMap: any }>('setAutomationStatus', { automationId: id, status });
  records.mergeRecordMap(res.recordMap);
}

export async function deleteAutomation(id: string) {
  const res = await api<{ recordMap: any }>('deleteAutomation', { automationId: id });
  records.mergeRecordMap(res.recordMap);
}

export async function duplicateAutomation(id: string): Promise<string> {
  const res = await api<{ automationId: string; recordMap: any }>('duplicateAutomation', { automationId: id });
  records.mergeRecordMap(res.recordMap);
  return res.automationId;
}

export async function automationRuns(id: string): Promise<AutomationRun[]> {
  const res = await api<{ runs: AutomationRun[] }>('getAutomationRuns', { automationId: id, limit: 20 });
  return res.runs;
}

export async function setTemplateRecurrence(templateId: string, recurrence: Recurrence | null): Promise<{ automationId: string | null; nextRunTime?: number | null }> {
  const res = await api<{ automationId: string | null; nextRunTime?: number | null; recordMap?: any }>('setTemplateRecurrence', { templateId, recurrence });
  if (res.recordMap) records.mergeRecordMap(res.recordMap);
  if (!res.automationId) {
    // the server marked the old repeat automation dead: drop it locally too
    for (const a of records.all<AutomationRecord>('automation')) if (a.template_id === templateId && a.alive !== false) records.mergeServer('automation', a.id, { ...a, alive: false, version: (a.version ?? 0) + 1 } as any, 'reader');
  }
  return res;
}

/** The repeat automation of a database template (Duplicate every…). */
export function templateRepeat(templateId: string): AutomationRecord | undefined {
  return records.all<AutomationRecord>('automation').find((a) => a.template_id === templateId && a.alive !== false);
}

export function collectionName(c: CollectionRecord | undefined): string {
  return (c?.name ?? []).map((d) => d[0]).join('') || 'Untitled';
}

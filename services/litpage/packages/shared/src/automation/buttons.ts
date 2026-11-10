// Button storage (button block: format.button_automation, button property: schema[prop].button_automation) and the
// conversion of the first-wave shapes (block: {trigger, actions:[{type, collectionId, propertyId, value…}]},
// property: button_actions:[{type:'edit_property'|'show_confirmation'|'open_page'}]) to the shared step model.
import type { BlockRecord, PropertySchema } from '../records.ts';
import type { AutomationAction, PropertyEdit, ValueRef } from './types.ts';

export interface ButtonAutomation {
  trigger: 'button_clicked';
  v: 2;
  actions: AutomationAction[];
}

let seq = 0;
function legacyId(prefix: string) {
  seq += 1;
  return `${prefix}-${seq}`;
}

/** "@today" / "@now" typed into first-wave titles → context values. */
export function textWithTokens(s: string | undefined): ValueRef[] {
  if (!s) return [];
  const out: ValueRef[] = [];
  const re = /@(today|now)\b/gi;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ type: 'text', text: s.slice(last, m.index) });
    out.push({ type: 'context', key: m[1].toLowerCase() === 'now' ? 'now' : 'today' });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ type: 'text', text: s.slice(last) });
  return out;
}

function legacyValue(prop: PropertySchema | undefined, value: unknown): { op: PropertyEdit['op']; values: ValueRef[] } {
  if (value === 'toggle') return { op: 'toggle', values: [] };
  if (prop?.type === 'checkbox') return { op: 'set', values: [{ type: 'checkbox', checked: value === true || value === 'true' }] };
  if (prop?.type === 'date' && value === 'now') return { op: 'set', values: [{ type: 'context', key: 'today' }] };
  if (prop?.type === 'person' && value === 'me') return { op: 'set', values: [{ type: 'context', key: 'actor' }] };
  if (prop?.type === 'person' && Array.isArray(value)) return { op: 'set', values: value.map((id) => ({ type: 'user' as const, id: String(id) })) };
  if (prop?.type === 'date' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return { op: 'set', values: [{ type: 'date', date: { type: 'date', start_date: value } }] };
  if ((prop?.type === 'select' || prop?.type === 'status' || prop?.type === 'multi_select') && value) {
    const names = Array.isArray(value) ? value.map(String) : [String(value)];
    return { op: 'set', values: names.map((name) => ({ type: 'option' as const, name })) };
  }
  if (value === '' || value === null || value === undefined) return { op: 'clear', values: [] };
  return { op: 'set', values: textWithTokens(String(value)) };
}

function isNewShape(a: any): boolean {
  return a && typeof a === 'object' && (Array.isArray(a.edits) || ['define_variables', 'webhook', 'notify', 'open', 'confirm', 'insert_blocks', 'agent', 'mail', 'slack'].includes(a.type)) && !('collectionId' in a) && !('propertyId' in a) && !('userIds' in a) && !('pageId' in a) && !('prompt' in a);
}

/** Steps of a button block (format.button_automation, either shape). */
export function buttonBlockSteps(block: BlockRecord | undefined, schemaOf?: (collectionId: string) => Record<string, PropertySchema> | undefined): AutomationAction[] {
  const raw = (block?.format as any)?.button_automation;
  if (!raw || !Array.isArray(raw.actions)) return [];
  if (raw.v === 2) return raw.actions as AutomationAction[];
  return (raw.actions as any[]).filter(Boolean).map((a): AutomationAction => {
    const id = typeof a.id === 'string' ? a.id : legacyId('step');
    if (isNewShape(a) && a.type !== 'notify' && a.type !== 'open' && a.type !== 'webhook') return { ...a, id };
    switch (a.type) {
      case 'insert_blocks': return { id, type: 'insert_blocks', position: a.position === 'above' ? 'above' : a.position === 'top' || a.position === 'bottom' ? a.position : 'below' };
      case 'add_page': {
        const edits: PropertyEdit[] = [];
        if (a.title) edits.push({ property: 'title', op: 'set', values: textWithTokens(a.title) });
        const schema = a.collectionId ? schemaOf?.(a.collectionId) : undefined;
        if (a.propertyId && a.propertyId !== 'title' && a.value != null && a.value !== '') edits.push({ property: a.propertyId, ...legacyValue(schema?.[a.propertyId], a.value) });
        return { id, type: 'add_page', collection_id: a.collectionId, template_id: null, edits };
      }
      case 'edit_pages': {
        const schema = a.collectionId ? schemaOf?.(a.collectionId) : undefined;
        const edits: PropertyEdit[] = a.propertyId ? [{ property: a.propertyId, ...legacyValue(schema?.[a.propertyId], a.value ?? '') }] : [];
        return { id, type: 'edit_pages', collection_id: a.collectionId, filter: null, edits };
      }
      case 'notify':
        if (a.target) return { ...a, id };
        return { id, type: 'notify', target: { type: 'users', user_ids: Array.isArray(a.userIds) ? a.userIds.map(String) : [] }, message: a.message ? textWithTokens(String(a.message)) : [] };
      case 'webhook': return { id, type: 'webhook', url: String(a.url ?? ''), headers: Array.isArray(a.headers) ? a.headers : [], properties: a.properties ?? 'all' };
      case 'confirm': return { id, type: 'confirm', message: String(a.message ?? ''), continue_label: a.continue_label, cancel_label: a.cancel_label };
      case 'open':
        if (a.target !== undefined) return { ...a, id };
        return { id, type: 'open', target: a.pageId ? { type: 'page', page_id: a.pageId } : a.url ? { type: 'url', url: a.url } : null };
      case 'agent': return { id, type: 'agent', message: String(a.prompt ?? a.message ?? '') };
      case 'variables': return { id, type: 'define_variables', variables: [] };
      case 'mail': case 'slack': return { id, type: a.type };
      default: return { id, type: 'confirm', message: '' };
    }
  });
}

/** Steps of a database button property (schema[prop].button_automation, or first-wave button_actions). */
export function buttonPropertySteps(prop: PropertySchema | undefined, schema?: Record<string, PropertySchema>): AutomationAction[] {
  if (!prop) return [];
  const v2 = (prop as any).button_automation;
  if (v2 && Array.isArray(v2.actions)) return v2.actions as AutomationAction[];
  const old = (prop.button_actions as any[] | undefined) ?? [];
  return old.filter(Boolean).map((a, i): AutomationAction => {
    const id = `legacy-${i}`;
    switch (a.type) {
      case 'edit_property': return { id, type: 'edit_property', edits: a.property ? [{ property: a.property, ...legacyValue(schema?.[a.property], a.value) }] : [] };
      case 'show_confirmation': return { id, type: 'confirm', message: String(a.message ?? '') };
      case 'open_page': return { id, type: 'open', target: a.pageId ? { type: 'page', page_id: a.pageId } : a.url ? { type: 'url', url: a.url } : null };
      default: return isNewShape(a) ? { ...a, id: a.id ?? id } : { id, type: 'confirm', message: '' };
    }
  });
}

/** Label shown on a button property cell (Litpage: separate button label, defaults to the property name). */
export function buttonPropertyLabel(prop: PropertySchema | undefined): string {
  return String((prop as any)?.button_label ?? prop?.name ?? '');
}

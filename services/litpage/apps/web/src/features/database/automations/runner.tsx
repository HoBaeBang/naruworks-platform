// Button runner (button blocks …013, database button properties /021): steps run top to bottom as
// the person who clicked. Data steps are planned with the shared planner (packages/shared/src/automation/runtime.ts)
// and committed as one undoable transaction (flushed before a confirmation step); Send notification / Send webhook
// run on the server from the stored configuration (runButtonServerSteps); Open page / Send message to agent happen
// last. Pages created by a button trigger database automations any other edit.
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { safeHref } from '@nc/shared/url.ts';
import { newId } from '@nc/shared/ids.ts';
import {
  AutomationError, AutomationPlanner, validateSteps, type AutomationAction, type RunContext,
} from '@nc/shared/automation/index.ts';
import { api } from '../../../lib/api.ts';
import { run } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { transactions } from '../../../lib/store/transactions.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { openPage, openPeek, pageUrl } from '../../../lib/router.ts';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { userTimeZone } from '../advanced/context.ts';
import './automations.css';

export interface ButtonRun {
  surface: 'button_block' | 'button_property';
  steps: AutomationAction[];
  /** "This page": the clicked row (button property) or the page holding the button block */
  page?: BlockRecord;
  block?: BlockRecord;
  collectionId?: string;
  propertyId?: string;
  anchor: HTMLElement | null;
  label: string;
}

/** Resolves once every queued transaction reached the server (server steps read the saved records). */
export function afterSave(): Promise<boolean> {
  return new Promise((resolve) => {
    if (transactions.pendingCount() === 0) return resolve(true);
    const off = transactions.onSaveState((st) => {
      if (st.pending > 0) return;
      off();
      resolve(!st.error);
    });
    void transactions.flush();
  });
}

function confirmPopup(step: Extract<AutomationAction, { type: 'confirm' }>, anchor: HTMLElement | null): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    openOverlay((close) => (
      <PopoverSurface width={260}>
        <div className="nc-auto-confirm" role="alertdialog" aria-label="Confirmation">
          <div>{step.message || 'Continue with this action?'}</div>
          <div className="nc-auto-confirm-btns">
            <button className="nc-btn primary" autoFocus onClick={() => { answered = true; close(); resolve(true); }}>{step.continue_label || 'Continue'}</button>
            <button className="nc-btn outline" onClick={() => { answered = true; close(); resolve(false); }}>{step.cancel_label || 'Cancel'}</button>
          </div>
        </div>
      </PopoverSurface>
    ), { anchor: anchor ?? undefined, placement: anchor ? 'bottom-start' : 'center', offset: 6, onClose: () => { if (!answered) resolve(false); } });
  });
}

function lookups(surface: ButtonRun['surface'], collectionId: string | undefined) {
  return {
    surface,
    collectionId,
    schema: records.get<CollectionRecord>('collection', collectionId)?.schema,
    collection: (id: string) => records.get<CollectionRecord>('collection', id),
    block: (id: string) => records.get<BlockRecord>('block', id),
  };
}

function rowsOf(collectionId: string): BlockRecord[] {
  return records.all<BlockRecord>('block').filter((b) => b.parent_table === 'collection' && b.parent_id === collectionId && b.alive && !b.is_template);
}

function openTarget(step: Extract<AutomationAction, { type: 'open' }>, planner: AutomationPlanner, r: ButtonRun) {
  const t = step.target;
  if (!t) return;
  if (t.type === 'url') {
    const url = safeHref(/^[a-z][a-z0-9+.-]*:/i.test(t.url) ? t.url : `https://${t.url}`);
    if (url) window.open(url, '_blank', 'noopener');
    return;
  }
  const id = t.type === 'page' ? t.page_id : t.type === 'context' ? r.page?.id : planner.stepPages.get(t.step)?.ids[0];
  if (!id) return;
  switch (step.peek ?? 'side_peek') {
    case 'center_peek': openPeek(id, 'center_peek'); break;
    case 'full_page': openPage(id); break;
    case 'new_tab': window.open(pageUrl(id), '_blank', 'noopener'); break;
    default: openPeek(id, 'side_peek');
  }
}

/** Run a button's steps. Resolves when every step finished (or the run stopped). */
export async function runButtonSteps(r: ButtonRun): Promise<void> {
  const toast = (m: string, action?: { label: string; run: () => void }) => useUI.getState().toast(m, action);
  if (!r.steps.length) {
    toast('This button has nothing to run');
    return;
  }
  const issues = validateSteps(r.steps, { type: 'button' }, lookups(r.surface, r.collectionId));
  if (issues.length) {
    toast(`The button could not run: ${issues[0].message}`);
    return;
  }
  // rows the "Edit pages in" steps look at (also databases this page doesn't show)
  const targets = new Set(r.steps.flatMap((s) => (s.type === 'edit_pages' && s.collection_id ? [s.collection_id] : [])));
  await Promise.all([...targets].map((cid) => api('loadCollectionRows', { collectionId: cid }).then((res) => records.mergeRecordMap(res.recordMap)).catch(() => {})));
  const me = useSession.getState().userId ?? '';
  const ctx: RunContext = {
    kind: 'button',
    getRecord: (t, id) => records.get(t as any, id),
    rowsOf,
    actorId: me,
    runAsId: me,
    page: r.page ? records.get<BlockRecord>('block', r.page.id) ?? r.page : undefined,
    now: Date.now(),
    timeZone: userTimeZone(),
    spaceId: r.page?.space_id ?? r.block?.space_id ?? useSession.getState().spaceId ?? '',
    newId,
  };
  const planner = new AutomationPlanner(ctx);
  let committed = 0;
  const flush = () => {
    const ops = planner.ops.slice(committed);
    committed = planner.ops.length;
    if (ops.length) run(r.surface === 'button_block' ? 'button.click' : 'buttonProperty.click', (tx) => { for (const op of ops) tx.apply(structuredClone(op)); });
  };
  const serverSteps: string[] = [];
  const later: (() => void)[] = [];
  try {
    for (const step of r.steps) {
      switch (step.type) {
        case 'confirm':
          flush();
          if (!(await confirmPopup(step, r.anchor))) return;
          break;
        case 'edit_property': planner.editProperty(step); break;
        case 'add_page': planner.addPage(step); break;
        case 'edit_pages': planner.editPages(step); break;
        case 'define_variables': planner.defineVariables(step); break;
        case 'insert_blocks': if (r.block) planner.insertBlocks(step, records.get<BlockRecord>('block', r.block.id) ?? r.block); break;
        case 'notify': case 'webhook': serverSteps.push(step.id); break;
        case 'open': later.push(() => openTarget(step, planner, r)); break;
        case 'agent': later.push(() => window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { pageId: r.page?.id, prompt: step.message } }))); break;
        default: throw new AutomationError(step.type === 'mail' ? 'Connect a Gmail account to send mail' : 'Slack notification needs authentication.');
      }
    }
  } catch (e) {
    flush();
    toast(e instanceof AutomationError ? `The button could not run: ${e.message}` : 'The button could not run');
    return;
  }
  flush();
  if (planner.templates.length || serverSteps.length) {
    const saved = await afterSave();
    if (!saved) { toast('The button could not run'); return; }
  }
  for (const t of planner.templates) {
    await api<{ recordMap?: any }>('applyDatabaseTemplate', { rowId: t.rowId, templateId: t.templateId, override: true })
      .then((res) => records.mergeRecordMap(res?.recordMap))
      .catch(() => toast('The add-page template is invalid'));
  }
  if (serverSteps.length) {
    const source = r.surface === 'button_block' ? { blockId: r.block?.id } : { rowId: r.page?.id, propertyId: r.propertyId };
    const pages: Record<string, string[]> = {};
    for (const [k, v] of planner.stepPages) pages[k] = v.ids;
    try {
      const res = await api<{ ok: boolean; message?: string }>('runButtonServerSteps', { ...source, stepIds: serverSteps, context: { pages } });
      if (!res.ok) toast(`The button could not run: ${res.message ?? ''}`.trim());
    } catch (e) {
      toast(`The button could not run${(e as Error)?.message ? `: ${(e as Error).message}` : ''}`);
    }
  }
  const created = planner.created.length;
  const edited = planner.edited.size;
  if (created === 1 && planner.created[0]) {
    const id = planner.created[0];
    toast('Created 1 page', { label: 'Open', run: () => openPeek(id, 'side_peek') });
  } else if (created > 1) toast(`Created ${created} pages`, { label: 'Undo', run: () => transactions.undo() });
  else if (edited > 0 && r.surface === 'button_block' ? edited > 0 && !r.steps.some((s) => s.type === 'insert_blocks') : edited > 0) {
    toast(`Edited ${edited} ${edited === 1 ? 'page' : 'pages'}`, { label: 'Undo', run: () => transactions.undo() });
  }
  for (const fn of later) fn();
}

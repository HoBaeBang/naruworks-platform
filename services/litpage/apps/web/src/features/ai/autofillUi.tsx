// Database AI Autofill UI (Basic): the property menu's "AI Autofill › Basic" configuration (Summary / Key info /
// Translate / Custom autofill, "When the page changes"), "Run autofill" for the rows of a view, the "+ Add property"
// AI presets (Summarize › Paragraph / Bullets / One-liner, Translate › language) and the toolbar's AI Autofill menu.
// The configuration lives on the property: schema[propId].ai_autofill = { kind, prompt?, language?, auto_update };
// the server refills auto-updating properties after row edits (apps/server/src/ai/autofillAuto.ts).
import { useState } from 'react';
import type { CollectionRecord, CollectionViewRecord, PropertySchema, PropertyType } from '@nc/shared/records.ts';
import { runQuery } from '@nc/shared/database/query.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { addProperty, updateProperty } from '../database/actions.ts';
import { collectionRows, makeQueryContext } from '../database/data.ts';
import { NO_KEY_MESSAGE, useAiStatus } from './aiApi.ts';
import { runAutofillAll, type AutofillKind } from './autofill.ts';
import { LANGUAGES } from './skills.ts';

export interface AutofillConfig {
  kind: AutofillKind;
  prompt?: string;
  language?: string;
  auto_update?: boolean;
}

/** Property types Basic autofill can fill (others: "Unavailable for this property type"). */
export const AUTOFILL_TYPES = new Set<string>(['text', 'number', 'select', 'multi_select', 'status', 'checkbox', 'url', 'email', 'phone_number']);

export function autofillConfigOf(prop: PropertySchema | undefined): AutofillConfig | null {
  const c = (prop as Record<string, unknown> | undefined)?.ai_autofill as AutofillConfig | undefined;
  return c && typeof c === 'object' && c.kind ? c : null;
}

const KINDS: { id: AutofillKind; label: string; icon: string; hint: string }[] = [
  { id: 'summary', label: 'Summary', icon: 'textJustifyLeft', hint: 'A short summary of each page' },
  { id: 'keywords', label: 'Key info', icon: 'checklist', hint: 'Extract key information from each page' },
  { id: 'translation', label: 'Translate', icon: 'translate', hint: 'Translate each page’s title and content' },
  { id: 'custom', label: 'Custom autofill', icon: 'aiFace', hint: 'Fill the property with your own instructions' },
];

const col = (id: string) => records.get<CollectionRecord>('collection', id);

/** Rows of a view (filters / sorts applied) or of the whole database. */
export function rowsFor(collectionId: string, view?: CollectionViewRecord | null): string[] {
  const c = col(collectionId);
  if (!c) return [];
  const rows = collectionRows(collectionId);
  if (!view) return rows.map((r) => r.id);
  try {
    return runQuery(rows, c, view, makeQueryContext()).rows.map((r) => r.id);
  } catch {
    return rows.map((r) => r.id);
  }
}

/** Fill one property for rows with progress toasts ("Autofilled {n} pages" / "No pages are ready for autofill"). */
export async function runAutofillNow(collectionId: string, propId: string, view?: CollectionViewRecord | null, opts: { onlyEmpty?: boolean } = {}) {
  const c = col(collectionId);
  const cfg = autofillConfigOf(c?.schema[propId]);
  if (!c || !cfg) return;
  if (useAiStatus.getState().configured === false) {
    useUI.getState().toast(NO_KEY_MESSAGE);
    return;
  }
  let ids = rowsFor(collectionId, view);
  if (opts.onlyEmpty) ids = ids.filter((id) => !((records.get<any>('block', id)?.properties?.[propId] ?? []) as unknown[]).length);
  if (!ids.length) {
    useUI.getState().toast('No pages are ready for autofill');
    return;
  }
  useUI.getState().toast(`Autofilling ${ids.length} ${ids.length === 1 ? 'page' : 'pages'}…`);
  const r = await runAutofillAll(ids, propId, cfg.kind, { prompt: cfg.prompt, language: cfg.language, concurrency: 3 });
  const done = ids.length - r.errors.length;
  if (r.errors.length && !done) useUI.getState().toast(r.errors[0].message || 'AI Autofill failed');
  else useUI.getState().toast(`Autofilled ${done} ${done === 1 ? 'page' : 'pages'}`);
}

function ConfigBody({ collectionId, propId, view, close }: { collectionId: string; propId: string; view?: CollectionViewRecord | null; close: () => void }) {
  const c = col(collectionId);
  const prop = c?.schema[propId];
  const cur = autofillConfigOf(prop);
  const [kind, setKind] = useState<AutofillKind>(cur?.kind ?? (prop?.type === 'text' ? 'summary' : 'custom'));
  const [prompt, setPrompt] = useState(cur?.prompt ?? '');
  const [language, setLanguage] = useState(cur?.language ?? 'English');
  const [auto, setAuto] = useState(cur?.auto_update ?? true);
  if (!c || !prop) return null;
  const textLike = prop.type === 'text';
  const kinds = textLike ? KINDS : KINDS.filter((k) => k.id === 'custom' || k.id === 'keywords');
  const save = (andRun: boolean) => {
    if (kind === 'custom' && !prompt.trim()) {
      useUI.getState().toast('Add instructions for the custom autofill.');
      return;
    }
    const cfg: AutofillConfig = { kind, auto_update: auto, ...(prompt.trim() ? { prompt: prompt.trim() } : {}), ...(kind === 'translation' ? { language } : {}) };
    updateProperty(collectionId, propId, { ai_autofill: cfg } as Partial<PropertySchema>, 'aiAutofill.configure');
    close();
    if (andRun) setTimeout(() => void runAutofillNow(collectionId, propId, view), 50);
  };
  return (
    <div className="nc-ai-autofill" data-testid="ai-autofill-config">
      <div className="nc-ai-autofill-head">
        <Icon name="magicWandSparkle" size={16} />
        <span className="nc-ai-autofill-title">AI Autofill</span>
        <span className="nc-ai-autofill-prop nc-ellipsis">{prop.name}</span>
      </div>
      <div className="nc-ai-autofill-caption">Uses a fast model to fill properties based on info in the current row.</div>
      <div className="nc-ai-autofill-kinds" role="radiogroup" aria-label="Autofill type">
        {kinds.map((k) => (
          <div key={k.id} role="radio" aria-checked={kind === k.id} tabIndex={0} className={`nc-ai-autofill-kind ${kind === k.id ? 'active' : ''}`} onClick={() => setKind(k.id)} data-tooltip={k.hint}>
            <Icon name={k.icon} size={14} />
            <span>{k.label}</span>
          </div>
        ))}
      </div>
      {kind === 'translation' && (
        <label className="nc-ai-field">
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label="Language">
            {LANGUAGES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
      )}
      <label className="nc-ai-field">
        <span>{kind === 'custom' ? 'Instructions' : 'Additional instructions (optional)'}</span>
        <textarea
          value={prompt}
          rows={3}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={kind === 'custom' ? 'Describe what to generate. Use ‘@’ for people, pages, or dates' : 'e.g. Keep it under 20 words'}
          aria-label="Instructions"
        />
      </label>
      <div className="nc-ai-autofill-toggle" role="switch" aria-checked={auto} tabIndex={0} onClick={() => setAuto(!auto)} data-tooltip="The agent fills this property whenever the page changes">
        <span>When the page changes</span>
        <span className={`nc-ai-switch ${auto ? 'on' : ''}`} aria-hidden><span /></span>
      </div>
      <div className="nc-ai-autofill-actions">
        {cur && (
          <button type="button" className="nc-btn danger" onClick={() => { updateProperty(collectionId, propId, { ai_autofill: undefined } as Partial<PropertySchema>, 'aiAutofill.delete'); close(); useUI.getState().toast('Autofill removed'); }}>
            Delete autofill
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button type="button" className="nc-btn outline" onClick={() => save(false)}>Save changes</button>
        <button type="button" className="nc-btn primary" onClick={() => save(true)}>Run autofill</button>
      </div>
    </div>
  );
}

/** Property menu → AI Autofill → Basic. */
export function openAutofillConfig(anchor: Anchor, collectionId: string, propId: string, view?: CollectionViewRecord | null) {
  openOverlay((close) => (
    <PopoverSurface width={360}>
      <ConfigBody collectionId={collectionId} propId={propId} view={view} close={close} />
    </PopoverSurface>
  ), { anchor, placement: 'right-start', offset: 4 });
}

/** Items of the property menu's "AI Autofill ›" submenu. */
export function autofillMenuItems(collectionId: string, propId: string, view?: CollectionViewRecord | null, anchor?: Anchor): MenuItemDef[] {
  const prop = col(collectionId)?.schema[propId];
  const ok = !!prop && AUTOFILL_TYPES.has(prop.type);
  const cfg = autofillConfigOf(prop);
  const items: MenuItemDef[] = [{
    id: 'basic', label: 'Basic', icon: 'magicWand',
    description: ok ? 'Uses a fast model to fill properties based on info in the current row.' : 'Unavailable for this property type',
    disabled: !ok,
    right: cfg ? <span className="nc-menu-value">On</span> : undefined,
    onSelect: () => { if (ok) setTimeout(() => openAutofillConfig(anchor ?? { x: window.innerWidth / 2 - 180, y: 120 }, collectionId, propId, view), 0); },
  }];
  if (cfg) items.push({ id: 'run', label: 'Run autofill', icon: 'refresh', onSelect: () => { void runAutofillNow(collectionId, propId, view); } });
  return items;
}

/** "+ Add property" → AI Autofill presets: a new Text property that fills itself. */
export function createAutofillProperty(collectionId: string, preset: 'sum' | 'tr', option: string, view?: CollectionViewRecord | null, pos?: { afterPropId?: string; beforePropId?: string }): string {
  const c = col(collectionId);
  if (!c) return '';
  const cfg: AutofillConfig = preset === 'sum'
    ? { kind: 'summary', auto_update: true, prompt: option === 'Bullets' ? 'Write the summary as 3 short bullet points.' : option === 'One-liner' ? 'Write a one-line summary.' : 'Write the summary as one short paragraph.' }
    : { kind: 'translation', auto_update: true, language: option === 'Chinese Simplified' ? 'Chinese, Simplified' : option === 'Chinese Traditional' ? 'Chinese, Traditional' : option };
  const name = preset === 'sum' ? 'Summary' : `Translation (${option})`;
  const pid = addProperty(collectionId, 'text' as PropertyType, { name, view: view ?? undefined, ...pos, extra: { ai_autofill: cfg } as Partial<PropertySchema>, action: 'aiAutofill.create' });
  if (pid) setTimeout(() => void runAutofillNow(collectionId, pid, view), 80);
  return pid;
}

/** Database toolbar → AI Autofill: the configured autofills with Run now, and New AI autofill. */
export function openToolbarAutofillMenu(anchor: HTMLElement, collectionId: string, view?: CollectionViewRecord | null) {
  const c = col(collectionId);
  if (!c) return;
  const configured = Object.entries(c.schema).filter(([, p]) => autofillConfigOf(p));
  const items: MenuItemDef[] = configured.map(([pid, p]) => ({
    id: pid,
    label: p.name,
    icon: 'magicWandSparkle',
    description: `${KINDS.find((k) => k.id === autofillConfigOf(p)!.kind)?.label ?? 'Custom autofill'}${autofillConfigOf(p)!.auto_update ? ' · When the page changes' : ''}`,
    submenu: () => ({
      width: 260,
      sections: [{ items: [
        { label: 'Run across every page in this view', icon: 'refresh', onSelect: () => { void runAutofillNow(collectionId, pid, view); } },
        { label: 'Run only on empty pages in this view', icon: 'refresh', onSelect: () => { void runAutofillNow(collectionId, pid, view, { onlyEmpty: true }); } },
        { label: 'Edit autofill', icon: 'sliders', onSelect: () => setTimeout(() => openAutofillConfig(anchor, collectionId, pid, view), 0) },
      ] }],
    }),
  }));
  openMenu(anchor, {
    width: 300,
    sections: [
      ...(items.length ? [{ title: 'AI Autofill', items }] : [{ title: 'AI Autofill', items: [{ id: 'none', label: 'Fill properties automatically from each page', disabled: true, description: 'AI Autofill fills properties using information in the row.' } as MenuItemDef] }]),
      { items: [
        { id: 'new', label: 'New AI autofill', icon: 'plus', onSelect: () => { createAutofillProperty(collectionId, 'sum', 'Paragraph', view); } },
        { id: 'agent', label: 'Custom Agent', icon: 'aiFace', badge: 'New', description: 'Uses advanced models, web search, and your connected workspace to fill properties.', disabled: true },
      ] },
    ],
  }, { placement: 'bottom-end' });
}

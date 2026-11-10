// AI block (`ai_block`, slash "AI Block"): prompt + output type in `format`, generated content stored

// This module is the AI feature's entry point: *.block.tsx files are auto-imported by
// editor/blocks/registerAll.ts after the built-in renderers, so this registration overrides the
// placeholder `ai_block` renderer, and importing ./mount.tsx installs the global AI layer.
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { me, run, setFormat } from '../../lib/blocks.ts';
import { formatDateTime } from '../../lib/format.ts';
import { useRecord } from '../../lib/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { openPagePicker } from '../editor/inline/PagePicker.tsx';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { BlockList, registerBlock, blockRegistry, type BlockProps } from '../editor/Block.tsx';
import { AiMarkdown } from './AiMarkdown.tsx';
import { FaceGlyph } from './AiFace.tsx';
import { ensureAiStatus, NO_KEY_MESSAGE, streamAi, useAiStatus } from './aiApi.ts';
import { setChildrenFromMarkdown } from './insert.ts';
import { NoKeyNotice } from './NoKeyNotice.tsx';
import './mount.tsx';
import './ai.css';

type Output = 'custom' | 'page_summary' | 'key_points' | 'action_items';

function titleOf(id: string): string {
  const b = records.get<BlockRecord>('block', id);
  return ((b?.properties?.title as [string][] | undefined) ?? []).map((d) => d[0]).join('') || 'Untitled';
}

type Sources = 'page' | 'specified' | 'search';

const OUTPUTS: { id: Output; label: string; placeholder: string; icon: string }[] = [
  { id: 'custom', label: 'Custom output', placeholder: 'Describe what to generate. Use ‘@’ for people, pages, or dates', icon: 'pencil' },
  { id: 'page_summary', label: 'Page summary', placeholder: 'Give me a brief of this page', icon: 'textJustifyLeft' },
  { id: 'key_points', label: 'Key points', placeholder: 'Pull out the main points from this page', icon: 'listBullet' },
  { id: 'action_items', label: 'Action items', placeholder: 'Surface action items on this page', icon: 'checklist' },
];

const SOURCES: { id: Sources; label: string; icon: string }[] = [
  { id: 'page', label: 'Current page', icon: 'page' },
  { id: 'specified', label: 'Specific pages', icon: 'pageLink' },
  { id: 'search', label: 'Current page and workspace', icon: 'magnifyingGlass' },
];

interface GenState {
  running: boolean;
  text: string;
  error: { code: string; message: string } | null;
  abort: AbortController | null;
}

const gens = new Map<string, GenState>();
const genListeners = new Map<string, Set<() => void>>();

function setGen(blockId: string, patch: Partial<GenState>) {
  const cur = gens.get(blockId) ?? { running: false, text: '', error: null, abort: null };
  gens.set(blockId, { ...cur, ...patch });
  genListeners.get(blockId)?.forEach((f) => f());
}

function useGen(blockId: string): GenState {
  const [, force] = useState(0);
  useEffect(() => {
    const set = genListeners.get(blockId) ?? new Set();
    const f = () => force((x) => x + 1);
    set.add(f);
    genListeners.set(blockId, set);
    return () => {
      set.delete(f);
    };
  }, [blockId]);
  return gens.get(blockId) ?? { running: false, text: '', error: null, abort: null };
}

export async function generateAiBlock(block: BlockRecord, override?: { prompt?: string; output?: Output; sources?: Sources; mentions?: string[] }) {
  const fmt = (block.format ?? {}) as Record<string, unknown>;
  const prompt = override?.prompt ?? String(fmt.ai_prompt ?? '');
  const output = override?.output ?? ((fmt.ai_output as Output | undefined) ?? 'custom');
  const sources = override?.sources ?? ((fmt.ai_sources as Sources | undefined) ?? 'page');
  const mentions = override?.mentions ?? (Array.isArray(fmt.ai_mentions) ? (fmt.ai_mentions as string[]) : []);
  if (useUI.getState().connection === 'offline') {
    setGen(block.id, { error: { code: 'offline', message: 'Litpage AI isn’t available offline.' }, running: false });
    return;
  }
  if (useAiStatus.getState().configured === false) {
    setGen(block.id, { error: { code: 'no_key', message: NO_KEY_MESSAGE }, running: false });
    return;
  }
  gens.get(block.id)?.abort?.abort();
  const ac = new AbortController();
  setGen(block.id, { running: true, text: '', error: null, abort: ac });
  let acc = '';
  try {
    const done = await streamAi({ kind: 'block', blockId: block.id, prompt, output, sources, mentions }, {
      onDelta: (d) => {
        acc += d;
        setGen(block.id, { text: acc });
      },
    }, ac.signal);
    if (done.status === 'error' || done.status === 'refused') {
      setGen(block.id, { running: false, error: done.error ?? { code: 'error', message: 'Generation failed. Try again in a moment.' } });
      return;
    }
    const text = (done.text || acc).trim();
    
    if (text) setChildrenFromMarkdown(block.id, text, { ai_last_generated: Date.now(), ai_last_generated_by: me() });
    setGen(block.id, { running: false, text: '', abort: null });
  } catch (e: any) {
    setGen(block.id, { running: false, error: { code: e?.code ?? 'error', message: e?.code === 'no_key' ? NO_KEY_MESSAGE : e?.message ?? 'Generation failed. Try again in a moment.' } });
  }
}

// The slash command dispatches `nc:open-block-placeholder` right after creating the block, before
// this renderer mounts: remember the request so the new block opens its settings on mount.
const pendingOpen = new Set<string>();
if (typeof window !== 'undefined') {
  window.addEventListener('nc:open-block-placeholder', (e) => {
    const id = (e as CustomEvent).detail?.blockId as string | undefined;
    if (!id) return;
    pendingOpen.add(id);
    setTimeout(() => pendingOpen.delete(id), 4000);
  });
}

function openConfig(block: BlockRecord, anchor: HTMLElement) {
  ensureAiStatus();
  openOverlay((close) => <AiBlockConfig block={block} close={close} />, { anchor, placement: 'bottom-start', offset: 6 });
}

function AiBlockConfig({ block, close }: { block: BlockRecord; close: () => void }) {
  const fmt = (block.format ?? {}) as Record<string, unknown>;
  const [output, setOutput] = useState<Output>((fmt.ai_output as Output | undefined) ?? 'custom');
  const [prompt, setPrompt] = useState(String(fmt.ai_prompt ?? ''));
  const [sources, setSources] = useState<Sources>((fmt.ai_sources as Sources | undefined) ?? 'page');
  const [mentions, setMentions] = useState<string[]>(Array.isArray(fmt.ai_mentions) ? (fmt.ai_mentions as string[]) : []);
  const configured = useAiStatus((s) => s.configured);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => ref.current?.focus(), [output]);
  const cfg = OUTPUTS.find((o) => o.id === output)!;
  const canGenerate = (output !== 'custom' || !!prompt.trim()) && (sources !== 'specified' || mentions.length > 0);
  const generate = () => {
    if (!canGenerate) return;
    const patch = { ai_prompt: prompt, ai_output: output, ai_sources: sources, ai_mentions: mentions };
    run('aiBlock.configure', (tx) => setFormat(tx, block.id, patch));
    close();
    void generateAiBlock({ ...block, format: { ...block.format, ...patch } }, { prompt, output, sources, mentions });
  };
  // workspace page search (recents first); picking a page keeps this popover open
  const addPage = (anchor: HTMLElement) => {
    openPagePicker(anchor, { exclude: [block.id, ...mentions], onPick: (id) => setMentions((m) => (m.includes(id) ? m : [...m, id])) });
  };
  const chooseSources = (anchor: HTMLElement) => {
    let closeMenu: (() => void) | undefined;
    // returning false keeps the other overlays (this popover) open; only the menu closes
    closeMenu = openMenu(anchor, { width: 260, sections: [{ items: SOURCES.map((o) => ({ label: o.label, icon: o.icon, checked: sources === o.id, onSelect: () => { setSources(o.id); closeMenu?.(); return false; } })) }] }, { placement: 'bottom-start' });
  };
  return (
    <PopoverSurface width={480}>
      <div className="nc-ai-block-config" onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generate(); } }}>
        <div className="nc-ai-block-config-title">Generate</div>
        <div className="nc-ai-block-config-label">Choose an output format</div>
        <div className="nc-ai-block-types" role="radiogroup">
          {OUTPUTS.map((o) => (
            <div key={o.id} role="radio" aria-checked={o.id === output} className={`nc-ai-block-type ${o.id === output ? 'active' : ''}`} onClick={() => setOutput(o.id)}>
              <Icon name={o.icon} size={14} />
              <span>{o.label}</span>
            </div>
          ))}
        </div>
        <textarea
          ref={ref}
          className="nc-ai-block-prompt"
          rows={3}
          value={prompt}
          placeholder={cfg.placeholder}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="nc-ai-block-context">
          <span className="nc-ai-block-context-title">Based on information from</span>
          <span
            role="button"
            className="nc-ai-block-context-chip"
            data-testid="ai-block-sources"
            onClick={(e) => chooseSources(e.currentTarget)}
          >
            <Icon name={SOURCES.find((o) => o.id === sources)!.icon} size={14} /> {SOURCES.find((o) => o.id === sources)!.label}
            <Icon name="chevronDown" size={12} />
          </span>
        </div>
        {(sources === 'specified' || mentions.length > 0) && (
          <div className="nc-ai-block-context">
            {mentions.map((id) => (
              <span key={id} className="nc-ai-block-context-chip" data-testid="ai-block-ref">
                <Icon name="page" size={14} /> {titleOf(id)}
                <span role="button" aria-label="Remove page" className="nc-ai-context-chip-x" onClick={() => setMentions((m) => m.filter((x) => x !== id))}><Icon name="close" size={10} /></span>
              </span>
            ))}
            <span role="button" className="nc-ai-block-context-chip ghost" onClick={(e) => addPage(e.currentTarget)}><Icon name="plus" size={12} /> Add page</span>
          </div>
        )}
        {configured === false && <NoKeyNotice compact />}
        <div className="nc-ai-block-config-actions">
          <button className="nc-btn" onClick={close}>Cancel</button>
          <button className="nc-btn primary" disabled={!canGenerate} onClick={generate}>Generate</button>
        </div>
      </div>
    </PopoverSurface>
  );
}

function AiBlock({ block, depth, readOnly }: BlockProps) {
  const gen = useGen(block.id);
  const ref = useRef<HTMLDivElement>(null);
  const fmt = (block.format ?? {}) as Record<string, unknown>;
  const generatedAt = fmt.ai_last_generated as number | undefined;
  const author = useRecord('lit_user', fmt.ai_last_generated_by as string | undefined) as any;
  const hasContent = !!block.content?.length;
  const configured = useAiStatus((s) => s.configured);

  useEffect(() => {
    const open = () => {
      if (!pendingOpen.has(block.id) || !ref.current || readOnly) return;
      pendingOpen.delete(block.id);
      openConfig(block, ref.current);
    };
    // the block may mount after the event (slash insert) or be mounted already (event later)
    const t = setTimeout(open, 0);
    const on = (e: Event) => {
      if ((e as CustomEvent).detail?.blockId === block.id) setTimeout(open, 0);
    };
    window.addEventListener('nc:open-block-placeholder', on);
    return () => {
      clearTimeout(t);
      window.removeEventListener('nc:open-block-placeholder', on);
    };
  }, [block, readOnly]);

  const toolbar = !readOnly && (
    <div className="nc-ai-block-toolbar" contentEditable={false}>
      {gen.running ? (
        <div role="button" className="nc-ai-block-tool" data-tooltip="Stop" onClick={() => gen.abort?.abort()}>
          <span className="nc-ai-stop-square small" />
        </div>
      ) : (
        <div role="button" aria-label="Generate" className="nc-ai-block-tool" data-tooltip="Generate" onClick={() => void generateAiBlock(block)}>
          <Icon name="refresh" size={16} />
        </div>
      )}
      <div role="button" aria-label="Settings" className="nc-ai-block-tool" data-tooltip="Settings" onClick={(e) => openConfig(block, e.currentTarget)}>
        <Icon name="sliders" size={16} />
      </div>
    </div>
  );

  return (
    <div className="nc-pad">
      <div ref={ref} className={`nc-ai-block ${gen.running ? 'generating' : ''} ${hasContent ? 'filled' : 'empty'}`} data-testid="ai-block">
        {(hasContent || gen.running) && toolbar}
        {gen.running ? (
          <div className="nc-ai-block-stream" aria-busy="true">
            {gen.text.trim() ? <AiMarkdown text={gen.text} streaming /> : (
              <div className="nc-ai-step"><span className="nc-ai-step-dot" /><span className="nc-ai-shimmer">Generating...</span></div>
            )}
          </div>
        ) : hasContent ? (
          <BlockList parentId={block.id} ids={block.content} depth={depth + 1} readOnly={readOnly} className="nc-ai-block-children" />
        ) : (
          <div
            role="button"
            className="nc-ai-block-empty"
            onClick={() => { if (!readOnly && ref.current) openConfig(block, ref.current); }}
          >
            <span className="nc-ai-block-empty-icon"><FaceGlyph size={18} /></span>
            <span>{fmt.ai_prompt ? String(fmt.ai_prompt) : 'Generated content will appear here. Click to configure.'}</span>
            {!readOnly && !!fmt.ai_prompt && (
              <span role="button" className="nc-ai-block-generate" onClick={(e) => { e.stopPropagation(); void generateAiBlock(block); }}>Generate</span>
            )}
          </div>
        )}
        {gen.error && !gen.running && (
          gen.error.code === 'no_key' ? <NoKeyNotice compact /> : (
            <div className="nc-ai-error" role="alert"><Icon name="warning" size={14} /><span>{gen.error.message || 'Generation failed. Try again in a moment.'}</span></div>
          )
        )}
        {configured === false && !gen.error && !hasContent && !readOnly && <NoKeyNotice compact />}
        {hasContent && generatedAt && !gen.running && (
          <div className="nc-ai-block-footer">Generated by Litpage AI on {formatDateTime(generatedAt)}{author?.name ? ` · ${author.name}` : ''}</div>
        )}
      </div>
    </div>
  );
}

registerBlock(['ai_block'], AiBlock);
// registerAll.ts imports the built-in renderers before globbing *.block.tsx; re-assert on the next
// tick in case a later module registers the placeholder again.
queueMicrotask(() => {
  if (blockRegistry.ai_block !== AiBlock) registerBlock(['ai_block'], AiBlock);
});

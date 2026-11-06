// Button block. Pill: 32px tall, r6,
// 1px solid rgba(0, 0, 0, 0.11) (--lp-border-primary-transparent), 14px/500, padding 8px 12px; an unconfigured button shows a red ⚠.
// Config panel (inline, ~600px): icon + name ("New button") / When: "Button is clicked" / Do: the shared step cards
// (features/database/automations/steps.tsx: Insert blocks, Add page to…, Edit pages in…, Send notification to…,
// Send mail…, Send webhook, Show confirmation, Open page, form, or URL, Send message to agent, Send Slack
// notification to…, Define variables) / blue "Done". Name = properties.title, icon = format.page_icon,
// color = format.block_color. Automation settings use format.button_automation with a trigger, version, and actions; the block keeps
// them in automation records). Clicking runs the steps as the person who clicked (automations/runner.tsx).
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { buttonBlockSteps, type AutomationAction } from '@nc/shared/automation/index.ts';
import { registerBlock, BlockList, type BlockProps } from '../Block.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { useBlock } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { createBlockIn, getBlock, run, setFormat, setTitle } from '../../../lib/blocks.ts';
import { openIconPicker } from '../../page/IconPicker.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { useEditor } from '../editorState.ts';
import { pageIdOfBlock } from '../commands.ts';
import { registerBlockMenu } from './registry.ts';
import { blockElement, consumePendingOpen, toast } from './shared.tsx';
import { StepList } from '../../database/automations/steps.tsx';
import { runButtonSteps } from '../../database/automations/runner.tsx';
import { fireConfetti, type ButtonEffect } from '../../database/automations/confetti.ts';
import '../../database/automations/automations.css';
// "@Today / @Now / @Me" template variables in the Insert blocks content 
import '../../database/templates/templateVars.tsx';
import { colorToken } from '../../../lib/colorToken.ts';

function schemaOf(collectionId: string) {
  return records.get<CollectionRecord>('collection', collectionId)?.schema;
}

function stepsOf(b: BlockRecord | undefined): AutomationAction[] {
  return buttonBlockSteps(b, schemaOf);
}

function nameOf(b: BlockRecord): string {
  return toPlainText(b.properties?.title as RichText | undefined);
}

const useConfigOpen = create<{ open: Record<string, boolean>; set: (id: string, v: boolean) => void }>((set, get) => ({
  open: {},
  set: (id, v) => set({ open: { ...get().open, [id]: v } }),
}));

export function openButtonConfig(blockId: string) {
  useConfigOpen.getState().set(blockId, true);
}

/** Run a button block as the current user (also used by templates' / pages' keyboard activation). */
export async function runButton(blockId: string, anchor: HTMLElement | null) {
  const b = getBlock(blockId);
  if (!b) return;
  const steps = stepsOf(b);
  if (!steps.length) {
    openButtonConfig(blockId);
    return;
  }
  const page = getBlock(pageIdOfBlock(blockId));
  await runButtonSteps({ surface: 'button_block', steps, block: b, page, anchor, label: nameOf(b) || 'New button' });
}

/* ------------------------------------------------------------------ config panel */

function InsertBlocksEditor({ block }: { block: BlockRecord }) {
  const live = useBlock(block.id) ?? block;
  return (
    <div className="nc-auto-blocks nc-button-template">
      {live.content?.length ? (
        <BlockList parentId={live.id} ids={live.content} depth={1} readOnly={false} />
      ) : (
        <div className="nc-auto-blocks-empty" role="button" onMouseDown={(e) => {
          e.preventDefault();
          let id = '';
          run('button.addTemplateBlock', (tx) => { id = createBlockIn(tx, { type: 'text', parentId: live.id, parentTable: 'block' }); });
          useEditor.getState().requestFocus(id, 0);
        }}>Click to edit or drop blocks…</div>
      )}
    </div>
  );
}

function ConfigPanel({ block, onDone }: { block: BlockRecord; onDone: () => void }) {
  const [name, setName] = useState(nameOf(block));
  const steps = stepsOf(block);
  const nameRef = useRef<HTMLInputElement>(null);
  const icon = block.format?.page_icon as string | undefined;
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);
  const saveName = (v: string) => run('button.rename', (tx) => setTitle(tx, block.id, v ? [[v]] : []), { coalesceKey: `button-name:${block.id}` });
  const setSteps = (actions: AutomationAction[]) => run('button.setActions', (tx) => setFormat(tx, block.id, { button_automation: { trigger: 'button_clicked', v: 2, actions } }), { coalesceKey: `button-steps:${block.id}` });
  return (
    <div className="nc-button-config" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} data-menu-keys="ignore">
      <div className="nc-button-config-head">
        <div role="button" className="nc-button-config-icon" aria-label="Change button icon" onClick={(e) => openIconPicker(e.currentTarget, { current: icon, onPick: (v) => run('button.setIcon', (tx) => setFormat(tx, block.id, { page_icon: v ?? undefined })) })}>
          {icon ? <PageIcon icon={icon} size={22} fallback={null} /> : <Icon name="smileFace" size={20} />}
        </div>
        <input
          ref={nameRef}
          className="nc-button-config-name"
          placeholder="New button"
          value={name}
          onChange={(e) => { setName(e.target.value); saveName(e.target.value); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onDone(); } if (e.key === 'Escape') { e.preventDefault(); onDone(); } }}
        />
      </div>
      <div className="nc-button-config-label">When</div>
      <div className="nc-button-config-card"><Icon name="cursorClick" size={16} style={{ color: 'var(--lp-icon-secondary)' }} /><span><b style={{ fontWeight: 500 }}>Button</b> is clicked</span></div>
      <div className="nc-button-config-connector" />
      <div className="nc-button-config-label" style={{ marginTop: 0 }}>Do</div>
      <StepList
        surface="button_block"
        blockId={block.id}
        steps={steps}
        onChange={setSteps}
        renderInsertBlocks={() => <InsertBlocksEditor block={block} />}
      />
      <button className="nc-blk-btn primary nc-button-done" onClick={onDone}>Done</button>
    </div>
  );
}

/* ------------------------------------------------------------------ block */

function ButtonBlock({ block, readOnly }: BlockProps) {
  const open = useConfigOpen((s) => !!s.open[block.id]);
  const [running, setRunning] = useState(false);
  const btnRef = useRef<HTMLDivElement>(null);
  const configured = stepsOf(block).length > 0;
  const label = nameOf(block) || 'New button';
  const icon = block.format?.page_icon as string | undefined;
  const color = block.format?.block_color as string | undefined;
  const style = useMemo<React.CSSProperties>(() => {
    if (!color || color === 'default') return {};
    const base = color.replace('_background', '');
    const p = base === 'teal' ? 'gre' : base.slice(0, 3);
    return color.endsWith('_background') ? { background: `var(${colorToken(p, 'bg-secondary')})`, borderColor: 'transparent' } : { color: `var(${colorToken(p, 'text-secondary')})` };
  }, [color]);
  useEffect(() => {
    if (!readOnly && consumePendingOpen(block.id)) openButtonConfig(block.id);
    const on = (e: Event) => {
      if ((e as CustomEvent).detail?.blockId === block.id && !readOnly) {
        consumePendingOpen(block.id);
        openButtonConfig(block.id);
      }
    };
    window.addEventListener('nc:open-block-placeholder', on);
    return () => window.removeEventListener('nc:open-block-placeholder', on);
  }, [block.id, readOnly]);
  return (
    <div className="nc-bpad6 nc-button-block-wrap">
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }} className="nc-blk-hoverable-inline">
        <div
          ref={btnRef}
          role="button"
          tabIndex={0}
          aria-disabled={readOnly || undefined}
          className={`nc-button-2 ${configured ? '' : 'unconfigured'} ${running ? 'running' : ''}`}
          style={style}
          onMouseDown={(e) => e.preventDefault()}
          onClick={async () => {
            // buttons are for people who can edit the page; the server checks every write again
            if (readOnly) {
              if (configured) toast('You need edit access to use this button');
              return;
            }
            if (!configured) return openButtonConfig(block.id);
            if (effectOf(block) === 'confetti') fireConfetti(btnRef.current);
            setRunning(true);
            try {
              await runButton(block.id, btnRef.current);
            } finally {
              setRunning(false);
            }
          }}
        >
          {icon && <PageIcon icon={icon} size={16} fallback={null} />}
          <span className="label">{label}</span>
          {!configured && <span className="warn" aria-label="This button has no configured actions"><Icon name="warningTriangleFill" size={18} /></span>}
        </div>
        {!readOnly && !open && (
          <div role="button" className="nc-blk-action nc-button-gear" aria-label="Edit button" data-tooltip="Edit button" onMouseDown={(e) => e.preventDefault()} onClick={() => openButtonConfig(block.id)}>
            <Icon name="settings" size={16} />
          </div>
        )}
      </div>
      {open && !readOnly && <ConfigPanel block={block} onDone={() => useConfigOpen.getState().set(block.id, false)} />}
    </div>
  );
}

registerBlock(['button'], ButtonBlock);

const effectOf = (b: BlockRecord | undefined): ButtonEffect | undefined => ((b?.format as any)?.button_effect === 'confetti' ? 'confetti' : undefined);

function setEffect(blockId: string, effect: ButtonEffect | undefined) {
  run('setButtonEffect', (tx) => setFormat(tx, blockId, { button_effect: effect }));
}

registerBlockMenu(['button'], ({ block, color }) => [
  { label: 'Edit', icon: 'settings', onSelect: () => { openButtonConfig(block.id); setTimeout(() => blockElement(block.id)?.scrollIntoView({ block: 'nearest' }), 50); } },
  // “Click effect ▸ None / Confetti”
  {
    id: 'click-effect', label: 'Click effect', icon: 'sparkles',
    submenu: () => ({ width: 180, sections: [{ items: [
      { id: 'none', label: 'None', checked: !effectOf(block), onSelect: () => setEffect(block.id, undefined) },
      { id: 'confetti', label: 'Confetti', checked: effectOf(block) === 'confetti', onSelect: () => setEffect(block.id, 'confetti') },
    ] }] }),
  },
  color,
]);

export { useBlock };

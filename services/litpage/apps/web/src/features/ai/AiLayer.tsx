// Coordinates the AI panel, inline writer, and keyboard or editor entry points.

import { useEffect, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { length, type RichText } from '@nc/shared/richtext.ts';
import { getBlock } from '../../lib/blocks.ts';
import { navigate, spaceDomain, useLocation } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { appendToPage, pageIdOfBlock } from '../editor/commands.ts';
import { useEditor } from '../editor/editorState.ts';
import { getSelectionOffsets } from '../editor/richTextDom.ts';
import { AiFaceAvatar } from './AiFace.tsx';
import { deleteChat, ensureAiStatus, pinChat, policyFromSpaceSettings, useAiStatus, useChatThreads } from './aiApi.ts';
import { useCurrentSpace } from '../../lib/hooks.ts';
import { chatUrl, openChatHistory, openRenameChat, shareChatLink, UNTITLED_CHAT } from './ChatHistory.tsx';
import { ChatView } from './ChatView.tsx';
import { InlineWriter, selectionMarkdown } from './InlineWriter.tsx';
import { richTextToMarkdown } from './insert.ts';
import { useAiLayer, type WriterTarget } from './layerStore.ts';
import { SKILL, skillFromLabel, type SkillId } from './skills.ts';
import { createHtmlWithAi } from './htmlAi.ts';
import { savePref } from '../settings/userSettings.ts';
import { useAsSkill, useSkills } from './aiStores.ts';
import { editSkill } from './SkillsLibrary.tsx';

// ---------------------------------------------------------------------------------------------
// Entry points

function leafOf(blockId: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${blockId}"] [data-content-editable-leaf="true"]`);
}

function isEmptyText(blockId: string): boolean {
  const b = getBlock(blockId);
  return !!b && b.type === 'text' && length(b.properties?.title as RichText | undefined) === 0 && !(b.content?.length);
}

function blocksMarkdown(ids: string[], depth = 0): string {
  const out: string[] = [];
  for (const id of ids) {
    const b = getBlock(id);
    if (!b || !b.alive) continue;
    const pad = '  '.repeat(depth);
    const t = richTextToMarkdown(b.properties?.title as RichText | undefined);
    const prefix: Record<string, string> = {
      header: '# ', sub_header: '## ', sub_sub_header: '### ', header_4: '#### ', bulleted_list: '- ', numbered_list: '1. ', quote: '> ', toggle: '- ',
      to_do: (b.properties?.checked as any)?.[0]?.[0] === 'Yes' ? '- [x] ' : '- [ ] ',
    };
    if (b.type === 'code') out.push('```', t, '```');
    else if (b.type === 'divider') out.push('---');
    else out.push(pad + (prefix[b.type] ?? '') + t);
    if (b.content?.length && b.type !== 'page') out.push(blocksMarkdown(b.content, depth + 1));
  }
  return out.filter((l) => l !== '').join('\n');
}


export function askAiAtBlock(blockId: string, opts?: { start?: number; end?: number; property?: string; skill?: SkillId | null; skillId?: string; blockIds?: string[]; prompt?: string; language?: string; pageId?: string }) {
  const b = getBlock(blockId);
  if (!b) return;
  const pageId = opts?.pageId ?? pageIdOfBlock(blockId) ?? blockId;
  const auto = { skill: opts?.skill ?? null, prompt: opts?.prompt, language: opts?.language, skillId: opts?.skillId };
  let target: Omit<WriterTarget, 'seq'>;
  if (opts?.blockIds && opts.blockIds.length) {
    target = { pageId, blockId: opts.blockIds[0], mode: 'blocks', blockIds: opts.blockIds, selectionMd: blocksMarkdown(opts.blockIds), ...auto };
  } else if (opts?.start !== undefined && opts.end !== undefined && opts.end > opts.start) {
    const property = opts.property ?? 'title';
    target = { pageId, blockId, mode: 'selection', start: opts.start, end: opts.end, property, selectionMd: selectionMarkdown(blockId, opts.start, opts.end, property), ...auto };
  } else if (isEmptyText(blockId) && !opts?.skill) {
    target = { pageId, blockId, mode: 'empty', prompt: opts?.prompt, skillId: opts?.skillId };
  } else if (opts?.skill || opts?.skillId) {
    target = { pageId, blockId, mode: 'blocks', blockIds: [blockId], selectionMd: blocksMarkdown([blockId]), ...auto };
  } else {
    target = { pageId, blockId, mode: 'below', prompt: opts?.prompt };
  }
  (document.activeElement as HTMLElement | null)?.blur?.();
  useAiLayer.getState().openWriter(target);
}


function translatePage(pageId: string, language?: string) {
  const page = getBlock(pageId);
  const ids = (page?.content ?? []).filter((id) => {
    const b = getBlock(id);
    return b && b.alive && b.type !== 'page' && b.type !== 'collection_view_page';
  });
  if (!ids.length) return;
  askAiAtBlock(ids[0], { blockIds: ids, skill: 'translate', language, pageId });
}


function askAiFromPage(pageId: string | null) {
  const ed = useEditor.getState();
  if (ed.selectedBlocks.length) {
    askAiAtBlock(ed.selectedBlocks[0], { blockIds: [...ed.selectedBlocks] });
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const leaf = active?.closest?.('[data-content-editable-leaf="true"]') as HTMLElement | null;
  const blockEl = leaf?.closest<HTMLElement>('.lit-page-content [data-block-id]');
  if (leaf && blockEl?.dataset.blockId && (!pageId || pageIdOfBlock(blockEl.dataset.blockId) === pageId)) {
    const sel = getSelectionOffsets(leaf);
    askAiAtBlock(blockEl.dataset.blockId, sel && sel.end > sel.start ? { start: sel.start, end: sel.end } : undefined);
    return;
  }
  useAiLayer.getState().openPanel();
}


function askAiOnPage(pageId: string) {
  const page = getBlock(pageId);
  const empty = (page?.content ?? []).find((id) => isEmptyText(id));
  const id = empty ?? appendToPage(pageId);
  let tries = 0;
  const open = () => {
    if (leafOf(id) || tries++ > 20) askAiAtBlock(id);
    else requestAnimationFrame(open);
  };
  requestAnimationFrame(open);
}

interface AskAiDetail {
  
  skillId?: string;
  blockId?: string;
  pageId?: string;
  property?: string;
  start?: number;
  end?: number;
  skill?: string;
  prompt?: string;
  language?: string;
  empty?: boolean;
  blockIds?: string[];
  mode?: 'edit';
  trigger?: 'space';
  handled?: boolean;
  source?: string;
  action?: string;
  edit?: boolean;
}


function onAskAi(e: Event) {
  const ce = e as CustomEvent<AskAiDetail>;
  const d = ce.detail ?? {};
  if (d.action === 'use-as-agent-instructions' && d.pageId) {
    
    // every chat and workspace Q&A request
    savePref('ai_instructions_page', d.pageId);
    return;
  }
  if (d.action === 'use-as-skill' && d.pageId) {
    // page ••• → Use with AI → Use as AI skill: registers the page as a skill (server checks edit access)
    void useAsSkill(d.pageId);
    return;
  }
  if (d.skill === 'manage') {
    // selection menu → Skills → "Manage skills": the Library's Skills tab
    navigate(`/${spaceDomain(useSession.getState().spaceId)}/library/skills`);
    return;
  }
  if (d.edit && (d.skill || d.skillId)) {
    // "Edit skill": a skill is a page — your own skills open as they are, a built-in becomes your editable copy
    void editSkill(d.skill, d.skillId);
    return;
  }
  if (d.action || d.edit) return; // other "Use with AI" actions
  ensureAiStatus();
  if (ce.cancelable) ce.preventDefault(); // tells cancelable dispatchers the AI handled it
  if (d.trigger === 'space') d.handled = true; // the editor keeps the space out of the block
  // a user skill (selection menu / block menu / "/skill") runs as a custom prompt with the skill's instructions
  const userSkill = d.skillId ? { id: d.skillId } : d.skill ? useSkills.getState().enabled.find((x) => !x.builtin && x.name.toLowerCase() === d.skill!.trim().toLowerCase()) : undefined;
  if (userSkill && d.blockId) {
    const ranged = d.start !== undefined && d.end !== undefined && d.end > d.start;
    askAiAtBlock(d.blockId, ranged ? { start: d.start, end: d.end, property: d.property, skillId: userSkill.id } : { blockIds: d.blockIds ?? [d.blockId], skillId: userSkill.id });
    return;
  }
  const skill = skillFromLabel(d.skill);
  if (d.blockId) {
    const ed = useEditor.getState();
    const multi = d.blockIds ?? (ed.selectedBlocks.includes(d.blockId) && ed.selectedBlocks.length > 1 ? [...ed.selectedBlocks] : undefined);
    const ranged = d.start !== undefined && d.end !== undefined && d.end > d.start;
    if (ranged) askAiAtBlock(d.blockId, { start: d.start, end: d.end, property: d.property, skill, prompt: d.prompt, language: d.language });
    else if (multi?.length) askAiAtBlock(d.blockId, { blockIds: multi, skill, language: d.language }); // several selected blocks
    else if (d.prompt) askAiAtBlock(d.blockId, { prompt: d.prompt }); // button block action
    else if (isEmptyText(d.blockId)) askAiAtBlock(d.blockId); // Space / slash on an empty line
    else if ((d.empty === false || (d.start !== undefined && !d.mode)) && !skill) askAiAtBlock(d.blockId); // caret in a line with text → write below
    else askAiAtBlock(d.blockId, { blockIds: [d.blockId], skill, language: d.language }); // block menu / ⌘⌃E → act on the block
    return;
  }
  // Inbox → "Prioritize with AI" (and other non-page entry points that pass a prompt): ask in the chat panel
  if (!d.blockId && !d.pageId && d.prompt?.trim() && d.source && d.source !== 'shortcut') {
    useAiLayer.getState().openPanel({ query: d.prompt.trim() });
    return;
  }
  const pageId = d.pageId ?? null;
  if (pageId && skill === 'translate') {
    translatePage(pageId, d.language);
    return;
  }
  const ed = useEditor.getState();
  const focusedOnPage = !!(document.activeElement as HTMLElement | null)?.closest?.('.lit-page-content [data-content-editable-leaf="true"]') || ed.selectedBlocks.length > 0;
  if (focusedOnPage) askAiFromPage(pageId);
  else if (d.source === 'shortcut') useAiLayer.getState().openPanel();
  else if (pageId && getBlock(pageId)) askAiOnPage(pageId);
  else useAiLayer.getState().openPanel();
}


function onSkillMenu(e: Event) {
  const d = ((e as CustomEvent).detail ?? {}) as { blockId?: string; anchor?: DOMRect };
  if (!d.blockId) return;
  const blockId = d.blockId;
  ensureAiStatus();
  // a fresh list each time the menu opens (skills created elsewhere, e.g. by the agent, show up right away)
  void useSkills.getState().load(true).then(() => {
    const mine = useSkills.getState().enabled.filter((s) => !s.builtin && s.inPage);
    const builtin = (['improve', 'proofread', 'explain', 'reformat', 'summarize', 'action_items', 'translate', 'continue'] as SkillId[]).map((id) => SKILL[id]);
    const anchor = d.anchor ?? document.querySelector(`[data-block-id="${blockId}"]`)?.getBoundingClientRect() ?? { x: 200, y: 200 };
    openMenu(anchor as DOMRect, {
      width: 280,
      search: 'Search skills…',
      sections: [
        ...(mine.length ? [{ title: 'Your skills', items: mine.map((s) => ({ label: s.name, icon: 'aiStepSkill', description: s.description || undefined, onSelect: () => askAiAtBlock(blockId, { skillId: s.id }) })) }] : []),
        { title: 'Skills', items: builtin.map((s) => ({ label: s.label, icon: s.icon, onSelect: () => (isEmptyText(blockId) ? askAiAtBlock(blockId, { prompt: s.label }) : askAiAtBlock(blockId, { blockIds: [blockId], skill: s.id })) })) },
        { items: [{ label: 'Manage skills', icon: 'sliders', onSelect: () => navigate(`/${spaceDomain(useSession.getState().spaceId)}/library/skills`) }] },
      ],
    }, { placement: 'bottom-start' });
  });
}


function onBuildDatabase(e: Event) {
  const d = ((e as CustomEvent).detail ?? {}) as { blockId?: string; prompt?: string };
  if (!d.blockId || !d.prompt?.trim()) return;
  ensureAiStatus();
  useAiLayer.getState().openPanel({
    query: `Build this database: ${d.prompt.trim()}\n\nUpdate the existing database (database_id: ${d.blockId}) with update_database — give it a fitting name, add the properties and views it needs — then add 3 to 5 example rows with create_pages (parent type "database"). Don't create a new database.`,
  });
}


function onHtmlAi(e: Event) {
  const ce = e as CustomEvent<{ blockId?: string; kind?: string; prompt?: string }>;
  const d = ce.detail ?? {};
  if (!d.blockId) return;
  ce.preventDefault();
  void createHtmlWithAi(d.blockId, d.kind ?? 'app', d.prompt);
}

// ---------------------------------------------------------------------------------------------
// UI


function scrollbarWidth(): number {
  const probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;top:-9999px;left:-9999px;width:20px;height:20px;overflow-y:scroll;visibility:hidden';
  document.body.appendChild(probe);
  const w = probe.offsetWidth - probe.clientWidth;
  probe.remove();
  return w;
}


function useFrameCorner(): { right: number; bottom: number } {
  const { route } = useLocation();
  const [pos, setPos] = useState({ right: 16, bottom: 16 });
  useLayoutEffect(() => {
    let frame: HTMLElement | null = null;
    let ro: ResizeObserver | null = null;
    let raf = 0;
    let tries = 0;
    const sbw = scrollbarWidth();
    const update = () => {
      const r = frame?.getBoundingClientRect();
      const right = Math.max(0, r ? window.innerWidth - r.right : 0) + 16 + sbw;
      const bottom = Math.max(0, r ? window.innerHeight - r.bottom : 0) + 16 + sbw;
      setPos((p) => (p.right === right && p.bottom === bottom ? p : { right, bottom }));
    };
    const attach = () => {
      frame = document.querySelector<HTMLElement>('.lit-frame');
      if (!frame && tries++ < 120) {
        raf = requestAnimationFrame(attach);
        return;
      }
      update();
      if (frame) {
        ro = new ResizeObserver(update);
        ro.observe(frame);
      }
    };
    attach();
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [route.name]);
  return pos;
}

function FloatingButton({ hidden }: { hidden: boolean }) {
  const open = useAiLayer((s) => s.panelOpen);
  const corner = useFrameCorner();
  
  const aiEnabled = useAiStatus((s) => s.policy.enabled);
  if (hidden || !aiEnabled) return null;
  return (
    <div className="lit-assistant-corner-origin-container nc-ai-corner" style={{ bottom: `calc(${corner.bottom}px + var(--lp-safe-padding-bottom, 0px))`, insetInlineEnd: corner.right }}>
      <div
        role="button"
        tabIndex={0}
        aria-label="ai"
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tooltip={open ? undefined : 'Litpage AI'}
        className="lit-ai-button nc-ai-button"
        onClick={() => {
          ensureAiStatus();
          const s = useAiLayer.getState();
          if (s.panelOpen) s.closePanel();
          else s.openPanel();
        }}
      >
        <AiFaceAvatar size={40} />
      </div>
    </div>
  );
}

const HEAD_ICON = { color: 'var(--lp-icon-primary)' };


function PanelHeader({ threadId, title, onNew, onClose }: { threadId: string | null; title: string; onNew: () => void; onClose: () => void }) {
  const threadTitle = useChatThreads((s) => s.threads.find((t) => t.id === threadId)?.title);
  const thread = useChatThreads((s) => s.threads.find((t) => t.id === threadId));
  const mode = useAiLayer((s) => s.panelMode);
  const shown = threadId ? threadTitle || title || UNTITLED_CHAT : 'Fresh AI conversation';
  const history = (anchor: HTMLElement) => void openChatHistory(anchor, { currentId: threadId, onOpen: (id) => useAiLayer.getState().setPanelThread(id), onNew });
  const switchMode = (anchor: HTMLElement) => openMenu(anchor, {
    width: 220,
    sections: [{ items: [
      { label: 'Sidebar', icon: 'sidePeek', checked: mode === 'sidebar', onSelect: () => useAiLayer.getState().setPanelMode('sidebar') },
      { label: 'Floating', icon: 'centerPeek', checked: mode === 'floating', onSelect: () => useAiLayer.getState().setPanelMode('floating') },
      { label: 'Full', icon: 'fullPage', onSelect: () => { onClose(); navigate(chatUrl(threadId)); } },
    ] }],
  }, { placement: 'bottom-end' });
  const actions = (anchor: HTMLElement) => openMenu(anchor, {
    width: 240,
    sections: [
      { items: [
        { label: 'Copy link', icon: 'link', disabled: !threadId, onSelect: () => { void navigator.clipboard?.writeText(location.origin + chatUrl(threadId)).catch(() => {}); useUI.getState().toast('Link copied'); } },
        { label: thread?.shared ? 'Copy link to shared chat' : 'Share chat', icon: 'share', disabled: !thread, onSelect: () => { if (thread) void shareChatLink(thread); } },
        { label: thread?.pinned ? 'Unpin' : 'Pin', icon: 'pin', disabled: !thread, onSelect: () => { if (thread) void pinChat(thread.id, !thread.pinned); } },
        { label: 'Open as a full page', icon: 'arrowDiagonalUpRightSmall', onSelect: () => { onClose(); navigate(chatUrl(threadId)); } },
        { label: 'Rename', icon: 'edit', disabled: !thread, onSelect: () => { if (thread) setTimeout(() => openRenameChat(anchor, thread), 0); } },
      ] },
      { items: [
        {
          label: 'Delete chat', icon: 'trash', danger: true, disabled: !thread,
          onSelect: () => {
            if (!thread || !window.confirm(`Delete “${thread.title || UNTITLED_CHAT}” chat?`)) return;
            void deleteChat(thread.id);
            onNew();
          },
        },
      ] },
    ],
  }, { placement: 'bottom-end' });
  return (
    <div className="nc-ai-panel-head">
      <div className="nc-ai-panel-head-left">
        <div role="button" aria-label="Personalize" data-tooltip="Personalize" className="nc-ai-head-face" onClick={() => useUI.getState().openSettings('lit-ai')}>
          <AiFaceAvatar size={24} />
        </div>
        <div className="nc-ai-panel-title nc-ellipsis">{shown}</div>
        <div role="button" aria-label="Chat history" data-tooltip="Chat history" className="nc-ai-head-btn" onClick={(e) => history(e.currentTarget)}>
          <Icon name="chevronDown" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />
        </div>
      </div>
      <div className="nc-ai-panel-actions">
        <div role="button" aria-label="Begin a new conversation" data-tooltip="Begin a new conversation" className="nc-ai-head-btn" onClick={onNew}>
          <Icon name="chatBubblePlus" size={20} style={HEAD_ICON} />
        </div>
        <div role="button" aria-label="Change conversation mode" data-tooltip="Change conversation mode" className="nc-ai-head-btn" onClick={(e) => switchMode(e.currentTarget)}>
          <Icon name="aiSidebarMode" size={20} style={HEAD_ICON} />
        </div>
        <div role="button" aria-label="Chat actions" data-tooltip="Chat actions" className="nc-ai-head-btn" onClick={(e) => actions(e.currentTarget)}>
          <Icon name="ellipsis" size={20} style={HEAD_ICON} />
        </div>
        <div role="button" aria-label="Hide chat" data-tooltip="Hide chat" className="nc-ai-head-btn" onClick={onClose}>
          <Icon name="arrowChevronDoubleRight" size={20} style={HEAD_ICON} />
        </div>
      </div>
    </div>
  );
}

function PanelChat({ pageId }: { pageId: string | null }) {
  const threadId = useAiLayer((s) => s.panelThreadId);
  const query = useAiLayer((s) => s.panelQuery);
  const close = () => useAiLayer.getState().closePanel();
  return (
    <ChatView
      variant="panel"
      threadId={threadId}
      contextPageId={pageId}
      initialQuery={query}
      onThreadChange={(id) => useAiLayer.getState().setPanelThread(id)}
      header={({ threadId: tid, title }) => (
        <PanelHeader threadId={tid} title={title} onNew={() => useAiLayer.getState().openPanel({ threadId: null })} onClose={close} />
      )}
    />
  );
}


function FloatingPanel({ pageId }: { pageId: string | null }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !document.querySelector('.lit-overlay-container .nc-overlay')) {
        const inPanel = (document.activeElement as HTMLElement | null)?.closest?.('.nc-ai-panel');
        if (inPanel) useAiLayer.getState().closePanel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="nc-ai-panel floating" role="dialog" aria-label="Litpage AI">
      <PanelChat pageId={pageId} />
    </div>
  );
}

const SIDE_MIN = 320;

function sideWidth(stored: number | null): number {
  const vw = window.innerWidth;
  return Math.max(SIDE_MIN, Math.min(stored ?? vw * 0.28, Math.max(SIDE_MIN, vw - 480)));
}


function SideResizer() {
  const set = (w: number | null) => useAiLayer.getState().setPanelWidth(w === null ? null : sideWidth(w));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize with the left and right arrow keys"
      tabIndex={0}
      className="nc-ai-side-resizer"
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.classList.add('dragging');
        const move = (ev: PointerEvent) => set(window.innerWidth - ev.clientX);
        const up = () => {
          el.classList.remove('dragging');
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      }}
      onDoubleClick={() => set(null)}
      onKeyDown={(e) => {
        const cur = sideWidth(useAiLayer.getState().panelWidth);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          set(cur + (e.key === 'ArrowLeft' ? 16 : -16));
        } else if (e.key === 'Home') {
          e.preventDefault();
          set(null);
        }
      }}
    />
  );
}


function SidePanel({ pageId }: { pageId: string | null }) {
  const stored = useAiLayer((s) => s.panelWidth);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [, setVw] = useState(0);
  useLayoutEffect(() => {
    let tries = 0;
    let raf = 0;
    const find = () => {
      const el = document.querySelector<HTMLElement>('.lit-cursor-listener');
      if (el) setHost(el);
      else if (tries++ < 120) raf = requestAnimationFrame(find);
    };
    find();
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, []);
  // one right-hand panel at a time: Updates & analytics / All discussions give way to the chat
  useEffect(() => {
    if (useUI.getState().rightPanel) useUI.getState().set({ rightPanel: null });
  }, []);
  if (!host) return null;
  return createPortal(
    <div className="nc-ai-panel nc-ai-side lit-peek-renderer" role="region" aria-label="Side Peek" style={{ width: sideWidth(stored) }}>
      <SideResizer />
      <PanelChat pageId={pageId} />
    </div>,
    host,
  );
}

export function AiLayer() {
  const status = useSession((s) => s.status);
  const { route, peek } = useLocation();
  
  const space = useCurrentSpace();
  const spaceSettings = space?.settings;
  useEffect(() => {
    if (!space) return;
    const next = policyFromSpaceSettings(space.settings as Record<string, unknown> | undefined);
    if (JSON.stringify(useAiStatus.getState().policy) !== JSON.stringify(next)) useAiStatus.setState({ policy: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space?.id, spaceSettings]);
  const panelOpen = useAiLayer((s) => s.panelOpen);
  const panelMode = useAiLayer((s) => s.panelMode);
  const writer = useAiLayer((s) => s.writer);
  const [vw, setVw] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  const ready = status === 'ready' && route.name !== 'public' && route.name !== 'login' && route.name !== 'signup' && route.name !== 'onboarding';
  const pageId = peek?.pageId ?? (route.name === 'page' ? route.pageId : null);

  useEffect(() => {
    if (!ready) return;
    ensureAiStatus();
    const onOpen = (e: Event) => {
      const d = ((e as CustomEvent).detail ?? {}) as { query?: string; threadId?: string; retrieve?: boolean };
      useAiLayer.getState().openPanel({ query: d.query, threadId: d.threadId, retrieve: d.retrieve });
    };
    const onSearch = (e: Event) => {
      const d = ((e as CustomEvent).detail ?? {}) as { query?: string; research?: boolean };
      const q = String(d.query ?? '').trim();
      // Quick Find → "Search all sources with AI": Research mode over workspace (+ web when enabled)
      if (q) navigate(`${chatUrl()}?q=${encodeURIComponent(q)}&ws=1${d.research === false ? '' : '&mode=research'}`);
    };
    window.addEventListener('nc:ask-ai', onAskAi);
    window.addEventListener('nc:ai-open', onOpen);
    window.addEventListener('nc:ai-search', onSearch);
    window.addEventListener('nc:ai-skill-menu', onSkillMenu);
    window.addEventListener('nc:html-ai', onHtmlAi);
    window.addEventListener('nc:ai-build-database', onBuildDatabase);
    return () => {
      window.removeEventListener('nc:ask-ai', onAskAi);
      window.removeEventListener('nc:ai-open', onOpen);
      window.removeEventListener('nc:ai-search', onSearch);
      window.removeEventListener('nc:ai-skill-menu', onSkillMenu);
      window.removeEventListener('nc:html-ai', onHtmlAi);
      window.removeEventListener('nc:ai-build-database', onBuildDatabase);
    };
  }, [ready]);

  // the writer belongs to a page: close it when navigating away
  useEffect(() => {
    const w = useAiLayer.getState().writer;
    if (w && w.pageId !== pageId && !(peek && pageIdOfBlock(w.blockId) === peek.pageId)) useAiLayer.getState().closeWriter();
  }, [pageId, peek]);

  // the panel is redundant on the full-page chat
  useEffect(() => {
    if (route.name === 'chat' && useAiLayer.getState().panelOpen) useAiLayer.getState().closePanel();
  }, [route.name]);

  // a page panel docking on the right (Updates & analytics, All discussions) replaces the docked chat
  useEffect(() => useUI.subscribe((s, prev) => {
    const ai = useAiLayer.getState();
    if (s.rightPanel && s.rightPanel !== prev.rightPanel && ai.panelOpen && ai.panelMode === 'sidebar') ai.closePanel();
  }), []);

  if (!ready) return null;
  const showPanel = panelOpen && route.name !== 'chat';
  // narrow windows (phones, small tablets) can't spare a docked column: the chat floats there instead
  const docked = panelMode === 'sidebar' && vw >= 900;
  return (
    <>
      <FloatingButton hidden={route.name === 'chat' || panelOpen} />
      {showPanel && (docked ? <SidePanel pageId={pageId} /> : <FloatingPanel pageId={pageId} />)}
      {writer && <InlineWriter key={writer.seq} target={writer} />}
    </>
  );
}


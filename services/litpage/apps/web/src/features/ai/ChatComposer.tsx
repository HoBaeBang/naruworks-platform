import { HELP_URL } from '@nc/shared/brand.ts';

// contentEditable prompt (14px/20px, padding 12px 12px 0, min 56 / max 240px), "@" mentions of pages, people and
// teamspaces, "/" skills, attachment / skill chips, the "Current page" context chip, and the bottom row:
// + menu (files · Skills · Web · Connections · Mode) · mode pill · approval mode · model · voice · send/stop.
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { BlockRecord, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { api, uploadFile } from '../../lib/api.ts';
import { ancestorsOf, getBlock } from '../../lib/blocks.ts';
import { useBlock } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu, type MenuItemDef, type MenuSectionDef } from '../../components/Menu.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { pageTitle } from '../page/pageActions.ts';
import { savePref } from '../settings/userSettings.ts';
import { NO_KEY_MESSAGE, useAiStatus, type ApprovalMode, type ChatMode } from './aiApi.ts';
import { activeConnectionIds, useConnections, useSkills, type SkillInfo } from './aiStores.ts';
import { choiceDialog, openMcpConnectDialog } from './dialogs.tsx';
import { openKeyHelp } from './NoKeyNotice.tsx';
import { CHAT_SKILL_PROMPTS } from './skills.ts';
import { addDays, isoDate, parseNaturalDate } from '../editor/inline/dates.ts';

export interface ComposerMention {
  pageId: string;
  title: string;
}

export interface ComposerAttachment {
  id: string;
  url: string;
  name: string;
  mime: string;
  size: number;
}


export interface ComposerPayload {
  text: string;
  mentions: ComposerMention[];
  people: { userId: string; name: string }[];
  teamspaces: { teamId: string; name: string }[];
  attachments: ComposerAttachment[];
  skills: { id: string; name: string }[];
  mode: ChatMode;
  approvalMode: ApprovalMode;
  model: string;
  web: boolean;
  connections: string[];
  
  scope?: SourceScope | null;
}

export interface SourceScope {
  kind: 'all' | 'workspace' | 'web' | 'page' | 'teamspace';
  id?: string;
  title?: string;
}

export interface ComposerApi {
  setText: (text: string) => void;
  focus: () => void;
  setMode: (m: ChatMode) => void;
}

interface Props {
  variant: 'page' | 'panel';
  placeholder: string;
  configured: boolean | null;
  streaming: boolean;
  onSend: (payload: ComposerPayload) => void;
  onStop: () => void;
  
  contextPageId?: string | null;
  includePage?: boolean;
  onIncludePage?: (v: boolean) => void;
  autoFocus?: boolean;
  apiRef?: (api: ComposerApi) => void;
  
  threadId?: string | null;
  threadModel?: string | null;
  
  mode?: ChatMode;
  onModeChange?: (m: ChatMode) => void;
  
  agentChat?: boolean;
  
  agentModel?: string;
}

function readPref<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    
  }
}

const MODE_INFO: Record<ChatMode, { label: string; description: string; icon: string; off?: string }> = {
  default: { label: 'Default', description: 'Can search, edit, and take actions', icon: 'aiFace' },
  ask: { label: 'Ask', description: 'Answers only, with no edits', icon: 'questionMarkCircle', off: 'Allow edits' },
  plan: { label: 'Plan', description: 'Plans first, then acts after approval', icon: 'checklist', off: 'Disable planning mode' },
  research: { label: 'Research', description: 'Think deeper and broader.\nSlower, more thorough analysis.', icon: 'docTextMagnifyingGlass', off: 'Disable research mode' },
};
const MODE_ORDER: ChatMode[] = ['default', 'ask', 'plan', 'research'];

const ATTACH_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv,application/json,.md,.markdown,.csv,.tsv,.txt,.json';
const IMAGE_RE = /^image\/(png|jpeg|gif|webp)$/;

function attachmentProblem(f: File): string | null {
  const name = f.name;
  const isImage = IMAGE_RE.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(name);
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(name);
  const isText = f.type.startsWith('text/') || f.type === 'application/json' || /\.(txt|md|markdown|csv|tsv|json)$/i.test(name);
  if (!isImage && !isPdf && !isText) return `“${name}” isn’t a supported file type`;
  if (isImage && f.size > 5 * 1024 * 1024) return `“${name}” is larger than 5 MB`;
  if (isPdf && f.size > 20 * 1024 * 1024) return `“${name}” is larger than 20 MB`;
  if (isText && f.size > 2 * 1024 * 1024) return `“${name}” is larger than 2 MB`;
  return null;
}

// ---------------------------------------------------------------------------------------------
// contentEditable helpers

function serialize(root: HTMLElement): { text: string; mentions: ComposerMention[]; people: { userId: string; name: string }[]; teamspaces: { teamId: string; name: string }[] } {
  let text = '';
  const mentions: ComposerMention[] = [];
  const people: { userId: string; name: string }[] = [];
  const teamspaces: { teamId: string; name: string }[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === Node.TEXT_NODE) {
      text += n.nodeValue ?? '';
      return;
    }
    if (!(n instanceof HTMLElement)) return;
    if (n.dataset.date) {
      
      const title = n.dataset.title ?? '';
      text += title && title !== n.dataset.date ? `@${title} (${n.dataset.date})` : `@${n.dataset.date}`;
      return;
    }
    if (n.dataset.pageId || n.dataset.personId || n.dataset.teamId) {
      const title = n.dataset.title ?? n.textContent ?? '';
      text += `@${title}`;
      if (n.dataset.pageId && !mentions.some((m) => m.pageId === n.dataset.pageId)) mentions.push({ pageId: n.dataset.pageId, title });
      if (n.dataset.personId && !people.some((m) => m.userId === n.dataset.personId)) people.push({ userId: n.dataset.personId, name: title });
      if (n.dataset.teamId && !teamspaces.some((m) => m.teamId === n.dataset.teamId)) teamspaces.push({ teamId: n.dataset.teamId, name: title });
      return;
    }
    if (n.tagName === 'BR') {
      text += '\n';
      return;
    }
    const block = n.tagName === 'DIV' || n.tagName === 'P';
    if (block && text && !text.endsWith('\n')) text += '\n';
    n.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return { text: text.replace(/ /g, ' '), mentions, people, teamspaces };
}

function isEmptyInput(root: HTMLElement): boolean {
  return !root.querySelector('[data-page-id],[data-person-id],[data-team-id],[data-date]') && !(root.textContent ?? '').trim();
}

type OptionKind = 'page' | 'person' | 'team' | 'date';

function mentionToken(kind: OptionKind, id: string, title: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'nc-ai-mention-token';
  span.contentEditable = 'false';
  if (kind === 'page') span.dataset.pageId = id;
  else if (kind === 'person') span.dataset.personId = id;
  else if (kind === 'date') span.dataset.date = id;
  else span.dataset.teamId = id;
  span.dataset.title = title;
  const at = document.createElement('span');
  at.className = 'nc-ai-mention-at';
  at.textContent = '@';
  span.append(at, document.createTextNode(title || 'Untitled'));
  return span;
}

interface TriggerState {
  char: '@' | '/';
  node: Text;
  start: number;
  query: string;
  rect: DOMRect;
}

function detectTrigger(root: HTMLElement): TriggerState | null {
  const sel = window.getSelection();
  if (!sel || !sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== Node.TEXT_NODE || !root.contains(sel.anchorNode)) return null;
  const node = sel.anchorNode as Text;
  const before = (node.nodeValue ?? '').slice(0, sel.anchorOffset);
  const m = /(?:^|[\s ])([@/])([^@/\n]{0,48})$/.exec(before);
  if (!m) return null;
  const char = m[1] as '@' | '/';
  if (m[2].split(/\s+/).length > (char === '/' ? 4 : 5)) return null;
  // "/" only opens the skills menu at the start of the message or after a space
  const start = sel.anchorOffset - m[2].length - 1;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, sel.anchorOffset);
  const rects = range.getClientRects();
  const rect = rects[rects.length - 1] ?? root.getBoundingClientRect();
  return { char, node, start, query: m[2], rect };
}

// ---------------------------------------------------------------------------------------------

interface MenuOption {
  kind: OptionKind | 'skill' | 'prompt';
  id: string;
  title: string;
  path?: string;
  prompt?: string;
  icon?: string;
}

function pageOption(id: string): MenuOption | null {
  const b = getBlock(id);
  if (!b || !b.alive) return null;
  const path = ancestorsOf(id).map((a) => pageTitle(a) || 'Untitled').slice(-2).join(' / ');
  return { kind: 'page', id, title: pageTitle(b) || 'Untitled', path };
}

function spaceMembers(spaceId: string | null): UserRecord[] {
  const space = records.get<SpaceRecord>('space', spaceId);
  const ids = new Set<string>();
  for (const p of space?.permissions ?? []) if (p.user_id && p.role !== 'none') ids.add(p.user_id);
  return [...ids].map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u);
}

function scopeLabel(sc: SourceScope): string {
  if (sc.kind === 'workspace') return 'Litpage';
  if (sc.kind === 'web') return 'Web';
  if (sc.kind === 'page' || sc.kind === 'teamspace') return sc.title || 'Untitled';
  return 'All sources';
}


function dateOptions(q: string): MenuOption[] {
  const ql = q.trim().toLowerCase();
  const today = new Date();
  const iso = (d: Date) => isoDate(d);
  if (!ql) return [{ kind: 'date', id: iso(today), title: 'Today', icon: 'calendar' }];
  const p = parseNaturalDate(q);
  if (p && !p.remind) {
    const v = p.value;
    return [{ kind: 'date', id: v.start_time ? `${v.start_date} ${v.start_time}` : v.start_date, title: p.label, icon: 'calendar' }];
  }
  return ['today', 'tomorrow', 'yesterday'].filter((w) => w.startsWith(ql)).map((w) => {
    const d = addDays(today, w === 'tomorrow' ? 1 : w === 'yesterday' ? -1 : 0);
    return { kind: 'date' as const, id: iso(d), title: w.charAt(0).toUpperCase() + w.slice(1), icon: 'calendar' };
  });
}

function TriggerMenu({ state, onPick, active, setActive, sections, total }: { state: TriggerState; onPick: (o: MenuOption) => void; active: number; setActive: (i: number) => void; sections: { title: string; options: MenuOption[] }[]; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const flat = sections.flatMap((s) => s.options);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight || 260;
    const w = 330;
    const below = state.rect.bottom + 12;
    const top = below + h > window.innerHeight - 12 ? Math.max(12, state.rect.top - 12 - h) : below;
    setPos({ left: Math.max(12, Math.min(state.rect.left - 6, window.innerWidth - w - 12)), top });
  }, [state.rect, flat.length]);
  let idx = -1;
  return (
    <div ref={ref} className="nc-popover nc-ai-mention-menu" role="listbox" data-trigger={state.char} style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999 }} onMouseDown={(e) => e.preventDefault()}>
      {flat.length === 0 && <div className="nc-menu-empty">No results</div>}
      {sections.map((s) => (s.options.length ? (
        <div key={s.title}>
          <div className="nc-ai-mention-section">{s.title}</div>
          {s.options.map((o) => {
            idx++;
            const i = idx;
            return (
              <div key={`${o.kind}:${o.id}`} role="option" aria-selected={i === active} className={`nc-ai-mention-item ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => onPick(o)}>
                <div className="nc-ai-mention-icon">
                  {o.kind === 'page' ? <PageIcon block={getBlock(o.id)} size={18} />
                    : o.kind === 'person' ? <span className="nc-ai-person-avatar">{(o.title || '?').slice(0, 1).toUpperCase()}</span>
                      : <Icon name={o.icon ?? (o.kind === 'team' ? 'teamspace' : 'aiStepSkill')} size={18} />}
                </div>
                <div className="nc-ai-mention-text">
                  <div className="nc-ellipsis">{o.title}</div>
                  {o.path && <div className="nc-ai-mention-path nc-ellipsis">{o.path}</div>}
                </div>
              </div>
            );
          })}
        </div>
      ) : null))}
      {total > flat.length && state.char === '@' && (
        <div className="nc-ai-mention-more">
          <Icon name="ellipsis" size={16} />
          <span>{total - flat.length} more results</span>
        </div>
      )}
    </div>
  );
}

function ContextChip({ pageId, included, onToggle }: { pageId: string; included: boolean; onToggle: (v: boolean) => void }) {
  const block = useBlock(pageId);
  if (!block) return null;
  const title = pageTitle(block) || 'Untitled';
  if (!included) {
    return (
      <div role="button" className="nc-ai-context-chip ghost" data-tooltip="Add context so Litpage AI can tailor its response" onClick={() => onToggle(true)}>
        <Icon name="plusSmall" size={14} />
        <span>Current page</span>
      </div>
    );
  }
  return (
    <div className="nc-ai-context-chip" data-tooltip="Current page">
      <PageIcon block={block as BlockRecord} size={14} />
      <span className="nc-ellipsis">{title}</span>
      <div role="button" aria-label="Remove context" className="nc-ai-context-chip-x" onClick={() => onToggle(false)}>
        <Icon name="close" size={12} />
      </div>
    </div>
  );
}

interface PendingFile {
  key: string;
  name: string;
  size: number;
  mime: string;
  status: 'uploading' | 'ready' | 'error';
  preview?: string;
  uploaded?: ComposerAttachment;
  error?: string;
}

function placeCaretAtEnd(el: HTMLElement) {
  el.focus();
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

function modelLabelOf(id: string, models: { id: string; name: string; version: string }[]): string {
  if (!id || id === 'auto') return 'Auto';
  const m = models.find((x) => x.id === id);
  return m ? `${m.name} ${m.version}` : 'Auto';
}

export function ChatComposer(p: Props) {
  const inputRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(true);
  const [trigger, setTrigger] = useState<TriggerState | null>(null);
  const [sections, setSections] = useState<{ title: string; options: MenuOption[] }[]>([]);
  const [total, setTotal] = useState(0);
  const [active, setActive] = useState(0);
  const status = useAiStatus();
  const [approval, setApproval] = useState<ApprovalMode>(() => readPref<ApprovalMode>('nc:ai:approval', status.prefs.approvalMode ?? 'review_for_me'));
  const [model, setModel] = useState<string>(() => p.threadModel || (p.agentChat ? p.agentModel ?? 'auto' : readPref('nc:ai:model', 'auto')));
  const [localMode, setLocalMode] = useState<ChatMode>('default');
  const mode = p.mode ?? localMode;
  const setMode = (m: ChatMode | ((cur: ChatMode) => ChatMode)) => {
    const next = typeof m === 'function' ? m(mode) : m;
    if (p.onModeChange) p.onModeChange(next);
    else setLocalMode(next);
  };
  const [web, setWeb] = useState<boolean>(() => readPref<string>('nc:ai:web', status.prefs.web ? '1' : '0') === '1');
  const [scope, setScope] = useState<SourceScope>({ kind: 'all' });
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [skills, setSkills] = useState<{ id: string; name: string }[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<any>(null);
  const spaceId = useSession((s) => s.spaceId);
  const offline = useUI((s) => s.connection === 'offline');
  const disabled = p.configured === false || status.policy.enabled === false || offline;
  const flat = sections.flatMap((s) => s.options);
  const uploading = files.some((f) => f.status === 'uploading');
  const hasContent = !empty || files.some((f) => f.status === 'ready') || skills.length > 0;

  useEffect(() => {
    if (p.threadModel) setModel(p.threadModel);
  }, [p.threadModel]);
  // a skip-all choice the workspace no longer allows falls back to Review risky actions
  useEffect(() => {
    if (approval === 'skip_all' && !status.policy.skipApprovals) setApproval('review_for_me');
  }, [status.policy.skipApprovals, approval]);
  useEffect(() => {
    p.apiRef?.({
      setText: (t) => {
        const el = inputRef.current;
        if (!el) return;
        el.textContent = t;
        setEmpty(!t.trim());
        placeCaretAtEnd(el);
      },
      focus: () => inputRef.current?.focus(),
      setMode: (m) => setMode(m),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (p.autoFocus) inputRef.current?.focus();
  }, [p.autoFocus]);

  // @ / "/" menu contents
  useEffect(() => {
    if (!trigger || !spaceId) return;
    let alive = true;
    const q = trigger.query.trim();
    const ql = q.toLowerCase();
    if (trigger.char === '/') {
      void useSkills.getState().load().then(() => {
        if (!alive) return;
        const userSkills = useSkills.getState().enabled.filter((s) => !s.builtin && s.inChat && (!ql || s.name.toLowerCase().includes(ql)));
        const prompts = CHAT_SKILL_PROMPTS.filter((s) => !ql || s.label.toLowerCase().includes(ql));
        const secs = [
          { title: 'Your skills', options: userSkills.map((s): MenuOption => ({ kind: 'skill', id: s.id, title: s.name, path: s.description || undefined })) },
          { title: 'Skills', options: prompts.map((s): MenuOption => ({ kind: 'prompt', id: s.label, title: s.label, prompt: s.prompt, icon: s.icon })) },
        ];
        setSections(secs);
        setTotal(secs.reduce((n, s) => n + s.options.length, 0));
        setActive(0);
      });
      return () => {
        alive = false;
      };
    }
    const t = setTimeout(async () => {
      try {
        let ids: string[] = [];
        if (q) {
          const res = await api('searchWorkspace', { query: q, spaceId, limit: 30 });
          records.mergeRecordMap(res.recordMap);
          ids = res.results.map((r: any) => r.id);
        } else {
          const res = await api('listRecentPages', { spaceId, limit: 20 });
          records.mergeRecordMap(res.recordMap);
          ids = res.pages.map((r: any) => r.id);
        }
        if (!alive) return;
        const pages = ids.map(pageOption).filter((o): o is MenuOption => !!o);
        const people = spaceMembers(spaceId).filter((u) => !ql || (u.name ?? '').toLowerCase().includes(ql) || (u.email ?? '').toLowerCase().startsWith(ql))
          .slice(0, q ? 4 : 3).map((u): MenuOption => ({ kind: 'person', id: u.id, title: u.name || u.email || 'Unknown' }));
        const teams = records.all<TeamRecord>('team').filter((tm) => tm.space_id === spaceId && tm.alive !== false && (!ql || tm.name.toLowerCase().includes(ql)))
          .slice(0, q ? 3 : 2).map((tm): MenuOption => ({ kind: 'team', id: tm.id, title: tm.name, icon: 'teamspace' }));
        const dates = dateOptions(q);
        setTotal(dates.length + pages.length + people.length + teams.length);
        setSections([
          { title: 'Date', options: dates },
          { title: 'Page link', options: pages.slice(0, 5) },
          { title: 'People', options: people },
          { title: 'Teamspaces', options: teams },
        ]);
        setActive(0);
      } catch {
        if (alive) setSections([]);
      }
    }, q ? 120 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [trigger?.query, trigger?.char, spaceId, !!trigger]);

  const refresh = () => {
    const el = inputRef.current;
    if (!el) return;
    if (isEmptyInput(el) && el.innerHTML !== '') {
      if (!el.textContent) el.innerHTML = '';
    }
    setEmpty(isEmptyInput(el));
    setTrigger(detectTrigger(el));
  };

  const removeTriggerText = (): Text | null => {
    if (!trigger) return null;
    const { node, start } = trigger;
    const sel = window.getSelection();
    const end = sel?.anchorNode === node ? sel.anchorOffset : start + 1 + trigger.query.length;
    const after = node.splitText(start);
    after.nodeValue = (after.nodeValue ?? '').slice(end - start);
    return after;
  };

  const pick = (o: MenuOption) => {
    const el = inputRef.current;
    if (!trigger || !el) return;
    if (o.kind === 'prompt') {
      el.textContent = o.prompt ?? '';
      setEmpty(!(o.prompt ?? '').trim());
      placeCaretAtEnd(el);
      setTrigger(null);
      return;
    }
    const after = removeTriggerText();
    if (!after) return;
    const sel = window.getSelection();
    if (o.kind === 'skill') {
      setSkills((cur) => (cur.some((s) => s.id === o.id) ? cur : [...cur, { id: o.id, name: o.title }]));
      const r = document.createRange();
      r.setStart(after, 0);
      r.collapse(true);
      sel?.removeAllRanges();
      sel?.addRange(r);
      setTrigger(null);
      refresh();
      return;
    }
    const token = mentionToken(o.kind as OptionKind, o.id, o.title);
    const space = document.createTextNode(' ');
    after.parentNode!.insertBefore(token, after);
    after.parentNode!.insertBefore(space, after);
    const r = document.createRange();
    r.setStart(space, 1);
    r.collapse(true);
    sel?.removeAllRanges();
    sel?.addRange(r);
    setTrigger(null);
    setEmpty(false);
  };

  const addFiles = (list: FileList | File[]) => {
    const arr = [...list];
    const room = Math.max(0, status.maxAttachments - files.length);
    if (arr.length > room) useUI.getState().toast(`You can attach up to ${status.maxAttachments} files to a message.`);
    for (const f of arr.slice(0, room)) {
      const problem = attachmentProblem(f);
      if (problem) {
        useUI.getState().toast(problem);
        continue;
      }
      const key = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const preview = IMAGE_RE.test(f.type) ? URL.createObjectURL(f) : undefined;
      setFiles((cur) => [...cur, { key, name: f.name, size: f.size, mime: f.type || 'application/octet-stream', status: 'uploading', preview }]);
      void uploadFile(f, f.name, spaceId ?? undefined)
        .then((r) => setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, status: 'ready', uploaded: { id: r.id, url: r.url, name: r.name, mime: r.mime, size: r.size } } : x))))
        .catch((e) => setFiles((cur) => cur.map((x) => (x.key === key ? { ...x, status: 'error', error: (e as Error)?.message } : x))));
    }
  };

  const removeFile = (key: string) => setFiles((cur) => {
    const f = cur.find((x) => x.key === key);
    if (f?.preview) URL.revokeObjectURL(f.preview);
    return cur.filter((x) => x.key !== key);
  });

  const submit = () => {
    const el = inputRef.current;
    if (!el || p.streaming) return;
    if (uploading) {
      useUI.getState().toast('Wait for the uploads to complete');
      return;
    }
    const { text, mentions, people, teamspaces } = serialize(el);
    const attachments = files.filter((f) => f.status === 'ready' && f.uploaded).map((f) => f.uploaded!);
    if (!text.trim() && !attachments.length && !skills.length) return;
    p.onSend({
      text: text.trim(), mentions, people, teamspaces, attachments, skills, mode, approvalMode: approval, model, web: web && status.policy.webSearch, scope: scope.kind === 'all' ? null : scope,
      connections: mode === 'ask' ? [] : activeConnectionIds(),
    });
    el.innerHTML = '';
    for (const f of files) if (f.preview) URL.revokeObjectURL(f.preview);
    setFiles([]);
    setSkills([]);
    setEmpty(true);
    setTrigger(null);
  };

  const cycleMode = () => setMode((m) => MODE_ORDER[(MODE_ORDER.indexOf(m) + 1) % MODE_ORDER.length]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (trigger) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActive((a) => (flat.length ? (a + 1) % flat.length : 0));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActive((a) => (flat.length ? (a - 1 + flat.length) % flat.length : 0));
        return;
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && flat[active]) {
        e.preventDefault();
        pick(flat[active]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setTrigger(null);
        return;
      }
    }
    if (e.key === 'Tab' && e.shiftKey) {
      // "Tip: press Shift+Tab to cycle modes"
      e.preventDefault();
      cycleMode();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
      return;
    }
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
    if (e.key === 'Backspace') {
      const sel = window.getSelection();
      if (sel?.isCollapsed && sel.anchorNode) {
        const n = sel.anchorNode;
        const prev = n.nodeType === Node.TEXT_NODE ? (sel.anchorOffset === 0 ? n.previousSibling : null) : n.childNodes[sel.anchorOffset - 1];
        if (prev instanceof HTMLElement && (prev.dataset.pageId || prev.dataset.personId || prev.dataset.teamId)) {
          e.preventDefault();
          prev.remove();
          refresh();
          return;
        }
        // Backspace in an empty input removes the last chip
        if (isEmptyInput(inputRef.current!) && (skills.length || files.length)) {
          e.preventDefault();
          if (skills.length) setSkills((s) => s.slice(0, -1));
          else removeFile(files[files.length - 1].key);
        }
      }
    }
  };

  const toggleWeb = async (on: boolean) => {
    if (on && !status.policy.webSearch) {
      useUI.getState().toast('Web browsing is disabled by your workspace admin.');
      return;
    }
    if (on && readPref<string>('nc:ai:webWarned', '0') !== '1') {
      const ok = await choiceDialog({
        title: 'Confirm this action?',
        description: 'Web access lets Litpage AI browse the internet and connected workspace data without asking for approval. Continue? This comes with risks like data loss and prompt injection.',
        buttons: [{ label: 'Cancel', value: false }, { label: 'Enable web access', value: true, primary: true }],
      });
      if (!ok) return;
      writePref('nc:ai:webWarned', '1');
    }
    setWeb(on);
    writePref('nc:ai:web', on ? '1' : '0');
    savePref('ai_web', on);
  };

  
  const openSourcesMenu = (anchor: HTMLElement) => {
    const spaceId = useSession.getState().spaceId;
    const teams = records.all<TeamRecord>('team').filter((tm) => tm.space_id === spaceId && tm.alive !== false);
    openMenu(anchor, {
      width: 280,
      sections: [
        {
          title: 'Sources',
          items: [
            { id: 'src-all', label: 'All sources', icon: 'squareGrid2X2', description: 'Your workspace, the web and connected apps', checked: scope.kind === 'all', onSelect: () => setScope({ kind: 'all' }) },
            { id: 'src-litpage', label: 'Litpage', icon: 'aiFace', description: 'Only pages in this workspace', checked: scope.kind === 'workspace', onSelect: () => setScope({ kind: 'workspace' }) },
            {
              id: 'src-web', label: 'Web', icon: 'globe', checked: scope.kind === 'web', disabled: !status.policy.webSearch,
              description: status.policy.webSearch ? 'Only the web' : 'Web browsing is disabled by your workspace admin.', onSelect: () => setScope({ kind: 'web' }),
            },
          ],
        },
        {
          title: 'Search within',
          items: [
            {
              id: 'src-page', label: 'A page…', icon: 'page', checked: scope.kind === 'page', description: scope.kind === 'page' ? scope.title : 'A page and its sub-pages',
              onSelect: () => {
                setTimeout(() => {
                  void import('../agents/ui.tsx').then((m) => m.openResourcePicker(anchor, (r) => setScope({ kind: 'page', id: r.blockId, title: r.title })));
                }, 0);
              },
            },
            ...(teams.length
              ? [{
                id: 'src-team', label: 'A teamspace', icon: 'teamspace', checked: scope.kind === 'teamspace', description: scope.kind === 'teamspace' ? scope.title : undefined,
                submenu: () => ({ width: 240, sections: [{ items: teams.map((tm) => ({ id: tm.id, label: tm.name, icon: 'teamspace', checked: scope.kind === 'teamspace' && scope.id === tm.id, onSelect: () => setScope({ kind: 'teamspace', id: tm.id, title: tm.name }) })) }] }),
              }]
              : []),
          ],
        },
      ],
    }, { placement: 'bottom-start', offset: 2 });
  };

  const openPlusMenu = (anchor: HTMLElement) => {
    void useSkills.getState().load();
    void useConnections.getState().load();
    const pageCtx = p.variant === 'panel' && p.contextPageId && p.onIncludePage ? getBlock(p.contextPageId) : null;
    const sectionsDef: MenuSectionDef[] = [];
    if (pageCtx) {
      sectionsDef.push({
        title: 'Context',
        items: [{
          id: 'current-page', label: 'Current page', text: 'Current page', icon: 'page', description: pageTitle(pageCtx) || 'Untitled', checked: !!p.includePage,
          onSelect: () => { p.onIncludePage?.(!p.includePage); },
        }],
      });
    }
    const skillsSub = (): { width: number; sections: MenuSectionDef[] } => {
      const mine = useSkills.getState().enabled.filter((s) => !s.builtin && s.inChat);
      const secs: MenuSectionDef[] = [];
      if (mine.length) {
        secs.push({
          title: 'Your skills',
          items: mine.map((s: SkillInfo) => ({ label: s.name, icon: 'aiStepSkill', description: s.description || undefined, onSelect: () => setSkills((cur) => (cur.some((x) => x.id === s.id) ? cur : [...cur, { id: s.id, name: s.name }])) })),
        });
      }
      secs.push({
        title: 'Skills',
        items: CHAT_SKILL_PROMPTS.map((s) => ({
          label: s.label, icon: s.icon, onSelect: () => {
            const el = inputRef.current;
            if (!el) return;
            el.textContent = s.prompt;
            setEmpty(false);
            placeCaretAtEnd(el);
          },
        })),
      });
      return { width: 260, sections: secs };
    };
    const connectionsSub = (): { width: number; sections: MenuSectionDef[] } => {
      const cs = useConnections.getState();
      const items: MenuItemDef[] = cs.list.map((c) => ({
        id: c.id,
        label: c.name,
        text: c.name,
        icon: 'aiStepPlug',
        description: c.error ? 'Couldn’t connect' : `${c.tools.length} tool${c.tools.length === 1 ? '' : 's'}`,
        disabled: !c.enabled,
        right: <span className={`nc-ai-switch ${c.enabled && !cs.off.has(c.id) ? 'on' : ''}`} aria-hidden><span /></span>,
        onSelect: () => {
          useConnections.getState().toggle(c.id);
          return false;
        },
      }));
      return {
        width: 280,
        sections: [
          ...(items.length ? [{ title: 'Connections', items }] : []),
          { items: [{ label: 'Add Connections', icon: 'plus', description: 'External MCP endpoint', onSelect: () => { setTimeout(() => void openMcpConnectDialog(), 0); } }] },
        ],
      };
    };
    sectionsDef.push({
      items: [
        { label: 'Attach images and files', icon: 'paperClip', onSelect: () => fileRef.current?.click() },
        { label: 'Skills', icon: 'paperBolt', submenu: skillsSub },
        {
          label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>Web <span className="nc-menu-badge">Beta</span></span>, text: 'Web', icon: 'globe',
          description: status.policy.webSearch ? 'Enables web browsing and unrestricted internet access for the agent.' : 'Web browsing is disabled by your workspace admin.',
          disabled: !status.policy.webSearch,
          right: <span className={`nc-ai-switch ${web ? 'on' : ''}`} aria-hidden><span /></span>,
          // after the menu closes (selecting a row closes every overlay, the confirm included)
          onSelect: () => { setTimeout(() => void toggleWeb(!web), 0); },
        },
        { label: 'Connections', icon: 'squareGrid2X2', submenu: connectionsSub },
      ],
    });
    sectionsDef.push({
      title: 'Mode',
      items: MODE_ORDER.map((m) => ({ id: `mode-${m}`, label: MODE_INFO[m].label, icon: MODE_INFO[m].icon, description: MODE_INFO[m].description, checked: mode === m, onSelect: () => setMode(m) })),
    });
    openMenu(anchor, { width: 300, sections: sectionsDef, footer: <div className="nc-ai-menu-tip">Tip: press Shift+Tab to cycle modes</div> }, { placement: 'bottom-start', offset: 2 });
  };

  const chooseApproval = async (id: ApprovalMode) => {
    if (id === 'skip_all') {
      const choice = await choiceDialog<'with' | 'without'>({
        title: 'Enable action without approval?',
        description: 'Litpage AI can act in your workspace and connected apps without asking first. Continue only if you trust this setting. Web browsing gives the agent unrestricted internet access. You can change it later from the + menu.',
        buttons: [{ label: 'Cancel', value: null as unknown as 'with' }, { label: 'Without internet', value: 'without' }, { label: 'With internet', value: 'with', primary: true }],
        width: 440,
      });
      if (!choice) return;
      if (choice === 'with') await toggleWeb(true);
    }
    setApproval(id);
    writePref('nc:ai:approval', id);
    savePref('ai_approval_mode', id);
  };

  const openApprovalMenu = (anchor: HTMLElement) => {
    const opt = (id: ApprovalMode, label: string, desc: string, danger = false): MenuItemDef => {
      const blocked = id === 'skip_all' && !status.policy.skipApprovals;
      return {
        label: danger ? <span style={{ color: blocked ? undefined : 'var(--lp-orange-text-secondary)' }}>{label}</span> : label, text: label,
        description: blocked ? 'A workspace owner disabled approval-free actions.' : desc, checked: approval === id, disabled: blocked,
        onSelect: () => { setTimeout(() => void chooseApproval(id), 0); },
      };
    };
    openMenu(anchor, {
      width: 360,
      header: (
        <div className="nc-ai-menu-head">
          <span>How should Litpage AI request approval?</span>
          {HELP_URL && (<a href={HELP_URL} target="_blank" rel="noopener noreferrer">Learn more</a>)}
        </div>
      ),
      sections: [{
        items: [
          opt('always_ask', 'Always ask', 'Ask before edits or sharing'),
          opt('review_for_me', 'Review risky actions', 'Ask only about actions that may be unsafe'),
          opt('skip_all', 'No approval prompts', 'Act without asking. Use carefully.', true),
        ],
      }],
    }, { placement: 'bottom-start', offset: 2 });
  };

  const chooseModel = (id: string) => {
    setModel(id);
    if (!p.agentChat) writePref('nc:ai:model', id);
    if (p.threadId) void api('aiSetThreadModel', { threadId: p.threadId, model: id }).catch((e) => useUI.getState().toast((e as Error)?.message || 'Couldn’t change the model'));
  };

  const openModelMenu = (anchor: HTMLElement) => {
    const models = status.models;
    const row = (m: (typeof models)[number]): MenuItemDef => ({
      id: m.id,
      label: <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}><span style={{ fontWeight: 500 }}>{m.name}</span><span style={{ color: 'var(--lp-text-secondary)' }}>{m.version}</span>{m.beta && <span className="nc-menu-badge">Beta</span>}</span>,
      text: `${m.name} ${m.version}`,
      icon: 'sparkle',
      checked: model === m.id,
      onSelect: () => chooseModel(m.id),
    });
    const allowed = models.filter((m) => m.allowed);
    const restricted = models.filter((m) => !m.allowed);
    const others = allowed.filter((m) => m.group === 'other');
    openMenu(anchor, {
      width: 300,
      sections: [
        {
          items: [{
            label: <span style={{ fontWeight: 500 }}>Auto</span>, text: 'Auto', icon: 'aiFace', description: 'Balances speed, work, and cost.', checked: model === 'auto',
            onSelect: () => chooseModel('auto'),
          }],
        },
        { title: 'Recommended', items: allowed.filter((m) => m.group === 'recommended').map(row) },
        ...(others.length ? [{ items: [{ label: 'Other models', submenu: () => ({ width: 240, sections: [{ items: others.map(row) }] }) } as MenuItemDef] }] : []),
        ...(restricted.length ? [{ title: <span data-tooltip="These models are restricted in this workspace.">Restricted models</span>, items: restricted.map((m) => ({ ...row(m), disabled: true, onSelect: undefined })) }] : []),
      ],
    }, { placement: 'bottom-end', offset: 2 });
  };

  const SpeechRec = typeof window !== 'undefined' ? ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) : null;
  const toggleVoice = () => {
    if (!SpeechRec) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SpeechRec();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || 'en-US';
    rec.onresult = (ev: any) => {
      const el = inputRef.current;
      if (!el) return;
      let text = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) text += ev.results[i][0].transcript;
      if (!text) return;
      placeCaretAtEnd(el);
      document.execCommand('insertText', false, `${el.textContent && !/\s$/.test(el.textContent) ? ' ' : ''}${text.trim()}`);
      refresh();
    };
    rec.onerror = () => setListening(false);
    rec.onend = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const approvalLabel = approval === 'always_ask' ? 'Always ask' : approval === 'skip_all' ? 'No approval prompts' : 'Review risky actions';
  const noticeText = offline ? 'Litpage AI isn’t available offline. Reconnect to continue' : status.policy.enabled === false ? 'AI is turned off for this workspace' : NO_KEY_MESSAGE;

  return (
    <div
      className={`nc-ai-composer-wrap ${p.variant} ${dragOver ? 'drag' : ''}`}
      data-lit-chat-input-container="true"
      onDragOver={(e) => {
        if (disabled || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (disabled || !e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragOver(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      {disabled && (
        
        // inline, leading 12px dot; the input overlaps its bottom) — our wording: connect an API key
        <div className="nc-ai-banner" role="status">
          <div role="button" tabIndex={0} className="nc-ai-banner-body" onClick={(e) => { if (status.policy.enabled !== false && !offline) openKeyHelp(e.currentTarget); }}>
            <Icon name="aiNoticeDot" size={12} style={{ color: 'var(--lp-blue-icon-accent)' }} />
            <div className="nc-ai-banner-text">
              {noticeText}.{status.policy.enabled !== false && !offline && p.configured === false && <> <span className="nc-ai-banner-link">How to connect</span></>}
            </div>
          </div>
        </div>
      )}
      <div className={`nc-ai-composer ${disabled ? 'disabled' : ''}`}>
        {p.variant === 'page' && p.contextPageId && p.onIncludePage && (
          <div className="nc-ai-context-row">
            <ContextChip pageId={p.contextPageId} included={!!p.includePage} onToggle={p.onIncludePage} />
          </div>
        )}
        {(files.length > 0 || skills.length > 0) && (
          <div className="nc-ai-attach-row" data-testid="ai-composer-chips">
            {skills.map((s) => (
              <div key={s.id} className="nc-ai-attach skill" data-tooltip={s.name}>
                <Icon name="aiStepSkill" size={14} />
                <span className="nc-ellipsis">{s.name}</span>
                <div role="button" aria-label={`Remove ${s.name}`} className="nc-ai-context-chip-x" onClick={() => setSkills((cur) => cur.filter((x) => x.id !== s.id))}><Icon name="close" size={12} /></div>
              </div>
            ))}
            {files.map((f) => (
              <div key={f.key} className={`nc-ai-attach file ${f.status}`} data-tooltip={f.error || f.name}>
                {f.preview ? <img className="nc-ai-attach-thumb" src={f.preview} alt="" /> : <Icon name={f.mime === 'application/pdf' ? 'filePdf' : 'file'} size={14} />}
                <span className="nc-ellipsis">{f.name}</span>
                {f.status === 'uploading' && <span className="nc-ai-attach-status">Uploading…</span>}
                {f.status === 'error' && <span className="nc-ai-attach-status error">Failed</span>}
                <div role="button" aria-label={`Remove ${f.name}`} className="nc-ai-context-chip-x" onClick={() => removeFile(f.key)}><Icon name="close" size={12} /></div>
              </div>
            ))}
          </div>
        )}
        <div
          ref={inputRef}
          className="nc-ai-prompt"
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={p.placeholder}
          data-placeholder={mode === 'plan' && empty ? 'Tell AI what to plan…' : p.placeholder}
          data-empty={empty || undefined}
          spellCheck
          onInput={refresh}
          onKeyUp={(e) => { if (e.key.startsWith('Arrow') && !trigger) refresh(); }}
          onClick={refresh}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setTrigger(null), 150)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length) {
              e.preventDefault();
              addFiles(pasted);
              return;
            }
            e.preventDefault();
            const t = e.clipboardData.getData('text/plain');
            if (t) document.execCommand('insertText', false, t);
          }}
        />
        <input ref={fileRef} type="file" multiple hidden accept={ATTACH_ACCEPT} data-testid="ai-file-input" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
        <div className="nc-ai-composer-bar">
          <div className="nc-ai-composer-left">
            {!p.agentChat && (
              <div role="button" aria-label="Add files and settings" data-tooltip="Give context" className="nc-ai-icon-btn" onClick={(e) => { if (!disabled) openPlusMenu(e.currentTarget); }}>
                <Icon name="plus" size={20} />
              </div>
            )}
            {mode !== 'default' && !p.agentChat && (
              <div className="nc-ai-mode-pill" data-testid="ai-mode-pill" data-mode={mode}>
                <Icon name={MODE_INFO[mode].icon} size={14} />
                <span>{MODE_INFO[mode].label}</span>
                <div role="button" aria-label={MODE_INFO[mode].off} className="nc-ai-context-chip-x" onClick={() => setMode('default')}><Icon name="close" size={12} /></div>
              </div>
            )}
            {!p.agentChat && mode !== 'ask' && (
              <div role="button" className={`nc-ai-pill-btn sources ${scope.kind !== 'all' ? 'on' : ''}`} data-testid="ai-sources-button" aria-label="Choose sources" data-tooltip="Choose sources" onClick={(e) => openSourcesMenu(e.currentTarget)}>
                <Icon name={scope.kind === 'web' ? 'globe' : scope.kind === 'page' ? 'page' : scope.kind === 'teamspace' ? 'teamspace' : scope.kind === 'workspace' ? 'aiFace' : 'squareGrid2X2'} size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
                <span className="nc-ellipsis" style={{ maxWidth: 140 }}>{scopeLabel(scope)}</span>
                {scope.kind !== 'all' && <span role="button" aria-label="Search all sources" className="nc-ai-context-chip-x" onClick={(e) => { e.stopPropagation(); setScope({ kind: 'all' }); }}><Icon name="close" size={12} /></span>}
              </div>
            )}
            {web && status.policy.webSearch && !p.agentChat && (
              <div className="nc-ai-mode-pill web" data-tooltip="Web access enabled">
                <Icon name="globe" size={14} />
                <div role="button" aria-label="Turn off web browser" className="nc-ai-context-chip-x" onClick={() => void toggleWeb(false)}><Icon name="close" size={12} /></div>
              </div>
            )}
            {p.variant === 'panel' ? (
              
              <div role="button" aria-label="Select an approval mode" data-tooltip={approvalLabel} data-testid="agent-service-approval-mode-button" className="nc-ai-icon-btn" onClick={(e) => openApprovalMenu(e.currentTarget)}>
                <Icon name="aiShieldCheck" size={16} />
              </div>
            ) : (
              <div role="button" aria-label="Select an approval mode" data-testid="agent-service-approval-mode-button" className="nc-ai-pill-btn" onClick={(e) => openApprovalMenu(e.currentTarget)}>
                <Icon name="shield" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
                <span>{approvalLabel}</span>
              </div>
            )}
          </div>
          <div className="nc-ai-composer-right">
            {(!p.agentChat || p.agentModel !== undefined) && (
              <div role="button" aria-label="Select an AI model" data-tooltip="Switch AI model" data-testid="agent-chat-model-button" className="nc-ai-pill-btn model" onClick={(e) => openModelMenu(e.currentTarget)}>
                <span>{modelLabelOf(model, status.models)}</span>
              </div>
            )}
            {SpeechRec && !p.streaming && (
              <div role="button" aria-label={listening ? 'Stop voice input' : 'Voice input'} aria-pressed={listening} data-tooltip={listening ? 'Stop voice input' : 'Voice input'} className={`nc-ai-icon-btn ${listening ? 'listening' : ''}`} onClick={() => { if (!disabled) toggleVoice(); }}>
                <Icon name="mic" size={16} />
              </div>
            )}
            {p.streaming ? (
              <div role="button" aria-label="Stop" data-tooltip="Stop" className="nc-ai-send stop" onClick={p.onStop}>
                <span className="nc-ai-stop-square" />
              </div>
            ) : (
              <div
                role="button"
                aria-label="Send AI message"
                aria-disabled={!hasContent || disabled || uploading}
                data-testid="agent-chat-send-button"
                className={`nc-ai-send ${!hasContent || disabled || uploading ? '' : 'ready'}`}
                data-tooltip={uploading ? 'Wait for the uploads to complete' : undefined}
                onClick={() => { if (hasContent && !disabled) submit(); }}
              >
                <Icon name="arrowUp" size={16} strokeWidth={2.2} />
              </div>
            )}
          </div>
        </div>
      </div>
      {trigger && <TriggerMenu state={trigger} sections={sections} total={total} active={active} setActive={setActive} onPick={pick} />}
    </div>
  );
}

export { serialize as serializeComposer };


// composer, stop / retry / copy / insert into page, and thread persistence via the AI API.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '../../lib/api.ts';
import { createPageIn, run } from '../../lib/blocks.ts';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { openPage } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { useEditor } from '../editor/editorState.ts';
import { pageIdOfBlock } from '../editor/commands.ts';
import { AiFaceAvatar } from './AiFace.tsx';
import {
  AiRequestError, answerApproval, ensureAiStatus, markChatRead, sendFeedback, streamAi, undoAgentChanges, useAiStatus, useChatThreads, type ChatMessage,
  type ChatMode, type SourceRef,
} from './aiApi.ts';
import { ChatComposer, type ComposerApi, type ComposerPayload } from './ChatComposer.tsx';
import { Transcript, type StreamingState } from './ChatTranscript.tsx';
import { syncRecords } from '../../lib/store/sync.ts';
import { appendMarkdown, createPlannedInto, insertMarkdownAfter, markdownToPlan } from './insert.ts';
import { PAGE_SUGGESTIONS, PROMPT_PILLS } from './skills.ts';

export interface InitialQuery {
  text: string;
  retrieve?: boolean;
  
  mode?: ChatMode;
  
  key: string;
}


type TurnSettings = Pick<ComposerPayload, 'mode' | 'approvalMode' | 'model' | 'web' | 'connections' | 'scope'>;


export interface AgentChatInfo {
  id: string;
  name: string;
  
  modelOverride?: boolean;
  
  model?: string;
}

export interface ChatViewProps {
  variant: 'page' | 'panel';
  
  agent?: AgentChatInfo;
  
  landing?: ReactNode;
  
  placeholder?: string;
  
  undo?: (messageId: string) => Promise<{ conflicts: number; changes?: unknown }>;
  
  autoSend?: { text: string; key: string } | null;
  
  prefill?: { text: string; key: string } | null;
  threadId?: string | null;
  
  contextPageId?: string | null;
  onThreadChange?: (id: string | null, title?: string) => void;
  initialQuery?: InitialQuery | null;
  header?: (state: { threadId: string | null; title: string; streaming: boolean }) => ReactNode;
}

function localId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function ChatView(props: ChatViewProps) {
  const { variant } = props;
  const spaceId = useSession((s) => s.spaceId);
  const configured = useAiStatus((s) => s.configured);
  const [threadId, setThreadId] = useState<string | null>(props.threadId ?? null);
  const threadRef = useRef<string | null>(props.threadId ?? null);
  const [title, setTitle] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [includePage, setIncludePage] = useState(true);
  const [readOnly, setReadOnly] = useState<{ owner: string } | null>(null);
  const [threadModel, setThreadModel] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>('default');
  const lastSettings = useRef<TurnSettings | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipLoadRef = useRef<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const composerApi = useRef<ComposerApi | null>(null);
  const sentQueryRef = useRef<string | null>(null);

  useEffect(() => ensureAiStatus(), []);

  // follow an externally selected thread (route /chat/:id or history menu)
  useEffect(() => {
    const id = props.threadId ?? null;
    if (id === threadRef.current && (id === null || skipLoadRef.current === id || messages.length)) return;
    abortRef.current?.abort();
    threadRef.current = id;
    setThreadId(id);
    setLoadError(null);
    setReadOnly(null);
    if (!id) {
      setMessages([]);
      setTitle('');
      setThreadModel(null);
      setMode('default');
      return;
    }
    if (skipLoadRef.current === id) return;
    let alive = true;
    void api('aiGetThread', { threadId: id })
      .then((r) => {
        if (!alive) return;
        setMessages(r.messages ?? []);
        setTitle(r.thread?.title ?? '');
        setThreadModel(r.thread?.model ?? null);
        const lastMode = [...((r.messages ?? []) as ChatMessage[])].reverse().find((m) => m.role === 'user')?.mode;
        setMode(lastMode && lastMode !== 'default' ? lastMode : 'default');
        setReadOnly(r.readOnly ? { owner: r.thread?.ownerName ?? '' } : null);
        markChatRead(id);
      })
      .catch((e) => {
        if (alive) setLoadError(e?.status === 404 ? 'You cannot open this chat' : 'Couldn’t load this chat.');
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.threadId]);

  // keep the newest content in view unless the user scrolled up
  useEffect(() => {
    const el = scrollerRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  const reload = useCallback((id: string) => {
    void api('aiGetThread', { threadId: id }).then((r) => {
      if (threadRef.current === id && Array.isArray(r.messages)) setMessages(r.messages);
    }).catch(() => {});
  }, []);

  const runTurn = async (body: Record<string, unknown>, userLocalId?: string) => {
    const ac = new AbortController();
    abortRef.current = ac;
    const st: StreamingState = { text: '', status: null, sources: [], steps: [], changes: null };
    setStreaming({ ...st });
    stickRef.current = true;
    // deltas are coalesced per animation frame; other events flush right away. A frame still pending when the
    // stream ends must not resurrect the streaming state (that would leave the composer stuck on "Stop").
    let raf = 0;
    let ended = false;
    const flush = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (!ended) setStreaming({ ...st });
    };
    try {
      const done = await streamAi(body, {
        onMeta: (m) => {
          if (m.threadId && m.threadId !== threadRef.current) {
            threadRef.current = m.threadId;
            skipLoadRef.current = m.threadId;
            setThreadId(m.threadId);
            setTitle(m.title ?? '');
            
            if (!props.agent) useChatThreads.getState().upsert({ id: m.threadId, title: m.title ?? '', pageId: (body.pageId as string) ?? null });
            props.onThreadChange?.(m.threadId, m.title);
          } else if (m.threadId && !props.agent) {
            useChatThreads.getState().upsert({ id: m.threadId });
          }
          if (m.userMessageId && userLocalId) setMessages((ms) => ms.map((x) => (x.id === userLocalId ? { ...x, id: m.userMessageId! } : x)));
          if (m.truncated?.length) useUI.getState().toast(`Only part of “${m.truncated[0]}” was sent to Litpage AI because the page is very long.`);
        },
        onStatus: (s) => {
          st.status = s;
          flush();
        },
        onSources: (s) => {
          st.sources = s;
          flush();
        },
        onDelta: (d) => {
          st.text += d;
          if (!raf) raf = requestAnimationFrame(flush);
        },
        onStep: (step) => {
          const i = st.steps.findIndex((x) => x.id === step.id);
          st.steps = i >= 0 ? st.steps.map((x, k) => (k === i ? { ...x, ...step, ...(step.status !== 'waiting' ? { approval: undefined } : {}) } : x)) : [...st.steps, step];
          flush();
        },
        onChanges: (c) => {
          st.changes = c.pages;
          flush();
          // the agent's records arrive over the websocket; fetch them too in case this tab isn't subscribed yet
          void syncRecords(c.pages.filter((pg) => pg.pageId).map((pg) => ({ table: 'block', id: pg.pageId }))).catch(() => {});
        },
      }, ac.signal);
      if (raf) cancelAnimationFrame(raf);
      if (done.title && done.threadId) {
        setTitle(done.title);
        if (!props.agent) useChatThreads.getState().upsert({ id: done.threadId, title: done.title });
      }
      const final: ChatMessage = done.message
        ? { ...done.message, status: done.message.status }
        : {
          id: localId('assistant'), role: 'assistant', text: done.text || st.text, status: done.status === 'stopped' ? 'stopped' : done.status,
          error: done.error ?? null, sources: st.sources, mentions: [], pageId: null, createdTime: Date.now(),
        };
      setMessages((ms) => ms.map((x) => (x.id === 'streaming' ? final : x)));
      if (done.status === 'stopped' && threadRef.current) {
        const id = threadRef.current;
        setTimeout(() => reload(id), 500);
      }
    } catch (e) {
      const err = e instanceof AiRequestError ? e : new AiRequestError(0, 'error', 'Something went wrong while loading while processing that request. Please try again later.');
      setMessages((ms) => ms.map((x) => (x.id === 'streaming' ? { ...x, status: 'error', error: { code: err.code, message: err.message } } : x)));
    } finally {
      ended = true;
      if (raf) cancelAnimationFrame(raf);
      if (abortRef.current === ac) abortRef.current = null;
      setStreaming(null);
    }
  };

  const settingsFrom = (p: Partial<ComposerPayload>): TurnSettings => {
    const st = useAiStatus.getState();
    return {
      mode: p.mode ?? 'default',
      approvalMode: p.approvalMode ?? (localStorage.getItem('nc:ai:approval') as ComposerPayload['approvalMode']) ?? st.prefs.approvalMode,
      model: p.model ?? threadModel ?? localStorage.getItem('nc:ai:model') ?? 'auto',
      web: p.web ?? false,
      connections: p.connections ?? [],
      scope: p.scope ?? null,
    };
  };

  const send = (payload: Partial<ComposerPayload> & { text: string }, opts?: { retrieve?: boolean }) => {
    if (streaming || !spaceId) return;
    const pageId = props.contextPageId && includePage ? props.contextPageId : null;
    const userId = localId('user');
    const settings = settingsFrom(payload);
    lastSettings.current = settings;
    const mentions = payload.mentions ?? [];
    const user: ChatMessage = {
      id: userId, role: 'user', text: payload.text, mentions, pageId, status: 'complete', sources: [], createdTime: Date.now(),
      contexts: [...(pageId ? [{ kind: 'page' as const, pageId, title: '' }] : [])],
      attachments: (payload.attachments ?? []).map((a) => ({ id: a.id, name: a.name, mime: a.mime, size: a.size })), skills: payload.skills ?? [], mode: settings.mode,
    };
    const assistant: ChatMessage = { id: 'streaming', role: 'assistant', text: '', status: 'streaming', sources: [], mentions: [], pageId: null, createdTime: Date.now() };
    setMessages((ms) => [...ms, user, assistant]);
    if (props.agent) {
      // a model picked for this chat (when the agent allows it) goes along; the server keeps it with the chat
      const picked = props.agent.modelOverride && payload.model && payload.model !== (threadModel ?? props.agent.model ?? 'auto') ? { model: payload.model } : {};
      void runTurn({ kind: 'agent', agentId: props.agent.id, threadId: threadRef.current, text: payload.text, pageId, approvalMode: settings.approvalMode, ...picked }, userId);
      return;
    }
    void runTurn({
      kind: 'chat', spaceId, threadId: threadRef.current, text: payload.text, pageId, mentions: mentions.map((m) => m.pageId), retrieve: !!opts?.retrieve,
      people: (payload.people ?? []).map((x) => x.userId), teamspaces: (payload.teamspaces ?? []).map((x) => x.teamId),
      attachments: (payload.attachments ?? []).map((a) => ({ url: a.url, name: a.name })), skills: (payload.skills ?? []).map((x) => x.id),
      ...settings,
    }, userId);
  };

  const retry = () => {
    if (streaming || !spaceId) return;
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    if (props.agent) {
      // agent chats: send the question again as a new turn
      setMessages((ms) => (ms[ms.length - 1]?.role === 'assistant' && ms[ms.length - 1].status !== 'complete' ? ms.slice(0, -1) : ms));
      send({ text: lastUser.text, mentions: lastUser.mentions });
      return;
    }
    const persisted = !!threadRef.current && !lastUser.id.startsWith('user-');
    if (!persisted) {
      // the first send never reached the server (e.g. missing key): resend it
      setMessages((ms) => ms.filter((m) => m !== lastUser && !(m.role === 'assistant' && ms.indexOf(m) > ms.indexOf(lastUser))));
      send({ text: lastUser.text, mentions: lastUser.mentions, ...(lastSettings.current ?? {}) });
      return;
    }
    setMessages((ms) => {
      const out = [...ms];
      if (out[out.length - 1]?.role === 'assistant') out.pop();
      return [...out, { id: 'streaming', role: 'assistant', text: '', status: 'streaming', sources: [], mentions: [], pageId: null, createdTime: Date.now() }];
    });
    void runTurn({ kind: 'chat', spaceId, threadId: threadRef.current, retry: true, ...(lastSettings.current ?? settingsFrom({ mode: lastUser.mode })) });
  };

  const onAnswer = async (approvalId: string, decision: 'accept' | 'decline') => {
    try {
      await answerApproval(approvalId, decision);
    } catch (e) {
      useUI.getState().toast((e as Error)?.message || 'This request is no longer waiting for approval.');
      throw e;
    }
  };

  const onUndo = async (messageId: string) => {
    const r = (props.undo ? await props.undo(messageId) : await undoAgentChanges(messageId)) as { conflicts: number; changes?: ChatMessage['changes'] };
    setMessages((ms) => ms.map((m) => (m.id === messageId ? { ...m, changes: r.changes ?? (m.changes ? { ...m.changes, undone: true } : null) } : m)));
    useUI.getState().toast('Changes reverted');
    return { conflicts: r.conflicts };
  };

  const onFeedback = (messageId: string, rating: 'positive' | 'negative' | null, comment?: string) => {
    setMessages((ms) => ms.map((m) => (m.id === messageId ? { ...m, feedback: rating ? { rating, comment } : null } : m)));
    void sendFeedback(messageId, rating, comment).catch(() => {});
    if (rating && !comment) useUI.getState().toast('Thanks for your feedback');
  };

  const stop = () => abortRef.current?.abort();

  useEffect(() => {
    if (props.prefill?.text) composerApi.current?.setText(props.prefill.text);
  }, [props.prefill?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // agent setup chat: the description typed in "Create a new agent" is the first message
  useEffect(() => {
    const q = props.autoSend;
    if (!q || !q.text.trim() || sentQueryRef.current === q.key || !spaceId || configured === null) return;
    sentQueryRef.current = q.key;
    if (configured) send({ text: q.text });
    else composerApi.current?.setText(q.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.autoSend?.key, spaceId, configured]);

  // send an external question once (e.g. "Search or ask", ?q=)
  useEffect(() => {
    const q = props.initialQuery;
    if (!q || !q.text.trim() || sentQueryRef.current === q.key || !spaceId) return;
    if (configured === null) return; // wait for status so the no-key state renders consistently
    sentQueryRef.current = q.key;
    if (q.mode) setMode(q.mode);
    send({ text: q.text, mode: q.mode }, { retrieve: q.retrieve });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.initialQuery?.key, spaceId, configured]);

  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).catch(() => {});
    useUI.getState().toast('Response copied');
  };

  const insert = (text: string, sources: SourceRef[]) => {
    const pageId = props.contextPageId;
    if (pageId) {
      const focused = useEditor.getState().focused?.blockId;
      if (focused && pageIdOfBlock(focused) === pageId) insertMarkdownAfter(focused, text, { sources, action: 'ai.insertIntoPage' });
      else appendMarkdown(pageId, text, { sources, action: 'ai.insertIntoPage' });
      useUI.getState().toast('Added to the page');
      return;
    }
    // full-page chat: save the answer as a new private page
    const plan = markdownToPlan(text, sources);
    let id = '';
    const heading = plan[0]?.type === 'header' ? plan.shift() : null;
    const pageTitle = heading?.title ?? [[(title || 'AI response').slice(0, 120)]];
    run('ai.saveToPage', (tx) => {
      id = createPageIn(tx, { kind: 'private' }, { title: pageTitle as any });
      createPlannedInto(tx, plan, id);
    });
    useUI.getState().toast('Saved to private pages', { label: 'Open', run: () => openPage(id) });
  };

  const empty = messages.length === 0 && !loadError;
  const canInsert = true;
  const insertLabel = props.contextPageId ? 'Add to this page' : 'Save among private pages';
  const placeholder = props.placeholder ?? 'Send a question to Litpage AI';

  const composer = (
    <ChatComposer
      variant={variant}
      placeholder={empty ? placeholder : 'Ask a follow-up…'}
      configured={configured}
      streaming={!!streaming}
      onSend={(payload) => send(payload)}
      onStop={stop}
      contextPageId={props.contextPageId}
      includePage={includePage}
      onIncludePage={setIncludePage}
      autoFocus
      apiRef={(a) => { composerApi.current = a; }}
      threadId={threadId}
      threadModel={threadModel}
      mode={mode}
      onModeChange={setMode}
      agentChat={!!props.agent}
      agentModel={props.agent?.modelOverride ? props.agent.model ?? 'auto' : undefined}
    />
  );

  return (
    <div className={`nc-ai-chat ${variant}`}>
      {props.header?.({ threadId, title, streaming: !!streaming })}
      <div
        ref={scrollerRef}
        className="lit-scroller vertical nc-ai-chat-scroller"
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {loadError ? (
          <div className="nc-ai-noaccess">
            <div className="nc-ai-noaccess-title">{loadError}</div>
            <div className="nc-ai-noaccess-desc">It may be private or sharing may have ended.</div>
            <button className="nc-btn outline" onClick={() => props.onThreadChange?.(null)}>Open a new conversation</button>
          </div>
        ) : empty && props.landing ? (
          <div className="nc-ai-landing nc-agent-landing">
            <div className="nc-ai-landing-inner">
              {props.landing}
              {composer}
            </div>
          </div>
        ) : empty ? (
          variant === 'page' ? (
            <div className="nc-ai-landing">
              <div className="nc-ai-landing-inner">
                <div className="nc-ai-hero">
                  <div role="button" aria-label="Open response preferences" className="nc-ai-hero-face"><AiFaceAvatar size={64} /></div>
                  <div className="nc-ai-hero-title">What would you like to work on?</div>
                </div>
                {composer}
                <div className="nc-ai-pills">
                  {PROMPT_PILLS.map((p) => (
                    <div
                      key={p.label}
                      role="button"
                      aria-label={p.label}
                      data-testid="ai-landing-page-prompt-category"
                      className="nc-ai-pill"
                      onClick={(e) => openMenu(e.currentTarget, {
                        width: 320,
                        sections: [{ title: p.header, items: p.items.map((it) => ({ label: it.label, onSelect: () => composerApi.current?.setText(it.prompt) })) }],
                      }, { placement: 'bottom' })}
                    >
                      <Icon name={p.icon} size={16} />
                      <span>{p.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            
            <div className="nc-ai-panel-empty">
              <div role="button" aria-label="Open response preferences" className="nc-ai-panel-face" onClick={() => useUI.getState().openSettings('lit-ai')}>
                <AiFaceAvatar size={50} />
              </div>
              <div className="nc-ai-panel-empty-title">What would you like to work on?</div>
              {props.contextPageId && (
                <div className="nc-ai-suggestions" role="menu">
                  {PAGE_SUGGESTIONS.map((s) => (
                    <div key={s.label} role="menuitem" tabIndex={-1} className="nc-ai-suggestion" onClick={() => send({ text: s.prompt })}>
                      <Icon name={s.icon} size={20} style={{ color: 'var(--lp-icon-primary)' }} />
                      <span>{s.label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        ) : (
          <div className="nc-ai-thread">
            <Transcript
              messages={messages}
              streaming={streaming}
              canInsert={canInsert}
              insertLabel={insertLabel}
              readOnly={!!readOnly}
              onRetry={retry}
              onCopy={copy}
              onInsert={insert}
              onAnswer={onAnswer}
              onUndo={onUndo}
              onFeedback={onFeedback}
            />
          </div>
        )}
      </div>
      {readOnly && !loadError && (
        <div className="nc-ai-chat-bottom">
          <div className="nc-ai-readonly" role="status">
            <Icon name="lock" size={14} />
            <span>This chat is read-only{readOnly.owner ? ` · Shared by ${readOnly.owner}` : ''}</span>
          </div>
        </div>
      )}
      {(!empty || (variant === 'panel' && !props.landing)) && !loadError && !readOnly && <div className="nc-ai-chat-bottom">{composer}</div>}
    </div>
  );
}

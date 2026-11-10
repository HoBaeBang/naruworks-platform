// Chat transcript rows: user bubbles (with context chips) and assistant answers (status steps,
// streamed Markdown, cited sources, and the action row: copy · retry · insert into page).
import { useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { openPage } from '../../lib/router.ts';
import { getBlock } from '../../lib/blocks.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { AiMarkdown } from './AiMarkdown.tsx';
import { openSource, type AgentStep, type AiStatusEvent, type ChatMessage, type SourceRef, type TouchedPage } from './aiApi.ts';
import { ChangesCard, StepsList } from './AgentSteps.tsx';
import { openKeyHelp } from './NoKeyNotice.tsx';

export interface StreamingState {
  text: string;
  status: AiStatusEvent | null;
  sources: SourceRef[];
  steps: AgentStep[];
  /** pages the running turn already changed */
  changes: TouchedPage[] | null;
}

export interface TranscriptHandlers {
  onRetry: () => void;
  onCopy: (text: string) => void;
  onInsert: (text: string, sources: SourceRef[]) => void;
  /** approval card answer */
  onAnswer?: (approvalId: string, decision: 'accept' | 'decline') => Promise<void>;
  /** "Changes made" → Undo */
  onUndo?: (messageId: string) => Promise<{ conflicts: number } | void>;
  onFeedback?: (messageId: string, rating: 'positive' | 'negative' | null, comment?: string) => void;
}

function StatusStep({ status }: { status: AiStatusEvent | null }) {
  const label = !status || status.phase === 'thinking' || status.phase === 'writing'
    ? 'Thinking…'
    : status.phase === 'searching'
      ? `Searching ${status.detail ? `for “${status.detail}”` : 'your workspace'}…`
      : `Reading ${status.detail ? `“${status.detail}”` : 'page'}…`;
  return (
    <div className="nc-ai-step" role="status" aria-live="polite">
      <span className="nc-ai-step-dot" />
      <span className="nc-ai-shimmer">{label}</span>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function SourcesRow({ sources, text }: { sources: SourceRef[]; text: string }) {
  const cited = new Set([...text.matchAll(/\[(\d{1,3})\](?!\()/g)].map((m) => Number(m[1])));
  const shown = sources.filter((s) => cited.has(s.n)).sort((a, b) => a.n - b.n);
  if (!shown.length) return null;
  return (
    <div className="nc-ai-sources">
      <div className="nc-ai-sources-title">Sources</div>
      <div className="nc-ai-sources-list">
        {shown.map((s) => (s.url ? (
          <a key={s.n} className="nc-ai-source web" href={s.url} target="_blank" rel="noopener noreferrer" data-tooltip={s.url}>
            <span className="nc-ai-source-n">{s.n}</span>
            <span className="nc-ai-ref-fav">{hostOf(s.url).slice(0, 1).toUpperCase()}</span>
            <span className="nc-ellipsis">{s.title || hostOf(s.url)}</span>
          </a>
        ) : (
          <div key={s.n} role="link" className="nc-ai-source" onClick={() => openSource(s)} data-tooltip={s.title || 'Untitled'}>
            <span className="nc-ai-source-n">{s.n}</span>
            <PageIcon block={getBlock(s.pageId)} size={14} />
            <span className="nc-ellipsis">{s.title || 'Untitled'}</span>
          </div>
        )))}
      </div>
    </div>
  );
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function UserRow({ m }: { m: ChatMessage }) {
  const ctx = (m.contexts ?? []).filter((c) => c.kind === 'page');
  const pageCtx = m.pageId && !ctx.some((c) => c.pageId === m.pageId) ? [{ pageId: m.pageId, title: '' }] : [];
  const chips = [...ctx.map((c) => ({ pageId: c.pageId, title: c.title })), ...pageCtx].filter((c) => !m.mentions.some((x) => x.pageId === c.pageId));
  return (
    <div className="nc-ai-row user">
      {chips.length > 0 && (
        <div className="nc-ai-user-ctx">
          {chips.map((c) => (
            <div key={c.pageId} className="nc-ai-context-chip static" role="link" onClick={() => openPage(c.pageId)}>
              <PageIcon block={getBlock(c.pageId)} size={14} />
              <span className="nc-ellipsis">{c.title || (getBlock(c.pageId)?.properties?.title as any)?.[0]?.[0] || 'Untitled'}</span>
            </div>
          ))}
        </div>
      )}
      {(m.attachments?.length || m.skills?.length) ? (
        <div className="nc-ai-user-ctx">
          {(m.skills ?? []).map((s) => (
            <div key={s.id} className="nc-ai-context-chip static skill" role="link" onClick={() => s.id.startsWith('builtin:') ? undefined : openPage(s.id)}>
              <Icon name="aiStepSkill" size={14} />
              <span className="nc-ellipsis">{s.name}</span>
            </div>
          ))}
          {(m.attachments ?? []).map((a) => (
            <div key={a.id} className="nc-ai-context-chip static file" data-tooltip={`${a.name} · ${formatSize(a.size)}`}>
              <Icon name={a.mime.startsWith('image/') ? 'image' : a.mime === 'application/pdf' ? 'filePdf' : 'file'} size={14} />
              <span className="nc-ellipsis">{a.name}</span>
            </div>
          ))}
        </div>
      ) : null}
      {m.text.trim() && (
        <div className="nc-ai-bubble">
          <UserText text={m.text} mentions={m.mentions} />
        </div>
      )}
    </div>
  );
}

function openFeedback(anchor: HTMLElement, onSubmit: (comment: string) => void) {
  openOverlay((close) => (
    <PopoverSurface width={320}>
      <form
        className="nc-ai-feedback"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(String(new FormData(e.currentTarget).get('comment') ?? ''));
          close();
        }}
      >
        <div className="nc-ai-feedback-title">Share feedback</div>
        <textarea name="comment" autoFocus rows={3} placeholder="What could be better?" className="nc-ai-feedback-input" />
        <div className="nc-ai-feedback-actions">
          <button type="button" className="nc-btn" onClick={close}>Cancel</button>
          <button type="submit" className="nc-btn primary">Submit</button>
        </div>
      </form>
    </PopoverSurface>
  ), { anchor, placement: 'top-start', offset: 4 });
}

function UserText({ text, mentions }: { text: string; mentions: { pageId: string; title: string }[] }) {
  if (!mentions.length) return <>{text}</>;
  // highlight "@Title" mentions
  const parts: (string | { pageId: string; title: string })[] = [];
  let rest = text;
  while (rest) {
    let best: { i: number; m: { pageId: string; title: string } } | null = null;
    for (const m of mentions) {
      const i = rest.indexOf(`@${m.title}`);
      if (i >= 0 && (!best || i < best.i)) best = { i, m };
    }
    if (!best) {
      parts.push(rest);
      break;
    }
    if (best.i > 0) parts.push(rest.slice(0, best.i));
    parts.push(best.m);
    rest = rest.slice(best.i + best.m.title.length + 1);
  }
  return (
    <>
      {parts.map((p, i) => (typeof p === 'string' ? <span key={i}>{p}</span> : (
        <span key={i} className="nc-ai-mention-token static" role="link" onClick={() => openPage(p.pageId)}>
          <span className="nc-ai-mention-at">@</span>{p.title}
        </span>
      )))}
    </>
  );
}

interface AssistantProps extends Partial<TranscriptHandlers> {
  m: ChatMessage;
  streaming?: StreamingState | null;
  sources: SourceRef[];
  last: boolean;
  canInsert: boolean;
  insertLabel: string;
  readOnly?: boolean;
  onCopy: (text: string) => void;
  onInsert: (text: string, sources: SourceRef[]) => void;
}

function ActionButton({ icon, label, onClick, showLabel }: { icon: string; label: string; onClick: () => void; showLabel?: boolean }) {
  return (
    <div role="button" aria-label={label} data-tooltip={showLabel ? undefined : label} className={`nc-ai-action ${showLabel ? 'labeled' : ''}`} onClick={onClick}>
      <Icon name={icon} size={16} />
      {showLabel && <span>{label}</span>}
    </div>
  );
}

function AssistantRow({ m, streaming, sources, last, canInsert, insertLabel, readOnly, onRetry, onCopy, onInsert, onAnswer, onUndo, onFeedback }: AssistantProps) {
  const [copied, setCopied] = useState(false);
  const live = !!streaming;
  const text = live ? streaming!.text : m.text;
  const srcs = live ? streaming!.sources.length ? streaming!.sources : sources : sources;
  const steps = live ? streaming!.steps : m.steps ?? [];
  const waiting = steps.some((s) => s.status === 'waiting');
  const runningTool = steps.some((s) => s.status === 'running');
  const showStep = live && !waiting && !runningTool && (!streaming!.text.trim() || streaming!.status?.phase === 'searching' || streaming!.status?.phase === 'reading');
  const changes = live ? (streaming!.changes?.length ? { pages: streaming!.changes, undone: false } : null) : m.changes ?? null;
  const rating = m.feedback?.rating ?? null;
  return (
    <div className="nc-ai-row assistant" aria-busy={live || undefined}>
      {steps.length > 0 && <StepsList steps={steps} onAnswer={live && !readOnly ? onAnswer : undefined} />}
      {showStep && <StatusStep status={streaming!.status} />}
      {text.trim() && <AiMarkdown text={text} sources={srcs} streaming={live} />}
      {changes && <ChangesCard changes={changes} onUndo={!live && !readOnly && onUndo ? () => onUndo(m.id) : undefined} />}
      {!live && m.status === 'stopped' && <div className="nc-ai-note">Interrupted</div>}
      {!live && (m.status === 'error' || m.status === 'refused') && (
        <div className="nc-ai-error" role="alert">
          <Icon name="warning" size={14} />
          <span>{m.error?.message ?? 'Something went wrong while loading while processing that request. Please try again later.'}</span>
          {m.error?.code === 'no_key' && <span role="button" className="nc-ai-banner-link" onClick={(e) => openKeyHelp(e.currentTarget)}>How to connect</span>}
        </div>
      )}
      {!live && text.trim() && <SourcesRow sources={srcs} text={text} />}
      {!live && (
        <div className={`nc-ai-actions ${last ? 'last' : ''}`}>
          {text.trim() && (
            <ActionButton
              icon={copied ? 'check' : 'copy'}
              label={copied ? 'Copied' : 'Copy response'}
              onClick={() => {
                onCopy(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            />
          )}
          {last && onRetry && !readOnly && <ActionButton icon="refresh" label={m.status === 'error' || m.status === 'refused' ? 'Try again' : 'Retry'} onClick={onRetry} />}
          {text.trim() && onFeedback && !readOnly && !m.id.startsWith('assistant-') && (
            <>
              <div role="button" aria-label="Send positive feedback" aria-pressed={rating === 'positive'} data-tooltip="Send positive feedback" className={`nc-ai-action ${rating === 'positive' ? 'active' : ''}`} onClick={() => onFeedback(m.id, rating === 'positive' ? null : 'positive')}>
                <Icon name="thumbsUp" size={16} />
              </div>
              <div
                role="button"
                aria-label="Send negative feedback"
                aria-pressed={rating === 'negative'}
                data-tooltip="Send negative feedback"
                className={`nc-ai-action ${rating === 'negative' ? 'active' : ''}`}
                onClick={(e) => {
                  if (rating === 'negative') onFeedback(m.id, null);
                  else {
                    onFeedback(m.id, 'negative');
                    openFeedback(e.currentTarget, (comment) => { if (comment.trim()) onFeedback(m.id, 'negative', comment); });
                  }
                }}
              >
                <Icon name="thumbsDown" size={16} />
              </div>
            </>
          )}
          {text.trim() && canInsert && !readOnly && <ActionButton icon="arrowTurnUpRight" label={insertLabel} showLabel={last} onClick={() => onInsert(text, srcs)} />}
        </div>
      )}
    </div>
  );
}

export function Transcript(props: {
  messages: ChatMessage[];
  streaming: StreamingState | null;
  canInsert: boolean;
  insertLabel: string;
  readOnly?: boolean;
} & TranscriptHandlers) {
  const { messages, streaming } = props;
  // citation numbers are stable across a thread: merge all sources
  const all = new Map<number, SourceRef>();
  for (const m of messages) for (const s of m.sources ?? []) all.set(s.n, s);
  if (streaming) for (const s of streaming.sources) all.set(s.n, s);
  const sources = [...all.values()];
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  return (
    <div className="nc-ai-transcript" role="log" aria-label="Litpage AI chat">
      {messages.map((m) =>
        m.role === 'user' ? (
          <UserRow key={m.id} m={m} />
        ) : (
          <AssistantRow
            key={m.id}
            m={m}
            streaming={m.status === 'streaming' ? streaming : null}
            sources={sources}
            last={m === lastAssistant && !streaming}
            canInsert={props.canInsert}
            insertLabel={props.insertLabel}
            readOnly={props.readOnly}
            onRetry={props.onRetry}
            onCopy={props.onCopy}
            onInsert={props.onInsert}
            onAnswer={props.onAnswer}
            onUndo={props.onUndo}
            onFeedback={props.onFeedback}
          />
        ),
      )}
    </div>
  );
}

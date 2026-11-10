

// Reading errors / Fixing), Cancel · esc, the answer card with the explanation, output preview + "Show types", Undo
// and 👍 / 👎 feedback. Works for Formula properties and for the formulas of
// buttons and automations (context values are sent as ctx("Label") and mapped back to tokens). Without a key the

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { encodeToken, lex, resolvePropCalls, sourceToPlain } from '@nc/shared/formula/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { ensureAiStatus, isNoKeyError, NO_KEY_MESSAGE, useAiStatus } from '../../ai/aiApi.ts';
import { openKeyHelp } from '../../ai/NoKeyNotice.tsx';

export interface AssistantContextItem {
  key: string;
  label: string;
  type?: string;
}

interface Props {
  collectionId: string;
  
  blockId?: string;
  schema: Record<string, PropertySchema>;
  src: string;
  
  error: string | null;
  
  context?: AssistantContextItem[];
  
  targetType?: string;
  onApply(src: string): void;
  
  preview: ReactNode;
  typeLabel: string;
}

interface Answer {
  prompt: string;
  explanation: string;
  
  previous: string | null;
  applied: string | null;
}

const FIX_RE = /\b(fix|error|broken|wrong|repair)\b/i;
const EXPLAIN_RE = /\b(explain|what does|what is this|how does)\b/i;

const ASSISTANT_PREF = 'nc:formula-assistant';
export function assistantOpenPref(): boolean {
  try {
    return localStorage.getItem(ASSISTANT_PREF) !== 'off';
  } catch {
    return true;
  }
}
export function setAssistantOpenPref(on: boolean) {
  try {
    localStorage.setItem(ASSISTANT_PREF, on ? 'on' : 'off');
  } catch {
    
  }
}

function collectionOf(id: string) {
  return records.get<CollectionRecord>('collection', id);
}


export function formulaToPlain(src: string, collectionId: string, context: AssistantContextItem[] = []): string {
  const own = collectionOf(collectionId)?.schema ?? {};
  const plain = sourceToPlain(src, (pid, cid) => (cid && cid !== collectionId ? collectionOf(cid)?.schema[pid]?.name : own[pid]?.name));
  return plain.replace(/\{\{lit:context:([^}]*)\}\}/g, (m, k: string) => {
    let key = k;
    try {
      key = decodeURIComponent(k);
    } catch {
      
    }
    const item = context.find((c) => c.key === key);
    return item ? `ctx(${JSON.stringify(item.label)})` : m;
  });
}


export function plainToFormula(text: string, collectionId: string, context: AssistantContextItem[] = []): string {
  const col = collectionOf(collectionId);
  const withCtx = text.replace(/ctx\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g, (m, raw: string) => {
    let label = raw;
    try {
      label = JSON.parse(`"${raw}"`);
    } catch {
      /* keep */
    }
    const item = context.find((c) => c.label === label);
    return item ? encodeToken({ type: 'context', key: item.key }) : m;
  });
  return col ? resolvePropCalls(withCtx, col.schema, { id: col.id, spaceId: col.space_id as string | undefined }) : withCtx;
}

const normalize = (s: string) => s.replace(/\s+/g, '');

function openFeedback(anchor: HTMLElement, rating: 'positive' | 'negative', payload: { prompt: string; formula: string }) {
  openOverlay((close) => <FeedbackForm rating={rating} payload={payload} close={close} />, { anchor, placement: 'bottom-end', offset: 6 });
}

function FeedbackForm({ rating, payload, close }: { rating: 'positive' | 'negative'; payload: { prompt: string; formula: string }; close: () => void }) {
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <PopoverSurface width={320}>
      <div className="nc-fx-ai-feedback" role="dialog" aria-label="Feedback">
        <div className="nc-fx-ai-feedback-title">{rating === 'positive' ? 'What worked well here?' : 'What should we improve here?'}</div>
        <textarea autoFocus placeholder="Send feedback" value={comment} onChange={(e) => setComment(e.target.value)} rows={3} />
        <div className="nc-fx-ai-feedback-desc">Your notes help Litpage AI improve. We’ll share your prompt, formula, relevant table details, and comments.</div>
        <button
          className="nc-btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await api('aiFormulaFeedback', { rating, comment, ...payload });
              useUI.getState().toast('Thanks, your feedback is recorded.');
              close();
            } catch {
              setBusy(false);
              useUI.getState().toast('No response was generated. Try again.');
            }
          }}
        >
          Send feedback
        </button>
      </div>
    </PopoverSurface>
  );
}

export function FormulaAssistant({ collectionId, blockId, schema, src, error, context, targetType, onApply, preview, typeLabel }: Props) {
  const configured = useAiStatus((s) => s.configured);
  const enabled = useAiStatus((s) => s.policy.enabled);
  useEffect(() => ensureAiStatus(), []);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<'idle' | 'running'>('idle');
  const [label, setLabel] = useState('Thinking');
  const [failure, setFailure] = useState<string | null>(null);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [showTypes, setShowTypes] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const timers = useRef<number[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const unavailable = configured === false ? NO_KEY_MESSAGE : !enabled ? 'Litpage AI is turned off in this workspace.' : null;

  useEffect(() => () => {
    abortRef.current?.abort();
    timers.current.forEach((t) => clearTimeout(t));
  }, []);

  const autosize = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  };

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    timers.current.forEach((t) => clearTimeout(t));
    timers.current = [];
    setPhase('idle');
  };

  const submit = async () => {
    const prompt = text.trim();
    if (!prompt || phase === 'running' || unavailable) return;
    const fixing = !!error && FIX_RE.test(prompt);
    setFailure(null);
    setPhase('running');
    setLabel(fixing ? 'Reading errors' : 'Thinking');
    timers.current.push(window.setTimeout(() => setLabel(fixing ? 'Fixing' : 'Writing'), 1200));
    const ac = new AbortController();
    abortRef.current = ac;
    const plain = formulaToPlain(src, collectionId, context);
    try {
      const res = await api<{ formula: string; explanation: string }>('aiFormula', {
        collectionId: collectionId || undefined, blockId: collectionId ? undefined : blockId, prompt, formula: plain, error: error ?? undefined, targetType, context: context?.map((c) => ({ label: c.label, type: c.type })),
      }, { signal: ac.signal });
      if (ac.signal.aborted) return;
      // "What does this formula do?" keeps the formula: only a different formula replaces the current one
      const changes = !!res.formula && normalize(res.formula) !== normalize(plain) && !(EXPLAIN_RE.test(prompt) && !FIX_RE.test(prompt));
      const next = changes ? plainToFormula(res.formula, collectionId, context) : null;
      if (next !== null) onApply(next);
      setAnswer({ prompt, explanation: res.explanation || (next !== null ? '' : 'No changes needed.'), previous: next !== null ? src : null, applied: next });
      setText('');
      requestAnimationFrame(autosize);
    } catch (e) {
      if (ac.signal.aborted || (e as Error)?.name === 'AbortError') return;
      if (isNoKeyError(e)) {
        useAiStatus.getState().markUnconfigured();
        setFailure(NO_KEY_MESSAGE);
      } else setFailure((e as Error)?.message && (e as any).status !== 500 && (e as any).status !== 502 ? (e as Error).message : 'No response was generated. Try again.');
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
      timers.current.forEach((t) => clearTimeout(t));
      timers.current = [];
      setPhase('idle');
    }
  };

  // properties the current formula reads, for "Show types"
  const referenced = (() => {
    if (!showTypes) return [] as { name: string; type: string }[];
    const out = new Map<string, string>();
    for (const t of lex(src)) {
      if (t.kind !== 'input' || t.token?.type !== 'block_property') continue;
      const cid = t.token.collection?.id;
      const p = cid && cid !== collectionId ? collectionOf(cid)?.schema[t.token.property] : schema[t.token.property];
      if (p) out.set(p.name, p.type.replace(/_/g, ' '));
    }
    return [...out].map(([name, type]) => ({ name, type }));
  })();

  return (
    <div className="nc-fx-ai" data-menu-keys="ignore">
      {(unavailable || failure) && (
        <div className={`nc-fx-ai-banner ${failure && !unavailable ? 'error' : ''}`} role="status">
          <Icon name={unavailable ? 'info' : 'warning'} size={14} />
          <span>{unavailable ?? failure}</span>
          {unavailable === NO_KEY_MESSAGE && <span role="button" className="nc-fx-ai-link" onClick={(e) => openKeyHelp(e.currentTarget)}>Learn how</span>}
        </div>
      )}
      <div className={`nc-fx-ai-input ${phase === 'running' ? 'running' : ''} ${unavailable ? 'disabled' : ''}`}>
        <span className="nc-fx-ai-face" aria-hidden><Icon name="aiFace" size={14} /></span>
        {phase === 'running' ? (
          <div className="nc-fx-ai-progress" role="status" aria-live="polite">
            <span className="nc-fx-ai-shimmer">{label}</span>
            <span style={{ flex: 1 }} />
            <span role="button" className="nc-fx-ai-cancel" onClick={stop}>Cancel</span>
            <span className="nc-fx-ai-esc">esc</span>
          </div>
        ) : (
          <textarea
            ref={inputRef}
            className="nc-fx-ai-text"
            rows={1}
            value={text}
            disabled={!!unavailable}
            placeholder="Describe a formula, or ask about this one…"
            aria-label="Describe a formula, or ask about this one…"
            onChange={(e) => {
              setText(e.target.value);
              autosize();
            }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing) return;
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              } else if (e.key === 'Escape' && text) {
                e.preventDefault();
                setText('');
              }
            }}
          />
        )}
        {phase !== 'running' && (
          <div role="button" aria-label="Ask Litpage AI" aria-disabled={!text.trim() || !!unavailable} className={`nc-fx-ai-send ${text.trim() && !unavailable ? 'ready' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => void submit()}>
            <Icon name="arrowUp" size={14} strokeWidth={2.4} />
          </div>
        )}
      </div>
      {phase === 'running' && <EscToCancel onEsc={stop} />}
      {answer && phase !== 'running' && (
        <div className="nc-fx-ai-answer" role="region" aria-label="Formula assistant answer">
          {answer.explanation && <div className="nc-fx-ai-explanation">{answer.explanation}</div>}
          <div className="nc-fx-ai-output">
            <span className="nc-fx-ai-output-label">Output</span>
            <span className="nc-fx-ai-output-value">{preview}</span>
            {showTypes && <span className="nc-fx-ai-type">{typeLabel}</span>}
          </div>
          {showTypes && referenced.length > 0 && (
            <div className="nc-fx-ai-types">
              {referenced.map((r) => <span key={r.name} className="nc-fx-ai-type-chip">{r.name}: {r.type}</span>)}
            </div>
          )}
          <div className="nc-fx-ai-actions">
            <label className="nc-fx-ai-showtypes">
              <span className={`nc-adv-toggle ${showTypes ? 'on' : ''}`}><span /></span>
              <input type="checkbox" role="switch" aria-label="Show types" checked={showTypes} onChange={(e) => setShowTypes(e.target.checked)} />
              <span>Show types</span>
            </label>
            <span style={{ flex: 1 }} />
            {answer.previous !== null && (
              <span role="button" className="nc-fx-ai-btn" onClick={() => { onApply(answer.previous!); setAnswer(null); }}>
                <Icon name="undo" size={14} />Undo
              </span>
            )}
            <span role="button" aria-label="Good response" className="nc-fx-ai-icon-btn" onClick={(e) => openFeedback(e.currentTarget, 'positive', { prompt: answer.prompt, formula: formulaToPlain(src, collectionId, context) })}><Icon name="thumbsUp" size={14} /></span>
            <span role="button" aria-label="Bad response" className="nc-fx-ai-icon-btn" onClick={(e) => openFeedback(e.currentTarget, 'negative', { prompt: answer.prompt, formula: formulaToPlain(src, collectionId, context) })}><Icon name="thumbsDown" size={14} /></span>
          </div>
        </div>
      )}
    </div>
  );
}

// While the assistant works, Esc cancels it instead of closing the editor ("Press ESC to go back").
// Overlays close on Escape from a window listener in the capture phase. This listener is registered when the module loads,
// before any overlay, so it runs first and keeps the assistant open.
let cancelRunning: (() => void) | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !cancelRunning) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    cancelRunning();
  }, true);
}

function EscToCancel({ onEsc }: { onEsc: () => void }) {
  useEffect(() => {
    cancelRunning = onEsc;
    return () => {
      if (cancelRunning === onEsc) cancelRunning = null;
    };
  }, [onEsc]);
  return null;
}

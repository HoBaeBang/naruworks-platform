
// block menu ("Ask AI" / "Skills") or the selection toolbar. Streams a preview, then Accept /
// Insert below / Try again / Discard. Edits are applied as transactions (one undo step).
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { slice, type RichText } from '@nc/shared/richtext.ts';
import { getBlock } from '../../lib/blocks.ts';
import { Icon } from '../../components/Icon.tsx';
import { useEditor } from '../editor/editorState.ts';
import { positionAt } from '../editor/richTextDom.ts';
import { AiMarkdown } from './AiMarkdown.tsx';
import { FaceGlyph } from './AiFace.tsx';
import { NO_KEY_MESSAGE, streamAi, useAiStatus } from './aiApi.ts';
import { useSkills } from './aiStores.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { insertMarkdownAfter, replaceBlocks, replaceBlockWithMarkdown, replaceSelection, richTextToMarkdown } from './insert.ts';
import { useAiLayer, type WriterTarget } from './layerStore.ts';
import { NoKeyNotice } from './NoKeyNotice.tsx';
import { LANGUAGES, SKILL, TONES, writerSections, type SkillId } from './skills.ts';

const EDIT_SKILLS = new Set<SkillId>(['improve', 'proofread', 'shorter', 'longer', 'tone', 'simplify', 'reformat', 'translate', 'custom']);

interface WriterRequest {
  skill: SkillId;
  prompt?: string;
  language?: string;
  tone?: string;
  
  refine?: boolean;
  
  skillId?: string;
}

type Item =
  | { kind: 'skill'; id: SkillId; label: string; icon: string; arrow?: boolean; hint?: string }
  | { kind: 'userSkill'; id: string; label: string; icon: string }
  | { kind: 'ref'; id: string; label: string; icon: string }
  | { kind: 'action'; id: 'accept' | 'below' | 'retry' | 'discard' | 'stop'; label: string; icon: string; hint?: string }
  | { kind: 'option'; value: string; label: string; icon: string }
  | { kind: 'back'; label: string; icon: string };

function blockEl(id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.lit-page-content [data-block-id="${id}"]`) ?? document.querySelector<HTMLElement>(`[data-block-id="${id}"]`);
}

function anchorId(t: WriterTarget): string {
  return t.mode === 'blocks' && t.blockIds?.length ? t.blockIds[t.blockIds.length - 1] : t.blockId;
}


function textBefore(t: WriterTarget): string {
  const b = getBlock(t.blockId);
  const parent = b ? getBlock(b.parent_id) : undefined;
  const sibs = parent?.content ?? [];
  const i = sibs.indexOf(t.blockId);
  const lines: string[] = [];
  for (const id of sibs.slice(Math.max(0, i - 8), Math.max(0, i))) {
    const s = getBlock(id);
    if (!s || !s.alive) continue;
    const md = richTextToMarkdown(s.properties?.title as RichText | undefined);
    if (md.trim()) lines.push(md);
  }
  return lines.join('\n\n').slice(-3000);
}

function useAnchorRect(t: WriterTarget) {
  const [rect, setRect] = useState<{ left: number; top: number; width: number; blockTop: number; blockBottom: number } | null>(null);
  useLayoutEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      const el = blockEl(anchorId(t));
      const first = blockEl(t.mode === 'blocks' && t.blockIds?.length ? t.blockIds[0] : t.blockId);
      if (el && first) {
        const r = el.getBoundingClientRect();
        const f = first.getBoundingClientRect();
        const width = Math.min(Math.max(r.width, 420), window.innerWidth - 24);
        const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
        const next = { left, top: t.mode === 'empty' ? r.top : r.bottom + 4, width, blockTop: f.top, blockBottom: r.bottom };
        const key = JSON.stringify(next);
        if (key !== last) {
          last = key;
          setRect(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [t]);
  return rect;
}

function SelectionHighlight({ t }: { t: WriterTarget }) {
  const [rects, setRects] = useState<DOMRect[]>([]);
  useLayoutEffect(() => {
    let raf = 0;
    let last = '';
    const tick = () => {
      let out: DOMRect[] = [];
      if (t.mode === 'selection' && t.start !== undefined && t.end !== undefined && t.end > t.start) {
        const leaf = blockEl(t.blockId)?.querySelector<HTMLElement>('[data-content-editable-leaf]');
        if (leaf) {
          try {
            const s = positionAt(leaf, t.start);
            const e = positionAt(leaf, t.end);
            const r = document.createRange();
            r.setStart(s.node, s.offset);
            r.setEnd(e.node, e.offset);
            out = [...r.getClientRects()];
          } catch {
            out = [];
          }
        }
      } else if (t.mode === 'blocks') {
        out = (t.blockIds ?? []).map((id) => blockEl(id)?.getBoundingClientRect()).filter((x): x is DOMRect => !!x);
      }
      const key = out.map((r) => `${r.left},${r.top},${r.width},${r.height}`).join('|');
      if (key !== last) {
        last = key;
        setRects(out);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [t]);
  return (
    <>
      {rects.map((r, i) => (
        <div key={i} className="nc-ai-writer-highlight" style={{ left: r.left, top: r.top, width: r.width, height: r.height }} />
      ))}
    </>
  );
}

export function InlineWriter({ target }: { target: WriterTarget }) {
  const configured = useAiStatus((s) => s.configured);
  const hasSelection = target.mode === 'selection' || target.mode === 'blocks';
  const [phase, setPhase] = useState<'input' | 'running' | 'done' | 'error'>('input');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<SkillId | null>(null); // skill waiting for a topic
  const [sub, setSub] = useState<'tone' | 'language' | null>(null);
  const [active, setActive] = useState(0);
  const [result, setResult] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [lastReq, setLastReq] = useState<WriterRequest | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  
  const [refs, setRefs] = useState<{ id: string; title: string }[]>([]);
  const [refHits, setRefHits] = useState<{ id: string; title: string }[]>([]);
  const enabledSkills = useSkills((st) => st.enabled);
  const userSkills = useMemo(() => enabledSkills.filter((k) => !k.builtin && k.inPage), [enabledSkills]);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const rect = useAnchorRect(target);
  const close = () => {
    abortRef.current?.abort();
    useAiLayer.getState().closeWriter();
  };

  const run = (req: WriterRequest) => {
    setSub(null);
    setPending(null);
    setQuery('');
    setActive(0);
    setLastReq(req);
    if (configured === false) {
      setError({ code: 'no_key', message: NO_KEY_MESSAGE });
      setPhase('error');
      return;
    }
    if (useUI.getState().connection === 'offline') {
      setError({ code: 'offline', message: 'Litpage AI isn’t available offline. Reconnect and try again.' });
      setPhase('error');
      return;
    }
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const previous = req.refine ? result : '';
    setResult('');
    setError(null);
    setPhase('running');
    let acc = '';
    let raf = 0;
    const body: Record<string, unknown> = {
      kind: 'writer',
      pageId: target.pageId,
      skill: req.skill,
      prompt: req.prompt,
      language: req.language,
      tone: req.tone,
      selection: req.refine ? previous : target.selectionMd,
      before: !hasSelection ? textBefore(target) : undefined,
      skillId: req.skillId,
      mentions: refs.map((r) => r.id),
    };
    streamAi(body, {
      onDelta: (d) => {
        acc += d;
        if (!raf) raf = requestAnimationFrame(() => { raf = 0; setResult(acc); });
      },
    }, ac.signal)
      .then((done) => {
        if (ac.signal.aborted && abortRef.current !== ac) return;
        if (raf) cancelAnimationFrame(raf);
        if (done.status === 'error' || done.status === 'refused') {
          setError(done.error ?? { code: 'error', message: 'Something went wrong while loading while processing that request. Please try again later.' });
          setResult(acc);
          setPhase('error');
          return;
        }
        const text = (done.text || acc).trim();
        setResult(text);
        setPhase(text ? 'done' : 'input');
      })
      .catch((e) => {
        setError({ code: e?.code ?? 'error', message: e?.message ?? 'Something went wrong while loading while processing that request. Please try again later.' });
        setPhase('error');
      })
      .finally(() => {
        if (abortRef.current === ac) abortRef.current = null;
        requestAnimationFrame(() => inputRef.current?.focus());
      });
  };

  const accept = (where: 'auto' | 'below') => {
    const md = result.trim();
    if (!md || !lastReq) return;
    const t = target;
    const editLike = EDIT_SKILLS.has(lastReq.skill) && hasSelection;
    let ids: string[] = [];
    if (where === 'below') ids = insertMarkdownAfter(anchorId(t), md);
    else if (t.mode === 'empty') ids = replaceBlockWithMarkdown(t.blockId, md);
    else if (t.mode === 'below') ids = insertMarkdownAfter(t.blockId, md);
    else if (t.mode === 'selection') ids = editLike ? replaceSelection(t.blockId, t.start ?? 0, t.end ?? 0, md, t.property ?? 'title') : insertMarkdownAfter(t.blockId, md);
    else ids = editLike ? replaceBlocks(t.blockIds ?? [t.blockId], md) : insertMarkdownAfter(anchorId(t), md);
    close();
    const last = ids[ids.length - 1];
    if (last) requestAnimationFrame(() => useEditor.getState().requestFocus(last, 'end'));
  };

  const discard = () => {
    if (phase === 'running') {
      abortRef.current?.abort();
      return;
    }
    if (result.trim() && !confirmDiscard) {
      setConfirmDiscard(true);
      return;
    }
    closeAndRefocus();
  };

  
  const closeAndRefocus = () => {
    close();
    if (target.mode === 'empty') requestAnimationFrame(() => useEditor.getState().requestFocus(target.blockId, 0));
  };

  // auto-run: a skill from the block menu / selection toolbar, a button block prompt, page Translate
  useEffect(() => {
    void useSkills.getState().load();
    const s = target.skill;
    if (target.skillId) {
      run({ skill: 'custom', skillId: target.skillId, prompt: target.prompt });
      return;
    }
    if (target.prompt?.trim() && !s) {
      run({ skill: 'custom', prompt: target.prompt.trim() });
      return;
    }
    if (!s) return;
    if (s === 'translate' && target.language) run({ skill: 'translate', language: target.language });
    else if (s === 'tone' && target.prompt) run({ skill: 'tone', tone: target.prompt });
    else if (SKILL[s].submenu) setSub(SKILL[s].submenu!);
    else if (SKILL[s].topic && !target.prompt) setPending(s);
    else run({ skill: s, prompt: target.prompt });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.seq]);

  // focus once the bar is positioned (the first render waits for the anchor rect)
  const positioned = !!rect;
  useEffect(() => {
    if (positioned) inputRef.current?.focus();
  }, [target.seq, positioned]);

  // click outside: discard (asks first when there is a result)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const el = rootRef.current;
      if (!el || el.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest?.('.lit-overlay-container, .nc-tooltip')) return;
      if (result.trim() || phase === 'running') {
        setConfirmDiscard(true);
        e.preventDefault();
        return;
      }
      close();
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  });

  const items: { title?: string; items: Item[] }[] = useMemo(() => {
    if (phase === 'running') return [{ items: [{ kind: 'action', id: 'stop', label: 'Stop', icon: 'stop', hint: 'Esc' }] }];
    if (phase === 'done') {
      const out: { title?: string; items: Item[] }[] = [{
        items: [
          { kind: 'action', id: 'accept', label: 'Accept', icon: 'check', hint: '↵' },
          ...(hasSelection || target.mode === 'below' ? [{ kind: 'action', id: 'below', label: 'Insert below', icon: 'arrowTurnUpRight' } as Item] : []),
          { kind: 'action', id: 'retry', label: 'Try again', icon: 'refresh' },
          { kind: 'action', id: 'discard', label: 'Discard', icon: 'trash', hint: 'Esc' },
        ],
      }];
      const refine: Item[] = (['longer', 'shorter', 'simplify'] as SkillId[]).map((id) => ({ kind: 'skill', id, label: SKILL[id].label, icon: SKILL[id].icon }));
      out.push({ title: 'Edit', items: refine.filter((i) => !query || i.label.toLowerCase().includes(query.toLowerCase())) });
      return out.filter((s) => s.items.length);
    }
    if (phase === 'error') return [{ items: [{ kind: 'action', id: 'retry', label: 'Try again', icon: 'refresh' }, { kind: 'action', id: 'discard', label: 'Discard', icon: 'trash', hint: 'Esc' }] }];
    if (pending) return [];
    if (sub) {
      const list = sub === 'tone' ? TONES : LANGUAGES;
      const q = query.trim().toLowerCase();
      return [{
        title: sub === 'tone' ? 'Change tone' : 'Translate',
        items: [
          { kind: 'back', label: 'Back', icon: 'arrowLeft' } as Item,
          ...list.filter((v) => !q || v.toLowerCase().includes(q)).map((v): Item => ({ kind: 'option', value: v, label: v, icon: sub === 'tone' ? 'sliders' : 'translate' })),
        ],
      }];
    }
    const at = /(?:^|\s)@([^@]{0,40})$/.exec(query);
    if (at) {
      return [{ title: 'Reference a page', items: refHits.map((h): Item => ({ kind: 'ref', id: h.id, label: h.title || 'Untitled', icon: 'page' })) }];
    }
    const q = query.trim().toLowerCase();
    const mine: Item[] = userSkills.filter((k) => !q || k.name.toLowerCase().includes(q)).map((k) => ({ kind: 'userSkill', id: k.id, label: k.name, icon: 'aiStepSkill' }));
    return [
      ...(mine.length ? [{ title: 'Your skills', items: mine }] : []),
      ...writerSections(hasSelection)
        .map((s) => ({
          title: s.title,
          items: s.items
            .map((id) => SKILL[id])
            .filter((sk) => !q || sk.label.toLowerCase().includes(q) || sk.keywords?.some((k) => k.includes(q)))
            .map((sk): Item => ({ kind: 'skill', id: sk.id, label: sk.label, icon: sk.icon, arrow: !!sk.submenu })),
        })),
    ].filter((s) => s.items.length);
  }, [phase, pending, sub, query, hasSelection, target.mode, userSkills.length, refHits]);

  // "@" in the writer: search pages to use as reference
  useEffect(() => {
    const at = /(?:^|\s)@([^@]{0,40})$/.exec(query);
    if (!at) {
      if (refHits.length) setRefHits([]);
      return;
    }
    let alive = true;
    const spaceId = useSession.getState().spaceId;
    const t = setTimeout(async () => {
      try {
        const res = at[1].trim() ? await api('searchWorkspace', { query: at[1].trim(), spaceId, limit: 8 }) : await api('listRecentPages', { spaceId, limit: 8 });
        records.mergeRecordMap(res.recordMap);
        const ids: string[] = at[1].trim() ? res.results.map((r: any) => r.id) : res.pages.map((r: any) => r.id);
        if (alive) setRefHits(ids.map((id) => ({ id, title: (getBlock(id)?.properties?.title as any)?.map((d: any) => d[0]).join('') ?? '' })).filter((h) => h.id !== target.pageId).slice(0, 6));
      } catch {
        if (alive) setRefHits([]);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const flat = items.flatMap((s) => s.items);
  useEffect(() => {
    // with free text typed, nothing is preselected so Enter submits the prompt
    setActive(query.trim() && phase === 'input' && !sub ? -1 : 0);
  }, [query, phase, sub, items.length]);

  const choose = (it: Item) => {
    if (it.kind === 'back') {
      setSub(null);
      setQuery('');
      return;
    }
    if (it.kind === 'option') {
      run(sub === 'tone' ? { skill: 'tone', tone: it.value } : { skill: 'translate', language: it.value, refine: phase === 'done' });
      return;
    }
    if (it.kind === 'ref') {
      setRefs((cur) => (cur.some((r) => r.id === it.id) ? cur : [...cur, { id: it.id, title: it.label }]));
      setQuery((q) => q.replace(/(?:^|\s)@[^@]{0,40}$/, '').trimEnd());
      inputRef.current?.focus();
      return;
    }
    if (it.kind === 'userSkill') {
      run({ skill: 'custom', skillId: it.id, prompt: query.trim() || undefined });
      return;
    }
    if (it.kind === 'action') {
      if (it.id === 'accept') accept('auto');
      else if (it.id === 'below') accept('below');
      else if (it.id === 'retry') { if (lastReq) run(lastReq); }
      else if (it.id === 'discard') discard();
      else if (it.id === 'stop') abortRef.current?.abort();
      return;
    }
    const sk = SKILL[it.id];
    if (phase === 'done') {
      run({ skill: it.id, refine: true });
      return;
    }
    if (sk.submenu) {
      setSub(sk.submenu);
      setQuery('');
      return;
    }
    if (sk.topic) {
      // typed text was a menu filter; the topic is asked next ("Make a table about…")
      setPending(it.id);
      setQuery('');
      inputRef.current?.focus();
      return;
    }
    run({ skill: it.id });
  };

  const submit = () => {
    const text = query.trim();
    if (pending) {
      run({ skill: pending, prompt: text });
      return;
    }
    if (active >= 0 && flat[active]) {
      choose(flat[active]);
      return;
    }
    if (!text) return;
    if (phase === 'done') run({ skill: 'custom', prompt: text, refine: true });
    else run({ skill: 'custom', prompt: text });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (phase === 'running') {
      // only Esc (stop) while the answer streams
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        discard();
      } else if (e.key === 'Enter' || e.key === 'Tab') e.preventDefault();
      return;
    }
    if (confirmDiscard) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmDiscard(false);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (flat.length ? (a + 1) % flat.length : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (flat.length ? (a <= 0 ? flat.length - 1 : a - 1) : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (phase === 'done' && !query.trim() && active <= 0) accept('auto');
      else submit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (pending || sub) {
        setPending(null);
        setSub(null);
        setQuery('');
      } else discard();
    } else if (e.key === 'Backspace' && !query && (pending || sub)) {
      setPending(null);
      setSub(null);
    }
  };

  if (!rect) return null;
  const placeholder = pending
    ? SKILL[pending].topic ?? 'Tell AI what to write…'
    : phase === 'done' || phase === 'error'
      ? 'Tell AI what to do next…'
      : hasSelection ? 'Polish with AI' : 'Ask AI a question…';
  const showPreview = (phase === 'running' || phase === 'done' || (phase === 'error' && result)) && !!result.trim();
  const menuBelow = rect.top + 360 < window.innerHeight;
  let idx = -1;
  const menu = items.length > 0 && !(configured === false && phase === 'input') && (
    <div className="nc-ai-writer-menu" role="listbox">
      {items.map((s, si) => (
        <div key={si} className="nc-menu-section">
          {s.title && <div className="nc-menu-section-title">{s.title}</div>}
          {s.items.map((it) => {
            idx++;
            const my = idx;
            return (
              <div
                key={`${it.kind}:${'id' in it ? it.id : it.label}`}
                data-kind={it.kind}
                role="option"
                aria-selected={my === active}
                className={`nc-menu-item ${my === active ? 'active' : ''}`}
                onMouseMove={() => setActive(my)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(it)}
              >
                <div className="nc-menu-item-inner">
                  <div className="nc-menu-icon" style={{ color: it.kind === 'action' && it.id === 'accept' ? 'var(--lp-blue-icon-accent)' : 'var(--lp-icon-primary)' }}>
                    <Icon name={it.icon} size={18} />
                  </div>
                  <div className="nc-menu-label"><div className="nc-ellipsis">{it.label}</div></div>
                  {'hint' in it && it.hint && <span className="nc-menu-shortcut">{it.hint}</span>}
                  {it.kind === 'skill' && it.arrow && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  return (
    <>
      <SelectionHighlight t={target} />
      <div
        ref={rootRef}
        className={`nc-ai-writer ${target.mode}`}
        style={{ left: rect.left, top: rect.top, width: rect.width }}
        data-testid="ai-inline-writer"
      >
        {showPreview && (
          <div className="nc-ai-writer-preview lit-scroller vertical">
            <AiMarkdown text={result} streaming={phase === 'running'} />
          </div>
        )}
        <div className={`nc-ai-writer-bar ${phase}`}>
          <div className="nc-ai-writer-face"><FaceGlyph size={20} /></div>
          {pending && <span className="nc-ai-writer-chip">{SKILL[pending].label}</span>}
          {refs.map((r) => (
            <span key={r.id} className="nc-ai-writer-chip ref" data-testid="ai-writer-ref">
              @{r.title || 'Untitled'}
              <span role="button" aria-label="Remove reference" className="nc-ai-context-chip-x" onMouseDown={(e) => e.preventDefault()} onClick={() => setRefs((cur) => cur.filter((x) => x.id !== r.id))}><Icon name="close" size={10} /></span>
            </span>
          ))}
          {sub && <span className="nc-ai-writer-chip">{sub === 'tone' ? 'Change tone' : 'Translate'}</span>}
          {phase === 'running' && (
            <div className="nc-ai-writer-running">
              <span className="nc-ai-shimmer">Litpage AI is writing</span>
              <span className="nc-ai-dots"><i /><i /><i /></span>
            </div>
          )}
          {}
          <input
            ref={inputRef}
            className={`nc-ai-writer-input${phase === 'running' ? ' busy' : ''}`}
            value={query}
            readOnly={phase === 'running'}
            placeholder={placeholder}
            aria-label={phase === 'running' ? 'Litpage AI is writing' : placeholder}
            onChange={(e) => {
              setQuery(e.target.value);
              setConfirmDiscard(false);
            }}
            onKeyDown={onKeyDown}
          />
          {phase === 'running' ? (
            <div role="button" aria-label="Stop" data-tooltip="Stop" className="nc-ai-send stop" onMouseDown={(e) => e.preventDefault()} onClick={() => abortRef.current?.abort()}>
              <span className="nc-ai-stop-square" />
            </div>
          ) : (
            <div
              role="button"
              aria-label="Submit"
              className={`nc-ai-send ${query.trim() || pending ? 'ready' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={submit}
            >
              <Icon name="arrowUp" size={16} strokeWidth={2.2} />
            </div>
          )}
        </div>
        {phase === 'error' && error && (
          error.code === 'no_key' ? <div className="nc-ai-writer-note"><NoKeyNotice compact /></div> : (
            <div className="nc-ai-writer-note error" role="alert"><Icon name="warning" size={14} /><span>{error.message}</span></div>
          )
        )}
        {configured === false && phase === 'input' && <div className="nc-ai-writer-note"><NoKeyNotice compact /></div>}
        {confirmDiscard ? (
          <div className="nc-ai-writer-confirm" role="alertdialog">
            <span>Discard this AI response?</span>
            <div className="nc-ai-writer-confirm-actions">
              <button className="nc-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => { setConfirmDiscard(false); inputRef.current?.focus(); }}>Cancel</button>
              <button className="nc-btn danger" onMouseDown={(e) => e.preventDefault()} onClick={closeAndRefocus}>Discard</button>
            </div>
          </div>
        ) : (
          menuBelow ? menu : <div className="nc-ai-writer-menu-up">{menu}</div>
        )}
      </div>
    </>
  );
}

export function selectionMarkdown(blockId: string, start: number, end: number, property = 'title'): string {
  const b = getBlock(blockId);
  return richTextToMarkdown(slice((b?.properties?.[property] as RichText | undefined) ?? [], start, end));
}

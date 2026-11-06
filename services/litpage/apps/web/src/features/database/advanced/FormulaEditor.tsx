import { HELP_URL } from '@nc/shared/brand.ts';

// highlighting + property chips, "Preview with ‹page›" live result + "Type: …" badge + Debug mode, and the
// suggestion list (Properties / Built-ins / categories) with a definition panel (description + copyable examples).
// Closing (X, Esc, click outside) saves the formula source and result type.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import {
  BUILTIN_DOCS, FUNCTION_DOCS, encodeToken, evaluateFormula, formulaResultType, formulaSourceOf, parse, resolvePropCalls, sourceToCode, toResultType,
  typeLabel, schemaLimitProblem, schemaSize, SCHEMA_SIZE_LIMIT, type FValue, type FormulaToken, type Node,
} from '@nc/shared/formula/index.ts';
import { openOverlay, type Anchor } from '../../../components/overlay.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { run } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { useCollection, useTableVersion } from '../../../lib/hooks.ts';
import { formulaContext, rowsOfCollection, titleOf } from './context.ts';
import { getCaret, highlightSegments, readFormula, renderFormula, setCaret, type ChipInfo } from './formulaDom.ts';
import { applyItem, buildItems, caretContext, propertyIconFor, type CompletionItem } from './formulaComplete.ts';
import { FormulaValueView } from './FormulaValueView.tsx';
import { assistantOpenPref, FormulaAssistant, setAssistantOpenPref } from './FormulaAssistant.tsx';
import './advanced.css';

const PROPERTY_DESCRIPTIONS: Record<string, string> = {
  auto_increment_id: 'ID property.', checkbox: 'Checkbox property.', created_by: 'Creator field.', created_time: 'Creation time field.',
  date: 'Date property.', email: 'Email property.', file: 'File field, list.', formula: 'Formula property.', last_edited_by: 'Last changed by property.',
  last_edited_time: 'Last edited property.', multi_select: 'Multiple-choice field, list.', number: 'Number property.', phone_number: 'Phone field.',
  person: 'People field, list.', relation: 'Linked records field, list.', rollup: 'Summary field, list.', select: 'Select property.', status: 'Status property.',
  text: 'Text property.', title: 'Title property.', url: 'URL property.', place: 'Database property.',
};

const iconCache = new Map<string, string>();
function iconHtml(name: string): string {
  let h = iconCache.get(name);
  if (h === undefined) {
    h = renderToStaticMarkup(<Icon name={name} size={14} />);
    iconCache.set(name, h);
  }
  return h;
}


function chipFor(tok: FormulaToken, schema: Record<string, PropertySchema>, custom?: CustomFormula): ChipInfo {
  if (tok.type === 'context') {
    const item = custom?.contextItems.find((c) => c.key === tok.key);
    return { label: item?.label ?? custom?.contextLabel?.(tok.key) ?? 'Unknown value', icon: item?.icon ?? 'formula' };
  }
  if (tok.type === 'block_property') {
    const own = schema[tok.property];
    const other = tok.collection ? records.get<CollectionRecord>('collection', tok.collection.id)?.schema?.[tok.property] : undefined;
    const p = other ?? own;
    if (!p) return { label: tok.property === 'title' ? 'Name' : 'Unknown property', icon: 'textProp' };
    return { label: p.name, icon: propertyIconFor(p.type) };
  }
  if (tok.type === 'block') return { label: titleOf(records.get<BlockRecord>('block', tok.blockId)) || 'Untitled', icon: 'page' };
  if (tok.type === 'person') return { label: records.get('lit_user', tok.userId)?.name ?? 'Unknown', icon: 'person' };
  if (tok.type === 'checkbox') return { label: tok.checked ? 'Checked' : 'Unchecked', icon: 'checkboxChecked' };
  return { label: tok.date.start_date, icon: 'date' };
}


function ExampleCode({ code }: { code: string }) {
  const segs = highlightSegments(code);
  const out: ReactNode[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    // prop value -> chip
    if (s.text === 'prop' && segs[i + 1]?.text === '(' && segs[i + 2]?.cls === 'string' && segs[i + 3]?.text === ')') {
      const prevSig = segs.slice(0, i).reverse().find((x) => x.text.trim());
      if (prevSig?.text === '.') out.pop();
      if (prevSig?.text === '.') out.push(<span key={`d${i}`} className="token punctuation">.</span>);
      out.push(<span key={i} className="nc-fx-chip static"><Icon name="textProp" size={12} />{segs[i + 2].text.slice(1, -1)}</span>);
      i += 3;
      continue;
    }
    out.push(s.cls ? <span key={i} className={s.cls === 'chip' ? 'nc-fx-chip static' : `token ${s.cls}`}>{s.text}</span> : <span key={i}>{s.text}</span>);
  }
  return <>{out}</>;
}

function formatExampleOutput(v: FValue): ReactNode {
  switch (v.type) {
    case 'undefined': return <i>empty</i>;
    case 'text': return `"${v.value.map((d) => d[0]).join('')}"`;
    case 'number': return String(v.value);
    case 'checkbox': return String(v.value);
    case 'array': return <>[{v.values.map((x, i) => <span key={i}>{i ? ', ' : ''}{formatExampleOutput(x)}</span>)}]</>;
    default: return <FormulaValueView value={v} />;
  }
}

function ExampleCard({ input, output }: { input: string; output: string | null }) {
  const live = useMemo(() => {
    if (output !== null || /prop\(/.test(input)) return null;
    const r = evaluateFormula(input, null, {}, formulaContext());
    return r.error ? null : r.value;
  }, [input, output]);
  const copy = () => {
    void navigator.clipboard?.writeText(input).catch(() => undefined);
  };
  return (
    <div className="nc-fx-example">
      <div className="nc-fx-example-body">
        <div><ExampleCode code={input} /></div>
        {(output !== null || live) && <div className="nc-fx-example-out">= {output !== null ? output : formatExampleOutput(live!)}</div>}
      </div>
      <div role="button" className="nc-fx-copy" aria-label="Copy formula" data-tooltip="Copy formula" onClick={copy}>
        <Icon name="copy" size={14} />
      </div>
    </div>
  );
}

function propertyExamples(p: PropertySchema): string[] {
  const t = `prop("${p.name.replace(/"/g, '\\"')}")`;
  switch (p.type) {
    case 'checkbox': return [t, `not ${t}`, 'prop("Signed") and prop("Sealed") and prop("Delivered")'];
    case 'number': return [t, `${t} * 2`, `round(${t} / 3, 2)`];
    case 'date': case 'created_time': case 'last_edited_time': return [t, `formatDate(${t}, "MMMM D, YYYY")`, `dateBetween(${t}, now(), "days")`];
    case 'select': case 'status': return [t, `${t} == "Done"`];
    case 'multi_select': return [t, `${t}.length()`, `${t}.includes("Finance")`];
    case 'person': return [t, `${t}.map(current.name())`];
    case 'created_by': case 'last_edited_by': return [t, `${t}.name()`];
    case 'relation': return [t, `${t}.length()`, `${t}.map(current.prop("Name"))`];
    case 'title': case 'text': case 'url': case 'email': case 'phone_number': return [t, `${t}.length()`, `upper(${t})`];
    default: return [t];
  }
}

function DocPanel({ item }: { item: CompletionItem | null }) {
  if (!item) return <div className="nc-fx-doc" />;
  let title: ReactNode = item.label;
  let description = '';
  let examples: { input: string; output: string | null }[] = [];
  if (item.kind === 'property' && item.prop) {
    description = PROPERTY_DESCRIPTIONS[item.prop.type] ?? 'Database property.';
    examples = propertyExamples(item.prop).map((input) => ({ input, output: null }));
  } else if (item.kind === 'function') {
    const d = FUNCTION_DOCS[item.label];
    description = d?.description ?? '';
    examples = d?.examples ?? [];
  } else if (item.kind === 'builtin') {
    const d = BUILTIN_DOCS.find((b) => b.symbol === item.label);
    description = d?.description ?? '';
    examples = d?.examples ?? [];
  } else if (item.kind === 'context') {
    description = item.description ?? '';
  } else if (item.kind === 'variable') {
    description = item.label === 'current' ? 'Value of the current item in the list.' : item.label === 'index' ? 'Position of the current item in the list, starting at 0.' : 'Variable defined by the user.';
  }
  if (item.kind === 'function') title = <>{item.label}<span className="nc-fx-paren">()</span></>;
  return (
    <div className="nc-fx-doc">
      <span className="nc-fx-doc-title"><Icon name={item.icon} size={16} color="var(--lp-icon-secondary)" />{title}</span>
      <span className="nc-fx-doc-desc">{description.split('\n\n').map((p, i) => <span key={i} style={{ display: 'block', marginTop: i ? 8 : 0 }}>{p}</span>)}</span>
      <div className="nc-fx-examples">
        {examples.slice(0, 6).map((e, i) => <ExampleCard key={`${item.key}-${i}`} input={e.input} output={e.output} />)}
      </div>
    </div>
  );
}

function debugNodes(ast: Node | null): Node[] {
  const out: Node[] = [];
  const walk = (n: Node, depth: number) => {
    if (out.length >= 10 || depth > 6) return;
    if (n.kind === 'call' || n.kind === 'binary' || n.kind === 'conditional' || n.kind === 'token' || n.kind === 'member' || n.kind === 'and' || n.kind === 'or') out.push(n);
    switch (n.kind) {
      case 'binary': walk(n.lhs, depth + 1); walk(n.rhs, depth + 1); break;
      case 'call': n.args.forEach((a) => walk(a, depth + 1)); if (n.callee.kind === 'method') walk(n.callee.target, depth + 1); break;
      case 'conditional': walk(n.condition, depth + 1); walk(n.ifTrue, depth + 1); walk(n.ifFalse, depth + 1); break;
      case 'and': case 'or': n.elements.forEach((e) => walk(e, depth + 1)); break;
      case 'unary': walk(n.expression, depth + 1); break;
      case 'array': n.elements.forEach((e) => walk(e, depth + 1)); break;
      default: break;
    }
  };
  if (ast) walk(ast, 0);
  return out;
}


export interface CustomFormula {
  title?: string;
  collectionId?: string;
  
  blockId?: string;
  contextItems: { key: string; label: string; icon: string; description: string; type?: FValue['type'] | 'list' }[];
  contextLabel?(key: string): string | undefined;
  
  contextValue(key: string, row: BlockRecord | undefined): FValue | undefined;
  
  propertyInsert?(propId: string): string;
  onSave(src: string): void;
}

interface EditorProps {
  collectionId: string;
  propertyId: string;
  rowId?: string;
  close: () => void;
  state: { src: string; original: string };
  custom?: CustomFormula;
}

function FormulaEditor({ collectionId, propertyId, rowId, close, state, custom }: EditorProps) {
  useTableVersion(['block', 'collection']);
  const col = useCollection(collectionId);
  const schema = col?.schema ?? {};
  const [src, setSrcState] = useState(state.src);
  const [caret, setCaretState] = useState(state.src.length);
  const rows = rowsOfCollection(collectionId);
  const [previewId, setPreviewId] = useState(rowId ?? rows[0]?.id);
  const [debug, setDebug] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [focused, setFocused] = useState(true);
  const editorRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  const setSrc = (s: string) => {
    state.src = s;
    setSrcState(s);
  };

  const row = previewId ? records.get<BlockRecord>('block', previewId) : undefined;
  const ctx = custom ? { ...formulaContext(), contextValue: (k: string) => custom.contextValue(k, row) } : formulaContext();
  const result = useMemo(() => evaluateFormula(src, row ?? null, schema, ctx), [src, row, schema]); // eslint-disable-line react-hooks/exhaustive-deps
  const sizeProblem = useMemo(() => (custom || !propertyId ? null : formulaSizeProblem(collectionId, propertyId, src)), [src, schema]); // eslint-disable-line react-hooks/exhaustive-deps
  const contextType = (k: string) => {
    const t = custom?.contextItems.find((c) => c.key === k)?.type;
    if (!t) return undefined;
    if (t === 'list') return { type: 'array', of: { type: 'block' } } as any;
    return { type: t } as any;
  };
  const type = useMemo(() => formulaResultType(src, schema, { getCollection: ctx.getCollection, collectionId, contextType }), [src, schema]); // eslint-disable-line react-hooks/exhaustive-deps
  const caretCtx = useMemo(() => caretContext(src, caret), [src, caret]);
  const items = useMemo(() => {
    const base = buildItems(caretCtx, schema, propertyId);
    if (!custom) return base;
    const ql = caretCtx.prefix.toLowerCase();
    const ctxItems: CompletionItem[] = caretCtx.mode === 'operand'
      ? custom.contextItems.filter((c) => !ql || c.label.toLowerCase().includes(ql)).map((c) => ({ kind: 'context', key: `ctx:${c.key}`, label: c.label, section: 'From this workflow', icon: c.icon, insert: encodeToken({ type: 'context', key: c.key }), description: c.description }))
      : [];
    const props = base.filter((i) => i.kind === 'property').map((i) => ({ ...i, section: custom.contextLabel?.('page') ?? 'Trigger page', insert: custom.propertyInsert?.(i.propId!) }));
    return [...ctxItems, ...props, ...base.filter((i) => i.kind !== 'property')];
  }, [caretCtx, schema, propertyId, custom]);
  useEffect(() => setActive(0), [caretCtx.prefix, caretCtx.mode]);
  const activeItem = items.find((i) => i.key === hover) ?? items[active] ?? null;

  // keep the DOM in sync with `src` (re-highlight), restoring the caret
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el || composing.current) return;
    const err = result.error ? { start: result.error.start, end: result.error.end } : null;
    const hadFocus = document.activeElement === el;
    renderFormula(el, src, (t) => chipFor(t, schema, custom), { error: err, iconHtml });
    if (hadFocus) setCaret(el, caret);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, result.error?.start, result.error?.end, schema]);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    setCaret(el, src.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = listRef.current?.querySelector('.nc-fx-item.active');
    (el as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, items]);

  const syncFromDom = () => {
    const el = editorRef.current;
    if (!el) return;
    const raw = readFormula(el);
    const c = getCaret(el) ?? raw.length;
    const resolved = resolvePropCalls(raw, schema, col ? { id: col.id, spaceId: col.space_id } : undefined);
    const nextCaret = resolved === raw ? c : Math.max(0, resolved.length - (raw.length - c));
    setCaretState(nextCaret);
    setSrc(resolved);
    if (resolved !== raw || raw !== src) {
      // re-render happens in the layout effect; make sure caret lands correctly even if src is unchanged
      requestAnimationFrame(() => {
        const e2 = editorRef.current;
        if (e2 && document.activeElement === e2 && resolved !== raw) setCaret(e2, nextCaret);
      });
    }
  };

  const updateCaret = () => {
    const el = editorRef.current;
    if (!el) return;
    const c = getCaret(el);
    if (c !== null) setCaretState(c);
  };

  const accept = (item: CompletionItem) => {
    const r = applyItem(src, caret, caretCtx, item, col ? { id: col.id, spaceId: col.space_id } : undefined);
    setCaretState(r.caret);
    setSrc(r.src);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (!el) return;
      el.focus();
      setCaret(el, r.caret);
    });
  };

  const insertText = (text: string) => {
    const el = editorRef.current;
    if (!el) return;
    const c = getCaret(el) ?? src.length;
    const next = src.slice(0, c) + text + src.slice(c);
    setCaretState(c + text.length);
    setSrc(next);
    requestAnimationFrame(() => {
      const e2 = editorRef.current;
      if (e2) setCaret(e2, c + text.length);
    });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === 'ArrowDown' && items.length && caretCtx.prefix) {
      e.preventDefault();
      setHover(null);
      setActive((a) => (a + 1) % items.length);
      return;
    }
    if (e.key === 'ArrowUp' && items.length && caretCtx.prefix) {
      e.preventDefault();
      setHover(null);
      setActive((a) => (a - 1 + items.length) % items.length);
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      if (items[active] && caretCtx.prefix) accept(items[active]);
      else insertText('  ');
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        insertText('\n');
        return;
      }
      if (items[active] && caretCtx.prefix) {
        accept(items[active]);
        return;
      }
      close();
    }
  };

  const previewMenu = (e: React.MouseEvent) => {
    openMenu(e.currentTarget as HTMLElement, {
      search: 'Search',
      width: 280,
      sections: [{
        items: rowsOfCollection(collectionId).map((r) => ({ id: r.id, label: titleOf(r) || 'Untitled', icon: 'page', checked: r.id === previewId, onSelect: () => setPreviewId(r.id) })),
      }],
      emptyText: 'No results',
    });
  };

  const dirty = src !== state.original;
  const ast = useMemo(() => (debug ? parse(src).ast : null), [debug, src]);
  let lastSection = '';
  const [assistantOpen, setAssistantOpen] = useState(assistantOpenPref);
  const previewNode = sizeProblem ? <span className="nc-fx-error-text">{sizeProblem}</span> : result.error ? <span className="nc-fx-error-text">{result.error.message}</span> : result.value.type === 'undefined' ? <span className="nc-fx-empty">No output</span> : <FormulaValueView value={result.value} schema={col?.schema[propertyId]} />;
  const applyFromAssistant = (next: string) => {
    setSrc(next);
    setCaretState(next.length);
    requestAnimationFrame(() => {
      const el = editorRef.current;
      if (el) setCaret(el, next.length);
    });
  };

  return (
    <div className="nc-fx-dialog" role="dialog" aria-label="Edit formula" onMouseDown={(e) => e.stopPropagation()}>
      <div className="nc-fx-head">
        <div className="nc-fx-title">{custom?.title ?? 'Edit formula'}</div>
        {HELP_URL && (<a className="nc-fx-help" role="link" aria-label="Explore formula help" href={HELP_URL} target="_blank" rel="noopener noreferrer"><Icon name="questionMark" size={16} /></a>)}
        <div style={{ flex: 1 }} />
        {dirty && <div role="button" className="nc-fx-discard" title="Restores the formula from when this editor opened." onClick={() => { setSrc(state.original); setCaretState(state.original.length); }}>Drop all edits</div>}
        <div role="button" className="nc-fx-close" aria-label="Close" onClick={close}><Icon name="xSmall" size={14} /></div>
      </div>
      {assistantOpen && (
        <FormulaAssistant
          collectionId={collectionId}
          blockId={custom?.blockId}
          schema={schema}
          src={src}
          error={sizeProblem ?? result.error?.message ?? null}
          context={custom?.contextItems.map((c) => ({ key: c.key, label: c.label, type: c.type === 'block' ? 'page' : c.type === 'list' ? 'list of pages' : c.type }))}
          onApply={applyFromAssistant}
          preview={previewNode}
          typeLabel={`Type: ${typeLabel(type)}`}
        />
      )}
      <div className="nc-fx-codebox-wrap">
        <div className={`nc-fx-codebox ${focused ? 'focused' : ''}`}>
          {!src && <div className="nc-fx-placeholder">Your formula</div>}
          <div
            ref={editorRef}
            className="nc-fx-code"
            role="textbox"
            aria-multiline="true"
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            data-content-editable-leaf="true"
            onInput={() => { if (!composing.current) syncFromDom(); }}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; syncFromDom(); }}
            onKeyDown={onKeyDown}
            onKeyUp={updateCaret}
            onMouseUp={updateCaret}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onPaste={(e) => {
              e.preventDefault();
              insertText(e.clipboardData.getData('text/plain'));
            }}
          />
          <div
            role="button"
            aria-pressed={assistantOpen}
            aria-label="Switch formula helper"
            data-tooltip={assistantOpen ? 'Hide formula assistant' : 'Get help with this formula'}
            className={`nc-fx-ai-toggle ${assistantOpen ? 'on' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setAssistantOpen(!assistantOpen);
              setAssistantOpenPref(!assistantOpen);
            }}
          >
            <Icon name="aiFace" size={12} />
          </div>
        </div>
      </div>
      <div className="nc-fx-preview">
        <div className="nc-fx-preview-head">
          <div className="nc-fx-preview-left">
            <span className="nc-fx-label">Preview with</span>
            <div role="button" className="nc-fx-preview-page" aria-haspopup="dialog" onClick={previewMenu}>
              <Icon name="page" size={14} color="var(--lp-icon-secondary)" />
              <span className="nc-fx-preview-title">{row ? titleOf(row) || 'Untitled' : 'Select a page'}</span>
              <Icon name="chevronDown" size={12} color="var(--lp-icon-secondary)" />
            </div>
          </div>
          <label className="nc-fx-debug">
            <span className={`nc-adv-toggle ${debug ? 'on' : ''}`}><span /></span>
            <input type="checkbox" role="switch" aria-label="Debug mode" checked={debug} onChange={(e) => setDebug(e.target.checked)} />
            <span>Debug mode</span>
          </label>
        </div>
        <div className="nc-fx-result-row">
          <div className="nc-fx-result">
            {previewNode}
          </div>
          <div className="nc-fx-type">Type: {typeLabel(type)}</div>
        </div>
        {debug && ast && (
          <div className="nc-fx-debug-list">
            {debugNodes(ast).map((n, i) => {
              const part = src.slice(n.start, n.end);
              const r = evaluateFormula(part, row ?? null, schema, ctx);
              return (
                <div key={i} className="nc-fx-debug-row">
                  <code className="nc-fx-debug-src"><ExampleCode code={part.replace(/\{\{lit:block_property:([^:}]+)[^}]*\}\}/g, (_m, id) => `prop("${schema[decodeURIComponent(id)]?.name ?? id}")`)} /></code>
                  <span className="nc-fx-debug-val">{r.error ? <span className="nc-fx-error-text">{r.error.message}</span> : <FormulaValueView value={r.value} />}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div className="nc-fx-bottom">
        <div className="nc-fx-list lit-scroller vertical" ref={listRef} role="menu" onMouseLeave={() => setHover(null)}>
          {items.length === 0 && <div className="nc-fx-noresults">No results</div>}
          {items.map((it, i) => {
            const header = it.section !== lastSection ? it.section : null;
            lastSection = it.section;
            const isActive = hover ? it.key === hover : i === active;
            return (
              <div key={it.key}>
                {header && <div className="nc-fx-section">{header}</div>}
                <div
                  role="menuitem"
                  className={`nc-fx-item ${isActive ? 'active' : ''}`}
                  onMouseEnter={() => setHover(it.key)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => accept(it)}
                >
                  <Icon name={it.icon} size={16} color="var(--lp-icon-secondary)" />
                  <span className="nc-fx-item-label">{it.label}{it.suffix && <span className="nc-fx-paren">{it.suffix}</span>}</span>
                  <span className="nc-fx-enter"><Icon name="cornerDownLeft" size={14} color="var(--lp-icon-secondary)" /></span>
                </div>
              </div>
            );
          })}
        </div>
        <DocPanel item={activeItem} />
      </div>
    </div>
  );
}


function schemaWithFormula(col: CollectionRecord, propertyId: string, src: string) {
  const resolved = resolvePropCalls(src, col.schema, { id: col.id, spaceId: col.space_id });
  return { ...col.schema, [propertyId]: { ...col.schema[propertyId], formula2: { code: sourceToCode(resolved) } } } as Record<string, unknown>;
}


export function formulaSizeProblem(collectionId: string, propertyId: string, src: string): string | null {
  const col = records.get<CollectionRecord>('collection', collectionId);
  if (!col || !col.schema[propertyId]) return null;
  // cheap pre-check: only build the candidate schema when the formula is large or the schema already is
  if (src.length < 4096 && schemaSize(col.schema) < SCHEMA_SIZE_LIMIT / 2) return null;
  return schemaLimitProblem(schemaWithFormula(col, propertyId, src));
}


export function saveFormula(collectionId: string, propertyId: string, src: string) {
  const col = records.get<CollectionRecord>('collection', collectionId);
  if (!col || !col.schema[propertyId]) return;
  const tooLarge = formulaSizeProblem(collectionId, propertyId, src);
  if (tooLarge) {
    useUI.getState().toast(tooLarge);
    return;
  }
  const resolved = resolvePropCalls(src, col.schema, { id: col.id, spaceId: col.space_id });
  const type = formulaResultType(resolved, col.schema, { getCollection: (id) => records.get<CollectionRecord>('collection', id), collectionId });
  run('CollectionFormulaOptions.handleFormulaChange', (tx) => {
    tx.update('collection', collectionId, ['schema', propertyId], { type: 'formula', version: 'v2', formula2: { code: sourceToCode(resolved), result_type: toResultType(type) } });
  });
}


export function openFormulaEditor(anchor: Anchor | null | undefined, opts: { collectionId: string; propertyId: string; rowId?: string; onClose?: () => void }): () => void {
  const col = records.get<CollectionRecord>('collection', opts.collectionId);
  const original = formulaSourceOf(col?.schema[opts.propertyId]);
  const state = { src: original, original };
  return openOverlay((close) => <FormulaEditor {...opts} close={close} state={state} />, {
    anchor: anchor ?? undefined,
    placement: anchor ? 'bottom-start' : 'center',
    backdrop: 'transparent',
    onClose: () => {
      if (state.src !== state.original) saveFormula(opts.collectionId, opts.propertyId, state.src);
      opts.onClose?.();
    },
  });
}


export function openCustomFormulaEditor(anchor: Anchor | null | undefined, opts: CustomFormula & { initial: string; rowId?: string }): () => void {
  const state = { src: opts.initial, original: opts.initial };
  return openOverlay((close) => <FormulaEditor collectionId={opts.collectionId ?? ''} propertyId="" rowId={opts.rowId} close={close} state={state} custom={opts} />, {
    anchor: anchor ?? undefined,
    placement: anchor ? 'bottom-start' : 'center',
    backdrop: 'transparent',
    parent: anchor instanceof HTMLElement ? Number((anchor.closest('[data-overlay-id]') as HTMLElement | null)?.dataset.overlayId) || undefined : undefined,
    onClose: () => {
      if (state.src !== state.original) opts.onSave(state.src);
    },
  });
}


// become source chips that open the cited page (at the cited block) or web page.
import { createContext, memo, useContext, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { parseInline, parseMarkdown, type MdNode, type Seg } from './md.ts';
import { openSource, type SourceRef } from './aiApi.ts';
import { AiTable } from './AiTable.tsx';

function Inline({ text, sources }: { text: string; sources?: SourceRef[] }) {
  const segs = parseInline(text);
  return <>{segs.map((s, i) => <InlineSeg key={i} s={s} sources={sources} />)}</>;
}

function InlineSeg({ s, sources }: { s: Seg; sources?: SourceRef[] }) {
  if (s.cite) {
    const ref = sources?.find((r) => r.n === s.cite);
    return (
      <span
        role={ref ? 'link' : undefined}
        className={`nc-ai-cite ${ref ? 'linked' : ''}`}
        data-tooltip={ref ? ref.title || ref.url || 'Untitled' : undefined}
        onClick={ref ? (e) => { e.preventDefault(); openSource(ref); } : undefined}
      >
        {s.cite}
      </span>
    );
  }
  let node: ReactNode = s.text;
  if (s.eq) return <span className="nc-ai-eq lit-text-equation-token">{s.text}</span>;
  if (s.c) node = <code className="lit-inline-code">{node}</code>;
  if (s.b) node = <strong>{node}</strong>;
  if (s.i) node = <em>{node}</em>;
  if (s.s) node = <s>{node}</s>;
  if (s.href) {
    const safe = /^(https?:|mailto:)/i.test(s.href);
    node = safe ? <a href={s.href} target="_blank" rel="noopener noreferrer" className="lit-link">{node}</a> : node;
  }
  return <>{node}</>;
}

function Nodes({ nodes, sources }: { nodes: MdNode[]; sources?: SourceRef[] }) {
  return <>{nodes.map((n, i) => <Node key={i} n={n} sources={sources} />)}</>;
}

function Node({ n, sources }: { n: MdNode; sources?: SourceRef[] }) {
  switch (n.type) {
    case 'heading': {
      const cls = `nc-ai-h nc-ai-h${n.level}`;
      return <div className={cls} role="heading" aria-level={n.level}><Inline text={n.text} sources={sources} /></div>;
    }
    case 'paragraph':
      return <p className="nc-ai-p"><Inline text={n.text} sources={sources} /></p>;
    case 'list': {
      const todo = n.items.some((it) => it.checked !== null);
      if (todo) {
        return (
          <div className="nc-ai-todos">
            {n.items.map((it, i) => (
              <div key={i} className="nc-ai-todo">
                <span className={`nc-ai-check ${it.checked ? 'checked' : ''}`} aria-hidden>
                  {it.checked && <Check size={12} strokeWidth={2.5} />}
                </span>
                <div className={`nc-ai-todo-body ${it.checked ? 'done' : ''}`}>
                  <Inline text={it.text} sources={sources} />
                  {it.children.length > 0 && <Nodes nodes={it.children} sources={sources} />}
                </div>
              </div>
            ))}
          </div>
        );
      }
      const Tag = n.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`nc-ai-list ${n.ordered ? 'ordered' : ''}`} start={n.ordered ? n.start : undefined}>
          {n.items.map((it, i) => (
            <li key={i}>
              <Inline text={it.text} sources={sources} />
              {it.children.length > 0 && <Nodes nodes={it.children} sources={sources} />}
            </li>
          ))}
        </Tag>
      );
    }
    case 'quote':
      return <blockquote className="nc-ai-quote"><Nodes nodes={n.children} sources={sources} /></blockquote>;
    case 'code':
      return (
        <div className="nc-ai-code">
          {n.lang && <div className="nc-ai-code-lang">{n.lang}</div>}
          <pre><code>{n.text}</code></pre>
        </div>
      );
    case 'math':
      return <div className="nc-ai-math">{n.text}</div>;
    case 'hr':
      return <div className="nc-ai-hr" role="separator" />;
    case 'image':
      return <img className="nc-ai-img" src={n.url} alt={n.alt} loading="lazy" style={{ display: 'block', maxWidth: '100%', borderRadius: 6, margin: '6px 0' }} />;
    case 'table':
      
      return <TableNode header={n.header} rows={n.rows} sources={sources} />;
  }
}

const Streaming = createContext(false);

function TableNode({ header, rows, sources }: { header: string[]; rows: string[][]; sources?: SourceRef[] }) {
  const streaming = useContext(Streaming);
  return <AiTable header={header} rows={rows} streaming={streaming} render={(md) => <Inline text={md} sources={sources} />} />;
}

export const AiMarkdown = memo(function AiMarkdown({ text, sources, streaming, className }: { text: string; sources?: SourceRef[]; streaming?: boolean; className?: string }) {
  const nodes = parseMarkdown(text);
  return (
    <Streaming.Provider value={!!streaming}>
      <div className={`nc-ai-md ${streaming ? 'streaming' : ''} ${className ?? ''}`}>
        <Nodes nodes={nodes} sources={sources} />
      </div>
    </Streaming.Provider>
  );
});

// Renders formula and rollup values: styled rich text, numbers with the property's
// number format and Bar/Ring "Show as", checkboxes, dates, people, page mentions and lists.
import type { ReactNode } from 'react';
import type { BlockRecord, PropertySchema, UserRecord } from '@nc/shared/records.ts';
import type { Annotation, Decoration } from '@nc/shared/richtext.ts';
import { formatFormulaValue, formatLitDate, type FValue, type LitDate } from '@nc/shared/formula/index.ts';
import { records } from '../../../lib/store/records.ts';
import { openPeek } from '../../../lib/router.ts';
import { Icon } from '../../../components/Icon.tsx';
import { userTimeZone } from './context.ts';
import { colorToken } from '../../../lib/colorToken.ts';

function runStyle(anns: Annotation[]): { className: string; style: React.CSSProperties; href?: string } {
  const cls: string[] = [];
  const style: React.CSSProperties = {};
  let href: string | undefined;
  for (const a of anns) {
    switch (a[0]) {
      case 'b': style.fontWeight = 600; break;
      case 'i': style.fontStyle = 'italic'; break;
      case '_': cls.push('lit-text-underline'); break;
      case 's': cls.push('lit-text-strike'); break;
      case 'c': cls.push('lit-inline-code'); break;
      case 'a': href = String(a[1]); cls.push('lit-link-token'); break;
      case 'h': {
        const c = String(a[1]);
        const base = c.replace(/_background$/, '').replace('teal', 'green');
        cls.push(c.endsWith('_background') ? `lit-bg-${base}` : `lit-color-${base}`);
        break;
      }
    }
  }
  return { className: cls.join(' '), style, href };
}

function pageTitle(id: string): string {
  const b = records.get<BlockRecord>('block', id);
  return (b?.properties?.title ?? []).map((d) => d[0]).join('') || 'Untitled';
}

function userName(id: string): string {
  const u = records.get<UserRecord>('lit_user', id);
  return u?.name || [u?.given_name, u?.family_name].filter(Boolean).join(' ') || u?.email || '';
}

export function PageMention({ id }: { id: string }) {
  const b = records.get<BlockRecord>('block', id);
  const icon = b?.format?.page_icon;
  return (
    <span className="nc-fx-page" role="link" onClick={(e) => { e.stopPropagation(); openPeek(id, 'side_peek'); }}>
      <span className="nc-fx-page-icon">{icon && !/^(https?:|\/)/.test(icon) && !icon.includes(':') ? icon : <Icon name="page" size={14} />}</span>
      <span className="nc-fx-page-title">{pageTitle(id)}</span>
    </span>
  );
}

export function PersonChip({ id }: { id: string }) {
  const name = userName(id);
  return (
    <span className="nc-fx-person">
      <span className="nc-fx-avatar">{(name || '?').slice(0, 1).toUpperCase()}</span>
      <span>{name}</span>
    </span>
  );
}

export function RichRuns({ value }: { value: Decoration[] }): ReactNode {
  return value.map((d, i) => {
    const anns = (d[1] as Annotation[] | undefined) ?? [];
    const atom = anns.find((a) => a[0] === 'd' || a[0] === 'u' || a[0] === 'p');
    if (atom?.[0] === 'd') return <span key={i} className="nc-fx-date">{formatLitDate(atom[1] as unknown as LitDate, { tz: userTimeZone() })}</span>;
    if (atom?.[0] === 'u') return <span key={i} className="nc-fx-user">@{userName(String(atom[1]))}</span>;
    if (atom?.[0] === 'p') return <PageMention key={i} id={String(atom[1])} />;
    const { className, style, href } = runStyle(anns);
    if (href) return <a key={i} className={className} style={style} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>{d[0]}</a>;
    return className || Object.keys(style).length ? <span key={i} className={className} style={style}>{d[0]}</span> : <span key={i}>{d[0]}</span>;
  });
}

function ShowAs({ n, show, text }: { n: number; show: { type?: string; color?: string; maxValue?: number; showValue?: boolean }; text: string }) {
  const max = show.maxValue || 100;
  const frac = Math.max(0, Math.min(1, n / max));
  const color = `var(${colorToken(show.color ?? 'green', 'bg-accent-secondary')})`;
  const valueEl = show.showValue === false ? null : <span className="nc-fx-showas-value">{text}</span>;
  if (show.type === 'ring') {
    const r = 7;
    const c = 2 * Math.PI * r;
    return (
      <span className="nc-fx-showas ring">
        <svg width={20} height={20} viewBox="0 0 20 20" aria-hidden><circle cx={10} cy={10} r={r} fill="none" stroke="var(--lp-border-primary)" strokeWidth={3} /><circle cx={10} cy={10} r={r} fill="none" stroke={color} strokeWidth={3} strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 10 10)" strokeLinecap="round" /></svg>
        {valueEl}
      </span>
    );
  }
  return (
    <span className="nc-fx-showas bar">
      {valueEl}
      <span className="nc-fx-bar"><span style={{ width: `${frac * 100}%`, background: color }} /></span>
    </span>
  );
}

/** Formula / rollup value. `schema` supplies number_format / number_precision / show_as / date formats. */
export function FormulaValueView({ value, schema, percent }: { value: FValue; schema?: PropertySchema; percent?: boolean }): ReactNode {
  const ctx = { timeZone: userTimeZone(), getBlock: (id: string) => records.get<BlockRecord>('block', id), getUser: (id: string) => records.get<UserRecord>('lit_user', id) };
  switch (value.type) {
    case 'undefined': case 'function': return null;
    case 'number': {
      const text = formatFormulaValue(value, { schema, ctx, percent });
      const show = schema?.show_as as { type?: string } | undefined;
      if (show?.type === 'bar' || show?.type === 'ring') return <ShowAs n={percent ? value.value * 100 : value.value} show={show} text={text} />;
      return <span className="nc-fx-number">{text}</span>;
    }
    case 'checkbox':
      return <span className={`nc-fx-checkbox ${value.value ? 'on' : ''}`}>{value.value ? <Icon name="check" size={12} color="#fff" /> : null}</span>;
    case 'text': return <span className="nc-fx-text"><RichRuns value={value.value} /></span>;
    case 'date': return <span className="nc-fx-date">{formatLitDate(value.value, { tz: ctx.timeZone, dateFormat: schema?.date_format as string | undefined, timeFormat: schema?.time_format as string | undefined })}</span>;
    case 'person': return <PersonChip id={value.value.id} />;
    case 'block': return <PageMention id={value.value.id} />;
    case 'array':
      return (
        <span className="nc-fx-list">
          {value.values.map((v, i) => (
            <span key={i} className="nc-fx-list-item">
              {i > 0 && v.type !== 'block' && v.type !== 'person' ? <span className="nc-fx-sep">, </span> : null}
              <FormulaValueView value={v} schema={schema} />
            </span>
          ))}
        </span>
      );
  }
}

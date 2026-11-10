// Read-only rendering of typed property values (table cells, cards, list rows, page properties).
// Pills: select radius 4 / status radius 10 + 8px dot.
import type { ReactNode } from 'react';
import type { BlockRecord, PropertySchema, SelectOption, SpaceRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import {
  formatDateRange, formatNumber, formatTimestamp, showAsFraction, valueToText, type PropertyValue, type QueryContext,
} from '@nc/shared/database/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { useUI } from '../../../lib/store/ui.ts';
import { UserAvatar } from '../../presence/Avatar.tsx';
import { useBlock, useRecord, useUser } from '../../../lib/hooks.ts';
import { useSession } from '../../../lib/store/session.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { RichTextView } from './RichTextView.tsx';
import { TEMPLATE_ME, TemplateVarChip, templateDateLabel } from '../templates/templateVars.tsx';
import { colorToken } from '../../../lib/colorToken.ts';

export function optionColorClass(color: string | undefined): string {
  return `nc-color-${color && color !== 'teal' ? color : color === 'teal' ? 'green' : 'default'}`;
}

export function OptionPill({ option, onRemove, className }: { option: Pick<SelectOption, 'value' | 'color'>; onRemove?: () => void; className?: string }) {
  return (
    <span className={`nc-pill ${optionColorClass(option.color)} ${className ?? ''}`}>
      <span className="nc-pill-text" data-tooltip={option.value.length > 24 ? option.value : undefined}>{option.value}</span>
      {onRemove && (
        <span role="button" className="nc-pill-remove" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Icon name="xSmall" size={12} />
        </span>
      )}
    </span>
  );
}

export function StatusPill({ option, onRemove }: { option: Pick<SelectOption, 'value' | 'color'>; onRemove?: () => void }) {
  return (
    <span className={`nc-pill nc-status-pill ${optionColorClass(option.color)}`}>
      <span className="nc-status-dot" />
      <span className="nc-pill-text" data-tooltip={option.value.length > 24 ? option.value : undefined}>{option.value}</span>
      {onRemove && (
        <span role="button" className="nc-pill-remove" onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); onRemove(); }}>
          <Icon name="xSmall" size={12} />
        </span>
      )}
    </span>
  );
}

export function PersonChip({ userId, showName = true, size = 20 }: { userId: string; showName?: boolean; size?: number }) {
  const u = useUser(userId);
  return (
    <span className="nc-person-chip">
      <UserAvatar userId={userId} size={size} />
      {showName && <span className="nc-person-name">{u?.name || u?.email || 'Unknown user'}</span>}
    </span>
  );
}

/** A permission group in a Person value (Settings › People › Groups): square avatar with its initial + name. */
export function GroupChip({ groupId, spaceId, size = 20 }: { groupId: string; spaceId?: string; size?: number }) {
  const space = useRecord<SpaceRecord>('space', spaceId ?? useSession.getState().spaceId ?? undefined);
  const g = ((space?.settings?.groups ?? []) as { id: string; name?: string }[]).find((x) => x?.id === groupId);
  const name = g?.name || 'Deleted group';
  return (
    <span className="nc-person-chip nc-group-chip" data-group-id={groupId}>
      <span className="nc-group-avatar" style={{ width: size, height: size }} aria-hidden>{name.trim()[0]?.toUpperCase() ?? <Icon name="users" size={Math.round(size * 0.55)} />}</span>
      <span className="nc-person-name">{name}</span>
    </span>
  );
}

export function PageChip({ pageId }: { pageId: string }) {
  const b = useBlock(pageId);
  const title = b ? ((b.properties?.title as RichText | undefined)?.map((d) => d[0]).join('') || 'Untitled') : 'Untitled';
  return (
    <span className="nc-page-chip">
      {b && <span className="nc-page-chip-icon"><PageIcon block={b} size={16} fallback={b.content?.length ? 'page' : 'pageEmpty'} /></span>}
      <span className="nc-page-chip-title">{title}</span>
    </span>
  );
}

export function CheckboxView({ checked, onToggle, disabled }: { checked: boolean; onToggle?: () => void; disabled?: boolean }) {
  return (
    <span
      role="checkbox"
      aria-checked={checked}
      className={`nc-prop-checkbox ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onToggle?.();
      }}
    >
      {checked && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}
    </span>
  );
}

function NumberView({ n, prop }: { n: number | null; prop?: PropertySchema }) {
  const text = formatNumber(n, prop?.number_format as string | undefined, prop?.number_precision as string | undefined);
  const showAs = prop?.show_as as { type?: string; color?: string; maxValue?: number; showValue?: boolean } | undefined;
  if (n === null || !showAs?.type || showAs.type === 'number') return <span className="nc-number">{text}</span>;
  const frac = showAsFraction(n, showAs.maxValue);
  const color = `var(${colorToken(colorKey(showAs.color ?? 'green'), 'icon-accent')})`;
  if (showAs.type === 'ring') {
    const r = 7;
    const c = 2 * Math.PI * r;
    return (
      <span className="nc-number-ring">
        <svg width={20} height={20} viewBox="0 0 20 20">
          <circle cx={10} cy={10} r={r} fill="none" stroke="var(--lp-border-primary-transparent)" strokeWidth={3} />
          <circle cx={10} cy={10} r={r} fill="none" stroke={color} strokeWidth={3} strokeDasharray={`${c * frac} ${c}`} transform="rotate(-90 10 10)" strokeLinecap="round" />
        </svg>
        {showAs.showValue !== false && <span>{text}</span>}
      </span>
    );
  }
  return (
    <span className="nc-number-bar">
      {showAs.showValue !== false && <span className="nc-number-bar-value">{text}</span>}
      <span className="nc-number-bar-track"><span className="nc-number-bar-fill" style={{ width: `${frac * 100}%`, background: color }} /></span>
    </span>
  );
}

const COLOR_KEYS: Record<string, string> = { default: 'gra', gray: 'gra', brown: 'bro', orange: 'ora', yellow: 'yel', green: 'gre', teal: 'gre', blue: 'blu', purple: 'pur', pink: 'pin', red: 'red' };
export function colorKey(color: string | undefined): string {
  return COLOR_KEYS[color ?? 'default'] ?? 'gra';
}

/** Short URL display: host without "www." plus the rest of the URL (tertiary), the rest elided as "abcd…uvwxyz"
 * once longer than 12 chars. */
export function shortenUrl(text: string): { domain: string; rest: string } | null {
  const t = text.trim();
  if (!t || t.includes(' ')) return null;
  let host = '';
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `http://${t}`);
    host = u.host;
  } catch {
    return null;
  }
  if (!host) return null;
  host = host.replace(/^www./i, '');
  const at = t.toLowerCase().indexOf(host.toLowerCase());
  if (at < 0) return null;
  const domain = t.slice(at, at + host.length);
  let rest = t.slice(at + host.length);
  if (rest.length > 12) rest = `${rest.slice(0, 4)}…${rest.slice(-6)}`;
  return { domain, rest };
}

function linkHref(prop: PropertySchema | undefined, text: string): string {
  if (prop?.type === 'email') return `mailto:${text}`;
  if (prop?.type === 'phone_number') return `tel:${text.replace(/[\s().-]/g, '')}`;
  return /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
}

export interface ValueViewProps {
  value: PropertyValue;
  prop?: PropertySchema;
  propId?: string;
  row?: BlockRecord;
  ctx?: QueryContext;
  /** wrap long content (table wrap / cards) */
  wrap?: boolean;
  /** checkbox toggles directly */
  onToggleCheckbox?: () => void;
  readOnly?: boolean;
  mode?: 'cell' | 'card' | 'page' | 'list';
}

/** Hover "Copy value" button of email / URL / phone values. */
function CopyValueButton({ text, kind }: { text: string; kind: string }) {
  return (
    <span
      role="button"
      className="nc-copy-value"
      aria-label="Copy value"
      data-tooltip="Copy value"
      onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }}
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text).then(
          () => useUI.getState().toast(kind === 'email' ? 'Copied email to clipboard' : 'Copied to clipboard'),
          () => useUI.getState().toast('Failed to copy'),
        );
      }}
    >
      <Icon name="copy" size={14} />
    </span>
  );
}

/** Renders one value; returns null when empty (callers show placeholders like "Empty"). */
export function ValueView({ value, prop, wrap, onToggleCheckbox, readOnly, ctx, mode = 'cell' }: ValueViewProps): ReactNode {
  switch (value.kind) {
    case 'text': {
      if (!value.text) return null;
      if (prop && (prop.type === 'url' || prop.type === 'email' || prop.type === 'phone_number')) {
        const short = prop.type === 'url' && prop.show_full_url !== true ? shortenUrl(value.text) : null;
        return (
          <>
            <a className="nc-link-value" href={linkHref(prop, value.text)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              {short ? (
                <>
                  {short.domain}
                  {short.rest && <span className="nc-url-rest">{short.rest}</span>}
                </>
              ) : (
                value.text
              )}
            </a>
            {mode !== 'card' && <CopyValueButton text={value.text} kind={prop.type} />}
          </>
        );
      }
      if (value.rich && value.rich.length) return <RichTextView value={value.rich} className={`nc-text-value ${wrap ? 'wrap' : ''}`} />;
      return <span className={`nc-text-value ${wrap ? 'wrap' : ''}`}>{value.text}</span>;
    }
    case 'number':
      if (value.number === null) return null;
      if (prop?.type === 'auto_increment_id') return <span className="nc-id-value">{`${prop.prefix ? `${prop.prefix}-` : ''}${value.number}`}</span>;
      if (prop?.type === 'rollup' && /^percent/.test(String(prop.aggregation ?? ''))) return <span className="nc-number">{formatNumber(value.number, 'percent')}</span>;
      return <NumberView n={value.number} prop={prop} />;
    case 'checkbox':
      return <CheckboxView checked={value.checked} onToggle={onToggleCheckbox} disabled={readOnly || !onToggleCheckbox} />;
    case 'select':
      if (!value.options.length) return null;
      return (
        <span className={`nc-pills ${wrap ? 'wrap' : ''}`}>
          {value.options.map((o, i) => <OptionPill key={`${o.value}-${i}`} option={o} />)}
        </span>
      );
    case 'status':
      if (!value.option) return null;
      return <span className="nc-pills"><StatusPill option={value.option} /></span>;
    case 'date': {
      if (!value.date) return null;
      // database templates: "Today" / "Now" filled in when the template is used (DB-TPL-003)
      const tv = templateDateLabel(value.date.raw);
      if (tv) return <TemplateVarChip icon="date">{tv}</TemplateVarChip>;
      const isTs = prop?.type === 'created_time' || prop?.type === 'last_edited_time';
      const text = isTs
        ? formatTimestamp(value.date.startMs, { dateFormat: prop?.date_format as string | undefined, timeFormat: prop?.time_format as string | undefined })
        : formatDateRange(value.date, { dateFormat: (value.date.raw?.date_format ?? prop?.date_format) as string | undefined, timeFormat: (value.date.raw?.time_format ?? prop?.time_format) as string | undefined });
      return <span className={`nc-date-value ${wrap ? 'wrap' : ''}`}>{text}{value.date.raw?.reminder && (value.date.raw.reminder as any).unit !== 'none' && <Icon name="alarmClock" size={14} className="nc-date-reminder" />}</span>;
    }
    case 'person':
      if (!value.ids.length && !value.groups?.length) return null;
      return (
        <span className={`nc-people ${wrap ? 'wrap' : ''}`}>
          {value.ids.map((id) => (id === TEMPLATE_ME ? <TemplateVarChip key={id} icon="person">Person who duplicated entry</TemplateVarChip> : <PersonChip key={id} userId={id} size={20} />))}
          {(value.groups ?? []).map((g) => <GroupChip key={`g:${g.id}`} groupId={g.id} spaceId={g.spaceId} size={20} />)}
        </span>
      );
    case 'relation':
      if (!value.ids.length) return null;
      return (
        <span className={`nc-relations ${wrap ? 'wrap' : ''}`}>
          {value.ids.map((id) => <PageChip key={id} pageId={id} />)}
        </span>
      );
    case 'file':
      if (!value.files.length) return null;
      return (
        <span className={`nc-files ${wrap ? 'wrap' : ''}`}>
          {value.files.map((f, i) => (
            /\.(png|jpe?g|gif|webp|svg|avif)(\?|$)/i.test(f.url) && mode !== 'page' ? (
              <img key={i} className="nc-file-thumb" src={f.url} alt={f.name} />
            ) : (
              <a key={i} className="nc-file-chip" href={f.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                <Icon name="paperClip" size={14} />
                <span>{f.name}</span>
              </a>
            )
          ))}
        </span>
      );
    case 'place':
      if (!value.place) return null;
      return (
        <span className="nc-place-value">
          <Icon name="location" size={14} />
          <span>{value.place.name || value.place.address}</span>
        </span>
      );
    case 'verification':
      if (value.state === 'none') return null;
      return (
        <span className={`nc-verification ${value.state}`}>
          <Icon name="verification" size={14} />
          <span>{value.state === 'verified' ? 'Verified' : 'Expired'}</span>
        </span>
      );
    case 'button':
      return null;
    case 'array': {
      const items = value.items.filter((i) => !(i.kind === 'text' && !i.text));
      if (!items.length) return null;
      return (
        <span className={`nc-array-value ${wrap ? 'wrap' : ''}`}>
          {items.map((it, i) => (
            <span key={i} className="nc-array-item">
              <ValueView value={it} ctx={ctx} wrap={wrap} readOnly mode={mode} />
            </span>
          ))}
        </span>
      );
    }
    case 'error':
      return <span className="nc-value-error" title={value.message}>{value.message ? 'Error' : ''}</span>;
  }
  return <span>{valueToText(value, prop, ctx)}</span>;
}

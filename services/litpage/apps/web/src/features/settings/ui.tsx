// Settings building blocks: section header (26px/600 + 16px subtitle), groups
// (16px/500 title with bottom border), rows (14px/500 label, 13px/400 description, right-aligned control),
// 24px gaps between rows / 48px between groups, outline/primary/danger buttons, 30×18 switches, dropdown buttons.
import { Children, Fragment, isValidElement, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useUI } from '../../lib/store/ui.ts';
import { getLocale, t } from '../shell/i18n.ts';
import koBundle from '../shell/i18n.ko-KR.json';

/** Raw localized message that keeps rich-text tags like <bold> and <inlinelink>; pair with rich(). */
export function msg(id: string, defaultMessage: string): string {
  return (getLocale() === 'ko-KR' && (koBundle as Record<string, string>)[id]) || defaultMessage;
}

/** Render a message with {vars} (strings or elements) and simple (non-nested) tags: rich(msg(...), {x}, { bold: (c) => <b>{c}</b> }). */
export function rich(text: string, values: Record<string, ReactNode> = {}, tags: Record<string, (chunk: ReactNode, i: number) => ReactNode> = {}): ReactNode[] {
  const nodes: ReactNode[] = [];
  const withVals = text.replace(/\{(\w+)\}/g, (m, k) => {
    if (!(k in values)) return m;
    const v = values[k];
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    nodes.push(v);
    return `\u0001${nodes.length - 1}\u0001`;
  });
  const expand = (s: string): ReactNode => (s.includes('\u0001')
    ? s.split('\u0001').map((p, j) => (j % 2 ? <Fragment key={j}>{nodes[Number(p)]}</Fragment> : p))
    : s);
  const out: ReactNode[] = [];
  const re = /<(\w+)>(.*?)<\/\1>/gs;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(withVals))) {
    if (m.index > last) out.push(expand(withVals.slice(last, m.index)));
    const fn = tags[m[1]];
    out.push(fn ? fn(expand(m[2]), i++) : expand(m[2]));
    last = m.index + m[0].length;
  }
  if (last < withVals.length) out.push(expand(withVals.slice(last)));
  return out.map((n, k) => (typeof n === 'string' ? n : <Fragment key={k}>{n}</Fragment>));
}

export function SectionPage({ title, subtitle, link, children, wide, headerExtra }: {
  title: ReactNode;
  subtitle?: ReactNode;
  link?: { label: string; href?: string; onClick?: () => void };
  children?: ReactNode;
  wide?: boolean;
  headerExtra?: ReactNode;
}) {
  return (
    <div className={`nc-set-column ${wide ? 'wide' : ''}`}>
      <header className="nc-set-header">
        <div className="nc-set-title-row"><h2 className="nc-set-title">{title}</h2></div>
        {(subtitle || link) && (
          <div className="nc-set-subtitle">
            {subtitle && <span>{subtitle}</span>}
            {link && <ExternalLink {...link} />}
          </div>
        )}
        {headerExtra}
      </header>
      {children !== undefined && <section className="nc-set-body">{withGaps(children, 'lg')}</section>}
    </div>
  );
}

export function ExternalLink({ label, href, onClick }: { label: string; href?: string; onClick?: () => void }) {
  return (
    <a
      className="nc-set-link"
      href={href ?? '#'}
      target={href ? '_blank' : undefined}
      rel="noreferrer"
      onClick={(e) => {
        if (!href) e.preventDefault();
        onClick?.();
      }}
    >
      {label}
    </a>
  );
}

function withGaps(children: ReactNode, size: 'sm' | 'lg'): ReactNode {
  const list = Children.toArray(children); // drops null / undefined / booleans
  return list.map((c, i) => (
    <Fragment key={isValidElement(c) && c.key != null ? c.key : i}>
      {i > 0 && <div className={`nc-set-gap ${size === 'lg' ? 'lg' : ''}`} role="presentation" />}
      {c}
    </Fragment>
  ));
}

/** plain: 17px section heading without divider (Litpage AI, Meeting notes, Mail & Calendar…); medium = 500 weight. */
export function Group({ title, help, children, plain, medium, description }: { title?: ReactNode; help?: string; children?: ReactNode; plain?: boolean; medium?: boolean; description?: ReactNode }) {
  return (
    <div className="nc-set-group">
      {title && (
        <div className={`nc-set-group-title ${plain ? 'plain' : ''} ${medium ? 'medium' : ''}`}>
          {title}
          {help && <span className="help" data-tooltip={help}><Icon name="questionMarkCircleSmall" size={16} /></span>}
        </div>
      )}
      {description && <div className="nc-set-group-desc">{description}</div>}
      {withGaps(children, 'sm')}
    </div>
  );
}

export function Row({ label, description, control, badge, disabled, num, id, leading }: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  num?: number;
  id?: string;
  /** element before the label column (e.g. the 36px app tile of Notifications › Connected apps), 12px gap */
  leading?: ReactNode;
}) {
  const text = (
    <div className="nc-set-row-text">
      {(label || num !== undefined || badge) && (
        <div className="nc-set-row-label">
          {num !== undefined && <span className="num">{num}</span>}
          <span>{label}</span>
          {badge}
        </div>
      )}
      {description && <div className="nc-set-row-desc">{description}</div>}
    </div>
  );
  return (
    <div className={`nc-set-row ${disabled ? 'disabled' : ''}`} data-setting={id}>
      {leading ? <div className="nc-set-row-lead">{leading}{text}</div> : text}
      {control !== undefined && <div className="nc-set-row-control">{control}</div>}
    </div>
  );
}

export function Badge({ children, tone = 'blue' }: { children: ReactNode; tone?: 'blue' | 'gray' | 'yellow' }) {
  return <span className={`nc-set-badge ${tone === 'blue' ? '' : tone}`}>{children}</span>;
}

export function Button({ children, onClick, variant, disabled, icon, title, small, className, ariaLabel }: {
  children?: ReactNode;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  variant?: 'primary' | 'danger' | 'ghost' | 'soft-blue';
  disabled?: boolean;
  icon?: string;
  title?: string;
  small?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled || undefined}
      aria-label={ariaLabel}
      data-tooltip={title}
      className={`nc-set-btn ${variant ?? ''} ${small ? 'small' : ''} ${className ?? ''}`}
      onClick={(e) => { if (!disabled) onClick?.(e); }}
      onKeyDown={(e) => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>); } }}
    >
      {icon && (CROPPED_ICON_WIDTH[icon]
        ? <span className="nc-set-btn-icon" style={{ width: CROPPED_ICON_WIDTH[icon] }}><Icon name={icon} size={13} /></span>
        : <Icon name={icon} size={16} />)}
      {children}
    </div>
  );
}

/** Some small glyphs have cropped viewBoxes (width auto): keep their box widths so buttons line up. */
const CROPPED_ICON_WIDTH: Record<string, number> = { pencilSmall: 9.44 };

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <div className={`nc-set-switch ${checked ? 'on' : ''} ${disabled ? 'disabled' : ''}`}>
      <div className="nc-set-switch-track"><div className="nc-set-switch-knob" /></div>
      <input type="checkbox" role="switch" aria-label={label} aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onChange?.(e.target.checked)} />
    </div>
  );
}

export interface Option<V extends string = string> {
  value: V;
  label: string;
  description?: string;
  disabled?: boolean;
}

export function Dropdown<V extends string>({ value, options, onChange, disabled, width = 250, label, renderLabel, maxHeight }: {
  value: V;
  options: Option<V>[];
  onChange: (v: V) => void;
  disabled?: boolean;
  width?: number;
  label?: string;
  renderLabel?: (o: Option<V> | undefined) => ReactNode;
  maxHeight?: number;
}) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.value === value);
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-disabled={disabled || undefined}
      aria-label={label}
      className={`nc-set-btn nc-set-dropdown ${open ? 'open' : ''}`}
      onClick={(e) => {
        if (disabled) return;
        setOpen(true);
        const items: MenuItemDef[] = options.map((o) => ({
          label: o.label,
          description: o.description,
          checked: o.value === value,
          disabled: o.disabled,
          onSelect: () => onChange(o.value),
        }));
        openMenu(e.currentTarget as HTMLElement, { width, maxHeight, sections: [{ items }] }, { placement: 'bottom-end', onClose: () => setOpen(false) });
      }}
    >
      <span>{renderLabel ? renderLabel(cur) : cur?.label ?? value}</span>
      <span className="chev"><Icon name="arrowChevronSingleDownSmall" size={14} /></span>
    </div>
  );
}

export function Pills<V extends string>({ value, items, onChange, big }: { value: V; items: { value: V; label: ReactNode; count?: number; icon?: ReactNode }[]; onChange: (v: V) => void; big?: boolean }) {
  return (
    <div className="nc-set-pills" role="tablist">
      {items.map((it) => (
        <div
          key={it.value}
          role="tab"
          aria-selected={it.value === value}
          className={`nc-set-pill ${it.value === value ? 'selected' : ''} ${big ? 'big' : ''}`}
          onClick={() => onChange(it.value)}
        >
          {it.icon}
          <span>{it.label}</span>
          {it.count !== undefined && <span className="count">{it.count}</span>}
        </div>
      ))}
    </div>
  );
}

/** Plan-gated hint ("<highlight>Upgrade</highlight> to …"), an upsell row: opens Explore plans. */
export function Upsell({ text, onClick }: { text: string; onClick?: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      className="nc-set-upsell"
      onClick={() => (onClick ? onClick() : useUI.getState().set({ settingsSection: 'plans' }))}
    >
      <Icon name="arrowInCircleUpAnimated" size={16} />
      <span>{rich(text, {}, { highlight: (c) => <span className="hl">{c}</span> })}</span>
    </div>
  );
}

export function IdRow({ label, id }: { label: string; id: string }) {
  return (
    <div className="nc-set-id-row">
      <span>{label}</span>
      <span className="id">
        {id}
        <span
          role="button"
          className="nc-set-icon-btn"
          aria-label={t('lp.settings.copy_this_id', 'Copy this ID')}
          data-tooltip={t('lp.settings.copy_this_id', 'Copy this ID')}
          onClick={() => {
            void navigator.clipboard?.writeText(id);
            useUI.getState().toast(t('lp.settings.clipboard_copy_complete', 'Clipboard copy complete'));
          }}
        >
          <Icon name="duplicate" size={16} />
        </span>
      </span>
    </div>
  );
}

export function UserAvatar({ user, size = 28 }: { user?: { name?: string; email?: string; profile_photo?: string }; size?: number }) {
  const name = user?.name || user?.email || '?';
  return (
    <span className="nc-set-user-avatar" style={{ width: size, height: size, fontSize: size * 0.44 }}>
      {user?.profile_photo ? <img src={user.profile_photo} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/** Small centered dialog above the settings modal (change password, confirmations, add members…). */
export function openSubDialog(render: (close: () => void) => ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const close = () => {
    root.unmount();
    host.remove();
    window.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e: KeyboardEvent) => {
    // a menu opened from inside the dialog (dropdowns) closes first
    if (e.key === 'Escape' && !document.querySelector('.lit-overlay-container .nc-overlay')) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  };
  window.addEventListener('keydown', onKey, true);
  root.render(
    <div className="nc-set-dialog-layer" role="presentation">
      <div className="underlay" onMouseDown={close} />
      <div className="nc-set-subdialog" role="dialog" aria-modal="true">{render(close)}</div>
    </div>,
  );
  return close;
}

export function confirmDialog(opts: { title: string; description?: ReactNode; confirmLabel: string; danger?: boolean; requireText?: string; requireHint?: string }): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: boolean, close: () => void) => {
      if (done) return;
      done = true;
      close();
      resolve(v);
    };
    openSubDialog((close) => <ConfirmBody opts={opts} onDone={(v) => finish(v, close)} />);
  });
}

function ConfirmBody({ opts, onDone }: { opts: Parameters<typeof confirmDialog>[0]; onDone: (v: boolean) => void }) {
  const [v, setV] = useState('');
  const ok = !opts.requireText || v.trim() === opts.requireText.trim();
  return (
    <>
      <h3>{opts.title}</h3>
      {opts.description && <div className="desc">{opts.description}</div>}
      {opts.requireText !== undefined && (
        <div>
          {opts.requireHint && <label className="nc-set-label">{opts.requireHint}</label>}
          <div className="nc-set-input"><input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={opts.requireText} /></div>
        </div>
      )}
      <div className="actions">
        <Button variant={opts.danger ? 'danger' : 'primary'} disabled={!ok} onClick={() => onDone(true)}>{opts.confirmLabel}</Button>
        <Button onClick={() => onDone(false)}>{t('lp.settings.cancel', 'Cancel')}</Button>
      </div>
    </>
  );
}

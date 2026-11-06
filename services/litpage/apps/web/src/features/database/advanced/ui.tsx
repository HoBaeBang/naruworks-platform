// Small UI pieces shared by the advanced panels, styled with the global menu classes (components/menu.css) so they
// sit naturally inside the database core's "Edit property" flyout.
import type { ReactNode } from 'react';
import { Icon } from '../../../components/Icon.tsx';

export function ConfigRow({ icon, label, value, chevron = true, disabled, tooltip, onClick, children }: {
  icon?: string | ReactNode; label: ReactNode; value?: ReactNode; chevron?: boolean; disabled?: boolean; tooltip?: string; onClick?: (e: React.MouseEvent<HTMLDivElement>) => void; children?: ReactNode;
}) {
  return (
    <div
      role="menuitem"
      aria-disabled={disabled || undefined}
      className={`nc-menu-item nc-fly-row ${disabled ? 'disabled' : ''}`}
      data-tooltip={tooltip}
      onClick={disabled ? undefined : onClick}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="nc-menu-item-inner">
        {icon !== undefined && <div className="nc-menu-icon">{typeof icon === 'string' ? <Icon name={icon} size={20} /> : icon}</div>}
        <div className="nc-menu-label">{label}</div>
        {value !== undefined && <span className="nc-menu-value nc-adv-value">{value}</span>}
        {children}
        {chevron && <Icon name="arrowChevronSingleRightSmall" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <span role="switch" aria-checked={on} aria-label={label} className={`nc-adv-toggle ${on ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); onChange(!on); }}>
      <span />
    </span>
  );
}

/** Number / Bar / Ring picker used by number formulas and rollups ("Show as"). */
export function ShowAsPicker({ value, onChange }: { value: string; onChange: (v: 'number' | 'bar' | 'ring') => void }) {
  return (
    <div className="nc-rollup-showas">
      <div role="button" className={`opt ${value === 'number' ? 'on' : ''}`} onClick={() => onChange('number')}><b>42</b>Number</div>
      <div role="button" className={`opt ${value === 'bar' ? 'on' : ''}`} onClick={() => onChange('bar')}><span className="bar"><span /></span>Bar</div>
      <div role="button" className={`opt ${value === 'ring' ? 'on' : ''}`} onClick={() => onChange('ring')}>
        <svg width={16} height={16} viewBox="0 0 20 20" aria-hidden><circle cx={10} cy={10} r={7} fill="none" stroke="var(--lp-border-primary)" strokeWidth={3} /><circle cx={10} cy={10} r={7} fill="none" stroke="var(--lp-icon-secondary)" strokeWidth={3} strokeDasharray="22 44" transform="rotate(-90 10 10)" /></svg>Ring
      </div>
    </div>
  );
}

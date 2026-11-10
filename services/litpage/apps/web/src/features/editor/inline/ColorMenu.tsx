// Text/background color menu opened text action menu's "A" button.
// dialog 190px (min 180), sections "Recently used" / "Text color" /
// "Background color", 5-column grids (gap 4, padding-inline 8), 30px cells with a 26x26 r6 swatch (16px/500 "A").
import { useEffect, useState } from 'react';
import { COLOR_NAMES } from '@nc/shared/colors.ts';
import { openOverlay } from '../../../components/overlay.tsx';
import { colorsOf, recentColors, setColorRange, valueOf, type TextRange } from './format.ts';
import { colorToken } from '../../../lib/colorToken.ts';

const TOK: Record<string, string> = { default: 'gra', gray: 'gra', brown: 'bro', orange: 'ora', yellow: 'yel', green: 'gre', blue: 'blu', purple: 'pur', pink: 'pin', red: 'red' };

export function openColorMenu(anchor: HTMLElement, r: TextRange, onClose?: () => void) {
  return openOverlay((close) => <ColorMenu r={r} close={close} />, { anchor, placement: 'bottom-start', offset: 4, onClose });
}

export function Swatch({ color, selected }: { color: string; selected?: boolean }) {
  const bg = color.endsWith('_background');
  const base = color.replace('_background', '');
  const t = TOK[base] ?? 'gra';
  const style: React.CSSProperties = bg
    ? { background: base === 'default' ? 'transparent' : `var(${colorToken(t, 'bg-secondary')})`, boxShadow: selected ? 'inset 0 0 0 2px var(--lp-text-primary)' : `inset 0 0 0 1px var(${colorToken(t, 'border-primary-transparent')})` }
    : { color: base === 'default' ? 'inherit' : `var(${colorToken(t, 'text-secondary')})`, fill: base === 'default' ? 'inherit' : `var(${colorToken(t, 'text-secondary')})`, boxShadow: selected ? 'inset 0 0 0 2px var(--lp-text-primary)' : `inset 0 0 0 1px var(${colorToken(t, 'border-primary-transparent')})` };
  return <div aria-hidden className="nc-color-cell-swatch" style={style}>{bg ? '' : 'A'}</div>;
}

function ColorMenu({ r, close }: { r: TextRange; close: () => void }) {
  const cur = colorsOf(valueOf(r.blockId, r.property), r.start, r.end);
  const recent = recentColors();
  const textColors = COLOR_NAMES.map((c) => c);
  const bgColors = COLOR_NAMES.map((c) => `${c}_background`);
  const all = [...recent, ...textColors, ...bgColors];
  const [active, setActive] = useState(-1);
  const pick = (c: string) => {
    close();
    setColorRange(r, c);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? 5 : e.key === 'ArrowUp' ? -5 : 0;
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.max(0, Math.min(all.length - 1, (a < 0 ? 0 : a + dir))));
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        e.stopPropagation();
        pick(all[active]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  const isSel = (c: string) => {
    if (c.endsWith('_background')) return (cur.bg ?? 'default') === c.replace('_background', '');
    return (cur.text ?? 'default') === c;
  };
  let idx = -1;
  const grid = (colors: string[], markSelected: boolean) => (
    <div className="nc-color-grid">
      {colors.map((c) => {
        idx++;
        const i = idx;
        return (
          <div key={c + i} className="nc-color-cell">
            <div role="menuitem" tabIndex={-1} className={`nc-color-cell-btn ${active === i ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setActive(i)} onClick={() => pick(c)}>
              <Swatch color={c} selected={markSelected && isSel(c)} />
            </div>
          </div>
        );
      })}
    </div>
  );
  return (
    <div role="dialog" className="nc-popover nc-color-menu" style={{ width: 190, minWidth: 180 }}>
      <div className="lit-scroller vertical" role="menu">
        {recent.length > 0 && (
          <div className="nc-color-section">
            <div className="nc-menu-section-title">Recently used</div>
            {grid(recent, false)}
          </div>
        )}
        <div className="nc-color-section">
          <div className="nc-menu-section-title">Text color</div>
          {grid(textColors, true)}
        </div>
        <div className="nc-color-section">
          <div className="nc-menu-section-title">Background color</div>
          {grid(bgColors, true)}
        </div>
      </div>
    </div>
  );
}

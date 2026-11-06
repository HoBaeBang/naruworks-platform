// Global hover tooltips: any element with data-tooltip="Text" (optional data-tooltip-sub="⌘K") shows a

import { useEffect, useState } from 'react';
import './tooltip.css';

interface Tip {
  text: string;
  sub?: string;
  rect: DOMRect;
  side: 'bottom' | 'top' | 'right' | 'right-start';
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      const text = el.getAttribute('data-tooltip');
      if (!text) return;
      setTip({ text, sub: el.getAttribute('data-tooltip-sub') ?? undefined, rect: el.getBoundingClientRect(), side: (el.getAttribute('data-tooltip-side') as Tip['side']) ?? 'bottom' });
    };
    const over = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest?.('[data-tooltip]') as HTMLElement | null;
      if (el === current) return;
      current = el;
      if (timer) clearTimeout(timer);
      setTip(null);
      if (el) timer = setTimeout(() => show(el), 500);
    };
    const hide = () => {
      if (timer) clearTimeout(timer);
      current = null;
      setTip(null);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mousedown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mousedown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);
  if (!tip) return null;
  const style: React.CSSProperties =
    tip.side === 'right'
      ? { left: tip.rect.right + 6, top: tip.rect.top + tip.rect.height / 2, transform: 'translateY(-50%)' }
      : tip.side === 'right-start' 
      ? { left: tip.rect.right + 6, top: tip.rect.top }
      : tip.side === 'top'
        ? { left: tip.rect.left + tip.rect.width / 2, top: tip.rect.top - 6, transform: 'translate(-50%, -100%)' }
        : { left: tip.rect.left + tip.rect.width / 2, top: tip.rect.bottom + 6, transform: 'translateX(-50%)' };
  return (
    <div
      className="nc-tooltip"
      style={style}
      role="tooltip"
      ref={(el) => {
        // keep the tooltip inside the viewport (e.g. buttons at the window's left edge)
        if (!el) return;
        const r = el.getBoundingClientRect();
        const m = 4;
        if (r.left < m) el.style.left = `${parseFloat(el.style.left) + (m - r.left)}px`;
        else if (r.right > window.innerWidth - m) el.style.left = `${parseFloat(el.style.left) - (r.right - window.innerWidth + m)}px`;
      }}
    >
      <div>{tip.text}</div>
      {tip.sub && <div className="nc-tooltip-sub">{tip.sub}</div>}
    </div>
  );
}

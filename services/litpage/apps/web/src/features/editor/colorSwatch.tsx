import { colorToken } from '../../lib/colorToken.ts';
// Color swatch: 26×26, radius 6, 16px/500 “A”, and a 1px inset border in the
// color's own border token; text colors tint the "A", background colors fill the box. Used by the block menu's Color
// submenu and the slash menu's Text color / Background color rows.
const COLOR_TOKEN: Record<string, string> = { default: 'gra', gray: 'gra', brown: 'bro', orange: 'ora', yellow: 'yel', green: 'gre', blue: 'blu', purple: 'pur', pink: 'pin', red: 'red' };

export function ColorSwatch({ color }: { color: string }) {
  const bg = color.endsWith('_background');
  const base = color.replace('_background', '');
  const t = COLOR_TOKEN[base] ?? 'gra';
  const style: React.CSSProperties = { boxShadow: `inset 0 0 0 1px var(${colorToken(base === 'default' ? 'gra' : t, 'border-primary-transparent')})` };
  if (bg) { if (base !== 'default') style.background = `var(${colorToken(t, 'bg-secondary')})`; }
  else if (base !== 'default') { style.color = `var(${colorToken(t, 'text-secondary')})`; style.fill = `var(${colorToken(t, 'text-secondary')})`; }
  return <div aria-hidden className="nc-color-swatch-26" style={style}>{bg ? '' : 'A'}</div>;
}

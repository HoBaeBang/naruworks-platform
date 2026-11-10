// Per-color design tokens (`--lp-<color>-<role>` in styles/tokens.css) for colors chosen at runtime.

const COLORS: Record<string, string> = {
  gra: 'gray', bro: 'brown', ora: 'orange', yel: 'yellow', gre: 'green',
  blu: 'blue', pur: 'purple', pin: 'pink', red: 'red',
};

/** Custom property name for a block or select-option color ("blue", "blue_background", or a short color key) and a role such as
 * "text-secondary"; unknown colors (default, lightgray) use gray. */
export function colorToken(color: string | undefined, role: string): string {
  return `--lp-${COLORS[(color ?? '').slice(0, 3)] ?? 'gray'}-${role}`;
}

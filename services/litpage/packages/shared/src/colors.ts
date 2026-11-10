// Litpage's 10 named colors used for text, backgrounds, select options and blocks.
export const COLOR_NAMES = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

export const COLOR_LABELS: Record<ColorName, string> = {
  default: 'Default', gray: 'Gray', brown: 'Brown', orange: 'Orange', yellow: 'Yellow',
  green: 'Green', blue: 'Blue', purple: 'Purple', pink: 'Pink', red: 'Red',
};

/** Block/text color value: "red" (text) or "red_background" (background). */
export function isBackgroundColor(c: string | undefined): boolean {
  return !!c && c.endsWith('_background');
}

export function baseColor(c: string | undefined): ColorName {
  const b = (c ?? 'default').replace(/_background$/, '') as ColorName;
  return (COLOR_NAMES as readonly string[]).includes(b) ? b : 'default';
}

export const SELECT_COLORS: ColorName[] = ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'];

export function randomSelectColor(seed?: number): ColorName {
  const palette = SELECT_COLORS.slice(1);
  const i = seed !== undefined ? Math.abs(seed) % palette.length : Math.floor(Math.random() * palette.length);
  return palette[i];
}

// Per-user, per-device editor preferences stored in localStorage, keyed
// by the signed-in user. Holds the sticky defaults remembered on a device:
// calloutBlockIcon ("" = no icon) / calloutBlockBackground — written when the user changes a callout's icon/color
// QuoteBlockDefaultSize — written when the user picks Quote size
// CodeBlockDefaultLanguage / CodeBlockDefaultCodeWrap — written when the user changes a code block's language/wrap
// recentlyUsedHighlightColors — block/text colors (block menu "Last used", color menu "Recently used", ⌘⇧H)
// frequentlyUsedSlashMenuActions — slash menu item id → use count (the "Suggested" section)
import { useSession } from '../../lib/store/session.ts';

function key(name: string): string {
  return `nc:pref:${useSession.getState().userId ?? 'anonymous'}:${name}`;
}

export function getPref<T>(name: string): T | undefined {
  try {
    const raw = localStorage.getItem(key(name));
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

export function setPref(name: string, value: unknown): void {
  try {
    if (value === undefined) localStorage.removeItem(key(name));
    else localStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* storage unavailable (private mode, quota) */
  }
}

export const PREF = {
  calloutIcon: 'calloutBlockIcon',
  calloutColor: 'calloutBlockBackground',
  quoteSize: 'QuoteBlockDefaultSize',
  codeLanguage: 'CodeBlockDefaultLanguage',
  codeWrap: 'CodeBlockDefaultCodeWrap',
  recentColors: 'recentlyUsedHighlightColors',
  slashFrequent: 'frequentlyUsedSlashMenuActions',
} as const;

/** Sticky defaults for a block type created now (callout / quote / code / table of contents). */
export function stickyFormat(type: string): { format?: Record<string, unknown>; properties?: Record<string, unknown> } {
  if (type === 'callout') {
    const icon = getPref<string>(PREF.calloutIcon);
    const color = getPref<string>(PREF.calloutColor);
    return { format: { page_icon: icon === undefined ? '💡' : icon, block_color: color ?? 'gray_background' } };
  }
  if (type === 'quote') {
    const size = getPref<string>(PREF.quoteSize);
    return size === 'large' ? { format: { quote_size: 'large' } } : {};
  }
  if (type === 'code') {
    const lang = getPref<string>(PREF.codeLanguage);
    const wrap = getPref<boolean>(PREF.codeWrap);
    return { format: wrap === undefined ? undefined : { code_wrap: wrap }, properties: lang ? { language: [[lang]] } : undefined };
  }
  if (type === 'table_of_contents') return { format: { block_color: 'gray' } };
  return {};
}

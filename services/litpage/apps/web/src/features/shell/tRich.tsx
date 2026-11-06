// Rich shell messages use t() with <bold>, <b>, and <regular> tags rendered as React nodes.
import type { ReactNode } from 'react';
import { tParts } from './i18n.ts';

type Values = Record<string, string | number>;

const DEFAULT_TAGS: Record<string, (text: string, key: number) => ReactNode> = {
  b: (text, key) => <b key={key}>{text}</b>,
  bold: (text, key) => <b key={key}>{text}</b>,
  regular: (text, key) => <span key={key} style={{ fontWeight: 400 }}>{text}</span>,
};

export function tRich(id: string, defaultMessage: string, values?: Values, tags?: Record<string, (text: string, key: number) => ReactNode>): ReactNode[] {
  return tParts(id, defaultMessage, values).map((p, i) => {
    if (!p.tag) return p.text;
    const fn = tags?.[p.tag] ?? DEFAULT_TAGS[p.tag];
    return fn ? fn(p.text, i) : p.text;
  });
}

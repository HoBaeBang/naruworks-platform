// Database search (toolbar 🔍) highlights the matched text in titles: rgba(120, 53, 15, 0.4), radius 4 (05-database-survey).
import type { ReactNode } from 'react';
import type { RichText } from '@nc/shared/richtext.ts';
import { RichTextView } from '../properties/RichTextView.tsx';

export function highlightText(text: string, query: string | undefined): ReactNode {
  const q = query?.trim();
  if (!q) return text;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  for (;;) {
    const at = lower.indexOf(needle, i);
    if (at < 0) break;
    if (at > i) out.push(text.slice(i, at));
    out.push(<span key={k++} className="nc-search-hit">{text.slice(at, at + needle.length)}</span>);
    i = at + needle.length;
  }
  if (!out.length) return text;
  if (i < text.length) out.push(text.slice(i));
  return out;
}

/** Title rich text, or its plain text with search hits highlighted while a search is active. */
export function TitleText({ title, search }: { title: RichText; search?: string }) {
  if (search?.trim()) return <>{highlightText(title.map((d) => d[0]).join(''), search)}</>;
  return <RichTextView value={title} />;
}

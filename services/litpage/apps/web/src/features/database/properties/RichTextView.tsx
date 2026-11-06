// Read-only rich text (text property values, card titles) rendered with the editor's decoration renderer
// so mentions / links / annotations look the same as in blocks.
import { useLayoutEffect, useRef } from 'react';
import type { RichText } from '@nc/shared/richtext.ts';
import { renderRichText } from '../../editor/richTextDom.ts';

export function RichTextView({ value, className, placeholder }: { value: RichText | undefined; className?: string; placeholder?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (ref.current) renderRichText(ref.current, value ?? []);
  }, [value]);
  return <span ref={ref} className={className} data-placeholder={placeholder} />;
}

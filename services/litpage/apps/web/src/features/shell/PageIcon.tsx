// Renders a page/record icon as stored in format.page_icon:
// emoji string, "lit-icon:<name>:<color>" (icon set) or an uploaded/external image URL.
import type { BlockRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { colorToken } from '../../lib/colorToken.ts';

export function iconOf(block: BlockRecord | undefined): string | undefined {
  return (block?.format?.page_icon as string | undefined) || undefined;
}

export function PageIcon({ block, icon, size = 20, fallback = 'page', className }: { block?: BlockRecord; icon?: string; size?: number; fallback?: string | null; className?: string }) {
  const value = icon ?? iconOf(block);
  const isDb = block?.type === 'collection_view_page' || block?.type === 'collection_view';
  if (!value) {
    if (!fallback) return null;
    return (
      <div className={`lit-record-icon notranslate ${className ?? ''}`} style={{ width: size, height: size }}>
        <Icon name={isDb ? 'viewTable' : fallback} size={Math.round(size * 0.9)} style={{ color: 'var(--lp-sidebar-secondary-color, #818cf8)' }} />
      </div>
    );
  }
  if (value.startsWith('lit-icon:')) {
    const [, name, color] = value.split(':');
    return (
      <div className={`lit-record-icon notranslate ${className ?? ''}`} style={{ width: size, height: size }}>
        <Icon name={name} size={Math.round(size * 0.9)} style={{ color: color ? `var(${colorToken(color.slice(0, 3), 'text-accent')}, ${color})` : 'var(--lp-icon-secondary)' }} />
      </div>
    );
  }
  if (/^(https?:|\/files\/|data:)/.test(value)) {
    return (
      <div className={`lit-record-icon notranslate ${className ?? ''}`} style={{ width: size, height: size }}>
        <img src={value} alt="" style={{ width: size, height: size, objectFit: 'cover', borderRadius: size >= 40 ? 6 : 3 }} />
      </div>
    );
  }
  return (
    <div className={`lit-record-icon notranslate ${className ?? ''}`} style={{ width: size, height: size }}>
      <span role="img" style={{ fontSize: size * 0.9, lineHeight: 1, fontFamily: '"Apple Color Emoji", "Segoe UI Emoji", NotoColorEmoji, "Noto Color Emoji", "Segoe UI Symbol", "Android Emoji", EmojiSymbols' }}>
        {value}
      </span>
    </div>
  );
}

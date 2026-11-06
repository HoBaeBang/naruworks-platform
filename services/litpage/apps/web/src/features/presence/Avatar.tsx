// User avatar (letter or photo): 100% radius, 1px --lp-border-secondary-transparent inner outline, letter on
// --lp-popover-background in --lp-icon-secondary.
import type { CSSProperties } from 'react';
import type { UserRecord } from '@nc/shared/records.ts';
import { useUser } from '../../lib/hooks.ts';
import { colorToken } from '../../lib/colorToken.ts';

export function userName(u: UserRecord | undefined | null): string {
  return u?.name || u?.email || 'Unknown user';
}

/** Deterministic presence color (cursor, selection, avatar ring) for a user/client. */
const PRESENCE_COLORS = ['blu', 'gre', 'pur', 'pin', 'ora', 'red', 'yel', 'bro'];
export function presenceColor(id: string | undefined | null): string {
  let h = 0;
  for (const ch of id ?? '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `var(${colorToken(PRESENCE_COLORS[h % PRESENCE_COLORS.length], 'text-accent')})`;
}

export function UserAvatar({ userId, size = 24, faded, ring, title, style }: { userId: string | null | undefined; size?: number; faded?: boolean; ring?: string; title?: string; style?: CSSProperties }) {
  const u = useUser(userId);
  const name = userName(u);
  const letter = (u?.name || u?.email || '?').trim().slice(0, 1).toUpperCase();
  const fontSize = size >= 32 ? 14 : size >= 28 ? 12 : 11;
  return (
    <div
      className="nc-user-avatar"
      title={title}
      aria-label={name}
      style={{
        width: size, height: size, borderRadius: '100%', flexShrink: 0, position: 'relative', background: 'var(--lp-bg-primary)',
        outline: ring ? `1.5px solid ${ring}` : '1px solid var(--lp-border-secondary-transparent)', outlineOffset: ring ? -0.5 : -1, ...style,
      }}
    >
      {u?.profile_photo ? (
        <img src={u.profile_photo} alt="" style={{ display: 'block', width: size, height: size, borderRadius: '100%', objectFit: 'cover', opacity: faded ? 0.3 : 1 }} />
      ) : (
        <div
          style={{
            boxSizing: 'content-box', borderRadius: '100%', lineHeight: `${size}px`, width: size, height: size, overflow: 'hidden', textAlign: 'center',
            fontSize, background: 'var(--lp-popover-background)', userSelect: 'none', color: ring ?? 'var(--lp-icon-secondary)', opacity: faded ? 0.3 : 1,
          }}
        >
          {letter}
        </div>
      )}
    </div>
  );
}

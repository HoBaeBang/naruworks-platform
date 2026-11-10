

import type { TeamRecord } from '@nc/shared/records.ts';
import { Icon } from '../../../components/Icon.tsx';

const TINTS = ['rgba(251, 146, 60, 0.13)', 'rgba(129, 140, 248, 0.13)', 'rgba(15,123,108,.13)', 'rgba(167, 139, 250, 0.13)', 'rgba(212,76,71,.13)', 'rgba(251, 191, 36, 0.13)'];

function tintFor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function TeamIcon({ team, size = 20 }: { team: Pick<TeamRecord, 'id' | 'name' | 'icon'> | undefined; size?: number }) {
  const icon = team?.icon;
  const bg = team ? (team.icon === '🏠' ? TINTS[0] : tintFor(team.id)) : TINTS[0];
  const style = { width: size, height: size, borderRadius: '0.25em', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 500 } as const;
  if (icon && /^(https?:|\/files\/|data:)/.test(icon)) {
    return (
      <div className="lit-record-icon notranslate" style={style}>
        <img src={icon} alt="" style={{ width: size * 0.78, height: size * 0.78, borderRadius: 4, objectFit: 'cover' }} />
      </div>
    );
  }
  if (icon && icon.startsWith('lit-icon:')) {
    const [, name] = icon.split(':');
    return (
      <div className="lit-record-icon notranslate" style={style}>
        <Icon name={name} size={Math.round(size * 0.78)} style={{ color: 'var(--lp-orange-icon-accent, #fb923c)' }} />
      </div>
    );
  }
  if (icon) {
    return (
      <div className="lit-record-icon notranslate" style={style}>
        <span style={{ fontSize: size * 0.72, lineHeight: 1, fontFamily: '"Apple Color Emoji","Segoe UI Emoji",NotoColorEmoji,"Noto Color Emoji"' }}>{icon}</span>
      </div>
    );
  }
  return (
    <div className="lit-record-icon notranslate" style={{ ...style, background: 'var(--lp-gray-bg-secondary)', color: 'var(--lp-text-secondary)', fontSize: size * 0.6 }}>
      {(team?.name ?? 'T').slice(0, 1).toUpperCase()}
    </div>
  );
}

// Topbar presence facepile: 22px avatars overlapping by 6px
// (row-reverse), idle collaborators faded (opacity .3, --lp-avatar-idle-outline outline), people viewing now
// ringed in --lp-border-accent, then "+N". Hover: name + "Viewing now"; click a viewer → jump to their block.
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { useBlock, useRecord, useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { getBlock } from '../../lib/blocks.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { shareStateOf } from '../page/ShareMenu.tsx';
import { usePageViewers, type PresenceData } from './presence.ts';
import { userName } from './Avatar.tsx';
import './presence.css';

const MAX = 5;

function collaborators(page: BlockRecord | undefined): string[] {
  if (!page) return [];
  const ids = new Set<string>();
  let cur: BlockRecord | undefined = page;
  for (let i = 0; i < 40 && cur; i++) {
    for (const p of cur.permissions ?? []) if (p.type === 'user_permission' && p.user_id && p.role !== 'none') ids.add(p.user_id);
    if (cur.parent_table === 'block') cur = getBlock(cur.parent_id);
    else if (cur.parent_table === 'collection') cur = getBlock((records.get('collection', cur.parent_id) as any)?.parent_id);
    else break;
  }
  const state = shareStateOf(page);
  if (state === 'workspace' || state === 'public' || state === 'published') {
    const space = records.get<SpaceRecord>('space', page.space_id);
    for (const p of space?.permissions ?? []) if (p.user_id && p.role !== 'none') ids.add(p.user_id);
  }
  return [...ids];
}

export function TopbarFacepile({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  useTableVersion(['lit_user', 'space']);
  const viewers = usePageViewers(pageId);
  const me = useSession((s) => s.userId);
  const viewing = [...new Set(viewers.map((v) => v.userId))];
  const others = collaborators(page).filter((id) => !viewing.includes(id));
  // the current user first, then other viewers, then idle collaborators
  const order = [...viewing.sort((a, b) => (a === me ? -1 : b === me ? 1 : 0)), ...others];
  const showPile = viewing.some((id) => id !== me) || order.length > 1;
  if (!showPile) return null;
  const shown = order.slice(0, MAX);
  const extra = order.length - shown.length;
  const jump = (userId: string) => {
    const v = viewers.find((x) => x.userId === userId && (x.data as PresenceData | null)?.blockId);
    const id = (v?.data as PresenceData | undefined)?.blockId;
    if (id) document.querySelector(`.lit-page-content [data-block-id="${CSS.escape(id)}"], .nc-page-title[data-block-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return (
    <div className="nc-facepile" aria-label="People on this page">
      {extra > 0 && (
        <div role="button" className="nc-facepile-more" data-tooltip={t('lp.presence.viewers', 'Viewers')}>
          {t('lp.presence.hiddenuserscount_plural_one_other', '{hiddenUsersCount, plural, one {+{hiddenUsersCount}} other {+{hiddenUsersCount}}}', { hiddenUsersCount: extra })}
        </div>
      )}
      {shown.slice().reverse().map((id) => (
        <FaceAvatar key={id} userId={id} active={viewing.includes(id)} onClick={() => jump(id)} />
      ))}
    </div>
  );
}

function FaceAvatar({ userId, active, onClick }: { userId: string; active: boolean; onClick: () => void }) {
  const u = useRecord<UserRecord>('lit_user', userId);
  const name = userName(u);
  const letter = (u?.name || u?.email || '?').trim().slice(0, 1).toUpperCase();
  return (
    <div
      role="button"
      className={`nc-face ${active ? 'active' : 'idle'}`}
      data-user-id={userId}
      data-tooltip={name}
      data-tooltip-sub={active ? t('lp.presence.viewing_now', 'Viewing now') : undefined}
      onClick={onClick}
    >
      <div className="nc-face-inner">
        {u?.profile_photo ? <img src={u.profile_photo} alt={name} /> : <div className="letter">{letter}</div>}
      </div>
    </div>
  );
}

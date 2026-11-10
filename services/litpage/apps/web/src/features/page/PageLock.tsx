// Page lock UX: ••• → Lock page makes the page read-only for everyone; the topbar shows a
// "Locked" button → "Unlock for me" (temporary, this session) / "Unlock for everyone"; while unlocked for
// me, "Re-lock" restores it. Tooltip: "Locked by {person} to prevent accidental editing. Click to unlock".
import { create } from 'zustand';
import type { UserRecord } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { run, setFormat } from '../../lib/blocks.ts';
import { useBlock, useRecord, useRole } from '../../lib/hooks.ts';
import { userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';

export const useLockOverride = create<{ unlocked: Record<string, boolean>; set: (pageId: string, v: boolean) => void }>((set, get) => ({
  unlocked: {},
  set: (pageId, v) => set({ unlocked: { ...get().unlocked, [pageId]: v } }),
}));

/** True when the page is locked and the current user hasn't unlocked it for themselves. */
export function useEffectiveLock(pageId: string): boolean {
  const page = useBlock(pageId);
  const unlocked = useLockOverride((s) => !!s.unlocked[pageId]);
  return !!page?.format?.block_locked && !unlocked;
}

export function PageLockIndicator({ pageId }: { pageId: string }) {
  const page = useBlock(pageId);
  const role = useRole('block', pageId);
  const unlocked = useLockOverride((s) => !!s.unlocked[pageId]);
  const locker = useRecord<UserRecord>('lit_user', (page?.format as any)?.block_locked_by ?? page?.last_edited_by_id);
  if (!page?.format?.block_locked) return null;
  const canUnlock = roleAtLeast(role, 'read_and_write');
  if (unlocked) {
    return (
      <div role="button" className="nc-crumb nc-lock-indicator" onClick={() => useLockOverride.getState().set(pageId, false)}>
        <Icon name="lockOpen" size={14} style={{ color: 'var(--lp-icon-tertiary)' }} />
        <span>{t('lp.page.re_lock', 'Re-lock')}</span>
      </div>
    );
  }
  return (
    <div
      role="button"
      className="nc-crumb nc-lock-indicator"
      aria-label={t('lp.page.locked', 'Locked')}
      data-tooltip={`Locked by ${userName(locker)} to prevent accidental editing.`}
      data-tooltip-sub={canUnlock ? 'Click to unlock' : undefined}
      onClick={(e) => canUnlock && openMenu(e.currentTarget, {
        width: 220,
        // a locked database is enforced by the server (views/properties), so there is no "Unlock for me" for it
        sections: [{ items: page.type === 'collection_view_page' || page.type === 'collection_view' ? [
          { label: t('lp.page.unlock_database', 'Unlock database'), icon: 'unlock', onSelect: () => run('unlockDatabase', (tx) => setFormat(tx, pageId, { block_locked: false, block_locked_by: null } as any)) },
        ] : [
          { label: t('lp.page.unlock_my_access', 'Unlock my access'), icon: 'lockOpen', onSelect: () => useLockOverride.getState().set(pageId, true) },
          { label: t('lp.page.unlock_for_all_users', 'Unlock for all users'), icon: 'unlock', onSelect: () => run('unlockPage', (tx) => setFormat(tx, pageId, { block_locked: false, block_locked_by: null } as any)) },
        ] }],
      }, { placement: 'bottom-start' })}
    >
      <Icon name="lock" size={14} style={{ color: 'var(--lp-icon-tertiary)' }} />
      <span>{t('lp.page.locked', 'Locked')}</span>
    </div>
  );
}

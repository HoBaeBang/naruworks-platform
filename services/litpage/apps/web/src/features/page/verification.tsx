// Page verification, client side. Writes go through the server (`setPageVerification`,
// `setPageOwners` in api/modules/wiki.ts), which enforces owners, plan and archive rules and schedules the expiry notice.
//   Header control "Add verification" → "Verify page" menu: For 7 / 30 / 90 days (Until …), Indefinitely, Pick a date.
//   Verified pages show a pill under the title ("Verified" / "Until {date}" / "Expired {time}"); clicking it opens the
//   summary popover (Verified by … on/from …, Owners, Reverify page, Remove verification).
//   Database Verification cells (wikis) open the same UI through the cell-editor registry.
import { useState } from 'react';
import { BadgeCheck } from 'lucide-react';
import type { BlockRecord, CollectionRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { readVerification, VERIFICATION_PRESETS, encodePeople, type VerificationInfo } from '@nc/shared/verification.ts';
import { roleAtLeast, isSpaceAdmin } from '@nc/shared/permissions.ts';
import { api } from '../../lib/api.ts';
import { getBlock, me, run } from '../../lib/blocks.ts';
import { useRecord, useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { registerCellEditor } from '../database/properties/editorRegistry.ts';
import { t } from '../shell/i18n.ts';
import { archiveState } from './archive.tsx';

function collectionOf(page: BlockRecord | undefined): CollectionRecord | undefined {
  return page?.parent_table === 'collection' ? records.get<CollectionRecord>('collection', page.parent_id) : undefined;
}

export function verificationOf(pageId: string | undefined | null): VerificationInfo {
  const page = getBlock(pageId ?? undefined);
  return readVerification(page, collectionOf(page));
}

/** Live verification of a page (re-renders on block / collection changes and when it expires on screen). */
export function usePageVerification(pageId: string | undefined | null): VerificationInfo {
  useTableVersion(['block', 'collection']);
  return verificationOf(pageId);
}

function isWiki(c: CollectionRecord | undefined): boolean {
  return !!(c?.format as Record<string, unknown> | undefined)?.is_wiki;
}

/** Whether the current user may verify `pageId` now, and the tooltip explaining why not. */
export function verifyAccess(pageId: string): { ok: boolean; reason?: string } {
  const page = getBlock(pageId);
  if (!page) return { ok: false };
  if (!roleAtLeast(records.role('block', pageId), 'read_and_write')) return { ok: false, reason: t('lp.page.verification_is_limited_to_page_owners', 'Verification is limited to page owners') };
  if (archiveState(pageId)) return { ok: false, reason: t('lp.page.unarchive_this_page_before_verifying_it', 'Unarchive this page before verifying it') };
  const space = records.get<SpaceRecord>('space', page.space_id);
  const col = collectionOf(page);
  if (!isWiki(col) && space?.plan_type !== 'business' && space?.plan_type !== 'enterprise') {
    return { ok: false, reason: t('lp.page.upgrade_your_plan_to_edit_verification', 'Upgrade your plan to edit verification settings') };
  }
  const info = readVerification(page, col);
  if (info.owners.length && !info.owners.includes(me()) && !isSpaceAdmin(space, me())) {
    const ownerProp = info.ownerPropertyId ? (col?.schema[info.ownerPropertyId]?.name as string | undefined) : undefined;
    return { ok: false, reason: ownerProp ? t('lp.page.verification_is_limited_to_people_listed', 'Verification is limited to people listed in {verifierPropertyName}', { verifierPropertyName: ownerProp }) : t('lp.page.verification_is_limited_to_page_owners', 'Verification is limited to page owners') };
  }
  return { ok: true };
}

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

function fromNow(ms: number): string {
  const d = Date.now() - ms;
  const day = 86400_000;
  if (d < 60_000) return 'just now';
  if (d < 3600_000) return `${Math.round(d / 60_000)} minutes ago`;
  if (d < day) return `${Math.round(d / 3600_000)} hours ago`;
  const n = Math.round(d / day);
  return n === 1 ? '1 day ago' : `${n} days ago`;
}

/** Blue check badge (verified) / gray (expired): a rosette with a check. */
export function VerifiedBadge({ size = 16, expired = false, title }: { size?: number; expired?: boolean; title?: string }) {
  const label = title ?? (expired ? t('lp.page.verification_expired', 'Verification expired') : t('lp.page.verified', 'Verified'));
  return (
    <span className={`nc-verified-badge ${expired ? 'expired' : ''}`} role="img" aria-label={label} data-tooltip={label}>
      <BadgeCheck size={size} aria-hidden fill="currentColor" />
    </span>
  );
}

async function verify(pageId: string, expiry: number | null) {
  try {
    const res = await api<{ recordMap: any }>('setPageVerification', { pageId, verified: true, expiry });
    records.mergeRecordMap(res.recordMap);
    useUI.getState().toast(expiry ? `Verified until ${fmtDate(expiry)}` : t('lp.page.verified', 'Verified'));
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? 'Could not verify this page');
  }
}

export async function removeVerification(pageId: string) {
  try {
    const res = await api<{ recordMap: any }>('setPageVerification', { pageId, verified: false });
    records.mergeRecordMap(res.recordMap);
    useUI.getState().toast('Verification removed');
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? 'Could not remove verification');
  }
}

function endOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

/** "Verify page" / "Reverify page": presets, Indefinitely, Pick a date. */
export function openVerifyMenu(anchor: Anchor, pageId: string, opts: { reverify?: boolean } = {}) {
  const access = verifyAccess(pageId);
  if (!access.ok) {
    useUI.getState().toast(access.reason ?? 'You can’t verify this page');
    return;
  }
  const items: MenuItemDef[] = VERIFICATION_PRESETS.map((days) => {
    const until = endOfDay(new Date(Date.now() + days * 86400_000));
    return {
      label: t('lp.page.for_days', 'For {numDays} days', { numDays: days }),
      description: t('lp.page.until', 'Until {date}', { date: fmtDate(until) }),
      onSelect: () => void verify(pageId, until),
    };
  });
  items.push({ label: t('lp.page.indefinitely', 'Indefinitely'), onSelect: () => void verify(pageId, null) });
  items.push({ label: t('lp.page.choose_a_date', 'Choose a date'), icon: 'calendar', onSelect: () => { setTimeout(() => openDatePick(anchor, pageId), 0); } });
  openMenu(anchor, {
    width: 260,
    sections: [{ title: opts.reverify ? t('lp.page.reverify_page', 'Reverify page') : t('lp.page.verify_page', 'Verify page'), items }],
  }, { placement: 'bottom-start' });
}

function openDatePick(anchor: Anchor, pageId: string) {
  openOverlay((close) => <DatePick pageId={pageId} close={close} />, { anchor, placement: 'bottom-start', offset: 4 });
}

function DatePick({ pageId, close }: { pageId: string; close: () => void }) {
  const min = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
  const [value, setValue] = useState(min);
  return (
    <PopoverSurface width={260} className="nc-verify-date">
      <div className="nc-verify-date-body">
        <label className="nc-verify-date-label" htmlFor="nc-verify-date">{t('lp.page.choose_a_date', 'Choose a date')}</label>
        <input id="nc-verify-date" type="date" className="nc-verify-date-input" min={min} value={value} onChange={(e) => setValue(e.target.value)} autoFocus />
        <button
          type="button"
          className="nc-dialog-btn primary"
          disabled={!value}
          onClick={() => {
            const [y, m, d] = value.split('-').map(Number);
            close();
            void verify(pageId, endOfDay(new Date(y, m - 1, d)));
          }}
        >
          {t('lp.page.verify_page', 'Verify page')}
        </button>
      </div>
    </PopoverSurface>
  );
}

/** Summary line of the verification popover. */
function summaryText(info: VerificationInfo): string {
  const user = userName(records.get<UserRecord>('lit_user', info.verifiedBy));
  const start = info.verifiedTime ? fmtDate(info.verifiedTime) : '';
  if (info.status === 'expired') return t('lp.page.last_verified_this_for', '{user} last verified this for {dateTimeRange}', { user, dateTimeRange: `${start} → ${info.expiryTime ? fmtDate(info.expiryTime) : ''}` });
  if (!info.expiryTime) return t('lp.page.verified_on_by', 'Verified on {date} by {user}', { user, date: start });
  return t('lp.page.verified_by_during', 'Verified by {user} during {dateTimeRange}', { user, dateTimeRange: `${start} → ${fmtDate(info.expiryTime)}` });
}

/** Pill under the title: "Verified" (indefinitely) / "Until {date}" / "Expired {time}". */
export function VerificationButtonLabel({ info }: { info: VerificationInfo }) {
  if (info.status === 'expired') return <>{t('lp.page.expired', 'Expired {timeFromMoment}', { timeFromMoment: fromNow(info.expiryTime ?? Date.now()) })}</>;
  if (info.expiryTime) return <>{t('lp.page.until', 'Until {date}', { date: fmtDate(info.expiryTime) })}</>;
  return <>{t('lp.page.verified', 'Verified')}</>;
}

/** Verification row for pages outside databases (database pages show it with their properties). */
export function PageVerification({ pageId, readOnly }: { pageId: string; readOnly?: boolean }) {
  const info = usePageVerification(pageId);
  const page = useRecord<BlockRecord>('block', pageId);
  if (!page || page.parent_table === 'collection' || info.status === 'none') return null;
  return (
    <div className="nc-page-verification">
      <div
        role="button"
        className={`nc-verification-pill ${info.status}`}
        aria-label={info.status === 'verified' ? t('lp.page.verified', 'Verified') : t('lp.page.verification_expired', 'Verification expired')}
        onClick={(e) => openVerificationPopover(e.currentTarget, pageId, readOnly)}
      >
        <VerifiedBadge size={16} expired={info.status === 'expired'} />
        <span><VerificationButtonLabel info={info} /></span>
      </div>
    </div>
  );
}

export function openVerificationPopover(anchor: Anchor, pageId: string, readOnly?: boolean) {
  openOverlay((close) => <VerificationPopover pageId={pageId} close={close} readOnly={readOnly} />, { anchor, placement: 'bottom-start', offset: 6 });
}

function VerificationPopover({ pageId, close, readOnly }: { pageId: string; close: () => void; readOnly?: boolean }) {
  const info = usePageVerification(pageId);
  const page = useRecord<BlockRecord>('block', pageId);
  const access = verifyAccess(pageId);
  const canEdit = !readOnly && roleAtLeast(records.role('block', pageId), 'read_and_write');
  if (!page) return null;
  const setOwners = async (ids: string[]) => {
    if (!ids.length && info.status !== 'none') {
      useUI.getState().toast(t('lp.page.add_at_least_one_owner_before', 'Add at least one owner before enabling verification.'));
      return;
    }
    if (info.source === 'property' && info.ownerPropertyId) {
      const prop = info.ownerPropertyId;
      run('setPageOwners', (tx) => tx.set('block', pageId, ['properties', prop], encodePeople(ids) ?? null));
      return;
    }
    try {
      const res = await api<{ recordMap: any }>('setPageOwners', { pageId, owners: ids });
      records.mergeRecordMap(res.recordMap);
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? 'Could not change owners');
    }
  };
  const addOwner = (anchor: HTMLElement) => {
    const space = records.get<SpaceRecord>('space', page.space_id);
    const members = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => records.get<UserRecord>('lit_user', p.user_id!)).filter((u): u is UserRecord => !!u && !info.owners.includes(u.id));
    const closeMenu = openMenu(anchor, {
      width: 260,
      search: 'Search for people…',
      sections: [{ items: members.map((u) => ({ label: userName(u), text: `${u.name ?? ''} ${u.email ?? ''}`, icon: <UserAvatar userId={u.id} size={20} />, onSelect: () => { void setOwners([...info.owners, u.id]); closeMenu(); return false; } })) }],
    }, { placement: 'bottom-start' });
  };
  return (
    <PopoverSurface width={300} className="nc-verification-popover">
      <div className="nc-verification-head">
        {info.status !== 'none' ? (
          <>
            <div className={`nc-verification-pill static ${info.status}`}>
              <VerifiedBadge size={16} expired={info.status === 'expired'} />
              <span><VerificationButtonLabel info={info} /></span>
            </div>
            <div className="nc-verification-summary">{summaryText(info)}</div>
          </>
        ) : (
          <div className="nc-verification-summary">{t('lp.page.this_page_isn_t_verified', 'This page isn’t verified')}</div>
        )}
      </div>
      <div className="nc-verification-section">
        <div className="nc-verification-section-title">{t('lp.page.owner', 'Owner')}</div>
        {info.owners.map((id) => (
          <div key={id} className="nc-verification-owner">
            <UserAvatar userId={id} size={20} />
            <span className="nc-ellipsis">{userName(records.get<UserRecord>('lit_user', id))}</span>
            {canEdit && (
              <span role="button" className="nc-icon-btn small" aria-label="Remove owner" onClick={() => void setOwners(info.owners.filter((x) => x !== id))}>
                <Icon name="close" size={12} />
              </span>
            )}
          </div>
        ))}
        {canEdit && (
          <div role="button" className="nc-verification-add-owner" onClick={(e) => addOwner(e.currentTarget)}>
            <Icon name="plus" size={14} />{t('lp.page.add_owner', 'Add owner')}
          </div>
        )}
      </div>
      {canEdit && (
        <div className="nc-verification-actions">
          <div
            role="button"
            className={`nc-menu-item-like ${access.ok ? '' : 'disabled'}`}
            data-tooltip={access.ok ? undefined : access.reason}
            onClick={(e) => { if (access.ok) openVerifyMenu(e.currentTarget, pageId, { reverify: info.status !== 'none' }); }}
          >
            <Icon name="verification" size={16} />
            <span>{info.status === 'none' ? t('lp.page.verify_page', 'Verify page') : t('lp.page.reverify_page', 'Reverify page')}</span>
            <Icon name="arrowChevronSingleRightSmall" size={14} style={{ marginLeft: 'auto', color: 'var(--lp-icon-tertiary)' }} />
          </div>
          {info.status !== 'none' && (
            <div
              role="button"
              className={`nc-menu-item-like ${access.ok ? '' : 'disabled'}`}
              data-tooltip={access.ok ? undefined : access.reason}
              onClick={() => { if (!access.ok) return; close(); void removeVerification(pageId); }}
            >
              <Icon name="close" size={16} />
              <span>{t('lp.page.remove_verification', 'Remove verification')}</span>
            </div>
          )}
        </div>
      )}
    </PopoverSurface>
  );
}

/** Header control (title hover): "Add verification". */
export function showAddVerification(page: BlockRecord): boolean {
  if (page.parent_table === 'collection' || page.type !== 'page') return false;
  if (readVerification(page).status !== 'none') return false;
  const space = records.get<SpaceRecord>('space', page.space_id);
  return space?.plan_type === 'business' || space?.plan_type === 'enterprise';
}

// Database cells of type Verification (wiki pages): the same popover / verify menu.
registerCellEditor('verification', (anchor, opts) => {
  const rowId = opts.rowIds[0];
  if (!rowId) return () => {};
  const info = verificationOf(rowId);
  if (info.status === 'none' && verifyAccess(rowId).ok) openVerifyMenu(anchor, rowId);
  else openVerificationPopover(anchor, rowId);
  return () => {};
});

// Settings › Verified pages: every verified page the viewer can open in this workspace — search, Owner
// filter, columns Page / Owner / Verified until ("Indefinitely", a date, or "Expired"), click to open the page.
// Data: getVerifiedPages (api/modules/wiki.ts). Mounted by the Settings section (settings/sections/features.tsx).
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BlockRecord, UserRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { openMenu } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { t } from '../shell/i18n.ts';
import { VerifiedBadge } from './verification.tsx';
import './page.css';

interface Row {
  pageId: string;
  title: string;
  status: 'verified' | 'expired';
  verifiedBy?: string;
  verifiedTime?: number;
  expiryTime?: number | null;
  owners: string[];
  wiki: boolean;
}

const fmt = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export function VerifiedPagesTable({ spaceId, onOpen, empty }: { spaceId: string; onOpen: (pageId: string) => void; empty: ReactNode }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    api<{ pages: Row[]; recordMap: any }>('getVerifiedPages', { spaceId })
      .then((r) => {
        if (!alive) return;
        records.mergeRecordMap(r.recordMap);
        setRows(r.pages);
      })
      .catch(() => alive && setRows([]));
    return () => {
      alive = false;
    };
  }, [spaceId]);
  const owners = useMemo(() => [...new Set((rows ?? []).flatMap((r) => r.owners))], [rows]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (rows ?? []).filter((r) => (!s || r.title.toLowerCase().includes(s)) && (!owner || r.owners.includes(owner)));
  }, [rows, q, owner]);
  if (rows === null) return null;
  if (!rows.length) return <>{empty}</>;
  const ownerName = (id: string) => userName(records.get<UserRecord>('lit_user', id));
  return (
    <div className="nc-verified-pages" data-testid="verified-pages">
      <div className="nc-verified-filters">
        <label className="nc-verified-search">
          <Icon name="search" size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('lp.page.search_pages', 'Search pages…')} aria-label={t('lp.page.search_pages', 'Search pages…')} />
        </label>
        <span
          role="button"
          className={`nc-verified-chip ${owner ? 'on' : ''}`}
          onClick={(e) => openMenu(e.currentTarget, {
            sections: [{
              items: [
                { label: t('lp.page.any_owner', 'Any owner'), checked: !owner, onSelect: () => setOwner(null) },
                ...owners.map((id) => ({ label: ownerName(id), icon: <UserAvatar userId={id} size={18} />, checked: owner === id, onSelect: () => setOwner(id) })),
              ],
            }],
          }, { placement: 'bottom-start' })}
        >
          {t('lp.page.owner', 'Owner')}{owner ? `: ${ownerName(owner)}` : ''}
          <Icon name="chevronDown" size={12} />
        </span>
      </div>
      <div className="nc-verified-table" role="table">
        <div className="tr th" role="row">
          <span role="columnheader">{t('lp.page.page', 'Page')}</span>
          <span role="columnheader">{t('lp.page.owner', 'Owner')}</span>
          <span role="columnheader">{t('lp.page.verified_until', 'Verified until')}</span>
        </div>
        {shown.map((r) => (
          <div key={r.pageId} className="tr" role="row" data-page-id={r.pageId} onClick={() => onOpen(r.pageId)}>
            <span role="cell" className="page">
              <PageIcon block={records.get<BlockRecord>('block', r.pageId)} size={18} />
              <span className="nc-ellipsis">{r.title || t('lp.page.untitled', 'Untitled')}</span>
              <VerifiedBadge size={14} expired={r.status === 'expired'} />
            </span>
            <span role="cell" className="owners" data-tooltip={r.owners.length > 1 ? `${t('lp.page.owners', 'Owners')}: ${r.owners.map(ownerName).join(', ')}` : undefined}>
              {r.owners.slice(0, 3).map((id) => <UserAvatar key={id} userId={id} size={20} />)}
              {r.owners.length === 1 && <span className="nc-ellipsis">{ownerName(r.owners[0])}</span>}
              {r.owners.length > 3 && <span className="more">+{r.owners.length - 3}</span>}
            </span>
            <span role="cell" className={r.status === 'expired' ? 'expired' : ''}>
              {r.status === 'expired'
                ? t('lp.page.expired_a689', 'Expired')
                : r.expiryTime ? fmt(r.expiryTime) : t('lp.page.indefinitely', 'Indefinitely')}
            </span>
          </div>
        ))}
        {!shown.length && <div className="nc-verified-none">{t('lp.page.no_verified_pages_match_these_filters', 'No verified pages match these filters')}</div>}
      </div>
    </div>
  );
}

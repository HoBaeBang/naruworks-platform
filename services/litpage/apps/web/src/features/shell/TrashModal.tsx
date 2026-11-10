import { HELP_URL } from '@nc/shared/brand.ts';
// Trash popover (sidebar "Library, Trash, more…" › Trash; page menus "Show deleted pages"):
// 414px wide, 50vh tall (max 70vh), anchored 6px above the footer apps button; search input,
// filter pills Last changed by (default: me) / In / Teamspaces, 45px rows with path, Restore / Permanently delete,
// blue-tinted footer note with help. Data: api('getTrashFiltered') (apps/server/src/api/modules/trash.ts).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BlockRecord, SpaceRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { openPage } from '../../lib/router.ts';
import { ancestorsOf } from '../../lib/blocks.ts';
import { PageIcon } from './PageIcon.tsx';
import { pageTitle, restorePage } from '../page/pageActions.ts';
import { t } from './i18n.ts';
import { trashRetentionDays } from '@nc/shared/retention.ts';
import { retentionDurationLabel } from '../settings/spaceSettings.ts';
import '../auth/icons.tsx';
import './trash.css';

interface Crumb { id: string; table: 'block' | 'team'; title: string }
interface TrashRow { id: string; path: Crumb[]; canDelete: boolean }

/** Popover is 50vh tall and sits 6px above the sidebar footer "Library, Trash, more…" button. Anchoring a point at
 *  its known top keeps the spot exact even while the pop-in scale is running. */
function footerAnchor(): Anchor {
  const btn = document.querySelector('.nc-sb-footer [aria-haspopup="menu"]') as HTMLElement | null;
  const r = btn?.getBoundingClientRect();
  const rect = r && r.width > 0 ? r : new DOMRect(12, window.innerHeight - 40, 28, 28);
  return { x: rect.left, y: Math.max(12, rect.top - 6 - window.innerHeight / 2) };
}

export function TrashModal() {
  useEffect(() => {
    // unmount/re-run (HMR, StrictMode) only removes the popover; a user dismissal also clears trashOpen
    let disposed = false;
    const close = openOverlay((c) => <Trash close={c} />, {
      anchor: footerAnchor(),
      placement: 'bottom-start',
      offset: 0,
      onClose: () => {
        if (!disposed) useUI.getState().set({ trashOpen: false });
      },
    });
    return () => {
      disposed = true;
      close();
    };
  }, []);
  return null;
}

function userName(u: UserRecord | undefined) {
  return u?.name || u?.email || t('lp.shell.unknown', 'Unknown');
}

function Avatar({ u, size = 20 }: { u: UserRecord | undefined; size?: number }) {
  return (
    <span className="nc-trash-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}>
      {u?.profile_photo ? <img src={u.profile_photo} alt="" /> : userName(u).slice(0, 1).toUpperCase()}
    </span>
  );
}

function Trash({ close }: { close: () => void }) {
  const spaceId = useSession((s) => s.spaceId);
  const me = useSession((s) => s.userId) ?? '';
  const [q, setQ] = useState('');
  const [editedBy, setEditedBy] = useState<string[]>(me ? [me] : []);
  const [inPage, setInPage] = useState<string | null>(null);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [rows, setRows] = useState<TrashRow[] | null>(null);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const reqId = useRef(0);

  const load = () => {
    const id = ++reqId.current;
    void api('getTrashFiltered', { spaceId, query: q, editedBy, ancestorId: inPage ?? undefined, teamIds })
      .then((res) => {
        if (id !== reqId.current) return;
        records.mergeRecordMap(res.recordMap);
        setRows(res.pages as TrashRow[]);
        setActive(0);
      })
      .catch(() => { if (id === reqId.current) setRows([]); });
  };
  useEffect(() => {
    const tm = setTimeout(load, q ? 120 : 0);
    return () => clearTimeout(tm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, spaceId, editedBy.join(','), inPage, teamIds.join(',')]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-index="${active}"]`) as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const doRestore = (id: string) => {
    restorePage(id);
    setRows((r) => (r ?? []).filter((x) => x.id !== id));
  };
  const doDelete = (id: string) => {
    confirmPermanentDelete(() => {
      void api('deleteBlocksPermanently', { blockIds: [id] })
        .then(() => setRows((r) => (r ?? []).filter((x) => x.id !== id)))
        .catch(() => useUI.getState().toast(t('lp.shell.couldn_t_delete_permanently_try_again', 'Couldn’t delete permanently. Try again later.')));
    });
  };

  const list = rows ?? [];
  const filtering = !!(q || inPage || teamIds.length || (editedBy.length && !(editedBy.length === 1 && editedBy[0] === me)));

  return (
    <PopoverSurface width={414} maxHeight="70vh" className="nc-trash lit-sidebar-trash-menu" style={{ height: '50vh', minWidth: 180 }}>
      <div className="nc-trash-top">
        <div className="nc-trash-search">
          <input
            autoFocus
            placeholder={t('lp.shell.find_a_page_in_trash', 'Find a page in Trash')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing && list[active]) { e.preventDefault(); close(); openPage(list[active].id); }
            }}
          />
        </div>
        <div className="nc-trash-filters">
          <PeoplePill selected={editedBy} onChange={setEditedBy} spaceId={spaceId} />
          <InPill selected={inPage} onChange={setInPage} spaceId={spaceId} />
          <TeamsPill selected={teamIds} onChange={setTeamIds} spaceId={spaceId} />
        </div>
      </div>
      <div className="lit-scroller vertical nc-trash-list" ref={listRef}>
        <div role="menu" className="nc-trash-menu">
          {rows && list.length === 0 && (
            <div className="nc-trash-empty">
              <div className="title">{filtering ? t('lp.shell.no_matches', 'No matches') : t('lp.shell.no_results', 'No results')}</div>
              {filtering && q && <div className="desc">{t('lp.shell.check_your_spelling', 'Check your spelling')}</div>}
            </div>
          )}
          {list.map((row, i) => {
            const b = records.get<BlockRecord>('block', row.id);
            const crumbs = row.path;
            const shown: (Crumb | null)[] = crumbs.length > 2 ? [crumbs[0], null, crumbs[crumbs.length - 1]] : crumbs;
            return (
              <div
                key={row.id}
                role="menuitem"
                data-index={i}
                className={`nc-trash-row notranslate ${shown.length ? '' : 'single'} ${i === active ? 'active' : ''}`}
                onMouseMove={() => setActive(i)}
                onClick={() => { close(); openPage(row.id); }}
              >
                <div className="nc-trash-row-icon"><PageIcon block={b} size={20} /></div>
                <div className="nc-trash-row-main">
                  <div className="nc-trash-row-title nc-ellipsis">{pageTitle(b) || t('lp.shell.untitled', 'Untitled')}</div>
                  {shown.length > 0 && (
                    <div className="nc-trash-row-path">
                      {shown.map((c, k) => (
                        <span key={k} className="seg">
                          {k > 0 && <span className="sep">/</span>}
                          <span className="nc-ellipsis">{c ? c.title || t('lp.shell.untitled', 'Untitled') : '...'}</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="nc-trash-row-actions">
                  <div
                    role="button"
                    aria-label={t('lp.shell.restore_page', 'Restore page')}
                    data-tooltip={t('lp.shell.restore', 'Restore')}
                    className="nc-trash-btn"
                    onClick={(e) => { e.stopPropagation(); doRestore(row.id); }}
                  >
                    <Icon name="arrowUTurnUpLeft" size={16} />
                  </div>
                  <div
                    role="button"
                    aria-label={t('lp.shell.permanently_delete', 'Permanently delete')}
                    aria-disabled={!row.canDelete || undefined}
                    data-tooltip={row.canDelete ? t('lp.shell.permanently_delete', 'Permanently delete') : t('lp.shell.you_can_t_permanently_delete_this', 'You can’t permanently delete this page')}
                    className={`nc-trash-btn ${row.canDelete ? '' : 'disabled'}`}
                    onClick={(e) => { e.stopPropagation(); if (row.canDelete) doDelete(row.id); }}
                  >
                    <Icon name="trashSmall" size={16} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <footer className="nc-trash-footer">
        <div className="nc-trash-footer-inner">
          <div>{t('lp.shell.this_page_will_be_deleted_automatically', 'This page will be deleted automatically after {deleteFromTrashDelayString} in Trash', { deleteFromTrashDelayString: retentionDurationLabel(trashRetentionDays(records.get<SpaceRecord>('space', useSession.getState().spaceId))) })}</div>
          {HELP_URL && <div
            role="button"
            aria-label={t('lp.shell.help', 'Help')}
            className="nc-trash-btn"
            onClick={() => window.open(HELP_URL!, '_blank')}
          >
            <Icon name="questionMarkCircleSmall" size={16} />
          </div>}
        </div>
      </footer>
    </PopoverSurface>
  );
}

// ---------------- confirm dialog ----------------
export function confirmPermanentDelete(onConfirm: () => void) {
  openOverlay((close) => (
    <div className="nc-trash-confirm" role="alertdialog">
      <div className="nc-trash-confirm-msg">{t('lp.shell.confirm_permanent_deletion_of_this_page', 'Confirm permanent deletion of this page?')}</div>
      <div className="nc-trash-confirm-desc">{t('lp.shell.you_can_t_view_or_restore', 'You can’t view or restore it.')}</div>
      <button className="nc-trash-confirm-danger" autoFocus onClick={() => { close(); onConfirm(); }}>
        {t('lp.shell.permanently_delete', 'Permanently delete')}
      </button>
      <button className="nc-trash-confirm-cancel" onClick={close}>{t('lp.shell.cancel', 'Cancel')}</button>
    </div>
  ), { placement: 'center', backdrop: 'dim' });
}

// ---------------- filter pills ----------------
/** glyph widths of the cropped 20px-tall icons: person 12.64, pageEmpty 11.75, teamspace 18 */
const PILL_ICON_WIDTH: Record<string, number> = { person: 12.64, pageEmpty: 11.75, building: 18 };

function Pill({ icon, label, active, onClick }: { icon: string; label: string; active: boolean; onClick: (el: HTMLElement) => void }) {
  return (
    <div className="nc-trash-pill-wrap">
      <div role="button" aria-haspopup="dialog" className={`nc-trash-pill ${active ? 'active' : ''}`} onClick={(e) => onClick(e.currentTarget as HTMLElement)}>
        <span className="nc-trash-pill-icon" style={{ width: PILL_ICON_WIDTH[icon] ?? 16 }}><Icon name={icon} size={16} /></span>
        <span className="nc-ellipsis">{label}</span>
        <span className="nc-trash-pill-icon chev"><Icon name="arrowChevronSingleDownSmall" size={14} /></span>
      </div>
    </div>
  );
}

function spaceMembers(spaceId: string | null): UserRecord[] {
  const space = records.get<SpaceRecord>('space', spaceId);
  const ids = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id && p.role !== 'none').map((p) => p.user_id!);
  return ids.map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u);
}

function PeoplePill({ selected, onChange, spaceId }: { selected: string[]; onChange: (v: string[]) => void; spaceId: string | null }) {
  return (
    <Pill
      icon="person"
      label={t('lp.shell.last_changed_by', 'Last changed by')}
      active={selected.length > 0}
      onClick={(el) => openOverlay(() => <PeoplePicker initial={selected} spaceId={spaceId} onChange={onChange} />, { anchor: el.getBoundingClientRect(), placement: 'bottom-start', offset: 4 })}
    />
  );
}

function PeoplePicker({ initial, spaceId, onChange }: { initial: string[]; spaceId: string | null; onChange: (v: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const members = useMemo(() => spaceMembers(spaceId), [spaceId]);
  const list = members.filter((u) => !sel.includes(u.id) && (!q || `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())));
  const update = (v: string[]) => { setSel(v); onChange(v); };
  return (
    <PopoverSurface width={250} maxHeight={340} className="nc-trash-picker">
      <div className="nc-trash-picker-head">
        <div className="nc-trash-tokens">
          {sel.map((id) => {
            const u = records.get<UserRecord>('lit_user', id);
            return (
              <span key={id} className="nc-trash-token">
                <Avatar u={u} size={18} />
                <span className="nc-ellipsis">{userName(u)}</span>
                <span role="button" className="x" onClick={() => update(sel.filter((x) => x !== id))}><Icon name="close" size={12} /></span>
              </span>
            );
          })}
          <input
            autoFocus
            value={q}
            placeholder={sel.length ? '' : t('lp.shell.search_for_people', 'Search for people…')}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Backspace' && !q && sel.length) update(sel.slice(0, -1));
              else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(list.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing && list[active]) { e.preventDefault(); update([...sel, list[active].id]); setQ(''); }
            }}
          />
        </div>
        {sel.length > 0 && (
          <span role="button" aria-label={t('lp.shell.clear_input', 'Clear Input')} className="nc-trash-clear" onClick={() => update([])}>
            <Icon name="xMarkCircleFill" size={16} />
          </span>
        )}
      </div>
      <div className="lit-scroller vertical nc-trash-picker-list">
        {list.length === 0 && <div className="nc-trash-picker-empty">{t('lp.shell.no_results', 'No results')}</div>}
        {list.map((u, i) => (
          <div key={u.id} className={`nc-trash-picker-row ${i === active ? 'active' : ''}`} onMouseMove={() => setActive(i)} onClick={() => { update([...sel, u.id]); setQ(''); }}>
            <Avatar u={u} size={22} />
            <span className="nc-ellipsis">{userName(u)}</span>
          </div>
        ))}
      </div>
    </PopoverSurface>
  );
}

function InPill({ selected, onChange, spaceId }: { selected: string | null; onChange: (v: string | null) => void; spaceId: string | null }) {
  const title = selected ? pageTitle(records.get<BlockRecord>('block', selected)) || t('lp.shell.untitled', 'Untitled') : '';
  return (
    <Pill
      icon="pageEmpty"
      label={selected ? `${t('lp.shell.in', 'In')} ${title}` : t('lp.shell.in', 'In')}
      active={!!selected}
      onClick={(el) => openOverlay((close) => <PagePicker selected={selected} spaceId={spaceId} onPick={(id) => { onChange(id); close(); }} />, { anchor: el.getBoundingClientRect(), placement: 'bottom-start', offset: 4 })}
    />
  );
}

function PagePicker({ selected, spaceId, onPick }: { selected: string | null; spaceId: string | null; onPick: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    let alive = true;
    const tm = setTimeout(async () => {
      try {
        const res = q.trim() ? await api('searchWorkspace', { query: q, spaceId, limit: 20 }) : await api('listRecentPages', { spaceId, limit: 20 });
        if (!alive) return;
        records.mergeRecordMap(res.recordMap);
        setIds(q.trim() ? res.results.map((r: { id: string }) => r.id) : res.pages.map((p: { id: string }) => p.id));
        setActive(0);
      } catch {
        if (alive) setIds([]);
      }
    }, q ? 120 : 0);
    return () => { alive = false; clearTimeout(tm); };
  }, [q, spaceId]);
  return (
    <PopoverSurface width={300} maxHeight={360} className="nc-trash-picker">
      <div className="nc-trash-picker-head">
        <div className="nc-trash-tokens single">
          <input
            autoFocus
            value={q}
            placeholder={t('lp.shell.search_pages', 'Search pages')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(ids.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter' && !e.nativeEvent.isComposing && ids[active]) { e.preventDefault(); onPick(ids[active]); }
            }}
          />
        </div>
        {selected && (
          <span role="button" aria-label={t('lp.shell.clear_input', 'Clear Input')} className="nc-trash-clear" onClick={() => onPick(null)}>
            <Icon name="xMarkCircleFill" size={16} />
          </span>
        )}
      </div>
      <div className="lit-scroller vertical nc-trash-picker-list">
        {ids.length === 0 && <div className="nc-trash-picker-empty">{t('lp.shell.no_results', 'No results')}</div>}
        {ids.map((id, i) => {
          const b = records.get<BlockRecord>('block', id);
          if (!b) return null;
          const path = ancestorsOf(id).map((a) => pageTitle(a) || t('lp.shell.untitled', 'Untitled')).join(' / ');
          return (
            <div key={id} className={`nc-trash-picker-row tall ${i === active ? 'active' : ''} ${selected === id ? 'checked' : ''}`} onMouseMove={() => setActive(i)} onClick={() => onPick(id)}>
              <PageIcon block={b} size={20} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="nc-ellipsis">{pageTitle(b) || t('lp.shell.untitled', 'Untitled')}</div>
                {path && <div className="nc-trash-picker-sub nc-ellipsis">{path}</div>}
              </div>
              {selected === id && <Icon name="check" size={16} style={{ color: 'var(--lp-icon-primary)' }} />}
            </div>
          );
        })}
      </div>
    </PopoverSurface>
  );
}

function TeamsPill({ selected, onChange, spaceId }: { selected: string[]; onChange: (v: string[]) => void; spaceId: string | null }) {
  return (
    <Pill
      icon="building"
      label={t('lp.shell.teams', 'Teams')}
      active={selected.length > 0}
      onClick={(el) => openOverlay(() => <TeamPicker initial={selected} spaceId={spaceId} onChange={onChange} />, { anchor: el.getBoundingClientRect(), placement: 'bottom-start', offset: 4 })}
    />
  );
}

function TeamPicker({ initial, spaceId, onChange }: { initial: string[]; spaceId: string | null; onChange: (v: string[]) => void }) {
  const [sel, setSel] = useState<string[]>(initial);
  const [q, setQ] = useState('');
  const teams = records.all<TeamRecord>('team').filter((tm) => tm.space_id === spaceId && tm.alive !== false && (!q || tm.name.toLowerCase().includes(q.toLowerCase())));
  const toggle = (id: string) => {
    const next = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
    setSel(next);
    onChange(next);
  };
  return (
    <PopoverSurface width={250} maxHeight={340} className="nc-trash-picker">
      <div className="nc-trash-picker-head">
        <div className="nc-trash-tokens single">
          <input autoFocus value={q} placeholder={t('lp.shell.search_teams', 'Search teams')} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="lit-scroller vertical nc-trash-picker-list">
        {teams.length === 0 && <div className="nc-trash-picker-empty">{t('lp.shell.no_results', 'No results')}</div>}
        {teams.map((tm) => (
          <div key={tm.id} className="nc-trash-picker-row" onClick={() => toggle(tm.id)}>
            <span className="nc-trash-team-icon">{tm.icon || tm.name.slice(0, 1).toUpperCase()}</span>
            <span className="nc-ellipsis" style={{ flex: 1 }}>{tm.name}</span>
            {sel.includes(tm.id) && <Icon name="check" size={16} style={{ color: 'var(--lp-icon-primary)' }} />}
          </div>
        ))}
      </div>
    </PopoverSurface>
  );
}

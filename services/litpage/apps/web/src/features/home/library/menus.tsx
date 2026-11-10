// Library view menus, including the column header menu (Edit property 🔒 / Filter / Sort ▸ / Group / Hide /
// Wrap content), filter menu ("Filter by…" + properties + "Add advanced filter"), filter value editors,
// sort menu and property visibility. Item lists: menus.library-*.
import { useMemo, useState } from 'react';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { newId } from '@nc/shared/ids.ts';
import { openMenu, type MenuDef, type MenuItemDef } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { t } from '../../shell/i18n.ts';
import {
  COL_ICON, COL_KIND, availableColumns, colLabel, rangeLabel, useLibraryViews, userName, userOf,
  type ColKey, type DateRange, type LibFilter, type LibTab, type PageTab,
} from './model.ts';

function snap(anchor: Anchor): Anchor {
  return anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
}

const sw = (on: boolean) => <span className={`nc-lib-switch ${on ? 'on' : ''}`}><span /></span>;

export function sortLabels(col: ColKey): { asc: string; desc: string } {
  if (COL_KIND[col] === 'date') {
    return {
      asc: t('lp.home.sort_old_to_new', 'Sort old to new'),
      desc: t('lp.home.sort_new_to_old', 'Sort new to old'),
    };
  }
  return {
    asc: t('lp.home.sort_a_z', 'Sort A → Z'),
    desc: t('lp.home.sort_z_a', 'Sort Z → A'),
  };
}

/** Header cell menu. */
export function openColumnMenu(tab: PageTab, col: ColKey, anchor: Anchor) {
  const store = useLibraryViews.getState();
  const view = store.get(tab);
  const labels = sortLabels(col);
  const grouped = view.group === col;
  const items: MenuItemDef[] = [
    // deferred: Menu closes every overlay right after onSelect, and the new pill opens the filter editor overlay
    { label: t('lp.home.filter', 'Filter'), icon: 'filter', onSelect: () => { setTimeout(() => addFilter(tab, col), 0); } },
    {
      label: t('lp.home.sort', 'Sort'), icon: 'arrowUpDown',
      submenu: () => ({
        width: 200,
        sections: [{
          items: (['asc', 'desc'] as const).map((dir) => ({
            label: dir === 'asc' ? labels.asc : labels.desc,
            checked: view.sort?.col === col && view.sort.dir === dir,
            onSelect: () => store.update(tab, (v) => { v.sort = { col, dir }; }),
          })),
        }],
      }),
    },
    {
      label: grouped ? t('lp.home.ungroup', 'Ungroup') : t('lp.home.group', 'Group'),
      icon: 'squareGridBelowLines',
      disabled: col === 'title',
      onSelect: () => store.update(tab, (v) => { v.group = grouped ? null : col; }),
    },
    {
      label: t('lp.home.hide', 'Hide'), icon: 'eyeSlash', disabled: col === 'title',
      onSelect: () => store.update(tab, (v) => { v.visible = v.visible.filter((c) => c !== col); }),
    },
    {
      label: t('lp.home.wrap_content', 'Wrap content'), icon: 'arrowUTurnDownLeft',
      right: sw(!!view.wrap[col]),
      onSelect: () => {
        store.update(tab, (v) => { v.wrap[col] = !v.wrap[col]; });
        return undefined;
      },
    },
  ];
  openMenu(snap(anchor), {
    width: 220,
    sections: [
      { items: [{ label: t('lp.home.edit_property', 'Edit property'), icon: 'lock', disabled: true }] },
      { items },
    ],
  }, { placement: 'bottom-start' });
}

// ---------------- filters ----------------
/** Ask the filter bar to open the editor of a freshly added filter. */
export const pendingFilterEditor = { id: null as string | null };

export function addFilter(tab: PageTab, col: ColKey) {
  const id = `f-${newId().slice(0, 8)}`;
  pendingFilterEditor.id = id;
  useLibraryViews.getState().update(tab, (v) => { v.filters.push({ id, col }); });
}

export function openFilterMenu(tab: PageTab, anchor: Anchor) {
  const cols: ColKey[] = availableColumns(tab).filter((c) => c !== 'source');
  const order: ColKey[] = ['title', 'last_visited_time', 'last_edited_time', 'last_edited_by', 'created_time', 'created_by'];
  const def: MenuDef = {
    width: 290,
    search: t('lp.home.filter_by', 'Filter by…'),
    sections: [
      { items: order.filter((c) => cols.includes(c)).map((c) => ({ label: colLabel(c), icon: COL_ICON[c], iconColor: 'var(--lp-icon-secondary)', onSelect: () => { setTimeout(() => addFilter(tab, c), 0); } })) },
      {
        items: [{
          label: t('lp.home.add_an_advanced_filter', 'Add an advanced filter'), icon: 'plus', iconColor: 'var(--lp-icon-secondary)',
          onSelect: () => useUI.getState().toast(t('lp.home.advanced_filters_are_not_available_in', 'Advanced filters are not available in the Library')),
        }],
      },
    ],
  };
  openMenu(snap(anchor), def, { placement: 'bottom-end' });
}

export function filterSummary(f: LibFilter): string {
  const kind = COL_KIND[f.col];
  if (kind === 'person' && f.users?.length) {
    const names = f.users.map((u) => (u === useSession.getState().userId ? t('lp.home.you', 'You') : userName(userOf(u)))).filter(Boolean);
    return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0] ?? '';
  }
  if (kind === 'date' && f.range) return rangeLabel(f.range);
  if ((kind === 'title' || kind === 'source') && f.text) return f.text;
  return '';
}

export function openFilterEditor(tab: PageTab, filterId: string, anchor: Anchor) {
  openOverlay((close) => <FilterEditor tab={tab} filterId={filterId} close={close} />, { anchor: snap(anchor), placement: 'bottom-start', offset: 4 });
}

function FilterEditor({ tab, filterId, close }: { tab: PageTab; filterId: string; close: () => void }) {
  const view = useLibraryViews((s) => s.views[tab]);
  const f = view?.filters.find((x) => x.id === filterId);
  const [q, setQ] = useState('');
  const spaceId = useSession((s) => s.spaceId);
  const me = useSession((s) => s.userId);
  const people = useMemo(() => {
    const space = records.get<SpaceRecord>('space', spaceId);
    const ids = (space?.permissions ?? []).filter((p) => p.type === 'user_permission' && p.user_id).map((p) => p.user_id!) ;
    const uniq = [...new Set(ids)];
    uniq.sort((a, b) => (a === me ? -1 : b === me ? 1 : userName(userOf(a)).localeCompare(userName(userOf(b)))));
    return uniq;
  }, [spaceId, me]);
  if (!f) return null;
  const update = (fn: (x: LibFilter) => void) => useLibraryViews.getState().update(tab, (v) => {
    const target = v.filters.find((x) => x.id === filterId);
    if (target) fn(target);
  });
  const remove = () => {
    useLibraryViews.getState().update(tab, (v) => { v.filters = v.filters.filter((x) => x.id !== filterId); });
    close();
  };
  const kind = COL_KIND[f.col];
  return (
    <PopoverSurface width={kind === 'person' ? 290 : 260} maxHeight={420}>
      <div className="nc-lib-filter-head">
        <span className="nc-lib-filter-head-label">{colLabel(f.col)}</span>
        <div role="button" className="nc-lib-mini-btn" aria-label={t('lp.home.delete_filter', 'Delete filter')} data-tooltip={t('lp.home.delete_filter', 'Delete filter')} onClick={remove}>
          <Icon name="trash" size={16} />
        </div>
      </div>
      {(kind === 'title' || kind === 'source') && (
        <div className="nc-lib-filter-body">
          <div className="nc-input">
            <input autoFocus placeholder={t('lp.home.enter_a_value', 'Enter a value…')} value={f.text ?? ''} onChange={(e) => update((x) => { x.text = e.target.value; })} onKeyDown={(e) => { if (e.key === 'Enter') close(); }} />
          </div>
        </div>
      )}
      {kind === 'person' && (
        <>
          <div className="nc-lib-filter-body">
            <div className="nc-input">
              <input autoFocus placeholder={t('lp.home.find_a_person', 'Find a person…')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
          <div className="lit-scroller vertical nc-lib-filter-list">
            {people.filter((id) => !q || userName(userOf(id)).toLowerCase().includes(q.toLowerCase())).map((id) => {
              const checked = !!f.users?.includes(id);
              const u = userOf(id);
              return (
                <div key={id} role="menuitemcheckbox" aria-checked={checked} className="nc-menu-item" onClick={() => update((x) => { x.users = checked ? (x.users ?? []).filter((v) => v !== id) : [...(x.users ?? []), id]; })}>
                  <div className="nc-menu-item-inner">
                    <span className={`nc-lib-check ${checked ? 'on' : ''}`}>{checked && <Icon name="check" size={12} />}</span>
                    <LibAvatar user={u} />
                    <div className="nc-menu-label nc-ellipsis">{userName(u)}{id === me ? ` ${t('lp.home.you_2d21', '(You)')}` : ''}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
      {kind === 'date' && (
        <div className="nc-menu-section">
          {(['today', 'week', 'month', 'year'] as DateRange[]).map((r) => (
            <div key={r} role="menuitemradio" aria-checked={f.range === r} className="nc-menu-item" onClick={() => { update((x) => { x.range = x.range === r ? undefined : r; }); close(); }}>
              <div className="nc-menu-item-inner">
                <div className="nc-menu-label">{rangeLabel(r)}</div>
                {f.range === r && <Icon name="check" size={16} style={{ color: 'var(--lp-icon-primary)' }} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </PopoverSurface>
  );
}

export function LibAvatar({ user, size = 20 }: { user: { name?: string; email?: string; profile_photo?: string } | undefined; size?: number }) {
  const name = user?.name || user?.email || '?';
  return (
    <span className="nc-lib-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}>
      {user?.profile_photo ? <img src={user.profile_photo} alt="" /> : name.slice(0, 1).toUpperCase()}
    </span>
  );
}

// ---------------- sort indicator menu ----------------
export function openSortMenu(tab: PageTab, anchor: Anchor) {
  const store = useLibraryViews.getState();
  const sort = store.get(tab).sort;
  if (!sort) return;
  const labels = sortLabels(sort.col);
  openMenu(snap(anchor), {
    width: 240,
    sections: [
      {
        title: colLabel(sort.col),
        items: (['asc', 'desc'] as const).map((dir) => ({
          label: dir === 'asc' ? labels.asc : labels.desc,
          checked: sort.dir === dir,
          onSelect: () => store.update(tab, (v) => { v.sort = { col: sort.col, dir }; }),
        })),
      },
      { items: [{ label: t('lp.home.delete_sort', 'Delete sort'), icon: 'trash', onSelect: () => store.update(tab, (v) => { v.sort = null; }) }] },
    ],
  }, { placement: 'bottom-end' });
}

// ---------------- property visibility ----------------
export function openPropertyVisibilityMenu(tab: PageTab, anchor: Anchor) {
  openOverlay(() => <PropertyVisibility tab={tab} />, { anchor: snap(anchor), placement: 'left-start', offset: 4 });
}

function PropertyVisibility({ tab }: { tab: PageTab }) {
  const view = useLibraryViews((s) => s.views[tab]);
  const cols = availableColumns(tab);
  const visible = view?.visible ?? [];
  const shown = visible.filter((c) => cols.includes(c));
  const hidden = cols.filter((c) => !shown.includes(c));
  const toggle = (c: ColKey) => useLibraryViews.getState().update(tab, (v) => {
    v.visible = v.visible.includes(c) ? v.visible.filter((x) => x !== c) : [...v.visible, c];
  });
  const row = (c: ColKey, on: boolean) => (
    <div key={c} role="menuitem" aria-disabled={c === 'title' || undefined} className={`nc-menu-item ${c === 'title' ? 'nc-lib-locked' : ''}`} onClick={() => c !== 'title' && toggle(c)}>
      <div className="nc-menu-item-inner">
        <div className="nc-menu-icon" style={{ color: 'var(--lp-icon-secondary)' }}><Icon name={COL_ICON[c]} size={16} /></div>
        <div className="nc-menu-label nc-ellipsis">{colLabel(c)}</div>
        <Icon name={on ? 'eye' : 'eyeSlash'} size={16} style={{ color: c === 'title' ? 'var(--lp-icon-tertiary)' : on ? 'var(--lp-icon-primary)' : 'var(--lp-icon-tertiary)' }} />
      </div>
    </div>
  );
  return (
    <PopoverSurface width={290} maxHeight={420}>
      <div className="lit-scroller vertical" style={{ overflowY: 'auto' }}>
        <div className="nc-menu-section">
          <div className="nc-menu-section-title">{t('lp.home.visible_in_table', 'Visible in table')}</div>
          {shown.map((c) => row(c, true))}
        </div>
        {hidden.length > 0 && (
          <div className="nc-menu-section">
            <div className="nc-menu-section-title">{t('lp.home.hidden_from_table', 'Hidden from table')}</div>
            {hidden.map((c) => row(c, false))}
          </div>
        )}
      </div>
    </PopoverSurface>
  );
}

export function isTabWithTable(tab: LibTab): tab is PageTab {
  return tab === 'recents' || tab === 'favorites' || tab === 'shared' || tab === 'private' || tab === 'meetings';
}

// Group headers for grouped table / list / gallery views: caret toggle, value token, count (group
// calculation), hover "+" (Create an entry in this group) and "•••" (Hide group / calculation); hidden groups list.
import { useCallback, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import type { CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { savedGroupsFrom, savedGroupsOf, groupAggregationOf, aggregatorName, type AggregationSpec, type GroupResult } from '@nc/shared/database/index.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { OptionPill, StatusPill, PersonChip, PageChip, colorKey } from '../properties/ValueView.tsx';
import { setGroupAggregation, setSavedGroups } from '../actions.ts';
import { calculateMenuDef } from '../properties/PropertyMenus.tsx';
import { useViewQuery } from '../data.ts';
import { useDatabaseContext } from '../DatabaseContext.tsx';
import { colorToken } from '../../../lib/colorToken.ts';

const LS = (viewId: string) => `nc:collapsedGroups:${viewId}`;

export function useCollapsedGroups(viewId: string) {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(LS(viewId)) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const toggle = useCallback((id: string) => {
    setSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(LS(viewId), JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [viewId]);
  return useMemo(() => ({ has: (id: string) => set.has(id), toggle }), [set, toggle]);
}

/** CSS variables for a group's color (board columns, group tokens). */
export function groupColorVars(g: GroupResult): CSSProperties {
  const k = colorKey(g.color ?? (g.uncategorized ? 'default' : g.option?.color ?? 'default'));
  return { ['--nc-group-bg' as any]: `var(${colorToken(k, 'bg-primary')}, var(--lp-bg-secondary))`, ['--nc-group-fg' as any]: `var(${colorToken(k, 'text-secondary')}, var(--lp-text-secondary))`, ['--nc-group-ico' as any]: `var(${colorToken(k, 'icon-accent')}, var(--lp-icon-secondary))` };
}

/** The value token shown in a group header / board column header. */
export function GroupToken({ group }: { group: GroupResult }): ReactNode {
  const v = group.value;
  if (group.uncategorized) return <span className="nc-group-token-text muted">{group.label}</span>;
  if (v.type === 'status') return <StatusPill option={{ value: group.label, color: group.color ?? 'default' }} />;
  if (v.type === 'select' || v.type === 'multi_select') return <OptionPill option={{ value: group.label, color: group.color ?? 'default' }} />;
  if (v.type === 'checkbox') {
    return (
      <span className="nc-group-token-checkbox">
        <span className={`nc-prop-checkbox ${v.value ? 'checked' : ''} disabled`}>{v.value && <Icon name="checkmarkSmall" size={12} strokeWidth={2.6} />}</span>
        <span>{group.label}</span>
      </span>
    );
  }
  if ((v.type === 'person' || v.type === 'created_by' || v.type === 'last_edited_by') && v.value?.id) return <PersonChip userId={v.value.id} size={20} />;
  if (v.type === 'relation' && v.value?.id) return <PageChip pageId={v.value.id} />;
  return <span className="nc-group-token-text">{group.label}</span>;
}

export function openGroupMenu(anchor: HTMLElement, group: GroupResult, view: CollectionViewRecord, collection: CollectionRecord, allGroups: GroupResult[], property: string) {
  const agg = groupAggregationOf(view);
  const prop = agg?.property ? collection.schema[agg.property] : undefined;
  return openMenu(anchor, {
    width: 220,
    sections: [{
      items: [
        { id: 'hide', label: 'Hide group', icon: 'eyeSlash', onSelect: () => setSavedGroups(view, savedGroupsFrom(allGroups.map((g) => (g.id === group.id ? { ...g, hidden: true } : g)), property, savedGroupsOf(view)), { action: 'hideGroup' }) },
        { id: 'calc', label: 'Calculate', icon: 'sum', submenu: () => calculateMenuDef(prop ?? { name: '', type: 'title' }, aggregatorName(agg ?? undefined), (a) => setGroupAggregation(view, { ...(agg?.property ? { property: agg.property } : {}), aggregator: a as any })) },
      ],
    }],
  }, { placement: 'bottom-start' });
}

export function GroupHeader({ group, view, collection, readOnly, collapsed, onToggle, onAdd, sticky }: { group: GroupResult; view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean; collapsed: boolean; onToggle: () => void; onAdd: () => void; sticky?: boolean }) {
  const q = useViewQuery(collection, view);
  const structureRO = useDatabaseContext()?.structureReadOnly ?? readOnly;
  const agg = group.aggregation;
  // table/list/gallery group headers show a calculation only once one is chosen (no default count;)
  const explicit = view.type === 'board' ? groupAggregationOf(view) : ((view.format as any)?.collection_group_aggregation as AggregationSpec | undefined);
  const showAgg = agg && !!explicit && aggregatorName(explicit) !== 'none';
  return (
    <div className={`nc-group-header ${sticky ? 'sticky' : ''}`} style={groupColorVars(group)}>
      <div role="button" className={`nc-group-caret ${collapsed ? 'collapsed' : ''}`} aria-label={collapsed ? 'Expand group' : 'Collapse group'} onClick={onToggle}>
        <Icon name="triangleDown" size={20} />
      </div>
      <div className="nc-group-token" onClick={onToggle}><GroupToken group={group} /></div>
      {showAgg && <span className="nc-group-count">{agg!.display}</span>}
      {!readOnly && (
        <div className="nc-group-actions">
          {!structureRO && <div role="button" className="nc-group-action" aria-label="Group options" onClick={(e) => q.groupBy && openGroupMenu(e.currentTarget, group, view, collection, q.groups ?? [], q.groupBy.property)}><Icon name="ellipsisSmall" size={16} /></div>}
          <div role="button" className="nc-group-action" aria-label="Create an entry in this group" data-tooltip="Create an entry in this group" onClick={onAdd}><Icon name="plusSmall" size={16} /></div>
        </div>
      )}
    </div>
  );
}

export function HiddenGroups({ groups, view, collection, onShow }: { groups: GroupResult[]; view: CollectionViewRecord; collection: CollectionRecord; onShow: (g: GroupResult) => void }) {
  const [open, setOpen] = useState(false);
  void view;
  void collection;
  if (!groups.length) return null;
  return (
    <div className="nc-hidden-groups">
      <div role="button" className="nc-hidden-groups-toggle" onClick={() => setOpen(!open)}>
        <span className={`nc-group-caret ${open ? '' : 'collapsed'}`}><Icon name="triangleDown" size={12} /></span>
        <span>{groups.length} hidden group{groups.length === 1 ? '' : 's'}</span>
      </div>
      {open && groups.map((g) => (
        <div key={g.id} className="nc-hidden-group-row">
          <GroupToken group={g} />
          <span className="nc-group-count">{g.rows.length}</span>
          <div role="button" className="nc-group-action" aria-label="Show group" onClick={() => onShow(g)}><Icon name="eyeSlash" size={16} /></div>
        </div>
      ))}
    </div>
  );
}

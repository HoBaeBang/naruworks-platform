// Chart drilldown: clicking a bar, slice or point shows the pages behind it as a table in a dialog —
// read-only cells (open a page to edit it), no bulk actions / frozen columns / calculations / new pages,.
// •••: "Open {databaseName}" and "Store layout in…", a linked table view of
// the data source on a page you pick, filtered to this part of the chart (plus the chart's own filters).
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema } from '@nc/shared/records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import type { FilterGroup, FilterNode, GroupValue, PropertyFilterLeaf } from '@nc/shared/database/index.ts';
import { Icon } from '../../../../components/Icon.tsx';
import { openMenu } from '../../../../components/Menu.tsx';
import { openOverlay } from '../../../../components/overlay.tsx';
import { createBlockIn, run } from '../../../../lib/blocks.ts';
import { openPage } from '../../../../lib/router.ts';
import { records } from '../../../../lib/store/records.ts';
import { useUI } from '../../../../lib/store/ui.ts';
import { PageIcon } from '../../../shell/PageIcon.tsx';
import { openPagePicker } from '../../../editor/inline/PagePicker.tsx';
import { PropertyCell, PropertyIcon } from '../../properties/PropertyCell.tsx';
import { createViewIn } from '../../actions.ts';
import { effectiveView } from '../../viewState.ts';
import { titleOf } from '../../advanced/index.ts';
import type { ChartConfig, ChartData, ChartPoint } from './chartModel.ts';

const MAX_ROWS = 500;
const MAX_COLUMNS = 6;

export interface DrilldownOptions {
  point: ChartPoint;
  data: ChartData;
  cfg: ChartConfig;
  block: BlockRecord;
  view: CollectionViewRecord;
  collection: CollectionRecord;
  openRow: (id: string) => void;
}

/** Title first, then the chart's own properties (X axis, value, stack), then the rest in schema order. */
function drilldownColumns(cfg: ChartConfig, schema: Record<string, PropertySchema>): string[] {
  const dc = cfg.dataConfig;
  const first = dc.type === 'groups_reducer'
    ? [dc.groupBy.property, dc.aggregationConfig.aggregation.property, dc.aggregationConfig.stackOptions?.groupBy.property]
    : dc.type === 'number_reducer' ? [dc.aggregationConfig.aggregation.property] : [];
  const ids = ['title', ...first, ...Object.keys(schema)].filter((id): id is string => !!id && !!schema[id] && schema[id].type !== 'button');
  return [...new Set(ids)].slice(0, MAX_COLUMNS);
}

/** Filter that keeps the pages of one chart group (null when the group can't be expressed as a filter). */
export function groupFilterNodes(propId: string, prop: PropertySchema | undefined, point: Pick<ChartPoint, 'label' | 'uncategorized' | 'groupValue'>): FilterNode[] | null {
  if (!prop) return null;
  if (point.uncategorized) return [{ property: propId, filter: { operator: 'is_empty' } }];
  const v = (point.groupValue as GroupValue | undefined)?.value;
  const leaf = (operator: string, value?: unknown): PropertyFilterLeaf => ({ property: propId, filter: { operator, ...(value !== undefined ? { value: { type: 'exact', value } } : {}) } as PropertyFilterLeaf['filter'] });
  switch (prop.type) {
    case 'select': return [leaf('enum_is', point.label)];
    case 'multi_select': return [leaf('enum_contains', point.label)];
    case 'status':
      if (v?.type === 'by_group') return [{ property: propId, filter: { operator: 'status_is', value: { type: 'is_group', value: v.group } } as PropertyFilterLeaf['filter'] }];
      return [leaf('status_is', point.label)];
    case 'checkbox': return [leaf('checkbox_is', v === true)];
    case 'person':
    case 'created_by':
    case 'last_edited_by':
      return v?.id ? [leaf('person_contains', v.id)] : null;
    case 'relation': return v?.id ? [leaf('relation_contains', v.id)] : null;
    case 'title':
    case 'text':
    case 'url':
    case 'email':
    case 'phone_number':
      return v?.type === 'exact' ? [leaf('string_is', String(v.value))] : null;
    case 'number':
      if (v?.type === 'unique') return [leaf('number_equals', v.value)];
      if (v?.type === 'range' && typeof v.start === 'number' && typeof v.end === 'number') return [leaf('number_greater_than_or_equal_to', v.start), leaf('number_less_than', v.end)];
      return null;
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      if (v?.range?.start_date && v.range.end_date) {
        return [leaf('date_is_on_or_after', { type: 'date', start_date: v.range.start_date }), leaf('date_is_on_or_before', { type: 'date', start_date: v.range.end_date })];
      }
      return null;
    default:
      return null;
  }
}

/** "Store layout in…": a linked table view of the chart's data source at the end of `pageId`. */
function saveAsView(o: DrilldownOptions, pageId: string, nodes: FilterNode[]): boolean {
  const page = records.get<BlockRecord>('block', pageId);
  if (!page || !roleAtLeast(records.role('block', pageId), 'read_and_write')) {
    useUI.getState().toast('You don’t have permission to edit that page');
    return false;
  }
  const v = effectiveView(o.view);
  const own = (v.query2 as { filter?: FilterGroup } | undefined)?.filter;
  const filter: FilterGroup = { operator: 'and', filters: [...nodes, ...(own && own.filters?.length ? [own] : [])] };
  const pointer = { id: o.collection.id, table: 'collection', spaceId: o.collection.space_id };
  const name = `${o.data.xName}: ${o.point.label}`;
  run('chartDrilldown.saveAsView', (tx) => {
    const blockId = createBlockIn(tx, {
      type: 'collection_view', parentId: pageId, parentTable: 'block',
      format: { collection_pointer: pointer, collection_pointers: [pointer] } as never,
      extra: { collection_id: o.collection.id, view_ids: [] },
    });
    const viewId = createViewIn(tx, blockId, 'table', o.collection.id, {
      name,
      extraFormat: { collection_pointer: pointer, ...((v.format as { property_filters?: unknown[] } | undefined)?.property_filters?.length ? { property_filters: structuredClone((v.format as { property_filters: unknown[] }).property_filters) } : {}) },
      extraQuery: { filter },
    });
    tx.listAfter('block', blockId, ['view_ids'], viewId);
  });
  useUI.getState().toast(`Saved view in ${toPlainText(page.properties?.title as never) || 'Untitled'}`);
  return true;
}

export function openChartDrilldown(o: DrilldownOptions) {
  openOverlay((close) => <Drilldown {...o} close={close} />, { placement: 'middle', backdrop: 'dim' });
}

function Drilldown({ close, ...o }: DrilldownOptions & { close: () => void }) {
  const { point, data, cfg, collection } = o;
  const schema = collection.schema;
  const cols = drilldownColumns(cfg, schema);
  const rows = point.rows.slice(0, MAX_ROWS);
  const dbName = toPlainText(collection.name as never) || 'Untitled';
  const xProp = cfg.dataConfig.type === 'groups_reducer' ? cfg.dataConfig.groupBy.property : undefined;
  const nodes = xProp ? groupFilterNodes(xProp, schema[xProp], point) : null;
  const more = (anchor: HTMLElement) => openMenu(anchor, {
    width: 240,
    sections: [{
      items: [
        { id: 'open', label: `Open ${dbName}`, icon: 'openAsPage', onSelect: () => { close(); openPage(collection.parent_id); } },
        ...(nodes ? [{
          id: 'save', label: 'Store layout in…', icon: 'plus', onSelect: () => {
            // opened once this menu has closed (menus close the overlays stacked above them)
            setTimeout(() => openPagePicker(anchor, { onPick: (pageId) => { if (saveAsView(o, pageId, nodes)) close(); } }), 0);
          },
        }] : []),
      ],
    }],
  }, { placement: 'bottom-end' });
  return (
    <div className="nc-chart-drill" role="dialog" aria-label={`${data.xName}: ${point.label}`} data-testid="chart-drilldown">
      <div className="nc-chart-drill-head">
        <span className="nc-chart-drill-prop">{data.xName}</span>
        <span className="nc-chart-drill-title">{point.label}</span>
        <span className="nc-chart-drill-count">{point.rows.length}</span>
        <div style={{ flex: 1 }} />
        <div role="button" className="nc-icon-btn" aria-label="More" data-tooltip="More" onClick={(e) => more(e.currentTarget)}><Icon name="ellipsis" size={18} /></div>
        <div role="button" className="nc-icon-btn" aria-label="Close" onClick={close}><Icon name="xMarkSmall" size={18} /></div>
      </div>
      <div className="nc-chart-drill-body lit-scroller vertical">
        <div className="nc-chart-drill-table" style={{ gridTemplateColumns: cols.map((c) => (c === 'title' ? 'minmax(200px, 2fr)' : 'minmax(120px, 1fr)')).join(' ') }}>
          {cols.map((c) => (
            <div key={`h-${c}`} className="nc-chart-drill-th"><PropertyIcon prop={schema[c]} size={14} /><span>{schema[c]?.name}</span></div>
          ))}
          {rows.map((r) => cols.map((c) => (
            <div key={`${r.id}-${c}`} className="nc-chart-drill-td" data-row-id={r.id}>
              {c === 'title' ? (
                <span role="link" className="nc-chart-drill-open" onClick={() => { close(); o.openRow(r.id); }}>
                  <PageIcon block={r} size={16} fallback="page" />
                  <span className="nc-chart-drill-name">{titleOf(r) || 'Untitled'}</span>
                </span>
              ) : (
                <PropertyCell row={r} schema={schema} propId={c} readOnly noEdit />
              )}
            </div>
          )))}
        </div>
        {point.rows.length > MAX_ROWS && <div className="nc-chart-drill-more">{`Showing the first ${MAX_ROWS} pages`}</div>}
      </div>
    </div>
  );
}

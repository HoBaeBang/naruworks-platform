
// Calculate › (Show original, Show unique values, Count ›, Percent ›, More options › / Date ›), Number format,
// Decimal places and Show as (Number / Bar / Ring) for numeric results.
import type { PropertySchema } from '@nc/shared/records.ts';
import {
  AGGREGATION_BUCKETS, AGGREGATION_LABEL, AGGREGATIONS_BY_TYPE, aggregationValueType, aggregatorName, type Aggregator, type AggregationSpec,
} from '@nc/shared/relation/index.ts';
import { NUMBER_FORMATS } from '@nc/shared/formula/index.ts';
import { openOverlay, type Anchor } from '../../../components/overlay.tsx';
import { openMenu, type MenuItemDef } from '../../../components/Menu.tsx';
import { useCollection, useTableVersion } from '../../../lib/hooks.ts';
import { getCollection } from './context.ts';
import { propertyIconFor } from './formulaComplete.ts';
import { updateRollup } from './relations.ts';
import { ConfigRow, ShowAsPicker } from './ui.tsx';
import './advanced.css';

export const NUMBER_FORMAT_LABEL: Record<string, string> = {
  number: 'Number', number_with_commas: 'Number with commas', percent: 'Percent', dollar: 'US dollar', australian_dollar: 'Australian dollar',
  canadian_dollar: 'Canadian dollar', singapore_dollar: 'Singapore dollar', euro: 'Euro', pound: 'Pound', yen: 'Yen', ruble: 'Ruble', rupee: 'Rupee',
  won: 'Won', yuan: 'Yuan', real: 'Real', lira: 'Lira', rupiah: 'Rupiah', franc: 'Franc', hong_kong_dollar: 'HK dollar',
  new_zealand_dollar: 'NZ dollar', krona: 'Swedish krona', norwegian_krone: 'Norwegian krone', mexican_peso: 'Mexican peso', rand: 'Rand',
  new_taiwan_dollar: 'NT dollar', danish_krone: 'Danish krone', zloty: 'Złoty', baht: 'Baht', forint: 'Forint', koruna: 'Koruna',
  shekel: 'Shekel', chilean_peso: 'Chilean peso', philippine_peso: 'Philippine peso', dirham: 'Dirham', colombian_peso: 'Colombian peso',
  riyal: 'Riyal', ringgit: 'Ringgit', leu: 'Leu', argentine_peso: 'Argentine peso', uruguayan_peso: 'Uruguayan peso', peruvian_sol: 'Peruvian sol',
  vietnamese_dong: 'Vietnamese dong', pakistani_rupee: 'Pakistani rupee', nigerian_naira: 'Nigerian naira', bitcoin: 'Bitcoin',
};

export const PRECISIONS: { id: string; label: string }[] = [
  { id: 'precision_uncapped', label: 'Default' }, { id: 'precision_0', label: '1' }, { id: 'precision_1', label: '1.0' }, { id: 'precision_2', label: '1.00' },
  { id: 'precision_3', label: '1.000' }, { id: 'precision_4', label: '1.0000' }, { id: 'precision_5', label: '1.00000' },
];

const NUMERIC_RESULT = new Set<Aggregator>(['count', 'count_values', 'unique', 'empty', 'not_empty', 'percent_empty', 'percent_not_empty', 'sum', 'average', 'median', 'min', 'max', 'range', 'checked', 'unchecked', 'percent_checked', 'percent_unchecked', 'count_per_group', 'percent_per_group']);

export function aggregationLabel(spec: AggregationSpec | undefined): string {
  const a = aggregatorName(spec);
  if (typeof spec === 'object') return `${AGGREGATION_LABEL[a]} (${spec.groupName})`;
  return AGGREGATION_LABEL[a] ?? 'Show original';
}


export function calculateMenu(targetType: string | undefined, current: AggregationSpec | undefined, onPick: (spec: AggregationSpec) => void, statusGroups?: string[]): MenuItemDef[] {
  const valueType = aggregationValueType(targetType);
  const allowed = new Set<Aggregator>(['show_original', ...(AGGREGATIONS_BY_TYPE[valueType] ?? AGGREGATIONS_BY_TYPE.text)]);
  const cur = aggregatorName(current);
  const item = (a: Aggregator): MenuItemDef => ({ id: a, label: AGGREGATION_LABEL[a], checked: cur === a && typeof current !== 'object', onSelect: () => onPick(a) });
  const bucket = (label: string, list: Aggregator[]): MenuItemDef | null => {
    const items = list.filter((a) => allowed.has(a) && a !== 'count_per_group' && a !== 'percent_per_group').map(item);
    const perGroup = list.find((a) => (a === 'count_per_group' || a === 'percent_per_group') && allowed.has(a));
    if (perGroup && statusGroups?.length) {
      items.push({
        id: perGroup, label: AGGREGATION_LABEL[perGroup],
        submenu: () => ({ sections: [{ items: statusGroups.map((g) => ({ label: g, checked: typeof current === 'object' && current.operator === perGroup && current.groupName === g, onSelect: () => onPick({ operator: perGroup as 'count_per_group', groupName: g }) })) }] }),
      });
    }
    if (!items.length) return null;
    return { id: label, label, submenu: () => ({ width: 250, sections: [{ items }] }) };
  };
  const out: MenuItemDef[] = [item('show_original')];
  if (allowed.has('show_unique')) out.push(item('show_unique'));
  for (const b of [bucket('Count', AGGREGATION_BUCKETS.count), bucket('Percent', AGGREGATION_BUCKETS.percent), bucket('More options', AGGREGATION_BUCKETS.more), bucket('Date', AGGREGATION_BUCKETS.date)]) if (b) out.push(b);
  return out;
}

function parentOf(el: Element | null): number | undefined {
  const o = el?.closest('[data-overlay-id]') as HTMLElement | null;
  return o ? Number(o.dataset.overlayId) : undefined;
}


export function RollupConfigBody({ collectionId, propertyId }: { collectionId: string; propertyId: string }) {
  useTableVersion(['collection']);
  const col = useCollection(collectionId);
  const ps = col?.schema[propertyId];
  if (!col || !ps) return null;
  const relId = ps.relation_property as string | undefined;
  const rel = relId ? col.schema[relId] : undefined;
  const target = getCollection(rel?.collection_id as string | undefined);
  const targetPropId = ps.target_property as string | undefined;
  const tps: PropertySchema | undefined = targetPropId ? target?.schema[targetPropId] : undefined;
  const spec = ps.aggregation as AggregationSpec | undefined;
  const agg = aggregatorName(spec);
  const numeric = NUMERIC_RESULT.has(agg) || (agg === 'show_original' && tps?.type === 'number');
  const relations = Object.entries(col.schema).filter(([, p]) => p.type === 'relation');
  const set = (patch: Partial<PropertySchema>) => updateRollup(collectionId, propertyId, patch);
  const showAs = (ps.show_as as { type?: string } | undefined)?.type ?? 'number';
  const menu = (e: React.MouseEvent<HTMLDivElement>, def: Parameters<typeof openMenu>[1]) => openMenu(e.currentTarget, def, { placement: 'right-start', parent: parentOf(e.currentTarget) });
  return (
    <div className="nc-menu-section nc-adv-config" data-menu-keys="ignore">
      <ConfigRow icon="relation" label="Relation" value={rel?.name ?? 'Select'} onClick={(e) => menu(e, {
        width: 280,
        sections: [{ items: relations.length ? relations.map(([id, p]) => ({ label: p.name, icon: 'relation', checked: id === relId, onSelect: () => set({ relation_property: id, target_property: 'title', target_property_type: 'title', aggregation: 'show_original' }) })) : [{ label: 'No relations in this data source', disabled: true }] }],
      })} />
      <ConfigRow icon="rollup" label="Property" value={tps?.name ?? (targetPropId === 'title' && target ? target.schema.title?.name ?? 'Name' : 'Select')} disabled={!rel} tooltip={rel ? undefined : 'Choose a link first.'} onClick={(e) => target && menu(e, {
        width: 280, search: 'Find a field…',
        
        sections: [{ items: Object.entries(target.schema).map(([id, p]) => ({ label: p.name, icon: propertyIconFor(p.type), checked: id === targetPropId, disabled: p.type === 'rollup' && id !== targetPropId, onSelect: () => set({ target_property: id, target_property_type: p.type, aggregation: 'show_original' }) })) }],
      })} />
      <ConfigRow icon="formula" label="Calculate" value={aggregationLabel(spec)} disabled={!rel || !targetPropId} tooltip={rel && targetPropId ? undefined : 'Choose a link and field first.'} onClick={(e) => menu(e, {
        width: 200,
        sections: [{ items: calculateMenu(tps?.type ?? (targetPropId === 'title' ? 'title' : undefined), spec, (s) => set({ aggregation: s as unknown as string }), tps?.type === 'status' ? (tps.groups ?? []).map((g) => g.name) : undefined) }],
      })} />
      {numeric && (
        <>
          <ConfigRow icon={<span style={{ width: 20 }} />} label="Number format" value={NUMBER_FORMAT_LABEL[(ps.number_format as string) ?? 'number'] ?? 'Number'} onClick={(e) => menu(e, {
            width: 250, search: 'Search',
            sections: [{ items: NUMBER_FORMATS.map((f) => ({ label: NUMBER_FORMAT_LABEL[f] ?? f, checked: ((ps.number_format as string) ?? 'number') === f, onSelect: () => set({ number_format: f }) })) }],
          })} />
          <ConfigRow icon={<span style={{ width: 20 }} />} label="Decimal places" value={PRECISIONS.find((p) => p.id === ((ps.number_precision as string) ?? 'precision_uncapped'))?.label ?? 'Default'} onClick={(e) => menu(e, {
            width: 200,
            sections: [{ items: PRECISIONS.map((p) => ({ label: p.label, checked: ((ps.number_precision as string) ?? 'precision_uncapped') === p.id, onSelect: () => set({ number_precision: p.id }) })) }],
          })} />
          <div className="nc-menu-section-title" style={{ marginTop: 10 }}>Show as</div>
          <ShowAsPicker value={showAs} onChange={(v) => set({ show_as: v === 'number' ? undefined : { type: v, color: 'green', maxValue: agg.startsWith('percent') ? 1 : 100, showValue: true } })} />
          <div className="nc-rollup-hint">Changes apply to all layouts showing this field.</div>
        </>
      )}
    </div>
  );
}

function RollupPanel({ collectionId, propertyId, close }: { collectionId: string; propertyId: string; close: () => void }) {
  return (
    <div className="nc-rel-panel" style={{ width: 300 }} role="dialog" aria-label="Rollup">
      <RollupConfigBody collectionId={collectionId} propertyId={propertyId} />
      <div className="nc-rel-foot">
        <ConfigRow icon="check" label="Done" chevron={false} onClick={close} />
      </div>
    </div>
  );
}


export function openRollupConfig(anchor: Anchor | null | undefined, opts: { collectionId: string; propertyId: string; onClose?: () => void }): () => void {
  return openOverlay((close) => <RollupPanel collectionId={opts.collectionId} propertyId={opts.propertyId} close={close} />, {
    anchor: anchor ?? undefined, placement: anchor ? 'right-start' : 'center', backdrop: 'transparent', onClose: opts.onClose,
  });
}

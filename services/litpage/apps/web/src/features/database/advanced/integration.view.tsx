// Registers the advanced (formula / relation / rollup) UI with the database core's extension points
// (properties/editorRegistry.ts). Named *.view.tsx so the feature auto-import glob loads it at startup.
import type { CollectionRecord } from '@nc/shared/records.ts';
import { formulaResultType, NUMBER_FORMATS } from '@nc/shared/formula/index.ts';
import { openMenu } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { run } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { registerCellEditor, registerPropertyConfig, registerPropertyCreated, type PropertyConfigProps } from '../properties/editorRegistry.ts';
import { getCollection, collectionName } from './context.ts';
import { openFormulaEditor } from './FormulaEditor.tsx';
import { openRelationConfig } from './RelationConfig.tsx';
import { openRollupConfig, RollupConfigBody, NUMBER_FORMAT_LABEL, PRECISIONS } from './RollupConfig.tsx';
import { openRelationPicker } from './RelationPicker.tsx';
import { setRelationLimit, setRelationTwoWay } from './relations.ts';
import { ConfigRow, ShowAsPicker } from './ui.tsx';
import { COLOR_LABELS } from '@nc/shared/colors.ts';
import { OPTION_COLORS } from '@nc/shared/database/index.ts';
import { ColorSwatch } from '../properties/editors/SelectEditor.tsx';
import { Toggle } from '../properties/editors/DatePicker.tsx';

function parentOf(el: Element | null): number | undefined {
  const o = el?.closest('[data-overlay-id]') as HTMLElement | null;
  return o ? Number(o.dataset.overlayId) : undefined;
}

type ShowAsConfig = { type?: string; color?: string; maxValue?: number; showValue?: boolean };


function ShowAsSettings({ show, onChange }: { show: ShowAsConfig; onChange: (patch: Partial<ShowAsConfig>) => void }) {
  const color = show.color ?? 'green';
  return (
    <div className="nc-show-as-settings nc-fx-show-as-settings" data-menu-keys="ignore">
      <div className="nc-show-as-row">
        <span>Color</span>
        <span role="button" className="nc-show-as-color" onClick={(e) => openMenu(e.currentTarget, {
          width: 190,
          sections: [{ items: OPTION_COLORS.filter((c) => c !== 'default').map((c) => ({ id: c, label: COLOR_LABELS[c], icon: <ColorSwatch color={c} />, checked: color === c, onSelect: () => onChange({ color: c }) })) }],
        }, { placement: 'bottom-end', parent: parentOf(e.currentTarget) })}>
          <ColorSwatch color={color} />
          {COLOR_LABELS[color as keyof typeof COLOR_LABELS] ?? 'Green'}
          <Icon name="arrowChevronSingleDownSmall" size={14} />
        </span>
      </div>
      <div className="nc-show-as-row">
        <span>Divide by</span>
        <span className="nc-input nc-show-as-divide">
          <input aria-label="Divide by" defaultValue={String(show.maxValue ?? 100)} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n > 0) onChange({ maxValue: n }); else e.target.value = String(show.maxValue ?? 100); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        </span>
      </div>
      <div className="nc-show-as-row">
        <span>Show number</span>
        <Toggle on={show.showValue !== false} onChange={(v) => onChange({ showValue: v })} />
      </div>
    </div>
  );
}

function FormulaConfig({ collection, propId, prop }: PropertyConfigProps) {
  const type = formulaResultType(prop, collection.schema, { getCollection: (id) => records.get<CollectionRecord>('collection', id), collectionId: collection.id });
  const set = (patch: Record<string, unknown>) => run('updateProperty', (tx) => tx.update('collection', collection.id, ['schema', propId], patch));
  const show = (prop.show_as as ShowAsConfig | undefined) ?? {};
  const showAs = show.type ?? 'number';
  return (
    <div className="nc-menu-section nc-adv-config" data-menu-keys="ignore">
      <ConfigRow icon="pencil" label="Edit formula" onClick={(e) => openFormulaEditor(e.currentTarget, { collectionId: collection.id, propertyId: propId })} />
      {type.type === 'number' && (
        <>
          <ConfigRow label="Number format" value={NUMBER_FORMAT_LABEL[(prop.number_format as string) ?? 'number'] ?? 'Number'} onClick={(e) => openMenu(e.currentTarget, {
            width: 250, search: 'Search',
            sections: [{ items: NUMBER_FORMATS.map((f) => ({ label: NUMBER_FORMAT_LABEL[f] ?? f, checked: ((prop.number_format as string) ?? 'number') === f, onSelect: () => set({ number_format: f }) })) }],
          }, { placement: 'right-start', parent: parentOf(e.currentTarget) })} />
          <ConfigRow label="Decimal places" value={PRECISIONS.find((p) => p.id === ((prop.number_precision as string) ?? 'precision_uncapped'))?.label ?? 'Default'} onClick={(e) => openMenu(e.currentTarget, {
            width: 200,
            sections: [{ items: PRECISIONS.map((p) => ({ label: p.label, checked: ((prop.number_precision as string) ?? 'precision_uncapped') === p.id, onSelect: () => set({ number_precision: p.id }) })) }],
          }, { placement: 'right-start', parent: parentOf(e.currentTarget) })} />
          <div className="nc-menu-section-title" style={{ marginTop: 10 }}>Show as</div>
          <ShowAsPicker value={showAs} onChange={(v) => set({ show_as: v === 'number' ? undefined : { color: 'green', maxValue: 100, showValue: true, ...show, type: v } })} />
          {showAs !== 'number' && <ShowAsSettings show={show} onChange={(patch) => set({ show_as: { color: 'green', maxValue: 100, showValue: true, ...show, ...patch } })} />}
          <div className="nc-rollup-hint">Changes apply to all layouts showing this field.</div>
        </>
      )}
    </div>
  );
}

function RelationConfigSection({ collection, propId, prop }: PropertyConfigProps) {
  const target = getCollection(prop.collection_id as string | undefined);
  const twoWay = !!prop.property && prop.property !== propId;
  if (!target) {
    return (
      <div className="nc-menu-section nc-adv-config" data-menu-keys="ignore">
        <ConfigRow icon="collectionArrow" label="Related to" value="Select" onClick={(e) => openRelationConfig(e.currentTarget, { collectionId: collection.id, propertyId: propId })} />
      </div>
    );
  }
  return (
    <div className="nc-menu-section nc-adv-config" data-menu-keys="ignore">
      <ConfigRow icon="collectionArrow" label="Related to" chevron={false} disabled value={<><Icon name="databaseEmbed" size={14} color="var(--lp-icon-tertiary)" /><span style={{ color: 'var(--lp-text-secondary)', fontWeight: 500 }}>{collectionName(target)}</span></>} />
      <ConfigRow icon="numberProp" label="Limit" value={prop.limit === 1 ? '1 page' : 'No limit'} onClick={(e) => openMenu(e.currentTarget, {
        width: 250,
        sections: [{ items: [
          { label: '1 page', checked: prop.limit === 1, onSelect: () => setRelationLimit(collection.id, propId, 1) },
          { label: 'No limit', checked: prop.limit !== 1, onSelect: () => setRelationLimit(collection.id, propId, undefined) },
        ] }],
      }, { placement: 'right-start', parent: parentOf(e.currentTarget) })} />
      <ConfigRow icon="fullWidth" label="Bidirectional link" value={twoWay ? 'On' : 'Off'} onClick={(e) => openMenu(e.currentTarget, {
        width: 250,
        sections: [{ items: [
          { label: 'On', checked: twoWay, onSelect: () => setRelationTwoWay(collection.id, propId, true) },
          { label: 'Off', checked: !twoWay, onSelect: () => setRelationTwoWay(collection.id, propId, false) },
        ] }],
      }, { placement: 'right-start', parent: parentOf(e.currentTarget) })} />
    </div>
  );
}

function RollupConfigSection({ collection, propId }: PropertyConfigProps) {
  return <RollupConfigBody collectionId={collection.id} propertyId={propId} />;
}

registerPropertyConfig('formula', FormulaConfig);
registerPropertyConfig('relation', RelationConfigSection);
registerPropertyConfig('rollup', RollupConfigSection);

// "+ Add property" › Relation opens the "Related to" picker; abandoning it removes the placeholder property.
registerPropertyCreated('relation', ({ anchor, collectionId, propId }) => {
  openRelationConfig(anchor, {
    collectionId,
    propertyId: propId,
    onClose: () => {
      const c = getCollection(collectionId);
      const p = c?.schema[propId];
      if (c && p && p.type === 'relation' && !p.collection_id) run('removeUnconfiguredRelation', (tx) => tx.set('collection', collectionId, ['schema', propId], undefined), { skipHistory: true });
    },
  });
});
registerPropertyCreated('rollup', ({ anchor, collectionId, propId }) => openRollupConfig(anchor, { collectionId, propertyId: propId }));
registerPropertyCreated('formula', ({ anchor, collectionId, propId }) => openFormulaEditor(anchor, { collectionId, propertyId: propId }));

registerCellEditor('relation', (anchor, opts) => openRelationPicker(anchor, { rowIds: opts.rowIds, propId: opts.propId, collectionId: opts.collectionId, onClose: opts.onClose }));

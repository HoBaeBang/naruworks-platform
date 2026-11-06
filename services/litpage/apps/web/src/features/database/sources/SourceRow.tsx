// View settings / New view › "Source" row: with one data source it is the dimmed, inert row of the 
// view-settings; with several (or to link another database's source) it opens the list of the database's sources,
// checked on the view's, + "Link an existing dataset".
import type { BlockRecord, CollectionRecord, CollectionViewRecord } from '@nc/shared/records.ts';
import { useBlock, useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { openMenu } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { VSRow as Row } from '../chrome/ViewSettings.tsx';
import { openLinkedSourcePicker } from '../chrome/LinkedSourcePicker.tsx';
import { overlayIdOf } from '../properties/PropertyMenus.tsx';
import { blockSources, setViewSource, sourceIdOfView, sourceName } from './sources.ts';

export function SourceRow({ block: blockIn, view, collection, readOnly, allowLink }: { block: BlockRecord; view: CollectionViewRecord; collection: CollectionRecord; readOnly: boolean; allowLink?: boolean }) {
  useTableVersion(['collection']);
  const block = useBlock(blockIn.id) ?? blockIn;
  const { owned, linked } = blockSources(block);
  const choices = [...owned, ...linked].filter((c) => view.type !== 'form' || c.parent_id === block.id);
  const enabled = !readOnly && (choices.length > 1 || !!allowLink) && view.type !== 'form';
  const name = sourceName(collection) || 'Untitled';
  if (!enabled) return <Row icon="pathRoundEnds" label="Source" value={name} chevron={false} disabled />;
  const current = sourceIdOfView(view, block);
  return (
    <Row
      icon="pathRoundEnds"
      label="Source"
      value={name}
      testid="view-source-row"
      onClick={(e) => {
        const anchor = e.currentTarget;
        openMenu(anchor, {
          width: 260,
          sections: [
            { title: 'Data sources', items: choices.map((c) => ({ id: c.id, label: sourceName(c) || 'Untitled', icon: 'collection', checked: c.id === current, onSelect: () => setViewSource(view, records.get<BlockRecord>('block', block.id) ?? block, c) })) },
            { items: [{ id: 'link', label: 'Link an existing dataset', icon: <Icon name="arrowDiagonalUpRight" size={16} />, onSelect: () => {
              setTimeout(() => openLinkedSourcePicker(anchor, {
                skipViewStep: true,
                exclude: choices.map((c) => c.id),
                onPick: (target) => setViewSource(view, records.get<BlockRecord>('block', block.id) ?? block, target),
              }), 0);
            } }] },
          ],
        }, { placement: 'bottom-end', parent: overlayIdOf(anchor), backdrop: 'transparent' });
      }}
    />
  );
}

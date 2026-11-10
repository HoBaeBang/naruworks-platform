// Inline database block (`collection_view`): renders DatabaseView with the inline chrome; top-level blocks

import type { BlockRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { useBlock } from '../../lib/hooks.ts';
import { setProperty } from '../../lib/blocks.ts';
import { DatabaseView } from './DatabaseView.tsx';
import { createRow } from './actions.ts';
import { useCollectionRows } from './data.ts';
import { viewIcon } from './chrome/ViewTabs.tsx';
import { useDatabaseAccess } from './access.ts';
import './views/table/TableView.view.tsx';
import './duplicate.ts'; // ⌘D / Duplicate copies the data source.
import './blockMenu.tsx'; // ⋮⋮ Turn into page / inline database, Duplicate with / without content
import './rowPageDrag.ts'; // pages dragged onto a database become items; table rows dragged onto the page become pages

function DatabaseBlock({ block, readOnly, depth }: BlockProps) {
  const b = useBlock(block.id) ?? block;
  
  const access = useDatabaseAccess(b.id);
  const dataRO = readOnly && !access.canEditContent;
  return (
    <div className="nc-db-block" data-block-id={b.id}>
      <DatabaseView block={b} inline readOnly={dataRO} structureReadOnly={readOnly || !access.canEditStructure} canAddRows={!dataRO || access.canCreate} bleed={depth === 0} />
    </div>
  );
}

registerBlock(['collection_view'], DatabaseBlock);


export function addRow(block: BlockRecord, props?: Record<string, RichText>) {
  if (!block.collection_id) return '';
  return createRow(block.collection_id, { properties: props });
}

export { setProperty, useCollectionRows, viewIcon };

// Full-page database (collection_view_page, or an inline database opened as a page): page controls
// (Add icon / Add cover / Add description), icon, 32px/700 title (collection.name), description, then the
// tabs row + view with 96px side padding.
import { useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import type { RichText } from '@nc/shared/richtext.ts';
import { useBlock, useCollection } from '../../lib/hooks.ts';
import { run, setFormat } from '../../lib/blocks.ts';
import { Icon } from '../../components/Icon.tsx';
import { RichTextEditable } from '../editor/RichTextEditable.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { openIconPicker, randomEmoji } from '../page/IconPicker.tsx';
import { PageCover, randomCover } from '../page/Cover.tsx';
import { DatabaseView } from './DatabaseView.tsx';
import { collectionOfBlock } from './data.ts';
import { useDatabaseAccess } from './access.ts';
import './views/table/TableView.view.tsx';

export function CollectionPage({ block, inPeek }: { block: BlockRecord; inPeek?: boolean }) {
  const b = useBlock(block.id) ?? block;
  const col = useCollection(collectionOfBlock(b)?.id ?? b.collection_id);
  
  const access = useDatabaseAccess(b.id);
  const readOnly = !access.canEditStructure;
  const [hover, setHover] = useState(false);
  const [showDesc, setShowDesc] = useState(false);
  const icon = b.format?.page_icon as string | undefined;
  const hasCover = !!b.format?.page_cover;
  const desc = (col?.description as RichText | undefined) ?? [];
  const linked = !!col && col.parent_id !== b.id;
  const header = (
    <div className="nc-db-page-header" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      {hasCover && <div className="nc-db-page-cover"><PageCover page={b} readOnly={readOnly} /></div>}
      {icon && (
        <div className={`nc-db-page-icon ${hasCover ? 'with-cover' : ''}`} role="button" onClick={(e) => !readOnly && openIconPicker(e.currentTarget, { current: icon, onPick: (v) => run('setPageIcon', (tx) => setFormat(tx, b.id, { page_icon: (v ?? null) as any })) })}>
          <PageIcon block={b} size={78} fallback={null} />
        </div>
      )}
      <div className="lit-page-controls nc-db-page-controls" style={{ opacity: hover && !readOnly ? 1 : 0, pointerEvents: hover && !readOnly ? 'auto' : 'none' }}>
        {!icon && (
          <div role="button" className="nc-page-control" onClick={() => run('addPageIcon', (tx) => setFormat(tx, b.id, { page_icon: randomEmoji() }))}>
            <Icon name="emojiFace" size={14} />Add icon
          </div>
        )}
        {!hasCover && (
          <div role="button" className="nc-page-control" onClick={() => run('addPageCover', (tx) => setFormat(tx, b.id, { page_cover: randomCover(), page_cover_position: 0.5 }))}>
            <Icon name="photo" size={14} />Add cover
          </div>
        )}
        {!desc.length && !showDesc && (
          <div role="button" className="nc-page-control" onClick={() => setShowDesc(true)}>
            <Icon name="info" size={14} />Add description
          </div>
        )}
      </div>
      <div className="lit-collection_view_page-block nc-db-page-title-wrap">
        {col && (
          <RichTextEditable
            blockId={col.id}
            property="name"
            value={(col.name as RichText | undefined) ?? []}
            readOnly={readOnly || linked}
            tagName="h1"
            className="content-editable-leaf-rtl nc-db-page-title"
            placeholder="New database"
            placeholderAlways
            onChange={(next) => run('renameDatabase', (tx) => tx.set('collection', col.id, ['name'], next), { coalesceKey: `dbname:${col.id}` })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault();
                (e.currentTarget as HTMLElement).blur();
              }
            }}
          />
        )}
      </div>
      {col && (desc.length > 0 || showDesc) && (
        <div className="nc-db-page-description">
          <RichTextEditable
            blockId={col.id}
            property="description"
            value={desc}
            readOnly={readOnly}
            className="nc-db-page-description-leaf"
            placeholder="Add a description…"
            placeholderAlways
            onChange={(next) => run('setDatabaseDescription', (tx) => tx.set('collection', col.id, ['description'], next), { coalesceKey: `dbdesc:${col.id}` })}
            onBlur={() => setShowDesc(false)}
          />
        </div>
      )}
    </div>
  );
  return (
    <div className={`lit-scroller vertical nc-page-scroller nc-db-page ${inPeek ? 'in-peek' : ''}`} data-page-id={b.id}>
      <DatabaseView block={b} inline={false} readOnly={!access.canEditContent} structureReadOnly={readOnly} canAddRows={access.canCreate} header={header} pad={inPeek ? 76 : 96} documentTitle={!inPeek} />
    </div>
  );
}

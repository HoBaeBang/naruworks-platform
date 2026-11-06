// Breadcrumb block: block 44px; items role=button, 16px
// (line-height 19.2px) padding 2px 6px r6 (icon + title when the page has an icon); separator "/" in
// var(--lp-border-primary) rgb(250, 250, 250). Path = workspace ancestors → current page.
import type { BlockRecord } from '@nc/shared/records.ts';
import { registerBlock, type BlockProps } from '../Block.tsx';
import { useTableVersion } from '../../../lib/hooks.ts';
import { ancestorsOf, getBlock } from '../../../lib/blocks.ts';
import { openPage } from '../../../lib/router.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { pageIdOfBlock } from '../commands.ts';
import { registerBlockMenu } from './registry.ts';

function Breadcrumb({ block }: BlockProps) {
  useTableVersion(['block']);
  const pageId = pageIdOfBlock(block.id);
  const page = getBlock(pageId);
  const chain: BlockRecord[] = page ? [...ancestorsOf(page.id), page] : [];
  return (
    <div className="nc-bpad">
      <div className="nc-breadcrumb-2" role="navigation" aria-label="Breadcrumb">
        {chain.map((p, i) => (
          <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <span role="button" tabIndex={0} className="nc-crumb" onMouseDown={(e) => e.preventDefault()} onClick={() => openPage(p.id)}>
              {p.format?.page_icon ? <PageIcon block={p} size={18} fallback={null} /> : null}
              <span>{pageTitle(p) || (p.type === 'collection_view_page' ? 'Untitled' : 'New page')}</span>
            </span>
            {i < chain.length - 1 && <span className="nc-crumb-sep">/</span>}
          </span>
        ))}
      </div>
    </div>
  );
}

registerBlock(['breadcrumb'], Breadcrumb);
registerBlockMenu(['breadcrumb'], () => []);

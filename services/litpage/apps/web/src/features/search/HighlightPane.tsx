// Quick Find highlight pane (aside 406px, card 520px, radius 12): cover strip (80px), path, title (20px/600) and a
// simplified live preview of the page content; floating Copy link / Open in new tab buttons.
// Preview text: headings 17/15/14/13px 600, body text 13px/18px.
import { useEffect, useState, type ReactNode } from 'react';
import type { BlockRecord, CollectionRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { useBlock, useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { ancestorsOf } from '../../lib/blocks.ts';
import { pageUrl } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { loadPage } from '../page/usePageLoader.ts';
import { copyPageLink, pageTitle } from '../page/pageActions.ts';
import { t } from '../shell/i18n.ts';

const MAX_BLOCKS = 40;

function coverStyle(cover: string): React.CSSProperties {
  if (/^(https?:|\/files\/|data:)/.test(cover)) return { backgroundImage: `url("${cover}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  if (cover.startsWith('/images/') || cover.startsWith('gradient')) return { background: 'var(--lp-bg-secondary)' };
  if (cover.startsWith('#') || cover.startsWith('linear-gradient') || cover.startsWith('rgb')) return { background: cover };
  return { background: 'var(--lp-bg-secondary)' };
}

export function HighlightPane({ pageId, onOpenNewTab }: { pageId: string | null; onOpenNewTab: (id: string) => void }) {
  const page = useBlock(pageId);
  const [, setTick] = useState(0);
  useTableVersion(['block', 'collection']);
  useEffect(() => {
    if (!pageId) return;
    const tm = setTimeout(() => {
      void loadPage(pageId).then(() => setTick((x) => x + 1));
    }, 120);
    return () => clearTimeout(tm);
  }, [pageId]);
  if (!pageId || !page) return <aside className="nc-qf-aside"><div className="nc-qf-pane nc-qf-pane-empty" /></aside>;
  const path = ancestorsOf(pageId).map((a) => pageTitle(a) || t('lp.search.untitled', 'Untitled'));
  const cover = page.format?.page_cover as string | undefined;
  const icon = page.format?.page_icon as string | undefined;
  return (
    <aside className="nc-qf-aside">
      <div className="nc-qf-pane lit-scroller vertical" data-page-id={pageId}>
        <div className="nc-qf-pane-actions-wrap">
          <div className="nc-qf-pane-actions">
            <div role="button" className="nc-qf-pane-btn" aria-label={t('lp.search.copy_link', 'Copy link')} data-tooltip={t('lp.search.copy_link', 'Copy link')} onClick={() => copyPageLink(pageId)}>
              <Icon name="link" size={16} />
            </div>
            <div role="button" className="nc-qf-pane-btn" aria-label={t('lp.search.open_in_a_new_tab', 'Open in a new tab')} data-tooltip={t('lp.search.open_in_a_new_tab', 'Open in a new tab')} onClick={() => onOpenNewTab(pageId)}>
              <Icon name="arrowDiagonalUpRight" size={16} />
            </div>
          </div>
        </div>
        <div className="nc-qf-pane-cover" style={cover ? coverStyle(cover) : undefined} />
        <div className={`nc-qf-pane-body ${icon ? 'has-icon' : ''}`}>
          {icon && (
            <div className="nc-qf-pane-icon">
              <PageIcon block={page} size={46} />
            </div>
          )}
          {path.length > 0 && (
            <div className="nc-qf-pane-path notranslate">
              {path.length > 3 ? [path[0], '…', ...path.slice(-2)].join(' / ') : path.join(' / ')}
            </div>
          )}
          <a className="nc-qf-pane-title notranslate" href={pageUrl(pageId)} onClick={(e) => e.preventDefault()}>
            {pageTitle(page) || t('lp.search.untitled', 'Untitled')}
          </a>
          <div className="nc-qf-pane-preview">
            <PreviewBlocks page={page} />
          </div>
        </div>
      </div>
    </aside>
  );
}

function PreviewBlocks({ page }: { page: BlockRecord }) {
  if (page.type === 'collection_view_page' || page.type === 'collection_view') {
    return <DatabaseSketch block={page} />;
  }
  const out: ReactNode[] = [];
  let count = 0;
  let num = 0;
  const walk = (ids: string[] | undefined, depth: number) => {
    for (const id of ids ?? []) {
      if (count >= MAX_BLOCKS) return;
      const b = records.get<BlockRecord>('block', id);
      if (!b || !b.alive) continue;
      count++;
      num = b.type === 'numbered_list' ? num + 1 : 0;
      out.push(<PreviewBlock key={id} block={b} depth={depth} index={num} />);
      const descend = depth < 2 && !['page', 'collection_view_page', 'collection_view', 'toggle'].includes(b.type) && !b.format?.toggleable;
      if (descend && b.content?.length && b.type !== 'column_list') walk(b.content, depth + 1);
      if (b.type === 'column_list') for (const col of b.content ?? []) walk(records.get<BlockRecord>('block', col)?.content, depth);
    }
  };
  walk(page.content, 0);
  if (!out.length) return null;
  return <>{out}</>;
}

function text(b: BlockRecord): string {
  return toPlainText(b.properties?.title).replace(/[‣⁍]/g, '');
}

function PreviewBlock({ block: b, depth, index }: { block: BlockRecord; depth: number; index: number }) {
  const indent = { marginInlineStart: depth * 16 };
  switch (b.type) {
    case 'header':
    case 'sub_header':
    case 'sub_sub_header':
    case 'header_4': {
      const lvl = b.type === 'header' ? 1 : b.type === 'sub_header' ? 2 : b.type === 'sub_sub_header' ? 3 : 4;
      const size = [17, 15, 14, 13][lvl - 1];
      const mt = ['1.2em', '1.2em', '1em', '0.8em'][lvl - 1];
      return (
        <div className="nc-qf-pv-heading" style={{ ...indent, marginTop: mt }}>
          {b.format?.toggleable && (
            <span className="nc-qf-pv-caret"><Icon name="arrowCaretDownFillSmall" size={[14, 12, 11, 11][lvl - 1]} style={{ transform: 'rotateZ(-90deg)' }} /></span>
          )}
          <span style={{ fontSize: size, lineHeight: '20px' }}>{text(b)}</span>
        </div>
      );
    }
    case 'bulleted_list':
      return <div className="nc-qf-pv-item" style={indent}><span className="nc-qf-pv-marker">•</span><span>{text(b)}</span></div>;
    case 'numbered_list':
      return <div className="nc-qf-pv-item" style={indent}><span className="nc-qf-pv-marker num">{index || 1}.</span><span>{text(b)}</span></div>;
    case 'to_do': {
      const checked = toPlainText(b.properties?.checked) === 'Yes';
      return (
        <div className="nc-qf-pv-item" style={indent}>
          <span className={`nc-qf-pv-check ${checked ? 'on' : ''}`}>{checked && <Icon name="check" size={10} />}</span>
          <span style={checked ? { textDecoration: 'line-through', opacity: 0.6 } : undefined}>{text(b)}</span>
        </div>
      );
    }
    case 'toggle':
      return <div className="nc-qf-pv-item" style={indent}><span className="nc-qf-pv-caret"><Icon name="arrowCaretDownFillSmall" size={12} style={{ transform: 'rotateZ(-90deg)' }} /></span><span>{text(b)}</span></div>;
    case 'quote':
      return <div className="nc-qf-pv-quote" style={indent}>{text(b)}</div>;
    case 'callout':
      return (
        <div className="nc-qf-pv-callout" style={indent}>
          {(b.format?.page_icon as string | undefined) && <PageIcon block={b} size={16} fallback={null} />}
          <span>{text(b)}</span>
        </div>
      );
    case 'code':
      return <pre className="nc-qf-pv-code" style={indent}>{toPlainText(b.properties?.title).slice(0, 400)}</pre>;
    case 'divider':
      return <div className="nc-qf-pv-divider" />;
    case 'page':
    case 'collection_view_page':
    case 'alias':
    case 'link_to_page': {
      const target = b.type === 'alias' || b.type === 'link_to_page' ? records.get<BlockRecord>('block', (b.format as { alias_pointer?: { id: string } } | undefined)?.alias_pointer?.id) : b;
      return (
        <div className="nc-qf-pv-pagelink" style={indent}>
          <PageIcon block={target} size={16} />
          <span className="nc-ellipsis">{pageTitle(target) || t('lp.search.untitled', 'Untitled')}</span>
        </div>
      );
    }
    case 'collection_view':
      return <DatabaseSketch block={b} />;
    case 'image':
    case 'video':
    case 'embed':
    case 'bookmark':
    case 'file':
    case 'pdf':
      return <div className="nc-qf-pv-media" style={indent} />;
    case 'column_list':
    case 'column':
    case 'table_of_contents':
    case 'breadcrumb':
      return null;
    default: {
      const s = text(b);
      if (!s) return null;
      return <div className="nc-qf-pv-text" style={indent}>{s}</div>;
    }
  }
}

function DatabaseSketch({ block }: { block: BlockRecord }) {
  const col = records.get<CollectionRecord>('collection', block.collection_id);
  const name = toPlainText(col?.name) || t('lp.search.database', 'Database');
  return (
    <div className="nc-qf-pv-db">
      <div className="nc-qf-pv-db-title"><span>{name}</span><span className="nc-qf-pv-db-new" /></div>
      <div className="nc-qf-pv-db-rows">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="nc-qf-pv-db-row">
            <div className="cell first"><span className="dot" /><span className="bar" style={{ width: [80, 30, 60, 40, 70, 40][i] }} /></div>
            <div className="cell" />
            <div className="cell" />
            <div className="cell" />
          </div>
        ))}
      </div>
    </div>
  );
}

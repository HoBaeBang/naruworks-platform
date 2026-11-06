// Developer bar (Settings › Developer › Enable developer features): a strip at the bottom of the page
// frame with the IDs of what you're looking at — Workspace, Page, Block (the block holding the caret / last clicked),
// Database + Data source (database pages, rows and inline databases), User. Click copies the ID, right-click copies it
// without dashes; × or ⌘⌥⇧D hides it.
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { useTableVersion } from '../../lib/hooks.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { DEVELOPER_BAR_SHORTCUT, copyDeveloperId, dataSourcesOf, databaseOfRow, useDeveloperMode } from './developerMode.ts';
import './developerBar.css';

/** Block id of the caret / last pointer-down inside the page content. */
function useActiveBlockId(): string | null {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    const pick = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      const hit = el?.closest?.('[data-block-id]') as HTMLElement | null;
      if (hit && !hit.closest('.nc-dev-bar')) setId(hit.dataset.blockId ?? null);
    };
    const onSel = () => pick(document.getSelection()?.anchorNode ?? null);
    const onDown = (e: PointerEvent) => pick(e.target as Node);
    document.addEventListener('selectionchange', onSel);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('selectionchange', onSel);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, []);
  return id;
}

export function DeveloperBar({ pageId }: { pageId: string | null }) {
  const on = useDeveloperMode((s) => s.on);
  const hidden = useDeveloperMode((s) => s.barHidden);
  if (!on || hidden) return null;
  return <DeveloperBarInner pageId={pageId} />;
}

function DeveloperBarInner({ pageId }: { pageId: string | null }) {
  useTableVersion(['block', 'collection']);
  const spaceId = useSession((s) => s.spaceId);
  const userId = useSession((s) => s.userId);
  const active = useActiveBlockId();
  const page = pageId ? records.get<BlockRecord>('block', pageId) : undefined;
  const block = active && active !== pageId ? records.get<BlockRecord>('block', active) : undefined;

  const items: { key: string; label: string; id: string }[] = [];
  if (spaceId) items.push({ key: 'workspace', label: t('lp.settings.workspace', 'Workspace'), id: spaceId });
  if (page) items.push({ key: 'page', label: t('lp.settings.page', 'Page'), id: page.id });
  if (block && block.type !== 'page') items.push({ key: 'block', label: t('lp.settings.block', 'Block'), id: block.id });
  // database: the page itself, the database a row belongs to, or the inline database in focus
  const dbBlock = block && (block.type === 'collection_view' || block.type === 'collection_view_page') ? block
    : page && page.type === 'collection_view_page' ? page : undefined;
  const row = databaseOfRow(page);
  if (dbBlock) {
    items.push({ key: 'database', label: t('lp.settings.database', 'Database'), id: dbBlock.id });
    for (const s of dataSourcesOf(dbBlock)) items.push({ key: `ds:${s.id}`, label: t('lp.settings.data_source', 'Data source'), id: s.id });
  } else if (row) {
    if (row.databaseId) items.push({ key: 'database', label: t('lp.settings.database', 'Database'), id: row.databaseId });
    items.push({ key: `ds:${row.dataSourceId}`, label: t('lp.settings.data_source', 'Data source'), id: row.dataSourceId });
  }
  if (userId) items.push({ key: 'user', label: t('lp.settings.user', 'User'), id: userId });

  return (
    <div className="nc-dev-bar" role="region" aria-label={t('lp.settings.developer_information', 'Developer information')}>
      <div className="nc-dev-items">
        {items.map((it) => (
          <button
            key={it.key}
            type="button"
            className="nc-dev-item"
            data-kind={it.key.split(':')[0]}
            aria-label={t('lp.settings.copy_id', 'Copy {label} ID', { label: it.label })}
            title={`${t('lp.settings.copy_id_fc74', 'Copy ID ({id})', { id: it.id })}\n${t('lp.settings.copy_without_dashes_via_right_click', 'Copy without dashes via right-click')}`}
            onClick={() => copyDeveloperId(it.label, it.id, { bar: true })}
            onContextMenu={(e) => { e.preventDefault(); copyDeveloperId(it.label, it.id, { bar: true, undashed: true }); }}
          >
            <span className="lbl">{it.label}</span>
            <span className="id">{it.id}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="nc-dev-hide"
        aria-label={t('lp.settings.dismiss_developer_bar', 'Dismiss developer bar')}
        title={t('lp.settings.dismiss_developer_bar_toggle_with', 'Dismiss developer bar (toggle with {shortcut})', { shortcut: DEVELOPER_BAR_SHORTCUT })}
        onClick={() => useDeveloperMode.getState().toggleBar()}
      >
        <Icon name="xMarkSmall" size={14} />
      </button>
    </div>
  );
}

// Backlinks: pages that @-mention or link to this page. Display per Customize page
// (format.page_section_visibility.backlinks): 'popover' (default: an "N backlinks" control above the title),
// 'section' (expanded list under the title) or 'off', chosen in the popover's footer. Backlinks from pages only
// you can see carry a "Private" label; the server already hides other people's private pages.
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { openPage } from '../../lib/router.ts';
import { pageOf, run, setFormat, getBlock } from '../../lib/blocks.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { pageTitle } from './pageActions.ts';
import { PageIcon } from '../shell/PageIcon.tsx';
import { Icon } from '../../components/Icon.tsx';
import { rowLayoutOptions } from '../database/layout/model.ts';
import { t } from '../shell/i18n.ts';
import { shareStateOf } from './ShareMenu.tsx';

export type BacklinksMode = 'section' | 'popover' | 'off';

/** Display mode from format.page_section_visibility.backlinks; by default backlinks show among the title controls. */
export function backlinksMode(page: { format?: any; parent_table?: string; parent_id?: string } | undefined): BacklinksMode {
  const v = page?.format?.page_section_visibility?.backlinks;
  if (v === 'section' || v === 'off' || v === 'popover') return v;
  // database row pages: the layout builder's Heading › Backlinks (Always show / Show on hover / Off)
  const l = rowLayoutOptions(page)?.backlinks;
  return l === 'off' ? 'off' : l === 'show' ? 'section' : 'popover';
}

const cache = new Map<string, string[]>();

export function useBacklinks(pageId: string, enabled = true): string[] {
  const [pages, setPages] = useState<string[]>(() => cache.get(pageId) ?? []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void api('listBacklinks', { block: { id: pageId } }).then((res) => {
      if (!alive) return;
      records.mergeRecordMap(res.recordMap);
      const ids = [...new Set(res.backlinks.map((b: any) => pageOf(b.block_id)?.id).filter((id: string | undefined) => id && id !== pageId))] as string[];
      cache.set(pageId, ids);
      setPages(ids);
    }).catch(() => {});
    return () => { alive = false; };
  }, [pageId, enabled]);
  return enabled ? pages : [];
}

function label(n: number) {
  return t('lp.page.numberofbacklinks_plural_0_one_backlink', '{numberOfBacklinks, plural, =0 {No page references} one {{numberOfBacklinks} page reference} other {{numberOfBacklinks} page references}}', { numberOfBacklinks: n });
}

function Row({ id, onOpen }: { id: string; onOpen?: () => void }) {
  const b = records.get<BlockRecord>('block', id);
  const priv = shareStateOf(b) === 'private';
  return (
    <div role="button" className="nc-backlink" onClick={() => { onOpen?.(); openPage(id); }}>
      <PageIcon block={b} size={18} />
      <span className="nc-ellipsis">{pageTitle(b) || 'New page'}</span>
      {priv && <span className="nc-backlink-private" data-tooltip={t('lp.page.only_you_can_see_this_backlink', 'Only you can see this backlink')}>{t('lp.page.private', 'Private')}</span>}
    </div>
  );
}

const MODES: [BacklinksMode, string][] = [
  ['section', t('lp.page.expanded', 'Expanded')],
  ['popover', t('lp.page.show_in_popover', 'Show in popover')],
  ['off', t('lp.page.off', 'Off')],
];

export function setBacklinksMode(pageId: string, mode: BacklinksMode) {
  const page = getBlock(pageId);
  const sv = ((page?.format as any)?.page_section_visibility ?? {}) as Record<string, string>;
  run('setBacklinksDisplay', (tx) => setFormat(tx, pageId, { page_section_visibility: { ...sv, backlinks: mode } } as any));
}

/** "Show backlinks" choice (popover footer / section header). */
function ModePicker({ pageId, onPicked }: { pageId: string; onPicked?: () => void }) {
  const cur = backlinksMode(records.get<BlockRecord>('block', pageId));
  const editable = ['editor', 'read_and_write'].includes(records.role('block', pageId));
  if (!editable) return null;
  return (
    <div className="nc-backlinks-modes" role="radiogroup" aria-label={t('lp.page.show_backlinks', 'Show backlinks')}>
      <span className="label">{t('lp.page.show_backlinks', 'Show backlinks')}</span>
      {MODES.map(([m, label]) => (
        <span key={m} role="radio" aria-checked={cur === m} className={`opt ${cur === m ? 'on' : ''}`} onClick={() => { setBacklinksMode(pageId, m); onPicked?.(); }}>{label}</span>
      ))}
    </div>
  );
}

/** 'popover' mode: control button among Add icon / Add cover / Add comment. */
export function BacklinksButton({ pageId, pages }: { pageId: string; pages: string[] }) {
  return (
    <div
      role="button"
      className="nc-page-control"
      data-backlinks-for={pageId}
      onClick={(e) => openOverlay((close) => (
        <PopoverSurface width={320} maxHeight={360} className="nc-backlinks-popover">
          <div className="nc-menu-section-title" style={{ margin: '10px 0 6px' }}>{label(pages.length)}</div>
          <div className="lit-scroller vertical" style={{ overflow: 'auto', padding: '0 4px 6px' }}>
            {pages.map((id) => <Row key={id} id={id} onOpen={close} />)}
          </div>
          <ModePicker pageId={pageId} onPicked={close} />
        </PopoverSurface>
      ), { anchor: e.currentTarget, placement: 'bottom-start', offset: 4 })}
    >
      <Icon name="arrowTurnUpRight" size={14} style={{ transform: 'scaleY(-1) rotate(180deg)' }} />
      {label(pages.length)}
    </div>
  );
}

/** 'section' mode: "N backlinks" toggle under the title, expands to the list. */
export function BacklinksSection({ pageId }: { pageId: string }) {
  const pages = useBacklinks(pageId);
  const [open, setOpen] = useState(false);
  if (!pages.length) return null;
  return (
    <div className="nc-backlinks">
      <div role="button" className="nc-backlinks-toggle" onClick={() => setOpen(!open)}>
        <Icon name="arrowTurnUpRight" size={14} style={{ transform: 'scaleY(-1) rotate(180deg)' }} />
        {label(pages.length)}
      </div>
      {open && pages.map((id) => <Row key={id} id={id} />)}
      {open && <ModePicker pageId={pageId} />}
    </div>
  );
}

/** Back-compat: section rendering (older callers). */
export function Backlinks({ pageId }: { pageId: string }) {
  return <BacklinksSection pageId={pageId} />;
}

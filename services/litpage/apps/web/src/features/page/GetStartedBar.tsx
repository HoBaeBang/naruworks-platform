// "Start with" bar on empty pages (Ask AI · AI meeting notes · Database · Form · Templates · •••).
// •••: Table / Board / List / Timeline / Calendar / Gallery, then Import: a database of that layout in the page,
// or the import modal targeting the page.
// Layout: absolutely positioned in the content column at
// top: calc(100vh - 298px) of the editor group — a 140px fade, then a white body (12px/16px title, 12px gap,
// 32px pill chips: padding 6/14/6/10, 20px icons, gap 4, 14px/20px labels) and padding-bottom min(48px, 5vh).
import type { ReactNode } from 'react';
import { Shapes } from 'lucide-react';
import type { ViewType } from '@nc/shared/records.ts';
import { Icon } from '../../components/Icon.tsx';
import { openMenu } from '../../components/Menu.tsx';
import { openImport } from '../import/ImportModal.tsx';
import { getBlock } from '../../lib/blocks.ts';
import { turnPageIntoDatabase } from '../database/createDatabase.ts';
import { useUI } from '../../lib/store/ui.ts';
import { insertMeetingBlock, meetingsEnabled } from '../meetings/entry.ts';
import { policyFromSpaceSettings } from '../ai/aiApi.ts';
import type { SpaceRecord } from '@nc/shared/records.ts';
import { records } from '../../lib/store/records.ts';

export function GetStartedBar({ pageId }: { pageId: string }) {
  // the empty page itself turns into a full-page database (database/createDatabase.ts)
  const toDb = (viewType: ViewType, setupPanel = false) => {
    if (!getBlock(pageId)) return;
    turnPageIntoDatabase(pageId, viewType, { setupPanel });
  };
  const spaceId = getBlock(pageId)?.space_id;
  // no "Ask AI" while the workspace has Litpage AI off
  const aiOn = policyFromSpaceSettings(records.get<SpaceRecord>('space', spaceId ?? '')?.settings as Record<string, unknown> | undefined).enabled;
  const items: [string, ReactNode, () => void][] = [
    ...(aiOn ? [['Ask AI', <span className="nc-chip-ai"><Icon name="aiFace" size={14} /></span>, () => window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail: { pageId } }))] as [string, ReactNode, () => void]] : []),
    // an AI meeting notes block in this page (features/meetings), not offered while the workspace has it off
    ...(meetingsEnabled(spaceId) ? [['AI meeting notes', <Icon name="paperMicrophone" size={20} />, () => insertMeetingBlock(pageId)] as [string, ReactNode, () => void]] : []),
    ['Database', <Icon name="viewTable" size={20} />, () => toDb('table', true)],
    ['Form', <Icon name="page" size={20} />, () => toDb('form')],
    ['Templates', <Shapes size={20} aria-hidden />, () => useUI.getState().set({ templatesOpen: true })],
  ];
  const openMore = (anchor: HTMLElement) => {
    const views: [ViewType, string, string][] = [
      ['table', 'Table', 'dbViewTable'], ['board', 'Board', 'dbViewBoard'], ['list', 'List', 'dbViewList'],
      ['timeline', 'Timeline', 'dbViewTimeline'], ['calendar', 'Calendar', 'dbViewCalendar'], ['gallery', 'Gallery', 'dbViewGallery'],
    ];
    openMenu(anchor, {
      width: 200,
      sections: [
        { items: views.map(([type, label, icon]) => ({ label, icon, onSelect: () => toDb(type) })) },
        { items: [{ label: 'Import', icon: 'import', onSelect: () => openImport({ pageId }) }] },
      ],
    }, { placement: 'top-start', offset: 6 });
  };
  return (
    <div className="nc-get-started" contentEditable={false} data-content-editable-void="true">
      <div role="menu" aria-orientation="horizontal" className="nc-get-started-menu">
        <div className="nc-get-started-fade" />
        <div className="nc-get-started-body">
          <div className="nc-get-started-title">Start with</div>
          <div className="nc-get-started-row">
            {items.map(([label, icon, fn]) => (
              <div key={label} role="button" className="nc-chip" onClick={fn}>
                {icon}
                <span className="nc-chip-label">{label}</span>
              </div>
            ))}
            <div role="button" aria-label="More" className="nc-chip icon" onClick={(e) => openMore(e.currentTarget)}><Icon name="ellipsis" size={20} /></div>
          </div>
        </div>
      </div>
    </div>
  );
}

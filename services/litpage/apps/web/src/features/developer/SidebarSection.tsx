// Sidebar "Developer" section: Connections and Access tokens, opening the in-app developer tools.
// It shows when the layout has a Developer section (Customize sidebar › Add section › Developer) and, with Settings ›
// Developer tools appear at the end of the first tab when enabled in Settings.
import { useMemo } from 'react';
import { useLocation } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { t } from '../shell/i18n.ts';
import { SectionShell } from '../shell/sidebar/Sections.tsx';
import { useSidebarMode, type SidebarLayout, type SidebarSection } from '../shell/sidebar/model.ts';
import { useDeveloperMode } from '../settings/developerMode.ts';
import { useMeetingsTabHidden } from '../meetings/entry.ts';
import { openDevelopers } from './api.ts';
import './developer.css';

export function DeveloperSection({ section }: { section: SidebarSection }) {
  const { route } = useLocation();
  const tab = route.name === ('developers' as string) ? (route as unknown as { tab?: string }).tab : undefined;
  const rows: [string, string, string, string][] = [
    ['connections', t('lp.developer.connections', 'Connections'), 'squareGrid2X2', 'connections'],
    ['personal-access-tokens', t('lp.developer.personal_access_tokens', 'Access tokens'), 'key', 'personal-access-tokens'],
  ];
  return (
    <SectionShell section={section}>
      <div className="nc-sb-tree" data-testid="sidebar-developer">
        {rows.map(([key, label, icon, target]) => (
          <div key={key} role="button" className={`nc-sb-row nc-dev-sb-row ${route.name === ('developers' as string) && (tab ?? 'connections') === key ? 'selected' : ''}`} onClick={() => openDevelopers(target)}>
            <div className="nc-sb-row-inner">
              <div className="nc-sb-row-icon"><Icon name={icon} size={18} /></div>
              <div className="nc-sb-row-label">{label}</div>
            </div>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

const AUTO_SECTION: SidebarSection = { id: 'sec-developer-auto', type: 'developer' } as SidebarSection;

/** Sidebar layout as shown: developer mode adds the Developer section; a hidden / disabled Meetings tab disappears. */
export function useShownSidebarLayout(layout: SidebarLayout): SidebarLayout {
  const dev = useDeveloperMode((s) => s.on);
  const customizing = useSidebarMode((s) => s.customizing);
  const hideMeetings = useMeetingsTabHidden();
  return useMemo(() => {
    let tabs = layout.tabs;
    if (hideMeetings && tabs.some((x) => x.icon === 'meetings') && tabs.length > 1) tabs = tabs.filter((x) => x.icon !== 'meetings');
    // (not while customizing: the section isn't part of the saved layout)
    if (dev && !customizing && !tabs.some((x) => x.sections.some((s) => s.type === 'developer')) && tabs[0]) {
      tabs = [{ ...tabs[0], sections: [...tabs[0].sections, AUTO_SECTION] }, ...tabs.slice(1)];
    }
    return tabs === layout.tabs ? layout : { ...layout, tabs };
  }, [layout, dev, hideMeetings, customizing]);
}

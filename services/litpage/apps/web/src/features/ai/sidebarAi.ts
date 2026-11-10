
// and every "New chat" shortcut disappear (the saved layout is kept, so they come back when AI is turned on again).
import { useMemo } from 'react';
import type { SidebarLayout } from '../shell/sidebar/model.ts';
import { useCurrentSpace } from '../../lib/hooks.ts';
import { policyFromSpaceSettings } from './aiApi.ts';

export function useAiSidebarLayout(layout: SidebarLayout): SidebarLayout {
  const space = useCurrentSpace();
  const enabled = policyFromSpaceSettings(space?.settings as Record<string, unknown> | undefined).enabled;
  return useMemo(() => {
    if (enabled) return layout;
    const tabs = layout.tabs
      .filter((tab, _i, all) => tab.icon !== 'chat' || all.every((x) => x.icon === 'chat'))
      .map((tab) => (tab.shortcuts.some((s) => s.type === 'new_chat') ? { ...tab, shortcuts: tab.shortcuts.filter((s) => s.type !== 'new_chat') } : tab));
    return { ...layout, tabs };
  }, [layout, enabled]);
}

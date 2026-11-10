// Global modals/panels: search (⌘K), settings, trash, inbox, templates, import, shortcuts, right panels.
import { useUI } from '../../lib/store/ui.ts';
import { SearchModal } from '../search/SearchModal.tsx';
import { SettingsModal } from '../settings/SettingsModal.tsx';
import { TrashModal } from './TrashModal.tsx';
import { InboxPanel } from './InboxPanel.tsx';
import { RightPanel } from '../page/RightPanel.tsx';
import { ShortcutsModal } from './ShortcutsModal.tsx';
import { TemplatesModal } from '../templates/TemplatesModal.tsx';
import { ImportModal } from '../import/ImportModal.tsx';

export function GlobalModals() {
  const s = useUI();
  return (
    <>
      {s.searchOpen && <SearchModal />}
      {s.settingsOpen && <SettingsModal />}
      {s.trashOpen && <TrashModal />}
      {s.inboxOpen && <InboxPanel />}
      {s.rightPanel && <RightPanel />}
      {s.shortcutsOpen && <ShortcutsModal />}
      {s.templatesOpen && <TemplatesModal />}
      {s.importOpen && <ImportModal />}
    </>
  );
}


// (features/editor/textHandlers.ts); anything the editor already handled (defaultPrevented) is ignored here.

// Desktop menus include File, View, and History, plus window, tab, and sidebar shortcuts such as ⌘⇧N, ⌘T, and ⌘⌥U.

//   ⌘P / ⌘K (no text selection)  search          ⌘N        new private page
//   ⌘⇧N  new window                              ⌘T        new tab
//   ⌘\   sidebar                                 ⌘⇧L       dark mode (saved to user_settings)
//   ⌘⇧⌥L high contrast                           ⌘[ / ⌘]   back / forward
//   ⌘⇧U  parent page                             ⌘,        settings
//   ⌘L / ⌘⌥L  copy page link                     ⌘⌥U       inbox

//   ⌘⇧\  full width (page)                       ⌘Z / ⌘⇧Z  undo / redo outside text inputs
import { useUI } from '../../lib/store/ui.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { getLocation, openPage } from '../../lib/router.ts';
import { newPage, copyPageLink } from '../page/pageActions.ts';
import { useSession } from '../../lib/store/session.ts';
import { ancestorsOf, getBlock, run, setFormat } from '../../lib/blocks.ts';
import { savePreferredTheme, savePref, applyContrast } from '../settings/userSettings.ts';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

function isTextTarget(el: Element | null): boolean {
  const h = el as HTMLElement | null;
  if (!h) return false;
  return h.isContentEditable || h.tagName === 'INPUT' || h.tagName === 'TEXTAREA' || h.tagName === 'SELECT';
}

export function toggleDarkMode() {
  const ui = useUI.getState();
  savePreferredTheme(ui.resolvedDark ? 'light' : 'dark');
}

export function toggleHighContrast() {
  const high = document.documentElement.classList.contains('lit-high-contrast');
  const next = high ? 'standard' : 'high';
  applyContrast(next);
  savePref('high_contrast', next);
}

export function goToParentPage(pageId: string | null) {
  if (!pageId) return;
  const chain = ancestorsOf(pageId);
  const parent = chain[chain.length - 1];
  if (parent) openPage(parent.id);
}


export function askAi(detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent('nc:ask-ai', { detail }));
}

export function installGlobalShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing) return;
    if (useSession.getState().status !== 'ready') return;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    const ui = useUI.getState();
    const code = e.code;
    const key = e.key.toLowerCase();
    const editing = isTextTarget(document.activeElement);
    const { route } = getLocation();
    const pageId = route.name === 'page' ? route.pageId : null;
    const shift = e.shiftKey;
    const alt = e.altKey;
    const hit = (fn: () => void) => {
      e.preventDefault();
      fn();
    };

    // search: ⌘P always; ⌘K unless text is selected (then it is "Add link")
    if (!shift && !alt && (code === 'KeyP' || code === 'KeyK')) {
      const selected = (window.getSelection()?.toString() ?? '').length > 0;
      if (code === 'KeyK' && editing && selected) return;
      return hit(() => ui.set({ searchOpen: !ui.searchOpen, searchMode: 'search' }));
    }
    // appearance
    if (code === 'KeyL' && shift && alt) return hit(toggleHighContrast);
    if (code === 'KeyL' && shift && !alt) return hit(toggleDarkMode);
    // copy link (⌘L, ⌘⌥L)
    if (code === 'KeyL' && !shift) {
      if (!pageId) return;
      return hit(() => copyPageLink(pageId));
    }
    // sidebar / full width
    if (code === 'Backslash' && !shift && !alt) return hit(() => ui.setSidebarOpen(!ui.sidebarOpen));
    if (code === 'Backslash' && shift && pageId) {
      return hit(() => {
        const p = getBlock(pageId);
        run('toggleFullWidth', (tx) => setFormat(tx, pageId, { page_full_width: !p?.format?.page_full_width || undefined }));
      });
    }
    // pages, windows, tabs
    if (code === 'KeyN' && !shift && !alt) return hit(() => newPage({ kind: 'private' }));
    if (code === 'KeyN' && shift && !alt) return hit(() => window.open(location.href, '_blank', 'popup'));
    if (code === 'KeyT' && !shift && !alt) return hit(() => window.open(`${location.origin}/`, '_blank'));
    // history
    if (key === '[' || code === 'BracketLeft') {
      if (shift || alt) return;
      return hit(() => history.back());
    }
    if (key === ']' || code === 'BracketRight') {
      if (shift || alt) return;
      return hit(() => history.forward());
    }
    if (code === 'KeyU' && shift && !alt) return hit(() => goToParentPage(pageId));
    // panels & modals
    if (code === 'KeyU' && alt && !shift) return hit(() => ui.set({ inboxOpen: !ui.inboxOpen }));
    if (code === 'Slash' && alt && !shift) return hit(() => ui.set({ shortcutsOpen: !ui.shortcutsOpen }));
    if (code === 'Comma' && !shift && !alt) return hit(() => ui.openSettings());
    
    if (code === 'KeyJ' && shift && !alt) return hit(() => askAi({ pageId, source: 'shortcut' }));
    if (code === 'KeyJ' && !shift && !alt && !editing) return hit(() => askAi({ pageId, source: 'shortcut' }));
    // undo / redo outside text inputs (the editor owns them while typing)
    if (code === 'KeyZ' && !alt && !editing) {
      return hit(() => {
        if (shift) transactions.redo();
        else transactions.undo();
      });
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}

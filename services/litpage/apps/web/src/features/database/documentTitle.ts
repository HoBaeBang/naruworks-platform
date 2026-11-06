// Browser tab title of a full-page database: the database's title, then
// " | <view name>" when the database has more than one view, cut to 100 characters, then " | ".
// Pages use the same shape ("<title> | ", untitled = "New page"), and every tab title starts with the Inbox's
// unread count when there is one: “(9+) <page title> | ”.
import { useEffect } from 'react';
import { useUI } from '../../lib/store/ui.ts';

export function databaseDocumentTitle(dbName: string, viewName: string | undefined, multipleViews: boolean): string {
  let t = dbName.trim() || 'New database';
  if (multipleViews && viewName) t = `${t} | ${viewName}`;
  return `${t.slice(0, 100)} | Litpage`;
}

export function pageDocumentTitle(title: string, untitled: string): string {
  return `${(title.trim() || untitled).slice(0, 100)} | Litpage`;
}

export function unreadTitlePrefix(count: number): string {
  return count > 0 ? `(${count > 9 ? '9+' : count}) ` : '';
}

/** Set document.title while mounted (null = leave it alone); restores the plain app title afterwards. */
export function useDocumentTitle(title: string | null) {
  const unread = useUI((s) => (s as unknown as { inboxUnread?: number }).inboxUnread) ?? 0;
  useEffect(() => {
    if (title === null) return;
    const full = unreadTitlePrefix(unread) + title;
    document.title = full;
    return () => {
      if (document.title === full) document.title = 'Litpage';
    };
  }, [title, unread]);
}

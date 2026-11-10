
// parent is a collection) have All updates / Important updates / Replies and @mentions (server: setPageNotifySettings,
// apps/server/src/activityNotify.ts). Shared by the Inbox hover bell (InboxPanel) and the page ••• menu (PageMenu).
import type { MenuItemDef } from '../../../components/Menu.tsx';
import { t } from '../i18n.ts';

export type NotifyLevel = 'all_comments' | 'replies_and_mentions' | 'all_updates' | 'important_updates';

export function isDatabaseRow(b: { parent_table?: string } | undefined): boolean {
  return b?.parent_table === 'collection';
}

export function notifyLevelItems(isRow: boolean, level: string | undefined, set: (lv: NotifyLevel) => void): MenuItemDef[] {
  const replies: MenuItemDef = { label: t('lp.shell.replies_plus_mentions', 'Replies plus @mentions'), checked: level === 'replies_and_mentions', onSelect: () => set('replies_and_mentions') };
  if (!isRow) {
    return [{ label: t('lp.shell.all_comments', 'All comments'), checked: level === 'all_comments', onSelect: () => set('all_comments') }, replies];
  }
  return [
    { label: t('lp.shell.all_updates', 'All updates'), description: t('lp.shell.any_comment_or_property_update', 'Any comment or property update'), checked: level === 'all_updates', onSelect: () => set('all_updates') },
    { label: t('lp.shell.important_updates', 'Important updates'), description: t('lp.shell.any_comment_plus_status_assignee_or', 'Any comment, plus Status, Assignee, or Due Date edits'), checked: level === 'important_updates', onSelect: () => set('important_updates') },
    replies,
  ];
}

/** Right-hand label of the page menu's "Notify me" row. */
export function notifyLevelLabel(level: string | undefined): string {
  switch (level) {
    case 'replies_and_mentions': return t('lp.shell.mentions', 'Mentions');
    case 'all_updates': return t('lp.shell.all_updates', 'All updates');
    case 'important_updates': return t('lp.shell.important', 'Important');
    default: return t('lp.shell.comments', 'Comments');
  }
}

export function notifyLevelToast(level: NotifyLevel): string {
  switch (level) {
    case 'all_comments': return t('lp.shell.you_ll_be_notified_of_all', 'You’ll be notified of all comments on this page');
    case 'all_updates': return t('lp.shell.you_ll_be_notified_of_all_0185', 'You’ll be notified of all comments and property changes');
    case 'important_updates': return t('lp.shell.you_ll_be_notified_of_comments', 'You’ll be notified of comments and changes to Status, Assignee, or Due Date');
    default: return t('lp.shell.you_ll_be_notified_of_replies', 'You’ll be notified of replies and @mentions only');
  }
}

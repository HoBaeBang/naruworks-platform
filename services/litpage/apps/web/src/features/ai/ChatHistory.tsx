// Chat history: the "Chat history" menu (panel header / chat page toolbar) and a sidebar section

import { useEffect, type ReactNode } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { openMenu, type MenuItemDef } from '../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { navigate, spaceDomain, useLocation } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { deleteChat, pinChat, renameChat, setChatIcon, shareChat, useChatThreads, type ChatThread } from './aiApi.ts';

export const UNTITLED_CHAT = 'Untitled chat';

export function chatUrl(threadId?: string | null): string {
  const domain = spaceDomain(useSession.getState().spaceId);
  return threadId ? `/${domain}/chat/${threadId}` : `/${domain}/chat`;
}

function relTime(t: number): string {
  const d = Date.now() - t;
  if (d < 60_000) return 'Now';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)}m`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h`;
  return `${Math.floor(d / 86_400_000)}d`;
}


export function openRenameChat(anchor: HTMLElement, t: ChatThread) {
  openOverlay((close) => (
    <PopoverSurface width={280}>
      <div style={{ padding: 8 }}>
        <div className="nc-input focused" style={{ height: 28, padding: '3px 6px' }}>
          <input
            autoFocus
            defaultValue={t.title}
            placeholder={UNTITLED_CHAT}
            aria-label="Rename chat"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                void renameChat(t.id, (e.target as HTMLInputElement).value.trim());
                close();
              }
            }}
          />
        </div>
      </div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 4 });
}

const CHAT_ICONS = ['💬', '📝', '💡', '📊', '🚀', '🔍', '📅', '✅', '🧠', '⭐️', '🎯', '📌'];


export function openChatIconPicker(anchor: HTMLElement, t: ChatThread) {
  openOverlay((close) => (
    <PopoverSurface width={232}>
      <div className="nc-ai-icon-grid" role="listbox" aria-label="Chat icon">
        {CHAT_ICONS.map((e) => (
          <div key={e} role="option" aria-selected={t.icon === e} className="nc-ai-icon-cell" onClick={() => { void setChatIcon(t.id, e); close(); }}>{e}</div>
        ))}
        {t.icon && <div role="button" className="nc-ai-icon-remove" onClick={() => { void setChatIcon(t.id, null); close(); }}>Remove</div>}
      </div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 4 });
}


export async function shareChatLink(t: ChatThread) {
  try {
    if (!t.shared) await shareChat(t.id, true);
    void navigator.clipboard?.writeText(location.origin + chatUrl(t.id)).catch(() => {});
    useUI.getState().toast('Link copied. People in this workspace can view this chat.');
  } catch (e) {
    useUI.getState().toast((e as Error)?.message || 'Couldn’t share this chat');
  }
}

function threadMenu(t: ChatThread, anchor: HTMLElement, onDeleted?: () => void) {
  openMenu(anchor, {
    sections: [{
      items: [
        { label: t.pinned ? 'Unpin' : 'Pin', icon: 'pin', onSelect: () => { void pinChat(t.id, !t.pinned); } },
        { label: 'Rename', icon: 'edit', onSelect: () => { setTimeout(() => openRenameChat(anchor, t), 0); } },
        { label: 'Change icon', icon: 'emojiFace', onSelect: () => { setTimeout(() => openChatIconPicker(anchor, t), 0); } },
        { label: t.shared ? 'Copy link to shared chat' : 'Share chat', icon: 'link', description: t.shared ? 'Anyone in the workspace with the link can view' : undefined, onSelect: () => { void shareChatLink(t); } },
        ...(t.shared ? [{ label: 'Stop sharing', icon: 'lock', onSelect: () => { void shareChat(t.id, false).then(() => useUI.getState().toast('This chat is private again')); } }] : []),
        { label: 'Open in another tab', icon: 'arrowDiagonalUpRightSmall', onSelect: () => window.open(chatUrl(t.id), '_blank') },
        {
          label: 'Delete', icon: 'trash', danger: true,
          onSelect: () => {
            if (!window.confirm(`Delete “${t.title || UNTITLED_CHAT}” chat?`)) return;
            void deleteChat(t.id);
            onDeleted?.();
          },
        },
      ],
    }],
  }, { placement: 'right-start' });
}


export function ChatThreadIcon({ t, size = 18 }: { t: ChatThread; size?: number }) {
  return (
    <span className="nc-ai-thread-icon" style={{ width: size, height: size }}>
      {t.icon ? <span style={{ fontSize: size - 3, lineHeight: 1 }}>{t.icon}</span> : <Icon name="chatBubble" size={size} style={{ color: 'var(--lp-icon-secondary)' }} />}
      {t.unread && <span className="nc-ai-unread-dot" aria-label="Unread" />}
    </span>
  );
}


export async function openChatHistory(anchor: HTMLElement, opts: { currentId?: string | null; onOpen: (id: string) => void; onNew?: () => void }) {
  const spaceId = useSession.getState().spaceId;
  if (spaceId) await useChatThreads.getState().load(spaceId);
  const threads = useChatThreads.getState().threads;
  const ordered = [...threads.filter((t) => t.pinned), ...threads.filter((t) => !t.pinned)];
  const items: MenuItemDef[] = ordered.map((t) => ({
    id: t.id,
    label: t.title || UNTITLED_CHAT,
    text: t.title || UNTITLED_CHAT,
    icon: <ChatThreadIcon t={t} />,
    checked: t.id === opts.currentId,
    right: <span className="nc-menu-shortcut">{relTime(t.updatedTime)}</span>,
    onSelect: () => opts.onOpen(t.id),
  }));
  const sections = [];
  if (opts.onNew) sections.push({ items: [{ label: 'New chat', icon: 'chatBubblePlus', onSelect: opts.onNew }] as MenuItemDef[] });
  sections.push({ title: 'Previous chats', items });
  openMenu(anchor, { width: 300, search: 'Search chats…', sections, emptyText: 'No chats match your search', maxHeight: '60vh' }, { placement: 'bottom-start' });
}


export function ChatHistorySidebarSection({ renderRow }: { renderRow?: (t: ChatThread, active: boolean) => ReactNode }) {
  const spaceId = useSession((s) => s.spaceId);
  const threads = useChatThreads((s) => s.threads);
  const { route } = useLocation();
  const activeId = route.name === 'chat' ? route.chatId : undefined;
  useEffect(() => {
    if (spaceId) void useChatThreads.getState().load(spaceId);
  }, [spaceId]);
  if (!threads.length) return null;
  return (
    <div className="nc-sidebar-section nc-ai-sidebar-chats">
      <div className="nc-sidebar-section-header"><span className="nc-sidebar-section-title">Chats</span></div>
      <div role="tree" className="nc-sidebar-tree">
        {threads.map((t) => renderRow ? renderRow(t, t.id === activeId) : (
          <div
            key={t.id}
            role="treeitem"
            aria-selected={t.id === activeId}
            className={`nc-sidebar-item ${t.id === activeId ? 'selected' : ''}`}
            onClick={() => navigate(chatUrl(t.id))}
            onContextMenu={(e) => {
              e.preventDefault();
              threadMenu(t, e.currentTarget as HTMLElement, () => { if (t.id === activeId) navigate(chatUrl()); });
            }}
          >
            <div className="nc-sidebar-item-inner" style={{ paddingInlineStart: 8 }}>
              <div className="nc-sidebar-item-icon"><Icon name="chatBubble" size={18} style={{ color: 'var(--lp-icon-secondary)' }} /></div>
              <div className="nc-sidebar-item-title nc-ellipsis">{t.title || UNTITLED_CHAT}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { threadMenu as openThreadMenu };

// Full-page AI chat (sidebar "Chat" tab, "New chat", /<domain>/chat/<threadId>).
// ?q=<question>&ws=1 starts a chat that answers questions about the workspace;
// &mode=research runs it in Research mode.
import { useMemo } from 'react';
import { navigate } from '../../lib/router.ts';
import { Icon } from '../../components/Icon.tsx';
import { ChatView } from '../ai/ChatView.tsx';
import type { ChatMode } from '../ai/aiApi.ts';
import { chatUrl, openChatHistory } from '../ai/ChatHistory.tsx';
import '../ai/ai.css';

export function ChatPage({ chatId }: { chatId?: string }) {
  const initialQuery = useMemo(() => {
    const p = new URLSearchParams(location.search);
    const q = p.get('q');
    const m = p.get('mode');
    const mode: ChatMode | undefined = m === 'research' || m === 'ask' || m === 'plan' ? m : undefined;
    return q ? { text: q, retrieve: p.get('ws') === '1', mode, key: `${q}:${Date.now()}` } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId]);
  return (
    <div className="nc-ai-chat-page">
      <ChatView
        variant="page"
        threadId={chatId ?? null}
        initialQuery={chatId ? null : initialQuery}
        onThreadChange={(id) => navigate(chatUrl(id), { replace: !!id })}
        header={({ threadId }) => (
          <div className="nc-ai-page-actions">
            <div
              role="button"
              aria-label="Chat history"
              data-tooltip="Chat history"
              className="nc-btn icon-only"
              onClick={(e) => void openChatHistory(e.currentTarget, { currentId: threadId, onOpen: (id) => navigate(chatUrl(id)), onNew: () => navigate(chatUrl()) })}
            >
              <Icon name="history" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
            </div>
            {threadId && (
              <div role="button" aria-label="New chat" data-tooltip="New chat" className="nc-btn icon-only" onClick={() => navigate(chatUrl())}>
                <Icon name="chatBubblePlus" size={18} style={{ color: 'var(--lp-icon-secondary)' }} />
              </div>
            )}
          </div>
        )}
      />
    </div>
  );
}

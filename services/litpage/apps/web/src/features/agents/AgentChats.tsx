// Chat tab › "Recent chats" (history button): my chats with this agent, newest first, plus "New chat".
import { useEffect, useState } from 'react';
import { Icon } from '../../components/Icon.tsx';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { timeAgo } from '../../lib/format.ts';
import { t } from '../shell/i18n.ts';
import { agentApi, toastError } from './agentsApi.ts';

type Chat = Awaited<ReturnType<typeof agentApi.chats>>['chats'][number];

function ChatList({ agentId, close, onOpen, onNew }: { agentId: string; close: () => void; onOpen: (id: string) => void; onNew: () => void }) {
  const [chats, setChats] = useState<Chat[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    agentApi.chats(agentId).then((r) => setChats(r.chats)).catch((e) => {
      toastError(e);
      setChats([]);
    });
  }, [agentId]);
  const list = (chats ?? []).filter((c) => !q || (c.title || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <PopoverSurface width={320} maxHeight={420} className="nc-agent-picker">
      <div className="nc-agent-picker-search">
        <input autoFocus value={q} aria-label={t('lp.agents.search_chats', 'Search chats')} placeholder={t('lp.agents.search_chats', 'Search chats')} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="nc-agent-picker-list" role="listbox" data-testid="agent-chat-list">
        <div role="option" aria-selected={false} className="nc-agent-picker-row" onClick={() => { onNew(); close(); }}>
          <span className="nc-agent-picker-icon"><Icon name="chatBubblePlus" size={16} /></span>
          <span>{t('lp.agents.new_chat', 'New chat')}</span>
        </div>
        {chats === null && <div className="nc-agent-muted pad">{t('lp.agents.loading', 'Loading…')}</div>}
        {chats && !list.length && <div className="nc-agent-muted pad">{q ? t('lp.agents.no_matches', 'No matches') : t('lp.agents.no_chats_so_far', 'No chats so far')}</div>}
        {list.map((c) => (
          <div key={c.id} role="option" aria-selected={false} className="nc-agent-picker-row" data-thread-id={c.id} onClick={() => { onOpen(c.id); close(); }}>
            <span className="nc-agent-picker-icon"><Icon name="chatBubble" size={16} /></span>
            <span className={`nc-ellipsis ${c.unread ? 'unread' : ''}`}>{c.title || t('lp.agents.new_chat', 'New chat')}</span>
            <span className="nc-agent-picker-hint">{timeAgo(c.updatedTime)}</span>
          </div>
        ))}
      </div>
    </PopoverSurface>
  );
}

export function openAgentChats(agentId: string, anchor: HTMLElement, onOpen: (id: string) => void, onNew: () => void) {
  openOverlay((close) => <ChatList agentId={agentId} close={close} onOpen={onOpen} onNew={onNew} />, { anchor, placement: 'bottom-end', offset: 4 });
}

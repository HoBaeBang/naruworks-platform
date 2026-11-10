
// it into an interactive chat with the agent (block type 'agent_chat', format.agent_id). The embed doesn't give
// anyone access: only people the agent is shared with can chat, and the agent reads the page only if the page is in
// its Tools and permissions (the server tells the agent where the chat is embedded and checks its own access).
// Loaded with the block modules (editor/blocks/registerAll.ts globs **/*.block.tsx).
import { useEffect } from 'react';
import { deleteRange, insertRich, length, type RichText } from '@nc/shared/richtext.ts';
import { expandId, newId } from '@nc/shared/ids.ts';
import type { MenuItemDef } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { createBlockIn, getBlock, pageOf, run, setTitle } from '../../lib/blocks.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';
import { registerBlock, type BlockProps } from '../editor/Block.tsx';
import { useEditor } from '../editor/editorState.ts';
import { commitText } from '../editor/textHandlers.ts';
import { valueOf } from '../editor/inline/format.ts';
import { pasteUrlExtensions } from '../editor/inline/PasteMenu.tsx';
import { ChatView } from '../ai/ChatView.tsx';
import '../ai/ai.css';
import { openAgent, useAgents } from './agentsApi.ts';
import { AgentIcon } from './AgentsSection.tsx';
import './icons.tsx';
import './agents.css';


export function agentIdOfUrl(url: string): string | null {
  try {
    const u = new URL(url, location.origin);
    if (u.origin !== location.origin) return null;
    const m = /^\/agent\/([0-9a-f]{32})\/?$/i.exec(u.pathname);
    return m ? expandId(m[1]) : null;
  } catch {
    return null;
  }
}

type Range = { blockId: string; property: string; start: number; end: number };


function embedAgent(r: Range, agentId: string) {
  const b = getBlock(r.blockId);
  if (!b) return;
  const rest = deleteRange(valueOf(r.blockId, r.property), r.start, r.end);
  run('agentEmbed.create', (tx) => {
    if (r.property === 'title' && length(rest) === 0 && b.type === 'text' && !(b.content?.length)) {
      tx.update('block', r.blockId, [], { type: 'agent_chat' });
      setTitle(tx, r.blockId, []);
      tx.update('block', r.blockId, ['format'], { agent_id: agentId });
    } else {
      if (r.property === 'title') setTitle(tx, r.blockId, rest);
      createBlockIn(tx, { id: newId(), type: 'agent_chat', parentId: b.parent_id, parentTable: b.parent_table as never, after: r.blockId, format: { agent_id: agentId } });
    }
  });
}

function mentionAgent(r: Range, botId: string) {
  const atom: RichText = [['‣', [['u', botId]]]];
  const next = insertRich(deleteRange(valueOf(r.blockId, r.property), r.start, r.end), r.start, atom);
  commitText(r.blockId, r.property, next, r.start + 1, { coalesce: false, action: 'embedMenu.linkMention' });
  useEditor.getState().requestFocus(r.blockId, r.start + 1, { property: r.property });
}

// registered after the import graph settles (block modules and the editor's menus import each other)
let installed = false;
setTimeout(() => {
  if (installed) return;
  installed = true;
  pasteUrlExtensions.push((url, range): MenuItemDef[] | null => {
    const agentId = agentIdOfUrl(url);
    if (!agentId) return null;
    const a = useAgents.getState().agents.find((x) => x.id === agentId);
    return [
      { label: t('lp.agents.embed', 'Embed'), icon: 'agentEmbed', onSelect: () => embedAgent(range, agentId) },
      ...(a ? [{ label: t('lp.agents.mention', 'Mention'), icon: 'arrowDiagonalUpRight', onSelect: () => mentionAgent(range, a.botId) }] : []),
      { label: t('lp.agents.url', 'URL'), icon: 'link', onSelect: () => undefined },
    ];
  });
}, 0);

function AgentChatBlock({ block }: BlockProps) {
  const agentId = (block.format as { agent_id?: string } | undefined)?.agent_id ?? null;
  const spaceId = useSession((s) => s.spaceId);
  const { agents, loaded } = useAgents();
  useEffect(() => {
    if (spaceId) void useAgents.getState().load(spaceId);
  }, [spaceId]);
  const a = agentId ? agents.find((x) => x.id === agentId) : undefined;
  const page = pageOf(block.id);
  const name = a?.name || t('lp.agents.untitled_agent', 'Untitled agent');
  return (
    <div className="nc-agent-embed" contentEditable={false} suppressContentEditableWarning data-testid="agent-embed" data-agent-id={agentId ?? undefined}>
      <div className="nc-agent-embed-head">
        <AgentIcon icon={a?.icon} size={20} />
        <span className="nc-agent-embed-name nc-ellipsis">{a ? name : t('lp.agents.unavailable_agent', 'Unavailable agent')}</span>
        {a && (
          <div role="button" className="nc-agent-icon-btn small" aria-label={t('lp.agents.open_agent', 'Open agent')} data-tooltip={t('lp.agents.open_agent', 'Open agent')} onClick={() => openAgent(a.id)}>
            <Icon name="openAsPage" size={14} />
          </div>
        )}
      </div>
      {!loaded && <div className="nc-agent-loading small" aria-busy="true" />}
      {loaded && !a && <div className="nc-agent-embed-empty">{t('lp.agents.you_don_t_have_permission_to', 'You don’t have permission to use this agent. Ask its owner to share it with you.')}</div>}
      {a && !a.published && <div className="nc-agent-embed-empty">{t('lp.agents.to_chat_with_this_agent_publish', 'To chat with this agent, publish it first. <settingsLink>Go to settings</settingsLink>').replace(/<\/?settingsLink>/g, '')}</div>}
      {a && a.published && a.status === 'disabled' && <div className="nc-agent-embed-empty">{t('lp.agents.chat_is_unavailable_while_this_agent', 'Chat is unavailable while this agent is paused')}</div>}
      {a && a.published && a.status !== 'disabled' && (
        <div className="nc-agent-embed-chat" onKeyDown={(e) => e.stopPropagation()} onPaste={(e) => e.stopPropagation()} onCopy={(e) => e.stopPropagation()}>
          <ChatView
            variant="panel"
            agent={{ id: a.id, name }}
            contextPageId={page?.id ?? null}
            landing={(
              <div className="nc-agent-embed-landing">
                <AgentIcon icon={a.icon} size={32} />
                <div className="nc-agent-intro-desc">{a.description || t('lp.agents.ask_anything', 'Ask {agentName} anything', { agentName: name })}</div>
              </div>
            )}
            placeholder={t('lp.agents.ask_agentname_select_undefined_other', 'Message {agentName, select, undefined {this agent} other {{agentName}}}…', { agentName: name })}
          />
        </div>
      )}
    </div>
  );
}

registerBlock(['agent_chat'], AgentChatBlock);

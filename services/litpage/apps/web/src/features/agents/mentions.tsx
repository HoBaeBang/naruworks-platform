
// a mention of the agent's own user (its bot principal) — the server runs agents whose "When agent is mentioned"

// listen to mentions ("Have agent listen to mentions?" → Agent Settings) or can't open the page ("Invite agent to
// page?" → Invite gives it Can edit access, or "Agent cannot access this page" when I can't share it).
import type { MenuItemDef } from '../../components/Menu.tsx';
import { pageOf } from '../../lib/blocks.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { mentionMenuExtensions } from '../editor/inline/MentionMenus.tsx';
import { insertAtomForTrigger } from '../editor/inline/trigger.ts';
import { agentApi, openAgent, toastError, useAgents, type AgentSummary } from './agentsApi.ts';
import { AgentIcon } from './AgentsSection.tsx';

function afterSave(fn: () => void) {
  if (transactions.pendingCount() === 0) return fn();
  const off = transactions.onSaveState((st) => {
    if (st.pending > 0) return;
    off();
    if (!st.error) fn();
  });
}


export async function checkMentionedAgent(a: Pick<AgentSummary, 'id' | 'name'>, pageId: string) {
  try {
    const r = await agentApi.checkMention(a.id, pageId);
    const toast = useUI.getState().toast;
    if (r.disabled) {
      toast(t('lp.agents.agent_is_turned_off', 'Agent is turned off'));
    } else if (!r.reachable) {
      if (r.canGrant) {
        toast(`${t('lp.agents.share_page_with_agent', 'Share page with agent?')} ${t('lp.agents.this_page_hasn_t_been_shared', 'This page hasn’t been shared with this agent yet.')}`, {
          label: t('lp.agents.invite', 'Invite'),
          run: () => void agentApi.grantPage(a.id, pageId, r.grantRole ?? 'reader')
            .then(() => toast(r.grantRole === 'read_and_write' ? t('lp.agents.can_now_edit_this_page', '{name} can now edit this page', { name: a.name }) : t('lp.agents.can_now_view_this_page', '{name} can now view this page', { name: a.name })))
            .catch((e) => toastError(e)),
        });
      } else if (r.canEdit) {
        toast(`${t('lp.agents.your_permissions_don_t_allow_sharing', 'Your permissions don’t allow sharing this page with this agent. An admin can grant access.')}`);
      } else {
        toast(`${t('lp.agents.no_page_access_for_this_agent', 'No page access for this agent')} — ${t('lp.agents.check_with_the_agent_s_owner', 'Check with the agent’s owner about sharing this page with it.')}`, {
          label: t('lp.agents.view_agent', 'View Agent'),
          run: () => openAgent(a.id),
        });
      }
    } else if (!r.listens) {
      toast(`${t('lp.agents.turn_on_the_mention_trigger', 'Turn on the mention trigger?')} ${t('lp.agents.this_agent_doesn_t_start_when', 'This agent doesn’t start when mentioned.')}`, r.canEdit ? {
        label: t('lp.agents.agent_settings', 'Agent Settings'),
        run: () => openAgent(a.id, 'settings'),
      } : undefined);
    }
  } catch {
    
  }
}


export function agentMentionItems(q: string, pick: (a: AgentSummary) => void): MenuItemDef[] {
  const { agents, available } = useAgents.getState();
  if (!available) return [];
  const ql = q.trim().toLowerCase();
  return agents
    .filter((a) => a.alive && a.published && (!ql || a.name.toLowerCase().includes(ql)))
    .slice(0, ql ? 6 : 3)
    .map((a) => ({
      id: `agent:${a.id}`,
      label: a.name || t('lp.agents.untitled_agent', 'Untitled agent'),
      text: a.name,
      icon: <AgentIcon icon={a.icon} size={20} />,
      onSelect: () => pick(a),
    }));
}

// registered after the import graph settles (this module and the editor's menus can import each other)
let installed = false;
setTimeout(() => {
  if (installed) return;
  installed = true;
  mentionMenuExtensions.push(({ blockId, q }) => {
    const items = agentMentionItems(q, (a) => {
      insertAtomForTrigger([['‣', [['u', a.botId]]]]);
      const page = blockId ? pageOf(blockId) : undefined;
      if (page) afterSave(() => void checkMentionedAgent(a, page.id));
    });
    return items.length ? [{ title: 'Agents', items }] : [];
  });
}, 0);

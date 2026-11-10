// Banner on an agent's instructions page opened as a page (Settings › Instructions › Edit in page): the content is
// what the agent follows, with a way back to the agent's settings.
import type { BlockRecord } from '@nc/shared/records.ts';
import type { AgentRecord } from '@nc/shared/agents.ts';
import { Icon } from '../../components/Icon.tsx';
import { useRecord } from '../../lib/hooks.ts';
import { t } from '../shell/i18n.ts';
import { openAgent } from './agentsApi.ts';

export function AgentInstructionsBanner({ page }: { page: BlockRecord }) {
  const agentId = page.parent_table === ('workflow' as BlockRecord['parent_table']) ? page.parent_id : null;
  const agent = useRecord<AgentRecord>('workflow', agentId);
  if (!agentId) return null;
  const name = agent?.draft?.name ?? agent?.data?.name ?? t('lp.agents.agent', 'Agent');
  return (
    <div className="nc-sites-banner" role="status" data-testid="agent-instructions-banner">
      <div className="msg">{t('lp.agents.this_page_is_the_instruction_page', 'This page is the instruction page for {agentName}. Its content shapes the agent’s behavior.', { agentName: name })}</div>
      <div className="actions">
        <div role="button" className="nc-banner-btn blue" onClick={() => openAgent(agentId, 'settings')}>
          <Icon name="gear" size={16} />{t('lp.agents.agent_settings_b02d', 'Agent settings')}
        </div>
      </div>
    </div>
  );
}

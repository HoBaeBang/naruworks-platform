import type { SpaceRecord } from '@nc/shared/records.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { t } from '../../shell/i18n.ts';
import { Button, Group, Row, SectionPage, confirmDialog } from '../ui.tsx';
import { PLAN_RANK, spaceApi, spaceSetting, useSpaceAccess, type PlanType } from '../spaceSettings.ts';
import { requestUpgrade } from './features.tsx';
import { fmtDate } from './workspace.tsx';
import type { UpgradeRequest } from './workspace.tsx';

interface PlanInfo { key: PlanType; name: string; tagline: string; features: string[] }

function plans(): PlanInfo[] {
  return [
    {
      key: 'free', name: t('lp.settings.free', 'Free'),
      tagline: t('lp.settings.a_focused_workspace_for_pages_blocks', 'A focused workspace for pages, blocks, and databases'),
      features: [
        t('lp.settings.pages_blocks_and_databases', 'Pages, blocks, and databases'),
        t('lp.settings.sharing_and_publishing', 'Sharing and publishing'),
        t('lp.settings.basic_forms', 'Basic forms'),
        t('lp.settings.workspace_export_in_markdown_and_html', 'Workspace export in Markdown and HTML'),
      ],
    },
    {
      key: 'plus', name: t('lp.settings.pro', 'Pro'),
      tagline: t('lp.settings.shared_tools_for_teams_that_work', 'Shared tools for teams that work together'),
      features: [
        t('lp.settings.all_free_features', 'All Free features'),
        t('lp.settings.team_collaboration_and_shared_spaces', 'Team collaboration and shared spaces'),
        t('lp.settings.connections_and_database_automations', 'Connections and database automations'),
        t('lp.settings.custom_forms', 'Custom forms'),
      ],
    },
    {
      key: 'business', name: t('lp.settings.business', 'Business'),
      tagline: t('lp.settings.more_control_for_growing_organizations', 'More control for growing organizations'),
      features: [
        t('lp.settings.everything_in_pro', 'Everything in Pro'),
        t('lp.settings.litpage_ai_and_custom_agents', 'Litpage AI and custom agents'),
        t('lp.settings.ai_meeting_notes', 'AI meeting notes'),
        t('lp.settings.pdf_and_member_exports', 'PDF and member exports'),
        t('lp.settings.image_generation', 'Image generation'),
        t('lp.settings.verified_pages', 'Verified pages'),
        t('lp.settings.saml_sso_and_verified_domains', 'SAML SSO and verified domains'),
      ],
    },
    {
      key: 'enterprise', name: t('lp.settings.enterprise', 'Enterprise'),
      tagline: t('lp.settings.administrative_controls_for_complex_work', 'Administrative controls for complex workspaces'),
      features: [
        t('lp.settings.all_business_features', 'All Business features'),
        t('lp.settings.audit_logs_and_workspace_analytics', 'Audit logs and workspace analytics'),
        t('lp.settings.data_retention_controls', 'Data retention controls'),
        t('lp.settings.restricted_members', 'Restricted members'),
        t('lp.settings.webhook_controls', 'Webhook controls'),
        t('lp.settings.advanced_access_policies', 'Advanced access policies'),
      ],
    },
  ];
}

function useRequested(space: SpaceRecord | undefined, uid: string) {
  return (plan: string) => spaceSetting<UpgradeRequest[]>(space, 'upgrade_requests', []).some((r) => r.plan === plan && r.requested_by === uid);
}

async function changePlan(space: SpaceRecord, to: PlanInfo) {
  const up = PLAN_RANK[to.key] > PLAN_RANK[space.plan_type ?? 'plus'];
  const ok = await confirmDialog({
    title: up ? t('lp.settings.upgrade_to', 'Upgrade to {plan}?', { plan: to.name }) : t('lp.settings.switch_to', 'Switch to {plan}?', { plan: to.name }),
    description: t('lp.settings.changing_a_feature_level_only_changes', 'Changing a feature level only changes which plan-dependent settings are available. No payment is taken.'),
    confirmLabel: up ? t('lp.settings.upgrade', 'Upgrade') : t('lp.settings.downgrade', 'Downgrade'),
    danger: !up,
  });
  if (!ok) return;
  try {
    await spaceApi('changePlan', { spaceId: space.id, plan: to.key });
    useUI.getState().toast(t('lp.settings.your_workspace_is_now_on_the', 'Your workspace is now on the {plan} level', { plan: to.name }));
  } catch (e) {
    useUI.getState().toast((e as Error)?.message || t('lp.settings.something_went_wrong_while_processing_th', 'We hit a problem while processing that request.'));
  }
}

export function PlansSection() {
  const { space, uid, owner, plan } = useSpaceAccess();
  const requested = useRequested(space, uid);
  if (!space) return null;
  const all = plans();
  const current = all.find((p) => p.key === plan) ?? all[1];

  const cta = (p: PlanInfo) => {
    if (p.key === plan || PLAN_RANK[p.key] < PLAN_RANK.plus) return owner && p.key !== plan ? <Button small onClick={() => void changePlan(space, p)}>{t('lp.settings.downgrade', 'Downgrade')}</Button> : null;
    if (owner) {
      return PLAN_RANK[p.key] > PLAN_RANK[plan]
        ? <Button small variant={p.key === 'business' ? 'primary' : undefined} onClick={() => void changePlan(space, p)}>{t('lp.settings.upgrade', 'Upgrade')}</Button>
        : <Button small onClick={() => void changePlan(space, p)}>{t('lp.settings.downgrade', 'Downgrade')}</Button>;
    }
    if (PLAN_RANK[p.key] < PLAN_RANK[plan]) return null;
    return requested(p.key)
      ? <Button small disabled>{t('lp.settings.requested', 'Requested')}</Button>
      : <Button small onClick={() => void requestUpgrade(space.id, p.key)}>{t('lp.settings.request', 'Request')}</Button>;
  };

  return (
    <SectionPage wide title={t('lp.settings.feature_levels', 'Feature levels')} subtitle={t('lp.settings.choose_the_feature_level_for_this', 'Choose the feature level for this self-hosted install')}>
      <Group plain title={t('lp.settings.your_current_feature_level', 'Your current feature level')}>
        <div className="nc-set-plan-current">
          <div className="info">
            <div className="name">{current.name}</div>
            <div className="tagline">{current.tagline}</div>
            {owner && spaceSetting(space, 'plan_changed_time', 0) > 0 && <div className="since">{t('lp.settings.since', 'Since {date}', { date: fmtDate(spaceSetting(space, 'plan_changed_time', 0)) })}</div>}
          </div>
          <div className="nc-set-plan-ai">
            <div className="txt">
              <div className="ttl"><span className="ai-face"><Icon name="aiFace" size={14} /></span>{t('lp.settings.litpage_ai', 'Litpage AI')}</div>
              <div className="desc">{t('lp.settings.ai_search_meeting_notes_and_image', 'AI search, meeting notes, and image generation are available at the Business level')}</div>
            </div>
            {PLAN_RANK[plan] >= PLAN_RANK.business ? (
              <span className="nc-set-badge gray">{t('lp.settings.active', 'Active')}</span>
            ) : owner ? (
              <Button small onClick={() => void changePlan(space, all[2])}>{t('lp.settings.upgrade', 'Upgrade')}</Button>
            ) : requested('lit_ai') ? (
              <Button small disabled>{t('lp.settings.requested', 'Requested')}</Button>
            ) : (
              <Button small onClick={() => void requestUpgrade(space.id, 'lit_ai')}>{t('lp.settings.request', 'Request')}</Button>
            )}
          </div>
        </div>
      </Group>

      <div className="nc-set-compare">
        <div className="nc-set-compare-title">{t('lp.settings.feature_levels', 'Feature levels')}</div>
        <div className="nc-set-sep" />
        <p className="nc-set-plan-note">{t('lp.settings.levels_exist_to_try_plan_dependent', 'Levels exist to try plan-dependent features. Litpage is self-hosted, so there is no billing.')}</p>
        <div className="nc-set-plan-head">
          <div className="lbl" />
          {all.map((p) => (
            <div key={p.key} className="col" data-plan={p.key}>
              <div className="nm-row">
                <span className="nm">{p.name}</span>
                {p.key === plan && <span className="nc-set-badge gray">{t('lp.settings.active', 'Active')}</span>}
              </div>
              <div className="price">{t('lp.settings.self_hosted_feature_level', 'Self-hosted feature level')}</div>
              <div className="cta">{cta(p)}</div>
            </div>
          ))}
        </div>
        <div className="nc-set-highlights">
          <div className="lbl">{t('lp.settings.includes', 'Includes')}</div>
          {all.map((p) => (
            <div key={p.key} className="col">
              <ul>
                {p.features.map((feature) => (
                  <li key={feature}><Icon name="checkmarkFillSmall" size={14} /><span>{feature}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="nc-set-sep" />
      </div>
    </SectionPage>
  );
}

export function BillingSection() {
  const { space, plan } = useSpaceAccess();
  if (!space) return null;
  const info = plans().find((p) => p.key === plan) ?? plans()[1];
  return (
    <SectionPage title={t('lp.settings.billing', 'Billing')} subtitle={t('lp.settings.litpage_is_self_hosted_so_there', 'Litpage is self-hosted, so there is nothing to bill.')}>
      <Group title={t('lp.settings.your_current_feature_level', 'Your current feature level')}>
        <Row
          id="billing-plan"
          label={info.name}
          description={info.tagline}
          control={<Button onClick={() => useUI.getState().set({ settingsSection: 'plans' })}>{t('lp.settings.view_feature_levels', 'View feature levels')}</Button>}
        />
        <div className="nc-set-plan-note">{t('lp.settings.levels_exist_to_try_plan_dependent', 'Levels exist to try plan-dependent features. Litpage is self-hosted, so there is no billing.')}</div>
      </Group>
    </SectionPage>
  );
}

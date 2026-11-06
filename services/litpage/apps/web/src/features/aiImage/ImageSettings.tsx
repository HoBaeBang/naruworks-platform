

// the switch takes effect everywhere — image picker tab, "/AI Image", "Polish with AI", the chat tool, and the server.
import type { SpaceRecord } from '@nc/shared/records.ts';
import { Group, Row, Switch, Upsell } from '../settings/ui.tsx';
import { planAtLeast, saveSpaceSettings, spaceSetting, useSpaceAccess } from '../settings/spaceSettings.ts';
import { t } from '../shell/i18n.ts';

export function ImageGenerationSettings() {
  const { space, owner: admin, plan } = useSpaceAccess(); // workspace setting: owners (server policy.ts)
  if (!space) return null;
  return <ImageGroup space={space} admin={admin} included={planAtLeast(plan, 'business')} />;
}

function ImageGroup({ space, admin, included }: { space: SpaceRecord; admin: boolean; included: boolean }) {
  const aiOn = spaceSetting<boolean>(space, 'ai_enabled', true) !== false;
  const on = spaceSetting<boolean>(space, 'ai_image_generation', true) !== false;
  const tip = !aiOn
    ? t('lp.aiimage.turn_on_litpage_ai_before_generating', 'Turn on Litpage AI before generating images.')
    : !admin ? t('lp.aiimage.to_change_this_reach_out_to', 'To change this, reach out to your workspace admin') : undefined;
  return (
    <Group plain title={t('lp.aiimage.image_generation', 'Image generation')}>
      <Row
        id="ai-image-generation"
        label={t('lp.aiimage.turn_on_image_generation', 'Turn on image generation')}
        description={included
          ? t('lp.aiimage.let_people_in_this_workspace_create', 'Let people in this workspace create images with AI')
          : <Upsell text={t('lp.aiimage.upgrade_to_business_to_create_and', '<highlight>Upgrade to Business</highlight> to create and edit images with Litpage AI.')} />}
        control={(
          <span data-tooltip={tip}>
            <Switch
              label="Turn on image creation"
              checked={included && aiOn && on}
              disabled={!admin || !aiOn || !included}
              onChange={(v) => saveSpaceSettings(space.id, { ai_image_generation: v })}
            />
          </span>
        )}
      />
    </Group>
  );
}

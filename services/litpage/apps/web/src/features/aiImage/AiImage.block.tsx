


// Loaded with the block modules (editor/blocks/registerAll.ts globs **/*.block.tsx); no block type of its own.
import { registerSlashItems } from '../editor/blocks/registry.ts';
import { place, type SlashContext, type SlashItem } from '../editor/slashItems.ts';
import { blockElement } from '../editor/blocks/shared.tsx';
import { useEditor } from '../editor/editorState.ts';
import { getBlock } from '../../lib/blocks.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { imageSwitchOn, planIncludesImages } from './api.ts';
import { openAiImagePopover } from './AiImageTab.tsx';

function openWhenRendered(id: string, fallback: DOMRect, tries = 0) {
  const row = blockElement(id);
  const el = row?.querySelector<HTMLElement>('.nc-blk-placeholder') ?? row;
  if (el) openAiImagePopover(id, el);
  else if (tries < 30) requestAnimationFrame(() => openWhenRendered(id, fallback, tries + 1));
  else openAiImagePopover(id, fallback);
}

function insertAiImage(ctx: SlashContext) {
  const spaceId = getBlock(ctx.blockId)?.space_id ?? useSession.getState().spaceId;
  if (!planIncludesImages(spaceId)) {
    useUI.getState().toast(t('lp.aiimage.ai_image_generation_is_available_on', 'AI image generation is available on the Business and Enterprise plans.'), {
      label: t('lp.aiimage.view_plans', 'View plans'),
      run: () => useUI.getState().openSettings('plans'),
    });
    return;
  }
  const id = place(ctx, 'image', { focus: false, addTextAfter: false });
  useEditor.setState({ hoverBlock: null });
  requestAnimationFrame(() => openWhenRendered(id, ctx.anchor));
}

registerSlashItems((): SlashItem[] => {
  if (!imageSwitchOn(useSession.getState().spaceId)) return [];
  return [{
    id: 'ai-image',
    label: t('lp.aiimage.ai_image', 'AI Image'),
    section: t('lp.aiimage.image_creation', 'Image creation'),
    icon: 'aiFace',
    keywords: t('lp.aiimage.ai_picture_image_generator', 'AI picture image generator').toLowerCase().split(/\s+/).concat(['ai image', 'generate image', 'image generation', 'illustration', 'diagram']),
    apply: insertAiImage,
  }];
});

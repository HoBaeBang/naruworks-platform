

import { create } from 'zustand';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { t } from '../shell/i18n.ts';

export interface ImageStatus {
  planIncluded: boolean;
  enabled: boolean;
  aiEnabled: boolean;
  configured: boolean;
  available: boolean;
}

interface Store {
  bySpace: Record<string, ImageStatus>;
  load(spaceId: string, force?: boolean): Promise<ImageStatus | null>;
}

export const useImageStatus = create<Store>((set, get) => ({
  bySpace: {},
  async load(spaceId, force) {
    if (!force && get().bySpace[spaceId]) return get().bySpace[spaceId];
    try {
      const r = await api<ImageStatus>('aiImageStatus', { spaceId });
      set((s) => ({ bySpace: { ...s.bySpace, [spaceId]: r } }));
      return r;
    } catch {
      return null;
    }
  },
}));


export function imageSwitchOn(spaceId: string | null | undefined): boolean {
  const s = records.get<SpaceRecord>('space', spaceId ?? useSession.getState().spaceId);
  const settings = (s?.settings ?? {}) as Record<string, unknown>;
  return settings.ai_image_generation !== false && settings.ai_enabled !== false;
}

export function planIncludesImages(spaceId: string | null | undefined): boolean {
  const s = records.get<SpaceRecord>('space', spaceId ?? useSession.getState().spaceId);
  return s?.plan_type === 'business' || s?.plan_type === 'enterprise';
}

export const STYLES: { key: string; label: () => string }[] = [
  { key: 'default', label: () => t('lp.aiimage.general', 'General') },
  { key: 'diagram', label: () => t('lp.aiimage.diagram', 'Diagram') },
  { key: 'infographic', label: () => t('lp.aiimage.infographic', 'Infographic') },
  { key: 'chart', label: () => t('lp.aiimage.chart', 'Chart') },
  { key: 'slide', label: () => t('lp.aiimage.slides', 'Slides') },
  { key: 'mockup', label: () => t('lp.aiimage.mockup', 'Mockup') },
  { key: 'photo', label: () => t('lp.aiimage.photo', 'Photo') },
  { key: 'sketch', label: () => t('lp.aiimage.sketch', 'Sketch') },
  { key: 'cartoon', label: () => t('lp.aiimage.cartoon', 'Cartoon') },
  { key: 'comic', label: () => t('lp.aiimage.comic', 'Comic') },
  { key: 'pattern', label: () => t('lp.aiimage.pattern', 'Pattern') },
  { key: 'modern_art', label: () => t('lp.aiimage.modern_art', 'Modern Art') },
];


export const PREFILLS: { style: string; text: () => string }[] = [
  { style: 'diagram', text: () => t('lp.aiimage.make_a_diagram_from_this_page', 'Make a diagram from this page') },
  { style: 'chart', text: () => t('lp.aiimage.make_a_chart_from_this_page', 'Make a chart from this page') },
  { style: 'slide', text: () => t('lp.aiimage.summarize_this_page_as_a_presentation', 'Summarize this page as a presentation slide') },
  { style: 'photo', text: () => t('lp.aiimage.illustrate_this_page_with_a_photo', 'Illustrate this page with a photo') },
  { style: 'mockup', text: () => t('lp.aiimage.turn_this_page_into_a_mockup', 'Turn this page into a mockup') },
];

export function generateIntoBlock(blockId: string, prompt: string, style: string) {
  return api<{ url: string; recordMap: any }>('aiGenerateImageBlock', { blockId, prompt, style }).then((r) => { records.mergeRecordMap(r.recordMap); return r; });
}


export function generateCover(page: Pick<BlockRecord, 'id' | 'space_id'>, prompt: string, style: string) {
  return api<{ url: string }>('aiGenerateImage', { spaceId: page.space_id, pageId: page.id, prompt, style });
}

export function editBlockImage(blockId: string, instruction: string) {
  return api<{ url: string; recordMap: any }>('aiEditImageBlock', { blockId, instruction }).then((r) => { records.mergeRecordMap(r.recordMap); return r; });
}

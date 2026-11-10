// AI image generation endpoints (…004): availability for the picker / settings, generate into an
// image block (Image block › AI tab, "/AI Image"), "Edit with AI" on generated images, and a standalone generate
// used by page covers. Logic: apps/server/src/ai/image.ts (+ the chat tool in ai/imageTool.ts).
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { isSpaceMember } from '@nc/shared/permissions.ts';
import { getRecord } from '../../db.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { IMAGE_STYLES, ImageError, aiImageOf, editBlockImage, generateImage, generateIntoBlock, imagePolicy, imageProvider } from '../../ai/image.ts';
import '../../ai/imageTool.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ImageError) throw Object.assign(new ApiError(e.message, e.status), { code: e.code });
    throw e;
  }
}

function blockMap(userId: string, blockId: string) {
  const rm = new RecordMapBuilder(userId);
  rm.add('block', getRecord<BlockRecord>('block', blockId));
  return rm.map;
}

export const handlers: Record<string, Handler> = {
  aiImageStatus(ctx, { spaceId }) {
    const uid = requireUser(ctx);
    const space = getRecord<SpaceRecord>('space', String(spaceId ?? ''));
    if (!space || !isSpaceMember(space, uid)) throw new ApiError('Not found', 404);
    const p = imagePolicy(space.id);
    return { ...p, available: p.planIncluded && p.enabled && p.aiEnabled, provider: imageProvider().label, styles: IMAGE_STYLES };
  },

  async aiGenerateImageBlock(ctx, { blockId, prompt, style }) {
    const uid = requireUser(ctx);
    const r = await wrap(() => generateIntoBlock({ userId: uid, blockId, prompt, style }));
    return { url: r.file.url, fileId: r.file.id, width: r.width, height: r.height, recordMap: blockMap(uid, r.blockId) };
  },

  async aiEditImageBlock(ctx, { blockId, instruction }) {
    const uid = requireUser(ctx);
    const r = await wrap(() => editBlockImage({ userId: uid, blockId, instruction }));
    return { url: r.file.url, fileId: r.file.id, recordMap: blockMap(uid, r.blockId) };
  },

  /** Whether "Edit with AI" can work on this image (made by an image provider that can edit its own output). */
  aiImageInfo(ctx, { blockId }) {
    const uid = requireUser(ctx);
    const b = getRecord<BlockRecord>('block', String(blockId ?? ''));
    if (!b || blockRole(b.id, uid) === 'none') throw new ApiError('Not found', 404);
    const meta = aiImageOf(b);
    return { generated: !!meta, prompt: meta?.prompt ?? null, style: meta?.style ?? null, editable: !!meta && imageProvider().canEdit('image/svg+xml') };
  },

  /** Page cover › AI: an image for the cover (the client sets format.page_cover). */
  async aiGenerateImage(ctx, { spaceId, prompt, style, pageId }) {
    const uid = requireUser(ctx);
    const r = await wrap(() => generateImage({ userId: uid, spaceId: String(spaceId ?? ''), prompt, style, pageId }));
    return { url: r.file.url, fileId: r.file.id, width: r.width, height: r.height };
  },
};

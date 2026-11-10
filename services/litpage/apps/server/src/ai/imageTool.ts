// AI tool "generate_image": create or edit an image from chat about the current page
// when asked ("a diagram of this page"), and put it on a page as an image block when the person wants it there. The
// image goes through the same provider / sanitizer / policy as the image block (image.ts); inserting is an ordinary
// agent edit (approval rules, Changes made card, Undo). Custom agents cannot call it.
import { op as mk } from '@nc/shared/ops.ts';
import { getRecord } from '../db.ts';
import type { BlockRecord } from '@nc/shared/records.ts';
import { OpsBuilder } from '../content/spec.ts';
import { applyAgentOps } from './changes.ts';
import { AiError } from './client.ts';
import { blockTitle } from './context.ts';
import { canEdit, normalizeId, readableBlock } from './edit.ts';
import { registerToolRuns } from './tools/registry.ts';
import type { ToolRun } from './tools/types.ts';
import { IMAGE_STYLES, ImageError, generateImage } from './image.ts';

const generateImageRun: ToolRun = async (env, input, stepId) => {
  if (env.source?.startsWith('agent:')) throw new AiError('forbidden', 'Image generation is unavailable to custom agents.', 403);
  const prompt = String(input.prompt ?? '').trim();
  const style = (IMAGE_STYLES as readonly string[]).includes(String(input.style)) ? String(input.style) : 'default';
  const aboutPage = input.about_page_id ? normalizeId(input.about_page_id) : input.use_current_page ? env.currentPageId ?? undefined : undefined;
  env.step({ id: stepId, tool: 'generate_image', status: 'running', label: 'Generating image', detail: prompt.slice(0, 80) });
  let res;
  try {
    res = await generateImage({ userId: env.userId, spaceId: env.spaceId, prompt, style, pageId: aboutPage });
  } catch (e) {
    const msg = e instanceof ImageError ? e.message : 'The image could not be created. Try again.';
    env.step({ id: stepId, tool: 'generate_image', status: 'error', label: 'Generating image', error: msg });
    return { content: msg, isError: true };
  }
  const insertId = input.insert_into_page_id ? normalizeId(input.insert_into_page_id) : null;
  let where = '';
  if (insertId) {
    const page = readableBlock(insertId, env.userId);
    if (!canEdit(page.id, env.userId)) throw new AiError('forbidden', `The user can only view “${blockTitle(page) || 'Untitled'}”, so the image can’t be added there.`, 403);
    const decision = await env.approve({
      tool: 'generate_image', stepId, risk: 'edit',
      payload: { title: 'Insert an image', description: `Add the generated image to “${blockTitle(page) || 'Untitled'}”.`, markdown: `![${prompt}](${res.file.url})`, pages: [{ pageId: page.id, title: blockTitle(page) || 'Untitled' }] },
    });
    if (decision !== 'accept') {
      env.step({ id: stepId, tool: 'generate_image', status: 'declined', label: 'Add image' });
      return { content: `The user declined adding the image to the page. The image is at ${res.file.url}.` };
    }
    const b = new OpsBuilder(page.space_id, env.userId);
    const id = b.block({
      type: 'image', url: res.file.url,
      format: { block_aspect_ratio: res.height && res.width ? res.height / res.width : undefined, block_preserve_scale: true, ai_image: { prompt: res.prompt, style: res.style, provider: res.provider, file_id: res.file.id, created_time: Date.now() } },
    }, page.id, 'block', { file_ids: [res.file.id] });
    const last = (page.content ?? []).filter((c) => getRecord<BlockRecord>('block', c)?.alive !== false).slice(-1)[0];
    b.ops.push(mk.listAfter({ table: 'block', id: page.id, spaceId: page.space_id }, ['content'], id, last));
    applyAgentOps({ userId: env.userId, spaceId: env.spaceId, turnId: env.turnId, threadId: env.threadId, clientId: env.clientId, source: env.source }, 'generate_image', b.ops, [{ pageId: page.id, title: blockTitle(page) || 'Untitled', action: 'updated' }]);
    env.touched([{ pageId: page.id, title: blockTitle(page) || 'Untitled', action: 'updated' }]);
    where = ` It was added to “${blockTitle(page) || 'Untitled'}”.`;
  }
  env.step({ id: stepId, tool: 'generate_image', status: 'done', label: 'Generated image', detail: prompt.slice(0, 80), refs: [{ url: res.file.url, title: prompt.slice(0, 80) || 'Image' }] });
  return { content: `Generated the image (${res.width}×${res.height}, style ${res.style}).${where} Show it to the user with this exact Markdown: ![${prompt.replace(/[[\]]/g, '')}](${res.file.url})` };
};

registerToolRuns({ generate_image: generateImageRun });

// HTML block → "Create with AI" (Slides / Dashboard / Report / Explainer / Prototype / Game, or a prompt):

import { getBlock } from '../../lib/blocks.ts';
import { useUI } from '../../lib/store/ui.ts';
import { pageIdOfBlock } from '../editor/commands.ts';
import { saveHtml } from '../editor/blocks/html.block.tsx';
import { isNoKeyError, NO_KEY_MESSAGE, streamAi, useAiStatus } from './aiApi.ts';

const KIND_PROMPTS: Record<string, string> = {
  slides: 'a slide deck with keyboard navigation (one slide per screen) about the page',
  dashboard: 'a data dashboard with summary cards and simple charts drawn with inline SVG',
  report: 'a well-structured summary report of the page',
  explainer: 'an interactive explainer of the main idea of the page',
  prototype: 'a clickable user-interface prototype',
  game: 'a small playable game',
};


export function extractHtml(text: string): string {
  let t = text.trim();
  const fence = /```(?:html)?\s*\n([\s\S]*?)\n```/i.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) t = t.slice(start);
  return t;
}

export async function createHtmlWithAi(blockId: string, kind: string, prompt?: string) {
  if (useAiStatus.getState().configured === false) {
    useUI.getState().toast(NO_KEY_MESSAGE);
    return;
  }
  const what = prompt?.trim() || KIND_PROMPTS[kind] || `a ${kind}`;
  useUI.getState().toast('Litpage AI is creating your HTML…');
  try {
    const done = await streamAi({ kind: 'writer', pageId: pageIdOfBlock(blockId) ?? getBlock(blockId)?.parent_id, skill: 'html', prompt: what }, {});
    if (done.status !== 'complete') {
      useUI.getState().toast(done.error?.message ?? 'Litpage AI couldn’t create the HTML.');
      return;
    }
    const html = extractHtml(done.text);
    if (!/<html[\s>]|<!doctype html/i.test(html)) {
      useUI.getState().toast('Litpage AI couldn’t create the HTML. Try again.');
      return;
    }
    await saveHtml(blockId, html, `${kind || 'page'}.html`);
  } catch (e) {
    useUI.getState().toast(isNoKeyError(e) ? NO_KEY_MESSAGE : (e as Error)?.message || 'Litpage AI couldn’t create the HTML.');
  }
}

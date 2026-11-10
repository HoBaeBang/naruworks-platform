// Generates an image and stores the resulting asset in the block. Shown in the image picker and the "/AI Image" popover.

import { useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { ApiError } from '../../lib/api.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { NO_KEY_MESSAGE, ensureAiStatus, isNoKeyError, useAiStatus } from '../ai/aiApi.ts';
import { NoKeyNotice } from '../ai/NoKeyNotice.tsx';
import { t } from '../shell/i18n.ts';
import { PREFILLS, STYLES, generateIntoBlock, imageSwitchOn, planIncludesImages } from './api.ts';
import './aiImage.css';


export function aiImageTabs(b: Pick<BlockRecord, 'space_id'>): 'ai'[] {
  return planIncludesImages(b.space_id) && imageSwitchOn(b.space_id) ? ['ai'] : [];
}


export function imageErrorText(e: unknown): { text: string; noKey: boolean } {
  if (isNoKeyError(e)) return { text: NO_KEY_MESSAGE, noKey: true };
  const status = e instanceof ApiError ? e.status : 0;
  const msg = (e as Error)?.message ?? '';
  if (status === 429) return { text: t('lp.aiimage.you_have_reached_the_image_limit', 'You have reached the image limit. Try again later.'), noKey: false };
  if (status >= 500 || !status) return { text: t('lp.aiimage.image_generation_is_temporarily_unavaila', 'Image generation is temporarily unavailable. Try again.'), noKey: false };
  if (/content policy|request is not allowed/i.test(msg)) return { text: t('lp.aiimage.that_image_request_is_not_allowed', 'That image request is not allowed. Try a different description.'), noKey: false };
  return { text: msg || t('lp.aiimage.the_image_could_not_be_created', 'The image could not be created. Try again.'), noKey: false };
}


export function AiImageTab({ blockId, close, generate }: { blockId?: string; close: () => void; generate?: (prompt: string, style: string) => Promise<unknown> }) {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; noKey: boolean } | null>(null);
  const configured = useAiStatus((s) => s.configured);
  const ref = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    ensureAiStatus();
    ref.current?.focus();
    return () => { alive.current = false; };
  }, []);

  const submit = async () => {
    const p = prompt.trim();
    if (busy) return;
    if (!p) {
      ref.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (generate) await generate(p, style);
      else if (blockId) await generateIntoBlock(blockId, p, style);
      close();
    } catch (e) {
      if (isNoKeyError(e)) useAiStatus.getState().markUnconfigured();
      if (alive.current) setError(imageErrorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const noKey = configured === false || error?.noKey;
  return (
    <div className="nc-aiimg" data-testid="ai-image-tab">
      <div className="nc-aiimg-input">
        <textarea
          ref={ref}
          rows={2}
          aria-label={t('lp.aiimage.tell_us_what_image_you_want', 'Tell us what image you want to create…')}
          placeholder={t('lp.aiimage.tell_us_what_image_you_want', 'Tell us what image you want to create…')}
          value={prompt}
          disabled={busy}
          maxLength={4000}
          onChange={(e) => { setPrompt(e.target.value); setError(null); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
      </div>
      <div className="nc-aiimg-styles" role="group" aria-label="Style">
        {STYLES.map((s) => (
          <button key={s.key} type="button" className="nc-aiimg-style" aria-pressed={style === s.key} disabled={busy} onMouseDown={(e) => e.preventDefault()} onClick={() => setStyle(s.key)}>
            {s.label()}
          </button>
        ))}
      </div>
      {!prompt.trim() && !busy && (
        <div className="nc-aiimg-suggest">
          {PREFILLS.slice(0, 3).map((p) => (
            <div key={p.style} role="button" tabIndex={0} onMouseDown={(e) => e.preventDefault()} onClick={() => { setPrompt(p.text()); setStyle(p.style); ref.current?.focus(); }}>
              <Icon name="aiFace" size={14} />
              {p.text()}
            </div>
          ))}
        </div>
      )}
      {noKey && <NoKeyNotice compact />}
      <div className="nc-aiimg-row">
        {busy
          ? <span className="nc-aiimg-busy" role="status"><span className="nc-aiimg-spinner" />{t('lp.aiimage.generating_image', 'Generating image…')}</span>
          : <span className="nc-aiimg-caption grow">{t('lp.aiimage.create_a_custom_image_with_ai', 'Create a custom image with AI from your description')}</span>}
        <button
          type="button"
          className="nc-blk-btn primary"
          aria-label={t('lp.aiimage.generate_image', 'Generate image')}
          disabled={busy || !prompt.trim() || !!noKey}
          onClick={() => void submit()}
        >
          {t('lp.aiimage.generate_image_9ab1', 'Generate Image')}
        </button>
      </div>
      {error && !error.noKey && <div className="nc-aiimg-error" role="alert">{error.text}</div>}
    </div>
  );
}


export function openAiImagePopover(blockId: string, anchor: HTMLElement | DOMRect) {
  return openOverlay((close) => (
    <PopoverSurface width={540} className="nc-media-picker">
      <div className="nc-aiimg-head"><Icon name="aiFace" size={16} />{t('lp.aiimage.litpage_ai', 'Litpage AI')}</div>
      <div className="nc-aiimg-pad"><AiImageTab blockId={blockId} close={close} /></div>
    </PopoverSurface>
  ), { anchor, placement: 'bottom', offset: 0 });
}

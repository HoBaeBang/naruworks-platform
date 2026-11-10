
// Lets users regenerate an image. Uploaded or linked raster images are shown as unavailable.
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { useRecord } from '../../lib/hooks.ts';
import { openOverlay, PopoverSurface } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { ActionButton } from '../editor/blocks/shared.tsx';
import { ensureAiStatus, isNoKeyError, useAiStatus } from '../ai/aiApi.ts';
import { NoKeyNotice } from '../ai/NoKeyNotice.tsx';
import { t } from '../shell/i18n.ts';
import { editBlockImage } from './api.ts';
import { aiImageTabs, imageErrorText } from './AiImageTab.tsx';
import './aiImage.css';

interface Info { generated: boolean; prompt: string | null; style: string | null; editable: boolean }


export function AiImageEditButton({ block, readOnly }: { block: BlockRecord; readOnly: boolean }) {
  useRecord<SpaceRecord>('space', block.space_id); // re-render when the workspace switch / plan changes
  if (readOnly || !aiImageTabs(block).length) return null;
  const label = t('lp.aiimage.edit_with_ai', 'Polish with AI');
  return (
    <ActionButton icon="wand" label={label} className="nc-aiimg-edit-btn" onClick={(e) => openEditWithAi(block.id, e.currentTarget)}>
      <span style={{ fontSize: 14, marginInlineStart: 4 }}>{label}</span>
    </ActionButton>
  );
}

export function openEditWithAi(blockId: string, anchor: HTMLElement) {
  return openOverlay((close) => <EditPopover blockId={blockId} close={close} />, { anchor, placement: 'bottom-start', offset: 6 });
}

function EditPopover({ blockId, close }: { blockId: string; close: () => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; noKey: boolean } | null>(null);
  const [rounds, setRounds] = useState(0);
  const configured = useAiStatus((s) => s.configured);
  const ref = useRef<HTMLTextAreaElement>(null);
  const alive = useRef(true);
  useEffect(() => {
    ensureAiStatus();
    api<Info>('aiImageInfo', { blockId })
      .then((r) => { if (alive.current) setInfo(r); })
      .catch(() => { if (alive.current) setInfo({ generated: false, prompt: null, style: null, editable: false }); });
    return () => { alive.current = false; };
  }, [blockId]);
  useEffect(() => { if (info?.editable) ref.current?.focus(); }, [info?.editable]);

  const submit = async () => {
    const v = text.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      await editBlockImage(blockId, v);
      if (!alive.current) return;
      
      setText('');
      setRounds((n) => n + 1);
      ref.current?.focus();
    } catch (e) {
      if (isNoKeyError(e)) useAiStatus.getState().markUnconfigured();
      if (alive.current) setError(imageErrorText(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const title = t('lp.aiimage.edit_with_ai', 'Polish with AI');
  return (
    <PopoverSurface width={380}>
      <div className="nc-aiimg-head"><Icon name="wand" size={16} />{title}</div>
      <div className="nc-aiimg nc-aiimg-pad" data-testid="ai-image-edit">
        {!info ? (
          <span className="nc-aiimg-busy"><span className="nc-aiimg-spinner" />{t('lp.aiimage.loading', 'Loading…')}</span>
        ) : !info.editable ? (
          <div className="nc-aiimg-note" role="status">
            <Icon name="info" size={16} style={{ color: 'var(--lp-icon-secondary)', flexShrink: 0, marginTop: 1 }} />
            <div>
              <div>{t('lp.aiimage.edit_with_ai_is_only_available', 'Polish with AI is only available for images created with Litpage AI.')}</div>
              <div className="sub">{t('lp.aiimage.uploaded_and_linked_images_can_t', 'Uploaded and linked images can’t be changed with AI. Generate a new image from the image block’s Litpage AI tab instead.')}</div>
            </div>
          </div>
        ) : (
          <>
            {info.prompt && <div className="nc-aiimg-prompt" title={info.prompt}>{info.prompt}</div>}
            <div className="nc-aiimg-input">
              <textarea
                ref={ref}
                rows={2}
                aria-label={title}
                placeholder={t('lp.aiimage.describe_what_to_change', 'Describe what to change…')}
                value={text}
                disabled={busy}
                maxLength={4000}
                onChange={(e) => { setText(e.target.value); setError(null); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void submit();
                  }
                }}
              />
            </div>
            {(configured === false || error?.noKey) && <NoKeyNotice compact />}
            <div className="nc-aiimg-row">
              {busy
                ? <span className="nc-aiimg-busy grow" role="status"><span className="nc-aiimg-spinner" />{t('lp.aiimage.updating_image', 'Updating image…')}</span>
                : <span className="nc-aiimg-caption grow">{rounds ? t('lp.aiimage.image_updated_describe_another_change_or', 'Image updated. Describe another change or close.') : t('lp.aiimage.litpage_ai_redraws_this_image_with', 'Litpage AI redraws this image with your changes.')}</span>}
              <button type="button" className="nc-blk-btn" onClick={close}>{t('lp.aiimage.done', 'Done')}</button>
              <button type="button" className="nc-blk-btn primary" disabled={busy || !text.trim() || configured === false} onClick={() => void submit()}>
                {t('lp.aiimage.apply', 'Apply')}
              </button>
            </div>
            {error && !error.noKey && <div className="nc-aiimg-error" role="alert">{error.text}</div>}
          </>
        )}
      </div>
    </PopoverSurface>
  );
}

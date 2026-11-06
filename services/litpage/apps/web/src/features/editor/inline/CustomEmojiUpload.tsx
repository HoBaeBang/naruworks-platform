// "Add a custom emoji" popup opened by the "+" of the emoji pickers (":" autocomplete, /emoji, icon picker, reactions).
// Labels include the title "Add a custom emoji", "Custom emoji can be used by anyone in your
// workspace", "Upload an image file", "or", "Paste an image URL…", "or ⌘V to paste an image or link", "Next",
// "Emoji name" / "add-your-emoji", "Preview", "Back", "Save", name/image errors). Saves through the workspace API
// (api/modules/workspace.ts addCustomEmoji: member check, "Limit custom emoji creation" setting, name rules) that
// Settings › Emoji uses; the space record update reaches every picker (and other sessions) through realtime.
import { useEffect, useRef, useState } from 'react';
import { openOverlay, PopoverSurface, type Anchor } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { api, uploadFile } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { getCustomEmojis, type CustomEmoji } from '../../settings/customEmoji.ts';

const NAME_RE = /^[a-z0-9_-]{1,49}$/;
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

export function openCustomEmojiUpload(anchor: Anchor, opts?: { onAdded?: (e: CustomEmoji) => void }) {
  return openOverlay((close) => <CustomEmojiUpload close={close} onAdded={opts?.onAdded} />, { anchor, placement: 'bottom-start', offset: 6 });
}

function suggestName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

function CustomEmojiUpload({ close, onAdded }: { close: () => void; onAdded?: (e: CustomEmoji) => void }) {
  const spaceId = useSession((s) => s.spaceId);
  const [step, setStep] = useState<'image' | 'name'>('image');
  const [url, setUrl] = useState('');
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const n = name.trim().toLowerCase().replace(/\s+/g, '-');
  const taken = getCustomEmojis(spaceId).some((e) => e.name === n);
  const nameErr = !n ? '' : n.length >= 50
    ? 'Name must be under 50 characters'
    : !NAME_RE.test(n)
      ? 'Use lowercase letters, numbers, hyphens, or underscores only'
      : taken ? 'That name is already in use' : '';

  const takeFile = async (f: File | Blob | null | undefined, fileName = 'emoji.png') => {
    if (!f) return;
    if (!(f.type || '').startsWith('image/')) {
      setErr('Upload an image file file');
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const up = await uploadFile(f, (f as File).name ?? fileName, spaceId ?? undefined);
      setUrl(up.url);
      if (!name) setName(suggestName((f as File).name ?? fileName));
      setStep('name');
    } catch (e: any) {
      setErr(e?.message ?? 'Emoji save failed. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const takeLink = (raw: string) => {
    const v = raw.trim();
    if (!v) return;
    if (!/^https?:\/\/\S+$/i.test(v)) {
      setErr('This link doesn’t point to an image');
      return;
    }
    setBusy(true);
    const probe = new Image();
    probe.onload = () => {
      setBusy(false);
      setErr('');
      setUrl(v);
      if (!name) setName(suggestName(decodeURIComponent(v.split('/').pop()?.split('?')[0] ?? 'emoji')));
      setStep('name');
    };
    probe.onerror = () => {
      setBusy(false);
      setErr('This link doesn’t point to an image');
    };
    probe.src = v;
  };

  // ⌘V anywhere in the popup: an image file or an image link
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (step !== 'image') return;
      const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith('image/'));
      if (file) {
        e.preventDefault();
        void takeFile(file);
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (/^https?:\/\//i.test(text.trim()) && !(e.target as HTMLElement | null)?.closest?.('input')) {
        e.preventDefault();
        setLink(text.trim());
        takeLink(text);
      }
    };
    window.addEventListener('paste', onPaste, true);
    return () => window.removeEventListener('paste', onPaste, true);
  });

  const save = async () => {
    if (!url || !n || nameErr || busy || !spaceId) return;
    setBusy(true);
    try {
      const res = await api<{ emoji: CustomEmoji; recordMap?: unknown }>('addCustomEmoji', { spaceId, name: n, url });
      if (res?.recordMap) records.mergeRecordMap(res.recordMap as any);
      close();
      if (res?.emoji) onAdded?.(res.emoji);
    } catch (e: any) {
      setErr(e?.message ?? 'Emoji save failed. Try again.');
      setBusy(false);
    }
  };

  return (
    <PopoverSurface width={300} className="nc-cemoji-popup">
      <div role="dialog" aria-label="Add a custom emoji" className="nc-cemoji" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } }}>
        <div className="nc-cemoji-title">Add a custom emoji</div>
        <div className="nc-cemoji-desc">Anyone on your team can use this custom emoji</div>
        {step === 'image' ? (
          <>
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; void takeFile(f); }} data-testid="custom-emoji-file" />
            <div role="button" className={`nc-cemoji-btn primary ${busy ? 'disabled' : ''}`} onClick={() => !busy && fileRef.current?.click()}>
              {busy ? 'Uploading…' : 'Upload an image file'}
            </div>
            <div className="nc-cemoji-or"><span>or</span></div>
            <div className="nc-input">
              <input
                placeholder="Paste an image URL…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); takeLink(link); } }}
              />
            </div>
            <div className="nc-cemoji-hint">or {isMac ? '⌘V' : 'Ctrl+V'} to paste an image or link</div>
            {err && <div className="nc-cemoji-err" role="alert">{err}</div>}
            {link.trim() && <div role="button" className="nc-cemoji-btn" onClick={() => takeLink(link)}>Next</div>}
          </>
        ) : (
          <>
            <div className="nc-cemoji-preview">
              <span className="label">Preview</span>
              <img src={url} alt="" />
              <span className="name">:{n || 'emoji'}:</span>
            </div>
            <label className="nc-cemoji-label" htmlFor="nc-cemoji-name">Emoji name</label>
            <div className="nc-input">
              <input
                id="nc-cemoji-name"
                autoFocus
                placeholder="add-your-emoji"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save(); } }}
              />
            </div>
            {(nameErr || err) && <div className="nc-cemoji-err" role="alert">{nameErr || err}</div>}
            <div className="nc-cemoji-actions">
              <div role="button" className="nc-cemoji-btn" onClick={() => { setStep('image'); setErr(''); }}><Icon name="arrowLeft" size={14} />Back</div>
              <div style={{ flex: 1 }} />
              <div role="button" className={`nc-cemoji-btn primary ${!n || nameErr || busy ? 'disabled' : ''}`} onClick={() => void save()}>Save</div>
            </div>
          </>
        )}
      </div>
    </PopoverSurface>
  );
}

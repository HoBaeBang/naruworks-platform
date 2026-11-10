// Page/callout icon picker:
// 408×390 menu, tabs Emoji · Icons · Upload (+ Remove), "Filter…" search with Random and a skin-tone /
// icon-color button, 32px emoji cells at 24px, category bar at the bottom (Recent, People, Nature, Food,
// Activity, Travel, Objects, Symbols, Flags, Custom, Add). Icons tab: Lucide-drawn set (iconSet.ts) with
// a palette of icon colors and "Ask every time". Upload: file or link (280×280 recommended, 5 MB).
import { useEffect, useMemo, useRef, useState } from 'react';
import emojiData from 'emojibase-data/en/compact.json';
import { openOverlay, PopoverSurface, type Anchor } from '../../components/overlay.tsx';
import { Icon } from '../../components/Icon.tsx';
import { api, uploadFile } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { t } from '../shell/i18n.ts';
import { ICON_SET } from './iconSet.ts';
import { customEmojiIcon, searchCustomEmojis, useCustomEmojis, type CustomEmoji } from '../settings/customEmoji.ts';
import { openCustomEmojiUpload } from '../editor/inline/CustomEmojiUpload.tsx';
import './pickers.css';
import { colorToken } from '../../lib/colorToken.ts';

interface Emoji { unicode: string; label: string; group: number; tags?: string[]; order?: number; skins?: string[] }
const EMOJIS: Emoji[] = (emojiData as any[])
  .filter((e) => e.group !== undefined && e.group !== 2)
  .map((e) => ({ unicode: e.unicode, label: e.label, group: e.group, tags: e.tags, order: e.order, skins: (e.skins as any[] | undefined)?.map((s) => s.unicode) }));
const BY_UNICODE = new Map(EMOJIS.map((e) => [e.unicode, e]));

/** Emoji sections (Smileys and People merged into "People"). */
const SECTIONS: { id: string; title: string; groups: number[]; icon: string }[] = [
  { id: 'people', title: t('lp.page.people', 'People'), groups: [0, 1], icon: 'emojiFace' },
  { id: 'animals', title: t('lp.page.animals_nature', 'Animals & nature'), groups: [3], icon: 'leaf' },
  { id: 'food', title: t('lp.page.food_drinks', 'Food & drinks'), groups: [4], icon: 'emojiFood' },
  { id: 'activity', title: t('lp.page.activity', 'Activity'), groups: [6], icon: 'emojiActivity' },
  { id: 'travel', title: t('lp.page.travel_places', 'Travel & places'), groups: [5], icon: 'emojiTravel' },
  { id: 'objects', title: t('lp.page.objects', 'Objects'), groups: [7], icon: 'emojiObjects' },
  { id: 'symbols', title: t('lp.page.symbols', 'Symbols'), groups: [8], icon: 'emojiSymbols' },
  { id: 'flags', title: t('lp.page.flags', 'Flags'), groups: [9], icon: 'emojiFlags' },
];
const CALLOUT = ['💡', '👉', '☝️', '👌', '🔑', '🚧', '⚠️', '🔥', '📌', '✂️', '❓', '🚫', '⛔', '⏰', '☎️', '🚨', '♻️', '✅', '🔒', '📎', '📖', '🗣️', '➡️', '📢', '🛠️', '⚙️'];
const SKIN_TONES = ['', '🏻', '🏼', '🏽', '🏾', '🏿'];
export const ICON_COLORS = ['gray', 'lightgray', 'brown', 'yellow', 'orange', 'green', 'blue', 'purple', 'pink', 'red'];
const ICON_COLOR_LABEL: Record<string, string> = {
  gray: t('lp.page.default', 'Default'), lightgray: t('lp.page.light_gray', 'Light Gray'), brown: t('lp.page.brown', 'Brown'),
  yellow: t('lp.page.yellow', 'Yellow'), orange: t('lp.page.orange', 'Orange'), green: t('lp.page.green', 'Green'),
  blue: t('lp.page.blue', 'Blue'), purple: t('lp.page.purple', 'Purple'), pink: t('lp.page.pink', 'Pink'), red: t('lp.page.red', 'Red'),
};
export function iconColorCss(c: string): string {
  return c === 'lightgray' ? 'var(--lp-gray-icon-tertiary, #818cf8)' : `var(${colorToken(c.slice(0, 3), 'text-accent')})`;
}

export function randomEmoji(): string {
  const pool = EMOJIS.filter((e) => e.group === 0 || e.group === 3 || e.group === 4 || e.group === 7);
  return pool[Math.floor(Math.random() * pool.length)]?.unicode ?? '📄';
}

function ls<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function lsSet(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
const RECENT_KEY = 'nc:recentEmojis';
const RECENT_ICONS_KEY = 'nc:recentIcons';
function pushRecent(key: string, u: string) {
  lsSet(key, [u, ...ls<string[]>(key, []).filter((x) => x !== u)].slice(0, 24));
}

function withSkin(e: Emoji, tone: number): string {
  if (!tone || !e.skins?.length) return e.unicode;
  return e.skins[tone - 1] ?? e.unicode;
}

export function openIconPicker(anchor: Anchor, opts: { current?: string; onPick: (v: string | null) => void; callout?: boolean; title?: string }) {
  return openOverlay((close) => <IconPicker {...opts} close={close} />, { anchor, placement: 'bottom-start', offset: 6 });
}

/** Emoji-only picker (comment reactions, inline emoji). */
export function openEmojiPicker(anchor: Anchor, opts: { onPick: (emoji: string) => void; quick?: string[] }) {
  return openOverlay((close) => (
    <PopoverSurface width={408} maxHeight={390} className="nc-icon-picker lit-media-menu">
      <EmojiPanel onPick={(e) => { opts.onPick(e); close(); }} quick={opts.quick} autoFocus />
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 6 });
}

function IconPicker({ current, onPick, close, callout, title }: { current?: string; onPick: (v: string | null) => void; close: () => void; callout?: boolean; title?: string }) {
  const [tab, setTab] = useState<'emoji' | 'icons' | 'upload'>(() => (current?.startsWith('lit-icon:') ? 'icons' : current && /^(https?:|\/files\/|data:)/.test(current) ? 'upload' : 'emoji'));
  const pick = (v: string | null) => {
    if (v && !v.startsWith('lit-icon') && !/^(https?:|\/|data:)/.test(v)) pushRecent(RECENT_KEY, v);
    if (v?.startsWith('lit-icon:')) pushRecent(RECENT_ICONS_KEY, v);
    onPick(v);
    close();
  };
  return (
    <PopoverSurface width={408} maxHeight={390} className="nc-icon-picker lit-media-menu" style={{ height: 390 }}>
      <div className="nc-tabs-row" role="tablist" aria-label={title ?? t('lp.page.page_icon', 'Page icon')}>
        {(['emoji', 'icons', 'upload'] as const).map((k) => (
          <div key={k} className={`nc-tab-wrap ${tab === k ? 'active' : ''}`}>
            <div role="tab" aria-selected={tab === k} className="nc-tab" onClick={() => setTab(k)}>
              {k === 'emoji' ? t('lp.page.emoji', 'Emoji') : k === 'icons' ? t('lp.page.icons', 'Icons') : t('lp.page.upload', 'Upload')}
            </div>
          </div>
        ))}
        <div style={{ flex: 1 }} />
        {current && <div role="button" className="nc-tab nc-tab-action" onClick={() => pick(null)}>{t('lp.page.remove', 'Remove')}</div>}
      </div>
      {tab === 'emoji' && <EmojiPanel onPick={pick} callout={callout} autoFocus />}
      {tab === 'icons' && <IconsPanel onPick={pick} current={current} />}
      {tab === 'upload' && <UploadPanel onPick={pick} />}
    </PopoverSurface>
  );
}

function SearchRow({ q, setQ, onRandom, right, autoFocus }: { q: string; setQ: (v: string) => void; onRandom: () => void; right?: React.ReactNode; autoFocus?: boolean }) {
  return (
    <div className="nc-picker-search">
      <div className="nc-picker-filter">
        <Icon name="search" size={14} style={{ color: 'var(--lp-icon-secondary)', marginInlineEnd: 6 }} />
        <input autoFocus={autoFocus} role="combobox" placeholder={t('lp.page.filter', 'Filter…')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div role="button" aria-label={t('lp.page.random', 'Random')} className="nc-picker-square-btn" data-tooltip={t('lp.page.random', 'Random')} onClick={onRandom}>
        <Icon name="shuffle" size={14} />
      </div>
      {right}
    </div>
  );
}

function EmojiPanel({ onPick, callout, quick, autoFocus }: { onPick: (v: string) => void; callout?: boolean; quick?: string[]; autoFocus?: boolean }) {
  const [q, setQ] = useState('');
  // workspace custom emoji (Settings › Emoji): "Custom" section, filter hits, "+" = Add a custom emoji
  const customs = useCustomEmojis();
  const customHits = useMemo(() => (q.trim() ? searchCustomEmojis(q) : []), [q, customs]); // eslint-disable-line react-hooks/exhaustive-deps
  const customCell = (e: CustomEmoji) => (
    <div key={`c:${e.id}`} role="gridcell" aria-label={e.name} data-tooltip={`:${e.name}:`} data-custom-emoji={e.name} className="nc-emoji-cell" onClick={() => onPick(customEmojiIcon(e))}>
      <img src={e.url} alt={`:${e.name}:`} draggable={false} />
    </div>
  );
  const [tone, setTone] = useState<number>(() => ls('nc:skinTone', 0));
  const scroller = useRef<HTMLDivElement>(null);
  const recents = ls<string[]>(RECENT_KEY, []);
  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return null;
    return EMOJIS.filter((e) => e.label.toLowerCase().includes(ql) || e.tags?.some((tg) => tg.includes(ql))).slice(0, 400);
  }, [q]);
  const toneBtn = (
    <div role="button" className="nc-picker-square-btn tone" aria-label={t('lp.page.choose_a_skin_tone', 'Choose a skin tone')} data-tooltip={t('lp.page.choose_a_skin_tone', 'Choose a skin tone')}
      onClick={(e) => openOverlay((close) => (
        <PopoverSurface className="nc-skin-tones">
          {SKIN_TONES.map((s, i) => (
            <div key={i} role="button" className={`nc-emoji-cell ${i === tone ? 'selected' : ''}`} onClick={() => { setTone(i); lsSet('nc:skinTone', i); close(); }}>
              <span>{'✋' + s}</span>
            </div>
          ))}
        </PopoverSurface>
      ), { anchor: e.currentTarget, placement: 'bottom-end', offset: 4 })}>
      <span className="nc-emoji-glyph" style={{ fontSize: 18 }}>{'✋' + SKIN_TONES[tone]}</span>
    </div>
  );
  const jump = (id: string) => {
    const el = scroller.current?.querySelector(`[data-section="${id}"]`) as HTMLElement | null;
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 4;
  };
  const cell = (u: string, label: string) => (
    <div key={u + label} role="gridcell" aria-label={label} className="nc-emoji-cell" onClick={() => onPick(u)}>
      <span className="nc-emoji-glyph">{u}</span>
    </div>
  );
  return (
    <>
      <SearchRow q={q} setQ={setQ} onRandom={() => onPick(randomEmoji())} right={toneBtn} autoFocus={autoFocus} />
      <div className="lit-scroller vertical nc-picker-body" ref={scroller}>
        {filtered ? (
          filtered.length || customHits.length ? <div className="nc-emoji-grid">{customHits.map(customCell)}{filtered.map((e) => cell(withSkin(e, tone), e.label))}</div> : <div className="nc-picker-empty">{t('lp.page.no_results', 'No results')}</div>
        ) : (
          <>
            {quick && (
              <div data-section="quick">
                <div className="nc-picker-section">{t('lp.page.recent', 'Recent')}</div>
                <div className="nc-emoji-grid">{[...new Set([...recents.slice(0, 12), ...quick])].slice(0, 12).map((u) => cell(u, BY_UNICODE.get(u)?.label ?? u))}</div>
              </div>
            )}
            {!quick && recents.length > 0 && (
              <div data-section="recent">
                <div className="nc-picker-section">{t('lp.page.recent', 'Recent')}</div>
                <div className="nc-emoji-grid">{recents.slice(0, 24).map((u) => cell(u, BY_UNICODE.get(u)?.label ?? u))}</div>
              </div>
            )}
            {callout && (
              <div data-section="callout">
                <div className="nc-picker-section">{t('lp.page.callout', 'Callout')}</div>
                <div className="nc-emoji-grid">{CALLOUT.map((u) => cell(u, BY_UNICODE.get(u)?.label ?? u))}</div>
              </div>
            )}
            {SECTIONS.map((s) => (
              <div key={s.id} data-section={s.id}>
                <div className="nc-picker-section">{s.title}</div>
                <div className="nc-emoji-grid">{EMOJIS.filter((e) => s.groups.includes(e.group)).map((e) => cell(withSkin(e, tone), e.label))}</div>
              </div>
            ))}
            {customs.length > 0 && (
              <div data-section="custom">
                <div className="nc-picker-section">{t('lp.page.custom', 'Custom')}</div>
                <div className="nc-emoji-grid">{customs.map(customCell)}</div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="nc-picker-categories">
        <div role="button" className="nc-cat-btn" aria-label="Jump to category: recent" onClick={() => jump(quick ? 'quick' : 'recent')}><Icon name="clock" size={20} /></div>
        {SECTIONS.map((s) => (
          <div key={s.id} role="button" className="nc-cat-btn" aria-label={t('lp.page.go_to_category', 'Go to category: {category}', { category: s.title })} onClick={() => jump(s.id)}>
            <Icon name={s.icon} size={20} />
          </div>
        ))}
        <div role="button" className="nc-cat-btn" aria-label="Jump to category: custom" onClick={(e) => (customs.length ? jump('custom') : openCustomEmojiUpload(e.currentTarget))}><Icon name="emojiCustom" size={20} /></div>
        <div role="button" className="nc-cat-btn" aria-label={t('lp.page.add_emoji', 'Add emoji')} data-tooltip={t('lp.page.add_emoji', 'Add emoji')} onClick={(e) => openCustomEmojiUpload(e.currentTarget)}><Icon name="plusCircleFill" size={20} /></div>
      </div>
    </>
  );
}

function IconsPanel({ onPick, current }: { onPick: (v: string) => void; current?: string }) {
  const [q, setQ] = useState('');
  const initialColor = current?.startsWith('lit-icon:') ? current.split(':')[2] || 'gray' : ls('nc:iconColor', 'gray');
  const [color, setColor] = useState<string>(ICON_COLORS.includes(initialColor) ? initialColor : 'gray');
  const [ask, setAsk] = useState<boolean>(() => ls('nc:iconAskColor', false));
  const recents = ls<string[]>(RECENT_ICONS_KEY, []).filter((v) => ICON_SET.some((i) => i.name === v.split(':')[1]));
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return ql ? ICON_SET.filter((i) => i.words.includes(ql)) : ICON_SET;
  }, [q]);
  const colorMenu = (anchor: Anchor, onChoose: (c: string) => void, showAsk: boolean) => openOverlay((close) => (
    <PopoverSurface className="nc-icon-color-menu">
      <div className="nc-icon-color-grid">
        {ICON_COLORS.map((c) => (
          <div key={c} role="button" aria-label={ICON_COLOR_LABEL[c]} data-tooltip={ICON_COLOR_LABEL[c]} className={`nc-icon-color ${color === c ? 'active' : ''}`} style={{ ['--dot' as any]: iconColorCss(c) }}
            onClick={() => { onChoose(c); close(); }} />
        ))}
      </div>
      {showAsk && (
        <div role="button" className="nc-icon-ask" onClick={() => { const v = !ask; setAsk(v); lsSet('nc:iconAskColor', v); }}>
          <span>{t('lp.page.ask_each_time', 'Ask each time')}</span>
          <span className={`nc-toggle ${ask ? 'on' : ''}`} />
        </div>
      )}
    </PopoverSurface>
  ), { anchor, placement: 'bottom-start', offset: 4 });
  const choose = (name: string, el: HTMLElement) => {
    if (ask) colorMenu(el, (c) => onPick(`lit-icon:${name}:${c}`), false);
    else onPick(`lit-icon:${name}:${color}`);
  };
  const colorBtn = (
    <div role="button" className="nc-picker-square-btn" aria-label={t('lp.page.choose_an_icon_color_current', 'Choose an icon color. Current: {iconColor}', { iconColor: ICON_COLOR_LABEL[color] })}
      data-tooltip={t('lp.page.choose_icon_color', 'Choose icon color')}
      onClick={(e) => colorMenu(e.currentTarget, (c) => { setColor(c); lsSet('nc:iconColor', c); }, true)}>
      <span className="nc-icon-color-dot" style={{ background: iconColorCss(color) }} />
    </div>
  );
  const cell = (name: string, words: string, c = color) => (
    <div key={name + c} role="gridcell" aria-label={words} className="nc-emoji-cell" data-tooltip={words} onClick={(e) => choose(name, e.currentTarget)}>
      <Icon name={name} size={20} strokeWidth={2} style={{ color: iconColorCss(c) }} />
    </div>
  );
  return (
    <>
      <SearchRow q={q} setQ={setQ} autoFocus right={colorBtn} onRandom={() => { const i = ICON_SET[Math.floor(Math.random() * ICON_SET.length)]; onPick(`lit-icon:${i.name}:${color}`); }} />
      <div className="lit-scroller vertical nc-picker-body">
        {!q && recents.length > 0 && (
          <>
            <div className="nc-picker-section">{t('lp.page.recent', 'Recent')}</div>
            <div className="nc-emoji-grid">{recents.slice(0, 12).map((v) => { const [, n, c] = v.split(':'); return cell(n, ICON_SET.find((i) => i.name === n)?.words ?? n, c || color); })}</div>
          </>
        )}
        <div className="nc-picker-section">{t('lp.page.icons', 'Icons')}</div>
        {list.length ? <div className="nc-emoji-grid">{list.map((i) => cell(i.name, i.words))}</div> : <div className="nc-picker-empty">{t('lp.page.no_results', 'No results')}</div>}
      </div>
    </>
  );
}

/** "Add to workspace emoji library": the uploaded icon also becomes a custom emoji named after the file. */
async function addToEmojiLibrary(url: string, fileName: string, spaceId: string | undefined) {
  const base = fileName.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'emoji';
  const taken = new Set(searchCustomEmojis('').map((e) => e.name));
  let name = base;
  for (let i = 2; taken.has(name) && i < 100; i++) name = `${base}-${i}`;
  try {
    const res = await api<{ recordMap: any }>('addCustomEmoji', { spaceId, name, url });
    records.mergeRecordMap(res.recordMap);
    useUI.getState().toast(`Added :${name}: to the workspace emoji library`);
  } catch (e: any) {
    useUI.getState().toast(e?.message ?? 'Could not add the emoji');
  }
}

function UploadPanel({ onPick }: { onPick: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toLibrary, setToLibrary] = useState(false);
  const spaceId = useSession((s) => s.spaceId) ?? undefined;
  useEffect(() => setErr(''), [url]);
  return (
    <div className="nc-upload-panel">
      <div role="button" className="nc-dialog-btn outline nc-upload-btn" onClick={() => fileRef.current?.click()}>{busy ? 'Uploading…' : t('lp.page.upload_file', 'Upload file')}</div>
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        if (!f) return;
        if (f.size > 5 * 1024 * 1024) { setErr('The maximum size per file is 5 MB.'); return; }
        setBusy(true);
        try {
          const res = await uploadFile(f, f.name, spaceId);
          if (toLibrary) void addToEmojiLibrary(res.url, f.name, spaceId);
          onPick(res.url);
        } catch (er: any) {
          setErr(er?.message ?? 'Upload failed');
        } finally {
          setBusy(false);
        }
      }} />
      <div className="nc-picker-hint">{t('lp.page.works_best_at_280_280_pixels', 'Works best at 280×280 pixels')}. The maximum size per file is 5 MB.</div>
      <label className="nc-picker-check">
        <input type="checkbox" checked={toLibrary} onChange={(e) => setToLibrary(e.target.checked)} />
        <span>{t('lp.page.save_as_a_custom_emoji_for', 'Save as a custom emoji for the workspace')}</span>
      </label>
      <div className="nc-picker-filter" style={{ marginTop: 16 }}>
        <input placeholder="Paste link to an image…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && /^https?:\/\//.test(url.trim())) onPick(url.trim()); }} />
      </div>
      <div role="button" className={`nc-dialog-btn primary nc-upload-btn ${/^https?:\/\//.test(url.trim()) ? '' : 'disabled'}`} style={{ marginTop: 8 }}
        onClick={() => { if (/^https?:\/\//.test(url.trim())) onPick(url.trim()); else setErr('Enter a valid image URL.'); }}>
        {t('lp.page.submit', 'Submit')}
      </div>
      {err && <div className="nc-picker-hint" style={{ color: 'var(--lp-red-text-primary)' }}>{err}</div>}
    </div>
  );
}

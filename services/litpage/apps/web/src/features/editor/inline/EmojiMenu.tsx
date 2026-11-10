// Emoji menus:
// - ":" + name → 408px grid (12 columns, ≤3 rows) of matches, first highlighted, trailing "+" (custom emoji)
// - "/emoji" → ":" + full picker: Recent, People, Nature and animals, … with a bottom "Jump to category" bar
// Inserted as plain text (EmojiMenu.handleSubmit inserts the unicode character). Workspace custom emoji (Settings ›
// Emoji, space.settings.custom_emojis) come first in ":" results and have their own "Custom" section; picking one calls
// onPick(url, emoji) — the editor inserts a ["ce", id, spaceId] atom, reactions/page icons keep the image url.
// "+" opens the "Add a custom emoji" popup (CustomEmojiUpload.tsx).
import { useEffect, useMemo, useRef, useState } from 'react';
import emojiData from 'emojibase-data/en/compact.json';
import shortcodes from 'emojibase-data/en/shortcodes/github.json';
import unicodeNames from 'emojibase-data/meta/unicode-names.json';
import { openOverlay, type Anchor } from '../../../components/overlay.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { searchCustomEmojis, useCustomEmojis, type CustomEmoji } from '../../settings/customEmoji.ts';
import { openCustomEmojiUpload } from './CustomEmojiUpload.tsx';

export interface EmojiEntry {
  u: string;
  /** Emoji names use the Unicode character name, lower-cased with hyphens as spaces; the CLDR label is used where the UCD has no name */
  label: string;
  /** CLDR short name ("grinning face with big eyes"), searched too */
  cldr: string;
  tags: string[];
  codes: string[];
  group: number;
  order: number;
}

const SC = shortcodes as Record<string, string | string[]>;
const UN = unicodeNames as Record<string, string>;

export const EMOJIS: EmojiEntry[] = (emojiData as any[])
  .filter((e) => e.group !== undefined && e.group !== 2)
  .map((e) => {
    const sc = SC[e.hexcode];
    const label = (UN[e.hexcode] ?? e.label).toLowerCase().replace(/-/g, ' ');
    return { u: e.unicode, label, cldr: String(e.label).toLowerCase(), tags: e.tags ?? [], codes: sc ? (Array.isArray(sc) ? sc : [sc]) : [], group: e.group, order: e.order ?? 0 };
  })
  .sort((a, b) => a.order - b.order);

/** Picker categories; People merges Smileys & Emotion with People & Body. */
export const CATEGORIES: { key: string; title: string; icon: string; groups: number[]; jump: string }[] = [
  { key: 'people', title: 'People', icon: 'emojiFace', groups: [0, 1], jump: 'People & Body' },
  { key: 'nature', title: 'Nature and animals', icon: 'emojiNature', groups: [3], jump: 'Animals & Nature' },
  { key: 'food', title: 'Food and beverages', icon: 'emojiFood', groups: [4], jump: 'Food & Drink' },
  { key: 'activity', title: 'Activity', icon: 'emojiActivity', groups: [6], jump: 'Activities' },
  { key: 'travel', title: 'Travel and locations', icon: 'emojiTravel', groups: [5], jump: 'Travel & Places' },
  { key: 'objects', title: 'Objects', icon: 'emojiObjects', groups: [7], jump: 'Objects' },
  { key: 'symbols', title: 'Symbols', icon: 'emojiSymbols', groups: [8], jump: 'Symbols' },
  { key: 'flags', title: 'Flags', icon: 'emojiFlags', groups: [9], jump: 'Flags' },
];

const RECENT_KEY = 'nc:recentEmojis';
export function recentEmojis(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && !x.startsWith('/') && !x.startsWith('lit-icon')) : [];
  } catch {
    return [];
  }
}
export function pushRecentEmoji(u: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([u, ...recentEmojis().filter((x) => x !== u)].slice(0, 24)));
  } catch {
    /* storage unavailable */
  }
}

const byUnicode = new Map(EMOJIS.map((e) => [e.u, e]));
export function emojiLabel(u: string): string {
  return byUnicode.get(u)?.label ?? '';
}

/** Search “:” autocomplete, such as “:smi”: exact shortcode first, then emoji whose name starts with the query, then any emoji whose name, CLDR name, tags, or shortcodes contain it — each * group in standard emoji order. */
export function searchEmoji(q: string, limit = 35): EmojiEntry[] {
  const ql = q.toLowerCase().replace(/^:/, '').trim();
  if (!ql) return [];
  const qs = ql.replace(/[-_]+/g, ' ');
  const scored: { e: EmojiEntry; s: number }[] = [];
  for (const e of EMOJIS) {
    let s = 0;
    if (e.codes.some((c) => c === ql)) s = 3;
    else if (e.label.startsWith(qs)) s = 2;
    else if (e.label.includes(qs) || e.cldr.includes(qs) || e.tags.some((t) => t.includes(ql)) || e.codes.some((c) => c.includes(ql))) s = 1;
    if (s) scored.push({ e, s });
  }
  scored.sort((a, b) => b.s - a.s || a.e.order - b.e.order);
  return scored.slice(0, limit).map((x) => x.e);
}

export type EmojiPick = (u: string, custom?: CustomEmoji) => void;

function CustomCell({ e, active, onPick, onHover }: { e: CustomEmoji; active: boolean; onPick: () => void; onHover: () => void }) {
  return (
    <div
      role="gridcell"
      tabIndex={-1}
      aria-label={e.name}
      data-tooltip={`:${e.name}:`}
      data-custom-emoji={e.name}
      className={`nc-em-cell ${active ? 'active' : ''}`}
      onMouseDown={(ev) => ev.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
    >
      <span className="nc-em-glyph"><img src={e.url} alt={`:${e.name}:`} draggable={false} /></span>
    </div>
  );
}

function Cell({ e, active, onPick, onHover }: { e: string; active: boolean; onPick: () => void; onHover: () => void }) {
  return (
    <div
      role="gridcell"
      tabIndex={-1}
      aria-label={emojiLabel(e)}
      data-tooltip={emojiLabel(e) ? `:${byUnicode.get(e)?.codes[0] ?? emojiLabel(e)}:` : undefined}
      className={`nc-em-cell ${active ? 'active' : ''}`}
      onMouseDown={(ev) => ev.preventDefault()}
      onMouseMove={onHover}
      onClick={onPick}
    >
      <span className="nc-em-glyph">{e}</span>
    </div>
  );
}

/** ":" autocomplete grid. Keyboard is handled on window  so the editor keeps the caret. */
export function EmojiAutocomplete({ query, onPick, onClose, onAdd }: { query: string; onPick: EmojiPick; onClose: () => void; onAdd?: (anchor: HTMLElement) => void }) {
  const customs = useCustomEmojis();
  const results = useMemo<{ u: string; custom?: CustomEmoji }[]>(() => {
    const own = searchCustomEmojis(query).slice(0, 12).map((e) => ({ u: e.url, custom: e }));
    return [...own, ...searchEmoji(query, 35 - own.length).map((e) => ({ u: e.u }))];
  }, [query, customs]); // eslint-disable-line react-hooks/exhaustive-deps
  const [active, setActive] = useState(0);
  useEffect(() => setActive(0), [query]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const cols = 12;
      let d = 0;
      if (e.key === 'ArrowRight') d = 1;
      else if (e.key === 'ArrowLeft') d = -1;
      else if (e.key === 'ArrowDown') d = cols;
      else if (e.key === 'ArrowUp') d = -cols;
      if (d) {
        e.preventDefault();
        e.stopPropagation();
        setActive((a) => Math.max(0, Math.min(results.length - 1, a + d)));
      } else if ((e.key === 'Enter' || e.key === 'Tab') && results[active]) {
        e.preventDefault();
        e.stopPropagation();
        onPick(results[active].u, results[active].custom);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  if (!results.length) return null;
  // 408px dialog, 4px section padding, rows of 12 × 32px cells
  // (role=row) inside a 12px inline padding — the 12th cell overflows the right padding; "+" ends the last row
  const cells: React.ReactNode[] = results.map((e, i) => (e.custom
    ? <CustomCell key={`c:${e.custom.id}`} e={e.custom} active={i === active} onHover={() => setActive(i)} onPick={() => onPick(e.u, e.custom)} />
    : <Cell key={e.u} e={e.u} active={i === active} onHover={() => setActive(i)} onPick={() => onPick(e.u)} />
  ));
  cells.push(
    // The trailing “+” is an unlabelled gridcell for “Add a custom emoji”
    <div key="+" role="gridcell" className="nc-em-add" aria-label="Add a custom emoji" data-tooltip="Add a custom emoji" onMouseDown={(ev) => ev.preventDefault()} onClick={(ev) => (onAdd ? onAdd(ev.currentTarget) : openCustomEmojiUpload(ev.currentTarget))}>
      <Icon name="plus" size={16} />
    </div>,
  );
  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < cells.length; i += 12) rows.push(cells.slice(i, i + 12));
  return (
    <div role="dialog" className="nc-popover nc-em-menu compact" style={{ width: 408 }}>
      <div role="grid" className="nc-em-autocomplete">
        <div className="nc-em-rows">
          {rows.map((r, i) => <div key={i} role="row" className="nc-em-row">{r}</div>)}
        </div>
      </div>
    </div>
  );
}

/** Full picker: Recent + categories with the bottom "Jump to category" bar; optional filter box (popover use). */
export function EmojiPicker({ query, onPick, withSearch, onClose }: { query?: string; onPick: EmojiPick; withSearch?: boolean; onClose?: () => void }) {
  const [filter, setFilter] = useState('');
  const q = (query ?? '') || filter;
  const scroller = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeCat, setActiveCat] = useState('recent');
  const recent = recentEmojis();
  const customs = useCustomEmojis();
  const filtered = useMemo(() => (q ? searchEmoji(q, 300) : null), [q]);
  const customHits = useMemo(() => (q ? searchCustomEmojis(q) : []), [q, customs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Enter' && (customHits[0] || filtered?.[0]) && !e.isComposing) {
        e.preventDefault();
        e.stopPropagation();
        if (customHits[0]) onPick(customHits[0].url, customHits[0]);
        else onPick(filtered![0].u);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
  const sections = useMemo(
    () => CATEGORIES.map((c) => ({ ...c, items: EMOJIS.filter((e) => c.groups.includes(e.group)).map((e) => e.u) })),
    [],
  );
  const jump = (key: string) => {
    setActiveCat(key);
    const el = sectionRefs.current[key];
    if (el && scroller.current) scroller.current.scrollTop = el.offsetTop - 4;
  };
  return (
    <div role="dialog" className="nc-popover nc-em-menu full" style={{ width: 408 }}>
      {withSearch && (
        <div className="nc-em-search">
          <div className="nc-input focused">
            <input autoFocus placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
        </div>
      )}
      <div
        ref={scroller}
        className="lit-scroller vertical nc-em-scroll"
        onScroll={(e) => {
          const top = (e.currentTarget as HTMLDivElement).scrollTop + 10;
          let cur = 'recent';
          for (const c of ['recent', ...CATEGORIES.map((x) => x.key), 'custom']) {
            const el = sectionRefs.current[c];
            if (el && el.offsetTop <= top) cur = c;
          }
          setActiveCat(cur);
        }}
      >
        {filtered ? (
          <div className="nc-em-section">
            <div className="nc-em-section-title">{filtered.length || customHits.length ? 'Results' : 'No results'}</div>
            <div className="nc-em-grid">
              {customHits.map((e) => <CustomCell key={`c:${e.id}`} e={e} active={false} onHover={() => {}} onPick={() => onPick(e.url, e)} />)}
              {filtered.map((e) => <Cell key={e.u} e={e.u} active={false} onHover={() => {}} onPick={() => onPick(e.u)} />)}
            </div>
          </div>
        ) : (
          <>
            {recent.length > 0 && (
              <div className="nc-em-section" ref={(el) => { sectionRefs.current.recent = el; }}>
                <div className="nc-em-section-title">Recent</div>
                <div className="nc-em-grid">
                  {recent.map((u) => <Cell key={u} e={u} active={false} onHover={() => {}} onPick={() => onPick(u)} />)}
                </div>
              </div>
            )}
            {sections.map((s) => (
              <div key={s.key} className="nc-em-section" ref={(el) => { sectionRefs.current[s.key] = el; }}>
                <div className="nc-em-section-title">{s.title}</div>
                <div className="nc-em-grid">
                  {s.items.map((u) => <Cell key={u} e={u} active={false} onHover={() => {}} onPick={() => onPick(u)} />)}
                </div>
              </div>
            ))}
            {customs.length > 0 && (
              <div className="nc-em-section" ref={(el) => { sectionRefs.current.custom = el; }}>
                <div className="nc-em-section-title">Custom</div>
                <div className="nc-em-grid">
                  {customs.map((e) => <CustomCell key={e.id} e={e} active={false} onHover={() => {}} onPick={() => onPick(e.url, e)} />)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
      <div className="nc-em-bar">
        {[{ key: 'recent', icon: 'clock', jump: 'recent' }, ...CATEGORIES].map((c) => (
          <div key={c.key} role="button" aria-label={`Go to emoji group: ${c.jump}`} className={`nc-em-bar-btn ${activeCat === c.key ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => jump(c.key)}>
            <Icon name={c.icon} size={18} />
          </div>
        ))}
        <div role="button" aria-label="Jump to category: custom" className={`nc-em-bar-btn ${activeCat === 'custom' ? 'active' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={(e) => (customs.length ? jump('custom') : openCustomEmojiUpload(e.currentTarget))}>
          <Icon name="emojiCustom" size={18} />
        </div>
        <div role="button" aria-label="Jump to category: add" data-tooltip="Add emoji" className="nc-em-bar-btn" onMouseDown={(e) => e.preventDefault()} onClick={(e) => openCustomEmojiUpload(e.currentTarget)}>
          <Icon name="plusCircleFill" size={18} />
        </div>
      </div>
    </div>
  );
}

/** Emoji picker as a popover (text action menu reactions). */
export function openEmojiPopover(anchor: Anchor, onPick: EmojiPick, onClose?: () => void) {
  return openOverlay(
    (close) => (
      <EmojiPicker
        withSearch
        onClose={close}
        onPick={(u, custom) => {
          if (!custom) pushRecentEmoji(u);
          close();
          onPick(u, custom);
        }}
      />
    ),
    { anchor, placement: 'bottom-start', offset: 6, onClose },
  );
}

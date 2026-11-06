// Inline trigger menus driven by text typed in a block:
// "/" command menu (slashItems.ts) · "@" mention menu · "[[" / "+" link-to-page · ":" emoji autocomplete / picker.
// The typed "<trigger><query>" stays in the block (decorated by inline/TriggerDecor with the ghost completion);
// picking an item replaces it. Menus anchor at the trigger's first character (bottom-start, flipping above).
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { deleteRange, insertRich, length, MENTION_CHAR, toPlainText } from '@nc/shared/richtext.ts';
import { openOverlay, useOverlays, type Placement } from '../../components/overlay.tsx';
import { Menu, type MenuDef, type MenuItemDef } from '../../components/Menu.tsx';
import { Icon } from '../../components/Icon.tsx';
import { useEditor, type SlashState } from './editorState.ts';
import { slashCatalog, type SlashItem } from './slashItems.ts';
import { rectsForRange, caretRect } from './richTextDom.ts';
import { LinkToPageMenu, MentionMenu } from './inline/MentionMenus.tsx';
import { EmojiAutocomplete, EmojiPicker, pushRecentEmoji, searchEmoji } from './inline/EmojiMenu.tsx';
import { closeTrigger, consumeTriggerText, insertAtomForTrigger, insertTextForTrigger, setTriggerCloser, useTriggerUI } from './inline/trigger.ts';
import { useSession } from '../../lib/store/session.ts';
import { searchCustomEmojis, type CustomEmoji } from '../settings/customEmoji.ts';
import { insertEquationAt } from './inline/EquationEditor.tsx';
import { valueOf } from './inline/format.ts';
import { getBlock } from '../../lib/blocks.ts';
import { getPref, PREF, setPref } from './prefs.ts';

const useQuery = create<{ q: string; full: boolean }>(() => ({ q: '', full: false }));

function leafFor(blockId: string, property: string): HTMLElement | null {
  return document.querySelector(`[data-content-editable-leaf][data-block-id="${blockId}"][data-property="${property}"]`);
}

/** Rect of the trigger's first character (the menu's anchor), falling back to the caret. */
function triggerRect(leaf: HTMLElement, start: number): DOMRect {
  const rects = rectsForRange(leaf, start, start + 1).filter((r) => r.height > 0);
  if (rects.length) return rects[0];
  return caretRect(leaf);
}

/** Placement per trigger on the trigger glyph's 19px box: slash and mention menus open 12px below it, moving above when needed; the emoji row opens 4px above and 4.4px to the right. */
const TRIGGER_PLACEMENT: Record<SlashState['trigger'], { dx: number; placement: Placement; offset: number }> = {
  '/': { dx: -6.4, placement: 'bottom-start', offset: 12 },
  '@': { dx: -7.6, placement: 'bottom-start', offset: 12 },
  '[[': { dx: -7.6, placement: 'bottom-start', offset: 12 },
  '+': { dx: -7.6, placement: 'bottom-start', offset: 12 },
  ':': { dx: 4.4, placement: 'top-start', offset: 4 },
};

export function openSlashMenu(blockId: string, property: string, start: number, trigger: SlashState['trigger'], opts?: { full?: boolean }) {
  closeSlashMenu();
  const leaf = leafFor(blockId, property);
  if (!leaf) return;
  const rect = triggerRect(leaf, start);
  const p = TRIGGER_PLACEMENT[trigger] ?? TRIGGER_PLACEMENT['/'];
  useEditor.setState({ slash: { blockId, property, start, trigger, query: '' } });
  useQuery.setState({ q: '', full: !!opts?.full });
  useTriggerUI.setState({ ghost: trigger === '/' ? 'Search by typing' : '' });
 // inline menus lock the page scroller while keeping the gutter visible
  document.body.classList.add('nc-scroll-locked');
  const close = openOverlay(() => <TriggerMenu />, {
 // Anchor to the glyph’s fractional position with a whole-pixel height
    anchor: new DOMRect(rect.left + p.dx, rect.top, 0, Math.round(rect.height)),
    placement: p.placement,
    offset: p.offset,
    backdrop: 'transparent',
    noFocus: true,
    onClose: () => {
      setTriggerCloser(null);
      document.body.classList.remove('nc-scroll-locked');
      useEditor.setState({ slash: null });
      useTriggerUI.setState({ ghost: '' });
    },
  });
  setTriggerCloser(close);
}

export function updateSlashQuery(q: string) {
  const s = useEditor.getState().slash;
  if (!s) return;
 // Close the menu when the query ends with a double space or runs long
  if (/\s\s$/.test(q) || q.length > 40) {
    closeSlashMenu();
    return;
  }
  if (s.trigger === ':' && (/\s/.test(q) || (q.length >= 2 && !searchEmoji(q, 1).length && !searchCustomEmojis(q).length))) {
    closeSlashMenu();
    return;
  }
  useEditor.setState({ slash: { ...s, query: q } });
  useQuery.setState({ q });
  if (s.trigger === '/') useTriggerUI.setState({ ghost: q ? '' : 'Search by typing' });
}

export function closeSlashMenu() {
  closeTrigger();
}

/** Match quality of an item for the typed query (0 = no match). Search uses fuzzy keywords, the label, and the shortcut hint, with label matches ranked over keyword matches over fuzzy (in-order letters * a word start, e.g. "turnbullet" → "turn into bulleted list") ones. */
export function slashScore(item: Pick<SlashItem, 'label' | 'keywords' | 'hint' | 'section'>, query: string): number {
  const ql = query.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!ql) return 0;
  const l = item.label.toLowerCase();
  const qc = ql.replace(/[^\p{L}\p{N}#>"\[\]`$-]+/gu, '');
  const lc = l.replace(/[^\p{L}\p{N}]+/gu, '');
  if (l === ql) return 100;
  if (l.startsWith(ql)) return 80;
  if (qc && lc === qc) return 78;
  if (qc.length >= 2 && lc.startsWith(qc)) return 70;
  if (l.split(/[\s-]+/).some((w) => w.startsWith(ql))) return 60;
  if (item.hint && (item.hint === ql || item.hint.replace(/\s+/g, '') === qc)) return 55;
  if (l.includes(ql)) return 40;
  const kws = (item.keywords ?? []).map((k) => k.toLowerCase());
  if (kws.some((k) => k === ql)) return 38;
  if (kws.some((k) => k.startsWith(ql))) return 35;
  if (qc.length >= 3 && kws.some((k) => k.replace(/[^\p{L}\p{N}]+/gu, '').startsWith(qc))) return 32;
  if (ql.length >= 3 && kws.some((k) => k.includes(ql))) return 20;
  if (ql.length >= 3 && item.section.toLowerCase().startsWith(ql)) return 15;
 // fuzzy: every query letter in order, starting at a word start, within label + keywords
  if (qc.length >= 4) {
    for (const name of [l, ...kws]) if (fuzzyFromWordStart(name, qc)) return 10;
  }
  return 0;
}

function fuzzyFromWordStart(name: string, q: string): boolean {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const compact = words.join('');
  let pos = 0;
  const starts: number[] = [];
  for (const w of words) { starts.push(pos); pos += w.length; }
  for (const s0 of starts) {
    if (compact[s0] !== q[0]) continue;
    let i = s0;
    let j = 0;
    while (i < compact.length && j < q.length) {
      if (compact[i] === q[j]) j++;
      i++;
    }
    if (j === q.length) return true;
  }
  return false;
}

function TriggerMenu() {
  const slash = useEditor((s) => s.slash);
  const q = useQuery((s) => s.q);
  const full = useQuery((s) => s.full);
  if (!slash) return null;
  if (slash.trigger === '/') return <SlashCommandMenu q={q} />;
  if (slash.trigger === '@') return <MentionMenu q={q} />;
  if (slash.trigger === ':') return <EmojiTriggerMenu q={q} full={full} />;
  return <LinkToPageMenu q={q} plus={slash.trigger === '+'} />;
}

function EmojiTriggerMenu({ q, full }: { q: string; full: boolean }) {
  const pick = (u: string, custom?: CustomEmoji) => {
    if (custom) {
 // workspace custom emoji becomes a ["ce", emojiId, spaceId] atom
      insertAtomForTrigger([[MENTION_CHAR, [['ce', custom.id, useSession.getState().spaceId ?? '']]]], { trailingSpace: false, action: 'EmojiMenu.handleSubmit' });
      return;
    }
    pushRecentEmoji(u);
    insertTextForTrigger(u);
  };
 // "+": the trigger text stays; once the emoji is added it replaces ":query" like a pick
  const add = (anchor: HTMLElement) => {
    const s = useEditor.getState().slash;
    closeSlashMenu();
    void import('./inline/CustomEmojiUpload.tsx').then(({ openCustomEmojiUpload }) => openCustomEmojiUpload(anchor, {
      onAdded: (e) => {
        if (!s) return;
        const value = valueOf(s.blockId, s.property);
        const typed = `:${s.query}`;
        if (toPlainText(value).slice(s.start, s.start + typed.length) !== typed) return;
        const next = insertRich(deleteRange(value, s.start, s.start + typed.length), s.start, [[MENTION_CHAR, [['ce', e.id, useSession.getState().spaceId ?? '']]]]);
        void import('../../lib/blocks.ts').then(({ run, setTitle, setProperty }) => {
          run('EmojiMenu.handleSubmit', (tx) => (s.property === 'title' ? setTitle(tx, s.blockId, next) : setProperty(tx, s.blockId, s.property, next)));
          useEditor.getState().requestFocus(s.blockId, s.start + 1, { property: s.property });
        });
      },
    }));
  };
  if (full && !q) return <EmojiPicker onPick={pick} onClose={() => closeSlashMenu()} />;
  return <EmojiAutocomplete query={q} onPick={pick} onClose={() => closeSlashMenu()} onAdd={add} />;
}

/** “Suggested”: slash actions used on this device, most used first and most recent among equals
 * frequently used actions); a fresh device starts with defaults such as AI meeting notes,
 * HTML · Embeds New). */
type SlashUse = number | { n: number; t: number };
function suggestedIds(catalog: SlashItem[]): string[] | null {
  const freq = getPref<Record<string, SlashUse>>(PREF.slashFrequent) ?? {};
  const norm = (v: SlashUse) => (typeof v === 'number' ? { n: v, t: 0 } : v);
  const ids = Object.entries(freq)
    .map(([id, v]) => [id, norm(v)] as const)
    .filter(([id, v]) => v.n >= 1 && catalog.some((c) => c.id === id && c.section !== 'Suggested' && !c.searchOnly))
    .sort((a, b) => b[1].n - a[1].n || b[1].t - a[1].t)
    .map(([id]) => id)
    .slice(0, 5);
  return ids.length ? ids : null;
}

function recordSlashUse(id: string) {
  const freq = getPref<Record<string, SlashUse>>(PREF.slashFrequent) ?? {};
  const cur = freq[id];
  const n = typeof cur === 'number' ? cur : cur?.n ?? 0;
  setPref(PREF.slashFrequent, { ...freq, [id]: { n: n + 1, t: Date.now() } });
}

function SlashCommandMenu({ q }: { q: string }) {
  const catalog = useMemo(() => slashCatalog(), []);
  const def = useMemo<MenuDef>(() => {
    const cur = getBlock(useEditor.getState().slash?.blockId);
    const toItem = (it: SlashItem, filtered = false): MenuItemDef => {
      const turnIntoItem = it.section === 'Turn into';
 // “Label · hint New” is inline with tertiary hint and dot; filtered Turn into rows read “Label · Turn into”
      const hint = filtered && turnIntoItem ? 'Turn into' : it.section === 'Suggested' ? it.hint : undefined;
      return {
        id: it.id,
        label: (
          <span className="nc-slash-label">
            <span className="t">{it.label}</span>
            {hint && <><span className="d">·</span><span className="d">{hint}</span></>}
            {it.badge && <span className="nc-slash-badge">{it.badge}</span>}
          </span>
        ),
        text: it.label, icon: it.icon, keywords: it.keywords,
        checked: !filtered && turnIntoItem && !!cur && it.turnType === cur.type && !!it.turnToggleable === !!cur.format?.toggleable,
        right: (it.shortcut ?? it.hint) && it.section !== 'Suggested' && !turnIntoItem ? <span className="nc-menu-shortcut nc-slash-hint">{it.shortcut ?? it.hint}</span> : undefined,
        onSelect: () => {
          const s = useEditor.getState().slash;
          const anchorEl = s ? leafFor(s.blockId, s.property) : null;
          const res = consumeTriggerText('SlashMenu.handleAccept');
          closeSlashMenu();
          recordSlashUse(it.id);
          if (res) it.apply({ blockId: res.blockId, empty: res.empty, anchor: anchorEl?.getBoundingClientRect() ?? new DOMRect(), offset: res.start, property: res.property });
        },
      };
    };
 // Render the first 25 options, then add the rest as the list nears its end
    const base = { width: 324, maxHeight: 'min(448px, 40vh)', className: 'nc-slash-menu', footer: <MenuFooter />, renderLimit: 25 };
    if (!q) {
      const sections: string[] = [];
      for (const it of catalog) if (!sections.includes(it.section) && !it.searchOnly) sections.push(it.section);
      const frequent = suggestedIds(catalog);
      return {
        ...base,
        sections: sections.map((s) => ({
          title: s,
          items: s === 'Suggested' && frequent
            ? frequent.map((id) => catalog.find((c) => c.id === id)!).map((it) => toItem({ ...it, section: 'Suggested', hint: undefined }))
            : catalog.filter((i) => i.section === s && !i.searchOnly).map((it) => toItem(it)),
        })),
      };
    }
 // For a query such as “/hea”, insert matching items first, then the “Turn into” variants, each ordered by match
 // quality then catalog order; the best match's own Turn into variant is pulled up right below it.
    const order = new Map(catalog.map((it, i) => [it, i]));
    const ranked = catalog
      .filter((it) => it.section !== 'Suggested')
      .map((it) => ({ it, s: slashScore(it, q), turn: it.section === 'Turn into' }))
      .filter((x) => x.s > 0)
      .sort((a, b) => Number(a.turn) - Number(b.turn) || b.s - a.s || order.get(a.it)! - order.get(b.it)!);
    const seen = new Set<string>();
    const list = ranked.filter((x) => (seen.has(x.it.label + x.it.section) ? false : (seen.add(x.it.label + x.it.section), true)));
    const top = list[0];
    if (top && !top.turn) {
      const twin = list.findIndex((x) => x.turn && x.it.label === top.it.label);
      if (twin > 1) list.splice(1, 0, ...list.splice(twin, 1));
    }
    const items = list.map((x) => toItem(x.it, true));
 // filtered rows are a plain 32px-pitch list (no 1px row gap;)
    return { ...base, className: 'nc-slash-menu filtered', sections: items.length ? [{ title: 'Filtered results', items }] : [], emptyText: 'No results' };
  }, [catalog, q]);
  useEffect(() => {
 // Close the menu after several characters with no results
    if (q.length > 3 && def.sections.length === 0) {
      const t = setTimeout(() => closeSlashMenu(), 800);
      return () => clearTimeout(t);
    }
  }, [q, def.sections.length]);
  return <Menu def={def} close={() => closeSlashMenu()} externalQuery="" keyTarget="window" />;
}

/** Footer: 2px rule holder with a 1px --lp-border-primary line, then a padded
 * section with a 32px "Close menu" row and the "esc" hint. */
function MenuFooter() {
  return (
    <footer className="nc-slash-footer">
      <div className="nc-slash-footer-rule"><div role="separator" /></div>
      <div className="nc-slash-footer-section">
        <div className="nc-slash-footer-row" role="button" onMouseDown={(e) => { e.preventDefault(); closeSlashMenu(); }}>
          <span>Close menu</span>
          <span className="nc-menu-shortcut">esc</span>
        </div>
      </div>
    </footer>
  );
}

/** Slash items that hand off to inline triggers ("Mention a person", "Date or reminder", "Emoji" …). */
window.addEventListener('nc:inline-trigger', ((e: CustomEvent) => {
  const { blockId, trigger, query, offset, property = 'title', full } = e.detail as { blockId: string; trigger: SlashState['trigger']; query?: string; offset?: number; property?: string; full?: boolean };
  const value = valueOf(blockId, property);
  const pos = offset ?? length(value);
  const ins = trigger + (query ?? '');
  void import('../../lib/blocks.ts').then(({ run, setTitle, setProperty }) => {
    void import('@nc/shared/richtext.ts').then(({ insertText }) => {
      const next = insertText(value, pos, ins, []);
      run('inlineTrigger', (tx) => (property === 'title' ? setTitle(tx, blockId, next) : setProperty(tx, blockId, property, next)));
      useEditor.getState().requestFocus(blockId, pos + ins.length, { property });
      setTimeout(() => {
        openSlashMenu(blockId, property, pos, trigger, { full });
        if (query) updateSlashQuery(query);
      }, 30);
    });
  });
}) as EventListener);

/** Slash "Inline equation": insert an empty equation at the slash position and open its editor. */
window.addEventListener('nc:inline-equation', ((e: CustomEvent) => {
  const { blockId, offset, property = 'title' } = e.detail as { blockId: string; offset?: number; property?: string };
  insertEquationAt(blockId, property, offset ?? length(valueOf(blockId, property)));
}) as EventListener);

export function isSlashOpen() {
  return !!useEditor.getState().slash && useOverlays.getState().stack.length > 0;
}

export { toPlainText, Icon };

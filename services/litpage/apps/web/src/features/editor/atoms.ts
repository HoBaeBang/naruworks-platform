// Renders inline atoms (page/user/date mentions, link mentions, inline equations) inside rich text leaves,
// Inline atoms use compact spans and SVG glyphs:
// user/date: span.lit-text-mention-token.lit-focusable-token (color --lp-text-secondary, "@" at 60% currentColor)
// page: a.lit-page-mention-token.lit-text-mention-token > icon (1.25em, margin-inline-end.5em) + title
// (underline.05em, offset 10%, weight 500); "[[" links (["p", id, spaceId]) get a link-arrow badge
// equation: span.lit-text-equation-token (user-select:all) >.katex at 1.21em; empty → "√x New equation" pill
// Glyphs are simple hand-drawn SVGs.
import katex from 'katex';
import 'katex/contrib/mhchem'; // \ce{…} / \pu{…} chemistry support
import 'katex/dist/katex.min.css';
import type { Annotation, DateValue, LinkMentionValue } from '@nc/shared/richtext.ts';
import type { BlockRecord, UserRecord } from '@nc/shared/records.ts';
import { records } from '../../lib/store/records.ts';
import { getLocation, pageUrl } from '../../lib/router.ts';
import { PAGE_LIKE } from '@nc/shared/blocks.ts';
import { setAtomRenderer } from './richTextDom.ts';
import { formatDateValue, reminderTime } from './inline/dates.ts';
import { getCustomEmojis } from '../settings/customEmoji.ts';
import { TEMPLATE_ME } from '@nc/shared/automation/templateVars.ts';

export function formatDateMention(v: DateValue): string {
  return formatDateValue(v);
}

const SVG = 'http://www.w3.org/2000/svg';
function svg(viewBox: string, paths: string[], fill = 'none', stroke = 'currentColor'): SVGSVGElement {
  const el = document.createElementNS(SVG, 'svg');
  el.setAttribute('viewBox', viewBox);
  el.setAttribute('aria-hidden', 'true');
  el.setAttribute('style', 'width:1em;height:1em;display:block;flex-shrink:0;');
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', fill);
    p.setAttribute('stroke', stroke);
    p.setAttribute('stroke-width', '1.3');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    el.appendChild(p);
  }
  return el;
}

/** Plain document outline (page without icon). */
function pageGlyph(): SVGSVGElement {
  return svg('0 0 20 20', ['M5.5 2.75h6.25L15.25 6.25v10.25a.75.75 0 0 1-.75.75h-9a.75.75 0 0 1-.75-.75V3.5a.75.75 0 0 1 .75-.75Z', 'M11.5 2.9v3.6h3.6']);
}
function linkBadge(): SVGSVGElement {
  const el = svg('0 0 10 10', ['M3 7 7.2 2.8', 'M3.6 2.6h3.8v3.8']);
  el.setAttribute('style', 'position:absolute;right:-0.15em;bottom:-0.1em;width:0.62em;height:0.62em;background:var(--lp-bg-primary);border-radius:2px;');
  return el;
}
function alarmGlyph(): SVGSVGElement {
  const el = svg('0 0 20 20', ['M10 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'M10 8v3.2l2 1.3', 'M4 4.5 6 3', 'M16 4.5 14 3']);
  el.setAttribute('style', 'width:0.9em;height:0.9em;display:inline-block;vertical-align:-0.1em;margin-inline-start:0.25em;');
  return el;
}
function sqrtGlyph(): SVGSVGElement {
  const el = svg('0 0 20 20', ['M2.5 11.5h2.5l3 5 4-13h5.5', 'M11.5 9l4 4.5', 'M15.5 9l-4 4.5']);
  el.setAttribute('style', 'width:1em;height:1em;display:inline-block;vertical-align:-0.15em;margin-inline-end:0.3em;');
  return el;
}

function at(): HTMLSpanElement {
  const s = document.createElement('span');
  s.style.color = 'color-mix(in srgb, currentcolor 60%, transparent 40%)';
  s.textContent = '@';
  return s;
}

function mentionShell(extraClass = ''): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = `lit-text-mention-token lit-focusable-token lit-enable-hover ${extraClass}`.trim();
  el.setAttribute('style', 'text-decoration:none;color:var(--lp-text-secondary);');
  return el;
}

function iconSpan(icon: string | undefined, link: boolean): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'lit-page-mention-token__icon';
  if (icon && !icon.startsWith('lit-icon')) {
    if (/^(https?:|\/files\/|data:)/.test(icon)) {
      const img = document.createElement('img');
      img.src = icon;
      img.alt = '';
      img.setAttribute('style', 'width:1.1em;height:1.1em;border-radius:3px;object-fit:cover;display:block;');
      wrap.appendChild(img);
    } else {
      const e = document.createElement('span');
      e.className = 'lit-emoji';
      e.textContent = icon;
      wrap.appendChild(e);
    }
  } else {
    const g = pageGlyph();
    g.style.color = 'rgba(129, 140, 248, 1)';
    wrap.appendChild(g);
  }
  if (link) wrap.appendChild(linkBadge());
  return wrap;
}

/** Plain text of a block for a block mention (atoms dropped, one line, at most 100 characters). */
function blockMentionText(b: BlockRecord): string {
  const t = (b.properties?.title ?? []).map((d: any) => (d[0] === '‣' || d[0] === '⁍' ? '' : d[0])).join('').replace(/\s+/g, ' ').trim();
  return t.length > 100 ? `${t.slice(0, 100)}…` : t;
}

/** Mention of a block that is not a page, created from a pasted block link: the containing page’s icon, the block’s text, and a link that scrolls to the block. */
function renderBlockMention(b: BlockRecord): HTMLElement {
  let page: BlockRecord | undefined = b;
  for (let i = 0; i < 60 && page && !PAGE_LIKE.has(page.type) && page.parent_table === 'block'; i++) page = records.get<BlockRecord>('block', page.parent_id);
  const a = document.createElement('a');
  a.className = 'lit-page-mention-token lit-text-mention-token lit-focusable-token lit-enable-hover lit-block-mention-token';
  const pageId = page?.id ?? b.id;
  a.href = pageUrl(pageId, { blockId: b.id });
  a.dataset.pageId = pageId;
  a.dataset.scrollTo = b.id;
  a.appendChild(iconSpan(page?.format?.page_icon as string | undefined, false));
  const t = document.createElement('span');
  t.className = 'lit-page-mention-token__title';
  const text = blockMentionText(b) || 'Untitled';
  const loc = getLocation();
  const here = (loc.route.name === 'page' && loc.route.pageId === pageId) || loc.peek?.pageId === pageId;
  const pageTitle = (page?.properties?.title ?? []).map((d: any) => (d[0] === '‣' ? '' : d[0])).join('') || 'New page';
  t.textContent = here ? text : `${pageTitle} - ${text}`;
  a.appendChild(t);
  return a;
}

function renderPage(pageId: string, link: boolean): HTMLElement {
  const b = records.get<BlockRecord>('block', pageId);
  if (b && !link && !PAGE_LIKE.has(b.type) && b.parent_table === 'block') return renderBlockMention(b);
  const a = document.createElement('a');
  a.className = `lit-page-mention-token lit-text-mention-token lit-focusable-token lit-enable-hover${link ? ' lit-page-link-token' : ''}`;
  a.href = pageUrl(pageId);
  a.dataset.pageId = pageId;
  a.appendChild(iconSpan(b?.format?.page_icon as string | undefined, link));
  const t = document.createElement('span');
  t.className = 'lit-page-mention-token__title';
  const title = (b?.properties?.title ?? []).map((d: any) => (d[0] === '‣' ? '' : d[0])).join('');
  t.textContent = b ? title || 'New page' : 'No access';
  a.appendChild(t);
  if (b && b.alive === false) {
    const badge = document.createElement('span');
    badge.className = 'lit-page-mention-token__trash';
    badge.textContent = 'In Trash';
    a.appendChild(badge);
  }
  return a;
}

/** Workspace permission groups (Settings › People › Groups): space.settings.groups. */
export interface MentionGroup {
  id: string;
  name: string;
  member_ids: string[];
}

export function groupOf(groupId: string, spaceId?: string): MentionGroup | undefined {
  const spaces = spaceId ? [records.get<any>('space', spaceId)] : records.all<any>('space');
  for (const sp of spaces) {
    const g = ((sp?.settings?.groups ?? []) as MentionGroup[]).find((x) => x.id === groupId);
    if (g) return g;
  }
  return undefined;
}

/** Group mention: "@Group name" like a person mention; hover lists its members. */
function renderGroup(groupId: string, spaceId?: string): HTMLElement {
  const g = groupOf(groupId, spaceId);
  const el = mentionShell('lit-group-mention-token');
  const inner = document.createElement('span');
  inner.append(at(), document.createTextNode(g?.name || 'Deleted group'));
  el.append(document.createElement('span'), inner, document.createElement('span'));
  el.dataset.groupId = groupId;
  if (spaceId) el.dataset.spaceId = spaceId;
  return el;
}

function renderUser(userId: string): HTMLElement {
  const u = records.get<UserRecord>('lit_user', userId);
  const el = mentionShell('lit-user-mention-token');
  const inner = document.createElement('span');
  // template variable "@Me — Person who duplicated page" (database templates, button content)
  inner.append(at(), document.createTextNode(userId === TEMPLATE_ME ? 'Me' : u?.name || u?.email || 'Unknown user'));
  el.append(document.createElement('span'), inner, document.createElement('span'));
  el.dataset.userId = userId;
  return el;
}

function renderDate(v: DateValue): HTMLElement {
  const el = mentionShell('lit-date-mention-token');
  const inner = document.createElement('span');
  const label = document.createElement('span');
  label.className = 'lit-reminder';
  // template variables "@Today" / "@Now" stay variables until the template is used / the button clicked
  const tv = (v as { template_variable?: string }).template_variable;
  label.textContent = tv === 'today' ? 'Today' : tv === 'now' ? 'Now' : formatDateValue(v);
  inner.append(at(), label);
  const due = reminderTime(v);
  if (due !== null) {
    // reminders: blue, red once the reminder time has passed (help: "reminders")
    el.classList.add('lit-reminder-token');
    el.style.color = due <= Date.now() ? 'var(--lp-red-text-accent, #e03e3e)' : 'var(--lp-blue-text-accent, #818cf8)';
    inner.appendChild(alarmGlyph());
  }
  el.append(document.createElement('span'), inner, document.createElement('span'));
  return el;
}

function renderLinkMention(v: LinkMentionValue): HTMLElement {
  const el = document.createElement('span');
  el.className = 'lit-link-mention-token lit-text-mention-token lit-focusable-token lit-enable-hover';
  el.dataset.href = v.href;
  const icon = document.createElement('span');
  icon.className = 'lit-page-mention-token__icon';
  const img = document.createElement('img');
  let host = v.href;
  try {
    host = new URL(v.href).hostname;
  } catch {
    /* keep raw */
  }
  img.src = v.icon_url ?? `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
  img.alt = '';
  img.setAttribute('style', 'width:1em;height:1em;border-radius:2px;display:block;');
  icon.appendChild(img);
  const t = document.createElement('span');
  t.className = 'lit-page-mention-token__title';
  t.textContent = v.title || host;
  el.append(icon, t);
  return el;
}

function renderEquation(tex: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'lit-text-equation-token';
  if (!tex.trim()) {
    el.classList.add('empty');
    el.appendChild(sqrtGlyph());
    el.appendChild(document.createTextNode('New equation'));
    return el;
  }
  try {
    katex.render(tex, el, { throwOnError: false, displayMode: false });
  } catch {
    el.textContent = tex;
  }
  return el;
}

/** Workspace custom emoji (["ce", emojiId, spaceId]): an inline image sized like an emoji glyph. */
function renderCustomEmoji(id: string, spaceId?: string): HTMLElement {
  const el = document.createElement('span');
  el.className = 'lit-custom-emoji-token';
  const e = getCustomEmojis(spaceId).find((x) => x.id === id) ?? getCustomEmojis().find((x) => x.id === id);
  if (!e) {
    el.classList.add('missing');
    el.textContent = ':deleted-emoji:';
    el.title = 'This custom emoji was deleted';
    return el;
  }
  const img = document.createElement('img');
  img.src = e.url;
  img.alt = `:${e.name}:`;
  img.draggable = false;
  el.title = `:${e.name}:`;
  el.dataset.emojiName = e.name;
  el.appendChild(img);
  return el;
}

const TEMPLATE_VARIABLE_LABEL: Record<string, string> = { me: 'Me', now: 'Now', today: 'Today' };

/** Template variable (["tv", "me" | "now" | "today"]) — "@Today" chip until the template is used. */
function renderTemplateVariable(v: string): HTMLElement {
  const el = mentionShell('lit-template-variable-token');
  const inner = document.createElement('span');
  inner.append(at(), document.createTextNode(TEMPLATE_VARIABLE_LABEL[v] ?? v));
  el.append(document.createElement('span'), inner, document.createElement('span'));
  el.dataset.templateVariable = v;
  return el;
}

function render(ann: Annotation): HTMLElement {
  switch (ann[0]) {
    case 'ce':
      return renderCustomEmoji(String(ann[1]), ann[2] as string | undefined);
    case 'tv':
      return renderTemplateVariable(String(ann[1]));
    case 'p':
      return renderPage(ann[1] as string, ann.length > 2);
    case 'u':
      return renderUser(ann[1] as string);
    case 'g':
      return renderGroup(ann[1] as string, ann[2] as string | undefined);
    case 'd':
      return renderDate(ann[1] as DateValue);
    case 'e':
      return renderEquation(String(ann[1] ?? ''));
    case 'lm':
      return renderLinkMention(ann[1] as LinkMentionValue);
    default: {
      const el = document.createElement('span');
      el.textContent = '‣';
      return el;
    }
  }
}

setAtomRenderer((ann) => render(ann));

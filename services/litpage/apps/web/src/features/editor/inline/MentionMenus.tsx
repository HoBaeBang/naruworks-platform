// “@” mention menu and “[[]” / “+” link-to-page menus:
// /080; DOM ed-mention-menu-overlay.html / ed-brackets-overlay.html): 330px, max-height 40vh.
// @ (empty): Date (Today · Remind me — Tomorrow 9am) / People / Page link (+ "N more results") / New page
// @ (query): Date (parsed) / People / Groups / Page link + "Share search feedback" / New page: New “q” sub-page · …
// Groups: the workspace’s
// permission groups; picking one inserts ["g", groupId, spaceId] and notifies its members who can see the page.
// [[: Page link / Add a child page · Add a page in… (inserts ["p", id, spaceId])
// +: same as [[ with the New page options first
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { BlockRecord, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { dateMention, type DateValue, type RichText } from '@nc/shared/richtext.ts';
import { newId } from '@nc/shared/ids.ts';
import { Menu, type MenuDef, type MenuItemDef, type MenuSectionDef } from '../../../components/Menu.tsx';
import { Icon } from '../../../components/Icon.tsx';
import { api } from '../../../lib/api.ts';
import { createBlockIn, getBlock, run } from '../../../lib/blocks.ts';
import { records } from '../../../lib/store/records.ts';
import { transactions } from '../../../lib/store/transactions.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { useEditor } from '../editorState.ts';
import { addDays, formatDateValue, isoDate, parseNaturalDate, timeCaption, parseIso } from './dates.ts';
import { breadcrumbOf, pageOrNull, usePageSearch } from './pageSearch.ts';
import { closeTrigger, insertAtomForTrigger, useTriggerUI } from './trigger.ts';
import { openPagePicker } from './PagePicker.tsx';

export function Avatar({ user, size = 20 }: { user: UserRecord; size?: number }) {
  if (user.profile_photo) {
    return <img className="nc-mention-avatar" src={user.profile_photo} alt="" style={{ width: size, height: size }} />;
  }
  return (
    <div className="nc-mention-avatar initial" style={{ width: size, height: size, lineHeight: `${size}px` }}>
      {(user.name || user.email || '?').slice(0, 1).toUpperCase()}
    </div>
  );
}

function spaceMembers(spaceId: string | null | undefined): UserRecord[] {
  const space = records.get<SpaceRecord>('space', spaceId);
  const ids = new Set<string>();
  for (const p of space?.permissions ?? []) if (p.user_id) ids.add(p.user_id);
  const me = useSession.getState().userId;
  if (me) ids.add(me);
  return [...ids].map((id) => records.get<UserRecord>('lit_user', id)).filter((u): u is UserRecord => !!u);
}

function pageItem(id: string, onSelect: () => void): MenuItemDef {
  const b = pageOrNull(id) as BlockRecord | undefined;
  const crumb = breadcrumbOf(id);
  return { id, label: pageTitle(b) || 'New page', text: pageTitle(b), icon: <PageIcon block={b} size={20} />, description: crumb || undefined, onSelect };
}

/** Text block containing the trigger: new sub-pages "@"/"[[" are parented to it (not listed in content). */
function createSubpage(title: string): string {
  const s = useEditor.getState().slash;
  const host = s ? getBlock(s.blockId) : undefined;
  const id = newId();
  if (!host) return id;
  run('mentionMenuActions.acceptCreateIn', (tx) => {
    createBlockIn(tx, { id, type: 'page', parentId: host.id, parentTable: 'block', title: title ? [[title]] : [], list: null });
  });
  return id;
}

function createPageIn(parentId: string, title: string): string {
  const id = newId();
  const parent = getBlock(parentId);
  run('mentionMenuActions.acceptCreateIn', (tx) => {
    createBlockIn(tx, { id, type: 'page', parentId, parentTable: 'block', after: parent?.content?.[parent.content.length - 1], title: title ? [[title]] : [] });
  });
  return id;
}

function insertPage(id: string, link: boolean) {
  const spaceId = useSession.getState().spaceId ?? '';
  const atom: RichText = [['‣', [link ? ['p', id, spaceId] : ['p', id]]]];
  insertAtomForTrigger(atom, { action: link ? 'MentionMenu.getPageResultsMenuSection' : 'MentionMenu.menuItem' });
}

function addPageIn(q: string, link: boolean) {
  const s = useEditor.getState().slash;
  if (!s) return false;
  const leaf = document.querySelector<HTMLElement>(`[data-content-editable-leaf][data-block-id="${s.blockId}"][data-property="${s.property}"]`);
  const snapshot = { ...s };
  openPagePicker(leaf?.getBoundingClientRect() ?? new DOMRect(200, 200, 0, 0), {
    placeholder: 'Add page in…',
    onPick: (parentId) => {
      useEditor.setState({ slash: snapshot });
      const id = createPageIn(parentId, q);
      insertPage(id, link);
    },
  });
  closeTrigger();
  // keep the snapshot so insertion happens at the right place after picking
  return true;
}

function newPageSection(q: string, link: boolean): MenuSectionDef {
  return {
    title: 'New page',
    items: [
      {
        id: 'new-subpage',
        label: q ? <span>New “{q}” sub-page</span> : 'Add a child page',
        text: 'add child page',
        icon: 'plus',
        onSelect: () => insertPage(createSubpage(q), link),
      },
      {
        id: 'new-page-in',
        label: q ? <span>New “{q}” page in…</span> : 'Add a page in…',
        text: 'add a page in',
        icon: 'arrowDiagonalUpRight',
        onSelect: () => { addPageIn(q, link); return false; },
      },
    ],
  };
}

function useGhost(first: MenuItemDef | undefined, q: string) {
  const label = first ? (typeof first.label === 'string' ? first.label : first.text ?? '') : '';
  const ghost = label && label.toLowerCase().startsWith(q.toLowerCase()) ? label.slice(q.length) : '';
  useEffect(() => {
    useTriggerUI.setState({ ghost });
  }, [ghost]);
}

function SearchFeedback() {
  return (
    <div className="nc-mention-feedback">
      <div role="button" className="nc-mention-feedback-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => useUI.getState().toast('Thanks for your feedback')}><Icon name="thumbsUp" size={16} /></div>
      <div role="button" className="nc-mention-feedback-btn" onMouseDown={(e) => e.preventDefault()} onClick={() => useUI.getState().toast('Thanks for your feedback')}><Icon name="thumbsDown" size={16} /></div>
      <span>Share search feedback</span>
    </div>
  );
}

/** "Remind me — Tomorrow 9am": the hint is a 12px secondary inline-flex run whose "—" (disabled color) keeps 0.5em on * both sides. */
function RemindLabel({ when }: { when: string }) {
  return (
    <span className="nc-mention-remind">
      Remind me
      <span className="nc-mention-hint"><span className="nc-mention-dash">—</span>{when}</span>
    </span>
  );
}

function dateItems(q: string): MenuItemDef[] {
  const insert = (v: DateValue) => insertAtomForTrigger(dateMention(v), { action: 'MentionMenu.menuItem' });
  if (!q.trim()) {
    const today = new Date();
    return [
      { id: 'today', label: 'Today', icon: 'clock', onSelect: () => insert({ type: 'date', start_date: isoDate(today), date_format: 'relative' }) },
      {
        id: 'remind',
        label: <RemindLabel when="Tomorrow 9am" />,
        text: 'Remind me',
        icon: 'alarm',
        onSelect: () => insert({ type: 'datetime', start_date: isoDate(addDays(today, 1)), start_time: '09:00', date_format: 'relative', reminder: { unit: 'minute', value: 0 } }),
      },
    ];
  }
  const p = parseNaturalDate(q);
  const out: MenuItemDef[] = [];
  if (p) {
    out.push({
      id: 'date',
      label: p.remind ? <RemindLabel when={p.label} /> : p.label,
      text: p.label,
      icon: p.remind ? 'alarm' : 'clock',
      right: <span className="nc-menu-shortcut">{timeCaption(parseIso(p.value.start_date))}</span>,
      onSelect: () => insert(p.value),
    });
  } else if ('remind me'.startsWith(q.trim().toLowerCase())) {
    out.push(...dateItems('').slice(1));
  } else if ('today'.startsWith(q.trim().toLowerCase())) {
    out.push(dateItems('')[0]);
  }
  return out;
}

/** Inbox "mentioned you in": the server checks the saved block text, so wait for the transaction. */
function notifyMentionAfterSave(blockId: string, userIds: string[], groupIds: string[] = []) {
  if (!blockId) return;
  const send = () => void api('notifyMentions', { blockId, userIds, ...(groupIds.length ? { groupIds } : {}) }).catch(() => {});
  if (transactions.pendingCount() === 0) return send();
  const off = transactions.onSaveState((st) => {
    if (st.pending > 0) return;
    off();
    if (!st.error) send();
  });
}

/** "@" items contributed by other features for the block being edited (database templates / button content: template * variables "Today — Date when duplicated", "Me — Person who duplicated page"): sections merged by title. */
export const mentionMenuExtensions: ((ctx: { blockId: string; q: string }) => MenuSectionDef[])[] = [];

export function MentionMenu({ q }: { q: string }) {
  const spaceId = useSession((s) => s.spaceId);
  const [expanded, setExpanded] = useState(false);
  const hits = usePageSearch(q, { limit: expanded ? 30 : 5 });
  const people = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return spaceMembers(spaceId).filter((u) => !ql || (u.name ?? '').toLowerCase().includes(ql) || (u.email ?? '').toLowerCase().startsWith(ql));
  }, [q, spaceId]);
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = ((records.get<SpaceRecord>('space', spaceId)?.settings as { groups?: { id: string; name: string; member_ids?: string[] }[] } | undefined)?.groups ?? []);
    return ql ? list.filter((g) => (g.name ?? '').toLowerCase().includes(ql)) : [];
  }, [q, spaceId]);
  const def: MenuDef = useMemo(() => {
    const sections: MenuSectionDef[] = [];
    const extra = mentionMenuExtensions.flatMap((fn) => fn({ blockId: useEditor.getState().slash?.blockId ?? '', q }));
    const extraFor = (title: string) => extra.filter((x) => x.title === title).flatMap((x) => x.items);
    const dates = [...extraFor('Date'), ...dateItems(q)];
    if (dates.length) sections.push({ title: 'Date', items: dates });
    if (people.length || extraFor('People').length) {
      sections.push({
        title: 'People',
        items: [...extraFor('People'), ...people.slice(0, q ? 6 : 4).map((u) => ({
          id: u.id,
          label: u.name || u.email,
          icon: <Avatar user={u} />,
          onSelect: () => {
            const blockId = useEditor.getState().slash?.blockId ?? '';
            insertAtomForTrigger([['‣', [['u', u.id]]]]);
            notifyMentionAfterSave(blockId, [u.id]);
          },
        }))],
      });
    }
    if (groups.length) {
      sections.push({
        title: 'Groups',
        items: groups.slice(0, 4).map((g) => ({
          id: `group:${g.id}`,
          label: g.name || 'Untitled',
          icon: <span className="nc-mention-group-icon"><Icon name="team" size={14} /></span>,
          right: <span className="nc-mention-group-caption">{(g.member_ids?.length ?? 0) === 1 ? '1 member' : `${g.member_ids?.length ?? 0} members`}</span>,
          onSelect: () => {
            const blockId = useEditor.getState().slash?.blockId ?? '';
            insertAtomForTrigger([['‣', [['g', g.id, spaceId ?? '']]]]);
            notifyMentionAfterSave(blockId, [], [g.id]);
          },
        })),
      });
    }
    if (extraFor('Agents').length) sections.push({ title: 'Agents', items: extraFor('Agents') });
    const pageItems = hits.ids.map((id) => pageItem(id, () => insertPage(id, false)));
    if (!expanded && hits.total > hits.ids.length) {
      pageItems.push({ id: 'more', label: `${hits.total - hits.ids.length} more results`, icon: 'ellipsisSmall', iconColor: 'var(--lp-icon-secondary)', onSelect: () => { setExpanded(true); return false; } });
    }
    if (pageItems.length) sections.push({ title: 'Page link', items: pageItems });
    sections.push(newPageSection(q.trim(), false));
    return { width: 330, maxHeight: '40vh', className: 'nc-mention-menu', sections, footer: q.trim() ? <SearchFeedback /> : undefined };
  }, [q, people, groups, hits.ids.join(','), hits.total, expanded]);
  useGhost(def.sections[0]?.items[0], q);
  return <Menu def={def} close={() => closeTrigger()} externalQuery="" keyTarget="window" />;
}

export function LinkToPageMenu({ q, plus }: { q: string; plus?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hits = usePageSearch(q, { limit: expanded ? 30 : 5 });
  const def: MenuDef = useMemo(() => {
    const items = hits.ids.map((id) => pageItem(id, () => insertPage(id, true)));
    if (!expanded && hits.total > hits.ids.length) {
      items.push({ id: 'more', label: `${hits.total - hits.ids.length} more results`, icon: 'ellipsisSmall', iconColor: 'var(--lp-icon-secondary)', onSelect: () => { setExpanded(true); return false; } });
    }
    const linkSection: MenuSectionDef = { title: 'Page link', items };
    const create = newPageSection(q.trim(), true);
    const createUntitled: MenuSectionDef = { items: create.items };
    const sections = plus ? [create, ...(items.length ? [linkSection] : [])] : [...(items.length ? [linkSection] : []), createUntitled];
    return { width: 330, maxHeight: '40vh', sections, footer: q.trim() && !plus ? <SearchFeedback /> : undefined };
  }, [q, plus, hits.ids.join(','), hits.total, expanded]);
  useGhost(def.sections[0]?.items[0], q);
  return <Menu def={def} close={() => closeTrigger()} externalQuery="" keyTarget="window" />;
}

export type { ReactNode };


// grouped comment / mention / reaction / update items, actionable access & teamspace requests (role ▾ · Approve or
// Change · Deny, "Approved by … on …"), reminders, Person-property assignments, invites, and inline replies.
// Hover bar: page notification settings / mark read / archive (applies to every notification of a group).
import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { BlockRecord, CommentRecord, DiscussionRecord, NotificationRecord, TeamRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { records } from '../../../lib/store/records.ts';
import { api } from '../../../lib/api.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { pageUrl } from '../../../lib/router.ts';
import { Icon } from '../../../components/Icon.tsx';
import { openMenu } from '../../../components/Menu.tsx';
import { openOverlay, PopoverSurface } from '../../../components/overlay.tsx';
import { PageIcon } from '../PageIcon.tsx';
import { TeamIcon } from '../sidebar/TeamIcon.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { addComment, CommentComposer, resolveDiscussion, RichTextView } from '../../comments/comments.tsx';
import { useRecord } from '../../../lib/hooks.ts';
import { PersonHover } from '../../presence/PersonHoverCard.tsx';
import { getLocale, t } from '../i18n.ts';
import { decideAccessRequest } from '../access/access.ts';
import { actorsOf, type FeedItem } from './grouping.ts';

const S1 = '\u0001';

/** ICU activity template with React parts: {author}/{pageTitle} slots; plain segments are the "<regular>" text. */
export function rich(id: string, def: string, parts: Record<string, ReactNode>, extra?: Record<string, string | number>): ReactNode[] {
  const keys = Object.keys(parts);
  const values: Record<string, string | number> = { ...(extra ?? {}) };
  keys.forEach((k, i) => { values[k] = `${S1}${i}${S1}`; });
  const msg = t(id, def, values);
  const out: ReactNode[] = [];
  msg.split(S1).forEach((seg, i) => {
    if (i % 2 === 1) out.push(<span key={`p${i}`}>{parts[keys[Number(seg)]]}</span>);
    else if (seg) out.push(<span key={`t${i}`} className="nc-inbox-regular">{seg}</span>);
  });
  return out;
}

export function itemDate(ts: number): string {
  const ko = getLocale() === 'ko-KR';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return ko ? '방금' : 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return ko ? `${m}분 전` : `${m}m ago`;
  const d = new Date(ts);
  if (d.toDateString() === new Date().toDateString()) return d.toLocaleTimeString(getLocale(), { hour: 'numeric', minute: '2-digit' });
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

function longDate(ts: number): string {
  return new Date(ts).toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Avatar({ user, size = 24 }: { user?: Partial<UserRecord>; size?: number }) {
  const name = user?.name || user?.email || '?';
  return (
    <div className="nc-inbox-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.5) }}>
      {user?.profile_photo ? <img src={user.profile_photo} alt="" /> : <span>{name.slice(0, 1).toUpperCase()}</span>}
    </div>
  );
}

export function PageMention({ pageId }: { pageId: string | null }) {
  const b = records.get<BlockRecord>('block', pageId);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeRef = useRef<(() => void) | null>(null);
  if (!b) return <span className="nc-inbox-mention">{t('lp.shell.untitled', 'Untitled')}</span>;
  return (
    <span
      ref={ref}
      className="nc-inbox-mention"
      onMouseEnter={() => {
        timer.current = setTimeout(() => {
          if (!ref.current) return;
          closeRef.current = openOverlay(() => <MentionPreview pageId={b.id} />, { anchor: ref.current, placement: 'bottom-start', backdrop: 'none', offset: 6 });
        }, 600);
      }}
      onMouseLeave={() => {
        if (timer.current) clearTimeout(timer.current);
        closeRef.current?.();
        closeRef.current = null;
      }}
    >
      <PageIcon block={b} size={16} className="nc-inbox-mention-icon" />
      <span className="notranslate nc-inbox-mention-title">{pageTitle(b) || t('lp.shell.untitled', 'Untitled')}</span>
    </span>
  );
}

function MentionPreview({ pageId }: { pageId: string }) {
  const b = records.get<BlockRecord>('block', pageId);
  return (
    <PopoverSurface width={260} className="nc-inbox-preview">
      <div className="nc-inbox-preview-body">
        <PageIcon block={b} size={36} />
        <div className="nc-inbox-preview-title">{pageTitle(b) || t('lp.shell.untitled', 'Untitled')}</div>
        <div className="nc-inbox-preview-sketch">
          <div className="bar" style={{ width: '70%' }} />
          <div className="bar" style={{ width: '90%' }} />
          <div className="bar" style={{ width: '55%' }} />
        </div>
      </div>
    </PopoverSurface>
  );
}

function TeamMention({ teamId }: { teamId?: string }) {
  const team = records.get<TeamRecord>('team', teamId);
  return (
    <span className="nc-inbox-mention">
      {team && <span className="nc-inbox-mention-icon nc-inbox-team-icon"><TeamIcon team={team} size={16} /></span>}
      <span className="notranslate nc-inbox-mention-title">{team?.name ?? t('lp.shell.untitled', 'Untitled')}</span>
    </span>
  );
}

const get = (id: string) => records.get<NotificationRecord>('notification', id);
const userOf = (id?: string | null) => records.get<UserRecord>('lit_user', id);
const nameOf = (u?: UserRecord) => u?.name || u?.email || t('lp.shell.someone', 'Someone');

function Actor({ userId }: { userId?: string | null }) {
  const u = userOf(userId);
  return <PersonHover userId={userId ?? null}><span className="nc-inbox-actor">{nameOf(u)}</span></PersonHover>;
}

type Act = Record<string, any>;

const ROLE_LABEL = (r: string) => ({
  editor: t('lp.shell.full_access', 'Full access'),
  read_and_write: t('lp.shell.can_edit', 'Can edit'),
  comment_only: t('lp.shell.can_comment', 'Can comment'),
  reader: t('lp.shell.can_view', 'Can view'),
}[r] ?? r);
const ROLE_RANK: Record<string, number> = { none: 0, reader: 1, comment_only: 2, content_only_editor: 2.5, read_and_write: 3, editor: 4 };

export interface RowHandlers {
  onOpen: (item: FeedItem, opts?: { discussionId?: string }) => void;
  onRead: (ids: string[], read: boolean) => void;
  onArchive: (ids: string[], archived: boolean) => void;
  onNotifySettings: (anchor: HTMLElement, pageId: string) => void;
}

export function FeedRow({ item, h }: { item: FeedItem; h: RowHandlers }) {
  const list = item.ids.map(get).filter(Boolean) as NotificationRecord[];
  const n = list[0];
  if (!n) return null;
  const unread = list.some((x) => !x.read);
  const archived = list.every((x) => x.archived);
  const showSettings = !!item.pageId && n.type !== 'access_requested' && n.type !== 'team_join_requested';
  const { headline, body, avatar, actions } = renderItem(item, list);
  return (
    <article className={`nc-inbox-row ${unread ? 'unread' : 'read'}`} data-notification-id={n.id} data-notification-type={n.type} data-count={item.ids.length}>
      <div className="nc-inbox-item-actions-wrap">
        <div className="nc-inbox-item-actions">
          {showSettings && (
            <div role="button" aria-label={t('lp.shell.adjust_how_this_page_notifies_you', 'Adjust how this page notifies you')} data-tooltip={t('lp.shell.adjust_how_this_page_notifies_you', 'Adjust how this page notifies you')} className="nc-inbox-act" onClick={(e) => h.onNotifySettings(e.currentTarget as HTMLElement, item.pageId!)}>
              <Icon name="bell" size={20} />
            </div>
          )}
          <div
            role="button"
            aria-label={!unread ? t('lp.shell.set_notification_to_unread', 'Set notification to unread') : t('lp.shell.set_notification_to_read', 'Set notification to read')}
            data-tooltip={!unread ? t('lp.shell.set_notification_to_unread', 'Set notification to unread') : t('lp.shell.set_notification_to_read', 'Set notification to read')}
            className="nc-inbox-act"
            onClick={() => h.onRead(item.ids, unread)}
          >
            <Icon name={!unread ? 'markUnread' : 'markRead'} size={20} />
          </div>
          <div
            role="button"
            aria-label={archived ? t('lp.shell.unarchive', 'Unarchive') : t('lp.shell.archive_notification', 'Archive notification')}
            data-tooltip={archived ? t('lp.shell.unarchive', 'Unarchive') : t('lp.shell.archive_notification', 'Archive notification')}
            className="nc-inbox-act"
            onClick={() => h.onArchive(item.ids, !archived)}
          >
            <Icon name="archiveBox" size={20} />
          </div>
        </div>
      </div>
      <a role="link" href={item.pageId ? pageUrl(item.pageId) : undefined} className="nc-inbox-link" onClick={(e) => { e.preventDefault(); h.onOpen(item); }}>
        <div className="nc-inbox-item-inner">
          <div className="nc-inbox-item-content">
            <div className="nc-inbox-item-grid">
              <div className="nc-inbox-item-left">
                {avatar}
                <div className="nc-inbox-item-text">
                  <div className="nc-inbox-headline">{headline}</div>
                </div>
              </div>
              <div className="lit-activity-section-time nc-inbox-time">
                <span>{itemDate(n.created_time)}</span>
                {unread && <span role="img" aria-label={t('lp.shell.unread', 'Unread')} className="nc-inbox-dot" />}
              </div>
            </div>
            {body}
          </div>
        </div>
      </a>
      {actions}
      <div className="nc-inbox-sep" />
    </article>
  );
}

function renderItem(item: FeedItem, list: NotificationRecord[]): { headline: ReactNode; body?: ReactNode; avatar: ReactNode; actions?: ReactNode } {
  const n = list[0];
  const a = (n.activity ?? {}) as Act;
  const page = <PageMention pageId={item.pageId} />;
  const actors = actorsOf(item.ids, get);
  const avatar = <PersonHover userId={n.actor_id ?? null}><Avatar user={userOf(n.actor_id)} /></PersonHover>;
  switch (item.kind) {
    case 'comments': {
      if (list.every((x) => (x.activity as Act | undefined)?.kind === 'suggestion')) {
        const headline = rich('lp.shell.numberofauthors_plural_0_someone_propose', '{numberOfAuthors, plural, =0 {Someone <regular>proposed edits in </regular> {pageTitle}} =1 {<b>{firstAuthor}</b> <regular>proposed edits in </regular> {pageTitle}} other {<b>{firstAuthor}</b> and {numberOfOtherAuthors, plural, one {{numberOfOtherAuthors} other person} other {{numberOfOtherAuthors} others}} <regular>proposed edits in </regular> {pageTitle}}}', {
          firstAuthor: <Actor userId={actors[0]} />, pageTitle: page,
        }, { numberOfAuthors: actors.length, numberOfOtherAuthors: Math.max(0, actors.length - 1) });
        return { headline, avatar, body: <CommentsBody list={list} />, actions: <ReplyArea list={list} /> };
      }
      const headline = rich('lp.shell.numberofauthors_plural_0_someone_added_a', '{numberOfAuthors, plural, =0 {Someone <regular>added a comment to </regular> {pageTitle}} =1 {<b>{firstAuthor}</b> <regular>added a comment to </regular> {pageTitle}} =2 {<b>{firstAuthor}</b> and <b>{secondAuthor}</b> <regular>added comments to </regular> {pageTitle}} other {<b>{firstAuthor}</b> and {numberOfOtherAuthors, plural, one {{numberOfOtherAuthors} other person} other {{numberOfOtherAuthors} others}} <regular>added comments to </regular> {pageTitle}}}', {
        firstAuthor: <Actor userId={actors[0]} />, secondAuthor: <Actor userId={actors[1]} />, pageTitle: page,
      }, { numberOfAuthors: actors.length, numberOfOtherAuthors: Math.max(0, actors.length - 1) });
      return { headline, avatar, body: <CommentsBody list={list} />, actions: <ReplyArea list={list} /> };
    }
    case 'mentions': {
      const authors = <>{actors.map((id, i) => <span key={id}>{i > 0 && ', '}<Actor userId={id} /></span>)}</>;
      const headline = rich('lp.shell.tagged_you_in', '{authors} <regular>tagged you in </regular> {pageTitle}', { authors, pageTitle: page });
      const quotes = list.map((x) => (x.activity as Act | undefined)?.text).filter(Boolean) as string[];
      return {
        headline, avatar,
        body: quotes.length ? <div className="nc-inbox-quote">{quotes.slice(0, 3).join('\n')}</div> : undefined,
        actions: n.discussion_id ? <ReplyArea list={list} /> : undefined,
      };
    }
    case 'reactions': {
      const headline = rich('lp.shell.reacted_on', '{author} <regular>reacted on</regular> {pageTitle}', { author: <Actor userId={n.actor_id} />, pageTitle: page });
      const emojis = [...new Set(list.map((x) => (x.activity as Act | undefined)?.reaction).filter(Boolean))].join(' ');
      return { headline, avatar, body: <div className="nc-inbox-quote">{emojis ? `${emojis} ` : ''}{a.text ?? ''}</div> };
    }
    case 'updates': {
      const props = list.flatMap((x) => ((x.activity as Act | undefined)?.properties ?? []) as { id: string; name: string }[]);
      const names = [...new Set(props.map((p) => p.name))];
      if (names.length) {
        const headline = rich('lp.shell.changed_propertycount_select_single_othe', '{author} <regular>changed {propertyCount, select, single {a property} other {properties}} in</regular> {pageTitle}', { author: <Actor userId={n.actor_id} />, pageTitle: page }, { propertyCount: names.length === 1 ? 'single' : 'other' });
        return { headline, avatar, body: <div className="nc-inbox-props">{names.slice(0, 6).map((nm) => <span key={nm} className="nc-inbox-prop-chip">{nm}</span>)}</div> };
      }
      const headline = rich('lp.shell.numberofauthors_plural_one_updated_other', '{numberOfAuthors, plural, one {{authorOrAuthors} updated {pageTitle}} other {{authorOrAuthors} updated {pageTitle}}}', { authorOrAuthors: <Actor userId={n.actor_id} />, pageTitle: page }, { numberOfAuthors: actors.length || 1 });
      return { headline, avatar };
    }
    default:
      break;
  }
  switch (n.type) {
    case 'invite':
      return {
        headline: rich('lp.shell.sent_you_an_invite_to', '{author} <regular>sent you an invite to</regular> {pageTitle}', { author: <Actor userId={n.actor_id} />, pageTitle: page }),
        avatar,
        body: a.message ? <div className="nc-inbox-quote">{t('lp.shell.text', '“{message}”', { message: a.message })}</div> : undefined,
      };
    case 'reminder':
      return {
        headline: rich('lp.shell.reminder_for', 'Reminder <regular>for</regular> {pageTitle}', { pageTitle: page }),
        avatar: <div className="nc-inbox-avatar nc-inbox-icon-avatar" aria-hidden><Icon name="alarm" size={16} /></div>,
        body: (
          <div className="nc-inbox-reminder">
            {a.text && <div className="nc-inbox-quote">{a.text}</div>}
            {a.property_name && (
              <div className="nc-inbox-reminder-meta">
                {a.property_name && <span className="nc-inbox-prop-chip">{a.property_name}</span>}
                {a.date_text && <span className="nc-inbox-reminder-date"><Icon name="alarm" size={14} />{a.date_text}</span>}
              </div>
            )}
          </div>
        ),
      };
    case 'property_mention':
      return {
        headline: rich('lp.shell.tagged_you_in_9613', '{author} <regular>tagged you in</regular> {pageTitle}', { author: <Actor userId={n.actor_id} />, pageTitle: page }),
        avatar,
        body: a.property_name ? (
          <div className="nc-inbox-props">
            <span className="nc-inbox-prop-chip"><Icon name="person" size={14} />{a.property_name}</span>
            <span className="nc-inbox-prop-value"><Avatar user={userOf(useSession.getState().userId)} size={18} />{nameOf(userOf(useSession.getState().userId))}</span>
          </div>
        ) : undefined,
      };
    case 'mention':
      return {
        
        headline: a.kind === 'group_mention'
          ? rich('lp.shell.tagged_your_group_on', '{author} <regular>tagged your group on</regular> {pageTitle}', { author: <Actor userId={n.actor_id} />, pageTitle: page })
          : rich('lp.shell.tagged_you_in_9613', '{author} <regular>tagged you in</regular> {pageTitle}', { author: <Actor userId={n.actor_id} />, pageTitle: page }),
        avatar,
        body: a.text ? <div className="nc-inbox-quote">{a.text}</div> : undefined,
        actions: n.discussion_id ? <ReplyArea list={list} /> : undefined,
      };
    case 'access_requested':
      if (a.kind === 'guest_invite') {
        const emails = ((a.for_emails ?? []) as string[]).join(', ');
        return {
          headline: rich('lp.shell.asked_for_access_to', '{requestingActorName} <regular>asked for access to</regular> {pageTitleAndIcon}', { requestingActorName: <Actor userId={n.actor_id} />, pageTitleAndIcon: page }),
          avatar,
          body: (
            <div className="nc-inbox-quote">
              {t('lp.shell.access_requested_for', 'Access requested for {forActorEmail} ({forActorType})', { forActorEmail: emails, forActorType: a.restricted ? t('lp.shell.restricted_member', 'Restricted member') : t('lp.shell.guest', 'Guest') })}
            </div>
          ),
          actions: <AccessRequestActions n={n} requesterRole="none" />,
        };
      }
      return {
        headline: rich('lp.shell.asked_for_access_to_0796', '{requestingActorName} <regular>asked for access to</regular> {pageTitle}', { requestingActorName: <Actor userId={n.actor_id} />, pageTitle: page }),
        avatar,
        body: a.message
          ? <div className="nc-inbox-quote">{t('lp.shell.text', '“{message}”', { message: a.message })}</div>
          : a.kind === 'page_edit' ? <div className="nc-inbox-quote">{t('lp.shell.edit_access_requested', 'Edit access requested')}</div> : undefined,
        actions: <AccessRequestActions n={n} requesterRole={item.requesterRole ?? 'none'} />,
      };
    case 'access_granted':
      if (a.kind === 'member_request' && a.self) {
        // my own membership request (guest banner / teamspace invite link) was answered
        const ws = <b>{String(a.space_name ?? '') || t('lp.shell.the_workspace', 'the workspace')}</b>;
        return {
          headline: a.status === 'denied'
            ? rich('lp.shell.declined_your_request_to_join', '{author} <regular>declined your ask to join</regular> {workspaceName}', { author: <Actor userId={n.actor_id} />, workspaceName: ws })
            : rich('lp.shell.included_you_in', '{author} <regular>included you in</regular> {workspaceName}', { author: <Actor userId={n.actor_id} />, workspaceName: ws }),
          avatar,
        };
      }
      if (a.kind === 'upgrade_request' || a.kind === 'member_request') {
        const what = a.kind === 'upgrade_request' ? String(a.plan ?? '') : ((a.emails ?? []) as string[]).join(', ');
        return {
          headline: a.status === 'denied'
            ? rich('lp.shell.denied_your_request_for', '{author} <regular>denied your request for</regular> {what}', { author: <Actor userId={n.actor_id} />, what: <b>{what}</b> })
            : rich('lp.shell.approved_your_request_for', '{author} <regular>approved your request for</regular> {what}', { author: <Actor userId={n.actor_id} />, what: <b>{what}</b> }),
          avatar,
        };
      }
      if (a.kind === 'guest_invite') {
        const who = ((a.for_emails ?? []) as string[]).join(', ');
        return {
          headline: a.status === 'denied'
            ? rich('lp.shell.didn_t_approve_adding_as_a', '{resolvingActorName} <regular>didn’t approve adding</regular> {forActorNameOrEmail} <regular>as a guest</regular>', { resolvingActorName: <Actor userId={n.actor_id} />, forActorNameOrEmail: <b>{who}</b> })
            : rich('lp.shell.approved_your_guest_invitation_for_as', '{resolvingActorName} <regular>approved your guest invitation for</regular> {forActorNameOrEmail} <regular>as a guest</regular>', { resolvingActorName: <Actor userId={n.actor_id} />, forActorNameOrEmail: <b>{who}</b> }),
          avatar,
        };
      }
      return {
        headline: a.kind === 'page_edit'
          ? <>{rich('lp.shell.approved_your_page_edit_request', '{resolvingActorName} <regular>approved your page edit request</regular>', { resolvingActorName: <Actor userId={n.actor_id} /> })} {page}</>
          : rich('lp.shell.sent_you_an_invite_to', '{author} <regular>sent you an invite to</regular> {pageTitle}', { author: <Actor userId={n.actor_id} />, pageTitle: page }),
        avatar,
      };
    case 'team_join_requested':
      return {
        headline: rich('lp.shell.asked_to_join', '{requestingActorName} <regular>asked to join</regular> {teamIconAndName}', { requestingActorName: <Actor userId={n.actor_id} />, teamIconAndName: <TeamMention teamId={a.team_id} /> }),
        avatar,
        body: a.message ? <div className="nc-inbox-quote">{t('lp.shell.text', '“{message}”', { message: a.message })}</div> : undefined,
        actions: <TeamRequestActions n={n} />,
      };
    case 'team_join_approved':
      return {
        headline: rich('lp.shell.invited_you_into', '{author} <regular>invited you into</regular> {teamIconAndName}', { author: <Actor userId={n.actor_id} />, teamIconAndName: <TeamMention teamId={a.team_id} /> }),
        avatar,
      };
    case 'export_completed':
      
      return {
        headline: <>{t('lp.shell.your_workspace_has_finished_exporting', 'Your workspace has finished exporting')}</>,
        avatar: <div className="nc-inbox-avatar nc-inbox-icon-avatar" aria-hidden><Icon name="export" size={16} /></div>,
        body: <div className="nc-inbox-quote">{t('lp.shell.this_download_link_expires_in_7', 'This download link expires in 7 days.')}</div>,
        actions: typeof a.url === 'string' && a.url.startsWith('/files/') && (!a.expires || Number(a.expires) > Date.now())
          ? <a className="nc-dialog-btn outline small" href={a.url} download={typeof a.filename === 'string' ? a.filename : ''} onClick={(e) => e.stopPropagation()}>{t('lp.shell.download', 'Download')}</a>
          : undefined,
      };
    case 'space_member_requested': {
      const emails = ((a.emails ?? []) as string[]).join(', ');
      if (a.kind === 'upgrade') {
        return {
          headline: rich('lp.shell.numberofauthors_plural_one_asked_for_a', '{numberOfAuthors, plural, one {{authorOrAuthors} asked for a workspace upgrade} other {{authorOrAuthors} asked for a workspace upgrade}}', { authorOrAuthors: <Actor userId={n.actor_id} /> }, { numberOfAuthors: 1 }),
          avatar,
          body: a.message ? <div className="nc-inbox-quote">“{a.message}”</div> : undefined,
        };
      }
      
      const self = !!a.self || (((a.emails ?? []) as string[]).length === 1 && (userOf(n.actor_id)?.email ?? '').toLowerCase() === String((a.emails as string[])[0]).toLowerCase());
      const hasMessage = typeof a.message === 'string' && a.message.length > 0;
      return {
        headline: self
          ? rich('lp.shell.asked_to_become_a_workspace_member', '{requestingActorName} <regular>asked to become a workspace member</regular>{hasMessage, select, true {, “{message}”} other {}}', { requestingActorName: <Actor userId={n.actor_id} /> }, { hasMessage: hasMessage ? 'true' : 'false', message: String(a.message ?? '') })
          : rich('lp.shell.asked_for_to_join_the_workspace', '{requestingActorName} <regular>asked for</regular> {forActorEmail} <regular>to join the workspace as a member</regular>{hasMessage, select, true {, “{message}”} other {}}', { requestingActorName: <Actor userId={n.actor_id} />, forActorEmail: <b>{emails}</b> }, { hasMessage: hasMessage ? 'true' : 'false', message: String(a.message ?? '') }),
        avatar,
        body: a.team_id ? <div className="nc-inbox-quote nc-inbox-member-team"><TeamMention teamId={a.team_id} /></div> : undefined,
        actions: a.request_id_ws ? <MemberRequestActions n={n} /> : undefined,
      };
    }
    case 'automation': {
      const name = String(a.automation_name ?? 'Automation');
      const headline = a.kind === 'paused'
        ? t('lp.shell.is_paused', '{automationName} is paused', { automationName: name })
        : a.subject || t('lp.shell.new_message_from', 'New message from {automationName}', { automationName: name });
      const quote = (a.message ?? a.text) as string | undefined;
      return {
        headline: <>{headline}{item.pageId && <> <span className="nc-inbox-regular">{t('lp.shell.in', 'In').toLowerCase()}</span> {page}</>}</>,
        avatar: <div className="nc-inbox-avatar nc-inbox-icon-avatar" aria-hidden><Icon name="lightning" size={16} /></div>,
        body: quote
          ? <div className="nc-inbox-quote">{quote}</div>
          : a.kind === 'paused' ? <div className="nc-inbox-quote">{t('lp.shell.fix_errors_or_remove_failed_steps', 'Fix errors or remove failed steps to turn this automation back on')}</div> : undefined,
      };
    }
    case 'verification_expired' as NotificationRecord['type']:
      return {
        headline: a.kind === 'wiki'
          ? rich('lp.shell.is_no_longer_a_verified_wiki', '{pageTitle} <regular>is no longer a verified wiki</regular>', { pageTitle: page })
          : rich('lp.shell.is_no_longer_a_verified_page', '{pageTitle} <regular>is no longer a verified page</regular>', { pageTitle: page }),
        avatar: <div className="nc-inbox-avatar nc-inbox-icon-avatar" aria-hidden><Icon name="verification" size={16} /></div>,
      };
    default:
      return {
        headline: rich('lp.shell.numberofauthors_plural_one_updated_other', '{numberOfAuthors, plural, one {{authorOrAuthors} updated {pageTitle}} other {{authorOrAuthors} updated {pageTitle}}}', { authorOrAuthors: <Actor userId={n.actor_id} />, pageTitle: page }, { numberOfAuthors: 1 }),
        avatar,
      };
  }
}

// ---------------------------------------------------------------- comments: grouped threads + inline reply
function CommentsBody({ list }: { list: NotificationRecord[] }) {
  const [open, setOpen] = useState(false);
  const threads = useMemo(() => {
    const ids: string[] = [];
    for (const n of list) if (n.discussion_id && !ids.includes(n.discussion_id)) ids.push(n.discussion_id);
    return ids;
  }, [list]);
  const latest = list[0];
  const la = (latest.activity ?? {}) as Act;
  const visible = open ? threads : threads.slice(0, 1);
  return (
    <div className="nc-inbox-thread-list">
      {visible.length === 0 && la.text && <div className="nc-inbox-quote">{la.text}</div>}
      {visible.map((did) => <ThreadPreview key={did} discussionId={did} notifications={list.filter((x) => x.discussion_id === did)} />)}
      {threads.length > 1 && (
        <div
          role="button"
          className="nc-inbox-threads-toggle"
          aria-expanded={open}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        >
          <Icon name="comment" size={14} />
          <span>{t('lp.shell.discussions_b27e', '{count} discussions', { count: threads.length })}</span>
          <Icon name="chevronDown" size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
        </div>
      )}
    </div>
  );
}

function ThreadPreview({ discussionId, notifications }: { discussionId: string; notifications: NotificationRecord[] }) {
  const d = useRecord<DiscussionRecord>('discussion', discussionId);
  const ctx = toPlainText(d?.context as RichText | undefined) || (notifications[0]?.activity as Act | undefined)?.context;
  const commentIds = new Set(notifications.map((n) => n.comment_id).filter(Boolean) as string[]);
  const comments = (d?.comments ?? []).map((id) => records.get<CommentRecord>('comment', id)).filter((c): c is CommentRecord => !!c && c.alive !== false);
  const shown = comments.filter((c) => commentIds.has(c.id)).slice(-3);
  const fallback = (notifications[0]?.activity as Act | undefined)?.text as string | undefined;
  return (
    <div className="nc-inbox-thread" data-discussion-id={discussionId}>
      {ctx && <div className="nc-inbox-thread-context">{ctx}</div>}
      {shown.length > 0 ? shown.map((c) => (
        <div key={c.id} className="nc-inbox-comment">
          <span className="nc-inbox-comment-author">{nameOf(userOf(c.created_by_id))}</span>
          <RichTextView value={c.text as RichText} className="nc-inbox-comment-text" />
        </div>
      )) : fallback ? <div className="nc-inbox-quote">{fallback}</div> : null}
      {d?.resolved && <div className="nc-inbox-thread-resolved"><Icon name="check" size={12} />{t('lp.shell.resolved', 'Resolved')}</div>}
    </div>
  );
}

function ReplyArea({ list }: { list: NotificationRecord[] }) {
  const [open, setOpen] = useState(false);
  const did = list.find((n) => n.discussion_id)?.discussion_id;
  const d = useRecord<DiscussionRecord>('discussion', did);
  const role = d ? records.role('block', d.parent_id) : 'none';
  if (!did || !d || !['comment_only', 'read_and_write', 'editor', 'content_only_editor'].includes(role)) return null;
  // suggestions are accepted / rejected on the page, not resolved from the Inbox
  const canResolve = d.type !== 'suggestion';
  return (
    <div className="nc-inbox-reply" onClick={(e) => e.stopPropagation()}>
      {!open ? (
        <div className="nc-inbox-thread-actions">
          <div role="button" className="nc-inbox-reply-btn" onClick={() => setOpen(true)}>
            <Icon name="arrowTurnDownLeftSmall" size={14} />
            <span>{t('lp.shell.reply', 'Reply')}</span>
          </div>
          {canResolve && (
            
            <div role="button" className="nc-inbox-resolve-btn" data-resolved={d.resolved ? 'true' : 'false'} onClick={() => resolveDiscussion(d.id, !d.resolved)}>
              <Icon name={d.resolved ? 'undo' : 'check'} size={14} />
              <span>{d.resolved ? t('lp.shell.reopen', 'Reopen') : t('lp.shell.resolve', 'Resolve')}</span>
            </div>
          )}
        </div>
      ) : (
        <div className="nc-inbox-reply-composer">
          <CommentComposer
            autoFocus
            compact
            placeholder={t('lp.shell.reply_defd', 'Reply…')}
            onCancel={() => setOpen(false)}
            onSubmit={(text) => {
              addComment(d.parent_id, text, d.id);
              setOpen(false);
              useUI.getState().toast(t('lp.shell.reply_sent', 'Reply sent'));
            }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- requests
function ResolvedLine({ a }: { a: Act }) {
  const me = useSession.getState().userId;
  const by = a.resolved_by_id === me ? t('lp.shell.you_905c', 'You') : nameOf(userOf(a.resolved_by_id));
  const status = a.status === 'approved' ? t('lp.shell.approved', 'Approved') : t('lp.shell.denied', 'Denied');
  return (
    <div className="nc-inbox-resolved">
      {t('lp.shell.by_on', '{status} by {resolvedBy} on {time}', { status, resolvedBy: by, time: longDate(a.resolved_time ?? Date.now()) })}
      {a.status === 'approved' && a.granted_role && a.granted_role !== 'member' ? ` · ${ROLE_LABEL(String(a.granted_role))}` : ''}
    </div>
  );
}

function AccessRequestActions({ n, requesterRole }: { n: NotificationRecord; requesterRole: string }) {
  const a = (n.activity ?? {}) as Act;
  const requester = userOf(n.actor_id);
  const initial = (a.requested_role as string | undefined) ?? (a.kind === 'page_edit' ? 'read_and_write' : 'reader');
  const [role, setRole] = useState<string>(requesterRole !== 'none' && (ROLE_RANK[requesterRole] ?? 0) >= (ROLE_RANK[initial] ?? 0) ? requesterRole : initial);
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(requesterRole);
  if (a.status && a.status !== 'pending') return <div className="nc-inbox-request" onClick={(e) => e.stopPropagation()}><ResolvedLine a={a} /></div>;
  const already = current !== 'none' && (ROLE_RANK[current] ?? 0) >= (ROLE_RANK[a.kind === 'page_edit' ? 'read_and_write' : 'reader'] ?? 0);
  const changed = role !== current;
  const act = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await decideAccessRequest(String(a.request_id), approve, role);
      if (approve && r.role) setCurrent(r.role);
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.shell.updating_this_request_failed_please_retr', 'Updating this request failed. Please retry.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nc-inbox-request" onClick={(e) => e.stopPropagation()}>
      {a.external && (
        <div className="nc-inbox-external-warning">{t('lp.shell.only_share_content_with_this_external', 'Only share content with this external user if you trust them')}</div>
      )}
      {already && (
        <div className="nc-inbox-already">
          {current === 'read_and_write' || current === 'editor'
            ? t('lp.shell.is_already_an_editor', '{requestingUser} is already an editor.', { requestingUser: nameOf(requester) })
            : t('lp.shell.already_has_permission', '{requestingUser} already has access.', { requestingUser: nameOf(requester) })}
        </div>
      )}
      <div className="nc-inbox-request-buttons">
        <div
          role="button"
          aria-haspopup="dialog"
          className="nc-inbox-role-btn"
          onClick={(e) => openMenu(e.currentTarget as HTMLElement, {
            width: 220,
            sections: [{ items: ['editor', 'read_and_write', 'comment_only', 'reader'].map((r) => ({ label: ROLE_LABEL(r), checked: r === role, onSelect: () => setRole(r) })) }],
          }, { placement: 'bottom-start' })}
        >
          <span className="notranslate">{ROLE_LABEL(role)}</span>
          <Icon name="chevronDown" size={12} />
        </div>
        {already ? (
          <div role="button" aria-disabled={!changed || busy} className={`nc-inbox-approve-btn ${!changed || busy ? 'disabled' : ''}`} onClick={() => changed && void act(true)}>
            {t('lp.shell.change', 'Change')}
          </div>
        ) : (
          <div role="button" aria-disabled={busy} className={`nc-inbox-approve-btn ${busy ? 'disabled' : ''}`} onClick={() => void act(true)}>
            {t('lp.shell.approve', 'Approve')}
          </div>
        )}
        <div role="button" aria-disabled={busy} className="nc-inbox-deny-btn" onClick={() => void act(false)}>
          {t('lp.shell.deny', 'Deny')}
        </div>
      </div>
    </div>
  );
}

/** Workspace member requests (Settings › Requests in the Inbox): Approve / Deny, then "Approved by … on …". */
function MemberRequestActions({ n }: { n: NotificationRecord }) {
  const a = (n.activity ?? {}) as Act;
  const [busy, setBusy] = useState(false);
  if (a.status && a.status !== 'pending') {
    const me = useSession.getState().userId;
    const by = a.resolved_by_id === me ? t('lp.shell.you_905c', 'You') : nameOf(userOf(a.resolved_by_id));
    return (
      <div className="nc-inbox-request" onClick={(e) => e.stopPropagation()}>
        <div className="nc-inbox-resolved">
          {a.status === 'approved'
            ? t('lp.shell.approved_by_at', 'Approved by {grantedBy} at {resolvedTime}', { grantedBy: by, resolvedTime: longDate(a.resolved_time ?? Date.now()) })
            : t('lp.shell.declined_by_at', 'Declined by {grantedBy} at {resolvedTime}', { grantedBy: by, resolvedTime: longDate(a.resolved_time ?? Date.now()) })}
        </div>
      </div>
    );
  }
  const act = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await api('resolveMemberRequest', { spaceId: n.space_id, requestId: a.request_id_ws, approve });
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.shell.updating_this_request_failed_please_retr', 'Updating this request failed. Please retry.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nc-inbox-request" onClick={(e) => e.stopPropagation()}>
      <div className="nc-inbox-request-buttons">
        <div role="button" aria-disabled={busy} className={`nc-inbox-approve-btn ${busy ? 'disabled' : ''}`} onClick={() => void act(true)}>
          {t('lp.shell.approve', 'Approve')}
        </div>
        <div role="button" aria-disabled={busy} className="nc-inbox-deny-btn" onClick={() => void act(false)}>
          {t('lp.shell.deny', 'Deny')}
        </div>
      </div>
    </div>
  );
}

function TeamRequestActions({ n }: { n: NotificationRecord }) {
  const a = (n.activity ?? {}) as Act;
  const [busy, setBusy] = useState(false);
  if (a.status && a.status !== 'pending') {
    const me = useSession.getState().userId;
    const by = a.resolved_by_id === me ? t('lp.shell.you_905c', 'You') : nameOf(userOf(a.resolved_by_id));
    return (
      <div className="nc-inbox-request" onClick={(e) => e.stopPropagation()}>
        <div className="nc-inbox-resolved">
          {a.status === 'approved'
            ? t('lp.shell.approved_by_at', 'Approved by {grantedBy} at {resolvedTime}', { grantedBy: by, resolvedTime: longDate(a.resolved_time ?? Date.now()) })
            : t('lp.shell.declined_by_at', 'Declined by {grantedBy} at {resolvedTime}', { grantedBy: by, resolvedTime: longDate(a.resolved_time ?? Date.now()) })}
        </div>
      </div>
    );
  }
  const act = async (approve: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      await decideAccessRequest(String(a.request_id), approve);
    } catch (e: any) {
      useUI.getState().toast(e?.message || t('lp.shell.updating_this_request_failed_please_retr', 'Updating this request failed. Please retry.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="nc-inbox-request" onClick={(e) => e.stopPropagation()}>
      <div className="nc-inbox-request-buttons">
        <div role="button" aria-disabled={busy} className={`nc-inbox-approve-btn ${busy ? 'disabled' : ''}`} onClick={() => void act(true)}>
          {t('lp.shell.approve', 'Approve')}
        </div>
        <div role="button" aria-disabled={busy} className="nc-inbox-deny-btn" onClick={() => void act(false)}>
          {t('lp.shell.deny', 'Deny')}
        </div>
      </div>
    </div>
  );
}

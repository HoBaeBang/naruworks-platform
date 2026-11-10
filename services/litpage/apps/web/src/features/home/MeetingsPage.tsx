// Meetings (/<domain>/meetings): main-frame landing for the sidebar "Meetings" tab, with upcoming events (connect
// calendar) and the AI meeting notes history (same data as Library, AI meeting notes).
// The page is opened from the Meetings sidebar tab and reuses the Library visual language.
import type { BlockRecord } from '@nc/shared/records.ts';
import { records } from '../../lib/store/records.ts';
import { useUI } from '../../lib/store/ui.ts';
import { navigate, openPage, pageUrl, spaceDomain } from '../../lib/router.ts';
import { useSession } from '../../lib/store/session.ts';
import { useTableVersion } from '../../lib/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { createMeetingNote } from '../shell/sidebar/menus.tsx';
import { pageTitle } from '../page/pageActions.ts';
import { t } from '../shell/i18n.ts';
import { useMeetingNotes } from './library/data.ts';
import { libraryTime, userName, userOf } from './library/model.ts';
import { LibAvatar } from './library/menus.tsx';
import { MeetingNotesEmpty } from './LibraryPage.tsx';
import './icons.tsx';
import './home.css';

export function MeetingsPage() {
  const { rows, loaded } = useMeetingNotes(true);
  const spaceId = useSession((s) => s.spaceId);
  useTableVersion(['block', 'lit_user']);
  return (
    <div className="nc-lib-page nc-meetings-page">
      <div className="lit-scroller vertical nc-lib-scroll">
        <div className="nc-lib-headline">
          <h1 className="nc-lib-h1">{t('lp.home.meetings', 'Meetings')}</h1>
          <div role="button" className="nc-lib-primary" onClick={() => createMeetingNote()}>{t('lp.home.start_ai_meeting_notes', 'Start AI meeting notes')}</div>
        </div>
        <section className="nc-meet-section">
          <div className="nc-meet-heading">
            <Icon name="calendarEmpty" size={16} />
            <span>{t('lp.home.upcoming_events', 'Upcoming events')}</span>
          </div>
          <div className="nc-meet-card">
            <div className="nc-meet-card-icon"><Icon name="calendarConnect" size={28} /></div>
            <div className="nc-meet-card-text">
              <div className="nc-meet-card-title">{t('lp.home.link_a_calendar_with_litpage', 'Link a calendar with Litpage')}</div>
              <div className="nc-meet-card-desc">{t('lp.home.litpage_can_join_your_calls_transcribe', 'Litpage can join your calls, transcribe what’s said, and write meeting summaries for you.')}</div>
            </div>
            <div role="button" className="nc-lib-secondary" onClick={() => useUI.getState().openSettings('mail-calendar')}>
              {t('lp.home.connect_calendar', 'Connect calendar')}
            </div>
          </div>
          <div className="nc-meet-noevents">{t('lp.home.no_upcoming_events', 'Nothing scheduled soon')}</div>
        </section>
        <section className="nc-meet-section">
          <div className="nc-meet-heading with-action">
            <Icon name="libPaperMic" size={16} />
            <span>{t('lp.home.ai_meeting_notes', 'AI meeting notes')}</span>
            {rows.length > 0 && (
              <div role="button" className="nc-meet-viewall" onClick={() => navigate(`/${spaceDomain(spaceId)}/library/meetings`)}>
                {t('lp.home.view_all', 'View all')}
              </div>
            )}
          </div>
          {loaded && rows.length === 0 && <MeetingNotesEmpty />}
          <div className="nc-meet-list">
            {rows.slice(0, 50).map((r) => {
              const b = records.get<BlockRecord>('block', r.id);
              if (!b) return null;
              const u = userOf(b.created_by_id);
              return (
                <div
                  key={r.id}
                  role="button"
                  className="nc-meet-row"
                  onClick={(e) => ((e.metaKey || e.ctrlKey) ? window.open(pageUrl(r.id), '_blank') : openPage(r.id))}
                >
                  <PageIcon block={b} size={20} />
                  <span className="nc-meet-row-title nc-ellipsis">{pageTitle(b) || t('lp.home.untitled', 'Untitled')}</span>
                  {u && (
                    <span className="nc-meet-row-user">
                      <LibAvatar user={u} />
                      <span className="nc-ellipsis">{userName(u)}</span>
                    </span>
                  )}
                  <span className="nc-meet-row-date">{libraryTime(b.created_time)}</span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

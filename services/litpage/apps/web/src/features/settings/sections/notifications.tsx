import { HELP_URL } from '@nc/shared/brand.ts';
// Settings › Notifications and Mail & Calendar.
import { Fragment, type ReactNode } from 'react';
import { useCurrentSpaceView } from '../../../lib/hooks.ts';
import { useUI } from '../../../lib/store/ui.ts';
import { Icon } from '../../../components/Icon.tsx';
import { t } from '../../shell/i18n.ts';
import { Button, Group, Row, SectionPage, Switch, msg, rich } from '../ui.tsx';
import { prefValue, savePref, saveSpaceViewFields, usePrefs } from '../userSettings.ts';

function connectStub(app: string) {
  useUI.getState().toast(t('lp.settings.connecting_isn_t_available_in_this', 'Connecting {app} isn’t available in this build', { app }));
}

export function NotificationsSection() {
  const prefs = usePrefs();
  const sv = useCurrentSpaceView();
  const emailOn = sv?.notify_email !== false && prefValue(prefs, 'email_activity');
  return (
    <SectionPage title={t('lp.settings.notifications', 'Notifications')} subtitle={t('lp.settings.choose_when_and_how_to_get', 'Choose when and how to get notifications')}>
      <Group title={t('lp.settings.notifications_in_litpage', 'Notifications in Litpage')}>
        <Row
          label={t('lp.settings.activity_in_a_live_meeting', 'Activity in a live meeting')}
          description={t('lp.settings.choose_which_in_app_popups_appear', 'Choose which in-app popups appear during video calls and AI meeting notes')}
        />
        <MeetingActivityList
          rows={[
            { label: t('lp.settings.join_a_video_call_and_start', 'Join a video call and start transcription'), locked: true, checked: prefValue(prefs, 'notify_meeting_join') },
            { label: t('lp.settings.transcribing_the_meeting', 'Transcribing the meeting'), checked: prefValue(prefs, 'notify_meeting_transcribed'), onChange: (v) => savePref('notify_meeting_transcribed', v) },
            { label: t('lp.settings.summarizing_the_meeting', 'Summarizing the meeting'), locked: true, checked: prefValue(prefs, 'notify_meeting_summarized') },
          ]}
        />
      </Group>

      <Group title={t('lp.settings.connected_apps', 'Connected apps')}>
        <Row
          leading={<AppTile name="Slack" />}
          label={t('lp.settings.slack', 'Slack')}
          description={t('lp.settings.have_slack_alert_you_to_what', 'Have Slack alert you to what’s happening across your Litpage workspace')}
          control={<Button onClick={() => connectStub('Slack')}>{t('lp.settings.connect', 'Connect')}</Button>}
        />
        <Row
          leading={<AppTile name="Discord" />}
          label={t('lp.settings.discord', 'Discord')}
          description={t('lp.settings.have_discord_alert_you_to_what', 'Have Discord alert you to what’s happening across your Litpage workspace')}
          control={<Button onClick={() => connectStub('Discord')}>{t('lp.settings.connect', 'Connect')}</Button>}
        />
        <Row
          leading={<AppTile name="Microsoft Teams" />}
          label={t('lp.settings.microsoft_teams', 'Microsoft Teams')}
          description={t('lp.settings.have_microsoft_teams_alert_you_to', 'Have Microsoft Teams alert you to what’s happening across your Litpage workspace')}
          control={<Button onClick={() => connectStub('Microsoft Teams')}>{t('lp.settings.connect', 'Connect')}</Button>}
        />
      </Group>

      <Group title={t('lp.settings.email_notifications', 'Email notifications')}>
        <Row
          label={t('lp.settings.my_workspace_activity', 'My workspace activity')}
          description={t('lp.settings.receive_email_for_new_comments_and', 'Receive email for new comments and mentions, page invitations, reminders, requests for access, and changes to database properties')}
          control={<Switch label="Activity in this workspace" checked={emailOn} onChange={(v) => { savePref('email_activity', v); saveSpaceViewFields({ notify_email: v }); }} />}
        />
        <Row
          label={t('lp.settings.always_notify_me_by_email', 'Always notify me by email')}
          description={t('lp.settings.keep_getting_activity_emails_even_while', 'Keep getting activity emails even while you’re using Litpage')}
          control={<Switch label="Send email notifications every time" checked={prefValue(prefs, 'email_always')} onChange={(v) => savePref('email_always', v)} />}
        />
        <Row
          label={t('lp.settings.page_updates', 'Page updates')}
          description={rich(msg('lp.settings.get_email_digests_for_pages_where', 'Get email digests for pages where you’ve <inlinelink>enabled notifications</inlinelink> and pages you created'), {}, {
            inlinelink: (c) => HELP_URL ? <a href={HELP_URL} target="_blank" rel="noreferrer">{c}</a> : c,
          })}
          control={<Switch label="Page updates" checked={prefValue(prefs, 'email_page_updates')} onChange={(v) => savePref('email_page_updates', v)} />}
        />
        <Row
          label={t('lp.settings.workspace_digest', 'Workspace digest')}
          description={t('lp.settings.receive_a_regular_email_roundup_of', 'Receive a regular email roundup of workspace activity')}
          control={<Switch label="Workspace digest" checked={prefValue(prefs, 'email_workspace_digest')} onChange={(v) => savePref('email_workspace_digest', v)} />}
        />
        <Row
          label={t('lp.settings.emails_about_product_news_and_updates', 'Emails about product news and updates')}
          description={t('lp.settings.occasionally_email_me_about_new_litpage', 'Occasionally email me about new Litpage features')}
          control={HELP_URL ? <Button icon="arrowDiagonalUpRightSmall" onClick={() => window.open(HELP_URL!, '_blank')}>{t('lp.settings.manage_settings', 'Manage settings')}</Button> : null}
        />
      </Group>
      {HELP_URL && <a className="nc-set-help-link" href={HELP_URL} target="_blank" rel="noreferrer">
        <Icon name="questionMarkCircleSmall" size={16} />
        {t('lp.settings.notification_guide', 'Notification guide')}
      </a>}
    </SectionPage>
  );
}

/** Live meeting activity rows: 17px vertical padding, 1px --lp-border-secondary dividers,
 * 20px numbered circle, label + 16px help icon, and a lock (calendar not connected) before the dimmed switch. */
function MeetingActivityList({ rows }: { rows: { label: string; checked: boolean; locked?: boolean; onChange?: (v: boolean) => void }[] }) {
  return (
    <div className="nc-set-meeting-list">
      {rows.map((r, i) => (
        <Fragment key={i}>
          {i > 0 && <div className="nc-set-meeting-sep" role="presentation" />}
          <div className={`nc-set-meeting-row ${i === rows.length - 1 ? 'last' : ''}`}>
            <div className="nc-set-row">
              <div className="nc-set-row-text">
                <div className="nc-set-row-label">
                  <div className="nc-set-meeting-label">
                    <span className="nc-set-meeting-num">{i + 1}</span>
                    <span className="txt">
                      {r.label}
                      <span className="help" aria-hidden><Icon name="questionMarkCircle" size={16} /></span>
                    </span>
                  </div>
                </div>
              </div>
              <div className="nc-set-row-control">
                <div className="nc-set-meeting-ctl">
                  {r.locked && (
                    <span className="lock" data-tooltip={t('lp.settings.this_feature_needs_a_connected_calendar', 'This feature needs a connected calendar')}>
                      <Icon name="lock" size={20} />
                    </span>
                  )}
                  <Switch label={r.label} disabled={r.locked} checked={r.checked} onChange={r.onChange} />
                </div>
              </div>
            </div>
          </div>
        </Fragment>
      ))}
    </div>
  );
}

const APP_COLORS: Record<string, string> = { Slack: '#4a154b', Discord: '#5865f2', 'Microsoft Teams': '#5059c9' };

/** 36px bordered integration tile (radius 8, 1px --lp-border-secondary, 22px glyph): a letter mark instead of brand artwork. */
function AppTile({ name }: { name: string }) {
  return (
    <span className="nc-set-app-tile" aria-hidden>
      <span className="mark" style={{ background: APP_COLORS[name] ?? 'var(--lp-gray-bg-tertiary)' }}>{name.slice(0, 1)}</span>
    </span>
  );
}

function Logo({ bg, label, fg = '#fff' }: { bg: string; label: ReactNode; fg?: string }) {
  return <span className="nc-set-brand" style={{ background: bg, color: fg }}>{label}</span>;
}

function ConnectBanner({ title, description, logos }: { title: string; description: string; logos: ReactNode }) {
  return (
    <div className="nc-set-banner">
      <div className="nc-set-banner-text">
        <div className="ttl">{title}</div>
        <div className="desc">{description}</div>
        <Button variant="primary" onClick={() => useUI.getState().toast(t('lp.settings.connecting_accounts_isn_t_available_in', 'Connecting accounts isn’t available in this build'))}>
          {t('lp.settings.get_started', 'Get started')}
        </Button>
      </div>
      <div className="nc-set-banner-art" aria-hidden>
        <div className="logos">{logos}</div>
        <div className="dots" />
        <div className="mock"><span className="n">N</span>Litpage<span className="pill" /><span className="pill short" /></div>
      </div>
    </div>
  );
}

export function MailCalendarSection() {
  return (
    <SectionPage title={t('lp.settings.mail_calendar', 'Mail & Calendar')} subtitle={t('lp.settings.review_and_manage_the_email_and', 'Review and manage the email and calendar accounts linked to Litpage')}>
      <Group plain medium title={t('lp.settings.connected_emails', 'Connected emails')} description={t('lp.settings.hand_off_drafting_and_sorting_mail', 'Hand off drafting and sorting mail to custom agents, file threads in Litpage databases, and more.')}>
        <ConnectBanner
          title={t('lp.settings.link_an_email_account_with_litpage', 'Link an email account with Litpage')}
          description={t('lp.settings.keep_every_email_detail_together_use', 'Keep every email detail together. Use Litpage AI to search, write drafts, and get answers, or sync messages straight to your databases.')}
          logos={<><Logo bg="#ea4335" label="M" /><Logo bg="#0a64c8" label="O" /></>}
        />
      </Group>
      <Group
        plain
        medium
        title={t('lp.settings.connected_calendars', 'Connected calendars')}
        description={t('lp.settings.work_with_litpage_databases_from_a_calendar', 'Work with Litpage databases from your calendar, have custom agents book meetings and capture notes, and more.')}
      >
        <ConnectBanner
          title={t('lp.settings.link_a_calendar_with_litpage', 'Link a calendar with Litpage')}
          description={t('lp.settings.keep_your_whole_schedule_in_one', 'Keep your whole schedule in one spot. Line up meetings, fine-tune your week, and show up ready for every call with help from Litpage AI.')}
          logos={<><Logo bg="#1a73e8" label="31" /><Logo bg="#0a64c8" label="O" /><Logo bg="#1d1d1f" label="" /><Logo bg="#fff" fg="#111" label="31" /></>}
        />
      </Group>
    </SectionPage>
  );
}

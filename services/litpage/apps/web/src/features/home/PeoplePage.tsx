// People Directory and profile pages: /<domain>/people[/<userId>].
// Directory: everyone in the workspace (search, role, teamspaces; guests on demand). Profile: photo, name, email, role,
// local time, Teamspaces, Top collaborators, and Recent activity (pages they edited that you can open).
// Server: apps/server/src/api/modules/people.ts.
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, UserRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { useSession } from '../../lib/store/session.ts';
import { navigate, openPage, spaceDomain } from '../../lib/router.ts';
import { useTableVersion } from '../../lib/hooks.ts';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { TeamIcon } from '../shell/sidebar/TeamIcon.tsx';
import { pageTitle } from '../page/pageActions.ts';
import { UserAvatar, userName } from '../presence/Avatar.tsx';
import { localTime, roleLabel, type PersonProfile } from '../presence/PersonHoverCard.tsx';
import { t } from '../shell/i18n.ts';
import './people.css';

export function PeoplePage({ userId }: { userId?: string }) {
  return userId ? <ProfilePage key={userId} userId={userId} /> : <Directory />;
}

function Directory() {
  const spaceId = useSession((s) => s.spaceId);
  const [query, setQuery] = useState('');
  const [guests, setGuests] = useState(false);
  const [people, setPeople] = useState<PersonProfile[] | null>(null);
  const [disabled, setDisabled] = useState(false);
  useTableVersion(['lit_user']);
  useEffect(() => {
    let alive = true;
    const tm = setTimeout(() => {
      void api('getPeopleDirectory', { spaceId, query, includeGuests: guests }).then((r) => {
        if (!alive) return;
        records.mergeRecordMap(r.recordMap);
        setPeople(r.people ?? []);
        setDisabled(!!r.disabled);
      }).catch(() => alive && setPeople([]));
    }, query ? 150 : 0);
    return () => {
      alive = false;
      clearTimeout(tm);
    };
  }, [spaceId, query, guests]);
  const domain = spaceDomain(spaceId);
  return (
    <div className="lit-scroller vertical nc-ppl">
      <div className="nc-ppl-inner">
        <h1 className="nc-ppl-title">{t('lp.home.people_directory', 'People Directory')}</h1>
        <div className="nc-ppl-toolbar">
          <div className="nc-input nc-ppl-search">
            <Icon name="search" size={16} style={{ color: 'var(--lp-icon-tertiary)' }} />
            <input value={query} placeholder={t('lp.home.type_to_search', 'Search by typing…')} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
          </div>
          <label className="nc-ppl-guests">
            <input type="checkbox" checked={guests} onChange={(e) => setGuests(e.target.checked)} />
            <span>{t('lp.home.include_guests', 'Include guests')}</span>
          </label>
        </div>
        {disabled && <div className="nc-ppl-empty">{t('lp.home.the_people_directory_is_turned_off', 'The people directory is turned off for this workspace.')}</div>}
        <div className="nc-ppl-table" role="table">
          <div className="nc-ppl-row head" role="row">
            <div role="columnheader">{t('lp.home.name', 'Name')}</div>
            <div role="columnheader">{t('lp.home.role', 'Role')}</div>
            <div role="columnheader">{t('lp.home.teams', 'Teams')}</div>
          </div>
          {(people ?? []).map((p) => {
            const u = records.get<UserRecord>('lit_user', p.userId);
            return (
              <div key={p.userId} role="row" className="nc-ppl-row" data-user-id={p.userId} onClick={() => navigate(`/${domain}/people/${p.userId}`)}>
                <div role="cell" className="nc-ppl-name">
                  <UserAvatar userId={p.userId} size={28} />
                  <div className="nc-ppl-name-text">
                    <div className="nc-ellipsis">{userName(u)}</div>
                    {u?.email && <div className="nc-ppl-email nc-ellipsis">{u.email}</div>}
                  </div>
                </div>
                <div role="cell" className="nc-ppl-role">{roleLabel(p.role)}</div>
                <div role="cell" className="nc-ppl-teams">
                  {p.teams.slice(0, 3).map((tm) => <span key={tm.id} className="nc-ppl-team"><TeamIcon team={tm} size={16} />{tm.name}</span>)}
                  {p.teams.length > 3 && <span className="nc-ppl-more">+{p.teams.length - 3}</span>}
                </div>
              </div>
            );
          })}
          {people && people.length === 0 && !disabled && <div className="nc-ppl-empty">{t('lp.home.no_people_found', 'No people match')}</div>}
        </div>
      </div>
    </div>
  );
}

interface ProfileData {
  profile: PersonProfile;
  profilesEnabled: boolean;
  /** Settings › People › "Show recent activity on people profiles" */
  activityEnabled?: boolean;
  recentPages: { pageId: string; editedTime: number }[];
  collaborators: string[];
}

function ProfilePage({ userId }: { userId: string }) {
  const spaceId = useSession((s) => s.spaceId);
  const [data, setData] = useState<ProfileData | null | 'missing'>(null);
  const [showAllTeams, setShowAllTeams] = useState(false);
  useTableVersion(['lit_user', 'block']);
  useEffect(() => {
    let alive = true;
    void api('getPersonProfile', { spaceId, userId, withActivity: true }).then((r) => {
      if (!alive) return;
      records.mergeRecordMap(r.recordMap);
      setData(r);
    }).catch(() => alive && setData('missing'));
    return () => {
      alive = false;
    };
  }, [spaceId, userId]);
  const u = records.get<UserRecord>('lit_user', userId);
  const domain = spaceDomain(spaceId);
  const time = useMemo(() => (data && data !== 'missing' ? localTime(data.profile.timeZone) : null), [data]);
  if (data === 'missing') return <div className="nc-ppl-empty" style={{ marginTop: '20vh' }}>{t('lp.home.we_couldn_t_find_this_page', 'We couldn’t find this page')}</div>;
  if (!data) return <div className="nc-page-loading" />;
  const p = data.profile;
  const teams = showAllTeams ? p.teams : p.teams.slice(0, 5);
  return (
    <div className="lit-scroller vertical nc-ppl">
      <div className="nc-ppl-inner nc-profile" data-user-id={userId}>
        <UserAvatar userId={userId} size={96} />
        <h1 className="nc-profile-name">{userName(u)}</h1>
        <div className="nc-profile-meta">
          {u?.email && <span><Icon name="mail" size={14} />{u.email}</span>}
          <span><Icon name="user" size={14} />{roleLabel(p.role)}</span>
          {time && <span><Icon name="clock" size={14} />{t('lp.home.local_time', '{time} local time', { time })}</span>}
        </div>
        {u?.email && (
          <div className="nc-profile-actions">
            <a className="nc-btn outline" href={`mailto:${u.email}`}><Icon name="mail" size={14} />{t('lp.home.email', 'Email')}</a>
          </div>
        )}

        <section className="nc-profile-section">
          <h2>{t('lp.home.teams', 'Teams')}</h2>
          {p.teams.length === 0 && <div className="nc-ppl-empty-inline">{t('lp.home.none', 'None')}</div>}
          {teams.map((tm) => (
            <div key={tm.id} className="nc-profile-item" role="button" onClick={() => navigate(`/${domain}/library/teamspaces`)}>
              <TeamIcon team={tm} size={20} />
              <span className="nc-ellipsis">{tm.name}</span>
              {tm.owner && <span className="nc-profile-tag">{t('lp.home.team_owner', 'Team owner')}</span>}
            </div>
          ))}
          {p.teams.length > 5 && (
            <div role="button" className="nc-profile-more" onClick={() => setShowAllTeams(!showAllTeams)}>
              {showAllTeams
                ? t('lp.home.hide_teams', 'Hide {numHidden} teams', { numHidden: p.teams.length - 5 })
                : t('lp.home.more_teams', '{numHidden} more teams', { numHidden: p.teams.length - 5 })}
            </div>
          )}
        </section>

        {data.collaborators.length > 0 && (
          <section className="nc-profile-section">
            <h2>{t('lp.home.top_collaborators', 'Top collaborators')}</h2>
            <div className="nc-profile-collabs">
              {data.collaborators.map((id) => (
                <div key={id} role="button" className="nc-profile-collab" onClick={() => navigate(`/${domain}/people/${id}`)}>
                  <UserAvatar userId={id} size={24} />
                  <span className="nc-ellipsis">{userName(records.get<UserRecord>('lit_user', id))}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {data.activityEnabled !== false && <section className="nc-profile-section">
          <h2>{t('lp.home.recent_activity', 'Recent activity')}</h2>
          {data.recentPages.length === 0 && (
            <div className="nc-ppl-empty-inline">{t('lp.home.when_creates_pages_you_ll_find', 'When {userNameOrEmail} creates pages, you’ll find them here', { userNameOrEmail: userName(u) })}</div>
          )}
          {data.recentPages.map((rp) => {
            const b = records.get<BlockRecord>('block', rp.pageId);
            return (
              <div key={rp.pageId} className="nc-profile-item" role="button" onClick={() => openPage(rp.pageId)}>
                <PageIcon block={b} size={20} />
                <span className="nc-ellipsis">{pageTitle(b) || t('lp.home.untitled', 'Untitled')}</span>
                <span className="nc-profile-time">{new Date(rp.editedTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
              </div>
            );
          })}
        </section>}
      </div>
    </div>
  );
}

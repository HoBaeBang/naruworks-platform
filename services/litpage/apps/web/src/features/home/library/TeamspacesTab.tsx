// Library › Teamspaces: "Your teamspaces" group (Name / Description / Access / Members, ▶ shows
// the teamspace's top-level pages) and a collapsed "More teamspaces" group with joinable teamspaces.
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, SpaceRecord, TeamRecord } from '@nc/shared/records.ts';
import { useCurrentSpace, useCurrentSpaceView, useTableVersion } from '../../../lib/hooks.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { openPage, pageUrl } from '../../../lib/router.ts';
import { Icon } from '../../../components/Icon.tsx';
import { PageIcon } from '../../shell/PageIcon.tsx';
import { TeamIcon } from '../../shell/sidebar/TeamIcon.tsx';
import { joinTeamspace, openTeamspaceSettings } from '../../shell/teamspaces.tsx';
import { teamJoinMode, teamVisibleTo } from '@nc/shared/permissions.ts';
import { useMyRequests } from '../../shell/access/access.ts';
import { openTeamRequestDialog } from '../../shell/access/RequestTeamDialog.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import { t } from '../../shell/i18n.ts';
import { useLibraryPrefetch } from './data.ts';

type Access = 'default' | 'open' | 'closed' | 'private';

function accessOf(team: TeamRecord, space?: SpaceRecord): Access {
  if (space?.default_team_ids?.includes(team.id)) return 'default';
  const ty = team.settings?.type;
  return ty === 'closed' || ty === 'private' ? ty : 'open';
}

function accessLabel(a: Access) {
  switch (a) {
    case 'default':
      return t('lp.home.default', 'Default');
    case 'closed':
      return t('lp.home.closed', 'Closed');
    case 'private':
      return t('lp.home.private', 'Private');
    default:
      return t('lp.home.open', 'Open');
  }
}

const ACCESS_ICON: Record<Access, string> = { default: 'globe', open: 'globe', closed: 'eye', private: 'lock' };

export function TeamspacesTab({ query, includeArchived }: { query: string; includeArchived: boolean }) {
  const sv = useCurrentSpaceView();
  const space = useCurrentSpace();
  const spaceId = useSession((s) => s.spaceId);
  const uid = useSession((s) => s.userId) ?? '';
  const ver = useTableVersion(['team', 'block']);
  const [mineOpen, setMineOpen] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const requestedTeams = useMyRequests((s) => s.teams);
  useEffect(() => {
    if (spaceId) void useMyRequests.getState().load(spaceId);
  }, [spaceId]);

  const { mine, more } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = (records.all<TeamRecord>('team') as TeamRecord[]).filter((tm) => tm.space_id === spaceId && tm.alive !== false && (includeArchived || !tm.archived_by));
    const match = (tm: TeamRecord) => !q || tm.name.toLowerCase().includes(q) || (tm.description ?? '').toLowerCase().includes(q);
    const joined = new Set(sv?.joined_teams ?? []);
    // membership is the source of truth (an owner may have removed me a closed teamspace still in my sidebar)
    const isMember = (tm: TeamRecord) => !!tm.membership?.some((m) => m.user_id === uid) || (joined.has(tm.id) && teamJoinMode(tm, space, uid) === 'join');
    const byName = (a: TeamRecord, b: TeamRecord) => a.name.localeCompare(b.name);
    return {
      mine: all.filter((tm) => isMember(tm) && match(tm)).sort(byName),
      // Open → Join, Closed → Request; Private teamspaces only show to their members (and workspace admins)
      more: all.filter((tm) => !isMember(tm) && teamVisibleTo(tm, space, uid) && match(tm)).sort(byName),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, sv, uid, query, includeArchived, ver, space]);

  const pageIds = mine.filter((tm) => expanded[tm.id]).flatMap((tm) => tm.team_pages ?? []);
  useLibraryPrefetch(pageIds);

  const header = (
    <div className="nc-lib-ts-header">
      <div className="nc-lib-ts-col name"><Icon name="libGridFill" size={16} /><span>{t('lp.home.name', 'Name')}</span></div>
      <div className="nc-lib-ts-col desc"><Icon name="libTextLines" size={16} /><span>{t('lp.home.description', 'Description')}</span></div>
      <div className="nc-lib-ts-col access"><Icon name="libSitemapFill" size={16} /><span>{t('lp.home.access', 'Access')}</span></div>
      <div className="nc-lib-ts-col members"><Icon name="libUserCircleFill" size={16} /><span>{t('lp.home.members', 'Members')}</span></div>
    </div>
  );

  const teamRow = (tm: TeamRecord, joinable: boolean) => {
    const open = !!expanded[tm.id];
    const pages = (tm.team_pages ?? []).filter((id) => records.get<BlockRecord>('block', id)?.alive !== false);
    const access = accessOf(tm, space);
    return (
      <div key={tm.id} className="nc-lib-ts-item" data-team-id={tm.id}>
        <div className="nc-lib-ts-row">
          <div className="nc-lib-ts-col name">
            <div
              role="button"
              aria-label={open ? t('lp.home.close', 'Close') : t('lp.home.open', 'Open')}
              aria-expanded={open}
              className="nc-lib-toggle"
              onClick={() => setExpanded((x) => ({ ...x, [tm.id]: !open }))}
            >
              <Icon name="libCaretRight" size={12} style={{ transform: open ? 'rotateZ(90deg)' : 'none', transition: 'transform 200ms ease-out' }} />
            </div>
            <TeamIcon team={tm} size={20} />
            <div role="button" className="nc-lib-ts-name nc-ellipsis" onClick={() => openTeamspaceSettings(tm.id)}>{tm.name}</div>
            {tm.archived_by && <span className="nc-lib-ts-tag">{t('lp.home.archived', 'Archived')}</span>}
            {joinable && teamJoinMode(tm, space, uid) === 'join' && (
              <div role="button" className="nc-lib-ts-join" onClick={() => joinTeamspace(tm.id)}>
                {t('lp.home.join', 'Join')}
              </div>
            )}
            {joinable && teamJoinMode(tm, space, uid) === 'request' && (
              requestedTeams.has(tm.id) ? (
                <div className="nc-lib-ts-join requested" aria-disabled="true">{t('lp.home.requested', 'Requested')}</div>
              ) : (
                <div role="button" className="nc-lib-ts-join" onClick={() => openTeamRequestDialog(tm)}>
                  {t('lp.home.request', 'Request')}
                </div>
              )
            )}
          </div>
          <div className="nc-lib-ts-col desc"><span className="nc-ellipsis">{tm.description}</span></div>
          <div className="nc-lib-ts-col access">
            <Icon name={ACCESS_ICON[access]} size={18} style={{ color: 'var(--lp-icon-primary)' }} />
            <span>{accessLabel(access)}</span>
          </div>
          <div className="nc-lib-ts-col members">{tm.membership?.length ?? 0}</div>
        </div>
        {open && (
          <div className="nc-lib-ts-pages">
            {pages.length === 0 && <div className="nc-lib-ts-empty">{t('lp.home.no_pages_inside', 'No pages here')}</div>}
            {pages.map((id) => {
              const b = records.get<BlockRecord>('block', id);
              if (!b) return null;
              return (
                <div
                  key={id}
                  role="button"
                  className="nc-lib-ts-page"
                  onClick={(e) => ((e.metaKey || e.ctrlKey) ? window.open(pageUrl(id), '_blank') : openPage(id))}
                >
                  <PageIcon block={b} size={20} />
                  <span className="nc-ellipsis">{pageTitle(b) || t('lp.home.untitled', 'Untitled')}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="nc-lib-ts">
      <div className="nc-lib-ts-group">
        <div role="button" className="nc-lib-ts-group-head" aria-expanded={mineOpen} onClick={() => setMineOpen(!mineOpen)}>
          <Icon name="libCaretRight" size={12} style={{ transform: mineOpen ? 'rotateZ(90deg)' : 'none', transition: 'transform 200ms ease-out' }} />
          <span>{t('lp.home.your_teams', 'Your teams')}</span>
        </div>
        {mineOpen && (
          <>
            {header}
            {mine.length === 0 && <div className="nc-lib-ts-empty">{t('lp.home.no_teams_joined', 'No teams joined')}</div>}
            {mine.map((tm) => teamRow(tm, false))}
          </>
        )}
      </div>
      <div className="nc-lib-ts-group">
        <div role="button" className="nc-lib-ts-group-head" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
          <Icon name="libCaretRight" size={12} style={{ transform: moreOpen ? 'rotateZ(90deg)' : 'none', transition: 'transform 200ms ease-out' }} />
          <span>{t('lp.home.more_teams_c286', 'More teams')}</span>
        </div>
        {moreOpen && (
          <>
            {more.length > 0 && header}
            {more.length === 0 && <div className="nc-lib-ts-empty">{t('lp.home.no_joinable_teams', 'No joinable teams')}</div>}
            {more.map((tm) => teamRow(tm, true))}
          </>
        )}
      </div>
    </div>
  );
}

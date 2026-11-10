// Workspace shell: sidebar + main frame (topbar + content) + peek + global modals.
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, SpaceRecord, SpaceViewRecord, TeamRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { navigate, openPage, useLocation, spaceDomain } from '../../lib/router.ts';
import { currentSpaceView } from '../../lib/store/session.ts';
import { useSession, type DemoMode } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { records } from '../../lib/store/records.ts';
import { api } from '../../lib/api.ts';
import { Sidebar } from './Sidebar.tsx';
import { Topbar } from './Topbar.tsx';
import { PageView } from '../page/PageView.tsx';
import { PeekPanel } from '../page/PeekPanel.tsx';
import { ChatPage } from '../home/ChatPage.tsx';
import { MeetingsPage } from '../home/MeetingsPage.tsx';
import { LibraryPage } from '../home/LibraryPage.tsx';
import { MarketplacePage } from '../templates/MarketplacePage.tsx';
import { PeoplePage } from '../home/PeoplePage.tsx';
import { MyTasksPage } from '../home/MyTasksPage.tsx';
import { UniqueIdRedirect } from '../database/uniqueIdRoute.tsx';
import { AgentPage } from '../agents/AgentPage.tsx';
import { installPersonHoverDelegation } from '../presence/PersonHoverCard.tsx';
import { GlobalModals } from './GlobalModals.tsx';
import { usePageLoader } from '../page/usePageLoader.ts';
import { disconnectRealtime, setPresencePage, onResync } from '../../lib/store/sync.ts';
import { transactions } from '../../lib/store/transactions.ts';
import { useApplyUserSettings } from '../settings/userSettings.ts';
import { acceptPendingInvite, pendingInvite, rememberInvite } from './invite.ts';
import { clearAddAccountFlag } from './accounts.tsx';
import { getUserPrefs, savePrefs } from '../settings/userSettings.ts';
import { DeveloperBar } from '../settings/DeveloperBar.tsx';
import { DeveloperTools } from '../developer/DeveloperTools.tsx';
import { t } from './i18n.ts';
import './shell.css';

export function Workspace() {
  const { route, peek } = useLocation();
  const spaceId = useSession((s) => s.spaceId);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const sidebarWidth = useUI((s) => s.sidebarWidth);
  const demo = useSession((s) => s.demoMode);

  const pageId = route.name === 'page' ? route.pageId : null;
  const loaded = usePageLoader(pageId);
  useApplyUserSettings();
  useSessionHousekeeping();

  // "/" and "/<domain>" open the start page (Settings › Preferences › Start page: Last visited page / Top page in
  // sidebar / Library / Litpage AI). There is no widget Home page: "Home" is only a sidebar tab.
  // /invite/<code> (or an invite remembered across login) → join that workspace
  useEffect(() => {
    if (route.name === 'invite') rememberInvite(route.code);
    if (route.name === 'invite' || pendingInvite()) void acceptPendingInvite();
  }, [route]);

  useEffect(() => {
    if ((route.name !== 'root' && route.name !== 'home') || !spaceId) return;
    // "/<domain>" of another of my workspaces switches to it first
    if (route.name === 'home' && route.domain && route.domain !== spaceDomain(spaceId)) {
      const other = records.all<SpaceRecord>('space').find((sp) => sp.domain === route.domain);
      if (other && other.id !== spaceId) {
        useSession.getState().setSpace(other.id);
        return;
      }
    }
    openStartPage(spaceId);
  }, [route, spaceId]);

  // switching workspaces through a URL of another workspace's page
  useEffect(() => {
    if (!pageId) return;
    const b = records.get<BlockRecord>('block', pageId);
    if (b && b.space_id !== spaceId && records.get('space', b.space_id)) useSession.getState().setSpace(b.space_id);
    if (b && spaceId) {
      try {
        localStorage.setItem(`nc:lastPage:${spaceId}`, pageId);
      } catch {
        /* ignore */
      }
    }
  }, [pageId, loaded, spaceId]);

  useEffect(() => {
    setPresencePage(pageId);
    if (!pageId) return;
    // record the visit once pending transactions are saved (a brand-new page must exist server-side first),
    // then let the sidebar refresh Recents
    void whenSaved()
      .then(() => api('markPageVisited', { block: { id: pageId, spaceId } }))
      .then(() => window.dispatchEvent(new CustomEvent('nc:page-visited', { detail: { pageId } })))
      .catch(() => {});
  }, [pageId, spaceId]);

  useEffect(() => {
    onResync(() => {
      void useSession.getState().load();
      window.dispatchEvent(new Event('nc:resync'));
    });
  }, []);

  const content = useMemo(() => {
    switch (route.name) {
      case 'page':
        return <PageView key={route.pageId} pageId={route.pageId} state={loaded} />;
      case 'chat':
        return <ChatPage chatId={route.chatId} />;
      case 'meetings':
        return <MeetingsPage />;
      case 'library':
        return <LibraryPage />;
      case 'marketplace':
        return <MarketplacePage tab={route.tab} />;
      case 'people':
        return <PeoplePage userId={route.userId} />;
      case 'tasks':
        return <MyTasksPage />;
      case 'developers':
        return <DeveloperTools tab={route.tab} id={route.id} />;
      case 'uniqueId':
        return <UniqueIdRedirect key={route.uid} uid={route.uid} />;
      case 'agent':
        return <AgentPage key={route.agentId} agentId={route.agentId} />;
      default:
        return null;
    }
  }, [route, loaded]);

  return (
    <div className="lit-app-inner" style={{ ['--sidebar-width' as any]: `${sidebarOpen ? sidebarWidth : 0}px` }}>
      {demo.enabled && <DemoNotice demo={demo} />}
      <div className="lit-cursor-listener">
        <Sidebar />
        <main className="lit-frame">
          <Topbar pageId={pageId} routeName={route.name} />
          <div className="nc-frame-content">{content}</div>
          <DeveloperBar pageId={pageId} />
        </main>
        {peek && <PeekPanel pageId={peek.pageId} mode={peek.mode} />}
      </div>
      <GlobalModals />
    </div>
  );
}

/** Public demo notice bar: a visitor's own sandbox (with "Start over") or the shared account. */
function DemoNotice({ demo }: { demo: DemoMode }) {
  const [busy, setBusy] = useState(false);
  const expires = demo.sandbox?.expires;
  useEffect(() => {
    if (!expires) return;
    // the sandbox and its session end: back to the login page
    const tm = setTimeout(() => location.assign('/'), Math.min(Math.max(expires - Date.now() + 2000, 1000), 2_147_000_000));
    return () => clearTimeout(tm);
  }, [expires]);
  if (!demo.sandbox) return <div className="lp-demo-notice">{demo.resetHours ? tDemo(demo.resetHours) : tDemo()}</div>;
  const startOver = async () => {
    setBusy(true);
    // this tab moves to the new sandbox; other tabs of the old one are signed out
    disconnectRealtime();
    try {
      const res = await api<{ path: string }>('startDemoSandbox');
      location.assign(res.path);
    } catch (e: any) {
      setBusy(false);
      useUI.getState().toast(e?.message || t('lp.auth.the_demo_could_not_start', 'The demo could not start. Try again in a moment.'));
      void useSession.getState().load();
    }
  };
  return (
    <div className="lp-demo-notice">
      <span>{t('lp.shell.demo_sandbox_notice', "Demo sandbox: this workspace is only yours and is deleted {hours} hours after it was created. Don't enter personal information.", { hours: demo.sandboxHours ?? 4 })}</span>
      <button type="button" className="lp-demo-notice-action" disabled={busy} onClick={() => void startOver()}>{t('lp.shell.start_over', 'Start over')}</button>
    </div>
  );
}

function tDemo(hours?: number) {
  return hours
    ? t('lp.shell.public_demo_notice', `Public demo: everyone shares this account and the data resets every ${hours} hours. Don't enter personal information.`, { hours })
    : t('lp.shell.public_demo_notice_no_reset', "Public demo: everyone shares this account. Don't enter personal information.");
}

export type StartPage = 'last_visited' | 'top_page' | 'library' | 'lit_ai';

function alivePage(id: string | null | undefined): boolean {
  const b = id ? records.get<BlockRecord>('block', id) : undefined;
  return !!b && b.alive !== false;
}

/** First page shown in the sidebar (favorites, private, teamspaces, workspace pages). */
export function topSidebarPage(spaceId: string): string | null {
  const sv = currentSpaceView() as SpaceViewRecord | undefined;
  const space = records.get<SpaceRecord>('space', spaceId);
  const teamPages = (sv?.joined_teams ?? []).flatMap((id) => records.get<TeamRecord>('team', id)?.team_pages ?? []);
  const candidates = [...(sv?.bookmarked_pages ?? []), ...(sv?.private_pages ?? []), ...teamPages, ...(space?.pages ?? [])];
  return candidates.find(alivePage) ?? null;
}

export function openStartPage(spaceId: string) {
  const uid = useSession.getState().userId;
  const settings = records.get<UserSettingsRecord>('user_settings', uid)?.settings as { start_page?: StartPage } | undefined;
  const mode: StartPage = settings?.start_page ?? 'last_visited';
  const domain = spaceDomain(spaceId);
  if (mode === 'library') return navigate(`/${domain}/library`, { replace: true });
  if (mode === 'lit_ai') return navigate(`/${domain}/chat`, { replace: true });
  if (mode === 'last_visited') {
    let last: string | null = null;
    try {
      last = localStorage.getItem(`nc:lastPage:${spaceId}`);
    } catch {
      /* ignore */
    }
    const b = last ? records.get<BlockRecord>('block', last) : undefined;
    if (last && (!b || (b.alive !== false && b.space_id === spaceId))) return openPage(last, { replace: true });
  }
  const top = topSidebarPage(spaceId);
  if (top) return openPage(top, { replace: true });
  navigate(`/${domain}/library`, { replace: true });
}

/** Resolves once the transaction outbox is empty (max ~3s). */
async function whenSaved(): Promise<void> {
  void transactions.flush();
  for (let i = 0; i < 60 && transactions.pendingCount() > 0; i++) await new Promise((r) => setTimeout(r, 50));
}

/** Once per app start: report the device time zone (server reminders / digests use it while "Set time zone
 *  automatically" is on), note the session's device (new-login email) and finish an "Add another account" flow. */
function useSessionHousekeeping() {
  const userId = useSession((s) => s.userId);
  useEffect(() => {
    installPersonHoverDelegation();
  }, []);
  useEffect(() => {
    if (!userId) return;
    clearAddAccountFlag();
    void api('noteSessionDevice').catch(() => {});
    const tm = setTimeout(() => {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (tz && getUserPrefs().device_time_zone !== tz) savePrefs({ device_time_zone: tz });
      } catch {
        /* no Intl time zone support */
      }
    }, 1500);
    return () => clearTimeout(tm);
  }, [userId]);
}

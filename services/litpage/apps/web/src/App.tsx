// Root: auth gate → login/onboarding or the workspace shell; global overlay/tooltip/toast layers.
import { useEffect } from 'react';
import { useSession } from './lib/store/session.ts';
import { navigate, useLocation } from './lib/router.ts';
import { OverlayRoot } from './components/overlay.tsx';
import { TooltipLayer } from './components/Tooltip.tsx';
import { ToastLayer } from './components/Modal.tsx';
import { LoginPage } from './features/auth/LoginPage.tsx';
import { OnboardingPage } from './features/auth/OnboardingPage.tsx';
import { Workspace } from './features/shell/Workspace.tsx';
import { NaruBar } from './features/shell/NaruBar.tsx';
import { PublicPage } from './features/page/PublicPage.tsx';
import { PublicFormPage } from './features/database/views/form/PublicFormPage.tsx';
import { SiteRoot } from './features/settings/SiteRoot.tsx';
import { installGlobalShortcuts } from './features/shell/shortcuts.ts';
import { acceptPendingInvite, pendingInvite, rememberInvite } from './features/shell/invite.ts';
import { TeamInvitePage, rememberTeamInvite, takePendingTeamInvite } from './features/shell/access/TeamInvitePage.tsx';
import { installTypingFade } from './lib/store/typing.ts';


function takeAfterLogin(): string | null {
  try {
    const p = sessionStorage.getItem('nc:afterLogin');
    sessionStorage.removeItem('nc:afterLogin');
    return p && /^\/(?![/\\])\S*$/.test(p) && !/^\/(login|signup|onboarding)(?![\w-])/.test(p) ? p : null;
  } catch {
    return null;
  }
}

function rememberAfterLogin(path: string) {
  try {
    sessionStorage.setItem('nc:afterLogin', path);
  } catch {
    
  }
}


const ANONYMOUS_ROUTES = new Set(['public', 'form', 'site']);

export function App() {
  const status = useSession((s) => s.status);
  const { route } = useLocation();

  useEffect(() => {
    void useSession.getState().load();
    installTypingFade();
    return installGlobalShortcuts();
  }, []);

  useEffect(() => {
    // workspace invite links (/invite/<code>) survive the login/onboarding detour
    if (route.name === 'invite') rememberInvite(route.code);
    
    if (route.name === 'teamInvite' && status === 'anonymous') rememberTeamInvite(route.code);
    if ((status === 'ready' || status === 'onboarding') && route.name !== 'teamInvite') {
      const code = takePendingTeamInvite();
      if (code) {
        navigate(`/team-invite/${code}`, { replace: true });
        return;
      }
    }
    if (route.name === 'teamInvite' && (status === 'ready' || status === 'onboarding')) return;
    if (status === 'onboarding' && pendingInvite()) {
      void acceptPendingInvite();
      return;
    }
    if (status === 'anonymous' && !ANONYMOUS_ROUTES.has(route.name)) {
      // NaruWorks: there is no login page; the server sends the browser to the NaruWorks home (which links to /auth/login)
      location.replace('/auth/home');
    }
    if (status === 'onboarding' && route.name !== 'onboarding') navigate('/onboarding', { replace: true });
    if (status === 'ready' && (route.name === 'login' || route.name === 'signup' || route.name === 'onboarding')) navigate(takeAfterLogin() ?? '/', { replace: true });
  }, [status, route.name]);

  let body;
  if (route.name === 'public') body = <PublicPage pageId={route.pageId} />;
  else if (route.name === 'form') body = <PublicFormPage viewId={route.viewId} />;
  else if (route.name === 'site') body = <SiteRoot domain={route.domain} />;
  else if (status === 'loading') body = <div className="nc-boot" />;
  else if (status === 'anonymous') body = <div className="nc-boot" />;
  else if (status === 'error') {
    body = (
      <div className="nc-boot" style={{ display: 'grid', placeContent: 'center', gap: 12, textAlign: 'center' }}>
        <p>Litpage 서버에 연결하지 못했습니다. 로그인 상태는 그대로입니다.</p>
        <button type="button" style={{ justifySelf: 'center', padding: '6px 16px', borderRadius: 8, border: '1px solid currentColor', background: 'transparent', color: 'inherit', cursor: 'pointer' }} onClick={() => void useSession.getState().load()}>다시 시도</button>
      </div>
    );
  }
  else if (route.name === 'teamInvite' && (status === 'ready' || status === 'onboarding')) body = <TeamInvitePage code={route.code} />;
  else if (status === 'onboarding') body = <OnboardingPage />;
  else body = <Workspace />;

  // NaruWorks bar only for signed-in app screens, not shared pages/forms/sites
  const showBar = (status === 'ready' || status === 'onboarding') && !ANONYMOUS_ROUTES.has(route.name);
  return (
    <>
      {showBar && <NaruBar />}
      <div className="naru-main">{body}</div>
      <OverlayRoot />
      <TooltipLayer />
      <ToastLayer />
    </>
  );
}

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


const ANONYMOUS_ROUTES = new Set(['login', 'signup', 'public', 'form', 'site']);

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
      // invite links keep their own detour (above); the bare root has nothing to come back to
      if (route.name !== 'root' && route.name !== 'invite' && route.name !== 'teamInvite') rememberAfterLogin(location.pathname + location.search + location.hash);
      navigate('/login', { replace: true });
    }
    if (status === 'onboarding' && route.name !== 'onboarding') navigate('/onboarding', { replace: true });
    if (status === 'ready' && (route.name === 'login' || route.name === 'signup' || route.name === 'onboarding')) navigate(takeAfterLogin() ?? '/', { replace: true });
  }, [status, route.name]);

  let body;
  if (route.name === 'public') body = <PublicPage pageId={route.pageId} />;
  else if (route.name === 'form') body = <PublicFormPage viewId={route.viewId} />;
  else if (route.name === 'site') body = <SiteRoot domain={route.domain} />;
  else if (status === 'loading') body = <div className="nc-boot" />;
  else if (status === 'anonymous') body = <LoginPage mode={route.name === 'signup' ? 'signup' : 'login'} />;
  else if (route.name === 'teamInvite' && (status === 'ready' || status === 'onboarding')) body = <TeamInvitePage code={route.code} />;
  else if (status === 'onboarding') body = <OnboardingPage />;
  else body = <Workspace />;

  return (
    <>
      {body}
      <OverlayRoot />
      <TooltipLayer />
      <ToastLayer />
    </>
  );
}

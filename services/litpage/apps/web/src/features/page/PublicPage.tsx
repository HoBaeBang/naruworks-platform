// Published page (/public/<slug-id> or /public/<custom short link>): read-only page
// without workspace chrome. The site's settings (Site customization) shape it: theme (light / dark / system), header
// (breadcrumbs, search across the site's pages, share, navigation links, "Get Litpage for free"), share preview / SEO
// (<title>, description, og:* tags, robots noindex unless "Search engine indexing" is on), favicon and Google Analytics
// (only on real hosts). "Duplicate" (Duplicate as template → visitor's Private pages; login first). `?embed=1` renders
// just the page for iframes ("Embed this page"). Works signed out (public_permission grants read).
import { useEffect, useRef, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';
import { navigate, spaceDomain } from '../../lib/router.ts';
import { compactId } from '@nc/shared/ids.ts';
import { useSession } from '../../lib/store/session.ts';
import { useUI } from '../../lib/store/ui.ts';
import { Icon } from '../../components/Icon.tsx';
import { PageIcon } from '../shell/PageIcon.tsx';
import { t } from '../shell/i18n.ts';
import { usePageLoader } from './usePageLoader.ts';
import { PageView } from './PageView.tsx';
import { pageTitle } from './pageActions.ts';
import type { SiteSettingsValue } from './SiteSettings.tsx';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { startPageComment } from '../comments/comments.tsx';

interface PublicInfo {
  pageId: string;
  role: string;
  published: boolean;
  siteRootId: string | null;
  allowDuplicate: boolean;
  searchIndexing?: boolean;
  spaceName: string;
  breadcrumb: { id: string; title: string; icon: string | null }[];
  loggedIn: boolean;
  isMember: boolean;
}

interface SiteInfo {
  pageId: string;
  rootId: string | null;
  published: boolean;
  settings: SiteSettingsValue | null;
  indexing: boolean;
  allowDuplicate: boolean;
  siteTitle: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Set (or remove) a <meta> / <link> in <head>; returns an undo function. */
function headTag(selector: string, create: () => HTMLElement, attrs: Record<string, string> | null): () => void {
  const existing = document.head.querySelector<HTMLElement>(selector);
  const prev = existing ? [...existing.attributes].map((x) => [x.name, x.value] as const) : null;
  if (!attrs) {
    if (!existing) return () => {};
    existing.remove();
    return () => { document.head.appendChild(existing); };
  }
  const el = existing ?? create();
  if (!existing) document.head.appendChild(el);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return () => {
    if (!existing) el.remove();
    else {
      for (const x of [...el.attributes]) el.removeAttribute(x.name);
      for (const [k, v] of prev ?? []) el.setAttribute(k, v);
    }
  };
}

const meta = (name: string, content: string | undefined, prop = false) =>
  headTag(`meta[${prop ? 'property' : 'name'}="${name}"]`, () => document.createElement('meta'), content === undefined ? null : { [prop ? 'property' : 'name']: name, content });

function faviconHref(fav: string | undefined, root: BlockRecord | undefined): string | null {
  const icon = !fav || fav === 'page_icon' ? (root?.format?.page_icon as string | undefined) : fav === 'litpage' ? undefined : fav;
  if (fav === 'litpage') return '/favicon.svg'; // the site’s own self-drawn mark
  if (!icon) return null;
  if (/^(https?:|\/files\/)/.test(icon)) return icon;
  if (icon.startsWith('lit-icon')) return null;
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">${icon}</text></svg>`)}`;
}

/** Site theme while the public page is open (restores the visitor's own theme afterwards). */
function useSiteTheme(theme: SiteSettingsValue['theme'] | undefined) {
  useEffect(() => {
    if (!theme || theme === 'system') return;
    const el = document.documentElement;
    const apply = (dark: boolean) => {
      el.classList.toggle('lit-dark-theme', dark);
      el.classList.toggle('lit-light-theme', !dark);
      document.body?.classList.toggle('dark', dark);
    };
    apply(theme === 'dark');
    return () => {
      const own = useUI.getState().theme;
      apply(own === 'dark' || (own === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches));
    };
  }, [theme]);
}

export function PublicPage({ pageId: routeId }: { pageId: string }) {
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [site, setSite] = useState<SiteInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const status = useSession((s) => s.status);
  const embed = new URLSearchParams(location.search).get('embed') === '1';
  // custom short links resolve to the site's root page
  const [pageId, setPageId] = useState<string | null>(UUID.test(routeId) ? routeId : null);

  useEffect(() => {
    let alive = true;
    setMissing(false);
    void api<SiteInfo & { recordMap: any }>('getSite', { slugOrId: routeId }).then((res) => {
      if (!alive) return;
      records.mergeRecordMap(res.recordMap);
      setSite(res);
      setPageId(res.pageId);
    }).catch(() => { if (alive) setMissing(true); });
    return () => { alive = false; };
  }, [routeId, status]);

  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    void api('getPublishedPage', { pageId }).then((res) => {
      if (!alive) return;
      records.mergeRecordMap(res.recordMap);
      setInfo(res);
    }).catch(() => alive && setMissing(true));
    return () => { alive = false; };
  }, [pageId, status]);
  const state = usePageLoader(missing || !pageId ? null : pageId);
  const settings = site?.settings ?? null;
  useSiteTheme(settings?.theme);

  // <head>: title, description, social preview, robots, favicon
  const page = pageId ? records.get<BlockRecord>('block', pageId) : undefined;
  const root = site?.rootId ? records.get<BlockRecord>('block', site.rootId) : undefined;
  const docTitle = page ? (page.id === site?.rootId && settings?.title ? settings.title : pageTitle(page) || 'Untitled') : 'Litpage';
  useEffect(() => {
    document.title = docTitle;
  });
  const headKey = JSON.stringify([docTitle, settings?.description, settings?.image, settings?.favicon, site?.indexing, root?.format?.page_icon]);
  useEffect(() => {
    if (!site?.published) return;
    const undo = [
      meta('description', settings?.description),
      meta('og:title', docTitle, true),
      meta('og:description', settings?.description, true),
      meta('og:image', settings?.image ? new URL(settings.image, location.origin).href : undefined, true),
      meta('twitter:card', settings?.image ? 'summary_large_image' : 'summary'),
      meta('robots', site.indexing ? undefined : 'noindex, nofollow'),
    ];
    const href = faviconHref(settings?.favicon, root);
    if (href) undo.push(headTag('link[rel="icon"]', () => Object.assign(document.createElement('link'), { rel: 'icon' }), { rel: 'icon', href }));
    return () => undo.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headKey, site?.published]);

  // Google Analytics: only for a real host (local / test servers never call out)
  useEffect(() => {
    const id = settings?.ga;
    if (!id || !/^[A-Za-z0-9-]+$/.test(id) || /^(localhost|127\.|\[::1\])/.test(location.hostname)) return;
    if (document.querySelector(`script[data-nc-ga="${id}"]`)) return;
    const s = document.createElement('script');
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    s.dataset.ncGa = id;
    document.head.appendChild(s);
    const w = window as unknown as { dataLayer: unknown[]; gtag?: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    w.gtag = function gtag() { w.dataLayer.push(arguments); };
    w.gtag('js', new Date());
    w.gtag('config', id);
  }, [settings?.ga]);

  if (missing) {
    return (
      <div className="nc-public-page">
        <div className="nc-public-message">
          <div className="title">We couldn’t find this page</div>
          <div className="sub">The page may not be published, or the link may have expired.</div>
          <button className="nc-dialog-btn outline" onClick={() => navigate('/')}>{t('lp.page.open_litpage', 'Open Litpage')}</button>
        </div>
      </div>
    );
  }
  if (!pageId) return <div className="nc-public-page" />;

  const duplicate = async () => {
    if (status !== 'ready') {
      try {
        sessionStorage.setItem('nc:afterLogin', location.pathname);
      } catch {
        /* ignore */
      }
      navigate('/login');
      return;
    }
    try {
      const res = await api('duplicatePublicPage', { pageId, spaceId: useSession.getState().spaceId });
      useUI.getState().toast('Duplicated to your Private pages');
      await useSession.getState().load();
      if (res.blockId) navigate(`/${spaceDomain(res.spaceId)}/${compactId(res.blockId)}`);
    } catch (e: any) {
      useUI.getState().toast(e?.message ?? 'Couldn’t duplicate this page');
    }
  };

  // comments: signed-out visitors log in first and come back to this page
  const canComment = roleAtLeast(records.role('block', pageId) ?? 'none', 'comment_only');
  const comment = () => {
    if (status !== 'ready') {
      try {
        sessionStorage.setItem('nc:afterLogin', location.pathname);
      } catch {
        /* ignore */
      }
      navigate('/login');
      return;
    }
    startPageComment(pageId);
    requestAnimationFrame(() => document.querySelector(`[data-page-discussions="${pageId}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  };

  const header = settings?.header;
  const showCrumbs = header?.breadcrumbs !== false;
  const links = (header?.links ?? []).map((l) => records.get<BlockRecord>('block', l.pageId)).filter((b): b is BlockRecord => !!b);
  if (embed) {
    return (
      <div className="nc-public-page lit-public-page nc-public-embed">
        <PageView pageId={pageId} state={state} inPeek publicView />
      </div>
    );
  }
  return (
    <div className="nc-public-page lit-public-page">
      <div className="nc-public-topbar">
        <div className="crumbs">
          {showCrumbs && (info?.breadcrumb ?? []).map((c, i, arr) => (
            <span key={c.id} style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
              <div role="button" className="nc-crumb" onClick={() => c.id !== pageId && navigate(`/public/${c.id === site?.rootId && settings?.slug ? settings.slug : c.id.replace(/-/g, '')}`)}>
                {c.icon && <PageIcon icon={c.icon} size={18} />}
                <span className="nc-ellipsis" style={{ maxWidth: 240, marginInlineStart: c.icon ? 6 : 0 }}>{c.title || 'Untitled'}</span>
              </div>
              {i < arr.length - 1 && <span className="sep">/</span>}
            </span>
          ))}
        </div>
        {links.length > 0 && (
          <nav className="nc-public-nav" aria-label="Site navigation">
            {links.map((b) => (
              <div key={b.id} role="link" className={`nc-public-nav-link ${b.id === pageId ? 'current' : ''}`} onClick={() => navigate(`/public/${b.id === site?.rootId && settings?.slug ? settings.slug : b.id.replace(/-/g, '')}`)}>
                <PageIcon block={b} size={16} />
                <span className="nc-ellipsis">{pageTitle(b) || 'Untitled'}</span>
              </div>
            ))}
          </nav>
        )}
        {header?.search !== false && site?.published && <SiteSearch pageId={pageId} rootSlug={settings?.slug} rootId={site?.rootId ?? null} />}
        {header?.share && (
          <div role="button" className="nc-icon-btn" aria-label={t('lp.page.share', 'Share')} data-tooltip={t('lp.page.let_visitors_share_your_site', 'Let visitors share your site')}
            onClick={() => { void navigator.clipboard?.writeText(location.href); useUI.getState().toast('Link copied'); }}>
            <Icon name="link" size={16} />
          </div>
        )}
        {/* links that let anyone on the web comment get a "Comment" button */}
        {canComment && (
          <button className="nc-dialog-btn outline small nc-public-comment-btn" aria-label={t('lp.page.comment', 'Comment')} data-tooltip={t('lp.page.comment', 'Comment')} onClick={() => comment()}>
            <Icon name="comment" size={16} />
            {t('lp.page.comment', 'Comment')}
          </button>
        )}
        {(info?.allowDuplicate || site?.allowDuplicate) && (
          <button className="nc-dialog-btn outline small" aria-label={t('lp.page.duplicate', 'Duplicate')} data-tooltip={t('lp.page.duplicate', 'Duplicate')} onClick={() => void duplicate()}>
            <Icon name="duplicate" size={16} />
            {t('lp.page.duplicate', 'Duplicate')}
          </button>
        )}
        {status !== 'ready' && header?.signup !== false && (
          <button className="nc-dialog-btn outline small" onClick={() => navigate('/login')}>{t('lp.page.get_litpage_for_free', 'Get Litpage for free')}</button>
        )}
      </div>
      <PageView pageId={pageId} state={state} inPeek publicView />
    </div>
  );
}

/** Header search: pages of the published site that match. */
function SiteSearch({ pageId, rootId, rootSlug }: { pageId: string; rootId: string | null; rootSlug?: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<{ id: string; title: string; text: string; icon: string | null }[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const timer = setTimeout(() => {
      void api<{ results: typeof results }>('searchSite', { pageId, query: q }).then((r) => setResults(r.results)).catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [q, pageId]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);
  if (!open) {
    return (
      <div role="button" className="nc-icon-btn" aria-label={t('lp.page.search', 'Search')} data-tooltip={t('lp.page.search', 'Search')} onClick={() => setOpen(true)}>
        <Icon name="search" size={16} />
      </div>
    );
  }
  return (
    <div className="nc-public-search" ref={box}>
      <div className="nc-input">
        <Icon name="search" size={14} style={{ color: 'var(--lp-icon-secondary)' }} />
        <input autoFocus placeholder={t('lp.page.search_this_site', 'Search this site')} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }} />
      </div>
      {q.trim() && (
        <div className="nc-public-search-results" role="listbox">
          {results.length === 0 && <div className="empty">{t('lp.page.no_matching_pages', 'No pages match')}</div>}
          {results.map((r) => (
            <div key={r.id} role="option" aria-selected={false} className="row" onClick={() => { setOpen(false); navigate(`/public/${r.id === rootId && rootSlug ? rootSlug : r.id.replace(/-/g, '')}`); }}>
              {r.icon ? <PageIcon icon={r.icon} size={16} /> : <Icon name="page" size={16} style={{ color: 'var(--lp-icon-secondary)' }} />}
              <div className="txt">
                <div className="ttl nc-ellipsis">{r.title}</div>
                {r.text && r.text !== r.title && <div className="snip nc-ellipsis">{r.text}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

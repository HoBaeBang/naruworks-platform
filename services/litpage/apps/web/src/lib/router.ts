
//   /login, /signup, /onboarding
//   /<domain>                    workspace home
//   /<domain>/<Title-Slug-32hex> page (query ?p=<32hex>&pm=s|c opens a peek)

//   /<domain>/chat | meetings | library[/<tab>] | marketplace[/<tab>] | people[/<userId>] | tasks | developers[/<tab>[/<id>]]
//   /public/<32hex>              published page
//   /form/<32hex>                form share link (view id of a form view)

//   /agent/<32hex>               Custom Agent page (features/agents/AgentPage.tsx)
import { useSyncExternalStore } from 'react';
import { compactId, expandId, idFromSlug, pageSlug } from '@nc/shared/ids.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import type { BlockRecord, SpaceRecord } from '@nc/shared/records.ts';
import { records } from './store/records.ts';

export type Route =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'onboarding' }
  | { name: 'root' }
  | { name: 'home'; domain: string }
  | { name: 'page'; domain: string; pageId: string }
  | { name: 'chat'; domain: string; chatId?: string }
  | { name: 'meetings'; domain: string }
  | { name: 'library'; domain: string; tab?: string }
  | { name: 'marketplace'; domain: string; tab?: string }
  | { name: 'people'; domain: string; userId?: string }
  | { name: 'tasks'; domain: string }
  
  | { name: 'developers'; domain: string; tab?: string; id?: string }
  | { name: 'uniqueId'; domain: string; uid: string }
  | { name: 'public'; pageId: string }
  | { name: 'form'; viewId: string }
  | { name: 'site'; domain: string }
  | { name: 'invite'; code: string }
  | { name: 'teamInvite'; code: string }
  | { name: 'agent'; agentId: string }
  | { name: 'notfound' };

export interface Location {
  route: Route;
  peek: { pageId: string; mode: 'side_peek' | 'center_peek' } | null;
  hash: string;
}

const SPECIAL = new Set(['chat', 'meetings', 'library', 'marketplace', 'people', 'tasks', 'developers']);

export function parseLocation(pathname: string, search: string, hash: string): Location {
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  const q = new URLSearchParams(search);
  const p = q.get('p');
  const pm = q.get('pm');
  const peek = p ? { pageId: expandId(p), mode: pm === 'c' ? ('center_peek' as const) : ('side_peek' as const) } : null;
  let route: Route;
  if (parts.length === 0) route = { name: 'root' };
  else if (parts[0] === 'login') route = { name: 'login' };
  else if (parts[0] === 'signup') route = { name: 'signup' };
  else if (parts[0] === 'onboarding') route = { name: 'onboarding' };
  else if (parts[0] === 'public' && parts[1]) route = { name: 'public', pageId: expandId(idFromSlug(parts[1]) ?? parts[1]) };
  else if (parts[0] === 'invite' && parts[1]) route = { name: 'invite', code: parts[1] };
  else if (parts[0] === 'team-invite' && parts[1]) route = { name: 'teamInvite', code: parts[1] };
  else if (parts[0] === 'form' && parts[1]) route = { name: 'form', viewId: expandId(parts[1]) };
  else if (parts[0] === 'site' && parts[1]) route = { name: 'site', domain: parts[1].toLowerCase() };
  else if (parts[0] === 'agent' && parts[1] && /^[0-9a-f]{32}$/i.test(parts[1].replace(/-/g, ''))) route = { name: 'agent', agentId: expandId(parts[1]) };
  else if (parts.length === 1) {
    const id = idFromSlug(parts[0]);
    route = id ? { name: 'page', domain: '', pageId: id } : { name: 'home', domain: parts[0] };
  } else if (SPECIAL.has(parts[1])) {
    const domain = parts[0];
    if (parts[1] === 'chat') route = { name: 'chat', domain, chatId: parts[2] };
    else if (parts[1] === 'meetings') route = { name: 'meetings', domain };
    else if (parts[1] === 'marketplace') route = { name: 'marketplace', domain, tab: parts[2] };
    else if (parts[1] === 'people') route = { name: 'people', domain, userId: parts[2] };
    else if (parts[1] === 'tasks') route = { name: 'tasks', domain };
    else if (parts[1] === 'developers') route = { name: 'developers', domain, tab: parts[2], id: parts[3] };
    else route = { name: 'library', domain, tab: parts[2] };
  } else {
    const id = idFromSlug(parts[parts.length - 1]);
    
    const uid = !id && parts.length === 2 && /^[A-Za-z][A-Za-z0-9-]{0,9}-\d{1,9}$/.test(parts[1]) ? parts[1] : null;
    route = id ? { name: 'page', domain: parts[0], pageId: id } : uid ? { name: 'uniqueId', domain: parts[0], uid } : { name: 'notfound' };
  }
  return { route, peek, hash: hash.replace(/^#/, '') };
}

let current = parseLocation(location.pathname, location.search, location.hash);
const listeners = new Set<() => void>();

function emit() {
  current = parseLocation(location.pathname, location.search, location.hash);
  for (const fn of listeners) fn();
}
window.addEventListener('popstate', emit);

export function navigate(url: string, opts?: { replace?: boolean }) {
  const target = new URL(url, location.origin);
  const same = target.pathname === location.pathname && target.search === location.search && target.hash === location.hash;
  if (same) return;
  if (opts?.replace) history.replaceState(null, '', target.pathname + target.search + target.hash);
  else history.pushState(null, '', target.pathname + target.search + target.hash);
  emit();
}

export function useLocation(): Location {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
}

export function getLocation() {
  return current;
}

export function spaceDomain(spaceId: string | null | undefined): string {
  return records.get<SpaceRecord>('space', spaceId)?.domain ?? 'workspace';
}


export function pageUrl(pageId: string, opts?: { blockId?: string }): string {
  const b = records.get<BlockRecord>('block', pageId);
  const title = toPlainText(b?.properties?.title);
  const hash = opts?.blockId ? `#${compactId(opts.blockId)}` : '';
  // inside a published site (/public/…) links stay on the public site
  if (current.route.name === 'public') return `/public/${pageSlug(title, pageId)}${hash}`;
  const domain = spaceDomain(b?.space_id);
  return `/${domain}/${pageSlug(title, pageId)}${hash}`;
}

export function openPage(pageId: string, opts?: { blockId?: string; newTab?: boolean; replace?: boolean }) {
  const url = pageUrl(pageId, opts);
  if (opts?.newTab) window.open(url, '_blank');
  else navigate(url, { replace: opts?.replace });
}

export function peekUrl(pageId: string, mode: 'side_peek' | 'center_peek'): string {
  const u = new URL(location.href);
  u.searchParams.set('p', compactId(pageId));
  u.searchParams.set('pm', mode === 'center_peek' ? 'c' : 's');
  return u.pathname + u.search;
}

export function openPeek(pageId: string, mode: 'side_peek' | 'center_peek' = 'side_peek') {
  navigate(peekUrl(pageId, mode));
}

export function closePeek() {
  const u = new URL(location.href);
  u.searchParams.delete('p');
  u.searchParams.delete('pm');
  navigate(u.pathname + u.search + u.hash);
}

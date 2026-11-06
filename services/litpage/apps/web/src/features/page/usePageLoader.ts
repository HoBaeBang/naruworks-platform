// Loads a page's record chunk (blocks, collections, views, users) once per page id; refreshes on resync.
import { useEffect, useState } from 'react';
import { api } from '../../lib/api.ts';
import { records } from '../../lib/store/records.ts';

const loadedPages = new Map<string, Promise<boolean>>();

export function loadPage(pageId: string, force = false): Promise<boolean> {
  if (!force && loadedPages.has(pageId)) return loadedPages.get(pageId)!;
  const p = api('loadPage', { pageId })
    .then((res) => {
      records.mergeRecordMap(res.recordMap);
      return !!res.recordMap?.block?.[pageId];
    })
    .catch(() => false);
  loadedPages.set(pageId, p);
  p.then((ok) => { if (!ok) loadedPages.delete(pageId); });
  return p;
}

export function invalidatePage(pageId: string) {
  loadedPages.delete(pageId);
}

/** Returns 'loading' | 'ok' | 'missing'. Uses cached records immediately when present. */
export function usePageLoader(pageId: string | null): 'loading' | 'ok' | 'missing' {
  const [state, setState] = useState<'loading' | 'ok' | 'missing'>(() => (pageId && records.get('block', pageId) ? 'ok' : 'loading'));
  useEffect(() => {
    if (!pageId) return;
    let alive = true;
    if (!records.get('block', pageId)) setState('loading');
    void loadPage(pageId).then((ok) => {
      if (alive) setState(ok || records.get('block', pageId) ? 'ok' : 'missing');
    });
    const onResync = () => void loadPage(pageId, true);
    window.addEventListener('nc:resync', onResync);
    return () => {
      alive = false;
      window.removeEventListener('nc:resync', onResync);
    };
  }, [pageId]);
  return state;
}

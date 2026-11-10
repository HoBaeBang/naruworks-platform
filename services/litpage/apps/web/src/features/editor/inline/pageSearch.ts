// Page search used by the "@", "[[", "+" menus, the link popup and page pickers:
// empty query → recent page visits ("Recents"), otherwise the workspace search API (title + content, Korean trigram).
import { useEffect, useState } from 'react';
import type { BlockRecord } from '@nc/shared/records.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { ancestorsOf } from '../../../lib/blocks.ts';
import { pageTitle } from '../../page/pageActions.ts';

export interface PageHits {
  ids: string[];
  total: number;
  loading: boolean;
}

export function usePageSearch(q: string, opts?: { limit?: number; exclude?: string[] }): PageHits {
  const spaceId = useSession((s) => s.spaceId);
  const [state, setState] = useState<PageHits>({ ids: [], total: 0, loading: true });
  const limit = opts?.limit ?? 20;
  const exclude = (opts?.exclude ?? []).join(',');
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    const t = setTimeout(async () => {
      try {
        const query = q.trim();
        const res = query ? await api('searchWorkspace', { query, spaceId, limit: 60 }) : await api('listRecentPages', { spaceId, limit: 12 });
        if (!alive) return;
        records.mergeRecordMap(res.recordMap);
        const ex = new Set(exclude ? exclude.split(',') : []);
        const all: string[] = (query ? res.results.map((r: any) => r.id) : res.pages.map((p: any) => p.id)).filter((id: string) => !ex.has(id));
        setState({ ids: all.slice(0, limit), total: all.length, loading: false });
      } catch {
        if (alive) setState({ ids: [], total: 0, loading: false });
      }
    }, q ? 120 : 0);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, spaceId, limit, exclude]);
  return state;
}

/** “Parent / … / Grandparent” breadcrumb shown under a page result. */
export function breadcrumbOf(pageId: string): string {
  const anc = ancestorsOf(pageId).map((b: BlockRecord) => pageTitle(b) || 'Untitled');
  if (!anc.length) return '';
  if (anc.length <= 2) return anc.join(' / ');
  return `${anc[0]} / … / ${anc[anc.length - 1]}`;
}

export function pageOrNull(id: string): BlockRecord | undefined {
  return records.get<BlockRecord>('block', id);
}

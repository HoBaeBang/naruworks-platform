// Rows for the Library tabs (Recents / Favorites / Shared / Private / AI Meeting Notes) plus lazy loading of
// sub-page records (row toggles) and missing parents/users (Source / Created by columns).
import { useEffect, useMemo, useState } from 'react';
import type { BlockRecord, CollectionRecord, TeamRecord } from '@nc/shared/records.ts';
import { PAGE_LIKE } from '@nc/shared/blocks.ts';
import { api } from '../../../lib/api.ts';
import { records } from '../../../lib/store/records.ts';
import { useSession } from '../../../lib/store/session.ts';
import { useCurrentSpace, useCurrentSpaceView, useTableVersion } from '../../../lib/hooks.ts';
import { isSharedPage, refreshSharedWithMe, useSidebarData } from '../../shell/sidebar/Sections.tsx';
import { pageTitle } from '../../page/pageActions.ts';
import type { PageTab, Row } from './model.ts';

function alive(id: string): boolean {
  const b = records.get<BlockRecord>('block', id);
  return !!b && b.alive !== false;
}

const MEETING_TITLE = /^(ai\s+)?meeting\s+notes?\b|회의록|ai\s*노트/i;

export function isMeetingNotePage(b: BlockRecord | undefined): boolean {
  if (!b || b.type !== 'page' || b.alive === false) return false;
  if (MEETING_TITLE.test(pageTitle(b).trim())) return true;
  return (b.content ?? []).some((id) => {
    const c = records.get<BlockRecord>('block', id);
    return !!c && ((c.type as string) === 'meeting_notes' || (c.type as string) === 'transcription');
  });
}

/** Recently visited pages with their visit time (shared by the Recents tab). */
export function useRecentVisits(enabled = true): { rows: Row[]; loaded: boolean } {
  const spaceId = useSession((s) => s.spaceId);
  const [state, setState] = useState<{ rows: Row[]; loaded: boolean }>({ rows: [], loaded: false });
  useEffect(() => {
    if (!spaceId || !enabled) return;
    let live = true;
    const load = () =>
      api('listRecentPages', { spaceId, limit: 100 })
        .then((res) => {
          if (!live) return;
          records.mergeRecordMap(res.recordMap);
          setState({ rows: (res.pages as { id: string; visitedAt: number }[]).map((p) => ({ id: p.id, visitedAt: p.visitedAt })), loaded: true });
        })
        .catch(() => live && setState((s) => ({ ...s, loaded: true })));
    void load();
    window.addEventListener('nc:resync', load);
    return () => {
      live = false;
      window.removeEventListener('nc:resync', load);
    };
  }, [spaceId, enabled]);
  return state;
}

/** AI meeting notes (server query + anything already in the record cache). */
export function useMeetingNotes(enabled = true): { rows: Row[]; loaded: boolean } {
  const spaceId = useSession((s) => s.spaceId);
  const ver = useTableVersion(['block']);
  const [serverIds, setServerIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!spaceId || !enabled) return;
    let live = true;
    void api('getLibraryMeetingNotes', { spaceId })
      .then((res) => {
        if (!live) return;
        records.mergeRecordMap(res.recordMap);
        setServerIds(res.pageIds ?? []);
        setLoaded(true);
      })
      .catch(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [spaceId, enabled]);
  const rows = useMemo(() => {
    if (!enabled) return [];
    const local = records.all<BlockRecord>('block').filter((b) => b.space_id === spaceId && isMeetingNotePage(b)).map((b) => b.id);
    const ids = [...new Set([...serverIds, ...local])].filter(alive);
    ids.sort((a, b) => (records.get<BlockRecord>('block', b)?.created_time ?? 0) - (records.get<BlockRecord>('block', a)?.created_time ?? 0));
    return ids.map((id) => ({ id }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverIds, spaceId, ver, enabled]);
  return { rows, loaded };
}

/** Natural (unsorted) rows for a page tab. */
export function useLibraryRows(tab: PageTab): { rows: Row[]; loaded: boolean } {
  const sv = useCurrentSpaceView();
  const space = useCurrentSpace();
  const uid = useSession((s) => s.userId) ?? '';
  const spaceId = useSession((s) => s.spaceId);
  const ver = useTableVersion(['block']);
  const sharedWithMe = useSidebarData((s) => s.sharedWithMe);
  const recents = useRecentVisits(tab === 'recents');
  const meetings = useMeetingNotes(tab === 'meetings');
  useEffect(() => {
    if (tab === 'shared') refreshSharedWithMe(spaceId);
  }, [tab, spaceId]);

  const rows = useMemo((): Row[] => {
    const byEdited = (ids: string[]) =>
      [...ids].sort((a, b) => (records.get<BlockRecord>('block', b)?.last_edited_time ?? 0) - (records.get<BlockRecord>('block', a)?.last_edited_time ?? 0));
    switch (tab) {
      case 'recents':
        return recents.rows.filter((r) => alive(r.id));
      case 'favorites':
        return (sv?.bookmarked_pages ?? []).filter(alive).map((id) => ({ id }));
      case 'private':
        return (sv?.private_pages ?? []).filter((id) => alive(id) && !isSharedPage(records.get<BlockRecord>('block', id), uid)).map((id) => ({ id }));
      case 'shared': {
        const fromPrivate = (sv?.private_pages ?? []).filter((id) => alive(id) && isSharedPage(records.get<BlockRecord>('block', id), uid));
        const workspace = (space?.pages ?? []).filter(alive);
        return byEdited([...new Set([...fromPrivate, ...workspace, ...sharedWithMe.filter(alive)])]).map((id) => ({ id }));
      }
      case 'meetings':
        return meetings.rows;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sv, space, uid, sharedWithMe, recents.rows, meetings.rows, ver]);

  const loaded = tab === 'recents' ? recents.loaded : tab === 'meetings' ? meetings.loaded : true;
  return { rows, loaded };
}

// ---------------- lazy loading ----------------
const requestedChildren = new Set<string>();
const requestedMeta = new Set<string>();

/** Outline (sub-page) children of a page, in order. */
export function subPages(b: BlockRecord | undefined): string[] {
  if (!b || b.type === 'collection_view_page' || b.type === 'collection_view') return [];
  return (b.content ?? []).filter((id) => {
    const c = records.get<BlockRecord>('block', id);
    return !!c && c.alive !== false && (PAGE_LIKE.has(c.type) || c.type === 'collection_view');
  });
}

/** Load sub-page records (for ▶ toggles) and missing parents/users for the visible rows, in batches. */
export function useLibraryPrefetch(ids: string[]) {
  const key = ids.join(',');
  useEffect(() => {
    const needChildren: string[] = [];
    const needMeta: string[] = [];
    for (const id of ids) {
      const b = records.get<BlockRecord>('block', id);
      if (!b) continue;
      if (!requestedChildren.has(id) && b.type === 'page' && (b.content ?? []).some((c) => !records.has('block', c))) {
        requestedChildren.add(id);
        needChildren.push(id);
      }
      const parentMissing =
        (b.parent_table === 'block' && !records.has('block', b.parent_id)) ||
        (b.parent_table === 'collection' && !records.get<CollectionRecord>('collection', b.parent_id)) ||
        (b.parent_table === 'team' && !records.get<TeamRecord>('team', b.parent_id)) ||
        !records.has('lit_user', b.created_by_id);
      if (parentMissing && !requestedMeta.has(id)) {
        requestedMeta.add(id);
        needMeta.push(id);
      }
    }
    for (let i = 0; i < needChildren.length; i += 100) {
      void api('getSidebarChildren', { blockIds: needChildren.slice(i, i + 100) })
        .then((res) => records.mergeRecordMap(res.recordMap))
        .catch(() => {});
    }
    for (let i = 0; i < needMeta.length; i += 300) {
      void api('getLibraryPageMeta', { pageIds: needMeta.slice(i, i + 300) })
        .then((res) => records.mergeRecordMap(res.recordMap))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

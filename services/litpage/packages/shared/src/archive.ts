// Page archive: `•••` › Archive marks a page or database as archived instead of
// deleting it. The flag lives on the archived page itself — `archived_time` + `archived_by` (like a teamspace's
// `archived_by`); everything below it is archived through that ancestor ("This page is archived because it is inside
// {page}"), so unarchiving the top page brings the whole subtree back. Archived pages keep their links, mentions and
// history; they are hidden from the sidebar, database views and search unless a filter asks for them.
import type { BlockRecord, CollectionRecord, TeamRecord } from './records.ts';

type Lookup = {
  block: (id: string) => BlockRecord | undefined;
  collection?: (id: string) => CollectionRecord | undefined;
  team?: (id: string) => TeamRecord | undefined;
};

/** The record itself carries the archive flag. */
export function isArchivedRecord(b: { [key: string]: unknown } | undefined | null): boolean {
  const t = b?.archived_time;
  return typeof t === 'number' && t > 0;
}

export interface ArchiveState {
  /** the archived page (the block itself when `direct`) */
  root?: BlockRecord;
  /** archived because of an archived teamspace */
  team?: TeamRecord;
  direct: boolean;
}

/** Why `blockId` is archived (itself, an ancestor page/database, or its teamspace), or null. */
export function archiveStateOf(lookup: Lookup, blockId: string | undefined | null): ArchiveState | null {
  let cur = blockId ? lookup.block(blockId) : undefined;
  const start = cur;
  for (let i = 0; i < 200 && cur; i++) {
    if (isArchivedRecord(cur)) return { root: cur, direct: cur === start };
    if (cur.parent_table === 'block') cur = lookup.block(cur.parent_id);
    else if (cur.parent_table === 'collection') {
      const col = lookup.collection?.(cur.parent_id);
      cur = col ? lookup.block(col.parent_id) : undefined;
    } else if (cur.parent_table === 'team') {
      const team = lookup.team?.(cur.parent_id);
      return team && team.archived_by ? { team, direct: false } : null;
    } else return null;
  }
  return null;
}

export function isArchived(lookup: Lookup, blockId: string | undefined | null): boolean {
  return !!archiveStateOf(lookup, blockId);
}

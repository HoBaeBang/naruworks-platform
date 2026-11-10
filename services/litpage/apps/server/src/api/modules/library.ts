// Library page data that the client's record cache may not hold yet:
//  - getLibraryMeetingNotes: pages that are AI meeting notes (contain a meeting_notes/transcription block, or are
//    titled "Meeting notes …") for the "AI Meeting Notes" tab and the Meetings page.
//  - getLibraryPageMeta: users + parents (Source column) for a set of pages.
import type { BlockRecord, CollectionRecord, TeamRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { db, getRecord } from '../../db.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { RecordMapBuilder, blockRole } from '../../records.ts';

type Handler = (ctx: Ctx, body: any) => any;

function requireUser(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

const MEETING_TITLE = /^(ai\s+)?meeting\s+notes?\b|회의록|ai\s*노트/i;

/** The page a block lives on (walks up through non-page parents). */
function pageOfBlock(b: BlockRecord | undefined): BlockRecord | undefined {
  let cur = b;
  for (let i = 0; i < 60 && cur; i++) {
    if (cur.type === 'page' && cur !== b) return cur;
    if (cur.parent_table !== 'block') return cur.type === 'page' ? cur : undefined;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  return undefined;
}

function addParents(b: BlockRecord, rm: RecordMapBuilder) {
  if (b.parent_table === 'block') {
    let cur = getRecord<BlockRecord>('block', b.parent_id);
    for (let i = 0; i < 40 && cur; i++) {
      rm.add('block', cur);
      if (cur.type === 'page' || cur.type === 'collection_view_page' || cur.parent_table !== 'block') break;
      cur = getRecord<BlockRecord>('block', cur.parent_id);
    }
  } else if (b.parent_table === 'collection') {
    const col = getRecord<CollectionRecord>('collection', b.parent_id);
    if (col) {
      rm.add('collection', col);
      rm.add('block', getRecord<BlockRecord>('block', col.parent_id));
    }
  } else if (b.parent_table === 'team') {
    rm.add('team', getRecord<TeamRecord>('team', b.parent_id));
  }
}

export const handlers: Record<string, Handler> = {
  getLibraryMeetingNotes(ctx, { spaceId, limit }) {
    const uid = requireUser(ctx);
    const max = Math.min(Number(limit) || 200, 500);
    const found = new Map<string, BlockRecord>();
    // pages that hold an AI meeting notes / transcription block
    const blocks = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1
                               AND json_extract(data, '$.type') IN ('meeting_notes', 'transcription') LIMIT 1000`).all(String(spaceId)) as { data: string }[];
    for (const r of blocks) {
      const page = pageOfBlock(JSON.parse(r.data) as BlockRecord);
      if (page && page.alive) found.set(page.id, page);
    }
    // pages titled like meeting notes
    const pages = db.prepare(`SELECT data FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1
                              AND json_extract(data, '$.type') = 'page' AND (data LIKE '%eeting%' OR data LIKE '%회의록%' OR data LIKE '%노트%')
                              ORDER BY last_edited_time DESC LIMIT 2000`).all(String(spaceId)) as { data: string }[];
    for (const r of pages) {
      const b = JSON.parse(r.data) as BlockRecord;
      if (MEETING_TITLE.test(toPlainText(b.properties?.title).trim())) found.set(b.id, b);
    }
    const rm = new RecordMapBuilder(uid);
    const ids: string[] = [];
    const sorted = [...found.values()].sort((a, b) => (b.created_time ?? 0) - (a.created_time ?? 0));
    for (const b of sorted) {
      if (ids.length >= max) break;
      if (blockRole(b.id, uid) === 'none') continue;
      rm.add('block', b);
      addParents(b, rm);
      rm.add('lit_user', getRecord('lit_user', b.created_by_id), 'reader');
      rm.add('lit_user', getRecord('lit_user', b.last_edited_by_id), 'reader');
      ids.push(b.id);
    }
    return { pageIds: ids, recordMap: rm.map };
  },

  getLibraryPageMeta(ctx, { pageIds }) {
    const uid = requireUser(ctx);
    const rm = new RecordMapBuilder(uid);
    for (const id of (Array.isArray(pageIds) ? pageIds : []).slice(0, 300).map(String)) {
      const b = getRecord<BlockRecord>('block', id);
      if (!b || blockRole(id, uid) === 'none') continue;
      rm.add('block', b);
      addParents(b, rm);
      rm.add('lit_user', getRecord('lit_user', b.created_by_id), 'reader');
      rm.add('lit_user', getRecord('lit_user', b.last_edited_by_id), 'reader');
    }
    return { recordMap: rm.map };
  },
};

// Quick Find search log for Settings › Analytics › Search: one row per search a member runs in the
// search window (typing refines the same row for a few seconds), and whether one of its results was opened next
// (click-through). Only the search modal's queries are logged (source 'quick_find'), never mention/link pickers.
import { newId } from '@nc/shared/ids.ts';
import { db } from './db.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS search_log (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  query TEXT NOT NULL,
  time INTEGER NOT NULL,
  result_ids TEXT,
  clicked_page_id TEXT,
  clicked_time INTEGER
);
CREATE INDEX IF NOT EXISTS idx_search_log_space ON search_log(space_id, time);
CREATE INDEX IF NOT EXISTS idx_search_log_user ON search_log(user_id, time);
`);

const REFINE_MS = 15_000;
const CLICK_MS = 2 * 60_000;

const q = {
  last: db.prepare('SELECT id, query, time FROM search_log WHERE user_id = ? AND space_id = ? ORDER BY time DESC LIMIT 1'),
  update: db.prepare('UPDATE search_log SET query = ?, time = ?, result_ids = ? WHERE id = ?'),
  insert: db.prepare('INSERT INTO search_log (id, space_id, user_id, query, time, result_ids) VALUES (?, ?, ?, ?, ?, ?)'),
  recent: db.prepare('SELECT id, result_ids FROM search_log WHERE user_id = ? AND time > ? AND clicked_page_id IS NULL ORDER BY time DESC LIMIT 3'),
  click: db.prepare('UPDATE search_log SET clicked_page_id = ?, clicked_time = ? WHERE id = ?'),
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);
}

/** Record a Quick Find search (typing "pro" → "project" within a few seconds updates one row). Never throws. */
export function logSearch(spaceId: string, userId: string, query: string, resultIds: string[], now = Date.now()) {
  try {
    const text = norm(query);
    if (!text || !spaceId || !userId) return;
    const ids = JSON.stringify(resultIds.slice(0, 30));
    const last = q.last.get(userId, spaceId) as { id: string; query: string; time: number } | undefined;
    if (last && now - last.time < REFINE_MS && (text.startsWith(last.query) || last.query.startsWith(text))) {
      q.update.run(text, now, ids, last.id);
      return;
    }
    q.insert.run(newId(), spaceId, userId, text, now, ids);
  } catch (e) {
    console.error('[searchLog] failed', e);
  }
}

/** A page view right after a search that listed it counts as a click-through. Never throws. */
export function noteSearchClick(userId: string | null, pageId: string, now = Date.now()) {
  try {
    if (!userId) return;
    for (const r of q.recent.all(userId, now - CLICK_MS) as { id: string; result_ids: string | null }[]) {
      const ids = JSON.parse(r.result_ids || '[]') as string[];
      if (ids.includes(pageId)) {
        q.click.run(pageId, now, r.id);
        return;
      }
    }
  } catch (e) {
    console.error('[searchLog] click failed', e);
  }
}

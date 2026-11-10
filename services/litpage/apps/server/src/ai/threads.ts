// AI chat threads (private to their creator): one row per thread + append-only messages.
// Stored in their own SQLite tables (not records) as expected per-user AI chat history.
import { createHash } from 'node:crypto';
import { newId } from '@nc/shared/ids.ts';
import { db } from '../db.ts';
import type { StoredContext } from './prompts.ts';

db.exec(`
CREATE TABLE IF NOT EXISTS ai_threads (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  space_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  page_id TEXT,
  created_time INTEGER NOT NULL,
  updated_time INTEGER NOT NULL,
  alive INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_ai_threads_user ON ai_threads(user_id, space_id, updated_time);
CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL,
  created_time INTEGER NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_messages_thread ON ai_messages(thread_id, seq);
`);
// later columns (pin, unread dot, per-chat model, read-only share link, icon) — added in place on older data files
// agent_id: chats with a Custom Agent and its triggered runs (agents/runs.ts) — kept out of the AI chat list
for (const col of ['pinned INTEGER NOT NULL DEFAULT 0', 'last_read_time INTEGER', 'model TEXT', 'shared INTEGER NOT NULL DEFAULT 0', 'icon TEXT', 'auto_title INTEGER NOT NULL DEFAULT 1', 'agent_id TEXT']) {
  try {
    db.exec(`ALTER TABLE ai_threads ADD COLUMN ${col}`);
  } catch {
    /* column exists */
  }
}

export interface SourceRef {
  n: number;
  /** workspace page ('' for web sources) */
  pageId: string;
  title: string;
  /** web source */
  url?: string;
  /** the block the citation points at (search hit) */
  blockId?: string;
}

/** An agent step as the transcript shows it (persisted with the assistant message). */
export interface StoredStep {
  id: string;
  tool: string;
  status: string;
  label: string;
  detail?: string;
  refs?: { pageId?: string; url?: string; title: string }[];
  error?: string;
  approval?: Record<string, unknown>;
  mcp?: { server: string; tool: string; input?: string; output?: string };
}

export interface MessageData {
  text: string;
  /** context snapshots sent with this user turn (replayed verbatim on later turns) */
  contexts?: StoredContext[];
  /** pages @-mentioned in this user turn (for display) */
  mentions?: { pageId: string; title: string }[];
  /** current page attached as context (for display) */
  pageId?: string | null;
  /** per-turn facts (date, user, mentions) sent with the user turn */
  meta?: string;
  status?: 'complete' | 'stopped' | 'error' | 'refused';
  error?: { code: string; message: string };
  /** citations available to this assistant turn ([n] → page) */
  sources?: SourceRef[];
  model?: string;
  /** agent tool steps of this answer */
  steps?: StoredStep[];
  /** the answer changed the workspace (Changes made card); undo state is read from ai_changes */
  changed?: boolean;
  /** 👍 / 👎 */
  feedback?: { rating: 'positive' | 'negative'; comment?: string; time: number };
  /** chat mode / model choice the turn ran with */
  mode?: string;
  modelChoice?: string;
  /** user turn: attachments (display) and invoked skills */
  attachments?: { id: string; name: string; mime: string; size: number }[];
  skills?: { id: string; name: string }[];
  /** user turn: mentioned people / teamspaces (display) */
  people?: { userId: string; name: string }[];
  teamspaces?: { teamId: string; name: string }[];
  web?: boolean;
}

export interface Thread {
  id: string;
  userId: string;
  spaceId: string | null;
  title: string;
  pageId: string | null;
  createdTime: number;
  updatedTime: number;
  pinned: boolean;
  lastReadTime: number;
  model: string | null;
  shared: boolean;
  icon: string | null;
  autoTitle: boolean;
  /** Custom Agent chat / run (null = standard AI chat) */
  agentId: string | null;
}

export interface Message {
  id: string;
  threadId: string;
  seq: number;
  role: 'user' | 'assistant';
  createdTime: number;
  data: MessageData;
}

const toThread = (r: any): Thread => ({
  id: r.id, userId: r.user_id, spaceId: r.space_id, title: r.title ?? '', pageId: r.page_id ?? null, createdTime: r.created_time, updatedTime: r.updated_time,
  pinned: !!r.pinned, lastReadTime: r.last_read_time ?? r.updated_time, model: r.model ?? null, shared: !!r.shared, icon: r.icon ?? null, autoTitle: r.auto_title !== 0,
  agentId: r.agent_id ?? null,
});
const toMessage = (r: any): Message => ({ id: r.id, threadId: r.thread_id, seq: r.seq, role: r.role, createdTime: r.created_time, data: JSON.parse(r.data) });

const q = {
  insertThread: db.prepare('INSERT INTO ai_threads (id, user_id, space_id, title, page_id, created_time, updated_time) VALUES (?, ?, ?, ?, ?, ?, ?)'),
  thread: db.prepare('SELECT * FROM ai_threads WHERE id = ? AND alive = 1'),
  list: db.prepare('SELECT * FROM ai_threads WHERE user_id = ? AND space_id = ? AND alive = 1 AND agent_id IS NULL ORDER BY updated_time DESC LIMIT ?'),
  touch: db.prepare('UPDATE ai_threads SET updated_time = ? WHERE id = ?'),
  rename: db.prepare('UPDATE ai_threads SET title = ?, updated_time = ?, auto_title = 0 WHERE id = ?'),
  autoTitle: db.prepare('UPDATE ai_threads SET title = ? WHERE id = ? AND auto_title = 1'),
  pin: db.prepare('UPDATE ai_threads SET pinned = ? WHERE id = ?'),
  read: db.prepare('UPDATE ai_threads SET last_read_time = ? WHERE id = ?'),
  model: db.prepare('UPDATE ai_threads SET model = ? WHERE id = ?'),
  share: db.prepare('UPDATE ai_threads SET shared = ? WHERE id = ?'),
  icon: db.prepare('UPDATE ai_threads SET icon = ? WHERE id = ?'),
  shared: db.prepare('SELECT * FROM ai_threads WHERE space_id = ? AND shared = 1 AND alive = 1 AND agent_id IS NULL ORDER BY updated_time DESC LIMIT 200'),
  kill: db.prepare('UPDATE ai_threads SET alive = 0 WHERE id = ?'),
  messages: db.prepare('SELECT * FROM ai_messages WHERE thread_id = ? ORDER BY seq'),
  maxSeq: db.prepare('SELECT MAX(seq) AS s FROM ai_messages WHERE thread_id = ?'),
  insertMessage: db.prepare('INSERT INTO ai_messages (id, thread_id, seq, role, created_time, data) VALUES (?, ?, ?, ?, ?, ?)'),
  updateMessage: db.prepare('UPDATE ai_messages SET data = ? WHERE id = ?'),
  deleteMessage: db.prepare('DELETE FROM ai_messages WHERE id = ?'),
  deleteMessages: db.prepare('DELETE FROM ai_messages WHERE thread_id = ?'),
};

export function createThread(userId: string, spaceId: string | null, title: string, pageId?: string | null, agentId?: string | null): Thread {
  const now = Date.now();
  const id = newId();
  q.insertThread.run(id, userId, spaceId, title, pageId ?? null, now, now);
  if (agentId) db.prepare('UPDATE ai_threads SET agent_id = ? WHERE id = ?').run(agentId, id);
  return { id, userId, spaceId, title, pageId: pageId ?? null, createdTime: now, updatedTime: now, pinned: false, lastReadTime: now, model: null, shared: false, icon: null, autoTitle: true, agentId: agentId ?? null };
}

/** A thread by id regardless of owner (Custom Agent activity checks access itself). */
export function threadById(id: string): Thread | null {
  const r = q.thread.get(String(id)) as any;
  return r ? toThread(r) : null;
}

/** A person's chats with one agent, newest first. */
export function agentThreadsOf(agentId: string, userId: string, limit = 50): Thread[] {
  return (db.prepare('SELECT * FROM ai_threads WHERE agent_id = ? AND user_id = ? AND alive = 1 ORDER BY updated_time DESC LIMIT ?').all(agentId, userId, Math.max(1, Math.min(200, limit))) as any[]).map(toThread);
}

/** A thread its owner can open, or any workspace member when it is shared ("Share chat", read-only). */
export function getThreadForViewer(id: string, userId: string, isMember: (spaceId: string) => boolean): { thread: Thread; owner: boolean } | null {
  const r = q.thread.get(String(id)) as any;
  if (!r) return null;
  const t = toThread(r);
  if (t.userId === userId) return { thread: t, owner: true };
  if (t.shared && t.spaceId && isMember(t.spaceId)) return { thread: t, owner: false };
  return null;
}

export function setPinned(id: string, pinned: boolean) {
  q.pin.run(pinned ? 1 : 0, id);
}

export function markRead(id: string, time = Date.now()) {
  q.read.run(time, id);
}

export function setThreadModel(id: string, model: string | null) {
  q.model.run(model, id);
}

export function setShared(id: string, shared: boolean) {
  q.share.run(shared ? 1 : 0, id);
}

export function setThreadIcon(id: string, icon: string | null) {
  q.icon.run(icon, id);
}

/** Title from the AI summary — only while the user hasn't renamed the chat. */
export function setAutoTitle(id: string, title: string) {
  q.autoTitle.run(title.slice(0, 200), id);
}

export function sharedThreads(spaceId: string): Thread[] {
  return (q.shared.all(spaceId) as any[]).map(toThread);
}

/** The thread if it exists and belongs to `userId`. */
export function getThread(id: string, userId: string): Thread | null {
  const r = q.thread.get(String(id)) as any;
  if (!r || r.user_id !== userId) return null;
  return toThread(r);
}

export function listThreads(userId: string, spaceId: string, query?: string, limit = 100): Thread[] {
  const rows = (q.list.all(userId, spaceId, Math.min(500, Math.max(1, limit))) as any[]).map(toThread);
  const s = query?.trim().toLowerCase();
  return s ? rows.filter((t) => t.title.toLowerCase().includes(s)) : rows;
}

export function listMessages(threadId: string): Message[] {
  return (q.messages.all(threadId) as any[]).map(toMessage);
}

export function getMessage(id: string): Message | null {
  const r = db.prepare('SELECT * FROM ai_messages WHERE id = ?').get(String(id)) as any;
  return r ? toMessage(r) : null;
}

export function addMessage(threadId: string, role: 'user' | 'assistant', data: MessageData, presetId?: string): Message {
  const seq = ((q.maxSeq.get(threadId) as any)?.s ?? 0) + 1;
  const id = presetId ?? newId();
  const now = Date.now();
  q.insertMessage.run(id, threadId, seq, role, now, JSON.stringify(data));
  q.touch.run(now, threadId);
  return { id, threadId, seq, role, createdTime: now, data };
}

export function updateMessage(id: string, data: MessageData) {
  q.updateMessage.run(JSON.stringify(data), id);
}

export function deleteMessage(id: string) {
  q.deleteMessage.run(id);
}

export function renameThread(id: string, title: string) {
  q.rename.run(title.slice(0, 200), Date.now(), id);
}

export function deleteThread(id: string) {
  q.kill.run(id);
  q.deleteMessages.run(id);
}

export function contentHash(markdown: string): string {
  return createHash('sha1').update(markdown).digest('hex').slice(0, 16);
}

/** Latest content hash of every page already sent in this thread (to avoid re-sending unchanged pages). */
export function sentPageHashes(messages: Message[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== 'user') continue;
    for (const c of m.data.contexts ?? []) out.set(`${c.kind}:${c.pageId}`, contentHash(c.markdown));
  }
  return out;
}

/** All citation numbers assigned so far in a thread (numbers stay stable across turns). */
export function sourceKey(s: { pageId?: string; url?: string }): string {
  return s.url ? `url:${s.url}` : `page:${s.pageId}`;
}

/** All citation numbers assigned so far in a thread (numbers stay stable across turns); keyed by sourceKey. */
export function threadSources(messages: Message[]): Map<string, SourceRef> {
  const out = new Map<string, SourceRef>();
  for (const m of messages) {
    for (const s of m.data.sources ?? []) if (!out.has(sourceKey(s))) out.set(sourceKey(s), s);
    for (const c of m.data.contexts ?? []) if (c.kind === 'source' && c.n && !out.has(sourceKey(c))) out.set(sourceKey(c), { n: c.n, pageId: c.pageId, title: c.title });
  }
  return out;
}

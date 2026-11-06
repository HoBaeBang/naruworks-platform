// Custom Agent triggers : what starts a background run.
//   - On a schedule (Recurring): a job per trigger in the persistent scheduler, re-armed after each run
//   - page events from every committed transaction (records.ts onCommit): a page added to / removed
//     from a database, a property updated (optionally only some properties, or page content too), a comment added to
//     a page, the agent is @mentioned wherever the @ menu puts mentions — page text, captions, table cells, a database
//     row's title / Text properties, new or edited comments  — limited to resources the agent
//     can reach (a mention it can't reach is a blocked run; inviting the agent answers it), optionally to pages in a
//     view of the database and to edits by some people ("Run only for:")
//   - Meeting note summarized: fireMeetingNoteSummarized for the meeting-notes feature to call
// "Wait for edits to finish" collects the changes of a page for a few seconds (NC_AGENT_TRIGGER_WINDOW_MS, default
// 3000) and runs once. Loop guard: writes made by an agent run carry source "agent:<runId>"; they never trigger that
// agent again, and other agents only while the chain of agents stays short (no A → B → A).
import { isArchivedRecord } from '@nc/shared/archive.ts';
import { combinedFilter, matchesFilter } from '@nc/shared/database/index.ts';
import { formatOccurrence, nextOccurrence, recurrenceLabel } from '@nc/shared/automation/recurrence.ts';
import type { PermissionLookup } from '@nc/shared/permissions.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, CommentRecord, DiscussionRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText, type RichText } from '@nc/shared/richtext.ts';
import { triggerRowTitle, type AgentRecord, type AgentTrigger } from '@nc/shared/agents.ts';
import { db, getRecord } from '../db.ts';
import { blockRole, onCommit, type CommitInfo } from '../records.ts';
import { canSeeRowValue, propertyThreadVisible } from '../propaccess.ts';
import { registerJobHandler, scheduleJob, cancelJobs } from '../scheduler.ts';
import { pageIdOf } from '../ai/context.ts';
import { aiQueryContext } from '../ai/visibility.ts';
import { agentBlockRole, blockLabel } from './access.ts';
import { agentIdOfBot, agentsInSpace, getAgent, isBotId } from './model.ts';
import { enqueueRun, getRun } from './runs.ts';
import { onMeetingNoteSummarized } from '../meetings/events.ts';
import { audit } from '../audit.ts';

export function windowMs(): number {
  const v = Number(process.env.NC_AGENT_TRIGGER_WINDOW_MS);
  return Number.isFinite(v) && v >= 0 ? v : 3000;
}

const MAX_CHAIN = 2;

const lookup: PermissionLookup = {
  block: (id) => getRecord<BlockRecord>('block', id),
  space: (id) => getRecord('space', id) as any,
  team: (id) => getRecord('team', id) as any,
  collection: (id) => getRecord<CollectionRecord>('collection', id),
};

/** The agent can reach this block with its own access — its grants as capped by its editors (agents/access.ts), page-level
 *  rules of database rows included. */
function reaches(agent: AgentRecord, blockId: string): boolean {
  return agentBlockRole(lookup, agent, blockId) !== 'none' && blockRole(blockId, agent.bot_id) !== 'none';
}

/** A mention inside a database property value (a property-value thread, a Text property) reaches the agent only when
 *  it may see that value . */
function mentionVisible(agent: AgentRecord, m: { discussionId?: string; blockId?: string; propertyId?: string }): boolean {
  const thread = m.discussionId ? getRecord<DiscussionRecord>('discussion', m.discussionId) : undefined;
  if (thread && !propertyThreadVisible(thread as DiscussionRecord & { property_id?: string }, agent.bot_id)) return false;
  const row = m.propertyId && m.blockId ? getRecord<BlockRecord>('block', m.blockId) : undefined;
  return !(row && m.propertyId && !seesValue(agent, row, m.propertyId));
}

/** The agent may see this property's value on that row (property access,  — capped by its editors). */
function seesValue(agent: AgentRecord, row: BlockRecord, propId: string): boolean {
  return propId === 'title' || canSeeRowValue(row, propId, agent.bot_id);
}

function live(agent: AgentRecord | undefined): agent is AgentRecord {
  return !!agent && agent.alive !== false && agent.published && agent.status === 'active';
}

function userName(id: string | null | undefined): string {
  if (!id) return '';
  const u = getRecord<UserRecord>('lit_user', id);
  return u?.name || u?.email || '';
}

// ---------------------------------------------------------------- schedules 

const jobKey = (agentId: string, triggerId: string) => `agent-recur:${agentId}:${triggerId}`;

/** (Re)arm the schedule jobs of an agent from its live configuration (save, enable, resume, delete). */
export function syncAgentSchedules(agent: AgentRecord | undefined, now = Date.now()) {
  if (!agent) return;
  cancelJobs(`agent-recur:${agent.id}:`);
  if (!live(agent)) return;
  for (const t of agent.data.triggers) {
    if (t.type !== 'recurrence' || !t.enabled || !t.recurrence) continue;
    const at = nextOccurrence(t.recurrence, now);
    if (at === null) continue;
    scheduleJob('agent-recurrence', jobKey(agent.id, t.id), at, { agentId: agent.id, triggerId: t.id, fp: JSON.stringify(t.recurrence) });
  }
}

/** When the next scheduled run of a trigger happens (Settings shows it). */
export function nextRunOf(t: AgentTrigger, now = Date.now()): { at: number; label: string } | null {
  if (t.type !== 'recurrence' || !t.recurrence) return null;
  const at = nextOccurrence(t.recurrence, now);
  return at === null ? null : { at, label: formatOccurrence(at, t.recurrence.time_zone) };
}

registerJobHandler('agent-recurrence', (payload: { agentId: string; triggerId: string; fp: string }, job) => {
  const agent = getAgent(payload?.agentId);
  if (!live(agent)) return;
  const t = agent.data.triggers.find((x) => x.id === payload.triggerId);
  if (!t || !t.enabled || t.type !== 'recurrence' || !t.recurrence || JSON.stringify(t.recurrence) !== payload.fp) return;
  enqueueRun({ agent, kind: 'trigger', trigger: t, label: recurrenceLabel(t.recurrence), payload: { facts: [`Scheduled run: ${recurrenceLabel(t.recurrence)}.`], instructions: t.instructions } });
  // the next occurrence after this one (a late tick must not run the same occurrence twice)
  const next = nextOccurrence(t.recurrence, Math.max(Date.now(), job.runAt) + 1000);
  if (next !== null) scheduleJob('agent-recurrence', jobKey(agent.id, t.id), next, payload);
});

/** Re-arm every agent's schedules once at startup (jobs persist, but configurations may have changed offline). */
setTimeout(() => {
  try {
    for (const r of db.prepare(`SELECT data FROM records WHERE tbl = 'workflow' AND alive = 1`).all() as { data: string }[]) {
      const a = JSON.parse(r.data) as AgentRecord;
      if (live(a) && a.data.triggers.some((t) => t.type === 'recurrence' && t.enabled)) syncAgentSchedules(a);
    }
  } catch (e) {
    console.error('[agents] schedule sync failed', e);
  }
}, 1500).unref?.();

// ---------------------------------------------------------------- page events

interface PendingEvent {
  agentId: string;
  trigger: AgentTrigger;
  pageId: string;
  actorId: string;
  facts: string[];
  label: string;
  chain: string[];
  timer: ReturnType<typeof setTimeout> | null;
  firstAt: number;
}
const pending = new Map<string, PendingEvent>();

function fire(key: string) {
  const p = pending.get(key);
  if (!p) return;
  pending.delete(key);
  if (p.timer) clearTimeout(p.timer);
  const agent = getAgent(p.agentId);
  if (!live(agent)) return;
  const t = agent.data.triggers.find((x) => x.id === p.trigger.id);
  if (!t || !t.enabled) return;
  enqueueRun({ agent, kind: 'trigger', trigger: t, label: p.label, actorId: p.actorId, pageId: p.pageId, payload: { facts: [...new Set(p.facts)].slice(0, 20), instructions: t.instructions }, chain: p.chain });
}

function queueEvent(e: Omit<PendingEvent, 'timer' | 'firstAt'>, wait: boolean) {
  const key = `${e.agentId}:${e.trigger.id}:${e.pageId}`;
  const cur = pending.get(key);
  if (cur) {
    cur.facts.push(...e.facts);
    if (cur.timer) clearTimeout(cur.timer);
  }
  const p: PendingEvent = cur ?? { ...e, timer: null, firstAt: Date.now() };
  const w = wait ? windowMs() : 0;
  if (!w) {
    pending.set(key, p);
    fire(key);
    return;
  }
  // debounce while the page keeps changing, but never wait longer than 4 windows
  const delay = Math.max(0, Math.min(w, p.firstAt + 4 * w - Date.now()));
  p.timer = setTimeout(() => fire(key), delay);
  p.timer.unref?.();
  pending.set(key, p);
}

/** Run every pending debounced event now (tests). */
export function flushTriggers() {
  for (const key of [...pending.keys()]) fire(key);
}

/** The agent chain behind a write ("agent:<runId>") — empty for people's edits. */
function chainOf(info: CommitInfo): { chain: string[]; agentId: string | null } {
  const src = info.source ?? '';
  if (src.startsWith('agent:')) {
    const run = getRun(src.slice(6));
    if (run) return { chain: [...run.chain, run.agentId], agentId: run.agentId };
  }
  // a bot's own write without a run (should not happen) still counts as that agent
  if (isBotId(info.userId)) {
    const id = agentIdOfBot(info.userId);
    return { chain: id ? [id] : [], agentId: id ?? null };
  }
  return { chain: [], agentId: null };
}

function mentionedUsers(rt: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(rt)) return out;
  for (const d of rt as unknown[]) {
    const anns = Array.isArray(d) && Array.isArray(d[1]) ? (d[1] as unknown[]) : [];
    for (const a of anns) if (Array.isArray(a) && a[0] === 'u' && typeof a[1] === 'string') out.push(a[1]);
  }
  return out;
}

function plain(rt: unknown): string {
  return toPlainText(rt as RichText).replace(/[‣⁍]/g, '').replace(/\s+/g, ' ').trim().slice(0, 600);
}

function rowFacts(row: BlockRecord, col: CollectionRecord | undefined): string[] {
  const facts = [`Page: “${blockLabel(row.id)}” (page_id: ${row.id})`];
  if (col) facts.push(`Database: “${toPlainText(col.name) || 'Untitled'}” (database_id: ${col.parent_id})`);
  return facts;
}

function inView(agent: AgentRecord, t: AgentTrigger, row: BlockRecord, col: CollectionRecord): boolean {
  if (!t.view_id) return true;
  const view = getRecord<CollectionViewRecord>('collection_view', t.view_id);
  if (!view || view.alive === false) return false;
  const f = combinedFilter(view as any);
  return !f || matchesFilter(row, f, col.schema, aiQueryContext(agent.bot_id));
}

function actorAllowed(t: AgentTrigger, actorId: string): boolean {
  return !t.user_filter?.length || t.user_filter.includes(actorId);
}

interface ChangeSummary {
  added: Map<string, BlockRecord>; // rowId → row
  removed: Map<string, { row: BlockRecord; collectionId: string }>;
  propsChanged: Map<string, { row: BlockRecord; props: Set<string> }>;
  contentEdited: Map<string, BlockRecord>; // rowId → row (body changed)
  comments: { comment: CommentRecord; discussion: DiscussionRecord; pageId: string }[];
  mentions: { botId: string; pageId: string; text: string; discussionId?: string; blockId: string; property?: string; propertyId?: string }[];
}

/**
 * The text of a block where people can @-mention someone: every text property of a page's blocks (title, caption,
 * simple table cells …); for a database row its title and Text properties — Person properties also hold users, but
 * picking someone there isn't a mention. `property` = the database property's name.
 */
function mentionSpots(b: BlockRecord | undefined): { rt: unknown; property?: string; propertyId?: string }[] {
  const props = b?.properties as Record<string, unknown> | undefined;
  if (!b || !props) return [];
  if (b.parent_table === 'collection') {
    const schema = getRecord<CollectionRecord>('collection', b.parent_id)?.schema ?? {};
    return Object.entries(props)
      .filter(([k]) => k === 'title' || schema[k]?.type === 'text')
      .map(([k, rt]) => ({ rt, property: k === 'title' ? undefined : schema[k]?.name, propertyId: k === 'title' ? undefined : k }));
  }
  return Object.values(props).map((rt) => ({ rt }));
}

function summarize(info: CommitInfo): ChangeSummary {
  const s: ChangeSummary = { added: new Map(), removed: new Map(), propsChanged: new Map(), contentEdited: new Map(), comments: [], mentions: [] };
  for (const ch of info.changes) {
    const prev = info.prev.get(`${ch.table}:${ch.record.id}`) as any;
    const rec = ch.record as any;
    if (ch.table === 'block') {
      const b = rec as BlockRecord;
      if (b.parent_table === 'collection') {
        const wasAlive = prev && prev.alive !== false && prev.parent_table === 'collection';
        const isAlive = b.alive !== false && !b.is_template && !isArchivedRecord(b);
        if (!wasAlive && isAlive && (!prev || prev.alive === false)) s.added.set(b.id, b);
        else if (wasAlive && (!isAlive || prev.parent_id !== b.parent_id)) s.removed.set(b.id, { row: prev, collectionId: prev.parent_id });
        else if (wasAlive && isAlive) {
          const props = new Set<string>();
          const before = (prev.properties ?? {}) as Record<string, unknown>;
          const after = (b.properties ?? {}) as Record<string, unknown>;
          for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) if (JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) props.add(k);
          if (props.size) s.propsChanged.set(b.id, { row: b, props });
        }
      } else if (b.parent_table === 'block') {
        // body edits of a database row page
        const pid = pageIdOf(b.id);
        const page = pid ? getRecord<BlockRecord>('block', pid) : undefined;
        if (page && page.parent_table === 'collection' && page.alive !== false) s.contentEdited.set(page.id, page);
      }
      // @mentions of an agent wherever the @ menu puts them: any text of a block (titles, captions, simple table
      // cells) and a database row's title / Text properties . Only mentions that weren't there before count.
      const pageId = b.type === 'page' || b.type === 'collection_view_page' ? b.id : pageIdOf(b.id) ?? b.id;
      // (database templates aren't pages yet: a mention in a template counts once the template is used)
      if (b.alive !== false && !b.is_template && !getRecord<BlockRecord>('block', pageId)?.is_template) {
        const before = new Set(mentionSpots(prev as BlockRecord | undefined).flatMap((x) => mentionedUsers(x.rt)));
        for (const spot of mentionSpots(b)) {
          for (const uid of new Set(mentionedUsers(spot.rt))) {
            if (before.has(uid) || !isBotId(uid)) continue;
            before.add(uid);
            s.mentions.push({ botId: uid, pageId, text: plain(spot.rt), blockId: b.id, property: spot.property, propertyId: spot.propertyId });
          }
        }
      }
    } else if (ch.table === 'comment' && rec.alive !== false) {
      const c = rec as CommentRecord;
      const d = getRecord<DiscussionRecord>('discussion', c.parent_id);
      if (!d || d.alive === false) continue;
      const pageId = pageIdOf(d.parent_id) ?? d.parent_id;
      if (!prev) s.comments.push({ comment: c, discussion: d, pageId });
      // new comments, and mentions added by editing a comment
      const before = new Set(prev ? mentionedUsers((prev as CommentRecord).text) : []);
      for (const uid of new Set(mentionedUsers(c.text))) {
        if (before.has(uid) || !isBotId(uid)) continue;
        s.mentions.push({ botId: uid, pageId, text: plain(c.text), discussionId: d.id, blockId: d.parent_id });
      }
    }
  }
  return s;
}

function handleCommit(info: CommitInfo) {
  // fast exit: no agent in this workspace has an app trigger
  const spaceIds = new Set(info.changes.map((c) => (c.record as any).space_id).filter((x): x is string => typeof x === 'string'));
  const candidates: AgentRecord[] = [];
  for (const sid of spaceIds) for (const a of agentsInSpace(sid)) if (live(a) && a.data.triggers.some((t) => t.enabled && t.type !== 'recurrence')) candidates.push(a);
  if (!candidates.length) return;
  const { chain, agentId: writer } = chainOf(info);
  if (chain.length > MAX_CHAIN) return;
  const s = summarize(info);
  const actor = info.userId;
  const actorLabel = isBotId(actor) ? `the agent “${getAgent(agentIdOfBot(actor) ?? '')?.data.name ?? 'Agent'}”` : userName(actor) || 'someone';
  for (const agent of candidates) {
    // an agent's own writes never trigger it, nor do writes of agents that it (indirectly) started
    if (agent.id === writer || chain.includes(agent.id)) continue;
    for (const t of agent.data.triggers) {
      if (!t.enabled || !actorAllowed(t, actor)) continue;
      const wait = t.wait_for_edits !== false;
      switch (t.type) {
        case 'lit.page_created':
          for (const row of s.added.values()) {
            const col = getRecord<CollectionRecord>('collection', row.parent_id);
            if (!col || col.id !== t.collection_id || !reaches(agent, row.id) || !inView(agent, t, row, col)) continue;
            queueEvent({ agentId: agent.id, trigger: t, pageId: row.id, actorId: actor, label: triggerRowTitle(t), chain, facts: [`A page was added to the database by ${actorLabel}.`, ...rowFacts(row, col)] }, wait);
          }
          break;
        case 'lit.page_deleted':
          for (const { row, collectionId } of s.removed.values()) {
            const col = getRecord<CollectionRecord>('collection', collectionId);
            if (!col || col.id !== t.collection_id || !reaches(agent, col.parent_id)) continue;
            queueEvent({ agentId: agent.id, trigger: t, pageId: row.id, actorId: actor, label: triggerRowTitle(t), chain, facts: [`A page was removed from the database by ${actorLabel}: “${plain(row.properties?.title) || 'Untitled'}” (page_id: ${row.id}).`, `Database: “${toPlainText(col.name) || 'Untitled'}” (database_id: ${col.parent_id})`] }, false);
          }
          break;
        case 'lit.page_updated': {
          const touched = new Map<string, { row: BlockRecord; props: Set<string>; content: boolean }>();
          for (const [id, v] of s.propsChanged) touched.set(id, { row: v.row, props: v.props, content: false });
          if (t.content_edited) for (const [id, row] of s.contentEdited) touched.set(id, { row, props: touched.get(id)?.props ?? new Set(), content: true });
          for (const { row, props, content } of touched.values()) {
            const col = getRecord<CollectionRecord>('collection', row.parent_id);
            if (!col || col.id !== t.collection_id || !reaches(agent, row.id)) continue;
            // properties the agent can't see don't trigger it (nor are they named to it)
            const watched = (t.properties?.length ? [...props].filter((p) => t.properties!.includes(p)) : [...props]).filter((p) => seesValue(agent, row, p));
            if (!watched.length && !content) continue;
            if (!inView(agent, t, row, col)) continue;
            const names = watched.map((p) => col.schema[p]?.name ?? (p === 'title' ? 'Name' : p)).filter(Boolean);
            queueEvent({
              agentId: agent.id, trigger: t, pageId: row.id, actorId: actor, label: triggerRowTitle(t), chain,
              facts: [`${names.length ? `Properties updated (${names.join(', ')})` : 'The page content was edited'} by ${actorLabel}.`, ...rowFacts(row, col)],
            }, wait);
          }
          break;
        }
        case 'lit.comment_added':
          for (const c of s.comments) {
            if (c.comment.created_by_id === agent.bot_id) continue;
            if (t.page_id) {
              const scope = getRecord<BlockRecord>('block', t.page_id);
              const page = getRecord<BlockRecord>('block', c.pageId);
              const inScope = c.pageId === t.page_id || (!!page && page.parent_table === 'collection' && !!scope?.collection_id && page.parent_id === scope.collection_id);
              if (!inScope) continue;
            }
            // a thread on a database property value is the value's: not for an agent that can't see it 
            if (!reaches(agent, c.pageId) || !propertyThreadVisible(c.discussion as DiscussionRecord & { property_id?: string }, agent.bot_id)) continue;
            queueEvent({
              agentId: agent.id, trigger: t, pageId: c.pageId, actorId: actor, label: triggerRowTitle(t), chain,
              facts: [`${actorLabel} commented on “${blockLabel(c.pageId)}” (page_id: ${c.pageId}, discussion_id: ${c.discussion.id}): “${plain(c.comment.text)}”`],
            }, false);
          }
          break;
        case 'lit.agent_mentioned':
          for (const m of s.mentions) {
            if (m.botId !== agent.bot_id) continue;
            const facts = [m.discussionId
              ? `${actorLabel} mentioned you in a comment on “${blockLabel(m.pageId)}” (page_id: ${m.pageId}, discussion_id: ${m.discussionId}): “${m.text}”. Reply in that thread with add_comment.`
              : m.property
                ? `${actorLabel} mentioned you in the “${m.property}” property of “${blockLabel(m.pageId)}” (page_id: ${m.pageId}): “${m.text}”.`
                : `${actorLabel} mentioned you on the page “${blockLabel(m.pageId)}” (page_id: ${m.pageId}): “${m.text}”.`];
            if (!reaches(agent, m.pageId)) {
              // If the agent cannot access the page, record a failed run so Activity explains why.
              // The mention itself stays on the server (never shown in the Activity): inviting the agent to the page
              // right after ("Invite agent to page?") answers it — retryBlockedMentions.
              enqueueRun({ agent, kind: 'trigger', trigger: t, label: 'When someone mentions the agent', actorId: actor, pageId: m.pageId, chain, payload: { facts: [`Mentioned by ${actorLabel} on a page you can't open.`], blocked: true, mention: { label: triggerRowTitle(t), facts, discussionId: m.discussionId, blockId: m.blockId, propertyId: m.propertyId } } });
              continue;
            }
            // a mention inside a value the agent can't see (a property-value thread, a hidden Text property) stays there
            if (!mentionVisible(agent, m)) continue;
            queueEvent({ agentId: agent.id, trigger: t, pageId: m.pageId, actorId: actor, label: triggerRowTitle(t), chain, facts }, false);
          }
          break;
        default:
          break;
      }
    }
  }
}

const instructionsAudited = new Map<string, number>();

/** The agent whose instructions page holds `block` (its page's parent is the agent record), if any. */
function instructionsAgentOf(block: BlockRecord): string | null {
  let cur: BlockRecord | undefined = block;
  for (let i = 0; i < 100 && cur; i++) {
    if ((cur.parent_table as string) === 'workflow') return cur.parent_id;
    if (cur.parent_table !== 'block') return null;
    cur = getRecord<BlockRecord>('block', cur.parent_id);
  }
  return null;
}

function noteInstructionsEdits(info: CommitInfo) {
  if (!info.userId || isBotId(info.userId)) return;
  const seen = new Set<string>();
  for (const c of info.changes) {
    if (c.table !== 'block') continue;
    const agentId = instructionsAgentOf(c.record as BlockRecord);
    if (!agentId || seen.has(agentId)) continue;
    seen.add(agentId);
    const key = `${agentId}:${info.userId}`;
    if (Date.now() - (instructionsAudited.get(key) ?? 0) < 10 * 60_000) continue;
    instructionsAudited.set(key, Date.now());
    const agent = getAgent(agentId);
    if (agent) audit('custom_agent_instructions_page_edited', { spaceId: agent.space_id, actorId: info.userId, targetId: agent.id, data: { agent_name: agent.data.name } });
  }
}

let installed = false;
/** Register the commit hook once (api/modules/agents.ts loads this module). */
export function installAgentTriggers() {
  if (installed) return;
  installed = true;
  onCommit((info) => {
    try {
      handleCommit(info);
    } catch (e) {
      console.error('[agents] trigger evaluation failed', e);
    }
  });
  // Audit log: "Edited instructions page for {agentName}" (people only, at most every 10 minutes per agent and person)
  onCommit((info) => {
    try {
      noteInstructionsEdits(info);
    } catch (e) {
      console.error('[agents] instructions audit failed', e);
    }
  });
  // AI Meeting Notes (meetings/events.ts): "Meeting note summarized" triggers
  onMeetingNoteSummarized((e) => {
    fireMeetingNoteSummarized(e.pageId, e.userId, { title: e.title, summaryMarkdown: e.summaryMarkdown });
  });
}

// ---------------------------------------------------------------- meeting notes

/**
 * Called by the AI Meeting Notes feature when a meeting note's summary is done: runs every agent with a
 * "Meeting note summarized" trigger that can reach the note (and, when the trigger names a database, whose note is
 * a page of that database). Returns the queued run ids.
 */
/** How long after a blocked mention inviting the agent to the page still answers it. */
const MENTION_RETRY_MS = 10 * 60_000;

/**
 * "Invite agent to page?" › Invite : the agent was mentioned on a page it couldn't open, and someone just
 * gave it access — answer those recent mentions now (once each), as the person who mentioned it.
 */
export function retryBlockedMentions(agentId: string, pageId: string, now = Date.now()): string[] {
  const agent = getAgent(agentId);
  if (!live(agent) || !reaches(agent, pageId)) return [];
  const t = agent.data.triggers.find((x) => x.type === 'lit.agent_mentioned' && x.enabled !== false);
  if (!t) return [];
  const rows = db.prepare(`SELECT id FROM agent_runs WHERE agent_id = ? AND page_id = ? AND trigger_type = 'lit.agent_mentioned' AND status IN ('failed', 'pending', 'running') AND created_time >= ? ORDER BY created_time`)
    .all(agent.id, pageId, now - MENTION_RETRY_MS) as { id: string }[];
  const out: string[] = [];
  for (const { id } of rows) {
    const run = getRun(id);
    const mention = run?.payload.mention as { label?: string; facts?: string[]; discussionId?: string; blockId?: string; propertyId?: string } | undefined;
    if (!run || !run.payload.blocked || run.payload.retried || !mention?.facts?.length) continue;
    markRetried(run.id, run.payload);
    // now that it can open the page: still nothing from a value it can't see
    if (!mentionVisible(agent, mention)) continue;
    out.push(enqueueRun({ agent, kind: 'trigger', trigger: t, label: mention.label || triggerRowTitle(t), actorId: run.actorId, pageId, chain: run.chain, parentRunId: run.id, payload: { facts: mention.facts } }).id);
  }
  return out;
}

function markRetried(runId: string, payload: Record<string, unknown>) {
  db.prepare('UPDATE agent_runs SET payload = ? WHERE id = ?').run(JSON.stringify({ ...payload, retried: true }), runId);
}

export function fireMeetingNoteSummarized(pageId: string, actorId: string, note?: { title?: string; summaryMarkdown?: string }): string[] {
  const page = getRecord<BlockRecord>('block', pageId);
  if (!page || page.alive === false) return [];
  const out: string[] = [];
  for (const agent of agentsInSpace(page.space_id)) {
    if (!live(agent)) continue;
    for (const t of agent.data.triggers) {
      if (!t.enabled || t.type !== 'lit.meeting_note_summarized' || !actorAllowed(t, actorId)) continue;
      if (t.collection_id && !(page.parent_table === 'collection' && page.parent_id === t.collection_id)) continue;
      if (!reaches(agent, page.id)) continue;
      const summary = note?.summaryMarkdown?.trim();
      const facts = [`The meeting note “${note?.title || blockLabel(pageId)}” (page_id: ${pageId}) was summarized.`];
      if (summary) facts.push(`Summary:\n${summary.slice(0, 4000)}${summary.length > 4000 ? '\n[Summary truncated — read the page for the rest.]' : ''}`);
      const run = enqueueRun({ agent, kind: 'trigger', trigger: t, label: triggerRowTitle(t), actorId, pageId, payload: { facts, instructions: t.instructions } });
      out.push(run.id);
    }
  }
  return out;
}

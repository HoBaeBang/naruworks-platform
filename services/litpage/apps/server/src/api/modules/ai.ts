// AI JSON endpoints (POST /api/rpc/<name>). Streaming lives in ../../aiStream.ts (SSE).
// Every endpoint that would call the model returns 400 "Connect an AI provider to use Litpage AI"
// when the selected provider is not configured.
import { newId } from '@nc/shared/ids.ts';
import { op as mk } from '@nc/shared/ops.ts';
import { isRestrictedMember, roleAtLeast } from '@nc/shared/permissions.ts';
import { isSpaceOwner } from '../../policy.ts';
import type { BlockRecord, SpaceRecord, UserRecord, UserSettingsRecord } from '@nc/shared/records.ts';
import { db, getRecord } from '../../db.ts';
import { applyTransactions, blockRole } from '../../records.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { AI_RATE_MESSAGE, aiAllowed, hit } from '../../ratelimit.ts';
import { AiError, aiConfigured, mapError, NO_KEY_MESSAGE } from '../../ai/client.ts';
import { isMember } from '../../ai/context.ts';
import { chatTitleFrom, LANGUAGES, SKILLS, TONES, type AutofillKind } from '../../ai/prompts.ts';
import {
  executeChatTurn, executeSimple, parseChatParams, prepareAiBlock, prepareChatTurn, prepareWriter, runAutofill, runQuery,
} from '../../ai/service.ts';
import {
  createThread, deleteThread, getMessage, getThread, getThreadForViewer, listMessages, listThreads, markRead, renameThread, setPinned, setShared,
  setThreadIcon, setThreadModel, sharedThreads, updateMessage, type Message, type Thread,
} from '../../ai/threads.ts';
import { mcpAllowlistProblem, userAiPrefs, workspaceAiPolicy } from '../../ai/aiPolicy.ts';
import { AUTO, DEFAULT_MODEL, modelConfigurationError, modelLabel, offeredModels, resolveModel } from '../../ai/models.ts';
import { decideApproval } from '../../ai/approvals.ts';
import { turnChanges, undoTurn } from '../../ai/changes.ts';
import { MAX_ATTACHMENTS } from '../../ai/attachments.ts';
import { BUILTIN_SKILLS, isSkillPage, listSkills, skillById, skillFlag, skillMarkdown } from '../../ai/skills.ts';
import { addConnection, createPreset, deletePreset, listConnections, listPresets, refreshConnection, removeAllConnections, removeConnection, updateConnection } from '../../ai/mcp.ts';
import { audit } from '../../audit.ts';
import {
  approveClients, clientMembers, createToken, disableMyClient, disconnectClient, listClients, listTokens, MCP_CLIENT_CATALOG, removeApprovedClient, renameClient, revokeAll, revokeToken, setClientRestriction,
} from '../../ai/litMcp.ts';
import { placeUnder, spaceViewOf } from '../../ai/edit.ts';
import { OpsBuilder } from '../../content/spec.ts';
import { rowsToDb } from '../../content/csv.ts';

function uid(ctx: Ctx): string {
  if (!ctx.userId) throw new ApiError('Unauthorized', 401);
  return ctx.userId;
}

/** Endpoints that call the model count against the per-user AI rate limit. */
function modelCall(ctx: Ctx): string {
  const userId = uid(ctx);
  if (!aiConfigured()) throw new ApiError(NO_KEY_MESSAGE, 400);
  if (!aiAllowed(userId)) throw new ApiError(AI_RATE_MESSAGE, 429);
  return userId;
}

function fail(e: unknown): never {
  if (e instanceof ApiError) throw e;
  const err = mapError(e);
  throw new ApiError(err.message, err.status === 499 ? 400 : err.status);
}

/** Run a sync/async body and turn AiErrors into API errors. */
async function guarded<T>(fn: () => T | Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    fail(e);
  }
}

function member(spaceId: unknown, userId: string): string {
  const id = String(spaceId ?? '');
  if (!id || !isMember(id, userId)) throw new ApiError('Not allowed', 403);
  return id;
}

const threadJson = (t: Thread, userId?: string) => ({
  id: t.id, title: t.title, pageId: t.pageId, spaceId: t.spaceId, createdTime: t.createdTime, updatedTime: t.updatedTime,
  pinned: t.pinned, unread: t.updatedTime > t.lastReadTime + 500, model: t.model, shared: t.shared, icon: t.icon,
  ...(userId && t.userId !== userId ? { readOnly: true, ownerName: getRecord<UserRecord>('lit_user', t.userId)?.name ?? '' } : {}),
});

/** Messages as the client renders them (context markdown snapshots are not sent back). */
export function messageJson(m: Message) {
  const changes = m.role === 'assistant' && m.data.changed ? turnChanges(m.id) : null;
  return {
    id: m.id,
    role: m.role,
    createdTime: m.createdTime,
    text: m.data.text,
    status: m.data.status ?? 'complete',
    error: m.data.error,
    sources: m.data.sources ?? (m.data.contexts ?? []).filter((c) => c.kind === 'source').map((c) => ({ n: c.n, pageId: c.pageId, title: c.title })),
    mentions: m.data.mentions ?? [],
    pageId: m.data.pageId ?? null,
    contexts: (m.data.contexts ?? []).filter((c) => c.kind === 'page' || c.kind === 'source').map((c) => ({ kind: c.kind, pageId: c.pageId, title: c.title, truncated: c.truncated, n: c.n })),
    steps: m.data.steps ?? [],
    changes: changes ? { pages: changes.pages, undone: changes.undone } : null,
    feedback: m.data.feedback ?? null,
    attachments: m.data.attachments ?? [],
    skills: m.data.skills ?? [],
    people: m.data.people ?? [],
    teamspaces: m.data.teamspaces ?? [],
    mode: m.data.mode ?? 'default',
    model: m.data.model ? modelLabel(m.data.model) : null,
    web: !!m.data.web,
  };
}

const AUTOFILL_KINDS: Record<string, AutofillKind> = {
  summary: 'summary', summarize: 'summary', ai_summary: 'summary',
  keywords: 'keywords', key_info: 'keywords', keyinfo: 'keywords', extract: 'keywords', ai_key_info: 'keywords',
  translation: 'translation', translate: 'translation', ai_translation: 'translation',
  custom: 'custom', custom_autofill: 'custom',
};

function settingsOf(userId: string): Record<string, unknown> {
  return (getRecord<UserSettingsRecord>('user_settings', userId)?.settings ?? {}) as Record<string, unknown>;
}

function saveUserSettings(userId: string, spaceId: string, patch: Record<string, unknown>) {
  const rec = getRecord<UserSettingsRecord>('user_settings', userId);
  const ptr = { table: 'user_settings' as const, id: userId, spaceId };
  applyTransactions(userId, [{ id: newId(), spaceId, debug: { userAction: 'ai.settings' }, operations: [rec ? mk.update(ptr, ['settings'], patch) : mk.set(ptr, [], { id: userId, settings: patch })] }], undefined, { client: true });
}

function skillJson(s: ReturnType<typeof listSkills>['enabled'][number]) {
  return {
    id: s.id, pageId: s.pageId, name: s.name, description: s.description, builtin: s.builtin, enabled: s.enabled, mine: s.mine, automatic: s.automatic,
    inChat: s.inChat, inPage: s.inPage, icon: s.icon ?? null, updatedTime: s.updatedTime ?? null,
    createdBy: s.createdBy ? getRecord<UserRecord>('lit_user', s.createdBy)?.name ?? '' : '',
  };
}

export const handlers = {
  /** { configured, model, modelLabel, models, policy, prefs, … } — UI uses this for the "connect a key" state and pickers. */
  aiStatus(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const configured = aiConfigured();
    const spaceId = typeof body?.spaceId === 'string' && isMember(body.spaceId, userId) ? body.spaceId : null;
    const policy = workspaceAiPolicy(spaceId);
    const prefs = userAiPrefs(userId);
    const allowed = policy.allowedModels;
    const auto = resolveModel(AUTO, allowed).model;
    return {
      configured, model: DEFAULT_MODEL, modelLabel: modelLabel(DEFAULT_MODEL), message: configured ? (modelConfigurationError() ?? null) : NO_KEY_MESSAGE,
      skills: Object.values(SKILLS).map((s) => ({ id: s.id, label: s.label, mode: s.mode })), languages: LANGUAGES, tones: TONES,
      models: offeredModels(policy.fable).map((m) => ({ id: m.id, name: m.name, version: m.version, group: m.group, beta: !!m.beta, description: m.description, allowed: !allowed.length || allowed.includes(m.id) })),
      autoModel: modelLabel(auto),
      policy: { enabled: policy.enabled, webSearch: policy.webSearch, webConfirm: policy.webConfirm, skipApprovals: policy.skipApprovals, customMcp: policy.customMcp, memories: policy.memories, litMcp: policy.litMcp, mcpSkills: policy.mcpSkills, localSkills: policy.localSkills },
      prefs: { web: prefs.web, approvalMode: prefs.approvalMode, model: prefs.model },
      limits: { attachments: MAX_ATTACHMENTS },
    };
  },

  aiListThreads(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return { threads: listThreads(userId, spaceId, typeof body?.query === 'string' ? body.query : undefined, Number(body?.limit) || 100).map((t) => threadJson(t)) };
  },

  /** A chat with its messages — the owner's, or a chat shared read-only with the workspace. Opening marks it read. */
  aiGetThread(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    // a shared chat is shared with the workspace: members who see workspace-wide content, not restricted members
    const v = getThreadForViewer(String(body?.threadId ?? ''), userId, (sid) => isMember(sid, userId) && !isRestrictedMember(getRecord<SpaceRecord>('space', sid), userId));
    if (!v) throw new ApiError('This chat doesn’t exist or was deleted.', 404);
    if (v.owner && body?.markRead !== false) markRead(v.thread.id);
    return { thread: { ...threadJson(v.thread, userId), unread: false }, messages: listMessages(v.thread.id).map(messageJson), readOnly: !v.owner };
  },

  aiRenameThread(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const t = getThread(String(body?.threadId ?? ''), userId);
    if (!t) throw new ApiError('This chat doesn’t exist or was deleted.', 404);
    renameThread(t.id, String(body?.title ?? '').trim());
    return { thread: threadJson(getThread(t.id, userId)!) };
  },

  aiDeleteThread(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const t = getThread(String(body?.threadId ?? ''), userId);
    if (t) deleteThread(t.id);
    return {};
  },

  /** Create an empty chat (e.g. "New chat" with a draft) — threads are otherwise created by the first message. */
  aiCreateThread(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return { thread: threadJson(createThread(userId, spaceId, chatTitleFrom(String(body?.title ?? '')), body?.pageId ?? null)) };
  },

  /** Pin / unpin a chat (sidebar "Pinned" section). */
  aiPinThread(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const t = getThread(String(body?.threadId ?? ''), userId);
    if (!t) throw new ApiError('This chat doesn’t exist or was deleted.', 404);
    setPinned(t.id, !!body?.pinned);
    return { thread: threadJson(getThread(t.id, userId)!) };
  },

  aiSetThreadIcon(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const t = getThread(String(body?.threadId ?? ''), userId);
    if (!t) throw new ApiError('This chat doesn’t exist or was deleted.', 404);
    const icon = typeof body?.icon === 'string' && body.icon.trim() ? body.icon.trim().slice(0, 16) : null;
    if (icon && /^(https?:|javascript:|data:)/i.test(icon)) throw new ApiError('Choose an emoji', 400);
    setThreadIcon(t.id, icon);
    return { thread: threadJson(getThread(t.id, userId)!) };
  },

  /** Pin the chat to a model (model picker); "auto" lets the service choose. */
  aiSetThreadModel(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const t = getThread(String(body?.threadId ?? ''), userId);
    if (!t) throw new ApiError('This chat doesn’t exist or was deleted.', 404);
    const pol = workspaceAiPolicy(t.spaceId);
    const r = resolveModel(String(body?.model ?? AUTO), pol.allowedModels, { fableEnabled: pol.fable });
    if (!r.honored) throw new ApiError('This model isn’t available in this workspace.', 403);
    setThreadModel(t.id, r.choice);
    return { thread: threadJson(getThread(t.id, userId)!) };
  },

  /** "Share chat": anyone in the workspace with the link can view it (read-only). */
  aiShareThread(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const t = getThread(String(body?.threadId ?? ''), userId);
    if (!t) throw new ApiError('This chat doesn’t exist or was deleted.', 404);
    setShared(t.id, !!body?.shared);
    return { thread: threadJson(getThread(t.id, userId)!) };
  },

  /** Settings → Public pages → Shared AI chats: your shared chats (owners/admins: everyone's). */
  aiSharedThreads(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const admin = isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId);
    return {
      threads: sharedThreads(spaceId).filter((t) => admin || t.userId === userId).map((t) => ({ ...threadJson(t), ownerId: t.userId, ownerName: getRecord<UserRecord>('lit_user', t.userId)?.name ?? '' })),
    };
  },

  /** Answer an approval card ("Continue" / "Reject"). */
  aiApprove(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const decision = body?.decision === 'accept' ? 'accept' : 'decline';
    if (!decideApproval(userId, String(body?.approvalId ?? ''), decision)) throw new ApiError('This request is no longer waiting for approval.', 409);
    return { ok: true };
  },

  /** Undo the workspace changes of one agent answer ("Changes made" → Undo). */
  aiUndoChanges(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const m = getMessage(String(body?.messageId ?? ''));
    const t = m ? getThread(m.threadId, userId) : null;
    if (!m || !t) throw new ApiError('There are no changes to undo.', 404);
    try {
      const r = undoTurn(userId, m.id);
      return { ...r, changes: turnChanges(m.id) };
    } catch (e) {
      if (e instanceof AiError && e.status === 409) throw new ApiError(e.message, 409);
      fail(e);
    }
  },

  /** 👍 / 👎 on an answer (Share positive / negative feedback). */
  aiFeedback(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const m = getMessage(String(body?.messageId ?? ''));
    const t = m ? getThread(m.threadId, userId) : null;
    if (!m || !t || m.role !== 'assistant') throw new ApiError('Not found', 404);
    const rating = body?.rating === 'positive' || body?.rating === 'negative' ? body.rating : null;
    const data = { ...m.data };
    if (rating) data.feedback = { rating, ...(typeof body?.comment === 'string' && body.comment.trim() ? { comment: body.comment.trim().slice(0, 2000) } : {}), time: Date.now() };
    else delete data.feedback;
    updateMessage(m.id, data);
    return { feedback: data.feedback ?? null };
  },

  /**
   * Non-streaming chat turn. Body: { spaceId, threadId?, text, pageId?, mentions?, retry?, retrieve?, mode?, … }
   * → { threadId, message, status }. Legacy body { messages: [{role,text}] } runs a stateless chat.
   */
  async aiChat(ctx: Ctx, body: any) {
    const userId = modelCall(ctx);
    try {
      if (Array.isArray(body?.messages)) {
        const msgs = body.messages.filter((m: any) => m && (m.role === 'user' || m.role === 'assistant'));
        const lastUser = [...msgs].reverse().find((m: any) => m.role === 'user');
        const spaceId = String(body.spaceId ?? '');
        const prep = prepareChatTurn(parseChatParams(userId, { spaceId, text: lastUser?.text ?? lastUser?.content ?? '' }));
        const res = await executeChatTurn(prep);
        if (res.error) throw new ApiError(res.error.message, res.error.code === 'rate_limited' ? 429 : 400);
        return { text: res.message?.data.text ?? '', threadId: res.threadId };
      }
      const prep = prepareChatTurn(parseChatParams(userId, body));
      const res = await executeChatTurn(prep);
      return { threadId: res.threadId, status: res.status, message: res.message ? messageJson(res.message) : null, error: res.error ?? null, title: res.title ?? null };
    } catch (e) {
      fail(e);
    }
  },

  /**
   * Non-streaming inline writer. Body: { pageId?, skill, prompt?, selection?, before?, language?, tone?, previous?, skillId?, mentions? }
   * → { text, status, error? }
   */
  async aiComplete(ctx: Ctx, body: any) {
    const userId = modelCall(ctx);
    try {
      const req = prepareWriter({ ...body, userId });
      return await executeSimple('complete', req);
    } catch (e) {
      fail(e);
    }
  },

  /** Non-streaming AI block generation. Body: { blockId, prompt?, output? } → { text, status, error? } */
  async aiGenerateBlock(ctx: Ctx, body: any) {
    const userId = modelCall(ctx);
    try {
      return await executeSimple('block', prepareAiBlock({ userId, blockId: String(body?.blockId ?? ''), prompt: body?.prompt, output: body?.output, search: !!body?.search }));
    } catch (e) {
      fail(e);
    }
  },

  /**
   * Database AI Autofill. Body: { rowId, propId, kind: 'summary'|'keywords'|'translation'|'custom', prompt?, language? }
   * → { text, value } where `value` is the property-encoded decoration (select [["A"]], multi_select [["A,B"]] …).
   * The caller writes `value` with a transaction (see apps/web/src/features/ai/autofill.ts).
   */
  async aiAutofill(ctx: Ctx, body: any) {
    const userId = modelCall(ctx);
    try {
      const kind = AUTOFILL_KINDS[String(body?.kind ?? 'custom').toLowerCase()] ?? 'custom';
      return await runAutofill({
        userId, rowId: String(body?.rowId ?? ''), propId: String(body?.propId ?? ''), kind,
        prompt: typeof body?.prompt === 'string' ? body.prompt : undefined, language: typeof body?.language === 'string' ? body.language : undefined,
      });
    } catch (e) {
      fail(e);
    }
  },

  /** Workspace Q&A ("Search or ask"): FTS retrieval + cited answer. Body: { spaceId, query } → { answer, sources } */
  async aiQuery(ctx: Ctx, body: any) {
    const userId = modelCall(ctx);
    try {
      return await runQuery({ userId, spaceId: String(body?.spaceId ?? ''), query: String(body?.query ?? '') });
    } catch (e) {
      fail(e);
    }
  },

  // ------------------------------------------------------------------------------------------- Skills

  /** Library → Skills: { enabled: [...], discover: [...] } */
  aiListSkills(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const r = listSkills(userId, spaceId);
    return { enabled: r.enabled.map(skillJson), discover: r.discover.map(skillJson) };
  },

  /** "Enable for me" / "Uninstall" (per user). Built-ins are hidden per user. */
  async aiSetSkillEnabled(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const id = String(body?.skillId ?? '');
    const on = !!body?.enabled;
    const s = settingsOf(userId);
    return guarded(() => {
      if (id.startsWith('builtin:')) {
        const off = new Set(Array.isArray(s.ai_skills_disabled) ? (s.ai_skills_disabled as string[]) : []);
        if (on) off.delete(id.slice(8));
        else off.add(id.slice(8));
        saveUserSettings(userId, spaceId, { ai_skills_disabled: [...off] });
      } else {
        const b = getRecord<BlockRecord>('block', id);
        if (!b || b.alive === false || blockRole(id, userId) === 'none' || !isSkillPage(b)) throw new ApiError('That skill doesn’t exist.', 404);
        const list = new Set(Array.isArray(s.ai_skills_enabled) ? (s.ai_skills_enabled as string[]) : []);
        // rows of a skills database enabled as a whole are turned off one by one
        const off = new Set(Array.isArray(s.ai_skills_rows_off) ? (s.ai_skills_rows_off as string[]) : []);
        if (on) {
          list.add(id);
          off.delete(id);
        } else {
          list.delete(id);
          if (b.parent_table === 'collection') off.add(id);
        }
        saveUserSettings(userId, spaceId, { ai_skills_enabled: [...list], ai_skills_rows_off: [...off] });
      }
      return { ok: true };
    });
  },

  /** "Use automatically" switch of a skill (per user). */
  async aiSetSkillAutomatic(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const id = String(body?.skillId ?? '');
    const s = settingsOf(userId);
    const manual = new Set(Array.isArray(s.ai_skills_manual) ? (s.ai_skills_manual as string[]) : []);
    if (body?.automatic) manual.delete(id);
    else manual.add(id);
    return guarded(() => {
      saveUserSettings(userId, spaceId, { ai_skills_manual: [...manual] });
      return { ok: true };
    });
  },

  /** Page ••• → Use with AI → Use as AI skill: flags the page as a skill (needs edit access) and enables it for the user. */
  async aiRegisterSkill(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const page = getRecord<BlockRecord>('block', String(body?.pageId ?? ''));
    if (!page || page.alive === false || (page.type !== 'page')) throw new ApiError('Only pages can be used as skills.', 400);
    const spaceId = member(page.space_id, userId);
    if (!roleAtLeast(blockRole(page.id, userId), 'read_and_write')) throw new ApiError('You need edit access to use this page as a skill.', 403);
    return guarded(() => {
      const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 240) : undefined;
      applyTransactions(userId, [{
        id: newId(), spaceId, debug: { userAction: 'ai.skill.register' },
        operations: [mk.update({ table: 'block', id: page.id, spaceId }, ['format'], { ai_skill: { enabled: true, ...(description ? { description } : {}) } })],
      }], undefined, { client: true });
      const s = settingsOf(userId);
      const list = new Set(Array.isArray(s.ai_skills_enabled) ? (s.ai_skills_enabled as string[]) : []);
      list.add(page.id);
      saveUserSettings(userId, spaceId, { ai_skills_enabled: [...list] });
      return { skill: skillJson(skillById(page.id, userId, spaceId)!) };
    });
  },

  /** "Unset page as skill" (needs edit access). */
  async aiUnsetSkill(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const page = getRecord<BlockRecord>('block', String(body?.pageId ?? ''));
    if (!page || page.alive === false) throw new ApiError('Not found', 404);
    const spaceId = member(page.space_id, userId);
    if (!roleAtLeast(blockRole(page.id, userId), 'read_and_write')) throw new ApiError('You need edit access to change this skill.', 403);
    return guarded(() => {
      applyTransactions(userId, [{ id: newId(), spaceId, debug: { userAction: 'ai.skill.unset' }, operations: [mk.update({ table: 'block', id: page.id, spaceId }, ['format'], { ai_skill: undefined })] }], undefined, { client: true });
      return { ok: true };
    });
  },

  /** "New skill": a private skill page with a short template, enabled for the user. */
  /** Chat table › "Save as database" : the table becomes a private database of the person. */
  aiTableToDatabase(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const sv = spaceViewOf(userId, spaceId);
    if (!sv) throw new ApiError('Not allowed', 403);
    if (!hit(`ai-table-db:${userId}`, 20, 60_000)) throw new ApiError('Too many requests. Try again in a minute.', 429);
    const cell = (v: unknown) => String(v ?? '').replace(/[\u0000-\u0008]/g, '').slice(0, 2000);
    const header = Array.isArray(body?.header) ? body.header.slice(0, 50).map(cell) : [];
    if (!header.length) throw new ApiError('This table has no columns.', 400);
    const rows = Array.isArray(body?.rows) ? body.rows.slice(0, 1000).map((r: unknown) => (Array.isArray(r) ? r.slice(0, 50).map(cell) : [])) : [];
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 200) : 'Table from Litpage AI';
    return guarded(() => {
      const spec = rowsToDb(title, [header, ...rows]);
      const b = new OpsBuilder(spaceId, userId);
      const id = placeUnder(b, { kind: 'private', spaceId, spaceViewId: sv.id, title: 'Private' }, userId, { type: 'collection_view_page', db: spec });
      applyTransactions(userId, [{ id: newId(), spaceId, debug: { userAction: 'ai.table.saveAsDatabase' }, operations: b.ops }], undefined, { client: true });
      return { pageId: id, rows: spec.rows.length };
    });
  },

  async aiCreateSkill(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const sv = spaceViewOf(userId, spaceId);
    if (!sv) throw new ApiError('Not allowed', 403);
    const title = typeof body?.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 120) : 'New skill';
    return guarded(() => {
      const id = newId();
      const p1 = newId();
      const p2 = newId();
      const now = Date.now();
      const meta = { space_id: spaceId, alive: true, created_time: now, created_by_id: userId, created_by_table: 'lit_user', last_edited_time: now, last_edited_by_id: userId, last_edited_by_table: 'lit_user' };
      const ops = [
        mk.set({ table: 'block', id, spaceId }, [], { id, type: 'page', properties: { title: [[title]] }, format: { page_icon: '🧠', ai_skill: { enabled: true } }, content: [p1, p2], parent_id: spaceId, parent_table: 'space', permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }], ...meta }),
        mk.set({ table: 'block', id: p1, spaceId }, [], { id: p1, type: 'text', properties: { title: [['Describe when Litpage AI should use this skill.']] }, parent_id: id, parent_table: 'block', ...meta }),
        mk.set({ table: 'block', id: p2, spaceId }, [], { id: p2, type: 'text', properties: { title: [['Write the steps or instructions Litpage AI should follow.']] }, parent_id: id, parent_table: 'block', ...meta }),
        mk.listBefore({ table: 'space_view', id: sv.id, spaceId }, ['private_pages'], id),
      ];
      applyTransactions(userId, [{ id: newId(), spaceId, debug: { userAction: 'ai.skill.create' }, operations: ops }], undefined, { client: true });
      const s = settingsOf(userId);
      saveUserSettings(userId, spaceId, { ai_skills_enabled: [...new Set([...(Array.isArray(s.ai_skills_enabled) ? (s.ai_skills_enabled as string[]) : []), id])] });
      return { pageId: id };
    });
  },

  /**
   * "Edit skill" (pencil next to a built-in skill in the selection menu / ⋮⋮ › Skills): built-ins become your own
   * editable skill page — the first time a private copy with the built-in's description and instructions (enabled for
   * you, the built-in hidden for you so the copy takes its place), later the same page again.
   */
  async aiCustomizeBuiltinSkill(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const key = typeof body?.skill === 'string' ? body.skill.trim().toLowerCase() : '';
    const b = BUILTIN_SKILLS.find((x) => x.id === key || x.name.toLowerCase() === key || `builtin:${x.id}` === key);
    if (!b) throw new ApiError('That skill doesn’t exist.', 404);
    const existing = db.prepare(`SELECT id FROM records WHERE tbl = 'block' AND space_id = ? AND alive = 1 AND json_extract(data, '$.format.ai_skill.builtin_of') = ? AND json_extract(data, '$.created_by_id') = ? LIMIT 1`)
      .get(spaceId, b.id, userId) as { id: string } | undefined;
    if (existing && blockRole(existing.id, userId) !== 'none') return { pageId: existing.id, created: false };
    const sv = spaceViewOf(userId, spaceId);
    if (!sv) throw new ApiError('Not allowed', 403);
    return guarded(() => {
      const id = newId();
      const p1 = newId();
      const p2 = newId();
      const now = Date.now();
      const meta = { space_id: spaceId, alive: true, created_time: now, created_by_id: userId, created_by_table: 'lit_user', last_edited_time: now, last_edited_by_id: userId, last_edited_by_table: 'lit_user' };
      const ops = [
        mk.set({ table: 'block', id, spaceId }, [], { id, type: 'page', properties: { title: [[b.name]] }, format: { page_icon: '🧠', ai_skill: { enabled: true, description: b.description, builtin_of: b.id } }, content: [p1, p2], parent_id: spaceId, parent_table: 'space', permissions: [{ type: 'user_permission', role: 'editor', user_id: userId }], ...meta }),
        mk.set({ table: 'block', id: p1, spaceId }, [], { id: p1, type: 'text', properties: { title: [[b.description]] }, parent_id: id, parent_table: 'block', ...meta }),
        mk.set({ table: 'block', id: p2, spaceId }, [], { id: p2, type: 'text', properties: { title: [[b.instructions]] }, parent_id: id, parent_table: 'block', ...meta }),
        mk.listBefore({ table: 'space_view', id: sv.id, spaceId }, ['private_pages'], id),
      ];
      applyTransactions(userId, [{ id: newId(), spaceId, debug: { userAction: 'ai.skill.customizeBuiltin' }, operations: ops }], undefined, { client: true });
      const s = settingsOf(userId);
      const list = (k: string) => (Array.isArray(s[k]) ? (s[k] as string[]) : []);
      saveUserSettings(userId, spaceId, { ai_skills_enabled: [...new Set([...list('ai_skills_enabled'), id])], ai_skills_disabled: [...new Set([...list('ai_skills_disabled'), b.id])] });
      return { pageId: id, created: true };
    });
  },

  /** SKILL.md for local agents ("Download for local agents"). */
  aiSkillFile(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    if (!workspaceAiPolicy(spaceId).localSkills) throw new ApiError('Local skill downloads are turned off in this workspace.', 403);
    const s = skillById(String(body?.skillId ?? ''), userId, spaceId);
    if (!s) throw new ApiError('That skill doesn’t exist.', 404);
    const slug = s.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'skill';
    return { filename: `${slug}/SKILL.md`, markdown: skillMarkdown(s) };
  },

  // ------------------------------------------------------------------------------------------- MCP connections (agent)

  aiListConnections(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const policy = workspaceAiPolicy(spaceId);
    return { connections: listConnections(userId, spaceId), customMcp: policy.customMcp };
  },

  async aiAddConnection(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(async () => ({ connection: await addConnection(userId, spaceId, body ?? {}) }));
  },

  async aiRefreshConnection(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    return guarded(async () => ({ connection: await refreshConnection(userId, String(body?.id ?? '')) }));
  },

  aiUpdateConnection(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    return guarded(() => ({ connection: updateConnection(userId, String(body?.id ?? ''), body ?? {}) }));
  },

  aiRemoveConnection(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    removeConnection(userId, String(body?.id ?? ''));
    return {};
  },

  /**
   * Settings › AI › approved custom MCP servers (owners): the approved list of URL patterns and whether it is in
   * effect (space.settings.ai_mcp_allowlist / ai_mcp_allowlist_enabled; the MCP allowlist validation rules).
   */
  aiUpdateMcpAllowlist(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    if (!isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId)) throw new ApiError('Only workspace owners can do this.', 403);
    const before = workspaceAiPolicy(spaceId);
    let list = [...before.mcpAllowlist];
    const patch: Record<string, unknown> = {};
    let added = '';
    let removed = '';
    if (typeof body?.add === 'string') {
      const problem = mcpAllowlistProblem(body.add, list);
      if (problem) throw new ApiError(problem, 400);
      added = body.add.trim();
      list = [...list, added].slice(0, 200);
      patch.ai_mcp_allowlist = list;
    }
    if (typeof body?.remove === 'string' && list.includes(body.remove)) {
      removed = body.remove;
      list = list.filter((x) => x !== removed);
      patch.ai_mcp_allowlist = list;
    }
    // the list is in effect once its switch was used (older workspaces: while it isn't empty)
    patch.ai_mcp_allowlist_enabled = typeof body?.enabled === 'boolean' ? body.enabled : before.mcpAllowlistOn;
    applyTransactions(userId, [{ id: newId(), spaceId, debug: { userAction: 'ai.mcpAllowlist' }, operations: [mk.update({ table: 'space', id: spaceId, spaceId }, ['settings'], patch)] }], ctx.clientId, { client: true });
    if (added) audit('workspace.settings.mcp_server_added_to_allowlist', { spaceId, actorId: userId, data: { url: added } });
    if (removed) audit('workspace.settings.mcp_server_removed_from_allowlist', { spaceId, actorId: userId, data: { url: removed } });
    const after = workspaceAiPolicy(spaceId);
    return { allowlist: after.mcpAllowlist, enabled: after.mcpAllowlistOn };
  },

  /** Workspace owners: remove every member's custom MCP connection. */
  aiDisconnectAllConnections(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    if (!isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId)) throw new ApiError('Only workspace owners can do this.', 403);
    return { removed: removeAllConnections(spaceId) };
  },

  // ------------------------------------------------------------------------------------------- MCP server tokens

  mcpListTokens(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => ({ tokens: listTokens(userId, spaceId, !!body?.all) }));
  },

  mcpCreateToken(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => createToken(userId, spaceId, String(body?.name ?? '')));
  },

  mcpRevokeToken(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    return guarded(() => {
      revokeToken(userId, String(body?.tokenId ?? ''));
      return {};
    });
  },

  /** Settings › MCP › Enabled clients › Disable / Remove: the caller's tokens connected with that client stop. */
  mcpDisableMyClient(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => ({ revoked: disableMyClient(userId, spaceId, body?.client ?? {}) }));
  },

  mcpRevokeAll(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => ({ revoked: revokeAll(userId, spaceId) }));
  },

  // ------------------------------------------------------------------------------------------- Workspace shared MCPs 

  /** Members: the workspace's shared MCP servers ("Workspace Managed" in Add connection). */
  mcpListPresets(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return { presets: listPresets(spaceId), canManage: isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId) };
  },

  /** Owners: New workspace MCP → Add MCP server (approved by its creation). */
  mcpCreatePreset(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    if (!isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId)) throw new ApiError('Only workspace owners can share MCP servers with the workspace.', 403);
    return guarded(() => {
      const preset = createPreset(userId, spaceId, body ?? {});
      audit('workspace.settings.mcp_server_added_to_allowlist', { spaceId, actorId: userId, data: { name: preset.name, url: preset.url } });
      return { preset, presets: listPresets(spaceId) };
    });
  },

  mcpDeletePreset(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    if (!isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId)) throw new ApiError('Only workspace owners can remove workspace MCPs.', 403);
    const gone = listPresets(spaceId).find((p) => p.id === body?.presetId);
    if (deletePreset(spaceId, String(body?.presetId ?? '')) && gone) audit('workspace.settings.mcp_server_removed_from_allowlist', { spaceId, actorId: userId, data: { name: gone.name, url: gone.url } });
    return { presets: listPresets(spaceId) };
  },

  // ------------------------------------------------------------------------------------------- MCP clients (owners)

  /** All MCP clients (connected or approved), the approved-only switch and the client catalog. */
  mcpListClients(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => ({ ...listClients(userId, spaceId), catalog: MCP_CLIENT_CATALOG.map((c) => ({ key: c.key, name: c.name, caption: c.caption })) }));
  },

  mcpClientMembers(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => ({ members: clientMembers(userId, spaceId, String(body?.key ?? '')) }));
  },

  /** Disconnect one member (memberId) or every member from a client. */
  mcpDisconnectClient(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => ({ revoked: disconnectClient(userId, spaceId, String(body?.key ?? ''), typeof body?.memberId === 'string' ? body.memberId : undefined) }));
  },

  mcpSetClientRestriction(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => {
      setClientRestriction(userId, spaceId, body?.restricted === true);
      return listClients(userId, spaceId);
    });
  },

  mcpApproveClients(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    const keys = Array.isArray(body?.keys) ? body.keys.filter((k: unknown): k is string => typeof k === 'string').slice(0, 100) : [];
    return guarded(() => ({ added: approveClients(userId, spaceId, keys), ...listClients(userId, spaceId) }));
  },

  mcpRemoveApprovedClient(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => {
      removeApprovedClient(userId, spaceId, String(body?.key ?? ''));
      return listClients(userId, spaceId);
    });
  },

  mcpRenameClient(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    return guarded(() => {
      renameClient(userId, spaceId, String(body?.key ?? ''), String(body?.name ?? ''));
      return listClients(userId, spaceId);
    });
  },

  // ------------------------------------------------------------------------------------------- Usage (owners/admins)

  /** Settings → AI → Usage: chats and messages per member over the last 30 days. */
  aiUsage(ctx: Ctx, body: any) {
    const userId = uid(ctx);
    const spaceId = member(body?.spaceId, userId);
    if (!isSpaceOwner(getRecord<SpaceRecord>('space', spaceId), userId)) throw new ApiError('Only workspace owners can see AI usage.', 403);
    const since = Date.now() - 30 * 86_400_000;
    const rows = db.prepare(`SELECT t.user_id AS user_id, COUNT(DISTINCT t.id) AS chats, COUNT(m.id) AS messages, MAX(m.created_time) AS last
      FROM ai_threads t JOIN ai_messages m ON m.thread_id = t.id AND m.role = 'user' AND m.created_time >= ?
      WHERE t.space_id = ? GROUP BY t.user_id ORDER BY messages DESC`).all(since, spaceId) as { user_id: string; chats: number; messages: number; last: number }[];
    const changes = db.prepare('SELECT user_id, COUNT(DISTINCT turn_id) AS n FROM ai_changes WHERE space_id = ? AND created_time >= ? GROUP BY user_id').all(spaceId, since) as { user_id: string; n: number }[];
    const edits = new Map(changes.map((c) => [c.user_id, c.n]));
    return {
      members: rows.map((r) => ({ userId: r.user_id, name: getRecord<UserRecord>('lit_user', r.user_id)?.name ?? '', chats: r.chats, messages: r.messages, edits: edits.get(r.user_id) ?? 0, lastUsed: r.last })),
      totals: { chats: rows.reduce((a, r) => a + r.chats, 0), messages: rows.reduce((a, r) => a + r.messages, 0), edits: [...edits.values()].reduce((a, n) => a + n, 0) },
    };
  },
};

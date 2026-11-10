// Form endpoints (DB-FORM-*): the respondent view of a form view (`/form/<viewId>` share links, preview) and
// submissions that become rows of the form's data source. Permission model follows the form share menu
// ("Who can fill out": Anyone at {space} with link / Anyone on the web with link / No access) and
// "Access to submission" (role granted on the created page). Writes go through applyTransactions; anonymous or
// non-editor respondents write with the form owner's access (form responses are also written server-side).
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, CollectionViewRecord, PropertySchema, SpaceRecord, UserRecord } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import {
  PUBLIC_UNSUPPORTED_TYPES, encodeAnswer, formConfigOf, questionName, supportsQuestion, validateAnswer, visibleQuestionIds, type FormAnswer, type FormConfig,
} from '@nc/shared/form/index.ts';
import { instantiateTemplate } from '../../automations/templates.ts';
import { sendMail } from '../../mail.ts';
import { childrenOf, getRecord } from '../../db.ts';
import { applyTransactions, blockRole, RecordMapBuilder } from '../../records.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { exemptIp, hit } from '../../ratelimit.ts';
import { canWriteNewRow } from '../../propaccess.ts';
import { audit } from '../../audit.ts';

interface Loaded {
  view: CollectionViewRecord;
  block: BlockRecord;
  collection: CollectionRecord;
  space: SpaceRecord | undefined;
  form: FormConfig;
}

function load(viewId: string): Loaded | null {
  const view = viewId ? getRecord<CollectionViewRecord>('collection_view', viewId) : undefined;
  if (!view || view.alive === false || view.type !== 'form') return null;
  const block = getRecord<BlockRecord>('block', view.parent_id);
  if (!block || block.alive === false || !(block.view_ids ?? []).includes(view.id)) return null;
  // a form writes into the data source hosted by the block it lives on — never into another database named by the
  // view or block format (those pointers are user-editable)
  // (a database with several data sources: the view's own source, still one the block owns — )
  const pointer = (view.format as any)?.collection_pointer?.id as string | undefined;
  const cid = pointer ?? block.collection_id ?? ((block.format as any)?.collection_pointer?.id as string | undefined);
  if (!cid) return null;
  const collection = getRecord<CollectionRecord>('collection', cid);
  if (!collection || collection.alive === false || collection.parent_id !== block.id) return null;
  const form = formConfigOf(view.format);
  if (!form) return null;
  return { view, block, collection, space: getRecord<SpaceRecord>('space', collection.space_id), form };
}

function isMember(space: SpaceRecord | undefined, userId: string | null): boolean {
  return !!space && !!userId && (space.permissions ?? []).some((p) => p.user_id === userId && p.role !== 'none');
}

/** Can `userId` add rows to the form's data source (role on the block hosting the collection)? */
function canEdit(l: Loaded, userId: string | null): boolean {
  return !!userId && roleAtLeast(blockRole(l.collection.parent_id, userId), 'read_and_write') && roleAtLeast(blockRole(l.block.id, userId), 'read_and_write');
}

type Access = 'ok' | 'closed' | 'login' | 'denied';

function access(l: Loaded, userId: string | null, preview: boolean): Access {
  if (preview && canEdit(l, userId)) return 'ok';
  const perm = l.form.permission ?? 'space';
  if (perm === 'closed') return 'closed';
  if (perm === 'public') return l.space?.disable_public_access ? 'denied' : 'ok';
  if (!userId) return 'login';
  return isMember(l.space, userId) || canEdit(l, userId) ? 'ok' : 'denied';
}

function userName(u: UserRecord | undefined): string {
  return u?.name || [u?.given_name, u?.family_name].filter(Boolean).join(' ') || u?.email || 'Unknown';
}

function publicQuestion(l: Loaded, q: FormConfig['questions'][number], isPublic: boolean) {
  const p: PropertySchema | undefined = l.collection.schema[q.config.propertyId];
  if (!p || !supportsQuestion(p)) return null;
  if (isPublic && PUBLIC_UNSUPPORTED_TYPES.has(p.type)) return null;
  return {
    id: q.id,
    propertyId: q.config.propertyId,
    type: p.type,
    name: questionName(q, l.collection.schema),
    description: q.config.hasDescription ? q.config.description ?? '' : '',
    required: !!q.config.isRequired,
    longAnswer: !!q.config.isLongAnswer,
    displayMode: q.config.displayMode ?? (p.type === 'select' || p.type === 'multi_select' ? 'list' : undefined),
    checkboxLabel: q.config.checkboxLabel ?? '',
    maxSelection: q.config.maxSelection,
    // conditional logic : asked only when the trigger question's answer matches
    condition: q.config.condition,
    options: (p.options ?? []).map((o) => ({ id: o.id, value: o.value, color: o.color })),
    numberFormat: p.number_format,
    relationCollectionId: p.type === 'relation' ? (p.collection_id as string | undefined) : undefined,
    relationLimit: p.type === 'relation' ? (p.limit as number | undefined) : undefined,
  };
}

/** Plain text of a stored property value for the emailed copy of a response. */
function valueText(p: PropertySchema, v: unknown): string {
  const rt = Array.isArray(v) ? (v as unknown[][]) : [];
  const parts: string[] = [];
  for (const d of rt) {
    const ann = (Array.isArray(d?.[1]) ? d[1] : []) as unknown[][];
    const a = ann.find((x) => Array.isArray(x) && ['d', 'u', 'p', 'plc'].includes(String(x[0])));
    if (!a) {
      if (String(d?.[0] ?? '') !== ',') parts.push(String(d?.[0] ?? ''));
      continue;
    }
    if (a[0] === 'd') {
      const dt = a[1] as { start_date?: string; end_date?: string; start_time?: string };
      parts.push([dt.start_date, dt.start_time].filter(Boolean).join(' ') + (dt.end_date ? ` → ${dt.end_date}` : ''));
    } else if (a[0] === 'u') parts.push(userName(getRecord<UserRecord>('lit_user', String(a[1]))));
    else if (a[0] === 'p') parts.push(toPlainText(getRecord<BlockRecord>('block', String(a[1]))?.properties?.title as any) || 'Untitled');
    else if (a[0] === 'plc') parts.push(String((a[1] as { name?: string })?.name ?? ''));
  }
  const text = parts.filter(Boolean).join(', ');
  return p.type === 'multi_select' ? text.split(',').map((x) => x.trim()).filter(Boolean).join(', ') : text;
}

export const handlers = {
  /** Respondent view of a form: {status, form?} — status ok | closed | login | denied | notfound. */
  getPublicForm(ctx: Ctx, { viewId, preview }: { viewId: string; preview?: boolean }) {
    const l = load(String(viewId ?? ''));
    if (!l) return { status: 'notfound' };
    const st = access(l, ctx.userId, !!preview);
    const spaceName = l.space?.name ?? 'this workspace';
    if (st !== 'ok') return { status: st, spaceName };
    const isPublic = (l.form.permission ?? 'space') === 'public' && !(preview && canEdit(l, ctx.userId));
    const anonymous = isPublic || !!l.form.anonymous || !ctx.userId;
    const me = ctx.userId ? getRecord<UserRecord>('lit_user', ctx.userId) : undefined;
    const rm = new RecordMapBuilder(ctx.userId);
    // people pickers need the workspace members; relation pickers the related rows (internal forms only)
    const members: { id: string; name: string; email?: string }[] = [];
    if (!isPublic && l.space) {
      for (const p of l.space.permissions ?? []) {
        if (!p.user_id || p.role === 'none') continue;
        const u = getRecord<UserRecord>('lit_user', p.user_id);
        if (u) members.push({ id: u.id, name: userName(u), email: u.email });
      }
    }
    const relationRows: Record<string, { id: string; title: string }[]> = {};
    const questions = l.form.questions.map((q) => publicQuestion(l, q, isPublic)).filter((q): q is NonNullable<typeof q> => !!q);
    for (const q of questions) {
      if (q.type !== 'relation' || !q.relationCollectionId || relationRows[q.relationCollectionId]) continue;
      const target = getRecord<CollectionRecord>('collection', q.relationCollectionId);
      // relation pickers list rows only to signed-in respondents who can read the related database
      if (!target || !ctx.userId || blockRole(target.parent_id, ctx.userId) === 'none') continue;
      relationRows[q.relationCollectionId] = childrenOf<BlockRecord>('block', target.id)
        .filter((b) => b.parent_table === 'collection' && b.alive && !b.is_template)
        .slice(0, 500)
        .map((b) => ({ id: b.id, title: toPlainText(b.properties?.title as any) || 'Untitled' }));
    }
    return {
      status: 'ok',
      spaceName,
      form: {
        viewId: l.view.id,
        blockId: l.block.id,
        collectionId: l.collection.id,
        spaceId: l.collection.space_id,
        title: l.form.title ?? '',
        description: l.form.description ?? '',
        icon: l.form.icon,
        cover: l.form.cover,
        permission: l.form.permission ?? 'space',
        anonymous,
        submitAs: anonymous || !me ? null : { id: me.id, name: userName(me), photo: me.profile_photo },
        submitScreen: l.form.submitScreen ?? {},
        questions,
        members,
        relationRows,
      },
      recordMap: rm.map,
    };
  },

  /** "Email me a copy" on the confirmation screen (Form settings › Submit screen › More buttons): the respondent's own
   *  address when signed in, else the address typed on a public form. Only for a response just made with this form. */
  emailFormResponse(ctx: Ctx, { viewId, pageId, email }: { viewId: string; pageId: string; email?: string }) {
    const l = load(String(viewId ?? ''));
    if (!l) throw new ApiError('This form is closed or no longer available.', 404);
    if (!l.form.submitScreen?.allowEmailResponse) throw new ApiError('Not allowed', 403);
    const page = getRecord<BlockRecord>('block', String(pageId ?? ''));
    const resp = (page?.format as { form_response?: { form_view_id?: string; anonymous?: boolean } } | undefined)?.form_response;
    if (!page || page.alive === false || page.parent_id !== l.collection.id || resp?.form_view_id !== l.view.id) throw new ApiError('Not found', 404);
    if (Date.now() - (page.created_time ?? 0) > 3600_000) throw new ApiError('This response can no longer be emailed.', 410);
    const who = ctx.userId ? `user:${ctx.userId}` : `ip:${ctx.ip ?? '-'}`;
    if (!hit(`form-email:${who}`, 10, 3600_000) || !hit(`form-email:page:${page.id}`, 3, 3600_000)) throw new ApiError('Too many requests. Try again later.', 429);
    let to = '';
    if (ctx.userId && !resp?.anonymous && page.created_by_id === ctx.userId) to = getRecord<UserRecord>('lit_user', ctx.userId)?.email ?? '';
    else if (resp?.anonymous) to = String(email ?? '').trim().toLowerCase();
    if (!/^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/.test(to)) throw new ApiError('We could not deliver to that email address. Try another address.', 400);
    const title = l.form.title?.trim() || toPlainText(l.collection.name as any) || 'Form';
    const lines: string[] = [];
    for (const q of l.form.questions) {
      const p = l.collection.schema[q.config.propertyId];
      if (!p || !supportsQuestion(p)) continue;
      const v = (page.properties as Record<string, unknown> | undefined)?.[q.config.propertyId];
      const text = v === undefined ? '' : valueText(p, v);
      if (text || p.type === 'checkbox') lines.push(`${questionName(q, l.collection.schema)}: ${p.type === 'checkbox' ? (text === 'Yes' ? 'Yes' : 'No') : text}`);
    }
    const esc = (x: string) => x.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    sendMail({
      to, kind: 'form_response_copy', meta: { viewId: l.view.id, pageId: page.id },
      subject: `Your response to ${title}`,
      text: `Here is a copy of your response to ${title}.\n\n${lines.join('\n')}`,
      html: `<p>Here is a copy of your response to <b>${esc(title)}</b>.</p>${lines.map((x) => `<p>${esc(x)}</p>`).join('')}`,
    });
    return { to };
  },

  /** Create a response row: {answers: {[questionId]: value}} → {pageId} | {errors: {[questionId]: message}}. */
  submitFormResponse(ctx: Ctx, { viewId, answers, preview }: { viewId: string; answers: Record<string, FormAnswer>; preview?: boolean }) {
    const l = load(String(viewId ?? ''));
    if (!l) throw new ApiError('This form is closed or no longer available.', 404);
    // responses can be anonymous: cap them per respondent (session or client address) and per form
    const who = ctx.userId ? `user:${ctx.userId}` : `ip:${ctx.ip ?? '-'}`;
    if ((!exemptIp(ctx.ip) || ctx.userId) && !hit(`form-submit:${who}`, 30, 60_000)) throw new ApiError('Too many responses. Try again in a minute.', 429);
    if (!hit(`form-submit:view:${l.view.id}`, 600, 60_000)) throw new ApiError('This form is receiving too many responses. Try again in a minute.', 429);
    const st = access(l, ctx.userId, !!preview);
    if (st === 'closed') throw new ApiError('This form is closed or no longer available.', 403);
    if (st === 'login') throw new ApiError('Log in to submit, or ask the form owner to publish it.', 401);
    if (st !== 'ok') throw new ApiError('This form is not available publicly.', 403);
    const isPublic = (l.form.permission ?? 'space') === 'public' && !(preview && canEdit(l, ctx.userId));
    const anonymous = isPublic || !!l.form.anonymous || !ctx.userId;
    const schema = l.collection.schema;
    const errors: Record<string, string> = {};
    const properties: Record<string, unknown> = {};
    // questions hidden by conditional logic are neither validated nor saved
    const shown = visibleQuestionIds(l.form.questions, answers ?? {});
    for (const q of l.form.questions) {
      if (!shown.has(q.id)) continue;
      const p = schema[q.config.propertyId];
      if (!p || !supportsQuestion(p) || (isPublic && PUBLIC_UNSUPPORTED_TYPES.has(p.type))) continue;
      const v = (answers ?? {})[q.id];
      const err = validateAnswer(q, p, v);
      if (err) {
        errors[q.id] = err;
        continue;
      }
      let value = v;
      if ((p.type === 'select' || p.type === 'multi_select') && value !== undefined && value !== null) {
        // only existing options can be picked by respondents
        const allowed = new Set((p.options ?? []).map((o) => o.value));
        value = (Array.isArray(value) ? (value as unknown[]).map(String) : [String(value)]).filter((x) => allowed.has(x));
      }
      if (p.type === 'person' && Array.isArray(value)) value = (value as unknown[]).map(String).filter((id) => isMember(l.space, id));
      const enc = encodeAnswer(p, value as FormAnswer, l.collection.space_id);
      if (enc !== undefined) properties[q.config.propertyId] = enc;
    }
    // per-question validation errors come back as data (the form shows them under each question)
    if (Object.keys(errors).length) return { errors };
    // actor: the respondent when they can edit the data source (and every answered property: Property access), else the
    // form owner / database creator — the form's questions are what respondents may fill in
    const respondent = anonymous ? null : ctx.userId;
    const candidates = [respondent, l.form.ownerId, l.block.created_by_id, l.space?.created_by_id, ...(l.space?.permissions ?? []).map((p) => p.user_id)];
    const actor = candidates.find((u): u is string => !!u && canEdit(l, u) && canWriteNewRow(l.collection.id, properties, u, respondent ?? u));
    if (!actor) throw new ApiError('Something went wrong while processing that request.', 500);
    const id = newId();
    const now = Date.now();
    const spaceId = l.collection.space_id;
    const access_ = ['reader', 'comment_only', 'read_and_write', 'editor'].includes(String(l.form.submissionAccess)) ? (l.form.submissionAccess as string) : 'none';
    const record: Record<string, unknown> = {
      id, type: 'page', properties, parent_id: l.collection.id, parent_table: 'collection', space_id: spaceId, alive: true,
      created_time: now, created_by_id: respondent ?? actor, created_by_table: 'lit_user', last_edited_time: now,
      last_edited_by_id: respondent ?? actor, last_edited_by_table: 'lit_user',
      format: { form_response: { form_view_id: l.view.id, anonymous } },
      ...(respondent && access_ !== 'none' && !canEdit(l, respondent) ? { permissions: [{ type: 'user_permission', role: access_, user_id: respondent }] } : {}),
    };
    applyTransactions(actor, [{
      id: newId(), spaceId, debug: { userAction: 'form.submitResponse' },
      operations: [{ pointer: { table: 'block', id, spaceId }, path: [], command: 'set', args: record }],
    }]); // no origin client: the submitting tab hasn't applied the row locally, so it must receive the broadcast too
    // Settings › Audit log › Form response created (anonymous responses have no actor)
    audit('workspace.form_response.created', { spaceId, actorId: anonymous ? null : respondent, targetId: l.view.id, ip: anonymous ? null : ctx.ip, data: { name: String((l.form as any).title ?? '').trim() || toPlainText(l.view.name as any) || '', pageId: id, anonymous: !!anonymous } });
    // Form settings › Select template: the template's content and values join the new response (answers win)
    if (l.form.templateId && (l.collection.template_pages ?? []).includes(l.form.templateId)) {
      try {
        instantiateTemplate(id, l.form.templateId, actor, { source: 'form_template' });
      } catch (e) {
        console.error('[forms] template', e);
      }
    }
    // "View my response": the respondent may open the page they created (they can see it when they can edit the
    // database or "Access to submission" gave them a role on it)
    const canView = !!respondent && blockRole(id, respondent) !== 'none';
    return { pageId: id, canView };
  },
};

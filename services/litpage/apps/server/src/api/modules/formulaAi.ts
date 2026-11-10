// Formula assistant : the assistant inside the formula editor — for
// Formula properties and for the formulas of buttons, database buttons and automations. One request per prompt:
// the assistant does not remember earlier prompts, it sees the database (property names, types, options and the
// properties of related databases), the current formula and its error. The answer is a formula in plain
// `prop("Name")` form (the client turns names back into property tokens) plus a short explanation; a formula that
// doesn't parse gets one repair round ("Repairing"). No provider → 400 "Connect an AI provider to use Litpage AI".
//
//   aiFormula { collectionId, prompt, formula?, error?, targetType?, context?: [{ label, type }] }
//     → { formula, explanation, repaired? }
//   aiFormulaFeedback { rating: 'positive'|'negative', comment?, prompt?, formula? } → { ok }
import { newId } from '@nc/shared/ids.ts';
import type { BlockRecord, CollectionRecord, PropertySchema } from '@nc/shared/records.ts';
import { toPlainText } from '@nc/shared/richtext.ts';
import { LIBRARY } from '@nc/shared/formula/library.ts';
import { parse } from '@nc/shared/formula/parser.ts';
import { db, getRecord } from '../../db.ts';
import { visibleCollection } from '../../ai/visibility.ts';
import { blockRole } from '../../records.ts';
import { roleAtLeast } from '@nc/shared/permissions.ts';
import { ApiError, type Ctx } from '../handlers.ts';
import { AI_RATE_MESSAGE, aiAllowed } from '../../ratelimit.ts';
import { AiError, aiConfigured, NO_KEY_MESSAGE, type ClaudeLike } from '../../ai/client.ts';
import type { ModelRequest } from '../../ai/prompts.ts';
import { assertAiAllowed, executeSimple } from '../../ai/service.ts';

db.exec(`CREATE TABLE IF NOT EXISTS ai_formula_feedback (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, time INTEGER NOT NULL, rating TEXT NOT NULL, comment TEXT, prompt TEXT, formula TEXT
)`);

const MAX_PROMPT = 2000;
const MAX_FORMULA = 5000;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

const FUNCTIONS = Object.values(LIBRARY)
  .filter((f) => (f as { category?: string }).category !== 'internal')
  .map((f) => f.name)
  .sort()
  .join(', ');

const SYSTEM_PROMPT = `You are the formula assistant inside a Litpage-style database. You write, fix and explain formulas written in the Formulas 2.0 language.

Language:
- prop("Property name") reads a property of the current page. Relation and rollup properties are lists of pages; read a property of related pages with .map(current.prop("Name")), .first().prop("Name") or .filter(current.prop("Done")). Person properties are lists of people: use .first() or .map(current.name()).
- Literals: numbers, "text", true, false, lists [1, 2]. Comments: /* … */.
- Operators: + - * / % ^, == != > >= < <=, and, or, not, condition ? then : otherwise.
- Functions can be called as methods: prop("Due").dateAdd(1, "days") is dateAdd(prop("Due"), 1, "days").
- Available functions: ${FUNCTIONS}.
- Use empty() for "no value" — never "" when the other branch is a date, number, person or page. Compare lists with .includes(), not ==.
- There are no loops and no random numbers: use map, filter, some, every, find, sum on lists.

Answer with a single JSON object and nothing else:
{"formula": "<the complete formula>", "explanation": "<one or two short sentences>"}
- To explain a formula, keep "formula" equal to the current formula and explain what it does.
- To fix a formula, return the corrected formula and say what was wrong.
- Only use property names that exist. Keep formulas on one line unless they are long.`;

function propertyLine(p: PropertySchema): string {
  let line = `- ${p.name} (${p.type}`;
  const opts = (p.options ?? []).map((o) => o.value).filter(Boolean);
  if (opts.length) line += `: ${opts.slice(0, 30).join(', ')}`;
  if (p.type === 'formula') {
    const rt = (p as { formula2?: { result_type?: { type?: string } } }).formula2?.result_type?.type;
    if (rt) line += ` returning ${rt}`;
  }
  return `${line})`;
}

function schemaText(col: CollectionRecord, userId: string): string {
  const name = toPlainText(col.name as never) || 'Untitled';
  const lines = [`Database "${name}" properties:`, ...Object.values(col.schema ?? {}).slice(0, 120).map(propertyLine)];
  // related databases the person can read: their property names let the assistant follow relations
  const seen = new Set<string>([col.id]);
  for (const p of Object.values(col.schema ?? {})) {
    if (p.type !== 'relation' || typeof p.collection_id !== 'string' || seen.has(p.collection_id)) continue;
    seen.add(p.collection_id);
    // property access : "No access" properties of the related database stay out of the prompt
    const target = visibleCollection(getRecord<CollectionRecord>('collection', p.collection_id), userId);
    if (!target) continue;
    lines.push(`Related database "${toPlainText(target.name as never) || 'Untitled'}" (through "${p.name}") properties:`);
    lines.push(...Object.values(target.schema ?? {}).slice(0, 60).map(propertyLine));
  }
  return lines.join('\n');
}

export interface FormulaAssistantInput {
  userId: string;
  /** the data source (none for a button block's formulas) */
  collection?: CollectionRecord;
  prompt: string;
  formula?: string;
  error?: string;
  targetType?: string;
  context?: { label: string; type?: string }[];
}

function buildRequest(p: FormulaAssistantInput): ModelRequest {
  const parts = [p.collection
    ? `<database>\n${schemaText(p.collection, p.userId)}\n</database>`
    : '<page>This formula belongs to a button on a page, not in a database: there are no page properties to read with prop("…").</page>'];
  if (p.context?.length) {
    parts.push(`<automation_values>\nThis formula runs in a database automation or button. prop("…") reads the trigger page. These values are written ctx("Label"):\n${p.context.map((c) => `- ctx(${JSON.stringify(c.label)})${c.type ? ` (${c.type})` : ''}`).join('\n')}\n</automation_values>`);
  }
  if (p.targetType) parts.push(`<required_result_type>${p.targetType}</required_result_type>`);
  parts.push(`<current_formula>\n${p.formula?.trim() || '(empty)'}\n</current_formula>`);
  if (p.error?.trim()) parts.push(`<current_error>${p.error.trim()}</current_error>`);
  parts.push(`Request: ${p.prompt.trim()}`);
  return {
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: parts.join('\n\n') }] }],
    effort: 'low',
    maxTokens: 1500,
  } as ModelRequest;
}

/** Pull {formula, explanation} out of the model's text (tolerates code fences and prose around the JSON). */
export function parseAssistantAnswer(text: string): { formula: string; explanation: string } {
  const t = text.trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const j = JSON.parse(t.slice(start, end + 1)) as { formula?: unknown; explanation?: unknown };
      return { formula: typeof j.formula === 'string' ? j.formula.trim() : '', explanation: typeof j.explanation === 'string' ? j.explanation.trim() : '' };
    } catch {
      /* fall through */
    }
  }
  const fence = /```[a-z]*\n?([\s\S]*?)```/i.exec(t);
  if (fence) return { formula: fence[1].trim(), explanation: t.replace(fence[0], '').trim() };
  return { formula: '', explanation: t };
}

export async function runFormulaAssistant(p: FormulaAssistantInput, client?: ClaudeLike): Promise<{ formula: string; explanation: string; repaired?: boolean }> {
  const req = buildRequest(p);
  const first = await executeSimple('formula', req, {}, undefined, client);
  if (first.status !== 'complete') throw new ApiError(first.error?.message ?? 'No response was generated. Try again.', first.error?.code === 'rate_limited' ? 429 : 400);
  let answer = parseAssistantAnswer(first.text);
  if (!answer.formula && !answer.explanation) throw new ApiError('No response was generated. Try again.', 502);
  const syntax = answer.formula ? parse(answer.formula).error : null;
  if (!syntax) return { ...answer, formula: answer.formula.slice(0, MAX_FORMULA) };
  // one repair round with the parser's message
  const repair = { ...req, messages: [...req.messages, { role: 'assistant', content: [{ type: 'text', text: first.text }] }, { role: 'user', content: [{ type: 'text', text: `That formula does not parse: ${syntax.message}. Return the corrected formula as the same JSON object.` }] }] } as ModelRequest;
  const second = await executeSimple('formula-repair', repair, {}, undefined, client);
  if (second.status === 'complete') {
    const fixed = parseAssistantAnswer(second.text);
    if (fixed.formula && !parse(fixed.formula).error) answer = fixed;
  }
  return { ...answer, formula: answer.formula.slice(0, MAX_FORMULA), repaired: true };
}

function readableCollection(collectionId: unknown, userId: string): CollectionRecord {
  const col = typeof collectionId === 'string' ? getRecord<CollectionRecord>('collection', collectionId) : undefined;
  const host = col ? getRecord<BlockRecord>('block', col.parent_id) : undefined;
  if (!col || col.alive === false || !host || blockRole(host.id, userId) === 'none') throw new ApiError('Not found', 404);
  return visibleCollection(col, userId) ?? col;
}

/** Workspace of a button block the person can edit (the ∑ formula editor of a button block). */
function editableButtonSpace(blockId: unknown, userId: string): string {
  const b = typeof blockId === 'string' ? getRecord<BlockRecord>('block', blockId) : undefined;
  if (!b || b.alive === false || b.type !== 'button' || !roleAtLeast(blockRole(b.id, userId), 'read_and_write')) throw new ApiError('Not found', 404);
  return b.space_id;
}

export const handlers = {
  async aiFormula(ctx: Ctx, body: any) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const userId = ctx.userId;
    if (!aiConfigured()) throw new ApiError(NO_KEY_MESSAGE, 400);
    // button blocks have no data source: their formulas are checked against the button (edit access to its page)
    const col = body?.collectionId || !body?.blockId ? readableCollection(body?.collectionId, userId) : undefined;
    const spaceId = col ? (col.space_id as string) : editableButtonSpace(body.blockId, userId);
    try {
      assertAiAllowed(spaceId, userId);
    } catch (e) {
      if (e instanceof AiError) throw new ApiError(e.message, e.status);
      throw e;
    }
    const prompt = str(body?.prompt, MAX_PROMPT).trim();
    if (!prompt) throw new ApiError('Tell Litpage AI what to write.', 400);
    if (!aiAllowed(userId)) throw new ApiError(AI_RATE_MESSAGE, 429);
    const context = Array.isArray(body?.context)
      ? (body.context as unknown[]).slice(0, 40).map((c: any) => ({ label: str(c?.label, 80), type: str(c?.type, 40) || undefined })).filter((c) => c.label)
      : undefined;
    return runFormulaAssistant({
      userId, collection: col, prompt, formula: str(body?.formula, MAX_FORMULA), error: str(body?.error, 500), targetType: str(body?.targetType, 40) || undefined, context,
    });
  },

  aiFormulaFeedback(ctx: Ctx, body: any) {
    if (!ctx.userId) throw new ApiError('Unauthorized', 401);
    const rating = body?.rating === 'positive' || body?.rating === 'negative' ? body.rating : null;
    if (!rating) throw new ApiError('Invalid rating', 400);
    db.prepare('INSERT INTO ai_formula_feedback (id, user_id, time, rating, comment, prompt, formula) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(newId(), ctx.userId, Date.now(), rating, str(body?.comment, 2000) || null, str(body?.prompt, MAX_PROMPT) || null, str(body?.formula, MAX_FORMULA) || null);
    return { ok: true };
  },
};

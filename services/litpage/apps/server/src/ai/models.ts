// Model picker ("Auto" plus a model list) mapped to the models of the active provider
// (providers/config.ts). MODELS is a live list: the Claude models with the Anthropic provider, openai's listed models
// (GET /models, display names, cached) with openai. An explicit choice pins the model for the chat; workspace admins
// can restrict the list (Settings → AI → Model controls: space.settings.ai_allowed_models); a chat whose model
// was restricted — or isn't offered by the provider any more — falls back to Auto ("Members using a restricted model
// will fall back to Auto in Agent").
//
// "Auto": chat, Research, Plan, Custom Agents, AI blocks, the inline writer, meeting
// summaries and image drawings run on the deployment default (NC_AI_MODEL; else Claude Opus 5.5, or a listed OpenAI
// model) with the effort picked per task (autoEffort); quick one-shot tasks, chat titles, database autofill, and the
// formula assistant (low effort, ≤ 16k output tokens), run on the fast model (NC_AI_FAST_MODEL; with OpenAI else
// the newest listed model described as fast / affordable / efficient; else the default).
import { providerId } from './providers/config.ts';
import { cachedOpenAIModels, openaiModelsVersion, type OpenAIModel } from './providers/openaiModels.ts';

const ANTHROPIC_DEFAULT = 'claude-opus-5-5';
export const OPENAI_MODEL_CONFIG_ERROR = 'Set NC_AI_MODEL to a model ID because the OpenAI /models list could not be loaded.';

export interface ModelInfo {
  id: string;
  /** "Opus" + version shown greyed ("Opus 5.5"); openai models: the display name, no version */
  name: string;
  version: string;
  /** Recommended section vs. "Other models ›" */
  group: 'recommended' | 'other';
  beta?: boolean;
  description: string;
  /** server-side refusal fallback ("fallbacks": "default") is offered for this model */
  fallback: boolean;
  /** web_search/web_fetch tool versions with dynamic filtering */
  dynamicWebTools: boolean;
  /** only offered once a workspace admin turns it on (Settings › AI: Claude Fable 5) */
  adminEnable?: boolean;
  /** openai: reasoning efforts the model supports, and whether it reads images */
  efforts?: string[];
  images?: boolean;
}

const ANTHROPIC_MODELS: ModelInfo[] = [
  { id: 'claude-opus-5-5', name: 'Opus', version: '5.5', group: 'recommended', beta: true, description: 'Anthropic’s most capable model for complex, multi-step work.', fallback: true, dynamicWebTools: true },
  { id: 'claude-sonnet-5-5', name: 'Sonnet', version: '5.5', group: 'recommended', description: 'Fast and capable for everyday writing, research and edits.', fallback: true, dynamicWebTools: true },
  { id: 'claude-haiku-5-5', name: 'Haiku', version: '5.5', group: 'recommended', description: 'Fastest responses for quick questions and simple edits.', fallback: false, dynamicWebTools: false },
  { id: 'claude-opus-5', name: 'Opus', version: '5', group: 'other', description: 'Previous Opus generation.', fallback: true, dynamicWebTools: true },
  // Anthropic keeps prompts and responses for a period with this model, so admins opt in (aiSettings: Claude Fable 5)
  { id: 'claude-fable-5', name: 'Fable', version: '5', group: 'other', description: 'Anthropic’s most capable model for the hardest, longest work. Turned on by a workspace admin.', fallback: false, dynamicWebTools: false, adminEnable: true },
];

/** Models of the active provider (kept in place: importers hold this array). */
export const MODELS: ModelInfo[] = [...ANTHROPIC_MODELS];

/** Deployment default model of the active provider (live binding, updated with MODELS). */
export let DEFAULT_MODEL = process.env.NC_AI_MODEL?.trim() || ANTHROPIC_DEFAULT;

/** openai models that aren't listed (visibility "hide") but can be named in NC_AI_MODEL / NC_AI_FAST_MODEL */
let hiddenOpenAI: ModelInfo[] = [];
let syncedKey = '';

const OLDER = /^(older|previous|legacy)\b/i;
const FAST = /\b(fast|faster|fastest|affordable|efficient|quick|lightweight)\b/i;

function openaiInfo(m: OpenAIModel): ModelInfo {
  return {
    id: m.slug, name: m.displayName, version: '', group: OLDER.test(m.description) ? 'other' : 'recommended', description: m.description,
    fallback: false, dynamicWebTools: true, efforts: m.efforts, images: m.images,
  };
}

/** Bring MODELS / DEFAULT_MODEL in line with the active provider (cheap; every lookup calls it). */
export function syncModels(): void {
  const envModel = process.env.NC_AI_MODEL?.trim() ?? '';
  if (providerId() === 'openai') {
    const list = cachedOpenAIModels();
    const key = `openai|${envModel}|${openaiModelsVersion()}|${list ? 1 : 0}`;
    if (key === syncedKey) return;
    syncedKey = key;
    const listed = (list ?? []).filter((m) => m.visibility !== 'hide').map(openaiInfo);
    hiddenOpenAI = (list ?? []).filter((m) => m.visibility === 'hide').map(openaiInfo);
    if (listed.length && !listed.some((m) => m.group === 'recommended')) listed.slice(0, 3).forEach((m) => (m.group = 'recommended'));
    const def = envModel || listed.find((m) => /^gpt-/i.test(m.id))?.id || listed[0]?.id || '';
    if (!def) {
      MODELS.splice(0, MODELS.length);
      hiddenOpenAI = [];
      DEFAULT_MODEL = '';
      return;
    }
    if (!listed.some((m) => m.id === def)) {
      const hidden = hiddenOpenAI.find((m) => m.id === def);
      listed.unshift(hidden ? { ...hidden, group: 'recommended' } : { id: def, name: def, version: '', group: 'recommended', description: 'The deployment’s default model.', fallback: false, dynamicWebTools: true });
    }
    MODELS.splice(0, MODELS.length, ...listed);
    DEFAULT_MODEL = def;
    return;
  }
  const key = `anthropic|${envModel}`;
  if (key === syncedKey) return;
  syncedKey = key;
  hiddenOpenAI = [];
  MODELS.splice(0, MODELS.length, ...ANTHROPIC_MODELS);
  DEFAULT_MODEL = envModel || ANTHROPIC_DEFAULT;
}
syncModels();

/** Models a workspace offers: admin-enabled ones (Claude Fable 5) only once turned on. */
export function offeredModels(fableEnabled: boolean): ModelInfo[] {
  syncModels();
  return MODELS.filter((m) => !m.adminEnable || fableEnabled);
}

export const AUTO = 'auto';

export function modelInfo(id: string): ModelInfo | undefined {
  syncModels();
  return MODELS.find((m) => m.id === id) ?? hiddenOpenAI.find((m) => m.id === id);
}

/** Display label ("Opus 5.5" or a provider display name) for a model id (unknown ids are shown as-is). */
export function modelLabel(id: string): string {
  const m = modelInfo(id);
  return m ? `${m.name} ${m.version}`.trim() : id;
}

/** Fallback / web-tool capabilities of a model id (the deployment default may be a model outside the list). */
export function capabilities(id: string): { fallback: boolean; dynamicWebTools: boolean } {
  const m = modelInfo(id);
  if (m) return { fallback: m.fallback, dynamicWebTools: m.dynamicWebTools };
  if (providerId() === 'openai') return { fallback: false, dynamicWebTools: true };
  // unknown/custom deployment models: assume the Opus/Sonnet surface unless it is a Haiku
  const haiku = /haiku/i.test(id);
  return { fallback: !haiku, dynamicWebTools: !haiku };
}

export type TaskKind = 'chat' | 'research' | 'plan' | 'writer' | 'block' | 'autofill' | 'qa' | 'title';

/**
 * Resolve the model for a request. `choice` is "auto" or a model id from MODELS; `allowed` (workspace model controls)
 * restricts explicit choices. Returns the model and whether the choice was honored (false → fell back to Auto).
 */
export function resolveModel(choice: string | null | undefined, allowed?: string[] | null, opts: { fableEnabled?: boolean } = {}): { model: string; choice: string; honored: boolean } {
  const c = (choice ?? '').trim();
  if (!c || c === AUTO) return { model: autoModel(allowed), choice: AUTO, honored: true };
  const known = modelInfo(c);
  if (!known || (known.adminEnable && !opts.fableEnabled) || (allowed && allowed.length && !allowed.includes(c))) return { model: autoModel(allowed), choice: AUTO, honored: false };
  return { model: c, choice: c, honored: true };
}

/** Auto: the deployment default unless the workspace restricted it, then the first allowed model. */
export function autoModel(allowed?: string[] | null): string {
  syncModels();
  if (!allowed || !allowed.length || allowed.includes(DEFAULT_MODEL)) return DEFAULT_MODEL;
  return MODELS.find((m) => !m.adminEnable && allowed.includes(m.id))?.id ?? DEFAULT_MODEL;
}

/** Auto's model for quick one-shot tasks (see the header). */
export function fastModel(): string {
  syncModels();
  const env = process.env.NC_AI_FAST_MODEL?.trim();
  if (env) return env;
  if (providerId() !== 'openai') return DEFAULT_MODEL;
  return MODELS.find((m) => m.group === 'recommended' && FAST.test(m.description))?.id ?? DEFAULT_MODEL;
}

/** Admin-facing configuration problem when OpenAI has no explicit model and its model list is unavailable. */
export function modelConfigurationError(): string | null {
  syncModels();
  if (providerId() !== 'openai' || process.env.NC_AI_MODEL?.trim()) return null;
  return DEFAULT_MODEL ? null : OPENAI_MODEL_CONFIG_ERROR;
}

/** A model id that belongs to the other provider (e.g. a Claude id saved before switching to openai). */
function foreign(id: string): boolean {
  return providerId() === 'openai' ? /^claude-/i.test(id) : /^(gpt-|o\d|openai-)/i.test(id);
}

/** The model a request runs on: its explicit model (when the provider can run it), else Auto's routing. */
export function requestModel(req: { model?: string; effort?: string; maxTokens?: number }): string {
  syncModels();
  if (req.model && !foreign(req.model)) return req.model;
  if (!req.model && req.effort === 'low' && (req.maxTokens ?? Infinity) <= 16_000) return fastModel();
  return DEFAULT_MODEL;
}

/**
 * Auto's effort routing ("Balances speed, effort, and cost."): research and plans think harder, quick lookups and
 * short questions stay light. Explicit model choices keep the surface's default effort.
 */
export function autoEffort(kind: TaskKind, text = ''): 'low' | 'medium' | 'high' {
  if (kind === 'research' || kind === 'plan') return 'high';
  if (kind === 'writer' || kind === 'autofill' || kind === 'title') return 'low';
  if (kind === 'chat') {
    const t = text.trim();
    // a short greeting / quick factual question with no workspace verbs
    if (t.length < 40 && !/\b(create|make|add|update|edit|change|move|delete|write|draft|build|summari[sz]e|translate|search|find)\b/i.test(t)) return 'low';
  }
  return 'medium';
}

/** Server web tool definitions for a model (dynamic filtering variants on Opus/Sonnet 5.x, basic otherwise). */
export function webToolDefs(model: string, opts: { fetch: boolean; maxUses?: number }): Record<string, unknown>[] {
  const dyn = capabilities(model).dynamicWebTools;
  const maxUses = opts.maxUses ?? 5;
  const out: Record<string, unknown>[] = [{ type: dyn ? 'web_search_20260209' : 'web_search_20250305', name: 'web_search', max_uses: maxUses }];
  if (opts.fetch) out.push({ type: dyn ? 'web_fetch_20260209' : 'web_fetch_20250910', name: 'web_fetch', max_uses: maxUses, citations: { enabled: true }, max_content_tokens: 20_000 });
  return out;
}

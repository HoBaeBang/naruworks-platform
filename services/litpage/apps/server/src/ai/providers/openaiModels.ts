// OpenAI model list: GET {base}/models → either the standard { data: [{ id, object, created, owned_by }] }
// shape or a richer list with display names, visibility, reasoning levels and input modalities. Fetched in the
// background and cached
// (10 minutes; 1 minute after a failure, keeping the last good list) so model lookups stay synchronous.
import { openaiConfig, scrub, type OpenAIConfig } from './config.ts';
import { isDemoMode } from '../../demo.ts';

export interface OpenAIModel {
  slug: string;
  displayName: string;
  description: string;
  /** 'list' = offered in pickers; 'hide' = callable but not listed */
  visibility: string;
  /** lower = listed first */
  priority: number;
  efforts: string[];
  images: boolean;
  contextWindow: number;
}

const TTL_MS = 10 * 60_000;
const RETRY_MS = 60_000;

let cache: { base: string; at: number; models: OpenAIModel[] } | null = null;
let failedAt = 0;
let inflight: Promise<OpenAIModel[] | null> | null = null;
let version = 0;
let fetchImpl: typeof fetch = (...a) => fetch(...a);
const DEFAULT_EFFORTS = ['low', 'medium', 'high'];

/** Test seam: replace fetch (null restores it) and drop the cache. */
export function setOpenAIModelsFetch(f: typeof fetch | null) {
  fetchImpl = f ?? ((...a) => fetch(...a));
  cache = null;
  failedAt = 0;
  inflight = null;
  version++;
}

/** Bumped whenever the cached list changes (models.ts re-syncs its live list). */
export function openaiModelsVersion(): number {
  return version;
}

export function parseOpenAIModels(json: unknown): OpenAIModel[] {
  const rich = Array.isArray((json as any)?.models) ? (json as any).models : [];
  const standard = Array.isArray((json as any)?.data) ? (json as any).data : [];
  const list = rich.length ? rich : standard;
  const out: OpenAIModel[] = [];
  for (const [index, m] of list.entries()) {
    const slug = typeof m?.slug === 'string' ? m.slug : typeof m?.id === 'string' ? m.id : '';
    if (!slug) continue;
    const levels = Array.isArray(m.supported_reasoning_levels)
      ? m.supported_reasoning_levels
      : Array.isArray(m.reasoning_efforts) ? m.reasoning_efforts : [];
    const efforts = levels.map((l: any) => (typeof l === 'string' ? l : l?.effort)).filter((x: unknown): x is string => typeof x === 'string');
    out.push({
      slug,
      displayName: typeof m.display_name === 'string' && m.display_name.trim() ? m.display_name.trim() : slug,
      description: typeof m.description === 'string' ? m.description.trim() : '',
      visibility: typeof m.visibility === 'string' ? m.visibility : 'list',
      priority: Number.isFinite(Number(m.priority)) ? Number(m.priority) : index,
      efforts: efforts.length ? efforts : DEFAULT_EFFORTS,
      images: Array.isArray(m.input_modalities) ? m.input_modalities.includes('image') : true,
      contextWindow: Number(m.context_window) || 0,
    });
  }
  return out.sort((a, b) => a.priority - b.priority || a.slug.localeCompare(b.slug));
}

export async function fetchOpenAIModels(cfg: OpenAIConfig, signal?: AbortSignal): Promise<OpenAIModel[]> {
  const res = await fetchImpl(`${cfg.baseUrl}/models`, { headers: { authorization: `Bearer ${cfg.apiKey}`, accept: 'application/json' }, signal: signal ?? AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`models: HTTP ${res.status}`);
  return parseOpenAIModels(await res.json());
}

/** Refresh the cache now (deduplicated). Resolves to the list, or null when it couldn't be loaded. */
export function refreshOpenAIModels(): Promise<OpenAIModel[] | null> {
  const cfg = openaiConfig();
  if (!cfg) return Promise.resolve(null);
  if (inflight) return inflight;
  inflight = fetchOpenAIModels(cfg)
    .then((models) => {
      cache = { base: cfg.baseUrl, at: Date.now(), models };
      failedAt = 0;
      version++;
      return models;
    })
    .catch((e) => {
      failedAt = Date.now();
      console.warn(`[ai] openai model list unavailable: ${scrub(String((e as Error)?.message ?? e)).slice(0, 200)}`);
      return cache?.base === cfg.baseUrl ? cache.models : null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** The cached list for the configured endpoint (null until loaded); starts a background refresh when stale. */
export function cachedOpenAIModels(): OpenAIModel[] | null {
  if (isDemoMode()) return null;
  const cfg = openaiConfig();
  if (!cfg) return null;
  const fresh = cache && cache.base === cfg.baseUrl;
  const stale = !fresh || Date.now() - cache!.at > TTL_MS;
  if (stale && !inflight && Date.now() - failedAt > RETRY_MS) void refreshOpenAIModels();
  return fresh ? cache!.models : null;
}

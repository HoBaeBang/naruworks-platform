// Which model provider AI uses, read from the environment on every call (keys are never cached or logged):
//   NC_AI_PROVIDER = openai | anthropic | none   explicit choice; otherwise
//   openai   when OPENAI_API_KEY is set (POST {base}/responses, GET {base}/models), else
//   anthropic  when ANTHROPIC_API_KEY is set (Claude API, optional ANTHROPIC_BASE_URL), else
//   none       AI shows its "connect a provider" state.
// `pnpm dev` (apps/server) loads apps/server/.env.local (gitignored) with `node --env-file-if-exists`; variables already
// set in the environment win over the file.

export type ProviderId = 'openai' | 'anthropic' | 'none';

export interface OpenAIConfig {
  /** e.g. https://api.openai.com/v1 (no trailing slash) */
  baseUrl: string;
  apiKey: string;
}

const env = (name: string): string => process.env[name]?.trim() ?? '';

export function anthropicKey(): string | null {
  return env('ANTHROPIC_API_KEY') || null;
}

export function openaiConfig(): OpenAIConfig | null {
  const baseUrl = (env('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const apiKey = env('OPENAI_API_KEY');
  return baseUrl && apiKey ? { baseUrl, apiKey } : null;
}

let warnedValue = '';

export function providerId(): ProviderId {
  const raw = env('NC_AI_PROVIDER').toLowerCase();
  if (raw) {
    if (raw === 'openai' || raw === 'openai-compatible') return 'openai';
    if (raw === 'anthropic' || raw === 'claude') return 'anthropic';
    if (raw !== 'none' && raw !== 'off' && warnedValue !== raw) {
      warnedValue = raw;
      console.warn(`[ai] unknown NC_AI_PROVIDER "${raw.slice(0, 40)}": Litpage AI is off (use openai, anthropic or none)`);
    }
    return 'none';
  }
  if (openaiConfig()) return 'openai';
  if (anthropicKey()) return 'anthropic';
  return 'none';
}

/** The selected provider has everything it needs to make calls. */
export function providerConfigured(p: ProviderId = providerId()): boolean {
  if (p === 'openai') return openaiConfig() !== null;
  if (p === 'anthropic') return anthropicKey() !== null;
  return false;
}

/** Environment variable holding the selected provider's key (named in admin-facing error messages). */
export function keyVariable(p: ProviderId = providerId()): string {
  return p === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY';
}

/** Every configured secret value, whichever provider is active (scrubbed from logs and error texts). */
export function providerSecrets(): string[] {
  return [env('ANTHROPIC_API_KEY'), env('OPENAI_API_KEY'), env('ANTHROPIC_AUTH_TOKEN')].filter((k) => k.length >= 8);
}

/** Remove anything key-like from text before it is logged or returned (configured keys, OpenAI and Anthropic keys, bearer tokens). */
export function scrub(text: string): string {
  let out = text;
  for (const k of providerSecrets()) out = out.split(k).join('[redacted]');
  return out
    .replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[redacted]')
    .replace(/sk-proj-[A-Za-z0-9_-]{8,}/g, 'sk-proj-[redacted]')
    .replace(/sk-(?!ant-|proj-)[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[redacted]');
}

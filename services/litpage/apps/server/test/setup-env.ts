// Vitest setup (apps/server/vitest.config.mjs): unit tests run against fake clients and fetches only. Model-provider
// settings exported in the calling shell (e.g. sourced from apps/server/.env.local) are dropped before each test file,
// so no test can reach a real endpoint; tests that need a provider set their own fake values at the top of the file.
for (const k of ['NC_AI_PROVIDER', 'OPENAI_BASE_URL', 'OPENAI_API_KEY', 'NC_AI_MODEL', 'NC_AI_FAST_MODEL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL']) {
  delete process.env[k];
}

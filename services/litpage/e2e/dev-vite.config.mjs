
// harness config (HMR off, stubs for not-yet-existing imports) with its own dep cache and the public REST API proxied
// (/v1/…). Usage: e2e/dev-harness.mjs (NC_API=http://127.0.0.1:3201 NC_WEB_PORT=5521).
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import base from './ai-vite.config.mjs';

const api = process.env.NC_API ?? 'http://127.0.0.1:3201';

export default {
  ...base,
  cacheDir: process.env.NC_E2E_VITE_CACHE || join(tmpdir(), 'nc-dev-e2e-vite-cache'),
  server: {
    ...base.server,
    port: Number(process.env.NC_WEB_PORT ?? 5521),
    proxy: { ...base.server.proxy, '^/v1/': api },
  },
};

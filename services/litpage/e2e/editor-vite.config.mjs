// Vite config for isolated editor e2e runs (same app as apps/web): HMR off (other areas are edited
// concurrently; a hot reload mid-test resets editor state), own dep cache, and stubs for imports of files that do not
// exist yet (another area's work in progress) — reuses the AI harness plugin. Usage:
// NC_API=http://127.0.0.1:3161 NC_WEB_PORT=5461 npx vite --config ../../e2e/editor-vite.config.mjs (cwd apps/web)
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import base from './ai-vite.config.mjs';

export default {
  ...base,
  cacheDir: join(tmpdir(), 'nc-editor-e2e-vite-cache'),
  server: { ...base.server, port: Number(process.env.NC_WEB_PORT ?? 5461) },
};

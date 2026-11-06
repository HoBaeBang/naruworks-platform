
// off (other areas are edited concurrently), own dep cache, stubs for imports of files that don't exist yet (reuses
// the AI harness plugin). Usage (cwd apps/web):
//   NC_API=http://127.0.0.1:3121 NC_WEB_PORT=5421 npx vite --config ../../e2e/dba-vite.config.mjs
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import base from './ai-vite.config.mjs';

export default {
  ...base,
  cacheDir: join(tmpdir(), 'nc-dba-e2e-vite-cache'),
  server: { ...base.server, port: Number(process.env.NC_WEB_PORT ?? 5421) },
};

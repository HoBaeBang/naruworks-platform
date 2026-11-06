
// served on its own port and proxied to an isolated API server. A harness-only plugin replaces
// imports of files that do not exist yet (other features' work in progress) with inert stubs, so
// the AI surfaces can be tested even while an unrelated module is mid-edit.
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/web');
const require = createRequire(resolve(webRoot, 'package.json'));
const react = (await import(pathToFileURL(require.resolve('@vitejs/plugin-react')).href)).default;
const api = process.env.NC_API ?? 'http://127.0.0.1:3011';
const port = Number(process.env.NC_WEB_PORT ?? 5174);

function stubMissingImports() {
  return {
    name: 'nc-e2e-stub-missing-imports',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0];
      if (!file.startsWith(`${webRoot}/src/`) || !/\.(t|j)sx?$/.test(file)) return null;
      let changed = false;
      const out = code.replace(/^import\s+(type\s+)?([^;'"]*?)\s+from\s+['"](\.{1,2}\/[^'"]+)['"];?/gm, (m, isType, what, spec) => {
        if (existsSync(resolve(dirname(file), spec))) return m;
        changed = true;
        if (process.env.HARNESS_LOG) console.warn(`[stub] ${file.slice(webRoot.length + 1)} → ${spec}`);
        if (isType) return '';
        const names = [];
        const head = what.trim();
        const def = /^([A-Za-z_$][\w$]*)\s*(,|$)/.exec(head);
        if (def) names.push(def[1]);
        const braces = /\{([\s\S]*)\}/.exec(head);
        if (braces) {
          for (const part of braces[1].split(',')) {
            const p = part.trim();
            if (!p || p.startsWith('type ')) continue;
            names.push(p.split(/\s+as\s+/).pop().trim());
          }
        }
        const ns = /\*\s+as\s+([A-Za-z_$][\w$]*)/.exec(head);
        if (ns) names.push(ns[1]);
        return names.map((n) => `const ${n} = (() => { const f = () => null; return new Proxy(f, { get: (_t, k) => (k === Symbol.toPrimitive ? () => '' : f) }); })();`).join('\n');
      });
      // side-effect imports (import './missing.css')
      const out2 = out.replace(/^import\s+['"](\.{1,2}\/[^'"]+)['"];?/gm, (m, spec) => {
        if (existsSync(resolve(dirname(file), spec))) return m;
        changed = true;
        if (process.env.HARNESS_LOG) console.warn(`[stub] ${file.slice(webRoot.length + 1)} → ${spec}`);
        return '';
      });
      return changed ? { code: out2, map: null } : null;
    },
  };
}

export default {
  root: webRoot,
  configFile: false,
  // Own dep-optimizer cache: sharing apps/web/node_modules/.vite with the main dev server lets a
  // re-optimization there (another feature adding a dependency) invalidate chunks served here.
  cacheDir: process.env.NC_E2E_VITE_CACHE || join(tmpdir(), 'nc-ai-e2e-vite-cache'),
  plugins: [stubMissingImports(), react()],
  logLevel: 'warn',
  server: {
    port,
    strictPort: true,
    host: '127.0.0.1',
    // no hot updates while a test runs: other features are edited concurrently and an HMR re-render
    // mid-test resets editor / writer state
    hmr: false,
    proxy: { '/api': api, '/files': api, '/ws': { target: api.replace(/^http/, 'ws'), ws: true } },
  },
};

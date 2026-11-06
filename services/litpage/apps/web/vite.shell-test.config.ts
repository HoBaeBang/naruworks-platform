// Private dev server for the shell agent's visual tests (port 5180). Same app as vite.config.ts, plus a
// plugin that stubs imports of files that don't exist yet (other agents' in-progress work) so one missing
// module doesn't take the whole app down while testing the shell. Not used by the build.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.NC_API ?? 'http://127.0.0.1:3001';

function stubMissing(): Plugin {
  return {
    name: 'nc-stub-missing',
    enforce: 'pre',
    async resolveId(id, importer) {
      if (!importer || !(id.startsWith('./') || id.startsWith('../'))) return null;
      const r = await this.resolve(id, importer, { skipSelf: true });
      if (r) return null;
      return `\0nc-stub:${resolve(dirname(importer), id)}|${importer}|${id}`;
    },
    load(id) {
      if (!id.startsWith('\0nc-stub:')) return null;
      const [, importer, spec] = id.slice('\0nc-stub:'.length).split('|');
      if (spec.endsWith('.css')) return '';
      let names: string[] = [];
      try {
        const src = readFileSync(importer, 'utf8');
        const re = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
        for (const m of src.matchAll(re)) names.push(...m[1].split(',').map((x) => x.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]).filter(Boolean));
      } catch {
        /* ignore */
      }
      names = [...new Set(names)];
      return `const noop = () => null;\nexport default noop;\n${names.map((n) => `export const ${n} = noop;`).join('\n')}\n`;
    },
  };
}

export default defineConfig({
  plugins: [stubMissing(), react()],
  cacheDir: process.env.NC_VITE_CACHE ?? '/tmp/nc-e2e/vite-shell/cache',
  server: {
    port: Number(process.env.NC_VITE_PORT ?? 5180),
    strictPort: true,
    proxy: { '/api': api, '/files': api, '/ws': { target: api.replace(/^http/, 'ws'), ws: true } },
  },
} as any);

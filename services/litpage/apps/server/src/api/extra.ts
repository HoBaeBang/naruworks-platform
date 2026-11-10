// Additional endpoint modules: every file in api/modules exporting `handlers` is merged automatically,
// so feature work adds endpoints without touching shared files.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Ctx } from './handlers.ts';

type Handler = (ctx: Ctx, body: any) => any | Promise<any>;

export const extraHandlers: Record<string, Handler> = {};

const dir = join(import.meta.dirname, 'modules');
for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
  const mod = await import(pathToFileURL(join(dir, f)).href);
  Object.assign(extraHandlers, mod.handlers ?? {});
}

// Preloaded by `pnpm dev` (node --import): reads apps/server/.env.local (gitignored, local AI provider settings) into
// process.env before any module reads it; variables already set in the environment win. Loading it here instead of
// `--env-file-if-exists` keeps `node --watch` from watching the whole apps/server folder (the database files in
// apps/server/data then restarted the server in a loop).
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const file = new URL('../.env.local', import.meta.url);
if (existsSync(file)) {
  for (const [k, v] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

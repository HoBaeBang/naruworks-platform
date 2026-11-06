
// Vite dev server. `key: true` points the server at the mock — the Anthropic mock by default (NC_AI_PROVIDER=anthropic,
// ANTHROPIC_API_KEY=test-key, ANTHROPIC_BASE_URL=mock), or with `provider: 'openai'` the OpenAI Responses mock
// e2e/ai-mock-openai.mjs (OPENAI_BASE_URL=mock, OPENAI_API_KEY=test-key, NC_AI_MODEL=gpt-mock-astra);
// `key: false` runs without any provider (the "connect a provider" states). Real provider settings from the calling
// shell (OPENAI_*, ANTHROPIC_*, NC_AI_*) are always dropped, so a test can never reach a real endpoint.
// NC_E2E_PORTS="api,web,mock" (+ NC_E2E_DATA_DIR) moves a suite to other ports, e.g. while another agent runs it.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function waitFor(url, init, ms = 30000) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(url, init);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > ms) throw new Error(`timeout waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function startHarness({ key = true, provider = 'anthropic', apiPort = 3021, webPort = 5181, mockPort = 3022, log = !!process.env.HARNESS_LOG, dataDir: dataDirOpt, env: extraEnv = {} } = {}) {
  const ports = (process.env.NC_E2E_PORTS ?? '').split(',').map(Number).filter((n) => n > 0);
  if (ports.length === 3) [apiPort, webPort, mockPort] = ports;
  if (process.env.NC_E2E_DATA_DIR) dataDirOpt = process.env.NC_E2E_DATA_DIR;
  const procs = [];
  const lines = [];
  const spawnLogged = (name, cmd, args, opts) => {
    const p = spawn(cmd, args, { ...opts, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = (d) => {
      const ls = d.toString().split('\n').filter(Boolean).map((l) => `[${name}] ${l}`);
      lines.push(...ls);
      if (log) process.stdout.write(ls.join('\n') + '\n');
    };
    p.stdout.on('data', out);
    p.stderr.on('data', out);
    procs.push(p);
    return p;
  };
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_BASE_URL;
  for (const k of Object.keys(env)) if (k.startsWith('OPENAI_')) delete env[k];
  delete env.NC_AI_MODEL;
  delete env.NC_AI_FAST_MODEL;
  env.NC_AI_PROVIDER = 'none';
  if (key && provider === 'openai') {
    spawnLogged('mock', process.execPath, [join(ROOT, 'e2e/ai-mock-openai.mjs'), String(mockPort)], { env });
    env.NC_AI_PROVIDER = 'openai';
    env.OPENAI_BASE_URL = `http://127.0.0.1:${mockPort}/v1`;
    env.OPENAI_API_KEY = 'test-key';
    env.NC_AI_MODEL = 'gpt-mock-astra';
  } else if (key) {
    spawnLogged('mock', process.execPath, [join(ROOT, 'e2e/ai-mock-anthropic.mjs'), String(mockPort)], { env });
    env.NC_AI_PROVIDER = 'anthropic';
    env.ANTHROPIC_API_KEY = 'test-key';
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mockPort}`;
  }
  
  if (dataDirOpt) mkdirSync(dataDirOpt, { recursive: true });
  const dataDir = mkdtempSync(join(dataDirOpt ?? tmpdir(), 'nc-ai-e2e-'));
  Object.assign(env, extraEnv);
  // same dev switches as `pnpm dev` (apps/server package.json): login codes shown on the auth page, loopback fetches
  spawnLogged('api', process.execPath, ['src/main.ts'], { cwd: join(ROOT, 'apps/server'), env: { ...env, PORT: String(apiPort), NC_DATA_DIR: dataDir, NC_DEV_LOGIN_CODES: '1', NC_DEV_ALLOW_LOOPBACK_FETCH: '1' } });
  spawnLogged('web', process.execPath, [join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'), '--config', join(ROOT, 'e2e/ai-vite.config.mjs')], {
    cwd: join(ROOT, 'apps/web'),
    env: { ...env, NC_API: `http://127.0.0.1:${apiPort}`, NC_WEB_PORT: String(webPort), ...(ports.length === 3 ? { NC_E2E_VITE_CACHE: join(tmpdir(), `nc-ai-e2e-vite-cache-${webPort}`) } : {}) },
  });
  const stop = () => { for (const p of procs) p.kill('SIGTERM'); };
  process.on('exit', stop);
  try {
    await waitFor(`http://127.0.0.1:${apiPort}/api/rpc/checkSignInMethods`, { method: 'POST', body: '{}' });
    await waitFor(`http://127.0.0.1:${webPort}/`);
  } catch (e) {
    stop();
    throw e;
  }
  return { base: `http://127.0.0.1:${webPort}`, stop, dataDir, logs: () => lines };
}

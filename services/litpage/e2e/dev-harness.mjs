

// e2e/dev-vite.config.mjs (own dep cache, /v1 proxy). Ports: API 3201, web 5521, mock 3202 (the webhook receiver of
// dev-platform.mjs uses 3203). Nothing here talks to the network beyond 127.0.0.1.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_ROOT = '/tmp/nc-e2e/wave3/dev/data';
export const SHOTS_ROOT = '/tmp/nc-e2e/wave3/dev/shots';

async function waitFor(url, init, ms = 40000) {
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

export async function startDevHarness({ key = true, apiPort = 3201, webPort = 5521, mockPort = 3202, env: extraEnv = {}, log = !!process.env.HARNESS_LOG } = {}) {
  // NC_E2E_PORTS="api,web,mock" moves the servers to other ports (several agents testing at once)
  const ports = (process.env.NC_E2E_PORTS ?? '').split(',').map(Number).filter((n) => n > 0);
  if (ports.length === 3) [apiPort, webPort, mockPort] = ports;
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
  // never a real model provider: openai settings from the shell are dropped, the mock provider is chosen explicitly
  for (const k of Object.keys(env)) if (k.startsWith('OPENAI_')) delete env[k];
  delete env.NC_AI_MODEL;
  delete env.NC_AI_FAST_MODEL;
  env.NC_AI_PROVIDER = 'none';
  if (key) {
    spawnLogged('mock', process.execPath, [join(ROOT, 'e2e/ai-mock-anthropic.mjs'), String(mockPort)], { env });
    env.NC_AI_PROVIDER = 'anthropic';
    env.ANTHROPIC_API_KEY = 'test-key';
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${mockPort}`;
  }
  mkdirSync(DATA_ROOT, { recursive: true });
  const dataDir = mkdtempSync(join(DATA_ROOT, 'run-'));
  Object.assign(env, extraEnv);
  spawnLogged('api', process.execPath, ['src/main.ts'], { cwd: join(ROOT, 'apps/server'), env: { ...env, PORT: String(apiPort), NC_DATA_DIR: dataDir, NC_DEV_LOGIN_CODES: '1', NC_DEV_ALLOW_LOOPBACK_FETCH: '1' } });
  spawnLogged('web', process.execPath, [join(ROOT, 'apps/web/node_modules/vite/bin/vite.js'), '--config', join(ROOT, 'e2e/dev-vite.config.mjs')], {
    cwd: join(ROOT, 'apps/web'),
    env: { ...env, NC_API: `http://127.0.0.1:${apiPort}`, NC_WEB_PORT: String(webPort), ...(ports.length === 3 ? { NC_E2E_VITE_CACHE: join(tmpdir(), `nc-dev-e2e-vite-cache-${webPort}`) } : {}) },
  });
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    for (const p of procs) p.kill('SIGTERM');
  };
  process.on('exit', stop);
  try {
    await waitFor(`http://127.0.0.1:${apiPort}/api/rpc/checkSignInMethods`, { method: 'POST', body: '{}' });
    await waitFor(`http://127.0.0.1:${webPort}/`);
  } catch (e) {
    console.log(lines.slice(-30).join('\n'));
    stop();
    throw e;
  }
  return { base: `http://127.0.0.1:${webPort}`, api: `http://127.0.0.1:${apiPort}`, stop, dataDir, logs: () => lines };
}


export function reporter() {
  let passed = 0;
  let failed = 0;
  return {
    ok(cond, msg, extra) {
      console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}${!cond && extra !== undefined ? ` — ${typeof extra === 'string' ? extra : JSON.stringify(extra)}` : ''}`);
      if (cond) passed++;
      else failed++;
    },
    get failed() { return failed; },
    done(label) {
      console.log(`\n${label}: ${passed} passed, ${failed} failed`);
      if (failed) process.exitCode = 1;
    },
  };
}

/** Fake Web Speech API (never the real microphone or a network STT): window.__say(text, {interim, speaker}) feeds the
 *  current recognition; window.__fakeSpeech.mode = 'deny' makes the next start fail with not-allowed. Speech synthesis is
 *  faked too (window.__spoken lists what the consent message said). `unsupported: true` removes the API instead. */
export function speechInitScript({ unsupported = false } = {}) {
  return `(() => {
    if (${unsupported}) {
      try { delete window.SpeechRecognition; } catch {}
      try { delete window.webkitSpeechRecognition; } catch {}
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
      return;
    }
    const fs = window.__fakeSpeech = { mode: 'ok', started: 0, stopped: 0, current: null, langs: [] };
    class FakeRecognition {
      constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.maxAlternatives = 1; this.onresult = null; this.onerror = null; this.onend = null; }
      start() {
        fs.started++;
        fs.langs.push(this.lang);
        if (fs.mode === 'deny') { setTimeout(() => { this.onerror && this.onerror({ error: 'not-allowed' }); this.onend && this.onend(); }, 30); return; }
        fs.current = this;
      }
      stop() { fs.stopped++; if (fs.current === this) fs.current = null; setTimeout(() => this.onend && this.onend(), 10); }
      abort() { this.stop(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true, writable: true });
    window.__say = (text, opts = {}) => {
      const r = fs.current;
      if (!r || !r.onresult) return false;
      const res = [{ transcript: text, confidence: 0.92 }];
      res.isFinal = !opts.interim;
      if (opts.speaker) res.speaker = opts.speaker;
      r.onresult({ resultIndex: 0, results: [res] });
      return true;
    };
    window.__spoken = [];
    class FakeUtterance { constructor(text) { this.text = text; this.lang = ''; this.voice = null; this.onend = null; this.onerror = null; } }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true });
    Object.defineProperty(window, 'speechSynthesis', { value: { speak(u) { window.__spoken.push(u.text); setTimeout(() => u.onend && u.onend(), 20); }, cancel() {}, getVoices() { return []; }, speaking: false, pending: false, paused: false }, configurable: true });
  })();`;
}

/** Put the caret on a new empty line at the end of the open page (click below the content, like a person would). */
export async function appendLine(page) {
  const el = page.locator('.nc-click-to-append').first();
  await el.waitFor({ state: 'attached' });
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox();
  await page.mouse.click(box.x + 120, box.y + 24);
  await page.waitForTimeout(250);
}

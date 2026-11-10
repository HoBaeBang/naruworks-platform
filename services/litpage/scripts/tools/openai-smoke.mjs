// Manual smoke test of the openai provider against the REAL endpoint configured in apps/server/.env.local
// (NC_AI_PROVIDER / OPENAI_BASE_URL / OPENAI_API_KEY / NC_AI_MODEL; variables already set in the environment win,
// like `pnpm dev`). It runs the server's own provider code (apps/server/src/ai — runStream through the openai adapter)
// with a few tiny prompts: the /models list, text, the full Agent tool set (schemas accepted), a tool round trip
// (call_id + encrypted reasoning replayed),
// web search with citations and an image input;
// `--all` adds a PDF input, web search limited to a domain (Custom Agents' web domains) and the replay of a
// web_search_call item. Never run by tests or e2e. The key is only sent in the Authorization header and never printed.
// node scripts/tools/openai-smoke.mjs [--all]
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SERVER = join(ROOT, 'apps/server');
const all = process.argv.includes('--all');

// ---- configuration: Node's own .env parser, as `pnpm dev` uses it (variables already in the environment win)
if (existsSync(join(SERVER, '.env.local'))) process.loadEnvFile(join(SERVER, '.env.local'));
else console.log('note: apps/server/.env.local not found — using the environment only');
process.env.NC_AI_PROVIDER ||= 'openai';
if (!process.env.OPENAI_API_KEY) {
  console.log('FAIL config — OPENAI_API_KEY must be set (apps/server/.env.local or the environment)');
  process.exit(1);
}

const imp = (p) => import(pathToFileURL(join(SERVER, 'src', p)).href);
const { runStream, mapError } = await imp('ai/client.ts');
const models = await imp('ai/models.ts');
const { refreshOpenAIModels } = await imp('ai/providers/openaiModels.ts');
const { openaiConfig, providerId, scrub } = await imp('ai/providers/config.ts');
const { openaiClient } = await imp('ai/providers/openai.ts');
const { registerToolDefs, toolParams } = await imp('ai/tools/defs.ts');
const { CHAT_TOOLS } = await imp('ai/prompts.ts');

let failed = 0;
const report = (ok, name, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${scrub(String(detail)).replace(/\s+/g, ' ').slice(0, 400)}`);
};
const usage = (u) => `in=${u.input} cached=${u.cacheRead} out=${u.output}`;
async function check(name, fn) {
  const t0 = Date.now();
  try {
    const [ok, detail] = await fn();
    report(ok, name, `${detail} (${Date.now() - t0} ms)`);
  } catch (e) {
    const err = mapError(e);
    report(false, name, `${err.code}: ${err.message}${e?.detail ? ` [${e.detail}]` : ''}`);
  }
}
const sys = (text) => [{ type: 'text', text }];
const user = (content) => [{ role: 'user', content }];

console.log(`provider=${providerId()} endpoint=${new URL(openaiConfig().baseUrl).host}`);

await check('models', async () => {
  const list = await refreshOpenAIModels();
  const offered = models.offeredModels(false);
  return [!!list?.length && offered.length > 0, `${offered.map((m) => `${m.name}${m.group === 'other' ? ' (other)' : ''}`).join(', ')} · default ${models.DEFAULT_MODEL} · fast ${models.fastModel()}`];
});

await check('text', async () => {
  const r = await runStream({ system: sys('You are a terse test assistant.'), messages: user('Reply with exactly: pong'), effort: 'low', maxTokens: 2_000 });
  return [/pong/i.test(r.text) && r.stopReason === 'end_turn', `"${r.text}" · ${r.model} · ${usage(r.usage)}`];
});

await check('Litpage Agent tool schemas accepted', async () => {
  const r = await runStream({ system: sys('You are a terse test assistant. Do not call any tool.'), messages: user('Reply with exactly: ready'), effort: 'low', maxTokens: 64_000, tools: CHAT_TOOLS }, {}, { executeTool: async () => ({ content: 'unused' }) });
  return [/ready/i.test(r.text), `${CHAT_TOOLS.length} function tools · "${r.text}" · ${usage(r.usage)}`];
});

registerToolDefs([{ name: 'get_weather', description: 'Current weather for a city.', access: 'read', input_schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false } }]);
await check('tool round trip (call_id; reasoning replayed when the model reasons)', async () => {
  // a recording client: the second request must carry the call, its output (same call_id) and the model's encrypted
  // reasoning without item ids (store is false)
  const shapes = [];
  const client = openaiClient(openaiConfig(), {
    fetch: async (url, init) => {
      shapes.push(JSON.parse(String(init.body)).input.map((i) => (i.type === 'reasoning' ? `reasoning${i.encrypted_content ? '+enc' : ''}${'id' in i ? '+id' : ''}` : i.type)).join(','));
      return fetch(url, init);
    },
  });
  const calls = [];
  const r = await runStream({ system: sys('You are a careful assistant. Think before acting. Use tools when asked.'), messages: user('Call get_weather for Seoul, then tell me in one short sentence whether 17°C is warmer than the yearly average of 12.5°C.'), effort: 'high', maxTokens: 64_000, tools: toolParams(['get_weather']) }, {}, {
    client,
    executeTool: async (name, input) => {
      calls.push(`${name}(${JSON.stringify(input)})`);
      return { content: JSON.stringify({ city: input.city, temp_c: 17, sky: 'clear' }) };
    },
  });
  const replay = shapes[1] ?? '';
  return [calls.length >= 1 && /17/.test(r.text) && /function_call_output/.test(replay) && !/\+id/.test(replay), `${calls.join(', ')} → "${r.text}" · request 2: ${replay} · ${r.model} · ${usage(r.usage)}`];
});

await check('web search', async () => {
  const steps = [];
  const cites = [];
  const r = await runStream({ system: sys('You are a terse research assistant. Cite your sources.'), messages: user('Search the web: what is the latest stable Node.js major version? Answer in one sentence.'), effort: 'low', maxTokens: 64_000, serverTools: models.webToolDefs(models.DEFAULT_MODEL, { fetch: false }) }, {
    onServerTool: (e) => steps.push(`${e.name}(${e.input.query ?? e.input.url ?? ''})`),
    onServerResult: (e) => steps.push(`${e.results.length} results`),
    cite: (c) => { cites.push(c.url); return cites.length; },
  });
  return [steps.length > 0 && cites.length > 0 && /\[1\]/.test(r.text) && !/\]\(https?:/.test(r.text), `${steps.join(' → ')} · "${r.text}" · cites ${cites.join(' ')} · ${usage(r.usage)}`];
});

function solidPng(w, h, [red, green, blue]) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [red, green, blue]).flat()));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}
await check('image input', async () => {
  const r = await runStream({ system: sys('You are a terse test assistant.'), messages: user([{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: solidPng(32, 32, [20, 90, 230]) } }, { type: 'text', text: 'Which single color fills this image? One word.' }]), effort: 'low', maxTokens: 64_000 });
  return [/blue|azure|cobalt|royal|sapphire|cerulean|navy/i.test(r.text), `"${r.text}" · ${usage(r.usage)}`];
});

if (all) {
  const pdf = (() => {
    const text = 'HELLO ZEBRA';
    const stream = `BT /F1 24 Tf 20 40 Td (${text}) Tj ET`;
    const objs = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
    let out = '%PDF-1.4\n';
    const offs = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return Buffer.from(out, 'latin1').toString('base64');
  })();
  await check('PDF input', async () => {
    const r = await runStream({ system: sys('You are a terse test assistant.'), messages: user([{ type: 'document', title: 'probe', source: { type: 'base64', media_type: 'application/pdf', data: pdf } }, { type: 'text', text: 'Which two words are written in this PDF? Reply with just them.' }]), effort: 'low', maxTokens: 64_000 });
    return [/hello/i.test(r.text) && /zebra/i.test(r.text), `"${r.text}"`];
  });
  await check('web search limited to a domain', async () => {
    const cites = [];
    const defs = models.webToolDefs(models.DEFAULT_MODEL, { fetch: false }).map((d) => ({ ...d, allowed_domains: ['nodejs.org'] }));
    const r = await runStream({ system: sys('You are a terse research assistant. Cite your sources.'), messages: user('Search the web for the current Node.js LTS release line. One sentence.'), effort: 'low', maxTokens: 64_000, serverTools: defs }, { cite: (c) => { cites.push(c.url); return cites.length; } });
    return [cites.length > 0 && cites.every((u) => new URL(u).hostname.endsWith('nodejs.org')), `cites ${cites.join(' ')} · "${r.text}"`];
  });
  await check('web_search_call replay', async () => {
    // an earlier turn's search, replayed the way the adapter does it (no item id, no source list)
    const content = [
      { type: 'server_tool_use', id: 'ws_x', name: 'web_search', input: { query: 'node lts' }, _openai: { item: { type: 'web_search_call', status: 'completed', action: { type: 'search', query: 'node lts' } } } },
      { type: 'web_search_tool_result', tool_use_id: 'ws_x', content: [] },
      { type: 'text', text: 'Node.js 24 is the active LTS line.' },
    ];
    const r = await runStream({ system: sys('You are a terse test assistant.'), messages: [{ role: 'user', content: 'Which Node.js line is LTS?' }, { role: 'assistant', content }, { role: 'user', content: 'What did you search the web for? Reply with the query only.' }], effort: 'low', maxTokens: 64_000, serverTools: models.webToolDefs(models.DEFAULT_MODEL, { fetch: false }) });
    return [r.text.length > 0, `"${r.text}"`];
  });
}

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);


// formula…", the send button, progress (Thinking / Writing / Reading errors / Fixing) with Cancel · esc, the answer card
// (explanation, Output preview, Show types, Undo, 👍 / 👎 feedback), the code-box assistant toggle and the
// no-key state. The model is a local mock started by this script — nothing leaves the machine.
//   no key:   NC_BASE=http://127.0.0.1:5421 node e2e/db-formula-ai.mjs
//   with key: API started with ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:3124, then
//             NC_FX_AI=1 NC_BASE=http://127.0.0.1:5421 node e2e/db-formula-ai.mjs
import { createServer } from 'node:http';
import { createInlineDb, freshPage, setup, tableHelpers, apiCall } from './db-lib.mjs';

process.env.NC_SHOTS ??= '/tmp/nc-e2e/wave3/dba/shots/db-formula-ai';
const withKey = process.env.NC_FX_AI === '1';
const MOCK_PORT = Number(process.env.NC_FX_AI_MOCK_PORT ?? 3124);
const mockRequests = [];

function answerFor(text) {
  const cur = /<current_formula>\n([\s\S]*?)\n<\/current_formula>/.exec(text)?.[1] ?? '';
  const req = /Request: ([\s\S]*)$/.exec(text)?.[1] ?? '';
  if (/slow/i.test(req)) return { delay: 4000, json: { formula: 'prop("Estimate")', explanation: 'Slow answer.' } };
  if (/explain/i.test(req)) return { delay: 300, json: { formula: cur, explanation: 'Counts the days from today until the Due date.' } };
  if (/fix/i.test(req)) return { delay: 1500, json: { formula: 'prop("Estimate") * 2', explanation: 'dateAdd needs a date; this doubles the estimate instead.' } };
  if (/days until due/i.test(req)) return { delay: 300, json: { formula: 'dateBetween(prop("Due"), today(), "days")', explanation: 'Counts the days from today until Due.' } };
  return { delay: 200, json: { formula: 'prop("Estimate") + 1', explanation: 'Adds one to the estimate.' } };
}

function startMock() {
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      if (req.method !== 'POST' || !req.url?.startsWith('/v1/messages') || req.headers['x-api-key'] !== 'test-key') {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
        return;
      }
      const body = JSON.parse(raw || '{}');
      const last = body.messages?.at(-1);
      const text = typeof last?.content === 'string' ? last.content : (last?.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
      const firstUser = body.messages?.[0]?.content?.[0]?.text ?? '';
      mockRequests.push({ system: body.system?.[0]?.text ?? '', text: firstUser });
      const a = answerFor(firstUser || text);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'request-id': 'req_fx_mock' });
      let closed = false;
      res.on('close', () => { closed = true; });
      const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
      send('message_start', { type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
      await new Promise((r) => setTimeout(r, a.delay));
      if (closed) return;
      const out = JSON.stringify(a.json);
      send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } });
      send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: out } });
      send('content_block_stop', { type: 'content_block_stop', index: 0 });
      send('message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
      send('message_stop', { type: 'message_stop' });
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(MOCK_PORT, '127.0.0.1', () => resolve(server)));
}

const mock = withKey ? await startMock() : null;
const T = await setup(withKey ? 'db-formula-ai' : 'db-formula-ai-nokey');
const { page, wait, check, shot, section, closeOverlays } = T;
const tb = tableHelpers(page, 0);

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > end) return false;
    await wait(150);
  }
}

const input = () => page.locator('.nc-fx-ai-text');
const code = () => page.locator('.nc-fx-code');
async function ask(text) {
  await input().click();
  await page.keyboard.type(text, { delay: 8 });
  await page.keyboard.press('Enter');
}

try {
  await freshPage(page, 'Formula AI Lab');

  await section('setup', async () => {
    await createInlineDb(page, 'Tasks');
    await tb.addProperty('Due', 'Date');
    await tb.addProperty('Estimate', 'Number');
    await tb.newRow('Alpha');
    check('setup: database ready', (await tb.titles()).includes('Alpha'));
  });

  // every section ends by closing overlays (and the formula editor with them): the whole flow runs in one section
  async function openNewFormula() {
    await tb.db().hover();
    await tb.db().locator('[data-testid="add-column-button"]').first().click();
    await page.waitForSelector('.nc-add-prop');
    await page.keyboard.type('Days left', { delay: 8 });
    await page.locator('.nc-add-prop-cell').filter({ has: page.locator('.nc-add-prop-cell-label', { hasText: /^Formula$/ }) }).first().click();
    await page.waitForSelector('.nc-fx-dialog', { timeout: 8000 });
    await wait(400);
    check('assistant: input "Describe a formula, or ask about this one…"', (await input().getAttribute('placeholder')) === 'Describe a formula, or ask about this one…');
    check('assistant: send button "Ask Litpage AI"', await page.locator('.nc-fx-ai .nc-fx-ai-send[role="button"]').count());
    const toggle = page.locator('.nc-fx-codebox .nc-fx-ai-toggle');
    const toggleTip = (await toggle.count()) ? `${await toggle.getAttribute('aria-pressed')} ${await toggle.getAttribute('data-tooltip')}` : 'missing';
    check('assistant: toggle in the code box (open: "Hide formula assistant", closed: "Get help with this formula")', toggleTip === 'true Hide formula assistant', toggleTip);
    const box = await page.locator('.nc-fx-ai-input').boundingBox();
    check('assistant: input card ≥ 40px tall', box && box.height >= 40, JSON.stringify(box));
  }

  if (!withKey) {
    await section('no-key', async () => {
      await openNewFormula();
      const ok = await waitFor(async () => (await page.locator('.nc-fx-ai-banner').count()) > 0, 5000);
      check('no key: banner "Connect an AI provider to use Litpage AI"', ok && (await page.locator('.nc-fx-ai-banner').innerText()).includes('Connect an AI provider to use Litpage AI'));
      check('no key: input disabled', await input().isDisabled());
      const r = await apiCall(page, 'aiFormula', { collectionId: 'x', prompt: 'hi' });
      check('no key: aiFormula answers 400 with the connect-a-key message', r.status === 400 && /Connect an AI provider/.test(r.body?.message ?? ''), JSON.stringify(r).slice(0, 160));
      await shot('01-no-key');
      // the editor itself keeps working
      await code().click();
      await page.keyboard.type('1 + 1', { delay: 10 });
      await wait(300);
      check('no key: formula editor still works', (await page.locator('.nc-fx-type').innerText()).includes('number'));
      await page.locator('.nc-fx-close').click();
      await wait(400);
    });
  } else {
    await section('assistant', async () => {
      await openNewFormula();
      await ask('days until due');
      const running = await waitFor(async () => (await page.locator('.nc-fx-ai-progress').count()) > 0, 2000);
      check('progress: "Thinking" with Cancel · esc', running && /Thinking|Writing/.test(await page.locator('.nc-fx-ai-progress').innerText()) && (await page.locator('.nc-fx-ai-progress').innerText()).includes('Cancel'));
      const done = await waitFor(async () => (await page.locator('.nc-fx-ai-answer').count()) > 0, 8000);
      check('answer: card shown', done);
      check('answer: explanation', (await page.locator('.nc-fx-ai-explanation').innerText()).includes('Counts the days from today until Due.'));
      check('answer: formula replaced (dateBetween + Due chip)', (await code().innerText()).includes('dateBetween') && (await code().innerText()).includes('Due'), await code().innerText());
      check('answer: type badge "number"', (await page.locator('.nc-fx-type').innerText()).includes('number'));
      await page.locator('.nc-fx-ai-showtypes').click();
      await wait(150);
      check('Show types: output type + property types', (await page.locator('.nc-fx-ai-type').innerText()).includes('number') && (await page.locator('.nc-fx-ai-types').innerText()).includes('Due: date'));
      check('model request: schema + current formula', mockRequests.at(-1)?.text.includes('- Due (date)') && mockRequests.at(-1)?.text.includes('<current_formula>'));
      await shot('01-answer');
      await page.locator('.nc-fx-ai-btn', { hasText: 'Undo' }).click();
      await wait(200);
      check('Undo: restores the previous formula', !(await code().innerText()).includes('dateBetween'));
      await ask('days until due');
      await waitFor(async () => (await page.locator('.nc-fx-ai-answer').count()) > 0, 8000);

      // ---- explain
      const beforeExplain = await code().innerText();
      await ask('explain this formula');
      await waitFor(async () => (await page.locator('.nc-fx-ai-explanation').innerText().catch(() => '')).includes('Counts the days from today until the Due date.'), 8000);
      check('explain: explanation shown', (await page.locator('.nc-fx-ai-explanation').innerText()).includes('Counts the days from today until the Due date.'));
      check('explain: formula unchanged, no Undo', (await code().innerText()) === beforeExplain && (await page.locator('.nc-fx-ai-btn', { hasText: 'Undo' }).count()) === 0);

      // ---- fix
      await code().click();
      await page.keyboard.press('Meta+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('prop("Estimate").dateAdd(1, "days")', { delay: 5 });
      await wait(400);
      check('fix: the formula has an error', await page.locator('.nc-fx-result .nc-fx-error-text').count());
      await ask('fix the errors in this formula');
      const reading = await waitFor(async () => /Reading errors|Fixing/.test(await page.locator('.nc-fx-ai-progress').innerText().catch(() => '')), 2000);
      check('fix: progress "Reading errors" / "Fixing"', reading);
      await waitFor(async () => (await code().innerText()).includes('* 2'), 8000);
      check('fix: corrected formula', (await code().innerText()).includes('* 2'), await code().innerText());
      check('fix: request carried the error', /<current_error>/.test(mockRequests.at(-1)?.text ?? ''));
      await shot('02-fixed');

      // ---- cancel
      const beforeCancel = await code().innerText();
      await ask('slow please');
      await waitFor(async () => (await page.locator('.nc-fx-ai-progress').count()) > 0, 2000);
      await page.keyboard.press('Escape');
      await wait(300);
      check('cancel: esc stops the assistant, the editor stays open', (await page.locator('.nc-fx-ai-progress').count()) === 0 && (await page.locator('.nc-fx-dialog').count()) === 1);
      await wait(4200);
      check('cancel: the late answer is ignored', (await code().innerText()) === beforeCancel);

      // ---- feedback
      await page.locator('.nc-fx-ai-icon-btn[aria-label="Bad response"]').click();
      await page.waitForSelector('.nc-fx-ai-feedback');
      check('feedback: "How can we improve this result?"', (await page.locator('.nc-fx-ai-feedback').innerText()).includes('How can we improve this result?'));
      await page.keyboard.type('Use weeks', { delay: 8 });
      await page.locator('.nc-fx-ai-feedback button', { hasText: 'Send feedback' }).click();
      const toast = await waitFor(async () => (await page.locator('text=Your feedback has been submitted, thanks!').count()) > 0, 3000);
      check('feedback: toast', toast);

      // ---- toggle-and-save
      await page.locator('.nc-fx-codebox .nc-fx-ai-toggle').click();
      await wait(150);
      check('toggle: hides the assistant', (await page.locator('.nc-fx-ai').count()) === 0 && (await page.locator('.nc-fx-ai-toggle').getAttribute('data-tooltip')) === 'Get help with this formula');
      await page.locator('.nc-fx-codebox .nc-fx-ai-toggle').click();
      await wait(150);
      check('toggle: shows it again', (await page.locator('.nc-fx-ai').count()) === 1);
      await page.locator('.nc-fx-close').click();
      await wait(500);
      const blockId = await page.locator('.nc-db-block').first().getAttribute('data-block-id');
      const chunk = await apiCall(page, 'loadPage', { pageId: blockId });
      const colId = chunk.body?.recordMap?.block?.[blockId]?.value?.value?.collection_id;
      const col = chunk.body?.recordMap?.collection?.[colId]?.value?.value;
      const fx = Object.values(col?.schema ?? {}).find((p) => p.name === 'Days left');
      check('save: formula property saved from the assistant', fx?.type === 'formula' && JSON.stringify(fx.formula2?.code ?? '').includes('* 2'), JSON.stringify(fx?.formula2 ?? null).slice(0, 160));
    });
  }
} catch (e) {
  check('no fatal error', false, e.message);
  await shot('fatal');
} finally {
  await T.finish();
  mock?.close();
}

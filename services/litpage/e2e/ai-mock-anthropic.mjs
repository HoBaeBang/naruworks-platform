// Mock of the Anthropic Messages API (POST /v1/messages, streaming SSE wire format) for E2E tests of

//   - writer / AI block / autofill / chat-title system prompts get canned answers
//   - chat requests mentioning "search" trigger a search_workspace tool call, then a cited answer
//   - "who are you?" echoes the personalized name and <user_instructions> from the system prompt
//   - "slow" in the last user message streams slowly (for Stop), "[[429]]" returns a rate-limit error
//   - agent scenarios call the write tools and finish with a short summary (see AGENT below):
//       create a page called "X" · append "X" to this page · rename this page to "X" · delete this page ·
//       create a database · comment "X" on this page · remember that X · prioritize my inbox · use my skill ·
//       suggest replacing "X" with "Y" (suggested edits)
//     plan mode (system "Plan mode is on") proposes a plan first, research mode searches then reports
//   - web: when web_search is offered and the question says "web" / "latest", emulates the server tool
//     (server_tool_use → web_search_tool_result → cited text with citations_delta)

//     quotes its result. Legacy MCP connector: with mcp_servers set and the question saying "mcp" / "weather", the mock really calls the MCP
//     server (JSON-RPC tools/list + tools/call with the authorization token) and streams mcp_tool_use / mcp_tool_result
//   - attachments: image / document blocks and inlined <file> text are described back
// Usage: node e2e/ai-mock-anthropic.mjs [port]   (key "test-key" is accepted; anything else → 401)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const port = Number(process.argv[2] ?? process.env.MOCK_PORT ?? 3012);
export const requests = [];

function lastUserText(body) {
  const msgs = body.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const texts = m.content.filter((b) => b.type === 'text').map((b) => b.text);
    if (texts.length) return texts.join('\n');
    return null; // tool results
  }
  return '';
}

/** The user's own words: the last text block of the last user turn with text (context blocks come first). */
function question(body) {
  const msgs = body.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    const texts = m.content.filter((b) => b.type === 'text');
    if (!texts.length) continue; // a tool_result turn: keep looking for the question
    return texts[texts.length - 1].text;
  }
  return '';
}

/** Content blocks of the last user turn that has text (attachments, page contexts, the question). */
function userTurnBlocks(body) {
  const msgs = body.messages ?? [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return [{ type: 'text', text: m.content }];
    if (m.content.some((b) => b.type === 'text' || b.type === 'image' || b.type === 'document')) return m.content;
  }
  return [];
}

/** Tool calls of the current turn (after the last user message with text), with their results. */
function turnTools(body) {
  const msgs = body.messages ?? [];
  let start = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.role === 'user' && (typeof m.content === 'string' || m.content.some((b) => b.type === 'text'))) {
      start = i + 1;
      break;
    }
  }
  const out = [];
  for (const m of msgs.slice(start)) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (m.role === 'assistant' && b.type === 'tool_use') out.push({ id: b.id, name: b.name, input: b.input, result: null });
      if (m.role === 'user' && b.type === 'tool_result') {
        const t = out.find((x) => x.id === b.tool_use_id);
        if (t) t.result = { text: typeof b.content === 'string' ? b.content : (b.content ?? []).map((c) => c.text ?? '').join('\n'), isError: !!b.is_error };
      }
    }
  }
  return out;
}

function systemText(body) {
  return Array.isArray(body.system) ? body.system.map((b) => b.text).join('\n') : String(body.system ?? '');
}

const hasTool = (body, name) => (body.tools ?? []).some((t) => t.name === name);

/** The page the user is on (<page id="…"> context of the turn, or of an earlier turn). */
function contextPage(body) {
  for (const m of [...(body.messages ?? [])].reverse()) {
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      const hit = b.type === 'text' && /<page id="([0-9a-f-]{36})" title="([^"]*)">/.exec(b.text);
      if (hit) return { id: hit[1], title: hit[2] };
    }
  }
  return null;
}

/** Agent scenarios: a tool call per step, then a summary that quotes the last tool result. */
function agentPlan(body, q, sys) {
  const tools = turnTools(body);
  const last = tools[tools.length - 1];
  const done = (name) => tools.find((t) => t.name === name && t.result);
  const finish = (text) => ({ text: `${text}${last?.result?.isError ? `\n\n(Tool error: ${last.result.text.slice(0, 160)})` : ''}` });
  const page = contextPage(body);

  // Plan mode: propose → (approved) create → summary
  if (/Plan mode is on/.test(sys) && hasTool(body, 'propose_plan')) {
    const plan = done('propose_plan');
    if (!plan) return { tool: { name: 'propose_plan', input: { title: 'Launch checklist', steps: ['Create a “Launch checklist” page', 'Add the launch tasks as to-dos'] } } };
    if (!/approved/i.test(plan.result.text)) return { text: 'Okay — the plan was not approved. What would you like to change?' };
    if (!done('create_pages')) return { tool: { name: 'create_pages', input: { pages: [{ title: 'Launch checklist', content: '- [ ] Final QA\n- [ ] Announce the launch' }] } } };
    return finish('The plan is done: I created **Launch checklist** with the launch tasks.');
  }
  let m;
  if ((m = /Build this database: ([^\n]+)[\s\S]*?database_id: ([0-9a-f-]{36})/i.exec(q))) {
    if (!done('update_database')) {
      return { tool: { name: 'update_database', input: { database_id: m[2], title: 'Reading list', add_properties: [{ name: 'Author', type: 'text' }, { name: 'Status', type: 'select', options: ['To read', 'Reading', 'Done'] }, { name: 'Pages left', type: 'formula', expression: '100 - 1' }], add_views: [{ type: 'board', name: 'By status', group_by: 'Status' }] } } };
    }
    if (!done('create_pages')) return { tool: { name: 'create_pages', input: { parent: { type: 'database', id: m[2] }, pages: [{ title: 'Dune', properties: { Author: 'Frank Herbert', Status: 'Reading' } }, { title: 'Neuromancer', properties: { Author: 'William Gibson', Status: 'To read' } }] } } };
    return finish('I set up the **Reading list** database with two example rows.');
  }
  if ((m = /create (?:a )?page (?:called|named) "([^"]+)"/i.exec(q))) {
    if (!done('create_pages')) return { tool: { name: 'create_pages', input: { pages: [{ title: m[1], icon: '🚀', content: '## Goals\n\n- Ship the agent\n- [ ] Write the docs' }] } } };
    return finish(`I created **${m[1]}** in your private pages.`);
  }
  if ((m = /append "([^"]+)" to this page/i.exec(q)) && page) {
    if (!done('update_page')) return { tool: { name: 'update_page', input: { page_id: page.id, command: 'append_content', new_str: m[1] } } };
    return finish(`I added “${m[1]}” to **${page.title}**.`);
  }
  if ((m = /suggest (?:an edit |edits )?(?:to )?replac(?:e|ing) "([^"]+)" with "([^"]+)"/i.exec(q)) && page) {
    if (!done('update_page')) return { tool: { name: 'update_page', input: { page_id: page.id, command: 'replace_content_range', selection_with_ellipsis: m[1], new_str: m[2], suggest: true } } };
    return finish(`I suggested replacing “${m[1]}” with “${m[2]}” on **${page.title}** — accept or reject it on the page.`);
  }
  if ((m = /replace "([^"]+)" with "([^"]+)"/i.exec(q)) && page) {
    if (!done('update_page')) return { tool: { name: 'update_page', input: { page_id: page.id, command: 'replace_content_range', selection_with_ellipsis: m[1], new_str: m[2] } } };
    return finish(`I replaced “${m[1]}” on **${page.title}**.`);
  }
  if ((m = /rename this page to "([^"]+)"/i.exec(q)) && page) {
    if (!done('update_page')) return { tool: { name: 'update_page', input: { page_id: page.id, command: 'update_properties', title: m[1] } } };
    return finish(`I renamed the page to **${m[1]}**.`);
  }
  if (/delete this page/i.test(q) && page) {
    if (!done('delete_pages')) return { tool: { name: 'delete_pages', input: { page_ids: [page.id] } } };
    return finish(/rejected/i.test(last?.result?.text ?? '') ? 'Okay, I left the page as it is.' : `I moved **${page.title}** to Trash.`);
  }
  if ((m = /comment "([^"]+)" on this page/i.exec(q)) && page) {
    if (!done('add_comment')) return { tool: { name: 'add_comment', input: { page_id: page.id, text: m[1] } } };
    return finish('I added your comment.');
  }
  if (/create (?:a )?(?:task )?database/i.test(q)) {
    const dbDone = done('create_database');
    if (!dbDone) {
      return { tool: { name: 'create_database', input: { title: 'Project tracker', properties: [{ name: 'Name', type: 'title' }, { name: 'Status', type: 'select', options: ['Todo', 'Doing', 'Done'] }, { name: 'Due', type: 'date' }], views: [{ type: 'table' }, { type: 'board', group_by: 'Status' }], rows: [{ Name: 'Kickoff', Status: 'Doing' }] } } };
    }
    const id = /database_id: ([0-9a-f-]{36})/.exec(dbDone.result.text)?.[1];
    if (id && /with rows/i.test(q) && !done('create_pages')) {
      return { tool: { name: 'create_pages', input: { parent: { type: 'database', id }, pages: [{ title: 'Write spec', properties: { Status: 'Todo', Due: '2026-10-30' } }] } } };
    }
    return finish('I created the **Project tracker** database.');
  }
  if ((m = /remember that (.+)/i.exec(q))) {
    if (!done('update_memory')) return { tool: { name: 'update_memory', input: { memory: m[1].replace(/[.!]$/, '') } } };
    return finish('Got it — I’ll remember that.');
  }
  if (/prioritize my (inbox|unread notifications)|which of my unread notifications should i handle first/i.test(q)) {
    const list = done('list_notifications');
    if (!list) return { tool: { name: 'list_notifications', input: { unread_only: true } } };
    const ids = [...list.result.text.matchAll(/notification_id ([0-9a-f-]{36})/g)].map((x) => x[1]);
    if (ids.length && !done('update_notifications')) return { tool: { name: 'update_notifications', input: { notification_ids: ids, read: true } } };
    return finish(ids.length ? `Your inbox: ${ids.length} unread notification(s). Most important first — I marked them as read.` : 'Your inbox is clear.');
  }
  if (/use my skill/i.test(q)) {
    const id = /^- ([0-9a-f-]{36}): /m.exec(sys)?.[1];
    if (id && !done('use_skill')) return { tool: { name: 'use_skill', input: { skill_id: id } } };
    const used = done('use_skill');
    return finish(used ? `Following your skill: ${used.result.text.split('\n').slice(2).join(' ').slice(0, 120)}` : 'You have no skills.');
  }
  return null;
}

/**
 * Custom Agent scenarios (system "You are a Custom Agent"): setup chats configure the agent with
 * update_agent_settings; triggered runs act on the trigger facts (comment mention → reply in the thread, page added →
 * comment on the row, schedule / Run → a report page when the instructions ask for one, else "No action needed");
 * "open https://…" asks for URL access; "notify" sends an Inbox notification; "hand off" calls another agent.
 */
function customAgentPlan(body, q, sys) {
  if (!/You are a Custom Agent in a Litpage workspace/i.test(sys)) return null;
  const tools = turnTools(body);
  const done = (name) => tools.find((t) => t.name === name && t.result);
  const instructions = /<agent_instructions>\n([\s\S]*?)\n<\/agent_instructions>/.exec(sys)?.[1] ?? '';
  const turnText = userTurnBlocks(body).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const trigger = /<trigger type="([a-z_]+)" name="([^"]*)">([\s\S]*?)<\/trigger>/.exec(turnText);
  const kind = trigger?.[1] ?? 'chat';
  const facts = trigger?.[3] ?? '';
  let m;
  if (/You are being set up/.test(sys) && hasTool(body, 'update_agent_settings') && !/^\s*(hi|hello)\b/i.test(q)) {
    const upd = done('update_agent_settings');
    if (!upd) {
      return { tool: { name: 'update_agent_settings', input: {
        name: 'Weekly reporter',
        description: 'Writes a weekly status report.',
        icon: '📈',
        instructions: `# Weekly report\n\nEvery Monday, write a report page summarizing: ${q.replace(/<[^>]+>/g, ' ').trim().slice(0, 120)}`,
        add_triggers: [{ type: 'schedule', frequency: 'week', weekdays: [1], time: '09:00' }],
      } } };
    }
    return { text: `I updated my settings: new instructions and a weekly schedule (Mondays at 9:00). Review them and click Save.${upd.result.isError ? ` (${upd.result.text.slice(0, 120)})` : ''}` };
  }
  if ((m = /create (?:a )?page (?:called|named) "([^"]+)" in "([^"]+)"/i.exec(q)) && hasTool(body, 'search_workspace')) {
    const found = done('search_workspace');
    if (!found) return { tool: { name: 'search_workspace', input: { query: m[2] } } };
    const pid = new RegExp(`${m[2].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^\\n]*?\\(page_id: ([0-9a-f-]{36})\\)`).exec(found.result.text)?.[1] ?? /\(page_id: ([0-9a-f-]{36})\)/.exec(found.result.text)?.[1];
    if (!pid) return { text: `I can’t find “${m[2]}” — I don’t have access to it. Ask an editor to add it under Tools and permissions.` };
    const made = done('create_pages');
    if (!made) return { tool: { name: 'create_pages', input: { parent: { type: 'page', id: pid }, pages: [{ title: m[1], content: 'Written by the agent.' }] } } };
    return { text: made.result.isError ? `I couldn’t create it: ${made.result.text.slice(0, 160)}` : `I created **${m[1]}** in ${m[2]}.` };
  }
  if ((m = /open (https?:\/\/\S+)/i.exec(q)) && hasTool(body, 'request_url_access')) {
    const r = done('request_url_access');
    if (!r) return { tool: { name: 'request_url_access', input: { url: m[1].replace(/[.,)]$/, ''), reason: 'The request links to it.' } } };
    return { text: /allowed|approved|granted/i.test(r.result.text) ? `I can open ${m[1]} now.` : `I asked for access to ${m[1]}: ${r.result.text.slice(0, 160)}` };
  }
  if (/\bhand (?:it )?off\b|\bask the other agent\b/i.test(`${q}\n${instructions}`) && hasTool(body, 'call_agent')) {
    const id = /^- ([0-9a-f-]{36}): /m.exec(sys)?.[1];
    const r = done('call_agent');
    if (id && !r) return { tool: { name: 'call_agent', input: { agent_id: id, task: 'Say hello and report what you can access.' } } };
    if (r) return { text: `The other agent answered: ${r.result.text.slice(0, 200)}` };
  }
  if (/\bnotify\b/i.test(`${q}\n${instructions}`) && hasTool(body, 'send_notification') && kind !== 'chat') {
    const r = done('send_notification');
    const who = /notify (\S+@\S+|[A-Z][a-z]+)/.exec(`${q}\n${instructions}`)?.[1] ?? 'me';
    if (!r) return { tool: { name: 'send_notification', input: { people: [who.replace(/[.,]$/, '')], message: 'Your agent finished its run.' } } };
    return { text: `I notified ${who}.${r.result.isError ? ` (${r.result.text.slice(0, 120)})` : ''}` };
  }
  if (kind === 'trigger' && /discussion_id: ([0-9a-f-]{36})/.test(facts)) {
    const pid = /page_id: ([0-9a-f-]{36})/.exec(facts)?.[1];
    const did = /discussion_id: ([0-9a-f-]{36})/.exec(facts)[1];
    const r = done('add_comment');
    if (!r) return { tool: { name: 'add_comment', input: { page_id: pid, discussion_id: did, text: 'On it! (agent reply)' } } };
    return { text: r.result.isError ? `I couldn't reply: ${r.result.text.slice(0, 160)}` : 'I replied in the comment thread.' };
  }
  if (kind === 'trigger' && /Page: “([^”]*)” \(page_id: ([0-9a-f-]{36})\)/.test(facts)) {
    const [, title, pid] = /Page: “([^”]*)” \(page_id: ([0-9a-f-]{36})\)/.exec(facts);
    if (/no action/i.test(instructions)) return { text: 'No action needed — my instructions say to skip these pages.' };
    const r = done('add_comment');
    if (!r) return { tool: { name: 'add_comment', input: { page_id: pid, text: `Triaged by the agent: ${title || 'Untitled'}` } } };
    return { text: r.result.isError ? `I couldn't triage “${title}”: ${r.result.text.slice(0, 160)}` : `I triaged “${title}” and left a comment.` };
  }
  if ((kind === 'trigger' || kind === 'manual') && hasTool(body, 'create_pages')) {
    if (/report/i.test(instructions)) {
      const r = done('create_pages');
      if (!r) return { tool: { name: 'create_pages', input: { pages: [{ title: 'Agent report', content: '## Summary\n\n- Everything is on track.' }] } } };
      return { text: r.result.isError ? `I couldn't write the report: ${r.result.text.slice(0, 160)}` : 'I wrote the **Agent report** page.' };
    }
    if (/fail/i.test(instructions)) return { error: 400, message: 'Agent mock failure' };
    return { text: 'No action needed — there was nothing to do.' };
  }
  return null;
}

// "mcp" / "weather" questions call the weather tool ("delete" asks for a destructive one), then quote the result.
function mcpClientPlan(body, q) {
  const tools = (body.tools ?? []).filter((t) => /^mcp_[0-9a-f]{8}_/.test(t.name ?? ''));
  if (!tools.length || !/\b(mcp|weather)\b/i.test(q)) return null;
  const want = /\bdelete\b/i.test(q) ? tools.find((t) => /delete/.test(t.name)) : tools.find((t) => /weather/.test(t.name)) ?? tools[0];
  if (!want) return { text: 'No MCP tools are enabled.' };
  const call = turnTools(body).find((t) => t.name === want.name);
  if (!call) return { tool: { name: want.name, input: /weather/.test(want.name) ? { city: 'Seoul' } : {} } };
  if (!call.result) return null;
  if (/rejected/i.test(call.result.text)) return { text: 'OK — I didn’t run that tool.' };
  return { text: call.result.isError ? `The MCP tool failed: ${call.result.text.slice(0, 160)}` : `The MCP tool says: ${call.result.text}` };
}

async function mcpPlan(body, q) {
  const servers = body.mcp_servers ?? [];
  if (!servers.length || !/\b(mcp|weather)\b/i.test(q)) return null;
  const s = servers[0];
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(s.authorization_token ? { authorization: `Bearer ${s.authorization_token}` } : {}) };
  const rpc = async (id, method, params) => {
    const r = await fetch(s.url, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
    if (!r.ok) throw new Error(`MCP HTTP ${r.status}`);
    return (await r.json()).result;
  };
  try {
    await rpc(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mock-anthropic', version: '1' } });
    const list = await rpc(2, 'tools/list', {});
    const toolset = (body.tools ?? []).find((t) => t.type === 'mcp_toolset' && t.mcp_server_name === s.name);
    const disabled = new Set(Object.entries(toolset?.configs ?? {}).filter(([, c]) => c.enabled === false).map(([k]) => k));
    const tool = (list.tools ?? []).find((t) => !disabled.has(t.name));
    if (!tool) return { text: 'No MCP tools are enabled.' };
    const input = { city: 'Seoul' };
    const res = await rpc(3, 'tools/call', { name: tool.name, arguments: input });
    const out = (res.content ?? []).map((c) => c.text ?? '').join('\n');
    return { mcp: { server: s.name, name: tool.name, input, output: out, isError: !!res.isError }, text: `The MCP tool says: ${out}` };
  } catch (e) {
    return { error: 400, message: `Error connecting to MCP server ${s.name}: ${e.message}` };
  }
}

function attachmentsPlan(body) {
  const blocks = userTurnBlocks(body);
  const parts = [];
  for (const b of blocks) {
    if (b.type === 'image') parts.push(`an image (${b.source?.media_type}, ${Math.round(((b.source?.data?.length ?? 0) * 3) / 4)} bytes)`);
    if (b.type === 'document') parts.push(`a PDF document “${b.title ?? 'untitled'}”`);
    if (b.type === 'text') {
      const f = /<file name="([^"]+)"[^>]*>\n([^\n]*)/.exec(b.text);
      if (f) parts.push(`the file “${f[1]}” starting with “${f[2].slice(0, 40)}”`);
    }
  }
  return parts.length ? { text: `I can see ${parts.join(' and ')}.` } : null;
}

/** The canned answer for a request (also used by e2e/ai-mock-openai.mjs, which translates Responses requests). */
// README captures (scripts/readme/capture.mjs): MOCK_DEMO_ANSWERS points at {chat: {question: answer}, titles: {…}}.
const DEMO = process.env.MOCK_DEMO_ANSWERS ? JSON.parse(readFileSync(process.env.MOCK_DEMO_ANSWERS, 'utf8')) : null;
function demoAnswer(sys, userText, q) {
  if (!DEMO) return null;
  if (sys.startsWith('You name chat conversations')) {
    const um = /<user_message>\n([\s\S]*?)\n<\/user_message>/.exec(userText)?.[1]?.trim();
    return (um && DEMO.titles?.[um]) || null;
  }
  return DEMO.chat?.[(q ?? '').trim()] ?? null;
}

export async function plan(body) {
  const sys = systemText(body);
  const last = body.messages?.[body.messages.length - 1];
  const userText = lastUserText(body) ?? '';
  const q = question(body);
  const demo = demoAnswer(sys, userText, q);
  if (demo) return { text: demo };
  const toolResult = last?.role === 'user' && Array.isArray(last.content) && last.content.find((b) => b.type === 'tool_result');
  if (/\[\[429\]\]/.test(q)) return { error: 429 };
  if (sys.startsWith('You name chat conversations')) {
    const um = /<user_message>\n([\s\S]*?)\n<\/user_message>/.exec(userText)?.[1] ?? 'Chat';
    const words = um.replace(/["“”.,!?]/g, '').split(/\s+/).filter(Boolean).slice(0, 4).join(' ');
    return { text: `${words.charAt(0).toUpperCase()}${words.slice(1)} (AI title)` };
  }
  if (sys.startsWith('You are Litpage AI, the writing assistant')) {
    const task = userText.split('Task:').pop() ?? '';
    const sel = /<selection>\n([\s\S]*?)\n<\/selection>/.exec(userText)?.[1] ?? '';
    if (/slow/i.test(task)) return { text: Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} of a long draft.`).join(' '), slow: true };
    if (/self-contained HTML document/.test(task)) return { text: `<!DOCTYPE html>\n<html><head><title>AI HTML</title></head><body><h1 id="ai-html">AI dashboard</h1><p>${(/Create (.+?) as one/.exec(task)?.[1] ?? '').slice(0, 60)}</p></body></html>` };
    if (/skill instructions/.test(task)) return { text: `Skill applied: ${(/\(“([^”]+)”\)/.exec(task)?.[1]) ?? 'skill'} → ${sel || 'page'}` };
    if (/<reference_page id="[^"]+" title="([^"]+)">/.test(userText)) return { text: `Written in the style of ${/<reference_page id="[^"]+" title="([^"]+)">/.exec(userText)[1]}.` };
    if (/Fix the spelling/.test(task)) return { text: sel.replace(/\bteh\b/g, 'the').replace(/\bqiuck\b/g, 'quick') };
    if (/Translate/.test(task)) return { text: `번역: ${sel || 'page'}` };
    if (/Continue writing/.test(task)) return { text: 'The story continues with a **bold** next step.' };
    if (/Find the action items/.test(task)) return { text: '- [ ] Draft the launch plan @Ada\n- [ ] Review pricing' };
    if (/Summarize/.test(task)) return { text: 'Summary: the page explains the basics.' };
    if (/Make a table/.test(task)) return { text: '| Task | Owner |\n| --- | --- |\n| Spec | Ada |\n| QA | Lin |' };
    if (/shorter/.test(task)) return { text: 'Short.' };
    return { text: `AI: ${sel || 'Here is a new paragraph.'}` };
  }
  if (sys.startsWith('You generate the content of an AI block')) {
    const refs = [...userText.matchAll(/<mentioned_page id="[^"]+" title="([^"]+)">/g)].map((x) => x[1]);
    if (/action items/i.test(userText)) return { text: '- [ ] Follow up with the team\n- [ ] Ship the release' };
    return { text: `## Key points\n\n- Welcome to the workspace\n- Try typing with **AI**${refs.length ? `\n- Also uses: ${refs.join(', ')}` : ''}`, slow: false };
  }
  if (sys.startsWith('You fill in one property value')) {
    if (/Translate/.test(userText)) return { text: '번역된 제목' };
    if (/Write a short summary/.test(userText)) return { text: `Summary of ${/Title: (.*)/.exec(userText)?.[1] ?? 'row'}` };
    if (/key information/i.test(userText)) return { text: 'alpha, beta' };
    return { text: 'Large' };
  }
  if (sys.startsWith('You are Litpage AI answering a question')) return { text: 'The toggle block hides tips [1].' };
  if (sys.startsWith('You write the summary of a meeting')) {
    const lines = [...userText.matchAll(/^L(\d+) \[[^\]]*\] ([^:\n]+): (.*)$/gm)].map((m) => ({ n: Number(m[1]), speaker: m[2], text: m[3] }));
    const untitled = /<meeting title=""/.test(userText);
    const instr = /<instructions name="([^"]*)">/.exec(userText)?.[1] ?? 'Auto';
    const who = (/<participants>\n([^\n(]+)/.exec(userText)?.[1] ?? '').trim();
    const notes = (/<notes>\n([\s\S]*?)\n<\/notes>/.exec(userText)?.[1] ?? '').trim();
    const out = [];
    if (untitled) out.push('# Launch planning sync', '');
    out.push('### Discussion');
    for (const l of lines.slice(0, 3)) out.push(`- ${l.speaker} said: ${l.text.slice(0, 80)} [L${l.n}]`);
    if (!lines.length && notes && notes !== '(no notes)') out.push(`- From the notes: ${notes.split('\n')[0].slice(0, 80)}`);
    out.push('', '### Action items', `- [ ] Send the launch checklist${who ? ` @${who}` : ''}${lines.length ? ` [L${lines[0].n}]` : ''}`, '', `Instructions used: ${instr}`);
    return { text: out.join('\n') };
  }
  
  if (sys.startsWith('You draw illustrations as SVG')) {
    const editing = /<current_svg>/.test(userText);
    const what = (editing ? /Edit this image: (.*)/.exec(userText)?.[1] : /Draw: (.*)/.exec(userText)?.[1]) ?? 'image';
    const label = what.replace(/[<>&"]/g, '').slice(0, 40);
    const fill = editing ? '#cfe3ff' : '#ffe8c2';
    return { text: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" onload="alert(1)"><script>alert(1)</script><rect width="1200" height="800" fill="${fill}"/><circle cx="600" cy="360" r="180" fill="#2383e2" opacity="0.8"/><a href="https://example.com"><rect x="10" y="10" width="40" height="40" fill="red"/></a><text x="600" y="700" font-size="56" text-anchor="middle" fill="#37352f">${editing ? 'Edited: ' : ''}${label}</text></svg>` };
  }
  // chat
  if (/who are you/i.test(q)) {
    const name = /named you "([^"]+)"/.exec(sys)?.[1] ?? 'Litpage AI';
    const instructions = /<user_instructions>\n([\s\S]*?)\n<\/user_instructions>/.exec(sys)?.[1]?.trim() ?? 'none';
    return { text: `I am ${name}. My instructions: ${instructions}` };
  }
  const imgAsk = /generate an image of (.+?)\.?$/i.exec(q);
  if (imgAsk && hasTool(body, 'generate_image')) {
    const call = turnTools(body).find((t) => t.name === 'generate_image');
    const cur = contextPage(body);
    if (!call) return { tool: { name: 'generate_image', input: { prompt: imgAsk[1], style: 'diagram', ...(cur && /this page/i.test(q) ? { insert_into_page_id: cur.id } : {}) } } };
    if (call.result) {
      const md = /!\[[^\]]*\]\(\/files\/[^)\s]+\)/.exec(call.result.text)?.[0];
      return { text: call.result.isError ? `I couldn’t create the image: ${call.result.text.slice(0, 160)}` : `Here is your image.\n\n${md ?? ''}` };
    }
  }
  const att = attachmentsPlan(body);
  if (att && !toolResult) return att;
  const webTool = (body.tools ?? []).find((t) => t.name === 'web_search' && /^web_search_/.test(t.type ?? ''));
  if (webTool && /\b(web|latest)\b/i.test(q) && !toolResult) {
    return { web: { query: 'litpage agent news', url: 'https://example.com/lit-agent', title: 'Litpage Agent launch', text: 'Litpage shipped agents that edit pages.' } };
  }
  const mcpClient = mcpClientPlan(body, q);
  if (mcpClient) return mcpClient;
  const mcp = await mcpPlan(body, q);
  if (mcp) return mcp;
  const custom = customAgentPlan(body, q, sys);
  if (custom) return custom;
  if (sys.includes('Research mode is on') && hasTool(body, 'search_workspace')) {
    const tools = turnTools(body);
    // the welcome page's toggle is "More shortcuts and ideas" (the word "toggle" is not in the seed content)
    if (!tools.some((t) => t.name === 'search_workspace')) return { tool: { name: 'search_workspace', input: { query: 'shortcuts' } } };
    const found = tools.find((t) => t.name === 'search_workspace')?.result?.text ?? '';
    const pid = /\(page_id: ([0-9a-f-]{36})\)/.exec(found)?.[1];
    if (pid && !tools.some((t) => t.name === 'read_page')) return { tool: { name: 'read_page', input: { page_id: pid } } };
    return { text: '## Summary\n\nToggles hide content until opened [1].\n\n## Details\n\n- The Welcome to Litpage page explains toggles [1].\n\n## Open questions\n\n- None found.' };
  }
  const agent = hasTool(body, 'create_pages') || hasTool(body, 'list_notifications') ? agentPlan(body, q, sys) : null;
  if (agent) return agent;
  if (/<source n="1"/.test(userText)) return { text: 'Toggle blocks hide tips until you open them [1].' };
  if (toolResult) {
    return { text: 'I found it in your workspace: the **Welcome to Litpage** page explains toggles [1].' };
  }
  if (/search/i.test(q) && (body.tools ?? []).some((t) => t.name === 'search_workspace')) {
    // the seeded "Welcome to Litpage" page keeps its tips in the “More shortcuts and ideas” toggle
    return { tool: { name: 'search_workspace', input: { query: 'shortcuts' } } };
  }
  if (/slow/i.test(q)) {
    return { text: Array.from({ length: 60 }, (_, i) => `Sentence ${i + 1} of a long answer.`).join(' '), slow: true };
  }
  if (/summar/i.test(q)) return { text: '### Page summary\n\n- Basics of the workspace\n- Toggle tips\n\n```js\nconsole.log("hi")\n```' };
  return { text: '# Hello!\n\nHere is a **Markdown** answer with a list:\n\n1. First item\n2. Second item\n\n- [ ] A to-do\n\n| A | B |\n| --- | --- |\n| 1 | 2 |' };
}

function chunks(text, n = 12) {
  const out = [];
  for (let i = 0; i < text.length; i += n) out.push(text.slice(i, i + n));
  return out;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url.startsWith('/v1/messages')) {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'not found' } }));
    return;
  }
  let raw = '';
  for await (const c of req) raw += c;
  const body = JSON.parse(raw || '{}');
  requests.push({ headers: req.headers, body });
  if (process.env.MOCK_LOG) console.log('[mock]', body.model, body.output_config?.effort, req.headers['anthropic-beta'], lastUserText(body)?.slice(0, 60));
  if (req.headers['x-api-key'] !== 'test-key') {
    res.writeHead(401, { 'content-type': 'application/json', 'request-id': 'req_mock_401' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
    return;
  }
  if (body.mcp_servers?.length && !String(req.headers['anthropic-beta'] ?? '').includes('mcp-client-2025-11-20')) {
    res.writeHead(400, { 'content-type': 'application/json', 'request-id': 'req_mock_400' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'mcp_servers requires the mcp-client-2025-11-20 beta' } }));
    return;
  }
  const p = await plan(body);
  if (p.error === 429) {
    res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '0', 'request-id': 'req_mock_429' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } }));
    return;
  }
  if (p.error === 400) {
    res.writeHead(400, { 'content-type': 'application/json', 'request-id': 'req_mock_400' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: p.message } }));
    return;
  }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'request-id': 'req_mock' });
  let closed = false;
  req.on('close', () => { closed = true; });
  res.on('close', () => { closed = true; });
  const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  send('message_start', { type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 42, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  // Opus 5.5 always thinks; display omitted → empty thinking text + signature
  send('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } });
  await wait(150);
  send('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'mock-signature' } });
  send('content_block_stop', { type: 'content_block_stop', index: 0 });
  let index = 1;
  const textBlock = async (text, citation, slow) => {
    const i = index++;
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'text', text: '' } });
    for (const part of chunks(text, slow ? 16 : 14)) {
      if (closed) return false;
      send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: part } });
      await wait(slow ? 45 : 15);
    }
    if (citation) send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'citations_delta', citation } });
    send('content_block_stop', { type: 'content_block_stop', index: i });
    return true;
  };
  const end = (reason) => {
    send('message_delta', { type: 'message_delta', delta: { stop_reason: reason, stop_sequence: null }, usage: { output_tokens: 64 } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  };
  if (p.tool) {
    const i = index++;
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: `toolu_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, name: p.tool.name, input: {} } });
    const json = JSON.stringify(p.tool.input);
    for (const part of chunks(json, 6)) {
      send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: part } });
      await wait(5);
    }
    send('content_block_stop', { type: 'content_block_stop', index: i });
    end('tool_use');
    return;
  }
  if (p.web) {
    const sid = `srvtoolu_${Date.now()}`;
    let i = index++;
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'server_tool_use', id: sid, name: 'web_search', input: {} } });
    send('content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ query: p.web.query }) } });
    send('content_block_stop', { type: 'content_block_stop', index: i });
    await wait(60);
    i = index++;
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'web_search_tool_result', tool_use_id: sid, content: [{ type: 'web_search_result', url: p.web.url, title: p.web.title, encrypted_content: 'enc', page_age: null }] } });
    send('content_block_stop', { type: 'content_block_stop', index: i });
    await textBlock('According to recent coverage, ');
    await textBlock(p.web.text, { type: 'web_search_result_location', url: p.web.url, title: p.web.title, cited_text: p.web.text, encrypted_index: 'enc' });
    end('end_turn');
    return;
  }
  if (p.mcp) {
    const mid = `mcptoolu_${Date.now()}`;
    let i = index++;
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'mcp_tool_use', id: mid, name: p.mcp.name, server_name: p.mcp.server, input: p.mcp.input } });
    send('content_block_stop', { type: 'content_block_stop', index: i });
    await wait(40);
    i = index++;
    send('content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'mcp_tool_result', tool_use_id: mid, is_error: p.mcp.isError, content: [{ type: 'text', text: p.mcp.output }] } });
    send('content_block_stop', { type: 'content_block_stop', index: i });
  }
  if (!(await textBlock(p.text, null, p.slow))) return;
  end('end_turn');
});

// listen only when run directly (e2e/ai-mock-openai.mjs imports plan())
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  server.listen(port, '127.0.0.1', () => console.log(`[mock-anthropic] listening on http://127.0.0.1:${port}`));
}
